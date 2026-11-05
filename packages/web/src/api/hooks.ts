import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, query } from './client';
import type {
  CashFlow,
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
