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
3. **The writers a fiche can race with bump `updatedAt`.** `performUpdate` (plugins, SAS, the fiche) and the
   iCal sync's update statements set `updatedAt = datetime('now')`, as do the payment, caution, complement
   and SAS statements of `reservationsModel`. **Exceptions, on purpose:** boot migrations and repairs, the
   tariff / VAT snapshot stamps, and the attribution stamps of a website request at its creation — none of
   them runs against an open fiche. The version has a one-second resolution: two writes in the same second
   are not told apart (accepted, a human cannot race a background write at that scale).
4. **The fiche follows its own writes, and only those.** A write to `/api/reservations/:id/...` answers
   with `X-Fiche-Version-Before` (the stay's `updatedAt` before the handler) and `X-Fiche-Version-After`
   (when the answer leaves); `api.js` puts `{ reservationId, before, after }` on the data-changed event.
   The fiche adopts `after` only when `before` equals the version it holds
   (`utils/ficheVersion.versionAfterOwnWrite`). A foreign write that landed in between makes `before`
   differ: the held version stays, and the next save is still refused. The page never re-reads the stay to
   learn a version, except after an explicit overwrite (rule 5).
5. **The refusal offers a way out.** On `STALE_FICHE` the fiche opens a confirm dialog « Fiche modifiée
   entre-temps » — « Recharger efface la saisie en cours. Enregistrer écrase la version à jour. » — with
   « Recharger » (re-runs the page load), « Enregistrer quand même » (an explicit overwrite: that one save
   goes without `loadedUpdatedAt`, then the fiche holds the new version) and « Annuler » (closes the dialog;
   the draft stays on screen, the next save is refused again).

**Edge cases:**
- The version check runs first in `update`, so a stale save on a cancelled or superseded stay answers `STALE_FICHE` before the read-only guard (`RESERVATION_CANCELLED`) would; a stay already read-only has nothing to overwrite, and the reload then shows it.
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
| `middleware/` | `ficheVersionHeaders.js` | C | The two version headers on every write to `/api/reservations/:id/...` |
| `routes/` | `reservations.js` | T | Mounts the middleware on `/:id` |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Keeps the loaded `updatedAt` in a ref (set on load, advanced by its own writes), sends it, shows the three-way dialog on `STALE_FICHE` |
| `utils/` | `ficheVersion.js` | C | `versionAfterOwnWrite`: adopt a new version only for the fiche's own writes |
| `api.js` | `api.js` | T | Puts the stay and its versions (from the response headers) on the data-changed event |

**Component reuse declaration:** the existing `confirm` dialog with its `secondaryLabel` third action; no new component.

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
- [x] `tests/fiche-version-headers.unit.test.js`: rule 4 — the before / after headers on a write, none on a read.
- [x] Client: `utils/ficheVersion.test.js` (4) and `__tests__/api.fiche-version.test.js` (2): rule 4.
- [x] Real-data check on the shadow (prod data of 22/10): the audit's `lost-update.sh` scenario answers 409
  and the intake's fill survives.

### Manual UI verification
- [x] Open a fiche, write to the stay from outside (API), edit a field, Enregistrer → dialog; « Annuler »
  keeps the draft; « Enregistrer quand même » overwrites; « Recharger » shows the outside write.
- [x] Mobile (`xs`, 390 px, shadow, 2026-10-28): the dialog is full-screen, its actions are reachable, no horizontal scroll.

## 8. Out of scope

- A three-way merge of the draft and the stored stay.
- Versioning the devis editor.

## 9. Open questions

None.
