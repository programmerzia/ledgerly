import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/domain/PageHeader';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useOrderActions, useOrderList } from '@/data/procurement';
import { useListKeys } from '@/lib/pageKeys';
import { useBulkRun, useRowSelection } from '@/data/bulk';
import { BulkBar, BulkResultsSheet } from '@/components/live/BulkBar';
import { SignDialog } from '@/components/domain/SignDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { downloadCsv, minorToDecimal } from '@/lib/csv';
import { tradeVerdictText } from '@/pages/Sales/live/parts';
import { ORDER_TABS } from '@/api/adapters/procurement';
import { BTN_ACCENT, EmptyState, ErrorLine, LoadMore, LoadingLine, ProcStatusPill, StatusTabs, TableCard } from './parts';

export const OrdersList: React.FC = () => {
  const navigate = useNavigate();
  const company = useRouteCompany();
  const co = company.slug;
  const [tab, setTab] = useState('all');
  const status = ORDER_TABS.find((t) => t.value === tab)?.status;
  const list = useOrderList({ status });

  const actions = useOrderActions();
  const sel = useRowSelection(list.rows);
  const cursor = useListKeys({ rows: list.rows, onOpen: (r) => navigate(`/${co}/purchase-orders/${r.id}`), onToggle: (r) => sel.toggle(r.id) });
  const bulk = useBulkRun();
  const items = sel.selected.map((o) => ({ ...o, label: `${o.number ?? 'Draft'} · ${o.contact_name || 'Supplier'}` }));
  const submittable = items.filter((o) => o.status === 'draft' && o.can.submit);
  const submitAll = async () => {
    await bulk.execute('submitted', items, (o) => o.status === 'draft' && o.can.submit, 'Not a draft you can submit, so it was left alone.', async (o, intent) => {
      await actions.submit(o.id, o.version, intent);
      return 'Sent for approval';
    }, (e) => tradeVerdictText(e, true));
    sel.clear();
  };
  const exportCsv = () =>
    downloadCsv('purchase-orders-selected.csv', [
      ['Number', 'Supplier', 'Date', 'Expected', 'Status', 'Currency', 'Total'],
      ...items.map((o) => [o.number ?? '', o.contact_name, o.order_date, o.expected_date, o.status, o.currency, minorToDecimal(o.total_fc, o.currency)]),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Purchase orders"
        subtitle="What you have ordered from suppliers, what has arrived and what is billed."
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate(`/${co}/goods-receipts`)} className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary hover:bg-surface-neutral">
              Receipts
            </button>
            <button type="button" onClick={() => navigate(`/${co}/purchase-orders/new`)} className={BTN_ACCENT}>
              <Plus className="size-4" />
              New purchase order
            </button>
          </div>
        }
      />
      <StatusTabs tabs={ORDER_TABS} value={tab} onChange={setTab} />
      <TableCard>
        {list.isLoading ? (
          <LoadingLine what="purchase orders" />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <EmptyState
            title={tab === 'all' ? 'No purchase orders yet' : 'Nothing here'}
            hint={tab === 'all' ? 'Order from a supplier before the goods arrive, then match the bill to the order.' : 'No order has this status.'}
            action={tab === 'all' ? { label: 'New purchase order', onClick: () => navigate(`/${co}/purchase-orders/new`) } : undefined}
          />
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="orders-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="w-9 px-3 py-2">
                  <Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label="Select all purchase orders shown" />
                </th>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Expected</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((o) => (
                <tr key={o.id} data-row-id={o.id} aria-current={cursor === o.id || undefined} onClick={() => navigate(`/${co}/purchase-orders/${o.id}`)} className={cn('cursor-pointer hover:bg-surface-neutral/60', cursor === o.id && 'bg-accent-soft/40')} data-selected={sel.isSelected(o.id) || undefined}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={sel.isSelected(o.id)} onCheckedChange={() => sel.toggle(o.id)} aria-label={`Select ${o.number ?? 'draft order'}`} />
                  </td>
                  <td className="px-3 py-2 font-semibold text-accent">{o.number ?? 'Draft'}</td>
                  <td className="px-3 py-2 text-text-primary">{o.contact_name || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(o.order_date)}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{o.expected_date ? formatDate(o.expected_date) : '—'}</td>
                  <td className="px-3 py-2">
                    <ProcStatusPill kind="order" status={o.status} />
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-text-primary">{formatMoney(o.total_fc, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.isLoadingMore} onClick={list.loadMore} />
      </TableCard>

      <BulkBar
        selected={sel.selected.length}
        busy={bulk.busy}
        onClear={sel.clear}
        hint={items.some((o) => o.status === 'pending_approval') ? 'Orders waiting for approval are approved in the Approvals inbox.' : undefined}
        actions={[
          { key: 'submit', label: 'Submit', count: submittable.length, onClick: () => void submitAll(), title: submittable.length === 0 ? 'None of the selected are drafts you can submit.' : undefined },
          { key: 'csv', label: 'Export CSV', count: items.length, onClick: exportCsv },
        ]}
      />
      <BulkResultsSheet result={bulk.result} title="Bulk results" onClose={bulk.clearResult} />
      <SignDialog {...bulk.signProps} documentTitle={`${submittable.length} purchase orders to submit`} actionTitle={`Submit ${submittable.length}`} consequenceText="Your PIN is checked once. Each order is then submitted on its own, and any that cannot be submitted are listed afterwards with the reason." />
    </div>
  );
};
