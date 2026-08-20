# Baby-bed supplement — 5 € per cot, for the whole stay

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/baby-bed-supplement` |
| **Created** | 2026-08-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A baby cot is entered on a booking through the **Lits bébé** counter of the « Voyageurs » card
([GuestsBedsSection.jsx:104-119](../client/src/components/reservation/GuestsBedsSection.jsx#L104-L119)),
persisted on `reservations.babyBeds`. It is deliberately kept out of the « Linge de lit » card — a cot
is an independent physical resource, not a linen item (specs/bed-config-in-linen-card.md §3 rule 1,
follow-up 2026-06-08).

Today that counter is **purely operational**: it feeds the availability check
([`getBabyBedAvailability`](../server/src/models/resourcesModel.js#L168), stock held by the « Lit bébé »
row of the *resources* catalogue), the J-7 e-mail notice (specs/j7-email-baby-beds.md) and the laundry
aggregation. **It bills nothing.** The public widget even advertises the cot as
« Gratuit, selon disponibilité »
([class-gf-blocks.php:144](../integrations/wordpress/guestflow-booking/includes/class-gf-blocks.php#L144)).

Adrien now sells the cot: **5 € per cot for the whole stay**, whatever the number of nights.

The engine already knows how to derive an option line by itself: an option flagged
`autoOptionType` + `autoEnabled = 1` is built by the pricing engine from the reservation's own fields
and never appears in `selectedOptions` — that is how « Arrivée anticipée » / « Départ tardif » are priced
([pricing.js:452-518](../server/src/utils/pricing.js#L452-L518),
[pricing.js:1571-1612](../server/src/utils/pricing.js#L1571-L1612)). The baby-bed supplement is the
same shape, driven by `babyBeds` instead of the check-in/out hour.

## 2. Goal

Entering one or more baby cots on a booking automatically bills 5 € per cot for the whole stay — on the
fiche, on the devis and on the public website — without anything to tick, while every booking already
saved keeps exactly the price it was sold at.

## 3. Functional rules

### 3.1 The option

1. A catalogue option **« Lit bébé »** (`titleEn` = *Baby cot*) carries `autoOptionType = 'baby_bed'`,
   `autoEnabled = 1`, `priceType = 'per_stay'`, `price = 5`. It is seeded at boot (§5) and, like every
   typed option, is **not deletable** in Paramètres → Options.
2. Its price is edited like any other option: single price, or **per logement** via the existing
   per-property price switch (specs/per-property-option-prices.md). The effective unit price for a
   booking is the property override when present, else the base price.
3. The engine bills **`unitPrice × babyBeds`, once for the stay** — the option's `priceType` is not
   consulted (a cot is never per-night or per-person). `quantity` = `billedUnits` = `babyBeds`.
4. **No line at all** when the effective unit price is `0` — a logement that does not charge for cots
   simply has no line, not a `0,00 €` one. Setting a per-property price to 0 is therefore the way to
   opt a logement out.
5. **No line at all** when `babyBeds` is 0 or empty, or when the option is not linked to the booking's
   logement.

### 3.2 Where it applies

6. **Every channel.** Direct, Lodgify, Airbnb, Booking, … all bill the supplement. On a non-direct
   platform the line follows the standard extras routing and lands in the **Complément** collected on
   site (specs/force-extras-complement-on-platform.md §3) — like every other extra.
7. **Every surface** the pricing engine feeds: fiche réservation, devis (admin *and* site), public
   website quote, devis PDF, accounting. One engine, one rule.
8. The operator can **offer** it in one click: the « Offrir » button of the récapitulatif zeroes the
   line and shows its real price struck through — the escape hatch when the channel already covers the
   cot. That is the existing `offeredOptionIds` mechanism, no new code.
9. It is **not toggleable** in the Extras list: the row shows a disabled Switch and « Ajout
   automatique », like the arrival/departure options. The **Lits bébé** counter is its only input.
9bis. The row is shown **only when the engine actually billed the cot** — not when a cot merely sits
   on the booking (amended 2026-08-20 during implementation). Keying the row on the quote rather than
   on the counter is what keeps it honest in the three cases the SERVER decides alone: no cot, a
   logement priced at 0, and above all a grandfathered booking (§3.3), where a row announcing
   « 5,00 € par lit bébé » beside a récapitulatif that bills nothing would be a lie.

### 3.3 Never retroactive

10. A booking (reservation **or** devis) that is **already stored with `babyBeds > 0` and no baby-bed
    option line is grandfathered**: it never gets the line, on any recompute — re-save, payment flip,
    contrib capture, « Utiliser les tarifs actuels ». Its total cannot move.
11. A stored booking with `babyBeds = 0` is **not** grandfathered: adding a cot to it later bills the
    5 €, like any new booking.
12. Once the line exists on the stored booking it stays, and its **quantity always follows the current
    count** (2 cots → 3 cots reprices to 15 €).
13. A **new** booking (nothing stored yet: create, iCal import, site request) is never grandfathered.
14. The grandfathering verdict is read from the database at quote time, so the **live preview shows
    exactly what the save will store**.

### 3.4 Price lock

15. The unit price is frozen by the booking's pricing snapshot exactly like any other option line: a
    later catalogue price change never rewrites a saved booking. The **quantity** is always recomputed
    from the current `babyBeds` (rule 12). A devis re-prices when its validity expires, like the rest
    of its lines (specs/devis-extras-parity-and-price-lock.md §3 rule 13).

### 3.5 Public website

16. The site quote includes the supplement: the widget already sends `babyBeds` with every `/quote`
    call, and the returned line renders in the summary like any other option.
17. The cot row of the widget stops saying « Gratuit, selon disponibilité » and shows the **real price
    served by the API**: « 5,00 € par lit, pour le séjour ». No price is hardcoded in the plugin; when
    the option is absent or free for the logement, the row falls back to « Selon disponibilité ».
18. « Lit bébé » is **not** offered as a tickable option in the widget's options list — it is
    engine-derived, exactly like the arrival/departure options already hidden there. It stays in the
    public options *payload* (that is where the widget reads its price, rule 17); it is the widget's
    `HIDDEN_AUTO` list that keeps it out of the tickable ones.
18bis. The public quote endpoint **strips every engine-managed auto-option from the incoming
    `options`** before pricing (amended 2026-08-20, same filter `devisModel.computeQuote` already
    applied). Without it a visitor posting `{optionId: <cot>, quantity: 10}` would pre-empt the
    derived line and choose their own quantity — the engine drops its own line when the id is already
    selected.

**Edge cases:**

- `babies > 0` but `babyBeds = 0` (guest brings their own, or none left) → no line, no charge. The J-7
  « prévoyez d'en apporter un » notice is unchanged.
- `babyBeds > babies` (a child sleeping in a cot) → billed on the **cot count**, not the baby count.
- Cot count raised/lowered on an unsaved fiche → the line follows live, the preview reprices.
- Grandfathered booking whose cots are set to 0 and saved → it leaves the grandfathered set (stored
  count is 0); re-adding a cot afterwards bills it. Deliberate: at that point the operator is
  re-selling the cot.
- Devis → réservation conversion: the line graph is copied verbatim
  ([devisModel.js:704](../server/src/models/devisModel.js#L704)), so a grandfathered devis becomes a
  grandfathered reservation (stored cots, no line) and a billed devis carries its 5 € across. No
  special case needed.
- iCal import: the imported reservation has no cot (`babyBeds = 0`) → no line; adding one later bills
  it (rule 11).
- Property with no « Lit bébé » stock at all → the counter never shows (it is gated on `babies > 0`
  and clamped by availability), so no line.

---

## 4. Architecture

> **Fat backend.** *Whether* a booking is billed, *how much*, and *whether it is grandfathered* are all
> decided by the pricing engine from the database. The clients (fiche, widget) only forward the cot
> count and render the line the engine returns. The single client-side computation is the helper text
> under the counter, which reads a price the server already sent.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — no new endpoint) |
| `controllers/` | `reservationsController.js` | T | Passes `babyBeds` + `bookingId` to the engine in `calculatePrice` / `create` / `update` |
| `controllers/` | `public/publicQuoteController.js` | T | Passes the already-validated `babyBeds` to the engine, and strips engine-managed auto-options from the visitor's `options` (rule 18bis) |
| `controllers/` | `paymentsController.js` | T | `runDevisEngineQuote`: passes `babyBeds` + `bookingId` so a payment link never drops the line |
| `models/` | `devisModel.js` | T | Passes `babyBeds` (`body ?? existing`) + `bookingId` (the devis on update) |
| `models/` | `propertiesModel.js` | — | (none — the seed re-links on every boot, so a logement created later is covered without a hook) |
| `middleware/` | — | — | (none) |
| `utils/` | `babyBedSupplement.js` | C | The whole rule, pure + testable: `findBabyBedOption` / `isBabyBedOption`, `normalizeBabyBedCount`, `buildBabyBedSupplementLine({ option, babyBeds, unitPrice })` (rules 3-5, 15), `isBabyBedSupplementGrandfathered(db, bookingId, optionId)` + `resolveBillableBabyBeds` (rules 10-14) |
| `utils/` | `babyBedSupplementSeed.js` | C | `ensureBabyBedSupplementOption(db)` — the idempotent boot seed (§5) |
| `utils/` | `pricing.js` | T | Two new inputs (`babyBeds`, `bookingId`); resolves the billable cot count once, then builds the line **inside** the existing auto-option pipeline so it inherits offered / Complément / contribs / locked-snapshot handling with no new branch |
| `utils/` | `forceItemContribsCapture.js` | T | `buildEngineInput` forwards `babyBeds` + `bookingId` — a contrib capture must reprice identically or the conservation invariant breaks |
| `models/` | `propertyIcalModel.js` | — | (none — an imported reservation has no cot) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | `database.js` | T | Runs the seed at boot + exposes it on `db`, beside the catering / insurance seeds |

**Notes:**
- `utils/babyBedSupplement.js` is a pure module except `isBabyBedSupplementGrandfathered`, which takes the `db` handle
  like the other engine lookups (`getApplicableOptions`, tourist-tax settings).
- The engine builds the line **inside** the existing `autoOptionLines` pipeline, so `offeredOptionIds`,
  `autoOptionsInComplement`, `forceExtrasToComplement` and the locked-snapshot fallbacks apply with no
  new branch.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Sends `babyBeds` in the pricing request memo (+ dependency array) and in the save-time quote call, so the preview reprices as soon as the counter changes |
| `components/` | `reservation/GuestsBedsSection.jsx` | T | Helper text under **Lits bébé**: « Dispo restante: N · 5,00 € / lit » (price read from the catalogue option in the form context) |
| `components/` | `reservation/OptionRow.jsx` | T | Baby-bed caption for the auto row: « 5,00 € par lit bébé, pour le séjour » instead of the early/late « seuil nuit complète » sentence |
| `components/` | `reservation/ExtrasSection.jsx` | T | Shows the cot row only when the quote carries its line (rule 9bis), in the flat list and inside the categories alike |
| `components/` | `PricingSummary.jsx` | — | (none — renders « Lit bébé ×2 » through the generic option row) |
| `hooks/` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |
| `api.js` | — | — | (none — `calculatePrice` forwards the body verbatim) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `QuantityField`, `PricingSummary`, `OptionRow` | Pre-existing; only their content changes. |
| **Created (new generic)** | (none) | The feature adds no UI block. |
| **Specific (kept feature-local)** | (none) | |

### 4.3 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `blocks/booking/view.js` | T | Hides `baby_bed` from the selectable options (rule 18); renders the cot row's subtitle from the option price served by the API (rule 17) |
| `includes/class-gf-blocks.php` | T | i18n: `babyBedsSub` becomes the free fallback « Selon disponibilité » + a new `babyBedsSubPriced` pattern « %s par lit, pour le séjour » |
| `guestflow-booking.php` + `readme.txt` | T | Plugin version 1.5.0 → **1.6.0** (asset cache-busting) + changelog entry |

### 4.4 API contract

No new endpoint. Two request fields start being **read** where they were previously ignored:

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/calculate-price` | `+ babyBeds` (number) | `optionLines[]` may contain the baby-bed line | Backward compatible: absent → 0 → no line |
| POST | `/api/public/quote` | `babyBeds` (already accepted + validated) | `options[]` may contain the baby-bed line | The widget already sends it |

