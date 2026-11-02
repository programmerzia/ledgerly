import { describe, it, expect } from 'vitest';
import {
  isDiscount,
  isQuantity,
  splitDocFieldErrors,
  splitDocViolations,
  toDoc,
  toDocPreview,
  toDraftInput,
  toInvoiceRequest,
  trimDecimal,
  type ApiInvoice,
  type DocDraftInput,
} from '@/api/adapters/invoice';
import { addressLines, draftOf, toContact, toContactRequest, type ApiContact } from '@/api/adapters/contact';
import { toDocPayment, toCreditApplication, toSettlement, toSettlementRequest, type ApiSettlement } from '@/api/adapters/settlement';
import { describeTradeViolation } from '@/api/tradeViolations';

const usd = (amount: number) => ({ amount, currency: 'USD' });
const eur = (amount: number) => ({ amount, currency: 'EUR' });

const apiInvoice = (over: Record<string, unknown> = {}): ApiInvoice =>
  ({
    id: 'i1',
    kind: 'sales_invoice',
    number: 'INV-1',
    status: 'posted',
    payment_status: 'partially_paid',
    contact_id: 'c1',
    issue_date: '2026-11-02',
    due_date: '2026-11-16',
    currency: 'EUR',
    fx_rate: '1.08000000',
    reference: null,
    memo: null,
    subtotal_fc: eur(100000),
    tax_total_fc: eur(16000),
    total_fc: eur(116000),
    subtotal: usd(108000),
    tax_total: usd(17280),
    total: usd(125280),
    wht_code_id: null,
    wht_amount_fc: eur(0),
    wht_amount: usd(0),
    settled_fc: eur(16000),
    settled: usd(17280),
    amount_due: usd(108000),
    amount_due_fc: eur(100000),
    related_invoice_id: null,
    journal_id: 'j1',
    reversal_journal_id: null,
    created_by: 'u1',
    submitted_by: 'u1',
    approved_by: null,
    posted_by: 'u1',
    posted_at: '2026-11-02T10:00:00Z',
    version: 3,
    lines: [
      {
        line_no: 1,
        item_id: null,
        account_id: 'a1',
        description: 'Licence',
        quantity: '2.500000',
        unit_price_fc: eur(40000),
        discount_pct: '0.0000',
        tax_code_id: 't1',
        line_total_fc: eur(100000),
        tax_amount_fc: eur(16000),
        tax_detail: { t1: 16000 },
        dimensions: {},
      },
    ],
    can: { update: false, submit: false, approve: false, return: false, void: false, reverse: true },
    ...over,
  }) as unknown as ApiInvoice;

describe('toDoc', () => {
  it('keeps every figure the server sent, as integer minor units in its own currency', () => {
    const d = toDoc(apiInvoice());
    expect(d.total_fc).toBe(116000);
    expect(d.total).toBe(125280);
    expect(d.amount_due).toBe(108000);
    expect(d.baseCurrency).toBe('USD');
    expect(d.currency).toBe('EUR');
    expect(d.paymentStatus).toBe('partially_paid');
    expect(d.lines[0].line_total_fc).toBe(100000);
    expect(d.lines[0].unit_price_fc).toBe(40000);
  });
  it('keeps quantity and rate as the server\'s decimal strings', () => {
    const d = toDoc(apiInvoice());
    expect(d.fx_rate).toBe('1.08000000');
    expect(d.lines[0].quantity).toBe('2.500000');
  });
  it('only trusts can hints that are exactly true', () => {
    const d = toDoc(apiInvoice({ can: { reverse: true, submit: 'yes', approve: 1 } }));
    expect(d.can).toEqual({ update: false, submit: false, approve: false, return: false, void: false, reverse: true });
  });
  it('refuses a fractional amount (contract break) instead of rounding it', () => {
    expect(() => toDoc(apiInvoice({ total_fc: eur(10.5) }))).toThrow();
  });
  it('works for a credit note the same way (kind is data)', () => {
    const d = toDoc(apiInvoice({ kind: 'credit_note', related_invoice_id: 'i0' }));
    expect(d.kind).toBe('credit_note');
    expect(d.related_invoice_id).toBe('i0');
  });
});

