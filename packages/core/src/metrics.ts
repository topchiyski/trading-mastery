import { parseTimestamp } from './dates';
import type { EquityPoint } from './equity';
import type { Micros } from './money';
import { classifyOutcome, outcomeStats, type OutcomeStats } from './outcome';
import type { HoldingPeriod } from './types';

const TRADING_DAYS_PER_YEAR = 252;

/** One closed trade, as needed by the portfolio metrics. */
export interface MetricsTrade {
  stableKey: number;
  netPnl: Micros;
  fees: Micros;
  rMultiple: number | null;
  closedAt: string;
  holding: HoldingPeriod;
}

export interface PortfolioMetrics extends OutcomeStats {
  payoffRatio: number | null;
  profitFactor: number | null;
  largestWin: Micros | null;
  largestLoss: Micros | null;
  longestWinStreak: number;
  longestLossStreak: number;
  avgHoldingWinners: HoldingPeriod | null;
  avgHoldingLosers: HoldingPeriod | null;
  totalFees: Micros;
  /** Deepest fall of cumulative performance $ from its peak; ≤ 0. Needs equity. */
  maxDrawdown: Micros | null;
  /** Deepest fall of the TWR index from its peak; ≤ 0. Needs equity. */
  maxDrawdownPct: number | null;
  sharpe: number | null;
  sortino: number | null;
}

