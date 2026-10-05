# Plugins — phase 3c: price-line contributors, and hourly resources move out of the core

| Field | Value |
|---|---|
| **Status** | Approved |
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
   | `priceLine(input)` | `{ quantity, unitPrice, billedUnits, totalPrice, extra } \| null`, synchronous, no I/O |

   - `input` is everything the engine knows about the line:
     - `resource`: its row, with the property's price and free minutes resolved;
     - `selected`: the payload entry (`quantity`, `sessions`);
     - the stay (`startDate`, `endDate`, `nights`, `persons`).
   - **`extra` is closed.** The engine copies `sessions`, `scheduledHours` and `detail` (a short French
     label such as « 2 h / 3 h planifiées ») onto the line, and nothing else.
   - **`null` means « price it as a plain quantity »**: hours × the resource price, as the generic path.
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
    - **Sessions placed** (at least one valid): the line is priced from the time-banded grid, day and
      evening rates, minus the free minutes, and `scheduledHours` = the hours placed.
    - **No session:** sold hours × the day rate minus the free minutes, and `scheduledHours: 0`.
    - **`detail`:** « x h / y h planifiées », or « À planifier » when no hour is placed.

    The amount is the one today's two paths give, for an unsold line. A sold line is frozen by rule 3.
12. **The SAS step.**
    - The plugin provides the step's data through `ctx.sasData`: today's `resourceScheduling` payload.
    - It contributes `SasResourceSchedulingPage` to `sas.arrival.steps`, at today's place.
    - It declares the rule 6 commit hook:
      - `validate`: today's `validateBlocks` (opening hours, capacity, turnover, heat-up, sold-hours
        budget). A conflict gives the 409 `SLOT_CONFLICT`.
      - `complementItems`: one « <resource> — supplément soirée » per resource, with
        `key: 'evening:<resourceId>'`.
      - `write`: the sessions, replaced per named resource, as today's `commitArrivalSas`.

    `commitArrivalSas` and `sas/controller.js` lose `resourceBlocks`. `sas/controller.js` loses the
    `resourceSchedulingModel` core module. The `HOURLY_RESOURCES` export leaves the client SDK.
13. **The evening supplement is computed against what was sold (defect 1).**
    - The supplement of a resource = the grid price of the placed blocks − what the sold line already
      bills for those hours. It is never negative.
    - A line sold at the day rate owes the evening difference. A line sold with evening sessions
      already priced owes nothing for them.
    - The free minutes count once: on the sold line.
14. **Planning.** The plugin contributes the ignition and session cards to `planning.days` (rule 18).
    It loads them from `/api/planning/resource-cards` and toggles them done through its own route.
    External bookings show as session cards too.
15. **Emails (defect 6, proposal P17).**
    - The plugin contributes the slot sentence through `ctx.emailContext`.
    - The bath is no longer found by its name. The slots recalled are the sessions of the stay's
      `per_hour` resources that show on the planning.
    - The tokens keep their names (`hasNordicBath`, `nordicBathReminder`), so Solio's templates do not
      change.
    - The core keeps the reminder itself (swimsuit, towel), which does not depend on scheduling. Without
      the plugin, the reminder no longer recalls a slot.
    - `stayFactsModel`'s free bath minutes read the free minutes of the stay's `per_hour` resource, not
      the name.
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
    - « Effacer aussi ses données » drops `resource_bookings`, then empties the slots of the resources
      (`isComplex`, opening hours, turnover, heat-up, evening and external rates) and the stays'
      sessions.
    - The lines sold stay, at their price.
    - The uninstall dialog lists, with counts, « N réservations hors séjour » and « N séances planifiées
      ». When external bookings hold money, a warning line apart shows it: « N réservations hors séjour,
      X € encaissés, absents de la compta ». The erase button stays available (P16: warn, then erase).

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
      the resource form's base fields; it receives `draft` and `onChange(patch)`. The plugin draws the
      price per hour, the free hour, the slots, the heat-up, the evening and external rates and the
      planning switch. `ResourcesPage` loses `ComplexResourceFields`.
    - **`reservation.resourceLine`**: `{ key, appliesTo(resource), Component }`, drawn under a resource
      line, mirroring `reservation.optionLine` (3b rule 16). The plugin draws the session picker.
      `ExtrasSection` loses `ResourceSessions`.
    - **`calendar.menu`**: entries `{ path, label, Icon, after }`, as `settings.menu`. The plugin adds
      Calendrier › Ressources. `App.jsx` loses its hard-coded entry.
22. **`planning.days` takes timed entries.**
    - An entry may carry `time` (`HH:MM`). Timed entries sort among the core's timed cards; entries
      without a time stay at the bottom of the day, as linen's.
    - A contribution may also return `countTasks(day)`, and the day's task count adds it.
    - Its component receives `onChanged()`, which reloads that contribution.

    The core's `ResourceBookingsSection`, the session and ignition cards and their state leave
    `PlanningPage`.
