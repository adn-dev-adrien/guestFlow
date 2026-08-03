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
The operator wants the same upsell as for cleaning: **offer it or not**, priced **per person like the
reservation engine**, and — like every other SAS charge — **let the operator settle it at the very end of the
check-in** on the recap, never at the moment the option is selected.

> **2026-08-02 update — règlement moves to the recap.** The original design forced the operator to pick the
> settlement timing (« réglé maintenant » vs « réglé en fin de séjour ») **on the bath-linen step itself**.
> That is wrong: no other SAS charge asks for payment at selection time — the ménage step only adds/declines,
> and the recap's `PaymentModeButtons` (**CB/Chèque · Payé en liquide · En fin de séjour**) settle the whole
> arrival complement in one place. The bath-linen step now mirrors the ménage: **« Ajouter le linge de
> toilette » / « Non merci »**. When added, the line joins the **arrival complement** and is settled on the
> recap like everything else; choosing **« En fin de séjour »** there defers the whole complement to check-out
> via the existing unpaid-arrival-complement recall
> ([recall-unpaid-arrival-complement-at-checkout.md](recall-unpaid-arrival-complement-at-checkout.md)). The
> dedicated end-of-stay bath-linen routing is retired (§3.2). The check-out display of any **legacy** deferred
> line already written by an old commit is preserved (§3.3).

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
computed **per person** (mirroring the reservation engine): **« Ajouter le linge de toilette »** adds it to the
**arrival complement** (like the ménage charge), **« Non merci »** writes nothing. The **settlement is chosen
once, for the whole complement, on the recap** (CB/Chèque · Payé en liquide · En fin de séjour) — never on the
option step.

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
   {unitPrice}). » and **two buttons** (mobile-first, ≥ 48 px), mirroring the « Ménage » step exactly:
   - **« Ajouter le linge de toilette »** (outlined) → the amount joins the **arrival complement** (rule 6).
   - **« Non merci »** (contained) → nothing added; advance.
   When added, a confirmation `Chip` « Linge ajouté ({amount}) » (color `info`) shows on the page. **No payment
   question is asked here** — settlement is decided on the recap (rule 7).
6. **Adding the bath linen.** The amount is added to the **arrival complement**, exactly like the cleaning
   charge. It appears in the recap « à percevoir » total with the other complement lines.
   > **Revised 2026-08-03** — it is no longer a `reservation_custom_options` line: adding the bath linen
   > **activates the CATALOGUE option** (`autoOptionType='bathroom_linen'`, `inComplement = 1`,
   > `sasArrivalOrigin = 1`), priced by the engine. A custom line was invisible to the laundry + linen-stock
   > aggregators (they join `reservation_options → options WHERE countsAsBathroomLinen = 1`), so the towels
   > sold at check-in were never prepared nor deducted from the stock. The client now sends the intent
   > (`bathLinenAdded`) instead of a `complementItems` line. See
   > [sas-upsells-activate-catalogue-option.md](sas-upsells-activate-catalogue-option.md).
7. **Règlement on the recap (not on the step).** The operator settles the whole arrival complement — bath
   linen included — with the recap's `PaymentModeButtons` (**CB/Chèque · Payé en liquide · En fin de séjour**,
   spec [sas-recap-payment-buttons.md](sas-recap-payment-buttons.md)), which opens **pre-selected on
   « En fin de séjour »**. **« En fin de séjour »** leaves the complement unpaid so it is recalled at check-out
   ([recall-unpaid-arrival-complement-at-checkout.md](recall-unpaid-arrival-complement-at-checkout.md)) — this
   is how bath linen is now deferred, without a dedicated end-of-stay routing.
8. **Retired end-of-stay routing + idempotency.** The arrival SAS **no longer writes** a
   `source='arrivalBathLinen'` line into `endOfStayComplementDetail`. `commitArrivalSas` still receives
   `endOfStayBathLinen`, but the client always sends **`false`** when the step is shown, so any **legacy**
   deferred line from an old commit is **removed** on re-commit and the end-of-stay amount recomputed. The
   « added » line is a `sasArrivalOrigin = 1` custom option → already replaced wholesale by the existing
   re-commit logic (no double-charge). Re-opening a SAS whose old commit had deferred the bath linen pre-checks
   « added » and moves the line into the arrival complement on re-commit.

### 3.3 Check-out display of a LEGACY deferred line (backward compat)

9. **A legacy `source = 'arrivalBathLinen'` line — written by an OLD commit before the 2026-08-02 change — MUST
   still appear in the departure (check-out) SAS recap and count in its total** (for reservations whose arrival
   SAS is not re-run). New arrival commits never write this line anymore (§3.2 rule 8), but the departure SAS
   keeps handling any pre-existing one:
   - reconstruct the `source = 'arrivalBathLinen'` line into a **displayed, non-editable** recap line (its own
     bucket, `carriedEndOfStayLines`), **not** the silent `preservedDeparture`;
   - **include it in `endOfStayTotal`** and in « Total à percevoir » at check-out;
   - **preserve it on the departure commit** (re-send it verbatim in `endOfStayComplementDetail`, keeping the
     `source` tag) so running the departure SAS never drops the line.
   « Compléments encaissés » / « Caisse interne » at check-out then settle it with the rest of the end-of-stay
   complement, unchanged (`commitDepartureSas`). Re-running the **arrival** SAS instead migrates the line into
   the arrival complement (§3.2 rule 8).

