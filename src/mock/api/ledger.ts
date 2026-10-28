import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { Account, Dimension, TaxCode, Journal, FiscalPeriod, FiscalYear } from '@/types';

export async function getAccounts(): Promise<Account[]> {
  return simulatedCall(() => useLedgerStore.getState().accounts);
}

export async function getDimensions(): Promise<Dimension[]> {
  return simulatedCall(() => useLedgerStore.getState().dimensions);
}

export async function getTaxCodes(): Promise<TaxCode[]> {
  return simulatedCall(() => useLedgerStore.getState().taxCodes);
}

export async function getFiscalYears(): Promise<FiscalYear[]> {
  return simulatedCall(() => useLedgerStore.getState().fiscalYears);
}

export async function getPeriods(): Promise<FiscalPeriod[]> {
  return simulatedCall(() => useLedgerStore.getState().periods);
}

export async function getJournals(filters?: { status?: string }): Promise<Journal[]> {
  return simulatedCall(() => {
    const list = useLedgerStore.getState().journals;
    if (filters?.status && filters.status !== 'all') {
      return list.filter((j) => j.status === filters.status);
    }
    return list;
  });
}

export async function getJournal(id: string): Promise<Journal | undefined> {
  return simulatedCall(() => useLedgerStore.getState().journals.find((j) => j.id === id));
}

export const getJournalById = getJournal;

export async function postJournal(draft: any): Promise<Journal> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    const { journal } = state.postJournalDirect(
      draft,
      state.currentUser,
      state.companySettings,
      state.auditEvents[0]
    );
    return journal;
  });
}

export const createJournal = postJournal;

export async function reverseJournal(journalId: string, reason: string): Promise<any> {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    const { reversalJournal } = state.reverseJournal(
      journalId,
      reason,
      state.currentUser,
      state.companySettings,
      state.auditEvents[0]
    );
    const updatedOriginal = state.journals.find((j) => j.id === journalId);
    return {
      original: updatedOriginal || reversalJournal,
      reversal: reversalJournal,
      ...reversalJournal,
    };
  });
}

export async function getTrialBalance(periodFrom?: string, periodTo?: string, dims?: any) {
  return simulatedCall(() => useLedgerStore.getState().trialBalance(periodFrom, periodTo, dims));
}

export async function getMovements(accountId: string, range?: { from?: string; to?: string }, dims?: any) {
  return simulatedCall(() => useLedgerStore.getState().movements(accountId, range, dims));
}

export async function getProfitAndLoss(periodName?: string) {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    const accounts = state.accounts;
    const revAccounts = accounts.filter((a) => a.account_type === 'income');
    const expAccounts = accounts.filter((a) => a.account_type === 'expense');

    const revenue = revAccounts
      .map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        balance: state.balanceOf(a.id),
      }))
      .filter((a) => a.balance !== 0);

    const expenses = expAccounts
      .map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        balance: state.balanceOf(a.id),
      }))
      .filter((a) => a.balance !== 0);

    const totalRevenue = revenue.reduce((sum, a) => sum + a.balance, 0);
    const totalExpense = expenses.reduce((sum, a) => sum + a.balance, 0);
    const netIncome = totalRevenue - totalExpense;

    return {
      revenue,
      expenses,
      totalRevenue,
      totalExpense,
      netIncome,
    };
  });
}

export async function closePeriod(periodId: string) {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.closePeriod(periodId, state.currentUser, state.companySettings, state.auditEvents[0]);
  });
}

export async function requestReopenPeriod(periodId: string, reason: string) {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.requestReopenPeriod(periodId, reason, state.currentUser);
  });
}

export const requestPeriodReopen = requestReopenPeriod;

export async function getDashboardStats() {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    const cash = state.balanceOf('acc-1010') + state.balanceOf('acc-1020') + state.balanceOf('acc-1000');
    const ar = state.balanceOf('acc-1200');
    const ap = state.balanceOf('acc-2000');
    const pendingCount =
      state.invoices.filter((i) => i.status === 'pending_approval').length +
      state.bills.filter((b) => b.status === 'pending_approval').length +
      state.journals.filter((j) => j.status === 'pending_approval').length;

    return {
      cashOnHand: cash,
      accountsReceivable: ar,
      accountsPayable: ap,
      pendingApprovalsCount: pendingCount,
      openPeriod: state.currentPeriod?.name || 'Oct 2026',
    };
  });
}

export async function approveReopenPeriod(requestId: string) {
  return simulatedCall(() => {
    const state = useLedgerStore.getState();
    return state.approveReopenPeriod(requestId, state.currentUser);
  });
}

export const approvePeriodReopen = approveReopenPeriod;

