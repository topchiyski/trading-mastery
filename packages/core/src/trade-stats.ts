import { toNyDate, diffDays, tradingDaysBetween } from './dates';
import { compareExecutions } from './grouping';
import { mulDiv, type Micros } from './money';
import { notional, perShare } from './quantity';
import type { Execution, HoldingPeriod, TradeStatus } from './types';

export interface Realisation {
  executionId: number;
  executedAt: string;
  quantity: number;
  price: Micros;
  /** Cost basis taken off the position at the average cost at the time of the sell. */
  costBasisRemoved: Micros;
  realisedGross: Micros;
}

export interface FirstEntry {
  price: Micros;
  quantity: number;
  executedAt: string;
}

export interface TradeStats {
  status: TradeStatus;
  boughtQty: number;
  soldQty: number;
  openQty: number;
  /** Σ buy qty × price. */
  buyCost: Micros;
  /** Σ sell qty × price. */
  sellProceeds: Micros;
  /** Volume-weighted average buy price. */
  avgEntry: Micros;
  /** Volume-weighted average sell price; null before the first sell. */
  avgExit: Micros | null;
  /** Cost basis of the shares still held. */
  openCostBasis: Micros;
  avgOpenCost: Micros | null;
  /** Σ realised P&L of every sell, using average cost. */
  realisedGross: Micros;
  /** realisedGross − all fees paid so far (on buys and sells). */
  realisedNet: Micros;
  commissions: Micros;
  otherFees: Micros;
  /** commissions + otherFees. */
  fees: Micros;
  /** Closed trades only: Σ sells − Σ buys. */
  grossPnl: Micros | null;
  /** Closed trades only: gross − fees. */
  netPnl: Micros | null;
  /** Closed trades only: net ÷ buy cost (a ratio, 0.05 = 5%). */
  returnPct: number | null;
  firstEntry: FirstEntry;
  realisations: Realisation[];
}

/** P&L and averages for one trade's executions (any order; sorted internally). */
export function computeTradeStats(executions: readonly Execution[]): TradeStats {
  if (executions.length === 0) throw new RangeError('A trade needs at least one execution');

  let openQty = 0;
  let openCost = 0;
  let boughtQty = 0;
  let buyCost = 0;
  let soldQty = 0;
  let sellProceeds = 0;
  let realisedGross = 0;
  let commissions = 0;
  let otherFees = 0;
  let firstEntry: FirstEntry | null = null;
  const realisations: Realisation[] = [];

  for (const e of [...executions].sort(compareExecutions)) {
    commissions += e.commission;
    otherFees += e.otherFees;
    const value = notional(e.quantity, e.price);

    if (e.side === 'BUY') {
      firstEntry ??= { price: e.price, quantity: e.quantity, executedAt: e.executedAt };
      boughtQty += e.quantity;
      buyCost += value;
      openQty += e.quantity;
      openCost += value;
      continue;
    }

    if (e.quantity > openQty) {
      throw new RangeError(`Execution ${e.id}: sell of ${e.quantity} exceeds position ${openQty}`);
    }
    // Remove cost at the current average; the final sell takes the exact remainder so
    // Σ realised always equals proceeds − cost with no rounding residue.
    const removed = e.quantity === openQty ? openCost : mulDiv(openCost, e.quantity, openQty);
    openCost -= removed;
    openQty -= e.quantity;
    soldQty += e.quantity;
    sellProceeds += value;
    realisedGross += value - removed;
    realisations.push({
      executionId: e.id,
      executedAt: e.executedAt,
      quantity: e.quantity,
      price: e.price,
      costBasisRemoved: removed,
      realisedGross: value - removed,
    });
  }

  // A sell can't come before the first buy (it would exceed the zero position), so this holds.
  const entry = firstEntry as FirstEntry;
  const fees = commissions + otherFees;
  const closed = openQty === 0;
  const grossPnl = closed ? sellProceeds - buyCost : null;
  const netPnl = grossPnl === null ? null : grossPnl - fees;

  return {
    status: closed ? 'CLOSED' : 'OPEN',
    boughtQty,
    soldQty,
    openQty,
    buyCost,
    sellProceeds,
    avgEntry: perShare(buyCost, boughtQty),
    avgExit: soldQty > 0 ? perShare(sellProceeds, soldQty) : null,
    openCostBasis: openCost,
    avgOpenCost: openQty > 0 ? perShare(openCost, openQty) : null,
    realisedGross,
    realisedNet: realisedGross - fees,
    commissions,
    otherFees,
    fees,
    grossPnl,
    netPnl,
    returnPct: netPnl === null ? null : netPnl / buyCost,
    firstEntry: entry,
    realisations,
  };
}

/** Calendar and trading days from first to last fill, using New York dates. */
export function holdingPeriod(fromIso: string, toIso: string): HoldingPeriod {
  const from = toNyDate(fromIso);
  const to = toNyDate(toIso);
  return { calendarDays: diffDays(from, to), tradingDays: tradingDaysBetween(from, to) };
}
