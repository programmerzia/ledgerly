# 06 — Implementation Plan (living checklist)

Rules for the coding agent:
- Work top-down; do not start a step whose dependencies are unchecked.
- Tick `[x]` only when code + tests exist and CI passes. Add the date and PR/commit.
- When a step reveals a design change, update the relevant doc (01–05) **first**, note the
  change under "Decision log" below, then continue.
- Each step is one PR-sized unit (≤ ~400 lines diff where possible).

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why)

## Phase 0 — Repository & tooling
- [ ] 0.1 `laravel new` (Laravel 12, React starter kit: Inertia 2 + React 19 + TS + Tailwind 4 + shadcn), PHP 8.4
- [ ] 0.2 Docker Compose: php-fpm, nginx, postgres 16, redis 7, minio, mailpit; `make up/down/test`
- [ ] 0.3 Tooling: Pint, PHPStan (larastan L8), Pest 3, ESLint/Prettier, Vitest, Husky pre-commit
- [ ] 0.4 GitHub Actions CI: lint → phpstan → pest (pg service) → vitest → build
- [ ] 0.5 Packages (per 04_TRD §2): fortify, sanctum, horizon, pennant, cashier, spatie/permission, brick/money, openspout, browsershot, typescript-transformer
- [ ] 0.6 `.env.example`, config for two DB connections (app role / owner role for migrations, reporting replica)
- [ ] 0.7 ADR folder `docs/adr/` with ADR-0001 (integrated Inertia monolith), ADR-0002 (single DB + RLS tenancy), ADR-0003 (integer minor units)

## Phase 1 — Database foundation, tenancy & auth
- [ ] 1.1 Migrations: tenants, users, tenant_users, invitations, companies, company_settings (05 §1–2)
- [ ] 1.2 Postgres roles migration: owner vs `app` role; helper `Schema::enableRls($table)` macro writing RLS policy SQL
- [ ] 1.3 `TenantContext` + `SetTenantContext` middleware (`SET LOCAL app.tenant_id`); `SetCompanyContext` by slug
- [ ] 1.4 Fortify auth: register (creates tenant+company), login, 2FA TOTP, password reset, invitations
- [ ] 1.5 spatie/permission with teams = company; seed roles (Owner, Finance Manager, Accountant, Approver, Viewer, Auditor) and permission matrix
- [ ] 1.6 Policies skeleton + `tests/Feature/Auth` (register, invite, 2FA enforce, cross-tenant access denied at DB level)
- [ ] 1.7 `audit_events` + hash chain writer (`Audit::record()`), immutability trigger, `SealAuditLog` job + `audit_seals`
- [ ] 1.8 Invariant test: RLS blocks cross-tenant read even with a crafted query (raw SQL test as app role)

