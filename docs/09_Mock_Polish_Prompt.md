# 09 — Mock polish brief (round 3): visual quality and interaction defects

Findings from the round-2 build (2026-10-28), verified in `src/`:

| Defect | Cause in code |
|---|---|
| Dropdowns (company switcher, user menu, filters) are transparent; content shows through | No `components/ui` layer exists. Menus are plain divs with custom class names, not rendered in a portal, and the container has no opaque surface token. |
| Command palette cannot be closed by Esc, outside click, or a button | Backdrop div has no `onClick={onClose}`; the Esc handler sits on the input only; no close control. |
| No right-click menus on rows | `onContextMenu` exists only in `DocumentTabStrip.tsx`. |
| FX, Assets, Budgets and other pages are centred with empty margins | 21 pages wrap content in `max-w-* mx-auto`. Working screens must be full-width inside the content pane. |
| Visual quality below target | Monospace used for body text and labels, low-contrast grey on grey, too many borders, uppercase everywhere, inconsistent paddings, no elevation system, sidebar items too tall and dense at once. |

Everything below is the prompt.

---

## Prompt (paste)

Round 3. Keep the information architecture, the state machine, the modules and the keyboard
layer from rounds 1 and 2. This round is about **visual quality and interaction correctness**.
The result must look like a product by Linear, Mercury or Stripe Dashboard: calm, precise,
high-contrast where it matters, no visual noise. Do each block in order; run the checklist at
the end of each block before moving on.

### Block 1 — Install a real primitives layer (fixes transparency, focus, portals)
1. Add shadcn/ui on Radix: `dropdown-menu`, `context-menu`, `popover`, `dialog`,
   `command` (cmdk), `tooltip`, `select`, `combobox` (popover + command), `tabs`, `toast`
   (sonner), `scroll-area`, `separator`, `switch`, `checkbox`, `radio-group`, `resizable`.
   Everything overlay-like renders through a Radix Portal above the app frame with
   `bg-surface-elevated` (opaque), `border-line-border`, `shadow-md`, `rounded-md`, and
   proper `z-index` layers: tooltip 60, menu 50, dialog 40, drawer 30, palette 70.
2. Replace every hand-rolled menu, popover, dropdown and dialog in `AppShell`, filters,
   pickers and pages with these primitives. Delete the old implementations.
3. Command palette: rebuild on `cmdk` inside `Dialog`. Esc closes, click on backdrop closes,
   a visible close button top-right, focus is trapped and restored, body scroll locked.
4. Context menus: wire `ContextMenu` on every data-table row, grid cell, tab, sidebar item
   and report cell with the actions from 08 Block B.3. Shift+F10 and the Menu key open it
   from the keyboard.
5. Tooltips on every icon-only button, with the shortcut key rendered as a `<kbd>`.

### Block 2 — Typography and colour reset
1. **Fonts**: Inter for all UI text (labels, table text, headings). JetBrains Mono only for
   document numbers, account codes, amounts in grids, hashes and the clock. Never for body or
   labels. Font sizes from 03_UI_Spec §3; nothing below 12 px.
2. **Palette (light)**, replace the current greys:
   canvas `#F7F8FA`, surface `#FFFFFF`, elevated `#FFFFFF`, sidebar `#FBFBFC`,
   border `#E6E8EC`, border-strong `#D5D9E0`,
   text primary `#111827`, secondary `#4B5563`, muted `#6B7280`, disabled `#9CA3AF`,
   accent `#2F5BEA`, accent-hover `#2449C7`, accent-soft `#EEF2FF`,
   success `#15803D` / soft `#DCFCE7`, warning `#B45309` / soft `#FEF3C7`,
   danger `#B91C1C` / soft `#FEE2E2`, info `#1D4ED8` / soft `#DBEAFE`, violet `#6D28D9` / soft `#EDE9FE`.
   **Dark**: canvas `#0B0F17`, surface `#111827`, elevated `#161E2E`, sidebar `#0E131C`,
   border `#1F2937`, border-strong `#2B3647`, text primary `#F3F4F6`, secondary `#C7CDD6`,
   muted `#8B93A1`, accent `#6D8CF5`, soft tints at 18 % alpha of the colour.
   Put these in `@theme` as the single source; delete every other colour value.
3. **Elevation**: flat by default; borders define structure. Shadows only on overlays
   (`shadow-md`) and dialogs (`shadow-lg`). Dark mode uses a 1 px `border-strong` instead.
4. **Casing**: sentence case everywhere. Uppercase tracking only for sidebar group labels and
   table column headers, at 11 px, weight 600, `text-muted`.
5. **Contrast**: all text ≥ 4.5:1 on its surface. Muted text never below `#6B7280` on white.

