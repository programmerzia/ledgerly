import { describe, it, expect } from 'vitest';
import { ApiError } from '@/api/errors';
import { HttpClient } from '@/api/http';
import {
  bankingErrorText,
  blankRule,
  describeBankingCode,
  detectDelimiter,
  emptyMapping,
  guessColumns,
  guessDateFormat,
  guessLocale,
  guessSign,
  importProblems,
  mappingProblem,
  parseAmountInput,
  peekCsv,
  readSavedMapping,
  reorder,
  ruleProblem,
  sniffKind,
  splitCsvLine,
  toBankAccount,
  toBankAccountRequest,
  toBankLine,
  toBankRule,
  toMappingBody,
  toReconciliation,
  toRuleRequest,
  toStatement,
  toStatementImport,
  toSuggestions,
  toTransactionRequest,
  transactionOutcome,
  type ApiBankAccount,
  type ApiBankLine,
  type ApiBankRule,
  type ApiReconciliation,
} from '@/api/adapters/banking';

const apiAccount = (over: Partial<ApiBankAccount> = {}): ApiBankAccount => ({
  id: 'b1', name: 'Operating', account_id: 'gl1', currency: 'USD', kind: 'bank', bank_name: 'First', account_number_masked: '••••8821', iban: null, swift: null,
  import_mapping: null, last_statement_balance: { amount: 1087500, currency: 'USD' }, last_statement_date: '2026-03-31', book_balance: { amount: 1096000, currency: 'USD' },
  unreconciled_count: 2, is_active: true, version: 3, can: { update: true, import: true, reconcile: false }, ...over,
});

describe('bank account adapter', () => {
  it('keeps the server money as integer minor units and the can hints', () => {
    const a = toBankAccount(apiAccount());
    expect(a.book_balance).toBe(1096000);
    expect(a.last_statement_balance).toBe(1087500);
    expect(a.can).toEqual({ update: true, import: true, reconcile: false });
    expect(a.iban).toBe('');
  });
  it('reads a missing statement balance as null, never as zero', () => {
    const a = toBankAccount(apiAccount({ last_statement_balance: { amount: null, currency: 'USD' }, book_balance: null }));
    expect(a.last_statement_balance).toBeNull();
    expect(a.book_balance).toBeNull();
  });
  it('refuses money that is not an integer', () => {
    expect(() => toBankAccount(apiAccount({ book_balance: { amount: 10.5, currency: 'USD' } }))).toThrow();
  });
  it('sends every field on a replace, with the version, and nulls for blanks', () => {
    const f = { name: ' Main ', account_id: 'gl1', currency: 'usd', kind: 'bank' as const, bank_name: '', account_number_masked: '8821', iban: '', swift: '', is_active: true };
    expect(toBankAccountRequest(f, 3)).toEqual({ name: 'Main', account_id: 'gl1', currency: 'USD', kind: 'bank', bank_name: null, account_number_masked: '8821', iban: null, swift: null, is_active: true, version: 3 });
    expect(toBankAccountRequest(f)).not.toHaveProperty('version');
  });
});

