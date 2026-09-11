# The tourist tax the platform keeps leaves the commission

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/platform-tourist-tax-out-of-the-commission` |
| **Created** | 2026-09-11 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On a platform that collects the tourist tax from the guest **and** remits it to the commune itself
(mode `platform` — Gîtes de France, Booking, Airbnb, Greengo; see
[per-platform-tourist-tax-three-way.md](per-platform-tourist-tax-three-way.md)), three numbers sit on
the platform's statement and only two of them are ours:

```
Gîtes de France — Grimaud #22225, 26–28 June 2026
  Prix location                653,00
  Options / forfait ménage      80,00
  Taxe de séjour                14,40   ← collectée ET reversée par la centrale
  ─────────────────────────────────────
  Payé par le client           747,40
  Virement propriétaire        668,00
```

The real commission is **65,00** (= 747,40 − 668,00 − 14,40). What GuestFlow computes depends
entirely on which number the operator typed in « Paiement plateforme ».

[platform-brut-excludes-offered-tourist-tax.md](platform-brut-excludes-offered-tourist-tax.md)
answered that on 2026-08-24, after the accountant's report on this very reservation: the field was
renamed « Total séjour facturé par la plateforme », the operator types **733,00** (the stay total,
tax excluded), and `commission = brut − virement` lands on 65,00 without anything being deducted.
That spec removed the old deduction for a good reason — the engine was subtracting **its own
estimate** of the tax, which is never the platform's figure (Booking bills 4,4 % of the stay where we
compute a per-person nightly rate), so the subtraction could not reconcile even when the total did
contain the tax.

Two things are wrong with that answer in daily use:

- **The operator reads 747,40 on the statement and has to do the subtraction in their head** before
  typing. Every platform prints the guest-paid total; none prints « the stay total minus the tax ».
- **Nothing anywhere holds the platform's actual tax figure.** The one number that would make the
  deduction safe — the tax as the platform itself computed it — has no field, so the choice was
  between deducting a wrong estimate and deducting nothing.

The operator reported the symptom on 2026-09-11: on a platform booking the commission comes out too
high by the tourist tax, because the natural number to type is the one the guest paid.

## 2. Goal

On a platform that keeps the tourist tax and remits it to the commune, the operator types the two
numbers printed on the statement — **what the guest paid** and **how much of it was tourist tax** —
and GuestFlow lands on the right commission, the right revenue and the right VAT base by itself. The
tax is visible on the reservation summary, struck through, so it can be read without ever being
counted.

---

## 3. Functional rules

### 3.1 What the box holds

1. **« Paiement plateforme » gains a « Taxe de séjour retenue » box**, shown **only** on a non-direct
   reservation whose platform collects the tourist tax from the guest **and** remits it to the commune
   itself (`touristTaxOfferedByPlatform`, mode `platform`). The `platform_reversed` mode (the platform
   wires the tax back to us — Lodgify), the `owner` mode (we collect it at check-in —
   Abracadaroom) and direct bookings never show it and never read it.

2. **Empty means nothing is withheld — and that is the old convention.** An empty box says the brut
   that was typed does **not** contain any tourist tax, which is exactly how
   [platform-brut-excludes-offered-tourist-tax.md](platform-brut-excludes-offered-tourist-tax.md)
   rule 1 reads it today. Nothing is subtracted anywhere. Every reservation saved before this spec is
   in that state, so **no revenue and no commission already exported to the accountant moves by a
   cent**, and there is no migration and no backfill.

3. **A value means the brut is tax-inclusive.** As soon as the box carries an amount, « Montant total
   payé par le client » is read as the statement's guest-paid total, tourist tax included, and the box
   is the share of that total the platform keeps for the commune.

4. **A brand-new reservation arrives with the engine's figure in the box.** On a fiche that has never
   been saved, whose platform is in mode `platform`, the box is pre-filled with the engine's tourist
   tax (`touristTaxOriginalTotal`). The amount stays freely editable and is the operator's from then
   on: **the platform's number wins over our estimate**, so once the box is non-empty nothing rewrites
   it — not a change of party size, not a change of dates. To withhold nothing on a new fiche, type
   `0` (an explicit zero is not an empty box, rule 15).

5. **« Reprendre le calcul » fills the box with the engine's figure**, on any fiche including one
   saved before this spec. It is the only way an existing reservation moves to the tax-inclusive
   convention, and it takes a deliberate click: nothing switches on its own.

### 3.2 What the engine does with it

6. **The brut back-solve subtracts the withheld tax**:
   `accommodation = max(0, brut − extraGuestSurcharge − pre-arrival options/resources − withheldTax)`.
   So `finalPrice = brut − withheldTax`, and the revenue (accommodation + options) excludes the tax.
   An empty box makes the term `0`, leaving the back-solve byte-identical to today.
   Grimaud: brut 747,40, withheld 14,40 → `finalPrice` 733,00, accommodation 653,00, options 80,00.

6bis. **The declared tax base drops the withheld tax too — no tax on the tax.** Since
   [tourist-tax-matches-the-office-calculation.md](tourist-tax-matches-the-office-calculation.md)
   rules 1-7, the base we declare to the office is derived from the brut
   (`taxAccommodationPaid = brut − pre-arrival options/resources`, then minus the included services
   and the extra-guest surcharge). A tax-inclusive brut would therefore inflate the base by the tax
   itself — invisible on the Gîte (`per_day_per_person`, the base doesn't drive the amount) but real
   on the Lodge (`percentage_accommodation`). So the withheld tax leaves that base as well. There is
   no circularity: the withheld amount is typed by the operator, never computed from the base.
   **This amends** that spec's rule 2.
   Practically the pre-fill never sees an inflated base either: on a new fiche the brut is still
   empty when the box is filled (rule 4), so the estimate comes from the tariff.

7. **VAT never carries the tourist tax.** It is computed on the accommodation and the options, which
   rule 6 has already stripped of the withheld tax. This is mechanical once rule 6 holds, and it is
   the reason the tax-excluded amount is printed in the block (rule 12).

8. **The withheld tax stays out of our books.** In mode `platform` the tax never transits through our
   accounts: neither *Suivi taxe de séjour* nor the accounting export reads
   `platformTouristTaxAmount`. The box only tells the engine how much to take out of the brut.

9. **The withheld amount is the one the quote publishes.** The quote exposes
   `platformTouristTaxWithheld` — the box's amount when it is set, `null` otherwise — beside the
   unchanged `touristTaxOriginalTotal` (the engine's own estimate, still what « Reprendre le calcul »
   offers). Everything that displays the tax for this mode reads `platformTouristTaxWithheld ??
   touristTaxOriginalTotal`.

### 3.3 What it does to the commission

10. **« Calculer la commission » subtracts the withheld tax**:
    `commission solde = max(0, brut − virement reçu − withheldTax − commission acompte)`.
    An empty box reproduces the August formula (`brut − virement − commission acompte`) exactly.
    Grimaud: 747,40 − 668,00 − 14,40 − 0 = **65,00**, where today's formula on the guest-paid total
    would give 79,40.

11. **« Net perçu » and the écart reconcile with no new code.** `preArrivalAmount = finalPrice =
    brut − withheldTax`, so `net perçu = brut − withheldTax − commission`, which is the virement. The
    reconciliation chip goes green on the statement's own numbers.

### 3.4 What it looks like

12. **The block prints the tax-excluded amount** under the box: it is the figure that carries the VAT
    and the one the commission is computed on, and it is no longer the number typed above. Shown only
    when the box is non-empty (otherwise it is the brut itself).

13. **The summary strikes the tax through.** On a reservation in mode `platform` the « Taxe de
    séjour » line shows the withheld amount **struck through**, beside the existing « Plateforme »
    tag, and the « Total du séjour » cascade deducts that same amount on « Taxe de séjour
    (plateforme) ». It is struck because it enters neither what we collect nor our books — it is
    printed to be read, not to be counted.
    **This is a repair, not a new decision.**
    [per-platform-tourist-tax-three-way.md](per-platform-tourist-tax-three-way.md) §6 already ruled
    on 2026-06-20 that the case-2 amount is « shown **struck-through** with no « Offert » badge », and
    its §4.2 says the same. The code shipped it plain, under a comment asserting the opposite
    (« NOT struck-through (it isn't « offert ») ») — a rule written and never built, which is the
    failure mode [spec-rule-coverage.md](spec-rule-coverage.md) exists to catch. The strike does not
    say *free*, it says *not ours*. Found 2026-09-11 while implementing this spec.

14. **The brut's label and helper state the convention**, because which number to copy off the
    statement is exactly what produced both this report and the accountant's. In mode `platform` the
    field returns to « Montant total payé par le client » with a helper naming the tax box as the part
    that will be taken out of it.

**Edge cases**

15. `0` is not empty. An explicit zero computes like an empty box (nothing withheld) but records the
    operator's intent, so the new-fiche pre-fill (rule 4) does not put the engine's figure back.
    > **Sans test** — the distinction has no computed consequence; it is the `'' !== 0` guard the
    > pre-fill already needs, and rule 4's test is what pins the pre-fill not firing twice.
16. Brut smaller than options + withheld tax → the accommodation clamps at 0 (the existing
    `max(0, …)` guard), and the écart against the virement surfaces the inconsistent entry. The
    « brut incohérent » warning of
    [tourist-tax-matches-the-office-calculation.md](tourist-tax-matches-the-office-calculation.md)
    rule 16 counts the withheld tax in its threshold (`brut < pre-arrival options + extraGuest +
    withheldTax`), so a brut that covers the extras but not the tax it is supposed to contain is
    flagged rather than silently floored.
17. A platform switched out of mode `platform` (a global setting) → the box disappears and the stored
    amount goes inert: the engine stops reading it, the value stays in the database and becomes live
    again if the mode comes back. Same treatment as `platformGrossAmount` on a direct switch.
18. A reservation switched to `direct` → `platformTouristTaxAmount` is forced to `NULL`, exactly as
    `platformGrossAmount` and `platformPayoutAmount` are.
19. A past reservation with a frozen tax (`freezeTouristTax`) → « Reprendre le calcul » offers the
    frozen amount; once the box holds a value it no longer depends on the freeze.
20. A negative amount is rejected by the money validation and clamped to ≥ 0, like every other amount
    in the block.

---

## 4. Architecture

> **Fat backend, thin frontend.** The withheld amount is one stored number; the subtraction from the
> brut, the resulting revenue/VAT split and the published `platformTouristTaxWithheld` all live in the
> pricing engine. The client renders the box, prints two server numbers, and computes the commission
> in the « Calculer » button — a one-shot local arithmetic on values the operator just typed, which is
> where that formula already lives ([platform-payment-calculer-button.md](platform-payment-calculer-button.md)).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | [database.js](../server/src/database.js) | T | Idempotent, PRAGMA-guarded `ALTER TABLE reservations ADD COLUMN platformTouristTaxAmount REAL`. No backfill (rule 2). |
| `schema.sql` | [schema.sql](../server/src/schema.sql) | T | The column on the `CREATE TABLE reservations` for fresh installs. |
| `utils/pricing.js` | [pricing.js:2058](../server/src/utils/pricing.js#L2058) | T | Accept `platformTouristTaxAmount`. Resolve `withheldTouristTaxInBrut` = the amount when the box is set **and** `platformGrossPin != null` **and** `isTouristTaxOfferedByPlatform`, else `0`; subtract it in `pinnedAccommodation` beside the existing `reversedTouristTaxInBrut`. Publish `platformTouristTaxWithheld` in the quote (rule 9); `touristTaxOriginalTotal` keeps its meaning. |
| `models/reservationsModel.js` | [reservationsModel.js:1337](../server/src/models/reservationsModel.js#L1337) | T | Persist `platformTouristTaxAmount` on insert/update (`NULL` on direct, rule 18); expose it from the reservation detail mapping. |
| `controllers/reservationsController.js` | [reservationsController.js:612](../server/src/controllers/reservationsController.js#L612) | T | Validate it as money; forward it to the engine in `calculatePrice` **and** `create`/`update`, so the live preview and the persisted books price identically (the defect [platform-payment-entry.md](platform-payment-entry.md) §4.1 had to fix for `platformGrossAmount`). |
| `models/accountingModel.js` | — | — | (none — rule 8: mode `platform` books no tax.) |
| `models/financeModel.js` | — | — | (none — rule 8: *Suivi taxe de séjour* excludes platforms that remit themselves.) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | [reservation/FinanceSection.jsx:693](../client/src/components/reservation/FinanceSection.jsx#L693) | T | The « Taxe de séjour retenue » box + « Reprendre le calcul » (rules 1, 5), the tax-excluded caption (rule 12), the brut label/helper for mode `platform` (rule 14), and the withheld term in `computeCommissionFromPayout` (rule 10). |
| `components/` | [PricingSummary.jsx:649](../client/src/components/PricingSummary.jsx#L649) | T | Read `platformTouristTaxWithheld ?? touristTaxOriginalTotal` for the tax line, for `grossTotal` and for the cascade's `offeredTax`; strike the amount through in mode `platform` (rule 13). |
| `pages/` | [ReservationPage.jsx:365](../client/src/pages/ReservationPage.jsx#L365) | T | Form field + default, load from the reservation, add it to the quote signature and to the calc/save payloads, and pre-fill it from the server's `touristTaxOriginalTotal` on a never-saved fiche (rule 4). |
| `api.js` | — | — | (none — the reservation payloads pass through.) |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `ArithmeticTextField`, `StatusBadge`, MUI `Button`/`Tooltip` | The box is an `ArithmeticTextField` like every other amount in the block (accepts `14,40` and `12+2,40`). |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | — | None; the box is two existing components inside a block that already exists. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/calculate-price` | `+ platformTouristTaxAmount` | `+ platformTouristTaxWithheld` | `null` when the box is empty or the mode isn't `platform`. |
| POST | `/api/reservations` | `+ platformTouristTaxAmount` | unchanged shape | `NULL` on direct. |
| PUT | `/api/reservations/:id` | `+ platformTouristTaxAmount` | unchanged shape | Same validation as the other platform amounts. |

