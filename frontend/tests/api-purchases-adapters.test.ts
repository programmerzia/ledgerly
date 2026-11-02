import { describe, it, expect } from 'vitest';
import { toDoc, toDraftInput, toInvoiceRequest, type ApiInvoice, type DocDraftInput } from '@/api/adapters/invoice';
import { toSettlementRequest, type SettlementDraftInput } from '@/api/adapters/settlement';
import { toPaymentRun, toRunRequest, toRunCan, type ApiPaymentRun } from '@/api/adapters/paymentRun';
import { toWhtCertificate, type ApiWhtCertificate } from '@/api/adapters/wht';
import { TAX_KIND_LABEL, toGroupRequest, toLiveTaxCode, toLiveTaxGroup, toRateRequest, toTaxCodeReplace, type ApiTaxCodeResource, type ApiTaxGroupResource } from '@/api/adapters/tax';
import { draftOfItem, toItemRequest, toLiveItem, type ApiItemResource } from '@/api/adapters/item';
import { toRecurringDoc, toScheduleRequest } from '@/api/adapters/recurring';
import { describePurchaseViolation, describeTradeViolation } from '@/api/tradeViolations';
import { SIDES, isCreditKind, sideOfKind } from '@/pages/Sales/live/side';

const usd = (amount: number) => ({ amount, currency: 'USD' });
const eur = (amount: number) => ({ amount, currency: 'EUR' });

const apiBill = (over: Record<string, unknown> = {}): ApiInvoice =>
  ({
    id: 'b1',
    kind: 'purchase_bill',
    number: 'BILL-1',
    status: 'posted',
    payment_status: 'awaiting_payment',
    contact_id: 's1',
    issue_date: '2026-11-02',
    due_date: '2026-12-02',
    currency: 'USD',
    fx_rate: '1.00000000',
    reference: 'INV-77',
    memo: null,
    subtotal_fc: usd(300000),
    tax_total_fc: usd(30000),
    total_fc: usd(330000),
    subtotal: usd(300000),
    tax_total: usd(30000),
    total: usd(330000),
    wht_code_id: 'w1',
    wht_amount_fc: usd(15000),
    wht_amount: usd(15000),
    settled_fc: usd(0),
    settled: usd(0),
    amount_due: usd(315000),
    amount_due_fc: usd(315000),
    related_invoice_id: null,
    journal_id: 'j1',
    reversal_journal_id: null,
    created_by: 'u1',
    submitted_by: 'u1',
    approved_by: null,
    posted_by: 'u1',
    posted_at: '2026-11-02T10:00:00Z',
    version: 2,
    lines: [],
    can: { reverse: true },
    ...over,
  }) as unknown as ApiInvoice;

describe('bills at the boundary', () => {
  it('keeps the withholding the server worked out, in document and base currency', () => {
    const d = toDoc(apiBill());
    expect(d.wht_code_id).toBe('w1');
    expect(d.wht_amount_fc).toBe(15000);
    expect(d.wht_amount).toBe(15000);
    expect(d.amount_due).toBe(315000);
    expect(d.amount_due_fc).toBe(315000);
  });

  it('reads the open amount in the document currency', () => {
    const d = toDoc(apiBill({ currency: 'EUR', amount_due: usd(110000), amount_due_fc: eur(100000) }));
    expect(d.amount_due_fc).toBe(100000);
    expect(d.amount_due).toBe(110000);
  });

  it('sends the withholding code only when the form holds one (the API refuses it on sales documents)', () => {
    const base: DocDraftInput = { kind: 'purchase_bill', contact_id: 's1', issue_date: '2026-11-02', due_date: '', currency: 'USD', fx_rate: '', reference: '', memo: '', lines: [{ account_id: 'a1', description: 'x', quantity: '1', unit_price_fc: 100, discount_pct: '' }] };
    expect(toInvoiceRequest(base, 'USD')).not.toHaveProperty('wht_code_id');
    expect(toInvoiceRequest({ ...base, wht_code_id: 'w1' }, 'USD').wht_code_id).toBe('w1');
    expect(toInvoiceRequest({ ...base, wht_code_id: '' }, 'USD', 2).wht_code_id).toBeNull();
    expect(toInvoiceRequest({ ...base, wht_code_id: 'w1' }, 'USD', 2)).not.toHaveProperty('kind');
  });

  it('brings the code back to the form and leaves it out when there is none', () => {
    expect(toDraftInput(toDoc(apiBill())).wht_code_id).toBe('w1');
    expect(toDraftInput(toDoc(apiBill({ wht_code_id: null }))).wht_code_id).toBeUndefined();
  });
});

describe('sides', () => {
  it('maps a kind to its side and knows credit kinds', () => {
    expect(sideOfKind('purchase_bill')).toBe('purchases');
    expect(sideOfKind('debit_note')).toBe('purchases');
    expect(sideOfKind('sales_invoice')).toBe('sales');
    expect(isCreditKind('debit_note')).toBe(true);
    expect(isCreditKind('purchase_bill')).toBe(false);
    expect(SIDES.purchases.resource).toBe('bills');
    expect(SIDES.sales.resource).toBe('invoices');
  });
});

