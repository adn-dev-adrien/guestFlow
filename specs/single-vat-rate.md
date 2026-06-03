# Single VAT rate — collapse the 10 % / 20 % split to one 10 % rate everywhere

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/single-vat-rate` |
| **Created** | 2026-06-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The Settings page currently exposes **two VAT rates**: `vatRateAccommodation`
(default 10 %, applied to the nights bucket) and `vatRateStandard` (default 20 %, applied to
options / resources / custom options). The split was modelled after the general French VAT
regime where standard goods/services fall under 20 %, but per the comptable's review
**every revenue stream on GuestFlow is invoiced under the reduced 10 % rate** (the entire
guesthouse offer is treated as one hospitality service). The 20 % branch is therefore
unused in this configuration and silently produces wrong VAT entries on the accounting
export + wrong VAT lines on the devis PDF.

The dual-rate plumbing reaches into:
- Settings (DB schema, model, controller, validation, client form).
- Pricing engine: `getGlobalVatRates`, per-bucket VAT extraction in `calculateReservationQuote`.
- Finance reporting: `financeModel` joins `accommodationVatRate` per row.
- Accounting model: `bucketFromTtc('accommodation', …, rate)` × `bucketFromTtc('options', …, rate)`.
- Accounting export: `vatByRate` grouping + `vatAccountForRate(rate)` (10 % → `44571100`,
  20 % → `44571200`).
- Devis PDF: 3 rate variables (`vatAccommodation`, `vatOptions`, `vatResources`) threaded
  through every line render + the totals block.
- Client UI: `SettingsVatSection` form (two fields), `PricingSummary` (three VAT lines).
- Server tests pinning the dual-rate contract (18 files).

Per the discussion (2026-06-03):
- **Editable** — the single rate stays a Settings field, not a hardcoded constant, so a
  future regulatory shift is a one-field change instead of a code release.
- **Retroactive** — historical reservations re-export at 10 % too; the 20 % era is treated
  as a misconfiguration to be unwound, not a historical truth to preserve.

## 2. Goal

GuestFlow exposes **one editable VAT rate** (default 10 %) used uniformly for accommodation,
options, resources, custom options, and the devis PDF. The accounting export emits a single
VAT line per encaissement, mapped to the existing reduced-rate GL account (`44571100`). No
piece of UI or document mentions "TVA 20 %" anywhere any more. Existing reservations
re-export with the new rate without any backfill required (the rate is computed live by the
pricing engine from current settings).

## 3. Functional rules

1. **One global VAT rate**, stored in `app_settings.vatRate` (REAL, NOT NULL, DEFAULT 10).
2. The legacy `app_settings.vatRateAccommodation` and `app_settings.vatRateStandard` columns
   are **dropped** on migration. A pre-migration backfill seeds `vatRate` from the
   existing `vatRateAccommodation` value (i.e. the previous accommodation rate wins, which
   for prod is the 10 % already in place — no behavioural surprise).
3. **Settings UI**: `SettingsVatSection` renders a single field "Taux de TVA (%)" with
   helper text "Appliqué à l'ensemble des prestations : hébergement, options, ressources.".
   The form state collapses from `vat: { accommodationRate, standardRate }` to
   `vat: { rate }`. Validation: integer or decimal between 0 and 100 (existing
   `validateVatRate` reused).
4. **Pricing engine** (`server/src/utils/pricing.js`):
   - `getGlobalVatRates(db)` is renamed `getGlobalVatRate(db)` and returns a single number.
   - `calculateReservationQuote` writes the same rate to `vatPercentageAccommodation`,
     `vatPercentageOptions`, `vatPercentageResources` in the returned quote. The three
     field names stay in the quote payload so that downstream readers
     (accounting model, devis PDF, PricingSummary) keep working without a wider sweep —
     they all just receive the same value across the three keys.
   - The per-bucket VAT extraction (`TTC × rate / (100 + rate)`) is unchanged structurally;
     it just uses one rate for every bucket now.
5. **Finance reporting** (`financeModel`): the `accommodationVatRate` column in row
   payloads now reads `COALESCE((SELECT vatRate FROM app_settings WHERE id = 1), 10)`. The
   key name stays so the client doesn't need a wider rename.
6. **Accounting model** (`accountingModel.js`):
   - `bucketFromTtc('accommodation', …, rate)` + `bucketFromTtc('options', …, rate)` keep
     producing two TYPED buckets (so the audit / journal text still differentiates an
     accommodation bucket from an options bucket — useful for the bookkeeper). Both
     buckets receive the SAME rate from the quote.
   - The buckets aggregate into ONE VAT line per encaissement because `vatByRate` keys on
     the rate value (rule 7).
7. **Accounting export** (`accountingExport.js`):
   - `vatByRate` keys on `rate.toFixed(2)`. With both buckets carrying the same rate, the
     map collapses to a single key → one VAT GL line per encaissement, on account
     `44571100` (REDUCED_10).
   - `vatAccountForRate(rate)` is kept (one-line function) — it still resolves any future
     rate cleanly. The legacy `STANDARD_20` constant and `'TVA 20 %'` label stay defined
     but become unused; we keep them so an export of an arbitrary rate (e.g. 20 % rate is
     ever set in Settings via the editable field) still maps correctly. **No business
     logic depends on the 20 % rate any more.**
8. **Devis PDF** (`devisPdf.js`):
   - `vatAccommodation`, `vatOptions`, `vatResources` collapse to one `vatRate` constant
     read from settings. Every `drawRow(...)` call uses `vatRate`. The "TVA %" column
     header + the totals "TOTAL TVA … %" footer show the single rate.
9. **PricingSummary** (`PricingSummary.js`):
   - The three "Hébergement (HT + TVA X %)", "Options (HT + TVA Y %)", "Ressources (HT +
     TVA Z %)" lines collapse to a single "TVA {rate} %" line summing the three bucket
     HT/VAT amounts. The HT-by-bucket breakdown is dropped — the comptable doesn't need
     it any more since the rate is the same everywhere. (The PricingSummary already shows
     the HT per category in the body; the VAT footer just aggregates one line now.)
10. **Tourist tax** stays at 0 % VAT (it is not VAT-able under French tourism law). No
    change to the tourist-tax bucket here.
11. **Idempotent migration** — re-running the migration on a DB that already has `vatRate`
    is a no-op. The DROP COLUMN of the legacy fields runs only when they still exist.
12. **No backfill of historical encaissements is needed**. Every export / PDF re-derives
    the rate live from current settings (per the retroactive decision). Past
    `reservation_history` audit entries that mention the old rate are left untouched
    (immutable audit trail of what was configured at the time).

**Edge cases:**
- **User edits `vatRate` mid-flight** while a reservation is being created → the engine
  reads the latest value on every `calculateReservationQuote` call. The reservation's
  finance state recomputes with the new rate on its next save. Same as today.
- **A historic reservation paid under the 20 % era is re-exported** → it exports at the
  new rate (10 %). This is the explicit retroactive choice. The accounting export's CSV
  emits one VAT line at 10 %, on `44571100`. The total stays unchanged (TTC is the
  truth); only the HT / VAT split shifts. The comptable receives a coherent ledger.
- **Settings rate set to 0 %** → the quote engine treats every bucket as pure HT (VAT
  extraction `TTC × 0 / 100 = 0`). The accounting export still emits TTC; the VAT line
  drops to 0 amount.
- **Settings rate set above 20 %** → the editable field accepts any 0–100; the rate
  flows through, `vatAccountForRate` falls back to STANDARD_20 (still mapped to
  `44571200`). Documented as a "you can set any rate, but only 10 % and 20 % have a
  canonical GL account" caveat in the validator helper text.
- **A reservation paid under the 20 % era, opened by the user, saved without changes** →
  the pricing engine recomputes the quote with the new 10 % rate. `complementAmount` may
  drift slightly (the HT / VAT shifts the rounding by a cent or two); the existing
  per-line contrib capture (force-item-to-complement) preserves the persisted
  acompte/solde amounts and only the new entry (Complément) absorbs the delta.

---

## 4. Architecture

### 4.1 Server side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | [server/src/database.js](server/src/database.js) | T | New idempotent block: `ALTER TABLE app_settings ADD COLUMN vatRate REAL NOT NULL DEFAULT 10`; backfill from `vatRateAccommodation` if present; `ALTER TABLE app_settings DROP COLUMN vatRateAccommodation`; `ALTER TABLE app_settings DROP COLUMN vatRateStandard`. SQLite ≥ 3.35 supports DROP COLUMN; the Pi's bundled version is well above. |
| `models/settingsModel.js` | T | Columns list collapses `vatRateAccommodation` + `vatRateStandard` → single `vatRate`. Default 10. |
| `controllers/settingsController.js` | T | `VAT_FIELDS` collapses to `[{ input: 'rate', column: 'vatRate', validator: validateVatRate }]`. |
| `utils/settingsValidation.js` | — | `validateVatRate(value)` unchanged (already 0–100). |
| `utils/settingsResponse.js` | T | `vat` block in the response goes from `{ accommodationRate, standardRate }` to `{ rate }`. |
| `utils/pricing.js` | T | Rename `getGlobalVatRates` → `getGlobalVatRate(db)` returning a single number. `calculateReservationQuote` writes the same value to all three `vatPercentage*` quote keys. Per-bucket extraction unchanged structurally. |
| `models/financeModel.js` | T | The SELECT join collapses to `COALESCE((SELECT vatRate FROM app_settings WHERE id = 1), 10) as accommodationVatRate`. Returned key name kept for client compat. |
| `models/accountingModel.js` | — | No code change. Both `bucketFromTtc('accommodation', …)` + `bucketFromTtc('options', …)` calls receive the same rate from the quote and collapse cleanly in `vatByRate`. |
| `utils/accountingExport.js` | — | No code change. `vatByRate` collapses naturally to one key. `vatAccountForRate` kept as a one-line resolver (still useful as a guardrail). |
| `constants/accounting.js` | — | No code change — `STANDARD_20` / `REDUCED_10` constants stay; `vatAccountForRate` stays. They cost nothing and protect against future rate divergence. |
| `utils/devisPdf.js` | T | Three rate variables collapse to one `vatRate`. Every `drawRow(...)` call uses `vatRate`. Totals footer uses `vatRate`. |

**Notes:**
- Keep the `vatPercentageAccommodation` / `vatPercentageOptions` / `vatPercentageResources`
  keys in the quote payload — the downstream readers (devisPdf, accountingModel, finance
  reporting) keep their existing access patterns and just receive the same value across all
  three keys. This is deliberate: we do not chase the rename across 5+ files when the
  collapse is semantically correct already.
- No new dependencies.

### 4.2 Client side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/SettingsPage.js` | T | Form default goes from `vat: { accommodationRate: 10, standardRate: 20 }` to `vat: { rate: 10 }`. Field mapping updated to `rate → vatRate`. |
| `components/SettingsVatSection.js` | T | Renders ONE TextField "Taux de TVA (%)" instead of two. Helper text: "Appliqué à l'ensemble des prestations : hébergement, options, ressources.". |
| `components/PricingSummary.js` | T | The three "Hébergement (HT + TVA X %)" / "Options (HT + TVA Y %)" / "Ressources (HT + TVA Z %)" lines collapse to one "TVA {rate} %" line summing the three bucket HT/VAT amounts. Defaults updated (`?? 10`). |
| `pages/AccountingPage.js` | — | No change (the `vat` color constant for the chip label is rate-agnostic). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `TextField`, `Typography`. | No new components needed. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `SettingsVatSection`. | Single-field section; not a candidate for generic extraction. |