Backward compatible: a payload without the field behaves exactly as today (rule 2).

---

## 5. Data model

```sql
ALTER TABLE reservations ADD COLUMN platformTouristTaxAmount REAL;   -- nullable, no default
```

`NULL` = no tax withheld = the brut is tax-excluded (rule 2). Every existing row stays `NULL`.

**Data impact:** additive and inert. No backfill, no recompute, no re-save of past reservations — the
17 platform reservations currently holding a brut in mode `platform` (Gîtes de France 7, Booking 6,
Airbnb 3, Greengo 1, May → August 2026, already exported to the accountant) keep their stored amounts
to the cent. Arbitrated 2026-09-11, §9 Q2.

> **Corrected 2026-09-11** — an earlier count said 11, read off `ical_sources`. The mode is resolved
> from the GLOBAL `platforms` table (`resolveGlobalPlatformTaxRow`, and
> [per-platform-tourist-tax-three-way.md](per-platform-tourist-tax-three-way.md) §1: the per-property
> `ical_sources` tax columns are deprecated and no longer read). Booking is globally `1/1` — it remits
> to the commune itself — so its 6 reservations are in scope, and Lodgify's 8 (not 6) are the ones
> outside it. The guarantee is unchanged: an empty box moves none of them.

---

## 6. UI / UX

