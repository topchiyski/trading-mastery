import { mulDiv, type Micros } from './money';

export type Outcome = 'WIN' | 'LOSS' | 'BREAKEVEN';

/** |net P&L| below this counts as break-even (default $1, configurable in settings). */
export const DEFAULT_BREAK_EVEN_THRESHOLD: Micros = 1_000_000;

export function classifyOutcome(
  netPnl: Micros,
  threshold: Micros = DEFAULT_BREAK_EVEN_THRESHOLD,
): Outcome {
  if (Math.abs(netPnl) < threshold) return 'BREAKEVEN';
  return netPnl > 0 ? 'WIN' : 'LOSS';
}

export interface OutcomeInput {
  netPnl: Micros;
  /** Null when the trade has no initial risk (excluded from R statistics). */
  rMultiple: number | null;
}

export interface OutcomeStats {
  count: number;
  wins: number;
  losses: number;
  breakEvens: number;
  /** wins ÷ (wins + losses); break-evens are excluded. */
  winRate: number | null;
  totalNetPnl: Micros;
  /** Σ net P&L of winners. */
  grossWins: Micros;
  /** Σ net P&L of losers (≤ 0). */
  grossLosses: Micros;
  avgWin: Micros | null;
  /** ≤ 0. */
  avgLoss: Micros | null;
  /** Average net P&L per trade, break-evens included. */
  expectancy: Micros | null;
  /** Average R over trades that have an initial risk. */
  expectancyR: number | null;
  rTradeCount: number;
  rExcludedCount: number;
}

export function outcomeStats(
  trades: readonly OutcomeInput[],
  threshold: Micros = DEFAULT_BREAK_EVEN_THRESHOLD,
): OutcomeStats {
  let wins = 0;
  let losses = 0;
  let breakEvens = 0;
  let totalNetPnl = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let rSum = 0;
  let rTradeCount = 0;

  for (const t of trades) {
    totalNetPnl += t.netPnl;
    const outcome = classifyOutcome(t.netPnl, threshold);
    if (outcome === 'WIN') {
      wins++;
      grossWins += t.netPnl;
    } else if (outcome === 'LOSS') {
      losses++;
      grossLosses += t.netPnl;
    } else {
      breakEvens++;
    }
    if (t.rMultiple !== null) {
      rSum += t.rMultiple;
      rTradeCount++;
    }
  }

  const count = trades.length;
  return {
    count,
    wins,
    losses,
    breakEvens,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    totalNetPnl,
    grossWins,
    grossLosses,
    avgWin: wins > 0 ? mulDiv(grossWins, 1, wins) : null,
    avgLoss: losses > 0 ? mulDiv(grossLosses, 1, losses) : null,
    expectancy: count > 0 ? mulDiv(totalNetPnl, 1, count) : null,
    expectancyR: rTradeCount > 0 ? rSum / rTradeCount : null,
    rTradeCount,
    rExcludedCount: count - rTradeCount,
  };
}
