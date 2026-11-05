/**
 * Data imports (plan 2.18, step 3c.1): kind copy, the mapping a person is shown and the body the server wants, and the words for
 * each refusal. Pure functions; the server checks every row, so nothing here re-derives a verdict.
 */
import { ApiError } from '../errors';
import { describeError } from '../messages';
import type { components } from '../schema';

export type ApiImport = components['schemas']['ImportResource'];
export type ApiImportRow = components['schemas']['ImportRowResource'];
export type ImportField = ApiImport['fields'][number];

export type ImportKindKey = 'contacts' | 'accounts' | 'opening_balances' | 'invoices' | 'bank_lines';

export interface KindInfo {
  title: string;
  desc: string;
  /** Where to look at what was created. Relative to /:co. */
  after: { label: string; to: string };
}

export const KIND_INFO: Record<ImportKindKey, KindInfo> = {
  contacts: { title: 'Customers and suppliers', desc: 'Codes, names, tax IDs, emails and payment terms', after: { label: 'View customers', to: 'customers' } },
  accounts: { title: 'Chart of accounts', desc: 'Account codes, names, types and parents', after: { label: 'View chart of accounts', to: 'accounts' } },
  opening_balances: { title: 'Opening balances', desc: 'Your starting balances, posted as one journal. Needs your signing PIN', after: { label: 'View journals', to: 'journals' } },
  invoices: { title: 'Sales invoices', desc: 'Invoices to customers; rows with the same reference are the lines of one invoice', after: { label: 'View invoices', to: 'invoices' } },
  bank_lines: { title: 'Bank statement lines', desc: 'Transactions to match against your books', after: { label: 'Go to bank accounts', to: 'banking' } },
};

export const KIND_ORDER: ImportKindKey[] = ['contacts', 'accounts', 'opening_balances', 'invoices', 'bank_lines'];

export const isKnownKind = (k: string): k is ImportKindKey => k in KIND_INFO;

export const NUMBER_LOCALES = [
  { value: 'plain', label: '1234.56' },
  { value: 'us', label: '1,234.56' },
  { value: 'eu', label: '1.234,56' },
];

export type ImportStatus = 'uploaded' | 'mapped' | 'previewed' | 'queued' | 'applying' | 'completed' | 'failed';

export const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded',
  mapped: 'Columns matched',
  previewed: 'Checked, not imported',
  queued: 'Waiting to import',
  applying: 'Importing',
  completed: 'Finished',
  failed: 'Not imported',
};

/** Still moving on the server: the screen polls until it settles. */
export const isWorking = (status: string): boolean => status === 'queued' || status === 'applying';
export const isSettled = (status: string): boolean => status === 'completed' || status === 'failed';

/** The wizard step (1 file, 2 columns, 3 check, 4 result) an import in this state belongs on. */
export function stepFor(status: string): 1 | 2 | 3 | 4 {
  if (status === 'previewed') return 3;
  if (isWorking(status) || isSettled(status)) return 4;
  return 2;
}

export type ImportOptions = Record<string, unknown>;

