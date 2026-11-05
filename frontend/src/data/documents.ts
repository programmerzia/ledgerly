/**
 * Document PDFs, live side (3c.4). A PDF is queued on the server; `downloadPdf` asks, waits for the worker and then saves the file.
 */
import { useCallback, useState } from 'react';
import * as live from '@/api/live/documents';
import type { DocFamily, StatementParams } from '@/api/adapters/documents';
import { createIntent } from '@/api/idempotency';
import { useRouteCompany } from './session';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Save a blob the way a download link would. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export class PdfFailed extends Error {
  constructor() {
    super('The PDF could not be made. Try again in a moment.');
  }
}

/** Ask for the PDF, wait for the worker (up to about 90 seconds), save it. One idempotency key per press. */
export function usePdfDownload(family: DocFamily, id: string) {
  const { id: companyId } = useRouteCompany();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (params?: StatementParams) => {
      setBusy(true);
      try {
        const { id: pdfId } = await live.requestPdf(companyId, family, id, params, createIntent());
        for (let attempt = 0; attempt < 60; attempt++) {
          await sleep(attempt < 4 ? 400 : 1500);
          const out = await live.fetchPdf(companyId, family, id, pdfId);
          if (out.state === 'ready') return saveBlob(out.blob, out.filename);
          if (out.state === 'failed') throw new PdfFailed();
        }
        throw new PdfFailed();
      } finally {
        setBusy(false);
      }
    },
    [companyId, family, id],
  );
  return { run, busy };
}
