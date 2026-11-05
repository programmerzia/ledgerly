/**
 * Banking adapters (plan 3.7): API resources -> the shapes the live banking screens use, and form -> request bodies.
 * Money is integer minor units from the server and stays that way; nothing here adds up money. The reconciliation
 * difference is read from the server's report, never computed.
 */
import type { components } from '../schema';
import { ApiError } from '../errors';

export type ApiBankAccount = components['schemas']['BankAccountResource'];
export type ApiBankStatement = components['schemas']['BankStatementResource'];
export type ApiStatementImport = components['schemas']['BankStatementImportResource'];
export type ApiBankLine = components['schemas']['BankStatementLineResource'];
export type ApiBankRule = components['schemas']['BankRuleResource'];
export type ApiBankMatch = components['schemas']['BankMatchResource'];
export type ApiReconciliation = components['schemas']['BankReconciliationResource'];
export type ApiBankTransaction = components['schemas']['BankTransactionResource'];

/** `{amount: null}` is a statement without that balance; plain `fromApiMoney` would refuse it. */
function minorOrNull(m: { amount: number | null } | null | undefined): number | null {
  if (!m || m.amount === null || m.amount === undefined) return null;
  if (!Number.isSafeInteger(m.amount)) throw new Error(`Money amount must be an integer of minor units, got ${String(m.amount)}`);
  return m.amount;
}

/* ------------------------------------------------------------------ CSV mapping */

export type CsvSign = 'signed' | 'inverted' | 'columns';
export type CsvLocale = 'us' | 'eu' | 'plain';

/** The server's own date formats (DateParser::FORMATS), with an example each so nobody has to read format codes. */
export const DATE_FORMATS: Array<{ value: string; label: string }> = [
  { value: 'Y-m-d', label: '2026-03-31' },
  { value: 'd/m/Y', label: '31/03/2026' },
  { value: 'm/d/Y', label: '03/31/2026' },
  { value: 'd.m.Y', label: '31.03.2026' },
  { value: 'd-m-Y', label: '31-03-2026' },
  { value: 'Ymd', label: '20260331' },
  { value: 'd/m/y', label: '31/03/26' },
  { value: 'm/d/y', label: '03/31/26' },
];

export const DELIMITERS: Array<{ value: string; label: string }> = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe' },
];

export interface CsvMapping {
  delimiter: string;
  has_header: boolean;
  skip_rows: number;
  date_format: string;
  locale: CsvLocale;
  sign: CsvSign;
  order: 'asc' | 'desc';
  /** field -> header name (or 0-based position when the file has no header). */
  columns: Record<string, string>;
}

export const COLUMN_FIELDS = ['date', 'value_date', 'description', 'reference', 'counterparty', 'amount', 'debit', 'credit', 'balance'] as const;
export type ColumnField = (typeof COLUMN_FIELDS)[number];

export const emptyMapping = (): CsvMapping => ({ delimiter: ',', has_header: true, skip_rows: 0, date_format: 'Y-m-d', locale: 'plain', sign: 'signed', order: 'asc', columns: {} });

/** Reads a saved `import_mapping` (any JSON the server kept) over the defaults, ignoring what it does not understand. */
export function readSavedMapping(raw: unknown): CsvMapping | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const base = emptyMapping();
  const columns: Record<string, string> = {};
  if (r.columns && typeof r.columns === 'object') {
    for (const [k, v] of Object.entries(r.columns as Record<string, unknown>)) {
      if ((COLUMN_FIELDS as readonly string[]).includes(k) && (typeof v === 'string' || typeof v === 'number') && String(v) !== '') columns[k] = String(v);
    }
  }
  if (Object.keys(columns).length === 0) return null;
  const sign = r.sign === 'inverted' || r.sign === 'columns' ? r.sign : 'signed';
  const locale = r.locale === 'us' || r.locale === 'eu' ? r.locale : 'plain';
  return {
    delimiter: typeof r.delimiter === 'string' && DELIMITERS.some((d) => d.value === r.delimiter) ? r.delimiter : base.delimiter,
    has_header: r.has_header === undefined ? true : Boolean(r.has_header),
    skip_rows: typeof r.skip_rows === 'number' && r.skip_rows >= 0 ? Math.floor(r.skip_rows) : 0,
    date_format: typeof r.date_format === 'string' && DATE_FORMATS.some((d) => d.value === r.date_format) ? r.date_format : base.date_format,
    locale,
    sign,
    order: r.order === 'desc' ? 'desc' : 'asc',
    columns,
  };
}

