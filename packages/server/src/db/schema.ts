/**
 * SQLite schema. Money and prices are INTEGER micros (1 USD = 1_000_000).
 * Timestamps are TEXT UTC ISO-8601; plain dates are TEXT YYYY-MM-DD.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const importBatches = sqliteTable('import_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source', { enum: ['IBKR_ACTIVITY', 'IBKR_FLEX', 'CSV'] }).notNull(),
  filename: text('filename').notNull(),
  fileHash: text('file_hash').notNull(),
  importedAt: text('imported_at').notNull().default(now),
  rowsTotal: integer('rows_total').notNull().default(0),
  rowsInserted: integer('rows_inserted').notNull().default(0),
  rowsSkippedDuplicate: integer('rows_skipped_duplicate').notNull().default(0),
  status: text('status', { enum: ['PREVIEW', 'COMMITTED', 'UNDONE'] }).notNull(),
  rowsError: integer('rows_error').notNull().default(0),
  committedAt: text('committed_at'),
  undoneAt: text('undone_at'),
  /** Parsed rows (JSON) kept between preview and commit. */
  payload: text('payload'),
});

/** Saved column mappings for the generic CSV importer. */
export const importPresets = sqliteTable('import_presets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  /** CsvMapping as JSON. */
  mapping: text('mapping').notNull(),
  createdAt: text('created_at').notNull().default(now),
});

export const executions = sqliteTable(
  'executions',
  {
    // AUTOINCREMENT: ids are never reused, so a deleted execution's id can't collide with a stable key.
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    side: text('side', { enum: ['BUY', 'SELL'] }).notNull(),
    /** Micro-shares (1 share = 1_000_000); fractional shares allowed. */
    quantity: integer('quantity').notNull(),
    price: integer('price').notNull(),
    commission: integer('commission').notNull().default(0),
    otherFees: integer('other_fees').notNull().default(0),
    executedAt: text('executed_at').notNull(),
    source: text('source', { enum: ['MANUAL', 'IBKR_ACTIVITY', 'IBKR_FLEX', 'CSV'] }).notNull(),
    externalId: text('external_id').unique(),
    importBatchId: integer('import_batch_id').references(() => importBatches.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('executions_symbol_executed_at_idx').on(t.symbol, t.executedAt)],
);

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  kind: text('kind', { enum: ['SETUP', 'MISTAKE', 'CUSTOM'] }).notNull(),
  color: text('color').notNull().default('#64748b'),
});

export const trades = sqliteTable(
  'trades',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Id of the trade's first execution. No FK: the execution may be deleted while journal data survives. */
    stableKey: integer('stable_key').notNull(),
    symbol: text('symbol').notNull(),
    direction: text('direction', { enum: ['LONG'] })
      .notNull()
      .default('LONG'),
    status: text('status', { enum: ['OPEN', 'CLOSED'] }).notNull(),
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at'),
    initialStop: integer('initial_stop'),
    plannedRiskOverride: integer('planned_risk_override'),
    target: integer('target'),
    setupTagId: integer('setup_tag_id').references(() => tags.id, { onDelete: 'set null' }),
    thesis: text('thesis'),
    review: text('review'),
    emotion: text('emotion'),
    executionRating: integer('execution_rating'),
    followedPlan: integer('followed_plan', { mode: 'boolean' }),
    /** Set when regrouping left this journal entry without executions. Never auto-deleted. */
    orphanedAt: text('orphaned_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('trades_stable_key_idx').on(t.stableKey),
    index('trades_closed_at_idx').on(t.closedAt),
    index('trades_symbol_idx').on(t.symbol),
  ],
);

export const tradeExecutions = sqliteTable(
  'trade_executions',
  {
    tradeId: integer('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    executionId: integer('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.tradeId, t.executionId] }),
    uniqueIndex('trade_executions_execution_idx').on(t.executionId),
  ],
);

export const stopChanges = sqliteTable(
  'stop_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tradeId: integer('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    stopPrice: integer('stop_price').notNull(),
    changedAt: text('changed_at').notNull(),
  },
  (t) => [index('stop_changes_trade_idx').on(t.tradeId)],
);

export const tradeTags = sqliteTable(
  'trade_tags',
  {
    tradeId: integer('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.tradeId, t.tagId] })],
);

export const screenshots = sqliteTable('screenshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tradeId: integer('trade_id')
    .notNull()
    .references(() => trades.id, { onDelete: 'cascade' }),
  /** Relative to data/uploads/. */
  filePath: text('file_path').notNull(),
  caption: text('caption'),
  createdAt: text('created_at').notNull().default(now),
});

export const cashFlows = sqliteTable(
  'cash_flows',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', {
      enum: ['DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'INTEREST', 'FEE'],
    }).notNull(),
    /** Signed micros: money in positive, money out negative. */
    amount: integer('amount').notNull(),
    occurredAt: text('occurred_at').notNull(),
    externalId: text('external_id').unique(),
    note: text('note'),
    importBatchId: integer('import_batch_id').references(() => importBatches.id),
  },
  (t) => [index('cash_flows_occurred_at_idx').on(t.occurredAt)],
);

export const candles = sqliteTable(
  'candles',
  {
    symbol: text('symbol').notNull(),
    date: text('date').notNull(),
    open: integer('open').notNull(),
    high: integer('high').notNull(),
    low: integer('low').notNull(),
    close: integer('close').notNull(),
    /** Split- and dividend-adjusted close (micros), when the provider has it. */
    adjClose: integer('adj_close'),
    volume: integer('volume').notNull(),
    /** Provider split factor on this date (1 = none). */
    splitFactor: real('split_factor'),
    provider: text('provider').notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

/** Date ranges already fetched from the provider (so empty days aren't re-requested). */
export const candleCoverage = sqliteTable(
  'candle_coverage',
  {
    symbol: text('symbol').notNull(),
    fromDate: text('from_date').notNull(),
    toDate: text('to_date').notNull(),
    provider: text('provider').notNull(),
    fetchedAt: text('fetched_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.fromDate, t.toDate] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type ExecutionRow = typeof executions.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type CashFlowRow = typeof cashFlows.$inferSelect;
export type StopChangeRow = typeof stopChanges.$inferSelect;
export type ImportBatchRow = typeof importBatches.$inferSelect;
export type ImportPresetRow = typeof importPresets.$inferSelect;
export type CandleRow = typeof candles.$inferSelect;
