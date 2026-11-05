/**
 * Procurement at the API boundary: requisitions, purchase orders and their revisions, goods receipts, the three reports
 * and the bill match. Pure functions. Money is unwrapped to integer minor units (the currency travels beside it) and is
 * never added up, converted or compared here; quantities stay decimal strings; every figure and verdict is the server's.
 */
import type { components } from '../schema';
import { ApiError, type Violation } from '../errors';
import { MATCH_FIXED_CODES, MATCH_OVERRIDABLE_CODES, isMatchCode } from '../tradeViolations';
import { fromApiMoney, type ApiMoney } from './money';
import { isQuantity, trimDecimal } from './invoice';

export type ApiRequisition = components['schemas']['PurchaseRequisitionResource'];
export type ApiRequisitionLine = components['schemas']['PurchaseRequisitionLineResource'];
export type ApiOrder = components['schemas']['PurchaseOrderResource'];
export type ApiOrderLine = components['schemas']['PurchaseOrderLineResource'];
export type ApiRevision = components['schemas']['PurchaseOrderRevisionResource'];
export type ApiReceipt = components['schemas']['GoodsReceiptResource'];
export type ApiReceiptLine = components['schemas']['GoodsReceiptLineResource'];
export type ApiBillMatch = components['schemas']['BillMatchResource'];
export type ApiOpenCommitments = components['schemas']['OpenCommitmentsResource'];
export type ApiAwaitingReceipt = components['schemas']['AwaitingReceiptResource'];
export type ApiReceivedNotBilled = components['schemas']['ReceivedNotBilledResource'];

const money = (m: ApiMoney): number => fromApiMoney(m);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `can` hints: only an explicit `true` counts, so a missing key is "not allowed". */
function bools<K extends string>(raw: unknown, keys: readonly K[]): Record<K, boolean> {
  const r = isRecord(raw) ? raw : {};
  return Object.fromEntries(keys.map((k) => [k, r[k] === true])) as Record<K, boolean>;
}

const REQ_CAN = ['update', 'submit', 'approve', 'return', 'reject', 'void', 'convert'] as const;
const ORDER_CAN = ['update', 'submit', 'approve', 'return', 'cancel', 'close', 'revise', 'receive', 'bill'] as const;
const REVISION_CAN = ['update', 'submit', 'approve', 'return', 'void'] as const;
const RECEIPT_CAN = ['reverse', 'bill'] as const;
export type RequisitionCan = Record<(typeof REQ_CAN)[number], boolean>;
export type OrderCan = Record<(typeof ORDER_CAN)[number], boolean>;
export type RevisionCan = Record<(typeof REVISION_CAN)[number], boolean>;
export type ReceiptCan = Record<(typeof RECEIPT_CAN)[number], boolean>;
export const toRequisitionCan = (raw: unknown): RequisitionCan => bools(raw, REQ_CAN);
export const toOrderCan = (raw: unknown): OrderCan => bools(raw, ORDER_CAN);
export const toRevisionCan = (raw: unknown): RevisionCan => bools(raw, REVISION_CAN);
export const toReceiptCan = (raw: unknown): ReceiptCan => bools(raw, RECEIPT_CAN);

/* ------------------------------------------------------------------- status words */

const REQUISITION_STATUS: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  void: 'Discarded',
};
const ORDER_STATUS: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  partly_received: 'Partly received',
  received: 'Received',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
const REVISION_STATUS: Record<string, string> = { draft: 'Draft', pending_approval: 'Awaiting approval', applied: 'Applied', void: 'Discarded' };
const RECEIPT_STATUS: Record<string, string> = { recorded: 'Recorded', reversed: 'Reversed' };

