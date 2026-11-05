import React from 'react';
import {
  PanelLeftClose, PanelLeftOpen, Menu, ChevronDown, Check, Search, Plus, FileSpreadsheet, FileText, Receipt,
  BookMarked, UserPlus, Truck, Settings2, ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IS_LIVE } from '@/api/config';
import type { UIRowDensity } from '@/mock/store';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ThemeSwitcher } from './ThemeSwitcher';
import { NotificationsMenu, type AppNotification } from './NotificationsMenu';
import { UserMenu } from './UserMenu';
import { toast } from 'sonner';
import { describeError } from '@/api/messages';
import { useCompanyList } from '@/data/session';
import { TopBarClock, FullscreenToggle, SyncIndicator, ICON_BTN } from './TopBarWidgets';

export interface TopBarProps {
  coSlug: string;
  company: { id: string; name: string; base_currency: string };
  period: { name: string; status: string };
  user: { id: string; name: string; avatar?: string; roleTitle: string };
  sidebarCollapsed: boolean;
  mobileMenuOpen: boolean;
  onToggleSidebar: () => void;
  onOpenCommand: () => void;
  navigate: (to: string) => void;
  theme: { currentTheme: string; isDark: boolean; applyTheme: (t: string) => void; toggleTheme: () => void };
  uiDensity: UIRowDensity;
  setUiDensity: (d: UIRowDensity) => void;
  isOffline: boolean;
  isSyncing: boolean;
  outboxCount: number;
  onToggleOffline: () => void;
  notifications: AppNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  switchUser: (id: string) => void;
  onShortcuts: () => void;
  onSignOut: () => void;
}

