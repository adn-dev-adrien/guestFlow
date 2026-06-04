# Devis PDF + tourist tax backend ownership — bug fix bundle

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/devis-pdf-and-tourist-tax-backend` |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Four user-reported bugs land in one bundle because they all live in the same
devis-generation flow:

1. **Devis PDF — "Date du devis" empty on recent devis.** Investigation against the
   local prod-copy DB confirms multiple recent devis rows have `createdAt = ''` (empty
   string, length 0) — example: devis #12102 (`devisNumber = 2026-06-001`) and #12097
   (`devisNumber = 2026-05-007`). The 3 INSERT paths in `devisModel.js` don't set
   `createdAt` so the SQLite `DEFAULT (datetime('now'))` *should* fire — but somewhere
   in the recent devis-reservation fusion era (`V02.00.x`) the default got bypassed for
   some rows. The PDF's line 154 reads `formatDateFR(full.createdAt ? full.createdAt.slice(0, 10) : '')`
   → empty value → empty pill. Fix: make the INSERT explicit AND make the PDF defensive
   for legacy bad-data rows.
2. **Devis PDF — "Valable jusqu'au" ignores the configured `quoteValidityDays`.**
   The `validUntil` column is **never populated** on any devis row in the DB (`SELECT
   validUntil FROM reservations WHERE kind='devis'` returns all NULL). The PDF then
   falls into the "synthesize from today + days" branch on every render, which (a)
   doesn't respect the persisted devis creation date (a devis issued 60 days ago shows
   a `Valable jusqu'au` always 30 days in the future), and (b) doesn't take advantage
   of the operator's `quoteValidityDays` setting in the way the operator expects (= a
   *fixed* validity from the **issue date**, not "today"). Fix: persist `validUntil` at
   devis create/update time = `createdAt + quoteValidityDays`, capped at `startDate - 2`.
3. **Property option defaults (e.g. `Linge de lit`) are NOT applied to new devis.**
   Confirmed against the same DB:
   ```sql
   property_option_defaults: propertyId=1 (Gite), optionId=6 (Linge de lit)
   ```
   But devis #12092, #12093, #12094, #12097, #12102 on property #1 — none have option
   #6 attached. The client (`ReservationPage.js`) calls
   `applyPropertyDefaultsAsync(initialPropId)` AFTER `setForm` + the initial
   `calculatePrice`, so the price is computed without the defaults; the defaults get
   merged into `selectedOptions` post-hoc but the engine never re-runs before the user
   can save. Worse: nothing on the server enforces the defaults — if the client never
   ships them in the payload (form bug, race condition, raw API call), the devis is
   saved without them. **Fix per "fat backend" architecture: enforce the property
   defaults server-side**, both in `devisModel.create` (devis path) and
   `reservationsController.create` (reservation path). The server merges any default
   option that's not already in the request payload, then computes the quote, then
   persists. Same fix protects both surfaces from any future client regression.
4. **Tourist tax displayed in the PDF is wrong.** The persisted `touristTaxTotal` on
   the row is correct (the pricing engine computes it at save time). The bug is in the
   PDF's **detail string** at `devisPdf.js:464-470`:
   ```js
   const taxablePersons = adults + children + teens;
   const taxNights      = diffDays(startDate, endDate);
   const taxRate        = Number(full.touristTaxRate || 0);
   const taxDetail      = `${persons} pers. × ${nights} nuits × ${rate} / pers./nuit`;
   ```
   `full.touristTaxRate` is the **base rate** (a percentage or a fixed amount,
   depending on the property's `touristTaxPercentage` / `touristTaxFixedAmount`
   columns). When the tax is configured as a percentage, this is e.g. `0.05` (5%) —
   NOT a per-person-per-night unit. The displayed string "3 pers. × 2 nuits × 0,05 € /
   pers./nuit" is meaningless. PricingSummary on the UI gets the correct breakdown
   from the live `quote.touristTaxUnitAmount` / `touristTaxAdultsCount` /
   `touristTaxNights` / `touristTaxLabel` fields the engine emits — but the PDF reads
   raw DB columns instead of calling the engine. Per user's request: "**ce montant
   doit être géré par le backend**" — fix: in `devisController.pdf`, call the same
   engine the API uses, pass the live quote alongside `full` and `settings` to
   `generateDevisPdf`, and have the PDF use quote fields (mirroring PricingSummary).

