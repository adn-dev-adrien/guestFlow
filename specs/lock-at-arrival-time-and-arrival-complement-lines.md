# Lock the fiche at the arrival time, and list what the arrival complement contains

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/lock-at-arrival-time-and-arrival-complement-lines` |
| **Created** | 2026-11-13 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Builds on** | [mid-stay-extras-on-locked-fiche.md](mid-stay-extras-on-locked-fiche.md), [arrival-moment-is-the-check-in.md](arrival-moment-is-the-check-in.md) |

---

## 1. Context

Two findings on reservation **11773** (id 22308, Gîtes de France, 13→15/11/2026, arrival 16:00).

1. **« Complément d'arrivée 63,80 € à payer ».** Nothing is broken: on 12/11 at 20:06 the check-out time
   went from 10:00 to 13:30, which added the option **Départ tardif** (63,80 €, `inComplement = 1`).
   Platform stays are paid by the platform up to the brut; what the guest adds afterwards is collected
   on arrival, so the line sits in the arrival complement. The fiche said « Complément d'arrivée
   63,80 € » and **nothing else** — the « Détail » of that row has no list, unlike the end-of-stay
   complement, so the operator could not tell what the 63,80 € were.
2. **The lock starts at midnight.** `startDate <= today` locks the fiche at 00:00 of the arrival day,
   ~16 hours before the guest is there. On 13/11 the fiche of 11773 was already locked while the guest
   had not arrived; every edit went through the « mid-stay extras » door (lines routed to the
   end-of-stay complement) instead of the normal one.

## 2. Goal

- The fiche is **locked only once the stay has started**: the arrival time on the arrival day (or
  earlier if the check-in / arrival SAS is validated).
- The « Détail » of the arrival complement **lists what it contains**, line by line, with the same
  component as the end-of-stay complement.

## 3. Functional rules

### 3.1 The lock moment

1. A stay **has started** when one of these holds, evaluated by the server on the process clock
   (Europe/Paris, `specs/server-timezone.md`):
   - `startDate < today`;
   - `startDate = today` and `checkInTime` (`HH:MM`) is ≤ the current time;
   - `startDate = today` and the arrival was marked: `checkInDone = 1` or `arrivalSasDoneAt` set
     (`hasGuestArrived`, [arrival-moment-is-the-check-in.md](arrival-moment-is-the-check-in.md)).
   A stay on its arrival day **without a `checkInTime`** starts at 00:00 (today's behaviour — nothing to
   wait for).
2. This single definition replaces `startDate <= today` everywhere the fiche lock is decided:
   `midStayExtrasWindow` / `buildEditLock` (read), `pastReservationLocked` and the `started` test of
   the PUT, the ledger-edit refusal of the quote. One helper, no second copy.
3. The client keeps deriving nothing: it reads `editLock.locked` (unchanged contract).
4. Before the moment, the fiche is a normal fiche: every field editable, the complement computed live
   as usual, no « Séjour commencé » banner.
5. The guest-app shop (`shopState`) keeps its calendar-day reading on purpose: it opens with the arrival day.
6. Out of the lock decision: `paymentDeadlines.arrived`, the platform price check and the clients
   « in stay » filter keep their calendar-day reading — they answer other questions.

### 3.2 The arrival complement's list

6. The « Détail » of the **arrival complement** row (and of the merged arrival + end-of-stay row)
   renders its lines through the same `ComplementDetail` component as the end-of-stay complement:
   `label : amount` per line — options, resources, « Voyageurs ajoutés », taxe de séjour, and the
   remainder line when the stored amount exceeds what is itemised.
7. The lines are **server-shaped** (CLAUDE.md §6.0): the live quote already carries them
   (`complementDetailLines`, pricing.js), and `GET /api/reservations/:id` gains `arrivalComplementLines`
   (from `buildArrivalComplementDetail`) for a fiche shown from its stored state (locked, not dirty).
   The client picks live-vs-stored exactly as it does for the end-of-stay lines and sums nothing.
8. The lines sum to the complement amount (invariant of `buildArrivalComplementDetail`); an adjusted
   amount keeps showing the lines, and the existing « Montant ajusté » field stays below them.

## 4. Architecture

### 4.1 Server side (`server/src/`)

- `utils/arrivalMoment.js` — add `hasStayStarted(row, today, nowTime)`: the rule 1 definition.
- `utils/midStayExtrasWindow.js` — `midStayExtrasWindow` / `buildEditLock` call it instead of `startDate <= today`.
- `controllers/reservationsController.js` — `pastReservationLocked`, `started`, ledger-edit `startedStay` call it; `getById` adds `arrivalComplementLines` and passes `nowTime`.
- `models/reservationsModel.js` — `getEditLock` takes `nowTime`.

### 4.2 Client side (`client/src/`)

- `components/reservation/FinanceSection.jsx` — the `complement` and `checkoutComplement` slots pass `lines` to the existing `ComplementDetail` (no new component).
- `pages/ReservationPage.jsx` — nothing to change if the lock already reads `editLock.locked`; verified during implementation.

### 4.3 API contract

- `GET /api/reservations/:id` — adds `arrivalComplementLines: [{ kind, label, qty, unitPrice, amount }]`. Additive.
- `editLock.locked` — same shape, new moment.

## 5. Data model

None.

## 6. UI / UX

- « Détail » on the arrival complement now opens the same block as the end-of-stay one: the list, then « Montant ajusté ». Mobile identical (the list wraps; `overflow-wrap: anywhere`).
- Before the arrival time the fiche carries no lock banner and nothing is greyed.
- Interactive summary: `docs/specs/2026-11-13-lock-at-arrival-time-and-arrival-complement-lines.html`.

## 7. Test plan

### Server unit tests

`server/src/tests/stay-started-at-arrival-time.unit.test.js` (6): day before / arrival day before and after `checkInTime` / no `checkInTime` / `checkInDone` early / `arrivalSasDoneAt` early / `editLock.locked` and PUT lock agree on the boundary.
The payload lines reuse `buildArrivalComplementDetail`, already covered by `arrival-payment-detail.unit.test.js`.

### Client

`FinanceSection.arrival-complement-lines.test.jsx` (2) — stored lines listed; live quote lines win.

### Manual UI verification

Reservation with an arrival-day `checkInTime` in the future (open, no banner) then in the past (locked); « Détail » of the complement at desktop and ≤ 600 px.

## 8. Out of scope

- Why Départ tardif costs 63,80 € (10 % of the stay) — unchanged pricing.
- Moving the late-checkout line out of the arrival complement.
- Fixing `paymentDeadlines.arrived` and other calendar-day readings.

## 9. Open questions

None. Resolved 2026-11-13: the lock starts at the arrival time **or** when the check-in is marked, whichever comes first (Adrien).
