import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PageHeaderCrumb {
  label: string;
  /** Omit for the current (last) crumb. */
  to?: string;
}

export interface PageHeaderProps {
  /** Muted trail above the title, e.g. [{label:'Invoices', to:'/acme/invoices'}, {label:'INV-0001'}]. */
  breadcrumb?: PageHeaderCrumb[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Lucide icon element, rendered inside a tinted rounded square. */
  icon?: React.ReactNode;
  /** Right-aligned buttons / menus. */
  actions?: React.ReactNode;
  /** Chips / pills shown beside the title. */
  meta?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  breadcrumb,
  title,
  subtitle,
  icon,
  actions,
  meta,
  className,
}) => (
  <header className={cn('flex flex-col gap-2 shrink-0', className)}>
    {breadcrumb && breadcrumb.length > 0 && (
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        {breadcrumb.map((c, i) => (
          <React.Fragment key={`${c.label}-${i}`}>
            {i > 0 && <ChevronRight className="size-3 text-text-muted/70" />}
            {c.to ? (
              <Link to={c.to} className="hover:text-text-primary transition-colors rounded-sm focus-visible:outline-2 outline-accent">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-text-secondary">
                {c.label}
              </span>
            )}
          </React.Fragment>
        ))}
      </nav>
    )}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent [&>svg]:size-5">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary leading-tight truncate">{title}</h1>
            {meta && <div className="flex flex-wrap items-center gap-1.5">{meta}</div>}
          </div>
          {subtitle && <p className="text-[13px] text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </header>
);
