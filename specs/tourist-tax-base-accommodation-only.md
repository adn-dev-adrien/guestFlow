# Tourist tax — the base is the accommodation, and nothing else

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/tourist-tax-base-accommodation-only` |
| **Created** | 2026-08-20 |
| **Author** | Adrien |
| **Related PR** | [#470](https://github.com/adn-dev-adrien/guestFlow/pull/470) |

---

## 1. Context

The Lodge (« Aventura lodge », property 2) declares its tourist tax in
`percentage_accommodation` mode: 5 % of the per-occupant nightly cost HT, plus a 10 % departmental
share. The Gîte is in `per_day_per_person` mode and is therefore blind to every price — it is not
concerned by anything in this spec.

On the Lodge, the operator observed the tax **moving when extras are added to a booking**. It is
real, and the engine has exactly **two** ways of doing it. Both were reproduced against the
production database (3 nights, 2 adults, accommodation 359,79 €):

**A — the platform brut back-solves the accommodation.**
[pricing.js:1960](../server/src/utils/pricing.js#L1960) — when `platformGrossAmount` is filled in,
the accommodation is *deduced* from the brut (`brut − extra-guest surcharge − pre-arrival
options/resources`) and that deduced amount is what the tax is computed on. Every extra kept out of
« Complément » therefore eats into the tax base, and flipping the Complément chip on a line moves
the tax:

| Scenario (Lodgify, brut 450 €) | Tax base / night | Tax |
|---|---|---|
| no option | 150,00 € | 22,50 € |
| Ménage 30 € **outside** Complément | 140,00 € | 21,00 € |
| Ménage 30 € **inside** Complément | 150,00 € | 22,50 € |

**B — the « services included in the rate » deduction.**
[pricing.js:1967](../server/src/utils/pricing.js#L1967), rule 48 of
[tariff-recipes/spec.md](tariff-recipes/spec.md) — a property-default option configured « offered »
(`property_option_defaults.offered = 1`) is tagged `includedInRate` and its catalogue value is
subtracted from the tax base. On the Lodge those defaults are Ménage (30 €/séjour), Linge de lit
(7 €/pers) and Linge de toilette (8 €/pers):

| Scenario (direct or devis) | Deduction | Tax |
|---|---|---|
| nothing ticked | — | 18,00 € |
| Ménage « Comprise » | 30 € | 16,50 € |
| + linge de lit + linge de toilette | 60 € | 15,00 € |

Two aggravating details on B: the linen deductions are `per_person`, so the declared base *shrinks
as the party grows*; and the deduction only applies once the line is actually ticked, so two
identical stays declare different amounts depending on operator keystrokes.

A full sweep of the Lodge catalogue (every option and every resource, with and without the
Complément routing) confirmed these are the **only** two levers: no paid option, no resource and no
Complément toggle touches the tax through any other path. Structurally, `taxBaseAccommodation`
depends on exactly five inputs — the brut back-solve, `customPrice`, the tariff accommodation, the
discount, and the rule-48 deduction.

## 2. Goal

On a percentage-mode property, the tourist tax is computed on **the accommodation actually
charged, and on nothing else**. Adding, removing, offering or re-routing an extra — to Complément,
to the end-of-stay complement, or nowhere — never changes the tax by a cent.

## 3. Functional rules

1. **One base, one formula.** `taxBaseAccommodation` = the accommodation charged for the stay:
   `customPrice` when the operator set a « Prix hébergement ajusté », otherwise
   `baseAccommodationPrice × (1 − discountPercent / 100)`. Floored at 0.
2. **The platform brut no longer feeds the tax.** `platformGrossAmount` stops deriving the tax base
   on every platform (Lodgify, Abracadaroom, Airbnb, Booking, Greengo, GitesDeFrance…). The tax base
   is the tariff accommodation, exactly as on a direct booking.
3. **The « prestations comprises » deduction is removed.** Rule 48 of `tariff-recipes/spec.md` is
   repealed: an `includedInRate` line no longer reduces the tax base. The tag itself stays — it is
   what makes the summary render « Comprise » at 0 € instead of « Offert » — only its effect on the
   tax disappears.
4. **Extras are inert, all of them.** Options, custom options, resources, auto-options, baby-bed
   supplements, mid-stay sales and end-of-stay complements have no effect on the tax base, whatever
   their `inComplement` routing and whatever their `offered` state.
5. **The extra-guest surcharge stays out of the base.** Unchanged — the decision of 2026-08-12
   (`tariff-recipes/spec.md` §9, Q2) stands.
6. **The routing of the tax is untouched.** The three-way per-platform model
   (`per-platform-tourist-tax-three-way.md`) — offered / reversed / collected on arrival — applies to
   the new amount exactly as it applied to the old one. So do `touristTaxInComplement` and
   `touristTaxCollectedOnArrival`.
7. **The brut → final-price chain is untouched.** `pinnedAccommodation`, `finalPrice`,
   `reversedTouristTaxInBrut` and `offeredTouristTaxInBrut` keep working as they do today; they
   simply consume a tax amount that is now computed independently of the brut. This removes the
   engine's only circular dependency (the tax was derived from the brut, then subtracted from it).
8. **Past stays stay frozen.** `tourist-tax-freeze-past-with-refresh.md` is unchanged and takes
   precedence: a stay whose last night falls before the 1st of the current month keeps its stored
   amount, and only the explicit refresh button re-prices it.
9. **Current and future stays re-price on the next save.** No migration, no backfill: opening and
   saving a non-past reservation or devis writes the new amount, as any other tariff change does.
10. **`per_day_per_person` properties are untouched.** The Gîte's tax is a flat rate per adult per
    night; none of this can move it.

**Edge cases:**
- Reservation imported by iCal with no price (`totalPrice = 0`) → base 0 → tax 0, as today.
- Platform that offers the tax (Airbnb, case 2) → the amount is still zeroed in our books; only the
  pass-through figure carried in `touristTaxOriginalTotal` changes.
- `customPrice` is not editable on a platform reservation (the field is hidden in `FinanceSection`),
  so a platform booking always uses the tariff grid. Accepted: see §5 « Data impact ».
- Base floored at 0 → tax 0; no negative tax is representable.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none) |
| `controllers/` | — | — | (none) |
| `models/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `utils/` | `pricing.js` | T | Collapses `pinnedAccommodationInclTax` + `taxBaseBeforeDeduction` + `touristTaxIncludedInRateDeduction` into a single `taxBaseAccommodation`; drops the two now-meaningless quote fields |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | (none) |

