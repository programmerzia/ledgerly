import { describe, it, expect } from 'vitest';
import {
  API_ABILITIES, WEBHOOK_EVENTS, blankWorkflow, cleanFilters, describeRange, describeSteps, eligibleAccounts, expiryToApi, groupAbilities, groupEvents,
  minorToInput, postingPatch, profilePatch, toAuditRow, toPostingRows, toProfileForm, toWorkflowForm, toWorkflowRequest, unsetPostingKeys, verifyLines,
} from '@/api/adapters/admin';
import type { ApiSettings, ApiWorkflow } from '@/api/live/admin';

const settings = (posting: ApiSettings['posting_accounts']): ApiSettings => ({
  company_id: 'c1', name: 'Acme', legal_name: null, tax_id: null, country: 'BG', base_currency: 'EUR', timezone: 'Europe/Sofia', locale: 'en',
  fiscal_year_start_month: 1, tax_rounding: 'document_per_code', posting_accounts: posting, can: { update: true },
});

describe('posting accounts', () => {
  const s = settings({ ar_control: { account_id: 'a1', code: '1200', name: 'Receivables' }, ap_control: null, brand_new_key: null });
  it('flags empty keys and gives unknown keys a readable label', () => {
    const rows = toPostingRows(s);
    expect(unsetPostingKeys(rows).map((r) => r.key)).toEqual(['ap_control', 'brand_new_key']);
    expect(rows[0]).toMatchObject({ key: 'ar_control', accountId: 'a1', accountLabel: '1200 Receivables', needs: 'ar' });
    expect(rows[2]?.label).toBe('Brand new key');
  });
  it('offers only active, postable accounts of the control type the key needs', () => {
    const acc = (id: string, control_type: string, over: object = {}) => ({ id, code: id, name: id, control_type, is_active: true, is_postable: true, ...over });
    const list = [acc('r', 'ar'), acc('p', 'ap'), acc('off', 'ar', { is_active: false }), acc('hdr', 'ar', { is_postable: false })];
    expect(eligibleAccounts(list, { needs: 'ar' }).map((a) => a.id)).toEqual(['r']);
    expect(eligibleAccounts(list, { needs: null }).map((a) => a.id)).toEqual(['r', 'p']);
  });
  it('sends only keys that changed, null to clear', () => {
    const rows = toPostingRows(s);
    expect(postingPatch(rows, { ar_control: 'a1', ap_control: 'a2' })).toEqual({ ap_control: 'a2' });
    expect(postingPatch(rows, { ar_control: '' })).toEqual({ ar_control: null });
    expect(postingPatch(rows, {})).toEqual({});
  });
});

describe('company profile', () => {
  it('sends only what differs; blank optional text clears the field', () => {
    const saved = toProfileForm({ ...settings({}), legal_name: 'Acme Ltd', tax_id: 'BG1' });
    expect(profilePatch(saved, saved)).toEqual({});
    expect(profilePatch(saved, { ...saved, name: ' Acme 2 ', legal_name: '', tax_rounding: 'line' })).toEqual({ name: 'Acme 2', legal_name: null, tax_rounding: 'line' });
  });
});

describe('amounts as text', () => {
  it('round-trips integer minor units without floats', () => {
    expect(minorToInput(150000, 2)).toBe('1500.00');
    expect(minorToInput(5, 2)).toBe('0.05');
    expect(minorToInput(-250, 2)).toBe('-2.50');
    expect(minorToInput(1200, 0)).toBe('1200');
    expect(minorToInput(1234, 3)).toBe('1.234');
  });
});

