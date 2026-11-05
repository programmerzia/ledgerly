import { describe, it, expect } from 'vitest';
import { percentToFraction, fractionToPercent, toTaxCodeBody } from '@/api/adapters/tax';
import { qrImageSrc, groupSecret, pinViolationText, safeNextPath, rememberNextPath, takeNextPath } from '@/api/adapters/security';
import { invitationView, viewForAcceptError } from '@/api/adapters/invitation';
import { toMemberRow, assignableRoles } from '@/api/adapters/member';
import { fiscalYearStart, isSetupComplete, loadSkipped, orderTemplates, resumeStep, saveSkipped, stepDone, localDateISO, type SetupState } from '@/api/adapters/onboarding';
import { agingFromReport, countLabel, netProfitFromReport, toBankRows } from '@/api/adapters/dashboard';
import { needsPasswordConfirmation } from '@/api/live/account';
import { panelState } from '@/data/dashboard';
import { problemToError } from '@/api/errors';
import type { ApiInvitationPreview } from '@/api/live/team';

describe('tax rate text', () => {
  it('converts percent text to the API fraction exactly', () => {
    expect(percentToFraction('5')).toBe('0.05');
    expect(percentToFraction('7.5')).toBe('0.075');
    expect(percentToFraction('12.345')).toBe('0.12345');
    expect(percentToFraction('0')).toBe('0');
    expect(percentToFraction('100')).toBe('1');
    expect(percentToFraction(' 16 % ')).toBe('0.16');
    expect(percentToFraction('0.0001')).toBe('0.000001');
    expect(percentToFraction('015')).toBe('0.15');
  });
  it('refuses what is not a rate', () => {
    for (const bad of ['', 'abc', '-1', '100.5', '101', '1e2', '5.12345', '1,5']) expect(percentToFraction(bad)).toBeNull();
  });
  it('shows a fraction as a percentage', () => {
    expect(fractionToPercent('0.05')).toBe('5%');
    expect(fractionToPercent('0.075000')).toBe('7.5%');
    expect(fractionToPercent('1')).toBe('100%');
    expect(fractionToPercent('0.000000')).toBe('0%');
    expect(fractionToPercent(null)).toBe('no rate');
  });
  it('builds a request or names the wrong field', () => {
    const ok = toTaxCodeBody({ code: 'VAT5', name: ' VAT 5% ', kind: 'vat', percent: '5', effectiveFrom: '2026-01-01' });
    expect(ok).toEqual({ body: { code: 'VAT5', name: 'VAT 5%', kind: 'vat', rate: '0.05', effective_from: '2026-01-01' } });
    expect(toTaxCodeBody({ code: 'E', name: 'Exempt', kind: 'exempt', percent: '', effectiveFrom: '2026-01-01' })).toMatchObject({ body: { rate: '0' } });
    expect(toTaxCodeBody({ code: 'bad code', name: 'x', kind: 'vat', percent: '5', effectiveFrom: '2026-01-01' })).toMatchObject({ field: 'code' });
    expect(toTaxCodeBody({ code: 'A', name: '  ', kind: 'vat', percent: '5', effectiveFrom: '2026-01-01' })).toMatchObject({ field: 'name' });
    expect(toTaxCodeBody({ code: 'A', name: 'A', kind: 'vat', percent: 'x', effectiveFrom: '2026-01-01' })).toMatchObject({ field: 'percent' });
  });
});

describe('QR image from the API SVG', () => {
  const good = '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#fff"/><path d="M0 0L1 1"/></svg>';
  it('wraps a plain SVG as a data URI image', () => {
    const src = qrImageSrc(good);
    expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(atob(src!.split(',')[1])).toBe(good);
  });
  it('refuses script, handlers, foreign content and non-SVG', () => {
    expect(qrImageSrc('<svg><script>alert(1)</script></svg>')).toBeNull();
    expect(qrImageSrc('<svg onload="alert(1)"></svg>')).toBeNull();
    expect(qrImageSrc('<svg><foreignObject><div/></foreignObject></svg>')).toBeNull();
    expect(qrImageSrc('<svg><a href="javascript:alert(1)"><rect/></a></svg>')).toBeNull();
    expect(qrImageSrc('<svg><image href="http://evil/x.png"/></svg>')).toBeNull();
    expect(qrImageSrc('<html><svg></svg></html>')).toBeNull();
    expect(qrImageSrc('')).toBeNull();
  });
  it('groups the secret for typing', () => {
    expect(groupSecret('MMRJYVEV43OQVS3Z')).toBe('MMRJ YVEV 43OQ VS3Z');
  });
});

