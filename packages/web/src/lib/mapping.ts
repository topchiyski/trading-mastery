/** Column mapping for the generic CSV importer (mirrors the server's CsvMapping). */
export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'DD.MM.YYYY',
  'YYYYMMDD',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export type MappingField =
  | 'symbol'
  | 'quantity'
  | 'price'
  | 'date'
  | 'time'
  | 'side'
  | 'commission'
  | 'otherFees'
  | 'externalId';

export interface CsvMapping {
  delimiter?: ',' | ';' | '\t';
  columns: Partial<Record<MappingField, string>>;
  dateFormat: DateFormat;
  timeZone: 'America/New_York' | 'UTC';
  sideValues?: { buy: string[]; sell: string[] };
}

export const FIELD_LABELS: Record<
  MappingField,
  { label: string; required?: boolean; hint?: string }
> = {
  symbol: { label: 'Symbol', required: true },
  side: { label: 'Side (buy/sell)', hint: 'If empty, a negative quantity means sell' },
  quantity: { label: 'Quantity', required: true },
  price: { label: 'Price', required: true },
  date: { label: 'Date (or date & time)', required: true },
  time: { label: 'Time', hint: 'If empty, 12:00 is assumed' },
  commission: { label: 'Commission' },
  otherFees: { label: 'Other fees' },
  externalId: { label: 'Broker trade ID', hint: 'Used to skip duplicates' },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Candidate header names per field, in priority order (normalised). */
const CANDIDATES: [MappingField, string[]][] = [
  ['date', ['datetime', 'tradedatetime', 'executiontime', 'date', 'tradedate', 'filldate']],
  ['time', ['time', 'tradetime', 'filltime']],
  ['symbol', ['symbol', 'ticker', 'instrument', 'security', 'stock']],
  ['quantity', ['quantity', 'qty', 'shares', 'units', 'filledqty']],
  ['price', ['price', 'tprice', 'tradeprice', 'fillprice', 'executionprice', 'avgprice']],
  ['side', ['side', 'action', 'buysell', 'transactiontype', 'direction']],
  ['commission', ['commission', 'commissions', 'commfee', 'comm', 'fees', 'fee']],
  ['otherFees', ['otherfees', 'regfees', 'secfee', 'exchangefees']],
  ['externalId', ['ibexecid', 'execid', 'executionid', 'tradeid', 'transactionid', 'id']],
];

function guessDateFormat(sample: string | undefined): DateFormat {
  const s = (sample ?? '').trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return 'YYYY-MM-DD';
  if (/^\d{8}\b/.test(s)) return 'YYYYMMDD';
  if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(s)) return 'DD.MM.YYYY';
  const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}/.exec(s);
  if (m && Number(m[1]) > 12) return 'DD/MM/YYYY';
  return 'MM/DD/YYYY';
}

/** Best-effort mapping from header names (and a few sample rows for the date format). */
export function guessMapping(headers: string[], samples: string[][] = []): CsvMapping {
  const columns: CsvMapping['columns'] = {};
  const used = new Set<string>();
  for (const [field, names] of CANDIDATES) {
    for (const name of names) {
      const hit = headers.find((h) => norm(h) === name && !used.has(h));
      if (hit) {
        columns[field] = hit;
        used.add(hit);
        break;
      }
    }
  }
  const dateIdx = columns.date ? headers.indexOf(columns.date) : -1;
  return {
    columns,
    dateFormat: guessDateFormat(dateIdx >= 0 ? samples[0]?.[dateIdx] : undefined),
    timeZone: 'America/New_York',
  };
}

/** What the server assumes when no side values are given (keep in sync with generic-csv.ts). */
export const DEFAULT_SIDE_VALUES = {
  buy: ['BUY', 'B', 'BOT', 'BOUGHT'],
  sell: ['SELL', 'S', 'SLD', 'SOLD'],
};
