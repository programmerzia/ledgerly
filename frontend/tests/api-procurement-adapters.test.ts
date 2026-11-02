import { describe, it, expect } from 'vitest';
import {
  convertibleLines,
  dimsToMap,
  humanise,
  isMatchOverrideForbidden,
  isPositiveQuantity,
  linesChanged,
  matchLineFor,
  matchOutcomeLabel,
  matchRefusal,
  openReceiptLines,
  sentLines,
  snapshotToLines,
  statusLabel,
  statusTone,
  toAwaitingReceipt,
  toBillFromRequest,
  toBillMatch,
  toConvertRequest,
  toOpenCommitments,
  toOrder,
  toOrderInput,
  toOrderRequest,
  toReceipt,
  toReceiptRequest,
  toReceivedNotBilled,
  toRequisition,
  toRequisitionInput,
  toRequisitionRequest,
  toRevision,
  toRevisionRequest,
  toSnapshot,
  type ApiAwaitingReceipt,
  type ApiBillMatch,
  type ApiOpenCommitments,
  type ApiOrder,
  type ApiReceipt,
  type ApiReceivedNotBilled,
  type ApiRequisition,
  type ApiRevision,
} from '@/api/adapters/procurement';
import { ApiError } from '@/api/errors';
import { toApprovalItem, type ApiApproval } from '@/api/adapters/journal';
import { DOCUMENT_TYPES, documentTypeLabel, isPercent, purchasingErrors, purchasingPatch, toPurchasingForm } from '@/api/adapters/admin';
import { describePurchaseViolation, describeTradeViolation } from '@/api/tradeViolations';

const usd = (amount: number) => ({ amount, currency: 'USD' });
const eur = (amount: number) => ({ amount, currency: 'EUR' });

/* ---------------------------------------------------------------- requisitions */

const apiRequisition = (over: Record<string, unknown> = {}): ApiRequisition =>
  ({
    id: 'rq1',
    number: 'REQ-1',
    status: 'approved',
    requisition_date: '2026-11-02',
    currency: 'USD',
    memo: null,
    total: usd(25000),
    rejection_reason: null,
    created_by: 'u1',
    submitted_by: 'u1',
    approved_by: 'u2',
    approved_at: '2026-11-03T09:00:00Z',
    version: 3,
    lines: [
      { id: 'rl1', line_no: 1, item_id: null, description: 'Chairs', quantity: '4.000000', estimated_unit_price: usd(5000), line_total: usd(20000), account_id: 'a1', dimensions: { d1: 'v1' }, needed_by: '2026-12-01', purchase_order: null },
      { id: 'rl2', line_no: 2, item_id: 'i1', description: null, quantity: '1.000000', estimated_unit_price: usd(5000), line_total: usd(5000), account_id: null, dimensions: {}, needed_by: null, purchase_order: { id: 'po1', number: 'PO-1' } },
    ],
    can: { convert: true, submit: false },
    ...over,
  }) as unknown as ApiRequisition;

describe('requisitions', () => {
  it('keeps money as whole minor units and quantities as the server text', () => {
    const r = toRequisition(apiRequisition());
    expect(r.total).toBe(25000);
    expect(r.lines[0].estimated_unit_price).toBe(5000);
    expect(r.lines[0].line_total).toBe(20000);
    expect(r.lines[0].quantity).toBe('4.000000');
    expect(typeof r.lines[0].quantity).toBe('string');
  });

  it('refuses a money amount that is not a whole number of minor units', () => {
    expect(() => toRequisition(apiRequisition({ total: usd(10.5) }))).toThrow();
  });

  it('links each line to its order, or none, and lists the lines still open to convert', () => {
    const r = toRequisition(apiRequisition());
    expect(r.lines[1].order).toEqual({ id: 'po1', number: 'PO-1' });
    expect(r.lines[0].order).toBeNull();
    expect(convertibleLines(r).map((l) => l.id)).toEqual(['rl1']);
  });

  it('reads can as explicit trues only', () => {
    const r = toRequisition(apiRequisition());
    expect(r.can.convert).toBe(true);
    expect(r.can.submit).toBe(false);
    expect(r.can.approve).toBe(false);
  });

  it('does not crash on a status it does not know', () => {
    const r = toRequisition(apiRequisition({ status: 'on_hold', can: null, lines: undefined }));
    expect(r.status).toBe('on_hold');
    expect(statusLabel('requisition', r.status)).toBe('On hold');
    expect(r.lines).toEqual([]);
    expect(r.can.update).toBe(false);
  });

  it('builds the request without totals; a create has no version, a replace has', () => {
    const input = toRequisitionInput(toRequisition(apiRequisition({ status: 'draft' })));
    const create = toRequisitionRequest(input);
    expect(create).not.toHaveProperty('version');
    expect(create).not.toHaveProperty('total');
    const lines = create.lines as Array<Record<string, unknown>>;
    expect(lines[0]).toMatchObject({ quantity: '4', estimated_unit_price: 5000, dimensions: { d1: 'v1' }, needed_by: '2026-12-01' });
    expect(lines[1]).not.toHaveProperty('dimensions');
    expect(lines[1].needed_by).toBeNull();
    expect(toRequisitionRequest(input, 3).version).toBe(3);
  });
});

