/**
 * Comprehensive controls-grade domain types matching 05_Schema.md and 08_Mock_Refactor_Prompt.md
 * Rule: All money values stored in integer minor units (never floats).
 * Rule: Account balances are derived exclusively by summing posted journal lines.
 */

export type Role = 'accountant' | 'finance_manager' | 'cfo' | 'auditor';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleTitle: string;
  avatar?: string;
  theme: 'light' | 'dark' | 'system';
  twoFactorEnabled: boolean;
  signingPin: string; // 6-digit PIN separate from password (e.g. Fatima: '246810')
  signingLockoutUntil?: string;
  failedPinAttempts: number;
}

export interface PostingAccounts {
  ar_control: string;       // 'acc-1200'
  ap_control: string;       // 'acc-2000'
  tax_output: string;       // 'acc-2100'
  tax_input: string;        // 'acc-2110'
  fx_realised: string;      // 'acc-4900'
  fx_unrealised: string;    // 'acc-4900'
  rounding: string;         // 'acc-9999'
  suspense: string;         // 'acc-9999'
  retained_earnings: string;// 'acc-3900'
  bank_clearing: string;    // 'acc-1010'
  wht_payable: string;      // 'acc-2120'
}

export interface CompanySettings {
  company_id: string;
  posting_accounts: PostingAccounts;
  numbering: {
    invoice_prefix: string;
    bill_prefix: string;
    journal_prefix: string;
    receipt_prefix: string;
    payment_prefix: string;
    padding: number;
  };
  approval_workflows: {
    invoice_threshold: number;
    bill_threshold: number;
    journal_threshold: number;
    require_dual_approval_over: number;
  };
}

