import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/domain/PageHeader';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useAwaitingReceipt, useOpenCommitments, useReceivedNotBilled } from '@/data/procurement';
import { toApiDate } from '@/api/adapters/dates';
import { EmptyState, ErrorLine, LoadingLine, StatusTabs, TableCard, inputClass, showQty } from './parts';

const TABS = [
  { value: 'commitments', label: 'Open commitments' },
  { value: 'awaiting', label: 'Awaiting receipt' },
  { value: 'unbilled', label: 'Received not yet billed' },
];

const TH = 'px-3 py-2';
const HEAD = 'border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted';

export const ProcurementReports: React.FC = () => {
  const [tab, setTab] = useState('commitments');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Procurement reports" subtitle="What you have committed to buy, what is still to arrive, and what has arrived without a bill." />
      <StatusTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'commitments' && <Commitments />}
      {tab === 'awaiting' && <Awaiting />}
      {tab === 'unbilled' && <Unbilled />}
    </div>
  );
};

const TotalRow: React.FC<{ label: string; minor: number; currency: string; colSpan: number }> = ({ label, minor, currency, colSpan }) => (
  <tr className="border-t border-border-strong font-semibold">
    <td className="px-3 py-2" colSpan={colSpan}>{label}</td>
    <td className="px-3 py-2 text-right tabular-nums" data-testid="report-total">{formatMoney(minor, currency)}</td>
  </tr>
);

const Commitments: React.FC = () => {
  const q = useOpenCommitments();
  if (q.isLoading) return <LoadingLine what="open commitments" />;
  if (q.error || !q.data) return <ErrorLine error={q.error} onRetry={q.refetch} />;
  const { rows, total } = q.data;
  return (
    <TableCard>
      <p className="border-b border-border px-4 py-3 text-xs text-text-muted">What is on approved orders and not yet billed, by supplier and account.</p>
      {rows.length === 0 ? (
        <EmptyState title="No open commitments" hint="Approved orders that are not fully billed will show here." />
      ) : (
        <table className="w-full text-left text-[13px]" data-testid="report-open-commitments">
          <thead>
            <tr className={HEAD}>
              <th className={TH}>Supplier</th>
              <th className={TH}>Account</th>
              <th className={cn(TH, 'text-right')}>Open</th>
              <th className={cn(TH, 'text-right')}>In {total.currency}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={`${r.contact_id}:${r.account_id}:${r.currency}`}>
                <td className="px-3 py-2 text-text-primary">{r.contact_name}</td>
                <td className="px-3 py-2 text-text-secondary">{r.account_code} {r.account_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.open_fc, r.currency)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(r.open_base, total.currency)}</td>
              </tr>
            ))}
            <TotalRow label="Total" minor={total.total_base} currency={total.currency} colSpan={3} />
          </tbody>
        </table>
      )}
    </TableCard>
  );
};

const Awaiting: React.FC = () => {
  const co = useRouteCompany().slug;
  const q = useAwaitingReceipt();
  if (q.isLoading) return <LoadingLine what="orders awaiting receipt" />;
  if (q.error || !q.data) return <ErrorLine error={q.error} onRetry={q.refetch} />;
  const { rows, total } = q.data;
  return (
    <TableCard>
      <p className="border-b border-border px-4 py-3 text-xs text-text-muted">Lines of approved orders that have not fully arrived.</p>
      {rows.length === 0 ? (
        <EmptyState title="Nothing is waiting to arrive" hint="Every line of every approved order has been received." />
      ) : (
        <table className="w-full text-left text-[13px]" data-testid="report-awaiting-receipt">
          <thead>
            <tr className={HEAD}>
              <th className={TH}>Order</th>
              <th className={TH}>Supplier</th>
              <th className={TH}>Line</th>
              <th className={TH}>Expected</th>
              <th className={cn(TH, 'text-right')}>Ordered</th>
              <th className={cn(TH, 'text-right')}>Received</th>
              <th className={cn(TH, 'text-right')}>Still open</th>
              <th className={cn(TH, 'text-right')}>Open value</th>
              <th className={cn(TH, 'text-right')}>In {total.currency}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.order_line_id}>
                <td className="px-3 py-2"><Link to={`/${co}/purchase-orders/${r.purchase_order_id}`} className="font-semibold text-accent hover:underline">{r.number ?? 'Draft'}</Link></td>
                <td className="px-3 py-2 text-text-primary">{r.contact_name}</td>
                <td className="px-3 py-2 text-text-secondary">{r.line_no}. {r.description || '—'}</td>
                <td className="px-3 py-2 tabular-nums text-text-muted">{r.expected_date ? formatDate(r.expected_date) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(r.ordered)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(r.received)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(r.open)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.open_fc, r.currency)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(r.open_base, total.currency)}</td>
              </tr>
            ))}
            <TotalRow label="Total" minor={total.total_base} currency={total.currency} colSpan={8} />
          </tbody>
        </table>
      )}
    </TableCard>
  );
};

const Unbilled: React.FC = () => {
  const co = useRouteCompany().slug;
  const [asOf, setAsOf] = useState(() => toApiDate(new Date()));
  const q = useReceivedNotBilled(asOf);
  const d = q.data;
  return (
    <TableCard>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <p className="max-w-xl text-xs text-text-muted">This supports a manual month-end accrual journal. Nothing is posted automatically.</p>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          As of
          <input type="date" aria-label="As of" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputClass} />
        </label>
      </div>
      {q.isLoading ? (
        <LoadingLine what="received not yet billed" />
      ) : q.error || !d ? (
        <ErrorLine error={q.error} onRetry={q.refetch} />
      ) : d.rows.length === 0 ? (
        <EmptyState title="Nothing received is waiting for a bill" hint={`Everything received up to ${formatDate(d.asOf)} has been billed.`} />
      ) : (
        <table className="w-full text-left text-[13px]" data-testid="report-received-not-billed">
          <thead>
            <tr className={HEAD}>
              <th className={TH}>Order</th>
              <th className={TH}>Supplier</th>
              <th className={TH}>Line</th>
              <th className={TH}>Account</th>
              <th className={cn(TH, 'text-right')}>Received</th>
              <th className={cn(TH, 'text-right')}>Billed</th>
              <th className={cn(TH, 'text-right')}>Not billed</th>
              <th className={cn(TH, 'text-right')}>Value</th>
              <th className={cn(TH, 'text-right')}>In {d.total.currency}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.rows.map((r) => (
              <tr key={r.order_line_id}>
                <td className="px-3 py-2"><Link to={`/${co}/purchase-orders/${r.purchase_order_id}`} className="font-semibold text-accent hover:underline">{r.number ?? 'Draft'}</Link></td>
                <td className="px-3 py-2 text-text-primary">{r.contact_name}</td>
                <td className="px-3 py-2 text-text-secondary">{r.line_no}. {r.description || '—'}</td>
                <td className="px-3 py-2 text-text-secondary">{r.account_code} {r.account_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(r.received)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(r.billed)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(r.unbilled)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.unbilled_fc, r.currency)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(r.unbilled_base, d.total.currency)}</td>
              </tr>
            ))}
            <TotalRow label={`Total as of ${formatDate(d.asOf)}`} minor={d.total.total_base} currency={d.total.currency} colSpan={8} />
          </tbody>
        </table>
      )}
    </TableCard>
  );
};
