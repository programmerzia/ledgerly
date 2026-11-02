/**
 * Live dashboard extras: one profit and loss per month, the cash-flow closing cash, and the newest audit events.
 * The report bodies are loosely typed in the OpenAPI file, so each reader checks the shape it needs and returns
 * null rather than guess. Every amount is the server's; nothing here adds, subtracts or converts money.
 */
import { http } from '../http';
import { fromApiMoney, type ApiMoney } from '../adapters/money';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function minor(v: unknown): number | null {
  if (!isRecord(v) || typeof v.amount !== 'number' || typeof v.currency !== 'string') return null;
  return fromApiMoney(v as unknown as ApiMoney);
}

/** The server's own total of one profit-and-loss section, or null when the section is not in the report. */
function sectionTotal(sections: unknown, key: string): number | null {
  if (!Array.isArray(sections)) return null;
  const s = sections.find((x): x is Record<string, unknown> => isRecord(x) && x.key === key);
  return s && isRecord(s.total) ? minor(s.total.amount ?? s.total) : null;
}

export interface MonthPnl {
  currency: string;
  /** Section totals as the server gives them; a missing section is 0 (nothing posted there). */
  revenue: number;
  otherIncome: number;
  costOfSales: number;
  operatingExpenses: number;
  otherExpenses: number;
  netProfit: number;
}

export function monthPnlFromReport(data: unknown): MonthPnl | null {
  if (!isRecord(data) || typeof data.currency !== 'string' || !isRecord(data.subtotals) || !isRecord(data.subtotals.net_profit)) return null;
  const net = minor(data.subtotals.net_profit.amount);
  if (net === null) return null;
  const s = data.sections;
  return {
    currency: data.currency,
    revenue: sectionTotal(s, 'operating_revenue') ?? 0,
    otherIncome: sectionTotal(s, 'other_income') ?? 0,
    costOfSales: sectionTotal(s, 'direct_costs') ?? 0,
    operatingExpenses: sectionTotal(s, 'operating_expense') ?? 0,
    otherExpenses: sectionTotal(s, 'other_expense') ?? 0,
    netProfit: net,
  };
}

export async function fetchMonthPnl(companyId: string, from: string, to: string): Promise<MonthPnl | null> {
  const res = await http.get('/v1/companies/{company}/reports/profit-and-loss', { path: { company: companyId }, query: { from, to } });
  return monthPnlFromReport(res.data);
}

export interface ClosingCash {
  amount: number;
  currency: string;
}

/** `closing_cash` is shown only when the report says it ties to the books (`reconciles`). */
export async function fetchClosingCash(companyId: string, from: string, to: string): Promise<ClosingCash | null> {
  const res = await http.get('/v1/companies/{company}/reports/cash-flow', { path: { company: companyId }, query: { from, to } });
  const d: unknown = res.data;
  if (!isRecord(d) || d.reconciles !== true) return null;
  const amount = minor(d.closing_cash);
  return amount === null || !isRecord(d.closing_cash) ? null : { amount, currency: String(d.closing_cash.currency) };
}

export async function fetchRecentAudit(companyId: string, limit: number) {
  const page = await http.get('/v1/companies/{company}/audit-events', { path: { company: companyId }, query: { limit } });
  return page.data;
}
