import React from 'react';
import { Avatar as UiAvatar } from '@/components/ui/avatar';

export const Card: React.FC<{ className?: string; children: React.ReactNode; index?: number }> = ({ className = '', children, index = 0 }) => (
  <section
    className={`dash-card bg-surface border border-border rounded-xl shadow-sm min-w-0 ${className}`}
    style={{ animationDelay: `${index * 40}ms` }}
  >
    {children}
  </section>
);

export const CardHeader: React.FC<{ title: string; sub?: string; right?: React.ReactNode }> = ({ title, sub, right }) => (
  <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
    <div className="min-w-0">
      <h2 className="text-[15px] font-semibold text-text-primary tracking-tight">{title}</h2>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
    {right}
  </div>
);

export const Avatar: React.FC<{ name: string; size?: number }> = ({ name, size = 28 }) => (
  <UiAvatar name={name} size={size >= 36 ? 'lg' : size >= 30 ? 'md' : 'sm'} className={size === 28 ? 'size-7 text-[11px]' : undefined} />
);
