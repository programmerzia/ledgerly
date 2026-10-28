# 03 — UI Specification & Design System

Desktop-first (finance users on 1366–1920 px), responsive down to 768 px tablet; phone is
read-only dashboards and approvals. Implementation: Tailwind CSS v4 tokens + shadcn/ui
(Radix) components + lucide-react icons + TanStack Table for grids.

## 1. Design principles

1. **Density with calm**: tables are dense (36 px rows), surrounding chrome is airy.
2. **Numbers right-aligned, tabular figures, two decimals, thousands separator** per locale.
   Negative in parentheses on reports, red minus in grids. Never colour as the only signal.
3. **Status is a pill, never only a colour.**
4. **One primary action per screen**, top right, keyboard reachable.
5. **Forms never lose data**: autosave drafts every 10 s and on blur.

## 2. Colour tokens (CSS variables; Tailwind `@theme`)

### Brand & neutrals (light)
| Token | Hex | Use |
|---|---|---|
| `--color-brand-50` | `#EEF4FF` | selected row bg, info bg |
| `--color-brand-100` | `#D9E6FF` | hover bg |
| `--color-brand-500` | `#2F5BEA` | links, focus ring |
| `--color-brand-600` | `#2449C7` | primary button |
| `--color-brand-700` | `#1C3A9E` | primary hover |
| `--color-ink-900` | `#0F172A` | headings |
| `--color-ink-700` | `#334155` | body |
| `--color-ink-500` | `#64748B` | secondary text |
| `--color-ink-300` | `#CBD5E1` | borders strong |
| `--color-ink-200` | `#E2E8F0` | borders |
| `--color-ink-100` | `#F1F5F9` | table header bg |
| `--color-ink-50` | `#F8FAFC` | page bg |
| `--color-surface` | `#FFFFFF` | cards |

### Semantic
| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-success` | `#15803D` (bg `#DCFCE7`) | `#4ADE80` (bg `#14532D`) | posted, matched, balanced |
| `--color-warning` | `#B45309` (bg `#FEF3C7`) | `#FBBF24` (bg `#78350F`) | pending approval, soft-closed |
| `--color-danger` | `#B91C1C` (bg `#FEE2E2`) | `#F87171` (bg `#7F1D1D`) | errors, void, overdue |
| `--color-info` | `#1D4ED8` (bg `#DBEAFE`) | `#60A5FA` (bg `#1E3A8A`) | hints |
| `--color-reversed` | `#6D28D9` (bg `#EDE9FE`) | `#A78BFA` (bg `#4C1D95`) | reversed docs |
| `--color-draft` | `#475569` (bg `#F1F5F9`) | `#94A3B8` (bg `#1E293B`) | draft |

### Dark theme neutrals
`ink-900→#F8FAFC`, `ink-700→#E2E8F0`, `ink-500→#94A3B8`, `ink-300→#334155`,
`ink-200→#1E293B`, `ink-100→#172033`, `ink-50→#0B1220`, `surface→#111A2E`,
`brand-600→#5B82F0`, `brand-700→#7A9AF4`.

Theme rule: `data-theme="light|dark|system"` on `<html>`; default system; persisted per user.
Charts use the same semantic tokens; never more than 6 categorical series (brand, teal
`#0E9F8E`, amber, violet, rose `#E11D48`, slate).

## 3. Typography

Font: **Inter** (variable) with `font-feature-settings: "tnum" 1, "cv11" 1`; monospace
**JetBrains Mono** for codes/numbers in inputs.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `text-display` | 30/36 | 600 | page title (rare) |
| `text-h1` | 24/32 | 600 | page header |
| `text-h2` | 18/28 | 600 | card title |
| `text-h3` | 15/22 | 600 | section label |
| `text-body` | 14/20 | 400 | default |
| `text-sm` | 13/18 | 400 | table cells, help |
| `text-xs` | 12/16 | 500 | pills, column headers (uppercase, tracking 0.04em) |
| `text-num` | 13/18 | 500, tnum | amounts |

## 4. Spacing, radius, elevation

- Base unit 4 px. Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Page padding 24 px; card padding 20 px; form field gap 16 px; table cell padding 8×12 px.
- Radius: `sm 4px` inputs/pills, `md 8px` cards/buttons, `lg 12px` dialogs.
- Shadows: `sm 0 1px 2px rgb(15 23 42 / .06)`, `md 0 4px 12px rgb(15 23 42 / .08)` (popovers),
  `lg 0 12px 32px rgb(15 23 42 / .16)` (dialogs). Dark theme: shadows replaced by 1 px border.
- Max content width 1440 px; reports and grids may go full width.

## 5. Layout grid

Sidebar 248 px (collapsed 64 px). Top bar 56 px. Content 12-column, 24 px gutters.
Forms: 2-column on ≥1280 px (labels above inputs), 1-column below. Line grids full width.

## 6. Core components & states

