import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerlyStore } from '@/mock/store';
import { Journal } from '@/types';
import { DataTable } from '@/components/domain/DataTable';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatMoney, formatDate } from '@/lib/format';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, BookOpen, RotateCcw } from 'lucide-react';

export const JournalsList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, journals } = useLedgerlyStore();
  const [activeTab, setActiveTab] = useState('all');
  const coSlug = currentCompany.slug;

  const filterTabs = [
    { label: 'All Journals', value: 'all', count: journals.length },
    { label: 'Manual Entries', value: 'manual', count: journals.filter((j) => j.journal_type === 'manual').length },
    { label: 'Posted', value: 'posted', count: journals.filter((j) => j.status === 'posted').length },
    { label: 'Reversed', value: 'reversed', count: journals.filter((j) => j.status === 'reversed').length },
  ];

  const filtered = journals.filter((j) => {
    if (activeTab === 'manual') return j.journal_type === 'manual';
    if (activeTab === 'posted') return j.status === 'posted';
    if (activeTab === 'reversed') return j.status === 'reversed';
    return true;
  });

  const columns: ColumnDef<Journal>[] = [
    {
      accessorKey: 'number',
      header: 'Journal #',
      cell: ({ row }) => (
        <span className="font-mono font-semibold text-brand-600">
          {row.original.number || 'DRAFT'}
        </span>
      ),
    },
    {
      accessorKey: 'journal_date',
      header: 'Date',
      cell: ({ row }) => <span className="font-mono text-ink-500">{formatDate(row.original.journal_date)}</span>,
    },
    {
      accessorKey: 'reference',
      header: 'Reference',
      cell: ({ row }) => <span className="font-mono text-ink-700">{row.original.reference || '—'}</span>,
    },
    {
      accessorKey: 'memo',
      header: 'Memo / Narrative',
      cell: ({ row }) => <span className="truncate max-w-xs block text-ink-900">{row.original.memo}</span>,
    },
    {
      accessorKey: 'journal_type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-ink-100 text-ink-700">
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
      header: () => <div className="text-right">Total (Debit / Credit)</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num font-semibold text-ink-900 pr-3">
          {formatMoney(row.original.total_debit)}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 font-bold text-ink-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-brand-600" />
            General Journals
          </h1>
          <p className="text-xs text-ink-500 mt-0.5">
            Immutable balanced journal transactions • Reversals & audit provenance
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate(`/${coSlug}/journals/new`)}
          className="flex items-center gap-1.5 h-8 px-3.5 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Journal (n)</span>
        </button>
      </div>

      {/* TanStack Table */}
      <DataTable
        columns={columns}
        data={filtered}
        filterTabs={filterTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchPlaceholder="Filter journal #, memo, reference..."
        onRowClick={(row) => navigate(`/${coSlug}/journals/${row.id}`)}
      />
    </div>
  );
};
