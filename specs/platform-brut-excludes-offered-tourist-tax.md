# The platform brut excludes the tourist tax the platform collects and remits

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/platform-brut-excludes-offered-tourist-tax` |
| **Created** | 2026-08-24 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The accountant reported that the journal entries GuestFlow exports for platform bookings under-state
the commission. Her worked example — Stéphane Grimaud, réservation #22225, Gîtes de France, 26–28 June
2026 — is what this spec repairs.

**What GuestFlow exported** vs **what the accountant expects**:

| Line | GuestFlow | Expected |
|---|---|---|
| Client (CGRIMAU) — debit | 668,00 | 668,00 |
| 622600 commission HT — debit | 50,60 | **54,17** |
| 44566000 TVA déductible/commission — debit | *(absent)* | **10,83** |
| 70600000 location gîte — credit | 580,55 | **593,64** |
| 70600010 prestation complémentaire — credit | 72,73 | 72,73 |
| 44571100 TVA 10 % — credit | 65,32 | **66,63** |
| **Total** | 718,60 | **733,00** |

Two independent defects produce that gap.

### Defect 1 — GuestFlow subtracts its own tourist-tax estimate from an amount that never contained it

`specs/platform-offered-tax-passthrough-and-cascade.md` rule 1 assumes that when a platform collects
the tourist tax **and** remits it to the commune itself (the « offered » case —
`collectsTouristTax = 1` + `touristTaxRemittedByPlatform = 1`: Gîtes de France, Booking, Airbnb), the
amount the operator types in « Montant total payé par le client » **includes** that tax, and that the
platform withholds it from the payout on top of its commission. Both halves of the assumption are
false for Gîtes de France, as its own contract screen shows:

```
Prix location                  653 €
Options / Forfait ménage        80 €
Taxe de séjour               14,40 €   ← « comprise dans le montant de la réservation,
                                          votre centrale se charge de la collecter et de la reverser »
