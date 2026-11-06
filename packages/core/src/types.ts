import type { Micros } from './money';

export type Side = 'BUY' | 'SELL';
/** v1 is long-only; the field exists so shorts can be added later. */
export type Direction = 'LONG';
export type TradeStatus = 'OPEN' | 'CLOSED';

export interface Execution {
  /** Database id; also defines insertion order for tie-breaking. */
  id: number;
  symbol: string;
  side: Side;
  /** Micro-shares (1 share = 1_000_000), positive. Fractional shares are allowed. */
  quantity: number;
  /** Fill price in micros. */
  price: Micros;
  /** Commission paid, as a non-negative cost in micros (importers normalise broker signs). */
  commission: Micros;
  /** Other fees (regulatory, exchange…), non-negative cost in micros. */
  otherFees: Micros;
  /** UTC ISO-8601 timestamp. */
  executedAt: string;
  /** Broker execution id (e.g. IB exec ID), when known. */
  externalId?: string | null;
}

export interface GroupedTrade {
  /** Id of the trade's first execution; journal data hangs off this key. */
  stableKey: number;
  symbol: string;
  direction: Direction;
  status: TradeStatus;
  openedAt: string;
  closedAt: string | null;
  /** Executions in processing order. */
  executions: Execution[];
}

export type GroupingError =
  | {
      code: 'SELL_EXCEEDS_POSITION';
      executionId: number;
      symbol: string;
      executedAt: string;
      positionBefore: number;
      sellQuantity: number;
      message: string;
    }
  | {
      code: 'INVALID_EXECUTION';
      executionId: number;
      symbol: string;
      message: string;
    };

export interface GroupingResult {
  trades: GroupedTrade[];
  /** Executions listed here were NOT applied. Callers must refuse to commit while errors exist. */
  errors: GroupingError[];
}

export interface HoldingPeriod {
  calendarDays: number;
  tradingDays: number;
}
