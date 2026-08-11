# Laundry counts trust the ticked option, not the property default

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `fix/laundry-count-explicit-option` |
| **Created** | 2026-08-11 |
| **Approved** | 2026-08-11 |
| **Author** | Adrien |
| **Amends** | [weekly-bed-linen-tracking.md](weekly-bed-linen-tracking.md) §3.7, [linen-inventory-shortage-tracking.md](linen-inventory-shortage-tracking.md) §3.3, [laundry-bath-mat.md](laundry-bath-mat.md) §3 rule 11 |
| **Related PR** | _(opened at the end of implementation)_ |

---

## 1. Context

Adrien reported that the « À apporter » figure on the Planning laundry card is much smaller than
the linen he actually carries to the laundry when he sums the stays that ended during the week.

A production analysis (2026-08-11, snapshot of the Pi database, 42 reservations) cleared the
aggregation engine: summing every weekly drop-off window from 2025-12-30 to 2027-08-24 yields
exactly the raw bed totals of all reservations (`46 singles / 57 doubles` both ways). No stay falls
between two windows, and nothing is cached — `laundrySummary` recomputes on every Planning load.

The gap is upstream, in the source data, and it comes from **two rules that disagree about what
puts a reservation in the linen contract**:

| Layer | Rule applied today |
|---|---|
| [laundryModel.js](../server/src/models/laundryModel.js) — counting | reservation counts if it has an explicit `countsAsBedLinen` option **OR** its property declares one as a default (§3.7 of the weekly spec) |
| [reservationsController.js](../server/src/controllers/reservationsController.js) `hasBedLinenOption` — saving | looks at the **explicit** option list only → forces `singleBeds / doubleBeds` to `0` when the row is absent |
| [ReservationPage.jsx](../client/src/pages/ReservationPage.jsx) `bedLinenForcedOptionIds` — editing | empty in edit mode (reservation-option-immutability) → the bed inputs are not even rendered |

Concretely, on **Aventura lodge** — the only property where « Linge de lit » is a *chargeable*
default (`offered = 0`, versus `offered = 1` on the Gîte) — a reservation that does not carry the
option row is still counted by the laundry aggregation, but its bed counts are zeroed on every save
and cannot be re-entered from the form. It contributes 0 sheets forever, silently. Three production
reservations sit in that state: #22194 (10/05), #22208 (28/06), #22212 (13/08), all `0 / 0`.

**Adrien's decision (2026-08-11):** the property default is *not* a trustworthy signal. Bed linen
only became chargeable-and-mandatory on the lodge in June 2026; every stay booked before that
legitimately has no linen, and the ability to remove bed linen from a reservation must be kept. The
one reliable input is **whether the option is ticked on the reservation**, and Adrien guarantees the
bed / towel quantities are filled in by the end of the stay at the latest.

## 2. Goal

The laundry drop-off, the laundry pick-up and the linen stock projection count a reservation's
bed linen (resp. bathroom linen) **iff the reservation actually carries a `countsAsBedLinen = 1`
(resp. `countsAsBathroomLinen = 1`) option row** — no property-default fallback.

One exception survives, for a structural reason: an option flagged **internal**
(`displayToClient = 0`) is *never* written to `reservation_options` by construction
([laundry-bath-mat.md](laundry-bath-mat.md) §3 rule 11 —
`reservationsModel.insertOptions` skips internal linen options, `propertyIcalModel` does not
materialise them). For those, the property default is the only possible source and stays in place.
This is what keeps the « Tapis de bain » counter alive.

Because the option is now the single sure signal, the Planning laundry card must also say when a
counted stay has **no quantity filled in yet**, instead of silently contributing zero.

## 3. Functional rules

### 3.1 What puts a reservation in the linen contract

1. **Bed linen.** A reservation contributes `singleBeds / doubleBeds / babyBeds` to a laundry
   window iff it has at least one row in `reservation_options` pointing at an option with
   `countsAsBedLinen = 1`. The per-type `linenIncludes*` flags of that option keep gating each
   bed type (unchanged).

2. **Bathroom linen.** Same rule with `countsAsBathroomLinen = 1`; the `reservation_options.quantity`
   sub-occupation scaler keeps applying (unchanged).

3. **Property defaults no longer create a contract** for a **visible** option
   (`displayToClient = 1`, the default). This reverses
   [weekly-bed-linen-tracking.md](weekly-bed-linen-tracking.md) §3.7 for visible options.

4. **Internal options keep the property-default source.** An option with `displayToClient = 0` is
   never persisted onto a reservation, so it is counted through
   `property_option_defaults` exactly as before. This covers the seeded « Tapis de bain » and any
   future internal linen item. Both sources still coexist for internal options: an explicit row
   (legacy data, created before the option was made internal) wins, the default is the fallback.

5. **Schema guard.** Installations whose `options` table predates the `displayToClient` column
   behave as if every option were visible (`displayToClient = 1`) — i.e. explicit-row-only for the
   bed / bathroom paths. The bath-mat statement is already guarded by its own column/table probe
   and is unchanged.

