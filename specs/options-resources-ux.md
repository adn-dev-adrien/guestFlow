# Options & ressources — a catalogue read by category, edited in a side panel

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-10-28)_ |
| **Branch** | `feature/options-resources-ux` _(user-managed)_ |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary & mockup** | [docs/specs/2026-10-28-options-resources-ux.html](../docs/specs/2026-10-28-options-resources-ux.html) — two directions (A · Catalogue, B · Grille par logement), desktop + phone, real / worst-case / empty data. **Decision 2026-10-28: direction A.** |
| **Amends (UI sections only)** | `option-categories.md` §6.2 · `per-property-option-prices.md` §6 · `per-property-default-options.md` §6 · `option-soft-delete.md` §6 · `resources.md` §6 · `resource-hourly-scheduling.md` §6 · `plugins-phase-3c-hourly-resources.md` §6 |

---

## 1. Context

Feedback of 2026-10-28 on the `inte/plugins` shadow: « Retravaille moi cette page Option & ressource
en terme de UX, car là c'est trop à plat. »

Audit on the shadow copy of 2026-10-22 (28 catalogue options, 2 resources, 2 properties), screenshots
at 1440 px and 390 px, plus the code:

1. **One flat table.** `OptionsPage.jsx` renders through the generic `PricedItemsPage.jsx` /
   `DataPageScaffold`: 7 columns (Nom, Description, Catégorie, Logements, Prix, Type de prix,
   Actions), one row per option, sortable headers. The categories that the fiche and the public
   widget fold into menus (`option-categories.md` rules 1-4: 6 ungrouped, Animations 6, Boissons 9,
   Restauration 7) are just a column here (`OptionsPage.jsx` `extraColumns`). Nothing folds, nothing
   is searchable. On a phone the 28 cards make a 4 000 px page.
2. **Noise over signal.** « Tous les logements » appears on 28 rows out of 28; the description column
   takes ~35 % of the width and wraps up to 4 lines; the price and its unit live in two columns
   (« 25,00 € » … « Par personne / jour »).
3. **The base price is shown even when nothing uses it.** `renderPriceCell` (`OptionsPage.jsx`
   ~l. 520) prints « 8,00 € (base) » for the breakfast, then « Granja : 10,00 € · Estiva : 10,00 € » in
   a caption: both properties override it, the 8 € applies nowhere.
