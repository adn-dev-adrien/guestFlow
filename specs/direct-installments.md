# Installment plan for direct reservations

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/direct-installments` (from `inte/plugins`) |
| **Created** | 2026-10-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary page** | [docs/specs/2026-10-27-direct-installments.html](../docs/specs/2026-10-27-direct-installments.html) — interactive mock, 390 and 1280 px |

---

## 1. Context

A direct guest who books months ahead sometimes asks to pay in several times. GuestFlow cannot
express it: the money of a stay lives in **fixed buckets** — acompte, solde, arrival complement,
end-of-stay complement ([schema.sql](../server/src/schema.sql) `reservations.deposit*`,
`balance*`, `complement*`, `endOfStayComplement*`). Exactly two due dates exist, derived by
[paymentSchedule.js](../server/src/utils/paymentSchedule.js) (acompte at booking, solde
`balanceDaysBefore` days before arrival). The payments ledger
([reservation-payment-ledger.md](reservation-payment-ledger.md) §8) lists « several payments on one
acompte or solde » as out of scope.

Today the operator works around it by hand: notes in the fiche, amounts typed in the ledger, payment
links that do not exist for a partial amount, reminders from memory.

Decisions taken in chat on 2026-10-27:

- **Core feature**, not a plugin — any gîte selling direct needs it. The Qonto link and the email
  stay tied to the `online-payment` plugin, as every payment link already is.
- **Emails go through the « à valider » queue** — rule 44 of
  [payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) and
  [no-automatic-email-without-approval.md](no-automatic-email-without-approval.md) stand: no
  scheduled task sends a money email.
- **First installment at booking, last at the usual solde delay** (J-`balanceDaysBefore`), the
  others evenly spaced in between.
- **Amounts are frozen once the first installment is paid.** A price rise is spread over the unpaid
  installments; a price drop changes nothing.

## 2. Goal

From the fiche of a direct reservation, the operator splits what the guest owes into N installments
with editable dates, and each installment is requested by email with its own Qonto payment link on
its due date, after the operator validates it.

## 3. Functional rules

**Eligibility**

1. The échéancier is offered only when `isDirectChannel(reservation.platform)`
   ([platformNameFormat.js](../server/src/utils/platformNameFormat.js)) is true. Never a strict
   `platform === 'direct'` test. A devis (not yet a reservation), a cancelled reservation or a
   platform booking never offers it; the server refuses `PUT …/installments` with `409` and a French
   message.
2. It can be **created or changed in count** only while **nothing** has been collected on the stay:
   acompte, solde and every installment unpaid. Once money is in, the count is locked; removing
   the plan is locked too.
3. The plan needs room: at least 2 installments, at most 12, and never more installments than
   calendar days between the first and the last due date (two installments may not share a day).
   The server enforces it; the UI disables the « + » of the stepper at the limit.

**What is split**

4. The plan covers the **pre-arrival amount** — exactly what acompte + solde cover today
   (`preArrivalAmount` in [pricing.js](../server/src/utils/pricing.js)), tourist tax included.
   Arrival complement, end-of-stay complement and caution are untouched.
5. While a plan exists, the reservation's acompte and solde buckets are **replaced** by the
   installments: `depositAmount` and `balanceAmount` are 0, the ledger shows no acompte / solde row
   and no deposit/balance request or reminder applies. Removing the plan (rule 2) gives them back,
   recomputed by the usual split.

**Amounts**

6. Euro rounding: installments 1 … N−1 are `round(total / N)` to the whole euro (half up); the last
   one is `total − sum(others)` and carries the cents. Example: 1 001,50 € in 3 → 334 + 334 +
   333,50.
7. **Before the first installment is paid**, every recalculation of the reservation total
   (option added or removed, dates, guests) **recomputes all amounts** by rule 6. Dates stay as
   the operator left them.
8. **Once the first installment is paid, the amounts are frozen.** On every recalculation:
   - **Rise** `Δ = total − sum(installments) > 0` → Δ is spread over the **unpaid** installments by
     rule 6 applied to Δ (each gets `round(Δ / k)`, the last unpaid takes the remainder) and added to
     their frozen amount.
   - **Drop** `Δ < 0` → no installment changes. The ledger shows the gap as **« Échéancier au-dessus
     du séjour : X € »** (warning), so the operator decides: refund, gesture, or keep. Nothing is
     ever lowered automatically.
   - **All installments paid** → the rise goes to the arrival complement, exactly as today when
     acompte and solde are both paid (`autoGapBetweenDepositAndBalance`).
9. A paid installment never changes amount or date.
9a. **Amount typed by hand** (decided 2026-10-27). The amount of an unpaid installment other than
    the last unpaid one can be typed, in whole euros. The installment becomes **pinned**
    (`amountEdited`). What remains — `total − paid − pinned amounts` — is spread by rule 6 over the
    unpaid, non-pinned installments; the last unpaid installment is never pinned and always adjusts.
    The server refuses (`400`) an amount ≤ 0, or one that leaves less than 1 € per remaining
    non-pinned installment. Rules 7 and 8 respect pins: a recalculation moves only non-pinned
    installments, and a rise is spread over the unpaid non-pinned ones (the last unpaid if none
    other is left). Changing the count (rule 12) clears every pin.

**Dates**

10. Default dates: installment 1 = the day the plan is created; installment N =
    `max(today, startDate − balanceDaysBefore)`; installments 2 … N−1 evenly spaced between them,
    rounded to the day. If that leaves fewer days than installments, rule 3 refuses.
11. The date of an **unpaid** installment is editable. The server refuses (`400`, French message
    naming the installment) a date in the past, a date after the arrival day, or a date that breaks
    the strict order of the installments.
12. Changing the count (allowed by rule 2) recomputes the default dates; edited dates are lost and
    the UI says so before applying.
13. Moving the stay: dates are **not** moved. If an unpaid installment now falls after the new
    arrival day, it is clamped to the arrival day and flagged in the ledger.

**Statuses**

14. Each installment shows one status: **À venir** (due date in the future) · **À demander** (due,
    no request sent) · **Demandée le …** (request email sent, link open) · **Payée le …** (with mode:
    lien, virement, espèces…) · **En retard** (unpaid 3 days after the due date — decided 2026-10-27).

**Collection**

15. A paid Qonto link of type `installment` marks its installment paid (webhook and polling, same
    path as the other link types, [paymentPollRunner.js](../server/src/utils/paymentPollRunner.js)
    `applyPaidEffect`) and emits `reservation.paid`.
16. The operator can mark an installment paid by hand (virement, chèque, espèces…) with the ledger's
    existing « Marquer payé » form; the date validation of the other buckets applies (no future
    date).
17. A link is created per installment, at its exact amount, by `ensurePaymentLink`. If the amount
    changes (rule 8), the open link is retired and **deactivated at Qonto** before a new one is
    created, so the old URL can no longer be paid.

**Emails**

18. New template **`installment_request`** — « Demande de règlement d'une échéance » (FR + EN),
    shipped `sendMode: 'manual'`, gated by the `online-payment` plugin like the other request
    templates (`PLUGIN_OF_TEMPLATE`).
19. On the due date of every unpaid installment with no request sent, the template appears in the
    **« à valider »** queue, one entry **per installment**. Validating it creates or reuses the
    installment's link and sends the email.
20. Every installment row of the fiche also carries « Envoyer la demande » — the click is the
    validation, it works before the due date (typically installment 1, the day of the plan).
21. Variables: `installmentNumber`, `installmentCount`, `installmentAmount`, `installmentDueDate`,
    `paymentLink`, `installmentSchedule` (the whole plan as a short list: number, date, amount,
    paid or not), plus the usual reservation variables.
22. No automatic reminder and no cancellation for non-payment in this spec (§8). An « En retard »
    installment is visible in the ledger and in the dashboard's collection alert.

**Edge cases:**

- Reservation total ends below N euros → rule 6 would produce 0 € installments: the server
  refuses the plan (`400`).
- Option removed before any payment → amounts recomputed (rule 7), the last installment may drop.
- Option added after **all** installments are paid → arrival complement (rule 8).
- Price drop after the first payment, then a rise → the rise first absorbs the warning gap
  (Δ is computed against the total, rule 8), only the excess is added.
- Website booking paid online at booking (acompte or full) → rule 2: no échéancier on it.
- Platform switched from direct to a platform with a plan in place and nothing paid → the plan
  is deleted, acompte / solde come back. With money in → the switch is refused (`409`).
- Cancelling a reservation with a plan → open links retired and deactivated; paid installments stay
  in the ledger for the cancellation flow.

---

## 4. Architecture

> Fat backend: amounts, dates, statuses, gaps and eligibility are all computed on the server; the
> client renders `installmentPlan` from the fiche payload and posts the operator's two inputs
> (count, dates).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `reservations.js` | T | `PUT /:id/installments`, `DELETE /:id/installments`, `POST /:id/installments/:n/payment` |
| `routes/` | `payments.js` | T | `POST /reservations/:id/payment-emails` accepts `{ type: 'installment', installmentId }` |
| `controllers/` | `installmentsController.js` | C | Validates eligibility (rules 1–3), applies count/dates, triggers recompute |
| `controllers/` | `reservationsController.js` | T | Exposes `installmentPlan` in the fiche payload; recompute after every save |
| `controllers/` | `paymentsController.js` | T | Installment link + email on click |
| `models/` | `installmentsModel.js` | C | CRUD on `reservation_installments` (prepared statements) |
| `models/` | `paymentLinksModel.js` | T | `type 'installment'` + `installmentId`; one open link per installment |
| `utils/` | `installmentPlan.js` | C | Pure: default dates (rule 10), euro split (rule 6), frozen spread (rule 8), statuses (rule 14) |
| `utils/` | `pricing.js` | T | With a plan: acompte / solde = 0, pre-arrival amount handed to the plan (rules 4–5) |
| `utils/` | `reservationLedger.js` | T | Installment rows replace acompte / solde rows; gap row (rule 8) |
| `utils/` | `stayPaymentRecorder.js` | T | Records an installment payment, emits `reservation.paid` |
| `utils/` | `paymentPollRunner.js` | T | `applyPaidEffect` for `installment` links |
| `utils/` | `paymentRequestService.js` | T | `ensurePaymentLink` / `sendPaymentRequest` for one installment; deactivates the replaced link at the provider (rule 17) |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | `installment_request` (FR/EN, manual, gated by `online-payment`) |
| `utils/` | `emailContextBuilder.js` | T | Installment variables (rule 21) |
| `models/` | `emailLogModel.js` | T | `listPending` branch per due installment; dedupe per (template, reservation, occurrence) |
| `utils/` | `autoSendPolicy.js` | — | Unchanged; the template is manual and money templates stay out of the cron |
| `plugins/accounting-export/` | `accountingModel.js` | T | Books each paid installment as an encaissement on its paid date |
| `controllers/` | `dashboardController.js` | T | Late installments feed the collection alert |
| `database.js` | `database.js` | T | Table, `payment_links` CHECK + column, queue/log occurrence key (§5) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `InstallmentPlanCard.jsx` | C | « Échéancier » block inside the Finance section: count stepper, one row per installment |
| `components/reservation/` | `FinanceSection.jsx` | T | Renders the card for eligible fiches; hides acompte / solde rows while a plan exists |
| `components/reservation/` | `LedgerList.jsx` | T | Renders installment rows and the gap row sent by the server |
| `services/` | `api.js` | T | Three installment calls |
| `constants/` | `installmentStrings.js` | C | French labels and statuses |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `ConfirmDialog`, `PaymentMarkForm`, `ErrorAlert`, `LedgerList` | The status chip, the « edited dates will be lost » confirmation, the manual payment form. |
| **Created (new generic)** | — | The stepper and date fields are MUI primitives. |
| **Specific (kept feature-local)** | `InstallmentPlanCard` | Tied to the plan's rules; nothing else edits a list of dated amounts. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| PUT | `/api/reservations/:id/installments` | `{ count }`, `{ dates: [{ id, dueDate }] }` or `{ amounts: [{ id, amount }] }` | `{ installmentPlan }` | `409` ineligible (rules 1–2), `400` invalid count/date/amount (rules 3, 9a, 11) |
| DELETE | `/api/reservations/:id/installments` | — | `{ installmentPlan: null }` | `409` once money is in |
| POST | `/api/reservations/:id/installments/:installmentId/payment` | `{ paidDate, method }` | `{ installmentPlan }` | Manual mark (rule 16) |
| POST | `/api/reservations/:id/payment-emails` | `{ type: 'installment', installmentId }` | `{ sent, paymentUrl }` | Existing endpoint, new type |
| GET | `/api/reservations/:id` | — | `{ …, installmentPlan }` | Payload below |

```json
"installmentPlan": {
  "eligible": true,
  "countLocked": false,
  "frozen": false,
  "total": 1001.5,
  "gap": 0,
  "maxCount": 12,
  "installments": [
    { "id": 41, "number": 1, "dueDate": "2026-10-27", "amount": 334, "status": "toRequest",
      "statusLabel": "À demander", "editable": true, "amountEditable": true, "amountEdited": false,
      "paidDate": null, "method": null,
      "requestedAt": null, "linkUrl": null }
  ]
}
```

`eligible: false` with a `reason` string when the card must be hidden or explained.

---

## 5. Data model

New table, created idempotently in `database.js`:

```sql
CREATE TABLE IF NOT EXISTS reservation_installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  dueDate TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  paidDate TEXT,
  paidMethod TEXT,
  requestedAt TEXT,
  dateEdited INTEGER NOT NULL DEFAULT 0,
  amountEdited INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reservationId, number)
);
```

- `payment_links`: the `type` CHECK gains `'installment'` and a nullable `installmentId` column.
  SQLite cannot alter a CHECK: the table is rebuilt (create new, copy, swap) inside one
  transaction, rows preserved one-to-one.
- `email_manual_queue` and `email_log`: a column `occurrenceKey TEXT NOT NULL DEFAULT ''` joins the
  dedupe key (`installment:<id>` for this template, `''` for every existing template). The queue's
  primary key `(templateId, reservationId)` becomes `(templateId, reservationId, occurrenceKey)` —
  same rebuild-and-copy pattern.
- Amounts are stored in cents, like `payment_links.amountCents`.

**Data impact:** no existing reservation has a plan; every existing row keeps its meaning (`''`
occurrence key, existing link types). The two table rebuilds are the only risk: covered by a test
that runs the migration on a copy of the production schema and compares row counts and contents.
`CHANGELOG` gets a `Migration` fragment.

## 6. UI / UX

Interactive mock: [docs/specs/2026-10-27-direct-installments.html](../docs/specs/2026-10-27-direct-installments.html).

**Where:** inside the Finance section of the fiche, above the ledger, only for eligible fiches.

**No plan yet:** one line « Paiement en plusieurs fois » with a « Créer un échéancier » button.
Ineligible fiche (platform, devis): nothing shown.

**Plan:** title « Échéancier » + the count stepper (« 3 échéances », − / +, disabled at the limits
and once locked) + « Supprimer l'échéancier » (text button, only while nothing is paid). One row per
installment:

`N° · date (editable field while unpaid) · amount (editable field while unpaid, except the last unpaid) · status chip · action`

- Count stepper: rapid clicks must each count, on the button actually pressed. The client updates the
  displayed count at once, sends **only the final count** once clicks stop (300 ms), and ignores any
  response older than the last request, so a late reply never moves the count back. The stepper's
  DOM is never rebuilt between clicks (found on the mock, 2026-10-27).
- A typed amount shows a small « fixé » mark; the other unpaid amounts follow at once (server
  response). A refused amount turns the field red with the reason (« Laisse moins de 1 € à
  l'échéance 3 »).

- Action: « Envoyer la demande » (unpaid, online payment active), « Copier le lien » once sent,
  « Marquer payée » in the overflow.
- Invalid date: the field turns red, the message names the rule (« Après l'échéance 1 et avant
  l'arrivée du 14/06/2027 »), the previous value is kept server-side.
- Frozen plan with a rise: the changed rows show the added part (« +40 € option ») for the session.
- Gap (rule 8): warning line under the rows, « Échéancier au-dessus du séjour : 25 € ».
- Footer: « Total 1 001,50 € · payé 334 € · reste 667,50 € » (server values).

**Responsive:**
- `xs` (≤600 px): each row becomes a two-line card — number + status on top, date field + amount
  below, action full-width; stepper and delete stack.
- `md` / `lg`: one row per installment in a grid, actions on the right.
- No horizontal scroll at any width.

**PageActionBar:** unchanged; the plan saves on each change (like the ledger marks), not through the
fiche's Save button.

## 7. Test plan

### Server unit tests
- [ ] `tests/direct-installments.unit.test.js` — rule 6 split (1 001,50 / 3; 1 000 / 3; total < N refused)
- [ ] same file — rule 10 default dates (even spacing, last at J-30, short stay refused)
- [ ] same file — rule 7 recompute before payment; rule 8 rise spread on unpaid, drop frozen with gap, all paid → complement
- [ ] same file — rule 9a pinned amount (rest spread, last adjusts, refusals, pins kept on recompute and rise, cleared on count change)
- [ ] same file — rule 14 « En retard » at due date + 3 days
- [ ] same file — rules 1–3 eligibility (`isDirectChannel`, Lodgify-as-direct, devis, money already in)
- [ ] same file — rule 11 date validation (past, after arrival, out of order)
- [ ] `tests/direct-installments-links.unit.test.js` — link per installment, paid link marks the installment, amount change deactivates the old link
- [ ] `tests/direct-installments-emails.unit.test.js` — one queue entry per due installment, template manual, variables
- [ ] `tests/direct-installments-migration.unit.test.js` — rebuilds keep every `payment_links` / queue / log row

### Client tests
- [ ] `client/src/components/reservation/__tests__/InstallmentPlanCard.test.jsx` — renders payload, stepper limits, refused date message

### Manual UI verification
- [ ] Direct fiche, 3 installments, edit installment 2's date, add an option → amounts follow
- [ ] Mark installment 1 paid, add an option → spread on 2–3; remove it → amounts unchanged, gap shown
- [ ] « Envoyer la demande » on installment 1 → email in the log with a working sandbox link
- [ ] Next day of a due date: entry in « à valider »
- [ ] Mobile 390 px: rows as cards, no horizontal scroll
- [ ] Regression: a direct fiche without plan still shows acompte / solde; a Booking fiche shows no card
- [ ] `npm run test:e2e` green

## 8. Out of scope

- Automatic reminders and cancellation for non-payment of an installment.
- Installments on platform bookings, or chosen by the guest on the website booking engine.
- Lowering unpaid installments after a price drop (decided 2026-10-27: amounts frozen).
- Splitting the arrival / end-of-stay complements or the caution.

## 9. Open questions

- Q: Should the operator be able to type an installment's amount by hand (e.g. 500 € first, the rest spread)?
  - A: **Resolved 2026-10-27** — yes, on unpaid installments except the last unpaid one (rule 9a).
- Q: « En retard » threshold?
  - A: **Resolved 2026-10-27** — 3 days after the due date (rule 14).
- Q: When the plan is frozen and the total drops, should the gap be applied to the last unpaid installment on an explicit click (« Réduire la dernière échéance »)?
  - A: **Resolved 2026-10-27** — no: the gap is only shown, the operator settles it from the ledger (rule 8).
