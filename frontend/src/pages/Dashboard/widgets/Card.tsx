import React from 'react';
import { Avatar as UiAvatar } from '@/components/ui/avatar';

/** A plain ruled panel. `index` is accepted for older callers and ignored (no entrance animation). */
export const Card: React.FC<{ className?: string; children: React.ReactNode; index?: number }> = ({ className = '', children }) => (
  <section className={`bg-surface border border-border rounded-lg min-w-0 ${className}`}>{children}</section>
);

export const CardHeader: React.FC<{ title: string; sub?: string; right?: React.ReactNode }> = ({ title, sub, right }) => (
  <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
    <div className="min-w-0 flex items-baseline gap-2">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      {sub && <p className="text-xs text-text-muted">{sub}</p>}
    </div>
    {right}
  </div>
);

export const Avatar: React.FC<{ name: string; size?: number }> = ({ name, size = 28 }) => (
  <UiAvatar name={name} size={size >= 36 ? 'lg' : size >= 30 ? 'md' : 'sm'} className={size === 28 ? 'size-7 text-[11px]' : undefined} />
);
