# GuestFlow Design System — « Maison »

| Field | Value |
|---|---|
| **Status** | Approved (2026-07-06, with uniformization additions §3.4-§3.6) |
| **Branch** | one per phase — see §3.9 (umbrella spec, no single branch) |
| **Created** | 2026-07-06 |
| **Author** | Adrien |
| **Related PR** | (one per phase) |
| **Mockup** | [Design directions artifact](https://claude.ai/code/artifact/479a7c6b-e311-4c76-8b8e-537108490580) — direction C retained |

---

## 1. Context

GuestFlow's UI grew page by page. A 6-agent audit (2026-07-03, adversarially verified) found a **healthy
core** — a single theme ([`client/src/theme.js`](../client/src/theme.js)), MUI palette tokens are the norm
(333 palette-path usages, 0 hex Chips), 10 of the 13 CLAUDE.md §7 prescribed generics exist — but
**consistency leaks in five places** across the 28 routed pages:

1. **Two parallel page-header systems.** Sticky `PageActionBar` (11 pages, h6 title) vs legacy non-sticky
   `PageHeader` (9 pages + 4 via `DataPageScaffold`, h4 title) + 2 hand-rolled headers
   (`EmailTemplatesPage.js:317`, `PropertyDetail.js:741`).
2. **`LoadingState` / `EmptyState` / `ErrorAlert` don't exist** (mandated by CLAUDE.md §7): 4 divergent
   loading patterns, 9 pages with no loading indicator, 7+ ad-hoc empty states, 13 inline error Alerts, and
   **5 pages that swallow fetch errors silently** (CalendarPage.js:93, Dashboard, FinancePage, PlanningPage,
   PropertiesPage).
3. **Mobile broken at the primitives.** `FormDialog`/`ConfirmDialog`/`DialogProvider` render `<Dialog>`
   without `fullScreen` on mobile (~13 pages non-compliant by inheritance); only 2 of 14 table surfaces have
   the cards-on-xs mode; `PlatformAccountsPage.js:263` has a raw `<Table>` with no scroll container.
4. **Post-action feedback has 6 patterns and zero Snackbar** (inline Alerts under 3 different state names,
   success modals, `window.alert`, silent saves) + a live bug: `DevisPage.js:106` passes a string to
   `DialogProvider.alert()` (options-object API) → errors display as an empty « Information » dialog.
5. **Visual debt, localized.** 173 inline hex + 82 raw `rgba()` (concentrated in calendar/planning:
   CalendarDayCell 53, ReservationCard 43, MiniDayPlanner 34, ReservationSasDialog 29); 4 currency formats
   (`1 234 €`, `12,50 €`, `12.50€`, `12.50 €`); 14+ local `formatDate` vs the shared `displayDate()`; two
   **conflicting** `ZONE_COLORS` maps (`constants/schoolHolidayZoneColors.js:3` vs
   `utils/calendarVisuals.js:19`); 18× hardcoded `#1976d2` (stale MUI default) vs theme primary; 12 distinct
   `Stack` spacing values; 5 content max-widths; typography roles unmapped (page title h4 vs h6, 3
   section-header renderings, KPI values h4 vs h5 in the same page).

Completeness critique also flagged: the **App shell** (AppBar + Drawer in `App.js` ~200-830, the most-seen
surface) was outside the audit's page table; **no ErrorBoundary and no `path="*"` route** (render crash /
unknown URL = blank screen); `ForcedPasswordChange` (App.js:874) missing from inventories;
`useDirtyFormGuard` adoption never measured; touch-target compliance unverified in dense surfaces.

**Decisions (AskUserQuestion):**
- *2026-07-03* — Scope = **full, phased** (tokens/theme → components → page migration). Reference =
  **versioned doc + `/design` showcase page** (admin). Migration = **dedicated sweep PRs by blocks**.
  Ambition = **visual refresh at the same time** (not just harmonization).
