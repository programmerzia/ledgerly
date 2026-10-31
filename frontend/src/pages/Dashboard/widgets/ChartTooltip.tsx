import React from 'react';
import { formatMoney } from '@/lib/format';

interface Entry { name?: string | number; value?: number | string; color?: string; dataKey?: string | number }

export const ChartTooltip: React.FC<{ active?: boolean; payload?: Entry[]; label?: string | number; currency: string }> = ({ active, payload, label, currency }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface-elevated shadow-lg px-3 py-2 text-xs min-w-[150px]">
      {label !== undefined && <div className="font-semibold text-text-primary mb-1.5">{label}</div>}
      <div className="flex flex-col gap-1">
        {payload.map((p) => (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span className="size-2 rounded-[2px] shrink-0" style={{ background: p.color }} />
            <span className="text-text-secondary flex-1">{p.name}</span>
            <span className="tabular-nums font-medium text-text-primary">{formatMoney(Number(p.value), currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
