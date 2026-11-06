/**
 * Everything the dashboard shows, computed by @tj/core from closed trades that match the
 * global filters (close date range, setup, tag, symbol).
 *
 * Equity curve: starting balance (Settings) + cash flows + realised net P&L, from the
 * settings start date (or the first event). With a date range the curve starts at the
 * balance on `from`. A setup/tag/symbol filter shows "starting balance + these trades"
 * and leaves cash flows out, since they don't belong to a subset of trades.
 */
import {
  WEEKDAY_ORDER,
  benchmarkIndex,
  breakdownBy,
  buildEquitySeries,
  computePortfolioMetrics,
  cumulativeRCurve,
  monthOf,
  nyDateOf,
  toNyDate,
  weekdayOfEntry,
  type CashFlow,
} from '@tj/core';
import type { DbOrTx } from '../db/client';
import { tradeExcursions } from '../market/excursions';
import type { MarketData } from '../market/market-data';
import { BENCHMARK } from '../market/sync';
import { listCashFlows } from './cash-flows';
import { getSettings } from './settings';
import { listTrades, type TradeFilter, type TradeListItem } from './trades';

export interface DashboardFilter {
  from?: string | undefined;
  to?: string | undefined;
  setupTagId?: number | undefined;
  tagId?: number | undefined;
  symbol?: string | undefined;
}

type ClosedTrade = TradeListItem & { netPnl: number; closedAt: string };

export function getDashboard(db: DbOrTx, filter: DashboardFilter, md?: MarketData) {
  const settings = getSettings(db);
  const subset: TradeFilter = {
    status: 'CLOSED',
    setupTagId: filter.setupTagId,
    tagId: filter.tagId,
    symbol: filter.symbol,
  };
  const isSubset = !!(filter.setupTagId || filter.tagId || filter.symbol);
  const allClosed = listTrades(db, subset).trades.filter(
    (t): t is ClosedTrade => t.netPnl !== null && t.closedAt !== null,
  );
  const inRange = (day: string) =>
    (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to);
  const trades = allClosed
    .filter((t) => inRange(nyDateOf(t.closedAt)))
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt) || a.id - b.id);

  // --- equity curve
  const flows: CashFlow[] = isSubset
    ? []
    : listCashFlows(db).map((c) => ({ type: c.type, amount: c.amount, occurredAt: c.occurredAt }));
  const events = [
    ...flows.map((f) => nyDateOf(f.occurredAt)),
    ...allClosed.map((t) => nyDateOf(t.closedAt)),
  ].sort();
  const base = settings.startDate ?? events[0] ?? null;
  const end = filter.to ?? toNyDate(new Date().toISOString());
  let equity: ReturnType<typeof buildEquitySeries> = [];
  if (base) {
    const start = filter.from && filter.from > base ? filter.from : base;
    // Events between the base date and the range start make up the opening balance.
    const before = (day: string) => day >= base && day < start;
    const opening =
      settings.startingBalance +
      flows.filter((f) => before(nyDateOf(f.occurredAt))).reduce((a, f) => a + f.amount, 0) +
      allClosed.filter((t) => before(nyDateOf(t.closedAt))).reduce((a, t) => a + t.netPnl, 0);
    const from = (day: string) => day >= start;
    if (start <= end) {
      equity = buildEquitySeries({
        startingBalance: opening,
        startDate: start,
        endDate: end,
        cashFlows: flows.filter((f) => from(nyDateOf(f.occurredAt))),
        closedTrades: allClosed.filter((t) => from(nyDateOf(t.closedAt))),
      });
    }
  }

  // --- metrics and series
  const metricsTrades = trades.map((t) => ({
    stableKey: t.stableKey,
    netPnl: t.netPnl,
    fees: t.fees ?? 0,
    rMultiple: t.rMultiple,
    closedAt: t.closedAt,
    holding: t.holding ?? { calendarDays: 0, tradingDays: 0 },
  }));
  const opts = { breakEvenThreshold: settings.breakEvenThreshold };
  const metrics = computePortfolioMetrics(metricsTrades, { ...opts, equity });
  const rCurve = cumulativeRCurve(metricsTrades);

  const monthly = breakdownBy(trades, (t) => monthOf(t.closedAt), opts).map((r) => ({
    month: r.key,
    netPnl: r.totalNetPnl,
    count: r.count,
  }));

  const breakdowns = {
    setup: breakdownBy(trades, (t) => t.setupTag?.name ?? '(no setup)', opts),
    symbol: breakdownBy(trades, (t) => t.symbol, opts),
    weekday: breakdownBy(trades, (t) => weekdayOfEntry(t.openedAt), {
      ...opts,
      order: WEEKDAY_ORDER,
    }),
    month: breakdownBy(trades, (t) => monthOf(t.closedAt), opts),
    mistake: breakdownBy(
      trades,
      (t) => t.tags.filter((tag) => tag.kind === 'MISTAKE').map((tag) => tag.name),
      opts,
    ),
  };

  // --- market data (cached candles only; the dashboard never fetches)
  let benchmark: {
    symbol: string;
    points: { date: string; spy: number | null; portfolio: number }[];
  } | null = null;
  const first = equity[0];
  const lastPoint = equity.at(-1);
  if (md && first && lastPoint) {
    const spy = md.candles(BENCHMARK, first.date, lastPoint.date);
    if (spy.length > 0) {
      const prices = new Map(spy.map((b) => [b.date, b.adjClose ?? b.close]));
      const idx = benchmarkIndex(
        prices,
        equity.map((p) => p.date),
      );
      benchmark = {
        symbol: BENCHMARK,
        points: equity.map((p, i) => ({
          date: p.date,
          spy: idx[i]?.value ?? null,
          portfolio: p.twrIndex * 100,
        })),
      };
    }
  }

  return {
    range: { from: equity[0]?.date ?? null, to: equity.at(-1)?.date ?? null },
    includesCashFlows: !isSubset,
    startingBalance: settings.startingBalance,
    metrics,
    equity,
    rCurve,
    monthly,
    benchmark,
    trades: trades.map((t) => {
      const x = md
        ? tradeExcursions(md.candles(t.symbol, nyDateOf(t.openedAt), nyDateOf(t.closedAt)), t)
        : null;
      return {
        id: t.id,
        symbol: t.symbol,
        openedAt: t.openedAt,
        closedAt: t.closedAt,
        netPnl: t.netPnl,
        rMultiple: t.rMultiple,
        tradingDays: t.holding?.tradingDays ?? 0,
        calendarDays: t.holding?.calendarDays ?? 0,
        mae: x?.mae ?? null,
        mfe: x?.mfe ?? null,
      };
    }),
    breakdowns,
  };
}
export type Dashboard = ReturnType<typeof getDashboard>;
