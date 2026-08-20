# Devis PDF — total, taxe de séjour et lignes doivent raconter la même histoire

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/devis-pdf-total-parity` |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

User-reported bug (prod, 2026-08-17): a devis that is **correct on the devis screen** prints a
**wrong PDF**. On the reported quote:

| | Devis screen (correct) | PDF (wrong) |
|---|---|---|
| Sous-total HT | 476,29 € | 476,29 € ✅ |
| Sous-total TTC | 523,92 € | 523,92 € ✅ |
| Taxe de séjour | 9,60 € | **11,08 €** ❌ |
| TOTAL TTC | 533,52 € | **595,00 €** ❌ |

The 595 € matches nothing on the page it is printed on — not even the PDF's own sub-total.

**Root cause — the PDF mixes two sources.**

- The **table rows** are drawn from the *persisted* devis (`full.nights`, `full.options`,
  `full.resources`), which is why the sub-totals are right.
- The **tourist tax + TOTAL** come from a *live re-quote* built inline in
  [`devisController.pdf`](../server/src/controllers/devisController.js), then resolved by
  `resolveLiveTaxTotals` in [`utils/devisPdf.js`](../server/src/utils/devisPdf.js) per
  [devis-pdf-and-tourist-tax-fixes.md](devis-pdf-and-tourist-tax-fixes.md) §3.4 rule 20.

That inline re-quote does **not** replay the state the devis was sold under. Compared with what the
fiche sends to `POST /api/reservations/calculate-price`
([`reservationsController.calculatePrice`](../server/src/controllers/reservationsController.js)) and
with what `devisModel.computeQuote` uses on save, it drops:

| Missing input | Consequence on the PDF |
|---|---|
| `offeredOptionIds` | Every **offered** option is re-billed at full price and loses its `includedInRate` tag, so the PDF prints a total the guest never agreed to. _(Since [tourist-tax-base-accommodation-only.md](tourist-tax-base-accommodation-only.md), 2026-08-20, the tourist tax is no longer affected — only the total is.)_ |
| `lockedNightlyBreakdown` / `lockedOptionLines` / `lockedResourceLines` / `lockedTariff` | The stay is re-priced at **today's** tariff instead of the one it was quoted under (price lock, [devis-extras-parity-and-price-lock.md](devis-extras-parity-and-price-lock.md) §3 rule 13) |
| engine-managed auto-option filtering | Auto-options persisted as lines are fed back as `selectedOptions` while the engine re-adds them |
| `extraGuestSurchargeOffered` | An offered extra-guest surcharge is re-billed |
| `touristTaxInComplement`, `inComplement` routing | Complément routing lost |
| `planningCardAsQuantity` | A public (WordPress) devis re-prices planning-card options on the wrong basis |

Reproduced with the real engine (in-memory DB, one 60 € property-default option configured
« offerte », percentage-based tourist tax + department surcharge):

```
FICHE  finalPrice 449,20  taxe  9,72   (option offerte → 0 €, includedInRate ✓)
PDF    finalPrice 509,20  taxe 11,24   (option refacturée 60 €, déduction perdue)
delta finalPrice = +60,00   ratio taxe = 1,156
```

Same signature as the user's report (+60 € on the total, tax inflated ≈ 15 %). A tariff change
between the devis issue date and the print date (grille refondue le 12/08/2026) produces the
identical signature through the missing price lock. **One root cause, one fix.**

**Aggravating design flaw.** §3.4 rule 20 of the previous bundle deliberately made the grand total
come from the re-quote *rather than* from the rows. So when the re-quote and the persisted lines
disagree, the document contradicts itself instead of failing safe. That rule is amended here.

## 2. Goal

The devis PDF prints exactly the amounts the operator validated on the devis screen: the tourist tax
and the TOTAL TTC always agree with the lines printed just above them, for the life of the quote.

## 3. Functional rules

### 3.1 One replay of the sold state, shared by every consumer

1. `devisModel` exposes `recomputeQuote(id)`: **the** way to obtain the pricing-engine quote of a
   PERSISTED devis. It rebuilds the engine input from the stored devis graph and runs the existing
   `computeQuote(body, existing, property)` — the same function `create`/`update` use, so the quote a
   consumer reads is byte-for-byte the quote the devis was saved with.
2. The rebuilt input carries **every** field the fiche and the model already pass:
   `offeredOptionIds` (from the persisted lines where `offered = 1`), `customPrice`,
   `discountPercent`, `extraGuestSurchargeOffered`, `touristTaxInComplement`, per-line `inComplement`
   routing, `cardOccurrences`, resource `sessions`, `platform`, and
   `planningCardAsQuantity = (requestOrigin === 'public')`.
3. Because it goes through `computeQuote`, it inherits for free: the price lock via
   `resolveLockedPricing` (nightly breakdown, option lines, resource lines, `lockedTariff`) and the
   removal of engine-managed auto-options from `selectedOptions`.
4. `recomputeQuote` returns `null` for an unknown devis or a missing property. It never throws to the
   caller: an engine failure surfaces as `null`, and the PDF falls back per rule 9.
5. `devisController.pdf` calls `model.recomputeQuote(req.params.id)` and passes the result to
   `generateDevisPdf`. The inline engine-input mapping (and the controller's direct `db` +
   `calculateReservationQuote` imports) disappears.
   5.bis **The payment links read the same replay** (added 2026-08-20,
   [payment-link-quote-parity.md](payment-link-quote-parity.md) §3.1): `paymentsController` kept a
   copy of the very mapping this rule deleted, and it decided how many euros a Qonto page asks for —
   a devis carrying a planning-card option was invoiced without it. Any new consumer that needs a
   persisted devis's quote calls `recomputeQuote`; rebuilding an engine input is the bug.

### 3.2 The document must agree with itself

6. The PDF's TOTAL TTC is **always** `sum of the printed rows (TTC) + the printed tourist tax`.
   It is no longer read from `quote.finalPrice` nor from `full.finalPrice`. A total that does not
   equal the lines above it is a bug by construction, whatever the pricing state.
7. The tourist-tax **amount** stays engine-authoritative — but only when the engine agrees with the
   document: the quote's `touristTaxTotal` is used when `|quote.finalPrice − printed rows TTC| ≤ 0,01`
   (« the re-quote reproduces the printed stay »). Otherwise the persisted `full.touristTaxTotal`
   wins, because it is the value the printed lines were computed with.
8. The tax **detail** line follows the amount it explains:
   - quote reconciles → `{touristTaxAdultsCount} pers. × {touristTaxNights} nuit(s) × {touristTaxUnitAmount}`
     (unchanged, rule 17 of the previous bundle);
   - fallback → the same shape, derived from the row so it multiplies out to the printed amount:
     persons = `adults`, nights = `endDate − startDate`, unit = `touristTaxTotal / (adults × nights)`.
     (Today's fallback prints `adults + children + teens` and the raw `touristTaxRate`, which for a
     percentage-based tax is a percentage rendered as euros — it never multiplied out.)
9. No quote at all (engine failure, legacy caller) → everything falls back to the persisted row, and
   the total is still `printed rows + row tax`.
10. `resolveLiveTaxTotals(full, quote, printedStayTtc)` owns this resolution, stays pure, and stays
    exported under `__test` so the invariant is unit-tested without parsing a compressed PDF stream.

### 3.3 Expired devis

11. An **expired** devis prints the prices it was sold at (the persisted lines and their total),
    never a silent re-tarification. Rule 6 makes this automatic: the rows come from the stored graph,
    and the re-quote — which `resolveLockedPricing` legitimately unlocks once the validity window has
    passed — will then fail the reconciliation check of rule 7, so the persisted tax wins too.
    To re-issue at today's tariffs the operator re-opens the devis and saves it (existing behaviour,
    [devis-extras-parity-and-price-lock.md](devis-extras-parity-and-price-lock.md) §3 rule 14) — which
    also re-issues a validity window.

### 3.4 Amendment to devis-pdf-and-tourist-tax-fixes.md §3.4 rule 20

12. Rule 20 (« both the Taxe de séjour line and the TOTAL TTC are sourced from `quote.touristTaxTotal`
    + `quote.finalPrice` — never from the persisted row ») is **superseded** by rules 6-9 above. The
    bug it fixed (PDF tax 15,36 € vs. summary 16,80 €) stays fixed: with a correct replay the quote
    reconciles, so the engine tax is still what gets printed. What changes is the failure mode — a
    disagreeing re-quote can no longer inject a total that matches nothing on the page. The spec file
    is edited in the same commit.

**Edge cases:**

- **Offered option** (`offered = 1`, property default « offerte ») → printed at 0 € with the
  « Offert » badge, absent from the total, deducted from the tourist-tax base. PDF = screen.
- **Manual accommodation price** (`customPrice`) → the accommodation row already prints
  `finalPrice − options − resources`, so rule 6 reproduces `finalPrice` exactly.
- **Extra-guest supplement** → already drawn as its own row from the persisted remainder
  (`resolveExtraGuestPdfRow`), so it is inside the sub-total and inside the total.
- **Offered stay** (`finalPrice = 0`) → rows sum to 0, total = tax only.
- **Tourist tax offered/collected by the platform** (`touristTaxTotal = 0`) → the tax block is
  skipped as today; total = rows.
- **Tariff changed since the devis was issued, quote still valid** → the lock replays the sold
  tariff; PDF = screen = persisted row.
- **Public (WordPress) devis** → `planningCardAsQuantity` replayed, planning-card options priced by
  quantity as when the guest booked.

---

## 4. Architecture

> Server-only change. No client code, no schema change. The PDF is a server-rendered artefact and all
> the arbitration lives in the model/util layer — nothing to compute in React.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — `GET /api/devis/:id/pdf` unchanged) |
| `controllers/` | `devisController.js` | T | `pdf` delegates the re-quote to `model.recomputeQuote(id)`; drops the inline engine-input mapping and the `db` / `calculateReservationQuote` imports |
| `models/` | `devisModel.js` | T | New `recomputeQuote(id)` + private `engineInputFromPersistedDevis(full)`; both reuse `computeQuote` / `resolveLockedPricing` (rules 1-4) |
| `middleware/` | — | — | (none) |
| `utils/` | `devisPdf.js` | T | `resolveLiveTaxTotals(full, quote, printedStayTtc)` implements rules 6-9; the totals block and the tax detail string consume it |
| `utils/` | `devisQuote.js` | T | Comment only: point `recomputeDevisQuote` at the new model replay and state why the payment path (which reads only `touristTaxCollectedOnArrival`) is unaffected |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | (none — no schema change) |

**Notes:**
- `recomputeQuote` is the model's job: it is the layer that already owns « rebuild an engine input
  from stored devis state » (`computeQuote`, `resolveLockedPricing`, `enrichDevis`).
- `resolveLiveTaxTotals` stays a pure function — no DB, no PDFKit — and keeps its `__test` export.
- No new dependency.

### 4.2 Client side (`client/src/`)

None. The devis screen is already correct; this spec brings the PDF back in line with it.

**Component reuse declaration:** not applicable (no client change).

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/devis/:id/pdf` | — | `application/pdf` | Unchanged contract; the **content** of the totals block is corrected |

