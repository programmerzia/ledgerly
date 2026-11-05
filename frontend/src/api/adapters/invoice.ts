/**
 * Sales and purchase documents at the API boundary (invoices, credit notes, and later bills and debit notes: the
 * same resource shape, `kind` is data). InvoiceResource -> a view type that keeps the server's money and status
 * words, the form -> InvoiceRequest, and the posting preview. Pure functions; the server owns every figure
 * (totals, tax, amount due) and every verdict. Nothing in here depends on which kind of document it is.
 */
import type { components } from '../schema';
import type { Violation } from '../errors';
import type { InvoiceKind } from '@/types';
import { fromApiMoney, type ApiMoney } from './money';

export type ApiInvoice = components['schemas']['InvoiceResource'];
export type ApiInvoiceLine = components['schemas']['InvoiceLineResource'];
export type ApiInvoicePreview = components['schemas']['InvoicePostingPreviewResource'];

export type DocStatus = 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'void';
export type PaymentStatus = 'draft' | 'pending_approval' | 'awaiting_payment' | 'partially_paid' | 'overdue' | 'paid' | 'reversed' | 'void';

export interface DocCan {
  update: boolean;
  submit: boolean;
  approve: boolean;
  return: boolean;
  void: boolean;
  reverse: boolean;
  /** Bills only: may submit a bill that does not match its order, with a reason. */
  override_match: boolean;
  /** May email this document (3c.5); a sales document only. */
  send: boolean;
}

export function toDocCan(raw: unknown): DocCan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (k: string) => r[k] === true;
  return { update: b('update'), submit: b('submit'), approve: b('approve'), return: b('return'), void: b('void'), reverse: b('reverse'), override_match: b('override_match'), send: b('send') };
}

export interface LiveDocLine {
  line_no: number;
  item_id: string | null;
  account_id: string;
  description: string;
  /** Decimal string, as the server holds it. */
  quantity: string;
  unit_price_fc: number;
  discount_pct: string;
  tax_code_id: string | null;
  line_total_fc: number;
  tax_amount_fc: number;
  dimensions: Record<string, string>;
  /** Bills only: the order line this line bills, and the receipt line it bills. Null for everything else. */
  purchase_order_line_id: string | null;
  goods_receipt_line_id: string | null;
}

export interface LiveDoc {
  id: string;
  kind: InvoiceKind;
  number: string | null;
  status: DocStatus;
  paymentStatus: PaymentStatus;
  contact_id: string;
  issue_date: string;
  due_date: string;
  currency: string;
  /** Decimal string; display with `rateForDisplay` only. */
  fx_rate: string;
  reference: string;
  memo: string;
  subtotal_fc: number;
  tax_total_fc: number;
  total_fc: number;
  subtotal: number;
  tax_total: number;
  total: number;
  wht_amount_fc: number;
  /** Base currency. */
  wht_amount: number;
  wht_code_id: string | null;
  settled_fc: number;
  /** Base currency. Zero until the document is posted. For a credit note: the credit still left to apply. */
  settled: number;
  amount_due: number;
  /** What is still open, in the document's own currency. */
  amount_due_fc: number;
  /** The company's base currency, the currency of `amount_due`, `settled` and the base totals. */
  baseCurrency: string;
  related_invoice_id: string | null;
  journal_id: string | null;
  reversal_journal_id: string | null;
  created_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  version: number;
  lines: LiveDocLine[];
  can: DocCan;
}

const money = (m: ApiMoney): number => fromApiMoney(m);
const moneyOrNull = (m: ApiMoney | undefined | null): number | null => (m && typeof m.amount === 'number' ? fromApiMoney(m) : null);

export function toDocLine(l: ApiInvoiceLine): LiveDocLine {
  return {
    line_no: l.line_no,
    item_id: l.item_id,
    account_id: l.account_id,
    description: l.description ?? '',
    quantity: l.quantity,
    unit_price_fc: money(l.unit_price_fc),
    discount_pct: l.discount_pct,
    tax_code_id: l.tax_code_id,
    line_total_fc: money(l.line_total_fc),
    tax_amount_fc: money(l.tax_amount_fc),
    dimensions: l.dimensions ?? {},
    purchase_order_line_id: l.purchase_order_line_id ?? null,
    goods_receipt_line_id: l.goods_receipt_line_id ?? null,
  };
}

