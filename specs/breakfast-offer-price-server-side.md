# Breakfast offer price computed by the server

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `docs/breakfast-offer-price-server` |
| **Created** | 2026-10-24 |
| **Author** | Adrien |
| **Related PR** | #767 |

---

## 1. Context

The arrival SAS (`client/src/plugins/sas/ReservationSasDialog.jsx`, plugin `sas`) sells the breakfast
at the door in two pages ([sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md)
§3.1): the **offer** page (`breakfastSale` — « Le client n'a pas pris le petit déjeuner. Tarif :
8,00 € par personne et par matin — 16,00 € le matin pour 2 pers. ») then the **mornings** page
(`breakfastMornings` — the candidate mornings, the « Personnes servies » stepper, « Quantité : 4
(2 × 2 pers. servies) » and « 4 petits déjeuners — 32,00 € »).

[sas-arrival-total-server-side.md](sas-arrival-total-server-side.md) (#759, Implemented) moved the
recap and the sale-step **totals** to the server's preview. It left the offer price out on purpose
(its §8: « the offer prices shown before a sale … on the breakfast offer page »). The owner's rule
([CLAUDE.md](../CLAUDE.md) §6.0, restated 2026-10-23): **the front only displays money, it never
computes it**, so that a figure is the same wherever it is read.

### 1.1 What is still computed in the client

`git grep -n -i -E "breakfast|petit-d[ée]j" client/src` and every `price × persons × nights` path
were read. The breakfast money and the quantity rule behind it are still derived in React in exactly
these places:

| # | Where | What it computes | Kind | Consumer |
|---|---|---|---|---|
| C1 | `ReservationSasDialog.jsx:1308` | `perMorning = Math.round(bf.unitPrice × (bf.perPerson ? salesPersons : 1) × 100) / 100` | **money** + rounding | « — 16,00 € le matin pour 2 pers. » (`:1314`) |
| C2 | `ReservationSasDialog.jsx:1326-1327` | `served = servedFor(bf, breakfastServed)`; `units = chosen × (bf.perPerson ? served : 1)` | billed-quantity rule | « Quantité : **4** (2 × 2 pers. servies) » (`:1336-1339`) and « **4** petits déjeuners — » (`:1360`) |
| C3 | `ReservationSasDialog.jsx:725` | `servedFor = max(1, picked ‖ defaultPersons ‖ salesPersons ‖ 1)` | partial copy of `resolveServedPersons` (no ceiling) | C2, the stepper value, the draft's `persons` |
| C4 | `ReservationSasDialog.jsx:733-734` | `units: occurrences.length × (bf.perPerson ? persons : 1)` in `soldSelections` | billed-quantity rule | nothing: `arrivalDraft.js:36-38` sends `{ occurrences, persons }` for a card option, `units` never leaves the dialog |
| C5 | `ReservationSasDialog.jsx:742-743`, `:1382-1385` | the same rule for the « Restauration » card options (meals) | billed-quantity rule | « Quantité : 6 (3 × 2 pers. servies) = 150,00 € » (`:1429-1431`) |

The amounts that sit **next to** C2 and C5 already come from the server (`saleAmount(optionId)` reads
`recap.sales`, `:793-798`), so today the page can show « **6** petits déjeuners — 48,00 € » where `6`
was counted by React and `48,00 €` was priced by the server. C3 has no ceiling where the server's
`resolveServedPersons` (`server/src/utils/pricing.js:350`) clamps to `max(1, party, maxGuests)`: the
stepper's `max` hides the gap, the arithmetic does not.

What is **not** money and stays as is: the breakfast composition pre-fill (`breakfastFoodFor`,
`:924-927`, counts of pastries and bread), the coherence warning's head count
(`breakfastPersons`, `:1104-1106`), the planning cards and the prep popup (counts only), the
reservation form's `OptionRow` hint « 8,00 € par pers./jour • ×2 pers. ×2 j. » (`OptionRow.jsx:211-
213`, no amount; its « Total » chip already reads the server quote's `totalPrice`, `:347`), and the
public website (`integrations/wordpress/…/view.js`), which renders the server quote.

### 1.2 Where the server already prices it

- `server/src/utils/sasOptionSale.js` — `priceOptionSale` (`:53`) is the one function that prices a
  SAS sale, with the engine's arithmetic: a card option bills `moments × served` units when it is
  per-person (`:71`, same rule as the `showsPlanningCard` branch of `pricing.js`), `round2` on the
  unit price and on the total (`:22`, `:57`, `:79`). `buildOptionOffer` (`:107`) shapes the offer
  (`unitPrice` effective for the property, `perPerson`, `defaultPersons`, `selectedPersons`,
  `maxPersons`, candidate mornings); `buildSasSaleOffers` (`:166`) builds the breakfast block (`:209-223`).
- `server/src/plugins/sas/controller.js:228` `saleOffersFor` serves it as `sasSales` in
  `GET /api/reservations/:id/sas` (`:382`), and `arrivalRecap.js:16` `salesBlock` answers
  `sales.breakfast = { optionId, units, amount }` in the preview, from the planned sold line
  (`reservationsModel.js:2408-2409`: `qty = billedUnits`).
- **Precedent on the same dialog:** the bath-linen offer page already renders a server figure —
  `getSasUpsellOptions` (`reservationsModel.js:2085-2123`) returns `totalPrice` and `persons`, and the
  page prints « Tarif : 24,00 € (2 pers × 12,00 €) » verbatim (`ReservationSasDialog.jsx:1301`).

### 1.3 Rounding and VAT

- Amounts are **euros TTC**, rounded to the cent by `round2` (`sasOptionSale.js:22`), the same
  formula as `roundMoney` (`pricing.js:29`). The total of a sale is `round2(unitPrice × billedUnits)`,
  never a sum of rounded per-morning figures.
- Option prices are entered TTC under the **single global VAT rate** (`app_settings.vatRate`, default
  10 %, [single-vat-rate.md](single-vat-rate.md) rule 1; `getGlobalVatRate`, `pricing.js:1243`). The
  VAT is extracted at quote/accounting level, never on a line shown to the operator. The tourist tax
  bites on the nights per adult, not on options. **The breakfast offer therefore carries no tax
  figure**, and this spec adds none.

## 2. Goal

Every figure on the two breakfast pages of the arrival SAS — the price of one morning, the number of
breakfasts, the covers served and the amount — is the one the server computed, rendered verbatim, so
that what the operator announces at the door is what the commit bills.

---

## 3. Functional rules

### 3.1 The offer page

1. **The offer carries its price for one morning.** `buildSasSaleOffers` adds to the breakfast block
   `perMorning: { persons, amount }`, where `amount` is `priceOptionSale(option, { …, occurrences:
   [first candidate morning], servedPersons: persons }).totalPrice` — the very function the sale is
   billed with, applied to one morning. No second formula.
2. **`perMorning.persons` is the covers the offer is for**: `selectedPersons` (the party on a first
   run, this SAS's own number when a committed check-in is re-opened —
   [card-option-served-persons.md](card-option-served-persons.md) §3.3 rule 11), resolved by
   `resolveServedPersons`. For a breakfast that is not per-person, `persons` is `null` and `amount`
   is the unit price.
3. **No morning, no figure.** When the breakfast is not `available` (no candidate morning, no
   billable person, not a card option), `perMorning` is `null` and the offer page is not shown, as
   today.
4. **The offer page renders, it does not compute.** « Tarif : **{unitPrice}** par personne et par
   matin — {perMorning.amount} le matin pour {perMorning.persons} pers. » reads both fields from the
   payload. `ReservationSasDialog.jsx` loses C1: no `Math.round`, no `×`, no `salesPersons` in a price.
   The wording « par personne et par matin » / « par matin » stays a client string chosen by
   `perPerson` (presentation, not money).

### 3.2 The mornings page

5. **The preview answers the quantity, not only the amount.** `sales.breakfast` of the arrival
   preview becomes `{ optionId, moments, servedPersons, units, unitPrice, amount }`, read from the
   planned sold line (`cardOccurrences.length`, `servedPersons`, `billedUnits`, `unitPrice`,
   `totalPrice`). When nothing is sold yet, `moments`/`units`/`amount` are 0 and `servedPersons` is
   the offer's `selectedPersons`.
6. **The mornings page renders the preview.** « Quantité : {units} ({moments} × {servedPersons} pers.
   servies) » and « {units} petits déjeuners — {amount} » read the latest preview. C2 is removed;
   `units` disappears from the breakfast entry of `soldSelections` (C4) — the draft already sends
   intent only (`{ optionId, occurrences, persons }`).
7. **What the operator types stays local.** The ticked mornings and the « Personnes servies » stepper
   are UI state: the checkbox and the stepper's own number move on press. `servedFor` (C3) survives
   only as the stepper's initial value and the draft's `persons` intent; it no longer feeds any
   displayed figure.
8. **Guests changed while typing → the existing preview loop.** A tick or a stepper tap is a draft
   change: the preview of [sas-arrival-total-server-side.md](sas-arrival-total-server-side.md) rules
   17-18 applies unchanged — 200 ms without a further change, one request, the previous one aborted,
   an answer that is not the latest discarded. No price table is shipped: the preview already prices
   every possible draft with the commit's own code, and a table would be a second source.
9. **Between two answers, the last server figures stay, dimmed.** Quantity and amount keep the latest
   answer at 55 % opacity (rule 19 of the same spec) until the newer one lands. « — » before any
   answer. No client estimate is ever shown, not even for the count.
10. **A failed preview hides the figures, not the controls.** On a network error or a 5xx, quantity
    and amount read « — » and the line « Montant indisponible — Réessayer » appears under them; the
    mornings and the stepper stay usable, « Suivant » stays enabled (the recap re-asks and blocks
    « Valider », rule 20 of the same spec).
11. **The ceiling is the server's.** `servedPersons` in the answer is `resolveServedPersons`'s
    `served` (clamped to `max(1, party, maxPersons)`). When it differs from the number typed (a stale
    stepper `max`), the page shows the server's and the stepper is reset to it.

### 3.3 Contract hygiene

12. **Additive payloads, one archive.** `perMorning` and the new `sales.breakfast` fields are
    additions; the client and the server ship together, so no fallback is kept for an answer without
    them. `sasOptionSale` gains no export: SDK stays `2.0.0`. The `sas` plugin's version is bumped
    (minor) with a French changelog line (plugins-phase-4-registry.md rule 28).
13. **The reception role sees the same figures.** The breakfast price is door money: `perMorning` and
    `sales.breakfast` are served to the reception role like `sasSales` today; no revenue field is
    added.

**Edge cases:**
- Property override of the breakfast price (9,50 € instead of 8,00 €) → `unitPrice` 9,50 and
  `perMorning.amount` 19,00 for 2 pers.: the override is applied before `priceOptionSale` (it already
  receives effective prices from `optionsModel.listForProperty`).
- Breakfast priced `per_night` (not per person), 12,00 € → « 12,00 € par matin », no « le matin pour
  … » clause (`perMorning.persons = null`).
- Re-opened SAS where 3 of 4 guests took breakfast → offer « 24,00 € le matin pour 3 pers. ».
- Every morning unticked → preview `units = 0`, `amount = 0`; the existing warning « Aucun matin
  sélectionné » stays.
- Preview answering after the dialog closed or after « Précédent » → ignored (sequence guard).

---

## 4. Architecture

> **Fat backend, thin frontend.** What remains client-side is the draft (ticks, stepper) and the
> preview plumbing that already exists. Nothing in this spec adds logic to `client/`.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `sasOptionSale.js` | T | `buildSasSaleOffers` adds `perMorning` to the breakfast block, priced by `priceOptionSale` on one candidate morning (rules 1-3). No new export. |
| `models/` | `reservationsModel.js` | T | `planArrivalSas` keeps `cardOccurrences.length` and `servedPersons` on each planned sold line (today only `qty`/`unitPrice`/`total`, `:2408-2409`). |
| `plugins/sas/` | `arrivalRecap.js` | T | `salesBlock` answers `{ optionId, moments, servedPersons, units, unitPrice, amount }` for the breakfast (rule 5); unsold → `servedPersons` from the offer. |
| `plugins/sas/` | `controller.js` | — | Unchanged: `saleOffersFor` already serves `buildSasSaleOffers`. |
| `plugins/sas/` | `manifest.json` | T | `1.2.0 → 1.3.0`, changelog line « Le prix du petit déjeuner proposé à l'arrivée vient du serveur. » |
| `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | Remove C1 (`:1308`) and C2 (`:1326-1327`), drop `units` from the breakfast `soldSelections` entry (C4); render `bf.perMorning` and `recap.sales.breakfast` (quantity line, total line, dimmed / « — » / « Montant indisponible » states); reset the stepper to a clamped `servedPersons` (rule 11). |
| `plugins/sas/` | `useArrivalRecapPreview.js` | — | Unchanged: it already debounces, aborts and keeps the latest answer. |
| `plugins/sas/` | `arrivalDraft.js` | — | Unchanged: card options already send intent only. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `OccurrenceGrid`, `CountStepper` (local), `ErrorAlert` pattern of `RecapPreviewError` | Same visuals; `OccurrenceGrid.quantityText` already takes a node. |
| **Created (new generic)** | — | — |
| **Specific (kept feature-local)** | — | — |

### 4.3 API contract

| Method | Endpoint | Change | Notes |
|---|---|---|---|
| GET | `/api/reservations/:id/sas` | `sasSales.breakfast.perMorning: { persons: number \| null, amount: number } \| null` | admin + reception |
| POST | `/api/reservations/:id/sas/arrival/preview` | `sales.breakfast: { optionId, moments, servedPersons, units, unitPrice, amount } \| null` | same body, same guards as #759 |

```jsonc
// GET …/sas — sasSales.breakfast (excerpt)
{ "available": true, "optionId": 6, "unitPrice": 8.00, "priceType": "per_person_per_night",
  "perPerson": true, "defaultPersons": 2, "selectedPersons": 2, "maxPersons": 5,
  "mornings": [{ "date": "2027-07-11", "time": "09:00", "slot": 0 }, { "date": "2027-07-12", "time": "09:00", "slot": 0 }],
  "perMorning": { "persons": 2, "amount": 16.00 } }

// POST …/sas/arrival/preview — sales.breakfast
{ "optionId": 6, "moments": 2, "servedPersons": 3, "units": 6, "unitPrice": 8.00, "amount": 48.00 }
```

---

## 5. Data model

No schema change, no migration. Nothing stored changes: the commit already bills through
`priceOptionSale`; this spec only exposes figures it already computes.

**Data impact:** none.

## 6. UI / UX

The two pages look the same; their figures change source.

- **Offer page** — « Tarif : **8,00 €** par personne et par matin — 16,00 € le matin pour 2 pers. »
  then « 2 matins possibles sur ce séjour. » Static: the payload is loaded with the SAS, no pending
  state.
- **Mornings page** — under the grid, « Quantité : **4** (2 × 2 pers. servies) » and, after the
  divider, « **4 petits déjeuners — 32,00 €** ». After a tick or a stepper tap: the tick and the
  stepper number move at once; quantity and amount keep their last value at 55 % opacity until the
  answer (no layout shift: `tabular-nums`). Before the first answer: « — ».
- **Error** — quantity and amount « — », then « Montant indisponible » with a « Réessayer » text
  button (44 px target), in `error.main` on 8 % `error.main`. Controls stay enabled.

Copy stays short and impersonal (no « vous »), nothing about the mechanics.

**Responsive:** the SAS is a full-screen dialog on `xs` (the operator at the door with a phone): the
quantity line wraps under the grid, the stepper and « Réessayer » are 44 px targets, « Suivant » stays
in the thumb footer. `md` / `lg`: unchanged layout, same states.

**Page action bar:** not applicable — the SAS is a dialog, not a page.

## 7. Test plan

Figures reuse the SAS fixtures (`client/src/plugins/sas/__tests__/sasFixtures.jsx`, `BREAKFAST_OFFER`:
8 €/pers., 2 mornings, party 2, capacity 5).

### Server unit tests

- [ ] `server/src/tests/breakfast-offer-price.unit.test.js` (rules 1-3, 5, 11, 12):
  - 8,00 € per person, party 2 → `perMorning = { persons: 2, amount: 16.00 }`;
  - property override 9,50 €, party 3 → `28.50`;
  - 7,35 €, party 3 → `22.05` (float `22.049999…` rounded by `round2`, not truncated);
  - `per_night` 12,00 € → `{ persons: null, amount: 12.00 }`;
  - re-opened SAS with `cardPersons = 3`, party 4 → `{ persons: 3, amount: 24.00 }`;
  - no candidate morning → `perMorning = null`, `available = false`;
  - `perMorning.amount` equals `priceOptionSale(…one morning…).totalPrice` for the same inputs (parity).
- [ ] `server/src/plugins/sas/tests/sas-breakfast-sales-block.unit.test.js` (rules 5, 11, 13):
  - 2 mornings × 2 pers. → `{ moments: 2, servedPersons: 2, units: 4, unitPrice: 8, amount: 32.00 }`;
  - party 4, served 3 → `units 6`, `48.00`;
  - served 9 asked, capacity 5 → `servedPersons 5`, `units 10`, `80.00`;
  - nothing ticked → `units 0`, `amount 0`, `servedPersons` = the offer's;
  - reception role → same `sales.breakfast`.
- [ ] Existing `sas-arrival-plan.unit.test.js`, `sas-arrival-preview.unit.test.js` and
  `sas-option-sales.unit.test.js` suites green unchanged.

### Client tests (Vitest)

- [ ] `ReservationSasDialog.breakfast-offer-price.test.jsx` (rules 4, 6, 7, 9, 10):
  - the offer page prints a server figure the client could not have computed (payload `perMorning:
    { persons: 2, amount: 15.90 }` with `unitPrice: 8`) → « 15,90 € le matin pour 2 pers. »;
  - the mornings page shows the preview's « Quantité : 6 (2 × 3 pers. servies) » and « 6 petits
    déjeuners — 48,00 € » (fake answering those figures);
  - a stepper tap leaves the old figures dimmed until the answer, then shows the new ones;
  - preview error → « — » and « Montant indisponible », the stepper still enabled.
- [ ] `ReservationSasDialog.catering.test.jsx`: the existing assertion « 6 petits déjeuners — 48,00 € »
  is awaited on the preview (`sasPreviewFake.js` answers the new fields).

### Manual UI verification

- [ ] Fictional stay, 2 mornings, party 4: offer « 32,00 € le matin pour 4 pers. »; mornings page,
  stepper 4 → 3: « Quantité : 6 (2 × 3 pers. servies) », « 48,00 € »; recap total consistent.
- [ ] Slow server (1,2 s injected): figures dimmed, controls live. Offline: « Montant indisponible »,
  « Réessayer » restores the figures.
- [ ] 375, 900 and 1280 px; regression: catering page and recap unchanged.

## 8. Out of scope

- **The catering card options' quantity** (C5): same rule, same fix — see §9 Q1.
- The breakfast composition pre-fill (`breakfastFoodFor`) and the coherence warning: counts of food,
  not money.
- The reservation form's option hints (« ×2 pers. ×2 j. ») and `quantityPersons` / `quantityNights`
  in `ReservationPage.jsx:3106-3125`: quantities of the whole extras form, a separate spec.
- The departure recap (`sas-departure-total-server-side`, announced by #759).
- Any change to what is billed: `priceOptionSale` is not modified.

## 9. Open questions

All three resolved on 2026-10-24: the owner accepted the default of each.

- **Q1 — Resolved (2026-10-24): yes.** Rules 5-6 apply to the « Restauration » card options (C5) in the
  same PR. `salesBlock` shapes the breakfast and every catering line the same way; the meal's
  « Quantité : N (m × p pers. servies) = amount » reads the preview. A non-card option keeps the
  operator's own quantity (an input, not a computation).
- **Q2 — Resolved (2026-10-24): this SAS's number.** On a re-opened SAS, `perMorning.persons` is the
  covers already chosen (`selectedPersons`), so the offer announces what was actually sold.
- **Q3 — Resolved (2026-10-24): « Suivant » stays enabled** when the preview fails; the recap blocks
  « Valider » until a fresh answer.

## 10. Implementation notes

- `plan.lines` of `planArrivalSas` carry `moments` and `servedPersons` for a sold line; the recap
  strips them from `lines` and exposes them in `sales` only.
- `servedFor` in the dialog is capped like the server (`min(…, max(1, party, maxPersons))`); the
  stepper follows the server's `servedPersons` once a fresh answer differs (rule 11).
- The error banner (« Montant indisponible » + « Réessayer ») is also shown under « Total
  restauration » (same states as the mornings page).
- `sas` plugin `1.2.0 → 1.3.0`; tests: `breakfast-offer-price.unit.test.js` (8),
  `sas-breakfast-sales-block.unit.test.js` (5), `ReservationSasDialog.breakfast-offer-price.test.jsx` (7).
