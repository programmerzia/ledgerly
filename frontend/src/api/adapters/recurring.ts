/** Recurring invoices and bills: a schedule that copies a posted document on a date. Same resource as recurring journals, plus what it copies. */
import { toRecurringJournal, type ApiRecurringSchedule, type RecurringJournal } from './journal';

export interface RecurringDoc extends RecurringJournal {
  /** `invoice` or `bill` as the server names them. */
  document_type: string;
}

export function toRecurringDoc(s: ApiRecurringSchedule): RecurringDoc {
  return { ...toRecurringJournal(s), document_type: s.document_type ?? '' };
}

export interface ScheduleDraft {
  name: string;
  template_id: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  next_date: string;
  end_date: string;
}

export function toScheduleRequest(d: ScheduleDraft, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: d.name.trim(),
    template_id: d.template_id,
    frequency: d.frequency,
    next_date: d.next_date,
    end_date: d.end_date || null,
  };
  if (version !== undefined) body.version = version;
  return body;
}