/** "partly_received" -> "Partly received": a status this build does not know is shown readably, never as a code. */
export function humanise(code: string): string {
  const t = code.replace(/_/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

export type ProcKind = 'requisition' | 'order' | 'revision' | 'receipt';
const WORDS: Record<ProcKind, Record<string, string>> = { requisition: REQUISITION_STATUS, order: ORDER_STATUS, revision: REVISION_STATUS, receipt: RECEIPT_STATUS };
export const statusLabel = (kind: ProcKind, status: string): string => WORDS[kind][status] ?? humanise(status);

export type Tone = 'neutral' | 'warning' | 'success' | 'info' | 'danger' | 'violet';
const TONES: Record<string, Tone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
  partly_received: 'info',
  received: 'success',
  closed: 'neutral',
  cancelled: 'danger',
  rejected: 'danger',
  void: 'danger',
  applied: 'success',
  recorded: 'success',
  reversed: 'violet',
};
export const statusTone = (status: string): Tone => TONES[status] ?? 'neutral';

/** Tabs of the lists: each is a server filter. */
export const ORDER_TABS: Array<{ value: string; label: string; status?: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft', status: 'draft' },
  { value: 'pending', label: 'Awaiting approval', status: 'pending_approval' },
  { value: 'approved', label: 'Approved', status: 'approved' },
  { value: 'partly', label: 'Partly received', status: 'partly_received' },
  { value: 'received', label: 'Received', status: 'received' },
  { value: 'closed', label: 'Closed', status: 'closed' },
  { value: 'cancelled', label: 'Cancelled', status: 'cancelled' },
];
export const REQUISITION_TABS: Array<{ value: string; label: string; status?: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft', status: 'draft' },
  { value: 'pending', label: 'Awaiting approval', status: 'pending_approval' },
  { value: 'approved', label: 'Approved', status: 'approved' },
  { value: 'rejected', label: 'Rejected', status: 'rejected' },
  { value: 'void', label: 'Discarded', status: 'void' },
];
export const RECEIPT_TABS: Array<{ value: string; label: string; status?: string }> = [
  { value: 'all', label: 'All' },
  { value: 'recorded', label: 'Recorded', status: 'recorded' },
  { value: 'reversed', label: 'Reversed', status: 'reversed' },
];

/* ---------------------------------------------------------------------- requisitions */

export interface RequisitionLine {
  id: string;
  line_no: number;
  item_id: string | null;
  description: string;
  /** Decimal string. */
  quantity: string;
  estimated_unit_price: number;
  line_total: number;
  account_id: string | null;
  dimensions: Record<string, string>;
  needed_by: string;
  /** The live order this line is on, if any. */
  order: { id: string; number: string | null } | null;
}

export interface Requisition {
  id: string;
  number: string | null;
  status: string;
  requisition_date: string;
  currency: string;
  memo: string;
  total: number;
  rejection_reason: string;
  created_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  version: number;
  lines: RequisitionLine[];
  can: RequisitionCan;
}

export function toRequisitionLine(l: ApiRequisitionLine): RequisitionLine {
  return {
    id: l.id,
    line_no: l.line_no,
    item_id: l.item_id ?? null,
    description: l.description ?? '',
    quantity: l.quantity,
    estimated_unit_price: money(l.estimated_unit_price),
    line_total: money(l.line_total),
    account_id: l.account_id ?? null,
    dimensions: l.dimensions ?? {},
    needed_by: l.needed_by ?? '',
    order: l.purchase_order ? { id: l.purchase_order.id, number: l.purchase_order.number ?? null } : null,
  };
}

export function toRequisition(a: ApiRequisition): Requisition {
  return {
    id: a.id,
    number: a.number ?? null,
    status: a.status,
    requisition_date: a.requisition_date ?? '',
    currency: a.currency,
    memo: a.memo ?? '',
    total: money(a.total),
    rejection_reason: a.rejection_reason ?? '',
    created_by: a.created_by ?? null,
    submitted_by: a.submitted_by ?? null,
    approved_by: a.approved_by ?? null,
    approved_at: a.approved_at ?? null,
    version: a.version,
    lines: (a.lines ?? []).map(toRequisitionLine),
    can: toRequisitionCan(a.can),
  };
}

/** A requisition line as the form holds it: quantity is typed text, the estimate is minor units. */
export interface RequisitionLineInput {
  item_id?: string;
  description: string;
  account_id?: string;
  quantity: string;
  estimated_unit_price: number;
  needed_by: string;
  dimensions?: Record<string, string>;
}
export interface RequisitionDraftInput {
  requisition_date: string;
  memo: string;
  lines: RequisitionLineInput[];
}

const dimensionsPart = (d?: Record<string, string>) => (d && Object.keys(d).length ? { dimensions: d } : {});

/** Create (`version` undefined) or replace (`version` given). Totals are never sent. */
export function toRequisitionRequest(input: RequisitionDraftInput, version?: number): Record<string, unknown> {
  return {
    requisition_date: input.requisition_date,
    memo: input.memo.trim() || null,
    ...(version === undefined ? {} : { version }),
    lines: input.lines.map((l) => ({
      item_id: l.item_id || null,
      description: l.description.trim() || null,
      account_id: l.account_id || null,
      quantity: l.quantity.trim(),
      estimated_unit_price: l.estimated_unit_price,
      needed_by: l.needed_by || null,
      ...dimensionsPart(l.dimensions),
    })),
  };
}

export function toRequisitionInput(r: Requisition): RequisitionDraftInput {
  return {
    requisition_date: r.requisition_date,
    memo: r.memo,
    lines: r.lines.map((l) => ({
      item_id: l.item_id ?? undefined,
      description: l.description,
      account_id: l.account_id ?? undefined,
      quantity: trimDecimal(l.quantity),
      estimated_unit_price: l.estimated_unit_price,
      needed_by: l.needed_by,
      dimensions: l.dimensions,
    })),
  };
}

/** A copy of a requisition as a new draft dated `today`: no number, no order links. A "needed by" date already past is dropped. */
export function toRequisitionCopy(r: Requisition, today: string): RequisitionDraftInput {
  const input = toRequisitionInput(r);
  return { ...input, requisition_date: today, lines: input.lines.map((l) => ({ ...l, needed_by: l.needed_by >= today ? l.needed_by : '' })) };
}

/** Lines of an approved requisition that are not on an order: the ones "Create order" offers. */
export const convertibleLines = (r: Requisition): RequisitionLine[] => r.lines.filter((l) => l.order === null);

export interface ConvertInput {
  contact_id: string;
  order_date: string;
  expected_date: string;
  currency: string;
  fx_rate: string;
  reference: string;
  memo: string;
  /** Ticked lines. `unit_price_fc` is only sent when the order is not in the requisition's currency. */
  lines: Array<{ requisition_line_id: string; unit_price_fc?: number; tax_code_id?: string }>;
}

export function toConvertRequest(input: ConvertInput, requisitionCurrency: string): Record<string, unknown> {
  const foreign = input.currency !== '' && input.currency !== requisitionCurrency;
  const body: Record<string, unknown> = {
    contact_id: input.contact_id,
    order_date: input.order_date,
    expected_date: input.expected_date || null,
    reference: input.reference.trim() || null,
    memo: input.memo.trim() || null,
    lines: input.lines.map((l) => ({
      requisition_line_id: l.requisition_line_id,
      ...(foreign && l.unit_price_fc !== undefined ? { unit_price_fc: l.unit_price_fc } : {}),
      ...(l.tax_code_id ? { tax_code_id: l.tax_code_id } : {}),
    })),
  };
  if (input.currency) body.currency = input.currency;
  if (foreign && input.fx_rate.trim()) body.fx_rate = input.fx_rate.trim();
  return body;
}

/* ---------------------------------------------------------------------------- orders */

export interface OrderLine {
  id: string;
  line_no: number;
  item_id: string | null;
  account_id: string;
  description: string;
  quantity: string;
  unit_price_fc: number;
  tax_code_id: string | null;
  line_total_fc: number;
  tax_amount_fc: number;
  dimensions: Record<string, string>;
  requisition_line_id: string | null;
  /** Decimal strings, or null where the server leaves them out (a list answers no lines at all). */
  received: string | null;
  billed: string | null;
  open_to_receive: string | null;
  received_not_billed: string | null;
}

export interface PurchaseOrder {
  id: string;
  number: string | null;
  status: string;
  contact_id: string;
  contact_name: string;
  order_date: string;
  expected_date: string;
  currency: string;
  /** Decimal string; display with `rateForDisplay` only. */
  fx_rate: string;
  reference: string;
  memo: string;
  subtotal_fc: number;
  tax_total_fc: number;
  total_fc: number;
  /** Base currency. */
  subtotal: number;
  tax_total: number;
  total: number;
  baseCurrency: string;
  revision: number;
  created_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  closed_at: string | null;
  version: number;
  lines: OrderLine[];
  open_revision_id: string | null;
  can: OrderCan;
}

export function toOrderLine(l: ApiOrderLine): OrderLine {
  return {
    id: l.id,
    line_no: l.line_no,
    item_id: l.item_id ?? null,
    account_id: l.account_id,
    description: l.description ?? '',
    quantity: l.quantity,
    unit_price_fc: money(l.unit_price_fc),
    tax_code_id: l.tax_code_id ?? null,
    line_total_fc: money(l.line_total_fc),
    tax_amount_fc: money(l.tax_amount_fc),
    dimensions: l.dimensions ?? {},
    requisition_line_id: l.requisition_line_id ?? null,
    received: l.received ?? null,
    billed: l.billed ?? null,
    open_to_receive: l.open_to_receive ?? null,
    received_not_billed: l.received_not_billed ?? null,
  };
}

export function toOrder(a: ApiOrder): PurchaseOrder {
  return {
    id: a.id,
    number: a.number ?? null,
    status: a.status,
    contact_id: a.contact_id,
    contact_name: a.contact_name ?? '',
    order_date: a.order_date ?? '',
    expected_date: a.expected_date ?? '',
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
    baseCurrency: a.total.currency,
    revision: a.revision,
    created_by: a.created_by ?? null,
    submitted_by: a.submitted_by ?? null,
    approved_by: a.approved_by ?? null,
    approved_at: a.approved_at ?? null,
    cancelled_at: a.cancelled_at ?? null,
    cancel_reason: a.cancel_reason ?? '',
    closed_at: a.closed_at ?? null,
    version: a.version,
    lines: (a.lines ?? []).map(toOrderLine),
    open_revision_id: a.open_revision_id ?? null,
    can: toOrderCan(a.can),
  };
}

/** An order line as the form holds it. `id` is the line the server already has (a PUT keeps it, so received stays attached). */
export interface OrderLineInput {
  id?: string;
  item_id?: string;
  account_id: string;
  description: string;
  quantity: string;
  unit_price_fc: number;
  tax_code_id?: string;
  dimensions?: Record<string, string>;
}
export interface OrderDraftInput {
  contact_id: string;
  order_date: string;
  expected_date: string;
  currency: string;
  /** Only sent when the order is not in the base currency. */
  fx_rate: string;
  reference: string;
  memo: string;
  lines: OrderLineInput[];
}

function orderLines(lines: OrderLineInput[], keepIds: boolean) {
  return lines.map((l) => ({
    ...(keepIds && l.id ? { id: l.id } : {}),
    item_id: l.item_id || null,
    account_id: l.account_id || null,
    description: l.description.trim() || null,
    quantity: l.quantity.trim(),
    unit_price_fc: l.unit_price_fc,
    tax_code_id: l.tax_code_id || null,
    ...dimensionsPart(l.dimensions),
  }));
}

/** Create (`version` undefined) or replace (`version` given: lines keep their `id`). Totals are never sent. */
export function toOrderRequest(input: OrderDraftInput, baseCurrency: string, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contact_id: input.contact_id,
    order_date: input.order_date,
    expected_date: input.expected_date || null,
    currency: input.currency,
    reference: input.reference.trim() || null,
    memo: input.memo.trim() || null,
    lines: orderLines(input.lines, version !== undefined),
  };
  if (input.currency !== baseCurrency && input.fx_rate.trim()) body.fx_rate = input.fx_rate.trim();
  if (version !== undefined) body.version = version;
  return body;
}

