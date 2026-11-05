/**
 * The parameters of a report as they live in the page's query string, so a report can be reloaded, shared and reached
 * from a drill link. Pure functions; the hook in pages/Reports/live/useSelection.ts wires them to the router.
 * Dates are plain ISO text; the only date arithmetic is picking the first of a month for a default range.
 */
import type { Basis, Comparison, ReportSelection, When } from './report';

export interface PeriodChoice {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  kind: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/;

export function selectionFromSearch(sp: URLSearchParams): Partial<ReportSelection> {
  const out: Partial<ReportSelection> = {};
  const period = sp.get('period');
  const from = sp.get('from');
  const to = sp.get('to');
  const asof = sp.get('asof');
  if (period && UUID.test(period)) out.when = { kind: 'period', periodId: period };
  else if (to && DATE.test(to) && (!from || DATE.test(from))) out.when = { kind: 'range', from: from ?? '', to };
  else if (asof && DATE.test(asof)) out.when = { kind: 'asof', date: asof };
  const basis = sp.get('basis');
  if (basis === 'month' || basis === 'ytd') out.basis = basis;
  const cmp = sp.get('cmp');
  if (cmp === 'previous_period' || cmp === 'previous_year' || cmp === 'none') out.comparison = cmp;
  if (sp.get('zero') === '1') out.hideZero = true;
  if (sp.get('zero') === '0') out.hideZero = false;
  const dims: Record<string, string> = {};
  sp.forEach((value, key) => {
    if (key.startsWith('d.') && UUID.test(key.slice(2)) && UUID.test(value)) dims[key.slice(2)] = value;
  });
  if (Object.keys(dims).length > 0) out.dims = dims;
  const account = sp.get('account');
  if (account && UUID.test(account)) out.accountId = account;
  const contact = sp.get('contact');
  if (contact && UUID.test(contact)) out.contactId = contact;
  const budget = sp.get('budget');
  if (budget && UUID.test(budget)) out.budgetId = budget;
  return out;
}

export function selectionToSearch(sel: ReportSelection): URLSearchParams {
  const sp = new URLSearchParams();
  const w = sel.when;
  if (w.kind === 'period') sp.set('period', w.periodId);
  else if (w.kind === 'range') {
    if (w.from) sp.set('from', w.from);
    sp.set('to', w.to);
  } else sp.set('asof', w.date);
  if (sel.basis !== 'month') sp.set('basis', sel.basis);
  if (sel.comparison !== 'none') sp.set('cmp', sel.comparison);
  sp.set('zero', sel.hideZero ? '1' : '0');
  for (const [id, value] of Object.entries(sel.dims)) if (value) sp.set(`d.${id}`, value);
  if (sel.accountId) sp.set('account', sel.accountId);
  if (sel.contactId) sp.set('contact', sel.contactId);
  if (sel.budgetId) sp.set('budget', sel.budgetId);
  return sp;
}

/** The regular period that contains `today`, else the latest regular period that has started. */
export function currentPeriod(periods: PeriodChoice[], today: string): PeriodChoice | undefined {
  const regular = periods.filter((p) => p.kind !== 'adjustment');
  return (
    regular.find((p) => p.starts_on <= today && today <= p.ends_on) ??
    [...regular].filter((p) => p.starts_on <= today).sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0]
  );
}

export type ReportKind = 'asof' | 'range';

export function defaultWhen(kind: ReportKind, periods: PeriodChoice[], today: string): When {
  if (kind === 'asof') return { kind: 'asof', date: today };
  const p = currentPeriod(periods, today);
  return p ? { kind: 'period', periodId: p.id } : { kind: 'range', from: `${today.slice(0, 8)}01`, to: today };
}

export function defaultSelection(kind: ReportKind, periods: PeriodChoice[], today: string, hideZero = false): ReportSelection {
  return { when: defaultWhen(kind, periods, today), basis: 'month', comparison: 'none', hideZero, dims: {} };
}

/** Explicit parameters win; whatever the page did not set falls back to the defaults. */
export function resolveSelection(sp: URLSearchParams, kind: ReportKind, periods: PeriodChoice[], today: string, hideZero = false): ReportSelection {
  const explicit = selectionFromSearch(sp);
  const base = defaultSelection(kind, periods, today, hideZero);
  // A period or range in the URL on an as-of report (or the reverse) is turned into the nearest valid form.
  let when = explicit.when ?? base.when;
  if (kind === 'asof' && when.kind === 'range') when = { kind: 'asof', date: when.to };
  if (kind === 'range' && when.kind === 'asof') when = { kind: 'range', from: `${when.date.slice(0, 8)}01`, to: when.date };
  return { ...base, ...explicit, when, basis: (explicit.basis ?? base.basis) as Basis, comparison: (explicit.comparison ?? base.comparison) as Comparison };
}
