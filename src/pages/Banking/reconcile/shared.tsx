import React from 'react';
import { cn } from '@/lib/utils';
import type { Account, BankStatementLine, Dimension } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Accounts that can be coded straight from a bank line (no control / bank / cash accounts). */
export const codableAccounts = (accounts: Account[]) =>
  accounts.filter((a) => a.is_active && a.is_postable && a.control_type === 'none');

const NONE = '__none__';

export const Field: React.FC<{ label: string; hint?: string; className?: string; children: React.ReactNode }> = ({
  label,
  hint,
  className,
  children,
}) => (
  <label className={cn('flex min-w-0 flex-col gap-1', className)}>
    <span className="text-[11px] font-medium text-text-muted">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
  </label>
);

export const inputCls =
  'h-8 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-primary shadow-sm outline-none placeholder:text-text-muted hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-[var(--ring)]';

/** Select with an optional "none" choice (Radix forbids empty-string item values). */
export const SimpleSelect: React.FC<{
  value?: string;
  onChange: (v: string | undefined) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  noneLabel?: string;
  allowNone?: boolean;
  'aria-label'?: string;
}> = ({ value, onChange, options, placeholder = 'Select...', noneLabel = 'None', allowNone = true, ...rest }) => (
  <Select value={value ?? (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
    <SelectTrigger aria-label={rest['aria-label']}>
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const Segmented: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
}> = ({ value, onChange, options }) => (
  <div className="inline-flex rounded-lg bg-surface-neutral p-0.5" role="radiogroup">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        disabled={o.disabled}
        title={o.title}
        onClick={() => onChange(o.value)}
        className={cn(
          'h-7 rounded-md px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
          value === o.value ? 'bg-surface-elevated text-text-primary shadow-xs' : 'text-text-muted hover:text-text-primary'
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const dimOptions = (dimensions: Dimension[], code: string) =>
  (dimensions.find((d) => d.code === code)?.values ?? [])
    .filter((v) => v.is_active)
    .map((v) => ({ value: v.code, label: `${v.code} · ${v.name}` }));

/** A short, sensible keyword for a rule from a statement line (longest alphabetic word). */
export function suggestKeyword(line: Pick<BankStatementLine, 'description' | 'counterparty'>): string {
  const words = line.description
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length >= 4 && !['MONTHLY', 'TRANSFER', 'PAYMENT', 'FROM', 'WIRE', 'REF'].includes(w.toUpperCase()));
  if (words.length === 0) return (line.counterparty || line.description).slice(0, 20).toUpperCase();
  return words.sort((a, b) => b.length - a.length)[0].toUpperCase();
}
