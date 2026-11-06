/**
 * IBKR Activity Statement (CSV) importer.
 *
 * The statement is one CSV with many sections; every row starts with
 * `<Section>,<Header|Data|SubTotal|Total>`, and each Data row is read with the most
 * recent Header row of its section (the Trades section has a second header for Forex).
 * Rows are usually per order (partial fills aggregated) and carry no execution id, so
 * rows are de-duplicated by content fingerprint. Date/times are New York time.
 *
 * Imported: USD stock trades, USD transaction fees (onto the matching fill), USD deposits,
 * withdrawals, dividends, withholding tax (as negative dividends), interest and fees.
 * Skipped with a reason: other asset classes, non-USD rows, cancelled trades, totals.
 */
import {
  isValidTicker,
  nyLocalToUtc,
  parseCsv,
  toMicros,
  toQuantity,
  type CashFlowType,
} from '@tj/core';
import {
  Fingerprinter,
  parseNumber,
  type ParseIssue,
  type ParseResult,
  type ParsedCashFlow,
  type ParsedExecution,
} from './types';

type Row = Record<string, string>;

/** "2026-03-10, 15:45:00" (NY) -> UTC ISO. Also accepts "2026-03-10 15:45:00" / "2026-03-10;154500". */
function nyDateTime(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[,; ]+\s*(\d{2}):?(\d{2}):?(\d{2})?$/.exec(raw.trim());
  if (!m) throw new Error(`unrecognised date/time "${raw}"`);
  return nyLocalToUtc(m[1] as string, `${m[2]}:${m[3]}:${m[4] ?? '00'}`);
}

function plainDate(raw: string): string {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`unrecognised date "${raw}"`);
  return s;
}

const isTotal = (v: string | undefined) => !!v && /^Total/i.test(v.trim());

