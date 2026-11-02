/**
 * Dashboard data, live mode. Each figure is its own query so a panel the person may not see (403) or one
 * that fails does not take the page down. Query keys start with the resource, then the company id.
 */
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { fiscalYearStart, localDateISO } from '@/api/adapters/onboarding';
import {
  fetchAging, fetchApprovalCount, fetchBankRows, fetchFiscalYearStart, fetchNetProfit, fetchOverdueCount, hasPosted,
} from '@/api/live/dashboard';
import { hasAccounts } from '@/api/live/setup';
import type { Company } from '@/types';

export type PanelState = 'loading' | 'hidden' | 'error' | 'ready';

/** 403 means "not for your role": the panel is left out rather than shown broken. */
export function panelState(q: { isPending: boolean; isError: boolean; error: unknown }): PanelState {
  if (q.isPending) return 'loading';
  if (q.isError) return q.error instanceof ApiError && q.error.status === 403 ? 'hidden' : 'error';
  return 'ready';
}

const opts = { retry: false, staleTime: 30_000 } as const;

export function useLiveDashboard(company: Company) {
  const id = company.id;
  const today = localDateISO();
  const ar = useQuery({ queryKey: ['dashboard', id, 'ar', today], queryFn: () => fetchAging(id, 'ar', today), ...opts });
  const ap = useQuery({ queryKey: ['dashboard', id, 'ap', today], queryFn: () => fetchAging(id, 'ap', today), ...opts });
  const profit = useQuery({
    queryKey: ['dashboard', id, 'profit', today],
    queryFn: async () => {
      const start = (await fetchFiscalYearStart(id, today)) ?? fiscalYearStart(company.fiscal_year_start_month, today);
      return fetchNetProfit(id, start, today);
    },
    ...opts,
  });
  const banks = useQuery({ queryKey: ['dashboard', id, 'banks'], queryFn: () => fetchBankRows(id), ...opts });
  const approvals = useQuery({ queryKey: ['dashboard', id, 'approvals'], queryFn: () => fetchApprovalCount(id), ...opts });
  const overdueInvoices = useQuery({ queryKey: ['dashboard', id, 'overdue-invoices', today], queryFn: () => fetchOverdueCount(id, 'invoices'), ...opts });
  const overdueBills = useQuery({ queryKey: ['dashboard', id, 'overdue-bills', today], queryFn: () => fetchOverdueCount(id, 'bills'), ...opts });
  const chart = useQuery({ queryKey: ['dashboard', id, 'has-accounts'], queryFn: () => hasAccounts(id), ...opts });
  const postedInvoice = useQuery({ queryKey: ['dashboard', id, 'posted-invoice'], queryFn: () => hasPosted(id, 'invoices'), ...opts });
  const postedBill = useQuery({ queryKey: ['dashboard', id, 'posted-bill'], queryFn: () => hasPosted(id, 'bills'), ...opts });
  return { today, ar, ap, profit, banks, approvals, overdueInvoices, overdueBills, chart, postedInvoice, postedBill };
}
