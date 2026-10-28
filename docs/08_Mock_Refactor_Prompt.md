# 08 — Mock refactor brief (round 2)

Review of the round-1 mock (2026-10-28), measured against 07_Mock_Brief.md:

| Area | Finding |
|---|---|
| Coverage | Only Tier 1 built: 18 pages. Missing entirely: Suppliers, Bills, Payments, Payment run, FX rates and revaluation, Fixed assets, Budgets, Tax, Settings (posting accounts, numbering, workflows, users), Onboarding, Audit log viewer, Balance Sheet, AR/AP aging, Customer card/statement, Org billing. |
| Ledger truth | `store.ts` hard-codes account ids (`acc-1200`) and mutates an `account.balance` field on post. Reports read that field instead of summing journal lines. Posting accounts must come from company settings and every report must derive from lines. |
| Keyboard | Six key handlers in the whole app. No global shortcut layer, no chords, no grid navigation beyond Enter, no shortcut hints in UI, no focus management after actions. |
| Desktop feel | Behaves like a scrolling website: page scroll, no fixed panes, no document tabs, no status bar, no context menus, no resizable splits, dialogs are web modals. |
| Offline | Nothing: no local persistence, no outbox, no sync indicator, no PWA. |
| Signing | Approve/post/reopen are one click. No signing PIN, no "signed by" evidence, no lockout. |
| Reports | No parameter panel beyond period, no comparison columns, no dimension pivot, drill-down not wired end to end, no export, no saved layouts, computed on render without memoisation. |
| Multi-currency | FX only appears in the receipt form. No rate table, no rate per line in journals, no revaluation run, no FX gain/loss in reports. |
| Structure | One 800-line store; no `components/ui` layer; no tests; API shape is a single `api` object. |

Everything below is the prompt for round 2. Attach 02_AppFlow.md, 03_UI_Spec.md (now with §10 Desktop and keyboard rules), 05_Schema.md, 07_Mock_Brief.md and this file.

---

## Prompt (paste)

You built round 1 of the Ledgerly mock. Layout and visual language are approved and must stay.
Everything else below is a refactor or an addition. Work in the order given; after each block,
run the demo script and the checklist, then continue. Do not ask for permission between blocks;
ask only when a document is ambiguous.

### Block A — Make the ledger the truth (refactor `src/mock`)
1. Split `store.ts` into slices: `session`, `ledger` (journals, lines, sequences, periods),
   `documents` (invoices, bills, settlements), `banking`, `fx`, `assets`, `budgets`, `settings`,
   `audit`, `offline`. One file each under `src/mock/store/`.
2. Delete `account.balance`. Add selectors `balanceOf(accountId, asOf, dims?)`,
   `trialBalance(periodFrom, periodTo, dims?)`, `movements(accountId, range)` that reduce over
   posted `journal_lines` only, memoised with a lines-version counter.
3. Add `company_settings.posting_accounts` (ar_control, ap_control, tax_output, tax_input,
   fx_realised, fx_unrealised, rounding, suspense, retained_earnings, bank_clearing, wht_payable)
   and a `PostingRules` module. `postInvoice`, `postBill`, `postSettlement`, `postRevaluation`,
   `postDepreciation` all build lines through one `postJournal(draftJournal)` function that:
   validates period open, dimension rules, per-currency balance; allocates a gapless number
   from `sequences`; stamps posted_at/posted_by; appends an audit event with prev_hash/hash.
   No other code path may write journal lines.
4. Every journal line carries `currency`, `fx_rate`, `amount_fc` and base `debit/credit`.
5. Replace the single `api` object with `src/mock/api/<module>.ts` async functions with 150–400 ms
   latency and 2 % injected failures (toast + retry) so the UI's error states are real.
6. Add Vitest tests: journal balancing, gapless numbering under 50 parallel posts, closed period
   rejection, maker ≠ checker, trial balance equals sum of lines, hash chain verifies.

