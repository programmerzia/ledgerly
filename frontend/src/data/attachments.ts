/**
 * Attachments, live side (step 3c.2). Query key: ['attachments', companyId, type, parentId]. While a file waits for its
 * scan verdict the list refreshes every 3 seconds.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as live from '@/api/live/attachments';
import { awaitsScan, contentTypeOf, fileProblem, sha256Hex, UploadFailed, type AttachableType, type ApiAttachment } from '@/api/adapters/attachments';
import type { Intent } from '@/api/idempotency';
import { useRouteCompany } from './session';

export const attachmentsKey = (companyId: string, type: AttachableType, parentId: string) => ['attachments', companyId, type, parentId] as const;

export function useAttachments(type: AttachableType, parentId: string | undefined) {
  const { id } = useRouteCompany();
  return useQuery({
    queryKey: attachmentsKey(id, type, parentId ?? 'none'),
    queryFn: () => live.listAttachments(id, type, parentId as string),
    enabled: Boolean(parentId),
    retry: false,
    refetchInterval: (q) => (q.state.data && awaitsScan(q.state.data) ? 3000 : false),
  });
}

export type UploadStage = 'preparing' | 'sending' | 'finishing';

export function useAttachmentActions(type: AttachableType, parentId: string) {
  const { id: companyId } = useRouteCompany();
  const qc = useQueryClient();
  return useMemo(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: attachmentsKey(companyId, type, parentId) });
    return {
      /** Fingerprint, ask, send, complete. `intents` hands out the keys, so a retry of the same file reuses them. */
      upload: async (file: File, intents: { ask: Intent; complete: (attachmentId: string) => Intent }, onStage?: (s: UploadStage) => void): Promise<ApiAttachment> => {
        const problem = fileProblem(file);
        const mime = contentTypeOf(file);
        if (problem || !mime) throw new UploadFailed(problem ?? 'That file type cannot be attached.');
        onStage?.('preparing');
        const sha256 = await sha256Hex(await file.arrayBuffer());
        const { attachment, upload } = await live.requestUpload(companyId, { attachable_type: type, attachable_id: parentId, filename: file.name, mime, size: file.size, sha256 }, intents.ask);
        try {
          onStage?.('sending');
          await live.putBytes(upload, file);
          onStage?.('finishing');
          return await live.completeUpload(companyId, attachment.id, intents.complete(attachment.id));
        } finally {
          void refresh();
        }
      },
      download: (attachmentId: string) => live.downloadTarget(companyId, attachmentId),
      remove: async (attachmentId: string, intent: Intent) => {
        await live.removeAttachment(companyId, attachmentId, intent);
        await refresh();
      },
    };
  }, [companyId, type, parentId, qc]);
}
