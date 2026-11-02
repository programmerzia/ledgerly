import React from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { AdminShell } from './layouts/AdminShell';
import { IS_LIVE } from './api/config';
import { selectByMode } from './data/select';
import { useAuthStatus, useHomePath, useLiveStoreSync } from './data/session';
import { useAdminStore } from './mock/store/adminStore';

// Tenant Auth
import { Login } from './pages/Auth/Login';
import { TwoFactor } from './pages/Auth/TwoFactor';
import { LiveLogin, LiveTwoFactor, LiveRegister, LiveNewCompany } from './pages/Auth/LiveAuthPages';
import { LiveForgotPassword, LiveResetPassword, LiveAcceptInvitation } from './pages/Auth/LiveAccountPages';
import { LiveOnboarding } from './pages/Onboarding/LiveOnboarding';
import { LiveSettings } from './pages/Settings/live/LiveSettings';
import { Dashboard } from './pages/Dashboard/Dashboard';

// Sales
import { InvoicesList } from './pages/Sales/InvoicesList';
import { InvoiceForm } from './pages/Sales/InvoiceForm';
import { InvoiceView } from './pages/Sales/InvoiceView';
import { CustomersList } from './pages/Sales/CustomersList';
import { CustomerCard } from './pages/Sales/CustomerCard';
import { ReceiptForm } from './pages/Sales/ReceiptForm';

// Purchases
import { BillsList } from './pages/Purchases/BillsList';
import { BillForm } from './pages/Purchases/BillForm';
import { BillView } from './pages/Purchases/BillView';
import { SuppliersList } from './pages/Purchases/SuppliersList';
import { SupplierCard } from './pages/Purchases/SupplierCard';
import { PaymentRunWizard } from './pages/Purchases/PaymentRunWizard';
import { WhtCertificatesList } from './pages/Purchases/WhtCertificatesList';

// Approvals
import { ApprovalsInbox } from './pages/Approvals/ApprovalsInbox';

// Accounting & General Ledger
import { JournalsList } from './pages/Accounting/JournalsList';
import { JournalForm } from './pages/Accounting/JournalForm';
import { JournalView } from './pages/Accounting/JournalView';
import { ChartOfAccounts } from './pages/Accounting/ChartOfAccounts';
import { Periods } from './pages/Accounting/Periods';
import { FxRates } from './pages/Accounting/FxRates';
import { Dimensions } from './pages/Accounting/Dimensions';
import { FixedAssets } from './pages/Accounting/FixedAssets';
import { Budgets } from './pages/Accounting/Budgets';
import { AuditLog } from './pages/Accounting/AuditLog';

// Banking
import { BankAccountsList } from './pages/Banking/BankAccountsList';
import { BankReconcile } from './pages/Banking/BankReconcile';
import { BankRules } from './pages/Banking/BankRules';
import { RecurringInvoices } from './pages/Sales/RecurringInvoices';

// Reports
import { TrialBalance } from './pages/Reports/TrialBalance';
import { ProfitAndLoss } from './pages/Reports/ProfitAndLoss';
import { BalanceSheet } from './pages/Reports/BalanceSheet';
import { AgingReport } from './pages/Reports/AgingReport';
import { GeneralLedger } from './pages/Reports/GeneralLedger';
import { TaxReturn } from './pages/Reports/TaxReturn';

// Settings
import { CompanySettings } from './pages/Settings/CompanySettings';
import { ImportWizard } from './pages/Settings/ImportWizard';
import { OnboardingWizard } from './pages/Onboarding/OnboardingWizard';
import { ItemsList } from './pages/Sales/ItemsList';
import { CashFlow } from './pages/Reports/CashFlow';
import { ClosePack } from './pages/Accounting/ClosePack';
import { RecurringJournals } from './pages/Accounting/RecurringJournals';
import { Toaster } from './components/ui/sonner';

// Platform Admin Auth
import { AdminLogin } from './pages/Admin/Auth/AdminLogin';
import { AdminTwoFactor } from './pages/Admin/Auth/AdminTwoFactor';

// Platform Admin Modules (§3.1 to §3.12)
import { AdminDashboard } from './pages/Admin/Overview/AdminDashboard';
import { TenantsList } from './pages/Admin/Tenants/TenantsList';
import { TenantDetail } from './pages/Admin/Tenants/TenantDetail';
import { PlansList } from './pages/Admin/Plans/PlansList';
import { CouponsList } from './pages/Admin/Coupons/CouponsList';
import { BillingOps } from './pages/Admin/Billing/BillingOps';
import { GrowthTrials } from './pages/Admin/Growth/GrowthTrials';
import { PartnersList } from './pages/Admin/Partners/PartnersList';
import { SupportCenter } from './pages/Admin/Support/SupportCenter';
import { PlatformOps } from './pages/Admin/Ops/PlatformOps';
import { FeatureFlags } from './pages/Admin/Flags/FeatureFlags';
import { StaffSecurity } from './pages/Admin/Staff/StaffSecurity';
import { ComplianceCenter } from './pages/Admin/Compliance/ComplianceCenter';

const useGuardSync = selectByMode<(slug: string | undefined) => { unknownCompany: boolean }>({
  mock: () => ({ unknownCompany: false }),
  live: useLiveStoreSync,
});