export function toOrderInput(o: PurchaseOrder): OrderDraftInput {
  return {
    contact_id: o.contact_id,
    order_date: o.order_date,
    expected_date: o.expected_date,
    currency: o.currency,
    fx_rate: o.fx_rate,
    reference: o.reference,
    memo: o.memo,
    lines: o.lines.map((l) => ({
      id: l.id,
      item_id: l.item_id ?? undefined,
      account_id: l.account_id,
      description: l.description,
      quantity: trimDecimal(l.quantity),
      unit_price_fc: l.unit_price_fc,
      tax_code_id: l.tax_code_id ?? undefined,
      dimensions: l.dimensions,
    })),
  };
}

/** A copy of an order as a new draft dated `today`: no number, no receipts, bills or revisions, no stored exchange rate (the server uses its rate for the day), no line ids. An expected date already past is dropped. */
export function toOrderCopy(o: PurchaseOrder, today: string): OrderDraftInput {
  const input = toOrderInput(o);
  return {
    ...input,
    order_date: today,
    expected_date: input.expected_date >= today ? input.expected_date : '',
    fx_rate: '',
    lines: input.lines.map(({ id: _id, ...l }) => l),
  };
}

/** Text shape only: a quantity such as 1 or 2.5, and above zero. */
export const isPositiveQuantity = (s: string): boolean => isQuantity(s) && /[1-9]/.test(s);