export interface MetricsOptions {
  breakEvenThreshold?: Micros;
  /** Daily equity series for the drawdown and Sharpe/Sortino metrics. */
  equity?: readonly EquityPoint[];
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function averageHolding(trades: readonly MetricsTrade[]): HoldingPeriod | null {
  if (trades.length === 0) return null;
  return {
    calendarDays: mean(trades.map((t) => t.holding.calendarDays)),
    tradingDays: mean(trades.map((t) => t.holding.tradingDays)),
  };
}

/** Annualised Sharpe ratio of daily returns (risk-free rate 0, sample stdev). */
export function sharpeRatio(dailyReturns: readonly number[]): number | null {
  if (dailyReturns.length < 2) return null;
  const m = mean(dailyReturns);
  const variance =
    dailyReturns.reduce((acc, r) => acc + (r - m) ** 2, 0) / (dailyReturns.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? (m / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR) : null;
}

/** Annualised Sortino ratio: mean ÷ downside deviation (target 0, over all days). */
export function sortinoRatio(dailyReturns: readonly number[]): number | null {
  if (dailyReturns.length === 0) return null;
  const downside = Math.sqrt(
    dailyReturns.reduce((acc, r) => acc + Math.min(r, 0) ** 2, 0) / dailyReturns.length,
  );
  return downside > 0 ? (mean(dailyReturns) / downside) * Math.sqrt(TRADING_DAYS_PER_YEAR) : null;
}

export function computePortfolioMetrics(
  trades: readonly MetricsTrade[],
  opts: MetricsOptions = {},
): PortfolioMetrics {
  const threshold = opts.breakEvenThreshold;
  const base = outcomeStats(trades, threshold);
  const ordered = [...trades].sort(
    (a, b) => parseTimestamp(a.closedAt) - parseTimestamp(b.closedAt) || a.stableKey - b.stableKey,
  );

  const winners: MetricsTrade[] = [];
  const losers: MetricsTrade[] = [];
  let winStreak = 0;
  let lossStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  for (const tr of ordered) {
    const outcome = classifyOutcome(tr.netPnl, threshold);
    if (outcome === 'WIN') {
      winners.push(tr);
      winStreak++;
      lossStreak = 0;
    } else if (outcome === 'LOSS') {
      losers.push(tr);
      lossStreak++;
      winStreak = 0;
    } // break-evens neither extend nor break a streak
    longestWinStreak = Math.max(longestWinStreak, winStreak);
    longestLossStreak = Math.max(longestLossStreak, lossStreak);
  }

  const equity = opts.equity ?? [];
  const returns = equity.map((p) => p.dailyReturn);

  return {
    ...base,
    payoffRatio:
      base.avgWin !== null && base.avgLoss !== null && base.avgLoss < 0
        ? base.avgWin / -base.avgLoss
        : null,
    profitFactor: base.grossLosses < 0 ? base.grossWins / -base.grossLosses : null,
    largestWin: winners.length ? Math.max(...winners.map((x) => x.netPnl)) : null,
    largestLoss: losers.length ? Math.min(...losers.map((x) => x.netPnl)) : null,
    longestWinStreak,
    longestLossStreak,
    avgHoldingWinners: averageHolding(winners),
    avgHoldingLosers: averageHolding(losers),
    totalFees: trades.reduce((acc, x) => acc + x.fees, 0),
    maxDrawdown: equity.length ? Math.min(...equity.map((p) => p.performanceDrawdown)) : null,
    maxDrawdownPct: equity.length ? Math.min(...equity.map((p) => p.twrDrawdownPct)) : null,
    sharpe: sharpeRatio(returns),
    sortino: sortinoRatio(returns),
  };
}

export interface MetricDefinition {
  label: string;
  definition: string;
}

/** Tooltip text for every metric in PortfolioMetrics. */
export const METRIC_DEFINITIONS: Record<keyof PortfolioMetrics, MetricDefinition> = {
  count: { label: 'Trades', definition: 'Number of closed trades in the current filter.' },
  wins: {
    label: 'Wins',
    definition: 'Closed trades whose net P&L is at or above the break-even threshold.',
  },
  losses: {
    label: 'Losses',
    definition: 'Closed trades whose net P&L is at or below minus the break-even threshold.',
  },
  breakEvens: {
    label: 'Break-even',
    definition:
      'Trades whose |net P&L| is below the break-even threshold. Not counted as wins or losses.',
  },
  winRate: {
    label: 'Win rate',
    definition: 'Wins ÷ (wins + losses). Break-even trades are excluded.',
  },
  totalNetPnl: {
    label: 'Net P&L',
    definition: 'Sum of net P&L (after commissions and fees) of all closed trades.',
  },
  grossWins: { label: 'Gross wins', definition: 'Sum of net P&L of winning trades.' },
  grossLosses: { label: 'Gross losses', definition: 'Sum of net P&L of losing trades (negative).' },
  avgWin: { label: 'Average win', definition: 'Gross wins ÷ number of wins.' },
  avgLoss: { label: 'Average loss', definition: 'Gross losses ÷ number of losses (negative).' },
  expectancy: {
    label: 'Expectancy ($)',
    definition: 'Average net P&L per closed trade, break-evens included.',
  },
  expectancyR: {
    label: 'Expectancy (R)',
    definition: 'Average R-multiple per trade, over trades with an initial stop or planned risk.',
  },
  rTradeCount: {
    label: 'Trades with R',
    definition: 'Trades that have an initial risk and are included in R statistics.',
  },
  rExcludedCount: {
    label: 'Excluded from R',
    definition: 'Trades without an initial stop or planned risk; left out of every R statistic.',
  },
  payoffRatio: {
    label: 'Payoff ratio',
    definition: 'Average win ÷ |average loss|. Empty when there are no losses.',
  },
  profitFactor: {
    label: 'Profit factor',
    definition:
      'Gross wins ÷ |gross losses|. Above 1 means profitable. Empty when there are no losses.',
  },
  largestWin: { label: 'Largest win', definition: 'Highest net P&L of a single winning trade.' },
  largestLoss: { label: 'Largest loss', definition: 'Lowest net P&L of a single losing trade.' },
  longestWinStreak: {
    label: 'Longest win streak',
    definition:
      'Most consecutive wins in close order. Break-even trades neither extend nor break a streak.',
  },
  longestLossStreak: {
    label: 'Longest loss streak',
    definition:
      'Most consecutive losses in close order. Break-even trades neither extend nor break a streak.',
  },
  avgHoldingWinners: {
    label: 'Avg hold (winners)',
    definition:
      'Average calendar and trading days from first to last fill (New York dates) for winning trades.',
  },
  avgHoldingLosers: {
    label: 'Avg hold (losers)',
    definition:
      'Average calendar and trading days from first to last fill (New York dates) for losing trades.',
  },
  totalFees: {
    label: 'Total fees',
    definition: 'Sum of commissions and other fees on all closed trades.',
  },
  maxDrawdown: {
    label: 'Max drawdown ($)',
    definition:
      'Largest fall of cumulative performance (realised P&L + dividends, interest and fees) from its previous peak. Deposits and withdrawals are ignored.',
  },
  maxDrawdownPct: {
    label: 'Max drawdown (%)',
    definition: 'Largest fall of the time-weighted return index from its previous peak.',
  },
  sharpe: {
    label: 'Sharpe ratio',
    definition:
      'Mean daily time-weighted return ÷ its standard deviation, × √252. Risk-free rate assumed 0.',
  },
  sortino: {
    label: 'Sortino ratio',
    definition:
      'Mean daily time-weighted return ÷ downside deviation (only negative days count as risk), × √252.',
  },
};
