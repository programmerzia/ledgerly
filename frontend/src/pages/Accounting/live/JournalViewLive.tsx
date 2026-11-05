import React, { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle, Clock, Copy, Hash, Pencil, Repeat, RotateCcw, Send, Trash2, Wrench } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { PageHeader } from '@/components/domain/PageHeader';
import { PdfButton } from '@/components/live/DocumentActions';
import { StatusPill } from '@/components/domain/StatusPill';
import { SignDialog } from '@/components/domain/SignDialog';
import { AttachmentsPanel } from '@/components/live/AttachmentsPanel';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { JournalPaper } from '../journal-view/JournalPaper';
import { BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/format';
import { useAccounts } from '@/data/accounts';
import { useJournal, useJournalActions, useJournalRefs, type LiveJournal } from '@/data/journals';
import { useMemberNames } from '@/data/approvals';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import { toDuplicateInput, toJournalRequest, type LiveJournalLine } from '@/api/adapters/journal';
import { ErrorLine, LoadingLine, inputClass, verdictText } from './parts';
import { RepeatDialog } from './RepeatDialog';

type Pending = 'approve' | 'reverse' | 'fix_this' | 'submit';

const SIGN_TEXT: Record<Pending, { action: string; consequence: (amount: string) => string }> = {
  approve: { action: 'Approve and post', consequence: () => 'Approving posts this journal to your books with the next journal number. Mistakes are fixed later with a reversal.' },
  submit: { action: 'Sign and post', consequence: () => 'Nobody else needs to approve this under your company rules, so it posts now with the next journal number.' },
  reverse: { action: 'Reverse journal', consequence: (a) => `Reversing adds an equal and opposite entry of ${a} and restores your balances.` },
  fix_this: { action: 'Reverse and create draft', consequence: () => 'The original is cancelled with a reversing entry and an editable draft copy is created for you to correct.' },
};

export const JournalViewLive: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const company = useLedgerStore((s) => s.currentCompany);
  const me = useLedgerStore((s) => s.currentUser);
  const coSlug = company.slug;
  const journalQ = useJournal(id);
  const refs = useJournalRefs();
  const accounts = useAccounts();
  const names = useMemberNames();
  const actions = useJournalActions();
  const { run, signProps } = useSignedRun();

  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [dialog, setDialog] = useState<null | 'return' | 'reverse' | 'fix' | 'void' | 'repeat'>(null);
  const [text, setText] = useState('');
  const [reverseDate, setReverseDate] = useState('');
  const slots = useRef(new Map<string, IntentSlot>());
  const slotFor = (name: string) => {
    let s = slots.current.get(name);
    if (!s) slots.current.set(name, (s = new IntentSlot()));
    return s;
  };

  const journal = journalQ.data ?? null;
  if (journalQ.isLoading || accounts.isLoading) return <LoadingLine what="journal" />;
  if (journalQ.error || !journal) {
    const notFound = journalQ.error instanceof ApiError && journalQ.error.status === 404;
    return notFound ? (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This journal does not exist in this company.{' '}
        <button type="button" onClick={() => navigate(`/${coSlug}/journals`)} className="text-accent hover:underline">
          Back to journals
        </button>
      </div>
    ) : (
      <ErrorLine error={journalQ.error} onRetry={journalQ.refetch} />
    );
  }

  const cur = company.base_currency;
  const periodName = refs.periods.find((p) => p.id === journal.fiscal_period_id)?.name ?? null;
  const makerName = names.get(journal.submitted_by ?? journal.created_by);
  const isMine = journal.created_by === me.id || journal.submitted_by === me.id;

  const onError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) {
      setConflict({
        noun: 'journal',
        serverVersion: e.serverVersion,
        localVersion: journal.version,
        onClose: () => setConflict(null),
        onReload: () => {
          setConflict(null);
          journalQ.refetch();
        },
      });
      return;
    }
    toast.error(verdictText(e));
  };

  /** One user action = one intent, kept until it succeeds, signed through the dialog if the server asks. */
  async function perform<T>(name: string, signature: string, sign: Pending | null, call: (intent: ReturnType<IntentSlot['for']>) => Promise<T>): Promise<T | undefined> {
    const slot = slotFor(name);
    const intent = slot.for(signature);
    setPending(sign);
    setBusy(true);
    try {
      const r = await run(() => call(intent));
      slot.clear();
      return r;
    } catch (e) {
      onError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const doSubmit = async () => {
    const r = await perform('submit', `${journal.id}:${journal.version}`, 'submit', (intent) => actions.submit(journal.id, journal.version ?? 0, intent));
    if (r) toast.success(r.status === 'posted' ? `Posted as ${r.number}` : 'Sent for approval');
  };

  const doApprove = async () => {
    const r = await perform('approve', `${journal.id}:${journal.version}`, 'approve', (intent) => actions.approve(journal.id, journal.version ?? 0, intent));
    if (r) toast.success(r.status === 'posted' ? `Approved and posted as ${r.number}` : 'Your approval is recorded. Another step is still to come.');
  };

  const doReturn = async () => {
    const comment = text.trim();
    if (!comment) return;
    const r = await perform('return', `${journal.id}:${journal.version}:${comment}`, null, (intent) => actions.sendBack(journal.id, comment, journal.version ?? 0, intent));
    if (r) {
      setDialog(null);
      setText('');
      toast.success('Sent back to the maker as a draft');
    }
  };

  const doVoid = async () => {
    const reason = text.trim();
    const r = await perform('void', `${journal.id}:${journal.version}:${reason}`, null, (intent) => actions.voidDraft(journal.id, reason, journal.version ?? 0, intent));
    if (r) {
      setDialog(null);
      setText('');
      toast.success('Draft discarded');
      navigate(`/${coSlug}/journals`);
    }
  };

  const duplicate = async (date: string) => {
    const body = toJournalRequest(toDuplicateInput(journal as Omit<LiveJournal, 'lines'> & { lines: LiveJournalLine[] }, date), refs.apiDimensions);
    return perform('duplicate', `${journal.id}:${date}`, null, (intent) => actions.create(body, intent));
  };

  const doDuplicate = async () => {
    const copy = await duplicate(toApiDate(new Date()));
    if (copy) {
      toast.success('Draft copy created');
      navigate(`/${coSlug}/journals/new?draft=${copy.id}`);
    }
  };

  const doReverse = async (fix: boolean) => {
    const memo = text.trim();
    if (!memo) return;
    const body = { memo, version: journal.version ?? 0, ...(reverseDate && !fix ? { date: reverseDate } : {}) };
    const r = await perform(fix ? 'fix' : 'reverse', `${journal.id}:${journal.version}:${memo}:${reverseDate}`, fix ? 'fix_this' : 'reverse', (intent) => actions.reverse(journal.id, body, intent));
    if (!r) return;
    setDialog(null);
    setText('');
    setReverseDate('');
    if (!fix) {
      toast.success(`Journal reversed. Reversal entry ${r.number ?? ''} is posted.`);
      navigate(`/${coSlug}/journals/${r.id}`);
      return;
    }
    const copy = await duplicate(journal.journal_date);
    if (copy) {
      toast.success('Original reversed. Now editing a corrected draft copy.');
      navigate(`/${coSlug}/journals/new?draft=${copy.id}`);
    } else {
      toast.error('The original was reversed, but the draft copy could not be made. Use Duplicate on the original.');
      navigate(`/${coSlug}/journals/${r.id}`);
    }
  };

  const can = journal.can;
  const pendingApproval = journal.status === 'pending_approval';
  const sign = SIGN_TEXT[pending ?? 'approve'];

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: 'Journals', to: `/${coSlug}/journals` }, { label: journal.number || 'Draft' }]}
        title={journal.number || 'Draft journal'}
        subtitle={journal.memo}
        meta={<StatusPill status={journal.status} />}
        actions={
          <PdfButton family="journals" id={journal.id} label="Download voucher" />
        }
      />

      {journal.status === 'reversed' && journal.reversed_by_id && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          This journal was reversed.{' '}
          <button type="button" className="underline" onClick={() => navigate(`/${coSlug}/journals/${journal.reversed_by_id}`)}>
            View the reversal
          </button>
        </div>
      )}
      {journal.reversal_of_id && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          This entry cancels another journal.{' '}
          <button type="button" className="underline" onClick={() => navigate(`/${coSlug}/journals/${journal.reversal_of_id}`)}>
            View the original
          </button>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <JournalPaper journal={journal} accounts={accounts.data} company={company} periodName={periodName} />

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className={cn(CARD, 'flex flex-col gap-4 p-5')} aria-label="Journal status">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill status={journal.status} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Total of this entry</div>
              <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">{formatMoney(journal.total_debit, cur)}</div>
              <div className="mt-1 text-[13px] text-text-muted">
                {journal.lines.length} lines · {journal.status === 'posted' ? 'in the books' : journal.status === 'reversed' ? 'cancelled by a reversal' : 'not in the books yet'}
              </div>
              {makerName && <div className="mt-1 text-xs text-text-muted">Prepared by {makerName}</div>}
            </div>

            {pendingApproval &&
              (can.approve ? (
                <div className="grid grid-cols-2 gap-2">
                  {can.return && (
                    <button type="button" onClick={() => setDialog('return')} disabled={busy} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                      <RotateCcw className="size-4" /> Return
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void doApprove()}
                    disabled={busy}
                    className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    <CheckCircle className="size-4" /> Approve
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning">
                  <Clock className="size-4 shrink-0" />
                  {isMine ? 'Waiting for someone else to approve' : 'Waiting for approval'}
                </div>
              ))}

            {journal.status === 'draft' && (
              <div className="flex flex-col gap-2">
                {can.submit && (
                  <button
                    type="button"
                    onClick={() => void doSubmit()}
                    disabled={busy}
                    className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
                  >
                    <Send className="size-4" /> Submit
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {can.update && (
                    <button type="button" onClick={() => navigate(`/${coSlug}/journals/new?draft=${journal.id}`)} className={BTN_SECONDARY}>
                      <Pencil className="size-4 text-text-muted" /> Edit draft
                    </button>
                  )}
                  {can.void && (
                    <button type="button" onClick={() => setDialog('void')} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                      <Trash2 className="size-4" /> Discard
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <PdfButton family="journals" id={journal.id} label="Voucher PDF" />
              <button type="button" onClick={() => void doDuplicate()} disabled={busy} className={BTN_SECONDARY}>
                <Copy className="size-4 text-text-muted" /> Duplicate
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(journal.number || '').catch(() => undefined);
                  toast.success('Journal number copied');
                }}
                className={BTN_SECONDARY}
              >
                <Hash className="size-4 text-text-muted" /> Copy number
              </button>
              {journal.status === 'posted' && journal.journal_type === 'manual' && (
                <button type="button" onClick={() => setDialog('repeat')} className={BTN_SECONDARY}>
                  <Repeat className="size-4 text-text-muted" /> Repeat
                </button>
              )}
              {/* The mock's rule, kept: a reversing entry is not reversed again. */}
              {can.reverse && !journal.reversal_of_id && (
                <>
                  <button type="button" onClick={() => setDialog('fix')} className={BTN_SECONDARY}>
                    <Wrench className="size-4 text-text-muted" /> Fix this
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog('reverse')}
                    title="Cancel this entry with an equal and opposite one"
                    className={cn(BTN_SECONDARY, 'border-danger/40 text-danger hover:border-danger/60 hover:bg-danger-soft')}
                  >
                    <RotateCcw className="size-4" /> Reverse
                  </button>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>

      <AttachmentsPanel type="journal" parentId={journal.id} posted={journal.status === 'posted' || journal.status === 'reversed'} />

      <Dialog open={dialog === 'return'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">Send back for changes</DialogTitle>
          </DialogHeader>
          <label htmlFor="jv-return" className="text-xs font-semibold text-text-primary">
            Why are you sending it back?
          </label>
          <textarea id="jv-return" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Wrong expense account" className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">Cancel</button>
            <button type="button" onClick={() => void doReturn()} disabled={!text.trim() || busy} className="h-9 rounded-md bg-warning px-3 text-xs font-semibold text-white disabled:opacity-50">Send back</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'void'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">Discard this draft</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-text-secondary">A discarded draft is marked void and kept for the record. It never reaches the books.</p>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" className={cn(inputClass, 'w-full')} />
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">Keep it</button>
            <button type="button" onClick={() => void doVoid()} disabled={busy} className="h-9 rounded-md bg-danger px-3 text-xs font-semibold text-white disabled:opacity-50">Discard draft</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'reverse' || dialog === 'fix'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-text-primary">
              {dialog === 'fix' ? <Wrench className="size-5 text-accent" /> : <RotateCcw className="size-5 text-danger" />}
              {dialog === 'fix' ? `Fix ${journal.number}` : `Reverse ${journal.number}`}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-3 text-xs text-text-secondary">
            <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-danger">
              <p className="font-semibold">Posted entries cannot be edited</p>
              <p className="mt-1 text-[11px]">
                {dialog === 'fix'
                  ? 'The original is cancelled by a new entry that swaps every debit and credit, then you get a draft copy to correct.'
                  : 'Instead, we add a new entry that swaps every debit and credit, which cancels this one out. Both stay visible in your records.'}
              </p>
            </div>
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              <span>
                Why are you reversing it? <span className="text-danger">*</span>
              </span>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. posted to the wrong account" className={cn(inputClass, 'w-full font-normal')} />
            </label>
            {dialog === 'reverse' && (
              <label className="flex flex-col gap-1 font-semibold text-text-primary">
                Reversal date (optional)
                <input type="date" value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} className={cn(inputClass, 'w-44 font-normal')} />
                <span className="text-[11px] font-normal text-text-muted">Left empty, the server picks the date.</span>
              </label>
            )}
            <p className="text-[11px] text-text-muted">You may be asked for your signing PIN.</p>
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button
              type="button"
              disabled={!text.trim() || busy}
              onClick={() => void doReverse(dialog === 'fix')}
              className={cn('h-8 rounded-md px-3 text-[13px] font-medium text-white disabled:opacity-50', dialog === 'fix' ? 'bg-accent hover:bg-accent-hover' : 'bg-danger hover:bg-danger/90')}
            >
              {dialog === 'fix' ? 'Reverse and create draft' : 'Reverse journal'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RepeatDialog open={dialog === 'repeat'} onClose={() => setDialog(null)} templateId={journal.id} defaultName={journal.memo || journal.reference || journal.number || ''} onCreated={() => navigate(`/${coSlug}/recurring-journals`)} />

      <SignDialog
        {...signProps}
        documentTitle={`Journal entry: ${journal.number || 'Draft'}`}
        documentNumber={journal.number || 'Draft'}
        amount={journal.total_debit}
        currency={cur}
        periodName={periodName ?? undefined}
        makerName={makerName}
        actionTitle={sign.action}
        consequenceText={sign.consequence(formatMoney(journal.total_debit, cur))}
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
