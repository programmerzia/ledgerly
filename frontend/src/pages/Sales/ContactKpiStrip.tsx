import React from 'react';
import { cn } from '@/lib/utils';

export interface ContactKpi {
  label: string;
  value: React.ReactNode;
  sub?: string;
  /** Accepted for older callers and not rendered: figures stand without an icon. */
  icon?: React.ReactNode;
  tone?: 'accent' | 'danger' | 'success' | 'warning';
}

/** Three-up key figures for customer / supplier list pages: one ruled strip. */
export const ContactKpiStrip: React.FC<{ items: ContactKpi[] }> = ({ items }) => (
  <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-lg border border-border bg-surface shrink-0">
    {items.map((k) => (
      <div key={k.label} className="min-w-0 px-5 py-4">
        <div className="text-xs text-text-muted">{k.label}</div>
        <div className={cn('mt-1 text-[22px] leading-7 font-medium tabular-nums truncate', k.tone === 'danger' ? 'text-danger' : 'text-text-primary')}>
          {k.value}
        </div>
        {k.sub && <div className="mt-1 text-xs text-text-muted truncate">{k.sub}</div>}
      </div>
    ))}
  </div>
);
