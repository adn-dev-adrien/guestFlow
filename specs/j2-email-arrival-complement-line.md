# J-2 email — arrival-complement line matching the arrival SAS

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/j2-email-arrival-complement-line` _(user-managed)_ |
| **Created** | 2026-06-24 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The J-2 arrival-reminder email ([defaultEmailTemplatesRegistry.js](../server/src/utils/defaultEmailTemplatesRegistry.js)
~L82) already renders a `{{#if complementToCollect}}{{complementNotice}}` block. `complementNotice`
is built in [emailContextBuilder.js](../server/src/utils/emailContextBuilder.js) (~L209-248): it sums
the **explicit** in-complement options/resources/custom-options + the tourist tax **only when
`touristTaxInComplement = 1`**, and appends « Il comprend notamment : … » — a **partial** list (the
comment itself says it can diverge from the total).

The **arrival SAS** uses a different, authoritative breakdown:
[reservationsModel.arrivalComplementDetailFromReservation](../server/src/models/reservationsModel.js)
(~L39-62) — options/resources in complement **+ the 3-way `touristTaxInComplementAmount`** (covers the
*owner-collects-at-arrival* case, not just the forced flag) **+ a « Complément d'arrivée » remainder
line** so the detail **always sums to the full `complementAmount`**.

So the two diverge: when the complement is mostly the on-arrival tourist tax (owner-collect) or carries
an accommodation gap, the **email shows a bare amount with no/partial description**, while the SAS shows
the full itemisation. The operator wants the J-2 email to describe the complement **exactly like the
arrival SAS**.

## 2. Goal

In the J-2 email, when an arrival complement is due, show a line describing **what it corresponds to**,
itemised identically to the arrival SAS (options + resources + tourist tax + remainder), always summing
to the full complement amount.

## 3. Functional rules

1. The J-2 complement line activates exactly when today's rule already fires: an **unpaid arrival
   complement** (`complementAmount > 0 && complementPaid != 1`). (Unchanged trigger.)
2. The description is sourced from the **same** computation as the arrival SAS
   (`arrivalComplementDetailFromReservation`) — the single source of truth — so the email and the SAS
   never disagree: in-complement non-offered options + resources + the **3-way**
   `touristTaxInComplementAmount` (incl. owner-collect-at-arrival) + a « Complément d'arrivée »
   remainder so the listed lines **sum to the full `complementAmount`**.
3. Rendered copy (FR): « Un complément de {montant} sera à régler directement sur place à votre
   arrivée. Il comprend : {label (montant), …}. » (EN mirror.) Because the breakdown is now complete,
   « comprend » replaces « comprend **notamment** ». When (degenerate) the detail can't be built, fall
   back to the bare amount sentence (no « comprend »).
4. No change to amounts collected, to the complement total, or to other email blocks.

**Edge cases:**
- Complement = only the on-arrival tourist tax (owner-collect platform) → the line reads « … Il
  comprend : Taxe de séjour (X €). » (today: no description at all).
- Complement = accommodation auto-gap only → « … Il comprend : Complément d'arrivée (X €). »
- Offered (free) in-complement items → excluded (as in the SAS).

---

## 4. Architecture

> **Fat backend.** The breakdown is computed server-side by the existing SAS helper; the email
> context builder only formats the provided detail into a sentence. The pure builder stays pure.

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `reservationsModel.js` | — | **No change** — reuse the existing model method `buildArrivalComplementDetail(id)` (already `getByIdWithDetails` → `arrivalComplementDetailFromReservation`, the SAS's source of truth); `reservationsModel.create(db)` is already exported. |
| `controllers/` | `emailsController.js` | T | In `loadReservationGraph`, compute `arrivalComplementDetail = reservationsModel.create(database).buildArrivalComplementDetail(id)` and pass it into `buildContext`. Guarded (try/catch): on a minimal/legacy schema where `getByIdWithDetails` can't run, omit it → builder falls back. |
| `utils/` | `emailAutoSendRunner.js` | T | Same: enrich each reservation with `arrivalComplementDetail` before `buildContext` (the path that actually sends the J-2). |
| `utils/` | `emailContextBuilder.js` | T | When `arrivalComplementDetail` is provided, build `complementBreakdown` + `complementNotice` from its `detail[]` (always-complete → « Il comprend : … »). Keep the current inline computation as the fallback when it's absent (back-compat for existing callers/tests). |

No DB schema change. The J-2 template text is unchanged (it already renders `{{complementNotice}}`); only the variable's content gets richer.

### 4.2 Client

None.

### 4.3 API contract

None (internal email rendering only).

## 5. Data model

No change.

## 6. UI / UX

Email body only. The J-2 complement line goes from a possibly-bare « Un complément de X € sera à
régler… » to one that always enumerates the components (options, resources, taxe de séjour, remainder)
summing to X € — matching the arrival SAS recap the operator already reads.

## 7. Test plan

### Server unit tests (full suite 1831 pass)
- [x] `email-context-builder.unit.test.js` — given `arrivalComplementDetail`, `complementNotice` lists
      every SAS line + uses « Il comprend : » (not « notamment »); owner-collect tax-only → the « Taxe
      de séjour » line appears; no detail → inline « notamment » fallback unchanged; no complement →
      notice stays empty (4 new tests).
- [x] Email send-path tests (`emails-controller`, `email-auto-send-runner`, `email-manual-queue`) — all
      41 green: the guarded `buildArrivalComplementDetail` is a no-op on minimal schemas (fallback).

### Manual UI verification (API preview on the dev server)
- [x] J-2 preview for reservation #12080 (complement 280 €) renders: « Un complément de 280,00 € sera à
      régler directement sur place à votre arrivée. **Il comprend : Ménage (80,00 €), Repas du soir
      (160,00 €), Bain nordique (40,00 €).** » — complete (sums to 280 €), matching the arrival SAS.
- [x] E2E smoke 28 passed / 1 skipped.

## 8. Out of scope

- The J-7 email (no complement block) and other templates.
- Changing which items are in the complement (purely a description change).
- Reworking the SAS arrival itself.

## 9. Open questions

- (Resolved 2026-06-24) The email reuses the arrival-SAS breakdown helper verbatim (single source of
  truth), rather than maintaining a parallel partial list in the email builder.
