// Response shapes of the REST API (money in micros, timestamps UTC ISO).
// Mirrors packages/server; kept separate so the web build never pulls in server code.
import type { HoldingPeriod, Outcome } from '@tj/core';

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
