import React from 'react';
import { CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The single white statement card every report sits in. */
export const ReportCard: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cn('bg-surface border border-border rounded-lg p-4 sm:p-6 w-full overflow-x-auto', className)}>
    {children}
  </div>
);

/** Bold title above a group of rows (Assets, Revenue, ...). */
export const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <div className="flex items-center justify-between px-2 pb-1 pt-4 text-[13px] font-semibold text-text-primary">
    <span>{children}</span>
    {right}
  </div>
);

export const moneyFmt = (cur: string) => (n: number) => formatMoney(n, cur, { parenthesesNegative: true });
export const tone = (n: number) => (n < 0 ? 'text-danger' : 'text-text-primary');

/** Emphasised subtotal / total row. `big` draws the heavy top and bottom rule. */
export const TotalLine: React.FC<{
  label: React.ReactNode;
  value: number;
  money: (n: number) => string;
  big?: boolean;
  note?: React.ReactNode;
  colored?: boolean;
}> = ({ label, value, money, big, note, colored = true }) => (
  <div
    className={cn(
      'flex items-baseline justify-between gap-3 px-2 border-t border-border font-semibold',
      big ? 'text-sm border-t border-text-primary border-b-[3px] border-double py-2.5 mt-1' : 'text-[13px] py-2'
    )}
  >
    <span className="text-text-primary">
      {label}
      {note && <span className="ml-2 font-normal text-text-muted text-xs">{note}</span>}
    </span>
    <span className={cn('tabular-nums', colored ? tone(value) : 'text-text-primary')}>{money(value)}</span>
  </div>
);

/** Clickable line: label (with optional code) and an amount. */
export const StatementLine: React.FC<{
  code?: string;
  label: React.ReactNode;
  value: number;
  money: (n: number) => string;
  onClick?: () => void;
  indent?: boolean;
  muted?: boolean;
  title?: string;
}> = ({ code, label, value, money, onClick, indent, muted, title }) => (
  <div
    role={onClick ? 'link' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    title={onClick ? title ?? 'View transactions' : undefined}
    className={cn(
      'flex items-baseline justify-between gap-3 px-2 py-1.5 text-xs group',
      onClick && 'cursor-pointer hover:bg-canvas rounded-md focus-visible:outline-2 outline-accent',
      indent && 'pl-6'
    )}
  >
    <span className={cn(muted ? 'text-text-secondary' : 'text-text-primary', onClick && 'group-hover:text-accent group-hover:underline')}>
      {code && <span className="font-code text-text-muted mr-2">{code}</span>}
      {label}
    </span>
    <span className={cn('tabular-nums', tone(value))}>{money(value)}</span>
  </div>
);

/** Green "balanced" or red "off by X" tag. Never hides a difference. */
export const CheckBadge: React.FC<{ ok: boolean; okLabel: string; badLabel: string; className?: string }> = ({
  ok,
  okLabel,
  badLabel,
  className,
}) => (
  <span
    role="status"
    className={cn(
      'inline-flex items-center gap-1.5 rounded-[3px] px-2 h-6 text-xs font-medium',
      ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
      className
    )}
  >
    {ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
    {ok ? okLabel : badLabel}
  </span>
);

export interface SegOption<T extends string> {
  value: T;
  label: string;
}
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex p-0.5 rounded-md bg-surface-neutral">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 px-3 text-xs font-medium rounded-[4px] cursor-pointer transition-colors',
            value === o.value ? 'bg-surface text-text-primary' : 'text-text-muted hover:text-text-primary'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const selectClass =
  'h-8 pl-2.5 pr-7 rounded-md border border-border bg-surface text-xs text-text-primary appearance-none cursor-pointer hover:border-border-strong focus:outline-none focus:border-accent transition-colors';

export const SelectBox: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className, children, ...rest }) => (
  <span className="relative inline-flex items-center">
    <select {...rest} className={cn(selectClass, className)}>
      {children}
    </select>
    <ChevronDown className="size-3.5 text-text-muted absolute right-2 pointer-events-none" />
  </span>
);

export const CheckToggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string; children: React.ReactNode }> = ({
  checked,
  onChange,
  disabled,
  title,
  children,
}) => (
  <label
    title={title}
    className={cn('flex items-center gap-2 text-xs select-none', disabled ? 'text-text-muted' : 'cursor-pointer text-text-primary')}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="rounded border-border text-accent focus:ring-accent"
    />
    {children}
  </label>
);

/** Small figure panel used by the VAT return, aging summary, etc. `icon` and `tint` are accepted for older callers and not drawn. */
export const KpiCard: React.FC<{
  icon?: React.ReactNode;
  tint?: 'accent' | 'success' | 'warning' | 'danger' | 'violet';
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}> = ({ label, value, hint, valueClass }) => (
  <div className="bg-surface border border-border rounded-lg px-4 py-3 min-w-0">
    <div className="text-xs text-text-muted">{label}</div>
    <div className={cn('mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary truncate', valueClass)}>{value}</div>
    {hint && <div className="text-xs text-text-muted mt-0.5">{hint}</div>}
  </div>
);

export const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
