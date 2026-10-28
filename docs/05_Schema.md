# 05 — Database Schema (PostgreSQL 16)

Conventions: `uuid` PKs (`uuidv7()` generated in app), `tenant_id uuid not null` on every
tenant table, `company_id` on every company-scoped table, `created_at/updated_at timestamptz`,
soft-delete only on drafts/masters (`deleted_at`), amounts `bigint` minor units, rates
`numeric(20,8)`. All FKs `on delete restrict` unless stated. Snake_case. Table names plural.

## 1. Platform (shared, no RLS)

```sql
tenants            (id pk, name, slug unique, status enum[active,suspended,deleted], plan_id, trial_ends_at, settings jsonb, created_at, updated_at)
users              (id pk, email citext unique, name, password, two_factor_secret, two_factor_recovery_codes, two_factor_confirmed_at, locale, theme, last_login_at, created_at, updated_at)
tenant_users       (tenant_id fk, user_id fk, status enum[invited,active,disabled], invited_by, joined_at, pk(tenant_id,user_id))
invitations        (id, tenant_id, email, role, token unique, expires_at, accepted_at)
plans / subscriptions / subscription_items   -- Cashier tables + plan features jsonb
feature_flags      -- Pennant table
idempotency_keys   (tenant_id, key, request_hash, response_code, response_body jsonb, created_at, pk(tenant_id,key))  -- TTL 24h
jobs, failed_jobs, job_batches, sessions, cache, personal_access_tokens  -- Laravel defaults
```

## 2. Organisation (RLS)

```sql
companies          (id pk, tenant_id, name, legal_name, slug, country char(2), base_currency char(3), timezone, locale,
                    fiscal_year_start_month smallint, tax_id, address jsonb, logo_path, settings jsonb, status, created_at, updated_at)
                    unique(tenant_id, slug)
roles / permissions / model_has_roles / model_has_permissions / role_has_permissions  -- spatie, with team_id = company_id
company_settings   (company_id pk, posting_accounts jsonb  -- {ar_control, ap_control, tax_output, tax_input, fx_realised, fx_unrealised, rounding, suspense, retained_earnings, bank_clearing, wht_payable}
                    , numbering jsonb, approval_defaults jsonb, document_templates jsonb)
```

## 3. Chart of accounts & dimensions

```sql
accounts           (id pk, tenant_id, company_id, code varchar(32), name, account_type enum[asset,liability,equity,income,expense],
                    account_subtype varchar(64), normal_balance enum[debit,credit], parent_id fk accounts null,
                    currency_policy enum[base_only,any,fixed], fixed_currency char(3) null,
                    control_type enum[none,ar,ap,bank,cash,tax,retained_earnings,suspense,fixed_asset,accum_depr] default 'none',
                    is_postable bool, is_active bool, reporting_tags text[], description, created_at, updated_at, deleted_at)
                    unique(company_id, code); index(company_id, account_type); check(is_postable or parent not null...)
dimensions         (id pk, tenant_id, company_id, code, name, position smallint 1..8, is_active)   unique(company_id, code)
dimension_values   (id pk, tenant_id, company_id, dimension_id fk, code, name, parent_id null, is_active)  unique(dimension_id, code)
account_dimension_rules (account_id fk, dimension_id fk, rule enum[required,optional,forbidden], pk(account_id,dimension_id))
chart_templates    (id, code, name, country, standard, lines jsonb)   -- shared seed, no RLS
```

## 4. Fiscal calendar

```sql
fiscal_years       (id pk, tenant_id, company_id, name, starts_on date, ends_on date, status enum[open,closed,locked])
                    exclude using gist (company_id with =, daterange(starts_on, ends_on, '[]') with &&)
fiscal_periods     (id pk, tenant_id, company_id, fiscal_year_id fk, number smallint, name, starts_on, ends_on,
                    status enum[open,soft_closed,closed,locked], closed_at, closed_by, reopened_count int default 0)
                    exclude gist no-overlap per company; index(company_id, starts_on, ends_on)
period_close_checks (id, period_id fk, check_code, status enum[pass,fail,waived], detail jsonb, checked_at, waived_by)
period_reopen_requests (id, period_id, requested_by, reason, status, first_approver, second_approver, decided_at)
```

