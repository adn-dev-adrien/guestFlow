# Weekly bed-linen tracking for the laundry service

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/weekly-bed-linen-tracking` |
| **Created** | 2026-06-02 |
| **Implemented** | 2026-06-02 |
| **Author** | Adrien |
| **Related PR** | _(opened at the end of implementation — see commit log)_ |

---

## 1. Context

Adrien drops dirty bed linens at the laundry service once a week and picks up the
previous batch the same day. Today the count of sheet sets needed is done by eye
("how many reservations had the linen option?") and is error-prone: he sometimes
brings too few sheets and has to make a second trip, sometimes too many and overpays.

There is no in-app support for this routine. The reservation already carries the
information needed (single / double / baby bed counts + the "linge de lit" option
on / off) but it's not surfaced anywhere as a weekly aggregation.

The Planning page (`client/src/pages/PlanningPage.js`) is the natural home: it's
already the operational dashboard for the next 14 days, with one section per day
showing arrivals + departures. The laundry day fits in as a small block under the
day header of each laundry-day cell.

---

## 2. Goal

On the Planning page, on each occurrence of the configured weekly laundry day,
Adrien sees at a glance:

- **What he should bring** — number of single + double + baby sheet sets used by
  reservations that ended since the previous laundry day.
- **What he picks up** — the count he brought to the laundry the **previous**
  laundry day.

The laundry weekday is configurable (default: Tuesday). Each row appears
independently — a week may show only a drop-off, only a pick-up, both, or
neither.

---

## 3. Functional rules

### 3.1 What counts a reservation in

1. A reservation contributes to bed-linen counts iff **all** of the following hold:
   - `reservations.kind = 'reservation'` (devis-stage rows are excluded — same
     filter as finance / accounting).
   - At least one row in `reservation_options` for that reservation references an
     option marked `countsAsBedLinen = 1` (new boolean flag added in §5).
   - The reservation is **not** soft-deleted (today GuestFlow has no soft-delete
     on reservations — but if one is introduced later, the filter must respect it;
     out of scope to add such a filter today).

2. The `offered` flag on the reservation-option row is **ignored**: an option
   offered for free still uses physical sheets that need washing.

3. The `quantity` of the linen option is **ignored** — sheets are bound to the
   reservation's bed configuration (`singleBeds`, `doubleBeds`, `babyBeds`), not
   to how many times the option was ticked. A reservation with linen option ×3
   still consumes one set of sheets per bed.

4. If a reservation has multiple options marked `countsAsBedLinen = 1` (Adrien
   created two variants), it still counts **once** — the linen flag is treated
   as a boolean per reservation, not a multiplier.

### 3.2 What date the contribution lands on

5. A reservation's linen contribution is dated to its **`endDate`** (checkout day).
   That's the day sheets become dirty and join the next laundry batch. Multi-night
   stays consume **one** set of sheets total — sheets are changed only at
   checkout, never mid-stay (matches Adrien's operational practice).

6. The bed counts read from the reservation row are **literal**: `singleBeds`,
   `doubleBeds`, `babyBeds` as stored. No upsizing, no fallback to the property's
   default bed counts.

### 3.3 Laundry day windows

7. The **laundry weekday** is a single global integer setting,
   `laundryWeekday` (0 = Sunday … 6 = Saturday, JavaScript convention), with a
   default of **2 = Tuesday**.

8. For a given laundry day **L** (an actual date that falls on `laundryWeekday`):
   - **Drop-off(L)** = sum of bed counts (single / double / baby) of every
     reservation whose `endDate` falls in the half-open window
     **`(L - 7 days, L]`** (exclusive on the left, inclusive on the right).
     Rationale: a checkout on the laundry day itself joins the same day's batch
     (Adrien collects sheets after the morning checkout and brings them later).
   - **Pick-up(L)** = exactly **Drop-off(L - 7 days)**.

9. Both counters are independent. A week with zero qualifying checkouts shows
   `Drop-off(L) = 0`. If the previous week was empty too, `Pick-up(L) = 0`.
   When both are zero, the card is **not rendered** (no visual noise on a slow
   week).

10. When the operator **changes** `laundryWeekday` (e.g. moves from Tuesday to
    Wednesday), the change applies prospectively. No backfill — past displayed
    windows aren't recomputed. The next laundry day shown is the next occurrence
    of the new weekday from "today".

### 3.4 Where it shows

11. The new card appears in `PlanningPage` **under the day header** of every day
    cell whose date is a laundry day, **above** the departures mini-rows and
    arrivals. Order from top to bottom of a laundry day: day header → laundry
    card → departures → arrivals.

12. The card carries an icon (`LocalLaundryServiceIcon`), the title
    *"Linge à la blanchisserie"*, and two blocks side by side:
    - **À apporter** (left): `Doubles: N · Simples: N · Bébé: N` for each
      non-zero count. If all three are zero the block reads *"—"*.
    - **À récupérer** (right): same shape, sourced from `Pick-up(L)`.

13. The card is **omitted entirely** when both blocks are zero (rule 9).

14. The card is sourced server-side via a new endpoint (see §4.3) — the client
    does **no** computation on bed counts or windows, just renders the payload.

### 3.5 Option marking

15. The Option entity gains a boolean flag `countsAsBedLinen`. Default `false`. **The flag is
    NOT exposed in the UI** (2026-06-02 follow-up — Adrien's call: the two typed seeds
    "Linge de lit" + "Linge de toilette" are always present on every install with the
    title-alias promotion picking up legacy rows, so the operator never needs to flag a third
    option). The flag is set exclusively by `utils/bedLinenSeed.js` (at boot on a fresh
    install or during a promotion) and round-tripped through `OptionsPage.fromItem` /
    `toPayload` so it isn't accidentally cleared when the operator edits the option's
    price/description.

16. **One seeded option per flag.** The bed-linen typed seed (`autoOptionType = 'bed_linen'`)
    is the sole carrier of `countsAsBedLinen = 1` in steady state. Same for the bathroom-linen
    seed. A brand-new custom option created from the form always starts with both flags off.

17. The flag is purely a metadata tag — it does **not** affect pricing,
    invoicing, accounting, or any existing logic. The engine ignores it.

17.bis. **Discriminator change in client UI (2026-06-02 follow-up).** Before this feature,
    `autoOptionType` was set only on engine-derived options (early/late check-in/out) and the
    client used `Boolean(option.autoOptionType)` as the proxy for "auto-added by the engine".
    The linen seeds repurpose `autoOptionType` as a **typed-default / undeletability marker**
    (the seeded "Linge de lit" + "Linge de toilette" are NOT engine-derived — `autoEnabled = 0`,
    Adrien toggles them per reservation like any manual option). The two concepts are now
    decoupled:

    | Marker | Meaning | Set by | Read by |
    |---|---|---|---|
    | `autoOptionType` (truthy) | Typed default; undeletable in the catalog | early/late seed + linen seeds | `OptionsPage.isDeleteDisabled` |
    | `autoEnabled === 1` | Auto-added by the pricing engine; not in `selectedOptions` | early/late seed only | `ExtrasSection.isAutoTimedOption`, `ReservationPage` payload filters, `PricingSummary.isAuto` |

    Every client site that previously used `Boolean(autoOptionType)` as the "auto-added" proxy
    (`ExtrasSection.js`, `ReservationPage.js` payload + autoOptionsInComplement loader,
    `PricingSummary.js`) was moved to `Number(autoEnabled || 0) === 1`. Without this change, a
    Switch on the linen options was rendered **disabled** in the reservation form + the option
    was silently stripped from the payload — making the feature non-functional from the UI.
    Pinned by `ExtrasSection.test.js` regression case (2026-06-02).

### 3.5.bis Bathroom-linen tracking (towels) — 2026-06-02 follow-up

18. The Option entity gains a **second** independent boolean flag
    **`countsAsBathroomLinen`**. Default `false`. Shown as a second checkbox in the option form
    just below the bed-linen one, with the label *"Cette option compte des serviettes de
    toilette"* and helper text *"Une grande et une petite serviette par personne (adultes, ados
    et enfants — bébés exclus)."*.

19. The two flags are **completely independent**. An option may carry the bed flag, the bathroom
    flag, both, or neither. The reservation-level booleans are computed per flag (one EXISTS query
    per flag in `laundryModel`).

20. **Towel count per reservation = `ROUND((adults + teens + children) × Σ reservation_options.quantity)`**
    summed over the bathroom-flagged options on that reservation. Babies excluded (no
    adult-sized towels). Server exposes two equal keys `largeTowels` + `smallTowels` (1 large
    + 1 small per effective person) because the laundry batch is sorted by towel TYPE.

21. **Bathroom-linen quantity SCALES the person count** — asymmetric with bed-linen (which
    ignores quantity). Rationale: the seeded "Linge de toilette" option is `priceType =
    per_person`, and Adrien uses the per-reservation `reservation_options.quantity` as a
    sub-occupation factor (e.g. `0.6667` on a 3-person stay = "2 of 3 want towels"). The
    counter must honour this scaling, otherwise it over-reports. Verified end-to-end against
    a prod window 2026-06-02 → 2026-06-09 (gite 12 × 1.0 + tente 3 × 0.6667 + gite 8 × 0.625
    = 19 large + 19 small; pinned in `laundry-model.unit.test.js`).

22. Bathroom contributions follow the **same window + kind filter** as bed-linen: half-open
    `(L - 7 days, L]`, `kind = 'reservation'` only, `offered` flag still ignored (rule 2). The
    SQL aggregates quantities **per reservation** via an inner GROUP BY before joining the
    parent, so a reservation carrying multiple bathroom-flagged options sees its quantities
    **summed** (additive — useful for "Standard 0.6 + Premium 0.4 = full coverage"). In steady
    state only the seeded option carries the flag (rule 16), so this edge case is informative
    only.

23. **Default "Linge de toilette" option seeded at boot** via `utils/bathroomLinenSeed.js`,
    strict mirror of the bed-linen seed (`autoOptionType = 'bathroom_linen'`, undeletable in the
    UI). Non-destructive: skipped when the typed seed already exists OR when any operator-
    adopted option already carries `countsAsBathroomLinen = 1`. The two seeds are independent —
    skipping one does not skip the other.

24. The server emits the bathroom counts **inside the same dropOff / pickUp block** as the bed
    counts. The block schema becomes
    `{ singleBeds, doubleBeds, babyBeds, largeTowels, smallTowels }`. Existing client code that
    only read the bed keys keeps working unchanged.

25. The client renders the bathroom contribution as a **second sub-line** under the same
    "À apporter" / "À récupérer" headers, labelled *"Serviettes :"*, with the format
    `N grandes · N moyennes · N petites` (each size omitted when zero — rule 13.bis). The
    card stays silent (rule 13) when bed totals AND towel totals are all zero on both sides.

### 3.5.ter Per-type linen configuration (2026-06-02 follow-up)

26. **Bed-linen — 3 per-type include flags on the option** (`linenIncludesSingle`,
    `linenIncludesDouble`, `linenIncludesBaby` — INTEGER 0/1, default 1). Surfaced in
    `OptionsPage` as three checkboxes (component `BedLinenIncludesFields`) rendered ONLY when
    the option carries `countsAsBedLinen = 1`. Unchecking a type excludes that bed-type sum
    from the LaundryDayCard counter (the SQL aggregates via
    `CASE WHEN sub.includes<Type> = 1 THEN SUM(<type>Beds) ELSE 0 END`). When multiple
    bed-flagged options exist (edge case — rule 16 says one in steady state), the SQL takes
    `MAX(includes<Type>)` over them, i.e. ANY flagged option that includes a type counts it.

27. **Bathroom-linen — 3 per-person multipliers on the option**
    (`towelLargePerPerson`, `towelMediumPerPerson`, `towelSmallPerPerson` — INTEGER ≥ 0,
    defaults `1 / 0 / 1` preserving the previous "1 large + 1 small per person" semantic).
    Surfaced in `OptionsPage` as three number inputs (component `BathroomTowelCountsFields`),
    rendered ONLY when the option carries `countsAsBathroomLinen = 1`. The per-reservation
    contribution per size becomes
    `ROUND(persons × Σ quantity × MAX(towel<Size>PerPerson))`. A multiplier set to **0** silences
    that size: the SUM is 0 → the LaundryDayCard hides the line at render time (rule 13.bis).

13.bis. (Rule 13 extension for §3.5.ter.) The LaundryDayCard `formatTowels` helper omits any
    towel size whose count is 0. If all three sizes are 0 on both sides, the towel line is
    suppressed entirely — combined with rule 13, the card stays silent.

### 3.7 Per-property option defaults (2026-06-03 follow-up)

28. **Property-scoped default options + offered flag.** Adrien can declare, per logement, that
    one or more linen options are **added by default** on every NEW reservation for that
    property, optionally with the **offered flag pre-set** ("le linge est inclus dans le
    tarif du logement, gratuit pour le client"). Examples:
    - Gite always includes bed linen → `Linge de lit` added by default, offered = true.
    - Tente provides bed linen on demand → `Linge de lit` added by default, offered = false.
    - Studio: no auto-add (operator picks per reservation).

29. **Data model — dedicated table** `property_option_defaults` keeps the new semantic fully
    decoupled from the existing `property_options` (which is a per-property availability
    filter that we do NOT want to repurpose: a global option like `Linge de lit` must stay
    available on every property, regardless of its default-status on any specific property).
    Schema:
    ```sql
    CREATE TABLE property_option_defaults (
      propertyId INTEGER NOT NULL,
      optionId   INTEGER NOT NULL,
      offered    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (propertyId, optionId),
      FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (optionId)   REFERENCES options(id)    ON DELETE CASCADE
    );
    ```
    A row's presence ≡ `addedByDefault = 1`. Removing the row ≡ no default. `offered` is the
    second binary flag; nothing else is stored. ON DELETE CASCADE on both FKs prevents orphan
    rows when a property or an option is hard-deleted.

30. **Auto-add on NEW reservation only.** The client pre-populates `form.selectedOptions` from
    `GET /api/properties/:id/option-defaults` exactly once, on the **fresh reservation create
    path** for the chosen property. Editing an existing reservation NEVER re-applies the
    defaults — historical reservations must stay frozen as the operator left them. The
    pre-population uses `quantity: 1` + `offered: <row.offered>`.

31. **UI canonical edit + read-only mirror** (Adrien's UX choice, 2026-06-03):
    - **PropertyDetail (canonical edit)**: new section *"Options ajoutées par défaut"*. For each
      linen-flagged option (`countsAsBedLinen = 1` OR `countsAsBathroomLinen = 1`), one row
      with two switches: *"Ajouter par défaut"* + *"Offert (gratuit)"* (the second is disabled
      until the first is on). Changes are saved with a PUT.
    - **OptionsPage (read-only mirror)**: when editing a linen option, a section *"Logements
      par défaut"* lists each property that has this option as a default + the offered flag
      next to each. The component is a pure renderer — no input, just a status table that
      mirrors what the property page is canonical for.

32. **API endpoints**:
    - `GET /api/properties/:id/option-defaults` → `[{ optionId, offered }]`.
    - `PUT /api/properties/:id/option-defaults/:optionId` → `{ offered: boolean }` body, idempotent
      upsert. Returns the row.
    - `DELETE /api/properties/:id/option-defaults/:optionId` → 204 (idempotent unset).
    - `GET /api/options/:id/property-defaults` → `[{ propertyId, propertyName, offered }]` (the
      read-only mirror feed).

33. **Non-regression contract** (Adrien explicitly flagged): no change to existing reservation
    create / edit paths beyond the new fresh-reservation pre-population. The current global
    availability of the linen options (no `property_options` rows = available everywhere) is
    untouched. The existing `selectedOptions` payload shape (`optionId`, `quantity`,
    `inComplement`, `offered`) is unchanged. The `property_options` filter rule still drives
    "which options the operator can pick from" — no new joins / filters / coupling added.

34. **Forbidden interactions** (pinned by tests):
    - Auto-add MUST NOT fire on reservation EDIT (re-applying defaults would silently mutate
      historical bookings).
    - Auto-add MUST NOT duplicate an option already in `form.selectedOptions` (e.g. when the
      operator changes property mid-edit: keep what they picked manually, just add the
      new property's defaults that are not already there).
    - `offered` defaults sourced from the row must be honoured even when the option was added
      manually before the auto-add ran (last write wins is OK — the auto-add only inserts
      rows it didn't find).

35. **Manual re-toggle mirrors the property contract** (2026-06-03 follow-up). When the operator
    toggles an option **back ON** on an EXISTING reservation (i.e. removed earlier + re-added
    via the same form), the `offered` flag is set from the property's default for that option:
    - Default exists with `offered = true` → option is offered (free) on re-add.
    - Default exists with `offered = false` → option is paid on re-add.
    - No default → leave `offeredOptionIds` untouched (preserve the historical state).

    Rationale: the property contract is "linen is included" / "linen costs X" — a manual
    re-toggle should honour that contract, not the now-stale state captured at load time. The
    client caches the property's defaults in `propertyOptionDefaults` state, refreshed via a
    useEffect on every `form.propertyId` change (including the edit-load path — so the cache
    is populated even though `applyPropertyDefaultsAsync` is NOT called there per rule 30).
    The mirror is applied by `setOptionQuantity` on the absent → present transition.

### 3.6 Edge cases

- **Window straddles the planning start.** The planning shows 14 days forward;
  the first laundry day in the window may have its drop-off window reach back
  before "today". The server still computes it (queries reservations with
  `endDate IN (L-7, L]` regardless of "today"). Same for pick-up which always
  references `L - 7 days`, possibly outside the planning range.
- **Two laundry days in the window.** With `DAYS_AHEAD = 14`, the planning shows
  up to ~2 laundry days. Both render their own card independently.
- **A reservation flagged as bed-linen with `singleBeds = doubleBeds = babyBeds = 0`.**
  Contributes zero — visible nowhere. The card stays accurate; the booking just
  doesn't move the needle. We do **not** treat this as an error or warning (the
  reservation may be a one-night studio with no formal bed count entered).
- **The operator un-flags an option after past reservations used it.** Future
  laundry days no longer count those reservations. Past windows are not
  recomputed (and the planning is forward-only, so this is invisible anyway).
- **Reservation deleted (hard-deleted via DB).** Drops out of all windows
  immediately. Same as any other reservation deletion.

---

## 4. Architecture

> **Fat backend, thin frontend.** The window math, weekday arithmetic, and
> aggregation all live on the server. The client gets `{ laundryDays: [{ date,
> dropOff: {…}, pickUp: {…} }, …] }` and renders.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: `options.countsAsBedLinen INTEGER NOT NULL DEFAULT 0`; `options.countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0` (§3.5.bis); `app_settings.laundryWeekday INTEGER NOT NULL DEFAULT 2`. |
| `models/optionsModel.js` | `optionsModel.js` | T | Reads/writes `countsAsBedLinen` + `countsAsBathroomLinen`. `getById`, `list`, `create`, `update` include both; `update` accepts both in the payload. |
| `models/settingsModel.js` | `settingsModel.js` | T | Adds `laundryWeekday` to `COLUMNS` (plain integer, no encryption, no mask). |
| `models/laundryModel.js` | `laundryModel.js` | C | Pure aggregation queries: `dropOffForWindow(startExclusive, endInclusive)` → `{ singleBeds, doubleBeds, babyBeds }` (joins reservations + reservation_options + options on `countsAsBedLinen = 1`); `dropOffBathroomForWindow(startExclusive, endInclusive)` → `{ largeTowels, smallTowels }` (same window/devis filter; SUM `adults + teens + children`; EXISTS on `countsAsBathroomLinen = 1`). |
| `utils/laundryWindow.js` | `laundryWindow.js` | C | Pure date helpers: `findLaundryDaysInRange(fromIso, toIso, weekday)` → ISO date list; `prevLaundryDay(isoDate)` → ISO date 7 days earlier. Unit-testable, no DB. |
| `controllers/planningController.js` | `planningController.js` | C | New controller. Action `laundrySummary(req, res)` — reads `from`, `to` query params, the `laundryWeekday` from settings, iterates the laundry days in range, queries `laundryModel.dropOffForWindow` for both each laundry day AND its `prev` day (for pick-up). Returns the payload. |
| `routes/planning.js` | `planning.js` | C | New file. Mounts `GET /api/planning/laundry`. Uses `requireAuth`. |
| `index.js` | `index.js` | T | Wires the new router. |
| `utils/bedLinenSeed.js` | `bedLinenSeed.js` | C | **Follow-up §4.4**. Boot-time seed of the default "Linge de lit" option. Three branches: idempotent skip if the typed row already exists; **promote in place** if a row already carries `countsAsBedLinen=1` without `autoOptionType` (keeps title/price/description, only adds the type marker so the row becomes undeletable); fresh insert otherwise. |
| `utils/bathroomLinenSeed.js` | `bathroomLinenSeed.js` | C | **§3.5.bis follow-up**. Strict mirror of the bed-linen seed for the "Linge de toilette" option (`autoOptionType = 'bathroom_linen'`, same three branches: skip / promote in place / fresh insert). Independent of the bed-linen seed (each only checks its own flag). |
| `tests/` | `laundry-window.unit.test.js` | C | Pure helpers: weekday math, range iteration, edge of month / year, DST-safe ISO arithmetic. |
| `tests/` | `laundry-model.unit.test.js` | C | In-memory DB. Covers: only flagged options count; offered flag ignored; quantity ignored; multiple flagged options on one reservation count once; kind='devis' excluded; window half-openness (`(start, end]`); empty results return zeros. |
| `tests/` | `planning-laundry-controller.unit.test.js` | C | Fake models. Covers: drop-off and pick-up per laundry day in range; weekday change in settings is honoured; empty days are still listed with zero (the client filters the no-op cards, not the controller — keeps the contract uniform). |
| `tests/` | `bed-linen-seed.unit.test.js` | C | **Follow-up §4.4**. 6 cases: fresh DB inserts the typed seed; idempotency on second boot; operator-adopted option already with `countsAsBedLinen=1` skipped; unrelated options don't prevent seed; schema missing the new column degrades gracefully; SQLite error caught + returned as `{ action: 'error' }`. |
| `tests/` | `bathroom-linen-seed.unit.test.js` | C | **§3.5.bis follow-up**. 7 cases: mirror of the bed-linen-seed suite, plus a dedicated test confirming the two seeds do NOT conflict (a prod that adopted only the bed flag still gets the bathroom seed). |

**Notes:**
- `routes/planning.js` is new. The current `/api/reservations` endpoint is **not**
  extended — the laundry summary is a different bounded context (aggregates) and
  a different response shape. Mixing it would make the planning route messy.
- No new dependency. Date arithmetic uses native `Date` + ISO strings, same as
  `utils/occupancy.js`.
- The `enforceRoleAccess` middleware already gates everything under `/api/*`. No
  changes needed; the route inherits the default admin policy. Accountants don't
  need this — out of scope (they don't see Planning either).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `api.js` | `api.js` | T | New helper `getLaundryPlanningSummary({ from, to })` → `GET /api/planning/laundry?from=…&to=…`. |
| `pages/PlanningPage.js` | `PlanningPage.js` | T | On `from/to` load, calls `api.getLaundryPlanningSummary` alongside the existing reservations fetch (`Promise.all`). Builds a `laundryByDate: Record<dateIso, { dropOff, pickUp }>` from the response. In the day-rendering loop (line ~720), conditionally renders `<LaundryDayCard data={laundryByDate[date]} />` under the day header. |
| `components/LaundryDayCard.js` | `LaundryDayCard.js` | C | New feature-local component. Pure renderer: takes `{ dropOff, pickUp }` (both `{ singleBeds, doubleBeds, babyBeds }`). Returns `null` when both sides are zero (matches rule 13). Single MUI Card with two sub-blocks. Mobile-aware: stacks vertically on `xs`. |
| `components/OptionFormDialog.js` | `OptionFormDialog.js` | T | Adds the `countsAsBedLinen` checkbox + helper text. Threads the boolean through the submit payload. |
| `components/SettingsLaundrySection.js` | `SettingsLaundrySection.js` | C | New settings card. One field: `laundryWeekday` rendered as a MUI `Select` with the 7 French weekday labels (lundi, mardi, …). Helper text: *"Jour de la semaine où vous déposez et récupérez le linge à la blanchisserie."*. |
| `pages/SettingsPage.js` | `SettingsPage.js` | T | Imports and renders `SettingsLaundrySection` in the settings flow (placed next to the existing reservation settings — closest cousin in domain). Threads `laundryWeekday` through the existing form payload pattern. |
| `constants/weekdays.js` | `weekdays.js` | C | New tiny constant: `WEEKDAY_OPTIONS = [{ value: 0, label: 'Dimanche' }, …, { value: 6, label: 'Samedi' }]`. Reused by `SettingsLaundrySection` and any future weekday picker (e.g. cleaning schedule). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Card`, `CardContent`, `Chip`, MUI Select, `PageActionBar` (untouched on SettingsPage) | All MUI / pre-existing. |
| **Created (new generic)** | `constants/weekdays.js` (`WEEKDAY_OPTIONS`) | Trivially reusable for any other "pick a day" setting in the future. |
| **Specific (kept feature-local)** | `LaundryDayCard`, `SettingsLaundrySection` | Both carry domain-specific French labels and a specific data shape. `LaundryDayCard` could in theory be generalised to "two-column summary card with N badges per side" but that's premature — extract only when the second use case appears (CLAUDE.md §7). |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/planning/laundry?from=YYYY-MM-DD&to=YYYY-MM-DD` | — | `{ laundryWeekday: 0..6, laundryDays: [{ date: 'YYYY-MM-DD', dropOff: { singleBeds, doubleBeds, babyBeds }, pickUp: { singleBeds, doubleBeds, babyBeds } }, …] }` | Auth required (any role allowed by `requireAuth` — but Planning is admin-facing today, so effectively admin). 400 on missing/invalid `from`/`to` or `from > to`. |

The `laundryDays` array contains **every** occurrence of `laundryWeekday`
between `from` and `to` (inclusive on both ends), in chronological order, even
when both `dropOff` and `pickUp` sum to zero — the client filters the silent
days, not the server. This keeps the contract symmetric and predictable.

The Option resource gains a `countsAsBedLinen: boolean` field in every read /
write path (`GET /api/options`, `POST /api/options`, `PUT /api/options/:id`,
`GET /api/options/:id`). Existing clients that don't send it on update preserve
the current value (typical PATCH-style merge already in place).

The settings resource (`GET / PUT /api/settings`) gains `laundryWeekday`
(integer 0..6). Reject out-of-range values with `400 INVALID_WEEKDAY`.

### 4.4 Default "Linge de lit" option (follow-up, 2026-06-02)

Per Adrien's request: the feature must ship with a default linen option already in place so
the operator doesn't have to manually create one. The seed mirrors the
`early_check_in` / `late_check_out` typed-option pattern (carries `autoOptionType =
'bed_linen'` → undeletable in the OptionsPage UI via the existing
`isDeleteDisabled={(item) => Boolean(item.autoOptionType)}` rule).

**Non-destructive seed rules.** Some prod servers already have a manually-created linen
option from before this feature existed. The seeder must NOT overwrite it nor create a
duplicate beside it. It runs on every boot and resolves in three branches:

1. **Typed seed already exists** (`SELECT 1 FROM options WHERE autoOptionType = 'bed_linen'`
   returns a row) → idempotent no-op. Common case on every boot after the first.
2. **Operator-adopted OR title-aliased option → PROMOTION** (2026-06-02 follow-up). An option
   already carries `countsAsBedLinen = 1` but has no `autoOptionType` — OR — its title is in
   the small `KNOWN_TITLE_ALIASES` list (currently `'linge de lit'`, `'linge de lits'`;
   case-insensitive + trim-tolerant). The earlier behaviour was to skip — but that left the
   operator's option **deletable** in the UI (the `isDeleteDisabled` rule reads
   `autoOptionType`, not `countsAsBedLinen`), which contradicted the "default, always present"
   contract. New behaviour: the seeder **promotes the row in place**:
   `UPDATE options SET autoOptionType = 'bed_linen', countsAsBedLinen = 1
   WHERE (countsAsBedLinen = 1 OR LOWER(TRIM(title)) IN (?, ?))
   AND (autoOptionType IS NULL OR autoOptionType = '')`. The operator's name, price, and
   description are preserved; only the type marker and the flag are added. Multiple matching
   rows are all promoted in one statement. Title aliases are intentionally narrow (no fuzzy
   match) — only the exact list, so legitimately-different options like "Drap supplémentaire"
   are not swallowed. The bathroom-linen seed uses the same shape with
   `KNOWN_TITLE_ALIASES = ['linge de toilette']`.
3. **Fresh install** (no typed seed, no adopted option) → insert a brand-new row with:

| Column | Value |
|---|---|
| `title` | `Linge de lit` |
| `description` | `Parure complète (drap, drap-housse, taie d'oreiller). Compte les parures à apporter / récupérer à la blanchisserie.` |
| `priceType` | `per_stay` |
| `price` | `0` (Adrien sets the actual price via the OptionsPage form) |
| `autoOptionType` | `bed_linen` (drives undeletability) |
| `autoEnabled` | `0` (no automatic add; Adrien picks the option per reservation) |
| `countsAsBedLinen` | `1` (drives the LaundryDayCard out of the box) |

**Trade-off (remaining)**: on a prod server where Adrien had a manual "Linge de lit" option
but never ticked the new flag, the seeder will run the fresh-install path and insert the
typed version alongside the manual one. He then has two options. The fix is manual: either
delete the manual one (the typed one stays undeletable) or tick the flag on the manual one
before the next boot — which now triggers the **promotion path** (rule 2) and makes his
existing option undeletable. Auto-detecting the "right" pre-existing option by fuzzy title
match would be brittle and could pick the wrong row, so the promotion is gated on the
explicit `countsAsBedLinen` opt-in.

**Boot-time logging:** the seed logs one of `[Database] ✅ Default bed-linen option seeded.`,
`[Database] ✅ Bed-linen seed promoted N existing option(s) to the typed bed_linen marker
(kept name/price/description).`, or stays silent on the already-seeded path. Errors
(SQLite busy, missing schema) are caught + logged, never crash the boot.

**2026-06-03 follow-up — promotion runs UNCONDITIONALLY.** The original implementation gated
the promotion path on `hasTypedSeed === false`, which created a stuck state on Adrien's prod:
an earlier (pre-alias) deploy had inserted the typed seed alongside a legacy "Linge de lits"
row, and every subsequent boot short-circuited via `hasTypedSeed=true` → the alias row never
got the marker → stayed deletable. Fix: move the promotion UPDATE to run on every boot before
the `hasTypedSeed` check. The WHERE clause is already idempotent (`AND (autoOptionType IS NULL
OR autoOptionType = '')`), so re-running on every boot is safe. The same fix is mirrored on
the bathroom-linen seed.

---

## 5. Data model

### 5.1 New columns

```sql
-- options table: per-option flag
ALTER TABLE options ADD COLUMN countsAsBedLinen INTEGER NOT NULL DEFAULT 0;

-- app_settings table: global laundry weekday
ALTER TABLE app_settings ADD COLUMN laundryWeekday INTEGER NOT NULL DEFAULT 2;
```

Both wrapped in the existing idempotent `if (!cols.includes(...))` pattern in
`server/src/database.js`.

### 5.2 Defaults & backfill

- `options.countsAsBedLinen` defaults to `0` for every existing row. No backfill —
  Adrien manually ticks his linen option after the migration (a one-time action).
  The UI's empty-feature default (zero laundry days emit cards) is silent until he
  does, so there's no visible regression.
- `app_settings.laundryWeekday` defaults to `2` (Tuesday) per Adrien's current
  practice. The settings UI lets him change it later.

### 5.3 Data impact

Zero risk of data loss or corruption: both columns are additive with safe defaults.
Nothing in the existing code reads them today; the migration is invisible until
the feature ships.

---

## 6. UI / UX

### 6.1 PlanningPage — LaundryDayCard

Mounted between the day header bar and the departures mini-rows, only on dates
that fall on `laundryWeekday`, only when at least one side is non-zero.

```
┌──────────────────────────────────────────────────────────────┐
│ 📅 mardi 9 juin                              ✅ 2/3          │  ← existing day header
├──────────────────────────────────────────────────────────────┤
│  🧺  Linge à la blanchisserie                                │
│  ┌────────────────────────┬─────────────────────────────┐    │
│  │  À apporter            │  À récupérer                │    │
│  │  3 doubles · 2 simples │  1 double · 4 simples · 1 b.│    │
│  └────────────────────────┴─────────────────────────────┘    │
├──────────────────────────────────────────────────────────────┤
│ Departures mini-rows…                                        │
│ Arrival cards…                                               │
```

**Colour (post follow-up 2026-06-02).** Laundry-themed cyan palette tuned in `LaundryDayCard.js`:
- Background: MUI `cyan[50]` (`#E0F7FA`) — fresh / water / linen, not flashy.
- Border: MUI `cyan[200]` (`#80DEEA`) — just defined enough to pop off the page.
- Icon + title accent: MUI `cyan[800]` (`#00838F`) — draws the eye to the actionable info.

These three tones give the laundry card the **highest visual weight** of any per-day element on
the Planning page (more visible than arrival peach, much more visible than departure grey), in
line with Adrien's "this is operational info I must not miss" mental model.

**Adjacent palette change (same follow-up):** ReservationCard (arrival) and DepartureMiniRow
also moved away from the flat `background.paper` (white) default to give the day-cell its own
visual rhythm:
- Arrivals: warm peach (MUI `orange[50]` / `#FFF3E0`) — welcoming, attention-grabbing.
- Departures: very pale grey (MUI `grey[100]` / `#F5F5F5`) — quieter than arrivals on purpose.
- Existing overrides (alert orange/red/blue, "done" green) still take priority over these
  base tones; the change is only the no-alert + not-done default.

Empty side (e.g. zero pick-up) reads "—" so the visual symmetry is preserved.

### 6.2 OptionFormDialog — no UI control for the linen flags

The initial design exposed a `Checkbox` *"Cette option compte des parures de draps"* (and a
second one for towels). Those were **removed in the 2026-06-02 follow-up** at Adrien's
request: the typed seeds + title-alias promotion guarantee the flags are set on the right
rows, and exposing them in the UI was over-engineering (an unflagged option created from this
dialog can never become a linen option except through a server-side seed change). The flags
are still round-tripped via `OptionsPage.fromItem` / `toPayload` so editing an existing
seeded option from this form does not clear them.

### 6.3 SettingsPage — Linge & blanchisserie section

A new Card titled **"Linge & blanchisserie"**, placed in the settings flow
between the reservation-lock and the SMTP sections (operational domain). One
`Select` field: *"Jour de blanchisserie"* — values are the 7 weekday labels
(lundi … dimanche), helper text *"Jour de la semaine où vous déposez et
récupérez le linge à la blanchisserie."*. Same Save / Cancel via the existing
PageActionBar at the top of the SettingsPage.

### 6.4 Responsive behaviour

- **xs (≤600px)**: LaundryDayCard switches `flexDirection` to column —
  "À apporter" stacks above "À récupérer". Each block uses full row width.
  Numbers stay on a single line (the label is "Doubles: 3 · Simples: 2 · Bébé: 1",
  abbreviated to "Db: 3 · Sg: 2 · Bb: 1" at very narrow widths via a `useMediaQuery`
  fallback).
- **md+**: Side by side (default `flexDirection: row`), each block ~50% width.
- The OptionFormDialog checkbox is full-row width on every breakpoint (single
  column form).
- The SettingsLaundrySection inherits the section spacing from SettingsPage
  (already responsive).

### 6.5 PageActionBar

SettingsPage already uses `PageActionBar` with Save / Cancel. The new section is
just an extra Card inside the existing form — no change to the action bar.

PlanningPage has its own header/controls (date picker + Today button) — out of
scope of the action-bar standard; not touched here.

---

## 7. Test plan

### 7.1 Server unit tests

- [ ] `tests/laundry-window.unit.test.js` — pure helpers (no DB). ≥ 8 cases:
  - `findLaundryDaysInRange` enumerates Tuesdays in a 14-day window.
  - Range starts/ends on a laundry day (inclusive on both ends).
  - Range with zero laundry days (Monday → Sunday excluded).
  - `prevLaundryDay` correct across month/year boundaries.
  - DST safety (March 27 → April 3 in a CET DST switch year).
  - Invalid weekday throws.
- [ ] `tests/laundry-model.unit.test.js` — in-memory DB. ≥ 10 cases:
  - Single reservation with flagged option contributes 1 set per bed count
    (single + double + baby summed correctly).
  - `offered = true` row still contributes (rule 2).
  - `quantity` on the option row is ignored (rule 3).
  - Reservation with two flagged options counts once (rule 4).
  - `kind = 'devis'` excluded.
  - Window half-openness: a checkout exactly at the start boundary is excluded;
    at the end boundary is included.
  - Reservation with bed counts = (0, 0, 0) but flagged contributes zero rows
    but does not crash.
  - Empty DB returns zeros.
- [ ] `tests/planning-laundry-controller.unit.test.js` — fake models. ≥ 6 cases:
  - 14-day range emits the right number of laundry days.
  - Pick-up = drop-off of the previous laundry day even when that day is
    outside the planning range.
  - Settings change (laundryWeekday from 2 to 3) reflected in the emitted dates.
  - 400 on missing / invalid `from` or `to`.
  - 400 when `from > to`.
  - Empty drop-off + empty pick-up still emit the day (filtering is client-side).

### 7.2 Manual UI verification

- [ ] **Happy path**: tick `countsAsBedLinen` on an existing option named
      "Linge de lit". Create a reservation that uses it (with 1 double + 2
      single beds), endDate = next Tuesday. Open Planning — Tuesday's card
      shows `À apporter: 1 double · 2 simples` and `À récupérer: —`.
- [ ] **Two laundry days in window**: load a Planning that spans 2 Tuesdays.
      Both render independently with their own counts.
- [ ] **Pick-up reflects previous drop-off**: complete the test above, then
      simulate the following Tuesday in Planning (use the date picker forward).
      The new Tuesday's `À récupérer` matches the previous Tuesday's `À
      apporter`.
- [ ] **Empty week**: Tuesday with no qualifying checkouts and no previous
      drop-off — the LaundryDayCard does NOT render. Day cell is visually
      identical to today's behaviour.
- [ ] **Weekday change**: switch the setting from Tuesday to Wednesday. Reload
      Planning. Cards now appear on Wednesdays only.
- [ ] **Devis exclusion**: convert one of the qualifying reservations to a
      devis (`kind = 'devis'`). Card count updates to exclude it.
- [ ] **Offered option**: mark the linen option on a reservation as `offered =
      true` (existing UI on the reservation page). Counts unchanged.
- [ ] **Mobile (xs, ≤600px)**: open Planning on phone width. The card stacks
      vertically. All counts remain visible.
- [ ] **Regression**: existing Planning day-headers + departures + arrivals
      render unchanged on every day, including non-laundry days.
- [ ] **Regression**: OptionFormDialog still saves options that don't tick the
      new checkbox (existing options untouched).
- [ ] **Regression**: SettingsPage Save / Cancel still works on every other
      section.

---

## 8. Out of scope

- **Past-window display.** The card only renders on dates inside the Planning
  window (forward 14 days). No history view of past laundry days. (If Adrien
  wants one later, a dedicated `/laundry-history` page is a separate spec.)
- **Per-property aggregation.** The card shows totals across all properties.
  Splitting per property (one card per property per laundry day) is out of
  scope — the laundry service handles a single combined batch.
- **Sheet-stock management.** No inventory tracking ("how many sheet sets do I
  own?"). Out of scope.
- **Notifications / alerts.** No email or push when the laundry day approaches.
  The Planning page is the surface.
- **Pricing impact.** The `countsAsBedLinen` flag is a metadata tag with zero
  effect on pricing, invoicing, deposits, or accounting. Today's quote totals
  are not affected.
- **Multi-week laundry cadence.** Only a single weekly cadence is supported.
  A bi-weekly setup ("every other Tuesday") is out of scope.
- **Accommodation that doesn't go through the linen option.** Reservations
  without the flagged option contribute zero — Adrien is expected to consistently
  tick the option (or one of his flagged variants) on any reservation where he
  provides sheets. There is no override mechanism.

---

## 9. Open questions

_(All resolved before moving Status → Approved.)_

- Q: Tile the laundry counter by bed type or aggregate everything in one chip?
  - A: Tile by bed type. Adrien needs to know how many of each size to load.
- Q: What's the default weekday?
  - A: Tuesday (`2`). Adrien's current operational rhythm.
- Q: Should the card render on weeks with both counters at zero?
  - A: No. Render only when at least one side is non-zero (rule 9 + 13).
- Q: Does the `offered` flag affect the count?
  - A: No. Sheets get dirty regardless of whether the option was free or paid.
