# Admin unlock of past reservations

| Field | Value |
|---|---|
| **Status** | Superseded in part — amended 2026-09-21 / 2026-10-27 by [settings-rationalization.md](../settings/settings-rationalization.md) rule 17a (global switch replaced by a per-fiche unlock) |
| **Branch** | `feature/admin-unlock-past-reservations` _(user-managed)_ |
| **Created** | 2026-06-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

> **Reviewed 2026-11-26 (spec reorganization).** Status corrected (the per-fiche unlock is live, not superseded); rules 1, 3, 7, 8 retired, rule 5 reworded to the per-fiche unlock; the settings-card architecture, data model and UI sections removed. Code: `server/src/controllers/reservationsController.js:1673-1680` (`pastUnlockRequested`), `client/src/pages/ReservationPage.jsx:211-214,4155`.

> **Superseded in part — noted 2026-10-27 (spec review).** The global switch this spec describes no longer
> exists. [settings-rationalization.md](../settings/settings-rationalization.md) rule 17a (decided 2026-09-21)
> replaced it with a **per-fiche unlock**: a past reservation's lock banner shows, to an admin only,
> « Déverrouiller cette fiche » (`client/src/pages/ReservationPage.jsx`); the unlock lives in the page
> state and ends when the page is left or reloaded; writes sent while unlocked carry `unlockPast: true`
> (`?unlockPast=1` on a DELETE), honoured for an admin and ignored for any other role
> (`server/src/controllers/reservationsController.js` `pastUnlockRequested`). The
> `app_settings.allowEditPastReservations` column was dropped by the settings-rationalization migration
> (`server/src/utils/settingsRationalizationMigration.js`) and the « Réservations passées » settings
> card is gone. Rules 1–3, 7 and 8, §5 and the Settings part of §6 are historical; the list of what a
> lift unlocks (rule 5) and what it never touches (rule 6) still describes the per-fiche unlock.
> Rule numbers are kept as they were.

---

## 1. Context

Today GuestFlow refuses most modifications on a reservation as soon as its check-in date is reached. The check is implemented in three places (the third one only surfaced during implementation on 2026-06-01):