---

## 5. Data model

No schema change. No migration. No backfill.

**Data impact:** none — nothing is written. Devis rows already carry everything needed
(`offered` per line, `extraGuestSurchargeOffered`, `touristTaxInComplement`, `tariffSnapshot`,
`requestOrigin`). Existing devis are fixed retroactively: the next PDF print of an already-issued
devis prints the corrected total, with no re-save.

## 6. UI / UX

PDF only (no screen touched). The totals block keeps its exact layout:

```
                                        Sous-total HT      476,29 €
                                        Sous-total TTC     523,92 €
                                        Taxe de séjour       9,60 €
                                 2 pers. × 2 nuits × 2,40 € / pers./nuit
                                        TOTAL TTC          533,52 €
```

- Copy unchanged (`Sous-total HT`, `Sous-total TTC`, `Taxe de séjour`, `TOTAL TTC`, and their
  English counterparts in `devisPdfLabels.js`).
- Only the **numbers** change, and only when the current code was wrong.
- Responsive: not applicable (A4 PDF).
- `PageActionBar`: not applicable (no page).

## 7. Test plan

### Server unit tests

- [x] `tests/devis-pdf-quote-parity.unit.test.js` (new, 8 tests) — real engine, in-memory DB:
  - [x] offered property-default option → `recomputeQuote` keeps it at 0 € **and** keeps the
        `includedInRate` tourist-tax deduction; the replay equals the persisted devis (rules 1-2).
  - [x] executable description of the bug: the old naive input re-bills the 60 € **and** raises the
        tax, the replay does neither.
  - [x] tariff raised after the devis was saved, quote still valid → `recomputeQuote` replays the sold
        price (rule 3).
  - [x] an engine-managed auto-option persisted as a line is not double-counted (rule 3).
  - [x] public devis (`requestOrigin = 'public'`) → `planningCardAsQuantity` replayed (rule 2).
  - [x] unknown devis → `null` (rule 4).
  - [x] end to end: PDF totals equal the persisted devis (rules 6-7).
  - [x] expired devis → the re-quote unlocks, the guard discards it, the sold prices print (rule 11).
