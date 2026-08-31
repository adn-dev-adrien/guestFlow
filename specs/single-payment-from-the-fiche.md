# Record the single arrival payment from the fiche

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/single-payment-from-the-fiche` |
| **Created** | 2026-08-31 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

[single-payment-at-check-in.md](single-payment-at-check-in.md) (v2.9.0) lets the operator collect the
stay and the arrival complement **in one gesture** — but only from **inside the arrival SAS**, at the
moment of the check-in.

Real life does not always cooperate. A guest paid everything at the door, and the operator recorded
nothing at the time — or recorded the check-in without settling. The stay and the complement then sit
unpaid on the fiche, and the only way to get the single payment is to **re-open the SAS**.

Re-opening is designed to be safe and it very nearly is: measured on a real closed check-in
(2026-08-31), the breakfast composition, the options sold during the SAS, their quantities, their
served covers, the caution and the handover note all come back and are re-written identically. But it
is **not free**: the « préparé » flag on the planning cards is lost, because the wizard sends its
moments back as `{date, time}` and drops the flag on the way. Walking a whole wizard again — eleven
pages, several questions whose wrong answer *removes* a sale — to record one payment is also a poor
trade.

The fiche already carries every per-bucket control (« Marquer solde payé », « Marquer complément
payé », « Caisse interne »). What it cannot do is say **« these were one payment »**.

## 2. Goal

From the reservation fiche, in one click, record that the stay and the arrival complement were
collected **as a single payment** — with the same effects as the SAS's unified settlement (same
buckets, same date, same accounting, the same group read by the fiche and the Comptabilité) and
**without touching anything the check-in recorded**.

## 3. Functional rules

### 3.1 When the control is offered

1. **Above the payment buckets**, in the same place the « Encaissé à l'arrivée » line already renders
   ([single-payment-at-check-in.md](single-payment-at-check-in.md) rule 16) — that block becomes the
   control when there is no group yet, and the summary once there is one.
2. **Shown only when at least TWO arrival buckets are collectible**: an acompte that is applicable,
   > 0 and unpaid; a solde likewise; an arrival complement > 0 and unpaid. Fewer than two → nothing is
   shown, because a group of one is not a group — the existing per-bucket buttons already cover it.
3. It announces what it will collect: « Encaisser en une fois : 852,82 € » and, underneath, the
   buckets it covers with their amounts (« solde 720,82 € · complément 132,00 € »).
3bis. **The collection date is the operator's**, not the clock's (2026-08-31). A guest who paid at the
   door yesterday is recorded at yesterday's date, and the field sits right there in the block,
   pre-filled with today — the same date the per-bucket « Payé le » fields already carry, set on every
   bucket at once and on the group.
   That date **decides the accounting month**: entries are exported in the month of their paid date,
   and the group's own date is what folds them into one card. Two guards follow:
   - a date **in the future is refused** (« Un encaissement ne peut pas être daté dans le futur ») —
     the money has not been received, and the entry would book into a month nobody is looking at yet;
   - a date **before the booking existed** is refused, for the same reason in the other direction.
   Any other past date is accepted: recording late is exactly the case this feature exists for.
4. **Never shown to a reception-only user** ([reception-role-checkin-only.md](reception-role-checkin-only.md)):
   the fiche is finance-stripped for that role, and the amounts are not in its payload.

### 3.2 What it does

5. **Two actions, the same grammar as everywhere else**: **« CB / Chèque »** (ordinary accounting) and
   **« Caisse interne »** (off the books — accounting, export and turnover, exactly as a cash
   complement, [cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md)).
6. One click settles **every collectible bucket at once**, with **the chosen date** (rule 3bis) on
   each, then records the group at that same date. A bucket that is already paid is left strictly
   alone and is not named by the group.
7. **The per-bucket contribution snapshot runs on every stay bucket it flips**, exactly as
   `PATCH /reservations/:id/payment` does today (`captureContribsOnFlip`). It stays **best effort**
   for the same reason as at check-in ([single-payment-at-check-in.md](single-payment-at-check-in.md)
   §3.2, and rule 13 of the spec before it): on a booking whose stored solde is the platform's own
   figure the capture legitimately fails, and losing the whole payment over an attribution the
   operator cannot fix would be worse than storing it with NULL contribs.
8. **Nothing else is touched.** No SAS page runs, no option is re-resolved, no `cardOccurrences` is
   re-written — so the planning « préparé » flags, the breakfast composition and the sold prestations
   are untouched by construction. That is the whole point of the control.
9. **History**: the fiche's « Historique des modifications » records « Paiement unique encaissé à
   l'arrivée » with the amount, the means and the buckets covered.

### 3.3 Undoing it

10. When a group exists, the block shows the payment (rule 16 of the previous spec) plus **« Annuler
    ce paiement »**. It un-settles **exactly the buckets the group named** — `*Paid`, `*PaidDate`,
    `*PaidCash` cleared, `clearContribsOnUnflip` called — and dissolves the group. A bucket paid
    outside the group is never touched.
11. Un-ticking a single bucket by its own button keeps its existing behaviour and **dissolves the
    group** as well (already true since v2.9.0: the group dies with any bucket it names). The fiche
    then stops announcing a payment that is no longer true.

### 3.4 What this is not

12. It does **not** replace the per-bucket buttons: an operator who really collected the solde on
    Tuesday and the complement on Thursday keeps recording two payments, which is the truth.
13. It does **not** re-price anything. The amounts are the stored bucket amounts; no quote is replayed
    beyond the contribution capture of rule 7.
14. It does **not** reach the end-of-stay complement or the mid-stay notes: those are collected at
    another moment and are never part of an arrival group — same boundary as at check-in.

**Edge cases:**
- Only the complement is due (the ordinary prepaid stay) → no control; « Marquer complément payé »
  already does the job.
- Complement already paid, stay still due → no control (one bucket left).
- A reservation with a group whose complement is later adjusted → the group keeps the amount actually
  collected; the difference is an ordinary unpaid complement, as at check-in.
- Devis (`kind = 'devis'`) → no payment buckets at all, no control.
- Cancelled reservation → the fiche is read-only for money; no control.

---

## 4. Architecture

> **Fat backend.** Which buckets are collectible, what the total is, what gets written and the group
> itself are all resolved server-side. The fiche renders the payload and posts an intent.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `utils/arrivalPaymentGroup.js` | T | New pure `collectibleArrivalBuckets(row)` → `[{ bucket, amount }]`: the buckets that are applicable, > 0 and unpaid. Shared by the payload and the write, so the fiche can never be offered something the server would refuse. |
| `controllers/` | `controllers/reservationsController.js` | T | `getById` exposes `arrivalPayment.collectible` (`{ total, buckets[] }`, absent for reception). New `settleArrivalPayment` handler: settle every collectible bucket + capture contribs + write the group, or undo the group. Reuses `resolveStayPayment` / `resolveComplementPayment` and `captureContribsOnFlip` rather than re-implementing the rules. |
| `routes/` | `routes/reservations.js` | T | `POST /:id/arrival-payment` (`{ mode: 'card' \| 'cash' \| 'undo' }`). |
| `models/` | `models/reservationsModel.js` | T | `settleArrivalBuckets(reservationId, { mode, date })` — one transaction, mirroring what `commitArrivalSas` does for the same buckets, and `releaseArrivalPaymentGroup` for the undo. |
| `utils/` | `utils/arrivalPaymentDate.js` | C | Pure validation of the collection date (rule 3bis): format, not in the future, not before the booking. Returns the reason, so the API and the field say the same thing. |
| `utils/` | `utils/receptionView.js` | T | Strip `arrivalPayment.collectible`; the route refuses the write for that role. |
| `utils/` | `utils/reservationAudit.js` | T | The history line of rule 9. |
| `database.js` | — | — | **No migration**: `arrivalPaymentGroup` and `complementPaidAtArrival` shipped in v2.9.0. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/reservation/FinanceSection.jsx` | T | The block above the buckets becomes: the « Encaisser en une fois » control when `arrivalPayment.collectible` has ≥ 2 buckets, the « Encaissé à l'arrivée » summary + « Annuler ce paiement » when a group exists. |
| `services/` | `api.js` | T | `settleArrivalPayment(id, mode)`. |
| `pages/` | `pages/ReservationPage.jsx` | T | Carries `arrivalPayment` (already done in v2.9.0) and reloads the finance block after the call, like the other money actions. |

