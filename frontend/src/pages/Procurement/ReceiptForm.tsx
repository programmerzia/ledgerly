import React, { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Package } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useOrder, useReceiptActions } from '@/data/procurement';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { describePurchaseViolation } from '@/api/tradeViolations';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import { splitDocFieldErrors, splitDocViolations } from '@/api/adapters/invoice';
import { isPositiveQuantity, openReceiptLines, sentLines, toReceiptRequest, type PurchaseOrder } from '@/api/adapters/procurement';
import { BTN_ACCENT, ErrorLine, LoadingLine, inputClass, showQty } from './parts';

interface Row {
  order_line_id: string;
  quantity: string;
}

const Inner: React.FC<{ order: PurchaseOrder; reload: () => void }> = ({ order, reload }) => {
  const navigate = useNavigate();
  const co = useRouteCompany().slug;
  const actions = useReceiptActions();
  const { run, signProps } = useSignedRun();
  const open = openReceiptLines(order);
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  // Prefilled from what the server says is still open; blank means skip the line.
  const [rows, setRows] = useState<Row[]>(() => open.map((x) => ({ order_line_id: x.line.id, quantity: x.open })));
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const slot = useRef(new IntentSlot()).current;

  const input = { purchase_order_id: order.id, receipt_date: date, order_version: order.version, reference, memo, lines: rows };
  const setQty = (id: string, quantity: string) => {
    setRows((prev) => prev.map((r) => (r.order_line_id === id ? { ...r, quantity } : r)));
    setLineErrors((e) => {
      const { [id]: _drop, ...rest } = e;
      return rest;
    });
  };

  const showError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) {
      setConflict({
        noun: 'purchase order',
        serverVersion: e.serverVersion,
        localVersion: order.version,
        onClose: () => setConflict(null),
        onReload: () => {
          setConflict(null);
          reload();
        },
      });
      return;
    }
    // A violation's line number is the position among the lines that were sent (blank rows are not sent).
    const sent = sentLines(rows);
    const byRow: Record<string, string> = {};
    const header: string[] = [];
    if (e instanceof ApiError && e.violations?.length) {
      const split = splitDocViolations(e.violations);
      header.push(...split.header.map(describePurchaseViolation));
      split.byLine.forEach((vs, lineNo) => {
        const row = sent[lineNo - 1];
        const text = vs.map(describePurchaseViolation).join(' ');
        if (row) byRow[row.order_line_id] = text;
        else header.push(text);
      });
    } else if (e instanceof ApiError && e.isValidation) {
      const split = splitDocFieldErrors(e.errors);
      split.byIndex.forEach((fields, i) => {
        const row = sent[i];
        if (row) byRow[row.order_line_id] = Object.values(fields).join(' ');
      });
      header.push(...split.header.map((h) => h.message));
      if (header.length === 0 && split.byIndex.size === 0) header.push(describeError(e));
    } else header.push(describeError(e));
    setLineErrors(byRow);
    setHeaderErrors(header);
  };

  const localProblems = (): boolean => {
    const errs: Record<string, string> = {};
    const header: string[] = [];
    if (!date) header.push('Choose the date it arrived.');
    for (const r of rows) if (r.quantity.trim() !== '' && !isPositiveQuantity(r.quantity)) errs[r.order_line_id] = 'Enter a quantity such as 1 or 2.5, or leave it empty to skip the line.';
    if (sentLines(rows).length === 0 && header.length === 0 && Object.keys(errs).length === 0) header.push('Enter the quantity received on at least one line.');
    setLineErrors(errs);
    setHeaderErrors(header);
    return header.length > 0 || Object.keys(errs).length > 0;
  };

  const record = async () => {
    if (localProblems()) return;
    const body = toReceiptRequest(input);
    const intent = slot.for(JSON.stringify(body));
    setBusy(true);
    try {
      const r = await run(() => actions.record(body, intent));
      slot.clear();
      toast.success(`Receipt ${r.number} recorded`);
      navigate(`/${co}/goods-receipts/${r.id}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Purchase orders', to: `/${co}/purchase-orders` }, { label: order.number ?? 'Draft', to: `/${co}/purchase-orders/${order.id}` }, { label: 'Record receipt' }]}
        title="Record receipt"
        subtitle={`${order.number ?? 'Order'} · ${order.contact_name}`}
        actions={
          <button type="button" onClick={() => void record()} disabled={busy || open.length === 0} className={BTN_ACCENT}>
            <Package className="size-4" />
            {busy ? 'Recording…' : 'Record receipt'}
          </button>
        }
      />

      <p className="text-[13px] text-text-secondary">Enter what arrived. Recording a receipt also confirms a service: use it for goods and for services alike. Leave a line empty to skip it.</p>

      {headerErrors.length > 0 && (
        <div role="alert" className="flex flex-col gap-1.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs font-medium text-danger">
          {headerErrors.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{m}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="rc-date" className="text-xs font-medium text-text-secondary">Received on</label>
          <input id="rc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="rc-ref" className="text-xs font-medium text-text-secondary">Reference</label>
          <input id="rc-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Delivery note number" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="rc-memo" className="text-xs font-medium text-text-secondary">Note</label>
          <input id="rc-memo" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        {open.length === 0 ? (
          <p className="p-6 text-[13px] text-text-muted">Nothing is open to receive on this order. Everything ordered has arrived.</p>
        ) : (
          <table className="w-full min-w-[720px] text-left text-xs" data-testid="receipt-lines">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="px-3 py-2">Description</th>
                <th className="w-24 px-2 py-2 text-right">Ordered</th>
                <th className="w-24 px-2 py-2 text-right">Received</th>
                <th className="w-24 px-2 py-2 text-right">Still open</th>
                <th className="w-32 px-2 py-2 text-right">Received now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {open.map(({ line, open: openQty }) => {
                const row = rows.find((r) => r.order_line_id === line.id);
                const err = lineErrors[line.id];
                return (
                  <React.Fragment key={line.id}>
                    <tr className={cn(err && 'bg-danger-soft/40')}>
                      <td className="px-3 py-2 text-text-primary">{line.description || '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{showQty(line.quantity)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{showQty(line.received)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{showQty(openQty)}</td>
                      <td className="px-2 py-1.5">
                        <input aria-label={`Received now, line ${line.line_no}`} inputMode="decimal" value={row?.quantity ?? ''} onChange={(e) => setQty(line.id, e.target.value)} className={cn(inputClass, 'w-full text-right tabular-nums')} />
                      </td>
                    </tr>
                    {err && (
                      <tr className="bg-danger-soft/40">
                        <td colSpan={5} className="px-3 pb-2 text-[11px] text-danger" data-testid={`line-error-${line.line_no}`}>
                          Line {line.line_no}: {err}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-text-muted">Order dated {formatDate(order.order_date)}. The order allows a little over-delivery only if your company settings say so.</p>

      <SignDialog {...signProps} documentTitle={`Receipt against ${order.number ?? 'order'}`} actionTitle="Sign and record" consequenceText="This records what arrived against the order. Nothing is posted to your books." />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

export const ReceiptForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const co = useRouteCompany().slug;
  const q = useOrder(id);
  if (q.isLoading) return <LoadingLine what="purchase order" />;
  if (q.error || !q.data) return <ErrorLine error={q.error} onRetry={q.refetch} />;
  const o = q.data;
  if (!o.can.receive) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        Nothing can be received on this order right now.{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/${co}/purchase-orders/${o.id}`)}>
          Back to the order
        </button>
      </div>
    );
  }
  // Keyed on the order version: reloading after a conflict starts the quantities again from what is open now.
  return <Inner key={o.version} order={o} reload={() => void q.refetch()} />;
};
