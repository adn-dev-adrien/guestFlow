# Cancellation insurance — a guest-side option priced as a % of the stay

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/cancellation-insurance` _(Claude-managed)_ |
| **Created** | 2026-08-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Two features shipped on 2026-08-19 defined what a cancellation now **costs the guest**:

- [payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) — a direct booking
  owes its acompte at the booking date and its solde at J-30; when the solde is not paid the
  operator cancels the stay and **keeps the acompte as an indemnity**
  ([database.js:1142-1148](../server/src/database.js#L1142-L1148), CJUE *Société thermale
  d'Eugénie-les-Bains*, C-277/05).
- [cancellation-compensation.md](cancellation-compensation.md) — the mirror case on the platform
  side: what a platform pays back when the guest cancels.

Both describe money the guest **loses**. Nothing today lets the guest **cover** that loss: there is
no cancellation-insurance product anywhere in the catalogue, on the devis, or in the booking funnel
of the WordPress site.

What already exists and is reused rather than rebuilt:

- **The options catalogue.** `options` rows carry a `priceType` ∈ `per_stay` / `per_person` /
  `per_night` / `per_person_per_night` / `per_participant_progressive` / `free`, a base `price`, a
  per-property applicability pivot (`property_options`), a per-property **price override**
  (`property_option_prices`, [per-property-option-prices.md](per-property-option-prices.md)), a
  per-property « offert » default, a free-text `category`
  ([option-categories.md](option-categories.md)) and a `seedKey` identity for seeded articles.
- **One pricing engine.** [`calculateReservationQuote`](../server/src/utils/pricing.js) prices every
  option line, freezes sold lines against a locked snapshot
  ([devis-extras-parity-and-price-lock.md](devis-extras-parity-and-price-lock.md)) and is the single
  source of truth for the admin fiche, the devis PDF, the public `/quote` and the booking request.
- **A public catalogue + quote API.** `GET /public/v1/properties/:id/options` returns a grouped,
  render-ready payload and `POST /public/v1/quote` returns a full projection
  ([public-api.md](public-api.md)); the WordPress widget
  ([wp-booking-widget-redesign.md](wp-booking-widget-redesign.md)) renders whatever it receives —
  option labels and unit texts are **computed server-side** in
  [`publicProjections.js`](../server/src/utils/publicProjections.js).
- **Boot-time seeds.** [`breakfastSeed.js`](../server/src/utils/breakfastSeed.js) is the reference
  pattern for an idempotent, non-destructive catalogue seed with a title-alias promotion path.

What is missing is (a) a **price type expressed as a percentage of the stay** — the market standard
for a cancellation guarantee — and (b) a **presentation that forces an explicit choice** in the
booking funnel: an insurance nobody noticed is an insurance nobody bought.

**Arbitrages taken with Adrien on 2026-08-19** (questionnaire):

| Subject | Decision |
|---|---|
| Pricing model | **Both** — a new generic `percent_of_stay` price type is added *alongside* the existing types. Adrien picks fixed €, per person or % later, in the Options screen, without a release. |
| Percentage base | **Accommodation only** — the nights actually charged (+ the extra-guest surcharge, which is part of the same nights bill). Options, resources and taxe de séjour are excluded. |
| Website presentation | **Dedicated block with an explicit Oui / Non choice** before validating — nothing pre-ticked, and the visitor cannot submit without answering. |

## 2. Goal

Sell a « Assurance annulation » to the guest: Adrien sets its tariff once (a fixed amount **or** a
percentage of the stay, per property if he wants), and every direct booking — on the WordPress site
as on the admin fiche — offers it, prices it automatically and bills it like any other extra. On the
site the visitor must say **oui** or **non** before paying: the choice can no longer be missed.

## 3. Functional rules

### 3.1 The `percent_of_stay` price type (generic)

1. **New price type `percent_of_stay`**, available to **any** option (not only the insurance),
   labelled « % du montant du séjour » in the Options screen. It joins the existing list; no existing
   type changes behaviour.
2. For a `percent_of_stay` option, `options.price` holds the **percentage** (e.g. `4` = 4 %), not an
   amount. Accepted range **0 – 100**, at most 2 decimals; the server rejects anything else
   (`422 VALIDATION_FAILED`).
3. **The base (assiette) is the accommodation only:**

   ```
   base = (customPrice set ? customPrice : nightsTotal × (1 − discountPercent / 100))
        + extraGuestSurcharge
   ```

   i.e. the nights actually charged after a manual price override or a discount, plus the
   extra-guest surcharge (which is a supplement *on the nights*, not an option). **Excluded:**
   every option and resource line (including the insurance itself), the taxe de séjour, and the
   caution.
4. **Amount** = `roundMoney(percent × base / 100)`, computed by the engine, exposed as the line's
   `unitPrice` with `quantity = 1` and `billedUnits = 1`. This path wins over the planning-card one:
   an option that is *also* flagged « carte planning » is still priced from the stay, never from its
   occurrences — otherwise its percentage would be read as a euro unit price.
5. **Quantity is always 1.** A `percent_of_stay` option is a yes/no product: the engine clamps any
   quantity ≥ 1 to 1 and treats 0 as « not taken » (no line). The admin stepper and the site are
   capped at 1 accordingly.
6. **Never circular.** The base is read from the engine's own accommodation price, computed
   **before** the platform back-solve of [platform-payment-entry.md](platform-payment-entry.md)
   (`platformGrossAmount` pins the accommodation *from* the extras, which would be circular). A
   percent option on a platform reservation therefore prices off the engine's tariff, not off the
   pinned brut.
7. **Per-property percentage.** `property_option_prices` already overrides `options.price` per
   property — for a `percent_of_stay` option it overrides the **percentage**. Nothing to add, the
   semantics follow the type.
8. **Price lock unchanged.** Once the line is sold (devis accepted / reservation), the existing
   locked-snapshot merge freezes the amount: a later tariff change, or a change of the stay price,
   never re-prices an insurance already agreed and paid.
9. **« Offert » unchanged.** A `percent_of_stay` line can be offered like any other: the line total
   is 0 and the real amount is kept for a lossless un-offering.
10. **VAT unchanged**: the single global rate ([single-vat-rate.md](single-vat-rate.md)) applies, as
    for every other option. See §9 for the open fiscal question.

### 3.2 The cancellation-insurance option

11. **One flagged option.** A new boolean column `options.isCancellationInsurance` marks *the*
    cancellation insurance. It is what the public API and the website key on — never a title match.
12. **Exclusive.** At most one option carries the flag: setting it on an option clears it on every
    other, in the same transaction. If a hand-edited database holds several, the lowest `id` wins and
    a single warning is logged at boot.
13. **Seeded at boot**, idempotently and non-destructively, mirroring `breakfastSeed.js`:

    | Field | Value |
    |---|---|
    | `title` | `Assurance annulation` |
    | `titleEn` | `Cancellation insurance` |
    | `description` | « Garantie annulation : en cas d'annulation de votre séjour pour un motif couvert, les sommes déjà versées vous sont remboursées. » |
    | `seedKey` | `cancellation_insurance` |
    | `isCancellationInsurance` | `1` |
    | `priceType` | `percent_of_stay` |
    | `price` | `0` → **not configured**, proposed nowhere until Adrien sets it |
    | `category` | `''` (ungrouped — it gets its own block on the site) |
    | `displayToClient` | `1` |

    A pre-existing hand-made option whose title matches a known alias (« assurance annulation »,
    « assurance annulation de séjour », « garantie annulation ») is **promoted** (flag + `seedKey`
    set) instead of duplicated.
14. **Not deletable** from the Options screen (same rule as the typed seeds), but fully editable:
    title, description, price type, price, per-property prices, applicability, EN title.
15. **Unconfigured = invisible to the guest.** While the effective price/percentage for a property is
    `≤ 0`, the insurance is **not** returned by the public API and its block is **not** rendered on
    the site, so no choice is required. It stays visible in the admin catalogue so Adrien can price
    it.
16. **Admin side it is an option like any other**: it can be added to a reservation or a devis from
    the fiche, it prints on the devis PDF, it feeds the accounting exactly like the other extras. Its
    amount follows §3.1.
17. **Never sold once the stay has started.** There is nothing left to cancel, so the insurance is
    excluded from **both** in-stay selling surfaces:
    - the SAS upsell catalogue
      ([sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md)) — enforced by an
      **explicit guard** in `sasOptionSale.sellable` rather than left to the « Restauration »
      category filter, so miscategorising the insurance cannot put it on the check-in screen;
    - the mid-stay note dialog ([complement-buckets-by-moment.md](complement-buckets-by-moment.md)) —
      filtered out of its « Ajouter une prestation » catalogue on the same flag.

### 3.3 Public API

18. `GET /public/v1/properties/:id/options` **removes the insurance from `ungrouped` / `groups`** and
    returns it under a new top-level key, so no consumer can render it twice:

    ```jsonc
    {
      "ungrouped": [ … ], "groups": [ … ],
      "cancellationInsurance": {            // null when unconfigured / not applicable
        "optionId": 42,
        "title": "Assurance annulation",
        "titleEn": "Cancellation insurance",
        "description": "Garantie annulation : …",
        "priceType": "percent_of_stay",
        "percent": 4,                        // null for a fixed-price insurance
        "price": 4,
        "priceLabel": "4 % du montant du séjour"   // server-computed, rendered as-is
      }
    }
    ```
19. `POST /public/v1/quote` gains a `cancellationInsurance` block, **always priced** — whether or not
    the visitor selected it — so the site can display the real amount beside the Oui / Non choice:

    ```jsonc
    "cancellationInsurance": {
      "optionId": 42, "title": "Assurance annulation", "description": "…",
      "priceLabel": "4 % du montant du séjour",
      "amount": 38.4,        // what it costs for THIS stay
      "selected": false      // is it in the quoted options?
    }
    ```
    `null` when unconfigured. The amount comes from the same engine helper as the billed line — the
    preview and the invoice can never diverge.
20. `POST /public/v1/booking-requests` is **unchanged**: the insurance travels as a normal
    `options: [{ optionId, quantity: 1 }]` entry and is priced by the engine server-side. No new
    field, no client-side amount ever trusted.

### 3.4 WordPress booking funnel

21. **A dedicated block** « Assurance annulation », rendered between « Options & suppléments » and the
    price summary — never inside the supplements list.
22. It shows the title, the description, the **amount for this stay** (from `/quote`), and two
    mutually exclusive buttons **« Oui, j'assure mon séjour » / « Non merci »**. **Nothing is
    preselected.**
23. **The choice is mandatory.** Submitting without an answer is **refused on click**, with the
    inline notice « Merci d'indiquer si vous souhaitez l'assurance annulation. » and a scroll back to
    the block — exactly how the widget already handles its required contact fields. Deliberately
    **not** a disabled button: a greyed-out button never gets to say why it is inert, and the
    disabled state stays reserved for what the visitor cannot fix by answering (unavailable dates,
    min-nights breach).
24. « Oui » adds `{ optionId, quantity: 1 }` to the `/quote` and `/booking-requests` payloads; the
    summary then shows the insurance line like any other extra. « Non » removes it. Switching back
    and forth re-quotes (existing 400 ms debounce).
25. **Before the dates are picked** there is no amount to show: the block displays the `priceLabel`
    (« 4 % du montant du séjour ») instead of a €amount, and the choice is already answerable.
26. **No block, no obligation**: when the API returns `cancellationInsurance: null` the section is not
    rendered and the submit button is gated by the existing rules only.
27. All new strings are added to the plugin's i18n table (`class-gf-blocks.php`), FR by default and
    translatable like every other widget string.

**Edge cases:**

- Percentage set to 0 (or a fixed price of 0) → treated as unconfigured (rule 15).
- Percentage > 100 or negative → rejected at the API boundary; the Options form blocks it too.
- Free stay / accommodation offered → `base = 0` → `amount = 0`; the block still renders and « Oui »
  produces a 0 € line (an insurance on a free stay costs nothing).
- Stay whose accommodation price is manually overridden (`customPrice`) → the percentage follows the
  override (rule 3).
- A visitor answering « Oui » then changing dates → the amount re-computes with the new stay; the
  answer is kept.
- Insurance line already sold, then the stay price changes → the sold amount stays frozen (rule 8);
  the difference is a commercial decision, not an automatic re-billing.
- Insurance added to a **platform** reservation from the admin fiche → allowed (it is an option), and
  priced off the engine accommodation (rule 6). It is never *proposed* publicly for a platform stay.
- Option flagged as insurance but restricted to some properties → on a non-applicable property the
  public API returns `cancellationInsurance: null` (no block, no obligation).
- A stale WordPress proxy cache still serving the pre-change options payload (no
  `cancellationInsurance` key) → the widget renders exactly as today; no crash, no block.

---

## 4. Architecture

> **Fat backend, thin frontend — holds.** The percentage, its base, the amount, the unit label and
> the « is it configured? » decision are all computed on the server. The WordPress widget renders the
> `cancellationInsurance` object it receives and posts back an option id — it never multiplies, never
> reads a percentage, never decides visibility.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Adds `isCancellationInsurance` to the idempotent `migrateOptionsColumns()` list; calls the new seed at boot beside `ensureDefaultBreakfastOption`. |
| `utils/` | `cancellationInsuranceSeed.js` | C | Idempotent, non-destructive boot seed + title-alias promotion + exclusivity repair (rule 12). Returns an `{ action }` tag like the breakfast seed. |
| `utils/` | `pricing.js` | T | `percent_of_stay` branch in the option-line loop (quantity clamp, amount from the shared helper); exports `computePercentOfStayAmount(percent, base)` and `computeStayInsuranceBase(...)` as pure functions; returns `cancellationInsuranceBase` in the quote result. |
| `models/` | `optionsModel.js` | T | Reads/writes `isCancellationInsurance` (guarded-write pattern, like `category` / `alwaysVisible`); enforces exclusivity in a transaction; `getCancellationInsurance(propertyId)` → the flagged option with its **effective** per-property price, or `null`. |
| `controllers/` | `optionsController.js` | T | Validates `percent_of_stay` (0 ≤ price ≤ 100) and passes `isCancellationInsurance` through create/update. |
| `routes/` | `options.js` | — | Stays thin — nothing to add. |
| `utils/` | `publicProjections.js` | T | `optionPriceLabels` gains `percent_of_stay` → « du montant du séjour »; `toPublicOption` emits `isCancellationInsurance`; new `toPublicCancellationInsurance(option, { amount, selected })`; `toPublicQuote` emits the `cancellationInsurance` block. |
| `controllers/public/` | `publicCatalogController.js` | T | Pulls the flagged option out of `ungrouped` / `groups` and returns it under `cancellationInsurance` (null when unconfigured or not applicable). |
| `controllers/public/` | `publicQuoteController.js` | T | Computes the **preview** amount from the engine's `cancellationInsuranceBase` + the option's effective percentage (shared helper) and feeds the projection. |
| `controllers/public/` | `publicBookingRequestController.js` | T (verify) | No change expected: the insurance is a normal applicable option. Covered by a test. |
| `utils/` | `sasOptionSale.js` | T | One guard in `sellable`: a flagged insurance is never offered at check-in (rule 17). `sasController.js` itself is untouched. |

**Notes:** the amount formula lives in **one** pure function used by both the billed line and the
public preview — that is what makes rule 19's "can never diverge" true. No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `OptionsPage.jsx` | T | Adds « % du montant du séjour » to the price-type list; shows the insurance marker (read-only chip) and disables deletion; passes `isCancellationInsurance` through the payload. |
| `pages/` | `OptionsPage.jsx` | T | Its **local** `PriceInputRow` gains a `percent` mode (« Pourcentage (%) », `max=100`) used by the single and the per-property fields, and its **local** `renderPriceCell` prints `4 %` instead of a euro amount. The generic `PricedItemsPage` needs **no** change: since [per-property-option-prices.md](per-property-option-prices.md) the whole price block is owned by `OptionPriceSection` inside `OptionsPage`, so nothing generic was in the way. |
| `components/reservation/` | `extrasLabels.js` | T | `percent_of_stay` → « du séjour » in the extras unit labels. |
| `components/reservation/` | `OptionRow.jsx` | T | Hides the quantity field for a `percent_of_stay` option (the engine forces 1), and prints its catalogue rate as `4 % du séjour • du montant hébergement` instead of a euro amount. |
| `components/reservation/` | `MidStayNoteDialog.jsx` | T | Drops the insurance from the « Ajouter une prestation » catalogue (rule 17). |
| `services/` `api.js` | — | — | Generic passthrough — nothing to change. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PricedItemsPage`, `PropertiesMultiSelect`, `OptionPropertyDefaultsMirror`, `FormDialog` | All pre-existing. |
| **Created (new generic)** | — | None. The percentage input is a prop on `OptionsPage`'s own `PriceInputRow`; nothing here is reusable outside the options catalogue. |
| **Specific (kept feature-local)** | — | None. |

