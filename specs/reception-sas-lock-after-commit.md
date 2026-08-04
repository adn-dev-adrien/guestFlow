# Reception role — a committed SAS can no longer be reopened

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reception-sas-lock-after-commit` |
| **Created** | 2026-08-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [reception-role-checkin-only.md](reception-role-checkin-only.md), [reopen-completed-sas.md](reopen-completed-sas.md), [arrival-departure-sas.md](arrival-departure-sas.md) |

---

## 1. Context

[reopen-completed-sas.md](reopen-completed-sas.md) deliberately **unlocked** the completed SAS: once
`arrivalSasDoneAt` (resp. `departureSasDoneAt`) is set, the green ✓ on the planning card stays
clickable, the wizard reopens pre-filled, and re-validating **replaces** the previous outcome
(complement lines, caution flags, breakfast counts, handover note, extinguisher seal, end-of-stay
complement).

That re-edit power was designed for **Adrien (admin)**. Since
[reception-role-checkin-only.md](reception-role-checkin-only.md) shipped, the **« Accueil »** role
runs the same wizard from the same Planning cards — and therefore inherits the same re-edit power:
a reception user can reopen a check-in committed yesterday (by them or by the admin) and silently
overwrite the caution marker, the complement lines, or the handover note. Server-side nothing stops
it: [enforceRoleAccess.js:58-59](server/src/middleware/enforceRoleAccess.js#L58) allowlists
`POST /reservations/:id/sas/arrival|departure` unconditionally, and
[sasController.js:101](server/src/controllers/sasController.js#L101) commits whatever it receives.

Adrien wants the reception account to be a **one-shot** operator: run the check-in / check-out that
is still pending, and never touch one that is already done. Correcting a past SAS stays an admin
action.

## 2. Goal

A **reception-only** user can commit an arrival (resp. departure) SAS **only while it has never been
committed**. As soon as the SAS is done, the planning ✓ is locked for them and any commit attempt is
refused by the server. Admins keep the full re-edit behaviour of
[reopen-completed-sas.md](reopen-completed-sas.md).

## 3. Functional rules

### 3.1 Server enforcement (authoritative)

1. **Commit guard.** `POST /reservations/:id/sas/arrival` is refused with **403
   `SAS_ALREADY_COMMITTED`** when the requester is **reception-only** (holds `reception`, not
   `admin`) **and** the reservation already carries `arrivalSasDoneAt`. Same rule for
   `POST /reservations/:id/sas/departure` against `departureSasDoneAt`. The refusal happens **before
   any write** — no complement line, no caution flag, no history entry is touched.
2. **Admin unchanged.** An `admin` (alone or combined with `reception`) keeps the full re-edit:
   reopen, pre-fill, re-commit, replace. Rule 1 never fires for them.
3. **Accountant unchanged.** The accountant still 403s on the SAS endpoints via the existing
   allowlist (`FORBIDDEN_ROLE`) — untouched.
4. **Read stays open.** `GET /reservations/:id/sas` remains allowed for reception even on a
   committed SAS (read-only, finance-free by construction). It is what lets the client render the
   locked message; it grants no write.
5. **The lock is keyed on the done marker only.** `arrivalSasDoneAt` / `departureSasDoneAt` are the
   single source of truth. A reservation whose check-in was never run through the SAS (marker NULL)
   is committable by reception even if `checkInDone` was ticked manually.
6. **The two SAS are independent.** A done arrival never locks the departure, and vice versa.

### 3.2 Client behaviour (reception-only)

7. **Planning arrival card.** When `arrivalSasDoneAt` is set and the user is reception-only, the
   card's SAS button keeps its green ✓ but is rendered **disabled**, tooltip « Check-in déjà
   effectué — modification réservée à l'administrateur ». Clicking does nothing (no dialog opens).
8. **Planning departure row.** Same for `DepartureMiniRow` against `departureSasDoneAt`, tooltip
   « Check-out déjà effectué — modification réservée à l'administrateur ».
9. **Deep-link fallback.** `/planning?sas=arrival|departure&reservationId=:id` (used by the reduced
   reception Dashboard rows and by push notifications) still opens `ReservationSasDialog`. When the
   requested SAS is already done **and** the user is reception-only, the dialog renders a **locked
   state** instead of the wizard: title « Check-in déjà effectué » (resp. « Check-out … »), body
   « Ce check-in a déjà été validé le {date}. Sa modification est réservée à l'administrateur. »,
   single action « Fermer ». No step, no field, no « Valider ».
10. **Admin UI unchanged.** For an admin the ✓ stays clickable with the « Revoir / modifier le
    check-in » tooltip and the wizard reopens pre-filled, exactly as today.
11. **The lock is UI-thin.** The client only reads `arrivalSasDoneAt` / `departureSasDoneAt` (already
    in the reception reservation view,
    [receptionView.js:63-64](server/src/utils/receptionView.js#L63)) plus the caller's roles. No new
    computation; the server refusal (rule 1) is the real guard.

### 3.3 Out-of-lock surfaces (explicitly unchanged)

12. The operational status toggles « Prêt » / « Arrivé » / « Parti » (`checkInReady`, `checkInDone`,
    `checkOutDone` via `PATCH /reservations/:id/payment`) stay **fully editable** by reception before
    and after a SAS commit — they carry no money and no SAS payload
    ([reception-role-checkin-only.md](reception-role-checkin-only.md) §3.5 rule 10 is untouched).
13. The Planning housekeeping cards (laundry, breakfast, linen, option/resource « fait » toggles)
    are untouched.

**Edge cases:**
- Reception commits an arrival, the dialog closes, the planning reloads → the ✓ is now green **and
  disabled**; re-tapping shows nothing (tooltip only). The freshly-committed SAS is immediately
  locked — no grace period.
- Reception has the dialog open (never committed) while an admin commits the same SAS from another
  device → the reception commit hits the server guard and 403s; the dialog surfaces the error toast
  « Ce check-in a déjà été validé — modification réservée à l'administrateur. » and closes.
- A user holding **reception + admin** → admin wins: no lock anywhere (rule 2).
- A reception user opens the deep-link for a done SAS → locked dialog (rule 9), not a 403 (the read
  is allowed).
- `arrivalSasDoneAt` NULL but `checkInDone = 1` (status ticked by hand) → SAS is **not** locked
  (rule 5).

---

## 4. Architecture

> **Fat backend, thin frontend.** The refusal lives in the controller and is unit-tested there; the
> role predicate becomes a shared pure helper. The client only disables a button and renders a
> locked panel from two booleans it already receives.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `constants/roles.js` | T | Add the shared pure predicate `isReceptionOnly(user)` (`reception` held, `admin` not) — today duplicated inline in `reservationsController`. Single source of truth for every reception branch. |
| `controllers/` | `controllers/sasController.js` | T | `commitArrival` / `commitDeparture`: before any model call, 403 `SAS_ALREADY_COMMITTED` when `isReceptionOnly(req.user)` and the matching `…SasDoneAt` is set (rule 1). |
| `controllers/` | `controllers/reservationsController.js` | T | Drop its local `isReceptionOnly` copy, import the shared one (no behaviour change). |
| `middleware/` | `middleware/enforceRoleAccess.js` | — | (none) — the SAS commit paths stay allowlisted; the *state-dependent* refusal cannot live in a path allowlist. Doc comment updated to point at the controller guard. |
| `models/` | `models/reservationsModel.js` | — | (none) — `getByIdWithDetails` already surfaces `arrivalSasDoneAt` / `departureSasDoneAt`. |
| `utils/` | — | — | (none) |
| `database.js` | — | — | (none) — no schema change. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `constants/roles.js` | T | Mirror the server helper: `isReceptionOnly(user)`; replace the two inline copies in `PlanningPage` / `Dashboard`. |
| `pages/` | `pages/PlanningPage.js` | T | Pass `canReopenSas={!receptionMode}` down to `ReservationCard`, `DepartureMiniRow` and `ReservationSasDialog`. |
| `components/` | `components/ReservationCard.js` | T | New prop `canReopenSas` (default `true`): when false and `arrivalSasDoneAt` is set → ✓ button `disabled` + locked tooltip (rule 7). |
| `components/` | `components/DepartureMiniRow.js` | T | Same for the departure ✓ (rule 8). |
| `components/` | `components/sas/ReservationSasDialog.js` | T | New prop `canReopenSas` (default `true`): when false and the loaded reservation has the matching `…SasDoneAt` → render the locked panel instead of the wizard (rule 9); also surface the server's `SAS_ALREADY_COMMITTED` on commit as a toast + close (edge case). |
| `pages/` | `pages/Dashboard.js` | T | Use the shared `isReceptionOnly` helper (no behaviour change; row deep-links unchanged, the dialog handles the lock). |
| `services/` / `api.js` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Tooltip` / `IconButton` (MUI), the existing toast (`useToast`) | Nothing new needed for the disabled ✓. |
| **Created (new generic)** | — | The locked panel is 6 lines of `DialogContent` inside `ReservationSasDialog`; extracting a component for one usage would be noise. |
| **Specific (kept feature-local)** | locked state inside `ReservationSasDialog` | Tied to the SAS wizard's own state machine. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/:id/sas/arrival` | unchanged | `200 { ok, complementAmount }` / **`403 { error: 'SAS_ALREADY_COMMITTED' }`** | New 403 for reception-only when `arrivalSasDoneAt` is set. Admin unchanged. |
| POST | `/api/reservations/:id/sas/departure` | unchanged | `200 { ok }` / **`403 { error: 'SAS_ALREADY_COMMITTED' }`** | Idem against `departureSasDoneAt`. |
| GET | `/api/reservations/:id/sas` | — | unchanged | Still allowed for reception on a committed SAS (rule 4). |

