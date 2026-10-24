# Resource booking and evening supplement totals computed by the server

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `docs/resource-supplements-total-server` |
| **Created** | 2026-10-24 |
| **Author** | Adrien |
| **Related PR** | #766 → `inte/plugins` |

---

## 1. Context

The `hourly-resources` plugin shows money in two places, and both figures are computed **in React**:

- the **booking dialog** of Calendrier › Ressources (`ResourceBookingDialog.jsx`), which shows the
  price of the range the operator is drawing (« 18:00 → 20:00 · 2h · 70.00 € ») and the offered
  minutes under it;
- the **« Planifier » step of the arrival SAS** (`SasResourceSchedulingPage.jsx`), which adds up the
  evening supplement of the placed blocks (« Supplément soirée : 20 € »).

[sas-arrival-total-server-side.md](sas-arrival-total-server-side.md) moved the arrival recap's money
to the server and named the second one as left for a follow-up (§8). This spec is that follow-up, with
the booking dialog added.

The owner's rule ([CLAUDE.md](../CLAUDE.md) §6.0, restated 2026-10-23): **the front only displays
money, it never computes it**, so that a figure is the same wherever it is read.

### 1.1 Inventory of the client money arithmetic

| # | File:line | What it computes |
|---|---|---|
| C1 | `client/src/plugins/hourly-resources/ResourceBookingDialog.jsx:135-142` | `currentPropertyPricing`: picks the logement's price override from `resource.propertyPricing` |
| C2 | `ResourceBookingDialog.jsx:143-144` | `effectiveUnitPrice` and `freeMinutes` (the logement's offered minutes, falling back to `resource.freeMinutes`) |
| C3 | `ResourceBookingDialog.jsx:149-163` | `isBandedHourly` branch: picks the **external** rate pair (`hourlyExternalDayRate`, `hourlyExternalEveningRate`, falling back to the guest grid) and calls `previewRangeTotal` |
| C4 | `ResourceBookingDialog.jsx:164-165` | other hourly resources (`isComplex` **or** `per_hour`): `effectiveUnitPrice × (duration − freeMinutes) / 60`, unrounded |
| C5 | `ResourceBookingDialog.jsx:151-152`, `:166-167` | `free` → 0; everything else → the flat `effectiveUnitPrice` |
| C6 | `ResourceBookingDialog.jsx:315` | renders `totalPrice.toFixed(2)`, hidden when 0 |
| C7 | `ResourceBookingDialog.jsx:317-320` | « N min offertes (M min facturees) »: `min(duration, freeMinutes)` and `max(0, duration − freeMinutes)` |
| C8 | `client/src/plugins/hourly-resources/resourceSessions.js:47-79` | `normalizeConfig`, `priceMinutes`, `previewRangeTotal`: a copy of `server/src/plugins/hourly-resources/hourlyPricing.js:25-118` |
| C9 | `resourceSessions.js:81-94` | `previewSessionsTotal`: a second copy of `priceSessions`. **No caller** outside its test |
| C10 | `client/src/plugins/hourly-resources/SasResourceSchedulingPage.jsx:289` | `totalSupplement = Σ block.supplement` over every placed block, all resources together |
| C11 | `SasResourceSchedulingPage.jsx:305` | renders `Math.round(totalSupplement × 100) / 100` |

Not money, kept out of this inventory: the time arithmetic of the grids (`MiniDayPlanner`,
`ResourcePlanningPage` pixel maths), the availability greying of the dialog's time options
(`isSlotAvailable`, `:31-40`), and the hours still to place (`SasResourceSchedulingPage.jsx:158-161`,
`sasStep.js:24-31`) — see §9 Q3 for the last one.

### 1.2 What the code reading found

The server prices a standalone booking in `bookingsModel.computeBookingTotalPrice`
(`server/src/plugins/hourly-resources/bookingsModel.js:52-85`) and stores the result in
`resource_bookings.totalPrice`. The dialog's copy agrees with it on the common case
(17:00–19:00 → 60,00 € on both sides) and **disagrees** on four:

1. **Off-grid ranges.** The dialog steps by 5 minutes (`BOOKING_STEP_MINUTES`, `:42`); the banded grid
   only accepts ranges on the resource's slot (`hourlyPricing.isValidSession`, `:66`). For 18:05–19:35
   on a 30-minute resource the server falls back to the flat **guest** day rate (`bookingsModel.js:77`,
   `:80-82`): 25 €/h × 1,5 h = **37,50 €** stored. The dialog walks the external bands from 18:05 and
   shows **50,00 €**.
2. **`isComplex` resources not sold by the hour.** The dialog prices them by the duration (C4,
   `isHourlyResource = isComplex || per_hour`); the server bills them the flat price
   (`bookingsModel.js:84`). A 15 € resource booked 2 h shows 30,00 €, stores 15,00 €.
3. **A booking tied to a reservation.** On edit, the server keeps the booking's `reservationId` and
   uses the guest grid (`:253-254`); the dialog always assumes an external.
4. **The offered minutes' fallback.** The dialog falls back to `resource.freeMinutes` when the logement
   has none (C2); the server reads `property_resource_prices` only (`:56-59`). Harmless today
   (`getResources()` without a logement resolves `freeMinutes` to 0), but it is a second rule.

On the SAS step, the server already answers the right figure and the page **discards** it:

5. **The evening credit is ignored.** `schedulingModel.supplementOf` (`schedulingModel.js:122-124`)
   bills `max(0, evening difference − eveningCredit)`, where `eveningCredit` is what the sold line
   already bills for the evening (`:76-82`, rule 30 of
   [hourly-resource-quantity-and-sas-scheduling.md](hourly-resource-quantity-and-sas-scheduling.md)).
   The page sums the per-slot badges, which carry no credit. A line sold 60,00 € for 2 h at a 25 €/h day
   rate (credit 10,00 €), placed 19:00–20:00 and 20:00–21:00 at 35 €/h: the page says
   « Supplément soirée : 20 € », the recap and the commit bill **10,00 €**.
6. **The answer is already there.** `GET /api/resources/:id/free-slots` returns
   `{ days, supplement }` with `supplement = supplementOf(entry, pending)` (`schedulingModel.js:202`),
   and the step payload carries `supplement` per resource (`:186`). The page keeps `days` only
   (`SasResourceSchedulingPage.jsx:172`).

## 2. Goal

Every euro the resource booking dialog and the SAS « Planifier » step show is the figure the server
will store or bill, answered live while the operator draws a range or places a block.

---

## 3. Functional rules

### 3.1 One pricer for the standalone booking

1. **A single server function prices a booking draft.** `bookingsModel.priceBooking(draft)` takes
   `{ resourceId, bookingId, date, startTime, endTime, propertyId }` and returns the breakdown of §4.3
   (`total`, `pricing`, `rateGrid`, `bands`, `freeMinutesApplied`, `billedMinutes`). It reads the
   resource, the logement's override and — for `bookingId` — the stored `reservationId`; it **never
   writes**. It is today's `computeBookingTotalPrice` returning its intermediate figures instead of only
   the total: same branches, same rates, same rounding.
2. **The commit uses it.** `createBooking` and `update` call `priceBooking` and store `total` in
   `resource_bookings.totalPrice`. `computeBookingTotalPrice` is removed (its callers are these two).
3. **The billing does not change.** The four disagreements of §1.2 are settled by the **server's**
   behaviour: what the dialog shows becomes what is stored today. Whether the off-grid fallback is the
   right billing is §9 Q2, not this spec.

### 3.2 The preview

4. **`POST /api/resource-bookings/preview`** takes the draft of rule 1 and answers `priceBooking`'s
   breakdown. It writes nothing. A `bookingId` that does not exist answers 404, an unknown
   `resourceId` 404, a missing time 400 — the same messages as the commit.
5. **The preview refuses what the commit refuses.** A range under the minimum duration answers 400
   `{ error: 'Durée minimale 60 min requise' }`, a range over capacity 409
   `{ error: 'Créneau non disponible (capacité atteinte)' }`, from the same checks as `createBooking`
   (`bookingsModel.js:213-221`), the booking itself excluded on edit.
6. **The commit never trusts the preview.** No amount from a preview is sent back. The commit body
   carries `displayedTotal` (the `total` the dialog showed) for comparison only (rule 15).
7. **Admin only.** The preview carries money: it gets the same guard as `POST /api/resource-bookings`
   and joins no reception allowlist (AUTH-4 — reception never receives a booking price).

### 3.3 The booking dialog

8. **The dialog renders the preview, nothing else.** The summary line's amount, the offered/billed
   minutes and the band detail are fields of the latest preview response. The dialog keeps no rate, no
   `freeMinutes`, no multiplication. C1-C8 are deleted; `previewRangeTotal` and `previewSessionsTotal`
   leave `resourceSessions.js` (C9 has no caller).
9. **The draft is the price-relevant state only.** `resourceBookingDraft(state)` (pure) builds rule 1's
   object from the dialog state. The client name, phone, notes and « Payé » are not in it, so typing a
   name sends no request.
10. **When a preview is requested.** As soon as date, start and end are all set: immediately. On every
    later change of the draft: after **200 ms** without a further change. Changing the logement is a
    change like the others (it moves the offered hour).
11. **Latest wins.** Each request carries a sequence number; a response that is not the latest is
    discarded and the previous in-flight request is aborted (`AbortController`) — the pattern of
    `useArrivalRecapPreview` in the `sas` plugin.
12. **The range answers at once, the money follows.** The times, the duration and the planner highlight
    follow the operator's gesture on the spot (local state). The amount keeps its last server value,
    dimmed, with a thin bar under the summary, until the answer lands. No client estimate in between.
13. **« Enregistrer » waits for a fresh preview** of the current draft. It reads « Calcul du prix… »
    while one is pending.
14. **A failed preview is said, not hidden.** Network error or 5xx: the amount reads « Prix
    indisponible » with « Réessayer », « Enregistrer » is disabled. A 400/409 refusal (rule 5): the
    summary shows the server's message in the error colour, as the client-side checks do today.
15. **The displayed total is compared at commit, never enforced.** The commit always stores its own
    price. When it differs from `displayedTotal` by a cent or more, the response carries
    `warning: { code: 'BOOKING_TOTAL_DIFFERED', displayed, stored }`; the dialog stays open on
    « Enregistré à 40,00 € — l'aperçu affichait 70,00 €. » with a single « Fermer ». No history row:
    `resource_bookings` has no audit trail (§9 Q4).
16. **A zero is shown.** A free resource, or a range entirely offered, reads « 0,00 € » (C6 hid it).

### 3.4 The SAS « Planifier » step

17. **Each resource card shows its own supplement, from the server.** The card renders the
    `supplement` of the step payload (`schedulingModel.js:186`) until the first refresh, then the
    `supplement` of each `free-slots` answer — `supplementOf(entry, pending)`, evening credit included.
    Line: « Supplément soirée : 10,00 € », hidden at 0. C10 and C11 are deleted.
18. **No cross-resource total on the step.** The arrival recap already shows every resource's
    supplement as its own plugin line with the stay's total (SAS spec rule 10). Adding the cards in
    React would be the sum this spec removes.
19. **The per-slot badges stay.** « +10 € » on a slot and on a placed block are already server figures
    (`availability.js:239`, `schedulingModel.js:184`): what that one block costs in the evening, before
    credit. They are read as such; nothing adds them.
19bis. **The hours left to place come from the server too** (Q3). `free-slots` answers
    `hoursRemaining` = hours sold minus every block of `pending`; the card renders it (payload's
    `hoursRemaining` until the first refresh) and offers the grid only while it is above 0. The
    client-side subtraction is deleted. The wizard's recap notes (`sasStep.js` `recapNotes`, « N h non
    planifiées ») still subtract locally: they live outside the card and a refresh result is not
    carried up — a follow-up, hours not money.
