/** Document PDFs, live side (step 3c.4). The server decides what may be printed; this shapes the requests. */

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

export type PdfOutcome = { state: 'pending' } | { state: 'failed' } | { state: 'ready'; blob: Blob; filename: string };

/** The file name from `Content-Disposition`, or a fallback. */
export function filenameFrom(header: string | null, fallback: string): string {
  const m = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  return m?.[1] ? decodeURIComponent(m[1]) : fallback;
}