### 4.3 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `blocks/booking/view.js` | T | Reads `cancellationInsurance` from the options payload and from each `/quote`; renders the dedicated block with the Oui / Non choice; gates the submit button; injects the option in the payloads. |
| `includes/class-gf-blocks.php` | T | New i18n strings (title, yes/no labels, mandatory-choice notice, price-label fallback). |
| `assets/style.css` | T | `.gf-insurance` block + choice buttons (≥44 px targets, full-width stacked on mobile). |
| `guestflow-booking.php` | T | Version bump `1.4.0` → `1.5.0` (header + `GF_BOOKING_VERSION`, which busts the asset cache). |
| `includes/class-gf-rest-proxy.php` | — | Untouched: the proxy relays the whole response body. |

### 4.4 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/public/v1/properties/:id/options` | — | `{ ungrouped, groups, cancellationInsurance }` | Additive key; the insurance is removed from the two lists. |
| POST | `/public/v1/quote` | unchanged | `{ …, cancellationInsurance }` | Additive; amount always priced, `selected` reflects the payload. |
| POST | `/public/v1/booking-requests` | unchanged | unchanged | The insurance rides in `options[]`. |
| POST/PUT | `/api/options` | `+ isCancellationInsurance`, `priceType: 'percent_of_stay'` | option | `422` when the percentage is outside 0–100. |

