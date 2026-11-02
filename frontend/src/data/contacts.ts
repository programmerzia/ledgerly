/**
 * Contacts seam, live side (docs/15). Customers and suppliers are the same resource (`kind`); the sales screens pass
 * `kind: 'customer'`, the purchases screens will pass `supplier`. The mock screens keep reading the store.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging, fetchAllPages, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/trade';
import { toContact, type ApiContact, type LiveContact } from '@/api/adapters/contact';
import type { Intent } from '@/api/idempotency';
import { useRouteCompany } from './session';
import type { DataResult } from './types';

export const contactsKey = (companyId: string) => ['contacts', companyId] as const;

function useScope() {
  const company = useRouteCompany();
  return { company, scope: { tenantId: company.tenant_id, companyId: company.id } };
}

export interface ContactFilters {
  kind?: string;
  active?: string;
  search?: string;
}

export function useContactList(filters: ContactFilters) {
  const { company, scope } = useScope();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as ContactFilters;
  const q = useInfiniteQuery({
    queryKey: [...contactsKey(company.id), 'list', clean],
    queryFn: ({ pageParam }) => live.listContacts(company.id, clean, pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<ApiContact>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map((a) => toContact(a, scope)), [q.data, scope]);
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

export function useContact(id: string | undefined): DataResult<LiveContact | null> {
  const { company, scope } = useScope();
  const q = useQuery({ queryKey: [...contactsKey(company.id), 'one', id], queryFn: () => live.getContact(company.id, id as string), enabled: Boolean(id), staleTime: 0 });
  const data = useMemo(() => (q.data ? toContact(q.data, scope) : null), [q.data, scope]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/** Every active contact of a kind (pickers, name lookups). The server includes `both` contacts under either kind. */
export function useContactDirectory(kind: 'customer' | 'supplier', includeInactive = false) {
  const { company, scope } = useScope();
  const q = useQuery({
    queryKey: [...contactsKey(company.id), 'directory', kind, includeInactive],
    queryFn: () => fetchAllPages((cursor) => live.listContacts(company.id, { kind, active: includeInactive ? undefined : 'true' }, cursor, 200)),
  });
  const contacts = useMemo(() => (q.data ?? []).map((a) => toContact(a, scope)), [q.data, scope]);
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  return { contacts, byId, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useContactActions() {
  const { company, scope } = useScope();
  const qc = useQueryClient();
  const after = async (p: Promise<ApiContact>): Promise<LiveContact> => {
    const r = await p;
    qc.setQueryData([...contactsKey(company.id), 'one', r.id], r);
    void qc.invalidateQueries({ queryKey: contactsKey(company.id) });
    return toContact(r, scope);
  };
  return {
    create: (body: unknown, intent: Intent) => after(live.createContact(company.id, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updateContact(company.id, id, body, intent)),
    deactivate: (id: string, version: number, intent: Intent) => after(live.deactivateContact(company.id, id, version, intent)),
  };
}