- *2026-07-06* — Visual direction = **C · « Maison »** (hospitality identity) from the
  [3-direction mockup](https://claude.ai/code/artifact/479a7c6b-e311-4c76-8b8e-537108490580): deep fir-green
  primary, warm paper background, humanist-serif titles, radius 14, generous whitespace — chosen over
  A · Continuité (refined status quo) and B · Épuré (dense bordered ops-tool).

## 2. Goal

Every GuestFlow page looks and behaves like the same product: one token source (theme), one component
per role (header bar, states, feedback, badges, dialogs, tables), one visual identity (« Maison »), and a
`/design` page + versioned doc that keep it that way. Migration proceeds block by block until all 28 pages
+ the app shell comply.

## 3. Functional rules

### 3.1 Design tokens (single source: `client/src/theme.js`)

| Token | Value | Notes |
|---|---|---|
| `palette.primary.main` | `#2F5D46` | Vert sapin. Buttons, active nav, links, focus. |
| `palette.secondary.main` | `#C99038` | Miel. Sparing accent (highlights, selected chips). |
| `palette.background.default` | `#F8F5EF` | Papier chaud (replaces `#f5f7fa`). |
| `palette.background.paper` | `#FFFFFF` | Cards stay white. |
| `palette.text.primary` | `#27251F` | Encre chaude. |
| `palette.text.secondary` | `#6E6A5E` | Warm muted. |
| `palette.success.main` | `#3E7D54` | Distinct from primary (brighter). Soft bg `#E6EFE7`. |
| `palette.warning.main` | `#8F6A1D` | Soft bg `#F6EDD7`. |
| `palette.error.main` | `#A8433A` | Soft bg `#F7E8E5`. |
| `palette.info.main` | `#31556E` | Soft bg `#E4EDF3`. |
| `palette.divider` | `rgba(60,54,36,0.1)` | Warm hairline. |
| `shape.borderRadius` | `14` | Was 12. |
| Card/Paper shadow | `0 3px 16px rgba(60,54,36,0.09)` | Warm, soft. |
| Spacing scale | `0.5, 1, 1.5, 2, 3` only | Blessed `Stack`/`gap`/padding multipliers. |
| Content max-widths | `900` (forms) / `1240` (wide) | The only two. |

Semantic chips use the soft-background + dark-text pattern (see mockup) — never filled semantic Chips for
statuses. Platform colors stay in `constants/platforms.js` (unchanged palette). All translucency via
`alpha()` (generalizing the existing `ReservationPage.js:9` import) — no new raw `rgba()` strings.

### 3.2 Typography roles (theme variants — end the h4/h6 split)

| Role | Face | Spec | Replaces |
|---|---|---|---|
| `pageTitle` | **Serif** | 600, 1.35rem (1.2rem xs) | h4 (PageHeader) & h6 (PageActionBar) titles |
| `sectionHeader` | **Serif** | 600, 1.05rem | h6 / subtitle1+sx / subtitle2+sx section heads |
| `kpiValue` | Sans | 700, 1.6rem, `tabular-nums` | h4/h5 KPI mix |
| `kpiLabel` | Sans | 600, 0.72rem, `text.secondary` | the one already-consistent pattern, kept |
| body / controls | Sans (Inter, already shipped) | unchanged | — |

Serif = **Source Serif 4** self-hosted via `@fontsource/source-serif-4` (woff2 bundled — the Pi deploy must
not depend on a font CDN). Registered as custom MUI typography variants so pages write
`<Typography variant="pageTitle">`. **Amounts and dates never render in serif** — figures stay sans with
`tabular-nums`.

### 3.3 Component consolidation

New generics (CLAUDE.md §7 contracts):
- **`LoadingState`** — centered spinner or skeleton variant; one per page/section.
- **`EmptyState`** — icon + message + optional CTA.
- **`ErrorAlert`** — standardized error + optional « Réessayer »; kills the 5 silent-error pages.
- **`useToast()`** (in `DialogProvider`) — Snackbar-based `showSuccess/showError`; replaces the 6 feedback
  patterns; fixes the `DevisPage.js:106` alert bug.
- **`PlatformChip`** / **`PaidChip`** (or `StatusBadge` extension) — one rendering per semantic.
- **`UnsavedChangesDialog`** — merges the two divergent dialogs; wording « Modifications non enregistrées »,
  verb « Enregistrer », stay-button first.
- **`ResponsiveTable`** (or `TableCard` xs mode) — `renderMobileCard` prop, modeled on
  `UserManagementPage.js:368`.

Fixes to existing:
- `FormDialog` / `ConfirmDialog` / `DialogProvider`: `fullScreen` on `xs` (one `useMediaQuery` each →
  ~13 pages compliant at once).
- `DataPageScaffold` renders `PageActionBar` instead of `PageHeader` (4 pages migrate in one change).
- `PageHeader` is **deleted at the end of the sweep** (kept only during migration).
- App-level: add an `ErrorBoundary` + a `path="*"` NotFound route (uses `EmptyState`).
- Hygiene: delete 4 dead components (`DateInput`, `PropertyFormFields`, `PropertyCalendarOverview`,
  `SyncedPropertyMiniCalendars`); JSDoc on `ConfirmDialog`/`FormDialog`/`TableCard`/`DataPageScaffold`;
  delete `EmailHistoryPage`'s local `StatusBadge`.

### 3.4 Canonical page actions — one top-right bar, everywhere

Every page-level action (Enregistrer, Annuler, Supprimer, synchroniser, PDF…) lives **exclusively** in
`PageActionBar` — no page keeps its own save/delete buttons in content headers, card corners or bottom rows
(buttons inside dialogs/forms stay form-local). One canonical rendering app-wide (CLAUDE.md §7 contract, now
enforced by the sweeps):

- **Order:** `[Back] [Title + subtitle] … [center] … [actionsBefore (page-specific)] [Save — filled primary]
  [Cancel — bordered neutral] [actionsAfter — destructive zone, error-colored]`.
- **One icon per role, app-wide** (catalogued in DESIGN-SYSTEM.md + `/design`): Save `SaveIcon`, Cancel
  `CloseIcon`, Delete `DeleteIcon` (error), Sync `SyncIcon` (info), PDF `DescriptionIcon` (info). A sweep may
  not invent a new icon for an existing role.
- Icon-only buttons with **mandatory French tooltip + aria-label**, ≥44×44 touch target, `saveDisabled =
  !isDirty`, `saveBusy` spinner while saving, xs overflow rule (>2 custom actions → « … » menu).

### 3.5 Table conventions (alignment is part of the DS)

- **Column alignment by type:** text **left**; amounts and counts **right** with `tabular-nums`; dates left
  in one format (`displayDate`). **The header cell always aligns like its column body** (no left-header over
  right-amounts).
- Currency cells via `formatCurrency` only; status columns via the shared chips (`StatusBadge`/`PaidChip`) —
  one treatment per semantic; empty cell renders « — », never blank; empty list renders `EmptyState`.
- Cell padding from the blessed spacing scale; consistent row density per table type; sticky header on tall
  `md+` tables.
- xs: cards mode (`ResponsiveTable`) for operator-critical lists; otherwise horizontal scroll **inside a
  contained wrapper** — never page-level.
- Encoded once in `TableCard`/`ResponsiveTable` (column-type → alignment), not re-specified per page in sx.

### 3.6 Page opening & navigation (the bar must be visible on arrival)

- **Scroll-to-top on route change** — reported symptom: some pages open scrolled mid-content with the top
  bar out of view (React Router preserves scroll position between routes). A `ScrollToTop` behavior in
  `App.js` resets `window.scrollTo(0, 0)` on `pathname` change (hash anchors respected; instant, no smooth
  scroll — `prefers-reduced-motion`-safe).
- `PageActionBar` is **sticky under the AppBar on every page** (`top: { xs: 56, sm: 64 }`) — visible at page
  open and reachable while scrolling. Pages must not introduce their own scroll containers that break
  stickiness.

### 3.7 Formatters (finance app — one way to write money)

`utils/formatters.js` becomes the only source: `displayDate()` (kill the 14+ local `formatDate`) and a new
`formatCurrency()` → French locale `1 234,50 €` everywhere. Server-shaped strings stay server-side (fat
backend unchanged); this is pure presentational formatting.

### 3.8 Reference deliverables

- **`specs/DESIGN-SYSTEM.md`** — the versioned reference: tokens table, typography roles, spacing scale,
  component catalogue with usage rules, do/don't. CLAUDE.md §7 updated to point at it.
- **`/design` page** (admin-only route) — live showcase: token swatches, type specimens, every generic
  component in its states (loading/empty/error/toast/chips/dialogs/table). The page consumes the real theme
  and real components — drift becomes visible immediately.

### 3.9 Phased delivery (one spec + one PR per phase)

| Phase | Branch | Content | Size |
|---|---|---|---|
| **1 — Fondations & thème** | `feature/ds-theme-maison` | New `theme.js` (palette §3.1 + variants §3.2 + fonts), `ScrollToTop` on route change (§3.6), quick bug batch (ZONE_COLORS conflict, `#1976d2`→`primary.main` ×18, DevisPage alert bug, dead components), `formatCurrency`/`displayDate` centralization (§3.7), `/design` v1 (tokens+type) | M |
| **2 — Composants** | `feature/ds-components` | §3.3 new generics + fixes (fullScreen dialogs, scaffold swap, ErrorBoundary, NotFound), `/design` v2 (catalogue), `specs/DESIGN-SYSTEM.md` | M/L |
| **3 — Sweep Réglages & admin** | `fix/ds-sweep-settings` | Settings*, PaymentsSettings, EmailTemplates, UserManagement, LinenStock, PlatformAccounts → PageActionBar + states + toasts + tokens + mobile tables | M |
| **4 — Sweep Finance** | `fix/ds-sweep-finance` | Finance, Accounting, TouristTax, Devis → same + KPI cards on `kpiValue`/`kpiLabel` | M |
| **5 — Sweep Planning & Dashboard** | `fix/ds-sweep-planning` | Dashboard, Planning, Calendar, ResourcePlanning, ReservationsUpcoming + the calendar/planning hex→token sweep (CalendarDayCell, ReservationCard, MiniDayPlanner, SAS dialog) + App shell (AppBar/Drawer) | L |
| **6 — Sweep Réservations & fiches** | `fix/ds-sweep-reservations` | Reservation, Clients, Properties, PropertyDetail (worst page: hand-rolled header, raw dialog, 1418 LOC), PropertyPricingSeasons, SchoolHolidays, EstablishmentClosures, Login/ForcedPasswordChange | L |

**Per-page done-criteria (every sweep):** PageActionBar (or explicit exemption) with **all page actions in
the bar, canonical icons/order/tooltips (§3.4)** · `LoadingState`/`EmptyState`/`ErrorAlert` wired (no silent
fetch errors) · toasts via `useToast` · zero new inline hex/rgba (existing ones migrated to
tokens/`alpha()`) · typography via role variants · **tables follow §3.5 (numeric right + `tabular-nums`,
header aligns with body, « — » for empty cells)** + scroll-contained + cards on xs where lists are
operator-critical · dialogs fullScreen on xs · spacing on the blessed scale · **page opens at the top with
the bar visible (§3.6)** · `useDirtyFormGuard` on save-flow pages.

**Edge cases:**
- Dense calendar/planning cells may keep raw `fontSize` numbers where MUI variants are impractical — but
  colors must come from tokens.
- `PlatformColorPicker` presets are legitimate hex (it's a color picker).
- Devis **PDFs** and **emails** keep their own styling (documents, not app UI).

---

## 4. Architecture

> **Fat backend, thin frontend — unaffected.** This program is 100 % client-side presentation. No endpoint,
> no payload, no business logic changes. The only server-adjacent note: `/design` is a client route gated by
> the existing admin role (client-side gating is acceptable — it exposes no data, only component specimens).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| — | — | — | **No server change in any phase.** |

### 4.2 Client side (`client/src/`) — per phase, detailed in each phase spec

| Layer | Files | Phase | Responsibility |
|---|---|---|---|
| `styles/` | `theme.js` | 1 | Palette « Maison », typography role variants, radius/shadows, component overrides. |
| deps | `@fontsource/source-serif-4` | 1 | Self-hosted serif (woff2). |
| `utils/` | `formatters.js` | 1 | `formatCurrency`, `displayDate` as the only formatters. |
| `constants/` | `schoolHolidayZoneColors.js`, `calendarVisuals.js` | 1 | Resolve the ZONE_COLORS conflict (constants file wins). |
| `components/` | `LoadingState`, `EmptyState`, `ErrorAlert`, `UnsavedChangesDialog`, `PlatformChip`, `ResponsiveTable`; fixes to `FormDialog`, `ConfirmDialog`, `DialogProvider` (+`useToast`), `DataPageScaffold`, `StatusBadge`; delete 4 dead files | 2 | The consolidated library. |
| `pages/` | `DesignPage.js` (`/design`) | 1–2 | Living showcase. |
| `App.js` | shell | 1, 2, 5 | ScrollToTop on route change (1); ErrorBoundary + NotFound (2); AppBar/Drawer tokens (5). |
| `pages/*` | all 28 + Login + ForcedPasswordChange | 3–6 | Block sweeps per §3.9. |

**Component reuse declaration:** phases 3-6 consume only phase-1/2 generics; any new generic discovered
mid-sweep is added to the library + `/design` + DESIGN-SYSTEM.md in the same PR.

### 4.3 API contract

Unchanged — no endpoint added or modified in any phase.

---

## 5. Data model

No schema change, no migration, in any phase.

## 6. UI / UX

Direction « Maison » as per the mockup ([artifact](https://claude.ai/code/artifact/479a7c6b-e311-4c76-8b8e-537108490580),
section C) — tokens in §3.1/§3.2. Key UX rules:

- **Responsive is non-negotiable** (CLAUDE.md §7): every swept page re-verified at xs/md/lg; dialogs
  fullScreen on xs; tables cards-on-xs for operator-critical lists; touch targets ≥44px (sweeps must check
  the dense calendar surfaces the audit flagged as unverified).
- French copy conventions unified during sweeps: save verb = « Enregistrer », add = « Ajouter » (+ noun),
  the two unsaved-changes wordings merge (§3.3).
- `/design`: sections Tokens · Typographie · Couleurs sémantiques · Composants (each with its states) ·
  Formats (monnaie, dates). Admin-only nav entry under Réglages.

## 7. Test plan

Per phase (details in phase specs):

- **Phase 1:** vitest snapshots/assertions touching colors/typography updated; new unit tests for
  `formatCurrency`; full client vitest + Playwright E2E green (E2E asserts structure/text, not colors — must
  stay green unmodified).
- **Phase 2:** component render tests for each new generic (states, fullScreen-on-xs via viewport mock,
  toast API); ErrorBoundary + NotFound tests.
- **Phases 3-6:** per-block — existing page tests updated, at least one mobile-viewport E2E check per block,
  manual 3-breakpoint pass per page, regression on adjacent features.

## 8. Out of scope

- **Dark mode** — tokens make it cheap later; not in this program.
- **WordPress public blocks** (`integrations/wordpress/guestflow-booking/`) — guest-facing surface, separate
  harmonization project once the app DS is stable.
- **Devis PDF templates & email templates** — documents, own styling.
- **New features** — sweeps change presentation only; any behavior change found mid-sweep gets its own spec.

## 9. Open questions

- **Resolved 2026-07-03 (AskUserQuestion):** scope full/phased · doc+showcase · sweep by blocks · refresh.
- **Resolved 2026-07-06 (AskUserQuestion):** direction **C · Maison** (over Continuité and Épuré).
- **Serif face:** spec proposes Source Serif 4 (`@fontsource`, self-hosted). Swappable in phase 1 review if
  the rendered result disappoints — one token.
- **Per-phase open questions** live in each phase spec.
