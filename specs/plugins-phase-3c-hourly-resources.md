# Plugins — phase 3c: price-line contributors, and hourly resources move out of the core

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugins-phase-3c` (from `inte/plugins` at ed64b928) |
| **Created** | 2026-10-05 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — §6 extension points, §11 risk 3, phasing §12 |
| **Previous phase** | [`specs/plugins-phase-3b-neat.md`](plugins-phase-3b-neat.md) (PR #652) |
| **Feature specs** | [`specs/resource-hourly-scheduling.md`](resource-hourly-scheduling.md), [`specs/hourly-resource-quantity-and-sas-scheduling.md`](hourly-resource-quantity-and-sas-scheduling.md) — their rules hold, except where §3.C below corrects them |
| **Summary for review** | [`docs/specs/2026-10-05-plugins-phase-3c-hourly-resources.html`](../docs/specs/2026-10-05-plugins-phase-3c-hourly-resources.html) |

---

## 1. Context

Phase 3 is three chained PRs (decision P9, 2026-10-01):
- **3a**: online payment behind a payment-provider interface (#651);
- **3b**: Neat behind a quote post-processor (#652);
- **3c**: hourly resources behind price-line contributors (this spec).

**The plugin `hourly-resources` exists since phase 0 but has no module.** Its code sits in the core, in
four places.

**Server:**
- `resource_bookings` and its route, controller and model: the external bookings, for a bath rented
  outside a stay;
- `resourceOccupancyModel`, `resourceSchedulingModel`, `planningResourceCardsModel`,
  `utils/resourceHourlyPricing.js` and `utils/resourceAvailability.js`;
- the free-slots route (`routes/resources.js`) and the two planning card routes (`routes/planning.js`);
- the sessions branch of the pricing engine (`utils/pricing.js` ~1906-1959);
- the SAS scheduling step (`getSas.resourceScheduling`, `commitArrival.resourceBlocks`);
- the nordic-bath email tokens.

**Client:**
- Calendrier › Ressources (`ResourcePlanningPage`, `ResourceBookingDialog`);
- the hourly fields of the resource form (`ComplexResourceFields`);
- the session picker of the fiche (`ResourceSessions`);
- the « à planifier » line of the summary;
- the ignition and session cards of the planning;
- the SAS step `SasResourceSchedulingPage`.

Phase 0 gated the external bookings, the free slots, the planning cards and the client surfaces. **The
mapping of 2026-10-05 found seven defects**, two of them on money:

1. **The evening is billed twice.**
   - The arrival SAS places the hours sold at the day rate. For an evening slot it adds a complement
     line « Bain nordique — supplément soirée » (`validateBlocks`, rule 22 of the feature spec), and it
     writes the slots into `reservation_resources.sessions`.
   - The next save of the fiche re-sends those sessions (`ReservationPage.jsx` ~1816). The engine's
     sessions branch prices them from the grid, evening rate included, and returns the total directly,
     without the locked snapshot every other sold line goes through.
   - Result: the line rises by the evening difference, and the supplement line is still there. A sold
     line also moves, against decision P10.
2. **Re-opening the SAS doubles the supplement.**
   - On re-open, the dialog keeps every custom SAS line it does not recognise as a « preserved » line
     and sends it back (`ReservationSasDialog.jsx` ~448-462, ~999). That includes the old supplement.
   - The server then appends the supplement it recomputes (`sas/controller.js` ~406-410). The stay ends
     up with two.
3. **With the plugin off, the server still runs the hourly paths:**
   - `getSas` sends the scheduling step;
   - `commitArrival` accepts and writes `resourceBlocks`;
   - the engine prices sessions;
   - the public site keeps the « à planifier avec l'hôte » note;
   - the emails recall the slot.

   Only the client hides the step.
4. **Hourly pricing leaks onto every resource.**
   - `usesHourlyQuantity` is true for `per_hour`, but also for any resource with `isComplex` or a
     `freeMinutes` > 0 (`pricing.js` ~1996, `reservationsController.js` ~284-288). Such a resource is
     priced by the hour, skips the stock check and loses its persons × nights multiplier.
   - The resource form shows « Prix (EUR/h) » and « 1ère heure offerte » for every price type.
5. **Replays drop the sessions.** `utils/reservationEngineInput.js` omits them (finance replays, forced
   contributions, Neat), so a replayed line loses its `scheduledHours`.
6. **The emails find the bath by its name.** `emailContextBuilder` and `stayFactsModel` look for
   « nordique » in the resource name.
7. **Missing extension points.** No contract lets a plugin:
   - price a line;
   - write at the SAS commit (phase 2 rule 11 promised it to phase 3);
   - put a timed card on the planning;
   - add an entry under Calendrier.

**In Solio's data**, the bath is the only `per_hour` resource; the baby bed is `per_stay`, with no
slots and no free minutes.

**Defects 1 and 2 are fixed on `master` first** (decision P15): `fix/hourly-evening-billed-once`,
`specs/hourly-resource-quantity-and-sas-scheduling.md` §3.6 rules 30–33. Writing that fix found two
more, fixed with it:
- a re-opened SAS deleted the hours already placed (the step started empty and the commit replaces
  the sessions);
- a fiche save dropped the SAS marker on the custom lines, so a re-opened SAS duplicated them.

This phase moves the fixed behaviour into the plugin; it does not fix it again.

## 2. Goal

- **The core owns the quote and its engine.** A plugin can price a resource line through **a price-line
  contributor**: a small, closed interface that runs inside the engine's resource loop, line by line,
  before the totals. The freeze of sold lines stays the engine's, and from now on it covers contributed
  lines too (defect 1).
- **The SAS gets a commit contract** for contributed steps. A plugin can:
  - check a step's payload before the commit;
  - add complement lines;
  - write its own data inside the commit's transaction.
- **Hourly resources become the plugin `hourly-resources`.** Its pricing, external bookings, occupancy,
  scheduling, planning cards, SAS step, resource fields, session picker and Calendrier › Ressources
  page live in `server/src/plugins/hourly-resources/` and `client/src/plugins/hourly-resources/`.
- **With the plugin off** (proposal P14, as P13 for the insurance):
  - no resource sold by the hour is offered anywhere;
  - no scheduling, no planning card, no Calendrier › Ressources;
  - every line already sold is shown, unchanged and read-only.
- **No contract changes for anything outside the app:**
  - `/api/resource-bookings/*`, the free-slots URL and `/api/planning/resource-cards` keep their URLs;
  - the public payloads keep their shape;
  - the email token names stay the same.

## 3. Functional rules

### 3.A The price-line contributor (core)

1. **The interface.** A plugin declares a contributor with `ctx.priceLineContributor(contributor)`:

   | Member | Contract |
   |---|---|
   | `id` | `'hourly-resources'` |
   | `priceTypes` | `['per_hour']`: the resource price types it prices |
   | `priceLine(input)` | `{ quantity, unitPrice?, billedUnits?, totalPrice?, extra? } \| null`, synchronous, no I/O |

   - `input` is everything the engine knows about the line:
     - `resource`: its row, with the property's price and free minutes resolved;
     - `selected`: the payload entry (`quantity`, `sessions`);
     - `sold`: true when the line has a locked snapshot;
     - the stay (`startDate`, `endDate`, `nights`, `persons`).
   - **An answer without amounts** (`{ quantity, extra }`) means « price these hours as a plain
     quantity »: the engine's generic path, through the lock when sold.
   - **`extra` is closed.** The engine copies `sessions`, `scheduledHours` and `detail` (a short French
     label such as « 2 h / 3 h planifiées ») onto the line, and nothing else.
   - **`null` means « no contribution »**: the line is priced as if no plugin were there.
   - At most one contributor per price type per instance. A second one fails that plugin's
     registration, as with the payment provider (3a rule 4) and the post-processor (3b rule 1).
   - A contributor that throws gives `null` and a log line with the plugin id. Pricing never fails
     because of a plugin.
2. **The engine applies it.** `utils/priceLineContributors.js` exposes `contributorFor(priceType)`. It
   returns the contributor only while its plugin is live.
   - In the resource loop of `pricing.js`, a resource whose price type has a live contributor is priced
     by it.
   - The result then goes through the same steps as every line: the locked snapshot (rule 3),
     « offert », and the contributions to the deposit and balance.
   - The sessions branch and its call to `priceSessions` leave `pricing.js`.
3. **A sold line stays frozen, whoever priced it (defect 1).**
   - A contributed line goes through `mergeLineWithLockedSnapshot`, like the generic path. While the
     line has a locked snapshot, its unit price, billed units and amount are the locked ones, whatever
     sessions the payload carries.
   - The sessions still travel with the line: they feed `scheduledHours`, `detail`, the planning and
     the emails, never the amount.
   - Only « Utiliser les tarifs actuels » releases the lock, as for any line.
4. **Hours are for `per_hour` only (defect 4).**
   - The engine and `insertResourceLines` price by the hour only a `per_hour` resource.
   - `isComplex` and `freeMinutes` on another price type are ignored: it is priced by its type's
     multiplier, with its stock check.
   - In Solio's data this changes nothing (§1).
5. **Replays keep the sessions (defect 5).** `reservationEngineInput` passes each stored line's
   `sessions`, so a replay keeps `scheduledHours` and `detail`.

### 3.B The SAS commit contract (core, phase 2 rule 11)

6. **The interface.** A plugin declares a commit hook for one of its steps with
   `ctx.sasCommit({ step, validate, complementItems, write })`:

   | Member | Contract |
   |---|---|
   | `step` | The step key, as contributed to `sas.arrival.steps` (`'resourceScheduling'`) |
   | `validate(reservation, payload)` | `{ ok: true } \| { ok: false, status, body }`, before anything is written |
   | `complementItems(reservation, payload)` | `[{ key, label, amount }]`: lines the plugin bills at the SAS |
   | `write(db, reservation, payload)` | Writes the plugin's data. Runs inside the commit's transaction |

   - **The payload** is `pluginSteps[<step>]` of `POST …/sas/arrival`. It is `undefined` when the step
     did not run: `validate` and `write` are not called, and what the step stored before stays (feature
     spec rule 24).
   - **Refusal.** A `validate` refusal aborts the whole commit with its status and body, as today's 409
     `SLOT_CONFLICT`.
   - **Complement lines.** `complementItems` is called on **every** arrival commit while the plugin is
     live, `payload` `undefined` when the step did not run: a plugin line is recomputed each time
     (master rule 32). Each item joins the commit's complement items. Its `key` is stored on the row
     (`reservation_custom_options.sasLineKey`, `'<pluginId>:<key>'`).
   - **Errors.** A `write` that throws rolls the commit back and answers 500. A plugin cannot leave a
     half-written SAS.
   - **Scope.** Arrival only for now: nothing is scheduled at check-out.
7. **A line a plugin bills is the plugin's (defect 2).**
   - `getSas` lists a row carrying a `sasLineKey` under `pluginLines`, not among the custom lines. The
     dialog therefore never keeps it as « preserved » and never sends it back.
   - The commit drops any incoming custom item whose label equals a plugin line's label on that stay.
     This protects against an older dialog still open in a browser.
   - A fiche save carries `sasLineKey` over with `sasArrivalOrigin` (master rule 33).
   - A re-commit replaces the plugin's lines with the ones it computes now, through the existing
     replace-and-delta machinery. A paid complement stays frozen, as today.
8. **Live only.** `getSas` asks the step's data (`ctx.sasData`) and the commit calls the hooks only
   while the plugin is live. With the plugin off:
   - a `pluginSteps` entry is ignored;
   - its rows already stored stay, at their amount (P10).

### 3.C The plugin `hourly-resources`

9. **What moves into `server/src/plugins/hourly-resources/`:**
   - `resourceBookingsModel`, `resourceOccupancyModel`, `resourceSchedulingModel`,
     `planningResourceCardsModel`;
   - `resourceHourlyPricing.js`, `resourceAvailability.js`;
   - the controller and routes of the external bookings, the free slots and the planning cards.

   The phase 1 isolation walk applies: the core reads `resources`, `reservation_resources`,
   `property_resource_prices` and `reservations` through `ctx.db`.
10. **Routes, at their current URLs.** The plugin mounts or adds:
    - `/api/resource-bookings`;
    - `GET /api/resources/:id/free-slots`;
    - `GET /api/planning/resource-cards`, `PUT /api/planning/resource-cards/:id/done`.

    `index.js`, `routes/resources.js` and `routes/planning.js` lose their `requirePlugin` lines. Roles
    are unchanged; reception keeps its planning access through `ctx.roleAccess`.
11. **Pricing.** The plugin declares the rule 1 contributor for `per_hour`.
    - **Sessions placed** (at least one valid), line unsold: priced from the time-banded grid, day and
      evening rates, minus the free minutes, and `scheduledHours` = the hours placed.
    - **Sessions placed, line sold:** `{ quantity, extra }` with the greater of the hours declared and
      placed — the engine bills them through the lock (rule 3).
    - **No usable session:** the hours declared (or those the unusable sessions described), as a plain
      quantity, and `scheduledHours: 0`.
    - **`detail`:** « x h / y h planifiées », or « À planifier » when no hour is placed; nothing once
      every hour sold sits on a slot.
    - A `per_hour` resource that does not show on the planning is left to the engine (`null`).

    The amount is the one today's two paths give, for an unsold line. A sold line is frozen by rule 3.
12. **The SAS step.**
    - The plugin provides the step's data through `ctx.sasData`: today's `resourceScheduling` payload.
    - It contributes `SasResourceSchedulingPage` to `sas.arrival.steps`, at today's place.
    - The step sends `{ blocks, resourceIds }`: every block on the picker — the hours placed before
      included — and the resources it showed.
    - It declares the rule 6 commit hook:
      - `validate`: today's `validateBlocks` (opening hours, capacity, turnover, heat-up, sold-hours
        budget). A conflict gives the 409 `SLOT_CONFLICT`.
      - `complementItems`: one « <resource> — supplément soirée » per resource, with
        `key: 'evening:<resourceId>'`.
      - `write`: the sessions of every resource the step showed, replaced — by none when every block
        was removed. A resource it did not show keeps its sessions.

    `commitArrivalSas` and `sas/controller.js` lose `resourceBlocks`. `sas/controller.js` loses the
    `resourceSchedulingModel` core module. The `HOURLY_RESOURCES` export leaves the client SDK.
13. **The evening supplement is computed against what was sold (defect 1).**
    - The supplement of a resource = the grid price of the placed blocks − what the sold line already
      bills for those hours. It is never negative.
    - A line sold at the day rate owes the evening difference. A line sold with evening sessions
      already priced owes nothing for them.
    - The free minutes count once: on the sold line.
14. **Planning.** The plugin contributes the ignition and session cards to `planning.days` (rule 22).
    It loads them from `/api/planning/resource-cards` and toggles them done through its own route.
    External bookings show as cards too, with nothing to tick.
15. **Emails (defect 6, decision P17).**
    - The slot sentence is composed by the core, inside the reminder, in the email's language — a plugin
      token would have to know the language. The core asks whether the plugin is live and never imports
      it (phase 0).
    - The bath is no longer found by its name for the slots. The slots recalled are the sessions of the
      stay's `per_hour` lines.
    - The tokens keep their names (`hasNordicBath`, `nordicBathReminder`), so Solio's templates do not
      change.
    - The core keeps the reminder itself (swimsuit, towel), which does not depend on scheduling. Without
      the plugin, the reminder no longer recalls a slot.
    - `stayFactsModel`'s free bath minutes read the free minutes of the property's `per_hour` resource that
      shows on the planning, not the name, and are 0 while the plugin is off.
16. **Tables.**
    - `resource_bookings` becomes the plugin's. Its migration `tables_v1` creates it with today's DDL
      (`CREATE TABLE IF NOT EXISTS`, so every row is kept).
    - `database.js` and `schema.sql` stop creating it.
    - `resourcesModel.getDeleteImpact` counts external bookings only when the table exists.
    - The hourly columns of `resources`, `reservation_resources.sessions` and
      `property_resource_prices.freeMinutes` stay core columns: they sit on core tables. They are read
      only by the plugin, and by the engine for a locked line.
17. **Uninstall (proposal P16, as P12).**
    - Deactivating keeps everything.
    - « Effacer aussi ses données » drops `resource_bookings`, then empties the slot settings of the
      resources (`isComplex`, the planning card, turnover, heat-up, evening and external rates).
    - The lines sold stay, at their price, **with their sessions**: they say when the hours sold are
      used. The resources keep their price type and their free minutes.
    - The uninstall dialog lists, with counts, « N réservations hors séjour » and « les réglages de
      créneaux des ressources ». The external bookings paid for an amount get a warning line apart:
      « N réservations hors séjour, X € encaissés, absents de la compta ». The erase button stays
      available (P16: warn, then erase).

### 3.D The plugin turned off (proposal P14)

18. **Not offered.** `priceLineContributors.offered('per_hour')` is true only while the plugin is live.
    While it is false:
    - **nothing new is sold by the hour:**
      - `GET /api/resources`, the property's resources and the public catalogue leave the `per_hour`
        resources out;
      - `GET|PUT /api/resources/:id` on one answers 404;
      - a `POST` or `PUT` setting `priceType: 'per_hour'` answers 400 « Le prix à l’heure demande le
        plugin Ressources à l’heure. »;
      - a save that adds such a line answers 422 `RESOURCE_NOT_OFFERED` « Ce produit n’est plus
        proposé. ».
    - **A line already there is kept as stored**, to the cent, through every later save. Its sessions
      are kept as stored.
    - **That line is read-only.** A payload that removes it or changes its hours is ignored for that
      line, as 3b rule 5. Only reactivating the plugin lets someone change it.
    - **The fiche and the devis** list such resources under `frozenResources`, generic like
      `frozenOptions`, with `readOnly: true` and the reason « Lecture seule : plugin Ressources à
      l’heure inactif ». The tile reads « Prix figé : 90,00 € » and its controls are disabled.
19. **No scheduling anywhere:**
    - no SAS step (rule 8);
    - no planning card, no Calendrier › Ressources;
    - no « à planifier » detail;
    - no `showsSchedulingNote` on the public site;
    - no slot in the emails (rule 15).

    The money already billed (lines, supplements, external bookings) is shown and exported as stored.
20. **Phase 0 rule 20 is superseded.** The resource form no longer offers « Par heure (plugin inactif) »:
    a `per_hour` resource is hidden while the plugin is off. Reactivating it brings every resource back,
    with its slots, prices and sessions.

### 3.E Client

21. **New slots:**
    - **`resources.fields`**: `{ key, appliesTo(draft), Component }`. Each live contribution draws under
      the resource form's base fields; it receives `draft` and `onChange(patch)`. The plugin draws, for a
      `per_hour` resource, the minimum use, the slots, the heat-up, the evening and external rates and
      the planning switch. The per-property price stays core for every resource; « (EUR/h) » and the
      free hour show only on a `per_hour` one, which only exists while the plugin is live.
      `ResourcesPage` loses `ComplexResourceFields`.
    - **`reservation.resourceLine`**: `{ key, appliesTo(resource), Component }`, drawn under a resource
      line, mirroring `reservation.optionLine` (3b rule 16). It receives `resource`, `sessions`, `stay`,
      `onSessionsChange` and `disabled`. The plugin draws the session picker. `ExtrasSection` loses
      `ResourceSessions`.
    - **`calendar.menu`**: entries `{ path, label }`, drawn above the properties' calendars, each visible
      through `canSeeRoute` like any page. The plugin adds Calendrier › Ressources, whose page is a route
      it contributes. `App.jsx` loses its hard-coded entry and route.
22. **`planning.days` takes timed entries.**
    - A contribution marked `timed` gives, for a day, a list of cards `{ key, time }`. Each sorts among
      the core's timed cards; a contribution without `timed` gives one time-less card, at the bottom of
      the day as linen's.
    - `countTasks(entry)` returns `{ done, total }`, and the day's task count adds it; the core no longer
      counts resource cards itself.
    - Its component receives `reload()` and `onOpenReservation` (absent for the reception role).

    The core's `ResourceBookingsSection`, the session and ignition cards and their state leave
    `PlanningPage`.
23. **Generic lines stay generic.**
    - `PricingSummary` renders a line's `detail` when the server sends one; its « à planifier » code
      goes. « 1ère heure offerte » stays, on `per_hour` lines only (rule 4).
    - `ResourcesPage` shows « Prix » without « EUR/h » for every price type except `per_hour`, which the
      plugin draws.
24. **Client module.** `client/src/plugins/hourly-resources/` holds:
    - `ResourcePlanningPage`, `ResourceBookingDialog` and `resourceSessions.js` (moved);
    - the SAS step (moved from `plugins/sas/`);
    - the resource fields and the session picker (extracted);
    - the planning cards.

    `SlotPickerGrid` stays a core component exported by the SDK, as `OccurrenceGrid`; `OptionDayCard` and
    `withFrom` join the SDK for the planning cards and the resource page.

### 3.F Existing databases, new customers

25. **Upgrade.** `tables_v1` runs at the plugin's first boot. A Solio-like database keeps:
    - the bath, its slots and its rates;
    - every session;
    - every external booking;
    - every sold line at its price.

    In production the plugin is installed and active (phase 0 rule 6): nothing visible changes, except
    the two defects fixed.
26. **A new customer** starts with the plugin not installed (phase 0). Resources are sold per stay,
    night or person; « à l’heure » appears once the plugin is installed.

### 3.G Added during implementation (2026-10-05)

27. **A SAS step may collect** (client side of rule 6). A `sas.arrival.steps` contribution may declare:
    - no `load`: its data is `pluginData[pluginId]` of the SAS payload (the server's `ctx.sasData`);
    - `initialValue(data)`: the step's value when the SAS opens, step shown or not;
    - `payloadOf(value, data)`: what the commit sends under `pluginSteps[key]`, only when the step ran;
    - `recapLines(value, data)` → `[{ label, amount }]`: lines the recap shows and counts in its total,
      priced by the server, never offerable;
    - `recapNotes(value, data)` → `[string]`: what the recap recalls (« Bain nordique : 1 h non
      planifiée. »);
    - `skipLabel`: a second footer button that moves on (« Planifier plus tard »).

    Its `Component` receives `data`, `value`, `onChange(value | updater)` and `reservationId`.
28. **Plugin lines on the recap while the plugin is off.** A line carrying a `sasLineKey` whose plugin has
    no live step is shown as stored, counted in the total, never offered and never sent back: the server
    keeps it (rule 8).
29. **A fiche keeps a sold `per_hour` line whole while the plugin is off:** its sessions travel with it
    through every save (the engine copies them when no plugin prices the line), and its tile is never
    « Indispo ».

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `utils/` | `priceLineContributors.js` | C | Rules 1–2, 18: the declared contributors, `contributorFor`, `offered` |
| `utils/` | `pricing.js` | T | Contributed lines in the resource loop, through the lock (rules 2–4); sessions branch removed |
| `utils/` | `resourceOffer.js` | C | Rule 18: hide `per_hour` resources; keep a stored line as stored; 422 on an addition; `frozenResources` |
| `utils/` | `reservationEngineInput.js` | T | Sessions in replays (rule 5) |
| `utils/` | `sasCommitHooks.js` | C | Rules 6–8: validate, complement items, write inside the transaction |
| `utils/` | `resourceHourlyPricing.js`, `resourceAvailability.js` | M | → `plugins/hourly-resources/` |
| `utils/` | `emailContextBuilder.js` | T | Slots from the stay's `per_hour` lines, only while the plugin is live (rule 15) |
| `models/` | `resourceBookingsModel.js`, `resourceOccupancyModel.js`, `resourceSchedulingModel.js`, `planningResourceCardsModel.js` | M | → `plugins/hourly-resources/` |
| `models/` | `reservationsModel.js` | T | `commitArrivalSas`: hooks in the transaction, `sasLineKey`, no `resourceBlocks` (rules 6–7, 12) |
| `models/` | `resourcesModel.js` | T | `getDeleteImpact` guarded (rule 16) |
| `models/` | `propertiesModel.js` | T | The property's resources without `per_hour` while off (rule 18) |
| `models/` | `bookingLinesModel.js` | T | A fiche save carries `sasLineKey` over with `sasArrivalOrigin` (rule 7) |
| `models/` | `stayFactsModel.js` | T | Free minutes of the `per_hour` resource on the planning, 0 while off (rule 15) |
| `controllers/` | `reservationsController.js`, `devisController.js`, `models/devisModel.js` | T | `insertResourceLines` hours for `per_hour` only; stored line kept; `frozenResources` (rules 4, 18) |
| `controllers/` | `resourcesController.js` | T | 404 and 400 while not offered; free slots moved out (rules 10, 18) |
| `controllers/` | `planningController.js` | T | Resource cards moved out (rule 10) |
| `middleware/` | `enforceRoleAccess.js` | T | The two reception entries move to the plugin (rule 10) |
| `controllers/` | `resourceBookingsController.js` | M | → `plugins/hourly-resources/controller.js` |
| `routes/` | `resourceBookings.js`, `resources.js`, `planning.js` | M/T | Hourly routes → the plugin (rule 10) |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `index.js` | T | `ctx.priceLineContributor`, `ctx.sasCommit`; `CORE_MODULES`: `resourceSchedulingModel` out |
| `plugins/sas/` | `controller.js` | T | `pluginSteps`, `pluginLines`, the hooks; `resourceScheduling` and `resourceBlocks` removed (rules 6–8, 12) |
| `plugins/website-booking/` | `controllers/publicCatalogController.js`, `controllers/publicQuoteController.js` | T | `per_hour` hidden from the catalogue and refused on a quote or a request while off (rules 18–19) |
| `plugins/` | `index.js` | T | Registers the module |
| `plugins/hourly-resources/` | `index.js`, `pricing.js`, `sasStep.js`, `controller.js`, `routes.js`, `bookingsModel.js`, `occupancyModel.js`, `schedulingModel.js`, `planningCardsModel.js`, `hourlyPricing.js`, `availability.js`, `migrations.js`, `tests/` | C (mostly moved) | Rules 9–17 |
| — | `index.js` | T | `/api/resource-bookings` mount removed |
| — | `database.js`, `schema.sql` | T | `resource_bookings` no longer created by the core; `reservation_custom_options.sasLineKey` added |

### 4.2 Client side (`client/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `plugins/hourly-resources/` | `index.js`, `ResourcePlanningPage.jsx`, `ResourceBookingDialog.jsx`, `MiniDayPlanner.jsx`, `resourceSessions.js`, `SasResourceSchedulingPage.jsx`, `SasSchedulingStep.jsx`, `sasStep.js`, `scheduling.js`, `HourlyResourceFields.jsx`, `ResourceSessionsPicker.jsx`, `PlanningResourceCard.jsx`, `planningDays.js`, `planningTasks.js` | C (mostly moved) | Rules 12, 14, 21, 24, 27. `scheduling.js` and `planningTasks.js` are pure: the module list imports them without a cycle through the SDK |
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | Collecting plugin steps and `pluginSteps` (rule 27); lines with a `sasLineKey` never preserved, shown as stored when their plugin is off (rules 7, 28); the core scheduling step removed |
| `pages/` | `ResourcesPage.jsx` | T | `resources.fields` slot; `ComplexResourceFields` removed (rule 21) |
| `components/reservation/` | `ExtrasSection.jsx` | T | `reservation.resourceLine` slot; read-only tile for a `frozenResources` entry (rules 18, 21) |
| `components/` | `PricingSummary.jsx` | T | Renders `detail` (rule 23) |
| `pages/` | `PlanningPage.jsx` | T | `timed` contributions, `onOpenReservation`; hourly code removed (rule 22) |
| `utils/` | `planningDayTasks.js` | T | Resource cards counted by their contribution only (rule 22) |
| `pages/` | `ReservationPage.jsx` | T | Adds `frozenResources` to the list and the summary (rule 18) |
| `constants/` | `plugins.js`, `roles.js` | T | `/resource-planning` comes from the module's route (rule 21) |
| — | `App.jsx`, `constants/calendarMenu.js` (C) | T | `calendar.menu` slot (rule 21) |
| `plugins/sdk/` | `index.js` | T | `OptionDayCard`, `withFrom` in; `HOURLY_RESOURCES` out |

It reuses `SlotPickerGrid`, `OccurrenceGrid`, `FormDialog`, `ConfirmDialog` and `StatusBadge`. The
three slots are generic. The plugin's components are specific.

### 4.3 API contract

| Endpoint | Change |
|---|---|
| `/api/resource-bookings/*`, `GET /api/resources/:id/free-slots`, `/api/planning/resource-cards*` | Same URLs, mounted by the plugin; 404 `PLUGIN_INACTIVE` when off (as today) |
| `GET /api/reservations/:id`, `GET /api/devis/:id` | + `frozenResources: [{ …resource, readOnly: true, readOnlyReason }]` |
| `POST /api/reservations/calculate-price`, reservation and devis saves | A line may carry `detail`; a sold line is frozen; 422 `RESOURCE_NOT_OFFERED` on an addition while off |
| `GET /api/resources`, `GET /api/properties/:id` | `per_hour` resources absent while off |
| `GET\|PUT /api/resources/:id` (`per_hour`) | 404 while off; `priceType: 'per_hour'` answers 400 |
| `GET /api/reservations/:id/sas` | `resourceScheduling` → `pluginData['hourly-resources']`; each custom line carries `sasLineKey` |
| `GET /api/reservations/:id` | Each custom line carries `sasLineKey` |
| `POST /api/reservations/:id/sas/arrival` | `resourceBlocks` → `pluginSteps.resourceScheduling: { blocks, resourceIds }`; 409 `SLOT_CONFLICT` unchanged; answer `pluginLines` in place of `eveningSupplement` |
| `GET\|DELETE /api/resources/:id/delete-impact`, `DELETE /api/resources/:id` (`per_hour`) | 404 while off |
| `/public/v1/**` | Same shape; `per_hour` resources absent and no scheduling note while off |
| `GET /api/plugins` | `hourly-resources`: `hasModule: true`, `erasable: true`, its data lines |

## 5. Data model

- **`resource_bookings`**: unchanged columns. It is now created by the plugin migration `tables_v1`, and
  dropped on erase.
- **`reservation_custom_options.sasLineKey`** (TEXT, NULL): new core column. Existing supplement rows are
  tagged at migration: a SAS-origin custom row whose label ends with « — supplément soirée » and names
  a `per_hour` resource of the stay gets `hourly-resources:evening:<resourceId>`.
- **`resources`** (hourly columns), **`reservation_resources.sessions`**,
  **`property_resource_prices.freeMinutes`**: unchanged. The erase empties the slot settings of the
  resources; the free minutes and the sessions stay — every line is sold, and they explain it.
- **Migration note** in `changelog.d/migration--plugins-phase-3c-hourly-resources.md`.

## 6. UI / UX

The interactive mock shows each screen in both states, plugin on and off.

- **Calendrier menu:** « Ressources » only while the plugin is live.
- **Resource form:**
  - plugin on: the type « À l’heure » and its block (price per hour, free hour, slots, heat-up,
    evening, external rates, planning card);
  - plugin off: types per stay, night and person only; no « EUR/h », no free hour.
- **Fiche, resource line:**
  - plugin on: the session picker under the line and « 2 h / 3 h planifiées » in the summary;
  - plugin off: a sold bath shows « Prix figé : 90,00 € » and « Lecture seule : plugin Ressources à
    l’heure inactif », its controls disabled; an unsold one is not in the list.
- **SAS:**
  - the « Créneaux » step only while the plugin is live;
  - the recap shows the supplement once, however many times the SAS is re-opened.
- **Planning:** the ignition card at its hour, then the session card, among the timed cards; nothing
  while off.
- **Plugins › Ressources à l’heure › Désinstaller:** the counts; with paid external bookings, an ochre
  warning line above « Effacer aussi ses données ». The button stays available.
- **Mobile:**
  - the session picker and the SAS grid keep their full-width layout at 375 px;
  - the read-only tile wraps its two lines;
  - the warning wraps.

## 7. Test plan

### Server — new tests (27)

| File | Tests | Covers |
|---|---|---|
| `price-line-contributor.unit.test.js` | 8 | Rules 1–4, 18: missing member; one per price type; `extra` closed; a sold line through the lock with its sold hours; a throw leaves the line to the engine; an inactive plugin is never called and `per_hour` not offered; hours for `per_hour` only; without a plugin a sold line keeps its sessions |
| `sas-commit-hooks.unit.test.js` | 6 | Rules 6–8: a refusal aborts before any write; a step not run is not validated nor written, its lines recomputed; the line stored tagged and the write inside the commit; a throwing write rolls back; the labels a dialog copy is dropped by; plugin off → nothing called, its line kept as stored |
| `resource-offer-follows-plugin.unit.test.js` | 6 | Rules 18–20: lists; 404 and 400, back when live; no addition; a sold line kept as stored (removal, hours, « offert », lock); `frozenResources`; the gate steps aside when live |
| `reservation-engine-input-sessions.unit.test.js` | 2 | Rule 5 |
| `plugins/hourly-resources/tests/phase-3c-hourly.unit.test.js` | 5 | Rules 9–17: what the module declares; `tables_v1` keeps the rows; the supplements written before are tagged, only those; the erasure warning and lines; what the erasure empties |

Master's `hourly-evening-billed-once.unit.test.js` moved under the plugin with its fixture and stays green
through the move (13): it is the parity guard of defects 1–2, its commit cases now driven through the
plugin's hook (+1: removing every block clears the sessions and the supplement).

### Moved and updated tests

- The hourly suites moved under `plugins/hourly-resources/tests/`:
  - `resource-bookings-model`, `resource-occupancy-conflicts`, `resource-availability`,
    `resource-hourly-pricing`, `resource-evening-supplement`, `resource-ignition-task`;
  - `planning-resource-cards-model`, `sas-resource-scheduling` (its commit cases write through the hook).
- `tests/hourlyResourcesFixture.js` declares the live plugin for the suites that price `per_hour` lines:
  `pricing-resource-types`, `devis-extras-parity`, `planning-card-public-pricing`, `email-context-builder`
  (+1: no slot recalled once the plugin is off), website-booking's `public-catalog-sort-by-price`.
- `pricing-auto-options`: the « complex resource » cases run on `per_hour` (rule 4); the two cases on a
  string `isComplex` go; the multiplier case now checks that a slotted `per_person_per_night` keeps its
  multiplier.
- `plugins-phase-1-sdk` (rules 12, 22): the module-less example boots without the hourly module.
  `plugins-phase-0` reads the mounts from the plugin. `sas-departure-mode` and `phase-2-sas` follow the
  SAS controller.
- Server total: 4,852.

### Client (Vitest)

- New in `plugins/hourly-resources/__tests__/`: `HourlyResourceFields` (2), `PlanningResourceCard` (4: a
  session ticked and the cards reloaded; a booking with nothing to tick; the day count; the cards of a
  window keyed by day). Moved: `SasResourceSchedulingPage`, `resourceSessions`.
- `ReservationSasDialog.evening-supplement.test.jsx` (2): the supplement shown once and never sent
  back; a re-opened step sends every block and the hours left.
- `ReservationSasDialog.plugin-lines-off.test.jsx` (1): rule 28.
- `ExtrasSection.hourly-plugin-inactive.test.jsx` rewritten over `frozenResources` (2).
- Updated: `PricingSummary.resource-scheduling` (the server's `detail`), `ExtrasSection.hourly-resource-hours`
  (the editor comes from the slot), `planningDayTasks` (counted by the contribution),
  `ReservationSasDialog.arrival` (`pluginSteps`), the SDK registry.
- Client total: 1,516.

### E2E (97: 96 passed, 1 skipped as before)

- `hourly-resource-sold-by-hour.spec.js` is kept.
- New `e2e/specs/plugins/hourly-resources.spec.js` (1): switched off, the bath leaves the catalogue, its
  URLs answer 404 and Calendrier › Ressources goes; switched on, both come back with the settings.

### Manual verification (done 2026-10-05)

- A copy of the dev database on its own ports:
  - upgrade: the twelve plugins installed, `tables_v1` ran, the 3 external bookings kept;
  - a stay sold with 3 h of bath at 30 €/h: the SAS (through `pluginSteps`) places 20:00, one
    supplement of 20 € tagged `hourly-resources:evening:2`, the line stays 90 €;
  - plugin on, at 1280 px: the fiche shows the sessions and « 1 h / 3 h planifiées »; Calendrier ›
    Ressources is in the menu; the SAS step shows the placed block with its « +20 € », the recap one
    supplement, the total 20 € and « 2 h non planifiées »; the planning shows the session card; the
    resource form shows the hourly block, « EUR/h » and the free hour;
  - plugin off: the bath leaves the list, `GET /api/resources/2` → 404, a new stay with it → 422; the
    fiche shows « Prix figé : 90,00 € » and the reason, at 1280 and 375 px; the menu entry, the SAS step
    and the planning card are gone; the recap still shows the supplement; a fiche save that drops the
    line keeps it whole, sessions included;
  - Plugins › Ressources à l'heure at 375 px, with one external booking paid 70 €: the warning before
    « Effacer aussi ses données », then the list of what goes.
- One run of the server suite saw `plugins-phase-1-sdk` « every moved route keeps its URL » fail once; it
  passed on every rerun, alone and in the full suite.

## 8. Out of scope

- **The linen steps on the commit contract.** Phase 2 rule 11's switch keeps working. Moving linen to
  `ctx.sasCommit` is a follow-up.
- **Renaming `resources.showsPlanningCard`**, which shares its name with `options.showsPlanningCard`.
  The plugin calls it « schedulable » in its code; the column stays.
- **Solio's email wording** (the swimsuit reminder), part of the open item on Solio content written in
  the code (`guestEmailSequenceTemplates.js`).
- **External bookings in finance and accounting.** They stay out, as today.
- **A second hourly provider.** The interface allows one per price type; none is written.

## 9. Open questions

None. Decided on 2026-10-05, on the mock:

- **P14 — the plugin off:** nothing sold by the hour is offered; a sold line stays frozen and
  read-only (rules 18–20).
- **P15 — the money defects:** fixed on `master` first, in a separate `fix/` PR shipped in a patch
  release; this phase carries the fix into the plugin.
- **P16 — erasing with paid external bookings:** warn, then erase (rule 17).
- **P17 — the email tokens:** the slot sentence moves to the plugin, found without the name; the
  reminder stays core (rule 15).
