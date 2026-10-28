# 10 — Platform Admin (SaaS operator back-office)

The **Platform Admin** is the vendor-side console used by Ledgerly's own staff (owner, sales,
support, finance, engineering). It is not visible to tenants. Tenants manage their own plan
under `/org/billing` (02_AppFlow §12); this document covers everything on the vendor side.

## 1. Principles

- Separate app surface: `/admin/*` routes, separate guard (`admin` users table), mandatory
  2FA + hardware key optional, IP allowlist, every action audited to `admin_audit_events`.
- Stripe is the billing system of record for money; Ledgerly mirrors it for reporting and
  product gating. Never compute invoices twice.
- Platform roles: Owner, Finance, Sales, Support, Engineer, Read-only. Impersonation and
  refunds need Owner or a two-person approval.
- Everything a tenant can see about their subscription, support can see too, plus internals.

## 2. Personas

| Persona | Needs |
|---|---|
| Owner / CEO | MRR, churn, trials, conversion, cash collected, top tenants, risk |
| Finance (vendor) | invoices, payments, refunds, credit notes, dunning, tax (VAT on SaaS), revenue recognition export, reconciliation with Stripe payouts |
| Sales | trials pipeline, plan changes, custom quotes, discounts, enterprise contracts, partner/reseller tenants |
| Support | find tenant/user, see subscription and limits, impersonate (consented, logged), reset 2FA, resend invites, view job failures, data export, announcements |
| Engineer | tenant health, usage, feature flags, queue and job health, migrations status, API keys abuse, rate-limit overrides |

## 3. Modules and screens

### 3.1 Overview dashboard `/admin`
MRR, ARR, net new MRR (new, expansion, contraction, churn), active tenants, trials and
conversion %, failed payments, open support items, system health (queues, error rate, p95),
today's signups, revenue by plan, geography, cohort retention chart.

### 3.2 Tenants `/admin/tenants`
List: name, plan, status (trial, active, past_due, suspended, cancelled, deleted), companies,
users, MRR, country, created, last activity, health score. Filters and saved views.
Tenant page tabs:
- **Overview**: owner, contacts, plan, limits vs usage (companies, users, journal lines,
  storage, API calls), lifecycle timeline.
- **Subscription**: current plan, items, quantities, discounts, trial end, next invoice
  preview, change plan, apply coupon, extend trial, pause, cancel (at period end /
  immediately), reactivate. All via Stripe API.
- **Invoices & payments**: Stripe invoices mirrored, status, PDF, resend, refund (two-person),
  credit note, write-off, payment method, dunning state.
- **Usage**: metered counters by day (lines posted, API calls, storage, reports), overage.
- **Users**: list, roles, 2FA state, last login; actions: reset 2FA, resend invite, disable,
  transfer ownership (with consent email).
- **Companies**: list with base currency, fiscal year, period states, document counts.
- **Feature flags**: per-tenant overrides (Pennant).
- **Support tools**: impersonate (requires reason + tenant admin consent token or Owner
  override; banner shown; read-only by default; all writes blocked unless "write mode" with
  second approver), data export, GDPR delete request, audit seal verify, re-run failed jobs.
- **Notes & tickets**: internal notes, linked help-desk tickets (Help Scout / Zendesk link).
- **Audit**: everything staff did to this tenant.

### 3.3 Plans & pricing `/admin/plans`
Plans (Starter, Professional, Business, Enterprise) with: monthly/annual prices per currency
(USD, KES, EUR), included limits (companies, users, journal lines/month, storage, API
calls), feature entitlements (multi-currency, approvals, fixed assets, budgets, API, SSO,
audit export, custom roles), add-ons (extra company, extra user pack, extra storage),
metered items (API overage), trial length, grandfathering rules. Versioned: editing creates a
new version; existing subscribers keep theirs until migrated. Synced to Stripe Products/Prices.