/** What the server's CSV parser reads: only the columns the sign convention uses, and `order` only with a balance column. */
export function toMappingBody(m: CsvMapping): Record<string, unknown> {
  const columns: Record<string, string> = {};
  for (const f of COLUMN_FIELDS) {
    const v = m.columns[f];
    if (!v) continue;
    if (m.sign === 'columns' ? f === 'amount' : f === 'debit' || f === 'credit') continue;
    columns[f] = v;
  }
  const body: Record<string, unknown> = {
    delimiter: m.delimiter,
    has_header: m.has_header,
    skip_rows: m.skip_rows,
    date_format: m.date_format,
    locale: m.locale,
    sign: m.sign,
    columns,
  };
  if (columns.balance) body.order = m.order;
  return body;
}

/** Why a mapping cannot be sent yet, in the user's words; null when it can. The server still has the last word. */
export function mappingProblem(m: CsvMapping): string | null {
  if (!m.columns.date) return 'Choose the column that holds the date.';
  if (!m.columns.description) return 'Choose the column that holds the description.';
  if (m.sign === 'columns') {
    if (!m.columns.debit || !m.columns.credit) return 'Choose both the money out and the money in column.';
  } else if (!m.columns.amount) return 'Choose the column that holds the amount.';
  return null;
}

/* ------------------------------------------------------------------ reading the file's first lines (display only) */

export type FileKind = 'csv' | 'ofx' | 'camt';

/** What the file is, from its first bytes. The server detects the format again; this only decides whether columns need mapping. */
export function sniffKind(name: string, head: string): FileKind {
  const h = head.trimStart().slice(0, 2000);
  if (/OFXHEADER|<OFX>/i.test(h)) return 'ofx';
  if (h.startsWith('<') && /BkToCstmrStmt|<Document[\s>]/i.test(h)) return 'camt';
  if (/\.(ofx|qfx)$/i.test(name)) return 'ofx';
  return 'csv';
}

/** The most common candidate delimiter in the first non-empty line. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const n = first.split(d.value).length - 1;
    if (n > bestCount) {
      best = d.value;
      bestCount = n;
    }
  }
  return best;
}

/** Splits one CSV record, honouring double quotes. Enough for a preview; the server parses the file for real. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export interface CsvPeek {
  /** Header names (or "Column 1".. when the file has no header). */
  headers: string[];
  rows: string[][];
}

export function peekCsv(text: string, m: Pick<CsvMapping, 'delimiter' | 'has_header' | 'skip_rows'>, maxRows = 6): CsvPeek {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(m.skip_rows);
  const records = lines.slice(0, maxRows + 1).map((l) => splitCsvLine(l, m.delimiter));
  const width = Math.max(0, ...records.map((r) => r.length));
  if (m.has_header) {
    const head = records[0] ?? [];
    return { headers: Array.from({ length: width }, (_, i) => head[i] || `Column ${i + 1}`), rows: records.slice(1) };
  }
  return { headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), rows: records };
}

const GUESSES: Record<ColumnField, string[]> = {
  date: ['date', 'booking date', 'transaction date', 'posting date', 'buchungstag'],
  value_date: ['value date', 'valuta'],
  description: ['description', 'details', 'narrative', 'memo', 'text', 'particulars', 'transaction details'],
  reference: ['reference', 'ref', 'referenz', 'cheque number'],
  counterparty: ['counterparty', 'payee', 'payer', 'name', 'beneficiary'],
  amount: ['amount', 'value', 'betrag'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'paid out', 'soll', 'money out'],
  credit: ['credit', 'deposit', 'deposits', 'paid in', 'haben', 'money in'],
  balance: ['balance', 'saldo', 'running balance'],
};

/** A first guess from header names; the person confirms or changes every choice. With no header, nothing is guessed. */
export function guessColumns(headers: string[], hasHeader: boolean): Record<string, string> {
  if (!hasHeader) return {};
  const lower = headers.map((h) => h.trim().toLowerCase());
  const out: Record<string, string> = {};
  for (const f of COLUMN_FIELDS) {
    const i = lower.findIndex((h) => GUESSES[f].includes(h));
    if (i >= 0) out[f] = headers[i];
  }
  return out;
}

