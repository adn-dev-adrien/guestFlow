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
   **Amended 2026-10-19** (specs/ui-review-2026-10-19-operations.md rules 13-14): a closure is no longer
   a bar — it hatches its days (a band along the bottom for one logement, the whole day for a global
   one) with one label per week, and a stay bar is a 14 % tint of its platform colour with a 3 px stripe
   and ink text.
   **Amended 2026-10-28** (`calendar-property-parity.md` rules 1-11): data from `GET /api/calendar`;
   a current or future stay is a solid bar with a server-chosen text colour, a past one keeps the tint;
   a logement's closure is a hatched bar in its logement's lanes, half-day from `startDate` to `endDate`.
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
   position maintained). An edge is released as soon as its requested month is **rendered**, and the
   hook re-checks right then: while the scroller is still within 200 px of that edge it chains the next
   month (at most 6 per scroll event), without waiting for another scroll event. The earlier release —
   « only once a scroll event lands ≥ 200 px from the edge » — stalled the calendar whenever a month was
   shorter than 200 px (an empty mobile agenda) or a fast wheel notch jumped over that band: the
   scroller sat at its end and the whole page scrolled instead (fixed 2026-09-29). Each month carries a
   **sticky label**. An « Aujourd'hui » button refocuses the
   current month; today's day cell is highlighted. No previous/next buttons.
7. **Opens on the current month.** On load the calendar scrolls so the **current month** sits at the top
   of the container. Because the focus scroll runs before the reservations finish loading and the mobile
   agenda blocks are variable-height, the current month is re-focused once after the first batch of items
   settles the heights. The scroll offset is computed **rect-relative** (`getBoundingClientRect`), not via
   `offsetTop` — the month anchors have no positioned ancestor, so `offsetTop` measured from the page top
   and clamped the scroll to the last month (the « date bizarre » bug, fixed 2026-06-23).
12. **Legend**: the platforms present, with their colours, plus a grey « Fermeture » entry when closures
   are present. On mobile (agenda list) closures render as grey rows « Fermé — {logement} ».
   **Amended 2026-10-19** (specs/ui-review-2026-10-19-operations.md rules 13, 15): the legend is folded
   behind « Légende » and prints display names (« Gîtes de France »); a closure swatch is hatched, and
   on mobile a closure is a hatched row « {logement} fermé ».
8. **Today is framed**: today's day cell carries a 2 px primary border (in addition to the bold primary
   day number).
8bis. **Past stays are greyed (visual only).** A reservation/closure whose last occupied day is before
   today (`today > lastDay`) renders at `opacity: 0.5` — in BOTH the mobile agenda rows and the desktop
   grid bars. Purely cosmetic (no data/interaction change); same language as the per-property calendar
   (`CalendarDayCell` / week view), which already greys past days. Added 2026-06-23.
9. **Same component on the Dashboard.** The dashboard overview renders the **exact same**
   `CumulativeMonthCalendar` (no duplication, identical behaviour), replacing its old per-logement
   mini-calendars. Only the navigation callbacks differ (origin `'/'`).
10. Drilling into a single logement's full calendar stays via the toolbar's property selector (unchanged).
11. **A month added above keeps the view still** (fixed at the 2026-10-27 spec review). When the scroll
    adds a month above the first one, the view moves by exactly what that month pushed the first one
    down — measured on the first month's anchor, not on the scroller's total height. On a phone both
    edges are near at load, a month is added at each end in the same commit, and the height-based delta
    counted the months appended below too: the view landed ~180 px past the current month and its first
    stay hid under the sticky « Octobre 2026 » label. (Rule 6 of the per-property calendar uses the same
    hook and gets the same correction.)
13. **The Dashboard opens on the current week** (added 2026-11-12, at Adrien's request). Opening on the
    current month put its first week at the top: by mid-month the weeks that matter were below the fold.
    The Dashboard passes `openOnCurrentWeek`: on load **and on « Aujourd'hui »** the week row holding today
    sits right under the sticky month title (the past weeks of the month stay one scroll up). On a phone
    — an agenda list, no week rows — the row is the **first stay or closure of the current month not yet
    over** (a stay's departure today still counts; a closure's `endDate` is its first open day, so one
    ending today is over); a month with none opens on its title. Only the block of today's month marks
    that row: a week crossing a month boundary is drawn in both months' grids (on the 1st of December the
    week 30/11 → 06/12 closes « Novembre » too), a stay crossing it is listed in both agendas. « Today » is
    the server's day, the one the row is marked with — the scroller aims at that month, not the device's.
    The row is **held in place while the months load** — the weeks above it grow lane by lane as their
    stays land, and on a phone the row only exists once its month has loaded — until **a scroll moves it**,
    whatever its cause (wheel, touch, scrollbar, a bar brought into view by Tab): the scroller compares the
    row with where its own last write left it. A scroll the view causes itself (a month added above keeps
    the view still, rule 11) does not move the row and keeps it. If today's month loads with no row to
    show, the wait ends there: a row drawn later never pulls the view. The Calendrier page keeps rule 7
    (opens on the current month): it was not part of the request.
14. **The day names stick under the month title** (added 2026-11-12, with rule 13). Lun → Dim is part of
    each month's sticky header on the desktop grid, so a view that opens mid-month — or any scroll inside
    a month — still names its columns. Both calendars (Dashboard and Calendrier « Tous ») get it. The
    clearance under that header is measured (title + day names), never assumed, both to place today's row
    and to tell which month is « in view ».

