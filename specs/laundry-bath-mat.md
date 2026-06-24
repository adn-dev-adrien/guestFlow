# Bath mat (tapis de bain) as a laundry option

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/laundry-bath-mat` _(user-managed)_ |
| **Created** | 2026-06-24 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The laundry ("blanchisserie") workflow tracks **six** linen types — bed sheets
(`single`, `double`, `baby`) and towels (`large`, `medium`, `small`) — across a fixed pipeline:

- Per-type stock in `app_settings` (`bedLinenStock*` / `towelStock*`), edited on the
  **Blanchisserie** settings page ([LinenStockPage.js](../client/src/pages/LinenStockPage.js)).
- Demand is driven by two **auto-seeded linen options**: "Linge de lit" (`autoOptionType =
  'bed_linen'`, `countsAsBedLinen = 1`) and "Linge de toilette" (`autoOptionType =
  'bathroom_linen'`, `countsAsBathroomLinen = 1`), seeded by
  [bedLinenSeed.js](../server/src/utils/bedLinenSeed.js) /
  [bathroomLinenSeed.js](../server/src/utils/bathroomLinenSeed.js).
- A linen option is **active** on a reservation when it is either selected explicitly
  (`reservation_options`) **or** set as a property default (`property_option_defaults`, fallback).
- Each linen option supports — generically, for every option — a per-property **price**
  (`OptionPriceSection` → `property_option_prices`), a per-property **"inclus par défaut"**
  toggle (`OptionDefaultsSection` → `property_option_defaults`), and a read-only defaults mirror
  (`OptionPropertyDefaultsMirror`), all in [OptionsPage.js](../client/src/pages/OptionsPage.js).
- Per-day drop-off/pick-up are aggregated in [laundryModel.js](../server/src/models/laundryModel.js),
  surfaced by [planningController.js](../server/src/controllers/planningController.js); stock is
  simulated by the pure engine [linenInventory.js](../server/src/utils/linenInventory.js) and
  rendered by [LaundryDayCard.js](../client/src/components/LaundryDayCard.js).

Bath mats go to the wash with stays but have no type today: invisible in counts and stock.

## 2. Goal

Adrien can track **bath mats** as a 7th laundry item by managing a new **"Tapis de bain" option**
that behaves exactly like the existing linen options — per-property price, per-property "offered /
default", explicit selection — plus a per-property **quantity of bath mats per stay**. Bath mats
then appear in the drop-off / pick-up counts and in stock projection, and a bath-mat stock field is
added on the Blanchisserie page.

## 3. Functional rules

1. **New auto-seeded option "Tapis de bain"** (`autoOptionType = 'bath_mat'`, flag
   `countsAsBathMat = 1`, `priceType = 'per_stay'`, base price 0). Seeded + promoted idempotently
   on boot, strict mirror of the bathroom-linen seed (undeletable typed marker, title-alias
   promotion, EN title backfill).
2. **Bath mat is a 7th linen type** keyed `bathMat`, in the "towel" family (rendered under
   « Serviettes », stock stored next to `towelStock*`).
3. **Same treatment as bed/bathroom linen.** The "Tapis de bain" option gets, for free via the
   generic OptionsPage sections: per-property price, per-property "inclus par défaut", explicit
   per-reservation selection, and the defaults mirror. No bespoke wiring for those.
4. **Per-property quantity.** The option carries a per-property **bath-mat-per-stay** quantity
   (default 0), edited in the option form (mirrors the per-property price UX). Stored in a side
   table keyed `(propertyId, optionId)`, persisted through the option save payload exactly like
   per-property prices.
5. **When counted (active).** A reservation contributes bath mats **iff** the "Tapis de bain"
   option is active on it — explicit `reservation_options` row **or** the `property_option_defaults`
   fallback — using the identical resolution as the other linen options. (There is **no**
   separate always/option mode: "always for a property" = set the option as that property's
   default.)
6. **Quantity when active** = the active reservation's **property** bath-mat quantity (flat per
   stay, independent of guests / nights / beds). `0` for that property → contributes nothing.
7. **Stock.** `app_settings.towelStockBathMat` (default 0), edited on the Blanchisserie page next
   to the other towel stock. `0` = "not tracked" (no shortage line, hidden where stock-derived).
8. **Drop-off / pick-up.** On each laundry day, bath-mat drop-off = sum of the active reservation's
   property quantity over reservations whose `endDate` ∈ `(prevLaundryDay, laundryDay]`. Pick-up =
   the previous laundry day's drop-off. Same half-open boundary, skip-deferral, and
   manual-addition behaviour as the existing types.
9. **Inventory simulation.** Bath mats follow the same clean → in-circulation → dirty → at-laundry
   cycle, with the conservation invariant holding for `bathMat`.
10. **Rendering.** Bath mats appear in the « Serviettes » line of « À apporter » / « À récupérer »
    and in « Disponible après ce dépôt », only when non-zero (silent-when-zero, like other sizes).
11. **Client visibility toggle (generic).** Every option gains a `displayToClient` flag (default
    **on** — no behaviour change for existing options). A generic switch « Afficher côté client
    (fiches & emails) » in the option editor controls it. When **off**, the option is **internal
    only**: it is hidden from every client/operator-facing per-reservation surface — the
    reservation fiche extras, client emails (J-7 / J-2 / complément), the devis PDF, the public
    booking catalog + quote, and the planning/dashboard option chips — and is **not materialised**
    into `reservation_options` when applied as a property default. It is still counted in the
    laundry cards and the stock projection (those use the `countsAsBathMat` + property-default
    fallback, independent of `reservation_options`).
12. **Bath mat defaults to internal.** The seeded « Tapis de bain » option ships with
    `displayToClient = 0` — bath mats are a logistics item, surfaced only on the laundry cards and
    the stock page by default. The operator can flip the switch on to expose it as a normal
    client-facing option.

**Edge cases:**
- Property quantity 0, or option not active → 0 bath mats for that reservation.
- `towelStockBathMat = 0` → demand counts still show; no availability figure, no shortage raised.
- Manual laundry additions get **no** bath-mat field this iteration (see §8).
- Devis (`kind != 'reservation'`) never contribute.
- Pre-existing option titled "tapis de bain" → promoted to the typed marker (alias promotion).

---

## 4. Architecture

> **Fat backend, thin frontend.** All activation/quantity logic and aggregation live on the
> server; the client renders ready-made counts and binds plain fields.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migrations: `options.countsAsBathMat` (INT def 0); `app_settings.towelStockBathMat` (INT def 0); new table `property_option_bath_mats (propertyId, optionId, quantity, PK(propertyId, optionId))`; call the new bath-mat seed at boot (next to `ensureDefaultBathroomLinenOption`). |
| `utils/` | `bathMatSeed.js` | C | `ensureDefaultBathMatOption(db)` — strict mirror of `bathroomLinenSeed.js`: seed/promote "Tapis de bain" with `autoOptionType='bath_mat'`, `countsAsBathMat=1`, EN title "Bath mat". |
| `models/` | `optionsModel.js` | T | Round-trip `countsAsBathMat`; read/write the per-property quantity map (`propertyBathMats`) through the option payload, mirroring the existing `propertyPrices` handling against `property_option_bath_mats`. |
| `models/` | `settingsModel.js` | T | Add `towelStockBathMat` to the persisted columns + defaults. |
| `utils/` | `settingsResponse.js` | T | Surface `linenStock.towelBathMat`. |
| `controllers/` | `settingsController.js` | T | Map `linenStock.towelBathMat` → `towelStockBathMat` (reuse `validateLinenStockCount`). |
| `utils/` | `linenInventory.js` | T | Add `bathMat` to `TOWEL_TYPES`/`ALL_TYPES`/`zeroByType`; `computeReservationContract` takes a `bathMatContext { quantity, active }` → `out.bathMat`; `buildContractsByReservationId` resolves the active bath-mat option (explicit/default) per reservation and reads its property quantity. |
| `models/` | `linenInventoryModel.js` | T | Read `towelStockBathMat` into `stock.bathMat`; widen option/reservation-option/property-default fetches to include `countsAsBathMat = 1`; load `property_option_bath_mats` into a `bathMatQtyByProperty` map; pass through. Widen the reservations query so stays whose only linen is bath mats are simulated. |
| `models/` | `laundryModel.js` | T | New `dropOffBathMatForWindow(start, end)` → `{ bathMats }`: sum the active reservation's property bath-mat quantity for check-outs in `(start, end]`, gated by the active-option resolution (same UNION ALL / `NOT EXISTS` pattern as the bathroom query, joining `property_option_bath_mats`). |
| `controllers/` | `planningController.js` | T | `EMPTY_LAUNDRY_BLOCK.bathMats = 0`; `buildBlock` merges `dropOffBathMatForWindow`. `linenInventory` now projects the per-day `clean` snapshot to only the **tracked** types (stock > 0), realising the LaundryDayCard contract — a stock-0 type (incl. bath mats when untracked) no longer surfaces a misleading figure/shortage in « Disponible après ce dépôt » (§3 rule 7). |

**Client-visibility flag (§3 rules 11-12) — touched files:**

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | `database.js` | T | Migration `options.displayToClient` (INT, def 1); bath mat seed sets 0. |
| `utils/` | `bathMatSeed.js` | T | Insert the seed with `displayToClient = 0`. |
| `utils/` | `optionVisibility.js` | C | Tiny shared `isClientVisibleOption(o)` helper, reused by every filter site. |
| `models/` | `optionsModel.js` | T | Round-trip `displayToClient`; expose it in list/get. |
| `models/` | `propertyIcalModel.js` | T | Skip `displayToClient = 0` options when materialising property defaults onto an iCal reservation. |
| `models/` | `reservationsModel.js` | T | Carry `displayToClient` on each `reservation.options` row (guarded SELECT) for the fiche; and **never persist** internal options to `reservation_options` in `insertOptions` — so they stay out of every per-reservation surface (dashboard/planning chips included) while the laundry/stock fallback still counts them. |
| `utils/` | `emailContextBuilder.js` | T | Drop internal options from `optionsList` / `reservedOptionsList` / complement breakdown. |
| `utils/` | `devisPdf.js` | T | Skip internal options in the PDF line-item loop. |
| `controllers/` `utils/` | `publicCatalogController.js` / `publicProjections.js` | T | Exclude internal options from the public options catalog + quote lines. |
| `components/` | `ExtrasSection.js` | T | Hide internal options from the fiche's selectable extras list (`visiblePropertyOptions`). The dashboard/planning chips need no change — internal options are never in `reservation_options` (see `reservationsModel.insertOptions`). |
| `pages/` | `OptionsPage.js` | T | Generic « Afficher côté client (fiches & emails) » switch on every option (default on; bath mat ships off). |

**Notes:** the engine stays pure (quantities + active flags passed in). `optionsModel` is the only
place that writes the per-property quantity, through the same code path as per-property prices —
no new endpoint, the existing `PUT /api/options/:id` carries it.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `OptionsPage.js` | T | New `BathMatPerPropertyField` block (per-property quantity, mirrors `OptionPriceSection`'s per-property UX), rendered when `form.countsAsBathMat`. `countsAsBathMat` stays hidden (seed-set), round-tripped via `fromItem`/`toPayload`. Add `propertyBathMats` to the form shape + payload. Price / defaults / mirror sections already render generically — no change. |
| `pages/` | `LinenStockPage.js` | T | Add « Tapis de bain » stock field in the Serviettes card (`towelBathMat`). No per-property list, no mode selector. |
| `components/` | `LaundryDayCard.js` | T | Include `bathMats` in `formatTowels` (`… · N tapis`) and the availability towel line (`TOWEL_LABELS.bathMat`). |
| `api.js` | `api.js` | T/— | `linenStock.towelBathMat` flows through existing `getSettings`/`updateSettings`; `propertyBathMats` flows through existing option create/update. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `OptionPriceSection`, `OptionDefaultsSection`, `OptionPropertyDefaultsMirror`, `FormDialog`/`DataPageScaffold`, `PageActionBar` | The whole "price / offered / default per property" treatment is reused as-is. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `BathMatPerPropertyField` | Bath-mat-specific per-property quantity editor inside the option form; mirrors `BathroomTowelCountsFields` (the per-person editor), kept local to OptionsPage like its siblings. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/options` | — | each option includes `countsAsBathMat`, `propertyBathMats: { [propertyId]: qty }` | Additive. |
| PUT/POST | `/api/options[/:id]` | `{ …, propertyBathMats: { [propertyId]: qty } }` | saved option | Persisted to `property_option_bath_mats`; quantities clamped ≥ 0. Mirrors `propertyPrices`. |
| GET | `/api/settings` | — | `linenStock: { …, towelBathMat }` | Additive. |
| PUT | `/api/settings` | `{ linenStock: { towelBathMat } }` | updated settings | Validated 0–999, like the other stock counts. |
| GET | `/api/planning/laundry` | `from`,`to` | each `dropOff`/`pickUp` block gains `bathMats` | Additive. |
| GET | `/api/planning/linen-inventory` | — | per-day `clean` snapshot gains `bathMat` | Additive. |

