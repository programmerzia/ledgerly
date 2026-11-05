/** The statement run, live side (3c.7a). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as live from '@/api/live/statementRun';
import type { Intent } from '@/api/idempotency';

export const runKey = (companyId: string) => ['statement-run', companyId] as const;

export const useRunCustomers = (companyId: string, period: live.RunPeriod | null) =>
  useQuery({ queryKey: [...runKey(companyId), period], queryFn: () => live.listRunCustomers(companyId, period as live.RunPeriod), enabled: period !== null, retry: false });

export function useRunStatements(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period, ids, intent }: { period: live.RunPeriod; ids: string[]; intent: Intent }) => live.runStatements(companyId, period, ids, intent),
    onSuccess: () => qc.invalidateQueries({ queryKey: runKey(companyId) }),
  });
}

/** Follows queued statements until none is still queued (every 2 seconds). */
export const useSendStatuses = (companyId: string, ids: string[]) =>
  useQuery({
    queryKey: ['statement-run-sends', companyId, ids],
    queryFn: () => live.fetchSendStatuses(companyId, ids),
    enabled: ids.length > 0,
    retry: false,
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'queued') || !q.state.data ? 2000 : false),
  });