## 4. Architecture
| Layer | File | Responsibility |
|---|---|---|
| components | `CumulativeMonthCalendar.js` (new) | Self-contained: reuses `useInfiniteMonthScroll`, incrementally fetches each visible month's reservations **+ closures** (merged by id), normalises them (`normalizeItems`), computes the week/lane layout grouped by logement with half-day reservation edges (`buildMonthLayout`), renders stacked month blocks + bars + legend. Render-only; reuses `getPlatformColor`. |
| hooks | `useInfiniteMonthScroll.js` | Reused (a truthy sentinel keeps its scroll effects active outside the per-property flow). Since 2026-10-27 (rule 11) a prepend keeps the former first month's anchor still on screen instead of adding the scroller's whole growth. |
| pages | `CalendarPage.js` | Replace `SyncedPropertyMiniCalendars` (no-property branch) with `CumulativeMonthCalendar` (props: `onReservationClick`, `onCreateReservation`). |
| pages | `Dashboard.js` | Replace its `SyncedPropertyMiniCalendars` overview with the **same** `CumulativeMonthCalendar` (callbacks with origin `'/'`). Since 2026-11-12 passes `openOnCurrentWeek` (rule 13). |
| components | `CumulativeMonthCalendar.jsx` | 2026-11-12: marks the current week row (`data-current-week`; on a phone the first agenda row of today's month not yet over), `openOnCurrentWeek` prop forwards that selector as the scroller's `todaySelector`, the weekday header moves into the scroller's `stickyHeader` (rules 13-14). |
| components | `InfiniteMonthScroller.jsx` | 2026-11-12: `stickyHeader` slot under each month title; the today-row clearance is measured on that sticky header (never below the former 48 px); the today row is anchored where it belongs (not where a not-yet-grown scroller capped it), awaited when it only appears with its month's data (until today's month has loaded), and held until a scroll moves it; optional `today` prop (the server's day) picks the current month; the « month in view » threshold uses the same measured header (rules 13-14). |

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
  → 2 juillet », platform chip), tappable → fiche. **Rows are ordered by arrival date** (`startDate`
  ascending) so the list reads as a chronological timeline of check-ins; the logement + item key only break
  ties between same-day arrivals (2026-06-21 — was previously grouped by logement first). No horizontal
  scrolling; the vertical infinite scroll + sticky month label + legend are unchanged. The desktop bar grid
  is kept on `sm+`.

## 7. Test plan
- [x] Unit (`buildMonthLayout`): single-day → one rounded segment; week-boundary split → 2 segments;
  overlapping stays → distinct lanes; whole-month coverage. `monthReservations` (mobile): month-overlap
  filter + sort. `frRange`: single day + range. Component render (desktop): ≥ 3 stacked months, bars from
  loaded data, « Aujourd'hui » + scroll hint. Mobile render (`useMediaQuery` forced): agenda rows
  (logement + client), no 7-column header. (`CumulativeMonthCalendar.test.js` + `.mobile.test.js`)
- [x] Unit (`useInfiniteMonthScroll`, 3 tests): one scroll event at the bottom chains short months until the
  scroller is clear of the edge; repeated returns to the bottom keep appending without scrolling away
  first; a zero-height layout stays bounded. (`hooks/__tests__/useInfiniteMonthScroll.edge-chain.test.jsx`)
- [x] Rule 11 (2026-10-27): a month added above and one below in the same pass leave the former first
  month where it was on screen. (`hooks/__tests__/useInfiniteMonthScroll.prepend-anchor.test.jsx`.)
  Browser, 390 px `/calendar`: the current month's label sits at the top of the list and its first stay
  right under it (was hidden under the label).
- [x] Rules 13-14 (2026-11-12, completed after the PR review): under a 70 px sticky header the row stays
  pinned while the current month and the one above it load; a scroll event the view causes itself keeps
  it; a row that only appears with its month's data is reached; a scroll that moves the row releases it;
  « Aujourd'hui » puts it back; today's month loaded without a row ends the wait
  (`components/__tests__/InfiniteMonthScroller.today-row-pin.test.jsx`, 6 tests). Only the week holding
  today is marked, and on 1 December only in « Décembre »; the day names sit once per month inside the
  sticky title; on a phone only today's month marks its first stay not yet over, and a closure ending today
  is over (`components/__tests__/CumulativeMonthCalendar.current-week.test.jsx`, 5 tests). Browser on a copy of the dev base, 12/11/2026: Dashboard 1280 px opens on the 9-15 November
  row under « Novembre 2026 / Lun … Dim »; 390 px opens on November's first running row; a wheel then
  « Aujourd'hui » returns to the week; Calendrier « Tous » still opens on the month.
- [ ] _(superseded)_ a stay within one week → one segment on the right
  lane; a stay crossing a week boundary → two segments; two overlapping stays → two lanes.
- [ ] Manual (dev): the overview shows all logements' reservations as platform-coloured bars on one month;
  nav + today; click a bar opens the fiche; empty-day click starts a new reservation; mobile scroll.

## 8. Out of scope
- Drag-to-create across the cumulative grid (creation is a single empty-day click → prefilled date).
- Per-logement rows/swimlanes (bars are cumulated, lane order is packing-driven, not per-logement).
- Devis / closures / notes on this overview (kept on the per-property full calendar).
