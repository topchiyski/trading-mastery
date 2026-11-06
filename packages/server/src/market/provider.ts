import type { IsoDate, Micros } from '@tj/core';

/** One daily bar as delivered by a provider (raw, unadjusted OHLC in micros). */
export interface ProviderBar {
  date: IsoDate;
  open: Micros;
  high: Micros;
  low: Micros;
  close: Micros;
  /** Split- and dividend-adjusted close, if the provider has it. */
  adjClose: Micros | null;
  volume: number;
  /** Split factor effective on this date (1 or null = none). */
  splitFactor: number | null;
}

export interface MarketDataProvider {
  readonly name: string;
  /** Daily bars for [from, to] (inclusive, NY dates). Empty when the symbol didn't trade. */
  getDailyCandles(symbol: string, from: IsoDate, to: IsoDate): Promise<ProviderBar[]>;
}

export type ProviderErrorKind = 'not-found' | 'rate-limited' | 'auth' | 'network' | 'bad-response';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