const NUM_US = /^[-(]?\d{1,3}(,\d{3})+(\.\d+)?\)?$/;
const NUM_EU = /^[-(]?\d{1,3}(\.\d{3})+(,\d+)?\)?$|^[-(]?\d+,\d{1,2}\)?$/;

/** Reads the number style from the cells of the money columns. Ambiguous or plain digits stay "plain". */
export function guessLocale(rows: string[][], headers: string[], cols: Record<string, string>): CsvLocale {
  const idx = ['amount', 'debit', 'credit', 'balance'].map((f) => headers.indexOf(cols[f] ?? '')).filter((i) => i >= 0);
  let us = 0;
  let eu = 0;
  for (const r of rows) for (const i of idx) {
    const c = (r[i] ?? '').trim();
    if (NUM_US.test(c)) us++;
    else if (NUM_EU.test(c)) eu++;
  }
  return eu > us ? 'eu' : us > 0 ? 'us' : 'plain';
}

/** Reads the date style from the date cells. "03/04/2026" cannot be told apart without a day above 12, so day first is offered. */
export function guessDateFormat(rows: string[][], headers: string[], cols: Record<string, string>): string {
  const i = headers.indexOf(cols.date ?? '');
  const cells = rows.map((r) => (r[i] ?? '').trim()).filter(Boolean);
  if (cells.length === 0) return 'Y-m-d';
  const all = (re: RegExp) => cells.every((c) => re.test(c));
  if (all(/^\d{4}-\d{2}-\d{2}$/)) return 'Y-m-d';
  if (all(/^\d{8}$/)) return 'Ymd';
  if (all(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) return 'd.m.Y';
  if (all(/^\d{1,2}-\d{1,2}-\d{4}$/)) return 'd-m-Y';
  if (all(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) return cells.some((c) => Number(c.split('/')[1]) > 12) ? 'm/d/Y' : 'd/m/Y';
  if (all(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) return cells.some((c) => Number(c.split('/')[1]) > 12) ? 'm/d/y' : 'd/m/y';
  return 'Y-m-d';
}

/** Debit and credit columns, no amount: the file uses two columns for the sign. */
export const guessSign = (cols: Record<string, string>): CsvSign => (!cols.amount && cols.debit && cols.credit ? 'columns' : 'signed');

/* ------------------------------------------------------------------ bank accounts */

export interface LiveBankAccount {
  id: string;
  name: string;
  account_id: string;
  currency: string;
  kind: 'bank' | 'cash' | 'card';
  bank_name: string;
  account_number_masked: string;
  iban: string;
  swift: string;
  import_mapping: CsvMapping | null;
  last_statement_balance: number | null;
  last_statement_date: string | null;
  book_balance: number | null;
  unreconciled_count: number | null;
  is_active: boolean;
  version: number;
  can: { update: boolean; import: boolean; reconcile: boolean };
}

export function toBankAccount(a: ApiBankAccount): LiveBankAccount {
  const can = a.can;
  return {
    id: a.id,
    name: a.name,
    account_id: a.account_id,
    currency: a.currency,
    kind: a.kind === 'cash' || a.kind === 'card' ? a.kind : 'bank',
    bank_name: a.bank_name ?? '',
    account_number_masked: a.account_number_masked ?? '',
    iban: a.iban ?? '',
    swift: a.swift ?? '',
    import_mapping: readSavedMapping(a.import_mapping),
    last_statement_balance: minorOrNull(a.last_statement_balance),
    last_statement_date: a.last_statement_date,
    book_balance: minorOrNull(a.book_balance),
    unreconciled_count: a.unreconciled_count,
    is_active: a.is_active,
    version: a.version,
    can: { update: can.update === true, import: can.import === true, reconcile: can.reconcile === true },
  };
}

export interface BankAccountForm {
  name: string;
  account_id: string;
  currency: string;
  kind: 'bank' | 'cash' | 'card';
  bank_name: string;
  account_number_masked: string;
  iban: string;
  swift: string;
  is_active: boolean;
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** PUT replaces the account, so an edit sends every field plus the version it was based on. */
export function toBankAccountRequest(f: BankAccountForm, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: f.name.trim(),
    account_id: f.account_id,
    currency: f.currency.trim().toUpperCase(),
    kind: f.kind,
    bank_name: orNull(f.bank_name),
    account_number_masked: orNull(f.account_number_masked),
    iban: orNull(f.iban),
    swift: orNull(f.swift),
    is_active: f.is_active,
  };
  if (version !== undefined) body.version = version;
  return body;
}

export const blankAccountForm = (currency: string): BankAccountForm => ({ name: '', account_id: '', currency, kind: 'bank', bank_name: '', account_number_masked: '', iban: '', swift: '', is_active: true });

export function toBankAccountForm(a: LiveBankAccount): BankAccountForm {
  return { name: a.name, account_id: a.account_id, currency: a.currency, kind: a.kind, bank_name: a.bank_name, account_number_masked: a.account_number_masked, iban: a.iban, swift: a.swift, is_active: a.is_active };
}

/* ------------------------------------------------------------------ statements and lines */

export interface LiveStatement {
  id: string;
  period_from: string | null;
  period_to: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  source: string;
  file_name: string;
  line_count: number;
  duplicates_skipped: number;
  warnings: string[];
  imported_at: string | null;
}

export function toStatement(s: ApiBankStatement): LiveStatement {
  return {
    id: s.id,
    period_from: s.period_from,
    period_to: s.period_to,
    opening_balance: minorOrNull(s.opening_balance),
    closing_balance: minorOrNull(s.closing_balance),
    source: s.source,
    file_name: s.file_name ?? '',
    line_count: s.line_count,
    duplicates_skipped: s.duplicates_skipped,
    warnings: s.warnings ?? [],
    imported_at: s.imported_at,
  };
}

export interface StatementImportResult {
  statement: LiveStatement | null;
  lines_imported: number;
  duplicate_lines_skipped: number;
  already_imported: boolean;
  warnings: string[];
}

export function toStatementImport(r: ApiStatementImport): StatementImportResult {
  return {
    statement: r.statement ? toStatement(r.statement) : null,
    lines_imported: r.lines_imported,
    duplicate_lines_skipped: r.duplicate_lines_skipped,
    already_imported: r.already_imported,
    warnings: r.warnings ?? [],
  };
}

/** Plain wording for the warnings the importer returns. Unknown ones are shown as the server wrote them. */
export function describeImportWarning(code: string): string {
  switch (code) {
    case 'statement_balance_mismatch':
      return 'The balances you gave do not agree with the lines in the file. Check them before you reconcile.';
    case 'balances_not_provided':
      return 'The file does not give both an opening and a closing balance, so its lines could not be checked against them.';
    case 'opening_balance_from_previous_statement':
      return 'The opening balance was taken from the previous statement.';
    default:
      return code.replace(/_/g, ' ');
  }
}

export type LineStatus = 'unmatched' | 'matched' | 'excluded';

export interface LiveBankLine {
  id: string;
  statement_id: string;
  bank_account_id: string;
  date: string;
  value_date: string | null;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  counterparty: string;
  status: LineStatus;
  match_id: string | null;
  pending_journal_id: string | null;
  excluded_reason: string;
  version: number;
  /** `exclude` (the reconcile ability) also covers putting an excluded line back; the server sends no separate hint. */
  can: { match: boolean; code: boolean; exclude: boolean };
}

export function toBankLine(l: ApiBankLine): LiveBankLine {
  const can = l.can;
  return {
    id: l.id,
    statement_id: l.statement_id,
    bank_account_id: l.bank_account_id,
    date: l.txn_date ?? '',
    value_date: l.value_date,
    amount: l.amount.amount,
    currency: l.amount.currency,
    description: l.description,
    reference: l.reference ?? '',
    counterparty: l.counterparty ?? '',
    status: l.status === 'matched' || l.status === 'excluded' ? l.status : 'unmatched',
    match_id: typeof l.match_id === 'string' ? l.match_id : null,
    pending_journal_id: typeof l.pending_journal_id === 'string' ? l.pending_journal_id : null,
    excluded_reason: l.excluded_reason ?? '',
    version: l.version,
    can: { match: can.match === true, code: can.code === true, exclude: can.exclude === true },
  };
}

/** The name to show for a line: the payee when the bank gave one, else the description. */
export const lineTitle = (l: Pick<LiveBankLine, 'counterparty' | 'description'>): string => l.counterparty || l.description;

/* ------------------------------------------------------------------ suggestions */

export interface BookSuggestion {
  journal_line_id: string;
  journal_id: string;
  number: string;
  date: string;
  amount: number;
  settlement_id: string | null;
  description: string;
  explanation: string[];
}

export interface RuleSuggestion {
  id: string;
  name: string;
  action: { account_id: string; tax_code_id: string | null; contact_id: string | null; memo: string | null; dimensions: Record<string, string> };
}

export interface LineSuggestions {
  matches: BookSuggestion[];
  rule: RuleSuggestion | null;
}

/** `explanation` codes from the matcher, in words. */
export function describeExplanation(code: string): string {
  switch (code) {
    case 'same_day':
      return 'Same day';
    case 'exact_amount':
      return 'Same amount';
    case 'reference_match':
      return 'Same reference';
    default:
      return code.replace(/_/g, ' ');
  }
}

export function toSuggestions(raw: { matches: Array<Record<string, unknown>>; rule: unknown }): LineSuggestions {
  const matches = (raw.matches ?? []).map((m) => ({
    journal_line_id: String(m.journal_line_id),
    journal_id: String(m.journal_id),
    number: String(m.number ?? ''),
    date: String(m.date ?? ''),
    amount: Number(m.amount),
    settlement_id: typeof m.settlement_id === 'string' ? m.settlement_id : null,
    description: String(m.description ?? ''),
    explanation: Array.isArray(m.explanation) ? m.explanation.map(String) : [],
  }));
  let rule: RuleSuggestion | null = null;
  const r = raw.rule;
  if (r && typeof r === 'object' && !Array.isArray(r) && typeof (r as Record<string, unknown>).id === 'string') {
    const o = r as Record<string, unknown>;
    const a = (o.action ?? {}) as Record<string, unknown>;
    rule = {
      id: String(o.id),
      name: String(o.name ?? ''),
      action: {
        account_id: String(a.account_id ?? ''),
        tax_code_id: typeof a.tax_code_id === 'string' ? a.tax_code_id : null,
        contact_id: typeof a.contact_id === 'string' ? a.contact_id : null,
        memo: typeof a.memo === 'string' ? a.memo : null,
        dimensions: a.dimensions && typeof a.dimensions === 'object' && !Array.isArray(a.dimensions) ? (a.dimensions as Record<string, string>) : {},
      },
    };
  }
  return { matches, rule };
}

/* ------------------------------------------------------------------ rules */

export interface LiveBankRule {
  id: string;
  bank_account_id: string | null;
  name: string;
  priority: number;
  is_active: boolean;
  direction: 'in' | 'out' | 'any';
  contains: string;
  min_amount: number | null;
  max_amount: number | null;
  account_id: string;
  tax_code_id: string | null;
  contact_id: string | null;
  dimensions: Record<string, string>;
  memo: string;
  times_applied: number;
  version: number;
  can: { update: boolean; delete: boolean };
}

export function toBankRule(r: ApiBankRule): LiveBankRule {
  const can = r.can;
  const dir = r.conditions.direction;
  return {
    id: r.id,
    bank_account_id: r.bank_account_id,
    name: r.name,
    priority: r.priority,
    is_active: r.is_active,
    direction: dir === 'in' || dir === 'out' ? dir : 'any',
    contains: r.conditions.contains,
    min_amount: r.conditions.min_amount ?? null,
    max_amount: r.conditions.max_amount ?? null,
    account_id: r.action.account_id,
    tax_code_id: r.action.tax_code_id ?? null,
    contact_id: r.action.contact_id ?? null,
    dimensions: r.action.dimensions && !Array.isArray(r.action.dimensions) ? r.action.dimensions : {},
    memo: r.action.memo ?? '',
    times_applied: r.times_applied,
    version: r.version,
    can: { update: can.update === true, delete: can.delete === true },
  };
}

export interface RuleForm {
  name: string;
  bank_account_id: string | null;
  is_active: boolean;
  direction: 'in' | 'out' | 'any';
  contains: string;
  min_amount: number | null;
  max_amount: number | null;
  account_id: string | null;
  tax_code_id: string | null;
  contact_id: string | null;
  dimensions: Record<string, string>;
  memo: string;
}

export const blankRule = (): RuleForm => ({ name: '', bank_account_id: null, is_active: true, direction: 'out', contains: '', min_amount: null, max_amount: null, account_id: null, tax_code_id: null, contact_id: null, dimensions: {}, memo: '' });

export const toRuleForm = (r: LiveBankRule): RuleForm => ({
  name: r.name,
  bank_account_id: r.bank_account_id,
  is_active: r.is_active,
  direction: r.direction,
  contains: r.contains,
  min_amount: r.min_amount,
  max_amount: r.max_amount,
  account_id: r.account_id,
  tax_code_id: r.tax_code_id,
  contact_id: r.contact_id,
  dimensions: r.dimensions,
  memo: r.memo,
});

export function toRuleRequest(f: RuleForm, version?: number, priority?: number): Record<string, unknown> {
  const contains = f.contains.trim();
  const body: Record<string, unknown> = {
    name: f.name.trim() || contains,
    bank_account_id: f.bank_account_id,
    is_active: f.is_active,
    conditions: { contains, direction: f.direction, min_amount: f.min_amount, max_amount: f.max_amount },
    action: {
      account_id: f.account_id,
      tax_code_id: f.tax_code_id,
      contact_id: f.contact_id,
      dimensions: Object.keys(f.dimensions).length ? f.dimensions : null,
      memo: orNull(f.memo),
    },
  };
  if (version !== undefined) body.version = version;
  if (priority !== undefined) body.priority = priority;
  return body;
}

/** Local checks that only spare a round trip; the server validates the same things. */
export function ruleProblem(f: RuleForm): string | null {
  if (!f.contains.trim()) return 'Enter the words a bank line must contain, for example "FUEL".';
  if (!f.account_id) return 'Choose the account this rule codes lines to.';
  if (f.min_amount !== null && f.max_amount !== null && f.min_amount > f.max_amount) return 'The smallest amount cannot be larger than the biggest amount.';
  return null;
}

/** New order after moving one rule up (-1) or down (+1); null when it cannot move. */
export function reorder(ids: string[], id: string, dir: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/* ------------------------------------------------------------------ reconciliation */

export interface ReconReport {
  as_of: string;
  currency: string;
  statement: { opening_balance: number | null; receipts: number; payments: number; closing_balance: number | null; line_count: number };
  book: { balance: number; opening_position: number; matched: number; unmatched: number; unmatched_count: number; matched_after_as_of: number };
  unmatched_statement: { total: number; count: number };
  excluded_statement: { total: number; count: number };
  adjusted_book_balance: number;
  difference: number | null;
  unmatched_book_items: Array<{ journal_line_id: string; journal_id: string; number: string; date: string; amount: number; description: string }>;
  unmatched_statement_items: Array<{ statement_line_id: string; date: string; amount: number; description: string; status: string }>;
}

const intOr = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isSafeInteger(v) ? v : d);
const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

/** The report is free-form JSON on the wire; read what the screen shows, defaulting what is absent. */
export function toReconReport(raw: Record<string, unknown> | null | undefined): ReconReport | null {
  if (!raw) return null;
  const st = (raw.statement ?? {}) as Record<string, unknown>;
  const bk = (raw.book ?? {}) as Record<string, unknown>;
  const us = (raw.unmatched_statement ?? {}) as Record<string, unknown>;
  const ex = (raw.excluded_statement ?? {}) as Record<string, unknown>;
  const items = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  return {
    as_of: String(raw.as_of ?? ''),
    currency: String(raw.currency ?? ''),
    statement: { opening_balance: intOrNull(st.opening_balance), receipts: intOr(st.receipts), payments: intOr(st.payments), closing_balance: intOrNull(st.closing_balance), line_count: intOr(st.line_count) },
    book: { balance: intOr(bk.balance), opening_position: intOr(bk.opening_position), matched: intOr(bk.matched), unmatched: intOr(bk.unmatched), unmatched_count: intOr(bk.unmatched_count), matched_after_as_of: intOr(bk.matched_after_as_of) },
    unmatched_statement: { total: intOr(us.total), count: intOr(us.count) },
    excluded_statement: { total: intOr(ex.total), count: intOr(ex.count) },
    adjusted_book_balance: intOr(raw.adjusted_book_balance),
    difference: intOrNull(raw.difference),
    unmatched_book_items: items(raw.unmatched_book_items).map((o) => ({
      journal_line_id: String(o.journal_line_id),
      journal_id: String(o.journal_id),
      number: String(o.number ?? ''),
      date: String(o.date ?? ''),
      amount: intOr(o.amount),
      description: String(o.description ?? ''),
    })),
    unmatched_statement_items: items(raw.unmatched_statement_items).map((o) => ({
      statement_line_id: String(o.statement_line_id),
      date: String(o.date ?? ''),
      amount: intOr(o.amount),
      description: String(o.description ?? ''),
      status: String(o.status ?? ''),
    })),
  };
}

export interface LiveReconciliation {
  id: string;
  bank_account_id: string;
  statement_id: string;
  as_of: string | null;
  status: 'in_progress' | 'finished';
  book_balance: number | null;
  statement_balance: number | null;
  difference: number | null;
  report: ReconReport | null;
  finished_at: string | null;
  reopen_reason: string;
  reopen_count: number;
  version: number;
  can: { finish: boolean; reopen: boolean };
}

export function toReconciliation(r: ApiReconciliation): LiveReconciliation {
  const can = r.can;
  const report = toReconReport(r.report as Record<string, unknown> | null);
  return {
    id: r.id,
    bank_account_id: r.bank_account_id,
    statement_id: r.statement_id,
    as_of: r.as_of,
    status: r.status === 'finished' ? 'finished' : 'in_progress',
    book_balance: r.book_balance,
    statement_balance: r.statement_balance,
    // The difference is the server's: its own column when finished, else the live report's.
    difference: r.difference ?? report?.difference ?? null,
    report,
    finished_at: r.finished_at,
    reopen_reason: r.reopen_reason ?? '',
    reopen_count: r.reopen_count,
    version: r.version,
    can: { finish: can.finish === true, reopen: can.reopen === true },
  };
}

/* ------------------------------------------------------------------ requests that code a line */

export interface CodeLineForm {
  kind: 'spend' | 'receive' | 'transfer';
  account_id: string | null;
  to_bank_account_id: string | null;
  tax_code_id: string | null;
  contact_id: string | null;
  dimensions: Record<string, string>;
  memo: string;
  rule_id: string | null;
}

export function toTransactionRequest(f: CodeLineForm): Record<string, unknown> {
  const body: Record<string, unknown> = { kind: f.kind };
  if (f.kind === 'transfer') body.to_bank_account_id = f.to_bank_account_id;
  else {
    body.account_id = f.account_id;
    body.tax_code_id = f.tax_code_id;
    body.contact_id = f.contact_id;
    body.dimensions = Object.keys(f.dimensions).length ? f.dimensions : null;
  }
  body.memo = orNull(f.memo);
  if (f.rule_id) body.rule_id = f.rule_id;
  return body;
}

/** What a coded line became: posted, or waiting for an approver (above the journal threshold). */
export function transactionOutcome(t: ApiBankTransaction): 'posted' | 'waiting' | 'other' {
  if (t.status === 'posted') return 'posted';
  if (t.status === 'pending_approval' || t.status === 'draft') return 'waiting';
  return 'other';
}

/* ------------------------------------------------------------------ errors in words, keyed on `code` */

/** Banking refusals by code; null leaves the wording to the shared `describeError`. */
export function describeBankingCode(code: string): string | null {
  switch (code) {
    case 'reconciliation_lines_unmatched':
      return 'Some statement lines are not in your books yet, so this cannot be finished. Match or record them first.';
    case 'reconciliation_difference':
      return 'The statement and your books still disagree, so this cannot be finished. Match or record the remaining lines first.';
    case 'reconciliation_exists':
      return 'This statement already has a reconciliation. Open it instead of starting another.';
    case 'reconciliation_finished':
      return 'This reconciliation is finished. Reopen it with a reason to change anything.';
    case 'reconciliation_not_finished':
      return 'This reconciliation is not finished, so there is nothing to reopen.';
    case 'later_reconciliation_finished':
      return 'A later reconciliation for this account is finished. Reopen that one first.';
    case 'journal_in_finished_reconciliation':
      return 'This entry is part of a finished reconciliation. Reopen the reconciliation first.';
    case 'reason_required':
      return 'Give a reason for reopening.';
    case 'approval_workflow_missing':
      return 'This amount is above the limit for posting without approval, and no approval workflow covers it. Ask an administrator to set one up.';
    case 'bank_line_already_matched':
    case 'line_already_matched':
      return 'This statement line is already matched. Refresh and try again.';
    case 'bank_line_pending_approval':
      return 'This line is already waiting for approval.';
    case 'book_line_already_matched':
      return 'That entry is already matched to another line. Refresh and try again.';
    case 'book_line_not_matchable':
    case 'book_line_not_on_account':
      return 'That entry cannot be matched to this account.';
    case 'match_empty':
      return 'Choose at least one entry from your books.';
    case 'match_amount_mismatch':
      return 'The two sides do not add up to exactly the same amount, so nothing was matched.';
    case 'payment_run_not_matchable':
      return 'That payment run is not posted, or none of its payments is still posted, so it cannot be matched.';
    case 'match_accounts_differ':
      return 'Everything in one match has to belong to the same bank account.';
    case 'line_not_open':
      return 'This line is no longer open.';
    case 'control_account_not_allowed':
      return 'Receivable, payable, tax, bank and cash accounts cannot be used to code a bank line. Pick an income or expense account.';
    case 'transfer_account_invalid':
      return 'Pick the other bank or cash account for this transfer.';
    case 'transfer_currency_mismatch':
      return 'Transfers between accounts in different currencies are not supported here.';
    case 'rule_not_applicable':
    case 'no_rule_matches':
      return 'No rule fits this line.';
    case 'rule_condition_invalid':
      return 'The rule needs words to look for and a direction.';
    case 'rule_order_invalid':
      return 'The rule order is out of date. Reload and try again.';
    case 'tax_code_invalid':
      return 'That tax code cannot be used here.';
    case 'bank_gl_account_invalid':
      return 'Choose a ledger account whose type is bank or cash.';
    case 'bank_gl_account_taken':
      return 'That ledger account already belongs to another bank account.';
    case 'bank_account_in_use':
      return 'This account already has statement lines, so its ledger account and currency cannot change.';
    case 'bank_account_name_taken':
      return 'Another bank account already has this name.';
    case 'bank_account_inactive':
      return 'This bank account is switched off.';
    case 'currency_not_allowed':
      return 'The chosen ledger account does not allow this currency.';
    case 'statement_currency_mismatch':
      return 'The statement is in a different currency from this bank account.';
    case 'statement_multiple_accounts':
      return 'The file covers more than one account. Import one account at a time.';
    case 'statement_empty':
      return 'The file has no statement lines.';
    case 'statement_too_large':
      return 'The file is too large. The limit is 2 MB or 5,000 lines.';
    case 'statement_format_unknown':
      return 'This file is not a CSV, OFX or CAMT.053 statement.';
    case 'statement_malformed':
      return 'The file could not be read as a statement.';
    case 'mapping_required':
      return 'A CSV file needs its columns mapped first.';
    case 'mapping_invalid':
      return 'The column choices do not fit this file.';
    default:
      return null;
  }
}

/** Bank-specific wording first (by `code`), then the server's own message. */
export function bankingErrorText(e: unknown, fallback: (e: unknown) => string): string {
  if (e instanceof ApiError) {
    const own = describeBankingCode(e.code);
    if (own) return own;
  }
  return fallback(e);
}

/** One line per file problem with its physical line number, from `violations` (statement import) or a bare message. */
export function importProblems(e: unknown): string[] {
  if (!(e instanceof ApiError)) return [];
  const out: string[] = [];
  for (const v of e.violations ?? []) out.push(v.line_no ? `Line ${v.line_no}: ${v.message}` : v.message);
  return out;
}

/* ------------------------------------------------------------------ typed amounts (digits only, no floats) */

export type AmountInput = { ok: true; minor: number | null } | { ok: false };

/**
 * "1,250.50", "-15", "(42.00)" -> integer minor units, by string handling only. Blank is `minor: null` (not given).
 * More decimals than the currency has, or anything that is not a plain number, is refused rather than rounded.
 */
export function parseAmountInput(text: string, minorDigits = 2): AmountInput {
  let s = text.trim();
  if (s === '') return { ok: true, minor: null };
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  } else if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d*)?$/.test(s) && !/^\.\d+$/.test(s)) return { ok: false };
  const [whole = '', frac = ''] = s.replace(/,/g, '').split('.');
  if (frac.length > minorDigits) return { ok: false };
  const digits = `${whole || '0'}${frac.padEnd(minorDigits, '0')}`;
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return { ok: false };
  return { ok: true, minor: negative ? -n : n };
}
