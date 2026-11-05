/**
 * Fixed assets (step 3c.16): API resources -> the shapes the live screen uses, and form drafts -> request bodies.
 * Money is integer minor units both ways. Rates are basis points a year (2000 = 20%) on the wire and percent text in
 * the form, converted with integer maths only (never a float).
 */
import type { components } from '../schema';
import { fromApiMoney, fromApiMoneyOrNull, type ApiMoney } from './money';

export type ApiAssetCategory = components['schemas']['AssetCategoryResource'];
export type ApiFixedAsset = components['schemas']['FixedAssetResource'];
export type ApiDepreciationRun = components['schemas']['DepreciationRunResource'];
export type ApiAssetTransaction = components['schemas']['AssetTransactionResource'];
export type ApiAssetTaxClass = components['schemas']['AssetTaxClassResource'];

export type DepreciationMethod = 'straight_line' | 'declining_balance' | 'units_of_production';
export type MeasurementModel = 'cost' | 'revaluation';
export type DocStatus = 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'void';
export type AssetTxKind = 'disposal' | 'impairment' | 'impairment_reversal' | 'revaluation';

/* ------------------------------------------------------------------ rates: percent <-> basis points */

/**
 * "20" -> 2000, "12.5" -> 1250, "12.55" -> 1255. Returns null for blank, and NaN-free failure as `undefined` for text
 * that is not a percent with at most two decimals. Integer maths only.
 */
