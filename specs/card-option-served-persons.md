# Card options — how many people are actually served

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/card-option-served-persons` _(Claude-managed)_ |
| **Created** | 2026-08-20 |
| **Approved** | 2026-08-20 |
| **Author** | Adrien |
| **Amends** | [sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md) §3.1-§3.3 + §4.3, [option-planning-card.md](option-planning-card.md) §3.4, [breakfast-option-planning-card.md](breakfast-option-planning-card.md) rule 3, [arrival-departure-sas.md](arrival-departure-sas.md) §3.7 |
| **Related PR** | _(opened at the end of implementation)_ |

---

## 1. Context

A **card option** (`options.showsPlanningCard = 1`) is billed by the **moments** it is served on. When
its price type is per-person, the pricing engine bills the whole party, always
([pricing.js:1514](../server/src/utils/pricing.js#L1514)):

```
billedUnits = moments × persons        // persons = adults + teens + children (babies never count)
quantity    = moments
```

Two options are configured that way today, both in the « Restauration » category and both
`per_person_per_night`:

| Option | Price | Card |
|---|---|---|
| **Petit déjeuner** (`autoOptionType = 'breakfast'`) | 8,00 €/pers./matin | `once_per_day`, 09:00 |
| **Le repas des trappeurs** | 25,00 €/pers./repas | `multiple_per_day`, 12:00 + 19:30 |

Since [sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md) the arrival SAS can
sell both at the door: the operator ticks the moments and the money joins the arrival complement.

**The limitation this spec removes:** the number of covers is not a decision anybody can make. A party
of 4 that takes one « repas des trappeurs » is billed 4 × 25 € = 100 €, and the planning card tells the
kitchen to prepare 4 plates — even when the two children are not eating and the guests only asked for
2 covers. Today the operator has exactly two ways out, both wrong:

- sell the real number as a **custom line** (« Repas × 2 = 50 € ») → no planning card, no prep, no
  counter: the kitchen never learns the meal exists;
- accept the over-billing and argue at check-out.

The same hole exists for the breakfast: children who don't have breakfast are billed anyway. The old
lever for that case — a **fractional quantity** on the fiche (`0.6667` = « 2 of 3 want breakfast »,
still honoured by [breakfastModel.js:130](../server/src/models/breakfastModel.js#L130)) — died when the
breakfast became a card option: the moments now drive the quantity, so there is no fraction to type.

## 2. Goal

When a prestation is served **per person** on a planning card — a meal, a breakfast — the operator can
say **how many people are actually served**, at the check-in as well as on the fiche. The price, the
planning card and the kitchen prep all follow that number instead of the party size.

## 3. Functional rules

### 3.1 The number itself

1. Every reservation line of a **per-person card option** carries a **served-persons count**:
   `reservation_options.cardPersons`. `NULL` means « the whole party » — the behaviour of every line
   that exists today, unchanged.
2. **Billed quantity** (server, authoritative):
   ```
   served      = cardPersons ?? billablePersons(reservation)
   billedUnits = moments × served
   quantity    = moments                     // unchanged: the moment count stays the base
   totalPrice  = unitPrice × billedUnits
   ```
   Nothing else in the money chain changes: the acompte/complément routing, « offert », the free units
   and the price lock all keep reading `billedUnits` / `totalPrice` as they do now.
3. **Bounds** (server clamps, the client only helps): `1 ≤ cardPersons ≤ property.maxGuests`. The
   maximum is the **capacity of the property** — not the party — so an extra guest invited to dinner can
   be served (decision 2026-08-20). When `maxGuests = 0` (capacity not configured,
   [capacity.js:19](../server/src/utils/capacity.js#L19)) the bound falls back to the party size. A
   value ≤ 0 is refused; **removing a prestation is done by unticking its moments, never by serving 0
   person**.
4. **A count equal to the current party size is stored as `NULL`** — the line keeps *following* the
   party, so correcting « adultes / enfants » later still re-prices it. Only a deliberately different
   number is persisted, and it then **stays put** when the party is edited (it is an operator decision,
   not a derived value).
5. A card option that is **not** per-person (`per_stay`, `per_night` + a card) has no served count: its
   `billedUnits` is the moment count and the control is not rendered.
6. `cardPersons` is **not** a guest count: it never touches the occupancy guard, the tourist tax, the
   linen counters or the beds. It is the size of one serving.

### 3.2 On the fiche

7. On an enabled per-person card option, the reservation form shows a **« Personnes servies »** stepper
   where the « Qté » field is deliberately blanked out for card options
   ([OptionRow.jsx:248](../client/src/components/reservation/OptionRow.jsx#L248)). Default = the party
   size; range = rule 3.
8. The quantity caption under the moment grid names it: « Quantité : **4** (2 × 2 pers. servies) »
   (today: « (2 × 4 pers.) »).
9. Editing the stepper re-prices the line live like any other quantity edit (the same `/quote` preview
   round-trip), and is saved with the fiche. A locked reservation (`isReservationLocked`) disables it
   like every other field.
10. **Devis parity** — a quote carries the served count exactly like it carries the moments; the
    devis → réservation conversion (and back) copies it verbatim, and the PDF shows the quantity it
    priced ([devis-extras-parity-and-price-lock.md](devis-extras-parity-and-price-lock.md)).

### 3.3 At the check-in (arrival SAS)

11. **Page « Quels matins ? »** (breakfast) and **page « Restauration »** (each card option) gain the
    same stepper, right under the moment grid: « Personnes servies », pre-filled with the party size —
    or with what **this** SAS already sold when a committed check-in is re-opened
    ([reopen-completed-sas.md](reopen-completed-sas.md)).
12. The intent the wizard sends gains the count — still no price, ever
    ([CLAUDE.md](../CLAUDE.md) §6.0):
    `soldOptions: [{ optionId, occurrences: [{date,time}], persons }]`. The server resolves the option,
    its per-property price, clamps `persons` (rule 3) and writes `cardPersons`.
13. The amounts shown on the sale pages and on the recap remain a **preview** (« Quantité : 2 (1 × 2
    pers. servies) = 50,00 € ») — the server re-prices every line at commit, exactly as today.
14. Re-running the SAS **replaces** the sale, so changing the served count on a re-open re-prices the
    line and moves the complement by the delta — it never stacks a second line
    ([sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md) §3.3 rule 11).
15. The check-in history line « **Prestations vendues au check-in** » spells the count out:
    « Le repas des trappeurs — 1 moment × 2 pers. servies = 50,00 € ».

### 3.4 What the kitchen and the planning see

16. **Breakfast prep follows the sale**: the morning head count served by
    [breakfastModel.js](../server/src/models/breakfastModel.js) (`persons` on the breakfast card, on the
    SAS breakfast page and in the planning summary) is `cardPersons ?? party` for a card-driven
    breakfast. The legacy fractional-quantity rule for non-card breakfasts is untouched.
17. **Composition pre-fill** of a breakfast sold at check-in (viennoiseries = 1/pers., ½ baguette/pers.,
    [sas-breakfast-bread-and-push.md](sas-breakfast-bread-and-push.md) rule 3) is derived from the
    **served** count, not from the party. The operator can still adjust every counter — the committed
    composition is stored verbatim.
    17.bis The covers are picked on the mornings page, i.e. **after** accepting the sale, so the pre-fill
    **follows the stepper** as long as the operator has not typed their own counts; the first manual edit
    takes ownership and nothing is re-seeded afterwards.
    17.ter The coherence warning of the composition page (« Quantités ≠ personnes ») compares against the
    **number of breakfasts sold**, not the party — otherwise selling 3 breakfasts to a table of 10 would
    warn every time. A breakfast already booked keeps comparing against the count the server resolved
    (which honours `cardPersons` too, rule 16).
18. **The planning card of a card option** shows the served count when it differs from the party — a
    highlighted chip « **2 couverts** » beside the client name, next to the existing
    « Adultes / Enfants / Ados / Bébés » chips
    ([OptionDayCard.jsx](../client/src/components/OptionDayCard.jsx)). Without an explicit count the card
    is unchanged. This is the whole point of the feature: the cook must read the real number.

**Edge cases:**

- Party edited after an explicit count was set → the count stays (rule 4); the fiche shows it, so the
  operator sees why the quantity is 2 and not 6.
- Served count > party (a friend joins for dinner) → allowed up to the property capacity; nothing else
  in the reservation moves (rule 6).
- Legacy lines (`cardPersons IS NULL`) → billed exactly as today. **No backfill, no re-pricing of any
  existing reservation.**
- Public/site booking flow (`planningCardAsQuantity`, the visitor cannot schedule moments) → no control,
  count stays `NULL`; the operator sets it when scheduling the real slots.
- Welcome-pack auto options and every non-per-person card option → `NULL`, untouched.
- Sale on a **frozen** arrival complement → unchanged route
  ([sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md) §3.4): the line is
  written with its served count and the money joins the end-of-stay complement.
- Property capacity not configured (`maxGuests = 0`) → the stepper stops at the party size (rule 3).

---

## 4. Architecture

> **Fat backend, thin frontend.** The served count is clamped, persisted and turned into money by the
> server alone. The engine is the only place that computes `billedUnits`; the client renders the
> stepper, keeps its value in form/wizard state and sends it as intent. The two client-side
> multiplications this spec adds (the sale-page preview amount and the breakfast composition pre-fill)
> are **previews of a server-declared rule**, the same contract the SAS sale pages already have — the
> committed figures are re-derived server-side.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: `reservation_options.cardPersons REAL NULL` (§5). |
| — | `schema.sql` | T | Column added to the reference schema. |
| `utils/` | `utils/pricing.js` | T | Card branch: `served = clamp(selected.cardPersons ?? persons, 1, maxGuests \|\| persons)`, `billedUnits = moments × served`, and `cardPersons` echoed on the priced line so it round-trips through every writer. `percent_of_stay` + `planningCardAsQuantity` branches untouched. |
| `utils/` | `utils/sasOptionSale.js` | T | `priceOptionSale` accepts `servedPersons` (+ `maxPersons` for the clamp) and returns `cardPersons`; `buildOptionOffer` exposes `defaultPersons` / `maxPersons` / `selectedPersons`; `defaultBreakfastComposition` keyed on the served count, with the per-person rule exposed for the wizard's pre-fill. |
| `models/` | `models/bookingLinesModel.js` | T | `insertOptions` writes `cardPersons` (guarded by column presence) and the line readers return it — this single point covers fiche saves, devis, and `copyLineGraph` (devis ↔ réservation conversions). |
| `models/` | `models/reservationsModel.js` | T | `resolveSasOptionSales` reads `properties.maxGuests` and passes the served count to the pricer; the SAS `writeSoldOptions` upsert writes `cardPersons`; `listSasArrivalOptionLines` returns a `detail` string for the history; `getByIdWithDetails` surfaces `propertyMaxGuests` (the stepper's ceiling, read by the SAS controller). |
| `models/` | `models/devisModel.js` | T | Both engine inputs (a devis being saved, a persisted devis being recomputed) forward `cardPersons` beside `cardOccurrences` — dropping it would re-bill the whole party on every recompute. |
| `models/` | `models/breakfastModel.js` | T | `morningPersons` for a card-driven breakfast = `COALESCE(ro.cardPersons, party)`; the column joins the SELECTs (guarded). |
| `models/` | `models/planningOptionCardsModel.js` | T | Card items gain `servedPersons` (`null` when the line follows the party). |
| `utils/` | `utils/sasAudit.js` | T | « Prestations vendues au check-in » names the served count. |
| `controllers/` | `controllers/sasController.js` | T | Passes the property capacity into `buildSasSaleOffers`; `commitArrival` forwards `soldOptions[].persons` (payload already passed through verbatim). |
| `routes/`, `middleware/`, `scheduledTasks.js` | — | — | (none) |

**Notes**

- `reservationsController` needs no change: `selectedOptions` reaches the engine verbatim, so the new
  field rides along and is validated in the engine (single clamp, single truth).
- Every new read is guarded by a `PRAGMA table_info` check, like `cardOccurrences` and
  `sasArrivalOrigin`, so the minimal test schemas keep working.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/ReservationPage.jsx` | T | `setOptionCardPersons(optionId, n)` setter (twin of `setOptionCardOccurrences`, same welcome-pack release), exposed on the form context; both payload builders (live preview + save) send `cardPersons`. |
