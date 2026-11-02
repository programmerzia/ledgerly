/** Repeating journal entries, live side (docs/15): GET/POST /recurring-journals, pause/resume, "run now". */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLedgerStore } from '@/mock/store';
import { fetchAllPages } from '@/api/cursor';
import * as live from '@/api/live/journals';
import { toRecurringJournal, type RecurringJournal } from '@/api/adapters/journal';
import type { Intent } from '@/api/idempotency';
import { journalsKey } from './journals';
import type { DataResult } from './types';

export const recurringKey = (companyId: string) => ['recurring-journals', companyId] as const;

export function useRecurringJournals(): DataResult<RecurringJournal[]> {
  const company = useLedgerStore((s) => s.currentCompany);
  const q = useQuery({
    queryKey: recurringKey(company.id),
    queryFn: async () => (await fetchAllPages((cursor) => live.listRecurringJournals(company.id, cursor))).map(toRecurringJournal),
  });
  return { data: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export interface RecurringInput {
  name: string;
  template_id: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  next_date: string;
  end_date?: string;
}

export function useRecurringActions() {
  const company = useLedgerStore((s) => s.currentCompany);
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: recurringKey(company.id) });
    void qc.invalidateQueries({ queryKey: journalsKey(company.id) });
  };
  return {
    create: async (input: RecurringInput, intent: Intent) => {
      const r = await live.createRecurringJournal(company.id, { ...input, end_date: input.end_date || null }, intent);
      refresh();
      return toRecurringJournal(r);
    },
    toggle: async (s: RecurringJournal, intent: Intent) => {
      const r = await live.toggleRecurringJournal(company.id, s.id, s.is_active ? 'pause' : 'resume', s.version, intent);
      refresh();
      return toRecurringJournal(r);
    },
    /** Creates the drafts due up to today (the server's today); drafts only, nothing posts. */
    runNow: async (intent: Intent, scheduleId?: string) => {
      const r = await live.runRecurring(company.id, scheduleId ? { schedule_id: scheduleId } : {}, intent);
      refresh();
      return r.created;
    },
  };
}