20. **While a refresh runs, the card's supplement is dimmed**, like the dialog's amount (rule 12); a
    failed refresh hides it with the existing « Créneaux indisponibles » alert.

### 3.5 SDK and plugin version

21. **SDK 2.1.0.** `api.previewResourceBooking(draft, { signal })` joins `client/src/api.js`, which the
    client SDK re-exports whole (`client/src/plugins/sdk/index.js:4`): adding an entry point is a MINOR
    bump (`server/src/plugins/sdk/version.js` header). `SDK_VERSION` goes from `2.0.0` to `2.1.0`;
    the call is `readOnly` (no « data changed » broadcast).
22. **`hourly-resources` 1.2.0** declares `"sdk": "^2.1.0"` (it calls the new entry point) with French
    changelog lines (« Le prix d'une réservation de ressource vient du serveur. », « Le supplément de
    soirée de l'étape « Planifier » déduit ce que la prestation vendue facture déjà. »). The thirteen
    other plugins keep `^2.0.0`, which 2.1.0 satisfies: no bump for them.

**Edge cases:**
- Range not yet complete (start without end) → no request; the summary shows « Sélectionnez un
  créneau dans le planning » as today.
- End before start → no request; the existing « L'heure de fin doit être après l'heure de début. »
- The dialog is closed while a preview is in flight → the answer is ignored (sequence reset on close).
- Resource reconfigured between the preview and « Enregistrer » (rate 30 → 35 €/h) → the commit stores
  the new price and warns (rule 15).
- Edit of a booking whose logement override was deleted since → the preview shows today's price; the
  stored `totalPrice` changes only on « Enregistrer ».
- Offline on the phone at the spa → rule 14; the commit would fail the same way, nothing is lost.
- SAS: a re-opened step with blocks already placed → the card shows the payload's `supplement`, the
  credited figure, from the first frame.

---

## 4. Architecture

> **Fat backend, thin frontend.** This spec removes the last money arithmetic of the
> `hourly-resources` client. What stays client-side is UI state (the draft) and plumbing (debounce,
> sequence guard).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/hourly-resources/` | `bookingsModel.js` | T | `priceBooking(draft)` replaces `computeBookingTotalPrice` and returns the breakdown; `checkBookable(draft)` extracts the min-duration and capacity checks shared by preview and commit; `createBooking` / `update` use both and compare `displayedTotal` (rule 15). |
| `plugins/hourly-resources/` | `hourlyPricing.js` | T | `priceSessions` also returns `bands` (`[{ band, from, to, minutes, rate, amount }]`, slices merged per band) and `freeMinutesApplied`; the arithmetic is unchanged. |
| `plugins/hourly-resources/` | `controller.js` | T | New `preview` handler (maps `{ error, status }` like `create`); `create` / `update` answer `{ id?, totalPrice, warning }`. |
| `plugins/hourly-resources/` | `routes.js` | T | `router.post('/preview', …)` before the `/:id` routes. |
| `plugins/hourly-resources/` | `schedulingModel.js` | T | `getFreeSlots` also answers `hoursRemaining` (rule 19bis); `supplementOf` is unchanged — already the right figure. |
| `plugins/hourly-resources/` | `manifest.json` | T | `1.2.0`, `sdk ^2.1.0`, changelog (rule 22). |
| `plugins/sdk/` | `version.js` | T | `SDK_VERSION = '2.1.0'` (rule 21). |
| `plugins/sas/` | `manifest.json` | T | `1.2.1`: its client hook now runs on `useLatestPreview` (changed file ⇒ version bump, CI rule). |
| `tests/` | `sdk-v2-plugin-ranges`, `plugins-phase-4-registry` | T | The SDK is asserted « 2.x », the plugins' range `^2.N.0`. |
| `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/hourly-resources/` | `ResourceBookingDialog.jsx` | T | Delete C1-C7; build the draft; render the preview (amount, offered/billed minutes, bands); pending / error / refusal states; the commit warning panel (rule 15). |
| `hooks/` | `useLatestPreview.js` | C | Generic (Q5): debounced (200 ms; the first request leaves at once), latest-wins, abortable preview; `{ data, pending, error, fresh, retry }`. Exported by the SDK. |
| `plugins/sas/` | `useArrivalRecapPreview.js` | T | Now a thin wrapper of `useLatestPreview` (same contract). |
| `plugins/sdk/` | `index.js` | T | Exports `useLatestPreview`. |
| `plugins/hourly-resources/` | `useResourceBookingPreview.js` | C | `useLatestPreview` bound to `api.previewResourceBooking`; exposes `{ price, pending, error, refusal, fresh, retry }` (a 400/409 is a `refusal`, anything else an `error`). |
| `plugins/hourly-resources/` | `resourceBookingDraft.js` | C | Pure: dialog state → draft (rule 9). Shared by preview and commit. |
| `plugins/hourly-resources/` | `resourceSessions.js` | T | Remove `normalizeConfig`, `priceMinutes`, `previewRangeTotal`, `previewSessionsTotal`, `round2` (C8, C9). |
| `plugins/hourly-resources/` | `ResourcePlanningPage.jsx` | T | `handleSave` returns the commit response to the dialog, which closes itself unless `warning` is set. |
| `plugins/hourly-resources/` | `SasResourceSchedulingPage.jsx` | T | Delete C10-C11; each `ResourceCard` keeps the `supplement` of the payload / of each refresh and renders it (rule 17). |
| `api.js` | `api.js` | T | `previewResourceBooking(draft, { signal })`, `readOnly: true`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `ErrorAlert` (SDK), `SlotPickerGrid` (SDK), MUI `LinearProgress` | Unchanged visuals. |
| **Created (new generic)** | `useLatestPreview` (`client/src/hooks/`) | Two plugins debounce a server preview the same way (Q5, resolved). |
| **Specific (kept feature-local)** | `useResourceBookingPreview`, `resourceBookingDraft` | Only this dialog previews a standalone booking. |
| **Added to MUI usage** | `Alert`, `LinearProgress` | The commit notice and the pending bar. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/resource-bookings/preview` | `BookingDraft` | `BookingPrice` | admin; writes nothing; 400 / 404 / 409 as the commit (rules 4, 5) |
| POST | `/api/resource-bookings` | today's body + `displayedTotal` | `{ id, totalPrice, warning }` | always stores its own price (rule 15) |
| PUT | `/api/resource-bookings/:id` | today's body + `displayedTotal` | `{ ok, totalPrice, warning }` | same |

**`BookingDraft`:**

```jsonc
{ "resourceId": 4, "bookingId": null, "date": "2027-02-13",
  "startTime": "18:00", "endTime": "20:00", "propertyId": 2 }
```

**`BookingPrice`** (fictional resource: day 25 €/h, evening 35 €/h from 19:00, external 30 / 40 €/h,
30-minute slot, logement 2 offering 60 min):

```jsonc
{
  "total": 40.00,                 // what totalPrice will store
  "pricing": "banded",            // banded | flat-hourly | fixed | free
  "rateGrid": "external",         // external | guest — null unless banded
  "durationMinutes": 120,
  "freeMinutesApplied": 60,
  "billedMinutes": 60,
  "grossTotal": 70.00,
  "bands": [
    { "band": "day", "from": "18:00", "to": "19:00", "minutes": 60, "rate": 30.00, "amount": 30.00 },
    { "band": "evening", "from": "19:00", "to": "20:00", "minutes": 60, "rate": 40.00, "amount": 40.00 }
  ],
  "freeValue": 30.00              // the offered hour, at its own band's rate
}
```

`bands` is `[]` for `fixed` and `free`; for `flat-hourly` it is one `day` band at the guest rate.
Amounts are euros rounded to the cent by the server. The SAS step's contract gains one field:
`GET /api/resources/:id/free-slots` answers `{ days, supplement, hoursRemaining }` (the `supplement`
field already existed on both payloads, §1.2 finding 6).

---

## 5. Data model

No schema change, no migration. `resource_bookings.totalPrice` is written by the same arithmetic as
today. **Data impact:** none on existing rows; a booking is re-priced only when it is saved, as today.

## 6. UI / UX

The dialog and the step look the same; what changes is where their figures come from, and four states.

**Booking dialog — the summary line** (`ResourceBookingDialog.jsx:311-328`):
- **Answered:** « 18:00 → 20:00 · 2 h · 40,00 € », then muted « 1 h offerte · 1 h facturée » and the
  bands « jour 30,00 € · soir 40,00 € » (one line, wraps on `xs`). French number format from
  `formatCurrency` (SDK), not `toFixed`.
- **Pending:** the amount keeps its last value at 55 % opacity, a 2 px indeterminate bar labelled
  « Calcul du prix » runs under the line; « Enregistrer » reads « Calcul du prix… », disabled. The
  times and the duration already show the new range.
- **Unavailable:** « Prix indisponible » with « Réessayer » (text button, 44 px target);
  « Enregistrer » disabled.
- **Refused** (rule 5): the server's message in `error.main`, in place of the existing client hints
  for minimum duration and capacity when the server answered.
- **Total differed at commit:** the dialog stays open on a `warning` panel « Enregistré à 40,00 € —
  l'aperçu affichait 70,00 €. » and « Fermer », which closes and reloads the week.

**SAS « Planifier »:** each resource card ends with « Supplément soirée : 10,00 € » (`warning.dark`,
`tabular-nums`), from the server; the bottom-of-step total disappears.

Copy is short and impersonal: no « vous », nothing about the mechanics.

**Responsive** (Chromium at 375, 900 and 1280 px):
- `xs`: the dialog is full screen (`ds-components.md` rule 22, unchanged); the summary is the first
  block (a grid area above the planner) and sticks to the top of the dialog, so the amount stays in view
  while the operator taps start/end on the planner; on `sm`+ the same grid area sits at the top of the
  right column. The
  pending bar is attached to the summary, not the dialog footer; « Réessayer » and « Fermer » are
  44 px. The SAS card's supplement line stays inside its card — no scroll to the bottom of the step to
  read it.
- `md` / `lg`: unchanged two-column layout; the same states.
- No layout shift between pending and answered: amounts are `tabular-nums`, the summary reserves its
  two lines.

**Page action bar:** unchanged — the planning page's bar is not touched; the dialog has its own
actions.

## 7. Test plan

Fictional resource for every figure: « Bain fictif », open 10:00–22:00, slot 30 min, minimum 60 min,
guest day 25 €/h, guest evening 35 €/h from 19:00, external 30 / 40 €/h; logement « Cabane fictive »
(id 2) offers 60 min.

### Server unit tests

- [ ] `server/src/plugins/hourly-resources/tests/resource-booking-preview.unit.test.js` (rules 1-7, 15):
  - external 17:00–19:00 → `total` 60,00, `bands` one day band, `rateGrid` external;
  - external 18:00–20:00 → 70,00 (30 + 40);
  - same with logement 2 → 40,00, `freeMinutesApplied` 60, `billedMinutes` 60, `freeValue` 30,00;
  - off-grid 18:05–19:35 → `pricing` flat-hourly, 37,50 (25 × 1,5) — the figure stored today
    (§1.2 finding 1);
  - `isComplex` fixed 15 € resource booked 2 h → `pricing` fixed, 15,00 (finding 2);
  - edit of a booking tied to reservation 7, 19:00–21:00 → `rateGrid` guest, 70,00 (finding 3);
  - free resource → 0,00, `pricing` free;
  - 18:00–18:30 → 400 « Durée minimale 60 min requise »; a range on a full resource → 409;
  - the preview writes nothing (row count and `totalPrice` unchanged);
  - preview total = stored `totalPrice` on create, for each case above (parity);
  - `displayedTotal` 70,00 vs stored 40,00 → stored, `warning.code` `BOOKING_TOTAL_DIFFERED`; equal →
    `warning` null;
  - reception → 403.
- [ ] `resource-hourly-pricing.unit.test.js` (existing, 9 tests): add `bands` and
  `freeMinutesApplied` on 19:00–21:00 guest (2 evening × 35 = 70,00, free 60 → 35,00); the nine
  existing assertions unchanged.
- [ ] `resource-bookings-model.unit.test.js` (existing, 9 tests): the three `computeBookingTotalPrice`
  tests move to `priceBooking(...).total`, same expected figures (60, 30, 50, 0, 80, 100).
- [ ] `resource-evening-supplement.unit.test.js` (existing): add the credit case of finding 5 — sold
  2 h for 60,00 at 25 €/h, blocks 19:00–20:00 and 20:00–21:00 → `free-slots` `supplement` 10,00.

### Client tests (Vitest)

- [ ] `__tests__/ResourceBookingDialog.preview.test.jsx` (new, rules 8-16): the draft carries no
  amount and no client name; three quick end-time changes → one request; a slow answer overtaken by a
  newer one is ignored; « Calcul du prix… » disabled while pending; « Prix indisponible » +
  « Réessayer »; a 409 shows the server's message; the commit warning keeps the dialog open,
  « Fermer » closes; « 0,00 € » on a free resource.
- [ ] `__tests__/resourceBookingDraft.test.js` (new, rule 9).
- [ ] `__tests__/resourceSessions.test.js`: delete the `previewRangeTotal` and `previewSessionsTotal`
  blocks (3 tests); the other suites stay.
- [ ] `__tests__/SasResourceSchedulingPage.test.jsx`: « placing an evening slot surfaces the running
  supplement » now asserts the `free-slots` answer's `supplement` (mock answers 10, badge says +20 →
  « Supplément soirée : 10,00 € »); new test: the payload's `supplement` shows before any refresh.