describe('convert a requisition into an order', () => {
  const lines = [{ requisition_line_id: 'rl1', unit_price_fc: 4200, tax_code_id: 't1' }, { requisition_line_id: 'rl3' }];
  const base = { contact_id: 's1', order_date: '2026-11-04', expected_date: '', fx_rate: '', reference: '', memo: '', lines };

  it('sends no price when the order is in the requisition currency', () => {
    const body = toConvertRequest({ ...base, currency: 'USD' }, 'USD');
    expect(body).not.toHaveProperty('fx_rate');
    const sent = body.lines as Array<Record<string, unknown>>;
    expect(sent[0]).toEqual({ requisition_line_id: 'rl1', tax_code_id: 't1' });
    expect(sent[1]).toEqual({ requisition_line_id: 'rl3' });
  });

  it('sends the price per line, and the rate if given, when the currency differs', () => {
    const body = toConvertRequest({ ...base, currency: 'EUR', fx_rate: '1.08' }, 'USD');
    expect(body.currency).toBe('EUR');
    expect(body.fx_rate).toBe('1.08');
    expect((body.lines as Array<Record<string, unknown>>)[0].unit_price_fc).toBe(4200);
  });
});

/* ---------------------------------------------------------------------- orders */

const apiOrder = (over: Record<string, unknown> = {}): ApiOrder =>
  ({
    id: 'po1',
    number: 'PO-2026-0001',
    status: 'partly_received',
    contact_id: 's1',
    contact_name: 'Acme Supplies',
    order_date: '2026-11-02',
    expected_date: '2026-11-20',
    currency: 'EUR',
    fx_rate: '1.08000000',
    reference: 'Q-77',
    memo: null,
    subtotal_fc: eur(100000),
    tax_total_fc: eur(16000),
    total_fc: eur(116000),
    subtotal: usd(108000),
    tax_total: usd(17280),
    total: usd(125280),
    revision: 2,
    created_by: 'u1',
    submitted_by: 'u1',
    approved_by: 'u2',
    approved_at: '2026-11-03T09:00:00Z',
    cancelled_at: null,
    cancel_reason: null,
    closed_at: null,
    version: 5,
    open_revision_id: 'rev9',
    lines: [
      { id: 'ol1', line_no: 1, item_id: null, account_id: 'a1', description: 'Chairs', quantity: '10.000000', unit_price_fc: eur(10000), tax_code_id: 't1', line_total_fc: eur(100000), tax_amount_fc: eur(16000), dimensions: { d1: 'v1' }, requisition_line_id: 'rl1', received: '4.000000', billed: '0.000000', open_to_receive: '6.000000', received_not_billed: '4.000000' },
      { id: 'ol2', line_no: 2, item_id: null, account_id: 'a1', description: 'Delivery', quantity: '1.000000', unit_price_fc: eur(0), tax_code_id: null, line_total_fc: eur(0), tax_amount_fc: eur(0), dimensions: {}, requisition_line_id: null, received: '1.000000', billed: '1.000000', open_to_receive: '0.000000', received_not_billed: '0.000000' },
    ],
    can: { receive: true, revise: true, bill: false },
    ...over,
  }) as unknown as ApiOrder;

