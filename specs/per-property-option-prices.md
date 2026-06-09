# Per-property option prices

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/per-property-option-prices` _(user-managed)_ |
| **Created** | 2026-06-09 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

An option today has a **single base price** (`options.price`) applied to every property. The
applicability of an option is per-property (`property_options`, empty = global "Tous les logements"),
and the *offered/free* default is per-property (`property_option_defaults.offered`), but the **price
itself is global**.

**Resources already solved this exact problem**: `property_resource_prices (propertyId, resourceId,
price, freeMinutes)` is an override pivot; the pricing engine `LEFT JOIN`s it and uses the override
when present, else the resource's base price ([pricing.js getApplicableResources](server/src/utils/pricing.js#L662),
[resourcesModel.js](server/src/models/resourcesModel.js)). Resources expose a `propertyPrices` map and
it's edited on the resource's own page.

Adrien needs the same for **options**: the same option (incl. a global one) should be able to cost a
different amount depending on the property — e.g. "Ménage" at 40 € on one gîte and 60 € on another.
This must flow through everywhere a price is computed (reservation quote, devis, public API → the
WordPress booking form, which already renders whatever price the API returns).

## 2. Goal

Let Adrien set an **optional per-property price** for any option. When set, that price is used for that
property everywhere (admin reservation/devis quote **and** the public API / WordPress); when unset, the
option's base price is used, exactly as today.

## 3. Functional rules

1. **Override pivot.** New table `property_option_prices (propertyId, optionId, price)`. A row sets the
   effective unit price of `optionId` for `propertyId`. No row → the option's base `options.price`.
2. **Effective price = `COALESCE(override, base)`.** Resolved server-side, mirroring resources. The
   override replaces the **unit price value** only; the option's `priceType` (per_stay / per_night /
   per_person / per_person_per_night / free) and all multipliers are unchanged.
3. **Applies to single-price options.** Override is supported for every non-progressive priceType.
   **Progressive** options (`per_participant_progressive`, priced from `optionProgressiveTiers`) keep
   their **global tiers** — per-property progressive pricing is out of scope (see §8).
4. **Global options included.** A global option (no `property_options` rows, applies to all properties)
   **can** carry per-property overrides — keyed only by `(propertyId, optionId)`, independent of the
   applicability pivot.
5. **Orthogonal to `offered`.** The per-property *offered/free* default
   (`property_option_defaults.offered`) is unchanged and independent: an option can be offered-free on a
   property regardless of its per-property price. When offered, the line total is 0 as today; the stored
   real unit price (for lossless un-offering) is the **effective** per-property price.
6. **Engine authority.** `getApplicableOptions` resolves the effective per-property price; every quote,
   devis, and reservation line uses it. No price math moves to the client or the WordPress plugin.
7. **Public API correctness.** `GET /public/v1/properties/:id/options` and the quote return the
   **effective price for that property** (the projection passes through whatever the model resolved). No
   public contract shape change — just the correct value.
8. **Editing.** On the **Options page** (the option's own page, mirroring how resources are edited on
   the Resources page), the option form gains a **"Prix différent selon le logement"** toggle. When
   **OFF** (default), the single base-price field is shown as today. When **ON**, that single price
   field is **hidden and replaced by one price line per applicable property**. Blank = use base price;
   explicit 0 = free. "Applicable properties" = the option's selected `propertyIds`, or **all
   properties** when the option is global. The toggle is initialised ON when the option already has at
   least one override; turning it OFF clears all overrides. The toggle is UI-only (not persisted) — the
   "mode" is implied by the presence of override rows.
9. **Backward compatible.** Until an override row exists, every option behaves exactly as today.

**Edge cases:**
- Override = 0 with a non-free priceType → a genuine **0 €** for that property (an explicit row is
  intentional). Blank/absent (no row) → fall back to base price. The UI distinguishes "empty" (inherit)
  from "0" (explicit free).
- Property deleted → override rows cascade-deleted (FK `ON DELETE CASCADE`).
- Option deleted → override rows cascade-deleted.
- Option becomes restricted to fewer properties → overrides for now-inapplicable properties are dropped
  on save (the editor only persists overrides for currently-applicable properties).
- Progressive option → no per-property price field shown (rule 3); base tiers apply everywhere.

---

## 4. Architecture

> **Fat backend, thin frontend — holds.** All price resolution stays on the server (engine + models).
> The client only renders inputs and sends a `propertyPrices` map; the WordPress plugin is untouched
> (it already renders the API's price).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent `CREATE TABLE IF NOT EXISTS property_option_prices` + indices (mirrors `property_resource_prices`). |
| `models/` | `optionsModel.js` | T | Read a `propertyPrices` map (`getById`/`list`); `create`/`update` replace override rows; `listForProperty(propertyId)` returns the **effective** price (LEFT JOIN). |
| `utils/` | `pricing.js` | T | `getApplicableOptions` LEFT JOINs `property_option_prices` and sets each option's effective `price` for the requested property. |
| `controllers/` | `optionsController.js` | T | Accept/forward `propertyPrices` on create/update. |
| `routes/` | `options.js` | T | Thin: pass `propertyPrices` through (validation in controller/model). |
| `utils/` | `publicProjections.js` | T (verify) | `toPublicOption` already emits `price`; confirm it carries the effective value (no shape change). |
| `models/` | `devisModel.js` | T (verify) | Devis create reruns the engine → inherits effective price; verify locked option lines store the effective unit price. |
| `controllers/` | `reservationsController.js` | T (verify) | Reservation create/update path → same engine resolution; verify no base-price leak. |

**Notes:** keep routes thin; the price resolution is a pure SQL/COALESCE in the model + engine. New
override persistence mirrors `resourcesModel` (delete-then-insert in a transaction).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `OptionsPage.js` | T | Option form: a "Prix différent selon le logement" toggle that hides the single price and shows one price input per applicable property; derive the toggle from existing overrides; include `propertyPrices` in the payload (only when ON); wrap the extra fields so they don't touch the Logements selector. |
| `components/` | `PricedItemsPage.js` | T | New `shouldHidePrice(form)` prop to hide the generic single-price field when an option is in per-property mode (no effect on the Resources page, which doesn't pass it). |
| `services/`|  `api.js` / options service | T | Pass `propertyPrices` through create/update. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | existing `OptionsPage` form scaffold, MUI `TextField` | Reuse the page's current form pattern (same as resources' per-property inputs). |
| **Created (new generic)** | — | None; the per-property price inputs are a small inline block, consistent with the Resources page. |
| **Specific (kept feature-local)** | the per-property price block in `OptionsPage` | Tied to the option form; mirrors the equivalent block on the Resources page. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/options` | — | `[{ ..., propertyPrices: { "<propertyId>": number } }]` | New field: per-property override map (only properties with an override). |
| POST | `/api/options` | `{ ..., propertyPrices?: { "<propertyId>": number } }` | created option | Override rows persisted for applicable properties only. |
| PUT | `/api/options/:id` | `{ ..., propertyPrices?: { ... } }` | updated option | Replaces override rows (delete-then-insert). |
| GET | `/public/v1/properties/:id/options` | — | `{ data: [PublicOption] }` | `price` = **effective** price for `:id` (override or base). No shape change. |

