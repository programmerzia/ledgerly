/** Settlements seam, live side: receipts now, payments and refunds for the purchases step (`kind` is data). */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging, fetchAllPages, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/trade';
import type { SettlementQuery } from '@/api/live/trade';
import { toCreditApplication, toSettlement, type ApiSettlement, type LiveSettlement } from '@/api/adapters/settlement';
import type { Intent } from '@/api/idempotency';
import { approvalsKey } from './journals';
import { contactsKey } from './contacts';
import { useRouteCompany } from './session';
import { whtKey } from './wht';
import type { DataResult } from './types';

export const settlementsKey = (companyId: string) => ['settlements', companyId] as const;

export function useSettlementList(filters: SettlementQuery) {
  const company = useRouteCompany();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as SettlementQuery;
  const q = useInfiniteQuery({
    queryKey: [...settlementsKey(company.id), 'list', clean],
    queryFn: ({ pageParam }) => live.listSettlements(company.id, clean, pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<ApiSettlement>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map(toSettlement), [q.data]);
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

/**
 * Posted payments (or receipts) of one contact that still hold credit on account, by the server's `unallocated_fc`.
 * A supplier refund pays this credit back.
 */
export function useCreditSources(contactId: string | undefined, kind: 'payment' | 'receipt') {
  const company = useRouteCompany();
  const q = useQuery({
    queryKey: [...settlementsKey(company.id), 'credit', contactId, kind],
    enabled: Boolean(contactId),
    staleTime: 0,
    queryFn: async () => (await fetchAllPages((cursor) => live.listSettlements(company.id, { contact_id: contactId, kind, status: 'posted' }, cursor, 100))).map(toSettlement).filter((s) => s.unallocated_fc > 0),
  });
  return { sources: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useSettlement(id: string | undefined): DataResult<LiveSettlement | null> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...settlementsKey(company.id), 'one', id], queryFn: () => live.getSettlement(company.id, id as string), enabled: Boolean(id), staleTime: 0 });
  const data = useMemo(() => (q.data ? toSettlement(q.data) : null), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useSettlementActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: settlementsKey(company.id) });
    void qc.invalidateQueries({ queryKey: ['invoices', company.id] });
    void qc.invalidateQueries({ queryKey: ['bills', company.id] });
    void qc.invalidateQueries({ queryKey: approvalsKey(company.id) });
    void qc.invalidateQueries({ queryKey: contactsKey(company.id) });
    void qc.invalidateQueries({ queryKey: whtKey(company.id) });
  };
  const after = async (p: Promise<ApiSettlement>): Promise<LiveSettlement> => {
    const r = await p;
    if (r.id && r.allocations) qc.setQueryData([...settlementsKey(company.id), 'one', r.id], r);
    refresh();
    return toSettlement(r);
  };
  return {
    create: (body: unknown, intent: Intent) => after(live.createSettlement(company.id, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updateSettlement(company.id, id, body, intent)),
    preview: (id: string, intent: Intent) => live.previewSettlement(company.id, id, intent),
    submit: (id: string, version: number, intent: Intent) => after(live.transitionSettlement(company.id, id, 'submit', { version }, intent)),
    approve: (id: string, version: number, intent: Intent) => after(live.transitionSettlement(company.id, id, 'approve', { version }, intent)),
    sendBack: (id: string, comment: string, version: number, intent: Intent) => after(live.transitionSettlement(company.id, id, 'return', { comment, version }, intent)),
    voidDraft: (id: string, reason: string, version: number, intent: Intent) => after(live.transitionSettlement(company.id, id, 'void', { reason, version }, intent)),
    reverse: (id: string, body: { memo?: string; date?: string; version: number }, intent: Intent) => after(live.transitionSettlement(company.id, id, 'reverse', body, intent)),
    /** Puts the credit on account of this receipt against an open invoice of the same customer. */
    applyCredit: async (id: string, body: { invoice_id: string; amount_fc: number; date?: string }, intent: Intent) => {
      const r = toCreditApplication(await live.applySettlementCredit(company.id, id, body, intent));
      refresh();
      return r;
    },
  };
}

export function useFetchSettlement() {
  const company = useRouteCompany();
  return async (id: string): Promise<LiveSettlement> => toSettlement(await live.getSettlement(company.id, id));
}
