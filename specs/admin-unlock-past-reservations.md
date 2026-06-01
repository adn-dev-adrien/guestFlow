# Admin unlock of past reservations

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/admin-unlock-past-reservations` _(user-managed)_ |
| **Created** | 2026-06-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Today GuestFlow refuses most modifications on a reservation as soon as its check-in date is reached. The check is implemented in two places:

- [reservationsController.js:298](server/src/controllers/reservationsController.js#L298) — `pastReservationLocked = startDate <= today` gates `PUT /api/reservations/:id`. Only a curated allowlist of 14 fields (clientId, platform, tourist tax, discount, final price, deposit/balance/caution amounts + paid flags + dates) goes through; everything else triggers a 400 with `error: 'PAST_RESERVATION_LOCKED'`.
- [reservationsController.js:455-464](server/src/controllers/reservationsController.js#L455) — `DELETE /api/reservations/:id` returns 403 when `endDate < today`.

The mirror UI lives in [ReservationPage.js](client/src/pages/ReservationPage.js): a warning banner ("Cette réservation est passée ou en cours…"), the Stay + Notes sections rendered at `opacity: 0.55; pointer-events: none`, and the delete button disabled with the same tooltip.

This is the right default — it stops Adrien from accidentally rewriting a reservation that's already shipped to accounting or whose iCal export has been published. But there are legitimate cases for editing a past reservation: a typo in a date, a wrong property assigned weeks ago, a discovered client mismatch on a multi-night stay. Today the only escape hatch is to hand-edit the SQLite file, which is brittle and bypasses every server-side validation.

## 2. Goal

The admin can flip a single toggle in `Paramètres` to make every past reservation fully editable again (Stay dates, Property, Times, Notes, Delete — everything that's currently gated). The toggle is OFF by default and persisted across restarts, so the lock comes back unless the admin explicitly switches it off again.

## 3. Functional rules

1. A new boolean setting `allowEditPastReservations` (default `0`) is stored in `app_settings`. When `1`, both server-side locks (PUT field allowlist + DELETE 403) are bypassed; when `0`, current behaviour is preserved.
2. The toggle is **admin-only** at every layer:
   - Read (`GET /api/settings`): any authenticated user receives the field (it changes the UI banner state for them too, even if they can't flip it).
   - Write (`PUT /api/settings`): `enforceRoleAccess` already restricts settings to admins; no new check needed — but `usersController.updateSelf` must keep stripping unknown fields (already true).
   - UI: the `Switch` only renders inside the admin Settings page; the page is already gated by `RequireAdmin`.
3. The toggle has **no expiry**: once set to `1`, it stays `1` until an admin explicitly flips it back. There is no auto-relock on session end, no time limit, no countdown.
4. The toggle has **no audit trail beyond Express access logs**: no extra row in `reservation_history` to flag a modification done while unlocked. Adrien's call — keep the implementation tight; if regret-driven audit becomes a need later, add a follow-up.
5. When `allowEditPastReservations = 1`:
   - `PUT /api/reservations/:id` accepts the full body, runs the same validation as a future reservation (date overlap, etc.).
   - `DELETE /api/reservations/:id` returns 200 regardless of `endDate`.
   - The client banner "Cette réservation est passée ou en cours…" is hidden.
   - The `opacity: 0.55; pointer-events: none` on Stay + Notes sections is dropped.
   - The delete button is enabled.
6. The toggle does **NOT** affect:
   - Future reservations (no behavior change).
   - Blockages / closures (`kind != 'reservation'` — never had the lock).
   - The payment update endpoint `PUT /api/reservations/:id/payments` (never had the lock; payment fields are always editable).
   - iCal sync / Google Calendar sync (separate concern).
   - The CalendarPage drag-to-select past-day block (that one is a UX guard against accidental new reservations, not a lock on existing ones — left untouched).
7. When the toggle is flipped from `1` → `0`, any open ReservationPage tab keeps its current edit-in-progress state until the user navigates away or reloads. Server requests issued AFTER the flip are gated by the new value (re-read on each request from `app_settings`). No live-push notification to other tabs (out of scope).
8. The toggle's effect on a request is decided by the **server's** current `app_settings.allowEditPastReservations` value at request time, not by anything in the session or sent in the body. This is deliberate — the client cannot grant itself the unlock.

**Edge cases:**

- Reservation with `startDate == today` (current day) → currently locked, currently editable only on the allowlist. With unlock ON, fully editable.
- Reservation already locked, admin flips toggle ON, immediately edits without reloading the page → the in-page `existingReservationLocked` state is still `true`, so the banner stays. **Acceptable** — fix in a follow-up if Adrien wants live updates. For now, the page footer can show a small `(Réservations passées modifiables — Paramètres)` hint when the setting is ON, so the admin knows to reload.
- Two admins, one with unlock ON in their browser, one with OFF → both see the same server state (single source of truth), so both have the same authorisation. No split-brain.
- Accountant role: no access to the toggle (admin-only). Their existing read-only role on reservations is unchanged.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE app_settings ADD COLUMN allowEditPastReservations INTEGER NOT NULL DEFAULT 0` (mirror existing `smtpSecure` shape). |
| `models/` | `settingsModel.js` | T | Add `allowEditPastReservations` to `COLUMNS` list + cast to boolean on read (`Boolean(row.allowEditPastReservations)`). Add helper `allowEditPastReservations()` for controllers that don't need the whole settings object. |
| `controllers/` | `reservationsController.js` | T | Both the `update` (line ~298) and `remove` (line ~455) read `settingsModel.allowEditPastReservations()`. When `true`, skip the lock entirely. The 14-field allowlist remains used only when the setting is `false` AND `pastReservationLocked` is `true`. |
| `controllers/` | `settingsController.js` | T | Add `allowEditPastReservations` to the validated update body (boolean coercion). |
| `routes/` | — | — | No route change; existing `GET /api/settings` + `PUT /api/settings` carry the new field automatically once `COLUMNS` is updated. |
| `middleware/` | `enforceRoleAccess.js` | — | No change — settings is already admin-only. |
| `utils/` | — | — | No change — the comparison `startDate <= today` lives in the controller as it does today. |
| `tests/` | `settings-model.unit.test.js` | T | New cases: column read/write round-trip; default value is `false`; coerces `'true'/'false'/1/0` to boolean on write. |
| `tests/` | `reservations-controller.unit.test.js` | T | New cases: PUT on a past reservation rejects when `allowEditPastReservations=false` (existing case), accepts full body when `true`. DELETE on past reservation returns 403 when `false`, returns 200 when `true`. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `SettingsPage.js` | T | Mount new `SettingsReservationLockSection` between the VAT card and the Google Calendar card. |
| `pages/` | `ReservationPage.js` | T | Where `existingReservationLocked` is computed (line ~466), read the new setting and short-circuit to `false` when the setting is ON. Keep the existing banner — wording stays identical (it's still informative for the regular case). |
| `components/` | `SettingsReservationLockSection.js` | C | New section card (mirrors `SettingsVatSection` shape — `Card variant="outlined"`, `CardContent`, `Stack spacing 2.5`, h6 title + caption). One `Switch` field "Autoriser la modification des réservations passées" + an explanation paragraph in `caption` color. |
| `hooks/` | — | — | The `ReservationPage` already loads its own data on mount; we piggyback on the existing `api.getSettings()` already called by `useGuestFlowSettings` or equivalent. If no such hook exists, add a lightweight fetch inside `ReservationPage` (the value is small and changes rarely — no need for global state). |
| `services/` | — | — | No new service. |
| `utils/` | — | — | No new utils. |
| `constants/` | — | — | No new constants. |
| `api.js` | `api.js` | — | No change — `getSettings()` / `updateSettings()` carry the new field automatically once the server returns it. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Card` (MUI), `Switch` (MUI), `Stack`, `Typography`, `PageActionBar` (in SettingsPage already), `useDirtyFormGuard` (already in SettingsPage flow) | Standard Settings-page pattern. |
| **Created (new generic)** | — | The new `SettingsReservationLockSection` is page-specific (a Settings card for one toggle); no reusable surface. |
| **Specific (kept feature-local)** | `SettingsReservationLockSection.js` | Card with a single toggle + explanation; matches the shape of `SettingsVatSection` and `SettingsSmtpSection`. Not generic. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/settings` | — | `{ …existingFields, allowEditPastReservations: boolean }` | Any authenticated user (admin or accountant). Boolean cast happens server-side. |
| PUT | `/api/settings` | `{ …, allowEditPastReservations?: boolean }` | `{ ok: true, settings }` | Admin only (existing `enforceRoleAccess`). Coerces 0/1/'true'/'false' to boolean. Other fields unchanged. |
| PUT | `/api/reservations/:id` | (unchanged) | 200 OK with the updated reservation, OR 400 `PAST_RESERVATION_LOCKED` (only when setting is OFF and reservation is past). | The 14-field allowlist behavior is preserved when the setting is OFF. |
| DELETE | `/api/reservations/:id` | — | 200 OK `{ ok: true }`, OR 403 (only when setting is OFF and reservation's `endDate < today`). | |

Auth: admin-only for both Settings endpoints; admin-only for reservations endpoints (no change).

---

## 5. Data model

**New column:** `app_settings.allowEditPastReservations` — `INTEGER NOT NULL DEFAULT 0`.

**Migration (idempotent block in `server/src/database.js`)**:

```sql
ALTER TABLE app_settings ADD COLUMN allowEditPastReservations INTEGER NOT NULL DEFAULT 0
```

Wrapped in the existing `tryAddAppSettingsCol()` pattern that no-ops if the column is already present. Defaults to `0` so every existing row + every fresh install start locked-down — opt-in.

**Data impact:** None. No existing records are modified. No risk of loss or corruption. The default value (`0`) matches the current behaviour for every install.

---

## 6. UI / UX

### Settings page (`/parametres`)

New card titled **"Réservations passées"** between the VAT card and the Google Calendar card. Layout:

```
┌─ Réservations passées ──────────────────────────────────────┐
│                                                              │
│ Autoriser la modification des réservations passées   [ ⬤ ]  │
│                                                              │
│ Par défaut, les réservations dont la date d'arrivée est      │
│ atteinte sont verrouillées : seuls le client, la plateforme, │
│ les ajustements de prix et les statuts de paiement/caution   │
│ restent modifiables. Activez ce bouton pour permettre la     │
│ modification complète (dates, logement, suppression…) des    │
│ réservations passées. Pensez à le désactiver une fois la     │
│ correction effectuée.                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Width: same as the other Settings cards (full width inside the `Container` they all share). Padding identical to neighbours.

The Save / Cancel flow uses the existing Settings-wide `PageActionBar` — the toggle change is captured as part of the draft, dirty-form guard already covers it. Single-click toggling and then leaving the page without saving triggers the existing "unsaved changes" guard (consistency with the other cards).

### ReservationPage (`/reservations/:id`)

When the setting is OFF (default):
- Same as today: banner shown for past reservations, Stay + Notes sections greyed and disabled, Delete disabled.

When the setting is ON:
- Banner hidden.
- Stay + Notes sections fully interactive (no opacity, no `pointer-events: none`).
- Delete button enabled.
- **No extra visual indicator on ReservationPage.** Adrien's call (2026-06-01) — when the setting is ON, a past reservation visually looks identical to a future one. The only place where the toggle's state is surfaced is the toggle itself in Paramètres. Less visual noise; admin checks Paramètres when in doubt.

### Responsive behavior

- `xs` (mobile, ≤600px): the Settings card is full-width, the `Switch` and label stack vertically (label above, switch below-right) — mirrors the other Settings cards on mobile.
- `md` (~900px): label and switch on the same row, the explanation paragraph wraps under both.
- `lg` (≥1200px): same as `md`.
- ReservationPage: no layout change vs today on any breakpoint — the only visible difference is the absence of the banner + the persistent hint at the bottom.

### Copy (French strings)

| Where | String |
|---|---|
| Settings card title | `Réservations passées` |
| Toggle label | `Autoriser la modification des réservations passées` |
| Explanation | `Par défaut, les réservations dont la date d'arrivée est atteinte sont verrouillées : seuls le client, la plateforme, les ajustements de prix et les statuts de paiement/caution restent modifiables. Activez ce bouton pour permettre la modification complète (dates, logement, suppression…) des réservations passées. Pensez à le désactiver une fois la correction effectuée.` |

No empty / loading / error states are unique to this section — the parent SettingsPage already covers them.

### Sticky action bar

No change. SettingsPage already uses `PageActionBar` with Save / Cancel. ReservationPage already uses `PageActionBar` with Save / Cancel / Delete / actions. The new hint footer is rendered **below** the form, not in the action bar.

---

## 7. Test plan

### Server unit tests

- [ ] `settings-model.unit.test.js` — extended:
  - `allowEditPastReservations` round-trips correctly (`true → 1 → true`, `false → 0 → false`).
  - Default value on a fresh DB is `false`.
  - Coercion: `'1'`, `'true'`, `true`, `1` all become `true`; `'0'`, `'false'`, `false`, `0`, `''`, `null`, `undefined` all become `false`.
- [ ] `reservations-controller.unit.test.js` — new cases:
  - PUT on a past reservation, setting OFF: rejected with `PAST_RESERVATION_LOCKED` for a field outside the allowlist (existing behaviour, regression check).
  - PUT on a past reservation, setting ON: accepted, body fully applied.
  - PUT on a future reservation, setting OFF or ON: no difference (both accepted).
  - DELETE on a past reservation, setting OFF: 403.
  - DELETE on a past reservation, setting ON: 200.
  - DELETE on a future reservation: 200 in both cases.

### Manual UI verification

- [ ] Happy path: log in as admin → `/parametres` → flip "Réservations passées" toggle ON → Save → navigate to a past reservation → see no banner, edit a date freely, save → setting persists across page reload.
- [ ] Edge case: open a past reservation page first (sees banner), then in another tab flip the setting ON, then come back to the open tab → banner still shown until reload (documented, acceptable per §3.7).
- [ ] Edge case: accountant role → does NOT see the new Settings card (admin-only). Accountant on a past reservation page: behaviour unchanged (read-only).
- [ ] Regression: future reservation editing unchanged with the toggle OFF and ON.
- [ ] Regression: blockages / closures still uneditable past their date (they don't depend on this toggle).
- [ ] Mobile (`xs`): Settings card readable, toggle reachable, save button visible.

---

## 8. Out of scope

- **Audit trail for edits done while unlocked.** No `editedWhileUnlockedBy` column in `reservation_history`. If regret-driven audit becomes a need, a follow-up spec adds a column + a column-rendering tweak in the history viewer.
- **Auto-relock on session end / time-based expiry.** Per Adrien's design choice — permanent toggle until manually flipped back.
- **Live cross-tab updates.** Open ReservationPage tabs don't refresh their lock state when the setting is flipped in another tab. The user reloads.
- **Per-reservation override.** No "unlock this single reservation" surface in the row UI — it's all-or-nothing at the global setting level.
- **Restricting which fields become editable when unlocked.** When ON, the lock is fully dropped; the full validation surface applies (date overlap, etc.) as for a future reservation.
- **Refactoring or generalising the existing 14-field allowlist.** Out of scope; the allowlist stays as it is for the locked state.

## 9. Open questions

(Resolved before moving Status to Approved.)

- ~~Q: Should the unlock be session-scoped or permanent?~~ → A: Permanent (Adrien, 2026-06-01).
- ~~Q: Who can flip the toggle?~~ → A: Admin only (Adrien, 2026-06-01).
- ~~Q: Audit trail?~~ → A: No — keep the implementation minimal (Adrien, 2026-06-01).
- ~~Q: Does "past" need a new cutoff (e.g. < 30 days)?~~ → A: No — same cutoff as today (Adrien, 2026-06-01).
- ~~Q: Should the toggle ON add a persistent hint on ReservationPage?~~ → A: No — no extra visual indicator anywhere (Adrien, 2026-06-01). The toggle state lives only in Paramètres.