Auth: the public endpoints keep their API-key + rate-limit middleware; the admin endpoints keep the
session auth. No idempotency concern (no new write endpoint).

---

## 5. Data model

```sql
-- server/src/database.js — migrateOptionsColumns(), idempotent ALTER
ALTER TABLE options ADD COLUMN isCancellationInsurance INTEGER NOT NULL DEFAULT 0;
```

- **No new table.** The percentage lives in the existing `options.price`; the per-property
  percentage lives in the existing `property_option_prices.price`.
- **Default for existing rows:** `0` — no option is the insurance until the seed inserts (or
  promotes) one.
- **Backfill:** the boot seed inserts the « Assurance annulation » row at `price = 0`
  (unconfigured), or promotes an existing look-alike option instead of duplicating it.

**Data impact:** none on existing records. No column is dropped, no value rewritten; a promoted
look-alike keeps its price, its applicability and its history — it only gains the flag and the
`seedKey`. Reservations and devis already sold are untouched (no `percent_of_stay` line exists yet).

**Migration note for `CHANGELOG.md`:** new `options.isCancellationInsurance` column + one seeded
catalogue row, priced at 0 (invisible to guests until configured).

## 6. UI / UX

### 6.1 Options screen (admin)

- The price-type select gains « % du montant du séjour ». Choosing it swaps the `€` end-adornment of
  the price field for `%` and shows the helper « Pourcentage du montant hébergement du séjour (hors
  options, ressources et taxe de séjour) — 0 à 100 ». The per-property price lines swap the same way.
