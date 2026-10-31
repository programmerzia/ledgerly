import React from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

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
  since?: string;
  whoActsNext?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  label,
  className,
  since = 'Current period',
  whoActsNext: explicitWho,
}) => {
  const normalized = (status || '').toLowerCase().replace(/\s+/g, '_');

  let pillClasses = 'bg-surface-neutral text-text-muted';
  let defaultLabel = status;
  let meaning = 'Document state in financial ledger';
  let whoActsNext = explicitWho || 'Finance Team';

  switch (normalized) {
    case 'draft':
      pillClasses = 'bg-surface-neutral text-text-secondary';
      defaultLabel = 'Draft';
      meaning = 'Uncommitted draft. Can be edited or deleted by creator.';
      whoActsNext = explicitWho || 'Author / Maker';
      break;

    case 'pending_approval':
    case 'pending':
      pillClasses = 'bg-warning-soft text-warning';
      defaultLabel = 'Awaiting approval';
      meaning = 'Waiting for an approver to review and sign.';
      whoActsNext = explicitWho || 'Approver (Fatima)';
      break;

    case 'paid':
      pillClasses = 'bg-success-soft text-success';
      defaultLabel = 'Paid';
      meaning = 'Fully settled. Nothing left to collect or pay.';
      whoActsNext = explicitWho || 'Nobody';
      break;

    case 'awaiting_payment':
      pillClasses = 'bg-info-soft text-info';
      defaultLabel = 'Awaiting payment';
      meaning = 'Approved and in the books. Not yet due.';
      whoActsNext = explicitWho || 'Customer / Supplier';
      break;

    case 'partially_paid':
      pillClasses = 'bg-info-soft text-info';
      defaultLabel = 'Partially paid';
      meaning = 'Part of the amount has been settled. The rest is still open.';
      whoActsNext = explicitWho || 'Customer / Supplier';
      break;

    case 'queued':
      pillClasses = 'bg-surface-neutral text-text-secondary';
      defaultLabel = 'Queued offline';
      meaning = 'Saved on this device. It will sync when you are back online.';
      whoActsNext = explicitWho || 'Automatic sync';
      break;

    case 'posted':
    case 'matched':
    case 'balanced':
    case 'pass':
      pillClasses = 'bg-success-soft text-success';
      defaultLabel = normalized === 'matched' ? 'Matched' : 'Posted';
      meaning = 'Immutable financial document committed to the General Ledger.';
      whoActsNext = explicitWho || (normalized === 'matched' ? 'Reconciler' : 'Settlement / Counterparty');
      break;

    case 'reversed':
      pillClasses = 'bg-violet-soft text-violet';
      defaultLabel = 'Reversed';
      meaning = 'Offset by mirror reversal journal. Ledger impact fully neutralized.';
      whoActsNext = explicitWho || 'None (Immutable Record)';
      break;

    case 'void':
      pillClasses = 'bg-danger-soft text-danger';
      defaultLabel = 'Void';
      meaning = 'Invalidated before ledger posting.';
      whoActsNext = explicitWho || 'None';
      break;

    case 'overdue':
    case 'unmatched':
    case 'fail':
      pillClasses = 'bg-danger-soft text-danger';
      defaultLabel = normalized === 'unmatched' ? 'Unmatched' : 'Overdue';
      meaning = normalized === 'unmatched'
        ? 'Bank transaction has no matched ledger allocation.'
        : 'Past contractual due date. Subject to AR collections.';
      whoActsNext = explicitWho || (normalized === 'unmatched' ? 'Bank Reconciler' : 'Credit Controller');
      break;

    case 'partial':
      pillClasses = 'bg-info-soft text-info';
      defaultLabel = 'Partial';
      meaning = 'Partially settled. Remaining balance outstanding.';
      whoActsNext = explicitWho || 'Debtor / Counterparty';
      break;

    case 'open':
      pillClasses = 'bg-success-soft text-success';
      defaultLabel = 'Open';
      meaning = 'Active fiscal period accepting balanced journal postings.';
      whoActsNext = explicitWho || 'Finance Team';
      break;

    case 'soft_closed':
      pillClasses = 'bg-warning-soft text-warning';
      defaultLabel = 'Soft closed';
      meaning = 'Preliminary month-end close. Sub-ledger writes restricted.';
      whoActsNext = explicitWho || 'Financial Controller';
      break;

    case 'closed':
    case 'locked':
      pillClasses = 'bg-surface-neutral text-text-secondary';
      defaultLabel = normalized === 'closed' ? 'Closed' : 'Locked';
      meaning = 'Fiscal period closed. Reopening requires two authorized PIN approvals.';
      whoActsNext = explicitWho || 'Two Authorizers';
      break;

    case 'queued':
      pillClasses = 'bg-warning-soft text-warning border border-dashed border-warning/40';
      defaultLabel = 'Queued';
      meaning = 'Will post when online; sequence number assigned then.';
      whoActsNext = explicitWho || 'Background Sync Engine';
      break;

    default:
      pillClasses = 'bg-surface-neutral text-text-secondary';
      defaultLabel = status;
      break;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center h-5 px-1.5 rounded-[3px] text-xs font-medium select-none whitespace-nowrap transition-colors cursor-help',
            pillClasses,
            className
          )}
        >
          <span className="truncate">{label || defaultLabel}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs p-2.5 flex !flex-col !items-stretch gap-1.5">
        <div className="flex items-center justify-between border-b border-white/15 pb-1">
          <span className="font-semibold">{defaultLabel}</span>
          <span className="text-[10px] opacity-60">{since}</span>
        </div>
        <p className="text-[11px] opacity-85 leading-snug">{meaning}</p>
        <div className="pt-1 border-t border-white/15 flex items-center justify-between text-[10px]">
          <span className="opacity-60">Next:</span>
          <span className="font-semibold">{whoActsNext}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