**Notes:**
- The change is confined to [pricing.js:1955-1985](../server/src/utils/pricing.js#L1955). The block
  that pre-computed `pinnedAccommodationInclTax` « so the tax stays byte-identical » is deleted; the
  real `pinnedAccommodation` used for `finalPrice` (line ~2038) stays exactly as it is.
- Quote payload: `touristTaxBaseAccommodation` stays — it is the one honest name for the new base and
  it is what the unit tests assert on. `touristTaxBaseBeforeDeduction` and
  `touristTaxIncludedInRateDeduction` are **removed**: they become identically equal / 0, and
  CLAUDE.md §7 forbids leaving dead fields behind.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | — | — | (none) |
| `components/` | `PricingSummary.jsx` | T | Removes the « Base : X − Y de prestations comprises » caption and the two consts feeding it |
| `hooks/` | — | — | (none) |
| `services/` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |
| `styles/` | — | — | (none) |
| `api.js` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | — | No new UI surface. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `PricingSummary` | Pre-existing; only a caption is deleted. |

### 4.3 API contract

No endpoint signature changes. The quote payload returned by every pricing route
(`POST /api/reservations/quote`, devis and public projections) loses two fields:

| Field | Before | After |
|---|---|---|
| `touristTaxBaseAccommodation` | base after deduction | the accommodation charged (no client consumer today) |
| `touristTaxBaseBeforeDeduction` | base before deduction | **removed** |
| `touristTaxIncludedInRateDeduction` | Σ of `includedInRate` line values | **removed** |

Both removed fields are read only by `PricingSummary.jsx`, updated in the same session
(CLAUDE.md §6.1 no-breaking-change rule).

---

## 5. Data model

No schema change, no migration, no backfill.

**Data impact.** Stored `touristTaxTotal` / `touristTaxRate` are rewritten **only when a booking is
saved**. Past stays are protected by the freeze (rule 8), so nothing already declared to the commune
moves on its own. Measured impact on the Lodge's non-past bookings as of 2026-08-20:

| Résa | Plateforme | Séjour | Taxe actuelle | Taxe nouvelle | Δ |
|---|---|---|---|---|---|
| 22226 | Lodgify (brut 252,76 €) | 02→03/08 | 3,12 € | 2,94 € | −0,18 € |
| 22209 | Abracadaroom (brut 315 €) | 03→05/08 | 11,96 € | 12,56 € | +0,60 € |
| 22242 | Lodgify (brut 175,51 €) | 15→16/08 | 4,32 € | 6,36 € | +2,04 € |
| 22211 | Abracadaroom | 10→11/10 | 2,76 € | 4,26 € | +1,50 € |
| 22246, 22248 | Lodgify (sans brut) | 05→10/08 | 20,40 € / 14,88 € | inchangé | 0 |
| 22212 | Airbnb | 11→13/08 | 0 € | 0 € | 0 (taxe offerte, routage inchangé) |
| autres | — | — | 0 € | 0 € | 0 (prix 0, résas iCal) |

Net effect on the Lodge: **+3,96 €** across four bookings. Every delta is explained by one of the
two mechanisms removed; none of them is a stay already declared.

## 6. UI / UX

- **Récapitulatif tarifaire** (`PricingSummary`, fiche réservation and fiche devis): the caption
  « Base : 359,79 € − 60,00 € de prestations comprises » disappears. The two remaining captions —
  the engine label (« (109,03 € HT/nuit ÷ 2 occupants) × 5,00 % + 10,00 % dep = 3,00 €/adulte/nuit »)
  and « Base : 3,00 € × 2 adultes × 3 nuits » — are unchanged and now tell the whole story.
- No new string, no new control, no new state.
- **Responsive:** nothing moves; one caption fewer in a `flexDirection: column` stack that already
  wraps identically on `xs`, `md` and `lg`.
- **Sticky action bar:** untouched — no page-level action is added or removed.

## 7. Test plan

### Server unit tests
- [x] `tests/tourist-tax-base-accommodation-only.unit.test.js` (**renamed** from
      `tourist-tax-included-in-rate.unit.test.js`, whose whole subject was the repealed rule 48) —
      8 tests covering rules 1-10: the base is 200 € and not the total; seven extra variations (paid
      option, option in Complément, included in the rate, included + Complément, custom option,
      resource, resource in Complément) all yield the identical tax; the « Comprise » tag survives at
      0 €; an oversized included value no longer floors the base; the platform brut — with and without
      an extra — no longer derives the base while `totalStayPrice` still equals the brut; `customPrice`
      and `discountPercent` do drive it; `per_day_per_person` is inert; a frozen past tax is untouched.
- [x] `tests/devis-pdf-quote-parity.unit.test.js` — the « drops offeredOptionIds » regression now
      asserts the tax is **unchanged** (only the total inflates); two titles realigned.
- [x] `cd server && npm test` → **3458 passed, 0 failed**. No other test needed a change:
      `pricing-platform-gross-pin`, `pricing-platform-tourist-tax-reversed-brut`,
      `pricing-tourist-tax-three-way`, `pricing-option-included-in-rate` and
      `tariff-recipe-quote-integration` were never pinned on the old base.

### Client tests
- [x] `cd client && npx vitest run` → **1069 passed / 136 files**, no change required: the removed
      caption had no test coverage, and `PricingSummary.included-in-rate.test.jsx` only asserts the
      « Comprise » wording, which is untouched.

### E2E
- [x] `npm run test:e2e` → **65 passed, 1 skipped**.

### Manual UI verification

Driven in the real app (dev server, Lodge, 10→13/09/2026, 2 adultes, hébergement 359,79 €):

| Scénario | Taxe | Total séjour |
|---|---|---|
| direct, défauts « Comprise » cochés (ménage + 2 linges) | **18,00 €** | 377,79 € |
| ménage décoché | **18,00 €** | 377,79 € |
| ménage rebasculé en « Complément » | **18,00 €** | 377,79 € |
| + option facturée 45 € | **18,00 €** | 422,79 € |
| Lodgify sans brut | **18,00 €** | 377,79 € |
| Lodgify, brut 450 € | **18,00 €** | 450,00 € |
| Lodgify, brut 450 € + option 45 € | **18,00 €** | 495,00 € |

Avant le correctif, la première ligne valait 15,00 €, la deuxième 16,50 € et la ligne « brut 450 € »
22,50 €.

- [x] Le récapitulatif n'affiche plus « Base : … − … de prestations comprises » ; les libellés restants
      lisent l'assiette entière : « (109.03EUR HT/nuit ÷ 2 occupants) x 5.00 % + 10.00 % dep » et
      « Base: 3,00 € x 2 adultes x 3 nuits ». Les lignes ménage/linge restent « Comprise » barrées.
- [x] Gîte (`per_day_per_person`) : 7,20 € = 1,20 € × 2 adultes × 3 nuits, insensible aux options.
- [x] Mobile 390 px : récapitulatif identique, aucun défilement horizontal (`scrollWidth == clientWidth`).
- [ ] Réservation passée : non rejouée dans le navigateur — le gel est couvert par
      `tests/pricing-tourist-tax-freeze.unit.test.js` et par le dernier test du nouveau fichier.

### Spec sync (CLAUDE.md §4.1)
- [x] `specs/tariff-recipes/spec.md` — rule 48 marked repealed, 48bis and 49 rewritten, and the
      2026-08-12 « Resolved » note amended with the 2026-08-20 decision.
- [x] `specs/tariff-recipes/architecture.md` §2.6 and `specs/tariff-recipes/plan.md` Step 5 — marked
      removed/reverted, since both describe code that no longer exists.
- [x] `specs/devis-pdf-total-parity.md` — the `offeredOptionIds` row no longer claims a tax effect.
- [x] `changelog.d/fixed--tourist-tax-base-accommodation-only.md`.

## 8. Out of scope

- The Gîte and every `per_day_per_person` property.
- Any change to the tax **routing** (offered / reversed / collected on arrival) or to
  `touristTaxInComplement`.
- Any change to the freeze rule or to the *Suivi taxe de séjour* declaration page.
- Rewriting already-stored amounts: no migration, no bulk recompute.
- Whether the extra-guest surcharge belongs in the base (settled 2026-08-12: it does not).
- The accounting treatment of the tax (46710000 pass-through) — amounts change, the plumbing does not.

## 9. Open questions

**Resolved 2026-08-20 (Adrien):**
- Q: Should the base be derived from the platform brut, or from the tariff accommodation?
  - A: **The tariff accommodation, always.** The brut is a payment figure, not a tax base. Accepted
    consequence: on a platform booking the declared base is the grid price, which may differ from
    what the guest actually paid the platform.
- Q: Should the « services included in the rate » deduction (rule 48) survive?
  - A: **No.** It is the only thing that moved the tax on direct bookings and devis, it scaled with
    the number of guests, and it depended on whether the operator had ticked the line. The base is
    the accommodation, full stop.
- Q: What happens to bookings already recorded?
  - A: **Automatic re-price on the next save, past stays excluded** by the existing freeze. No
    migration.
