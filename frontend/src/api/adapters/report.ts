/**
 * Reports, live mode (docs/15 "Done in 3.8"). The report bodies are typed loosely in openapi.json
 * (`additionalProperties`), so every reader checks the shape it needs and throws `ReportShapeError` when the
 * server sends something else, instead of guessing. Amounts are integer minor units taken from the server's
 * `{amount, currency}`. NOTHING here adds, subtracts or converts a figure: subtotals, totals, variances and
 * balances are the server's, shown as sent.
 */
import { fromApiMoney, type ApiMoney } from './money';

export class ReportShapeError extends Error {
  constructor(what: string) {
    super(`Unexpected report response: ${what}`);
    this.name = 'ReportShapeError';
  }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function rec(v: unknown, what: string): Rec {
  if (!isRec(v)) throw new ReportShapeError(what);
  return v;
}
function list(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new ReportShapeError(what);
  return v;
}
function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new ReportShapeError(what);
  return v;
}
const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown): boolean => v === true;
function mon(v: unknown, what: string): number {
  if (!isRec(v) || typeof v.amount !== 'number' || typeof v.currency !== 'string') throw new ReportShapeError(what);
  return fromApiMoney(v as unknown as ApiMoney);
}

// ---------------------------------------------------------------------------------------------------------------
// Drill keys and the query string
// ---------------------------------------------------------------------------------------------------------------

/** What a figure carries so `GET reports/drill` can list the lines behind it (13 §13). */
export interface DrillKey {
  account_id: string;
  from: string | null;
  to: string;
  exclude_closing: boolean;
  /** dimension id -> value ids */
  dimensions?: Record<string, string[]>;
  contact_side?: 'debit' | 'credit';
  contact_id?: string;
}

export function toDrillKey(v: unknown): DrillKey | undefined {
  if (!isRec(v) || typeof v.account_id !== 'string' || typeof v.to !== 'string') return undefined;
  const key: DrillKey = { account_id: v.account_id, from: optStr(v.from), to: v.to, exclude_closing: bool(v.exclude_closing) };
  if (isRec(v.dimensions)) {
    const dims: Record<string, string[]> = {};
    for (const [id, vals] of Object.entries(v.dimensions)) {
      if (Array.isArray(vals)) dims[id] = vals.filter((x): x is string => typeof x === 'string');
    }
    if (Object.keys(dims).length > 0) key.dimensions = dims;
  }
  if (v.contact_side === 'debit' || v.contact_side === 'credit') key.contact_side = v.contact_side;
  if (typeof v.contact_id === 'string') key.contact_id = v.contact_id;
  return key;
}

/** Query-string pairs, as the API reads them: `dimensions[<dimension id>]=<value id>`, booleans as text. */
export type QueryPairs = Record<string, string>;

export function drillQuery(key: DrillKey): QueryPairs {
  const q: QueryPairs = { account_id: key.account_id, to: key.to, exclude_closing: String(key.exclude_closing) };
  if (key.from) q.from = key.from;
  if (key.contact_side) q.contact_side = key.contact_side;
  if (key.contact_id) q.contact_id = key.contact_id;
  for (const [id, values] of Object.entries(key.dimensions ?? {})) {
    // The request accepts one value per dimension in this form; the screens only ever filter by one.
    if (values[0]) q[`dimensions[${id}]`] = values[0];
  }
  return q;
}

export type Comparison = 'none' | 'previous_period' | 'previous_year';
export type Basis = 'month' | 'ytd';
/** `period`: a fiscal period; `range`: from/to dates (range reports); `asof`: one date (as-of reports). */
export type When =
  | { kind: 'period'; periodId: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'asof'; date: string };

export interface ReportSelection {
  when: When;
  basis: Basis;
  comparison: Comparison;
  hideZero: boolean;
  /** dimension id -> value id */
  dims: Record<string, string>;
  accountId?: string;
  contactId?: string;
  /** Dimension id whose values become columns (trial balance as of a date, profit and loss). */
  breakdown?: string;
  /** Trial balance: `movement` adds opening, debit and credit movement and closing over the chosen range. */
  view?: 'movement';
}

