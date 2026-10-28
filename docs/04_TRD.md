# 04 — Technical Requirements Document (TRD)

## 1. Architecture decision: integrated monolith (Inertia), not a separate SPA

**Decision**: Laravel 12 + Inertia.js v2 + React 19 (TypeScript) in one repository and one
deployable. REST API (`/api/v1`) is a first-class second front door sharing the same
application services.

Why not a separate Next.js/Vue frontend:
- Accounting UI is form- and table-heavy, not SEO or edge-rendered; Inertia gives SPA feel
  with server-side auth, validation, authorization and no duplicated DTO/type layer.
- One deploy, one auth/session model, one permission layer, half the CI surface.
- API remains clean because all business logic lives in **Actions/Services**, never in
  controllers; Inertia controllers and API controllers both call the same Actions.
- Revisit only if a mobile app or a third-party-built UI becomes a requirement (then the
  API is already there).

## 2. Locked stack (pin these; upgrade only by ADR)

| Layer | Choice | Version |
|---|---|---|
| Language | PHP | 8.4.x |
| Framework | Laravel | 12.x |
| Auth | Laravel Fortify (+ 2FA TOTP), Sanctum (API tokens), Passport **not** used (client-credentials via Sanctum token abilities) | latest 12-compatible |
| Frontend bridge | Inertia.js (laravel adapter + react adapter) | 2.x |
| UI | React, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix UI), lucide-react, TanStack Table, TanStack Query (API-driven widgets only), react-hook-form + zod, dnd-kit, Recharts | React 19, TS 5.x, Vite 6, Tailwind 4 |
| Database | PostgreSQL (RLS, `numeric`, partial indexes, `pg_trgm`) | 16.x |
| Cache / queue / sessions | Redis | 7.x |
| Queue runner | Laravel Horizon | 5.x |
| Scheduler | Laravel scheduler (cron) | — |
| Search | PostgreSQL full-text + trigram (no Elasticsearch in R1) | — |
| Files | S3-compatible (AWS S3 / MinIO locally) via Flysystem | — |
| PDF | spatie/browsershot (Chromium) | — |
| Spreadsheet | openspout/openspout (streaming XLSX/CSV) | 4.x |
| Money | brick/money + integer minor units in DB | — |
| Permissions | spatie/laravel-permission (team = company) | 6.x |
| Audit | custom append-only `audit_events` + hash chain (not spatie/activitylog) | — |
| Multi-tenancy | single database, `tenant_id` on every tenant table + PostgreSQL RLS; own lightweight `TenantContext` (no stancl/tenancy) | — |
| Billing | laravel/cashier (Stripe) | 15.x |
| Feature flags | laravel/pennant | 1.x |
| Mail | Symfony mailer → SES / Mailgun | — |
| Testing | Pest 3, Laravel Dusk (few smoke flows), PHPStan (larastan) level 8, Laravel Pint, ESLint + Prettier, Vitest + Testing Library | — |
| Observability | OpenTelemetry PHP SDK → OTLP; Sentry; structured JSON logs; Laravel Pulse | — |
| Dev env | Docker Compose (php-fpm 8.4, nginx, postgres 16, redis 7, minio, mailpit) | — |
| CI/CD | GitHub Actions: lint → phpstan → pest (postgres service) → vitest → build → docker image → deploy | — |
| Hosting target | Containers (Kubernetes or Fly.io/Render), managed Postgres, managed Redis | — |

## 3. Folder structure (Laravel default + domain modules)

```
app/
  Actions/            # one class per use-case: PostJournal, SubmitInvoice, ApproveDocument, ClosePeriod ...
  Domain/             # pure domain: Money, Period rules, Posting rules, Balancing, Numbering
    Ledger/           # Journal aggregate, Posting engine, Sequence allocator
    Receivables/ Payables/ Banking/ Tax/ Fx/ Assets/ Budgets/ Reporting/
  Models/             # Eloquent models (thin; scopes; relations) — namespaced per module
  Http/
    Controllers/Web/  # Inertia controllers (return Inertia::render)
    Controllers/Api/V1/
    Requests/         # FormRequests: validation only
    Resources/        # API resources / Inertia props DTOs
    Middleware/       # SetTenantContext, SetCompanyContext, EnsurePeriodOpen (for post routes), Idempotency
  Policies/           # authorization per model
  Services/           # infra-facing: Pdf, Storage, ExchangeRateProvider, BankStatementParsers, Stripe
  Jobs/               # queued: GenerateReport, RunRevaluation, ImportStatement, SealAuditLog
  Events/ Listeners/  # domain events: DocumentPosted, PeriodClosed ...
  Support/            # TenantContext, Clock, helpers
  Console/Commands/
database/
  migrations/         # schema, RLS policies as raw SQL migrations
  seeders/            # chart templates, tax code sets, demo tenant
  sql/                # views, functions (balance views, sequence functions)
resources/
  js/
    app.tsx, ssr.tsx
    pages/<Module>/<Screen>.tsx
    components/ui/      # shadcn
    components/domain/  # MoneyInput, AccountPicker, LineGrid, StatusPill, ApprovalBar, DrillDown
    layouts/
    lib/                # formatters, api client, hooks
    types/              # generated from PHP DTOs (spatie/typescript-transformer) — generated, do not edit
  views/pdf/            # Blade PDF templates
routes/
  web.php api_v1.php console.php
tests/
  Feature/<Module>/  Unit/Domain/  Invariants/  Browser/
docs/                 # the 6 context docs + ADRs
```

