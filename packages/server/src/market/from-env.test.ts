import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client';
import { marketDataFromEnv } from './from-env';

const db = () => openDatabase(':memory:').db;

describe('marketDataFromEnv', () => {
  it('uses Tiingo when a key is set', () => {
    expect(marketDataFromEnv(db(), { MARKET_DATA_API_KEY: 'k' }).provider?.name).toBe('tiingo');
  });

  it('has no provider without a key', () => {
    expect(marketDataFromEnv(db(), {}).configured).toBe(false);
    expect(marketDataFromEnv(db(), { MARKET_DATA_PROVIDER: 'tiingo' }).configured).toBe(false);
  });

  it('can be forced to the offline synthetic provider or to none, whatever the key', () => {
    expect(
      marketDataFromEnv(db(), { MARKET_DATA_PROVIDER: 'synthetic', MARKET_DATA_API_KEY: 'k' })
        .provider?.name,
    ).toBe('synthetic');
    expect(
      marketDataFromEnv(db(), { MARKET_DATA_PROVIDER: 'none', MARKET_DATA_API_KEY: 'k' })
        .configured,
    ).toBe(false);
  });

  it('rejects an unknown provider', () => {
    expect(() => marketDataFromEnv(db(), { MARKET_DATA_PROVIDER: 'google' })).toThrow(
      /Unknown MARKET_DATA_PROVIDER/,
    );
  });
});
