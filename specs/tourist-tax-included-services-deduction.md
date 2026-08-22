# Tourist tax — the dry night, net of the services included in the rate

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/tourist-tax-included-services-deduction` |
| **Created** | 2026-08-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Two days ago, [tourist-tax-base-accommodation-only.md](tourist-tax-base-accommodation-only.md)
(PR [#470](https://github.com/adn-dev-adrien/guestFlow/pull/470)) fixed a real bug: the tourist tax
moved whenever an extra was added, removed or re-routed to « Complément ». It did so by cutting
**both** levers that could move the base:

1. the platform brut back-solve (`brut − supplément − options hors Complément`) — correctly removed,
   and it stays removed;
2. the deduction of the **services included in the rate** (former rule 48 of
   [tariff-recipes/spec.md](tariff-recipes/spec.md)) — removed too, and that half went too far.

Lever 2 is not an extra polluting the base: it is the opposite. On the Lodge, Ménage (30 €/séjour),
Linge de lit (7 €/pers) and Linge de toilette (8 €/pers) are `property_option_defaults.offered = 1`.
They are **billed inside the nightly rate** — the guest pays them, invisibly, in the 359,79 € of a
3-night stay. The taxable base of a percentage-mode commune is the **accommodation**: the dry night.
A night rate that also buys cleaning and linen is not a dry night, and declaring it as such
over-declares the tax.

Since #470 the engine computes ([pricing.js:1973](../server/src/utils/pricing.js#L1973)):

```
base = customPrice ?? nights × (1 − remise)     →  ÷ nuits  ÷ 1,10 (TVA)  ÷ occupants  × 5 %  + 10 % dep
```

On the reference stay (Lodge, 3 nuits, 2 adultes, hébergement 359,79 €) that is **18,00 €**, where
the operator expects the tax on the *dry* night — 15,00 €.

#470 listed two genuine defects of the old deduction, and this spec must not re-import them:

- the linen lines were deducted `per_person`, so **the declared base shrank as the party grew**
  (2 pers → −60 €, 4 pers → −90 €) while the night price was going *up*;
- the deduction only applied **once the operator had ticked the line**, so two identical stays could
  declare different amounts depending on keystrokes.

## 2. Goal

On a percentage-mode property, the tourist tax is computed on the **dry night**: the accommodation
charged, minus the reference value of the services structurally included in the rate, divided by the
nights. That value is a fixed per-stay amount — it never depends on the size of the party — and the
included services can no longer be unticked on a reservation, so two identical stays always declare
the same amount.

## 3. Functional rules

1. **The base is the accommodation charged, net of the inclusions.**

   ```
   hébergement facturé = customPrice ?? (nuits du tarif × (1 − remise / 100))
   assiette             = max(0, hébergement facturé − Σ prestations comprises)
   prix de la nuit      = assiette ÷ nuits
   nuit HT              = prix de la nuit ÷ (1 + TVA / 100)
   taxe/adulte/nuit     = round(round(nuit HT ÷ occupants) × commune %) × (1 + dep % / 100)
   taxe                 = taxe/adulte/nuit × adultes × nuits
   ```

   Only the first line changes; everything downstream is untouched.

2. **« Prestation comprise » = a property default marked offered, and nothing else.** A line is
   deducted **iff** it carries the engine's `includedInRate` tag: an option that is a
   `property_option_defaults` row of this property with `offered = 1`, and is offered on this
   booking. A one-off commercial gesture (an option manually offered that is *not* a property
   default) is **not** deducted — rule 49 of `tariff-recipes/spec.md` stands, and a custom option is
   never deducted whatever its `offered` flag.

3. **The deducted value is a per-stay forfait, independent of the party.** For each included line the
   reference value is `unitPrice × quantity × multiplicateur(priceType)`, where the **person factor
   is the property's `basePriceIncludedGuests`** (the locked tariff's value when the reservation
   carries a snapshot — rule 12bis), **not** the real party. The night factor stays the real number
   of nights. On the Lodge (`basePriceIncludedGuests = 2`):

   | Prestation | Type | Valeur déduite |
   |---|---|---|
   | Ménage | `per_stay` 30 € | 30,00 € |
   | Linge de lit | `per_person` 7 € | 7 × 2 = 14,00 € |
   | Linge de toilette | `per_person` 8 € | 8 × 2 = 16,00 € |
   | **Total** | | **60,00 €** |

   — for 2 occupants as for 6. The `unitPrice` read is the **line's**, i.e. the per-property price
   override and, on a saved reservation, the frozen snapshot: changing an option's catalogue price
   never moves an existing declaration.

4. **The included services are mandatory on the fiche.** An option eligible to `includedInRate` — a
   current property default with `offered = 1` — renders with its Switch **checked and disabled**,
   captioned « Inclus », and cannot be unticked:
   - on a **new** reservation / devis: always (unchanged behaviour, widened from bed linen to every
     offered default);
   - on an **existing** reservation / devis: only when the reservation **already carries** the line.
     One that does not carry it keeps rendering as a normal off Switch and is never force-added —
     [reservation-option-immutability.md](reservation-option-immutability.md) rules 3-4 stand.

5. **The server is the authority on rule 4.** Saving a reservation cannot drop an included line the
   stored reservation carries: on update, a property default with `offered = 1` present in the stored
   `reservation_options` and missing from the payload is re-injected before pricing. An option the
   stored reservation does **not** carry is still never added.

6. **The platform brut still does not feed the tax.** Rule 2 of
   `tourist-tax-base-accommodation-only.md` is unchanged: `platformGrossAmount` never derives the tax
   base, on any platform. The base is the tariff accommodation net of the inclusions, on a Lodgify
   booking as on a direct one.

7. **Every other extra stays inert.** Paid options, custom options, resources, auto-options, baby-bed
   supplements, mid-stay sales, end-of-stay complements and the `inComplement` routing have no effect
   on the base — whatever their state. Rule 4 of `tourist-tax-base-accommodation-only.md` stands, with
   the single documented exception of the `includedInRate` lines.

8. **The extra-guest surcharge stays out of the base.** Unchanged (decision of 2026-08-12,
   `tariff-recipes/spec.md` §9 Q2). It is neither added to the base nor deducted from it.

9. **The routing of the tax is untouched.** The three-way per-platform model (offered / reversed /
   collected on arrival), `touristTaxInComplement` and `touristTaxCollectedOnArrival` apply to the new
   amount exactly as before.

10. **Past stays stay frozen.** [tourist-tax-freeze-past-with-refresh.md](tourist-tax-freeze-past-with-refresh.md)
    takes precedence: a stay whose last night is before the 1st of the current month keeps its stored
    amount until the explicit refresh button is pressed. Nothing already declared to the commune moves
    on its own.

11. **Current and future stays re-price on their next save.** No migration, no backfill.

12. **`per_day_per_person` properties are untouched.** The Gîte's flat rate per adult per night is
    blind to every price, deduction included.

13. **The summary says the subtraction out loud.** `PricingSummary` renders again, under the tourist
    tax line and only when a deduction applies: « Base : 359,79 € − 60,00 € de prestations comprises ».

**Edge cases:**
- `basePriceIncludedGuests = 0` (a property where every guest is an extra) → the person factor falls
  back to the **real party size**, otherwise a `per_person` inclusion would be worth 0 €.
- Σ inclusions ≥ accommodation → base floored at 0 → tax 0. No negative tax is representable.
- Reservation predating the default (does not carry the line) → no deduction, and the line is not
  force-added (rule 4).
- Reservation imported by iCal with no price → base 0 → tax 0, as today.
- Platform that offers the tax (Airbnb) → the amount is still zeroed in our books; only the
  pass-through figure in `touristTaxOriginalTotal` changes.
- `percent_of_stay` inclusion (an insurance configured as an offered default) → deducted at its
  computed amount like any other line; it is a theoretical case, not a Lodge one.

---

## 4. Architecture

> **Fat backend, thin frontend.** The deduction, its party-independent factor and the re-injection of
> a carried default all live on the server. The client only disables a Switch and renders a caption
> the server already priced.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none) |
| `controllers/` | `reservationsController.js` | T | Rule 5 — on update, re-injects into `selectedOptions` / `offeredOptionIds` a property default `offered = 1` that the stored reservation carries and the payload dropped |
| `models/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `utils/` | `pricing.js` | T | Rules 1-3 — computes `touristTaxIncludedInRateDeduction` from the `includedInRate` lines with the party-independent factor, and subtracts it from `taxBaseAccommodation`; re-exposes `touristTaxBaseBeforeDeduction` |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | (none) |

