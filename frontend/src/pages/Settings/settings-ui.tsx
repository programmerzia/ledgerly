import React from 'react';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { cn } from '@/lib/utils';

export const inputCls =
  'h-9 px-3 rounded-md border border-border bg-surface text-[13px] text-text-primary transition-colors focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

/** A grouped settings card: title, helper text, divided body. */
export const SettingsCard: React.FC<{
  /** Accepted for older callers and not rendered. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ title, description, children, className }) => (
  <section className={cn('rounded-lg border border-border bg-surface', className)}>
    <div className="border-b border-border px-5 py-4">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-text-muted">{description}</p>}
    </div>
    <div className="p-5">{children}</div>
  </section>
);

export const FieldGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">{children}</div>
);

/** Label + control + inline help line. */
export const Field: React.FC<{
  label: string;
  help?: string;
  example?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, help, example, hint, children }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <label className="flex items-center text-[13px] font-medium text-text-primary">
      {label}
      {help && <FieldHelp help={help} example={example} />}
    </label>
    {children}
    {hint && <span className="text-xs text-text-muted">{hint}</span>}
  </div>
);