### 4.3 API contract

Settings payload changes:

| Endpoint | Before | After |
|---|---|---|
| `GET /api/settings` | `{ vat: { accommodationRate: 10, standardRate: 20 } }` | `{ vat: { rate: 10 } }` |
| `PUT /api/settings` | accepts `{ vat: { accommodationRate, standardRate } }` | accepts `{ vat: { rate } }` |

Quote payload (`/api/reservations/:id/quote` etc.) — **unchanged shape**, just the three
`vatPercentage*` fields now always hold the same value.

---

## 5. Data model

```sql
-- New column (idempotent ADD if missing):
ALTER TABLE app_settings ADD COLUMN vatRate REAL NOT NULL DEFAULT 10;

-- Backfill from the legacy accommodation column (since prod has 10 % there):
UPDATE app_settings SET vatRate = vatRateAccommodation
  WHERE vatRateAccommodation IS NOT NULL;

-- Drop the legacy columns:
ALTER TABLE app_settings DROP COLUMN vatRateAccommodation;
ALTER TABLE app_settings DROP COLUMN vatRateStandard;
```

Migration block sits in [server/src/database.js](server/src/database.js) next to the other
`app_settings` migrations. Each step guarded by an `if (!cols.includes(...))` check (ADD)
or `if (cols.includes(...))` check (DROP) so re-runs are no-ops.