export function parseIbkrActivity(text: string): ParseResult {
  const lines = parseCsv(text);
  if (
    !lines.some((r) => r[0] === 'Statement' && r[1] === 'Data' && r[3] === 'Activity Statement')
  ) {
    throw new Error('This file is not an IBKR Activity Statement (CSV).');
  }

  const executions: ParsedExecution[] = [];
  const cashFlows: ParsedCashFlow[] = [];
  const unmatchedFees: ParsedCashFlow[] = [];
  const issues: ParseIssue[] = [];
  const fp = new Fingerprinter();
  const headers = new Map<string, string[]>();
  const fees: { line: number; row: Row }[] = [];

  const skip = (line: number, reason: string, detail?: string) =>
    issues.push({ line, severity: 'skipped', reason, ...(detail ? { detail } : {}) });
  const fail = (line: number, err: unknown, detail?: string) =>
    issues.push({
      line,
      severity: 'error',
      reason: err instanceof Error ? err.message : String(err),
      ...(detail ? { detail } : {}),
    });
  const usd = (line: number, currency: string | undefined) => {
    if (currency === 'USD') return true;
    skip(line, `Non-USD (${currency || '?'})`);
    return false;
  };
  const cash = (line: number, type: CashFlowType, amount: string, date: string, note: string) => {
    const amt = toMicros(amount);
    cashFlows.push({
      line,
      type,
      amount: amt,
      occurredAt: date,
      note,
      externalId: fp.id('cash', type, date, amt, note),
    });
  };

  lines.forEach((cells, idx) => {
    const line = idx + 1;
    const [section = '', kind = ''] = cells;
    const rest = cells.slice(2);
    if (kind === 'Header') {
      headers.set(section, rest);
      return;
    }
    if (kind !== 'Data') return; // SubTotal / Total rows
    const header = headers.get(section);
    if (!header) return;
    const row: Row = Object.fromEntries(header.map((h, i) => [h, rest[i] ?? '']));

    try {
      switch (section) {
        case 'Trades': {
          if (
            row['DataDiscriminator'] &&
            !['Order', 'Trade', 'ExecutionDetail'].includes(row['DataDiscriminator'])
          )
            return;
          if (row['Asset Category'] !== 'Stocks')
            return skip(line, `Not a stock (${row['Asset Category'] || '?'})`);
          if (!usd(line, row['Currency'])) return;
          const codes = (row['Code'] ?? '').split(';').map((c) => c.trim());
          if (codes.includes('Ca')) return skip(line, 'Cancelled trade');
          // IBKR writes share classes with a space ("BRK B"); store the usual dotted form.
          const symbol = (row['Symbol'] ?? '').trim().replace(/\s+/g, '.');
          if (!isValidTicker(symbol)) throw new Error(`unsupported symbol "${symbol}"`);
          const qty = parseNumber(row['Quantity']);
          const price = parseNumber(row['T. Price']);
          if (qty === null || price === null) throw new Error('missing quantity or price');
          const comm = toMicros(parseNumber(row['Comm/Fee']) ?? '0');
          if (comm > 0)
            issues.push({ line, severity: 'warning', reason: 'Commission rebate ignored' });
          const quantity = toQuantity(qty.replace(/^[-+]/, ''));
          if (quantity === 0) return skip(line, 'Zero quantity');
          const executedAt = nyDateTime(row['Date/Time'] ?? '');
          const side = qty.startsWith('-') ? 'SELL' : 'BUY';
          const p = toMicros(price);
          executions.push({
            line,
            symbol,
            side,
            quantity,
            price: p,
            commission: comm < 0 ? -comm : 0,
            otherFees: 0,
            executedAt,
            externalId: fp.id('exec', symbol, side, quantity, p, executedAt),
          });
          return;
        }
        case 'Transaction Fees': {
          if (isTotal(row['Asset Category'])) return;
          if (!usd(line, row['Currency'])) return;
          fees.push({ line, row }); // matched to fills after all trades are read
          return;
        }
        case 'Deposits & Withdrawals': {
          if (isTotal(row['Currency']) || !usd(line, row['Currency'])) return;
          const amount = parseNumber(row['Amount']) ?? '0';
          const type = amount.startsWith('-') ? 'WITHDRAWAL' : 'DEPOSIT';
          return cash(
            line,
            type,
            amount,
            plainDate(row['Settle Date'] ?? row['Date'] ?? ''),
            row['Description'] ?? '',
          );
        }
        case 'Dividends':
        case 'Withholding Tax':
        case 'Interest':
        case 'Fees': {
          if (isTotal(row['Currency']) || isTotal(row['Subtitle'])) return;
          if (!usd(line, row['Currency'])) return;
          const amount = parseNumber(row['Amount']);
          if (amount === null) throw new Error('missing amount');
          const desc = row['Description'] ?? '';
          const date = plainDate(row['Date'] ?? '');
          if (section === 'Dividends') return cash(line, 'DIVIDEND', amount, date, desc);
          if (section === 'Withholding Tax')
            return cash(line, 'DIVIDEND', amount, date, `Withholding tax: ${desc}`);
          if (section === 'Interest') return cash(line, 'INTEREST', amount, date, desc);
          return cash(line, 'FEE', amount, date, desc);
        }
        default:
          return; // other sections (NAV, performance, codes…) carry nothing to import
      }
    } catch (err) {
      fail(line, err, cells.slice(0, 8).join(','));
    }
  });

  // Attach each USD transaction fee to the fill with the same symbol and time; otherwise book it as a fee.
  for (const { line, row } of fees) {
    try {
      const amount = toMicros(parseNumber(row['Amount']) ?? '0');
      const at = nyDateTime(row['Date/Time'] ?? '');
      const target = executions.find((e) => e.symbol === row['Symbol'] && e.executedAt === at);
      if (target) target.otherFees += -amount;
      else {
        const date = (row['Date/Time'] ?? '').slice(0, 10);
        const note = `Transaction fee: ${row['Symbol'] ?? ''} ${row['Description'] ?? ''}`.trim();
        unmatchedFees.push({
          line,
          type: 'FEE',
          amount,
          occurredAt: date,
          note,
          externalId: fp.id('fee', date, amount, note),
        });
      }
    } catch (err) {
      fail(line, err);
    }
  }

  return { executions, cashFlows: [...cashFlows, ...unmatchedFees], issues };
}
