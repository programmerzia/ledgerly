/**
 * Trials & Growth Funnel per docs/10_SaaS_Admin.md §3.6.
 * Activation milestones checklist, conversion funnel analysis, expiring trials alerts,
 * and automated customer nudges.
 */

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '@/mock/store/adminStore';
import { AdminTenant } from '@/types/admin';
import { toast } from 'sonner';
import {
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Mail,
  Zap,
  ArrowRight,
  Building2,
  Users,
  CreditCard,
  Sparkles,
} from 'lucide-react';

export const GrowthTrials: React.FC = () => {
  const navigate = useNavigate();
  const { tenants, extendTenantTrial, changeTenantPlan } = useAdminStore();

  const [selectedMilestone, setSelectedMilestone] = useState<'all' | 'unactivated' | 'fully_activated'>('all');

  // Filter 18 trial tenants
  const trialTenants = useMemo(() => {
    return tenants.filter((t) => t.status === 'trialing');
  }, [tenants]);

  // Compute activation milestones for each trial tenant
  const tenantsWithMilestones = useMemo(() => {
    return trialTenants.map((t, idx) => {
      // Realistic synthetic milestones based on usage
      const hasCompany = t.companiesCount > 0;
      const hasInvoice = t.usage.journalLinesThisMonth > 0;
      const hasUser = t.usersCount > 1;
      const hasBank = t.usage.apiCallsToday > 0;
      const completedCount = [hasCompany, hasInvoice, hasUser, hasBank].filter(Boolean).length;
      const score = Math.round((completedCount / 4) * 100);

      // Expiry days calculation (assume 2026-10-28 baseline)
      const now = new Date('2026-10-28T00:00:00Z').getTime();
      const expiry = t.subscription.trialEndsAt ? new Date(t.subscription.trialEndsAt).getTime() : now + 5 * 86400000;
      const daysLeft = Math.max(0, Math.ceil((expiry - now) / 86400000));

      return {
        ...t,
        milestones: { hasCompany, hasInvoice, hasUser, hasBank, completedCount, score },
        daysLeft,
      };
    });
  }, [trialTenants]);

  // Expiring in 3 days
  const expiringSoon = tenantsWithMilestones.filter((t) => t.daysLeft <= 3);

  const handleNudge = (tenant: AdminTenant) => {
    toast.success(`Automated onboarding encouragement email dispatched to ${tenant.ownerEmail}!`);
  };

  const handleExtend = (tenantId: string) => {
    extendTenantTrial(tenantId, 7, 'Sales growth retention extension (7 days)');
    toast.success('Trial extended by 7 days.');
  };

  const handleConvert = (tenantId: string) => {
    changeTenantPlan(tenantId, 'professional', 'monthly', 'Manual sales closure conversion');
    toast.success('Tenant converted to Professional Plan ($149/mo)!');
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Trials Pipeline & Product-Led Growth</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold">
              {trialTenants.length} Active Trials • 64.2% Conversion
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Onboarding milestone activation, time-to-first-value tracking, and sales nudges.
          </p>
        </div>
      </div>

      {/* Funnel Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded bg-surface border border-border">
          <span className="text-[10px] text-text-muted uppercase font-semibold">Active Trials</span>
          <div className="text-xl font-bold font-mono text-text-primary mt-1">{trialTenants.length}</div>
          <span className="text-[10px] text-text-secondary mt-0.5 block">14-day standard window</span>
        </div>

        <div className="p-3.5 rounded bg-surface border border-border">
          <span className="text-[10px] text-text-muted uppercase font-semibold">Expiring &lt; 3 Days</span>
          <div className="text-xl font-bold font-mono text-warning mt-1">{expiringSoon.length}</div>
          <span className="text-[10px] text-warning mt-0.5 block font-medium">Requires immediate sales nudge</span>
        </div>

        <div className="p-3.5 rounded bg-surface border border-border">
          <span className="text-[10px] text-text-muted uppercase font-semibold">Median Time-to-Value</span>
          <div className="text-xl font-bold font-mono text-success mt-1">1.8 Days</div>
          <span className="text-[10px] text-text-secondary mt-0.5 block">Sign-up to first posted ledger journal</span>
        </div>

        <div className="p-3.5 rounded bg-surface border border-border">
          <span className="text-[10px] text-text-muted uppercase font-semibold">Trial-to-Paid Win Rate</span>
          <div className="text-xl font-bold font-mono text-violet mt-1">64.2%</div>
          <span className="text-[10px] text-success mt-0.5 block font-medium">+6.4% QoQ expansion</span>
        </div>
      </div>

      {/* Activation Milestones Matrix */}
      <div className="rounded bg-surface border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Product Activation Milestones (Time-to-First-Value)
            </h3>
            <p className="text-[11px] text-text-muted">Tenants who complete all 4 milestones convert at 88%</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="h-8 bg-surface-neutral/60 border-b border-border text-text-muted text-[11px] uppercase font-semibold">
                <th className="px-3">Tenant Organization</th>
                <th className="px-3 text-center">1. Created Entity</th>
                <th className="px-3 text-center">2. Posted Invoice</th>
                <th className="px-3 text-center">3. Invited Checker</th>
                <th className="px-3 text-center">4. Bank Feed</th>
                <th className="px-3">Activation Score</th>
                <th className="px-3">Days Left</th>
                <th className="px-3 text-right">Growth Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {tenantsWithMilestones.map((t) => (
                <tr key={t.id} className="h-9 hover:bg-surface-neutral/50 transition-colors">
                  <td className="px-3 font-semibold text-text-primary">
                    <div className="flex flex-col">
                      <span>{t.name}</span>
                      <span className="text-[10px] font-mono text-text-muted">{t.ownerEmail}</span>
                    </div>
                  </td>

                  {/* Milestone 1 */}
                  <td className="px-3 text-center">
                    {t.milestones.hasCompany ? (
                      <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-border mx-auto block" />
                    )}
                  </td>

                  {/* Milestone 2 */}
                  <td className="px-3 text-center">
                    {t.milestones.hasInvoice ? (
                      <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-border mx-auto block" />
                    )}
                  </td>

                  {/* Milestone 3 */}
                  <td className="px-3 text-center">
                    {t.milestones.hasUser ? (
                      <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-border mx-auto block" />
                    )}
                  </td>

                  {/* Milestone 4 */}
                  <td className="px-3 text-center">
                    {t.milestones.hasBank ? (
                      <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-border mx-auto block" />
                    )}
                  </td>

                  {/* Score */}
                  <td className="px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 bg-surface-neutral rounded-full overflow-hidden">
                        <div
                          className={`h-full ${t.milestones.score >= 75 ? 'bg-success' : t.milestones.score >= 50 ? 'bg-accent' : 'bg-warning'}`}
                          style={{ width: `${t.milestones.score}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-text-secondary">{t.milestones.score}%</span>
                    </div>
                  </td>

                  {/* Days left */}
                  <td className="px-3 font-mono text-[11px]">
                    <span className={t.daysLeft <= 3 ? 'text-warning font-bold' : 'text-text-muted'}>
                      {t.daysLeft} days
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleNudge(t)}
                        className="p-1 rounded hover:bg-surface-neutral text-text-muted hover:text-text-primary"
                        title="Dispatch Nudge Email"
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExtend(t.id)}
                        className="px-2 py-0.5 rounded text-[11px] border border-border hover:bg-surface-neutral text-text-secondary font-medium"
                      >
                        +7d
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConvert(t.id)}
                        className="px-2 py-0.5 rounded text-[11px] bg-violet text-white hover:opacity-90 font-semibold shadow-xs"
                      >
                        Convert
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
