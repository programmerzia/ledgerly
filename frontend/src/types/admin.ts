/**
 * Type definitions for Ledgerly Platform Admin (SaaS vendor back-office)
 * per docs/10_SaaS_Admin.md §6 and §10.
 */

export type AdminRole = 'owner' | 'finance' | 'sales' | 'support' | 'engineer' | 'readonly';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  roleTitle: string;
  avatar: string;
  twoFactorEnabled: boolean;
  hardwareKeyEnabled: boolean;
  ipAllowlist: string[];
  isActive: boolean;
  lastLoginAt: string;
  signingPin: string;
}

export type AdminApprovalKind = 'refund' | 'impersonate_write' | 'plan_migration' | 'tenant_delete';
export type AdminApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface AdminApproval {
  id: string;
  kind: AdminApprovalKind;
  title: string;
  description: string;
  amount?: number; // integer minor units
  currency?: string;
  tenantId?: string;
  tenantName?: string;
  requestedBy: {
    id: string;
    name: string;
    role: AdminRole;
  };
  approvedBy?: {
    id: string;
    name: string;
    role: AdminRole;
  };
  status: AdminApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  rejectionReason?: string;
  subjectData?: Record<string, any>;
}

export interface AdminAuditEvent {
  id: string;
  adminId: string;
  adminName: string;
  adminRole: AdminRole;
  action: string;
  tenantId?: string | null;
  tenantName?: string | null;
  subjectType: string;
  subjectId: string;
  detail: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  reason?: string;
  ip: string;
  occurredAt: string;
  prevHash: string;
  hash: string;
}

export type SupportedCurrency = 'USD' | 'KES' | 'EUR';

export type PlanCode = 'starter' | 'professional' | 'business' | 'enterprise';

export interface PlanLimits {
  companies: number;
  users: number;
  journalLinesPerMonth: number;
  storageMb: number;
  apiCallsPerDay: number;
}

export interface PlanEntitlements {
  multiCurrency: boolean;
  independentApprovals: boolean;
  fixedAssets: boolean;
  budgets: boolean;
  apiAccess: boolean;
  ssoSaml: boolean;
  auditChainExport: boolean;
  customRoles: boolean;
  dedicatedSupport: boolean;
}

export interface PlanPricing {
  monthly: number; // minor units (cents)
  annual: number;  // minor units (cents)
}

export interface PlanVersion {
  id: string;
  planId: string;
  version: number;
  prices: Record<string, PlanPricing>; // currency code e.g. USD, KES, EUR
  limits: PlanLimits;
  entitlements: PlanEntitlements;
  trialDays: number;
  stripeProductId: string;
  effectiveFrom: string;
  createdBy: string;
}

export interface Plan {
  id: string;
  code: PlanCode;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  currentVersion: PlanVersion;
}

export type AddonKind = 'company' | 'user_pack' | 'storage' | 'metered_api';

export interface PlanAddon {
  id: string;
  code: string;
  name: string;
  kind: AddonKind;
  pricePerUnit: Record<string, number>; // currency -> cents
  unitLabel: string;
  stripePriceId: string;
}

export type CouponDuration = 'once' | 'repeating' | 'forever';

export interface Coupon {
  id: string;
  code: string;
  stripeCouponId: string;
  percentOff?: number | null;
  amountOff?: number | null; // cents
  currency?: string | null;
  duration: CouponDuration;
  durationMonths?: number | null;
  maxRedemptions?: number | null;
  timesRedeemed: number;
  expiresAt?: string | null;
  partnerId?: string | null;
  partnerName?: string | null;
  planRestrictions?: PlanCode[];
  newCustomersOnly: boolean;
  isActive: boolean;
  createdAt: string;
}

export type TenantLifecycleStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'read_only'
  | 'suspended'
  | 'cancelled'
  | 'deleted';

export interface TenantUsage {
  companiesUsed: number;
  usersUsed: number;
  journalLinesThisMonth: number;
  storageMbUsed: number;
  apiCallsToday: number;
}