- [x] `tests/devis-pdf-date-validity-tax.unit.test.js` (existing, 16 tests) — `resolveLiveTaxTotals`
      block rewritten for the amended contract:
  - [x] total = printed rows + tax, for a reconciling quote (rules 6-7).
  - [x] drifting quote (`quote.finalPrice ≠ printed rows`) → row tax wins, total stays row-based
        (rule 7). Pins the 595 € bug with the reported figures.
  - [x] no quote → row values, total = printed rows + row tax (rule 9).
  - [x] quote with `touristTaxTotal = 0` → row tax wins (unchanged).
  - [x] offered stay (rows = 0) → total = 0 + tax.
  - [x] the previous bundle's 15,36 vs 16,80 scenario still resolves to the live 16,80 (rule 12).
- [x] `cd server && npm test` — 2930/2930 green.

### Manual verification

The change has no client surface: it is verified on the rendered PDF itself. PDFKit writes page text
as glyph indexes, so the check records the strings the renderer draws (`PDFDocument#text`) on a devis
built through the real model — offered property-default option + percentage tourist tax:

- [x] Rendered PDF: `Sous-total TTC 380,00 €` / `Taxe de séjour 6,00 €`
      (`2 pers. × 3 nuits × 1,00 €`) / `TOTAL TTC 386,00 €` — the total is the lines plus the tax.
