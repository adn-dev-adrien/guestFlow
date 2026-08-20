# Payment schedule — deposit at booking, balance at J-30, cancellation for non-payment

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/payment-schedule-and-cancellation` _(Claude-managed)_ |
| **Created** | 2026-08-19 |
| **Author** | Adrien |
| **Related PR** | #451 |
| **Amended** | 2026-08-20 — §3.7 rewritten (no automatic payment email); amendment status `Implemented` |

---

## 1. Context

GuestFlow already splits a direct booking into an **acompte** and a **solde**, but the two due dates
are both derived from the **arrival date**:

```js
// utils/pricing.js:1966-1970
const depositDueDate = depositDisabled ? null : addDaysToIsoDate(startDate, -property.depositDaysBefore); // 30
const balanceDueDate = addDaysToIsoDate(startDate, -property.balanceDaysBefore);                          // 7
```

Three consequences, all visible in daily operation:

1. **The acompte is not tied to the booking act.** A stay booked 11 months ahead has an acompte due
   10 months later; a stay booked 20 days ahead has an acompte due date *in the past*. The acompte
   is what turns an option into a commitment — it must be due when the guest books, not when the
   stay approaches.
2. **The solde lands too late to react.** `balanceDaysBefore = 7` leaves no room: by the time an
   unpaid solde is noticed, the stay is 6 days away, the dates cannot be resold, and no cancellation
   is realistically possible.
3. **Nothing is ever chased.** `computePaymentStatus`
   ([paymentStatus.js:30-31](../server/src/utils/paymentStatus.js#L30-L31)) already computes
   `depositOverdue` / `balanceOverdue`, but **no screen consumes them**: rule 3 of
   [dashboard-collection-alert.md](dashboard-collection-alert.md) deliberately excludes acompte and
   solde from the dashboard's red signal ("chasing a late direct-booking balance belongs to the
   Finances page"), and the Finances page only *lists* a « Reste à payer » — it never says *late*.
   An unpaid direct booking can therefore reach its arrival date without a single alert.

What already exists and is reused rather than rebuilt:

- **Payment links + request emails.** [`paymentRequestService`](../server/src/utils/paymentRequestService.js)
  mints a Qonto link and sends `deposit_request` / `balance_request`
  ([defaultEmailTemplatesRegistry.js:394-424](../server/src/utils/defaultEmailTemplatesRegistry.js#L394-L424)).
- **A daily solde pass.** [`balanceRequestRunner`](../server/src/utils/balanceRequestRunner.js) already
  emails the solde request at `balanceDueDate` — but **only** for reservations whose acompte was paid
  online (`payment_links.type = 'deposit' AND status = 'paid'`), i.e. only the public-website funnel.
- **Two scheduling anchors for templates.** `email_templates.anchor` ∈ `start` | `validUntil`
  ([emailLogModel.js:77-134](../server/src/models/emailLogModel.js#L77-L134)).
- **A cancellation-indemnity register.** [cancellation-compensation.md](cancellation-compensation.md)
  shipped `cancellation_compensations`, the `75880000` / VAT-0 % settings, the dashboard card and the
  accounting entry (`direction: 'compensation'`). It was built for the money a *platform* pays back —
  but a **retained acompte after a désistement has exactly the same legal nature** (indemnity, outside
  the scope of VAT — CJUE *Société thermale d'Eugénie-les-Bains*, C-277/05, already cited in
  [database.js:1142-1148](../server/src/database.js#L1142-L1148)).
- **An « avoir » register.** [reservation-refunds.md](reservation-refunds.md) books a dated credit
  note that mirrors an encaissement (`direction: 'refund'`) without touching the sale.

**Arbitrages taken with Adrien on 2026-08-19** (questionnaire):

| Subject | Decision |
|---|---|
| Acompte due date | **Booking date + N days**, N configurable per property, default **7**. |
| Cancellation | **Never automatic** — the dashboard proposes it, the operator confirms in one click. |
| Cancelled reservation | **The row survives** (kind flips to `cancelled`); the platform flow's DELETE is not reused. |
| Retained acompte | **Full requalification**: an avoir cancels the séjour encaissement, an indemnity card re-credits it in `75880000` VAT-free, at the cancellation month. |
| Late booking (< 30 days) | Acompte **and** solde immediately due. |
| Emails | Acompte request at booking, acompte reminder at its due date, solde reminder after J-30, cancellation notice — all four wired. ⚠️ **Superseded on 2026-08-20 — see the amendment below.** |

**Amendment taken with Adrien on 2026-08-20 — no money email leaves on its own:**

| Subject | Decision |
|---|---|
| Payment emails | **Never sent automatically.** The four money emails (acompte request, acompte reminder, solde request, solde reminder) are *proposed* by GuestFlow and *sent by the operator*. No cron may put a euro in a guest's inbox. |
| Cancellation | Unchanged and reaffirmed: **never automatic** (rule 12). The dashboard proposes, the operator confirms. |
| Stay emails | Untouched — the arrival reminders, the SAS and the breakfast emails keep their automatic pass. The rule is about **money**, not about email in general. |
| Duration | « Pour le moment » — the automatic pass may come back once the operator trusts the deadline data, and the manual path stays available either way. |

**Why:** a dunning email is a commercial act. The server cannot know that the acompte arrived by
transfer this morning, that the solde was settled by phone, or that a two-week delay was agreed with
the guest. A wrong reminder — or a stay cancelled on stale data — is not recoverable by a later fix,
whereas an alert waiting one day for the operator costs nothing.

## 2. Goal

Every direct booking follows one enforced payment schedule — **acompte due when the guest books,
solde due 30 days before arrival** — the dashboard raises the alert the day a payment must be asked
for and the day either deadline is missed, the operator sends every money email himself in one click,
and 7 days after an unpaid solde he can cancel the stay in one click: the dates go back on sale, the
acompte is kept as an indemnity, and the books say so correctly.

## 3. Functional rules

### 3.0 Scope

1. Everything in this spec applies to **direct-channel reservations only**
   (`isDirectChannel(platform)`, [platformNameFormat.js:62](../server/src/utils/platformNameFormat.js#L62))
   with `kind = 'reservation'`. Platform bookings (Airbnb / Booking / Lodgify…) are settled by the
   platform after the stay and carry no acompte
   ([accounting-platform-commission-and-no-deposit.md](accounting-platform-commission-and-no-deposit.md));
   they never produce a deadline alert, a dunning email or a cancellation proposal.
2. A reservation with `depositDisabled = 1`
   ([disable-deposit-per-reservation.md](disable-deposit-per-reservation.md)) has no acompte step:
   rules 3-6 are skipped, the whole pre-arrival amount rides the solde and rules 7+ apply unchanged.

### 3.1 Acompte — due at booking

3. **`depositDueDate = bookingDate + property.depositDueDays`**, where `bookingDate` is the date part
   of the reservation's `createdAt` and `depositDueDays` is a new per-property setting, **default 7**.
   It replaces `depositDaysBefore`, which is removed: the acompte is no longer derived from the stay.
4. **The acompte due date is frozen at creation.** Once stored it is never recomputed — moving the
   arrival dates, editing the price or re-running the pricing engine leaves it untouched. It records
   a commitment taken on the booking day, not a position relative to the stay.
5. For a **devis** (`kind = 'devis'`), `depositDueDate = validUntil` — the quote already promises the
   dates until that date. On conversion to a reservation the due date is re-derived by rule 3 from
   the conversion date, unless the acompte was already paid online (then it is left as-is).
6. `depositDueDate` is `NULL` when there is no acompte to collect (`depositDisabled`,
   `depositAmount = 0`, or a non-direct platform).

### 3.2 Solde — due 30 days before arrival

7. **`balanceDueDate = max(startDate − property.balanceDaysBefore, bookingDate)`**, with
   `balanceDaysBefore` set to **30** for both properties (new default; existing rows migrated).
8. Unlike the acompte, the solde due date **follows the stay**: it is recomputed by the pricing engine
   whenever the arrival date changes, and always clamped to never fall before the booking date.
9. **Late booking** (arrival less than `balanceDaysBefore` days away): the clamp of rule 7 makes the
   solde due on the booking day itself — acompte and solde are both immediately payable.
10. `balanceDueDate` is `NULL` when `balanceAmount = 0` (nothing left to collect pre-arrival).

### 3.3 Cancellation deadline

11. **`cancelOn = balanceDueDate + property.cancelAfterBalanceDueDays`**, a new per-property setting,
    **default 7**. It is computed on read, never stored.
12. Reaching `cancelOn` with an unpaid solde **never cancels anything by itself**. It moves the
    dashboard row into its « à annuler » state, where the operator confirms or declines.
12bis. **A stay is never proposed for cancellation over money that was never asked for.** `cancel_due`
    additionally requires that a `balance_request` was actually sent to the guest (rule 15). Without
    it the row stays in `balance_to_request`: the to-do is « ask », not « cancel ».
13. The cancellation action is offered **only while `today < startDate`**. From the arrival day on,
    the row stays visible as an unpaid-arrival warning with no cancel button — cancelling a stay whose
    guest is at the door is not a decision the dashboard should suggest.

### 3.4 Dashboard alert

14. A new dashboard card, « **Échéances de paiement** », lists every direct reservation with a payment
    to ask for or a missed deadline. Each row is **entirely computed server-side** (state, amounts,
    days late, whether the guest was already asked, available actions); the client only renders it.
    Since the 2026-08-20 amendment it is also the **to-do list** that guarantees no request is
    forgotten — nothing else will send one.
15. Six **guest-money** row states, most severe first. (The card also carries the two platform states
    `platform_payout_overdue` and `platform_amount_missing` shipped by
    [platform-payout-due-date.md](platform-payout-due-date.md); they describe money owed *by* an OTA,
    rank below every state here, and this amendment does not touch them.) A `*_to_request` state means
    the guest **has never been asked** for that money — `requestSent` is false, i.e. no `email_log` row
    with status `sent` for the matching request template. It always wins over the `*_overdue` twin: one
    cannot be late on a request that was never made.
    | State | Severity | Condition | Copy |
    |---|---|---|---|
    | `cancel_due` | error | solde unpaid, **solde request sent**, `today ≥ cancelOn`, `today < startDate` | « Solde impayé depuis N jours — annulation possible » |
    | `unpaid_at_arrival` | error | pre-arrival amount unpaid and `today ≥ startDate` | « Arrivée non réglée » |
    | `balance_to_request` | warning | solde unpaid, solde request never sent, `today ≥ balanceDueDate` | « Solde à demander — échéance le {date} » |
    | `balance_overdue` | warning | solde unpaid, solde request sent, `balanceDueDate < today < cancelOn` | « Solde en retard de N jours » |
    | `deposit_to_request` | info | direct booking, acompte unpaid, acompte request never sent | « Acompte à demander — échéance le {date} » |
    | `deposit_overdue` | warning | acompte unpaid, acompte request sent, `depositDueDate < today` | « Acompte en retard de N jours » |
15bis. `deposit_to_request` fires **from the creation day** of the reservation, not from its due date:
    the acompte request is what turns a booking into a commitment, and the row is the only thing that
    remembers it must leave. It keeps showing after `depositDueDate` (copy gains « — échéance dépassée
    de N jours »), because the to-do is still « envoyer la demande ».
16. A reservation carrying both a late acompte and a late solde produces **one** row, in its most
    severe state, listing both amounts.
17. Row actions: « **Envoyer la demande** » on a `*_to_request` state and « **Relancer** » on the
    others — both mint a fresh Qonto link and send the matching request email through the same
    endpoint, only the label differs. Plus « **Reporter** » (snooze, rule 18), « **Annuler le
    séjour** » (state `cancel_due` only), and the row itself links to the reservation.
17ter. **The action asks for what the row is about.** `remindType` follows the row's state, not merely
    « is the solde unpaid ». It used to read `balanceUnpaid ? 'balance' : 'deposit'`, so a row titled
    « Acompte en retard » whose solde was simply not due yet sent a **solde** request — a payment link
    for the full amount, weeks early. Rare before this amendment; systematic after it, since every
    fresh booking now raises a `deposit_to_request` row whose solde is always still ahead.
17bis. **The card is the only thing that makes a payment email leave.** Every money email is one
    deliberate operator click — from this card, from the reservation page action, or from the pending
    email queue (rule 37). Nothing in `scheduledTasks.js` may send one.
18. **Snooze.** « Reporter » stores `paymentAlertSnoozedUntil = today + 7 days` on the reservation and
    hides the row until that date. It **does not move any échéance**: the emails, the PDF and
    `cancelOn` keep the contractual dates. Any payment received clears the snooze implicitly (the row
    disappears on its own).
19. The card is **hidden for a reception-only user** and its endpoint refuses that role — it carries
    amounts and client names, like the « Paiements » column
    ([reception-role-checkin-only.md](reception-role-checkin-only.md) §3.3).
20. The card renders nothing when there is no row (no empty state, same as the iCal alerts).
20bis. **Bounded list.** A stay whose `endDate` is more than 30 days in the past leaves the card. After
    a month of daily alerts the operator has seen it; the card is a to-do list, not an archive. The
    money is still visible on the Finances page and in the reservation itself.

### 3.5 Cancelling a stay

21. Cancellation is available from the dashboard row (rule 17) **and** from the reservation page's
    action bar (« Annuler le séjour »), so a phone-call cancellation follows the same path.
22. The confirmation dialog recaps: client, property, dates, total séjour, **acompte encaissé (kept)**,
    **solde impayé (written off)**, a free-text reason, and a « prévenir le client par email »
    checkbox (ticked by default when the client has an email address).
23. Confirming runs **one transaction**:
    a. a `reservation_history` entry (`eventType = 'cancel'`) carrying the reason and the amounts;
    b. `kind` flips from `reservation` to **`cancelled`**, and `cancelledAt` / `cancellationReason` /
       `cancelledBy` are stamped;
    c. when the acompte was paid, the **requalification pair** of §3.6 is written;
    d. nothing else is mutated — amounts, échéances and paid flags stay exactly as they were, because
       they are now history.
24. **The dates are freed by construction.** Every operational query already filters
    `kind = 'reservation'` — availability check
    ([reservationsModel.js:930](../server/src/models/reservationsModel.js#L930)), calendar, planning,
    laundry, linen, breakfast, resources, SAS, iCal export, Google Calendar, email queues. A row that
    leaves `kind = 'reservation'` therefore leaves all of them at once, with no query to hunt down and
    no risk of a forgotten one still blocking the dates. The Google Calendar event is deleted
    explicitly (`googleCalendarSync.scheduleDelete`), exactly as on a real delete.
25. A cancelled reservation is **read-only**: `PUT /api/reservations/:id`, the payment endpoints and
    the SAS endpoints return **409 `RESERVATION_CANCELLED`**.
26. It stays **reachable**: its detail page opens (read-only, red « Annulée le … » banner in the action
    bar), and it is returned by the reservation search with an « Annulée » badge. It is absent from
    every list-shaped view (upcoming, planning, calendar, finance).
27. Cancelling a reservation whose acompte was **never paid** writes no avoir and no indemnity card —
    there is no money to requalify. `cancellationReason` records `unpaid_deposit`.
28. Re-cancelling an already-cancelled reservation returns **409 `ALREADY_CANCELLED`**.
29. **Un-cancelling is out of scope** (§8) — the data model keeps it possible, the UI does not offer it.
29bis. Cancelling **from the reservation page** navigates back to the origin list once confirmed: the
    fiche it came from is now read-only and the operator's next move is elsewhere. Cancelling **from
    the dashboard** stays on the dashboard and refreshes the card.

### 3.6 Accounting — requalifying the retained acompte

30. The acompte was booked, on its payment date, as a séjour encaissement with hébergement VAT. That
    entry **must not move**: its month may already be in the accountant's hands. The cancellation books
    the requalification in the **month of the cancellation**, as two mirrored entries:
    a. an **avoir** (`reservation_refunds`) dated the cancellation day, whose lines reproduce the
       acompte's own buckets and VAT rates → credit client, debit revenue + VAT;
    b. a **cancellation compensation** created directly in `received`, `receivedAmount` = the acompte
       TTC, `receivedDate` = the cancellation day → debit client, credit `75880000` at VAT 0 %.
31. Net effect: the client auxiliary account nets to zero, the cash position is unchanged (no money
    moved), and the revenue is reclassified from `706xxxx` + VAT to `75880000` VAT-free — which is
    what a retained acompte legally is.
32. The avoir uses a **new refund method `retained`** (« Acompte conservé »), which is **book money**
    (unlike `internal`, which is off-books): it must appear in the journal. No bank movement is
    implied, and the method is never selectable in the manual refund dialog — only the cancellation
    flow writes it.
32bis. **A retained acompte is not a refund.** The `retained` avoir reverses revenue in the *journal*,
    but no money went back to the guest. Every reader that answers « how much did we give this guest
    back » — the fiche's « Remboursements » line, the finance aggregates — therefore skips it. Only
    the monthly journal read sees it. (Found in the browser: without this the cancelled fiche showed
    « Remboursements − 274,00 € », the exact opposite of what happened.)
33. The indemnity card gets a new `origin` field: `platform` (the existing iCal flow) or
    `retained_deposit` (this flow). The Comptabilité section and the dashboard card label it
    « Acompte conservé — annulation » and link to the cancelled reservation.
34. Because a cancelled reservation still carries booked encaissements, **accounting reads keep seeing
    it**: `accountingModel.encaissementsByMonth` and the refunds-by-month read match
    `kind IN ('reservation', 'cancelled')`. This is the single, deliberate exception to rule 24 — and
    the reason the row is not deleted.
35. The Finances page (operational view) **excludes** cancelled stays. Their money is visible in
    Comptabilité, through the encaissement of the original month plus the requalification pair.

### 3.7 Emails

36. **`deposit_request` — never sent by the server.** Creating a direct reservation with
    `depositAmount > 0` raises a `deposit_to_request` row on the dashboard the same day (rule 15bis);
    the operator sends it with « Envoyer la demande », or from the reservation page's own action. The
    fire-and-forget send on `create` is **removed** together with `depositRequestOnBooking.js`. A
    reservation converted from a devis whose acompte was already paid online raises no row.
37. **`deposit_reminder` — re-anchored, and manual.** `anchor: 'depositDueDate'`, offset **0**,
    `sendMode: '`**`manual`**`'`: on the acompte due date it appears in the pending-email queue
    (`GET /api/emails/pending`), where the operator previews the rendered body and sends it or skips
    it. The auto-send cron never picks it up. Body unchanged (amount, due date, payment link, what
    happens if it stays unpaid).
38. **`balance_request` — the daily pass is removed.** `balanceRequestRunner.js` and its 08:00 cron
    are **deleted**. Its eligibility query — every direct reservation with `balanceAmount > 0`,
    `balancePaid = 0`, `balanceDueDate ≤ today` — becomes the `balance_to_request` state of rule 15,
    so the same reservations are still surfaced at J-30 whatever the booking channel was; they are
    now *shown* instead of *mailed*. One send ever per reservation is still enforced by `email_log`.
39. **`balance_reminder` — manual.** `anchor: 'balanceDueDate'`, offset **+3**,
    `sendMode: '`**`manual`**`'`: same pending queue as rule 37. States the amount, the days late, and
    the exact date on which the stay is cancelled with the acompte kept.
40. **`cancellation_notice` — new template**, event-triggered (never queued), sent when the operator
    confirms a cancellation and leaves the checkbox of rule 22 ticked. States the cancellation, the
    acompte kept as indemnity, and that the dates are back on sale.
40bis. **A reminder is only queued once the matching request was actually sent.** `deposit_reminder`
    and `balance_reminder` carry the payment link minted by their request; queuing one for a guest who
    was never asked would render a `{{paymentLink}}` that does not exist. The pending queue applies
    the same `requestSent` condition as rule 15 — until the request leaves, the dashboard's
    `*_to_request` row is the only to-do, and the reminder appears in the queue the day after.
40ter. **The pending queue must filter the channel, exactly like the cron.** PR #458 restricted the
    two payment anchors of `emailAutoSendRunner` to own channels — an Airbnb guest owes their solde to
    Airbnb, not to us. `emailLogModel.listPending` never needed that filter because both reminders were
    `auto` and never reached it; flipping them to `manual` **would reintroduce the bug through the
    other door**. `paymentAnchorBranch` therefore gains the same
    `LOWER(COALESCE(NULLIF(TRIM(r.platform), ''), 'direct')) IN (DIRECT_CHANNELS)` clause. The `start`
    anchor stays unfiltered: arrival emails are legitimate on every channel.
41. Two new template anchors are therefore supported: **`depositDueDate`** and **`balanceDueDate`**,
    in both the manual pending queue (`emailLogModel.listPending`) and the auto-send cron
    (`emailAutoSendRunner`). A reservation with a NULL anchor date is never scheduled.
42. All four respect the existing guarantees: per-reservation language
    ([email-language-fr-en.md](email-language-fr-en.md)), `email_log` dedup (one send per
    template × reservation), silent skip when the client has no email, and no send for a cancelled
    reservation.
43. New tokens for the bodies: `cancelOnDate` (the date the stay would be cancelled),
    `retainedDepositAmount`, `daysLate`. `depositDueDate`, `balanceDueDate`, `paymentLink` already
    exist ([emailContextBuilder.js:360-364](../server/src/utils/emailContextBuilder.js#L360-L364)).
44. **No scheduled task may send a money email — enforced, not just intended.** The four request /
    reminder stable keys are exported as `PAYMENT_STABLE_KEYS` from
    `defaultEmailTemplatesRegistry.js`, and a unit test asserts that none of them ships with
    `sendMode: 'auto'`. A future template that chases money joins that list. `cancellation_notice`
    stays outside the queue and the cron: it is emitted by the cancellation the operator confirmed.
45. **Migration — the already-seeded rows must be flipped.** Templates are seeded once, so changing
    the registry does not touch a production database: `deposit_reminder` and `balance_reminder`
    already carry `sendMode = 'auto'` there and would keep auto-sending after deploy. A one-shot
    force-sync (`migratePaymentTemplatesToManual.js`, mirroring `migrateDepositReminderAnchor.js`)
    sets them to `manual`, recorded in the `migrations` table so a later deliberate change by the
    operator is never overwritten.
46. **What is still automatic, on purpose:** the arrival reminders (J-7, J-1), the SAS and breakfast
    emails and pushes, the Qonto payment poll (it *reads* payment state, it sends nothing to the
    guest), and the `email_log` purge. This spec narrows the money path only.

**Edge cases:**

- Acompte paid but solde due date already past at creation (booking 3 days before arrival) → the solde
  request leaves the same day; `cancelOn` falls after the arrival date, so rule 13 keeps the cancel
  action hidden and the row shows as `unpaid_at_arrival` on arrival day.
- `balanceAmount = 0` (acompte covers everything, or an offered stay) → no solde échéance, no dunning,
  no cancellation path.
- `depositAmount = 0` on a direct booking (100 % on the solde) → no acompte alert; the solde path
  applies alone and a cancellation keeps nothing (rule 27).
- Client with no email → the alert still fires; the « Relancer » action reports « client sans email »
  instead of pretending to send.
- **A queued reminder left untouched for more than `lookbackDays` (7)** drops out of the pending queue.
  Nothing is lost: the dashboard row is the durable to-do and stays until the money arrives, the stay
  is cancelled, or 30 days after the departure (rule 20bis). The queue is a daily proposal, the card is
  the ledger of what is still owed.
- **`requestSent` reads `email_log`, which is purged 3 days after the arrival**
  ([email-history-rolling-window.md](email-history-rolling-window.md)). Harmless: every state that
  consumes it (`*_to_request`, `cancel_due`) is pre-arrival by construction, and `unpaid_at_arrival`
  — the only post-arrival state — does not look at it.
- **A platform booking never produces a `*_to_request` row** and never enters the pending queue for a
  payment anchor (rule 40ter): its solde is the platform's business, and its own late-payout row is
  `platform_payout_overdue`.
- Reservation cancelled while a Qonto link is still open → the open `payment_links` rows of that
  reservation are flipped to `cancelled` so a late click cannot pay a dead stay.
- Snoozed row whose solde arrives → the row disappears (the condition no longer holds); the snooze
  column is left as harmless residue.
- Cancelling a stay whose acompte was paid **in the current month** → the avoir + indemnity land in the
  same month as the encaissement; the three entries coexist and net to the correct result.

---

## 4. Architecture

> **Fat backend, thin frontend.** Every date derivation, every alert state, every accounting
> consequence is computed on the server. The client renders rows and opens dialogs.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `dashboard.js` | T | `GET /payment-deadlines`, `POST /payment-deadlines/:id/snooze`, `POST /payment-deadlines/:id/remind` |
| `routes/` | `reservations.js` | T | `POST /:id/cancel` |
| `controllers/` | `dashboardController.js` | T | Thin handlers over `paymentDeadlines` + snooze/remind orchestration |
| `controllers/` | `reservationsController.js` | T | `cancel` handler; **the acompte request on `create` is removed**; 409 guard on `update` / `updatePayment` for cancelled rows |
| `controllers/` | `reservationCancellationController.js` | C | Thin HTTP layer over `cancelReservation`, plus the two post-commit side effects (Google delete, notice email) |
| `models/` | `reservationsModel.js` | T | `cancel()` write, `listPaymentDeadlines()` read — now also reporting, per reservation, whether a `deposit_request` / `balance_request` was ever sent (`email_log` × `email_templates.stableKey`) — `snoozePaymentAlert()`, cancelled-aware `getByIdWithDetails` / `search` |
| `models/` | `accountingModel.js` | T | `kind IN ('reservation','cancelled')` on the encaissements + refunds month reads |
| `models/` | `refundsModel.js` | T | Same widening; accepts the `retained` method |
| `models/` | `cancellationCompensationsModel.js` | T | `origin` column, `createReceived()` for a card born already paid |
| `models/` | `propertiesModel.js` | T | `depositDueDays` / `cancelAfterBalanceDueDays` read+write, `depositDaysBefore` removed |
| `models/` | `emailLogModel.js` | T | Two new anchors in `listPending`, plus the rule-40bis guard (a reminder is only pending once its request was sent) and the rule-40ter own-channel filter on both payment anchors |
| `models/` | `emailTemplatesModel.js` | T | Carries `anchor` on every row it returns (the cron picks its query from it) |
| `models/` | `paymentLinksModel.js` | — | Consumed as-is to retire the open links of a cancelled stay |
| `controllers/` | `paymentsController.js` | T | `sendDepositRequestFor(id)`, the acompte twin of `sendBalanceRequestFor` |
| `utils/` | `paymentSchedule.js` | C | **Pure**: `resolveDepositDueDate`, `resolveBalanceDueDate`, `resolveCancelOn` — the single source of truth for the three dates |
| `utils/` | `paymentDeadlines.js` | T | **Pure**: reservation rows + today → ready-to-render alert rows (state, amounts, days late, actions). Gains the two `*_to_request` states, the `requestSent` inputs and the `cancel_due` guard of rule 12bis |
| `utils/` | `cancellationRequalification.js` | C | **Pure**: paid-acompte row → the avoir lines + the compensation payload of §3.6 |
| `utils/` | `cancelReservation.js` | C | The cancellation transaction itself, every dependency injected — history → kind flip → requalification pair → payment-link cleanup |
| `utils/` | `pricing.js` | T | Delegates the two due dates to `paymentSchedule.js`; takes `bookingDate` + the stored `depositDueDate` as inputs |
| `utils/` | `refunds.js` | T | `retained` added to `REFUND_METHODS` (book money, never off-books) and kept out of `SELECTABLE_REFUND_METHODS`, so the manual refund API refuses it |
| `utils/` | `balanceRequestRunner.js` | **D** | **Deleted** (rule 38) — its eligibility query moves into `paymentDeadlines.js` as the `balance_to_request` state |
| `utils/` | `emailAutoSendRunner.js` | T | Anchor-aware reservation lookup |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | `deposit_reminder` re-anchored + rewritten; `balance_reminder` and `cancellation_notice` added; the two reminders flipped to `sendMode: 'manual'` and `PAYMENT_STABLE_KEYS` exported (rule 44) |
| `utils/` | `migrateDepositReminderAnchor.js` | C | One-shot force-sync of the already-seeded `deposit_reminder` row to its new anchor — without it the reminder would silently stop firing |
| `utils/` | `emailContextBuilder.js` | T | `cancelOnDate`, `retainedDepositAmount`, `daysLate` tokens |
| `utils/` | `depositRequestOnBooking.js` | **D** | **Deleted** (rule 36) — no reservation triggers its own acompte request any more |
| `utils/` | `migratePaymentTemplatesToManual.js` | C | One-shot force-sync of the seeded `deposit_reminder` / `balance_reminder` rows to `sendMode = 'manual'` (rule 45) |
| `middleware/` | `enforceRoleAccess.js` | — | Nothing to do: the reception allowlist is deny-by-default, so the new endpoints are already refused |
| `scheduledTasks.js` | `scheduledTasks.js` | T | `runBalanceRequestJob` + `tickBalanceRequest` **removed**; the remaining 08:00 auto-email pass carries stay emails only (rule 46) |
| `database.js` | `database.js` | T | Idempotent migrations of §5 |
| `schema.sql` | `schema.sql` | T | Baseline updated with the new columns |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `Dashboard.jsx` | T | Mounts `<PaymentDeadlinesAlert />` above the iCal alerts |
| `pages/` | `PropertyDetail.jsx` | T | « Acompte & Solde » card: « Acompte (jours après réservation) », « Solde (jours avant) », « Annulation (jours après échéance) » |
| `pages/` | `ReservationPage.jsx` | T | « Annuler le séjour » action + read-only cancelled banner |
| `components/` | `PaymentDeadlinesAlert.jsx` | C | Dashboard card: fetches its rows, renders states, triggers the three actions |
| `components/` | `ReservationCancelDialog.jsx` | C | Confirmation dialog of rule 22 (recap + reason + notify checkbox) |
| `components/` | `CancellationCompensationsSection.jsx` | T | Shows `origin`, labels retained-deposit cards, links to the reservation |
| `components/` | `CancellationCompensationsPendingAlert.jsx` | T | Same labelling (a retained-deposit card is born `received`, so it never appears here — guard only) |
| `services/` | `api.js` | T | New endpoints |
| `constants/` | `paymentDeadlines.js` | T | State → French copy + severity badge map (presentation only); gains the two `*_to_request` states and the « Envoyer la demande » action label |
| `components/` | `CancellationCompensationsSection.jsx` | T | « Acompte conservé » badge + link to the cancelled stay on a `retained_deposit` indemnity |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `ConfirmDialog`, `FormDialog`, `PageActionBar`, `EmptyState`, `ErrorAlert` | The alert card is built from `Alert` + `StatusBadge` exactly like `CancellationCompensationsPendingAlert`. |
| **Created (new generic)** | — | None: nothing here is reusable outside the payment-deadline flow. |
| **Specific (kept feature-local)** | `PaymentDeadlinesAlert`, `ReservationCancelDialog` | Both are bound to this feature's payload and business copy; the dialog is a `FormDialog` composition, not a new `<Dialog>`. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/dashboard/payment-deadlines` | — | `{ rows: [{ reservationId, reservationNumber, state, severity, clientName, propertyName, startDate, endDate, depositDue, balanceDue, dueDate, daysLate, cancelOn, canCancel, canRemind, remindType, requestSent }] }` | Admin only (403 for reception). Snoozed rows excluded. `state` gains `deposit_to_request` / `balance_to_request`; `requestSent` tells the client whether to label the action « Envoyer la demande » or « Relancer ». |
| POST | `/api/dashboard/payment-deadlines/:id/snooze` | `{ days?: 7 }` | `{ ok: true, snoozedUntil }` | Idempotent. |
| POST | `/api/dashboard/payment-deadlines/:id/remind` | `{ type: 'deposit' \| 'balance' }` | `{ sent: true, url, recipientEmail }` | Unchanged — it now serves **both** the first request and the reminders, and is the only way a money email leaves. Relays `paymentRequestService` errors verbatim (400 `EMAIL_NOT_SENT`, 502…). |
| POST | `/api/reservations/:id/cancel` | `{ reason?: string, notifyClient?: boolean }` | `{ ok, cancellationReason, retainedDepositAmount, writtenOffBalance, refundId, compensationId, emailSent }` | 409 `ALREADY_CANCELLED`; 403 `PLATFORM_RESERVATION`; 404 unknown. |
| GET | `/api/accounting/cancellation-compensations` | — | unchanged + `origin` on each row | Additive. |

