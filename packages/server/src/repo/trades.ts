import {
  classifyOutcome,
  compareExecutions,
  nyDateOf,
  outcomeStats,
  summarizeTrade,
  type GroupedTrade,
  type Outcome,
  type TradeSummary,
} from '@tj/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import {
  executions,
  tags,
  tradeExecutions,
  trades,
  tradeTags,
  type ExecutionRow,
  type TradeRow,
} from '../db/schema';
import { conflict, invalid, notFound } from '../errors';
import { insertExecutionTx, toExecutionDto } from './executions';
import { listScreenshots } from './screenshots';
import { toCoreExecution } from './regroup';
import { getSettings } from './settings';
import { listStops } from './stops';
import type { TagDto } from './tags';

// ---------------------------------------------------------------------------
// Loading and shaping

interface TradeContext {
  row: TradeRow;
  executions: ExecutionRow[];
  tags: TagDto[];
  setupTag: TagDto | null;
}

function loadContexts(db: DbOrTx, rows: TradeRow[]): TradeContext[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const execsByTrade = new Map<number, ExecutionRow[]>();
  for (const { tradeId, e } of db
    .select({ tradeId: tradeExecutions.tradeId, e: executions })
    .from(tradeExecutions)
    .innerJoin(executions, eq(executions.id, tradeExecutions.executionId))
    .where(inArray(tradeExecutions.tradeId, ids))
    .all()) {
    execsByTrade.set(tradeId, [...(execsByTrade.get(tradeId) ?? []), e]);
  }
  const tagsByTrade = new Map<number, TagDto[]>();
  for (const { tradeId, tag } of db
    .select({ tradeId: tradeTags.tradeId, tag: tags })
    .from(tradeTags)
    .innerJoin(tags, eq(tags.id, tradeTags.tagId))
    .where(inArray(tradeTags.tradeId, ids))
    .orderBy(asc(tags.name))
    .all()) {
    tagsByTrade.set(tradeId, [...(tagsByTrade.get(tradeId) ?? []), tag]);
  }
  const tagById = new Map(
    db
      .select()
      .from(tags)
      .all()
      .map((t) => [t.id, t]),
  );
  return rows.map((row) => ({
    row,
    executions: (execsByTrade.get(row.id) ?? []).sort((a, b) =>
      compareExecutions(toCoreExecution(a), toCoreExecution(b)),
    ),
    tags: tagsByTrade.get(row.id) ?? [],
    setupTag: row.setupTagId === null ? null : (tagById.get(row.setupTagId) ?? null),
  }));
}

function summarize(ctx: TradeContext): TradeSummary | null {
  if (ctx.executions.length === 0) return null;
  const { row } = ctx;
  const grouped: GroupedTrade = {
    stableKey: row.stableKey,
    symbol: row.symbol,
    direction: row.direction,
    status: row.status,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    executions: ctx.executions.map(toCoreExecution),
  };
  const plan = {
    initialStop: row.initialStop,
    plannedRiskOverride: row.plannedRiskOverride,
    target: row.target,
  };
  // Open trades: days held so far.
  const asOf = row.status === 'OPEN' ? new Date().toISOString() : undefined;
  return summarizeTrade(grouped, plan, asOf);
}

function toListItem(ctx: TradeContext, summary: TradeSummary | null, breakEvenThreshold: number) {
  const { row } = ctx;
  const s = summary?.stats;
  const netPnl = summary?.netPnl ?? null;
  return {
    id: row.id,
    stableKey: row.stableKey,
    symbol: row.symbol,
    direction: row.direction,
    status: row.status,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    orphaned: row.orphanedAt !== null,
    orphanedAt: row.orphanedAt,
    setupTag: ctx.setupTag,
    tags: ctx.tags,
    /** Total shares bought (position size). */
    quantity: s?.boughtQty ?? null,
    openQty: s?.openQty ?? null,
    avgEntry: s?.avgEntry ?? null,
    avgExit: s?.avgExit ?? null,
    netPnl,
    realisedNet: s?.realisedNet ?? null,
    fees: s?.fees ?? null,
    returnPct: s?.returnPct ?? null,
    initialRisk: summary?.initialRisk ?? null,
    rMultiple: summary?.rMultiple ?? null,
    plannedRewardRisk: summary?.plannedRewardRisk ?? null,
    holding: summary?.holding ?? null,
    outcome: (netPnl === null
      ? null
      : classifyOutcome(netPnl, breakEvenThreshold)) as Outcome | null,
  };
}
export type TradeListItem = ReturnType<typeof toListItem>;

export function getTradeRow(db: DbOrTx, id: number): TradeRow {
  const row = db.select().from(trades).where(eq(trades.id, id)).get();
  if (!row) throw notFound('Trade', id);
  return row;
}