## Phase 2 — Core ledger domain & API
- [ ] 2.1 Migrations: currencies, accounts, dimensions, dimension_values, account_dimension_rules, chart_templates + seeders (IFRS SME, US small biz, Non-profit, Insurance)
- [ ] 2.2 Migrations: fiscal_years, fiscal_periods (exclusion constraints), period_close_checks, period_reopen_requests
- [ ] 2.3 Migrations: journals, journal_lines, sequences, account_period_balances, recurring_journals; immutability + balanced triggers (raw SQL)
- [ ] 2.4 Domain: `Money` wrappers, `Posting\JournalBuilder`, `Posting\Balancer` (per currency + base), `Numbering\SequenceAllocator` (FOR UPDATE)
- [ ] 2.5 Actions: `CreateJournalDraft`, `UpdateJournalDraft`, `SubmitDocument`, `ApproveDocument` (maker≠checker, workflow steps), `ReturnDocument`, `PostJournal` (transactional: validate period, dims, balance → allocate number → insert lines → update balances → audit → event), `ReverseJournal`, `VoidDocument`
- [ ] 2.6 `PeriodGuard`, `ClosePeriod`, `SoftClosePeriod`, `ReopenPeriod` (two approvers), `LockFiscalYear`, `YearEndClose` (P&L → retained earnings)
- [ ] 2.7 Approval workflows tables + `WorkflowResolver` (document type, amount thresholds)
- [ ] 2.8 API v1: auth tokens with abilities, `Idempotency` middleware, endpoints for accounts, dimensions, periods, journals (CRUD draft, submit, approve, post, reverse); OpenAPI spec generated
- [ ] 2.9 Tests: Feature per action (happy / unbalanced / closed period / forbidden dims / self-approve / idempotent replay); `tests/Invariants/LedgerInvariantsTest` (debits=credits, gapless numbers, balances view = lines)
- [ ] 2.10 Contacts, tax_codes/rates/groups migrations + Actions + API
- [ ] 2.11 Invoices (4 kinds) + invoice_lines + items: Actions `CreateInvoiceDraft`, `SubmitInvoice` → generates journal via `PostJournal`; tax calculation service; API
- [ ] 2.12 Settlements + allocations + FX realised gain/loss; payment_runs + WHT certificates; API
- [ ] 2.13 Banking: bank_accounts, statements, lines, rules, reconciliations; parsers CSV/OFX/CAMT; `MatchStatementLine`, `FinishReconciliation`; API
- [ ] 2.14 FX: exchange_rates, provider interface + ECB adapter, `RunFxRevaluation` (+ auto reversal next period)
- [ ] 2.15 Reporting queries: TB, GL detail, BS, P&L, Cash flow (indirect), AR/AP aging, statements, tax return; `ReportRunner` job + cache; XLSX/CSV/PDF exporters
- [ ] 2.16 Webhooks (endpoints, deliveries, signing, retries) on domain events
- [ ] 2.17 Imports framework (mapping, preview, validation, queued apply) for contacts, accounts, opening balances, invoices, bank lines

- [ ] 2.18 Signing PIN (ADR-0004): users columns, `Sign` action, lockout, signature hash on approval_requests, signing_events
- [ ] 2.19 Client ops replay endpoint (ADR-0005): `client_ops`, idempotent apply, conflict (409) responses

## Phase 3 — UI integration (Inertia/React)
- [ ] 3.1 Design tokens in Tailwind `@theme` (03 §2–4), dark mode, Inter/JetBrains Mono, shadcn install, `StatusPill`, `MoneyInput`, `AccountPicker`, `DimensionChips`, `LineGrid`, `DataTable`, `ApprovalBar`, `ConfirmDialog`, `EmptyState`
- [ ] 3.2 App shell: sidebar, top bar, company switcher, ⌘K palette, notifications, keyboard shortcuts
- [ ] 3.3 Auth pages + onboarding wizard (6 steps)
- [ ] 3.4 Chart of accounts, dimensions, periods (with close checklist, reopen flow), FX rates screens
- [ ] 3.5 Journals list/form/view (+ reversal, duplicate, recurring templates)
- [ ] 3.6 Approvals inbox + bulk approve
- [ ] 3.7 Sales: customers, invoices, credit notes, receipts (allocation UI)
- [ ] 3.8 Purchases: suppliers, bills, debit notes, payments, payment run wizard
- [ ] 3.9 Banking: accounts, import wizard, reconciliation workspace, rules
- [ ] 3.10 Reports shell with parameters, drill-down drawer, export, saved layouts, schedules
- [ ] 3.11 Settings: company, numbering, posting accounts, workflows, templates, API tokens, webhooks; Org: users/roles, security, audit log viewer, billing (Cashier portal)
- [ ] 3.12 Dashboard widgets
- [ ] 3.13 PDF templates (invoice, receipt, statement, journal voucher)
- [ ] 3.14 Vitest component tests for MoneyInput, LineGrid balancing, StatusPill; Dusk smoke: login → create invoice → approve → post → TB shows it

