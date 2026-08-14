# Welcome pack — auto-applied options on own-channel reservations

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/welcome-pack-auto-options` |
| **Created** | 2026-08-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

[`specs/tariff-recipes/spec.md` §3.9](tariff-recipes/spec.md) defines the **welcome pack** of an
own-channel booking: first-morning breakfast for 2 + a 1 L bottle of apple juice, « included by the
unit, not by the line ». It is materialised as `property_option_prices.freeUnits` — 2 on « Petit
déjeuner », 1 on « Jus de pomme 1L » for Aventura Lodge — and the pricing engine already honours it:
[`applyFreeUnitsToLine`](../server/src/utils/pricing.js#L795) zeroes the first N units of an option on
`direct` / `Lodgify` bookings and bills the rest.

What is missing is the other half of the promise. **Nothing puts the pack on the reservation.** On
every direct booking the operator has to remember to open the Extras, tick « Petit déjeuner », uncheck
the six mornings they did not mean to sell, and tick the juice. Forget it and the guest never gets
the pack that the rate advertises; tick it too broadly and the reservation silently sells breakfasts
nobody ordered. Symmetrically, a reservation started as direct and re-qualified as an Airbnb booking
keeps the pack lines on the fiche even though the rate no longer covers them.

## 2. Goal

Creating a **booking** — a reservation OR a devis — on an own channel (`direct` or `Lodgify`) arrives
with the property's welcome pack already on the fiche, and only the pack, never a billable unit.
Changing the platform before saving takes it back off.

## 3. Functional rules

### 3.1 What the pack is

1. **The pack comes from the tariff recipe, not from code.** It is the set of options applicable to
   the property whose per-property `freeUnits` is `> 0` — the column the recipe writes. No option
   title, `seedKey` or `autoOptionType` is hardcoded anywhere in this feature. Today: Aventura Lodge
   = 2 × « Petit déjeuner » + 1 × « Jus de pomme 1L » ; the Gîte's pack is empty.
2. Archived options, options not linked to the property, and options hidden from the client
   (`displayToClient = 0`) are excluded — same filter as `property.rateInclusions`.
3. **Own channel only.** Eligibility is decided by
   [`isDirectChannel`](../server/src/utils/platformNameFormat.js) — `direct` **and** `Lodgify` — the
   single helper the pricing engine already uses (recipe rule 53). Any other platform: empty pack.

### 3.2 When it applies

4. **Unsaved bookings only.** The auto-apply runs on the fiche while it has never been saved (no
   `reservationId` **and** no `devisId`). A reservation or a devis loaded from the database is never
   touched — not on load, not on a platform change, not on a guest-count change. Its option set is
   history (option-planning rule 30), and the engine already stops covering the free units the moment
   the platform becomes a commissioned one.
5. It runs on the **blank** new-booking path — « Nouvelle réservation » **and** « Nouveau devis »
   (amended 2026-08-14, specs/devis-extras-parity-and-price-lock.md §3 rule 5: the quote must show the
   guest the same package the reservation would, since it is the document the guest actually reads).
   A fiche pre-filled from a devis, from an iCal import or from a duplication carries its own option
   set and is left alone.
6. The form re-evaluates the pack whenever the context that decides it changes: **platform, property,
   stay dates, guest counts**.

### 3.3 The pack never bills anything

7. **A pack line is added only when the free units cover the whole order.** This is the rule that
   makes the feature safe to run unattended:
   - **Per-stay option** (« Jus de pomme 1L », `freeUnits = 1`) → quantity = `freeUnits`. One unit
     ordered, one unit free, 0 € billed.
   - **Per-person option served on a card** (« Petit déjeuner », `per_person_per_night`,
     `freeUnits = 2`) → one checked occurrence bills `persons` units, so the line is auto-added
     **only when `persons ≤ freeUnits`**. On a 3+ guest stay the pack breakfast is *not* auto-added:
     the operator ticks it themselves and the units beyond the 2 free are billed as usual (recipe
     rule 52). Decision 2026-08-12 — a pre-ticked line that quietly bills 20 € of extras is worse
     than no line at all.
8. **The checked occurrence is the first morning**, i.e. the first day of the stay on which the
   option's serving time falls after check-in (breakfast at 09:00 with a 15:00 check-in → the day
   after arrival). Every other morning of the stay stays unchecked.
9. `persons` is the pricing engine's definition: `adults + children + teens` (babies excluded).

### 3.4 Ownership — the operator always wins

10. Pack lines are **tagged** in form state. The tag is local to the form and never reaches the
    server; it is what lets the form take back exactly what it put there. It must survive a pricing
    recompute: the quote rebuilds `selectedOptions` from the engine's lines, so the tag is preserved
    from the previous state exactly like `inComplement` and `cardOccurrences`.
11. **As soon as the operator touches a pack option** — toggles it off, edits its quantity, checks or
    unchecks any of its occurrences — the line loses its tag and the form stops managing it: it is no
    longer removed on a platform change, nor re-added. Turning a pack line **off** deletes the line
    *and* its tag, so the refusal is remembered separately (an opt-out set of option ids, reset when
    the logement changes); without it the next context change would put the line straight back.
12. **Leaving the own channel** (platform → Airbnb, Booking, …) removes the tagged lines: the per-stay
    line is dropped, the card option's pack occurrence is unchecked (and the line dropped when that
    leaves it empty). Anything the operator added on top is untagged, so it stays — and the engine
    bills it in full, since `freeUnits` only applies on an own channel. That is the « les petits-déj
    en plus passent en payant » rule, and it needs no new code.
13. **Coming back** to `direct` / `Lodgify` on a still-unsaved reservation re-applies the pack.

**Edge cases:**

- Empty pack (the Gîte today) → no-op, no request noise on the fiche.
- Stay dates missing or invalid → the per-stay lines still apply; the card line waits for dates
  (rule 6 re-evaluates as soon as they are entered).
- Guest count raised above the free units after the pack was applied → the tagged card line is
  removed again (rule 7 is a live condition, not a one-shot check at creation).
- Guest count lowered back to ≤ `freeUnits` → the card line comes back, unless rule 11 dropped its
  tag in the meantime.
- The option is also a per-property **default** (`property_option_defaults.offered`) → the defaults
  path already added it; the pack does not duplicate the line and does not re-check occurrences the
  defaults path owns.
- A fractional `freeUnits` on a card option → floored for the coverage test (you cannot serve half a
  breakfast).
- The welcome-pack request fails (offline, 500) → soft-fail, exactly like
  `applyPropertyDefaultsAsync`: the form works, the pack is simply absent.

---

## 4. Architecture

> **Fat backend.** What the pack contains, whether the platform qualifies, whether the free units
> cover the party, and which day is « the first morning » are all decided server-side. The client
> receives ready-to-apply lines and does one thing with them: reconcile them into `selectedOptions`.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `properties.js` | T | `GET /:id/welcome-pack` → `welcomePackController.forProperty` |
| `controllers/` | `welcomePackController.js` | C | Parses/validates the query context, calls the model + the builder, returns the payload |
| `models/` | `propertiesModel.js` | T | `listWelcomePackOptions(propertyId)` — the options with `freeUnits > 0` for this property, with their priceType / card config / unit price |
| `middleware/` | — | — | (none) |
| `utils/` | `welcomePack.js` | C | Pure builder: `buildWelcomePackLines({ packOptions, platform, startDate, endDate, checkInTime, adults, children, teens })` → the lines to apply. Owns rules 3, 7, 8, 9 |
| `utils/` | `platformNameFormat.js` | — | Consumed (`isDirectChannel`) — unchanged |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | (none — `freeUnits` already exists) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | One effect: fetch the pack for the current context (unsaved bookings only — `isBlankNewBooking`, reservation or devis, amended 2026-08-14) and reconcile it into `form.selectedOptions`; drops the tag + records the opt-out in `setOptionQuantity` / `setOptionCardOccurrences` (rule 11); clears the opt-out on a logement change |
| `utils/` | `applyQuoteToForm.js` | T | Carries the pack tag across a pricing recompute, like `inComplement` / `cardOccurrences` (rule 10) |
| `components/` | `reservation/OptionRow.jsx` | T | Renders a « Pack de bienvenue » chip on a tagged line so the operator knows why the option appeared by itself |
| `hooks/` | `useWelcomePack.js` | C | Fetches the ready-to-apply lines for `{ propertyId, platform, dates, guests }`, soft-failing; returns `{ lines }` |
| `utils/` | `welcomePackApply.js` | C | Pure reconcile: `(selectedOptions, packLines, catalogue) → selectedOptions` (add tagged lines, uncheck/drop the ones no longer granted, never touch an untagged line). Presentation plumbing over a server decision, not business logic |
| `utils/` | `cardOccurrences.js` | — | Consumed (`buildInitialGrid`) to seed the grid before checking the single pack occurrence |
| `api.js` | `api.js` | T | `getWelcomePack(propertyId, params)` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Chip` (as used elsewhere in `OptionRow`) | No new generic component is warranted. |
| **Created (new generic)** | — | — |
| **Specific (kept feature-local)** | the chip markup inside `OptionRow` | Three words of JSX inside the row that already renders every other option badge; extracting it would be indirection, not reuse. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/properties/:id/welcome-pack` | query: `platform`, `startDate`, `endDate`, `checkInTime`, `adults`, `children`, `teens` | `{ eligible, lines: [...] }` | Auth: same session middleware as the rest of `/api/properties`. `400 INVALID_PROPERTY_ID` on a bad id; unknown property → `{ eligible: false, lines: [] }` |

```jsonc
{
  "eligible": true,                    // false ⇔ commissioned platform or empty pack
  "lines": [
    { "optionId": 6,  "title": "Petit déjeuner", "mode": "occurrence",
      "freeUnits": 2, "occurrence": { "date": "2026-08-15", "time": "09:00" } },
    { "optionId": 21, "title": "Jus de pomme 1L", "mode": "quantity",
      "freeUnits": 1, "quantity": 1 }
  ]
}
```

`lines` contains only what may be applied as-is: an option the free units cannot fully cover
(rule 7) is simply absent from the array.

---

## 5. Data model

No schema change. `property_option_prices.freeUnits` (tariff-recipes §3.9 rule 52bis) is the source of
truth and already exists, populated by the recipe.

**Data impact:** none on existing rows. The feature only pre-fills a form; saved reservations are
never rewritten (rule 4).

## 6. UI / UX

**Reservation fiche — Extras section, new reservation on `direct` / `Lodgify`:**

```
 Restauration
 ┌───────────────────────────────────────────────────────────┐
 │ [●] Petit déjeuner   [Pack de bienvenue]   10 € ×2 pers.   │
 │      ☑ sam. 15 août  09:00                                │
 │      ☐ dim. 16 août  09:00                                │
 │      ☐ lun. 17 août  09:00                     0,00 €     │
 └───────────────────────────────────────────────────────────┘
 Boissons
 ┌───────────────────────────────────────────────────────────┐
 │ [●] Jus de pomme 1L  [Pack de bienvenue]   5 €   0,00 €   │
 └───────────────────────────────────────────────────────────┘
