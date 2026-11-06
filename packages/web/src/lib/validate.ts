/**
 * Form parsing and validation. Pure functions: the forms render `errors` inline and
 * send `payload` (micros, UTC) to the API.
 */
import {
  formatQuantity,
  isValidTicker,
  notional,
  nyLocalToUtc,
  plannedRewardRisk,
  toMicros,
  toQuantity,
} from '@tj/core';

type Parsed<T> = { value: T | null } | { error: string };

export function parseMoneyInput(input: string): Parsed<number> {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (s === '') return { value: null };
  try {
    return { value: toMicros(s) };
  } catch {
    return { error: 'Enter a number' };
  }
}

/** Shares, whole or fractional (up to 6 decimals), to micro-shares. */
export function parseSharesInput(input: string): Parsed<number> {
  const s = input.trim().replace(/,/g, '');
  if (s === '') return { value: null };
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return { error: 'Enter a number' };
  if ((s.split('.')[1] ?? '').length > 6) return { error: 'At most 6 decimals' };
  const q = toQuantity(s);
  return q > 0 ? { value: q } : { error: 'Must be more than 0' };
}

function toUtc(date: string, time: string): Parsed<string> {
  if (!date) return { error: 'Required' };
  if (!time) return { error: 'Required' };
  try {
    return { value: nyLocalToUtc(date, time.length === 5 ? time : time.slice(0, 8)) };
  } catch {
    return { error: 'Invalid date or time' };
  }
}

type Errors<K extends string> = Partial<Record<K, string>>;

/** Collects field errors; returns the parsed value or null. */
function take<K extends string, T>(
  errors: Errors<K>,
  key: K,
  p: Parsed<T>,
  required = false,
): T | null {
  if ('error' in p) {
    errors[key] = p.error;
    return null;
  }
  if (required && p.value === null) errors[key] = 'Required';
  return p.value;
}

export interface NewTradeValues {
  symbol: string;
  date: string;
  time: string;
  shares: string;
  price: string;
  commission: string;
  initialStop: string;
  target: string;
}
type NewTradeField = keyof NewTradeValues;

export interface NewTradePayload {
  symbol: string;
  fill: {
    quantity: number;
    price: number;
    commission: number;
    otherFees: number;
    executedAt: string;
  };
  initialStop: number | null;
  target: number | null;
}

export function validateNewTrade(v: NewTradeValues): {
  errors: Errors<NewTradeField>;
  payload: NewTradePayload | null;
  preview: { risk: number | null; rewardRisk: number | null };
} {
  const errors: Errors<NewTradeField> = {};
  const symbol = v.symbol.trim();
  if (!symbol) errors.symbol = 'Required';
  else if (!isValidTicker(symbol)) errors.symbol = 'Use an uppercase ticker like AAPL or BRK.B';
  const executedAt = take(errors, 'time', toUtc(v.date, v.time), true);
  if (!v.date) errors.date = 'Required';
  const quantity = take(errors, 'shares', parseSharesInput(v.shares), true);
  const price = take(errors, 'price', parseMoneyInput(v.price), true);
  if (price !== null && price <= 0) errors.price = 'Must be positive';
  const commission = take(errors, 'commission', parseMoneyInput(v.commission)) ?? 0;
  if (commission < 0) errors.commission = 'Cannot be negative';
  const initialStop = take(errors, 'initialStop', parseMoneyInput(v.initialStop));
  const target = take(errors, 'target', parseMoneyInput(v.target));
  if (initialStop !== null && initialStop <= 0) errors.initialStop = 'Must be positive';
  if (initialStop !== null && price !== null && initialStop >= price) {
    errors.initialStop = 'Stop must be below the entry price';
  }
  if (target !== null && price !== null && target <= price) {
    errors.target = 'Target must be above the entry price';
  }

  const riskOk = price !== null && initialStop !== null && initialStop < price && quantity !== null;
  const preview = {
    risk: riskOk ? notional(quantity, price - initialStop) : null,
    rewardRisk: price !== null ? plannedRewardRisk(price, initialStop, target) : null,
  };

  const valid = Object.keys(errors).length === 0;
  return {
    errors,
    preview,
    payload:
      valid && executedAt !== null && quantity !== null && price !== null
        ? {
            symbol,
            fill: { quantity, price, commission, otherFees: 0, executedAt },
            initialStop,
            target,
          }
        : null,
  };
}

export interface FillValues {
  side: 'BUY' | 'SELL';
  date: string;
  time: string;
  shares: string;
  price: string;
  commission: string;
}
type FillField = keyof FillValues;

export interface FillPayload {
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  commission: number;
  otherFees: number;
  executedAt: string;
}

export function validateFill(
  v: FillValues,
  openQty: number,
): { errors: Errors<FillField>; payload: FillPayload | null } {
  const errors: Errors<FillField> = {};
  const executedAt = take(errors, 'time', toUtc(v.date, v.time), true);
  if (!v.date) errors.date = 'Required';
  const quantity = take(errors, 'shares', parseSharesInput(v.shares), true);
  if (quantity !== null && v.side === 'SELL' && quantity > openQty) {
    errors.shares = `Only ${formatQuantity(openQty)} shares are open`;
  }
  const price = take(errors, 'price', parseMoneyInput(v.price), true);
  if (price !== null && price <= 0) errors.price = 'Must be positive';
  const commission = take(errors, 'commission', parseMoneyInput(v.commission)) ?? 0;
  if (commission < 0) errors.commission = 'Cannot be negative';
  const valid = Object.keys(errors).length === 0;
  return {
    errors,
    payload:
      valid && executedAt !== null && quantity !== null && price !== null
        ? { side: v.side, quantity, price, commission, otherFees: 0, executedAt }
        : null,
  };
}
