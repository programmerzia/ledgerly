import { describe, it, expect } from 'vitest';
import { allPeriods, balanceInTrialBalance, bankRows, checklistCsv, checklistFilename, controlTie, csvCell, pickPeriod } from '@/api/adapters/closePack';
import type { LiveBankAccount } from '@/api/adapters/banking';
import type { LivePeriod } from '@/api/adapters/fiscal';
import type { TrialBalanceRow } from '@/api/adapters/report';

const acct = (id: string) => ({ id, code: id, name: id, subtype: null, accountType: null });
const row = (id: string, debit: number, credit: number): TrialBalanceRow => ({ account: acct(id), debit, credit });
const tb = { currency: 'USD', rows: [row('ar', 125000, 0), row('ap', 0, 80000), row('bank', 150000, 0)] };
const aging = (net: number, currency = 'USD') => ({ currency, totals: { net } }) as never;

describe('trial balance lookups', () => {
  it('is debit less credit, zero when the account has no row, null with no account', () => {
    expect(balanceInTrialBalance(tb.rows, 'ap')).toBe(-80000);
    expect(balanceInTrialBalance(tb.rows, 'ar')).toBe(125000);
    expect(balanceInTrialBalance(tb.rows, 'other')).toBe(0);
    expect(balanceInTrialBalance(tb.rows, null)).toBeNull();
  });
});

describe('sub-ledger against control account', () => {
  it('agrees when aging net equals the control account balance', () => {
    expect(controlTie(aging(125000), tb, 'ar', true)).toEqual({ subledger: 125000, ledger: 125000, difference: 0, agrees: true });
  });
  it('reads payables as a credit balance', () => {
    expect(controlTie(aging(80000), tb, 'ap', false)).toMatchObject({ ledger: 80000, agrees: true });
  });
  it('reports the difference in integer minor units when they disagree', () => {
    expect(controlTie(aging(124999), tb, 'ar', true)).toMatchObject({ difference: 1, agrees: false });
  });
  it('compares nothing without a control account or across currencies', () => {
    expect(controlTie(aging(1), tb, null, true)).toBeNull();
    expect(controlTie(aging(1, 'EUR'), tb, 'ar', true)).toBeNull();
  });
});

const bank = (over: Partial<LiveBankAccount>): LiveBankAccount => ({
  id: 'b1', name: 'Main', account_id: 'bank', currency: 'USD', kind: 'bank', bank_name: '', account_number_masked: '', iban: '', swift: '', import_mapping: null,
  last_statement_balance: 149000, last_statement_date: '2026-10-31', book_balance: 0, unreconciled_count: 0, is_active: true, version: 1, can: { update: true, import: true, reconcile: true }, ...over,
});

describe('bank rows', () => {
  it('compares the statement with the books only for the same day and currency', () => {
    expect(bankRows([bank({})], tb, '2026-10-31')[0]).toMatchObject({ statementBalance: 149000, booksAtPeriodEnd: 150000, difference: -1000, note: null });
  });
  it('does not compare a statement that ends on another day', () => {
    const r = bankRows([bank({ last_statement_date: '2026-10-15' })], tb, '2026-10-31')[0];
    expect(r.difference).toBeNull();
    expect(r.note).toMatch(/not on the last day/);
  });
  it('does not invent a books figure for a foreign-currency account', () => {
    const r = bankRows([bank({ currency: 'EUR' })], tb, '2026-10-31')[0];
    expect(r.booksAtPeriodEnd).toBeNull();
    expect(r.difference).toBeNull();
  });
  it('says so when no statement was imported, and skips inactive accounts', () => {
    const rows = bankRows([bank({ last_statement_balance: null, last_statement_date: null }), bank({ id: 'b2', is_active: false })], tb, '2026-10-31');
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toMatch(/No statement/);
  });
});

const period = (id: string, number: number, start: string, status: LivePeriod['status'], kind = 'regular'): LivePeriod => ({
  id, fiscal_year_id: 'y', number, name: id, kind, starts_on: start, ends_on: start, status, soft_closed_at: null, closed_at: null, reopened_count: 0, reopen_request: null,
  can: { soft_close: false, close: false, request_reopen: false },
});

describe('period choice', () => {
  const list = allPeriods([{ id: 'y', name: 'FY', starts_on: '', ends_on: '', status: 'open', can: { year_end: false, lock: false }, periods: [period('nov', 11, '2026-11-01', 'open'), period('oct', 10, '2026-10-01', 'closed'), period('adj', 13, '2026-12-31', 'open', 'adjustment')] }]);
  it('lists periods in calendar order', () => expect(list.map((p) => p.id)).toEqual(['oct', 'nov', 'adj']));
  it('opens the one asked for, else the first not yet closed, never the adjustment period by default', () => {
    expect(pickPeriod(list, 'oct')?.id).toBe('oct');
    expect(pickPeriod(list, 'nope')?.id).toBe('nov');
    expect(pickPeriod(list, null)?.id).toBe('nov');
    expect(pickPeriod([], null)).toBeUndefined();
  });
});

describe('checklist export', () => {
  it('quotes commas and quotes, and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('plain')).toBe('plain');
  });
  it('writes the period, then one line per check with the server message', () => {
    const csv = checklistCsv({ name: 'Oct 2026', starts_on: '2026-10-01', ends_on: '2026-10-31', status: 'open' }, [
      { id: 'DRAFTS', check_code: 'DRAFTS', title: 'No unposted drafts', detail: '2 drafts, still open', status: 'fail' },
      { id: 'BANK_REC', check_code: 'BANK_REC', title: 'Bank accounts reconciled', detail: 'All reconciled', status: 'pass' },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'Period,Oct 2026', 'From,2026-10-01', 'To,2026-10-31', 'Period status,open', '', 'Check,Result,Detail',
      'No unposted drafts,Not passed,"2 drafts, still open"', 'Bank accounts reconciled,Passed,All reconciled', '',
    ]);
  });
  it('names the file after the period', () => expect(checklistFilename('Oct 2026')).toBe('close-checklist-oct-2026.csv'));
});