**Data impact:**
- The single existing row in `app_settings` keeps its `vatRateAccommodation` value (10 in
  prod) under the new `vatRate` column.
- `vatRateStandard` (20 in prod) is dropped — the value is lost. **Acceptable** because the
  retroactive decision rules that 20 % was a misconfiguration: future exports use 10 %
  including for historical encaissements. The audit trail in `reservation_history` is
  unchanged (immutable).
- Pre-migration backup: the deploy workflow already creates a SQLite backup before
  migrations, so a rollback is one `cp backup-xxx.db guestflow.db` away if anything goes
  sideways.

## 6. UI / UX

### 6.1 Settings — VAT section

```
┌─ TVA ─────────────────────────────────────────────────────────────┐
│                                                                   │
│  Taux de TVA (%)    [ 10                  ]                       │
│                                                                   │
│  Appliqué à l'ensemble des prestations : hébergement, options,    │
│  ressources.                                                      │
└───────────────────────────────────────────────────────────────────┘
```

- One TextField with `type="number"` step `0.5`.
- Validation: 0–100; required.
- The two-column layout of `SettingsVatSection` collapses to a single row.

### 6.2 PricingSummary VAT footer

Before:
```
Hébergement (HT 200,00 € + TVA 10 %)         220,00 €
Options (HT 50,00 € + TVA 20 %)               60,00 €
Ressources (HT 30,00 € + TVA 20 %)            36,00 €
                                  TOTAL TTC  316,00 €
```

