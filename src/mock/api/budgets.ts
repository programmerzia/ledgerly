import { simulatedCall } from './client';
import { useLedgerStore } from '@/mock/store';
import { Budget } from '@/types';
import { BudgetVsActualRow } from '@/mock/store/budgets';

export async function getBudgets(): Promise<Budget[]> {
  return simulatedCall(() => useLedgerStore.getState().budgets);
}

export async function updateBudgetAmount(
  budgetId: string,
  accountId: string,
  periodId: string,
  amount: number
): Promise<void> {
  return simulatedCall(() => {
    useLedgerStore.getState().updateBudgetAmount(budgetId, accountId, periodId, amount);
  });
}

export async function getBudgetVsActual(budgetId: string, periodId?: string): Promise<BudgetVsActualRow[]> {
  return simulatedCall(() => useLedgerStore.getState().getBudgetVsActual(budgetId, periodId));
}
