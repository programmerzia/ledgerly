/** Overdue-invoice reminders, live side (3c.7). Query keys: ['dunning', companyId] and ['dunning-preview', companyId]. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as live from '@/api/live/dunning';
import type { Intent } from '@/api/idempotency';

export const dunningKey = (companyId: string) => ['dunning', companyId] as const;
export const dunningPreviewKey = (companyId: string) => ['dunning-preview', companyId] as const;

export const useDunning = (companyId: string) => useQuery({ queryKey: dunningKey(companyId), queryFn: () => live.fetchDunning(companyId), retry: false });

export const useDunningPreview = (companyId: string, enabled: boolean) =>
  useQuery({ queryKey: dunningPreviewKey(companyId), queryFn: () => live.fetchDunningPreview(companyId), enabled, retry: false });

export function useSaveDunning(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, intent }: { body: live.DunningBody; intent: Intent }) => live.saveDunning(companyId, body, intent),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: dunningKey(companyId) }), qc.invalidateQueries({ queryKey: dunningPreviewKey(companyId) })]),
  });
}
