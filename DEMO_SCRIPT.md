# Ledgerly — 14-Step End-to-End Verification & Demo Script

This script walks through all controls-grade multi-tenant accounting features in Ledgerly end-to-end, matching all requirements in `08_Mock_Refactor_Prompt.md` Blocks A through I.

---

## Prerequisites
Run the development server:
```bash
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

> [!TIP]
> You can toggle the live Usability Tracker panel at any time by appending `?usability` to the URL or pressing `Ctrl+Shift+U`.

---

## Step 1: Log in as Rahim Ahmed (Accountant / Maker)
1. Navigate to `/login`.
2. Under **Quick Demo Persona Login**, click **Rahim Ahmed**.
3. Click **Proceed to 2FA Challenge**.
4. On the 2FA screen, the 6-digit TOTP code (`829104`) is pre-filled. Click **Verify & Enter Ledgerly**.
5. You land on the **Dashboard** (`/acme/dashboard`):
   - **Cash Position**: Displays `$170,550.00` dynamically summed from cash and bank accounts.
   - **Approvals Waiting**: Displays pending requests waiting for review.
   - **Unreconciled Bank Lines**: Displays unmatched bank statement feeds.
   - **Fiscal Period**: Displays **Oct 2026 Open**.
   - **P&L Month-to-Date vs. Budget**: Interactive Recharts chart comparing Actuals vs Budget.
   - **Activity Log**: Cryptographically chained SHA-256 audit events.

---

## Step 2: Create Sales Invoice for Hormuud Telecom (Controls Validation)
1. Click **New Invoice (n)** in the top right or press keyboard key `n`.
2. The form opens at `/acme/invoices/new`:
   - Customer: **Hormuud Telecom (CUST-001)**
   - Two invoice lines are prepared:
     - Line 1: Microwave transceiver modules — Qty 1 @ $500.00, VAT 5% ($25.00)
     - Line 2: Dish antenna mounting hardware — Qty 1 @ $500.00, VAT 5% ($25.00)
     - Totals: Subtotal **$1,000.00** + VAT 5% **$50.00** = Total **$1,050.00**.
     - Notice that **Branch** dimension is initially empty.
3. Click **Submit for Approval**:
   - **Inline Error Banner appears**: *"Controls Validation Failed: Branch dimension is strictly required on all lines (Branch = Mogadishu required for Hormuud Telecom)."*
4. Click the **Quick-fill Mogadishu Branch** button (or open the Dimension dropdown on both lines and choose `Mogadishu`).
5. Click **Submit for Approval** again:
   - Invoice is submitted into `pending_approval` status.
   - Added to the Approvals Queue as `DRAFT-0043`.

---

## Step 3: Switch to Fatima Hassan (Finance Manager) & Approve
1. In the top-right header, click the User Switcher menu (currently showing **Rahim Ahmed**).
2. Click **Fatima Hassan (Finance Manager)**.
3. Notice the bell notification and the sidebar **Approvals Inbox** counter.
4. Click **Approvals Inbox** in the left sidebar (`/acme/approvals`):
   - Under **Waiting for My Review**, see `DRAFT-0043`: *Sales Invoice: Hormuud Telecom ($1,050.00)*.
5. Click **Open** to view the document (`/acme/invoices/:id`):
   - Click the **Journal Preview** tab:
     - See live derived double-entry balanced postings:
       - **Dr 1200 Accounts Receivable (AR Control)**: `$1,050.00`
       - **Cr 4000 Sales Revenue (Line 1)**: `$500.00`
       - **Cr 4000 Sales Revenue (Line 2)**: `$500.00`
       - **Cr 2100 VAT Output (5%)**: `$50.00`
       - Total Debits = Total Credits = `$1,050.00`.
   - Look at the sticky bottom **Approval Bar**:
     - Maker is indicated as **Rahim Ahmed**; Fatima is authorized to approve.
6. Click **Approve & Post**:
   - The **6-Digit PIN SignDialog** opens (PIN: `246810`).
   - Consequence preview clearly states: Period **Oct 2026 (Open)**, Amount **$1,050.00**, and the ledger locking consequence.
7. Enter Fatima's PIN `246810`:
   - Status transitions to **Posted**.
   - Sequence number **INV-2026-0043** is assigned without gaps.
   - Journal entry `JRN-2026-0103` is posted to the General Ledger.

---

## Step 4: Record Customer Receipt with Realised FX Gain & Allocation
1. In the sidebar under **Sales & Revenue**, click **Receive Money (Receipt)** (`/acme/receipts/new`).
2. Parameters:
   - Customer: **Hormuud Telecom**
   - Bank Account: **Premier Bank USD**
   - Receipt Amount: **$12,000.00**
3. Notice the **Allocation Table** auto-allocates:
   - `INV-2026-0038`: **$10,500.00** (Full settlement)
   - `INV-2026-0041`: **$1,500.00** (Partial settlement against $3,150.00 open)
   - Remainder on-account: **$0.00**
4. Look at the **Realised Exchange Gain Preview**:
   - Displays: `+$25.00 (Dr Bank / Cr AR / Cr Realised FX Gain 4900)`.
5. Click **Post Receipt & Allocations**:
   - Receipt `RCT-2026-0016` posted. Invoices updated with settled amounts.

---

## Step 5: Bank Reconciliation Workspace
1. In the sidebar under **Banking & Treasury**, click **Bank Reconciliation** (`/acme/banking/bnk-1/reconcile`).
2. Two-pane workspace loads with unmatched statement feeds on the left and book transactions on the right.
3. Top left shows high-confidence suggested match:
   - Statement line: `+$1,545.00` from Hormuud Telecom
   - Book entry: `RCT-2026-0016` (`+$1,545.00`)
4. Click **Match Selected Transactions** (or **Auto-Match High Confidence (Demo)**).
5. The line is matched and cleared.
6. Look at the **Proof Strip Summary**:
   - Statement Closing: `$131,250.00`
   - Adjusted Book Balance: `$131,250.00`
   - **Variance: Difference: $0.00 (Balanced)**.
7. Click **Finish Reconciliation**:
   - Audit Certification dialog confirms zero variance. Click **Lock Reconciliation & View Periods**.

---

## Step 6: Fiscal Period Close Checklist
1. In the sidebar under **General Ledger**, click **Fiscal Periods** (`/acme/periods`).
2. Select **October 2026** in the FY 2026 Calendar.
3. Review the **Period Close Readiness Checklist**:
   - All Bank Accounts Reconciled: **Pass**
   - AR Subledger Matches GL Control (1200): **Pass**
   - AP Subledger Matches GL Control (2000): **Pass**
   - Suspense Account (9999) Cleared: **Pass**
   - Unapproved Drafts Queue Empty: **Pass**
4. Click **Close Period (Oct 2026)**:
   - The period transitions to **Closed**, preventing further edits or postings.

---

## Step 7: Closed Period Posting Rejection
1. In the sidebar under **General Ledger**, click **Journals**, then **New Journal** (`/acme/journals/new`).
2. Set the **Journal Date** to `2026-09-15` (Sep 2026 is closed):
   - **Blocked Warning Banner appears**: *"Posting Blocked: Period Sep 2026 is Closed. Controls policy prohibits ledger writes to closed fiscal periods."*
   - The **Post to General Ledger** button is disabled.
3. Attempting to post directly throws a `PostingError` invariant rejection.

---

## Step 8: Two-Approver Period Reopen Flow
1. Navigate back to `/acme/periods`.
2. Select **Sep 2026** in the calendar (status is `Closed`).
3. Click **Request Reopen (Dual Approver)**.
4. Enter reason: *"External auditor year-end cutoff adjustment requested"* and submit:
   - A yellow banner appears: *"1 of 2 required signatures recorded. Second approver PIN needed."*
5. Switch user to **Amina Warsame (CFO)** via top-right user menu.
6. Click **Approve Reopening as Amina (CFO)**:
   - Both approvers are verified (Strict maker ≠ checker and distinct signatures).
   - Sep 2026 status transitions to **Open** (`reopened_count: 1`).
7. Reselect Sep 2026 and click **Execute Period Close** to re-seal the period.

---

## Step 9: Post Reversing Journal Entry & Audit Trail
1. Navigate to **Journals** (`/acme/journals`).
2. Click on journal `JRN-2026-0102` (*Erroneous utility expense booked to Sales, $850.00*).
3. The journal view opens with status `Posted`.
4. In the header, click **Reverse Journal**.
5. Modal confirms: States period **Oct 2026 (Open)**, Reversal Amount **$850.00**, and consequence.
6. Click **Confirm Reversal Posting**:
   - Status updates to **Reversed**.
   - A mirror reversal journal `JRN-2026-REV-JRN-2026-0102` is posted with swapped debits & credits.
   - Navigate to **Audit Log Trail** (`/acme/audit-log`):
     - Click **Verify Hash Chain**: Unbroken SHA-256 Merkle link verified across all audit records!

---

## Step 10: Offline Mode Draft & Conflict Resolution (409 Dialog)
1. In the top bar, click the **Online** indicator button or toggle **Offline Mode**.
2. Notice:
   - Top bar indicator switches to **Offline (Amber Striped)**.
   - Outbox shows `0 pending ops`.
3. Create a new draft document or invoice:
   - It is saved locally to IndexedDB via Dexie.
   - Top bar outbox counter updates to `1 pending op`.
4. Click the toggle back to **Online**:
   - The outbox replays queued operations in sequential order.
   - When a simulated version collision occurs (1-in-10 simulated 409 conflict), the **Conflict Resolution Modal** appears:
     - Inspect the visual diff between Local Changes and Server Changes.
     - Choose **Reload**, **Overwrite**, or **Keep Both**.

---

## Step 11: 6-Digit PIN Signing, Failed PIN & Lockout
1. Navigate to any pending document or approval action (e.g. `/acme/approvals`).
2. Click **Approve & Post** to trigger the **SignDialog**.
3. Enter an incorrect PIN 3 times (e.g. `000000`):
   - Notice the error badge: *"Invalid PIN. Attempt 3 of 3. Account locked for 30s."*
   - Inputs become disabled with a 30-second lockout timer.
4. When lockout expires, enter Fatima's valid PIN: `246810`.
5. Notice the bottom status bar:
   - Displays: *"Signed as Fatima Hassan (1:59)"*.
   - Subsequent approvals within 2 minutes reuse the cached signature without annoying re-entry!

---

## Step 12: Supplier Payment Run with Withholding Tax (WHT) & Bank CSV
1. In the sidebar under **Purchases & Payables**, click **Payment Run Wizard** (`/acme/payment-run`).
2. **Step 1: Select Bills**:
   - Select Premier Bank USD as the disbursing bank.
   - Check the open due bills from Dahabshiil or vendors.
   - Click **Continue to WHT Review**.
3. **Step 2: WHT & Review**:
   - Review the automatic calculation:
     - Gross bills selected
     - Less Withholding Tax (5% standard deduction for professional services)
     - Net Bank Wire Disbursement
   - Click **Sign with PIN & Post Payment Run**.
   - Enter Fatima's PIN in the SignDialog.
4. **Step 3: Complete**:
   - Settlements are posted to AP Control (2000).
   - Click **Download Bank Wire CSV** to export the ready-to-upload clearing CSV file.
   - Navigate to `/acme/wht-certificates` to view generated official tax deduction certificates.

---

## Step 13: Foreign Exchange (FX) Month-End Revaluation Run
1. In the sidebar under **General Ledger**, click **FX Rates & Revaluation** (`/acme/fx-rates`).
2. View the **Exchange Rates Table**:
   - Click **Sync Provider Rates** to fetch real-time market rates.
3. Switch to the **Month-End Revaluation Run** tab:
   - As-of date: `2026-10-31`.
   - Target Period: October 2026; Reversal Period: November 2026.
   - Review open foreign currency accounts (e.g. SOS Bank Account):
     - Foreign balance: SOS 109,460,000
     - Book rate: 26,000 vs Period-end market rate: 26,150
     - Unrealised gain/loss calculated.
4. Click **Sign with PIN & Post FX Revaluation**:
   - Unrealised FX journal is posted to October 2026.
   - An automatic reversing journal is booked into November 2026!

---

## Step 14: Balance Sheet with Pivot by Branch Dimension & GL Drill-Down
1. In the sidebar under **Financial Reports**, click **Balance Sheet** (`/acme/reports/balance-sheet`).
2. Click **Parameters** in the toolbar:
   - Under **Pivot by Dimension**, select **Branch (Mogadishu / Hargeisa)**.
   - Click **Run (F5)**:
     - Table instantly pivots into 3 columns: **Mogadishu (MG)**, **Hargeisa (HR)**, and **Total USD**!
     - Balance sheet equation verified: `Total Assets = Total Liabilities + Equity`.
3. Click on any account row (e.g. **1010 Premier Bank USD**):
   - The **DrillDownDrawer** slides out from the right showing all underlying GL lines.
4. Toggle between Light and Dark mode using the **Sun / Moon** icon in the top header.
5. Press `Ctrl+K` to open the Command Palette and navigate anywhere instantly.

---

## Verification Summary
- **100% Dynamic Balances**: Every single card, report, and contact balance is derived from posted `journal_lines`.
- **Zero Hex Literals**: Design tokens strictly use Tailwind variables.
- **Controls & Compliance**: Gapless numbering, Segregation of Duties (maker ≠ checker), SHA-256 audit chaining, and dual-approver controls fully active.
