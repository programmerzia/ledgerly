import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Card, CardHeader } from './Card';
import { ChartTooltip } from './ChartTooltip';
import type { MonthPnl } from '@/api/live/dashboardExtras';
import { getCurrencyMinorUnits, getCurrencySymbol } from '@/lib/format';

export interface MonthBar {
  label: string;
  pnl: MonthPnl;
}

const compact = (v: number, currency: string) => {
  const decimals = getCurrencyMinorUnits(currency);
  const major = v / Math.pow(10, decimals);
  const symbol = getCurrencySymbol(currency);
  const prefix = /\p{L}/u.test(symbol) ? `${symbol} ` : symbol;
  if (Math.abs(major) >= 1_000_000) return `${prefix}${(major / 1_000_000).toFixed(1)}M`;
  if (Math.abs(major) >= 1000) return `${prefix}${Math.round(major / 1000)}k`;
  return `${prefix}${Math.round(major)}`;
};

/**
 * Income against expenses per month, from one profit-and-loss call per month. Each bar segment is a section total
 * the server returned; the chart stacks them, so no money is added in this file.
 */
export const LiveIncomeExpense: React.FC<{ months: MonthBar[]; currency: string; to: string; className?: string }> = ({ months, currency, to, className }) => {
  const navigate = useNavigate();
  const data = months.map((m) => ({
    label: m.label,
    revenue: m.pnl.revenue, otherIncome: m.pnl.otherIncome,
    cos: m.pnl.costOfSales, opex: m.pnl.operatingExpenses, otherExp: m.pnl.otherExpenses,
    net: m.pnl.netProfit,
  }));
  const empty = data.every((m) => m.revenue === 0 && m.otherIncome === 0 && m.cos === 0 && m.opex === 0 && m.otherExp === 0);
  return (
    <Card className={className}>
      <CardHeader
        title="Income vs expenses"
        sub={`Monthly, in ${currency}`}
        right={<button type="button" onClick={() => navigate(to)} className="hidden sm:block text-xs text-accent hover:underline cursor-pointer">View P&amp;L</button>}
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
              <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tick={{ fill: 'var(--color-text-muted)' }} tickFormatter={(v) => compact(v, currency)} />
              <Tooltip cursor={{ fill: 'var(--color-surface-neutral)', opacity: 0.6 }} content={<ChartTooltip currency={currency} />} />
              <Bar stackId="income" dataKey="revenue" name="Revenue" fill="var(--color-accent)" maxBarSize={18} isAnimationActive={false} />
              <Bar stackId="income" dataKey="otherIncome" name="Other income" fill="var(--color-accent)" fillOpacity={0.6} radius={[1, 1, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar stackId="expenses" dataKey="cos" name="Cost of sales" fill="var(--color-text-muted)" fillOpacity={0.55} maxBarSize={18} isAnimationActive={false} />
              <Bar stackId="expenses" dataKey="opex" name="Operating expenses" fill="var(--color-text-muted)" fillOpacity={0.4} maxBarSize={18} isAnimationActive={false} />
              <Bar stackId="expenses" dataKey="otherExp" name="Other expenses" fill="var(--color-text-muted)" fillOpacity={0.25} radius={[1, 1, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Line dataKey="net" name="Net profit" type="linear" stroke="var(--color-text-primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};
