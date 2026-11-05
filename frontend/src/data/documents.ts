/**
 * Document PDFs and email, live side (3c.4, 3c.5). Query key: ['document-sends', companyId, family, id].
 * A PDF is queued on the server; `downloadPdf` asks, waits for the worker and then saves the file.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as live from '@/api/live/documents';
import { hasQueuedSend, type DocFamily, type StatementParams } from '@/api/adapters/documents';
import { createIntent, type Intent } from '@/api/idempotency';
import { useRouteCompany } from './session';

export const sendsKey = (companyId: string, family: DocFamily, id: string) => ['document-sends', companyId, family, id] as const;

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

export function useEmailDraft(family: DocFamily, id: string, params: StatementParams | undefined, enabled: boolean) {
  const { id: companyId } = useRouteCompany();
  return useQuery({
    queryKey: ['document-email-draft', companyId, family, id, params?.from, params?.to, params?.side],
    queryFn: () => live.fetchEmailDraft(companyId, family, id, params),
    enabled,
    retry: false,
    gcTime: 0,
  });
}

/** The send log, refreshed every 2 seconds while a mail is still on its way. */
export function useSends(family: DocFamily, id: string, enabled = true) {
  const { id: companyId } = useRouteCompany();
  return useQuery({
    queryKey: sendsKey(companyId, family, id),
    queryFn: () => live.listSends(companyId, family, id),
    enabled,
    retry: false,
    refetchInterval: (q) => (hasQueuedSend(q.state.data) ? 2000 : false),
  });
}

export function useSendEmail(family: DocFamily, id: string) {
  const { id: companyId } = useRouteCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, intent }: { body: live.SendBody; intent: Intent }) => live.sendEmail(companyId, family, id, body, intent),
    onSuccess: () => qc.invalidateQueries({ queryKey: sendsKey(companyId, family, id) }),
  });
}