## 2. Goal

Generated devis PDFs show a correct issue date, a `Valable jusqu'au` that respects the
configured `quoteValidityDays` relative to the issue date, a property-default linen
option line for every property that has linen defaults, and a tourist-tax block whose
breakdown matches what the user sees on the live PricingSummary panel. The math behind
each of these lives on the server — no UI-side calculation.

## 3. Functional rules

### 3.1 Devis date du devis (Bug 1)

1. Every new devis is inserted with `createdAt = datetime('now')` set EXPLICITLY (the
   SQLite DEFAULT stays as a backstop). `devisModel.create` line 270's INSERT adds
   `createdAt` to the column list with `?` and binds `new Date().toISOString().slice(0,19).replace('T',' ')` →
   in the same SQLite format the default would have produced (e.g.
   `'2026-06-04 14:30:00'`).
2. `devisModel.convertFromReservation` (line 421) does the same.
3. `devisModel.convertToReservation` (line 384) does not need this — it inserts a
   `kind='reservation'` row, and reservations already track `createdAt` reliably.
4. The PDF's "Date du devis" pill (`devisPdf.js:154`) defensively falls back to
   `formatDateFR(today)` when `full.createdAt` is empty — handles the existing
   bad-data rows already in the DB. Documented in code that this is a legacy
   safeguard, not the canonical path.
5. **No backfill** for the few existing bad-data rows. The PDF fallback is enough; the
   issue date for those rows is genuinely unknown anyway.

### 3.2 Devis Valable jusqu'au (Bug 2)

