import { describe, it, expect } from 'vitest';
import { toAccount, toAccountRequest, toNewAccountRequest, toDimensionRulesRequest, toCan, pickableAccounts, toVisibilityRequest, type ApiAccount } from '@/api/adapters/account';
import { toFiscalYear, toCloseBody, toCloseCheck, defaultYear, defaultPeriod, type ApiFiscalYear } from '@/api/adapters/fiscal';
import { toRate, toRevalPreview, toRevalRun, isRateText, toRateRequest } from '@/api/adapters/fx';
import { toDimension } from '@/api/adapters/dimension';
import { problemToError } from '@/api/errors';
import { isLiveRoute } from '@/data/liveRoutes';

const raw: ApiAccount = {
  id: 'a1', code: '4000', name: 'Sales', account_type: 'income', account_subtype: 'Revenue', normal_balance: 'credit', parent_id: 'p1',
  currency_policy: 'fixed', fixed_currency: 'EUR', control_type: 'ar', allow_manual_journals: false, is_postable: true, is_active: true,
  description: null, is_hidden: false, ifrs_element: null, version: 4, dimension_rules: { d1: 'required' }, can: { update: true, deactivate: false } as unknown as [],
};
const scope = { tenantId: 't', companyId: 'c' };

describe('account adapter (3.2)', () => {
  it('reads the can object and version', () => {
    const a = toAccount(raw, scope);
    expect(a.version).toBe(4);
    expect(a.parent_id).toBe('p1');
    expect(a.can).toEqual({ update: true, deactivate: false });
    expect(a.dimension_rules).toEqual({ d1: 'required' });
  });
  it('treats an empty array can (a resource without permissions) as no permission', () => {
    expect(toCan([])).toEqual({});
    expect(toAccount({ ...raw, can: [] as unknown as [], dimension_rules: [] as unknown as undefined }, scope).can).toEqual({ update: undefined, deactivate: undefined });
  });
  it('an edit repeats every field it is not changing, with the version it was based on', () => {
    const body = toAccountRequest(toAccount(raw, scope), { name: 'Revenue' });
    expect(body).toEqual({
      code: '4000', name: 'Revenue', account_type: 'income', account_subtype: 'Revenue', normal_balance: 'credit', parent_id: 'p1',
      currency_policy: 'fixed', fixed_currency: 'EUR', control_type: 'ar', allow_manual_journals: false, is_postable: true, description: null, version: 4,
    });
  });
  it('toggling allow-manual changes only that field', () => {
    const body = toAccountRequest(toAccount(raw, scope), { allow_manual_journals: true });
    expect(body.allow_manual_journals).toBe(true);
    expect(body.control_type).toBe('ar');
  });
  it('drops the fixed currency unless the policy is fixed, and maps a missing control type to none', () => {
    const a = toAccount({ ...raw, currency_policy: 'any', control_type: 'none' }, scope);
    const body = toAccountRequest({ ...a, control_type: null as never }, {});
    expect(body.fixed_currency).toBeNull();
    expect(body.control_type).toBe('none');
  });
  it('a new account sends only what the form collects', () => {
    expect(toNewAccountRequest({ code: '6100', name: 'Rent', account_type: 'expense', normal_balance: 'debit', account_subtype: '', description: '' })).toEqual({
      code: '6100', name: 'Rent', account_type: 'expense', normal_balance: 'debit', account_subtype: null, description: null, parent_id: null,
    });
  });
  it('carries the hidden flag and the IFRS element, and an edit never sends them', () => {
    const a = toAccount({ ...raw, is_hidden: true, ifrs_element: 'Goodwill' }, scope);
    expect(a.is_hidden).toBe(true);
    expect(a.ifrs_element).toBe('Goodwill');
    expect(toAccount(raw, scope).ifrs_element).toBeNull();
    expect(Object.keys(toAccountRequest(a, {}))).not.toContain('is_hidden');
  });
  it('leaves hidden accounts out of pickers unless the form already uses them', () => {
    const shown = toAccount(raw, scope);
    const hidden = { ...toAccount({ ...raw, id: 'a2', is_hidden: true }, scope) };
    expect(pickableAccounts([shown, hidden]).map((x) => x.id)).toEqual(['a1']);
    expect(pickableAccounts([shown, hidden], ['a2', '', null]).map((x) => x.id)).toEqual(['a1', 'a2']);
  });
  it('sends the visibility change with the version it was based on', () => {
    expect(toVisibilityRequest(toAccount(raw, scope), true)).toEqual({ hidden: true, version: 4 });
    expect(toVisibilityRequest({}, false)).toEqual({ hidden: false, version: 0 });
  });
  it('dimension rules: "no rule" is simply not sent', () => {
    expect(toDimensionRulesRequest({ d1: 'required', d2: 'none', d3: 'forbidden' })).toEqual({
      rules: [{ dimension_id: 'd1', rule: 'required' }, { dimension_id: 'd3', rule: 'forbidden' }],
    });
    expect(toDimensionRulesRequest({ d1: 'none' })).toEqual({ rules: [] });
  });
});

const period = (over: Record<string, unknown> = {}) => ({
  id: 'p1', fiscal_year_id: 'y1', number: 1, name: 'Jan 2026', kind: 'regular', starts_on: '2026-01-01', ends_on: '2026-01-31', status: 'open',
  soft_closed_at: null, closed_at: null, closed_by: null, reopened_count: 0, reopen_request: null,
  can: { soft_close: true, close: false, request_reopen: false }, ...over,
});
const year = (periods: unknown[]): ApiFiscalYear =>
  ({ id: 'y1', name: 'FY2026', starts_on: '2026-01-01', ends_on: '2026-12-31', status: 'open', periods, can: { year_end: false, lock: false } }) as unknown as ApiFiscalYear;

