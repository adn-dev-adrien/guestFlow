# iCal-added platforms in the platform dropdowns

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/ical-platforms-in-dropdowns` _(user-managed)_ |
| **Created** | 2026-06-11 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

When the operator adds an iCal source on a property with a custom platform (the "autre" option, e.g.
`Vrbo`), the platform name **is** persisted into the `platforms` table — `propertyIcalModel.createSource`
/ `updateSource` call `platformsModel.upsertByName(platformLabel)`
([propertyIcalModel.js:128](../server/src/models/propertyIcalModel.js#L128)).

But the platform **dropdowns never read that table**. Both the reservation-form platform `<Select>`
([ReservationPage.js](../client/src/pages/ReservationPage.js)) and the iCal-source platform `<Select>`
([PropertyDetail.js](../client/src/pages/PropertyDetail.js)) are populated from the **hard-coded**
`PLATFORMS` constant ([platforms.js:7](../client/src/constants/platforms.js#L7)) — only the 8 built-in
platforms. So a platform added through an iCal import never appears anywhere it could be selected, and
the operator has to retype it via "autre" every time.

## 2. Goal

A platform added in a property's iCal imports appears in the platform dropdowns — both the reservation
form's platform selector and the iCal-source form's platform selector — without retyping.

## 3. Functional rules

1. A new read-only endpoint `GET /api/platforms` returns the canonical list of platform **names**.
2. The list is the **union** of: the built-in well-known platforms (always present), and every name in
   the `platforms` table (which is topped up from `ical_sources.platformLabel` + `reservations.platform`
   via the existing seed / `upsertByName` / `rescan`).
3. The list is **deduped on the canonical form** (`'Airbnb'` / `'airbnb'` collapse to one entry),
   `'direct'` first, then alphabetical (case-insensitive, French collation).
4. The reservation-form platform `<Select>` and the iCal-source platform `<Select>` both consume this
   endpoint instead of the static `PLATFORMS` constant.
5. The iCal-source selector keeps its **"autre"** escape hatch (free custom platform key + colour) so a
   not-yet-known platform can still be added — which then surfaces in the list for everyone afterwards.
6. The reservation selector renders the reservation's **own** `platform` value even if it isn't (yet)
   in the list, so an edge-case stored value never produces an out-of-range `<Select>`.
7. Until the request resolves (and if it fails), the dropdowns fall back to the static `PLATFORMS`
   constant so they are never empty.

**Edge cases:**
- Empty DB (only `direct`) → built-in platforms still offered (no regression).
- A custom platform with diacritics/spaces → stored canonical (NFD-stripped UpperCamelCase) and shown
  in that form; deduped against any case variant.
- Endpoint failure / slow network → static fallback list, no crash.

---

## 4. Architecture

> **Fat backend, thin frontend.** The union / dedup / sort lives in `platformsModel.listNames()`.
> The client only fetches the ready list and renders it.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `platforms.js` | C | `GET /api/platforms` → controller. Thin. |
| `controllers/` | `platformsController.js` | C | `listNames` → `{ platforms: model.listNames() }`. |
| `models/` | `platformsModel.js` | T | New `listNames()`: union of built-in names + table names, deduped/sorted; built-in names derived from `KNOWN_PLATFORM_COLORS`. |
| `constants/` | `platformColors.js` | — | Reused (source of the built-in slugs). |
| `index.js` | `index.js` | T | Mount `/api/platforms`. |
| `tests/` | `platforms-list-names.unit.test.js` | C | Unit tests for rules 2–3 + the iCal-added-platform regression. |

No role-guard change: the route lives under `/api` (auth required); `admin` is unrestricted and is the
only role that edits reservations / properties. The accountant role doesn't need it.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `hooks/` | `usePlatforms.js` | C | Fetches `GET /api/platforms`; returns `string[]` with the static `PLATFORMS` fallback. |
| `pages/` | `ReservationPage.js` | T | Consume the hook for the platform `<Select>`; union the current value (rule 6). Drops the `PLATFORMS` import. |
| `pages/` | `PropertyDetail.js` | T | Build the iCal platform options from the hook + the "autre" item; drops the module-level `ICAL_PLATFORM_OPTIONS`/`PLATFORMS` import. |
| `constants/` | `platforms.js` | — | Unchanged — still the static fallback + colour helpers. |
| `api.js` | `api.js` | T | `getPlatforms()`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Select` / `MenuItem` | No new component. |
| **Created (new generic)** | `usePlatforms` hook | Generic data hook reused by both consuming pages (and any future platform selector). |
| **Specific (kept feature-local)** | — | — |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/platforms` | — | `{ platforms: string[] }` | `'direct'` first, then alpha; deduped canonical. Auth required. |

---

## 5. Data model

No schema change. The `platforms` table already exists and is already seeded/topped-up from
`ical_sources.platformLabel` + `reservations.platform`. This spec only **exposes** it to the dropdowns.

**Data impact:** none.

## 6. UI / UX

- **Reservation form (Canal card):** the "Plateforme" `<Select>` now lists every known + imported
  platform. No visual change beyond more options.
- **Property iCal form:** the "Plateforme" `<Select>` lists every known + imported platform, plus the
  existing **"autre"** entry (custom key + colour picker), unchanged.
- **Copy:** none added (platform names render as stored).
- **Loading/empty/error:** the hook seeds with the static list, so there is no empty/loading flash and
  a failed request degrades gracefully to the built-ins.
- **Responsive:** unchanged — both selectors already `fullWidth`; no layout change.
- **`PageActionBar`:** not touched (both pages keep their existing bars).

## 7. Test plan

### Server unit tests
- [ ] `tests/platforms-list-names.unit.test.js`
  - rule 2 — empty DB still offers the built-ins (regression).
  - rule 2 — a custom platform upserted into the table (as iCal create does) appears in the list (the bug).
  - rule 3 — dedupe on canonical; `direct` first; non-direct sorted alphabetically.

### Manual UI verification
- [ ] Add an iCal source with an "autre" platform on a property → it appears in the reservation-form platform dropdown and in the iCal-form platform dropdown (after reload).
- [ ] Built-in platforms still listed; `direct` first.
- [ ] Editing a reservation whose platform is a custom one shows it selected (rule 6).
- [ ] Mobile (`xs`): selectors full-width, no overflow.

## 8. Out of scope

- Editing / deleting platform names (handled on the Comptabilité → Plateformes page).
- Per-platform colour management.
- Backfilling historical reservation platforms (already seeded at boot).

## 9. Open questions

- Q: Should the endpoint be under `/api/accounting` (where platform-accounts already live) or its own route?
  - A (2026-06-11): own route `/api/platforms` — it's a generic UI enum needed outside the accounting
    context, and keeping it role-open to admin (not accountant-scoped) is cleaner.
