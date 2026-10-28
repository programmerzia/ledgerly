# 02 — Application Flow

Screen-by-screen state machine, routes, actions, empty and error states.
Route style: Inertia pages served by Laravel; URL = `/{company_slug}/...` after company is
chosen. Organisation-level pages live under `/org/...`. API mirrors under `/api/v1/...`.

## 1. Global navigation model

```
Public ──► Auth ──► Org picker (if >1) ──► Company picker (if >1) ──► App shell
                                                                    ├── Dashboard
                                                                    ├── Sales (AR)
                                                                    ├── Purchases (AP)
                                                                    ├── Banking
                                                                    ├── Accounting (Journals, CoA, Periods, FX, Assets, Budgets)
                                                                    ├── Reports
                                                                    ├── Approvals (inbox)
                                                                    └── Settings (Company) / Org settings / Billing
```

App shell: left sidebar (collapsible), top bar with **company switcher**, global search (⌘K:
documents by number, contacts, accounts, menu items), notifications bell (approvals, failed
jobs), user menu. Keyboard: `g j` journals, `g i` invoices, `n` new within a list.

## 2. Public & auth

| Route | Screen | Actions | States |
|---|---|---|---|
| `/` | Marketing landing (static) | Sign up, Log in | — |
| `/register` | Sign up | email, name, password, org name → creates Org + first Company wizard | validation errors inline; email taken → link to login |
| `/login` | Log in | email+password → 2FA challenge if enabled | locked after 5 fails/15 min (shows countdown) |
| `/two-factor-challenge` | TOTP / recovery code | verify | invalid code; recovery code used notice |
| `/forgot-password`, `/reset-password/{token}` | standard | | expired token |
| `/invitations/{token}` | Accept invite | set password if new user | expired / already accepted |

Auth state machine: `anonymous → authenticated(no_2fa) → authenticated(2fa_pending) → authenticated(full)`.
Only `full` reaches app routes. Session idle timeout 30 min (tenant-configurable 15–480).

## 3. Onboarding wizard (first company) `/onboarding/*`

Steps (progress bar, each step saves):
1. Company basics: legal name, country, base currency, fiscal year start month, tax ID.
2. Chart of accounts: pick template → preview → create. (Skip = empty chart.)
3. Opening balances: date + TB upload (CSV) or "start fresh". Validated balanced before post.
4. Tax codes: suggested set for country; toggle on/off.
5. Invite team: emails + roles.
6. Done → Dashboard with checklist card ("Add bank account", "Create first invoice", ...).

Exit any time; wizard resumes at last incomplete step until step 2 is done.

## 4. Dashboard `/{co}/dashboard`

Widgets (per-user layout saved): Cash position by bank account, AR/AP due this week, P&L
month-to-date vs budget, Approvals waiting for me, Unreconciled bank lines, Period status,
Recent activity. Empty state: onboarding checklist. Each widget links to its filtered list.

## 5. Document lifecycle (shared state machine)

All postable documents (journal, invoice, credit note, bill, debit note, receipt, payment,
payment batch, FX revaluation, depreciation run) follow:

```
            ┌──────────┐  submit   ┌───────────────┐  approve  ┌────────┐
 create ──► │  draft   │ ────────► │ pending_approval │ ──────► │ posted │ ──► reverse ──► reversed
            └──────────┘           └───────────────┘           └────────┘        (new mirror doc posted)
                 ▲  │ delete            │ return (comment)
                 │  ▼                   ▼
             (edit)  void          back to draft
```

- `draft`: editable, deletable (soft), number = `DRAFT-xxxx`.
- `submit`: validation (balanced, period open, dimensions satisfied, tax ok, approver exists).
  If workflow says no approval needed → straight to `posted`.
- `pending_approval`: read-only for maker; approver may `approve` or `return`. Maker cannot
  approve own document (hard rule). Shown in approver's inbox.
- `posted`: immutable; final number assigned (gapless per company+year+type). Actions:
  Reverse, Duplicate, Print/PDF, Attach (attachments allowed after post, flagged), Email.
- `reversed`: posted doc with a link to its reversal; both remain.
- `void` only from draft/pending.

UI: status pill colours — draft grey, pending amber, posted green, reversed violet, void red.
All transitions confirm with a dialog that states period, amount, and what happens next.

## 6. Sales (AR)

| Route | Screen | Key actions | Empty / error |
|---|---|---|---|
| `/{co}/customers` | Customer list (search, status, balance, overdue) | New, import CSV, export | "No customers yet" + New + Import |
| `/{co}/customers/{id}` | Customer card: tabs Overview, Invoices, Receipts, Statement, Activity | Edit, New invoice, Record receipt, Send statement | — |
| `/{co}/invoices` | Invoice list (status tabs: All/Draft/Pending/Posted/Overdue/Paid) | New, bulk send, bulk approve (if approver) | filters persisted per user |
| `/{co}/invoices/new`, `/{id}/edit` | Invoice form: header (customer, dates, currency, rate, terms), lines grid (item/account, qty, price, discount, tax code, dimensions), totals panel, attachments, notes | Save draft, Submit, Submit & new | inline line errors; "period closed" banner blocks submit; FX rate missing → inline fetch/enter |
| `/{co}/invoices/{id}` | Invoice view: document, journal preview tab, payments tab, activity | Approve/Return (if pending), Record receipt, Credit note, Reverse, PDF, Email | |
| `/{co}/credit-notes/...` | same shape as invoice; must reference invoice or on-account | apply to invoice(s) | |
| `/{co}/receipts/...` | Receipt: customer, bank account, amount, currency, allocation table (open invoices, auto-allocate oldest first), on-account remainder | Save/Submit | over-allocation error; FX diff shown as realised gain/loss line preview |

