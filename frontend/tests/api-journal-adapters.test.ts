import { describe, it, expect } from 'vitest';
import {
  dimensionsFromApi,
  dimensionsToApi,
  splitFieldErrors,
  splitViolations,
  toApprovalItem,
  toBulkResult,
  toDimensions,
  toJournal,
  toJournalRequest,
  toPostingPreview,
  toRecurringJournal,
  toDuplicateInput,
  type ApiApproval,
  type ApiDimension,
  type ApiJournal,
} from '@/api/adapters/journal';
import { IntentSlot } from '@/api/intentSlot';
import { describeViolation } from '@/api/violations';
import { formatCountdown } from '@/components/domain/SignDialogLive';

const usd = (amount: number) => ({ amount, currency: 'USD' });
const scope = { tenantId: 't1', companyId: 'c1' };

const dims = [
  { id: 'd-branch', code: 'BRANCH', name: 'Branch', position: 1, is_active: true, version: 0, can: [], values: [{ id: 'v-mg', dimension_id: 'd-branch', code: 'MG', name: 'Mogadishu', parent_id: null, is_active: true, version: 0 }] },
  { id: 'd-dept', code: 'DEPT', name: 'Department', position: 2, is_active: true, version: 0, can: [], values: [{ id: 'v-s', dimension_id: 'd-dept', code: 'SALES', name: 'Sales', parent_id: null, is_active: true, version: 0 }] },
] as unknown as ApiDimension[];

const apiJournal = {
  id: 'j1',
  number: null,
  status: 'draft',
  journal_type: 'manual',
  journal_date: '2026-10-28',
  fiscal_period_id: null,
  reference: null,
  memo: 'Rent',
  total_debit: usd(10000),
  total_credit: usd(10000),
  source_type: null,
  source_id: null,
  reversal_of_id: null,
  reversed_by_id: null,
  created_by: 'u1',
  submitted_by: null,
  approved_by: null,
  posted_by: null,
  posted_at: null,
  version: 3,
  can: { update: true, submit: true, approve: false, return: false, void: true, reverse: false },
  lines: [
    { line_no: 1, account_id: 'a1', debit: usd(10000), credit: usd(0), currency: 'USD', fx_rate: '1', amount_fc: usd(10000), description: 'Rent', dimensions: { 'd-branch': 'v-mg', 'd-dept': 'v-s' }, contact_id: null, tax_code_id: null, due_date: null },
    { line_no: 2, account_id: 'a2', debit: usd(0), credit: usd(10000), currency: 'USD', fx_rate: '1', amount_fc: usd(-10000), description: null, dimensions: {}, contact_id: null, tax_code_id: null, due_date: null },
  ],
} as unknown as ApiJournal;

describe('journal adapter', () => {
  it('maps a JournalResource to the view type without inventing values', () => {
    const j = toJournal(apiJournal, scope, dims);
    expect(j.total_debit).toBe(10000);
    expect(j.number).toBeNull();
    expect(j.fiscal_period_id).toBe('');
    expect(j.reference).toBe('');
    expect(j.version).toBe(3);
    expect(j.can).toEqual({ update: true, submit: true, approve: false, return: false, void: true, reverse: false });
    expect(j.lines[0]).toMatchObject({ debit: 10000, credit: 0, fx_rate: 1, dimensions: { branch: 'MG' }, extraDimensions: { 'd-dept': 'v-s' } });
    expect(j.lines[1].description).toBe('');
    expect(j.lines[1].amount_fc).toBe(-10000);
  });

  it('treats a list row (no lines) as an empty line list', () => {
    const { lines: _lines, ...summary } = apiJournal as unknown as Record<string, unknown>;
    expect(toJournal(summary as unknown as ApiJournal, scope).lines).toEqual([]);
  });

  it('refuses non-integer money from the server', () => {
    expect(() => toJournal({ ...apiJournal, total_debit: usd(10.5) } as ApiJournal, scope)).toThrow();
  });

  it('defaults every permission to false when the server sends none', () => {
    expect(toJournal({ ...apiJournal, can: [] } as unknown as ApiJournal, scope).can.approve).toBe(false);
  });
});

