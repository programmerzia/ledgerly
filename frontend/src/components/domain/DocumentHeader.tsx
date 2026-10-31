import React from 'react';
import { cn } from '@/lib/utils';
import { StatusPill } from './StatusPill';
import { formatDate, formatMoney } from '@/lib/format';
import { ArrowLeft, MoreHorizontal, Printer, Copy, RotateCcw, FileText } from 'lucide-react';

interface DocumentHeaderProps {
  documentType: string;
  number: string | null;
  status: string;
  issueDate?: string;
  dueDate?: string;
  amount?: number;
  currency?: string;
  contactName?: string;
  reference?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  onReverse?: () => void;
  onDuplicate?: () => void;
  className?: string;
}

export const DocumentHeader: React.FC<DocumentHeaderProps> = ({
  documentType,
  number,
  status,
  issueDate,
  dueDate,
  amount,
  currency = 'USD',
  contactName,
  reference,
  onBack,
  actions,
  onReverse,
  onDuplicate,
  className,
}) => {
  return (
    <div className={cn('flex flex-col gap-3 pb-5 border-b border-ink-200', className)}>
      {/* Top Bar with Back and Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 rounded-sm border border-ink-200 hover:bg-ink-100 text-ink-500 hover:text-ink-900 transition-colors mr-1"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <span className="text-xs uppercase font-semibold tracking-wider text-ink-500">
            {documentType}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onReverse && status === 'posted' && (
            <button
              type="button"
              onClick={onReverse}
              className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-ink-200 hover:border-reversed hover:text-reversed bg-surface text-xs font-medium text-ink-700 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reverse Journal</span>
            </button>
          )}

          {actions}
        </div>
      </div>

      {/* Main Title & Key Meta Data */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <h1 className="text-h1 font-bold text-ink-900 font-mono tracking-tight">
              {number || 'DRAFT'}
            </h1>
            <StatusPill status={status} size="md" />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
            {contactName && (
              <div>
                Entity: <span className="font-medium text-ink-900">{contactName}</span>
              </div>
            )}
            {issueDate && (
              <div>
                Date: <span className="font-mono text-ink-700">{formatDate(issueDate)}</span>
              </div>
            )}
            {dueDate && (
              <div>
                Due: <span className="font-mono text-ink-700">{formatDate(dueDate)}</span>
              </div>
            )}
            {reference && (
              <div>
                Ref: <span className="font-mono text-ink-700">{reference}</span>
              </div>
            )}
          </div>
        </div>

        {amount !== undefined && (
          <div className="flex flex-col items-end">
            <span className="text-[11px] uppercase tracking-wider text-ink-500 font-medium">
              Total Amount
            </span>
            <span className="text-2xl font-bold font-mono text-num text-ink-900">
              {formatMoney(amount, currency)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
