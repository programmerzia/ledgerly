import React from 'react';
import { formatMoney } from '@/lib/format';
import { Card, CardHeader } from './Card';
import type { DashboardData } from '../useDashboardData';

/** Not overdue is neutral; overdue buckets step up from amber to red the later they are. */
const BUCKET_TONE: Record<string, string> = {
  current: 'bg-text-muted/40',
  d30: 'bg-warning/50',
  d60: 'bg-warning',
  d90: 'bg-danger/70',
  d90p: 'bg-danger',
};

export const ReceivablesAging: React.FC<{
  d: Pick<DashboardData, 'aging' | 'base'>;
  index: number;
  className?: string;
  /** Live mode passes the server's total; the demo sums its own rows. */
  total?: number;
}> = ({ d, index, className, total: serverTotal }) => {
  const total = serverTotal ?? d.aging.reduce((t, b) => t + b.amount, 0);
  return (
    <Card index={index} className={className}>
      <CardHeader title="Receivables aging" sub="By days overdue" />
      <div className="px-5 pb-4">
        <div className="text-[22px] leading-7 font-medium tabular-nums text-text-primary">{formatMoney(total, d.base)}</div>
        {total === 0 ? (
          <p className="text-[13px] text-text-muted pt-3 pb-2">No outstanding invoices.</p>
        ) : (
          <>
            <div className="flex h-1.5 rounded-[1px] overflow-hidden gap-px mt-3 bg-surface-neutral" role="img" aria-label="Receivables aging breakdown">
              {d.aging.filter((b) => b.amount > 0).map((b) => (
                <div key={b.key} className={BUCKET_TONE[b.key] ?? 'bg-text-muted/40'} style={{ width: `${(b.amount / total) * 100}%` }} title={`${b.label}: ${formatMoney(b.amount, d.base)}`} />
              ))}
            </div>
            <ul className="mt-3 divide-y divide-border">
              {d.aging.map((b) => (
                <li key={b.key} className="flex items-center gap-2 py-1.5 text-[13px]">
                  <span className={`size-2 rounded-[1px] shrink-0 ${BUCKET_TONE[b.key] ?? 'bg-text-muted/40'}`} />
                  <span className="text-text-secondary flex-1">{b.label}{b.key !== 'current' ? ' days' : ''}</span>
                  <span className="text-xs text-text-muted w-8 text-right tabular-nums">{b.count || ''}</span>
                  <span className="tabular-nums text-text-primary w-24 text-right whitespace-nowrap">{formatMoney(b.amount, d.base)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
};
