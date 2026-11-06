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
  source: 'MANUAL' | 'IBKR_FLEX' | 'CSV';
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
  }[];
  breakdowns: Record<'setup' | 'symbol' | 'weekday' | 'month' | 'mistake', BreakdownRow[]>;
}

export interface DashboardFilters {
  from?: string;
  to?: string;
  setupTagId?: number;
  tagId?: number;
  symbol?: string;
}
