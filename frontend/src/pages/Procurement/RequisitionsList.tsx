import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/domain/PageHeader';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useRequisitionActions, useRequisitionList } from '@/data/procurement';
import { useListKeys } from '@/lib/pageKeys';
import { useBulkRun, useRowSelection } from '@/data/bulk';
import { BulkBar, BulkDiscardDialog, BulkResultsSheet } from '@/components/live/BulkBar';
import { SignDialog } from '@/components/domain/SignDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { downloadCsv, minorToDecimal } from '@/lib/csv';
import { tradeVerdictText } from '@/pages/Sales/live/parts';
import { REQUISITION_TABS } from '@/api/adapters/procurement';
import { BTN_ACCENT, EmptyState, ErrorLine, LoadMore, LoadingLine, ProcStatusPill, StatusTabs, TableCard } from './parts';

export const RequisitionsList: React.FC = () => {
  const navigate = useNavigate();
  const company = useRouteCompany();
  const co = company.slug;
  const [tab, setTab] = useState('all');
  const status = REQUISITION_TABS.find((t) => t.value === tab)?.status;
  const list = useRequisitionList({ status });

  const actions = useRequisitionActions();
  const sel = useRowSelection(list.rows);
  const cursor = useListKeys({ rows: list.rows, onOpen: (r) => navigate(`/${co}/requisitions/${r.id}`), onToggle: (r) => sel.toggle(r.id) });
  const bulk = useBulkRun();
  const [discarding, setDiscarding] = useState(false);
  const items = sel.selected.map((r) => ({ ...r, label: r.number ?? `Draft of ${formatDate(r.requisition_date)}` }));
  const submittable = items.filter((r) => r.status === 'draft' && r.can.submit);
  const discardable = items.filter((r) => r.status === 'draft' && r.can.void);
  const describe = (e: unknown) => tradeVerdictText(e, true);
  const submitAll = async () => {
    await bulk.execute('submitted', items, (r) => r.status === 'draft' && r.can.submit, 'Not a draft you can submit, so it was left alone.', async (r, intent) => {
      await actions.submit(r.id, r.version, intent);
      return 'Sent for approval';
    }, describe);
    sel.clear();
  };
  const discardAll = async (reason: string) => {
    setDiscarding(false);
    await bulk.execute('discarded', items, (r) => r.status === 'draft' && r.can.void, 'Not a draft you can discard, so it was left alone.', async (r, intent) => {
      await actions.voidDoc(r.id, reason, r.version, intent);
      return 'Discarded';
    }, describe);
    sel.clear();
  };
  const exportCsv = () =>
    downloadCsv('requisitions-selected.csv', [
      ['Number', 'Date', 'Note', 'Status', 'Currency', 'Estimated total'],
      ...items.map((r) => [r.number ?? '', r.requisition_date, r.memo, r.status, r.currency, minorToDecimal(r.total, r.currency)]),
    ]);

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
                <th className="w-9 px-3 py-2">
                  <Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label="Select all requisitions shown" />
                </th>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Estimated total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((r) => (
                <tr key={r.id} data-row-id={r.id} aria-current={cursor === r.id || undefined} onClick={() => navigate(`/${co}/requisitions/${r.id}`)} className={cn('cursor-pointer hover:bg-surface-neutral/60', cursor === r.id && 'bg-accent-soft/40')} data-selected={sel.isSelected(r.id) || undefined}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={sel.isSelected(r.id)} onCheckedChange={() => sel.toggle(r.id)} aria-label={`Select ${r.number ?? 'draft requisition'}`} />
                  </td>
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

      <BulkBar
        selected={sel.selected.length}
        busy={bulk.busy}
        onClear={sel.clear}
        hint={items.some((r) => r.status === 'pending_approval') ? 'Requisitions waiting for approval are approved in the Approvals inbox.' : undefined}
        actions={[
          { key: 'submit', label: 'Submit', count: submittable.length, onClick: () => void submitAll(), title: submittable.length === 0 ? 'None of the selected are drafts you can submit.' : undefined },
          { key: 'discard', label: 'Discard drafts', count: discardable.length, danger: true, onClick: () => setDiscarding(true), title: discardable.length === 0 ? 'None of the selected are drafts you can discard.' : undefined },
          { key: 'csv', label: 'Export CSV', count: items.length, onClick: exportCsv },
        ]}
      />
      <BulkDiscardDialog open={discarding} count={discardable.length} noun="requisition" onCancel={() => setDiscarding(false)} onConfirm={(r) => void discardAll(r)} />
      <BulkResultsSheet result={bulk.result} title="Bulk results" onClose={bulk.clearResult} />
      <SignDialog {...bulk.signProps} documentTitle={`${submittable.length} requisitions to submit`} actionTitle={`Submit ${submittable.length}`} consequenceText="Your PIN is checked once. Each requisition is then submitted on its own, and any that cannot be submitted are listed afterwards with the reason." />
    </div>
  );
};
