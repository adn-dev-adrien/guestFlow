# Cumulative month calendar (all logements on one calendar)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/cumulative-month-calendar` |
| **Created** | 2026-06-18 |
| **Author** | Adrien |
| **Touches** | `pages/CalendarPage.js`, `components/CumulativeMonthCalendar.js` (new) |

---

## 1. Context

`/calendar` with no property selected shows `SyncedPropertyMiniCalendars` — one mini-calendar **per
logement** side by side. Adrien wants instead a **single month calendar that cumulates every logement**,
agenda-style.

Decisions (AskUserQuestion 2026-06-18): **continuous bars** spanning each stay, **stacked**, **coloured
by platform** (the existing `getPlatformColor` code).

## 2. Goal

When no property is selected, the overview is one **monthly** calendar where each reservation (all
logements combined) is a **continuous horizontal bar** spanning its days, stacked in lanes so they don't
overlap, coloured by platform, labelled with the logement + client, clickable to open the fiche. Month
navigation (‹ / › / Aujourd'hui).

## 3. Functional rules
1. **Scope** = every reservation (`kind = 'reservation'`) overlapping the visible month, all logements.
   Fetched per displayed month (`api.getReservations({ from, to })`, no `propertyId`).
2. **Bars** span `startDate → endDate` inclusive. A stay crossing a week boundary is **split** into one
   segment per week row (a bar can't wrap). Colour = `getPlatformColor(platform)`.
3. **Lanes**: within a week, bars are assigned to lanes (rows) greedily by start date so overlapping
   stays never collide; the week row grows to fit the lane count.
4. **Label**: logement name + client (`firstName lastName`, or the iCal summary / `Réservation #id`
   fallback), truncated. Tooltip with the full label + dates.
5. **Click** a bar → open the reservation fiche (`onReservationClick`). Click an empty day → new
   reservation prefilled with that date (`/reservations/new?startDate=…`, logement chosen on the page).
6. **Month nav**: previous / next month + « Aujourd'hui »; today's day cell highlighted.
7. **Legend**: the platforms present in the month, with their colours.
8. Drilling into a single logement's full calendar stays via the toolbar's property selector (unchanged).

## 4. Architecture
| Layer | File | Responsibility |
|---|---|---|
| components | `CumulativeMonthCalendar.js` (new) | Self-contained: own month state + nav, fetches the month's reservations (all logements), computes the week/lane bar layout, renders the grid + bars + legend. Render-only; reuses `getPlatformColor`. |
| pages | `CalendarPage.js` | Replace `SyncedPropertyMiniCalendars` (no-property branch) with `CumulativeMonthCalendar` (props: `properties`, `onReservationClick`, `onCreateReservation`). |

No server change (reuses `GET /reservations?from&to`).

## 5. Data model
None. Reads existing reservation fields: `id, startDate, endDate, platform, propertyName, firstName,
lastName, icalOriginalSummary`.

## 6. UI / UX
- Month grid: weeks (Mon→Sun) × 7 day columns; leading/trailing adjacent-month days greyed. Each week is
  a positioned row: day-number header band + absolutely-positioned bars in lanes.
- Bars: rounded, platform colour, white text, single-line ellipsis; rounded only on the true start/end
  (square on a week-split edge to signal continuation).
- **Mobile** (`xs`): the month grid scrolls horizontally inside a contained wrapper (min width keeps the
  7 columns legible); bars + legend unchanged. ≥ 44 px touch targets on the nav buttons.

## 7. Test plan
- [ ] Unit (`CumulativeMonthCalendar` layout helper): a stay within one week → one segment on the right
  lane; a stay crossing a week boundary → two segments; two overlapping stays → two lanes.
- [ ] Manual (dev): the overview shows all logements' reservations as platform-coloured bars on one month;
  nav + today; click a bar opens the fiche; empty-day click starts a new reservation; mobile scroll.

## 8. Out of scope
- Drag-to-create across the cumulative grid (creation is a single empty-day click → prefilled date).
- Per-logement rows/swimlanes (bars are cumulated, lane order is packing-driven, not per-logement).
- Devis / closures / notes on this overview (kept on the per-property full calendar).
