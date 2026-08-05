# Reception role — only the day's SAS is editable

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reception-sas-lock-after-commit` |
| **Created** | 2026-08-04 |
| **Author** | Adrien |
| **Related PR** | [#374](https://github.com/adn-dev-adrien/guestFlow/pull/374) |
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
runs the same wizard from the same Planning cards — and the Planning shows a **whole week**, the
reduced Dashboard a **navigable date**. So a reception user could:

- reopen a check-in committed last month and silently overwrite the caution marker, the complement
  lines or the handover note;
- run the SAS of a **future** arrival (collecting a caution days early, on a stay that may still be
  cancelled or modified);
- run the SAS of a **past** arrival nobody handled at the time.

Server-side nothing stopped it: `enforceRoleAccess` allowlists
`POST /reservations/:id/sas/arrival|departure` unconditionally (a path allowlist cannot express a
state rule), and the commit handlers accepted whatever they received.

Adrien wants the reception account confined to **the work of the day**: run the check-in / check-out
that is happening today and has not been done yet — nothing else. Everything outside that window
stays an admin action.

## 2. Goal

A **reception-only** user can commit an arrival (resp. departure) SAS **only** when the reservation
arrives (resp. departs) **today** and the SAS has **never been committed**. A past, future or
already-committed SAS is inert in the UI and refused by the server. The same day-window governs the
operational status toggles. Admins are unaffected — they keep the full re-edit of
[reopen-completed-sas.md](reopen-completed-sas.md).

## 3. Functional rules

### 3.1 The edit window

1. **Definition.** The SAS of a reservation dated `D` (the `startDate` for an arrival, the `endDate`
   for a departure) is editable by reception from **`D` 00:00** until **`D+1` 04:00**, server local
   time. Outside that window it is locked.
2. **Why the 04:00 tail** (decision 2026-08-04): a check-in at 23:00 is regularly validated after
   midnight, and early check-outs start before dawn. The tail keeps a late-night SAS workable
   without ever opening the *following* day's arrivals. It is a single constant
   (`SAS_WINDOW_END_HOUR = 4`) so the rule can be retuned in one place.
3. **Lock reasons.** For a reception requester, each SAS resolves to exactly one reason, in this
   order of precedence:
   - **`done`** — the matching `…SasDoneAt` is set (whatever the date).
   - **`future`** — now is before `D` 00:00.
   - **`past`** — now is at or after `D+1` 04:00.
   - **`null`** — editable (inside the window, never committed).

   `done` wins over the date reasons: a SAS committed today is locked as « déjà effectué », not as
   « à venir ».
4. **The two SAS are independent.** The arrival window keys on `startDate` + `arrivalSasDoneAt`, the
   departure window on `endDate` + `departureSasDoneAt`. A locked arrival never locks the departure,
   and vice versa. (On a one-night stay both windows can be open on different days.)

### 3.2 Server enforcement (authoritative)

5. **Commit guard.** `POST /reservations/:id/sas/arrival` is refused with
   **403 `{ error: 'SAS_LOCKED', reason }`** when the requester is **reception-only** (holds
   `reception`, not `admin`) and the arrival lock reason is non-null. Same for
   `POST /reservations/:id/sas/departure`. The refusal happens **before any write** — no complement
   line, no caution flag, no history entry is touched.
6. **Status-toggle guard.** `PATCH /reservations/:id/payment` from a reception-only requester is
   refused with **403 `{ error: 'STATUS_LOCKED', reason }`** when it carries `checkInReady` /
   `checkInDone` and the **arrival date** is outside the window, or `checkOutDone` and the
   **departure date** is outside the window (decision 2026-08-04 — the toggles follow the same day
   rule as the SAS). The existing financial-field allowlist
   ([reception-role-checkin-only.md](reception-role-checkin-only.md) §3.5 rule 10) still runs first.
   **`done` is NOT a lock reason here:** a committed SAS leaves its status toggles editable for the
   rest of the window (fixing a mis-tick is not a re-edit of the SAS).
7. **Admin unchanged.** An `admin` (alone or combined with `reception`) never hits rules 5–6: full
   re-edit, any date. Accountant unchanged (still `FORBIDDEN_ROLE` on these paths).
8. **Read stays open.** `GET /reservations/:id/sas` remains allowed for reception on a locked SAS
   (read-only, finance-free by construction). It is what lets the client render the locked panel; it
   grants no write.
9. **The client never computes the window (fat backend).** The lock is resolved server-side and
   shipped in the payloads:
   - the **reception reservation view** (`GET /reservations`, `GET /reservations/:id`) gains
     `arrivalSasLock`, `departureSasLock` (reason or `null`), `checkInStatusEditable` and
     `checkOutStatusEditable` (booleans, rule 6);
   - `GET /reservations/:id/sas` gains `receptionLock: { arrival, departure }` (reasons), `null` for
     a non-reception requester.

   Admin / accountant payloads are untouched — the fields are simply absent, which every consumer
   reads as "no lock".

### 3.3 Client behaviour (reception-only)

10. **Planning arrival card.** A locked arrival keeps its icon but the SAS button is **disabled**,
    with a reason-specific tooltip:
    - `done` → « Check-in déjà effectué — modification réservée à l'administrateur »
    - `past` → « Check-in passé — seuls les check-in du jour sont modifiables »
    - `future` → « Check-in à venir — modifiable le jour de l'arrivée »
11. **Planning departure row.** Same on `DepartureMiniRow`, with « Check-out … » wording.
12. **Status checkboxes.** « Prêt » / « Arrivé » (arrival window) and « Parti » (departure window)
    are **disabled** outside their window, tooltip « Statut modifiable uniquement le jour de
    l'arrivée » (resp. « … du départ »). Inside the window they behave exactly as today, committed
    SAS or not (rule 6).
13. **Deep-link fallback.** `/planning?sas=arrival|departure&reservationId=:id` (used by the reduced
    reception Dashboard rows and by push notifications) still opens `ReservationSasDialog`. On a
    locked SAS the dialog renders a **locked panel** instead of the wizard — lock icon, one
    sentence, a single « Fermer »; no step, no field, no « Valider »:
    - `done` → « Ce check-in a déjà été validé le {date}. Sa modification est réservée à
      l'administrateur. »
    - `past` → « Ce check-in datait du {date}. Seuls les check-in du jour sont modifiables —
      contactez l'administrateur. »
    - `future` → « Ce check-in n'est possible que le {date}, le jour de l'arrivée. »
14. **Commit race.** A 403 raised while the wizard was already open surfaces the matching French
    sentence (inline + toast) instead of the raw error code.
15. **Admin UI unchanged.** No lock field reaches an admin payload, so every ✓ stays clickable with
    the « Revoir / modifier le check-in » tooltip and the wizard reopens pre-filled.

### 3.4 Out of the lock (explicitly unchanged)

16. The Planning housekeeping cards (laundry, breakfast, linen inventory, option / resource « fait »
    toggles) are untouched — they are not per-reservation SAS work.
17. The reception Dashboard keeps its date navigator: browsing another day is allowed, only *acting*
    on it is not.

**Edge cases:**
- Reception commits today's arrival → the ✓ turns green **and disabled** immediately (reason `done`);
  the status toggles stay editable until the window closes.
- 00:15, a guest who arrived yesterday at 23:00 → still inside the window (until 04:00), SAS
  committable. At 04:00 it flips to `past`.
- A one-night stay (arrives `D`, departs `D+1`): on `D` the arrival is editable and the departure is
  `future`; on `D+1` the arrival is `past` (after 04:00) and the departure is editable.
- The payload flags are computed **at fetch time**: a Planning left open across the 04:00 boundary
  shows a stale ✓ until the next reload. The server refusal is the real guard — the click then fails
  with the French message (rule 14). Acceptable: the Planning reloads on every SAS commit and on
  every date change.
- `arrivalSasDoneAt` NULL but `checkInDone = 1` (status ticked by hand) → the SAS is **not** `done`;
  it is editable if the date window is open.
- reception + admin on one account → admin wins: no lock anywhere.
- A reception user opens the deep-link for a locked SAS → locked dialog (rule 13), not a 403 (the
  read is allowed).

---

## 4. Architecture

> **Fat backend, thin frontend.** The window arithmetic, the reason resolution and both refusals live
> on the server; the reasons ride along in the payloads. The client only disables controls and prints
> the sentence matching a reason string — no date math, no role math.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `utils/sasEditWindow.js` | C | Pure window arithmetic: `SAS_WINDOW_END_HOUR`, `isWithinSasWindow(dateIso, now)` and `sasLockReason({ dateIso, doneAt, now })` → `null \| 'done' \| 'future' \| 'past'` (rules 1–3). Unit-tested. |
| `utils/` | `utils/receptionView.js` | T | `toReceptionReservationView(reservation, now)` also emits `arrivalSasLock`, `departureSasLock`, `checkInStatusEditable`, `checkOutStatusEditable` (rule 9). |
| `constants/` | `constants/roles.js` | T | Shared pure predicate `isReceptionOnly(user)` — was duplicated inline in `reservationsController`, `PlanningPage` and `Dashboard`. |
| `controllers/` | `controllers/sasController.js` | T | `commitArrival` / `commitDeparture`: 403 `SAS_LOCKED` + reason before any model call (rule 5). `getSas`: emit `receptionLock` (rule 9). |
| `controllers/` | `controllers/reservationsController.js` | T | `list` / `getById` keep calling the reception serializer (which defaults `now` to the server clock). `updatePayment`: 403 `STATUS_LOCKED` + reason on an out-of-window status write (rule 6). Uses the shared `isReceptionOnly`. |
| `middleware/` | `middleware/enforceRoleAccess.js` | T | No allowlist change — doc comment pointing at the controller guards (a state/date rule cannot live in a path allowlist). |
| `models/` | — | — | (none) — `startDate` / `endDate` / the two `…SasDoneAt` markers already ship with every read. |
| `database.js` | — | — | (none) — no schema change. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `constants/receptionSasLock.js` | C | The French copy for each `(mode, reason)` pair: `sasLockTooltip()`, `sasLockTitle()`, `sasLockMessage()`, `statusLockTooltip()`. One source for the cards + the dialog (rules 10–14). |
| `constants/` | `constants/roles.js` | T | Mirror of the server `isReceptionOnly(user)`; replaces the two inline copies. |
| `components/` | `components/ReservationCard.js` | T | Reads `reservation.arrivalSasLock` → disabled ✓ + tooltip; `checkInStatusEditable === false` → disabled « Prêt » checkbox. |
| `components/` | `components/DepartureMiniRow.js` | T | Same with `departureSasLock` / `checkOutStatusEditable` (« Parti »). |
| `components/` | `components/sas/ReservationSasDialog.js` | T | Renders the locked panel from `data.receptionLock[mode]`; maps a `SAS_LOCKED` / `STATUS_LOCKED` 403 to its French sentence. |
| `pages/` | `pages/PlanningPage.js` | T | Uses the shared role helper; no lock prop to pass any more (the payload carries it). |
| `pages/` | `pages/Dashboard.js` | T | Uses the shared role helper; disables the three status checkboxes per the payload flags. |
| `services/` / `api.js` | — | — | (none) — no new endpoint, no new parameter. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Tooltip`, `IconButton`, `Checkbox` (MUI), `useToast` | Nothing new needed for a disabled control. |
| **Created (new generic)** | — | The locked panel is a handful of lines inside `ReservationSasDialog`; the copy lives in `constants/receptionSasLock.js`, not in a component. |
| **Specific (kept feature-local)** | locked state inside `ReservationSasDialog` | Tied to the wizard's own state machine. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations` | — | + `arrivalSasLock`, `departureSasLock`, `checkInStatusEditable`, `checkOutStatusEditable` | Reception view only; absent for admin / accountant. |
| GET | `/api/reservations/:id` | — | idem | idem. |
| GET | `/api/reservations/:id/sas` | — | + `receptionLock: { arrival, departure }` | `null` for a non-reception requester. Allowed even when locked. |
| POST | `/api/reservations/:id/sas/arrival` | unchanged | `200 { ok, complementAmount }` / **`403 { error: 'SAS_LOCKED', reason }`** | `reason ∈ done \| past \| future`. Reception-only. |
| POST | `/api/reservations/:id/sas/departure` | unchanged | `200 { ok }` / **`403 { error: 'SAS_LOCKED', reason }`** | idem. |
| PATCH | `/api/reservations/:id/payment` | unchanged | `200` / **`403 { error: 'STATUS_LOCKED', reason }`** | Reception-only, out-of-window status write. `reason ∈ past \| future`. |

