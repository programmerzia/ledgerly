import React, { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle, Clock, Download, Pencil, RotateCcw, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { StatusPill } from '@/components/domain/StatusPill';
import { SignDialog } from '@/components/domain/SignDialog';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useLedgerStore } from '@/mock/store';
import { useContactDirectory } from '@/data/contacts';
import { useDoc } from '@/data/invoices';
import { usePaymentRun, usePaymentRunActions } from '@/data/paymentRuns';
import { useMemberNames } from '@/data/approvals';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { saveFile } from '@/api/live/reports';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { ErrorLine, LoadingLine, inputClass, tradeVerdictText } from '@/pages/Sales/live/parts';

const BillRef: React.FC<{ id: string; coSlug: string }> = ({ id, coSlug }) => {
  const d = useDoc(id, 'bills');
  return (
    <Link to={`/${coSlug}/bills/${id}`} className="font-semibold text-accent hover:underline">
      {d.data?.number ?? 'Bill'}
    </Link>
  );
};

type Pending = 'approve' | 'submit';

export const PaymentRunViewLive: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const company = useRouteCompany();
  const me = useLedgerStore((s) => s.currentUser);
  const coSlug = company.slug;
  const q = usePaymentRun(id);
  const suppliers = useContactDirectory('supplier', true);
  const names = useMemberNames();
  const actions = usePaymentRunActions();
  const { run, signProps } = useSignedRun();

  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [dialog, setDialog] = useState<null | 'return' | 'void'>(null);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const slots = useRef(new Map<string, IntentSlot>());
  const slotFor = (name: string) => {
    let s = slots.current.get(name);
    if (!s) slots.current.set(name, (s = new IntentSlot()));
    return s;
  };

  const r = q.data;
  if (q.isLoading) return <LoadingLine what="payment run" />;
  if (q.error || !r) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound ? (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This payment run does not exist in this company.{' '}
        <button type="button" onClick={() => navigate(`/${coSlug}/payment-run`)} className="text-accent hover:underline">Back to payment runs</button>
      </div>
    ) : (
      <ErrorLine error={q.error} onRetry={q.refetch} />
    );
  }

  const base = r.baseCurrency;
  const can = r.can;
  const makerName = names.get(r.submitted_by ?? r.created_by ?? '');
  const isMine = r.created_by === me.id || r.submitted_by === me.id;

  const onError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) {
      setDialog(null);
      setConflict({ noun: 'payment run', serverVersion: e.serverVersion, localVersion: r.version, onClose: () => setConflict(null), onReload: () => { setConflict(null); q.refetch(); } });
      return;
    }
    const msg = tradeVerdictText(e, true);
    if (dialog) setProblem(msg);
    else toast.error(msg);
  };

  async function perform<T>(name: string, signature: string, sign: Pending | null, call: (intent: ReturnType<IntentSlot['for']>) => Promise<T>): Promise<T | undefined> {
    const slot = slotFor(name);
    const intent = slot.for(signature);
    setPending(sign);
    setBusy(true);
    setProblem('');
    try {
      const res = await run(() => call(intent));
      slot.clear();
      return res;
    } catch (e) {
      onError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const sig = `${r.id}:${r.version}`;
  const doSubmit = async () => {
    const res = await perform('submit', sig, 'submit', (intent) => actions.submit(r.id, r.version, intent));
    if (res) toast.success(res.status === 'posted' ? `Posted as ${res.number}` : 'Sent for approval');
  };
  const doApprove = async () => {
    const res = await perform('approve', sig, 'approve', (intent) => actions.approve(r.id, r.version, intent));
    if (res) toast.success(res.status === 'posted' ? `Approved and posted as ${res.number}` : 'Your approval is recorded. Another step is still to come.');
  };
  const doReturn = async () => {
    const comment = text.trim();
    if (!comment) return;
    const res = await perform('return', `${sig}:${comment}`, null, (intent) => actions.sendBack(r.id, comment, r.version, intent));
    if (res) { setDialog(null); setText(''); toast.success('Sent back to the maker as a draft'); }
  };
  const doVoid = async () => {
    const reason = text.trim();
    const res = await perform('void', `${sig}:${reason}`, null, (intent) => actions.voidDraft(r.id, reason, r.version, intent));
    if (res) { setDialog(null); setText(''); toast.success('Draft discarded'); navigate(`/${coSlug}/payment-run`); }
  };
  const doExport = async () => {
    setBusy(true);
    try {
      saveFile(await actions.bankFile(r.id, r.number));
    } catch (e) {
      toast.error(tradeVerdictText(e, true));
    } finally {
      setBusy(false);
    }
  };

  const sign = pending === 'submit'
    ? { action: 'Sign and post', text: 'Nobody else needs to approve this run under your company rules, so it posts now: one payment per supplier, with the next numbers.' }
    : { action: 'Approve and post', text: 'Approving posts one payment per supplier to your books. Mistakes are fixed later by reversing a payment.' };

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: 'Pay bills', to: `/${coSlug}/payment-run` }, { label: r.number ?? 'Draft run' }]}
        title={r.number ?? 'Draft payment run'}
        subtitle={r.reference || undefined}
        meta={<StatusPill status={r.status} label={r.status === 'void' ? 'Discarded' : undefined} />}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article className="rounded-lg border border-border bg-surface px-6 py-8 sm:px-10" data-testid="run-paper">
          <h2 className="text-2xl font-semibold text-text-primary">Payment run</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-3">
            <div><dt className="text-[11px] font-semibold text-text-muted">Payment date</dt><dd className="tabular-nums text-text-primary">{formatDate(r.run_date)}</dd></div>
            <div><dt className="text-[11px] font-semibold text-text-muted">Currency</dt><dd className="text-text-primary">{r.currency}</dd></div>
            <div><dt className="text-[11px] font-semibold text-text-muted">Bills</dt><dd className="tabular-nums text-text-primary">{r.items.length}</dd></div>
          </dl>

          <table className="mt-8 w-full text-left text-xs" data-testid="run-items">
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="py-1.5">Bill</th>
                <th className="px-2 py-1.5">Supplier</th>
                <th className="px-2 py-1.5 text-right">Paid</th>
                <th className="px-2 py-1.5 text-right">Tax withheld already</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.items.map((i) => (
                <tr key={i.id}>
                  <td className="py-2"><BillRef id={i.invoice_id} coSlug={coSlug} /></td>
                  <td className="px-2 py-2 text-text-secondary">{suppliers.byId.get(i.contact_id)?.name ?? '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(i.amount_fc, r.currency)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-text-muted">{i.wht_amount_fc > 0 ? formatMoney(i.wht_amount_fc, r.currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-6 flex max-w-xs flex-col gap-1.5 text-[13px]">
            <div className="flex justify-between"><dt className="text-text-secondary">Bills settled</dt><dd className="tabular-nums" data-testid="run-gross">{formatMoney(r.total_gross, r.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Tax withheld already</dt><dd className="tabular-nums" data-testid="run-wht">{formatMoney(r.total_wht, r.currency)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold"><dt>Cash paid out</dt><dd className="tabular-nums" data-testid="run-net">{formatMoney(r.total_net, r.currency)}</dd></div>
            {r.currency !== base && <div className="flex justify-between text-xs text-text-muted"><dt>In {base}</dt><dd className="tabular-nums">{formatMoney(r.total, base)}</dd></div>}
          </dl>
          {r.memo && <p className="mt-6 text-xs text-text-secondary">{r.memo}</p>}
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className={cn(CARD, 'flex flex-col gap-4 p-5')} aria-label="Status and actions">
            <div>
              <div className="text-xs text-text-muted">Cash paid out</div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-text-primary">{formatMoney(r.total_net, r.currency)}</div>
              {makerName && <div className="mt-1 text-xs text-text-muted">Prepared by {makerName}</div>}
            </div>

            {r.status === 'pending_approval' &&
              (can.approve ? (
                <div className="grid grid-cols-2 gap-2">
                  {can.return && (
                    <button type="button" onClick={() => { setProblem(''); setDialog('return'); }} disabled={busy} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}><RotateCcw className="size-4" /> Return</button>
                  )}
                  <button type="button" onClick={() => void doApprove()} disabled={busy} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"><CheckCircle className="size-4" /> Approve</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning">
                  <Clock className="size-4 shrink-0" /> {isMine ? 'Waiting for someone else to approve' : 'Waiting for approval'}
                </div>
              ))}

            {r.status === 'draft' && (
              <div className="flex flex-col gap-2">
                {can.submit && (
                  <button type="button" onClick={() => void doSubmit()} disabled={busy} className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"><Send className="size-4" /> Submit</button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {can.update && <button type="button" onClick={() => navigate(`/${coSlug}/payment-run/new?draft=${r.id}`)} className={BTN_SECONDARY}><Pencil className="size-4 text-text-muted" /> Edit draft</button>}
                  {can.void && <button type="button" onClick={() => { setProblem(''); setDialog('void'); }} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}><Trash2 className="size-4" /> Discard</button>}
                </div>
              </div>
            )}

            {r.status === 'posted' && (
              <div className="flex flex-col gap-2">
                <button type="button" onClick={() => void doExport()} disabled={busy} className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50" data-testid="export-bank-file">
                  <Download className="size-4" /> Download the bank file
                </button>
                <Link to={`/${coSlug}/wht-certificates`} className="text-xs text-accent hover:underline">Tax withheld certificates</Link>
                <p className="text-[11px] text-text-muted">To undo a payment from this run, reverse that payment from the supplier’s page.</p>
              </div>
            )}
          </section>
        </aside>
      </div>

      <Dialog open={dialog === 'return'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Send back for changes</DialogTitle></DialogHeader>
          <label htmlFor="pr-return" className="text-xs font-semibold text-text-primary">Why are you sending it back?</label>
          <textarea id="pr-return" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-lg border border-border bg-surface p-2 text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">Cancel</button>
            <button type="button" onClick={() => void doReturn()} disabled={!text.trim() || busy} className="h-9 rounded-md bg-warning px-3 text-xs font-semibold text-white disabled:opacity-50">Send back</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'void'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Discard this draft</DialogTitle></DialogHeader>
          <p className="text-xs text-text-secondary">A discarded draft is marked void and kept for the record. It never reaches the books.</p>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" className={cn(inputClass, 'w-full')} />
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">Keep it</button>
            <button type="button" onClick={() => void doVoid()} disabled={busy} className="h-9 rounded-md bg-danger px-3 text-xs font-semibold text-white disabled:opacity-50">Discard draft</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog {...signProps} documentTitle={`Payment run: ${r.number || 'Draft'}`} documentNumber={r.number || 'Draft'} amount={r.total} currency={base} makerName={makerName} actionTitle={sign.action} consequenceText={sign.text} />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
