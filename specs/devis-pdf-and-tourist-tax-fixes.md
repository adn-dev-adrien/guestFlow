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
   - **Reading 2026-11-08 (audit R30-RES-M1) — never before the issue day.** The result is floored at
     `createdAt`: `validUntil = MAX(createdAt, MIN(createdAt + quoteValidityDays, startDate - 2 days))`
     (`utils/devisValidity.js` `computeValidUntil`, the one helper of create, update, « Prolonger » and
     « Transformer en devis », and of the PDF fallback of rule 9). A stay starting tomorrow or today (the
     site accepts an arrival from today on) used to be capped before the issue day: the quote was « Périmé
     · prolonger » a second after its creation, its PDF said « Valable jusqu'au » and « À payer avant » the
     day before its own date, its prices were never locked, and « Prolonger » answered 200 leaving it
     expired, endlessly. Such a quote now stands, and is due (specs/deposit-blocks-the-dates.md rule 7),
     on the day it is issued; « Prolonger » re-issues it until that day, and is not offered once it holds.
     Tests: `tests/devis-last-minute-validity.unit.test.js`, `plugins/website-booking/tests/public-request-last-minute-validity.unit.test.js`.
7. At devis **update** time (`devisModel.update`), if the payload doesn't include a
   `validUntil` AND the existing row's `validUntil` is empty, the same formula
   applies. Otherwise the existing `validUntil` is preserved (the operator's manual
   override stays).
   > **Reading R31-RES-M1 (2026-11-08).** A still-valid quote moved to earlier dates kept its stored
   > date, so the quote, its PDF and its single payment said « pay by » a date after the arrival. The
   > preserved date is now read against the new start (`validUntilForStart`): at most `startDate − 2`,
   > floored at today so the move never expires it (rule 6 reading R30). A quote moved later keeps its
   > date. The same reading feeds the live quote of an unsaved edit. Tests:
   > `tests/devis-moved-earlier-validity.unit.test.js`.

   > **Reading R32-RES-M1 (2026-11-09) — one resolver for every save and preview.** The R31 reading only ever lowered
   > the stored date: a quote moved earlier then back (a mistyped arrival corrected) kept the lowered date, so its PDF
   > and its single payment said « avant le » today for a stay weeks away, and it expired that night. And its last
   > sentence was not true: the fiche's live quote (`POST /reservations/calculate-price` with `devisId`) read the raw
   > stored date, so the preview announced a deadline after the arrival (or, for an expired quote, in the past) that the
   > save then changed. `utils/devisValidity.js` `devisValidUntil` is now the one reading of `devisModel.update`, of the
   > engine input of `computeQuote` (create, `recomputeQuote` for the PDF and the payment links), of the live quote
   > (`scheduleQuoteInputs` with the edited start) and of the read (`findById`, the PDF, the schedule `findById`
   > answers). From the stored date, the stored start, the creation day, the start asked for, today and
   > `quoteValidityDays`:
   >
   > | Stored date | Start | Validity |
   > |---|---|---|
   > | none (legacy) | any | rule 7's backfill: `computeValidUntil` from the creation day |
   > | expired | any | a save and its preview re-issue it from today (devis-extras-parity rule 14); a read keeps it |
   > | valid | unchanged | the stored date, capped at `max(today, start − 2)` (reading R31-RES-M1) |
   > | valid | moved | MAX(stored, `computeValidUntil` from the creation day for the new start), capped at `max(today, start − 2)` |
   >
   > The MAX keeps a later window (« Prolonger », an API override) and gives back, on a move back, what an earlier move
   > took; the cap's floor at today keeps a move from ever expiring a valid quote (rule 6 reading R30). A quote moved
   > later from a near creation gets the window its creation day gives the new dates. Unchanged dates write the stored
   > date again, so a save is idempotent and a later change of « Validité des devis » touches no quote that did not
   > move. The live quote answers the date as `validUntil` and the PUT answers it with `expired` / `extendable`: the
   > fiche's chip shows the first while the edit is unsaved and applies the second once saved, and a quote the save
   > re-issued is re-read so its price lock follows (§6). *Known and accepted (D22, Adrien 2026-11-09):* the day « Prolonger » opened a window is
   > not stored, so an extended quote moved earlier then back keeps the lowered date (never before today); « Prolonger »
   > is offered again once it expires. *Data, 2026-11-09:* on the prod copies (22/10 and 28/10) no still-valid open
   > devis is stored above its `start − 2`, so the capped read changes no row on screen. Tests:
   > `tests/devis-validity-resolver.unit.test.js`, client `ReservationPage.devis-validity-after-save`.

   > **Reading R33-C-L1 (2026-11-09) — a superseded load writes nothing.** The devis route and the reservation route
   > share one `ReservationPage`. The re-read after a re-issued save could still be on its way when « Accepté » had
   > converted the devis and navigated, land last, and fill the new reservation's fiche with the devis (form,
   > `updatedAt`, baseline). Each page load now carries a sequence number; a load overtaken by a newer one stops at its
   > next step and writes nothing more, its property context and defaults included. The re-read itself stays (the PDF
   > and payment-request actions after the save need the new price lock). Client test
   > `ReservationPage.stale-load`.

   > **Reading R33-M-L1 (2026-11-09) — a new devis too.** The live quote of a devis not saved yet was priced as a
   > reservation, so its summary showed deadlines its first save did not store. The fiche sends `kind: 'devis'` and the
   > live quote reads the validity the create will write (`computeValidUntil` from today); the site's public quote does
   > the same (specs/deposit-blocks-the-dates.md rule 19). Tests: `tests/devis-single-payment-by-validity.unit.test.js`,
   > client `ReservationPage.new-devis-quote-kind`.