---

## 5. Data model

```sql
-- properties: the acompte is now anchored on the booking, and the cancellation delay is per property
ALTER TABLE properties ADD COLUMN depositDueDays INTEGER NOT NULL DEFAULT 7;
ALTER TABLE properties ADD COLUMN cancelAfterBalanceDueDays INTEGER NOT NULL DEFAULT 7;
UPDATE properties SET balanceDaysBefore = 30 WHERE balanceDaysBefore < 30;   -- one-shot, guarded by the `migrations` table
ALTER TABLE properties DROP COLUMN depositDaysBefore;                        -- guarded try/catch, no reader left

-- reservations: cancellation state + alert snooze. `kind` gains the value 'cancelled'.
ALTER TABLE reservations ADD COLUMN cancelledAt TEXT;
ALTER TABLE reservations ADD COLUMN cancellationReason TEXT;
ALTER TABLE reservations ADD COLUMN cancelledBy INTEGER;
ALTER TABLE reservations ADD COLUMN paymentAlertSnoozedUntil TEXT;
CREATE INDEX IF NOT EXISTS idx_reservations_cancelled ON reservations(cancelledAt);

-- indemnities: where the money comes from
ALTER TABLE cancellation_compensations ADD COLUMN origin TEXT NOT NULL DEFAULT 'platform';
```

