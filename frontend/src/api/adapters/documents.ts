/**
 * Document PDFs and email, live side (steps 3c.4, 3c.5). The server decides what may be printed or sent and says why not;
 * this only shapes the requests and the words for the send log.
 */
import type { components } from '../schema';

export type ApiSend = components['schemas']['DocumentSendResource'];

/** The route families that print. `contacts` is the statement. */
export type DocFamily = 'invoices' | 'bills' | 'settlements' | 'purchase-orders' | 'journals' | 'wht-certificates' | 'contacts';

/** The part of the path under /companies/{company}. */
export function docBasePath(family: DocFamily, id: string): string {
  return family === 'contacts' ? `contacts/${id}/statement` : `${family}/${id}`;
}

/** Statement parameters; `side` only when a contact is both customer and supplier. */
export interface StatementParams {
  from: string;
  to: string;
  side?: 'customer' | 'supplier';
}

export interface EmailDraft {
  document_type: string;
  recipients: string[];
  subject: string;
  body: string;
  contact_name: string;
  can_send: boolean;
}

/** "a@b.com, c@d.com; e@f.com" → three lower-case addresses, no blanks. */
export function parseRecipients(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const a = part.trim().toLowerCase();
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

export const looksLikeEmail = (a: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);

/** What the person sees for each outcome. `sent` means the mail server took it; a later bounce is not tracked. */
export const SEND_LOOK: Record<string, { label: string; tone: 'ok' | 'wait' | 'bad' }> = {
  queued: { label: 'Sending', tone: 'wait' },
  sent: { label: 'Sent', tone: 'ok' },
  failed: { label: 'Not sent', tone: 'bad' },
};

export const sendLook = (status: string) => SEND_LOOK[status] ?? { label: status, tone: 'wait' as const };

export const hasQueuedSend = (sends: ApiSend[] | undefined): boolean => (sends ?? []).some((s) => s.status === 'queued');

export type PdfOutcome = { state: 'pending' } | { state: 'failed' } | { state: 'ready'; blob: Blob; filename: string };

/** The file name from `Content-Disposition`, or a fallback. */
export function filenameFrom(header: string | null, fallback: string): string {
  const m = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  return m?.[1] ? decodeURIComponent(m[1]) : fallback;
}
