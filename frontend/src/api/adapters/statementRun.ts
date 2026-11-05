/** The statement run (3c.7a): which customers start selected, whether the choice fits the hour, and how a result reads. */
import type { Allowance, RunCustomer, RunPeriod, RunResult, SendStatus } from '../live/statementRun';

/** Customers who owe money and can be emailed start selected; a customer with no email address can never be selected. */
export const defaultSelection = (rows: RunCustomer[]): string[] => rows.filter((r) => r.has_email && r.balance.amount > 0).map((r) => r.contact_id);

export type Fit = { ok: true } | { ok: false; message: string };

/** The run is refused whole by the server when it is over the allowance; say so before the person presses the button. */
export function fitsAllowance(selected: number, a: Allowance): Fit {
  if (selected <= a.remaining) return { ok: true };
  return {
    ok: false,
    message: `You chose ${selected} customers, but only ${a.remaining} more email${a.remaining === 1 ? '' : 's'} can go out this hour (the limit is ${a.limit} an hour; ${a.used} already went out). Choose ${a.remaining} or fewer now and run the rest later.`,
  };
}

/** Ready to load? An as-of run needs the date, a period run needs both dates in order. */
export function periodProblem(p: RunPeriod): string | null {
  if (p.basis === 'as_of') return p.as_of ? null : 'Choose the date.';
  if (!p.from || !p.to) return 'Choose the start and end dates.';
  return p.to < p.from ? 'The end date must not be before the start date.' : null;
}

const SKIP_LABEL: Record<string, string> = { no_email: 'No email address', no_balance: 'No balance', not_customer: 'Not a customer' };

/** One line for the results table. `sends` is what the mail queue says so far for queued rows. */
export function describeResult(r: RunResult, sends: Record<string, SendStatus>): { label: string; tone: 'ok' | 'wait' | 'bad'; detail: string } {
  if (r.status === 'queued') {
    const s = r.send_id ? sends[r.send_id] : undefined;
    if (s?.status === 'sent') return { label: 'Sent', tone: 'ok', detail: '' };
    if (s?.status === 'failed') return { label: 'Not delivered', tone: 'bad', detail: s.error ?? 'The mail server did not accept it.' };
    return { label: 'On its way', tone: 'wait', detail: '' };
  }
  if (r.status === 'skipped') return { label: SKIP_LABEL[r.code ?? ''] ?? 'Skipped', tone: 'wait', detail: r.reason ?? '' };
  return { label: 'Not sent', tone: 'bad', detail: r.reason ?? 'The statement could not be sent.' };
}

/** "3 on their way, 1 skipped, 0 failed". */
export function summarise(results: RunResult[]): string {
  const n = (s: string) => results.filter((r) => r.status === s).length;
  return `${n('queued')} queued, ${n('skipped')} skipped, ${n('failed')} failed`;
}
