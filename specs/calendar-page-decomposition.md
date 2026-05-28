# CalendarPage — structural decomposition (thin, render-only)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/calendar-page-decomposition` _(Claude-managed)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 3 — Réservations & Calendar (remainder). See `specs/ROADMAP.md`. |

---

## 1. Context

`CalendarPage.js` is **1255 LOC** in a single component. The roadmap flagged it as the worst
thin-frontend offender because of a **client-side pricing engine** (`recalcPrice` + deposit/balance
auto-calc) — but that engine was **already removed** with the dead reservation dialog
([[calendar-reservation-dialog-dead]] / `specs/calendar-dead-dialog-removal.md`). What remains today is
**legitimately presentational** but **structurally unmanageable**:

- **Pure helpers** at module top (date/percent/color/name math): `getDaysInMonth`, `formatDate`,
  `shiftDate`, `timeToHour`, `hourToPercent`, `getReservationColor`, `getBlockedNightInfo`,
  `compactName`, `resHasMidDays`, plus colour constants.
- **Infinite-scroll month machine** (~290 LOC): `months` state, 9 refs, 4 `useLayoutEffect`/`useEffect`
  for scroll-position maintenance / focus scroll / auto-preload, `prependMonth`, `appendMonth`,
  `handleScroll`, `scrollToToday`.
- **Data loading**: `loadProperties`, `loadOverviewReservations`, `loadCalendarData`,
  `loadSchoolHolidays` (reservations, devis, notes, occupied dates, closures, school holidays).
- **Drag-to-select interaction**: `handleMouseDown/Enter/Up`, conflict messages (over server-fetched
  `occupiedDates`), `openNewReservation`.
- **`renderDayCell` — ~400 LOC**: the intricate per-day rendering (diagonal check-in/check-out/cleaning
  gradients, blocked-night zones, devis overlays, compact name labels, click-zone hit-testing,
  holiday/zone indicators, calendar notes).
- **Month-grid assembly** (~100 LOC IIFE): cells → weeks/rows → vertical month labels + sticky header.

Confirmed findings:
- **`PRICE_TYPE_LABELS` is dead** (defined, never referenced) — left over from the removed dialog.
- The server is **already the source of truth** for availability: the page consumes
  `api.getOccupiedDates`, `api.getReservations`, `api.getEstablishmentClosures`, `api.getSchoolHolidays`.
  The remaining conflict derivation is **real-time drag feedback** over that server data (per-mouseover
  clamping) — correctly client-side; turning it into per-mouseover API calls would be wrong.
- **No money/correctness logic remains** on the client (no deposit/balance/tax/total computation).

So this is primarily a **client readability/maintainability refactor** — the backend already owns the
data and the money. We split the monolith into a thin orchestrator page + focused, page-specific
calendar components + one pure util + one hook, with **zero behavior or visual change**. We also take the
one remaining client-side **computation** off the client: the French public-holiday dates move to a
server endpoint (both consumers fetch it), per the fat-backend rule.

## 2. Goal

The calendar looks and behaves **exactly** as today, but `CalendarPage.js` becomes a thin orchestrator
(~450 LOC) that wires data + a month-scroll hook + small focused components, so the calendar is
maintainable and each visual concern lives in one place.

## 3. Functional rules

1. **No behavior change, no visual change.** Every interaction (drag-to-select with obstacle clamping,
   reservation/devis click zones, blocked-night/cleaning gradients, infinite scroll prepend/append,
   deep-link focus from the dashboard, today button, notes create/edit/delete, holiday/zone indicators,
   overview mode) renders and behaves byte-for-byte as today.
2. **Pure relocation.** Logic moves **verbatim** into its new home (util / hook / component). No rule is
   rewritten; the gradient/hit-testing math is moved unchanged (same approach as the devis PDF
   extraction).
3. **Pure helpers → `utils/calendarVisuals.js`** (date/percent/color/name math). Unit-tested.
4. **Infinite-scroll month management → `hooks/useInfiniteMonthScroll.js`** — owns `months`, refs,
   scroll/preload/focus effects; exposes `{ months, scrollRef, handleScroll, prependMonth, appendMonth,
   scrollToToday, focusOnMonth, resetForProperty }`.
