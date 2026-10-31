import React from 'react';
import { Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';

interface PeriodLite {
  id: string;
  name: string;
  kind?: string;
  status: string;
  starts_on: string;
  ends_on: string;
  reopened_count?: number;
}

const TONE: Record<string, string> = {
  open: 'border-success/40 bg-success-soft text-success',
  closed: 'border-border bg-surface-neutral text-text-secondary',
  locked: 'border-border bg-surface-neutral text-text-secondary',
  future: 'border-dashed border-border bg-surface text-text-muted',
};

const STATUS_LABEL: Record<string, string> = { open: 'Open', closed: 'Closed', locked: 'Locked', future: 'Not started' };

interface Props {
  periods: PeriodLite[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** Year timeline: one chip per month, plus the adjustment period. */
export const PeriodTimeline: React.FC<Props> = ({ periods, selectedId, onSelect }) => (
  <section className="rounded-lg border border-border bg-surface p-5" aria-label="Fiscal year timeline">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-text-primary">Your financial year</h2>
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-success" /> Open</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-text-muted" /> Closed</span>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7 xl:grid-cols-[repeat(13,minmax(0,1fr))]">
      {periods.map((p) => {
        const selected = p.id === selectedId;
        const adj = p.kind === 'adjustment';
        const short = adj ? 'Adj' : p.name.split(' ')[0];
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-pressed={selected}
            title={`${p.name}: ${formatDate(p.starts_on)} to ${formatDate(p.ends_on)}`}
            className={cn(
              'relative flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition outline-none',
              'hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent',
              adj ? 'border-border bg-surface-neutral text-text-secondary' : TONE[p.status] ?? TONE.closed,
              selected && 'ring-2 ring-accent ring-offset-1 ring-offset-surface'
            )}
          >
            <span className="text-[13px] font-semibold">{short}</span>
            <span className="flex items-center gap-1 text-[11px] opacity-80">
              {p.status === 'open' ? <Unlock className="size-3" /> : <Lock className="size-3" />}
              {adj ? 'Year-end' : STATUS_LABEL[p.status] ?? p.status}
            </span>
            {(p.reopened_count ?? 0) > 0 && (
              <span className="absolute -right-1 -top-1 rounded-[3px] bg-warning px-1 text-[10px] font-semibold text-white">
                {p.reopened_count}x
              </span>
            )}
          </button>
        );
      })}
    </div>
  </section>
);
