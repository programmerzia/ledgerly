/**
 * Tenants List per docs/10_SaaS_Admin.md §3.2 and §10.
 * Dense 36px table with filter tabs, instant search, quick drawer inspection,
 * and contextual actions (Impersonate, Change Plan, Extend Trial, Suspend).
 */

import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAdminStore } from '@/mock/store/adminStore';
import { AdminTenant, TenantLifecycleStatus, PlanCode } from '@/types/admin';
import { StatusPill } from '@/components/domain/StatusPill';
import { toast } from 'sonner';
import {
  Building2,
  Search,
  Filter,
  Eye,
  UserCheck,
  Zap,
  Clock,
  Ban,
  RotateCcw,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  ArrowUpDown,
  X,
  Plus,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export const TenantsList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenants, suspendTenant, reactivateTenant, startImpersonation } = useAdminStore();

  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'trialing' | 'past_due' | 'suspended'>('all');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedTenantForDrawer, setSelectedTenantForDrawer] = useState<AdminTenant | null>(null);

  // Sorting
  const [sortField, setSortField] = useState<keyof AdminTenant>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Filter counts
  const counts = useMemo(() => {
    return {
      all: tenants.length,
      active: tenants.filter((t) => t.status === 'active').length,
      trialing: tenants.filter((t) => t.status === 'trialing').length,
      past_due: tenants.filter((t) => t.status === 'past_due').length,
      suspended: tenants.filter((t) => t.status === 'suspended').length,
    };
  }, [tenants]);

  // Filtered & sorted list
  const filteredTenants = useMemo(() => {
    return tenants
      .filter((t) => {
        if (activeTab !== 'all' && t.status !== activeTab) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            t.name.toLowerCase().includes(q) ||
            t.slug.toLowerCase().includes(q) ||
            t.ownerEmail.toLowerCase().includes(q) ||
            t.ownerName.toLowerCase().includes(q) ||
            t.country.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];
        if (sortField === 'subscription') {
          valA = a.subscription.amount;
          valB = b.subscription.amount;
        }
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [tenants, activeTab, searchQuery, sortField, sortDir]);

  const handleSort = (field: keyof AdminTenant) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const handleImpersonate = (tenant: AdminTenant) => {
    try {
      startImpersonation(tenant.id, 'read', 'Operator diagnostic support from Tenants List');
      toast.success(`Impersonating ${tenant.name} in read-only mode.`);
      navigate('/acme/dashboard');
    } catch (err: any) {
      toast.error(err.message || 'Impersonation failed');
    }
  };

  const handleToggleSuspend = (tenant: AdminTenant) => {
    if (tenant.status === 'suspended') {
      reactivateTenant(tenant.id, 'Operator manual reactivation from console');
      toast.success(`Tenant ${tenant.name} reactivated to active status.`);
    } else {
      suspendTenant(tenant.id, 'Operator manual suspension for billing review');
      toast.warning(`Tenant ${tenant.name} suspended.`);
    }
  };

  const getHealthBadge = (health: number) => {
    if (health >= 90) {
      return <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-success-soft text-success">A+ Healthy</span>;
    } else if (health >= 75) {
      return <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-success-soft text-success">A Good</span>;
    } else if (health >= 60) {
      return <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium bg-info-soft text-info">B Fair</span>;
    } else {
      return <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-danger-soft text-danger animate-pulse">Risk</span>;
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-3 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Tenants Directory</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold">
              {tenants.length} Organizations
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Active customer instances, multi-company subscriptions, usage meters, and support tools.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tenants..."
              className="h-8 pl-8 pr-3 w-56 text-xs bg-surface border border-border rounded-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border text-xs">
        {[
          { key: 'all', label: 'All Tenants', count: counts.all },
          { key: 'active', label: 'Active (Paid)', count: counts.active },
          { key: 'trialing', label: 'Trials', count: counts.trialing },
          { key: 'past_due', label: 'Past Due', count: counts.past_due },
          { key: 'suspended', label: 'Suspended', count: counts.suspended },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === tab.key
                ? 'border-violet text-violet font-semibold'
                : 'border-transparent text-text-muted hover:text-text-primary hover:border-border'
            }`}
          >
            <span>{tab.label}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-surface-neutral text-text-secondary">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* 36px Dense Controls Table */}
      <div className="rounded bg-surface border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="h-8 bg-surface-neutral/60 border-b border-border text-text-muted text-[11px] uppercase tracking-wider font-semibold">
                <th
                  onClick={() => handleSort('name')}
                  className="px-3 cursor-pointer hover:text-text-primary transition"
                >
                  <div className="flex items-center gap-1">
                    <span>Organization</span>
                    <ArrowUpDown className="w-3 h-3 opacity-60" />
                  </div>
                </th>
                <th className="px-3">Plan</th>
                <th className="px-3">Status</th>
                <th className="px-3 text-right">MRR</th>
                <th className="px-3 text-center">Companies</th>
                <th className="px-3 text-center">Users</th>
                <th className="px-3">Region</th>
                <th className="px-3">Health</th>
                <th className="px-3">Last Active</th>
                <th className="px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-text-muted text-xs">
                    No tenants found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredTenants.map((t) => {
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedTenantForDrawer(t)}
                      onDoubleClick={() => navigate(`/admin/tenants/${t.id}`)}
                      className="h-9 hover:bg-surface-neutral/50 cursor-pointer transition-colors group"
                    >
                      {/* Name & Domain */}
                      <td className="px-3 py-1">
                        <div className="flex flex-col">
                          <span className="font-semibold text-text-primary group-hover:text-violet transition truncate max-w-[200px]">
                            {t.name}
                          </span>
                          <span className="text-[10px] font-mono text-text-muted truncate max-w-[200px]">
                            {t.slug}.ledgerly.app
                          </span>
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-3 py-1">
                        <span className="capitalize text-[11px] font-medium px-2 py-0.5 rounded bg-surface-neutral border border-border text-text-secondary">
                          {t.subscription.planCode}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-1">
                        <StatusPill status={t.status as any} />
                      </td>

                      {/* MRR */}
                      <td className="px-3 py-1 text-right font-mono text-text-primary font-medium">
                        ${(t.subscription.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                      </td>

                      {/* Companies Count */}
                      <td className="px-3 py-1 text-center font-mono text-text-secondary">
                        {t.companiesCount} / {t.subscription.planCode === 'enterprise' ? 10 : t.subscription.planCode === 'business' ? 5 : 2}
                      </td>

                      {/* Users Count */}
                      <td className="px-3 py-1 text-center font-mono text-text-secondary">
                        {t.usersCount} / {t.subscription.planCode === 'enterprise' ? 50 : t.subscription.planCode === 'business' ? 15 : 5}
                      </td>

                      {/* Region */}
                      <td className="px-3 py-1 font-mono text-[11px] text-text-secondary">
                        {t.country} ({t.dataResidency})
                      </td>

                      {/* Health */}
                      <td className="px-3 py-1">
                        {getHealthBadge(t.healthScore)}
                      </td>

                      {/* Last Active */}
                      <td className="px-3 py-1 text-[11px] font-mono text-text-muted">
                        {new Date(t.lastActivityAt).toLocaleDateString()}
                      </td>

                      {/* Row Actions Menu */}
                      <td className="px-3 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => navigate(`/admin/tenants/${t.id}`)}
                            className="p-1 rounded hover:bg-surface-neutral text-text-muted hover:text-text-primary transition"
                            title="Open Tenant Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="p-1 rounded hover:bg-surface-neutral text-text-muted hover:text-text-primary transition"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>{t.name}</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => navigate(`/admin/tenants/${t.id}`)}
                                className="cursor-pointer"
                              >
                                View 10-Tab Detail
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleImpersonate(t)}
                                className="cursor-pointer text-violet"
                              >
                                Impersonate (Read-Only)
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => navigate(`/admin/tenants/${t.id}?tab=subscription`)}
                                className="cursor-pointer"
                              >
                                Change Plan / Proration
                              </DropdownMenuItem>
                              {t.status === 'trialing' && (
                                <DropdownMenuItem
                                  onClick={() => navigate(`/admin/tenants/${t.id}?tab=subscription&action=extend_trial`)}
                                  className="cursor-pointer"
                                >
                                  Extend 14-Day Trial
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleToggleSuspend(t)}
                                className={`cursor-pointer ${t.status === 'suspended' ? 'text-success' : 'text-danger'}`}
                              >
                                {t.status === 'suspended' ? 'Reactivate Tenant' : 'Suspend Tenant'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Inspection Drawer for Fast Tenant Overview */}
      {selectedTenantForDrawer && (
        <div className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-border shadow-xl z-50 flex flex-col select-none animate-in slide-in-from-right duration-150">
          <div className="p-4 border-b border-border flex items-center justify-between bg-surface-neutral/40">
            <div>
              <h2 className="text-sm font-bold text-text-primary truncate max-w-[280px]">
                {selectedTenantForDrawer.name}
              </h2>
              <span className="text-[11px] font-mono text-text-muted">
                {selectedTenantForDrawer.slug}.ledgerly.app
              </span>
            </div>
            <button
              onClick={() => setSelectedTenantForDrawer(null)}
              className="p-1 rounded hover:bg-surface-neutral text-text-muted hover:text-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* Quick Status Pill & Plan */}
            <div className="flex items-center justify-between p-2.5 rounded bg-surface-neutral border border-border">
              <div className="flex flex-col">
                <span className="text-[10px] text-text-muted uppercase">Plan & Status</span>
                <span className="font-semibold text-text-primary capitalize">
                  {selectedTenantForDrawer.subscription.planCode} Tier
                </span>
              </div>
              <StatusPill status={selectedTenantForDrawer.status as any} />
            </div>

            {/* Financial Highlights */}
            <div className="space-y-1.5 p-3 rounded bg-surface border border-border">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Financial Snapshot
              </span>
              <div className="flex justify-between py-1 border-b border-border/40">
                <span className="text-text-muted">Monthly Recurring</span>
                <span className="font-mono font-bold text-text-primary">
                  ${(selectedTenantForDrawer.subscription.amount / 100).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/40">
                <span className="text-text-muted">Billing Cycle</span>
                <span className="font-mono text-text-secondary capitalize">
                  {selectedTenantForDrawer.subscription.billingInterval}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-text-muted">Next Invoice Date</span>
                <span className="font-mono text-text-secondary">
                  {selectedTenantForDrawer.subscription.currentPeriodEnd}
                </span>
              </div>
            </div>

            {/* Usage vs Entitlements Meters */}
            <div className="space-y-2 p-3 rounded bg-surface border border-border">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Entitlement Quotas
              </span>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-text-muted">Companies</span>
                  <span className="font-mono">
                    {selectedTenantForDrawer.companiesCount} / {selectedTenantForDrawer.subscription.planCode === 'enterprise' ? 10 : 5}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-surface-neutral rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet"
                    style={{
                      width: `${(selectedTenantForDrawer.companiesCount / (selectedTenantForDrawer.subscription.planCode === 'enterprise' ? 10 : 5)) * 100}%`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-text-muted">Seat Licenses (Users)</span>
                  <span className="font-mono">
                    {selectedTenantForDrawer.usersCount} / {selectedTenantForDrawer.subscription.planCode === 'enterprise' ? 50 : 15}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-surface-neutral rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{
                      width: `${(selectedTenantForDrawer.usersCount / (selectedTenantForDrawer.subscription.planCode === 'enterprise' ? 50 : 15)) * 100}%`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-text-muted">Journal Lines (mo)</span>
                  <span className="font-mono">
                    {selectedTenantForDrawer.usage.journalLinesThisMonth.toLocaleString()} / {selectedTenantForDrawer.subscription.planCode === 'enterprise' ? '100,000' : '25,000'}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-surface-neutral rounded-full overflow-hidden">
                  <div
                    className="h-full bg-success"
                    style={{
                      width: `${Math.min(100, (selectedTenantForDrawer.usage.journalLinesThisMonth / 25000) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Primary Contact */}
            <div className="p-3 rounded bg-surface border border-border space-y-1">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Primary Contact
              </span>
              <div className="font-medium text-text-primary">{selectedTenantForDrawer.ownerName}</div>
              <div className="text-text-muted font-mono text-[11px]">{selectedTenantForDrawer.ownerEmail}</div>
              <div className="text-text-muted text-[11px] mt-1">Country: {selectedTenantForDrawer.country}</div>
            </div>
          </div>

          {/* Drawer Actions */}
          <div className="p-3 border-t border-border bg-surface-neutral/30 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => handleImpersonate(selectedTenantForDrawer)}
              className="flex-1 h-8 px-2 rounded bg-violet text-white font-medium hover:opacity-90 transition text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Impersonate</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const id = selectedTenantForDrawer.id;
                setSelectedTenantForDrawer(null);
                navigate(`/admin/tenants/${id}`);
              }}
              className="flex-1 h-8 px-2 rounded bg-surface border border-border hover:border-border-strong text-text-primary font-medium transition text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Full 10-Tab View</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