/* ------------------------------------------------------------------------ revisions */

export interface SnapshotLine {
  /** The order line this changes; null for a line the revision adds. */
  id: string | null;
  line_no: number | null;
  item_id: string | null;
  account_id: string | null;
  description: string;
  quantity: string;
  unit_price_fc: number | null;
  tax_code_id: string | null;
  line_total_fc: number | null;
  tax_amount_fc: number | null;
  /** Dimension values by position (1 to 8), null where none. */
  dims: Array<string | null>;
}

/** An order as it was proposed, before a revision, or after it. Totals are in the order's currency. */
export interface OrderSnapshot {
  revision: number | null;
  expected_date: string;
  reference: string;
  memo: string;
  currency: string | null;
  subtotal_fc: number | null;
  tax_total_fc: number | null;
  total_fc: number | null;
  lines: SnapshotLine[];
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const minorOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
const qty = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function toSnapshotLine(raw: unknown): SnapshotLine {
  const l = isRecord(raw) ? raw : {};
  const dims = Array.isArray(l.dims) ? l.dims.map(textOrNull) : [];
  return {
    id: textOrNull(l.id),
    line_no: typeof l.line_no === 'number' ? l.line_no : null,
    item_id: textOrNull(l.item_id),
    account_id: textOrNull(l.account_id),
    description: text(l.description),
    quantity: qty(l.quantity),
    unit_price_fc: minorOrNull(l.unit_price_fc),
    tax_code_id: textOrNull(l.tax_code_id),
    line_total_fc: minorOrNull(l.line_total_fc),
    tax_amount_fc: minorOrNull(l.tax_amount_fc),
    dims,
  };
}

/**
 * `proposed` keeps its totals at the top; `before` and `after` are the order's own content with them under `totals`.
 * Anything that is not there comes back null or empty: a snapshot never throws.
 */
export function toSnapshot(raw: unknown): OrderSnapshot | null {
  if (!isRecord(raw)) return null;
  const totals = isRecord(raw.totals) ? raw.totals : raw;
  return {
    revision: typeof raw.revision === 'number' ? raw.revision : null,
    expected_date: text(raw.expected_date),
    reference: text(raw.reference),
    memo: text(raw.memo),
    currency: textOrNull(raw.currency),
    subtotal_fc: minorOrNull(totals.subtotal_fc),
    tax_total_fc: minorOrNull(totals.tax_total_fc),
    total_fc: minorOrNull(totals.total_fc),
    lines: Array.isArray(raw.lines) ? raw.lines.map(toSnapshotLine) : [],
  };
}

export interface OrderRevision {
  id: string;
  purchase_order_id: string;
  revision_no: number | null;
  status: string;
  reason: string;
  proposed: OrderSnapshot | null;
  before: OrderSnapshot | null;
  after: OrderSnapshot | null;
  /** Base currency. */
  total: number;
  baseCurrency: string;
  created_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  applied_at: string | null;
  version: number;
  can: RevisionCan;
}

export function toRevision(a: ApiRevision): OrderRevision {
  return {
    id: a.id,
    purchase_order_id: a.purchase_order_id,
    revision_no: a.revision_no ?? null,
    status: a.status,
    reason: a.reason,
    proposed: toSnapshot(a.proposed),
    before: toSnapshot(a.before),
    after: toSnapshot(a.after),
    total: money(a.total),
    baseCurrency: a.total.currency,
    created_by: a.created_by ?? null,
    submitted_by: a.submitted_by ?? null,
    approved_by: a.approved_by ?? null,
    applied_at: a.applied_at ?? null,
    version: a.version,
    can: toRevisionCan(a.can),
  };
}

const sameLine = (a: SnapshotLine, b: SnapshotLine): boolean =>
  trimDecimal(a.quantity) === trimDecimal(b.quantity) &&
  a.unit_price_fc === b.unit_price_fc &&
  a.tax_code_id === b.tax_code_id &&
  a.account_id === b.account_id &&
  a.item_id === b.item_id &&
  a.description === b.description;

/** How many lines a revision changed, added or removed: compared by line id, text and whole numbers only. */
export function linesChanged(before: OrderSnapshot | null, after: OrderSnapshot | null): number | null {
  if (!before || !after) return null;
  const was = new Map(before.lines.filter((l) => l.id).map((l) => [l.id as string, l]));
  const now = new Map(after.lines.filter((l) => l.id).map((l) => [l.id as string, l]));
  // A line with no id is one the revision adds.
  let changed = after.lines.filter((l) => !l.id).length;
  for (const [id, line] of now) {
    const prev = was.get(id);
    if (!prev || !sameLine(prev, line)) changed++;
  }
  for (const id of was.keys()) if (!now.has(id)) changed++;
  return changed;
}

/**
 * Positional dimension values (`dims`, position 1 to 8) back to the `{dimension id: value id}` map the request wants,
 * using the company's dimension definitions (each has a `position`). Positions with no definition are dropped.
 */
export function dimsToMap(dims: Array<string | null>, idByPosition: Map<number, string>): Record<string, string> {
  const out: Record<string, string> = {};
  dims.forEach((value, i) => {
    const dim = idByPosition.get(i + 1);
    if (value && dim) out[dim] = value;
  });
  return out;
}

export interface RevisionDraftInput {
  reason: string;
  expected_date: string;
  reference: string;
  memo: string;
  lines: OrderLineInput[];
}

/** Create on the order (`version` is the order's, optional) or replace (`version` is the revision's, required). */
export function toRevisionRequest(input: RevisionDraftInput, version?: number): Record<string, unknown> {
  return {
    reason: input.reason.trim(),
    expected_date: input.expected_date || null,
    reference: input.reference.trim() || null,
    memo: input.memo.trim() || null,
    ...(version === undefined ? {} : { version }),
    lines: orderLines(input.lines, true),
  };
}

/** The proposed lines of an open revision as form lines. */
export function snapshotToLines(s: OrderSnapshot, idByPosition: Map<number, string>): OrderLineInput[] {
  return s.lines.map((l) => ({
    id: l.id ?? undefined,
    item_id: l.item_id ?? undefined,
    account_id: l.account_id ?? '',
    description: l.description,
    quantity: trimDecimal(l.quantity),
    unit_price_fc: l.unit_price_fc ?? 0,
    tax_code_id: l.tax_code_id ?? undefined,
    dimensions: dimsToMap(l.dims, idByPosition),
  }));
}

/* ------------------------------------------------------------------------- receipts */

export interface ReceiptLine {
  id: string;
  line_no: number;
  order_line_id: string;
  quantity: string;
  description: string;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  status: string;
  purchase_order_id: string;
  order_number: string | null;
  contact_name: string;
  receipt_date: string;
  reference: string;
  memo: string;
  reversal_reason: string;
  reversed_by: string | null;
  reversed_at: string | null;
  version: number;
  lines: ReceiptLine[];
  can: ReceiptCan;
}

export function toReceipt(a: ApiReceipt): GoodsReceipt {
  return {
    id: a.id,
    number: a.number,
    status: a.status,
    purchase_order_id: a.purchase_order_id,
    order_number: a.order_number ?? null,
    contact_name: a.contact_name ?? '',
    receipt_date: a.receipt_date ?? '',
    reference: a.reference ?? '',
    memo: a.memo ?? '',
    reversal_reason: a.reversal_reason ?? '',
    reversed_by: a.reversed_by ?? null,
    reversed_at: a.reversed_at ?? null,
    version: a.version,
    lines: (a.lines ?? []).map((l) => ({ id: l.id, line_no: l.line_no, order_line_id: l.order_line_id, quantity: l.quantity, description: l.description ?? '' })),
    can: toReceiptCan(a.can),
  };
}

/** One row of the receipt form: an open order line and what is being received now (blank: skip). */
export interface ReceiptFormLine {
  order_line_id: string;
  quantity: string;
}
export interface ReceiptDraftInput {
  purchase_order_id: string;
  receipt_date: string;
  /** The order version the person was looking at; a stale one is a 409. */
  order_version?: number;
  reference: string;
  memo: string;
  lines: ReceiptFormLine[];
}

/** Blank rows are skipped; a violation's `line_no` is the position among the lines sent, see `sentLines`. */
export const sentLines = (lines: ReceiptFormLine[]): ReceiptFormLine[] => lines.filter((l) => l.quantity.trim() !== '');

export function toReceiptRequest(input: ReceiptDraftInput): Record<string, unknown> {
  return {
    purchase_order_id: input.purchase_order_id,
    receipt_date: input.receipt_date,
    ...(input.order_version === undefined ? {} : { order_version: input.order_version }),
    reference: input.reference.trim() || null,
    memo: input.memo.trim() || null,
    lines: sentLines(input.lines).map((l) => ({ order_line_id: l.order_line_id, quantity: l.quantity.trim() })),
  };
}

/** The order lines still open to receive, with the quantity the form starts from (the server's `open_to_receive`, as text). */
export function openReceiptLines(o: PurchaseOrder): Array<{ line: OrderLine; open: string }> {
  return o.lines
    .filter((l) => l.open_to_receive !== null && /[1-9]/.test(l.open_to_receive))
    .map((line) => ({ line, open: trimDecimal(line.open_to_receive as string) }));
}

/** Header-level body of "create a bill from an order or a receipt". Empty fields are left out. */
export function toBillFromRequest(f: { issue_date?: string; due_date?: string; fx_rate?: string; reference?: string }): Record<string, unknown> {
  return {
    ...(f.issue_date ? { issue_date: f.issue_date } : {}),
    ...(f.due_date ? { due_date: f.due_date } : {}),
    ...(f.fx_rate?.trim() ? { fx_rate: f.fx_rate.trim() } : {}),
    ...(f.reference?.trim() ? { reference: f.reference.trim() } : {}),
  };
}

/* -------------------------------------------------------------------------- reports */

export interface OpenCommitmentRow {
  contact_id: string;
  contact_name: string;
  account_id: string;
  account_code: string;
  account_name: string;
  currency: string;
  open_fc: number;
  open_base: number;
}
export interface AwaitingReceiptRow {
  purchase_order_id: string;
  number: string | null;
  contact_name: string;
  order_date: string;
  expected_date: string;
  order_line_id: string;
  line_no: number;
  description: string;
  ordered: string;
  received: string;
  open: string;
  currency: string;
  open_fc: number;
  open_base: number;
}
export interface ReceivedNotBilledRow {
  purchase_order_id: string;
  number: string | null;
  contact_name: string;
  order_line_id: string;
  line_no: number;
  description: string;
  account_code: string;
  account_name: string;
  received: string;
  billed: string;
  unbilled: string;
  currency: string;
  fx_rate: string;
  unbilled_fc: number;
  unbilled_base: number;
}
export interface ReportTotal {
  total_base: number;
  currency: string;
}

export function toOpenCommitments(a: ApiOpenCommitments): { rows: OpenCommitmentRow[]; total: ReportTotal } {
  return {
    rows: a.data.map((r) => ({
      contact_id: r.contact_id,
      contact_name: r.contact_name,
      account_id: r.account_id,
      account_code: r.account_code,
      account_name: r.account_name,
      currency: r.currency,
      open_fc: money(r.open_fc),
      open_base: money(r.open_base),
    })),
    total: { total_base: money(a.meta.total_base), currency: a.meta.total_base.currency },
  };
}

export function toAwaitingReceipt(a: ApiAwaitingReceipt): { rows: AwaitingReceiptRow[]; total: ReportTotal } {
  return {
    rows: a.data.map((r) => ({
      purchase_order_id: r.purchase_order_id,
      number: r.number ?? null,
      contact_name: r.contact_name,
      order_date: r.order_date,
      expected_date: r.expected_date ?? '',
      order_line_id: r.order_line_id,
      line_no: r.line_no,
      description: r.description ?? '',
      ordered: r.ordered,
      received: r.received,
      open: r.open,
      currency: r.currency,
      open_fc: money(r.open_fc),
      open_base: money(r.open_base),
    })),
    total: { total_base: money(a.meta.total_base), currency: a.meta.total_base.currency },
  };
}

export function toReceivedNotBilled(a: ApiReceivedNotBilled): { rows: ReceivedNotBilledRow[]; total: ReportTotal; asOf: string } {
  return {
    rows: a.data.map((r) => ({
      purchase_order_id: r.purchase_order_id,
      number: r.number ?? null,
      contact_name: r.contact_name,
      order_line_id: r.order_line_id,
      line_no: r.line_no,
      description: r.description ?? '',
      account_code: r.account_code,
      account_name: r.account_name,
      received: r.received,
      billed: r.billed,
      unbilled: r.unbilled,
      currency: r.currency,
      fx_rate: r.fx_rate,
      unbilled_fc: money(r.unbilled_fc),
      unbilled_base: money(r.unbilled_base),
    })),
    total: { total_base: money(a.meta.total_base), currency: a.meta.total_base.currency },
    asOf: a.meta.as_of,
  };
}

/* ------------------------------------------------------------------------ bill match */

export interface MatchLine {
  line_no: number;
  purchase_order_id: string;
  order_line_id: string;
  order_number: string | null;
  order_price_fc: number;
  currency: string;
  ordered: string;
  received: string;
  billed_elsewhere: string;
}
export interface BillMatch {
  applies: boolean;
  refusals: Violation[];
  mismatches: Violation[];
  lines: MatchLine[];
  last_result: { outcome: string; reason: string; decided_by: string | null; created_at: string | null } | null;
}

export function toBillMatch(a: ApiBillMatch): BillMatch {
  return {
    applies: a.applies === true,
    refusals: (a.refusals ?? []) as Violation[],
    mismatches: (a.mismatches ?? []) as Violation[],
    lines: (a.lines ?? []).map((l) => ({
      line_no: l.line_no,
      purchase_order_id: l.purchase_order_id,
      order_line_id: l.order_line_id,
      order_number: l.order_number ?? null,
      order_price_fc: money(l.order_price_fc),
      currency: l.order_price_fc.currency,
      ordered: l.ordered,
      received: l.received,
      billed_elsewhere: l.billed_elsewhere,
    })),
    last_result: a.last_result
      ? { outcome: a.last_result.outcome, reason: a.last_result.reason ?? '', decided_by: a.last_result.decided_by ?? null, created_at: a.last_result.created_at ?? null }
      : null,
  };
}

/** The server's outcome word, readable. Unknown outcomes are humanised, not hidden. */
export function matchOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'passed':
    case 'matched':
      return 'Matched the order';
    case 'overridden':
      return 'Passed with an override';
    case 'refused':
      return 'Refused';
    default:
      return humanise(outcome);
  }
}

