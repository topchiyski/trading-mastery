import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, query } from './client';
import type { CsvMapping } from '../lib/mapping';
import type {
  CashFlow,
  Dashboard,
  DashboardFilters,
  ImportBatch,
  ImportPreset,
  ImportPreview,
  ImportSource,
  MarketStatus,
  Positions,
  TradeChart,
  Screenshot,
  Settings,
  StopChange,
  Tag,
  TagKind,
  TradeDetail,
  TradeFilters,
  TradeListItem,
  TradeTotals,
} from './types';

export const keys = {
  trades: ['trades'] as const,
  tradeList: (f: TradeFilters) => ['trades', 'list', f] as const,
  trade: (id: number) => ['trades', 'detail', id] as const,
  tags: ['tags'] as const,
  settings: ['settings'] as const,
  cashFlows: ['cash-flows'] as const,
};

export function useTrades(filters: TradeFilters) {
  return useQuery({
    queryKey: keys.tradeList(filters),
    queryFn: () =>
      api.get<{ trades: TradeListItem[]; totals: TradeTotals }>(`/api/trades${query(filters)}`),
    placeholderData: (prev) => prev,
  });
}

export function useTrade(id: number) {
  return useQuery({
    queryKey: keys.trade(id),
    queryFn: () => api.get<TradeDetail>(`/api/trades/${id}`),
  });
}

export function useTags() {
  return useQuery({
    queryKey: keys.tags,
    queryFn: async () => (await api.get<{ tags: Tag[] }>('/api/tags')).tags,
  });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<Settings>('/api/settings') });
}

export function useCashFlows() {
  return useQuery({
    queryKey: keys.cashFlows,
    queryFn: async () => (await api.get<{ cashFlows: CashFlow[] }>('/api/cash-flows')).cashFlows,
  });
}

/** Mutations that change a trade: refresh that trade (from the response) and every list. */
function useTradeMutation<V>(fn: (vars: V) => Promise<TradeDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (trade) => {
      qc.setQueryData(keys.trade(trade.id), trade);
      void qc.invalidateQueries({ queryKey: keys.trades });
    },
  });
}

export const useCreateTrade = () =>
  useTradeMutation((body: unknown) => api.post<TradeDetail>('/api/trades', body));

export const useAddFill = (tradeId: number) =>
  useTradeMutation((body: unknown) => api.post<TradeDetail>(`/api/trades/${tradeId}/fills`, body));

export const useUpdateJournal = (tradeId: number) =>
  useTradeMutation((body: unknown) => api.patch<TradeDetail>(`/api/trades/${tradeId}`, body));

export const useSetTradeTags = (tradeId: number) =>
  useTradeMutation((tagIds: number[]) =>
    api.put<TradeDetail>(`/api/trades/${tradeId}/tags`, { tagIds }),
  );

/** Mutations returning something else: just refetch the trade and the lists. */
function useTradeSideEffect<V, R>(tradeId: number, fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.trades }),
    meta: { tradeId },
  });
}

export const useDeleteExecution = (tradeId: number) =>
  useTradeSideEffect(tradeId, (executionId: number) => api.del(`/api/executions/${executionId}`));

export const useAddStop = (tradeId: number) =>
  useTradeSideEffect(tradeId, (body: { stopPrice: number; changedAt?: string }) =>
    api.post<StopChange>(`/api/trades/${tradeId}/stops`, body),
  );

export const useDeleteStop = (tradeId: number) =>
  useTradeSideEffect(tradeId, (stopId: number) => api.del(`/api/stops/${stopId}`));

export const useUploadScreenshot = (tradeId: number) =>
  useTradeSideEffect(tradeId, ({ file, caption }: { file: File; caption: string }) => {
    const form = new FormData();
    form.append('caption', caption); // fields before the file so the server sees them
    form.append('file', file);
    return api.post<Screenshot>(`/api/trades/${tradeId}/screenshots`, form);
  });

export const useUpdateScreenshot = (tradeId: number) =>
  useTradeSideEffect(tradeId, ({ id, caption }: { id: number; caption: string | null }) =>
    api.patch<Screenshot>(`/api/screenshots/${id}`, { caption }),
  );

export const useDeleteScreenshot = (tradeId: number) =>
  useTradeSideEffect(tradeId, (id: number) => api.del(`/api/screenshots/${id}`));

export const useDeleteOrphan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/trades/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.trades }),
  });
};

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; kind: TagKind; color?: string }) =>
      api.post<Tag>('/api/tags', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tags }),
  });
}

export function useCreateCashFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<CashFlow, 'id' | 'externalId' | 'importBatchId'>) =>
      api.post<CashFlow>('/api/cash-flows', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.cashFlows }),
  });
}

export function useDeleteCashFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/cash-flows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.cashFlows }),
  });
}

// ---------------------------------------------------------------------------
// Imports

export const importKeys = { list: ['imports'] as const, presets: ['import-presets'] as const };

export function useImports() {
  return useQuery({
    queryKey: importKeys.list,
    queryFn: async () => (await api.get<{ imports: ImportBatch[] }>('/api/imports')).imports,
  });
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: (v: { file: File; source: ImportSource; mapping?: CsvMapping }) => {
      const form = new FormData();
      // Text fields first: the server only sees fields sent before the file.
      form.append('source', v.source);
      if (v.mapping) form.append('mapping', JSON.stringify(v.mapping));
      form.append('file', v.file);
      return api.post<ImportPreview>('/api/imports/preview', form);
    },
  });
}

/** Commit and undo change trades, cash flows and the history: refresh everything. */
function useImportAction(path: 'commit' | 'undo') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: number; force?: boolean }) =>
      api.post<ImportBatch>(
        `/api/imports/${id}/${path}`,
        path === 'commit' ? { force: !!force } : {},
      ),
    onSuccess: () => qc.invalidateQueries(),
  });
}
export const useCommitImport = () => useImportAction('commit');
export const useUndoImport = () => useImportAction('undo');

export function usePresets() {
  return useQuery({
    queryKey: importKeys.presets,
    queryFn: async () =>
      (await api.get<{ presets: ImportPreset[] }>('/api/import-presets')).presets,
  });
}

export function useSavePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: number; name: string; mapping: CsvMapping }) =>
      v.id
        ? api.put<ImportPreset>(`/api/import-presets/${v.id}`, { name: v.name, mapping: v.mapping })
        : api.post<ImportPreset>('/api/import-presets', { name: v.name, mapping: v.mapping }),
    onSuccess: () => qc.invalidateQueries({ queryKey: importKeys.presets }),
  });
}

export function useDashboard(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['trades', 'dashboard', filters],
    queryFn: () => api.get<Dashboard>(`/api/dashboard${query(filters)}`),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// Market data

export function useTradeChart(tradeId: number) {
  return useQuery({
    queryKey: ['trades', 'chart', tradeId],
    queryFn: () => api.get<TradeChart>(`/api/trades/${tradeId}/chart`),
  });
}

export function usePositions() {
  return useQuery({
    queryKey: ['trades', 'positions'],
    queryFn: () => api.get<Positions>('/api/positions'),
  });
}

export function useMarketStatus(poll: boolean) {
  return useQuery({
    queryKey: ['market-status'],
    queryFn: () => api.get<MarketStatus>('/api/market-data/status'),
    refetchInterval: poll ? 3_000 : 60_000,
  });
}

export function useSyncMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<MarketStatus>('/api/market-data/sync', { wait: true }),
    onSuccess: () => qc.invalidateQueries(),
  });
}