export function percentToBp(text: string): number | null | undefined {
  const s = text.trim().replace(/%$/, '').trim();
  if (s === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return undefined;
  const [whole, frac = ''] = s.split('.');
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(bp) ? bp : undefined;
}

/** 2000 -> "20", 1250 -> "12.5", 1255 -> "12.55", null -> "". */
export function bpToPercent(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '';
  const whole = Math.trunc(bp / 100);
  const frac = String(Math.abs(bp % 100)).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** For display: "20%" or "12.5%". */
export const bpLabel = (bp: number | null | undefined): string => (bp === null || bp === undefined ? '' : `${bpToPercent(bp)}%`);

/* ------------------------------------------------------------------ labels */

export const METHOD_LABEL: Record<string, string> = {
  straight_line: 'Same amount every month',
  declining_balance: 'Larger at first, then smaller',
  units_of_production: 'By how much it is used',
};
export const METHOD_SHORT: Record<string, string> = { straight_line: 'Straight line', declining_balance: 'Declining balance', units_of_production: 'Units of use' };
export const MODEL_LABEL: Record<string, string> = { cost: 'At cost', revaluation: 'Revalued' };

export const ASSET_STATUS_LABEL: Record<string, string> = {
  active: 'In use',
  fully_depreciated: 'Fully written down',
  disposed: 'Sold or scrapped',
};

export const TX_KIND_LABEL: Record<string, string> = {
  disposal: 'Sale or scrapping',
  impairment: 'Write-down (impairment)',
  impairment_reversal: 'Write-down reversed',
  revaluation: 'Revaluation',
};

export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  posted: 'Posted',
  reversed: 'Reversed',
  void: 'Cancelled',
};

export const EVENT_LABEL: Record<string, string> = {
  addition: 'Added to the register',
  opening: 'Opening balance',
  depreciation: 'Depreciation',
  disposal: 'Sale or scrapping',
  impairment: 'Write-down',
  impairment_reversal: 'Write-down reversed',
  revaluation: 'Revaluation',
};
export const eventLabel = (kind: string): string => EVENT_LABEL[kind] ?? kind.replace(/_/g, ' ');

export const BLOCKER_TEXT: Record<string, string> = {
  period_closed: 'This month is closed, so depreciation cannot be recorded in it.',
  depreciation_run_exists: 'This month already has a depreciation run.',
  earlier_run_pending: 'An earlier month still needs its depreciation run first.',
  units_required: 'Enter the units used this month for the assets listed under "Units needed".',
  nothing_to_depreciate: 'There is nothing to depreciate for this month.',
};
export const blockerText = (code: string): string => BLOCKER_TEXT[code] ?? code.replace(/_/g, ' ');

/* ------------------------------------------------------------------ categories */

export interface AssetCategory {
  id: string;
  name: string;
  asset_account_id: string;
  accumulated_account_id: string;
  expense_account_id: string;
  measurement_model: MeasurementModel;
  default_method: DepreciationMethod;
  default_life_months: number | null;
  default_declining_rate_bp: number | null;
  is_depreciable: boolean;
  is_active: boolean;
  version: number;
  can: { update: boolean };
}

export const asMethod = (m: string): DepreciationMethod => (m === 'declining_balance' || m === 'units_of_production' ? m : 'straight_line');

export function toCategory(c: ApiAssetCategory): AssetCategory {
  return {
    id: c.id,
    name: c.name,
    asset_account_id: c.asset_account_id,
    accumulated_account_id: c.accumulated_account_id,
    expense_account_id: c.expense_account_id,
    measurement_model: c.measurement_model === 'revaluation' ? 'revaluation' : 'cost',
    default_method: asMethod(c.default_method),
    default_life_months: c.default_life_months,
    default_declining_rate_bp: c.default_declining_rate_bp,
    is_depreciable: c.is_depreciable,
    is_active: c.is_active,
    version: c.version,
    can: { update: c.can.update === true },
  };
}

export interface CategoryDraft {
  name: string;
  asset_account_id: string;
  accumulated_account_id: string;
  expense_account_id: string;
  measurement_model: MeasurementModel;
  default_method: DepreciationMethod;
  life_months: string;
  rate_percent: string;
  is_depreciable: boolean;
  is_active: boolean;
}

export const emptyCategoryDraft = (): CategoryDraft => ({
  name: '', asset_account_id: '', accumulated_account_id: '', expense_account_id: '', measurement_model: 'cost',
  default_method: 'straight_line', life_months: '60', rate_percent: '', is_depreciable: true, is_active: true,
});

export const categoryToDraft = (c: AssetCategory): CategoryDraft => ({
  name: c.name, asset_account_id: c.asset_account_id, accumulated_account_id: c.accumulated_account_id, expense_account_id: c.expense_account_id,
  measurement_model: c.measurement_model, default_method: c.default_method, life_months: c.default_life_months === null ? '' : String(c.default_life_months),
  rate_percent: bpToPercent(c.default_declining_rate_bp), is_depreciable: c.is_depreciable, is_active: c.is_active,
});

/** Whole months as an integer, or null for blank. `undefined` for anything else. */
export function parseWholeNumber(text: string): number | null | undefined {
  const s = text.trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : undefined;
}

export type Built<T> = { ok: true; body: T } | { ok: false; error: string };

export function toCategoryRequest(d: CategoryDraft, version?: number): Built<Record<string, unknown>> {
  if (!d.name.trim()) return { ok: false, error: 'Give the category a name.' };
  if (!d.asset_account_id || !d.accumulated_account_id || !d.expense_account_id) return { ok: false, error: 'Choose all three accounts.' };
  const life = parseWholeNumber(d.life_months);
  if (life === undefined || (life !== null && (life < 1 || life > 1200))) return { ok: false, error: 'Useful life must be a whole number of months, from 1 to 1200.' };
  const bp = percentToBp(d.rate_percent);
  if (bp === undefined || (bp !== null && (bp < 1 || bp > 10000))) return { ok: false, error: 'The yearly rate must be a percent between 0.01 and 100, with at most two decimals.' };
  if (d.is_depreciable && d.default_method === 'declining_balance' && bp === null) return { ok: false, error: 'Enter the yearly rate for declining balance.' };
  if (d.is_depreciable && d.default_method === 'straight_line' && life === null) return { ok: false, error: 'Enter the useful life in months.' };
  return {
    ok: true,
    body: {
      name: d.name.trim(),
      asset_account_id: d.asset_account_id,
      accumulated_account_id: d.accumulated_account_id,
      expense_account_id: d.expense_account_id,
      measurement_model: d.measurement_model,
      default_method: d.default_method,
      default_life_months: life,
      default_declining_rate_bp: d.default_method === 'declining_balance' ? bp : null,
      is_depreciable: d.is_depreciable,
      is_active: d.is_active,
      ...(version === undefined ? {} : { version }),
    },
  };
}

/* ------------------------------------------------------------------ tax classes */

export interface AssetTaxClass {
  id: string;
  code: string;
  name: string;
  annual_rate_bp: number;
  first_year_rate_bp: number | null;
  is_active: boolean;
  version: number;
  can: { update: boolean };
}

export const toTaxClass = (t: ApiAssetTaxClass): AssetTaxClass => ({
  id: t.id, code: t.code, name: t.name, annual_rate_bp: t.annual_rate_bp, first_year_rate_bp: t.first_year_rate_bp,
  is_active: t.is_active, version: t.version, can: { update: t.can.update === true },
});

export interface TaxClassDraft {
  code: string;
  name: string;
  annual_percent: string;
  first_year_percent: string;
  is_active: boolean;
}

export const emptyTaxClassDraft = (): TaxClassDraft => ({ code: '', name: '', annual_percent: '', first_year_percent: '', is_active: true });
export const taxClassToDraft = (t: AssetTaxClass): TaxClassDraft => ({
  code: t.code, name: t.name, annual_percent: bpToPercent(t.annual_rate_bp), first_year_percent: bpToPercent(t.first_year_rate_bp), is_active: t.is_active,
});

export function toTaxClassRequest(d: TaxClassDraft, version?: number): Built<Record<string, unknown>> {
  if (!d.code.trim() || !d.name.trim()) return { ok: false, error: 'Give the class a code and a name.' };
  const annual = percentToBp(d.annual_percent);
  if (annual === null || annual === undefined || annual > 10000) return { ok: false, error: 'Enter the yearly rate as a percent, for example 20 or 12.5.' };
  const first = percentToBp(d.first_year_percent);
  if (first === undefined || (first !== null && first > 10000)) return { ok: false, error: 'The first-year rate must be a percent, or left blank.' };
  return {
    ok: true,
    body: { code: d.code.trim(), name: d.name.trim(), annual_rate_bp: annual, first_year_rate_bp: first, is_active: d.is_active, ...(version === undefined ? {} : { version }) },
  };
}

/* ------------------------------------------------------------------ the register */

export interface FixedAssetRow {
  id: string;
  number: string;
  name: string;
  description: string;
  category_id: string;
  category_name: string;
  status: string;
  acquired_on: string;
  available_from: string;
  disposed_on: string;
  cost: number;
  residual: number;
  accumulated_depreciation: number;
  accumulated_impairment: number;
  /** Depreciation plus impairment: what the schedule calls accumulated. */
  accumulated: number;
  carrying: number;
  revaluation_reserve: number;
  method: DepreciationMethod;
  life_months: number | null;
  declining_rate_bp: number | null;
  units_total: number | null;
  units_used: number;
  months_charged: number;
  depreciated_through: string;
  is_opening: boolean;
  opening_accumulated: number;
  opening_as_of: string;
  source_type: string | null;
  source_id: string | null;
  source_journal_id: string | null;
  tax_class_id: string | null;
  /** Returned untouched on an update, because PUT replaces them. */
  dimensions: unknown;
  version: number;
  can: { update: boolean };
}

export function toFixedAsset(a: ApiFixedAsset): FixedAssetRow {
  const dep = fromApiMoney(a.accumulated_depreciation);
  const imp = fromApiMoney(a.accumulated_impairment);
  return {
    id: a.id,
    number: a.number,
    name: a.name,
    description: a.description ?? '',
    category_id: a.category_id,
    category_name: a.category_name ?? '',
    status: a.status,
    acquired_on: a.acquired_on ?? '',
    available_from: a.available_from ?? '',
    disposed_on: a.disposed_on ?? '',
    cost: fromApiMoney(a.cost),
    residual: fromApiMoney(a.residual),
    accumulated_depreciation: dep,
    accumulated_impairment: imp,
    accumulated: dep + imp,
    carrying: fromApiMoney(a.carrying_amount),
    revaluation_reserve: fromApiMoney(a.revaluation_reserve),
    method: asMethod(a.method),
    life_months: a.useful_life_months,
    declining_rate_bp: a.declining_rate_bp,
    units_total: a.units_total,
    units_used: a.units_used,
    months_charged: a.months_charged,
    depreciated_through: a.depreciated_through ?? '',
    is_opening: a.is_opening,
    opening_accumulated: fromApiMoney(a.opening_accumulated),
    opening_as_of: a.opening_as_of ?? '',
    source_type: a.source_type,
    source_id: a.source_id,
    source_journal_id: a.source_journal_id,
    tax_class_id: a.tax_class_id,
    dimensions: a.dimensions,
    version: a.version,
    can: { update: a.can.update === true },
  };
}

/** Share of the depreciable amount already used up, 0-100, integer maths. */
export function wornDownPercent(a: Pick<FixedAssetRow, 'cost' | 'residual' | 'accumulated'>): number {
  const base = a.cost - a.residual;
  if (base <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((a.accumulated * 100) / base)));
}