- The « Assurance annulation » row shows the usual seeded-option treatment: the delete action is
  disabled, and the form shows a read-only caption « Option d'assurance annulation — proposée dans le
  tunnel de réservation du site. »
- **Responsive:** unchanged — the Options page already stacks its form fields on `xs`; the `%`
  adornment costs no width.

### 6.2 Reservation fiche / devis (admin)

- The insurance appears in the extras list like any other option, with the unit label « du séjour »
  and its computed amount. Its stepper is capped at 1.
- No layout change; nothing to restyle.

### 6.3 WordPress booking funnel

```
┌──────────────────────────────────────────────────────┐
│  Options & suppléments                    (existing) │
├──────────────────────────────────────────────────────┤
│  Assurance annulation                                │
│  Garantie annulation : en cas d'annulation de votre  │
│  séjour pour un motif couvert, les sommes déjà       │
│  versées vous sont remboursées.                      │
│                                          38,40 €     │
│   ┌───────────────────────┐ ┌──────────────────────┐ │
│   │ Oui, j'assure mon séjour │ │     Non merci     │ │
│   └───────────────────────┘ └──────────────────────┘ │
├──────────────────────────────────────────────────────┤
│  7 nuit(s)                                  960,00 € │
│  Assurance annulation ×1                     38,40 € │   ← only when « Oui »
│  Total                                      998,40 € │
└──────────────────────────────────────────────────────┘
```

