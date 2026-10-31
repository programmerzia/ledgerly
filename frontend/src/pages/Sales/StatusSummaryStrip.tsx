import React from 'react';
import { formatMoney } from '@/lib/format';
import type { StatusBucket } from '@/lib/docStatus';
import { cn } from '@/lib/utils';

interface Props {
  buckets: StatusBucket[];
  active: string;
  onChange: (key: string) => void;
  totalCount: number;
  currency?: string;
}

const DOT: Record<string, string> = {
  all: 'bg-text-muted',
  draft: 'bg-text-muted',
  pending_approval: 'bg-warning',
  awaiting_payment: 'bg-info',
  overdue: 'bg-danger',
  paid: 'bg-success',
};

/** Segmented KPI strip: one card, one segment per business status, plus "All". Clicking filters. */
export const StatusSummaryStrip: React.FC<Props> = ({ buckets, active, onChange, totalCount, currency }) => {
  const seg = (key: string, label: string, count: number, amount: number | null, danger = false) => {
    const isActive = active === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        aria-pressed={isActive}
        className={cn(
          'relative flex-1 min-w-[140px] text-left px-4 py-3 transition-colors duration-150 outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
          isActive ? 'bg-accent-soft/60' : 'hover:bg-surface-neutral/70'
        )}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
          <span className={cn('size-1.5 rounded-full', DOT[key] ?? 'bg-text-muted')} />
          <span className={isActive ? 'text-accent' : undefined}>{label}</span>
        </div>
        <div
          className={cn(
            'mt-1 text-xl font-semibold tracking-tight tabular-nums',
            danger && (amount ?? 0) > 0 ? 'text-danger' : 'text-text-primary'
          )}
        >
          {amount !== null ? formatMoney(amount, currency) : count}
        </div>
        <div className="text-xs text-text-muted mt-0.5">
          {amount === null ? 'all documents' : `${count} ${count === 1 ? 'document' : 'documents'}`}
        </div>
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-opacity duration-150',
            isActive ? 'opacity-100' : 'opacity-0'
          )}
        />
      </button>
    );
  };

  return (
    <div
      className="flex flex-wrap rounded-xl border border-border bg-surface shadow-[var(--shadow-card,0_1px_2px_rgba(16,24,40,0.06))] overflow-hidden divide-x divide-border [&>button]:border-b [&>button]:border-border sm:[&>button]:border-b-0"
      role="group"
      aria-label="Filter by status"
    >
      {seg('all', 'All', totalCount, null)}
      {buckets.map((b) => seg(b.key, b.label, b.count, b.amount, b.key === 'overdue'))}
    </div>
  );
};

/** Due-date cell: date plus relative secondary line for open documents. */
export const DueCell: React.FC<{ date: string; formatted: string; open: boolean; overdueDays: number }> = ({
  formatted,
  date,
  open,
  overdueDays,
}) => {
  let sub: React.ReactNode = null;
  if (open) {
    if (overdueDays > 0) {
      sub = (
        <span className="text-danger text-[11px]">
          {overdueDays} {overdueDays === 1 ? 'day' : 'days'} overdue
        </span>
      );
    } else {
      const days = Math.round((new Date(date).getTime() - new Date('2026-10-31').getTime()) / 86_400_000);
      sub = (
        <span className="text-text-muted text-[11px]">
          {days <= 0 ? 'due today' : `in ${days} ${days === 1 ? 'day' : 'days'}`}
        </span>
      );
    }
  }
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-text-secondary">{formatted}</span>
      {sub}
    </div>
  );
};