8. At devis **convert-from-reservation** time, `validUntil` is also persisted using
   the same formula.
9. The PDF reads `full.validUntil` straight, formats with `formatDateFR`, no
   fallback to "today + days". If `full.validUntil` is empty (legacy data), the PDF
   recomputes from `createdAt + quoteValidityDays` (the same formula the model uses).
   *Reading 2026-11-08 (R30-RES-M1):* the fallback calls the model's `computeValidUntil` itself, so it
   caps at `startDate - 2` (it used to cap only past `startDate`) and carries rule 6's floor.
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
20. ~~**Consistency invariant — tax total + grand total must mirror the engine quote.**~~
    **SUPERSEDED on 2026-08-17 by [devis-pdf-total-parity.md](devis-pdf-total-parity.md) §3.2
    rules 6-10.** Sourcing the grand total from `quote.finalPrice` while the table is drawn from the
    persisted lines let the PDF print a total matching nothing on the page (523,92 € of rows under a
    595,00 € total) whenever the re-quote described a different pricing state. The total is now
    always « printed rows + printed tax », and the quote's tax is used only when the quote reproduces
    the printed stay — which it does once the re-quote replays the sold state. The bug below stays
    fixed. Original text kept for context:

    **Consistency invariant — tax total + grand total must mirror the engine quote.**
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