After:
```
Hébergement                          220,00 €
Options                               60,00 €
Ressources                            36,00 €
TOTAL HT                             287,27 €
TVA 10 %                              28,73 €
TOTAL TTC                            316,00 €
```

- The bucket lines stay as TTC totals (no HT/VAT split per bucket).
- A single "TVA {rate} %" line at the bottom of the totals block shows the aggregated VAT
  amount.

### 6.3 Devis PDF

- The "TVA %" column on each line shows the single rate.
- The totals block shows one "TVA {rate} %" line and one "TOTAL TTC" line.
- The accounting export PDF (already legacy-light) does not need changes — the underlying
  rate from the quote already collapses.

### 6.4 Accounting export CSV

- One VAT credit line per encaissement on account `44571100` (TVA 10 %).
- No more "TVA 20 %" lines anywhere in the CSV.

### 6.5 Responsive

- Settings field stays single-column on `xs` (already was).
- PricingSummary footer collapses cleanly on mobile (less vertical real estate, same
  legibility).

### 6.6 Page action bar

No change.

---

## 7. Test plan

### Server unit tests

- [ ] [tests/settings-model.unit.test.js](server/src/tests/settings-model.unit.test.js) — DDL fixture updated: `vatRate REAL NOT NULL DEFAULT 10`; remove the two legacy columns. Existing assertions adapted.
- [ ] [tests/settings-controller-vat.unit.test.js](server/src/tests/settings-controller-vat.unit.test.js) — IF a controller test exists for VAT, collapses to one field. Otherwise covered by the model test.
- [ ] [tests/pricing-vat-two-rates.unit.test.js](server/src/tests/pricing-vat-two-rates.unit.test.js) — **renamed to `pricing-vat-single-rate.unit.test.js`**; collapses every two-rate assertion. Adds new cases: same rate writes to all three `vatPercentage*` keys; engine reads `vatRate` column (not the legacy two).
- [ ] [tests/accounting-export.unit.test.js](server/src/tests/accounting-export.unit.test.js) — single VAT line per encaissement on `44571100`; the legacy `'10 % → 44571100, 20 % → 44571200'` test stays but becomes a `vatAccountForRate` unit test (the resolver is still exercised in case the rate is ever set differently).
- [ ] [tests/accounting-per-line-contribs.unit.test.js](server/src/tests/accounting-per-line-contribs.unit.test.js) — fixture rates collapse; assertions adapted.
- [ ] [tests/accounting-model-tourist-tax.unit.test.js](server/src/tests/accounting-model-tourist-tax.unit.test.js) — fixture rates collapse; tourist tax stays at 0 % VAT.
- [ ] [tests/finance-calcs.unit.test.js](server/src/tests/finance-calcs.unit.test.js) — every case with `accommodationVatRate: 20` rewrites to `10`; every "options at 20 %" assertion drops.
- [ ] [tests/devis-pdf.unit.test.js](server/src/tests/devis-pdf.unit.test.js) — settings fixture: `vatRate: 10`. Output assertions verify a single "TVA 10 %" line in the totals.
- [ ] [tests/pricing-auto-options.unit.test.js](server/src/tests/pricing-auto-options.unit.test.js) — comments/fixtures updated.
- [ ] [tests/pricing-deposit-disabled.unit.test.js](server/src/tests/pricing-deposit-disabled.unit.test.js) — fixtures updated.
- [ ] [tests/pricing-deposit-disabled-x-force-complement.unit.test.js](server/src/tests/pricing-deposit-disabled-x-force-complement.unit.test.js) — fixtures updated.
- [ ] [tests/pricing-complement.unit.test.js](server/src/tests/pricing-complement.unit.test.js) — fixtures updated.
- [ ] [tests/pricing-tourist-tax-platform-collection.unit.test.js](server/src/tests/pricing-tourist-tax-platform-collection.unit.test.js) — fixtures updated.
- [ ] [tests/pricing-tourist-tax-on-arrival-schedule.unit.test.js](server/src/tests/pricing-tourist-tax-on-arrival-schedule.unit.test.js) — fixtures updated.
- [ ] [tests/pricing-force-and-snapshot.unit.test.js](server/src/tests/pricing-force-and-snapshot.unit.test.js) — fixtures updated.
- [ ] [tests/accounting-csv-solio-format.unit.test.js](server/src/tests/accounting-csv-solio-format.unit.test.js) — comment "VAT 20 %" updates to 10 %; assertions adapt.
- [ ] [tests/accounting-encaissements-integration.unit.test.js](server/src/tests/accounting-encaissements-integration.unit.test.js) — fixtures adapt.

