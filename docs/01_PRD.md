# 01 — Product Requirements Document (PRD)

Product working name: **Ledgerly** (rename freely; nothing in code depends on it).
Status: Draft v0.1 — starter document, extend per module.

## 1. Core problem

Small and mid-sized businesses (10–500 staff), accounting firms and regulated financial
companies (insurers, takaful operators, microfinance, NGOs) are stuck between two bad options:

- **Light SaaS** (QuickBooks, Xero, Zoho Books, Wave): easy, but no real controls. No
  maker-checker approvals, no period locking worth the name, weak multi-entity, weak
  dimensions, tax rules hard-coded for one or two countries, audit trail is cosmetic.
- **Heavy ERP** (SAP B1, Dynamics BC, Odoo Enterprise, NetSuite): has the controls, but costs
  5–20× more, needs consultants to set up, and the UI is from another decade.

Ledgerly is the **controls-grade general ledger with the UX of modern SaaS**: double-entry
done properly (immutable journals, sealed audit log, period close, approval workflows,
multi-currency with revaluation, unlimited dimensions), multi-tenant, API-first, and priced
for SMEs. Everything that competitors bolt on as "enterprise" is standard.

## 2. Target personas

| Persona | Role | Primary jobs | Pain today |
|---|---|---|---|
| **Fatima, Finance Manager** | owns the books of a 50–300 person company | month-end close, approvals, management reports, auditor requests | spreadsheets outside the system; cannot trust the TB after someone back-dates an entry |
| **Rahim, Accountant / Bookkeeper** | posts daily documents | invoices, bills, receipts, payments, bank reconciliation, journals | re-keying bank data; reversing mistakes without a trace |
| **Nadia, Firm Partner (multi-client)** | accounting firm managing 20–200 client books | switch between clients, standard chart templates, bulk close | one login per client; no consolidated view |
| **Kenneth, CFO / Owner** | approves and reads | approve payments & journals, dashboards, cash forecast, budget vs actual | approving by email/WhatsApp; no evidence trail |
| **Aisha, External Auditor** | read-only, periodic | sample journals, trace to source documents, confirm sealed periods | exports that cannot be tied back to the ledger |
| **Dev / Integrator** | technical | push sales/payroll/inventory from other systems via API & webhooks | CSV imports; no idempotency; silent failures |

## 3. Product principles (non-negotiable)

1. **The ledger is the truth.** Every financial figure on every screen is derived from posted
   journal lines. No cached "balance" column is authoritative.
2. **Nothing posted is ever edited or deleted.** Corrections are reversals or adjusting
   entries. Drafts are editable; posted documents are immutable.
3. **Four-eyes by default where money moves.** Payments, manual journals and period
   reopenings go through maker → checker. Thresholds and exemptions are tenant settings.
4. **Periods lock.** A closed period rejects new postings; reopening is itself an approved,
   audited event.
5. **Every tenant is isolated at the database layer** (PostgreSQL Row-Level Security), not
   only in application code.
6. **API-first.** Everything the UI does, the REST API does, with idempotency keys.
7. **Explain every number.** Drill-down from any report cell to journal lines to the source
   document in two clicks.

## 4. MVP scope (Release 1) — user stories

### 4.1 Tenancy, auth, organisation
- As an owner I can sign up, create an organisation (tenant), and invite users by email.
- As an owner I can create multiple **companies** (legal entities) inside one organisation,
  each with its own base currency, fiscal year and chart of accounts.
- As an admin I can assign roles (Owner, Finance Manager, Accountant, Approver, Viewer,
  Auditor) and fine-grained permissions per company.
- As a user I can enable TOTP two-factor authentication; admins can enforce it per tenant.

### 4.2 Chart of accounts & dimensions
- As a finance manager I can start from a chart template (IFRS for SMEs, US GAAP small
  business, Non-profit, Insurance/Takaful) and then add, rename, deactivate accounts.
- Accounts have type (Asset, Liability, Equity, Income, Expense, with subtypes), normal
  balance, currency policy (base-only / any / fixed foreign), control flags (AR control, AP
  control, bank, cash, tax, retained earnings, suspense) and reporting tags.
- I can define up to 8 **dimensions** (Branch, Cost Centre, Project, Department, Product
  Line, Fund, Customer-segment, custom) and mark per account whether each dimension is
  required, optional or forbidden.

### 4.3 Fiscal calendar & periods
- I can define fiscal years and monthly (or 4-4-5) periods per company.
- Period states: `open → soft_closed → closed → locked`. Soft-close blocks everyone except
  Finance Manager; close blocks all posting; lock is permanent (year-end).
- Reopening a closed period requires two approvers and a reason; it is logged.

### 4.4 Journals (the core)
- As an accountant I can create a manual journal (multi-line, multi-currency, dimensions,
  attachments, memo), save as draft, submit for approval.
- The system rejects unbalanced journals per currency and per company.
- Posted journals are immutable; I can **reverse** one (auto-generates mirror journal, links
  both) or create a copy.
- Recurring journal templates (monthly accruals, depreciation schedules) generate drafts.
- Every posted journal gets a gapless **sequence number** per company per fiscal year.

