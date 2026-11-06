/** Trade charts, MAE/MFE and open positions on top of the candle cache. */
import { addDays, detectSplits, notional, nyDateOf, type IsoDate } from '@tj/core';
import type { DbOrTx } from '../db/client';
import { tradeExcursions } from '../market/excursions';
import type { MarketData } from '../market/market-data';
import { DAYS_AFTER, DAYS_BEFORE } from '../market/sync';
import { getDashboard } from './dashboard';
import { getTradeDetail, listTrades } from './trades';

const min = (a: IsoDate, b: IsoDate) => (a < b ? a : b);

const notes: Record<string, string> = {
  'not-configured': 'Market data is not configured (set MARKET_DATA_API_KEY in .env).',
  'rate-limited':
    'Market-data rate limit reached; showing cached prices. More are fetched in the background.',
  'not-found': 'The data provider has no prices for this symbol.',
  auth: 'The market-data provider rejected the API key.',
  network: 'The market-data provider could not be reached; showing cached prices.',
  'bad-response': 'The market-data provider returned an unexpected response.',
};

export async function getTradeChart(db: DbOrTx, md: MarketData, id: number) {
  const t = getTradeDetail(db, id);
  const last = md.lastCompleteDay();
  const from = addDays(nyDateOf(t.openedAt), -DAYS_BEFORE);
  const to = t.closedAt ? min(addDays(nyDateOf(t.closedAt), DAYS_AFTER), last) : last;
  const ensured = await md.ensure(t.symbol, from, to);
  const bars = md.candles(t.symbol, from, to);
  const ownFrom = nyDateOf(t.openedAt);
  const ownTo = t.closedAt ? nyDateOf(t.closedAt) : to;
  return {
    symbol: t.symbol,
    status: t.status,
    from,
    to,
    complete: ensured.complete,
    note: ensured.error ? (notes[ensured.error.kind] ?? ensured.error.message) : null,
    candles: bars.map(({ date, open, high, low, close, volume }) => ({
      date,
      open,
      high,
      low,
      close,
      volume,
    })),
    markers: t.executions.map((e) => ({
      date: nyDateOf(e.executedAt),
      side: e.side,
      price: e.price,
      quantity: e.quantity,
    })),
    levels: {
      initialStop: t.journal.initialStop,
      currentStop: t.currentStop,
      target: t.journal.target,
      avgEntry: t.avgEntry,
    },
    excursions: tradeExcursions(bars, t),
    splits: detectSplits(
      bars
        .filter((b) => b.date >= ownFrom && b.date <= ownTo)
        .map((b) => ({ date: b.date, close: b.close, splitFactor: b.splitFactor })),
    ),
  };
}

export async function getPositions(db: DbOrTx, md: MarketData) {
  const asOf = md.lastCompleteDay();
  const open = listTrades(db, { status: 'OPEN' }).trades;
  let note: string | null = null;
  const positions = [];
  for (const item of open) {
    const t = getTradeDetail(db, item.id);
    const r = await md.ensure(t.symbol, addDays(asOf, -10), asOf);
    if (r.error && !note) note = notes[r.error.kind] ?? r.error.message;
    const bar = md.lastBar(t.symbol, asOf);
    const shares = t.openQty ?? 0;
    const lastClose = bar?.close ?? null;
    const marketValue = lastClose === null ? null : notional(shares, lastClose);
    const unrealised = marketValue === null ? null : marketValue - (t.openCostBasis ?? 0);
    const stop = t.currentStop;
    const openRisk =
      lastClose === null || stop === null ? null : notional(shares, lastClose - stop);
    const risk = t.initialRisk;
    const sinceOpen = md.candles(t.symbol, nyDateOf(t.openedAt), asOf);
    positions.push({
      tradeId: t.id,
      symbol: t.symbol,
      openedAt: t.openedAt,
      shares,
      avgCost: t.avgOpenCost,
      lastClose,
      lastCloseDate: bar?.date ?? null,
      marketValue,
      unrealised,
      unrealisedPct: unrealised === null || !t.openCostBasis ? null : unrealised / t.openCostBasis,
      unrealisedR: unrealised === null || !risk ? null : unrealised / risk,
      initialRisk: risk,
      currentStop: stop,
      stopDistancePct: lastClose === null || stop === null ? null : (lastClose - stop) / lastClose,
      stopDistanceR: openRisk === null || !risk ? null : openRisk / risk,
      openRisk,
      realisedNet: t.realisedNet,
      splits: detectSplits(
        sinceOpen.map((b) => ({ date: b.date, close: b.close, splitFactor: b.splitFactor })),
      ),
    });
  }
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
  const realisedEquity = getDashboard(db, {}, md).equity.at(-1)?.equity ?? 0;
  const unrealised = sum(positions.map((p) => p.unrealised));
  const openRisk = sum(positions.map((p) => p.openRisk));
  const equity = realisedEquity + unrealised;
  return {
    asOf,
    note,
    positions,
    totals: {
      marketValue: sum(positions.map((p) => p.marketValue)),
      unrealised,
      openRisk,
      equity,
      openRiskPctOfEquity: equity > 0 ? openRisk / equity : null,
      unpriced: positions.filter((p) => p.lastClose === null).length,
    },
  };
}