---

## 5. Data model

- **`options.countsAsBathMat`** `INTEGER NOT NULL DEFAULT 0` — flag, set by the seed/promotion.
- **`app_settings.towelStockBathMat`** `INTEGER NOT NULL DEFAULT 0` — bath-mat stock.
- **`property_option_bath_mats`** new table: `propertyId INT, optionId INT, quantity INTEGER NOT
  NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId)`, FKs `ON DELETE CASCADE` to properties /
  options — mirror of `property_option_prices`. Missing row = quantity 0.

**Migration strategy:** all additive with safe defaults; the seed creates/promotes the option.
No backfill. Until Adrien sets quantities + offers the option, no bath-mat demand appears, so
behaviour is unchanged on upgrade.

**Data impact:** none on existing records.

## 6. UI / UX

**OptionsPage** — editing the "Tapis de bain" option shows (top → bottom): title/description
(EN title), price (unique or per-property via `OptionPriceSection`), per-property "inclus par
défaut" (`OptionDefaultsSection`), the new **« Nombre de tapis de bain par logement »** block
(`BathMatPerPropertyField`: one integer field per property, `0` = aucun), and the read-only
defaults mirror. The `countsAsBathMat` flag is not shown (seed-managed), identical to how
`countsAsBathroomLinen` is hidden. Responsive: per-property rows stack on `xs` (mirror the price
section).

