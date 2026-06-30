# Online payments via Qonto payment links (deposit / balance lifecycle)

| Field | Value |
|---|---|
| **Status** | Phase 2 (deposit happy-path + confirmation email) Implemented — validated on sandbox; balance/reminders/abandonment deferred |
| **Branch** | `feature/qonto-online-payments-phase2` _(user-managed)_ |
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
     - **No last-minute settings here (2026-06-11).** The last-minute case is **not configured on this
       page** — its threshold *and* its full-payment due date both come from the property's existing
       **« solde »** setting (`balanceDaysBefore`) in *Paramètres → logement → Acompte & solde* (§3.7).
       The full-payment reminders/abandonment reuse the balance offsets above.
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

8. **Deposit email (manual trigger from a devis) — implemented.** From a saved devis, the host clicks
   **« Envoyer la demande d'acompte »**: GuestFlow **creates (or reuses) the Qonto deposit link** and
   **emails it to the guest** in one action (no copy-paste, no tab to open). Built from the editable
   `deposit_request` template (FR + EN); contains, in this order:
   - Stay recap: **arrival/departure date + time**, **options** chosen, **resources** booked.
   - The **deposit amount to pay now** (`{{depositAmount}}`) and the **full stay total** (`{{finalPrice}}`).
   - A clear notice: **paying the deposit blocks the dates; until then the dates may be taken by
     another guest.**
   - The **Qonto payment link** for the deposit, injected per-send as `{{paymentLink}}` (the link is
     created on demand, not a reservation column).
   - A **signature** with the **company name** (SMTP `fromName`/`companyName`).
   - Sent to the guest's email; if the client has no email, the action fails with a clear message.
     Like `reservation_confirmation`, `deposit_request` is **action-triggered** — excluded from the
     manual pending queue and the `auto` cron (sent only by the host's explicit action).
   - _Deferred (phase 2 of use case 1):_ automated **deposit reminders** (rule 11) and **abandonment**
     (rule 12); **branded HTML** layout (current emails are plain-text, consistent with the rest of the
     email system). Totals breakdown (tourist tax line) and the balance-due block stay deferred too.
9. **On deposit paid:**
   - **Auto (polling):** the devis is **converted to a reservation**, `depositPaid=true` with
     `depositPaidDate = today`, a **dashboard message** is posted, and a **notification email** is sent
     to the host (GuestFlow user). A **confirmation email** is sent to the **guest** ("acompte reçu,
     séjour confirmé") with the stay recap.
   - **Manual:** the host converts the devis → on conversion, the guest gets the same confirmation
     email.
   - **Confirmation email — implemented.** The guest confirmation is the default template
     `reservation_confirmation` (FR + EN; subject "Confirmation de votre réservation …"; body recaps
     the **stay total** `{{finalPrice}}`, **dates + times**, **options** and **resources**). It is
     **event-triggered** (sent by `utils/reservationEmailSender` from the payment poll the instant a
     paid link confirms the stay — deposit, use case 1; or full payment, use case 2), never
     date-scheduled: it is excluded from the manual pending queue (`emailLogModel.listPending`) and from
     the `auto` cron. The send is **best-effort** — an SMTP error is logged in `email_log` as `failed`
     and never breaks the payment flow. A **balance** payment is a later top-up and does **not** retrigger
     this confirmation. The template is editable like any other on the Emails page.
10. Conversion reuses `devisModel.convertToReservation`; the deposit-paid date is the conversion day.
11. **Deposit reminder — manual, anchored on the devis validity date (implemented 2026-06-29).** While
    a devis is still open (not converted) and its deposit is unpaid, a **`deposit_reminder`** email
    surfaces in the **manual pending queue** (the existing dashboard/EmailPendingDialog flow) — the host
    sends it **by hand**, it is **not** auto-sent. Its scheduling **anchor is the devis `validUntil`
    date** (not the arrival date): it appears `dayOffset` days around `validUntil` (default **J-3**,
    editable on the Emails page). The email reminds the guest the quote expires on `{{validUntil}}`,
    recaps the stay + `{{depositAmount}}`, and re-offers the **existing open deposit payment link**
    (`{{paymentLink}}`, injected read-only at send time; if no open link exists the body falls back to a
    "contactez-nous" line). _Decision (2026-06-29):_ kept manual on the user's explicit request — only
    the template + the validity-date trigger were built; no auto-send cron, no abandonment yet (rule 12
    still deferred).
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

### 3.7 Last-minute booking — full payment, no deposit

18. **Threshold + due date come from the property's « solde » setting (2026-06-11).** There is **no
    separate Paiements config**: a booking is "last-minute" when the stay starts within the property's
    **`balanceDaysBefore`** window (the "solde X jours avant" of *Paramètres → logement → Acompte &
    solde*), and in that case the full payment's due date **is** that same balance due date. When this
    holds, the **pricing engine** drops the deposit (deposit = 0, the full stay total due as a single
    payment) and the **reservation fiche shows no deposit** — exactly the existing iCal no-deposit
    handling (`depositDisabled`). All amounts always come from the engine.
19. **Single full-payment link + flow.** The deposit step is **skipped**: the host sends a single email
    asking for the **full stay total** (one Qonto link), due at the balance date. Reminders / overdue /
    abandonment reuse the **balance** schedule. On paid → devis → reservation, confirmed; on overdue →
    devis abandoned (rule 12 path). No separate balance step.

### 3.8 Email scheduling anchor

20. Deposit/confirmation emails after a payment are **event-driven**. Scheduled reminders are relative
    to a payment **due date**, not the arrival date — so payment templates carry a scheduling
    **anchor** in addition to the existing `startDate` anchor. **Implemented:** `email_templates.anchor`
    (`'start'` default | `'validUntil'`); a `'validUntil'`-anchored template is surfaced by
    `emailLogModel.listPending` against **open, deposit-unpaid devis** (computed `sendDate =
    validUntil + dayOffset`), so the existing manual queue drives *when to propose it* and the host
    decides *when to send*. Future `depositDueDate` / `balanceDueDate` anchors slot into the same column.

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
| `utils/` | `pricing.js` | T | **Last-minute rule (§3.7):** the engine auto-drops the deposit (deposit = 0, full total due) when the stay starts within the property's `balanceDaysBefore` window — same `depositDisabled` path as iCal. All amounts stay engine-owned. Unit-tested. |
| `models/` | `paymentLinksModel.js` | C | CRUD for the new `payment_links` table; `listOpen()`, `markPaid()`, `findForReservation()`. |
| `models/` | `settingsModel.js` | T | New encrypted Qonto columns (client id/secret, OAuth tokens, connection id) **+ payment-timing settings** (deposit/balance reminder offsets, abandonment offsets, link expiry) + `qontoConfigured()` / `decryptedQontoSettings()` / `paymentTimings()`. |
| `models/` | `reservationsModel.js` | T | Occupancy excludes `cancelledUnpaidAt IS NOT NULL`; helpers to mark a reservation released-unpaid and a devis abandoned; list for the unpaid page. |
| `models/` | `devisModel.js` | T | Deposit-paid → `convertToReservation` (deposit date = today); deposit-overdue → mark devis abandoned. |
| `controllers/` | `paymentsController.js` | C | **Done (PR #178 + page PR):** Qonto OAuth `authorize`/`callback`/`status` + Paiements page `getSettings`/`updateSettings` (timings, validated). To come: create+send a link, regenerate, manual mark, cancel-unpaid, connect-provider. |
| `utils/` | `paymentTimingsValidation.js` | C | **Done.** Pure validator for the editable timings (offset arrays + day fields, ranges); used by `updateSettings`. |
| `controllers/` | `dashboardController.js` | T | Surface payment dashboard messages (paid, overdue) + the cancel action. |
| `routes/` | `payments.js` | C | `POST /reservations/:id/payment-links`, `GET …/status`, `POST …/cancel-unpaid`, payment-settings + Qonto OAuth routes. |
| `utils/` | `emailContextBuilder.js` | C | Stay-recap + payment context. **Done:** default `paymentLink`/`hasPaymentLink`; **`validUntil`** (devis validity date, formatted) for the deposit reminder. |
| `controllers/` | `emailsController.js` (link injection) | C | **Done.** `buildPreview` injects the existing **open deposit link** (`paymentLinksModel.findOpenForReservation`, read-only) as `paymentLink`/`hasPaymentLink` for the `deposit_reminder` template, so the manual send carries the link without a Qonto write. `loadReservationGraph` is now **kind-agnostic** (loads devis too) so a devis-targeted reminder can be previewed/sent. |
| `utils/` | `reservationEmailSender.js` | C | **Done.** Event-/action-triggered send of a template by `stableKey` for a reservation (load graph → `buildContext` → merge optional `extraContext` (e.g. `{ paymentLink }`) → `pickTemplateSide` → `renderTemplate` → send → `email_log`). Never throws; `buildConfirmationSender()` currys deps into the `sendConfirmation(reservationId)` passed to `runPaymentPoll`. |
| `utils/` | `paymentPollRunner.js` | C | **Done.** On a paid **deposit**/**full** link that confirms a stay, calls the injected `sendConfirmation` (best-effort) after applying the paid effect; a **balance** payment does not. |
| `utils/` | `defaultEmailTemplatesRegistry.js` + `defaultEmailTemplatesSeed.js` | C | **`reservation_confirmation` + `deposit_request` + `deposit_reminder` done** (FR + EN). The first two are `dayOffset 0` sentinels excluded from queue/cron (shared `EVENT_TRIGGERED_STABLE_KEYS`). **`deposit_reminder`** carries `anchor:'validUntil'` + `dayOffset -3`, `sendMode 'manual'` — it *does* surface in the manual queue (the host sends it). Seed inserts `anchor` defensively (defaults `'start'`). To come: deposit-abandoned (client), full-payment request, balance request/reminder/confirmed, balance-abandoned (client), overdue-internal (host). |
| `models/` | `emailLogModel.js` | C | **Done.** `listPending` is a `UNION ALL`: the **`start`** branch (unchanged — reservations, `startDate + dayOffset`, past-arrival guard) + the **`validUntil`** branch (open deposit-unpaid **devis**, `validUntil + dayOffset`). Both exclude the `EVENT_TRIGGERED_STABLE_KEYS` (NULL-safe) and already-sent/acknowledged pairs. |
| `utils/` | `paymentRequestService.js` | C | **Done.** Injectable core of the payment-request flow: `ensurePaymentLink(deps,id,type)` (validate → reuse/create) + `sendPaymentRequest(deps,id,type)` (link → send template → `{httpStatus,body}` with error→HTTP mapping). Fully unit-tested with stubbed deps (no Qonto network). |
| `controllers/` | `paymentsController.js` (deposit email) | C | **Done — now a thin wrapper** over `paymentRequestService`: `requestServiceDeps()` wires the module deps (`createLink` via `withAccessToken`, `sendTemplate` via `reservationEmailSender`); handlers relay `{httpStatus,body}`. **Bugfix:** `sendReservationTemplateEmail` was never imported (latent `ReferenceError` → 502 on every deposit-request email) — caught by the new service tests. |
| `utils/` | `emailAutoSendRunner.js` | T | Support the **`depositDueDate` / `balanceDueDate` anchors** + the configurable offsets (alongside the existing `startDate` anchor). |
| `scheduledTasks.js` | `scheduledTasks.js` | T | New **payment polling pass** (twice/day; detect paid links → trigger flows) + drive the deposit/balance reminder + abandonment passes off the configured offsets. |
| `database.js` | `database.js` | C | Migrations: create `payment_links`; Qonto + payment-timing settings columns (**done**); **`email_templates.anchor TEXT NOT NULL DEFAULT 'start'` (done)**. To come: `reservations.cancelledUnpaidAt`. |

**Notes:** routes thin; Qonto calls isolated in `qontoClient` (mockable). Secrets via `encryption.js`.
Polling + reminder passes reuse the scheduler's in-progress-guard pattern (like `emailAutoSendInProgress`).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `ReservationPage.js` (devis mode) | C | **« Envoyer la demande d'acompte » done:** the action now **emails** the deposit link to the guest (calls `POST …/payment-emails`), no longer opens a tab; success dialog names the recipient + keeps a **« Vérifier le paiement »** action (manual poll). "…de solde" / "…du règlement total" still to come. |
| `pages/` | `PaymentsSettingsPage.js` | C | **Done:** dedicated **Paiements** page at `/parametres/paiements` (settings submenu) — Qonto connection `StatusCard` + "Connecter Qonto" button, the **provider-connection form** (bank-account picker + phone/site/≥80-char description → `connect-provider`; `pending` → redirect to the onboarding/KYC URL, return on `?provider=callback` → `refresh-connection`), and editable timings via `PageActionBar`. Route registered in `roles.js` (`ADMIN`). |
| `pages/` | `UnpaidReservationsPage.js` | C | Dedicated list of abandoned devis + released reservations (uses `DataPageScaffold`/`TableCard`). |
| `components/` | dashboard notification items | T | Payment-paid + balance-overdue messages; the overdue one has a **Cancel** button. |
| `services/` | `api.js` | T | New payment endpoints. |

**Component reuse declaration:** consumes existing `StatusCard`, `PageActionBar`, `DataPageScaffold`,
`FormDialog`, `ConfirmDialog`; no new generic component anticipated (the unpaid page is a standard
list). Email rendering stays server-side.

### 4.3 API contract (initial sketch)

| Method | Endpoint | Body | Response | Status |
|---|---|---|---|---|
| GET | `/api/payments/qonto/authorize` | — | 302 → Qonto consent (state in session) | **Done** |
| GET | `/api/payments/qonto/callback` | `?code&state` | 302 → `/parametres/paiements?qonto=connected\|error\|invalid_state` | **Done** |
| GET | `/api/payments/qonto/status` | — | `{ connected, connectionStatus, configured, sandbox, connectedAt }` | **Done** |
| GET | `/api/payments/settings` | — | `{ timings, qonto }` | **Done** |
| PUT | `/api/payments/settings` | partial timings (`{ depositReminderOffsets:[…], lastMinuteDays, … }`) | `{ timings }` (400 `VALIDATION_FAILED` on bad input) | **Done** |
| GET | `/api/payments/qonto/bank-accounts` | — | `{ bankAccounts: [{ id, name, iban, main }] }` | **Done** |
| POST | `/api/payments/qonto/connect-provider` | `{ bankAccountId, phone, websiteUrl, businessDescription }` | `{ connectionStatus, connectionLocation? }` (`connectionLocation` = onboarding URL when `pending`) | **Done** |
| GET | `/api/payments/qonto/refresh-connection` | — | `{ connectionStatus }` (re-checks via `GET /v2/payment_links/connections`) | **Done** |
| POST | `/api/reservations/:id/payment-links` | `{ type: 'deposit'|'balance'|'full'|'complement' }` | `{ url, status, amountCents, qontoPaymentLinkId }` (creates/reuses a link, **no email** — used by the site flow, use case 2) | **Done** |
| GET | `/api/reservations/:id/payment-links` | — | `{ links: [...] }` | **Done** |
| POST | `/api/reservations/:id/payment-emails` | `{ type: 'deposit' }` | `{ sent, url, amountCents, emailLogId, recipientEmail }` (creates/reuses the link **and** emails the matching `<type>_request` template to the guest) | **Done** |
| POST | `/api/payments/poll` | — | `{ checked, paid, results }` (manual poll-now) | **Done** |
| POST | `/api/reservations/:id/cancel-unpaid` | — | `{ ok }` (archive + free dates) | To come |

---

## 5. Data model

**New table `payment_links`:**
`id, reservationId, type ('deposit'|'balance'|'complement'), qontoPaymentLinkId, url, amountCents,
currency DEFAULT 'EUR', status ('open'|'paid'|'expired'|'cancelled'), qontoPaymentId, createdAt,
paidAt, expiresAt`. Index on `(status)` and `(reservationId)`.

**`email_templates` new column:** `anchor TEXT NOT NULL DEFAULT 'start'` (`'start'` | `'validUntil'`) —
the scheduling anchor `listPending` uses to compute a template's send date. `'start'` (default for every
existing row) keeps the historical `startDate + dayOffset` behaviour; `'validUntil'` anchors on the
devis validity date and targets open deposit-unpaid devis (the `deposit_reminder`). Idempotent migration
in `database.js`.

**`app_settings` new columns:**
- Encrypted Qonto: `qontoClientIdEncrypted`, `qontoClientSecretEncrypted`, `qontoAccessTokenEncrypted`,
  `qontoRefreshTokenEncrypted`, `qontoConnectionId`, `qontoConnectedAt`.
- Payment timings (all editable on the Paiements page; defaults from Adrien, none hard-coded):
  `paymentDepositReminderOffsets` (JSON, default `[-5, 0]`), `paymentDepositAbandonOffset` (`1`),
  `paymentDepositLinkExpiryDays` (`1`), `paymentBalanceReminderOffsets` (JSON, default `[-10, -5, 0]`),
  `paymentBalanceAbandonOffset` (`1`), `paymentBalanceLinkExpiryDays` (`1`). All read through a single
  `settingsModel.paymentTimings()` that applies the defaults, so the rest of the code never hard-codes
  a duration. **No `paymentLastMinuteDays` / `paymentFullPaymentDueDaysBefore`** — the last-minute
  threshold + due date come from the property's `balanceDaysBefore` (§3.7). _(PR #178 created those two
  columns; they are now unused — orphan, harmless — on DBs that already ran that migration.)_

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
- [x] Polling pass — open link paid → marks paid + converts devis + posts dashboard msg + queues
      emails; already-paid link skipped; API error doesn't throw. _(payment-poll-runner unit tests)_
- [x] **Confirmation email** — a paid **deposit**/**full** link triggers `sendConfirmation` with the
      confirmed reservation id; a **balance** payment does not; a throwing sender never breaks the poll.
      `reservationEmailSender` renders + sends the `reservation_confirmation` template and logs `sent`,
      logs `failed` on SMTP error, and skips when the client has no email.
      _(payment-poll-runner + reservation-email-sender unit tests)_
- [x] **Deposit-request email** — `reservationEmailSender` injects `extraContext.paymentLink` and the
      rendered `deposit_request` body contains the link + the deposit amount; `EVENT_TRIGGERED_STABLE_KEYS`
      keeps both `deposit_request` and `reservation_confirmation` out of `listPending`.
      _(reservation-email-sender + email-log-model unit tests)_
- [x] **Payment-request service** — `ensurePaymentLink` (create vs reuse-open, invalid type → 400,
      unknown reservation → 404, zero amount → 400) + `sendPaymentRequest` (happy path → 200, unsupported
      type, no-email → 400, unknown failure → 502, validation throw bubbles). _(payment-request-service unit tests)_
- [x] **Deposit reminder (manual, `validUntil` anchor)** — a `validUntil`-anchored `deposit_reminder`
      surfaces in `listPending` for an open, deposit-unpaid devis at `validUntil + dayOffset`; a
      **converted** devis and a **deposit-paid** one are excluded; the `start` branch behaviour is
      unchanged. `emailsController.buildPreview` injects the open deposit link as `{{paymentLink}}`
      (and `hasPaymentLink`), empty when there is no open link. _(email-log-model + emails-controller unit tests)_
- [ ] Reminder/abandonment scheduling — deposit (J-5/J-day, abandon J+1) off `depositDueDate` and
      balance (J-10/J-5/J-day, abandon J+1) off `balanceDueDate`, all from the **configured offsets**;
      paid → later reminders suppressed.
- [ ] Deposit overdue → **devis marked abandoned** (`cancelledUnpaidAt` set) + client/host emails queued.
- [ ] Occupancy excludes `cancelledUnpaidAt` rows (devis abandoned + reservations released).
- [ ] Email context — deposit/balance/full recap + amounts + link + signature/logo present.

### Manual verification
- [x] End-to-end on a Qonto **test/sandbox**: deposit link → pay → polling converts devis. _(confirmation
      email send requires SMTP configured; the conversion + send wiring is unit-tested.)_
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
  (deposit / balance / full) **always from the engine**, including the last-minute case. • Deposit gets
  the **same reminder + abandonment** flow as the balance; an unpaid deposit **abandons the devis**. •
  The **client is emailed** on every missed-deadline / abandonment (deposit and balance). • The
  deposit/balance reminder/deadline values are **configurable** in the dedicated Paiements settings page.

**Resolved 2026-06-11 (round 2):**
- The **deposit/balance** reminder/deadline durations are configurable on the Paiements page — read via
  `settingsModel.paymentTimings()`, nothing hard-coded.
- **Q7 superseded (round 3):** the last-minute case is **not** configured on the Paiements page. Its
  threshold *and* its full-payment due date both come from the property's existing **`balanceDaysBefore`**
  ("solde") setting (§3.7). The two columns `paymentLastMinuteDays` / `paymentFullPaymentDueDaysBefore`
  were dropped from the model/page/validator.

**Resolved 2026-06-29 (validated against the sandbox):**
- **Q4 — Qonto auth → OAuth2 (authorization-code).** A first attempt used the simpler **API key**, but the
  `/v2/payment_links/*` endpoints **reject it** (`401 "OAuth2 authentication is required here"`) — the API
  key only works for read endpoints like `bank_accounts`. So **OAuth2 is mandatory** for payment links.
  The provider connection needs a one-time **Mollie onboarding/KYC** (self-serve in sandbox; the canonical
  test org « Abacate » comes already `enabled`). **Production caveat:** an OAuth app with the
  `payment_link` scope requires **Qonto validation** before go-live (PSD2). Setup recipe in §10.
- **Paid-detection model (confirmed in sandbox):** a link's top-level `status` goes `open → processing`
  when a guest pays and **does not** become `paid`; the authoritative paid signal is a payment with
  `status: "paid"` on **`GET /v2/payment_links/{id}/payments`** (as §3.3 prescribed). The poll runner
  uses that sub-resource.

**Still open (for setup / implementation):**
- **Q6 — complement:** model the `payment_links` `complement` type now (table + endpoint), expose the
  button later with the Tap-to-Pay project. Confirm that's fine.
- **Q8 — last-minute deposit scope:** the engine auto-drops the deposit for last-minute stays; the host
  can still re-enable it per-reservation via the existing `depositDisabled` toggle (auto-default, not
  forced). Confirm that's the intended behavior.

## 10. Setup + manual end-to-end test — sandbox (deliverable 4)

**Phase 2 status (2026-06-29):** the deposit happy-path is implemented and **validated end-to-end on the
Qonto sandbox** (link created → paid with a Mollie test card → poll detected → devis converted +
deposit flagged). Server: `POST /api/payments/reservations/:id/payment-links`,
`GET …/payment-links`, `POST /api/payments/poll` + `utils/paymentPollRunner` (twice-a-day cron in
`scheduledTasks` + the manual poll). Client: devis action **« Envoyer la demande d'acompte »** →
opens the Qonto link → **« Vérifier le paiement »** polls + (on paid) lands on the new reservation.

### A. Connect Qonto (OAuth, sandbox) — once
1. **Developer Portal** (developers.qonto.com) → app **Settings → Redirection URIs**: add
   `http://localhost:3000/api/payments/qonto/callback` (localhost is accepted). Scopes:
   `offline_access organization.read payment_link.read payment_link.write`.
2. `server/.env.local`: `QONTO_ENV=sandbox`, `QONTO_CLIENT_ID`, `QONTO_CLIENT_SECRET`,
   `QONTO_STAGING_TOKEN`, `QONTO_REDIRECT_URI=http://localhost:3000/api/payments/qonto/callback`.
   (Leave `QONTO_API_LOGIN`/`QONTO_API_SECRET_KEY` unset/commented — api-key mode can't do payment links.)
3. **Log in to the Sandbox web app** `https://sandbox.staging.qonto.co` first (test creds on the
   Developer-Portal Overview) — otherwise the OAuth flow dead-ends on the portal.
4. GuestFlow → **Paramètres → Paiements → « Connecter Qonto »** → pick an org (« Abacate Organization »
   has the provider already `enabled`) → **Accepter**. `qonto/status` → `connected:true, authMode:oauth`.

### B. Manual end-to-end payment test
1. Create a **devis** with a non-zero deposit (or open an existing draft devis).
2. On the devis, click **« Envoyer la demande d'acompte »** → a Qonto payment page opens in a new tab
   (amount = the devis deposit).
3. Pay with a **Mollie test card**: `4543 4740 0224 9996`, any future expiry (e.g. `12/30`), any CVC
   (e.g. `123`), any name. → you land on the **Mollie test-mode** page → choose status **« Payé »** →
   **Continuez**.
4. Back in GuestFlow, click **« Vérifier le paiement »** (or wait for the cron). Expected:
   - the link's payment is detected `paid` (via `…/payments`), the devis is **converted to a
     reservation** (dates blocked), and the reservation's **deposit is flagged paid**;
   - GuestFlow navigates to the new reservation.
5. `POST /api/payments/poll` returns e.g. `{ checked, paid:1, results:[{ status:'paid', effect:'converted', reservationId }] }`.

> Test-mode notes: the Qonto link stays `processing` (never `paid`) — detection is on the payments
> sub-resource. Amounts ≥ €1001 in Mollie test mode trigger forced failures; use a small amount.
