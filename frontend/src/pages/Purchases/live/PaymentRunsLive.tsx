import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { StatusPill } from '@/components/domain/StatusPill';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { usePaymentRunList } from '@/data/paymentRuns';
import { BTN_ACCENT, ErrorLine, LoadMore, LoadingLine, TableCard } from '@/pages/Sales/live/parts';

const TABS: Array<{ value: string; label: string; status?: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts', status: 'draft' },
  { value: 'pending', label: 'Awaiting approval', status: 'pending_approval' },
  { value: 'posted', label: 'Posted', status: 'posted' },
];

/** Payment runs: one row per run, as the server holds it. */
export const PaymentRunsLive: React.FC = () => {
  const navigate = useNavigate();
  const company = useRouteCompany();
  const coSlug = company.slug;
  const [tab, setTab] = useState('all');
  const list = usePaymentRunList({ status: TABS.find((t) => t.value === tab)?.status });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Pay bills"
        subtitle="Payment runs pay several bills at once, one payment per supplier."
        actions={
          <button type="button" onClick={() => navigate(`/${coSlug}/payment-run/new`)} className={BTN_ACCENT}>
            <Plus className="size-4" /> New payment run
          </button>
        }
      />
      <div className="flex items-center gap-1 border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)} className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', tab === t.value ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}>
            {t.label}
          </button>
        ))}
      </div>
      <TableCard>
        {list.isLoading ? (
          <LoadingLine what="payment runs" />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <h3 className="text-sm font-semibold text-text-primary">{tab === 'all' ? 'No payment runs yet' : 'No runs in this state'}</h3>
            <p className="mt-1 max-w-sm text-[13px] text-text-muted">{tab === 'all' ? 'Start a run to pay the bills that are due.' : 'Pick another tab to see the rest.'}</p>
            {tab === 'all' && (
              <button type="button" onClick={() => navigate(`/${coSlug}/payment-run/new`)} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
                New payment run
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="runs-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Cash paid out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/${coSlug}/payment-run/${r.id}`)} className="cursor-pointer hover:bg-surface-neutral/60">
                  <td className="px-3 py-2 font-semibold text-accent">{r.number ?? (r.status === 'void' ? 'Discarded' : 'Draft')}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(r.run_date)}</td>
                  <td className="px-3 py-2 text-text-secondary">{r.reference || '—'}</td>
                  <td className="px-3 py-2"><StatusPill status={r.status} label={r.status === 'void' ? 'Discarded' : undefined} /></td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-text-primary">{formatMoney(r.total_net, r.currency)}</td>
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
