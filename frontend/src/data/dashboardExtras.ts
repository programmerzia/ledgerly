/** Extra dashboard panels (live mode): monthly income and expense, cash and bank, recent activity. Each is its own query, so a 403 or a failure leaves only that panel out. */
import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchClosingCash, fetchMonthPnl, fetchRecentAudit } from '@/api/live/dashboardExtras';
import { fetchFiscalYearStart } from '@/api/live/dashboard';
import { fiscalYearStart } from '@/api/adapters/onboarding';
import { toAuditRow } from '@/api/adapters/admin';
import type { Company } from '@/types';

const opts = { retry: false, staleTime: 30_000 } as const;
const MONTHS_SHOWN = 6;

export interface MonthRange {
  label: string;
  from: string;
  to: string;
}

/** The last six calendar months up to `today`, but not before the fiscal year starts (the report is per fiscal year). Dates are plain strings. */
export function monthRanges(today: string, yearStart: string): MonthRange[] {
  const [y, m] = today.split('-').map(Number);
  const out: MonthRange[] = [];
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const from = d.toISOString().slice(0, 10);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const to = last < today ? last : today;
    if (to < yearStart) continue;
    out.push({ label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), from: from < yearStart ? yearStart : from, to });
  }
  return out;
}

export function useYearStart(company: Company, today: string) {
  return useQuery({
    queryKey: ['dashboard', company.id, 'year-start', today],
    queryFn: async () => (await fetchFiscalYearStart(company.id, today)) ?? fiscalYearStart(company.fiscal_year_start_month, today),
    ...opts,
  });
}

export function useMonthlyPnl(company: Company, today: string, yearStart: string | undefined) {
  const ranges = yearStart ? monthRanges(today, yearStart) : [];
  const results = useQueries({
    queries: ranges.map((r) => ({ queryKey: ['dashboard', company.id, 'pnl-month', r.from, r.to], queryFn: () => fetchMonthPnl(company.id, r.from, r.to), ...opts })),
  });
  return { ranges, results, pending: !yearStart || results.some((r) => r.isPending), error: results.find((r) => r.isError)?.error ?? null };
}

export function useClosingCash(company: Company, today: string, yearStart: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', company.id, 'closing-cash', today],
    queryFn: () => fetchClosingCash(company.id, yearStart as string, today),
    enabled: Boolean(yearStart),
    ...opts,
  });
}

export function useRecentActivity(company: Company) {
  return useQuery({
    queryKey: ['dashboard', company.id, 'recent-audit'],
    queryFn: async () => (await fetchRecentAudit(company.id, 8)).map(toAuditRow),
    ...opts,
  });
}
