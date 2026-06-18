# Resource hourly scheduling + time-banded pricing (bain nordique)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/resource-hourly-scheduling` |
| **Created** | 2026-06-17 |
| **Author** | Adrien |
| **Related** | `specs/option-planning-card.md` (the option mechanism this mirrors), resources system |

---

## 1. Context

Options can be scheduled per-day from the reservation fiche and shown as Planning cards
(`specs/option-planning-card.md`). **Resources** (e.g. « Bain nordique ») cannot: a resource on a
reservation is just a quantity (hours), with a flat per-hour price and an optional per-property free
first hour (`property_resource_prices.freeMinutes`, rendered « 1ère heure offerte pour {logement} »).

Adrien wants, for the bain nordique:
1. **Schedule the sessions directly from the fiche** (start/end times), like options define their hours.
2. **Time-banded pricing**: 30 €/h between 12 h–20 h, +20 €/h between 20 h–22 h (i.e. 50 €/h in the
   evening). The operator enters a **start and end time**; the price is derived from the grid.
3. **30-min booking granularity, but the first hour is always whole** (min 1 h, then 30-min steps).
4. **First hour offered for the gîte** — reuse the existing per-property `freeMinutes` (= 60).

## 2. Goal

A resource can be flagged as **hourly-scheduled**. On such a resource, the fiche lets the operator add
**several free sessions** (date + start + end) within the stay; the server prices each session from a
**configurable time-banded grid** (day rate + evening rate after a switch time), applies the per-property
free first hour **once**, and the sessions appear as **Planning cards** (one per session), exactly like
option cards. The same grid (with a separate, configurable **external** rate pair) prices the existing
**standalone bookings** for people **without a logement reservation** (« extérieurs »). Every value —
guest + external rates, evening switch, opening hours, slot, min duration — is editable on the resource.

## 3. Functional rules

### 3.1 Resource configuration (catalog)
1. A resource gains an **« Horaires & tarif horaire »** mode (`showsPlanningCard = 1`, only meaningful
   with `priceType = 'per_hour'` / `isComplex`). It reuses the existing `openTime`/`closeTime` (booking
   window, e.g. 12:00–22:00), `slotDuration` (30 min), and `minimumUsageMinutes` (60 = the mandatory
   first whole hour).
2. **Time-banded grid — every value editable on the resource (Réglages).** Two bands, all parameters
   configurable in the resource editor:
   - **Tarif horaire jour (invité)** = the existing `resources.price` (e.g. `30`).
   - **Heure de bascule soir** = `hourlyEveningStart` (HH:MM, e.g. `20:00`) — **shared** by the guest and
     external grids.
   - **Tarif horaire soir (invité)** = `hourlyEveningRate` (absolute €/h, e.g. `50`).
   Before `hourlyEveningStart`: day rate; from `hourlyEveningStart` to `closeTime`: evening rate. An empty
   `hourlyEveningStart` (or `hourlyEveningRate ≤ 0`) = the day rate applies all day (flat). Nothing is
   hard-coded — the bain nordique values are just the operator's configuration.
3. **External tariff (no logement reservation).** Two more fields — `hourlyExternalDayRate` and
   `hourlyExternalEveningRate` (absolute €/h) — give a **separate price grid for « extérieurs »**: people
   who book the resource **without** an accommodation reservation. The **same `hourlyEveningStart`**
   switch applies. When an external rate is empty/`0`, it **falls back** to the matching guest rate (so a
   resource with no external grid behaves as today). This grid is used by the standalone booking flow
   (§3.5).
4. **Opening hours — already exist, reused.** The resource's `openTime`/`closeTime` (booking window, e.g.
   12:00–22:00) and `openDays` (days of week) are already editable in the complex-resource block and are
   already enforced by the standalone planning. They are the single source of the booking window; no new
   field is needed.
5. **First hour offered** — unchanged mechanism: `property_resource_prices.freeMinutes` (per logement).
   `60` ⇒ the first 60 min of the booking are free.