Montant net propriétaire       668 €
Prix total client           784,05 €   (dont 36,65 € de frais de dossier)
```

The operator naturally types the owner-facing total **733** (= 653 + 80), which excludes the tax. The
engine then subtracts its own estimate of the tax (6 adults × 2 nuits × 1,20 € = 14,40 €) twice over:

- from the brut back-solve ([pricing.js:2062](../server/src/utils/pricing.js#L2062)) → `finalPrice`
  lands on 718,60 instead of 733, so the CA and the VAT collected are both under-stated;
- from « Calculer la commission »
  ([FinanceSection.jsx:506](../client/src/components/reservation/FinanceSection.jsx#L506)) → the stored
  commission is 50,60 instead of the real 65,00 (= 733 − 668, which the GdF invoice details as
  54,17 HT + 10,83 de TVA).

The entry still balances, which is why nothing ever flagged it: it is wrong by 14,40 € on both sides.

Booking makes the same subtraction unsafe for a second reason. Its guest-side breakdown for Lydianne
Foury (17–19 July 2026) reads `Sous-total 1 267,32` + `Taxe de séjour 4.4 % = 16,02` =
`1 283,34`. GuestFlow's own estimate for that stay is 19,20 € (8 adultes × 2 nuits × 1,20 €). Even
when a platform's total *does* include the tax, our estimate is not the platform's number, so
subtracting it can never reconcile. The measured impact across the dev copy of prod: 13 reservations,
209 € of commission missing (GdF 140,40 · Booking 32,77 · Greengo 24,00 · Airbnb 12,26).

### Defect 2 — the Gîtes de France commission is booked without VAT

The `GitesDeFrance` platform row has `hasVatOnCommission = 0`, so the export writes the whole
commission on 622600 with no deductible-VAT line. The GdF invoice (54,17 + 10,83 à 20 %) proves the
flag must be `1`. This is operator configuration (Comptabilité → plateformes), not code, but it is
part of the same accountant report and is tracked here so the fix isn't half-applied.

## 2. Goal

For a platform that collects the tourist tax and remits it to the commune itself, the operator enters
the stay total the platform bills them — the number printed on the platform's own statement — and
GuestFlow books the full amount as revenue with the full commission, without ever deducting a
tourist-tax figure it estimated itself.

## 3. Functional rules

1. **New definition of the brut for the « offered » tax case.** On a non-direct reservation whose
   platform collects the tourist tax **and** remits it to the commune itself
   (`touristTaxOfferedByPlatform`), `platformGrossAmount` is the **stay total the platform bills, tourist
   tax excluded and platform booking fees excluded** — 733,00 on the GdF contract above, the
   `Sous-total` 1 267,32 on the Booking breakdown. It is no longer « what the guest paid ».
2. **The engine stops taking the offered tax out of the brut.** The back-solve becomes
   `accommodation = max(0, brut − extraGuestSurcharge − pre-arrival options/resources − reversedTax)`;
   the `offeredTouristTaxInBrut` term is removed. Consequence for Grimaud: `finalPrice = 733,00`,
   accommodation = 653,00, options = 80,00.
   **This supersedes rule 1 of `specs/platform-offered-tax-passthrough-and-cascade.md`**, which must be
   annotated in the same commit.
3. **« Calculer la commission » stops subtracting the offered tax.** The formula is uniformly
   `commission solde = brut − virement reçu − commission acompte`, clamped ≥ 0, for every tax mode.
   Grimaud: 733 − 668 − 0 = **65,00**.
4. **The « reversed » case is untouched** (`collectsTouristTax = 1` + `touristTaxRemittedByPlatform = 0`
   — Lodgify). There the platform charges the tax to the guest and wires it back to us, so it sits in
   both the brut and the virement: the brut stays tax-inclusive, the back-solve keeps subtracting
   `reversedTouristTaxInBrut`, and the commission is already `brut − virement`. The 6 Lodgify
   reservations measured reconcile to the cent today and must keep doing so.
5. **The « owner » case is untouched** (`collectsTouristTax = 0` — Abracadaroom). The tax never enters
   the platform flow; it is collected by us at arrival, in the complement.
6. **Direct bookings are untouched** — no brut, no commission, no platform tax mode.
7. **The field label states the convention**, because the correct number to type now depends on the
   platform's tax mode (§6). A wrong assumption here is exactly what produced the accountant's report,
   so the convention must be readable at the point of entry, not inferred.
8. **`hasVatOnCommission = 1` for Gîtes de France** (operator action in Comptabilité → plateformes, on
   dev **and** on prod). With it, the export splits the 65,00 € into 54,17 € on 622600 and 10,83 € on
   44566000, exactly as the GdF invoice states. Booking and Airbnb stay at `0` (VAT self-assessed for
   those platforms); Greengo is already at `1`.
9. **No change to the accounting model.** With rules 2 and 8 applied, `accountingModel` +
   `accountingExport` already produce the accountant's six lines, unchanged:
   client 668,00 / 622600 54,17 / 44566000 10,83 // 70600000 593,64 / 70600010 72,73 / 44571100 66,63.
   Verified by arithmetic on the export path; rule 15 turns it into a test.
10. **No repair of past reservations** (decided 2026-08-24). The accountant corrects the already-filed
    entries herself. GuestFlow ships the behaviour fix only; no migration, no backfill, no re-save
    sweep.

**Edge cases:**

- **Re-saving an old platform reservation changes its books.** Once rule 2 ships, reopening and saving
  a pre-existing GdF/Booking/Airbnb reservation re-prices it and raises its `finalPrice` by the tax
  (Grimaud: 718,60 → 733,00). That is the *correct* number, but it moves a month the accountant may
  already have filed. The behaviour is accepted as-is (rule 10 leaves history alone precisely so that
  nothing moves without an operator action) — worth knowing, not worth blocking.
- **A platform's tax mode changed after bookings were entered** → the stored brut of those bookings was
  typed under the previous convention and is not re-interpreted. They need a manual re-check; nothing
  automatic.
- **Brut < billed options/resources** → accommodation clamps to 0, unchanged.
- **Our tourist-tax estimate ≠ the platform's** (Booking: 19,20 vs 16,02) → irrelevant after this
  change, since no computation subtracts it from an operator-entered amount any more. This is the main
  robustness gain: the books stop depending on GuestFlow guessing a third party's tax arithmetic.

---

## 4. Architecture

> **Fat backend.** The pricing rule lives in the engine; the client only relabels a field and drops one
> term from the on-demand commission helper (a UI convenience that fills an editable field — it never
> decides what is booked).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pricing.js` | T | Remove `offeredTouristTaxInBrut` from the pinned-accommodation back-solve (~L2058-2062); the `reversedTouristTaxInBrut` term stays. Quote fields (`touristTaxOriginalTotal`, `touristTaxOfferedByPlatform`) are unchanged — the cascade still consumes them. |
| `models/` | `accountingModel.js` | — | (none — rule 9) |
| `utils/` | `accountingExport.js` | — | (none — rule 9) |
| `database.js` | — | — | (none — no schema change) |
| `tests/` | `pricing-platform-tourist-tax-reversed-brut.unit.test.js` | T | Invert the « offered tax is taken OUT of the brut » test into « the brut is already net of the offered tax → `finalPrice = brut` »; the reversed + owner guards stay as they are. **Also hosts the Grimaud regression** (GdF, 6 adultes + 2 enfants, 2 nuits, brut 733, ménage 80 → `finalPrice` 733, accommodation 653, net 668): this is the only pricing fixture with a `platforms` table + a tourist tax, which the case needs. |
| `tests/` | `accounting-offered-tax-platform-entry.unit.test.js` | C | End-to-end proof of the accountant's entry: the Grimaud reservation through `accountingModel` + `accountingExport` yields the six lines of §1, balanced at 733,00, with `hasVatOnCommission = 1`. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `FinanceSection.jsx` | T | Drop `offeredTouristTax` from `computeCommissionFromPayout`; make the brut field's label + helper text depend on the platform's tax mode (§6). |
| `components/` | `PricingSummary.jsx` | — | (none) — the cascade adds `touristTaxOriginalTotal` to « Total du séjour » then subtracts it again as « Taxe de séjour (plateforme) », so « Montant soumis à commission » still lands on `finalPrice` = the brut. The arithmetic is unchanged by this spec. |
| `pages/` | `ReservationPage.jsx` | — | (none — no new field) |
| `__tests__` | `FinanceSection.platform-no-deposit.test.jsx` | T | Invert the « subtracts the tourist tax when the platform collects + remits » test (L171) into « never subtracts the tax, whatever the mode »; keep the acompte-commission and disabled-state tests. Add the mode-dependent helper text. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `ArithmeticTextField` | Already used by the « Paiement plateforme » block; unchanged. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `FinanceSection` block | Existing; only its copy and one helper formula change. |

