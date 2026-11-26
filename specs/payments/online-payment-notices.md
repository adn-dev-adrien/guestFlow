# Notices of an online payment received on a stay

| Field | Value |
|---|---|
| **Status** | Implemented — 2026-11-26 (approved by the owner on the summary page) |
| **Branch** | `feature/online-payment-notices` |
| **Created** | 2026-11-26 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary for the owner** | `docs/specs/2026-11-26-online-payment-notices.html` (interactive, French) |

---

## 1. Context

The rule-by-rule audit of the money specs (2026-11-26) found two rules of
`specs/payments/online-payments-qonto.md` written and never built:

- **Rule 14** — when a balance is paid online, the operator gets a dashboard message and an e-mail, and the
  guest a « solde reçu » e-mail. Today `paymentPollRunner` records the payment (`balancePaid = 1`) and
  nothing else happens: the operator learns it only by opening the fiche.
- **Rule 9** (manual half) — a devis the host converts by hand is meant to send the guest the same
  confirmation as an automatic conversion. `devisController.convertToReservation` emits
  `reservation.created` and sends nothing.

Adrien chose on 2026-11-26 to build both, under the standing rule that no guest e-mail leaves without the
operator's approval unless its template is set to `auto`
(`specs/emails/no-automatic-email-without-approval.md` rule 11).

What already exists and is reused: `notificationService.notifyOperator` (push on a channel + e-mail to
the notification address, used by the online sales, `specs/site/site-outside-resource-booking.md` rule 23),
the home attention subjects (`utils/dashboardAttention.js`, `specs/planning/shell-and-home-day-first.md`),
and the gated sender of the confirmation (`buildGatedConfirmationSender`: sent at once when the template is
`auto`, otherwise queued in « Emails à envoyer »).

## 2. Goal

The operator knows, without opening a fiche, that a guest has paid online; the guest receives a receipt
for the balance; a devis converted by hand confirms the stay like one converted by a payment.

## 3. Functional rules

### 3.A The operator's notice

1. **Every online payment recorded on a stay is announced** — acompte, solde, full payment, échéance of a
   schedule — when the payment poll or the webhook records it (`recordPayment` from `paymentPollRunner`).
   A payment the operator marks by hand is not announced: the operator already knows.
2. **One notice per payment**: a push on the channel `stay-payments` (« Paiements en ligne reçus », one
   toggle in « Notifications push », declared by the `online-payment` plugin) and one e-mail to the
   notification address, through `notifyOperator`, with its existing gates (e-mail switch, SMTP, an address
   typed by the operator). A replayed poll or webhook on the same link announces nothing more.
3. **Words, built by the server** — title « Acompte reçu · 320 € » (« Solde reçu », « Paiement total reçu »,
   « Échéance reçue »), body « <guest>, <logement>, du <arrivée> au <départ>. », link to the fiche. Amounts
   by the shared formatter, never a literal.
4. **A payment that needs action keeps its own alert**: a payment booked on a cancelled stay, a double
   payment or an amount mismatch already raise `notifyPaidAfterCancel` / the mismatch alert; they are not
   announced a second time as an ordinary receipt. A payment that also lands in a date conflict is the opposite case: it is an
   ordinary payment, so it gets both the ordinary notice and the conflict alert.

### 3.B The home subject

