import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { PageHeader } from '@/components/domain/PageHeader';
import { StatusPill } from '@/components/domain/StatusPill';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useJournalList, type JournalFilters } from '@/data/journals';
import { journalTypeLabel } from '@/api/adapters/journal';
import { ErrorLine, LoadingLine, inputClass } from './parts';

/** Each tab is a server filter. There are no counts: a count from a partial page would be wrong. */
const TABS: Array<{ value: string; label: string; filters: JournalFilters }> = [
  { value: 'all', label: 'All', filters: {} },
  { value: 'draft', label: 'Drafts', filters: { status: 'draft' } },
  { value: 'pending_approval', label: 'Awaiting approval', filters: { status: 'pending_approval' } },
  { value: 'posted', label: 'Posted', filters: { status: 'posted' } },
  { value: 'reversed', label: 'Reversed', filters: { status: 'reversed' } },
  { value: 'manual', label: 'Manual', filters: { type: 'manual' } },
  { value: 'asset', label: 'Fixed asset', filters: { type: 'asset' } },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const JournalsListLive: React.FC = () => {
  const navigate = useNavigate();
  const company = useLedgerStore((s) => s.currentCompany);
  const openTab = useLedgerStore((s) => s.openTab);
  const coSlug = company.slug;
  const [tab, setTab] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const search = useDebounced(searchText.trim(), 300);

  const filters: JournalFilters = { ...(TABS.find((t) => t.value === tab)?.filters ?? {}), search, from, to };
  const list = useJournalList(filters);
  const filtered = Boolean(search || from || to || tab !== 'all');

  const open = (id: string, number: string | null) => {
    openTab({ id: `tab-journal-${id}`, title: number || 'Draft journal', url: `/${coSlug}/journals/${id}`, type: 'journal' });
    navigate(`/${coSlug}/journals/${id}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Journals"
        subtitle="Every entry that moves money between accounts, with who made it and why."
        actions={
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/journals/new`)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="size-4" />
            New journal
            <Kbd className="ml-1 border-white/30 bg-white/20 text-white">N</Kbd>
          </button>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-1 border-b border-border" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                tab === t.value ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search journals"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search by note or reference"
            className={cn(inputClass, 'w-56')}
          />
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            From
            <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            To
            <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {list.isLoading ? (
          <LoadingLine what="journals" />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <h3 className="text-sm font-semibold text-text-primary">{filtered ? 'No journals match these filters' : 'No journals yet'}</h3>
            <p className="mt-1 max-w-sm text-[13px] text-text-muted">
              {filtered ? 'Change or clear the filters to see more.' : 'Record the first entry to start the books.'}
            </p>
            {!filtered && (
              <button type="button" onClick={() => navigate(`/${coSlug}/journals/new`)} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
                New journal
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="journals-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">What it is for</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((j) => (
                <tr key={j.id} onClick={() => open(j.id, j.number)} className="cursor-pointer hover:bg-surface-neutral/60">
                  <td className="px-3 py-2 font-semibold text-accent">{j.number || 'Draft'}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(j.journal_date)}</td>
                  <td className="px-3 py-2 text-text-secondary">{j.reference || '—'}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-text-primary">{j.memo || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-[3px] bg-surface-neutral px-2 py-0.5 text-xs capitalize text-text-secondary">{journalTypeLabel(j.journal_type)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={j.status} />
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-text-primary">{formatMoney(j.total_debit, company.base_currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.hasMore && (
          <div className="border-t border-border p-3 text-center">
            <button
              type="button"
              onClick={list.loadMore}
              disabled={list.isLoadingMore}
              className="h-8 rounded-md border border-border bg-surface px-4 text-[13px] font-medium text-text-primary hover:bg-surface-neutral disabled:opacity-50"
            >
              {list.isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