**Review fixes (2026-10-18, mega review #5)**

21. **A devis printed after its validity says so** (2026-10-18, mega review #5): « Valable jusqu'au
    07/10/2026 (expiré) » (« (expired) » in English). A converted devis and a reservation never carry
    it. *Why:* an expired devis printed on 18/10 read as a live offer.
    **Amended 2026-10-19** (specs/ui-review-2026-10-19-operations.md rule 20, UI/UX review proposal 22):
    the PDF prints the validity date alone — « (expiré) » on the guest's document read as a dead offer
    sent anyway. The operator is warned on the fiche (« Périmé · prolonger »), and saving re-stamps the
    validity.
22. **The pricing table's HT column is named for what it holds**, the line total: « Total HT »
    (« Total excl. VAT »). *Why:* « Hébergement — Qté 3 — Prix HT 272,73 € » read as 3 × 272,73.

**Audit fix (2026-10-30, audit R8-1)**

23. **A devis is dated on the operator's day, not the UTC one.** `createdAt` stays a UTC timestamp
    (rule 1), but the day it stands for is its local calendar day (`vatRegime.bookingDayOf`, the
    process's time zone, Europe/Paris by default): the PDF's « Date du devis », and the start of the
    validity window of rules 6-8 on create, convert-from-reservation and the legacy backfill. *Why:*
    a devis created between 00:00 and 01:00 / 02:00 in Paris printed the previous day and carried one
    day less than `quoteValidityDays`, while the rest of the server already read the local day
    (`utils/localDate.js`, specs/finance-dashboard-redesign.md rule 37).

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
| `utils/` | [server/src/utils/devisValidity.js](server/src/utils/devisValidity.js) | T | (2026-11-09, R32-RES-M1) `devisValidUntil`, the one validity reading of save, preview and read (rule 7 reading R32), and `readQuoteValidityDays(db)`. |
| `utils/` | [server/src/utils/reservationQuoteContext.js](server/src/utils/reservationQuoteContext.js) | T | (2026-11-09) `scheduleQuoteInputs(db, id, { editedStartDate })`: on a devis, the validity the save will write for the edited start. `reservationsController.calculatePrice` passes it and answers `validUntil` on a devis's live quote. |

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
- (2026-11-09, rule 7 reading R32-RES-M1) The devis fiche's « Valide jusqu'au » chip reads the live quote's
  `validUntil` while the quote is valid and the edit unsaved, so moving the dates moves the chip and « Paiements »
  together; after « Enregistrer » it shows the PUT's `validUntil` / `expired` / `extendable`, and a quote the save
  re-issued (was « Périmé · prolonger ») is re-read. Same at every width (the chip's compact wording on a phone).

---

## 7. Test plan — explicit non-regression coverage per user request

### 7.1 Server unit tests (new)

| Test file | Cases | Pins |
|---|---|---|
| `tests/devis-model-createdAt-and-validUntil.unit.test.js` (C) | (1) `create` persists `createdAt` explicitly. (2) `create` persists `validUntil = createdAt + settings.quoteValidityDays`. (3) `create` caps `validUntil` at `startDate - 2 days`. (4) `update` fills missing `validUntil`. (5) `convertFromReservation` persists both. | Rules 1–9. |
| `tests/devis-model-property-defaults.unit.test.js` (C) | (1) `create` merges property default options not in the payload. (2) Default option already present in the payload → no duplicate. (3) No property defaults configured → behaviour unchanged. (4) Default offered flag is propagated. | Rules 11–13. |
| `tests/reservations-controller-property-defaults.unit.test.js` (C) | Same shape as the devis test, for the reservation path. Pins rule 13. | Rule 13. |
| `tests/devis-pdf-date-and-validity.unit.test.js` (C) | (1) Empty `full.createdAt` → "Date du devis" defaults to today. (2) Empty `full.validUntil` → recomputed from `createdAt + quoteValidityDays`. (3) `validUntil` capped at `startDate - 2`. (4) Both populated → strings round-trip via `formatDateFR`. | Rules 4 + 9 + cap. |
| `tests/devis-local-day.unit.test.js` (2026-10-30, audit R8-1) | Clock frozen at 2026-10-30T23:30Z under Europe/Paris: create, convert-from-reservation and the legacy backfill open the window on 31/10; the PDF dates a UTC `createdAt` on its Paris day (`__test.resolveDevisDates`). Shared with specs/devis-extras-parity-and-price-lock.md rule 21. 10 cases. | Rule 23. |
| `tests/devis-pdf-date-validity-tax.unit.test.js` (C) | (1) `computeValidUntil` helper unit cases (rules 6 + 9 + cap). (2) PDF render smoke per scenario (rules 4, 9, 16, 18) — assert the magic header + a non-trivial buffer size. (3) **Consistency invariant** via `resolveLiveTaxTotals(full, quote)`: live tax total + grand total mirror `quote.touristTaxTotal` / `quote.finalPrice` when provided, fall back to row values otherwise, treat `touristTaxTotal = 0` in the quote as "engine didn't compute" (row wins), honour `quote.finalPrice = 0` (offered stay). | Rules 4, 6, 9, 15–18, **20**. |
| `tests/devis-moved-earlier-validity.unit.test.js` (2026-11-08, audit R31-RES-M1) | `validUntilForStart` helper cases; a valid devis moved from +42 to +10 / +2 / 0 days owes its payment before the arrival, never before today, and stays valid; a devis moved later keeps its date. 5 cases. | Rule 7 reading R31-RES-M1. |
| `tests/devis-validity-resolver.unit.test.js` (2026-11-09, audit R32-RES-M1/L1) | Today-relative table of `devisValidUntil` (21 rows: created far/near, moved earlier / to tomorrow / to a past start, moved back, moved later, override, extended then moved, extended earlier then back, expired re-saved / read, legacy NULL saved / read, `quoteValidityDays` 0, a non-ISO start), each re-fed to prove a save idempotent; on the model and controller, a devis +42 → +10 → +42 → +1 → +42 → +80 where calculate-price, the PUT, `findById` and the PDF date agree at every step; an expired devis whose live quote announces the re-issued window; a row stored above `start − 2` read capped with its schedule. 24 cases. Client `ReservationPage.devis-validity-after-save.test.jsx`: the chip follows the live quote then the PUT; a re-issued quote drops « Périmé · prolonger » and is re-read (2 cases). | Rule 7 reading R32-RES-M1. |
| client `pages/__tests__/ReservationPage.stale-load.test.jsx` (2026-11-09, audit R33-C-L1) | A devis load held until the page has moved to a reservation: released last, it leaves the reservation's notes in place; a logement read (`getProperty`) held the same way leaves the reservation's logement in place (audit R33 N2, `loadPropertyContext`'s own guard). 2 cases. | Rule 7 reading R33-C-L1. |
| `tests/devis-last-minute-validity.unit.test.js` (2026-11-08, audit R30-RES-M1) | Today-relative: `computeValidUntil` at +1, 0, −3, +2, +3 and +400 days; the PDF fallback of a legacy row at +1, 0 and +10; a devis created at +1 and at 0 days is valid and due today, neither expired nor extendable; « Prolonger » on an expired last-minute quote opens it today and is no longer offered; « Transformer en devis » on a stay starting tomorrow. 6 cases. Plus `plugins/website-booking/tests/public-request-last-minute-validity.unit.test.js`: a site request at +1 and at 0 days (2 cases). | Rule 6 reading R30-RES-M1, rule 9. |

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
