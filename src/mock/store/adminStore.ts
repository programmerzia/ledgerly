/**
 * Platform Admin Zustand Store
 * Implements real state mutations per docs/10_SaaS_Admin.md §3, §5, and §10.
 */

import { create } from 'zustand';
import {
  AdminUser,
  AdminRole,
  AdminTenant,
  Plan,
  PlanCode,
  Coupon,
  StripeInvoiceMirrored,
  PennantFeatureFlag,
  AdminApproval,
  AdminAuditEvent,
  ImpersonationSession,
  Announcement,
  GdprRequest,
  Partner,
  PlatformKpis,
  TenantLifecycleStatus,
} from '@/types/admin';
import {
  mockAdminUsers,
  mockPlans,
  mockPlanAddons,
  mockCoupons,
  mockAdminTenants,
  mockStripeInvoices,
  mockHistoricalCohorts,
  mockFeatureFlags,
  mockQueueMetrics,
  mockFailedJobs,
  mockAdminApprovals,
  mockAdminAuditEvents,
  mockAnnouncements,
  mockGdprRequests,
  mockPartners,
} from '@/mock/adminData';

export interface AdminStoreState {
  // Session & Staff
  currentAdmin: AdminUser;
  staffUsers: AdminUser[];
  activeImpersonation: ImpersonationSession | null;
  selectedAdminTabId: string;

  // Domain Entities
  tenants: AdminTenant[];
  plans: Plan[];
  coupons: Coupon[];
  invoices: StripeInvoiceMirrored[];
  featureFlags: PennantFeatureFlag[];
  approvals: AdminApproval[];
  auditEvents: AdminAuditEvent[];
  announcements: Announcement[];
  gdprRequests: GdprRequest[];
  partners: Partner[];
  failedJobs: typeof mockFailedJobs;
  queueMetrics: typeof mockQueueMetrics;

  isAdminAuthenticated: boolean;

  // Actions
  loginAdmin: (staffId?: string) => void;
  logoutAdmin: () => void;
  switchAdminStaff: (staffId: string) => void;
  getKpis: () => PlatformKpis;

  // Tenant Flows (§10)
  changeTenantPlan: (
    tenantId: string,
    newPlanCode: PlanCode,
    billingInterval: 'monthly' | 'annual',
    reason: string
  ) => { prorationCredit: number; newCharge: number; netPayable: number };
  extendTenantTrial: (tenantId: string, daysToAdd: number, reason: string) => void;
  applyCouponToTenant: (tenantId: string, couponCode: string) => void;
  suspendTenant: (tenantId: string, reason: string) => void;
  reactivateTenant: (tenantId: string, reason: string) => void;

  // Impersonation Flows (§3.2, §3.8)
  startImpersonation: (
    tenantId: string,
    mode: 'read' | 'write',
    reason: string,
    approvalId?: string
  ) => ImpersonationSession;
  endImpersonation: () => void;

  // Approvals & Refunds (§3.5, §3.11)
  requestRefundApproval: (
    invoiceId: string,
    amount: number,
    reason: string
  ) => AdminApproval;
  decideApproval: (
    approvalId: string,
    decision: 'approved' | 'rejected',
    pin: string,
    rejectionReason?: string
  ) => void;

  // Operations & Feature Flags (§3.9, §3.10)
  toggleFeatureFlagTenantOverride: (flagId: string, tenantId: string, value: boolean) => void;
  updateFeatureFlagRollout: (flagId: string, percentage: number) => void;
  retryFailedJob: (jobId: string) => void;

  // Communications & Compliance (§3.8, §3.12)
  createAnnouncement: (data: Omit<Announcement, 'id' | 'createdAt' | 'createdBy'>) => void;
  createGdprRequest: (tenantId: string, kind: 'export' | 'delete', requestedBy: string, email: string) => void;
  completeGdprRequest: (requestId: string, exportPath: string) => void;
  createCoupon: (data: Omit<Coupon, 'id' | 'timesRedeemed' | 'createdAt'>) => void;
}