### 3.2 Sessions on the fiche (guest, with logement reservation)
6. When an hourly-scheduled resource is enabled on a reservation, the fiche shows a **session list**
   (instead of a plain quantity field): each row = **date** (a day within the stay), **heure de début**,
   **heure de fin**, plus **« + Ajouter une séance »** / remove. Several sessions are allowed.
7. **Validation per session** (UX hint client-side, authoritative server-side):
   - `openTime ≤ début < fin ≤ closeTime`.
   - `fin − début ≥ minimumUsageMinutes` (≥ 1 h).
   - both times aligned to `slotDuration` (30 min).
   - A session failing validation is dropped server-side (not billed) and flagged in the fiche.
8. **Billed quantity** is the sum of the sessions' durations in hours, minus the free first hour; it
   updates live as the operator edits sessions (re-priced on every change, like options).

### 3.3 Pricing (server-authoritative — money lives on the server)
9. **Per-session price** = sum over each 30-min slice `[t, t+30)` of: `dayRate/2` if `t <
   hourlyEveningStart`, else `eveningRate/2`, using the **guest** grid (e.g. day 30 / evening 50,
   19:00–21:00 = 2×15 + 2×25 = 80 €).
10. **Free first hour** applies **once per reservation-resource**, to the **earliest** session
    (by date then start time): the first `freeMinutes` of that session are deducted at their own slice
    rates (e.g. earliest session starting 19:00, freeMinutes 60 ⇒ 19:00–20:00 = 30 € deducted).
11. **Total** = `Σ session prices − free value`, rounded to 2 decimals, never < 0.
12. The stored `reservation_resources` line stays consistent with the existing model:
    `billedUnits` = billed hours (total minutes − free minutes, in hours), `unitPrice` = effective
    average (`round2(total / billedUnits)`, `0` when no billed time), `totalPrice` = the grid total.
    `offered = 1` zeroes the line (whole booking offered) as today; `inComplement` unchanged.

### 3.4 Planning cards
13. Each guest session produces **one Planning card** on its `date`, mirroring option cards
    (`OptionDayCard`): the card shows the resource name, the **time range** (`20:00–21:30`), the property,
    the client, and a **« fait » toggle** persisted on the session (orthogonal to billing, like options).

### 3.5 Standalone bookings (externals — no logement reservation)
14. The existing standalone booking flow (`resource_bookings` via `ResourceBookingDialog` /
    `ResourcePlanningPage`) is **re-priced through the same time-banded grid** for hourly-scheduled
    resources, instead of the current flat `unitPrice × hours`.
15. **Rate selection:** a standalone booking with **no `reservationId`** (a `clientName`/`clientId`
    external) is priced with the **external** grid (`hourlyExternalDayRate` / `hourlyExternalEveningRate`,
    falling back to the guest rate when empty); a booking **tied to a reservation** keeps the **guest**
    grid. The per-property `freeMinutes` deduction (first hour) and the window/granularity rules are
    unchanged. A non-hourly-scheduled resource keeps its current flat pricing (regression-safe).

## 4. Architecture

> **Fat backend, thin frontend.** The grid, the free-hour deduction, the validation, and the billed
> total are computed and persisted on the server. The fiche only renders the session editor and the live
> preview; the Planning only renders the cards from the server payload.