describe('toInvoiceRequest', () => {
  const base: DocDraftInput = {
    kind: 'sales_invoice',
    contact_id: 'c1',
    issue_date: '2026-11-02',
    due_date: '',
    currency: 'USD',
    fx_rate: '1.10',
    reference: ' PO-1 ',
    memo: '',
    lines: [{ account_id: '', description: ' Hours ', quantity: '2', unit_price_fc: 15000, discount_pct: '', tax_code_id: 't1' }],
  };
  it('a create carries the kind and no version, and never any total', () => {
    const body = toInvoiceRequest(base, 'USD');
    expect(body.kind).toBe('sales_invoice');
    expect('version' in body).toBe(false);
    expect(Object.keys(body)).not.toContain('total');
    expect(Object.keys(body)).not.toContain('tax_total_fc');
  });
  it('a replace carries the version and no kind (the API refuses a kind change)', () => {
    const body = toInvoiceRequest(base, 'USD', 4);
    expect(body.version).toBe(4);
    expect('kind' in body).toBe(false);
  });
  it('sends the exchange rate only for a foreign currency document', () => {
    expect('fx_rate' in toInvoiceRequest(base, 'USD')).toBe(false);
    expect(toInvoiceRequest({ ...base, currency: 'EUR' }, 'USD').fx_rate).toBe('1.10');
    expect('fx_rate' in toInvoiceRequest({ ...base, currency: 'EUR', fx_rate: '' }, 'USD')).toBe(false);
  });
  it('turns empty text into null and trims, and sends quantity as typed text and the price as integer minor units', () => {
    const body = toInvoiceRequest(base, 'USD') as { reference: string; memo: unknown; due_date: unknown; lines: Array<Record<string, unknown>> };
    expect(body.reference).toBe('PO-1');
    expect(body.memo).toBeNull();
    expect(body.due_date).toBeNull();
    expect(body.lines[0]).toMatchObject({ account_id: null, description: 'Hours', quantity: '2', unit_price_fc: 15000, discount_pct: null, tax_code_id: 't1' });
  });
  it('round-trips a received draft back into the form without arithmetic', () => {
    const input = toDraftInput(toDoc(apiInvoice({ status: 'draft' })));
    expect(input.lines[0].quantity).toBe('2.5');
    expect(input.lines[0].discount_pct).toBe('');
    expect(input.lines[0].unit_price_fc).toBe(40000);
    expect(input.currency).toBe('EUR');
  });
});

describe('typed text checks (shape only)', () => {
  it('accepts quantities the API accepts and refuses the rest', () => {
    for (const ok of ['1', '2.5', '0.000001', '999999999999']) expect(isQuantity(ok)).toBe(true);
    for (const bad of ['', 'abc', '-1', '1e3', '1,5', '1.1234567', ' ']) expect(isQuantity(bad)).toBe(false);
  });
  it('accepts an empty discount or a percentage with up to 4 decimals', () => {
    for (const ok of ['', '10', '7.5', '100', '12.3456']) expect(isDiscount(ok)).toBe(true);
    for (const bad of ['abc', '-5', '1000', '1.23456']) expect(isDiscount(bad)).toBe(false);
  });
  it('trims the server\'s padded decimals as text', () => {
    expect(trimDecimal('2.000000')).toBe('2');
    expect(trimDecimal('2.500000')).toBe('2.5');
    expect(trimDecimal('0.0000')).toBe('');
    expect(trimDecimal('7')).toBe('7');
  });
});

