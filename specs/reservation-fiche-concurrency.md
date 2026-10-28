# Reservation fiche — no lost update

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/audit-reservations` _(Claude-managed)_ |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Depends on** | `specs/gites-de-france-mail-intake.md` §4.1 (the save rewrites every column), `specs/reservation-payment-ledger.md`, `specs/plugins-phase-1-sdk.md` (`core.updateReservation`) |

---

## 1. Context

`PUT /api/reservations/:id` rewrites every column of the stay from the form's body. Nothing compared the
version the form was built on with the stored one. Background writers change the stay while a fiche is
open: the mail intakes (Airbnb, Gîtes de France), the Booking extranet intake and the SAS go through
`core.updateReservation` → `performUpdate`, and the hourly iCal sync moves the dates of an unlocked stay.
Audit 2026-10-28 reproduced it: an intake wrote adults 3, platform gross 500, payout 420 and a guest note;
the operator then saved the form loaded before — adults 8, gross 603.2, payout 534, empty note. The intake's
fill, including the platform amounts accounting reads, was erased with no history line naming the loss.

## 2. Goal

A save made on an out-of-date fiche is refused with a clear message and the choice to reload, instead of
silently reverting what an import, a mail or another tab wrote meanwhile.

## 3. Functional rules

1. **The save carries the version it was built on.** The fiche loads `updatedAt` with the stay (the read
   already returns the whole row) and sends it back as `loadedUpdatedAt` on `PUT /api/reservations/:id`.
2. **A stale version is refused.** When `loadedUpdatedAt` is present and differs from the stored
   `updatedAt`, the server answers `409 { code: 'STALE_FICHE', error: 'Fiche modifiée entre-temps.' }`
   before anything is read or written. A body without `loadedUpdatedAt` (a script) is not checked: the
   guard protects the fiche, not the API contract. Plugins and the sync call `performUpdate` / their own
   SQL directly and are not affected.
3. **Every background writer bumps `updatedAt`.** `performUpdate` (plugins, SAS, the fiche) and the iCal
   sync's update statements set `updatedAt = datetime('now')`, as do the payment, caution, complement and
   SAS statements of `reservationsModel`. The version has a one-second resolution: two writes in the same
   second are not told apart (accepted, a human cannot race a background write at that scale).
4. **The fiche follows its own writes.** The fiche adopts the stored `updatedAt` after its own save and
   after any write made from this tab (the `DATA_CHANGED_EVENT` every successful non-GET request fires,
   e.g. a payment mark, a refund, the SAS), so the operator is not told off for what they just did. A
   foreign write that lands between the load and such an own write is therefore adopted along with it:
   the guard narrows the lost-update window, it does not close it (accepted residual risk).
5. **The refusal offers the reload and keeps the draft.** On `STALE_FICHE` the fiche opens a confirm
   dialog « Fiche modifiée entre-temps » — « La fiche a changé depuis son ouverture (import, e-mail,
   autre onglet). Recharger remplace les modifications non enregistrées par la version à jour. » — with
   « Recharger » (re-runs the page load) and « Garder ma saisie » (closes the dialog; the draft stays on
   screen untouched, and the next save is refused again until the fiche is reloaded).

**Edge cases:**
- Cancelled / superseded stays are refused by their read-only guard first (`RESERVATION_CANCELLED`).
- A devis save (`PUT /api/devis/:id`) is unchanged: nothing writes a devis in the background.

---

## 4. Architecture

> Fat backend, thin frontend: the comparison is the server's; the client only echoes the version it read
> and renders the refusal.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `reservationsController.js` | T | `staleFicheRefusal` — compares `loadedUpdatedAt` with the stored row, before `update` does anything |
| `models/` | `reservationsModel.js` | — | unchanged (`getRow`, `getByIdWithDetails` already return `updatedAt`) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Keeps the loaded `updatedAt` in a ref (set on load, after a save, on `DATA_CHANGED_EVENT`), sends it, shows the reload dialog on `STALE_FICHE` |

**Component reuse declaration:** the existing `confirm` dialog; no new component.

### 4.3 API contract

`PUT /api/reservations/:id` accepts an optional `loadedUpdatedAt` (the `updatedAt` of the read) and may
answer `409 STALE_FICHE`. Backward compatible.

## 5. Data model

None.

## 6. UI / UX

The dialog of rule 5, on desktop and mobile alike (the shared confirm dialog is full-width on `xs`).

## 7. Test plan

### Server unit tests
- [x] `tests/fiche-stale-save.unit.test.js` (3): rule 2 — a stale version is refused and writes nothing,
  the matching version / none / blank / unknown stay is not refused; rule 3 — the read carries the version.
- [x] Real-data check on the shadow (prod data of 22/10): the audit's `lost-update.sh` scenario answers 409
  and the intake's fill survives.

### Manual UI verification
- [x] Open a fiche, write to the stay from outside (API), edit a field, Enregistrer → dialog; « Garder ma
  saisie » keeps the draft; « Recharger » shows the outside write.
- [ ] Mobile (`xs`): the dialog fits.

## 8. Out of scope

- A three-way merge of the draft and the stored stay.
- Versioning the devis editor.

## 9. Open questions

None.
