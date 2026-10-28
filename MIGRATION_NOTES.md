# Ledgerly — Backend Production Migration Notes & Readiness Matrix

This document provides a comprehensive migration blueprint for transitioning the **Ledgerly** frontend application from the client-side mock store to a production **Laravel 11 + PostgreSQL 16** backend, aligned with `05_Schema.md` and `08_Mock_Refactor_Prompt.md`.

---

## 1. Architecture & Design Principles

### Single Source of Truth
- **No Stored Balances in Accounts, Customers, or Suppliers**:
  The client store strictly derives all balances by reducing over posted `journal_lines`. In the production PostgreSQL database:
  - `accounts.balance`, `contacts.balance`, and `bank_accounts.balance` do **not** exist as columns.
  - Balances are computed via PostgreSQL views (`v_account_balances`, `v_trial_balance`, `v_ar_open_items`, `v_ap_open_items`) or aggregated on-the-fly.
  - High-performance reporting leverages the `account_period_balances` roll-up table, maintained asynchronously or synchronously during `PostJournal` transactions and verified via nightly reconciliation jobs.

### Immutable Double-Entry Ledger
- Posted journals and journal lines can never be updated or deleted.
- Correcting entries must be executed via linked reversing journals (`reversal_of_id` / `reversed_by_id`).
- All monetary amounts are stored as integer `bigint` minor units (e.g., cents, $1,050.00 = `105000`).

---

## 2. Component & Selector Readiness Matrix

The table below classifies the production readiness of frontend components, store slices, and selectors:

| Frontend Module / Component | Readiness Level | Client Role | Backend Target (Laravel / PostgreSQL) |
|---|---|---|---|
| **AppShell & Desktop Chrome** | 100% Production Ready | Title bar, tabs, resizable split-pane, keyboard shortcuts | Session state, user preferences stored in `users.settings` |
| **DocumentTabStrip** | 100% Production Ready | Local workspace tab management (`Ctrl+W`, `Ctrl+Tab`) | Client-only UX |
| **ShortcutsOverlay & Registry** | 100% Production Ready | Global chords and keybindings | Client-only UX |
| **BottomStatusBar** | 100% Production Ready | Selection aggregations, signing cache timer | Client-only UX |
| **SignDialog (ADR-0004)** | 100% Production Ready | 6-digit PIN UI, lockout timer, signature caching | Verified by `POST /api/v1/auth/sign-pin` returning signed JWT/hash |
| **ConflictDialog (ADR-0005)** | 100% Production Ready | 409 visual diff and resolution UI | Replaces client Dexie collision with HTTP 409 response payload |
| **UsabilityTracker** | 100% Production Ready | Demo step execution telemetry and metrics | Telemetry ingestion endpoint `POST /api/v1/telemetry/usability` |
| **Invoices (List, Form, View)** | 100% Production Ready | Draft editing, live tax calculation, journal preview | `InvoicesController` (`store`, `show`, `submit`, `approve`) |
| **Bills & Suppliers (List, Form)** | 100% Production Ready | AP line entry, WHT calculation, consequence preview | `BillsController`, `ContactsController` |
| **PaymentRunWizard** | 100% Production Ready | Due bills filter, WHT deduction, bank CSV export | `PaymentRunsController` (`create`, `execute`, `export-csv`) |
| **WhtCertificatesList** | 100% Production Ready | Certificate register, printable modal | `WhtCertificatesController` over `wht_certificates` table |
| **FxRates & Revaluation** | 100% Production Ready | Rate table, manual entry, month-end revaluation run | `FxController` (`syncRates`, `postRevaluation`) |
| **FixedAssets & Depreciation** | 100% Production Ready | Register, straight-line schedule, monthly run | `FixedAssetsController` (`depreciate`, `dispose`) |
| **Budgets Matrix Editor** | 100% Production Ready | Account × Period spreadsheet, CSV import | `BudgetsController` over `budget_lines` table |
| **Banking & Reconciliation** | 100% Production Ready | Two-pane match, confidence score, proof strip | `BankReconciliationController` with automated rule engine |
| **FiscalPeriods & Close** | 100% Production Ready | Readiness checklist, close, dual-approver reopen | `FiscalPeriodsController` enforcing `PeriodGuard` & exclusion constraints |
| **ReportShell & All Reports** | 100% Production Ready | Parameter panel, pivot by branch, drill-down drawer | `ReportsController` querying PostgreSQL views & line indexes |
| **AuditLog & Verification** | 100% Production Ready | Chained Merkle viewer, live cryptographic verify | `AuditController` querying immutable `audit_events` |

---

## 3. Selector to SQL Mapping

In the mock store, selectors compute derived values on-demand. In production, these map to optimized PostgreSQL queries and views:

| Mock Selector / Store Method | Mock Implementation | PostgreSQL 16 Production Equivalent |
|---|---|---|
| `balanceOf(accountId, asOf, dims?)` | Sums `journal_lines` where `posted_at <= asOf` | ```sql SELECT COALESCE(SUM(debit - credit), 0) FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id WHERE jl.company_id = ? AND jl.account_id = ? AND j.status = 'posted' AND j.journal_date <= ? AND (?::uuid IS NULL OR jl.dim1_value_id = ?); ``` |
| `trialBalance(periodFrom, periodTo, dims?)` | Reduces posted lines across all active accounts | ```sql SELECT a.id, a.code, a.name, a.account_type, COALESCE(SUM(jl.debit), 0) AS total_debit, COALESCE(SUM(jl.credit), 0) AS total_credit, COALESCE(SUM(jl.debit - jl.credit), 0) AS net_movement FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id = a.id LEFT JOIN journals j ON j.id = jl.journal_id AND j.status = 'posted' AND j.fiscal_period_id BETWEEN ? AND ? GROUP BY a.id, a.code, a.name, a.account_type; ``` |
| `movements(accountId, range)` | Filters lines for General Ledger view | ```sql SELECT jl.*, j.number AS journal_number, j.journal_date, j.memo FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id WHERE jl.account_id = ? AND j.status = 'posted' AND j.journal_date BETWEEN ? AND ? ORDER BY j.journal_date ASC, jl.line_no ASC; ``` |
| `agingReport('ar' \| 'ap')` | Iterates over posted documents and calculates buckets | ```sql SELECT c.id AS contact_id, c.name AS contact_name, i.id AS invoice_id, i.number, i.due_date, (i.total - i.settled) AS outstanding, CASE WHEN CURRENT_DATE <= i.due_date THEN 'current' WHEN CURRENT_DATE <= i.due_date + 30 THEN '1_30' WHEN CURRENT_DATE <= i.due_date + 60 THEN '31_60' WHEN CURRENT_DATE <= i.due_date + 90 THEN '61_90' ELSE 'over_90' END AS bucket FROM invoices i JOIN contacts c ON c.id = i.contact_id WHERE i.company_id = ? AND i.status = 'posted' AND (i.total - i.settled) > 0; ``` |
| `taxReturn(periodId)` | Aggregates Output & Input tax lines | ```sql SELECT tc.kind, tc.code, SUM(jl.credit) AS output_tax, SUM(jl.debit) AS input_tax FROM journal_lines jl JOIN tax_codes tc ON tc.id = jl.tax_code_id JOIN journals j ON j.id = jl.journal_id WHERE j.fiscal_period_id = ? AND j.status = 'posted' GROUP BY tc.kind, tc.code; ``` |

---

## 4. Mock API to Laravel 11 Endpoint Contract

The modular frontend API (`src/mock/api/*`) maps directly to standard RESTful Laravel controllers:

### 4.1 Authentication & Security (`src/mock/api/auth.ts`)
| Mock API Function | HTTP Method | Production Laravel Route | Description |
|---|---|---|---|
| `login(email, password)` | `POST` | `/api/v1/auth/login` | Authenticates credentials, returns session / token. |
| `verify2FA(code)` | `POST` | `/api/v1/auth/2fa/verify` | Verifies TOTP code, returns tenant context. |
| `verifySigningPin(pin)` | `POST` | `/api/v1/auth/signing-pin/verify` | Validates 6-digit signing PIN against `users.signing_pin_hash`, records attempt, returns signature token. |
| `changeSigningPin(old, new)` | `PUT` | `/api/v1/auth/signing-pin` | Re-authenticates and updates user's signing PIN. |

### 4.2 Documents: Invoices, Bills & Settlements (`src/mock/api/documents.ts`)
| Mock API Function | HTTP Method | Production Laravel Route | Description |
|---|---|---|---|
| `getInvoices(filters)` | `GET` | `/api/v1/companies/{co}/invoices` | Paginated invoices list with eager contact and status. |
| `getInvoiceById(id)` | `GET` | `/api/v1/companies/{co}/invoices/{id}` | Invoice detail with lines and journal link. |
| `createInvoice(draft)` | `POST` | `/api/v1/companies/{co}/invoices` | Creates draft sales invoice. |
| `submitInvoice(id)` | `POST` | `/api/v1/companies/{co}/invoices/{id}/submit` | Transitions invoice to `pending_approval`. |
| `approveInvoice(id, sig)` | `POST` | `/api/v1/companies/{co}/invoices/{id}/approve` | Checks maker ≠ checker, allocates gapless number, posts journal entry. |
| `getBills(filters)` | `GET` | `/api/v1/companies/{co}/bills` | Paginated supplier bills list. |
| `createBill(draft)` | `POST` | `/api/v1/companies/{co}/bills` | Creates draft supplier bill. |
| `approveBill(id, sig)` | `POST` | `/api/v1/companies/{co}/bills/{id}/approve` | Posts AP journal and updates bill status. |
| `createReceipt(draft)` | `POST` | `/api/v1/companies/{co}/settlements/receipts` | Posts receipt, allocates to invoices, posts realised FX gain/loss. |
| `executePaymentRun(payload)` | `POST` | `/api/v1/companies/{co}/payment-runs` | Executes batch payment, deducts WHT, generates certificates. |

