# Tariff recipes — architecture

Companion to [spec.md](spec.md). Rule numbers refer to its §3.

> **Fat backend, thin frontend.** Recipes are loaded, validated, resolved and applied server-side. The
> client never parses a recipe, never derives a date and never computes a diff — it renders what the
> preview endpoint returns.

---

## 1. Change map at a glance

```
server/src/
├── recipes/                          NEW · the bundled recipes (data, not code)
│   └── aventura-lodge-2026.json
├── utils/tariffRecipe.js ........... NEW · load, validate, resolve the two sources
├── utils/seasonPlan.js ............. NEW · pure derivation of a year's ranges
├── utils/changeover.js ............. NEW · pure arrival/departure weekday validation
├── utils/pricing.js ................ extra-guest per night · tier carry-forward
│                                     · changeover breach in the quote
│                                     · grossFromNet: ceil-to-euro & fixed-cost add-on
├── models/tariffRecipeModel.js ..... NEW · diff + transactional apply
├── models/propertiesModel.js ....... platformPrices: direct row + extra-guest column
├── controllers/tariffRecipesController.js  NEW · list, read, preview, apply
├── controllers/propertiesController.js ... the new property columns
├── routes/tariffRecipes.js ......... NEW · 4 routes
├── scheduledTasks.js ............... monthly horizon check
└── database.js ..................... 9 idempotent ALTER TABLE blocks

client/src/
├── pages/TariffRecipesPage.jsx ..... NEW · read-only browser
├── pages/PropertyPricingSeasonsPage.jsx  recipe card · diff dialog · calendar markers + legend
│                                          · widened platform grid
├── pages/PropertyDetail.jsx ........ extra-guest unit · welcome-pack cost · recipe line
├── pages/Dashboard.jsx ............. generated-year alert
└── components/property/TariffRecipeCard.jsx  NEW

data/recipes/                         (on the Pi, not in the repo) local recipes & overrides
```

---

## 2. Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `recipes/` | `aventura-lodge-2026.json` | **C** | The first recipe. Data — no code in it. |
| `utils/` | `tariffRecipe.js` | **C** | Load both sources, validate, resolve overrides, cache. §2.1. |
| `utils/` | `seasonPlan.js` | **C** | Pure: a recipe + a year → the season ranges. §2.2. |
| `utils/` | `changeover.js` | **C** | Pure: resolve and check arrival/departure weekdays. §2.3. |
| `utils/` | `pricing.js` | T | The five engine changes. §2.4 to §2.8. |
| `models/` | `tariffRecipeModel.js` | **C** | Diff a property against a recipe; apply it in one transaction. §2.9. |
| `models/` | `propertiesModel.js` | T | `platformPrices` widened; the new property columns in `create`/`update`; `seasonKey` / `seasonRank` / `extraGuestPrice` / changeover on pricing rules. |
| `controllers/` | `tariffRecipesController.js` | **C** | Thin: list, read one, preview for a property, apply to a property. |
| `controllers/` | `propertiesController.js` | T | Passes the new columns through; no logic. |
| `routes/` | `tariffRecipes.js` | **C** | The four routes of §4. |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Monthly horizon check. §2.10. |
| `database.js` · `schema.sql` | | T | Nine idempotent `ADD COLUMN` blocks, kept in sync. |

### 2.1 `utils/tariffRecipe.js` — loading and validation (spec rules 26, 27)

```js
listRecipes()            // → [{ id, version, label, source: 'bundled'|'local', overridesBundled, recipe }]
getRecipe(id)            // → the resolved recipe, local winning over bundled
listInvalidRecipes()     // → [{ file, source, error }] — surfaced in the browser, never thrown at boot
validateRecipe(json)     // → { valid: true, recipe } | { valid: false, error }
```