export function toDoc(a: ApiInvoice): LiveDoc {
  return {
    id: a.id,
    kind: a.kind,
    number: a.number,
    status: a.status,
    paymentStatus: a.payment_status,
    contact_id: a.contact_id,
    issue_date: a.issue_date ?? '',
    due_date: a.due_date ?? '',
    currency: a.currency,
    fx_rate: a.fx_rate,
    reference: a.reference ?? '',
    memo: a.memo ?? '',
    subtotal_fc: money(a.subtotal_fc),
    tax_total_fc: money(a.tax_total_fc),
    total_fc: money(a.total_fc),
    subtotal: money(a.subtotal),
    tax_total: money(a.tax_total),
    total: money(a.total),
    wht_amount_fc: money(a.wht_amount_fc),
    wht_amount: money(a.wht_amount),
    wht_code_id: a.wht_code_id ?? null,
    settled_fc: money(a.settled_fc),
    settled: money(a.settled),
    amount_due: money(a.amount_due),
    amount_due_fc: money(a.amount_due_fc),
    baseCurrency: a.amount_due.currency,
    related_invoice_id: a.related_invoice_id,
    journal_id: a.journal_id,
    reversal_journal_id: a.reversal_journal_id,
    created_by: a.created_by,
    submitted_by: a.submitted_by,
    approved_by: a.approved_by,
    posted_by: a.posted_by,
    posted_at: a.posted_at,
    version: a.version,
    lines: (a.lines ?? []).map(toDocLine),
    can: toDocCan(a.can),
  };
}

/* ------------------------------------------------------------------ the form */

/** A line as the form holds it: quantity and discount are typed text (decimal strings), the price is minor units. */
export interface DocLineInput {
  item_id?: string;
  account_id: string;
  description: string;
  quantity: string;
  unit_price_fc: number;
  discount_pct: string;
  tax_code_id?: string;
  /** Carried through an edit untouched (the form has no editor for them). */
  dimensions?: Record<string, string>;
  /**
   * Bills only. A PUT replaces the lines, so a line that came from an order must send these again or its link to the
   * order (and the three-way match) is gone. Left out when the line has none, so other documents are unchanged.
   */
  purchase_order_line_id?: string;
  goods_receipt_line_id?: string;
}

export interface DocDraftInput {
  kind: InvoiceKind;
  contact_id: string;
  issue_date: string;
  /** Empty: the server works it out from the contact's payment terms. */
  due_date: string;
  currency: string;
  /** Empty: the server uses its stored rate for the day. Only sent when the document is not in the base currency. */
  fx_rate: string;
  reference: string;
  memo: string;
  related_invoice_id?: string;
  /** Bills only: the withholding tax code. `undefined` leaves the field out (the API refuses it on sales documents); '' clears it. */
  wht_code_id?: string;
  lines: DocLineInput[];
}

const DECIMAL_QTY = /^\d{1,12}(\.\d{1,6})?$/;
const DECIMAL_PCT = /^\d{1,3}(\.\d{1,4})?$/;
export const isQuantity = (s: string): boolean => DECIMAL_QTY.test(s.trim());
export const isDiscount = (s: string): boolean => s.trim() === '' || DECIMAL_PCT.test(s.trim());

/**
 * Create (`version` undefined) or replace (`version` given) a draft. The API refuses `kind` on a replace
 * (`document_kind_fixed`) and totals are never sent: the server calculates them.
 */
export function toInvoiceRequest(input: DocDraftInput, baseCurrency: string, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contact_id: input.contact_id,
    issue_date: input.issue_date,
    due_date: input.due_date || null,
    currency: input.currency,
    reference: input.reference.trim() || null,
    memo: input.memo.trim() || null,
    related_invoice_id: input.related_invoice_id || null,
    lines: input.lines.map((l) => ({
      item_id: l.item_id || null,
      account_id: l.account_id || null,
      description: l.description.trim() || null,
      quantity: l.quantity.trim(),
      unit_price_fc: l.unit_price_fc,
      discount_pct: l.discount_pct.trim() || null,
      tax_code_id: l.tax_code_id || null,
      ...(l.dimensions && Object.keys(l.dimensions).length ? { dimensions: l.dimensions } : {}),
      ...(l.purchase_order_line_id ? { purchase_order_line_id: l.purchase_order_line_id } : {}),
      ...(l.goods_receipt_line_id ? { goods_receipt_line_id: l.goods_receipt_line_id } : {}),
    })),
  };
  if (input.currency !== baseCurrency && input.fx_rate.trim()) body.fx_rate = input.fx_rate.trim();
  if (input.wht_code_id !== undefined) body.wht_code_id = input.wht_code_id || null;
  if (version === undefined) body.kind = input.kind;
  else body.version = version;
  return body;
}

