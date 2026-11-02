/**
 * Journals at the API boundary: JournalResource -> the existing `Journal` view type, the form's lines ->
 * JournalRequest, plus the small view types for the posting preview, the approvals inbox and recurring schedules.
 * Pure functions; the server owns every figure and every verdict (13 §10, §16).
 */
import type { components } from '../schema';
import type { Dimension, DocumentStatus, Journal, JournalLine, JournalType } from '@/types';
import { fromApiMoney, rateForDisplay, type ApiMoney } from './money';
import type { Violation } from '../errors';

export type ApiJournal = components['schemas']['JournalResource'];
export type ApiJournalLine = components['schemas']['JournalLineResource'];
export type ApiPostingPreview = components['schemas']['PostingPreviewResource'];
export type ApiDimension = components['schemas']['DimensionResource'];
export type ApiApproval = components['schemas']['ApprovalRequestResource'];
export type ApiRecurringSchedule = components['schemas']['RecurringScheduleResource'];
export type ApiRecurringRun = components['schemas']['RecurringRunResource'];

/* ----------------------------------------------------------------- dimensions */

/** The three slots the line grid knows. Other dimensions are kept on the line untouched (`extraDimensions`). */
export type DimensionSlot = 'branch' | 'cost_centre' | 'project';
const SLOT_ALIASES: Record<string, DimensionSlot> = {
  branch: 'branch',
  cost_centre: 'cost_centre',
  cost_center: 'cost_centre',
  costcentre: 'cost_centre',
  costcenter: 'cost_centre',
  project: 'project',
};
export const slotOf = (code: string): DimensionSlot | undefined => SLOT_ALIASES[code.trim().toLowerCase().replace(/[\s-]+/g, '_')];

/** API dimensions -> the view `Dimension`s, with the slot name as `code` so the chips work unchanged. */
export function toDimensions(list: ApiDimension[], companyId: string): Dimension[] {
  const out: Dimension[] = [];
  for (const d of list) {
    const slot = slotOf(d.code);
    if (!slot || !d.is_active) continue;
    out.push({
      id: d.id,
      company_id: companyId,
      code: slot,
      name: d.name,
      position: d.position,
      is_active: d.is_active,
      values: (d.values ?? []).filter((v) => v.is_active).map((v) => ({ id: v.id, dimension_id: v.dimension_id, code: v.code, name: v.name, is_active: v.is_active })),
    });
  }
  return out;
}

/** Wire `{dimensionId: valueId}` -> `{slot: valueCode}` for the chips; ids that match no slot go to `extra`. */
export function dimensionsFromApi(
  wire: Record<string, string> | undefined,
  all: ApiDimension[],
): { slots: JournalLine['dimensions']; extra: Record<string, string> } {
  const slots: JournalLine['dimensions'] = {};
  const extra: Record<string, string> = {};
  for (const [dimId, valueId] of Object.entries(wire ?? {})) {
    const dim = all.find((d) => d.id === dimId);
    const slot = dim ? slotOf(dim.code) : undefined;
    const value = dim?.values?.find((v) => v.id === valueId);
    if (slot && value) slots[slot] = value.code;
    else extra[dimId] = valueId;
  }
  return { slots, extra };
}

/** `{slot: valueCode}` + preserved extras -> wire `{dimensionId: valueId}`. A code that matches no value is dropped. */
export function dimensionsToApi(
  slots: JournalLine['dimensions'] | undefined,
  extra: Record<string, string> | undefined,
  all: ApiDimension[],
): Record<string, string> {
  const out: Record<string, string> = { ...(extra ?? {}) };
  for (const slot of ['branch', 'cost_centre', 'project'] as const) {
    const code = slots?.[slot];
    if (!code) continue;
    const dim = all.find((d) => slotOf(d.code) === slot);
    const value = dim?.values?.find((v) => v.code === code);
    if (dim && value) out[dim.id] = value.id;
  }
  return out;
}

/* ------------------------------------------------------------------- journals */

