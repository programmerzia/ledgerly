import React, { useMemo } from 'react';
import { ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { BankAccount } from '@/types';
import { formatMoney } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface Props {
  bank: BankAccount;
  bookBalance: number;
  toReconcile: number;
  balanceAt: (iso: string) => number;
  onOpen: () => void;
  onReconcile: () => void;
}

/** Small 30-day balance trend, no axes. */
const Sparkline: React.FC<{ values: number[] }> = ({ values }) => {
  const w = 120;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = React.useId().replace(/:/g, '');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-[120px]" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export const BankAccountCard: React.FC<Props> = ({ bank, bookBalance, toReconcile, balanceAt, onOpen, onReconcile }) => {
  const series = useMemo(() => {
    const out: number[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      out.push(balanceAt(d.toISOString().slice(0, 10)));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceAt, bookBalance]);

  const diff = bank.last_statement_balance - bookBalance;
  const matches = diff === 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-col gap-5 rounded-xl border border-border bg-surface p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={bank.bank_name} size="lg" square />
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-text-primary">{bank.name}</h3>
            <div className="text-xs text-text-muted">
              {bank.bank_name} <span className="mx-0.5">·</span>
              <span className="font-mono tracking-wide">{bank.account_number_masked}</span>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-border bg-surface-neutral px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
          {bank.currency}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-text-muted">Balance in your books</div>
          <div className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight text-text-primary">
            {formatMoney(bookBalance, bank.currency)}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <Sparkline values={series} />
          <span className="text-[11px] text-text-muted">Last 30 days</span>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-surface-neutral/70 px-3 py-2 text-xs">
        <div>
          <span className="text-text-muted">Bank statement </span>
          <span className="font-medium tabular-nums text-text-primary">{formatMoney(bank.last_statement_balance, bank.currency)}</span>
        </div>
        <div className={cn('flex items-center gap-1 font-medium tabular-nums', matches ? 'text-success' : 'text-warning')}>
          {matches ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
          {matches ? 'Matches books' : `Difference ${formatMoney(Math.abs(diff), bank.currency)}`}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        {toReconcile > 0 ? (
          <span className="text-xs font-medium text-warning">{toReconcile} to reconcile</span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-success">
            <CheckCircle2 className="size-3.5" /> All reconciled
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReconcile();
          }}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition',
            toReconcile > 0
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'border border-border bg-surface text-text-primary hover:bg-surface-neutral'
          )}
        >
          {toReconcile > 0 ? `Reconcile ${toReconcile}` : 'Review'}
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
};
