/**
 * @tj/core — pure domain logic (grouping, P&L, R, metrics, equity curves).
 * No I/O, no framework dependencies.
 */

export * from './breakdown';
export * from './dates';
export * from './drawdown';
export * from './equity';
export * from './grouping';
export * from './metrics';
export * from './money';
export * from './outcome';
export * from './risk';
export * from './summary';
export * from './trade-stats';
export * from './types';

export const APP_NAME = 'Swing Trade Journal';

export type HealthStatus = {
  status: 'ok';
  app: string;
  time: string;
};

export function healthStatus(now: Date = new Date()): HealthStatus {
  return { status: 'ok', app: APP_NAME, time: now.toISOString() };
}
export * from './quantity';
export * from './csv';
export * from './histogram';
export * from './market';