---

## 5. Data model

New table (idempotent in `database.js`):

```sql
CREATE TABLE IF NOT EXISTS property_option_prices (
  propertyId INTEGER NOT NULL,
  optionId   INTEGER NOT NULL,
  price      REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (propertyId, optionId),
  FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
  FOREIGN KEY (optionId)   REFERENCES options(id)    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_property_option_prices_option ON property_option_prices(optionId);
```

**Data impact:** purely additive. Existing options have **no** override rows → identical behavior to
today. No backfill. No risk of loss/corruption.

## 6. UI / UX

**Options page — bespoke "Modifier l'option" form.** The option form uses a **custom layout** (via the
new `renderForm` prop on `PricedItemsPage`) with this explicit field order, all in one evenly-spaced
column (`gap`) so no fields touch:

1. **Nom**
2. **Titre (anglais)**
3. **Description**
4. **Logements** (the `PropertiesMultiSelect`, with the "Tous les logements" sentinel)
5. **Type de prix**
6. **Price section** — a **`Switch`** « Prix différent selon le logement » (same control family as the
   reservation-page option toggles, **not a checkbox**), then a box whose presentation is **identical**
   in both modes:
   - **OFF (default):** one row « Tous les logements : [Prix (EUR)] » → the single base price.
   - **ON:** one row per applicable property « <nom logement> : [Prix (EUR)] » → the override; blank =
     reprend le prix de base, explicit 0 = free.
   - Both modes use the same `PriceInputRow` (label + "Prix (EUR)" input) inside the same bordered box,
     so switching the toggle only changes the rows, not the look.
