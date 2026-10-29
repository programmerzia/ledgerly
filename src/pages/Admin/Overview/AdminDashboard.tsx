/**
 * Platform Admin Executive Dashboard per docs/10_SaaS_Admin.md §3.1 and §8.
 * Computes live KPIs from mirrored subscriptions and Stripe invoices.
 * 14-month historical charts, revenue by plan, geography, and audit ticker.
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '@/mock/store/adminStore';
import { mockHistoricalCohorts } from '@/mock/adminData';
import { adminBillingApi } from '@/mock/api/admin/billing';
import { toast } from 'sonner';
import {
  TrendingUp,
  DollarSign,
  Users,
  AlertTriangle,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  Building2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { getKpis, tenants, plans, auditEvents, invoices } = useAdminStore();

  const kpis = useMemo(() => getKpis(), [tenants, invoices]);

  // Compute revenue by plan from active tenants
  const revenueByPlan = useMemo(() => {
    const map: Record<string, { name: string; count: number; totalMinor: number }> = {
      starter: { name: 'Starter ($49)', count: 0, totalMinor: 0 },
      professional: { name: 'Professional ($149)', count: 0, totalMinor: 0 },
      business: { name: 'Business ($349)', count: 0, totalMinor: 0 },
      enterprise: { name: 'Enterprise ($899)', count: 0, totalMinor: 0 },
    };

    tenants.forEach((t) => {
      if (t.status === 'active' || t.status === 'past_due') {
        const code = t.subscription.planCode;
        if (map[code]) {
          map[code].count++;
          map[code].totalMinor += t.subscription.amount;
        }
      }
    });

    return Object.values(map);
  }, [tenants]);

  // Compute geography distribution
  const geoBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    tenants.forEach((t) => {
      counts[t.country] = (counts[t.country] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([country, count]) => ({ country, count, pct: Math.round((count / tenants.length) * 100) }))
      .sort((a, b) => b.count - a.count);
  }, [tenants]);

  const handleExportAsc606 = async () => {
    try {
      const csv = await adminBillingApi.exportRevenueScheduleCsv();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ASC606_Revenue_Schedule_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      toast.success('ASC 606 Monthly Deferred Revenue schedule exported (CSV)');
    } catch {
      toast.error('Failed to export revenue schedule');
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">Platform Executive Overview</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold uppercase">
              Stripe Mirrored
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            SaaS recurring revenue, cohort retention, tenant lifecycle, and platform telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportAsc606}
            className="h-7 px-2.5 rounded-sm bg-surface border border-border hover:border-border-strong text-text-secondary hover:text-text-primary text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-text-muted" />
            <span className="hidden sm:inline">Export ASC 606 Schedule</span>
            <span className="sm:hidden">Export ASC 606</span>
          </button>

          <button
            type="button"
            onClick={() => {
              toast.success('Platform telemetry refreshed from Stripe & Horizon queues');
            }}
            className="h-7 px-2.5 rounded-sm bg-violet text-white hover:opacity-90 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync Stripe Webhooks</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5">
        {/* Card 1: MRR */}
        <div className="p-2.5 sm:p-3 rounded bg-surface border border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted text-[10px] sm:text-[11px]">
            <span className="truncate">Monthly Recurring</span>
            <DollarSign className="w-3.5 h-3.5 text-violet shrink-0" />
          </div>
          <div className="mt-1">
            <div className="text-lg sm:text-xl font-bold font-mono tracking-tight text-text-primary">
              ${(kpis.mrr / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}
            </div>
            <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-success mt-0.5 font-medium truncate">
              <TrendingUp className="w-3 h-3 shrink-0" />
              <span>+18.4% vs last mo</span>
            </div>
          </div>
          <div className="text-[9px] sm:text-[10px] text-text-muted mt-1 font-mono pt-1 border-t border-border/60 truncate">
            Net: +${(kpis.netNewMrr / 100).toLocaleString()}
          </div>
        </div>

        {/* Card 2: ARR */}
        <div className="p-2.5 sm:p-3 rounded bg-surface border border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted text-[10px] sm:text-[11px]">
            <span className="truncate">Annual Run-Rate</span>
            <TrendingUp className="w-3.5 h-3.5 text-accent" />
          </div>
          <div className="mt-1">
            <div className="text-xl font-bold font-mono tracking-tight text-text-primary">
              ${(kpis.arr / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-text-secondary mt-0.5 font-mono">
              92.1% of $500k goal
            </div>
          </div>
          <div className="text-[10px] text-text-muted mt-1 font-mono pt-1 border-t border-border/60">
            ARR Multiple: 12.0×
          </div>
        </div>

        {/* Card 3: Active Tenants */}
        <div
          onClick={() => navigate('/admin/tenants')}
          className="p-3 rounded bg-surface border border-border hover:border-violet/40 cursor-pointer transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-text-muted text-[11px]">
            <span>Total Tenants</span>
            <Users className="w-3.5 h-3.5 text-text-muted" />
          </div>
          <div className="mt-1">
            <div className="text-xl font-bold font-mono tracking-tight text-text-primary">
              {tenants.length}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-text-secondary mt-0.5">
              <span className="text-success font-medium">{kpis.activeTenantsCount} paid</span>
              <span>•</span>
              <span className="text-accent font-medium">{kpis.trialingTenantsCount} trials</span>
            </div>
          </div>
          <div className="text-[10px] text-text-muted mt-1 font-mono pt-1 border-t border-border/60">
            Conv Rate: {kpis.trialConversionRate}%
          </div>
        </div>

        {/* Card 4: Retention */}
        <div className="p-3 rounded bg-surface border border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-text-muted text-[11px]">
            <span>Net Retention</span>
            <ShieldCheck className="w-3.5 h-3.5 text-success" />
          </div>
          <div className="mt-1">
            <div className="text-xl font-bold font-mono tracking-tight text-text-primary">
              {kpis.netRevenueRetentionPct}%
            </div>
            <div className="text-[10px] text-text-secondary mt-0.5">
              GRR: <strong className="font-mono">{kpis.grossRevenueRetentionPct}%</strong>
            </div>
          </div>
          <div className="text-[10px] text-text-muted mt-1 font-mono pt-1 border-t border-border/60">
            Logo Churn: 1.8% / mo
          </div>
        </div>

        {/* Card 5: Past Due & Dunning */}
        <div
          onClick={() => navigate('/admin/billing')}
          className="p-3 rounded bg-surface border border-border hover:border-warning/40 cursor-pointer transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-text-muted text-[11px]">
            <span>At Risk (Dunning)</span>
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
          </div>
          <div className="mt-1">
            <div className="text-xl font-bold font-mono tracking-tight text-warning">
              {tenants.filter((t) => t.status === 'past_due').length}
            </div>
            <div className="text-[10px] text-warning mt-0.5 font-medium font-mono">
              ${(kpis.failedPaymentsAmount / 100).toLocaleString()} unpaid
            </div>
          </div>
          <div className="text-[10px] text-text-muted mt-1 font-mono pt-1 border-t border-border/60">
            Recovery: 82.5%
          </div>
        </div>

        {/* Card 6: Platform SLA */}
        <div
          onClick={() => navigate('/admin/ops')}
          className="p-3 rounded bg-surface border border-border hover:border-accent/40 cursor-pointer transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-text-muted text-[11px]">
            <span>System Health</span>
            <Activity className="w-3.5 h-3.5 text-success" />
          </div>
          <div className="mt-1">
            <div className="text-xl font-bold font-mono tracking-tight text-success">
              99.98%
            </div>
            <div className="text-[10px] text-text-secondary mt-0.5 font-mono">
              p95: {kpis.systemP95LatencyMs}ms
            </div>
          </div>
          <div className="text-[10px] text-text-muted mt-1 font-mono pt-1 border-t border-border/60">
            Queues: 0 backlog
          </div>
        </div>
      </div>

      {/* Middle Section: 14-Month Trend & Revenue Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left: 14-Month Historical MRR Chart */}
        <div className="lg:col-span-2 p-3.5 rounded bg-surface border border-border flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold text-text-primary">14-Month MRR Growth Trajectory</h2>
              <p className="text-[10px] text-text-muted">Mirrored from Stripe billing records (Sep 2025 – Oct 2026)</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="flex items-center gap-1.5 text-text-secondary">
                <span className="w-2.5 h-2.5 rounded-xs bg-violet" />
                Active MRR
              </span>
            </div>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockHistoricalCohorts} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorMrr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--violet)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--violet)" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.6} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  minTickGap={16}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => `$${Math.round(val / 100000)}k`}
                />
                <RechartsTooltip
                  formatter={(val: any) => [`$${(Number(val) / 100).toLocaleString()}`, 'MRR']}
                  contentStyle={{
                    backgroundColor: 'var(--surface-elevated)',
                    borderColor: 'var(--border)',
                    borderRadius: 4,
                    fontSize: 11,
                    color: 'var(--text-primary)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="mrr"
                  stroke="var(--violet)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorMrr)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Revenue by Plan */}
        <div className="p-3.5 rounded bg-surface border border-border flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xs font-semibold text-text-primary">Revenue by Tiered Plan</h2>
              <span className="text-[10px] text-text-muted font-mono">{tenants.length} tenants</span>
            </div>
            <p className="text-[10px] text-text-muted mb-3">Live subscription breakdown</p>

            <div className="space-y-3">
              {revenueByPlan.map((plan) => {
                const totalMrr = kpis.mrr;
                const pct = totalMrr > 0 ? Math.round((plan.totalMinor / totalMrr) * 100) : 0;
                return (
                  <div key={plan.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-text-secondary truncate">{plan.name}</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-text-muted text-[11px]">{plan.count} tenants</span>
                        <span className="font-semibold text-text-primary">
                          ${(plan.totalMinor / 100).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-surface-neutral rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-violet transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-text-muted font-mono">
                      <span>{pct}% of MRR</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-border mt-3 flex items-center justify-between text-xs">
            <span className="text-text-muted">Explore Plans Matrix</span>
            <button
              onClick={() => navigate('/admin/plans')}
              className="text-violet hover:underline flex items-center gap-1 font-medium cursor-pointer"
            >
              Plans & Pricing →
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: Tenant Geography & Live Audit Event Ticker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Geography */}
        <div className="p-3.5 rounded bg-surface border border-border">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-xs font-semibold text-text-primary">Global Tenant Footprint</h2>
              <p className="text-[10px] text-text-muted">Distribution by regulatory domicile</p>
            </div>
            <span className="text-[10px] font-mono text-text-muted">7 Markets</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
            {geoBreakdown.map((g) => (
              <div key={g.country} className="p-2 rounded bg-surface-neutral/50 border border-border/80">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-text-primary">{g.country}</span>
                  <span className="text-[10px] font-mono text-text-muted">{g.pct}%</span>
                </div>
                <div className="text-[11px] text-text-secondary mt-1">
                  <strong>{g.count}</strong> tenants
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Admin Audit Trail Ticker */}
        <div className="p-3.5 rounded bg-surface border border-border flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xs font-semibold text-text-primary">Live Operator Audit Stream</h2>
              <span className="text-[10px] font-mono text-success flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-success" />
                Hash Chain Verified
              </span>
            </div>
            <p className="text-[10px] text-text-muted mb-2">Immutable vendor back-office actions with SHA-256 seals</p>

            <div className="space-y-1.5 max-h-40 overflow-y-auto no-scrollbar divide-y divide-border/40">
              {auditEvents.slice(0, 4).map((event) => (
                <div key={event.id} className="pt-2 first:pt-0 flex flex-col sm:flex-row sm:items-start justify-between gap-1 text-xs">
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[9px] sm:text-[10px] font-semibold text-violet uppercase px-1 py-0.2 rounded bg-violet-soft shrink-0">
                        {event.action.replace('_', ' ')}
                      </span>
                      <span className="text-text-primary font-medium text-[11px] truncate">{event.adminName}</span>
                    </div>
                    <span className="text-[10px] text-text-muted mt-0.5 line-clamp-1">{event.reason}</span>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start shrink-0 font-mono text-[10px] text-text-muted">
                    <span>{new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="text-[9px] text-text-muted truncate max-w-[70px]">#{event.hash.slice(0, 6)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-border mt-2 flex items-center justify-between text-xs">
            <span className="text-text-muted">Full Audit History</span>
            <button
              onClick={() => navigate('/admin/staff')}
              className="text-violet hover:underline flex items-center gap-1 font-medium cursor-pointer"
            >
              View All Events →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