6. **Unchanged filters.** `kind = 'reservation'` (devis excluded), the half-open
   `(L - 7d, L]` window, the `offered` flag being ignored, manual additions and skipped trips all
   keep their current behaviour.

### 3.2 Incomplete quantities are surfaced, never silently zero

7. A reservation is **incomplete** for a laundry window when all of the following hold:
   - its `endDate` is in the window,
   - `kind = 'reservation'`,
   - it carries a `countsAsBedLinen = 1` option (rule 1 — it *is* in the contract),
   - `COALESCE(singleBeds,0) + COALESCE(doubleBeds,0) + COALESCE(babyBeds,0) = 0`.

   In other words: "you told me this stay uses bed linen, but you have not said how much yet."

8. The laundry summary payload carries these reservations per laundry day, on the **drop-off side
   only** (the pick-up side is a past batch — nothing actionable left to fill). Each entry gives
   `{ id, clientName, propertyName, endDate }`; `clientName` falls back to `#<id>` when the client
   row is missing.

9. The Planning laundry card renders a warning line under « À apporter » when the list is non-empty:
   *« N séjour(s) sans quantité de linge saisie — chiffre incomplet »*, followed by one clickable
   chip per reservation navigating to `/reservations/:id`. Hidden when the list is empty (the
   normal case), so a complete week shows no extra noise.

10. The warning does **not** alter the counts. It is informational: the number stays exactly what
    the data says, and the card admits it may be short.

### 3.3 Consequences on the stock projection

11. `utils/linenInventory.js` applies rules 1-5 identically, so « Disponible après ce dépôt » and
    the Dashboard shortage alert stay consistent with the laundry card. A reservation without the
    option consumes nothing from the stock.

### 3.4 Production impact (measured before implementation)

12. On the 2026-08-11 production snapshot the change is **numerically neutral**: every reservation
    that was counted only through the property-default fallback already had `0 / 0` beds, so it
    contributed zero either way. The change removes the ambiguity (and the silent bed-count wipe
    that made it unfixable), and rule 9 surfaces the two stays — #22208 (28/06) and #22212 (13/08) —
    that should carry the lodge's post-June mandatory linen option but were booked before the
    default was introduced.

---

## 4. Architecture

