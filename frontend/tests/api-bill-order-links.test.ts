import { describe, it, expect } from 'vitest';
import { toDoc, toDraftInput, toInvoiceRequest, type ApiInvoice } from '@/api/adapters/invoice';

const usd = (amount: number) => ({ amount, currency: 'USD' });

const line = (n: number, over: Record<string, unknown> = {}) => ({
  line_no: n,
  item_id: null,
  account_id: 'a1',
  description: `Line ${n}`,
  quantity: '2.000000',
  unit_price_fc: usd(5000),
  discount_pct: '0.0000',
  tax_code_id: null,
  line_total_fc: usd(10000),
  tax_amount_fc: usd(0),
  tax_detail: {},
  dimensions: {},
  purchase_order_line_id: null,
  goods_receipt_line_id: null,
  ...over,
});

const bill = (lines: unknown[], can: Record<string, boolean> = {}): ApiInvoice =>
  ({
    id: 'b1',
    kind: 'purchase_bill',
    number: null,
    status: 'draft',
    payment_status: 'draft',
    contact_id: 's1',
    issue_date: '2026-11-02',
    due_date: null,
    currency: 'USD',
    fx_rate: '1.00000000',
    reference: null,
    memo: null,
    subtotal_fc: usd(0),
    tax_total_fc: usd(0),
    total_fc: usd(0),
    subtotal: usd(0),
    tax_total: usd(0),
    total: usd(0),
    wht_code_id: null,
    wht_amount_fc: usd(0),
    wht_amount: usd(0),
    settled_fc: usd(0),
    settled: usd(0),
    amount_due: usd(0),
    amount_due_fc: usd(0),
    related_invoice_id: null,
    journal_id: null,
    reversal_journal_id: null,
    created_by: 'u1',
    submitted_by: null,
    approved_by: null,
    posted_by: null,
    posted_at: null,
    version: 4,
    lines,
    can,
  }) as unknown as ApiInvoice;

type Sent = { purchase_order_line_id?: string; goods_receipt_line_id?: string; description: string };

describe('bill lines keep their order links through an edit', () => {
  it('sends both ids back unchanged for each linked line, in the same order', () => {
    const doc = toDoc(bill([line(1, { purchase_order_line_id: 'pol-1', goods_receipt_line_id: 'grl-1' }), line(2), line(3, { purchase_order_line_id: 'pol-3' })]));
    const body = toInvoiceRequest(toDraftInput(doc), 'USD', doc.version);
    const lines = body.lines as Sent[];
    expect(lines[0]).toMatchObject({ purchase_order_line_id: 'pol-1', goods_receipt_line_id: 'grl-1' });
    expect(lines[2]).toMatchObject({ purchase_order_line_id: 'pol-3' });
    expect(lines[2]).not.toHaveProperty('goods_receipt_line_id');
  });

  it('moves the links with the lines when the form reorders them', () => {
    const doc = toDoc(bill([line(1, { purchase_order_line_id: 'pol-1' }), line(2, { purchase_order_line_id: 'pol-2', goods_receipt_line_id: 'grl-2' })]));
    const input = toDraftInput(doc);
    const swapped = { ...input, lines: [input.lines[1], input.lines[0]] };
    const lines = toInvoiceRequest(swapped, 'USD', doc.version).lines as Sent[];
    expect(lines.map((l) => [l.description, l.purchase_order_line_id, l.goods_receipt_line_id])).toEqual([
      ['Line 2', 'pol-2', 'grl-2'],
      ['Line 1', 'pol-1', undefined],
    ]);
  });

  it('sends no link at all for a bill with no order, so its payload is otherwise unchanged', () => {
    const doc = toDoc(bill([line(1), line(2)]));
    const lines = toInvoiceRequest(toDraftInput(doc), 'USD', doc.version).lines as Array<Record<string, unknown>>;
    for (const l of lines) {
      expect(l).not.toHaveProperty('purchase_order_line_id');
      expect(l).not.toHaveProperty('goods_receipt_line_id');
    }
    expect(Object.keys(lines[0]).sort()).toEqual(['account_id', 'description', 'discount_pct', 'item_id', 'quantity', 'tax_code_id', 'unit_price_fc']);
  });

  it('treats an older response without the fields as unlinked', () => {
    const raw = line(1) as Record<string, unknown>;
    delete raw.purchase_order_line_id;
    delete raw.goods_receipt_line_id;
    const doc = toDoc(bill([raw]));
    expect(doc.lines[0].purchase_order_line_id).toBeNull();
    expect(doc.lines[0].goods_receipt_line_id).toBeNull();
  });

  it('reads the override permission from can, false when absent', () => {
    expect(toDoc(bill([], { override_match: true })).can.override_match).toBe(true);
    expect(toDoc(bill([], {})).can.override_match).toBe(false);
  });
});