### 4.3 API contract

Unchanged. `platformGrossAmount` keeps its name, type and place in
`POST /api/reservations`, `PUT /api/reservations/:id` and `…/calculate-price`. Only its **meaning** for
offered-tax platforms changes, and with it the `finalPrice` the engine returns for the same input.

---

## 5. Data model

No schema change, no migration, no backfill (rule 10). `platformGrossAmount` and
`platformPayoutAmount` keep their columns and values.

**Data impact:** existing rows are left exactly as they are. Their stored `finalPrice` /
`platformCommissionAmount` remain those computed under the old convention until (and unless) an
operator re-saves the reservation — see the first edge case.

## 6. UI / UX

Only the « Paiement plateforme » block changes, and only its copy. The two fields, the « Calculer la
commission » button, the « Net perçu » line and the ✓/écart badge keep their layout and behaviour.

The first field's label and helper follow the platform's tourist-tax mode:

| Tax mode | Label | Helper |
|---|---|---|
| Platform collects **and** remits (GdF, Booking, Airbnb) | **Total séjour facturé par la plateforme** | « Hébergement + options, **hors taxe de séjour** et hors frais de dossier — l'hébergement s'ajuste automatiquement. » |
| Platform collects, **we** remit (Lodgify) | **Montant total payé par le client** | « Taxe de séjour comprise — la plateforme vous la reverse avec le virement. » |
| Platform doesn't collect (Abracadaroom) | **Montant total payé par le client** | « L'hébergement s'ajuste automatiquement (brut − options). La taxe de séjour est encaissée à l'arrivée. » |

- The « Calculer la commission » tooltip drops its tax mention: « Commission solde = total facturé −
  virement (− commission acompte éventuelle) ».
- **Responsive:** unchanged — the two fields are `xs=12 / md=6` (stacked on mobile), the button + net +
  badge sit in a wrapping `Stack`. The longer helper text simply wraps under the field on `xs`; no new
  horizontal overflow.
- **Sticky action bar:** `ReservationPage` already renders its bar; no page-level action is added or
  removed by this change.

## 7. Test plan