---

## 5. Data model

**No schema change.** Everything reuses existing columns: `reservations.babyBeds`, the `options` row
(`autoOptionType`, `autoEnabled`, `price`), `property_options` (applicability), `property_option_prices`
(per-logement price), `reservation_options` (the persisted line).

**Seed (idempotent, `database.js`):** `ensureBabyBedSupplementOption()` runs at boot.

- Found by `seedKey = 'baby_bed'` **or** `autoOptionType = 'baby_bed'` → the row is left exactly as it
  is (the operator's title, price and price type are never overwritten); a wiped `seedKey` is
  re-stamped so the next boot cannot insert a twin beside it.
- Otherwise it inserts « Lit bébé » / *Baby cot*, `per_stay`, `price = 5`, `autoOptionType = 'baby_bed'`,
  `autoEnabled = 1`, `displayToClient = 1`.
- **Links it to every logement on every boot** — same contract as the catering and cancellation-insurance
  seeds, so a logement created later is covered with no hook in `propertiesModel` (amended 2026-08-20:
  the first draft made the link a one-shot and let unlinking stick; re-linking is the house pattern, and
  §3.1 rule 4 already gives a real opt-out — a per-property price of 0, which removes the line entirely).
- An **archived** supplement counts as present: archiving stays the permanent way to retire it.
- A hand-made option merely *named* « Lit bébé » is never adopted — flipping it to engine-managed would
  take it out of the operator's hands and re-derive the quantity of every reservation carrying it. It is
  reported in a boot warning instead, so a duplicate cannot hide in the catalogue.

**Data impact:** no existing row is modified. Bookings already stored keep their totals — rule 10
guarantees the engine will not add a line to them, and nothing back-fills `reservation_options`.

## 6. UI / UX

### Fiche réservation — carte « Voyageurs »

Unchanged layout. The **Lits bébé** counter (visible only when `babies > 0`) gains the price in its
helper text:

```
Dispo restante: 1 · 5,00 € / lit
```

The price part is omitted when the logement has no baby-bed option or prices it at 0.

### Fiche réservation — Extras

A read-only row appears in the options list as soon as the engine bills the cot (rule 9bis — so: never
on a grandfathered booking, never at 0 €), in the same style as « Arrivée anticipée » :

```
┌────────────────────────────────────────────────┐
│ Lit bébé                              [ ●○ ]   │  ← Switch disabled
│ 5,00 € par lit bébé, pour le séjour   Ajout    │
│                                    automatique │
└────────────────────────────────────────────────┘
```

### Fiche réservation — Récapitulatif

```
OPTIONS
Lit bébé ×2                    [Offrir]   10,00 €
```

On a platform reservation the line carries the (non-clickable) « compl. » chip like the other
engine-derived options. Offered → `10,00 €` struck through, 0 billed.

### Site public — widget de réservation

The cot row keeps its stepper; only the subtitle changes:

```
Lit(s) bébé souhaité(s) ?
5,00 € par lit, pour le séjour          [− 1 +]
```

and « Lit bébé » never appears among the tickable options. The quote summary lists
`Lit bébé ×1 — 5,00 €` with the other extras.

### Responsive behaviour

Nothing structural changes: the counter, the option row and the summary line are existing responsive
blocks (`xs` = stacked full-width, `sm+` = two columns). The longer helper text under **Lits bébé**
wraps on `xs` instead of truncating — checked at ≤600px. The widget row uses the same
`[title + subtitle] … [stepper]` layout as every other line and already wraps on mobile.

### Sticky action bar

No page-level action added. `ReservationPage` keeps its existing bar.

## 7. Test plan

### Server unit tests — **+39, all green** (`cd server && npm test` → 3233 passing)

- [x] `tests/baby-bed-supplement.unit.test.js` (+16) — the pure rule
  - 1 cot → 5 €; 3 cots → 15 € with `quantity = billedUnits = 3`; unchanged by the stay length;
    the catalogue `priceType` ignored (rule 3).
  - 0 / empty / negative cots → no line; unit price 0 → no line (rules 4-5); a non-engine-managed
    option bills nothing.
  - Frozen unit price × the current count (rule 15 + 12).
  - `isBabyBedSupplementGrandfathered`: stored cots + no line → true; line present → false; 0 stored
    cots → false; devis → same verdict; unsaved / unknown id → false; a schema without the tables →
    false (rules 10-14).
  - `resolveBillableBabyBeds` as the single gate.
- [x] `tests/pricing-baby-bed-supplement.unit.test.js` (+15) — the engine
  - 2 cots on a direct booking → one 10 € line, `finalPrice` +10.
  - Price independent of the stay length; no cot → no line; a caller that ignores `babyBeds` prices
    exactly as before.
  - Per-property override 8 € → 16 €; per-property 0 → no line.
  - Airbnb → the line lands in the Complément (rule 6).
  - « Offrir » → 0 € billed, `originalTotalPrice` 10 (rule 8).
  - Grandfathered `bookingId` → no line, total unchanged, even when the count is raised (rules 10-12).
  - Never billed twice when a caller also sends the option in `selectedOptions`.
- [x] `tests/baby-bed-supplement-seed.unit.test.js` (+8) — the seed
  - First boot seeds one 5 € row linked to every property; re-boot never duplicates nor rewrites it;
    a renamed/re-priced row survives; a property created later is linked; a wiped `seedKey` is
    re-stamped; a hand-made « Lit bébé » is reported, never hijacked; an unmigrated schema is skipped;
    an archived supplement is not resurrected.

### Client tests — **+6, all green** (`cd client && npx vitest run` → 1016 passing)

- [x] `components/__tests__/GuestsBedsSection.baby-bed.test.jsx` (+3): the price shows beside the
  availability; no cot option or a 0 € one → availability alone, no invented price.
- [x] `components/reservation/__tests__/ExtrasSection.baby-bed.test.jsx` (+3, new): no billed cot →
  no row (including the grandfathered case, cots on the booking but nothing billed); a billed cot →
  the per-cot caption, « Ajout automatique » and a disabled Switch; no « seuil nuit complète ».

### E2E — `npm run test:e2e` → **65 passed, 1 skipped** (no regression, no dedicated scenario added).

### Manual UI verification (2026-08-20, local dev, Chrome)

- [x] New direct reservation, 1 bébé + 1 lit → « Lit bébé — 5,00 € » in the récapitulatif, total
  303,60 € → 308,60 €; helper text « Dispo restante: 3 · 5,00 € / lit ».
- [x] 2 cots → « Lit bébé ×2 — 10,00 € », total 313,60 €.
- [x] « Offrir » → « ✓ Offert », 10,00 € struck through, total back to 303,60 €.
- [x] Save → the line is persisted (`reservation_options`: qty 1, unitPrice 5, totalPrice 5,
  `finalPrice` 305); reopening shows exactly one line, not two.
- [x] **Non-retroactivity** on the real dev data: reservation #22211 (Abracadaroom, 1 cot stored,
  `finalPrice` 171,14) opened and re-priced → no line, no row, total untouched.
