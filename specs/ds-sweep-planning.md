# DS Phase 5 — Sweep Planning, Dashboard, Calendrier & App shell

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/ds-sweep-planning` |
| **Created** | 2026-07-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Umbrella** | [design-system.md](design-system.md) — phase 5 of 6 |
| **Reference** | [design-system-reference.md](design-system-reference.md) |

---

## 1. Context

Third block sweep — the operational day-to-day surface: `Dashboard` (`/`), `PlanningPage`
(`/planning`), `CalendarPage` (`/calendar`), `ResourcePlanningPage`, `ReservationsUpcomingPage`,
the calendar/planning component family (`CalendarDayCell`, `CalendarMonthGrid`, `CalendarToolbar`,
`CalendarWeekView`, `CalendarNoteDialog`, `CumulativeMonthCalendar`, `MiniDayPlanner`,
`MiniPlanningStrip`, `ReservationCard`, `sas/ReservationSasDialog`) and the **App shell** (`App.js`
AppBar/Drawer).

Block audit (2026-07-16, file:line evidence, current tree incl. #335):

- **Zero generics adoption on all 5 pages.** None uses `PageActionBar`, `LoadingState`,
  `EmptyState`, `ErrorAlert`, `ResponsiveTable`, `StatusBadge` or `PlatformChip` — all five still
  render the legacy `PageHeader`, raw `LinearProgress`, raw empty `Typography`.
- **Silent failures everywhere:** Dashboard's `loadDashboardData` has **no try/catch at all**
  (`:65-96` — a rejection leaves `loading` stuck); PlanningPage's primary loads unguarded
  (`:444-466`); CalendarPage occupied-dates/closures catches only `console.error` (`:89-102` — the
  original phase-1 audit finding, still present) and the page has **no loading indicator at all**;
  ResourcePlanning + Upcoming swallow load errors into empty states.
- **Silent saves:** Dashboard ready/check-in toggles (`:41-56`), Planning `handleToggleReady`
  (`:633`), Calendar note save/delete (`:319-335`), ResourcePlanning booking save/delete
  (`:191-205`), Upcoming ready toggle (`:67-74`), SAS commit error inline-only (`:455-459`).
- **Rule-4 color hotspots** (calendar surface = biggest hex offender in the app):
  `CalendarDayCell` ~27 literals (incl. drag `#42a5f5`, border `#e0e0e0`, many
  `rgba(255,255,255,…)`/`rgba(0,0,0,…)` overlays); `ReservationSasDialog` 10 (MODE_COLOR
  `#ef6c00`/`#455a64`, hex-alpha suffix trick `` `${color}1A` ``); `ReservationCard` 9 (bed-chip
  palette `#1565c0/#6a1b9a/#e65100`, `ARRIVAL_BG = orange[50]` MUI import, alert rgba);
  `MiniDayPlanner` 9 (occupied/turnover reds unmigrated; selection path already on
  tokens/`alpha` ✓); ResourcePlanning grid 8 (`#00897b`/`#388e3c` bookings, cleaning rgba);
  `MiniPlanningStrip` 7 (`EMPTY_DAY_COLOR #f5f5f5`, shadows); Dashboard 6 (KPI icon `#f57c00`,
  hover shadows); `CumulativeMonthCalendar` 4 (`CLOSURE_COLOR #9e9e9e`); PlanningPage 5 (alert
  rgba trio `:438-440`); App shell 2 (AppBar `bgcolor:'white'` + `borderBottom '#e0e0e0'` `:787`).
- **Invalid-token bug:** `CalendarWeekView:128` uses `primary.lighter` — **not a token that
  exists** → resolves `undefined`, today's row tint silently missing.
- **KPI cards:** Dashboard's 3 stat cards render figures on raw `h4` + `subtitle2` labels
  (`:143-180`) with one hardcoded orange icon — the exact `kpiValue`/`kpiLabel` adoption phase 4
  did for Finance.
- **Money escapees:** Dashboard `` `Manquant ${remaining}€` `` (`:283,:287,:347`);
  `ReservationCard` `toFixed(2)+'€'` (`:348,:365`) — inconsistent with the SAS dialog which uses
  `formatCurrency` for the same amounts ✓.
- **Structural scroll blockers (§3.6 umbrella):** PlanningPage is `height:100vh` + inner
  `overflowY:auto` container with the infinite-scroll listener bound to it (`:659,:700-708`);
  ResourcePlanning wraps everything in `overflow:hidden` + inner grid scroll (`:219,:303`). Both
  break sticky-bar/page-opens-at-top.
