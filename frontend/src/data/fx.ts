/** FX rates and revaluation (live). Keys: ['fx-rates', companyId], ['fx-reval-preview', companyId, periodId, asOf], ['fx-revaluations', companyId]. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/api/http';
import { fetchAllPages } from '@/api/cursor';
import { toRate, toRevalPreview, toRevalRun, toRateRequest, type LiveRate, type LiveRevalPreview, type LiveRevalRun } from '@/api/adapters/fx';
import { createIntent, type Intent } from '@/api/idempotency';
import { useLedgerStore } from '@/mock/store';
import type { DataResult } from './types';

export const fxRatesKey = (companyId: string) => ['fx-rates', companyId] as const;
export const fxRunsKey = (companyId: string) => ['fx-revaluations', companyId] as const;

export function useFxRates(): DataResult<LiveRate[]> {
  const company = useLedgerStore((s) => s.currentCompany);
  const q = useQuery({
    queryKey: fxRatesKey(company.id),
    queryFn: async () => {
      const rows = await fetchAllPages((cursor) => http.get('/v1/companies/{company}/fx-rates', { path: { company: company.id }, query: { cursor, limit: 100 } }));
      return rows.map(toRate);
    },
  });
  return { data: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useFxRuns(): DataResult<LiveRevalRun[]> {
  const company = useLedgerStore((s) => s.currentCompany);
  const q = useQuery({
    queryKey: fxRunsKey(company.id),
    queryFn: async () => {
      const rows = await fetchAllPages((cursor) => http.get('/v1/companies/{company}/fx-revaluations', { path: { company: company.id }, query: { cursor, limit: 50 } as never }));
      return rows.map(toRevalRun);
    },
  });
  return { data: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/** What running now would post and what blocks it. Writes nothing, takes no lock (FxApiTest). */
export function useRevalPreview(periodId: string | undefined, asOf: string): DataResult<LiveRevalPreview | null> {
  const company = useLedgerStore((s) => s.currentCompany);
  const q = useQuery({
    queryKey: ['fx-reval-preview', company.id, periodId ?? 'none', asOf],
    enabled: Boolean(periodId),
    queryFn: async () => {
      const res = await http.get('/v1/companies/{company}/fx-revaluations/preview', {
        path: { company: company.id },
        query: { period_id: periodId!, ...(asOf ? { as_of: asOf } : {}) },
      });
      return toRevalPreview(res.data);
    },
  });
  return { data: q.data ?? null, isLoading: q.isLoading && q.fetchStatus !== 'idle', error: q.error, refetch: () => void q.refetch() };
}

export interface FxActions {
  addRate: (f: { from: string; to: string; date: string; rate: string }, intent?: Intent) => Promise<void>;
  fetchProviderRates: (intent?: Intent) => Promise<{ provider: string; rate_date: string | null; inserted: number; skipped_currencies: string[] }>;
  /** Signing is the caller's business: a 403 signature_required propagates. */
  runRevaluation: (periodId: string, asOf: string, intent?: Intent) => Promise<LiveRevalRun>;
}

export function useFxActions(): FxActions {
  const client = useQueryClient();
  const company = useLedgerStore((s) => s.currentCompany);
  const path = { company: company.id };
  return {
    addRate: async (f, intent = createIntent()) => {
      await http.post('/v1/companies/{company}/fx-rates', { path, body: toRateRequest(f), intent });
      await client.invalidateQueries({ queryKey: fxRatesKey(company.id) });
      await client.invalidateQueries({ queryKey: ['fx-reval-preview', company.id] });
    },
    fetchProviderRates: async (intent = createIntent()) => {
      const res = await http.post('/v1/companies/{company}/fx-rates/fetch', { path, intent });
      await client.invalidateQueries({ queryKey: fxRatesKey(company.id) });
      await client.invalidateQueries({ queryKey: ['fx-reval-preview', company.id] });
      return res.data;
    },
    runRevaluation: async (periodId, asOf, intent = createIntent()) => {
      const res = await http.post('/v1/companies/{company}/fx-revaluations', { path, body: { period_id: periodId, ...(asOf ? { as_of: asOf } : {}) }, intent });
      await client.invalidateQueries({ queryKey: fxRunsKey(company.id) });
      await client.invalidateQueries({ queryKey: ['fx-reval-preview', company.id] });
      await client.invalidateQueries({ queryKey: ['close-checks', company.id] });
      return toRevalRun(res.data);
    },
  };
}
