# Per-platform tourist tax collection

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/per-platform-tourist-tax-collection` |
| **Created** | 2026-05-30 |
| **Author** | Adrien |
| **Related PR** | _(filled after push)_ |

---

## 1. Context

Until now, the pricing engine had a **hardcoded rule**: a reservation whose `platform !== 'direct'`
was treated as *"the platform collects the tourist tax on the owner's behalf"* (`touristTaxTotal = 0`
on the quote, with the original amount kept aside as `touristTaxOriginalTotal` for display). Same
hardcoded shortcut was used in the **Suivi taxe de séjour** report
(`financeModel.getTouristTaxExtraction` filtered with `r.platform = 'direct'`).

This was wrong as a general rule: some platforms collect the tax (Airbnb in France, most of the time),
others don't (some Booking arrangements, custom platforms, etc.). Adrien needs to be able to **decide
per platform per property** whether the platform collects the tax — and have that decision flow
**coherently** to every place the tourist tax shows up: reservation form quote, `PricingSummary`
panel, accounting export, and the *Suivi taxe de séjour* extraction page.

## 2. Goal

For each iCal source configured on a property, let Adrien set whether **that platform collects the
tourist tax** on his behalf. The setting then governs the tourist tax everywhere in the app, with no
visible inconsistency between the reservation summary, the export, and the Suivi page.

## 3. Functional rules

1. Each `ical_sources` row carries a boolean **`collectsTouristTax`**:
   - `1` (default) — the platform collects the tax (offered on the quote, hidden from Suivi).
   - `0` — the owner collects it (charged on the quote, listed in Suivi).
2. The **pricing engine** resolves the "platform collects" flag like this (case-insensitive on
   `platformKey`):
   - `platform = 'direct'` → owner collects (never offered, always charged).
   - `platform = other` → look up the property's iCal source matching the platform key:
     - matching row found → follow its `collectsTouristTax`.
     - no matching row → **default to "collects"** so legacy data and ad-hoc platforms keep the
       previous behaviour (no surprise on existing reservations).
3. The reservation `quote` returns both `touristTaxTotal` (the amount actually charged — `0` when
   offered) and `touristTaxOriginalTotal` (the would-be amount, kept for display in the summary).
   The `touristTaxOfferedByPlatform` flag mirrors rule 2.
4. The **Suivi taxe de séjour** page (`/finance/tourist-tax`) extracts only the reservations the
   owner actually has to remit: direct bookings, **plus** non-direct ones whose matching iCal source
   has `collectsTouristTax = 0`. Reservations whose platform collects must never appear there.
5. The reservation `PricingSummary` already renders the offered / charged behaviour from the quote
   fields — no change required: it auto-reflects rule 2.
6. **No retroactive recompute** on existing reservations: stored `touristTaxTotal` / `touristTaxRate`
   on past rows are left alone; only the live engine and the Suivi page use the new flag.

**Edge cases:**
- A property has no iCal source for the platform (manual reservation with `platform = 'airbnb'` but
  Airbnb iCal never configured) → rule 2 fallback → "collects" (= offered). Owner can configure an
  iCal source (even with a dummy URL) just to flip the flag if needed.
- `ical_sources` table absent (minimal test DB) → the engine helper swallows the SQL error and
  returns "collects" (defensive default).
- Two iCal sources on the same property with the same `platformKey` → engine picks one with `LIMIT 1`
  ordered by source id; in practice the UI never lets you create duplicates, but if it happens the
  behaviour is deterministic.

---

## 4. Architecture

> **Fat backend, thin frontend.** The collection flag is resolved entirely server-side (engine +
> finance model SQL); the client only renders the toggle in the property's iCal source form and
> the resulting state in the source table.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | `ALTER TABLE ical_sources ADD COLUMN collectsTouristTax INTEGER NOT NULL DEFAULT 1`; matching column in the `CREATE TABLE` for fresh installs. Idempotent (skips if column already exists). |
| `models/propertyIcalModel.js` | `propertyIcalModel.js` | T | `SOURCE_COLUMNS` lists the new column; `createSource` defaults to `1` unless the body explicitly says `false`/`0`; `updateSource` preserves the existing value when the body omits it. |
| `utils/pricing.js` | `pricing.js` | T | New `isPlatformCollectingTouristTax(db, propertyId, platformKey)` helper. The hardcoded `platform !== 'direct'` check is replaced by this lookup. The helper is defensive (`try/catch` on the SELECT to handle minimal test DBs). |
| `models/financeModel.js` | `financeModel.js` | T | `getTouristTaxExtraction` SQL `WHERE` now reads `r.platform = 'direct' OR EXISTS (SELECT 1 FROM ical_sources s WHERE s.propertyId = r.propertyId AND lower(s.platformKey) = lower(r.platform) AND s.collectsTouristTax = 0)`. |
| `controllers/propertyIcalController.js` | — | — | No change — controller passes `req.body` through; the model handles the new field. |
| `tests/` | `pricing-tourist-tax-platform-collection.unit.test.js` | C | Direct / collects=true / collects=false / no matching source / case-insensitive / missing table — 6 cases. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/PropertyDetail.js` | `PropertyDetail.js` | T | `EMPTY_ICAL_FORM.collectsTouristTax = true`; `startEditIcalSource` reads `source.collectsTouristTax`; `handleSaveIcalSource` forwards it in the payload; a new MUI `Switch` (label "La plateforme collecte la taxe de séjour" + explanatory caption that flips depending on state) is rendered under the source form. The iCal sources table gains a "Taxe collectée" column showing a `Plateforme` / `Vous` chip. |
| `pages/FinancePage.js` / Suivi page | — | — | No client change — the SQL filter already excludes the right rows. |
| `components/PricingSummary.js` | — | — | No client change — the component already renders the offered/charged state from the quote fields. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Switch`, `FormControlLabel`, `Chip` | Already used elsewhere in `PropertyDetail`. |
| **Created** | — | None. |
| **Specific (kept feature-local)** | The "Taxe collectée" `Chip` (two colours, two labels) inside the iCal sources table | Tied to this specific page; trivial composition of existing generics. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/properties/:id/ical-sources` | — | rows include `collectsTouristTax: 0/1` | unchanged endpoint, additional field. |
| POST | `/api/properties/:id/ical-sources` | `{ … , collectsTouristTax?: boolean }` | created row | defaults to `1` when omitted. |
| PUT | `/api/properties/:id/ical-sources/:sourceId` | `{ … , collectsTouristTax?: boolean }` | updated row | preserves existing value when omitted. |
| GET | `/api/finance/tourist-tax-extraction?month=YYYY-MM` | — | rows excluding "platform collects" non-direct reservations | filter logic changed; payload shape identical. |

