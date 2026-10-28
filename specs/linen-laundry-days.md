# Laundry days — several trips a week and a laundry turnaround

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/linen-laundry-days` _(user-managed)_ |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Plugin** | `linen` (Linge et blanchisserie) — 1.1.2 → **1.2.0** (both lots in one release) |
| **Amends** | [weekly-bed-linen-tracking.md](weekly-bed-linen-tracking.md) (rule 37), [linen-inventory-shortage-tracking.md](linen-inventory-shortage-tracking.md) (rule 18), [skip-laundry-trip.md](skip-laundry-trip.md) (rule 15), [laundry-extra-trip.md](laundry-extra-trip.md) (rule 21) |
| **Coordinates with** | `dashboard-planning-scroll` (Planning as an infinite past/future scroll — this spec only needs the existing per-day `planning.days` slot) |
| **HTML summary** | [docs/specs/2026-10-28-linen-laundry-days.html](../docs/specs/2026-10-28-linen-laundry-days.html) |

---

## 1. Context

Feedback of 2026-10-28 on the `inte/plugins` shadow: « Dans la page Linge, il faut pouvoir ajouter des
jours de blanchisserie, c'est à dire qu'on pourrait bien apporter à la blanchisserie le mardi et
jeudi, il faut donc pouvoir l'ajouter dans cette page et en tenir compte dans la page Planning et aussi
dans le calcul du stock. »

What the code does today (`origin/inte/plugins` 714ed5e4):

- **One laundry weekday, period.** The `linen` plugin stores a single integer setting
  `laundryWeekday` (default 2 = Tuesday) — [settings.js:9-16](../server/src/plugins/linen/settings.js#L9-L16).
  The Linge page edits it with a single `Select` — [SettingsLaundrySection.jsx:47-60](../client/src/plugins/linen/SettingsLaundrySection.jsx#L47-L60).
- **The « week » is hard-coded everywhere.** The windows and lookbacks step in 7-day jumps:
  `findLaundryDaysInRange`, `previousNonSkippedLaundryDay`, `previousNonSkippedRegularBefore`
  ([laundryWindow.js:50-126](../server/src/plugins/linen/laundryWindow.js#L50-L126)); the trip ledger
  tests `weekdayOf(date) === weekday` ([laundryTripLedger.js:124](../server/src/plugins/linen/laundryTripLedger.js#L124));
  the stock engine seeds `atLaundry` from a 7-day window and tests the same equality per day
  ([linenInventory.js:312-336, 387](../server/src/plugins/linen/linenInventory.js#L312-L336)).
  A second weekday cannot be expressed without touching all three.
- **No laundry turnaround.** Linen dropped on a trip comes back on the *next* trip, whatever the gap: a
  regular trip « takes the whole pool back » ([laundryTripLedger.js:147-157](../server/src/plugins/linen/laundryTripLedger.js#L147-L157),
  [linenInventory.js:401-410](../server/src/plugins/linen/linenInventory.js#L401-L410)). With one trip
  a week this was harmless (7 days ≥ any laundry delay). With Tuesday + Thursday it silently assumes a
  48-hour laundry: if the laundry needs three days, the Thursday pick-up and the stock projection are
  both wrong — and the shortage forecast, the one figure meant to warn ahead, is optimistic.
- **Changing the weekday rewrites the past.** [weekly-bed-linen-tracking.md](weekly-bed-linen-tracking.md)
  rule 10 says a change « applies prospectively, past windows aren't recomputed ». The code does the
  opposite: every window is computed from the current setting, so moving Tuesday → Wednesday moves
  every past card too. Harmless while the Planning only looked forward; wrong once
  `dashboard-planning-scroll` lets the operator scroll into the past.
- **The stock engine's initial state is a pile of special cases**: a 7-day-guarded seed, the
  `seedIsTodaysDrop` exception, a replay of past extra trips, and a pinned « known approximation »
  ([linenInventory.js:295-375](../server/src/plugins/linen/linenInventory.js#L295-L375),
  [laundry-extra-trip.md](laundry-extra-trip.md) rule 13). Each assumes a weekly cycle.
- **The client still shapes the laundry days.** `planningDays.js` merges five endpoints, sums the
  counts and decides which day is shown ([planningDays.js:5-44](../client/src/plugins/linen/planningDays.js#L5-L44)) —
  a CLAUDE.md §6.0 violation, and five requests per scroll window.
- **Small bug met on the way**: the shortage alert's labels miss the bath mat, so a bath-mat shortage
  reads « bathMat » ([shortageController.js:6-13](../server/src/plugins/linen/shortageController.js#L6-L13)).

The Planning already has the generic extension point this needs: the `planning.days` slot, whose
`load({ from, to })` returns `{ [date]: entry }` and whose host merges windows as the scroll reaches
them ([PlanningPage.jsx:195-240](../client/src/pages/PlanningPage.jsx#L195-L240)). **No core change.**

## 2. Goal

The operator declares the days the linen goes to the laundry (e.g. Tuesday and Thursday) and how long
the laundry keeps it; every laundry day of the Planning then says what to bring and what to collect,
and the stock forecast knows the linen is unavailable until it actually comes back.

## 3. Functional rules

### 3.1 The laundry schedule

1. **A schedule is a set of weekdays and a turnaround.** `weekdays`: one to seven distinct weekdays
   (`0` = Sunday … `6` = Saturday, `Date.getDay()` convention). `turnaroundDays`: an integer from **1 to
   14** — linen dropped on day `D` is ready from `D + turnaroundDays`. Global to the establishment (one
   person, one laundry), like skips and extra trips.
2. **Every laundry day is one visit: drop-off and pick-up.** On a laundry day the operator brings the
   dirty linen and collects what is ready. No drop-only or pick-up-only day.
3. **Validation is the server's.** `PUT /api/laundry/schedule` refuses, with `400` and nothing written:
   an empty set (`LAUNDRY_WEEKDAYS_EMPTY`, « Au moins un jour. »), a value outside 0..6 or a duplicate
   (`LAUNDRY_WEEKDAY_INVALID`, « Jour invalide. »), a turnaround that is not an integer in 1..14 —
   `2.5`, `0`, `15`, `"abc"` are refused, never rounded (`LAUNDRY_TURNAROUND_INVALID`, « Entre 1 et 14
   jours. »).
4. **Existing installs keep their behaviour exactly.** The migration turns `laundryWeekday = W` into the
   schedule `{ weekdays: [W], turnaroundDays: 1 }` (absent or invalid → `[2]`). With one weekday every
   batch waits 7 days ≥ 1, so every regular trip, pick-up and projected figure is unchanged — pinned by
   running the existing ledger and engine suites unmodified against the migrated schedule
   (except the tests listed in §7.4). A fresh install starts with `{ [2], 1 }`.
5. **A change applies from tomorrow; the past keeps its rhythm.** The schedule is stored as dated
   versions. Saving writes the version effective **tomorrow** (server date + 1); saving again before
   tomorrow overwrites that pending version. A date `D` follows the version with the greatest
   `effectiveFrom ≤ D`. Tomorrow and not today: today's trip may already be done, and dropping today from
   the schedule after the trip would erase its drop-off from the stock. The migration's version is
   effective from `0001-01-01`. _(Arbitration A1 — recommended option.)_
6. **A batch's readiness is fixed at drop-off.** `readyFrom = dropDate + turnaroundDays` of the version
   in force on `dropDate`. A later change of turnaround does not move batches already at the laundry.
7. **The cycle is described by the server.** For a candidate schedule the server returns, per weekday,
   the weekday the batch comes back and the wait: `{ dropWeekday: 2, pickUpWeekday: 4, waitDays: 2 }`
   (« Déposé mardi → récupéré jeudi »), the first laundry day where it would apply, and
   `longestWaitDays`. The Linge page renders it; it computes nothing (`POST /api/laundry/schedule/preview`,
   no write, same validation as rule 3).

### 3.2 Trip sequence and the Planning card

8. **A regular laundry day** is a date whose weekday belongs to the version in force on that date. The
   trip sequence stays « non-skipped regular days ∪ active extra trips », sorted
   ([laundry-extra-trip.md](laundry-extra-trip.md) rule 7); `prevTrip(T)` walks it back day by day
   instead of in 7-day jumps, within the same 28-day lookback (the bound is inclusive), with the same
   `T − 7` fallback.
9. **Drop-off(T)** keeps its formula: reservation linen with `endDate ∈ (prevTrip(T), T]` plus the
   signed manual lines of that window, floored at 0 per type. With Tuesday + Thursday, Thursday carries
   the departures of Wednesday and Thursday; Tuesday those of Friday to Tuesday.
10. **Pick-up(T) = the batches that are ready.** The laundry holds a list of batches
    `{ dropDate, readyFrom, counts }`. A regular trip on `T` collects every batch with `readyFrom ≤ T`;
    a batch not ready yet stays at the laundry. An extra trip with « tout récupérer » collects every
    ready batch; a partial extra trip collects `min(ready, declared)` per type, oldest batch first. With
    one weekday and `turnaroundDays ≤ 7` this is exactly today's « the whole pool ». The extra-trip preview
    (`GET /api/laundry/extra-trips/preview`) therefore offers, as `atLaundry`, what is **ready on that
    date** — the quantities a partial pick-up can declare.
11. **The card says where the pick-up comes from.** `pickUp.fromTrips` lists the drop dates collected
    (« déposé mar. 21 »). When batches dropped **before** `T` are still at the laundry after its pick-up (`T`'s own drop is
    not counted — it obviously is), the entry carries
    `stillAtLaundry: { counts, readyOn }` — `readyOn` the earliest `readyFrom` among them — and the card
    adds one line: « Encore à la blanchisserie : 4 doubles · prêt jeu. 23 ».
12. **Skips and extra trips follow the schedule of their date.** A skip means something only on a
    regular day of the version in force on that date; elsewhere it stays inert (today's rule). An extra
    trip is refused on any regular day of the version in force on its date (`400
    EXTRA_TRIP_ON_LAUNDRY_DAY`); a stored skip or extra trip that a later change turns inert is kept, not
    deleted — reverting the change brings it back.
13. **One per-day payload for the Planning.** `GET /api/planning/laundry/days?from&to` (both required,
    bounded by `checkPlanningRange`) returns `{ days: { [date]: card } }` holding **only the dates to
    draw**: the server decides — a regular day with something to bring or collect, an extra trip, a
    skipped day (always drawn so it can be reverted), a day whose drop-off has incomplete stays, a day
    with `stillAtLaundry`, or any day with linen on either side (bath mats included). Each card is ready
    to render (§4.3). It answers any window, past or future,
    so the infinite scroll can page it; `inventoryAfter` is present only for dates from today to the
    horizon (no projection of the past). The client's `planningDays.js` becomes one call: no sum, no
    filter.
14. **The laundry card is not a ticked task.** It keeps counting zero in the day counter
    ([planning-day-task-count.md](planning-day-task-count.md)); « non réalisé » stays the only state the
    operator records. _(Arbitration A3 — recommended option.)_

### 3.3 Stock projection

15. **`atLaundry` is a list of batches, not a pool.** Each trip day of the engine, in this order:
    collect the ready batches (rule 10) → check-ins → manual line → drop the whole dirty pile as a new
    batch with its `readyFrom`. Dirty linen, and linen at the laundry before its `readyFrom`, is not
    available to an arrival. Conservation `clean + inCirculation + dirty + atLaundry = stock` holds every
    day, every type. A manual line is applied on its own date **whatever that date is** (the Planning
    window sums already count it), so a line left on a date that a schedule change turned into a
    non-laundry day still reaches the next trip instead of vanishing from the projection.
16. **The initial state is a replay, not a seed.** The engine starts at `today − 42` (28-day skip
    lookback + the 14-day maximum turnaround) with the stays in progress on that date installed, the rest
    of the stock clean, nothing dirty and nothing at the laundry, and replays every day up to the horizon
    with the same loop — skips, extra trips and manual lines included. Days before today are neither
    emitted nor counted as shortages. This replaces the 7-day seed, `seedIsTodaysDrop`, the extra-trip
    replay and its pinned approximation ([laundry-extra-trip.md](laundry-extra-trip.md) rule 13): one
    code path, which knows nothing about weeks. Reservations are fetched with `endDate ≥ today − 42`.
17. **The Planning and the projection agree.** For every trip date of a window, the counts the card
    shows (drop-off, pick-up, still at the laundry) equal the engine's moves that day, for the reservation
    linen and the manual lines — pinned by one test over a Tuesday + Thursday month with a skip, an extra
    trip, a partial pick-up and a turnaround change.
18. **A shortage says when it ends.** Each type of `GET /api/dashboard/linen-shortage` gains
    `recoversOn`: the first date after `firstShortageDate` where `clean ≥ 0` again (`null` when not
    within the horizon). The alert adds « jusqu'au mar. 28 » — when the laundry brings it back. The
    labels gain the bath mat (« Tapis de bain »).

### 3.4 Linge page

19. **« Blanchisserie » card.** Seven day toggles (Monday first: L M M J V S D) and a « Linge prêt
    après » stepper (1–14, « jour » / « jours »). Below them, the cycle the server described (rule 7), one
    line per laundry day: « Mar. → jeu. · 2 j ». Under the fields: « À partir de demain, mer. 29 oct. »
    when the draft differs from the version in force. The stock cards below are unchanged.
20. **The refusals are visible before Save.** Unticking the last day keeps it ticked, shakes the row and
    shows « Au moins un jour. »; the stepper's « − » is disabled at 1 and « + » at 14; a typed value
    outside 1..14 or not an integer shows « Entre 1 et 14 jours. » and disables Save. These mirror
    rule 3 for comfort; the server's answer is what counts, and its message replaces the client's.
21. **Saving.** The `PageActionBar` Save writes the stock (`PUT /api/plugins/linen/settings`, unchanged)
    and, when it changed, the schedule (`PUT /api/laundry/schedule`). Cancel restores both. The dirty-form
    guard covers both. A schedule refusal keeps the draft and shows the server message under the field.
22. **Pending version.** When a version effective tomorrow exists, the page shows it (it is what was
    saved) with the caption « À partir de demain, mer. 29 oct. — aujourd'hui : mardi ». Reverting the
    draft to the version in force and saving deletes the pending version.

### 3.5 Roles, purge, plugin

23. **Admin writes, reception reads.** `GET /api/laundry/schedule` is readable by the reception (existing
    `GET /laundry/*` matcher); `PUT` and `POST …/preview` are admin-only (not added to the reception
    allowlist). `GET /api/planning/laundry/days` is a planning read (existing `GET /planning/*` matcher).
24. **Purge.** `laundry_schedule_versions` joins the plugin's data tables; « Effacer aussi ses données »
    drops it and the describe line reads « le rythme de blanchisserie ». A reinstall starts from
    `{ [2], 1 }`.
25. **Plugin release.** `linen` 1.2.0, changelog lines in French, impersonal, short: « Plusieurs jours de
    blanchisserie par semaine. », « Délai de la blanchisserie : le linge revient quand il est prêt, et le
    stock le sait. », « Une rupture de linge dit jusqu'à quand. »

**Edge cases:**
- All seven days ticked, turnaround 1 → a trip every day; each drop comes back the next day.
- One weekday, turnaround 10 → a batch waits two weeks (`longestWaitDays: 14`); the preview says so.
- Tuesday + Thursday, turnaround 3 → Tuesday's batch is ready Friday, collected next Tuesday (7 j);
  Thursday's ready Sunday, collected Tuesday (5 j). Tuesday collects both; Thursday collects nothing and
  its card shows only « À apporter » and « Encore à la blanchisserie ».
- Skipped Tuesday with Tuesday + Thursday → Thursday brings the dirty linen since the previous Thursday
  and collects every ready batch, Tuesday's deferred ones included.
- Today is a laundry day and the operator removes it → today stays a trip (rule 5); tomorrow on the new rhythm.
- Change Tuesday → Tuesday + Thursday with a stored extra trip next Thursday → the extra trip becomes
  inert, the Thursday card is a regular one; removing Thursday again revives the extra trip.
- A batch dropped under turnaround 1, turnaround raised to 3 the next day → that batch is still ready
  after 1 day (rule 6).
- Stock 0 for a type → untracked, no figure, no shortage (unchanged).
- A window entirely in the past → cards without `inventoryAfter`.

---

## 4. Architecture

Everything lives in the `linen` plugin. **The core is not touched**: the `planning.days` slot and its
per-day `load({ from, to })` contract already exist; the reception matchers already cover the new paths.

### 4.1 Server side (`server/src/plugins/linen/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| utils (pure) | `laundrySchedule.js` | C | The schedule as a value: `createSchedule(versions)` → `versionOn(date)`, `isRegularDay(date)`, `readyFrom(dropDate)`, `regularDaysInRange(from, to)`; `validateSchedule(input)` (rule 3); `describeCycle(schedule)` (rule 7). No DB. |
| utils (pure) | `laundryWindow.js` | T | One day-by-day walk (`previousMatchingDay(date, matches, lookback)`) replaces the 7-day jumps; the single-weekday helpers go. |
| utils (pure) | `laundryBatches.js` | C | The linen at the laundry as batches `{ dropDate, readyFrom, counts }`: `addBatch`, `collectBatches` (all ready / partial oldest first), `totalOf`. Shared by the ledger (`singleBeds`… keys) and the engine (`single`… keys). |
| utils (pure) | `laundryTripLedger.js` | T | Takes a `schedule` instead of a `weekday`; the pool becomes a batch list with `readyFrom` (rules 10-11), replayed from the last non-skipped regular trip before the date (that trip collected everything ready), or from 42 days back when there is none; emits `pickUp.fromTrips` and `stillAtLaundry`. |
| utils (pure) | `linenInventory.js` | T | `atLaundry` as batches (rule 15); warm-up replay from `today − 42` replacing the seed logic (rule 16); `recoversOn` per type (rule 18); the days it emits also carry `dropped`, `pickedUp` and `batches`. Takes `schedule` instead of `laundryWeekday`. |
| models | `laundryScheduleModel.js` | C | `laundry_schedule_versions`: `listAll()`, `upsertPending(tomorrow, schedule)`, `deletePending(tomorrow)`. |
| models | `linenInventoryModel.js` | T | Reads the schedule model; fetch lookback 35 → 42 days. |
| controllers | `laundryScheduleController.js` | C | `GET` (current + pending), `PUT` (validate → upsert or delete the pending version), `POST preview` (validate → `describeCycle`). |
| controllers | `planningController.js` | T | New `laundryDays(req, res)` composing ledger + engine + skips + manual lines + extra trips into the per-day cards and the `shown` decision (rule 13). `laundrySummary` and `linenInventory` are removed with their last consumer. |
| controllers | `extraTripsController.js` | T | « Regular day » check through the schedule of the trip's date (rule 12). |
| controllers | `shortageController.js` | T | `recoversOn`, bath-mat label (rule 18). |
| routes | `routes.js` | T | `GET/PUT /schedule`, `POST /schedule/preview` under `/api/laundry`. |
| plugin entry | `index.js` | T | Wires the model/controller; `ctx.route('get', '/api/planning/laundry/days', …)`; data table + describe line (rule 24); drops the two removed routes. |
| settings | `settings.js` | T | `laundryWeekday` stays declared (rollback to 1.1.x reads it) but is no longer read nor written: `read()` returns the stock only, the Linge page stops sending it. |
| database | `migrations.js` | T | `laundry_schedule_v1`: create the table, seed one version from `laundryWeekday` (rule 4). |
| manifest | `manifest.json` | T | 1.2.0 + changelog (rule 25). |
| middleware / tasks / core `database.js` | — | — | None. |

### 4.2 Client side (`client/src/plugins/linen/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| page | `LinenStockPage.jsx` | T | Loads `GET /api/laundry/schedule`; tracks the schedule draft in the dirty guard; saves both (rule 21). |
| component | `LaundryScheduleSection.jsx` | C | Replaces `SettingsLaundrySection.jsx`: day toggles, turnaround stepper, server cycle, refusals (rules 19-20, 22). |
| component | `SettingsLaundrySection.jsx`, `weekdays.js` | T | The section is deleted; `weekdays.js` keeps the labels (short + long). |
| component | `LaundryDayCard.jsx` | T | Renders `pickUp.fromTrips` and `stillAtLaundry`; drops its own « hide when empty » computation (the server decides). |
| component | `LinenShortageAlert.jsx` | T | « jusqu'au … » from `recoversOn`. |
| loader | `planningDays.js` | T | One call to `/api/planning/laundry/days`; no `sum`, no `isShown`. |
| services | `client/src/api.js` | T | `getLaundrySchedule`, `saveLaundrySchedule`, `previewLaundrySchedule`, `getLaundryPlanningDays`; removes `getLaundryPlanningSummary` / `getLinenInventory` (no consumer left). |
| core pages / hooks / constants | — | — | None. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `ConfirmDialog`, `ErrorAlert`, `useDirtyFormGuard`, `useToast` | Unchanged usage. |
| **Created (new generic)** | — | The seven day toggles are an MUI `ToggleButtonGroup` (multiple), styled like `SegmentedSelect`. The app has no multi-weekday picker yet (`PropertyPricingSeasonsPage` picks one changeover day from a `Select`), and a core component would need a new SDK export — a core change this plugin spec avoids. Kept local; §9 Q2 proposes the extraction when a second multi-day use appears. |
| **Specific (kept feature-local)** | `LaundryScheduleSection`, `LaundryDayCard` | Bound to the laundry vocabulary and payload. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/laundry/schedule` | — | `{ current: { effectiveFrom, weekdays, turnaroundDays, cycle, longestWaitDays }, pending: { …same } \| null, tomorrow }` | Admin + reception. `cycle` is the rule 7 list. |
| PUT | `/api/laundry/schedule` | `{ weekdays: number[], turnaroundDays: number }` | `{ ok: true, current, pending, tomorrow }` | Admin. `400 { error, code, field }` per rule 3. Same as `current` → deletes `pending`. |
| POST | `/api/laundry/schedule/preview` | same body | `{ cycle: [{ dropWeekday, pickUpWeekday, waitDays }], longestWaitDays, firstTripOn }` | Admin, no write, same 400s. |
| GET | `/api/planning/laundry/days?from&to` | — | `{ days: { 'YYYY-MM-DD': Card } }` | Both bounds required; `checkPlanningRange`. |
| GET | `/api/dashboard/linen-shortage` | — | each type + `recoversOn: 'YYYY-MM-DD' \| null` | Additive. |

```text
Card = {
  kind: 'regular' | 'extra',
  isSkipped: boolean,
  dropOff:  { singleBeds, doubleBeds, babyBeds, largeTowels, mediumTowels, smallTowels, bathMats,
              incomplete: [{ id, clientName, propertyName, endDate }] },
  pickUp:   { …7 types, fromTrips: ['YYYY-MM-DD'] },
  stillAtLaundry: { counts: { …7 types }, readyOn: 'YYYY-MM-DD' } | null,
  inventoryAfter: { [trackedType]: number } | null,   // today..horizon only
  manualAddition: { …7 types, signed } | null,
  extraTrip: { pickUpAll, pickUp } | null,             // kind 'extra'
  leftAtLaundry: { …7 types } | null                   // partial extra trip
}
```

Removed: `GET /api/planning/laundry` and `GET /api/planning/linen-inventory` (their only consumers are
`planningDays.js` and two E2E specs, migrated in the same lot).

---

## 5. Data model

New plugin table (migration `laundry_schedule_v1` in `server/src/plugins/linen/migrations.js`,
idempotent `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS laundry_schedule_versions (
  effectiveFrom  TEXT PRIMARY KEY NOT NULL CHECK (length(effectiveFrom) = 10),
  weekdays       TEXT NOT NULL,              -- sorted CSV of 0..6, e.g. '2,4'
  turnaroundDays INTEGER NOT NULL DEFAULT 1 CHECK (turnaroundDays BETWEEN 1 AND 14),
  createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Seed, once, when the table is empty: `('0001-01-01', '<laundryWeekday or 2>', 1)`.

**Data impact:** additive. No existing row changes; `laundryWeekday` stays in `plugin_settings`
(frozen) so a rollback to 1.1.x finds it. Skips, manual lines and extra trips are untouched — the ones a
schedule change turns inert stay stored (rule 12). The projected figures of an existing install are
unchanged by the migration (rule 4) except where the warm-up replay (rule 16) is more exact than the
former seed: past manual lines and partial-pick-up remainders older than a week are now counted —
listed in §7.4.

## 6. UI / UX

Interactive mockup: [docs/specs/2026-10-28-linen-laundry-days.html](../docs/specs/2026-10-28-linen-laundry-days.html).

### 6.1 Paramètres › Linge — « Blanchisserie » card

Replaces the « Linge & blanchisserie » card at the top of the page.

```
┌ Blanchisserie ───────────────────────────────────────────┐
│ Jours            [L] [M●] [M] [J●] [V] [S] [D]           │
│ Linge prêt après [−]  2 jours  [+]                       │
│ ───────────────────────────────────────────────────────  │
│ Mar. → jeu.   2 j                                        │
│ Jeu. → mar.   5 j                                        │
│ À partir de demain, mer. 29 oct.                         │
└──────────────────────────────────────────────────────────┘
```

- Copy: « Blanchisserie », « Jours », « Linge prêt après », « jour » / « jours », « À partir de demain, … »,
  errors « Au moins un jour. », « Entre 1 et 14 jours. ». No explanatory paragraph (the current one goes).
- The cycle lines refresh from the server preview (debounced 250 ms); while loading the previous lines
  stay, dimmed. A preview error leaves the last good cycle.
- `PageActionBar`: title « Linge », Save + Cancel (unchanged), no new action.
- **Mobile (`xs`)**: the seven toggles fill the row (each ≥ 44 px, single letter), the stepper is
  full-width, the cycle lines stack. **`md`/`lg`**: the card sits at the top of the page column, max
  width 900/1240 as today.

### 6.2 Planning — laundry card

Same `LaundryDayCard`, on every laundry day of the schedule:

```
┌ ◌ Linge à la blanchisserie                       [+] [⊘] ┐
│ À APPORTER                 │ À RÉCUPÉRER · déposé mar. 21 │
│ Draps : 3 doubles · 1 simple│ Draps : 2 doubles           │
│ Serviettes : 8 grandes      │ Serviettes : 6 grandes      │
│ Encore à la blanchisserie : 3 doubles · prêt jeu. 23      │
│ DISPONIBLE APRÈS CE DÉPÔT   Draps : 4 doubles · −1 simple │
└───────────────────────────────────────────────────────────┘
```

- « déposé mar. 21 » after « À récupérer » (several dates: « déposé mar. 14 et jeu. 16 »). Nothing when
  nothing is collected.
- « Encore à la blanchisserie » line only with `stillAtLaundry`.
- **Mobile**: the two blocks stack (unchanged); the provenance wraps under « À RÉCUPÉRER ».

### 6.3 Dashboard — shortage alert

« Drap double : jusqu'à 2 manquants · du ven. 24 au mar. 28 » — the end date from `recoversOn`; without
it, today's wording.

## 7. Test plan

Every new rule is cited by at least one test (`specs/linen-laundry-days.md §3.x rule N`). The four
appended rules are cited too: `weekly-bed-linen-tracking.md rule 37`, `skip-laundry-trip.md rule 15`
and `laundry-extra-trip.md rule 21` by the multi-day ledger file, `linen-inventory-shortage-tracking.md
rule 18` by the multi-day inventory file.

### 7.1 Server unit tests (`server/src/plugins/linen/tests/`)

- [ ] `laundry-schedule.unit.test.js` — rules 1, 3, 5, 6, 7: validation matrix (empty, 7, duplicate, −1,
  7, 0, 15, 2.5, `"abc"`), `versionOn` across versions, `readyFrom` fixed at drop, `describeCycle` for
  Tue/Thu × 1/2/3, single day × 10, all days × 1. **~24 cases.**
- [ ] `laundry-schedule-model.unit.test.js` — rules 4, 5, 24: seed from `laundryWeekday` (2, 5, absent,
  invalid), idempotent rerun, pending upsert/overwrite/delete, purge drops the table. **~10.**
- [ ] `laundry-schedule-endpoint.unit.test.js` — rules 3, 5, 22, 23: GET shape, PUT tomorrow, PUT same as
  current deletes pending, each 400 with `code` + `field`, preview has no side effect, reception refused
  on PUT/preview. **~12.**
- [ ] `laundry-trip-ledger-multi-day.unit.test.js` — rules 8-12: Tue/Thu windows, turnaround 1/2/3,
  `fromTrips`, `stillAtLaundry.readyOn`, partial extra trip oldest-first, skip on Tuesday, extra trip on a
  regular day refused and inert after a change, version change mid-month. **~18.**
- [ ] `linen-inventory-multi-day.unit.test.js` — rules 15-16, 18: conservation every day of every
  scenario, linen unavailable before `readyFrom` → shortage, warm-up equals the former engine on the
  single-weekday fixtures, `recoversOn`. **~16.**
- [ ] `planning-laundry-days-endpoint.unit.test.js` — rules 13, 17: `shown` decision (each reason), past
  window without `inventoryAfter`, bounds required + `DATE_RANGE_TOO_WIDE`, card ↔ engine agreement over
  the Tue/Thu month. **~12.**
- [ ] `linen-shortage-recovers.unit.test.js` — rule 18: `recoversOn`, `null` beyond horizon, bath-mat
  label. **~4.**

### 7.2 Client tests (Vitest, `client/src/plugins/linen/__tests__/`)

- [ ] `LaundryScheduleSection.weekdays.test.jsx` — rules 19-20, 22: toggle, last day refused + message,
  stepper bounds, typed invalid disables Save, server message replaces the client's, pending caption. **~9.**
- [ ] `LaundryDayCard.provenance.test.jsx` — rule 11: one / two `fromTrips`, `stillAtLaundry`, none. **~4.**
- [ ] `planningDays.days-endpoint.test.js` — rule 13: one request, payload passed through untouched. **~2.**
- [ ] `LinenShortageAlert.recovers.test.jsx` — rule 18. **~2.**
- [ ] `LinenStockPage.phase-2.test.jsx` — updated: saves stock and schedule, Cancel restores both (rule 21).

### 7.3 E2E (Playwright)

- [ ] `e2e/specs/linen/laundry-days.spec.js` — set Tuesday + Thursday, turnaround 2 → Save; Planning shows
  a card on both days with « déposé mar. … » on Thursday; untick the last day → refusal. One run at
  390 px (mobile).
- [ ] `skip-laundry-trip.spec.js`, `laundry-extra-trip.spec.js`, `linen/stock-roundtrip.spec.js` — moved
  to the new endpoints, assertions unchanged.

### 7.4 Existing suites

Run unchanged against the migrated `{ [W], 1 }` schedule (rule 4). Expected to change, and only these:
the extra-trip « known approximation » case of `linen-inventory-extra-trip.unit.test.js` (rule 16 makes it
exact) and the cases of `linen-inventory-manual-additions.unit.test.js` that pin « past manual lines stay
out of the initial state ». Each changed assertion is commented with the rule that changed it.

### 7.5 Manual

- [ ] Shadow copy: Tue + Thu, turnaround 2; walk four weeks of the Planning, past and future; compare one
  Thursday by hand with the stays that left Wednesday/Thursday.
- [ ] Turnaround 3 on the same data: Thursday shows « Encore à la blanchisserie », the shortage alert moves.
- [ ] Mobile 390 px: Linge page toggles and stepper, Planning card.

## 8. Out of scope

- Separate drop-off-only and pick-up-only days, or several laundries.
- A turnaround per linen type (sheets vs towels).
- A laundry trip as a ticked task in the day counter (rule 14, arbitration A3).
- A schedule effective from a chosen date (other than tomorrow) or editing past versions.
- Laundry cost tracking, the laundry's invoice.
- Washing on site with no laundry at all (the plugin can be deactivated).

## 9. Open questions

- **Q1 (A1)** — Does a change rewrite the past? **Resolved 2026-10-28: dated versions effective tomorrow, the
  past keeps its rhythm** (rule 5), as recommended.
- **Q2** — Extract a generic multi-weekday picker into `components/` + the SDK? Only when a second
  multi-day use appears (none today). Not an arbitration for Adrien.
- **Q3 (A2)** — Expose the turnaround, and its default? **Resolved 2026-10-28: exposed, 1 to 14 days, default
  1 day** (rules 1 and 4), as recommended.
- **Q4 (A3)** — Laundry trip as a ticked task? **Resolved 2026-10-28: no, it stays an information card
  counting zero in the day counter** (rule 14), as recommended.

## 10. Implementation lots

1. **Lot 1 — the rhythm** (the feature, visible end to end): `laundrySchedule.js`, table + migration +
   model, schedule endpoints, ledger and engine on batches + warm-up replay, extra-trip check, the
   existing `GET /api/planning/laundry` and `/linen-inventory` read through the schedule (so Tuesday and
   Thursday cards appear at once), `LaundryScheduleSection` + page save. Tests: 7.1 schedule, model,
   endpoint, ledger, inventory files; 7.2 section + page; E2E `laundry-days.spec.js`. Plugin 1.2.0,
   fragment `changelog.d/added--linen-laundry-days.md`. **~14 files, the bulk of the work.**
2. **Lot 2 — the per-day payload**: `GET /api/planning/laundry/days`, card provenance and « Encore à la
   blanchisserie », `planningDays.js` as one call, removal of the two former endpoints, E2E moved,
   `recoversOn` + bath-mat label + « jusqu'au ». Plugin 1.2.1 or folded into 1.2.0 if both lots ship in
   the same release. **~10 files.** Lands after or alongside `dashboard-planning-scroll`; it does not
   depend on it.