### Block 3 — Frame and sidebar
1. Title bar 40 px: left = app mark + company switcher (Select with company name, currency
   pill) + period chip; centre = search field 420 px with `⌘K` kbd; right = online chip,
   clock, density segmented control, theme toggle, user menu (avatar + name + role).
   Each control is 28 px high, 6 px gap, aligned on one baseline.
2. Sidebar 232 px: group label 11 px uppercase with 20 px top margin; items 30 px high,
   13 px Inter 500, 16 px icon at `text-muted`, 8 px gap; hover `bg-surface-neutral`;
   active item `bg-accent-soft` with `text-accent` and a 2 px accent bar on the left; collapsed
   state 56 px icons with tooltips; groups collapsible with chevron, state persisted.
   Sidebar footer: period chip and version. Scroll region is the item list only.
3. Document tab strip 36 px: tabs 32 px, Inter 13 px, close × on hover, active tab joins the
   content surface (no bottom border), unsaved dot, overflow scroll with chevrons.
4. Content pane: **full width**, padding 20 px, no `max-w`, no `mx-auto` on any working
   screen. Only auth pages, onboarding and settings forms may use a 720 px centred column.
5. Page header: title 20 px/600, subtitle 13 px muted, actions right (one primary, others
   secondary/ghost), 16 px below. No decorative icons beside titles.
6. Bottom status bar 24 px: 12 px text, items separated by 16 px, left = state + invariants
   check, centre = selection summary, right = shortcut hints and "? Shortcuts".

### Block 4 — Tables and grids
1. Rows 36 px (density adjustable), zebra off, hover `bg-surface-neutral`, selected
   `bg-accent-soft`, focused row 1 px accent inset ring. Horizontal borders `border` only;
   no vertical borders. Header sticky, 32 px.
2. Column alignment: text left, numbers right in mono 13 px with tabular figures, dates
   left in Inter, status pill left. Numbers never bold. Settled column shows "—" when zero.
3. Status pills: 20 px high, 11 px/600, soft background, dot 6 px, icon optional, same width
   family (min 72 px) so columns stay aligned.
4. Document numbers are links in mono with `text-accent`; drafts in `text-muted`.
5. Pagination footer 40 px: "1–15 of 42", page size select, prev/next. Keyboard `[` `]`.
6. Empty, loading (skeleton rows, same heights) and error states for every table.

### Block 5 — Forms and dialogs
1. Form grid: labels 12 px/500 above inputs, inputs 32 px, 12 px gap vertical, 16 px gap
   horizontal, 2 columns at ≥ 1280 px. Required mark in `text-danger`. Help `?` icon opens
   popover. Error text 12 px danger under the field with the fix sentence.
2. Money input: right aligned mono, currency prefix, grouping on blur.
3. Dialogs: 480 px (confirm) / 640 px (forms) / 880 px (sign + preview), 20 px padding,
   title 15 px/600, footer right-aligned with secondary then primary, Esc and backdrop close.
4. Sign dialog per 08 Block D with the consequence panel on the left, PIN boxes on the right.

### Block 6 — Dashboard and reports
1. Dashboard: 12-column grid, 16 px gutters, cards with 1 px border, no shadow, title row
   13 px/600, number 24 px mono, delta pill, chart area min 200 px. Charts use accent for the
   main series, `#0E9F8E` teal secondary, muted grid lines, no 3D, no gradients.
2. Reports: parameter panel as a left 280 px pane (collapsible), result full width,
   subtotal rows `bg-surface-neutral` and 600 weight, grand total double rule, negatives in
   parentheses, drill cells underline on hover.

### Block 7 — Motion, states, polish
1. Transitions 120 ms ease-out for hover and 160 ms for overlays; respect reduced motion.
2. Every interactive element has `focus-visible` 2 px accent ring, 2 px offset.
3. Toasts bottom-right, 320 px, icon + one line + optional action; errors stay until dismissed.
4. No text truncation without tooltip. No layout shift on load (reserve heights).
5. Icons 16 px lucide, stroke 1.75, `text-muted` unless active.

### Verification (run and report after each block)
- `grep -rE "#[0-9a-fA-F]{6}" src/components src/pages src/layouts` → empty.
- `grep -rE "max-w-|mx-auto" src/pages` → only Auth, Onboarding, Settings forms.
- `grep -rl "onContextMenu\|ContextMenu" src/components/domain src/pages` → DataTable,
  LineGrid, DocumentTabStrip, sidebar, report grid.
- `grep -rn "font-mono" src` → only number, code, hash, clock usages.
- Open every overlay: opaque, above content, closes on Esc and outside click, restores focus.
- Lighthouse accessibility ≥ 95 in light and dark.
- Screenshot each Tier 1 screen at 1440×900 light and dark and attach them to the reply.
