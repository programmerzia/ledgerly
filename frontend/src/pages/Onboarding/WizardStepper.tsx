import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WizardStep {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
}

/** Numbered stepper with a connecting progress line. `current` is 1-based. */
export const WizardStepper: React.FC<{
  steps: WizardStep[];
  current: number;
  onSelect?: (step: number) => void;
  className?: string;
}> = ({ steps, current, onSelect, className }) => {
  const pct = steps.length > 1 ? ((current - 1) / (steps.length - 1)) * 100 : 0;
  return (
    <ol className={cn('relative flex items-start justify-between', className)} aria-label="Progress">
      <span aria-hidden className="absolute left-0 right-0 top-4 mx-[calc(100%/(var(--n)*2))] h-px bg-border" style={{ ['--n' as string]: steps.length }}>
        <span className="block h-full bg-accent transition-all duration-150" style={{ width: `${pct}%` }} />
      </span>
      {steps.map((s, i) => {
        const n = i + 1;
        const done = current > n;
        const cur = current === n;
        return (
          <li key={s.title} className="relative z-10 flex flex-1 flex-col items-center gap-1.5 text-center" aria-current={cur ? 'step' : undefined}>
            <button
              type="button"
              disabled={!done || !onSelect}
              onClick={() => onSelect?.(n)}
              className={cn(
                'flex size-8 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                done && 'border-transparent bg-accent text-white cursor-pointer',
                cur && 'border-accent bg-surface text-accent',
                !done && !cur && 'border-border bg-surface text-text-muted'
              )}
            >
              {done ? <Check className="size-4" /> : n}
            </button>
            <span className={cn('hidden max-w-[110px] text-xs font-medium leading-tight sm:block', cur ? 'text-text-primary' : 'text-text-muted')}>
              {s.title}
            </span>
          </li>
        );
      })}
    </ol>
  );
};
