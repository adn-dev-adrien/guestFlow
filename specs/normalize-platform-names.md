# Normalize platform names (UpperCamelCase canonical form)

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/normalize-platform-names` _(user-managed)_ |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Depends on** | PR #116 (`accounting-platform-commission-and-no-deposit`) — uses the new `platforms` table |

---

## 1. Context

After unifying the deduped per-platform commission config (PR #116) and
including `reservations.platform` as a second seeding source for the
`platforms` table, Adrien's prod-copy DB surfaced obvious data-quality drift:

```
direct
Gitedefrance, Lodgify, Abracadaroom        ← iCal source labels
logify, gitedefrance, lodgify, greengo,
abracadaroom, abritel, booking, airbnb     ← reservations.platform (manual / legacy)
```

Same business platform, two casings: `Gitedefrance` vs `gitedefrance`,
`Lodgify` vs `lodgify`. Plus a typo `logify` (sic). The `platforms` row
uniqueness (`UNIQUE(name)`) is case-sensitive, so the dedicated page shows
duplicates and the export resolution uses the first-matching name in the
case-insensitive lookup in `accountingModel.resolveCommissionConfig` — but
the operator-facing UI is still confusing.

The fix has two halves: (1) a **write-time formatter** that puts every
incoming platform name into a canonical UpperCamelCase form, applied at
every write site that lands in `platforms.name` / `ical_sources.platformLabel`
/ `reservations.platform`; and (2) a **one-shot boot migration** that
normalizes every existing row, merging conflicting `platforms` rows in the
process.

## 2. Goal

Every platform name across the three tables follows a single canonical form
so the operator never sees duplicates with different casing again. New
write sites pick up the normalization automatically. The migration runs
once at boot, idempotent, and merges conflicting `platforms` rows without
losing the operator-configured `commissionAccountNumber` / `hasVatOnCommission`
settings.

## 3. Functional rules

### 3.1 Canonical form — `formatPlatformName(input)`

1. **Pass-through for the `direct` enum value.** Any input whose lowercase
   form is `'direct'` is returned as `'direct'` (lowercase) verbatim. This
   preserves the existing strict equality checks in `accountingExport.js`,
   `accountingModel.js`, and the few SQL `!= 'direct'` filters in
   `database.js`. `'direct'` is treated as an enum, not a platform label.
2. **NFD diacritic strip.** `String(input).normalize('NFD').replace(/\p{M}/gu, '')`.
   So `Gîtes` → `Gites`, `Hôtel` → `Hotel`.
3. **Split on every non-alphanumeric character** (whitespace, hyphen,
   underscore, punctuation). Empty segments dropped.
4. **For each segment**: first letter uppercase (`Locale-independent`,
   ASCII A–Z), remaining letters lowercase.
5. **Concatenate** without separator.
6. Empty input (after stripping) → returns `''` (the caller decides what to
   do with empties — typically: ignore + log).
7. `null` / `undefined` input → returns `null` (= "no platform info on this
   write, leave the column alone").

Worked examples (from the prod-copy DB and probable future inputs):

| Input | Output |
|---|---|
| `gitedefrance` | `Gitedefrance` |
| `Gitedefrance` | `Gitedefrance` |
| `Gîtes de France` | `GitesDeFrance` |
| `lodgify` | `Lodgify` |
| `Lodgify` | `Lodgify` |
| `logify` (typo, exists in prod) | `Logify` (preserved — the formatter doesn't spell-check) |
| `airbnb` / `Airbnb` / `AIRBNB` | `Airbnb` |
| `direct` / `Direct` / `DIRECT` | `direct` (enum pass-through, rule 1) |
| `Stripe (Greengo)` | `StripeGreengo` |
| `Booking.com` | `BookingCom` |
| `''` / `'   '` / spaces+punct only | `''` |
| `null` / `undefined` | `null` |

### 3.2 Write-site hooks

8. **`server/src/models/propertyIcalModel.js`**: in `createSource` and
   `updateSource`, format `body.platformLabel` before persisting to
   `ical_sources.platformLabel`. The existing
   `platformsModel.upsertByName(input.platformLabel)` hook downstream sees
   the already-normalized value.
9. **`server/src/models/reservationsModel.js`**: in `insertReservation` and
   `updateReservation`, format `payload.platform` before persisting to
   `reservations.platform`. Direct bookings stay as `'direct'` (rule 1).
10. **`server/src/models/platformsModel.js`** `upsertByName` formats its
    input. Belt-and-suspenders: even if a caller passes a raw value, the
    inserted row carries the canonical name.

### 3.3 One-shot boot migration

11. Gated by `migrations.platform_names_normalized_v1`. Idempotent: re-runs
    are no-ops.
12. **Step A — Compute the canonical map.**
    - Walk `SELECT id, name FROM platforms`.
    - For each row, compute `canonical = formatPlatformName(name)`.
    - Build groups: `{ canonical → [row, row, …] }`.
13. **Step B — Resolve `platforms` conflicts.** For each group with > 1
    member:
    - Pick the **winner**: row with non-NULL `commissionAccountNumber` (if
      any), tiebreak by lowest `id`. Else: lowest `id`.
    - For every **loser**: `UPDATE ical_sources SET platformLabel = ? WHERE
      platformLabel = ?` (loser.name → winner.name) and `UPDATE reservations
      SET platform = ? WHERE platform = ?` (loser.name → winner.name).
    - `DELETE FROM platforms WHERE id = ?` for each loser.
14. **Step C — Rename surviving rows to canonical.** For each surviving
    platform row whose `name != canonical(name)`:
    - `UPDATE platforms SET name = ? WHERE id = ?` to its canonical.
    - `UPDATE ical_sources SET platformLabel = ? WHERE platformLabel = ?`
      (oldName → canonical).
    - `UPDATE reservations SET platform = ? WHERE platform = ?` (oldName →
      canonical).
15. **Step D — Normalize source tables for rows without a matching
    `platforms` entry.** A defensive pass:
    - `UPDATE ical_sources SET platformLabel = formatted` for every
      non-canonical `platformLabel` (uses JS — read all distinct values,
      compute new, batch UPDATE).
    - `UPDATE reservations SET platform = formatted` for every non-canonical
      `platform` (same approach).
16. **Step E — Insert `migrations.platform_names_normalized_v1`** so
    subsequent boots skip.
17. The whole sequence runs inside a single `db.transaction()`. Rollback on
    any error so the DB stays in a consistent state.

### 3.4 Out of scope

- **Typo correction** (e.g. `Logify` → `Lodgify`). The formatter is a
  mechanical case-normalizer, not a spell-checker. Adrien manually deletes
  / merges typo rows from the dedicated page once he sees them.
- **`reservations.platform` foreign-key constraint.** The relation stays
  by-name (free-form TEXT) so the operator can keep typing platform names
  on manual reservations without being blocked by a missing `platforms`
  row.
- **Cascade renaming of related platform-specific assets** (e.g. an iCal
  source-color tied to the platform name). Not applicable today — colors
  are per `ical_sources.platformColor`, not derived from the label.

**Edge cases:**

- **A platform name that becomes `''` after normalization** (e.g. someone
  typed `'!@#$'`). The formatter returns `''` → the write hook coerces to
  `null` (silently swallowed) on `ical_sources.platformLabel` (NOT NULL
  column → caller error surfaces as a 400). On `reservations.platform`
  (nullable) it stays `null`. The boot migration drops such rows from the
  rename pass (no UPDATE if the canonical is empty).
- **A `platforms` row whose canonical name COLLIDES with another row's
  canonical name** (the GdF / gdf case): handled by step B's merge.
- **A migration re-run after operator-introduced new drift**: the gated
  flag prevents re-running. If Adrien wants to re-normalize after a manual
  data edit, he can `DELETE FROM migrations WHERE name =
  'platform_names_normalized_v1'` once + restart the server (or trigger a
  fresh `POST /platform-accounts/refresh` which calls `platformsModel
  .rescan` — but rescan doesn't normalize existing rows). The simplest
  re-normalize tool is a future `npm run normalize-platforms` script;
  out of scope here.

---

## 4. Architecture

> **Fat backend, thin frontend.** Pure data normalization at the DB
> boundary. The frontend is untouched.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `utils/platformNameFormat.js` | C | NEW — `formatPlatformName(input)` implementing rules 1–7. Pure function. |
| `models/` | `models/propertyIcalModel.js` | T | Format `platformLabel` before INSERT / UPDATE. |
| `models/` | `models/reservationsModel.js` | T | Format `platform` before INSERT / UPDATE. |
| `models/` | `models/platformsModel.js` | T | `upsertByName` formats input. |
| `database.js` | `database.js` | T | One-shot `platform_names_normalized_v1` migration (rules 11–17). |
| `tests/` | `tests/platform-name-format.unit.test.js` | C | 12-ish cases on the formatter (every row of the §3.1 table + a few edge cases). |
| `tests/` | `tests/platforms-model-normalization.unit.test.js` | C | Migration: conflict merge with non-NULL account winning, all 3 tables updated in lockstep, idempotency. |

### 4.2 Client side

**2026-06-05 follow-up — platform colors + dropdown alignment.** The
initial spec claimed the frontend was untouched. The post-deploy
calendar review showed two regressions caused by the UpperCamelCase
shift:

1. `client/src/constants/platforms.js → PLATFORM_COLORS` keys are
   lowercase slugs (`airbnb`, `gitedefrance`). Reservations now carry
   `platform = 'Airbnb'` / `'Gitedefrance'`, so the direct lookup
   `PLATFORM_COLORS[reservation.platform]` returned `undefined` →
   every non-direct booking fell back to the default grey on the
   calendar (the bug Adrien reported).
2. `PLATFORMS` array (used as `<MenuItem value=…>` in the platform
   `<Select>` on `ReservationPage`) was lowercase. Reservations
   stored as `'Airbnb'` no longer matched any `MenuItem` →
   `<Select>` rendered blank on edit.

**Fixes (this spec update + fix/platform-colors-uppercamel-mismatch
branch):**

- Add `normalizePlatformKey(platform)` helper to
  `client/src/constants/platforms.js`: NFD-strip + lowercase +
  remove every non-alphanumeric character. Slug-shape compatible
  with the server's `KNOWN_PLATFORM_COLORS` keys.
- Rewrite `getPlatformColor(platform)` to slug the input before
  looking up the colour map. Returns `DEFAULT_PLATFORM_COLOR`
  (`#757575`) only for genuinely-unknown platforms.