- **Dialog:** `CalendarNoteDialog` has no fullScreen-on-xs and maps 1:1 to `FormDialog`.
- **Already compliant (preserve):** `ScrollToTop`/`RouteErrorBoundary`/NotFound in App.js; Drawer
  tokens; ZONE_COLORS single-sourced in `constants/schoolHolidayZoneColors.js`; SAS dialog
  fullScreen-on-xs + `formatCurrency`/`displayDateLong`; `getPlatformColor` routing (guarded by
  `calendar-platform-colors.test.js`); CalendarPage contains **no dead reservation dialog**
  (confirmed — all create/edit navigates to ReservationPage).

## 2. Goal

Every operational page satisfies the umbrella done-criteria — sticky canonical bars with **all page
actions in the bar**, real loading/empty/error states (no silent fetch), toasts on failures,
tokens-only colors on the whole calendar surface, `kpiValue`/`kpiLabel` Dashboard tiles,
`formatCurrency` everywhere, pages opening at the top with the bar visible — **without changing any
business behavior, figure, or calendar geometry**.

## 3. Functional rules

### 3.1 Headers → sticky `PageActionBar` (all 5 pages)

1. **Dashboard** — bar title « Tableau de bord ». The date cluster (prev/next arrows + date picker
   + « Aujourd'hui ») moves to the bar `center` on `sm+`; on `xs` it renders as a compact strip
   directly under the bar (phase-3 tabs pattern — `center` is hidden on xs).
2. **PlanningPage** — bar title « Planning ». Same date-cluster treatment (prev/next + date +
   « Aujourd'hui » in `center`, xs strip under the bar).
3. **CalendarPage** — bar title « Calendrier ». `CalendarToolbar`'s controls split: month prev/next
   + « Aujourd'hui » become bar actions; the property `Select` + view toggle (« Vue logements » /
   vue mensuelle) go to `center` (xs: strip under the bar). The cleaning/zones legend stays
   content-local (informational, next to the grid). `CalendarToolbar.js` is absorbed/reshaped
   accordingly.
4. **ResourcePlanningPage** — bar title « Planning ressources ». Resource `Select` + week prev/next
   → `center`/strip; **« Nouvelle réservation » becomes the bar CTA** (labeled button, like
   DataPageScaffold's).
5. **ReservationsUpcomingPage** — bar title « Réservations à venir » (subtitle preserved via
   `subtitle`).
5b. **Bars never empty on xs** (implemented addition): `PageActionBar` gained a `titleOnXs` prop —
   the title also renders (ellipsized) on xs. All 5 swept pages set it; without it, pages whose
   actions live in the hidden `center` showed a bare white strip on mobile.

### 3.2 Scroll structure (§3.6 umbrella — bar visible, page opens at top)

6. **PlanningPage drops its own scroll container**: the page becomes normally-flowing content
   scrolled by the window; the infinite-scroll listener rebinds to `window`. No `height:100vh`.
7. **ResourcePlanningPage**: the outer `overflow:hidden` wrapper goes away so the bar sticks and
   the page scrolls normally; the **2D booking grid keeps its own contained scroll** (a
   wide+tall grid is intrinsically a scrollable panel — documented exemption).
8. **CalendarMonthGrid** keeps its internal `calc(100vh - …)` grid scroll (calendar idiom,
   documented exemption) — the bar above it is sticky and the page opens at top.

### 3.3 States (no silent failures)

9. Every page wires `LoadingState` (skeleton or spinner) / `EmptyState` / `ErrorAlert` with retry
   (reload-nonce pattern): Dashboard `loadDashboardData` gets try/catch; PlanningPage guards its
   primary loads; CalendarPage surfaces occupied/closures failures (an `ErrorAlert` above the grid
   — the calendar itself still renders) and gets a loading indicator; ResourcePlanning + Upcoming
   stop mapping failure → empty.
10. Secondary/enrichment fetches (public holidays, devis overlay, summaries) may stay
    silent-degrading **only** when their absence is cosmetic; each such catch gets a one-line
    comment saying so.

### 3.4 Feedback policy (toasts)

11. **Failure toasts on every optimistic toggle** (ready/check-in/option/breakfast/resource
    toggles): revert + `showError`. No success toast for instant checkbox toggles (too chatty —
    the state change is the feedback).
12. **Success + failure toasts on dialog-level saves**: calendar note save/delete, resource
    booking create/update/delete. SAS commit failure → `showError` (kept inline too in the
    fullscreen dialog); SAS success stays silent (the dialog closes + list refreshes = feedback).

### 3.5 Colors → tokens (the calendar hex sweep)

13. All rule-4 literals listed in §1 migrate to theme tokens or `alpha(theme.palette.…)`:
    white-on-colored → `common.white`; overlay rgba blacks/whites → `alpha('#000'|common.white,…)`
    equivalents from the theme; drag highlight `#42a5f5` → `primary` tint; borders `#e0e0e0` →
    `divider`; Dashboard KPI icon `#f57c00` → `warning.main`; ResourcePlanning booking teal/green →
    tokenized pair; `CLOSURE_COLOR #9e9e9e` → grey token; SAS `MODE_COLOR` → `warning`-family
    (arrivée) / neutral grey (départ) tokens; hex-alpha suffix trick → `alpha()`.
14. **Domain-hex constants stay sanctioned** in their single-source files:
    `constants/schoolHolidayZoneColors.js` (zones A/B/C) and `utils/calendarVisuals.js`
    (`CLEANING_COLOR`, `BLOCKED_NIGHT_COLOR`) — same values, single source, documented. Components
    must consume the constants, never re-declare the hex (MiniPlanningStrip's re-declared
    `BLOCKED_NIGHT_COLOR` → now imported). **Implemented note:** MiniPlanningStrip's
    `EMPTY_DAY_COLOR` + the `textColor: '#fff'` returns stay module-local — they live inside
    `buildMiniStripDayGradient`, a PURE function pinned by `calendar-platform-colors.test.js`
    which cannot read the theme.
15. **Fix the `primary.lighter` bug** (`CalendarWeekView:128`): today's row tint →
    `alpha(theme.palette.primary.main, 0.08)`.
16. `ReservationCard`: `ARRIVAL_BG` (MUI `orange[50]` import) → `warning.soft` (warm « Maison »
    sand); alert/done rgba → `alpha()` of semantic tokens. **Implemented deviation:** the bed chips
    went **neutral** (paper bg + divider border, `text.primary`) rather than soft *semantic* tokens
    — blue/purple/orange were decorative, and semantic colors are reserved for status; the bed
    SHAPES (wide/narrow icon, BÉBÉ label) carry the distinction. **Platform badge keeps routing
    through `getPlatformColor`** (guard test).
17. Dense-cell `fontSize` raw numbers stay (umbrella edge case) — colors only.

### 3.6 Typography

18. Dashboard KPI cards → **neutral « Maison » tiles** (phase-4 precedent, decided 2026-07-16):
    white card, `kpiLabel` muted label, `kpiValue` tabular figure, thin semantic left accent;
    icons kept, tinted with the accent color.
19. Section headers → `sectionHeader`: Dashboard (`:188,:217,:304`), Planning day-headers
    (`:775`), Upcoming day-headers (`:100`), CumulativeMonthCalendar sticky month label (`:186`).
20. SAS dialog internal headings: **full sweep** (decided 2026-07-16, AskUserQuestion) — internal
    `h3/h4/h6/subtitle*` migrate to role variants (`sectionHeader` for step/section titles,
    `kpiValue` for the big amount figures) with `component=` overrides where heading semantics
    must not change; visual size kept close to current (dialog legibility in the field).

### 3.7 Money & dates

21. Dashboard raw `€` strings (`:283,:287,:347`) → `formatCurrency`; `ReservationCard`
    `toFixed(2)+'€'` (`:348,:365`) → `formatCurrency`. Deliberate contextual date formats (week
    labels) stay.

### 3.8 Tables

22. Dashboard arrivals/departures tables (operator-critical) → `ResponsiveTable` with xs cards;
    money columns right-aligned + `tabular-nums`; « — » for empty money cells.

### 3.9 Dialogs

23. `CalendarNoteDialog` → `FormDialog` (fullScreen-on-xs inherited, canonical buttons).
    **Implemented:** `FormDialog` gained an optional `secondaryAction` slot (ReactNode rendered
    start-aligned in the actions row) — the note dialog's « Supprimer » rides it; reusable by any
    future form dialog with a destructive side action.

### 3.10 App shell (App.js)

24. AppBar `bgcolor:'white'` → `background.paper`; `borderBottom '#e0e0e0'` → `divider`.
25. « GuestFlow » wordmark → **serif « Maison »** (decided 2026-07-16, AskUserQuestion): Source
    Serif 4, keeps `primary.main` color and current size — completes the identity with the page
    titles.
26. Drawer/sidebar untouched (already tokens). `ForcedPasswordChange` styling deferred to phase 6
    (its page belongs to the Réservations/auth block per umbrella §3.9).

### 3.11 Spacing

27. Off-scale values on swept files → blessed scale {0.5, 1, 1.5, 2, 3} (`0.75`→`1` or `0.5`,
    `1.25`→`1` or `1.5`, `2.5`→`2` or `3`, `0.25`→`0.5`, `0.375`→`0.5`), except intrinsic dense-cell
    geometry where a raw px value is already the idiom.

**Edge cases:**
- No computed figure, occupancy math, drag-and-drop behavior, or calendar geometry changes.
- `calendar-platform-colors.test.js` guard (no direct `PLATFORM_COLORS[…]` outside
  `constants/platforms.js`) and the MUI-9 Stack-props guard must stay green.
- R12 dirty-form guard: N/A on the whole block (no page-level save form).

---

## 4. Architecture

> **Fat backend, thin frontend — unaffected.** No endpoint, payload or business-logic change.

### 4.1 Server side — no change.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| shell | `App.js` | T | AppBar tokens (§3.10); wordmark per §9. |
| pages | `Dashboard.js` | T | Bar+date center, KPI « Maison » tiles, states, toasts, ResponsiveTable, formatCurrency, tokens. |
| pages | `PlanningPage.js` | T | Bar+date center, window scroll + infinite-scroll rebind, states, failure toasts, alert rgba→alpha, sectionHeader. |
| pages | `CalendarPage.js` | T | Bar (toolbar split), loading/error surfacing, note toasts. |
| pages | `ResourcePlanningPage.js` | T | Bar + CTA « Nouvelle réservation », scroll fix, states, toasts, grid colors→tokens. |
| pages | `ReservationsUpcomingPage.js` | T | Bar, states, failure toast, tokens, sectionHeader. |
| components | `CalendarToolbar.js` | T | Controls migrate into the bar/center; legend stays. |
| components | `CalendarDayCell.js` | T | ~27 color literals → tokens/`alpha` (geometry untouched). |
| components | `CalendarMonthGrid.js` | T | `common.white`; contained scroll documented. |
| components | `CalendarWeekView.js` | T | `primary.lighter` bugfix, `#d32f2f`/`#bdbdbd` → tokens. |
| components | `CalendarNoteDialog.js` | T | → `FormDialog`. |
| components | `CumulativeMonthCalendar.js` | T | CLOSURE_COLOR + rgba → tokens; LoadingState/EmptyState; sectionHeader label. |
| components | `MiniDayPlanner.js` | T | Occupied/turnover reds → tokens/`alpha` (selection path already ✓). |
| components | `MiniPlanningStrip.js` | T | Constants imported (not re-declared), `#fff`/shadows → tokens. |
| components | `ReservationCard.js` | T | Bed-chips/ARRIVAL_BG/alerts → soft tokens; `formatCurrency`. |
| components | `sas/ReservationSasDialog.js` | T | Colors→tokens, commit `showError`, inline errors → `ErrorAlert`, `LoadingState`; typography per §9. |

**Component reuse declaration:** consumes phase-1/2 generics only (`PageActionBar`, `LoadingState`,
`EmptyState`, `ErrorAlert`, `ResponsiveTable`, `FormDialog`, `useToast`, variants, `formatCurrency*`,
`alpha` tokens). No new generic expected; if the xs date-strip pattern proves reusable across
Dashboard/Planning/Calendar it may be extracted as a small `BarCenterStrip` helper (declared here).

### 4.3 API contract — unchanged.

## 5. Data model — none.

## 6. UI / UX

- Bars sticky under the AppBar on all 5 pages; date/select clusters centered on `sm+`, compact
  strip under the bar on `xs`; pages open at the top.
- Dashboard KPI tiles switch to the neutral « Maison » look (consistent with Finance).
- Calendar/planning visuals keep their recognizable colors (zones, cleaning red, blocked orange,
  platform colors) — only ad-hoc literals move to tokens; no layout/geometry change.
- Mobile: Dashboard arrivals/departures become cards on xs; Planning/Upcoming keep their card
  lists; ResourcePlanning grid scrolls inside its panel; touch targets ≥44px on bar controls.

## 7. Test plan

### Client unit tests (vitest)
- [x] Existing component suites green: `ReservationCard.test.js` (34 — 3 money assertions updated
  to the canonical `45,00 €` formatCurrency output), `DepartureMiniRow.test.js`,
  `CalendarWeekView.test.js`, `CumulativeMonthCalendar(.mobile).test.js`,
  `ReservationSasDialog.test.js` (render helper wrapped in ThemeProvider + DialogProvider — the
  dialog now uses `useToast` + role variants), `calendar-platform-colors.test.js` (guard),
  `mui9-stack-props` guard, `calendarVisuals.test.js`.
- [x] New: `Dashboard.test.js` (3) — KPI tiles via `kpiLabel`/`kpiValue` (P elements, not
  headings), rejected loader → retryable `ErrorAlert`, initial load → `LoadingState`.
- [x] New: `ReservationsUpcomingPage.test.js` (2) — load failure → `ErrorAlert` (NOT the empty
  state); real empty → `EmptyState`.
- [x] New: `CalendarNoteDialog.test.js` (4) — FormDialog actions, « Supprimer » gated on
  `hasNote`, length cap.
- [x] Full suite green — **648 tests / 87 files** (+9 / +3 files vs phase 4).

### E2E (Playwright)
- [x] Full suite green — **31 passed** (+1 pre-existing conditional skip). New mobile smoke
  `mobile/planning-mobile.spec.js`: `/planning` at 390px — bar title visible on arrival
  (titleOnXs), visible date strip, no horizontal page scroll, bar still visible after window
  scroll. `auth/sidebar-navigation.spec.js` updated for the « Calendrier » retitle (rule 3).

### Manual UI verification (2026-07-16, Playwright browser)
- [x] `/`, `/planning`, `/calendar` (overview + per-property grid) verified at 390px + 1280px —
  bars sticky, pages open at top, **console clean (0 error / 0 warning)** after fixing two
  surfaced leaks: `OptionDayCard` Checkbox `inputProps` → `slotProps.input` (MUI 9 DOM-prop leak,
  pre-existing) and the Calendar `Select` transient out-of-range warning on deep links.
- [x] Per-property grid: gradients/closures/férié/zone dots intact; today framed primary.
- [x] Dashboard: KPI tiles + date strip on xs; arrivals/departures as cards on xs (ResponsiveTable).

## 10. Implementation notes (2026-07-16)

Presentation-only sweep — no business behavior, figure, or calendar geometry change. Deviations are
cross-linked in the rules above (5b, 14, 16, 23); additional notes:
- **`PageActionBar.titleOnXs`** (rule 5b) and **`FormDialog.secondaryAction`** (rule 23) are the
  two generic-library extensions this phase adds (amends §4.2's "no new generic expected").
- **CumulativeMonthCalendar keeps two micro-indicators as-is** (documented): the 18px in-flight
  spinner beside « Aujourd'hui » (background activity, not a section load) and the per-month
  « Aucune réservation. » caption (an EmptyState per empty month inside the infinite scroll would
  be heavier than useful).
- **PlanningPage `getAlertColor` deleted** — dead code (defined, never called).
- **Dashboard's « Arrivées & Départs » combined header removed** — its date cluster moved to the
  bar; the two per-table `sectionHeader`s carry the labels.
- SAS `MODE_COLOR` → `warning.main` (arrivée) / `info.main` (départ); its typography sweep maps:
  hero client name → `pageTitle` (component=p), portal code → `kpiValue`, recap headings →
  `sectionHeader`, totals stay bold sans (amounts never serif).

## 8. Out of scope

- `Login` / `ForcedPasswordChange` (phase 6), Réservations/Clients/Properties fiches (phase 6),
  `PricingSummary`, `PlatformPriceCard` (phase 6).
- Devis PDFs / emails (documents, not app UI).
- Any server change; any calendar geometry/drag behavior change.

## 9. Open questions

- **Resolved 2026-07-16 (AskUserQuestion): wordmark → serif « Maison »** (Source Serif 4, keeps
  color/size) — rule 25.
- **Resolved 2026-07-16 (AskUserQuestion): SAS dialog → full sweep** — colors + states + toasts +
  internal typography to role variants — rule 20.
- **Resolved 2026-07-16 (AskUserQuestion): spec approved, direct implementation** (no intermediate
  plan step), phase-4 pattern.
