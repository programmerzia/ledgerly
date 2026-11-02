import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { FilePlus, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { ConflictDialog } from '@/components/domain/ConflictDialog';
import { BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { cn } from '@/lib/utils';
import { formatDate, formatDateTime } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useMemberNames } from '@/data/approvals';
import { useReceipt, useReceiptActions } from '@/data/procurement';
import { ApiError } from '@/api/errors';
import { CreateBillDialog, ErrorLine, LoadingLine, ProcStatusPill, ReasonDialog, showQty, useActionRunner } from './parts';

export const ReceiptView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const co = useRouteCompany().slug;
  const q = useReceipt(id);
  const names = useMemberNames();
  const actions = useReceiptActions();
  const r = q.data;
  const runner = useActionRunner({ noun: 'receipt', localVersion: r?.version, reload: () => void q.refetch() });
  const [dialog, setDialog] = useState<null | 'reverse' | 'bill'>(null);
  const [text, setText] = useState('');

  if (q.isLoading) return <LoadingLine what="receipt" />;
  if (q.error || !r) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound ? (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This receipt does not exist in this company.{' '}
        <button type="button" onClick={() => navigate(`/${co}/goods-receipts`)} className="text-accent hover:underline">Back to receipts</button>
      </div>
    ) : (
      <ErrorLine error={q.error} onRetry={q.refetch} />
    );
  }

  const reversed = r.status === 'reversed';
  const { perform, busy } = runner;
  const closeDialog = () => setDialog(null);

  const doReverse = async () => {
    const reason = text.trim();
    const x = await perform('reverse', `${r.id}:${r.version}:${reason}`, null, (intent) => actions.reverse(r.id, reason, r.version, intent), true);
    if (x) {
      closeDialog();
      setText('');
      toast.success(`Receipt ${r.number} reversed. The order is open to receive again.`);
    }
  };
  const doBill = async (body: Record<string, unknown>) => {
    const b = await perform('bill', `${r.id}:${JSON.stringify(body)}`, null, (intent) => actions.createBill(r.id, body, intent), true);
    if (b) {
      closeDialog();
      toast.success('Bill drafted from this receipt');
      navigate(`/${co}/bills/${b.id}`);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: 'Receipts', to: `/${co}/goods-receipts` }, { label: r.number }]}
        title={r.number}
        subtitle={r.contact_name || undefined}
        meta={<ProcStatusPill kind="receipt" status={r.status} />}
      />

      {reversed && (
        <div className="rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] text-text-secondary" data-testid="receipt-reversed">
          <span className="font-semibold text-text-primary">This receipt was reversed.</span>{' '}
          {r.reversal_reason}
          {r.reversed_at && <span className="text-text-muted"> · {formatDateTime(r.reversed_at)}{r.reversed_by ? ` by ${names.get(r.reversed_by) ?? 'a colleague'}` : ''}</span>}
          <div className="mt-1 text-xs text-text-muted">It no longer counts as received, and the quantities are open on the order again.</div>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article aria-label={`Receipt ${r.number}`} className={cn('rounded-lg border border-border bg-surface px-6 py-8 sm:px-10 sm:py-10', reversed && 'opacity-75')}>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <h2 className="text-3xl font-semibold text-text-primary">Goods receipt</h2>
            <div className="text-right text-sm font-medium tabular-nums text-text-secondary">{r.number}</div>
          </div>
          <dl className="mt-8 grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-text-muted">Order</dt>
            <dd>
              <Link to={`/${co}/purchase-orders/${r.purchase_order_id}`} className="font-medium text-accent hover:underline">{r.order_number ?? 'Open the order'}</Link>
            </dd>
            <dt className="text-text-muted">Supplier</dt>
            <dd className="text-text-primary">{r.contact_name || '—'}</dd>
            <dt className="text-text-muted">Received on</dt>
            <dd className="tabular-nums text-text-primary">{formatDate(r.receipt_date)}</dd>
            {r.reference && (
              <>
                <dt className="text-text-muted">Reference</dt>
                <dd className="text-text-primary">{r.reference}</dd>
              </>
            )}
          </dl>
          <table className="mt-8 w-full text-left text-xs" data-testid="receipt-view-lines">
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="w-12 py-2 pr-2">Line</th>
                <th className="py-2 pr-2">Description</th>
                <th className="w-24 py-2 pl-2 text-right">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-2 tabular-nums text-text-muted">{l.line_no}</td>
                  <td className="py-2 pr-2 text-text-primary">{l.description || '—'}</td>
                  <td className="py-2 pl-2 text-right tabular-nums">{showQty(l.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.memo && <p className="mt-6 text-xs text-text-secondary">{r.memo}</p>}
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className={cn(CARD, 'flex flex-col gap-3 p-5')} aria-label="Status and actions">
            <div className="text-[13px] text-text-muted">{r.lines.length} {r.lines.length === 1 ? 'line' : 'lines'} · {reversed ? 'reversed' : 'recorded'}</div>
            {r.can.bill && !reversed && (
              <button type="button" onClick={() => { runner.setProblem(''); setDialog('bill'); }} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
                <FilePlus className="size-4" /> Create bill
              </button>
            )}
            {r.can.reverse && !reversed && (
              <button type="button" onClick={() => { runner.setProblem(''); setText(''); setDialog('reverse'); }} className={cn(BTN_SECONDARY, 'border-danger/40 text-danger hover:border-danger/60 hover:bg-danger-soft')}>
                <RotateCcw className="size-4" /> Reverse
              </button>
            )}
            <Link to={`/${co}/purchase-orders/${r.purchase_order_id}`} className="text-xs text-accent hover:underline">
              View the order
            </Link>
          </section>
        </aside>
      </div>

      <ReasonDialog
        open={dialog === 'reverse'}
        title={`Reverse ${r.number}`}
        intro="Reversing says this delivery did not happen, or was entered wrongly. The quantities go back to open on the order. Both stay on record."
        label="Why are you reversing it?"
        confirm="Reverse receipt"
        value={text}
        onChange={setText}
        problem={runner.problem}
        busy={busy}
        onClose={closeDialog}
        onConfirm={() => void doReverse()}
      />
      <CreateBillDialog open={dialog === 'bill'} from="receipt" foreign={false} busy={busy} problem={runner.problem} onClose={closeDialog} onCreate={(body) => void doBill(body)} />
      <ConflictDialog conflict={runner.conflict} />
    </div>
  );
};
