# Ledgerly — Controls-Grade Accounting SaaS

High-fidelity, clickable mock and production-aligned frontend implementation of **Ledgerly**, a controls-grade multi-tenant accounting ERP SaaS designed for SMEs and regulated institutions (double-entry general ledger, independent approvals, period locking, multi-currency, bank reconciliation, fixed assets, and cryptographic audit trails).

---

## 1. Architecture & Locked Stack

- **Framework**: React 19 + TypeScript (Strict) + Vite 6 + React Router 6
- **Styling & Tokens**: Tailwind CSS v4 + `@theme` CSS variables (`03_UI_Spec.md`)
- **Theming**: Dark mode via `data-theme="light|dark"` on `<html>` (**zero hex literals** in components or pages)
- **State Machine & Ledger**: Modular Zustand store slices (`session`, `ledger`, `documents`, `banking`, `fx`, `assets`, `budgets`, `settings`, `audit`, `offline`, `tabs`)
- **Local Persistence & Offline**: IndexedDB via **Dexie** with outbox synchronization queue and 409 conflict resolution
- **Grid & Tables**: TanStack Table v8 with controls-grade dense 36px rows and spreadsheet keyboard controls
- **Charts**: Recharts (Month-to-Date vs. Budget)
- **Icons**: Lucide React
- **Verification**: Vitest automated test suite asserting accounting invariants

---

## 2. Key Accounting Controls & Principles

1. **Immutable Double-Entry Ledger (Single Source of Truth)**:
   - Every balance on every screen, card, and report is dynamically reduced from posted `journal_lines`.
   - Accounts, contacts, and banks store zero balances (`account.balance` deleted).
   - Posted records are immutable; corrections are executed via linked mirror reversing journals.
2. **Maker ≠ Checker Segregation**:
   - The creator or submitter of an invoice, bill, or journal is strictly barred from approving their own document.
   - Independent verification is required by a Finance Manager or CFO.
3. **6-Digit Signing PIN for Checkers (ADR-0004)**:
   - Sensitive actions (approve, post, period close/reopen, payment runs) open the `SignDialog`.
   - 3 consecutive failed PIN attempts trigger a 30-second lockout.
   - A valid signature is cached for 2 minutes to streamline bulk operations while displaying an active signing indicator in the bottom status bar.
4. **Closed Period Protection & Dual-Approver Reopen**:
   - Postings to closed fiscal periods (e.g., Jan–Sep 2026) are strictly blocked at the form and engine level.
   - Reopening a closed period requires independent authorization from **two distinct executives** with individual signing PINs.
5. **Cryptographic SHA-256 Merkle Audit Chaining**:
   - Every financial state change appends an immutable audit event linked to the previous block's SHA-256 hash.
   - A live "Verify Hash Chain" tool recomputes cryptographic integrity across all historical blocks.
6. **Integer Minor Unit Representation**:
   - All monetary figures are stored as integer minor units (cents) and formatted using `Intl.NumberFormat` with tabular figures (`tnum`) and negative numbers enclosed in parentheses on reports.

---

## 3. Desktop Application Feel & Keyboard Navigation

- **Fixed 100vh Application Frame**: No page scrolling; internal scrolling within dedicated content panes.
- **Top Status Bar (40px)**: Displays active company, fiscal period status, online/offline sync status with pending ops counter, user switcher, and live clock.
- **IDE-Style Document Tab Strip**: Open documents and reports as persistent tabs with middle-click close, `Ctrl+W` close tab, and `Ctrl+Tab` cycling.
- **Bottom Status Bar (24px)**: Shows selection count, sum of selected amounts, balancing difference pill in forms, signing session countdown, and context-sensitive shortcut hints.
- **Master-Detail Split Pane**: Resizable split pane (280px–640px) on lists with draggable divider and keyboard collapse (`Esc`).
- **Keyboard Chords & Shortcuts**:
  - Global Command Palette: `Ctrl+K`
  - Two-key navigation chords: `g d` (Dashboard), `g i` (Invoices), `g b` (Bills), `g j` (Journals), `g r` (Reports), `g p` (Periods), `g a` (Approvals)
  - Actions: `n` (New), `Ctrl+S` (Save Draft), `Ctrl+Enter` (Submit), `Alt+A` (Approve), `Alt+R` (Return), `Alt+P` (Post), `Alt+V` (Reverse), `/` (List Search), `x` (Select Row)
  - Keybinding overlay: Press `?` anywhere to open the interactive shortcuts directory.

---

## 4. Module Directory

- **Sales & Receivables**: Invoices (list, form, detail with derived journal preview), Customer Receipts with auto-allocation and realised FX gain calculations.
- **Purchases & Payables**: Supplier Bills, Debit Notes, Suppliers register, and the 3-step **Payment Run Wizard** (due bills filter → 5% Withholding Tax deduction → sign with PIN → post disbursements & export Bank Wire CSV).
- **Tax & Compliance**: Official VAT Return (Form VAT-100 Box 1–7 mapping) and Withholding Tax (WHT) deduction certificates register with printable preview.
- **Banking & Treasury**: Multi-currency bank and cash accounts, two-pane Bank Reconciliation workspace with high-confidence automated matching and zero-variance proof certification.
- **Currencies & FX**: Exchange rate table with provider sync simulation and **Month-End FX Revaluation Run** (calculating unrealised gains/losses on foreign balances and scheduling automatic next-period reversal journals).
- **Fixed Assets**: Asset register, straight-line and declining-balance depreciation schedules, NBV tracking, and monthly depreciation run with consequence preview.
- **Budgets**: Full matrix spreadsheet editor (Account × Period Jan..Dec) and Budget vs. Actual variance comparator.
- **General Ledger & Periods**: Manual journals with live balancing difference pill, Fiscal Calendar with 5-point close readiness checklist, and dual-approver reopen workflow.
- **Financial Reports**: Standardized `ReportShell` supporting parameters, comparison periods, **pivot by Branch dimension** (Mogadishu / Hargeisa), zero-rows toggle, cell GL drill-down drawer, and CSV export.
- **Settings & Audit**: Company profile, automatic posting accounts mapping, numbering sequence rules, approval thresholds, users permissions matrix, and the cryptographic SHA-256 Merkle audit log.

---

## 5. Quickstart & Commands

```bash
# 1. Install dependencies
npm install

# 2. Run local development server (runs at http://localhost:5173)
npm run dev

# 3. Execute automated accounting invariant tests
npm test

# 4. Strict TypeScript type check
npx tsc --noEmit

# 5. Production build
npm run build
```

---

## 6. End-to-End Walkthrough & Documentation

- **[DEMO_SCRIPT.md](DEMO_SCRIPT.md)**: Comprehensive **14-step walkthrough** demonstrating the entire application end-to-end (login, controls validation, independent PIN signing, receipt allocation, bank reconciliation, period close, closed-period blocking, dual-approver reopen, journal reversal, offline sync with 409 conflict dialog, payment run with WHT, FX revaluation run, and Balance Sheet branch pivot).
- **[MIGRATION_NOTES.md](MIGRATION_NOTES.md)**: Production migration blueprint covering the component readiness matrix, selector-to-SQL mapping, Laravel 11 REST API contract, and PostgreSQL 16 triggers, sequences, and Row-Level Security policies.
- **Live Usability Tracker**: Press `Ctrl+Shift+U` or append `?usability` to the URL at any time to open the built-in usability telemetry drawer tracking demo step completion, timers, and friction events.