describe('PIN rules', () => {
  it('words each rule the API reports by code', () => {
    expect(pinViolationText('pin_sequential')).toContain('123456');
    expect(pinViolationText('pin_repeated')).toContain('111111');
    expect(pinViolationText('pin_format')).toContain('six digits');
    expect(pinViolationText('unknown')).toContain('too easy');
  });
});

describe('where to go after sign-in', () => {
  it('accepts in-app paths only', () => {
    expect(safeNextPath('/invitations/abc')).toBe('/invitations/abc');
    for (const bad of ['//evil.test', 'https://evil.test', 'invitations/abc', '/a\\b', '/a\nb', '', null, undefined]) expect(safeNextPath(bad as string)).toBeNull();
  });
  it('remembers once', () => {
    const store = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void store.set(k, v), getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
    rememberNextPath('//evil.test', storage);
    expect(takeNextPath(storage)).toBeNull();
    rememberNextPath('/invitations/t', storage);
    expect(takeNextPath(storage)).toBe('/invitations/t');
    expect(takeNextPath(storage)).toBeNull();
  });
});

describe('invitation link states', () => {
  const base: ApiInvitationPreview = { organisation: 'Acme', email: 'New@Example.test', role: 'member', company_role: 'Accountant', status: 'open', expires_at: '2026-03-22T00:00:00Z', account_exists: false };
  it('maps the four statuses', () => {
    expect(invitationView({ ...base, status: 'expired' }, null)).toEqual({ kind: 'expired' });
    expect(invitationView({ ...base, status: 'revoked' }, null)).toEqual({ kind: 'revoked' });
    expect(invitationView({ ...base, status: 'accepted' }, 'x@y.z')).toEqual({ kind: 'accepted' });
  });
  it('open: new account, sign in, accept as the right user, or the wrong user', () => {
    expect(invitationView(base, null)).toEqual({ kind: 'create_account' });
    expect(invitationView({ ...base, account_exists: true }, null)).toEqual({ kind: 'sign_in' });
    expect(invitationView(base, 'new@example.test')).toEqual({ kind: 'accept_signed_in' });
    expect(invitationView(base, 'other@example.test')).toEqual({ kind: 'wrong_user', signedInAs: 'other@example.test' });
  });
  it('falls to a state from an accept error code', () => {
    expect(viewForAcceptError('invitation_expired', null)).toEqual({ kind: 'expired' });
    expect(viewForAcceptError('invitation_revoked', null)).toEqual({ kind: 'revoked' });
    expect(viewForAcceptError('invitation_already_accepted', null)).toEqual({ kind: 'accepted' });
    expect(viewForAcceptError('sign_in_required', null)).toEqual({ kind: 'sign_in' });
    expect(viewForAcceptError('invitation_email_mismatch', 'a@b.c')).toEqual({ kind: 'wrong_user', signedInAs: 'a@b.c' });
    expect(viewForAcceptError('something_else', null)).toBeNull();
  });
});

describe('members and roles', () => {
  const member = { user_id: 'u1', name: 'Ann', email: 'ann@x.test', role: 'member', status: 'active', company_roles: { c1: ['Accountant'], c2: ['Viewer'] } };
  it('picks the roles of one company', () => {
    expect(toMemberRow(member, 'c1').companyRoles).toEqual(['Accountant']);
    expect(toMemberRow(member, 'c3').companyRoles).toEqual([]);
    expect(toMemberRow({ ...member, company_roles: [] }, 'c1').companyRoles).toEqual([]);
  });
  it('offers the roles not held yet', () => {
    const roles = [{ id: 'r1', name: 'Accountant', permissions: [], members: 1 }, { id: 'r2', name: 'Viewer', permissions: [], members: 0 }];
    expect(assignableRoles(roles, ['Accountant']).map((r) => r.id)).toEqual(['r2']);
  });
});

