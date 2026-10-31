import React from 'react';
import { formatMoney } from '@/lib/format';
import { Card, CardHeader } from './Card';
import type { DashboardData } from '../useDashboardData';

/** Year-to-date expenses ranked by category: name, a thin bar scaled to the largest, share and amount. */
export const ExpenseDonut: React.FC<{ d: DashboardData; index: number; className?: string }> = ({ d, index, className }) => {
  const largest = d.expenseSlices.reduce((m, s) => Math.max(m, s.value), 0);
  return (
    <Card index={index} className={className}>
      <CardHeader title="Expenses by category" sub="Year to date" />
      {d.expenseSlices.length === 0 ? (
        <p className="px-5 pb-6 text-[13px] text-text-muted">No expenses recorded yet.</p>
      ) : (
        <div className="px-5 pb-4">
          <div className="flex items-baseline justify-between border-b border-border pb-2 text-[13px]">
            <span className="text-text-muted">Total</span>
            <span className="font-medium tabular-nums text-text-primary">{formatMoney(d.expenseTotal, d.base)}</span>
          </div>
          <ul className="divide-y divide-border">
            {d.expenseSlices.map((s, i) => (
              <li key={s.id} className="py-2">
                <div className="flex items-baseline gap-2 text-[13px]">
                  <span className="text-text-primary flex-1 truncate">{s.name}</span>
                  <span className="w-9 text-right text-xs text-text-muted tabular-nums">{d.expenseTotal > 0 ? Math.round((s.value / d.expenseTotal) * 100) : 0}%</span>
                  <span className="w-24 text-right tabular-nums text-text-primary whitespace-nowrap">{formatMoney(s.value, d.base)}</span>
                </div>
                <div className="mt-1.5 h-1 rounded-[1px] bg-surface-neutral" aria-hidden>
                  <div
                    className={`h-full rounded-[1px] ${i === 0 ? 'bg-accent' : 'bg-text-muted/40'}`}
                    style={{ width: `${largest > 0 ? (s.value / largest) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};