export const useAdminStore = create<AdminStoreState>()((set, get) => ({
  currentAdmin: mockAdminUsers[0], // Default: Ziaur Rahman (Owner)
  staffUsers: [...mockAdminUsers],
  activeImpersonation: null,
  selectedAdminTabId: 'tab-overview',
  isAdminAuthenticated: typeof window !== 'undefined' ? localStorage.getItem('ledgerly_admin_auth') === 'true' : false,

  loginAdmin: (staffId) => {
    if (staffId) {
      const staff = get().staffUsers.find((s) => s.id === staffId);
      if (staff) set({ currentAdmin: staff });
    }
    set({ isAdminAuthenticated: true });
    if (typeof window !== 'undefined') {
      localStorage.setItem('ledgerly_admin_auth', 'true');
    }
  },

  logoutAdmin: () => {
    set({ isAdminAuthenticated: false, activeImpersonation: null });
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ledgerly_admin_auth');
    }
  },

  tenants: [...mockAdminTenants],
  plans: [...mockPlans],
  coupons: [...mockCoupons],
  invoices: [...mockStripeInvoices],
  featureFlags: [...mockFeatureFlags],
  approvals: [...mockAdminApprovals],
  auditEvents: [...mockAdminAuditEvents],
  announcements: [...mockAnnouncements],
  gdprRequests: [...mockGdprRequests],
  partners: [...mockPartners],
  failedJobs: [...mockFailedJobs],
  queueMetrics: [...mockQueueMetrics],

  switchAdminStaff: (staffId: string) => {
    const staff = get().staffUsers.find((s) => s.id === staffId);
    if (staff) {
      set({ currentAdmin: staff });
    }
  },

  // Computed KPIs dynamically derived from mirrored subscriptions and invoices (§8, §10)
  getKpis: () => {
    const { tenants, invoices } = get();

    const activeTenants = tenants.filter((t) => t.status === 'active');
    const trialingTenants = tenants.filter((t) => t.status === 'trialing');
    const pastDueTenants = tenants.filter((t) => t.status === 'past_due');

    // MRR is dynamically summed from active tenants' monthly amounts
    const mrr = activeTenants.reduce((sum, t) => sum + (t.subscription?.amount || 0), 0);
    const arr = mrr * 12;

    const newMrr = 390000; // $3,900 new this month
    const expansionMrr = 185000; // $1,850 expansion
    const contractionMrr = 65000; // $650 contraction
    const churnMrr = 43000; // $430 churn
    const netNewMrr = newMrr + expansionMrr - contractionMrr - churnMrr;

    // Invoices with past_due status
    const failedInvoices = invoices.filter((inv) => inv.status === 'past_due');
    const failedPaymentsAmount = failedInvoices.reduce((sum, inv) => sum + inv.total, 0);

    return {
      mrr,
      arr,
      netNewMrr,
      newMrr,
      expansionMrr,
      contractionMrr,
      churnMrr,
      activeTenantsCount: activeTenants.length,
      trialingTenantsCount: trialingTenants.length,
      trialConversionRate: 68.4,
      failedPaymentsCount: failedInvoices.length,
      failedPaymentsAmount,
      openSupportTicketsCount: tenants.reduce((s, t) => s + (t.openTicketsCount || 0), 0),
      systemErrorRatePct: 0.02,
      systemP95LatencyMs: 84,
      grossRevenueRetentionPct: 96.8,
      netRevenueRetentionPct: 114.2,
      monthlyCohortData: mockHistoricalCohorts,
    };
  },

  // 1. Change Plan with Proration Preview
  changeTenantPlan: (tenantId, newPlanCode, billingInterval, reason) => {
    const state = get();
    const tenant = state.tenants.find((t) => t.id === tenantId);
    const newPlan = state.plans.find((p) => p.code === newPlanCode);

    if (!tenant || !newPlan) throw new Error('Tenant or Plan not found');

    const oldAmount = tenant.subscription.amount;
    const newPrice =
      billingInterval === 'annual'
        ? newPlan.currentVersion.prices.USD.annual
        : newPlan.currentVersion.prices.USD.monthly;

    // Proration math (simulated 15 days remaining in month)
    const daysRemaining = 15;
    const totalDays = 30;
    const prorationRatio = daysRemaining / totalDays;
    const prorationCredit = Math.round(oldAmount * prorationRatio);
    const newCharge = Math.round(newPrice * prorationRatio);
    const netPayable = Math.max(0, newCharge - prorationCredit);

    const now = new Date().toISOString();
    const updatedTenant: AdminTenant = {
      ...tenant,
      mrr: billingInterval === 'annual' ? Math.round(newPrice / 12) : newPrice,
      subscription: {
        ...tenant.subscription,
        planCode: newPlan.code,
        planName: newPlan.name,
        planVersionId: newPlan.currentVersion.id,
        billingInterval,
        amount: newPrice,
      },
      lastActivityAt: now,
    };

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: 'tenant.plan_changed',
      tenantId: tenant.id,
      tenantName: tenant.name,
      subjectType: 'tenant_subscription',
      subjectId: tenant.subscription.id,
      detail: `Changed plan from ${tenant.subscription.planName} to ${newPlan.name} (${billingInterval}). Proration credit: $${(prorationCredit / 100).toFixed(2)}, Net payable: $${(netPayable / 100).toFixed(2)}.`,
      reason,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '9f8e7d6c5b4a3210fedcba9876543210abcdef0123456789abcdef0123456789',
    };

    set((s) => ({
      tenants: s.tenants.map((t) => (t.id === tenantId ? updatedTenant : t)),
      auditEvents: [auditEvent, ...s.auditEvents],
    }));

    return { prorationCredit, newCharge, netPayable };
  },

  // 2. Extend Trial
  extendTenantTrial: (tenantId, daysToAdd, reason) => {
    const state = get();
    const tenant = state.tenants.find((t) => t.id === tenantId);
    if (!tenant) return;

    const currentExpiry = tenant.subscription.trialEndsAt
      ? new Date(tenant.subscription.trialEndsAt)
      : new Date();
    currentExpiry.setDate(currentExpiry.getDate() + daysToAdd);
    const newExpiry = currentExpiry.toISOString();
    const now = new Date().toISOString();

    const updatedTenant: AdminTenant = {
      ...tenant,
      status: 'trialing',
      subscription: {
        ...tenant.subscription,
        trialEndsAt: newExpiry,
      },
    };

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: 'tenant.trial_extended',
      tenantId: tenant.id,
      tenantName: tenant.name,
      subjectType: 'tenant_subscription',
      subjectId: tenant.subscription.id,
      detail: `Extended trial by ${daysToAdd} days. New trial end date: ${newExpiry.split('T')[0]}.`,
      reason,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '3a4b5c6d7e8f901234567890abcdef1234567890abcdef1234567890abcdef12',
    };

    set((s) => ({
      tenants: s.tenants.map((t) => (t.id === tenantId ? updatedTenant : t)),
      auditEvents: [auditEvent, ...s.auditEvents],
    }));
  },

  // 3. Apply Coupon
  applyCouponToTenant: (tenantId, couponCode) => {
    const state = get();
    const tenant = state.tenants.find((t) => t.id === tenantId);
    const coupon = state.coupons.find((c) => c.code === couponCode);

    if (!tenant || !coupon) throw new Error('Tenant or Coupon not found');

    const discountPct = coupon.percentOff || 20;
    const newAmount = Math.round(tenant.subscription.amount * (1 - discountPct / 100));
    const now = new Date().toISOString();

    const updatedTenant: AdminTenant = {
      ...tenant,
      mrr: newAmount,
      subscription: {
        ...tenant.subscription,
        discountCouponId: coupon.id,
        discountPercent: discountPct,
        amount: newAmount,
      },
    };

    const updatedCoupon: Coupon = {
      ...coupon,
      timesRedeemed: coupon.timesRedeemed + 1,
    };

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: 'tenant.coupon_applied',
      tenantId: tenant.id,
      tenantName: tenant.name,
      subjectType: 'tenant_subscription',
      subjectId: tenant.subscription.id,
      detail: `Applied coupon ${coupon.code} (${discountPct}% off). Subscription discounted to $${(newAmount / 100).toFixed(2)}/mo.`,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '5c6d7e8f901234567890abcdef1234567890abcdef1234567890abcdef123456',
    };

    set((s) => ({
      tenants: s.tenants.map((t) => (t.id === tenantId ? updatedTenant : t)),
      coupons: s.coupons.map((c) => (c.id === coupon.id ? updatedCoupon : c)),
      auditEvents: [auditEvent, ...s.auditEvents],
    }));
  },

  // 4. Suspend Tenant
  suspendTenant: (tenantId, reason) => {
    const state = get();
    const tenant = state.tenants.find((t) => t.id === tenantId);
    if (!tenant) return;

    const now = new Date().toISOString();
    const updatedTenant: AdminTenant = {
      ...tenant,
      status: 'suspended',
      mrr: 0,
      healthScore: 10,
    };

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: 'tenant.suspended',
      tenantId: tenant.id,
      tenantName: tenant.name,
      subjectType: 'tenant',
      subjectId: tenant.id,
      detail: `Tenant suspended. Login and posting operations locked. Reason: ${reason}.`,
      reason,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '7e8f901234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    };

    set((s) => ({
      tenants: s.tenants.map((t) => (t.id === tenantId ? updatedTenant : t)),
      auditEvents: [auditEvent, ...s.auditEvents],
    }));
  },

  // 5. Reactivate Tenant
  reactivateTenant: (tenantId, reason) => {
    const state = get();
    const tenant = state.tenants.find((t) => t.id === tenantId);
    if (!tenant) return;

    const plan = state.plans.find((p) => p.code === tenant.subscription.planCode) || state.plans[1];
    const restoredMrr = plan.currentVersion.prices.USD.monthly;
    const now = new Date().toISOString();

    const updatedTenant: AdminTenant = {
      ...tenant,
      status: 'active',
      mrr: restoredMrr,
      healthScore: 85,
    };

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: 'tenant.reactivated',
      tenantId: tenant.id,
      tenantName: tenant.name,
      subjectType: 'tenant',
      subjectId: tenant.id,
      detail: `Tenant reactivated. Access restored. Reason: ${reason}.`,
      reason,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '8f901234567890abcdef1234567890abcdef1234567890abcdef123456789012',
    };

    set((s) => ({
      tenants: s.tenants.map((t) => (t.id === tenantId ? updatedTenant : t)),
      auditEvents: [auditEvent, ...s.auditEvents],
    }));
  },

  // 6. Impersonation Session Management (§3.2, §3.8)
  startImpersonation: (tenantId, mode, reason, approvalId) => {
    const state = get();
    const tenant = state.tenants.find((t) => t.id === tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const now = new Date().toISOString();
    const session: ImpersonationSession = {
      id: `imp-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      userId: 'usr-1',
      userName: tenant.ownerName,
      mode,
      reason,
      consentToken: `cst_${Math.random().toString(36).substring(2, 10)}`,
      approvalId,
      startedAt: now,
      isActive: true,
    };

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: mode === 'write' ? 'impersonation.started_write' : 'impersonation.started_read',
      tenantId: tenant.id,
      tenantName: tenant.name,
      subjectType: 'impersonation_session',
      subjectId: session.id,
      detail: `Operator impersonation initiated for ${tenant.name} in ${mode.toUpperCase()} mode. Reason: ${reason}.`,
      reason,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '0123456789abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };

    set((s) => ({
      activeImpersonation: session,
      auditEvents: [auditEvent, ...s.auditEvents],
    }));

    return session;
  },

  endImpersonation: () => {
    const state = get();
    if (!state.activeImpersonation) return;

    const now = new Date().toISOString();
    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: 'impersonation.ended',
      tenantId: state.activeImpersonation.tenantId,
      tenantName: state.activeImpersonation.tenantName,
      subjectType: 'impersonation_session',
      subjectId: state.activeImpersonation.id,
      detail: `Impersonation session concluded for ${state.activeImpersonation.tenantName}.`,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    };

    set((s) => ({
      activeImpersonation: null,
      auditEvents: [auditEvent, ...s.auditEvents],
    }));
  },

  // 7. Refund Request with Two-Person Approval (§3.5, §3.11)
  requestRefundApproval: (invoiceId, amount, reason) => {
    const state = get();
    const inv = state.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new Error('Invoice not found');

    const approval: AdminApproval = {
      id: `appr-ref-${Date.now()}`,
      kind: 'refund',
      title: `Refund Request: ${inv.tenantName} (${inv.number})`,
      description: `Requesting refund of $${(amount / 100).toFixed(2)} on invoice ${inv.number}. Reason: ${reason}`,
      amount,
      currency: inv.currency,
      tenantId: inv.tenantId,
      tenantName: inv.tenantName,
      requestedBy: {
        id: state.currentAdmin.id,
        name: state.currentAdmin.name,
        role: state.currentAdmin.role,
      },
      status: 'pending',
      createdAt: new Date().toISOString(),
      subjectData: {
        invoiceId: inv.id,
        stripeId: inv.stripeId,
        reason,
      },
    };

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: 'billing.refund_requested',
      tenantId: inv.tenantId,
      tenantName: inv.tenantName,
      subjectType: 'admin_approval',
      subjectId: approval.id,
      detail: `Created refund approval request # ${approval.id} for $${(amount / 100).toFixed(2)}. Requires checker sign-off.`,
      reason,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: new Date().toISOString(),
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };

    set((s) => ({
      approvals: [approval, ...s.approvals],
      auditEvents: [auditEvent, ...s.auditEvents],
    }));

    return approval;
  },

  decideApproval: (approvalId, decision, pin, rejectionReason) => {
    const state = get();
    const appr = state.approvals.find((a) => a.id === approvalId);
    if (!appr) throw new Error('Approval request not found');

    // Invariant: Two-Person rule (Maker != Checker)
    if (appr.requestedBy.id === state.currentAdmin.id) {
      throw new Error('Two-Person Rule Violation: The staff member who requested this approval cannot decide it.');
    }

    // Verify Checker 6-digit signing PIN
    if (state.currentAdmin.signingPin !== pin) {
      throw new Error('Invalid 6-digit Signing PIN. Authorization rejected.');
    }

    const now = new Date().toISOString();
    const updatedApproval: AdminApproval = {
      ...appr,
      status: decision,
      decidedAt: now,
      approvedBy: {
        id: state.currentAdmin.id,
        name: state.currentAdmin.name,
        role: state.currentAdmin.role,
      },
      rejectionReason,
    };

    // If refund was approved, update the invoice state
    let updatedInvoices = state.invoices;
    if (decision === 'approved' && appr.kind === 'refund' && appr.subjectData?.invoiceId) {
      updatedInvoices = state.invoices.map((inv) =>
        inv.id === appr.subjectData?.invoiceId
          ? {
              ...inv,
              status: 'uncollectible',
              amountRefunded: (inv.amountRefunded || 0) + (appr.amount || 0),
            }
          : inv
      );
    }

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: `approval.${decision}`,
      tenantId: appr.tenantId,
      tenantName: appr.tenantName,
      subjectType: 'admin_approval',
      subjectId: appr.id,
      detail: `Dual-authorization request ${appr.title} ${decision.toUpperCase()} by ${state.currentAdmin.name}. PIN signature verified.`,
      reason: rejectionReason,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '2345678901abcdef2345678901abcdef2345678901abcdef2345678901abcdef',
    };

    set((s) => ({
      approvals: s.approvals.map((a) => (a.id === approvalId ? updatedApproval : a)),
      invoices: updatedInvoices,
      auditEvents: [auditEvent, ...s.auditEvents],
    }));
  },

  // 8. Feature Flag Overrides
  toggleFeatureFlagTenantOverride: (flagId, tenantId, value) => {
    const state = get();
    const flag = state.featureFlags.find((f) => f.id === flagId);
    if (!flag) return;

    const now = new Date().toISOString();
    const updatedFlag: PennantFeatureFlag = {
      ...flag,
      tenantOverrides: {
        ...flag.tenantOverrides,
        [tenantId]: value,
      },
      updatedAt: now,
      updatedBy: state.currentAdmin.name,
    };

    const auditEvent: AdminAuditEvent = {
      id: `aev-${Date.now()}`,
      adminId: state.currentAdmin.id,
      adminName: state.currentAdmin.name,
      adminRole: state.currentAdmin.role,
      action: 'flag.tenant_override',
      tenantId,
      subjectType: 'pennant_feature_flag',
      subjectId: flag.id,
      detail: `Feature flag '${flag.key}' override set to ${value ? 'ENABLED' : 'DISABLED'} for tenant ${tenantId}.`,
      ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
      occurredAt: now,
      prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '3456789012abcdef3456789012abcdef3456789012abcdef3456789012abcdef',
    };

    set((s) => ({
      featureFlags: s.featureFlags.map((f) => (f.id === flagId ? updatedFlag : f)),
      auditEvents: [auditEvent, ...s.auditEvents],
    }));
  },

  updateFeatureFlagRollout: (flagId, percentage) => {
    const state = get();
    const flag = state.featureFlags.find((f) => f.id === flagId);
    if (!flag) return;

    const updatedFlag: PennantFeatureFlag = {
      ...flag,
      rolloutPercentage: percentage,
      updatedAt: new Date().toISOString(),
      updatedBy: state.currentAdmin.name,
    };

    set((s) => ({
      featureFlags: s.featureFlags.map((f) => (f.id === flagId ? updatedFlag : f)),
    }));
  },

  // 9. Retry Failed Background Job
  retryFailedJob: (jobId) => {
    const state = get();
    const job = state.failedJobs.find((j) => j.id === jobId);
    if (!job) return;

    set((s) => ({
      failedJobs: s.failedJobs.filter((j) => j.id !== jobId),
      auditEvents: [
        {
          id: `aev-${Date.now()}`,
          adminId: state.currentAdmin.id,
          adminName: state.currentAdmin.name,
          adminRole: state.currentAdmin.role,
          action: 'ops.job_retried',
          tenantId: job.tenantId,
          tenantName: job.tenantName,
          subjectType: 'failed_job',
          subjectId: job.id,
          detail: `Dispatched manual queue retry for ${job.jobClass} on queue '${job.queue}'.`,
          ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
          occurredAt: new Date().toISOString(),
          prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
          hash: '4567890123abcdef4567890123abcdef4567890123abcdef4567890123abcdef',
        },
        ...s.auditEvents,
      ],
    }));
  },

  // 10. Announcements
  createAnnouncement: (data) => {
    const state = get();
    const announcement: Announcement = {
      ...data,
      id: `ann-${Date.now()}`,
      createdBy: state.currentAdmin.name,
      isActive: true,
    };

    set((s) => ({
      announcements: [announcement, ...s.announcements],
      auditEvents: [
        {
          id: `aev-${Date.now()}`,
          adminId: state.currentAdmin.id,
          adminName: state.currentAdmin.name,
          adminRole: state.currentAdmin.role,
          action: 'support.announcement_published',
          subjectType: 'announcement',
          subjectId: announcement.id,
          detail: `Broadcast in-app message published: "${announcement.title}".`,
          ip: state.currentAdmin.ipAllowlist[0] || '127.0.0.1',
          occurredAt: new Date().toISOString(),
          prevHash: state.auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000',
          hash: '5678901234abcdef5678901234abcdef5678901234abcdef5678901234abcdef',
        },
        ...s.auditEvents,
      ],
    }));
  },

  // 11. GDPR Requests
  createGdprRequest: (tenantId, kind, requestedBy, email) => {
    const state = get();
    const tenant = state.tenants.find((t) => t.id === tenantId);
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 30); // 30-day statutory SLA

    const req: GdprRequest = {
      id: `gdpr-${Date.now()}`,
      tenantId,
      tenantName: tenant?.name || 'Tenant',
      kind,
      requestedBy,
      requestedByEmail: email,
      status: 'pending',
      dueAt: dueAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      gdprRequests: [req, ...s.gdprRequests],
    }));
  },

  completeGdprRequest: (requestId, exportPath) => {
    const state = get();
    const req = state.gdprRequests.find((r) => r.id === requestId);
    if (!req) return;

    const updated: GdprRequest = {
      ...req,
      status: 'completed',
      completedAt: new Date().toISOString(),
      exportPath,
    };

    set((s) => ({
      gdprRequests: s.gdprRequests.map((r) => (r.id === requestId ? updated : r)),
    }));
  },

  // 12. Create Coupon
  createCoupon: (data) => {
    const state = get();
    const coupon: Coupon = {
      ...data,
      id: `cpn-${Date.now()}`,
      stripeCouponId: `coupon_${data.code.toLowerCase()}`,
      timesRedeemed: 0,
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      coupons: [coupon, ...s.coupons],
    }));
  },
}));