### 4.1 Server (`server/src/`)
| Layer | File | Responsibility |
|---|---|---|
| `database.js` | `database.js` | Idempotent migrations: `resources.showsPlanningCard INTEGER DEFAULT 0`, `resources.hourlyEveningStart TEXT`, `resources.hourlyEveningRate REAL DEFAULT 0`, `resources.hourlyExternalDayRate REAL DEFAULT 0`, `resources.hourlyExternalEveningRate REAL DEFAULT 0`; `reservation_resources.sessions TEXT` (JSON `[{date,start,end,done}]`). |
| `schema.sql` | `schema.sql` | Same columns in the baseline. |
| `utils/` | `resourceHourlyPricing.js` (new) | Pure functions: `priceRange(start, end, {dayRate, eveningRate, eveningStart, slotMinutes})`, `priceSessions(sessions, cfg, freeMinutes)` → `{ totalPrice, billedHours, unitPrice }`. Rate pair passed in, so the same code prices guest **and** external bookings. Unit-tested. |
| `utils/` | `pricing.js` | Resource line computation branches to `resourceHourlyPricing` (guest grid) when the resource is hourly-scheduled + has sessions; else unchanged. |
| `models/` | `resourcesModel.js` | Persist/read the 5 new resource columns; `findById`/`list` expose them. |
| `models/` | `reservationsModel.js` (resource save) | Persist `reservation_resources.sessions` (validate + drop invalid); read it back on the fiche payload. |
| `models/` | `resourceBookingsModel.js` | `computeBookingTotalPrice` uses `resourceHourlyPricing` for hourly-scheduled resources, picking the **external** grid when the booking has no `reservationId`, else the guest grid (§3.5). Non-hourly resources unchanged. |
| `models/` | `planningResourceCardsModel.js` (new) | `cardsInRange({from,to})` from `reservation_resources.sessions` + `setSessionDone(...)` — mirror of `planningOptionCardsModel.js`. |
| `controllers/`+`routes/` | `planning.js` | `GET /api/planning/resource-cards`, `POST /api/planning/resource-cards/done`. |
| `controllers/` | `resourcesController.js` | Accept + validate the 5 new fields. |

### 4.2 Client (`client/src/`)
| Layer | File | Responsibility |
|---|---|---|
| `utils/` | `resourceSessions.js` (new) | Session list helpers: add/remove/edit, slot-aligned time options, client-side validation + live total preview (calls a shared pure pricer mirroring the server, for preview only — server stays authoritative). |
| `components/reservation/` | `ExtrasSection.js` | For an hourly-scheduled resource: render the session editor (date + début + fin + add/remove) + the billed-quantity caption, replacing the plain qty field. |
| `pages/` | `ReservationPage.js` | Hold `selectedResources[].sessions`; send them on save; re-price on change. |
| `pages/` | `ResourcesPage.js` | Add the « Horaires & tarif horaire » fields to the complex-resource editor: guest day/evening rate, evening switch time, **external** day/evening rate. |
| `components/` | `ResourceBookingDialog.js` | Live price preview uses the banded external (or guest) pricer for hourly-scheduled resources, matching the server. |
| `components/` | `OptionDayCard.js` | Reuse for resource cards (`theme='resource'`); accept a time **range** label. |
| `pages/` | `PlanningPage.js` | Fetch + render resource cards alongside option cards. |
| `api.js` | `api.js` | `getPlanningResourceCards`, `setResourceCardDone`. |

