# Installment plan for direct reservations

| Field | Value |
|---|---|
| **Status** | Implemented · rules 53–60 **Approved** (2026-11-26) |
| **Branch** | `feature/direct-installments` (from `inte/plugins`) |
| **Created** | 2026-10-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary page** | [docs/specs/2026-10-27-direct-installments.html](../../docs/specs/2026-10-27-direct-installments.html) — interactive mock, 390 and 1280 px |

---

## 1. Context

A direct guest who books months ahead sometimes asks to pay in several times. GuestFlow cannot
express it: the money of a stay lives in **fixed buckets** — acompte, solde, arrival complement,
end-of-stay complement ([schema.sql](../../server/src/schema.sql) `reservations.deposit*`,
`balance*`, `complement*`, `endOfStayComplement*`). Exactly two due dates exist, derived by
[paymentSchedule.js](../../server/src/utils/paymentSchedule.js) (acompte at booking, solde
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
  [no-automatic-email-without-approval.md](../emails/no-automatic-email-without-approval.md) stand: no
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
   ([platformNameFormat.js](../../server/src/utils/platformNameFormat.js)) is true. Never a strict
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
   (`preArrivalAmount` in [pricing.js](../../server/src/utils/pricing.js)), tourist tax included.
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
    the last unpaid one can be typed, cents included (« 250,50 »; whole euros only until 2026-11-15,
    lifted because the iPhone numeric keypad has no comma — the field now opens the decimal one).
    The installment becomes **pinned**
    (`amountEdited`). What remains — `total − paid − pinned amounts` — is spread by rule 6 over the
    unpaid, non-pinned installments; the last unpaid installment is never pinned and always adjusts.
    The server refuses (`400`) an amount under 1 € or not a number (spaces typed in the field are dropped by
    the client, « 1 000,50 » → `1000.50`), or one that leaves less than 1 € per remaining
    non-pinned installment. Rules 7 and 8 respect pins: a recalculation moves only non-pinned
    installments, and a rise is spread over the unpaid non-pinned ones (the last unpaid if none
    other is left). Changing the count (rule 12) clears every pin.
    *Superseded in part by rule 53:* the last unpaid installment can be typed and pinned too.

**Dates**

10. Default dates: installment 1 = the day the plan is created; installment N =
    `max(today, startDate − balanceDaysBefore)`; installments 2 … N−1 evenly spaced between them,
    rounded to the day. If that leaves fewer days than installments, rule 3 refuses.
11. The date of an **unpaid** installment is editable. The server refuses (`400`, French message
    naming the installment) a date in the past, a date after the arrival day, or a date that breaks
    the strict order of the installments.
    *Reading of 2026-11-02 — the date window.* The date must be a real calendar day (`2027-02-30` used to pass) and
    not past today + 5 years, « Échéance N : date trop lointaine : 5 ans au plus. », for a stay stored past
    the horizon (`specs/tech/reservations-backend-mvc.md` rule 13, second reading).
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
    path as the other link types, [paymentPollRunner.js](../../server/src/utils/paymentPollRunner.js)
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
    cancelled at once. Amended 2026-10-31 (Adrien, specs/payments/payment-link-lifecycle.md rule 63): the open
    acompte / solde / séjour links are retired before the plan is written, and the plan is refused (409
    `LINK_DEACTIVATION_PENDING` / `UNSETTLED_WITHDRAWN_PAYMENT`) while one of them is not known dead at the provider
    or carries a payment to settle — beside a plan, the only payment that can arrive is an échéance.
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
    - *Reading of 2026-11-01 (audit R13-M1):* « the stay part » is reversed **installment by installment and
      bucket by bucket**, the way each installment was booked. `cancelReservation.installmentsRetainedOf`
      takes each paid installment's frozen `paidSplit` (rule 47) — or, for an installment collected before
      rule 47, `computeInstallmentPaidSplit` on the fiche as it stands, the stored-money rules the export
      spread it with — and `cancellationRequalification.installmentLines` emits one avoir line per paid
      installment and non-zero bucket, labelled « Hébergement — échéance 1/3 », « Options — échéance 1/3 »…
      (the tax, VAT-free, stays one line). The export splits a `retained` avoir HT / VAT **line by line**
      (`accountingModel.buildRefundEntry`, `specs/payments/reservation-refunds.md` rule 47), exactly as each
      encaissement was split, so every 706 / 4457 / 4671 account of the stay nets to **0,00 €** — the
      indemnity on 75880000 is the only revenue left. The refund register then subtracts the requalified
      options and resources from their lines (`specs/payments/reservation-refunds.md` rules 45 and 46). *Why:* the
      avoir put the whole stay part on « Location gîte »: on stay #22326 (two of three installments paid,
      351,38 € of options each) the cancellation month left 70600000 at −638,87 € HT and 70600010 at
      +638,88 € HT for a stay that never happened, and the register still offered every option as fully
      refundable. Summing the installments per bucket first was not enough either: 2 × 351,38 € splits into
      2 × 319,44 € HT on the encaissements but 638,87 € HT on a single avoir line, so 70600010 kept 0,01 € and
      44571100 −0,01 € (up to k − 1 cents per bucket for k paid installments). An avoir is immutable once
      booked: the cent would have stayed forever.
    - *Reading of 2026-11-10 (audit R43-C-M1):* the cancel dialog announces these figures before the cancel, from
      the cancellation's own computation (`GET /reservations/:id/cancel-preview`, payment-schedule-and-cancellation
      rule 60): the paid installments as « Conservé en indemnité », the unpaid ones as « Solde abandonné ». *Why:* it
      read 0,00 € for both on a plan with a paid échéance, because it looked at the acompte and solde only.

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
    (`specs/accounting/accounting-books-the-money-collected.md` rule 14).