- `reservation_refunds.method` needs **no** schema change (`TEXT`, no CHECK constraint) — `retained`
  is a code-level addition.
- The `UPDATE properties SET balanceDaysBefore = 30` runs **once**, recorded in the existing
  `migrations` idempotency table, so an operator who later chooses 21 days is not overwritten at
  the next boot.
- `depositDaysBefore` is dropped only after every reader is gone; the `ALTER … DROP COLUMN` is wrapped
  in a try/catch so an older SQLite simply leaves the dead column in place.
- **2026-08-20 amendment — no schema change**, one data force-sync (rule 45):

  ```sql
  -- one-shot, recorded in `migrations`: the seeded dunning templates stop auto-sending
  UPDATE email_templates SET sendMode = 'manual' WHERE stableKey IN ('deposit_reminder', 'balance_reminder');
  ```

  Nothing else is touched: `email_log` history stays, so a reminder already sent is still deduped, and
  a reservation whose request left last week keeps its `*_overdue` state instead of falling back to
  `*_to_request`.

**Data impact:** existing reservations keep their stored `depositDueDate` / `balanceDueDate` — no
backfill, no recomputation, so no in-flight stay changes its promised dates. The only visible change
for existing rows is that a *late* one may now appear in the new dashboard card; nothing is written by
that. Cancellation is purely additive (no row is ever deleted by this feature).