export interface JournalCan {
  update: boolean;
  submit: boolean;
  approve: boolean;
  return: boolean;
  void: boolean;
  reverse: boolean;
}

export function toCan(raw: unknown): JournalCan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (k: string) => r[k] === true;
  return { update: b('update'), submit: b('submit'), approve: b('approve'), return: b('return'), void: b('void'), reverse: b('reverse') };
}

/** A line as the form and the paper show it, plus the dimensions the grid cannot show. */
export type LiveJournalLine = JournalLine & { extraDimensions?: Record<string, string> };

export function toJournalLine(l: ApiJournalLine, dims: ApiDimension[], index: number): LiveJournalLine {
  const { slots, extra } = dimensionsFromApi(l.dimensions, dims);
  return {
    id: `line-${l.line_no}-${index}`,
    line_no: l.line_no,
    account_id: l.account_id,
    debit: fromApiMoney(l.debit),
    credit: fromApiMoney(l.credit),
    currency: l.currency,
    fx_rate: rateForDisplay(l.fx_rate),
    amount_fc: fromApiMoney(l.amount_fc),
    dimensions: slots,
    extraDimensions: Object.keys(extra).length ? extra : undefined,
    description: l.description ?? '',
    contact_id: l.contact_id ?? undefined,
    tax_code_id: l.tax_code_id ?? undefined,
    due_date: l.due_date ?? undefined,
  };
}

export function toJournal(a: ApiJournal, scope: { tenantId: string; companyId: string }, dims: ApiDimension[] = []): Journal & { can: JournalCan } {
  return {
    id: a.id,
    tenant_id: scope.tenantId,
    company_id: scope.companyId,
    fiscal_period_id: a.fiscal_period_id ?? '',
    journal_type: a.journal_type as JournalType,
    number: a.number,
    status: a.status as DocumentStatus,
    journal_date: a.journal_date ?? '',
    posted_at: a.posted_at ?? undefined,
    reference: a.reference ?? '',
    memo: a.memo ?? '',
    source_type: a.source_type ?? undefined,
    source_id: a.source_id ?? undefined,
    reversal_of_id: a.reversal_of_id ?? undefined,
    reversed_by_id: a.reversed_by_id ?? undefined,
    total_debit: fromApiMoney(a.total_debit),
    total_credit: fromApiMoney(a.total_credit),
    lines: (a.lines ?? []).map((l, i) => toJournalLine(l, dims, i)),
    created_by: a.created_by ?? '',
    submitted_by: a.submitted_by ?? undefined,
    approved_by: a.approved_by ?? undefined,
    posted_by: a.posted_by ?? undefined,
    version: a.version,
    // The API has no created_at/updated_at on journals yet; the view type wants a string, so leave it empty.
    created_at: '',
    updated_at: '',
    can: toCan(a.can),
  };
}

/** What the form edits. Amounts are integer minor units straight from the money inputs. */
export interface JournalDraftInput {
  journal_date: string;
  fiscal_period_id?: string;
  journal_type?: 'manual' | 'adjustment';
  reference: string;
  memo: string;
  version?: number;
  lines: Array<{
    account_id: string;
    description: string;
    debit?: number;
    credit?: number;
    dimensions: JournalLine['dimensions'];
    extraDimensions?: Record<string, string>;
  }>;
}

/**
 * Form -> JournalRequest. Only the side a line uses is sent; a line with neither side is sent as is, so the
 * server's 422 points at it. Rates and base-currency conversion are the server's business: base-currency lines
 * carry no currency or fx_rate.
 */