### 3.4 Coupons & discounts `/admin/coupons`
Percent/amount, duration (once, N months, forever), restrictions (plan, new only, expiry,
max redemptions), partner codes with attribution. Mirrors Stripe coupons.

### 3.5 Billing operations `/admin/billing`
- Invoices (all tenants): status, aging, dunning stage, retry schedule, failed-reason.
- Payments and payouts: Stripe payouts reconciled to bank; fees; FX.
- Refunds and credit notes queue (two-person approval).
- Tax: SaaS VAT/GST by customer country (Stripe Tax), tax IDs validation, reverse-charge
  notes, tax reports export.
- Revenue recognition: monthly deferred revenue schedule export (CSV) for the vendor's own
  books (which can be a Ledgerly tenant itself).
- Dunning settings: retry cadence, emails, grace period, suspension day, read-only mode
  before suspension, data retention after cancellation (default 90 days).

### 3.6 Trials & growth `/admin/growth`
Trial list with activation milestones (created company, posted first invoice, invited user,
connected bank), conversion funnel, expiring in 3 days, automated nudges, sales owner
assignment, manual conversion with custom quote.

### 3.7 Partners / resellers `/admin/partners` (R2)
Accounting firms managing many tenants: partner org, linked tenants, revenue share, partner
pricing, partner dashboard access.

### 3.8 Support `/admin/support`
Global search (tenant, user email, company, invoice number, Stripe id), impersonation log,
failed jobs by tenant with retry, email delivery log, webhook delivery log, announcements
(banner/in-app message, target by plan or tenant, schedule), status page incidents, help
article links.

### 3.9 Platform operations `/admin/ops`
Queue health (Horizon link), error rate (Sentry link), p95 by route, DB size per tenant,
largest tenants, slow queries, background job schedule, maintenance mode with message,
migration status, API rate-limit overrides, abuse controls (block tenant, rotate keys),
backup status and restore drill log.

### 3.10 Feature flags `/admin/flags`
Pennant features: global default, percentage rollout, per-plan, per-tenant override, kill
switch; audit of changes.

### 3.11 Staff & security `/admin/staff`
Admin users, roles, 2FA, hardware keys, IP allowlist, session list, admin audit log with
hash chain, two-person approval queue (refunds, impersonation write mode, plan migrations,
tenant deletion).

### 3.12 Compliance `/admin/compliance`
GDPR requests (export, delete) with SLA, data residency tag per tenant, DPA signed flag,
security questionnaire answers, retention jobs.

## 4. Tenant-side billing (already in 02_AppFlow §12, expanded)
`/org/billing`: current plan and usage meters, upgrade/downgrade with proration preview,
annual switch, add-ons, payment method (Stripe Elements), invoices list with PDF, tax ID,
billing contacts, cancel flow with reasons and retention offer, data export before cancel.

## 5. Lifecycle & gating rules

```
trialing(14d) → active → past_due(grace 7d, banner) → read_only(day 8–21) → suspended(day 22) → cancelled → deleted(after 90d)
            └→ cancelled (user cancels at period end)      any state → active on payment
```
Limits enforced in app by a `Plan\Entitlements` service (reads plan version + overrides +
usage counters). Soft limits warn at 80 %, hard limits block with upgrade CTA. Usage counters
are incremented by domain events (DocumentPosted, ApiRequest, FileStored) into `usage_daily`.

## 6. Schema additions (platform, no RLS)

