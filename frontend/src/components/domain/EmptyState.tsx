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
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface/60 px-6 py-14 text-center',
        className
      )}
    >
      <div className="relative mb-5">
        <div
          aria-hidden="true"
          className="absolute -inset-3 rounded-full bg-brand opacity-[0.12] blur-md"
        />
        <div className="relative flex size-16 items-center justify-center rounded-full border border-border bg-gradient-to-br from-accent-soft to-violet-soft text-accent shadow-card">
          <Icon className="size-7" strokeWidth={1.6} />
        </div>
      </div>
      <h3 className="mb-1 text-[15px] font-semibold tracking-tight text-text-primary">{title}</h3>
      <p className="mb-6 max-w-sm text-[13px] leading-relaxed text-text-muted">{description}</p>

      <div className="flex items-center gap-2.5">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-medium text-white shadow-card transition-colors hover:bg-accent-hover"
          >
            <Plus className="size-4" />
            <span>{actionLabel}</span>
          </button>
        )}

        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            onClick={onSecondaryAction}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-[13px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-neutral"
          >
            <span>{secondaryActionLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
};