---

## 5. Data model

**No schema change.** The lock reads the existing `reservations.arrivalSasDoneAt` /
`reservations.departureSasDoneAt` columns.

**Data impact:** none — no migration, no backfill, no write path modified for admins.

## 6. UI / UX

**Planning — arrival card (reception-only, SAS done):**
the ✓ keeps `color="success"` and `CheckCircleIcon` but becomes `disabled` (MUI greys it). The
`<Tooltip>` (already wrapped in a `<span>`, so it still fires on a disabled button) reads
« Check-in déjà effectué — modification réservée à l'administrateur ». `aria-label` matches.

**Planning — departure row:** identical, « Check-out déjà effectué — modification réservée à
l'administrateur ».

**SAS dialog — locked state (deep-link):**

```
┌──────────────────────────────────────────────┐
│  Check-in déjà effectué                      │
├──────────────────────────────────────────────┤
│  🔒                                           │
│  Ce check-in a déjà été validé le 04/08/2026.│
│  Sa modification est réservée à              │
│  l'administrateur.                           │
├──────────────────────────────────────────────┤
│                                    [ Fermer ] │
└──────────────────────────────────────────────┘
```

Copy (French):
- « Check-in déjà effectué » / « Check-out déjà effectué » (title)
- « Ce check-in a déjà été validé le {date}. Sa modification est réservée à l'administrateur. »
  (`{date}` = `arrivalSasDoneAt` / `departureSasDoneAt` formatted `dd/MM/yyyy`; omitted from the
  sentence if the marker is unparsable)
