# Editing a reservation isn't blocked by a pre-existing overlap / capacity conflict

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/edit-reservation-blocked-by-overlap` _(user-managed)_ |
| **Created** | 2026-06-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Investigating the « paiement plateforme : champs vides à la réouverture » report
(specs/platform-payment-calculer-button.md §1) showed the platform fields persist fine on a
**successful** save — but the operator's save was being **rejected** and the whole edit discarded.
There are **two** guards, both of which block a finance-only edit of an already-conflicting reservation:
- **Client pre-check (the actual gate observed in repro):** `handleSaveReservation` in
  [ReservationPage.js](../client/src/pages/ReservationPage.js) calls `getDateRangeConflictInfo` /
  `getTimeConflictState` (and a capacity check) **before** sending the PUT — so on an overlapping
  reservation the « Conflit de réservation » dialog fires and **no PUT is ever made** (the payment is
  never sent, hence « blank on reopen »).
- **Server guard:** on `PUT /api/reservations/:id` the controller runs
  [`validateAvailability`](../server/src/models/reservationsModel.js) (→ 409), `checkCapacity` and
  `checkBabyBeds` (→ 400).

Both run **even when the edit didn't touch the dates / occupancy** — so editing a reservation that
*already* overlaps another, or *already* exceeds capacity (both common on **iCal imports**: two sources
for the same property/dates, or an import with babies the property can't seat), is blocked. The « Erreur /
Conflit de réservation » dialog appears but is easy to dismiss (« Compris »), so the operator thinks the
save went through — and on reopen the entry (e.g. the platform payment) is gone, never having been saved.

## 2. Goal

The operator can edit an existing reservation (record the platform payment, change the client, etc.)
**without** being blocked by an overlap or capacity conflict that the edit **didn't introduce**. Moving
the reservation **into** a conflict (changing dates/place/occupancy) still validates as before.

## 3. Functional rules

1. On **update** of an existing reservation, the **availability/overlap** guard
   (`validateAvailability`) runs **only if the placement changed** — i.e. any of `propertyId`,
   `startDate`, `endDate`, `checkInTime`, `checkOutTime` differs from the stored reservation. If the
   placement is unchanged, a pre-existing overlap does **not** block the save.
2. On **update**, the **capacity** guards (`checkCapacity` + `checkBabyBeds`) run **only if the
   occupancy changed** — i.e. any of `propertyId`, `adults`, `children`, `teens`, `babies`,
   `singleBeds`, `doubleBeds`, `babyBeds` differs from the stored reservation. If unchanged, a
   pre-existing capacity excess does **not** block the save.
3. **Create** is unchanged — a new reservation always validates fully (it has no prior placement).
4. Moving a reservation **into** a conflict (changed placement → overlap) is still rejected (409);
   increasing occupancy beyond capacity (changed occupancy) is still rejected (400). The min-nights
   and past-reservation guards are untouched.

**Edge cases:**
- Finance-only edit (platform payment, client, notes, payment flags) on an overlapping/over-capacity
  reservation → saves (the protected inputs are unchanged).
- Same dates but the operator changed only the check-in/out **time** → placement changed → overlap
  re-validated (times affect the block window).

---

## 4. Architecture

> **Fat backend.** The change lives entirely in the server validation orchestration; no client change.

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `reservationsModel.js` | T | `getForUpdate` now also returns the placement + occupancy columns (`startDate`, `endDate`, `checkInTime`, `checkOutTime`, `adults`, `children`, `teens`, `babies`, `singleBeds`, `doubleBeds`, `babyBeds`) so the controller can diff them. |
| `controllers/` | `reservationsController.js` | T | In `update`, compute `placementUnchanged` / `occupancyUnchanged` from the stored reservation vs the payload; run `validateAvailability` only when placement changed, and `checkCapacity` / `checkBabyBeds` only when occupancy changed. |

No API/schema/client change.

### 4.2 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | T | In `handleSaveReservation`, compute `placementUnchanged` / `occupancyUnchanged` by diffing the current form against the loaded snapshot (`initialSnapshot` = JSON of `{ selectedProp, form }`); skip the pre-save date/time conflict checks when the placement is unchanged, and the capacity check when occupancy is unchanged. This is the gate that actually fired in repro (it blocked before any PUT). |

## 5. Data model

No schema change.

## 6. UI / UX

No UI change. Observable effect: editing & saving a reservation that already overlaps another (or
already exceeds capacity) now succeeds instead of raising « Conflit de réservation » / « capacité » —
so the platform payment (and any other field) is actually persisted. Moving the reservation into a real
conflict still shows the existing blocking dialog.

## 7. Test plan

### Server unit tests (full suite 1835 pass)
- [x] `reservations-controller-edit-overlap.unit.test.js` (4 new) — unchanged placement + a forced
      overlap → 200 (guard skipped); changed dates + overlap → 409; unchanged occupancy + capacity
      excess → 200; increased occupancy beyond capacity → 400.

### Manual UI verification (done on the dev server)
- [x] iCal reservation #1978 (overlaps #38, Dec→Apr): entered the platform payment via the fiche and
      saved → **no** « Conflit » dialog, save navigated away, reopen shows `platformGrossAmount = 655`.
      (Before the fix: « Conflit de réservation » blocked the save with no PUT.)
- [ ] Changing its dates onto another booking → « Conflit de réservation » still blocks (guard runs).

## 8. Out of scope

- A « Forcer l'enregistrement » flow for deliberately moving a reservation into an overlap (the chosen
  approach is "don't block when unchanged", not "force"). Could be added later if needed.
- Surfacing existing overbookings elsewhere (the calendar already shows overlaps).

## 9. Open questions

- (Resolved 2026-06-25) Approach = **don't block when nothing blocking changed** (transparent), rather
  than a force-confirm dialog.
