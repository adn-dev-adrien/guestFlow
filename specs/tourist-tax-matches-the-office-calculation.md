# Tourist tax — bill the guest exactly what the office of tourism computes

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/tourist-tax-matches-the-office-calculation` |
| **Created** | 2026-09-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The Lodge declares its tourist tax in `percentage_accommodation` mode: 5 % of the per-occupant
nightly cost, plus a 10 % departmental share. The office of tourism has its own calculator, and the
operator declares month by month by re-entering the stay into it.

Since 2026-08-20 the two disagree. Two changes moved the base without anyone noticing they moved it
away from the office's definition:

- [tourist-tax-base-accommodation-only.md](tourist-tax-base-accommodation-only.md) (PR #470)
  **unplugged the platform brut**: the base became the tariff nights (or the manual « Prix hébergement
  ajusté »), on a Lodgify or Abracadaroom booking as on a direct one;
- the extra-guest surcharge had already been ruled out of the base
  ([tariff-recipes/spec.md](tariff-recipes/spec.md) §9 Q2, 2026-08-12).

Measured on the two stays the operator checked against the office's calculator:

| Stay | Collected | Engine today | Base the engine used |
|---|---|---|---|
| Esteve (22209, Abracadaroom, 2 n, 2 ad) | 11,96 € | 12,56 € | 250,74 € — the manual adjusted price, which holds the **net** of a 64,26 € commission |
| Foulon (22269, Lodgify, 3 n, 5 ad) | 21,00 € | 20,40 € | 408 € — the tariff nights, extra-guest surcharge excluded |

Neither is reproducible in the office's form, so the operator has been **adjusting the amount he
types into it** until it lands back on what GuestFlow collected — down for Esteve, up for Foulon.
That is not a declaration, it is a reconciliation, and it silently hides whatever the real gap is.

Two aggravating findings from the same investigation:

- **A frozen stay shows a base that contradicts its own amount.** For a past stay the *amount* is
  pinned ([tourist-tax-freeze-past-with-refresh.md](tourist-tax-freeze-past-with-refresh.md)) but the
  *base* is recomputed with today's rule — on the fiche
  ([pricing.js:2043](../server/src/utils/pricing.js#L2043) leaves `touristTaxLabel` to the live
  breakdown, rendered by [PricingSummary.jsx:657](../client/src/components/PricingSummary.jsx#L657))
  and on the « Suivi taxe de séjour » page
  ([financeModel.js:840](../server/src/models/financeModel.js#L840)). Foulon's line reads « 24,73 €/occupant/nuit »
  next to « 21,00 € », and 24,73 € yields 20,40 €. The line cannot be re-entered anywhere.
- **The occupant count differs from the office's.** GuestFlow divides by `adults + children + teens +
  babies`; the office's form was filled with 4 occupants on Carpier (22275) where GuestFlow counts 5,
  the fifth being a baby. Dividing by more occupants lowers the tax, so every stay with a cot is
  under-billed.

The office of tourism has since stated what it wants in the « Montant du séjour HT » field: **the
accommodation only, options and cleaning excluded.**

## 2. Goal

On a percentage-mode property, GuestFlow computes the tourist tax exactly as the office of tourism
does, so the amount billed to the guest is the amount that will be remitted — and the fiche and the
« Suivi taxe de séjour » page show a base the operator can retype into the office's form and land on
the same figure to the cent.

Nothing the guest has already paid moves. What is still to be collected is corrected before it is.

## 3. Functional rules

### The base

1. **The base is the accommodation the guest actually paid, and only that.** In order:

   ```
   assiette = max(0, hébergement payé
                     − prestations comprises dans le tarif
                     − supplément voyageur)
   ```

   where `hébergement payé` is rule 2 (with a brut) or rule 3 (without one). Everything downstream is
   unchanged: `÷ nuits ÷ (1 + TVA/100) ÷ occupants × commune % `, `+ dep %`, `× nuits × assujettis`,
   with the engine's per-step rounding.

2. **With a platform brut, the accommodation is what is left of the brut once the extras are out.**

   ```
   hébergement payé = brut − (options et ressources facturées, hors « Complément »)
   ```

   The brut is what the guest paid **the platform**. A line routed to « Complément » is collected by
   us at arrival, so it was never inside the brut and is **not** subtracted — subtracting it would
   deduct it twice. This is the one input whose routing still reaches the base, and it does so
   because the routing decides who cashes the line, not how it looks. Rule 2 of
   `tourist-tax-base-accommodation-only.md` (« the platform brut never derives the base ») is
   **repealed**.

3. **Without a brut, the accommodation is the tariff.** A direct booking, or a platform booking whose
   brut has not been entered yet:

   ```
   hébergement payé = customPrice ?? (nuits du tarif × (1 − remise / 100))
   ```

   The extra-guest surcharge is not part of that figure to begin with, so rule 1 subtracts nothing
   more for it.

4. **The extra-guest surcharge is out of the base.** It is inside the brut (the guest paid it), so
   rule 1 subtracts it explicitly. The 2026-08-12 decision stands, and now stands identically on both
   sides of rule 2 / rule 3.

5. **Services included in the rate stay deducted.** Unchanged from
   [tourist-tax-included-services-deduction.md](tourist-tax-included-services-deduction.md) rules 2-3:
   only `includedInRate` lines (a `property_option_defaults` row with `offered = 1`, offered on this
   booking), valued as a per-stay forfait whose person factor is `basePriceIncludedGuests`. The office
   asked for the accommodation « hors ménage » — this is that deduction, and it is confirmed, not
   invented.

6. **Every other extra is inert.** Paid options, custom options, resources, auto-options, baby-bed
   supplements, mid-stay sales and end-of-stay complements never enter the base. They only ever leave
   it, through rule 2, and only for the amount actually billed to the guest.

7. **The base is floored at 0.** A brut smaller than the extras it is supposed to cover is an
   inconsistent entry, not a negative base.

### The occupants

8. **Babies do not count as occupants.** The divisor becomes `adults + children + teens`. A cot still
   bills its supplement ([baby-bed-supplement.md](baby-bed-supplement.md)) and still occupies the
   lodging — it just no longer divides the nightly cost, which is what the office's form does.
   `touristTaxOccupantsCount` reports the count actually used.

9. **The taxable-person count is unchanged.** `adults`, as today.

### When the amount stops moving

10. **The tax freezes when the instalment that carries it is collected.** The routing already says
    which one ([per-platform-tourist-tax-three-way.md](per-platform-tourist-tax-three-way.md)):
    - collected in the balance (direct, `platform_reversed` — Lodgify) → freeze on `balancePaid = 1`;
    - collected at arrival (`owner` — Abracadaroom, or `touristTaxInComplement = 1`) → freeze on
      `complementPaid = 1`;
    - offered by the platform (Airbnb, Booking, Greengo, Gîtes de France) → the tax is zero and there
      is nothing to freeze.

    Freezing writes `touristTaxFrozenAt`, and with it the base and the occupant count that produced
    the amount (rule 12). Un-collecting the instalment does **not** thaw it: a declared amount stays
    declared. Only the existing « Recalculer la taxe de séjour » button thaws it, deliberately, and
    the operator must save for the new amount to persist.

10bis. **Consequence — the declaration reports, it no longer re-prices.** The « Suivi taxe de séjour »
    page lists only stays whose tax has been collected, and collecting is what freezes it (rule 10).
    Every line it shows is therefore a frozen one, rendered from its stored amount and stored base.
    That is the intended end state: what is declared to the commune is what was collected from the
    guest, and the two can no longer drift apart.

11. **Marking a line « Déclarée » freezes it too.** `touristTaxDeclaredAt`
    ([tourist-tax-declared-checkbox.md](tourist-tax-declared-checkbox.md)) is the moment an amount
    left for the commune, so it locks the amount as firmly as collecting it. The earlier of rule 10
    and rule 11 wins.

    The **old** « past stay » freeze — last night before the 1st of the current month
    ([tourist-tax-freeze-past-with-refresh.md](tourist-tax-freeze-past-with-refresh.md) rule 1) — is
    **retired**. It was a proxy for « already declared », and a poor one: it pins stays that were
    never collected and therefore never appeared in a declaration, which is exactly what stopped
    Carpier (22275) from being corrected. Rules 10 and 11 replace it with the two events that
    actually matter. The « Recalculer la taxe de séjour » button keeps its role, and now shows on any
    frozen reservation rather than on any past one.

12. **A frozen tax carries its own base.** `touristTaxFrozenBaseHt` (the accommodation HT for the
    whole stay), `touristTaxFrozenOccupants` and `touristTaxFrozenUnitAmount` are written with
    `touristTaxFrozenAt`. The fiche and the « Suivi taxe de séjour » page render **those**, never a
    recomputation — so `base ÷ nuits ÷ occupants × 5 % + 10 %` reproduces the amount shown, and the
    operator retypes the line into the office's form unchanged.

### Not moving what is already sold

13. **What the guest already paid never moves; what is still to be collected is corrected.** The
    migration freezes exactly the reservations and devis that rule 10 or rule 11 would have frozen —
    the instalment carrying the tax is paid, or the line is marked « Déclarée » — writing
    `touristTaxFrozenAt` and the base reconstructed from the stored amount (rule 14). Every other
    booking, already made but not yet collected, re-prices under the new rules so the guest is billed
    the right amount: on the production copy that is Carpier (22275) 13,05 € → 21,33 € and
    Maisonnette (22211) 2,16 € → 3,36 €, and nothing else.

14. **Reconstructing a legacy base.** From the stored `touristTaxTotal`, inverting the engine's
    arithmetic with the occupant count in force **then** (babies included):

    ```
    unit      = total ÷ (nuits × adultes)
    municipal = unit ÷ (1 + dep % / 100)
    nuit HT   = (municipal ÷ (commune % / 100)) × occupants (bébés compris)
    base HT   = nuit HT × nuits
    ```

    It is exact to the rounding: re-running the forward formula on the reconstructed base returns the
    stored amount. **Measured on the 13 Lodge stays carrying a tax in the production copy: 13/13 exact
    round-trips** — Foulon 21,00 € → 381,82 € HT → 21,00 €, Esteve 11,96 € → 217,45 € HT → 11,96 €.
    Where the inversion cannot apply (per-night mode, a zero amount, zero adults or zero nights), the
    frozen base is left `NULL` and the page falls back to what it shows today.

**Edge cases**

- Brut entered *after* the tax was collected → the tax is frozen, nothing moves. The operator can
  force it with « Recalculer » if the brut corrects a real error.
- Brut changed *before* collection → the tax follows it, and so does the amount the guest will be
  asked for. That is the point.
- A line moved into or out of « Complément » before collection → the base moves by that line's
  amount, because the brut no longer covers it. If the brut was not corrected at the same time, the
  entry is inconsistent; rule 7 floors the result and rule 16 surfaces it.
- Stay with only babies besides the adults → divisor = adults, as the office's form.
- **A past stay declared to the office by hand, outside the page.** Carpier (22275) is the known one:
  13,05 € were filed for August although nothing is collected on it, so the « Suivi taxe de séjour »
  page never listed it. Rule 13 re-prices it to 21,33 €, and it will enter the declaration of the
  month it is finally collected in — 21,33 €, on top of the 13,05 € already filed. The double must be
  settled with the office by hand; ticking « Déclarée » on it **before** deploying freezes it at
  13,05 € instead, if that is the preferred way out.
- `percentage_and_fixed` mode → unchanged, the fixed part rides on top as today.
- The Gîte (`per_day_per_person`, 1,20 €/adulte/nuit) is untouched by every rule above: no price
  enters its tax.

### Telling the operator

15. **The fiche states the base it used.** The « Taxe de séjour » line's caption becomes readable as
    a declaration: `(<base HT> € HT ÷ <nuits> nuits ÷ <occupants> occupants) × 5,00 % + 10,00 % dep =
    <unit> €/adulte/nuit`, with a « figée le <date> » mention when frozen.

16. **An inconsistent brut is flagged, not silently floored.** When
    `brut < options hors Complément + supplément voyageur`, the fiche shows a warning next to the
    tourist-tax line: « Le brut plateforme ne couvre pas les extras facturés — la taxe est calculée
    sur une assiette nulle. »

---

## 4. Architecture

> **Fat backend.** The whole base, the occupant count and the freeze decision are the engine's.
> The client sends the form and renders the quote; it computes nothing.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pricing.js` | T | `computeTouristTaxBreakdown`: occupants exclude babies; returns the base it used. `calculateReservationQuote`: base per rules 1-7 (brut minus non-complement extras, minus inclusions, minus surcharge); accepts the frozen base/occupants and returns them verbatim when frozen; emits the rule-16 inconsistency flag. |
| `utils/` | `reservationEngineInput.js` | T | Carries `platformGrossAmount` and the three frozen columns, so the declaration and the contrib capture replay exactly what the fiche shows. |
| `utils/` | `touristTaxFreeze.js` | C | Pure helpers: `carriesTaxInBalance(routing)`, `shouldFreeze(reservation, routing)` (rules 10-11), `reconstructFrozenBase(stored, property)` (rule 14). Unit-testable, and shared by the save path, the declaration and the migration so the three can never disagree. |
| `controllers/` | `reservationsController.js` | T | `calculatePrice` / `create` / `update`: pass the frozen inputs; on save, freeze when rule 10's instalment flips to paid. |
| `models/` | `reservationsModel.js` | T | Writes `touristTaxFrozenAt` + base + occupants + unit amount at the freeze; never clears them on un-collect. |
| `models/` | `financeModel.js` | T | `getTouristTaxExtraction`: `accommodationAmount` and `nightPricePerOccupantHt` come from the frozen columns when set, from the quote otherwise. The row becomes self-consistent again. |
| `database.js` | `database.js` | T | Idempotent migration: three columns + the backfill of rule 13. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Nothing new to send (`platformGrossAmount` is already in the quote signature). `freezeTouristTax` stops being derived from the dates on the client and is read from the quote instead — the server owns the freeze (rules 10-11), which retires the `isPastReservation` computation and its quote-signature entry. |
| `pages/` | `TouristTaxPage.jsx` | T | The base column is labelled « Montant du séjour HT » to match the office's field; the warning of rule 16 shows on the row. |
| `components/` | `PricingSummary.jsx` | T | Renders the rule-15 caption and the rule-16 warning. Still dumb: both come from the quote. |
| `components/reservation/` | `FinanceSection.jsx` | T | Helper text under « Brut plateforme »: it now drives the tourist-tax base. |

