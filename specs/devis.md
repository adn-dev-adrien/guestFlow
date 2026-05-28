# Devis — MVC refactor + PDF service extraction

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/devis-mvc` _(Claude-managed)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 4 — Devis. See `specs/ROADMAP.md`. |

---

## 1. Context

`routes/devis.js` is **1543 LOC** — the largest monolith in the codebase, with all logic inline and no
controller/model. It holds:

- **10 routes:** list, get, `PATCH /:id/status`, `GET /:id/history`, create (184 LOC), update (185 LOC),
  delete, `POST /:id/convert-to-reservation` (133), `POST /from-reservation/:reservationId` (99), and
  **`GET /:id/pdf` (~574 LOC of inline `pdfkit` drawing)**.
- **Helpers:** history/audit snapshots (`getDevisAuditSnapshotFromDb/FromPayload`, `computeDevisAuditChanges`,
  `addDevisHistoryEntry`, `normalizeDevisHistoryValue`), `resolvePaymentSchedule`, `enrichDevis`, and
  money/date/format utils (`roundMoney`, `formatDateFR`, `formatCurrency`, `isLineOffered`,
  `timeToDecimalHour`, `formatHoursLabel`, `diffDays`, …).

It already uses the shared pricing engine (`calculateReservationQuote`) and `validateFinanceInputs`, so
the **business pricing logic is correct** — the problem is purely structure (MVC debt) and the giant
inline PDF generator.

**Audit findings (dead code + improvements):**
- **`client/src/pages/DevisForm.js` (501 LOC) is dead** — not routed in `App.js`, imported nowhere (all
  devis editing goes through `ReservationPage ?mode=devis`). Its imports are shared components used
  elsewhere, so removing it orphans nothing. → **delete it.**
- **`create` (POST `/`) and `update` (PUT `/:id`) duplicate ~185 LOC** of near-identical persist logic
  (devis row + options + custom options + resources + nights + audit). → **DRY into a single model
  persist helper.**
- **Duplicated helpers:** `roundMoney` is defined 4× (`pricing.js`, `reservationHelpers.js`,
  `resourceBookingsModel.js`, `devis.js`); `timeToDecimalHour` / `addDaysToIsoDate` also exist in
  `pricing.js`. This refactor keeps **one** copy per concern within the devis files (no new duplication);
  a codebase-wide `roundMoney` consolidation is noted as a follow-up (out of scope here).
- All 10 routes are **live** (used by the client) — no dead routes.

## 2. Goal

Turn the devis route into a clean thin-route → controller → model stack, and extract the PDF generator
into a reusable service — with **no behavior or output change** (the PDF must render identically). No
schema change.

## 3. Functional rules

1. **MVC.** `routes/devis.js` becomes thin (parse → controller → respond). Orchestration in
   `devisController` (validation wiring, quote calculation via `calculateReservationQuote`, HTTP
   statuses); all DB access + shaping in `devisModel` (CRUD, `enrichDevis`, payment schedule, history +
   audit snapshots, the two convert flows).
2. **PDF service.** The `GET /:id/pdf` body moves verbatim into `utils/devisPdf.js`
   (`generateDevisPdf(devis, settings) → Promise<Buffer>`), a pure renderer (no DB). The PDF-only format
   helpers move with it. The route/controller fetches the enriched devis + settings, calls the service,
   and streams the buffer with the existing `Content-Type`/`Content-Disposition` headers. **Layout is
   preserved** (same fonts, copy, totals, struck/offered lines, bank block, schedule) — with one
   deliberate footer fix: the per-page SIRET/TVA legal line is widened and forced to a single line
   (`lineBreak: false`) so SIRET and TVA never wrap. So the PDF is *not* byte-identical, by design.
3. **Behavior-preserving.** Every endpoint keeps its exact contract, validation (`400` on bad
   money/percentage via `validateFinanceInputs`, min-nights handling, `404`, `400` "déjà converti", etc.),
   response shapes, history/audit entries, and the convert flows (devis→reservation marks the devis
   `converted` + copies history; reservation→devis). No new validation, no removed feature.
4. **Quote authority unchanged.** The pricing engine (`calculateReservationQuote`) remains the single
   source of truth; the controller passes inputs and persists the returned quote (totals, options/
   resources/nights lines), exactly as today.
5. **No schema change.** The `devis_*` / `reservation_*` table fusion is **explicitly deferred** to a
   later spec.
6. **No client change to live code.** The API contract is identical, so `DevisPage` and the reservation
   devis-mode editor are untouched — **except** the dead `DevisForm.js` is deleted.
7. **Remove dead code.** Delete `client/src/pages/DevisForm.js` (unrouted, unimported).
8. **DRY persistence.** `create` and `update` share a single `devisModel` persist helper (devis row +
   options/custom options/resources/nights + audit), instead of duplicating ~185 LOC each.

**Edge cases:** all preserved — converting an already-converted devis (`400`), devis with custom options
/ offered lines / per-hour resources in the PDF, payment schedule derivation, history snapshot diffing.

---

## 4. Architecture

> **Fat backend, thin frontend.** Pure server refactor; no client touch. The PDF service is pure
> rendering (data in → Buffer out).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | `devis.js` | T | Thin: 10 routes → `devisController`. No SQL/logic/PDF left. |
| `controllers/` | `devisController.js` | C | list / get / updateStatus / history / create / update / delete / convertToReservation / convertFromReservation / pdf. Validation (`validateFinanceInputs`), quote calc, HTTP statuses. `buildController(model)` factory. |
| `models/` | `devisModel.js` | C | All `devis*` (+ convert-flow `reservation*`) DB access: list, `findById`/`enrichDevis`, create, update (both via one shared persist helper), delete, updateStatus, history read + `addHistoryEntry` + audit snapshots, `resolvePaymentSchedule`, convertToReservation, convertFromReservation. `create(db)` factory. |
| `utils/` | `devisPdf.js` | C | `generateDevisPdf(devis, settings) → Promise<Buffer>` (the ~574 LOC `pdfkit` renderer + its format helpers). Pure; no DB. |
| `utils/` | `pricing.js` · `financeValidation.js` · `textFormatters.js` | — | Reused (`calculateReservationQuote`, `validateFinanceInputs`, `sentenceCase`). |
| `models/` | `settingsModel.js` | — | Reused (company/bank settings for the PDF). |

**Notes:** routes thin; model/service unit-testable. No new dependency (`pdfkit` already used).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `DevisForm.js` | **Deleted** | Dead page (unrouted, unimported) — removed. |

No other client change — the API contract is identical (`DevisPage` + the reservation devis-mode editor
untouched).

### 4.3 API contract

Unchanged. Same 10 endpoints, same request/response shapes, same status codes. PDF layout preserved
except the deliberate single-line SIRET/TVA footer fix (§3.2).

---

## 5. Data model

No schema change. The `devis_*` ↔ `reservation_*` table fusion is deferred to its own future spec.

## 6. UI / UX

No visible change. Devis list, the devis editor (reservation `?mode=devis`), the PDF, the convert flows
and history all behave identically.

## 7. Test plan

### Server unit tests
- [x] `devis-model.unit.test.js` (5) — `findById` enrich round-trip (options, custom options, resources,
      nights) + payment schedule; `updateStatus` (records history, blocks converted, 400/404); `remove`;
      convert-to-reservation (creates the reservation + children, marks devis `converted`, copies history,
      blocks double conversion); convert-from-reservation. _(create/update need the full pricing engine →
      covered by `devis-model-create.unit.test.js` + browser.)_
- [x] `devis-model-create.unit.test.js` (5, full pricing schema) — the money-critical paths the plain
      model test can't reach: `create` persists engine prices + option/nights lines + a `create` history
      entry; `create` honours a manual accommodation price; `create` validation (`400` no property, `404`
      unknown property); `update` recomputes, replaces lines and **records a history entry** (verifies the
      audit fix); `update` on a missing devis → `404`.
- [x] `devis-controller.unit.test.js` (6, fake model) — `400` on invalid money; `404`; already-converted
      `400`; success shapes; pdf 404 when devis missing.
- [x] `devis-pdf.unit.test.js` (2) — `generateDevisPdf` returns a `%PDF` Buffer; offered/custom-option/
      per-hour/manual-price branches don't throw.
- [x] Full server suite green (**315**).

### Manual UI verification (in browser)
- [x] Devis list opens; `0` console errors.
- [x] **PDF download** end-to-end (`GET /api/devis/3/pdf`) → `200 application/pdf`, valid `%PDF` (route →
      controller → model → `devisPdf` service); enrich data rendered.
- [x] Clean `CI=true` client build (DevisForm removal breaks nothing).
- [ ] Create/update a devis + convert flows end-to-end — not exercised to avoid mutating data; left for
      the user's pass (visual PDF parity check included).

## 8. Out of scope

- **`devis_*` / `reservation_*` table fusion** (its own future spec — data migration).
- Any pricing/PDF-content change (pure relocation).
- **Codebase-wide `roundMoney` consolidation** (4 copies across `pricing.js` / `reservationHelpers.js` /
  `resourceBookingsModel.js` / devis) — flagged as a separate follow-up cleanup; this spec only avoids
  adding new copies.

## 9. Open questions

- Q: Put the audit-snapshot/history helpers in `devisModel` or a separate `devisAudit` util? — A
  (proposed): in `devisModel` (they read/write the devis tables); keep the pure diff (`computeDevisAuditChanges`)
  as a small internal helper. Confirm during implementation.
