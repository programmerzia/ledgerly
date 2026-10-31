/**
 * Tenant 10-Tab Detail Page per docs/10_SaaS_Admin.md §3.2 and §10.
 * Interactive state machines: plan change with proration preview, extend trial,
 * apply coupon, refund with two-person approval, impersonate, and GDPR export.
 */

import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAdminStore } from '@/mock/store/adminStore';
import { PlanCode } from '@/types/admin';
import { StatusPill } from '@/components/domain/StatusPill';
import { toast } from 'sonner';
import {
  Building2,
  ArrowLeft,
  UserCheck,
  CreditCard,
  Layers,
  Users,
  Activity,
  Flag,
  Wrench,
  FileText,
  History,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RotateCcw,
  Download,
  ShieldAlert,
  Percent,
  Calendar,
  KeyRound,
  FileDown,
  Lock,
  Plus,
} from 'lucide-react';

export const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const {
    tenants,
    plans,
    invoices,
    featureFlags,
    auditEvents,
    changeTenantPlan,
    extendTenantTrial,
    applyCouponToTenant,
    suspendTenant,
    reactivateTenant,
    startImpersonation,
    requestRefundApproval,
    createGdprRequest,
    toggleFeatureFlagTenantOverride,
  } = useAdminStore();

  const tenant = useAdminStore((s) =>
    s.tenants.find(
      (t) =>
        t.id === id ||
        t.slug === id ||
        t.id.includes(id || '') ||
        (id === 't-acme' && t.slug.includes('acme')) ||
        (id && t.slug.includes(id.replace(/^t(en)?-/, '')))
    ) || s.tenants[0]
  );

  // Active Tab
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // Modals state
  const [showPlanChangeModal, setShowPlanChangeModal] = useState(false);
  const [targetPlanCode, setTargetPlanCode] = useState<PlanCode>('business');
  const [targetInterval, setTargetInterval] = useState<'monthly' | 'annual'>('monthly');
  const [planChangeReason, setPlanChangeReason] = useState('Customer requested upgrade to unlock approval workflows');

  const [showExtendTrialModal, setShowExtendTrialModal] = useState(false);
  const [trialDaysToAdd, setTrialDaysToAdd] = useState(14);
  const [trialReason, setTrialReason] = useState('Executive demo evaluation window extension');

  const [showCouponModal, setShowCouponModal] = useState(false);
  const [couponCodeInput, setCouponCodeInput] = useState('PARTNER20');

  const [showRefundModal, setShowRefundModal] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [refundAmountMinor, setRefundAmountMinor] = useState(14900);
  const [refundReason, setRefundReason] = useState('Annual billing goodwill concession');

  const [internalNote, setInternalNote] = useState('');
  const [notesList, setNotesList] = useState<string[]>([
    'Customer onboarded by East Africa regional partner BDO Somalia.',
    'Met with CFO Kenneth Mwangi; requested SOC-2 Type II audit certificate.',
  ]);

  if (!tenant) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <Building2 className="w-10 h-10 text-text-muted mb-2" />
        <h2 className="text-sm font-semibold">Tenant Not Found</h2>
        <p className="text-xs text-text-muted mt-1">Tenant ID "{id}" does not exist in registry.</p>
        <button
          onClick={() => navigate('/admin/tenants')}
          className="mt-4 px-3 py-1.5 rounded bg-violet text-white text-xs font-medium cursor-pointer"
        >
          ← Back to Tenants
        </button>
      </div>
    );
  }

  // Tenant Invoices
  const tenantInvoices = invoices.filter((inv) => inv.tenantId === tenant.id);

  // Tenant Audit Events
  const tenantAudit = auditEvents.filter((a) => a.tenantId === tenant.id);

  // Proration Calculation Preview
  const prorationPreview = useMemo(() => {
    const currentAmount = tenant.subscription.amount;
    const plan = plans.find((p) => p.code === targetPlanCode);
    if (!plan) return { credit: 0, newCharge: 0, net: 0 };
    const newPriceMonthly = plan.currentVersion.prices.USD?.monthly || 4900;
    const newAmount = targetInterval === 'annual' ? plan.currentVersion.prices.USD?.annual || 49000 : newPriceMonthly;
    const credit = Math.round(currentAmount * 0.45); // Unused time credit
    const net = Math.max(0, newAmount - credit);
    return { credit, newCharge: newAmount, net };
  }, [tenant, targetPlanCode, targetInterval, plans]);

  // Actions
  const handleConfirmPlanChange = () => {
    try {
      const result = changeTenantPlan(tenant.id, targetPlanCode, targetInterval, planChangeReason);
      setShowPlanChangeModal(false);
      toast.success(
        `Plan upgraded to ${targetPlanCode.toUpperCase()}! Net charge: $${(result.netPayable / 100).toFixed(2)}`
      );
    } catch (err: any) {
      toast.error(err.message || 'Plan change failed');
    }
  };

  const handleConfirmExtendTrial = () => {
    try {
      extendTenantTrial(tenant.id, trialDaysToAdd, trialReason);
      setShowExtendTrialModal(false);
      toast.success(`Trial extended by ${trialDaysToAdd} days for ${tenant.name}.`);
    } catch (err: any) {
      toast.error(err.message || 'Extend trial failed');
    }
  };

  const handleConfirmApplyCoupon = () => {
    try {
      applyCouponToTenant(tenant.id, couponCodeInput.toUpperCase());
      setShowCouponModal(false);
      toast.success(`Coupon ${couponCodeInput.toUpperCase()} applied to ${tenant.name}.`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply coupon');
    }
  };

  const handleInitiateRefund = () => {
    try {
      requestRefundApproval(selectedInvoiceId, refundAmountMinor, refundReason);
      setShowRefundModal(false);
      toast.success(
        `Refund request for $${(refundAmountMinor / 100).toFixed(2)} submitted to Dual-Approval Queue (Maker/Checker).`
      );
    } catch (err: any) {
      toast.error(err.message || 'Refund request failed');
    }
  };

  const handleImpersonate = (mode: 'read' | 'write' = 'read') => {
    try {
      startImpersonation(tenant.id, mode, `Operator investigation for tenant ${tenant.name}`);
      toast.success(`Impersonating ${tenant.name} in ${mode.toUpperCase()} mode.`);
      navigate('/acme/dashboard');
    } catch (err: any) {
      toast.error(err.message || 'Impersonation failed');
    }
  };

  const handleGdprExport = () => {
    createGdprRequest(tenant.id, 'export', 'Staff Operator', tenant.ownerEmail);
    toast.success(`GDPR Article 20 Data Portability Export initiated for ${tenant.ownerEmail}`);
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalNote.trim()) return;
    setNotesList((prev) => [internalNote.trim(), ...prev]);
    setInternalNote('');
    toast.success('Internal staff note appended');
  };

  const tabs = [
    { id: 'overview', label: '1. Overview', icon: Building2 },
    { id: 'subscription', label: '2. Subscription & Proration', icon: CreditCard },
    { id: 'invoices', label: '3. Invoices & Refunds', icon: FileText },
    { id: 'usage', label: '4. Usage Meters', icon: Activity },
    { id: 'users', label: '5. Users & 2FA', icon: Users },
    { id: 'companies', label: '6. Companies', icon: Layers },
    { id: 'flags', label: '7. Pennant Flags', icon: Flag },
    { id: 'support', label: '8. Support & Impersonate', icon: Wrench },
    { id: 'notes', label: '9. Notes & Tickets', icon: FileDown },
    { id: 'audit', label: '10. Staff Audit Chain', icon: History },
  ];

  return (
    <div className="flex-1 flex flex-col p-4 space-y-3 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Top Breadcrumb & Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div className="flex items-start sm:items-center gap-2.5">
          <button
            onClick={() => navigate('/admin/tenants')}
            className="p-1 mt-0.5 sm:mt-0 rounded hover:bg-surface-neutral text-text-muted hover:text-text-primary transition cursor-pointer shrink-0"
            title="Back to Tenants List"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight">{tenant.name}</h1>
              <span className="font-mono text-xs text-text-muted">({tenant.slug})</span>
              <StatusPill status={tenant.status as any} />
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-soft text-violet font-semibold uppercase">
                {tenant.subscription.planCode}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted mt-0.5">
              <span>Primary: {tenant.ownerName} ({tenant.ownerEmail})</span>
              <span className="hidden sm:inline">•</span>
              <span>Domicile: {tenant.country} ({tenant.dataResidency})</span>
            </div>
          </div>
        </div>

        {/* Global Tenant Actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleImpersonate('read')}
            className="h-7 px-2.5 rounded-sm bg-violet text-white hover:opacity-90 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Impersonate (Read)</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPlanChangeModal(true)}
            className="h-7 px-2.5 rounded-sm bg-surface border border-border hover:border-border-strong text-text-primary text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <CreditCard className="w-3.5 h-3.5 text-text-muted" />
            <span>Change Plan</span>
          </button>

          {tenant.status === 'suspended' ? (
            <button
              type="button"
              onClick={() => reactivateTenant(tenant.id, 'Operator manual reactivation')}
              className="h-7 px-2.5 rounded-sm bg-success text-white hover:opacity-90 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reactivate</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => suspendTenant(tenant.id, 'Operator manual suspension')}
              className="h-7 px-2.5 rounded-sm bg-surface border border-danger/40 hover:bg-danger-soft text-danger text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            >
              <span>Suspend</span>
            </button>
          )}
        </div>
      </div>

      {/* 10-Tab Navigation Bar */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto no-scrollbar flex-nowrap shrink-0 whitespace-nowrap text-xs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'border-violet text-violet font-semibold'
                  : 'border-transparent text-text-muted hover:text-text-primary hover:border-border'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded bg-surface border border-border space-y-2">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Subscription & Pricing
              </span>
              <div className="flex justify-between py-1 border-b border-border/40 text-xs">
                <span className="text-text-muted">Monthly Recurring MRR</span>
                <span className="font-mono font-bold text-text-primary">
                  ${(tenant.subscription.amount / 100).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/40 text-xs">
                <span className="text-text-muted">Billing Cycle</span>
                <span className="font-mono capitalize text-text-secondary">
                  {tenant.subscription.billingInterval}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/40 text-xs">
                <span className="text-text-muted">Next Renewal / Invoice</span>
                <span className="font-mono text-text-secondary">
                  {tenant.subscription.currentPeriodEnd}
                </span>
              </div>
              <div className="flex justify-between py-1 text-xs">
                <span className="text-text-muted">Stripe Customer ID</span>
                <span className="font-mono text-accent text-[11px]">{tenant.subscription.stripeCustomerId}</span>
              </div>
            </div>

            <div className="p-3.5 rounded bg-surface border border-border space-y-2">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Primary Contact & Security
              </span>
              <div className="text-xs font-semibold text-text-primary">{tenant.ownerName}</div>
              <div className="text-[11px] font-mono text-text-muted">{tenant.ownerEmail}</div>
              <div className="text-[11px] text-text-muted">Direct Support Link: Tier 1 SLA</div>
              <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px]">
                <span className="text-text-muted">Data Residency</span>
                <span className="font-mono text-success font-medium">{tenant.dataResidency} (Local Vault)</span>
              </div>
            </div>

            <div className="p-3.5 rounded bg-surface border border-border space-y-2">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Lifecycle & Health
              </span>
              <div className="flex justify-between py-1 border-b border-border/40 text-xs">
                <span className="text-text-muted">Health Rating</span>
                <span className="font-mono font-bold text-success">{tenant.healthScore} / 100</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/40 text-xs">
                <span className="text-text-muted">Created Date</span>
                <span className="font-mono text-text-muted">{new Date(tenant.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between py-1 text-xs">
                <span className="text-text-muted">Last Activity</span>
                <span className="font-mono text-text-muted">{new Date(tenant.lastActivityAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Usage vs Limits Quotas */}
          <div className="p-4 rounded bg-surface border border-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">
                Service Entitlements vs Metered Usage
              </h3>
              <span className="text-[11px] text-text-muted font-mono">Soft limits warn at 80%</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 p-3 rounded bg-surface-neutral/40 border border-border/60">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Companies Enrolled</span>
                  <span className="font-mono font-semibold">
                    {tenant.companiesCount} / {tenant.subscription.planCode === 'enterprise' ? 10 : 5}
                  </span>
                </div>
                <div className="h-2 w-full bg-surface-neutral rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet"
                    style={{ width: `${(tenant.companiesCount / (tenant.subscription.planCode === 'enterprise' ? 10 : 5)) * 100}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5 p-3 rounded bg-surface-neutral/40 border border-border/60">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">User Seats (Makers & Checkers)</span>
                  <span className="font-mono font-semibold">
                    {tenant.usersCount} / {tenant.subscription.planCode === 'enterprise' ? 50 : 15}
                  </span>
                </div>
                <div className="h-2 w-full bg-surface-neutral rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${(tenant.usersCount / (tenant.subscription.planCode === 'enterprise' ? 50 : 15)) * 100}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5 p-3 rounded bg-surface-neutral/40 border border-border/60">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Monthly Journal Lines</span>
                  <span className="font-mono font-semibold">
                    {tenant.usage.journalLinesThisMonth.toLocaleString()} / {tenant.subscription.planCode === 'enterprise' ? '100,000' : '25,000'}
                  </span>
                </div>
                <div className="h-2 w-full bg-surface-neutral rounded-full overflow-hidden">
                  <div
                    className="h-full bg-success"
                    style={{
                      width: `${Math.min(100, (tenant.usage.journalLinesThisMonth / 25000) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Subscription & Proration */}
      {activeTab === 'subscription' && (
        <div className="space-y-4">
          <div className="p-4 rounded bg-surface border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-text-muted uppercase">Active Subscription</span>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-text-primary capitalize">{tenant.subscription.planCode} Plan</h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface-neutral font-semibold">
                  ${(tenant.subscription.amount / 100).toFixed(2)} / {tenant.subscription.billingInterval}
                </span>
                {tenant.subscription.discountCouponId && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-success-soft text-success font-semibold">
                    Coupon: {tenant.subscription.discountCouponId} ({tenant.subscription.discountPercent}% OFF)
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted">
                Managed via Stripe Billing API. Current billing period ends on {tenant.subscription.currentPeriodEnd}.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPlanChangeModal(true)}
                className="h-8 px-3 rounded-sm bg-violet text-white hover:opacity-90 text-xs font-medium cursor-pointer shadow-xs"
              >
                Change Plan / Upgrade
              </button>
              {tenant.status === 'trialing' && (
                <button
                  type="button"
                  onClick={() => setShowExtendTrialModal(true)}
                  className="h-8 px-3 rounded-sm bg-surface border border-border hover:border-border-strong text-text-primary text-xs font-medium cursor-pointer"
                >
                  Extend 14-Day Trial
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCouponModal(true)}
                className="h-8 px-3 rounded-sm bg-surface border border-border hover:border-border-strong text-text-primary text-xs font-medium cursor-pointer"
              >
                Apply Coupon Code
              </button>
            </div>
          </div>

          {/* Stripe Subscription Breakdown */}
          <div className="rounded bg-surface border border-border p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Subscription Line Items
            </h4>
            <div className="divide-y divide-border/60 text-xs">
              <div className="py-2 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-text-primary capitalize">{tenant.subscription.planCode} Base License</div>
                  <div className="text-[10px] text-text-muted">
                    Includes {plans.find((p) => p.code === tenant.subscription.planCode)?.currentVersion.limits.companies ?? 3} companies & {plans.find((p) => p.code === tenant.subscription.planCode)?.currentVersion.limits.users ?? 5} users
                  </div>
                </div>
                <div className="font-mono font-semibold text-text-primary">
                  ${(tenant.subscription.amount / 100).toFixed(2)}
                </div>
              </div>
              <div className="py-2 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-text-primary">Stripe Automated Tax (VAT/GST)</div>
                  <div className="text-[10px] text-text-muted">Jurisdiction: {tenant.country} (Reverse-charge registered)</div>
                </div>
                <div className="font-mono text-text-secondary">$0.00 (Exempt)</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Invoices & Payments */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Mirrored Stripe Invoices ({tenantInvoices.length})
            </h3>
            <span className="text-[10px] font-mono text-text-muted">Two-person approval enforced for refunds</span>
          </div>

          <div className="rounded bg-surface border border-border overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="h-8 bg-surface-neutral/60 border-b border-border text-text-muted text-[11px] uppercase font-semibold">
                  <th className="px-3">Invoice Number</th>
                  <th className="px-3">Issued Date</th>
                  <th className="px-3">Status</th>
                  <th className="px-3 text-right">Amount</th>
                  <th className="px-3">Dunning</th>
                  <th className="px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {tenantInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-text-muted text-xs">
                      No invoices recorded yet (Tenant in trialing state).
                    </td>
                  </tr>
                ) : (
                  tenantInvoices.map((inv) => (
                    <tr key={inv.id} className="h-9 hover:bg-surface-neutral/50">
                      <td className="px-3 font-mono font-semibold text-text-primary">{inv.number}</td>
                      <td className="px-3 font-mono text-text-muted">{inv.paidAt || inv.dueAt}</td>
                      <td className="px-3"><StatusPill status={inv.status as any} /></td>
                      <td className="px-3 text-right font-mono font-bold text-text-primary">
                        ${(inv.total / 100).toFixed(2)}
                      </td>
                      <td className="px-3 font-mono text-[11px] text-text-muted">Stage {inv.dunningStage}</td>
                      <td className="px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => toast.success(`Downloaded PDF for invoice ${inv.number}`)}
                            className="p-1 rounded hover:bg-surface-neutral text-text-muted hover:text-text-primary"
                            title="Download PDF"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          {inv.status === 'paid' && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedInvoiceId(inv.id);
                                setRefundAmountMinor(inv.total);
                                setShowRefundModal(true);
                              }}
                              className="px-2 py-0.5 rounded text-[11px] bg-danger-soft text-danger hover:opacity-90 font-medium cursor-pointer"
                            >
                              Request Refund
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Usage Meters */}
      {activeTab === 'usage' && (
        <div className="space-y-4">
          <div className="p-4 rounded bg-surface border border-border space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Daily Metered Resource Consumption
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded bg-surface-neutral/50 border border-border">
                <span className="text-[10px] text-text-muted uppercase">Journal Lines Posted</span>
                <div className="text-lg font-mono font-bold text-text-primary mt-1">
                  {tenant.usage.journalLinesThisMonth.toLocaleString()}
                </div>
                <div className="text-[10px] text-success mt-0.5">Under monthly threshold</div>
              </div>

              <div className="p-3 rounded bg-surface-neutral/50 border border-border">
                <span className="text-[10px] text-text-muted uppercase">API Requests (24h)</span>
                <div className="text-lg font-mono font-bold text-text-primary mt-1">
                  {tenant.usage.apiCallsToday.toLocaleString()}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">Rate Limit: 1,000 req/min</div>
              </div>

              <div className="p-3 rounded bg-surface-neutral/50 border border-border">
                <span className="text-[10px] text-text-muted uppercase">Encrypted Storage</span>
                <div className="text-lg font-mono font-bold text-text-primary mt-1">
                  {(tenant.usage.storageMbUsed / 1024).toFixed(1)} GB
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">Cap: 50 GB</div>
              </div>

              <div className="p-3 rounded bg-surface-neutral/50 border border-border">
                <span className="text-[10px] text-text-muted uppercase">Active Bank Feeds</span>
                <div className="text-lg font-mono font-bold text-text-primary mt-1">
                  2 Active
                </div>
                <div className="text-[10px] text-success mt-0.5">Direct Plaid / API link</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Users */}
      {activeTab === 'users' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Enrolled Users & Access Controls ({tenant.usersCount})
            </h3>
            <span className="text-[10px] text-text-muted font-mono">2FA Enforced for all roles</span>
          </div>

          <div className="rounded bg-surface border border-border overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="h-8 bg-surface-neutral/60 border-b border-border text-text-muted text-[11px] uppercase font-semibold">
                  <th className="px-3">Name & Email</th>
                  <th className="px-3">Tenant Role</th>
                  <th className="px-3">2FA State</th>
                  <th className="px-3">Last Login</th>
                  <th className="px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                <tr className="h-9 hover:bg-surface-neutral/50">
                  <td className="px-3 py-1">
                    <div className="font-semibold text-text-primary">{tenant.ownerName}</div>
                    <div className="text-[10px] font-mono text-text-muted">{tenant.ownerEmail}</div>
                  </td>
                  <td className="px-3 font-medium text-violet">Owner / Admin</td>
                  <td className="px-3">
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-success-soft text-success">
                      Verified (TOTP)
                    </span>
                  </td>
                  <td className="px-3 font-mono text-[11px] text-text-muted">{new Date(tenant.lastActivityAt).toLocaleString()}</td>
                  <td className="px-3 text-right">
                    <button
                      type="button"
                      onClick={() => toast.success(`Reset 2FA instructions dispatched to ${tenant.ownerEmail}`)}
                      className="px-2 py-0.5 rounded border border-border text-[11px] hover:bg-surface-neutral"
                    >
                      Reset 2FA
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 6: Companies */}
      {activeTab === 'companies' && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
            Operating Legal Entities ({tenant.companiesCount})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded bg-surface border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-text-primary">Acme Trading Ltd</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-surface-neutral text-text-secondary">
                  USD
                </span>
              </div>
              <div className="text-text-muted text-[11px]">Primary Operating Entity • Domicile: Somalia</div>
              <div className="pt-2 border-t border-border/40 flex justify-between text-[11px] font-mono text-text-secondary">
                <span>Fiscal Year: 2026</span>
                <span className="text-success font-semibold">Active Posting Period: 2026-10</span>
              </div>
            </div>

            <div className="p-3.5 rounded bg-surface border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-text-primary">Acme Logistics East Africa</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-surface-neutral text-text-secondary">
                  KES
                </span>
              </div>
              <div className="text-text-muted text-[11px]">Subsidiary Entity • Domicile: Kenya</div>
              <div className="pt-2 border-t border-border/40 flex justify-between text-[11px] font-mono text-text-secondary">
                <span>Fiscal Year: 2026</span>
                <span className="text-success font-semibold">Active Posting Period: 2026-10</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 7: Pennant Feature Flags */}
      {activeTab === 'flags' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Pennant Feature Flag Overrides
              </h3>
              <p className="text-[11px] text-text-muted">Override global rollout percentages for this specific tenant instance</p>
            </div>
          </div>

          <div className="rounded bg-surface border border-border divide-y divide-border/60 text-xs">
            {featureFlags.map((flag) => {
              const override = flag.tenantOverrides ? flag.tenantOverrides[tenant.id] : undefined;
              const isEnabled = override !== undefined ? override : flag.globalDefault;

              return (
                <div key={flag.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-text-primary">{flag.name}</div>
                    <div className="text-[11px] text-text-muted">{flag.description}</div>
                    <div className="text-[10px] font-mono text-violet mt-0.5">Key: {flag.key}</div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-mono text-text-muted">
                      {override !== undefined ? 'Tenant Override' : `Default (${flag.rolloutPercentage}%)`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        toggleFeatureFlagTenantOverride(flag.id, tenant.id, !isEnabled);
                        toast.success(`Flag ${flag.key} updated for ${tenant.name}`);
                      }}
                      className={`h-6 px-3 rounded text-xs font-medium cursor-pointer transition ${
                        isEnabled ? 'bg-success text-white' : 'bg-surface-neutral text-text-muted'
                      }`}
                    >
                      {isEnabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 8: Support Tools */}
      {activeTab === 'support' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-4 rounded bg-surface border border-border space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Staff Impersonation Diagnostics
              </h3>
              <p className="text-xs text-text-muted">
                Inspect customer books directly. Read-only mode prevents accidental modifications.
                Audit seal recorded automatically.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleImpersonate('read')}
                  className="h-8 px-3 rounded-sm bg-violet text-white text-xs font-medium hover:opacity-90 flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Start Read-Only Session</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    toast.info('Write-mode requires a second approver request.');
                    navigate('/admin/staff');
                  }}
                  className="h-8 px-3 rounded-sm bg-surface border border-border text-text-primary text-xs font-medium hover:bg-surface-neutral flex items-center gap-1.5 cursor-pointer"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-warning" />
                  <span>Request Write Mode</span>
                </button>
              </div>
            </div>

            <div className="p-4 rounded bg-surface border border-border space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Compliance & Data Portability
              </h3>
              <p className="text-xs text-text-muted">
                Execute GDPR Article 20 data takeout export or trigger tamper-evident cryptographic hash seal verification.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleGdprExport}
                  className="h-8 px-3 rounded-sm bg-surface border border-border hover:border-border-strong text-text-primary text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-text-muted" />
                  <span>Trigger GDPR Export</span>
                </button>
                <button
                  type="button"
                  onClick={() => toast.success('Tamper-evident ledger integrity verified. All journal blocks match SHA-256 seal.')}
                  className="h-8 px-3 rounded-sm bg-surface border border-border hover:border-border-strong text-text-primary text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                  <span>Verify Ledger Seal</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 9: Notes & Tickets */}
      {activeTab === 'notes' && (
        <div className="space-y-4">
          <form onSubmit={handleAddNote} className="p-3.5 rounded bg-surface border border-border space-y-2">
            <label className="text-xs font-semibold text-text-primary">Add Internal Support Note</label>
            <textarea
              rows={2}
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              placeholder="Record support diagnostic notes, account manager context, or concessions..."
              className="w-full p-2 bg-surface-neutral/60 border border-border rounded-sm text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                className="h-7 px-3 rounded bg-violet text-white text-xs font-medium hover:opacity-90 cursor-pointer shadow-xs"
              >
                Post Note
              </button>
            </div>
          </form>

          <div className="space-y-2">
            {notesList.map((note, idx) => (
              <div key={idx} className="p-3 rounded bg-surface border border-border text-xs space-y-1">
                <div className="flex items-center justify-between text-text-muted text-[10px] font-mono">
                  <span>Staff Note #{notesList.length - idx}</span>
                  <span>Pinned Note</span>
                </div>
                <p className="text-text-primary">{note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 10: Staff Audit Chain */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Cryptographic Staff Audit Chain ({tenantAudit.length} events)
            </h3>
            <span className="text-[10px] font-mono text-success flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-success" />
              SHA-256 Tamper-Evident Chain
            </span>
          </div>

          <div className="rounded bg-surface border border-border overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="h-8 bg-surface-neutral/60 border-b border-border text-text-muted text-[11px] uppercase font-semibold">
                  <th className="px-3">Timestamp</th>
                  <th className="px-3">Operator</th>
                  <th className="px-3">Action</th>
                  <th className="px-3">Reason / Context</th>
                  <th className="px-3 text-right">Block Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {tenantAudit.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-text-muted text-xs">
                      No admin mutations recorded for this tenant yet.
                    </td>
                  </tr>
                ) : (
                  tenantAudit.map((a) => (
                    <tr key={a.id} className="h-9 hover:bg-surface-neutral/50">
                      <td className="px-3 font-mono text-text-muted">{new Date(a.occurredAt).toLocaleString()}</td>
                      <td className="px-3 font-semibold text-text-primary">{a.adminName}</td>
                      <td className="px-3">
                        <span className="px-1.5 py-0.2 rounded bg-violet-soft text-violet font-mono text-[10px] font-bold uppercase">
                          {a.action}
                        </span>
                      </td>
                      <td className="px-3 text-text-secondary truncate max-w-[280px]">{a.reason}</td>
                      <td className="px-3 text-right font-mono text-[10px] text-text-muted">
                        {a.hash.slice(0, 10)}...
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Plan Change Modal with Proration Preview */}
      {showPlanChangeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg bg-surface border border-border rounded-lg shadow-xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Change Subscription Plan</h3>
              <span className="text-xs font-mono text-violet capitalize">Current: {tenant.subscription.planCode}</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-text-secondary block mb-1">Target Plan</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['starter', 'professional', 'business', 'enterprise'] as PlanCode[]).map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setTargetPlanCode(code)}
                      className={`p-2 rounded border text-left cursor-pointer transition ${
                        targetPlanCode === code
                          ? 'border-violet bg-violet-soft/30 font-semibold'
                          : 'border-border bg-surface hover:border-border-strong'
                      }`}
                    >
                      <div className="capitalize font-bold text-text-primary">{code}</div>
                      <div className="text-[10px] text-text-muted">
                        ${code === 'starter' ? '49' : code === 'professional' ? '149' : code === 'business' ? '349' : '899'}/mo
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-semibold text-text-secondary block mb-1">Billing Interval</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetInterval('monthly')}
                    className={`py-1.5 px-3 rounded border text-center font-medium cursor-pointer ${
                      targetInterval === 'monthly' ? 'border-violet bg-violet-soft/30 text-violet' : 'border-border'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetInterval('annual')}
                    className={`py-1.5 px-3 rounded border text-center font-medium cursor-pointer ${
                      targetInterval === 'annual' ? 'border-violet bg-violet-soft/30 text-violet' : 'border-border'
                    }`}
                  >
                    Annual (Save 15%)
                  </button>
                </div>
              </div>

              {/* Live Proration Breakdown Box */}
              <div className="p-3 rounded bg-surface-neutral border border-border space-y-1.5 font-mono text-xs">
                <div className="text-[10px] font-bold text-text-muted uppercase">Proration Preview (Stripe Engine)</div>
                <div className="flex justify-between">
                  <span className="text-text-muted">New Plan Base:</span>
                  <span>${(prorationPreview.newCharge / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-success">
                  <span>Unused Time Credit:</span>
                  <span>-${(prorationPreview.credit / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-border font-bold text-text-primary">
                  <span>Net Charged Today:</span>
                  <span className="text-violet">${(prorationPreview.net / 100).toFixed(2)}</span>
                </div>
              </div>

              <div>
                <label className="font-semibold text-text-secondary block mb-1">Operator Reason (Audit Log)</label>
                <input
                  type="text"
                  value={planChangeReason}
                  onChange={(e) => setPlanChangeReason(e.target.value)}
                  className="w-full h-8 px-2.5 bg-surface border border-border rounded text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPlanChangeModal(false)}
                className="h-8 px-3 rounded border border-border hover:bg-surface-neutral text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPlanChange}
                className="h-8 px-4 rounded bg-violet text-white hover:opacity-90 text-xs font-semibold cursor-pointer shadow-xs"
              >
                Apply Plan & Prorate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Trial Modal */}
      {showExtendTrialModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-lg shadow-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-text-primary">Extend Customer Trial Period</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-text-secondary block mb-1">Days to Add</label>
                <div className="grid grid-cols-3 gap-2">
                  {[7, 14, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setTrialDaysToAdd(d)}
                      className={`py-1.5 rounded border text-center font-mono cursor-pointer ${
                        trialDaysToAdd === d ? 'border-violet bg-violet-soft/30 text-violet font-bold' : 'border-border'
                      }`}
                    >
                      +{d} Days
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-semibold text-text-secondary block mb-1">Reason for Extension</label>
                <input
                  type="text"
                  value={trialReason}
                  onChange={(e) => setTrialReason(e.target.value)}
                  className="w-full h-8 px-2.5 bg-surface border border-border rounded text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExtendTrialModal(false)}
                className="h-8 px-3 rounded border border-border hover:bg-surface-neutral text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmExtendTrial}
                className="h-8 px-4 rounded bg-violet text-white hover:opacity-90 text-xs font-semibold cursor-pointer"
              >
                Confirm Extension
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply Coupon Modal */}
      {showCouponModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-lg shadow-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-text-primary">Apply Promotional Coupon</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-text-secondary block mb-1">Coupon Code</label>
                <input
                  type="text"
                  value={couponCodeInput}
                  onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                  placeholder="e.g. PARTNER20 or LAUNCH50"
                  className="w-full h-8 px-2.5 font-mono bg-surface border border-border rounded text-xs uppercase"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCouponModal(false)}
                className="h-8 px-3 rounded border border-border hover:bg-surface-neutral text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApplyCoupon}
                className="h-8 px-4 rounded bg-violet text-white hover:opacity-90 text-xs font-semibold cursor-pointer"
              >
                Apply Discount
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Request Dual-Approval Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-lg shadow-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-warning">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-text-primary">Request Stripe Refund (Dual-Approval)</h3>
            </div>
            <p className="text-xs text-text-muted">
              Refunds require two-person verification (Finance or Owner sign-off).
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-text-secondary block mb-1">Refund Amount ($)</label>
                <input
                  type="number"
                  value={(refundAmountMinor / 100).toFixed(2)}
                  onChange={(e) => setRefundAmountMinor(Math.round(parseFloat(e.target.value || '0') * 100))}
                  className="w-full h-8 px-2.5 font-mono bg-surface border border-border rounded text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-text-secondary block mb-1">Commercial Justification</label>
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full h-8 px-2.5 bg-surface border border-border rounded text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRefundModal(false)}
                className="h-8 px-3 rounded border border-border hover:bg-surface-neutral text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInitiateRefund}
                className="h-8 px-4 rounded bg-danger text-white hover:opacity-90 text-xs font-semibold cursor-pointer"
              >
                Submit for 2-Person Approval
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
