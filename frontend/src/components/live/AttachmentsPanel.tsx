/**
 * Files on a document (step 3c.2): add, list, scan state, download, remove. The server owns every rule: files can be added
 * to a posted document (flagged "added after posting") but never removed, a file is served only once the scan says clean,
 * and whether you may add, download or remove comes back as `can` on each file. This only shows those verdicts calmly.
 */
import React, { useRef, useState } from 'react';
import { FileText, Lock, Paperclip, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { IntentSlot } from '@/api/intentSlot';
import { ACCEPT, ALLOWED_SUMMARY, attachmentErrorText, fileProblem, formatBytes, scanLook, type AttachableType, type ApiAttachment } from '@/api/adapters/attachments';
import { useAttachmentActions, useAttachments, type UploadStage } from '@/data/attachments';
import { useMemberNames } from '@/data/approvals';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const STAGE_TEXT: Record<UploadStage, string> = { preparing: 'Preparing…', sending: 'Uploading…', finishing: 'Checking…' };
const TONE: Record<string, string> = {
  ok: 'bg-success-soft text-success',
  wait: 'bg-surface-neutral text-text-secondary',
  warn: 'bg-warning-soft text-warning',
  bad: 'bg-danger-soft text-danger',
};

export const AttachmentsPanel: React.FC<{
  type: AttachableType;
  parentId: string;
  /** Posted or reversed: the files are evidence. Shown as a note; the server enforces it. */
  posted: boolean;
  /** The person's role cannot attach here (from the document's own `can`, when it has one). Default: offer it; the server refuses if not. */
  canAdd?: boolean;
  className?: string;
}> = ({ type, parentId, posted, canAdd = true, className }) => {
  const list = useAttachments(type, parentId);
  const actions = useAttachmentActions(type, parentId);
  const names = useMemberNames();
  const askSlot = useRef(new IntentSlot()).current;
  const completeSlot = useRef(new IntentSlot()).current;
  const removeSlot = useRef(new IntentSlot()).current;
  const [stage, setStage] = useState<{ name: string; stage: UploadStage } | null>(null);
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const files = list.data ?? [];

  const add = async (picked: FileList | null) => {
    const file = picked?.[0];
    if (!file) return;
    setProblem('');
    const refused = fileProblem(file);
    if (refused) {
      setProblem(refused);
      return;
    }
    setStage({ name: file.name, stage: 'preparing' });
    try {
      const sig = JSON.stringify([type, parentId, file.name, file.size, file.lastModified]);
      const done = await actions.upload(file, { ask: askSlot.for(sig), complete: (id) => completeSlot.for(id) }, (s) => setStage({ name: file.name, stage: s }));
      askSlot.clear();
      completeSlot.clear();
      toast.success(done.added_after_posting ? `${file.name} added, marked as added after posting.` : `${file.name} added. It is being scanned.`);
    } catch (e) {
      setProblem(attachmentErrorText(e));
    } finally {
      setStage(null);
    }
  };

  const download = async (a: ApiAttachment) => {
    setBusyId(a.id);
    try {
      const t = await actions.download(a.id);
      const link = document.createElement('a');
      link.href = t.url;
      link.download = t.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      toast.error(attachmentErrorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (a: ApiAttachment) => {
    setBusyId(a.id);
    try {
      await actions.remove(a.id, removeSlot.for(a.id));
      removeSlot.clear();
      setConfirming(null);
      toast.success(`${a.filename} removed.`);
    } catch (e) {
      toast.error(attachmentErrorText(e));
      setConfirming(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={cn('no-print rounded-lg border border-border bg-surface', className)} aria-label="Files" data-testid="attachments-panel">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Paperclip className="size-4 text-text-muted" />
          Files{files.length > 0 && <span className="font-normal text-text-muted"> ({files.length})</span>}
        </h2>
        {canAdd && (
          <label className={cn('flex h-8 cursor-pointer items-center rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral', stage && 'pointer-events-none opacity-50')}>
            {stage ? STAGE_TEXT[stage.stage] : 'Add a file'}
            <input type="file" aria-label="Add a file" accept={ACCEPT} disabled={Boolean(stage)} className="sr-only" onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </header>

      {posted && (
        <p className="flex items-start gap-2 border-b border-border bg-surface-neutral/60 px-5 py-2 text-xs text-text-secondary">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
          This document is posted, so its files are evidence: you can add more, and they are marked as added after posting, but none can be removed.
        </p>
      )}
      {problem && <p role="alert" className="border-b border-border px-5 py-2 text-xs text-danger">{problem}</p>}

      {list.isLoading ? (
        <p role="status" className="px-5 py-4 text-[13px] text-text-muted">Loading files…</p>
      ) : list.error ? (
        <p role="alert" className="px-5 py-4 text-[13px] text-danger">
          {attachmentErrorText(list.error)}{' '}
          <button type="button" onClick={() => void list.refetch()} className="cursor-pointer text-accent hover:underline">Try again</button>
        </p>
      ) : files.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-text-muted">No files yet.{canAdd ? ` You can add ${ALLOWED_SUMMARY}.` : ''}</p>
      ) : (
        <ul className="divide-y divide-border">
          {files.map((a) => {
            const look = scanLook(a);
            const who = a.uploaded_by ? names.get(a.uploaded_by) : undefined;
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-[13px]">
                <div className="flex min-w-0 items-center gap-3">
                  {a.scan_status === 'infected' ? <ShieldAlert className="size-4 shrink-0 text-danger" /> : <FileText className="size-4 shrink-0 text-text-muted" />}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-text-primary" title={a.filename}>{a.filename}</div>
                    <div className="text-xs text-text-muted">
                      {formatBytes(a.size)} · {formatDateTime(a.created_at)}{who ? ` · ${who}` : ''}
                    </div>
                    {a.scan_status === 'infected' && a.scan_detail && <div className="text-xs text-danger">{a.scan_detail}</div>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {a.added_after_posting && <span className="rounded-[3px] bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">Added after posting</span>}
                  <span className={cn('rounded-[3px] px-2 py-0.5 text-[11px] font-medium', TONE[look.tone])}>{look.label}</span>
                  {a.can.download && (
                    <button type="button" disabled={busyId === a.id} onClick={() => void download(a)} className="h-7 cursor-pointer rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-neutral disabled:opacity-50">
                      Download
                    </button>
                  )}
                  {a.can.delete &&
                    (confirming === a.id ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="text-text-secondary">Remove it?</span>
                        <button type="button" disabled={busyId === a.id} onClick={() => void remove(a)} className="h-7 cursor-pointer rounded-md bg-danger px-2.5 font-medium text-white disabled:opacity-50">Remove</button>
                        <button type="button" onClick={() => setConfirming(null)} className="h-7 cursor-pointer rounded-md border border-border px-2.5 font-medium text-text-secondary hover:bg-surface-neutral">Keep</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirming(a.id)} className="h-7 cursor-pointer rounded-md px-2 text-xs font-medium text-text-muted hover:text-danger">Remove</button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