4. **What makes an option special is invisible in the list:** offered/included by default per property
   (`per-property-default-options.md` — bed linen offered everywhere, cleaning offered at Estiva,
   bath mat at Granja), internal options (`displayToClient = 0`, the bath mat), planning cards
   (breakfast 09:00, the trappers' meal 12:00 · 19:30), the cancellation insurance at 0 that is
   therefore not offered (`optionsModel.js` ~l. 351).
5. **The editor is one long column.** `FormDialog` with the bespoke `renderForm`: 918 px of content for
   « Ménage » at 1440 px, 1 187 px on a phone; the « Bain nordique » resource form is 1 803 px
   (2 257 px on a phone). One property's settings are split across three blocks
   (`PropertiesMultiSelect` → `OptionPriceSection` with its « Prix différent selon le logement »
   switch → `OptionDefaultsSection`).
6. **Destructive action on every row.** A red trash icon on 22 rows; greyed without explanation on
   the 6 system options (`isDeleteDisabled`). A pencil icon duplicates the row click.
7. **Resources hide their own prices.** The resources table shows « 30,00 € · Par heure » for the
   nordic bath; its evening rate (50 €/h after 20:00), its external rates (50 / 70 €/h) and its free
   first hour are only visible inside the form. The quantity column does not say whether it is a
   stock (3 baby beds) or units in service (1 bath).
8. **The client shapes the data** — against CLAUDE.md §6.0: `PricedItemsPage` sorts
   (`sortedItems`), derives the properties label (`propertiesLabel`), `OptionsPage` formats the
   per-property price block and normalises/filters the payload (`fromItem`/`toPayload`: dropping
   overrides and bath-mat quantities of properties outside the scope).
9. **Two silent server gaps found on the way:** `optionsModel.persistPropertyPrices`
   (`optionsModel.js:266`) silently skips a negative or non-numeric per-property price instead of
   refusing it; the server accepts an option with an empty title (only the client blocks it).

The SAS plugin's « Facturables au SAS » tab is already sectioned and is not part of this work.

## 2. Goal

The operator finds any option or resource in two seconds, sees at a glance what each one costs per
property and what is special about it (offered, internal, on the planning), and edits it in a panel
organised by topic — on a laptop and on a phone. No pricing or catalogue rule changes.

## 3. Functional rules

### 3.A Page and catalogue payload (server-shaped)

1. The page keeps its route `/parametres/options-ressources`, its `?tab=` parameter and the
   `optionsResources.tabs` plugin slot. The `PageActionBar` title is « Options & ressources » on every
   tab; the tabs sit centred in the bar (second row on `xs`, as today); the bar holds one action,
   « Nouvelle option » / « Nouvelle ressource » (`AddIcon`, primary) depending on the tab. The
   standalone routes `/options` and `/resources` redirect to the matching tab.
2. `GET /api/options/catalogue-view` returns the catalogue **grouped and in the fiche's reading
   order**: ungrouped options first under the label « Sans catégorie », then the categories in French
   collation, options in each group in the order `optionsModel.list()` already uses (insurance pinned
   per `cancellation-insurance.md` rule 17bis). The early-arrival / late-departure options stay out
   (`settings-rationalization.md` rule 15). Archived options are not in `groups`.
3. Each item carries a **price summary** computed from the effective price of each applicable
   property (override when present, else the base price): one value when every applicable property
   shares it; « min – max » plus the note « selon logement » when they differ; « Gratuit » for `free`; the tier
   range plus « / participant, dégressif » for `per_participant_progressive`; a percentage plus « du
   séjour » for `percent_of_stay`. The unit labels are « / séjour », « / pers. », « / jour »,
   « / pers. / jour ». The base price is never displayed when no applicable property uses it; an option proposed nowhere shows « — ».
4. With `?propertyId=<id>`, only the options applicable to that property are returned, and the price
   summary is that property's effective price. An unknown property id answers 404.
5. Each item carries its **traits**, in this order, each with a tone: scope when the option is not
   offered everywhere (« Granja seulement », « Granja et Estiva seulement », past two names « 3 logements seulement »; « Aucun
   logement » in warning when the scope is empty); « Offert · <logements> » (success) and « Inclus ·
   <logements> » (info) from the per-property defaults; « Interne » when `displayToClient = 0`;
   « Planning 12:00 · 19:30 » when the option shows a planning card (« Planning 3× par jour » past two
   slots); « Non proposée · tarif à 0 » (warning) for the cancellation insurance when the server would
   not offer it. « tous les logements » replaces the list of names when every property is concerned (past two names: « N logements »). The breakfast option carries its planning card at its default time (« Planning 09:00 »).
   No trait is emitted for what is true of every ordinary option.
6. Each item carries `archivable` and, when false, `archiveBlockedReason` (« Option système » for an
   option with an `autoOptionType` or the cancellation insurance) — the same guard as
   `option-soft-delete.md` rule 2, computed by the same function.
7. The payload carries `chips: [{ key, label, count }]` over the whole catalogue (not the current
   filter) and `total`, so the category filter shows stable counts. A group `key` is `none` for the ungrouped options and `cat:<label>` otherwise.

### 3.B List (direction A — Catalogue)

8. The list renders one section per group: a serif header with the label and the count, foldable; the
   folded state is remembered per browser (local UI convenience, never needed for correctness). A
   text search unfolds every section while it is active.
9. A row shows: the name (wraps, never truncated); the description on one line, ellipsed, full text in
   the panel; the traits of rule 5; the price summary right-aligned in tabular figures with its unit
   under it; a « ⋯ » menu (`RowActionsMenu`). The whole row opens the editor (click, Enter, Space).
   No pencil and no trash icon on the row.
10. The « ⋯ » menu holds « Modifier » and « Archiver ». « Archiver » asks for confirmation
    (« Archiver « <nom> » ? » / « Retirée des nouvelles réservations. Les réservations existantes la
    gardent. ») and calls the existing `DELETE /api/options/:id` (soft-delete, unchanged). When
    `archivable` is false the item is disabled and the reason is written under it.
11. Above the list: a search field (matches title, description and category, case- and
    accent-insensitive), a property filter (« Tous » + one segment per property while they fit, a
    select past four — `SegmentedSelect`) that refetches with `?propertyId=`, and category chips
    (« Toutes » + one per group with its count) that show a single group. A search or filter with no
    match shows « Aucun résultat » and « Effacer les filtres ».

### 3.C Editor panel (options)

12. Creating or editing an option opens a **side panel**: 560 px from the right on `sm`+ with the list
    visible behind a light scrim; a full-height sheet on `xs`. It closes on the close button, Escape,
    the scrim, or after a successful save. A new option opened while a category chip is active is
    pre-filled with that category.
13. The panel is divided into sections, in this order: **Général** (Nom, Description, Catégorie with
    the existing labels as one-tap suggestions, « Toujours visible » once a category is set),
    **Logements et prix**, **Planning** (manual options only, as today), **Visibilité** (« Visible du
    client »), then the type-specific sections only for the options that carry them today
    (Petit-déjeuner, Linge, Tapis de bain, the insurance note). A row of section chips at the top
    scrolls to each section; a section holding an error shows its chip in the error colour.
14. **Logements et prix** is one table with one line per property: « Proposée » (switch — the option's
    scope, `option-property-scope.md` rules unchanged), « Prix » (the per-property override: blank =
    base price, shown as placeholder; 0 = free; hidden for `free`), « Inclus » and « Offert »
    (`per-property-default-options.md` rules unchanged, Offert gated on Inclus, hidden for
    auto-timed options). Turning « Proposée » off greys the line and clears its default. The
    « Prix différent selon le logement » switch disappears: a line with a price is an override. Above
    the table: « Type de prix » and « Prix de base » (or « Pourcentage de base »); when every proposed
    property has its own price, the help line reads « Chaque logement a son propre prix : le prix de
    base ne s'applique nulle part. ». For `per_participant_progressive` the tier editor replaces the
    price column (tiers stay global, as today).
15. The server owns the payload clean-up that the client does today: overrides, defaults and bath-mat
    quantities of properties outside the option's scope are dropped on save. The client sends the
    form as edited.
16. Authoritative validation on create and update (422 `VALIDATION_FAILED` with `details[]`, French
    message per field): title required (trimmed); base price and every per-property price are numbers
    ≥ 0 with at most 2 decimals; a percentage is ≤ 100. A negative or non-numeric per-property price is
    **refused**, no longer skipped silently. The panel mirrors these checks inline (« Nom requis »,
    « Positif ou nul », « 2 décimales max », « 100 % max », « Nombre attendu »), and shows any 422
    detail on its field.
17. The footer holds « Annuler » and « Enregistrer ». « Enregistrer » is disabled while nothing changed
    or while a field is invalid; the footer then states « N champ(s) à corriger ». A successful save
    closes the panel, shows the toast « Option enregistrée » (« Option ajoutée » for a new one),
    reloads the catalogue view and briefly highlights the row. Closing with unsaved changes opens
    `UnsavedChangesDialog`.

### 3.D Resources

18. `GET /api/resources/catalogue-view` returns each resource ready to render: name, description,
    `stock: { value, label }` (« en stock », or « en service » for a resource sold by the hour), and
    `lines: [{ label, value }]` — « Prix » (« Gratuit » or « 30 € / h »), « Logements » (« Tous » for the
    legacy empty scope, `resources.md`), the per-property overrides when any. Resources sold by the hour
    stay hidden while the hourly plugin is off (`plugins-phase-3c-hourly-resources.md` rules 18, 20).
19. A plugin adds lines and a footer to a resource through a new inert SDK brick,
    `ctx.resourceCatalogueLines(build)` (SDK 2.8.0; `build(resource, { properties }) → { lines?: [...], footer?: string } | null`, synchronous, one builder per plugin, called only while the plugin is live).
    The hourly plugin contributes « Soir » (« 50 € / h après 20:00 »), « Extérieurs » (« 50 € / h · soir
    70 € / h »), « Offert » (« 1re heure · <logements> ») and the footer « À l’heure · 11:00–22:00 · 1 h
    minimum · remise en état 15 min · carte au planning ». No contributor, no line.
20. The resources render as cards (one column on `xs`), the stock in large tabular figures top right.
    A card opens the same side panel with the sections Général (Nom, Description, quantity labelled
    « En stock » / « En service »), Prix (type, base price, one line per property with its price and,
    for an hourly resource, « 1re heure offerte »), then the `resources.fields` plugin slot as its own
    section « Horaires », then Mails (« Phrase une fois réservée »). Deleting stays in the card's « ⋯ »
    menu with the existing impact confirmation (`resources.md`); the baby bed stays non-deletable.
21. Resource validation mirrors rule 16: name required, quantity a whole number ≥ 0, prices ≥ 0 with
    2 decimals max, closing time after opening time (hourly block). The server refuses with 422.

### 3.E States

22. Loading shows `LoadingState` (skeleton rows); a failed load shows `ErrorAlert` with « Réessayer »;
    an empty catalogue shows `EmptyState` « Aucune option » — « Petit-déjeuner, ménage, boissons… » —
    with « Ajouter une option » (resources: « Aucune ressource » — « Lit bébé, bain nordique, vélos… »).

### 3.F Direction B — Grille par logement (Withdrawn 2026-10-28)

> Direction A was chosen; the numbers stay reserved so that nothing renumbers.

23. _Withdrawn 2026-10-28._ (Per-property grid with sticky column and header.)
    > **Sans test** — withdrawn, direction B was not chosen.
24. _Withdrawn 2026-10-28._ (In-cell price edit through `PUT /api/options/:id/property-prices/:propertyId`; the endpoint is not built.)
    > **Sans test** — withdrawn, direction B was not chosen.
25. _Withdrawn 2026-10-28._ (Grid on `xs` falling back to the filtered list.)
    > **Sans test** — withdrawn, direction B was not chosen.

### 3.G Archived options (added 2026-10-28, arbitration 3)

26. The catalogue view carries `archived: [{ id, title, category, archivedAt }]`, the archived options
    most recently archived first. The list ends with a folded « Archivées » section (count in the
    header, folded by default) whose rows show the name, the category and « Restaurer »; the text search
    also filters it.
27. `POST /api/options/:id/restore` clears `archivedAt` (200 `{ ok: true }`), emits `pricingChanged`,
    and does **not** bring back the per-property defaults the archive dropped
    (`option-soft-delete.md` rule 5) — the operator sets them again. 404 for an unknown option, 409
    `OPTION_NOT_ARCHIVED` for an active one. A restore toasts « Option restaurée » and reloads the view.

**Edge cases:**
- 12 properties: traits read « 8 logements seulement », the property filter is a select.
- A 110-character option name, a 90-character category → the name wraps, the chip label is ellipsed
  with its full text as title; the section header wraps.
- An option proposed nowhere → trait « Aucun logement » (warning), still listed under « Tous ».
- All properties override the base price → the list shows the overrides only (rule 3), the panel says
  the base applies nowhere (rule 14).
- Zero options, zero resources → rule 22. A filter with no match → rule 11.
- 1 284 units of a resource → « 1 284 » in the stock, tabular.
- Hourly plugin turned off with a per-hour resource → hidden (rule 18), no plugin line, no « Horaires »
  section.

---

## 4. Architecture

> **Fat backend, thin frontend.** Grouping, ordering, price summaries, traits, archivability, the
> per-property filter and the payload clean-up move to the server. The client keeps two local UI
> filters over the already-shaped payload — the text search and the category chip — because they
> only hide rows of a ready list (no rule, no money), and a request per keystroke would add latency for
> nothing; the folded sections are a per-browser convenience.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `options.js` | T | `GET /catalogue-view` (before `/:id`), `POST /:id/restore`. |
| `routes/` | `resources.js` | T | `GET /catalogue-view` (before `/:id`). |
| `controllers/` | `optionsController.js` | T | `catalogueView` (property filter, 404, archived list), `restore`; `validateOptionPayload` (in `utils/optionValidation.js`) replaces the scattered checks (title, prices, overrides, percent) and answers 422 `details[]` (rule 16). |
| `controllers/` | `resourcesController.js` | T | `catalogueView`; 422 validation of rule 21. |
| `models/` | `optionsModel.js` | T | `persistPropertyPrices` no longer skips invalid values silently (validated upstream); scope clean-up of overrides / defaults / bath mats on save (rule 15); `listArchived()`, `restore(id)`; `scopePayload` (`utils/optionPayloadScope.js`). |
| `models/` | `resourcesModel.js` | — | Read as today. |
| `utils/` | `optionCatalogueView.js` | C | Pure: `(options, properties, { propertyId, insuranceDynamic }) → { groups, chips, total }` — price summary (rule 3), traits (rule 5), archivability (rule 6); `buildArchivedItems` (rule 26). |
| `utils/` | `catalogueFormat.js`, `optionValidation.js`, `optionPayloadScope.js`, `resourceCatalogueContributors.js` | C | French amounts / durations / property phrases; rule-16 validation; rule-15 payload clean-up; the live plugins' resource-card builders. |
| `utils/` | `resourceCatalogueView.js` | C | Pure: `(resources, properties, contributors) → items` (rules 18-19). |
| `utils/` | `optionArchiveGuard.js` | C | One function shared by `optionsModel.remove` and the view: `archiveBlockedReason(option)`. |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `version.js` | T | Inert brick `resourceCatalogueLines(build)` (SDK 2.8.0); the record holds the builder, `resourceCatalogueContributors()` lists the live ones. |
| `plugins/hourly-resources/` | `index.js`, `catalogueLines.js` (C), `manifest.json` | T/C | Contributes the hourly lines and footer of rule 19 (plugin 1.3.0, SDK ^2.8.0). Its own small formatters: a plugin never imports the core outside the SDK. |
| `middleware/` | — | — | (none — existing auth/admin guard) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `OptionsResourcesPage.jsx` | T | Tabs handed to the active child, which renders the bar (title « Options & ressources » and the « Nouvelle … » action). |
| `pages/` | `OptionsPage.jsx` | T (rewrite) | Toolbar (search, property filter, category chips) + grouped list + « Archivées » from `catalogue-view`; opens `OptionEditorPanel`; archive / restore. |
| `pages/` | `ResourcesPage.jsx` | T (rewrite) | Cards from `resources/catalogue-view`; opens `ResourceEditorPanel`; delete with impact. |
| `pages/options/` | `OptionEditorPanel.jsx`, `OptionPropertyTable.jsx`, `CategoryField.jsx`, `OptionRow.jsx`, `ArchivedRow.jsx`, `optionForm.js` (C) | C | The option form split into the sections of rule 13; the per-property table of rule 14; the row; the form model and its inline checks. |
| `pages/options/` | `OptionSpecialSections.jsx` (C) | C | The former sub-forms (`BreakfastTimeField`, `PlanningCardSection`, linen blocks, bath mats, `ProgressivePricingFields`) moved unchanged. |
| `pages/options/` | `ResourceEditorPanel.jsx`, `resourceForm.js` (C) | C | Resource form in sections; mounts the `resources.fields` slot as « Horaires ». `toResourcePayload` moved to `resourceForm.js`. |
| `components/` | `SidePanel.jsx` | C | Generic (see below). |
| `components/` | `GroupedList.jsx` | C | Generic (see below). |
| `components/` | `SearchField.jsx` | C | Generic (see below). |
| `components/` | `RowActionsMenu.jsx` | T | Items gain `disabled` and `hint` (the reason under a disabled item). |
| `components/` | `PricedItemsPage.jsx` | Removed | No consumer left (only Options and Resources used it). |
| `hooks/` | `useCollapsedGroups.js` | C | Folded sections per browser (`localStorage`, try/catch). |
| `services/` / `api.js` | `api.js` | T | `getOptionsCatalogueView(propertyId?)`, `getOption(id)`, `restoreOption(id)`, `getResourcesCatalogueView()`, `getResource(id)`; `getCatalogueOptions` removed (the editor's suggestions are the chips). |
| `constants/` | `optionsResourcesTexts.js` | C | French strings of rules 10, 11, 16, 17, 22, 26, 27. |
| `App.jsx` | `App.jsx` | T | `/options` and `/resources` redirect (rule 1). |
| `plugins/hourly-resources/` | `HourlyResourceFields.jsx` | — | Unchanged: its paired fields already sit side by side from `sm`, which fits the panel. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `PageTabs`, `RowActionsMenu`, `SegmentedSelect`, `StatusBadge` (traits), `EmptyState`, `LoadingState`, `ErrorAlert`, `UnsavedChangesDialog`, `useToast`, `ConfirmDialog` (archive), `PropertiesMultiSelect` (resources scope, legacy « empty = all »), `TokenTextField` | Pre-existing. |
| **Created (new generic)** | `SidePanel` — list-detail editor: right drawer `sm`+, full-height sheet `xs`, header + close, optional section-chip nav with error state, sticky footer, dirty guard via `UnsavedChangesDialog`, focus trap, `prefers-reduced-motion`. Every list page that edits a row (clients, logements, plateformes) can host its editor in it. `GroupedList` — foldable sections with header label/count and a row slot, fed by a server-grouped payload. `SearchField` — 16 px search input with clear button and accessible label (no zoom on iOS). | Each gets a JSDoc header. `SearchField` / `SidePanel` may also be wanted by the Clients page rework of the same feedback batch — the first spec merged creates them, the other consumes. |
| **Specific (kept feature-local)** | `OptionEditorPanel`, `OptionPropertyTable`, `ResourceEditorPanel` | Bound to the option / resource field set. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/options/catalogue-view` | `?propertyId=` optional | `{ total, chips: [{ key, label, count }], groups: [{ key, label, count, items: [Item] }], archived: [{ id, title, category, archivedAt }] }` | Admin. 404 on unknown `propertyId`. |
| PUT | `/api/options/:id` | unchanged shape | unchanged | 422 `{ error: 'VALIDATION_FAILED', details: [{ field, message }] }` per rule 16 (`field` = `title`, `price`, `propertyPrices.<id>`, …). Existing `NEGATIVE_OPTION_PRICE` 400 kept for the base price. |
| POST | `/api/options` | unchanged | unchanged | Same validation. |
| POST | `/api/options/:id/restore` | — | `{ ok: true }` | Rule 27. 404 unknown, 409 `OPTION_NOT_ARCHIVED`. Emits `pricingChanged`. |
| GET | `/api/resources/catalogue-view` | — | `{ items: [ResourceItem] }` | Admin. |

```jsonc
// Item
{ "id": 6, "title": "Petit déjeuner", "description": "Pain frais et croissant, …", "category": "",
  "price": { "value": "10 €", "unit": "/ pers. / jour", "note": "" },
  "traits": [{ "key": "planning", "label": "Planning 09:00", "tone": "info" }],
  "archivable": false, "archiveBlockedReason": "Option système" }
// ResourceItem
{ "id": 2, "name": "Bain nordique", "description": "", "deletable": true, "stock": { "value": 1, "label": "en service" },
  "lines": [{ "label": "Prix", "value": "30 € / h" }, { "label": "Soir", "value": "50 € / h après 20:00" }],
  "footer": "À l’heure · 11:00–22:00 · 1 h minimum · remise en état 15 min · carte au planning" }
```

`price.note` is « selon logement » when the properties differ, else empty. `description` is the whole text; the row ellipses it on one line.

---

## 5. Data model

No schema change, no migration. The existing rows that the new validation would refuse (a negative
per-property price) cannot exist — the model already skipped them on write — so no backfill.

## 6. UI / UX

Interactive mockup: [docs/specs/2026-10-28-options-resources-ux.html](../docs/specs/2026-10-28-options-resources-ux.html).

- **PageActionBar:** title « Options & ressources »; tabs Options · Ressources · plugin tabs centred
  (`xs`: second row); one action `AddIcon` « Nouvelle option » / « Nouvelle ressource » (primary). No
  Save/Cancel on the page: saving happens in the panel.
- **Toolbar** (options tab): search field full width; property filter right of it on `md`+, full width
  under it on `xs`; category chips on a horizontally scrolling row (no visible scrollbar), « Toutes »
  first.
- **Sections:** serif `sectionHeader`, count pill, chevron; rows inside one white card per section
  (radius 14, Maison shadow), hairline dividers, 12 px vertical padding, ≥ 44 px row height.
- **Row typography:** name 600 / 0.95 rem; description `text.secondary` 0.84 rem one line; traits
  soft chips (`softChipSx`, the `StatusBadge` treatment) 0.72 rem; price 700 / 1 rem tabular, unit 0.76 rem `text.secondary`.
- **Panel:** header with the option's name (serif) and a 44 px close button; section chips; body
  scrolls on its own (`overscroll-behavior: contain`); footer sticky with the state text left
  (« Modifié », « 2 champs à corriger » in error colour), « Annuler » text button, « Enregistrer »
  filled primary. Enter/exit: slide from the right (`xs`: from the bottom) along the same path, 340 ms
  `cubic-bezier(.32,.72,0,1)`; `prefers-reduced-motion` → opacity only.
- **Copy** (impersonal, short): « Rechercher une option », « Toutes », « Sans catégorie », « Aucun
  résultat », « Effacer les filtres », « Proposée », « Prix », « Inclus », « Offert », « Prix de base »,
  « Repris par les logements dont la case prix est vide. », « « Inclus » : ajoutée d'office aux nouvelles
  réservations. « Offert » : incluse à 0 €. », « Visible du client » / « Interne : absente de la fiche,
  des mails, du devis et du site », « Option système : elle reste au catalogue. ».
- **Responsive:**
  - `xs` (≤ 600 px): rows put the price top right and « ⋯ » under it; the panel is a full-height sheet;
    the per-property table stacks one block per property (« Proposée », « Prix », « Inclus par défaut »,
    « Offert » as label/control lines); inputs 16 px with `inputMode="decimal"`; footer padded with
    `env(safe-area-inset-bottom)`; resource cards one column. No horizontal page scroll.
  - `md` (~900 px): list full width; panel 560 px over the list.
  - `lg` (≥ 1200 px): list max-width 1240; panel 560 px, the list stays readable on its left.
- **Archived** (rules 26-27): a muted « Archivées » section at the bottom, folded by default; each row
  names the option and its category, with « Restaurer » (44 px).
- **Panel dirty guard:** the browser back, a reload and the sidebar are guarded while the panel has
  unsaved changes (`useDirtyFormGuard`), as the close button is.

## 7. Test plan

Rule citations use `specs/options-resources-ux.md rule N` so `check-spec-coverage.mjs` sees them.

### Server unit tests (`cd server && npm test`)

- [x] `tests/options-catalogue-view.unit.test.js` — rules 2-7, 26 (19 cases).
- [x] `tests/options-validation.unit.test.js` — rules 2, 4, 15, 16, 26, 27 (17 cases, with the controller
      and the model on a temporary database).
- [x] `tests/resources-catalogue-view.unit.test.js` — rules 18, 19, 21 (14 cases).
- [x] `plugins/hourly-resources/tests/catalogue-lines.unit.test.js` — rule 19 (5 cases).
- [x] Existing suites updated where the rule changed: `options-model` (a default outside an explicit
      scope is dropped, rule 15), `resources-controller` (422 instead of 400, rule 21); the rest green.
- ~~`options-property-price-put`~~ — withdrawn with direction B.

### Client (`cd client && npx vitest run`)

- [x] `pages/__tests__/OptionsPage.catalogue.test.jsx` — rules 8-12, 17, 22, 26, 27 (21 cases).
- [x] `pages/options/__tests__/OptionEditorPanel.sections.test.jsx` — rules 12, 13, 17 (10 cases).
- [x] `pages/options/__tests__/OptionEditorPanel.property-table.test.jsx` — rule 14 (10 cases).
- [x] `pages/options/__tests__/OptionEditorPanel.validation.test.jsx` — rule 16 (10 cases).
- [x] `pages/options/__tests__/OptionEditorPanel.specials.test.jsx` — every type-specific setting still
      reachable (16 cases); replaces `OptionsPage.percent` and `.category` (ported); `.no-english-field`
      now reads the new files.
- [x] `pages/__tests__/ResourcesPage.cards.test.jsx` — rules 18-22 (15 cases);
      `pages/options/__tests__/resourceToPayload.test.js` moved with `toResourcePayload`.
- [x] `components/__tests__/SidePanel.test.jsx` (13), `GroupedList.test.jsx` (8), `SearchField.test.jsx` (5)
      — the generic contracts.
- [x] `components/__tests__/PricedItemsPage.mobile-nesting.test.jsx` removed with the component.

### E2E (`npm run test:e2e`)

- [x] `e2e/specs/settings/options-catalogue.spec.js` — rules 1, 8-17: fold « Boissons », search « jus »,
      open an option, `-5` refused, `85` saved, the row shows « 30 € – 85 € »; the old addresses redirect.
- [x] `e2e/specs/settings/options-mobile-cards.spec.js` — rewritten for the 390 px list and the sheet
      (mobile check).
- [x] `e2e/specs/mobile/page-tabs.spec.js` — the new title.

### Manual UI verification

- [ ] Shadow copy, 1440 / 900 / 390 px: every option of the real catalogue shows the right price summary
      and traits (cross-check breakfast 10 €, cleaning 30 – 80 €, bed linen « Offert · tous les
      logements », bath mat « Offert · Granja » + « Interne »).
- [ ] Open, edit, save every type-specific option once (breakfast, bed linen, towels, bath mat,
      insurance, a progressive one); reservation form and public widget unchanged afterwards.
- [ ] Nordic bath card shows the evening and external rates; hourly plugin off → hidden.
- [ ] Keyboard only: Tab to a row, Enter opens the panel, Escape closes it; VoiceOver reads the row.

## 8. Out of scope

- Any change to option or resource business rules: prices, scope semantics (options explicit, resources
  legacy « empty = all »), defaults, archive behaviour, category ordering on the fiche and the widget.
- Category management (rename, reorder by drag) — a category stays a label typed on the option.
- Bulk edit (several prices at once), duplicating an option.
- The « Facturables au SAS » tab, the Calendrier › Ressources page, the property page's « Options
  incluses » card.
- Restoring archived options — unless arbitration 3 decides otherwise (see §9).
- The overlap « Lit bébé » option (billing) vs « Lit bébé » resource (stock): both stay; noted for a
  later wording pass.

## 9. Open questions

All three resolved on 2026-10-28 (the recommendations were taken):

- **Q1 — Direction of the list.** _Resolved 2026-10-28: A · Catalogue._ Rules 23-25 and the per-cell PUT
  are withdrawn, not built.
- **Q2 — Where to edit.** _Resolved 2026-10-28: a side panel_ (a full-screen sheet on a phone).
- **Q3 — Archived options.** _Resolved 2026-10-28: yes_ — a folded « Archivées » section with « Restaurer »
  (rules 26-27).

## 10. Implementation progress

Three lots, one commit each, on `feature/options-resources-ux`:

1. **Lot 1 — server.** Done: `optionCatalogueView`, `resourceCatalogueView`, archive guard, validation, scope
   clean-up, restore, SDK 2.8.0 brick + hourly contributor (plugin 1.3.0).
2. **Lot 2 — options.** Done: `SidePanel`, `GroupedList`, `SearchField`, `useCollapsedGroups`,
   `OptionEditorPanel`, `OptionPropertyTable`, `OptionsPage`, redirects, E2E.
3. **Lot 3 — resources.** Done: `ResourceEditorPanel`, cards, removal of `PricedItemsPage`.

Deviations from the draft, decided while building:

- A property line of a resource that only repeats the base price (a free first hour, no price of its own)
  is not listed as a price line; the plugin's « Offert » line carries the free hour.
- A resource property line with a free hour and no typed price is saved with the base price as its price
  (the model reads a stored row as an override), so only the hour differs.
- A default outside an option's explicit scope is now dropped on save instead of widening the scope
  (rule 15); a payload without `propertyIds` keeps « a default implies applicability ».
- The negative base price keeps its legacy `400 NEGATIVE_OPTION_PRICE` (it runs before the 422 checks).
- The panel sits on the modal layer, above the app bar, so its header is never covered.

Verification: server suite, client suite, `check-spec-coverage`, `vite build`, E2E (full suite and the new
specs), and a browser pass on a copy of the shadow data at 1280 and 390 px.