5. **Rendering split into page-specific components**: `CalendarToolbar`, `CalendarDayCell`,
   `CalendarMonthGrid`, `CalendarNoteDialog`. They are **feature-local** (calendar-specific), not generic
   library components (justified in §4.2).
6. **Data loading + drag selection stay in the page** (orchestration): the page owns data state +
   loaders and the drag handlers, passing data + callbacks down. (Limits coupling / regression surface;
   these are not extracted in this spec.)
7. **Remove dead code**: delete the unused `PRICE_TYPE_LABELS` constant.
8. **Public holidays move server-side.** The French public-holiday **computation**
   (`getFrenchPublicHolidays`, Meeus/Jones/Butcher Easter algorithm) moves to a server util behind a new
   `GET /api/public-holidays?years=…` endpoint. Both client consumers (`CalendarPage` and
   `PropertyPricingSeasonsPage`) **fetch** the holidays instead of computing them; the client
   computation is deleted. `getSchoolHolidayInfo` **stays client-side** — it is a render-time membership
   lookup over already-server-fetched school-holiday ranges (same rationale as the drag-clamp lookup over
   `occupiedDates`), not a computation. The "férié" indicator renders identically (still a set of
   `YYYY-MM-DD` strings, now server-sourced).
9. **Responsive parity**: the existing `xs`/`sm` breakpoints (full-width toolbar controls, calendar min
   width + horizontal scroll, viewport-height scroll area) are preserved exactly in the extracted
   components.

**Edge cases (all preserved):**
- Drag selection clamps at the first occupied day / existing arrival, forward **and** backward → same
  conflict alert copy.
- Departure-only / arrival-only / mid-stay / blocked-night (early-arrival, late-departure-morning,
  late-departure-evening) gradient stops identical.
- Devis overlay (faded grey, diagonal for arrival/departure) only when no reservation on that day.
- Closure days (hatched, tooltip) and calendar notes (right-click) unchanged.
- Deep-link params (`propertyId`, `year`/`month`, `focusStartDate`/`focusEndDate`, `reservationId`) and
  the `window.pendingReservationId` hand-off still focus + open correctly.

---

## 4. Architecture