Test count delta: net **0** new files (most are edits). One file rename. Approximate
assertion delta: ~80 assertions adapted across the 18 files.

### Manual UI verification

- [ ] Settings → Paramètres → TVA section shows ONE field "Taux de TVA (%)" pre-filled at
      10. Change to 12, save → reload, value persists.
- [ ] Create a new reservation with options + a resource → PricingSummary shows ONE "TVA
      10 %" line in the totals; no per-bucket VAT split; totals match.
- [ ] Download the devis PDF → "TVA %" column shows 10 % for every line; totals block
      shows one "TVA 10 %" line.
- [ ] Export the accounting CSV for a paid reservation → one VAT credit line on
      `44571100`; no `44571200` entries.
- [ ] Re-export a HISTORIC reservation (paid pre-change with 20 % standard) → also emits
      one VAT line at 10 % on `44571100`. Total TTC unchanged; HT / VAT split shifts.
- [ ] Set the rate to 0 % temporarily → quote shows TOTAL HT = TOTAL TTC, VAT line at 0 €;
      export emits a 0-amount VAT line.
- [ ] Set the rate to 20 % temporarily → export emits a VAT line on `44571200`
      (STANDARD_20), proving the `vatAccountForRate` resolver still works.
- [ ] Mobile (`xs`): Settings field reachable; PricingSummary totals stack cleanly.

---

## 8. Out of scope

- **Per-line VAT rate snapshot on reservations**: would let historical exports preserve
  the original rate. Explicitly rejected per the "retroactive" decision (rule 12 + edge
  case "historic reservation re-export"). A future spec can re-introduce this if the
  comptable changes course.
- **VAT exemption for specific options** (e.g. a partner activity invoiced separately):
  current engine treats every revenue stream under the single rate. Per-line exemption
  flags (similar to `inComplement`) are a separate concern.
- **VAT rate per platform / per reservation type**: not needed today; a future spec if
  ever.
- **Renaming `vatPercentageAccommodation` / `vatPercentageOptions` / `vatPercentageResources`
  keys in the quote payload**: kept as-is to limit blast radius. They all carry the same
  value now.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q: Should we delete `STANDARD_20` and the `vatAccountForRate` 20 % branch entirely
  (instead of keeping them as dormant guardrails)?
  - A: Kept dormant. They cost nothing and act as a safety net if the user temporarily
    sets the rate to 20 % via the editable field — the export still maps to the right GL
    account.
- Q: Do we need to surface the rate change in `CHANGELOG.md / Migration` section?
  - A: Yes — the schema changes (DROP COLUMN ×2 + ADD COLUMN) are documented + the
    backfill behaviour pinned.
