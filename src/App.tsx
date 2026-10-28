import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { AdminShell } from './layouts/AdminShell';
import { useLedgerStore } from './mock/store';
import { useAdminStore } from './mock/store/adminStore';

// Tenant Auth
import { Login } from './pages/Auth/Login';
import { TwoFactor } from './pages/Auth/TwoFactor';
import { Dashboard } from './pages/Dashboard/Dashboard';

// Sales
import { InvoicesList } from './pages/Sales/InvoicesList';
import { InvoiceForm } from './pages/Sales/InvoiceForm';
import { InvoiceView } from './pages/Sales/InvoiceView';
import { CustomersList } from './pages/Sales/CustomersList';
import { ReceiptForm } from './pages/Sales/ReceiptForm';

// Purchases
import { BillsList } from './pages/Purchases/BillsList';
import { BillForm } from './pages/Purchases/BillForm';
import { SuppliersList } from './pages/Purchases/SuppliersList';
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
import { FixedAssets } from './pages/Accounting/FixedAssets';
import { Budgets } from './pages/Accounting/Budgets';
import { AuditLog } from './pages/Accounting/AuditLog';

// Banking
import { BankAccountsList } from './pages/Banking/BankAccountsList';
import { BankReconcile } from './pages/Banking/BankReconcile';

// Reports
import { TrialBalance } from './pages/Reports/TrialBalance';
import { ProfitAndLoss } from './pages/Reports/ProfitAndLoss';
import { BalanceSheet } from './pages/Reports/BalanceSheet';
import { AgingReport } from './pages/Reports/AgingReport';
import { GeneralLedger } from './pages/Reports/GeneralLedger';
import { TaxReturn } from './pages/Reports/TaxReturn';

// Settings
import { CompanySettings } from './pages/Settings/CompanySettings';
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

function RequireTenantAuth() {
  const isAuthenticated = useLedgerStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
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
  const isAuthenticated = useLedgerStore((s) => s.isAuthenticated);
  const currentCompany = useLedgerStore((s) => s.currentCompany);

  if (isAuthenticated) {
    return <Navigate to={`/${currentCompany.slug}/dashboard`} replace />;
  }
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      <Toaster />
      <Routes>
        {/* Tenant Auth */}
        <Route path="/login" element={<Login />} />
        <Route path="/two-factor-challenge" element={<TwoFactor />} />

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
          <Route path="invoices/:id" element={<InvoiceView />} />
          <Route path="customers" element={<CustomersList />} />
          <Route path="receipts/new" element={<ReceiptForm />} />

          {/* Purchases */}
          <Route path="bills" element={<BillsList />} />
          <Route path="bills/new" element={<BillForm />} />
          <Route path="bills/:id" element={<BillForm />} />
          <Route path="suppliers" element={<SuppliersList />} />
          <Route path="payment-run" element={<PaymentRunWizard />} />
          <Route path="wht-certificates" element={<WhtCertificatesList />} />

          {/* Approvals */}
          <Route path="approvals" element={<ApprovalsInbox />} />

          {/* Accounting & Ledger */}
          <Route path="journals" element={<JournalsList />} />
          <Route path="journals/new" element={<JournalForm />} />
          <Route path="journals/:id" element={<JournalView />} />
          <Route path="accounts" element={<ChartOfAccounts />} />
          <Route path="periods" element={<Periods />} />
          <Route path="fx-rates" element={<FxRates />} />
          <Route path="assets" element={<FixedAssets />} />
          <Route path="budgets" element={<Budgets />} />

          {/* Banking */}
          <Route path="banking" element={<BankAccountsList />} />
          <Route path="banking/:id/reconcile" element={<BankReconcile />} />

          {/* Reports */}
          <Route path="reports/trial-balance" element={<TrialBalance />} />
          <Route path="reports/profit-and-loss" element={<ProfitAndLoss />} />
          <Route path="reports/balance-sheet" element={<BalanceSheet />} />
          <Route path="reports/aging" element={<AgingReport />} />
          <Route path="reports/general-ledger" element={<GeneralLedger />} />
          <Route path="reports/tax-return" element={<TaxReturn />} />

          {/* Settings & Audit */}
          <Route path="settings" element={<CompanySettings />} />
          <Route path="audit-log" element={<AuditLog />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/acme/dashboard" replace />} />
      </Routes>
    </>
  );
}
