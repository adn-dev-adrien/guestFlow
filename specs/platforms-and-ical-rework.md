# « Plateformes & iCal » — rework of the per-property platform/iCal list

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platforms-and-ical-rework` _(user-managed)_ |
| **Created** | 2026-06-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On the property fiche (`/properties/:id`, [PropertyDetail.js](../client/src/pages/PropertyDetail.js)) the
**"Connexions iCal"** section lists the property's iCal sources (`ical_sources` table). Today each row is a
*manually-added iCal feed* (URL **required**), with columns Plateforme / URL / Taxe collectée / Dernière
synchro / État / Actions (sync, edit-via-form-above-table, delete). Platform colors live on
`ical_sources.platformColor` (per source); the canonical platform list is `GET /platforms`
(built-ins ∪ DB). Tourist-tax-collection is the per-source `collectsTouristTax` flag.

The operator wants this to become a **platform management list**: every platform present by default, an
**optional** iCal URL (empty = no sync, manual entry only), an easy **per-platform calendar colour**, a
**tax-collected toggle**, and **inline row editing** — not a separate form.

## 2. Goal

The section becomes **"Plateformes & iCal"**: it lists **all platforms** (built-ins ∪ added), each with a
**global colour** (editable via a swatch → palette, recolours that platform's reservations on the
calendar everywhere), an **optional "URL iCal"** (empty → no sync, manual), a **"Taxe collectée" toggle**
(on = the platform collects, off = we do), and **sync status only when a URL is set**. A row is edited
**inline**. New platforms can be added.

## 3. Functional rules

### The list

1. **Section renamed** "Connexions iCal" → **"Plateformes & iCal"**.
2. The list shows **every platform** from the canonical list (`GET /platforms` — built-ins ∪ DB, incl.
   `direct`), merged with this property's `ical_sources` (matched by `platformKey`). A platform with no
   source row still appears: empty URL, no sync, tax = default (platform collects).
3. **Configure on demand:** a per-property `ical_sources` row is created/updated **only when** the operator
   sets a URL or flips the tax toggle for that platform on that property. Clearing both URL and a non-default
   tax may leave a harmless row; deleting a row resets the platform to "not configured here".
4. **Add a new platform:** an "Ajouter une plateforme" control creates a platform by name (upserts into the
   `platforms` registry, surfaced in every dropdown). It then appears in the list like any built-in.

### Colour (global per platform)

5. Every row shows a **colour square**. Clicking the platform **name** or the square opens a **colour
   palette**; the chosen colour is the platform's **global** display colour and recolours that platform's
   reservations on the calendar **for all properties**.
6. The global colour is stored on the **`platforms` table** (`platforms.color`). Colour resolution
   everywhere: `platforms.color` (custom) → `KNOWN_PLATFORM_COLORS[key]` (built-in default) → `#757575`.
   The calendar colour endpoint (`GET /properties/platform-colors`) reads `platforms.color`.

### URL iCal (optional)

7. The **"URL"** field is renamed **"URL iCal"** and is **optional**. Empty URL ⇒ **no iCal sync**: the row
   shows **empty** "Dernière synchro" + "État", and **no sync icon / button**. The operator enters that
   platform's reservations manually.
8. A non-empty URL must be `http(s)://…` (unchanged validation). With a URL, the sync icon/button + status
   columns appear and behave as today.

### Taxe collectée (toggle)

9. The "Taxe collectée" cell is a **toggle/switch** (not a static chip): **on** = the platform collects the
   tourist tax (today's "Plateforme", `collectsTouristTax = 1`), **off** = we collect it (today's "Vous",
   `collectsTouristTax = 0`). Flipping it persists to the per-property source (creating one if needed).
   `direct` has no platform-tax notion → the toggle is hidden/disabled for it.

### Disable a platform (per property)

