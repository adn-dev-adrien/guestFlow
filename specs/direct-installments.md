# Installment plan for direct reservations

| Field | Value |
|---|---|
| **Status** | Implemented |
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
   333,50. When rounding up would leave the last share too small, rule 32 applies.
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

**Implementation rules** (added 2026-10-27, while building — nothing above is renumbered)

23. **The stay's row carries the plan's totals.** `reservations.installmentsPaidAmount`,
    `installmentsUnpaidAmount` and `installmentsTarget` (the pre-arrival amount of the last
    recalculation) are written by every write on the plan. Every reader of the stay's money that already
    loads the row — `remainingToPay`, `comptaCollected`, `isSettled`, `computePaymentStatus`, the finance
    pages — takes them from there, so none of them learns about the table. `bucketStates` gains an
    `installments` bucket. (Revised 2026-10-27: the arrival SAS does know installments — rule 36.)
24. **Frozen means « any installment paid »**, not only the first (rule 8): money collected on installment 2
    while 1 is still open freezes the plan just as well.
25. **What a rise added is stored** (`reservation_installments.addedCents`, shown as « +X € ajoutés »
    beside the amount) until the next recalculation, so the card needs no previous state to show it.
    Every other write on the amounts resets it.
26. **The engine reads the plan itself.** `calculateReservationQuote` asks `reservation_installments` by
    `bookingId` and ignores the plan when the platform is not an own channel (rule 1: a switch away
    ends the plan with the save). With a plan: acompte, solde and their due dates are 0 / null; a rise
    on a fully paid plan goes to the arrival complement (rule 8); installments paid above a lowered total
    surface as `overCollectedTtc` (trop-perçu), like a paid solde.
27. *Superseded by rule 39 (2026-10-27)*: the installment link no longer is a single 0 %-VAT line.
    > **Sans test** — superseded by rule 39, which is tested.
28. **A payment received for a link whose amount the plan has since moved** (rule 17) is booked on its
    installment at the amount really received (pinned), whether the link was retired (poll) or is still open
    (webhook, poll); the other unpaid installments rebalance; an installment paid meanwhile another way makes
    it a double payment — nothing recorded, the payment id stays on the link row, the admin is told. Every
    save that moves an amount — the fiche, `performUpdate` for a plugin, the SAS, mid-stay extras — retires
    the links that bill the old amount (marker kept, the poll deactivates them should the provider fail).
29. **Accounting**: each paid installment is one encaissement (`kind: 'installment'`, `installment:
    { number, count }`) at its paid date, built on the stored-money path of the solde (a plan never
    captures per-line contribs); the tourist tax is shared in proportion to the plan's scheduled total.
30. **Eligibility payload**: `eligible: false` hides the card (platform, devis, cancelled); `eligible: true,
    canCreate: false` shows the empty line with the reason (money already in, too close to the arrival).
    `DELETE` answers the same payload with no installments, not `null`.
31. The card's layout follows **its own width** (container query), not the window's: the fiche column is
    narrow even on a laptop, so the two-line card layout also serves there; the one-line row needs 720 px.
    > **Sans test** — CSS layout, verified visually at 390 / 1280 / 1920 px.
32. **Rounding that never starves or lowers an installment.** Rule 6's half-up rounding stays the default.
    When it would leave the last share under 1 € (plan creation, a typed amount's spread, a recompute with
    pins) — or a negative share (the spread of a rise, rule 8) — every share is floored to the euro instead and
    the last takes the remainder, so it is never smaller than the others. A rise never lowers any
    installment: 1,50 € over 3 unpaid installments adds 0 + 0 + 1,50 €.
33. **A plan covered by what was collected is not owed.** When the installments paid reach the stay's total
    (a drop after payments, rule 8), the unpaid ones are no longer due: the stay's unpaid aggregate is 0,
    « Reste à percevoir » ignores them, they leave the « à valider » queue and the collection alert, the
    request button is hidden (`settled: true`, `canRequest: false`). The rows stay on the ledger with the gap
    warning for the operator to settle.
34. **Money with no installment to land on.** A paid link whose installment no longer exists (plan resized,
    removed, platform switch) books nothing and is never called « installment-marked » or a double payment:
    the admin is told « money received, unallocated » (`notifyPaidAfterCancel`). A link paid for an
    installment already collected another way is a double payment: nothing recorded, the admin is told.
