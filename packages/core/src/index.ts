/**
 * @tj/core — pure domain logic (grouping, P&L, R, metrics, equity curves).
 * No I/O, no framework dependencies. Filled in during Phase 1.
 */

export const APP_NAME = 'Swing Trade Journal';

export type HealthStatus = {
  status: 'ok';
  app: string;
  time: string;
};

export function healthStatus(now: Date = new Date()): HealthStatus {
  return { status: 'ok', app: APP_NAME, time: now.toISOString() };
}
