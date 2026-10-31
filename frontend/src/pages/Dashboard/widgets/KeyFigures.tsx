import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '@/lib/format';
import type { DashboardData } from '../useDashboardData';

export interface Figure {
  label: string;
  value: string;
  valueClass?: string;
  note: React.ReactNode;
  to: string;
}

/**
 * The four numbers an owner checks first, set like the top of a management report: one ruled
 * strip, figures right where the eye lands, a single line of context under each.
 */
export const KeyFigures: React.FC<{ figures: Figure[]; className?: string }> = ({ figures, className = '' }) => {
  const navigate = useNavigate();
  return (
    <section className={`bg-surface border border-border rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border ${className}`}>
      {figures.map((f) => (
        <button
          key={f.label}
          type="button"
          onClick={() => navigate(f.to)}
          className="text-left px-5 py-4 hover:bg-canvas transition-colors cursor-pointer outline-none focus-visible:bg-canvas min-w-0"
        >
          <div className="text-xs text-text-muted">{f.label}</div>
          <div className={`mt-1 text-[22px] leading-7 font-medium tabular-nums truncate ${f.valueClass ?? 'text-text-primary'}`}>{f.value}</div>
          <div className="mt-1 text-xs text-text-muted truncate">{f.note}</div>
        </button>
      ))}
    </section>
  );
};

/** "Premier Bank 126,100.00 · Dahabshiil 42,100.00": where the cash sits, in one line. */
export function cashNote(d: DashboardData): string {
  if (d.bankRows.length === 0) return 'No bank accounts yet';
  const delta = d.cashDelta;
  const move = delta === null ? '' : `${delta >= 0 ? 'Up' : 'Down'} ${formatMoney(Math.abs(delta), d.base)} on last month`;
  return move || `${d.bankRows.length} accounts`;
}