### Server unit tests (5 added/changed — full suite 3608 pass)
- [x] `pricing-platform-tourist-tax-reversed-brut.unit.test.js` (5) — rule 2: offered tax + brut →
      `finalPrice = brut` (was `brut − tax`); reversed case still `brut − tax`; owner case untouched;
      **Grimaud regression**: brut 733 + ménage 80 on GdF → `finalPrice` 733 / accommodation 653 /
      net perçu 668 with commission 65.
- [x] `accounting-offered-tax-platform-entry.unit.test.js` (4, new) — rules 8+9: the exported entry is
      668,00 / 54,17 / 10,83 // 593,64 / 72,73 / 66,63, balanced at 733,00; no 46710000 line; and the
      `hasVatOnCommission = 0` shape (Booking/Airbnb) still books the commission flat.

### Client (vitest — 22 in the file, full suite 1141 pass)
- [x] `FinanceSection.platform-no-deposit.test.jsx` — rule 3: the commission button never subtracts the
      tourist tax, in either mode, plus the Grimaud case (733 − 668 = 65); rule 7: the label + helper
      follow the tax mode.

### E2E (Playwright)
- [x] Full suite re-run after the client change: 65 passed, 1 skipped. No spec drives the « Paiement
      plateforme » block, so the coverage there is the vitest file above.

### Manual UI verification
- [ ] Réservation #22225 (Grimaud) on the dev copy of prod: brut 733 + virement 668 → « Calculer la
      commission » gives 65,00 ; « Net perçu 668,00 € » with the ✓ badge ; total séjour 733,00.
      _(not run — the fiche was not re-saved on purpose: re-saving would rewrite the stored money of a
      real reservation on the prod copy. Covered by the engine + accounting + component tests.)_
- [ ] Comptabilité → export of July 2026 (the month #22225 was collected): the entry shows the six
      expected lines once `hasVatOnCommission` is on for GdF. _(same reason — needs the fiche re-saved
      first; the export path itself is locked by `accounting-offered-tax-platform-entry`.)_
- [ ] Regression — a Lodgify reservation (e.g. #22271, Noviant): brut, commission, net and the ✓ badge
      unchanged. _(covered by the reversed-case unit + component tests.)_
- [ ] Mobile (`xs`): the « Paiement plateforme » block stacks, the longer helper wraps, no horizontal
      scroll. _(layout untouched — only the helper string changed.)_

## 8. Out of scope

- **Repairing the 13 reservations already booked with an under-stated commission** — the accountant
  corrects them on her side (decision 2026-08-24, rule 10).
- **Importing the platform's amounts automatically** (statement parsing, API): manual entry stays.
- **Deriving the commission from a percentage** per platform.
- **Platform booking fees** (36,65 € on the GdF contract): they are charged to the guest by the
  platform and never reach us — they stay outside the model entirely.
- **Rewriting the fiche cascade** (`PricingSummary`): its arithmetic is unaffected (§4.2).

## 9. Open questions

1. **Does Booking remit the tourist tax it collects, or wire it to us?** The guest paid
   1 283,34 € (1 267,32 + 16,02 de taxe) and the stored virement for #22219 is 1 075,27 € — which is
   `1 283,34 − 208,07`, i.e. **tax included in the payout**. If the bank statement confirms that
   figure, Booking is a *reversed* platform (like Lodgify), not an *offered* one, and the fix is a
   configuration change (`touristTaxRemittedByPlatform → 0`) rather than anything in this spec. If the
   real wire is 1 059,25 €, Booking is correctly configured today and rule 1 applies to it as written.
   - **Decision procedure:** read the Booking commission invoice for July 2026 — a commission of
     **192,05 €** means Booking keeps the tax (offered, config OK); **208,07 €** means the tax rides
     the payout (reversed, config to change). To ask the accountant / check on the Booking extranet.
2. **Same question for Airbnb** (3 reservations, 12,26 € total). Airbnb does collect and remit the
   French tourist tax in most communes, so the current « offered » config is probably right and those
   three lines may already be correct. To confirm on an Airbnb payout statement before touching
   anything.
3. ✅ **Brut hors taxe vs a separate « taxe retenue par la plateforme » field** (2026-08-24) → **brut
   hors taxe**. The alternative (keep a tax-inclusive brut + copy the platform's own tax figure into a
   new field) was considered and dropped: no GdF screen shows a tax-inclusive, fee-exclusive total, so
   the operator would have to compute 747,40 € by hand on every booking, while 733,00 € is printed
   right there.