- [ ] `__tests__/ResourceBookingDialog.mobile.test.jsx`: mock `api.previewResourceBooking`; the two
  existing tests unchanged.

### E2E

`npm run test:e2e` after the change (the resource planning specs, if any, mock nothing — they hit the
real preview).

### Manual UI verification

At 375, 900 and 1280 px, fictional data only:
- [ ] Happy path: draw 18:00–20:00 → 70,00 €; pick « Cabane fictive » → 40,00 €, « 1 h offerte ».
- [ ] Slow server (1,2 s injected): amount dimmed, bar, « Calcul du prix… » disabled.
- [ ] Offline: « Prix indisponible », « Enregistrer » disabled; « Réessayer » restores the price.
- [ ] Rate changed in another tab before « Enregistrer » → the warning panel.
- [ ] SAS: the credit case shows 10,00 € on the card and on the recap line — the same figure.
- [ ] Regression: the week grid, the planning cards and the fiche's session picker unchanged.

## 8. Out of scope

- **Changing what is billed.** The off-grid fallback to the flat guest rate, the external/guest grid
  choice and the offered minutes stay as they are (§9 Q2).
- **The availability greying** of the dialog's time options and the client conflict hint: not money;
  the server already refuses at commit, and now at preview (rule 5).
- **The hours still to place** on the SAS step and its `recapNotes`: hours, not money (§9 Q3).
- **The fiche's session picker** (`ResourceSessionsPicker`): it shows no amount; the line is priced by
  the reservation quote.
