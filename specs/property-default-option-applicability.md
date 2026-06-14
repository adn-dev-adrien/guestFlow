# Property default options always apply to their property (bed-linen card on every Gîte reservation)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/property-default-option-applicability` _(user-managed)_ |
| **Created** | 2026-06-11 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

At **Le Gîte** (propertyId 1), the bed-linen option (« Linge de lits », option id 8) is configured
as a **default, offered** option (`property_option_defaults` row `(1, 8, offered=1)`). The bed
**configuration card** (single/double/baby bed counters, used by the weekly laundry feature) lives
**inside the bed-linen option card** on the reservation page
([ExtrasSection.js:238-244](../client/src/components/reservation/ExtrasSection.js#L238)): it renders
only when an *enabled* `countsAsBedLinen = 1` option is present on the reservation.

**Reported bug** (Léonie Cordara, reservation #22200, Gîte, iCal/Greengo): the bed-config card is
absent on the reservation page. Investigation on prod shows it is **systemic — 22/22 Gîte
reservations have no bed-linen option attached**, so none ever shows the card.

**Root cause.** Option 8 is **only applicable to the Aventura lodge** (`property_options` row
`(2, 8)`), not to the Gîte. The `property_option_defaults` table is *documented as decoupled* from
that applicability filter ("a row here means auto-add this option on every reservation for that
property" — [propertyOptionDefaultsModel.js:5](../server/src/models/propertyOptionDefaultsModel.js#L5)),
but the **pricing engine still filters by applicability**: `getApplicableOptions`
([pricing.js:647](../server/src/utils/pricing.js#L647)) drops option 8 for the Gîte, so:

- `devisModel.mergePropertyDefaultsIntoPayload` adds option 8 to the payload, but the engine then
  drops it (`optionsById.get(8)` is undefined for the Gîte → line skipped) → never persisted.
- The iCal import *does* insert offered defaults directly (raw INSERT), but #22200 predates that
  follow-up; and re-saving such a reservation would drop option 8 again via the engine.

So the Gîte's offered bed-linen default is **effectively dead**: it never survives a quote, the card
never appears, and the operator cannot set the bed counts the laundry feature needs.

**WordPress constraint.** The public booking form lists selectable options via
`publicCatalogController.listOptions` → `optionsModel.listForProperty` (applicability-filtered, a
**separate** path from the engine). The public quote endpoint calls `calculateReservationQuote`
**without merging defaults** ([publicQuoteController.js:49](../server/src/controllers/public/publicQuoteController.js#L49)).
So an **engine-side** fix does **not** expose the linen option on the WordPress site — which is what
Adrien requires (the option is included; the client must not see/select it).

## 2. Goal

Every reservation of a property whose defaults include an **offered** bed-linen option shows the
**bed-configuration card** on the reservation page — for new and existing reservations alike — while
the WordPress public booking flow continues **not** to show that included option.

> **Amended 2026-06-14 (specs/reservation-option-immutability.md).** "Applies to existing
> reservations" is now scoped to **displaying what they already carry** (including the one-time
> backfill that already ran in prod). Going forward an existing reservation is **frozen**: the
> bed-linen default is no longer *force-added* on the reservation form nor *re-merged* on save for a
> reservation that doesn't already carry it. The default is force-applied on **new** reservations
> only. This reverses the original "force it onto existing reservations on edit" behaviour (former
> rule 4.bis of `bed-config-in-linen-card.md`).

## 3. Functional rules

1. **A property's default options imply applicability.** Every code path that lists a property's
   options keys off `property_options` — **including the reservation form's client filter**
   ([ReservationPage.js:510](../client/src/pages/ReservationPage.js#L510), `propertyIds.includes`),
   the pricing engine (`getApplicableOptions`), and the public catalog. So a default that lacks a
   `property_options` row never renders, never prices, and its in-card bed-config editor never shows.
   The fix makes a default imply an applicability row: `propertyOptionDefaultsModel.set()` upserts the
   `property_options` row on write, and a one-time migration backfills the missing rows for existing
   defaults. No client change and no engine change are then needed — the existing
   `isForcedByPropertyDefault` logic in `ExtrasSection` lights up once the option is in the list.
2. **No price impact.** The linen default is `offered=1` → billed `totalPrice = 0`. Making it
   applicable changes no money: it adds an offered (0 €) line, nothing more. A property's *non*-default
   options keep their existing applicability rules unchanged.
3. **Existing reservations are backfilled (one-time migration).** An idempotent migration in
   `database.js` inserts **every** property-default option (offered *and* chargeable — Q2) into the
   existing reservations of that property that don't already have it, mirroring the iCal-import insert
   (`quantity 1`, `unitPrice 0`, `billedUnits 0`, `priceType` from the option, `offered` = the
   configured flag, `totalPrice 0`). The stored total is unchanged at backfill time; the next save
   recomputes via the engine (rule 1). In practice the only configured default in prod is the Gîte's
   offered linen, so this materialises the bed-linen line on the ~22 existing Gîte reservations and
   changes no money.
4. **WordPress stays clean.** Because rule 1 now makes the linen option *applicable* to the Gîte, it
   would otherwise start showing on the public booking form. So `listOptions` explicitly filters out
   **any option that is an *offered default*** for the property (it's included in the price, not a
   client choice). The public quote endpoint never merges defaults, so it's unaffected.
5. **Laundry unchanged.** The weekly laundry aggregation already joins `property_option_defaults`
   directly ([laundryModel.js:70](../server/src/models/laundryModel.js#L70)); this change does not
   alter those counts. It only makes the *editing UI* for bed counts reachable.

**Edge cases:**
- A property default that is **not** offered (`offered=0`) → still made applicable (rule 1) and
  backfilled onto existing reservations (rule 3, per Q2 "all defaults"), inserted at 0 € so no stored
  total changes until the operator next saves (then the engine prices it). None exist in prod today.
- A reservation that **already** has the option attached (e.g. recent iCal import) → no duplicate and
  no overwrite (idempotent by optionId).
- A property with no defaults → no behaviour change anywhere.

---

## 4. Architecture

> **Fat backend, thin frontend.** All of this lives on the server: applicability is fixed in the data
> (the model keeps it in sync on write; a migration backfills existing rows), and the public exclusion
> is a controller rule. The client is **unchanged** — its existing `isForcedByPropertyDefault` logic
> renders the bed-config card once the now-applicable option appears in the property's option list.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `propertyOptionDefaultsModel.js` | T | `set()` also upserts a `property_options` applicability row (a default implies applicability — rule 1). Guarded for schemas without the table. |
| `controllers/` | `public/publicCatalogController.js` | T | `listOptions` filters out options that are *offered defaults* for the property (rule 4). |
| `utils/` | `backfillPropertyDefaultOptionsMigration.js` | C | Pure backfill: inserts each property-default option onto existing reservations of that property lacking it (rule 3). |
| `database.js` | `database.js` | T | Two idempotent migrations: `property_defaults_imply_applicability_v1` (backfills `property_options` for existing defaults — rule 1) and `backfill_property_default_options_v1` (runs the util above — rule 3). Guarded by the `migrations` table; no schema change. |

**Notes:** routes stay thin. The applicability change is one `Set` lookup (guarded). The backfill
migration reuses the exact INSERT shape the iCal import already uses for defaults, so a backfilled
line is indistinguishable from an iCal-applied one and the form/engine treat it identically.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | **No client change.** `ExtrasSection` already renders the bed-config card for the first enabled `countsAsBedLinen` option; once the option is present in the loaded reservation, the card appears. |

**Component reuse declaration:** none (no client change).

### 4.3 API contract

No endpoint signature change. `GET /api/reservations/:id` returns the same shape, now possibly
including an extra offered (0 €) option line for an offered property default. `GET /api/public/properties/:id/options`
returns the same shape, minus any offered-default option.

---

## 5. Data model

No schema change. Tables involved (all existing): `property_option_defaults`, `property_options`,
`reservation_options`, `options`, `migrations`. Two idempotent migrations:

**A — `property_defaults_imply_applicability_v1`:** `INSERT OR IGNORE INTO property_options
(propertyId, optionId) SELECT propertyId, optionId FROM property_option_defaults`. Makes every
existing default applicable. In prod: adds the single missing `(Gîte, linen)` link.

**B — `backfill_property_default_options_v1`** (delegates to the pure util): for each
`property_option_defaults (propertyId, optionId, offered)`, insert a `reservation_options` row into
every `kind='reservation'` row of that property lacking an entry for `optionId` — `quantity 1,
unitPrice 0, billedUnits 0, priceType` from the option, `totalPrice 0`, `offered` = the configured
flag. Re-runnable safely (`NOT EXISTS` guard + the `migrations` flag).

**Data impact (Q1/Q2):** additive only, no loss. In prod the single default is the Gîte's offered
linen, so A adds one `property_options` link and B adds an offered (0 €) linen line to ~22 existing
Gîte reservations — **no stored total changes**.

**Data impact (decided: backfill — Q1/Q2).** Mutates existing prod rows: in practice the single
configured default is the Gîte's **offered** linen, so it adds an offered (0 €) line to ~22 existing
Gîte reservations — **no stored total changes** (offered → 0 €). A *chargeable* default (none exist
today) would also be inserted at 0 € and only become a real charge when the operator next saves and
the engine recomputes. Additive only; no data loss.

## 6. UI / UX

- **Reservation page (admin):** the existing « Voyageurs » / « Linge de lit » option card now appears
  on Gîte reservations, with the single/double/baby bed counters inside it (the
  `BedLinenInputsBlock`). No new component, no layout change — it simply stops being hidden.
- **WordPress booking form:** unchanged — the linen option remains absent from the selectable list.
- **Responsive / PageActionBar:** no change (this is content inside an existing card on an existing
  page).

## 7. Test plan

### Server unit tests
- [x] `property-option-defaults-model.unit.test.js` — `set()` upserts the `property_options`
      applicability row (a default implies applicability) and is idempotent.
- [x] `backfill-property-default-options.unit.test.js` — inserts the default option onto a
      reservation that lacks it (configured `offered`, 0 €, option `priceType`); skips an
      already-attached one (no duplicate/overwrite); only its own property + `kind='reservation'`
      (devis untouched); honours the offered flag; no-op when the property has no defaults; idempotent.
- [x] `public-catalog-sort-by-price.unit.test.js` — `listOptions` excludes an offered-default option.
- [x] Regression: full server suite stays green (1362).

### Manual UI verification
- [ ] Gîte reservation (e.g. #22200): the bed-config card now shows; setting counts + saving persists
      the offered linen line + the bed counts.
- [ ] Aventura lodge reservation: unchanged (linen already applicable there).
- [ ] WordPress: the Gîte booking form still does **not** list the linen option.

## 8. Out of scope

- Adding a second, Gîte-specific linen option (the Gîte reuses option 8 by design).
- Changing how `property_option_defaults` is configured in Paramètres.
- Any change to the laundry aggregation or bed-count semantics.
- Showing/altering the option on the public quote breakdown.

## 9. Open questions — resolved 2026-06-11

- **Q1 — existing reservations: read-time injection or backfill migration?** → **Backfill migration**
  (B). The rows are materialised for all existing reservations at deploy (user accepts the ~22-row
  prod mutation; additive, 0 €).
- **Q2 — backfill only offered defaults or all?** → **All defaults.** Migration B backfills every
  property default (respecting each one's `offered` flag). In prod that's only the Gîte's offered
  linen, so no money changes.
- **Q3 — offered linen line on a WordPress-originated devis?** → **OK, show it as « offert ».** The
  client-facing WordPress form stays unchanged (linen not selectable); only the admin-side devis/PDF
  shows the 0 € « offert » line. No extra public-devis exclusion needed.