35. **Links follow the plan.** Creating a plan retires and deactivates the stay's open acompte / solde / full
    links and is refused (409) when one of them is paid; removing or resizing a plan, or switching platform,
    retires the installment links (checked against the provider first — a link paid meanwhile refuses the
    change). A bucket already collected is never zeroed by a plan (the engine ignores the plan, « Marquer
    acompte / solde perçu » is refused on a stay with a plan). A link minted while the plan was changing is
    cancelled at once.
36. **Unpaid installments are due at arrival.** `stayDueAtArrival` counts them (`installments.due`), the SAS
    stay step offers them, and settling there marks every remaining installment paid today with the mode chosen
    at the door (« CB / Chèque » → `card`, « Espèces » → `cash`); « Pas maintenant » leaves them as they are. The payment-deadline
    card shows `unpaid_at_arrival` for a plan unpaid once the guest has arrived.
37. **Fiscal attribution.** When every installment is paid, the stay attaches to the day of the last one
    (`reservations.installmentsLastPaidDate`, in JS `attributionDate` and its SQL twin).
38. **Bank reconciliation.** Each installment is an expected receipt (`installment-<n>`, espèces excluded); a
    confirmed transfer marks it paid through the core's mark (`applyPaymentMark` with `installmentId`), same
    guards. « Défaire » cannot take an installment back.
39. **VAT basket and tourist tax shares.** The link of an installment carries the VAT basket of its share of
    the stay; the tourist tax (when it rides the pre-arrival money) is shared in proportion to the amounts
    over the plan, exempt of VAT, the last installment taking what is left, so the shares add up to the tax.
    The accounting export uses the same shares (rule 29).
40. **Concurrency.** Link creation is serialised per installment, and a second « Envoyer la demande » on an
    installment already being requested answers 409 instead of sending a second mail.
41. **A request queued by hand** (template chosen in « Créer un email ») is queued for the installment it
    resolves to (the first unpaid), under that installment's occurrence key, so sending it closes the entry.
42. **Queue availability.** Installment entries — dated or queued by hand — are proposed only while a payment
    provider is ready.
43. **Hard guard of rule 44 of the payment-schedule spec.** A template that asks for money
    (`PAYMENT_STABLE_KEYS`, `installment_request` included) never sends from the 08:00 pass whatever its
    stored mode, and the template editor refuses to set it to « auto » (409).
44. **The card follows the SAVED fiche.** While the fiche form has unsaved changes the card is read-only with
    « Enregistrer la fiche avant de modifier l'échéancier »; the arrival bound of a date is the saved one
    (`arrivalDate` of the payload).

**Fixed at the 2026-10-27 audit**

45. **A plan is revenue.** The « total de séjour » of the Finance pages (`financeModel.totalSejour`)
    counts the plan's collected and still-due totals, since the engine zeroes the acompte and the solde
    (rule 5): revenue, per property and per channel, booking pace, projection and the iCal cancellation
    snapshot all read it, and `comptaCollected + remainingToPay === totalSejour` holds on a plan
    (600 € in 3 × 200 €, two paid → revenue 600, collected 400, pending 200). The « Encaissé » table
    lists one row per collected installment (« Échéance n/N », its paid date). The « Reste » of a stay
    (`remainingDue`) is the unpaid buckets, the very `remainingToPay` figure. *Why:* such a stay showed
    0 € of revenue.
46. **Cancelling a stay paid through a plan retains what it collected.** The cancellation requalifies
    the paid installments like a retained acompte (payment-schedule spec §3.6): one avoir (method
    `retained`) reversing the stay part at the sales VAT rate and the tourist-tax shares at 0 % (the
    shares of rule 39, as the accounting booked them), and one VAT-free indemnity for the same sum.
    The unpaid installments are the abandoned solde. When the tourist tax rides on the arrival
    complement (`touristTaxInComplement`), no installment carried it, so the avoir reverses none.
    *Why:* the cancellation booked nothing, the installments stayed séjour revenue for a stay that
    never happened.

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
  in the ledger and are requalified as retained (rule 46).

**Fixed at the 2026-10-27 spec review**