export function getTradeDetail(db: DbOrTx, id: number) {
  const row = getTradeRow(db, id);
  const [ctx] = loadContexts(db, [row]);
  if (!ctx) throw notFound('Trade', id);
  const summary = summarize(ctx);
  const s = summary?.stats;
  const stops = listStops(db, id);
  return {
    ...toListItem(ctx, summary, getSettings(db).breakEvenThreshold),
    executions: ctx.executions.map(toExecutionDto),
    realisations: s?.realisations ?? [],
    buyCost: s?.buyCost ?? null,
    sellProceeds: s?.sellProceeds ?? null,
    grossPnl: s?.grossPnl ?? null,
    commissions: s?.commissions ?? null,
    otherFees: s?.otherFees ?? null,
    openCostBasis: s?.openCostBasis ?? null,
    avgOpenCost: s?.avgOpenCost ?? null,
    journal: {
      initialStop: row.initialStop,
      plannedRiskOverride: row.plannedRiskOverride,
      target: row.target,
      thesis: row.thesis,
      review: row.review,
      emotion: row.emotion,
      executionRating: row.executionRating,
      followedPlan: row.followedPlan,
    },
    stops,
    /** Latest trailing stop, else the initial stop. */
    currentStop: stops.at(-1)?.stopPrice ?? row.initialStop,
    screenshots: listScreenshots(db, id),
  };
}
export type TradeDetail = ReturnType<typeof getTradeDetail>;

// ---------------------------------------------------------------------------
// Listing

export interface TradeFilter {
  status?: 'OPEN' | 'CLOSED' | undefined;
  symbol?: string | undefined;
  setupTagId?: number | undefined;
  tagId?: number | undefined;
  outcome?: Outcome | undefined;
  /** Inclusive NY dates, applied to the close date (open date for open trades). */
  from?: string | undefined;
  to?: string | undefined;
  orphaned?: 'exclude' | 'include' | 'only' | undefined;
}

