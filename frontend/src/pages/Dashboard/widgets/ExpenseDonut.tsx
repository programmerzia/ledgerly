import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatMoney } from '@/lib/format';
import { Card, CardHeader } from './Card';
import { ChartTooltip } from './ChartTooltip';
import type { DashboardData } from '../useDashboardData';

const COLORS = ['var(--color-accent)', 'var(--color-violet)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-info)', 'var(--color-text-muted)'];

export const ExpenseDonut: React.FC<{ d: DashboardData; index: number; className?: string }> = ({ d, index, className }) => (
  <Card index={index} className={className}>
    <CardHeader title="Expense breakdown" sub="Year to date, top categories" />
    {d.expenseSlices.length === 0 ? (
      <p className="text-xs text-text-muted py-12 text-center">No expenses recorded yet.</p>
    ) : (
      <div className="px-5 pb-5 flex flex-col gap-4">
        <div className="relative h-40">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={d.expenseSlices} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                {d.expenseSlices.map((s, i) => <Cell key={s.id} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip content={<ChartTooltip currency={d.base} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[11px] text-text-muted">Total</span>
            <span className="text-[15px] font-semibold tabular-nums leading-tight text-text-primary">{formatMoney(d.expenseTotal, d.base)}</span>
          </div>
        </div>
        <ul className="flex flex-col gap-1.5">
          {d.expenseSlices.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              <span className="size-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-text-secondary flex-1 truncate">{s.name}</span>
              <span className="text-text-muted">{Math.round((s.value / d.expenseTotal) * 100)}%</span>
              <span className="tabular-nums font-medium text-text-primary w-24 text-right whitespace-nowrap">{formatMoney(s.value, d.base)}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
  </Card>
);