## 6. UI / UX

**Dashboard — « Échéances de paiement » card** (above the iCal alerts, below the linen shortage):
`severity="error"` when any row is `cancel_due` or `unpaid_at_arrival`, else `severity="warning"`.
One line per reservation:

```
⚠  Échéances de paiement (2)
────────────────────────────────────────────────────────────
 [Solde impayé]  DUPONT Marie · Le Lodge · 12→19 sept.
 Solde 640,00 € — échéance 13 août, 8 jours de retard
 Annulation possible depuis hier · acompte conservé 274,00 €
                      [Relancer] [Reporter] [Annuler le séjour]
────────────────────────────────────────────────────────────
 [Acompte en retard]  MARTIN Luc · La Grange · 4→11 oct.
 Acompte 240,00 € — échéance 15 août, 4 jours de retard
                                  [Relancer] [Reporter]
```

- **Copy:** « Acompte à demander — échéance le {date} », « Solde à demander — échéance le {date} »,
  « Acompte en retard de {n} jours », « Solde en retard de {n} jours »,
  « Solde impayé depuis {n} jours — annulation possible », « Arrivée non réglée ». A `*_to_request`
  row past its due date appends « — échéance dépassée de {n} jours ».
- **Action label:** « Envoyer la demande » on a `*_to_request` row, « Relancer » everywhere else.
  Same button, same endpoint; the label is the only thing that changes, so the operator always knows
  whether the guest has been asked once or twice.