### « Paiement plateforme » — mode `platform` only

```
Paiement plateforme
  Montant total payé par le client   [ 747,40 ]   Virement reçu (contrôle)  [ 668,00 ]
     Total du relevé, taxe de séjour comprise.
     La taxe saisie ci-dessous en est déduite.

  Taxe de séjour retenue             [  14,40 ]   [ Reprendre le calcul ]
     Collectée par la plateforme et reversée à la commune — jamais encaissée par nous.
     Montant hors taxe de séjour : 733,00 € (base TVA et base de commission).

  [ Calculer la commission ]   Net perçu : 668,00 €   ✓ cohérent avec le virement
```

- The « Taxe de séjour retenue » box appears **only** in mode `platform`. The other two modes keep
  today's block untouched, labels included.
- « Reprendre le calcul » is `variant="text" size="small"`, tooltip « Reprendre le calcul du moteur :
  14,40 € ». Disabled when the reservation is locked.
- « Montant hors taxe de séjour » is a `caption` under the box, printed only when the box is
  non-empty.

### Reservation summary

```
Taxe de séjour  [Plateforme]                         1̶4̶,̶4̶0̶ ̶€̶
  Collectée et reversée à la commune par la plateforme

Total du séjour                                      747,40 €
  − Taxe de séjour (plateforme)                       14,40 €
  Montant soumis à commission                        733,00 €
  − Commission solde                                  65,00 €
  Versement plateforme                               668,00 €
```