| `components/` | `components/reservation/OptionRow.jsx` | T | « Personnes servies » `QuantityField` for a per-person card option + the new quantity caption. |
| `components/` | `components/sas/ReservationSasDialog.jsx` | T | Served-count `CountStepper` on the breakfast-mornings page and per card option on the « Restauration » page (the local `CountStepper` gains optional `min`/`max`, defaults unchanged for the composition counters); `persons` in `soldOptions`; preview amounts, the composition pre-fill (re-seeded while untouched, rule 17.bis) and the coherence warning (rule 17.ter) all follow the covers. |
| `components/` | `components/OptionDayCard.jsx` | T | « N couverts » chip when `servedPersons` is set. |
| `utils/` | `utils/bookingFormHydration.js` | T | Hydrates `cardPersons` onto the form line. |
| `utils/` | `utils/applyQuoteToForm.js` | T | Carries `cardPersons` when a quote is applied to the form (same treatment as `cardOccurrences`). |
| `pages/` | `pages/PlanningPage.jsx` | — | Unchanged: the card item is spread into `OptionDayCard`. |
| `hooks/`, `services/`, `constants/`, `styles/`, `api.js` | — | — | (none) |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `QuantityField` (fiche stepper, `min`/`max` clamping + mobile-friendly ± buttons), `OccurrenceGrid` (moment grid + quantity caption), `CountStepper` (SAS), MUI `Chip` | All pre-existing; the fiche and the SAS each already own the right control, so **no new component is needed**. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | The stepper placements inside `OptionRow` / `ReservationSasDialog` | They are one line of layout inside components that already own the option-row and wizard-page shapes. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/sas?mode=arrival` | — | `sasSales.breakfast` and each `sasSales.catering.options[]` gain `defaultPersons`, `maxPersons`, `selectedPersons`; `sasSales.breakfast.compositionPerPerson = { pastries: 1, bread: 0.5, … }` | The server decides the default and the ceiling. |
| POST | `/api/reservations/:id/sas/arrival` | `soldOptions: [{ optionId, occurrences: [{date,time}], persons }]` (card option) \| `[{ optionId, units }]` (other) | `{ ok, complementAmount }` | `persons` optional; absent → the party. Clamped server-side. |
| POST/PUT | `/api/reservations` · `/api/reservations/:id` · `/api/reservations/quote` · devis twins | `selectedOptions[].cardPersons: number \| null` | unchanged | Ignored for non-per-person / non-card options. |
| GET | `/api/planning/option-cards` | — | `items[].servedPersons: number \| null` | Feeds the « N couverts » chip. |
| GET | `/api/planning/breakfast` · `/api/reservations/:id/sas` (`breakfast.persons`) | — | unchanged shape, value now honours `cardPersons` | Rule 16. |

---

## 5. Data model

```sql
-- server/src/database.js — idempotent block, next to the cardOccurrences one
ALTER TABLE reservation_options ADD COLUMN cardPersons REAL;   -- NULL = the whole party
```

- **Nullable, no default**: `NULL` is the semantic « follows the party », which is what every existing
  row means today.
- **No backfill, no re-pricing.** Existing reservations, devis and their PDFs are byte-for-byte
  unchanged until an operator touches a served count.
- Reused as-is: `reservation_options.quantity` / `billedUnits` / `totalPrice` / `cardOccurrences`,
  `properties.maxGuests` (the ceiling), `reservations.complementAmount` (the SAS delta).

**Data impact:** purely additive. The only risk is a writer that forgets the column and silently
resets a served count to « the whole party » (a money bug) — mitigated by concentrating the writes in
`bookingLinesModel.insertOptions` + the SAS upsert, and by a unit test that saves a fiche twice and
asserts the count survives.

## 6. UI / UX

**Fiche — option card (`OptionRow`), per-person card option enabled**

```
┌────────────────────────────────────────────────────────────────┐
│ Le repas des trappeurs            25,00 € par pers. et par jour│
│                                                       [●] activée│
│ ┌ Personnes servies ─────┐              [Compl. ○]  [Total: 50 €]│
│ │  −    2    ＋           │                                      │
│ └────────────────────────┘                                      │
│ ven. 21  [12:00 ☐] [19:30 ☑]                                    │
│ sam. 22  [12:00 ☐] [19:30 ☐]                                    │
│ Quantité : 2 (1 × 2 pers. servies)                              │
└────────────────────────────────────────────────────────────────┘
```

- Label **« Personnes servies »**, helper text on the field: « Par défaut toute la tablée — baissez-la
  si tout le monde ne mange pas. »
- The stepper occupies the slot left empty by the hidden « Qté » field, so the row keeps its layout.

**SAS check-in**

- Page « **Quels matins ?** » — under the chips: the served stepper, then the recomputed line
  « 4 petits déjeuners — 32,00 € ». Caption: « Quantité : 4 (2 × 2 pers. servies) ».
- Page « **Restauration** » — one served stepper per card option, under its moment grid; the switch +
  quantity stepper of the non-card options (planches) are unchanged.
- Recap: unchanged shape, the amount simply reflects the served count.

**Planning**

- Meal card: chip « **2 couverts** » (filled, like the breakfast count chip) next to the client name,
  only when a served count is set. Breakfast card: its existing « N petits déjeuners » chip now shows
  the served number.

**Copy (French)**

| Where | String |
|---|---|
| Fiche + SAS stepper | « Personnes servies » |
| Fiche helper | « Par défaut toute la tablée — baissez-la si tout le monde ne mange pas. » |
| Quantity caption | « Quantité : 4 (2 × 2 pers. servies) » |
| Planning chip | « 2 couverts » |
| Check-in history | « Le repas des trappeurs — 1 moment × 2 pers. servies = 50,00 € » |

**Responsive**

- `xs` — the stepper is full-width above the moment grid (the option row already stacks
  `flexDirection: column`); the SAS dialog stays full-screen, ± buttons ≥ 44 px (`QuantityField` /
  `CountStepper` defaults); chips wrap. No horizontal scroll.
- `md` / `lg` — the stepper sits inline on the left of the option row, where « Qté » lives for
  non-card options; the SAS pages keep their single column.

**Sticky action bar** — not applicable: the change lives inside an option card of `ReservationPage`
(whose `PageActionBar` is unchanged) and inside the SAS dialog (a wizard, no bar).

## 7. Test plan

### Server unit tests — 30 new

- [x] `tests/pricing-option-planning-card.unit.test.js` (+9) — `cardPersons = 2` on a party of 4 bills
      `moments × 2`; `NULL` bills `moments × party` (no regression); a count equal to the party is stored
      as `NULL`; above the party is allowed up to `maxGuests`; above `maxGuests` clamps down;
      `maxGuests = 0` → the ceiling is the party; `0` / negative falls back to the party; a non-per-person
      card option ignores it; lowering the covers on a SOLD line keeps its locked unit price.
- [x] `tests/sas-option-sales.unit.test.js` (+11) — the offer exposes `defaultPersons` / `maxPersons` /
      `selectedPersons` / `compositionPerPerson`; a re-opened SAS pre-fills the covers it sold; the
      ceiling never drops below the party; pricing `moments × covers` (stored only when deliberate,
      clamped to the capacity, absent = the party); a fixed-price option ignores the covers; the commit
      stores them and moves the complement; a re-run with fewer covers re-prices without stacking;
      raising them back to the party clears the stored number; the history spells the covers out.
- [x] `tests/booking-lines-model.unit.test.js` (+4) — `cardPersons` is written, survives a fiche re-save
      (DELETE + INSERT) and a `copyLineGraph` (devis → réservation); a line that follows the party stores
      `NULL`; a minimal schema degrades instead of throwing.
- [x] `tests/breakfast-model.unit.test.js` (+2) — a card-driven breakfast with `cardPersons = 2` reports
      2 persons on the SAS page, the planning card and the day total; without it, the whole party. The
      legacy fractional-quantity path is untouched.
- [x] `tests/planning-option-cards-model.unit.test.js` (+2) — `servedPersons` returned when set, `null`
      otherwise (the party chips ride along either way).
- [x] `tests/sas-audit.unit.test.js` (+2) — « Le repas des trappeurs ×2 — 1 × 2 pers. servies (50 €) »,
      and no detail when the whole table is served.

### Client tests (vitest) — 15 new

- [x] `components/sas/__tests__/ReservationSasDialog.test.jsx` (+4, 51 → 55) — lowering the covers of a
      meal re-prices the preview, the recap and `soldOptions[].persons`; fewer breakfasts than guests
      drives the quantity, the amount AND the composition pre-fill (3 viennoiseries / 1,5 baguette);
      the stepper stops at the capacity; a re-opened SAS pre-fills the covers it sold. The 6 pre-existing
      sale tests were realigned on `compositionPerPerson` + `persons`.
- [x] `components/reservation/__tests__/ExtrasSection.served-persons.test.jsx` (new, 6) — the field
      renders for a per-person card option only, defaults to the party, shows the helper text and the
      caption, reports `setOptionCardPersons`, stops at the property capacity, and leaves a plain
      option's « Qté » field alone.
- [x] `components/__tests__/OptionDayCard.served-persons.test.jsx` (new, 3) — « 2 couverts » /
      « 1 couvert » / no chip when the party is served.
- [x] `utils/__tests__/bookingFormHydration.test.js` (+2) — the count comes back on the form line, and
      is absent when the line follows the party.

### Full suites

- [x] `cd server && npm test` — **3263 tests, 0 failure**.
- [x] `cd client && npx vitest run` — **1032 tests, 131 files, 0 failure**.
- [x] `npm run test:e2e` — **65 passed, 1 skipped** (a first run tripped on
      `tariff/recipe-apply.spec.js:138`, which passes in isolation and on re-run: flake, unrelated).
- [x] `cd client && npm run build` — clean.

### Manual UI verification (2026-08-20, Chrome + dev server)

- [x] Fiche (résa 22211, 3 pers., capacité 5): meal on one evening → « Personnes servies » 3 → 2 → live
      total 50 € and « Quantité : 2 (1 × 2 pers. servies) »; save → `cardPersons = 2`, `billedUnits = 2`;
      reload → the field reads 2; **save a second time → still 2** (the regression this spec exists for).
- [x] Planning 10/10: the meal card shows « 2 couverts » beside the client, party chips untouched.
- [x] SAS check-in (résa 12, 10 pers., capacité 10): breakfast on 2 of 5 mornings for 3 covers → « 6
      petits déjeuners — 48,00 € », composition pre-filled 3 viennoiseries / 1,5 baguette and the
      coherence line reading « pour 3 personnes »; meal for 2 of 10 → 50 €; recap « + Petit déjeuner :
      6 × 8,00 € = 48,00 € » + « + Le repas des trappeurs : 2 × 25,00 € = 50,00 € », total 98 €; commit →
      2 option lines with `cardPersons` 3 and 2, complément 98 €; planning: « 2 couverts » on the meal and
      « 3 petits déjeuners » (not 10) on both breakfast cards.
- [x] Re-open the committed SAS → the steppers show 2; lowering the meal to 1 and un-selling the
      breakfast → one line re-priced at 25 €, complément 98 € → 25 €, no duplicate line; history reads
      « Le repas des trappeurs ×2 — 1 × 2 pers. servies (50 €) → Le repas des trappeurs — 1 × 1 pers.
      servies (25 €) ».
- [x] « Quitter » on a sale page writes nothing.
- [x] Mobile 390 px: the fiche field is full-width with 44×44 ± buttons and no horizontal scroll
      (`scrollWidth` 375 ≤ 390); the SAS stepper sits on its own row, « + » disabled at the capacity.
- [x] Regression: the ceiling test (« + » disabled at 10 for the Gîte), a fixed-price card option shows
      no field, and the test data was reverted from the dev DB afterwards.

## 8. Out of scope

- **A different count per moment** (« 4 vendredi, 2 samedi ») — decision 2026-08-20: one count per
  prestation. The moment grid stays a pure yes/no per moment.
- Per-person **identity** (which guest eats) and per-guest menus.
- Serving more people than the property's capacity.
- Selling anything at **check-out**, and the drinks route (mid-stay notes) — unchanged.
- Any effect on occupancy, tourist tax, linen or bed counters (rule 6).

## 9. Open questions

All settled on 2026-08-20 (questionnaire):

- **Which prestations?** → the per-person card options: **the meals of the « Restauration » catalogue
  *and* the breakfast** (they are exactly the two card options configured today; the mechanism is
  generic in the engine).
- **Granularity?** → **one count per prestation**, all its ticked moments served the same number.
- **Where?** → **the fiche *and* the check-in SAS**: the fiche is the only place to correct after the
  fact, and it is what makes the reduced quantity explainable.
- **Ceiling?** → **1 → the property's maximum capacity** (`properties.maxGuests`), not the party size.