/** The order number a bill line sits on, from the match answer. */
export const matchLineFor = (m: BillMatch | null | undefined, lineNo: number): MatchLine | undefined => m?.lines.find((l) => l.line_no === lineNo);

/* ------------------------------------------------------------------- submit refusals */

export interface MatchRefusal {
  violations: Violation[];
  /** Every code can be passed with a reason by someone who holds the permission. */
  overridable: boolean;
}

/**
 * A bill submit that the three-way match refused (422 with violations). Null for anything else, including a refusal that
 * is mixed with other kinds of violations (those must be fixed first, an override would not help).
 */
export function matchRefusal(e: unknown): MatchRefusal | null {
  if (!(e instanceof ApiError) || e.status !== 422 || !e.violations?.length) return null;
  if (!e.violations.every((v) => isMatchCode(v.code))) return null;
  return { violations: e.violations, overridable: e.violations.every((v) => MATCH_OVERRIDABLE_CODES.includes(v.code)) };
}

/** Which override refusal came back: no permission, or the person made the bill themselves. */
export const matchOverrideRefusal = (e: unknown): 'match_override_forbidden' | 'match_override_self_forbidden' | null => {
  if (!(e instanceof ApiError)) return null;
  for (const code of ['match_override_self_forbidden', 'match_override_forbidden'] as const) {
    if (e.code === code || e.violations?.some((v) => v.code === code)) return code;
  }
  return null;
};
export const isMatchOverrideForbidden = (e: unknown): boolean => matchOverrideRefusal(e) !== null;
export { MATCH_FIXED_CODES };
