import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronRight, X, ExternalLink, FileText, Copy, LogOut, LifeBuoy } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { NavSection } from './nav';
import { UserAvatar } from './UserMenu';

export const BrandMark: React.FC<{ className?: string }> = ({ className }) => (
  <span className={cn('size-8 shrink-0 grid place-items-center rounded-lg bg-gradient-to-br from-accent to-violet text-white font-bold text-sm shadow-sm ring-1 ring-white/10', className)}>L</span>
);

interface Props {
  sections: NavSection[];
  coSlug: string;
  pathname: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  user: { name: string; avatar?: string; roleTitle: string };
  navigate: (to: string) => void;
  openTab: (t: { id: string; title: string; url: string; type: 'navigation' }) => void;
  onSignOut: () => void;
}

export const Sidebar: React.FC<Props> = ({ sections, coSlug, pathname, collapsed, mobileOpen, onCloseMobile, user, navigate, openTab, onSignOut }) => {
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
        <button type="button" onClick={() => navigate(`/${coSlug}/dashboard`)} className="flex items-center gap-2.5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-lg" aria-label="Ledgerly home">
          <BrandMark />
          <span className={cn('text-[15px] font-semibold tracking-tight text-text-primary', mini && 'lg:hidden')}>Ledgerly</span>
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
                  className={cn('px-2.5 pt-3 pb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-text-muted hover:text-text-primary transition cursor-pointer', mini && 'lg:hidden')}
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
                      'group relative flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                      active ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:bg-surface-neutral hover:text-text-primary',
                      mini && 'lg:justify-center lg:px-0'
                    )}
                  >
                    {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
                    <Icon className={cn('size-4 shrink-0 transition-colors', active ? 'text-accent' : 'text-text-muted group-hover:text-text-primary')} />
                    <span className={cn('truncate flex-1', mini && 'lg:hidden')}>{item.label}</span>
                    {item.badge !== undefined && (
                      <span className={cn('min-w-5 h-5 px-1.5 grid place-items-center rounded-full bg-warning-soft text-warning text-[11px] font-semibold', mini && 'lg:absolute lg:top-0.5 lg:right-1.5 lg:min-w-4 lg:h-4 lg:px-1 lg:text-[10px]')}>
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

      {/* Help card + user */}
      <div className="shrink-0 p-3 border-t border-border flex flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate(`/${coSlug}/onboarding`)}
          className={cn('group text-left rounded-xl border border-border bg-surface p-3 hover:border-border-strong hover:shadow-sm transition cursor-pointer', mini && 'lg:hidden')}
        >
          <span className="flex items-center gap-2">
            <span className="size-7 grid place-items-center rounded-lg bg-violet-soft text-violet"><LifeBuoy className="size-4" /></span>
            <span className="text-[13px] font-semibold text-text-primary">Need a hand?</span>
          </span>
          <span className="block text-xs text-text-muted mt-1.5 [@media(max-height:820px)]:hidden">Open the guided tour to learn the essentials in two minutes.</span>
          <span className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium text-accent group-hover:gap-1.5 transition-all">Open guided tour <ChevronRight className="size-3" /></span>
        </button>
        {mini && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => navigate(`/${coSlug}/onboarding`)} aria-label="Open guided tour" className="hidden lg:grid size-9 mx-auto place-items-center rounded-lg text-violet hover:bg-violet-soft transition cursor-pointer">
                <LifeBuoy className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>Need a hand? Open guided tour</TooltipContent>
          </Tooltip>
        )}

        <div className={cn('flex items-center gap-2.5', mini && 'lg:flex-col')}>
          <UserAvatar initials={user.avatar} />
          <div className={cn('min-w-0 flex-1 leading-tight', mini && 'lg:hidden')}>
            <div className="text-[13px] font-medium text-text-primary truncate">{user.name}</div>
            <div className="text-[11px] text-text-muted truncate">{user.roleTitle}</div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onSignOut} aria-label="Sign out" className="size-8 grid place-items-center rounded-lg text-text-muted hover:text-danger hover:bg-danger-soft transition cursor-pointer">
                <LogOut className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Sign out</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
};