describe('purchase orders', () => {
  it('keeps document and base money as minor units, and received/billed as text', () => {
    const o = toOrder(apiOrder());
    expect(o.total_fc).toBe(116000);
    expect(o.total).toBe(125280);
    expect(o.baseCurrency).toBe('USD');
    expect(o.lines[0].unit_price_fc).toBe(10000);
    expect(o.lines[0].received).toBe('4.000000');
    expect(o.lines[0].open_to_receive).toBe('6.000000');
    expect(o.revision).toBe(2);
    expect(o.open_revision_id).toBe('rev9');
  });

  it('leaves received and billed null when the server leaves them out', () => {
    const o = toOrder(apiOrder({ lines: [{ id: 'ol1', line_no: 1, item_id: null, account_id: 'a1', description: null, quantity: '1.000000', unit_price_fc: eur(100), tax_code_id: null, line_total_fc: eur(100), tax_amount_fc: eur(0), dimensions: {}, requisition_line_id: null, received: null, billed: null, open_to_receive: null, received_not_billed: null }] }));
    expect(o.lines[0].received).toBeNull();
    expect(openReceiptLines(o)).toEqual([]);
  });

  it('does not crash on a status it does not know', () => {
    const o = toOrder(apiOrder({ status: 'on_hold', open_revision_id: undefined }));
    expect(statusLabel('order', o.status)).toBe('On hold');
    expect(statusTone('on_hold')).toBe('neutral');
    expect(o.open_revision_id).toBeNull();
    expect(statusLabel('order', 'partly_received')).toBe('Partly received');
    expect(humanise('')).toBe('');
  });

  it('round trips line ids on a replace, and sends none on a create', () => {
    const input = toOrderInput(toOrder(apiOrder()));
    const put = toOrderRequest(input, 'USD', 5);
    const putLines = put.lines as Array<Record<string, unknown>>;
    expect(putLines.map((l) => l.id)).toEqual(['ol1', 'ol2']);
    expect(put.version).toBe(5);
    expect(put.fx_rate).toBe('1.08000000');
    const post = toOrderRequest(input, 'USD');
    expect((post.lines as Array<Record<string, unknown>>).every((l) => !('id' in l))).toBe(true);
    expect(post).not.toHaveProperty('version');
  });

  it('keeps line ids with their lines when the form reorders them, and omits the id of a new line', () => {
    const input = toOrderInput(toOrder(apiOrder()));
    const reordered = { ...input, lines: [input.lines[1], { ...input.lines[0], id: undefined }, input.lines[0]] };
    const ids = (toOrderRequest(reordered, 'USD', 5).lines as Array<Record<string, unknown>>).map((l) => l.id);
    expect(ids).toEqual(['ol2', undefined, 'ol1']);
  });

  it('sends the rate only for a foreign order, quantities as typed text, prices as whole numbers', () => {
    const input = toOrderInput(toOrder(apiOrder({ currency: 'USD' })));
    expect(toOrderRequest({ ...input, currency: 'USD', fx_rate: '1' }, 'USD')).not.toHaveProperty('fx_rate');
    const line = (toOrderRequest(input, 'USD').lines as Array<Record<string, unknown>>)[0];
    expect(line.quantity).toBe('10');
    expect(line.unit_price_fc).toBe(10000);
    expect(line.dimensions).toEqual({ d1: 'v1' });
  });

  it('knows a positive quantity from text shape alone', () => {
    expect(isPositiveQuantity('2.5')).toBe(true);
    expect(isPositiveQuantity('0')).toBe(false);
    expect(isPositiveQuantity('0.000')).toBe(false);
    expect(isPositiveQuantity('abc')).toBe(false);
  });
});

/* ------------------------------------------------------------------ revisions */

const line = (over: Record<string, unknown> = {}) => ({ id: 'ol1', line_no: 1, item_id: null, account_id: 'a1', description: 'Chairs', quantity: '10.000000', unit_price_fc: 10000, tax_code_id: 't1', line_total_fc: 100000, tax_amount_fc: 16000, dims: ['v1', null, null, null, null, null, null, null], ...over });