### 4.3 General Ledger & Fiscal Periods (`src/mock/api/ledger.ts`)
| Mock API Function | HTTP Method | Production Laravel Route | Description |
|---|---|---|---|
| `getJournals(filters)` | `GET` | `/api/v1/companies/{co}/journals` | Paginated journal entries list. |
| `createJournal(draft)` | `POST` | `/api/v1/companies/{co}/journals` | Creates manual journal entry. |
| `postJournal(draft)` | `POST` | `/api/v1/companies/{co}/journals/post` | Validates balance and period, allocates sequence, posts lines. |
| `reverseJournal(id, reason)` | `POST` | `/api/v1/companies/{co}/journals/{id}/reverse` | Posts exact mirror reversal journal with swapped debits and credits. |
| `getFiscalPeriods()` | `GET` | `/api/v1/companies/{co}/fiscal-periods` | Calendar of periods and statuses. |
| `closePeriod(id)` | `POST` | `/api/v1/companies/{co}/fiscal-periods/{id}/close` | Validates close readiness checks and locks period. |
| `requestPeriodReopen(id, reason)` | `POST` | `/api/v1/companies/{co}/fiscal-periods/{id}/reopen-request` | Initiates dual-approver reopen request. |
| `approvePeriodReopen(id, sig)` | `POST` | `/api/v1/companies/{co}/fiscal-periods/{id}/reopen-approve` | Records distinct approver PIN; reopens period when 2 distinct signatures exist. |

### 4.4 Banking & Treasury (`src/mock/api/banking.ts`)
| Mock API Function | HTTP Method | Production Laravel Route | Description |
|---|---|---|---|
| `getBankAccounts()` | `GET` | `/api/v1/companies/{co}/bank-accounts` | List of bank and cash accounts. |
| `getStatementLines(accId)` | `GET` | `/api/v1/companies/{co}/bank-accounts/{id}/statement-lines` | Statement feeds for reconciliation. |
| `matchBankLines(matches)` | `POST` | `/api/v1/companies/{co}/bank-reconciliations/match` | Matches bank lines against GL transactions. |
| `completeReconciliation(rec)` | `POST` | `/api/v1/companies/{co}/bank-reconciliations/complete` | Asserts difference = 0, locks statement lines, saves certification report. |

### 4.5 Currencies, FX & Revaluation (`src/mock/api/fx.ts`)
| Mock API Function | HTTP Method | Production Laravel Route | Description |
|---|---|---|---|
| `getExchangeRates()` | `GET` | `/api/v1/companies/{co}/exchange-rates` | Rates by currency pair and date. |
| `syncProviderRates()` | `POST` | `/api/v1/companies/{co}/exchange-rates/sync` | Fetches live central bank / market rates. |
| `postFxRevaluation(payload)` | `POST` | `/api/v1/companies/{co}/fx/revaluations` | Posts unrealised FX journal and schedules auto-reversing journal in next period. |

### 4.6 Fixed Assets & Depreciation (`src/mock/api/assets.ts`)
| Mock API Function | HTTP Method | Production Laravel Route | Description |
|---|---|---|---|
| `getFixedAssets()` | `GET` | `/api/v1/companies/{co}/fixed-assets` | Asset register with calculated NBV and depreciation. |
| `postDepreciationRun(periodId)` | `POST` | `/api/v1/companies/{co}/fixed-assets/depreciation-run` | Calculates straight-line/declining depreciation and posts GL journal. |

### 4.7 Budgets (`src/mock/api/budgets.ts`)
| Mock API Function | HTTP Method | Production Laravel Route | Description |
|---|---|---|---|
| `getBudget(yearId)` | `GET` | `/api/v1/companies/{co}/budgets/{yearId}` | Matrix data (Account × Period × Amount). |
| `saveBudgetLines(lines)` | `PUT` | `/api/v1/companies/{co}/budgets/{yearId}/lines` | Bulk upsert of budget lines. |