export interface EstimateDraft {
  name: string;
  description: string;
  residual: number;
  method: DepreciationMethod;
  life_months: string;
  rate_percent: string;
  units_total: string;
  tax_class_id: string;
}

export const assetToEstimateDraft = (a: FixedAssetRow): EstimateDraft => ({
  name: a.name, description: a.description, residual: a.residual, method: a.method, life_months: a.life_months === null ? '' : String(a.life_months),
  rate_percent: bpToPercent(a.declining_rate_bp), units_total: a.units_total === null ? '' : String(a.units_total), tax_class_id: a.tax_class_id ?? '',
});

interface Estimates {
  life: number | null;
  bp: number | null;
  units: number | null;
}

function parseEstimates(d: { method: DepreciationMethod; life_months: string; rate_percent: string; units_total: string }): Built<Estimates> {
  const life = parseWholeNumber(d.life_months);
  if (life === undefined || (life !== null && (life < 1 || life > 1200))) return { ok: false, error: 'Useful life must be a whole number of months, from 1 to 1200.' };
  const bp = percentToBp(d.rate_percent);
  if (bp === undefined || (bp !== null && (bp < 1 || bp > 10000))) return { ok: false, error: 'The yearly rate must be a percent between 0.01 and 100, with at most two decimals.' };
  const units = parseWholeNumber(d.units_total);
  if (units === undefined || (units !== null && units < 1)) return { ok: false, error: 'Total units must be a whole number above zero.' };
  if (d.method === 'declining_balance' && bp === null) return { ok: false, error: 'Enter the yearly rate for declining balance.' };
  if (d.method === 'units_of_production' && units === null) return { ok: false, error: 'Enter the total units the asset is expected to produce.' };
  return { ok: true, body: { life, bp, units } };
}