10. Each row has a **"Désactiver"** toggle. When a platform is **disabled for this property**:
    - the row's **text turns grey** (visually muted, with a "Réactiver" affordance);
    - that platform's reservations are **hidden from this property's reservation views** (the property
      calendar + any per-property reservation list). The reservations are **not** deleted — re-enabling
      brings them back; iCal sync (if a URL is set) still runs but disabled-platform bookings stay hidden.
    The flag is **per (property, platform)** and persists a source row on demand (like URL/tax).
    `direct` can be disabled too (hides direct bookings from this property's views).

### Inline editing

11. The **"Modifier"** button switches **that row** into **inline edit**: the URL becomes an editable text
    field, the tax becomes its toggle, and the colour square stays clickable (palette). **Enregistrer** /
    **Annuler** commit or revert the row. (Replaces the former edit-form-above-the-table.)
12. **`direct`** row: colour + disable only (no URL field, no tax toggle, no sync). It can be recoloured but
    not synced.

**Edge cases:**
- Empty URL + tax left at default + default colour → no source row persisted (nothing to store).
- Sync-all skips empty-URL platforms (no fetch, no error rows).
- Deleting a configured platform row removes its `ical_sources` row (URL + tax reset to defaults here); the
  platform itself stays in the registry (still listed, default colour/tax).
- A platform colour set then reset to the built-in default → store the built-in (or clear the override).

---

## 4. Architecture

> **Fat backend, thin frontend.** The merged list (platforms ∪ this property's sources), colour resolution,
> tax flag, and the empty-URL "no sync" rule are shaped server-side. The client renders the list + inline
> editors + colour palette.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE platforms ADD COLUMN color TEXT`; make `ical_sources.url` effectively optional (the column is `NOT NULL` today → migrate to allow `''`/NULL, or just store `''`). |
| `models/` | `models/platformsModel.js` | T | `getColor(name)` / `setColor(name, hex)` (upsert), `colorMap()` (key→resolved colour for the calendar), `listForProperty(propertyId)` (merged rows: every platform + this property's source config + global colour). |
| `models/` | `models/propertyIcalModel.js` | T | `resolveSourceInput`: URL optional (empty allowed) + `disabled` flag. `createSource`/`updateSource`: accept empty URL + `disabled`; an upsert-by-platform path for "configure on demand". `syncSource` / `syncAllForProperty`: **skip** empty-URL sources (no fetch, status left blank). Colour no longer authoritative here (reads `platforms.color`). `disabledPlatformLabels(propertyId)` → the property's disabled platform labels. |
| `models/` | `models/reservationsModel.js` | T | `list({ propertyId })` **excludes** reservations whose platform is disabled for that property (display filter only). **`getOccupiedReservations` / availability checks are UNCHANGED** — a disabled platform's bookings still block dates (no double-booking). |
| `controllers/` | `controllers/propertyIcalController.js` | T | A `GET …/platforms` (merged list for the property) + a colour-set endpoint; keep CRUD. |
| `controllers/` | `controllers/platformsController.js` / `propertiesController` | T | `platform-colors` reads `platforms.color`; add platform-colour set route. |
| `routes/` | `routes/properties.js` / `routes/platforms.js` | T | `GET /properties/:id/platforms` (merged), `PUT /platforms/:key/color` (global colour), reuse iCal source CRUD for url/tax. |
| `utils/` | `utils/pricing.js` etc. | — | `collectsTouristTax` lookup unchanged (per-property source; default 1 when absent). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/PropertyDetail.js` | T | Rework the section: title "Plateformes & iCal"; render the **merged** list; per-row **inline edit** (URL iCal field, tax toggle, colour square→palette); conditional sync icon/columns; "Ajouter une plateforme". Remove the separate edit-form-above-table. |
| `components/` | `components/PlatformColorPicker.js` | C | A small reusable colour swatch + popover palette (extract — also usable wherever a platform colour is edited). |
| `constants/` | `constants/platforms.js` | T | `getPlatformColor` keeps reading the merged colour map (already fed by `GET /properties/platform-colors`, now backed by `platforms.color`). |
| `api.js` | `api.js` | T | `getPropertyPlatforms(propertyId)`, `setPlatformColor(key, hex)`; reuse ical-source CRUD + sync. |

**Component reuse declaration:** new generic `PlatformColorPicker` (swatch + palette popover) — reused for
any platform-colour edit. The list stays a feature-local table in `PropertyDetail`.

### 4.3 API contract

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/properties/:id/platforms` | Merged rows: `[{ platformKey, platformLabel, color, isDirect, url, collectsTouristTax, disabled, sourceId?, lastSyncAt?, lastSyncStatus?, lastSyncMessage? }]`. |
| PUT | `/api/platforms/:key/color` | `{ color }` → sets the global platform colour (`platforms.color`). |
| POST/PUT/DELETE | `/api/properties/:id/ical-sources(/:sourceId)` | URL now optional; upsert-by-platform for configure-on-demand. |
| POST | `/api/properties/:id/ical-sources/:sourceId/sync` | Unchanged; only offered when URL set. |
| GET | `/api/properties/platform-colors` | Now backed by `platforms.color` (+ built-in fallback). |

---

## 5. Data model

- **`platforms.color`** TEXT NULL — the global per-platform display colour. NULL → built-in default.
- **`ical_sources.url`** — relaxed to optional (`''`/NULL allowed). Empty ⇒ no sync.
- **`ical_sources.disabled`** INTEGER NOT NULL DEFAULT 0 — per (property, platform) "hidden from this
  property's reservation views" flag. Independent of `isActive` (sync inclusion). Persisted on demand.
- **`ical_sources.platformColor`** — kept for back-compat but no longer authoritative (calendar reads
  `platforms.color`); may be deprecated later.

**Migration strategy (idempotent, `database.js`):**
1. `ALTER TABLE platforms ADD COLUMN color TEXT` (PRAGMA-guarded).
2. `ALTER TABLE ical_sources ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0` (PRAGMA-guarded).
3. Relax `ical_sources.url` NOT NULL (recreate table or tolerate `''`). Backfill `platforms.color` from any
   distinct `ical_sources.platformColor` that differs from the built-in (so existing custom colours carry
   over), once.

**Data impact:** additive `platforms.color`; URL relaxation keeps existing rows valid. The colour backfill
preserves today's custom calendar colours. No reservation/finance data touched.

## 6. UI / UX

- **Title:** "Plateformes & iCal".
- **Row (read mode):** `[■ colour] Plateforme | URL iCal (or « — »)| Taxe collectée [toggle] | Dernière synchro | État | [sync?] [Désactiver] [Modifier] [Suppr?]`. No URL → sync cell + status empty, no sync icon.
- **Disabled row:** the whole row's text is **greyed** (muted) and the toggle shows "Réactiver"; the
  platform's bookings disappear from the property calendar/list.
- **Colour:** clicking the name or the square opens a palette popover; pick → saved (optimistic), calendar
  recolours.
- **Row (edit mode):** URL becomes a `TextField` (label "URL iCal", placeholder "https://…  (laisser vide = saisie manuelle)"); tax toggle live; colour square clickable; **Enregistrer / Annuler**.
- **Add platform:** an inline "Ajouter une plateforme" (name field → creates + appears in the list).
- **`direct`:** colour only; URL/tax/sync hidden.
- **Responsive:** on `xs` the table becomes stacked cards (one platform per card) with the same controls;
  inline edit expands the card. No horizontal scroll on `xs`.
- **PageActionBar:** unchanged (the property fiche keeps its bar).

## 7. Test plan

### Server unit tests
All four concerns are covered by `tests/platforms-and-ical-rework.unit.test.js` (8 tests, schema.sql-backed):
- [x] `platformsModel` — `setColor`/`getColor` upsert; clear-on-built-in / clear-on-empty; `colorMap`
  resolves custom→built-in→default; `listForProperty` merges every platform with the property's source
  config + global colour.
- [x] `propertyIcalModel` — empty-URL source allowed, bad URL rejected; `syncOne`/`syncAllForProperty`
  **skip** empty-URL (no fetch, status untouched); `createSource` upserts ONE row per (property, platform);
  the `disabled` flag persists; `disabledPlatformLabels` returns the right set.
- [x] `reservationsModel` — `list({propertyId})` excludes a disabled-platform reservation;
  `getOccupiedReservations` (availability) STILL includes it (no double-booking regression).
- [x] `propertiesModel.getPlatformColors` — backed by `platforms.color` (+ built-in fallback).

> The one-time `database.js` colour backfill (custom `ical_sources.platformColor` → `platforms.color`) is
> a deterministic, idempotent migration — verified by inspection (consistent with the repo's other
> additive migrations, which are not individually unit-tested).

### Manual UI verification
- [ ] All platforms listed by default (incl. direct); a platform with no URL shows empty sync/état, no sync icon.
- [ ] Set a URL → sync icon + status appear; sync works.
- [ ] Click a platform name → palette → pick colour → the calendar recolours that platform's reservations.
- [ ] Flip "Taxe collectée" → persisted; tourist-tax behaviour follows (Suivi taxe de séjour).
- [ ] Inline "Modifier" edits the row's URL/tax/colour; Enregistrer/Annuler work.
- [ ] Mobile (`xs`): stacked cards, controls reachable, no horizontal scroll.

### Client tests (vitest)
- [x] `pages/__tests__/PropertyDetail.test.js` (extend) — renders the merged platform list (built-ins incl.
  `direct`); inline-editing a platform URL upserts the source (`createPropertyIcalSource` with url+platformKey)
  and reloads; clicking a colour swatch opens the palette. (The two old "iCal add form" tests were replaced.)

### E2E (Playwright)
- [ ] On a property, the Plateformes & iCal list shows built-ins; set a platform colour → assert it persists
  (reload); add a URL → the sync control appears; empty-URL platform shows no sync control. _(deferred — covered
  by the vitest behaviour tests above; add an E2E spec if the section regresses.)_

## 8. Out of scope

- Per-property platform colours (colour is global, by decision).
- Removing `ical_sources.platformColor` (kept for back-compat; later cleanup).
- Reworking the tourist-tax pricing/accounting math (only the toggle UI + storage path change).
- A global standalone "Platforms" settings page (this stays on the property fiche).

## 9. Open questions

Resolved during scoping (2026-06-19):
- **Default platforms?** → Show every platform; persist a source row on demand (no mass row creation).
- **Colour scope?** → Global per platform (`platforms.color`); recolours the calendar everywhere.
- **Include `direct`?** → Yes (colour only; no URL/sync/tax).

Resolved during implementation review (2026-06-19, adversarial pass):
- **Live recolour without reload.** After a successful colour `PUT`, `PropertyDetail.handleSetPlatformColor`
  also writes the in-memory `PLATFORM_COLORS[normalizePlatformKey(label)] = hex` (the same module map
  `App.js` seeds from `GET /properties/platform-colors`), so the calendar/planning/finance views recolour
  in-session — not only after a hard reload (rules 5-6).
- **Tourist-tax toggle ⇄ `reservations.platform` matching.** `reservations.platform` is written two ways:
  iCal imports store the hyphenated `source.platformKey`, manual reservations store the concatenated
  `formatPlatformName(...)` (= `source.platformLabel`). `isPlatformCollectingTouristTax` (pricing.js) now
  matches on **`lower(platformKey)` OR `lower(platformLabel)`** (mirroring the reservation hide-filter), so
  the owner-collects toggle is honoured for multi-word / accented custom platforms on the manual path
  (previously silently ignored → tax wrongly zeroed). +1 server test.
- **Colour map server↔client sync.** Server `KNOWN_PLATFORM_COLORS` gained the plural `gitesdefrance`
  alias to mirror the client (the canonical stored form is the plural `GitesDeFrance`).
- **Custom-colour input debounce.** `PlatformColorPicker` buffers the native colour input in a local draft
  and commits once (on blur / popover close) instead of firing a `PUT` per drag event.
