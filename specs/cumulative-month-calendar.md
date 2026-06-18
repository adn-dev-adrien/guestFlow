# Cumulative month calendar (all logements on one calendar)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/cumulative-month-calendar` |
| **Created** | 2026-06-18 |
| **Author** | Adrien |
| **Touches** | `pages/CalendarPage.js`, `pages/Dashboard.js`, `components/CumulativeMonthCalendar.js` (new) |

---

## 1. Context

`/calendar` with no property selected shows `SyncedPropertyMiniCalendars` — one mini-calendar **per
logement** side by side. Adrien wants instead a **single month calendar that cumulates every logement**,
agenda-style.

Decisions (AskUserQuestion 2026-06-18): **continuous bars** spanning each stay, **stacked**, **coloured
by platform** (the existing `getPlatformColor` code).

## 2. Goal

When no property is selected, the overview is one calendar where each reservation (all logements
combined) is a **continuous horizontal bar** spanning its days, stacked in lanes so they don't overlap,
coloured by platform, labelled with the logement + client, clickable to open the fiche. Months are
**stacked vertically with infinite scroll** (scroll down/up loads the next/previous month — no month
buttons), with a **sticky month label** and an « Aujourd'hui » shortcut.

## 3. Functional rules
1. **Scope** = every reservation (`kind = 'reservation'`) **and every property closure** overlapping the
   visible month, all logements. Fetched per displayed month (`api.getReservations` +
   `api.getEstablishmentClosures`, no `propertyId`).
2. **Bars** span their days, split per week row (a bar can't wrap). **Reservations** are coloured by
   platform (`getPlatformColor`) and drawn **half-day at the arrival and departure** (the bar starts at
   the middle of the check-in day and ends at the middle of the check-out day, so arrivals/departures —
   and same-day turnovers — read visually). **Closures** are grey and **also drawn half-day at their
   start/end** (same look as reservations); they span `[startDate, endDate)`
   (the model's half-open interval → last occupied day = `endDate − 1`); a closure with no `propertyId`
   is **global** (« Tous les logements »).
3. **Grouped by logement.** Within a week the lanes are organised **per logement** (a contiguous band of
   lanes per property: all of one logement's bars, then the next). Global closures take the **top** band.
   Within a band, bars are lane-packed by start (a same-day departure→arrival shares a lane thanks to the
   half-day edges). The week row grows to fit the total lane count.
4. **Label**: logement name + client (`firstName lastName`, or the iCal summary / `Réservation #id`
   fallback), truncated. Tooltip with the full label + dates.
5. **Click** a bar → open the reservation fiche (`onReservationClick`). Click an empty day → new
   reservation prefilled with that date (`/reservations/new?startDate=…`, logement chosen on the page).
6. **Navigation = infinite scroll**: months are stacked vertically in a bounded scroll container;
   scrolling near the bottom appends the next month, near the top prepends the previous one (scroll
   position maintained). Each month carries a **sticky label**. An « Aujourd'hui » button refocuses the
   current month; today's day cell is highlighted. No previous/next buttons.
7. **Legend**: the platforms present, with their colours, plus a grey « Fermeture » entry when closures
   are present. On mobile (agenda list) closures render as grey rows « Fermé — {logement} ».
8. **Today is framed**: today's day cell carries a 2 px primary border (in addition to the bold primary
   day number).
9. **Same component on the Dashboard.** The dashboard overview renders the **exact same**
   `CumulativeMonthCalendar` (no duplication, identical behaviour), replacing its old per-logement
   mini-calendars. Only the navigation callbacks differ (origin `'/'`).
10. Drilling into a single logement's full calendar stays via the toolbar's property selector (unchanged).

## 4. Architecture
| Layer | File | Responsibility |
|---|---|---|
| components | `CumulativeMonthCalendar.js` (new) | Self-contained: reuses `useInfiniteMonthScroll`, incrementally fetches each visible month's reservations **+ closures** (merged by id), normalises them (`normalizeItems`), computes the week/lane layout grouped by logement with half-day reservation edges (`buildMonthLayout`), renders stacked month blocks + bars + legend. Render-only; reuses `getPlatformColor`. |
| hooks | `useInfiniteMonthScroll.js` | Reused as-is (a truthy sentinel keeps its scroll effects active outside the per-property flow). |
| pages | `CalendarPage.js` | Replace `SyncedPropertyMiniCalendars` (no-property branch) with `CumulativeMonthCalendar` (props: `onReservationClick`, `onCreateReservation`). |
| pages | `Dashboard.js` | Replace its `SyncedPropertyMiniCalendars` overview with the **same** `CumulativeMonthCalendar` (callbacks with origin `'/'`). |

No server change (reuses `GET /reservations?from&to` + `GET /establishment-closures?from&to`).

## 5. Data model
None. Reads existing reservation fields (`id, startDate, endDate, platform, propertyName, firstName,
lastName, icalOriginalSummary`) and closure fields (`id, propertyId, propertyName, label, startDate,
endDate`).

## 6. UI / UX
- Stacked month blocks inside a bounded scroll container: each block = sticky month label + weekday
  header (Mon→Sun) + week rows. Day cells greyed for adjacent-month days. Each week is a positioned row:
  day-number band + absolutely-positioned bars in lanes.
- Bars: rounded, platform colour, white text, single-line ellipsis; rounded only on the true start/end
  (square on a week-split edge to signal continuation).
- **Mobile** (`xs`): the wide 7-column bar grid is replaced by a readable **agenda list** — each month
  renders its reservations as rows (platform-coloured left border, logement, client, date range « 30 juin
  → 2 juillet », platform chip), tappable → fiche. No horizontal scrolling; the vertical infinite scroll +
  sticky month label + legend are unchanged. The desktop bar grid is kept on `sm+`.

## 7. Test plan
- [x] Unit (`buildMonthLayout`): single-day → one rounded segment; week-boundary split → 2 segments;
  overlapping stays → distinct lanes; whole-month coverage. `monthReservations` (mobile): month-overlap
  filter + sort. `frRange`: single day + range. Component render (desktop): ≥ 3 stacked months, bars from
  loaded data, « Aujourd'hui » + scroll hint. Mobile render (`useMediaQuery` forced): agenda rows
  (logement + client), no 7-column header. (`CumulativeMonthCalendar.test.js` + `.mobile.test.js`)
- [ ] _(superseded)_ a stay within one week → one segment on the right
  lane; a stay crossing a week boundary → two segments; two overlapping stays → two lanes.
- [ ] Manual (dev): the overview shows all logements' reservations as platform-coloured bars on one month;
  nav + today; click a bar opens the fiche; empty-day click starts a new reservation; mobile scroll.

## 8. Out of scope
- Drag-to-create across the cumulative grid (creation is a single empty-day click → prefilled date).
- Per-logement rows/swimlanes (bars are cumulated, lane order is packing-driven, not per-logement).
- Devis / closures / notes on this overview (kept on the per-property full calendar).