```sql
admin_users        (id, email, name, password, two_factor_*, role enum[owner,finance,sales,support,engineer,readonly], ip_allowlist inet[], is_active)
admin_audit_events (id bigserial, admin_id, action, tenant_id null, subject_type, subject_id, before jsonb, after jsonb, reason, ip, occurred_at, prev_hash, hash)
admin_approvals    (id, kind enum[refund,impersonate_write,plan_migration,tenant_delete], subject jsonb, requested_by, approved_by, status, created_at, decided_at)
plans              (id, code, name, is_active, sort)
plan_versions      (id, plan_id, version, prices jsonb {currency: {monthly, annual}}, limits jsonb, entitlements jsonb, trial_days, stripe_product_id, effective_from, created_by)
plan_addons        (id, code, name, kind enum[company,user_pack,storage,metered_api], price jsonb, stripe_price_id)
coupons            (id, code, stripe_coupon_id, percent, amount, currency, duration, duration_months, restrictions jsonb, max_redemptions, expires_at, partner_id null)
subscriptions      -- Cashier; + plan_version_id, status, trial_ends_at, current_period_end, cancel_at, pause_until
subscription_addons(subscription_id, addon_id, quantity)
tenant_entitlement_overrides (tenant_id, key, value jsonb, reason, set_by, expires_at)
usage_daily        (tenant_id, day, metric varchar(32), value bigint, pk(tenant_id, day, metric))
stripe_invoices    (id, tenant_id, stripe_id, number, status, currency, subtotal, tax, total, amount_paid, due_at, paid_at, pdf_url, dunning_stage, synced_at)
stripe_events      (id, stripe_event_id unique, type, payload jsonb, processed_at, error)
tenant_lifecycle_events (id, tenant_id, from_status, to_status, reason, actor_type, actor_id, occurred_at)
tenant_notes       (id, tenant_id, admin_id, body, pinned, created_at)
impersonation_sessions (id, admin_id, tenant_id, user_id, mode enum[read,write], reason, consent_token, approval_id null, started_at, ended_at)
announcements      (id, title, body, kind, audience jsonb, starts_at, ends_at, created_by)
gdpr_requests      (id, tenant_id, kind, requested_by, status, due_at, completed_at, export_path)
partners           (id, name, revenue_share_pct, pricing jsonb) ; partner_tenants(partner_id, tenant_id)
```

## 7. Integrations
Stripe (Billing, Tax, Customer Portal, webhooks: customer.subscription.*, invoice.*,
payment_intent.*, charge.refunded), help desk link, Sentry, Horizon, status page provider,
email provider logs, Slack alerts (failed payment > $500, tenant suspended, error spike).

## 8. KPIs the dashboard must compute
MRR, ARR, net MRR movement, gross and net revenue retention, logo churn, trial conversion,
ARPA, LTV/CAC (CAC manual input), days sales outstanding on SaaS invoices, failed-payment
recovery rate, time-to-first-value, support load per 100 tenants.

## 9. Out of scope (R1)
Partner portal UI, usage-based pricing beyond API overage, multi-vendor marketplace,
self-serve enterprise contracts, in-app chat.

## 10. Mock prompt (paste for Gemini, attach this file and 03_UI_Spec.md)

> Build the Ledgerly **Platform Admin** as a second app surface under `/admin` inside the
> existing mock, reusing the same tokens, AppShell frame (title bar, sidebar, tabs, status
> bar), DataTable, ContextMenu, Dialog and ReportShell components. Separate login for staff
> with 2FA. Implement every screen in 10_SaaS_Admin.md §3 with the sample data: 120 tenants
> across Starter/Professional/Business/Enterprise, 18 trials, 6 past_due, 2 suspended,
> MRR ≈ $38,400, 14 months of history for charts, 400 Stripe-style invoices, 25 coupons,
> 9 staff users across the roles. Make these flows real in the store: change plan with
> proration preview, extend trial, apply coupon, refund with two-person approval, impersonate
> in read mode with banner and audit entry, suspend/reactivate, feature-flag override, send
> announcement, GDPR export request. Dashboard KPIs computed from the mirrored invoices and
> subscriptions, not hard-coded. Follow 03_UI_Spec §10–11 (desktop frame, keyboard, zero
> training) and the visual rules of 09_Mock_Polish_Prompt. Deliver with `ADMIN_DEMO_SCRIPT.md`.
