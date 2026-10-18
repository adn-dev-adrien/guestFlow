# « Réservations à venir » — Planning cards grouped by day

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/upcoming-reservations-cards` |
| **Created** | 2026-06-17 |
| **Author** | Adrien |
| **Touches** | `pages/ReservationsUpcomingPage.js` |

---

## 1. Context

The dashboard « Réservations (30j) » card opens `/reservations/upcoming`
([ReservationsUpcomingPage.js](../client/src/pages/ReservationsUpcomingPage.js)), which was a plain
table (Arrivée / Départ / Heures / Logement / Client / Plateforme / Total). Adrien wants it refactored
to the **Planning arrival cards**, consistent with the Planning and with the Finance « Réservations à
venir » section (#220).

Decisions (AskUserQuestion 2026-06-17): **Planning cards (`ReservationCard`) grouped by day**, over
**ALL future reservations** (arrival ≥ today, no 30-day cap).

## 2. Goal

Render the upcoming reservations as the exact Planning arrival cards, grouped under a day header, with
the same actions (open fiche, arrival SAS, open client, toggle « prêt »).

## 3. Functional rules
1. Source = **all reservations whose `startDate ≥ today`** (no upper bound). The list endpoint is queried
   with a far `to`; the client keeps arrivals `startDate ≥ today`.
   > **Amended 2026-10-18:** the server selects them now — see rule 6.
2. Each reservation's **full detail** is fetched (`api.getReservation`, same as the Planning) so the card
   shows beds / famille / options / ressources / complément / caution / bed-linen alert.
   > **Amended 2026-10-18:** the detail rides the single response of rule 6; the page fetches no
   > reservation on its own.
3. Grouped by **arrival day**; each day shows a header (French weekday + a `prêt` count chip, highlighted
   when today / all-ready), then the `ReservationCard`s sorted by check-in time.
4. Card actions: row → fiche, arrival SAS (`ReservationSasDialog`), client, toggle « prêt »
   (`checkInReady` via `PATCH /reservations/:id/payment`). The SAS `onCommitted` reloads the page.
5. Empty state when there is no future reservation.
6. **One call** (added 2026-10-18, review #8 m-9). `GET /api/reservations/upcoming` returns
   `{ today, days: [{ date, label, isToday, reservations, readyCount, total, allReady }] }`: every
   reservation (kind `reservation`, devis and cancelled stays excluded) arriving on the server's
   today or later, in arrival order — day, then check-in time with an unset time last, then id —
   each in the same detailed shape as `GET /api/reservations/:id`'s model read, grouped by day, the
   day labelled in French (« vendredi 23 octobre ») and its « prêt » count computed. The page renders
   it and counts nothing; after a « prêt » toggle it asks again rather than recounting. The page
   used to send one request per stay — about 350 for 500 bookings — and a few visits exhausted the
   API rate limit (3 000 / 15 min): every page then answered 429 and the operator was in effect
   logged out. Admin-only, like the page (deny-by-default role guard).
   > **Amended 2026-10-18 (review of PR #700):** after a « prêt » toggle the page asks for that one
   > day only — see rule 8.
7. **The server's today** (added 2026-10-18, review #8 n-1). The pages that open « on today » — the
   dashboard's day, the planning's first day, this page's « Aujourd'hui » — take the calendar day of
   the server, whose clock runs in the accommodations' time zone (specs/server-timezone.md), from
   `GET /api/today` → `{ today }` (any signed-in role: it is a self endpoint). Until it answers they
   use the browser's own calendar day — never `toISOString()`, the UTC day, which read yesterday
   between midnight and 2 a.m. in Paris (« 17/10/2026 » shown at 01:54 on the 18th). Day arithmetic
   on `YYYY-MM-DD` stays in UTC so a time change cannot skip or repeat a day. The reservation list's
   payment status (`GET /api/reservations`) uses the server day too. The hourly-resources planning,
   a plugin that must run on older hosts, uses the browser's calendar day.
   > **Amended 2026-10-18 (review of PR #700):** the forms that default to « today » take the
   > browser's calendar day too, never the UTC one — the refund date (and its `max`), the extra
   > laundry trip (linen plugin 1.0.2), the past/upcoming split of a client's stays in the clients
   > directory, the fiche's mid-stay note gate in the test mock.
8. **The « prêt » box answers at once** (added 2026-10-18, review of PR #700). Ticking or unticking
   « prêt » on « Réservations à venir » flips the box immediately, without the loader; the page
   then asks `GET /api/reservations/upcoming?day=YYYY-MM-DD` for that day alone and replaces it with
   the server's answer (same shape as rule 6, `days` holding that day or nothing; a past day answers
   no day, a malformed one 400 « Date invalide. »). The count stays the server's. A refused save
   puts the box back and shows the error. When two ticks on one day cross, only the latest recount
   paints. Each click used to re-read the whole season — 2.4 MB and 0.7 s with 500 stays — before
   the box moved.
9. **Only the latest dashboard load paints** (added 2026-10-18, review of PR #700). The dashboard
   loads the browser's day, then the server's (rule 7), and reloads on every day change; a load that
   answers after a newer one started is dropped, so the day shown and its arrivals and departures
   always match.

## 4. Architecture
| Layer | File | Responsibility |
|---|---|---|
| pages | `pages/ReservationsUpcomingPage.jsx` | One `GET /reservations/upcoming` → render the server's days with `ReservationCard` + the `sas.dialog` slot; a « prêt » tick flips at once and refreshes its day with `?day=` (rule 8). Render-only. |
| pages | `pages/Dashboard.jsx`, `pages/PlanningPage.jsx` | Open on `useToday()` until the operator picks a day (rule 7); the dashboard drops a stale load (rule 9). |
| pages / components | `pages/ClientsPage.jsx`, `components/reservation/RefundDialog.jsx`, `plugins/linen/LaundryExtraTripDialog.jsx` (T) | « Today » defaults on the browser's calendar day (rule 7 amendment). |
| hooks | `hooks/useToday.js` (C) | The server's calendar day, the browser's calendar day until it answers. |
| utils | `utils/localDate.js` (C) | `localIsoDate`, `addIsoDays` on `YYYY-MM-DD`. |
| server routes | `routes/reservations.js` (T), `routes/today.js` (C) | `GET /reservations/upcoming` (before `/:id`), `GET /today`. |
| server controllers | `controllers/upcomingReservationsController.js` (C), `controllers/todayController.js` (C) | Orchestrate rules 6 and 8 (`?day=`); answer rule 7. |
| server models | `models/upcomingReservationsModel.js` (C), `models/reservationsModel.js` (T) | The arrival ids from today (`arrivalIdsFrom`) or of one day (`arrivalIdsOn`); the list's payment status on the server day. |
| server utils | `utils/upcomingArrivals.js` (C) | Group by day, French label, ready counts. |
| server middleware | `middleware/enforceRoleAccess.js` (T) | `/today` joins the self endpoints. |

Until 2026-10-18 there was no server change (the page reused `GET /reservations`,
`GET /reservations/:id`); rules 6-7 added the two endpoints above.

## 5. Out of scope
- The tight-turnover cleaning **alert** badge (the Planning computes it from per-property adjacency;
  omitted here for now — `ReservationCard` renders fine without `alertInfo`).
- Departures / laundry / breakfast cards (this page is arrivals-only).
- Pagination (all future rendered; a window selector can be added later if the list grows large).

## 6. Test plan
- [ ] Manual (dev): the page shows day-grouped Planning cards for all future arrivals; a card opens the
  fiche, the SAS, the client; « prêt » toggles + persists; empty state when none.
- [x] Rule 6 — server `upcoming-reservations-one-call.unit.test.js` (5: order, exclusions, grouping and
  labels, label independent of the server zone, 500 arrivals in one response); client
  `ReservationsUpcomingPage.one-call.test.jsx` (3: 500 stays → one request and no per-reservation
  fetch, server label/count rendered as sent, « prêt » re-asks the server).
- [x] Rule 7 — server `server-today.unit.test.js` (3: the endpoint, 01:54 Paris = the 18th while UTC
  reads the 17th, every role may read it); client `Dashboard.server-today.test.jsx` (3: the server's
  day is shown and queried, the browser's calendar day before it answers, day arithmetic across the
  October time change).
- [x] Rule 8 — server `upcoming-reservations-day-refresh.unit.test.js` (4: one day in arrival order,
  `?day=` details and counts that day only, a past or empty day answers no day, a malformed day is
  refused); client `ReservationsUpcomingPage.ready-toggle.test.jsx` (3: ticked before the server
  answers and only its day re-asked, a refused save puts the box back, a late recount never
  overwrites a newer one).
- [x] Rule 9 — client `Dashboard.stale-load.test.jsx` (1: the browser-day load answering last does
  not replace the server day's arrivals).
- [x] Rule 7 amendment — `RefundDialog.local-day.test.jsx`, `LaundryExtraTripDialog.local-day.test.jsx`
  (01:54 in Paris on the 18th → the 18th).
- [x] Browser (2026-10-18, Solio copy + 500 stress reservations): « Réservations à venir » loads with
  one API call and no 429 after repeated visits.
