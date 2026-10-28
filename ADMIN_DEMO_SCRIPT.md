# Ledgerly Platform Admin — 10-Step Interactive Walkthrough & Demonstration Script

> **App Surface:** `/admin`  
> **Target Persona:** Vendor Staff (Founder/Owner, Finance Director, Support Lead, SRE, Auditor)  
> **Design Conformance:** `docs/03_UI_Spec.md` (§10 Desktop Frame, §11 Keyboard-First), `docs/09_Mock_Polish_Prompt.md` (Zero raw hex literals, 40px top bar, 232px sidebar, 24px status bar, 36px dense tables)  
> **Interactive State Engine:** Real client-side Zustand store (`src/mock/store/adminStore.ts`) behind typed async endpoints (`src/mock/api/admin/*.ts`).

---

## Screen Artifacts & Resolution (1440×900 Light / Dark)

All screenshots captured at pixel-perfect `1440×900` under both themes:

| Screen | Light Mode Screenshot | Dark Mode Screenshot |
| :--- | :--- | :--- |
| **01. Staff Login** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_01_login_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_01_login_dark.png) |
| **02. Staff 2FA Challenge** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_02_two_factor_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_02_two_factor_dark.png) |
| **03. Overview & Live KPIs** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_03_dashboard_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_03_dashboard_dark.png) |
| **04. Tenants Directory** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_04_tenants_list_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_04_tenants_list_dark.png) |
| **05. 10-Tab Tenant Detail** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_05_tenant_detail_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_05_tenant_detail_dark.png) |
| **06. Plans & Pricing Matrix** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_06_plans_matrix_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_06_plans_matrix_dark.png) |
| **07. Coupons & Discounts** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_07_coupons_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_07_coupons_dark.png) |
| **08. Billing & Invoices** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_08_billing_ops_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_08_billing_ops_dark.png) |
| **09. Growth & Trials** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_09_growth_trials_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_09_growth_trials_dark.png) |
| **10. Partners & Resellers** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_10_partners_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_10_partners_dark.png) |
| **11. Support & Comms** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_11_support_center_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_11_support_center_dark.png) |
| **12. Platform Ops & Telemetry** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_12_platform_ops_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_12_platform_ops_dark.png) |
| **13. Feature Flags (Pennant)** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_13_feature_flags_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_13_feature_flags_dark.png) |
| **14. Staff & Dual Approval** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_14_staff_security_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_14_staff_security_dark.png) |
| **15. Compliance & GDPR** | [Light Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_15_compliance_light.png) | [Dark Preview](file:///home/ziaur-rahman/.gemini/antigravity/brain/6bf8acb3-2e5b-4504-96ab-20b90944a5fc/screenshots/admin_15_compliance_dark.png) |

---

## 10-Step Interactive Walkthrough

### Step 1: Staff Authentication (Email + Password + 2FA Challenge)
1. Navigate to `http://localhost:5173/admin/login`.
2. Notice the dedicated staff console login card with hardware key support (WebAuthn/YubiKey) and quick persona buttons.
3. Click on **"Ziaur Rahman (Founder & CEO, Owner)"** or type `ziaur@ledgerly.io` / `admin-password`.
4. Click **Sign in with Hardware Key / 2FA**.
5. You are redirected to `/admin/2fa` with a 6-digit TOTP input pre-populated with active hardware token seed. Click **Verify & Enter Admin Console**.
6. The browser mounts the Platform Admin Shell (`AdminShell`) under `/admin`.

### Step 2: Overview & Live Computed SaaS Metrics
1. Navigate to `/admin`.
2. Observe the KPI metric tiles computed directly from 120 mirrored tenants and 400 Stripe invoices:
   - **Monthly Recurring Revenue (MRR):** `$32,856` (+18.4% Net New MRR).
   - **Annual Run-Rate (ARR):** `$394,272` (ARR multiple 12.0×).
   - **Total Tenants:** `120 Organizations` (94 active paid, 18 trialing, 6 past due, 2 suspended).
   - **Net Revenue Retention (NRR):** `114.2%` (Gross Retention 96.8%).
   - **At Risk / Dunning:** `6 tenants` (`$1,148.70` overdue).
   - **System Telemetry:** `99.98% SLA`, p95 latency `84ms`, 0 backlog jobs.
3. Hover over the **14-Month MRR Growth Curve** (Sep 2025 – Oct 2026) to see month-by-month trajectory.
4. Click **Export ASC 606 Schedule** top right to test instant CSV schedule generation.

### Step 3: Tenants Directory & Search Filtering
1. Click **Tenants** in the sidebar (`/admin/tenants`).
2. Notice the 36px dense data table displaying organizations, tier pills, status badges, MRR, company and seat quotas, and data residency vaults (`us-east`, `eu-central`, `af-south`).
3. Click the filter chips: **Trials (18)**, **Past Due (6)**, **Suspended (2)**.
4. Search `Acme` or `Somalia` in the live search bar.
5. Click on **Acme Trading Ltd** (`ten-acme-group`) or click the open icon to open the 10-tab detail view.

### Step 4: 10-Tab Tenant Detail Deep-Dive
1. View `/admin/tenants/ten-acme-group`:
   - **Tab 1: Overview:** Plan badges, monthly recurring revenue, primary owner, local residency vault (`af-south`), health score `98/100`, and entitlement vs metered usage bars.
   - **Tab 2: Subscription & Proration:** Stripe subscription details, billing cycle renewal date, and action modals.
   - **Tab 3: Invoices & Refunds:** Mirrored Stripe invoices with one-click refund request triggers.
   - **Tab 4: Usage Meters:** Live journal lines, daily API calls, storage consumed vs plan limits.
   - **Tab 5: Users & 2FA:** Registered users and 2FA hardware key enforcement.
   - **Tab 6: Operating Companies:** All company legal entities enrolled under the tenant ledger.
   - **Tab 7: Pennant Feature Flags:** Tenant-specific feature flag overrides.
   - **Tab 8: Support & Impersonation:** Direct customer tickets and audit access history.

### Step 5: Change Plan with Real-Time Proration Preview
1. On the tenant detail view, click **Change Plan / Upgrade** top right.
2. Select target plan **"Business ($349 / mo)"** and interval **"Monthly"**.
3. Notice the live calculated proration breakdown:
   - Unused credit on current Professional plan: `-$49.67`
   - New Business license charge: `+$349.00`
   - **Net Amount Due Today:** `$299.33`
4. Enter upgrade justification: `"Customer upgrading to enable multi-currency and 4-eyes approval rules"`.
5. Click **Apply Plan Migration**.
6. Toast confirms the upgrade, the tenant MRR updates immediately in the Zustand store and is reflected live in the header and billing tab!

### Step 6: Trial Extension & Promotional Coupon Application
1. Click on **Extend 14-Day Trial** (or test on any trialing tenant).
2. Choose `+14 Days` and enter reason `"Proof of concept extension approved by Sales"`. Click **Extend Trial**.
3. Click **Apply Coupon Code**, select or enter `PARTNER20` (20% off). Click **Apply Coupon**.
4. The discount pill is immediately applied to the subscription and synced with Stripe.

### Step 7: Dual-Approval Refund with Maker/Checker PIN Signing
1. Switch to **Tab 3: Invoices & Refunds** on the tenant, or navigate to `/admin/billing`.
2. Locate invoice `SUB-INV-2026-01001` and click **Request Refund**.
3. Enter amount `$149.00` and reason `"Duplicate charge during migration"`. Submit request.
4. Notice the top bar chip shows **"2 Dual Approvals Pending"**.
5. Click on **Staff & Security** (`/admin/staff`) or the pending approvals banner:
   - The pending refund shows `Requested by Ziaur Rahman`.
   - Four-Eyes rule: Because you are logged in as Ziaur Rahman (the Maker), the approval button is disabled with message `"Maker cannot sign (Four-Eyes rule enforced)"`.
6. Use the top persona switcher to switch to **"Sarah Jenkins (Finance Director)"**.
7. Now the **Authorize & Sign** button is active!
8. Click **Authorize & Sign**, confirm the 6-digit PIN (`491028`), and click **Sign & Execute Refund**.
9. The refund is executed, invoice status updates to `refunded`, and an immutable SHA-256 chained audit record is appended to the ledger!

### Step 8: Operator Impersonation (Read-Only Mode & Blocked Writes)
1. Navigate back to `/admin/tenants/ten-acme-group`.
2. Click **Impersonate (Read)** top right.
3. Enter justification `"Investigating customer report on reconciliation variance"` and click **Launch Read Session**.
4. You are redirected to the tenant application (`/acme/dashboard`)!
5. Notice the **persistent amber warning banner** pinned to the top of the viewport:
   `OPERATOR IMPERSONATION: Active session for tenant ten-acme-group as Ziaur Rahman. Mode: READ-ONLY.`
6. Navigate to `/acme/invoices` and attempt to post or submit an invoice:
   - The application blocks write actions in read-only mode and displays a warning toast.
7. Click **End Session** in the top banner. You are safely returned to `/admin`.
8. Check `/admin/support` under Impersonation Logs: the start, duration, and IP are sealed in the audit trail.

### Step 9: Tenant Suspension & Reactivation Lifecycle
1. On the tenant detail view, click **Suspend** top right.
2. Select reason `"Terms of Service violation: Unpaid overdue invoice exceeding dunning window"`.
3. Confirm suspension. The tenant status changes to `suspended`, MRR drops to `$0`, and access is immediately revoked.
4. Click **Reactivate Instance**, enter verification reason `"Payment settled via wire transfer"`, and confirm.
5. Status returns to `active` and services are restored instantly.

### Step 10: Pennant Flags & GDPR Compliance Center
1. Navigate to **Feature Flags** (`/admin/flags`):
   - Adjust the **Rollout Slider** for `mrr_ai_forecasting` from `25%` to `50%`.
   - Click **Manage Overrides** and toggle force-enable for specific strategic tenants.
2. Navigate to **Compliance & GDPR** (`/admin/compliance`):
   - Review the Data Sovereignty Vaults (`us-east`, `eu-central`, `af-south`).
   - Click **New Article 20 DSAR Request**.
   - Enter tenant `Acme Trading`, request type `Full Ledger & Document Export (ZIP)`, and data subject email `compliance@acme.so`.
   - The statutory 30-day countdown timer begins. Click **Generate Export Archive (JSON + PDF)** to complete the request and verify compliance record completion.

---

## Technical Verification Summary

- **TypeScript:** 0 compilation errors (`npx tsc --noEmit` exits code 0).
- **Unit Tests:** 6/6 ledger and invariant test suites passing (`npm test`).
- **Token Rule:** 0 raw hex literals across all admin files; 100% powered by `@theme` semantic tokens (`bg-surface`, `bg-canvas`, `text-violet`, etc.).
- **Theme Support:** High-contrast Light Mode, Slate Dark Mode, Midnight Navy, and Forest Emerald themes.
