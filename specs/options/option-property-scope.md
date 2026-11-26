# Option property scope — explicit « Tous les logements », empty = available nowhere

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/option-planning-card` _(folded into the current branch)_ |
| **Created** | 2026-06-17 |
| **Author** | Adrien |
| **Touches** | `database.js`, `models/optionsModel.js`, `utils/pricing.js`, `pages/OptionsPage.js`, `components/PropertiesMultiSelect.js`, `components/PricedItemsPage.js`, `pages/ReservationPage.js`, `pages/PropertyDetail.js` |

---

## 1. Context

An option's availability is driven by `property_options` (option↔property links). Historically an option
with **no links** meant **« Tous les logements » (global, available everywhere, including future ones)**.
Adrien wants « Tous les logements » to be an **explicit, mutually-exclusive choice** in the dropdown, and a
**genuinely empty selection** to mean **available for NO property** (so an option can be parked/disabled).

Decision (AskUserQuestion 2026-06-17): **« Tous les logements » = links to every CURRENT property** (a row
per property). No behavioural schema column. A property added *later* is **not** auto-covered (the operator
re-opens the option). **Empty links = available nowhere.**

## 2. Goal

Three explicit states for an option's scope:
- **Tous les logements** — a `property_options` row for every current property.
- **Specific list** — rows for the chosen properties.
- **Aucun (vide)** — no rows → the option is offered for **no** reservation.

The old implicit rule « no rows = all » is **removed everywhere**.

## 3. Functional rules

1. The « Logements » dropdown lists **« Tous les logements »** as a selectable item alongside each property.
2. Selecting **« Tous les logements »** selects **every current property** (and visually deselects the
   individual ticks → they're all on); selecting/deselecting an individual property leaves the others.
3. **Empty selection** → the option is **applicable to no property**: it never appears in a reservation's
   option list, the pricing engine never applies it, and the public booking API never offers it.
4. **Migration (one-time).** Every option that currently has **no** `property_options` row (i.e. the legacy
   « global ») is linked to **all current properties**, preserving its current availability. Guarded so it
   runs exactly once (a marker column `scopeMigratedV2`); options created/edited afterwards are free to be
   « Aucun ».
5. Resources are **unchanged** (their `PropertiesMultiSelect` keeps the legacy « empty = all » contract; the
   new behaviour is opt-in per the `emptyMeansNone` prop).

## 4. Architecture

### 4.1 Server (`server/src/`)
| Layer | File | Responsibility |
|---|---|---|
| database | `database.js` | One-time migration: add marker `options.scopeMigratedV2`; for every option with no `property_options` row, insert a row per current property. |
| models | `models/optionsModel.js` | `listForProperty`: drop the `NOT EXISTS (…) = global` clause → only options **linked to this property**. (create/update already replace the links from `propertyIds`.) |
| pricing | `utils/pricing.js` | `getApplicableOptions`: drop `propertyIds.length === 0 ||` → keep only `propertyIds.includes(pid)`. |

### 4.2 Client (`client/src/`)
| Layer | File | Responsibility |
|---|---|---|
| components | `components/PropertiesMultiSelect.js` | New `emptyMeansNone` prop: « Tous les logements » selects all current ids (stored explicitly); no `-1` sentinel; empty = none; renderValue shows « Tous les logements » when all ids present, the names when some, « Aucun logement » when empty. Default (resources) keeps the legacy contract. |
| pages | `pages/OptionsPage.js` | Pass `emptyMeansNone`; `OptionPriceSection`/`OptionDefaultsSection` use the selected ids (no empty→all fallback). |
| components | `components/PricedItemsPage.js` | Options list: show « Tous les logements » only when linked to every property, else the names, else « Aucun logement ». (Resources keep « empty = all ».) |
| pages | `pages/ReservationPage.js` | The 5 `availableOpts` filters drop `!propertyIds || length === 0 ||` → keep `propertyIds.includes(pid)`. |
| pages | `pages/PropertyDetail.js` | Option scope display reflects the explicit links. |

## 5. Data model
No new tables. `property_options` now fully encodes scope (a row per covered property). `options.scopeMigratedV2`
is a one-time migration marker (not used in business logic).

## 6. Test plan
- [x] `optionsModel.listForProperty`: linked → returned; not linked → absent; unlinked option appears for no
  property; a property with no links sees nothing. (`options-model-list-for-property.unit.test.js`.)
- [x] `pricing` (getApplicableOptions): an option not linked to the property is not applied.
  (`pricing-option-property-price.unit.test.js`.)
- [x] Migration: previously-unlinked options end up linked to all properties; already-scoped untouched;
  the once-only guard is required (else a « Aucun » option would be re-linked). (`option-scope-migration.unit.test.js`.)
- [x] Default-option / public-devis suites updated to link options explicitly (no more « empty = all »).
- [x] Manual (dev, 2026-06-17): migration linked existing global options (Ménage/Petit déjeuner/… → Gite+Tente,
  shown « Tous les logements »); the dropdown toggles « Tous » ⇄ « Aucun logement »; list column shows the
  three states. Full server suite 1594 ✓, client build ✓.

## 7. Out of scope
- Auto-covering future-added properties for a « Tous » option (operator re-selects — decision 2026-06-17).
- Resource property scope (unchanged).