French copy:

| Key | String |
|---|---|
| `insuranceTitle` | Assurance annulation |
| `insuranceYes` | Oui, j'assure mon séjour |
| `insuranceNo` | Non merci |
| `insuranceRequired` | Merci d'indiquer si vous souhaitez l'assurance annulation. |

- **States:** no dates picked → the `priceLabel` replaces the amount; unanswered → clicking the
  submit button scrolls back here and shows the notice; answered « Non » → no line in the summary;
  loading → the existing global summary spinner covers it.
- **Responsive (mandatory):** on `xs` the two choice buttons go full-width and stack vertically; on
  `sm+` they sit side by side. Touch targets ≥44 px. The block reuses the existing `.gf-section`
  rhythm so it reads as part of the same form. No horizontal scroll at any width.

### 6.4 Sticky action bar

No page-level action changes. `OptionsPage` keeps its existing `PageActionBar`; the WordPress widget
is not a GuestFlow page and has no action bar.

## 7. Test plan

### Server unit tests (36 new, suite at 3194 ✅)

- [x] `tests/cancellation-insurance-pricing.unit.test.js` (12) — rules 2-9: percentage → amount, the
      base excludes options/resources/taxe de séjour, includes the extra-guest surcharge, follows
      `customPrice` and `discountPercent`, ignores the platform back-solve, quantity clamped to 1,
      per-property percentage wins, a sold line stays frozen, « offert » yields 0 with the real
      amount preserved, a free stay yields 0 rather than a crash, a planning-card flag cannot hijack the pricing.