describe('fiscal adapter (3.2)', () => {
  it('maps can hints and the pending reopen request', () => {
    const y = toFiscalYear(year([period({ status: 'closed', can: { soft_close: false, close: false, request_reopen: true }, reopen_request: { id: 'r1', fiscal_period_id: 'p1', status: 'pending', reason: 'x', requested_by: 'u1', first_approver: 'u2', first_signed_at: null, second_approver: null, second_signed_at: null, decided_at: null, decision_comment: null, can: { approve: true, reject: false } } })]));
    const p = y.periods[0];
    expect(p.can.request_reopen).toBe(true);
    expect(p.reopen_request).toMatchObject({ id: 'r1', first_approver_id: 'u2', can: { approve: true, reject: false } });
    expect(y.can).toEqual({ year_end: false, lock: false });
  });
  it('waivers go as {code: reason}, blank reasons dropped, and nothing when none', () => {
    expect(toCloseBody({ DRAFTS: ' carried over ', BANK_REC: '  ' })).toEqual({ waivers: { DRAFTS: 'carried over' } });
    expect(toCloseBody({})).toEqual({});
  });
  it('close checks keep the server message and code', () => {
    expect(toCloseCheck({ code: 'DRAFTS', passed: false, message: '2 drafts', detail: {} })).toEqual({ id: 'DRAFTS', check_code: 'DRAFTS', title: 'No unposted drafts', detail: '2 drafts', status: 'fail' });
    expect(toCloseCheck({ code: 'NEW_ONE', passed: true, message: 'ok', detail: {} }).title).toBe('NEW_ONE');
  });
  it('picks the open year and its first non-closed month', () => {
    const y = toFiscalYear(year([period({ id: 'a', status: 'closed' }), period({ id: 'b' }), period({ id: 'adj', kind: 'adjustment' })]));
    expect(defaultYear([y])?.id).toBe('y1');
    expect(defaultPeriod(y)?.id).toBe('b');
    expect(defaultPeriod(undefined)).toBeUndefined();
  });
});

describe('fx adapter (3.2)', () => {
  it('keeps rates as the strings the server sent', () => {
    const r = toRate({ id: '1', from_currency: 'EUR', to_currency: 'USD', rate_date: '2026-03-31', rate: '1.12000000', source: 'manual', created_by: null, created_at: null });
    expect(r.rate).toBe('1.12000000');
    expect(typeof r.rate).toBe('string');
  });
  it('rate input must be a plain decimal with up to 8 places', () => {
    for (const ok of ['1', '1.12', '0.00000001', '123456789012.12345678']) expect(isRateText(ok)).toBe(true);
    for (const bad of ['', '1.123456789', '-1', '1e5', '1,5', 'abc', '1.']) expect(isRateText(bad)).toBe(false);
    expect(toRateRequest({ from: ' eur', to: 'usd ', date: '2026-03-31', rate: ' 1.12 ' })).toEqual({ from_currency: 'EUR', to_currency: 'USD', rate_date: '2026-03-31', rate: '1.12' });
  });
  it('preview money becomes integer minor units, rates stay strings', () => {
    const money = (amount: number, currency = 'USD') => ({ amount, currency });
    const p = toRevalPreview({
      fiscal_period_id: 'p', as_of: '2026-03-31', can_run: true, blockers: [], existing_revaluation_id: null, total_unrealised: money(2000), missing_rates: [],
      items: [{ account_id: 'a', account_code: '1200', contact_id: null, currency: 'EUR', amount_fc: money(100000, 'EUR'), closing_rate: '1.12000000', rate_date: '2026-03-31', rate_source: 'manual', carried_base: money(110000), revalued_base: money(112000), unrealised: money(2000) }],
      residuals: [],
    });
    expect(p.total_unrealised).toBe(2000);
    expect(p.items[0]).toMatchObject({ amount_fc: 100000, closing_rate: '1.12000000', revalued_base: 112000, unrealised: 2000, currency: 'EUR' });
    expect(p.base_currency).toBe('USD');
  });
  it('a run keeps its journal ids and reversal state', () => {
    const r = toRevalRun({ id: 'r', fiscal_period_id: 'p', as_of: '2026-03-31', status: 'posted', journal_id: 'j1', reversal_journal_id: null, reversal_pending: true, total_unrealised: { amount: -5, currency: 'USD' }, items: [], residuals: [], created_by: null });
    expect(r).toMatchObject({ journal_id: 'j1', reversal_pending: true, total_unrealised: -5 });
  });
});

describe('dimension adapter and live routes (3.2)', () => {
  it('maps values and can hints', () => {
    const d = toDimension({ id: 'd', code: 'DEPT', name: 'Department', position: 1, is_active: true, version: 2, can: { update: true, deactivate: true } as unknown as [], values: [{ id: 'v', dimension_id: 'd', code: 'OPS', name: 'Ops', parent_id: null, is_active: true, version: 0 }] });
    expect(d.can).toEqual({ update: true, deactivate: true });
    expect(d.values[0].version).toBe(0);
  });
  it('registers the finished screens', () => {
    for (const p of ['accounts', 'dimensions', 'periods', 'fx-rates']) expect(isLiveRoute(`/acme/${p}`)).toBe(true);
    expect(isLiveRoute('/acme/periods/close-pack')).toBe(true);
  });
});