export function listTrades(db: DbOrTx, filter: TradeFilter = {}) {
  const { breakEvenThreshold } = getSettings(db);
  const orphaned = filter.orphaned ?? 'exclude';
  const rows = db
    .select()
    .from(trades)
    .all()
    .filter(
      (r) =>
        (orphaned === 'include' || (orphaned === 'only') === (r.orphanedAt !== null)) &&
        (!filter.status || r.status === filter.status) &&
        (!filter.symbol || r.symbol === filter.symbol) &&
        (filter.setupTagId === undefined || r.setupTagId === filter.setupTagId),
    );

  const items = loadContexts(db, rows)
    .filter((ctx) => filter.tagId === undefined || ctx.tags.some((t) => t.id === filter.tagId))
    .map((ctx) => toListItem(ctx, summarize(ctx), breakEvenThreshold))
    .filter((item) => {
      if (filter.outcome && item.outcome !== filter.outcome) return false;
      const day = nyDateOf(item.closedAt ?? item.openedAt);
      return (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to);
    })
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : a.openedAt > b.openedAt ? -1 : b.id - a.id));

  const closed = items.filter((i): i is typeof i & { netPnl: number } => i.netPnl !== null);
  const stats = outcomeStats(closed, breakEvenThreshold);
  return {
    trades: items,
    totals: {
      count: items.length,
      closedCount: closed.length,
      openCount: items.filter((i) => i.status === 'OPEN' && !i.orphaned).length,
      netPnl: stats.totalNetPnl,
      fees: items.reduce((acc, i) => acc + (i.fees ?? 0), 0),
      wins: stats.wins,
      losses: stats.losses,
      breakEvens: stats.breakEvens,
      winRate: stats.winRate,
      expectancy: stats.expectancy,
      expectancyR: stats.expectancyR,
      rExcludedCount: stats.rExcludedCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Writing

export interface JournalPatch {
  initialStop?: number | null | undefined;
  plannedRiskOverride?: number | null | undefined;
  target?: number | null | undefined;
  setupTagId?: number | null | undefined;
  thesis?: string | null | undefined;
  review?: string | null | undefined;
  emotion?: string | null | undefined;
  executionRating?: number | null | undefined;
  followedPlan?: boolean | null | undefined;
}

export interface FillInput {
  quantity: number;
  price: number;
  commission: number;
  otherFees: number;
  executedAt: string;
}

function assertSetupTag(db: DbOrTx, tagId: number | null | undefined): void {
  if (tagId === null || tagId === undefined) return;
  const tag = db.select().from(tags).where(eq(tags.id, tagId)).get();
  if (!tag) throw invalid(`Unknown setup tag ${tagId}`);
  if (tag.kind !== 'SETUP') throw invalid(`Tag "${tag.name}" is a ${tag.kind} tag, not a setup`);
}

function assertStopBelowEntry(stop: number | null | undefined, entry: number | undefined): void {
  if (stop === null || stop === undefined || entry === undefined) return;
  if (stop >= entry)
    throw invalid('The initial stop must be below the entry price for a long trade');
}

function applyJournal(db: DbOrTx, id: number, patch: JournalPatch): void {
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(changes).length === 0) return;
  db.update(trades)
    .set({ ...changes, updatedAt: new Date().toISOString() })
    .where(eq(trades.id, id))
    .run();
}

/** "New trade": the first BUY fill plus the pre-trade journal, atomically. */
export function createTrade(
  db: Db,
  input: { symbol: string; fill: FillInput } & JournalPatch,
): TradeDetail {
  const { symbol, fill, ...journal } = input;
  const id = db.transaction((tx) => {
    assertStopBelowEntry(journal.initialStop, fill.price);
    assertSetupTag(tx, journal.setupTagId);
    const open = tx
      .select({ id: trades.id })
      .from(trades)
      .where(and(eq(trades.symbol, symbol), eq(trades.status, 'OPEN'), isNull(trades.orphanedAt)))
      .get();
    if (open) {
      throw conflict(
        'POSITION_ALREADY_OPEN',
        `There is already an open ${symbol} trade; use "Add fill" on it to scale in.`,
        { tradeId: open.id },
      );
    }
    const { execution, tradeId } = insertExecutionTx(tx, { symbol, side: 'BUY', ...fill });
    if (getTradeRow(tx, tradeId).stableKey !== execution.id) {
      throw conflict(
        'OVERLAPS_EXISTING_TRADE',
        'This fill falls inside an existing trade; use "Add fill" on that trade instead.',
        { tradeId },
      );
    }
    applyJournal(tx, tradeId, journal);
    return tradeId;
  });
  return getTradeDetail(db, id);
}

/** "Add fill": a scale-in or scale-out that must land in this trade. */
export function addFill(
  db: Db,
  tradeId: number,
  input: FillInput & { side: 'BUY' | 'SELL' },
): TradeDetail {
  db.transaction((tx) => {
    const trade = getTradeRow(tx, tradeId);
    if (trade.orphanedAt !== null) {
      throw conflict(
        'TRADE_ORPHANED',
        'This journal entry has no executions; add fills via executions.',
      );
    }
    const result = insertExecutionTx(tx, { symbol: trade.symbol, ...input });
    if (result.tradeId !== tradeId) {
      throw conflict(
        'FILL_OUTSIDE_TRADE',
        'This fill would belong to a different trade (check the date and side).',
        { tradeId: result.tradeId },
      );
    }
  });
  return getTradeDetail(db, tradeId);
}

export function updateJournal(db: Db, id: number, patch: JournalPatch): TradeDetail {
  db.transaction((tx) => {
    getTradeRow(tx, id);
    assertSetupTag(tx, patch.setupTagId);
    const firstBuy = tx
      .select({ e: executions })
      .from(tradeExecutions)
      .innerJoin(executions, eq(executions.id, tradeExecutions.executionId))
      .where(and(eq(tradeExecutions.tradeId, id), eq(executions.side, 'BUY')))
      .all()
      .map((r) => r.e)
      .sort((a, b) => compareExecutions(toCoreExecution(a), toCoreExecution(b)))[0];
    assertStopBelowEntry(patch.initialStop, firstBuy?.price);
    applyJournal(tx, id, patch);
  });
  return getTradeDetail(db, id);
}

/** Replace the trade's MISTAKE/CUSTOM tags (the setup is a separate field). */
export function setTradeTags(db: Db, id: number, tagIds: readonly number[]): TradeDetail {
  db.transaction((tx) => {
    getTradeRow(tx, id);
    const unique = [...new Set(tagIds)];
    const found = unique.length ? tx.select().from(tags).where(inArray(tags.id, unique)).all() : [];
    if (found.length !== unique.length) throw invalid('Unknown tag id');
    const setup = found.find((t) => t.kind === 'SETUP');
    if (setup) throw invalid(`"${setup.name}" is a setup tag; set it as the trade's setup instead`);
    tx.delete(tradeTags).where(eq(tradeTags.tradeId, id)).run();
    if (unique.length) {
      tx.insert(tradeTags)
        .values(unique.map((tagId) => ({ tradeId: id, tagId })))
        .run();
    }
  });
  return getTradeDetail(db, id);
}

/** Only orphaned journal entries can be deleted; real trades go away with their executions. */
export function deleteOrphanedTrade(db: DbOrTx, id: number): void {
  const row = getTradeRow(db, id);
  if (row.orphanedAt === null) {
    throw conflict(
      'NOT_ORPHANED',
      'Only orphaned journal entries can be deleted; delete the executions instead.',
    );
  }
  db.delete(trades).where(eq(trades.id, id)).run();
}