describe('dimensions', () => {
  it('shows only dimensions that have a chip slot, under the slot name', () => {
    const view = toDimensions(dims, 'c1');
    expect(view.map((d) => d.code)).toEqual(['branch']);
    expect(view[0].values[0].code).toBe('MG');
  });

  it('round-trips slot values and keeps dimensions the grid cannot show', () => {
    const { slots, extra } = dimensionsFromApi({ 'd-branch': 'v-mg', 'd-dept': 'v-s' }, dims);
    expect(slots).toEqual({ branch: 'MG' });
    expect(dimensionsToApi(slots, extra, dims)).toEqual({ 'd-branch': 'v-mg', 'd-dept': 'v-s' });
  });

  it('drops a code that matches no value instead of sending a made-up id', () => {
    expect(dimensionsToApi({ branch: 'NOPE' }, undefined, dims)).toEqual({});
  });
});

describe('journal request', () => {
  const input = {
    journal_date: '2026-10-28',
    reference: ' ',
    memo: ' Rent ',
    lines: [
      { account_id: 'a1', description: 'x', debit: 10000, credit: 0, dimensions: { branch: 'MG' as const } },
      { account_id: 'a2', description: '', debit: 0, credit: 10000, dimensions: {} },
      { account_id: 'a3', description: '', debit: 0, credit: 0, dimensions: {} },
    ],
  };

  it('sends only the side a line uses, integers as they are, and nulls for empty text', () => {
    const body = toJournalRequest(input, dims) as { lines: Array<Record<string, unknown>>; reference: unknown; memo: unknown; journal_type: unknown };
    expect(body.journal_type).toBe('manual');
    expect(body.reference).toBeNull();
    expect(body.memo).toBe('Rent');
    expect(body.lines[0]).toEqual({ account_id: 'a1', description: 'x', debit: 10000, dimensions: { 'd-branch': 'v-mg' } });
    expect(body.lines[1]).toEqual({ account_id: 'a2', description: null, credit: 10000 });
    expect(body.lines[2]).toEqual({ account_id: 'a3', description: null });
  });

  it('carries the version only when editing (and then no journal_type), and the period only when chosen', () => {
    expect(toJournalRequest(input, dims)).not.toHaveProperty('version');
    expect(toJournalRequest(input, dims)).toHaveProperty('journal_type', 'manual');
    expect(toJournalRequest({ ...input, version: 2 }, dims)).not.toHaveProperty('journal_type');
    expect(toJournalRequest(input, dims)).not.toHaveProperty('fiscal_period_id');
    expect(toJournalRequest({ ...input, version: 0, fiscal_period_id: 'p1' }, dims)).toMatchObject({ version: 0, fiscal_period_id: 'p1' });
  });

  it('builds a draft copy from a journal', () => {
    const copy = toDuplicateInput(toJournal(apiJournal, scope, dims), '2026-11-02');
    expect(copy.journal_date).toBe('2026-11-02');
    expect(copy.lines).toHaveLength(2);
    expect(copy.lines[0].extraDimensions).toEqual({ 'd-dept': 'v-s' });
    expect(copy).not.toHaveProperty('version');
  });
});