7. **Specific options** — breakfast default time (breakfast option only), bed/bathroom linen per-type
   controls (when the hidden flag is set), the property-defaults read-only mirror.

- Applicable properties (ON) = the option's selected `propertyIds`; if global, **all** properties; if ON
  with none selected → helper « Sélectionnez au moins un logement… ».
- The toggle is initialised ON when the option already has overrides; turning it OFF clears them. The
  price section is hidden for `free`; for `per_participant_progressive` it is replaced by the existing
  progressive-tier editor (tiers stay global).
- `PropertiesMultiSelect` (new component) is extracted from `PricedItemsPage`'s inline selector and used
  by both the generic form and this bespoke one.

**Responsive:** `xs` — each price row stacks (label above input), full-width inputs; `md`+ — label and
input on one line. Renders in the existing `FormDialog` (fullscreen on mobile) — no new dialog.

**PageActionBar:** unchanged — `OptionsPage` keeps its existing action bar; this change only adds fields
inside the existing option form, no new page-level actions.

## 7. Test plan

### Server unit tests
- [x] `tests/options-model-property-prices.unit.test.js` — `create`/`update` persist & replace override
      rows; `get`/`list` expose the `propertyPrices` map; `listForProperty` returns the **effective**
      price (override wins, base fallback), including a **global** option overridden on one property only;
      explicit 0 is free, absent inherits base; update without `propertyPrices` leaves overrides untouched.
      **(7 tests)**
- [x] `tests/pricing-option-property-price.unit.test.js` — the engine prices a selected option at its
      effective per-property price (override vs. base), and an explicit 0 makes the line free.
      **(3 tests)**
- [x] Public API: the effective price flows through `optionsModel.listForProperty` (the LEFT JOIN), so
      `toPublicOption` (unchanged, passes through `price`) emits the per-property price. No projection
      change; covered by the model test above.
- [x] Regression: full server suite green (1317/1317) — existing pricing/options behavior unchanged with
      no override rows (guarded `getApplicableOptions` falls back to the base price).

### Manual UI verification
- [x] Client build green (Vite) — the `PerPropertyPricesField` block compiles; mirrors the existing
      Resources per-property pattern.
- [ ] Happy path (pending Pi deploy): set "Ménage" = 60 € on property A (base 40 €); reservation quote on
      A shows 60 €, on B shows 40 €; `GET /public/v1/properties/A/options` returns 60, B returns 40; the
      WordPress booking form shows the right price per property.
- [ ] Global option overridden on one property only; other properties keep base.
- [ ] Progressive option: no per-property field shown; pricing unchanged.
- [ ] Mobile (`xs`): the per-property price rows stack and are usable.

> The remaining manual checks require a **deploy to the Pi** (server change), as for the public-API
> fixes; they will be exercised on the live site after deploy.

## 8. Out of scope

- **Per-property progressive tiers** (`per_participant_progressive` keeps global tiers).
- **Per-property `priceType`** — only the unit price *value* is overridable; the type stays global.
- **Per-property override for custom (free-text) reservation options** — those are per-reservation ad-hoc
  lines, not catalog options.
- Bulk / spreadsheet editing of overrides.
- Any change to the WordPress plugin (it already renders the API's effective price).

## 9. Open questions

**Resolved (2026-06-09):**
- Q: Edit overrides on the **Options page** (per option) or on the **Property detail page** (per property)?
  - A: **Options page** (per option), mirroring resources. ✅
- Q: Should an explicit override of **0** mean "free for this property" (vs. blank = inherit)?
  - A: **Yes** — blank inherits the base price; an explicit `0` is a real 0 € for that property. ✅
