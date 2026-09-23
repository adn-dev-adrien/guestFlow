# Website meals counted in portions

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-09-22)_ — engine + labels + caps + refusal + migration + plugin 1.9.0 + Solio scripts cleaned; server suite 4284 green, drawer verified in a browser harness at 390 px and 1280 px |
| **Branch** | `feature/site-meal-portions` |
| **Created** | 2026-09-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [public-planning-options.md](public-planning-options.md) (supersedes its rule 1 and the label half of rule 4), [option-planning-card.md](option-planning-card.md), [devis-pdf-total-parity.md](devis-pdf-total-parity.md) |
| **Summary** | [docs/specs/2026-09-22-site-meal-portions.html](../docs/specs/2026-09-22-site-meal-portions.html) |

---

## 1. Context

On the website booking drawer, « Petit déjeuner » (8 €, per person per night, planning-card option)
asks for a **number of séances**: the engine bills `quantity × persons × 8 €`
([pricing.js:1594-1596](../server/src/utils/pricing.js#L1594)) — decision 2026-07-03 of
[public-planning-options.md](public-planning-options.md) rule 1. The same applies to « Le repas des
trappeurs » (25 €, per person).

Two problems reported by Adrien on 2026-09-22:

1. **The visitor thinks in breakfasts, not in séances.** Four guests who want breakfast on two of their
   three mornings count « 8 petits déjeuners », not « 2 séances ». Entering 8 today bills 8 × 4 = 32
   breakfasts.
2. **The wording says « repas ».** GuestFlow sends « par personne et par séance » / « Nombre de
   séances »; a hand-deployed mu-plugin on the Solio site rewrites « par séance » into « par repas » and
   adds a note « 2 repas × 4 personnes — 64 € » under the line
   ([gf-seo-reservation.php:483-510](../integrations/wordpress/solio-site/mu-plugins/gf-seo-reservation.php#L483),
   [gf-seo-blocks.php:261](../integrations/wordpress/solio-site/mu-plugins/gf-seo-blocks.php#L261)).
   A breakfast is labelled a « repas ».

## 2. Goal

On the website, the guest types the number of breakfasts (or meals) they want, sees that count
named correctly, and pays exactly that count.

## 3. Functional rules

**Billing (public flow only — `planningCardAsQuantity`)**

1. For a **per-person** planning-card option (`showsPlanningCard = 1`, `priceType` starting with
   `per_person`) on the public flow, the visitor's `quantity` is a **number of portions**:
   `billedUnits = quantity`, `total = quantity × unitPrice`. The `× persons` factor is removed.
   _(decision 2026-09-22: applies to every per-person card option — breakfast AND trappers' meal.)_
2. Card options that are **not** per-person (`per_stay`, `per_night`) keep `billedUnits = quantity`,
   unchanged.
3. **Cap = persons × servings.** A per-person card option's portions can never exceed
   `persons × servings` (persons = adults + teens + children, babies excluded — the engine's
   `persons`). The number of servings depends on the option _(decisions 2026-09-22)_:
   - **Breakfast** (`autoOptionType = 'breakfast'`): one per morning → `servings = nights`.
   - **Any other per-person card option (meals)**: two meals a day → `servings = 2 × nights`, plus:
     - **+1** when the arrival time is **before 12:00** (lunch AND dinner on the arrival day);
     - **+1** when the departure time is **after 12:00** (lunch on the departure day).

     The times are the visitor's `checkInTime` / `checkOutTime`; when absent, the property's
     `defaultCheckIn` / `defaultCheckOut`. Strict comparisons: arrival at 12:00 gives no extra
     meal, departure at 12:00 neither.
     Example: 3 nights, arrival 11:00, departure 14:00, 4 guests → (6 + 1 + 1) × 4 = 32 couverts.
   - **Live quote** (`POST /public/v1/quote`): a quantity above the cap is **clamped** to the cap. The
     quote reports the quantity it actually priced, so the drawer can follow (the visitor who lowers
     the party from 4 to 2 guests sees 12 breakfasts become 6 without an error).
   - **Booking request** (`POST /public/v1/booking-requests`): a quantity above the cap is **refused**
     with `422 VALIDATION_FAILED`, message « 6 petits déjeuners au maximum pour 2 personnes et
     3 nuits. » (meals: « 16 couverts au maximum pour 2 personnes et 8 repas. »), detail `{ field: 'options', issue: 'option <id> quantity <q> exceeds <cap>' }`. The
     submitted devis is what gets paid; it is never silently altered.
4. The admin flow is unchanged: scheduled occurrences × served covers, as today.
5. A per-person card option injected as a **property default** on the public flow gets
   `quantity = persons` (one portion per guest), so it bills what it billed before this change
   (1 séance × persons). No property carries such a default today.

**Labels (backend-owned, the plugin renders them as-is)**

6. `toPublicOption` labels for a per-person card option:
   | Option | `priceUnitLabel` | `quantityLabel` |
   |---|---|---|
   | breakfast (`autoOptionType = 'breakfast'`) | « par petit déjeuner » | « Nombre de petits déjeuners » |
   | any other per-person card option | « par couvert » | « Nombre de couverts » |

   Non-per-person card options keep « par séance » / « Nombre de séances ».
7. The public quote exposes, for every per-person card option applicable to the stay, its cap:
   `optionLimits: [{ optionId, maxQuantity, hint }]` (only when dates and persons are known).

**Website (plugin + Solio mu-plugins)**

8. The drawer's stepper for such an option stops at `maxQuantity` once a quote is known, and adopts
   the quantity the quote actually priced (rule 3 clamp). Under the stepper, a hint (string built by
   the server: `optionLimits[].hint`) reads « Jusqu'à 12 — 4 personnes × 3 matins » for breakfast,
   « Jusqu'à 32 — 4 personnes × 8 repas » for a meal. The hint states the cap and nothing else: how
   the meal count is reached (two a day, plus the lunches the times allow) is rule 3's business, not
   the visitor's — the number moves when they change the times, which is explanation enough.
   _(decision 2026-09-23: the parenthesis spelling out the extra lunches is dropped.)_
9. The summary line reads « Petit déjeuner × 8 — 64,00 € » (title × portions), unchanged code, new
   meaning.
   > **Sans test** — ligne rendue par le plugin WordPress (`view.js`), hors des suites JS scannées
   > (server, client, e2e) ; vérifiée au navigateur dans le harnais du plugin.
10. The Solio mu-plugins stop rewriting the unit and drop the « N repas × P personnes » note: the
    GuestFlow labels are now right on their own. `gf_seo_unite_affichee` loses its breakfast/repas
    branch.
    > **Sans test** — code PHP des mu-plugins du site Solio, déployés à la main hors de ce dépôt ;
    > vérifié à la relecture et au rendu du tiroir.

**Existing devis (data)**

11. Public devis already stored under the séance meaning must keep their total when replayed (PDF,
    payment link — [paymentsController.js:234-250](../server/src/controllers/paymentsController.js#L234)
    replays the engine with the flag, and the snapshot only locks the unit price). A one-shot,
    idempotent migration rewrites, on devis with `requestOrigin = 'public'`, every per-person card
    line with `cardOccurrences IS NULL`: `quantity := billedUnits`. After it, a replay yields the same
    `billedUnits` and the same total. Reservations are not touched (conversion copies the stored
    lines, no replay with the flag).

**Edge cases:**
- Quantity 0 → no line (unchanged).
- No dates yet → no quote, no cap; the stepper is free until the first quote.
- Offered breakfast (free units / offered flag) → applied on `billedUnits`, same as today.
- 1 night, 1 guest → breakfast cap 1; meal cap 2 (up to 4 with an arrival before 12:00 and a
  departure after 12:00).
- Visitor changes the arrival or departure time → the next quote recomputes the meal cap (clamp
  if lower).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pricing.js` | T | Flagged card branch: per-person → `billedUnits = qty`, clamp at `persons × servings` (via `mealPortions`), report `clampedFrom` on the line |
| `utils/` | `publicProjections.js` | T | New labels (rule 6); `toPublicQuote` exposes `optionLimits` (rule 7) |
| `utils/` | `mealPortions.js` | C | Pure helpers: `isPerPersonCardOption`, `servingsFor({option, nights, checkInTime, checkOutTime, property})`, `portionCap`, `portionWording(option)` (labels + French refusal/hint strings) |
| `utils/` | `propertyDefaultOptions.js` | T | Default quantity = persons for a per-person card option on the public flow (rule 5) |
| `controllers/` | `public/publicQuoteController.js` | T | Passes the caps into the projection |
| `controllers/` | `public/publicBookingRequestController.js` | T | Refuses over-cap quantities with 422 (rule 3) before persisting |
| `database.js` | `database.js` | T | Idempotent migration `quantity := billedUnits` on stored public per-person card lines (rule 11) |
| `routes/`, `models/`, `middleware/`, `scheduledTasks.js` | — | — | (none) |

### 4.2 Client side

`client/src/` — **no change** (admin flow untouched).

WordPress:

| File | T/C | Responsibility |
|---|---|---|
| `integrations/wordpress/guestflow-booking/blocks/booking/view.js` | T | Stepper max from `optionLimits`, hint line, adopt priced quantity |
| `integrations/wordpress/guestflow-booking/guestflow-booking.php` (+ readme) | T | Plugin 1.8.0 → 1.9.0 (self-update from WP admin) |
| `integrations/wordpress/solio-site/mu-plugins/gf-seo-reservation.php` | T | Drop the « par repas » rewrite and the « N repas × P personnes » note |
| `integrations/wordpress/solio-site/mu-plugins/gf-seo-blocks.php` | T | Drop the breakfast/repas branch of `gf_seo_unite_affichee` |

**Component reuse declaration:** no React component consumed or created. The plugin reuses its existing
`stepper` and `gf-line-note`.

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/public/v1/properties/:id/options` | `priceUnitLabel` / `quantityLabel` new wording for per-person card options |
| POST | `/public/v1/quote` | Per-person card option billed by portions; over-cap quantity clamped; new `optionLimits: [{ optionId, maxQuantity, hint }]` |
| POST | `/public/v1/booking-requests` | Per-person card option billed by portions; over-cap → `422 { error: { code: 'VALIDATION_FAILED', message, details } }` |

Additive for the plugin (new field, same shapes). Semantic change of `options[].quantity` for these
options: an older plugin keeps working and now bills what the visitor typed. Not an X release: the
visible contract stays compatible.

---

## 5. Data model

No schema change. One data migration (rule 11), idempotent (`quantity = billedUnits` is a fixed point),
limited to devis lines of public devis, per-person card options, `cardOccurrences IS NULL`. Logged in
`changelog.d/migration--site-meal-portions.md`.

**Data impact:** the stored `quantity` of those lines changes from séances to portions; `billedUnits`,
`unitPrice`, `totalPrice` and the devis totals are untouched. No loss.

## 6. UI / UX

Website drawer, « Options & suppléments » → « Restauration »:

- Line: « Petit déjeuner ⓘ » · « Nombre de petits déjeuners » · « 8,00 € · par petit déjeuner » ·
  stepper.
- Under the stepper once dates + guests are known: « Jusqu'à 12 — 4 personnes × 3 matins ». The « + »
  is disabled at the cap.
- Trappers' meal: « Jusqu'à 32 — 4 personnes × 8 repas »; at the default times (16:00 / 10:00),
  « Jusqu'à 24 — 4 personnes × 6 repas ». Moving the arrival to 12:00 or later lowers the cap on the
  next quote (clamp).
- Party reduced below the selection → the next quote clamps, the stepper shows the new value.
- Summary: « Petit déjeuner × 8 — 64,00 € ».
- « Le repas des trappeurs » → « Nombre de couverts » · « 25,00 € · par couvert ».

Mobile: same line layout as today (the hint wraps under the stepper, no new column). Desktop identical.
No GuestFlow back-office page changes, no `PageActionBar` impact.

## 7. Test plan

### Server unit tests
- [ ] `tests/site-meal-portions.unit.test.js` — rule 1 (8 portions, 4 guests → 64 €), rule 2
      (per_stay unchanged), rule 3 servings (breakfast = nights; meal = 2 × nights, +1 arrival
      11:59, none at 12:00, +1 departure 12:01, none at 12:00, property default times when absent),
      rule 3 clamp on quote + `clampedFrom`, rule 3 refusal on booking request
      (422 + message), rule 5 default quantity, rule 6 labels, rule 7 `optionLimits`, rule 11 migration
      (legacy line: replay total unchanged; idempotent on second run).
- [ ] Update `planning-card-public-pricing.unit.test.js` (32 € → 16 € for qty 2 / 2 adults) and
      `public-projections.unit.test.js` (new labels).

### Manual UI verification
- [x] Harness serving the plugin's own `view.js` against the local API (no WordPress locally):
      4 guests, 3 nights → « Jusqu'à 12 — 4 personnes × 3 matins », 12 breakfasts = 96 €, « + »
      disabled at the cap; party back to 2 → the line follows down to 6 on the next quote.
- [x] Trappers' meal: « Nombre de couverts », cap 12 at the default times, 16 with arrival 11:00 and
      departure 14:00 — the hint states the cap only.
- [x] Real API: quote clamps 13 → 12; booking request refuses 13 with the French message and
      persists nothing; a request at 12 stores quantity 12 / billedUnits 12 / 96 €.
- [x] Mobile (390px) and desktop (1280px): hint on its own line, no horizontal scroll.
- [ ] After deploy on .23: Solio drawer shows « par petit déjeuner », no « repas » note left.

## 8. Out of scope

- **Existing bug, separate fix:** a site devis converted into a reservation carries its breakfast as
  an unscheduled card line; the first save of the fiche (or an admin edit of the devis) sends no
  occurrences and **drops the line** ([pricing.js:1615-1616](../server/src/utils/pricing.js#L1615),
  [bookingFormHydration.js:27](../client/src/utils/bookingFormHydration.js#L27)). Not caused by this
  change; to be specified on its own.
- Letting the visitor pick which mornings (still « à planifier avec l'hôte »).
- The breakfast prep count per morning ([breakfastModel.js:136](../server/src/models/breakfastModel.js#L136))
  still assumes the whole party until the operator schedules the line.

## 9. Open questions

- Q: Which options switch to portions? — **A (2026-09-22):** every per-person card option.
- Q: Cap? — **A (2026-09-22):** persons × servings; clamp on the live quote, refuse on the booking
  request. Breakfast: one per night. Meals: two per night, +1 for an arrival before 12:00, +1 for a
  departure after 12:00; property default times when the visitor gives none.
- Q: Wording for non-breakfast per-person card options? — **A (2026-09-22):** « couvert »
  (« Nombre de couverts », « par couvert »).
- Q: Should the meal hint explain where its serving count comes from? — **A (2026-09-23):** no. The
  hint gives the cap (« Jusqu'à 32 — 4 personnes × 8 repas ») and stops there.