**Notes:**
- The whole pricing change sits in the block at
  [pricing.js:1966-1980](../server/src/utils/pricing.js#L1966): `taxBaseBeforeDeduction` (the
  accommodation charged, as today) → `touristTaxIncludedInRateDeduction` → `taxBaseAccommodation =
  max(0, before − deduction)`. The deduction reads `finalOptionLines` (already tagged
  `includedInRate` at [pricing.js:1755](../server/src/utils/pricing.js#L1755)) and the existing
  `includedGuests` const ([pricing.js:1420](../server/src/utils/pricing.js#L1420)), which already
  resolves the locked tariff.
- The per-line reference value reuses the engine's own `getTypeMultiplier(priceType, persons,
  nights)` with `persons = includedGuests || realPersons` — no second pricing formula is written.
- No circular dependency is re-introduced: the deduction depends on the option lines, which are
  priced before the tax; the brut back-solve stays out (rule 6).
- `reservationsController` re-injection is a **merge on update only**; the create path already merges
  the property defaults.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Computes the set of options locked ON (offered property defaults; in edit mode, restricted to those the reservation carries) and passes it through the form context |
| `components/` | `reservation/OptionRow.jsx` | T | Disables the Switch + shows « Inclus » for a locked-included option (today: bed-linen defaults on creation only) |
| `components/` | `PricingSummary.jsx` | T | Rule 13 — renders the « Base : X − Y de prestations comprises » caption again |
| `hooks/` | — | — | (none) |
| `services/` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |
| `styles/` | — | — | (none) |
| `api.js` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | — | No new UI surface: an existing Switch changes state, an existing caption returns. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `OptionRow`, `PricingSummary` | Pre-existing, reservation-specific by nature. |

### 4.3 API contract

No endpoint signature changes. The quote payload returned by every pricing route
(`POST /api/reservations/quote`, devis and public projections) regains two fields:

| Field | After |
|---|---|
| `touristTaxBaseAccommodation` | the accommodation charged **net of the inclusions** — the amount actually divided by the nights |
| `touristTaxBaseBeforeDeduction` | **restored** — the accommodation charged, before the deduction |
| `touristTaxIncludedInRateDeduction` | **restored** — Σ of the included lines' reference values |

Both restored fields are consumed by `PricingSummary` only. They are surfaced separately (rather than
re-added client-side) because the base is floored at 0: `before − deduction` is not always the base.

---

## 5. Data model

No schema change, no migration, no backfill.

**Data impact.** Stored `touristTaxTotal` / `touristTaxRate` are rewritten **only when a booking is
saved**; past stays are protected by the freeze (rule 10). Measured on the Lodge's 11 non-frozen
bookings (dev copy of production, 2026-08-22) — only the three that actually carry an included line
move:

| Résa | Plateforme | Séjour | Déduction | Taxe avant | Taxe après | Δ |
|---|---|---|---|---|---|---|
| 22275 | Abracadaroom | 19→22/08 | 60,00 € | 14,85 € | 13,05 € | −1,80 € |
| 22211 | Abracadaroom | 10→11/10 | 54,00 € | 4,30 € | 2,92 € | −1,38 € |
| 22212 | Airbnb | 11→13/08 | 14,00 € | 2,50 € | 2,38 € | −0,12 € (taxe offerte : seul `touristTaxOriginalTotal` bouge) |
| 8 autres | Lodgify / Booking / Abracadaroom | — | 0 € | — | inchangée | 0 |

Net effect on what we actually declare: **−3,18 €** across two bookings, neither of them already
declared to the commune. The reference stay of §1 (3 nuits, 2 adultes, 359,79 €) goes from 18,00 € to
15,00 €.

## 6. UI / UX

- **Fiche réservation / fiche devis — carte Options.** Ménage, Linge de lit and Linge de toilette (and
  any other offered default) show a **checked, disabled** Switch with the caption « Inclus » under it —
  the exact rendering bed-linen defaults already have on creation. Their price line keeps reading
  « Comprise — incluse dans le tarif » at 0,00 € in the summary.
- **Récapitulatif tarifaire.** Under « Taxe de séjour », a third caption returns after the
  « Base : 2,50 € × 2 adultes × 3 nuits » line:
  « Base : 359,79 € − 60,00 € de prestations comprises ». Hidden when the deduction is 0.
- **Récapitulatif tarifaire — pack de bienvenue (feedback 2026-08-22).** On a welcome-pack line, the
  value of the units the rate covers moves **out of the left column** (where it sat inline after
  « dont 1 inclus dans le tarif », under the « + compl. » chip, reading as a label rather than a
  price) **into the amount column**: `variant="caption"`, `text.secondary`, struck through, directly
  above the `0,00 €` it explains. The count stays on the left. Detailed in
  [welcome-pack-auto-options.md](welcome-pack-auto-options.md) §6.
- **Copy:** « Inclus » (existing string), « Base : {X} − {Y} de prestations comprises » (the string
  removed by #470, restored verbatim).
- **Responsive:** nothing moves. One caption more in a `flexDirection: column` stack that already
  wraps identically on `xs`, `md` and `lg`; the Switch is the same 44×44 touch target, only disabled.
- **Sticky action bar:** untouched — no page-level action is added or removed.

## 7. Test plan

### Server unit tests
- [x] `tests/tourist-tax-included-services-deduction.unit.test.js` (**new**) — 11 tests: the deduction
      is applied (18,00 € → 15,00 € on the reference stay); it is **identical for 2 and for 6
      occupants** (rule 3); a manually-offered non-default option is not deducted (rule 2); a custom
      offered option is not deducted; a paid option and a resource still move nothing (rule 7);
      `basePriceIncludedGuests = 0` falls back to the real party (edge case); the extra-guest surcharge
      stays out (rule 8); `customPrice` and `discountPercent` drive the base before the deduction
      (rule 1); the platform brut still does not (rule 6); `per_day_per_person` is inert (rule 12); a
      frozen past tax is untouched (rule 10).
- [x] `tests/tourist-tax-base-accommodation-only.unit.test.js` (**amended**, 9 tests) — the cases
      asserting that an `includedInRate` line left the tax unchanged now assert the deduction (165,91 €
      base, identical in and out of Complément) and the floor at 0; the platform brut, the paid extras,
      `customPrice`, the discount and the freeze pass unchanged.
- [x] `tests/reservations-controller-property-defaults.unit.test.js` (**amended**) — rule 5 on the
      fiche: a payload that drops a carried offered default is corrected; one the reservation never
      carried is not added; a *billed* default stays removable.
- [x] `tests/devis-model-property-defaults.unit.test.js` (**amended**) — the same three cases through
      `devisModel.update`, so both surfaces share the contract.
- [x] `tests/devis-pdf-quote-parity.unit.test.js` — the « drops offeredOptionIds » regression asserts
      again that the lost deduction inflates the tax (it is the bug the file describes).
- [x] `cd server && npm test` → **3511 passed, 0 failed**.

### Client tests
- [x] `PricingSummary.included-in-rate.test.jsx` — the deduction caption renders when
      `touristTaxIncludedInRateDeduction > 0` and is absent at 0; the welcome-pack covered value sits
      in the amount column, struck through, above the 0,00 €.
- [x] `ExtrasSection.included-services.test.jsx` (**new**) — an included service renders `role=switch`
      checked + disabled with « Inclus »; an ordinary option stays editable and still calls
      `setOptionEnabled`.
- [x] `cd client && npx vitest run` → **1097 passed / 140 files**.

### E2E
- [x] `npm run test:e2e` → **65 passed, 1 skipped**.

### Manual UI verification (dev server, Lodge, 10→13/09/2026, 2 adultes, hébergement 359,79 €)
- [x] Direct booking, inclusions cochées → taxe **15,00 €** (18,00 € avant), captions
      « (90.85EUR HT/nuit ÷ 2 occupants) x 5.00% + 10.00% dep = 2.50EUR/adulte/nuit »,
      « Base: 2,50 € x 2 adultes x 3 nuits », « Base : 359,79 € − 60,00 € de prestations comprises ».
- [x] Same stay with 2 enfants (4 occupants) → deduction still **60,00 €**, base still 299,79 € ; only
      the occupant division moves the amount (7,50 €). The linen lines are still SOLD for four.
- [x] Ménage / Linge de lit / Linge de toilette: Switch coché + désactivé + « Inclus ». The billed
      defaults (Jus de pomme, Petit déjeuner) stay editable.
- [x] Option payante ajoutée (assurance annulation) → taxe inchangée à 15,00 €.
- [x] Lodgify + brut 450 € → taxe inchangée à 15,00 €, caption toujours « 359,79 € − 60,00 € ».
- [ ] Gîte (`per_day_per_person`) — not replayed in the browser; covered by the unit test
      « flat per-adult-per-night mode ignores the inclusions entirely ».
- [ ] Mobile 390 px — not replayed; no layout change beyond one extra caption in a column stack that
      already wraps, and one Switch that renders disabled.

### Spec sync (CLAUDE.md §4.1)
- [x] `specs/tourist-tax-base-accommodation-only.md` — rules 3 and 4 amended (the deduction returns, in
      its party-independent form), §4.3, §6 and §9 updated.
- [x] `specs/tariff-recipes/spec.md` — rule 48 reinstated as **48ter** with the forfait formulation;
      rule 49 gets its tax effect back; the §9 note amended with the 2026-08-22 decision.
- [x] `specs/reservation-option-immutability.md` — rules 3 and 4 amended: the forced/disabled display
      and the server-side restore now also apply in edit mode to a *carried* offered default, never to
      one the reservation lacks.
- [x] `specs/per-property-default-options.md` — new rule 10, « Comprise » is mandatory.
- [x] `specs/devis-pdf-total-parity.md` — the `offeredOptionIds` row states the tax effect again.
- [x] `specs/welcome-pack-auto-options.md` §6 — where the covered value reads (feedback 2026-08-22).
- [x] `changelog.d/fixed--tourist-tax-included-services-deduction.md` and
      `changelog.d/changed--welcome-pack-covered-value-placement.md`.

## 8. Out of scope

- The Gîte and every `per_day_per_person` property.
- The platform brut back-solve — it stays removed (rule 6).
- Any change to the tax routing, to the freeze, or to the *Suivi taxe de séjour* declaration page.
- Rewriting already-stored amounts: no migration, no bulk recompute.
- Whether the extra-guest surcharge belongs in the base (settled 2026-08-12: it does not).
- Making the *price* of an inclusion editable per reservation.
- The accounting treatment of the tax (46710000 pass-through) — amounts change, the plumbing does not.

## 9. Open questions

**Resolved 2026-08-22 (Adrien):**
- Q: Which lines are deducted from the accommodation before the division by the nights?
  - A: **Only the options recognised as included** — the property defaults marked « offerte », tagged
    `includedInRate`. Not a one-off commercial gesture.
- Q: Should the operator be able to untick an included option on the fiche?
  - A: **No.** They are included and mandatory; the Switch is locked ON (rule 4).
- Q: How is a `per_person` inclusion (linge 7 €/pers, 8 €/pers) valued?
  - A: **A per-stay forfait, independent of the party** — computed on the guests included in the base
    rate (2 at the Lodge), so the declared base no longer shrinks as the party grows. This answers the
    main objection #470 raised against the former rule 48.