/** PUT body: replaces name, description, residual, method, life, rate, units, dimensions and tax class. */
export function toAssetUpdateRequest(a: FixedAssetRow, d: EstimateDraft): Built<Record<string, unknown>> {
  if (!d.name.trim()) return { ok: false, error: 'Give the asset a name.' };
  if (!Number.isSafeInteger(d.residual) || d.residual < 0 || d.residual > a.cost) return { ok: false, error: 'The value left at the end must be between zero and the cost.' };
  const e = parseEstimates(d);
  if (!e.ok) return e;
  return {
    ok: true,
    body: {
      name: d.name.trim(),
      description: d.description.trim() || null,
      residual: d.residual,
      method: d.method,
      useful_life_months: e.body.life,
      declining_rate_bp: d.method === 'declining_balance' ? e.body.bp : null,
      units_total: d.method === 'units_of_production' ? e.body.units : null,
      dimensions: a.dimensions,
      tax_class_id: d.tax_class_id || null,
      version: a.version,
    },
  };
}

export interface NewAssetDraft {
  /** `bill_line` or `journal_line` when capitalising; empty for an opening asset. */
  source_type: '' | 'bill_line' | 'journal_line';
  source_id: string;
  category_id: string;
  name: string;
  description: string;
  /** Minor units. For a capitalised line this is the line amount unless changed. */
  cost: number;
  acquired_on: string;
  available_from: string;
  residual: number;
  method: DepreciationMethod;
  life_months: string;
  rate_percent: string;
  units_total: string;
  tax_class_id: string;
  opening_accumulated: number;
  opening_as_of: string;
}

export const emptyNewAsset = (): NewAssetDraft => ({
  source_type: '', source_id: '', category_id: '', name: '', description: '', cost: 0, acquired_on: '', available_from: '', residual: 0,
  method: 'straight_line', life_months: '', rate_percent: '', units_total: '', tax_class_id: '', opening_accumulated: 0, opening_as_of: '',
});

/** POST body. Capitalising posts nothing (the cost is already in the books); neither does an opening asset. */
export function toAssetCreateRequest(d: NewAssetDraft): Built<Record<string, unknown>> {
  if (!d.name.trim()) return { ok: false, error: 'Give the asset a name.' };
  if (!d.category_id) return { ok: false, error: 'Choose a category.' };
  const capitalising = d.source_type !== '';
  if (capitalising && !d.source_id) return { ok: false, error: 'Choose the posted line to capitalise.' };
  if (!capitalising) {
    if (d.cost < 1) return { ok: false, error: 'Enter the cost.' };
    if (!d.acquired_on) return { ok: false, error: 'Enter the date it was bought.' };
    if (d.opening_accumulated > 0 && !d.opening_as_of) return { ok: false, error: 'Enter the date the depreciation so far is stated at.' };
    if (d.opening_accumulated > Math.max(0, d.cost - d.residual)) return { ok: false, error: 'Depreciation so far cannot be more than the cost less the value left at the end.' };
  }
  if (d.residual < 0 || (d.cost > 0 && d.residual > d.cost)) return { ok: false, error: 'The value left at the end must be between zero and the cost.' };
  const e = parseEstimates(d);
  if (!e.ok) return e;
  const body: Record<string, unknown> = {
    name: d.name.trim(),
    description: d.description.trim() || null,
    category_id: d.category_id,
    residual: d.residual,
    method: d.method,
    useful_life_months: e.body.life,
    declining_rate_bp: d.method === 'declining_balance' ? e.body.bp : null,
    units_total: d.method === 'units_of_production' ? e.body.units : null,
    tax_class_id: d.tax_class_id || null,
  };
  if (d.available_from) body.available_from = d.available_from;
  if (capitalising) {
    body.source_type = d.source_type;
    body.source_id = d.source_id;
    if (d.cost > 0) body.cost = d.cost;
    if (d.acquired_on) body.acquired_on = d.acquired_on;
  } else {
    body.cost = d.cost;
    body.acquired_on = d.acquired_on;
    body.opening_accumulated = d.opening_accumulated;
    if (d.opening_as_of) body.opening_as_of = d.opening_as_of;
  }
  return { ok: true, body };
}

