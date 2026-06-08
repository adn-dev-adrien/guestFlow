# Mobile-friendly calendars (reservation week view + mini-calendars)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/calendar-mobile-view` _(Claude-managed)_ |
| **Created** | 2026-06-08 |
| **Author** | Adrien |

---

## 1. Context

The reservation calendar (`/calendar`) renders a custom month grid (`CalendarMonthGrid` +
`CalendarDayCell`) with diagonal check-in/out/cleaning gradients in 64px cells across a
7-column grid with `minWidth: 680` and horizontal scroll. On a phone (~375px) only ~4
columns fit, so it must be scrolled horizontally and the gradient cells are hard to read.
The property mini-calendars (`SyncedPropertyMiniCalendars`) render a `repeat(N, minmax(42px,
1fr))` day strip that overflows on a narrow screen.

## 2. Goal

Make the reservation calendar and the mini-calendars legible on a smartphone, **without
changing the desktop experience**.

## 3. Functional rules

1. **Breakpoint switch.** On `sm`+ the calendar keeps the existing `CalendarMonthGrid`
   (infinite vertical month scroll). On `xs` (`useMediaQuery(down('sm'))`), when a property
   is selected, it renders the new `CalendarWeekView` instead.
2. **Week view = one week per full-width page.** Each week shows its 7 days as full-width
   **vertical rows** (so they're readable), not the diagonal grid. Horizontal **scroll-snap**
   between weeks: swipe left/right moves to the previous/next week. A header shows the
   centered week's range + prev/next chevrons + an « Aujourd'hui » button.
3. **Per-day content** (for the selected property), as plain labels:
   - `↓ Départ — <nom> <heure> · <plateforme>` (reservation ending that day),
   - `↑ Arrivée — <nom> <heure> · <plateforme>` (reservation starting that day),
   - `• Séjour — <nom> · <plateforme>` (mid-stay day),
   - `Devis — <nom>` (greyed, only where no reservation occupies the slot),
   - a `Fermé` chip for an establishment closure, the calendar note, and public-holiday /
     school-zone dots in the date column. Today's row is highlighted; past days are dimmed.
4. **Interactions.** Tapping a reservation/devis line opens it; tapping a free future day
   offers `+ Nouvelle réservation`; a per-row note button opens the note dialog. Same
   handlers as the desktop grid (`onReservationClick`, `onOpenNewReservation`,
   `onOpenNote`, `onDevisClick`).
5. **Data coverage.** The parent loads reservations for the `useInfiniteMonthScroll` month
   range. When the user swipes to a week outside that range, `CalendarWeekView` calls
   `onWeekChange(weekStart)` and the page extends the range (`prependMonth` / `appendMonth`),
   which reloads the data. (`prependMonth`/`appendMonth` are scroll-ref-safe when the desktop
   grid isn't mounted.)
6. **Mini-calendars.** The day strip is wrapped in a horizontal-scroll container with a
   `minWidth` floor (`N × 44px`) so it scrolls on a phone instead of squishing; on desktop
   the `1fr` columns still fill the width.

## 4. Architecture (Client)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `calendarDaySummary.js` | C | NEW. Pure: `buildDaySummary(dateStr, reservations, devis)` → `{ arrival, departure, ongoing, devis[] }`; `isEmptyDay`; `getMonday`; `weekDays`. |
| `components/` | `CalendarWeekView.js` | C | NEW. Mobile week view: 53-week horizontal scroll-snap strip (today ±26 weeks), only the centered week ±1 rendered; header + nav; per-day rows via `buildDaySummary`. Reuses `calendarVisuals` (`getReservationColor`, `compactName`, `DAY_NAMES`, `ZONE_COLORS`, `formatDate`, `shiftDate`), `getClosureForDate`, `getSchoolHolidayInfo`. |
| `pages/` | `CalendarPage.js` | T | Adds `useMediaQuery` switch (xs → `CalendarWeekView`, else `CalendarMonthGrid`) and `ensureWeekLoaded` to extend the month range on week change. |
| `components/` | `SyncedPropertyMiniCalendars.js` | T | Day strip wrapped in an `overflowX:auto` container with a `minWidth` floor for mobile scroll. |

**Component reuse:** the desktop grid (`CalendarMonthGrid` / `CalendarDayCell`) is untouched
and still used on `sm+`.

## 5. Data model

No change.

## 6. UI / UX

- **Desktop (`sm`+):** unchanged.
- **Mobile (`xs`):** week view (rule 2-4). Rows ≥ 56px (touch targets); date column 46px;
  scroll-snap strip hides its scrollbar.
- **Mini-calendars (`xs`):** horizontal scroll of the day strip; property label + « Ouvrir »
  stay above.
- **Fit-to-screen (2026-06-08 follow-up):** the app's `<Box component="main">` is a flex
  child; it needs `minWidth: 0` so it can shrink to the viewport — otherwise the week strip's
  non-shrinkable `flex: 0 0 100%` pages give it a large intrinsic min-width and the whole
  page scrolls horizontally (the calendar looked wider than the phone). With `minWidth: 0`
  on `main`, the page fits the screen and only the week strip scrolls horizontally.
  `CalendarWeekView`'s Card is also pinned to `width/maxWidth: 100%` as a guard.

## 7. Test plan

### Client tests (Vitest)

- [x] `client/src/utils/__tests__/calendarDaySummary.test.js` (7) — arrival / departure /
      ongoing detection; empty day; devis suppressed where a reservation overlaps; `getMonday`
      and `weekDays`.
- [x] `client/src/components/__tests__/CalendarWeekView.test.js` (5) — current week renders
      arrival/departure/ongoing labels; header week range; clicking a line fires
      `onReservationClick`; free future days offer to create; note button fires `onOpenNote`.

### Manual UI verification

- [ ] On a phone-width viewport, `/calendar` with a property selected shows one week, swipes
      between weeks, and lines are readable. (Not done in-browser this session — the dev
      server held the ports.)

## 8. Out of scope

- The Planning page (`/planning`) — excluded by request.
- Desktop calendar layout — unchanged.
- Drag-to-create across days on mobile (mobile uses tap-a-free-day instead).
