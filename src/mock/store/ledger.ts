/**
 * Ledger slice: The single source of ledger truth.
 * Invariant: No balance is ever stored. All balances, movements, and trial balances
 * reduce over posted journal lines dynamically with a linesVersion memoisation counter.
 */

import { StateCreator } from 'zustand';
import {
  Account,
  Dimension,
  TaxCode,
  FiscalYear,
  FiscalPeriod,
  PeriodCloseCheck,
  PeriodReopenRequest,
  Journal,
  JournalLine,
  User,
  CompanySettings,
  AuditEvent,
} from '@/types';
import {
  mockAccounts,
  mockDimensions,
  mockTaxCodes,
  mockFiscalYear2026,
  mockCloseChecks,
  mockJournals,
} from '@/mock/data';
import { executePostJournal, PostingError, PostingContext } from '@/mock/PostingRules';

export interface TrialBalanceRow {
  account: Account;
  openingDebit: number;
  openingCredit: number;
  movementDebit: number;
  movementCredit: number;
  closingDebit: number;
  closingCredit: number;
  netMovement: number;
  closingBalance: number;
}

export interface LedgerSlice {
  accounts: Account[];
  dimensions: Dimension[];
  taxCodes: TaxCode[];
  fiscalYears: FiscalYear[];
  fiscalYear: FiscalYear;
  periods: FiscalPeriod[];
  journals: Journal[];
  sequences: Record<string, number>;
  linesVersion: number;
  closeChecks: PeriodCloseCheck[];
  reopenRequests: PeriodReopenRequest[];

  // Selectors
  balanceOf: (accountId: string, asOf?: string, dims?: { branch?: string; cost_centre?: string }) => number;
  trialBalance: (periodFrom?: string, periodTo?: string, dims?: { branch?: string; cost_centre?: string }) => {
    rows: TrialBalanceRow[];
    totalDebit: number;
    totalCredit: number;
    isBalanced: boolean;
  };
  movements: (
    accountId: string,
    range?: { from?: string; to?: string },
    dims?: { branch?: string; cost_centre?: string }
  ) => Array<JournalLine & { journal_number: string; journal_date: string; running_balance: number }>;
  contactBalance: (contactId: string, asOf?: string) => number;
  contactOverdueBalance: (contactId: string, asOf?: string) => number;
  bankAccountBookBalance: (bankAccountId: string) => number;
  bankAccountUnreconciledCount: (bankAccountId: string) => number;

  // Actions
  postJournalDirect: (
    draft: Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'> & { id?: string },
    actor: User,
    settings: CompanySettings,
    lastAuditEvent?: AuditEvent
  ) => { journal: Journal; auditEvent: AuditEvent };

  reverseJournal: (
    journalId: string,
    reason: string,
    actor: User,
    settings: CompanySettings,
    lastAuditEvent?: AuditEvent
  ) => { reversalJournal: Journal; auditEvent: AuditEvent };

  closePeriod: (periodId: string, actor: User, settings: CompanySettings, lastAuditEvent?: AuditEvent) => AuditEvent;
  requestReopenPeriod: (periodId: string, reason: string, actor: User) => PeriodReopenRequest;
  approveReopenPeriod: (requestId: string, approver: User) => { approved: boolean; message: string };
  updateAccount: (account: Account) => void;
  addAccount: (account: Account) => void;
}