## 5. Currencies & FX

```sql
currencies         (code char(3) pk, name, minor_unit smallint, symbol)   -- shared
exchange_rates     (id pk, tenant_id, company_id, from_currency, to_currency, rate_date date, rate numeric(20,8),
                    source enum[manual,provider,document], created_by)  unique(company_id, from_currency, to_currency, rate_date, source)
fx_revaluations    (id pk, tenant_id, company_id, period_id, as_of date, status, journal_id, reversal_journal_id, detail jsonb)
```

## 6. Ledger (core; posted rows immutable by trigger)

```sql
journals           (id pk, tenant_id, company_id, fiscal_period_id fk, journal_type enum[manual,sales,purchase,receipt,payment,bank,fx,depreciation,closing,reversal,opening],
                    number varchar(32) null  -- gapless, set at post
                    , status enum[draft,pending_approval,posted,reversed,void],
                    journal_date date, posted_at timestamptz, reference, memo,
                    source_type varchar(64) null, source_id uuid null,       -- polymorphic to invoice/bill/receipt...
                    reversal_of_id fk journals null, reversed_by_id fk journals null,
                    total_debit bigint, total_credit bigint,                 -- base currency, denormalised, checked = sum(lines)
                    created_by, submitted_by, approved_by, posted_by, created_at, updated_at)
                    unique(company_id, number); index(company_id, journal_date); index(company_id, status); index(source_type, source_id)
journal_lines      (id pk, tenant_id, company_id, journal_id fk, line_no smallint, account_id fk,
                    debit bigint default 0, credit bigint default 0,          -- base currency minor units
                    currency char(3), fx_rate numeric(20,8), amount_fc bigint, -- foreign currency amount (signed: +debit/−credit)
                    dim1_value_id .. dim8_value_id uuid null,                  -- flattened for index & reporting speed
                    description, contact_id uuid null, tax_code_id uuid null, due_date date null,
                    check (debit >= 0 and credit >= 0 and (debit = 0 or credit = 0)))
                    index(company_id, account_id, journal_id); index(journal_id); index(company_id, contact_id); btree on each dimN
sequences          (id, tenant_id, company_id, sequence_key varchar(64)  -- e.g. 'journal:manual:2026', 'invoice:2026'
                    , prefix, next_value bigint, padding smallint, unique(company_id, sequence_key))
                    -- allocated with SELECT ... FOR UPDATE inside the posting transaction
account_period_balances (tenant_id, company_id, account_id, fiscal_period_id, dim1_value_id..dim8_value_id,
                    debit bigint, credit bigint, pk(company_id, account_id, fiscal_period_id, dim1..dim8 coalesced))
                    -- maintained by PostJournal; nightly job recomputes and alerts on drift
recurring_journals (id, tenant_id, company_id, name, schedule_cron, next_run_on, end_on, template jsonb, is_active, last_journal_id)
```

Triggers (SQL migration): `journals_immutable` and `journal_lines_immutable` raise exception on
UPDATE/DELETE when parent status in (posted, reversed) except the specific `reversed_by_id`
update; `journal_balanced` deferred constraint trigger asserts sum(debit)=sum(credit) at
commit for posted journals.

## 7. Contacts

```sql
contacts           (id pk, tenant_id, company_id, kind enum[customer,supplier,both], code, name, legal_name, tax_id, email, phone,
                    billing_address jsonb, shipping_address jsonb, default_currency, payment_terms_days smallint, credit_limit bigint null,
                    ar_account_id null, ap_account_id null, wht_code_id null, default_dims jsonb, is_active, notes, created_at, updated_at, deleted_at)
                    unique(company_id, code); gin trigram on name
```

## 8. Tax