describe('server verdicts', () => {
  it('splits violations by line_no and keeps the rest as header ones', () => {
    const { header, byLine } = splitViolations([
      { code: 'journal_unbalanced', message: 'x' },
      { code: 'account_inactive', line_no: 2, message: 'y' },
      { code: 'dimension_required', line_no: 2, message: 'z' },
    ]);
    expect(header.map((v) => v.code)).toEqual(['journal_unbalanced']);
    expect(byLine.get(2)?.map((v) => v.code)).toEqual(['account_inactive', 'dimension_required']);
  });

  it('maps 422 field errors to line indexes', () => {
    const { header, byIndex } = splitFieldErrors({ 'lines.0.account_id': ['bad'], 'lines.2.debit': ['need one'], journal_date: ['wrong'] });
    expect(byIndex.get(0)).toEqual({ account_id: 'bad' });
    expect(byIndex.get(2)).toEqual({ debit: 'need one' });
    expect(header).toEqual([{ field: 'journal_date', message: 'wrong' }]);
  });

  it('adapts the posting preview and words violations by code', () => {
    const p = toPostingPreview({ valid: false, violations: [{ code: 'journal_unbalanced', message: 'm' }], period: { id: 'p', name: 'Oct 2026', status: 'open' }, total_debit: usd(10000), total_credit: usd(9000), number: null });
    expect(p).toMatchObject({ valid: false, totalDebit: 10000, totalCredit: 9000, period: { name: 'Oct 2026' } });
    expect(describeViolation(p.violations[0])).toMatch(/do not match/);
    expect(describeViolation({ code: 'brand_new_code', message: 'Server says so' })).toBe('Server says so');
  });
});

describe('approvals', () => {
  const base = { id: 'r1', document_id: 'doc1', step: 1, slot: 0, role: 'Approver', requested_by: 'u1', requested_at: '2026-11-01T10:00:00Z' };

  it('adapts a journal request and the API type bulk-approve wants', () => {
    const item = toApprovalItem({ ...base, document_type: 'journal', document: { id: 'doc1', journal_type: 'manual', journal_date: '2026-10-28', reference: null, memo: 'Rent', amount: usd(10000), created_by: 'u1', submitted_by: 'u1', version: 2 } } as unknown as ApiApproval);
    expect(item).toMatchObject({ document_type: 'manual_journal', api_type: 'journal', amount: 10000, currency: 'USD', maker_id: 'u1', version: 2, document_number: '' });
  });

  it('tells a bill from an invoice and keeps the number', () => {
    const doc = { id: 'doc1', kind: 'purchase_bill', number: 'BILL-1', amount: usd(500), created_by: 'u2', submitted_by: 'u2', version: 0 };
    const item = toApprovalItem({ ...base, document_type: 'bill', document: doc } as unknown as ApiApproval);
    expect(item).toMatchObject({ document_type: 'purchase_bill', api_type: 'bill', document_number: 'BILL-1' });
    expect(toApprovalItem({ ...base, document_type: 'invoice', document: { ...doc, kind: 'sales_invoice' } } as unknown as ApiApproval).api_type).toBe('invoice');
  });

  it('reads bulk-approve results, approved and skipped', () => {
    expect(toBulkResult({ type: 'journal', id: 'j', ok: true, status: 'posted', number: 'JRN-1', code: null, reason: null })).toMatchObject({ ok: true, number: 'JRN-1', status: 'posted' });
    expect(toBulkResult({ type: 'invoice', id: 'i', ok: false, status: null, number: null, code: 'self_approval_forbidden', reason: 'Nope' })).toMatchObject({ ok: false, code: 'self_approval_forbidden', reason: 'Nope' });
    expect(toBulkResult(null).ok).toBe(false);
  });
});

describe('recurring and helpers', () => {
  it('adapts a schedule with its permissions', () => {
    const s = toRecurringJournal({ id: 's', name: 'Rent', document_type: 'journal', template_id: 'j', frequency: 'monthly', next_date: '2026-12-01', end_date: null, owner_id: 'u', is_active: true, last_run_on: null, last_error: null, generated_count: 0, version: 1, can: { update: true, pause: true, resume: false } as never });
    expect(s.can).toEqual({ pause: true, resume: false, update: true });
    expect(s.frequency).toBe('monthly');
  });

  it('keeps one Idempotency intent while the payload is the same and starts a new one when it changes', () => {
    const slot = new IntentSlot();
    const a = slot.for('x');
    expect(slot.for('x')).toBe(a);
    expect(slot.for('y')).not.toBe(a);
    const b = slot.for('y');
    slot.clear();
    expect(slot.for('y')).not.toBe(b);
  });

  it('formats the signing lock countdown', () => {
    expect(formatCountdown(900)).toBe('15:00');
    expect(formatCountdown(61)).toBe('1:01');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});