Two sources, read in order: `server/src/recipes/*.json`, then `RECIPES_DIR` (defaults to
`<dataDir>/recipes`, resolved from the same base as the database — **never a literal path**). A local
recipe with an existing `id` replaces the bundled one entirely; no field-level merging, which would
make "what is actually applied" impossible to reason about.

Validation is a hand-written checker returning the **first** error with a path
(`seasons[2].rank: doit être un entier ≥ 1`), not a schema library — no new dependency for ~120 lines
of checks. It enforces: unique `id`, semver-shaped `version`, at least one season, unique season keys,
unique ranks, ranks forming a contiguous 1..N, every `period.season` a declared key, every `between`
bound a declared period `id`, weekdays in 0–6, `nights` ≥ 1, prices finite and ≥ 0, `horizonYears` in
1–5.

Results are cached in memory and re-read when the process restarts. A recipe file is small and read
once; there is no watcher — dropping a file in `data/recipes/` takes effect on the next restart, which
the browser page states explicitly.

**Failure isolation (rule 27):** each file is parsed and validated on its own. A broken one lands in
`listInvalidRecipes()`; it never throws, never blocks the others, never stops the boot.

### 2.2 `utils/seasonPlan.js` — the derivation (spec rules 13 to 19)

**Pure and database-free** — no `db`, no clock, no I/O — so the whole calendar is testable in
milliseconds without a fixture database.

```js
buildYearPlan(recipe, year, closures)      // → { [seasonKey]: Range[] }
buildHorizonPlan(recipe, fromYear, closures) // → { [seasonKey]: Range[] } over recipe.horizonYears
```

`closures` is a plain `[{ startDate, endDate }]` the caller has already read. Algorithm:

```
buildYearPlan(recipe, year, closures):
  # 1. Base — spec rule 13
  day[1..365] ← recipe.calendar.baseSeason

  # 2. Periods, in declaration order, last write wins — spec rule 14
  for each period p of recipe.calendar.periods:
     span ← resolveAnchor(p.anchor, year, resolvedSpans)   # 4 anchor types
     resolvedSpans[p.id] ← span
     day[span] ← p.season

  # 3. Modifiers — spec rules 15 to 17, 16bis
  for each modifier m where type = 'public_holiday_bridge':
     for each holiday h of getFrenchPublicHolidays(year):
        block  ← consecutive non-working days around h
        nights ← block minus its last day
        if m.skipClosedDays: nights ← nights \ closures
        day[nights] ← seasonAtRank(min(maxRank, rank(day[n]) + m.amount))   # once per night
        min[nights] ← max(min[nights], |block|)   # m.minNights = "block" → the pont's own length

  # 4. Back to ranges — spec rule 19
  return runsOf(day)
```

Representing the year as a **per-day array** and only converting to ranges at the end is what makes
rule 19 free: splitting a range around a raised block is a consequence of the representation, not a
special case, and overlapping ranges — which `propertiesModel` would reject — are unrepresentable.
365 entries; the cost is irrelevant and the code is obvious.

`resolveAnchor` is four small functions. `between` reads `resolvedSpans`, which is why periods resolve
in declaration order and why validation checks that a `between` only names earlier periods.

Per-period `minNights` and `changeover` ride along on each produced range, so a range carries
everything `dateRanges` needs.

### 2.3 `utils/changeover.js` — arrival and departure weekdays (spec rules 21 to 24)

```js
resolveChangeover(rules, startDate, endDate)  // → { arrival: 0..6|null, departure: 0..6|null }
checkChangeover(rules, startDate, endDate)    // → null | { arrival?, departure?, requiredArrival, requiredDeparture }
```

The arrival rule is read from the rule covering the **first night**, the departure rule from the rule
covering the **last night** (spec rule 22) — not the union over the stay, which would make a
season-spanning booking impossible for no reason. Per-range override wins over the season default,
mirroring `minNights` exactly.