```sql
tax_codes          (id pk, tenant_id, company_id, code, name, kind enum[vat,gst,sales,wht,compound,exempt,zero,reverse_charge],
                    collect_account_id, pay_account_id, is_recoverable bool, is_active)
tax_rates          (id, tax_code_id fk, rate numeric(9,6), effective_from date, effective_to date null)
tax_groups         (id, company_id, code, name) ; tax_group_items(tax_group_id, tax_code_id, sequence, compound bool)
tax_periods        (id, company_id, tax_authority, starts_on, ends_on, status, filed_at, return_snapshot jsonb)
wht_certificates   (id, company_id, number, payment_id, contact_id, tax_code_id, base_amount, wht_amount, issued_on)
```

## 9. Receivables & payables (documents)

```sql
invoices           (id pk, tenant_id, company_id, kind enum[sales_invoice,credit_note,purchase_bill,debit_note],
                    number null, status enum[draft,pending_approval,posted,reversed,void], contact_id fk,
                    issue_date, due_date, currency, fx_rate, reference, memo,
                    subtotal_fc, tax_total_fc, total_fc, subtotal, tax_total, total,   -- fc = document currency, plain = base
                    settled_fc bigint default 0, settled bigint default 0,
                    related_invoice_id null  -- credit/debit note against
                    , journal_id fk journals null, dims jsonb, created_by, approved_by, posted_at, created_at, updated_at, deleted_at)
                    unique(company_id, kind, number); index(company_id, contact_id, status); index(company_id, due_date) where status='posted'
invoice_lines      (id, invoice_id fk, line_no, item_id null, account_id fk, description, quantity numeric(18,6), unit_price_fc bigint,
                    discount_pct numeric(7,4), tax_code_id null, line_total_fc, tax_amount_fc, dim1..dim8)
items              (id, company_id, code, name, kind enum[service,good], sales_account_id, purchase_account_id, sales_price bigint, currency, tax_code_id, is_active)
settlements        (id pk, tenant_id, company_id, kind enum[receipt,payment,refund],
                    number, status, contact_id, bank_account_id fk, settlement_date, currency, fx_rate,
                    amount_fc, amount, unallocated_fc, bank_charges_fc, wht_amount_fc, reference, memo,
                    payment_run_id null, journal_id null, created_by, approved_by, posted_at, ...)
settlement_allocations (id, settlement_id fk, invoice_id fk, amount_fc, amount, fx_gain_loss bigint, created_at)
                    unique(settlement_id, invoice_id)
payment_runs       (id, company_id, number, status, bank_account_id, run_date, currency, total, created_by, approved_by, export_file_path)
```

## 10. Banking

```sql
bank_accounts      (id pk, tenant_id, company_id, name, account_id fk accounts, currency, bank_name, account_number_masked, iban, swift,
                    kind enum[bank,cash,card], import_mapping jsonb, last_statement_balance bigint, last_statement_date, is_active)
bank_statements    (id, bank_account_id, period_from, period_to, opening_balance, closing_balance, source enum[csv,ofx,camt,manual], file_path, imported_by, imported_at)
bank_statement_lines (id, tenant_id, company_id, statement_id fk, bank_account_id, txn_date, value_date, amount bigint (signed), description, reference, counterparty,
                    dedupe_hash char(64), status enum[unmatched,matched,excluded], matched_journal_line_id null, matched_by, matched_at)
                    unique(bank_account_id, dedupe_hash)
bank_rules         (id, bank_account_id, name, priority, conditions jsonb, action jsonb, is_active)
bank_reconciliations (id, bank_account_id, statement_id, as_of, book_balance, statement_balance, difference, status, finished_by, finished_at, report jsonb)
```

## 11. Fixed assets & budgets (R2 tables, defined now)

```sql
fixed_assets       (id, company_id, number, name, category_id, asset_account_id, accum_depr_account_id, depr_expense_account_id,
                    acquired_on, cost, residual, method enum[straight_line,declining], useful_life_months, status, disposed_on, disposal_journal_id)
depreciation_runs  (id, company_id, period_id, status, journal_id, detail jsonb)
budgets            (id, company_id, fiscal_year_id, name, version, status enum[draft,approved,archived])
budget_lines       (budget_id, account_id, fiscal_period_id, dim1..dim8, amount bigint, pk(...))
```

## 12. Workflow, attachments, audit

