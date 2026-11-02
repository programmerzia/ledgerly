import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { VersionConflict } from '@/components/domain/ConflictDialog';
import { cn } from '@/lib/utils';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import type { Intent } from '@/api/idempotency';
import { toApiDate } from '@/api/adapters/dates';
import { statusLabel, statusTone, toBillFromRequest, type ProcKind, type Tone } from '@/api/adapters/procurement';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { inputClass, tradeVerdictText } from '@/pages/Sales/live/parts';

export { BTN_ACCENT, BTN_GHOST, ErrorLine, LoadMore, LoadingLine, TableCard, inputClass, useDebounced } from '@/pages/Sales/live/parts';

/** Same pill as everywhere else (3 px, soft tint); only the words and tints for the procurement states are added here. */
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-neutral text-text-secondary',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
  danger: 'bg-danger-soft text-danger',
  violet: 'bg-violet-soft text-violet',
};

export const ProcStatusPill: React.FC<{ kind: ProcKind; status: string }> = ({ kind, status }) => (
  <span className={cn('inline-flex h-5 select-none items-center whitespace-nowrap rounded-[3px] px-1.5 text-xs font-medium', TONE[statusTone(status)])}>
    <span className="truncate">{statusLabel(kind, status)}</span>
  </span>
);

/** Status tabs, the same look as the invoice list. Each tab is a server filter. */
export const StatusTabs: React.FC<{ tabs: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void }> = ({ tabs, value, onChange }) => (
  <div className="flex flex-wrap items-center gap-1 border-b border-border" role="tablist">
    {tabs.map((t) => (
      <button
        key={t.value}
        type="button"
        role="tab"
        aria-selected={value === t.value}
        onClick={() => onChange(t.value)}
        className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', value === t.value ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}
      >
        {t.label}
      </button>
    ))}
  </div>
);

export const EmptyState: React.FC<{ title: string; hint: string; action?: { label: string; onClick: () => void } }> = ({ title, hint, action }) => (
  <div className="flex flex-col items-center px-6 py-14 text-center">
    <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
    <p className="mt-1 max-w-sm text-[13px] text-text-muted">{hint}</p>
    {action && (
      <button type="button" onClick={action.onClick} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
        {action.label}
      </button>
    )}
  </div>
);

/** A question with a free-text answer: return (comment), reject, cancel, reverse (reason), discard (optional). */
export const ReasonDialog: React.FC<{
  open: boolean;
  title: string;
  intro?: string;
  label: string;
  required?: boolean;
  confirm: string;
  /** danger = red, warning = amber (send back), accent = neutral. */
  tone?: 'danger' | 'warning' | 'accent';
  cancel?: string;
  value: string;
  onChange: (v: string) => void;
  problem?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}> = ({ open, title, intro, label, required = true, confirm, tone = 'danger', cancel = 'Cancel', value, onChange, problem, busy, onClose, onConfirm }) => (
  <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
      <DialogHeader>
        <DialogTitle className="text-base font-semibold text-text-primary">{title}</DialogTitle>
      </DialogHeader>
      {intro && <p className="text-xs text-text-secondary">{intro}</p>}
      <label htmlFor="proc-reason" className="text-xs font-semibold text-text-primary">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <textarea id="proc-reason" autoFocus rows={3} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
      <DialogFooter className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">
          {cancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={(required && !value.trim()) || busy}
          className={cn('h-9 rounded-md px-3 text-xs font-semibold text-white disabled:opacity-50', tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-accent')}
        >
          {confirm}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/**
 * One user action = one intent, kept until it succeeds, signed through the dialog if the server asks (docs/15 rule 7).
 * A 409 opens the ConflictDialog; any other failure is the server's verdict in plain words, in the open dialog or a toast.
 */
export function useActionRunner(opts: { noun: string; localVersion?: number; reload: () => void }) {
  const { run, signProps } = useSignedRun();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const slots = useRef(new Map<string, IntentSlot>());

  async function perform<T>(name: string, signature: string, sign: string | null, call: (intent: Intent) => Promise<T>, inDialog = false): Promise<T | undefined> {
    let slot = slots.current.get(name);
    if (!slot) slots.current.set(name, (slot = new IntentSlot()));
    const intent = slot.for(signature);
    setPending(sign);
    setBusy(true);
    setProblem('');
    try {
      const r = await run(() => call(intent));
      slot.clear();
      return r;
    } catch (e) {
      if (isSigningCancelled(e)) return undefined;
      if (e instanceof ApiError && e.isVersionConflict) {
        setConflict({
          noun: opts.noun,
          serverVersion: e.serverVersion,
          localVersion: opts.localVersion,
          onClose: () => setConflict(null),
          onReload: () => {
            setConflict(null);
            opts.reload();
          },
        });
        return undefined;
      }
      const msg = tradeVerdictText(e, true);
      if (inDialog) setProblem(msg);
      else toast.error(msg);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return { perform, busy, pending, problem, setProblem, conflict, signProps };
}

/** A quantity for display: the server's decimal string without trailing zeros ("2.000000" -> "2"). Text only. */
export function showQty(q: string | null | undefined): string {
  if (q === null || q === undefined || q === '') return '—';
  if (!q.includes('.')) return q;
  const t = q.replace(/0+$/, '').replace(/\.$/, '');
  return t === '' ? '0' : t;
}

/** "Create a bill" from an order or a receipt: a few optional header fields, then a draft bill that you check and submit. */
export const CreateBillDialog: React.FC<{
  open: boolean;
  from: 'order' | 'receipt';
  foreign: boolean;
  busy: boolean;
  problem: string;
  onClose: () => void;
  onCreate: (body: Record<string, unknown>) => void;
}> = ({ open, from, foreign, busy, problem, onClose, onCreate }) => {
  const [issue, setIssue] = useState(() => toApiDate(new Date()));
  const [due, setDue] = useState('');
  const [ref, setRef] = useState('');
  const [fx, setFx] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">Create a bill from this {from}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs text-text-secondary">
          <p>
            {from === 'order'
              ? 'This drafts a bill for what was received and is not billed yet (or for what was ordered, if nothing has arrived). You check it and submit it from the bill.'
              : 'This drafts a bill for the quantities on this receipt. You check it and submit it from the bill.'}
          </p>
          <label className="flex flex-col gap-1 font-semibold text-text-primary">
            Bill date
            <input type="date" aria-label="Bill date" value={issue} onChange={(e) => setIssue(e.target.value)} className={cn(inputClass, 'w-44 font-normal')} />
          </label>
          <label className="flex flex-col gap-1 font-semibold text-text-primary">
            Due date (optional)
            <input type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(inputClass, 'w-44 font-normal')} />
            <span className="text-[11px] font-normal text-text-muted">Left empty, it follows the supplier’s payment terms.</span>
          </label>
          <label className="flex flex-col gap-1 font-semibold text-text-primary">
            Supplier’s invoice number (optional)
            <input aria-label="Reference" value={ref} onChange={(e) => setRef(e.target.value)} className={cn(inputClass, 'w-full font-normal')} />
          </label>
          {foreign && (
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              Exchange rate (optional)
              <input aria-label="Exchange rate" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="Empty: the stored rate" className={cn(inputClass, 'w-44 font-normal')} />
            </label>
          )}
          {problem && (
            <p role="alert" className="text-xs font-medium text-danger">
              {problem}
            </p>
          )}
        </div>
        <DialogFooter className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onCreate(toBillFromRequest({ issue_date: issue, due_date: due, reference: ref, fx_rate: foreign ? fx : '' }))}
            disabled={busy || !issue}
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Create bill
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
