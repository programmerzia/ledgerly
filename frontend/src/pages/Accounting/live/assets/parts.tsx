/** Shared pieces of the live fixed assets screen: the write runner (intent, signing, conflicts), form bits and the document actions. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { SignDialog } from '@/components/domain/SignDialog';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { IntentSlot } from '@/api/intentSlot';
import { ApiError } from '@/api/errors';
import type { Intent } from '@/api/idempotency';
import { DOC_STATUS_LABEL, type DocCan, type DocStatus } from '@/api/adapters/fixedAssets';
import { verdictText } from '../parts';
import { cn } from '@/lib/utils';

export const fieldClass = 'h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-60';
export const primaryBtn = 'h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50';
export const secondaryBtn = 'h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral disabled:opacity-50';
export const linkBtn = 'cursor-pointer text-xs font-medium text-accent hover:underline disabled:opacity-50';

export const Field: React.FC<{ label: string; hint?: string; className?: string; children: React.ReactNode }> = ({ label, hint, className, children }) => (
  <label className={cn('flex flex-col gap-1 text-xs', className)}>
    <span className="text-[11px] font-medium text-text-muted">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
  </label>
);

export const MoneyField: React.FC<{ label: string; value: number; onChange: (v: number) => void; currency: string; hint?: string; className?: string }> = ({ label, value, onChange, currency, hint, className }) => (
  <div className={cn('flex flex-col gap-1 text-xs', className)}>
    <span className="text-[11px] font-medium text-text-muted">{label}</span>
    <MoneyInput value={value} onChange={onChange} currency={currency} size="sm" />
    {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
  </div>
);

export const Problem: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
      {message}
    </p>
  ) : null;

export const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-md border border-border bg-surface-neutral px-3 py-2 text-[11px] leading-relaxed text-text-muted">{children}</p>
);

export const DialogShell: React.FC<{ open: boolean; onClose: () => void; title: string; wide?: boolean; children: React.ReactNode; footer: React.ReactNode }> = ({ open, onClose, title, wide, children, footer }) => (
  <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className={cn('max-h-[90vh] overflow-y-auto p-5', wide ? 'max-w-[760px]' : 'max-w-[520px]')}>
      <DialogHeader>
        <DialogTitle className="text-sm font-semibold text-text-primary">{title}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-3 text-xs">{children}</div>
      <DialogFooter className="gap-2 border-t border-border pt-3">{footer}</DialogFooter>
    </DialogContent>
  </Dialog>
);

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-surface-neutral text-text-secondary',
  pending_approval: 'bg-warning-soft text-warning',
  posted: 'bg-success-soft text-success',
  reversed: 'bg-surface-neutral text-text-muted',
  void: 'bg-surface-neutral text-text-muted',
  active: 'bg-success-soft text-success',
  fully_depreciated: 'bg-surface-neutral text-text-secondary',
  disposed: 'bg-surface-neutral text-text-muted',
};

export const Badge: React.FC<{ tone?: string; children: React.ReactNode; title?: string }> = ({ tone = 'draft', children, title }) => (
  <span title={title} className={cn('inline-flex items-center rounded-[3px] px-1.5 py-px text-xs font-medium', STATUS_STYLE[tone] ?? 'bg-surface-neutral text-text-secondary')}>
    {children}
  </span>
);

export const DocStatusBadge: React.FC<{ status: DocStatus }> = ({ status }) => <Badge tone={status}>{DOC_STATUS_LABEL[status] ?? status}</Badge>;

/* ------------------------------------------------------------------ the write runner */

export interface SignInfo {
  title: string;
  number?: string;
  amount?: number;
  action: string;
  text: string;
}

export interface ExecOptions {
  /** What is being edited, for the version-conflict dialog. */
  noun: string;
  /** Shown in the signing dialog if the server asks for the PIN. */
  sign?: SignInfo;
  /** Show the problem inside a dialog instead of a toast. */
  onProblem?: (message: string) => void;
}

/**
 * One runner for every write on the screen. Each action key has its own IntentSlot, so a retry after a network error
 * or a PIN prompt reuses the key and cannot post twice; `signature` changes when the payload does.
 */