Rules:
- Controllers ≤ 30 lines per method; no business logic. They validate (FormRequest),
  authorize (Policy), call an Action, return.
- Actions are transactional (`DB::transaction`) and the only place that writes posted data.
- Models never contain posting logic. No model events that write ledger rows.
- All money is `int` minor units in PHP + `bigint` in DB; `brick/money` for arithmetic;
  `numeric(20,8)` only for FX rates and quantities.
- Dates: `date` columns for document/posting dates; `timestamptz` for events; company time zone
  applied only at presentation.

## 4. Multi-tenancy & security constraints

- Every tenant table has `tenant_id uuid not null`; RLS policy
  `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. The app DB role is **not**
  table owner and has no `BYPASSRLS`. Middleware sets `SET LOCAL app.tenant_id` per request
  inside a transaction wrapper for writes, and per connection for reads.
- Company scoping (`company_id`) is application-level (global scope) on top of RLS.
- Passwords: bcrypt cost 12 (argon2id allowed). 2FA TOTP + recovery codes; enforceable per tenant.
- Sessions: Redis, `SameSite=Lax`, secure, HttpOnly; idle timeout configurable.
- API: Sanctum tokens with abilities (`invoices:write` etc.), rate limit 600/min per token;
  all mutating endpoints require `Idempotency-Key` header (stored 24 h per tenant).
- Webhooks: HMAC-SHA256 signature header, retries with backoff, per-endpoint secret rotation.
- Authorization: Policies + spatie permissions scoped to company; **maker ≠ checker** enforced
  in `ApproveDocument` action, not only UI.
- Immutability: DB triggers raise on `UPDATE`/`DELETE` of `journals`, `journal_lines`,
  `audit_events` where status = posted (defence in depth beyond application rules).
- Audit: every state change writes `audit_events` (actor, tenant, company, subject, action,
  before/after JSON, ip, user agent, prev_hash, hash). Nightly `SealAuditLog` stores the tip
  hash in `audit_seals` and optionally posts it to an external timestamping service.
- Attachments: private bucket, signed URLs (5 min), ClamAV scan job, content-type sniffing,
  max 25 MB.
- Secrets only via environment; `.env` never committed; Laravel encryption for stored
  third-party tokens.
- OWASP ASVS L2 as the baseline; CSP with nonces; CSRF via Inertia/Sanctum defaults.
- PII export and tenant deletion (GDPR) via queued job with 30-day grace.
- Backups: daily full + WAL (PITR 7 days), restore drill monthly.

## 5. Third-party APIs

| Purpose | Provider | Notes |
|---|---|---|
| Subscription billing | Stripe (Cashier) | webhooks for invoice.paid / payment_failed |
| Exchange rates | Open Exchange Rates or ECB (free) via `ExchangeRateProvider` interface | daily job; manual override |
| Email | AWS SES / Mailgun | transactional + scheduled reports |
| Storage | S3 / MinIO | |
| PDF | local Chromium (Browsershot) | no external PDF API |
| Error tracking | Sentry | |
| Timestamping (optional) | RFC 3161 TSA | audit seal anchoring |

## 6. Performance & scale targets

- 10k tenants, 1M journal lines per large tenant; TB query via materialised
  `account_period_balances` maintained by posting (insert-only deltas + nightly rebuild check).
- Reports > 2 s estimated run in queue; results cached by parameter hash, invalidated by
  `DocumentPosted` in range.
- P95 web TTFB < 300 ms; posting action < 250 ms for 50-line journals.
- Read replicas for reporting connection (`DB_REPORTING_*`).

## 7. Coding standards

- PSR-12 via Pint; PHPStan level 8 with larastan; strict types in all PHP files.
- TypeScript strict; no `any`; generated types for all Inertia props.
- Conventional Commits; PR requires green CI and one review.
- Tests: every Action has Feature tests (happy, forbidden, period closed, unbalanced);
  `tests/Invariants` run ledger invariants against seeded data (sum debits = credits per
  journal, per period, per company; sequence gapless; balances view = sum of lines).

## 8. Environments

`local` (Docker Compose), `ci`, `staging` (prod-like, anonymised seed), `production`.
Migrations run on deploy; destructive migrations forbidden (expand/contract only).
