# Notices of an online payment received on a stay

| Field | Value |
|---|---|
| **Status** | Approved — 2026-11-26 (owner, summary page) |
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
   announced a second time as an ordinary receipt.

### 3.B The home subject

5. **« Paiements reçus »** — a home attention subject (severity `info`, never pinned) counting the online
   payments recorded in the last 24 hours, one line each (guest, bucket, amount, time), each opening its fiche.
   Shaped by the server like « Nouvelles réservations »; absent when the count is 0.

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
| utils | `utils/paymentNotices.js` | New | Pure: the words of a payment notice (title, body, url, subject, lines) from the stay and the bucket |
| utils | `utils/paymentPollRunner.js` | T | After `recordPayment` of an ordinary online payment: notify the operator (rule 1), trigger `balance_received` (rule 7) |
| utils | `utils/notificationService.js` | T | Reuse `notifyOperator`; idempotence by link id (rule 2) |
| utils | `utils/dashboardAttention.js` | T | Subject `payments-received` (rule 5) |
| controllers | `controllers/dashboardAttentionController.js` | T | Reads the payments recorded online in the last 24 h |
| utils | `utils/defaultEmailTemplatesRegistry.js` | T | Template `balance_received`, `auto`, event-triggered |
| specs | `specs/emails/no-automatic-email-without-approval.md` | T | Rule 11 names `balance_received` as its third exception |
| database | `database.js` | T | Seeds `balance_received` on existing databases (idempotent) |
| controllers | `controllers/devisController.js` | T | Gated confirmation after a manual conversion (rule 8) |
| plugin | `plugins/online-payment/index.js` | T | `ctx.pushChannel({ key: 'stay-payments', label: 'Paiements en ligne reçus' })`; version bump |

### Client

| Layer | File | New/Touched | Responsibility |
|---|---|---|---|
| components | `components/PaymentsReceivedAlert.jsx` | New (generic list renderer reused from `NewReservationsAlert` if it fits) | Unfolds the « Paiements reçus » subject |
| pages | home | T | Registers the subject |

### API

- `GET /api/dashboard/attention` — gains the `payments-received` subject (additive).

## 5. Data model

No new column. The notice's idempotence reads `payment_links` (`status = 'paid'`, `paidAt`); the home subject
reads the same rows over 24 h. `email_templates` gains one default row.

## 6. UI / UX

See the summary page. Home subject on phone: the same card as « Nouvelles réservations », one line per
payment, the amount right-aligned in tabular figures. The push opens the fiche.

## 7. Test plan

- Server: `online-payment-notices.unit.test.js` — rules 1-8 (one notice per payment, none on a manual mark,
  none twice, words, the 24 h subject, `balance_received` queued when `manual` and sent when `auto`, manual
  conversion queues once).
- Client: `PaymentsReceivedAlert.test.jsx` — renders the server's lines, empty → absent.
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