---

## 5. Data model

**No schema change.** The window reads the existing `reservations.startDate` / `endDate` and the
`arrivalSasDoneAt` / `departureSasDoneAt` markers.

**Data impact:** none — no migration, no backfill, no write path modified for admins.

## 6. UI / UX

**Planning — locked card (reception):** the SAS button renders `disabled` (MUI greys it); the
`<Tooltip>` is already wrapped in a `<span>`, so it still fires on the disabled button. The status
checkbox next to the ARRIVÉE / DÉPART badge greys out the same way with its own tooltip.

**SAS dialog — locked panel (deep-link):**

```
┌──────────────────────────────────────────────┐
│ 🔒 CHECK-IN DÉJÀ EFFECTUÉ                  ✕ │
│    Jean D. · Aventura lodge                  │
├──────────────────────────────────────────────┤
│                     🔒                        │
│   Ce check-in a déjà été validé le           │
│   04/08/2026. Sa modification est réservée   │
│   à l'administrateur.                        │
├──────────────────────────────────────────────┤
│                                    [ Fermer ] │
└──────────────────────────────────────────────┘
```

Header title per reason: « Check-in déjà effectué » (`done`), « Check-in passé » (`past`),
« Check-in à venir » (`future`) — and the « Check-out … » symmetry. Body copy per rule 13,
`{date}` = the SAS date (`dd/MM/yyyy`), omitted from the sentence when unparsable.