> **Fat backend, thin frontend.** The backend already owns all data + money for this view. This spec
> additionally moves the one remaining client-side **computation** (public-holiday dates) to the server.
> The client logic that remains (drag clamping over server `occupiedDates`, the `getSchoolHolidayInfo`
> membership lookup over server data, gradient drawing, grid assembly) is **pure rendering / interaction**
> and is justified as such.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `frenchHolidays.js` | C | Pure `getFrenchPublicHolidays(year)` (Easter algo + fixed dates) → array of `{ date: 'YYYY-MM-DD', label }`. Moved verbatim from the client. Unit-tested. |
| `controllers/` | `publicHolidaysController.js` | C | `list(req,res)` — parse/validate `?years=` (CSV of integers, sane range + count cap), call the util per year, return the flat array. |
| `routes/` | `publicHolidays.js` | C | Thin: `GET /` → `controller.list`. Mirrors the clean `schoolHolidays.js` route. |
| `index.js` | `index.js` | T | Mount `app.use('/api/public-holidays', requireAuth, publicHolidaysRouter)` (auth like the other `/api` routes). |
| `database.js` | — | — | **No migration** — holidays are computed, not stored. |
| `tests/` | `french-holidays.unit.test.js` | C | Verify fixed holidays + Easter-derived dates (Lundi de Pâques / Ascension / Pentecôte) for known years (e.g. 2024, 2025). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `CalendarPage.js` | T | **Thin orchestrator**: data state + loaders (incl. fetching public holidays for the visible years), drag-selection state + handlers, navigation/deep-link, wiring `useInfiniteMonthScroll` + the calendar components + the note dialog. ~1255 → ~450 LOC. |
| `utils/` | `calendarVisuals.js` | C | Pure helpers: `getDaysInMonth`, `formatDate`, `shiftDate`, `timeToHour`, `hourToPercent`, `getReservationColor`, `getBlockedNightInfo`, `compactName`, `resHasMidDays` + colour/zone/day-range constants. No React. Unit-tested. |
| `hooks/` | `useInfiniteMonthScroll.js` | C | Owns the `months` list + scroll/preload/focus machinery (refs + layout effects). Returns the months + scroll handlers + imperative `focusOnMonth`/`resetForProperty`. |
| `components/` | `CalendarToolbar.js` | C | Property selector + month-nav buttons (prev/next/today) + legend (cleaning chip, zone dots). Pure presentational. |
| `components/` | `CalendarDayCell.js` | C | **Verbatim** move of `renderDayCell` (+ `renderHolidayIndicators`, `renderNoteLabel`, click-zone hit-testing, gradient stops). Props: day data, reservations/devis/closures/notes/holidays for that day, `inDrag`, `cleaningHours`, `today`, and the interaction callbacks. |
| `components/` | `CalendarMonthGrid.js` | C | Sticky day-name header + cells → rows → vertical month-label assembly; scroll container (`scrollRef`, `onScroll`, `onMouseUp`, `onMouseLeave`). Renders cells via a `renderCell(d,y,m,dim)` callback (the page supplies `CalendarDayCell`), keeping grid assembly decoupled from cell internals. |
| `components/` | `CalendarNoteDialog.js` | C | The note add/edit/delete dialog. Props: open/date/text/maxLength + onChange/onSave/onDelete/onClose. |
| `pages/` | `PropertyPricingSeasonsPage.js` | T | Second public-holiday consumer: replace the `getFrenchPublicHolidays` `useMemo` with a fetch of the new endpoint for its displayed years. No other change. |
| `services/` | `api.js` | T | Add `getPublicHolidays(years)` → `GET /api/public-holidays?years=…`. |
| `frenchHolidays.js` | `frenchHolidays.js` | T | **Remove** `getFrenchPublicHolidays` (moved server-side). Keep `getSchoolHolidayInfo` (client lookup over server data). |
| `components/` | `SyncedPropertyMiniCalendars.js` | — | Reused unchanged for overview mode. |
| `components/` | `PageHeader.js` | — | Reused unchanged (see PageActionBar note in §6). |
| `utils/reservationConflicts.js` · `utils/closureCalendar.js` · `utils/navigation.js` | — | Reused unchanged. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageHeader`, `SyncedPropertyMiniCalendars`, `DialogProvider` (`useAppDialogs`) | Pre-existing. |
| **Created (new generic)** | — | None. This refactor creates **page-specific** components only. |
| **Specific (kept feature-local)** | `CalendarToolbar`, `CalendarDayCell`, `CalendarMonthGrid`, `CalendarNoteDialog` | All encode the calendar's bespoke visuals/interaction (diagonal occupancy gradients, infinite-scroll month grid, calendar-note dialog). They are **not** candidates for the shared library — no other page shows this calendar. Kept flat in `components/` with a `Calendar` prefix and a JSDoc header per file. Justified by file size / single-responsibility, not reuse. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/public-holidays?years=2025,2026` | `years` = CSV of integer years | `[{ date: "2025-01-01", label: "Jour de l'An" }, …]` | Auth required (like other `/api`). Invalid/empty `years` → `400`; count capped (e.g. ≤ 20 years). Dates sorted ascending. |

No other endpoint changed or removed.

---

## 5. Data model

No schema change, no migration: public holidays are **computed on demand**, never stored.
No data impact.

## 6. UI / UX

**No visible change** at any breakpoint. The extracted components keep the exact `sx`, `data-*`
attributes (`data-date`, `data-month-anchor`), MUI props, copy, and responsive rules currently inline:
- **xs (≤600px):** toolbar controls full-width and wrapping; calendar area `height: calc(100vh - 290px)`,
  `minWidth: 680` with horizontal scroll; left padding `8px`.
- **sm+ (≥600px):** toolbar inline; calendar `height: calc(100vh - 250px)`; left padding `50px` for the
  vertical month labels.
