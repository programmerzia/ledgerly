/**
 * Master Desktop Application Shell per 03_UI_Spec §10 and 08_Mock_Refactor_Prompt.md Block B & C,
 * polished for 09_Mock_Polish_Prompt.md Blocks 1 to 3.
 * Fixed 100vh frame, 40px top bar, document tabs, resizable panes, 24px bottom status bar,
 * offline indicator, digital clock, and Radix UI primitives layer (no transparent menus).
 */

import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useLedgerStore, UIRowDensity } from '@/mock/store';
import { useAdminStore } from '@/mock/store/adminStore';
import { CommandPalette } from '@/components/domain/CommandPalette';
import { DocumentTabStrip } from '@/components/domain/DocumentTabStrip';
import { BottomStatusBar } from '@/components/domain/BottomStatusBar';
import { ShortcutsOverlay } from '@/components/domain/ShortcutsOverlay';
import { ConflictDialog } from '@/components/domain/ConflictDialog';
import { UsabilityTracker } from '@/components/domain/UsabilityTracker';
import { shortcutRegistry } from '@/lib/shortcuts';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Receipt,
  CreditCard,
  BookMarked,
  BarChart3,
  CheckSquare,
  Settings,
  ChevronDown,
  Sun,
  Moon,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Building,
  ShieldCheck,
  Package,
  Layers,
  Coins,
  FileText,
  Calendar,
  CloudOff,
  Cloud,
  Clock,
  History,
  Check,
  Copy,
  ExternalLink,
  Bell,
  Palette,
  Rows3,
  LogOut,
  X,
  Menu,
} from 'lucide-react';