- **`info` rows** (`deposit_to_request`) render with the same layout in the `info` palette; the card's
  own severity is the worst of its rows (`error` > `warning` > `info`).
- **Cancel dialog** (`ReservationCancelDialog`): title « Annuler le séjour », recap block
  (client / logement / dates / n°), then two money lines — « Acompte conservé : 274,00 € » and
  « Solde abandonné : 640,00 € » — a « Motif » text field, a « Prévenir le client par email »
  checkbox (unavailable when the client has no address), and the destructive confirm. A warning
  states plainly: « Les dates seront remises à la vente. L'acompte encaissé est requalifié en
  indemnité (hors TVA) dans la comptabilité du mois en cours. » When nothing was collected it reads
  « Aucun acompte n'a été encaissé : rien n'est conservé. » instead.
- **Comptabilité → Indemnités d'annulation:** the section subtitle now covers both origins, and a
  retained-acompte row carries an « Acompte conservé » badge plus a « voir le séjour » link.
- **Reservation page:** when cancelled, `PageActionBar` shows a red chip « Annulée le 19/08/2026 »
  (the day only — `displayDate` now trims the time part of a datetime column), the Save action is
  hidden, and « Annuler le séjour » no longer appears. The pricing summary shows the stay as it was,
  with no « Remboursements » line (rule 32bis).
