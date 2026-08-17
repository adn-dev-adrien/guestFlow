# An offered resource is offered everywhere (devis PDF included)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/devis-pdf-offered-resource` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Operator report (2026-08-17): a devis holding a **ressource offerte** (le bain nordique) prints wrong.
In the PDF the bain nordique **shows its price**, is **not marked « Offert »**, and — worst of all — its
amount is **deducted from the accommodation row**: a 3-night stay at 300 € with a 50 € bain nordique
offered prints « Hébergement : 250,00 € » plus « Bain nordique : 50,00 € ».

Root cause, one character wide, in
[bookingLinesModel.js](../server/src/models/bookingLinesModel.js) `insertResourceLine`:

```js
totalPrice: rr.totalPrice || unitPrice * qty,
```

The pricing engine prices an offered line at **`totalPrice = 0`** and keeps its real price in
`originalTotalPrice` (`applyOfferedToLine`, the « offering is lossless » contract). `0 || …` reads that
legitimate zero as « no total supplied » and re-bills the resource at its catalogue price. The row is
therefore persisted as `offered = 1` **with the full price**, and everything downstream believes it:

- the PDF's offered detector ([devisHelpers.js](../server/src/utils/devisHelpers.js) `isLineOffered`)
  infers the gesture from `totalPrice === 0` only, so it does not see the flag → no « Offert » badge and
  the line prints at its price;
- the PDF's flat accommodation row is `finalPrice − Σ options − Σ resources`, so the phantom 50 € is
  subtracted from the accommodation — the total stays right, the lines lie.

Catalogue options were never affected (`totalPrice: opt.totalPrice || 0`), nor custom lines (they store
their amount plus the flag). **Resources only.**

## 2. Goal

A resource marked « offert » is billed 0 € everywhere it is stored or printed: the devis PDF shows it as
**« Offert »** with its real price struck through, and the accommodation row keeps its full price.

## 3. Functional rules

1. **A stored resource line honours the gesture.** When a resource line is offered, `totalPrice` is
   persisted as **0**; its real price stays recoverable from `unitPrice × billedUnits`. The
   `|| unitPrice * qty` fallback only applies when the caller supplied **no** total at all
   (`null` / `undefined`), never to a legitimate 0.
2. **The offered flag is authoritative when present.** `isLineOffered` returns true as soon as the line
   carries `offered = 1`; the historical « total 0 with a unit price » heuristic stays as a fallback for
   lines that reach the renderer without the flag (a quote line, a legacy row).
3. **The PDF prints an offered line at 0 €**, with its real price struck through and the « Offert »
   badge — the same treatment options already got. This holds even for a **legacy row** persisted with
   the phantom price, so old devis print correctly without waiting for a re-save.
4. **An offered line never leaves the accommodation row.** The options / resources subtotals the PDF
   subtracts (flat accommodation row, manual-price accommodation row, extra-guest supplement base) count
   the **billed** amount, so an offered line subtracts 0.
5. **Stored rows are repaired once, at boot.** An idempotent one-shot migration zeroes
   `reservation_resources.totalPrice` on every line already flagged `offered = 1` — devis *and*
   reservations, since the phantom amount also inflated what the fiche, the finance views and the
   accounting export read from that row. The reservation-level totals are untouched: they always came
   from the engine, which had already priced the line at 0.

**Edge cases:**
- An offered resource whose unit price is 0 (a genuinely free resource) → 0 € either way, badge shown.
- An hourly resource sold with `billedUnits = 0` (no hour placed) → already 0 €, unchanged.
- A NON-offered resource still stores `unitPrice × quantity` when the caller supplies no total
  (unchanged behaviour, covered by a test).
- Un-offering the resource on the fiche re-prices it from `unitPrice` — the lossless contract of the
  engine, unchanged.

---

## 4. Architecture

> **Fat backend.** The whole fix is server-side: the persistence layer stops resurrecting a price, the
> renderer trusts the stored flag, and a migration repairs the rows already written.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/bookingLinesModel.js` | T | `insertResourceLine` stores 0 for an offered line and only falls back to `unitPrice × qty` when no total was supplied. |
| `utils/` | `utils/devisHelpers.js` | T | `isLineOffered` trusts an explicit `offered` flag, keeps the heuristic as a fallback. |
| `utils/` | `utils/devisPdf.js` | T | One `lineAmounts()` helper resolves `{ offered, billed, real }` per line; options + resources rows print the billed amount with the real price struck through; the options/resources subtotals used by the accommodation and extra-guest rows count billed amounts. |
| `utils/` | `utils/offeredResourceTotalRepair.js` | C | Pure, idempotent repair: zero `totalPrice` on `reservation_resources` rows flagged offered. Returns the row count. |
| `database.js` | `database.js` | T | Runs the repair once, guarded by `migrations.offered_resource_totals_zeroed_v1`. |

### 4.2 Client side

None — the fiche already reads `offered` and the engine already prices the line at 0.

### 4.3 API contract

Unchanged.

---

## 5. Data model

No schema change. **Migration (data):** `offered_resource_totals_zeroed_v1` sets
`reservation_resources.totalPrice = 0` where `offered = 1 AND totalPrice != 0`. No amount is lost: the
real price is `unitPrice × billedUnits`, and the reservation's own totals never counted the line.

## 6. UI / UX

PDF only: the resource row renders like an offered option — price struck through, « Offert » badge,
0,00 € billed — and the accommodation row shows the full stay price.

## 7. Test plan

### Server unit tests (`server/src/tests/devis-offered-resource.unit.test.js`, 7 tests)
- [x] `model.create` with an offered resource → the stored row is `offered = 1, totalPrice = 0`
      (the reported bug, as an executable regression).
- [x] A non-offered resource still stores its computed total; a line supplied without a total still
      falls back to `unitPrice × quantity`.
- [x] The devis' `finalPrice` and the printed accommodation row agree: `finalPrice − Σ billed lines`
      equals the full accommodation price (300 €, not 250 €).
- [x] `isLineOffered`: true on an explicit `offered = 1` even when the total is wrong (legacy row);
      still true on the legacy heuristic; false on a normally-billed line.
- [x] The repair zeroes a legacy offered row, leaves a billed row alone, and is idempotent
      (second run touches 0 rows).
- [x] `recomputeQuote` on a devis with an offered resource replays it at 0 € (price-lock unchanged).
- [x] Full server suite green.

### Manual UI verification
- [x] PDF generated from a devis carrying an offered bain nordique: « Bain nordique — Offert » with the
      real price struck through, accommodation row at its full price, total unchanged. Screenshot in the PR.

## 8. Out of scope

- Marking an offered line in the emails / iCal exports (they read the engine quote, already correct).
- Re-pricing any reservation total (nothing to re-price: the totals were always engine-computed).
- The « comprise dans le tarif » (`includedInRate`) wording, which is a different state from a geste
  commercial.

## 9. Open questions

None — the fix is a data-integrity correction with a single defensible behaviour.
