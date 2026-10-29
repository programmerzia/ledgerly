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
  Palette,
  Rows3,
  LogOut,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  UserCheck,
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

  const [activeTheme, setActiveTheme] = useState<'light' | 'dark' | 'midnight' | 'forest'>('light');

  useEffect(() => {
    const theme = (document.documentElement.getAttribute('data-theme') as any) || 'light';
    setActiveTheme(theme);
  }, []);

  const applyTheme = (theme: 'light' | 'dark' | 'midnight' | 'forest') => {
    if (theme === 'light') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    setActiveTheme(theme);
    toast.success(`Theme switched to ${theme.toUpperCase()}`);
  };

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
      title: 'Platform Core',
      items: [
        { label: 'Overview', to: '/admin', icon: LayoutDashboard, exact: true },
        { label: 'Tenants', to: '/admin/tenants', icon: Building2 },
      ],
    },
    {
      title: 'Commercial & Growth',
      items: [
        { label: 'Plans & Pricing', to: '/admin/plans', icon: Package },
        { label: 'Coupons & Discounts', to: '/admin/coupons', icon: Ticket },
        { label: 'Billing Operations', to: '/admin/billing', icon: CreditCard, badge: pendingApprovalsCount > 0 ? `${pendingApprovalsCount}` : undefined },
        { label: 'Trials & Growth', to: '/admin/growth', icon: TrendingUp },
        { label: 'Partners & Resellers', to: '/admin/partners', icon: Briefcase },
      ],
    },
    {
      title: 'Platform Operations',
      items: [
        { label: 'Support & Comms', to: '/admin/support', icon: Headphones },
        { label: 'Platform Telemetry', to: '/admin/ops', icon: Activity },
        { label: 'Feature Flags', to: '/admin/flags', icon: Flag },
      ],
    },
    {
      title: 'Governance & Security',
      items: [
        { label: 'Staff & Security', to: '/admin/staff', icon: ShieldCheck, badge: pendingApprovalsCount > 0 ? 'Review' : undefined },
        { label: 'Compliance & GDPR', to: '/admin/compliance', icon: Scale },
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
              <span className="flex h-2 w-2 rounded-full bg-warning animate-pulse shrink-0" />
              <span>
                <strong>OPERATOR IMPERSONATION:</strong> Active session for tenant <span className="font-mono">{activeImpersonation.tenantId}</span> as <span className="font-mono">{activeImpersonation.adminName}</span>.
                Mode: <span className="uppercase font-semibold">{activeImpersonation.mode}-only</span>.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  endImpersonation();
                  toast.info('Impersonation session ended.');
                }}
                className="px-2 py-0.5 rounded bg-warning text-white font-medium hover:opacity-90 transition text-[11px] cursor-pointer"
              >
                End Session
              </button>
            </div>
          </div>
        )}

        {/* 1. Top Admin Bar: Exactly 40px high per 03_UI_Spec §10 */}
        <header className="h-10 bg-surface-elevated border-b border-border px-2 sm:px-3 flex items-center justify-between shrink-0 z-30 select-none text-xs">
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
              className="flex items-center gap-1.5 cursor-pointer font-bold text-text-primary tracking-tight shrink-0"
            >
              <div className="w-5 h-5 rounded bg-violet flex items-center justify-center text-white font-extrabold text-[11px] shadow-xs">
                Ω
              </div>
              <span className="hidden sm:inline font-semibold">Ledgerly Platform</span>
              <span className="px-1.5 py-0.2 rounded bg-violet-soft text-violet font-mono text-[10px] font-medium uppercase tracking-wider">
                Admin
              </span>
            </div>

            <span className="text-border hidden sm:inline">/</span>

            {/* Staff Persona Switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 sm:gap-1.5 h-7 px-1.5 sm:px-2.5 rounded-sm border border-border hover:border-border-strong bg-surface font-medium text-text-primary transition outline-none focus:ring-1 focus:ring-accent cursor-pointer shrink-0"
                >
                  <UserCheck className="w-3.5 h-3.5 text-violet shrink-0" />
                  <span className="max-w-[70px] sm:max-w-[130px] truncate">{currentAdmin.name.split(' ')[0]}</span>
                  <span className="hidden sm:inline text-[10px] font-mono text-text-muted bg-surface-neutral px-1 py-0.5 rounded uppercase">
                    {currentAdmin.role}
                  </span>
                  <ChevronDown className="w-3 h-3 text-text-muted opacity-60 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Operator Staff Personas</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {staffUsers.map((staff) => (
                  <DropdownMenuItem
                    key={staff.id}
                    onClick={() => {
                      switchAdminStaff(staff.id);
                      toast.success(`Switched operator to ${staff.name} (${staff.role.toUpperCase()})`);
                    }}
                    className="flex items-center justify-between py-1.5 cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-text-primary">{staff.name}</span>
                      <span className="text-[10px] text-text-muted">{staff.email}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono uppercase bg-surface-neutral px-1.5 py-0.5 rounded text-text-secondary">
                        {staff.role}
                      </span>
                      {currentAdmin.id === staff.id && <Check className="w-3.5 h-3.5 text-violet" />}
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
                  <span>Sign Out Staff Session</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Pending Dual Approvals Chip */}
            {pendingApprovalsCount > 0 && (
              <div
                onClick={() => navigate('/admin/staff')}
                className="hidden md:flex items-center gap-1.5 h-7 px-2.5 rounded-sm bg-warning-soft border border-warning/30 text-warning cursor-pointer hover:opacity-90 transition"
                title={`${pendingApprovalsCount} dual-approval requests pending verification`}
              >
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[11px] font-medium">
                  {pendingApprovalsCount} Dual Approval{pendingApprovalsCount > 1 ? 's' : ''} Pending
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
                placeholder="Search tenants, users, subscriptions, invoices (Press Enter)..."
                className="w-full h-7 pl-8 pr-3 text-xs bg-surface border border-border rounded-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {/* Right: Controls + Clock + Switch to Tenant App */}
          <div className="flex items-center gap-1.5 text-text-secondary">
            {/* UTC Clock */}
            <div className="hidden sm:flex items-center gap-1 font-mono text-[11px] text-text-muted px-2 py-0.5 rounded bg-surface border border-border">
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
                    title="Change table row density"
                  >
                    <Rows3 className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Data Density</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setUiDensity('compact')} className="flex items-center justify-between cursor-pointer">
                    <span>Compact (28px)</span>
                    {uiDensity === 'compact' && <Check className="w-3.5 h-3.5 text-accent" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setUiDensity('default')} className="flex items-center justify-between cursor-pointer">
                    <span>Default (36px - Controls Grade)</span>
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
                  title="Change Color Theme"
                >
                  <Palette className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Display Theme</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => applyTheme('light')} className="flex items-center justify-between cursor-pointer">
                  <span>Light Canvas</span>
                  {activeTheme === 'light' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyTheme('dark')} className="flex items-center justify-between cursor-pointer">
                  <span>Dark Slate</span>
                  {activeTheme === 'dark' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyTheme('midnight')} className="flex items-center justify-between cursor-pointer">
                  <span>Midnight Navy</span>
                  {activeTheme === 'midnight' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => applyTheme('forest')} className="flex items-center justify-between cursor-pointer">
                  <span>Forest Emerald</span>
                  {activeTheme === 'forest' && <Check className="w-3.5 h-3.5 text-accent" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Switch to Tenant App button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate('/acme/dashboard')}
                  className="hidden md:flex items-center gap-1.5 h-7 px-2.5 rounded-sm border border-border hover:border-border-strong bg-surface text-text-secondary hover:text-text-primary transition cursor-pointer"
                >
                  <span>Tenant App</span>
                  <ExternalLink className="w-3 h-3 text-text-muted" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Switch to customer accounting portal (/acme/dashboard)</TooltipContent>
            </Tooltip>

            {/* Logout button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    toast.info('Logged out from Platform Admin');
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

        {/* 2. Admin Document Tab Strip */}
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
            <LayoutDashboard className="w-3.5 h-3.5 text-violet shrink-0" />
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
            <span>Billing Ops</span>
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
            <span>Staff & Approvals</span>
          </NavLink>
        </div>

        {/* 3. Main Body: Sidebar + Viewport */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Mobile Backdrop */}
          {mobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-xs z-40 lg:hidden transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Admin Sidebar: Drawer on <lg, inline 232px/48px on lg+ */}
          <aside
            className={cn(
              'bg-sidebar border-r border-border flex flex-col justify-between shrink-0 transition-all duration-200 ease-in-out select-none',
              'fixed inset-y-0 left-0 z-50 w-64 shadow-2xl lg:shadow-none lg:static lg:z-20',
              mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
              sidebarCollapsed ? 'lg:w-12' : 'lg:w-58'
            )}
          >
            {/* Mobile Drawer Header */}
            <div className="lg:hidden flex items-center justify-between p-3 border-b border-border bg-surface-neutral/30 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-violet flex items-center justify-center text-white font-extrabold text-[11px] shadow-xs">
                  Ω
                </div>
                <span className="font-semibold text-xs text-text-primary">Platform Admin</span>
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
                    <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
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
                          'flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors cursor-pointer',
                          isActive
                            ? 'bg-violet-soft text-violet font-semibold'
                            : 'text-text-secondary hover:text-text-primary hover:bg-surface-neutral'
                        )}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-violet' : 'text-text-muted')} />
                        {!sidebarCollapsed && (
                          <div className="flex-1 flex items-center justify-between truncate">
                            <span className="truncate">{item.label}</span>
                            {item.badge && (
                              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-warning-soft text-warning">
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
                <div className="p-2 rounded bg-surface border border-border space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-muted">Total MRR</span>
                    <span className="font-mono font-semibold text-text-primary">
                      ${(kpis.mrr / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-muted">Tenants</span>
                    <span className="font-mono text-text-secondary">
                      {kpis.activeTenantsCount} active / {kpis.trialingTenantsCount} trials
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border">
                    <span className="text-text-muted">SLA Health</span>
                    <span className="font-mono text-success text-[10px] font-medium flex items-center gap-1">
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
        <footer className="h-6 bg-surface-elevated border-t border-border px-2 sm:px-3 flex items-center justify-between shrink-0 z-30 select-none text-[11px] font-mono text-text-muted overflow-hidden">
          <div className="flex items-center gap-2 sm:gap-3 truncate min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-text-secondary hidden sm:inline">Vendor Back-Office</span>
            </div>
            <span className="hidden sm:inline">|</span>
            <span className="text-text-secondary truncate">
              Role: <strong className="text-text-primary uppercase">{currentAdmin.role}</strong>
            </span>
            <span>|</span>
            <span className="text-success flex items-center gap-1 shrink-0">
              <ShieldCheck className="w-3 h-3 text-success" />
              <span>2FA OK</span>
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
