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
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-border bg-surface px-6 py-12 text-center', className)}>
      <Icon className="mb-3 size-6 text-text-muted" />
      <h3 className="mb-1 text-sm font-semibold text-text-primary">{title}</h3>
      <p className="mb-5 max-w-sm text-[13px] leading-relaxed text-text-muted">{description}</p>

      <div className="flex items-center gap-2.5">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="size-4" />
            <span>{actionLabel}</span>
          </button>
        )}

        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            onClick={onSecondaryAction}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-neutral"
          >
            <span>{secondaryActionLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
};
