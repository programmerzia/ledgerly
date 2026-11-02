/** Recurring invoices and bills, live side: GET/POST/PUT /recurring-invoices, pause/resume, "run now" (13 §23). */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAllPages } from '@/api/cursor';
import * as live from '@/api/live/trade';
import { toRecurringDoc, type RecurringDoc } from '@/api/adapters/recurring';
import type { Intent } from '@/api/idempotency';
import { useRouteCompany } from './session';

export const recurringDocsKey = (companyId: string) => ['recurring-docs', companyId] as const;

/** `type` is the server's document type: `invoice` or `bill`. */
export function useRecurringDocs(type: 'invoice' | 'bill') {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: recurringDocsKey(company.id), queryFn: () => fetchAllPages((c) => live.listRecurringDocs(company.id, c)) });
  const rows: RecurringDoc[] = useMemo(() => (q.data ?? []).map(toRecurringDoc).filter((s) => s.document_type === type), [q.data, type]);
  return { rows, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useRecurringDocActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: recurringDocsKey(company.id) });
    void qc.invalidateQueries({ queryKey: ['invoices', company.id] });
    void qc.invalidateQueries({ queryKey: ['bills', company.id] });
  };
  return {
    create: async (body: unknown, intent: Intent) => {
      const r = toRecurringDoc(await live.createRecurringDoc(company.id, body, intent));
      refresh();
      return r;
    },
    update: async (id: string, body: unknown, intent: Intent) => {
      const r = toRecurringDoc(await live.updateRecurringDoc(company.id, id, body, intent));
      refresh();
      return r;
    },
    toggle: async (s: RecurringDoc, intent: Intent) => {
      const r = toRecurringDoc(await live.toggleRecurringDoc(company.id, s.id, s.is_active ? 'pause' : 'resume', s.version, intent));
      refresh();
      return r;
    },
    /** Makes the drafts due up to the server's today, for every schedule or for one. Drafts only, nothing posts. */
    runNow: async (intent: Intent, scheduleId?: string) => {
      const r = await live.runRecurringDocs(company.id, scheduleId ? { schedule_id: scheduleId } : {}, intent);
      refresh();
      return r;
    },
  };
}
