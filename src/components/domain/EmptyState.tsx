import React from 'react';
import { cn } from '@/lib/utils';
import { LucideIcon, Plus, FileSpreadsheet } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = FileSpreadsheet,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-12 text-center border border-dashed border-ink-300 rounded-lg bg-surface/50',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-h3 text-ink-900 mb-1">{title}</h3>
      <p className="text-xs text-ink-500 max-w-sm mb-5">{description}</p>

      <div className="flex items-center gap-2.5">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="flex items-center gap-1.5 h-8 px-3.5 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-medium shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{actionLabel}</span>
          </button>
        )}

        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            onClick={onSecondaryAction}
            className="flex items-center gap-1.5 h-8 px-3.5 bg-surface border border-ink-200 hover:border-ink-300 text-ink-700 rounded-sm text-xs font-medium transition-colors"
          >
            <span>{secondaryActionLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
};
