# Hourly resources: sold by the hour, scheduled in the arrival SAS

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/hourly-resource-quantity-and-sas-scheduling` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Reported 2026-08-17: on a new devis for the Lodge (platform `direct`), switching the **Bain nordique**
on shows the resource card with « Total: 0,00 € », but the **Résumé tarifaire contains no
« Bain nordique » line and the total ignores it**. Reproduced live (browser + API).

The platform is **not** involved: `isDirectChannel()` is consulted only for option free-units
([pricing.js:1301](../server/src/utils/pricing.js#L1301), `applyFreeUnitsToLine`); resources never read
it, and `platformGrossPin` is explicitly non-direct only. Four independent defects are in play.

**Defect 1 — an enabled hourly-scheduled resource with no session is silently erased.**
« Bain nordique » is `showsPlanningCard = 1` + `priceType = 'per_hour'`, so it takes the *scheduled*
branch of the engine:

```js
// server/src/utils/pricing.js:1642-1656
if (hourlyScheduled && !(planningCardAsQuantity && sessions.length === 0)) {
  const priced = priceSessions(sessions, {...}, resourceForFlags.freeMinutes);
  if (priced.validSessions.length === 0) return null;   // ← the line disappears
```

Flipping the fiche Switch only sets `quantity: 1`
([ReservationPage.jsx:1480-1487](../client/src/pages/ReservationPage.jsx#L1480-L1487)); it seeds no
session. `planningCardAsQuantity` is the **public/WordPress** escape hatch only
([devisModel.js:349](../server/src/models/devisModel.js#L349)), so on an admin fiche the engine returns
`null`. The summary renders exclusively `quote.resourceLines`
([PricingSummary.jsx:467](../client/src/components/PricingSummary.jsx#L467)) — no line, no money, no
warning. Measured on `POST /api/reservations/calculate-price` (Lodge, 11→14/09/2026, direct):

| Payload | `resourceLines` | Total |
|---|---|---|
| resource enabled, 0 session | `[]` | 359,79 € |
| resource enabled, 1 session 15:00–16:00 | 1 line, 30 € | 389,79 € |

**Defect 2 — on a blank « Nouveau devis » the Ressources block never renders at all.**
`loadPropertyContext` fills `availableResources` from `propDetails.resources`
([ReservationPage.jsx:280-285](../client/src/pages/ReservationPage.jsx#L280-L285)), but
`GET /api/properties/:id` **has no `resources` key** — `propertiesModel.getByIdWithDetails` returns
`closureRanges, pricingRules, rateInclusions, documents, optionIds, options, optionGroups, icalSources`
and nothing else. That branch is dead code. The only real setter is `loadResourcesAvailability`
([ReservationPage.jsx:1030-1043](../client/src/pages/ReservationPage.jsx#L1030-L1043)), which returns
early without both dates and is called from just four places (edit reservation, edit devis, init,
Logement select change) — **no effect re-runs it when the operator types the dates**. Verified in the
browser: `/reservations/new?mode=devis`, dates filled → still zero resources, and no availability
request fired. This contradicts
[devis-extras-parity-and-price-lock.md](devis-extras-parity-and-price-lock.md) §3 rule 1, marked
`Implemented`.

**Defect 3 — `recomputeDevisQuote` drops sessions.**
[devisQuote.js:36](../server/src/utils/devisQuote.js#L36) rebuilds `selectedResources` **without**
`sessions`, unlike the PDF path ([devisController.js:119](../server/src/controllers/devisController.js#L119)).
Any hourly-scheduled resource is erased again on that recompute.

**Defect 4 — the slot-conflict check ignores reservation sessions.**
`countConflicts` ([resourceBookingsModel.js:92-104](../server/src/models/resourceBookingsModel.js#L92-L104))
queries `resource_bookings` only. Sessions stored on `reservation_resources.sessions` are invisible to
it, so a standalone booking can be created straight on top of a guest session. The planning view papers
over this by merging the two lists **client-side**
([ResourcePlanningPage.jsx:99-120](../client/src/pages/ResourcePlanningPage.jsx#L99-L120)) — a
fat-backend violation, and no protection at write time.

**Product decision behind this spec.** Requiring the operator to schedule the sessions at quote time is
the wrong moment: when the devis is written, nobody knows which evening the guests will want the nordic
bath. So the resource is **sold by the hour** on the quote, and the **hours are placed with the guest
at check-in**, inside the arrival SAS — which is run on a phone, so the picker must be thumb-friendly.

**Thermal reality of the nordic bath (added 2026-08-17).** A nordic bath is not instantly available:
from cold it needs several hours to heat up, and once heated it **stays usable for roughly 8 hours**
after a use. GuestFlow models neither today — it only knows `turnoverMinutes` (the between-uses
reset). The consequence for scheduling is concrete and asymmetric:

- a slot with **no recent use before it** needs the full **montée en chauffe** and is simply not
  offerable that soon after check-in;
- a slot **shortly after another use** needs only the **remise en état** — so *packing bookings
  together is cheaper and faster*, and the operator must be able to see the neighbours to aim for it.

The SAS must therefore offer **only coherent slots**, computed from all of it, rather than a raw grid.

## 2. Goal

An hourly resource can be sold on a devis or a reservation **just by choosing a number of hours** — it
always appears in the summary and in the total. Those hours are then placed **with the guest during the
arrival SAS**, on a mobile-first picker that shows the resource's existing bookings over the stay and
offers **only slots that are genuinely bookable** — open, free, not in the past, and thermally ready.

## 3. Functional rules

### 3.1 Selling the hours (devis and reservation fiche)

1. **Quantity is the default sale unit for an hourly-scheduled resource.** When the operator enables a
   resource with `showsPlanningCard = 1` + `priceType = 'per_hour'` and **no session is scheduled**, the
   engine prices it from its **quantity in hours** over the day-rate grid, and returns a normal
   `resourceLine`. It is never dropped. This generalises the existing `planningCardAsQuantity` behaviour
   from the public flow to every caller; the flag is retired as a *condition* (see rule 3).
2. **Scheduled sessions win over quantity.** When `sessions` is non-empty, the line is priced from the
   sessions on the time-banded grid exactly as today (`priceSessions`), and `quantity` is ignored. A
   session that fails validation (slot alignment, opening window, minimum duration) is still dropped —
   but if *every* session is invalid the line falls back to quantity pricing instead of vanishing.
3. **`planningCardAsQuantity` becomes a no-op for resources.** The public/WordPress callers
   (`publicQuoteController`, `publicBookingRequestController`, `devisModel.computeQuote`) keep passing
   it harmlessly; the engine no longer branches on it for resources. Its option-side behaviour
   ([pricing.js:1429](../server/src/utils/pricing.js#L1429)) is untouched.
4. **The fiche shows an « Heures » field again for these resources.** `ExtrasSection` currently replaces
   it with an empty spacer when `isHourlyScheduled`
   ([ExtrasSection.jsx:327-342](../client/src/components/reservation/ExtrasSection.jsx#L327-L342)). The
   quantity field comes back, with helper text « Heures vendues — planifiées au check-in ». The session
   editor stays available underneath for the operator who *does* know the slot.
5. **Unscheduled hours are flagged in the summary.** A resource line with hours sold and no session
   renders a « à planifier » chip next to its name in `PricingSummary`. A partially placed line reads
   « 1 h sur 3 planifiées ». Display only — no effect on the total.
6. **The free allowance is unchanged.** `freeMinutes` (per property, e.g. the Gîte's free first hour) is
   deducted once from `billedUnits` on the quantity path exactly as on the session path. A single free
   hour on the Gîte therefore still yields a 0 € line — which is now **visible**, with its existing
   « 1ère heure offerte pour ce logement » hint, instead of absent.
7. **Hours sold ≠ hours billed.** `quantity` is what the guest may use and what the SAS must place;
   `billedUnits` is what is charged after the free allowance. Both are stored on
   `reservation_resources`.

### 3.2 Making the resources reachable (defects 2 and 3)

8. **`GET /api/properties/:id` returns `resources`.** `propertiesModel.getByIdWithDetails` gains a
   `resources` array (the property-applicable catalogue with its resolved per-property `price` and
   `freeMinutes`), so `loadPropertyContext`'s existing branch finally has data and the Ressources block
   renders on a blank « Nouveau devis » / « Nouvelle réservation » — spec parity with
   [devis-extras-parity-and-price-lock.md](devis-extras-parity-and-price-lock.md) §3 rule 1.
9. **Availability refreshes when the stay range becomes complete.** A `useEffect` on
   `(selectedProp, form.startDate, form.endDate)` re-runs `loadResourcesAvailability` as soon as both
   dates are set, so « déjà réservée » and the remaining quantity are correct without touching the
   Logement select. Until then the catalogue from rule 8 is shown with its nominal quantity.
10. **`recomputeDevisQuote` passes `sessions`** ([devisQuote.js:36](../server/src/utils/devisQuote.js#L36)),
    aligning it with the PDF path.

### 3.3 Thermal readiness model (new)

11. **Two new resource settings**, editable in Réglages → Ressources for any `per_hour` resource:
    - **`heatUpMinutes`** — « Montée en chauffe » : minutes needed to bring the resource to a usable
      state **from cold** (nordic bath: typically 240).
    - **`heatRetentionMinutes`** — « Reste chaude » : how long after the **end of a use** the resource
      is still usable without re-heating (nordic bath: typically 480 = 8 h).
    Both default to **0**, which reproduces today's behaviour exactly — see rule 16.
12. **A candidate start `S` is thermally ready** when either:
    - **hot path** — there is a prior use of the resource ending at `lastEnd ≤ S` with
      `S − lastEnd ≤ heatRetentionMinutes`, and `S ≥ lastEnd + turnoverMinutes` (the remise en état is
      the only wait); **or**
    - **cold path** — no such recent use, and `S ≥ notBefore + heatUpMinutes`.
    `lastEnd` is the **latest end across all occupancy of that resource** (standalone bookings, other
    reservations' sessions, and blocks already placed in this SAS run), **looking back across
    midnight** — a use ending at 22:00 keeps the bath hot for the next morning's 06:00 slot when
    retention is 8 h.
13. **`notBefore` = `max(now, reservation check-in datetime)`.** Nothing is ever offered in the past,
    nor before the guests are physically there. On a re-opened SAS on day 2, `now` wins.
    « Heure d'arrivée » is the reservation's `checkInTime` on its `startDate`.
14. **Opening window always applies**, on top of everything else: the day's weekday must be in
    `openDays` and the date not in `closedDays`; `S ≥ openTime` and `S + minimumUsageMinutes ≤
    closeTime`. Thermal readiness never opens a slot outside the window.
15. **Capacity and turnover** (unchanged semantics, now applied to the unified occupancy): a candidate
    block `[S, E)` is free when the number of occupancy items overlapping
    `[S − turnoverMinutes, E + turnoverMinutes)` is **strictly below** `resources.quantity`.
16. **Non-regression by default.** With `heatUpMinutes = 0` and `heatRetentionMinutes = 0` the cold path
    degrades to `S ≥ notBefore` and the hot path never triggers — i.e. exactly the pre-existing
    opening-window + capacity + turnover behaviour. **Every existing resource keeps its current
    availability**; only a resource explicitly configured with a heat-up time changes.

### 3.4 Placing the hours — new arrival SAS step

17. **New page « Planifier les ressources »**, inserted in the arrival SAS **right after « Options
    réservées »** ([arrival-departure-sas.md](arrival-departure-sas.md) §3.1 rule 7). Applicable only
    when the reservation carries ≥ 1 hourly-scheduled resource with **remaining hours > 0**
    (`quantity` − hours already placed in `sessions`). Skipped otherwise, like every other conditional
    page.
18. **One sub-card per resource**, headed « Bain nordique — 3 h achetées, 2 h à planifier ».
18.bis **The day strip is swipeable, and says so** (added 2026-08-17). A long stay does not fit: a
    fortnight is 14 day chips for about three visible on a phone. The strip has always scrolled, but
    nothing signalled it — the last visible chip sat flush against the edge and read as the end of the
    list. It now carries a fade on whichever side still has days, a chevron that jumps a screenful
    (for the desktop operator without a swipe gesture), scroll-snap, and it **keeps the selected day
    scrolled into view** so a day picked late in the stay does not vanish when the slots refresh.
19. **The existing bookings of the stay are shown**, per day, as a read-only occupancy strip: « 14:00–
    15:00 réservé ». **No client name is displayed** — the SAS is run with the guest standing there.
    Their purpose is to let the operator *deliberately place the new session next to an existing one*,
    where only the remise en état applies instead of a full montée en chauffe.
    **The operator's own in-run placements stay out of that strip** (amended 2026-08-17 during
    implementation): they still gate the slots (rule 25), but the strip answers « who else has it? »,
    and the placements are already listed — and removable — under the grid. Showing them twice read
    as somebody else having booked the slot the operator had just chosen.
20. **Free placement in blocks** (decision 2026-08-17). The guest places the remaining hours as any
    combination of blocks, on any day of the stay, provided each block is ≥ `minimumUsageMinutes` and
    aligned on `slotDuration`. 3 h can be one 3 h block, three 1 h blocks on three days, or 1 h + 2 h.
20.bis **The moment a remise en état ends is offered as its own start** (added 2026-08-17). The reset
    is a per-resource setting, so the exact minute the resource frees up is known: a bath used until
    14:00 with a 15-minute reset is available at **14:15**. On a whole-hour grid the first offer would
    be 16:00 — an hour and three quarters of an already-hot bath thrown away. So `previous end +
    turnoverMinutes` becomes a candidate start of its own.
    - **The whole hour is shifted ONLY in that case.** No other off-grid time is ever invented.
    - It is offered **only when it is genuinely bookable**; an off-grid start that is taken, heating
      or past is not rendered at all — unlike a grid slot, it explains nothing, it is purely an extra
      opportunity.
    - It chains: placing a block at 14:15 makes 15:30 the next such offer.
    - The picker labels it **« enchaîne »**, so an odd time reads as an opportunity rather than a bug.
    - The commit re-validates it: a start is legitimate when it sits on the grid **or** is exactly a
      reset-end. Any other odd time is refused with `reason: 'duration'`.
21. **Only bookable slots are tappable; the rest are greyed with a reason.** The server returns every
    slot of every stay day with an explicit state, and the picker renders — never hides — them:

    | State | Meaning | Rendering |
    |---|---|---|
    | `free` | bookable now | outlined chip, tappable |
    | `free` + `warm: true` | bookable **and still hot** (rule 12 hot path) | outlined chip + 🔥 « encore chaude » |
    | `free` + `afterReset: true` | an off-grid start opened by a reset ending (rule 20.bis) | outlined chip + « enchaîne » |
    | `taken` | capacity reached (rule 15) | greyed, « réservé », not tappable |
    | `heating` | blocked only by the montée en chauffe (rule 12 cold path) | greyed, « montée en chauffe » |
    | `past` | before `notBefore` (rule 13) | greyed, « passé » |
    | `closed` | outside the opening window (rule 14) | greyed, « fermé » |

    A day whose slots are all non-`free` is still listed, so the operator sees *why* rather than an
    empty grid.
22. **Evening slots carry a supplement** (decision 2026-08-17). The hours were sold at the day rate. A
    placed block whose minutes fall at/after `hourlyEveningStart` adds
    `Σ (eveningRate − dayRate) × eveningMinutes / 60` to the **arrival complement**. The picker badges
    those slots « +X € » before the guest commits. The quoted price is never re-played, and the
    supplement never goes negative (an evening rate ≤ day rate yields 0).
23. **The step is skippable** (decision 2026-08-17). « Planifier plus tard » moves on; the recap then
    states « Bain nordique : 2 h non planifiées », and the reservation fiche + resource planning keep
    the remaining hours visible. A check-in is never blocked by scheduling.
24. **Nothing is written before the final commit**, per §3.0 rule 3 of the SAS spec. The chosen blocks
    live in client memory and are persisted by `POST /reservations/:id/sas/arrival`, which writes them
    into `reservation_resources.sessions` and adds any evening supplement to the arrival complement.
25. **Placing a block immediately re-computes the remaining slots**, because it becomes occupancy for
    rules 12 and 15 — a second block can then legitimately sit right after the first (hot, remise en
    état only). The client sends its in-memory blocks as `pending` on each availability refresh.
26. **Re-opening a completed SAS shows the already-placed blocks** and lets the operator remove or move
    them (specs/reopen-completed-sas.md). A removed block frees its slot; the supplement is recomputed
    from scratch on each commit, never accumulated.
27. **The commit is atomic and re-validated server-side.** Opening window, capacity, turnover, thermal
    readiness, minimum duration and the remaining-hours budget are all re-checked at commit time; a
    conflict returns `409` with the offending block and writes nothing.

### 3.5 Conflict detection (defect 4)

28. **`countConflicts` also counts reservation sessions.** A new model helper unions
    `resource_bookings` and `reservation_resources.sessions` for a `(resourceId, date range)` and counts
    turnover-aware overlaps, so a standalone booking can no longer be created on top of a guest session
    — and vice versa. Both `resourceBookingsModel.createBooking/update` and the SAS commit go through it.
29. **The planning merge moves to the server.** `GET /api/resource-bookings` returns the unified
    occupancy (standalone + reservation sessions, each tagged `kind: 'booking' | 'session'`), and
    `ResourcePlanningPage` drops its client-side merge — fat backend, and one single definition of
    « occupied ». Unlike the SAS picker (rule 19), this list **does** name the client: it is the
    operator's own planning, beside standalone bookings that already do.
29.bis **The « remise en état » band is drawn after a guest session too** (amended 2026-08-17 during
    implementation). It used to be suppressed for sessions. Now that the reset gates both kinds
    identically (rule 28), hiding it showed the grid as freer than the server will actually allow.

**Edge cases:**
- Resource enabled, quantity 0 → no line (unchanged; the Switch always sets ≥ 1).
- Every session invalid after a resource reconfiguration → falls back to quantity pricing (rule 2)
  rather than vanishing. Applies to legacy rows like devis 22213 (`sessions = NULL`, quantity 1).
- Guest arrives at 16:00, bath cold, `heatUpMinutes = 240` → the arrival day offers nothing before
  20:00; days 2+ are unaffected (`notBefore + heatUp` is long past).
- Another client used the bath until 14:00, retention 8 h, turnover 15 min → the 16:00 slot is `free`
  **and** `warm` even though the guest only arrived at 16:00 — the cold path never applies.
- Prior use ends at 22:00 on day 1, retention 8 h, resource opens at 11:00 → the 11:00 slot on day 2 is
  **cold** (13 h gap), the montée en chauffe applies. Cross-midnight look-back must be exercised.
- `heatRetentionMinutes = 0` → every slot takes the cold path, whatever the neighbours.
- `heatUpMinutes = 0` → identical to today (rule 16).
- Stay entirely on `closedDays` / outside `openDays` → all slots `closed`; the step is skippable and
  the hours stay unplaced.
- Remaining hours smaller than `minimumUsageMinutes` (0,5 h left, minimum 1 h) → no block can be built;
  the card explains it and the step is skippable.
- Free-hour property (Gîte): the 0 € line is still placeable — the free hour occupies a real slot.
- A block that straddles `hourlyEveningStart` is billed pro-rata: only the minutes after the switch
  carry the supplement.
- `complementPaid = 1` already → the supplement is still recorded and the recap warns about the delta
  to collect, per §3 edge cases of the SAS spec.

---

## 4. Architecture

> **Fat backend, thin frontend.** Slot states, capacity/turnover arithmetic, the thermal model, the
> evening supplement, the remaining-hours budget and every validation are computed server-side. The SAS
> picker renders a ready-to-tap list of slots with their state and holds the guest's picks in memory
> until the single commit. **No time arithmetic in React.**

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `utils/pricing.js` | T | Rules 1-3, 6-7: hourly-scheduled resources fall back to quantity pricing when no valid session; `planningCardAsQuantity` no longer gates it. |
| `utils/` | `utils/resourceHourlyPricing.js` | T | Rule 22: `eveningSupplement(blocks, cfg)` — pure, pro-rata over the evening band, never negative. |
| `utils/` | `utils/resourceAvailability.js` | C | Rules 12-16, 20-21, 25: **the** slot algebra. Pure, no DB, no `Date.now()` (the clock is injected). Builds each day's grid, classifies every slot `free`/`taken`/`heating`/`past`/`closed`, flags `warm`, and validates an arbitrary block. |
| `utils/` | `utils/devisQuote.js` | T | Rule 10: pass `sessions` through `selectedResources`. |
| `models/` | `models/resourceOccupancyModel.js` | C | Rules 12, 15, 19, 28-29: the single « what occupies this resource » reader — unions `resource_bookings` and `reservation_resources.sessions` over a date range, tagged by kind, with the look-back day needed for retention. |
| `models/` | `models/resourceBookingsModel.js` | T | Rule 28: `countConflicts` delegates to `resourceOccupancyModel`; `listForResource` returns the unified occupancy. |
| `models/` | `models/resourcesModel.js` | T | Rule 11: read/write `heatUpMinutes` + `heatRetentionMinutes` (joins the existing `HOURLY_COLUMNS` guarded-column pattern). |
| `models/` | `models/propertiesModel.js` | T | Rule 8: `getByIdWithDetails` returns `resources` (applicable catalogue + resolved `price` / `freeMinutes`). |
| `models/` | `models/reservationsModel.js` | T | Rule 24: `commitArrivalSas` persists the placed blocks into `reservation_resources.sessions` and folds the evening supplement into the arrival complement. |
| `models/` | `models/bookingLinesModel.js` | T | Rule 7: keep `quantity` (hours sold) alongside `billedUnits` on the scheduled path — today the scheduled branch overwrites `quantity` with the session count. |
| `controllers/` | `controllers/sasController.js` | T | Rules 17-19, 23, 27: assemble the new page payload (per-resource remaining hours + per-day classified slots + occupancy strip); accept, re-validate and commit the placed blocks. |
| `controllers/` | `controllers/resourcesController.js` | T | Rule 25: availability endpoint for the picker's live refresh. |
| `routes/` | `routes/resources.js` | T | `GET /api/resources/:id/free-slots`. |
| `database.js` | `database.js` | T | Rule 11: idempotent `ADD COLUMN` for `resources.heatUpMinutes` + `resources.heatRetentionMinutes` (both `INTEGER NOT NULL DEFAULT 0`). |

**Notes:**
- `resourceAvailability.js` is the only place time arithmetic lives; it takes `{ now }` as an argument
  so it is deterministic under test (project rule: no `Date.now()` in workflow-visible logic).
- `resourceOccupancyModel` is the seam that fixes defect 4 once for all three consumers (planning view,
  standalone booking write, SAS picker).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/sas/SasResourceSchedulingPage.jsx` | C | Rules 17-21, 23, 25: the new SAS page — resource sub-cards, day chips, occupancy strip, slot grid, placed-block list, « Planifier plus tard ». |
| `components/` | `components/sas/ReservationSasDialog.jsx` | T | Registers the new step + its icon; carries the placed blocks into the commit payload. |
| `components/` | `components/SlotPickerGrid.jsx` | C | Generic, reusable: renders a day's server-classified slots as large tappable chips with their state, warmth and supplement badges. |
| `components/` | `components/reservation/ExtrasSection.jsx` | T | Rules 4-5: restore the « Heures » field for hourly-scheduled resources; keep the session editor below. |
| `components/` | `components/PricingSummary.jsx` | T | Rule 5: « à planifier » / « 1 h sur 3 planifiées » chip on a resource line. |
| `pages/` | `pages/ReservationPage.jsx` | T | Rule 9: effect re-running `loadResourcesAvailability` when both dates are set. |
| `pages/` | `pages/ResourcesPage.jsx` | T | Rule 11: « Montée en chauffe (min) » + « Reste chaude (min) » fields for `per_hour` resources, wired through `resourceToPayload`. |
| `pages/` | `pages/ResourcePlanningPage.jsx` | T | Rules 29 / 29.bis: drop the client-side merge and the second fetch, read `kind` for the read-only + colour branches, draw the turnover band after a session too. |
| `api.js` | `api.js` | T | `getResourceFreeSlots`; `commitArrivalSas` carries `resourceBlocks`. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `AnswerButtons` (SAS footer), MUI `Chip`/`Card`, `EmptyState`, `ErrorAlert`, `LoadingState` | Pre-existing. |
| **Created (new generic)** | `SlotPickerGrid` | Generic « pick a time slot in a day » grid driven entirely by a server-supplied slot list (`{ start, end, state, warm, supplement }`). Second consumer already identified: `ResourceBookingDialog` (standalone bookings) hand-rolls the same grid today and should migrate — out of scope here, noted in §8. |
| **Specific (kept feature-local)** | `SasResourceSchedulingPage` | One SAS step, like every other `components/sas/*Page`. It is a composition of `SlotPickerGrid` + the SAS shell; nothing else in the app schedules *purchased* hours. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/properties/:id` | — | `{ …, resources: [{ id, name, price, freeMinutes, priceType, showsPlanningCard, slotDuration, openTime, closeTime, minimumUsageMinutes, quantity }] }` | Rule 8, additive. |
| GET | `/api/resources/:id/free-slots` | query `reservationId, pending=<json blocks>` | `{ days: [{ date, weekdayLabel, closed, occupancy: [{ start, end }], slots: [{ start, end, state, warm, supplement }] }] }` | Rules 12-15, 19, 21-22, 25. `state ∈ free \| taken \| heating \| past \| closed`. `occupancy` carries **no** client identity and **excludes** the in-run `pending` blocks (rule 19). The stay range and the property come from the reservation — the client passes neither. |
| GET | `/api/reservations/:id/sas?mode=arrival` | — | `{ …, resourceScheduling: { applicable, resources: [{ resourceId, name, hoursSold, hoursPlaced, hoursRemaining, slotDuration, minimumUsageMinutes, sessions, days: […] }] } }` | Rules 17-18, additive to the existing payload; `days` has the same shape as `free-slots`. |
| POST | `/api/reservations/:id/sas/arrival` | `{ …, resourceBlocks: [{ resourceId, date, start, end }] }` | `{ ok, complementAmount, eveningSupplement }` | Rules 24, 26-27. `409 { error: 'SLOT_CONFLICT', block, reason }` with `reason ∈ taken \| heating \| past \| closed \| budget \| duration`; writes nothing. |
| GET | `/api/resource-bookings?resourceId&weekStart` | — | `[{ …, kind: 'booking' \| 'session', reservationId, turnoverMinutes }]` | Rule 29, unified occupancy. |
| PUT/POST | `/api/resources/:id` | `{ …, heatUpMinutes, heatRetentionMinutes }` | resource | Rule 11, additive. |

Auth: all endpoints behind the existing session auth; the SAS commit keeps its reception-role lock
(`receptionSasLock`). The commit is idempotent per rule 26 — it **replaces** the placed blocks and
recomputes the supplement from scratch.

---

## 5. Data model

**One idempotent migration**, on `resources` (`server/src/database.js`, same `tryAdd…Col` pattern as the
existing hourly columns):

```sql
ALTER TABLE resources ADD COLUMN heatUpMinutes        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resources ADD COLUMN heatRetentionMinutes INTEGER NOT NULL DEFAULT 0;
```

Existing rows get `0` / `0`, which by rule 16 reproduces today's availability exactly — **no behavioural
change for any resource until the operator fills them in**. To be set on the Bain nordique after
deploy (typically 240 / 480).

Everything else already exists:

- `reservation_resources.quantity` — hours sold (rule 7). The scheduled path currently overwrites it
  with the session count; it must keep the sold hours instead (`bookingLinesModel`).
- `reservation_resources.billedUnits` — hours charged after `freeMinutes`.
- `reservation_resources.sessions` — JSON `[{ date, start, end, done }]`, written by the SAS commit.
- `resources.turnoverMinutes` / `slotDuration` / `minimumUsageMinutes` / `openTime` / `closeTime` /
  `openDays` / `closedDays` / `quantity` / `hourlyEveningStart` / `hourlyEveningRate`.
- `property_resource_prices (propertyId, resourceId, price, freeMinutes)`.
- The evening supplement lands in the **arrival complement** through the existing mechanism (a
  `reservation_custom_options` row `inComplement = 1`, `sasArrivalOrigin = 1`, re-priced by the engine),
  so it is visible in the fiche, the recap and the J-1 email like every other SAS-added line.

**Data impact:** additive. Existing rows with `sessions = NULL` and `quantity ≥ 1` (e.g. devis 22213)
start being priced by quantity instead of being dropped — which is the fix, and **raises** their total.
Worth a `CHANGELOG.md` entry under `Fixed` **and** a `Migration` note for the two new columns: no row is
rewritten, but a stored quote that silently lost its resource will re-price on its next save.

## 6. UI / UX

### Réglages → Ressources

Two number fields, shown only for `priceType = 'per_hour'`, beside « Remise en état (min) »:
« **Montée en chauffe (min)** » (helper: « Temps pour rendre la ressource utilisable à froid ») and
« **Reste chaude (min)** » (helper: « Durée pendant laquelle elle reste utilisable après un passage »).
Both accept 0 = non applicable.

### Fiche (devis + réservation)

- The hourly resource card regains its **« Heures »** number field (helper: « Heures vendues —
  planifiées au check-in »), with the **Séances** editor kept below for the operator who already knows
  the slot. « Total » on the card reflects the quantity price immediately.
- `PricingSummary`: the resource line gains a small outlined chip — **« à planifier »** (nothing placed)
  or **« 1 h / 3 h planifiées »** (partial). Neutral colour, no alarm: an unplaced resource is a normal
  state until check-in.

### SAS — « Planifier les ressources » (mobile first)

The SAS runs on a phone, so the page is thumb-first and never scrolls horizontally:

- **Header band**: SAS arrival orange, step icon `HotTub`, title « PLANIFIER », « Étape X/Y ».
- **Body**, one sub-card per resource:
  - Title line: « Bain nordique » + a bold counter **« 2 h à planifier »** (turns green « Tout est
    planifié » at 0).
  - **Day selector**: a horizontal row of large day chips (« sam. 12 », « dim. 13 »…), ≥ 48 px tall,
    scrollable; a day with no `free` slot is dimmed but still selectable (the operator must be able to
    see *why*).
  - **Occupancy strip** for the selected day (rule 19): compact read-only rows « 14:00 – 15:00 ·
    réservé », or « aucune réservation ce jour ». No names.
  - **Slot grid** (`SlotPickerGrid`): the day's slots as chips, 2 columns on `xs`, 4 on `sm+`, each
    ≥ 48 px, rendered from the server `state` (rule 21) — `free` outlined and tappable, `free` + warm
    with a 🔥 « encore chaude », `taken` / `heating` / `past` / `closed` greyed, non-tappable, each
    carrying its short French reason. Evening slots add the « +40 € » supplement badge.
  - Tapping a start places a block of the minimum duration; **« + 1 h » / « − 1 h »** on the placed
    block extends or shrinks it while hours remain and the extension stays bookable.
  - **Placed blocks list**: « sam. 12 · 20:00–21:00 · +40 € » with a delete icon each.
  - Running total of the supplement at the bottom of the card when > 0.
- **Footer**: **« Suivant »** (primary blue) and **« Planifier plus tard »** (discreet), stacked
  full-width on `xs`, side by side on `sm+`. Not a yes/no safety question → neutral styling, same
  treatment as the ménage upsell.
- **States**: skeleton while the slots load; `ErrorAlert` + « Réessayer » on failure — **a failed load
  must never render as an empty grid** (it would read as « tout est libre » and invite a double
  booking, per `ds-sweep-planning.md` rule 9); an `EmptyState` « aucun créneau disponible sur ce
  séjour » only when the server genuinely returned no bookable slot, with the dominant reason spelled
  out (« ressource fermée », « montée en chauffe trop longue »).
- **Recap**: when hours remain unplaced, a line « Bain nordique : 2 h non planifiées » next to the
  complement detail. An evening supplement appears as a normal complement line.

### Responsive

| Breakpoint | Behaviour |
|---|---|
| `xs` (≤600) | SAS dialog `fullScreen`; day chips in a horizontal scroller; occupancy strip full-width; slot grid 2 columns; footer buttons stacked full-width; all targets ≥ 48 px. |
| `md` (~900) | Centred dialog; slot grid 4 columns; footer buttons side by side. |
| `lg` (≥1200) | Same as `md`, wider card, no layout change. |

**Sticky action bar:** not applicable — this change adds no page. The SAS is a dialog with its own
header band; `ReservationPage`, `ResourcesPage` and `ResourcePlanningPage` keep their existing
`PageActionBar`.

## 7. Test plan

The thermal model and the slot algebra are pure functions with an injected clock, so they are covered
exhaustively by unit tests; the regressions found in §1 each get a dedicated guard.

### Server — new unit tests

_Implemented 2026-08-17: **2912 server tests green** (+61), **941 client tests green** (+23). Every box
below is checked unless noted._

**`tests/planning-card-public-pricing.unit.test.js` + `tests/pricing-resource-types.unit.test.js`**
(rules 1-3, 6-7) — the quantity-pricing cases landed in the two existing pricing suites rather than a
new file, next to the assertions they replace (three of which pinned the old, buggy contract)
- [x] hourly-scheduled resource, no session → a priced line is returned (**regression guard, defect 1**)
- [x] …and the quote total increases by that amount
- [x] with valid sessions → priced from the sessions, quantity ignored
- [x] with only *invalid* sessions → falls back to quantity pricing, never `null`
- [x] `freeMinutes` deducted exactly once on the quantity path (Gîte 1 h free → 0 € visible line)
- [x] `quantity` (hours sold) preserved next to `billedUnits` on both paths
- [x] `planningCardAsQuantity: true` and `false` now produce the same resource line

**`tests/resource-availability.unit.test.js`** (rules 12-16, 20-21, 25) — the core algebra
- [x] grid built from `openTime`/`closeTime` in `slotDuration` steps; last slot fits `minimumUsageMinutes`
- [x] weekday not in `openDays` → all `closed`; date in `closedDays` → all `closed`
- [x] slot before `notBefore` → `past`; `notBefore` = `max(now, checkIn)` both ways round
- [x] overlapping occupancy → `taken`; capacity 2 → still `free` with one overlap, `taken` with two
- [x] turnover buffer blocks the slot immediately after a use, and the one immediately before
- [x] **cold path**: no prior use → slots before `notBefore + heatUpMinutes` are `heating`, the first
      one after is `free`
- [x] **hot path**: prior use ending 14:00, retention 480, turnover 15 → 14:15 is `free` + `warm`
- [x] **retention boundary**: gap exactly `heatRetentionMinutes` → still `warm`; one slot later → `heating`
- [x] **cross-midnight look-back**: use ends 22:00 day 1, retention 480 → 06:00 day 2 `warm`; retention
      60 → 11:00 day 2 `heating`
- [x] `heatRetentionMinutes = 0` → every slot cold whatever the neighbours
- [x] **`heatUpMinutes = 0` + `heatRetentionMinutes = 0` reproduces the pre-existing classification
      exactly** (**non-regression guard for every existing resource**, rule 16)
- [x] `pending` in-run blocks count as occupancy (rule 25): placing 15:00–16:00 makes 15:00 `taken` and
      16:15 `free` + `warm`
- [x] **rule 20.bis** — a use ending 15:00 with a 15-min reset offers `15:15`, flagged `afterReset`,
      inserted in chronological order between 15:00 and 16:00; nothing off-grid appears without an
      occupancy; a reset-end that cannot fit the minimum is not offered; a reset-end landing on the
      grid stays an ordinary grid slot; placing at 15:15 chains the next offer to 16:30
- [x] block validation: below `minimumUsageMinutes` → rejected; unaligned on `slotDuration` → rejected;
      crossing `closeTime` → rejected; exceeding the remaining budget → rejected; a start that is
      exactly a reset-end → **accepted**, any other odd time → rejected (rule 20.bis)
- [x] the function is deterministic: same inputs + injected `now` → same output (no `Date.now()`)

**`tests/resource-evening-supplement.unit.test.js`** (rule 22)
- [x] day-only block → 0
- [x] evening-only block → full `(eveningRate − dayRate) × hours`
- [x] block straddling `hourlyEveningStart` → pro-rata on the evening minutes only
- [x] `eveningRate ≤ dayRate`, or no `hourlyEveningStart` → 0, never negative
- [x] several blocks → summed

**`tests/resource-occupancy-conflicts.unit.test.js`** (rules 28-29)
- [x] a guest session blocks a standalone booking creation (**regression guard, defect 4**)
- [x] a standalone booking blocks a guest session placement
- [x] turnover respected on both sides of the union
- [x] capacity > 1 lets the second one through, refuses the third
- [x] a session carried by a **devis** reserves nothing — a quote holds no slot
- [x] the unified list tags each item `kind: 'booking' | 'session'` and carries no client identity when
      requested for the SAS
- [x] `listForResource` (the planning list) merges both, ordered, scoped to the week, and **does** name
      the client (rule 29)
- [x] malformed session JSON is ignored, never thrown

**`tests/sas-resource-scheduling.unit.test.js`** (rules 17-19, 23-27)
- [x] page `applicable: false` with no hourly resource, or with everything already placed
- [x] `hoursRemaining` = quantity − placed, per resource
- [x] commit writes the blocks into `reservation_resources.sessions`
- [x] commit folds the evening supplement into the arrival complement (one `sasArrivalOrigin` line)
- [x] a stale/taken block → `409 SLOT_CONFLICT` with its `reason`, **and nothing is written**
- [x] a block over the remaining budget → `409` `reason: 'budget'`
- [x] re-commit **replaces** the blocks and recomputes the supplement (no accumulation, rule 26)
- [x] skipping the step (no `resourceBlocks`) writes nothing and leaves the hours unplaced
- [x] the occupancy returned to the SAS carries no client name (rule 19)

### Server — extended existing tests

- [x] `tests/devis-extras-parity.unit.test.js` — `recomputeDevisQuote` keeps `sessions`
      (**regression guard, defect 3**)
- [x] `tests/properties-model.unit.test.js` — `getByIdWithDetails` returns applicable resources with
      resolved price + freeMinutes (**regression guard, defect 2**)
- [x] `tests/resources-model.unit.test.js` — `heatUpMinutes` / `heatRetentionMinutes` round-trip through
      create/update, default 0, negatives clamped
- [x] Migration verified on a copy of the production DB; full server suite green.

### Client tests (vitest)

- [x] `components/sas/__tests__/SasResourceSchedulingPage.test.jsx` — placing a block decrements the
      counter; a `taken` / `heating` / `past` / `closed` slot is not tappable and shows its reason; the
      🔥 warm badge and the « +40 € » supplement badge render; the occupancy strip shows times but no
      name; delete frees the hour; « Planifier plus tard » advances with nothing placed; a failed slot
      load shows the error, **not** an empty grid.
- [x] `components/SlotPickerGrid` — renders each state from the server payload without deriving any of
      them locally, including the « enchaîne » badge of a reset-end slot (rule 20.bis).
- [x] **Long stay (rule 18.bis)** — all 14 days of a fortnight render, picking one far down the strip
      selects it and scrolls it back into view. _The fade/chevron affordances depend on layout, which
      jsdom does not compute; they are verified in the browser instead._ _Covered through `SasResourceSchedulingPage.test.jsx` rather than a dedicated file:
      the grid has no state of its own, so testing it in isolation would only re-assert its props._
      A non-free slot renders as a **disabled MUI Chip — a `div`**, so the guard asserts it is inert
      (class + a click that places nothing), not `toBeDisabled()`.
- [x] `ExtrasSection` — the « Heures » field is back for an hourly-scheduled resource and the session
      editor still renders.
- [x] `PricingSummary` — « à planifier » chip on an unscheduled resource line.
- [x] `ResourcesPage` / `resourceToPayload` — the two new fields round-trip.
- [x] Full client suite green.

### E2E (Playwright)

- [x] `e2e/specs/reservations/hourly-resource-sold-by-hour.spec.js` — new devis → the **Ressources**
      block is present with no dates set (**defect 2**) → set the dates → enable the hourly resource →
      the summary shows the line, marks it « à planifier », the total rises by its price
      (**defect 1**), and the « Heures » field is editable. New `createHourlyResource` fixture in
      `e2e/fixtures/apiSeed.js`. Full suite: **62 passed, 1 skipped**.

### Manual UI verification

Done in the browser on 2026-08-17, against the dev server. The Bain nordique was temporarily set to
240 / 480 and a neighbouring booking added to exercise the thermal paths; **the dev DB was restored
afterwards** (reservation dates, sold hours, sessions, thermal columns, and the seeded booking).

- [x] New devis, Lodge, direct → the **Ressources** block renders with no dates set → enable the Bain
      nordique → the summary shows the line marked « à planifier » and the total goes
      **375,54 € → 405,54 €**. Checked at 1440 px.
- [x] Thermal, arrival 16:00, warm-up 240 / retention 480: **cold** → 16:00–19:00 greyed « montée en
      chauffe », first bookable slot 20:00; **with a use ending 14:00** → 16:00 free and 🔥 warm.
      Verified on the live `/sas` payload and in the SAS UI.
- [x] SAS at **390 px**: day chips, occupancy strip, 2-column slot grid, placed-block list with its
      delete action, evening supplement total, « Suivant » / « Planifier plus tard ». Placing a block
      decrements the counter, removing it gives the hour back. **Horizontal overflow measured at 0 px.**
- [x] **17-day stay at 390 px** (rule 18.bis): 17 chips for 332 px of strip — 1 538 px off-screen.
      Fade + chevron appear on the side that still has days, swap when scrolled to the end, and the
      last day (« dim. 27 sept. ») is reachable.
- [x] **Reset-end slot** (rule 20.bis): an external booking 16:00→17:00 with a 15-min reset makes
      **17:15** appear between 17:00 and 18:00, badged « enchaîne » and 🔥.
- [x] The occupancy strip shows the neighbour (13:00–14:00) and **not** the operator's own placement.
- [x] Departure day fully « fermé » (check-out 10:00 precedes the 11:00 opening).
- [x] Resource planning after the merge moved server-side: the guest session renders with
      « Réservation · 20:00→21:00 · Delphine Barge · Aventura lodge · remise en état 15 min », no
      console error, and the second fetch is gone.

Covered by automated tests but **not exercised by hand** — worth a pass on the first real check-in:

- [ ] Full round trip through the UI: devis → convert → arrival SAS → commit → sessions visible on the
      fiche and on the resource planning. _(commit + persistence unit-tested; the recap → commit click
      path was not walked in the browser.)_
- [ ] Refusing a standalone booking created over a guest session, from the resource planning UI.
      _(unit-tested in `resource-occupancy-conflicts.unit.test.js`.)_
- [ ] Gîte free first hour → 0 € line, still placeable. _(unit-tested; not seen on screen.)_
- [ ] Skip path in the browser: « Planifier plus tard » → recap « N h non planifiées ».

## 8. Out of scope

- Letting the **guest** self-schedule from the public site or a link (operator-driven, in the SAS, with
  the guest present).
- Rescheduling from the departure SAS.
- Notifying the guest by email/push when a slot is placed.
- Charging a no-show for an unused placed slot.
- Migrating `ResourceBookingDialog` to `SlotPickerGrid` (identified as the second consumer; do it when
  that dialog is next touched).
- Per-property opening hours or per-property thermal settings for a resource (both stay resource-level).
- Modelling a *scheduled* pre-heat task (« start heating at 16:00 ») or notifying the operator to do it.
- Weather/outside-temperature influence on the heat-up time.

## 9. Open questions

Resolved during scoping (2026-08-17):
- **Evening band vs sold price** → the quoted price is never re-played; a placed evening block adds
  `(eveningRate − dayRate) × eveningMinutes / 60` to the **arrival complement**, badged in the picker
  before the guest commits (rule 22).
- **How the purchased hours may be split** → **free placement in blocks**, each ≥ `minimumUsageMinutes`
  and slot-aligned, across any days of the stay (rule 20).
- **Can the SAS be completed with hours unplaced** → **yes**, with a recap reminder and the remaining
  hours kept visible on the fiche and the planning (rule 23).
- **Scope** → all four defects plus the SAS scheduling step.
- **Taken slots: hidden or greyed** → **greyed and labelled with the reason**, and the day's existing
  bookings shown as an occupancy strip, so the operator can deliberately place next to one (rules 19,
  21).
- **Heat-up vs turnover** → two distinct settings; the turnover applies when the resource is still hot,
  the heat-up when it is cold, with an 8 h-style retention window deciding which (rules 11-12).

Still open:
- **Q: should an unplaced-hours reminder surface anywhere outside the recap** (dashboard badge, J-1
  email)? — A: not in this spec; revisit if hours actually get forgotten in practice.
- **Q: should the retention window be measured from the end of the previous use, or from the end of its
  turnover?** — A: from the **end of the use** (rule 12). Simpler to explain to an operator, and the
  turnover is short relative to an 8 h window; revisit only if it produces a wrong slot in practice.