### 4.3 API contract
| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/planning/resource-cards?from&to` | `{ 'YYYY-MM-DD': { items: [{ reservationId, resourceId, name, clientName, propertyName, date, start, end, done }] } }`. |
| POST | `/api/planning/resource-cards/done` | `{ reservationId, resourceId, date, start, done }` → toggles one session's done flag. |
| PUT | `/api/resources/:id` | gains `showsPlanningCard`, `hourlyEveningStart`, `hourlyEveningRate`. |
| (reservation save) | existing reservation endpoint | `selectedResources[]` gains `sessions: [{date,start,end}]`. |

## 5. Data model
**`resources`** (new, idempotent): `showsPlanningCard INTEGER DEFAULT 0`, `hourlyEveningStart TEXT`,
`hourlyEveningRate REAL DEFAULT 0`, `hourlyExternalDayRate REAL DEFAULT 0`,
`hourlyExternalEveningRate REAL DEFAULT 0`. Reuses `price` (guest day rate), `openTime`/`closeTime`,
`openDays`, `slotDuration`, `minimumUsageMinutes` — all editable in the resource editor. External rates
`≤ 0` fall back to the guest rates.

**`reservation_resources`** (new): `sessions TEXT` — JSON `[{ date:'YYYY-MM-DD', start:'HH:MM',
end:'HH:MM', done:bool }]`. Existing `billedUnits`/`unitPrice`/`totalPrice` reused (see §3.3 rule 12).

**`property_resource_prices.freeMinutes`** — unchanged (the free first hour).

**Data impact:** additive only. Existing resources default to `showsPlanningCard = 0` (behaviour
unchanged). Existing `reservation_resources` rows have `sessions = NULL` (priced as today).

## 6. UI / UX
- **Fiche** (`ExtrasSection`): an hourly-scheduled resource, when enabled, shows the session editor:
  one row per session (date select limited to stay days, début/fin time pickers stepped at 30 min),
  « + Ajouter une séance », a per-row remove, the live billed total + a hint « 1ère heure offerte ».
  Invalid rows show an inline error and don't count. Responsive: rows stack on `xs` (date full-width,
  then début/fin side by side), ≥ 44 px touch targets.
- **Catalog** (`ResourcesPage`): in the complex-resource block, **everything is editable** — « Tarif
  horaire jour invité (€) » (the existing price field), « Heure de bascule soir » (time), « Tarif horaire
  soir invité (€) », and an **« Extérieurs »** sub-block « Tarif horaire jour (€) » + « Tarif horaire soir
  (€) », plus the already-present opening hours (open/close + jours), pas (slotDuration) and durée min
  (minimumUsageMinutes). No value is hard-coded.
- **Standalone booking** (`ResourceBookingDialog`): for an hourly-scheduled resource, the live total
  preview reflects the banded grid (external rates when no reservation is linked). No new field — the
  existing date + start/end + external-name fields drive it.
- **Planning**: a resource card per session (reuse `OptionDayCard`, distinct accent), with the time
  range + a « fait » toggle. Mobile = same card layout as option cards.

## 7. Test plan
### Server unit tests (required — money logic)
- [ ] `resource-hourly-pricing.unit.test.js` — `priceSession`: day-only, evening-only, crossing 20 h,
  30-min slices; min-1 h enforcement; `priceSessions`: multi-session sum; free first hour applied once to
  the earliest session; rounding; offered ⇒ 0; window/granularity validation drops bad sessions.
- [ ] `pricing.js` resource branch — an hourly-scheduled resource with sessions produces the grid total,
  effective `unitPrice`, billed hours; a non-scheduled resource is unchanged (regression).
- [ ] `resourceBookingsModel` — a standalone booking with no `reservationId` is priced with the external
  grid; tied to a reservation → guest grid; external rate empty → falls back to guest; non-hourly resource
  keeps flat pricing (regression).
- [ ] `planningResourceCardsModel` — `cardsInRange` window filtering; `setSessionDone` toggles one.
### Client unit tests
- [ ] `resourceSessions` helpers — add/remove/edit, slot alignment, validation, preview total matches the
  server pricer for a representative case.
- [ ] `ExtrasSection` — enabling an hourly resource renders the session editor; editing re-prices.
### Manual UI (dev)
- [ ] Configure bain nordique (jour 30 €/h, soir 20:00 → 50 €/h, extérieurs jour 40 / soir 60,
  12:00–22:00, 30 min, min 60, gîte freeMinutes 60). On a gîte reservation: add a 19:00–21:00 session →
  total = 80 − 30 (free first hour) = 50 €; add a second session; check the Planning cards + « fait »
  toggle.
- [ ] Standalone booking (`ResourcePlanningPage`) for an **external** (clientName, no reservation),
  19:00–21:00 → external grid 2×20 + 2×30 = 100 € (minus freeMinutes if the property grid sets it);
  a booking tied to a reservation uses the guest grid. Mobile check of the fiche editor + the booking dialog.

## 8. Out of scope
- Availability/clash detection between guest fiche sessions and standalone bookings (the standalone
  flow already does its own slot-conflict check; cross-checking fiche sessions against it is a later
  iteration).
- New standalone-booking UI — only its **pricing** changes (banded + external grid); the dialog/planning
  layout is otherwise untouched.
- Per-session free hours (the free allowance is once per reservation-resource, §3.3 rule 10).
- More than one banded tier (only one evening switch + surcharge; no multi-step grid).

## 9. Open questions
- **Free-hour application with several sessions** — **Resolved 2026-06-17:** applied **once per
  reservation-resource, on the earliest session's first hour** (§3.3 rule 10).
- **Session crossing the evening switch** — Resolved: each 30-min slice is billed at its own band
  (§3.3 rule 9).
