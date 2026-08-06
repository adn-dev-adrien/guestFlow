# Option categories — collapsible groups on the reservation form and the public widget

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/option-categories` |
| **Created** | 2026-08-06 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The option catalogue is a **flat list**. There is no notion of category, group, or display order
anywhere:

- `options` ([schema.sql:192-199](../server/src/schema.sql#L192-L199)) has no `category` / `group` /
  `sortOrder` column. The only typing is `autoOptionType`, a technical seed marker
  (`early_check_in`, `late_check_out`, `bed_linen`, `bathroom_linen`, `bath_mat`, `breakfast`,
  `cleaning`) — a behavior discriminator, not a business category.
- The admin catalogue ([OptionsPage.js](../client/src/pages/OptionsPage.js) over
  [PricedItemsPage.js](../client/src/components/PricedItemsPage.js)) is a sortable table with no
  grouping.
- The reservation form ([ExtrasSection.js:332-517](../client/src/components/reservation/ExtrasSection.js#L332-L517))
  renders one `Card` per option in a single flat `Stack`, ordered by title.
- The WordPress booking widget ([view.js:312-361](../integrations/wordpress/guestflow-booking/blocks/booking/view.js#L312-L361))
  renders options **and** resources into one uniform `.gf-lines` list, per
  [wp-booking-widget-redesign.md](wp-booking-widget-redesign.md) §3 rule 1.

Three families of options make that flat list unmanageable:

1. **Animations** — 5 options already exist in production, grouped only by a *textual* prefix in
   their title (ids 11-15: « Animation-visite animaux », « Animation-animaux sauvage »,
   « Animation-chasse aux œufs », « Animation-balade nocturne », « Animation enfants + bain
   nordique »). They inflate the option list on every reservation even though they apply to a
   minority of stays.
2. **Boissons** — a 9-article drinks price list (§5.4) that does not exist in the catalogue yet.
3. **Restauration** — the 5 « Planches apéro » (§5.4) plus the existing « Le repas des trappeurs »
   (id 16), which is a meal, not an animation.

Dropped into the flat list, those 20 lines would drown the ~7 structural options (linge de lit,
linge de toilette, tapis de bain, ménage, petit déjeuner, arrivée anticipée, départ tardif) that
matter on *every* reservation.

## 2. Goal

An option can be filed under a **category**. On the reservation form and on the public WordPress
widget, each category renders as a collapsible section placed after the ungrouped options,
**collapsed by default but always showing what is already selected**, so long tails like
« Boissons » stay out of the way without ever hiding a charge. The drinks and apéro boards ship as
regular catalogue options, editable afterwards like any other.

## 3. Functional rules

### Categories

1. Every option carries an optional free-text `category` (empty string = no category).
2. Options with an empty `category` keep today's behavior exactly: flat list, ordered by title,
   rendered first.
3. Options with a non-empty `category` are grouped by exact category label. Groups are ordered
   alphabetically (French collation, case-insensitive); options **inside** a group are ordered by
   title, as today.
4. Grouping and ordering are computed **server-side** and shipped ready-to-render. No `groupBy`,
   `sort`, or category derivation in React or in the WP widget (CLAUDE.md §6.0).
5. A category is a plain label, not an entity: creating one = typing a new name on an option.
   Renaming it on every option that uses it makes the old one disappear. No categories table, no
   orphan cleanup, no reorder UI.
6. The admin catalogue offers the existing labels as suggestions (free-solo autocomplete) so
   « Boissons » and « Boisson » don't diverge by a typo. Labels are trimmed; a whitespace-only input
   stores `''`.

### Rendering — reservation form

7. In the « Options » sub-section of `ExtrasSection`, ungrouped options render first, unchanged;
   each category then renders as one collapsible section, after them, in the order of rule 3.
8. A category section is **collapsed by default**.
9. **Selected options are pinned and never hidden.** Inside a section, the options currently enabled
   on the reservation render *first* and stay visible even while the section is collapsed.
   Collapsing hides only the not-enabled remainder. Reopening a reservation with 2 drinks ticked
   shows exactly those 2 cards under « Boissons », the other 7 folded away.
9bis. **An option can be pinned permanently.** `alwaysVisible` on the option makes it render outside
    the collapse whether or not it is selected — for a service the operator must be able to offer on
    every stay without hunting for it. « Petit déjeuner » ships that way under « Restauration ».
    The flag is opt-in (off by default) and only meaningful inside a category, since an ungrouped
    option is never folded.
10. The toggle states what it hides: « Voir les 7 autres » when collapsed, « Réduire » when open.
    A section with nothing pinned shows only its header + « Voir les 9 options » — zero cards.
11. The section header shows the label and, when > 0, a soft `success` chip with the number of
    **selected** options, e.g. « Boissons ③ ». An `alwaysVisible` option the operator hasn't ticked
    is visible but does **not** count — the chip answers « what am I billing? », not « what is on
    screen? ». It is redundant with the pinned cards by design: it survives scrolling past the
    section.
12. Expand/collapse is local UI state only — not persisted, not sent to the server, reset on reload
    (rule 9 is what carries the meaningful state across reloads).
13. The « Options personnalisées » and « Ressources » sub-sections are untouched and stay after the
    categories.
14. An option hidden by `displayToClient = 0` ([optionVisibility.js](../server/src/utils/optionVisibility.js),
    per [laundry-bath-mat.md](laundry-bath-mat.md) §3 rule 11) is filtered out **before** grouping.
    A category left with zero visible options renders nothing at all.

### Rendering — public WordPress widget

15. The public options endpoint exposes `category` and a server-computed group structure; the widget
    renders ungrouped options first (current uniform `.gf-lines` list), then one collapsible section
    per category, **collapsed by default**.
16. Rules 9 and 9bis apply identically: a line the guest has picked (quantity > 0) — or one flagged
    `alwaysVisible` — stays visible when the section is collapsed. A collapsed section must never
    hide a charge the guest is about to pay, nor the breakfast offer.
17. Resources keep their current placement — appended to the ungrouped list, before the category
    sections. Resources have no category.
18. Every new visible string goes through `GF.t()` and is declared in
    [class-gf-blocks.php:77-147](../integrations/wordpress/guestflow-booking/includes/class-gf-blocks.php#L77-L147).
    Category labels themselves come from the data, untranslated.
19. The `ⓘ` description toggle inside a line keeps working unchanged
    ([wp-booking-widget-redesign.md](wp-booking-widget-redesign.md) §3 rule 14).
20. The live quote summary (`drawSummary`) stays a **flat** list of selected lines — a guest reading
    their total must not have to expand anything.

### Seeded catalogue (Boissons + Restauration)

21. The §5.4 articles are created as ordinary catalogue options: `priceType = 'per_stay'` (unit
    price × operator-entered quantity), `displayToClient = 1`, linked to **both** properties,
    `category` = `Boissons` or `Restauration`.
22. They are **structural boot-time seeds**, with the exact semantics of the linen and breakfast
    seeds ([bedLinenSeed.js](../server/src/utils/bedLinenSeed.js),
    [breakfastSeed.js](../server/src/utils/breakfastSeed.js)): idempotent, non-destructive, re-run on
    every server start, re-creating any row that has gone missing.
23. Identity is carried by a new `options.seedKey` column, **not** by the title — so renaming,
    re-pricing, or rewriting the description of a seeded article sticks across restarts instead of
    spawning a duplicate. (`autoOptionType` cannot serve here: it is a single-valued behavior
    discriminator, and these are 14 distinct rows with no engine behavior.)
24. Adoption path, mirroring `KNOWN_TITLE_ALIASES`: at boot, an option whose title matches a seed
    definition exactly (trimmed, case-insensitive) but carries no `seedKey` is **adopted** — it
    receives the `seedKey` and the `category` — rather than duplicated.
25. Retiring a seeded article uses the **normal delete button**, which in GuestFlow is a soft-delete
    / archive ([option-soft-delete.md](option-soft-delete.md)) — and it **sticks**: the seed's
    existence check ignores `archivedAt`, so an archived article is never re-created.
    Seeded rows are deliberately **not** made undeletable the way the linen and breakfast rows are
    (`isDeleteDisabled` on `autoOptionType`): those are singletons the app's laundry and planning
    logic depend on, whereas a beer going out of stock is routine catalogue upkeep. Since there is
    no hard delete in the product, blocking the button would leave no way at all to retire an
    article. `seedKey` is what guarantees an *edited* article is never duplicated; archiving is what
    retires one.
26. Seeded prices are the **selling prices** of column 6 of the price list (the bold amounts), not
    the cost or the margin columns.

### Category backfill

27. A one-shot migration `option_categories_v1`, guarded by the `migrations` table (like
    `breakfast_card_occurrences_v1`, [database.js:1033-1035](../server/src/database.js#L1033-L1035)),
    assigns: `Animations` to the options whose title starts with `Animation` (case-insensitive), and
    `Restauration` to « Le repas des trappeurs ». Options already carrying a category are skipped.

**Edge cases:**
- Option catalogue with no category at all → the reservation form and the widget look exactly like
  today (no empty section, no header).
- A category whose options are all `displayToClient = 0` → section not rendered (rule 14).
- A locked/past reservation ([reservation-option-immutability.md](reservation-option-immutability.md))
  → sections still expand; pinned enabled options are visible as today, controls disabled as today.
- An archived option (`archivedAt`) → excluded upstream by `ACTIVE_AND_O`
  ([optionsModel.js:49-55](../server/src/models/optionsModel.js#L49-L55)); it never reaches grouping.
- Every option of a category is pinned (enabled and/or `alwaysVisible`) → the toggle disappears
  (nothing left to reveal).
- An `alwaysVisible` option on an **ungrouped** option → no visible effect; the admin only offers the
  checkbox once a category is set.
- Category label containing only spaces → normalized to `''` on write (rule 6), i.e. ungrouped.
- A seeded article renamed by the operator, then a new property is created → the seed links the
  renamed row (matched by `seedKey`) to the new property; it does not re-insert the original title.

---

## 4. Architecture

> **Fat backend, thin frontend.** The `category` column, the label normalization, the group ordering
> and the group membership all live on the server (`utils/optionGrouping.js`, unit-tested) and reach
> the client as a ready-to-render `{ ungrouped, groups }` structure — on the property detail payload
> for the fiche, and on the public options endpoint for the widget.
>
> **Two things are client-side, deliberately:** the open/closed boolean per section, and the
> pinned/foldable split inside a group. The split reads the operator's *current, unsaved* selection
> (`form.selectedOptions`), which by definition cannot come from the server — it is UI state, not
> business data. `groupOptionsByCategory` exposes the same split server-side
> (`pinned` / `foldable` / `enabledCount`) and `isPinnedOption` is the single tested definition of
> the rule, mirrored by one line in `ExtrasSection` and one in the widget.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `options.js` | T | Accepts `category` in the POST/PUT body |
| `routes/` | `public/properties.js` | — | (none — same endpoints, richer payload) |
| `controllers/` | `optionsController.js` | — | (none — thin pass-through already) |
| `controllers/` | `public/publicCatalogController.js` | T | `listOptions` returns the grouped shape instead of a flat array |
| `models/` | `optionsModel.js` | T | `category` / `seedKey` / `alwaysVisible` in the projections, `create`, `update`; `persistCategory` + `persistAlwaysVisible` guarded writes; `ORDER BY category, title` |
| `models/` | `propertiesModel.js` | T | `getByIdWithDetails` adds `property.optionGroups` (visibility-filtered, grouped) + lazy-links the catering catalogue to a property created after boot |
| `utils/` | `optionGrouping.js` | **C** | Pure: `normalizeCategory` + `isPinnedOption` + `groupOptionsByCategory(options, enabledIds)` → `{ ungrouped, groups: [{ category, options, pinned, foldable, enabledCount }] }` + `listCategories` (rules 2-3, 9, 9bis) |
| `utils/` | `cateringSeed.js` | **C** | The §5.4 definitions (Boissons + Restauration) + the structural seeder (rules 21-26), built on the `bedLinenSeed.js` skeleton |
| `utils/` | `optionCategoriesMigration.js` | **C** | The two one-shot backfills (rule 27 + §5.3bis), extracted so they are unit-testable — the house pattern of `zeroBedsWhenNoBedLinenMigration.js` |
| `utils/` | `publicProjections.js` | T | `toPublicOption` exposes `category` |
| `middleware/`, `scheduledTasks.js` | — | — | (none) |
| `database.js` | `database.js` | T | `migrateOptionsColumns()` gains `category`, `seedKey`, `alwaysVisible`; calls `ensureCateringOptions()` beside the other seeds; runs `option_categories_v1` and `option_breakfast_restauration_v1` behind the `migrations` flags |

`reservationsModel.js` is **not** touched: the fiche reads its catalogue from `property.options`
(`optionsModel.listForProperty`, a `SELECT o.*`), so `category` flows through already.

`optionGrouping.js` is a pure module — no DB access — unit-testable in isolation and shared by the
admin payload, the reservation payload and the public payload.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `OptionsPage.js` | T | `category` + `alwaysVisible` in `emptyOption`; `CategoryField` = autocomplete + « Toujours visible » checkbox (`isDeleteDisabled` unchanged — rule 25) |
| `pages/` | `ReservationPage.js` | T | Passes the grouped option payload through `ReservationFormContext` |
| `components/` | `reservation/ExtrasSection.js` | T | Renders ungrouped options, then one `OptionCategorySection` per category |
| `components/` | `reservation/OptionRow.js` | **C** | The existing per-option `Card` block, extracted verbatim so pinned, folded and ungrouped options share one renderer |
| `components/` | `reservation/OptionCategorySection.js` | **C** | Header + count chip + pinned enabled rows + `Collapse`d remainder + toggle (rules 8-11) |
| `components/` | `reservation/extrasLabels.js` | **C** | `COMPLEMENT_TOOLTIP` + `PRICE_TYPE_LABELS`, shared by `OptionRow` and `ExtrasSection` without an import cycle |
| `components/` | `CollapsibleSection.js` | **C** | Generic: title, optional count badge, `defaultExpanded`, `pinned` slot, custom toggle label, children |
| `components/` | `PricedItemsPage.js` | T | New generic `extraColumns` prop (sortable, with an xs-card line) — the page is shared with Ressources, so a hardcoded « Catégorie » column would have leaked there; `renderForm` now also receives `items` |

`api.js` is **not** touched: `createOption` / `updateOption` post the whole form payload, so
`category` rides along.

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PricedItemsPage`, `QuantityField`, `FormDialog`, `PageActionBar` | Pre-existing. |
| **Created (new generic)** | `CollapsibleSection`, `PricedItemsPage.extraColumns` | `CollapsibleSection` is generic by construction: title + count + `defaultExpanded` + `pinned` + children, zero option-specific prop. GuestFlow has exactly one accordion today, inline in [FinancePage.js:191-258](../client/src/pages/FinancePage.js#L191-L258) — the obvious second consumer (migration deferred, §8). `extraColumns` keeps `PricedItemsPage` neutral between Options and Ressources. |
| **Specific (kept feature-local)** | `reservation/OptionRow`, `reservation/OptionCategorySection` | `OptionRow` is bound to the reservation form's option semantics (auto-timed options, bed-linen block, complement toggle, planning-card occurrences) — extracted **verbatim** so the same renderer serves the flat list, the pinned rows and the folded remainder. `OptionCategorySection` is `CollapsibleSection` + the pinned-enabled rule (rule 9), specific to reservation options; it composes the generic rather than replacing it. |

### 4.3 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `blocks/booking/view.js` | T | `renderSupplements()` splits into ungrouped list + one collapsible section per group, with the picked-lines-stay-visible rule (rules 15-17, 20) |
| `assets/style.css` | T | `.gf-group`, `.gf-group-head`, `.gf-group-body`, chevron + `aria-expanded` styling, ≤600px rules |
| `includes/class-gf-blocks.php` | T | New i18n keys: `showOthers`, `collapse`, `categoryAria` (rule 18) |
| `includes/class-gf-rest-proxy.php` | — | (none — same proxied route, richer payload; TTL cache unchanged) |

No plugin version bump: cache-busting is `filemtime`-based
([class-gf-blocks.php:62-66](../integrations/wordpress/guestflow-booking/includes/class-gf-blocks.php#L62-L66)),
and the CI syncs the plugin into `wp_app` on `release`
([deploy.yml:402-431](../.github/workflows/deploy.yml#L402-L431)).

### 4.4 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/options` | — | `[{ …, category, seedKey }]` | Flat, `ORDER BY category, title` |
| POST | `/api/options` | `{ …, category? }` | created option | Optional, trimmed, defaults `''` |
| PUT | `/api/options/:id` | `{ …, category? }` | updated option | Same normalization; omitting the key does not wipe it |
| GET | `/api/properties/:id` | — | `options: [{ …, category }]` + `optionGroups: { ungrouped, groups }` | The flat list is unchanged (pricing engine, SAS); `optionGroups` is the render-ready addition for the fiche |
| GET | `/api/reservations/:id` | — | unchanged | The fiche reads its catalogue from the property payload |
| GET | `/public/v1/properties/:id/options` | — | `{ data: { ungrouped: [PublicOption], groups: [{ category, options: [PublicOption] }] } }` | **Breaking shape change** — `data` was an array. Sole consumer is the WP widget, updated in the same PR (CLAUDE.md §6.1). |

`PublicOption` gains two fields: `category` (string, `''` when ungrouped) and `alwaysVisible` (bool).

---

## 5. Data model

### 5.1 Schema changes

```sql
ALTER TABLE options ADD COLUMN category      TEXT    NOT NULL DEFAULT '';
ALTER TABLE options ADD COLUMN seedKey       TEXT    NOT NULL DEFAULT '';
ALTER TABLE options ADD COLUMN alwaysVisible INTEGER NOT NULL DEFAULT 0;
```

Added idempotently in `migrateOptionsColumns()`
([database.js:528-568](../server/src/database.js#L528-L568)), which already applies this exact
pattern for `autoOptionType`, `countsAsBathMat`, `displayToClient`…

Existing rows default to `''` / `0` → ungrouped, non-seeded, unpinned → today's rendering. **No data loss.**

No index: the catalogue is a few dozen rows and is always read in full.

### 5.2 Structural seed `cateringSeed.js`

Called from `database.js` beside `ensureDefaultBedLinenOption` / `ensureDefaultBreakfastOption`.
For each definition of §5.4, in one transaction:

1. `SELECT id FROM options WHERE seedKey = ?` (**ignoring `archivedAt`** → an archived article is
   never resurrected, rule 25).
2. If absent, try adoption: an option with the same trimmed/lowercased title and an empty `seedKey`
   is `UPDATE`d with the `seedKey` + `category` (rule 24).
3. Otherwise `INSERT` with title / description / price / `priceType = 'per_stay'` /
   `displayToClient = 1` / `category` / `seedKey`.
4. `INSERT OR IGNORE` a `property_options` row for every property (rule 21).

Returns a `{ action, inserted, adopted, linked }` tag for the tests and the boot log, mirroring the
existing seeders.

### 5.3 One-shot migration `option_categories_v1`

Guarded by the `migrations` table ([database.js:940](../server/src/database.js#L940)). One
transaction:

- `UPDATE options SET category = 'Animations'` where `category = ''` and `title LIKE 'Animation%'`
  (nocase) → expected: ids 11-15.
- `UPDATE options SET category = 'Restauration'` where `category = ''` and
  `LOWER(TRIM(title)) = 'le repas des trappeurs'` → expected: id 16.

Logs a one-line summary. The flag is written whatever the counts, so it never runs twice.

### 5.3bis One-shot migration `option_breakfast_restauration_v1`

Files the breakfast option under `Restauration` and sets `alwaysVisible = 1` (rule 9bis), matched on
`autoOptionType = 'breakfast'` — the canonical discriminator, already normalised by the breakfast
seed's promotion path, so a hand-renamed « Petits déjeuners » is caught too. Skips a breakfast option
the operator has already categorised.

A **separate flag** from `option_categories_v1`, which had already run on the dev database by the
time this rule was added. And a one-shot rather than a line in `breakfastSeed.js`: that seed
re-asserts on every boot, which would make the category and the pin impossible to change from the
admin.

### 5.4 Seeded articles

Source: Adrien's price list. **Column 1 → `title`, column 2 → `description`, column 6 → `price`**
(the bold selling price). All rows: `priceType = 'per_stay'`, `displayToClient = 1`, both properties.
Producer names carried from the price-list section headers into the description, so the
single-`Boissons`-category decision loses no information.

**Category `Boissons`** — 9 articles

| `seedKey` | `title` | `description` | `price` |
|---|---|---|---|
| `drink_blonde_pilat_75` | Blonde du Pilat 75cl - 4,5° | Bière blonde bio — Brasserie du Pilat, St Julien Molin Molette | 6,50 € |
| `drink_biscanna_75` | Biscanna 75cl - 5° | Blonde chanvrée bio — Brasserie du Pilat, St Julien Molin Molette | 7,50 € |
| `drink_madmax_75` | Mad Max 75cl - 5,5° | Ambrée bio — Brasserie du Pilat, St Julien Molin Molette | 7,50 € |
| `drink_jus_pomme_1l` | Jus de pomme 1L | 3 pommes - bouteille 1L — Pressoir du Pilat, Maclas | 5,00 € |
| `drink_jus_poire_1l` | Jus de poire William's 1L | Bouteille 1L — Pressoir du Pilat, Maclas | 6,00 € |
| `drink_jus_pomme_kiwi_1l` | Jus pomme-kiwi 1L | Bouteille 1L — Pressoir du Pilat, Maclas | 5,50 € |
| `drink_jus_pomme_25cl` | Jus de pomme 25cl | Petit format (unité) — Pressoir du Pilat, Maclas | 3,00 € |
| `drink_champagne_75` | Champagne - bouteille 75cl | Bouteille standard | 40,00 € |
| `drink_champagne_37` | Champagne - demi-bouteille 37,5cl | Demi-bouteille | 25,00 € |

**Category `Restauration`** — 5 seeded articles + 1 backfilled option

| `seedKey` | `title` | `description` | `price` |
|---|---|---|---|
| `board_s` | Planche S — 1-2 pers. (Apéro Solo/Duo) | Saucisson 80g + caillette + fromage + pain + chutney — Terroir Ardèche (Sandevoir + Rousson + Roche des Vents + saucisson) | 17,00 € |
| `board_m` | Planche M — 2-3 pers. (Apéro Couple) | Saucisson 150g + caillette + châtaignade + fromage + pain + chutney — Terroir Ardèche | 32,00 € |
| `board_l` | Planche L — 4 pers. (Apéro Famille) | Saucisson 250g + pâté Ardéchoise + caillette + châtaignade + 2 fromages + pain + chutney + olives — Terroir Ardèche | 52,00 € |
| `board_xl` | Planche XL — 6-7 pers. (Apéro Tribu) | 2 saucissons + 2 pâtés + caillette + 2 verrines + 3 fromages + pain + condiments — Terroir Ardèche | 78,00 € |
| `board_xxl` | Planche XXL — 10-12 pers. (Apéro Gîte) | 3 saucissons + 2 pâtés + 2 caillettes + 2 verrines + 5 fromages + pain + condiments — Terroir Ardèche | 115,00 € |

Plus **« Le repas des trappeurs »** (existing id 16, `per_person_per_night`, 25 €, planning card
`multiple_per_day` 12:00 / 19:30) — backfilled to `Restauration` by §5.3, **not** seeded: its pricing
and planning-card configuration are operator-owned and must not be re-asserted.

### 5.5 Data impact

- Existing options: two new columns, default `''`. Rendering unchanged for every non-backfilled row.
- Ids 11-15 → `Animations`, id 16 → `Restauration`. Reversible by hand in the admin.
- The breakfast option → `Restauration` + pinned. It keeps showing on every fiche exactly as before
  the categories existed; only its position moves.
- 14 new rows in `options` + 28 in `property_options`. **No reservation is touched, no price is
  recomputed, no existing total moves.**
- Rollback: ignore the columns; the seeded articles can be archived from the admin (rule 25).

## 6. UI / UX

### 6.1 Reservation form — `ExtrasSection`

```
┌─ Options et ressources ─────────────────────────────────────┐
│ Options                                                     │
│   ┌───────────────────────────────────────────────────┐     │
│   │ Linge de lit          15,00 € par séjour   ( )    │     │  ← ungrouped, unchanged
│   ├───────────────────────────────────────────────────┤     │
│   │ Petit déjeuner        12,00 € /pers/nuit   (●)    │     │
│   └───────────────────────────────────────────────────┘     │
│                                                             │
│   ─────────────────────────────────────────────────────     │
│   Animations                                          ⌄     │  ← collapsed, nothing selected
│   Voir les 5 options                                        │
│   ─────────────────────────────────────────────────────     │
│   Boissons                                      ② ⌄         │  ← collapsed, 2 selected
│   ┌───────────────────────────────────────────────────┐     │
│   │ Champagne 75cl        40,00 € par séjour   (●) 1  │     │  ← pinned, always visible
│   │ Jus de pomme 1L        5,00 € par séjour   (●) 3  │     │
│   └───────────────────────────────────────────────────┘     │
│   Voir les 7 autres                                         │
│   ─────────────────────────────────────────────────────     │
│   Restauration                                        ⌄     │  ← collapsed, but…
│   ┌───────────────────────────────────────────────────┐     │
│   │ Petit déjeuner        8,00 € /pers/jour     ( )   │     │  ← alwaysVisible: pinned, unticked
│   └───────────────────────────────────────────────────┘     │
│   Voir les 6 autres                                         │
│ ───────────────────────────────────────────────────────     │
│ Options personnalisées                              [+]     │
│ ───────────────────────────────────────────────────────     │
│ Ressources                                                  │
└─────────────────────────────────────────────────────────────┘
```

**Visual language — « Maison » ([design-system.md](design-system.md) §3.1):**

- The header is **not** a `Card` — it must not compete with the option cards it contains. It is a
  full-width `ButtonBase` row, `borderRadius: 2`, `px: 1.5`, `py: 1`, transparent background turning
  `action.hover` on hover, preceded by a hairline `Divider` (`palette.divider`, the warm
  `rgba(60,54,36,0.1)`) to separate it from the block above.
- Label: `variant="sectionHeader"`, `fontSize: 0.95rem` — the same rendering as the existing
  « Options » / « Ressources » headings, so a category reads as their peer.
- Count: soft `success` `Chip`, `size="small"`, `#E6EFE7` background / `#3E7D54` text (the palette's
  soft-success pair), shown only when > 0.
- Chevron: `ExpandMoreIcon`, `color: text.secondary`, `transform: rotate(180deg)` when open,
  `transition: transform .2s ease` — matching the transitions already used on the option cards
  ([ExtrasSection.js:364](../client/src/components/reservation/ExtrasSection.js#L364)).
- Toggle label: `Typography variant="body2"`, `color: primary.main`, under the pinned cards.
- Pinned and folded cards are the untouched `OptionRow` at the **same left alignment** as ungrouped
  options — no indentation, so the vertical rhythm of the card stack is unbroken. The folded
  remainder animates with MUI `<Collapse>`.
- Spacing: `Stack spacing={1.25}` inside a section, `spacing={2}` between sections — the values
  already in use in `ExtrasSection`.

**Copy (French):** « Voir les {n} autres » / « Voir les {n} options » / « Réduire ».
Header `aria-label`: « Catégorie {label}, {n} option(s) sélectionnée(s) ». The toggle carries
`aria-expanded` and `aria-controls`.

**Responsive:**
- `xs` (≤600px): header row is `flex` with the label truncating (`noWrap` + `textOverflow: ellipsis`),
  chip and chevron pinned right, whole row is the touch target (`minHeight: 44`). Card content
  already stacks vertically ([ExtrasSection.js:368](../client/src/components/reservation/ExtrasSection.js#L368))
  — unchanged.
- `md` (~900px) / `lg` (≥1200px): header on one line, chip + chevron right, no change to the cards.
- No horizontal scroll at any breakpoint.

**`PageActionBar`:** unchanged — `ReservationPage` already owns the page-level bar; this spec adds no
page-level action.

### 6.2 Admin catalogue — `OptionsPage`

- New form field « Catégorie »: free-solo `Autocomplete` seeded with the distinct categories already
  in the catalogue. Helper text: « Regroupe l'option dans un menu dépliant sur la fiche réservation
  et le site (laisser vide pour aucun regroupement). »
- Placed under the title / English-title block, before the price section.
- Below it, a « Toujours visible » checkbox — shown **only once a category is set**, since an
  ungrouped option is never folded. Caption: « L'option reste affichée même quand le menu est replié
  et qu'elle n'est pas sélectionnée. »
- The catalogue table gains a sortable « Catégorie » column; empty cell renders « — ».
- Seeded rows (`seedKey ≠ ''`) keep the normal delete button — it archives, and the archive sticks
  (rule 25). No special affordance.
- **Responsive:** the field is full-width in the existing form grid; the table keeps its contained
  horizontal scroll on `xs`.

### 6.3 Public WordPress widget

```
Options & suppléments
  Petit déjeuner            12,00 € · par pers. et par nuit    − 0 +
  Lit bébé                   0,00 € · par séjour               − 0 +
  ─────────────────────────────────────────────────────────────────
  Animations                                                     ⌄
  Voir les 5 options
  ─────────────────────────────────────────────────────────────────
  Restauration                                                    ⌄
  Petit déjeuner            8,00 € · par pers. et par nuit    − 0 +
  Voir les 6 autres
  ─────────────────────────────────────────────────────────────────
  Boissons                                                   ② ⌄
  Champagne - bouteille 75cl  40,00 € · par séjour            − 1 +
  Voir les 8 autres
```

- Group header: `<button class="gf-group-head" aria-expanded="false">` — label, optional selected
  count, CSS chevron. Body `.gf-group-body` toggled by a class (not inline `display`), `max-height`
  transition.
- Picked lines are moved out of the folded body and rendered above it (rule 16), same markup as any
  `.gf-line`.
- Styling stays inside the plugin's existing token set (`--gf-accent`, `--gf-border`, `--gf-muted`,
  [style.css:3](../integrations/wordpress/guestflow-booking/assets/style.css#L3)) — the widget follows
  the WordPress theme, not the GuestFlow admin palette.
- Native `<button>` → keyboard accessible, focus ring inherited.
- **Responsive ≤600px:** header is a single ≥44px row; body lines keep the existing stacked
  title/price/stepper layout ([style.css:79-90](../integrations/wordpress/guestflow-booking/assets/style.css#L79-L90)).

## 7. Test plan

### Server unit tests (`cd server && npm test`) — **2299 pass / 0 fail** (55 added)
- [x] `tests/option-grouping.unit.test.js` — `normalizeCategory` (trim, whitespace-only → `''`, case
      preserved); `groupOptionsByCategory` puts ungrouped first, groups in French collation order
      (« Animations » < « Boissons » < « Restauration »), options by title inside a group, selection
      split out into `pinned` / `foldable` (rule 9), empty input → `{ ungrouped: [], groups: [] }`;
      an `alwaysVisible` option is pinned with **zero** selection yet does not inflate
      `enabledCount` (rule 9bis); `isPinnedOption` covers both channels.
- [x] `tests/option-category-crud.unit.test.js` — create/update round-trips `category` and
      `alwaysVisible`; whitespace-only category stored as `''`; omitting either key on update does
      not wipe it.
- [x] `tests/public-options-grouped.unit.test.js` — the public payload has the `{ ungrouped, groups }`
      shape; `displayToClient = 0` options excluded **before** grouping; an all-hidden category
      produces no group (rule 14); price-ascending order preserved inside a group.
- [x] `tests/catering-seed.unit.test.js` — inserts all 14 articles with the right
      title/description/price/priceType/category/seedKey; a second run inserts nothing; a **renamed**
      article is not duplicated (rule 23); a **same-titled pre-existing** option is adopted, not
      duplicated (rule 24); an **archived** article is not resurrected (rule 25); every article is
      linked to every property, including one created after the first seed run.
- [x] `tests/option-categories-migration.unit.test.js` — the backfill assigns `Animations` to the 5
      `Animation…` titles and `Restauration` to « Le repas des trappeurs »; options already carrying
      a category are skipped; the flag prevents a second run. Plus §5.3bis: the breakfast option
      moves to `Restauration` + pinned, matched on `autoOptionType` (so a renamed one is caught),
      nothing else is touched, and an already-categorised one is left alone.

### Client tests (`cd client && npx vitest run`) — **772 pass / 0 fail** (30 added)
- [x] `CollapsibleSection` — collapsed by default, toggles on click, `defaultExpanded` honored, count
      badge hidden at 0, `aria-expanded` correct.
- [x] `OptionCategorySection` — pinned options render outside the `Collapse` (rules 9 + 9bis); toggle
      label reads « Voir les 7 autres »; the toggle disappears when every option is pinned; a section
      with nothing pinned renders no card. An `alwaysVisible` option renders while collapsed without
      lighting the chip, and ticking it lights the chip without moving the card.
- [x] `ExtrasSection` — ungrouped options render outside any section; an all-hidden category renders
      nothing; existing option-toggle/quantity tests still pass through `OptionRow`.
- [x] `OptionsPage` — the category field round-trips into the create/update payload; the
      « Toujours visible » checkbox appears only once a category is set and round-trips too.
- [x] Mocked API fixtures updated for the new payload shape.

### E2E — real rendering in the GuestFlow app (`npm run test:e2e`) — **45 pass / 0 fail** (6 added)

Unit and Vitest tests do not prove the reservation page *renders* correctly end-to-end (real API,
real payload shape, real MUI layout). A dedicated Playwright spec is mandatory here because the
collapse behavior is the whole point of the feature and it depends on the server payload.

- [x] `e2e/specs/reservations/option-categories.spec.js` — on a real reservation:
  - the three category headers (« Animations », « Boissons », « Restauration ») render **after** the
    ungrouped options and **before** « Options personnalisées »;
  - every section is collapsed on load — the folded options are not visible;
  - clicking a header reveals the remainder and flips `aria-expanded`;
  - enabling 2 drinks then **saving and reloading the page** shows those 2 cards pinned and visible
    with the section still collapsed, the chip reading « 2 », and the other 7 hidden (rule 9 — the
    single most important behavior to protect from regression);
  - the reservation total reflects the 2 drinks × their quantity;
  - a category with nothing enabled and nothing pinned shows no card at all;
  - « Petit déjeuner » renders under a **collapsed** « Restauration », switch off, no count chip
    (rule 9bis).
- [x] `e2e/specs/reservations/option-categories.spec.js` (mobile project, 390×844) — the header row is
    tappable at ≥44px, the label truncates instead of wrapping, and the page has no horizontal scroll.
- [x] Full Playwright suite green (mandatory after any client UI change).

### Manual UI verification
- [x] Happy path: open a reservation → « Animations », « Boissons », « Restauration » collapsed at the
      bottom of Options; expand « Boissons », enable 2 drinks with quantities, save, reopen → the two
      cards are pinned and visible, the other 7 folded, chip reads « ② », total correct.
- [x] Edge case: archive a drink in the admin → it disappears from the form; restart the server → it
      does **not** come back.
- [x] Edge case: rename a drink → restart → no duplicate appears.
- [x] Edge case: clear the category on an animation → it moves back into the flat list.
- [x] « Petit déjeuner » is visible under a collapsed « Restauration » without being ticked, and
      « Voir les 6 autres » covers the 5 planches + Le repas des trappeurs.
- [x] Mobile (≤600px): sections expand/collapse with a ≥44px touch target, label truncates, no
      horizontal scroll.
- [x] Regression: `Options personnalisées`, `Ressources`, the pricing side panel totals, the devis PDF
      option lines, and the SAS upsell flow
      ([sas-upsells-activate-catalogue-option.md](sas-upsells-activate-catalogue-option.md)) unaffected.
- [x] WordPress widget (local `wp_app`): groups collapsed after the flat list, a picked line stays
      visible when collapsing, the flat live summary and total are correct.

## 8. Out of scope

- **No category on resources** — resources keep their current flat placement (rule 17).
- **No grouping in the devis PDF** ([devisPdf.js:411-437](../server/src/utils/devisPdf.js#L411-L437))
  nor in the pricing side panel — both stay flat lists, deliberately: a quote and a total read
  linearly.
- **No sub-categories.** The price list's « Bières / Jus de fruits / Champagne » split is folded into
  a single `Boissons` category; the producer is carried in each description (§5.4).
- **No categories management screen** (no CRUD, no reorder, no color, no icon). Rule 5 keeps
  categories as labels; a real entity is a later spec if the need appears.
- **No per-category expand/collapse preference** persisted per user or per property (rule 12).
- **No ordering control over the pinned block** — pinned options keep the category's title order, so
  ticking one never makes a card jump position.
- **No migration of `FinancePage`'s inline accordion onto `CollapsibleSection`** — flagged as the
  obvious second consumer, but it belongs to the Finance sweep.
- **No stock / inventory tracking** for drinks and boards (no quantity on hand, no consumption
  report, no purchase-cost or margin tracking — columns 3-5 and 7 of the price list are ignored).
  They are billing lines only.
- **No English titles** for the seeded articles (`titleEn` left empty) — the EN devis flow falls back
  to the French title, as it already does for the animations.

## 9. Open questions

- **Q1 — the descriptions of Planche L, XL and XXL were truncated in the source image** (§5.4).
  - A: **Resolved 2026-08-06 — full text supplied (second screenshot), §5.4 completed. No open
    question remains; the spec is implementable as written.**
- **Q2 — category name for the boards + « Le repas des trappeurs ».**
  - A: **Resolved 2026-08-06 (AskUserQuestion) — `Restauration`.**
- **Q3 — keep the three drinks sub-families as separate categories?**
  - A: **Resolved 2026-08-06 (AskUserQuestion) — no: a single `Boissons` category, producer moved
    into the description.**
- **Q4 — do the drinks apply to every property?**
  - A: **Resolved 2026-08-06 — yes, both accommodations.**
- **Q6 — should « Petit déjeuner » move into a category?**
  - A: **Resolved 2026-08-06 — yes, into `Restauration`, but pinned (`alwaysVisible`) so it stays
    visible on the fiche and on the site even unselected. Implemented as a generic per-option flag
    rather than a breakfast special case, so any other option can be pinned from the admin.**
- **Q5 — one-shot or re-asserting seed?**
  - A: **Resolved 2026-08-06 — structural re-asserting seed, same semantics as linen / breakfast
    (rules 22-25), with a `seedKey` identity so operator edits survive.**