**Blanchisserie page** ([LinenStockPage.js](../client/src/pages/LinenStockPage.js)) — the Serviettes
card gains a 4th field « Tapis de bain » next to Grandes / Moyennes / Petites (`clampInt`, 0 = non
suivi). Stacks on `xs`, two-up on `lg` as today. PageActionBar/dirty-guard unchanged.

**Laundry card** ([LaundryDayCard.js](../client/src/components/LaundryDayCard.js)) — « Serviettes »
line gains `… · N tapis` when `bathMats > 0` ("tapis" invariable); availability line shows the
bath-mat figure when stock is tracked, red on shortage.

**Copy (FR):** « Tapis de bain », « Nombre de tapis de bain par logement », helper « Indiquez 0 si
ce logement ne fournit pas de tapis de bain. », « Indiquez 0 si vous ne souhaitez pas suivre ce
type. »

## 7. Test plan

### Server unit tests (all green — full suite 1820 pass)
- [x] `tests/bath-mat-seed.unit.test.js` — seed/promotion idempotency + alias, mirroring the
      bathroom-linen seed test (8 tests).
- [x] `tests/laundry-bath-mat.unit.test.js` — engine `bathMat` conservation invariant; active via
      explicit row and via property default; per-property quantity; quantity 0 / inactive → 0; plus
      `dropOffBathMatForWindow` half-open window + activation + per-property quantity + devis
      exclusion (10 tests).