/** Option values worth sending: the server drops blanks too, but an empty string must not replace a real value. */
export function cleanOptions(options: ImportOptions): ImportOptions {
  return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** The fields a kind needs before the file can be uploaded (the server's `optionRules`, as the form asks for them). */
export function missingUploadOptions(kind: string, options: ImportOptions): string[] {
  if (kind === 'opening_balances') return options.as_of ? [] : ['as_of'];
  if (kind === 'bank_lines') return options.bank_account_id ? [] : ['bank_account_id'];
  return [];
}

export type ColumnPick = Record<string, string>;

/** Start from the server's suggestion, else what is already set, restricted to columns that exist in the file. */
export function initialColumns(imp: Pick<ApiImport, 'mapping' | 'suggested_mapping' | 'columns'>): { columns: ColumnPick; from: 'saved' | 'guess' | 'none' } {
  const exists = (c: string) => imp.columns.includes(c);
  const keep = (m: { columns: Record<string, string> } | null) => Object.fromEntries(Object.entries(m?.columns ?? {}).filter(([, c]) => exists(c)));
  const set = keep(imp.mapping);
  if (Object.keys(set).length) return { columns: set, from: 'saved' };
  const guess = keep(imp.suggested_mapping);
  return { columns: guess, from: Object.keys(guess).length ? 'guess' : 'none' };
}

/** Required fields that have neither a column nor a default constant. */
export function unmappedRequired(fields: ImportField[], columns: ColumnPick, defaults: Record<string, string> = {}): ImportField[] {
  return fields.filter((f) => f.required && !columns[f.key] && !defaults[f.key]);
}

/** Body of PUT /imports/{id}/mapping. Blank picks are left out; the same column may feed two fields (the server allows it). */
export function toMappingBody(version: number, columns: ColumnPick, defaults: Record<string, string>, options: ImportOptions) {
  return {
    version,
    columns: Object.fromEntries(Object.entries(columns).filter(([, c]) => c !== '')),
    defaults: Object.fromEntries(Object.entries(defaults).filter(([, v]) => v.trim() !== '')),
    options: cleanOptions(options),
  };
}

export interface RowProblem {
  field: string | null;
  text: string;
}

/** A row's problems, each with the field's label when the server named one. */
export function rowProblems(row: Pick<ApiImportRow, 'errors'>, fields: ImportField[]): RowProblem[] {
  const label = (key: string | null) => (key ? (fields.find((f) => f.key === key)?.label ?? key) : null);
  return row.errors.map((e) => ({ field: label(e.field), text: e.message }));
}

/** Short word for a row's state in the check table. */
export const ROW_STATUS_LABEL: Record<string, string> = {
  pending: 'Not checked',
  valid: 'Ready',
  invalid: 'Needs fixing',
  applied: 'Imported',
  failed: 'Refused',
};

const CODE_TEXT: Record<string, string> = {
  import_file_empty: 'The file has no data rows to import.',
  import_file_unreadable: 'That file could not be read. Use a .csv or .xlsx file saved as UTF-8.',
  import_purged: 'The file contents of this import were cleared. Upload the file again.',
  import_nothing_to_apply: 'No row is ready, so there is nothing to import.',
  import_has_errors: 'This import goes in whole or not at all. Fix every error shown below, then check again.',
  import_state_invalid: 'This import has moved on since you opened it. Reload it from the list.',
  opening_import_in_progress: 'Another opening balances import is already waiting to go in.',
  forbidden: 'Your role does not allow importing this kind of data.',
};

/** User text for a refusal from the imports endpoints. Falls back to the server's own sentence, which is plain English. */
export function importErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return 'That file is too large. Split it and import the parts one after the other.';
    const known = CODE_TEXT[e.code];
    if (known) return known;
    const first = e.errors ? Object.values(e.errors).flat()[0] : undefined;
    if (e.status === 422 && first) return first;
  }
  return describeError(e);
}

/** Whether apply is possible now, and if not, why in one sentence. */
export function applyBlocker(imp: Pick<ApiImport, 'status' | 'rows_valid' | 'rows_invalid' | 'errors' | 'all_or_nothing' | 'can'>): string | null {
  if (imp.status !== 'previewed') return 'Check the data first.';
  if (imp.rows_valid === 0) return 'No row is ready to import.';
  if (imp.all_or_nothing && (imp.rows_invalid > 0 || imp.errors.length > 0)) return 'This import goes in whole or not at all, so every error must be fixed first.';
  if (imp.can.apply === false) return 'Your role cannot import this kind of data.';
  return null;
}

/** Share of rows done, for the progress line. Null when nothing is known yet. */
export function progressOf(imp: Pick<ApiImport, 'rows_valid' | 'rows_applied' | 'rows_failed'>): number | null {
  if (imp.rows_valid <= 0) return null;
  return Math.min(100, Math.round(((imp.rows_applied + imp.rows_failed) / imp.rows_valid) * 100));
}
