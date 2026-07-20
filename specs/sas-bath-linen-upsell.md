# SAS arrival — bath-linen upsell (offer, price per person, settle now or at check-out)

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/sas-bath-linen-upsell` _(user-managed)_ |
| **Created** | 2026-07-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The **arrival SAS** ([ReservationSasDialog.js](../client/src/components/sas/ReservationSasDialog.js),
[sasController.js](../server/src/controllers/sasController.js), spec
[arrival-departure-sas.md](arrival-departure-sas.md)) already upsells **cleaning** when the reservation
didn't include it: the « Ménage » page shows the property cleaning price and, on « Ajouter le ménage »,
adds a line to the **arrival complement** ([reservationsModel.commitArrivalSas](../server/src/models/reservationsModel.js#L1111)).

**Bath linen** (« Linge de toilette ») is a catalogue option seeded with `autoOptionType = 'bathroom_linen'`
([bathroomLinenSeed.js](../server/src/utils/bathroomLinenSeed.js)); Adrien prices it **`per_person`**. When a
guest books it, the reservation pricing engine bills `persons × unitPrice`
([pricing.js](../server/src/utils/pricing.js#L226) `getTypeMultiplier`, `per_person → persons`), with the
per-property price override applied ([property_option_prices](per-property-option-prices.md)).

Today, if the guest **did not** take bath linen, nothing in the SAS lets the operator propose it on the spot.
The operator wants the same upsell as for cleaning, but priced **per person like the reservation engine**, and
with a **payment choice**: settle it now (into the normal arrival complement, optionally recorded in the
**caisse interne**) or defer it to the **end-of-stay complement** shown at check-out.

The reservation already has two distinct complements (spec
[cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md),
[recall-unpaid-arrival-complement-at-checkout.md](recall-unpaid-arrival-complement-at-checkout.md)):

- **Arrival complement** — `complementAmount` / `complementPaid` / `complementPaidCash` (caisse interne).
  Items are `reservation_custom_options` with `inComplement = 1`, `sasArrivalOrigin = 1`.
- **End-of-stay complement** — `endOfStayComplementAmount` / `endOfStayComplementDetail` (JSON lines) /
  `endOfStayComplementPaid` / `endOfStayComplementPaidCash`. Written today **only** by
  `commitDepartureSas`; shown in the departure (check-out) recap.

## 2. Goal

In the **arrival SAS**, when the guest didn't take bath linen, the operator can **offer it** at a price
computed **per person** (mirroring the reservation engine), then either **add it — settle at end of stay**
(→ end-of-stay complement, displayed and collected at check-out) or **add it — settle now** (→ normal arrival
complement, recordable in the caisse interne on the arrival recap). If declined, nothing is written.

## 3. Functional rules

### 3.1 Applicability & price

1. **New arrival-SAS page « Linge de toilette »**, inserted **after the « Ménage » page** and before the
   caution-report / weather / recap pages. **Shown only when the reservation does NOT already include the
   bath-linen option** — i.e. no reservation option (or resource) has `autoOptionType = 'bathroom_linen'`.
   When bath linen is already taken, the page is skipped (like a settled step).
2. **Price is computed server-side, per person, mirroring the pricing engine.** The server resolves the
   `bathroom_linen` catalogue option, applies the **per-property price override** (`property_option_prices`,
   else `options.price`), and bills `unitPrice × getTypeMultiplier(option.priceType, persons, nights)` with
   `quantity = 1`, rounded to 2 decimals. `persons = adults + teens + children` (**babies excluded**), exactly
   as [pricing.js](../server/src/utils/pricing.js#L1062). For Adrien's `per_person` option this is
   `persons × unitPrice`; the rule respects whatever `priceType` the option carries so it never diverges from
   the engine.
3. The SAS payload exposes the resolved bath-linen offer as `bathLinen: { available, unitPrice, priceType,
   persons, nights, amount, label }`. `available = false` when no `bathroom_linen` option exists, when it's
   already on the reservation, or when the computed `amount ≤ 0` — in those cases the page is not shown.
4. **Label.** The complement line is labelled **« Linge de toilette »** (a `LABEL` constant shared by the
   commit + re-open reconstruction, like « Ménage »). The recap detail line reads
   « Linge de toilette : {persons} × {unitPrice} = {amount} » via the existing `lineText` formatter.

### 3.2 Operator choice on the page

5. The page shows: « Le client n'a pas pris le linge de toilette. » + « Tarif : {amount} ({persons} pers ×
   {unitPrice}). » and **three explicit buttons** (mobile-first, ≥ 48 px):
   - **« Ajouter — réglé en fin de séjour »** → the amount joins the **end-of-stay complement** (rule 6).
   - **« Ajouter — réglé maintenant »** → the amount joins the **normal arrival complement** (rule 7).
   - **« Non merci »** → nothing added; advance.
   The two « Ajouter » actions are a neutral upsell (not a yes/no safety question), styled like the
   « Ajouter le ménage » action — primary for the add actions, discreet for « Non merci ».
6. **Settle at end of stay.** On commit, the arrival SAS writes a **bath-linen line into
   `endOfStayComplementDetail`** tagged `source = 'arrivalBathLinen'` and recomputes
   `endOfStayComplementAmount` = Σ of all detail lines. This line is **displayed and collected at check-out**
   (rule 9). It does **not** touch `complementAmount`.
7. **Settle now.** The amount is added to the **arrival complement** as an ordinary SAS complement item
   (`reservation_custom_options`, `inComplement = 1`, `sasArrivalOrigin = 1`, label « Linge de toilette »),
   exactly like the cleaning charge — it flows through the existing `complementItems` path of
   `commitArrivalSas`. The operator records the cash-register settlement with the **existing arrival-recap
   checkbox** « Complément encaissé » → « Caisse interne » (`complementSettled` + `complementPaidCash`); no
   new payment control is added. Choosing « réglé maintenant » does **not** auto-tick that box — the operator
   confirms collection on the recap as today.
8. **Mutual exclusivity & idempotency.** At most one of the two buckets holds the bath-linen line for a given
   SAS run. Re-opening the arrival SAS (spec [reopen-completed-sas.md](reopen-completed-sas.md)) pre-selects
   the prior choice and **replaces** the prior line rather than duplicating it:
   - the « settle now » line is a `sasArrivalOrigin = 1` custom option → already replaced wholesale by the
     existing re-commit logic;
   - the « settle at end of stay » line (`source = 'arrivalBathLinen'`) is **removed then re-inserted** by
     `commitArrivalSas` on every re-commit, so the end-of-stay amount is recomputed without double-charging.
   - Switching the choice between two runs (now → end of stay, or the reverse, or → « Non merci ») removes the
     line from the previous bucket.

### 3.3 Check-out display (the crux)

9. **The deferred bath-linen line MUST appear in the departure (check-out) SAS recap and count in its total.**
   Today the departure recap renders `endOfStayLines` (cleaning + missing items + extinguisher preview) but
   **omits `preservedDeparture`** — the bucket into which unrecognised end-of-stay detail lines are read back.
   This is invisible today because nothing ever writes an unrecognised end-of-stay line; **this feature is the
   first to do so.** The departure SAS must therefore:
   - reconstruct the `source = 'arrivalBathLinen'` line into a **displayed, non-editable** recap line (its own
     bucket, e.g. `carriedEndOfStayLines`), **not** the silent `preservedDeparture`;
   - **include it in `endOfStayTotal`** and in « Total à percevoir » at check-out;
   - **preserve it on the departure commit** (re-send it verbatim in `endOfStayComplementDetail`, keeping the
     `source` tag) so running the departure SAS never drops the arrival-added line.
   « Compléments encaissés » / « Caisse interne » at check-out then settle it with the rest of the end-of-stay
   complement, unchanged (`commitDepartureSas`).

### 3.4 Spec sync

10. This spec plus [arrival-departure-sas.md](arrival-departure-sas.md) (add the new page to §3.1 and the
    complement wiring to §3.3) are updated in the same PR. The page-order list, the API payload, and the
    end-of-stay recap fix are recorded there.

**Edge cases:**
- No `bathroom_linen` option in the catalogue, or `amount ≤ 0` → `available = false` → page skipped.
- Bath linen already on the reservation → page skipped.
- `complementPaid = 1` (arrival complement already settled) + « réglé maintenant » → the item is still
  recorded (existing frozen-complement behaviour warns the operator to collect the delta manually); prefer
  « réglé en fin de séjour » in that situation (documented, not enforced).
- Re-open arrival SAS after the departure SAS already ran: the `source` tag is preserved through the departure
  commit (rule 9), so the arrival re-open still recognises and replaces its own line.
- Quitter at any point → nothing written (in-memory state only), unchanged.

---

## 4. Architecture

> **Fat backend, thin frontend.** The bath-linen availability, the per-person price (per-property override +
> engine `priceType` multiplier), and the end-of-stay recompute are all resolved **server-side**. The client
> renders the page, holds the in-memory choice, and sends it in the single existing commit call.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/reservationsModel.js` | T | New `getBathLinenOfferForReservation(reservation)` — resolves the `bathroom_linen` option, per-property override, engine `priceType` multiplier, `persons`, returns `{ available, unitPrice, priceType, persons, nights, amount, label }`. `commitArrivalSas` gains an `endOfStayBathLinen` input: remove any `source='arrivalBathLinen'` line from `endOfStayComplementDetail`, optionally re-insert the current one, recompute `endOfStayComplementAmount`. |
| `controllers/` | `controllers/sasController.js` | T | `getSas` adds `bathLinen: model.getBathLinenOfferForReservation(reservation)` to the payload. `commitArrival` forwards the new `endOfStayBathLinen` field (label + amount or null). |
| `utils/` | `utils/pricing.js` | REUSE | `getTypeMultiplier` reused by the offer resolver so the per-person math never diverges from the engine. |
| `models/` | `models/optionsModel.js` / `property_option_prices` | REUSE | Same per-property override lookup pattern as `getCleaningPriceForProperty`. |
| `database.js` | `database.js` | — | **No migration** — reuses existing columns (`endOfStayComplementAmount/Detail`, `reservation_custom_options.inComplement/sasArrivalOrigin`). |

