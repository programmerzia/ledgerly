import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle, Clock, FilePlus, Lock, Package, Pencil, Printer, RotateCcw, Send, Trash2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { ConflictDialog } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { DocStatusPill } from '@/pages/Sales/live/parts';
import { cn } from '@/lib/utils';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useLedgerStore } from '@/mock/store';
import { useAccounts } from '@/data/accounts';
import { useContactDirectory } from '@/data/contacts';
import { useTradeRefs } from '@/data/tradeRefs';
import { useMemberNames } from '@/data/approvals';
import { useOrder, useOrderActions, useOrderBills, useOrderReceipts, useOrderRevisions, useRevisionActions } from '@/data/procurement';
import { ApiError } from '@/api/errors';
import { rateForDisplay } from '@/api/adapters/money';
import { linesChanged, statusLabel, type OrderRevision, type PurchaseOrder } from '@/api/adapters/procurement';
import { CreateBillDialog, EmptyState, ErrorLine, LoadingLine, ProcStatusPill, ReasonDialog, showQty, useActionRunner } from './parts';

type Dlg = null | 'return' | 'cancel' | 'close' | 'bill' | { rev: OrderRevision; kind: 'return' | 'void' };
type TabKey = 'receipts' | 'bills' | 'revisions';

export const OrderView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const company = useRouteCompany();
  const co = company.slug;
  const me = useLedgerStore((s) => s.currentUser);
  const q = useOrder(id);
  const accounts = useAccounts();
  const suppliers = useContactDirectory('supplier', true);
  const refs = useTradeRefs();
  const names = useMemberNames();
  const actions = useOrderActions();
  const revActions = useRevisionActions();
  const o = q.data;
  const runner = useActionRunner({ noun: 'order', localVersion: o?.version, reload: () => void q.refetch() });
  const [dialog, setDialog] = useState<Dlg>(null);
  const [text, setText] = useState('');
  const tab = (['receipts', 'bills', 'revisions'].includes(params.get('tab') ?? '') ? params.get('tab') : 'receipts') as TabKey;

  if (q.isLoading || accounts.isLoading) return <LoadingLine what="purchase order" />;
  if (q.error || !o) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound ? (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This order does not exist in this company.{' '}
        <button type="button" onClick={() => navigate(`/${co}/purchase-orders`)} className="text-accent hover:underline">Back to purchase orders</button>
      </div>
    ) : (
      <ErrorLine error={q.error} onRetry={q.refetch} />
    );
  }

  const supplier = suppliers.byId.get(o.contact_id);
  const accountName = (aid: string) => {
    const a = accounts.data.find((x) => x.id === aid);
    return a ? `${a.code} ${a.name}` : '';
  };
  const taxCode = (tid: string | null) => refs.taxCodes.find((t) => t.id === tid)?.code ?? '';
  const numberLabel = o.number ?? statusLabel('order', o.status);
  const makerName = names.get(o.submitted_by ?? o.created_by ?? '');
  const isMine = o.created_by === me.id || o.submitted_by === me.id;
  const foreign = o.currency !== o.baseCurrency;
  const can = o.can;
  const sig = `${o.id}:${o.version}`;
  const { perform, busy } = runner;
  const closeDialog = () => setDialog(null);
  const openText = (d: Dlg) => {
    runner.setProblem('');
    setText('');
    setDialog(d);
  };

  const doSubmit = async () => {
    const x = await perform('submit', sig, 'submit', (intent) => actions.submit(o.id, o.version, intent));
    if (x) toast.success(x.status === 'approved' ? `Approved as ${x.number}` : 'Sent for approval');
  };
  const doApprove = async () => {
    const x = await perform('approve', sig, 'approve', (intent) => actions.approve(o.id, o.version, intent));
    if (x) toast.success(x.status === 'pending_approval' ? 'Your approval is recorded. Another step is still to come.' : `Approved as ${x.number}`);
  };
  const doReturn = async () => {
    const comment = text.trim();
    const x = await perform('return', `${sig}:${comment}`, null, (intent) => actions.sendBack(o.id, comment, o.version, intent), true);
    if (x) {
      closeDialog();
      toast.success('Sent back to the maker as a draft');
    }
  };
  const doCancel = async () => {
    const reason = text.trim();
    const x = await perform('cancel', `${sig}:${reason}`, null, (intent) => actions.cancel(o.id, reason, o.version, intent), true);
    if (x) {
      closeDialog();
      toast.success('Order cancelled');
    }
  };
  const doClose = async () => {
    const x = await perform('close', sig, null, (intent) => actions.close(o.id, o.version, intent), true);
    if (x) {
      closeDialog();
      toast.success('Order closed');
    }
  };
  const doBill = async (body: Record<string, unknown>) => {
    const b = await perform('bill', `${o.id}:${JSON.stringify(body)}`, null, (intent) => actions.createBill(o.id, body, intent), true);
    if (b) {
      closeDialog();
      toast.success('Bill drafted from this order');
      navigate(`/${co}/bills/${b.id}`);
    }
  };
  const doRevision = async (rev: OrderRevision, verb: 'submit' | 'approve') => {
    const rsig = `${rev.id}:${rev.version}`;
    const x = await perform(`rev-${verb}`, rsig, verb === 'approve' ? 'rev-approve' : 'rev-submit', (intent) => (verb === 'approve' ? revActions.approve(rev.id, rev.version, intent) : revActions.submit(rev.id, rev.version, intent)));
    if (x) toast.success(x.status === 'applied' ? 'Revision applied to the order' : verb === 'submit' ? 'Revision sent for approval' : 'Your approval is recorded. Another step is still to come.');
  };
  const doRevisionText = async () => {
    if (!dialog || typeof dialog === 'string') return;
    const { rev, kind } = dialog;
    const t = text.trim();
    const rsig = `${rev.id}:${rev.version}:${t}`;
    const x = await perform(`rev-${kind}`, rsig, null, (intent) => (kind === 'return' ? revActions.sendBack(rev.id, t, rev.version, intent) : revActions.voidDoc(rev.id, t, rev.version, intent)), true);
    if (x) {
      closeDialog();
      toast.success(kind === 'return' ? 'Revision sent back as a draft' : 'Revision discarded');
    }
  };

  const sign =
    runner.pending === 'approve'
      ? { action: 'Approve order', text: 'Approving lets you order from the supplier and record what arrives. Nothing is posted to your books until a bill is.' }
      : runner.pending === 'rev-approve'
        ? { action: 'Approve revision', text: 'The change is applied to the order as soon as it is approved. What was already received and billed stays as it is.' }
        : runner.pending === 'rev-submit'
          ? { action: 'Sign and apply', text: 'Nobody else needs to approve this revision under your company rules, so it is applied to the order now.' }
          : { action: 'Sign and approve', text: 'Nobody else needs to approve this order under your company rules, so it is approved now with the next number.' };

  const pendingApproval = o.status === 'pending_approval';
  const inProgress = ['approved', 'partly_received', 'received'].includes(o.status);

  const reasonProps = { problem: runner.problem, busy, onClose: closeDialog, value: text, onChange: setText };

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: 'Purchase orders', to: `/${co}/purchase-orders` }, { label: numberLabel }]}
        title={o.number || (o.status === 'draft' ? 'Draft purchase order' : 'Purchase order')}
        subtitle={supplier?.name ?? (o.contact_name || undefined)}
        meta={<ProcStatusPill kind="order" status={o.status} />}
        actions={
          <button type="button" onClick={() => window.print()} className={BTN_SECONDARY}>
            <Printer className="size-4 text-text-muted" /> Print
          </button>
        }
      />

      {o.status === 'cancelled' && (
        <div className="rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          This order was cancelled. {o.cancel_reason}
        </div>
      )}
      {o.status === 'closed' && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          <Lock className="size-4" /> This order is closed. Nothing more can be received or billed on it.
        </div>
      )}
      {o.open_revision_id && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] font-medium text-warning">
          A revision of this order is in progress.{' '}
          <button type="button" className="underline" onClick={() => setParams({ tab: 'revisions' })}>
            See it
          </button>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article aria-label={`Purchase order ${o.number ?? 'draft'}`} className="rounded-lg border border-border bg-surface px-6 py-8 sm:px-10 sm:py-10" data-testid="doc-paper">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-text-primary">{company.name}</div>
              {company.legal_name && company.legal_name !== company.name && <div className="text-xs text-text-muted">{company.legal_name}</div>}
            </div>
            <div className="text-right">
              <h2 className="text-3xl font-semibold text-text-primary">Purchase order</h2>
              <div className="mt-1 text-sm font-medium tabular-nums text-text-secondary">{numberLabel}</div>
              {o.revision > 0 && <div className="text-xs font-medium tabular-nums text-text-secondary" data-testid="order-revision">Revision {o.revision}</div>}
            </div>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">Supplier</div>
              <div className="mt-1 text-[13px] font-semibold text-text-primary">{supplier?.name ?? (o.contact_name || '—')}</div>
              {supplier?.billing_address.map((l, i) => (
                <div key={i} className="text-xs text-text-secondary">{l}</div>
              ))}
              {supplier?.email && <div className="text-xs text-text-secondary">{supplier.email}</div>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:justify-self-end">
              <dt className="text-text-muted">Order date</dt>
              <dd className="tabular-nums text-text-primary">{formatDate(o.order_date)}</dd>
              <dt className="text-text-muted">Expected on</dt>
              <dd className="tabular-nums text-text-primary">{o.expected_date ? formatDate(o.expected_date) : '—'}</dd>
              <dt className="text-text-muted">Currency</dt>
              <dd className="text-text-primary">{o.currency}</dd>
              {foreign && (
                <>
                  <dt className="text-text-muted">Rate</dt>
                  <dd className="tabular-nums text-text-primary">{rateForDisplay(o.fx_rate)}</dd>
                </>
              )}
              {o.reference && (
                <>
                  <dt className="text-text-muted">Reference</dt>
                  <dd className="text-text-primary">{o.reference}</dd>
                </>
              )}
            </dl>
          </div>

          <table className="mt-8 w-full text-left text-xs" data-testid="order-lines">
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="py-2 pr-2">Description</th>
                <th className="w-16 px-2 py-2 text-right">Ordered</th>
                <th className="w-16 px-2 py-2 text-right">Received</th>
                <th className="w-16 px-2 py-2 text-right">Billed</th>
                <th className="w-28 px-2 py-2 text-right">Unit price</th>
                <th className="w-16 px-2 py-2">Tax</th>
                <th className="w-28 py-2 pl-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {o.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-2">
                    <div className="text-text-primary">{l.description || '—'}</div>
                    <div className="text-[11px] text-text-muted">{accountName(l.account_id)}</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{showQty(l.quantity)}</td>
                  <td className="px-2 py-2 text-right tabular-nums" data-testid={`received-${l.line_no}`}>{showQty(l.received)}</td>
                  <td className="px-2 py-2 text-right tabular-nums" data-testid={`billed-${l.line_no}`}>{showQty(l.billed)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(l.unit_price_fc, o.currency)}</td>
                  <td className="px-2 py-2 text-text-muted">{taxCode(l.tax_code_id)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums text-text-primary">{formatMoney(l.line_total_fc, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-6 flex max-w-xs flex-col gap-1.5 text-[13px]" data-testid="doc-paper-totals">
            <div className="flex justify-between"><dt className="text-text-secondary">Subtotal</dt><dd className="tabular-nums">{formatMoney(o.subtotal_fc, o.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Tax</dt><dd className="tabular-nums">{formatMoney(o.tax_total_fc, o.currency)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(o.total_fc, o.currency)}</dd></div>
            {foreign && <div className="flex justify-between text-xs text-text-muted"><dt>In {o.baseCurrency}</dt><dd className="tabular-nums">{formatMoney(o.total, o.baseCurrency)}</dd></div>}
          </dl>
          {o.memo && <p className="mt-6 text-xs text-text-secondary">{o.memo}</p>}
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className={cn(CARD, 'flex flex-col gap-4 p-5')} aria-label="Status and actions">
            <div>
              <div className="text-xs text-text-muted">Total</div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-text-primary">{formatMoney(o.total_fc, o.currency)}</div>
              <div className="mt-1 text-[13px] text-text-muted">{o.lines.length} {o.lines.length === 1 ? 'line' : 'lines'} · {statusLabel('order', o.status).toLowerCase()}</div>
              {makerName && <div className="mt-1 text-xs text-text-muted">Prepared by {makerName}</div>}
            </div>

            {pendingApproval &&
              (can.approve ? (
                <div className="grid grid-cols-2 gap-2">
                  {can.return && (
                    <button type="button" onClick={() => openText('return')} disabled={busy} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                      <RotateCcw className="size-4" /> Return
                    </button>
                  )}
                  <button type="button" onClick={() => void doApprove()} disabled={busy} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50">
                    <CheckCircle className="size-4" /> Approve
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning">
                  <Clock className="size-4 shrink-0" />
                  {isMine ? 'Waiting for someone else to approve' : 'Waiting for approval'}
                </div>
              ))}

            {o.status === 'draft' && (
              <div className="flex flex-col gap-2">
                {can.submit && (
                  <button type="button" onClick={() => void doSubmit()} disabled={busy} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50">
                    <Send className="size-4" /> Submit
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {can.update && (
                    <button type="button" onClick={() => navigate(`/${co}/purchase-orders/${o.id}/edit`)} className={BTN_SECONDARY}>
                      <Pencil className="size-4 text-text-muted" /> Edit draft
                    </button>
                  )}
                  {can.cancel && (
                    <button type="button" onClick={() => openText('cancel')} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                      <Trash2 className="size-4" /> Cancel order
                    </button>
                  )}
                </div>
              </div>
            )}

            {inProgress && (
              <div className="flex flex-col gap-2">
                {can.receive && (
                  <button type="button" onClick={() => navigate(`/${co}/purchase-orders/${o.id}/receive`)} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
                    <Package className="size-4" /> Record receipt
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {can.bill && (
                    <button type="button" onClick={() => { runner.setProblem(''); setDialog('bill'); }} className={BTN_SECONDARY}>
                      <FilePlus className="size-4 text-text-muted" /> Create bill
                    </button>
                  )}
                  {can.revise && !o.open_revision_id && (
                    <button type="button" onClick={() => navigate(`/${co}/purchase-orders/${o.id}/revise`)} className={BTN_SECONDARY}>
                      <Pencil className="size-4 text-text-muted" /> Revise
                    </button>
                  )}
                  {can.close && (
                    <button type="button" onClick={() => { runner.setProblem(''); setDialog('close'); }} className={BTN_SECONDARY}>
                      <Lock className="size-4 text-text-muted" /> Close
                    </button>
                  )}
                  {can.cancel && (
                    <button type="button" onClick={() => openText('cancel')} className={cn(BTN_SECONDARY, 'border-danger/40 text-danger hover:border-danger/60 hover:bg-danger-soft')}>
                      <XCircle className="size-4" /> Cancel order
                    </button>
                  )}
                </div>
              </div>
            )}

            {pendingApproval && can.cancel && (
              <button type="button" onClick={() => openText('cancel')} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                <XCircle className="size-4" /> Cancel order
              </button>
            )}
          </section>
        </aside>
      </div>

      <section className={cn(CARD, 'no-print overflow-hidden')} aria-label="Receipts, bills and revisions">
        <div className="flex items-center gap-1 border-b border-border px-3" role="tablist">
          {(['receipts', 'bills', 'revisions'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setParams(t === 'receipts' ? {} : { tab: t })}
              className={cn('-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium capitalize transition-colors', tab === t ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'receipts' && <ReceiptsTab orderId={o.id} co={co} />}
        {tab === 'bills' && <BillsTab orderId={o.id} co={co} />}
        {tab === 'revisions' && (
          <RevisionsTab
            order={o}
            co={co}
            names={names}
            busy={busy}
            onSubmit={(r) => void doRevision(r, 'submit')}
            onApprove={(r) => void doRevision(r, 'approve')}
            onText={(rev, kind) => openText({ rev, kind })}
            onEdit={() => navigate(`/${co}/purchase-orders/${o.id}/revise`)}
          />
        )}
      </section>

      <ReasonDialog open={dialog === 'return'} title="Send back for changes" label="Why are you sending it back?" confirm="Send back" tone="warning" {...reasonProps} onConfirm={() => void doReturn()} />
      <ReasonDialog
        open={dialog === 'cancel'}
        title={`Cancel ${numberLabel === 'Draft' ? 'this order' : numberLabel}`}
        intro="A cancelled order takes no receipts or bills. It is only offered while nothing has been received or billed. The number stays on record."
        label="Why is it cancelled?"
        confirm="Cancel order"
        cancel="Keep it"
        {...reasonProps}
        onConfirm={() => void doCancel()}
      />
      <ReasonDialog
        open={typeof dialog === 'object' && dialog !== null}
        title={typeof dialog === 'object' && dialog?.kind === 'return' ? 'Send the revision back' : 'Discard the revision'}
        intro={typeof dialog === 'object' && dialog?.kind === 'void' ? 'A discarded revision is kept for the record. The order stays as it is.' : undefined}
        label={typeof dialog === 'object' && dialog?.kind === 'return' ? 'Why are you sending it back?' : 'Reason (optional)'}
        required={typeof dialog === 'object' && dialog?.kind === 'return'}
        confirm={typeof dialog === 'object' && dialog?.kind === 'return' ? 'Send back' : 'Discard revision'}
        tone={typeof dialog === 'object' && dialog?.kind === 'return' ? 'warning' : 'danger'}
        {...reasonProps}
        onConfirm={() => void doRevisionText()}
      />

      <Dialog open={dialog === 'close'} onOpenChange={(o2) => !o2 && closeDialog()}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader><DialogTitle className="text-base font-semibold text-text-primary">Close this order</DialogTitle></DialogHeader>
          <p className="text-xs text-text-secondary">Closing finishes the order: nothing more can be received or billed on it. It is only possible when everything received has been billed.</p>
          {runner.problem && <p role="alert" className="text-xs text-danger">{runner.problem}</p>}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={closeDialog} className="h-9 rounded-md border border-border bg-surface px-3 text-xs hover:bg-surface-neutral">Keep it open</button>
            <button type="button" onClick={() => void doClose()} disabled={busy} className="h-9 rounded-md bg-accent px-3 text-xs font-semibold text-white disabled:opacity-50">Close order</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateBillDialog open={dialog === 'bill'} from="order" foreign={foreign} busy={busy} problem={runner.problem} onClose={closeDialog} onCreate={(body) => void doBill(body)} />

      <SignDialog
        {...runner.signProps}
        documentTitle={`Purchase order: ${o.number || 'Draft'}`}
        documentNumber={o.number || 'Draft'}
        amount={o.total}
        currency={o.baseCurrency}
        makerName={makerName}
        actionTitle={sign.action}
        consequenceText={sign.text}
      />
      <ConflictDialog conflict={runner.conflict} />
    </div>
  );
};

const ReceiptsTab: React.FC<{ orderId: string; co: string }> = ({ orderId, co }) => {
  const q = useOrderReceipts(orderId);
  if (q.isLoading) return <LoadingLine what="receipts" />;
  if (q.error) return <ErrorLine error={q.error} onRetry={q.refetch} />;
  if (q.data.length === 0) return <EmptyState title="Nothing received yet" hint="Record a receipt when the goods arrive or the service is done." />;
  return (
    <table className="w-full text-left text-[13px]" data-testid="order-receipts">
      <thead>
        <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
          <th className="px-4 py-2">Receipt</th>
          <th className="px-3 py-2">Date</th>
          <th className="px-3 py-2">Reference</th>
          <th className="px-3 py-2">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {q.data.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-2"><Link to={`/${co}/goods-receipts/${r.id}`} className="font-semibold text-accent hover:underline">{r.number}</Link></td>
            <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(r.receipt_date)}</td>
            <td className="px-3 py-2 text-text-secondary">{r.reference || '—'}</td>
            <td className="px-3 py-2"><ProcStatusPill kind="receipt" status={r.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const BillsTab: React.FC<{ orderId: string; co: string }> = ({ orderId, co }) => {
  const q = useOrderBills(orderId);
  if (q.isLoading) return <LoadingLine what="bills" />;
  if (q.error) return <ErrorLine error={q.error} onRetry={q.refetch} />;
  if (q.data.length === 0) return <EmptyState title="No bills yet" hint="Create a bill from this order or from a receipt, then match the supplier’s invoice to it." />;
  return (
    <table className="w-full text-left text-[13px]" data-testid="order-bills">
      <thead>
        <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
          <th className="px-4 py-2">Bill</th>
          <th className="px-3 py-2">Date</th>
          <th className="px-3 py-2">Status</th>
          <th className="px-3 py-2 text-right">Total</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {q.data.map((b) => (
          <tr key={b.id}>
            <td className="px-4 py-2"><Link to={`/${co}/bills/${b.id}`} className="font-semibold text-accent hover:underline">{b.number ?? 'Draft'}</Link></td>
            <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(b.issue_date)}</td>
            <td className="px-3 py-2"><DocStatusPill doc={b} /></td>
            <td className="px-3 py-2 text-right font-medium tabular-nums text-text-primary">{formatMoney(b.total_fc, b.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Every revision stays visible, applied ones with what they changed. An open one carries its own actions. */
const RevisionsTab: React.FC<{
  order: PurchaseOrder;
  co: string;
  names: Map<string, string>;
  busy: boolean;
  onSubmit: (r: OrderRevision) => void;
  onApprove: (r: OrderRevision) => void;
  onText: (r: OrderRevision, kind: 'return' | 'void') => void;
  onEdit: () => void;
}> = ({ order, names, busy, onSubmit, onApprove, onText, onEdit }) => {
  const q = useOrderRevisions(order.id);
  if (q.isLoading) return <LoadingLine what="revisions" />;
  if (q.error) return <ErrorLine error={q.error} onRetry={q.refetch} />;
  if (q.data.length === 0) return <EmptyState title="No revisions" hint="Revise an approved order to change its quantities, prices or dates. The change is applied once it is approved." />;
  const who = (id: string | null) => (id ? (names.get(id) ?? 'a colleague') : null);
  return (
    <ul className="divide-y divide-border" data-testid="order-revisions">
      {q.data.map((r) => {
        const open = r.status === 'draft' || r.status === 'pending_approval';
        const changed = linesChanged(r.before, r.after);
        const cur = r.before?.currency ?? order.currency;
        return (
          <li key={r.id} className="flex flex-col gap-2 px-5 py-4 text-[13px]" data-testid="revision-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-text-primary">{r.revision_no ? `Revision ${r.revision_no}` : 'Revision in progress'}</span>
              <ProcStatusPill kind="revision" status={r.status} />
              {r.applied_at && <span className="text-xs text-text-muted">Applied {formatDateTime(r.applied_at)}</span>}
            </div>
            <p className="text-text-secondary">{r.reason}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
              {who(r.created_by) && <span>Proposed by {who(r.created_by)}</span>}
              {who(r.approved_by) && <span>Approved by {who(r.approved_by)}</span>}
              {r.before?.total_fc != null && r.after?.total_fc != null && (
                <span className="tabular-nums">
                  Total {formatMoney(r.before.total_fc, cur)} before, {formatMoney(r.after.total_fc, cur)} after
                </span>
              )}
              {open && r.proposed?.total_fc != null && <span className="tabular-nums">Proposed total {formatMoney(r.proposed.total_fc, order.currency)}</span>}
              {changed !== null && <span>{changed} {changed === 1 ? 'line' : 'lines'} changed</span>}
            </div>
            {open && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {r.status === 'draft' && r.can.submit && (
                  <button type="button" disabled={busy} onClick={() => onSubmit(r)} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                    <Send className="size-4" /> Submit
                  </button>
                )}
                {r.status === 'pending_approval' && r.can.approve && (
                  <button type="button" disabled={busy} onClick={() => onApprove(r)} className="flex h-8 items-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50">
                    <CheckCircle className="size-4" /> Approve
                  </button>
                )}
                {r.status === 'pending_approval' && !r.can.approve && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-warning"><Clock className="size-4" /> Waiting for approval</span>
                )}
                {r.can.return && (
                  <button type="button" disabled={busy} onClick={() => onText(r, 'return')} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                    <RotateCcw className="size-4" /> Return
                  </button>
                )}
                {r.can.update && (
                  <button type="button" onClick={onEdit} className={BTN_SECONDARY}>
                    <Pencil className="size-4 text-text-muted" /> Edit
                  </button>
                )}
                {r.can.void && (
                  <button type="button" disabled={busy} onClick={() => onText(r, 'void')} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                    <Trash2 className="size-4" /> Void
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