23. **Generic lines stay generic.**
    - `PricingSummary` renders a line's `detail` when the server sends one. Its « à planifier » and
      « 1ère heure offerte » code goes.
    - `ResourcesPage` shows « Prix » without « EUR/h » for every price type except `per_hour`, which the
      plugin draws.
24. **Client module.** `client/src/plugins/hourly-resources/` holds:
    - `ResourcePlanningPage`, `ResourceBookingDialog` and `resourceSessions.js` (moved);
    - the SAS step (moved from `plugins/sas/`);
    - the resource fields and the session picker (extracted);
    - the planning cards.

    `SlotPickerGrid` stays a core component exported by the SDK, as `OccurrenceGrid`.

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
| `utils/` | `emailContextBuilder.js` | T | Slot sentence from the plugin; no name match (rule 15) |
| `models/` | `resourceBookingsModel.js`, `resourceOccupancyModel.js`, `resourceSchedulingModel.js`, `planningResourceCardsModel.js` | M | → `plugins/hourly-resources/` |
| `models/` | `reservationsModel.js` | T | `commitArrivalSas`: hooks in the transaction, `sasLineKey`, no `resourceBlocks` (rules 6–7, 12) |
| `models/` | `resourcesModel.js` | T | `getDeleteImpact` guarded; hourly columns written only while live; `per_hour` hidden (rules 16, 18) |
| `models/` | `stayFactsModel.js` | T | Free minutes of the `per_hour` resource (rule 15) |
| `controllers/` | `reservationsController.js`, `devisController.js`, `models/devisModel.js` | T | `insertResourceLines` hours for `per_hour` only; stored line kept; `frozenResources` (rules 4, 18) |
| `controllers/` | `resourcesController.js` | T | 404 and 400 while not offered (rule 18) |
| `controllers/` | `resourceBookingsController.js` | M | → `plugins/hourly-resources/controller.js` |
| `routes/` | `resourceBookings.js`, `resources.js`, `planning.js` | M/T | Hourly routes → the plugin (rule 10) |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `index.js` | T | `ctx.priceLineContributor`, `ctx.sasCommit`; `CORE_MODULES`: `resourceSchedulingModel` out |
| `plugins/sas/` | `controller.js` | T | `pluginSteps`, `pluginLines`, the hooks; `resourceScheduling` and `resourceBlocks` removed (rules 6–8, 12) |
| `plugins/website-booking/` | `publicProjections.js` | T | `per_hour` hidden and no scheduling note while off (rules 18–19) |
| `plugins/` | `index.js` | T | Registers the module |
| `plugins/hourly-resources/` | `index.js`, `pricing.js`, `controller.js`, `routes.js`, `bookingsModel.js`, `occupancyModel.js`, `schedulingModel.js`, `planningCardsModel.js`, `hourlyPricing.js`, `availability.js`, `emailContext.js`, `migrations.js`, `tests/` | C (mostly moved) | Rules 9–17 |
| — | `index.js` | T | `/api/resource-bookings` mount removed |
| — | `database.js`, `schema.sql` | T | `resource_bookings` no longer created by the core; `reservation_custom_options.sasLineKey` added |

### 4.2 Client side (`client/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `plugins/hourly-resources/` | `index.js`, `ResourcePlanningPage.jsx`, `ResourceBookingDialog.jsx`, `resourceSessions.js`, `SasResourceSchedulingPage.jsx`, `HourlyResourceFields.jsx`, `ResourceSessionsPicker.jsx`, `PlanningResourceCard.jsx`, `planningDays.js` | C (mostly moved) | Rules 12, 14, 21, 24 |
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | `pluginSteps` payload; `pluginLines` never preserved (rule 7); `hourlyOn` removed |
| `pages/` | `ResourcesPage.jsx` | T | `resources.fields` slot; `ComplexResourceFields` removed (rule 21) |
| `components/reservation/` | `ExtrasSection.jsx` | T | `reservation.resourceLine` slot; read-only tile for a `frozenResources` entry (rules 18, 21) |
| `components/` | `PricingSummary.jsx` | T | Renders `detail` (rule 23) |
| `pages/` | `PlanningPage.jsx` | T | Timed slot entries, `countTasks`, `onChanged`; hourly code removed (rule 22) |
| `pages/` | `ReservationPage.jsx` | T | Adds `frozenResources`; sessions kept by the slot |
| — | `App.jsx`, `constants/calendarMenu.js` (C) | T | `calendar.menu` slot (rule 21) |
| `plugins/sdk/` | `index.js`, `registry.js` | T | Three slots declared; `HOURLY_RESOURCES` out |

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
| `GET /api/reservations/:id/sas` | `resourceScheduling` → `pluginData['hourly-resources']`; + `pluginLines` |
| `POST /api/reservations/:id/sas/arrival` | `resourceBlocks` → `pluginSteps.resourceScheduling.blocks`; 409 `SLOT_CONFLICT` unchanged; answer `pluginLines` in place of `eveningSupplement` |
| `/public/v1/**` | Same shape; `per_hour` resources absent and no scheduling note while off |
| `GET /api/plugins` | `hourly-resources`: `hasModule: true`, `erasable: true`, its data lines |