**Responsive:** the locked panel inherits the dialog's existing shell (`fullScreen` on `xs`) — one
paragraph + one full-width button. The planning ✓ keeps its 40px icon / ≥44px touch target at every
breakpoint; disabling changes colour only. The Dashboard checkboxes keep their `size="small"` cell
layout on `md+` and their stacked-card layout on `xs`.

**Sticky action bar:** not applicable — no page-level layout change (a card button, a checkbox, a
dialog).

## 7. Test plan

### Server unit tests
- [x] `tests/sas-edit-window.unit.test.js` — `isWithinSasWindow` / `sasLockReason`: inside the day,
      23:59, 00:15 next day (still inside), 04:00 next day (flips to `past`), day before (`future`),
      `done` precedence, invalid / missing date.
- [x] `tests/reception-sas-lock.unit.test.js` — `commitArrival` / `commitDeparture` 403 `SAS_LOCKED`
      with the right reason for `done` / `past` / `future` **and no model write**; 200 inside the
      window; admin and reception+admin never locked; the two SAS independent;
      `isReceptionOnly` truth table.
- [x] `tests/reception-status-window.unit.test.js` — `updatePayment` 403 `STATUS_LOCKED` on an
      out-of-window `checkInReady` / `checkInDone` / `checkOutDone` for reception; 200 inside the
      window (incl. on a committed SAS, rule 6); admin never locked; the financial-field allowlist
      still applies.