- **Property detail:** the « Acompte & Solde » card keeps three number fields on one row —
  « % acompte », « Acompte (jours après réservation) », « Solde (jours avant) » — plus
  « Annulation (jours après échéance du solde) » below, with the helper text
  « Délai avant de pouvoir annuler un séjour dont le solde n'est pas réglé ».

**Responsive:**
- `xs` — one row per card block, buttons full-width and stacked (`flexDirection: { xs: 'column', sm: 'row' }`);
  the cancel dialog is `fullScreen`; the property card's number fields stack one per line.
- `md` — two number fields per line on the property card; alert rows keep their inline buttons.
- `lg` — the layout above; the alert never scrolls horizontally.

**Sticky action bar:** unchanged on the Dashboard (`PageActionBar title="Tableau de bord"`).
`ReservationPage` gains one `actionsAfter` entry — icon `EventBusyIcon`, tooltip
« Annuler le séjour », color `error`, hidden for reception and for non-direct platforms.

## 7. Test plan

### Server unit tests — **53 new, suite at 3157 green**
- [x] `tests/payment-schedule.unit.test.js` (9) — deposit due = booking + N and frozen across
      recomputes; devis → `validUntil`; balance = `max(start − 30, booking)`; late booking clamps to
      the booking day; nothing-to-collect → NULL; `cancelOn = balance + 7`; an absent setting falls
      back to the policy default instead of collapsing to "due the same day".
