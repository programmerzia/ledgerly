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
import { Download } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
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
      toast.success('ASC 606 deferred revenue schedule exported');
    } catch {
      toast.error('Failed to export revenue schedule');
    }
  };

  const money0 = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const atRiskCount = tenants.filter((t) => t.status === 'past_due').length;

  const figures: { label: string; value: string; valueClass?: string; note: string; sub: string; to?: string }[] = [
    { label: 'Monthly recurring revenue', value: money0(kpis.mrr), note: '+18.4% vs last month', sub: `Net new ${money0(kpis.netNewMrr)}` },
    { label: 'Annual run rate', value: money0(kpis.arr), note: '92.1% of $500k goal', sub: 'ARR multiple 12.0x' },
    {
      label: 'Total tenants', value: String(tenants.length), to: '/admin/tenants',
      note: `${kpis.activeTenantsCount} paid, ${kpis.trialingTenantsCount} trials`, sub: `Conversion ${kpis.trialConversionRate}%`,
    },
    { label: 'Net revenue retention', value: `${kpis.netRevenueRetentionPct}%`, note: `Gross retention ${kpis.grossRevenueRetentionPct}%`, sub: 'Logo churn 1.8% / month' },
    {
      label: 'At risk (dunning)', value: String(atRiskCount), valueClass: atRiskCount > 0 ? 'text-warning' : undefined, to: '/admin/billing',
      note: `${money0(kpis.failedPaymentsAmount)} unpaid`, sub: 'Recovery 82.5%',
    },
    { label: 'System health', value: '99.98%', to: '/admin/ops', note: `p95 ${kpis.systemP95LatencyMs} ms`, sub: 'Queues: 0 backlog' },
  ];

  const linkBtn = 'text-xs text-accent hover:underline cursor-pointer';

  return (
    <div className="flex-1 flex flex-col p-5 gap-5 max-w-7xl mx-auto w-full select-none text-text-primary">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Platform overview</h1>
          <p className="text-[13px] text-text-muted mt-0.5">
            Recurring revenue, retention, tenant lifecycle and platform health, mirrored from Stripe.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportAsc606}
          className="h-8 px-3 rounded-md bg-surface border border-border hover:border-border-strong text-text-secondary hover:text-text-primary text-[13px] font-medium flex items-center gap-1.5 transition cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-text-muted" />
          Export ASC 606 schedule
        </button>
      </div>

      <section className="bg-surface border border-border rounded-lg grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-border">
        {figures.map((f) => {
          const inner = (
            <>
              <div className="text-xs text-text-muted truncate">{f.label}</div>
              <div className={`mt-1 text-[22px] leading-7 font-medium tabular-nums truncate ${f.valueClass ?? 'text-text-primary'}`}>{f.value}</div>
              <div className="mt-1 text-xs text-text-secondary truncate">{f.note}</div>
              <div className="mt-0.5 text-xs text-text-muted truncate">{f.sub}</div>
            </>
          );
          const cls = 'text-left px-4 py-3 min-w-0';
          return f.to ? (
            <button key={f.label} type="button" onClick={() => navigate(f.to!)} className={`${cls} hover:bg-canvas transition-colors cursor-pointer outline-none focus-visible:bg-canvas`}>
              {inner}
            </button>
          ) : (
            <div key={f.label} className={cls}>{inner}</div>
          );
        })}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-lg bg-surface border border-border p-5">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-text-primary">Monthly recurring revenue</h2>
            <p className="text-xs text-text-muted">Last 14 months, from Stripe billing records</p>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockHistoricalCohorts} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => `$${Math.round(val / 100000)}k`}
                />
                <RechartsTooltip
                  formatter={(val: any) => [`$${(Number(val) / 100).toLocaleString()}`, 'MRR']}
                  contentStyle={{
                    backgroundColor: 'var(--surface-elevated)',
                    borderColor: 'var(--border)',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'var(--text-primary)',
                  }}
                />
                <Line type="linear" dataKey="mrr" stroke="var(--color-text-primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-lg bg-surface border border-border p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold text-text-primary">Revenue by plan</h2>
              <span className="text-xs text-text-muted tabular-nums">{tenants.length} tenants</span>
            </div>

            <ul className="divide-y divide-border">
              {revenueByPlan.map((plan) => {
                const pct = kpis.mrr > 0 ? Math.round((plan.totalMinor / kpis.mrr) * 100) : 0;
                return (
                  <li key={plan.name} className="py-2">
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="text-text-primary truncate flex-1">{plan.name}</span>
                      <span className="text-xs text-text-muted tabular-nums">{plan.count} tenants</span>
                      <span className="w-20 text-right tabular-nums text-text-primary">${(plan.totalMinor / 100).toLocaleString()}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1 flex-1 rounded-[1px] bg-surface-neutral" aria-hidden>
                        <div className="h-full rounded-[1px] bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-20 text-right text-xs text-text-muted tabular-nums">{pct}% of MRR</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="pt-3 border-t border-border mt-3 flex justify-end">
            <button onClick={() => navigate('/admin/plans')} className={linkBtn}>Plans and pricing</button>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg bg-surface border border-border p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-text-primary">Tenants by country</h2>
              <p className="text-xs text-text-muted">Regulatory domicile</p>
            </div>
            <span className="text-xs text-text-muted tabular-nums">{geoBreakdown.length} markets</span>
          </div>

          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-border">
              {geoBreakdown.map((g) => (
                <tr key={g.country}>
                  <td className="py-1.5 text-text-primary">{g.country}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-secondary">{g.count} tenants</td>
                  <td className="py-1.5 w-12 text-right tabular-nums text-text-muted">{g.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-lg bg-surface border border-border p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-text-primary">Operator audit trail</h2>
                <p className="text-xs text-text-muted">SHA-256 sealed</p>
              </div>
              <span className="text-xs text-success">Hash chain verified</span>
            </div>

            <ul className="max-h-48 overflow-y-auto no-scrollbar divide-y divide-border">
              {auditEvents.slice(0, 4).map((event) => (
                <li key={event.id} className="py-2 flex items-start justify-between gap-3 text-[13px]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-text-secondary px-1.5 py-px rounded-[3px] bg-surface-neutral shrink-0 capitalize">
                        {event.action.replace('_', ' ')}
                      </span>
                      <span className="text-text-primary font-medium truncate">{event.adminName}</span>
                    </div>
                    <span className="text-xs text-text-muted mt-0.5 line-clamp-1 block">{event.reason}</span>
                  </div>
                  <div className="flex flex-col items-end shrink-0 text-xs text-text-muted tabular-nums">
                    <span>{new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="truncate max-w-[70px]">#{event.hash.slice(0, 6)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-3 border-t border-border mt-3 flex justify-end">
            <button onClick={() => navigate('/admin/staff')} className={linkBtn}>View all events</button>
          </div>
        </section>
      </div>
    </div>
  );
};
