# 07 — Mock / Demo Brief (for Gemini or any UI generator)

Purpose: produce a high-fidelity clickable mock of Ledgerly that (a) sells the product in a
demo and (b) can be lifted screen by screen into the real Inertia + React app later.
Paste the "Prompt" section into Gemini together with `03_UI_Spec.md`, `02_AppFlow.md` and the
sample data below. Attach `01_PRD.md` only if it asks for product context.

## Output rules (so the mock is reusable, not throwaway)

1. **Stack of the mock**: React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui +
   lucide-react + TanStack Table + Recharts. No Next.js, no CSS-in-JS, no other UI kit.
   Reason: this is exactly the real stack minus Laravel, so components move over unchanged.
2. **Folder layout** mirrors the real app:
   ```
   src/
     pages/<Module>/<Screen>.tsx      // one file per screen in 02_AppFlow
     components/ui/                   // shadcn generated
     components/domain/               // MoneyInput, AccountPicker, LineGrid, StatusPill, ApprovalBar, DataTable, EmptyState, DrillDownDrawer, DimensionChips, DocumentHeader
     layouts/AppShell.tsx
     lib/format.ts                    // money/date formatters (Intl)
     mock/data.ts                     // ALL sample data here, typed
     mock/api.ts                      // fake async functions returning data (so pages call an API shape, never import data directly)
     types/index.ts                   // TS types matching 05_Schema names (journal, journal_line, invoice, contact, account, fiscal_period, ...)
   ```
3. **Tokens, not hard-coded colours**: implement `03_UI_Spec.md` §2–4 as Tailwind `@theme`
   CSS variables; dark mode via `data-theme`. Every status uses `StatusPill`.
4. **State machine is real in the mock**: Draft → Submit → Pending → Approve/Return → Posted →
   Reverse must actually change state in local store (Zustand or React context) and show in
   lists, approvals inbox, dashboard counts and the trial balance. The demo story depends on it.
5. **Client-side routing** with react-router; URLs follow `02_AppFlow.md` (`/acme/invoices/INV-2026-0042`).
6. **Money**: integers in minor units in data; format with `Intl.NumberFormat`; right-aligned,
   tabular figures; negatives in parentheses on reports.
7. **No lorem ipsum**. Use the sample company and data below.
8. Keyboard: ⌘K palette, `n` for new in lists, Tab/Enter navigation in the line grid.
9. Accessibility: focus rings, aria labels, contrast per spec.
10. Deliver as a repo with `npm i && npm run dev` working, plus a `DEMO_SCRIPT.md`.

## Screens to build, in priority order

**Tier 1 (demo story, must be complete and polished)**
1. Login + 2FA challenge
2. App shell: sidebar, top bar, company switcher (Acme Trading Ltd ↔ Acme Logistics), ⌘K, bell, dark mode toggle
3. Dashboard (cash position, AR/AP due, P&L vs budget chart, approvals waiting, unreconciled bank lines, period status, activity)
4. Invoices list (status tabs, filters, saved view, bulk bar)
5. Invoice form (header, line grid with tax and dimensions, totals, attachments, autosave indicator) and Invoice view (document, journal preview tab, payments tab, activity, approval bar)
6. Approvals inbox (Waiting for me / Submitted by me) with Approve and Return (comment) dialogs
7. Manual journal form with live balancing difference pill, and journal view with Reverse action
8. Receipt form with allocation table (auto-allocate oldest first, on-account remainder, FX gain/loss preview)
9. Bank reconciliation workspace (two panes, suggested matches, create-from-line, finish with proof)
10. Periods screen (fiscal year, period states, close checklist, Reopen flow needing two approvers)
11. Reports: Trial Balance and Profit & Loss with parameter panel, drill-down drawer (cell → GL lines → document), export menu
12. Chart of accounts (tree/table with balances, dimension rules)

**Tier 2 (present, lighter polish)**
13. Customers list and customer card with statement tab
14. Suppliers, Bills list and form (reuse invoice components), Payment run wizard (3 steps, WHT shown)
15. AR aging report, Balance Sheet
16. Settings: posting accounts, numbering, approval workflows, users and roles
17. Onboarding wizard (6 steps)
18. Org audit log viewer with hash-chain "Verified" badge

**Tier 3 (static placeholders acceptable)**
19. FX rates and revaluation, Fixed assets, Budgets grid, Tax return, Billing page

## Demo script the mock must support end to end