describe('approval workflows', () => {
  const wf = (over: Partial<ApiWorkflow> = {}): ApiWorkflow => ({
    id: 'w1', document_type: 'journal', name: 'Big journals', source: 'any', min_amount: { amount: 100000, currency: 'EUR' }, max_amount: null,
    steps: [{ role: 'Finance Manager', count: 1 }, { role: 'Owner', count: 2 }], is_active: true, version: 3, can: {}, ...over,
  });
  it('builds integer minor units from text and carries the version on update', () => {
    const f = { ...blankWorkflow(), name: ' Big ', min: '1,000.50', max: '5000', steps: [{ role: 'Owner', count: '2' }] };
    const r = toWorkflowRequest(f, 2, 7);
    expect(r).toEqual({ ok: true, body: { document_type: 'journal', name: 'Big', source: 'any', min_amount: 100050, max_amount: 500000, steps: [{ role: 'Owner', count: 2 }], version: 7 } });
    const create = toWorkflowRequest({ ...f, max: '' }, 2);
    expect(create.ok && create.body.max_amount).toBe(null);
    expect(create.ok && 'version' in create.body).toBe(false);
  });
  it('names each problem per field', () => {
    const r = toWorkflowRequest({ ...blankWorkflow(), name: '', min: 'abc', steps: [{ role: '', count: '0' }] }, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['min', 'name', 'step0']);
    const range = toWorkflowRequest({ ...blankWorkflow(), name: 'x', min: '10', max: '10', steps: [{ role: 'Owner', count: '1' }] }, 2);
    expect(range.ok === false && range.errors.max).toMatch(/above/);
    const many = toWorkflowRequest({ ...blankWorkflow(), name: 'x', steps: [{ role: 'Owner', count: '11' }] }, 2);
    expect(many.ok === false && many.errors.step0).toBeTruthy();
  });
  it('rejects more decimals than the currency has instead of rounding', () => {
    const r = toWorkflowRequest({ ...blankWorkflow(), name: 'x', min: '1.234', steps: [{ role: 'Owner', count: '1' }] }, 2);
    expect(r.ok).toBe(false);
  });
  it('reads a workflow back into the form and into words', () => {
    expect(toWorkflowForm(wf({ max_amount: { amount: 250000, currency: 'EUR' } }), 2)).toMatchObject({ min: '1000.00', max: '2500.00' });
    expect(describeSteps(wf())).toBe('Finance Manager, then 2 × Owner');
    expect(describeRange(wf(), 'EUR')).toContain('and above');
    expect(describeRange(wf({ min_amount: { amount: 0, currency: 'EUR' } }), 'EUR')).toBe('Any amount');
  });
});

describe('abilities and events', () => {
  it('groups every ability and event the API allows', () => {
    const groups = groupAbilities(API_ABILITIES);
    expect(groups.flatMap((g) => g.abilities)).toHaveLength(API_ABILITIES.length);
    expect(groups.find((g) => g.resource === 'invoices')?.abilities.map((a) => a.value)).toEqual(['invoices:read', 'invoices:write', 'invoices:submit']);
    expect(groupEvents(WEBHOOK_EVENTS).flatMap((g) => g.events)).toHaveLength(WEBHOOK_EVENTS.length);
  });
  it('turns a chosen date into the UTC timestamp the server takes', () => {
    expect(expiryToApi('2027-03-01')).toBe('2027-03-01T23:59:59Z');
    expect(expiryToApi('')).toBeNull();
  });
});

describe('audit log', () => {
  it('shows a row in words and keeps the server values', () => {
    const row = toAuditRow({
      id: 9, occurred_at: '2026-11-02T10:00:00Z', actor_type: 'user', actor_id: '12345678-aaaa', action: 'journal.posted', subject_type: 'journal', subject_id: 'abcdef12-0000',
      before: null, after: { status: 'posted' }, context: null, ip: '127.0.0.1', request_id: 'r1', prev_hash: null, hash: 'h',
    });
    expect(row).toMatchObject({ id: 9, actionText: 'Journal posted', subject: 'Journal abcdef12', hash: 'h', prevHash: null });
  });
  it('drops blank filters and reports a failed check line by line', () => {
    expect(cleanFilters({ action: ' journal.posted ', subject_type: '', actor_id: undefined })).toEqual({ action: 'journal.posted' });
    expect(verifyLines({ problem: 'hash_mismatch', detail: 'Event 7 does not match.' })).toEqual(['hash_mismatch', 'Event 7 does not match.']);
    expect(verifyLines({ problem: null, detail: null })).toEqual([]);
  });
});
