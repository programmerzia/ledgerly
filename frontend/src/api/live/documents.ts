/** Live calls for document PDFs and email (3c.4, 3c.5). A PDF is queued by the server and fetched when ready. */
import { API_BASE_URL } from '../config';
import { NetworkError, problemToError } from '../errors';
import { http } from '../http';
import type { Intent } from '../idempotency';
import { docBasePath, filenameFrom, type DocFamily, type PdfOutcome, type StatementParams } from '../adapters/documents';

const root = (company: string, family: DocFamily, id: string) => `/v1/companies/${company}/${docBasePath(family, id)}`;

export const requestPdf = async (company: string, family: DocFamily, id: string, params: StatementParams | undefined, intent?: Intent): Promise<{ id: string; status: string }> =>
  (await http.send<{ data: { id: string; status: string } }>('POST', `${root(company, family, id)}/pdf`, params ?? {}, intent)).data;

/** The status of a queued PDF, or the file itself once it is ready (a GET, so no CSRF or idempotency key). */
export async function fetchPdf(company: string, family: DocFamily, id: string, pdfId: string): Promise<PdfOutcome> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api${root(company, family, id)}/pdf/${pdfId}`, { credentials: 'include', headers: { Accept: 'application/pdf, application/json', 'X-Requested-With': 'XMLHttpRequest' } });
  } catch (e) {
    throw new NetworkError(e);
  }
  if ((res.headers.get('Content-Type') ?? '').includes('application/pdf')) {
    return { state: 'ready', blob: await res.blob(), filename: filenameFrom(res.headers.get('Content-Disposition'), 'document.pdf') };
  }
  const text = await res.text();
  let json: { data?: { status?: string } } | null = null;
  try {
    json = text ? (JSON.parse(text) as { data?: { status?: string } }) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw problemToError(res.status, json, res.headers);
  return json?.data?.status === 'failed' ? { state: 'failed' } : { state: 'pending' };
}

/** Logo upload (multipart, field `file`) and removal. */
export const uploadLogo = async (company: string, file: File, intent: Intent): Promise<void> => {
  const form = new FormData();
  form.append('file', file);
  await http.send('POST', `/v1/companies/${company}/settings/logo`, form, intent);
};

export const removeLogo = async (company: string, intent: Intent): Promise<void> => {
  await http.send('DELETE', `/v1/companies/${company}/settings/logo`, undefined, intent);
};

export const logoUrl = (company: string, version: number): string => `${API_BASE_URL}/api/v1/companies/${company}/settings/logo?v=${version}`;
