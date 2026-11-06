/**
 * Settings and organisation screens (step 3.9): posting-account copy, workflow forms and their request bodies,
 * ability and event groups, audit rows. Pure functions; money is integer minor units and never goes through a float.
 */
import { formatMoney, getCurrencyMinorUnits } from '@/lib/format';
import type { ApiSettings, ApiWorkflow, ApiAuditEvent, WorkflowBody } from '../live/admin';
import { parseAmountInput } from './banking';

/* ------------------------------------------------------------------ posting accounts */

export interface PostingMeta {
  label: string;
  help: string;
  /** The control type the server requires (null: any active, postable account). The server decides; this only narrows the list. */
  needs: string | null;
}

/** Plain explanations per key. A key the server adds later still shows, with its name as the label. */
export const POSTING_META: Record<string, PostingMeta> = {
  ar_control: { label: 'Money customers owe you', help: 'Where invoices are recorded until the customer pays. Needs an account marked as receivables control.', needs: 'ar' },
  ap_control: { label: 'Money you owe suppliers', help: 'Where bills are recorded until you pay them. Needs an account marked as payables control.', needs: 'ap' },
  tax_output: { label: 'Sales tax collected', help: 'Tax charged on sales that you owe to the tax authority. Needs a tax control account.', needs: 'tax' },
  tax_input: { label: 'Purchase tax paid', help: 'Tax paid on purchases that you can claim back. Needs a tax control account.', needs: 'tax' },
  wht_payable: { label: 'Tax withheld from suppliers', help: 'Tax you hold back from supplier payments and owe to the tax authority. Needs a tax control account.', needs: 'tax' },
  retained_earnings: { label: 'Retained earnings', help: 'Where the year’s profit moves when you close the financial year. Needs a retained earnings account.', needs: 'retained_earnings' },
  fx_realised: { label: 'Exchange gain', help: 'Gain booked when a foreign-currency invoice or bill is settled at a better rate than it was booked at.', needs: null },
  fx_realised_loss: { label: 'Exchange loss', help: 'Loss booked when a foreign-currency invoice or bill is settled at a worse rate than it was booked at.', needs: null },
  fx_unrealised: { label: 'Unrealised exchange gain', help: 'Gain booked when open foreign-currency balances are revalued at period end.', needs: null },
  fx_unrealised_loss: { label: 'Unrealised exchange loss', help: 'Loss booked when open foreign-currency balances are revalued at period end.', needs: null },
  rounding: { label: 'Rounding differences', help: 'Catches the last cent when a conversion or a tax calculation does not divide evenly.', needs: null },
  suspense: { label: 'Suspense', help: 'Holds amounts that have not been sorted out yet, such as a bank line you cannot identify.', needs: null },
  asset_disposal_gain: { label: 'Gain on selling an asset', help: 'Where the profit goes when an asset is sold for more than its value in the books. Optional until you sell an asset.', needs: null },
  asset_disposal_loss: { label: 'Loss on selling an asset', help: 'Where the loss goes when an asset is sold or scrapped for less than its value in the books. Optional until you sell an asset.', needs: null },
  impairment_loss: { label: 'Asset write-down expense', help: 'Where the cost goes when an asset is written down because it is worth less than the books say. Optional until you write an asset down.', needs: null },
  impairment_reversal: { label: 'Asset write-down reversed', help: 'Where the credit goes when an earlier write-down is put back. Optional until you reverse a write-down.', needs: null },
  revaluation_reserve: { label: 'Revaluation reserve', help: 'Equity account that holds increases when a category of assets is revalued upwards. Optional until you revalue assets.', needs: null },
  bank_clearing: { label: 'Bank clearing', help: 'Sits between a payment run and the bank statement while payments are on their way.', needs: null },
};

export interface PostingRow {
  key: string;
  label: string;
  help: string;
  needs: string | null;
  accountId: string | null;
  accountLabel: string | null;
}