## 5. Data model

- **`resource_bookings`**: unchanged columns. It is now created by the plugin migration `tables_v1`, and
  dropped on erase.
- **`reservation_custom_options.sasLineKey`** (TEXT, NULL): new core column. Existing supplement rows are
  tagged at migration: a SAS-origin custom row whose label ends with « — supplément soirée » and names
  a `per_hour` resource of the stay gets `hourly-resources:evening:<resourceId>`.
- **`resources`** (hourly columns), **`reservation_resources.sessions`**,
  **`property_resource_prices.freeMinutes`**: unchanged. They are emptied on erase, except the free
  minutes and the sessions of a sold line, which stay because they explain its price.
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

### Server — new tests

| File | Covers |
|---|---|
| `price-line-contributor.unit.test.js` | Rules 1–4: missing member; one per price type; `extra` closed; a throw gives the quantity price; an inactive plugin is never called; hours for `per_hour` only |
| `sas-commit-hooks.unit.test.js` | Rules 6–8: validate aborts the whole commit; items tagged with `sasLineKey`; `write` rolled back on a throw; step not run → nothing called; plugin off → ignored |
| `sas-plugin-lines.unit.test.js` | Rule 7: a re-opened SAS that sends the old supplement back as a custom line ends with one supplement; the migration tags existing rows |
| `resource-offer-follows-plugin.unit.test.js` | Rules 18–20: catalogue, property and site lists hide `per_hour`; 404 and 400; a stored line kept, removal and hours change ignored; `frozenResources`; back with its settings |
| `reservation-engine-input-sessions.unit.test.js` | Rule 5 |
| `plugins/hourly-resources/tests/phase-3c-hourly.unit.test.js` | Rules 9–17, 25–26: routes only while live; `tables_v1` keeps rows; the SAS data and step only while live; email slot without the name; erase warns, then erases, sold lines kept; a new customer has no `per_hour` |

Master's `hourly-evening-billed-once.unit.test.js` moves under the plugin and must stay green through
the move: it is the parity guard of defects 1–2.

### Moved and updated tests

- The hourly suites move under `plugins/hourly-resources/tests/`:
  - `resource-bookings-model`, `resource-occupancy-conflicts`, `resource-availability`,
    `resource-hourly-pricing`, `resource-evening-supplement`, `resource-ignition-task`;
  - `planning-resource-cards-model`, `sas-resource-scheduling`.
- `pricing-resource-types`, `email-context-builder`, `devis-*`, `booking-lines-model` and the
  website-booking public suites assert the new seams. The `sas` suites send `pluginSteps`.
- `plugins-phase-1-sdk` (rules 12, 22): the module-less example becomes a test-only catalogue entry,
  since every plugin now has a module. `plugins-phase-0` and `subscription-entitlement` follow.

### Client (Vitest)

- `plugins/hourly-resources/__tests__/`: the session picker in the slot, the resource fields, the SAS
  step (moved), the planning card.
- `PlanningPage.timed-slot-entries.test.jsx`: a timed entry sorts among the timed cards; `countTasks`.
- `ExtrasSection.frozen-resource.test.jsx`: a frozen bath read-only at its price.
- `ReservationSasDialog.plugin-lines.test.jsx`: a plugin line is never sent back.
- `ExtrasSection.hourly-plugin-inactive.test.jsx` is rewritten over `frozenResources`.

### E2E

- `hourly-resource-sold-by-hour.spec.js` is kept.
- New `e2e/specs/plugins/hourly-resources.spec.js`:
  - switched off, the bath leaves the catalogue and Calendrier › Ressources goes;
  - switched on, both come back.

### Manual verification

- A shadow instance (a copy of the dev database) on its own ports:
  - upgrade: `tables_v1` ran and the supplement rows are tagged;
  - a stay sold with 2 h of bath at the day rate; at the SAS, an evening slot gives one supplement
    line; a fiche save keeps the line amount; re-opening the SAS leaves one supplement;
  - the plugin deactivated: the bath leaves the catalogue; the sold line is read-only at its price;
    the SAS has no step; the planning has no card; Calendrier › Ressources is gone;
  - checked at 1280 and 375 px;
  - uninstall with a paid external booking: the warning, then the erase.

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
