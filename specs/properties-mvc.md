# Properties — MVC extraction (CRUD, pricing, documents, options, iCal import)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/properties-mvc` _(Claude-managed)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Properties (the last CRITICAL route monolith). See `specs/ROADMAP.md`. |

---

## 1. Context

`routes/properties.js` is **1260 LOC** — the last and largest CRITICAL monolith with **no
controller/model**. It mixes six concerns inline:

1. **Property CRUD** — list, `GET /:id` (enriched: pricing rules + documents + option ids + iCal
   sources), create, update, delete (+ photo upload + orphan-client cleanup).
2. **Platform colours** — `GET /platform-colors` (known + custom from active iCal sources).
3. **Pricing rules** — create / update / delete / `apply-to` (copy a property's seasons to another),
   `progressive-preview`, with **season-overlap detection** (`findPricingRuleOverlap`).
4. **Documents** — upload (multer disk) / delete.
5. **Property↔options linkage** — `PUT /:id/options`.
6. **iCal import** — `~470 LOC` of inline iCal parsing + the **anti-overbooking sync engine**
   (`syncIcalSource`) + the `/:id/ical-sources` CRUD/sync/sync-all routes.

Pain points:
- The **anti-overbooking sync** ([[ical-anti-overbooking]]) lives inline in a route file; it is exported
  ad-hoc (`module.exports.syncIcalSource`) and consumed by `scheduledTasks.js`.
- The iCal source **status-update block** (`lastSyncAt`/`lastSyncStatus`/`lastSyncMessage`/
  `lastImportedCount`) is **duplicated three times** (the `/sync` route, `/sync-all` route, and
  `scheduledTasks.performAutoSync`).
- Pure iCal parsing helpers are exported via `module.exports.__test` and tested by
  `properties-ical.unit.test.js`.

## 2. Goal

`routes/properties.js` becomes a thin route over controllers + models, with the iCal parsing isolated as
a pure util and the anti-overbooking sync engine moved **verbatim** into a model — **no behaviour, API,
or output change**, no schema change. The triplicated sync status-update is DRY'd into one model method.

## 3. Functional rules

1. **MVC.** Routes parse + wire upload middleware, then delegate to `propertiesController` /
   `propertyIcalController`. All SQL + shaping in `propertiesModel` / `propertyIcalModel`. Pure iCal
   parsing in `utils/icalParser.js`; upload plumbing in `utils/propertyUploads.js`.
2. **Behaviour-preserving.** Every one of the 21 endpoints keeps its exact contract: payload shapes
   (incl. enriched `GET /:id`), status codes (`400` invalid iCal URL / missing platform / pricing
   overlap, `404` not found, `409 PRICING_OVERLAP` on apply-to), validation, French copy, transactions,
   and the photo/document upload limits + error messages.
3. **Anti-overbooking sync moved verbatim.** `syncIcalSource` → `propertyIcalModel.syncSource(source)`
   with the **exact same** 5-step algorithm (UID/fallback/legacy mapping → create / re-create / rename /
   unchanged / **locked-skip** / update → stale removal → orphan-client cleanup). The `sourceType==='ical'
   && icalSyncLocked===1` skip and the `ical_import_events` mapping semantics are unchanged.
   **One approved optimization** (tests-first, guarded by `property-ical-sync`): the iCal client is now
   resolved **only inside the two insert branches** instead of for every event — `clientId` is never used
   by the unchanged/locked/update paths, and resolving it there created an **orphan client on a
   renamed-guest update** (the update never relinks `clientId`). The 6 core sync assertions are unchanged;
   a new test confirms no orphan client is created.
4. **DRY the sync status-update.** A single `propertyIcalModel.syncSourceAndRecord(source)` runs
   `syncSource` then writes the `ical_sources` success row (same message format), or on throw writes the
   error row and rethrows. The `/sync` route, `/sync-all` route, and `scheduledTasks` all call it instead
   of repeating the `UPDATE ical_sources …` block.
5. **`scheduledTasks` re-pointed.** It imports `syncSourceAndRecord` from `propertyIcalModel` (not the
   route), and its inline status-update block is removed (now inside the model). Auto-sync behaviour
   identical.
6. **Pure parsing util + test migration.** `properties-ical.unit.test.js` imports the parse helpers from
   `utils/icalParser.js` instead of the route `__test` export (same cases). The route stops exporting
   `__test` / `syncIcalSource`.
7. **No client change.** The API is identical; `PropertyDetail`, `PropertyPricingSeasonsPage`, calendar
   overview, etc. are untouched.
8. **No schema change.**

**Edge cases (preserved):** pricing season overlap (create/update/apply-to); `apply-to` with
`replaceExisting` vs conflict `409`; delete property cascade + orphan-client cleanup; photo replace
removes the old file; iCal locked reservations never overwritten; stale iCal events removed; iCal
orphan-client cleanup; unavailable/cancelled iCal events filtered out.

---

## 4. Architecture

> **Fat backend, thin frontend.** Pure server refactor. No client touch. The iCal parser is pure
> (text → events); the sync engine is the model (DB writes); uploads are plumbing.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `icalParser.js` | C | Pure iCal helpers moved verbatim: `parseIcsEvents`, `parseIcalDate`, `addIsoDays`, `toIsoDate`, `unfoldIcsLines`, `unescapeIcalText`, `normalizeIcalSummary`, `extractSummaryFromIcalReservationNotes`, `parseAdultsFromText`, `parseGuestName`, `resolveIcalClientIdentity`, `isUnavailableIcalEvent`, `buildEventHash`, `shouldSkipIcalReservationUpdate`, `buildIcalCreationHistoryChanges`, `normalizePlatformKey`. No DB. Unit-tested. |
| `utils/` | `propertyUploads.js` | C | Uploads plumbing: `uploadsDir`, photo (`sharp`, memory) + document (multer disk) configs, `handlePhotoUpload`/`handleDocumentUpload` middleware, `saveOptimizedPhoto`, `removeUploadedFile`, the multer error mapper. |
| `models/` | `propertiesModel.js` | C | Property CRUD + `getByIdWithDetails` (pricing rules/documents/optionIds/icalSources); pricing rules create/update/delete + `applyTo` + `findPricingRuleOverlap`; documents add/delete; options `setOptions`; `getPlatformColors`. `create(db)` factory. |
| `models/` | `propertyIcalModel.js` | C | iCal sources `list/create/update/remove`; **`syncSource(source)`** (verbatim anti-overbooking engine); **`syncSourceAndRecord(source)`** (sync + status row, DRY); internal `getOrCreateIcalClient`, `addReservationHistoryEntry`. Uses `utils/icalParser`. `create(db)` factory. |
| `controllers/` | `propertiesController.js` | C | Thin handlers: list / getOne / create / update / remove / platformColors / progressivePreview / pricing (add/update/delete/applyTo) / documents (add/delete) / setOptions. |
| `controllers/` | `propertyIcalController.js` | C | Thin handlers: sources list/create/update/remove + sync + syncAll (calls `syncSourceAndRecord`). |
| `routes/` | `properties.js` | T | Thin: mount upload middleware + the 21 routes → the two controllers; keep the multer error middleware. No SQL/logic/iCal left. No `__test`/`syncIcalSource` export. |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Import `syncSourceAndRecord` from `propertyIcalModel`; drop the inline status-update duplication. |
| `utils/` | `pricing.js` · `textFormatters.js` · `uploadSafety.js` | — | Reused (`normalizeDateRanges`, `parseRuleDateRanges`, `buildProgressivePreview`, `sentenceCase`, `safeUpload*`). |
| `tests/` | `properties-ical.unit.test.js` | T | Re-point imports to `utils/icalParser`. Same cases. |
| `tests/` | `property-ical-sync.unit.test.js` | C | **New** — in-memory DB + stubbed `fetch` returning a crafted `.ics`: assert create → update (hash change) → **locked-skip** (no overwrite when `icalSyncLocked=1`) → stale removal. Directly guards the anti-overbooking contract. |
| `tests/` | `properties-model.unit.test.js` | C | **New** — pricing overlap detection, `applyTo` (copy + `replaceExisting` + `409` conflict), `getByIdWithDetails` shape, options linkage. |

### 4.2 Client side (`client/src/`)

No change — the API contract is identical. (`PropertyDetail.js`, `PropertyPricingSeasonsPage.js` and the
property service in `api.js` are untouched.)

### 4.3 API contract

Unchanged. Same 21 endpoints, same request/response shapes, status codes, validation, upload limits.

---

## 5. Data model

No schema change, no migration.

## 6. UI / UX

No visible change. Property list/detail, pricing seasons, documents, options, iCal sources management +
sync feedback all behave identically. (No `PageActionBar` change in scope.)

## 7. Test plan

### Server unit tests
- [x] `properties-ical.unit.test.js` — migrated to import `utils/icalParser` (same parse/normalize cases).
- [x] `property-ical-sync.unit.test.js` (new, 7) — anti-overbooking sync: create, update on hash change,
      **locked reservation not overwritten**, stale event removal, unavailable/blocked filtered,
      `syncSourceAndRecord` status row, **no orphan client on renamed-guest update** (the optimization).
- [x] `properties-model.unit.test.js` (new, 7) — pricing overlap; `applyPricingTo` (copy / replaceExisting
      / `409` / source-target validation); `getByIdWithDetails` shape; `setOptions`.
- [x] Full server suite green (**346**).

### Manual UI verification (browser)
- [x] Property detail page renders (0 console errors). All rewritten endpoints verified live:
      `GET /properties` (200, list), `/platform-colors` (200, known+custom), `/:id` (200, enriched:
      pricingRules/documents/optionIds/icalSources), `/:id/ical-sources` (200, array).
- [x] Server reloaded cleanly on the route rewrite (auth-gate `401` then authenticated `200`s).
- [ ] Create/edit-with-photo/delete + pricing overlap UI + apply-to + document + a real iCal **sync** —
      left for the user's pass (the engine is verbatim + covered by the new sync test). Client untouched
      (no client files changed → no client build needed).

## 8. Out of scope

- Any pricing/iCal behaviour change (pure relocation).
- `devis_*`/`reservation_*` fusion; per-extra payment tracking.
- Client thin-frontend work on `PropertyDetail`/`PropertyPricingSeasonsPage` (config normalization there
  is acceptable; not part of this MVC extraction).
- `PageActionBar` migration for property pages.

## 9. Open questions

- **Q: One `propertiesModel` or split property vs iCal?** → **A: two models** (`propertiesModel` +
  `propertyIcalModel`).
- **Q: Keep `syncSource` vs only `syncSourceAndRecord`?** → **A: both** — `syncSource` (pure engine,
  unit-testable) + `syncSourceAndRecord` (status-writing wrapper used by the routes + `scheduledTasks`),
  plus `syncOne`/`syncAllForProperty` orchestration so the controller stays thin.