### 4.5 Receivables (AR)
- Customers with billing addresses, tax IDs, payment terms, credit limit, default currency.
- Sales invoices (lines, tax codes, discounts, dimensions) → post creates AR journal.
- Credit notes, receipts (allocate to one or many invoices, partial, overpayment to
  on-account), customer statements, aging (30/60/90/120) by as-of date.
- Write-off and bad-debt provisioning journals.

### 4.6 Payables (AP)
- Suppliers; purchase bills; debit notes; payment runs (select due bills, generate payment
  batch, approve, mark paid, export bank file CSV); supplier aging; withholding tax (WHT)
  at payment with WHT certificate numbering.

### 4.7 Banking & cash
- Bank and cash accounts linked to GL accounts; multi-currency.
- Bank statement import (CSV/OFX/CAMT.053) and **reconciliation** workspace: match, rule-based
  auto-match, create receipt/payment from unmatched line, reconciliation report with
  opening/closing balance proof.
- Fund transfers between accounts with in-transit account.

### 4.8 Tax
- Tax codes (VAT/GST/sales tax, WHT, compound, exempt, zero, reverse-charge) with rates by
  effective date; tax groups; tax authority accounts.
- Tax return period report (output vs input, box mapping configurable per jurisdiction).

### 4.9 Multi-currency
- Daily exchange rates (manual or provider feed); rate per document line.
- Realised FX gain/loss on settlement; **unrealised revaluation** of open AR/AP/bank at
  period end (reversing journal next period).

### 4.10 Fixed assets (light)
- Asset register; acquisition from a bill or journal; straight-line and declining-balance
  depreciation; monthly depreciation run generating journals; disposal with gain/loss.

### 4.11 Budgets
- Budget per account × dimension × period; import from spreadsheet; budget vs actual report
  with variance %.

### 4.12 Reports (all drill-down, all exportable PDF/XLSX/CSV)
- Trial Balance (as-of, period movement, by dimension), General Ledger detail, Journal list,
  Balance Sheet, Profit & Loss (period, YTD, comparative, by dimension), Cash Flow (indirect),
  AR/AP aging, Customer/Supplier statements, Bank reconciliation, Tax return, Budget vs
  Actual, Fixed asset schedule, Audit trail report, Period close checklist.
- Saved report layouts; scheduled email delivery.

### 4.13 Audit & control
- Append-only `audit_events` with hash chain (each row stores previous hash) sealed by a
  nightly job; tamper-evident export for auditors.
- Attachment on any document (S3-compatible), virus-scanned, immutable once posted.
- Approval workflows: per document type, amount thresholds, role-based approvers, SLA
  reminders, return-with-comment.

### 4.14 Platform
- REST API (OAuth2 client credentials + personal access tokens), webhooks (signed),
  CSV/XLSX import wizards with validation preview, data export (full tenant export).
- Subscription billing (Stripe): plans by companies × users × features; trial; dunning.
- Status page, tenant-level feature flags.

## 5. Success metrics (first 12 months after GA)

| Metric | Target |
|---|---|
| Time from sign-up to first posted invoice | < 20 minutes (median) |
| Month-end close duration for a 300-txn/month tenant | < 2 working days |
| Posted-journal integrity failures (unbalanced / orphan lines) in production | 0 |
| Audit log tamper checks failing | 0 |
| P95 API latency for post endpoints | < 400 ms |
| Report render P95 (TB, 50k journal lines) | < 2 s |
| Trial → paid conversion | ≥ 8 % |
| Monthly logo churn | < 1.5 % |
| Uptime | 99.9 % |

## 6. Out of scope (non-goals) for Release 1

Explicitly **not** built in R1; do not design for them beyond leaving extension points:

- Payroll processing (import payroll journals only).
- Inventory valuation / warehousing (stock quantities, COGS layers). Item master is price
  list only.
- Point of sale, e-commerce storefront.
- CRM pipeline, HR, projects time-tracking (project *dimension* yes, timesheets no).
- Manufacturing / BOM.
- Country-specific e-invoicing clearance (Peppol, ZATCA, KRA eTIMS, NBR BD) — adapter
  interface only.
- Bank API aggregation (Plaid/Yapily) — file import only.
- Mobile native apps (responsive web only).
- Consolidation with intercompany elimination (multi-company yes, eliminations R2).
- Offline mode.
- AI auto-coding of transactions (R2 experiment).
- White-label / reseller portal.

## 7. Release roadmap (indicative)

- **R1 (MVP)** — sections 4.1–4.9, 4.12 core reports, 4.13, 4.14 API+billing. ~6 months.
- **R2** — fixed assets, budgets, consolidation eliminations, e-invoicing adapters, bank
  feeds, AI coding suggestions.
- **R3** — light inventory, payroll journal integration marketplace, reseller portal.

## 8. Competitive positioning (one line each)

- vs Xero/QBO: real controls (approvals, period lock, sealed audit, dimensions, WHT).
- vs Odoo: no module sprawl, no consultant needed, ledger integrity enforced by DB.
- vs SAP B1 / Dynamics BC: 1/10 the price, cloud-native, API-first, onboarding in minutes.
