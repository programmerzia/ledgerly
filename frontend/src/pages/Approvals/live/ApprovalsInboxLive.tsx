import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle, CheckCircle2, Clock, ExternalLink, Lock, RotateCcw, XCircle } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { Avatar } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useApprovalInbox, useBulkApprove } from '@/data/approvals';
import { useJournalActions } from '@/data/journals';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { IntentSlot } from '@/api/intentSlot';
import { ApiError } from '@/api/errors';
import type { ApprovalItem, BulkResultRow } from '@/api/adapters/journal';
import { ErrorLine, LoadingLine, verdictText } from '@/pages/Accounting/live/parts';

const GROUPS = [
  { type: 'sales_invoice', label: 'Sales invoices' },
  { type: 'purchase_bill', label: 'Supplier bills' },
  { type: 'manual_journal', label: 'Manual journals' },
  { type: 'settlement', label: 'Receipts and payments' },
  { type: 'payment_run', label: 'Payment runs' },
] as const;

/** The server's reason codes for a skipped document, in words. Unknown codes fall back to the server's reason. */
function skipText(r: BulkResultRow): string {
  switch (r.code) {
    case 'self_approval_forbidden':
      return 'You prepared this, so someone else has to approve it.';
    case 'not_found':
      return 'It no longer exists in this company.';
    case 'document_not_pending':
      return 'It is no longer waiting for approval.';
    case 'forbidden':
      return 'You do not have permission to approve this.';
    default:
      return r.reason || r.code || 'Skipped';
  }
}

const ageLabel = (iso: string) => {
  if (!iso) return '';
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? 'waiting since today' : days === 1 ? 'waiting 1 day' : `waiting ${days} days`;
};

/**
 * The live inbox. GET /approvals already lists only what this person could sign now, so there is no "sent by me"
 * view (the endpoint does not provide one) and no client-side filtering of the list.
 */
