import { selectByMode } from '@/data/select';
import { JournalsListLive } from './live/JournalsListLive';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Journal } from '@/types';
import { DataTable } from '@/components/domain/DataTable';
import { StatusPill } from '@/components/domain/StatusPill';
import { SplitPane } from '@/components/domain/SplitPane';
import { formatMoney, formatDate } from '@/lib/format';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, BookMarked, ExternalLink, Eye, Copy, RotateCcw, Hash } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { Kbd } from '@/components/ui/kbd';
import { api } from '@/mock/api';
import { toast } from 'sonner';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { CoachPanel } from '@/components/domain/CoachPanel';

const MockJournalsList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, journals, accounts, openTab, uiDensity } = useLedgerStore();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const coSlug = currentCompany.slug;

  const accountsMap = useMemo(() => {
    return new Map(accounts.map((a) => [a.id, a]));
  }, [accounts]);

  const filterTabs = [
    { label: 'All', value: 'all', count: journals.length },
    { label: 'Manual', value: 'manual', count: journals.filter((j) => j.journal_type === 'manual').length },
    { label: 'Posted', value: 'posted', count: journals.filter((j) => j.status === 'posted').length },
    { label: 'Reversed', value: 'reversed', count: journals.filter((j) => j.status === 'reversed').length },
  ];

  const filtered = journals.filter((j) => {
    if (activeTab === 'manual') return j.journal_type === 'manual';
    if (activeTab === 'posted') return j.status === 'posted';
    if (activeTab === 'reversed') return j.status === 'reversed';
    return true;
  });

  const selectedJournal = useMemo(() => {
    return journals.find((j) => j.id === selectedJournalId) || null;
  }, [journals, selectedJournalId]);

  const handleOpenTab = (journal: Journal) => {
    openTab({
      id: `tab-journal-${journal.id}`,
      title: journal.number || 'Draft Journal',
      url: `/${coSlug}/journals/${journal.id}`,
      type: 'journal',
    });
    navigate(`/${coSlug}/journals/${journal.id}`);
  };

  const monthKey = BUSINESS_TODAY.slice(0, 7);
  const postedThisMonth = journals.filter((j) => j.status === 'posted' && (j.posted_at || j.journal_date).startsWith(monthKey)).length;
  const awaiting = journals.filter((j) => j.status === 'pending_approval').length;
  const drafts = journals.filter((j) => j.status === 'draft').length;

  const rowActions = (j: Journal) => {
    const canReverse = j.status === 'posted' && !j.reversal_of_id;
    return [
      { label: 'Open', icon: Eye, shortcut: 'Enter', onClick: () => handleOpenTab(j) },
      {
        label: 'Duplicate',
        icon: Copy,
        onClick: async () => {
          const dup = await api.duplicateJournal(j.id);
          toast.success('Draft copy created');
          navigate(`/${coSlug}/journals/${dup.id}`);
        },
      },
      {
        label: 'Copy number',
        icon: Hash,
        onClick: () => {
          navigator.clipboard?.writeText(j.number || '').catch(() => undefined);
          toast.success('Journal number copied');
        },
      },
      {
        label: 'Reverse',
        icon: RotateCcw,
        destructive: true,
        disabled: !canReverse,
        disabledReason:
          j.status === 'reversed'
            ? 'This journal is already reversed'
            : j.reversal_of_id
            ? 'A reversing entry cannot be reversed again'
            : 'Only journals that are in the books can be reversed',
        onClick: () => {
          toast.info('Add a reason and confirm the reversal on the journal page');
          handleOpenTab(j);
        },
      },
    ];
  };

  const columns: ColumnDef<Journal>[] = [
    {
      accessorKey: 'number',
      header: 'Number',
      cell: ({ row }) => (
        <span
          onClick={(e) => {
            e.stopPropagation();
            handleOpenTab(row.original);
          }}
          className="font-mono font-semibold text-accent hover:underline cursor-pointer"
        >
          {row.original.number || 'DRAFT'}
        </span>
      ),
    },
    {
      accessorKey: 'journal_date',
      header: 'Date',
      cell: ({ row }) => <span className="font-mono text-text-muted">{formatDate(row.original.journal_date)}</span>,
    },
    {
      accessorKey: 'reference',
      header: 'Reference',
      cell: ({ row }) => <span className="font-mono text-text-secondary">{row.original.reference || '—'}</span>,
    },
    {
      accessorKey: 'memo',
      header: 'What it is for',
      cell: ({ row }) => <span className="truncate max-w-xs block text-text-primary">{row.original.memo}</span>,
    },
    {
      accessorKey: 'journal_type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="rounded-[3px] bg-surface-neutral px-2 py-0.5 text-xs capitalize text-text-secondary">
          {row.original.journal_type}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      accessorKey: 'total_debit',
      header: () => <div className="text-right">Amount</div>,
      cell: ({ row }) => (
        <div className="text-right text-num font-semibold text-text-primary pr-3">
          {formatMoney(row.original.total_debit)}
        </div>
      ),
    },
  ];

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

      <section className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-lg border border-border bg-surface">
        {[
          { label: 'Posted this month', value: postedThisMonth, hint: 'in the books' },
          { label: 'Awaiting approval', value: awaiting, hint: 'need a second person' },
          { label: 'Drafts', value: drafts, hint: 'not submitted yet' },
        ].map((k) => (
          <div key={k.label} className="px-5 py-3">
            <div className="text-xs text-text-muted">{k.label}</div>
            <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">{k.value}</div>
            <div className="mt-1 text-xs text-text-muted">{k.hint}</div>
          </div>
        ))}
      </section>

      {/* 3-Step Guided Coach Panel */}
      <CoachPanel
        moduleId="journals"
        moduleName="General journals"
        steps={[
          {
            title: '1. Record an entry',
            desc: 'Total debits must equal total credits.',
            actionLabel: 'New journal',
            onAction: () => navigate(`/${coSlug}/journals/new`),
          },
          {
            title: '2. Check the month is open',
            desc: 'Entries can only be added to months that are open. Closed months need a second person to reopen.',
            actionLabel: 'View periods',
            onAction: () => navigate(`/${coSlug}/periods`),
          },
          {
            title: '3. Everything is logged',
            desc: 'Every posted journal is added to a tamper-evident activity log.',
            actionLabel: 'Audit log',
            onAction: () => navigate(`/${coSlug}/audit`),
          },
        ]}
      />

      {/* SplitPane Layout */}
      <SplitPane
        storageKey="ledgerly_journals_split_width"
        isOpen={Boolean(selectedJournal)}
        onClose={() => setSelectedJournalId(null)}
        title={selectedJournal?.number || 'Draft Journal'}
        subtitle={
          selectedJournal
            ? `Type: ${selectedJournal.journal_type} • Date: ${formatDate(selectedJournal.journal_date)}`
            : undefined
        }
        icon={<BookMarked className="w-4 h-4" />}
        onOpenFull={() => selectedJournal && handleOpenTab(selectedJournal)}
        openFullLabel="Open Journal"
        badge={selectedJournal ? <StatusPill status={selectedJournal.status} size="sm" /> : undefined}
        detailContent={
          selectedJournal && (
            <div className="flex flex-col gap-4 text-xs">
              {/* Journal Info */}
              <div className="p-3 bg-surface-neutral/60 border border-border rounded-lg flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text-primary text-sm">
                    {selectedJournal.number || 'Draft Entry'}
                  </span>
                  <span className="text-[11px] capitalize px-1.5 py-px rounded-[3px] bg-surface-neutral text-text-muted">
                    {selectedJournal.journal_type}
                  </span>
                </div>
                <p className="text-text-muted text-[11px] leading-relaxed">
                  {selectedJournal.memo}
                </p>
                <div className="text-text-muted text-[10px] pt-1 border-t border-border/60 flex items-center justify-between">
                  <span>Date: {formatDate(selectedJournal.journal_date)}</span>
                  <span>Ref: {selectedJournal.reference || '—'}</span>
                </div>
              </div>

              {/* Total Balance KPI */}
              <div className="p-3 rounded-md bg-surface border border-border flex items-center justify-between">
                <div>
                  <span className="text-xs text-text-muted block">Total</span>
                  <span className="tabular-nums font-medium text-text-primary text-base mt-0.5 block">
                    {formatMoney(selectedJournal.total_debit)}
                  </span>
                </div>
                <div className="text-success text-xs font-medium">
                  <span>Debits equal credits</span>
                </div>
              </div>

              {/* Journal Lines Table */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-text-primary">
                  Lines ({selectedJournal.lines.length})
                </span>
                <div className="border border-border rounded-md overflow-hidden bg-surface">
                  <table className="w-full text-left text-xs table-dense">
                    <thead className="bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                      <tr>
                        <th className="px-2.5 py-1.5">Account</th>
                        <th className="px-2 py-1.5 text-right w-20">Debit</th>
                        <th className="px-2 py-1.5 text-right w-20">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {selectedJournal.lines.map((line, idx) => {
                        const acc = accountsMap.get(line.account_id);
                        return (
                          <tr key={idx} className="hover:bg-surface-neutral/40">
                            <td className="px-2.5 py-1.5 truncate max-w-[160px]">
                              <span className="font-code text-text-primary mr-1">
                                {acc?.code || line.account_id}
                              </span>
                              <span className="text-text-muted text-[11px]">{acc?.name}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right text-num text-text-primary">
                              {line.debit > 0 ? formatMoney(line.debit) : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right text-num text-text-primary">
                              {line.credit > 0 ? formatMoney(line.credit) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => handleOpenTab(selectedJournal)}
                  className="w-full h-8 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open journal</span>
                </button>
              </div>
            </div>
          )
        }
      >
        <DataTable
          columns={columns}
          data={filtered}
          activeRowId={selectedJournalId}
          filterTabs={filterTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          searchPlaceholder="Search by number, note or reference"
          rowDensity={uiDensity}
          rowActions={rowActions}
          contextMenuTitle={(r) => r.number || 'Draft journal'}
          onRowClick={(row) => setSelectedJournalId(row.id)}
          onRowDoubleClick={(row) => handleOpenTab(row)}
        />
      </SplitPane>
    </div>
  );
};

/** The demo keeps its store-backed screen; live mode reads the API (docs/15). */
export const JournalsList: React.FC = selectByMode({ mock: MockJournalsList, live: JournalsListLive });