describe('supplier payments and refunds', () => {
  const base: SettlementDraftInput = { kind: 'supplier_refund', contact_id: 's1', cash_account_id: 'c', bank_account_id: 'b', settlement_date: '2026-11-02', amount_fc: 50000, currency: 'USD', fx_rate: '', reference: '', memo: '', allocations: [] };

  it('allocates to a document by invoice_id and to earlier credit by source_settlement_id', () => {
    const body = toSettlementRequest({ ...base, allocations: [{ invoice_id: 'dn1', amount_fc: 22000 }, { source_settlement_id: 'p9', amount_fc: 28000 }, { invoice_id: 'zero', amount_fc: 0 }] }, 'USD');
    expect(body.kind).toBe('supplier_refund');
    expect(body.allocations).toEqual([{ invoice_id: 'dn1', amount_fc: 22000 }, { source_settlement_id: 'p9', amount_fc: 28000 }]);
  });
});

describe('payment runs', () => {
  const apiRun = (over: Record<string, unknown> = {}): ApiPaymentRun =>
    ({
      id: 'r1',
      number: 'RUN-1',
      status: 'draft',
      cash_account_id: 'c',
      bank_account_id: 'b',
      run_date: '2026-11-02',
      currency: 'USD',
      fx_rate: '1.00000000',
      total_gross: usd(427000),
      total_wht: usd(5000),
      total_net: usd(422000),
      total: usd(422000),
      reference: null,
      memo: null,
      created_by: 'u1',
      submitted_by: null,
      approved_by: null,
      posted_by: null,
      posted_at: null,
      version: 1,
      items: [{ id: 'i1', line_no: 1, invoice_id: 'b1', contact_id: 's1', amount_fc: usd(105000), wht_amount_fc: usd(5000) }],
      can: { update: true, submit: true },
      ...over,
    }) as unknown as ApiPaymentRun;

  it('reads the totals and items as the server sent them', () => {
    const r = toPaymentRun(apiRun());
    expect(r.total_gross).toBe(427000);
    expect(r.total_wht).toBe(5000);
    expect(r.total_net).toBe(422000);
    expect(r.items[0]).toMatchObject({ invoice_id: 'b1', amount_fc: 105000, wht_amount_fc: 5000 });
    expect(r.hasItems).toBe(true);
    expect(r.can).toEqual({ update: true, submit: true, approve: false, return: false, void: false });
    expect(toPaymentRun(apiRun({ items: undefined })).hasItems).toBe(false);
  });

  it('builds the request without totals, skipping bills with nothing to pay', () => {
    const body = toRunRequest({ cash_account_id: 'c', bank_account_id: 'b', run_date: '2026-11-02', currency: 'EUR', fx_rate: ' 1.1 ', reference: ' Friday ', memo: '', items: [{ invoice_id: 'b1', amount_fc: 100 }, { invoice_id: 'b2', amount_fc: 0 }] }, 'USD', 3);
    expect(body).toEqual({ cash_account_id: 'c', bank_account_id: 'b', run_date: '2026-11-02', currency: 'EUR', reference: 'Friday', memo: null, items: [{ invoice_id: 'b1', amount_fc: 100 }], fx_rate: '1.1', version: 3 });
    expect(toRunRequest({ cash_account_id: 'c', bank_account_id: '', run_date: 'd', currency: 'USD', fx_rate: '9', reference: '', memo: '', items: [] }, 'USD')).not.toHaveProperty('fx_rate');
    expect(toRunCan(null).submit).toBe(false);
  });
});

describe('WHT certificates', () => {
  it('unwraps the money and keeps the status', () => {
    const c = toWhtCertificate({ id: 'w', number: 'WHT-1', status: 'void', payment_id: 'p', invoice_id: 'b', contact_id: 's', tax_code_id: 't', base_amount: usd(400000), wht_amount: usd(20000), issued_on: '2026-11-02' } as ApiWhtCertificate);
    expect(c).toMatchObject({ number: 'WHT-1', status: 'void', base_amount: 400000, wht_amount: 20000, currency: 'USD', issued_on: '2026-11-02' });
  });
});

