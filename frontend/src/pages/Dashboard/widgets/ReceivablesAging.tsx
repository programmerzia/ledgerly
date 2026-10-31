import React from 'react';
import { formatMoney } from '@/lib/format';
import { Card, CardHeader } from './Card';
import type { DashboardData } from '../useDashboardData';

export const ReceivablesAging: React.FC<{ d: DashboardData; index: number; className?: string }> = ({ d, index, className }) => {
  const total = d.aging.reduce((t, b) => t + b.amount, 0);
  return (
    <Card index={index} className={className}>
      <CardHeader title="Receivables aging" sub="Unpaid invoices by days overdue" />
      <div className="px-5 pb-5">
        <div className="text-2xl font-semibold tracking-tight tabular-nums text-text-primary">{formatMoney(total, d.base)}</div>
        {total === 0 ? (
          <p className="text-xs text-text-muted py-6">No outstanding invoices.</p>
        ) : (
          <>
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mt-3 bg-surface-neutral" role="img" aria-label="Receivables aging breakdown">
              {d.aging.filter((b) => b.amount > 0).map((b) => (
                <div key={b.key} style={{ width: `${(b.amount / total) * 100}%`, background: b.color }} title={`${b.label}: ${formatMoney(b.amount, d.base)}`} />
              ))}
            </div>
            <ul className="mt-4 flex flex-col gap-2">
              {d.aging.map((b) => (
                <li key={b.key} className="flex items-center gap-2 text-xs">
                  <span className="size-2 rounded-full shrink-0" style={{ background: b.color }} />
                  <span className="text-text-secondary flex-1">{b.label}{b.key !== 'current' ? ' days' : ''}</span>
                  <span className="text-text-muted w-8 text-right">{b.count || ''}</span>
                  <span className="tabular-nums font-medium text-text-primary w-24 text-right whitespace-nowrap">{formatMoney(b.amount, d.base)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
};
