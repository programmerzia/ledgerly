/** Overdue-invoice reminders (3c.7): the settings form and what is sent as a patch. */
import type { DunningBody, DunningSettings } from '../live/dunning';

export interface StageForm {
  /** Present for a stage that already exists. */
  id: string | null;
  days: string;
  subject: string;
  body: string;
  sentCount: number;
}

export interface DunningForm {
  enabled: boolean;
  stages: StageForm[];
}

export const MAX_STAGES = 6;

export const toDunningForm = (s: DunningSettings): DunningForm => ({
  enabled: s.enabled,
  stages: s.stages.map((x) => ({ id: x.id, days: String(x.days_after_due), subject: x.subject, body: x.body, sentCount: x.sent_count })),
});

export const blankStage = (days: number): StageForm => ({
  id: null,
  days: String(days),
  subject: 'Reminder: invoice {{document_number}} is overdue',
  body: 'Dear {{contact_name}},\n\nInvoice {{document_number}} for {{total}} was due on {{due_date}} and is now {{days_overdue}} days overdue. The balance is {{amount_due}}.\n\n{{payment_instructions}}\n\nIf you have already paid, please ignore this message.\n\nKind regards,\n{{sender_name}}\n{{company_name}}',
  sentCount: 0,
});

export type DunningResult = { ok: true; body: DunningBody } | { ok: false; errors: Record<string, string> };

/** Form -> request, with the problems a person can fix before sending. The server checks the same rules again. */
export function toDunningRequest(f: DunningForm, version: number, allowed: string[]): DunningResult {
  const errors: Record<string, string> = {};
  const seen = new Set<number>();
  f.stages.forEach((s, i) => {
    const days = /^\d+$/.test(s.days) ? Number(s.days) : 0;
    if (days < 1 || days > 365) errors[`days${i}`] = 'Enter a whole number of days from 1 to 365.';
    else if (seen.has(days)) errors[`days${i}`] = 'Another stage already uses this day.';
    seen.add(days);
    if (!s.subject.trim() || !s.body.trim()) errors[`text${i}`] = 'Give the reminder a subject and a message.';
    const bad = [...`${s.subject}\n${s.body}`.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1] ?? '').filter((n) => !allowed.includes(n));
    if (bad.length > 0) errors[`text${i}`] = `Unknown placeholder ${[...new Set(bad)].map((b) => `{{ ${b} }}`).join(', ')}.`;
  });
  if (f.enabled && f.stages.length === 0) errors.stages = 'Add at least one stage before switching reminders on.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      enabled: f.enabled,
      stages: f.stages.map((s) => ({ id: s.id, days_after_due: Number(s.days), subject: s.subject.trim(), body: s.body.trim() })),
      version,
    },
  };
}

/** "7 days after the due date". */
export const describeStageDays = (days: number): string => `${days} day${days === 1 ? '' : 's'} after the due date`;
