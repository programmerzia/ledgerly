/** WHT certificates seam, live side (13 §23). Read only. */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { cursorPaging, fetchAllPages, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/trade';
import type { WhtQuery } from '@/api/live/trade';
import { toWhtCertificate, type ApiWhtCertificate } from '@/api/adapters/wht';
import { useRouteCompany } from './session';

export const whtKey = (companyId: string) => ['wht-certificates', companyId] as const;

export function useWhtCertificateList(filters: WhtQuery) {
  const company = useRouteCompany();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as WhtQuery;
  const q = useInfiniteQuery({
    queryKey: [...whtKey(company.id), 'list', clean],
    queryFn: ({ pageParam }) => live.listWhtCertificates(company.id, clean, pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<ApiWhtCertificate>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map(toWhtCertificate), [q.data]);
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

/** The certificates one payment issued (the server filters on `payment_id`). */
export function useWhtCertificates(of: { payment_id: string } | null) {
  const company = useRouteCompany();
  const q = useQuery({
    queryKey: [...whtKey(company.id), 'of-payment', of?.payment_id],
    enabled: Boolean(of),
    staleTime: 0,
    queryFn: async () => (await fetchAllPages((cursor) => live.listWhtCertificates(company.id, { payment_id: of?.payment_id }, cursor, 100))).map(toWhtCertificate),
  });
  return { rows: q.data ?? [], isLoading: q.isLoading, error: q.error };
}