1. Log in as Rahim (Accountant). Dashboard shows 3 approvals waiting (for Fatima), 7 unreconciled bank lines, period Oct 2026 Open.
2. Create sales invoice for Hormuud Telecom, 2 lines, VAT 5%, dimension Branch = Mogadishu required; try to submit without Branch → inline error; fill → Submit → status Pending.
3. Switch user to Fatima (Finance Manager) via user menu. Approvals inbox shows the invoice; open, see journal preview (Dr AR 1,050 / Cr Sales 1,000 / Cr VAT Output 50); Approve → Posted, number INV-2026-0043 assigned.
4. Record receipt from Hormuud for 2 invoices, partial on the second; FX gain line previewed (invoice in USD, bank in SOS). Post.
5. Bank reconciliation: import already loaded; match the receipt to a statement line; finish; difference 0.
6. Trial Balance for Oct 2026: click Sales → GL lines → open INV-2026-0043.
7. Try to post a journal dated Sep 2026 (closed) → blocked banner. Request reopen → second approver (Kenneth) approves → period Open → post → close again with checklist all green.
8. Reverse a wrong journal; both documents linked, TB back to before.
9. Toggle dark mode; everything holds.

## Sample data (seed for mock/data.ts)

**Organisation**: Acme Group · plan Professional · 2 companies
**Companies**:
- Acme Trading Ltd — slug `acme`, country SO, base currency USD, FY Jan–Dec, TZ Africa/Mogadishu
- Acme Logistics — slug `acme-log`, base currency KES
**Users**: Rahim Ahmed (Accountant), Fatima Hassan (Finance Manager, approver), Kenneth Mwangi (CFO, second approver), Aisha Noor (Auditor, read-only)
**Dimensions**: Branch {Mogadishu, Hargeisa, Nairobi}, Cost Centre {Sales, Operations, Admin}, Project {optional}
**Chart (excerpt, codes)**: 1000 Cash on hand · 1010 Premier Bank USD · 1020 Dahabshiil SOS · 1200 Accounts receivable (AR control) · 1500 Fixed assets · 1510 Accumulated depreciation · 2000 Accounts payable (AP control) · 2100 VAT output · 2110 VAT input · 2120 WHT payable · 3000 Share capital · 3900 Retained earnings · 4000 Sales revenue · 4100 Service revenue · 4900 FX gain · 5000 Cost of sales · 6000 Salaries · 6100 Rent · 6200 Utilities · 6900 FX loss · 9999 Suspense
**Tax codes**: VAT5 (5 %), VAT0, EXEMPT, WHT10 (10 % withholding on services)
**Customers**: Hormuud Telecom, Salaam Bank, Somtel, Dahabshiil Group, Nairobi Freight Co
**Suppliers**: Premier Office Supplies, Kenya Power, Golis Internet, Jubba Airways, East Africa Fuel
**Periods 2026**: Jan–Sep Closed, Oct Open, Nov–Dec Open (future)
**Documents**: ~40 invoices (mix of statuses, 6 overdue), 12 bills, 15 receipts, 8 payments, 25 journals, 1 bank statement with 30 lines (23 matched, 7 unmatched), 3 pending approvals, FX rates USD/SOS 570.00, USD/KES 129.50
**Amounts**: realistic, USD 350 to 48,000 per document; TB must balance.

## Prompt (paste this)

> Act as a senior product designer and frontend engineer. Build a high-fidelity, clickable
> mock of "Ledgerly", a controls-grade multi-tenant accounting SaaS, following the attached
> `03_UI_Spec.md` (design tokens and components), `02_AppFlow.md` (screens, routes, document
> state machine) and `07_Mock_Brief.md` (stack, folder layout, screen priority, demo script,
> sample data). Use React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui exactly as the brief
> says; put all sample data in `src/mock/data.ts` behind `src/mock/api.ts`; implement the real
> draft → pending → posted → reversed state machine in a client store so the demo script runs
> end to end. Build Tier 1 screens fully first, then Tier 2, then Tier 3 placeholders. Dense
> tables, calm chrome, tabular numbers, status pills, dark mode, keyboard shortcuts. No lorem
> ipsum, no other UI libraries, no Next.js. Deliver a runnable repo with `DEMO_SCRIPT.md`.
> Ask me before deviating from the spec.

## What to check when the mock comes back

- Tokens used from `@theme`, not hex literals in components.
- Pages import from `mock/api.ts`, never from `data.ts`.
- Journal preview on invoice is derived from lines (not hard-coded).
- Difference pill in journal form reacts live.
- Closed period actually blocks; reopen needs two different approvers; maker cannot approve own doc.
- Dark mode has no white flashes or unreadable pills.