6. At devis **create** time (`devisModel.create`), the model persists
   `validUntil = MIN(createdAt + quoteValidityDays, startDate - 2 days)` —
   - `createdAt` = today (ISO yyyy-mm-dd).
   - `quoteValidityDays` = `settingsModel.read().quoteValidityDays || 30`.
   - The cap at `startDate - 2 days` preserves the existing PDF logic (a devis can't be
     valid past the customer's check-in date minus a buffer).
7. At devis **update** time (`devisModel.update`), if the payload doesn't include a
   `validUntil` AND the existing row's `validUntil` is empty, the same formula
   applies. Otherwise the existing `validUntil` is preserved (the operator's manual
   override stays).
8. At devis **convert-from-reservation** time, `validUntil` is also persisted using
   the same formula.
9. The PDF reads `full.validUntil` straight, formats with `formatDateFR`, no
   fallback to "today + days". If `full.validUntil` is empty (legacy data), the PDF
   recomputes from `createdAt + quoteValidityDays` (the same formula the model uses).
10. The `quoteValidityDays` value the PDF reads comes from `settingsModel.read()` —
    same path as today.

### 3.3 Property defaults at devis creation (Bug 3)

11. New rule (server-side, in `devisModel.create`): **before computing the quote**,
    the model resolves the property's option defaults via
    `propertyOptionDefaultsModel.list(propertyId)` (function name TBC during impl —
    existing model exposes it) and merges any default `optionId` that's NOT already
    present in `payload.options` into the options array, with `quantity = 1` and
    `offered = default.offered`.
12. The merged options array is then passed to the engine. The persisted devis lines
    include the property-default options with the correct prices.
13. Same rule applies symmetrically to `reservationsController.create` (the
    reservation create path) so the same fix protects both surfaces. Client-side
    `applyPropertyDefaultsAsync` is unchanged (still convenient for UI display
    pre-save), but is no longer the contract — the server is the contract.
14. **No retroactive backfill.** Existing devis without their property defaults stay
    as they are; the operator amends them manually if desired. The fix is
    forward-only.

### 3.4 Tourist tax (Bug 4)

15. `devisController.pdf` calls `calculateReservationQuote(...)` (the same engine the
    API uses) with the persisted devis state to get a live `quote`. The quote
    includes `touristTaxUnitAmount`, `touristTaxAdultsCount`, `touristTaxNights`,
    `touristTaxLabel`, `touristTaxTotal`, `touristTaxOfferedByPlatform`.
16. `generateDevisPdf` accepts a third argument `quote` (additive, optional). When
    provided, the "Taxe de séjour" block uses quote-derived fields. When omitted (no
    caller migration), the legacy behaviour is preserved.
17. The detail string becomes:
    ```
    {touristTaxAdultsCount} pers. × {touristTaxNights} nuit(s) × {formatCurrency(touristTaxUnitAmount)} / pers./nuit
    ```
    Mirroring exactly what PricingSummary shows (PricingSummary §line 105–147).
18. **Touristic-tax-offered-by-platform** edge case: when the engine sets
    `quote.touristTaxOfferedByPlatform = true`, the PDF shows the strikethrough
    presentation parallel to PricingSummary (display the original amount, struck-
    through, plus the "Offert" / "Collectée par la plateforme" note). v1 ships the
    detail-string fix; the visual stylistic alignment with PricingSummary's strike-
    through can land in a follow-up if the demo reveals a need.
19. **No schema change** is required — the engine outputs the breakdown each time. The
    PDF doesn't persist breakdown fields.
20. **Consistency invariant — tax total + grand total must mirror the engine quote.**
    When the engine quote is provided, both the displayed "Taxe de séjour" line *and*
    the TOTAL TTC line are sourced from `quote.touristTaxTotal` + `quote.finalPrice` —
    never from the persisted `full.touristTaxTotal` / `full.finalPrice`, which may
    have drifted (e.g. user edited pricing then re-printed without saving). The
    pure helper `resolveLiveTaxTotals(full, quote)` (in `utils/devisPdf.js`) owns
    this resolution and is unit-tested. Fallbacks: no quote → row values; quote
    provided with `touristTaxTotal = 0` → row value wins (treated as "engine didn't
    compute"); `quote.finalPrice = 0` IS honoured (offered stay). Pinned by
    `tests/devis-pdf-date-validity-tax.unit.test.js` invariant block.

    *Bug context:* the user reported PDF tax = 15,36 € while PricingSummary showed
    16,80 € on the same reservation (percentage-based tax with a 10 % department
    surcharge). Root cause: the first fix wired the *detail string* through the
    engine but kept the displayed total + grand total on the persisted row, so the
    PDF said "8 pers. × 2 nuits × 1,05 € / pers./nuit" → 16,80 € in the detail but
    "Taxe de séjour 15,36 €" on the total line above it (internal contradiction).

**Edge cases:**

- **Devis created with no property defaults** (`property_option_defaults` empty for
  that propertyId) → merge yields no additions; the devis is created as today.
- **Devis created with a default option already explicitly in the payload** → the
  existing line wins (no duplicate). The merge guards `if (!existing.has(optionId))`.
- **`quoteValidityDays` = 0** in settings → the model persists `validUntil = createdAt`
  (same day). Edge but valid; the PDF shows `Valable jusqu'au {today}`. Operator
  warned via existing settings UI helper text.
- **Existing devis with `validUntil = NULL` opened post-fix** → the PDF's defensive
  recompute fires (`createdAt + quoteValidityDays`), so the operator sees a sensible
  value without the model needing a backfill.
- **Tourist tax offered by platform but persisted `touristTaxTotal = 0`** (the
  engine zeroes it for platform-collected per spec
  `per-platform-tourist-tax-collection`) → the PDF detail block is skipped just like
  today's `if (Number(full.touristTaxTotal || 0) > 0)` guard. No regression on direct
  reservations.

---

## 4. Architecture

### 4.1 Server side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | [server/src/models/devisModel.js](server/src/models/devisModel.js) | T | (a) `create` + `convertFromReservation` INSERTs add explicit `createdAt = datetime('now')` binding + `validUntil` = `createdAt + quoteValidityDays` (capped). (b) `create` merges property defaults into the options array before computing the quote. (c) `update`: idempotent recompute of `validUntil` when the row's value is empty. |
| `models/` | [server/src/models/propertyOptionDefaultsModel.js](server/src/models/propertyOptionDefaultsModel.js) | — | Reused as-is. Already exposes a `list(propertyId)` helper (or similar). |
| `controllers/` | [server/src/controllers/reservationsController.js](server/src/controllers/reservationsController.js) | T | `create` merges property defaults into the options array before computing the quote — same logic as the devis path. |
| `controllers/` | [server/src/controllers/devisController.js](server/src/controllers/devisController.js) | T | `pdf` calls `calculateReservationQuote(...)` on the persisted devis state to get a live quote, passes it as a third arg to `generateDevisPdf`. |
| `utils/` | [server/src/utils/devisPdf.js](server/src/utils/devisPdf.js) | T | (a) `generateDevisPdf(full, settings, quote)` — `quote` is optional, additive. (b) `Date du devis` pill falls back to today when `full.createdAt` is empty (legacy guard). (c) `Valable jusqu'au` uses `full.validUntil` when set, recomputes from `createdAt + quoteValidityDays` (legacy guard). (d) `Taxe de séjour` block reads from `quote` when provided. |
| `utils/` | [server/src/utils/pricing.js](server/src/utils/pricing.js) | — | No change. Already emits the breakdown fields the PDF needs. |

### 4.2 Client side

No mandatory edit. The existing `applyPropertyDefaultsAsync` flow in `ReservationPage.js`
still pre-fills the form for UI visibility, but it's no longer the contract. The server
is.

If desired (out of scope here): we could remove the client-side merge entirely and rely
on the server to surface the defaults via the quote response. Out of scope for v1 — the
client merge is harmless and improves UX (no flash of empty-options state).

### 4.3 API contract

No change. Same endpoints, same payloads. The server now does more on `POST
/api/devis` and `POST /api/reservations` (property-defaults merge) but the request
contract is unchanged.

---

## 5. Data model

No schema change. `createdAt` and `validUntil` columns already exist on `reservations`.

**Data impact**: forward-only. Existing devis with bad/empty `createdAt` or NULL
`validUntil` are handled defensively by the PDF (legacy guard); no backfill SQL runs.

## 6. UI / UX

No UI change beyond the PDF output itself. The user sees:

- "Date du devis": always populated (= `createdAt` in `dd/mm/yyyy`, or today as last
  resort).
- "Valable jusqu'au": respects the persisted `validUntil` (from `createdAt +
  quoteValidityDays`).
- Tourist tax breakdown: matches PricingSummary.
- Linen options (or any property default): always present on devis lines.

---

## 7. Test plan — explicit non-regression coverage per user request

### 7.1 Server unit tests (new)

| Test file | Cases | Pins |
|---|---|---|
| `tests/devis-model-createdAt-and-validUntil.unit.test.js` (C) | (1) `create` persists `createdAt` explicitly. (2) `create` persists `validUntil = createdAt + settings.quoteValidityDays`. (3) `create` caps `validUntil` at `startDate - 2 days`. (4) `update` fills missing `validUntil`. (5) `convertFromReservation` persists both. | Rules 1–9. |
| `tests/devis-model-property-defaults.unit.test.js` (C) | (1) `create` merges property default options not in the payload. (2) Default option already present in the payload → no duplicate. (3) No property defaults configured → behaviour unchanged. (4) Default offered flag is propagated. | Rules 11–13. |
| `tests/reservations-controller-property-defaults.unit.test.js` (C) | Same shape as the devis test, for the reservation path. Pins rule 13. | Rule 13. |
| `tests/devis-pdf-date-and-validity.unit.test.js` (C) | (1) Empty `full.createdAt` → "Date du devis" defaults to today. (2) Empty `full.validUntil` → recomputed from `createdAt + quoteValidityDays`. (3) `validUntil` capped at `startDate - 2`. (4) Both populated → strings round-trip via `formatDateFR`. | Rules 4 + 9 + cap. |
| `tests/devis-pdf-date-validity-tax.unit.test.js` (C) | (1) `computeValidUntil` helper unit cases (rules 6 + 9 + cap). (2) PDF render smoke per scenario (rules 4, 9, 16, 18) — assert the magic header + a non-trivial buffer size. (3) **Consistency invariant** via `resolveLiveTaxTotals(full, quote)`: live tax total + grand total mirror `quote.touristTaxTotal` / `quote.finalPrice` when provided, fall back to row values otherwise, treat `touristTaxTotal = 0` in the quote as "engine didn't compute" (row wins), honour `quote.finalPrice = 0` (offered stay). | Rules 4, 6, 9, 15–18, **20**. |

These tests focus on the model + the utility — not the live PDF render (PDFs are
binary; we assert the inputs the renderer would receive and the strings the renderer
would draw via direct calls on the helpers).

### 7.2 Existing server unit suite

Stays green. ~880 tests already pin the engine + accounting + iCal + linen.

### 7.3 Client Vitest tests (added on the Vite-migration branch, 2026-06-04)

| Test file | Cases | Pins |
|---|---|---|
| `client/src/components/__tests__/PricingSummary.tourist-tax.test.js` (C) | (1) Displayed tax total reads `quote.touristTaxTotal`, never `form.touristTaxTotal`. (2) Detail breakdown reads `touristTaxUnitAmount × touristTaxAdultsCount × touristTaxNights` from the engine. (3) Engine zero overrides a stale form value. (4) Quote omitted (initial load) → legacy fallback to `form.touristTaxTotal`. (5) `touristTaxLabel` rendered verbatim, never re-derived. | Rules 17, 20 — client-side mirror of the PDF parity invariant. |
| `client/src/utils/applyQuoteToForm.test.js` (4 new cases appended) | (1) Engine `touristTaxTotal` overwrites the stale form value on every recompute (user's 15,36 € → 16,80 € scenario). (2) Engine zero overrides a non-zero form value. (3) `touristTaxRate` is copied verbatim. (4) Null/undefined engine values map to 0 (no NaN leak). | Rule 20 — the helper that bridges the API response to the form state. |

Both files run under Vitest (CRA → Vite migration branch). They pin the
client-side equivalent of the PDF parity rule: the engine quote owns the math;
the UI only consumes its fields. Any future refactor that introduces a JS
re-derivation of the tax (from `touristTaxRate × people × nights` or similar)
fails these tests immediately.

### 7.4 E2E suite (PR #110)

Stays green. The Playwright smoke suite covers Dashboard + routing + persistence
round-trips; the devis-PDF tests above sit at the unit level for precision.

### 7.4 Manual smoke after merge

- [ ] Create a new devis for a property with linen defaults → the line appears on the
      saved devis + on the PDF.
- [ ] Set `quoteValidityDays = 7` in Settings; create a new devis; download the PDF
      → "Valable jusqu'au" shows today + 7 days (capped at startDate - 2).
- [ ] Open an existing devis (with NULL `validUntil`) and download the PDF → the PDF
      shows a recomputed validity date (legacy guard) — confirms forward-only safety.
- [ ] Tourist tax PDF detail matches what PricingSummary shows for the same devis.

---

## 8. Out of scope

- Backfilling the existing rows with empty `createdAt` or NULL `validUntil`. The PDF
  guards handle them.
- Removing the client-side `applyPropertyDefaultsAsync` (still useful for UX).
- Aligning the PDF's strike-through styling with PricingSummary's "Offert"
  presentation (visual parity follow-up).
- Persisting the tourist-tax breakdown fields on the row. The engine recomputes; no
  schema drift.
- Devis numbering / sequence resets.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q: Should the server-side property-defaults merge fire on `convertFromReservation`
  too?
  - A: Yes — keep behaviour symmetric. If a reservation has its property defaults
    explicitly removed before conversion, the operator can re-remove them after
    conversion. The default merge is non-destructive.
- Q: Should we surface a warning in the PDF (or via a Dashboard alert) when a devis
  has `createdAt = ''` / `validUntil = NULL` (legacy bad data)?
  - A: No. Silent fallback is enough; the operator can't act on it.