The struck amount is the withheld one. The cascade now lands on the statement's own three numbers.

### Responsive

- The block's `Grid` keeps `md=6` columns: the brut and the virement share a row on `md+`, the tax box
  takes the next row with « Reprendre le calcul » beside it. On `xs` everything stacks full-width, the
  button wrapping under the box (`flexWrap` is already on the row).
- The « hors taxe » caption wraps on `xs`; no horizontal scroll.
- The struck summary line is unchanged in layout — only a `textDecoration` on the existing amount.
- Touch targets: « Reprendre le calcul » is an MUI `Button` (≥44 px high with `size="small"` +
  `minHeight: 44`).

### Sticky action bar

No page-level action changes. `ReservationPage` keeps its existing `PageActionBar` (title, save,
cancel, PDF/sync/delete slots) untouched.

---

## 7. Test plan

### Server unit tests

- [ ] `tests/platform-tourist-tax-out-of-the-commission.unit.test.js` (new)
  - rule 1 — the withheld amount is read only in mode `platform`; ignored on `platform_reversed`,
    `owner` and direct (rules 1, 17)
  - rule 2 — empty box → `finalPrice`, accommodation and VAT byte-identical to today's brut path
  - rule 3 + 6 — brut 747,40 + withheld 14,40 → `finalPrice` 733,00, accommodation 653,00 with an
    80,00 option
  - rule 6bis — the declared tax base drops the withheld tax (checked on a
    `percentage_accommodation` property, where it would otherwise tax the tax)
  - rule 7 — the VAT base excludes the withheld tax
  - rule 9 — the quote publishes `platformTouristTaxWithheld` (amount when set, `null` when empty),
    `touristTaxOriginalTotal` unchanged
  - rule 11 — `preArrivalAmount` and `platformNetReceivedAmount` reconcile to the virement
  - rules 16, 19, 20 — clamp at 0 when the brut is smaller; frozen tax; negative rejected
