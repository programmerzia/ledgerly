import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Card, CardHeader } from './Card';
import { ChartTooltip } from './ChartTooltip';
import type { DashboardData } from '../useDashboardData';

const compact = (v: number) => {
  const m = v / 100;
  if (Math.abs(m) >= 1_000_000) return `${(m / 1_000_000).toFixed(1)}M`;
  if (Math.abs(m) >= 1000) return `${Math.round(m / 1000)}k`;
  return `${Math.round(m)}`;
};

const RANGES = [
  { id: '6M', label: '6M' },
  { id: '12M', label: '12M' },
  { id: 'YTD', label: 'YTD' },
] as const;

export const IncomeExpenseChart: React.FC<{ d: DashboardData; to: string; index: number; className?: string }> = ({ d, to, index, className }) => {
  const navigate = useNavigate();
  const [range, setRange] = useState<'6M' | '12M' | 'YTD'>('YTD');
  const data = range === '6M' ? d.months.slice(-6) : d.months; // store holds one fiscal year, so 12M == YTD
  const empty = data.every((m) => m.income === 0 && m.expenses === 0);
  return (
    <Card index={index} className={className}>
      <CardHeader
        title="Income vs expenses"
        sub={`Monthly, in ${d.base}`}
        right={
          <div className="flex items-center gap-3 shrink-0">
            <div role="tablist" aria-label="Range" className="inline-flex p-0.5 rounded-md border border-border">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  role="tab"
                  aria-selected={range === r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  className={`h-6 px-2.5 text-xs rounded-[4px] cursor-pointer transition-colors ${range === r.id ? 'bg-surface-neutral text-text-primary font-medium' : 'text-text-muted hover:text-text-primary'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => navigate(to)} className="hidden sm:block text-xs text-accent hover:underline cursor-pointer">View P&amp;L</button>
          </div>
        }
      />
      <div className="px-5 flex items-center gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-accent" />Income</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-text-muted/50" />Expenses</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-px bg-text-primary" />Net profit</span>
      </div>
      {empty ? (
        <p className="text-xs text-text-muted py-16 text-center">No income or expenses recorded yet.</p>
      ) : (
        <div className="h-72 px-3 pb-3 pt-2 text-xs">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tick={{ fill: 'var(--color-text-muted)' }} />
              <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tick={{ fill: 'var(--color-text-muted)' }} tickFormatter={compact} />
              <Tooltip cursor={{ fill: 'var(--color-surface-neutral)', opacity: 0.6 }} content={<ChartTooltip currency={d.base} />} />
              <Bar dataKey="income" name="Income" fill="var(--color-accent)" radius={[1, 1, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="expenses" name="Expenses" fill="var(--color-text-muted)" fillOpacity={0.4} radius={[1, 1, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Line dataKey="net" name="Net profit" type="monotone" stroke="var(--color-text-primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};