**Notes:**
- `getBathLinenOfferForReservation` is a pure-ish read (DB lookups only, no writes), unit-testable with a
  seeded DB, mirroring `getCleaningPriceForProperty`.
- The `source` field is a **JSON property of an end-of-stay detail line**, not a DB column — no schema change.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/sas/ReservationSasDialog.js` | T | New `bathLinen` step in `activeKeys` (arrival, after `cleaning`, when `data.bathLinen?.available`); page render + 3 buttons; in-memory `bathLinenChoice ∈ {null,'now','endOfStay'}`; « now » pushes a line into `arrivalAddedLines`, « endOfStay » sends `endOfStayBathLinen` in the arrival commit; **departure recap fix** (rule 9): read `source='arrivalBathLinen'` into a displayed `carriedEndOfStayLines` bucket, add to `endOfStayTotal`, re-send on commit; re-open pre-fill for both buckets. |
| `services/` | `services/api.js` | — | `commitArrivalSas` already passes the whole payload object through; the new field rides along. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Button`/`Stack`/`Chip`/`Typography`, the SAS shell, `lineText`, `formatCurrency` | Reused as-is. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | The `bathLinen` step block inside `ReservationSasDialog` | Same pattern as the existing `cleaning`/`linen` steps; belongs in the wizard, not a shared component. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/sas?mode=arrival` | — | adds `bathLinen: { available, unitPrice, priceType, persons, nights, amount, label }` | Server decides availability + price. |
| POST | `/api/reservations/:id/sas/arrival` | adds `endOfStayBathLinen: { label, amount } \| null` (the « settle at end of stay » line; `null`/omitted when the choice is « now » or « Non merci ») | `{ ok, complementAmount }` | The « settle now » line rides the existing `complementItems`. |
| POST | `/api/reservations/:id/sas/departure` | `endOfStayComplementDetail` now carries the preserved `{ label, amount, source:'arrivalBathLinen' }` line verbatim | `{ ok }` | Server recomputes the authoritative total from all detail lines (unchanged). |

---

## 5. Data model

**No schema change.** Reuses:
- `reservations.endOfStayComplementAmount` / `endOfStayComplementDetail` (JSON) / `endOfStayComplementPaid` /
  `endOfStayComplementPaidCash` — the deferred bath-linen line lives here as
  `{ label:'Linge de toilette', amount, qty:persons, unitPrice, source:'arrivalBathLinen' }`.
- `reservation_custom_options` (`inComplement = 1`, `sasArrivalOrigin = 1`) — the « settle now » line, same as
  the cleaning charge.
- `options` (`autoOptionType='bathroom_linen'`, `priceType`, `price`) + `property_option_prices` — price source.

**Data impact:** purely additive to existing JSON/rows. No migration, no backfill, no recompute of existing
reservations.

## 6. UI / UX

- **New arrival-SAS page « Linge de toilette »** (icon: `DryCleaning` — the towel/laundry icon already used
  for the departure « serviettes manquantes » step):
  - Body: « Le client n'a pas pris le linge de toilette. » then « Tarif : **{amount}** ({persons} pers ×
    {unitPrice}). » When a choice is made, a confirmation `Chip` (« Linge ajouté — {amount}, réglé
    {maintenant|en fin de séjour} », color `info`).
  - Footer buttons (stacked full-width on `xs`, side-by-side `sm+`, ≥ 48 px): **« Réglé en fin de séjour »**
    (primary), **« Réglé maintenant »** (primary), **« Non merci »** (discreet/outlined). Tapping any of them
    advances immediately.
- **Arrival recap:** the « settle now » line appears in the added-lines detail (« Linge de toilette :
  {persons} × {unitPrice} = {amount} »), included in « à percevoir ». The existing « Complément encaissé » →
  « Caisse interne » checkbox settles it (no change).
- **Departure (check-out) recap:** the deferred bath-linen line is listed (« Linge de toilette : … ») and
  counted in « Total à percevoir » (rule 9 fix). « Compléments encaissés » / « Caisse interne » settle it.
- **Responsive:** inherits the SAS shell — `fullScreen` on `xs`, full-width stacked buttons on mobile,
  centered dialog on `md+`, touch targets ≥ 48 px. No new layout.
- **States:** loading/error inherit the dialog. `available=false` → the page never renders (skipped).
- **Sticky action bar:** N/A — this is a dialog wizard step, not a page; the SAS shell provides the header
  band + Quitter + Précédent as today.

## 7. Test plan

### Server unit tests
- [ ] `tests/sas-bath-linen-offer.unit.test.js` — `getBathLinenOfferForReservation`: per-person amount =
      `persons × unitPrice`; per-property override wins over base price; babies excluded from `persons`;
      `available=false` when the option is already on the reservation / missing / amount ≤ 0; respects a
      non-`per_person` `priceType` (mirrors `getTypeMultiplier`).
- [ ] `tests/sas-commit.unit.test.js` (extend) — `commitArrivalSas` with `endOfStayBathLinen`: inserts the
      `source='arrivalBathLinen'` line, recomputes `endOfStayComplementAmount`; re-commit replaces (no
      double-charge); switching to « now » (item in `complementItems`, `endOfStayBathLinen=null`) removes the
      end-of-stay line; « Non merci » removes both.
- [ ] `tests/sas-commit.unit.test.js` (extend) — `commitDepartureSas` preserves an existing
      `source='arrivalBathLinen'` line (kept in the detail + counted in the authoritative amount) when the
      operator runs the departure SAS.

### Client IHM tests (vitest, `components/sas/__tests__/ReservationSasDialog.test.js`)
- [ ] Arrival: bath-linen page shows when `bathLinen.available`; « Réglé en fin de séjour » sends
      `endOfStayBathLinen` in `commitArrivalSas` and adds nothing to `complementItems`.
- [ ] Arrival: « Réglé maintenant » adds the « Linge de toilette » line to `complementItems`, recap total
      includes it, `endOfStayBathLinen` is null.
- [ ] Arrival: page skipped when `bathLinen.available === false`.
- [ ] Departure: a reservation whose `endOfStayComplementDetail` carries a `source='arrivalBathLinen'` line
      shows it in the recap, includes it in « Total à percevoir », and re-sends it on commit.

### Manual UI verification
- [ ] Arrival happy path: guest without bath linen → page appears, per-person price correct → « Réglé en fin
      de séjour » → line visible in the departure SAS recap + total; then « Compléments encaissés / Caisse
      interne » at check-out.
- [ ] « Réglé maintenant » → line in the arrival complement → « Complément encaissé / Caisse interne » on the
      arrival recap.
- [ ] Re-open the arrival SAS: prior choice pre-selected, no double-charge; switch now ↔ end of stay.
- [ ] Regression: cleaning upsell and the departure end-of-stay complement still behave as before.
- [ ] Mobile (`xs`): full-screen stepper, buttons stacked.

## 8. Out of scope

- Offering bath linen at the **departure** SAS (arrival only).
- Online / Qonto payment capture of the bath-linen amount (settlement is manual: caisse interne or normal
  collection).
- Editing the bath-linen price from the SAS (it comes from the option + per-property override, configured in
  Options as today).
- Partial bath linen (« only 2 of 3 persons ») — the offer bills the full party per the engine `priceType`.

## 9. Open questions

Resolved during scoping (2026-07-20, via questionnaire):
- **Deferred bucket** → the **end-of-stay complement** (`endOfStayComplementAmount/Detail`), shown at
  check-out. (Alternative « unpaid arrival complement recalled at check-out » rejected — the user wants the
  dedicated end-of-stay complement.)
- **Page interaction** → **three explicit buttons** (réglé en fin de séjour / réglé maintenant / Non merci).
- **Caisse interne for immediate payment** → **reuse the existing arrival-recap checkbox**
  (`complementSettled` + `complementPaidCash`); no per-line payment control.

- **Accounting routing of the deferred bath linen** (resolved 2026-07-20) → **accept the 70600010
  « prestation complémentaire » bucket**, consistent with the other end-of-stay lines (ménage non fait, linge
  manquant, extincteur). No option-revenue routing.