### 3.4 Spec sync

10. This spec plus [arrival-departure-sas.md](arrival-departure-sas.md) (add the new page to §3.1 and the
    complement wiring to §3.3) are updated in the same PR. The page-order list, the API payload, and the
    end-of-stay recap fix are recorded there.

**Edge cases:**
- No `bathroom_linen` option in the catalogue, or `amount ≤ 0` → `available = false` → page skipped.
- Bath linen already on the reservation → page skipped.
- `complementPaid = 1` (arrival complement already settled) + « Ajouter » → the recap keeps its existing
  frozen-complement warning (« encaisser le supplément manuellement »); the operator collects the delta by
  hand, as for any other line added after the complement was marked paid.
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
| `components/` | `components/sas/ReservationSasDialog.js` | T | `bathLinen` step in `activeKeys` (arrival, after `cleaning`, when `data.bathLinen?.available`); page render + **2 buttons** (« Ajouter le linge de toilette » / « Non merci »); in-memory `bathLinenAdded` boolean; when added, pushes a line into `arrivalAddedLines` (arrival complement); the arrival commit always sends `endOfStayBathLinen: false` when the step is shown (drops legacy deferred lines). **Departure recap** (rule 9, legacy): read `source='arrivalBathLinen'` into a displayed `carriedEndOfStayLines` bucket, add to `endOfStayTotal`, re-send on commit. Re-open pre-fill: « added » is set from the `sasArrivalOrigin` line OR a legacy deferred line. |
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
| POST | `/api/reservations/:id/sas/arrival` | `endOfStayBathLinen: false` whenever the bath-linen step is shown (drops any legacy deferred line); `undefined` when the step isn't shown | `{ ok, complementAmount }` | The added bath-linen line rides the existing `complementItems` (arrival complement); settlement is on the recap. |
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
    {unitPrice}). » When added, a confirmation `Chip` « Linge ajouté ({amount}) » (color `info`).
  - Footer buttons (stacked full-width on `xs`, side-by-side `sm+`, ≥ 48 px), mirroring the « Ménage » step:
    **« Ajouter le linge de toilette »** (outlined) and **« Non merci »** (contained). Tapping either advances
    immediately. **No payment question on this step.**
- **Arrival recap:** the added line appears in the added-lines detail (« Linge de toilette : {persons} ×
  {unitPrice} = {amount} »), included in « à percevoir », and is settled by the recap's `PaymentModeButtons`
  (CB/Chèque · Payé en liquide · En fin de séjour) with the rest of the complement.
- **Departure (check-out) recap:** only a **legacy** deferred line (old commits) is listed (« Linge de
  toilette : … ») and counted in « Total à percevoir » (rule 9). New commits route bath linen through the
  arrival complement instead.
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
- [x] Arrival: bath-linen page shows when `bathLinen.available`; « Ajouter le linge de toilette » adds the
      « Linge de toilette » line to `complementItems`, the recap total includes it, the recap règlement buttons
      (incl. « En fin de séjour ») are present, and `endOfStayBathLinen` is `false`.
- [x] Arrival: « Non merci » adds nothing (`complementItems` empty), `endOfStayBathLinen` is `false`.
- [x] Arrival: page skipped when `bathLinen.available === false`.
- [x] Departure (legacy): a reservation whose `endOfStayComplementDetail` carries a `source='arrivalBathLinen'`
      line shows it in the recap, includes it in « Total à percevoir », and re-sends it on commit.

### Manual UI verification
- [ ] Arrival happy path: guest without bath linen → page appears, per-person price correct → « Ajouter le
      linge de toilette » → line visible in the arrival recap + total → règlement chosen on the recap
      (CB/Chèque · Liquide · En fin de séjour).
- [ ] « En fin de séjour » on the recap → the whole complement (bath linen included) is recalled at check-out.
- [ ] Re-open the arrival SAS: prior « added » pre-selected, no double-charge; a legacy deferred line migrates
      into the arrival complement.
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

**Superseded 2026-08-02 — règlement moved to the recap (via questionnaire).** The payment timing is no longer
asked on the bath-linen step; the step only adds/declines and the recap settles the whole complement. The
original 2026-07-20 resolutions below are kept for history but no longer describe the shipped behaviour:
- **Page interaction** → now **two buttons** (« Ajouter le linge de toilette » / « Non merci »), mirroring the
  ménage step. (Was: three buttons réglé en fin de séjour / réglé maintenant / Non merci.)
- **Deferred bucket** → deferral is now the recap's **« En fin de séjour »**, i.e. the unpaid arrival
  complement recalled at check-out. (Was: the dedicated end-of-stay complement — now retired for bath linen;
  the departure SAS still displays legacy lines, §3.3.)

Resolved during original scoping (2026-07-20, via questionnaire) — still valid:
- **Caisse interne for settlement** → **reuse the existing arrival-recap** payment control
  (`complementSettled` + `complementPaidCash`); no per-line payment control.
- **Accounting routing of the bath linen** → **accept the 70600010 « prestation complémentaire » bucket**,
  consistent with the other complement lines (ménage non fait, linge manquant, extincteur). No option-revenue
  routing.