> Reminder — fat backend, thin frontend. The contract rule and the incompleteness detection are
> both SQL in the model; the card only renders what the payload says.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `laundryModel.js` | T | `sumStmt` / `sumBathroomStmt`: the UNION ALL property-default source is narrowed to internal options (`o.displayToClient = 0`), guarded by a PRAGMA probe on the column. `sumBathMatStmt` unchanged. NEW `incompleteBedConfigForWindow(startExclusive, endInclusive)` → the rule-7 list. |
| `utils/` | `linenInventory.js` | T | `computeReservationContract` / `buildContractsByReservationId`: the bed + bathroom property-default fallback applies only to internal options. Bath-mat path unchanged. |
| `models/` | `linenInventoryModel.js` | T | Carries `displayToClient` on the options row set it feeds to the engine. |
| `controllers/` | `planningController.js` | T | `laundrySummary` adds `incomplete: [...]` to each non-skipped laundry day's drop-off. Skipped days emit `[]` like their zeroed blocks. |
| `tests/` | `laundry-model.unit.test.js` | T | Property-default cases flip to "not counted" unless the option is internal; new cases for `incompleteBedConfigForWindow`. |
| `tests/` | `laundry-end-to-end.regression.test.js` | T | Same flip on the end-to-end fallback cases. |
| `tests/` | `linen-inventory.unit.test.js` + `linen-inventory-model.unit.test.js` | T | Same flip on the projection side. |
| `tests/` | `planning-laundry-controller.unit.test.js` | T | 3 new cases pinning the `incomplete` payload (present on drop-off only, `[]` on a skipped day, graceful degradation when the injected model lacks the method). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `LaundryDayCard.jsx` | T | New warning block under « À apporter » (rule 9): caption + clickable chips. Hidden when the list is empty. New `onOpenReservation(id)` prop — a callback rather than an inner `useNavigate`, so the card stays a pure renderer mountable without a Router (its whole test suite renders it bare). |
| `pages/` | `PlanningPage.jsx` | T | `dropOff.incomplete` already rides the stored `{ dropOff, pickUp }` (initial load + infinite-scroll merge). Passes `onOpenReservation` and adds the incompleteness clause to the day-set filter that mirrors the card's silence rule — otherwise a Tuesday whose only departures lack quantities never enters the date set and the card never mounts. |
| `tests/` | `LaundryDayCard.incomplete.test.jsx` | C | 6 cases: warning + chips, pluralisation, hidden when empty/absent, all-zero week still renders, chip callback, skipped trip shows its own caption instead. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Chip`, `Typography`, `Box` — same idiom as `LinenShortageAlert`'s impacted-reservation chips. | |
| **Created (new generic)** | — | |
| **Specific (kept feature-local)** | The warning block inside `LaundryDayCard`. ~15 lines, one call site, tied to the laundry payload. | |

### 4.3 API contract

`GET /api/planning/laundry` — additive, backward compatible:

```jsonc
{
  "laundryWeekday": 2,
  "laundryDays": [{
    "date": "2026-08-11",
    "dropOff": {
      "singleBeds": 4, "doubleBeds": 3, "babyBeds": 0,
      "largeTowels": 8, "mediumTowels": 0, "smallTowels": 8,
      "bathMats": 3,
      "incomplete": [                       // NEW — [] when nothing to flag
        { "id": 22212, "clientName": "Jean Dupont", "propertyName": "Aventura lodge", "endDate": "2026-08-13" }
      ]
    },
    "pickUp": { "...": "unchanged, no incomplete key" }
  }]
}
```

---

## 5. Data model

No schema change. `options.displayToClient` already exists (laundry-bath-mat.md §5); this spec only
changes how it is read by the two aggregation paths.

---

## 6. UI / UX

The laundry card gains a third line, only when relevant:

```
┌───────────────────────────────────────────────┐
│ 🧺  Linge à la blanchisserie                  │
│                                               │
│ À apporter          │ À récupérer             │
│ Draps : 4 simples…  │ Draps : 2 simples…      │
│                                               │
│ ⚠ 1 séjour sans quantité de linge saisie      │
│   — chiffre incomplet                         │
│   [Jean Dupont · Aventura lodge]              │
└───────────────────────────────────────────────┘
```

- Warning colour: `warning.main` text + `WarningAmberIcon`, no filled Alert (the card is already
  tinted; a nested Alert would fight it).
- Chips: `size="small"`, `variant="outlined"`, `onClick` → `/reservations/:id`, wrapping on `xs`,
  touch target ≥ 44px via the default MUI chip height plus vertical padding.
- Mobile (`xs`): the block stacks under the two existing columns; chips wrap on several lines. No
  horizontal scroll.

---

## 7. Test plan

### 7.1 Server unit tests

- [ ] `laundryModel.dropOffForWindow`: reservation WITHOUT the option row but WITH a visible
      property default → **0** (was: counted).
- [ ] Same with an **internal** (`displayToClient = 0`) property default → still counted.
- [ ] Explicit row still wins and is unaffected.
- [ ] Same three cases on `dropOffBathroomForWindow`.
- [ ] `dropOffBathMatForWindow` unchanged (internal option, property default still counts).
- [ ] Schema without `displayToClient` → explicit-row-only, no crash.
- [ ] `incompleteBedConfigForWindow`: flags a ticked-option stay with 0/0/0; ignores a stay with
      beds; ignores a stay without the option; ignores devis; respects the half-open window.
- [ ] `linenInventory`: contract is zero for a reservation whose only source was a visible property
      default; unchanged for internal options.
- [ ] `planningController.laundrySummary`: `incomplete` present on drop-off, absent/empty on
      pick-up, `[]` on a skipped day.

### 7.2 Client tests

- [ ] `LaundryDayCard` renders the warning + one chip per incomplete stay.
- [ ] No warning block when `incomplete` is empty or undefined.
- [ ] Clicking a chip navigates to `/reservations/:id`.

### 7.3 Manual UI verification

- [ ] Planning: a Tuesday card with an incomplete stay shows the warning; filling the beds on the
      fiche then reloading makes it disappear and raises the count.
- [ ] Bath mats still counted on both properties (internal option regression).
- [ ] Mobile (`xs`): the warning block and its chips wrap without horizontal scroll.

---

## 8. Out of scope

- **Estimating bed counts** from the guest count / property capacity — explicitly rejected by
  Adrien: the quantities are filled in by the end of the stay, an estimate would compete with the
  real data.
- **Recovering the wiped bed counts** of #22194 / #22208 / #22212 — the values are gone; Adrien
  re-enters them by ticking the option on the fiche.
- **Baby sheets** — `linenIncludesBaby = 0` on the seeded option stays as configured (Adrien's call,
  2026-08-11). Baby beds keep being excluded from the laundry counts.
- **Towels by default** — « Linge de toilette » stays out of the property defaults; it is an extra
  sold at arrival and only counts when ticked (Adrien's call, 2026-08-11).
- **Retro-adding the lodge's mandatory linen option** to pre-June bookings — rule 9's warning makes
  them visible; Adrien decides case by case.
- **An email / push alert** on incomplete stays — the Planning card is the V1 surface.

---

## 9. Open questions

_(none — resolved during the 2026-08-11 analysis.)_

- Q: should the property default keep creating a contract for visible options?
  - A (2026-08-11, Adrien): **no**. Bed linen only became mandatory on the lodge in June 2026;
    earlier stays legitimately have none, and removing linen from a reservation must stay possible.
    The ticked option is the sure signal.
- Q: should the missing quantities be estimated from the guest count?
  - A (2026-08-11, Adrien): **no** — the quantities are guaranteed filled by the end of the stay.