### 4.8 Audit Trail & Compliance (`src/mock/api/audit.ts`)
| Mock API Function | HTTP Method | Production Laravel Route | Description |
|---|---|---|---|
| `getAuditEvents(filters)` | `GET` | `/api/v1/companies/{co}/audit-events` | Chronological audit log with previous and current hashes. |
| `verifyAuditChain()` | `POST` | `/api/v1/companies/{co}/audit-events/verify` | Recomputes SHA-256 Merkle chain from genesis to tip, reports integrity status. |

---

## 5. Controls Enforcement in Laravel & PostgreSQL

### 5.1 Gapless Numbering Under High Concurrency
In `PostingRules.ts`, sequence allocation is synchronous. In Laravel / PostgreSQL, allocate sequence numbers using pessimistic locking inside the database transaction:
```sql
-- Atomic sequence allocation
SELECT next_value, prefix, padding
FROM sequences
WHERE company_id = :company_id AND sequence_key = :sequence_key
FOR UPDATE;

UPDATE sequences
SET next_value = next_value + 1
WHERE company_id = :company_id AND sequence_key = :sequence_key;
```

### 5.2 Immutable Journal Lines Trigger
Prevent tampering with posted general ledger lines at the database engine level:
```sql
CREATE OR REPLACE FUNCTION assert_journal_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('posted', 'reversed') AND NEW.status != 'reversed' THEN
    RAISE EXCEPTION 'Posted or reversed journals cannot be modified (journal_id: %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_immutable
BEFORE UPDATE OR DELETE ON journals
FOR EACH ROW EXECUTE FUNCTION assert_journal_immutable();

CREATE OR REPLACE FUNCTION assert_journal_line_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT status FROM journals WHERE id = OLD.journal_id) IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Journal lines belonging to a posted journal are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_line_immutable
BEFORE UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION assert_journal_line_immutable();
```

### 5.3 Balanced Journal Constraint
Enforce double-entry debit-credit equality at the commit boundary:
```sql
CREATE OR REPLACE FUNCTION assert_journal_balanced()
RETURNS CONSTRAINT TRIGGER AS $$
DECLARE
  v_debit bigint;
  v_credit bigint;
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM journal_lines
  WHERE journal_id = NEW.id;

  IF NEW.status = 'posted' AND v_debit <> v_credit THEN
    RAISE EXCEPTION 'Journal % is unbalanced: debits (%) <> credits (%)', NEW.id, v_debit, v_credit;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_journal_balanced
AFTER INSERT OR UPDATE ON journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();
```

### 5.4 Multi-Tenant Row-Level Security (RLS)
Every tenant query must be isolated:
```sql
ALTER TABLE journals ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_journals ON journals
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```
In Laravel, the `SetTenantContext` middleware sets the session context on every pooled database connection:
```php
DB::statement("SET LOCAL app.tenant_id = ?", [$tenantId]);
```

---

## 6. Offline-First Replay & Conflict Protocol

The client-side `outbox` (`pending_ops` stored in Dexie) translates into server `client_ops`:
1. **Client Action Offline**: When offline, the client queues operations with a client-generated UUIDv7 (`op_id`).
2. **Drafts vs Server Actions**:
   - Creating/modifying drafts retains a provisional `DRAFT-` number locally.
   - Posting or approving is marked `queued` in the UI.
3. **Reconnection & Ingestion**:
   - The frontend calls `POST /api/v1/sync/outbox` with an array of operations.
   - The server applies operations in order within a single transaction per tenant.
   - Idempotency is guaranteed via the `idempotency_keys` table matching `client_op_id`.
4. **409 Version Conflict Resolution**:
   - If the server document `updated_at` > `client_base_version`, the server returns HTTP `409 Conflict` with `{ client_version, server_version, diff }`.
   - The frontend opens `ConflictDialog.tsx` presenting the visual diff and three options: **Reload Server Version**, **Overwrite**, or **Keep Both (Fork)**.

---

## 7. Migration Checklist for Backend Engineers

- [ ] Run PostgreSQL 16 migrations matching `05_Schema.md` (including triggers, RLS, and GIST constraints).
- [ ] Implement `PostingRules` service class in Laravel mirroring `src/mock/PostingRules.ts`.
- [ ] Configure spatie/laravel-permission with `team_id = company_id`.
- [ ] Set up `PeriodGuard` middleware to block writes to closed periods.
- [ ] Configure `MakerChecker` guard to enforce maker ≠ checker on document approval.
- [ ] Implement SHA-256 Merkle chaining in `AuditService` matching `src/lib/hash.ts`.
- [ ] Implement 6-digit signing PIN validation with 3-strike rate-limiting and 30-second lockout.
- [ ] Connect frontend API client (`src/mock/api/*`) to Laravel routes by switching `VITE_USE_MOCK_API=false`.