- [reservationsController.js:298](server/src/controllers/reservationsController.js#L298) — `pastReservationLocked = startDate <= today` gates `PUT /api/reservations/:id`. Only a curated allowlist of 14 fields (clientId, platform, tourist tax, discount, final price, deposit/balance/caution amounts + paid flags + dates) goes through; everything else triggers a 400 with `error: 'PAST_RESERVATION_LOCKED'`.
- [reservationsController.js:455-464](server/src/controllers/reservationsController.js#L455) — `DELETE /api/reservations/:id` returns 403 when `endDate < today`.
- [reservationsModel.js:269](server/src/models/reservationsModel.js#L269) — `validateAvailability` hard-rejects any incoming payload with `startDate < today` (`'Impossible de réserver dans le passé.'`). Called by both create and update flows. This one bites EVEN when the controller's `pastReservationLocked` has been cleared by the toggle, because the typical edit of a past reservation keeps its existing (past) startDate unchanged.

The mirror UI lives in [ReservationPage.js](client/src/pages/ReservationPage.js): a warning banner ("Cette réservation est passée ou en cours…"), the Stay + Notes sections rendered at `opacity: 0.55; pointer-events: none`, and the delete button disabled with the same tooltip.

This is the right default — it stops Adrien from accidentally rewriting a reservation that's already shipped to accounting or whose iCal export has been published. But there are legitimate cases for editing a past reservation: a typo in a date, a wrong property assigned weeks ago, a discovered client mismatch on a multi-night stay. Today the only escape hatch is to hand-edit the SQLite file, which is brittle and bypasses every server-side validation.

## 2. Goal

The admin can unlock one past reservation from its fiche (« Déverrouiller cette fiche ») to make it fully editable again (Stay dates, Property, Times, Notes, Delete — everything that's currently gated). The fiche is locked by default and the unlock is never stored: it ends when the page is left or reloaded.

## 3. Functional rules

1. *(Retired 2026-11-26 — the global setting no longer exists; see specs/settings/settings-rationalization.md rule 17a.)*
> **Sans test** — retired rule
2. The unlock is **admin-only** at the server: `pastUnlockRequested(req)` (`reservationsController.js`) honours `unlockPast` only for an admin; the client shows the « Déverrouiller cette fiche » action to an admin only.
3. *(Retired 2026-11-26 — the unlock is per fiche and ends when the page is left or reloaded; see specs/settings/settings-rationalization.md rule 17a.)*
> **Sans test** — retired rule
4. The toggle has **no audit trail beyond Express access logs**: no extra row in `reservation_history` to flag a modification done while unlocked. Adrien's call — keep the implementation tight; if regret-driven audit becomes a need later, add a follow-up.
5. When an admin has unlocked the fiche (`unlockPast: true` on the request, `?unlockPast=1` on a DELETE; ignored for any other role):
   - `PUT /api/reservations/:id` accepts the full body, runs the same validation as a future reservation (date overlap, capacity, closures…).
   - `DELETE /api/reservations/:id` returns 200 regardless of `endDate`.
   - `validateAvailability` in the model accepts `startDate < today` (the only guard lifted at this layer — overlap / capacity / closure checks remain). Both `create` and `update` flows benefit, so an admin can also backfill a historical reservation if needed.
   - The client banner "Cette réservation est passée ou en cours…" is replaced by the « Déverrouiller cette fiche » action, then hidden once unlocked.
   - The `opacity: 0.55; pointer-events: none` on Stay + Notes sections is dropped.
   - The delete button is enabled.
6. The unlock does **NOT** affect:
   - Future reservations (no behavior change).
   - Blockages / closures (`kind != 'reservation'` — never had the lock).
   - The payment update endpoint `PUT /api/reservations/:id/payments` (never had the lock; payment fields are always editable).
   - iCal sync / Google Calendar sync (separate concern).
   - The CalendarPage drag-to-select past-day block (that one is a UX guard against accidental new reservations, not a lock on existing ones — left untouched).
7. *(Retired 2026-11-26 — no global toggle left to flip; see specs/settings/settings-rationalization.md rule 17a.)*
> **Sans test** — retired rule
8. *(Retired 2026-11-26 — the request carries `unlockPast: true` and the server honours it for an admin only; see specs/settings/settings-rationalization.md rule 17a.)*
> **Sans test** — retired rule

**Edge cases:**

- Reservation with `startDate == today` (current day) → currently locked, currently editable only on the allowlist. With unlock ON, fully editable.
- Reception or accountant role on a locked fiche → no unlock action; a request carrying `unlockPast` is ignored.
- Two admins, one with the fiche unlocked in their browser, one not → each request is judged on its own `unlockPast`; nothing is stored server-side.
- Accountant role: no access to the unlock (admin-only). Their existing read-only role on reservations is unchanged.

---

---

## 4. Architecture

Server: `controllers/reservationsController.js` (`pastUnlockRequested`, passed as `unlockPast` to `performUpdate` and `{ allowPastDates }` to `validateAvailability`), `models/reservationsModel.js` (`validateAvailability` lifts only the `startDate < today` guard). Client: `pages/ReservationPage.jsx` (lock banner, « Déverrouiller cette fiche », `pastUnlocked` state sent as `unlockPast` on every write and on `api.deleteReservation`). No setting, no column, no Settings card (all removed by `specs/settings/settings-rationalization.md` rule 17a).

## 5. Data model

None. `app_settings.allowEditPastReservations` was dropped by `utils/settingsRationalizationMigration.js`.

## 6. UI / UX

A past or started reservation shows the lock banner; to an admin it carries « Déverrouiller cette fiche ». Once unlocked the banner and the dimming of the Stay + Notes sections go, and Delete is enabled; no other visual indicator (decision 2026-06-01).