- [x] `tests/reception-view.unit.test.js` — the four new fields, per reason.

### Client unit tests (Vitest)
- [x] `ReservationCard.test.js` — each `arrivalSasLock` reason disables the ✓ with its tooltip;
      no lock → clickable; `checkInStatusEditable === false` disables « Prêt ».
- [x] `DepartureMiniRow.test.js` — same for the departure ✓ + « Parti ».
- [x] `ReservationSasDialog.test.js` — `receptionLock` renders the locked panel per reason (no
      stepper, no « Valider »); no lock → normal wizard; a 403 maps to the French sentence.
- [x] `roles.test.js` — `isReceptionOnly` truth table.

### Manual UI verification
- [x] « Accueil » account, today's arrival → SAS runs and commits; after commit the ✓ is green +
      disabled and the status toggles still work.
- [x] Same account: yesterday's and tomorrow's SAS → ✓ disabled with the `past` / `future` tooltip;
      their status checkboxes disabled too.
- [x] Deep-link on a locked SAS → locked panel + « Fermer » (desktop + 390px mobile).
- [x] Admin → every ✓ clickable, wizard reopens pre-filled (regression on
      [reopen-completed-sas.md](reopen-completed-sas.md)).
- [x] Live API: `POST …/sas/arrival` on a past / future / done SAS → 403 with the reason;
      `PATCH …/payment` out of window → 403; both 200 inside the window.