describe('posting preview and verdicts', () => {
  it('keeps the server\'s totals and lines', () => {
    const p = toDocPreview({
      valid: true,
      violations: [],
      period: { id: 'p', name: 'Nov 2026', status: 'open' },
      total_debit: usd(23200),
      total_credit: usd(23200),
      number: null,
      lines: [{ line_no: 1, account_id: 'a', debit: usd(23200), credit: usd(0), currency: 'USD', fx_rate: null, amount_fc: null, description: 'AR', contact_id: null, tax_code_id: null, due_date: null }],
    } as never);
    expect(p.valid).toBe(true);
    expect(p.totalDebit).toBe(23200);
    expect(p.lines[0].debit).toBe(23200);
    expect(p.currency).toBe('USD');
  });
  it('splits violations into header and per line, and 422 fields per line index', () => {
    const { header, byLine } = splitDocViolations([
      { code: 'period_closed', message: 'x' },
      { code: 'line_price_missing', message: 'y', line_no: 2 },
    ]);
    expect(header.map((v) => v.code)).toEqual(['period_closed']);
    expect(byLine.get(2)?.[0].code).toBe('line_price_missing');
    const f = splitDocFieldErrors({ 'lines.0.quantity': ['bad'], contact_id: ['required'] });
    expect(f.byIndex.get(0)).toEqual({ quantity: 'bad' });
    expect(f.header).toEqual([{ field: 'contact_id', message: 'required' }]);
  });
  it('says what the trade codes mean in plain words, and falls back to the server text', () => {
    expect(describeTradeViolation({ code: 'credit_exceeds_original', message: 'x' })).toMatch(/more than the invoice/);
    expect(describeTradeViolation({ code: 'allocation_exceeds_open_amount', message: 'x' })).toMatch(/still owed/);
    expect(describeTradeViolation({ code: 'invoice_has_settlements', message: 'x' })).toMatch(/Money has been applied/);
    expect(describeTradeViolation({ code: 'posting_account_missing', message: 'Set the rounding account.' })).toBe('Set the rounding account.');
    expect(describeTradeViolation({ code: 'period_closed', message: 'x' })).toMatch(/closed/);
    expect(describeTradeViolation({ code: 'something_new', message: 'Server text' })).toBe('Server text');
  });
});

const apiContact = (over: Record<string, unknown> = {}): ApiContact =>
  ({
    id: 'c1',
    kind: 'both',
    code: 'ACME',
    name: 'Acme',
    legal_name: null,
    tax_id: null,
    email: null,
    phone: null,
    billing_address: ['Moi Avenue 12', 'Nairobi'],
    shipping_address: null,
    default_currency: 'USD',
    payment_terms_days: 14,
    credit_limit: { amount: 500000, currency: 'USD' },
    ar_account_id: 'ar',
    ap_account_id: null,
    wht_code_id: null,
    default_account_id: null,
    default_tax_code_id: 't1',
    default_branch: null,
    default_dims: {},
    is_active: true,
    notes: null,
    balances: { receivable: usd(83400), payable: usd(0) },
    version: 5,
    can: { update: true, deactivate: true },
    ...over,
  }) as unknown as ApiContact;

describe('contacts', () => {
  it('maps to the Contact view type with neutral values for nulls', () => {
    const c = toContact(apiContact(), { tenantId: 't', companyId: 'co' });
    expect(c.email).toBe('');
    expect(c.credit_limit).toBe(500000);
    expect(c.receivable).toBe(83400);
    expect(c.baseCurrency).toBe('USD');
    expect(c.billing_address).toEqual(['Moi Avenue 12', 'Nairobi']);
    expect(c.kind).toBe('both');
    expect(c.can).toEqual({ update: true, deactivate: true });
  });
  it('reads an address that comes back as a keyed object', () => {
    expect(addressLines({ line1: 'A', city: 'B' })).toEqual(['A', 'B']);
    expect(addressLines(null)).toEqual([]);
  });
  it('an edit resends what the form does not show and the version; a create does not', () => {
    const c = toContact(apiContact(), { tenantId: 't', companyId: 'co' });
    const edit = toContactRequest({ ...draftOf(c), payment_terms_days: 30, email: '' }, c);
    expect(edit.version).toBe(5);
    expect(edit.ar_account_id).toBe('ar');
    expect(edit.default_tax_code_id).toBe('t1');
    expect(edit.email).toBeNull();
    expect(edit.credit_limit).toEqual({ amount: 500000, currency: 'USD' });
    const create = toContactRequest({ ...draftOf(c), credit_limit: null });
    expect('version' in create).toBe(false);
    expect(create.credit_limit).toBeNull();
  });
});

