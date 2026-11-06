import { parseTimestamp } from './dates';
import { formatQuantity } from './quantity';
import type { Execution, GroupedTrade, GroupingError, GroupingResult } from './types';

/** Uppercase US ticker: 1–6 chars, optional share-class suffix like BRK.B or BF-B. */
const TICKER_RE = /^[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z0-9]{1,2})?$/;

export function isValidTicker(symbol: string): boolean {
  return TICKER_RE.test(symbol);
}

/** Returns human-readable problems; empty when the execution is valid. */
export function validateExecution(e: Execution): string[] {
  const problems: string[] = [];
  if (!isValidTicker(e.symbol)) problems.push(`invalid ticker "${e.symbol}"`);
  if (e.side !== 'BUY' && e.side !== 'SELL') problems.push(`invalid side "${String(e.side)}"`);
  if (!Number.isSafeInteger(e.quantity) || e.quantity <= 0) {
    problems.push(`quantity must be positive, got ${e.quantity}`);
  }
  if (!Number.isSafeInteger(e.price) || e.price <= 0) problems.push('price must be positive');
  if (!Number.isSafeInteger(e.commission) || e.commission < 0) {
    problems.push('commission must be a non-negative cost');
  }
  if (!Number.isSafeInteger(e.otherFees) || e.otherFees < 0) {
    problems.push('other fees must be a non-negative cost');
  }
  if (Number.isNaN(Date.parse(e.executedAt))) {
    problems.push(`invalid timestamp "${e.executedAt}"`);
  }
  return problems;
}

/**
 * Deterministic execution order: time, then broker execution id (executions that
 * have one come first), then insertion order (id).
 */
export function compareExecutions(a: Execution, b: Execution): number {
  const dt = parseTimestamp(a.executedAt) - parseTimestamp(b.executedAt);
  if (dt !== 0) return dt;
  const ax = a.externalId ?? null;
  const bx = b.externalId ?? null;
  if (ax !== bx) {
    if (ax === null) return 1;
    if (bx === null) return -1;
    return ax < bx ? -1 : 1;
  }
  return a.id - b.id;
}

function groupSymbol(
  symbol: string,
  executions: Execution[],
  errors: GroupingError[],
): GroupedTrade[] {
  const trades: GroupedTrade[] = [];
  let current: GroupedTrade | null = null;
  let position = 0;

  for (const e of [...executions].sort(compareExecutions)) {
    if (e.side === 'BUY') {
      if (!current) {
        current = {
          stableKey: e.id,
          symbol,
          direction: 'LONG',
          status: 'OPEN',
          openedAt: e.executedAt,
          closedAt: null,
          executions: [],
        };
        trades.push(current);
      }
      current.executions.push(e);
      position += e.quantity;
      continue;
    }

    if (!current || e.quantity > position) {
      errors.push({
        code: 'SELL_EXCEEDS_POSITION',
        executionId: e.id,
        symbol,
        executedAt: e.executedAt,
        positionBefore: position,
        sellQuantity: e.quantity,
        message: `Sell of ${formatQuantity(e.quantity)} ${symbol} exceeds the open position of ${formatQuantity(position)} (long-only).`,
      });
      continue;
    }
    current.executions.push(e);
    position -= e.quantity;
    if (position === 0) {
      current.status = 'CLOSED';
      current.closedAt = e.executedAt;
      current = null;
    }
  }
  return trades;
}

/**
 * Group executions into trades per symbol. A BUY while flat opens a trade, the
 * position returning to zero closes it. Invalid executions and oversized sells
 * are reported in `errors` and not applied.
 */
export function groupExecutions(executions: readonly Execution[]): GroupingResult {
  const errors: GroupingError[] = [];
  const bySymbol = new Map<string, Execution[]>();

  for (const e of executions) {
    const problems = validateExecution(e);
    if (problems.length > 0) {
      errors.push({
        code: 'INVALID_EXECUTION',
        executionId: e.id,
        symbol: e.symbol,
        message: problems.join('; '),
      });
      continue;
    }
    const list = bySymbol.get(e.symbol);
    if (list) list.push(e);
    else bySymbol.set(e.symbol, [e]);
  }

  const trades = [...bySymbol].flatMap(([symbol, list]) => groupSymbol(symbol, list, errors));
  trades.sort(
    (a, b) => parseTimestamp(a.openedAt) - parseTimestamp(b.openedAt) || a.stableKey - b.stableKey,
  );
  return { trades, errors };
}