- [x] `tests/payment-deadlines.unit.test.js` (10) — the four states and their precedence; both-late
      collapses into one row; platform rows excluded (Lodgify is direct); snooze hides then re-shows
      without moving the deadline; no cancel action from the arrival day on; ordering.
- [x] `tests/reservation-cancellation.unit.test.js` (11) — against the real `schema.sql`: kind flip +
      stamps, **`validateAvailability` accepts the dates again**, amounts left untouched, avoir +
      indemnity written, nothing written when the acompte was never paid, history entry, open payment
      links retired, 409 on the second call, 403 on a platform booking, 404 unknown.
- [x] `tests/cancellation-requalification.unit.test.js` (5) — avoir lines mirror the acompte's buckets
      at the sale VAT rate; contribs that disagree with the stored acompte fall back to a single line
      so the total stays exact; the indemnity is born `received` with `origin='retained_deposit'`.
- [x] `tests/cancellation-accounting.unit.test.js` (4) — the acompte's month is byte-identical before
      and after the cancellation; the cancellation month carries the avoir + the indemnity and no
      séjour money; the pair nets to zero with the VAT reversed on one side and absent on the other;
      the month's journal balances debit = credit.
- [x] `tests/payment-dunning-emails.unit.test.js` (8) — both anchors in the cron and in the manual
      queue; money that arrived is never chased; devis excluded; one send ever; an anchor the cron
      cannot query is skipped rather than mailed to everyone.
- [x] `tests/deposit-request-on-booking.unit.test.js` (6) — sent for a direct booking with an email;
      the six skip reasons; a throwing sender never escapes (the booking stands).