export const AppShell: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState('');

  const navigate = useNavigate();
  const location = useLocation();

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const {
    currentUser,
    currentCompany,
    currentPeriod,
    uiDensity,
    setUiDensity,
    isOffline,
    toggleOffline,
    outbox,
    switchUser,
    switchCompany,
    invoices,
    bills,
    journals,
    closeTab,
    nextTab,
    activeTabId,
    openTab,
    logoutUser,
  } = useLedgerStore();

  const activeImpersonation = useAdminStore((s) => s.activeImpersonation);

  const coSlug = currentCompany.slug;

  // Real-time clock (UTC)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' UTC'
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Register Global Keyboard Chords per Block C.2
  useEffect(() => {
    const unregister = shortcutRegistry.registerBatch([
      { id: 'chord-gd', key: 'g d', description: 'Go to Dashboard', scope: 'global', action: () => navigate(`/${coSlug}/dashboard`) },
      { id: 'chord-gi', key: 'g i', description: 'Go to Invoices', scope: 'global', action: () => navigate(`/${coSlug}/invoices`) },
      { id: 'chord-gb', key: 'g b', description: 'Go to Bills', scope: 'global', action: () => navigate(`/${coSlug}/bills`) },
      { id: 'chord-gj', key: 'g j', description: 'Go to Journals', scope: 'global', action: () => navigate(`/${coSlug}/journals`) },
      { id: 'chord-gr', key: 'g r', description: 'Go to Reports', scope: 'global', action: () => navigate(`/${coSlug}/reports/trial-balance`) },
      { id: 'chord-gp', key: 'g p', description: 'Go to Periods', scope: 'global', action: () => navigate(`/${coSlug}/periods`) },
      { id: 'chord-ga', key: 'g a', description: 'Go to Approvals', scope: 'global', action: () => navigate(`/${coSlug}/approvals`) },
      { id: 'shortcut-k', key: 'ctrl+k', description: 'Command Palette', scope: 'global', action: () => setIsCommandOpen((p) => !p) },
      { id: 'shortcut-w', key: 'ctrl+w', description: 'Close Tab', scope: 'global', action: () => closeTab(activeTabId) },
      { id: 'shortcut-tab', key: 'ctrl+tab', description: 'Next Tab', scope: 'global', action: () => nextTab() },
      { id: 'shortcut-n', key: 'n', description: 'New Document', scope: 'page', action: () => {
        if (location.pathname.includes('/invoices')) navigate(`/${coSlug}/invoices/new`);
        else if (location.pathname.includes('/bills')) navigate(`/${coSlug}/bills/new`);
        else if (location.pathname.includes('/journals')) navigate(`/${coSlug}/journals/new`);
      }},
      { id: 'shortcut-dark', key: 'ctrl+shift+d', description: 'Toggle Dark Mode', scope: 'global', action: () => toggleTheme() },
      { id: 'shortcut-settings', key: 'ctrl+,', description: 'Open Settings', scope: 'global', action: () => navigate(`/${coSlug}/settings`) },
    ]);

    return () => unregister();
  }, [coSlug, navigate, activeTabId, closeTab, nextTab, location.pathname]);

  const [currentTheme, setCurrentTheme] = useState(() => {
    return document.documentElement.getAttribute('data-theme') || localStorage.getItem('ledgerly_theme') || 'light';
  });

  const applyTheme = (themeName: string) => {
    setCurrentTheme(themeName);
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('ledgerly_theme', themeName);
  };

  const toggleTheme = () => {
    const isDark = currentTheme === 'dark' || currentTheme === 'midnight' || currentTheme === 'forest';
    applyTheme(isDark ? 'light' : 'dark');
  };

  const [notifications, setNotifications] = useState([
    {
      id: 'notif-1',
      title: 'Pending Approval Required',
      desc: 'Sales Invoice DRAFT-0043 requires manager sign-off ($4,200.00)',
      time: '12m ago',
      unread: true,
      link: `/${coSlug}/approvals`,
    },
    {
      id: 'notif-2',
      title: 'Fiscal Period Close',
      desc: 'October 2026 pre-closing checklist is 83% complete.',
      time: '1h ago',
      unread: true,
      link: `/${coSlug}/periods`,
    },
    {
      id: 'notif-3',
      title: 'Bank Statement Auto-Sync',
      desc: '12 unmatched statement lines imported for Premier Bank USD.',
      time: '3h ago',
      unread: true,
      link: `/${coSlug}/banking/bnk-1/reconcile`,
    },
  ]);

  const pendingApprovalsCount =
    invoices.filter((i) => i.status === 'pending_approval').length +
    bills.filter((b) => b.status === 'pending_approval').length +
    journals.filter((j) => j.status === 'pending_approval').length;

  const navSections = [
    {
      title: 'General',
      items: [
        { label: 'Dashboard', to: `/${coSlug}/dashboard`, icon: LayoutDashboard },
        {
          label: 'Approvals Inbox',
          to: `/${coSlug}/approvals`,
          icon: CheckSquare,
          badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
        },
      ],
    },
    {
      title: 'Sales & Revenue',
      items: [
        { label: 'Sales Invoices', to: `/${coSlug}/invoices`, icon: FileSpreadsheet },
        { label: 'Customers', to: `/${coSlug}/customers`, icon: Building },
        { label: 'Receive Money (Receipt)', to: `/${coSlug}/receipts/new`, icon: Receipt },
      ],
    },
    {
      title: 'Purchases & Payables',
      items: [
        { label: 'Bills (Supplier)', to: `/${coSlug}/bills`, icon: FileText },
        { label: 'Suppliers', to: `/${coSlug}/suppliers`, icon: Building },
        { label: 'Payment Run Wizard', to: `/${coSlug}/payment-run`, icon: Coins },
        { label: 'WHT Certificates', to: `/${coSlug}/wht-certificates`, icon: ShieldCheck },
      ],
    },
    {
      title: 'Banking & Treasury',
      items: [
        { label: 'Bank Accounts', to: `/${coSlug}/banking`, icon: CreditCard },
        { label: 'Bank Reconciliation', to: `/${coSlug}/banking/bnk-1/reconcile`, icon: ShieldCheck },
      ],
    },
    {
      title: 'General Ledger',
      items: [
        { label: 'Journals', to: `/${coSlug}/journals`, icon: BookMarked },
        { label: 'Chart of Accounts', to: `/${coSlug}/accounts`, icon: Layers },
        { label: 'Fiscal Periods', to: `/${coSlug}/periods`, icon: Calendar },
        { label: 'FX Rates & Revaluation', to: `/${coSlug}/fx-rates`, icon: Coins },
        { label: 'Fixed Assets', to: `/${coSlug}/assets`, icon: Package },
        { label: 'Budgets', to: `/${coSlug}/budgets`, icon: BarChart3 },
      ],
    },
    {
      title: 'Financial Reports',
      items: [
        { label: 'Trial Balance', to: `/${coSlug}/reports/trial-balance`, icon: BarChart3 },
        { label: 'Profit & Loss', to: `/${coSlug}/reports/profit-and-loss`, icon: BarChart3 },
        { label: 'Balance Sheet', to: `/${coSlug}/reports/balance-sheet`, icon: BarChart3 },
        { label: 'AR / AP Aging', to: `/${coSlug}/reports/aging`, icon: BarChart3 },
        { label: 'General Ledger Detail', to: `/${coSlug}/reports/general-ledger`, icon: BookMarked },
        { label: 'Tax Return (VAT)', to: `/${coSlug}/reports/tax-return`, icon: FileSpreadsheet },
      ],
    },
    {
      title: 'Settings & Audit',
      items: [
        { label: 'Company Settings', to: `/${coSlug}/settings`, icon: Settings },
        { label: 'Audit Log Trail', to: `/${coSlug}/audit-log`, icon: History },
      ],
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen max-h-screen overflow-hidden flex flex-col antialiased bg-canvas text-text-primary select-none font-sans">
        {/* Operator Impersonation Banner */}
        {activeImpersonation && (
          <div className="h-8 bg-warning-soft border-b border-warning/30 px-3 flex items-center justify-between text-xs text-warning font-medium z-40 select-none shrink-0">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-warning animate-pulse shrink-0" />
              <span>
                <strong>OPERATOR IMPERSONATION:</strong> Viewing as staff <span className="font-mono">{activeImpersonation.adminName}</span>.
                Mode: <span className="uppercase font-semibold">{activeImpersonation.mode}-only</span>. All tenant writes are blocked.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  useAdminStore.getState().endImpersonation();
                  navigate(`/admin/tenants/${activeImpersonation.tenantId}`);
                }}
                className="px-2 py-0.5 rounded bg-warning text-white font-medium hover:opacity-90 transition text-[11px] cursor-pointer"
              >
                Exit Impersonation
              </button>
            </div>
          </div>
        )}

        {/* 1. Title & Status Bar: Exactly 40px high per 03_UI_Spec §10 */}
        <header className="h-10 bg-surface-elevated border-b border-border px-2 sm:px-3 flex items-center justify-between shrink-0 z-30 select-none text-xs">
          {/* Left: Brand + Company Switcher + Period indicator */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (window.innerWidth < 1024) {
                      setMobileMenuOpen(!mobileMenuOpen);
                    } else {
                      setSidebarCollapsed(!sidebarCollapsed);
                    }
                  }}
                  className="p-1 text-text-muted hover:text-text-primary rounded-sm hover:bg-surface-neutral transition cursor-pointer"
                  aria-label="Toggle Navigation"
                >
                  <span className="lg:hidden">
                    {mobileMenuOpen ? <PanelLeftClose className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                  </span>
                  <span className="hidden lg:inline">
                    {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent shortcut="[">Toggle Navigation</TooltipContent>
            </Tooltip>

            {/* Logo */}
            <div
              onClick={() => navigate(`/${coSlug}/dashboard`)}
              className="flex items-center gap-1.5 cursor-pointer font-bold text-text-primary tracking-tight shrink-0"
            >
              <div className="w-5 h-5 rounded bg-accent flex items-center justify-center text-white font-extrabold text-[11px] shadow-xs">
                L
              </div>
              <span className="hidden sm:inline font-semibold">Ledgerly</span>
            </div>

            <span className="text-border hidden sm:inline">/</span>

            {/* Company Switcher via Radix DropdownMenu (Opaque, Portal-rendered) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 sm:gap-1.5 h-7 px-1.5 sm:px-2.5 rounded-sm border border-border hover:border-border-strong bg-surface font-medium text-text-primary transition outline-none focus:ring-1 focus:ring-accent shrink-0"
                >
                  <Building className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="max-w-[85px] sm:max-w-[130px] truncate">{currentCompany.name}</span>
                  <span className="hidden sm:inline text-[10px] font-mono text-text-muted bg-surface-neutral px-1 py-0.5 rounded">
                    {currentCompany.base_currency}
                  </span>
                  <ChevronDown className="w-3 h-3 text-text-muted opacity-60 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Switch Active Company</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    switchCompany('co-1');
                    navigate(`/acme/dashboard`);
                  }}
                  className="flex items-center justify-between"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">Acme Trading Ltd</span>
                    <span className="text-[10px] text-text-muted">Somalia (USD)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-text-muted">USD</span>
                    {currentCompany.id === 'co-1' && <Check className="w-3.5 h-3.5 text-accent" />}
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    switchCompany('co-2');
                    navigate(`/acme-log/dashboard`);
                  }}
                  className="flex items-center justify-between"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">Acme Logistics</span>
                    <span className="text-[10px] text-text-muted">Kenya (KES)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-text-muted">KES</span>
                    {currentCompany.id === 'co-2' && <Check className="w-3.5 h-3.5 text-accent" />}
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Active Period Badge */}
            <div
              onClick={() => navigate(`/${coSlug}/periods`)}
              className="hidden md:flex items-center gap-1.5 h-7 px-2.5 rounded-sm bg-surface border border-border cursor-pointer hover:bg-surface-neutral transition"
              title="Active posting period. Click to manage."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-text-secondary font-mono text-[11px]">
                {currentPeriod.name} ({currentPeriod.status})
              </span>
            </div>
          </div>

          {/* Center: Command Palette Trigger (420px wide per Block 3.1) */}
          <div className="hidden lg:flex items-center flex-1 max-w-[420px] mx-4">
            <button
              type="button"
              onClick={() => setIsCommandOpen(true)}
              className="w-full flex items-center justify-between h-7 px-2.5 rounded-sm border border-border bg-surface hover:bg-surface-neutral text-text-muted transition"
            >
              <div className="flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-text-muted" />
                <span className="text-xs">Search documents, accounts, contacts...</span>
              </div>
              <kbd className="font-mono text-[10px] bg-surface-neutral text-text-primary px-1.5 py-0.5 rounded border border-border">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Right: Online/Offline, Outbox, Clock, Density, Theme, User Switcher */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* Offline Toggle Simulation */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => toggleOffline()}
                  className={cn(
                    'flex items-center gap-1 h-7 px-1.5 sm:px-2 rounded-sm border transition text-[11px] font-mono shrink-0',
                    isOffline
                      ? 'bg-warning-soft border-warning text-warning font-semibold'
                      : 'bg-surface border-border text-text-muted hover:text-text-primary'
                  )}
                >
                  {isOffline ? <CloudOff className="w-3.5 h-3.5 text-warning shrink-0" /> : <Cloud className="w-3.5 h-3.5 text-success shrink-0" />}
                  <span className="hidden sm:inline">{isOffline ? 'Offline' : 'Online'}</span>
                  {outbox.length > 0 && (
                    <span className="bg-warning text-white px-1 sm:px-1.5 rounded-full text-[10px] font-bold">
                      {outbox.length}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>Simulate Offline Mode (IndexedDB Queue)</TooltipContent>
            </Tooltip>

            {/* UTC Clock */}
            <div className="hidden xl:flex items-center gap-1 text-[11px] font-mono text-text-muted px-1.5 h-7">
              <Clock className="w-3 h-3" />
              <span>{currentTime}</span>
            </div>

            {/* Density Selector (Clear Row Height control replacing ambiguous CDC) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="hidden md:flex items-center gap-1.5 h-7 px-2 rounded-sm border border-border hover:border-border-strong bg-surface text-text-muted hover:text-text-primary transition text-xs outline-none focus:ring-1 focus:ring-accent"
                  title="Table row height density"
                >
                  <Rows3 className="w-3.5 h-3.5 text-text-muted" />
                  <span className="capitalize font-medium text-[11px]">{uiDensity}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  Table Row Density
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setUiDensity('compact')}
                  className="flex items-center justify-between text-xs cursor-pointer"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">Compact</span>
                    <span className="text-[10px] text-text-muted">32px dense rows</span>
                  </div>
                  {uiDensity === 'compact' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setUiDensity('default')}
                  className="flex items-center justify-between text-xs cursor-pointer"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">Default</span>
                    <span className="text-[10px] text-text-muted">36px standard rows</span>
                  </div>
                  {uiDensity === 'default' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setUiDensity('comfortable')}
                  className="flex items-center justify-between text-xs cursor-pointer"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">Comfortable</span>
                    <span className="text-[10px] text-text-muted">42px relaxed rows</span>
                  </div>
                  {uiDensity === 'comfortable' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Notifications Center with interactive alert list */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-1.5 text-text-muted hover:text-text-primary rounded-sm hover:bg-surface-neutral transition relative outline-none focus:ring-1 focus:ring-accent"
                  title="Notifications"
                >
                  <Bell className="w-3.5 h-3.5" />
                  {notifications.some((n) => n.unread) && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-danger animate-pulse" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 p-0">
                <div className="px-3 py-2.5 border-b border-border flex items-center justify-between bg-surface-neutral/30">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-text-primary">Notifications</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-accent-soft text-accent font-bold">
                      {notifications.filter((n) => n.unread).length} new
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })))}
                    className="text-[11px] text-text-muted hover:text-accent font-medium transition"
                  >
                    Mark all read
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        setNotifications((prev) =>
                          prev.map((item) => (item.id === n.id ? { ...item, unread: false } : item))
                        );
                        navigate(n.link);
                      }}
                      className={cn(
                        'p-3 flex flex-col gap-1 cursor-pointer transition hover:bg-surface-neutral text-xs',
                        n.unread && 'bg-accent/5'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className={cn('font-semibold truncate', n.unread ? 'text-text-primary' : 'text-text-secondary')}>
                          {n.title}
                        </span>
                        <span className="text-[10px] text-text-muted font-mono shrink-0">{n.time}</span>
                      </div>
                      <p className="text-[11px] text-text-muted line-clamp-2 leading-tight">{n.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="p-2 border-t border-border bg-surface-neutral/20 text-center">
                  <button
                    type="button"
                    onClick={() => navigate(`/${coSlug}/approvals`)}
                    className="text-xs font-semibold text-accent hover:underline"
                  >
                    View Approvals Inbox →
                  </button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Multi-Color Theme Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-1.5 text-text-muted hover:text-text-primary rounded-sm hover:bg-surface-neutral transition outline-none focus:ring-1 focus:ring-accent"
                  title="Color Theme Palette"
                >
                  <Palette className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  Color Themes
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {[
                  { id: 'light', label: 'Light Clean', desc: 'Financial White', dot: 'bg-surface border border-border shadow-2xs' },
                  { id: 'dark', label: 'Dark Slate', desc: 'Charcoal Dark', dot: 'bg-surface-neutral border border-border' },
                  { id: 'midnight', label: 'Midnight Navy', desc: 'Bloomberg Blue', dot: 'bg-info border border-info/40' },
                  { id: 'forest', label: 'Forest Emerald', desc: 'Wealth Green', dot: 'bg-success border border-success/40' },
                  { id: 'sepia', label: 'Warm Sepia', desc: 'Ledger Paper', dot: 'bg-warning border border-warning/40' },
                ].map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => applyTheme(t.id)}
                    className="flex items-center justify-between text-xs cursor-pointer py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('w-3.5 h-3.5 rounded-full shrink-0', t.dot)} />
                      <div className="flex flex-col">
                        <span className="font-medium text-text-primary">{t.label}</span>
                        <span className="text-[10px] text-text-muted">{t.desc}</span>
                      </div>
                    </div>
                    {currentTheme === t.id && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* User Profile / Switcher via Radix DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 h-7 px-1.5 sm:px-2 rounded-sm border border-border hover:border-border-strong bg-surface text-text-primary transition outline-none focus:ring-1 focus:ring-accent shrink-0"
                >
                  <div className="w-4 h-4 rounded-full bg-accent text-white flex items-center justify-center font-bold text-[9px] shrink-0">
                    {currentUser.avatar}
                  </div>
                  <span className="hidden sm:inline max-w-[90px] truncate font-medium text-xs">{currentUser.name.split(' ')[0]}</span>
                  <ChevronDown className="w-3 h-3 text-text-muted opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <div className="px-2.5 py-2 border-b border-border bg-surface-neutral/40">
                  <div className="font-semibold text-text-primary text-xs">{currentUser.name}</div>
                  <div className="text-[11px] text-text-muted">{currentUser.roleTitle}</div>
                  <div className="text-[10px] font-mono text-accent mt-0.5 font-semibold">
                    Signing PIN: {currentUser.signingPin}
                  </div>
                </div>

                <DropdownMenuLabel>Switch Persona (Demo Script)</DropdownMenuLabel>
                <DropdownMenuSeparator />

                {[
                  { id: 'usr-1', name: 'Rahim Ahmed', role: 'Accountant (Maker)', pin: '112233' },
                  { id: 'usr-2', name: 'Fatima Hassan', role: 'Finance Manager (Checker)', pin: '246810' },
                  { id: 'usr-3', name: 'Kenneth Mwangi', role: 'CFO (Second Approver)', pin: '135790' },
                  { id: 'usr-4', name: 'Aisha Noor', role: 'Auditor (Read-Only)', pin: '998877' },
                ].map((u) => (
                  <DropdownMenuItem
                    key={u.id}
                    onClick={() => switchUser(u.id)}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-[10px] text-text-muted">{u.role}</div>
                    </div>
                    {u.id === currentUser.id && (
                      <span className="text-[10px] font-mono text-accent font-semibold">Active</span>
                    )}
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    navigate('/admin');
                  }}
                  className="flex items-center gap-2 text-violet hover:text-violet hover:bg-violet-soft cursor-pointer font-medium text-xs"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-violet" />
                  <span>Platform Admin (/admin)</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    logoutUser();
                    toast.info('Signed out of session');
                    navigate('/login');
                  }}
                  className="flex items-center gap-2 text-danger hover:text-danger hover:bg-danger-soft cursor-pointer font-medium"
                >
                  <LogOut className="w-3.5 h-3.5 text-danger" />
                  <span>Sign Out / Log Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* 2. Document Tab Strip (IDE-style multi-document tabs) */}
        <DocumentTabStrip />

        {/* 3. Main Body: Sidebar + Full Width Workspace */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Mobile Backdrop */}
          {mobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-xs z-40 lg:hidden transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Left Sidebar: Drawer on <lg, inline 232px/56px on lg+ */}
          <aside
            className={cn(
              'bg-sidebar border-r border-border transition-all duration-200 ease-in-out flex flex-col justify-between shrink-0 select-none',
              'fixed inset-y-0 left-0 z-50 w-64 shadow-2xl lg:shadow-none lg:static lg:z-20',
              mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
              sidebarCollapsed ? 'lg:w-14' : 'lg:w-[232px]'
            )}
          >
            {/* Mobile Drawer Header */}
            <div className="lg:hidden flex items-center justify-between p-3 border-b border-border bg-surface-neutral/30 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-accent flex items-center justify-center text-white font-extrabold text-[11px] shadow-xs">
                  L
                </div>
                <span className="font-semibold text-xs text-text-primary">Navigation Menu</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-neutral cursor-pointer"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Navigation Items */}
            <div className="overflow-y-auto py-2 px-2 flex flex-col gap-3">
              {navSections.map((sec, idx) => (
                <div key={idx} className="flex flex-col gap-0.5">
                  {!sidebarCollapsed && (
                    <div className="px-3 pb-1 text-[11px] uppercase tracking-wider font-semibold text-text-muted mt-2">
                      {sec.title}
                    </div>
                  )}
                  {sec.items.map((item) => {
                    const Icon = item.icon;
                    const isActive =
                      location.pathname === item.to ||
                      (item.to !== `/${coSlug}` && location.pathname.startsWith(item.to + '/'));

                    return (
                      <ContextMenu key={item.to}>
                        <ContextMenuTrigger asChild>
                          <NavLink
                            to={item.to}
                            title={sidebarCollapsed ? item.label : undefined}
                            className={cn(
                              'flex flex-row items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors h-[32px] relative group outline-none',
                              isActive
                                ? 'bg-accent-soft text-accent font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:bg-accent before:rounded-r'
                                : 'text-text-secondary hover:bg-surface-neutral hover:text-text-primary',
                              sidebarCollapsed && 'justify-center px-0'
                            )}
                          >
                            <Icon
                              className={cn(
                                'w-4 h-4 shrink-0 transition-colors',
                                isActive ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'
                              )}
                            />
                            {!sidebarCollapsed && <span className="truncate flex-1 text-left">{item.label}</span>}
                            {!sidebarCollapsed && item.badge !== undefined && (
                              <span className="bg-warning-soft text-warning text-[10px] font-bold px-1.5 py-0.2 rounded-full border border-warning/30 shrink-0">
                                {item.badge}
                              </span>
                            )}
                          </NavLink>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => navigate(item.to)}>
                            <ExternalLink className="mr-2 h-3.5 w-3.5" />
                            <span>Open {item.label}</span>
                          </ContextMenuItem>
                          <ContextMenuItem
                            onClick={() => {
                              openTab({
                                id: `tab-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
                                title: item.label,
                                url: item.to,
                                type: 'navigation',
                              });
                              navigate(item.to);
                            }}
                          >
                            <FileText className="mr-2 h-3.5 w-3.5" />
                            <span>Open in New Tab</span>
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(window.location.origin + item.to);
                            }}
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            <span>Copy Link</span>
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Bottom Sidebar User & Status */}
            <div className="p-2 border-t border-border bg-sidebar text-[11px] text-text-muted flex flex-col gap-2">
              {!sidebarCollapsed ? (
                <div className="flex items-center justify-between p-1.5 rounded-sm bg-surface-neutral/60 border border-border">
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center font-bold text-[9px] shrink-0">
                      {currentUser.avatar}
                    </div>
                    <div className="flex flex-col truncate">
                      <span className="text-xs font-semibold text-text-primary truncate">{currentUser.name}</span>
                      <span className="text-[10px] text-text-muted truncate">{currentUser.roleTitle.split(' ')[0]}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      logoutUser();
                      toast.info('Signed out of session');
                      navigate('/login');
                    }}
                    className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger-soft transition shrink-0"
                    title="Sign Out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    logoutUser();
                    toast.info('Signed out of session');
                    navigate('/login');
                  }}
                  className="w-full flex justify-center p-1.5 rounded text-text-muted hover:text-danger hover:bg-danger-soft transition"
                  title={`Sign Out (${currentUser.name})`}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}

              {!sidebarCollapsed ? (
                <div className="flex items-center justify-between font-mono text-[10px] px-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                    <span>{currentPeriod.name}</span>
                  </span>
                  <span>v2.0-mock</span>
                </div>
              ) : (
                <div className="flex justify-center" title={`${currentPeriod.name} Open`}>
                  <span className="w-2 h-2 rounded-full bg-success" />
                </div>
              )}
            </div>
          </aside>

          {/* Content Workspace: FULL WIDTH per Block 3.4 (no max-w, no mx-auto, padding 20px) */}
          <main className="flex-1 overflow-y-auto bg-canvas p-3 sm:p-4 md:p-5">
            <div className="w-full h-full">
              <Outlet />
            </div>
          </main>
        </div>

        {/* 4. Bottom Status Bar: Exactly 24px fixed desktop status bar */}
        <BottomStatusBar />

        {/* Global Modals */}
        <CommandPalette isOpen={isCommandOpen} onClose={() => setIsCommandOpen(false)} />
        <ShortcutsOverlay />
        <ConflictDialog />
        <UsabilityTracker />
      </div>
    </TooltipProvider>
  );
};
