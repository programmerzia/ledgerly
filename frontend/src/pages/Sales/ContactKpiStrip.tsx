import React from 'react';
import { cn } from '@/lib/utils';

export interface ContactKpi {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ReactNode;
  tone?: 'accent' | 'danger' | 'success' | 'warning';
}

const TONE: Record<NonNullable<ContactKpi['tone']>, string> = {
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
};

/** Three-up KPI card for customer / supplier list pages. */
export const ContactKpiStrip: React.FC<{ items: ContactKpi[] }> = ({ items }) => (
  <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-xl border border-border bg-surface shadow-[var(--shadow-card,0_1px_2px_rgba(16,24,40,0.06))] shrink-0">
    {items.map((k) => (
      <div key={k.label} className="flex items-center gap-3 px-5 py-4">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4', TONE[k.tone ?? 'accent'])}>
          {k.icon}
        </span>
        <div className="min-w-0">
          <div className="text-xs font-medium text-text-muted">{k.label}</div>
          <div className={cn('text-2xl font-semibold tracking-tight tabular-nums', k.tone === 'danger' ? 'text-danger' : 'text-text-primary')}>
            {k.value}
          </div>
          {k.sub && <div className="text-xs text-text-muted">{k.sub}</div>}
        </div>
      </div>
    ))}
  </div>
);
