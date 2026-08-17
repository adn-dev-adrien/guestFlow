# The SAS read must say which end it is (`?mode=departure`)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/sas-departure-mode-param` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

`GET /api/reservations/:id/sas` answers two different questions depending on the end of the stay it is
asked about, and [sasController.js](../server/src/controllers/sasController.js) reads that from
`req.query.mode`:

- **« le ménage est-il déjà vendu ? »** — at **check-in** the answer deliberately ignores the SAS's own
  upsell row (`sasArrivalOrigin = 1`), so the ménage step stays visible and the operator can undo what
  he just added ([sas-upsells-activate-catalogue-option.md](sas-upsells-activate-catalogue-option.md)
  §3.2 rule 7). At **check-out** the raw answer wins: a cleaning already sold can never be billed again
  ([defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md) §3.1 rule 1).
- the **resource-scheduling payload** is arrival-only.

The client never sent the parameter — `api.getReservationSas(id)` called the endpoint bare — so the
server always resolved `isDeparture = false`. Consequence, observed live on a Gîte stay whose ménage had
been added by the arrival SAS:

1. the departure SAS **asks** « Le ménage de fin de séjour a-t-il été fait correctement ? »;
2. answering « Pas OK » adds **80 €** to the « Total à percevoir » on the recap;
3. the commit's own guard drops the line (the cleaning is sold), so **nothing is billed** — the operator
   collected, or thinks he must collect, an amount the server refuses to record.

The check-out SAS also computed an arrival-only scheduling payload on every read for nothing.

## 2. Goal

The departure SAS asks the server the departure question: a ménage already sold is not re-asked, and the
recap never announces an amount the commit will throw away.

## 3. Functional rules

1. **The client sends the mode.** `api.getReservationSas(id, mode)` appends `?mode=arrival|departure`;
   the SAS dialog passes the mode it was opened with. Omitting it stays valid (server default =
   arrival), so no other caller breaks.
2. **At check-out, `cleaning.included` is the raw « is it sold? »** — booked option, property default, or
   a « Ménage » row the arrival SAS added. The end-of-stay ménage step is then **hidden** and the recap
   prints « Ménage déjà réglé — aucune facturation de fin de séjour. » (existing rendering, now actually
   reachable).
3. **At check-in nothing changes**: the ménage step stays visible when the only reason the cleaning is
   « included » is the SAS's own row, so « Non merci » can still remove it.
4. **The read stays side-effect free** and the commit guard is unchanged — it remains the authority that
   drops an end-of-stay cleaning line for a stay whose cleaning is sold.
5. The **resource-scheduling payload** is no longer computed on a departure read (already gated on
   `isDeparture`, now correctly resolved).

**Edge cases:**
- Cleaning NOT sold → the departure ménage step still shows and still bills. Unchanged.
- A reservation whose ménage was sold on the fiche (not by the SAS) → already hidden before this fix,
  still hidden.
- An old client build calling without the mode → server answers as before (arrival flavour); no error.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `controllers/sasController.js` | — | Unchanged — it already reads `req.query.mode`; it was simply never given one. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `services/` | `api.js` | T | `getReservationSas(id, mode)` → appends `?mode=…` when a mode is given. |
| `components/` | `components/sas/ReservationSasDialog.jsx` | T | Passes its `mode` prop to the read, and lists it in the effect's dependencies so re-opening on the other end re-fetches. |

### 4.3 API contract

Unchanged and already documented: `GET /api/reservations/:id/sas?mode=arrival|departure`. This change
only makes the client use it.

---

## 5. Data model

No change.

## 6. UI / UX

Check-out wizard: one less page when the cleaning is already sold (the step count follows), and the
recap shows « Ménage déjà réglé — aucune facturation de fin de séjour. » instead of an 80 € line that
would never be billed.

## 7. Test plan

### Server unit tests (`server/src/tests/sas-departure-mode.unit.test.js`, 3 tests)
- [x] `getSas?mode=departure` on a stay whose ménage is a SAS-origin row → `cleaning.included = true`
      and `resourceScheduling.applicable = false`.
- [x] The same read without a mode (check-in flavour) → `cleaning.included = false` (the SAS keeps the
      right to undo its own upsell) and the scheduling payload is present.
- [x] A ménage sold on the fiche (not SAS-origin) → `included = true` on both ends.

### Client tests (vitest)
- [x] The dialog reads with `('departure')` resp. `('arrival')` as second argument.

### Manual UI verification
- [x] Departure SAS re-run on the Gîte stay of the bug report: the ménage question is gone, the recap
      says « Ménage déjà réglé », and the total no longer announces the 80 €.

## 8. Out of scope

- Changing the commit-side guard (it is the authority and stays as is).
- The « ménage » wording or the arrival-side upsell flow.

## 9. Open questions

None.
