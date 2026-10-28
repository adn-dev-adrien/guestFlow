# Home and planning without a date picker — the next arrival, and days that scroll both ways

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/dashboard-planning-scroll` _(user-managed)_ |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Source: Adrien's feedback on the `inte/plugins` shadow, 2026-10-28 (verbatim):

> Sur le dashboard, si non n'avons pas d'arrivée ou de départ, il faut replier le menu. Et dans Arrivée,
> si nous n'en avons pas le jour, il faut afficher la prochaine arrivée avec sa date bien visible. Du
> coup on va pouvoir supprimer le système de date qui se trouve dans le bandeau suppérieur et retirer la
> feature associé.
> Pour la page planning, il faut faire un système comme de scolling comme le calendrier générale qui
> permet d'afficher dans le passer et le future, et du coup on va pouvoir supprimer la date qui se
> trouve dans le bandeau et la feature associé.

Rendering to validate before code: `docs/specs/2026-10-28-dashboard-planning-scroll.html` (interactive).

---

## 1. Context

**Home (`client/src/pages/Dashboard.jsx`).**

- The page bar carries a date cluster — previous day, a date input « Date affichée », next day,
  « Aujourd'hui » (`Dashboard.jsx:166-188`, mounted in the bar `center` at `:353` and again as a phone
  strip at `:355-357`). It exists so the operator can look at another day than today. Adrien never uses
  it for that: he wants to know **when the next arrival is**, which the picker answers only by clicking
  day after day.
- On the server's day 2026-10-28 (shadow copy of 2026-10-22) the home shows two empty tables,
  « Aucun départ ce jour. » and « Aucune arrivée ce jour. », while the next arrival is on 6 November —
  nowhere on the page.
- **The lists are computed in React** (CLAUDE.md §6.0 anti-pattern): `loadDashboardData`
  (`:118-147`) asks `GET /api/reservations?from=<today>` — **every stay that ends today or later, the
  whole season** — filters arrivals and departures of the day on the client, sorts them by hour, then
  fetches **each one again** with `GET /api/reservations/:id` (the full fiche payload: ledger, refund
  register, CGV block, plugin blocks…). One home visit = 1 + N requests, N the stays of the day.

**Planning (`client/src/pages/PlanningPage.jsx`).**

- Same date cluster in the bar (`:449-480`, bar `:492-496`, phone strip `:499-502`): the first day of a
  14-day window (`DAYS_AHEAD`, `:34`). Going back in time is only possible through it.
- The page already appends 14-day windows when the window scroll nears the bottom (`:326-414`) — forward
  only, and with a **dead end**: when a window holds no reservation, `lastLoadedRef` is set to `null`
  (`:363-366`) and the scroll never loads again. On the shadow, from 2026-10-28: window 1 holds the
  6 November stay, window 2 the 13 November one, window 3 (25 Nov → 8 Dec) is empty → **the Christmas
  stays (24 and 29 December) and every 2027 stay can never be reached by scrolling.** Removing the date
  picker without fixing this would lock the operator out of the future.
- **Five requests per window plus one per arrival**: `GET /reservations?from&to`, `/planning/breakfast`,
  `/planning/option-cards`, `/planning/alerts`, each plugin's `load(range)`, then `GET /reservations/:id`
  for every overlapping stay (`:277`, `:367` — the appended window details *every* overlapping stay, not
  only its arrivals). Days, departures and their order are assembled in React (`:279-306`, `:368-405`).
- The general calendar (`components/CumulativeMonthCalendar.jsx` + `hooks/useInfiniteMonthScroll.js`)
  is the reference Adrien names: it opens on today, prepends/appends months at both edges of its own
  scroller, keeps the month in view in place when it prepends (anchor `data-month-anchor`), chains
  short months, offers « Aujourd'hui », and loads each month window once. Its hook is month-shaped and
  bound to an inner scroller; the planning scrolls the **window** (specs/ds-sweep-planning.md rule 6 —
  the sticky bar must survive scrolling).

**Specs that describe what goes away** (amended in §10): `shell-and-home-day-first.md` rules 1, 19, 26;
`ds-sweep-planning.md` rules 1, 2, 28, 29; `upcoming-reservations-cards.md` rules 7, 9;
`ds-components.md` rule 19 (its 900 px E2E pin uses the dashboard's date input).

## 2. Goal

The home answers « what happens today, and if nobody arrives, when is the next arrival » without a
control to touch; an empty list folds to one line. The planning is a continuous timeline of days that
scrolls into the past and the future like the general calendar, one server call per window, never
stalls on an empty fortnight, and keeps « Aujourd'hui » one tap away. Neither page has a date picker
any more.

## 3. Functional rules

### 3.A Home — the day lists (server)

1. **One call for the day lists.** `GET /api/planning/today` returns `{ today, departures, arrivals,
   nextArrival }` built on the server's day (`getTodayIsoDate`, specs/server-timezone.md):
   `departures` = the stays (`kind = 'reservation'`, devis and cancelled stays excluded) whose
   `endDate` is today, ordered by check-out time (unset last), then id; `arrivals` = those whose
   `startDate` is today, ordered by check-in time (unset last), then id. Each stay is in the detailed
   shape of the model read `getByIdWithDetails` (the one `/reservations/upcoming` serves) — never the
   fiche payload. The home sends no other reservation request.
2. **The next arrival is the server's.** When `arrivals` is empty, `nextArrival` is
   `{ date, label, relativeLabel, reservations }`: the first day after today on which a stay starts, and
   **every** stay starting that day, in the order of rule 1. `label` is the French day (« vendredi
   6 novembre », the year added when it is not the current year: « samedi 3 avril 2027 »);
   `relativeLabel` is « demain » or « dans N jours » (calendar days, Europe/Paris). No upper bound on
   the search. `nextArrival` is `null` when today has arrivals or when no stay starts after today.
3. **Same roles as the home.** The route lives under `/api/planning/`, which the reception role
   already reads (`middleware/enforceRoleAccess.js` RECEPTION_MATCHERS); a reception-only requester
   gets every stay through `toReceptionReservationView` (finance-free, with the SAS locks and the
   `check*StatusEditable` flags). An accountant gets 403, as for every planning read.

### 3.B Home — the day lists (client)

4. **An empty list folds to one line.** With no departure today, « Départs » is a single line —
   the section title and « Aucun départ aujourd'hui » in muted text — with no table, no card and nothing
   to unfold. Same for « Arrivées » (« Aucune arrivée aujourd'hui »). The order stays departures, then
   arrivals (specs/reception-role-checkin-only.md §6). A non-empty list renders exactly as today
   (table from 940 px of container, cards below — shell-and-home-day-first rule 25).
5. **« Prochaine arrivée » under the folded arrivals line.** When `nextArrival` is set, the folded
   « Arrivées » line is followed by a block headed by the date, set large and in figures-friendly sans
   (dates never serif, specs/design-system.md): `label` in bold and `relativeLabel` beside it in a soft
   chip. Under it, one compact row per stay: check-in hour (default « 15:00 »), logement, client,
   beds to prepare (`bedsLabel`, omitted when the stay has none). No « Prêt » / « Arrivé » check box —
   the operational ticks belong to the day itself and to the Planning. A row opens the fiche for an
   admin (`withFrom('/')`); for a reception account the row is inert (its SAS is locked to its own day,
   specs/reception-sas-today-only.md). When `nextArrival` is `null`, the folded line reads « Aucune
   arrivée aujourd'hui · aucune arrivée prévue ».
6. **No date in the page bar.** The home's bar is « Tableau de bord » alone: no arrows, no date input,
   no « Aujourd'hui », no phone strip under the bar. The section titles lose their « — <date> »
   suffix and read « Départs du jour » / « Arrivées du jour ». On a phone the bar, left with no action,
   is not drawn (shell-and-home-day-first rule 15).
7. **Today follows midnight.** The lists reload when `useServerToday` reports a new day (focus or tab
   visible again, ds-sweep-planning rule 29) and on « Réessayer »; only the latest load paints
   (upcoming-reservations-cards rule 9, kept for this trigger). A « Prêt » / « Arrivé » / « Parti » tick
   stays optimistic as today and is not followed by a reload.

### 3.C Planning — the days endpoint (server)

8. **One call per window.** `GET /api/planning/days?from=YYYY-MM-DD&to=YYYY-MM-DD` returns
   `{ from, to, today, days, alerts }`. `days` lists **every** calendar day of `[from, to]` in order —
   empty days included — each `{ date, label, shortLabel, isToday, isPast, arrivals, departures,
   breakfast, optionCards }`: `arrivals` / `departures` as in rule 1 (stays starting / ending that
   day, same order, same detailed shape, through the reception view for a reception account);
   `breakfast` = that day's entry of `breakfastModel.breakfastByDate` or `null`; `optionCards` = that
   day's entry of `planningOptionCardsModel.cardsInRange` or `null`; `label` « mardi 3 novembre »
   (year added outside the current year), `shortLabel` « mar. 3 nov. ». `alerts` is
   `planningAlertsModel.alertsInRange` for the window, `{ arrivals: { [id]: alert }, departures: { … } }`.
9. **The window is bounded.** `from` and `to` must be real calendar days (`2026-02-30` refused, as
   upcoming-reservations-cards rule 10), `from ≤ to`, and the window at most **31 days**; otherwise
   400 `{ error: 'INVALID_DATE_RANGE' }`. Past windows are answered like future ones.
10. **The replaced reads leave.** `GET /api/planning/alerts` and `GET /api/planning/option-cards` lose
    their only caller and are removed with their controller methods and client wrappers;
    `GET /api/planning/breakfast` stays (the breakfast push deep-link reads one day through it,
    specs/sas-breakfast-bread-and-push.md rule 10); `POST /api/planning/option-cards/done` stays.

### 3.D Planning — the timeline (client)

11. **Windows on a fixed grid.** The timeline is made of 14-day windows anchored on the server's
    today: window *k* = `[today + 14k, today + 14k + 13]`. Each window is asked once
    (`GET /api/planning/days`) together with each `planning.days` contribution's `load({ from, to })`
    for the same range; a window is never asked twice while it is loaded or in flight.
12. **Opens on today.** At open the page loads windows −1, 0 and 1 and, once they are drawn, scrolls
    the window so that today's header sits right under the page bar. Nothing above today is visible
    at open; the past is one scroll up.
13. **Both edges extend.** When the window scroll comes within 800 px of the top of the timeline, the
    previous window is loaded and drawn **above** without moving what the operator is looking at (the
    first visible day keeps its place on screen — the anchor technique of `useInfiniteMonthScroll`,
    applied to `window.scrollY`). Within 800 px of the bottom, the next window is appended. A newly
    drawn window that leaves the scroll still within the threshold chains the next one, at most
    4 windows per scroll gesture.
14. **An empty fortnight never stops the scroll.** A window without any card still draws its days
    (rule 15) and the scroll goes on past it. (Fixes the dead end of `PlanningPage.jsx:363-366`: the
    stays of 24 and 29 December 2026 and of 2027 become reachable from today.)
15. **Empty days fold into one line.** A day with no card — no arrival, departure, breakfast, option
    card nor plugin card — is not drawn as a header. Consecutive empty days merge into one muted line
    « Rien de prévu · du lun. 2 au dim. 8 nov. » (one day: « Rien de prévu · lun. 2 nov. »), built
    from the days' `shortLabel`. **Today is never folded**: an empty today shows its header and
    « Rien de prévu aujourd'hui », so « Aujourd'hui » always has a place to land. A run never crosses
    today. A day that only a plugin card fills is not empty.
16. **The day header stays in view.** A day header is sticky just under the page bar while its cards
    scroll under it, then is pushed away by the next day's header. The page bar publishes its bottom
    edge as the CSS variable `--gf-page-bar-bottom` on the document root (measured, it varies with the
    bar's rows); the header uses it as its `top`.
17. **Past, today, future.** Today's header is filled `primary`, « — Aujourd'hui » after the day; a
    future day whose tasks are all done is filled `success` (unchanged, planning-day-task-count); a
    past day's header is the neutral `grey.200` with its text in `text.secondary`, and its cards keep
    their own state and locks (the server's reception locks still apply; an admin can still tick).
18. **« Aujourd'hui » is a bar action.** The planning bar carries one icon action « Aujourd'hui »
    (`TodayIcon`, `color: 'primary'`). It scrolls today's header back under the bar — smooth, instant
    under `prefers-reduced-motion: reduce`; if windows −1…1 were released (rule 19) they are loaded
    first. The action is disabled while today's header is already at the top (± 8 px).
19. **Memory stays bounded.** At most **8 windows** (16 weeks), loaded or in flight, are kept. Adding a
    ninth releases the **loaded** window farthest from it (the opposite edge), its days and its plugin
    cards; an in-flight window is never released, and while the opposite edge is itself in flight the
    request waits (releasing would leave a gap). Releasing above keeps the view in place (rule 13's
    anchor). A released window is asked again if the scroll comes back to it.
20. **Loading and failure at an edge.** While a window is in flight, a skeleton row stands at its
    edge. A failed window shows at its edge « Ces jours n'ont pas pu être chargés. » with « Réessayer »
    (`ErrorAlert`), the loaded days stay usable and the other edge keeps extending; scrolling past the
    edge does not retry by itself. A failed opening (window 0) shows the page's `ErrorAlert` with retry.
    A plugin `load` that fails only loses that plugin's cards of that window, with the plugin's
    `errorMessage` toast (unchanged).
21. **Writes refresh what they touched.** A tick stays optimistic (unchanged). A SAS committed
    (`onDone`) reloads the loaded windows holding the stay's arrival and departure days, not the whole
    timeline. A plugin's `reload()` reloads that plugin's cards over every loaded window, each window
    with its own range.
22. **No date in the page bar.** The planning bar is « Planning » with « Aujourd'hui » and the
    `planning.actions` buttons; no arrows, no date input, no phone strip. On a phone the plugin buttons
    (custom nodes, never moved — shell-and-home-day-first rule 23) stay in the band beside
    « Aujourd'hui »; without any plugin button, the lone « Aujourd'hui » icon moves to the top bar
    (rule 23). The empty state « Rien de prévu sur les 14 prochains jours. » leaves: rule 15 says it.
23. **The server's today moves the grid.** When `useServerToday` reports a new day while the page is
    open, the timeline is rebuilt on the new today (rule 12). The SAS and breakfast deep-links
    (`?sas=…`, `?breakfast=…&date=…`) are unchanged.

### 3.E Added during implementation (2026-10-28)

24. **The opening position holds.** Cards that render late (plugin cards are lazy-loaded) can grow the
    timeline above today after it was scrolled into place. Until the operator scrolls, touches, types or
    clicks, today's header is kept under the bar whenever the timeline's height changes
    (`pinAnchor` of the shared hook, a `ResizeObserver` on the day list). A scroll the hook did not make,
    on a timeline whose height did not change, also ends it (a scrollbar drag fires no pointer event).
25. **The hook's own scroll is not a gesture.** The scroll event that follows an anchoring or a
    `scrollToAnchor` made by `useInfiniteEdgeScroll` does not restart the chain of rule 13: without it a
    short feed (an empty past, folded into one line) loaded windows without end through its own
    adjustments.

26. **A short feed never loads without end.** One operator gesture (wheel, touch, a scrolling key, or a
    scroll that is not the hook's own nor the browser's clamp after the feed changed) extends **one**
    edge and chains at most 4 windows; it never chains into the opposite edge, and only the edge in the
    direction of travel (wheel sign, scrolling key, or the scroll delta) is extended — scrolling down
    through folded content never reaches back for the window just released above. The chain also stops
    when the last load pushed that edge no farther away (an empty window folded into the run already
    drawn). Decision: stop on « no growth », not on « empty », since a window can be empty of cards yet
    add days to draw. The next gesture asks again, so pulling through a long empty stretch costs one
    window per pull. With no input the page asks nothing more.
27. **The cap counts loaded and in-flight windows** (rule 19) and evicts loaded windows only, farthest
    first, so both edges in flight cannot grow the timeline nor drop an answer.
28. **A failed refresh keeps what was drawn.** A loaded window that cannot be refreshed (a committed
    SAS, a plugin `reload`) keeps its days and shows the toast « Ces jours n'ont pas pu être
    actualisés. »; only a window that never loaded shows the edge error of rule 20.
29. **« Aujourd'hui » stays focusable.** At today's position the action is `aria-disabled` (inert,
    dimmed, still in the tab order) rather than `disabled`, so keyboard focus does not fall to the page.
    The day header is set in sans, its first letter capitalised and the month lowercase (« Mercredi 28
    octobre »: dates are never serif).

30. **A burst of input is one gesture.** A trackpad flick fires dozens of wheel events: they and the
    scroll events they cause form ONE gesture, whose chain is reset only after 200 ms without input (the
    hook's settle time) or when the operator turns around. A key typed into a field, a select, a
    `contenteditable` or a dialog, or already handled (`defaultPrevented`), is not a gesture; a touch
    gives its direction from the move (a finger going up scrolls down). The empty horizon is capped at
    **N = 1**: within one gesture the first window that brings nothing to draw (rule 26's « no growth »)
    ends the chain, so a flick over an empty planning asks once, not once per wheel event.

31. **The operator's scroll is never undone by a hold.** A wheel handler asks for a window before the
    browser applies the scroll, so the position held right before a prepend or a release may predate a
    move the operator has already made. The restore after the commit keeps that move: it undoes only the
    content's shift (the held item's screen position, minus how far the scroller moved since the hold).
    Without it, the first wheel up after opening could snap the view back under today's header.

**Edge cases:**
- Several arrivals on the next arrival day → all listed (rule 2), one row each.
- The next arrival is next year → `label` carries the year.
- Today has departures but no arrival → « Départs du jour » unfolded, « Arrivées » folded with its
  next arrival.
- A stay arriving and leaving inside one window → its arrival and departure cards on their days, its
  breakfasts between (unchanged composition).
- A window straddling a closure month (no stay for 4 months, shadow: 2 January → 19 April 2027) →
  runs of « Rien de prévu », the chain of rule 13 (4 windows) brings the next stays within a couple of
  wheel notches.
- A very long logement or client name → wraps inside the compact next-arrival row and the day cards
  (ds-sweep-planning rule 30); nothing scrolls sideways at 390 px.
- Reception account: the planning past days show their cards, every SAS of a past day locked by the
  server; the home's next-arrival rows are inert.
- The laundry (linen plugin) cards, and the laundry days specified in parallel
  (`linen-laundry-days`), arrive through the unchanged `planning.days` contribution per window: the
  host asks `load({ from, to })` for past windows too and merges whatever dates it returns.

## 4. Architecture

> Fat backend: which stays arrive and leave on which day, the next arrival and its distance in days,
> the day labels, today / past flags and every window's cards are built on the server. The client keeps
> the scroll machinery (which window to ask, anchoring, release) and draws the payload; folding empty
> days into runs is presentational layout over the drawn days, because plugin cards (loaded on the
> client by each plugin) can fill a day the server sees as empty.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `planning.js` | T | `GET /today`, `GET /days`; `GET /alerts` and `GET /option-cards` removed (rule 10) |
| `controllers/` | `planningController.js` | T | `today` and `days` handlers: validate the window (rule 9), assemble the payload, apply the reception view; `alerts` / `optionCards` methods removed |
| `models/` | `planningDaysModel.js` | C | Ids of the stays starting / ending in `[from, to]` and the first arrival day after a date (`kind = 'reservation'`, order of rule 1), one prepared statement each |
| `models/` | `breakfastModel.js`, `planningOptionCardsModel.js`, `planningAlertsModel.js` | — | Reused as is (range reads) |
| `models/` | `reservationsModel.js` | — | `getByIdWithDetails` reused for the stay shape |
| `utils/` | `planningDays.js` | C | Pure: the window's day list (every date, labels, `isToday` / `isPast`), grouping of stays by day, `relativeLabel`, the 31-day bound; French labels via `frenchDayLabel` |
| `utils/` | `upcomingArrivals.js` | T | `frenchDayLabel` gains the year outside the current year (used by both) — `/reservations/upcoming` keeps its current labels for this year's days |
| `utils/` | `receptionView.js` | — | `toReceptionReservationView` reused |
| `middleware/` | `enforceRoleAccess.js` | — | No change: `GET /planning/*` already open to reception (drift test updated for the two removed paths only if it lists them) |
| `scheduledTasks.js`, `database.js` | — | — | None |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `Dashboard.jsx` | T | One `getPlanningToday()`; folded lines (rule 4); « Prochaine arrivée » (rule 5); date cluster, `pickedDate`, `addIsoDays`, the phone strip and the `getReservations` / `getReservation` calls removed |
| `pages/` | `PlanningPage.jsx` | T | Renders the timeline from `usePlanningTimeline`; « Aujourd'hui » action; date cluster, `startDate`, `DAYS_AHEAD`, the five-call loader, the window scroll listener and the client grouping of days removed |
| `components/` | `NextArrivalBlock.jsx` | C | Specific (home): the date head + compact rows of rule 5 |
| `components/` | `FoldedDayList.jsx` | C | Generic: a section title + one muted line when its list is empty, else its children (home lists; the « Réservations à venir » day sections and the console are candidates) |
| `components/` | `PlanningDayHeader.jsx` | C | Specific: the sticky day header (today / done / past tones, task chip), extracted from `PlanningPage.jsx:650-681` |
| `components/` | `PageActionBar.jsx` | T | Publishes `--gf-page-bar-bottom` on `document.documentElement` (ResizeObserver; removed on unmount) |
| `hooks/` | `useInfiniteEdgeScroll.js` | C | **Generic, shared**: bidirectional edge detection, prepend/release anchoring, bounded chaining and scroll-to-anchor, for a scroller element **or** the window, over any ordered keys carrying a `data-scroll-anchor` attribute |
| `hooks/` | `usePlanningTimeline.js` | C | Specific: the window grid (rule 11), per-window state (loading / loaded / failed), the plugin loads per window, the 8-window cap, targeted reloads (rule 21) |
| `hooks/` | `useServerToday.js` | — | Reused |
| `utils/` | `planningTimeline.js` | C | Pure: merges windows + plugin dates into the drawn sequence of days and « Rien de prévu » runs (rule 15) |
| `utils/` | `planningDayTasks.js`, `planningDayOrder.js` | — | Reused unchanged |
| `constants/` | `planningCopy.js` | C | French strings of both pages (« Rien de prévu », « Aucun départ aujourd'hui », « Prochaine arrivée », edge error) |
| `api.js` | `api.js` | T | `getPlanningToday()`, `getPlanningDays({ from, to })`; `getPlanningAlerts`, `getPlanningOptionCards` removed |

**Shared scroll hook — coordination with `calendar-property-parity`.** The general calendar's
`useInfiniteMonthScroll` is the behaviour reference; it is month-shaped and bound to an inner scroller,
and the parallel spec `calendar-property-parity` reuses it for the property calendar. This spec does
**not** modify it: it adds `useInfiniteEdgeScroll`, the same mechanism (anchor kept on prepend,
pending edge released on commit, bounded chain) cut free of months and of the scroller kind. Once both
specs have landed, `useInfiniteMonthScroll` can become a thin month wrapper over it (out of scope,
§8) — so the two specs never edit the same hook in parallel.

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `ResponsiveTable`, `ErrorAlert`, `LoadingState`, `ReservationCard`, `DepartureMiniRow`, `OptionDayCard`, `BreakfastPrepDialog`, `Slot`, `CollectionStatusCell` | Unchanged contracts. |
| **Created (new generic)** | `FoldedDayList`, `useInfiniteEdgeScroll` | `FoldedDayList`: any titled list whose empty state should take one line (home today; upcoming-reservations day sections next). `useInfiniteEdgeScroll`: the planning now, the month calendars after the follow-up, any future infinite feed (email history). |
| **Specific (kept feature-local)** | `NextArrivalBlock`, `PlanningDayHeader`, `usePlanningTimeline` | Tied to the home's next-arrival rule and to the planning's window grid. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/planning/today` | — | `{ today, departures: Stay[], arrivals: Stay[], nextArrival: null \| { date, label, relativeLabel, reservations: Stay[] } }` | Admin + reception (reception view). Rules 1–3. |
| GET | `/api/planning/days` | `?from&to` (≤ 31 days) | `{ from, to, today, days: Day[], alerts: { arrivals: {[id]: Alert}, departures: {[id]: Alert} } }`, `Day = { date, label, shortLabel, isToday, isPast, arrivals: Stay[], departures: Stay[], breakfast: null \| { items, totalPersons }, optionCards: null \| { items } }` | 400 `INVALID_DATE_RANGE`. Rules 8–9. |
| GET | `/api/planning/alerts` | — | — | **Removed** (rule 10). |
| GET | `/api/planning/option-cards` | — | — | **Removed** (rule 10). |

`Stay` = the `getByIdWithDetails` shape (admin) or its `toReceptionReservationView` (reception) — the
shape `ReservationCard`, `DepartureMiniRow` and the home rows already read.

Example (`GET /api/planning/today`, server day 2026-10-28, shadow data, names invented):

```json
{ "today": "2026-10-28", "departures": [], "arrivals": [],
  "nextArrival": { "date": "2026-11-06", "label": "vendredi 6 novembre", "relativeLabel": "dans 9 jours",
    "reservations": [{ "id": 412, "startDate": "2026-11-06", "checkInTime": "16:00",
      "propertyName": "La Granja", "firstName": "Camille", "lastName": "Rivière", "doubleBeds": 1, "…": "…" }] } }
```

## 5. Data model

None. No migration.

## 6. UI / UX

- **Home, desktop (≥ 1200)**: bar « Tableau de bord » with nothing centred; pinned cards; « Départs du
  jour » (table, or one folded line); « Arrivées du jour » (table, or one folded line followed by the
  « Prochaine arrivée » block: « vendredi 6 novembre » in 1.25 rem bold sans, chip « dans 9 jours »,
  rows in a white card with hairline separators); « À traiter »; the month calendar.
- **Home, phone (≤ 600)**: no page band (no action left); folded lines are 48 px tall; the next-arrival
  rows stack hour · logement on the first line, client and beds on the second; long names wrap.
- **Planning, desktop**: bar « Planning » with « Aujourd'hui » and the laundry button; the timeline opens
  with today's header under the bar; scrolling up reveals past days (muted headers), scrolling down the
  future; sticky day header; « Rien de prévu » runs as one muted line between headers; a skeleton row at
  an edge in flight.
- **Planning, phone**: band with « Aujourd'hui » + laundry button (or « Aujourd'hui » in the top bar
  when no plugin button); same timeline, cards full width; sticky header under the band; no horizontal
  scroll at 390 px.
- **Motion**: « Aujourd'hui » scrolls smoothly (`scroll-behavior` / `scrollTo({ behavior: 'smooth' })`),
  instant under `prefers-reduced-motion`; prepend and release never move the visible content (no
  jump). No other motion is added.
- **Copy** (`constants/planningCopy.js`): « Départs du jour », « Arrivées du jour », « Aucun départ
  aujourd'hui », « Aucune arrivée aujourd'hui », « aucune arrivée prévue », « Prochaine arrivée »,
  « Rien de prévu », « Rien de prévu aujourd'hui », « Ces jours n'ont pas pu être chargés. »,
  « Réessayer », « Aujourd'hui ».

## 7. Test plan

### Server unit tests
- [x] `tests/planning-today.unit.test.js` (8) — rule 1 (departures / arrivals of the day, order by
  hour then id, devis and cancelled excluded, model shape not the fiche), rule 2 (next arrival when
  none today, every stay of that day, « demain » / « dans N jours », year in the label next year, null
  with arrivals today, null with nothing after today), rule 3 (reception view with locks, accountant
  403 through the route).
- [x] `tests/planning-days.unit.test.js` (10) — rule 8 (every date of the window, empty ones
  included; stays by start / end day and order; breakfast, option cards and alerts on their days;
  labels, `isToday`, `isPast`; reception view), rule 9 (malformed, unreal day, `from > to`, 32 days →
  400; a past window answered), rule 10 (`/alerts` and `/option-cards` → 404).
- [x] `reception-role-access.unit.test.js`, `plugins/linen/tests/phase-2-linen.unit.test.js` — the removed
  paths replaced by the two new ones (`planning-breakfast-controller.unit.test.js` listed none).

### Client tests (Vitest)
- [x] `pages/__tests__/Dashboard.next-arrival.test.jsx` (9) — rules 1 (one `getPlanningToday`, no
  `getReservations` / `getReservation`), 4 (folded lines, no table), 5 (date head, relative chip, rows,
  no check box, row opens the fiche, reception row inert, « aucune arrivée prévue »), 6 (no
  « Date affichée », no arrows).
- [x] `pages/__tests__/Dashboard.server-today.test.jsx`, `Dashboard.stale-load.test.jsx`,
  `Dashboard.day-first.test.jsx` — rewritten on `getPlanningToday` (rule 7: reload on a new server
  day, only the latest load paints); the rule-19 case (« Aujourd'hui » of the date cluster) deleted.
- [x] `hooks/__tests__/useInfiniteEdgeScroll.window.test.jsx` (8, rules 24 and 25 included) — rule 13 (prepend keeps the first
  visible anchor in place on the window and on an element scroller; chain bounded at 4), rule 19
  (release above keeps the view), rule 18 (scroll to an anchor, instant under reduced motion).
- [x] `utils/__tests__/planningTimeline.test.js` (6) — rule 15 (runs of empty days, one-day label,
  today never folded, a run never crosses today, a plugin-only day is not empty, windows merged in
  order).
- [x] `pages/__tests__/PlanningPage.timeline.test.jsx` (11) — rules 11 (one call per window, plugin
  `load` per window, no double ask), 12 (windows −1, 0, 1 at open, today under the bar), 14 (an empty
  window followed by a full one keeps loading), 17 (past header tone), 18 (« Aujourd'hui » scrolls,
  disabled at today), 19 (ninth window releases the farthest), 20 (edge error with retry, other edge
  still extends), 21 (SAS done reloads the two windows only), 22 (no date input, bar actions), 23 (new
  server day rebuilds).
- [x] `PlanningPage.phone-bar.test.jsx` (2: the band with a plugin button, the top bar without), `PlanningPage.plugin-slots.test.jsx`,
  `PlanningPage.arrival-alerts.test.jsx` — moved to `getPlanningDays`; phone-bar pins rule 22 (plugin
  buttons beside « Aujourd'hui », no date strip).
- [x] `components/__tests__/PageActionBar.bar-bottom.test.jsx` (2) — rule 16 (variable published,
  removed on unmount).
- [x] `components/__tests__/FoldedDayList.render.test.jsx` (2) — rule 4.
- [x] `pages/__tests__/PlanningPage.timeline.test.jsx` gains rule 29 (12 in all).
- [x] `components/__tests__/PageActionBar.aria-disabled.test.jsx` (2) — rule 29.
- [x] `hooks/__tests__/usePlanningTimeline.windows.test.jsx` (3) — rules 27, 28; `useInfiniteEdgeScroll.window.test.jsx` gains rules 24 and 26 (14 in all).
- [x] `hooks/__tests__/useInfiniteEdgeScroll.scrolled-before-commit.test.jsx` (2) — rule 31.

### E2E (Playwright)
- [x] New `e2e/specs/planning/timeline-scroll.spec.js` — opens on today under the bar; wheel up shows
  yesterday without the view jumping; wheel down past an empty fortnight reaches a stay 8 weeks out
  (rule 14); « Aujourd'hui » comes back; no date input on the page.
- [x] New `e2e/specs/dashboard/next-arrival.spec.js` — a day without arrival shows « Prochaine
  arrivée » with its date; departures folded (the day's lists are fixed by answering
  `GET /api/planning/today`, the shared E2E database holding stays of other specs; the real payload's
  shape is pinned alongside).
- [x] Updated: `mobile/planning-mobile.spec.js` (no date strip; bar still visible after scroll; no
  horizontal scroll), `mobile/narrow-bar-and-touch-targets.spec.js` (the 900 px rule-19 pin moves from
  the dashboard's date input to `/calendar`'s centre), `auth/dashboard-loads`.

### Manual UI verification
- [x] Shadow copy at 390 / 1280 (900 not exercised by script): home on 2026-10-28 (both folded, next arrival 6 November);
  planning scrolled from today to April 2027 and back to September 2026, sticky headers, no jump on
  prepend, « Aujourd'hui », network panel = one `/planning/days` per window (+ plugin loads).

## 8. Out of scope

- Rebasing `useInfiniteMonthScroll` (general and property calendars) onto `useInfiniteEdgeScroll` — a
  follow-up once `calendar-property-parity` has landed.
- Laundry days and their tasks in the planning (`linen-laundry-days`): they come through the
  unchanged `planning.days` contract. The linen plugin's `loadLaundryDays` re-reads four
  window-independent lists (inventory, skips, additions, extra trips) for every window; caching them
  inside the plugin belongs to that spec or to the performance work.
- Virtualising the planning's DOM: the 8-window cap bounds it.
- A date jump (« aller au 15 mars ») on the planning: removed on purpose; the general calendar opens
  any day's stays.
- « Réservations à venir » page: unchanged (its own endpoint).

## 9. Open questions

None open. Resolved 2026-10-28 (Adrien, all four = the recommendations):

- Q1 — Resolved 2026-10-28: the « Prochaine arrivée » rows are **compact lines without check boxes**
  (rule 5); the operational ticks stay with the day itself and the Planning.
- Q2 — Resolved 2026-10-28: empty planning days are **folded into « Rien de prévu » runs** (rule 15).
- Q3 — Resolved 2026-10-28: the planning scrolls back **without limit** (one call per fortnight, the
  8-window cap of rule 19 bounds the memory).
- Q4 — Resolved 2026-10-28: `useInfiniteEdgeScroll` is created here; `useInfiniteMonthScroll` is **not
  touched** (another branch rebuilds the calendars in parallel) and is rebased later (§8).

## 10. Amendments to existing specs (applied with the implementation)

Notes appended under the rules, never renumbered:

- `shell-and-home-day-first.md` rule 1 — « the page bar (date) » → « the page bar »; rule 19 — «
  Superseded 2026-xx: the home has no date navigation (dashboard-planning-scroll rule 6) »; rule 26 —
  « Amended: the plugin buttons stay in the band beside « Aujourd'hui » (dashboard-planning-scroll
  rule 22) »; §6 — no date cluster.
- `ds-sweep-planning.md` rules 1 and 2 — superseded (rules 6 and 22 here); rule 28 — the dashboard and
  the planning still load nothing before the server's day; « the date arrows » gone; rule 29 — « a date
  the operator picked stays picked » gone: a new day reloads the home and rebuilds the planning
  (rules 7, 23).
- `upcoming-reservations-cards.md` rule 7 — the dashboard's day and the planning's first day are the
  server's today with no picker; rule 9 — the stale-load guard now covers the server day moving on and
  « Réessayer » only.
- `ds-components.md` rule 19 test note — the 900 px pin uses `/calendar`.
- `planning-chronological-day-ordering.md` §UI, `weekly-bed-linen-tracking.md` §3.6,
  `skip-laundry-trip.md` (follow-up #2 note) — « DAYS_AHEAD / 14-day window » now reads « the loaded
  windows of the timeline ».

## 11. Implementation lots

1. **Lot 1 — Home** (ships alone): `GET /api/planning/today`, `planningDaysModel` (arrivals / departures
   / next arrival), `utils/planningDays.js` (labels), Dashboard rules 4–7, `FoldedDayList`,
   `NextArrivalBlock`, tests of rules 1–7, E2E next-arrival + the 900 px pin move, amendments of
   shell-and-home-day-first rules 1 / 19. ~12 files.
2. **Lot 2 — Planning server**: `GET /api/planning/days`, removal of `/alerts` and `/option-cards`
   (with Lot 3 in the same PR — rule 10 forbids leaving the client on removed routes). ~6 files.
3. **Lot 3 — Planning timeline**: `useInfiniteEdgeScroll`, `usePlanningTimeline`, `planningTimeline.js`,
   `PlanningDayHeader`, `PageActionBar` variable, PlanningPage rules 11–23, tests and E2E, remaining
   amendments. ~16 files.

## 12. Implementation progress

Implemented 2026-10-28 on `feature/dashboard-planning-scroll`, three commits, in this order: server
(`/today`, `/days`, removed routes), home (lot 1), planning timeline (lot 3). Notes where the code
differs from the draft above:

- `planningDaysModel` returns `[{ id, date }]` rows for a window (`arrivalsInRange`,
  `departuresInRange`) and the first arrival day after a date; `utils/planningDays.js` holds the
  window arithmetic (`windowDays`, `checkWindow`, `relativeLabel`, `idsByDate`). `frenchDayLabel` takes
  an optional `today` to add the year.
- `useInfiniteEdgeScroll` asks its feed through `onNearStart` / `onNearEnd`, which answer `'started'`,
  `'pending'` or `'none'`; it does not own the feed's in-flight state. It also offers `pinAnchor`
  (rule 24) and ignores its own scroll events (rule 25).
- The 8-window cap (rule 19) releases the opposite-edge loaded window when a ninth is **requested**
  (reviewed 2026-10-28: releasing at load let both edges in flight grow the timeline).
- Folds are keyed by their last day (`fold-<to>`): content prepended to a run extends it at the start and
  the anchor key does not change.
- `PlanningDayHeader` carries `data-tone` (`today` / `past` / `done` / `upcoming`) for the tests.
- Plugin cards: `buildTimeline` merges what every window's contributions returned by date, a window's
  own range winning over another window's answer for the same date.
- Real-data check (shadow copy of 2026-10-22, server day 2026-10-28): home at 1280 and 390 (both
  lists folded, next arrival « vendredi 6 novembre · dans 9 jours »), planning opened on today under the
  bar, scrolled back to September and on to April 2027, « Aujourd'hui » back, one `/planning/days` per
  window, a window asked again only after it was released, no horizontal scroll.

