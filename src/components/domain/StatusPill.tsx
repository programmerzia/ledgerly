import React from 'react';
import { cn } from '@/lib/utils';

export type StatusPillType =
  | 'draft'
  | 'pending_approval'
  | 'pending'
  | 'posted'
  | 'reversed'
  | 'void'
  | 'overdue'
  | 'paid'
  | 'partial'
  | 'open'
  | 'soft_closed'
  | 'closed'
  | 'locked'
  | 'matched'
  | 'unmatched'
  | 'queued';

interface StatusPillProps {
  status: StatusPillType | string;
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  label,
  className,
}) => {
  const normalized = (status || '').toLowerCase().replace(/\s+/g, '_');

  let pillClasses = 'bg-surface-neutral text-text-muted';
  let dotClasses = 'bg-text-muted';
  let defaultLabel = status;

  switch (normalized) {
    case 'draft':
      pillClasses = 'bg-surface-neutral text-text-secondary';
      dotClasses = 'bg-text-muted';
      defaultLabel = 'Draft';
      break;

    case 'pending_approval':
    case 'pending':
      pillClasses = 'bg-warning-soft text-warning';
      dotClasses = 'bg-warning';
      defaultLabel = 'Pending';
      break;

    case 'posted':
    case 'paid':
    case 'matched':
    case 'balanced':
    case 'pass':
      pillClasses = 'bg-success-soft text-success';
      dotClasses = 'bg-success';
      defaultLabel = normalized === 'matched' ? 'Matched' : 'Posted';
      break;

    case 'reversed':
      pillClasses = 'bg-violet-soft text-violet';
      dotClasses = 'bg-violet';
      defaultLabel = 'Reversed';
      break;

    case 'void':
      pillClasses = 'bg-danger-soft text-danger';
      dotClasses = 'bg-danger';
      defaultLabel = 'Void';
      break;

    case 'overdue':
    case 'unmatched':
    case 'fail':
      pillClasses = 'bg-danger-soft text-danger';
      dotClasses = 'bg-danger';
      defaultLabel = normalized === 'unmatched' ? 'Unmatched' : 'Overdue';
      break;

    case 'partial':
      pillClasses = 'bg-info-soft text-info';
      dotClasses = 'bg-info';
      defaultLabel = 'Partial';
      break;

    case 'open':
      pillClasses = 'bg-success-soft text-success';
      dotClasses = 'bg-success';
      defaultLabel = 'Open';
      break;

    case 'soft_closed':
      pillClasses = 'bg-warning-soft text-warning';
      dotClasses = 'bg-warning';
      defaultLabel = 'Soft closed';
      break;

    case 'closed':
    case 'locked':
      pillClasses = 'bg-surface-neutral text-text-secondary';
      dotClasses = 'bg-text-disabled';
      defaultLabel = normalized === 'closed' ? 'Closed' : 'Locked';
      break;

    case 'queued':
      pillClasses = 'bg-warning-soft text-warning border border-dashed border-warning/40';
      dotClasses = 'bg-warning animate-pulse';
      defaultLabel = 'Queued';
      break;

    default:
      pillClasses = 'bg-surface-neutral text-text-secondary';
      dotClasses = 'bg-text-muted';
      defaultLabel = status;
      break;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center h-5 min-w-[72px] px-2 rounded-xs text-[11px] font-semibold select-none whitespace-nowrap gap-1.5 transition-colors',
        pillClasses,
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotClasses)} />
      <span className="truncate">{label || defaultLabel}</span>
    </span>
  );
};