const apiRevision = (over: Record<string, unknown> = {}): ApiRevision =>
  ({
    id: 'rev1',
    purchase_order_id: 'po1',
    revision_no: 1,
    status: 'applied',
    reason: 'Supplier raised the price',
    proposed: { expected_date: '2026-11-25', reference: 'Q-78', memo: null, lines: [line({ unit_price_fc: 11000, line_total_fc: 110000 })], subtotal_fc: 110000, tax_total_fc: 17600, total_fc: 127600 },
    before: { id: 'po1', revision: 0, currency: 'EUR', expected_date: '2026-11-20', reference: 'Q-77', memo: null, totals: { subtotal_fc: 100000, tax_total_fc: 16000, total_fc: 116000, subtotal: 108000, tax_total: 17280, total: 125280 }, lines: [line(), line({ id: 'ol2', line_no: 2, description: 'Delivery', unit_price_fc: 0, line_total_fc: 0, tax_amount_fc: 0 })] },
    after: { id: 'po1', revision: 1, currency: 'EUR', expected_date: '2026-11-25', reference: 'Q-78', memo: null, totals: { subtotal_fc: 110000, tax_total_fc: 17600, total_fc: 127600, subtotal: 118800, tax_total: 19008, total: 137808 }, lines: [line({ unit_price_fc: 11000, line_total_fc: 110000 }), line({ id: 'ol2', line_no: 2, description: 'Delivery', unit_price_fc: 0, line_total_fc: 0, tax_amount_fc: 0 })] },
    total: usd(137808),
    created_by: 'u1',
    submitted_by: 'u1',
    approved_by: 'u2',
    applied_at: '2026-11-04T10:00:00Z',
    version: 4,
    can: { update: false, void: false },
    ...over,
  }) as unknown as ApiRevision;

describe('order revisions', () => {
  it('reads the proposal, the order before and the order after, with their totals', () => {
    const r = toRevision(apiRevision());
    expect(r.revision_no).toBe(1);
    expect(r.proposed?.total_fc).toBe(127600);
    expect(r.before?.total_fc).toBe(116000);
    expect(r.after?.total_fc).toBe(127600);
    expect(r.before?.currency).toBe('EUR');
    expect(r.total).toBe(137808);
    expect(r.after?.lines[0].quantity).toBe('10.000000');
  });

  it('counts the lines a revision changed, by line id', () => {
    const r = toRevision(apiRevision());
    expect(linesChanged(r.before, r.after)).toBe(1);
    const added = toSnapshot({ lines: [line(), line({ id: null, description: 'New' })] });
    expect(linesChanged(toSnapshot({ lines: [line()] }), added)).toBe(1);
    expect(linesChanged(null, r.after)).toBeNull();
    expect(linesChanged(toSnapshot({ lines: [line(), line({ id: 'ol2' })] }), toSnapshot({ lines: [line()] }))).toBe(1);
  });

  it('never throws on a snapshot of an unexpected shape', () => {
    expect(toSnapshot(null)).toBeNull();
    expect(toSnapshot('x')).toBeNull();
    const s = toSnapshot({ lines: [null, { quantity: 3, unit_price_fc: 'x', dims: 'nope' }], totals: 'nope' });
    expect(s?.lines).toHaveLength(2);
    expect(s?.lines[1].quantity).toBe('3');
    expect(s?.lines[1].unit_price_fc).toBeNull();
    expect(s?.lines[1].dims).toEqual([]);
    expect(s?.total_fc).toBeNull();
  });

  it('maps positional dimension values back to dimension ids', () => {
    const byPosition = new Map([[1, 'dim-branch'], [3, 'dim-project']]);
    expect(dimsToMap(['v1', 'ignored', 'v3', null], byPosition)).toEqual({ 'dim-branch': 'v1', 'dim-project': 'v3' });
  });

  it('edits an open revision from its proposal, keeping each order line id', () => {
    const r = toRevision(apiRevision({ status: 'draft', before: null, after: null, proposed: { expected_date: '2026-11-25', reference: 'Q-78', memo: 'm', lines: [line(), line({ id: null, description: 'Extra', dims: [] })], total_fc: 1 } }));
    const lines = snapshotToLines(r.proposed!, new Map([[1, 'dim-branch']]));
    expect(lines.map((l) => l.id)).toEqual(['ol1', undefined]);
    expect(lines[0].dimensions).toEqual({ 'dim-branch': 'v1' });
    const put = toRevisionRequest({ reason: ' price ', expected_date: '', reference: '', memo: '', lines }, 4);
    expect(put.reason).toBe('price');
    expect(put.version).toBe(4);
    expect((put.lines as Array<Record<string, unknown>>).map((l) => l.id)).toEqual(['ol1', undefined]);
    expect(toRevisionRequest({ reason: 'x', expected_date: '', reference: '', memo: '', lines }, undefined)).not.toHaveProperty('version');
  });

  it('does not crash on an unknown status', () => {
    expect(statusLabel('revision', 'applied')).toBe('Applied');
    expect(statusLabel('revision', 'superseded')).toBe('Superseded');
    expect(toRevision(apiRevision({ status: 'superseded', can: undefined })).can.update).toBe(false);
  });
});

