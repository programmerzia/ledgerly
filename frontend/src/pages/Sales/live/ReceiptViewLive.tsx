import React, { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle, Clock, FilePlus, Pencil, Printer, RotateCcw, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { StatusPill } from '@/components/domain/StatusPill';
import { SignDialog } from '@/components/domain/SignDialog';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useLedgerStore } from '@/mock/store';
import { useContactDirectory } from '@/data/contacts';
import { useDoc, useOpenDocs } from '@/data/invoices';
import { useSettlement, useSettlementActions } from '@/data/settlements';
import { useTradeRefs } from '@/data/tradeRefs';
import { useMemberNames } from '@/data/approvals';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { ErrorLine, LoadingLine, inputClass, tradeVerdictText } from './parts';

type Pending = 'approve' | 'reverse' | 'submit' | 'apply';

const InvoiceRef: React.FC<{ id: string; coSlug: string }> = ({ id, coSlug }) => {
  const d = useDoc(id);
  return (
    <Link to={`/${coSlug}/invoices/${id}`} className="font-semibold text-accent hover:underline">
      {d.data?.number ?? 'Invoice'}
    </Link>
  );
};

export const ReceiptViewLive: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const company = useRouteCompany();
  const me = useLedgerStore((s) => s.currentUser);
  const coSlug = company.slug;
  const q = useSettlement(id);
  const customers = useContactDirectory('customer', true);
  const refs = useTradeRefs();
  const names = useMemberNames();
  const actions = useSettlementActions();
  const { run, signProps } = useSignedRun();

  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [dialog, setDialog] = useState<null | 'return' | 'void' | 'reverse' | 'apply'>(null);
  const [text, setText] = useState('');
  const [reverseDate, setReverseDate] = useState('');
  const [applyTo, setApplyTo] = useState('');
  const [applyAmount, setApplyAmount] = useState(0);
  const [problem, setProblem] = useState('');
  const slots = useRef(new Map<string, IntentSlot>());
  const slotFor = (name: string) => {
    let s = slots.current.get(name);
    if (!s) slots.current.set(name, (s = new IntentSlot()));
    return s;
  };

  const r = q.data;
  const open = useOpenDocs(r?.status === 'posted' && r.unallocated_fc > 0 ? r.contact_id : undefined, 'sales_invoice');

  if (q.isLoading) return <LoadingLine what="receipt" />;
  if (q.error || !r) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound ? (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This receipt does not exist in this company.{' '}
        <button type="button" onClick={() => navigate(`/${coSlug}/customers`)} className="text-accent hover:underline">Back to customers</button>
      </div>
    ) : (
      <ErrorLine error={q.error} onRetry={q.refetch} />
    );
  }

  const base = r.baseCurrency;
  const customer = customers.byId.get(r.contact_id);
  const bank = refs.bankAccounts.find((b) => b.id === r.bank_account_id);
  const makerName = names.get(r.submitted_by ?? r.created_by ?? '');
  const isMine = r.created_by === me.id || r.submitted_by === me.id;
  const foreign = r.currency !== base;
  const can = r.can;
  const posted = r.status === 'posted';

  const onError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) {
      setDialog(null);
      setConflict({ noun: 'receipt', serverVersion: e.serverVersion, localVersion: r.version, onClose: () => setConflict(null), onReload: () => { setConflict(null); q.refetch(); } });
      return;
    }
    const msg = tradeVerdictText(e);
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
    if (res) { setDialog(null); setText(''); toast.success('Draft discarded'); navigate(`/${coSlug}/customers/${r.contact_id}`); }
  };
  const doReverse = async () => {
    const memo = text.trim();
    if (!memo) return;
    const body = { memo, version: r.version, ...(reverseDate ? { date: reverseDate } : {}) };
    const res = await perform('reverse', `${sig}:${memo}:${reverseDate}`, 'reverse', (intent) => actions.reverse(r.id, body, intent));
    if (res) { setDialog(null); setText(''); setReverseDate(''); toast.success(`Receipt ${r.number ?? ''} reversed. The invoices it paid are open again.`); }
  };
  const doApply = async () => {
    if (!applyTo || applyAmount <= 0) return;
    const res = await perform('apply', `${r.id}:${applyTo}:${applyAmount}`, 'apply', (intent) => actions.applyCredit(r.id, { invoice_id: applyTo, amount_fc: applyAmount }, intent));
    if (res) { setDialog(null); setApplyTo(''); setApplyAmount(0); toast.success('Credit applied to the invoice'); q.refetch(); }
  };

  const target = open.docs.find((d) => d.id === applyTo);
  const sign =
    pending === 'apply'
      ? { action: 'Apply credit', text: 'This puts the credit on account against the invoice you chose. The invoice owes that much less.' }
      : pending === 'reverse'
      ? { action: 'Reverse receipt', text: 'Reversing adds an equal and opposite entry and opens the invoices it paid again.' }
      : pending === 'submit'
        ? { action: 'Sign and post', text: 'Nobody else needs to approve this receipt under your company rules, so it posts now with the next number.' }
        : { action: 'Approve and post', text: 'Approving posts this receipt to your books with the next number. Mistakes are fixed later with a reversal.' };

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: customer?.name ?? 'Customers', to: customer ? `/${coSlug}/customers/${customer.id}` : `/${coSlug}/customers` }, { label: r.number || 'Draft receipt' }]}
        title={r.number || 'Draft receipt'}
        subtitle={customer?.name}
        meta={<StatusPill status={r.status} />}
        actions={<button type="button" onClick={() => window.print()} className={BTN_SECONDARY}><Printer className="size-4 text-text-muted" /> Print</button>}
      />

      {r.status === 'reversed' && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          This receipt was reversed.
          {r.reversal_journal_id && <Link className="underline" to={`/${coSlug}/journals/${r.reversal_journal_id}`}>View the reversing entry</Link>}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article className="rounded-lg border border-border bg-surface px-6 py-8 sm:px-10" data-testid="receipt-paper">
          <h2 className="text-2xl font-semibold text-text-primary">Receipt</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
            <div><dt className="text-[11px] font-semibold text-text-muted">Received from</dt><dd className="text-text-primary">{customer?.name ?? '—'}</dd></div>
            <div><dt className="text-[11px] font-semibold text-text-muted">Paid into</dt><dd className="text-text-primary">{bank?.name ?? '—'}</dd></div>
            <div><dt className="text-[11px] font-semibold text-text-muted">Date</dt><dd className="tabular-nums text-text-primary">{formatDate(r.settlement_date)}</dd></div>
            <div><dt className="text-[11px] font-semibold text-text-muted">Reference</dt><dd className="text-text-primary">{r.reference || '—'}</dd></div>
            <div><dt className="text-[11px] font-semibold text-text-muted">Amount received</dt><dd className="text-lg font-medium tabular-nums text-text-primary">{formatMoney(r.amount_fc, r.currency)}</dd></div>
            {foreign && <div><dt className="text-[11px] font-semibold text-text-muted">In {base}</dt><dd className="tabular-nums text-text-primary">{formatMoney(r.amount, base)}</dd></div>}
          </dl>

          <h3 className="mt-8 text-sm font-semibold text-text-primary">Applied to</h3>
          {r.allocations.length === 0 ? (
            <p className="mt-2 text-[13px] text-text-muted">Not applied to any invoice.</p>
          ) : (
            <table className="mt-2 w-full text-left text-xs" data-testid="receipt-allocations">
              <thead>
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="py-1.5">Invoice</th>
                  <th className="px-2 py-1.5 text-right">Applied</th>
                  {foreign && <th className="px-2 py-1.5 text-right">Exchange gain or loss ({base})</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.allocations.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2">{a.invoice_id ? <InvoiceRef id={a.invoice_id} coSlug={coSlug} /> : 'Another receipt'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatMoney(a.amount_fc, r.currency)}</td>
                    {foreign && <td className="px-2 py-2 text-right tabular-nums">{formatMoney(a.fx_gain_loss, base)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-[13px] text-text-secondary">
            Credit on account: <span className="font-semibold tabular-nums text-text-primary" data-testid="receipt-unallocated">{formatMoney(r.unallocated_fc, r.currency)}</span>
          </p>
          {r.memo && <p className="mt-4 text-xs text-text-secondary">{r.memo}</p>}
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className={cn(CARD, 'flex flex-col gap-4 p-5')} aria-label="Status and actions">
            <div>
              <div className="text-xs text-text-muted">Amount received</div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-text-primary">{formatMoney(r.amount_fc, r.currency)}</div>
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
                  {can.update && <button type="button" onClick={() => navigate(`/${coSlug}/receipts/new?draft=${r.id}`)} className={BTN_SECONDARY}><Pencil className="size-4 text-text-muted" /> Edit draft</button>}
                  {can.void && <button type="button" onClick={() => { setProblem(''); setDialog('void'); }} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}><Trash2 className="size-4" /> Discard</button>}
                </div>
              </div>
            )}

            {posted && (
              <div className="flex flex-col gap-2">
                {can.allocate && r.unallocated_fc > 0 && (
                  <button type="button" onClick={() => { setProblem(''); setApplyTo(''); setApplyAmount(0); setDialog('apply'); }} className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover"><FilePlus className="size-4" /> Apply the credit to an invoice</button>
                )}
                {can.reverse && (
                  <button type="button" onClick={() => { setProblem(''); setDialog('reverse'); }} className={cn(BTN_SECONDARY, 'border-danger/40 text-danger hover:border-danger/60 hover:bg-danger-soft')}><RotateCcw className="size-4" /> Reverse</button>
                )}
              </div>
            )}
            {r.journal_id && <Link to={`/${coSlug}/journals/${r.journal_id}`} className="text-xs text-accent hover:underline">View the journal entry</Link>}
          </section>
        </aside>
      </div>

      <Dialog open={dialog === 'return'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Send back for changes</DialogTitle></DialogHeader>
          <label htmlFor="rv-return" className="text-xs font-semibold text-text-primary">Why are you sending it back?</label>
          <textarea id="rv-return" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-lg border border-border bg-surface p-2 text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
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

      <Dialog open={dialog === 'reverse'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Reverse {r.number}</DialogTitle></DialogHeader>
          <div className="mt-2 flex flex-col gap-3 text-xs text-text-secondary">
            <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-danger">
              <p className="font-semibold">A posted receipt cannot be edited</p>
              <p className="mt-1 text-[11px]">We add an equal and opposite entry. The invoices it paid get their open amounts back. If part of its credit on account was applied elsewhere, undo that first.</p>
            </div>
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              <span>Why are you reversing it? <span className="text-danger">*</span></span>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. the payment bounced" className={cn(inputClass, 'w-full font-normal')} />
            </label>
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              Reversal date (optional)
              <input type="date" value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} className={cn(inputClass, 'w-44 font-normal')} />
            </label>
            {problem && <p role="alert" className="text-xs font-medium text-danger">{problem}</p>}
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button type="button" disabled={!text.trim() || busy} onClick={() => void doReverse()} className="h-8 rounded-md bg-danger px-3 text-[13px] font-medium text-white hover:bg-danger/90 disabled:opacity-50">Reverse receipt</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'apply'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Apply the credit from {r.number}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 text-xs text-text-secondary">
            <p>Credit on account: <span className="font-semibold tabular-nums text-text-primary">{formatMoney(r.unallocated_fc, r.currency)}</span></p>
            {open.isLoading ? (
              <p>Loading this customer’s open invoices…</p>
            ) : open.docs.length === 0 ? (
              <p>This customer has no open invoices.</p>
            ) : (
              <>
                <label className="flex flex-col gap-1 font-semibold text-text-primary">
                  Invoice
                  <select value={applyTo} onChange={(e) => { setApplyTo(e.target.value); setApplyAmount(0); }} className={cn(inputClass, 'w-full font-normal')} aria-label="Invoice to apply to">
                    <option value="">Choose an invoice</option>
                    {open.docs.map((d) => (<option key={d.id} value={d.id}>{d.number} · owed {formatMoney(d.amount_due, d.baseCurrency)}</option>))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 font-semibold text-text-primary">
                  Amount ({r.currency})
                  <MoneyInput value={applyAmount} onChange={setApplyAmount} currency={r.currency} allowNegative={false} size="sm" />
                </label>
                {target && target.currency === base && r.currency === base && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setApplyAmount(r.unallocated_fc)} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-neutral">Use the credit on account</button>
                    <button type="button" onClick={() => setApplyAmount(target.amount_due)} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-neutral">Use what the invoice owes</button>
                  </div>
                )}
              </>
            )}
            {problem && <p role="alert" className="text-xs font-medium text-danger">{problem}</p>}
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button type="button" disabled={!applyTo || applyAmount <= 0 || busy} onClick={() => void doApply()} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">Apply credit</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog {...signProps} documentTitle={`Receipt: ${r.number || 'Draft'}`} documentNumber={r.number || 'Draft'} amount={r.amount} currency={base} makerName={makerName} actionTitle={sign.action} consequenceText={sign.text} />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
