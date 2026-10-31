/**
 * Master Platform Admin Shell per docs/10_SaaS_Admin.md §1, §3, and §10.
 * Reuses the existing design tokens, frame architecture, typography,
 * Radix primitives, density controls, and status bar.
 */

import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/mock/store/adminStore';
import { useLedgerStore, UIRowDensity } from '@/mock/store';
import { useTheme } from '@/layouts/shell/useTheme';
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
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  LayoutDashboard,
  Building2,
  Package,
  Ticket,
  CreditCard,
  TrendingUp,
  Briefcase,
  Headphones,
  Activity,
  Flag,
  ShieldCheck,
  Scale,
  Sun,
  Moon,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Check,
  Clock,
  Rows3,
  LogOut,
  ExternalLink,
  ShieldAlert,
  X,
  Menu,
} from 'lucide-react';

export const AdminShell: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

  const navigate = useNavigate();
  const location = useLocation();

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const {
    currentAdmin,
    staffUsers,
    switchAdminStaff,
    approvals,
    activeImpersonation,
    endImpersonation,
    getKpis,
    logoutAdmin,
  } = useAdminStore();

  const { uiDensity, setUiDensity } = useLedgerStore();

  const pendingApprovalsCount = approvals.filter((a) => a.status === 'pending').length;
  const kpis = getKpis();

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

  const { currentTheme: activeTheme, applyTheme } = useTheme();

  interface AdminNavItem {
    label: string;
    to: string;
    icon: React.ComponentType<{ className?: string }>;
    exact?: boolean;
    badge?: number | string;
  }
  interface AdminNavSection {
    title: string;
    items: AdminNavItem[];
  }

  const navSections: AdminNavSection[] = [
    {
      title: 'Platform',
      items: [
        { label: 'Overview', to: '/admin', icon: LayoutDashboard, exact: true },
        { label: 'Tenants', to: '/admin/tenants', icon: Building2 },
      ],
    },
    {
      title: 'Commercial',
      items: [
        { label: 'Plans and pricing', to: '/admin/plans', icon: Package },
        { label: 'Coupons and discounts', to: '/admin/coupons', icon: Ticket },
        { label: 'Billing operations', to: '/admin/billing', icon: CreditCard, badge: pendingApprovalsCount > 0 ? `${pendingApprovalsCount}` : undefined },
        { label: 'Trials and growth', to: '/admin/growth', icon: TrendingUp },
        { label: 'Partners and resellers', to: '/admin/partners', icon: Briefcase },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Support and communications', to: '/admin/support', icon: Headphones },
        { label: 'Platform telemetry', to: '/admin/ops', icon: Activity },
        { label: 'Feature flags', to: '/admin/flags', icon: Flag },
      ],
    },
    {
      title: 'Governance',
      items: [
        { label: 'Staff and security', to: '/admin/staff', icon: ShieldCheck, badge: pendingApprovalsCount > 0 ? 'Review' : undefined },
        { label: 'Compliance and GDPR', to: '/admin/compliance', icon: Scale },
      ],
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen max-h-screen overflow-hidden flex flex-col antialiased bg-canvas text-text-primary select-none font-sans">
        {/* Active Impersonation Warning Banner */}
        {activeImpersonation && (
          <div className="h-8 bg-warning-soft border-b border-warning/30 px-3 flex items-center justify-between text-xs text-warning font-medium z-40 select-none shrink-0">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-warning shrink-0" />
              <span>
                <strong>Impersonation:</strong> active session for tenant <span className="font-mono">{activeImpersonation.tenantId}</span> as <span className="font-mono">{activeImpersonation.adminName}</span>.
                Mode: <span className="font-semibold">{activeImpersonation.mode}-only</span>.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  endImpersonation();
                  toast.info('Impersonation session ended.');
                }}
                className="h-6 px-2 rounded-md bg-warning text-white font-medium hover:opacity-90 transition text-xs cursor-pointer"
              >
                End session
              </button>
            </div>
          </div>
        )}

        {/* 1. Top admin bar: same quiet style as the tenant app */}
        <header className="h-12 bg-surface border-b border-border px-3 sm:px-4 flex items-center justify-between shrink-0 z-30 select-none text-xs">
          {/* Left: Platform Logo + Staff Persona Switcher */}
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
                  aria-label="Toggle Admin Navigation"
                >
                  <span className="lg:hidden">
                    {mobileMenuOpen ? <PanelLeftClose className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                  </span>
                  <span className="hidden lg:inline">
                    {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent shortcut="[">Toggle Admin Navigation</TooltipContent>
            </Tooltip>

            {/* Brand */}
            <div
              onClick={() => navigate('/admin')}
              className="flex items-center gap-2 cursor-pointer text-text-primary shrink-0"
            >
              <span className="hidden sm:inline text-sm font-semibold">Ledgerly Platform</span>
              <span className="px-1.5 py-px rounded-[3px] bg-surface-neutral text-text-secondary text-[11px] font-medium">
                Admin
              </span>
            </div>

            <span className="text-border hidden sm:inline">/</span>

            {/* Staff Persona Switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 sm:gap-1.5 h-8 px-2 sm:px-2.5 rounded-md border border-border hover:border-border-strong bg-surface text-[13px] font-medium text-text-primary transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer shrink-0"
                >
                  <span className="max-w-[70px] sm:max-w-[130px] truncate">{currentAdmin.name.split(' ')[0]}</span>
                  <span className="hidden sm:inline text-[11px] text-text-muted bg-surface-neutral px-1 py-px rounded-[3px] capitalize">
                    {currentAdmin.role}
                  </span>
                  <ChevronDown className="w-3 h-3 text-text-muted opacity-60 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Operator personas</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {staffUsers.map((staff) => (
                  <DropdownMenuItem
                    key={staff.id}
                    onClick={() => {
                      switchAdminStaff(staff.id);
                      toast.success(`Switched operator to ${staff.name} (${staff.role})`);
                    }}
                    className="flex items-center justify-between py-1.5 cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-text-primary">{staff.name}</span>
                      <span className="text-[11px] text-text-muted">{staff.email}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] capitalize bg-surface-neutral px-1.5 py-px rounded-[3px] text-text-secondary">
                        {staff.role}
                      </span>
                      {currentAdmin.id === staff.id && <Check className="w-3.5 h-3.5 text-accent" />}
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    logoutAdmin();
                    toast.info('Staff session ended');
                    navigate('/admin/login');
                  }}
                  className="flex items-center gap-2 text-danger hover:text-danger hover:bg-danger-soft cursor-pointer font-medium text-xs"
                >
                  <LogOut className="w-3.5 h-3.5 text-danger" />
                  <span>Sign out of staff session</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Pending Dual Approvals Chip */}
            {pendingApprovalsCount > 0 && (
              <div
                onClick={() => navigate('/admin/staff')}
                className="hidden md:flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-warning-soft border border-warning/30 text-warning cursor-pointer hover:opacity-90 transition"
                title={`${pendingApprovalsCount} dual-approval requests pending verification`}
              >
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[11px] font-medium">
                  {pendingApprovalsCount} dual approval{pendingApprovalsCount > 1 ? 's' : ''} pending
                </span>
              </div>
            )}
          </div>

          {/* Center: Global Search Input */}
          <div className="hidden lg:flex items-center flex-1 max-w-[400px] mx-4">
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && globalSearch.trim()) {
                    navigate(`/admin/tenants?q=${encodeURIComponent(globalSearch.trim())}`);
                  }
                }}
                placeholder="Search tenants, users, subscriptions, invoices"
                className="w-full h-8 pl-8 pr-3 text-[13px] bg-canvas border border-border rounded-md text-text-primary placeholder:text-text-muted hover:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              />
            </div>
          </div>

          {/* Right: Controls + Clock + Switch to Tenant App */}
          <div className="flex items-center gap-1.5 text-text-secondary">
            {/* UTC Clock */}
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-text-muted tabular-nums px-2">
              <Clock className="w-3 h-3 text-text-muted" />
              <span>{currentTime}</span>
            </div>

            {/* Density Picker */}
            <div className="hidden sm:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="p-1.5 text-text-muted hover:text-text-primary rounded-sm hover:bg-surface-neutral transition cursor-pointer"
                    title="Table density" aria-label="Table density"
                  >
                    <Rows3 className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Table density</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setUiDensity('compact')} className="flex items-center justify-between cursor-pointer">
                    <span>Compact (28px)</span>
                    {uiDensity === 'compact' && <Check className="w-3.5 h-3.5 text-accent" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setUiDensity('default')} className="flex items-center justify-between cursor-pointer">
                    <span>Default (36px)</span>
                    {uiDensity === 'default' && <Check className="w-3.5 h-3.5 text-accent" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setUiDensity('comfortable')} className="flex items-center justify-between cursor-pointer">
                    <span>Comfortable (44px)</span>
                    {uiDensity === 'comfortable' && <Check className="w-3.5 h-3.5 text-accent" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Theme Picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-1.5 text-text-muted hover:text-text-primary rounded-sm hover:bg-surface-neutral transition cursor-pointer"
                  title="Theme" aria-label="Theme"
                >
                  {activeTheme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => applyTheme('light')} className="flex items-center justify-between cursor-pointer">
                  <span>Light</span>
                  {activeTheme === 'light' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyTheme('dark')} className="flex items-center justify-between cursor-pointer">
                  <span>Dark</span>
                  {activeTheme === 'dark' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Switch to Tenant App button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate('/acme/dashboard')}
                  className="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-md border border-border hover:border-border-strong bg-surface text-[13px] font-medium text-text-secondary hover:text-text-primary transition cursor-pointer"
                >
                  <span>Tenant app</span>
                  <ExternalLink className="w-3 h-3 text-text-muted" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Switch to the customer accounting app</TooltipContent>
            </Tooltip>

            {/* Logout button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    toast.info('Signed out of platform admin');
                    navigate('/admin/login');
                  }}
                  className="p-1.5 text-text-muted hover:text-danger rounded-sm hover:bg-danger-soft transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Sign out of staff session</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* 2. Admin document tab strip */}
        <div className="h-8 bg-surface-subtle border-b border-border flex items-center px-2 gap-1 overflow-x-auto no-scrollbar flex-nowrap shrink-0 select-none text-xs">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-t-sm border-t border-x cursor-pointer transition-colors h-7 shrink-0 whitespace-nowrap',
                isActive
                  ? 'bg-surface-elevated border-border text-text-primary font-medium'
                  : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface-neutral/60'
              )
            }
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span>Overview</span>
          </NavLink>

          <NavLink
            to="/admin/tenants"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-t-sm border-t border-x cursor-pointer transition-colors h-7 shrink-0 whitespace-nowrap',
                isActive
                  ? 'bg-surface-elevated border-border text-text-primary font-medium'
                  : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface-neutral/60'
              )
            }
          >
            <Building2 className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span>Tenants ({useAdminStore.getState().tenants.length})</span>
          </NavLink>

          <NavLink
            to="/admin/billing"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-t-sm border-t border-x cursor-pointer transition-colors h-7 shrink-0 whitespace-nowrap',
                isActive
                  ? 'bg-surface-elevated border-border text-text-primary font-medium'
                  : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface-neutral/60'
              )
            }
          >
            <CreditCard className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span>Billing operations</span>
          </NavLink>

          <NavLink
            to="/admin/staff"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-t-sm border-t border-x cursor-pointer transition-colors h-7 shrink-0 whitespace-nowrap',
                isActive
                  ? 'bg-surface-elevated border-border text-text-primary font-medium'
                  : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface-neutral/60'
              )
            }
          >
            <ShieldCheck className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span>Staff &amp; approvals</span>
          </NavLink>
        </div>

        {/* 3. Main Body: Sidebar + Viewport */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Mobile Backdrop */}
          {mobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Admin Sidebar: Drawer on <lg, inline 232px/48px on lg+ */}
          <aside
            className={cn(
              'bg-sidebar border-r border-border flex flex-col justify-between shrink-0 transition-all duration-200 ease-in-out select-none',
              'fixed inset-y-0 left-0 z-50 w-64 shadow-lg lg:shadow-none lg:static lg:z-20',
              mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
              sidebarCollapsed ? 'lg:w-12' : 'lg:w-58'
            )}
          >
            {/* Mobile Drawer Header */}
            <div className="lg:hidden flex items-center justify-between p-3 border-b border-border bg-surface-neutral/30 shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-text-primary">Platform admin</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-neutral cursor-pointer"
                aria-label="Close admin menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2.5 px-1.5 space-y-4 no-scrollbar">
              {navSections.map((section) => (
                <div key={section.title} className="space-y-0.5">
                  {!sidebarCollapsed && (
                    <div className="px-2 py-1 text-[11px] font-medium text-text-muted">
                      {section.title}
                    </div>
                  )}
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.exact
                      ? location.pathname === item.to
                      : location.pathname.startsWith(item.to);

                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={cn(
                          'flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer',
                          isActive
                            ? 'bg-surface text-text-primary font-medium shadow-[0_0_0_1px_var(--border)]'
                            : 'text-text-secondary hover:text-text-primary hover:bg-surface-neutral'
                        )}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-text-primary' : 'text-text-muted')} />
                        {!sidebarCollapsed && (
                          <div className="flex-1 flex items-center justify-between truncate">
                            <span className="truncate">{item.label}</span>
                            {item.badge && (
                              <span className="ml-1 px-1.5 py-px rounded-[3px] text-[11px] font-medium bg-warning-soft text-warning">
                                {item.badge}
                              </span>
                            )}
                          </div>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Sidebar Bottom Operator Summary Card */}
            {!sidebarCollapsed && (
              <div className="p-2 border-t border-border bg-surface-subtle">
                <div className="p-2 rounded-md bg-surface border border-border space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-muted">Total MRR</span>
                    <span className="font-medium tabular-nums text-text-primary">
                      ${(kpis.mrr / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-muted">Tenants</span>
                    <span className="tabular-nums text-text-secondary">
                      {kpis.activeTenantsCount} active / {kpis.trialingTenantsCount} trials
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border">
                    <span className="text-text-muted">SLA health</span>
                    <span className="text-success text-[11px] font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-success" />
                      99.98% OK
                    </span>
                  </div>
                </div>
              </div>
            )}
          </aside>

          {/* Main Viewport */}
          <main className="flex-1 flex flex-col overflow-y-auto bg-canvas relative">
            <Outlet />
          </main>
        </div>

        {/* 4. Bottom Status Bar: Exactly 24px high per 03_UI_Spec §10 */}
        <footer className="h-6 bg-surface border-t border-border px-3 sm:px-4 flex items-center justify-between shrink-0 z-30 select-none text-[11px] text-text-muted overflow-hidden">
          <div className="flex items-center gap-2 sm:gap-3 truncate min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-text-secondary hidden sm:inline">Vendor back office</span>
            </div>
            <span className="hidden sm:inline">|</span>
            <span className="text-text-secondary truncate">
              Role: <strong className="text-text-primary font-medium capitalize">{currentAdmin.role}</strong>
            </span>
            <span>|</span>
            <span className="text-success flex items-center gap-1 shrink-0">
              <ShieldCheck className="w-3 h-3 text-success" />
              <span>2FA verified</span>
            </span>
            {pendingApprovalsCount > 0 && (
              <>
                <span>|</span>
                <span className="text-warning font-medium truncate">
                  {pendingApprovalsCount} dual-approval{pendingApprovalsCount > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>

          <div className="hidden md:flex items-center gap-3 shrink-0">
            <span>Horizon: 0 failed / 1,420 jobs/min</span>
            <span>|</span>
            <span>Telemetry: p95 142ms</span>
            <span>|</span>
            <span>Ledgerly Platform v1.2</span>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
};