export interface Capitalisable {
  source_type: 'bill_line' | 'journal_line';
  source_id: string;
  document_number: string;
  date: string;
  description: string;
  account_code: string;
  account_name: string;
  amount: number;
  category_id: string | null;
}

export function toCapitalisable(raw: unknown): Capitalisable {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  return {
    source_type: r.source_type === 'journal_line' ? 'journal_line' : 'bill_line',
    source_id: str('source_id'),
    document_number: str('document_number'),
    date: str('date'),
    description: str('description'),
    account_code: str('account_code'),
    account_name: str('account_name'),
    amount: fromApiMoney((r.amount ?? { amount: 0, currency: '' }) as ApiMoney),
    category_id: typeof r.category_id === 'string' ? r.category_id : null,
  };
}

/* ------------------------------------------------------------------ register to ledger check */

export interface ReconRow {
  account_id: string;
  account_code: string;
  account_name: string;
  kind: 'cost' | 'accumulated';
  categories: string;
  register: number;
  ledger: number;
  difference: number;
  opening_assets: number;
  reconciles: boolean;
  drill: { account_id: string; to: string };
}

export interface Reconciliation {
  as_of: string;
  reconciles: boolean;
  rows: ReconRow[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const money = (v: unknown): number => fromApiMoney((v ?? { amount: 0, currency: '' }) as ApiMoney);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function toReconciliation(raw: unknown): Reconciliation {
  const r = rec(raw);
  const rows = (Array.isArray(r.rows) ? r.rows : []).map((x): ReconRow => {
    const o = rec(x);
    const acc = rec(o.account);
    const drill = rec(o.drill);
    return {
      account_id: text(drill.account_id) || text(acc.id),
      account_code: text(acc.code),
      account_name: text(acc.name),
      kind: o.kind === 'accumulated' ? 'accumulated' : 'cost',
      categories: text(o.categories),
      register: money(o.register),
      ledger: money(o.ledger),
      difference: money(o.difference),
      opening_assets: money(o.opening_assets),
      reconciles: o.reconciles === true,
      drill: { account_id: text(drill.account_id) || text(acc.id), to: text(drill.to) || text(r.as_of) },
    };
  });
  return { as_of: text(r.as_of), reconciles: r.reconciles === true, rows };
}

/* ------------------------------------------------------------------ depreciation */

export interface DepreciationLine {
  asset_id: string;
  asset_number: string;
  asset_name: string;
  category_name: string;
  method: DepreciationMethod;
  months: number;
  catch_up_months: number;
  amount: number;
  units: number;
  carrying_before: number;
  carrying_after: number;
}

export interface DepreciationPreview {
  period_id: string;
  period_name: string;
  as_of: string;
  total: number;
  lines: DepreciationLine[];
  pending_units: DepreciationLine[];
  blockers: string[];
}

function toPreviewLine(x: unknown): DepreciationLine {
  const o = rec(x);
  return {
    asset_id: text(o.asset_id),
    asset_number: text(o.asset_number),
    asset_name: text(o.asset_name),
    category_name: text(o.category_name),
    method: asMethod(text(o.method)),
    months: typeof o.months === 'number' ? o.months : 0,
    catch_up_months: typeof o.catch_up_months === 'number' ? o.catch_up_months : 0,
    amount: money(o.amount),
    units: typeof o.units === 'number' ? o.units : 0,
    carrying_before: money(o.carrying_before),
    carrying_after: money(o.carrying_after),
  };
}

export function toDepreciationPreview(raw: unknown): DepreciationPreview {
  const r = rec(raw);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(toPreviewLine) : []);
  return {
    period_id: text(r.period_id),
    period_name: text(r.period_name),
    as_of: text(r.as_of),
    total: money(r.total),
    lines: list(r.lines),
    pending_units: list(r.pending_units),
    blockers: Array.isArray(r.blockers) ? r.blockers.filter((b): b is string => typeof b === 'string') : [],
  };
}

/** `units[assetId]=n` for the preview's query string. Blank or invalid entries are left out. */
export function unitsQuery(units: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(units)) {
    const n = parseWholeNumber(v);
    if (n !== null && n !== undefined) out[`units[${id}]`] = String(n);
  }
  return out;
}