/* -------------------------------------------------------------------- receipts */

const apiReceipt = (over: Record<string, unknown> = {}): ApiReceipt =>
  ({
    id: 'gr1',
    number: 'GRN-2026-0001',
    status: 'recorded',
    purchase_order_id: 'po1',
    order_number: 'PO-2026-0001',
    contact_name: 'Acme Supplies',
    receipt_date: '2026-11-10',
    reference: 'DN-5',
    memo: null,
    reversal_reason: null,
    reversed_by: null,
    reversed_at: null,
    version: 0,
    lines: [{ id: 'gl1', line_no: 1, order_line_id: 'ol1', quantity: '4.000000', description: 'Chairs' }],
    can: { reverse: true, bill: true },
    ...over,
  }) as unknown as ApiReceipt;

describe('goods receipts', () => {
  it('reads a receipt and marks a reversed one', () => {
    const r = toReceipt(apiReceipt({ status: 'reversed', reversal_reason: 'Wrong delivery', reversed_at: '2026-11-11T08:00:00Z' }));
    expect(r.status).toBe('reversed');
    expect(r.reversal_reason).toBe('Wrong delivery');
    expect(r.lines[0].quantity).toBe('4.000000');
    expect(statusLabel('receipt', r.status)).toBe('Reversed');
    expect(statusTone('reversed')).toBe('violet');
  });

  it('does not crash on an unknown status or missing lines', () => {
    const r = toReceipt(apiReceipt({ status: 'disputed', lines: undefined, can: undefined }));
    expect(statusLabel('receipt', r.status)).toBe('Disputed');
    expect(r.lines).toEqual([]);
    expect(r.can.reverse).toBe(false);
  });

  it('prefills the form from what the server says is open, and skips lines at zero', () => {
    const o = toOrder(apiOrder());
    const open = openReceiptLines(o);
    expect(open).toHaveLength(1);
    expect(open[0].line.id).toBe('ol1');
    expect(open[0].open).toBe('6');
  });

  it('sends only the lines that have a quantity, with the order version, and counts violations by position sent', () => {
    const lines = [{ order_line_id: 'ol1', quantity: '' }, { order_line_id: 'ol2', quantity: ' 2.5 ' }, { order_line_id: 'ol3', quantity: '1' }];
    const body = toReceiptRequest({ purchase_order_id: 'po1', receipt_date: '2026-11-10', order_version: 5, reference: '', memo: ' ', lines });
    expect(body.order_version).toBe(5);
    expect(body.reference).toBeNull();
    expect(body.memo).toBeNull();
    expect(body.lines).toEqual([{ order_line_id: 'ol2', quantity: '2.5' }, { order_line_id: 'ol3', quantity: '1' }]);
    expect(sentLines(lines).map((l) => l.order_line_id)).toEqual(['ol2', 'ol3']);
    expect(toReceiptRequest({ purchase_order_id: 'po1', receipt_date: 'x', reference: '', memo: '', lines })).not.toHaveProperty('order_version');
  });

  it('builds the bill-from body from the fields that are filled in', () => {
    expect(toBillFromRequest({ issue_date: '2026-11-12', due_date: '', fx_rate: ' ', reference: ' INV-9 ' })).toEqual({ issue_date: '2026-11-12', reference: 'INV-9' });
    expect(toBillFromRequest({})).toEqual({});
  });
});