| Component | Variants | States |
|---|---|---|
| Button | primary, secondary (outline), ghost, danger, link; sizes sm 32 / md 36 / lg 40 | default, hover, active, focus-visible (2 px brand ring, 2 px offset), disabled (40 % opacity), loading (spinner, text kept, width locked) |
| Input / Select / Combobox / Date / Money | label, help, required mark, prefix/suffix (currency) | default, focus, error (danger border + message), disabled, read-only (no border, copyable) |
| Money input | right-aligned, tnum, locale grouping on blur, raw on focus; `-` or `(x)` accepted | |
| Account picker | combobox with code + name, type badge, recent, keyboard | shows inactive greyed; blocked accounts explained |
| Dimension chips | per line; required dims shown with asterisk until filled | |
| Line grid | editable table, Tab/Enter navigation, row add/remove/duplicate, footer totals, column chooser, sticky header | invalid cell red, balancing difference pill |
| Data table | sortable, filter bar, saved views, column resize, density toggle, row selection, bulk bar, pagination (server), export | loading skeleton rows, empty, error (retry) |
| Status pill | draft/pending/posted/reversed/void/overdue/paid/partial | icon + text |
| Dialog / Drawer | confirm (summarises money + period), form drawer (right, 560 px) | |
| Toast | success (3 s), info, warning, error (sticky, dismiss) | |
| Banner | info/warning/danger, in-page | |
| Empty state | one sentence + primary action (+ import) | |
| Approval bar | sticky bottom on pending docs: maker, submitted at, Approve / Return | hidden for maker |
| Drill-down | report cell hover → underline; click → drawer with GL lines → click → document | |
| Document header | number, status, dates, amounts, actions dropdown | |
| Timeline / Activity | who did what when, with diff for drafts | |
| Command palette (⌘K) | search docs, contacts, accounts, navigation | |

## 7. Accessibility

WCAG 2.2 AA: contrast ≥ 4.5:1, visible focus, full keyboard operation incl. grids, aria-live
for toasts and totals, reduced-motion respected, no information by colour alone.

## 8. Number & date formatting

Per company locale: decimals (0–4 by currency minor unit), grouping, date format
(ISO in API, locale in UI), time zone per company. Amounts stored as integer minor units;
UI formats with `Intl.NumberFormat`.

## 9. PDF documents

Invoice/receipt/statement templates: A4 & Letter, logo, company block, document block, lines
table, totals with tax breakdown, payment instructions, footer with page x/y and document
hash. Rendered server-side (Browsershot/Chromium) from Blade templates sharing tokens.

## 10. Desktop application and keyboard-first rules

Ledgerly must feel like a desktop finance application running in a browser, not a website.

- **Frame**: `100vh`, no page scroll. Regions: title/status bar 40 px, sidebar 248/64 px,
  document tab strip 36 px, content pane (internal scroll), bottom status bar 24 px.
- **Document tabs**: every opened record is a tab (Ctrl+W close, Ctrl+Tab cycle, middle-click
  close, drag to reorder, Dashboard pinned). Unsaved drafts show a dot.
- **Master-detail**: lists use a resizable split pane; selection shows the detail on the right;
  Enter or double-click opens a tab.
- **Context menus** on rows, cells and tabs. **Status bar** shows selection count and sum,
  balance difference in forms, online/offline and outbox count, signing session timer, and
  shortcut hints for the focused element.
- **Grids** behave like a spreadsheet: cell focus, Arrow/Tab/Enter/F2/Esc, Ctrl+D fill down,
  Ctrl+C/V, range select, column resize/reorder/freeze, virtualised rows.
- **Density**: compact 32 px, default 36 px, comfortable 40 px rows, per user.
- **Shortcuts** (Ctrl = Cmd on macOS): Ctrl+K palette · `g` + letter navigation · `n` new ·
  Ctrl+S save · Ctrl+Enter submit · Alt+A approve · Alt+R return · Alt+P post · Alt+V reverse ·
  Ctrl+F filter · `/` search · `j/k` move · `x` select · Enter open · Esc close · F5 run report ·
  F9 recalc · `?` shortcut overlay. Every button tooltip shows its key.
- **Focus management**: focus returns to the originating row or control after any action;
  dialogs trap focus and restore it.
- **Sign dialog** (signing PIN): 6 masked boxes, Enter submits, lockout message, cached
  signature timer shown in status bar.
- **Offline indicators**: status bar state, `queued` status pill (amber striped) for server
  actions awaiting connectivity, "as of … offline" labels on cached reports.

## 11. Zero-training usability principles

Ledgerly must be operable by a first-time bookkeeper without training, while staying
keyboard-first for experts. Rules: plain-language labels with the accounting term secondary;
one worded primary action per screen and a stated reason whenever it is disabled; guided
first-use coach panels and a getting-started checklist; smart defaults and auto-fill from
contact, item, account and rate table; a plain-language consequence preview before any
posting or approval with accounting lines collapsed behind "Show accounting"; autosave, undo
and a one-flow "Fix this" for posted mistakes; inline one-sentence field help and actionable
error text; natural-language search; self-explaining status pills; progressive disclosure for
advanced fields and settings; one layout and wording for all documents.