- [ ] `tests/reservations-platform-commission-persistence.unit.test.js` (extend) — rules 8, 18:
  round-trip the column, `NULL` on direct, and neither the accounting entry nor the tourist-tax
  extraction moves when the box is filled.

### Client (vitest)

- [ ] `components/reservation/__tests__/FinanceSection.platform-tourist-tax.test.jsx` (new) — rules
  1, 4, 5, 10, 12, 14, 15: the box renders in mode `platform` only; pre-filled on a new fiche and not
  rewritten once touched; « Reprendre le calcul » fills it; « Calculer la commission » gives 65,00 on
  the Grimaud numbers and the August value when the box is empty; the tax-excluded caption; the brut
  label.
- [ ] `components/__tests__/PricingSummary.platform-tourist-tax.test.jsx` (new) — rule 13: the amount
  is struck through with the « Plateforme » tag, and the cascade deducts the withheld amount.

### Full suites

- [ ] `cd server && npm test`
- [ ] `cd client && npx vitest run`
- [ ] `npm run test:e2e`
- [ ] `node scripts/check-spec-coverage.mjs --spec platform-tourist-tax-out-of-the-commission`

### Manual UI verification

- [ ] Gîtes de France fiche, new: box pre-filled at the engine's figure; type brut 747,40 + virement
  668 → « Calculer la commission » gives 65,00, « Net perçu » 668,00 with the green chip, summary
  strikes 14,40 and the cascade prints 747,40 / −14,40 / 733,00 / −65,00 / 668,00.
