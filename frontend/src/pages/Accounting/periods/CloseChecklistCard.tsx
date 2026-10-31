import React from 'react';
import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Check {
  id: string;
  check_code: string;
  title: string;
  detail: string;
  status: string;
}

interface Props {
  checks: Check[];
  onFix: (check: Check) => void;
}

/** Month-end checklist as a progress card with pass/fail rows. */
export const CloseChecklistCard: React.FC<Props> = ({ checks, onFix }) => {
  const passed = checks.filter((c) => c.status === 'pass').length;
  const pct = checks.length ? Math.round((passed / checks.length) * 100) : 0;
  const done = passed === checks.length && checks.length > 0;
  return (
    <section className="rounded-xl border border-border bg-surface shadow-card" aria-label="Month-end checklist">
      <div className="border-b border-border p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text-primary">Before you close this month</h2>
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', done ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>
            {passed} of {checks.length} ready
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-neutral" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full rounded-full transition-all duration-500 ease-out', done ? 'bg-success' : 'bg-accent')} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="divide-y divide-border">
        {checks.map((chk) => {
          const ok = chk.status === 'pass';
          return (
            <li key={chk.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="flex items-start gap-3">
                <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
                  {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                </span>
                <div>
                  <div className="text-[13px] font-medium text-text-primary">{chk.title}</div>
                  <div className="mt-0.5 text-xs text-text-muted">{chk.detail}</div>
                </div>
              </div>
              {!ok && (
                <button
                  type="button"
                  onClick={() => onFix(chk)}
                  className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-primary transition hover:bg-surface-neutral"
                >
                  Fix it <ArrowRight className="size-3.5 text-accent" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
