/** Payment runs seam, live side (13 §23). */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging, type CursorPage } from '@/api/cursor';
import * as live from '@/api/live/trade';
import { toPaymentRun, type ApiPaymentRun, type LivePaymentRun } from '@/api/adapters/paymentRun';
import type { Intent } from '@/api/idempotency';
import { approvalsKey } from './journals';
import { settlementsKey } from './settlements';
import { whtKey } from './wht';
import { useRouteCompany } from './session';
import type { DataResult } from './types';

export const runsKey = (companyId: string) => ['payment-runs', companyId] as const;

export function usePaymentRunList(filters: { status?: string }) {
  const company = useRouteCompany();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as { status?: string };
  const q = useInfiniteQuery({
    queryKey: [...runsKey(company.id), 'list', clean],
    queryFn: ({ pageParam }) => live.listPaymentRuns(company.id, clean, pageParam),
    ...cursorPaging,
    getNextPageParam: (last: CursorPage<ApiPaymentRun>) => last.meta.next_cursor ?? undefined,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data).map(toPaymentRun), [q.data]);
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

export function usePaymentRun(id: string | undefined): DataResult<LivePaymentRun | null> {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...runsKey(company.id), 'one', id], queryFn: () => live.getPaymentRun(company.id, id as string), enabled: Boolean(id), staleTime: 0 });
  const data = useMemo(() => (q.data ? toPaymentRun(q.data) : null), [q.data]);
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useFetchPaymentRun() {
  const company = useRouteCompany();
  return async (id: string): Promise<LivePaymentRun> => toPaymentRun(await live.getPaymentRun(company.id, id));
}

export function usePaymentRunActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: runsKey(company.id) });
    void qc.invalidateQueries({ queryKey: approvalsKey(company.id) });
    void qc.invalidateQueries({ queryKey: settlementsKey(company.id) });
    void qc.invalidateQueries({ queryKey: ['bills', company.id] });
    void qc.invalidateQueries({ queryKey: whtKey(company.id) });
    void qc.invalidateQueries({ queryKey: ['contacts', company.id] });
  };
  const after = async (p: Promise<ApiPaymentRun>): Promise<LivePaymentRun> => {
    const r = await p;
    if (r.id && r.items) qc.setQueryData([...runsKey(company.id), 'one', r.id], r);
    refresh();
    return toPaymentRun(r);
  };
  return {
    create: (body: unknown, intent: Intent) => after(live.createPaymentRun(company.id, body, intent)),
    update: (id: string, body: unknown, intent: Intent) => after(live.updatePaymentRun(company.id, id, body, intent)),
    preview: (id: string, intent: Intent) => live.previewPaymentRun(company.id, id, intent),
    submit: (id: string, version: number, intent: Intent) => after(live.transitionPaymentRun(company.id, id, 'submit', { version }, intent)),
    approve: (id: string, version: number, intent: Intent) => after(live.transitionPaymentRun(company.id, id, 'approve', { version }, intent)),
    sendBack: (id: string, comment: string, version: number, intent: Intent) => after(live.transitionPaymentRun(company.id, id, 'return', { comment, version }, intent)),
    voidDraft: (id: string, reason: string, version: number, intent: Intent) => after(live.transitionPaymentRun(company.id, id, 'void', { reason, version }, intent)),
    bankFile: (id: string, number: string | null) => live.downloadBankFile(company.id, id, `Bank_Payment_Run_${number ?? id}.csv`),
  };
}
