import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronRight, X, ExternalLink, FileText, Copy, LifeBuoy } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { NavSection } from './nav';

/** The Ledgerly mark: a ledger page with its money column ruled off. */
export const BrandMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-6 shrink-0 text-text-primary', className)}>
    <rect x="3.5" y="2.5" width="17" height="19" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M14.5 2.5v19M6.5 7.5h5M6.5 11h5M6.5 14.5h5M16.5 16.5h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M16.5 18.8h2" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

interface Props {
  sections: NavSection[];
  coSlug: string;
  pathname: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  navigate: (to: string) => void;
  openTab: (t: { id: string; title: string; url: string; type: 'navigation' }) => void;
}

export const Sidebar: React.FC<Props> = ({ sections, coSlug, pathname, collapsed, mobileOpen, onCloseMobile, navigate, openTab }) => {
  const isItemActive = (to: string) => pathname === to || pathname.startsWith(to + '/');

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('ledgerly_nav_collapsed');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { accounting: true, settings: true };
  });
  const toggleSection = (id: string) =>
    setCollapsedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem('ledgerly_nav_collapsed', JSON.stringify(next));
      return next;
    });

  // On mobile the drawer is always expanded.
  const mini = collapsed;

  return (
    <aside
      className={cn(
        'bg-sidebar border-r border-border flex flex-col shrink-0 select-none overflow-hidden',
        'transition-[width,transform] duration-200 ease-out motion-reduce:transition-none',
        'fixed inset-y-0 left-0 z-50 w-64 shadow-2xl lg:shadow-none lg:static lg:z-20',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        mini ? 'lg:w-16' : 'lg:w-64'
      )}
    >
      {/* Brand */}
      <div className={cn('h-14 shrink-0 flex items-center gap-2.5 border-b border-border px-4', mini && 'lg:justify-center lg:px-0')}>
        <button type="button" onClick={() => navigate(`/${coSlug}/dashboard`)} className="flex items-center gap-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-md" aria-label="Ledgerly home">
          <BrandMark />
          <span className={cn('text-[15px] font-semibold text-text-primary', mini && 'lg:hidden')}>Ledgerly</span>
        </button>
        <button type="button" onClick={onCloseMobile} aria-label="Close menu" className="lg:hidden ml-auto size-8 grid place-items-center rounded-lg text-text-muted hover:bg-surface-neutral cursor-pointer">
          <X className="size-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-3 flex flex-col gap-1" aria-label="Primary">
        {sections.map((sec) => {
          const hasActive = sec.items.some((i) => isItemActive(i.to));
          const isOpen = !sec.title || hasActive || !collapsedSections[sec.id];
          return (
            <div key={sec.id} className="flex flex-col gap-0.5">
              {sec.title && (
                mini ? (
                  <div className="hidden lg:block h-px bg-border mx-2 my-2" />
                ) : null
              )}
              {sec.title && (
                <button
                  type="button"
                  onClick={() => toggleSection(sec.id)}
                  aria-expanded={isOpen}
                  className={cn('px-2 pt-4 pb-1 flex items-center justify-between text-xs font-medium text-text-muted hover:text-text-primary transition cursor-pointer', mini && 'lg:hidden')}
                >
                  <span>{sec.title}</span>
                  <ChevronRight className={cn('size-3 transition-transform duration-200', isOpen && 'rotate-90')} />
                </button>
              )}
              {(isOpen || mini) && sec.items.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(item.to);
                const link = (
                  <NavLink
                    to={item.to}
                    aria-label={item.label}
                    className={cn(
                      'group relative flex items-center gap-2.5 h-8 px-2 rounded-md text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                      active ? 'bg-surface text-text-primary font-medium shadow-[0_0_0_1px_var(--border)]' : 'text-text-secondary hover:bg-surface-neutral hover:text-text-primary',
                      mini && 'lg:justify-center lg:px-0'
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0 transition-colors', active ? 'text-text-primary' : 'text-text-muted group-hover:text-text-secondary')} />
                    <span className={cn('truncate flex-1', mini && 'lg:hidden')}>{item.label}</span>
                    {item.badge !== undefined && (
                      <span className={cn('min-w-5 h-[18px] px-1.5 grid place-items-center rounded-sm bg-surface-neutral text-text-secondary text-[11px] font-medium', mini && 'lg:absolute lg:top-0 lg:right-1 lg:min-w-4 lg:h-4 lg:px-1 lg:text-[10px] lg:bg-accent lg:text-white')}>
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                );
                return (
                  <ContextMenu key={item.to}>
                    <ContextMenuTrigger asChild>
                      {mini ? (
                        <div>
                          <Tooltip>
                            <TooltipTrigger asChild>{link}</TooltipTrigger>
                            <TooltipContent side="right" sideOffset={10}>{item.label}</TooltipContent>
                          </Tooltip>
                        </div>
                      ) : link}
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => navigate(item.to)}>
                        <ExternalLink className="mr-2 h-3.5 w-3.5" /><span>Open {item.label}</span>
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => {
                          openTab({ id: `tab-${item.label.toLowerCase().replace(/\s+/g, '-')}`, title: item.label, url: item.to, type: 'navigation' });
                          navigate(item.to);
                        }}
                      >
                        <FileText className="mr-2 h-3.5 w-3.5" /><span>Open in New Tab</span>
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => navigator.clipboard.writeText(window.location.origin + item.to)}>
                        <Copy className="mr-2 h-3.5 w-3.5" /><span>Copy Link</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Help: a plain link, like the rest of the nav. Profile and sign-out live in the user menu. */}
      <div className="shrink-0 p-3 border-t border-border">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => navigate(`/${coSlug}/onboarding`)}
              className={cn('w-full flex items-center gap-2.5 h-8 px-2 rounded-md text-[13px] text-text-secondary hover:bg-surface-neutral hover:text-text-primary transition cursor-pointer', mini && 'lg:justify-center lg:px-0')}
            >
              <LifeBuoy className="size-4 shrink-0 text-text-muted" />
              <span className={cn(mini && 'lg:hidden')}>Help and setup guide</span>
            </button>
          </TooltipTrigger>
          {mini && <TooltipContent side="right" sideOffset={10}>Help and setup guide</TooltipContent>}
        </Tooltip>
      </div>
    </aside>
  );
};