---

## 5. Data model

`ical_sources` gains **`collectsTouristTax INTEGER NOT NULL DEFAULT 1`**. The `CREATE TABLE` is
updated and a guarded `ALTER TABLE` runs at boot for legacy installs. No backfill needed — the
default `1` matches the previous hardcoded rule, so existing rows behave identically until the
owner explicitly flips one to `0`.

## 6. UI / UX

- **Fiche logement → connexions iCal** (`/properties/:id`, section iCal):
  - Under the existing source form (Plateforme + URL + Couleur), a new `Switch` row appears with the
    label **"La plateforme collecte la taxe de séjour"** and a caption that switches with the state:
    - ON  → *"Le client paie la taxe à la plateforme ; vous ne la facturez pas et elle n'apparaît pas
      dans le Suivi taxe de séjour."*
    - OFF → *"Vous collectez la taxe vous-même ; elle s'ajoute au total et apparaît dans le Suivi
      taxe de séjour."*
  - The iCal sources table gains a **"Taxe collectée"** column with a `Chip`:
    - `Plateforme` (success/outlined) when `collectsTouristTax = 1`.
    - `Vous` (warning/outlined) when `collectsTouristTax = 0`.
- **Fiche réservation** — no visible change unless the user flipped a source to `0`, in which case
  the right-side `PricingSummary` automatically starts charging the tourist tax for that platform.
- **Suivi taxe de séjour** — same UI; only the underlying SQL filter expands to include non-direct
  reservations whose platform was flipped to "owner collects".
- **Responsive**: the `Switch` block and the new column stack on `xs` (MUI defaults are fine).

## 7. Test plan

### Server unit tests
- [x] `pricing-tourist-tax-platform-collection.unit.test.js` (6) — direct charges, default-collects,
      explicit-collects=false, no matching source falls back to collects, case-insensitive match,
      missing `ical_sources` table doesn't crash the engine.

### Manual UI verification
- [x] Property form — adding a new iCal source with the toggle ON, then OFF, then editing it back.
      The "Taxe collectée" chip flips.
- [ ] Reservation summary — for a manual reservation pointing at an Airbnb source flipped to
      `collectsTouristTax = 0`, the tourist-tax line is now charged in the right panel.
- [ ] Suivi taxe de séjour — the same reservation now appears in the monthly extraction; an Airbnb
      reservation on a property whose source is left at `1` still doesn't.

## 8. Out of scope

- No retroactive recompute of past reservations' stored `touristTaxTotal` / `touristTaxRate`. The
  engine only resolves the flag on live quotes / new saves.
- No per-reservation override (i.e. one airbnb stay where the owner wants to charge the tax even
  though the platform collects on the others). If needed, that's a future spec.
- No bulk "I want to flip all Airbnb sources on all properties" action — it's per-source by design,
  because the same platform can have different rules per property.

## 9. Open questions

(None — defaults agreed during implementation.)
