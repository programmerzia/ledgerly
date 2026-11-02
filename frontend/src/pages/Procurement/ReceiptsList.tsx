import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/domain/PageHeader';
import { formatDate } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useReceiptList } from '@/data/procurement';
import { RECEIPT_TABS } from '@/api/adapters/procurement';
import { EmptyState, ErrorLine, LoadMore, LoadingLine, ProcStatusPill, StatusTabs, TableCard } from './parts';

export const ReceiptsList: React.FC = () => {
  const navigate = useNavigate();
  const co = useRouteCompany().slug;
  const [tab, setTab] = useState('all');
  const status = RECEIPT_TABS.find((t) => t.value === tab)?.status;
  const list = useReceiptList({ status });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Receipts" subtitle="What has arrived against purchase orders. Receipts are recorded from the order." />
      <StatusTabs tabs={RECEIPT_TABS} value={tab} onChange={setTab} />
      <TableCard>
        {list.isLoading ? (
          <LoadingLine what="receipts" />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <EmptyState title={tab === 'all' ? 'No receipts yet' : 'Nothing here'} hint={tab === 'all' ? 'Open an approved purchase order and choose Record receipt when the goods arrive.' : 'No receipt has this status.'} />
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="receipts-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="px-3 py-2">Receipt</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/${co}/goods-receipts/${r.id}`)} className="cursor-pointer hover:bg-surface-neutral/60">
                  <td className="px-3 py-2 font-semibold text-accent">{r.number}</td>
                  <td className="px-3 py-2">
                    <Link to={`/${co}/purchase-orders/${r.purchase_order_id}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
                      {r.order_number ?? 'Order'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-text-primary">{r.contact_name || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(r.receipt_date)}</td>
                  <td className="px-3 py-2 text-text-secondary">{r.reference || '—'}</td>
                  <td className="px-3 py-2">
                    <ProcStatusPill kind="receipt" status={r.status} />
                  </td>
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
