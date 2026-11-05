/**
 * Close pack, live (step 3c.3). Every figure on the pack is one the server already produced (close checks, trial balance,
 * aging, bank accounts); this file only picks the right row and says whether two server figures agree. The one subtraction
 * it does is a difference of two integer minor-unit figures in the same currency, shown beside the two figures it came from.
 */
import type { AgingView, TrialBalanceRow, TrialBalanceView } from './report';
import type { LiveBankAccount } from './banking';
import type { LiveCloseCheck, LiveFiscalYear, LivePeriod } from './fiscal';

/** The balance of one account in the trial balance as debit less credit, or null when the account has no row (nothing posted). */
export function balanceInTrialBalance(rows: TrialBalanceRow[], accountId: string | null | undefined): number | null {
  if (!accountId) return null;
  const hit = rows.find((r) => r.account.id === accountId);
  return hit ? hit.debit - hit.credit : 0;
}

export type Tie = {
  /** What the sub-ledger (aging) says the control account holds: receivables as a debit, payables as a credit balance. */
  subledger: number;
  /** What the trial balance holds for the control account, in the same sign. */
  ledger: number;
  difference: number;
  agrees: boolean;
};

/**
 * Receivables: aging `net` (open less credits) against the control account's debit balance. Payables: the same against its
 * credit balance. Returns null when the control account is not set or the report currency differs from the other.
 */
export function controlTie(aging: Pick<AgingView, 'totals' | 'currency'>, tb: Pick<TrialBalanceView, 'rows' | 'currency'>, controlAccountId: string | null | undefined, receivable: boolean): Tie | null {
  if (!controlAccountId || aging.currency !== tb.currency) return null;
  const debitLess = balanceInTrialBalance(tb.rows, controlAccountId);
  if (debitLess === null) return null;
  const ledger = receivable ? debitLess : -debitLess;
  const subledger = aging.totals.net;
  return { subledger, ledger, difference: ledger - subledger, agrees: ledger === subledger };
}

export type BankRow = {
  id: string;
  name: string;
  currency: string;
  statementBalance: number | null;
  statementDate: string | null;
  /** Debit less credit of the bank's ledger account at period end, only for an account in the base currency. */
  booksAtPeriodEnd: number | null;
  /** Only when the statement ends on the period's last day and both figures are in the same currency. */
  difference: number | null;
  unreconciled: number | null;
  note: string | null;
};

/** One row per active bank or cash account. No comparison is made where the two figures are not for the same day and currency. */
export function bankRows(accounts: LiveBankAccount[], tb: Pick<TrialBalanceView, 'rows' | 'currency'> | undefined, periodEnd: string): BankRow[] {
  return accounts
    .filter((b) => b.is_active)
    .map((b) => {
      const sameCurrency = tb !== undefined && b.currency === tb.currency;
      const books = sameCurrency ? balanceInTrialBalance(tb.rows, b.account_id) : null;
      const sameDay = b.last_statement_date === periodEnd;
      const comparable = sameDay && books !== null && b.last_statement_balance !== null;
      let note: string | null = null;
      if (b.last_statement_balance === null) note = 'No statement imported yet.';
      else if (!sameCurrency) note = 'Foreign-currency account: the books figure at period end is not given in its own currency here.';
      else if (!sameDay) note = `Latest statement ends ${b.last_statement_date ?? 'on an unknown date'}, not on the last day of the period, so the two figures are not compared.`;
      return {
        id: b.id,
        name: b.name,
        currency: b.currency,
        statementBalance: b.last_statement_balance,
        statementDate: b.last_statement_date,
        booksAtPeriodEnd: books,
        difference: comparable ? (b.last_statement_balance as number) - (books as number) : null,
        unreconciled: b.unreconciled_count,
        note,
      };
    });
}

/** Every period of every year, in calendar order, for the pack's period picker. */
export function allPeriods(years: LiveFiscalYear[]): LivePeriod[] {
  return years.flatMap((y) => y.periods).filter((p) => p.starts_on && p.ends_on).sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.number - b.number);
}

/** The period the pack opens on: the one in the address, else the first one not yet closed, else the latest. */
export function pickPeriod(periods: LivePeriod[], wanted: string | null): LivePeriod | undefined {
  const asked = wanted ? periods.find((p) => p.id === wanted) : undefined;
  if (asked) return asked;
  const real = periods.filter((p) => p.kind !== 'adjustment');
  return real.find((p) => p.status === 'open' || p.status === 'soft_closed') ?? real[real.length - 1] ?? periods[0];
}

/** A cell safe to open in a spreadsheet: quoted when needed, and text that would run as a formula gets a leading apostrophe. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The checklist as CSV: period, then one line per check with its verdict and the server's message. */
export function checklistCsv(period: Pick<LivePeriod, 'name' | 'starts_on' | 'ends_on' | 'status'>, checks: LiveCloseCheck[]): string {
  const rows: string[][] = [
    ['Period', period.name],
    ['From', period.starts_on],
    ['To', period.ends_on],
    ['Period status', period.status],
    [],
    ['Check', 'Result', 'Detail'],
    ...checks.map((c) => [c.title, c.status === 'pass' ? 'Passed' : 'Not passed', c.detail]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const checklistFilename = (periodName: string): string => `close-checklist-${periodName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`;
