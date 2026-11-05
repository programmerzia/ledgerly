/**
 * Report data, live mode only (the mock reports keep reading the store). Query keys start with `reports`, then the
 * company id, so a company or organisation switch drops them. A report screen is one query; a 403 shows as "not for
 * your role" on that screen and nowhere else.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchDrillPage, fetchGeneralLedgerPage, fetchReport, fetchStatementContacts, type ReportName, type StatementName } from '@/api/live/reports';
import { selectionQuery, type DrillKey, type ReportSelection } from '@/api/adapters/report';
import { cursorPaging, fetchAllPages } from '@/api/cursor';
import type { PeriodChoice } from '@/api/adapters/reportSelection';
import { http } from '@/api/http';
import { toFiscalYear } from '@/api/adapters/fiscal';
import { toDimension } from '@/api/adapters/dimension';
import { useRouteCompany } from './session';

/** Which parameters each report reads (the others would be ignored or refused by the server). */
export const REPORT_PARAMS: Record<ReportName, { basis: boolean; comparison: boolean; dims: boolean; hideZero: boolean }> = {
  'trial-balance': { basis: false, comparison: false, dims: true, hideZero: true },
  'profit-and-loss': { basis: true, comparison: true, dims: true, hideZero: true },
  'balance-sheet': { basis: false, comparison: true, dims: true, hideZero: true },
  'cash-flow': { basis: true, comparison: false, dims: false, hideZero: false },
  'general-ledger': { basis: false, comparison: false, dims: true, hideZero: false },
  'ar-aging': { basis: false, comparison: false, dims: false, hideZero: false },
  'ap-aging': { basis: false, comparison: false, dims: false, hideZero: false },
  'customer-statement': { basis: false, comparison: false, dims: false, hideZero: false },
  'supplier-statement': { basis: false, comparison: false, dims: false, hideZero: false },
  'tax-return': { basis: false, comparison: false, dims: false, hideZero: false },
  'budget-vs-actual': { basis: true, comparison: false, dims: true, hideZero: false },
};

/** The query string a report run (and its export) sends, from the screen's selection. */
export function reportQuery(name: ReportName, sel: ReportSelection) {
  const p = REPORT_PARAMS[name];
  const q = selectionQuery(sel, { basis: p.basis, comparison: p.comparison, dims: p.dims });
  if (!p.hideZero) delete q.hide_zero;
  return q;
}

export function useReport<N extends StatementName>(name: N, sel: ReportSelection, enabled = true) {
  const company = useRouteCompany();
  const query = reportQuery(name, sel);
  return useQuery({
    queryKey: ['reports', company.id, name, query],
    queryFn: ({ signal }) => fetchReport(company.id, name, query, signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useGeneralLedger(sel: ReportSelection, enabled: boolean) {
  const company = useRouteCompany();
  const query = reportQuery('general-ledger', sel);
  return useInfiniteQuery({
    queryKey: ['reports', company.id, 'general-ledger', query],
    queryFn: ({ pageParam, signal }) => fetchGeneralLedgerPage(company.id, query, pageParam, signal),
    ...cursorPaging,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useDrill(key: DrillKey | null) {
  const company = useRouteCompany();
  return useInfiniteQuery({
    queryKey: ['reports', company.id, 'drill', key],
    queryFn: ({ pageParam, signal }) => fetchDrillPage(company.id, key as DrillKey, pageParam, signal),
    ...cursorPaging,
    enabled: key !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useStatementContacts(side: 'customer' | 'supplier') {
  const company = useRouteCompany();
  return useQuery({
    queryKey: ['reports', company.id, 'contacts', side],
    queryFn: () => fetchStatementContacts(company.id, side),
    retry: false,
  });
}

/**
 * Fiscal periods for the "period" picker. Read for the company in the URL (not the mirrored store value, which is
 * stale for a render after a reload). Reading them needs a permission a report viewer may not have; then the picker
 * offers dates only, which every report accepts.
 */
export function useReportPeriods(): { periods: PeriodChoice[]; isLoading: boolean } {
  const company = useRouteCompany();
  const q = useQuery({
    queryKey: ['reports', company.id, 'periods'],
    queryFn: async () => {
      const res = await http.get('/v1/companies/{company}/fiscal-years', { path: { company: company.id } });
      return res.data.map(toFiscalYear).flatMap((y) => y.periods);
    },
    retry: false,
  });
  const periods = useMemo(
    () => (q.data ?? []).filter((p) => p.starts_on && p.ends_on).map((p) => ({ id: p.id, name: p.name, starts_on: p.starts_on, ends_on: p.ends_on, kind: p.kind })),
    [q.data],
  );
  return { periods, isLoading: q.isLoading };
}

/** Active dimensions with their active values, for the filter. Empty when the person may not read them. */
export function useReportDimensions() {
  const company = useRouteCompany();
  const q = useQuery({
    queryKey: ['reports', company.id, 'dimensions'],
    queryFn: async () => {
      const res = await http.get('/v1/companies/{company}/dimensions', { path: { company: company.id } });
      return res.data.map(toDimension);
    },
    retry: false,
  });
  return useMemo(() => (q.data ?? []).filter((d) => d.is_active).map((d) => ({ ...d, values: d.values.filter((v) => v.is_active) })).filter((d) => d.values.length > 0), [q.data]);
}

export interface LedgerAccountChoice {
  id: string;
  code: string;
  name: string;
  type: string;
}

/** Accounts that can hold postings, for the general ledger picker (read for the company in the URL). */
export function useReportAccounts() {
  const company = useRouteCompany();
  return useQuery({
    queryKey: ['reports', company.id, 'accounts'],
    queryFn: async (): Promise<LedgerAccountChoice[]> => {
      const rows = await fetchAllPages((cursor) => http.get('/v1/companies/{company}/accounts', { path: { company: company.id }, query: { cursor, limit: 200 } }));
      return rows.filter((a) => a.is_postable).map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.account_type })).sort((a, b) => a.code.localeCompare(b.code));
    },
    retry: false,
  });
}