describe('csv mapping', () => {
  it('detects the separator and splits quoted cells', () => {
    expect(detectDelimiter('Konto;Buchungstag;Text\nDE01;02.03.2026;x')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(splitCsvLine('2026-03-02,"ACME, LTD","11,000.00"', ',')).toEqual(['2026-03-02', 'ACME, LTD', '11,000.00']);
  });
  it('peeks at the first rows with or without a header', () => {
    const text = 'Date,Description,Amount\n2026-03-02,A,1.00\n2026-03-03,B,2.00\n';
    const p = peekCsv(text, { delimiter: ',', has_header: true, skip_rows: 0 });
    expect(p.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(p.rows).toHaveLength(2);
    const q = peekCsv(text, { delimiter: ',', has_header: false, skip_rows: 1 });
    expect(q.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(q.rows[0][1]).toBe('A');
  });
  it('guesses columns from header names and the sign convention from debit and credit', () => {
    const cols = guessColumns(['Konto', 'Buchungstag', 'Text', 'Referenz', 'Soll', 'Haben'], true);
    expect(cols).toMatchObject({ date: 'Buchungstag', description: 'Text', reference: 'Referenz', debit: 'Soll', credit: 'Haben' });
    expect(guessSign(cols)).toBe('columns');
    expect(guessSign({ amount: 'Amount' })).toBe('signed');
    expect(guessColumns(['a', 'b'], false)).toEqual({});
  });
  it('guesses number and date style from the cells', () => {
    const h = ['Date', 'Amount', 'Balance'];
    expect(guessLocale([['x', '-15.00', '10,985.00']], h, { amount: 'Amount', balance: 'Balance' })).toBe('us');
    expect(guessLocale([['x', '11.000,00', '1,5']], h, { amount: 'Amount' })).toBe('eu');
    expect(guessLocale([['x', '15.00', '2']], h, { amount: 'Amount' })).toBe('plain');
    expect(guessDateFormat([['2026-03-02']], ['Date'], { date: 'Date' })).toBe('Y-m-d');
    expect(guessDateFormat([['02.03.2026']], ['Date'], { date: 'Date' })).toBe('d.m.Y');
    expect(guessDateFormat([['13/03/2026'], ['01/04/2026']], ['Date'], { date: 'Date' })).toBe('d/m/Y');
    expect(guessDateFormat([['03/13/2026']], ['Date'], { date: 'Date' })).toBe('m/d/Y');
  });
  it('sends only the columns the sign convention uses, and order only with a balance column', () => {
    const m = { ...emptyMapping(), columns: { date: 'Date', description: 'Text', amount: 'Amount', debit: 'Soll', balance: 'Saldo' } };
    expect(toMappingBody(m)).toMatchObject({ columns: { date: 'Date', description: 'Text', amount: 'Amount', balance: 'Saldo' }, sign: 'signed', order: 'asc' });
    const split = { ...m, sign: 'columns' as const, columns: { date: 'D', description: 'T', amount: 'A', debit: 'Soll', credit: 'Haben' } };
    const body = toMappingBody(split) as { columns: Record<string, string> };
    expect(body.columns).toEqual({ date: 'D', description: 'T', debit: 'Soll', credit: 'Haben' });
    expect(toMappingBody(split)).not.toHaveProperty('order');
  });
  it('says what is missing before sending', () => {
    expect(mappingProblem(emptyMapping())).toMatch(/date/i);
    expect(mappingProblem({ ...emptyMapping(), columns: { date: 'D', description: 'T' } })).toMatch(/amount/i);
    expect(mappingProblem({ ...emptyMapping(), sign: 'columns', columns: { date: 'D', description: 'T', debit: 'x' } })).toMatch(/both/i);
    expect(mappingProblem({ ...emptyMapping(), columns: { date: 'D', description: 'T', amount: 'A' } })).toBeNull();
  });
  it('reads a saved mapping and ignores what it does not know', () => {
    const saved = readSavedMapping({ sign: 'inverted', locale: 'eu', delimiter: ';', date_format: 'd.m.Y', has_header: true, skip_rows: 2, columns: { date: 'D', amount: 7, bogus: 'x' } });
    expect(saved).toMatchObject({ sign: 'inverted', locale: 'eu', delimiter: ';', skip_rows: 2, columns: { date: 'D', amount: '7' } });
    expect(readSavedMapping(null)).toBeNull();
    expect(readSavedMapping({ columns: {} })).toBeNull();
    expect(readSavedMapping({ delimiter: 'x', date_format: 'zz', columns: { date: 'D' } })).toMatchObject({ delimiter: ',', date_format: 'Y-m-d' });
  });
  it('tells the file kind from its first bytes', () => {
    expect(sniffKind('a.txt', 'OFXHEADER:100\n<OFX>')).toBe('ofx');
    expect(sniffKind('a.xml', '<?xml version="1.0"?><Document><BkToCstmrStmt>')).toBe('camt');
    expect(sniffKind('a.csv', 'Date,Amount')).toBe('csv');
    expect(sniffKind('x.qfx', 'garbage')).toBe('ofx');
  });
});

describe('typed amounts', () => {
  it('parses to integer minor units with strings only', () => {
    expect(parseAmountInput('10,875.00')).toEqual({ ok: true, minor: 1087500 });
    expect(parseAmountInput('0.07')).toEqual({ ok: true, minor: 7 });
    expect(parseAmountInput('1.1')).toEqual({ ok: true, minor: 110 });
    expect(parseAmountInput('-15')).toEqual({ ok: true, minor: -1500 });
    expect(parseAmountInput('(42.00)')).toEqual({ ok: true, minor: -4200 });
    expect(parseAmountInput('  ')).toEqual({ ok: true, minor: null });
    expect(parseAmountInput('19.99')).toEqual({ ok: true, minor: 1999 });
    expect(parseAmountInput('1', 0)).toEqual({ ok: true, minor: 1 });
  });
  it('refuses more decimals than the currency has, and anything that is not a number', () => {
    for (const bad of ['1.005', '12abc', '1,2,3', '--1', '$5', '1e3']) expect(parseAmountInput(bad)).toEqual({ ok: false });
    expect(parseAmountInput('1.5', 0)).toEqual({ ok: false });
  });
  it('does not lose precision on large amounts', () => {
    expect(parseAmountInput('90,071,992,547,409.92')).toEqual({ ok: false });
    expect(parseAmountInput('9,007,199,254,740.99')).toEqual({ ok: true, minor: 900719925474099 });
  });
});

const apiLine = (over: Partial<ApiBankLine> = {}): ApiBankLine => ({
  id: 'l1', statement_id: 's1', bank_account_id: 'b1', txn_date: '2026-03-02', value_date: null, amount: { amount: -1500, currency: 'USD' }, description: 'BANK FEE MARCH',
  reference: 'FEE-03', counterparty: null, balance_after: null, status: 'unmatched', match_id: null, pending_journal_id: null, version: 1, excluded_reason: null, can: { match: true, code: false }, ...over,
});

describe('statement lines, suggestions and rules', () => {
  it('maps a line, with blanks as empty text and the can hints kept', () => {
    const l = toBankLine(apiLine());
    expect(l).toMatchObject({ amount: -1500, currency: 'USD', counterparty: '', match_id: null, status: 'unmatched', can: { match: true, code: false, exclude: false } });
    expect(toBankLine(apiLine({ status: 'matched', match_id: 'm1', pending_journal_id: 'j1' }))).toMatchObject({ status: 'matched', match_id: 'm1', pending_journal_id: 'j1' });
  });
  it('keeps the exclusion reason and the exclude hint, which also covers putting back', () => {
    const l = toBankLine(apiLine({ status: 'excluded', excluded_reason: 'Duplicate of the March fee', can: { match: false, code: false, exclude: true } }));
    expect(l).toMatchObject({ status: 'excluded', excluded_reason: 'Duplicate of the March fee', can: { exclude: true } });
    expect(toBankLine(apiLine({ can: { match: true, code: true, exclude: true } })).can.exclude).toBe(true);
  });
  it('maps suggestions and the first matching rule', () => {
    const s = toSuggestions({
      matches: [{ journal_line_id: 'jl1', journal_id: 'j1', number: 'JV-1', date: '2026-03-02', amount: 1100000, settlement_id: 'se1', description: 'x', score: 100, explanation: ['exact_amount', 'same_day'] }],
      rule: { id: 'r1', name: 'Fees', action: { account_id: 'a1', tax_code_id: null, memo: 'm', dimensions: { d1: 'v1' } } },
    });
    expect(s.matches[0]).toMatchObject({ journal_line_id: 'jl1', amount: 1100000, settlement_id: 'se1', explanation: ['exact_amount', 'same_day'] });
    expect(s.rule).toMatchObject({ id: 'r1', action: { account_id: 'a1', tax_code_id: null, contact_id: null, dimensions: { d1: 'v1' } } });
    expect(toSuggestions({ matches: [], rule: [] }).rule).toBeNull();
    expect(toSuggestions({ matches: [], rule: null }).rule).toBeNull();
  });
  const apiRule = (): ApiBankRule => ({
    id: 'r1', bank_account_id: null, name: 'Fees', priority: 2, is_active: true, conditions: { contains: 'BANK FEE', direction: 'out', min_amount: null, max_amount: 5000 },
    action: { account_id: 'a1', tax_code_id: null, contact_id: null, dimensions: {}, memo: null }, times_applied: 4, version: 2, can: { update: true, delete: false },
  });
  it('maps a rule and builds the replace request with its version', () => {
    const r = toBankRule(apiRule());
    expect(r).toMatchObject({ direction: 'out', contains: 'BANK FEE', max_amount: 5000, min_amount: null, times_applied: 4, can: { update: true, delete: false } });
    const body = toRuleRequest({ ...blankRule(), name: '', contains: ' FEE ', account_id: 'a1', max_amount: 5000, dimensions: { d1: 'v1' } }, 2);
    expect(body).toMatchObject({ name: 'FEE', version: 2, conditions: { contains: 'FEE', direction: 'out', min_amount: null, max_amount: 5000 }, action: { account_id: 'a1', dimensions: { d1: 'v1' }, memo: null } });
  });
  it('checks a rule before sending and reorders by one place', () => {
    expect(ruleProblem(blankRule())).toMatch(/words/);
    expect(ruleProblem({ ...blankRule(), contains: 'x' })).toMatch(/account/);
    expect(ruleProblem({ ...blankRule(), contains: 'x', account_id: 'a', min_amount: 10, max_amount: 5 })).toMatch(/smallest/);
    expect(ruleProblem({ ...blankRule(), contains: 'x', account_id: 'a' })).toBeNull();
    expect(reorder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(reorder(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(reorder(['a', 'b', 'c'], 'a', -1)).toBeNull();
  });
});

describe('coding a line', () => {
  const base = { kind: 'spend' as const, account_id: 'a1', to_bank_account_id: null, tax_code_id: null, contact_id: null, dimensions: {}, memo: ' fuel ', rule_id: null };
  it('sends the coding fields for spend and receive, and only the other account for a transfer', () => {
    expect(toTransactionRequest(base)).toEqual({ kind: 'spend', account_id: 'a1', tax_code_id: null, contact_id: null, dimensions: null, memo: 'fuel' });
    expect(toTransactionRequest({ ...base, kind: 'transfer', to_bank_account_id: 'b2' })).toEqual({ kind: 'transfer', to_bank_account_id: 'b2', memo: 'fuel' });
  });
  it('reports whether the entry posted or waits for an approver', () => {
    const t = (status: string | null) => ({ status }) as never;
    expect(transactionOutcome(t('posted'))).toBe('posted');
    expect(transactionOutcome(t('pending_approval'))).toBe('waiting');
    expect(transactionOutcome(t('draft'))).toBe('waiting');
    expect(transactionOutcome(t('void'))).toBe('other');
  });
});

describe('statements and imports', () => {
  it('maps a statement with an unstated balance', () => {
    const s = toStatement({
      id: 's1', bank_account_id: 'b1', period_from: '2026-03-02', period_to: '2026-03-09', opening_balance: { amount: null, currency: 'USD' }, closing_balance: { amount: 1087500, currency: 'USD' },
      source: 'csv', file_name: 'march.csv', line_count: 3, duplicates_skipped: 0, warnings: ['balances_not_provided'], imported_by: null, imported_at: null,
    });
    expect(s).toMatchObject({ opening_balance: null, closing_balance: 1087500, warnings: ['balances_not_provided'] });
  });
  it('maps an import result, including a file that was already imported', () => {
    const r = toStatementImport({ statement: null, lines_imported: 0, duplicate_lines_skipped: 3, already_imported: true, warnings: [] });
    expect(r).toEqual({ statement: null, lines_imported: 0, duplicate_lines_skipped: 3, already_imported: true, warnings: [] });
  });
  it('lists file problems with their line numbers, from the violations', () => {
    const e = new ApiError({ status: 422, code: 'statement_malformed', detail: 'x', requestId: null, violations: [{ code: 'a', line_no: 3, message: "'12.345' has more than 2 decimals." }, { code: 'b', message: 'No lines.' }] });
    expect(importProblems(e)).toEqual(["Line 3: '12.345' has more than 2 decimals.", 'No lines.']);
    expect(importProblems(new Error('x'))).toEqual([]);
  });
});

describe('reconciliation', () => {
  const apiRec = (over: Partial<ApiReconciliation> = {}): ApiReconciliation => ({
    id: 'rc1', bank_account_id: 'b1', statement_id: 's1', as_of: '2026-03-09', status: 'in_progress', book_balance: null, statement_balance: null, difference: null,
    report: {
      as_of: '2026-03-09', currency: 'USD', statement: { opening_balance: 0, receipts: 1100000, payments: -12500, closing_balance: 1087500, line_count: 3 },
      book: { balance: 1096000, opening_position: 0, matched: 0, unmatched: 1096000, unmatched_count: 2, matched_after_as_of: 0 }, unmatched_statement: { total: 1087500, count: 3 },
      adjusted_book_balance: 1087500, difference: 110,
      unmatched_book_items: [{ journal_line_id: 'jl1', journal_id: 'j1', number: 'JV-1', date: '2026-03-02', amount: 1100000, description: 'x' }],
      unmatched_statement_items: [{ statement_line_id: 'l1', date: '2026-03-02', amount: 1100000, description: 'ACME', status: 'unmatched' }],
    },
    finished_by: null, finished_at: null, reopened_by: null, reopened_at: null, reopen_reason: null, reopen_count: 0, version: 4, can: { finish: true, reopen: false }, ...over,
  });
  it('takes the difference from the server report and never computes one', () => {
    const r = toReconciliation(apiRec());
    expect(r.difference).toBe(110);
    expect(r.report?.adjusted_book_balance).toBe(1087500);
    expect(r.report?.unmatched_book_items[0]).toMatchObject({ journal_line_id: 'jl1', amount: 1100000 });
    expect(r.can).toEqual({ finish: true, reopen: false });
  });
  it('prefers the stored difference of a finished reconciliation and keeps zero as zero', () => {
    const r = toReconciliation(apiRec({ status: 'finished', difference: 0 }));
    expect(r.status).toBe('finished');
    expect(r.difference).toBe(0);
  });
  it('has no difference when the statement has no closing balance', () => {
    const r = toReconciliation(apiRec({ report: { as_of: '2026-03-09', difference: null, statement: { closing_balance: null } } }));
    expect(r.difference).toBeNull();
  });
  it('reads the excluded lines count and total from the report, zero when absent', () => {
    const withExcluded = toReconciliation(apiRec({ report: { ...(apiRec().report as Record<string, unknown>), excluded_statement: { total: -2500, count: 1 } } }));
    expect(withExcluded.report?.excluded_statement).toEqual({ total: -2500, count: 1 });
    expect(toReconciliation(apiRec()).report?.excluded_statement).toEqual({ total: 0, count: 0 });
  });
  it('reads a missing report as none', () => {
    expect(toReconciliation(apiRec({ report: null })).report).toBeNull();
  });
});

describe('error wording is keyed on the code', () => {
  it('has plain text for the banking refusals and leaves the rest to the shared text', () => {
    expect(describeBankingCode('reconciliation_difference')).toMatch(/disagree/);
    expect(describeBankingCode('reconciliation_lines_unmatched')).toMatch(/not in your books/);
    expect(describeBankingCode('approval_workflow_missing')).toMatch(/approval workflow/);
    expect(describeBankingCode('journal_in_finished_reconciliation')).toMatch(/Reopen/);
    expect(describeBankingCode('something_new')).toBeNull();
    const e = new ApiError({ status: 422, code: 'reconciliation_exists', detail: 'This statement already has a reconciliation.', requestId: null });
    expect(bankingErrorText(e, () => 'fallback')).toMatch(/already has a reconciliation/);
    expect(bankingErrorText(new ApiError({ status: 500, code: 'x', detail: '', requestId: null }), () => 'fallback')).toBe('fallback');
  });
});

describe('multipart upload through the http client', () => {
  it('sends FormData as is, with no JSON content type, and the same Idempotency-Key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new HttpClient({
      baseUrl: '',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }) as unknown as typeof fetch,
      readCookie: () => 'tok',
    });
    const form = new FormData();
    form.append('file', new Blob(['a,b']), 'x.csv');
    await client.send('POST', '/v1/companies/c1/bank-accounts/b1/statements', form);
    const post = calls.find((c) => c.init.method === 'POST');
    expect(post?.init.body).toBe(form);
    const headers = post?.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['Idempotency-Key']).toBeTruthy();
    expect(headers['X-XSRF-TOKEN']).toBe('tok');
  });
});
