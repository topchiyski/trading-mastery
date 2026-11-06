import type { CsvMapping } from '../lib/mapping';
// Response shapes of the REST API (money in micros, timestamps UTC ISO).
// Mirrors packages/server; kept separate so the web build never pulls in server code.
import type { HoldingPeriod, Outcome, PortfolioMetrics } from '@tj/core';

export type TagKind = 'SETUP' | 'MISTAKE' | 'CUSTOM';
export interface Tag {
  id: number;
  name: string;
  kind: TagKind;
  color: string;
}

export interface Execution {
  id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  commission: number;
  otherFees: number;
  executedAt: string;
  source: 'MANUAL' | 'IBKR_ACTIVITY' | 'IBKR_FLEX' | 'CSV';
  externalId: string | null;
  importBatchId: number | null;
}

export interface TradeListItem {
  id: number;
  stableKey: number;
  symbol: string;
  direction: 'LONG';
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  orphaned: boolean;
  orphanedAt: string | null;
  setupTag: Tag | null;
  tags: Tag[];
  quantity: number | null;
  openQty: number | null;
  avgEntry: number | null;
  avgExit: number | null;
  /** Price of the first buy (an initial stop must be below it). */
  firstEntryPrice: number | null;
  netPnl: number | null;
  realisedNet: number | null;
  fees: number | null;
  returnPct: number | null;
  initialRisk: number | null;
  rMultiple: number | null;
  plannedRewardRisk: number | null;
  holding: HoldingPeriod | null;
  outcome: Outcome | null;
}

export interface TradeTotals {
  count: number;
  closedCount: number;
  openCount: number;
  netPnl: number;
  fees: number;
  wins: number;
  losses: number;
  breakEvens: number;
  winRate: number | null;
  expectancy: number | null;
  expectancyR: number | null;
  rExcludedCount: number;
}

export interface StopChange {
  id: number;
  tradeId: number;
  stopPrice: number;
  changedAt: string;
}

export interface Screenshot {
  id: number;
  tradeId: number;
  filePath: string;
  caption: string | null;
  createdAt: string;
  url: string;
}

export interface Realisation {
  executionId: number;
  executedAt: string;
  quantity: number;
  price: number;
  costBasisRemoved: number;
  realisedGross: number;
}

export interface Journal {
  initialStop: number | null;
  plannedRiskOverride: number | null;
  target: number | null;
  thesis: string | null;
  review: string | null;
  emotion: string | null;
  executionRating: number | null;
  followedPlan: boolean | null;
}

export interface TradeDetail extends TradeListItem {
  executions: Execution[];
  realisations: Realisation[];
  buyCost: number | null;
  sellProceeds: number | null;
  grossPnl: number | null;
  commissions: number | null;
  otherFees: number | null;
  openCostBasis: number | null;
  avgOpenCost: number | null;
  journal: Journal;
  stops: StopChange[];
  currentStop: number | null;
  screenshots: Screenshot[];
}

export type CashFlowType = 'DEPOSIT' | 'WITHDRAWAL' | 'DIVIDEND' | 'INTEREST' | 'FEE';
export interface CashFlow {
  id: number;
  type: CashFlowType;
  amount: number;
  occurredAt: string;
  externalId: string | null;
  note: string | null;
  importBatchId: number | null;
}

export interface Settings {
  startingBalance: number;
  startDate: string | null;
  breakEvenThreshold: number;
  defaultCommission: number;
}

export interface TradeFilters {
  status?: 'OPEN' | 'CLOSED';
  symbol?: string;
  setupTagId?: number;
  tagId?: number;
  outcome?: Outcome;
  from?: string;
  to?: string;
  orphaned?: 'exclude' | 'include' | 'only';
  /** Only trades without an initial stop. */
  missingStop?: boolean;
}

export type ImportSource = 'IBKR_ACTIVITY' | 'CSV';
export type ImportStatus = 'PREVIEW' | 'COMMITTED' | 'UNDONE';

export interface ImportBatch {
  id: number;
  source: ImportSource | 'IBKR_FLEX';
  filename: string;
  fileHash: string;
  importedAt: string;
  committedAt: string | null;
  undoneAt: string | null;
  rowsTotal: number;
  rowsInserted: number;
  rowsSkippedDuplicate: number;
  rowsError: number;
  status: ImportStatus;
}

export interface ImportIssue {
  line: number;
  severity: 'skipped' | 'error' | 'warning';
  reason: string;
  detail?: string;
}

export interface ImportExecutionRow {
  line: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  commission: number;
  otherFees: number;
  executedAt: string;
  externalId: string;
  status: 'new' | 'duplicate' | 'error';
  error?: string;
}

