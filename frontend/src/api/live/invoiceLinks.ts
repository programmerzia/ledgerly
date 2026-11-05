/** Live calls for the online invoice link (3c.7b), on both sides: the issuer's (signed in) and the customer's (public). */
import { API_BASE_URL } from '../config';
import { NetworkError } from '../errors';
import { http } from '../http';
import type { Intent } from '../idempotency';
import type { ApiLink, PublicInvoice } from '../adapters/invoiceLinks';

const root = (companyId: string, invoiceId: string) => `/v1/companies/${encodeURIComponent(companyId)}/invoices/${encodeURIComponent(invoiceId)}/share-links`;

export const listLinks = async (companyId: string, invoiceId: string): Promise<ApiLink[]> =>
  (await http.send<{ data: ApiLink[] }>('GET', root(companyId, invoiceId))).data;

/** The address comes back once, in `url`. */
export const createLink = async (companyId: string, invoiceId: string, expiresInDays: number | null, intent: Intent): Promise<ApiLink & { url: string }> =>
  (await http.send<{ data: ApiLink & { url: string } }>('POST', root(companyId, invoiceId), { expires_in_days: expiresInDays }, intent)).data;

export const revokeLink = async (companyId: string, invoiceId: string, linkId: string, intent: Intent): Promise<ApiLink> =>
  (await http.send<{ data: ApiLink }>('POST', `${root(companyId, invoiceId)}/${encodeURIComponent(linkId)}/revoke`, {}, intent)).data;

/* ------------------------------------------------------------------ the customer's page: no session, no cookies, no headers of ours */

export type PublicOutcome = { state: 'ok'; invoice: PublicInvoice } | { state: 'gone' } | { state: 'busy' } | { state: 'error' };

async function publicGet(path: string): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}/api/v1/public/${path}`, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json, application/pdf' } });
  } catch (e) {
    throw new NetworkError(e);
  }
}

export async function fetchPublicInvoice(token: string): Promise<PublicOutcome> {
  const res = await publicGet(`invoices/${encodeURIComponent(token)}`);
  if (res.status === 404) return { state: 'gone' };
  if (res.status === 429) return { state: 'busy' };
  if (!res.ok) return { state: 'error' };
  return { state: 'ok', invoice: ((await res.json()) as { data: PublicInvoice }).data };
}

export type PublicPdf = { state: 'ready'; blob: Blob; filename: string } | { state: 'pending' } | { state: 'failed' } | { state: 'gone' } | { state: 'busy' };

/** Asks for the PDF: pending while it is being made (ask again), the file once it is ready. */
export async function fetchPublicPdf(token: string, retry = false): Promise<PublicPdf> {
  const res = await publicGet(`invoices/${encodeURIComponent(token)}/pdf${retry ? '?retry=1' : ''}`);
  if (res.status === 404) return { state: 'gone' };
  if (res.status === 429) return { state: 'busy' };
  if ((res.headers.get('Content-Type') ?? '').includes('application/pdf')) {
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'invoice.pdf';
    return { state: 'ready', blob: await res.blob(), filename: name };
  }
  const json = (await res.json().catch(() => null)) as { data?: { status?: string } } | null;
  return json?.data?.status === 'failed' ? { state: 'failed' } : { state: 'pending' };
}