export function unitsBody(units: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(units)) {
    const n = parseWholeNumber(v);
    if (n !== null && n !== undefined) out[id] = n;
  }
  return out;
}

export interface DepreciationRunLine {
  id: string;
  asset_id: string;
  asset_number: string;
  asset_name: string;
  amount: number;
  months: number;
  units: number;
  catch_up_months: number;
}

export interface DepreciationRun {
  id: string;
  number: string;
  status: DocStatus;
  period_id: string;
  as_of: string;
  total: number;
  journal_id: string | null;
  reversal_journal_id: string | null;
  memo: string;
  version: number;
  lines: DepreciationRunLine[];
  can: DocCan;
}

export interface DocCan {
  submit: boolean;
  approve: boolean;
  return: boolean;
  void: boolean;
  reverse: boolean;
}

const docCan = (c: { [key: string]: boolean }): DocCan => ({
  submit: c.submit === true, approve: c.approve === true, return: c.return === true, void: c.void === true, reverse: c.reverse === true,
});

export function toDepreciationRun(r: ApiDepreciationRun): DepreciationRun {
  return {
    id: r.id,
    number: r.number ?? '',
    status: r.status,
    period_id: r.fiscal_period_id,
    as_of: r.as_of ?? '',
    total: fromApiMoney(r.total),
    journal_id: r.journal_id,
    reversal_journal_id: r.reversal_journal_id,
    memo: r.memo ?? '',
    version: r.version,
    lines: (r.lines ?? []).map((l) => ({
      id: l.id, asset_id: l.asset_id, asset_number: l.asset_number, asset_name: l.asset_name, amount: fromApiMoney(l.amount),
      months: l.months, units: l.units, catch_up_months: l.catch_up_months,
    })),
    can: docCan(r.can),
  };
}

/* ------------------------------------------------------------------ disposals, impairments, revaluations */

export interface AssetTransaction {
  id: string;
  number: string;
  kind: AssetTxKind;
  status: DocStatus;
  tx_date: string;
  category_id: string | null;
  amount: number;
  reason: string;
  proceeds: number;
  proceeds_account_id: string | null;
  transfer_reserve: boolean;
  journal_id: string | null;
  reversal_journal_id: string | null;
  version: number;
  lines: Array<{ id: string; asset_id: string; asset_number: string; asset_name: string; input_amount: number; carrying_before: number; carrying_after: number; gain_or_loss: number | null }>;
  can: DocCan;
}

export const asTxKind = (k: string): AssetTxKind => (k === 'impairment' || k === 'impairment_reversal' || k === 'revaluation' ? k : 'disposal');

export function toAssetTransaction(t: ApiAssetTransaction): AssetTransaction {
  return {
    id: t.id,
    number: t.number ?? '',
    kind: asTxKind(t.kind),
    status: t.status,
    tx_date: t.tx_date ?? '',
    category_id: t.category_id,
    amount: fromApiMoney(t.amount),
    reason: t.reason ?? '',
    proceeds: fromApiMoney(t.proceeds),
    proceeds_account_id: t.proceeds_account_id,
    transfer_reserve: t.transfer_reserve,
    journal_id: t.journal_id,
    reversal_journal_id: t.reversal_journal_id,
    version: t.version,
    lines: (t.lines ?? []).map((l) => ({
      id: l.id, asset_id: l.asset_id, asset_number: l.asset_number, asset_name: l.asset_name, input_amount: fromApiMoney(l.input_amount),
      carrying_before: fromApiMoney(l.carrying_before), carrying_after: fromApiMoney(l.carrying_after), gain_or_loss: fromApiMoneyOrNull(l.gain_or_loss),
    })),
    can: docCan(t.can),
  };
}

