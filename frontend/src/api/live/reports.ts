/** Report reads and exports, live mode. Every report is a GET; the query string is built by `selectionQuery`. */
import { API_BASE_URL } from '../config';
import { ApiError, NetworkError, problemToError } from '../errors';
import { buildUrl, http } from '../http';
import {
  drillQuery, parseAging, parseBalanceSheet, parseCashFlow, parseDrillSummary, parseExportTicket, parseLedgerHeader, parseLedgerLine,
  parseBudgetVsActual, parseProfitAndLoss, parseStatement, parseTaxReturn, parseTrialBalance, type DrillKey, type QueryPairs,
} from '../adapters/report';

export type ReportName =
  | 'trial-balance' | 'profit-and-loss' | 'balance-sheet' | 'cash-flow' | 'general-ledger'
  | 'ar-aging' | 'ap-aging' | 'customer-statement' | 'supplier-statement' | 'tax-return' | 'budget-vs-actual'
  | 'journal-list' | 'bank-reconciliation' | 'audit-trail' | 'period-close';

const reportPath = (name: string) => `/v1/companies/{company}/reports/${name}`;

/** The typed `http.get` cannot express `dimensions[<id>]`, so report URLs are built here. */
function reportUrl(companyId: string, name: string, query: QueryPairs, extra: Record<string, string | number | undefined> = {}): string {
  const q: Record<string, unknown> = { ...query };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) q[k] = v;
  return buildUrl(API_BASE_URL, reportPath(name), { company: companyId }, q);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return http.request<T>('GET', url, undefined, undefined, signal);
}

const PARSERS = {
  'trial-balance': parseTrialBalance,
  'profit-and-loss': parseProfitAndLoss,
  'balance-sheet': parseBalanceSheet,
  'cash-flow': parseCashFlow,
  'ar-aging': parseAging,
  'ap-aging': parseAging,
  'customer-statement': parseStatement,
  'supplier-statement': parseStatement,
  'tax-return': parseTaxReturn,
  'budget-vs-actual': parseBudgetVsActual,
} as const;

export type StatementName = keyof typeof PARSERS;
export type StatementResult<N extends StatementName> = ReturnType<(typeof PARSERS)[N]>;

export async function fetchReport<N extends StatementName>(companyId: string, name: N, query: QueryPairs, signal?: AbortSignal): Promise<StatementResult<N>> {
  const res = await getJson<{ data: unknown }>(reportUrl(companyId, name, query), signal);
  return PARSERS[name](res.data) as StatementResult<N>;
}

interface LinesBody {
  data: unknown[];
  meta: { next_cursor: string | null };
  report?: unknown;
  summary?: unknown;
  account?: unknown;
}

export async function fetchGeneralLedgerPage(companyId: string, query: QueryPairs, cursor: string | undefined, signal?: AbortSignal) {
  const body = await getJson<LinesBody>(reportUrl(companyId, 'general-ledger', query, { cursor, limit: 100 }), signal);
  return {
    header: parseLedgerHeader(body.report),
    data: body.data.map(parseLedgerLine),
    meta: { next_cursor: body.meta.next_cursor, prev_cursor: null, limit: 100 },
  };
}

export async function fetchDrillPage(companyId: string, key: DrillKey, cursor: string | undefined, signal?: AbortSignal) {
  const body = await getJson<LinesBody>(reportUrl(companyId, 'drill', drillQuery(key), { cursor, limit: 50 }), signal);
  return {
    summary: parseDrillSummary(body.summary, body.account),
    data: body.data.map(parseLedgerLine),
    meta: { next_cursor: body.meta.next_cursor, prev_cursor: null, limit: 50 },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Contacts for the statement pickers
// ---------------------------------------------------------------------------------------------------------------

export interface ContactChoice {
  id: string;
  code: string;
  name: string;
}

export async function fetchStatementContacts(companyId: string, side: 'customer' | 'supplier'): Promise<ContactChoice[]> {
  const out: ContactChoice[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await http.get('/v1/companies/{company}/contacts', { path: { company: companyId }, query: { cursor, limit: 200 } });
    for (const c of res.data) {
      if (c.kind === side || c.kind === 'both') out.push({ id: c.id, code: c.code, name: c.name });
    }
    cursor = res.meta?.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------------------------

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

export interface ExportedFile {
  blob: Blob;
  filename: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawGet(url: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError(e);
  }
}

async function failure(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return problemToError(res.status, body, res.headers);
}

function filenameOf(res: Response, fallback: string): string {
  const header = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m ? decodeURIComponent(m[1]) : fallback;
}

const POLL_MS = 1500;
const POLL_LIMIT_MS = 5 * 60_000;

/**
 * `GET reports/{report}/export?format=…`. Small exports come back as the file (200); large ones answer 202 with an id
 * and are polled at `reports/exports/{id}` until the file is ready (a worker produces it). `onQueued` lets the screen
 * say so. A failed job is an error, never a silent empty file.
 */
export async function exportReport(
  companyId: string,
  report: ReportName,
  format: ExportFormat,
  query: QueryPairs,
  opts: { signal?: AbortSignal; onQueued?: () => void; pollMs?: number } = {},
): Promise<ExportedFile> {
  const fallback = `${report}.${format}`;
  const url = buildUrl(API_BASE_URL, '/v1/companies/{company}/reports/{report}/export', { company: companyId, report }, { ...query, format });
  const res = await rawGet(url, opts.signal);
  if (res.status === 200) return { blob: await res.blob(), filename: filenameOf(res, fallback) };
  if (res.status !== 202) throw await failure(res);

  opts.onQueued?.();
  const ticket = parseExportTicket(await res.json());
  const statusUrl = buildUrl(API_BASE_URL, '/v1/companies/{company}/reports/exports/{exportId}', { company: companyId, exportId: ticket.id });
  const started = Date.now();
  while (Date.now() - started < POLL_LIMIT_MS) {
    await sleep(opts.pollMs ?? POLL_MS);
    const poll = await rawGet(statusUrl, opts.signal);
    if (!poll.ok) throw await failure(poll);
    const type = poll.headers.get('Content-Type') ?? '';
    if (!type.includes('json')) return { blob: await poll.blob(), filename: filenameOf(poll, fallback) };
    const status = parseExportTicket(await poll.json()).status;
    if (status === 'failed') throw new ApiError({ status: 500, code: 'export_failed', detail: 'The export could not be produced.', requestId: null });
  }
  throw new ApiError({ status: 504, code: 'export_timeout', detail: 'The export is taking longer than expected. Try again later.', requestId: null });
}

/** Hands a downloaded file to the browser. */
export function saveFile(file: ExportedFile): void {
  const href = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