function RequireTenantAuth() {
  const { status, needsCompany } = useAuthStatus();
  const { co } = useParams();
  const { unknownCompany } = useGuardSync(co);
  const home = useHomePath();
  const location = useLocation();

  if (status === 'loading') return null;
  if (status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (needsCompany) return <Navigate to="/new-company" replace />;
  if (unknownCompany && home) return <Navigate to={home} replace />;
  return <AppShell />;
}

function RequireAdminAuth() {
  const isAdminAuthenticated = useAdminStore((s) => s.isAdminAuthenticated);
  const location = useLocation();

  if (!isAdminAuthenticated) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  return <AdminShell />;
}

function RootRedirect() {
  const { status } = useAuthStatus();
  const home = useHomePath();

  if (status === 'loading') return null;
  if (status === 'authenticated' && home) return <Navigate to={home} replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      <Toaster />
      <Routes>
        {/* Tenant Auth */}
        <Route path="/login" element={IS_LIVE ? <LiveLogin /> : <Login />} />
        <Route path="/two-factor-challenge" element={IS_LIVE ? <LiveTwoFactor /> : <TwoFactor />} />
        {IS_LIVE && <Route path="/register" element={<LiveRegister />} />}
        {IS_LIVE && <Route path="/new-company" element={<LiveNewCompany />} />}
        {IS_LIVE && <Route path="/forgot-password" element={<LiveForgotPassword />} />}
        {IS_LIVE && <Route path="/reset-password/:token" element={<LiveResetPassword />} />}
        {IS_LIVE && <Route path="/invitations/:token" element={<LiveAcceptInvitation />} />}

        {/* Platform Admin Auth */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/two-factor" element={<AdminTwoFactor />} />

        {/* Platform Admin Back-Office Console (/admin/*) */}
        <Route path="/admin" element={<RequireAdminAuth />}>
          <Route index element={<AdminDashboard />} />
          <Route path="tenants" element={<TenantsList />} />
          <Route path="tenants/:id" element={<TenantDetail />} />
          <Route path="plans" element={<PlansList />} />
          <Route path="coupons" element={<CouponsList />} />
          <Route path="billing" element={<BillingOps />} />
          <Route path="growth" element={<GrowthTrials />} />
          <Route path="partners" element={<PartnersList />} />
          <Route path="support" element={<SupportCenter />} />
          <Route path="ops" element={<PlatformOps />} />
          <Route path="flags" element={<FeatureFlags />} />
          <Route path="staff" element={<StaffSecurity />} />
          <Route path="compliance" element={<ComplianceCenter />} />
        </Route>

        {/* Main Tenant Application */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="/:co" element={<RequireTenantAuth />}>
          <Route path="dashboard" element={<Dashboard />} />

          {/* Sales */}
          <Route path="invoices" element={<InvoicesList />} />
          <Route path="invoices/new" element={<InvoiceForm />} />
          <Route path="invoices/recurring" element={<RecurringInvoices />} />
          <Route path="invoices/:id" element={<InvoiceView />} />
          <Route path="customers" element={<CustomersList />} />
          <Route path="customers/:id" element={<CustomerCard />} />
          <Route path="receipts/new" element={<ReceiptForm />} />
          <Route path="items" element={<ItemsList />} />
          <Route path="sales/items" element={<ItemsList />} />

          {/* Purchases */}
          <Route path="bills" element={<BillsList />} />
          <Route path="bills/new" element={<BillForm />} />
          <Route path="bills/:id" element={<BillView />} />
          <Route path="bills/:id/edit" element={<BillForm />} />
          <Route path="suppliers" element={<SuppliersList />} />
          <Route path="suppliers/:id" element={<SupplierCard />} />
          <Route path="payment-run" element={<PaymentRunWizard />} />
          <Route path="wht-certificates" element={<WhtCertificatesList />} />

          {/* Approvals */}
          <Route path="approvals" element={<ApprovalsInbox />} />

          {/* Accounting & Ledger */}
          <Route path="journals" element={<JournalsList />} />
          <Route path="journals/new" element={<JournalForm />} />
          <Route path="journals/:id" element={<JournalView />} />
          <Route path="accounting/recurring" element={<RecurringJournals />} />
          <Route path="recurring-journals" element={<RecurringJournals />} />
          <Route path="accounts" element={<ChartOfAccounts />} />
          <Route path="periods" element={<Periods />} />
          <Route path="periods/close-pack" element={<ClosePack />} />
          <Route path="fx-rates" element={<FxRates />} />
          {IS_LIVE && <Route path="dimensions" element={<Dimensions />} />}
          <Route path="assets" element={<FixedAssets />} />
          <Route path="budgets" element={<Budgets />} />

          {/* Banking */}
          <Route path="banking" element={<BankAccountsList />} />
          <Route path="banking/rules" element={<BankRules />} />
          <Route path="banking/:id/reconcile" element={<BankReconcile />} />

          {/* Reports */}
          <Route path="reports/trial-balance" element={<TrialBalance />} />
          <Route path="reports/profit-and-loss" element={<ProfitAndLoss />} />
          <Route path="reports/balance-sheet" element={<BalanceSheet />} />
          <Route path="reports/cash-flow" element={<CashFlow />} />
          <Route path="reports/aging" element={<AgingReport />} />
          <Route path="reports/general-ledger" element={<GeneralLedger />} />
          <Route path="reports/tax-return" element={<TaxReturn />} />

          {/* Settings & Audit */}
          <Route path="settings" element={IS_LIVE ? <Navigate to="security" replace /> : <CompanySettings />} />
          {IS_LIVE && <Route path="settings/*" element={<LiveSettings />} />}
          <Route path="settings/import" element={<ImportWizard />} />
          <Route path="import" element={<ImportWizard />} />
          <Route path="onboarding" element={IS_LIVE ? <LiveOnboarding /> : <OnboardingWizard />} />
          <Route path="audit-log" element={<AuditLog />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/acme/dashboard" replace />} />
      </Routes>
    </>
  );
}
