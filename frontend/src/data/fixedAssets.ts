/**
 * Fixed assets, live side (step 3c.16, docs/15). Query keys start with 'fixed-assets' then the company id, so one
 * invalidation after any write refreshes every tab. Posting writes also refresh journals, approvals and the close checks.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging, fetchAllPages, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/fixedAssets';
import {
  toAssetSchedule, toAssetTransaction, toCapitalisable, toCategory, toDepreciationPreview, toDepreciationRun, toFixedAsset, toReconciliation, toTaxClass, toTaxSchedule, toTxPreview, unitsQuery,
  type ApiFixedAsset, type AssetCategory, type AssetScheduleReport, type AssetTaxClass, type AssetTransaction, type Capitalisable, type DepreciationPreview, type DepreciationRun,
  type FixedAssetRow, type Reconciliation, type TaxSchedule, type TxPreview,
} from '@/api/adapters/fixedAssets';
import type { Intent } from '@/api/idempotency';
import { approvalsKey, journalsKey } from './journals';
import { useActiveCompany } from './session';
import type { DataResult } from './types';

export const fixedAssetsKey = (companyId: string) => ['fixed-assets', companyId] as const;

const result = <T,>(q: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }, empty: T): DataResult<T> => ({
  data: q.data ?? empty, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch(),
});

export function useAssetCategories(): DataResult<AssetCategory[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known,
    queryKey: [...fixedAssetsKey(company.id), 'categories'],
    queryFn: async () => (await fetchAllPages((c) => live.listCategories(company.id, c))).map(toCategory),
  });
  return result(q, []);
}

export function useAssetTaxClasses(): DataResult<AssetTaxClass[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known,
    queryKey: [...fixedAssetsKey(company.id), 'tax-classes'],
    queryFn: async () => (await fetchAllPages((c) => live.listTaxClasses(company.id, c))).map(toTaxClass),
  });
  return result(q, []);
}

export interface AssetFilters {
  category_id?: string;
  status?: string;
  q?: string;
}

/** The register, a page at a time. */
export function useFixedAssetList(filters: AssetFilters) {
  const { company, known } = useActiveCompany();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as AssetFilters;
  const q = useInfiniteQuery({
    enabled: known,
    queryKey: [...fixedAssetsKey(company.id), 'list', clean],
    queryFn: ({ pageParam }) => live.listAssets(company.id, clean, pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<ApiFixedAsset>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map(toFixedAsset), [q.data]);
  return { rows, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch(), hasMore: Boolean(q.hasNextPage), loadMore: () => void q.fetchNextPage(), isLoadingMore: q.isFetchingNextPage };
}

/** Every asset with a status, for pickers and for the whole class a revaluation needs. */
export function useAllAssets(status?: string, enabled = true): DataResult<FixedAssetRow[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known && enabled,
    queryKey: [...fixedAssetsKey(company.id), 'all', status ?? 'any'],
    queryFn: async () => (await fetchAllPages((c) => live.listAssets(company.id, status ? { status } : {}, c, 200))).map(toFixedAsset),
  });
  return { data: q.data ?? [], isLoading: q.isLoading && q.fetchStatus !== 'idle', error: q.error, refetch: () => void q.refetch() };
}

export function useCapitalisable(enabled: boolean): DataResult<Capitalisable[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known && enabled,
    queryKey: [...fixedAssetsKey(company.id), 'capitalisable'],
    queryFn: async () => (await live.getCapitalisable(company.id)).map(toCapitalisable),
    staleTime: 0,
  });
  return { data: q.data ?? [], isLoading: q.isLoading && q.fetchStatus !== 'idle', error: q.error, refetch: () => void q.refetch() };
}

export function useReconciliation(asOf: string): DataResult<Reconciliation | null> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known,
    queryKey: [...fixedAssetsKey(company.id), 'reconciliation', asOf],
    queryFn: async () => toReconciliation(await live.getReconciliation(company.id, asOf || undefined)),
  });
  return result(q, null);
}

export function useDepreciationRuns(): DataResult<DepreciationRun[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known,
    queryKey: [...fixedAssetsKey(company.id), 'runs'],
    queryFn: async () => (await fetchAllPages((c) => live.listRuns(company.id, c))).map(toDepreciationRun),
  });
  return result(q, []);
}

