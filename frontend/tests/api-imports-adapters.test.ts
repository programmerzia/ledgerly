import { describe, it, expect } from 'vitest';
import { ApiError } from '@/api/errors';
import {
  applyBlocker, cleanOptions, importErrorText, initialColumns, isSettled, isWorking, missingUploadOptions, progressOf, rowProblems, stepFor, toMappingBody, unmappedRequired,
  type ApiImport, type ImportField,
} from '@/api/adapters/imports';

const fields: ImportField[] = [
  { key: 'code', label: 'Code', required: true, note: null },
  { key: 'name', label: 'Name', required: true, note: null },
  { key: 'email', label: 'Email', required: false, note: null },
];

describe('import steps and states', () => {
  it('puts each status on its wizard step', () => {
    expect(stepFor('uploaded')).toBe(2);
    expect(stepFor('mapped')).toBe(2);
    expect(stepFor('previewed')).toBe(3);
    for (const s of ['queued', 'applying', 'completed', 'failed']) expect(stepFor(s)).toBe(4);
  });
  it('polls only while the server is still working', () => {
    expect(isWorking('queued')).toBe(true);
    expect(isWorking('applying')).toBe(true);
    expect(isWorking('completed')).toBe(false);
    expect(isSettled('failed')).toBe(true);
    expect(isSettled('queued')).toBe(false);
  });
  it('reports progress from applied and failed rows', () => {
    expect(progressOf({ rows_valid: 0, rows_applied: 0, rows_failed: 0 })).toBeNull();
    expect(progressOf({ rows_valid: 8, rows_applied: 3, rows_failed: 1 })).toBe(50);
    expect(progressOf({ rows_valid: 2, rows_applied: 5, rows_failed: 0 })).toBe(100);
  });
});

describe('upload options', () => {
  it('asks for the date on opening balances and the account on bank lines', () => {
    expect(missingUploadOptions('opening_balances', {})).toEqual(['as_of']);
    expect(missingUploadOptions('opening_balances', { as_of: '2026-01-01' })).toEqual([]);
    expect(missingUploadOptions('bank_lines', {})).toEqual(['bank_account_id']);
    expect(missingUploadOptions('contacts', {})).toEqual([]);
  });
  it('drops blanks so an empty box never replaces a value', () => {
    expect(cleanOptions({ as_of: '', date_format: 'd/m/Y', x: null, y: undefined, n: 0 })).toEqual({ date_format: 'd/m/Y', n: 0 });
  });
});

describe('mapping', () => {
  const base = { columns: ['Cust ID', 'Company Name', 'Email'], mapping: null, suggested_mapping: null };
  it('starts from the suggestion and ignores columns that are not in the file', () => {
    const r = initialColumns({ ...base, suggested_mapping: { columns: { code: 'Cust ID', name: 'Gone' }, defaults: {} } });
    expect(r).toEqual({ columns: { code: 'Cust ID' }, from: 'guess' });
  });
  it('prefers what is already set', () => {
    const r = initialColumns({ ...base, mapping: { columns: { name: 'Company Name' }, defaults: {} }, suggested_mapping: { columns: { code: 'Cust ID' }, defaults: {} } });
    expect(r).toEqual({ columns: { name: 'Company Name' }, from: 'saved' });
  });
  it('says none when nothing fits', () => {
    expect(initialColumns(base)).toEqual({ columns: {}, from: 'none' });
  });
  it('lists required fields still without a column or default', () => {
    expect(unmappedRequired(fields, { code: 'A' }).map((f) => f.key)).toEqual(['name']);
    expect(unmappedRequired(fields, { code: 'A' }, { name: 'X' })).toEqual([]);
    expect(unmappedRequired(fields, { code: 'A', name: '' }).map((f) => f.key)).toEqual(['name']);
  });
  it('builds the request body without blank picks and carries the version', () => {
    expect(toMappingBody(3, { code: 'A', name: '', email: 'E' }, { x: ' ', y: 'USD' }, { date_format: 'Y-m-d', as_of: '' })).toEqual({
      version: 3, columns: { code: 'A', email: 'E' }, defaults: { y: 'USD' }, options: { date_format: 'Y-m-d' },
    });
  });
});

describe('row problems', () => {
  it('names the field by its label', () => {
    const row = { errors: [{ field: 'name', code: 'required', message: 'Name is required.' }, { field: null, code: 'x', message: 'Duplicate.' }] };
    expect(rowProblems(row, fields)).toEqual([{ field: 'Name', text: 'Name is required.' }, { field: null, text: 'Duplicate.' }]);
  });
});

describe('what stops apply', () => {
  const ok = { status: 'previewed', rows_valid: 3, rows_invalid: 1, errors: [], all_or_nothing: false, can: { apply: true } } as Pick<ApiImport, 'status' | 'rows_valid' | 'rows_invalid' | 'errors' | 'all_or_nothing' | 'can'>;
  it('allows skipping bad rows on a row-by-row kind', () => expect(applyBlocker(ok)).toBeNull());
  it('refuses an all-or-nothing import with errors', () => expect(applyBlocker({ ...ok, all_or_nothing: true })).toMatch(/whole or not at all/));
  it('refuses with nothing valid, before preview, and without permission', () => {
    expect(applyBlocker({ ...ok, rows_valid: 0 })).toMatch(/No row/);
    expect(applyBlocker({ ...ok, status: 'mapped' })).toMatch(/Check the data/);
    expect(applyBlocker({ ...ok, can: { apply: false } })).toMatch(/role/);
  });
});

describe('error text', () => {
  const api = (status: number, code: string, extra: object = {}) => new ApiError({ status, code, detail: 'server words', ...extra });
  it('uses our words for known codes and the server sentence otherwise', () => {
    expect(importErrorText(api(422, 'import_file_empty'))).toMatch(/no data rows/);
    expect(importErrorText(api(403, 'forbidden'))).toMatch(/role/);
    expect(importErrorText(api(422, 'something_new'))).toBe('server words');
    expect(importErrorText(api(413, 'payload_too_large'))).toMatch(/too large/);
  });
  it('shows the first field error of a validation failure', () => {
    expect(importErrorText(api(422, 'validation_failed', { errors: { 'options.as_of': ['The as of must be a date.'] } }))).toBe('The as of must be a date.');
  });
});