The quote gains `changeoverBreached`, `requiredArrivalWeekday` and `requiredDepartureWeekday` beside the
existing `minNightsBreached` / `requiredMinNights`. Enforcement reuses the established path verbatim:
`reservationsController` refuses at [line 461](../../server/src/controllers/reservationsController.js#L461)
and [663](../../server/src/controllers/reservationsController.js#L663) with `code: 'CHANGEOVER'` unless
`forceChangeover`, exactly as `MIN_NIGHTS` / `forceMinNights` do today, and `ReservationPage` reuses its
confirm dialog. iCal import paths never call the check (spec rule 24).

### 2.4 `pricing.js` — extra-guest surcharge per night (spec rules 37, 38)

Today, [line 1155](../../server/src/utils/pricing.js#L1155):

```js
const extraGuestSurchargeOriginal = roundMoney(extraGuestCount * extraGuestUnitPrice);
```

A new pure, exported helper:

```js
// Σ of the per-night extra-guest supplement, discounted like the accommodation. Each night contributes
// unitPrice × (that night's price ÷ its season's full price), so a night sold at 70 % of the rate
// carries 70 % of the supplement. `per_stay` keeps the flat legacy result, byte-for-byte.
computeExtraGuestSurcharge({ unit, extraGuestCount, propertyUnitPrice, nightlyBreakdown, rules })
```

- `unit === 'per_stay'` (every existing property) → `extraGuestCount × unitPrice`, unchanged. **This is
  the regression guarantee.**
- `unit === 'per_night'` → `Σ_nights count × unitPriceFor(night) × ratio(night)`, where
  `unitPriceFor(night)` is the matched rule's `extraGuestPrice` when set, else the property's, and
  `ratio(night) = night.price / rule.pricePerNight`. A `fixed`-mode season yields ratio 1.
- It receives the **merged** breakdown, so a locked snapshot's frozen night prices drive the supplement:
  re-quoting an old reservation cannot silently re-price it.

The quote gains `extraGuestPriceUnit` and `extraGuestNightlyRatioTotal` (2,4 for a 3-night stay) so the
client can render « 27 €/nuit × 2 pers. × 3 nuits » without computing anything.

### 2.5 `pricing.js` — tier carry-forward (spec rule 39)

[`normalizeProgressiveTiers`](../../server/src/utils/pricing.js#L170) builds defaults for nights 2…365
from the legacy `weekPrice = base × 4` model and overrides only the nights provided, so nights past the
last configured tier follow a formula unrelated to the configured curve.

Change: after applying the provided tiers, **the highest provided tier's price carries forward** to
every subsequent night. With no tier provided at all, the legacy defaults still apply untouched.

This moves numbers for any existing `progressive` season whose stays exceed its last configured tier —
a bug fix, but a visible one. The plan checks production before merge.

### 2.6 `pricing.js` — tourist-tax base deduction (spec rules 48, 49) — **removed 2026-08-20**

This section described the deduction of `includedInRate` lines from `taxBaseAccommodation`. Rule 48 was
repealed by [tourist-tax-base-accommodation-only.md](../tourist-tax-base-accommodation-only.md): the tax
base is the accommodation charged — the manual « Prix hébergement ajusté » when set, otherwise the
tariff nights after the discount — and no option, resource, Complément routing or platform brut may move
it. The `includedInRate` tag survives, but only to render « Comprise » at 0 €. The quote exposes
`touristTaxBaseAccommodation` alone; `touristTaxIncludedInRateDeduction` and
`touristTaxBaseBeforeDeduction` are gone.

### 2.7 `pricing.js` — `grossFromNet` (spec rules 31 to 33)

```js
grossFromNet(net, commissionPercent, { fixedCost = 0, rounding = 'euro_up' } = {})
```

`euro_up` → `Math.ceil`, the new default, matching the price actually typed into a channel's back
office; `'cents'` keeps `roundMoney`. `fixedCost` is added **before** the gross-up, so the price covers
it after commission: `ceil((net + fixedCost) / (1 − c/100))`. The `c ≥ 100 → null` and `c ≤ 0 → net`
contracts are unchanged.

**Blast radius — verified.** Two callers: `propertiesModel.platformPrices` and its own unit test. It
never touches a billed amount, so whole-euro rounding is display-only and cannot move a reservation
total.

### 2.8 `propertiesModel.platformPrices` (spec rule 34)

Three changes to [the current implementation](../../server/src/models/propertiesModel.js#L412): the
`WHERE LOWER(name) != 'direct'` filter is dropped and the direct row is emitted first with
`fixedCost = property.welcomePackCost` (when no `Direct` platform row exists, a synthetic
`{ id: 'direct', commissionPercent: 0 }` entry stands in); each season gains `extraGuestByPlatform`,
grossed up **without** the fixed cost; the response carries `extraGuestNet` and `extraGuestPriceUnit`.
Net pivots come from the `netTargetPerNight` / `extraGuestNetTarget` columns per §2.11 (spec rule
34bis). Additive — existing `byPlatform` keys keep their meaning, so a stale client still renders.

### 2.9 `models/tariffRecipeModel.js` — diff and apply (spec rules 8 to 12)

Factory `(db) => ({ preview, apply })`, matching the codebase's model convention.

```js
preview(propertyId, recipeId) → {
  recipe: { id, version, label },
  horizon: { fromYear, toYear },
  seasons: [ { seasonKey, label, action: 'create'|'update'|'remove'|'unchanged',
               fieldChanges: [ { field, from, to } ],
               rangesAdded: Range[], rangesRemoved: Range[] } ],
  closures: { added: [], kept: [] },
  warnings: string[],
  blocking: boolean,
}
apply(propertyId, recipeId) → { applied, seasons, closures, warnings }
```

Each guarantee is a spec rule made mechanical:

- **Rule 9** — a `pricing_rules` row with `seasonKey IS NULL` is manual: it is never read as a target,
  and its ranges are **obstacles** the generated ranges must not overlap. A row whose `seasonKey` the
  recipe no longer declares gets `action: 'remove'`.
- **Rule 10** — `apply` runs inside one `db.transaction`. It reuses `propertiesModel`'s pricing-rule
  create/update/delete rather than writing `dateRanges` JSON by hand, so the overlap validation that
  already exists still runs on every write.
- **Rule 11** — the diff is computed by comparing normalised structures, so an unchanged property
  yields every season `unchanged` and `apply` writes nothing.
- **Rule 12** — ranges whose `endDate` precedes 1 January of `fromYear` are copied verbatim. Past years
  are structurally out of reach.
- **Blocking** (`blocking: true`, nothing written): recipe not found; a generated range overlapping a
  manual season; a season key declared twice; a changeover pair that makes every stay impossible.

Closures are written before the seasons, so `skipClosedDays` sees them.

### 2.10 `scheduledTasks.js` — horizon extension (spec rule 12)

```
monthly, for each property with tariffRecipeId ≠ '':
   covered ← last year fully covered by its recipe-owned seasons
   if covered < currentYear + horizonYears − 1:
      result ← tariffRecipeModel.apply(propertyId, tariffRecipeId)
      raise a Dashboard alert naming the property and the generated year — or the blocking reason
```

Idempotent and safe to run twice: a covered horizon produces an empty diff and writes nothing. A
blocking condition alerts instead of writing — the operator is told, never left with a half-configured
year. The alert reuses the existing Dashboard plumbing
([dashboardController.js](../../server/src/controllers/dashboardController.js)); no new channel, no push.

### 2.11 `database.js`

```sql
ALTER TABLE properties    ADD COLUMN tariffRecipeId       TEXT    DEFAULT '';
ALTER TABLE properties    ADD COLUMN tariffRecipeVersion  TEXT    DEFAULT '';
ALTER TABLE properties    ADD COLUMN extraGuestPriceUnit  TEXT    DEFAULT 'per_stay';
ALTER TABLE properties    ADD COLUMN welcomePackCost      REAL    DEFAULT 0;
ALTER TABLE pricing_rules ADD COLUMN seasonKey            TEXT    DEFAULT NULL;
ALTER TABLE pricing_rules ADD COLUMN seasonRank           INTEGER DEFAULT NULL;
ALTER TABLE pricing_rules ADD COLUMN netTargetPerNight    REAL    DEFAULT NULL;
ALTER TABLE pricing_rules ADD COLUMN extraGuestPrice      REAL    DEFAULT NULL;
ALTER TABLE pricing_rules ADD COLUMN extraGuestNetTarget  REAL    DEFAULT NULL;
ALTER TABLE pricing_rules ADD COLUMN maxNights            INTEGER DEFAULT NULL;
ALTER TABLE pricing_rules ADD COLUMN changeoverArrival    INTEGER DEFAULT NULL;
ALTER TABLE pricing_rules ADD COLUMN changeoverDeparture  INTEGER DEFAULT NULL;

CREATE TABLE IF NOT EXISTS tariff_recipe_runs (   -- scheduled-task journal → Dashboard alerts
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  propertyId INTEGER NOT NULL,
  recipeId TEXT NOT NULL,
  recipeVersion TEXT NOT NULL DEFAULT '',
  generatedYear INTEGER,
  note TEXT NOT NULL DEFAULT '',
  blocking INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  dismissedAt TEXT,
  FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
);
```

`platformPrices` grosses up from `COALESCE(netTargetPerNight, pricePerNight)` per season and
`COALESCE(extraGuestNetTarget, rule.extraGuestPrice, property.extraGuestPrice)` for the extra-guest
column (spec rule 34bis) — legacy rows have every net column `NULL`, so the grid keeps meaning
"gross up the season price", exactly today's contract.

All wrapped in the file's established idempotency pattern — a `PRAGMA table_info(…)` guard block, as
used for `publicDepositEnabled` at [database.js:393](../../server/src/database.js#L393). Every default
reproduces current behaviour, so no backfill and no data risk.

Per-range `minNights`, `changeoverArrival` and `changeoverDeparture` ride inside the existing
`dateRanges` JSON; `normalizeDateRanges`
([pricing.js:77](../../server/src/utils/pricing.js#L77)) gains the two changeover keys next to the
`minNights` handling it already has, with the same "blank means inherit" rule.

---

## 3. The recipe document

```jsonc
{
  "id": "aventura-lodge-2026",
  "version": "1.0.0",
  "label": "Aventura Lodge — tarification tout compris 2026",
  "description": "Cible nette remontée par la commission du canal ; prix tout compris.",
  "horizonYears": 2,

  "extraGuest": { "appliesAbove": 2, "unit": "per_night", "followsDiscount": true },

  // The source document's §6 table, verbatim — one set of percentages for the three seasons.
  "lengthOfStayDiscounts": [
    { "nights": 2, "discountPct": 24 }, { "nights": 3, "discountPct": 33 },
    { "nights": 4, "discountPct": 38 }, { "nights": 5, "discountPct": 41 },
    { "nights": 6, "discountPct": 43 }, { "nights": 7, "discountPct": 45 }
  ],

  "seasons": [
    { "key": "low",  "label": "Basse saison",   "rank": 1, "color": "#5B8C6E",
      "pricePerNight": 179, "netTargetPerNight": 160, "pricingMode": "progressive",
      "extraGuestPrice": 27, "extraGuestNetTarget": 25,
      "minNights": 1, "maxNights": 7, "changeover": null },
    { "key": "mid",  "label": "Moyenne saison", "rank": 2, "color": "#D9A441",
      "pricePerNight": 216, "netTargetPerNight": 195, "pricingMode": "progressive",
      "extraGuestPrice": 27, "extraGuestNetTarget": 25,
      "minNights": 1, "maxNights": 7, "changeover": null },
    { "key": "high", "label": "Haute saison",   "rank": 3, "color": "#C25B4E",
      "pricePerNight": 247, "netTargetPerNight": 225, "pricingMode": "progressive",
      "extraGuestPrice": 27, "extraGuestNetTarget": 25,
      "minNights": 1, "maxNights": 7, "changeover": null }
  ],

  "calendar": {
    "baseSeason": "low",
    "periods": [
      { "id": "july-shoulder",   "season": "mid",
        "anchor": { "type": "nth_weekday_of_month", "month": 7, "weekday": 6, "occurrence": 1 },
        "nights": 7 },
      { "id": "august-shoulder", "season": "mid",
        "anchor": { "type": "last_full_week_of_month", "month": 8, "weekday": 6 },
        "nights": 7 },
      { "id": "summer-core",     "season": "high",
        "anchor": { "type": "between", "after": "july-shoulder", "before": "august-shoulder" } }
    ],
    "modifiers": [
      { "type": "public_holiday_bridge", "effect": "raise_rank", "amount": 1,
        "skipClosedDays": true, "minNights": "block" }
    ]
  },

  "closures": [
    { "label": "Fermeture hivernale", "from": "10-15", "to": "03-31" }
  ]
}
```

Three mutually exclusive ways to declare the curve, all resolved by the loader into the
`progressiveTiers` the engine already consumes, so the engine keeps one tier format:

| Form | Meaning |
|---|---|
| `lengthOfStayDiscounts` | A **cumulative** discount table — the form the source document uses. Each night's marginal price is the difference between two cumulative totals, both rounded to the cent, so the totals an operator reads in the document come out exact. Declared at recipe level (shared by every season) or per season. |
| `extraNightRatio` | A flat ratio for every night after the first; expands to the single night-2 tier the carry-forward extends. |
| `progressiveTiers` | Explicit marginal prices, for a curve neither form expresses. |

Nights past the last declared one fall to the engine's carry-forward (spec rule 39): the last tier
repeats, which is what keeps a further night from ever costing more than the one before it.

Tightening high season later is the one-line edit spec rule 45 promises:

```jsonc
{ "key": "high", …, "minNights": 7, "changeover": { "arrival": 6, "departure": 6 } }
```

---

## 4. Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `TariffRecipesPage.jsx` | **C** | Read-only browser: cards, source badges, invalid-recipe errors, properties using each. |
| `pages/` | `PropertyPricingSeasonsPage.jsx` | T | Hosts `TariffRecipeCard`; renders the diff dialog's payload; season-key badges on rows; calendar markers + legend; the widened platform grid. |
| `pages/` | `PropertyDetail.jsx` | T | Extra-guest unit selector, welcome-pack cost field, read-only recipe line with a link. |
| `pages/` | `Dashboard.jsx` | T | The generated-year alert in the existing list. |
| `components/property/` | `TariffRecipeCard.jsx` | **C** | Active recipe, applied version, moved-version warning, recipe select, apply action. |
| `components/` | `PricingSummary.jsx` | T | Per-night extra-guest label, tax-base deduction line, changeover breach message. |
| `hooks/` `services/` `utils/` `constants/` `styles/` | — | — | (none) |
| `api.js` | `api.js` | T | `getTariffRecipes`, `getTariffRecipe`, `previewTariffRecipe`, `applyTariffRecipe`. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `TableCard`, `StatusBadge`, `ErrorAlert`, `EmptyState`, `ConfirmDialog`, `LoadingState`, `PricingSummary`, `HelpedTextField` | The source badge is a `StatusBadge`; an invalid recipe is an `ErrorAlert`; the diff dialog is a `ConfirmDialog` with the diff as its body. |
| **Created (new generic)** | — | Nothing here generalises: a unit selector bound to one column, one table column, calendar markers tied to this calendar. Extracting would be premature per CLAUDE.md §7. |
| **Specific (kept feature-local)** | `TariffRecipeCard` | In `components/property/`. Bound to one property's recipe fields and to the preview endpoint's exact shape — a feature component, not a generic waiting to be extracted. |

**French strings added:** « Recettes tarifaires », « Livrée », « Locale », « Écrase la version livrée »,
« Recette introuvable », « Version {v} disponible », « Changer de recette », « Appliquer la recette »,
« Aperçu des modifications », « sera supprimée », « Manuelle », « Arrivée le {jour} uniquement »,
« Départ le {jour} uniquement », « min {n} nuits », « par séjour », « par nuit », « Coût du pack accueil
(direct) », « Personne supp. / nuit », « Direct (moteur Lodgify) », « Base : {x} − {y} de prestations
comprises ».

---

## 5. API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/tariff-recipes` | — | `{ recipes[], invalid[] }` | Each recipe: `id`, `version`, `label`, `source`, `overridesBundled`, `usedByProperties[]`. |
| GET | `/tariff-recipes/:id` | — | the resolved recipe document | For the browser's expandable view. |
| GET | `/properties/:id/tariff-recipe/preview?recipeId=` | — | the §2.9 preview shape | Read-only; computes the diff without writing. |
| POST | `/properties/:id/tariff-recipe/apply` | `{ recipeId }` | `{ applied, seasons, closures, warnings }` | Transactional; `409` when `blocking`. |
| PUT | `/properties/:id` | **+** `tariffRecipeId`, `extraGuestPriceUnit`, `welcomePackCost` | unchanged | All optional. |
| GET | `/properties/:id/platform-prices` | — | **+** `isDirect`, `extraGuestByPlatform`, `extraGuestNet`, `extraGuestPriceUnit` | Additive. |
| POST | `/reservations/calculate-price` | unchanged | **+** `changeoverBreached`, `requiredArrivalWeekday`, `requiredDepartureWeekday`, `extraGuestPriceUnit`, `extraGuestNightlyRatioTotal`, `touristTaxBaseAccommodation` | Additive; every existing key keeps its meaning and value for unconfigured properties. |
| POST/PUT | `/reservations` | **+** `forceChangeover` | **+** `409 { code: 'CHANGEOVER', … }` | Mirrors `forceMinNights` / `MIN_NIGHTS` exactly. |

All routes sit behind the existing auth middleware. Apply is admin-only, like the other tariff writes.

**Validation.** `extraGuestPriceUnit` rejected unless `per_stay` / `per_night`; `welcomePackCost` and
`extraGuestPrice` through the existing `validateMoneyAmount`
([financeValidation.js](../../server/src/utils/financeValidation.js)); `changeoverArrival` /
`changeoverDeparture` rejected unless `null` or an integer 0–6; `tariffRecipeId` rejected unless it
names a loaded recipe or is empty.

---

## 6. Production configuration

`scripts/configure-aventura-lodge-2026.mjs`, run on the Pi after deployment. It handles only what a
recipe deliberately does **not** cover (spec rule 6): property fields (capacity, occupancy, check-in and
check-out, deposit, extra-guest unit, welcome-pack cost), the platform commissions, the linen and
cleaning options as property defaults marked offered, and the welcome-pack option.

Then it sets `tariffRecipeId` and calls `tariffRecipeModel.apply()`. **The calendar has exactly one
implementation in the codebase**, and production configuration goes through it like the UI and the
scheduled task.

Idempotent upserts keyed on natural keys, **scoped to one property by name** so a typo cannot reach the
Gîte, a printed diff, and `--apply` required to write — dry run by default. It never deletes an option,
never touches a reservation, and writes only to `properties`, `pricing_rules`, `establishment_closures`,
`platforms`, `property_options`, `property_option_defaults` and `property_option_prices`. A backup is
taken before the first `--apply` per [backup-restore.md](../backup-restore.md).