**Component reuse declaration**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PricingSummary`, `PageActionBar`, `ErrorAlert` | Pre-existing. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | — | None. |

### 4.3 API contract

No new endpoint. `POST /api/reservations/calculate-price` gains three response fields —
`touristTaxBaseHt`, `touristTaxOccupantsUsed`, `touristTaxFrozenAt` — and `touristTaxBrutInconsistent`
(boolean, rule 16). `GET /api/finance/tourist-tax` keeps its shape; `accommodationAmount` and
`nightPricePerOccupantHt` change source, not meaning.

---

## 5. Data model

Three columns on `reservations` (which holds devis too), added idempotently in `database.js`:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `touristTaxFrozenAt` | TEXT | NULL | When the amount stopped moving. NULL = live. |
| `touristTaxFrozenBaseHt` | REAL | NULL | The stay's accommodation HT the frozen amount was computed on. |
| `touristTaxFrozenOccupants` | INTEGER | NULL | The divisor used. |
| `touristTaxFrozenUnitAmount` | REAL | NULL | €/adulte/nuit, so the line needs no re-derivation. |

**Backfill (rule 13).** One pass over every `reservations` row: `touristTaxFrozenAt = <migration
timestamp>`, and base/occupants/unit reconstructed per rule 14 (left NULL where the inversion does
not apply). Idempotent: rows already carrying `touristTaxFrozenAt` are skipped.

**Data impact.** No existing value is rewritten — `touristTaxTotal` is read, never touched. The
migration only adds the frozen envelope around it. A pre-migration backup is taken by the existing
startup routine.

---

## 6. UI / UX

**Fiche réservation — bloc « Taxe de séjour ».** The caption becomes
« (381,82 € HT ÷ 3 nuits ÷ 5 occupants) × 5,00 % + 10,00 % dep = 1,40 €/adulte/nuit », followed by
« figée le 03/08/2026 » in `text.secondary` when frozen. The « Recalculer » button keeps its current
placement and tooltip. Rule 16's warning renders as an inline `ErrorAlert` under the line.

**Suivi taxe de séjour.** The « Hébergement » column is renamed **« Montant du séjour HT »** — the
office's own wording — and now always agrees with the amount on its right. No layout change.

**Responsive.** No new element that is not inline text inside blocks that already adapt. On `xs` the
caption wraps to two lines (already the case) and the table keeps its existing horizontal scroll.
Checked at `xs` / `md` / `lg`.

**PageActionBar.** Unchanged on both pages; no new page-level action.

---

## 7. Test plan

### Server unit tests

- [x] `tests/tourist-tax-base-accommodation-only.unit.test.js` — extended: the brut derives the base
      again, net of the extras billed through it; a « Complément » line is NOT subtracted; an
      inconsistent brut floors at 0 and raises rule 16. 10 tests.
- [x] `tests/tourist-tax-included-services-deduction.unit.test.js` — extended: the inclusions come out
      of the brut too. 11 tests.
- [x] `tests/tourist-tax-occupants-exclude-babies.unit.test.js` — rule 8, and that a cot still bills
      its supplement. 5 tests.
- [x] `tests/tourist-tax-freeze-on-collection.unit.test.js` — rules 10-12: the right instalment per
      routing, « Déclarée », no thaw on un-collect, the stamp that never moves, an offered tax that
      never freezes. 8 tests.
- [x] `tests/tourist-tax-legacy-base-reconstruction.unit.test.js` — rules 13-14: the 13 production
      amounts round-trip, the two operator-checked stays rebuild the base he typed by hand, the
      migration freezes only the collected/declared, and it is idempotent. 6 tests.
- [x] `tests/tourist-tax-declaration-mirrors-the-fiche.unit.test.js` — renamed from
      `tourist-tax-declaration-included-services`: the declaration reports the fiche's amount and a
      base that reproduces it, and a re-priced property moves neither. 6 tests.
- [x] `tests/pricing-auto-options.unit.test.js` — updated for rule 8 (the divisor drops the baby).

Server 3868 pass, client 1199 pass.

### Manual UI verification

- [ ] Foulon (22269) and Esteve (22209) are unchanged after the migration — same amount, and now a
      base that reproduces it in the office's form (381,82 € and 217,45 € HT).
- [ ] Carpier (22275) and Maisonnette (22211), booked but uncollected, re-price to 21,33 € and
      3,36 € and stay re-priceable until collected.
- [ ] A new Lodgify booking: entering the brut moves the tax; collecting the balance freezes it;
      changing the brut afterwards does not.
- [ ] A new Abracadaroom booking: the tax rides the arrival complement and freezes on its payment.
- [ ] A stay with a cot divides by adults + children only.
- [ ] A brut smaller than the billed extras shows the rule-16 warning.
- [ ] Regression: the Gîte's per-night tax is untouched; the accounting export and the
      encaissements table still balance.
- [ ] Mobile (`xs`): the fiche caption and the Suivi table read correctly.

---

## 8. Out of scope

- Any change to which stays the « Suivi taxe de séjour » page lists (the attribution month, the
  payment gate, the platform routing). Carpier (22275) is absent from August because nothing is
  collected on it — that stays a data issue to settle on the fiche, not a rule to bend here.
- Reconciling the 13,05 € already filed by hand for Carpier with the amount its collection will
  eventually declare (see the edge case in §3).
- The three-way per-platform routing itself.
- The VAT rate used to go from TTC to HT (10 %, `app_settings.vatRate`).
- The Gîte's `per_day_per_person` mode.
- Retroactively re-declaring an already-remitted month.

## 9. Open questions

- Q: Does the office count a baby among the occupants of its « Nombre d'occupants » field?
  - A: **Resolved 2026-09-01** — no. The Carpier declaration was filed with 4 occupants for 3 adults
    + 1 child + 1 baby, and the operator confirms babies are out. Rule 8.
- Q: On a platform booking, does « Montant du séjour HT » mean what the guest paid the platform, or
  the tariff of our own grid?
  - A: **Resolved 2026-09-01** — what the guest paid the platform, extras excluded. Rule 2.
- Q: Does the extra-guest surcharge belong to the accommodation?
  - A: **Resolved 2026-09-01** — no, it is subtracted from the brut. Rule 4. Noted for the record:
    this declares less than the guest paid to sleep (Foulon 14,70 € against the 21,00 € collected),
    and it is a deliberate operator decision, not an engine constraint.
- Q: Do bookings already made but not yet collected keep their old amount?
  - A: **Resolved 2026-09-01** — no, they re-price. The freeze protects what the guest has paid, not
    what he is about to be asked for. Rule 13.
- Q: Should the office confirm the surcharge exclusion in writing?
  - A: Open. The rule ships as decided; if the office says otherwise, only rule 4 changes and rule 10
    protects everything already collected.