47. **A collected installment keeps the accounting split it was booked with.** Recording an installment
    as paid (`utils/installmentPayment.recordInstallmentPayment`, every path: the fiche, a paid link, the
    Finance page) stores its split on the row — `reservation_installments.paidSplit`, JSON
    `{ taxCents, accommodationCents, optionsCents, resourcesCents }`, adding up to `amountCents`
    (`utils/installmentPaidSplit.js`): the tourist-tax share of rule 39 as the plan stood, the rest pro rata
    of the accommodation and the pre-arrival lines. The accounting export books it verbatim, and the
    cancellation of rule 46 reverses that same tax share. *Why:* the review paid installment 1 (172 € with
    5,01 € of tax) in October, then added a guest; the October entry became 7,41 € of tax and 149,63 € of
    accommodation — a month already exported moved
    (`specs/accounting-books-the-money-collected.md` rule 14).
48. **A late installment is late on the Finance page too.** An installment the fiche calls « En retard »
    (rule 14: unpaid three days after its due date, or the guest has arrived — `installmentsModel.listLate`,
    the collection alert's own read; a covered plan owes nothing, rule 33) is an element of the stay's row
    in « En retard » (`Échéance n/N`, its amount, its due date, `installmentId`), counted by the tile, its
    insight and the detail. « Marquer payé » records it through `POST …/installments/:id/payment`.
    *Why:* `financeModel.overdueOf` only knew the acompte, the solde and the payout, so a stay paid
    through a plan was never late on Finance while the fiche and the payment deadlines said it was
    (`specs/finance-dashboard-redesign.md` rule 49).

---

## 4. Architecture

> Fat backend: amounts, dates, statuses, gaps and eligibility are all computed on the server; the
> client renders `installmentPlan` from the fiche payload and posts the operator's three inputs
> (count, dates, amounts).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `reservations.js` | T | `PUT /:id/installments`, `DELETE /:id/installments`, `POST /:id/installments/:n/payment` |
| `controllers/` | `installmentsController.js` | C | Validates eligibility (rules 1–3), applies count / dates / amounts, manual marks, `planFor`, `syncAfterSave` (rules 7, 8, 13), retires stale links, late installments for the alert |
| `controllers/` | `reservationsController.js` | T | Exposes `installmentPlan` in the fiche payload; recompute after every save |
| `controllers/` | `paymentsController.js` | T | `payment-emails` accepts `{ type: 'installment', installmentId }`; the link's VAT basket (rule 39); the link for a queue entry |
| `models/` | `installmentsModel.js` | C | CRUD on `reservation_installments` (prepared statements), keeps the stay's aggregates (rule 23) |
| `models/` | `paymentLinksModel.js` | T | `type 'installment'` + `installmentId`; one open link per installment |
| `utils/` | `installmentPlan.js` | C | Pure: default dates (rule 10), euro split (rule 6), recompute / frozen spread / pins (rules 7–9a), date and amount validation, statuses (rule 14), the payload |
| `utils/` | `reservationPaymentMark.js`, `autoSendPolicy.js`, `emailTemplatesController` (T) | T | The mark routes an installment body to the plan (rule 38); money templates never auto (rule 43) |
| `utils/` | `reservationSettlement.js`, `models/financeModel.js`, `models/reservationsModel.js` | T | `stayDueAtArrival` and `attributionDate` know the plan (rules 36–37); the SAS commit settles installments |
| `plugins/` | `sas/controller.js`, `online-payment/reconciliation/*`, `accounting-export/accountingModel.js`, `sdk/` | T | SAS stay payload; installment receipts; tax shares from the core (`installmentPlan.taxShares` exposed to plugins) |
| `utils/` | `installmentSync.js`, `installmentPayment.js`, `installmentSummary.js` | C | Persisting the rebalance after a total change; the one way an installment is recorded paid; the engine's read of the plan |
| `utils/` | `installmentRequests.js` | C | What the emails controller knows of installments: which one an entry names, its variables, its link |
| `utils/` | `installmentsMigration.js` | C | The idempotent rebuilds of `payment_links` and `email_manual_queue` and the additive columns (§5) |
| `utils/` | `reservationSettlement.js`, `paymentStatus.js`, `paymentDeadlines.js` | T | `installments` bucket, collected installments, the `installment_overdue` row |
| `utils/` | `pricing.js` | T | With a plan: acompte / solde = 0, pre-arrival amount handed to the plan (rules 4–5) |
| `utils/` | `reservationLedger.js` | T | Installment rows replace acompte / solde rows; gap row (rule 8); clamped-date warning (rule 13) |
| `utils/` | `stayPaymentRecorder.js` | T | Records an installment payment, emits `reservation.paid` |
| `utils/` | `paymentPollRunner.js` | T | `applyPaidEffect` for `installment` links |
| `utils/` | `paymentRequestService.js` | T | `ensurePaymentLink` / `sendPaymentRequest` for one installment; deactivates the replaced link at the provider (rule 17) |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | `installment_request` (FR/EN, manual, gated by `online-payment`) |
| `utils/` | `emailContextBuilder.js`, `templateTokens.js`, `reservationEmailSender.js` | T | Installment variables (rule 21), their catalogue entries, the sender passing the plan and the occurrence key |
| `models/` | `emailLogModel.js`, `emailManualQueueModel.js` | T | `listPending` branch per due installment; dedupe per (template, reservation, occurrence) |
| `controllers/` | `emailsController.js`, `routes/emails.js` | T | Preview / send / ignore / mark-sent carry the occurrence key; sending mints the link first |
| `utils/` | `autoSendPolicy.js` | — | Unchanged; the template is manual and money templates stay out of the cron |
| `plugins/accounting-export/` | `accountingModel.js` | T | Books each paid installment as an encaissement on its paid date |
| `controllers/` | `dashboardController.js` | T | Late installments feed the collection alert |
| `models/` | `financeModel.js`, `financeDashboardModel.js`; `utils/paymentStatus.js` | T | Rule 45: `totalSejour` counts the plan, one « Encaissé » row per paid installment, `remainingDue` = `remainingToPay` |
| `utils/` | `cancelReservation.js`, `cancellationRequalification.js`; `controllers/reservationCancellationController.js` | T | Rule 46: the paid installments (and their tax shares) feed the retained avoir + indemnity |
| `database.js` | `database.js`, `schema.sql` | T | Table, `payment_links` CHECK + column, queue/log occurrence key, stay aggregates (§5) |
| `utils/` | `installmentPaidSplit.js` (C), `installmentPayment.js`, `installmentsMigration.js`; `models/installmentsModel.js` | C/T | Rule 47: the split computed and stored at payment (`setPaidSplit` / `paidSplitOf`), read by the export and the cancellation |
| `models/` | `financeModel.js` (`overdueOf`, `lateInstallmentsOf`); `installmentsModel.listLate` (+ `count`) | T | Rule 48: late installments in « En retard » |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `InstallmentPlanCard.jsx` | C | « Échéancier » block inside the Finance section: count stepper, one row per installment |
| `components/reservation/` | `FinanceSection.jsx`, `PaymentMarkForm.jsx` | T | Renders the card for eligible fiches; the mark form optionally asks the payment mode |
| `components/` | `EmailPendingList.jsx`, `EmailManualSendDialog.jsx`; `pages/EmailTemplatesPage.jsx`, `ReservationPage.jsx` | T | The « à valider » rows and actions carry the occurrence key; the page holds the plan |
| `components/` | `LedgerList.jsx` | — | Unchanged: the ledger rows (installments, gap) are shaped by the server |
| `services/` | `api.js` | T | The installment calls, and the occurrence key on the pending-email calls |
| `constants/` | `installmentStrings.js` | C | French labels and statuses |
| `constants/` | `paymentDeadlines.js` | T | Label, badge and headline of an `installment_overdue` row |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `PaymentMarkForm`, `DateField` | The status chip, the manual payment form (extended with an optional payment mode), the date input. Confirmations and errors are inline MUI `Alert`s. |
| **Created (new generic)** | — | The stepper and date fields are MUI primitives. |
| **Specific (kept feature-local)** | `InstallmentPlanCard` | Tied to the plan's rules; nothing else edits a list of dated amounts. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| PUT | `/api/reservations/:id/installments` | `{ count }`, `{ dates: [{ id, dueDate }] }` or `{ amounts: [{ id, amount }] }` | `{ installmentPlan }` | `409` ineligible (rules 1–2), `400` invalid count/date/amount (rules 3, 9a, 11) |
| DELETE | `/api/reservations/:id/installments` | — | `{ installmentPlan }` (no installments, rule 30) | `409` once money is in |
| POST | `/api/reservations/:id/installments/:installmentId/payment` | `{ paidDate, method }` | `{ installmentPlan }` | Manual mark (rule 16) |
| POST | `/api/payments/reservations/:id/payment-emails` | `{ type: 'installment', installmentId }` | `{ sent, type, url, amountCents, … }` | Existing endpoint, new type |
| GET | `/api/emails/pending` | — | rows with `occurrenceKey`, `installmentNumber` | One row per due installment; acknowledge / mark-sent take `?occurrenceKey=` and preview / send `occurrenceKey` |
| GET | `/api/reservations/:id` | — | `{ …, installmentPlan }` | Payload below |

```json
"installmentPlan": {
  "eligible": true,
  "canCreate": false,
  "reason": null,
  "countLocked": false,
  "frozen": false,
  "total": 1001.5,
  "paid": 0,
  "remaining": 1001.5,
  "gap": 0,
  "minCount": 2,
  "maxCount": 12,
  "count": 3,
  "canRequest": true,
  "installments": [
    { "id": 41, "number": 1, "dueDate": "2026-10-27", "amount": 334, "status": "toRequest",
      "statusLabel": "À demander", "editable": true, "amountEditable": true, "amountEdited": false,
      "dateEdited": false, "added": 0, "clamped": false,
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
  addedCents INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  paidSplit TEXT,                 -- rule 47, added 2026-10-27 (utils/installmentsMigration.js)
  UNIQUE (reservationId, number)
);
```

- `reservation_installments.paidSplit` (rule 47): the accounting split frozen when the installment is
  collected, JSON in cents; `NULL` until then. Added by an idempotent `ALTER TABLE` in
  `installmentsMigration.js`; no backfill (no installment collected in production yet).

- `payment_links`: the `type` CHECK gains `'installment'` and a nullable `installmentId` column.
  SQLite cannot alter a CHECK: the table is rebuilt (create new, copy, swap) inside one
  transaction, rows preserved one-to-one.
- `email_manual_queue` and `email_log`: a column `occurrenceKey TEXT NOT NULL DEFAULT ''` joins the
  dedupe key (`installment:<id>` for this template, `''` for every existing template). The queue's
  primary key `(templateId, reservationId)` becomes `(templateId, reservationId, occurrenceKey)` —
  same rebuild-and-copy pattern; `email_log` only needs the added column.
- `reservations`: `installmentsPaidAmount`, `installmentsUnpaidAmount`, `installmentsTarget` (euros,
  default 0) — rule 23.
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

- Action: « Envoyer la demande » (unpaid, online payment active, covered plan excluded), « Copier le lien »
  once sent, and a visible « Marquer payée » button on every unpaid row.
- Invalid date: the field turns red, the message names the rule (« Après l'échéance 1 et avant
  l'arrivée du 14/06/2027 »), the previous value is kept server-side.
- Frozen plan with a rise: the changed rows show the added part (« +40,00 € ajoutés ») until the next
  recalculation (rule 25).
- Gap (rule 8): warning line under the rows, « Échéancier au-dessus du séjour : 25 € ».
- Footer: « Total séjour 1 001,50 € · Payé 334 € · Reste 667,50 € » (server values).
- A date or an amount is sent when its field is left (or Enter), never per keystroke; a value the server
  refused is not sent again until it changes; once the error is gone the field shows the server value.

**Responsive:**
- `xs` (≤600 px): each row becomes a two-line card — number + status on top, date field + amount
  below, action full-width; stepper and delete stack.
- `md` / `lg`: one row per installment in a grid, actions on the right.
- No horizontal scroll at any width.

**PageActionBar:** unchanged; the plan saves on each change (like the ledger marks), not through the
fiche's Save button.

## 7. Test plan

### Server unit tests
Baseline 6 264 → **6 373** (+109 net, all green; 5 cron tests of money templates replaced by one, rule 43).
- [x] `tests/direct-installments.unit.test.js` (44) — rule 6 split (1 001,50 / 3; 1 000 / 3; total < N refused)
- [x] same file — rule 10 default dates (even spacing, last at J-30, short stay refused)
- [x] same file — rule 7 recompute before payment; rule 8 rise spread on unpaid, drop frozen with gap, all paid → complement
- [x] same file — rule 9a pinned amount (rest spread, last adjusts, refusals, pins kept on recompute and rise, cleared on count change)
- [x] same file — rule 14 « En retard » at due date + 3 days
- [x] same file — rules 1–3 eligibility (`isDirectChannel`, Lodgify-as-direct, devis, money already in)
- [x] same file — rule 11 date validation (past, after arrival, out of order)
- [x] `tests/direct-installments-links.unit.test.js` (11) — link per installment, paid link marks the installment, amount change deactivates the old link, retired link paid anyway (rule 28)
- [x] `tests/direct-installments-emails.unit.test.js` (12) — one queue entry per due installment, template manual, variables, send / ignore / mark-sent
- [x] `tests/direct-installments-migration.unit.test.js` (7) — rebuilds keep every `payment_links` / queue / log row
- [x] `tests/direct-installments-money.unit.test.js` (17) — engine, settlement, ledger, finance, accounting, collection alert (rules 4, 5, 8, 22, 29, 39)
- [x] `tests/direct-installments-guards.unit.test.js` (17) — link paid at a moved amount, `performUpdate` retire, plan creation / removal / resize / platform switch, unallocated and double payments, concurrency, VAT basket, hand-queued request, queue availability, rule 43, boot migration on orphan rows (rules 17, 34, 35, 39–43)
- [x] `tests/direct-installments-arrival.unit.test.js` (7) — due at arrival, SAS settlement, bank receipts, paid buckets never zeroed (rules 35, 36, 38); rule 37 extends `finance-attribution-date.unit.test.js`
- [x] `tests/direct-installments-finance-revenue.unit.test.js` (4) — rule 45: the invariant on a plan, summary per property, pace and projection, one « Encaissé » row per installment
- [x] `tests/direct-installments-cancellation.unit.test.js` (3) — rule 46: avoir 400 @ 10 % + 8 @ 0 %, indemnity 408, nothing collected → nothing booked, tax at arrival → no tax reversed
- [x] `plugins/accounting-export/tests/accounting-collected-money-frozen.unit.test.js` (2 of 5) — rule 47: an October installment unchanged after a later save; the stored split adds up and keeps the plan's tax share
- [x] `tests/finance-late-installments.unit.test.js` (3) — rule 48: two late installments as elements, the three-day grace, a covered plan never late
- [x] `client/src/pages/__tests__/FinancePage.settle-late-installment.test.jsx` (1) — rule 48: « Marquer payé » records each late installment through its endpoint

### Client tests
Baseline 2 153 → **2 176** (+23, all green).
- [x] `client/src/components/reservation/__tests__/InstallmentPlanCard.test.jsx` (21) — renders payload, stepper limits, rapid clicks and change of mind during a request, remove waiting for the count, read-only on a dirty fiche (rule 44), date / amount sent on blur only and refusals, create / remove, send / copy, manual mark
- [x] `client/src/components/__tests__/EmailPendingList.installments.test.jsx` (1) and `constants/__tests__/paymentDeadlines.installments.test.js` (1) — one row per installment, the deadline card label

### Manual UI verification
Checked 2026-10-27 in the browser (dev server on an E2E-seeded database, 1280, 1920 and 390 px, no console error but the intended 400 of a refused date): create (3), rapid clicks on « + » (one request, 6 shown), refused past date (red field, server sentence, typed value kept), typed amount (« fixé », the others follow), « Marquer payée » with the mode (plan frozen, ledger rows follow), 390 px two-line cards with no horizontal scroll (`scrollWidth` 390).
- [x] Direct fiche, 3 installments, edit installment 2's date → amounts follow (browser + `direct-installments.unit.test.js`)
- [x] Mark installment 1 paid, add an option → spread on 2–3; remove it → amounts unchanged, gap shown (unit tests; the option itself not replayed in the browser)
- [ ] « Envoyer la demande » on installment 1 → email in the log with a working sandbox link — **not run**: no Qonto sandbox connected here; link, mail, log and queue are covered by unit tests with a fake provider
- [ ] Next day of a due date: entry in « à valider » — covered by `listPending` tests, not waited for a real day
- [x] Mobile 390 px: rows as cards, no horizontal scroll
- [x] Regression: a direct fiche without plan still shows acompte / solde (ledger tests); a platform fiche shows no card (`eligible: false`)
- [x] `npm run test:e2e` green — 148 passed, 1 skipped (run on ports 3100 / 4100: another session holds 4000)

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
