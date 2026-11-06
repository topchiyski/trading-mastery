/**
 * Generic CSV importer: any broker export, read through a user-defined column mapping.
 * The first row must be the header. Rows without an id column are de-duplicated by a
 * content fingerprint of (symbol, side, quantity, price, executed_at).
 */
import { isValidTicker, nyLocalToUtc, parseCsv, toMicros, toQuantity } from '@tj/core';
import { z } from 'zod';
import {
  Fingerprinter,
  parseNumber,
  type ParseIssue,
  type ParseResult,
  type ParsedExecution,
} from './types';

export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'DD.MM.YYYY',
  'YYYYMMDD',
] as const;

export const csvMappingSchema = z
  .object({
    delimiter: z.enum([',', ';', '\t']).optional(),
    columns: z
      .object({
        symbol: z.string().min(1),
        quantity: z.string().min(1),
        price: z.string().min(1),
        /** May hold the date only, or date and time together. */
        date: z.string().min(1),
        time: z.string().min(1).optional(),
        /** Without a side column, a negative quantity means SELL. */
        side: z.string().min(1).optional(),
        commission: z.string().min(1).optional(),
        otherFees: z.string().min(1).optional(),
        externalId: z.string().min(1).optional(),
      })
      .strict(),
    dateFormat: z.enum(DATE_FORMATS),
    timeZone: z.enum(['America/New_York', 'UTC']),
    /** Case-insensitive values of the side column. */
    sideValues: z
      .object({ buy: z.array(z.string().min(1)).min(1), sell: z.array(z.string().min(1)).min(1) })
      .optional(),
  })
  .strict();
export type CsvMapping = z.infer<typeof csvMappingSchema>;

const DEFAULT_SIDES = { buy: ['BUY', 'B', 'BOT', 'BOUGHT'], sell: ['SELL', 'S', 'SLD', 'SOLD'] };
/** Used when the file has a date but no time. */
const DEFAULT_TIME = '12:00:00';

function toIsoDate(raw: string, format: CsvMapping['dateFormat']): string {
  const s = raw.trim();
  const patterns: Record<CsvMapping['dateFormat'], RegExp> = {
    'YYYY-MM-DD': /^(?<y>\d{4})-(?<m>\d{1,2})-(?<d>\d{1,2})$/,
    'MM/DD/YYYY': /^(?<m>\d{1,2})\/(?<d>\d{1,2})\/(?<y>\d{4})$/,
    'DD/MM/YYYY': /^(?<d>\d{1,2})\/(?<m>\d{1,2})\/(?<y>\d{4})$/,
    'DD.MM.YYYY': /^(?<d>\d{1,2})\.(?<m>\d{1,2})\.(?<y>\d{4})$/,
    YYYYMMDD: /^(?<y>\d{4})(?<m>\d{2})(?<d>\d{2})$/,
  };
  const g = patterns[format].exec(s)?.groups;
  if (!g?.['y'] || !g['m'] || !g['d']) throw new Error(`date "${raw}" does not match ${format}`);
  return `${g['y']}-${g['m'].padStart(2, '0')}-${g['d'].padStart(2, '0')}`;
}

/** "10:00", "10:15:30", "3:05 PM" -> "HH:MM:SS". */
function toTime(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(raw.trim());
  if (!m) throw new Error(`unrecognised time "${raw}"`);
  let h = Number(m[1]);
  const ampm = m[4]?.toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
}

function timestamp(dateRaw: string, timeRaw: string | undefined, mapping: CsvMapping): string {
  // The date column may carry the time too: "2026-03-02 10:00", "2026-03-02T10:00:00", "03/02/2026, 10:00".
  const [datePart = '', inlineTime] = dateRaw.trim().split(/[T ,]+(?=\d{1,2}:)/);
  const date = toIsoDate(datePart.replace(/,$/, ''), mapping.dateFormat);
  const t = timeRaw?.trim() || inlineTime?.trim();
  const time = t ? toTime(t) : DEFAULT_TIME;
  return mapping.timeZone === 'UTC'
    ? new Date(`${date}T${time}Z`).toISOString()
    : nyLocalToUtc(date, time);
}

export function parseGenericCsv(text: string, mapping: CsvMapping): ParseResult {
  const rows = parseCsv(text, mapping.delimiter ?? ',');
  const [header, ...data] = rows;
  if (!header) throw new Error('The file is empty.');
  const col = new Map(header.map((h, i) => [h.trim(), i]));
  const index = (name: string | undefined): number | undefined => {
    if (name === undefined) return undefined;
    const i = col.get(name);
    if (i === undefined) throw new Error(`column "${name}" not found in the file header`);
    return i;
  };
  const c = Object.fromEntries(
    Object.entries(mapping.columns).map(([k, v]) => [k, index(v)]),
  ) as Record<keyof CsvMapping['columns'], number | undefined>;

  const sides = mapping.sideValues ?? DEFAULT_SIDES;
  const buy = new Set(sides.buy.map((s) => s.trim().toUpperCase()));
  const sell = new Set(sides.sell.map((s) => s.trim().toUpperCase()));
  const fp = new Fingerprinter();
  const executions: ParsedExecution[] = [];
  const issues: ParseIssue[] = [];

  data.forEach((cells, i) => {
    const line = i + 2;
    const get = (k: keyof CsvMapping['columns']) => {
      const idx = c[k];
      return idx === undefined ? undefined : (cells[idx] ?? '').trim();
    };
    try {
      let side: 'BUY' | 'SELL' | null = null;
      const sideRaw = get('side');
      if (sideRaw !== undefined) {
        const v = sideRaw.toUpperCase();
        if (buy.has(v)) side = 'BUY';
        else if (sell.has(v)) side = 'SELL';
        else return issues.push({ line, severity: 'skipped', reason: `Unknown side "${sideRaw}"` });
      }
      const qty = parseNumber(get('quantity'));
      const price = parseNumber(get('price'));
      if (qty === null || price === null) throw new Error('missing quantity or price');
      const negative = qty.startsWith('-');
      side ??= negative ? 'SELL' : 'BUY';
      const quantity = toQuantity(qty.replace(/^[-+]/, ''));
      if (quantity === 0)
        return issues.push({ line, severity: 'skipped', reason: 'Zero quantity' });
      const symbol = (get('symbol') ?? '').toUpperCase().replace(/\s+/g, '.');
      if (!isValidTicker(symbol)) throw new Error(`unsupported symbol "${symbol}"`);
      const cost = (k: 'commission' | 'otherFees') =>
        Math.abs(toMicros(parseNumber(get(k)) ?? '0'));
      const executedAt = timestamp(get('date') ?? '', get('time'), mapping);
      const p = toMicros(price);
      const id = get('externalId');
      executions.push({
        line,
        symbol,
        side,
        quantity,
        price: p,
        commission: cost('commission'),
        otherFees: cost('otherFees'),
        executedAt,
        externalId: id || fp.id('exec', symbol, side, quantity, p, executedAt),
      });
    } catch (err) {
      issues.push({
        line,
        severity: 'error',
        reason: err instanceof Error ? err.message : String(err),
        detail: cells.join(','),
      });
    }
  });

  return { executions, cashFlows: [], issues };
}