- « Fermer » (action)
- Commit-race toast: « Ce check-in a déjà été validé — modification réservée à l'administrateur. »

**Responsive:** the locked panel inherits `ReservationSasDialog`'s existing responsive shell
(`fullScreen` on `xs`) — one short paragraph + one button, no layout work. The planning ✓ keeps its
40px icon / ≥44px touch target at every breakpoint; disabling changes colour only.

**Sticky action bar:** not applicable — no page-level layout changes (the two touched surfaces are a
card button and a dialog).

## 7. Test plan

### Server unit tests
- [x] `tests/reception-sas-lock.unit.test.js` (new) — `commitArrival` 403s `SAS_ALREADY_COMMITTED`
      for a reception-only requester when `arrivalSasDoneAt` is set, **and no model write runs**
      (rule 1).
- [x] idem — `commitArrival` returns 200 for reception when `arrivalSasDoneAt` is NULL (rule 1/5).
- [x] idem — `commitArrival` returns 200 for an **admin** on a done SAS (rule 2).
- [x] idem — `commitArrival` returns 200 for a **reception + admin** account on a done SAS (rule 2).
- [x] idem — the three symmetrical `commitDeparture` cases against `departureSasDoneAt` (rules 1, 6).
- [x] `tests/reception-role-access.unit.test.js` (touched) — the allowlist still grants the two SAS
      POST paths (the lock is state-based, not path-based) — drift guard unchanged.
- [x] `tests/roles.unit.test.js` (or the existing roles test) — `isReceptionOnly` truth table
      (reception → true; reception+admin → false; admin → false; accountant → false; no user →
      false).

### Client unit tests (Vitest)
- [x] `ReservationCard.test.js` — `canReopenSas={false}` + `arrivalSasDoneAt` → ✓ button disabled +
      locked tooltip; `canReopenSas` default → clickable (regression).
- [x] `DepartureMiniRow.test.js` — same for the departure ✓.
- [x] `ReservationSasDialog.test.js` — `canReopenSas={false}` on a done SAS renders the locked panel
      (no stepper, no « Valider »); on a not-done SAS renders the normal wizard.

### Manual UI verification
- [x] Log in as the « Accueil » account → Planning: a not-yet-done arrival opens the SAS normally and
      commits.
- [x] Same account, same card after commit → ✓ green **disabled**, tooltip visible on hover/long-press,
      no dialog on tap.
- [x] Same account → reduced Dashboard, tap a row whose SAS is already done → locked dialog, « Fermer ».
- [x] Log in as admin → the same card's ✓ is still clickable, the wizard reopens pre-filled and
      re-commits (regression on [reopen-completed-sas.md](reopen-completed-sas.md)).
- [x] Mobile (`xs`): disabled ✓ readable + locked dialog fullscreen.
- [x] E2E `npm run test:e2e` green.

## 8. Out of scope

- Any read-only *consultation* of a committed SAS by reception (decision 2026-08-04: hard lock, not a
  view-only reopen).
- Locking the operational status toggles after a SAS commit (rule 12 keeps them open).
- A per-user "SAS committed by whom" audit column — the existing reservation history entries
  (`sas_arrival` / `sas_departure`) are unchanged and remain unattributed.
- Any time-based rule (e.g. "reception may re-edit within 15 minutes").
- Admin-side changes to `reopen-completed-sas.md` behaviour.

## 9. Open questions

- Q: Locked button vs read-only reopen for a done SAS?
  - A: **Locked button** (AskUserQuestion 2026-08-04) — the ✓ stays visible but inert; the deep-link
    dialog shows a short locked message. No read-only wizard.
- Q: Do the « Prêt » / « Arrivé » / « Parti » toggles lock too?
  - A: **No** (AskUserQuestion 2026-08-04) — they are purely operational, no money, and reception must
    keep flipping them after the SAS.
