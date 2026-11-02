import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useOrderList } from '@/data/procurement';
import { ORDER_TABS } from '@/api/adapters/procurement';
import { BTN_ACCENT, EmptyState, ErrorLine, LoadMore, LoadingLine, ProcStatusPill, StatusTabs, TableCard } from './parts';

export const OrdersList: React.FC = () => {
  const navigate = useNavigate();
  const company = useRouteCompany();
  const co = company.slug;
  const [tab, setTab] = useState('all');
  const status = ORDER_TABS.find((t) => t.value === tab)?.status;
  const list = useOrderList({ status });

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
                <tr key={o.id} onClick={() => navigate(`/${co}/purchase-orders/${o.id}`)} className="cursor-pointer hover:bg-surface-neutral/60">
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
    </div>
  );
};