/* --------------------------------------------------------------------- reports */

describe('procurement reports', () => {
  it('open commitments: rows and the server total, as minor units', () => {
    const api = {
      data: [{ contact_id: 's1', contact_name: 'Acme', account_id: 'a1', account_code: '6000', account_name: 'Supplies', currency: 'EUR', open_fc: eur(100000), open_base: usd(108000) }],
      meta: { total_base: usd(108000) },
    } as unknown as ApiOpenCommitments;
    const r = toOpenCommitments(api);
    expect(r.rows[0].open_fc).toBe(100000);
    expect(r.rows[0].open_base).toBe(108000);
    expect(r.total).toEqual({ total_base: 108000, currency: 'USD' });
  });

  it('awaiting receipt: quantities stay strings', () => {
    const api = {
      data: [{ purchase_order_id: 'po1', number: null, contact_id: 's1', contact_name: 'Acme', order_date: '2026-11-02', expected_date: null, order_line_id: 'ol1', line_no: 1, description: null, item_id: null, ordered: '10.000000', received: '4.000000', open: '6.000000', currency: 'EUR', open_fc: eur(60000), open_base: usd(64800) }],
      meta: { total_base: usd(64800) },
    } as unknown as ApiAwaitingReceipt;
    const r = toAwaitingReceipt(api);
    expect(r.rows[0].open).toBe('6.000000');
    expect(r.rows[0].expected_date).toBe('');
    expect(r.rows[0].open_base).toBe(64800);
    expect(r.total.total_base).toBe(64800);
  });

  it('received not yet billed: keeps the as-of date and the rate text', () => {
    const api = {
      data: [{ purchase_order_id: 'po1', number: 'PO-1', contact_id: 's1', contact_name: 'Acme', order_line_id: 'ol1', line_no: 1, description: 'Chairs', account_id: 'a1', account_code: '6000', account_name: 'Supplies', received: '4.000000', billed: '0.000000', unbilled: '4.000000', currency: 'EUR', fx_rate: '1.08000000', unbilled_fc: eur(40000), unbilled_base: usd(43200) }],
      meta: { as_of: '2026-11-30', total_base: usd(43200) },
    } as unknown as ApiReceivedNotBilled;
    const r = toReceivedNotBilled(api);
    expect(r.asOf).toBe('2026-11-30');
    expect(r.rows[0].fx_rate).toBe('1.08000000');
    expect(r.rows[0].unbilled).toBe('4.000000');
    expect(r.rows[0].unbilled_fc).toBe(40000);
    expect(r.total).toEqual({ total_base: 43200, currency: 'USD' });
  });
});

/* ------------------------------------------------------------------ bill match */

const apiMatch = (over: Record<string, unknown> = {}): ApiBillMatch =>
  ({
    applies: true,
    refusals: [{ code: 'bill_order_not_open', message: 'x', line_no: 2 }],
    mismatches: [{ code: 'match_price_mismatch', message: 'y', line_no: 1 }],
    lines: [{ line_no: 1, purchase_order_id: 'po1', order_line_id: 'ol1', order_number: 'PO-1', order_price_fc: eur(10000), ordered: '10.000000', received: '4.000000', billed_elsewhere: '1.000000' }],
    last_result: { outcome: 'overridden', reason: 'Urgent', violations: [], decided_by: 'u2', created_at: '2026-11-05T10:00:00Z' },
    ...over,
  }) as unknown as ApiBillMatch;

