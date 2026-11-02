import type { components } from '../schema';

export type ApiFiscalYear = components['schemas']['FiscalYearResource'];
export type ApiFiscalPeriod = components['schemas']['FiscalPeriodResource'];
export type ApiCloseCheck = components['schemas']['CloseCheckResource'];
export type ApiReopenRequest = components['schemas']['ReopenRequestResource'];

export type LivePeriodStatus = 'open' | 'soft_closed' | 'closed' | 'locked';

export interface LiveReopenRequest {
  id: string;
  period_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string;
  requested_by: string;
  first_approver_id: string | null;
  second_approver_id: string | null;
  first_signed_at: string | null;
  decision_comment: string | null;
  can: { approve: boolean; reject: boolean };
}

/** Snake-case keys so the existing PeriodTimeline accepts it unchanged. */
export interface LivePeriod {
  id: string;
  fiscal_year_id: string;
  number: number;
  name: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  status: LivePeriodStatus;
  soft_closed_at: string | null;
  closed_at: string | null;
  reopened_count: number;
  reopen_request: LiveReopenRequest | null;
  can: { soft_close: boolean; close: boolean; request_reopen: boolean };
}

export interface LiveFiscalYear {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: string;
  periods: LivePeriod[];
  can: { year_end: boolean; lock: boolean };
}

export interface LiveCloseCheck {
  id: string;
  check_code: string;
  title: string;
  detail: string;
  status: 'pass' | 'fail';
}

export function toReopenRequest(r: ApiReopenRequest): LiveReopenRequest {
  const can = r.can;
  return {
    id: r.id,
    period_id: r.fiscal_period_id,
    status: r.status,
    reason: r.reason,
    requested_by: r.requested_by,
    first_approver_id: r.first_approver,
    second_approver_id: r.second_approver,
    first_signed_at: r.first_signed_at,
    decision_comment: r.decision_comment,
    can: { approve: can.approve === true, reject: can.reject === true },
  };
}

export function toPeriod(p: ApiFiscalPeriod): LivePeriod {
  const can = p.can;
  return {
    id: p.id,
    fiscal_year_id: p.fiscal_year_id,
    number: p.number,
    name: p.name,
    kind: p.kind,
    starts_on: p.starts_on ?? '',
    ends_on: p.ends_on ?? '',
    status: p.status,
    soft_closed_at: p.soft_closed_at,
    closed_at: p.closed_at,
    reopened_count: p.reopened_count,
    reopen_request: p.reopen_request ? toReopenRequest(p.reopen_request) : null,
    can: { soft_close: can.soft_close === true, close: can.close === true, request_reopen: can.request_reopen === true },
  };
}

export function toFiscalYear(y: ApiFiscalYear): LiveFiscalYear {
  const can = y.can;
  return {
    id: y.id,
    name: y.name,
    starts_on: y.starts_on ?? '',
    ends_on: y.ends_on ?? '',
    status: y.status,
    periods: (y.periods ?? []).map(toPeriod),
    can: { year_end: can.year_end === true, lock: can.lock === true },
  };
}

/** Display names for the check codes the API knows today; an unknown code shows as itself. */
const CHECK_TITLES: Record<string, string> = {
  DRAFTS: 'No unposted drafts',
  APPROVALS: 'No documents waiting for approval',
  BANK_REC: 'Bank accounts reconciled',
  FX_REVAL: 'Foreign-currency balances adjusted',
};

export function checkTitle(code: string): string {
  return CHECK_TITLES[code] ?? code;
}

export function toCloseCheck(c: ApiCloseCheck): LiveCloseCheck {
  return { id: c.code, check_code: c.code, title: checkTitle(c.code), detail: c.message, status: c.passed ? 'pass' : 'fail' };
}

/**
 * Close body: `waivers` maps a failing check code to the reason it is acceptable (ClosePeriodInput). The generated
 * type says `string[]`, which is wrong; the backend test sends `{DRAFTS: 'reason'}`. Blank reasons are dropped, since
 * the server ignores them anyway.
 */
export function toCloseBody(waivers: Record<string, string>): { waivers?: Record<string, string> } {
  const entries = Object.entries(waivers).map(([k, v]) => [k, v.trim()] as const).filter(([, v]) => v !== '');
  return entries.length ? { waivers: Object.fromEntries(entries) } : {};
}

/** The year the page opens on: the open one with the most recent start, else the first listed. */
export function defaultYear(years: LiveFiscalYear[]): LiveFiscalYear | undefined {
  const open = years.filter((y) => y.status === 'open').sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  return open[0] ?? years[0];
}

/** The period the page opens on: first period that is still open, else the first one. */
export function defaultPeriod(year: LiveFiscalYear | undefined): LivePeriod | undefined {
  if (!year) return undefined;
  return year.periods.find((p) => p.kind !== 'adjustment' && p.status !== 'closed' && p.status !== 'locked') ?? year.periods[0];
}
