import React from 'react';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { cn } from '@/lib/utils';

export const inputCls =
  'h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

/** A grouped settings card: icon tile, title, helper text, divided body. */
export const SettingsCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ icon, title, description, children, className }) => (
  <section className={cn('rounded-xl border border-border bg-surface shadow-card', className)}>
    <div className="flex items-start gap-3 border-b border-border px-5 py-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&>svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-text-muted">{description}</p>}
      </div>
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