describe('bill match', () => {
  it('reads the panel: order price as minor units, quantities as text', () => {
    const m = toBillMatch(apiMatch());
    expect(m.applies).toBe(true);
    expect(m.lines[0].order_price_fc).toBe(10000);
    expect(m.lines[0].currency).toBe('EUR');
    expect(m.lines[0].billed_elsewhere).toBe('1.000000');
    expect(matchLineFor(m, 1)?.order_number).toBe('PO-1');
    expect(matchLineFor(m, 9)).toBeUndefined();
    expect(m.last_result?.reason).toBe('Urgent');
    expect(matchOutcomeLabel('overridden')).toBe('Passed with an override');
    expect(matchOutcomeLabel('needs_review')).toBe('Needs review');
  });

  it('a bill the match does not apply to reads as not applying, and an old answer without a last result is fine', () => {
    const m = toBillMatch(apiMatch({ applies: false, refusals: [], mismatches: [], lines: [], last_result: null }));
    expect(m.applies).toBe(false);
    expect(m.last_result).toBeNull();
  });

  const refused = (violations: Array<{ code: string; message: string; line_no?: number }>, status = 422) =>
    new ApiError({ status, code: 'posting_rejected', detail: '', violations, requestId: null });

  it('recognises a refusal made only of match codes, and whether it can be overridden', () => {
    const price = matchRefusal(refused([{ code: 'match_price_mismatch', message: 'a', line_no: 1 }, { code: 'purchase_order_required', message: 'b', line_no: 2 }]));
    expect(price?.overridable).toBe(true);
    expect(price?.violations).toHaveLength(2);
    const fixed = matchRefusal(refused([{ code: 'match_price_mismatch', message: 'a', line_no: 1 }, { code: 'bill_order_supplier_mismatch', message: 'b', line_no: 2 }]));
    expect(fixed?.overridable).toBe(false);
    for (const code of ['bill_order_supplier_mismatch', 'bill_order_currency_mismatch', 'bill_order_not_open']) expect(matchRefusal(refused([{ code, message: 'x', line_no: 1 }]))?.overridable).toBe(false);
  });

  it('is not a match refusal when other kinds of violation are mixed in, or for other errors', () => {
    expect(matchRefusal(refused([{ code: 'match_price_mismatch', message: 'a' }, { code: 'period_closed', message: 'b' }]))).toBeNull();
    expect(matchRefusal(refused([{ code: 'period_closed', message: 'b' }]))).toBeNull();
    expect(matchRefusal(refused([], 422))).toBeNull();
    expect(matchRefusal(refused([{ code: 'match_price_mismatch', message: 'a' }], 409))).toBeNull();
    expect(matchRefusal(new Error('x'))).toBeNull();
  });

  it('knows the 403 for a person without the override permission', () => {
    expect(isMatchOverrideForbidden(new ApiError({ status: 403, code: 'match_override_forbidden', detail: '', requestId: null }))).toBe(true);
    expect(isMatchOverrideForbidden(refused([{ code: 'match_override_forbidden', message: 'x' }], 403))).toBe(true);
    expect(isMatchOverrideForbidden(new ApiError({ status: 403, code: 'forbidden', detail: '', requestId: null }))).toBe(false);
  });
});

describe('plain words for the refusals', () => {
  const codes = ['match_price_mismatch', 'match_quantity_exceeds_received', 'purchase_order_required', 'bill_order_supplier_mismatch', 'bill_order_currency_mismatch', 'bill_order_not_open', 'match_override_forbidden', 'receipt_quantity_exceeds_open', 'order_has_open_revision', 'order_not_cancellable', 'order_has_unbilled_receipts', 'requisition_not_approved'];

  it('has a sentence for each code, never the code itself', () => {
    for (const code of codes) {
      const text = describePurchaseViolation({ code, message: 'server text' });
      expect(text).not.toContain('_');
      expect(text).not.toBe('server text');
      expect(text.endsWith('.')).toBe(true);
    }
  });

  it('keeps receipt words on the purchase side (the sales-to-purchase rewrite must not turn "receipt" into "payment")', () => {
    expect(describePurchaseViolation({ code: 'match_quantity_exceeds_received', message: '' })).toContain('receipt');
    expect(describePurchaseViolation({ code: 'receipt_already_billed', message: '' })).toContain('bill');
    expect(describePurchaseViolation({ code: 'receipt_already_billed', message: '' })).not.toContain('payment');
    expect(describeTradeViolation({ code: 'bill_order_not_open', message: '' })).toBe(describePurchaseViolation({ code: 'bill_order_not_open', message: '' }));
  });

  it('leaves the existing codes as they were', () => {
    expect(describePurchaseViolation({ code: 'invoice_has_settlements', message: '' })).toContain('bill');
    expect(describeTradeViolation({ code: 'document_lines_missing', message: '' })).toBe('Add at least one line.');
  });
});