- [x] Updated: `pricing-deposit-disabled`, `balance-request-runner` (rewritten for the widened rule),
      `reservations-search` (+ a cancelled-stay case), `email-log-model`, `email-auto-send-runner`,
      `email-manual-queue`, `emails-controller`, `cancellation-compensations-model`,
      `ical-cancellation-approve-compensation`.

### Client tests — **8 new, suite at 1006 green**
- [x] `components/__tests__/PaymentDeadlinesAlert.test.jsx` (7) — renders nothing when empty; the
      cancel-due and deposit-overdue renderings; « Relancer » calls the endpoint with the server's own
      `remindType`; a client without an email cannot be reminded; « Reporter » snoozes and reloads;
      the cancel dialog's recap and payload.
- [x] `CancellationCompensationsSection.test.jsx` — a `retained_deposit` indemnity is labelled
      « Acompte conservé » and links to its stay.
- [x] `PropertyDetail.test.jsx` — the three delay fields render with the new labels and defaults, and
      the old « Acompte (jours avant) » is gone.
- [x] `npx vitest run` green (127 files); `npm run test:e2e` green (Playwright).

### Manual UI verification
- [x] Dashboard: the card renders the two states with their actions, and disappears when nothing is
      late (verified in the browser against seeded data).
- [x] Cancellation from the card: dialog recap → confirm → the stay leaves the calendar, the fiche
      shows « Annulée le … » read-only, and Comptabilité shows the « Acompte conservé » indemnity.
- [x] Property detail: the three delays save and reload.
- [x] Mobile (`xs`): the alert stacks, buttons are full-width, the cancel dialog is fullscreen.

### Amendment 2026-08-20 — tests to add/update

**Server — 17 new, suite at 3314 green.**
- [x] `tests/payment-deadlines.unit.test.js` (+7) — the two `*_to_request` states; a never-asked solde
      never reaches `cancel_due` (rule 12bis); `deposit_to_request` appears on the creation day and
      survives its due date with the « échéance dépassée » copy; a sent request flips the row to its
      `*_overdue` twin; the solde becomes « à demander » ON its due date and not the day before;
      ranking; a platform booking never produces one. The « chase the bigger one » assertion is
      **reversed**: it pinned the rule-17ter bug.
- [x] `tests/default-email-templates-seed.unit.test.js` (+2) — no `PAYMENT_STABLE_KEYS` template ships
      `sendMode: 'auto'` (rule 44), and no key in that list is stale.
- [x] `tests/migrate-payment-templates-to-manual.unit.test.js` (+6, new) — the two `auto` rows flip; a
      stay email is left alone; a disabled reminder stays disabled; a second boot is a no-op; the
      one-shot guarantee is documented as living in the `migrations` table, not in the function.
- [x] `tests/payment-dunning-emails.unit.test.js` (+2) — a reminder is not queued until its own request
      has left (rule 40bis); **an Airbnb booking never enters the queue on a payment anchor**
      (rule 40ter — the regression PR #458 fixed on the cron side), while a Lodgify one does.
- [x] Deleted with their subjects: `tests/balance-request-runner.unit.test.js`,
      `tests/deposit-request-on-booking.unit.test.js`.
- [x] Fixtures gaining `platform` / `depositRequestSent` / `balanceRequestSent`: `email-log-model`,
      `email-manual-queue`, `emails-controller`, `payment-deadlines`.
- [ ] **Not covered by a test:** « creating a direct reservation sends no email ». The guarantee is the
      deletion of `depositRequestOnBooking.js` — there is no longer a module to call — and the repo has
      no precedent for source-scanning tests, which is what asserting an absent call would take.

**Client — 4 new, suite at 1042 green.**
- [x] `PaymentDeadlinesAlert.test.jsx` (+4) — the to-do state renders with « Envoyer la demande » and
      no cancel button; the click posts the server's own `remindType`; the « échéance dépassée » copy;
      the title counts late rows and to-dos separately.
- [x] `npx vitest run` green (131 files). `npm run test:e2e` — see below.

## 8. Out of scope

- **Un-cancelling.** No restore action; a mistake is fixed by re-creating the reservation and by
  reopening/deleting the indemnity card (both already possible).
- **Automatic cancellation.** Explicitly refused (§1 arbitrages) — the cron never cancels.
- **Automatic dunning.** Explicitly refused (§1 amendment, 2026-08-20) — the cron never sends a money
  email either. Re-enabling it later means one flag per template, not a rewrite.
- **A « tout envoyer » bulk action** on the dashboard card. Each send is one deliberate click on one
  reservation; a bulk button would rebuild the automatic behaviour by hand.
- **Partial retention.** The whole acompte is kept, never a percentage or a scale.
- **Cancellation conditions on the client side** (public site, devis PDF wording) — the schedule is
  enforced internally first; the guest-facing contractual copy is a separate pass.
- **Push notifications** for the new deadlines; the dashboard card is the only surface.
- **Platform reservations' own cancellation policies** — untouched, they keep the iCal flow.

## 9. Open questions

- Q: Should the « Annulées » stays get their own filter on `ReservationsUpcomingPage`?
  - A: Not in this spec — search + the indemnity card's link cover retrieval (rule 26). Revisit if
    Adrien misses them in a list.
- Q: Should `cancelAfterBalanceDueDays` be global rather than per property?
  - A: Per property, to sit beside `balanceDaysBefore` in the same card; both properties are set to
    the same values today.
- Q: **Resolved 2026-08-20** — should GuestFlow chase the acompte and the solde by itself?
  - A: **No, not for now.** Every money email is validated and sent by Adrien; the dashboard card is
    the to-do list that guarantees none is forgotten. Reopen only if the daily click becomes a chore
    *and* the deadline data has proven trustworthy for a full season.
- Q: Should a `*_to_request` row raise a push notification, since nothing else will chase it?
  - A: Not in this amendment — the dashboard card is still the only surface (§8). Revisit if a request
    is actually forgotten in practice.