- [x] `tests/cancellation-insurance-seed.unit.test.js` (8) — rules 12-14: seeds once, second boot is
      a no-op that preserves the operator's tariff and wording, links a property created later,
      adopts a look-alike title instead of duplicating, never steals a row owned by another seed,
      collapses a multi-flag database onto the lowest id, treats an archived row as present.
- [x] `tests/public-cancellation-insurance.unit.test.js` (9) — rules 15, 18-20: absent from
      `ungrouped`/`groups`, null while unpriced / hidden / offered by default, euro label for a flat
      premium, priced preview in `/quote` whether or not selected, `selected` reflects the payload,
      **preview amount === billed amount** (real engine + real model over an in-memory DB).
- [x] `tests/cancellation-insurance-option-crud.unit.test.js` (6) — flag exclusivity, `undefined`
      preserves it, `getCancellationInsurance` resolves the effective per-property percentage and
      returns null when unpriced/inapplicable, and the controller rejects a percentage outside 0-100.
- [x] `tests/sas-option-sales.unit.test.js` (+1) — rule 17: the insurance never enters the SAS
      upsell catalogue, even when miscategorised as « Restauration ».
- [x] Contract-shape fixtures updated for the two additive payload keys
      (`public-options-grouped`, `public-projections`, `public-quote-controller`,
      `public-quote-progressive-participants`).