/* ------------------------------------------------------------- inbox and settings */

describe('approvals inbox', () => {
  const approval = (document_type: string, document: Record<string, unknown>): ApiApproval =>
    ({ id: 'ar1', document_type, document_id: 'd1', step: 1, slot: 1, role: 'approver', requested_by: 'u1', requested_by_name: 'Sam', requested_at: '2026-11-02T09:00:00Z', document: { id: 'd1', amount: usd(125000), number: 'X-1', memo: 'Chairs', created_by: 'u1', submitted_by: 'u1', version: 7, ...document } }) as unknown as ApiApproval;

  it('labels a requisition and opens it', () => {
    const i = toApprovalItem(approval('purchase_requisition', {}));
    expect(i.document_type).toBe('purchase_requisition');
    expect(i.api_type).toBe('purchase_requisition');
    expect(i.title).toBe('Purchase requisition: Chairs');
    expect(i.amount).toBe(125000);
    expect(i.document_number).toBe('X-1');
    expect(i.link).toEqual({ path: 'requisitions', id: 'd1' });
    expect(i.version).toBe(7);
  });

  it('labels an order and opens it', () => {
    const i = toApprovalItem(approval('purchase_order', {}));
    expect(i.api_type).toBe('purchase_order');
    expect(i.link).toEqual({ path: 'purchase-orders', id: 'd1' });
  });

  it('opens a revision on its order, with the revision as the approved document', () => {
    const i = toApprovalItem(approval('purchase_order_revision', { purchase_order_id: 'po9', memo: 'Price rise' }));
    expect(i.api_type).toBe('purchase_order_revision');
    expect(i.document_id).toBe('d1');
    expect(i.title).toBe('Order revision: Price rise');
    expect(i.link).toEqual({ path: 'purchase-orders', id: 'po9' });
  });

  it('the older kinds have no link and are unchanged', () => {
    expect(toApprovalItem(approval('bill', { kind: 'purchase_bill' })).link).toBeNull();
    expect(toApprovalItem(approval('journal', { memo: 'x' })).api_type).toBe('journal');
  });
});

describe('approval workflow types', () => {
  it('offers requisitions and orders, not revisions, and still names a revision', () => {
    const values = DOCUMENT_TYPES.map((d) => d.value);
    expect(values).toContain('purchase_requisition');
    expect(values).toContain('purchase_order');
    expect(values).not.toContain('purchase_order_revision');
    expect(documentTypeLabel('purchase_order_revision')).toBe('Purchase order revisions');
    expect(documentTypeLabel('purchase_order')).toBe('Purchase orders');
  });
});

describe('purchasing settings', () => {
  const settings = { require_purchase_order: false, po_price_tolerance_pct: '5.0000', po_quantity_tolerance_pct: '2.5000', receipt_over_tolerance_pct: '0.0000' } as never;

  it('shows the server decimals without trailing zeros', () => {
    expect(toPurchasingForm(settings)).toEqual({ require_purchase_order: false, po_price_tolerance_pct: '5', po_quantity_tolerance_pct: '2.5', receipt_over_tolerance_pct: '0' });
  });

  it('sends only what changed, percentages as text', () => {
    const saved = toPurchasingForm(settings);
    expect(purchasingPatch(saved, saved)).toEqual({});
    expect(purchasingPatch(saved, { ...saved, require_purchase_order: true, po_price_tolerance_pct: ' 7.5 ' })).toEqual({ require_purchase_order: true, po_price_tolerance_pct: '7.5' });
  });

  it('checks a percentage from 0 to 100 by its text shape', () => {
    for (const ok of ['0', '5', '2.5', '100', '100.00', '99.9999']) expect(isPercent(ok)).toBe(true);
    for (const bad of ['', '-1', '101', '100.1', '1.23456', 'abc', '5%']) expect(isPercent(bad)).toBe(false);
    const saved = toPurchasingForm(settings);
    expect(purchasingErrors(saved)).toEqual({});
    expect(Object.keys(purchasingErrors({ ...saved, po_quantity_tolerance_pct: '120' }))).toEqual(['po_quantity_tolerance_pct']);
  });
});