```sql
approval_workflows (id, tenant_id, company_id, document_type, name, min_amount bigint, max_amount null, steps jsonb -- [{role, count}]
                    , is_active)
approval_requests  (id, tenant_id, company_id, document_type, document_id, workflow_id, step smallint, status enum[pending,approved,returned,cancelled],
                    requested_by, requested_at, decided_by, decided_at, comment)  index(company_id, status, requested_at)
attachments        (id, tenant_id, company_id, attachable_type, attachable_id, disk, path, original_name, mime, size, sha256, scan_status, uploaded_by, created_at)
audit_events       (id bigserial pk, tenant_id, company_id null, actor_id null, actor_type, action varchar(64), subject_type, subject_id,
                    before jsonb, after jsonb, ip inet, user_agent, occurred_at timestamptz,
                    prev_hash char(64), hash char(64))   -- hash = sha256(prev_hash || canonical_json(row))
                    index(tenant_id, occurred_at); index(subject_type, subject_id). Trigger: no UPDATE/DELETE ever.
audit_seals        (id, tenant_id, sealed_through_id bigint, tip_hash, sealed_at, external_receipt jsonb)
webhook_endpoints  (id, tenant_id, url, secret_encrypted, events text[], is_active) ; webhook_deliveries(id, endpoint_id, event, payload, status, attempts, next_retry_at, response_code)
notifications      -- Laravel default
report_layouts     (id, company_id, user_id null, report_code, name, params jsonb, is_default)
report_schedules   (id, company_id, layout_id, cron, recipients text[], format, last_run_at)
imports            (id, company_id, kind, file_path, mapping jsonb, status, rows_total, rows_ok, rows_failed, errors jsonb, created_by)
```

## 13. Views & functions (database/sql)

- `v_account_balances(company_id, account_id, as_of)` → sum of lines (authoritative check).
- `fn_next_sequence(company_id, key)` → `FOR UPDATE` increment, returns formatted number.
- `v_ar_open_items`, `v_ap_open_items` → invoices with `total − settled > 0`.
- `v_trial_balance(company_id, period_from, period_to, dims...)` over `account_period_balances`.

## 14. Row-Level Security & auth flow

```sql
ALTER TABLE <every tenant table> ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- app role: GRANT SELECT, INSERT, UPDATE, DELETE; no BYPASSRLS; not owner. Migrations run as owner role.
```

Request flow:
1. Session/token authenticated → `SetTenantContext` resolves tenant (from user's active
   tenant or token's tenant) → `SET LOCAL app.tenant_id` (reads: `SET app.tenant_id` on the
   pooled connection, reset on release).
2. `SetCompanyContext` resolves company from URL slug, checks `tenant_users` + company role.
3. Policies check spatie permissions with `team_id = company_id`.
4. Posting actions additionally call `PeriodGuard::assertOpen(company, date)` and
   `MakerChecker::assertNotSelf(document, approver)`.

## 15. Indexing & partitioning notes

- `journal_lines` and `audit_events` partitioned by `tenant_id` hash (16 partitions) once a
  tenant exceeds ~5M lines; start unpartitioned with the indexes above.
- Partial indexes on `status = 'posted'` for due-date queries.
- `pg_trgm` GIN on contacts.name, accounts.name, journals.reference.
- Statement-level `statement_timeout = 30s` for web connection, 10 min for reporting.

## 16. Additions (2026-10-28): signing and offline

```sql
users              + signing_pin_hash varchar null, signing_pin_set_at, signing_failed_count smallint default 0, signing_locked_until timestamptz null
approval_requests  + signed_by uuid, signed_at timestamptz, signature_hash char(64)   -- sha256(document_id||status||signer||signed_at||audit prev_hash)
signing_events     (id, tenant_id, user_id, kind enum[success,failure,lockout,pin_changed], subject_type, subject_id, ip, occurred_at)
client_ops         (id uuid pk  -- client-generated, idempotency key
                    , tenant_id, company_id, user_id, op_type varchar(64), payload jsonb, client_created_at, received_at, applied_at, status enum[applied,rejected,conflict], error jsonb)
```