export interface ImportCashFlowRow {
  line: number;
  type: CashFlowType;
  amount: number;
  occurredAt: string;
  note: string | null;
  status: 'new' | 'duplicate';
}

export interface ImportTradeChange {
  id: number;
  symbol: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  fills: number;
  netPnl: number | null;
}

export interface ImportPreview {
  batch: ImportBatch;
  duplicateOf: { id: number; filename: string; importedAt: string } | null;
  summary: {
    executions: { new: number; duplicate: number; error: number };
    cashFlows: { new: number; duplicate: number };
    skipped: number;
    errors: number;
    warnings: number;
  };
  canCommit: boolean;
  executions: ImportExecutionRow[];
  cashFlows: ImportCashFlowRow[];
  issues: ImportIssue[];
  trades: { created: ImportTradeChange[]; changed: ImportTradeChange[] };
}

export interface ImportPreset {
  id: number;
  name: string;
  mapping: CsvMapping | null;
  createdAt: string;
}

export interface BreakdownRow {
  key: string;
  count: number;
  wins: number;
  losses: number;
  breakEvens: number;
  winRate: number | null;
  totalNetPnl: number;
  expectancy: number | null;
  expectancyR: number | null;
  rTradeCount: number;
  rExcludedCount: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  externalFlow: number;
  externalFlowsCum: number;
  incomeCum: number;
  realisedPnlCum: number;
  performanceCum: number;
  dailyReturn: number;
  twrIndex: number;
  performanceDrawdown: number;
  twrDrawdownPct: number;
}

export interface Dashboard {
  range: { from: string | null; to: string | null };
  includesCashFlows: boolean;
  startingBalance: number;
  metrics: PortfolioMetrics;
  equity: EquityPoint[];
  rCurve: {
    points: {
      stableKey: number;
      closedAt: string;
      rMultiple: number;
      cumR: number;
      drawdownR: number;
    }[];
    excluded: number;
  };
  monthly: { month: string; netPnl: number; count: number }[];
  trades: {
    id: number;
    symbol: string;
    openedAt: string;
    closedAt: string;
    netPnl: number;
    rMultiple: number | null;
    tradingDays: number;
    calendarDays: number;
    mae: Excursion | null;
    mfe: Excursion | null;
  }[];
  benchmark: {
    symbol: string;
    points: { date: string; spy: number | null; portfolio: number }[];
  } | null;
  breakdowns: Record<'setup' | 'symbol' | 'weekday' | 'month' | 'mistake', BreakdownRow[]>;
}

export interface DashboardFilters {
  from?: string;
  to?: string;
  setupTagId?: number;
  tagId?: number;
  symbol?: string;
}

export interface Excursion {
  perShare: number;
  dollars: number;
  pct: number;
  r: number | null;
}

export interface SplitEvent {
  date: string;
  ratio: number;
  source: 'provider' | 'price-jump';
}

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeChart {
  symbol: string;
  status: 'OPEN' | 'CLOSED';
  from: string;
  to: string;
  complete: boolean;
  note: string | null;
  candles: Candle[];
  markers: { date: string; side: 'BUY' | 'SELL'; price: number; quantity: number }[];
  levels: {
    initialStop: number | null;
    currentStop: number | null;
    target: number | null;
    avgEntry: number | null;
  };
  excursions: {
    mae: Excursion;
    mfe: Excursion;
    lowestLow: number;
    highestHigh: number;
    bars: number;
  } | null;
  splits: SplitEvent[];
}

export interface Position {
  tradeId: number;
  symbol: string;
  openedAt: string;
  shares: number;
  avgCost: number | null;
  lastClose: number | null;
  lastCloseDate: string | null;
  marketValue: number | null;
  unrealised: number | null;
  unrealisedPct: number | null;
  unrealisedR: number | null;
  initialRisk: number | null;
  currentStop: number | null;
  stopDistancePct: number | null;
  stopDistanceR: number | null;
  openRisk: number | null;
  realisedNet: number | null;
  splits: SplitEvent[];
}

export interface Positions {
  asOf: string;
  note: string | null;
  positions: Position[];
  totals: {
    marketValue: number;
    unrealised: number;
    openRisk: number;
    equity: number;
    openRiskPctOfEquity: number | null;
    unpriced: number;
  };
}

export interface MarketStatus {
  configured: boolean;
  provider: string | null;
  running: boolean;
  pendingSymbols: number;
  unknownSymbols: string[];
  lastRunAt: string | null;
  lastError: { kind: string; message: string } | null;
  usage: { label: string; used: number; max: number }[];
  nextSlotInMs: number;
  lastCompleteDay: string;
}

export interface BackupInfo {
  name: string;
  createdAt: string;
  dbBytes: number;
  uploadsBytes: number;
}