### Client tests (4 new, suite at 1010 ✅)

- [x] `client/src/pages/__tests__/OptionsPage.percent.test.jsx` — the percentage field, its 0-100
      cap, the assiette helper and the per-property percentage rows; other price types keep the
      uncapped euro field.
- [x] `cd client && npx vitest run` — 1010 tests green.
- [x] `npm run test:e2e` — 65 passed / 1 skipped (no funnel change inside the React app; guards
      against a regression on the Options page).

### Manual UI verification (2026-08-19, `npm run dev`)

- [x] Options page: the seeded « Assurance annulation » lists as « 4 % » / « % du montant du
      séjour », its delete action is disabled, and the form shows « Pourcentage (%) » (max 100), the
      assiette helper and the read-only insurance caption.
- [x] Reservation fiche: the card reads « 4 % du séjour • du montant hébergement » (not a euro
      amount) with no quantity field; enabling it on a 6-night stay at 844,74 € bills **33,79 €**.
- [x] Public API by `curl`: unpriced → `cancellationInsurance: null` and absent from the lists;
      at 4 % → own key, preview `36,51 €` on a 912,80 € stay, identical to the billed line once
      taken, `totalStayPrice` 958,91 €.
- [x] **WordPress widget** — the Pi's WordPress container was not used; the block was exercised in a
      real browser through a throwaway local harness serving the plugin's own `runtime.js`,
      `view.js` and `style.css` against the live public API. Verified: the block renders after the
      supplements with `4 % du montant du séjour` before any date, then the real amount
      (`36,51 €`); « Oui » adds the line and the total goes 922,40 € → 958,91 €; « Non » removes it;
      submitting unanswered is refused with the notice and then chains onto the normal required-field
      validation; unpriced → no block at all. Mobile 390 px: answers stacked, 44 px targets, no
      horizontal scroll. **Not verified:** the plugin running inside real WordPress (block editor
      registration, `wp_localize_script` i18n wiring, REST proxy nonce) — unchanged code paths, but
      untested here.

## 8. Out of scope

- **Any real insurer.** This is a cancellation guarantee sold by the establishment in its own name.
  No third-party contract, no policy number, no claim workflow, no notice d'information PDF.
- **The claim itself.** When an insured guest cancels, the refund is entered by hand through the
  existing avoir / refund flow ([reservation-refunds.md](reservation-refunds.md)). Nothing is
  automatic, and the payment-schedule cancellation flow
  ([payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md)) is untouched.
- **A dedicated accounting account.** The premium is booked with the other extras at the single VAT
  rate (see §9).
- **Conditions / covered-reasons page** on the WordPress site: Adrien writes the content; only the
  option's description is rendered by the widget.
- **Platform channels.** Airbnb / Booking / Lodgify bookings are never offered the insurance
  publicly.
- **A separate funnel step.** The widget stays a single page (rejected in the questionnaire).

## 9. Open questions

- **Q — VAT and accounting nature of the premium.** Today it is billed like every other extra, at the
  single 10 % rate ([single-vat-rate.md](single-vat-rate.md)). A genuine insurance premium is outside
  the scope of VAT; a *cancellation guarantee sold by the establishment* is generally an ancillary
  service to the accommodation and follows its rate — which is what this spec implements. To confirm
  with the comptable; if he asks for a separate treatment, it is a follow-up spec (a dedicated
  account + a VAT-exempt bucket), not a change to this one.
  - A: …
- **Q — Should the premium be excluded from a refund when the guest cancels** (i.e. non-refundable by
  construction)? Today the operator decides, refund by refund. Left manual on purpose.
  - A: …
- **Q — A minimum premium** (e.g. « 4 % avec un minimum de 15 € ») — worth adding to
  `percent_of_stay`, or unnecessary?
  - A: …