48. **A late installment is late on the Finance page too.** An installment the fiche calls « En retard »
    (rule 14: unpaid three days after its due date, or the guest has arrived — `installmentsModel.listLate`,
    the collection alert's own read; a covered plan owes nothing, rule 33) is an element of the stay's row
    in « En retard » (`Échéance n/N`, its amount, its due date, `installmentId`), counted by the tile, its
    insight and the detail. « Marquer payé » records it through `POST …/installments/:id/payment`.
    *Why:* `financeModel.overdueOf` only knew the acompte, the solde and the payout, so a stay paid
    through a plan was never late on Finance while the fiche and the payment deadlines said it was
    (`specs/accounting/finance-dashboard-redesign.md` rule 49).
49. **« Demandée le … » is the operator's day** (2026-10-30, audit R9). `requestedAt` is a UTC ISO stamp
    (`paymentRequestService`); the label prints its local day (`vatRegime.bookingDayOf`,
    `specs/accounting/finance-dashboard-redesign.md` rule 50). *Why:* a request sent between 00:00 and 01:00 / 02:00
    in Paris was labelled with the day before.
50. **A paid installment makes the stay hold its nights at once** (2026-11-01, audit R11-1). Recording an
    installment as collected (`installmentPayment.recordInstallmentPayment`: the operator's tick, a paid
    installment link, its late booking) withdraws, once it flipped the installment, the open payment links of the
    other unpaid devis and reservations on the stay's nights (`datesTaken.withdrawForStay`,
    `specs/payments/payment-link-lifecycle.md` rules 10, 32, 37). *Why:* beside a plan an installment is the only payment
    that can arrive (that spec's rule 63), so this was the one money path where a second guest could still pay for
    the same nights until the next lifecycle pass, up to 15 minutes later.
51. **A plan's tax is declared at the stay month, an installment still due or not** (2026-11-05, D14, Adrien's
    decision). Paying an installment never sets `balancePaid`, so « Suivi taxe de séjour » reads the plan itself, not that
    flag (`specs/tourist-tax/tourist-tax-declaration-month-stay-end.md` rules 7-8). *Why:* a plan of two fully paid, 46710000 = 4,80 €,
    was on no month of the page; the same stay paid by solde had its row of 4,80 €. *Reading of 2026-11-05 (D16, D17):* « can be declared » is withdrawn by
    Adrien, the tick waits for every installment paid and the stay over (`tourist-tax-declared-checkbox.md` rule 8); a plan fully
    paid or a paid installment holding a tax share pins the tax (`tourist-tax-matches-the-office-calculation.md` rule 19).
52. **One change at a time, and the field shows the answer at once** (2026-11-17, flaky-test investigation). While a
    date or an amount is on its way to the server, nothing else is sent from the card's rows: the fields are disabled,
    and a blur or an Enter reaching one anyway posts nothing. When the answer lands, each field takes the server's value
    in the same render (unless its refusal is still shown), not in an effect run afterwards. *Why:* on a loaded CI runner
    the effect ran after the next keystrokes and overwrote them, so « 250.5 » typed after « 250,50 » was posted as
    « 250,50250.5 »; and an Enter followed by leaving the field posted the same amount twice.