- [x] Same devis rendered with the **old** drifting quote (440 € / 7,50 €) forced in: the PDF still
      prints 380 / 6,00 / 386. The guard neutralises a bad re-quote (rules 6-7).
- [x] `recomputeQuote` returns the persisted `finalPrice` + `touristTaxTotal` on that devis, so the
      PDF and the devis screen read the same numbers.
- [ ] Prod re-check on the reported devis after deploy: expected 9,60 € / 533,52 €.

## 8. Out of scope

- Redesigning the PDF's totals block (layout/copy unchanged).
- Rule 18 of the previous bundle (strikethrough presentation when the tourist tax is offered by the
  platform).
- `utils/devisQuote.js` payment amounts: `fullPaymentCents` / `fullPaymentComponents` deliberately
  charge the **stored** row and only read `touristTaxCollectedOnArrival` (a property-config boolean)
  from the recompute — unaffected by this bug. Only a clarifying comment is added.
- Backfilling / re-saving existing devis rows (unnecessary — the fix is at render time).
- Any change to the devis screen or to `PricingSummary`.

## 9. Open questions

- Q: Should the PDF of an **expired** devis re-price at today's tariffs, like the fiche does?
  - A (2026-08-17, Adrien): **No** — it prints the sold prices. Rule 11.
- Q: Root fix only, or root fix + « the total is the sum of the printed lines » guard?
  - A (2026-08-17, Adrien): **Both.** Rules 1-5 (root) and 6-9 (guard).
