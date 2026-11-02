import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle, Clock, FilePlus, Pencil, RotateCcw, Send, Trash2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { ConflictDialog } from '@/components/domain/ConflictDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useLedgerStore } from '@/mock/store';
import { useAccounts } from '@/data/accounts';
import { useContactDirectory } from '@/data/contacts';
import { useTradeRefs } from '@/data/tradeRefs';
import { useMemberNames } from '@/data/approvals';
import { useRequisition, useRequisitionActions } from '@/data/procurement';
import { ApiError } from '@/api/errors';
import { toApiDate } from '@/api/adapters/dates';
import { convertibleLines, toConvertRequest, type ConvertInput, type Requisition } from '@/api/adapters/procurement';
import type { Intent } from '@/api/idempotency';
import { ErrorLine, LoadingLine, ProcStatusPill, ReasonDialog, inputClass, showQty, useActionRunner } from './parts';

type Dialog_ = null | 'return' | 'reject' | 'void' | 'convert';

export const RequisitionView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const company = useRouteCompany();
  const co = company.slug;
  const me = useLedgerStore((s) => s.currentUser);
  const q = useRequisition(id);
  const accounts = useAccounts();
  const names = useMemberNames();
  const actions = useRequisitionActions();
  const r = q.data;
  const runner = useActionRunner({ noun: 'requisition', localVersion: r?.version, reload: () => void q.refetch() });
  const [dialog, setDialog] = useState<Dialog_>(null);
  const [text, setText] = useState('');

  if (q.isLoading || accounts.isLoading) return <LoadingLine what="requisition" />;
  if (q.error || !r) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound ? (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This requisition does not exist in this company.{' '}
        <button type="button" onClick={() => navigate(`/${co}/requisitions`)} className="text-accent hover:underline">Back to requisitions</button>
      </div>
    ) : (
      <ErrorLine error={q.error} onRetry={q.refetch} />
    );
  }

  const accountName = (aid: string | null) => {
    const a = accounts.data.find((x) => x.id === aid);
    return a ? `${a.code} ${a.name}` : '';
  };
  const numberLabel = r.number ?? (r.status === 'void' ? 'Discarded' : 'Draft');
  const makerName = names.get(r.submitted_by ?? r.created_by ?? '');
  const isMine = r.created_by === me.id || r.submitted_by === me.id;
  const can = r.can;
  const sig = `${r.id}:${r.version}`;
  const { perform, busy } = runner;

  const doSubmit = async () => {
    const x = await perform('submit', sig, 'submit', (intent) => actions.submit(r.id, r.version, intent));
    if (x) toast.success(x.status === 'approved' ? `Approved as ${x.number}` : 'Sent for approval');
  };
  const doApprove = async () => {
    const x = await perform('approve', sig, 'approve', (intent) => actions.approve(r.id, r.version, intent));
    if (x) toast.success(x.status === 'approved' ? `Approved as ${x.number}` : 'Your approval is recorded. Another step is still to come.');
  };
  const doReturn = async () => {
    const comment = text.trim();
    const x = await perform('return', `${sig}:${comment}`, null, (intent) => actions.sendBack(r.id, comment, r.version, intent), true);
    if (x) {
      setDialog(null);
      setText('');
      toast.success('Sent back to the maker as a draft');
    }
  };
  const doReject = async () => {
    const reason = text.trim();
    const x = await perform('reject', `${sig}:${reason}`, null, (intent) => actions.reject(r.id, reason, r.version, intent), true);
    if (x) {
      setDialog(null);
      setText('');
      toast.success('Requisition rejected');
    }
  };
  const doVoid = async () => {
    const reason = text.trim();
    const x = await perform('void', `${sig}:${reason}`, null, (intent) => actions.voidDoc(r.id, reason, r.version, intent), true);
    if (x) {
      setDialog(null);
      setText('');
      toast.success('Requisition discarded');
    }
  };

  const sign =
    runner.pending === 'approve'
      ? { action: 'Approve requisition', text: 'Approving lets the buyer turn the lines into purchase orders. Nothing is posted to your books.' }
      : { action: 'Sign and approve', text: 'Nobody else needs to approve this requisition under your company rules, so it is approved now with the next number.' };

  const rejected = r.status === 'rejected';
  const pendingApproval = r.status === 'pending_approval';

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: 'Requisitions', to: `/${co}/requisitions` }, { label: numberLabel }]}
        title={r.number || (r.status === 'draft' ? 'Draft requisition' : 'Requisition')}
        subtitle={r.memo || undefined}
        meta={<ProcStatusPill kind="requisition" status={r.status} />}
      />

      {rejected && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          <span className="font-semibold">This requisition was rejected.</span> {r.rejection_reason}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article aria-label={`Requisition ${r.number ?? 'draft'}`} className="rounded-lg border border-border bg-surface px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-text-primary">{company.name}</div>
            </div>
            <div className="text-right">
              <h2 className="text-3xl font-semibold text-text-primary">Requisition</h2>
              <div className="mt-1 text-sm font-medium tabular-nums text-text-secondary">{numberLabel}</div>
            </div>
          </div>
          <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:max-w-xs">
            <dt className="text-text-muted">Date</dt>
            <dd className="tabular-nums text-text-primary">{formatDate(r.requisition_date)}</dd>
            <dt className="text-text-muted">Estimates in</dt>
            <dd className="text-text-primary">{r.currency}</dd>
            {makerName && (
              <>
                <dt className="text-text-muted">Prepared by</dt>
                <dd className="text-text-primary">{makerName}</dd>
              </>
            )}
          </dl>

          <table className="mt-8 w-full text-left text-xs" data-testid="requisition-lines">
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="py-2 pr-2">Description</th>
                <th className="w-16 px-2 py-2 text-right">Qty</th>
                <th className="w-28 px-2 py-2 text-right">Estimated price</th>
                <th className="w-24 px-2 py-2">Needed by</th>
                <th className="w-28 px-2 py-2">Order</th>
                <th className="w-28 py-2 pl-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-2">
                    <div className="text-text-primary">{l.description || '—'}</div>
                    <div className="text-[11px] text-text-muted">{accountName(l.account_id)}</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{showQty(l.quantity)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(l.estimated_unit_price, r.currency)}</td>
                  <td className="px-2 py-2 tabular-nums text-text-muted">{l.needed_by ? formatDate(l.needed_by) : ''}</td>
                  <td className="px-2 py-2">
                    {l.order ? (
                      <Link to={`/${co}/purchase-orders/${l.order.id}`} className="font-medium text-accent hover:underline">
                        {l.order.number ?? 'Draft order'}
                      </Link>
                    ) : (
                      <span className="text-text-muted">Not ordered</span>
                    )}
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums text-text-primary">{formatMoney(l.line_total, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-6 flex max-w-xs flex-col gap-1.5 text-[13px]">
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
              <dt>Estimated total</dt>
              <dd className="tabular-nums">{formatMoney(r.total, r.currency)}</dd>
            </div>
          </dl>
          {r.memo && <p className="mt-6 text-xs text-text-secondary">{r.memo}</p>}
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className={cn(CARD, 'flex flex-col gap-4 p-5')} aria-label="Status and actions">
            <div>
              <div className="text-xs text-text-muted">Estimated total</div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-text-primary">{formatMoney(r.total, r.currency)}</div>
              <div className="mt-1 text-[13px] text-text-muted">{r.lines.length} {r.lines.length === 1 ? 'line' : 'lines'} · nothing is posted to the books</div>
            </div>

            {pendingApproval &&
              (can.approve || can.return || can.reject ? (
                <div className="flex flex-col gap-2">
                  {can.approve && (
                    <button type="button" onClick={() => void doApprove()} disabled={busy} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50">
                      <CheckCircle className="size-4" /> Approve
                    </button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {can.return && (
                      <button type="button" onClick={() => { runner.setProblem(''); setText(''); setDialog('return'); }} disabled={busy} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                        <RotateCcw className="size-4" /> Return
                      </button>
                    )}
                    {can.reject && (
                      <button type="button" onClick={() => { runner.setProblem(''); setText(''); setDialog('reject'); }} disabled={busy} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                        <XCircle className="size-4" /> Reject
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning">
                  <Clock className="size-4 shrink-0" />
                  {isMine ? 'Waiting for someone else to approve' : 'Waiting for approval'}
                </div>
              ))}

            {r.status === 'draft' && (
              <div className="flex flex-col gap-2">
                {can.submit && (
                  <button type="button" onClick={() => void doSubmit()} disabled={busy} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50">
                    <Send className="size-4" /> Submit
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {can.update && (
                    <button type="button" onClick={() => navigate(`/${co}/requisitions/${r.id}/edit`)} className={BTN_SECONDARY}>
                      <Pencil className="size-4 text-text-muted" /> Edit draft
                    </button>
                  )}
                  {can.void && (
                    <button type="button" onClick={() => { runner.setProblem(''); setText(''); setDialog('void'); }} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                      <Trash2 className="size-4" /> Discard
                    </button>
                  )}
                </div>
              </div>
            )}

            {pendingApproval && can.void && (
              <button type="button" onClick={() => { runner.setProblem(''); setText(''); setDialog('void'); }} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                <Trash2 className="size-4" /> Discard
              </button>
            )}

            {r.status === 'approved' && can.convert && convertibleLines(r).length > 0 && (
              <button type="button" onClick={() => { runner.setProblem(''); setDialog('convert'); }} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
                <FilePlus className="size-4" /> Create order
              </button>
            )}
            {r.status === 'approved' && convertibleLines(r).length === 0 && <p className="text-[13px] text-text-muted">Every line is on an order.</p>}
          </section>
        </aside>
      </div>

      <ReasonOrComment
        dialog={dialog}
        text={text}
        setText={setText}
        problem={runner.problem}
        busy={busy}
        close={() => setDialog(null)}
        onReturn={() => void doReturn()}
        onReject={() => void doReject()}
        onVoid={() => void doVoid()}
      />

      {dialog === 'convert' && (
        <ConvertDialog
          requisition={r}
          onClose={() => setDialog(null)}
          perform={perform}
          busy={busy}
          problem={runner.problem}
          onDone={(orderId) => {
            setDialog(null);
            toast.success('Draft order created');
            navigate(`/${co}/purchase-orders/${orderId}`);
          }}
        />
      )}

      <SignDialog
        {...runner.signProps}
        documentTitle={`Requisition: ${r.number || 'Draft'}`}
        documentNumber={r.number || 'Draft'}
        amount={r.total}
        currency={r.currency}
        makerName={makerName}
        actionTitle={sign.action}
        consequenceText={sign.text}
      />
      <ConflictDialog conflict={runner.conflict} />
    </div>
  );
};

/** Return, reject and discard: one question each. */
const ReasonOrComment: React.FC<{
  dialog: Dialog_;
  text: string;
  setText: (v: string) => void;
  problem: string;
  busy: boolean;
  close: () => void;
  onReturn: () => void;
  onReject: () => void;
  onVoid: () => void;
}> = ({ dialog, text, setText, problem, busy, close, onReturn, onReject, onVoid }) => (
  <>
    <ReasonDialog open={dialog === 'return'} title="Send back for changes" label="Why are you sending it back?" confirm="Send back" tone="warning" value={text} onChange={setText} problem={problem} busy={busy} onClose={close} onConfirm={onReturn} />
    <ReasonDialog open={dialog === 'reject'} title="Reject this requisition" intro="A rejected requisition is closed for good. The person who asked sees your reason." label="Why is it rejected?" confirm="Reject requisition" value={text} onChange={setText} problem={problem} busy={busy} onClose={close} onConfirm={onReject} />
    <ReasonDialog open={dialog === 'void'} title="Discard this requisition" intro="A discarded requisition is marked void and kept for the record." label="Reason (optional)" required={false} confirm="Discard requisition" cancel="Keep it" value={text} onChange={setText} problem={problem} busy={busy} onClose={close} onConfirm={onVoid} />
  </>
);

interface PerformFn {
  <T>(name: string, signature: string, sign: string | null, call: (intent: Intent) => Promise<T>, inDialog?: boolean): Promise<T | undefined>;
}

/** Create an order from the approved lines that are not on one yet. */
const ConvertDialog: React.FC<{
  requisition: Requisition;
  onClose: () => void;
  perform: PerformFn;
  busy: boolean;
  problem: string;
  onDone: (orderId: string) => void;
}> = ({ requisition: r, onClose, perform, busy, problem, onDone }) => {
  const actions = useRequisitionActions();
  const suppliers = useContactDirectory('supplier');
  const refs = useTradeRefs();
  const open = convertibleLines(r);
  const [ticked, setTicked] = useState<Set<string>>(new Set(open.map((l) => l.id)));
  const [contactId, setContactId] = useState('');
  const [orderDate, setOrderDate] = useState(() => toApiDate(new Date()));
  const [expected, setExpected] = useState('');
  const [currency, setCurrency] = useState(r.currency);
  const [fxRate, setFxRate] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [taxes, setTaxes] = useState<Record<string, string>>({});
  const foreign = currency !== r.currency;

  const toggle = (id: string) =>
    setTicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const onPickSupplier = (id: string) => {
    setContactId(id);
    const c = suppliers.byId.get(id);
    if (c) setCurrency(c.default_currency);
  };

  const input: ConvertInput = {
    contact_id: contactId,
    order_date: orderDate,
    expected_date: expected,
    currency,
    fx_rate: fxRate,
    reference,
    memo,
    lines: open.filter((l) => ticked.has(l.id)).map((l) => ({ requisition_line_id: l.id, unit_price_fc: prices[l.id] ?? 0, tax_code_id: taxes[l.id] || undefined })),
  };
  const body = toConvertRequest(input, r.currency);

  const go = async () => {
    const o = await perform('convert', JSON.stringify(body), null, (intent) => actions.convert(r.id, body, intent), true);
    if (o) onDone(o.id);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-3xl rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">Create an order</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto text-xs text-text-secondary">
          <p>Tick the lines to buy from one supplier. They become a draft purchase order that you can still edit before it is submitted.</p>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-xs" data-testid="convert-lines">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2">Description</th>
                  <th className="w-16 px-2 py-2 text-right">Qty</th>
                  <th className="w-28 px-2 py-2 text-right">Estimated price</th>
                  {foreign && <th className="w-32 px-2 py-2 text-right">Price in {currency}</th>}
                  <th className="w-32 px-2 py-2">Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {open.map((l) => (
                  <tr key={l.id}>
                    <td className="px-2 py-1.5">
                      <Checkbox checked={ticked.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`Include line ${l.line_no}`} />
                    </td>
                    <td className="px-2 py-1.5 text-text-primary">{l.description || '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{showQty(l.quantity)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(l.estimated_unit_price, r.currency)}</td>
                    {foreign && (
                      <td className="px-2 py-1.5">
                        <MoneyInput value={prices[l.id] ?? 0} onChange={(v) => setPrices((p) => ({ ...p, [l.id]: v }))} currency={currency} allowNegative={false} size="sm" />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <select aria-label={`Tax code, line ${l.line_no}`} value={taxes[l.id] ?? ''} onChange={(e) => setTaxes((t) => ({ ...t, [l.id]: e.target.value }))} className={cn(inputClass, 'w-full')}>
                        <option value="">No tax</option>
                        {refs.taxCodes.filter((t) => t.kind !== 'wht').map((t) => (
                          <option key={t.id} value={t.id}>{t.code}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 font-semibold text-text-primary md:col-span-2">
              Supplier
              <select aria-label="Supplier" value={contactId} onChange={(e) => onPickSupplier(e.target.value)} className={cn(inputClass, 'w-full font-normal')}>
                <option value="">Choose a supplier</option>
                {suppliers.contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              Order date
              <input type="date" aria-label="Order date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={cn(inputClass, 'font-normal')} />
            </label>
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              Expected on
              <input type="date" aria-label="Expected date" value={expected} onChange={(e) => setExpected(e.target.value)} className={cn(inputClass, 'font-normal')} />
            </label>
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              Currency
              <input aria-label="Currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} className={cn(inputClass, 'font-normal')} />
            </label>
            {foreign && (
              <label className="flex flex-col gap-1 font-semibold text-text-primary">
                Exchange rate (1 {currency} = ? {r.currency})
                <input aria-label="Exchange rate" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="Empty: the stored rate" className={cn(inputClass, 'font-normal')} />
              </label>
            )}
            <label className="flex flex-col gap-1 font-semibold text-text-primary">
              Reference
              <input aria-label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} className={cn(inputClass, 'font-normal')} />
            </label>
            <label className="flex flex-col gap-1 font-semibold text-text-primary md:col-span-3">
              Note
              <input aria-label="Note" value={memo} onChange={(e) => setMemo(e.target.value)} className={cn(inputClass, 'font-normal')} />
            </label>
          </div>
          {foreign && <p className="text-[11px] text-text-muted">The estimates are in {r.currency}. For an order in {currency}, enter the price of each line in {currency}.</p>}
          {problem && <p role="alert" className="text-xs font-medium text-danger">{problem}</p>}
        </div>
        <DialogFooter className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
          <button type="button" disabled={!contactId || !orderDate || input.lines.length === 0 || busy} onClick={() => void go()} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            Create order
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