export interface TxPreviewAsset {
  asset_id: string;
  asset_number: string;
  asset_name: string;
  carrying_before: number;
  carrying_after: number;
  gain_or_loss: number | null;
  to_reserve: number | null;
  to_profit_or_loss: number | null;
  cap: number | null;
  journal_lines: Array<{ account_code: string; account_name: string; debit: number; credit: number }>;
}

export interface TxPreview {
  kind: AssetTxKind;
  tx_date: string;
  total: number;
  assets: TxPreviewAsset[];
}

export function toTxPreview(raw: unknown): TxPreview {
  const r = rec(raw);
  const opt = (v: unknown) => (v === null || v === undefined ? null : money(v));
  return {
    kind: asTxKind(text(r.kind)),
    tx_date: text(r.tx_date),
    total: money(r.total),
    assets: (Array.isArray(r.assets) ? r.assets : []).map((x): TxPreviewAsset => {
      const o = rec(x);
      return {
        asset_id: text(o.asset_id),
        asset_number: text(o.asset_number),
        asset_name: text(o.asset_name),
        carrying_before: money(o.carrying_before),
        carrying_after: money(o.carrying_after),
        gain_or_loss: opt(o.gain_or_loss),
        to_reserve: opt(o.to_reserve),
        to_profit_or_loss: opt(o.to_profit_or_loss),
        cap: opt(o.cap),
        journal_lines: (Array.isArray(o.journal_lines) ? o.journal_lines : []).map((l) => {
          const j = rec(l);
          return { account_code: text(j.account_code), account_name: text(j.account_name), debit: money(j.debit), credit: money(j.credit) };
        }),
      };
    }),
  };
}

export interface AssetTxDraft {
  kind: AssetTxKind;
  tx_date: string;
  reason: string;
  asset_id: string;
  /** Minor units: the impairment, or the amount reversed. */
  amount: number;
  /** Minor units. 0 means scrapped. */
  proceeds: number;
  proceeds_account_id: string;
  transfer_reserve: boolean;
  category_id: string;
  /** Revaluation: asset id -> the new carrying amount in minor units (null until entered). */
  values: Record<string, number | null>;
}

export const emptyAssetTx = (kind: AssetTxKind): AssetTxDraft => ({
  kind, tx_date: '', reason: '', asset_id: '', amount: 0, proceeds: 0, proceeds_account_id: '', transfer_reserve: false, category_id: '', values: {},
});

/** Request body for both the preview and the create. `error` says in plain words what is still missing. */
export function toAssetTxRequest(d: AssetTxDraft): Built<Record<string, unknown>> {
  if (!d.tx_date) return { ok: false, error: 'Choose the date.' };
  const base: Record<string, unknown> = { kind: d.kind, tx_date: d.tx_date, reason: d.reason.trim() || null };
  switch (d.kind) {
    case 'disposal':
      if (!d.asset_id) return { ok: false, error: 'Choose the asset.' };
      if (d.proceeds < 0) return { ok: false, error: 'Proceeds cannot be negative.' };
      if (d.proceeds > 0 && !d.proceeds_account_id) return { ok: false, error: 'Choose where the money was received.' };
      return { ok: true, body: { ...base, asset_id: d.asset_id, proceeds: d.proceeds, proceeds_account_id: d.proceeds > 0 ? d.proceeds_account_id : null, transfer_reserve: d.transfer_reserve } };
    case 'impairment':
    case 'impairment_reversal':
      if (!d.asset_id) return { ok: false, error: 'Choose the asset.' };
      if (d.amount < 1) return { ok: false, error: 'Enter an amount above zero.' };
      if (!d.reason.trim()) return { ok: false, error: 'Say why, so the record explains itself.' };
      return { ok: true, body: { ...base, asset_id: d.asset_id, amount: d.amount } };
    case 'revaluation': {
      if (!d.category_id) return { ok: false, error: 'Choose the category.' };
      const ids = Object.keys(d.values);
      if (ids.length === 0) return { ok: false, error: 'There are no assets in this category to revalue.' };
      const values: Array<{ asset_id: string; value: number }> = [];
      for (const id of ids) {
        const v = d.values[id];
        if (v === null || v === undefined || v < 0) return { ok: false, error: 'Enter a new value for every asset in the category.' };
        values.push({ asset_id: id, value: v });
      }
      return { ok: true, body: { ...base, category_id: d.category_id, values } };
    }
  }
}

/* ------------------------------------------------------------------ tax schedule */

export interface TaxYear {
  year: number;
  label: string;
  allowance: number;
  written_down: number;
}

export interface TaxScheduleAsset {
  asset_id: string;
  number: string;
  name: string;
  class_name: string;
  cost: number;
  annual_rate_bp: number | null;
  first_year_rate_bp: number | null;
  stopped_after_year: number | null;
  years: TaxYear[];
}