- French copy unchanged ("Logement", "Vue logements", "Mois précédent/suivant", "Aujourd'hui", "Ménage",
  "Zone A/B/C", "férié", "devis", note dialog labels, conflict alerts).

**PageActionBar:** intentionally **not** introduced here. CalendarPage has no Save/Cancel flow; its
controls are a **filter/navigation toolbar** (property picker + month nav), which `PageActionBar`'s
canonical Save/Cancel model doesn't fit. The page keeps `PageHeader` + the toolbar Card. A future
`PageActionBar` pass (Bloc 3) can revisit this holistically; forcing it now adds risk with no UX gain.

## 7. Test plan

### Server unit tests
- [x] `tests/french-holidays.unit.test.js` (5) — `getFrenchPublicHolidays`: the 8 fixed dates per year +
      the 3 Easter-derived dates for known years (2024: Easter 31 Mar → Lundi de Pâques 1 Apr, Ascension
      9 May, Pentecôte 20 May; 2025: Easter 20 Apr → 21 Apr / 29 May / 9 Jun); count = 11/year; sorted.
- [x] Controller validation exercised via a fake-req smoke + the live route: `200` for valid `years`,
      `400` `MISSING_YEARS`/`INVALID_YEAR` on empty/garbage, `401` unauthenticated (auth-gated). Server
      suite green (**320**).

### Client unit tests
- [x] `utils/calendarVisuals.test.js` (14) — pure helpers: `formatDate`/`shiftDate` (incl. month/year
      rollover), `getDaysInMonth`, `timeToHour`/`hourToPercent` (clamp 0–100, 8h–21h window),
      `compactName` (truncation), `resHasMidDays` (boundary: 1-night, exact month edges),
      `getBlockedNightInfo` (early-arrival → pct band).

### Manual UI verification (browser)
- [x] **Overview mode** (no property): `SyncedPropertyMiniCalendars` renders.
- [x] **Full calendar** (Gite): arrival/departure/mid-stay/cleaning/blocked-night ("arrivée anticipée")
      gradients render identically; closures (hatched: "Fermeture établiss…", "Travaux", "Closed Period");
      holiday "férié" + zone dots; reservation names. **0 console errors.**
- [x] **Public holidays (server-sourced)**: "férié" markers on the correct 2026 days in CalendarPage
      (6 Apr / 1 May / 8 May / 14 May Ascension) **and** `PropertyPricingSeasonsPage` fetches
      `/api/public-holidays?years=2026 → 200` and renders (second consumer regression OK).
- [x] Clean `CI=true` client build (compiled successfully); `0` console errors on both pages.
- [ ] **Not exercised autonomously** (left for the user's pass — interaction/visual at mobile widths):
      drag-to-select clamping forward/backward, split-day click zones, infinite-scroll prepend/append +
      "Aujourd'hui", deep links (`focusStartDate`/`reservationId`), note CRUD, the `xs`/`md` breakpoints.
      The extracted components keep the exact `sx`/`data-*`, and the logic is a verbatim move.

## 8. Out of scope

- **`getSchoolHolidayInfo` server move** — stays client-side (render-time membership lookup over
  server-fetched school-holiday ranges, not a computation). A holistic school-holiday rework belongs to
  Bloc 6.
- **PageActionBar migration** for the calendar (see §6).
- Extracting **data loading** / **drag selection** into their own hooks (kept in the page this round to
  bound regression surface; can be a follow-up if the page still feels heavy).
- Any change to `SyncedPropertyMiniCalendars`, `reservationConflicts`, or the reservation route.

## 9. Open questions

- **Q: Move `getFrenchPublicHolidays` server-side now?** → **A (decided 2026-05-28): yes.** New
  `GET /api/public-holidays?years=…` endpoint; both consumers (`CalendarPage` +
  `PropertyPricingSeasonsPage`) fetch it; the client computation is deleted. `getSchoolHolidayInfo` stays
  client-side (lookup, not computation).
- **Q: `useInfiniteMonthScroll` API surface** — expose imperative `focusOnMonth(year, month)` +
  `resetForProperty()` (proposed) so the page drives focus from URL params / property selection without
  the hook knowing about routing. Confirm during implementation.