### Block B — Desktop application feel (per 03_UI_Spec §10)
1. App frame is `100vh`, no page scroll. Regions: title/status bar (top, 40 px: company, period,
   online/offline, pending outbox count, user, clock), sidebar (248/64 px), **document tab strip**
   (open records as tabs like an IDE: middle-click close, Ctrl+W, Ctrl+Tab, pinned Dashboard),
   content pane with internal scroll, **bottom status bar** (24 px: selection count, sum of selected
   amounts, balance difference in forms, shortcut hints for the focused element).
2. Master-detail with resizable split panes (drag handle, persisted width) on lists: select a row,
   detail renders on the right without navigation; Enter or double-click opens it as a tab.
3. Right-click context menus on rows, cells, tabs (Open, Open in new tab, Duplicate, Reverse,
   Copy number, Copy amount, Export selection).
4. Grids behave like a spreadsheet: cell focus model, Arrow keys, Tab/Shift+Tab, Enter edits /
   confirms, F2 edit, Esc cancel, Ctrl+D fill down, Ctrl+C/V on cells, Shift+click range select,
   column resize/reorder, frozen first column, virtualised rows (TanStack Virtual) for 10k rows.
5. Dialogs are compact, keyboard-complete (Enter confirms the primary, Esc cancels), never
   taller than the viewport, and restore focus to the triggering control.
6. Density toggle (compact 32 px / default 36 px / comfortable 40 px) persisted per user.
7. Remove marketing-style whitespace, hero cards and large icons from working screens.

### Block C — Keyboard first
1. Add a global shortcut registry (`src/lib/shortcuts.ts`) with scopes (global, page, grid,
   dialog) and a `?` overlay listing active shortcuts. Every toolbar button shows its key in a
   tooltip and, in compact density, inline.
2. Bindings (desktop convention, Ctrl = Cmd on macOS):
   Ctrl+K palette · `g d/i/b/j/r/p/a` go to dashboard/invoices/bills/journals/reports/periods/approvals ·
   `n` new · Ctrl+S save draft · Ctrl+Enter submit · Alt+A approve · Alt+R return · Alt+P post ·
   Alt+V reverse · Ctrl+F filter bar · `/` search in list · `j/k` move selection · `x` toggle select ·
   `o`/Enter open · Esc close tab/dialog · F9 recalc totals · Ctrl+Shift+D toggle dark · Ctrl+, settings.
3. Focus management: after save, focus returns to the list row; after a line is added the first
   cell is focused; after approve the next pending item is selected.
