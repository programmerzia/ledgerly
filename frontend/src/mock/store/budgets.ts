/**
 * Budgets slice: Account x Period x Dimension grid editor and Budget vs Actual comparator.
 * Actuals are computed dynamically from posted journal lines.
 */

import { StateCreator } from 'zustand';
import { Budget } from '@/types';
import { mockBudgets } from '@/mock/data';

export interface BudgetVsActualRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  budgetAmount: number;
  actualAmount: number;
  variance: number; // actual - budget (for income: positive is favorable; for expense: negative is favorable)
  variancePct: number;
}

export interface BudgetsSlice {
  budgets: Budget[];

  updateBudgetAmount: (budgetId: string, accountId: string, periodId: string, amount: number) => void;
  /** month: the period's movement vs its budget line; ytd: balance to period end vs budget summed from FY start. */
  getBudgetVsActual: (budgetId: string, periodId?: string, basis?: 'month' | 'ytd') => BudgetVsActualRow[];
}

export const createBudgetsSlice: StateCreator<any, [], [], BudgetsSlice> = (set, get) => ({
  budgets: [...mockBudgets],

  updateBudgetAmount: (budgetId, accountId, periodId, amount) => {
    set((s: any) => ({
      budgets: s.budgets.map((b: Budget) => {
        if (b.id !== budgetId) return b;
        const exists = b.lines.some((l) => l.account_id === accountId && l.period_id === periodId);
        const lines = exists
          ? b.lines.map((l) => (l.account_id === accountId && l.period_id === periodId ? { ...l, amount } : l))
          : [...b.lines, { id: `bln-${Date.now()}`, account_id: accountId, period_id: periodId, amount }];
        return { ...b, lines };
      }),
    }));
  },

  getBudgetVsActual: (budgetId, periodId, basis = 'month') => {
    const state = get();
    const budget = state.budgets.find((b: Budget) => b.id === budgetId);
    if (!budget) return [];

    const targetPeriodId = periodId || state.currentPeriod?.id || 'per-2026-10';
    const period = state.periods.find((p: any) => p.id === targetPeriodId);
    const dateTo = period ? period.ends_on : undefined;
    // Start of the comparison window: previous regular period's end (month) or nothing (ytd).
    const prevPeriod = period
      ? state.periods
          .filter((p: any) => p.kind !== 'adjustment' && p.ends_on < period.starts_on)
          .sort((a: any, b: any) => b.ends_on.localeCompare(a.ends_on))[0]
      : undefined;
    const dateFrom = basis === 'month' && prevPeriod ? prevPeriod.ends_on : undefined;

    const rows: BudgetVsActualRow[] = [];
    const accounts = state.accounts.filter(
      (a: any) => a.account_type === 'income' || a.account_type === 'expense'
    );

    for (const acc of accounts) {
      const budgetAmount = budget.lines
        .filter((l: any) =>
          l.account_id === acc.id &&
          (basis === 'month' ? l.period_id === targetPeriodId : l.period_id <= targetPeriodId)
        )
        .reduce((t: number, l: any) => t + (l.amount || 0), 0);
      const actualAmount =
        state.balanceOf(acc.id, dateTo) - (dateFrom ? state.balanceOf(acc.id, dateFrom) : 0);
      const variance = actualAmount - budgetAmount;
      const variancePct = budgetAmount !== 0 ? (variance / budgetAmount) * 100 : 0;

      rows.push({
        accountId: acc.id,
        accountCode: acc.code,
        accountName: acc.name,
        budgetAmount,
        actualAmount,
        variance,
        variancePct,
      });
    }

    return rows;
  },
});