- [ ] 3.15 Desktop frame (03 §10): 100vh frame, document tabs, split panes, context menus, status bar, density, shortcut registry + `?` overlay
- [ ] 3.16 Sign dialog + cached signature timer
- [ ] 3.17 PWA + IndexedDB cache + outbox + queued status + sync indicator
- [ ] 3.18 ReportShell with pivot by dimension, comparison columns, web-worker compute, saved layouts
- [ ] 3.19 FX module screens (rates, revaluation run), Fixed assets, Budgets grid, Tax screens

## Phase 4 — Hardening, edge cases, launch
- [ ] 4.1 Edge-case tests: FX rounding across lines, overpayment → on-account, partial allocation then reversal, posting on period boundary dates, year-end close then reopen, concurrent sequence allocation (parallel posts), idempotent replay with changed payload (409), RLS under connection pooling
- [ ] 4.2 Balance drift detector job + alert; nightly audit seal verification command
- [ ] 4.3 Performance: seed 1M lines tenant; EXPLAIN key reports; add `account_period_balances` partition plan if needed; P95 budgets from 04 §6
- [ ] 4.4 Security: CSP nonces, rate limits, dependency audit, ZAP baseline scan, pen-test checklist (ASVS L2)
- [ ] 4.5 Observability: OTEL traces, Sentry, Pulse, structured logs, health endpoints
- [ ] 4.6 Billing: plans, trial, limits enforcement (companies/users), dunning emails, webhooks
- [ ] 4.7 Data export (tenant JSON/CSV bundle) and deletion job
- [ ] 4.8 Backups + restore drill documented; staging environment; deploy pipeline
- [ ] 4.9 Help docs & in-app guide; release notes; GA checklist

## Phase 4b — Platform Admin (10_SaaS_Admin.md)
- [ ] 4b.1 Admin guard, admin_users, 2FA, IP allowlist, admin_audit_events hash chain, two-person approvals
- [ ] 4b.2 Plans, plan_versions, addons, coupons; Stripe product/price sync command; Entitlements service + usage_daily counters + limit enforcement in app
- [ ] 4b.3 Stripe webhooks → stripe_events, stripe_invoices mirror, subscription status, lifecycle state machine (trial → active → past_due → read_only → suspended → cancelled → deleted) with dunning scheduler
- [ ] 4b.4 Admin UI: dashboard KPIs, tenants list and tenant page (subscription, invoices, usage, users, companies, flags, support tools, notes, audit)
- [ ] 4b.5 Billing operations: invoices, refunds and credit notes queue, payouts reconciliation export, tax reports, revenue recognition export
- [ ] 4b.6 Growth: trials funnel, nudges, manual conversion; Support: global search, impersonation (read/write with approval), job and email and webhook logs, announcements
- [ ] 4b.7 Ops and flags: health panels, maintenance mode, rate-limit overrides, Pennant admin; Compliance: GDPR requests, retention jobs
- [ ] 4b.8 Tenant-side /org/billing completion: proration preview, add-ons, cancel flow with retention offer

## Phase 5 (R2, not started) — Fixed assets, budgets, consolidation eliminations, e-invoicing adapters, bank feeds, AI coding

## Decision log
| Date | Decision | Doc updated |
|---|---|---|
| 2026-10-27 | Integrated Inertia monolith chosen over separate SPA | 04_TRD §1 |
| 2026-10-27 | Single DB + PostgreSQL RLS multi-tenancy | 04_TRD §4, 05_Schema §14 |
| 2026-10-27 | Amounts as bigint minor units | 04_TRD §3 |
| 2026-10-28 | Signing PIN for checker actions | ADR-0004, 02 §15, 05 §16 |
| 2026-10-28 | Offline scoped to drafts/reads; server actions queue | ADR-0005, 02 §16, 05 §16 |
| 2026-10-28 | Desktop-app frame and keyboard-first rules | 03 §10 |
| 2026-10-28 | Platform Admin as separate /admin surface; Stripe is billing system of record | 10_SaaS_Admin |