export const ApprovalsInboxLive: React.FC = () => {
  const navigate = useNavigate();
  const coSlug = useLedgerStore((s) => s.currentCompany.slug);
  const me = useLedgerStore((s) => s.currentUser);
  const inbox = useApprovalInbox();
  const bulkApprove = useBulkApprove();
  const journalActions = useJournalActions();
  const { run, signProps } = useSignedRun();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [signFor, setSignFor] = useState<ApprovalItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ item: ApprovalItem; row: BulkResultRow | null }> | null>(null);
  const [returning, setReturning] = useState<ApprovalItem | null>(null);
  const [comment, setComment] = useState('');
  const bulkSlot = useRef(new IntentSlot()).current;
  const returnSlot = useRef(new IntentSlot()).current;

  const items = inbox.data;
  const makerOf = (i: ApprovalItem) => (i.maker_id === me.id ? me.name : (i.maker_name ?? 'a colleague'));
  const selectedItems = items.filter((i) => selected.has(i.id));
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if (selected.size === 0 || results) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(document.activeElement instanceof HTMLTextAreaElement)) setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, results]);

  /** One or many: the same endpoint reports each document on its own. One intent per press of the button. */
  const approve = async (batch: ApprovalItem[]) => {
    if (batch.length === 0) return;
    setSignFor(batch);
    setBusy(true);
    const intent = bulkSlot.for(batch.map((b) => b.document_id).sort().join(','));
    try {
      const rows = await run(() => bulkApprove(batch, intent));
      bulkSlot.clear();
      setResults(batch.map((item) => ({ item, row: rows.find((r) => r.id === item.document_id) ?? null })));
      setSelected(new Set());
      const ok = rows.filter((r) => r.ok).length;
      toast[ok === rows.length ? 'success' : 'message'](`${ok} of ${rows.length} approved`);
    } catch (e) {
      if (!isSigningCancelled(e)) toast.error(verdictText(e));
    } finally {
      setBusy(false);
    }
  };

  const sendBack = async () => {
    if (!returning || !comment.trim()) return;
    const item = returning;
    const text = comment.trim();
    setBusy(true);
    try {
      await run(() => journalActions.sendBack(item.document_id, text, item.version, returnSlot.for(`${item.document_id}:${item.version}:${text}`)));
      returnSlot.clear();
      toast.success('Sent back to the maker as a draft');
      setReturning(null);
      setComment('');
    } catch (e) {
      if (isSigningCancelled(e)) return;
      if (e instanceof ApiError && e.isVersionConflict) {
        toast.error('It changed while you were looking. The list has been refreshed.');
        setReturning(null);
        inbox.refetch();
      } else toast.error(verdictText(e));
    } finally {
      setBusy(false);
    }
  };

  const openDoc = (i: ApprovalItem) => {
    const path = i.document_type === 'sales_invoice' ? 'invoices' : i.document_type === 'purchase_bill' ? 'bills' : i.document_type === 'manual_journal' ? 'journals' : null;
    if (path) navigate(`/${coSlug}/${path}/${i.document_id}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        subtitle="Documents are posted only after a second person approves them."
        meta={
          <span className="rounded-[3px] border border-border bg-surface-neutral px-2.5 py-0.5 text-xs text-text-secondary">
            Signed in as <span className="font-medium text-text-primary">{me.name}</span>
          </span>
        }
      />

      <div className="flex items-center gap-1 border-b border-border" role="tablist">
        <span role="tab" aria-selected className="-mb-px flex items-center gap-2 border-b-2 border-accent px-4 py-2.5 text-[13px] font-medium text-accent">
          Waiting for me
          <span className="rounded-[3px] bg-warning-soft px-1.5 text-[11px] font-semibold tabular-nums text-warning">{inbox.isLoading ? '…' : items.length}</span>
        </span>
      </div>

      {items.length > 0 && (
        <div className="-mb-2 flex items-center gap-2.5 text-[13px] text-text-secondary">
          <Checkbox checked={allSelected} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))} aria-label="Select all documents waiting for me" />
          <span className="font-medium">Select all ({items.length})</span>
        </div>
      )}

      {inbox.isLoading ? (
        <LoadingLine what="approvals" />
      ) : inbox.error ? (
        <div className="rounded-lg border border-border bg-surface">
          <ErrorLine error={inbox.error} onRetry={inbox.refetch} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-border bg-surface px-6 py-16 text-center">
          <h3 className="text-sm font-semibold text-text-primary">Nothing to approve</h3>
          <p className="mt-1 max-w-sm text-[13px] text-text-muted">Nothing is waiting for your approval. New requests will show up here.</p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const rows = items.filter((i) => i.document_type === g.type);
          if (rows.length === 0) return null;
          return (
            <section key={g.type} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-text-primary">{g.label}</h2>
                <span className="text-xs text-text-muted">{rows.length}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {rows.map((item) => {
                  const mine = item.maker_id === me.id;
                  const maker = makerOf(item);
                  return (
                    <div key={item.id} data-testid="approval-card" className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong md:flex-row md:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        {mine ? (
                          <span title="You prepared this, so someone else must approve it" className="flex size-4 shrink-0 items-center justify-center text-text-muted">
                            <Lock className="size-3.5" />
                          </span>
                        ) : (
                          <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} aria-label={`Select ${item.document_number || item.title}`} data-testid="approval-select" />
                        )}
                        <Avatar name={maker} size="lg" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-text-primary">{item.title}</span>
                            {item.document_number && <span className="shrink-0 rounded bg-surface-neutral px-1.5 py-0.5 text-[11px] text-text-secondary">{item.document_number}</span>}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                            <span>
                              Sent by <span className="font-medium text-text-secondary">{maker}</span>
                            </span>
                            <span aria-hidden>·</span>
                            <span className="flex items-center gap-1" title={formatDateTime(item.submitted_at)}>
                              <Clock className="size-3" />
                              {ageLabel(item.submitted_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-5 md:justify-end">
                        <div className="text-right text-base font-medium tabular-nums text-text-primary">{formatMoney(item.amount, item.currency)}</div>
                        <div className="flex items-center gap-2">
                          {(item.document_type === 'sales_invoice' || item.document_type === 'purchase_bill' || item.document_type === 'manual_journal') && (
                            <button type="button" onClick={() => openDoc(item)} className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-secondary transition hover:bg-surface-neutral hover:text-text-primary">
                              <ExternalLink className="size-3.5" />
                              Open
                            </button>
                          )}
                          {mine ? (
                            <span className="cursor-not-allowed rounded-lg bg-surface-neutral px-2.5 py-1.5 text-xs font-medium text-text-muted" title="You prepared this, so someone else has to approve it.">
                              Waiting for another approver
                            </span>
                          ) : (
                            <>
                              {item.document_type === 'manual_journal' && (
                                <button
                                  type="button"
                                  onClick={() => setReturning(item)}
                                  className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-secondary transition hover:border-danger/50 hover:bg-danger-soft hover:text-danger"
                                >
                                  <RotateCcw className="size-3.5" />
                                  Return
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void approve([item])}
                                className="flex h-8 items-center gap-1.5 rounded-lg bg-success px-3.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                              >
                                <CheckCircle className="size-3.5" />
                                Approve
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {selectedItems.length > 0 && (
        <div role="toolbar" aria-label="Approve selected" className="sticky bottom-4 z-30 mx-auto flex max-w-full items-center gap-3 rounded-lg border border-border-strong bg-surface-elevated py-2 pl-4 pr-2 shadow-popover">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
            <span className="flex size-5 items-center justify-center rounded-md bg-accent text-[11px] text-white">{selectedItems.length}</span>
            selected
          </span>
          <button type="button" disabled={busy} onClick={() => void approve(selectedItems)} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-success px-3.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            <CheckCircle className="size-3.5" /> Approve {selectedItems.length}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs text-text-muted hover:bg-surface-neutral hover:text-text-primary">
            Clear <Kbd>Esc</Kbd>
          </button>
        </div>
      )}

      <Dialog open={returning !== null} onOpenChange={(o) => !o && setReturning(null)}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <RotateCcw className="size-4 text-warning" />
              Send back for changes
            </DialogTitle>
          </DialogHeader>
          {returning && (
            <div className="flex flex-col gap-2 text-xs text-text-secondary">
              <p>
                Return <strong className="text-text-primary">{returning.document_number || returning.title}</strong> to <strong className="text-text-primary">{makerOf(returning)}</strong> for correction.
              </p>
              <label htmlFor="ret-reason" className="mt-2 font-semibold text-text-primary">
                Why are you sending it back?
              </label>
              <textarea id="ret-reason" autoFocus rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          )}
          <DialogFooter className="gap-2 border-t border-border pt-2">
            <button type="button" onClick={() => setReturning(null)} className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary hover:bg-surface-neutral">Cancel</button>
            <button type="button" onClick={() => void sendBack()} disabled={busy || !comment.trim()} className="h-8 rounded-lg bg-warning px-4 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Send back</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog
        {...signProps}
        documentTitle={signFor.length === 1 ? signFor[0].title : `${signFor.length} documents waiting for approval`}
        documentNumber={signFor.length === 1 ? signFor[0].document_number || undefined : undefined}
        amount={signFor.length === 1 ? signFor[0].amount : undefined}
        currency={signFor[0]?.currency}
        actionTitle={signFor.length === 1 ? 'Approve and post' : `Approve ${signFor.length}`}
        consequenceText="Your PIN is checked once. Each document is then approved and posted on its own, and any that cannot be approved are listed afterwards with the reason."
      />

      <Sheet open={results !== null} onOpenChange={(o) => !o && setResults(null)}>
        <SheetContent className="flex w-full flex-col gap-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Approval results</SheetTitle>
            <SheetDescription>{results && `${results.filter((r) => r.row?.ok).length} of ${results.length} approved.`}</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-1 flex-col gap-2 overflow-auto" data-testid="bulk-results">
            {results?.map(({ item, row }) => (
              <li key={item.id} className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3">
                {row?.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-warning" />}
                <div className="min-w-0 text-[13px]">
                  <div className="truncate font-medium text-text-primary">{item.title}</div>
                  {row?.ok ? (
                    <div className="text-xs text-text-muted">
                      {row.status === 'posted' ? 'Approved as' : 'Approval recorded, now'} <span className="font-medium text-text-secondary">{row.number ?? row.status}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-warning">Skipped: {row ? skipText(row) : 'no answer from the server'}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setResults(null)} className="h-8 rounded-md bg-accent text-[13px] font-medium text-white hover:bg-accent-hover">
            Done
          </button>
        </SheetContent>
      </Sheet>
    </div>
  );
};