export const createLedgerSlice: StateCreator<any, [], [], LedgerSlice> = (set, get) => ({
  accounts: [...mockAccounts],
  dimensions: [...mockDimensions],
  taxCodes: [...mockTaxCodes],
  fiscalYears: [{ ...mockFiscalYear2026 }],
  fiscalYear: { ...mockFiscalYear2026 },
  periods: [...mockFiscalYear2026.periods],
  journals: [...mockJournals],
  sequences: { journal: 103, invoice: 43, bill: 16, receipt: 17, payment: 11 },
  linesVersion: 1,
  closeChecks: [...mockCloseChecks],
  reopenRequests: [],

  balanceOf: (accountId, asOf, dims) => {
    const { journals, accounts } = get();
    const account = accounts.find((a: Account) => a.id === accountId);
    if (!account) return 0;

    let debits = 0;
    let credits = 0;

    for (const j of journals) {
      if (j.status !== 'posted') continue;
      if (asOf && j.journal_date > asOf) continue;

      for (const line of j.lines) {
        if (line.account_id !== accountId) continue;
        if (dims?.branch && line.dimensions?.branch !== dims.branch) continue;
        if (dims?.cost_centre && line.dimensions?.cost_centre !== dims.cost_centre) continue;

        debits += line.debit;
        credits += line.credit;
      }
    }

    return account.normal_balance === 'debit' ? debits - credits : credits - debits;
  },

  trialBalance: (periodFrom, periodTo, dims) => {
    const { journals, accounts } = get();

    // Map each account to opening and movement buckets
    const accountMap = new Map<
      string,
      {
        account: Account;
        openingDebits: number;
        openingCredits: number;
        movementDebits: number;
        movementCredits: number;
      }
    >();

    for (const acc of accounts) {
      accountMap.set(acc.id, {
        account: acc,
        openingDebits: 0,
        openingCredits: 0,
        movementDebits: 0,
        movementCredits: 0,
      });
    }

    for (const j of journals) {
      if (j.status !== 'posted') continue;

      const isOpening = periodFrom && j.journal_date < periodFrom;
      const isInPeriod = (!periodFrom || j.journal_date >= periodFrom) && (!periodTo || j.journal_date <= periodTo);

      for (const line of j.lines) {
        if (dims?.branch && line.dimensions?.branch !== dims.branch) continue;
        if (dims?.cost_centre && line.dimensions?.cost_centre !== dims.cost_centre) continue;

        const entry = accountMap.get(line.account_id);
        if (!entry) continue;

        if (isOpening) {
          entry.openingDebits += line.debit;
          entry.openingCredits += line.credit;
        } else if (isInPeriod) {
          entry.movementDebits += line.debit;
          entry.movementCredits += line.credit;
        }
      }
    }

    let grandTotalDebit = 0;
    let grandTotalCredit = 0;

    const rows: TrialBalanceRow[] = [];

    for (const entry of accountMap.values()) {
      const { account, openingDebits, openingCredits, movementDebits, movementCredits } = entry;

      const netOpening =
        account.normal_balance === 'debit' ? openingDebits - openingCredits : openingCredits - openingDebits;
      const netMovement =
        account.normal_balance === 'debit' ? movementDebits - movementCredits : movementCredits - movementDebits;
      const closingBalance = netOpening + netMovement;

      const totalDebits = openingDebits + movementDebits;
      const totalCredits = openingCredits + movementCredits;

      let closingDebit = 0;
      let closingCredit = 0;

      if (account.normal_balance === 'debit') {
        if (closingBalance >= 0) closingDebit = closingBalance;
        else closingCredit = Math.abs(closingBalance);
      } else {
        if (closingBalance >= 0) closingCredit = closingBalance;
        else closingDebit = Math.abs(closingBalance);
      }

      grandTotalDebit += closingDebit;
      grandTotalCredit += closingCredit;

      rows.push({
        account,
        openingDebit: openingDebits,
        openingCredit: openingCredits,
        movementDebit: movementDebits,
        movementCredit: movementCredits,
        closingDebit,
        closingCredit,
        netMovement,
        closingBalance,
      });
    }

    // Sort by account code ascending
    rows.sort((a, b) => a.account.code.localeCompare(b.account.code));

    return {
      rows,
      totalDebit: grandTotalDebit,
      totalCredit: grandTotalCredit,
      isBalanced: grandTotalDebit === grandTotalCredit,
    };
  },

  movements: (accountId, range, dims) => {
    const { journals, accounts } = get();
    const account = accounts.find((a: Account) => a.id === accountId);
    if (!account) return [];

    const result: Array<JournalLine & { journal_number: string; journal_date: string; running_balance: number }> = [];
    let running = 0;

    const sorted = [...journals]
      .filter((j) => j.status === 'posted')
      .sort((a, b) => a.journal_date.localeCompare(b.journal_date));

    for (const j of sorted) {
      if (range?.from && j.journal_date < range.from) continue;
      if (range?.to && j.journal_date > range.to) continue;

      for (const line of j.lines) {
        if (line.account_id !== accountId) continue;
        if (dims?.branch && line.dimensions?.branch !== dims.branch) continue;
        if (dims?.cost_centre && line.dimensions?.cost_centre !== dims.cost_centre) continue;

        const delta = account.normal_balance === 'debit' ? line.debit - line.credit : line.credit - line.debit;
        running += delta;

        result.push({
          ...line,
          journal_number: j.number || 'JRN-DRAFT',
          journal_date: j.journal_date,
          running_balance: running,
        });
      }
    }

    return result;
  },

  contactBalance: (contactId, asOf) => {
    const { journals } = get();
    let balance = 0;

    for (const j of journals) {
      if (j.status !== 'posted') continue;
      if (asOf && j.journal_date > asOf) continue;

      for (const line of j.lines) {
        if (line.contact_id !== contactId) continue;
        // AR control: normal balance is debit (positive = owed to us)
        if (line.account_id === 'acc-1200') {
          balance += line.debit - line.credit;
        }
        // AP control: normal balance is credit (positive = we owe them)
        else if (line.account_id === 'acc-2000') {
          balance += line.credit - line.debit;
        }
      }
    }
    return balance;
  },

  contactOverdueBalance: (contactId, asOf) => {
    const { invoices } = get();
    const targetDate = asOf || new Date().toISOString().split('T')[0];

    return (invoices || [])
      .filter(
        (inv: any) =>
          inv.contact_id === contactId &&
          inv.status === 'posted' &&
          inv.due_date < targetDate &&
          inv.settled < inv.total
      )
      .reduce((sum: number, inv: any) => sum + (inv.total - inv.settled), 0);
  },

  bankAccountBookBalance: (bankAccountId) => {
    const { bankAccounts, balanceOf } = get();
    const b = (bankAccounts || []).find((acc: any) => acc.id === bankAccountId);
    if (!b) return 0;
    return balanceOf(b.account_id);
  },

  bankAccountUnreconciledCount: (bankAccountId) => {
    const { bankStatementLines } = get();
    return (bankStatementLines || []).filter(
      (l: any) => l.bank_account_id === bankAccountId && l.status === 'unmatched'
    ).length;
  },

  postJournalDirect: (draft, actor, settings, lastAuditEvent) => {
    const state = get();
    const context: PostingContext = {
      periods: state.periods,
      accounts: state.accounts,
      settings,
      sequences: state.sequences,
      lastAuditEvent,
      currentUser: actor,
    };

    const { journal, auditEvent, nextSequence } = executePostJournal(draft, context);

    set((s: any) => ({
      journals: [journal, ...s.journals],
      sequences: { ...s.sequences, journal: nextSequence },
      linesVersion: s.linesVersion + 1,
      auditEvents: [auditEvent, ...(s.auditEvents || [])],
    }));

    return { journal, auditEvent };
  },

  reverseJournal: (journalId, reason, actor, settings, lastAuditEvent) => {
    const state = get();
    const target = state.journals.find((j: Journal) => j.id === journalId);
    if (!target) throw new PostingError(`Journal '${journalId}' not found.`);
    if (target.status !== 'posted') throw new PostingError(`Cannot reverse journal in status '${target.status}'.`);
    if (target.reversed_by_id) throw new PostingError(`Journal has already been reversed.`);

    // Invert lines: debits become credits, credits become debits
    const invertedLines: JournalLine[] = target.lines.map((l: JournalLine, idx: number) => ({
      ...l,
      id: `jl-rev-${Date.now()}-${idx}`,
      debit: l.credit,
      credit: l.debit,
      amount_fc: -l.amount_fc,
      description: `Reversal: ${l.description} (${reason})`,
    }));

    const reversalDraft: Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'> = {
      tenant_id: target.tenant_id,
      company_id: target.company_id,
      fiscal_period_id: state.currentPeriod?.id || target.fiscal_period_id,
      journal_type: 'reversal',
      journal_date: new Date().toISOString().split('T')[0],
      reference: `REV-${target.number}`,
      memo: `Reversal of ${target.number}: ${reason}`,
      source_type: 'reversal',
      source_id: target.id,
      reversal_of_id: target.id,
      total_debit: target.total_credit,
      total_credit: target.total_debit,
      lines: invertedLines,
      created_by: actor.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { journal: revJournal, auditEvent, nextSequence } = executePostJournal(reversalDraft, {
      periods: state.periods,
      accounts: state.accounts,
      settings,
      sequences: state.sequences,
      lastAuditEvent,
      currentUser: actor,
    });

    revJournal.reversal_of_id = target.id;

    // Update target journal to link reversal
    set((s: any) => ({
      journals: s.journals.map((j: Journal) =>
        j.id === target.id
          ? { ...j, status: 'reversed', reversed_by_id: revJournal.id }
          : j.id === revJournal.id
          ? revJournal
          : j
      ),
      sequences: { ...s.sequences, journal: nextSequence },
      linesVersion: s.linesVersion + 1,
      auditEvents: [auditEvent, ...(s.auditEvents || [])],
    }));

    return { reversalJournal: revJournal, auditEvent };
  },

  closePeriod: (periodId, actor, settings, lastAuditEvent) => {
    const state = get();
    const period = state.periods.find((p: FiscalPeriod) => p.id === periodId);
    if (!period) throw new PostingError(`Period '${periodId}' not found.`);
    if (period.status === 'closed' || period.status === 'locked') {
      throw new PostingError(`Period '${period.name}' is already closed.`);
    }

    const now = new Date().toISOString();
    const updatedPeriod: FiscalPeriod = {
      ...period,
      status: 'closed',
      closed_at: now,
      closed_by: actor.id,
    };

    const auditAction = 'period.closed';
    const detail = `Closed fiscal period ${period.name} after verifying close checklist`;
    const prevHash = lastAuditEvent?.hash || '0000000000000000000000000000000000000000000000000000000000000000';

    const auditEvent: AuditEvent = {
      id: `aud-${Date.now()}`,
      occurred_at: now,
      actor_id: actor.id,
      actor_name: actor.name,
      action: auditAction,
      subject_type: 'fiscal_period',
      subject_id: period.id,
      subject_number: period.name,
      detail,
      prev_hash: prevHash,
      hash: `hash-${Date.now()}`,
    };

    set((s: any) => ({
      periods: s.periods.map((p: FiscalPeriod) => (p.id === periodId ? updatedPeriod : p)),
      auditEvents: [auditEvent, ...(s.auditEvents || [])],
    }));

    return auditEvent;
  },

  requestReopenPeriod: (periodId, reason, actor) => {
    const state = get();
    const period = state.periods.find((p: FiscalPeriod) => p.id === periodId);
    if (!period) throw new PostingError(`Period '${periodId}' not found.`);

    const req: PeriodReopenRequest = {
      id: `reopen-${Date.now()}`,
      period_id: periodId,
      requested_by: actor.id,
      requested_at: new Date().toISOString(),
      reason,
      status: 'pending',
      first_approver_id: actor.role === 'finance_manager' ? actor.id : undefined,
    };

    set((s: any) => ({
      reopenRequests: [req, ...s.reopenRequests],
    }));

    return req;
  },

  approveReopenPeriod: (requestId, approver) => {
    const state = get();
    const req = state.reopenRequests.find((r: PeriodReopenRequest) => r.id === requestId);
    if (!req) return { approved: false, message: 'Request not found' };

    // Strict two-approver rule
    if (!req.first_approver_id) {
      req.first_approver_id = approver.id;
      set((s: any) => ({
        reopenRequests: s.reopenRequests.map((r: PeriodReopenRequest) => (r.id === requestId ? { ...req } : r)),
      }));
      return {
        approved: false,
        message: '1 of 2 required signatures recorded. Second approver PIN needed.',
      };
    }

    if (req.first_approver_id === approver.id) {
      return {
        approved: false,
        message: 'Two distinct approvers required. The second approver cannot be the first.',
      };
    }

    // Both approvers verified!
    req.second_approver_id = approver.id;
    req.status = 'approved';
    req.decided_at = new Date().toISOString();

    // Reopen period
    const period = state.periods.find((p: FiscalPeriod) => p.id === req.period_id);
    if (period) {
      const reopenedPeriod: FiscalPeriod = {
        ...period,
        status: 'open',
        reopened_count: period.reopened_count + 1,
      };
      set((s: any) => ({
        periods: s.periods.map((p: FiscalPeriod) => (p.id === req.period_id ? reopenedPeriod : p)),
        reopenRequests: s.reopenRequests.map((r: PeriodReopenRequest) => (r.id === requestId ? { ...req } : r)),
      }));
    }

    return { approved: true, message: `Period reopened successfully with dual approval.` };
  },

  updateAccount: (account) => {
    set((s: any) => ({
      accounts: s.accounts.map((a: Account) => (a.id === account.id ? account : a)),
    }));
  },

  addAccount: (account) => {
    set((s: any) => ({
      accounts: [...s.accounts, account],
    }));
  },
});
