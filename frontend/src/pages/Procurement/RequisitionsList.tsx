import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useRequisitionList } from '@/data/procurement';
import { REQUISITION_TABS } from '@/api/adapters/procurement';
import { BTN_ACCENT, EmptyState, ErrorLine, LoadMore, LoadingLine, ProcStatusPill, StatusTabs, TableCard } from './parts';

export const RequisitionsList: React.FC = () => {
  const navigate = useNavigate();
  const company = useRouteCompany();
  const co = company.slug;
  const [tab, setTab] = useState('all');
  const status = REQUISITION_TABS.find((t) => t.value === tab)?.status;
  const list = useRequisitionList({ status });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Requisitions"
        subtitle="Requests to buy something. Once approved, they become purchase orders."
        actions={
          <button type="button" onClick={() => navigate(`/${co}/requisitions/new`)} className={BTN_ACCENT}>
            <Plus className="size-4" />
            New requisition
          </button>
        }
      />
      <StatusTabs tabs={REQUISITION_TABS} value={tab} onChange={setTab} />
      <TableCard>
        {list.isLoading ? (
          <LoadingLine what="requisitions" />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <EmptyState
            title={tab === 'all' ? 'No requisitions yet' : 'Nothing here'}
            hint={tab === 'all' ? 'Ask for what you need to buy, and have it approved before an order is placed.' : 'No requisition has this status.'}
            action={tab === 'all' ? { label: 'New requisition', onClick: () => navigate(`/${co}/requisitions/new`) } : undefined}
          />
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="requisitions-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Estimated total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/${co}/requisitions/${r.id}`)} className="cursor-pointer hover:bg-surface-neutral/60">
                  <td className="px-3 py-2 font-semibold text-accent">{r.number ?? (r.status === 'void' ? 'Discarded' : 'Draft')}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(r.requisition_date)}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-text-secondary">{r.memo || '—'}</td>
                  <td className="px-3 py-2">
                    <ProcStatusPill kind="requisition" status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-text-primary">{formatMoney(r.total, r.currency)}</td>
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
