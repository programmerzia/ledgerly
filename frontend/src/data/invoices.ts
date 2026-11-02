/**
 * Documents seam, live side: invoices and credit notes (and, for the purchases step, bills and debit notes: pass
 * `resource: 'bills'`). The write path is a draft, a server preview, a submit under the signing grant and a server
 * verdict, so the live screens are separate components (`pages/Sales/live/*`) chosen by mode.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging, fetchAllPages, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/trade';
import type { DocResource, DocQuery } from '@/api/live/trade';
import { toDoc, type ApiInvoice, type LiveDoc } from '@/api/adapters/invoice';
import { toCreditApplication } from '@/api/adapters/settlement';
import type { Intent } from '@/api/idempotency';
import { approvalsKey } from './journals';
import { contactsKey } from './contacts';
import { settlementsKey } from './settlements';
import { useRouteCompany } from './session';
import type { DataResult } from './types';

export const docsKey = (companyId: string, resource: DocResource = 'invoices') => [resource, companyId] as const;

export type DocFilters = DocQuery;

export function useDocList(filters: DocFilters, resource: DocResource = 'invoices') {
  const company = useRouteCompany();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as DocFilters;
  const q = useInfiniteQuery({
    queryKey: [...docsKey(company.id, resource), 'list', clean],
    queryFn: ({ pageParam }) => live.listDocs(company.id, resource, clean, pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<ApiInvoice>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map(toDoc), [q.data]);
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

export function useDoc(id: string | undefined, resource: DocResource = 'invoices'): DataResult<LiveDoc | null> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...docsKey(company.id, resource), 'one', id], queryFn: () => live.getDoc(company.id, resource, id as string), enabled: Boolean(id), staleTime: 0 });
  const data = useMemo(() => (q.data ? toDoc(q.data) : null), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/**
 * Posted documents of one contact that still have something open. The server filters by contact, kind and status;
 * "something open" is the server's own `amount_due` being above zero.
 */
export function useOpenDocs(contactId: string | undefined, kind: string, resource: DocResource = 'invoices') {
  const company = useRouteCompany();
  const q = useQuery({
    queryKey: [...docsKey(company.id, resource), 'open', contactId, kind],
    enabled: Boolean(contactId),
    staleTime: 0,
    queryFn: async () => {
      const rows = await fetchAllPages((cursor) => live.listDocs(company.id, resource, { contact_id: contactId, kind, status: 'posted' }, cursor, 100));
      return rows.map(toDoc).filter((d) => d.amount_due > 0);
    },
  });
  return { docs: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/** Every posted document of a kind with something still open, across contacts (the payment run picks from these). */
export function useAllOpenDocs(kind: string, resource: DocResource = 'bills') {
  const company = useRouteCompany();
  const q = useQuery({
    queryKey: [...docsKey(company.id, resource), 'open-all', kind],
    staleTime: 0,
    queryFn: async () => {
      const rows = await fetchAllPages((cursor) => live.listDocs(company.id, resource, { kind, status: 'posted' }, cursor, 100));
      return rows.map(toDoc).filter((d) => d.amount_due > 0);
    },
  });
  return { docs: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useDocActions(resource: DocResource = 'invoices') {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: docsKey(company.id, resource) });
    void qc.invalidateQueries({ queryKey: approvalsKey(company.id) });
    void qc.invalidateQueries({ queryKey: contactsKey(company.id) });
    void qc.invalidateQueries({ queryKey: settlementsKey(company.id) });
  };
  // What the server answered is the document now: put it in the cache so the next screen never shows the old state.
  const after = async (p: Promise<ApiInvoice>): Promise<LiveDoc> => {
    const r = await p;
    if (r.id && r.lines) qc.setQueryData([...docsKey(company.id, resource), 'one', r.id], r);
    refresh();
    return toDoc(r);
  };
  return {
    create: (body: unknown, intent: Intent) => after(live.createDoc(company.id, resource, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updateDoc(company.id, resource, id, body, intent)),
    /** Writes nothing on the server, so no refresh. */
    preview: (id: string, intent: Intent) => live.previewDoc(company.id, resource, id, intent),
    submit: (id: string, version: number, intent: Intent) => after(live.transitionDoc(company.id, resource, id, 'submit', { version }, intent)),
    approve: (id: string, version: number, intent: Intent) => after(live.transitionDoc(company.id, resource, id, 'approve', { version }, intent)),
    sendBack: (id: string, comment: string, version: number, intent: Intent) => after(live.transitionDoc(company.id, resource, id, 'return', { comment, version }, intent)),
    voidDraft: (id: string, reason: string, version: number, intent: Intent) => after(live.transitionDoc(company.id, resource, id, 'void', { reason, version }, intent)),
    reverse: (id: string, body: { memo?: string; date?: string; version: number }, intent: Intent) => after(live.transitionDoc(company.id, resource, id, 'reverse', body, intent)),
    /** Applies a posted credit note to an open invoice of the same contact. */
    applyCredit: async (id: string, body: { invoice_id: string; amount_fc: number; date?: string }, intent: Intent) => {
      const r = toCreditApplication(await live.applyCredit(company.id, resource, id, body, intent));
      refresh();
      return r;
    },
  };
}

/** One-off fetch (reload after a 409) through the same adapter as the screens. */
export function useFetchDoc(resource: DocResource = 'invoices') {
  const company = useRouteCompany();
  return async (id: string): Promise<LiveDoc> => toDoc(await live.getDoc(company.id, resource, id));
}
