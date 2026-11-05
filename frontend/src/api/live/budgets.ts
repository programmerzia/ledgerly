/** Live budget calls (plan 3c.16) and document numbering (3c.17). Nothing here computes money: the server splits, sums and compares. */
import { API_BASE_URL } from '../config';
import { buildUrl, http } from '../http';
import type { Intent } from '../idempotency';
import type { components } from '../schema';
import type { GridLine, GridPeriod, SaveCell } from '../adapters/budgets';
import type { ApiMoney } from '../adapters/money';

export type ApiBudget = components['schemas']['BudgetResource'];

export interface BudgetGridResponse {
  data: ApiBudget;
  grid: { periods: GridPeriod[]; lines: GridLine[] };
}

export async function fetchBudgets(companyId: string): Promise<ApiBudget[]> {
  return (await http.get('/v1/companies/{company}/budgets', { path: { company: companyId } })).data;
}

export async function fetchBudget(companyId: string, budgetId: string): Promise<BudgetGridResponse> {
  const res = await http.get('/v1/companies/{company}/budgets/{budget}', { path: { company: companyId, budget: budgetId } });
  return res as unknown as BudgetGridResponse;
}

export async function createBudget(companyId: string, body: { name: string; fiscal_year_id: string; copy_from_budget_id?: string }, intent?: Intent): Promise<ApiBudget> {
  return (await http.post('/v1/companies/{company}/budgets', { path: { company: companyId }, body, intent })).data;
}

export async function renameBudget(companyId: string, budget: ApiBudget, name: string, intent?: Intent): Promise<ApiBudget> {
  return (await http.put('/v1/companies/{company}/budgets/{budget}', { path: { company: companyId, budget: budget.id }, body: { name, version: budget.version } as unknown as components['schemas']['BudgetRequest'], intent })).data;
}

export async function discardBudget(companyId: string, budget: ApiBudget, intent?: Intent): Promise<void> {
  await http.delete('/v1/companies/{company}/budgets/{budget}', { path: { company: companyId, budget: budget.id }, body: { version: budget.version }, intent });
}

/** The cells' `dimensions` is a map of dimension id to value id; the generated type reads it as a list, so the body is cast. */
export async function saveBudgetLines(companyId: string, budget: ApiBudget, cells: SaveCell[], intent?: Intent): Promise<ApiBudget> {
  const body = { version: budget.version, cells } as unknown as components['schemas']['BudgetLinesRequest'];
  const res = await http.put('/v1/companies/{company}/budgets/{budget}/lines', { path: { company: companyId, budget: budget.id }, body, intent });
  return (res as unknown as { data: ApiBudget }).data;
}

export async function approveBudget(companyId: string, budget: ApiBudget, intent?: Intent): Promise<ApiBudget> {
  return (await http.post('/v1/companies/{company}/budgets/{budget}/approve', { path: { company: companyId, budget: budget.id }, body: { version: budget.version }, intent })).data;
}

export async function archiveBudget(companyId: string, budget: ApiBudget, intent?: Intent): Promise<ApiBudget> {
  return (await http.post('/v1/companies/{company}/budgets/{budget}/archive', { path: { company: companyId, budget: budget.id }, body: { version: budget.version }, intent })).data;
}

/** An annual total over the periods, split by the server (remainder in the last month). Nothing is saved. */
export async function fetchSpread(companyId: string, budgetId: string, total: number): Promise<Array<{ fiscal_period_id: string; amount: number }>> {
  const res = await http.get('/v1/companies/{company}/budgets/{budget}/spread', { path: { company: companyId, budget: budgetId }, query: { total } });
  return res.data as unknown as Array<{ fiscal_period_id: string; amount: number }>;
}

export async function fetchSuggestions(
  companyId: string, budgetId: string, source: { kind: 'budget'; budgetId: string } | { kind: 'actuals'; fiscalYearId: string },
): Promise<GridLine[]> {
  const query = source.kind === 'budget' ? { source: 'budget' as const, budget_id: source.budgetId } : { source: 'actuals' as const, fiscal_year_id: source.fiscalYearId };
  const res = await http.get('/v1/companies/{company}/budgets/{budget}/suggestions', { path: { company: companyId, budget: budgetId }, query });
  return res.data as unknown as GridLine[];
}

export function budgetExportUrl(companyId: string, budgetId: string, format: 'csv' | 'xlsx'): string {
  return buildUrl(API_BASE_URL, '/v1/companies/{company}/budgets/{budget}/export', { company: companyId, budget: budgetId }, { format });
}

export interface DashboardCardFigure {
  budget: ApiMoney;
  actual: ApiMoney;
  variance: ApiMoney;
  variance_pct: string | null;
  favourable: boolean | null;
}
export interface DashboardCard {
  budget: { id: string; name: string; revision: number };
  period: { id: string; name: string | null } | null;
  net_profit: DashboardCardFigure;
  revenue: DashboardCardFigure | null;
}

export async function fetchDashboardCard(companyId: string): Promise<DashboardCard | null> {
  const res = await http.get('/v1/companies/{company}/budgets/dashboard-card', { path: { company: companyId } });
  return (res.data as unknown as DashboardCard | null) ?? null;
}