export function toJournalRequest(input: JournalDraftInput, dims: ApiDimension[]): Record<string, unknown> {
  // The API refuses `journal_type` on an update (the type is fixed at creation) and `version` on a create.
  const body: Record<string, unknown> = {
    ...(input.version === undefined ? { journal_type: input.journal_type ?? 'manual' } : {}),
    journal_date: input.journal_date,
    reference: input.reference.trim() || null,
    memo: input.memo.trim() || null,
    lines: input.lines.map((l) => {
      const line: Record<string, unknown> = { account_id: l.account_id, description: l.description.trim() || null };
      if (l.debit && l.debit > 0) line.debit = l.debit;
      if (l.credit && l.credit > 0) line.credit = l.credit;
      const wire = dimensionsToApi(l.dimensions, l.extraDimensions, dims);
      if (Object.keys(wire).length) line.dimensions = wire;
      return line;
    }),
  };
  if (input.fiscal_period_id) body.fiscal_period_id = input.fiscal_period_id;
  if (input.version !== undefined) body.version = input.version;
  return body;
}

/** A copy of a journal as a new draft: same lines, a note in the reference, today's date supplied by the caller. */
export function toDuplicateInput(j: Omit<Journal, 'lines'> & { lines: LiveJournalLine[] }, date: string): JournalDraftInput {
  return {
    journal_date: date,
    journal_type: j.journal_type === 'adjustment' ? 'adjustment' : 'manual',
    reference: j.reference ? `${j.reference} (copy)` : '',
    memo: j.memo,
    lines: j.lines.map((l) => ({
      account_id: l.account_id,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      dimensions: l.dimensions,
      extraDimensions: l.extraDimensions,
    })),
  };
}

/* --------------------------------------------------------------------- preview */

export interface PostingPreview {
  valid: boolean;
  violations: Violation[];
  period: { id: string | null; name: string | null; status: string | null } | null;
  totalDebit: number;
  totalCredit: number;
}

export function toPostingPreview(p: ApiPostingPreview): PostingPreview {
  return {
    valid: p.valid,
    violations: (p.violations as Violation[]) ?? [],
    period: p.period,
    totalDebit: fromApiMoney(p.total_debit),
    totalCredit: fromApiMoney(p.total_credit),
  };
}

/** Violations split into per-line (by `line_no`) and header ones, for the form. */
export function splitViolations(violations: Violation[]): { header: Violation[]; byLine: Map<number, Violation[]> } {
  const header: Violation[] = [];
  const byLine = new Map<number, Violation[]>();
  for (const v of violations) {
    if (typeof v.line_no === 'number') byLine.set(v.line_no, [...(byLine.get(v.line_no) ?? []), v]);
    else header.push(v);
  }
  return { header, byLine };
}

/** 422 `errors` keys such as `lines.2.account_id` -> {lineIndex: {field: message}}; everything else is a header error. */
export function splitFieldErrors(errors: Record<string, string[]> | undefined): { header: Array<{ field: string; message: string }>; byIndex: Map<number, Record<string, string>> } {
  const header: Array<{ field: string; message: string }> = [];
  const byIndex = new Map<number, Record<string, string>>();
  for (const [key, msgs] of Object.entries(errors ?? {})) {
    const m = /^lines\.(\d+)\.(.+)$/.exec(key);
    const message = msgs[0] ?? '';
    if (m) {
      const i = Number(m[1]);
      byIndex.set(i, { ...(byIndex.get(i) ?? {}), [m[2]]: message });
    } else header.push({ field: key, message });
  }
  return { header, byIndex };
}

/* ------------------------------------------------------------------- approvals */

export type ApprovalDocType = 'manual_journal' | 'sales_invoice' | 'purchase_bill' | 'settlement' | 'payment_run' | 'other';

export interface ApprovalItem {
  id: string;
  document_type: ApprovalDocType;
  /** The API's own type, as `bulk-approve` wants it. */
  api_type: 'journal' | 'invoice' | 'bill' | 'settlement' | 'payment_run';
  document_id: string;
  document_number: string;
  title: string;
  amount: number;
  currency: string;
  maker_id: string;
  maker_name: string | null;
  submitted_at: string;
  role: string;
  step: number;
  /** The document's lock version, for `return`. */
  version: number;
}

type ApprovalDoc = Record<string, unknown> & { amount?: ApiMoney; number?: string | null; memo?: string | null; kind?: string; created_by?: string | null; submitted_by?: string | null; version?: number };