### 4.3 API contract

- `GET /api/reservations/:id` — `arrivalPayment` gains `collectible: { total, buckets: [{ bucket, label, amount }] }`. Absent (or empty) when fewer than two buckets are collectible, and for a reception-only user.
- `POST /api/reservations/:id/arrival-payment` — body `{ mode: 'card' | 'cash' | 'undo', date: 'YYYY-MM-DD' }`. `date` is required for `card`/`cash`, ignored for `undo`, and **validated server-side** (rule 3bis) — the client proposes it, it is never trusted. Returns the refreshed `arrivalPayment` + the bucket flags, so the fiche re-renders without a second round-trip. `403` for reception, `409` when the state moved under the operator, `400` with the reason when the date is refused.

## 5. Data model

**No change.** `arrivalPaymentGroup` and `complementPaidAtArrival` were added in v2.9.0 and carry
everything this feature needs.

## 6. UI / UX

- **No group yet, ≥ 2 buckets collectible** — a bordered block above « Acompte » / « Solde »:
  « Encaisser en une fois : 852,82 € », the covered buckets in a caption, an **« Encaissé le » date
  field** pre-filled with today, then two buttons **« CB / Chèque »** and **« Caisse interne »**.
  A refused date shows its reason under the field and leaves both buttons disabled — the operator
  never discovers the problem after the write.