export function useDepreciationPreview(periodId: string, units: Record<string, string>): DataResult<DepreciationPreview | null> {
  const { company, known } = useActiveCompany();
  const wire = unitsQuery(units);
  const q = useQuery({
    enabled: known && Boolean(periodId),
    queryKey: [...fixedAssetsKey(company.id), 'preview', periodId, wire],
    queryFn: async () => toDepreciationPreview(await live.previewRun(company.id, periodId, wire)),
    staleTime: 0,
  });
  return { data: q.data ?? null, isLoading: q.isLoading && q.fetchStatus !== 'idle', error: q.error, refetch: () => void q.refetch() };
}

export function useAssetTransactions(filters: { kind?: string; status?: string }): DataResult<AssetTransaction[]> {
  const { company, known } = useActiveCompany();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as { kind?: string; status?: string };
  const q = useQuery({
    enabled: known,
    queryKey: [...fixedAssetsKey(company.id), 'transactions', clean],
    queryFn: async () => (await fetchAllPages((c) => live.listTransactions(company.id, clean, c))).map(toAssetTransaction),
  });
  return result(q, []);
}

export function useTaxSchedule(enabled: boolean): DataResult<TaxSchedule | null> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known && enabled,
    queryKey: [...fixedAssetsKey(company.id), 'tax-schedule'],
    queryFn: async () => toTaxSchedule(await live.getTaxSchedule(company.id)),
  });
  return { data: q.data ?? null, isLoading: q.isLoading && q.fetchStatus !== 'idle', error: q.error, refetch: () => void q.refetch() };
}

export function useAssetSchedule(query: Record<string, string>, enabled: boolean): DataResult<AssetScheduleReport | null> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known && enabled,
    queryKey: [...fixedAssetsKey(company.id), 'schedule', query],
    queryFn: async ({ signal }) => toAssetSchedule(await live.getAssetSchedule(company.id, query, signal)),
  });
  return { data: q.data ?? null, isLoading: q.isLoading && q.fetchStatus !== 'idle', error: q.error, refetch: () => void q.refetch() };
}

type Action = 'submit' | 'approve' | 'return' | 'void' | 'reverse';

/**
 * Writes. Signing is NOT handled here: a 403 signature_required propagates so the screen's signed runner can verify the
 * PIN and call the same function again with the same intent.
 */
export function useFixedAssetActions() {
  const { company } = useActiveCompany();
  const qc = useQueryClient();
  const id = company.id;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: fixedAssetsKey(id) });
  };
  const refreshBooks = () => {
    refresh();
    void qc.invalidateQueries({ queryKey: journalsKey(id) });
    void qc.invalidateQueries({ queryKey: approvalsKey(id) });
    void qc.invalidateQueries({ queryKey: ['close-checks', id] });
    void qc.invalidateQueries({ queryKey: ['accounts', id] });
  };
  return {
    createCategory: async (body: unknown, intent: Intent) => { const r = toCategory(await live.createCategory(id, body, intent)); refresh(); return r; },
    updateCategory: async (cat: string, body: unknown, intent: Intent) => { const r = toCategory(await live.updateCategory(id, cat, body, intent)); refresh(); return r; },
    createTaxClass: async (body: unknown, intent: Intent) => { const r = toTaxClass(await live.createTaxClass(id, body, intent)); refresh(); return r; },
    updateTaxClass: async (cls: string, body: unknown, intent: Intent) => { const r = toTaxClass(await live.updateTaxClass(id, cls, body, intent)); refresh(); return r; },
    createAsset: async (body: unknown, intent: Intent) => { const r = toFixedAsset(await live.createAsset(id, body, intent)); refresh(); return r; },
    updateAsset: async (asset: string, body: unknown, intent: Intent) => { const r = toFixedAsset(await live.updateAsset(id, asset, body, intent)); refresh(); return r; },
    createRun: async (body: unknown, intent: Intent) => { const r = toDepreciationRun(await live.createRun(id, body, intent)); refreshBooks(); return r; },
    transitionRun: async (run: string, action: Action, body: Record<string, unknown>, intent: Intent) => {
      const r = toDepreciationRun(await live.transitionRun(id, run, action, body, intent));
      refreshBooks();
      return r;
    },
    previewTransaction: async (body: unknown, intent: Intent): Promise<TxPreview> => toTxPreview(await live.previewTransaction(id, body, intent)),
    createTransaction: async (body: unknown, intent: Intent) => { const r = toAssetTransaction(await live.createTransaction(id, body, intent)); refreshBooks(); return r; },
    transitionTransaction: async (tx: string, action: Action, body: Record<string, unknown>, intent: Intent) => {
      const r = toAssetTransaction(await live.transitionTransaction(id, tx, action, body, intent));
      refreshBooks();
      return r;
    },
  };
}