**The last installment can be typed too — the rest is paid at the door** (2026-11-26, **Approved**, Adrien's
request: « il faut qu'on puisse setter même la dernière échéance, et ce qui manque est à payer en complément
d'arrivée, attention à bien le faire apparaître dans le SAS »). Rule 9a is read again: the last unpaid
installment is no longer the one that always adjusts.

53. **Every unpaid installment's amount can be typed**, the last unpaid one included, in whole euros, ≥ 1 €.
    When the typed installment is the last unpaid one, or when it leaves no non-pinned installment, the plan is
    **closed** (`closed` in the payload): nothing in it adjusts any more.
    *Reading (implementation, 2026-11-26):* « closed » is exactly « some installment is unpaid and every unpaid one
    is pinned » (`utils/installmentPlan.js` `isClosed`, `closed` of `installmentSummary` for the engine). Typing the
    last unpaid installment pins it but, while an earlier unpaid one is not pinned, that one still adjusts and takes the
    rest: the plan stays open and carries no shortfall. Rule 9a's « the last unpaid installment is never pinned and
    always adjusts » no longer holds (it is the point of this rule); the payload's `canRelease` is true on the last
    unpaid installment whenever it is pinned. Released after a payment, the last installment takes the shortfall back as
    a rise (rule 8). An older plan whose last unpaid installment was pinned while a later one was paid reads as closed.
54. **What a closed plan does not cover is paid at the arrival.** `shortfall = preArrivalAmount − Σ installments`
    (> 0) goes to the **arrival complement at once** — from the save, not only once every installment is paid
    (rule 8). It is the engine's existing auto-gap (`autoGapBetweenDepositAndBalance` already subtracts
    `installmentPlan.scheduled`), shown without waiting for `preArrivalSettled` when the plan is closed.
55. **A closed plan never holds more than the stay.** A typed amount that would bring Σ installments above the
    pre-arrival amount is refused (`400`): « Échéance N : dépasse le séjour de X € (Y € au plus). ».
56. **A price change on a closed plan moves the complement, never an installment.** A rise adds to the
    shortfall. A drop lowers it; a drop beyond it — the plan would hold more than the stay — follows rule 8's
    drop: before any payment the last unpaid installment is released and adjusts again (rule 7); after a
    payment nothing moves and the ledger shows « Échéancier au-dessus du séjour : X € ».
57. **Re-opening the plan.** The last unpaid row of a closed plan carries « Ajuster automatiquement »: it
    clears that installment's pin, it takes the shortfall back, the complement loses it. Changing the count
    (rule 12) clears every pin as before.
    *Reading of 2026-11-26:* once the arrival complement holding the rest is **collected** and the plan is closed with a rest,
    that rest is never asked again: release (`canRelease` false, `restCollected` true in the payload), a change of count
    and the removal of the plan are refused (`409`, « Le reste de l'échéancier a déjà été encaissé à l'arrivée. »), and
    the ceiling of rule 55 for a typed amount becomes `target − the rest collected`. The stored headline
    (`quoteHeadline.storedPlanCarries`) counts a closed plan for what it schedules, like the engine. A payment recorded at
    another amount (rule 28) restamps the stored complement from the engine. The collected acompte keeps its paid row
    on the ledger (first, no undo beside a plan).
58. **The rest is visible everywhere the arrival complement is.** The plan card ends with « Reste à régler à
    l'arrivée : X € ». The arrival complement's « Détail » (`buildArrivalComplementDetail`, the source shared by the
    fiche, the SAS and the emails) carries a line **« Reste de l'échéancier »**; the SAS arrival step shows the
    unpaid installments (rule 36) **and** the complement with that line, and settling the complement there
    collects it like any arrival complement. The J-2 / arrival emails list it through the same detail.
