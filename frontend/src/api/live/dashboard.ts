/** Live dashboard reads: reports, bank accounts, approvals, overdue documents, fiscal year. */
import { http } from '../http';
import { agingFromReport, netProfitFromReport, toBankRows } from '../adapters/dashboard';

export async function fetchAging(companyId: string, side: 'ar' | 'ap', asOf: string) {
  const path = side === 'ar' ? '/v1/companies/{company}/reports/ar-aging' : '/v1/companies/{company}/reports/ap-aging';
  const res = await http.get(path, { path: { company: companyId }, query: { as_of: asOf } });
  return agingFromReport(res.data);
}

export async function fetchNetProfit(companyId: string, from: string, to: string) {
  const res = await http.get('/v1/companies/{company}/reports/profit-and-loss', { path: { company: companyId }, query: { from, to } });
  return netProfitFromReport(res.data);
}

export async function fetchBankRows(companyId: string) {
  const res = await http.get('/v1/companies/{company}/bank-accounts', { path: { company: companyId } });
  return toBankRows(res.data);
}

export async function fetchApprovalCount(companyId: string) {
  const res = await http.get('/v1/companies/{company}/approvals', { path: { company: companyId } });
  return { count: res.data.length };
}

const OVERDUE_LIMIT = 100;

/** Overdue sales invoices or purchase bills, counted; the list is capped, so `hasMore` says the count is a floor. */
export async function fetchOverdueCount(companyId: string, side: 'invoices' | 'bills') {
  const query = { overdue: 'true' as const, limit: OVERDUE_LIMIT };
  const page =
    side === 'invoices'
      ? await http.get('/v1/companies/{company}/invoices', { path: { company: companyId }, query })
      : await http.get('/v1/companies/{company}/bills', { path: { company: companyId }, query });
  return { count: page.data.length, hasMore: Boolean(page.meta?.next_cursor) };
}

/** Whether at least one posted document exists, for the getting-started strip. */
export async function hasPosted(companyId: string, side: 'invoices' | 'bills'): Promise<boolean> {
  const query = { status: 'posted' as const, limit: 1 };
  const page =
    side === 'invoices'
      ? await http.get('/v1/companies/{company}/invoices', { path: { company: companyId }, query })
      : await http.get('/v1/companies/{company}/bills', { path: { company: companyId }, query });
  return page.data.length > 0;
}

/** First day of the fiscal year containing `today`, from the company's own fiscal years. */
export async function fetchFiscalYearStart(companyId: string, today: string): Promise<string | null> {
  const res = await http.get('/v1/companies/{company}/fiscal-years', { path: { company: companyId } });
  const year = res.data.find((y) => y.starts_on && y.ends_on && y.starts_on <= today && today <= y.ends_on);
  return year?.starts_on ?? null;
}