## 7. Purchases (AP)

Mirror of Sales: `/suppliers`, `/bills`, `/debit-notes`, `/payments`, plus:

| Route | Screen | Actions |
|---|---|---|
| `/{co}/payment-runs` | Payment run list | New run |
| `/{co}/payment-runs/new` | Step 1 filter due bills (date, supplier, currency, bank) → Step 2 select & edit amounts, WHT computed → Step 3 review totals → Submit | Approve posts all payments, generates WHT certificates, exports bank CSV |

## 8. Banking

| Route | Screen | Actions / states |
|---|---|---|
| `/{co}/banking` | Bank & cash accounts cards: book balance, statement balance, unreconciled count | Add account, Import statement, Transfer |
| `/{co}/banking/{id}/reconcile` | Two-pane: left statement lines (unmatched), right book transactions (unmatched); suggested matches highlighted; "Create" from a statement line (receipt / payment / transfer / journal); rules editor | Match, Unmatch, Finish → reconciliation report (opening, +receipts, −payments, closing, difference must be 0) |
| `/{co}/banking/import` | Upload CSV/OFX/CAMT → column mapping (saved per account) → preview → import | duplicate detection (hash of date+amount+ref) |

## 9. Accounting

| Route | Screen | Notes |
|---|---|---|
| `/{co}/journals` | Journal list (type, status, period, source doc) | New manual journal, Recurring templates tab |
| `/{co}/journals/new` | Journal form: date, period auto, reference, memo, lines grid (account, dimensions, debit, credit, currency, rate, description), running totals + difference; attachments | Submit disabled until difference = 0 |
| `/{co}/accounts` | Chart of accounts tree/table (type grouping, balances as-of) | New, edit, deactivate (blocked if balance ≠ 0), merge (R2) |
| `/{co}/dimensions` | Dimension definitions and values | |
| `/{co}/periods` | Fiscal years → periods with state, close checklist (unreconciled banks, pending approvals, unposted drafts, FX revaluation done, depreciation done) | Soft close, Close, Reopen (two approvers), Lock year, Year-end close (P&L → retained earnings journal) |
| `/{co}/fx-rates` | Rate table by currency/date; provider sync; revaluation run | Run revaluation (preview journal) |
| `/{co}/assets` | Asset register, depreciation runs, disposals | |
| `/{co}/budgets` | Budget versions, grid editor (account × period), import | |
| `/{co}/tax` | Tax codes, tax periods, return report | |

## 10. Approvals inbox `/{co}/approvals`

Tabs: Waiting for me / Submitted by me / All. Row: doc type, number, maker, amount, age.
Row actions: Open, Approve, Return (comment required). Bulk approve with confirm listing
totals. Email/notification on submit, approve, return; daily digest.

## 11. Reports `/{co}/reports/*`

Report shell: parameters panel (period/as-of, dimension filters, comparison, currency
presentation, zero-rows toggle), result table, drill-down (cell → GL detail → document),
Export PDF/XLSX/CSV, Save layout, Schedule. Long reports render via queued job with progress
bar (> 2 s estimated) and are cached for the parameter hash until a new posting in range.

## 12. Settings

- `/{co}/settings`: company profile, numbering sequences (prefix, reset per year), document
  templates (PDF layout, logo), approval workflows (per type: threshold, approver roles,
  steps), posting rules (default accounts: AR/AP control, tax, FX gain/loss, rounding,
  suspense, retained earnings), email templates, integrations (webhooks, API tokens).
- `/org/settings`: org profile, companies, users & roles, security policy (2FA enforce,
  session timeout, IP allowlist), audit log viewer, data export, feature flags.
- `/org/billing`: plan, usage, invoices, payment method (Stripe portal).

## 13. Cross-cutting error & empty states

- **Validation**: inline per field + summary banner; server is the source of truth (422).
- **Period closed**: red banner on form, Submit disabled, link to Periods.
- **Permission denied (403)**: page with "Ask your admin" and the permission name.
- **Concurrent edit (409)**: "This draft was changed by {user} at {time}. Reload / Overwrite".
- **Approval conflict**: approving an already-approved doc → info toast, refresh row.
- **Job failure**: notification with retry; detail in Org → Audit log → Jobs.
- **Offline / network**: toast; forms keep state; retry.
- **Empty lists**: illustration-free, one sentence, primary action, optional import.
- **Maintenance**: 503 page with status link.

## 14. Notifications

In-app (bell + list), email (Mailgun/SES), optional Slack webhook. Events: approval
requested, approved, returned, period closed/reopened, bank import done, scheduled report
ready, job failed, invitation, billing events.

## 15. Signing (checker PIN)

Approve, post, payment-run approval, period close, reopen approval and audit export require a
**signing PIN** (6 digits, separate from the password). Flow: action → Sign dialog (summary,
PIN, reason if required) → verified → action executes → approval record gets `signed_by`,
`signed_at`, `signature_hash`. Three wrong PINs lock signing for 15 minutes and write an audit
event. A valid signature is cached 10 minutes for bulk approvals. Maker can never sign own
document. Set/change PIN under Settings → Security after re-authentication.

## 16. Offline behaviour

The app is an installable PWA with local persistence (IndexedDB) and an outbox. Offline:
drafts, allocations, bank matching and report viewing (cached, labelled as of time) work.
**Server actions** (post, approve, close/reopen, payment run) are queued with status `queued`
and a provisional `DRAFT-` number; the gapless number is assigned when the op is applied
online. Conflicts on replay use the 409 dialog (§13). Status bar shows Online / Offline /
Syncing n.