describe('onboarding resume', () => {
  const none: SetupState = { hasAccounts: false, taxCodeCount: 0, teammates: 0 };
  it('resumes at the first step the server shows incomplete', () => {
    expect(resumeStep(none, [])).toBe(2);
    expect(resumeStep({ ...none, hasAccounts: true }, [])).toBe(4);
    expect(resumeStep({ hasAccounts: true, taxCodeCount: 2, teammates: 0 }, [])).toBe(5);
    expect(resumeStep({ hasAccounts: true, taxCodeCount: 2, teammates: 1 }, [])).toBe(6);
  });
  it('treats skipped steps as passed and an unreadable team as not blocking', () => {
    expect(resumeStep(none, [2, 4, 5])).toBe(6);
    expect(resumeStep({ hasAccounts: true, taxCodeCount: 1, teammates: null }, [])).toBe(6);
    expect(stepDone(3, none, [])).toBe(false);
    expect(stepDone(3, { ...none, hasAccounts: true }, [])).toBe(true);
    expect(isSetupComplete(none, [])).toBe(false);
  });
  it('keeps only the skip choices in the browser', () => {
    const store = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void store.set(k, v), getItem: (k: string) => store.get(k) ?? null };
    expect(loadSkipped('c1', storage)).toEqual([]);
    saveSkipped('c1', [2, 2, 4], storage);
    expect(loadSkipped('c1', storage)).toEqual([2, 4]);
    store.set('ledgerly.onboarding.skipped.c1', 'not json');
    expect(loadSkipped('c1', storage)).toEqual([]);
  });
  it('finds the fiscal year start like the API does', () => {
    expect(fiscalYearStart(1, '2026-03-15')).toBe('2026-01-01');
    expect(fiscalYearStart(7, '2026-03-15')).toBe('2025-07-01');
    expect(fiscalYearStart(3, '2026-03-01')).toBe('2026-03-01');
    expect(localDateISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('lists the chart made for the country first', () => {
    const t = [{ code: 'a', country: null }, { code: 'b', country: 'US' }, { code: 'c', country: 'us' }];
    expect(orderTemplates(t, 'US').map((x) => x.code)).toEqual(['b', 'c', 'a']);
  });
  it('lists the recommended chart before the one made for the country', () => {
    const t = [{ code: 'a', country: null }, { code: 'b', country: 'US' }, { code: 'r', country: null, recommended: true }];
    expect(orderTemplates(t, 'US').map((x) => x.code)).toEqual(['r', 'b', 'a']);
    expect(orderTemplates(t, 'KE').map((x) => x.code)).toEqual(['r', 'a', 'b']);
  });
});

describe('dashboard figures', () => {
  const m = (amount: number) => ({ amount, currency: 'USD' });
  const totals = { current: m(100), days_1_30: m(500), days_31_60: m(900), days_61_90: m(1300), days_over_90: m(800), open: m(3600), net: m(3600) };
  it('reads the aging totals as the server sent them', () => {
    const a = agingFromReport({ rows: [], totals });
    expect(a?.open).toEqual({ minor: 3600, currency: 'USD' });
    expect(a?.over90.minor).toBe(800);
  });
  it('returns null for a body of another shape instead of guessing', () => {
    expect(agingFromReport(null)).toBeNull();
    expect(agingFromReport({ totals: { ...totals, open: 5 } })).toBeNull();
    expect(netProfitFromReport({ subtotals: {} })).toBeNull();
  });
  it('reads net profit, including a loss', () => {
    expect(netProfitFromReport({ subtotals: { net_profit: { amount: m(-4050) } } })).toEqual({ minor: -4050, currency: 'USD' });
  });
  it('lists active bank accounts with the server balances', () => {
    const rows = toBankRows([
      { id: 'b1', name: 'Main', currency: 'USD', account_number_masked: '****1234', book_balance: m(2500), unreconciled_count: 2, is_active: true },
      { id: 'b2', name: 'Old', currency: 'USD', account_number_masked: null, book_balance: null, unreconciled_count: null, is_active: false },
      { id: 'b3', name: 'New', currency: 'KES', account_number_masked: null, book_balance: null, unreconciled_count: 0, is_active: true },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['b1', 'b3']);
    expect(rows[0]).toMatchObject({ balance: { minor: 2500, currency: 'USD' }, unreconciled: 2, maskedNumber: '****1234' });
    expect(rows[1].balance).toBeNull();
  });
  it('marks a capped count', () => {
    expect(countLabel(3, false)).toBe('3');
    expect(countLabel(100, true)).toBe('100+');
  });
  it('hides a panel on 403, shows an error on anything else', () => {
    const forbidden = problemToError(403, { code: 'forbidden' });
    expect(panelState({ isPending: true, isError: false, error: null })).toBe('loading');
    expect(panelState({ isPending: false, isError: true, error: forbidden })).toBe('hidden');
    expect(panelState({ isPending: false, isError: true, error: problemToError(500, null) })).toBe('error');
    expect(panelState({ isPending: false, isError: false, error: null })).toBe('ready');
  });
});

describe('password confirmation', () => {
  it('recognises the password confirmation 423 and nothing else', () => {
    expect(needsPasswordConfirmation(problemToError(423, { code: 'password_confirmation_required' }))).toBe(true);
    expect(needsPasswordConfirmation(problemToError(423, { code: 'signing_locked' }))).toBe(false);
    expect(needsPasswordConfirmation(problemToError(403, null))).toBe(false);
    expect(needsPasswordConfirmation(new Error('x'))).toBe(false);
  });
});