- [x] `npm run test:e2e` green.

### E2E (Playwright)

New infrastructure, reusable by any future reception spec: `server/scripts/seed-e2e.js` also seeds an
**« Accueil »** account, `e2e/global-setup.js` captures a second storage state
(`e2e/.auth/reception.json`), and `e2e/fixtures/authState.js` exposes both paths so a spec opts in
with `test.use({ storageState: RECEPTION_STORAGE_STATE })`. The API seed helpers keep using the admin
session — reception may not create anything.

- [x] `reception/sas-day-window.spec.js` — browser: today's ✓ is live while a future one is disabled
      with « Check-in à venir — modifiable le jour de l'arrivée », its status checkbox is disabled,
      clicking the locked ✓ opens no dialog, the deep-link lands on the locked panel (« Fermer », no
      « Valider »), and today's deep-link still opens the wizard at « Commencer ».
- [x] `reception/sas-day-window.spec.js` — API as reception: a past SAS → 403 `SAS_LOCKED/past` on
      both commits, `STATUS_LOCKED/past` on the status write, while `GET …/sas` stays 200 and carries
      `receptionLock`. A past stay is seeded through the real API in the future then back-dated with
      `dbSeed.setReservationDates` (`POST /reservations` refuses a stay in the past).
- [x] `reception/sas-day-window.spec.js` — today's SAS commits, then immediately re-locks as `done`
      (no grace period) while its status toggle stays open (rule 6), and the list payload reports
      `arrivalSasLock: 'done'` + `checkInStatusEditable: true`.
- [x] `reception/role-confinement.spec.js` — the confinement of
      [reception-role-checkin-only.md](reception-role-checkin-only.md), which had shipped without any
      E2E cover (see its §7).
- [x] **Mutation-checked**: removing the controller guard fails the two API tests; blanking
      `arrivalSasLock` in the reception view fails the browser test — each layer is guarded by its own
      assertion, neither test is vacuous.

## 8. Out of scope

- Any read-only *consultation* of a locked SAS by reception (decision 2026-08-04: hard lock, not a
  view-only reopen).
- A per-property or per-user override of the window (it is a single global constant).
- Locking the housekeeping cards (laundry / breakfast / linen) to the day — they are not SAS work.
- A live client-side clock that re-locks an open Planning at 04:00 without a reload (rule 9 edge
  case: the server refusal covers it).
- Any change to the admin re-edit behaviour.

## 9. Open questions

- Q: Locked button vs read-only reopen for a done SAS?
  - A: **Locked button** (AskUserQuestion 2026-08-04) — the ✓ stays visible but inert; the deep-link
    dialog shows a short locked message.
- Q: How much tolerance around the day for a late-night SAS?
  - A: **Until 04:00 the next morning** (AskUserQuestion 2026-08-04) — covers late arrivals and early
    check-outs without opening the neighbouring day.
- Q: Do the « Prêt » / « Arrivé » / « Parti » toggles follow the same day rule?
  - A: **Yes** (AskUserQuestion 2026-08-04) — the whole reception surface is confined to the day.
    Note this **reverses** the first iteration of this spec, where the toggles stayed free.
