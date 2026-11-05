import {
  nextTradingDay,
  nyDateOf,
  parseTimestamp,
  tradingDaysInRange,
  type IsoDate,
} from './dates';
import type { Micros } from './money';

export type CashFlowType = 'DEPOSIT' | 'WITHDRAWAL' | 'DIVIDEND' | 'INTEREST' | 'FEE';

/** Deposits and withdrawals move money in/out of the account; they are not performance. */
export const EXTERNAL_FLOW_TYPES: ReadonlySet<CashFlowType> = new Set(['DEPOSIT', 'WITHDRAWAL']);

export interface CashFlow {
  type: CashFlowType;
  /** Signed: deposits/dividends/interest positive, withdrawals/fees negative. */
  amount: Micros;
  /** Timestamp or plain NY date. */
  occurredAt: string;
}

export interface EquityInput {
  startingBalance: Micros;
  startDate: IsoDate;
  endDate: IsoDate;
  cashFlows: readonly CashFlow[];
  closedTrades: readonly { netPnl: Micros; closedAt: string }[];
}

export interface EquityPoint {
  date: IsoDate;
  /** starting balance + cumulative cash flows + cumulative realised net P&L. */
  equity: Micros;
  /** Deposits/withdrawals on this day. */
  externalFlow: Micros;
  externalFlowsCum: Micros;
  /** Cumulative dividends + interest + non-trade fees. */
  incomeCum: Micros;
  realisedPnlCum: Micros;
  /** realisedPnlCum + incomeCum: money made, independent of deposits/withdrawals. */
  performanceCum: Micros;
  /** (equity − today's external flow − yesterday's equity) ÷ yesterday's equity. */
  dailyReturn: number;
  /** Time-weighted return index, starts at 1 before the first day. */
  twrIndex: number;
  /** performanceCum − its running peak (peak starts at 0); ≤ 0. */
  performanceDrawdown: Micros;
  /** twrIndex ÷ its running peak (starting at 1) − 1; ≤ 0. */
  twrDrawdownPct: number;
}

/**
 * Daily equity curve over NYSE trading days in [startDate, endDate].
 * Events are bucketed by New York date; events on non-trading days roll forward to the
 * next trading day, events before the start land on the first day, events after the end
 * are dropped. External flows are assumed to arrive at the end of the day.
 */
export function buildEquitySeries(input: EquityInput): EquityPoint[] {
  const days = tradingDaysInRange(input.startDate, input.endDate);
  if (days.length === 0) return [];
  const index = new Map(days.map((d, i) => [d, i]));
  const external = new Array<number>(days.length).fill(0);
  const income = new Array<number>(days.length).fill(0);
  const pnl = new Array<number>(days.length).fill(0);

  const bucket = (when: string): number => {
    const d = nyDateOf(when);
    return index.get(nextTradingDay(d < input.startDate ? input.startDate : d)) ?? -1;
  };
  for (const cf of input.cashFlows) {
    const i = bucket(cf.occurredAt);
    if (i < 0) continue;
    if (EXTERNAL_FLOW_TYPES.has(cf.type)) external[i] = (external[i] ?? 0) + cf.amount;
    else income[i] = (income[i] ?? 0) + cf.amount;
  }
  for (const t of input.closedTrades) {
    const i = bucket(t.closedAt);
    if (i >= 0) pnl[i] = (pnl[i] ?? 0) + t.netPnl;
  }

  let prevEquity = input.startingBalance;
  let externalFlowsCum = 0;
  let incomeCum = 0;
  let realisedPnlCum = 0;
  let twrIndex = 1;
  let twrPeak = 1;
  let performancePeak = 0;

  return days.map((date, i) => {
    const externalFlow = external[i] ?? 0;
    externalFlowsCum += externalFlow;
    incomeCum += income[i] ?? 0;
    realisedPnlCum += pnl[i] ?? 0;
    const equity = input.startingBalance + externalFlowsCum + incomeCum + realisedPnlCum;
    const dailyReturn = prevEquity > 0 ? (equity - externalFlow - prevEquity) / prevEquity : 0;
    twrIndex *= 1 + dailyReturn;
    twrPeak = Math.max(twrPeak, twrIndex);
    const performanceCum = realisedPnlCum + incomeCum;
    performancePeak = Math.max(performancePeak, performanceCum);
    prevEquity = equity;
    return {
      date,
      equity,
      externalFlow,
      externalFlowsCum,
      incomeCum,
      realisedPnlCum,
      performanceCum,
      dailyReturn,
      twrIndex,
      performanceDrawdown: performanceCum - performancePeak,
      twrDrawdownPct: twrIndex / twrPeak - 1,
    };
  });
}

export interface RCurvePoint {
  stableKey: number;
  closedAt: string;
  rMultiple: number;
  cumR: number;
  /** cumR − running peak (peak starts at 0); ≤ 0. */
  drawdownR: number;
}

/** Cumulative-R curve in close order; trades without R are skipped and counted. */
export function cumulativeRCurve(
  trades: readonly { stableKey: number; closedAt: string; rMultiple: number | null }[],
): { points: RCurvePoint[]; excluded: number } {
  const withR = trades
    .filter((t): t is typeof t & { rMultiple: number } => t.rMultiple !== null)
    .sort(
      (a, b) =>
        parseTimestamp(a.closedAt) - parseTimestamp(b.closedAt) || a.stableKey - b.stableKey,
    );
  let cumR = 0;
  let peak = 0;
  const points = withR.map(({ stableKey, closedAt, rMultiple }) => {
    cumR += rMultiple;
    peak = Math.max(peak, cumR);
    return { stableKey, closedAt, rMultiple, cumR, drawdownR: cumR - peak };
  });
  return { points, excluded: trades.length - withR.length };
}
