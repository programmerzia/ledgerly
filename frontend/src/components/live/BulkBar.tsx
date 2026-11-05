/**
 * The pieces every live list shares for bulk actions (plan 3c.33): the bar that appears under a selection, the
 * confirmation for discarding drafts, and the sheet that lists what happened to each document. Same look as the
 * approvals inbox's bar and results.
 */
import React, { useEffect, useState } from 'react';
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { summarise, type BulkResult } from '@/data/bulk';

export interface BulkAction {
  key: string;
  label: string;
  /** How many of the selected rows the action is offered for. Zero disables the button. */
  count: number;
  onClick: () => void;
  danger?: boolean;
  /** Why it is disabled, or what it will skip. */
  title?: string;
}

export const BulkBar: React.FC<{ selected: number; actions: BulkAction[]; busy?: boolean; onClear: () => void; hint?: React.ReactNode }> = ({ selected, actions, busy, onClear, hint }) => {
  useEffect(() => {
    if (selected === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(document.activeElement instanceof HTMLTextAreaElement) && !document.querySelector('[role="dialog"]')) onClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onClear]);
  if (selected === 0) return null;
  return (
    <div role="toolbar" aria-label="Actions for selected rows" data-testid="bulk-bar" className="sticky bottom-4 z-30 mx-auto flex max-w-full flex-wrap items-center gap-3 rounded-lg border border-border-strong bg-surface-elevated py-2 pl-4 pr-2 shadow-popover">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
        <span className="flex size-5 items-center justify-center rounded-md bg-accent text-[11px] text-white">{selected}</span>
        selected
      </span>
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          disabled={busy || a.count === 0}
          title={a.title}
          onClick={a.onClick}
          className={cn(
            'flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
            a.danger ? 'border-border bg-surface text-text-secondary hover:border-danger/50 hover:bg-danger-soft hover:text-danger' : 'border-border bg-surface text-text-primary hover:bg-surface-neutral',
          )}
        >
          {a.label}
          {a.count !== selected && a.count > 0 && <span className="text-text-muted">({a.count} of {selected})</span>}
        </button>
      ))}
      {hint && <span className="max-w-xs text-xs text-text-muted">{hint}</span>}
      <button type="button" onClick={onClear} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs text-text-muted hover:bg-surface-neutral hover:text-text-primary">
        Clear <Kbd>Esc</Kbd>
      </button>
    </div>
  );
};

export const BulkDiscardDialog: React.FC<{ count: number; noun: string; open: boolean; onCancel: () => void; onConfirm: (reason: string) => void }> = ({ count, noun, open, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[460px] p-5">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Discard {count} draft {count === 1 ? noun : `${noun}s`}?
          </DialogTitle>
          <DialogDescription className="text-xs text-text-secondary">
            Nothing has been posted, so nothing in the books changes. Each draft is discarded on its own; any that cannot be discarded are listed afterwards with the reason.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor="bulk-discard-reason" className="text-xs font-semibold text-text-primary">
          Reason (optional)
        </label>
        <textarea id="bulk-discard-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
        <DialogFooter className="gap-2 border-t border-border pt-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary hover:bg-surface-neutral">
            Keep them
          </button>
          <button type="button" onClick={() => onConfirm(reason.trim())} className="h-8 rounded-lg bg-danger px-4 text-xs font-semibold text-white hover:opacity-90">
            Discard {count}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const BulkResultsSheet: React.FC<{ result: BulkResult | null; title: string; onClose: () => void }> = ({ result, title, onClose }) => (
  <Sheet open={result !== null} onOpenChange={(o) => !o && onClose()}>
    <SheetContent className="flex w-full flex-col gap-4 sm:max-w-md">
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{result && summarise(result)}</SheetDescription>
      </SheetHeader>
      <ul className="flex flex-1 flex-col gap-2 overflow-auto" data-testid="bulk-results">
        {result?.outcomes.map((o) => (
          <li key={o.id} className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3" data-state={o.state}>
            {o.state === 'done' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : o.state === 'refused' ? <XCircle className="mt-0.5 size-4 shrink-0 text-warning" /> : <MinusCircle className="mt-0.5 size-4 shrink-0 text-text-muted" />}
            <div className="min-w-0 text-[13px]">
              <div className="truncate font-medium text-text-primary">{o.label}</div>
              <div className={cn('text-xs', o.state === 'done' ? 'text-text-muted' : o.state === 'refused' ? 'text-warning' : 'text-text-muted')}>
                {o.state === 'refused' ? `Refused: ${o.text}` : o.text}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClose} className="h-8 rounded-md bg-accent text-[13px] font-medium text-white hover:bg-accent-hover">
        Done
      </button>
    </SheetContent>
  </Sheet>
);