59. **Accounting.** The rest is stay money collected with the complement: the complement allocation books it
    pro rata of the stay buckets like today's auto-gap (`complementAllocation`). The tourist tax stays on the
    installments (rule 39, shares over the plan's scheduled total) unless it already rides the complement.
60. **A plan on a stay whose acompte is already collected** (2026-11-26, **Approved**, Adrien: « il faut aussi qu'on
    puisse activer le paiement en plusieurs fois même sur une résa qui a déjà un paiement de saisie »). Rule 2 is
    read again: the plan can be created or resized while **no installment** is collected; a collected acompte
    no longer forbids it. The acompte keeps its paid row, its amount, its date and its accounting entry (rule 35:
    a collected bucket is never zeroed); the plan splits **what is left before arrival**
    (`preArrivalAmount − acompte collected`) and replaces the solde only. Rules 53–59 apply to that amount.
    Still refused: a collected solde or full payment (nothing left to split), an acompte link paid but not yet
    settled at the provider (rule 35's 409). Removing the plan gives the solde back, the acompte untouched.

*Choices of 2026-11-26* (summary page [2026-11-26-installment-last-amount-to-arrival-complement.html](../../docs/specs/2026-11-26-installment-last-amount-to-arrival-complement.html)):
the line is « Reste de l'échéancier »; a rise on a closed plan goes to the arrival complement; an amount above the
stay is refused; the SAS shows two blocks (installments due, then the complement with its line); with a collected
acompte the plan splits what is left and the acompte stays apart.

*Code map of rules 53–60:*
- `utils/installmentPlan.js` (T) — `floatingOf` / `validateAmount` / `rebalance` accept a pinned last installment;
  `closed`, `shortfallCents`, `lastUnpaid.canRelease` in the payload; rule 55 refusal; rule 56 drop releases the last pin.
- `controllers/installmentsController.js` (T) — eligibility of rule 60 (collected acompte allowed, solde / full
  refused); plan target = pre-arrival amount − collected acompte; release action (rule 57).
- `routes/reservations.js` (T) — `PUT /:id/installments` accepts `{ installmentId, releaseAmount: true }` (rule 57).
- `utils/pricing/schedule.js` (T) — the auto-gap of a closed plan reaches the arrival complement without waiting
  for `preArrivalSettled` (rule 54); a collected acompte beside a plan keeps its bucket (rule 60).
- `models/reservationsModel.js` `buildArrivalComplementDetail` / `utils/arrivalPaymentDetail.js` (T) — the
  « Reste de l'échéancier » line (rule 58), summing with the rest to the complement.
- `utils/complementAllocation.js` (T) — the line books pro rata of the stay buckets (rule 59).
- `plugins/sas/controller.js` + SAS client (T) — installments block and complement block with its line (rule 58).
- Client `components/reservation/InstallmentPlanCard.jsx` (T) — last amount editable, « Ajuster automatiquement »,
  footer « Reste à régler à l'arrivée », the collected acompte as a read-only paid row (rule 60). Renders only.

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

Interactive mock: [docs/specs/2026-10-27-direct-installments.html](../../docs/specs/2026-10-27-direct-installments.html).

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
  response). The marks (« fixé », « Ajuster automatiquement », « +X € ajoutés ») never move the amount
  off the date's line: they have their own grid area, left of the amount on a wide card and a
  full-width line under date + amount on a narrow one (2026-11-26); the read-only amount of the
  last unpaid row keeps the field's 40 px height. The narrow amount field is 104 px (120 px wide)
  so a 390 px screen shows the full date without horizontal overflow. A refused amount turns the field red with the reason (« Laisse moins de 1 € à
  l'échéance 3 »).

- Actions are 44 px icon buttons, the words in a tooltip on hover and in the aria-label
  (2026-11-26, the text buttons were too large for the row): « Envoyer la demande » (paper plane;
  unpaid, online payment active, covered plan excluded), « Copier le lien » (copy icon) once sent,
  and « Marquer payée » (check mark, filled primary) on every unpaid row.
- Invalid date: the field turns red, the message names the rule (« Après l'échéance 1 et avant
  l'arrivée du 14/06/2027 »), the previous value is kept server-side.
- Frozen plan with a rise: the changed rows show the added part (« +40,00 € ajoutés ») until the next
  recalculation (rule 25).
- Gap (rule 8): warning line under the rows, « Échéancier au-dessus du séjour : 25 € ».
- Footer: « Total séjour 1 001,50 € · Payé 334 € · Reste 667,50 € » (server values).
- A date or an amount is sent when its field is left (or Enter), never per keystroke; a value the server
  refused is not sent again until it changes; once the error is gone the field shows the server value.
- While a date or an amount is being saved nothing else is sent, and the answer is in the fields at once (rule 52).

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
- [x] `tests/direct-installments-cancellation.unit.test.js` (3) — rule 46: avoir 400 @ 10 % (200 + 200, one line per installment since the 2026-11-01 reading) + 8 @ 0 %, indemnity 408, nothing collected → nothing booked, tax at arrival → no tax reversed
- [x] `tests/installment-cancellation-buckets.unit.test.js` (9, 2026-11-01) — rule 46 reading of audit R13-M1: two paid installments with an options share → one avoir line per installment and bucket (« Hébergement — échéance 1/3 » 220, « Options — échéance 1/3 » 110, …) + 8 @ 0 %; the month nets to 0 on every 706 / 4457 / 4671 account; stay #22326's amounts (351,38 € of options per installment, frozen and unfrozen) net to 0 on 70600000, 70600010, 44571100 and 46710000; an installment paid before rule 47 is reversed on `computeInstallmentPaidSplit`; a one-line-per-bucket `retained` avoir books byte for byte the per-bucket split; `reservation-refunds` rules 45–47 (spread, largest remainder, `requalifiedTtc`)
- [x] `plugins/accounting-export/tests/accounting-collected-money-frozen.unit.test.js` (2 of 5) — rule 47: an October installment unchanged after a later save; the stored split adds up and keeps the plan's tax share
- [x] `tests/finance-late-installments.unit.test.js` (3) — rule 48: two late installments as elements, the three-day grace, a covered plan never late
- [x] `client/src/pages/__tests__/FinancePage.settle-late-installment.test.jsx` (1) — rule 48: « Marquer payé » records each late installment through its endpoint
- [x] `tests/utc-timestamp-paris-day-labels.unit.test.js` (1 of 4, 2026-10-30) — rule 49: a request stamped 23:30 UTC reads « Demandée le » on its Paris day
- [x] `tests/plan-tax-declaration.unit.test.js` (27, 2026-11-05) — rule 51: fully paid, partly paid and unpaid plans on the page at the stay month, `balancePaid` still 0
- [x] `tests/installment-paid-holds-nights.unit.test.js` (4, 2026-11-01) — rule 50: an installment ticked or paid by link withdraws the devis link on the stay's nights at once; a replay withdraws nothing more; nothing paid holds nothing

### Client tests
Baseline 2 153 → **2 176** (+23, all green).
- [x] `client/src/components/reservation/__tests__/InstallmentPlanCard.test.jsx` (26) — one change at a time and the answer in the field at once (rule 52; mocks fully reset between tests, an unplanned API call fails with what it sent), renders payload, stepper limits, rapid clicks and change of mind during a request, remove waiting for the count, read-only on a dirty fiche (rule 44), date / amount sent on blur only and refusals, create / remove, send / copy, manual mark
- [x] `client/src/components/__tests__/EmailPendingList.installments.test.jsx` (1) and `constants/__tests__/paymentDeadlines.installments.test.js` (1) — one row per installment, the deadline card label

### Manual UI verification
Checked 2026-10-27 in the browser (dev server on an E2E-seeded database, 1280, 1920 and 390 px, no console error but the intended 400 of a refused date): create (3), rapid clicks on « + » (one request, 6 shown), refused past date (red field, server sentence, typed value kept), typed amount (« fixé », the others follow), « Marquer payée » with the mode (plan frozen, ledger rows follow), 390 px two-line cards with no horizontal scroll (`scrollWidth` 390).
- [x] Direct fiche, 3 installments, edit installment 2's date → amounts follow (browser + `direct-installments.unit.test.js`)
- [x] Mark installment 1 paid, add an option → spread on 2–3; remove it → amounts unchanged, gap shown (unit tests; the option itself not replayed in the browser)
- [ ] « Envoyer la demande » on installment 1 → email in the log with a working sandbox link — **not run**: no Qonto sandbox connected here; link, mail, log and queue are covered by unit tests with a fake provider
- [ ] Next day of a due date: entry in « à valider » — covered by `listPending` tests, not waited for a real day
- [x] Mobile 390 px: rows as cards, no horizontal scroll
- [x] 2026-11-26 — typed amount at 2400 px (wide card) and 390 px (narrow card): date and amount
  (field or read-only text) centred on the same line, « fixé » and « Ajuster automatiquement » beside / under the amount, the badge inside the card at 390 px;
  « Marquer payée » tooltip on hover (dev server, Playwright)
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
  - A: **Revised 2026-11-26** — the last unpaid one too; what the plan does not cover goes to the arrival complement (rules 53–60).
- Q: « En retard » threshold?
  - A: **Resolved 2026-10-27** — 3 days after the due date (rule 14).
- Q: When the plan is frozen and the total drops, should the gap be applied to the last unpaid installment on an explicit click (« Réduire la dernière échéance »)?
  - A: **Resolved 2026-10-27** — no: the gap is only shown, the operator settles it from the ledger (rule 8).
