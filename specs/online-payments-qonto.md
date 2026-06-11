# Online payments via Qonto payment links (deposit / balance lifecycle)

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `feature/online-payments-qonto` _(user-managed)_ |
| **Created** | 2026-06-11 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow already receives **pre-reservations** from the WordPress site as **devis** (kind='devis',
dates NOT blocked) via the public booking API, and can convert a devis to a reservation
(`devisModel.convertToReservation` — [devisController.js:67](../server/src/controllers/devisController.js#L67)).
It also has a complete **email automation** stack: templated emails with `dayOffset` scheduling, a
daily ~08:00 cron pass (`emailAutoSendRunner` via [scheduledTasks.js:110](../server/src/scheduledTasks.js#L110)),
manual + auto send modes, `email_log`, and a dashboard "pending emails" widget. Settings hold the
**company name + logo + SMTP** (encrypted at rest, AES-256-GCM via `utils/encryption.js`).

What's missing: a way for the guest to **pay online** (deposit, then balance) so the host doesn't
chase payments manually, with the devis→reservation transition driven by the actual payment.

**Payment provider — decided after the §1 study (see `specs/` discussion 2026-06-11):**
**Qonto payment links** (Adrien's bank). Cheapest consumer-card rate (**1.4 % + €0.25**), money lands
directly on the Qonto account, and a **Business API** (`POST /v2/payment_links`, OAuth2) creates links
programmatically and exposes payment status. The payment page is **hosted by Qonto** (Mollie-backed) —
**no payment page is built on the WordPress site** (the guest is sent a secure link). In-person
**Tap to Pay is deferred** to a later project. Payment detection is by **polling** the Qonto API from
GuestFlow's existing scheduler (no public inbound webhook endpoint to expose on the Raspberry Pi).

## 2. Goal

A guest who pre-reserves on the site receives a branded email with a **secure Qonto payment link** to
pay the **deposit**; paying it confirms the stay (devis → reservation, dates blocked). Ten days before
the balance due date the guest is emailed a link for the **balance**, with reminders, and an unpaid
balance past the deadline surfaces on the dashboard for the host to release the dates. Every paid /
overdue event notifies the host (dashboard + email) and the guest (confirmation email).

## 3. Functional rules

### 3.1 Dedicated "Paiements" settings page

1. A **new dedicated settings page "Paiements"** holds everything payment-related:
   - **Bank connection (Qonto):** the OAuth2 connection to the Qonto Business API + the one-time
     "payment-links provider" connection (`POST /v2/payment_links/connections`). Credentials/tokens are
     stored **encrypted** (same column-encryption as SMTP/Google). A read-only **status** line shows
     whether Qonto is connected, via the existing `StatusCard`. No secret is ever returned in clear.
   - **Every duration is configurable here — nothing is hard-coded.** The values below are only the
     defaults Adrien gave:
     - **Deposit:** reminder offsets before its due date (default **J-5, J-day**), abandonment offset
       after the due date (default **J+1**), link expiry (default **due date + 1 day**).
     - **Balance:** reminder offsets (default **J-10, J-5, J-day**), abandonment offset after its due
       date (default **J+1**), link expiry (default **due date + 1 day**).
     - **Last-minute (full payment):** the **threshold** below which the deposit is dropped (default
       **30 days** before arrival — §3.7), the full-payment **due-date offset** before arrival
       (default **J-7**, Q7), its reminder offsets / abandonment offset / link expiry (reuse the
       balance defaults unless overridden).
   - The deposit/balance **due dates** themselves come from the property's existing
     `depositDaysBefore` / `balanceDaysBefore` settings (already per-property configurable) — this page
     configures the reminder/expiry durations *relative to* those dates.
   - The payment **email templates'** content stays editable in the existing Emails page; this page
     owns the *schedule* (offsets/deadlines), decoupled from the *content* (templates).
2. The setup procedure (§ deliverable 4) documents the Qonto OAuth app registration + provider
   connection so Adrien can redo it.

### 3.2 Payment links (Qonto Business API)

3. A payment link is created via `POST /v2/payment_links` with: **amount** (the deposit / balance /
   complement amount, in cents), a **reference** carrying the reservation/devis id (for
   reconciliation), **single-use**, payment methods = card + Apple Pay (+ bank transfer for large
   amounts — open Q). Each created link is persisted in a new `payment_links` table (§5) with its
   Qonto id, URL, type, amount and status.
4. **Deposit link** is created when the host triggers the deposit email from a devis. **Balance link**
   is created when the balance email goes out (J-10). **Complement** can reuse the same link mechanism
   on demand (a button on the reservation) — modeled now, but Tap-to-Pay collection is the deferred
   path.
5. **Link expiry:** the deposit link expires at the **deposit due date + 1 day** (configurable in the
   Paiements settings); an expired/unpaid link can be regenerated + re-sent. The balance link expires
   at the balance due date (+ the configured grace).

### 3.3 Payment detection (polling)

6. A scheduled pass (extends `scheduledTasks.js`) lists **open** `payment_links` and calls the Qonto
   API (`GET /v2/payment_links/{id}/payments`) to detect a **succeeded** payment. On success it marks
   the link `paid` (+ `paidAt`, Qonto payment id) and triggers the business flow (§3.4 / §3.5 / §3.7).
   Polling cadence: **twice a day**. Idempotent: a link already `paid` is skipped.
7. **Manual fallback always available.** The host can mark the deposit/balance received by hand on the
   reservation (existing paid-flags) — and convert the devis manually — independent of polling.

### 3.4 Deposit → confirm the stay

8. **Deposit email (manual trigger from a devis).** Built from a template; contains, in this order:
   - Stay recap: **arrival/departure date + time**, **options** chosen, **resources** booked.
   - Totals: **accommodation + options + resources**, then **tourist tax**.
   - What to pay now: the **deposit amount**, plus the **full stay total** and the **balance amount +
     balance due date**.
   - A clear notice: **paying the deposit blocks the dates; until then the dates may be taken by
     another guest.**
   - The **Qonto payment link** for the deposit.
   - A branded **signature** with the **company name** (SMTP `fromName`/`companyName`) and the
     **logo** (`companyLogoPath`).
9. **On deposit paid:**
   - **Auto (polling):** the devis is **converted to a reservation**, `depositPaid=true` with
     `depositPaidDate = today`, a **dashboard message** is posted, and a **notification email** is sent
     to the host (GuestFlow user). A **confirmation email** is sent to the **guest** ("acompte reçu,
     séjour confirmé") with the stay recap.
   - **Manual:** the host converts the devis → on conversion, the guest gets the same confirmation
     email.
10. Conversion reuses `devisModel.convertToReservation`; the deposit-paid date is the conversion day.
11. **Deposit reminders (same system as the balance, configurable).** While the deposit is unpaid, the
    guest gets reminder emails at the configured offsets before the deposit due date (default **J-5**
    and **J-day**) — dunning, with the payment link.
12. **Deposit overdue → devis abandoned + client email.** At the configured offset after the deposit
    due date (default **J+1**) with the deposit still unpaid, the **devis is switched to "abandoned"**
    (it never became a reservation; no dates were blocked), a **dashboard message** + **host email**
    are posted, and a **mail is sent to the guest** telling them the reservation is **considered
    abandoned** (dates released, deposit was required to hold them). The abandoned devis lands on the
    "Réservations non réglées" page (§3.6).

### 3.5 Balance → reminders → overdue

13. **J-10 before the balance due date** (offset configurable): auto email with the **same recap as the
    deposit email** but for the **balance** (balance amount + due date), a **new Qonto payment link**
    for the balance amount, and the notice: **without the balance paid by the deadline, the
    reservation is considered abandoned and re-listed, with no refund of the deposit.**
14. **On balance paid:** mark `balancePaid=true` on the reservation, post a **dashboard message**, send
    a **host notification email**, and send the **guest** a confirmation email ("solde reçu") with the
    stay recap.
15. **J-5 and J-day (balance unpaid)** (offsets configurable): auto **reminder** email to the guest
    (dunning), with the link.
16. **J+1 after the due date (still unpaid)** (offset configurable): post a **dashboard message** +
    **host email** ("balance not paid, must be released"), **and a mail to the guest** informing them
    the reservation is abandoned (no deposit refund). The dashboard notification carries a **Cancel**
    button → moves the reservation to the **"Réservations non réglées"** archive page and **frees the
    dates** (excluded from occupancy/planning).

### 3.6 "Réservations non réglées" archive

17. Both an **abandoned devis** (deposit overdue, §3.4 rule 12) and a **released reservation** (balance
    overdue + cancelled, rule 16) land on a dedicated **"Réservations non réglées"** page, kept for
    records / audit. A reservation moved there has its dates **freed** (occupancy excludes it).

### 3.7 Last-minute booking (≤ 30 days before arrival) — full payment, no deposit

18. **Engine-detected.** When the stay **starts within the last-minute window** (default 30 days,
    configurable), the **pricing engine** itself drops the deposit (deposit = 0, the full stay total is
    due as a single payment) and the **reservation fiche shows no deposit** — exactly the existing
    no-deposit handling used for iCal reservations (`depositDisabled`). All amounts (deposit, balance,
    total) always come from the engine, in this case and the normal case alike.
19. **Single full-payment link + flow.** In this case the deposit step is **skipped**: the host sends a
    single email asking for the **full stay total** (one Qonto link). Reminders / overdue / abandonment
    follow the same configurable schedule (anchored on that payment's due date). On paid → devis →
    reservation, confirmed; on overdue → devis abandoned (rule 12 path). No separate balance step.

### 3.8 Email scheduling anchor

20. Deposit/confirmation emails after a payment are **event-driven**. Scheduled reminders are relative
    to a payment **due date**, not the arrival date — so payment templates carry a scheduling
    **anchor** (`depositDueDate` | `balanceDueDate`) in addition to the existing `startDate` anchor.
    The configurable offsets (§3.1) drive *when*; the templates drive *what*.

**Edge cases:**
- Deposit/balance paid twice / link reused → idempotent (single-use links; a `paid` link is never re-processed).
- Guest pays before a reminder offset (e.g. from a regenerated link) → detected by polling, later reminders suppressed.
- Manual mark-received then a late polling hit → no double conversion / double-mark (guard on already-converted / already-paid).
- A stay exactly on the last-minute threshold → treated as last-minute (full payment), engine-decided.
- Deposit/balance due date changes after a link was issued → the host regenerates the link.
- Qonto API/network error during a poll → logged, retried next pass; never crashes the scheduler.

---

## 4. Architecture

> **Fat backend, thin frontend.** All payment logic, Qonto API calls, amount computation, scheduling,
> reconciliation, and state transitions live on the server. The client renders the devis/reservation
> actions, the dashboard notifications, the settings connect-flow, and the unpaid-reservations page.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `qontoClient.js` | C | Thin Qonto Business API client: OAuth token mgmt (refresh), `createPaymentLink`, `getPaymentLinkPayments`, `connectProvider`. Pure-ish, injectable for tests. |
| `utils/` | `pricing.js` | T | **Last-minute rule (§3.7):** the engine auto-drops the deposit (deposit = 0, full total due) when the stay starts within the configurable window — same `depositDisabled` path as iCal. All amounts stay engine-owned. Unit-tested. |
| `models/` | `paymentLinksModel.js` | C | CRUD for the new `payment_links` table; `listOpen()`, `markPaid()`, `findForReservation()`. |
| `models/` | `settingsModel.js` | T | New encrypted Qonto columns (client id/secret, OAuth tokens, connection id) **+ payment-timing settings** (deposit/balance reminder offsets, abandonment offsets, last-minute window, expiry) + `qontoConfigured()` / `decryptedQontoSettings()` / `paymentTimings()`. |
| `models/` | `reservationsModel.js` | T | Occupancy excludes `cancelledUnpaidAt IS NOT NULL`; helpers to mark a reservation released-unpaid and a devis abandoned; list for the unpaid page. |
| `models/` | `devisModel.js` | T | Deposit-paid → `convertToReservation` (deposit date = today); deposit-overdue → mark devis abandoned. |
| `controllers/` | `paymentsController.js` | C | Endpoints: create+send a link (deposit/balance/full), regenerate, get status, manual mark, cancel-unpaid. Thin → model/util. |
| `controllers/` | `paymentSettingsController.js` | C | Read/update the Paiements page: Qonto OAuth connect/callback/status + the payment-timing settings. |
| `controllers/` | `dashboardController.js` | T | Surface payment dashboard messages (paid, overdue) + the cancel action. |
| `routes/` | `payments.js` | C | `POST /reservations/:id/payment-links`, `GET …/status`, `POST …/cancel-unpaid`, payment-settings + Qonto OAuth routes. |
| `utils/` | `emailContextBuilder.js` | T | Add the stay-recap + payment context (amounts, link URL, due date, signature/logo) for the new templates. |
| `utils/` | `defaultEmailTemplatesRegistry.js` + `defaultEmailTemplatesSeed.js` | T | Seed the new templates: deposit request, deposit reminder, deposit confirmed, **deposit-abandoned (client)**, full-payment request (last-minute), balance request, balance reminder, balance confirmed, **balance-abandoned (client)**, overdue-internal (host). |
| `utils/` | `emailAutoSendRunner.js` | T | Support the **`depositDueDate` / `balanceDueDate` anchors** + the configurable offsets (alongside the existing `startDate` anchor). |
| `scheduledTasks.js` | `scheduledTasks.js` | T | New **payment polling pass** (twice/day; detect paid links → trigger flows) + drive the deposit/balance reminder + abandonment passes off the configured offsets. |
| `database.js` | `database.js` | T | Migrations: create `payment_links`; add Qonto + payment-timing settings columns; add `reservations.cancelledUnpaidAt`; add template `anchor` column. |

**Notes:** routes thin; Qonto calls isolated in `qontoClient` (mockable). Secrets via `encryption.js`.
Polling + reminder passes reuse the scheduler's in-progress-guard pattern (like `emailAutoSendInProgress`).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `ReservationPage.js` (devis mode) | T | "Envoyer la demande d'acompte" / "…de solde" / "…du règlement total" (last-minute) action (PageActionBar); shows link status. |
| `pages/` | `PaymentsSettingsPage.js` | C | Dedicated **Paiements** page: Qonto connect (consumes `StatusCard`) + the editable reminder/deadline timings. |
| `pages/` | `UnpaidReservationsPage.js` | C | Dedicated list of abandoned devis + released reservations (uses `DataPageScaffold`/`TableCard`). |
| `components/` | dashboard notification items | T | Payment-paid + balance-overdue messages; the overdue one has a **Cancel** button. |
| `services/` | `api.js` | T | New payment endpoints. |

**Component reuse declaration:** consumes existing `StatusCard`, `PageActionBar`, `DataPageScaffold`,
`FormDialog`, `ConfirmDialog`; no new generic component anticipated (the unpaid page is a standard
list). Email rendering stays server-side.

### 4.3 API contract (initial sketch)

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/reservations/:id/payment-links` | `{ type: 'deposit'|'balance'|'complement' }` | `{ url, status, expiresAt }` (creates link + sends the matching email) |
| GET | `/api/reservations/:id/payment-links` | — | `[{ type, url, status, amount, paidAt }]` |
| POST | `/api/reservations/:id/cancel-unpaid` | — | `{ ok }` (archive + free dates) |
| GET/POST | `/api/settings/qonto/*` | OAuth connect/callback/status | — |

---

## 5. Data model

**New table `payment_links`:**
`id, reservationId, type ('deposit'|'balance'|'complement'), qontoPaymentLinkId, url, amountCents,
currency DEFAULT 'EUR', status ('open'|'paid'|'expired'|'cancelled'), qontoPaymentId, createdAt,
paidAt, expiresAt`. Index on `(status)` and `(reservationId)`.

**`app_settings` new columns:**
- Encrypted Qonto: `qontoClientIdEncrypted`, `qontoClientSecretEncrypted`, `qontoAccessTokenEncrypted`,
  `qontoRefreshTokenEncrypted`, `qontoConnectionId`, `qontoConnectedAt`.
- Payment timings (all editable on the Paiements page; defaults from Adrien, none hard-coded):
  `paymentDepositReminderOffsets` (JSON, default `[-5, 0]`), `paymentDepositAbandonOffset` (`1`),
  `paymentDepositLinkExpiryDays` (`1`), `paymentBalanceReminderOffsets` (JSON, default `[-10, -5, 0]`),
  `paymentBalanceAbandonOffset` (`1`), `paymentBalanceLinkExpiryDays` (`1`), `paymentLastMinuteDays`
  (`30`), `paymentFullPaymentDueDaysBefore` (`7`). All read through a single `settingsModel.paymentTimings()`
  that applies the defaults, so the rest of the code never hard-codes a duration.

**`reservations` new column:** `cancelledUnpaidAt TEXT` (nullable) — set when a **devis is abandoned**
(deposit overdue) or a **reservation is released** (balance overdue). When set: excluded from
occupancy/planning and listed on the "Réservations non réglées" page. No existing data affected
(default NULL). (Devis are `kind='devis'` reservations, so the same column covers both.)

**`email_templates` new column:** `anchor TEXT DEFAULT 'startDate'`
(`'startDate' | 'depositDueDate' | 'balanceDueDate'`) — lets a payment template schedule off the
relevant due date. Existing templates default to `'startDate'` (unchanged behavior).

**Data impact:** additive only; all new columns default to NULL / their prior behavior. Migration note in CHANGELOG.

## 6. UI / UX

- **Devis (ReservationPage):** a primary action "Envoyer la demande d'acompte" in the `PageActionBar`
  (after the recap is correct); once sent, a chip shows the link status (en attente / payé). Same for
  the balance on a reservation.
- **Settings:** a Qonto `StatusCard` (Connecté / Non connecté + "Connecter Qonto" button → OAuth).
- **Dashboard:** payment-paid messages (info/success) and the balance-overdue message (warning) with a
  **Annuler la réservation** button (→ `ConfirmDialog` → archive + free dates).
- **Unpaid reservations page:** sidebar entry; table of released reservations (guest, stay, amounts,
  date released) for records/audit.
- **Emails:** branded HTML — header logo, the structured recap, the highlighted amount-to-pay + a big
  **"Payer en ligne"** button (the Qonto link), the company signature. French copy.
- **Responsive:** all GuestFlow screens follow the existing responsive rules; emails use a
  mobile-friendly single-column layout.

## 7. Test plan

### Server unit tests
- [ ] `qontoClient` — link creation payload (amount in cents, reference = reservation id), token
      refresh, payment-status parsing; all against a mocked HTTP layer.
- [ ] `paymentLinksModel` — create/listOpen/markPaid idempotency.
- [ ] **Last-minute engine rule (`pricing.js`)** — a stay starting within the window → deposit = 0,
      full total due (depositDisabled), like iCal; outside the window → normal deposit/balance split;
      threshold is the configurable window.
- [ ] Polling pass — open link paid → marks paid + converts devis + posts dashboard msg + queues
      emails; already-paid link skipped; API error doesn't throw.
- [ ] Reminder/abandonment scheduling — deposit (J-5/J-day, abandon J+1) off `depositDueDate` and
      balance (J-10/J-5/J-day, abandon J+1) off `balanceDueDate`, all from the **configured offsets**;
      paid → later reminders suppressed.
- [ ] Deposit overdue → **devis marked abandoned** (`cancelledUnpaidAt` set) + client/host emails queued.
- [ ] Occupancy excludes `cancelledUnpaidAt` rows (devis abandoned + reservations released).
- [ ] Email context — deposit/balance/full recap + amounts + link + signature/logo present.

### Manual verification
- [ ] End-to-end on a Qonto **test/sandbox**: deposit link → pay → polling converts devis + emails.
- [ ] Last-minute devis (≤ 30 j) → no deposit on the fiche, single full-payment email + link.
- [ ] Deposit unpaid past deadline → devis abandoned + client email + unpaid page.
- [ ] Balance J-10 email + link; pay → confirmation; overdue J+1 → client email + dashboard cancel → unpaid page.
- [ ] Manual fallback (mark received) still works with polling off.
- [ ] Editing the offsets/deadlines on the Paiements page changes when reminders fire.

## 8. Out of scope

- **In-person Tap to Pay** (deferred to a later project; Qonto covers it at 0.7 % when we do it).
- A **custom payment page on WordPress** (Qonto hosts the checkout).
- Refunds / partial refunds (none on abandonment, per Adrien).
- Real-time **webhooks** (polling chosen; webhooks can be added later if a public endpoint is exposed).
- Multi-currency (EUR only).

## 9. Open questions

**Resolved 2026-06-11 (Adrien):**
- Deposit link expiry = **deposit due date + 1 day** (configurable). • Polling **twice a day**. •
  Scheduling via a template **`anchor`** + configurable offsets in the Paiements page. • All amounts
  (deposit / balance / full) **always from the engine**, including the last-minute case. • Last-minute
  window **30 days** (engine drops the deposit, full payment in one link, like iCal). • Deposit gets
  the **same reminder + abandonment** flow as the balance; an unpaid deposit **abandons the devis**. •
  The **client is emailed** on every missed-deadline / abandonment (deposit and balance). • All
  reminder/deadline values **configurable** in the dedicated Paiements settings page.

**Resolved 2026-06-11 (round 2):**
- **All durations are configurable** on the Paiements page (deposit/balance reminders, abandonment
  offsets, link expiries, last-minute threshold, full-payment due offset) — nothing hard-coded, read
  via `settingsModel.paymentTimings()`. • **Q7** — the last-minute full-payment due date is a
  configurable offset before arrival (`paymentFullPaymentDueDaysBefore`, default **J-7**).

**Still open (for setup / implementation):**
- **Q4 — Qonto auth:** confirm the OAuth2 authorization-code flow (vs a simpler API key) and whether
  the one-time payment-links provider connection needs KYC; both go in the setup procedure (deliverable 4).
- **Q6 — complement:** model the `payment_links` `complement` type now (table + endpoint), expose the
  button later with the Tap-to-Pay project. Confirm that's fine.
- **Q8 — last-minute deposit scope:** the engine auto-drops the deposit for last-minute stays; the host
  can still re-enable it per-reservation via the existing `depositDisabled` toggle (auto-default, not
  forced). Confirm that's the intended behavior.