export interface TenantSubscription {
  id: string;
  planCode: PlanCode;
  planName: string;
  planVersionId: string;
  billingInterval: 'monthly' | 'annual';
  currency: string;
  amount: number; // minor units (cents)
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd: boolean;
  discountCouponId?: string | null;
  discountPercent?: number | null;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  stripeSubscriptionId: string;
  stripeCustomerId: string;
}

export interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantLifecycleStatus;
  ownerName: string;
  ownerEmail: string;
  country: string;
  countryName: string;
  currency: string;
  mrr: number; // minor units (cents)
  healthScore: number; // 0 - 100
  createdAt: string;
  lastActivityAt: string;
  subscription: TenantSubscription;
  usage: TenantUsage;
  companiesCount: number;
  usersCount: number;
  dataResidency: 'us-east' | 'eu-central' | 'af-south';
  dpaSigned: boolean;
  notesCount: number;
  openTicketsCount: number;
}

export interface StripeInvoiceMirrored {
  id: string;
  tenantId: string;
  tenantName: string;
  stripeId: string;
  number: string;
  status: 'paid' | 'open' | 'past_due' | 'uncollectible' | 'void';
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountRefunded: number;
  dueAt: string;
  paidAt?: string | null;
  pdfUrl: string;
  dunningStage?: number | null; // 0 (none), 1 (soft retry), 2 (warning email), 3 (pre-suspension)
  createdAt: string;
}

export interface PennantFeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  globalDefault: boolean;
  rolloutPercentage: number;
  planEntitlements: PlanCode[];
  tenantOverrides: Record<string, boolean>; // tenantId -> boolean
  updatedAt: string;
  updatedBy: string;
}

export interface BackgroundQueueMetric {
  name: string;
  status: 'healthy' | 'degraded' | 'congested';
  throughputPerMinute: number;
  currentJobs: number;
  failedJobs24h: number;
  averageWaitTimeMs: number;
}

export interface FailedJob {
  id: string;
  tenantId: string;
  tenantName: string;
  jobClass: string;
  queue: string;
  attempts: number;
  exception: string;
  failedAt: string;
}

export interface ImpersonationSession {
  id: string;
  adminId: string;
  adminName: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  userId: string;
  userName: string;
  mode: 'read' | 'write';
  reason: string;
  consentToken: string;
  approvalId?: string | null;
  startedAt: string;
  endedAt?: string | null;
  isActive: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  kind: 'info' | 'maintenance' | 'feature' | 'security';
  audience: {
    allTenants: boolean;
    plans?: PlanCode[];
    tenantIds?: string[];
  };
  startsAt: string;
  endsAt: string;
  createdBy: string;
  isActive: boolean;
}

export interface GdprRequest {
  id: string;
  tenantId: string;
  tenantName: string;
  kind: 'export' | 'delete';
  requestedBy: string;
  requestedByEmail: string;
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  dueAt: string; // SLA deadline (30 days from creation)
  completedAt?: string | null;
  exportPath?: string | null;
  notes?: string;
  createdAt: string;
}

export interface Partner {
  id: string;
  name: string;
  contactEmail: string;
  revenueSharePct: number;
  linkedTenantsCount: number;
  totalMtrGenerated: number;
  totalMrrContributed: number;
  totalCommissionsPaid: number;
  tier: 'silver' | 'gold' | 'platinum';
  joinedAt: string;
}

export interface PlatformKpis {
  mrr: number; // minor units
  arr: number; // minor units
  netNewMrr: number; // minor units
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  activeTenantsCount: number;
  trialingTenantsCount: number;
  trialConversionRate: number; // percentage
  failedPaymentsCount: number;
  failedPaymentsAmount: number; // minor units
  openSupportTicketsCount: number;
  systemErrorRatePct: number;
  systemP95LatencyMs: number;
  grossRevenueRetentionPct: number;
  netRevenueRetentionPct: number;
  monthlyCohortData: {
    month: string;
    mrr: number;
    newMrr: number;
    churnMrr: number;
    activeTenants: number;
  }[];
}
