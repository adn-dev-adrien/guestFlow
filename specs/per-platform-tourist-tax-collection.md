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
5. The reservation `PricingSummary` reflects the resolved state from the quote (no hardcoded rule):
   - **Offered by platform** → tax line struck through + "✓ Offert" chip + "Collectée par la
     plateforme" caption.
   - **Owner-collected, non-direct (toggle OFF)** → tax line NOT struck through, with a caption
     "À collecter à l'arrivée (incluse dans le complément)". Tax amount is part of the **Total
     du séjour TTC** AND is scheduled in the **Complément à percevoir** bucket (see rule 7).
   - **Direct** → tax line NOT struck through; tax baked into the balance (legacy behaviour
     preserved).
6. **No retroactive recompute** on existing reservations: stored `touristTaxTotal` / `touristTaxRate`
   on past rows are left alone; only the live engine and the Suivi page use the new flag.
7. **Owner-collected tax on a non-direct platform is collected at check-in**, so it lives in the
   `Complément à percevoir` slot (added 2026-05-30):
   - `acompte` and `solde` are derived from `finalPrice` (stay excl. tax).
   - `complementAmount` starts with the tourist tax amount — **visible from save 1, not gated on
     deposit/balance being paid** (the legacy "extras added after both paid" gap is naturally
     additive on top, because the engine still computes complement as
     `totalStayPrice − resolvedDeposit − resolvedBalance`).
   - `totalStayPrice` still equals `finalPrice + touristTaxTotal` (no change).
   - `touristTaxCollectedOnArrival` is a new boolean returned by the quote so the UI can render
     the "À collecter à l'arrivée" caption without re-deriving the rule.
   - **Direct** bookings are NOT changed: tax stays in the balance, complement = 0 unless extras
     are added after the pre-arrival payments are frozen-paid.

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
| `models/propertiesModel.js` | `propertiesModel.js` | T | `getByIdWithDetails` SELECT for `icalSources` must include `collectsTouristTax` (otherwise the iCal sources table on `/properties/:id` shows the old "Plateforme" chip regardless of the saved value). Bugfix 2026-05-30. |
| `utils/pricing.js` | `pricing.js` | T | New `isPlatformCollectingTouristTax(db, propertyId, platformKey)` helper. The hardcoded `platform !== 'direct'` check is replaced by this lookup. The helper is defensive (`try/catch` on the SELECT to handle minimal test DBs). **2026-05-30:** when the resolved state is "non-direct + owner collects + tax > 0", the engine sets `touristTaxCollectedOnArrival = true`, uses `finalPrice` (not `totalStayPrice`) as the pre-arrival amount for `depositAmount` + `balanceAmount`, and routes the tax into `complementAmount` from save 1. Direct + platform-collect cases are unchanged. |
| `models/financeModel.js` | `financeModel.js` | T | `getTouristTaxExtraction` SQL `WHERE` now reads `r.platform = 'direct' OR EXISTS (SELECT 1 FROM ical_sources s WHERE s.propertyId = r.propertyId AND lower(s.platformKey) = lower(r.platform) AND s.collectsTouristTax = 0)`. |
| `models/accountingModel.js` | `accountingModel.js` | T | **2026-05-30:** `buildEntry` branches on `quote.touristTaxCollectedOnArrival`. When true: pro-rate deposit + balance against `finalPrice` (not `totalStayTtc`), and carve the tourist-tax portion out of the complement (`encaissementTtc -= touristTaxTotal`); if the residual is `0`, return `null` so the export drops the entry entirely. Direct + platform-collect cases unchanged. Matches the spec rule "tourist tax is excluded from the revenue accounts — it's reported via Suivi taxe de séjour". |
| `controllers/propertyIcalController.js` | — | — | No change — controller passes `req.body` through; the model handles the new field. |
| `tests/` | `pricing-tourist-tax-platform-collection.unit.test.js` | C | Direct / collects=true / collects=false / no matching source / case-insensitive / missing table — 6 cases. |
| `tests/` | `pricing-tourist-tax-on-arrival-schedule.unit.test.js` | C | 5 cases covering the new schedule logic (2026-05-30): non-direct owner-collect → tax in complement + acompte/solde on finalPrice; direct unchanged; platform-collect unchanged; depositPaid mid-state → balance recomputes against finalPrice; complementPaid → frozen. |
| `tests/` | `properties-model.unit.test.js` | T | Added regression test ensuring `getByIdWithDetails` exposes `collectsTouristTax` on each `icalSources` row (2026-05-30). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/PropertyDetail.js` | `PropertyDetail.js` | T | `EMPTY_ICAL_FORM.collectsTouristTax = true`; `startEditIcalSource` reads `source.collectsTouristTax`; `handleSaveIcalSource` forwards it in the payload; a new MUI `Switch` (label "La plateforme collecte la taxe de séjour" + explanatory caption that flips depending on state) is rendered under the source form. The iCal sources table gains a "Taxe collectée" column showing a `Plateforme` / `Vous` chip. |
| `pages/FinancePage.js` / Suivi page | — | — | No client change — the SQL filter already excludes the right rows. |
| `components/PricingSummary.js` | `PricingSummary.js` | T | **2026-05-30:** read `quote.touristTaxOfferedByPlatform` instead of the legacy hardcoded `platform !== 'direct'`; drop the `isIcalSource ? totalSejour - touristTaxTotal` strip (engine is now authoritative on the total); render an "À collecter à l'arrivée (incluse dans le complément)" caption when `quote.touristTaxCollectedOnArrival === true`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Switch`, `FormControlLabel`, `Chip` | Already used elsewhere in `PropertyDetail`. |
| **Created** | — | None. |
| **Specific (kept feature-local)** | The "Taxe collectée" `Chip` (two colours, two labels) inside the iCal sources table | Tied to this specific page; trivial composition of existing generics. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/properties/:id` | — | `icalSources[].collectsTouristTax: 0/1` | unchanged endpoint, additional field on the nested array (added 2026-05-30 to fix the table chip on `/properties/:id`). |
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
- **Fiche réservation** — when the user flipped a source to `0`, the right-side `PricingSummary`:
  - shows the tourist tax line **without** the strike-through (= same as a direct booking);
  - adds the caption **"À collecter à l'arrivée (incluse dans le complément)"** under the tax line
    (warning-coloured, italic);
  - sets **Acompte** and **Solde** to `finalPrice * %` and `finalPrice − acompte` (stay excl. tax)
    rather than `totalStayPrice * %` / `totalStayPrice − acompte`;
  - displays the **Complément à percevoir** block with the tax amount from save 1 (no need to
    wait for deposit + balance to be marked paid). If options are later added after deposit +
    balance are frozen-paid, those add to the complement on top of the tax.
  - **Total du séjour TTC** still equals `finalPrice + tax`.
  Direct bookings keep the legacy schedule (tax in the balance, complement = 0).
- **Suivi taxe de séjour** — same UI; only the underlying SQL filter expands to include non-direct
  reservations whose platform was flipped to "owner collects". *(Follow-up 2026-05-30: the month
  picker on `/finance/tourist-tax` was migrated to the shared `MonthYearPicker` component for
  visual coherence with `/comptabilite`.)*
- **Responsive**: the `Switch` block and the new column stack on `xs` (MUI defaults are fine).

## 7. Test plan

### Server unit tests
- [x] `pricing-tourist-tax-platform-collection.unit.test.js` (6) — direct charges, default-collects,
      explicit-collects=false, no matching source falls back to collects, case-insensitive match,
      missing `ical_sources` table doesn't crash the engine.
- [x] `properties-model.unit.test.js` — `getByIdWithDetails` exposes `collectsTouristTax` on each
      iCal source (regression guard, 2026-05-30).
- [x] `pricing-tourist-tax-on-arrival-schedule.unit.test.js` (5) — non-direct owner-collect routes
      tax into the complement and bases acompte/solde on `finalPrice`; direct + platform-collect
      unchanged; depositPaid mid-state recomputes balance against `finalPrice`; complementPaid
      freezes the stored value (2026-05-30).
- [x] `accounting-model-tourist-tax.unit.test.js` (7) — `buildEntry` regression: direct booking
      pro-rates against `totalStayTtc` (legacy); platform-collect pro-rates against `finalPrice`
      (no tax); owner-collect non-direct pro-rates deposit + balance against `finalPrice` (NOT
      `totalStayTtc`); complement = pure tax → entry dropped; complement = tax + extras → emit
      only the extras portion; direct legacy options-late complement unchanged; without extras,
      Σ emitted encaissements equals `finalPrice` (2026-05-30).

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