```

- The lines appear ticked with a `Chip size="small"` labelled **« Pack de bienvenue »** next to the
  option title. No new copy anywhere else: the pricing summary already prints « dont 2 inclus dans le
  tarif » ([`PricingSummary.jsx`](../client/src/components/PricingSummary.jsx#L392)).
- Switching the platform to a commissioned one makes the lines disappear the same way the operator
  would have unticked them — no dialog, no toast. Reverting the platform brings them back.
- **Loading:** the pack lands with the rest of the form init; there is no spinner and no layout jump
  (the Extras section renders its options from the catalogue regardless).
- **Error:** silent (rule: soft-fail). The operator ticks the options manually, as today.
- **Responsive:** nothing structural is added — the chip sits inline in the option title row, which
  already wraps on `xs`. Checked at `xs` / `md` / `lg`: on `xs` the chip wraps under the title
  instead of pushing the price off-screen.
- **`PageActionBar`:** unchanged — this spec adds no page-level action.

## 7. Test plan

### Server unit tests
- [x] `tests/welcome-pack.unit.test.js` — 14 tests
  - pack built from `freeUnits > 0` only, archived / unlinked / internal / engine-derived options excluded (rules 1-2)
  - `direct` and `Lodgify` are eligible, Airbnb / Booking / Abritel / Greengo are not (rule 3)
  - per-stay line → `quantity = freeUnits` (rule 7)
  - per-person card line present at 2 guests, absent at 3 — children and teens count, babies don't (rules 7, 9)
  - first morning = day after arrival with breakfast 09:00 / check-in 15:00; = arrival day when the
    serving time falls after check-in; the departure morning survives an early check-out for
    breakfast only (rule 8)
  - empty pack (the Gîte) → `{ eligible: false, lines: [] }`
  - missing / invalid dates → the card line is absent, the per-stay line is present (edge case)
  - fractional `freeUnits` floored; a per-night option granted only for as many whole nights as the rate covers

### Client unit tests (vitest)
- [x] `utils/__tests__/welcomePackApply.test.js` — 10 tests: adds tagged lines; removes only tagged
  ones; leaves an operator-owned (untagged) line alone; re-checks the pack morning after the grid
  reconcile widened it; honours the opt-out set; stable reference when nothing moved.
- [x] `utils/applyQuoteToForm.test.js` — the tag survives a pricing recompute (rule 10).
- [x] `components/reservation/__tests__/ExtrasSection.welcome-pack.test.jsx` — the chip shows on a
  tagged line and not on a manual one.

### Manual UI verification (2026-08-12, dev DB, Aventura Lodge, 14→17 Sept)
- [x] Happy path: new reservation, platform `direct` → breakfast ticked on the first morning
  (mar. 15) only + juice ticked, both at 0,00 € (« dont 2 inclus dans le tarif » / « dont 1 »).
- [x] Switch the platform to `Airbnb` → both lines gone; back to `direct` → both back.
- [x] Raise to 4 voyageurs → the breakfast line disappears (it would have billed 2 units), the juice
  stays; back to 2 → it returns, quantité 2 (1 × 2 pers.).
- [x] Operator unticks the juice, then switches platform twice → the juice stays unticked (rule 11),
  the breakfast pack line is unaffected.
- [x] Gîte (empty pack) → nothing is auto-added, no chip.
- [x] Existing saved reservation (Booking → direct) → no line added, no chip, the enabled options are
  the same before and after.
- [x] Mobile (390 px): no horizontal overflow on the fiche.
- [x] Regression: per-property option defaults (linen « Inclus ») still pre-fill and stay untouched
  by the pack.

## 8. Out of scope

- Changing what the pack *costs* or how it is priced — `applyFreeUnitsToLine` is untouched.
- Editing the pack from the UI: it is edited by changing the tariff recipe / the per-property
  `freeUnits`, as today.
- Applying the pack on the public booking flow, on devis, on iCal-imported reservations or on
  duplicated reservations (rule 5).
- Re-applying the pack to reservations created before this spec.

## 9. Open questions

- Q: On a 3+ guest stay, should the pack breakfast be pre-ticked and the extra units billed?
  - A (2026-08-12): **No.** Nothing is auto-added when the free units do not cover the party; the
    operator ticks it manually. Rule 7.
- Q: Should a saved reservation lose its pack when the platform changes?
  - A (2026-08-12): **No.** The auto-apply is confined to the unsaved form; a saved reservation's
    lines stay, and the engine simply stops covering them. Rule 4.
