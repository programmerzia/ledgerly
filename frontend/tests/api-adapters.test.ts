import { describe, it, expect, vi } from 'vitest';
import { fromApiMoney, toApiMoney, rateForDisplay, rateToApi } from '@/api/adapters/money';
import { apiDate, toApiDate, parseTimestamp } from '@/api/adapters/dates';
import { toAccount, type ApiAccount } from '@/api/adapters/account';
import { toUser, toCompany, initials, type ApiSession, type ApiCompany } from '@/api/adapters/session';
import { resolveApiMode } from '@/api/config';
import { selectByMode } from '@/data/select';
import { describeError } from '@/api/messages';
import { problemToError, NetworkError } from '@/api/errors';
import { createIntent } from '@/api/idempotency';

describe('money', () => {
  it('round-trips integer minor units', () => {
    expect(fromApiMoney({ amount: 105000, currency: 'USD' })).toBe(105000);
    expect(toApiMoney(105000, 'USD')).toEqual({ amount: 105000, currency: 'USD' });
    expect(fromApiMoney({ amount: -250, currency: 'KES' })).toBe(-250);
  });
  it('rejects fractional or unsafe amounts', () => {
    expect(() => fromApiMoney({ amount: 10.5, currency: 'USD' })).toThrow();
    expect(() => toApiMoney(0.1 + 0.2, 'USD')).toThrow();
    expect(() => fromApiMoney({ amount: Number.MAX_SAFE_INTEGER + 2, currency: 'USD' })).toThrow();
  });
});

describe('rates', () => {
  it('turns decimal strings into display numbers', () => {
    expect(rateForDisplay('1.23456789')).toBeCloseTo(1.23456789, 8);
    expect(rateForDisplay('130')).toBe(130);
    expect(() => rateForDisplay('1e5')).toThrow();
    expect(() => rateForDisplay('abc')).toThrow();
  });
  it('turns numbers into plain decimal strings, never exponents', () => {
    expect(rateToApi(1.5)).toBe('1.5');
    expect(rateToApi(130)).toBe('130');
    expect(rateToApi(0.00000001)).toBe('0.00000001');
    expect(rateToApi(1e-9)).toBe('0');
    expect(() => rateToApi(NaN)).toThrow();
  });
});

describe('dates', () => {
  it('accepts real calendar dates only', () => {
    expect(apiDate('2026-02-28')).toBe('2026-02-28');
    expect(() => apiDate('2026-02-30')).toThrow();
    expect(() => apiDate('26-1-1')).toThrow();
  });
  it('formats local dates without time-zone drift', () => {
    expect(toApiDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('parses RFC 3339 timestamps', () => {
    expect(parseTimestamp('2026-11-03T10:00:00Z').toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(() => parseTimestamp('nope')).toThrow();
  });
});

const apiAccount: ApiAccount = {
  id: 'a1', code: '1000', name: 'Cash', account_type: 'asset', account_subtype: null, normal_balance: 'debit', parent_id: null,
  currency_policy: 'any', fixed_currency: null, control_type: 'bank', allow_manual_journals: false, is_postable: true,
  is_active: true, description: null, version: 3, can: [],
};

describe('account adapter', () => {
  it('maps to the view type and fills nulls the pages call string methods on', () => {
    const a = toAccount(apiAccount, { tenantId: 't1', companyId: 'c1' });
    expect(a).toMatchObject({ id: 'a1', tenant_id: 't1', company_id: 'c1', account_subtype: '', fixed_currency: undefined, description: undefined, control_type: 'bank', allow_manual_journals: false });
  });
});

const session: ApiSession = {
  id: 'u1', name: 'Rahim Ahmed', email: 'r@x.so', two_factor_enabled: true, signing_pin_set: false,
  tenants: [
    { id: 't1', name: 'Acme', slug: 'acme', lifecycle: 'active', role: 'owner', current: false, can: { manage_members: true, create_companies: true } },
    { id: 't2', name: 'Beta', slug: 'beta', lifecycle: 'active', role: 'admin', current: true, can: { manage_members: true, create_companies: false } },
  ],
};

describe('session adapters', () => {
  it('maps the user with the role of the current organisation and never a PIN', () => {
    const u = toUser(session);
    expect(u).toMatchObject({ id: 'u1', role: 'admin', roleTitle: 'Administrator', avatar: 'RA', twoFactorEnabled: true, signingPin: '' });
  });
  it('maps a company', () => {
    const c: ApiCompany = { id: 'c1', name: 'Co', legal_name: null, slug: 'co', country: 'SO', base_currency: 'USD', fiscal_year_start_month: 1, tax_id: null, timezone: 'UTC', status: 'active', can: { open: true, manage_settings: true } };
    expect(toCompany(c, 't2')).toMatchObject({ id: 'c1', tenant_id: 't2', slug: 'co', legal_name: 'Co', tax_id: '', base_currency: 'USD' });
  });
  it('makes initials', () => {
    expect(initials('  ada  lovelace byron')).toBe('AL');
    expect(initials('')).toBe('?');
  });
});

describe('mode seam', () => {
  it('defaults to mock and only "live" selects live', () => {
    expect(resolveApiMode(undefined)).toBe('mock');
    expect(resolveApiMode('')).toBe('mock');
    expect(resolveApiMode('LIVE')).toBe('mock');
    expect(resolveApiMode('live')).toBe('live');
  });
  it('picks one implementation and never calls the other', () => {
    const mock = vi.fn(() => 'm');
    const live = vi.fn(() => 'l');
    expect(selectByMode({ mock, live }, 'mock')()).toBe('m');
    expect(selectByMode({ mock, live }, 'live')()).toBe('l');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledTimes(1);
  });
  it('the test build is in mock mode, so existing mock behaviour is selected', async () => {
    const { API_MODE } = await import('@/api/config');
    expect(API_MODE).toBe('mock');
  });
});

describe('describeError', () => {
  it('switches on code and class', () => {
    expect(describeError(new NetworkError())).toMatch(/could not be reached/);
    expect(describeError(problemToError(429, { code: 'rate_limited' }, new Headers({ 'Retry-After': '30' })))).toMatch(/30 seconds/);
    expect(describeError(problemToError(423, { code: 'tenant_read_only' }))).toMatch(/read-only/);
    expect(describeError(problemToError(500, { code: 'server_error', detail: 'SQLSTATE leak' }))).not.toMatch(/SQLSTATE/);
  });
});

describe('intent', () => {
  it('is stable until settled', () => {
    let n = 0;
    const i = createIntent(() => `k${++n}`);
    expect([i.key, i.key]).toEqual(['k1', 'k1']);
    i.settle();
    expect(i.key).toBe('k2');
  });
});