const apiSettlement = (over: Record<string, unknown> = {}): ApiSettlement =>
  ({
    id: 's1',
    kind: 'receipt',
    number: 'RCT-1',
    status: 'posted',
    contact_id: 'c1',
    cash_account_id: 'cash',
    bank_account_id: 'bank',
    settlement_date: '2026-11-02',
    currency: 'EUR',
    fx_rate: '1.10000000',
    amount_fc: eur(116000),
    amount: usd(127600),
    unallocated_fc: eur(1000),
    unallocated: usd(1100),
    reference: null,
    memo: null,
    payment_run_id: null,
    journal_id: 'j',
    reversal_journal_id: null,
    created_by: 'u',
    submitted_by: 'u',
    approved_by: null,
    posted_by: 'u',
    posted_at: null,
    version: 2,
    allocations: [{ id: 'a1', invoice_id: 'i1', source_settlement_id: null, amount_fc: eur(115000), amount: usd(126500), fx_gain_loss: usd(2320) }],
    can: { reverse: true, allocate: true },
    ...over,
  }) as unknown as ApiSettlement;

describe('settlements', () => {
  it('keeps the server\'s base amounts, allocations and exchange differences', () => {
    const s = toSettlement(apiSettlement());
    expect(s.amount_fc).toBe(116000);
    expect(s.amount).toBe(127600);
    expect(s.unallocated_fc).toBe(1000);
    expect(s.allocations[0]).toMatchObject({ invoice_id: 'i1', amount_fc: 115000, fx_gain_loss: 2320 });
    expect(s.hasAllocations).toBe(true);
    expect(s.can.allocate).toBe(true);
    expect(s.can.submit).toBe(false);
  });
  it('a list row without allocations says so', () => {
    expect(toSettlement(apiSettlement({ allocations: undefined })).hasAllocations).toBe(false);
  });
  it('the request drops zero allocations, sends minor units, and the rate only for a foreign currency', () => {
    const input = {
      kind: 'receipt' as const,
      contact_id: 'c1',
      cash_account_id: 'cash',
      bank_account_id: 'bank',
      settlement_date: '2026-11-02',
      amount_fc: 50000,
      currency: 'EUR',
      fx_rate: '1.1',
      reference: '',
      memo: '',
      allocations: [
        { invoice_id: 'i1', amount_fc: 40000 },
        { invoice_id: 'i2', amount_fc: 0 },
      ],
    };
    const body = toSettlementRequest(input, 'USD') as { allocations: unknown[]; fx_rate?: string; version?: number };
    expect(body.allocations).toEqual([{ invoice_id: 'i1', amount_fc: 40000 }]);
    expect(body.fx_rate).toBe('1.1');
    expect('version' in body).toBe(false);
    expect(toSettlementRequest({ ...input, currency: 'USD' }, 'USD')).not.toHaveProperty('fx_rate');
    expect((toSettlementRequest(input, 'USD', 7) as { version: number }).version).toBe(7);
  });
  it('reads a credit application', () => {
    const a = toCreditApplication({ id: 'x', settlement_id: null, note_id: 'n', invoice_id: 'i', amount_fc: usd(34800), source_amount: usd(34800), amount: usd(34800), fx_gain_loss: usd(0), applied_on: '2026-11-02', journal_id: 'j', reversal_journal_id: null, reversed_at: null, created_by: 'u' } as never);
    expect(a).toMatchObject({ invoice_id: 'i', amount_fc: 34800, applied_on: '2026-11-02' });
  });
});

describe('document payments', () => {
  const row = (over: Record<string, unknown> = {}) =>
    toDocPayment({
      type: 'settlement', id: 's1', kind: 'receipt', number: 'RCT-1', date: '2026-11-02',
      amount_fc: eur(5000), amount: usd(5500), fx_gain_loss: usd(20), can: { undo: false }, ...over,
    } as never);
  it('keeps the document-currency amount, the base amount and the exchange difference as sent', () => {
    expect(row()).toMatchObject({ type: 'settlement', number: 'RCT-1', amount_fc: 5000, currency: 'EUR', amount: 5500, base_currency: 'USD', fx_gain_loss: 20, can_undo: false });
  });
  it('offers undo only when the server says so, and reads a missing number as empty', () => {
    expect(row({ type: 'credit_application', number: null, can: { undo: true } })).toMatchObject({ type: 'credit_application', number: '', can_undo: true });
  });
});
