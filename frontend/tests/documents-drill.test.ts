import { describe, expect, it } from 'vitest';
import { parseTaxReturn } from '@/api/adapters/report';
import { documentPath } from '@/pages/Reports/live/DocumentsDrill';

const m = (amount: number) => ({ amount, currency: 'USD' });

describe('drill from aging and tax return to documents (3c.21)', () => {
  it('opens each kind of document where its screen is', () => {
    expect(documentPath('acme', 'sales_invoice', 'i1')).toBe('/acme/invoices/i1');
    expect(documentPath('acme', 'credit_note', 'c1')).toBe('/acme/invoices/c1');
    expect(documentPath('acme', 'purchase_bill', 'b1')).toBe('/acme/bills/b1');
    expect(documentPath('acme', 'debit_note', 'd1')).toBe('/acme/bills/d1');
    expect(documentPath('acme', 'receipt', 'r1')).toBe('/acme/receipts/r1');
    expect(documentPath('acme', 'supplier_refund', 'p1')).toBe('/acme/payments/p1');
    expect(documentPath('acme', 'something_else', 'x')).toBeNull();
  });

  it('keeps the tax code id of each tax return row, and none for lines without a code', () => {
    const side = (rows: unknown[]) => ({ tax_type: 'output', rows, totals: { net: m(0), tax: m(0) } });
    const tr = parseTaxReturn({
      generated_at: '2026-11-02T03:24:16Z', currency: 'USD', from: '2026-03-01', to: '2026-03-31', net_tax_payable: m(0),
      sales: side([{ tax_code: { id: 'tc-1', code: 'VAT10', name: 'VAT 10%', kind: 'vat' }, net: m(100), tax: m(10) }, { tax_code: null, net: m(5), tax: m(0) }]),
      purchases: side([]),
    });
    expect(tr.sales.rows.map((r) => r.taxCodeId)).toEqual(['tc-1', null]);
  });
});