- Update `PLATFORMS` array to UpperCamelCase canonical form
  (matching `formatPlatformName`'s output) so the `<Select>` round-
  trips correctly: `['direct', 'Airbnb', 'Greengo', 'Abritel',
  'Abracadaroom', 'Booking', 'Gitedefrance', 'Pitchup']`.
- Add the `gitesdefrance` alias to `PLATFORM_COLORS` so the plural
  form (the formatter's output for accented `'Gîtes de France'`
  input) resolves to the same yellow as the typo-style singular
  `gitedefrance` slug.
- Replace the 4 direct `PLATFORM_COLORS[…]` lookups in
  `client/src/components/MiniPlanningStrip.js` with calls to
  `getPlatformColor(…)` — the slug normalisation flows through.
- Normalize keys when merging the API's `customColors` payload in
  `App.js` (the server slug uses dashes, the client slug strips
  them — without re-normalising the merged entries would never
  match a client-side lookup).

`PropertyDetail.js`'s `PLATFORM_COLORS[source.platformKey]` lookups
are unchanged — they read `ical_sources.platformKey`, which is
already the lowercase slug by construction (the server's
`normalizePlatformKey` lives at the iCal write site).

Tests: `client/src/constants/__tests__/platforms.test.js` (13 cases)
pins the slug normaliser, every UpperCamelCase reservation form, the
"Gîtes de France" plural variant + the dropdown invariants.

**2026-06-05 follow-up #2 — every calendar surface + filesystem
invariant test.** Adrien asked for full coverage on all the
calendars. The audit found 3 more affected files (the initial fix
only patched MiniPlanningStrip):

- `SyncedPropertyMiniCalendars.js` + `PropertyCalendarOverview.js`
  (dashboard + simplified calendar) — direct
  `platformColors[platform]` lookups in their day-cell gradient
  functions. The `platformColors` prop was killed; both now import
  `getPlatformColor` directly, and `CalendarPage` + `Dashboard`
  dropped the now-dead `platformColors={PLATFORM_COLORS}` prop they
  used to pass.
- `pages/FinancePage.js` — 2
  `<Chip sx={{ bgcolor: PLATFORM_COLORS[r.platform] }}>` on the
  reservation tables. Same regression shape, same fix.
- `pages/PropertyDetail.js` — 5 lookups against
  `source.platformKey` (lowercase slug, so chips were correct
  today but the access shape was fragile). Refactored to
  `getPlatformColor` + the new `isKnownPlatformKey(platform)`
  predicate (added to `constants/platforms.js`).

Two extra refactors land for testability:

- `SyncedPropertyMiniCalendars.buildDayGradient` is exported.
- `MiniPlanningStrip` gets a new top-level
  `buildMiniStripDayGradient` pure helper (the previous closure
  captured `selectedReservationColor` so the colour-resolution
  path wasn't unit-testable in isolation).

Regression prevention: a filesystem-walk test in
`client/src/__tests__/calendar-platform-colors.test.js` (12
cases — pure-function coverage on `getReservationColor` +
`buildMiniStripDayGradient` + `buildDayGradient` (synced), plus
the filesystem invariant) walks every `.js` file under
`client/src/` and fails on any direct `PLATFORM_COLORS[dynamic]`
READ. Writes (the customColors merge in `App.js`:
`PLATFORM_COLORS[key] = color`) are explicitly allowed via a
negative lookahead because the key is normalised before assignment.
A future drift back to the regression shape now breaks the suite
automatically at lint time. Vitest total 195 → **210 / 210 green**.

### 4.3 API contract

No endpoint signature change. The values returned by GET
`/api/accounting/platform-accounts` are canonical post-migration; PUT
payloads coming from the frontend pass through unchanged (the saved-row
shape is enforced by the backend formatter at write time, not by the API
layer).

---

## 5. Data model

No schema change. The migration touches existing data only.

## 6. UI / UX

No visible change beyond the deduplication. The platform list on
`/comptabilite/plateformes` shrinks (12 rows → 9 on the prod-copy DB) and
case-different duplicates disappear.

## 7. Test plan

### 7.1 Server unit tests (new)

| Test file | Cases | Pins |
|---|---|---|
| `platform-name-format.unit.test.js` (C) | (1) Diacritic strip. (2) Space split + per-segment capitalization. (3) Single word → first-letter capitalization. (4) Direct enum pass-through (3 casings). (5) Punctuation split. (6) Null / undefined → null. (7) Empty / whitespace → ''. (8) Idempotency: `f(f(x)) === f(x)` for a sample of normalized values. | Rules 1–7. |
| `platforms-model-normalization.unit.test.js` (C) | (1) Conflict merge: two rows collapse, winner keeps non-NULL `commissionAccountNumber`. (2) References updated: `ical_sources.platformLabel` + `reservations.platform` follow the merge. (3) Surviving non-conflict rows renamed to canonical. (4) `direct` row stays `direct` (enum). (5) Migration is idempotent on the same DB. (6) Empty / whitespace names left untouched (operator must clean manually). | Rules 11–17. |

### 7.2 Existing server suite

Stays green. Cases that hard-coded a platform name like `airbnb` or
`Gitedefrance` in a fixture may need their assertion updated to the
canonical form — minor adjustments. The hooks at write time fire
transparently, so no test should break "by accident".

### 7.3 Client tests

Untouched. Vitest 163 / 163 stays.

### 7.4 E2E (Playwright)

Stays green. 18 / 1 skip / 0 fail.

---

## 8. Out of scope

(See §3.4.) Summary: no typo correction, no FK enforcement, no automated
re-normalize tool.

## 9. Open questions

(All resolved at spec time, 2026-06-04.)

- **Q1**: Should `'direct'` be normalized to `'Direct'` or kept lowercase?
  - **Resolved**: kept lowercase (enum-like, preserves the strict
    equality checks already in the codebase).
- **Q2**: How to resolve `platforms` row conflicts on merge?
  - **Resolved**: row with non-NULL `commissionAccountNumber` wins;
    tiebreak by lowest `id`. The merged row keeps its existing config; the
    losing rows' configs are discarded (with the assumption that the
    operator had only configured one of the duplicate rows; if they
    configured both, the losing config is silently lost — the operator
    can re-apply via the page).
- **Q3**: Should the migration log a summary?
  - **Resolved**: yes. `console.log` one line: `[migration:platform-names-
    normalized] merged N conflict(s), renamed M row(s)`. Same shape as the
    existing `platform-no-deposit` migration log.
- **Q4**: Branch off `master` or off the current PR #116 branch?
  - **Resolved**: off the current PR branch. The migration uses the
    `platforms` table introduced by PR #116. Adrien merges #116 first,
    then this PR's base auto-rebases on the new master.

---

## Addendum — durable slug de-duplication (2026-06-22)

**Problem.** The one-shot `platform_names_normalized_v1` migration runs once. But the boot seeding
(`INSERT OR IGNORE INTO platforms … SELECT DISTINCT platformLabel/platform …`) is case-sensitive, so a
lowercase variant that appears *after* the migration (e.g. a new iCal source or reservation labelled
`lodgify` while `Lodgify` already exists) creates a **second row for the same slug**. With duplicates,
the per-platform tourist-tax write (`setTouristTaxCollection`) updates one row while the per-property
read (`listForProperty`, last-wins map) reflects the other → the operator's mode change **silently
doesn't apply**.

**Fix.** A new util `utils/platformSlugDedupMigration.runPlatformSlugDedup(db)` runs on **every boot**
(idempotent — a no-op once clean), called from `database.js` after the one-shot normalization:
- groups `platforms` rows by canonical name (`formatPlatformName`);
- keeps the canonical-named row (else the lowest id) as the survivor;
- **merges the operator-customised settings** from the duplicates into the survivor where the survivor
  sits at default (tourist-tax mode, colour, commission account/%/VAT) — so a setting that had landed on
  a soon-to-be-deleted duplicate is preserved (most-recently-inserted duplicate wins on conflict);
- re-points `ical_sources.platformLabel` + `reservations.platform` to the canonical name, deletes the
  duplicates.

This supersedes Q2's "losing config is silently lost": customised settings are now carried over.
Distinct slugs (e.g. the typo `Logify` vs `Lodgify`) are **never** merged — only exact-slug duplicates.

Tests: `tests/platformSlugDedup.unit.test.js` (7). Manual: changing the « Taxe de séjour » mode for a
previously-duplicated platform (Lodgify) now persists across reload.
