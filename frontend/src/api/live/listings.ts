/** Listing and document reports, live mode (3c.20): journal list, bank reconciliation report, period close checklist, audit bundle. */
import { API_BASE_URL } from '../config';
import { ApiError, NetworkError, problemToError } from '../errors';
import { buildUrl, http } from '../http';
import type { CursorMeta } from '../cursor';
import type { ExportedFile } from './reports';

export interface Money {
  amount: number;
  currency: string;
}

export interface JournalListRow {
  id: string;
  number: string | null;
  date: string;
  type: string;
  status: string;
  reference: string | null;
  memo: string | null;
  source: { type: string; id: string | null } | null;
  created_by: { id: string; name: string | null } | null;
  posted_by: { id: string; name: string | null } | null;
  debit: Money;
  credit: Money;
  line_count: number;
  lines?: Array<{ id: string; line_no: number; account: { id: string; code: string; name: string }; debit: Money; credit: Money; description: string | null; contact: { id: string; name: string } | null }>;
}

export interface JournalListPage {
  data: JournalListRow[];
  meta: CursorMeta;
  choices?: { sources: string[]; users: Array<{ id: string; name: string }> };
}

export async function fetchJournalList(companyId: string, query: Record<string, string>, cursor: string | undefined, signal?: AbortSignal): Promise<JournalListPage> {
  const url = buildUrl(API_BASE_URL, '/v1/companies/{company}/reports/journal-list', { company: companyId }, { ...query, cursor, limit: 100 });
  return http.request<JournalListPage>('GET', url, undefined, undefined, signal);
}

export interface PeriodCloseReport {
  period: { id: string; name: string; kind: string; starts_on: string; ends_on: string; status: string; closed_at: string | null; closed_by: string | null };
  source: 'live' | 'recorded_at_close';
  checks: Array<{ code: string; status: 'passed' | 'failed' | 'waived'; message: string; checked_at: string | null; waived_by: string | null; waived_reason: string | null }>;
  summary: { passed: number; waived: number; failed: number };
}

export async function fetchPeriodClose(companyId: string, periodId: string, signal?: AbortSignal): Promise<PeriodCloseReport> {
  const url = buildUrl(API_BASE_URL, '/v1/companies/{company}/reports/period-close', { company: companyId }, { period_id: periodId });
  return (await http.request<{ data: PeriodCloseReport }>('GET', url, undefined, undefined, signal)).data;
}

export interface BankReconciliationReportData {
  currency: string;
  reconciliation: { id: string; as_of: string; finished_at: string; finished_by: { id: string; name: string | null } | null; reopen_count: number };
  bank_account: { id: string; name: string; bank_name: string | null; account_number_masked: string | null };
  statement: { id: string; period_from: string; period_to: string; file_name: string | null; opening_balance: Money | null; receipts: Money; payments: Money; closing_balance: Money; line_count: number };
  book: { balance: Money; opening_position: Money; matched: Money; unmatched: Money; unmatched_count: number; matched_after_as_of: Money };
  steps: Array<{ key: string; label: string; amount: Money; of_which_excluded?: Money }>;
  checks: {
    statement_foots: boolean | null;
    steps_add_up: boolean;
    difference_is_zero: boolean;
    opening_continuity: { previous_as_of: string | null; previous_closing_balance: Money | null; agrees: boolean | null };
  };
  matched: { count: number; total: Money };
  unmatched_book_items: { count: number; total: Money; truncated: boolean; items: Array<{ journal_line_id: string; journal_id: string; number: string | null; date: string; amount: Money; description: string }> };
  unmatched_statement_items: { count: number; total: Money; truncated: boolean; items: Array<{ statement_line_id: string; date: string; amount: Money; description: string; status: string }> };
  excluded_lines: { count: number; total: Money; list_agrees: boolean; items: Array<{ id: string; date: string; amount: Money; description: string; reason: string | null; excluded_by: string | null }> };
}

export async function fetchBankReconciliationReport(companyId: string, reconciliationId: string, signal?: AbortSignal): Promise<BankReconciliationReportData> {
  const url = buildUrl(API_BASE_URL, '/v1/companies/{company}/bank-reconciliations/{id}/report', { company: companyId, id: reconciliationId });
  return (await http.request<{ data: BankReconciliationReportData }>('GET', url, undefined, undefined, signal)).data;
}

/** The tamper-evident audit bundle (zip). A 403 `signature_required` is left to the caller's signed-run wrapper. */
export async function downloadAuditBundle(companyId: string, query: Record<string, string>): Promise<ExportedFile> {
  const url = buildUrl(API_BASE_URL, '/v1/companies/{company}/reports/audit-trail/bundle', { company: companyId }, query);
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/zip, application/json', 'X-Requested-With': 'XMLHttpRequest' } });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw problemToError(res.status, body, res.headers);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : 'audit-evidence.zip' };
}

export { ApiError };

/** The documents behind one cell of the aging or one row of the tax return (3c.21); the amounts add up to the cell. */
export interface DrillDocument {
  contact?: { id: string; code: string; name: string } | null;
  document: { type: string; id: string; number: string | null };
  journal_id?: string | null;
  journal?: { id: string; number: string | null };
  date: string;
  due_date?: string | null;
  days_overdue?: number | null;
  is_reversal?: boolean;
  amount?: Money;
  net?: Money;
  tax?: Money;
}
export interface DrillDocuments {
  documents: DrillDocument[];
  total?: Money;
  totals?: { net: Money; tax: Money };
}

export async function fetchDrillDocuments(companyId: string, path: string, query: Record<string, string>, signal?: AbortSignal): Promise<DrillDocuments> {
  const url = buildUrl(API_BASE_URL, `/v1/companies/{company}/reports/${path}`, { company: companyId }, query);
  return (await http.request<{ data: DrillDocuments }>('GET', url, undefined, undefined, signal)).data;
}