- [x] `tests/options-model-bath-mats.unit.test.js` — `propertyBathMats` round-trips through option
      save (mirror of the `propertyPrices` test, 5 tests).
- [x] `tests/laundry-end-to-end.regression.test.js` + `planning-laundry-controller` — `bathMats`
      asserted in drop-off/pick-up blocks; controller emits only tracked (stock > 0) types in the
      availability snapshot.

### Manual UI verification (done via Playwright on the dev server)
- [x] Happy path: per-property quantity (Gite = 2) + option set as default on Gite + stock = 8 →
      laundry card 2026-06-30 shows « Serviettes : 4 tapis » in À apporter, « … · 4 tapis » in À
      récupérer, and « … · 2 tapis » in « Disponible après ce dépôt ». API `dropOff.bathMats = 4`.
- [x] Option/quantity round-trips: `property_option_bath_mats` + `property_option_defaults` rows
      persisted; option list shows the per-property quantity editor (mirrors bed/bathroom linen).
- [x] Edge: stock 0 → the availability snapshot omits the type entirely (verified: `baby` at
      stock 0 absent; `bathMat` appears once stock > 0). No false shortage.
- [x] Regression: E2E smoke suite 28 passed / 1 skipped, incl. linen-stock + Blanchisserie specs.

## 8. Out of scope

- Towel-per-person config stays on "Linge de toilette" / OptionsPage, unchanged.
- Manual laundry additions get no bath-mat field this iteration.
- Bath-mat invoicing beyond the standard option price mechanism (the option price handles billing
  natively, like any option).

## 9. Open questions

- (Resolved 2026-06-24) Model bath mats as a dedicated auto-seeded **option** "Tapis de bain",
  treated like the bed/bathroom-linen options (per-property price, offered, default, explicit
  selection).
- (Resolved 2026-06-24) Bath-mat quantity is **per property** (per-property side table), counted
  **when the option is active**; the earlier always/option **mode selector is dropped**.
- (Resolved 2026-06-24) Bath-mat **stock** stays on the Blanchisserie page (like the other towel
  stock), not on the option.