- [x] Public API: `POST /public/v1/quote` with `babyBeds: 1` → « Lit bébé ×1 — 5,00 € » in `options`;
  a visitor posting `{optionId: 33, quantity: 10}` still gets exactly one 5 € line (rule 18bis); the
  public options catalogue still exposes the row so the widget can read its price (rule 17).
- [x] Mobile 375px: the helper text fits on one line, the cot row reads cleanly, no horizontal scroll.
- [ ] WordPress widget rendered in a real WP install — not verifiable locally (no WP instance in the
  dev loop); the plugin change is limited to one i18n string + one lookup, and the price it displays
  was verified through the API above.

## 8. Out of scope

- Charging a cot **per night** or per baby — the price is per cot, for the stay (rule 3).
- Back-filling the supplement onto bookings already taken (explicitly refused, §3.3).
- Touching the « Lit bébé » **resource** row (the stock/availability object): it keeps holding the
  quantity, it is never billed. The supplement is an option; the two stay separate.
- The J-7 e-mail wording (« un lit bébé vous est fourni ») — still accurate, the cot *is* provided; a
  price mention there is a separate copy decision.
- A generic « auto-option driven by a reservation field » framework. This spec adds one typed case
  beside the two existing ones; a third would be the moment to generalise.

## 9. Open questions

- **Q:** Does the supplement apply on platform reservations (Airbnb, Booking) or only on own channels?
  - **A (2026-08-19):** every channel — the cot is a service GuestFlow provides whoever sold the stay.
    On a platform it is collected on site through the Complément, and « Offrir » covers the case where
    the channel already includes it.
- **Q:** The public widget advertises the cot as free. Charge on the site too?
  - **A (2026-08-19):** yes — one price everywhere, and the widget copy is corrected to show the real
    price served by the API.
- **Q:** What happens to reservations already saved with cots?
  - **A (2026-08-19):** nothing, ever. They are grandfathered (§3.3): the supplement only concerns new
    bookings, and existing ones where a cot is added after the fact.
- **Q:** On a grandfathered booking, should the Extras list still show the « Lit bébé » row?
  - **A (2026-08-20, found in manual verification):** no. It announced « 5,00 € par lit bébé » beside a
    récapitulatif that billed nothing. The row now follows the quote, not the counter (rule 9bis).
