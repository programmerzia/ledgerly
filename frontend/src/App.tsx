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
import { BudgetsLive } from './pages/Accounting/live/BudgetsLive';
import { LiveBudgetVsActual } from './pages/Reports/live/LiveBudgetVsActual';
import { AuditLog } from './pages/Accounting/AuditLog';
import { AuditLogLive } from './pages/Accounting/live/AuditLogLive';

// Banking
import { BankAccountsList } from './pages/Banking/BankAccountsList';
import { BankReconcile } from './pages/Banking/BankReconcile';
import { BankRules } from './pages/Banking/BankRules';
import { BankImportLive } from './pages/Banking/live/BankImportLive';
import { RecurringInvoices } from './pages/Sales/RecurringInvoices';
import { ReceiptViewLive } from './pages/Sales/live/ReceiptViewLive';
import { StatementRunLive } from './pages/Sales/live/StatementRunLive';
import { PublicInvoicePage } from './pages/Public/PublicInvoicePage';
import { InvoicesListLive } from './pages/Sales/live/InvoicesListLive';
import { NewCreditNoteLive } from './pages/Sales/live/InvoiceFormLive';
import { BillsListLive, PaymentFormLive, PaymentViewLive, RecurringBillsLive } from './pages/Purchases/live';
import { PaymentRunFormLive } from './pages/Purchases/live/PaymentRunFormLive';
import { PaymentRunViewLive } from './pages/Purchases/live/PaymentRunViewLive';
import { RequisitionsList } from './pages/Procurement/RequisitionsList';
import { RequisitionForm } from './pages/Procurement/RequisitionForm';
import { RequisitionView } from './pages/Procurement/RequisitionView';
import { OrdersList } from './pages/Procurement/OrdersList';
import { OrderForm, RevisionForm } from './pages/Procurement/OrderForm';
import { OrderView } from './pages/Procurement/OrderView';
import { ReceiptForm as GoodsReceiptForm } from './pages/Procurement/ReceiptForm';
import { ReceiptsList } from './pages/Procurement/ReceiptsList';
import { ReceiptView } from './pages/Procurement/ReceiptView';
import { ProcurementReports } from './pages/Procurement/ProcurementReports';
import { TaxLive } from './pages/Tax/live/TaxLive';

// Reports
import { TrialBalanceScreen, ProfitAndLossScreen, BalanceSheetScreen, CashFlowScreen, AgingScreen, GeneralLedgerScreen, TaxReturnScreen, LiveStatement, LiveJournalList, LiveBankReconciliationReport, LivePeriodClose } from './pages/Reports/live/screens';