/** The query for a report run. As-of reports ignore from/to and range reports ignore as_of, as the server does. */
export function selectionQuery(sel: ReportSelection, opts: { basis?: boolean; comparison?: boolean; dims?: boolean } = {}): QueryPairs {
  const q: QueryPairs = {};
  const w = sel.when;
  if (w.kind === 'period') {
    q.period_id = w.periodId;
    if (opts.basis) q.basis = sel.basis;
  } else if (w.kind === 'range') {
    if (w.from) q.from = w.from;
    q.to = w.to;
  } else {
    q.as_of = w.date;
  }
  if (opts.comparison && sel.comparison !== 'none') q.comparison = sel.comparison;
  if (sel.hideZero) q.hide_zero = 'true';
  if (opts.dims !== false) {
    for (const [id, value] of Object.entries(sel.dims)) if (value) q[`dimensions[${id}]`] = value;
  }
  if (sel.accountId) q.account_id = sel.accountId;
  if (sel.contactId) q.contact_id = sel.contactId;
  if (sel.view) q.view = sel.view;
  if (sel.breakdown) q.breakdown = sel.breakdown;
  return q;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------------------------

export interface AccountRef {
  id: string;
  code: string;
  name: string;
  subtype: string | null;
  accountType: string | null;
}

function accountRef(v: unknown, what: string): AccountRef {
  const a = rec(v, what);
  return { id: str(a.id, what), code: str(a.code, what), name: str(a.name, what), subtype: optStr(a.subtype), accountType: optStr(a.account_type) };
}

/** A figure, with the server's comparison columns when the run asked for a comparison. */
export interface Figure {
  amount: number;
  comparison?: number;
  variance?: number;
  /** Server-formatted percentage with one decimal ("12.5"), or null when there was nothing to divide by. */
  variancePct?: string | null;
  /** Breakdown by dimension: the amount in each column, in the breakdown's column order. */
  byDimension?: number[];
}

function figure(v: unknown, what: string): Figure {
  const o = rec(v, what);
  const f: Figure = { amount: mon(o.amount, `${what}.amount`) };
  if ('comparison' in o && isRec(o.comparison)) f.comparison = mon(o.comparison, `${what}.comparison`);
  if ('variance' in o && isRec(o.variance)) f.variance = mon(o.variance, `${what}.variance`);
  if ('variance_pct' in o) f.variancePct = optStr(o.variance_pct);
  if (Array.isArray(o.by_dimension)) f.byDimension = o.by_dimension.map((c, i) => mon(c, `${what}.by_dimension[${i}]`));
  return f;
}

/** 3c.19: one dimension's values as columns; the last column is `null`, the lines with no value ("untagged"). */
export interface Breakdown {
  dimension: { id: string; code: string; name: string };
  columns: Array<{ id: string; code: string; name: string } | null>;
}

function parseBreakdown(v: unknown): Breakdown | null {
  if (!isRec(v)) return null;
  const d = rec(v.dimension, 'breakdown.dimension');
  return {
    dimension: { id: str(d.id, 'dimension.id'), code: str(d.code, 'dimension.code'), name: str(d.name, 'dimension.name') },
    columns: list(v.columns, 'breakdown.columns').map((c) => {
      const value = rec(c, 'column').value;
      if (!isRec(value)) return null;
      return { id: str(value.id, 'value.id'), code: str(value.code, 'value.code'), name: str(value.name, 'value.name') };
    }),
  };
}

export interface FundRef {
  id: string;
  code: string;
  name: string;
}
function fundRef(v: unknown): FundRef | null {
  if (!isRec(v) || typeof v.id !== 'string') return null;
  return { id: v.id, code: optStr(v.code) ?? '', name: optStr(v.name) ?? '' };
}

export interface ComparisonInfo {
  type: Comparison;
  /** False when there is nothing to compare with (the first period, a company in its first year). */
  available: boolean;
  from: string | null;
  to: string | null;
}
function comparisonInfo(v: unknown): ComparisonInfo | null {
  if (!isRec(v)) return null;
  const type = v.type === 'previous_period' || v.type === 'previous_year' ? v.type : 'none';
  return { type, available: bool(v.available), from: optStr(v.from), to: optStr(v.to) ?? optStr(v.as_of) };
}

interface Head {
  currency: string;
  generatedAt: string | null;
}
function head(o: Rec): Head {
  return { currency: str(o.currency, 'currency'), generatedAt: optStr(o.generated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------------------------------------------

export interface DebitCredit {
  debit: number;
  credit: number;
}
export interface TrialBalanceRow {
  account: AccountRef;
  /** As-of: the balance on its side. Movement: the closing balance (same as `closing`). */
  debit: number;
  credit: number;
  drill?: DrillKey;
  /** Movement view only. */
  opening?: DebitCredit;
  movement?: DebitCredit;
  closing?: DebitCredit;
  /** As-of with a breakdown: net (debit less credit) per column. */
  byDimension?: number[];
  drills?: { opening?: DrillKey; movement?: DrillKey; closing?: DrillKey };
}
export interface TrialBalanceView extends Head {
  mode: 'as_of' | 'movement';
  asOf: string;
  /** Movement view: the range, and the day the opening column is as of. */
  from?: string;
  openingAsOf?: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  /** Movement view: the three pairs of totals. */
  totals?: { opening: DebitCredit; movement: DebitCredit; closing: DebitCredit };
  /** The server's verdict on debits = credits. */
  balanced: boolean;
  /** A dimension filter selects part of each journal, so the sides can legitimately differ. */
  filtered: boolean;
  /** As-of with a breakdown: the columns and each column's net total (debit less credit). */
  breakdown?: Breakdown | null;
  totalsByDimension?: number[];
}

function debitCredit(v: unknown, what: string): DebitCredit {
  const o = rec(v, what);
  return { debit: mon(o.debit, `${what}.debit`), credit: mon(o.credit, `${what}.credit`) };
}

export function parseTrialBalance(data: unknown): TrialBalanceView {
  const o = rec(data, 'trial balance');
  const totals = rec(o.totals, 'trial balance totals');
  if (o.mode === 'movement') {
    const t = { opening: debitCredit(totals.opening, 'totals.opening'), movement: debitCredit(totals.movement, 'totals.movement'), closing: debitCredit(totals.closing, 'totals.closing') };
    return {
      ...head(o),
      mode: 'movement',
      asOf: str(o.as_of, 'as_of'),
      from: str(o.from, 'from'),
      openingAsOf: str(o.opening_as_of, 'opening_as_of'),
      rows: list(o.rows, 'rows').map((r) => {
        const row = rec(r, 'row');
        const closing = debitCredit(row.closing, 'row.closing');
        const d = isRec(row.drill) ? row.drill : {};
        return {
          account: accountRef(row.account, 'row.account'),
          debit: closing.debit,
          credit: closing.credit,
          opening: debitCredit(row.opening, 'row.opening'),
          movement: debitCredit(row.movement, 'row.movement'),
          closing,
          drills: { opening: toDrillKey(d.opening), movement: toDrillKey(d.movement), closing: toDrillKey(d.closing) },
        };
      }),
      totalDebit: t.closing.debit,
      totalCredit: t.closing.credit,
      totals: t,
      balanced: bool(o.balanced),
      filtered: bool(o.filtered),
    };
  }
  return {
    ...head(o),
    mode: 'as_of',
    asOf: str(o.as_of, 'as_of'),
    rows: list(o.rows, 'rows').map((r) => {
      const row = rec(r, 'row');
      const out: TrialBalanceRow = { account: accountRef(row.account, 'row.account'), debit: mon(row.debit, 'row.debit'), credit: mon(row.credit, 'row.credit'), drill: toDrillKey(row.drill) };
      if (Array.isArray(row.by_dimension)) out.byDimension = row.by_dimension.map((c, i) => mon(c, `row.by_dimension[${i}]`));
      return out;
    }),
    totalDebit: mon(totals.debit, 'totals.debit'),
    totalCredit: mon(totals.credit, 'totals.credit'),
    balanced: bool(o.balanced),
    filtered: bool(o.filtered),
    breakdown: parseBreakdown(o.breakdown),
    totalsByDimension: Array.isArray(totals.by_dimension) ? totals.by_dimension.map((c, i) => mon(c, `totals.by_dimension[${i}]`)) : undefined,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Profit and loss
// ---------------------------------------------------------------------------------------------------------------

export interface PlLine extends Figure {
  account: AccountRef;
  drill?: DrillKey;
}
export interface PlSection {
  key: string;
  title: string;
  lines: PlLine[];
  total: Figure;
}
export interface ProfitAndLossView extends Head {
  from: string;
  to: string;
  comparison: ComparisonInfo | null;
  sections: PlSection[];
  grossProfit: Figure;
  operatingProfit: Figure;
  netProfit: Figure;
  filtered: boolean;
  breakdown: Breakdown | null;
}

export function parseProfitAndLoss(data: unknown): ProfitAndLossView {
  const o = rec(data, 'profit and loss');
  const sub = rec(o.subtotals, 'subtotals');
  return {
    ...head(o),
    from: str(o.from, 'from'),
    to: str(o.to, 'to'),
    comparison: comparisonInfo(o.comparison),
    sections: list(o.sections, 'sections').map((s) => {
      const sec = rec(s, 'section');
      return {
        key: str(sec.key, 'section.key'),
        title: str(sec.title, 'section.title'),
        lines: list(sec.lines, 'section.lines').map((l) => {
          const line = rec(l, 'line');
          return { ...figure(line, 'line'), account: accountRef(line.account, 'line.account'), drill: toDrillKey(line.drill) };
        }),
        total: figure(sec.total, 'section.total'),
      };
    }),
    grossProfit: figure(sub.gross_profit, 'gross_profit'),
    operatingProfit: figure(sub.operating_profit, 'operating_profit'),
    netProfit: figure(sub.net_profit, 'net_profit'),
    filtered: bool(o.filtered),
    breakdown: parseBreakdown(o.breakdown),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Balance sheet (D9 gross AR/AP, D13 equity by fund)
// ---------------------------------------------------------------------------------------------------------------

export interface BsContact {
  id: string | null;
  name: string;
  amount: number;
  drill?: DrillKey;
}
export interface BsLine extends Figure {
  key: string;
  /** Account name, or the server's own wording for lines that are not one account. */
  label: string;
  code: string | null;
  /** The fund of an equity line; null is "no fund" (unrestricted). Undefined when the company has no fund dimension. */
  fund?: FundRef | null;
  /** The unclosed result carried to equity. */
  result: boolean;
  /** D9: a credit balance in receivables (or debit balance in payables) shown on its own line, not netted. */
  gross: boolean;
  contacts: BsContact[];
  drill?: DrillKey;
}
export interface BsSection {
  lines: BsLine[];
  total: Figure;
}
/** IAS 1.60: assets and liabilities in a current and a non-current part; the two totals add up to the section total. */
export interface BsClassifiedSection extends BsSection {
  current: BsSection;
  nonCurrent: BsSection;
}
export interface BsFund {
  fund: FundRef | null;
  total: Figure;
}
export interface BalanceSheetView extends Head {
  asOf: string;
  comparison: ComparisonInfo | null;
  assets: BsClassifiedSection;
  liabilities: BsClassifiedSection;
  equity: BsSection & { funds: BsFund[] | null };
  liabilitiesAndEquity: Figure;
  balanced: boolean;
  difference: number;
  filtered: boolean;
}

function bsLine(v: unknown): BsLine {
  const l = rec(v, 'balance sheet line');
  const account = isRec(l.account) ? accountRef(l.account, 'line.account') : null;
  const line: BsLine = {
    ...figure(l, 'line'),
    key: str(l.key, 'line.key'),
    label: optStr(l.name) ?? account?.name ?? '',
    code: l.name ? null : (account?.code ?? null),
    result: bool(l.result),
    gross: bool(l.gross),
    contacts: Array.isArray(l.contacts)
      ? l.contacts.map((c) => {
          const co = rec(c, 'contact');
          const contact = isRec(co.contact) ? co.contact : null;
          return { id: contact ? optStr(contact.id) : null, name: contact ? (optStr(contact.name) ?? '') : '', amount: mon(co.amount, 'contact.amount'), drill: toDrillKey(co.drill) };
        })
      : [],
    drill: toDrillKey(l.drill),
  };
  if ('fund' in l) line.fund = fundRef(l.fund);
  return line;
}

function bsSection(v: unknown, what: string): BsSection {
  const s = rec(v, what);
  return { lines: list(s.lines, `${what}.lines`).map(bsLine), total: figure(s.total, `${what}.total`) };
}

function bsClassified(v: unknown, what: string): BsClassifiedSection {
  const s = rec(v, what);
  return { ...bsSection(s, what), current: bsSection(s.current, `${what}.current`), nonCurrent: bsSection(s.non_current, `${what}.non_current`) };
}

export function parseBalanceSheet(data: unknown): BalanceSheetView {
  const o = rec(data, 'balance sheet');
  const equity = rec(o.equity, 'equity');
  return {
    ...head(o),
    asOf: str(o.as_of, 'as_of'),
    comparison: comparisonInfo(o.comparison),
    assets: bsClassified(o.assets, 'assets'),
    liabilities: bsClassified(o.liabilities, 'liabilities'),
    equity: {
      ...bsSection(equity, 'equity'),
      funds: Array.isArray(equity.funds) ? equity.funds.map((f) => ({ fund: fundRef(rec(f, 'fund').fund), total: figure(rec(f, 'fund').total, 'fund.total') })) : null,
    },
    liabilitiesAndEquity: figure(rec(o.totals, 'totals').liabilities_and_equity, 'liabilities_and_equity'),
    balanced: bool(o.balanced),
    difference: mon(o.difference, 'difference'),
    filtered: bool(o.filtered),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------------------------------------------

export interface CashFlowLine {
  key: string;
  label: string;
  amount: number;
  drill?: DrillKey;
}
export interface CashFlowSection {
  lines: CashFlowLine[];
  total: number;
}
export interface CashFlowAssumption {
  account: string;
  activity: string;
  reason: string;
}
export interface CashFlowView extends Head {
  from: string;
  to: string;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  fxEffect: number;
  netChange: number;
  opening: number;
  closing: number;
  unexplained: number;
  reconciles: boolean;
  assumptions: CashFlowAssumption[];
}

function cfSection(v: unknown, what: string): CashFlowSection {
  const s = rec(v, what);
  return {
    total: mon(s.total, `${what}.total`),
    lines: list(s.lines, `${what}.lines`).map((l) => {
      const line = rec(l, 'line');
      return { key: str(line.key, 'line.key'), label: str(line.label, 'line.label'), amount: mon(line.amount, 'line.amount'), drill: toDrillKey(line.drill) };
    }),
  };
}

export function parseCashFlow(data: unknown): CashFlowView {
  const o = rec(data, 'cash flow');
  return {
    ...head(o),
    from: str(o.from, 'from'),
    to: str(o.to, 'to'),
    operating: cfSection(o.operating, 'operating'),
    investing: cfSection(o.investing, 'investing'),
    financing: cfSection(o.financing, 'financing'),
    fxEffect: mon(o.fx_effect_on_cash, 'fx_effect_on_cash'),
    netChange: mon(o.net_change_in_cash, 'net_change_in_cash'),
    opening: mon(o.opening_cash, 'opening_cash'),
    closing: mon(o.closing_cash, 'closing_cash'),
    unexplained: mon(o.unexplained, 'unexplained'),
    reconciles: bool(o.reconciles),
    assumptions: list(o.assumptions ?? [], 'assumptions').map((a) => {
      const r = rec(a, 'assumption');
      return { account: `${optStr(r.code) ?? ''} ${optStr(r.name) ?? ''}`.trim(), activity: optStr(r.activity) ?? '', reason: optStr(r.reason) ?? '' };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------------------------------------------

export const AGING_BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingAmounts {
  buckets: Record<AgingBucket, number>;
  open: number;
  creditNotes: number;
  onAccount: number;
  credits: number;
  /** open less credits: what the control account holds for this contact (or in total). */
  net: number;
}
export interface AgingRow extends AgingAmounts {
  contact: { id: string; code: string; name: string };
}
export interface AgingCredit {
  contact: { id: string; code: string; name: string };
  kind: string;
  id: string;
  number: string | null;
  date: string;
  amount: number;
}
export interface AgingView extends Head {
  asOf: string;
  rows: AgingRow[];
  credits: AgingCredit[];
  totals: AgingAmounts;
}

function agingAmounts(v: Rec): AgingAmounts {
  const buckets = {} as Record<AgingBucket, number>;
  for (const b of AGING_BUCKETS) buckets[b] = mon(v[b], b);
  return {
    buckets,
    open: mon(v.open, 'open'),
    creditNotes: mon(v.credit_notes, 'credit_notes'),
    onAccount: mon(v.on_account, 'on_account'),
    credits: mon(v.credits, 'credits'),
    net: mon(v.net, 'net'),
  };
}
function contactRef(v: unknown): { id: string; code: string; name: string } {
  const c = rec(v, 'contact');
  return { id: str(c.id, 'contact.id'), code: optStr(c.code) ?? '', name: str(c.name, 'contact.name') };
}

export function parseAging(data: unknown): AgingView {
  const o = rec(data, 'aging');
  return {
    ...head(o),
    asOf: str(o.as_of, 'as_of'),
    rows: list(o.rows, 'rows').map((r) => {
      const row = rec(r, 'row');
      return { ...agingAmounts(row), contact: contactRef(row.contact) };
    }),
    credits: list(o.credits, 'credits').map((c) => {
      const cr = rec(c, 'credit');
      return { contact: contactRef(cr.contact), kind: str(cr.kind, 'credit.kind'), id: str(cr.id, 'credit.id'), number: optStr(cr.number), date: str(cr.date, 'credit.date'), amount: mon(cr.amount, 'credit.amount') };
    }),
    totals: agingAmounts(rec(o.totals, 'totals')),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Customer and supplier statements
// ---------------------------------------------------------------------------------------------------------------

export interface StatementRow {
  date: string;
  type: string;
  documentNumber: string | null;
  journalNumber: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
}
export interface StatementView extends Head {
  contact: { id: string; code: string; name: string };
  from: string;
  to: string;
  opening: number;
  rows: StatementRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

export function parseStatement(data: unknown): StatementView {
  const o = rec(data, 'statement');
  const totals = rec(o.totals, 'totals');
  return {
    ...head(o),
    contact: contactRef(o.contact),
    from: str(o.from, 'from'),
    to: str(o.to, 'to'),
    opening: mon(o.opening_balance, 'opening_balance'),
    rows: list(o.rows, 'rows').map((r) => {
      const row = rec(r, 'row');
      const doc = isRec(row.document) ? row.document : {};
      return {
        date: str(row.date, 'row.date'),
        type: str(row.type, 'row.type'),
        documentNumber: optStr(doc.number),
        journalNumber: row.journal_number === null || row.journal_number === undefined ? null : String(row.journal_number),
        description: optStr(row.description),
        debit: mon(row.debit, 'row.debit'),
        credit: mon(row.credit, 'row.credit'),
        balance: mon(row.balance, 'row.balance'),
      };
    }),
    totalDebit: mon(totals.debit, 'totals.debit'),
    totalCredit: mon(totals.credit, 'totals.credit'),
    closing: mon(o.closing_balance, 'closing_balance'),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tax return
// ---------------------------------------------------------------------------------------------------------------

export interface TaxRow {
  /** The tax code's id; null for lines without a tax code (the drill asks for them as `none`). */
  taxCodeId: string | null;
  code: string;
  name: string;
  kind: string;
  /** Purchases only: false means the tax is cost, not input tax, and is left out of the tax total. */
  recoverable: boolean | null;
  net: number;
  tax: number;
}
export interface TaxSide {
  type: 'output' | 'input';
  rows: TaxRow[];
  totalNet: number;
  totalTax: number;
}
export interface TaxReturnView extends Head {
  from: string;
  to: string;
  sales: TaxSide;
  purchases: TaxSide;
  netPayable: number;
}

function taxSide(v: unknown, what: string): TaxSide {
  const s = rec(v, what);
  const totals = rec(s.totals, `${what}.totals`);
  return {
    type: s.tax_type === 'input' ? 'input' : 'output',
    rows: list(s.rows, `${what}.rows`).map((r) => {
      const row = rec(r, 'row');
      const code = isRec(row.tax_code) ? row.tax_code : null;
      return {
        taxCodeId: code ? optStr(code.id) : null,
        code: code ? (optStr(code.code) ?? '') : '',
        name: code ? (optStr(code.name) ?? '') : 'No tax code',
        kind: code ? (optStr(code.kind) ?? '') : '',
        recoverable: typeof row.recoverable === 'boolean' ? row.recoverable : null,
        net: mon(row.net, 'row.net'),
        tax: mon(row.tax, 'row.tax'),
      };
    }),
    totalNet: mon(totals.net, 'totals.net'),
    totalTax: mon(totals.tax, 'totals.tax'),
  };
}

export function parseTaxReturn(data: unknown): TaxReturnView {
  const o = rec(data, 'tax return');
  return {
    ...head(o),
    from: str(o.from, 'from'),
    to: str(o.to, 'to'),
    sales: taxSide(o.sales, 'sales'),
    purchases: taxSide(o.purchases, 'purchases'),
    netPayable: mon(o.net_tax_payable, 'net_tax_payable'),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// General ledger and drill lines
// ---------------------------------------------------------------------------------------------------------------

export interface LedgerLine {
  id: string;
  journalId: string;
  journalNumber: string | null;
  date: string;
  type: string | null;
  reference: string | null;
  memo: string | null;
  description: string | null;
  sourceType: string | null;
  lineNo: number;
  debit: number;
  credit: number;
  /** Running balance after this line (general ledger only). */
  balance: number | null;
  /** dimension id -> value id */
  dimensions: Record<string, string>;
}

export function parseLedgerLine(v: unknown): LedgerLine {
  const l = rec(v, 'line');
  const j = rec(l.journal, 'line.journal');
  const dims: Record<string, string> = {};
  if (isRec(l.dimensions)) for (const [k, val] of Object.entries(l.dimensions)) if (typeof val === 'string') dims[k] = val;
  return {
    id: str(l.id, 'line.id'),
    journalId: str(j.id, 'journal.id'),
    journalNumber: j.number === null || j.number === undefined ? null : String(j.number),
    date: str(j.date, 'journal.date'),
    type: optStr(j.type),
    reference: optStr(j.reference),
    memo: optStr(j.memo),
    description: optStr(l.description),
    sourceType: isRec(l.source) ? optStr(l.source.type) : null,
    lineNo: typeof l.line_no === 'number' ? l.line_no : 0,
    debit: mon(l.debit, 'line.debit'),
    credit: mon(l.credit, 'line.credit'),
    balance: 'balance' in l ? mon(l.balance, 'line.balance') : null,
    dimensions: dims,
  };
}

export interface LedgerHeader extends Head {
  account: AccountRef;
  from: string | null;
  to: string | null;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  lineCount: number;
}

export function parseLedgerHeader(v: unknown): LedgerHeader {
  const o = rec(v, 'general ledger');
  const sum = rec(o.summary, 'summary');
  return {
    ...head(o),
    account: accountRef(o.account, 'account'),
    from: optStr(o.from),
    to: optStr(o.to),
    opening: mon(o.opening_balance, 'opening_balance'),
    closing: mon(o.closing_balance, 'closing_balance'),
    totalDebit: mon(sum.debit, 'summary.debit'),
    totalCredit: mon(sum.credit, 'summary.credit'),
    lineCount: typeof sum.line_count === 'number' ? sum.line_count : 0,
  };
}

export interface DrillSummary {
  debit: number;
  credit: number;
  net: number;
  lineCount: number;
  account: AccountRef;
}

export function parseDrillSummary(summary: unknown, account: unknown): DrillSummary {
  const s = rec(summary, 'summary');
  return {
    debit: mon(s.debit, 'summary.debit'),
    credit: mon(s.credit, 'summary.credit'),
    net: mon(s.net, 'summary.net'),
    lineCount: typeof s.line_count === 'number' ? s.line_count : 0,
    account: accountRef(account, 'account'),
  };
}

/** Queued exports answer 202 with an id, then `{id, status}` until the file is ready. */
export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed';
export function parseExportTicket(data: unknown): { id: string; status: ExportStatus } {
  const d = rec(rec(data, 'export').data, 'export.data');
  const status = d.status === 'ready' || d.status === 'failed' || d.status === 'running' ? d.status : 'queued';
  return { id: str(d.id, 'export.id'), status };
}