export const TopBar: React.FC<TopBarProps> = (p) => {
  const { coSlug, navigate } = p;
  const { companies, organisations, canCreateCompany, switchCompany, switchOrganisation } = useCompanyList();
  const periodShort = p.period.name.replace(/^(\w{3})\w*\s+(\d{4})$/, '$1 $2');
  const periodStatus = p.period.status.charAt(0).toUpperCase() + p.period.status.slice(1);
  const periodTone = p.period.status === 'open' ? 'bg-success' : p.period.status === 'closed' ? 'bg-danger' : 'bg-warning';

  const newItems = [
    { label: 'Invoice', to: `/${coSlug}/invoices/new`, icon: FileSpreadsheet, hint: 'N' },
    { label: 'Bill', to: `/${coSlug}/bills/new`, icon: FileText, hint: 'G B' },
    { label: 'Receive payment', to: `/${coSlug}/receipts/new`, icon: Receipt },
    { label: 'Journal', to: `/${coSlug}/journals/new`, icon: BookMarked, hint: 'G J' },
    { label: 'Customer', to: `/${coSlug}/customers`, icon: UserPlus },
    { label: 'Supplier', to: `/${coSlug}/suppliers`, icon: Truck },
  ];

  return (
    <header className="h-12 bg-surface border-b border-border px-3 sm:px-4 flex items-center gap-2 shrink-0 z-30 select-none">
      {/* Left cluster */}
      <div className="flex items-center gap-1.5 min-w-0 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={p.onToggleSidebar} aria-label="Toggle navigation" className={ICON_BTN}>
              <span className="lg:hidden">{p.mobileMenuOpen ? <PanelLeftClose className="size-4" /> : <Menu className="size-4" />}</span>
              <span className="hidden lg:inline">{p.sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent shortcut="[">Toggle navigation</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-surface-neutral transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer">
              <span className="hidden sm:block text-[13px] font-medium text-text-primary max-w-[180px] truncate">{p.company.name}</span>
              <span className="hidden sm:inline text-xs text-text-muted">{p.company.base_currency}</span>
              <ChevronDown className="size-3.5 text-text-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} className="w-72">
            <DropdownMenuLabel>Companies</DropdownMenuLabel>
            {companies.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => { switchCompany(c.id); navigate(`/${c.slug}/dashboard`); }} className="h-auto py-1.5 gap-3">
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium truncate">{c.name}</span>
                  <span className="text-[11px] text-text-muted">{c.meta} · {c.currency}</span>
                </span>
                {p.company.id === c.id && <Check className="size-4 text-accent" />}
              </DropdownMenuItem>
            ))}
            {organisations.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Organisations</DropdownMenuLabel>
                {organisations.map((o) => (
                  <DropdownMenuItem key={o.id} onSelect={() => {
                    if (o.current) return;
                    // The server starts a new session for the new organisation, so a signing approval given before is gone.
                    void switchOrganisation(o.id)
                      .then(() => { navigate('/'); toast.success(`Switched to ${o.name}. Your signing approval was cleared; you will be asked for your PIN again.`); })
                      .catch((e: unknown) => toast.error(describeError(e)));
                  }} className="gap-3">
                    <span className="flex-1 truncate font-medium">{o.name}</span>
                    {o.current && <Check className="size-4 text-accent" />}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            {IS_LIVE ? (
              canCreateCompany && <DropdownMenuItem onSelect={() => navigate('/new-company')}><Plus className="size-4 text-text-muted" />New company</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => navigate(`/${coSlug}/settings`)}><Settings2 className="size-4 text-text-muted" />Manage companies</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {!IS_LIVE && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="hidden md:flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-surface-neutral transition text-xs text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer">
              <span className={cn('size-1.5 rounded-full', periodTone)} />
              {periodShort} · {periodStatus}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={8} className="w-72 p-3">
            <div>
              <div>
                <div className="text-sm font-semibold text-text-primary">{p.period.name}</div>
                <div className="flex items-center gap-1.5 text-xs text-text-muted"><span className={cn('size-1.5 rounded-full', periodTone)} />Posting {p.period.status}</div>
              </div>
            </div>
            <p className="text-xs text-text-muted mt-3">Documents dated in this period post to the ledger. Closed periods reject new postings.</p>
            <button type="button" onClick={() => navigate(`/${coSlug}/periods`)} className="mt-3 w-full h-8 rounded-md border border-border hover:bg-surface-neutral text-xs font-medium text-text-primary flex items-center justify-center gap-1 transition cursor-pointer">
              Periods &amp; close <ArrowUpRight className="size-3.5" />
            </button>
          </PopoverContent>
        </Popover>
        )}
      </div>

      {/* Center search */}
      <div className="flex-1 flex justify-center min-w-0">
        <button
          type="button"
          onClick={p.onOpenCommand}
          aria-label="Search or jump to"
          className="hidden sm:flex w-full max-w-md items-center gap-2 h-8 px-2.5 rounded-md border border-border bg-canvas hover:border-border-strong text-text-muted transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
        >
          <Search className="size-4" />
          <span className="text-[13px] flex-1 text-left truncate">Search</span>
          <kbd className="font-sans text-[11px] text-text-muted">⌘K</kbd>
        </button>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-0.5 shrink-0 ml-auto sm:ml-0">
        <button type="button" onClick={p.onOpenCommand} aria-label="Search" className={cn(ICON_BTN, 'sm:hidden')}><Search className="size-4" /></button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="hidden sm:flex items-center gap-1 h-8 pl-2.5 pr-2 mr-1 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface cursor-pointer">
              <Plus className="size-4" /> New
              <ChevronDown className="size-3.5 opacity-80 border-l border-white/25 pl-1 box-content" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-56">
            <DropdownMenuLabel>Create</DropdownMenuLabel>
            {newItems.map((m) => (
              <DropdownMenuItem key={m.label} onSelect={() => navigate(m.to)}>
                <m.icon className="size-4 text-text-muted" />{m.label}
                {m.hint && <DropdownMenuShortcut>{m.hint}</DropdownMenuShortcut>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <TopBarClock periodName={IS_LIVE ? '' : p.period.name} />
        <SyncIndicator isOffline={p.isOffline} isSyncing={p.isSyncing} outboxCount={p.outboxCount} onToggle={p.onToggleOffline} />
        <ThemeSwitcher currentTheme={p.theme.currentTheme} isDark={p.theme.isDark} applyTheme={p.theme.applyTheme} uiDensity={p.uiDensity} setUiDensity={p.setUiDensity} />
        <FullscreenToggle />
        <NotificationsMenu notifications={p.notifications} setNotifications={p.setNotifications} onNavigate={navigate} />
        <span className="w-px h-6 bg-border mx-1.5 hidden sm:block" />
        <UserMenu
          user={p.user}
          isDark={p.theme.isDark}
          isOffline={p.isOffline}
          onToggleTheme={p.theme.toggleTheme}
          onToggleOffline={p.onToggleOffline}
          onSwitchUser={p.switchUser}
          onProfile={() => navigate(`/${coSlug}/settings`)}
          onShortcuts={p.onShortcuts}
          onAdmin={() => navigate('/admin')}
          onOrganisation={() => navigate('/org/settings')}
          onSignOut={p.onSignOut}
        />
      </div>
    </header>
  );
};
