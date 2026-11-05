import { describe, it, expect } from 'vitest';
import { toCopyInput, toInvoiceRequest, type LiveDoc } from '@/api/adapters/invoice';
import { toOrderCopy, toOrderRequest, toRequisitionCopy, toRequisitionRequest, type PurchaseOrder, type Requisition } from '@/api/adapters/procurement';

const doc = (over: Partial<LiveDoc> = {}): LiveDoc =>
  ({
    id: 'doc-1',
    kind: 'purchase_bill',
    number: 'BILL-FY2026-00007',
    status: 'posted',
    contact_id: 'sup-1',
    issue_date: '2026-03-15',
    due_date: '2026-04-14',
    currency: 'EUR',
    fx_rate: '1.08000000',
    reference: 'SUP-INV-991',
    memo: 'March supplies',
    related_invoice_id: 'inv-9',
    journal_id: 'j-1',
    reversal_journal_id: null,
    wht_code_id: 'wht-1',
    settled_fc: 5000,
    amount_due_fc: 0,
    lines: [
      { line_no: 1, item_id: 'it-1', account_id: 'acc-1', description: 'Paper', quantity: '2.000000', unit_price_fc: 5000, discount_pct: '10.0000', tax_code_id: 'vat-1', line_total_fc: 9000, tax_amount_fc: 900, dimensions: { dept: 'd1' }, purchase_order_line_id: 'pol-1', goods_receipt_line_id: 'grl-1' },
    ],
    ...over,
  }) as unknown as LiveDoc;

describe('copying a document into a new draft', () => {
  const body = toInvoiceRequest(toCopyInput(doc(), '2026-11-05'), 'USD');

  it('is dated today with no number, due date or stored exchange rate', () => {
    expect(body.issue_date).toBe('2026-11-05');
    expect(body.due_date).toBeNull();
    expect(body).not.toHaveProperty('fx_rate');
    expect(body).not.toHaveProperty('number');
    expect(body.kind).toBe('purchase_bill');
  });

  it('carries no payment, match or credit links', () => {
    expect(body.related_invoice_id).toBeNull();
    const line = (body.lines as Array<Record<string, unknown>>)[0];
    expect(line).not.toHaveProperty('purchase_order_line_id');
    expect(line).not.toHaveProperty('goods_receipt_line_id');
    expect(body).not.toHaveProperty('journal_id');
    expect(body).not.toHaveProperty('settled_fc');
  });

  it('sends the tax code and no rate or amounts, so the server finds the rate in force today', () => {
    const line = (body.lines as Array<Record<string, unknown>>)[0];
    expect(line.tax_code_id).toBe('vat-1');
    expect(line).not.toHaveProperty('tax_rate');
    expect(line).not.toHaveProperty('tax_amount_fc');
    expect(line).not.toHaveProperty('line_total_fc');
    expect(line.unit_price_fc).toBe(5000);
    expect(line.quantity).toBe('2');
    expect(line.discount_pct).toBe('10');
    expect(line.dimensions).toEqual({ dept: 'd1' });
  });

  it('does not copy a supplier bill reference, but keeps a sales reference', () => {
    expect(body.reference).toBeNull();
    const sales = toInvoiceRequest(toCopyInput(doc({ kind: 'sales_invoice' }), '2026-11-05'), 'USD');
    expect(sales.reference).toBe('SUP-INV-991');
  });

  it('keeps the withholding code on a bill', () => {
    expect(body.wht_code_id).toBe('wht-1');
  });
});

describe('copying a requisition and an order', () => {
  const req = {
    requisition_date: '2026-03-01',
    memo: 'Chairs',
    lines: [
      { item_id: null, description: 'Chair', account_id: 'a1', quantity: '4.0000', estimated_unit_price: 12000, needed_by: '2026-03-20', dimensions: {}, order: { id: 'po-1' } },
      { item_id: null, description: 'Desk', account_id: 'a1', quantity: '1', estimated_unit_price: 40000, needed_by: '2026-12-01', dimensions: {}, order: null },
    ],
  } as unknown as Requisition;

  it('a requisition copy is dated today and drops a needed-by date already past', () => {
    const body = toRequisitionRequest(toRequisitionCopy(req, '2026-11-05'));
    expect(body.requisition_date).toBe('2026-11-05');
    expect(body).not.toHaveProperty('version');
    const lines = body.lines as Array<Record<string, unknown>>;
    expect(lines[0].needed_by).toBeNull();
    expect(lines[1].needed_by).toBe('2026-12-01');
    expect(lines[0]).not.toHaveProperty('order');
  });

  const order = {
    contact_id: 's1',
    order_date: '2026-03-01',
    expected_date: '2026-03-10',
    currency: 'EUR',
    fx_rate: '1.1',
    reference: 'PO-1',
    memo: '',
    lines: [{ id: 'line-1', item_id: null, account_id: 'a1', description: 'Bolts', quantity: '100', unit_price_fc: 25, tax_code_id: 'vat-1', dimensions: {} }],
  } as unknown as PurchaseOrder;

  it('an order copy has no line ids, no stored rate, no past expected date', () => {
    const body = toOrderRequest(toOrderCopy(order, '2026-11-05'), 'USD');
    expect(body.order_date).toBe('2026-11-05');
    expect(body.expected_date).toBeNull();
    expect(body).not.toHaveProperty('fx_rate');
    expect((body.lines as Array<Record<string, unknown>>)[0]).not.toHaveProperty('id');
    expect((body.lines as Array<Record<string, unknown>>)[0].tax_code_id).toBe('vat-1');
  });
});
