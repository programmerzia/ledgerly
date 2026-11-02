/**
 * Journals seam, live side (docs/15). The mock screens keep reading the store; the live screens
 * (`pages/Accounting/live/*`) read these hooks. The write path differs in kind (draft, server preview, submit,
 * signed approval), so the page component is chosen by mode and these hooks serve only the live one.
 * Query keys start with the resource name then the company id (docs/15 recipe step 3).
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLedgerStore } from '@/mock/store';
import { cursorPaging, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/journals';
import {
  toDimensions,
  toJournal,
  type ApiDimension,
  type ApiJournal,
  type JournalCan,
} from '@/api/adapters/journal';
import type { Dimension, Journal } from '@/types';
import type { DataResult } from './types';
import type { Intent } from '@/api/idempotency';

export const journalsKey = (companyId: string) => ['journals', companyId] as const;
export const approvalsKey = (companyId: string) => ['approvals', companyId] as const;

export type LiveJournal = Journal & { can: JournalCan };

export interface JournalFilters {
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface PeriodChoice {
  id: string;
  name: string;
  kind: string;
  status: string;
  starts_on: string;
  ends_on: string;
}

function useScope() {
  const company = useLedgerStore((s) => s.currentCompany);
  return { company, scope: { tenantId: company.tenant_id, companyId: company.id } };
}

/** Dimensions and fiscal periods the journal form needs. Both come from the server; nothing is derived here. */
export function useJournalRefs() {
  const { company, scope } = useScope();
  const dims = useQuery({ queryKey: [...journalsKey(company.id), 'refs', 'dimensions'], queryFn: () => live.listDimensions(company.id) });
  const years = useQuery({ queryKey: [...journalsKey(company.id), 'refs', 'fiscal-years'], queryFn: () => live.listFiscalYears(company.id) });
  const apiDimensions: ApiDimension[] = useMemo(() => dims.data ?? [], [dims.data]);
  const dimensions: Dimension[] = useMemo(() => toDimensions(apiDimensions, company.id), [apiDimensions, company.id]);
  const periods: PeriodChoice[] = useMemo(
    () =>
      (years.data ?? []).flatMap((y) =>
        (y.periods ?? []).map((p) => ({ id: p.id, name: p.name, kind: p.kind, status: p.status, starts_on: p.starts_on ?? '', ends_on: p.ends_on ?? '' })),
      ),
    [years.data],
  );
  const adapt = (a: ApiJournal): LiveJournal => toJournal(a, scope, apiDimensions);
  return { apiDimensions, dimensions, periods, adapt, isLoading: dims.isLoading || years.isLoading, error: dims.error ?? years.error };
}

export interface JournalListResult {
  rows: LiveJournal[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
}

/** Server-filtered, cursor-paged. The caller never filters these rows itself. */
export function useJournalList(filters: JournalFilters): JournalListResult {
  const { company, scope } = useScope();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as JournalFilters;
  const q = useInfiniteQuery({
    queryKey: [...journalsKey(company.id), 'list', clean],
    queryFn: ({ pageParam }) => live.listJournals(company.id, clean, pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<ApiJournal>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map((a) => toJournal(a, scope)), [q.data, scope]);
  return {
    rows,
    isLoading: q.isLoading,
    error: q.error,
    refetch: () => void q.refetch(),
    hasMore: Boolean(q.hasNextPage),
    loadMore: () => void q.fetchNextPage(),
    isLoadingMore: q.isFetchingNextPage,
  };
}

export function useJournal(id: string | undefined): DataResult<LiveJournal | null> {
  const { company } = useScope();
  const refs = useJournalRefs();
  const q = useQuery({
    queryKey: [...journalsKey(company.id), 'one', id],
    queryFn: () => live.getJournal(company.id, id as string),
    enabled: Boolean(id),
    staleTime: 0,
  });
  const data = useMemo(() => (q.data ? refs.adapt(q.data) : null), [q.data, refs.apiDimensions]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, isLoading: q.isLoading || (Boolean(q.data) && refs.isLoading), error: q.error, refetch: () => void q.refetch() };
}

/** Every write the journal screens make. Each takes the caller's intent (one per user action) and returns the server's journal. */
export function useJournalActions() {
  const { company } = useScope();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: journalsKey(company.id) });
    void qc.invalidateQueries({ queryKey: approvalsKey(company.id) });
  };
  // What the server answered is the journal now: put it in the cache so the next screen never shows the old state.
  const after = async <T extends { id?: string; lines?: unknown }>(p: Promise<T>): Promise<T> => {
    const r = await p;
    if (r.id && r.lines) qc.setQueryData([...journalsKey(company.id), 'one', r.id], r);
    refresh();
    return r;
  };
  return {
    create: (body: unknown, intent: Intent) => after(live.createJournal(company.id, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updateJournal(company.id, id, body, intent)),
    /** Writes nothing on the server, so no refresh. */
    preview: (id: string, intent: Intent) => live.previewJournal(company.id, id, intent),
    submit: (id: string, version: number, intent: Intent) => after(live.transitionJournal(company.id, id, 'submit', { version }, intent)),
    approve: (id: string, version: number, intent: Intent) => after(live.transitionJournal(company.id, id, 'approve', { version }, intent)),
    sendBack: (id: string, comment: string, version: number, intent: Intent) => after(live.transitionJournal(company.id, id, 'return', { comment, version }, intent)),
    voidDraft: (id: string, reason: string, version: number, intent: Intent) => after(live.transitionJournal(company.id, id, 'void', { reason, version }, intent)),
    reverse: (id: string, body: { memo?: string; date?: string; version: number }, intent: Intent) => after(live.transitionJournal(company.id, id, 'reverse', body, intent)),
  };
}

/** One-off fetch (for reloading after a 409) that goes through the same adapter as the screens. */
export function useFetchJournal() {
  const { company } = useScope();
  const refs = useJournalRefs();
  return async (id: string): Promise<LiveJournal> => refs.adapt(await live.getJournal(company.id, id));
}
