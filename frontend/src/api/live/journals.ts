/** Live journal, approval and recurring calls (13 §10, §16). Transport only: adapters shape the results. */
import { http } from '../http';
import type { Intent } from '../idempotency';
import type { CursorPage } from '../cursor';
import type { ApiApproval, ApiDimension, ApiJournal, ApiPostingPreview, ApiRecurringRun, ApiRecurringSchedule } from '../adapters/journal';
import type { components } from '../schema';

export type ApiFiscalYear = components['schemas']['FiscalYearResource'];

export interface JournalQuery {
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  search?: string;
  period_id?: string;
}

const co = (company: string) => ({ company });

export const listJournals = (company: string, q: JournalQuery, cursor: string | undefined, limit = 25): Promise<CursorPage<ApiJournal>> =>
  http.get('/v1/companies/{company}/journals', { path: co(company), query: { ...q, cursor, limit } as never }) as Promise<CursorPage<ApiJournal>>;

export const getJournal = async (company: string, id: string): Promise<ApiJournal> =>
  (await http.get('/v1/companies/{company}/journals/{journal}', { path: { company, journal: id } })).data as ApiJournal;

type Wrapped<T> = Promise<{ data: T }>;
const post = <T>(path: string, body: unknown, intent: Intent): Wrapped<T> => http.send('POST', path, body, intent);

export const createJournal = async (company: string, body: unknown, intent: Intent): Promise<ApiJournal> =>
  (await post<ApiJournal>(`/v1/companies/${company}/journals`, body, intent)).data;

export const updateJournal = async (company: string, id: string, body: unknown, intent: Intent): Promise<ApiJournal> =>
  (await http.send<{ data: ApiJournal }>('PUT', `/v1/companies/${company}/journals/${id}`, body, intent)).data;

export const previewJournal = async (company: string, id: string, intent: Intent): Promise<ApiPostingPreview> =>
  (await post<ApiPostingPreview>(`/v1/companies/${company}/journals/${id}/posting-preview`, {}, intent)).data;

export const transitionJournal = async (
  company: string,
  id: string,
  action: 'submit' | 'approve' | 'return' | 'void' | 'reverse',
  body: Record<string, unknown>,
  intent: Intent,
): Promise<ApiJournal> => (await post<ApiJournal>(`/v1/companies/${company}/journals/${id}/${action}`, body, intent)).data;

export const listApprovals = (company: string, cursor: string | undefined, limit = 50): Promise<CursorPage<ApiApproval>> =>
  http.get('/v1/companies/{company}/approvals', { path: co(company), query: { cursor, limit } as never }) as Promise<CursorPage<ApiApproval>>;

export const bulkApprove = (company: string, documents: Array<{ type: string; id: string }>, intent: Intent) =>
  post<unknown>(`/v1/companies/${company}/approvals/bulk-approve`, { documents }, intent) as unknown as Promise<{
    data: unknown[];
    meta: { approved: number; skipped: number };
  }>;

export const listDimensions = async (company: string): Promise<ApiDimension[]> => {
  const page = (await http.get('/v1/companies/{company}/dimensions', { path: co(company), query: { limit: 200 } as never })) as unknown as CursorPage<ApiDimension>;
  return page.data;
};

export const listFiscalYears = async (company: string): Promise<ApiFiscalYear[]> => {
  const page = (await http.get('/v1/companies/{company}/fiscal-years', { path: co(company), query: { limit: 50 } as never })) as unknown as CursorPage<ApiFiscalYear>;
  return page.data;
};

export const listRecurringJournals = (company: string, cursor: string | undefined): Promise<CursorPage<ApiRecurringSchedule>> =>
  http.get('/v1/companies/{company}/recurring-journals', { path: co(company), query: { cursor, limit: 100 } as never }) as Promise<CursorPage<ApiRecurringSchedule>>;

export const createRecurringJournal = async (company: string, body: unknown, intent: Intent): Promise<ApiRecurringSchedule> =>
  (await post<ApiRecurringSchedule>(`/v1/companies/${company}/recurring-journals`, body, intent)).data;

export const toggleRecurringJournal = async (company: string, id: string, action: 'pause' | 'resume', version: number, intent: Intent): Promise<ApiRecurringSchedule> =>
  (await post<ApiRecurringSchedule>(`/v1/companies/${company}/recurring-journals/${id}/${action}`, { version }, intent)).data;

export const runRecurring = async (company: string, body: { as_of?: string; schedule_id?: string }, intent: Intent) =>
  (await post<{ created: ApiRecurringRun[]; failures: string[] }>(`/v1/companies/${company}/recurring-runs`, body, intent)).data;

export const listMembers = async (): Promise<Array<{ user_id: string; name: string }>> => {
  const res = (await http.get('/v1/members')) as unknown as { data: Array<{ user_id: string; name: string }> };
  return res.data;
};