- [ ] Save, reload: every amount repopulates; the box is not re-filled by the engine.
- [ ] An existing Gîtes de France fiche (box empty): nothing moved — same total, same commission as
  before the change. « Reprendre le calcul » fills 14,40 and the amounts shift only then.
- [ ] A Lodgify (`platform_reversed`) and an Abracadaroom (`owner`) fiche: no box, block unchanged.
- [ ] Mobile (`xs`): the box and its button stack, no horizontal scroll.

### Spec sync (CLAUDE.md §4.1)

- [ ] [platform-brut-excludes-offered-tourist-tax.md](platform-brut-excludes-offered-tourist-tax.md)
  rules 1, 3 and 7 annotated: the tax-excluded brut becomes the *empty-box* case, not the only case.
- [ ] [per-platform-tourist-tax-three-way.md](per-platform-tourist-tax-three-way.md) annotated: the
  mode-`platform` amount is struck through (rule 13).
- [ ] `changelog.d/fixed--platform-tourist-tax-out-of-the-commission.md`.

---

## 8. Out of scope

- **The `platform_reversed` mode** (Lodgify — the only platform in it). There the tax is inside both the brut and the
  virement, so it is not withheld from anything and the engine's own estimate keeps driving the
  back-solve. Arbitrated 2026-09-11, §9 Q3. Giving that mode its own operator-entered tax figure is a
  separate change.
- **Reading the tax off the platform** (statement e-mail, API import). Manual entry only.
- **Repairing past reservations.** Untouched by design (rule 2); moving one to the new convention is
  a deliberate « Reprendre le calcul » + re-typed brut, fiche by fiche.
- **Platform booking fees** (the 36,65 € « frais de dossier » on the Gîtes de France contract). They
  are the guest's, never ours, and stay outside the brut as they are today.

## 9. Open questions

- **Q1 — Which number does the operator type in « Montant total payé par le client » for a
  mode-`platform` booking?**
  - **A (2026-09-11):** the **guest-paid total, tourist tax included** (747,40), with the new box
    saying how much of it is tax. This reverses the entry convention of
    `platform-brut-excludes-offered-tourist-tax.md` while keeping its result: the engine still never
    subtracts its own estimate — it subtracts the operator's figure, which is the platform's.
- **Q2 — What happens to the 17 platform reservations already holding a brut in mode `platform`?**
  - **A (2026-09-11):** **nothing**. An empty box is the old convention (rule 2), so no already
    exported revenue or commission moves. Moving a fiche over is a deliberate click (rule 5).
- **Q3 — Does the box also apply to `platform_reversed`?**
  - **A (2026-09-11):** **no** — mode `platform` only. Those 8 Lodgify reservations reconcile to
    the cent today and must keep doing so.