export function toApprovalItem(a: ApiApproval): ApprovalItem {
  const doc = a.document as ApprovalDoc;
  const t = a.document_type;
  const kind = typeof doc.kind === 'string' ? doc.kind : '';
  let document_type: ApprovalDocType = 'other';
  let api_type: ApprovalItem['api_type'] = 'journal';
  let title = '';
  if (t === 'journal') {
    document_type = 'manual_journal';
    api_type = 'journal';
    title = `Journal: ${doc.memo || doc.reference || 'no note'}`;
  } else if (t === 'invoice' || t === 'bill') {
    const purchase = t === 'bill' || kind === 'purchase_bill' || kind === 'debit_note';
    document_type = purchase ? 'purchase_bill' : 'sales_invoice';
    api_type = purchase ? 'bill' : 'invoice';
    title = `${purchase ? 'Supplier bill' : 'Sales invoice'}${doc.memo ? `: ${String(doc.memo)}` : ''}`;
  } else if (t === 'settlement') {
    document_type = 'settlement';
    api_type = 'settlement';
    title = `${kind === 'payment' ? 'Payment' : kind === 'receipt' ? 'Receipt' : 'Settlement'}${doc.memo ? `: ${String(doc.memo)}` : ''}`;
  } else if (t === 'payment_run') {
    document_type = 'payment_run';
    api_type = 'payment_run';
    title = `Payment run${doc.memo ? `: ${String(doc.memo)}` : ''}`;
  } else {
    title = String(t);
  }
  const money = doc.amount ?? { amount: 0, currency: '' };
  return {
    id: a.id,
    document_type,
    api_type,
    document_id: a.document_id,
    /** Empty until the document is posted; screens show no number rather than a made-up one. */
    document_number: typeof doc.number === 'string' && doc.number ? doc.number : '',
    title,
    amount: fromApiMoney(money),
    currency: money.currency,
    maker_id: a.requested_by ?? doc.submitted_by ?? doc.created_by ?? '',
    maker_name: a.requested_by_name ?? null,
    submitted_at: a.requested_at ?? '',
    role: a.role,
    step: a.step,
    version: typeof doc.version === 'number' ? doc.version : 0,
  };
}

export interface BulkResultRow {
  id: string;
  type: string;
  ok: boolean;
  code: string | null;
  reason: string | null;
  number: string | null;
  status: string | null;
}

/** One entry of `bulk-approve`'s `data`: approved (status, number) or skipped (code, reason). Unknown fields are ignored. */
export function toBulkResult(raw: unknown): BulkResultRow {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (k: string): string | null => (typeof r[k] === 'string' && r[k] !== '' ? (r[k] as string) : null);
  return {
    id: s('id') ?? '',
    type: s('type') ?? '',
    ok: r.ok === true,
    code: s('code'),
    reason: s('reason') ?? s('message'),
    number: s('number'),
    status: s('status'),
  };
}

/* ------------------------------------------------------------------- recurring */

export interface RecurringJournal {
  id: string;
  name: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  template_id: string | null;
  next_date: string | null;
  end_date: string | null;
  owner_id: string;
  is_active: boolean;
  last_run_on: string | null;
  last_error: string | null;
  generated_count: number;
  version: number;
  can: { pause: boolean; resume: boolean; update: boolean };
}

export function toRecurringJournal(s: ApiRecurringSchedule): RecurringJournal {
  const can = (s.can && typeof s.can === 'object' ? s.can : {}) as Record<string, unknown>;
  return {
    id: s.id,
    name: s.name,
    frequency: s.frequency,
    template_id: s.template_id,
    next_date: s.next_date,
    end_date: s.end_date,
    owner_id: s.owner_id,
    is_active: s.is_active,
    last_run_on: s.last_run_on,
    last_error: s.last_error,
    generated_count: s.generated_count,
    version: s.version,
    can: { pause: can.pause === true, resume: can.resume === true, update: can.update === true },
  };
}
