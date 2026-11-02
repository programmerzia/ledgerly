/** Items seam, live side: the managed list (any state) and the writes. The pickers on document lines use `useTradeRefs`. */
import { useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/trade';
import type { ApiItem, ItemQuery } from '@/api/live/trade';
import { toLiveItem, type LiveItem } from '@/api/adapters/item';
import type { Intent } from '@/api/idempotency';
import { useRouteCompany } from './session';

export const itemsKey = (companyId: string) => ['items', companyId] as const;

export function useItemList(filters: ItemQuery) {
  const company = useRouteCompany();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as ItemQuery;
  const q = useInfiniteQuery({
    queryKey: [...itemsKey(company.id), 'list', clean],
    queryFn: ({ pageParam }) => live.listItemsPage(company.id, clean, pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<ApiItem>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map(toLiveItem), [q.data]);
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

export function useItemActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const after = async (p: Promise<ApiItem>): Promise<LiveItem> => {
    const r = await p;
    void qc.invalidateQueries({ queryKey: itemsKey(company.id) });
    void qc.invalidateQueries({ queryKey: ['trade-refs', company.id] });
    return toLiveItem(r);
  };
  return {
    create: (body: unknown, intent: Intent) => after(live.createItem(company.id, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updateItem(company.id, id, body, intent)),
    deactivate: (id: string, version: number, intent: Intent) => after(live.deactivateItem(company.id, id, version, intent)),
  };
}