export const humanKey = (key: string) => {
  const t = key.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function toPostingRows(settings: Pick<ApiSettings, 'posting_accounts'>): PostingRow[] {
  return Object.entries(settings.posting_accounts).map(([key, account]) => {
    const meta = POSTING_META[key];
    return {
      key,
      label: meta?.label ?? humanKey(key),
      help: meta?.help ?? 'An account the books post to automatically.',
      needs: meta?.needs ?? null,
      accountId: account?.account_id ?? null,
      accountLabel: account ? `${account.code} ${account.name}` : null,
    };
  });
}

export const unsetPostingKeys = (rows: PostingRow[]): PostingRow[] => rows.filter((r) => r.accountId === null);

interface PickableAccount {
  id: string;
  code: string;
  name: string;
  control_type: string;
  is_active: boolean;
  is_postable: boolean;
}

/** Accounts offered for a key: active and postable, and of the control type the key needs. */
export function eligibleAccounts<T extends PickableAccount>(accounts: T[], row: Pick<PostingRow, 'needs'>): T[] {
  return accounts.filter((a) => a.is_active && a.is_postable && (row.needs === null || a.control_type === row.needs));
}

/** Only the keys whose account changed, as the partial update wants them (null clears a key). */
export function postingPatch(rows: PostingRow[], chosen: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const r of rows) {
    const next = chosen[r.key];
    if (next === undefined) continue;
    const value = next === '' ? null : next;
    if (value !== r.accountId) out[r.key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ company profile */

export interface ProfileForm {
  name: string;
  legal_name: string;
  tax_id: string;
  timezone: string;
  locale: string;
  tax_rounding: string;
}

export const toProfileForm = (s: ApiSettings): ProfileForm => ({
  name: s.name,
  legal_name: s.legal_name ?? '',
  tax_id: s.tax_id ?? '',
  timezone: s.timezone,
  locale: s.locale,
  tax_rounding: s.tax_rounding,
});

/** Only what differs from the saved settings; blank optional text clears the field. */
export function profilePatch(saved: ProfileForm, next: ProfileForm) {
  const patch: Record<string, string | null> = {};
  if (next.name.trim() !== saved.name) patch.name = next.name.trim();
  if (next.legal_name.trim() !== saved.legal_name) patch.legal_name = next.legal_name.trim() || null;
  if (next.tax_id.trim() !== saved.tax_id) patch.tax_id = next.tax_id.trim() || null;
  if (next.timezone.trim() !== saved.timezone) patch.timezone = next.timezone.trim();
  if (next.locale.trim() !== saved.locale) patch.locale = next.locale.trim();
  if (next.tax_rounding !== saved.tax_rounding) patch.tax_rounding = next.tax_rounding;
  return patch;
}

/* ------------------------------------------------------------------ purchasing */

export interface PurchasingForm {
  require_purchase_order: boolean;
  /** Percentages as typed text ("5", "2.5"): the server holds them as decimal strings and so do we. */
  po_price_tolerance_pct: string;
  po_quantity_tolerance_pct: string;
  receipt_over_tolerance_pct: string;
}

export const PURCHASING_PCT_FIELDS = ['po_price_tolerance_pct', 'po_quantity_tolerance_pct', 'receipt_over_tolerance_pct'] as const;
export type PurchasingPctField = (typeof PURCHASING_PCT_FIELDS)[number];

/** "5.0000" -> "5", "2.5000" -> "2.5": text only, no arithmetic. */
function tidyPct(s: string): string {
  if (!s.includes('.')) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '' ? '0' : t;
}

export const toPurchasingForm = (s: ApiSettings): PurchasingForm => ({
  require_purchase_order: s.require_purchase_order === true,
  po_price_tolerance_pct: tidyPct(s.po_price_tolerance_pct ?? '0'),
  po_quantity_tolerance_pct: tidyPct(s.po_quantity_tolerance_pct ?? '0'),
  receipt_over_tolerance_pct: tidyPct(s.receipt_over_tolerance_pct ?? '0'),
});

/** 0 to 100 with up to four decimals, as the server accepts it. */
export const isPercent = (s: string): boolean => /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/.test(s.trim());

/** Only what differs from the saved settings. */
export type PurchasingPatch = { require_purchase_order?: boolean } & Partial<Record<PurchasingPctField, string>>;
export function purchasingPatch(saved: PurchasingForm, next: PurchasingForm): PurchasingPatch {
  const patch: PurchasingPatch = {};
  if (next.require_purchase_order !== saved.require_purchase_order) patch.require_purchase_order = next.require_purchase_order;
  for (const k of PURCHASING_PCT_FIELDS) if (next[k].trim() !== saved[k]) patch[k] = next[k].trim();
  return patch;
}

/** Field errors the browser can see before asking: a percentage must be 0 to 100. */
export function purchasingErrors(f: PurchasingForm): Partial<Record<PurchasingPctField, string>> {
  const out: Partial<Record<PurchasingPctField, string>> = {};
  for (const k of PURCHASING_PCT_FIELDS) if (!isPercent(f[k])) out[k] = 'Enter a percentage from 0 to 100, such as 5 or 2.5.';
  return out;
}

export const TAX_ROUNDING_LABEL: Record<string, string> = {
  document_per_code: 'Once per tax code on each document',
  line: 'On every line',
};

/* ------------------------------------------------------------------ amounts as text */

/** Minor units -> editable text ("1500.00"), by digit handling only. */
export function minorToInput(minor: number, digits: number): string {
  const negative = minor < 0;
  const s = String(Math.abs(minor)).padStart(digits + 1, '0');
  const body = digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`;
  return negative ? `-${body}` : body;
}

export const currencyDigits = (currency: string): number => getCurrencyMinorUnits(currency);

/* ------------------------------------------------------------------ approval workflows */

export const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: 'journal', label: 'Manual journals' },
  { value: 'invoice', label: 'Sales invoices' },
  { value: 'bill', label: 'Supplier bills' },
  { value: 'settlement', label: 'Receipts and payments' },
  { value: 'payment_run', label: 'Payment runs' },
  { value: 'purchase_requisition', label: 'Purchase requisitions' },
  { value: 'purchase_order', label: 'Purchase orders' },
  { value: 'depreciation_run', label: 'Depreciation runs' },
  { value: 'asset_transaction', label: 'Asset sales, write-downs and revaluations' },
];
/**
 * A revision of an order follows the order's workflow on its new total, so there is no workflow of its own to set up;
 * it only needs a name where one is listed.
 */
const EXTRA_LABELS: Record<string, string> = { purchase_order_revision: 'Purchase order revisions' };
export const documentTypeLabel = (t: string) => DOCUMENT_TYPES.find((d) => d.value === t)?.label ?? EXTRA_LABELS[t] ?? t;

export const SOURCES: { value: string; label: string }[] = [
  { value: 'any', label: 'Anyone or any integration' },
  { value: 'user', label: 'People only' },
  { value: 'api', label: 'Integrations only' },
];
export const sourceLabel = (s: string) => SOURCES.find((x) => x.value === s)?.label ?? s;

export interface WorkflowForm {
  name: string;
  document_type: string;
  source: string;
  /** Amount texts in the company currency, e.g. "1,000.00". */
  min: string;
  max: string;
  steps: { role: string; count: string }[];
  /** Hours before the current step's approvers are reminded; empty: no reminders. */
  remind: string;
}

export const blankWorkflow = (): WorkflowForm => ({ name: '', document_type: 'journal', source: 'any', min: '0', max: '', steps: [{ role: '', count: '1' }], remind: '' });

export function toWorkflowForm(w: ApiWorkflow, digits: number): WorkflowForm {
  return {
    name: w.name,
    document_type: w.document_type,
    source: w.source,
    min: minorToInput(w.min_amount.amount, digits),
    max: w.max_amount && w.max_amount.amount !== null ? minorToInput(w.max_amount.amount, digits) : '',
    steps: (w.steps as { role: string; count?: number }[]).map((s) => ({ role: s.role, count: String(s.count ?? 1) })),
    remind: w.remind_after_hours == null ? '' : String(w.remind_after_hours),
  };
}

export type WorkflowResult = { ok: true; body: WorkflowBody } | { ok: false; errors: Record<string, string> };

/** Form -> request. Amounts are parsed from text to integer minor units; problems come back per field. */
export function toWorkflowRequest(f: WorkflowForm, digits: number, version?: number): WorkflowResult {
  const errors: Record<string, string> = {};
  if (!f.name.trim()) errors.name = 'Give the workflow a name.';
  const min = parseAmountInput(f.min, digits);
  const max = parseAmountInput(f.max, digits);
  let minor = 0;
  if (!min.ok || (min.ok && min.minor !== null && min.minor < 0)) errors.min = 'Enter a plain amount, not below zero.';
  else minor = min.minor ?? 0;
  let maxMinor: number | null = null;
  if (!max.ok || (max.ok && max.minor !== null && max.minor < 0)) errors.max = 'Enter a plain amount, or leave it empty.';
  else maxMinor = max.minor;
  if (!errors.min && !errors.max && maxMinor !== null && maxMinor <= minor) errors.max = 'The upper limit must be above the lower one.';
  if (f.steps.length === 0) errors.steps = 'Add at least one step.';
  const steps: { role: string; count: number }[] = [];
  f.steps.forEach((s, i) => {
    const count = /^\d+$/.test(s.count) ? Number(s.count) : 0;
    if (!s.role) errors[`step${i}`] = 'Choose a role.';
    else if (count < 1 || count > 10) errors[`step${i}`] = 'Between 1 and 10 approvers.';
    else steps.push({ role: s.role, count });
  });
  const remind = f.remind.trim();
  if (remind !== '' && !(/^\d+$/.test(remind) && Number(remind) >= 1 && Number(remind) <= 720)) errors.remind = 'Enter a whole number of hours from 1 to 720, or leave it empty.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const body: WorkflowBody = {
    document_type: f.document_type as WorkflowBody['document_type'],
    name: f.name.trim(),
    source: f.source as WorkflowBody['source'],
    min_amount: minor,
    max_amount: maxMinor,
    steps,
    remind_after_hours: remind === '' ? null : Number(remind),
    ...(version === undefined ? {} : { version }),
  };
  return { ok: true, body };
}

/** The range in words. The lower limit counts, the upper one does not (the server matches `min <= amount < max`). */
export function describeRange(w: Pick<ApiWorkflow, 'min_amount' | 'max_amount'>, currency: string): string {
  const min = w.min_amount.amount;
  const max = w.max_amount?.amount ?? null;
  if (max === null) return min === 0 ? 'Any amount' : `${formatMoney(min, currency)} and above`;
  return `${formatMoney(min, currency)} up to ${formatMoney(max, currency)}`;
}

export function describeSteps(w: Pick<ApiWorkflow, 'steps'>): string {
  return (w.steps as { role: string; count?: number }[]).map((s) => ((s.count ?? 1) > 1 ? `${s.count} × ${s.role}` : s.role)).join(', then ');
}

/* ------------------------------------------------------------------ API client abilities */

const RESOURCE_LABEL: Record<string, string> = {
  accounts: 'Chart of accounts', attachments: 'Attachments', banking: 'Banking', bills: 'Supplier bills', contacts: 'Customers and suppliers',
  dimensions: 'Dimensions', fx: 'Exchange rates', invoices: 'Sales invoices', items: 'Products and services', journals: 'Journals',
  periods: 'Fiscal periods', recurring: 'Recurring documents', reports: 'Reports', settlements: 'Receipts and payments', tax: 'Tax codes',
};
const VERB_LABEL: Record<string, string> = { read: 'Read', write: 'Create and edit drafts', submit: 'Submit for posting' };

export interface AbilityGroup {
  resource: string;
  label: string;
  abilities: { value: string; label: string }[];
}

/** Groups `resource:verb` abilities by resource, in the order given. */
export function groupAbilities(all: readonly string[]): AbilityGroup[] {
  const groups = new Map<string, AbilityGroup>();
  for (const a of all) {
    const [resource = a, verb = ''] = a.split(':');
    const g = groups.get(resource) ?? { resource, label: RESOURCE_LABEL[resource] ?? humanKey(resource), abilities: [] };
    g.abilities.push({ value: a, label: VERB_LABEL[verb] ?? humanKey(verb) });
    groups.set(resource, g);
  }
  return [...groups.values()];
}

/** The ability names the OpenAPI request allows (kept in one place so the form and its test agree). */
export const API_ABILITIES = [
  'accounts:read', 'accounts:write', 'attachments:read', 'attachments:write', 'banking:read', 'banking:write', 'bills:read', 'bills:write', 'bills:submit',
  'contacts:read', 'contacts:write', 'dimensions:read', 'dimensions:write', 'fx:read', 'fx:write', 'invoices:read', 'invoices:write', 'invoices:submit',
  'items:read', 'items:write', 'journals:read', 'journals:write', 'journals:submit', 'periods:read', 'recurring:read', 'recurring:write', 'reports:read',
  'settlements:read', 'settlements:write', 'settlements:submit', 'tax:read',
] as const;

/* ------------------------------------------------------------------ webhook events */

const EVENT_GROUP: Record<string, string> = {
  journal: 'Journals', invoice: 'Invoices', bill: 'Bills', settlement: 'Receipts and payments', payment_run: 'Payment runs',
  credit_application: 'Credit notes', document: 'Approvals', period: 'Periods', fiscal_year: 'Financial years', bank_statement: 'Banking',
  bank_match: 'Banking', bank_transaction: 'Banking', bank_reconciliation: 'Banking', recurring: 'Recurring', import: 'Imports',
};

export const WEBHOOK_EVENTS = [
  'journal.posted', 'journal.reversed', 'invoice.posted', 'invoice.reversed', 'bill.posted', 'bill.reversed', 'settlement.posted', 'settlement.reversed',
  'payment_run.posted', 'credit_application.created', 'credit_application.reversed', 'document.submitted', 'document.approved', 'document.returned',
  'document.voided', 'period.soft_closed', 'period.closed', 'period.reopened', 'fiscal_year.closed', 'fiscal_year.locked', 'bank_statement.imported',
  'bank_match.created', 'bank_match.removed', 'bank_transaction.created', 'bank_reconciliation.finished', 'bank_reconciliation.reopened',
  'recurring.occurrence_created', 'import.created', 'import.applied', 'import.failed',
] as const;

export function groupEvents(all: readonly string[]): { group: string; events: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const e of all) {
    const g = EVENT_GROUP[e.split('.')[0] ?? ''] ?? 'Other';
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  return [...groups.entries()].map(([group, events]) => ({ group, events }));
}

export const eventLabel = (e: string) => (e === '*' ? 'Every event' : humanKey(e.replace(/\./g, ' ')));

export const DELIVERY_STATUS_LABEL: Record<string, string> = { pending: 'Waiting', delivered: 'Delivered', failed: 'Failed', cancelled: 'Cancelled' };

/* ------------------------------------------------------------------ audit log */

export interface AuditRow {
  id: number;
  at: string | null;
  actorType: string;
  actorId: string | null;
  /** The person's name; null for system and API-client events. */
  actorName: string | null;
  action: string;
  actionText: string;
  subject: string;
  requestId: string | null;
  ip: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  hash: string;
  prevHash: string | null;
}

export const actionText = (action: string): string => humanKey(action.replace(/[._]/g, ' ').trim());

/** Who did it: the person's name, or the actor kind with a short id when there is no name (system, API client). */
export const actorLabel = (r: Pick<AuditRow, 'actorType' | 'actorId' | 'actorName'>): string => r.actorName ?? `${r.actorType}${r.actorId ? ` ${r.actorId.slice(0, 8)}` : ''}`;

export function toAuditRow(e: ApiAuditEvent): AuditRow {
  const subject = e.subject_type ? `${humanKey(e.subject_type)}${e.subject_id ? ` ${e.subject_id.slice(0, 8)}` : ''}` : '';
  return {
    id: e.id, at: e.occurred_at, actorType: e.actor_type, actorId: e.actor_id, actorName: e.actor_name ?? null, action: e.action, actionText: actionText(e.action), subject,
    requestId: e.request_id, ip: e.ip, before: e.before, after: e.after, context: e.context, hash: e.hash, prevHash: e.prev_hash,
  };
}

/** Drops blank filter fields so they are not sent. */
export function cleanFilters<T extends Record<string, string | undefined>>(f: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(f)) if (v && v.trim()) (out as Record<string, string>)[k] = v.trim();
  return out;
}

/** What the server called a verify failure (`problem`), then its `detail`, as given. */
export const verifyLines = (r: { problem: string | null; detail: string | null }): string[] => [r.problem, r.detail].filter((x): x is string => Boolean(x));

/** A date picked in the form -> the UTC timestamp the server wants, at the end of that day. Blank means no expiry. */
export const expiryToApi = (date: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59Z` : null);