describe('tax codes and groups', () => {
  const code = (over: Record<string, unknown> = {}): ApiTaxCodeResource =>
    ({ id: 't1', code: 'VAT10', name: 'VAT 10%', kind: 'vat', rate: '0.100000', rates: [{ id: 'r1', rate: '0.100000', effective_from: '2026-01-01', effective_to: null }], collect_account_id: null, pay_account_id: 'a2', is_recoverable: true, is_active: true, version: 4, can: { update: true, deactivate: false }, ...over }) as unknown as ApiTaxCodeResource;

  it('keeps the rate as the server\'s fraction text', () => {
    const t = toLiveTaxCode(code());
    expect(t.rate).toBe('0.100000');
    expect(t.rates).toEqual([{ id: 'r1', rate: '0.100000', effective_from: '2026-01-01', effective_to: null }]);
    expect(t.can).toEqual({ update: true, deactivate: false });
    expect(toLiveTaxCode(code({ rate: null })).rate).toBeNull();
  });

  it('builds a replace without the code or its rates, and a rate from a percentage text', () => {
    expect(toTaxCodeReplace({ name: ' VAT ', kind: 'vat', collect_account_id: '', pay_account_id: 'a2', is_recoverable: false }, 4)).toEqual({ name: 'VAT', kind: 'vat', collect_account_id: null, pay_account_id: 'a2', is_recoverable: false, version: 4 });
    expect(toRateRequest('7.5', '2027-01-01', 4)).toEqual({ rate: '0.075', effective_from: '2027-01-01', version: 4 });
    expect(toRateRequest('abc', '2027-01-01', 4)).toBeNull();
    expect(toRateRequest('5', '', 4)).toBeNull();
    expect(toRateRequest('101', '2027-01-01', 4)).toBeNull();
  });

  it('orders group items by sequence and sends the code only on create', () => {
    const g = toLiveTaxGroup({ id: 'g1', code: 'MIXED', name: 'Mixed', is_active: true, version: 1, items: [{ tax_code_id: 'b', sequence: 2, compound: true }, { tax_code_id: 'a', sequence: 1, compound: false }], can: {} } as unknown as ApiTaxGroupResource);
    expect(g.items.map((i) => i.tax_code_id)).toEqual(['a', 'b']);
    expect(toGroupRequest(' MIXED ', ' Mixed ', [{ tax_code_id: 'a', compound: false }])).toEqual({ code: 'MIXED', name: 'Mixed', items: [{ tax_code_id: 'a', compound: false }] });
    expect(toGroupRequest('MIXED', 'Mixed', [{ tax_code_id: 'a', compound: true }], 3)).toEqual({ name: 'Mixed', items: [{ tax_code_id: 'a', compound: true }], version: 3 });
  });

  it('has a plain label for every kind the API takes', () => {
    for (const k of ['vat', 'gst', 'sales', 'wht', 'compound', 'exempt', 'zero', 'reverse_charge']) expect(TAX_KIND_LABEL[k]).toBeTruthy();
  });
});

describe('items', () => {
  const api = { id: 'i1', code: 'RETAINER', name: 'Retainer', description: null, kind: 'service', currency: 'USD', sales_account_id: 'a4', purchase_account_id: null, sales_price: usd(125000), purchase_price: usd(0), tax_code_id: 't1', is_active: true, version: 2, can: { update: true } } as unknown as ApiItemResource;

  it('reads prices as integer minor units', () => {
    const i = toLiveItem(api);
    expect(i.sales_price).toBe(125000);
    expect(i.purchase_price).toBe(0);
    expect(i.can).toEqual({ update: true, deactivate: false });
  });

  it('sends no price for zero and the version only on a replace', () => {
    const d = draftOfItem(toLiveItem(api));
    expect(toItemRequest(d)).toMatchObject({ code: 'RETAINER', sales_price: 125000, purchase_price: null, purchase_account_id: null, sales_account_id: 'a4', tax_code_id: 't1', description: null });
    expect(toItemRequest(d)).not.toHaveProperty('version');
    expect(toItemRequest(d, 2).version).toBe(2);
  });
});

describe('recurring invoices and bills', () => {
  it('keeps the document type the server names', () => {
    const s = toRecurringDoc({ id: 'r', name: 'Rent', document_type: 'bill', template_id: 'b1', frequency: 'monthly', next_date: '2026-12-02', end_date: null, owner_id: 'u', is_active: true, last_run_on: null, last_error: null, generated_count: 0, version: 1, can: { pause: true } } as never);
    expect(s.document_type).toBe('bill');
    expect(s.can.pause).toBe(true);
    expect(s.can.resume).toBe(false);
  });

  it('builds the request with an empty end date as null', () => {
    expect(toScheduleRequest({ name: ' Rent ', template_id: 'b1', frequency: 'quarterly', next_date: '2026-12-02', end_date: '' })).toEqual({ name: 'Rent', template_id: 'b1', frequency: 'quarterly', next_date: '2026-12-02', end_date: null });
    expect(toScheduleRequest({ name: 'Rent', template_id: 'b1', frequency: 'annual', next_date: '2026-12-02', end_date: '2028-01-01' }, 5)).toMatchObject({ end_date: '2028-01-01', version: 5 });
  });
});

describe('verdicts in purchase words', () => {
  const v = (code: string) => ({ code, message: 'server text' });
  it('swaps the sales words for the purchase ones, and leaves sales text alone', () => {
    expect(describeTradeViolation(v('credit_exceeds_original'))).toContain('credit notes against this invoice');
    expect(describePurchaseViolation(v('credit_exceeds_original'))).toBe('The debit notes against this bill would add up to more than the bill itself.');
    expect(describePurchaseViolation(v('allocation_contact_mismatch'))).toBe('A bill belongs to a different supplier.');
    expect(describePurchaseViolation(v('invoice_has_settlements'))).toContain('this bill');
  });
  it('falls back to the server text for codes it does not know, in either mode', () => {
    expect(describePurchaseViolation(v('something_new'))).toBe(describeTradeViolation(v('something_new')));
  });
});