export interface TaxSchedule {
  assets: TaxScheduleAsset[];
  by_year: TaxYear[];
}

const toTaxYear = (x: unknown): TaxYear => {
  const o = rec(x);
  return { year: typeof o.year === 'number' ? o.year : 0, label: text(o.label), allowance: money(o.allowance), written_down: money(o.written_down) };
};

export function toTaxSchedule(raw: unknown): TaxSchedule {
  const r = rec(raw);
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    assets: (Array.isArray(r.assets) ? r.assets : []).map((x): TaxScheduleAsset => {
      const o = rec(x);
      return {
        asset_id: text(o.asset_id), number: text(o.number), name: text(o.name), class_name: text(o.class_name), cost: money(o.cost),
        annual_rate_bp: num(o.annual_rate_bp), first_year_rate_bp: num(o.first_year_rate_bp), stopped_after_year: num(o.stopped_after_year),
        years: (Array.isArray(o.years) ? o.years : []).map(toTaxYear),
      };
    }),
    by_year: (Array.isArray(r.by_year) ? r.by_year : []).map(toTaxYear),
  };
}

/* ------------------------------------------------------------------ asset schedule report */

export interface ScheduleFigures {
  cost: { opening: number; additions: number; opening_assets: number; disposals: number; revaluation: number; closing: number };
  accumulated: { opening: number; opening_assets: number; charge: number; impairment: number; disposals: number; revaluation: number; closing: number };
  carrying_opening: number;
  carrying_closing: number;
}

export interface ScheduleAsset extends ScheduleFigures {
  asset_id: string;
  number: string;
  name: string;
}

export interface ScheduleCategory extends ScheduleFigures {
  category_id: string;
  category_name: string;
  assets: ScheduleAsset[];
}

export interface ScheduleEvent {
  date: string;
  kind: string;
  asset_number: string;
  cost: number;
  accumulated: number;
  journal_id: string | null;
  journal_number: string | null;
}

export interface AssetScheduleReport {
  from: string;
  to: string;
  categories: ScheduleCategory[];
  totals: ScheduleFigures;
  events: ScheduleEvent[];
  ties_to_ledger: boolean;
}

function figures(v: unknown): ScheduleFigures {
  const o = rec(v);
  const c = rec(o.cost);
  const a = rec(o.accumulated);
  return {
    cost: { opening: money(c.opening), additions: money(c.additions), opening_assets: money(c.opening_assets), disposals: money(c.disposals), revaluation: money(c.revaluation), closing: money(c.closing) },
    accumulated: {
      opening: money(a.opening), opening_assets: money(a.opening_assets), charge: money(a.charge), impairment: money(a.impairment),
      disposals: money(a.disposals), revaluation: money(a.revaluation), closing: money(a.closing),
    },
    carrying_opening: money(o.carrying_opening),
    carrying_closing: money(o.carrying_closing),
  };
}

export function toAssetSchedule(raw: unknown): AssetScheduleReport {
  const r = rec(raw);
  return {
    from: text(r.from),
    to: text(r.to),
    categories: (Array.isArray(r.categories) ? r.categories : []).map((x): ScheduleCategory => {
      const o = rec(x);
      return {
        category_id: text(o.category_id),
        category_name: text(o.category_name),
        ...figures(o),
        assets: (Array.isArray(o.assets) ? o.assets : []).map((y): ScheduleAsset => {
          const p = rec(y);
          return { asset_id: text(p.asset_id), number: text(p.number), name: text(p.name), ...figures(p) };
        }),
      };
    }),
    totals: figures(r.totals),
    events: (Array.isArray(r.events) ? r.events : []).map((x): ScheduleEvent => {
      const o = rec(x);
      return {
        date: text(o.date), kind: text(o.kind), asset_number: text(o.asset_number), cost: money(o.cost), accumulated: money(o.accumulated),
        journal_id: typeof o.journal_id === 'string' ? o.journal_id : null, journal_number: typeof o.journal_number === 'string' ? o.journal_number : null,
      };
    }),
    ties_to_ledger: r.ties_to_ledger === true,
  };
}

/** The schedule's query: a period, or a date range. */
export function scheduleQuery(sel: { periodId?: string; from?: string; to?: string }): Record<string, string> {
  if (sel.periodId) return { period_id: sel.periodId };
  const q: Record<string, string> = {};
  if (sel.from) q.from = sel.from;
  if (sel.to) q.to = sel.to;
  return q;
}