4. Command palette gains actions ("Approve 3 selected", "Close period Oct 2026", "Run FX
   revaluation") and recent documents, with fuzzy matching.

### Block D — Signing PIN for checkers (per ADR-0004)
1. Each user has a 6-digit signing PIN separate from the login password (mock: Fatima 246810,
   Kenneth 135790, Rahim 112233). Settings → Security lets a user set/change it after re-auth.
2. Any approve, post, period close/reopen approval, payment run approval or audit-log export
   opens a **Sign dialog**: summary (document, amount, period, maker), PIN entry (6 boxes,
   masked, paste allowed, Enter submits), reason field where required. Wrong PIN 3× locks signing
   for 15 minutes (mock: 30 s) and writes an audit event. A valid signature is cached for 10 minutes
   (mock: 2 min) so bulk approvals ask once; the status bar shows "Signed as Fatima · 1:42".
3. The approval record stores `signed_by, signed_at, signature_hash` (sha256 of
   document_id + status + signer + timestamp + prev audit hash). Document view shows a
   "Signed" badge with signer and time; audit log viewer shows the hash and a Verify button.
4. Maker can never sign their own document; two-approver reopen requires two different PINs.

### Block E — Offline-first (per ADR-0005, scoped)
1. Add `vite-plugin-pwa` (service worker, app shell cached, installable). Persist all mock
   data and the store in IndexedDB via Dexie; the app loads from IndexedDB first, then "syncs".
2. Writes go to an **outbox** (`pending_ops`) with an op type and client-generated UUID. While
   offline: creating/editing drafts, allocating receipts, matching bank lines and preparing
   approvals all work and queue. Posting, approving, closing/reopening periods are **server
   actions**: offline they are queued as "will post when online" and the document shows status
   `queued` (amber striped) and keeps a provisional `DRAFT-` number; the gapless number is only
   assigned when the op is applied online. Explain this rule in a tooltip.
3. Status bar shows Online / Offline / Syncing n ops; a toggle in the user menu simulates
   offline. On reconnect, ops replay in order; a 1-in-10 simulated conflict ("draft changed by
   Fatima") opens the 409 dialog from 02_AppFlow §13 (Reload / Overwrite / Keep both).
4. Read caches for reports show "as of 14:32, offline" with a refresh affordance.

### Block F — Missing modules (Tier 2 and 3 of 07_Mock_Brief, all fully functional)
1. **Purchases**: Suppliers list/card, Bills (reuse invoice components with AP posting), Debit
   notes, Payments, **Payment run wizard** (filter due bills → select/edit with WHT computed per
   supplier code → review → sign → posts all payments, issues WHT certificates, exports bank CSV).
2. **FX module**: rate table by pair/date with manual entry and "sync provider" (mock), rate
   picker on every document and journal line, **revaluation run** (select period, preview per
   open AR/AP/bank item: book rate vs period rate, unrealised gain/loss, resulting journal,
   automatic reversal in next period), realised FX on settlements already present must use the
   same rules, FX gain/loss visible in P&L.
3. **Fixed assets**: register, acquisition from a bill line or journal, categories with default
   accounts and methods, straight-line and declining balance schedules, monthly depreciation run
   (preview → sign → journal), disposal with gain/loss, asset schedule report.
4. **Budgets**: versions per fiscal year, grid editor account × period × dimension (spreadsheet
   behaviour from Block B), CSV import, Budget vs Actual report with variance.
5. **Tax**: tax codes/rates with effective dates, tax groups, tax period report (output vs input,
   box mapping editable), WHT certificates list.
6. **Settings**: company profile, posting accounts, numbering sequences (prefix, padding, reset
   per year, preview), approval workflows (type, threshold, steps, roles), document templates,
   users and roles with permission matrix, security (2FA enforce, signing PIN policy, session
   timeout), API tokens, webhooks.
7. **Onboarding wizard** (6 steps), **Audit log viewer** (filter, diff before/after, hash chain
   Verify), **Customer/Supplier card** with statement tab and PDF preview, **Org billing** page.

### Block G — Reporting engine
1. One `ReportShell` for all reports: parameter panel (period or as-of, comparison: previous
   period / previous year / budget, dimension filters and **pivot by dimension**, presentation
   currency, zero rows, level of detail), result grid (sticky headers, expandable account groups,
   subtotals, tabular numbers, negatives in parentheses), toolbar (Run F5, Export XLSX/CSV/PDF,
   Save layout, Schedule, Share link), and a "computed in 120 ms from 1,284 lines" footer.
2. Reports: Trial Balance (movement and closing, by dimension), General Ledger detail, Balance
   Sheet, Profit & Loss (period, YTD, comparative, by dimension), Cash Flow (indirect), AR and AP
   aging (buckets configurable), Customer/Supplier statements, Bank reconciliation report, Tax
   return, Budget vs Actual, Fixed asset schedule, Audit trail, Period close pack.
3. Drill-down chain works everywhere: cell → GL lines drawer (filtered, sortable) → document tab.
4. Reports over 2k lines render through a web worker with a progress bar, results cached by
   parameter hash and invalidated when a journal posts in range.
5. Saved layouts and schedules persist in IndexedDB.

### Block H — Finish
1. Update `DEMO_SCRIPT.md` to 14 steps adding: offline draft then sync; sign with PIN and a
   failed PIN; payment run with WHT; FX revaluation and its reversal; depreciation run;
   Balance Sheet pivot by Branch; budget vs actual.
2. `npm run build` passes with TypeScript strict and no `any`; Vitest passes; Lighthouse PWA
   installable; no hex literals in components (`grep -rE "#[0-9a-fA-F]{6}" src/components src/pages`
   must return nothing).
3. Deliver a `MIGRATION_NOTES.md` listing which components and selectors are backend-ready and
   where a Laravel endpoint replaces a `mock/api` function.

### Block I — Zero-training usability (applies to every screen in every block)
Target: a bookkeeper who has never seen Ledgerly completes the demo script without help.
Power users keep every shortcut from Block C; beginners must never need one.

1. **Plain language everywhere.** Labels say what the user does, not the accounting term alone:
   "Record money received" (Receipt), "Record a bill from a supplier" (Bill), "Fix a posted
   entry (creates a reversal)". The accounting term appears in smaller grey text beside it.
   No codes without names, no abbreviations without a tooltip, no "Error 422".
2. **One obvious next step.** Each screen has exactly one primary button, worded as the next
   action ("Send for approval", "Approve and post", "Finish reconciliation"). Disabled primary
   buttons always say why on hover and in the status bar ("Add a Branch on line 2 to continue").
3. **Guided first use.** On the first visit to each module a dismissible 3-step coach panel on
   the right explains the screen; a "Show me" button animates the cursor through the steps.
   A "Getting started" checklist on the dashboard tracks progress and never nags after completion.
4. **Smart defaults and auto-fill.** New documents prefill date (today), currency and payment
   terms (from contact), dimensions (from contact or last document), tax code (from item or
   account), FX rate (from table, shown with source and date). Account picker offers "Recently
   used" and "Suggested for this customer" first. Bank matching proposes matches with confidence
   and a one-line reason ("same amount, reference INV-0042").
5. **Preview before commit.** Every posting, approval, period or revaluation action shows a
   plain-language consequence panel first: "This will post 3 lines to October 2026 and increase
   Hormuud Telecom's balance by $1,050.00. Number INV-2026-0043 will be assigned." Journal lines
   are visible behind a "Show accounting" toggle, collapsed by default for non-accountants.
6. **Forgiving.** Drafts autosave (indicator "Saved just now"). Undo toast on reversible actions
   (delete draft, unmatch, return). Posted mistakes offer "Fix this" which creates the reversal
   and a corrected copy in one flow. Nothing is lost on navigation; tabs keep state.
7. **Inline help, not manuals.** Every field label has a `?` that opens a one-sentence help and
   an example. Empty states explain the screen and offer the first action and an import.
   Errors say what happened and how to fix it, next to the field, in one sentence.
8. **Search over navigation.** Ctrl+K and the top search accept natural phrases: "unpaid
   invoices hormuud", "close october", "receipt 1050" and show results grouped with the action.
9. **Status that explains itself.** Hovering any status pill tells what it means and what can
   happen next ("Pending approval: waiting for Fatima Hassan since 2 h. She can approve or
   return it to you."). The approvals inbox shows the maker's note and a diff for resubmissions.
10. **Progressive disclosure.** Advanced fields (FX rate override, dimensions beyond required,
    rounding account, memo per line) sit behind "More options" and remember the user's choice.
    Settings pages open with the 5 settings most tenants change, the rest under "All settings".
11. **Consistency.** Same layout for all documents (header, lines, totals, attachments, activity);
    same action bar order; same wording for the same action everywhere.
12. **Measured.** Add a hidden `?usability` panel that records time-to-complete and error count
    for each demo step so the team can compare rounds.

### Non-negotiables
- The approved layout and tokens stay. No new UI library. No Next.js.
- Every number on every screen is derived from journal lines; nothing stores a balance.
- Posted records are immutable in the store; corrections are reversals.
- Every action is reachable by keyboard and shows its shortcut.
- A first-time user must complete the demo script without training (Block I); when a feature conflicts with that, simplify the surface, never the control.