- **An « Offrir » toggle on a standalone booking**: does not exist today (§9 Q1).
- The departure SAS recap: its own spec (`sas-departure-total-server-side`).

## 9. Open questions

All five were answered by the owner on 2026-10-24 with the proposed default.

- **Q1 — Resolved (2026-10-24): no « Offrir » toggle on a standalone booking.** Only the logement's
  offered minutes exist; the draft has room for an `offered` field later without changing the contract.
- **Q2 — Resolved (2026-10-24): billing unchanged.** The off-grid fallback to the flat guest rate stays
  (18:05-19:35 is stored at 37,50 €); stepping the dialog by the resource's slot is a separate fix.
- **Q3 — Resolved (2026-10-24): yes, the « à planifier » hours come from the server**, as
  `hoursRemaining` in the `free-slots` answer (rule 19bis). The wizard's `recapNotes` is left for a
  follow-up.
- **Q4 — Resolved (2026-10-24): no trace** of a price gap at commit; the dialog's notice only.
- **Q5 — Resolved (2026-10-24): yes**, `useLatestPreview` in `client/src/hooks/`, exported by the SDK
  in the 2.1.0 bump; `useArrivalRecapPreview` runs on it.

## 10. Implementation progress

- Server: `priceBooking` / `checkBookable` in `bookingsModel.js`, `bands` + `freeMinutesApplied` +
  `freeValue` in `priceSessions`, the `preview` route and handler, `hoursRemaining` on `free-slots`.
  Tests: `resource-booking-preview.unit.test.js` (14, new); +2 in `resource-hourly-pricing`; +1 in
  `resource-evening-supplement`; the three `computeBookingTotalPrice` tests of
  `resource-bookings-model` now read `priceBooking(...).total`.
- Client: dialog on the preview (`ResourceBookingDialog.preview.test.jsx`, 11 tests; `resourceBookingDraft.test.js`,
  5 tests), the SAS card on the server's `supplement` and `hoursRemaining` (+2 tests, the
  « running supplement » one rewritten), the three `previewRangeTotal` / `previewSessionsTotal` tests
  deleted. C1-C11 are all removed.
- Plugin versions: `hourly-resources` 1.2.0 and `sas` 1.2.1, both `sdk ^2.1.0` (the `sas` hook imports `useLatestPreview`); SDK 2.1.0.
- `bands` amounts are rounded per band, the last one taking the remainder, so they always sum to `grossTotal`. `priceBooking` refuses (400) a `bookingId` that belongs to another resource.
- `useLatestPreview` aborts the in-flight request and drops its late answer as soon as `enabled` turns false, i.e. when the operator leaves a money page of the SAS (the arrival recap hook gains this).