/** Back from a received document to the form (editing a draft, crediting an invoice). */
export function toDraftInput(d: LiveDoc): DocDraftInput {
  return {
    kind: d.kind,
    contact_id: d.contact_id,
    issue_date: d.issue_date,
    due_date: d.due_date,
    currency: d.currency,
    fx_rate: d.fx_rate,
    reference: d.reference,
    memo: d.memo,
    related_invoice_id: d.related_invoice_id ?? undefined,
    ...(d.wht_code_id ? { wht_code_id: d.wht_code_id } : {}),
    lines: d.lines.map((l) => ({
      item_id: l.item_id ?? undefined,
      account_id: l.account_id,
      description: l.description,
      quantity: trimDecimal(l.quantity),
      unit_price_fc: l.unit_price_fc,
      discount_pct: trimDecimal(l.discount_pct),
      tax_code_id: l.tax_code_id ?? undefined,
      dimensions: l.dimensions,
      ...(l.purchase_order_line_id ? { purchase_order_line_id: l.purchase_order_line_id } : {}),
      ...(l.goods_receipt_line_id ? { goods_receipt_line_id: l.goods_receipt_line_id } : {}),
    })),
  };
}

/**
 * A copy of any document as a new draft (plan 3c.34): the same contact, lines, prices, tax codes and dimensions, dated
 * `today`, with nothing that belongs to the source. No number, no due date (the server works it out from the
 * contact's terms for the new date), no stored exchange rate (the server uses its rate for the new day), no link to a
 * purchase order or goods receipt, no link to the invoice a credit note was raised against. Tax rates are not carried
 * either: only the tax code is sent, and the server finds the rate in force on the new date. A bill's reference is the
 * supplier's own invoice number, so it is not copied.
 */
export function toCopyInput(d: LiveDoc, today: string): DocDraftInput {
  return {
    kind: d.kind,
    contact_id: d.contact_id,
    issue_date: today,
    due_date: '',
    currency: d.currency,
    fx_rate: '',
    reference: d.kind === 'purchase_bill' ? '' : d.reference,
    memo: d.memo,
    ...(d.wht_code_id ? { wht_code_id: d.wht_code_id } : {}),
    lines: d.lines.map((l) => ({
      item_id: l.item_id ?? undefined,
      account_id: l.account_id,
      description: l.description,
      quantity: trimDecimal(l.quantity),
      unit_price_fc: l.unit_price_fc,
      discount_pct: trimDecimal(l.discount_pct),
      tax_code_id: l.tax_code_id ?? undefined,
      dimensions: l.dimensions,
    })),
  };
}

/** "2.000000" -> "2", "0.0000" -> "" for discount, "12.50" -> "12.5". Text only, no arithmetic. */
export function trimDecimal(s: string): string {
  if (!s.includes('.')) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '0' ? '' : t;
}

/* -------------------------------------------------------------------- preview */

export interface DocPreviewLine {
  line_no: number;
  account_id: string;
  debit: number;
  credit: number;
  description: string;
}

export interface DocPreview {
  valid: boolean;
  violations: Violation[];
  period: { id: string | null; name: string | null; status: string | null } | null;
  totalDebit: number;
  totalCredit: number;
  currency: string;
  lines: DocPreviewLine[];
}

export function toDocPreview(p: ApiInvoicePreview): DocPreview {
  return {
    valid: p.valid,
    violations: (p.violations ?? []) as Violation[],
    period: p.period ?? null,
    totalDebit: money(p.total_debit),
    totalCredit: money(p.total_credit),
    currency: p.total_debit.currency,
    lines: (p.lines ?? []).map((l) => ({
      line_no: l.line_no,
      account_id: l.account_id,
      debit: money(l.debit),
      credit: money(l.credit),
      description: l.description ?? '',
    })),
  };
}

/** Field errors of a 422 keyed `lines.2.quantity` -> per line index and field; everything else is header-level. */
export function splitDocFieldErrors(errors: Record<string, string[]> | undefined): {
  header: Array<{ field: string; message: string }>;
  byIndex: Map<number, Record<string, string>>;
} {
  const header: Array<{ field: string; message: string }> = [];
  const byIndex = new Map<number, Record<string, string>>();
  for (const [key, msgs] of Object.entries(errors ?? {})) {
    const m = /^lines\.(\d+)\.(\w+)/.exec(key);
    const message = msgs[0] ?? '';
    if (m) {
      const i = Number(m[1]);
      byIndex.set(i, { ...(byIndex.get(i) ?? {}), [m[2]]: message });
    } else header.push({ field: key, message });
  }
  return { header, byIndex };
}

/** Violations of a refused document: a line-numbered one belongs to a form line, the rest to the page. */
export function splitDocViolations(violations: Violation[]): { header: Violation[]; byLine: Map<number, Violation[]> } {
  const header: Violation[] = [];
  const byLine = new Map<number, Violation[]>();
  for (const v of violations) {
    if (typeof v.line_no === 'number') byLine.set(v.line_no, [...(byLine.get(v.line_no) ?? []), v]);
    else header.push(v);
  }
  return { header, byLine };
}