5. **« Paiements reçus »** — a home attention subject (severity `info`, never pinned) counting the online
   payments recorded in the last 24 hours, one line each (guest, bucket, amount, time), each opening its fiche.
   Shaped by the server like « Nouvelles réservations »; absent when the count is 0. The 24 hours run from the payment's
   own time (`paidAt`, the provider's clock): `payment_links` keeps no separate recording time, so a payment the poll finds
   late is listed for what remains of its 24 hours.

### 3.C The guest's receipt for the balance

6. **New default template `balance_received`** (« Solde reçu », FR + EN): recap of the stay (dates, logement),
   the amount received, what remains to pay (normally 0 €) and the arrival reminder tokens already used by
   the confirmation. Event-triggered (`EVENT_TRIGGERED_STABLE_KEYS`), never date-scheduled.
7. **Sent through the gated sender, like the confirmation**: at once when the template is `auto`, otherwise
   queued in « Emails à envoyer ». It **ships `auto`** — the third named exception to
   `specs/emails/no-automatic-email-without-approval.md` rule 11, granted by Adrien on 2026-11-26: a receipt
   asks the guest for nothing. The operator can switch it to `manual` on the Emails page. Triggered only by an online balance (or the last
   échéance of a schedule) recorded by the poll or the webhook; a full payment sends the confirmation, not
   this receipt.

### 3.D A devis converted by hand

8. **The conversion queues the confirmation**: `convertToReservation` passes the new stay to the same
   gated sender as the automatic conversion (`reservation_confirmation`, its own mode decides). Converting
   twice, or converting a devis already confirmed by a payment, sends nothing more.

## 4. Architecture

### Server

| Layer | File | New/Touched | Responsibility |
|---|---|---|---|
| utils | `utils/paymentNotices.js` | New | Pure: the words of a payment notice (title, body, url, subject, lines) and of one home line, from the stay and the bucket; amounts by `emailMoney.emailAmount` |
| utils | `utils/paymentsReceived.js` | New | Reads: the stay of a paid link (a devis link follows its devis), the operator's notice, the last 24 hours' lines, « does this link close the balance » (a balance link, or the last échéance) |
| utils | `utils/paymentPollRunner.js` | T | `processPaidLink`, after an ordinary effect (`converted`, `already-converted`, `deposit-marked`, `balance-marked`, `installment-marked`, no amount mismatch, not closed, not a withdrawn link): `notifyPaymentReceived(link)` (rules 1-2, 4) and `sendBalanceReceived(stayId)` when the link closes the balance (rule 7). Only the caller that flips the link runs it, so a replay announces nothing |
| utils | `utils/paymentEffectDeps.js` | T | Wires `notifyPaymentReceived` (→ `notificationService.notifyOperator`) and `sendBalanceReceived` (gated sender) into the deps the poll, the webhook and the on-demand status read share |
| utils | `utils/reservationEmailSender.js` | T | `buildGatedStayMailSender`: the confirmation's gate for any event e-mail of a stay (template `auto` → sent at once, otherwise queued, idempotent) |
| utils | `utils/dashboardAttention.js` | T | Subject `payments-received` (info, rank 12, never pinned) (rule 5) |
| controllers | `controllers/dashboardController.js` | T | `paymentsReceived` → `{ alerts }` (read by the subject and `GET /api/dashboard/payments-received`) |
| routes | `routes/dashboard.js` | T | The endpoint and the attention source |
| utils | `utils/defaultEmailTemplatesRegistry.js`, `templateWhen.js`, `emailTimeline.js` | T | Template `balance_received` (`auto`, anchor `balanceReceived`, event-triggered); its « Quand » sentence and its place on the Emails page |
| specs | `specs/emails/no-automatic-email-without-approval.md` | T | Rule 11 names `balance_received` as its third exception |
| controllers | `controllers/devisController.js` | T | After a successful manual conversion, the stay goes to the gated confirmation sender (rule 8) |
| plugin | `plugins/online-payment/index.js`, `manifest.json` | T | `ctx.pushChannel({ key: 'stay-payments', label: 'Paiements en ligne reçus' })`; version 1.10.0 |

No migration: `ensureDefaultEmailTemplates` inserts a missing default at every boot, so existing databases get `balance_received` (`auto`) idempotently, and never overwrite an operator's choice of mode.

### Client

| Layer | File | New/Touched | Responsibility |
|---|---|---|---|
| components | `components/PaymentsReceivedAlert.jsx` | New | Unfolds the « Paiements reçus » subject: an `AttentionCard` with one `ReservationLinkLine` per payment (guest and amount on the first line, bucket and logement, then the time); it fetches `getPaymentsReceived` like `NewReservationsAlert` and renders what the server wrote |
| components | `components/attentionSubjects.js` | T | Registers the subject |
| services | `api.js` | T | `getPaymentsReceived` |

### API

- `GET /api/dashboard/attention` — gains the `payments-received` subject (additive).

## 5. Data model

No new column. The notice's idempotence reads `payment_links` (`status = 'paid'`, `paidAt`); the home subject
reads the same rows over 24 h. `email_templates` gains one default row.

## 6. UI / UX

See the summary page. Home subject on phone: the same card as « Nouvelles réservations », one line per
payment, the amount right-aligned in tabular figures. The push opens the fiche.

## 7. Test plan

- Server: `online-payment-notices.unit.test.js` (23 tests) — rules 1-8 (one notice per payment, none on a manual mark,
  none twice, words, the 24 h subject, `balance_received` queued when `manual` and sent when `auto`, manual
  conversion confirms once).
- Client: `PaymentsReceivedAlert.test.jsx` (2 tests) — renders the server's lines, empty or failing → absent.
- Manual: a Qonto sandbox payment on a stay → push, e-mail, home subject, queued receipt; phone check.

## 8. Out of scope

- A receipt e-mail for the acompte (the confirmation already plays that role).
- Notices for platform payouts (Booking, Airbnb): not online payments on our links.

## 9. Open questions

None open.

**Resolved (Adrien, 2026-11-26, summary page `docs/specs/2026-11-26-online-payment-notices.html`):**

- Which payments are announced → every online payment on a stay (rule 1).
- Where on the home → its own subject « Paiements reçus » (rule 5).
- Push channel → its own channel « Paiements en ligne reçus », `stay-payments` (rule 2).
- The « Solde reçu » e-mail → ships `auto` (rule 7), third named exception to the e-mail policy.
- A devis converted by hand → follows the mode of the « Confirmation » template (rule 8).
- Sibling Qonto links (fix PR, not this spec) → deactivated at once when a payment settles the bucket.

**Built as follows (2026-11-26):**

- The receipt shows the stay's balance (`{{balanceAmount}}`) and, when an arrival complement is still due, « Reste à régler sur place » (`{{complementAmount}}`), otherwise « Reste à payer : rien ». It uses only tokens of the stay's own context, so the queued e-mail renders exactly like the one sent at once.
- The home subject lists every paid link of a live stay in the last 24 hours, including one that raised an alert of its own (a double payment keeps its line: the money did arrive).
- The notices are fired after the confirmation and the conflict alert and are never awaited: a slow push or SMTP holds neither the guest's return page nor the webhook. Whether a link closes the balance is read before any await, and the receipt's auto path skips a stay that already has a `sent` row or a send in flight, so two last échéances settled at once mail the guest once.
- Event-triggered templates are ignored by the daily auto-send pass and by the check that arms it (`anyTemplateAutoSends`), so shipping `balance_received` as `auto` does not arm the 08:00 pass.
- The e-mail is addressed only through `notifyOperator`'s gates; a payment announced when SMTP or the address is missing is announced by push only.
