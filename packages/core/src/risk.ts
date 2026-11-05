import { mulDiv, type Micros } from './money';

export interface RiskPlan {
  initialStop?: Micros | null;
  /** Explicit planned risk in $ for trades scaled in on purpose; wins over the stop-based figure. */
  plannedRiskOverride?: Micros | null;
  target?: Micros | null;
}

/**
 * Initial risk in micros = (first entry price − initial stop) × first entry quantity,
 * or the planned-risk override when set. Null when no valid risk can be derived
 * (no stop, or stop not below entry); such trades are excluded from R statistics.
 */
export function initialRisk(
  firstEntry: { price: Micros; quantity: number },
  plan: RiskPlan,
): Micros | null {
  const override = plan.plannedRiskOverride ?? null;
  if (override !== null && override > 0) return override;
  const stop = plan.initialStop ?? null;
  if (stop === null) return null;
  const perShare = firstEntry.price - stop;
  if (perShare <= 0) return null;
  return mulDiv(perShare, firstEntry.quantity, 1);
}

/** R-multiple = net P&L ÷ initial risk. */
export function rMultiple(netPnl: Micros | null, risk: Micros | null): number | null {
  if (netPnl === null || risk === null) return null;
  return netPnl / risk;
}

/** Planned reward:risk = (target − entry) ÷ (entry − stop). */
export function plannedRewardRisk(
  entry: Micros,
  stop: Micros | null,
  target: Micros | null,
): number | null {
  if (stop === null || target === null || entry - stop <= 0) return null;
  return (target - entry) / (entry - stop);
}
