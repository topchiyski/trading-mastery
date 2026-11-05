import type { Micros } from './money';
import { initialRisk, plannedRewardRisk, rMultiple, type RiskPlan } from './risk';
import { computeTradeStats, holdingPeriod, type TradeStats } from './trade-stats';
import type { Direction, GroupedTrade, HoldingPeriod, TradeStatus } from './types';

export interface TradeSummary {
  stableKey: number;
  symbol: string;
  direction: Direction;
  status: TradeStatus;
  openedAt: string;
  closedAt: string | null;
  stats: TradeStats;
  /** Closed trades only. */
  netPnl: Micros | null;
  initialRisk: Micros | null;
  rMultiple: number | null;
  plannedRewardRisk: number | null;
  holding: HoldingPeriod;
}

/**
 * Everything derived for one trade. Open trades are measured up to `asOf`
 * (a timestamp; default: the last fill).
 */
export function summarizeTrade(
  trade: GroupedTrade,
  plan: RiskPlan = {},
  asOf?: string,
): TradeSummary {
  const stats = computeTradeStats(trade.executions);
  const risk = initialRisk(stats.firstEntry, plan);
  const lastFill = trade.executions[trade.executions.length - 1]?.executedAt ?? trade.openedAt;
  return {
    stableKey: trade.stableKey,
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.status,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    stats,
    netPnl: stats.netPnl,
    initialRisk: risk,
    rMultiple: rMultiple(stats.netPnl, risk),
    plannedRewardRisk: plannedRewardRisk(
      stats.firstEntry.price,
      plan.initialStop ?? null,
      plan.target ?? null,
    ),
    holding: holdingPeriod(trade.openedAt, trade.closedAt ?? asOf ?? lastFill),
  };
}
