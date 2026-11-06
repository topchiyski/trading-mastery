import type { CashFlowType, Micros, Quantity } from '@tj/core';
import { createHash } from 'node:crypto';

/** One execution read from a file, ready to insert (money in micros, quantity in micro-shares). */
export interface ParsedExecution {
  /** 1-based line in the source file. */
  line: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: Quantity;
  price: Micros;
  commission: Micros;
  otherFees: Micros;
  executedAt: string;
  /** Broker execution id, or a `fp:` fingerprint when the file has none. Used to de-duplicate. */
  externalId: string;
}

export interface ParsedCashFlow {
  line: number;
  type: CashFlowType;
  amount: Micros;
  /** Plain NY date or UTC timestamp. */
  occurredAt: string;
  note: string | null;
  externalId: string;
}

export interface ParseIssue {
  line: number;
  /** skipped: intentionally not imported (e.g. non-USD); error: could not be read. */
  severity: 'skipped' | 'error' | 'warning';
  reason: string;
  detail?: string;
}

export interface ParseResult {
  executions: ParsedExecution[];
  cashFlows: ParsedCashFlow[];
  issues: ParseIssue[];
}

/**
 * Assigns `fp:<hash>#<n>` ids from row content. Identical rows in one file get #1, #2, …
 * so both are kept, and re-importing the same file reproduces the same ids.
 */
export class Fingerprinter {
  private readonly seen = new Map<string, number>();

  id(...parts: (string | number)[]): string {
    const hash = createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24);
    const n = (this.seen.get(hash) ?? 0) + 1;
    this.seen.set(hash, n);
    return `fp:${hash}#${n}`;
  }
}

/** Parse a broker number like "1,000", "-0.35035875" or "" (null). Throws on junk. */
export function parseNumber(raw: string | undefined): string | null {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (s === '' || s === '--') return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) throw new Error(`not a number: "${raw}"`);
  return s;
}