- **Group present** — the v2.9.0 summary line, plus a discreet **« Annuler ce paiement »**.
- **Caisse interne** adds the usual « hors comptabilité » caption, so the consequence is never hidden
  behind a word.
- **Responsive**: the two buttons stack on `xs` and stay ≥ 44 px; the block never widens the fiche.

## 7. Test plan

### Server unit tests — 20 new, suite at 3757
- `collectibleArrivalBuckets`: applicable/unpaid only; a disabled acompte excluded; a 0 € complement
  excluded; already-paid buckets excluded.
- `settleArrivalBuckets`: card → every collectible bucket paid **at the chosen date**, not cash, group
  written at that same date with the right total and buckets; cash → all cash-flagged and off the
  books; a single collectible bucket → settled but **no group**; `undo` → exactly the group's buckets
  reverted, group cleared, a bucket paid outside it untouched.
- `arrivalPaymentDate`: a future date and a pre-booking date are refused with their reason, and
  **nothing is written** when they are — the check runs before the transaction opens.
- A backdated payment lands in the accounting month of ITS date, not of the write: two buckets settled
  at 2026-08-30 export in August even when recorded in September, carrying the same group.
- The contribution capture runs on the stay flips, and a capture that throws does not lose the payment.
- **Nothing else moves**: options, `cardOccurrences` (« préparé » flags included), breakfast counts and
  `complementAmount` are byte-identical before and after — the regression this feature exists to avoid.
- Reception: the write is refused, the payload carries no amount.

### Client tests (vitest) — 7 new, suite at 1175
- The control appears only with ≥ 2 collectible buckets, and never once a group exists.
- « CB / Chèque » posts `mode: 'card'` with the date shown in the field; « Caisse interne » posts
  `mode: 'cash'`. Changing the date changes what is posted.
- A future date disables both buttons and shows its reason.
- With a group, the summary and « Annuler ce paiement » render; the control does not.

### Full suites (2026-08-31)
- [x] `cd server && npm test` — 3757 tests.
- [x] `cd client && npx vitest run` — 1175 tests.
- [x] `cd client && npm run build`.
- [x] `npm run test:e2e`.

### Manual UI verification
- On a copy of production: a reservation with an unpaid stay and an unpaid complement → « Encaisser en
  une fois », **backdated to the day the guest actually paid** → one line on the fiche, **one card in
  the Comptabilité of THAT month**, and the planning « préparé » flags of that stay verified untouched.
- The same in caisse interne, then « Annuler ce paiement ».
- Mobile (`xs`) at 420 px.
- [x] **Done 2026-08-31** on a copy of production (réservation 11, solde 1 933,52 € + complément
      21,00 € dus): the control announced « Encaisser en une fois : 1 954,52 € », was **backdated to
      2026-08-17**, and settled both. The fiche then reads « Encaissé à l'arrivée : paiement unique de
      1 954,52 € le 17/08/2026 — CB / Chèque », the Comptabilité of **August** carries the two entries
      under the group `11:2026-08-17`, and a byte-level diff of the reservation's options, their
      `cardOccurrences` and the breakfast counts shows **no change at all**. « Annuler ce paiement »
      put it back. Checked at 1280 px and 420 px (buttons stacked, full width).

## 8. Out of scope

- Grouping buckets **already paid** on separate days after the fact.
- The end-of-stay complement and the mid-stay notes.
- Fixing the SAS's lost « préparé » flag — a separate bug, worth its own fix, and this feature removes
  the main reason to hit it.

## 9. Open questions

- **Q1 — should « Annuler ce paiement » also exist for a group made by the SAS?** As written, yes: the
  group is the same object whoever made it. Worth confirming that undoing a check-in's payment from
  the fiche is wanted, rather than only from the SAS.