export interface Company {
  id: string;
  tenant_id: string;
  name: string;
  legal_name: string;
  slug: string;
  country: string;
  base_currency: string;
  timezone: string;
  locale: string;
  fiscal_year_start_month: number;
  tax_id: string;
  settings?: CompanySettings;
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type NormalBalance = 'debit' | 'credit';
export type ControlType =
  | 'none'
  | 'ar'
  | 'ap'
  | 'bank'
  | 'cash'
  | 'tax'
  | 'retained_earnings'
  | 'suspense'
  | 'fixed_asset'
  | 'accum_depr';

export interface Account {
  id: string;
  tenant_id: string;
  company_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  account_subtype: string;
  normal_balance: NormalBalance;
  control_type: ControlType;
  currency_policy: 'base_only' | 'any' | 'fixed';
  fixed_currency?: string;
  is_postable: boolean;
  is_active: boolean;
  description?: string;
}

export interface DimensionValue {
  id: string;
  dimension_id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface Dimension {
  id: string;
  company_id: string;
  code: string; // 'branch', 'cost_centre', 'project'
  name: string;
  position: number;
  is_active: boolean;
  isRequired?: boolean;
  values: DimensionValue[];
}

export type TaxKind = 'vat' | 'gst' | 'sales' | 'wht' | 'compound' | 'exempt' | 'zero';

export interface TaxCode {
  id: string;
  company_id: string;
  code: string; // VAT5, VAT0, EXEMPT, WHT10
  name: string;
  kind: TaxKind;
  rate: number; // 0.05
  collect_account_id?: string;
  pay_account_id?: string;
  is_recoverable: boolean;
  is_active: boolean;
}

export type ContactKind = 'customer' | 'supplier' | 'both';

export interface Contact {
  id: string;
  tenant_id: string;
  company_id: string;
  kind: ContactKind;
  code: string;
  name: string;
  legal_name?: string;
  tax_id?: string;
  email: string;
  phone?: string;
  default_currency: string;
  payment_terms_days: number;
  credit_limit?: number;
  wht_code_id?: string;
  is_active: boolean;
}

export type PeriodStatus = 'open' | 'soft_closed' | 'closed' | 'locked';

export interface FiscalPeriod {
  id: string;
  company_id: string;
  fiscal_year_id: string;
  number: number;
  name: string;
  starts_on: string;
  ends_on: string;
  status: PeriodStatus;
  closed_at?: string;
  closed_by?: string;
  reopened_count: number;
}

export interface FiscalYear {
  id: string;
  company_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: 'open' | 'closed' | 'locked';
  periods: FiscalPeriod[];
}

export interface PeriodCloseCheck {
  id: string;
  period_id: string;
  check_code: string;
  title: string;
  status: 'pass' | 'fail' | 'waived';
  detail: string;
}

export interface PeriodReopenRequest {
  id: string;
  period_id: string;
  requested_by: string;
  requested_at: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  first_approver_id?: string;
  second_approver_id?: string;
  decided_at?: string;
}

export type DocumentStatus =
  | 'draft'
  | 'pending_approval'
  | 'posted'
  | 'reversed'
  | 'void'
  | 'queued'; // offline outbox status

export type InvoiceKind = 'sales_invoice' | 'credit_note' | 'purchase_bill' | 'debit_note';

export interface InvoiceLine {
  id: string;
  line_no: number;
  account_id: string;
  description: string;
  quantity: number;
  unit_price_fc: number;
  discount_pct: number;
  tax_code_id?: string;
  line_total_fc: number;
  tax_amount_fc: number;
  dimensions: {
    branch?: string;
    cost_centre?: string;
    project?: string;
  };
}

export interface Invoice {
  id: string;
  tenant_id: string;
  company_id: string;
  kind: InvoiceKind;
  number: string | null;
  status: DocumentStatus;
  contact_id: string;
  issue_date: string;
  due_date: string;
  currency: string;
  fx_rate: number;
  reference: string;
  memo?: string;
  lines: InvoiceLine[];
  subtotal_fc: number;
  tax_total_fc: number;
  total_fc: number;
  subtotal: number;
  tax_total: number;
  total: number;
  settled_fc: number;
  settled: number;
  related_invoice_id?: string;
  journal_id?: string;
  created_by: string;
  submitted_by?: string;
  approved_by?: string;
  signed_by?: string;
  signed_at?: string;
  signature_hash?: string;
  posted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface BillLine extends InvoiceLine {}

export interface Bill extends Invoice {
  wht_code_id?: string;
  wht_amount_fc?: number;
}

export type JournalType =
  | 'manual'
  | 'sales'
  | 'purchase'
  | 'receipt'
  | 'payment'
  | 'bank'
  | 'fx'
  | 'depreciation'
  | 'closing'
  | 'reversal'
  | 'opening';

export interface JournalLine {
  id: string;
  line_no: number;
  account_id: string;
  debit: number;        // base minor units
  credit: number;       // base minor units
  currency: string;     // foreign currency code
  fx_rate: number;      // exchange rate to base
  amount_fc: number;    // foreign currency minor units (signed)
  dimensions: {
    branch?: string;
    cost_centre?: string;
    project?: string;
  };
  description: string;
  contact_id?: string;
  tax_code_id?: string;
  due_date?: string;
}

export interface Journal {
  id: string;
  tenant_id: string;
  company_id: string;
  fiscal_period_id: string;
  journal_type: JournalType;
  number: string | null;
  status: DocumentStatus;
  journal_date: string;
  posted_at?: string;
  reference: string;
  memo: string;
  source_type?: string;
  source_id?: string;
  reversal_of_id?: string;
  reversed_by_id?: string;
  total_debit: number;
  total_credit: number;
  lines: JournalLine[];
  created_by: string;
  submitted_by?: string;
  approved_by?: string;
  signed_by?: string;
  signed_at?: string;
  signature_hash?: string;
  posted_by?: string;
  created_at: string;
  updated_at: string;
}

export interface SettlementAllocation {
  id: string;
  invoice_id: string;
  invoice_number: string;
  invoice_total_fc: number;
  invoice_open_fc: number;
  allocated_amount_fc: number;
  allocated_amount_base: number;
  fx_gain_loss: number;
}

export interface Settlement {
  id: string;
  tenant_id: string;
  company_id: string;
  kind: 'receipt' | 'payment' | 'refund';
  number: string;
  status: DocumentStatus;
  contact_id: string;
  bank_account_id: string;
  settlement_date: string;
  currency: string;
  fx_rate: number;
  amount_fc: number;
  amount: number;
  unallocated_fc: number;
  allocations: SettlementAllocation[];
  reference: string;
  memo: string;
  journal_id?: string;
  created_by: string;
  approved_by?: string;
  signed_by?: string;
  posted_at?: string;
  created_at: string;
}

export interface PaymentRunItem {
  id: string;
  bill_id: string;
  supplier_id: string;
  supplier_name: string;
  bill_number: string;
  due_date: string;
  amount_due: number;
  payment_amount: number;
  wht_code?: string;
  wht_rate?: number;
  wht_amount: number;
  net_payment: number;
  selected: boolean;
}

export interface PaymentRun {
  id: string;
  company_id: string;
  number: string;
  status: DocumentStatus;
  bank_account_id: string;
  run_date: string;
  currency: string;
  total_gross: number;
  total_wht: number;
  total_net: number;
  items: PaymentRunItem[];
  created_by: string;
  approved_by?: string;
  signed_by?: string;
  posted_at?: string;
  created_at: string;
}

export interface WhtCertificate {
  id: string;
  company_id: string;
  number: string;
  payment_id: string;
  contact_id: string;
  tax_code_id: string;
  base_amount: number;
  wht_amount: number;
  issued_on: string;
}

export interface BankAccount {
  id: string;
  company_id: string;
  name: string;
  account_id: string;
  currency: string;
  bank_name: string;
  account_number_masked: string;
  iban?: string;
  swift?: string;
  kind: 'bank' | 'cash' | 'card';
  last_statement_balance: number;
}

export interface BankStatementLine {
  id: string;
  statement_id: string;
  bank_account_id: string;
  txn_date: string;
  value_date: string;
  amount: number;
  description: string;
  reference: string;
  counterparty: string;
  status: 'unmatched' | 'matched' | 'excluded';
  matched_journal_line_id?: string;
  matched_doc_id?: string;
  matched_doc_type?: string;
  confidence?: number;
  suggested_match_title?: string;
}

export interface ExchangeRate {
  id: string;
  company_id: string;
  from_currency: string;
  to_currency: string;
  rate_date: string;
  rate: number;
  source: 'manual' | 'provider' | 'document';
}

export interface FxRevaluationItem {
  account_id: string;
  account_code: string;
  account_name: string;
  currency: string;
  amount_fc: number;
  book_rate: number;
  book_amount_base: number;
  current_rate: number;
  revalued_amount_base: number;
  unrealised_gain_loss: number;
}

export interface FxRevaluation {
  id: string;
  company_id: string;
  period_id: string;
  as_of: string;
  status: DocumentStatus;
  journal_id?: string;
  reversal_journal_id?: string;
  total_unrealised_gain_loss: number;
  items: FxRevaluationItem[];
}

export interface FixedAsset {
  id: string;
  company_id: string;
  number: string;
  name: string;
  category_id: string;
  asset_account_id: string;
  accum_depr_account_id: string;
  depr_expense_account_id: string;
  acquired_on: string;
  cost: number;
  residual: number;
  method: 'straight_line' | 'declining';
  useful_life_months: number;
  status: 'active' | 'disposed';
  disposed_on?: string;
}

export interface DepreciationRun {
  id: string;
  company_id: string;
  period_id: string;
  as_of: string;
  status: DocumentStatus;
  journal_id?: string;
  total_depreciation: number;
  lines: Array<{
    asset_id: string;
    asset_number: string;
    asset_name: string;
    amount: number;
  }>;
}

export interface Budget {
  id: string;
  company_id: string;
  fiscal_year_id: string;
  name: string;
  version: string;
  status: 'draft' | 'approved' | 'archived';
  lines: Array<{
    id: string;
    account_id: string;
    period_id: string;
    dimensions?: { branch?: string; cost_centre?: string };
    amount: number;
  }>;
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  actor_id: string;
  actor_name: string;
  action: string;
  subject_type: string;
  subject_id: string;
  subject_number?: string;
  detail: string;
  prev_hash: string;
  hash: string;
}

export interface OutboxOp {
  id: string;
  type: string;
  entityId: string;
  payload: any;
  createdAt: string;
  status: 'queued' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

export interface DocumentTab {
  id: string;
  title: string;
  url: string;
  type: string;
  dirty?: boolean;
  pinned?: boolean;
}

export type UIRowDensity = 'compact' | 'default' | 'comfortable';