// Settings
import { CompanySettings } from './pages/Settings/CompanySettings';
import { ImportWizard } from './pages/Settings/ImportWizard';
import { ImportLive } from './pages/Settings/live/ImportLive';
import { OnboardingWizard } from './pages/Onboarding/OnboardingWizard';
import { ItemsList } from './pages/Sales/ItemsList';
import { ClosePack } from './pages/Accounting/ClosePack';
import { ClosePackLive } from './pages/Accounting/live/ClosePackLive';
import { FixedAssetsLive } from './pages/Accounting/live/FixedAssetsLive';
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
        {/* The online invoice a customer opens from an email (3c.7b): no sign-in, no company in the address. */}
        {IS_LIVE && <Route path="/i/:token" element={<PublicInvoicePage />} />}

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
          {IS_LIVE && <Route path="customers/statement-run" element={<StatementRunLive />} />}
          <Route path="customers/:id" element={<CustomerCard />} />
          <Route path="receipts/new" element={<ReceiptForm />} />
          {IS_LIVE && <Route path="receipts/:id" element={<ReceiptViewLive />} />}
          {IS_LIVE && <Route path="credit-notes" element={<InvoicesListLive initialTab="credit" />} />}
          {IS_LIVE && <Route path="credit-notes/new" element={<NewCreditNoteLive />} />}
          <Route path="items" element={<ItemsList />} />
          <Route path="sales/items" element={<ItemsList />} />

          {/* Purchases */}
          <Route path="bills" element={<BillsList />} />
          {IS_LIVE && <Route path="bills/recurring" element={<RecurringBillsLive />} />}
          {IS_LIVE && <Route path="debit-notes" element={<BillsListLive initialTab="credit" />} />}
          {IS_LIVE && <Route path="debit-notes/new" element={<NewCreditNoteLive side="purchases" />} />}
          {IS_LIVE && <Route path="payments/new" element={<PaymentFormLive />} />}
          {IS_LIVE && <Route path="payments/:id" element={<PaymentViewLive />} />}
          <Route path="bills/new" element={<BillForm />} />
          <Route path="bills/:id" element={<BillView />} />
          <Route path="bills/:id/edit" element={<BillForm />} />
          <Route path="suppliers" element={<SuppliersList />} />
          <Route path="suppliers/:id" element={<SupplierCard />} />
          <Route path="payment-run" element={<PaymentRunWizard />} />
          {IS_LIVE && <Route path="payment-run/new" element={<PaymentRunFormLive />} />}
          {IS_LIVE && <Route path="payment-run/:id" element={<PaymentRunViewLive />} />}
          <Route path="wht-certificates" element={<WhtCertificatesList />} />
          {IS_LIVE && <Route path="tax" element={<TaxLive />} />}

          {/* Procurement (live only) */}
          {IS_LIVE && <Route path="requisitions" element={<RequisitionsList />} />}
          {IS_LIVE && <Route path="requisitions/new" element={<RequisitionForm />} />}
          {IS_LIVE && <Route path="requisitions/:id/edit" element={<RequisitionForm />} />}
          {IS_LIVE && <Route path="requisitions/:id" element={<RequisitionView />} />}
          {IS_LIVE && <Route path="purchase-orders" element={<OrdersList />} />}
          {IS_LIVE && <Route path="purchase-orders/new" element={<OrderForm />} />}
          {IS_LIVE && <Route path="purchase-orders/:id/edit" element={<OrderForm />} />}
          {IS_LIVE && <Route path="purchase-orders/:id/revise" element={<RevisionForm />} />}
          {IS_LIVE && <Route path="purchase-orders/:id/receive" element={<GoodsReceiptForm />} />}
          {IS_LIVE && <Route path="purchase-orders/:id" element={<OrderView />} />}
          {IS_LIVE && <Route path="goods-receipts" element={<ReceiptsList />} />}
          {IS_LIVE && <Route path="goods-receipts/:id" element={<ReceiptView />} />}
          {IS_LIVE && <Route path="procurement/reports" element={<ProcurementReports />} />}

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
          <Route path="periods/close-pack" element={IS_LIVE ? <ClosePackLive /> : <ClosePack />} />
          <Route path="fx-rates" element={<FxRates />} />
          {IS_LIVE && <Route path="dimensions" element={<Dimensions />} />}
          <Route path="assets" element={IS_LIVE ? <FixedAssetsLive /> : <FixedAssets />} />
          <Route path="budgets" element={IS_LIVE ? <BudgetsLive /> : <Budgets />} />
          {IS_LIVE && <Route path="reports/budget-vs-actual" element={<LiveBudgetVsActual />} />}

          {/* Banking */}
          <Route path="banking" element={<BankAccountsList />} />
          <Route path="banking/rules" element={<BankRules />} />
          {IS_LIVE && <Route path="banking/import" element={<BankImportLive />} />}
          <Route path="banking/:id/reconcile" element={<BankReconcile />} />

          {/* Reports */}
          <Route path="reports/trial-balance" element={<TrialBalanceScreen />} />
          <Route path="reports/profit-and-loss" element={<ProfitAndLossScreen />} />
          <Route path="reports/balance-sheet" element={<BalanceSheetScreen />} />
          <Route path="reports/cash-flow" element={<CashFlowScreen />} />
          <Route path="reports/aging" element={<AgingScreen />} />
          <Route path="reports/general-ledger" element={<GeneralLedgerScreen />} />
          <Route path="reports/tax-return" element={<TaxReturnScreen />} />
          {IS_LIVE && <Route path="reports/journal-list" element={<LiveJournalList />} />}
          {IS_LIVE && <Route path="reports/bank-reconciliation" element={<LiveBankReconciliationReport />} />}
          {IS_LIVE && <Route path="reports/period-close" element={<LivePeriodClose />} />}
          {IS_LIVE && <Route path="reports/customer-statement" element={<LiveStatement side="customer" />} />}
          {IS_LIVE && <Route path="reports/supplier-statement" element={<LiveStatement side="supplier" />} />}

          {/* Settings & Audit */}
          <Route path="settings" element={IS_LIVE ? <Navigate to="general" replace /> : <CompanySettings />} />
          {IS_LIVE && <Route path="settings/*" element={<LiveSettings />} />}
          <Route path="settings/import" element={IS_LIVE ? <ImportLive /> : <ImportWizard />} />
          <Route path="import" element={<ImportWizard />} />
          <Route path="onboarding" element={IS_LIVE ? <LiveOnboarding /> : <OnboardingWizard />} />
          <Route path="audit-log" element={IS_LIVE ? <AuditLogLive /> : <AuditLog />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/acme/dashboard" replace />} />
      </Routes>
    </>
  );
}