export function useWriter(reload: () => void) {
  const slots = useRef(new Map<string, IntentSlot>());
  const { run, signProps } = useSignedRun();
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sign, setSign] = useState<SignInfo>({ title: 'Fixed assets', action: 'Sign', text: '' });

  const exec = async <T,>(key: string, signature: string, fn: (intent: Intent) => Promise<T>, o: ExecOptions): Promise<T | undefined> => {
    let slot = slots.current.get(key);
    if (!slot) slots.current.set(key, (slot = new IntentSlot()));
    const intent = slot.for(signature);
    if (o.sign) setSign(o.sign);
    setBusy(key);
    try {
      const r = await run(() => fn(intent));
      slot.clear();
      return r;
    } catch (e) {
      if (isSigningCancelled(e)) return undefined;
      if (e instanceof ApiError && e.isVersionConflict) {
        setConflict({ noun: o.noun, serverVersion: e.serverVersion, onClose: () => setConflict(null), onReload: () => { setConflict(null); reload(); } });
        return undefined;
      }
      const message = verdictText(e);
      if (o.onProblem) o.onProblem(message);
      else toast.error(message);
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const dialogs = (
    <>
      <SignDialog {...signProps} documentTitle={sign.title} documentNumber={sign.number} amount={sign.amount} actionTitle={sign.action} consequenceText={sign.text} />
      <ConflictDialog conflict={conflict} />
    </>
  );
  return { exec, busy, dialogs };
}

export type Writer = ReturnType<typeof useWriter>;

/* ------------------------------------------------------------------ document actions (runs and transactions) */

export interface WorkflowDoc {
  id: string;
  number: string;
  status: DocStatus;
  version: number;
  can: DocCan;
}

type Step = 'submit' | 'approve' | 'return' | 'void' | 'reverse';

/**
 * Submit / approve / send back / cancel / reverse for one document. Submit, approve and reverse are signed; the server
 * decides whether submit posts at once or goes to the approvals inbox, and refuses approval by the maker.
 */
export const DocActions: React.FC<{
  doc: WorkflowDoc;
  noun: string;
  total: number;
  writer: Writer;
  perform: (step: Step, body: Record<string, unknown>, intent: Intent) => Promise<unknown>;
}> = ({ doc, noun, total, writer, perform }) => {
  const [asking, setAsking] = useState<null | 'return' | 'void' | 'reverse'>(null);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const label = doc.number || 'Draft';
  const title = `${noun}: ${label}`;

  const go = async (step: Step, body: Record<string, unknown>, success: string, text2: string, onProblem?: (m: string) => void) => {
    const r = await writer.exec(`${noun}:${doc.id}:${step}`, JSON.stringify([doc.version, step, body]), (intent) => perform(step, { ...body, version: doc.version }, intent), {
      noun: noun.toLowerCase(),
      sign: { title, number: doc.number || undefined, amount: total, action: step === 'approve' ? 'Approve and post' : step === 'reverse' ? 'Reverse' : 'Submit', text: text2 },
      onProblem,
    });
    if (r !== undefined) toast.success(success);
    return r !== undefined;
  };

  const confirmAsk = async () => {
    if (!asking) return;
    const note = text.trim();
    const step = asking;
    const ok =
      step === 'return'
        ? await go('return', { comment: note }, 'Sent back as a draft', '', setProblem)
        : step === 'void'
          ? await go('void', note ? { reason: note } : {}, 'Draft cancelled', '', setProblem)
          : await go('reverse', note ? { memo: note } : {}, 'Reversed', 'Reversing posts a mirror-image journal and undoes the effect on the register.', setProblem);
    if (ok) {
      setAsking(null);
      setText('');
    }
  };

  const open = (kind: 'return' | 'void' | 'reverse') => { setProblem(null); setText(''); setAsking(kind); };
  const busy = writer.busy?.startsWith(`${noun}:${doc.id}:`) ?? false;
  const small = 'h-7 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text-primary transition hover:bg-surface-neutral disabled:opacity-50';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {doc.can.submit && (
        <button type="button" disabled={busy} onClick={() => void go('submit', {}, 'Submitted', 'If your company has no approval step this posts straight away. Otherwise it goes to the approvals inbox for a second person.')} className="h-7 rounded-md bg-accent px-2.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          Submit
        </button>
      )}
      {doc.can.approve && (
        <button type="button" disabled={busy} onClick={() => void go('approve', {}, 'Approved', 'Approving posts the journal. The person who prepared it cannot approve it.')} className="h-7 rounded-md bg-success px-2.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          Approve
        </button>
      )}
      {doc.can.return && <button type="button" disabled={busy} onClick={() => open('return')} className={small}>Send back</button>}
      {doc.can.void && <button type="button" disabled={busy} onClick={() => open('void')} className={small}>Cancel draft</button>}
      {doc.can.reverse && <button type="button" disabled={busy} onClick={() => open('reverse')} className={small}>Reverse</button>}

      <DialogShell
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking === 'return' ? 'Send back for changes' : asking === 'void' ? 'Cancel this draft' : 'Reverse this posting'}
        footer={
          <>
            <button type="button" onClick={() => setAsking(null)} className={secondaryBtn}>Close</button>
            <button type="button" disabled={busy || (asking === 'return' && !text.trim())} onClick={() => void confirmAsk()} className={primaryBtn}>
              {asking === 'return' ? 'Send back' : asking === 'void' ? 'Cancel draft' : 'Reverse'}
            </button>
          </>
        }
      >
        <p className="text-text-secondary">{label}</p>
        <Field label={asking === 'return' ? 'Why are you sending it back?' : asking === 'void' ? 'Reason (optional)' : 'Note (optional)'}>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} className="rounded-md border border-border bg-surface p-2 text-xs text-text-primary focus:border-accent focus:outline-none" />
        </Field>
        {asking === 'reverse' && <Note>Reversing is refused while later activity stands on the same assets. The server will tell you what is in the way.</Note>}
        <Problem message={problem} />
      </DialogShell>
    </div>
  );
};

/** Today as YYYY-MM-DD in the browser's calendar. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
