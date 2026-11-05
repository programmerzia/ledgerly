/**
 * Budgets, live mode (plan 3c.16). Keys start with the resource, then the company id, so a company switch
 * drops them. A budget is read with its grid; saving a budget also drops the budget vs actual reports, whose cache the server keys by the
 * budget's version.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Intent } from '@/api/idempotency';
import * as api from '@/api/live/budgets';
import { toFiscalYear } from '@/api/adapters/fiscal';
import { http } from '@/api/http';
import { useRouteCompany } from './session';

export const budgetsKey = (companyId: string) => ['budgets', companyId] as const;

export function useBudgets() {
  const company = useRouteCompany();
  return useQuery({ queryKey: budgetsKey(company.id), queryFn: () => api.fetchBudgets(company.id), retry: false });
}

export function useBudget(budgetId: string | null) {
  const company = useRouteCompany();
  return useQuery({
    queryKey: [...budgetsKey(company.id), budgetId],
    queryFn: () => api.fetchBudget(company.id, budgetId ?? ''),
    enabled: budgetId !== null,
    retry: false,
  });
}

export function useBudgetYears() {
  const company = useRouteCompany();
  return useQuery({
    queryKey: ['budgets', company.id, 'fiscal-years'],
    queryFn: async () => (await http.get('/v1/companies/{company}/fiscal-years', { path: { company: company.id } })).data.map(toFiscalYear),
    retry: false,
  });
}

/** The dashboard note: null when there is no approved budget (the dashboard then shows nothing), and nothing at all on any error. */
export function useBudgetCard() {
  const company = useRouteCompany();
  return useQuery({ queryKey: ['budgets', company.id, 'card'], queryFn: () => api.fetchDashboardCard(company.id), retry: false, staleTime: 30_000 });
}

export function useBudgetActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: budgetsKey(company.id) });
    await qc.invalidateQueries({ queryKey: ['reports', company.id, 'budget-vs-actual'] });
  };
  const after = <T,>(p: Promise<T>): Promise<T> => p.then(async (r) => { await refresh(); return r; });
  return {
    create: (body: { name: string; fiscal_year_id: string; copy_from_budget_id?: string }, intent?: Intent) => after(api.createBudget(company.id, body, intent)),
    rename: (b: api.ApiBudget, name: string, intent?: Intent) => after(api.renameBudget(company.id, b, name, intent)),
    discard: (b: api.ApiBudget, intent?: Intent) => after(api.discardBudget(company.id, b, intent)),
    saveLines: (b: api.ApiBudget, cells: Parameters<typeof api.saveBudgetLines>[2], intent?: Intent) => after(api.saveBudgetLines(company.id, b, cells, intent)),
    approve: (b: api.ApiBudget, intent?: Intent) => after(api.approveBudget(company.id, b, intent)),
    archive: (b: api.ApiBudget, intent?: Intent) => after(api.archiveBudget(company.id, b, intent)),
    spread: (budgetId: string, total: number) => api.fetchSpread(company.id, budgetId, total),
    suggestions: (budgetId: string, source: Parameters<typeof api.fetchSuggestions>[2]) => api.fetchSuggestions(company.id, budgetId, source),
  };
}
