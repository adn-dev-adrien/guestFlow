# Plugins — phase 3a: the payment-provider interface, and online payment (Qonto) moves out of the core

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/plugins-phase-3` (from `inte/plugins` after #650) |
| **Created** | 2026-10-01 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — §6 extension points, phasing §12 |
| **Previous phase** | [`specs/plugins-phase-2-hosts.md`](plugins-phase-2-hosts.md) (merged into `inte/plugins`, #650) |
| **Summary for review** | [`docs/specs/2026-10-01-plugins-phase-3a-online-payment.html`](../docs/specs/2026-10-01-plugins-phase-3a-online-payment.html) |

---

## 1. Context

After phase 2, three plugins still live inside the core behind their phase 0 switches: hourly resources,
Neat cancellation insurance and online payment (Qonto). All three touch money: the first two write price
lines, the third collects payments. On 2026-10-01 Adrien split phase 3 into **three chained PRs, one spec
and one mock each** (decision P9): **3a** online payment behind a payment-provider interface (this
spec), **3b** Neat behind a quote post-processor, **3c** hourly resources behind price-line
contributors and a commit contract for contributed SAS steps.

The mapping of online payment (2026-10-01) found the flow already mostly provider-neutral in intent but
Qonto-shaped in code, and three defects in the current behaviour:

1. **The dashboard « Envoyer la demande / Relancer » mints a Qonto link while the plugin is off.**
   `dashboardController.remindPaymentDeadline` calls the payment service directly and
   `paymentDeadlines` always sets `remindType`.
2. **An online payment is not recorded like a manual one.** `paymentPollRunner.applyPaidEffect` flips
   `depositPaid` / `balancePaid` with a raw `UPDATE`: no `captureContribsOnFlip` (the per-line split of
   what the bucket paid, which the accounting reads), no `releaseStayBucket`, no `updatedAt`. The
   manual path (`reservationsController.updatePayment`) does all three inside one transaction.
3. **A link GuestFlow abandons stays payable at Qonto.** Cancelling a stay, and replacing a link whose
   amount went stale, only mark the row `cancelled` locally. `qontoClient.deactivatePaymentLink`
   exists (the control plane uses it) but the instance never calls it. A guest who opens an old email
   can still pay, and nothing notices.

Adrien chose to fix all three in this PR (decision P11).

Other facts the design rests on:

- The only record of a stay payment is the bucket flags and dates on `reservations`
  (`depositPaid`/`depositPaidDate`, `balancePaid`/`balancePaidDate`); there is no payments ledger.
  `payment_links` is the trace of what was asked and paid online.
- The webhook (`/api/payments/qonto/webhook`) and the OAuth callback (`/api/payments/qonto/callback`) are
  URLs registered at Qonto: they cannot move.
- The public `/public/v1/booking-requests/:id/pay|status` endpoints are a contract with the WordPress
  plugin and must answer byte-for-byte the same, including the error code `QONTO_API_ERROR`.
- The control plane (`control-plane/`) requires five Qonto server files by path and imports
  `PaymentsSettingsPage` through `@gf/`. It injects its own settings store; the modules load
  GuestFlow's only when none is passed.
- `publicSiteOrigin` is edited on the Qonto card but is not a Qonto setting: the core builds the CGV URL
  of the emails from it.
- Neat (still core until 3b) is kicked directly from three places of the payment flow.

## 2. Goal

- The core owns the money path of an online payment — asking for an amount, recording what was paid,
  confirming the stay — and talks to **a payment provider** through one small interface.
- Qonto becomes the plugin `online-payment`, the first provider: its client, OAuth, webhook, settings,
  health and poll job live in `server/src/plugins/online-payment/` and
  `client/src/plugins/online-payment/`.
- With the plugin off, nothing online-payment shows or runs: no fiche button, no dashboard reminder, no
  `/api/payments/qonto/*`, no poll.
- A payment received online is recorded exactly like the same payment ticked by hand.
- No link GuestFlow abandons stays payable.
- No contract changes: the Qonto URLs, the WordPress endpoints, the email variables, the existing
  payment links and their history.

## 3. Functional rules

### 3.A The core money path

1. **One core function records a stay payment.** `server/src/utils/stayPaymentRecorder.js`
   `recordStayPayment(db, { reservationId, bucket, paidDate })`, `bucket` ∈ `deposit | balance | full`:
   - one `database.transaction`;
   - for each bucket that flips 0→1 (`full` = deposit, then balance): `captureContribsOnFlip`, the flag
     and its date, `updatedAt`, `releaseStayBucket`;
   - a bucket already paid is left untouched (idempotent);
   - a capture failure throws and rolls everything back.

   `reservationsController.updatePayment` (manual 0→1 flips) and the online path both call it. The
   1→0 un-flip stays where it is: only a human un-ticks a payment.
2. **The paid effect of a link is core and provider-neutral.** `paymentPollRunner.processPaidLink`
   keeps its order:
   - `markPaid` (atomic: only the caller that flips the link continues);
   - devis conversion when a deposit or full link pays a devis;
   - `recordStayPayment`;
   - conflict check;
   - confirmation email and conflict notification.

   A conversion still emits `reservation.created`.
3. **A recorded payment emits `reservation.paid`** `{ reservationId, bucket }`, new on the event bus.
   Until 3b moves Neat, the core recorder also calls `neatController.kickPass('payment')` directly. The
   three direct kicks of today go, because their files move into the plugin.
4. **The payment provider interface.** A plugin declares a provider with
   `ctx.paymentProvider(provider)`:

   | Member | Contract |
   |---|---|
   | `id`, `label` | `'qonto'`, `'Qonto'` |
   | `isReady()` | connected and usable; false = treated as no provider |
   | `createLink({ title, amountCents, items?, expectedTotalCents?, redirectUrl? })` | `{ id, url, status, expiresAt }` |
   | `getPayment(linkId)` | `{ paid, paymentId?, paidAt? }`, the authoritative paid signal |
   | `getLinkStatus(linkId)` | `'open' \| 'expired' \| 'cancelled'` |
   | `cancelLink(linkId)` | resolves once the link can no longer be paid; throws otherwise |
   | `errorCode` | the code a provider error answers with (`'QONTO_API_ERROR'`, kept for WordPress) |

   - At most one provider per instance: a second declaration fails that plugin's registration.
   - `paymentProviders.active()` returns the provider of a live plugin whose `isReady()` is true, or
     `null`.
   - The plugin never writes `reservations` or `payment_links` itself; it hands the core what it
     reads from Qonto.
5. **Without an active provider, every online-payment entry point refuses and hides.**
   - The core endpoints `POST|GET /api/payments/reservations/:id/payment-links`,
     `POST /api/payments/reservations/:id/payment-emails` and `POST /api/payments/poll` stay at their
     URLs and answer **409 `NO_PAYMENT_PROVIDER`** « Aucun moyen de paiement en ligne n’est
     connecté. »
   - The fiche payload carries `onlinePayment: { provider, label } | null`.
   - The dashboard payment rows carry `remindType: null` (defect 1); `POST
     /api/dashboard/payment-deadlines/:id/remind` answers the same 409.
   - The public `pay` / `status` answer the 404 envelope they answer today when the plugin is off.
6. **`payment_links` becomes provider-neutral.**
   - `qontoPaymentLinkId` → `providerLinkId`, `qontoPaymentId` → `providerPaymentId`.
   - A new `provider` column (`'qonto'` for every existing row).
   - The poll and the webhook find a link by `(provider, providerLinkId)`.
   - The rows are core data: they survive uninstall and erase (phase 0 rule 20 already keeps them).

### 3.B No abandoned link stays payable (defect 3)

7. **GuestFlow deactivates every link it abandons.** Two places abandon a link:
   - **cancelling a stay** (`utils/cancelReservation.js`) closes its open links;
   - **`ensurePaymentLink`** retires an open link whose amount no longer matches the record.

   In both, after the local write, the core calls `provider.cancelLink(providerLinkId)`.
   - On success the row is `cancelled`.
   - On failure (provider down, plugin off, error) the row is `cancelled` with `remoteCancelPendingAt`
     set, and the action still succeeds.
8. **A pending deactivation is retried, and a payment on it is caught.** Each poll pass first retries
   `cancelLink` on the rows with `remoteCancelPendingAt`, before polling open links.
   - Success clears the marker.
   - If the provider reports the link **paid** instead, nothing is recorded on the stay. The admin
     gets a push and an email « Paiement reçu sur un lien annulé », with the reservation number and the
     amount, and the row keeps `providerPaymentId` and `paidAt` for the refund. The marker is then
     cleared.
9. **The admin is told when a deactivation failed.**
   - The cancellation answer carries `paymentLinksNotDeactivated: n`. When `n > 0`, the fiche shows a
     warning: « Le lien de paiement n’a pas pu être désactivé chez Qonto. GuestFlow réessaie à chaque
     vérification ; tu peux aussi le désactiver depuis Qonto. »
   - The fiche's payment section lists such a link with the badge « Désactivation en attente ».

### 3.C The plugin `online-payment`

10. **What moves into `server/src/plugins/online-payment/`.**
    - `qonto/`: `qontoClient`, `qontoConfig`, `qontoService`, `qontoAuth`, `qontoHealth`,
      `qontoWebhookSignature`, `qontoWebhookRegistrar`, `httpRetry`, `paymentProviderValidation`.
    - `qontoSettingsController` and `qontoWebhookController`.
    - `provider.js`: the rule 4 adapter over `qontoClient` (`cancelLink` = `deactivatePaymentLink`).
    - `settingsStore.js`: rule 13.

    The isolation walk of phase 1 rule 3 applies: inside the plugin, files require each other and
    `plugins/sdk`, nothing else.
11. **Routes, at their current URLs.**
    - The plugin mounts `/api/payments/qonto/*` (authorize, callback, status, credentials, test,
      bank-accounts, connect-provider, refresh-connection) and `GET|PUT /api/payments/settings`.
    - The OAuth callback keeps its session-guarded browser flow.
    - The core keeps the provider-neutral `/api/payments/reservations/...` and `/api/payments/poll`
      (rule 5).
12. **Webhooks are an SDK feature.**
    - `ctx.webhook(path, handler)` declares a `POST` under `/api/` that bypasses the session, role and
      read-only guards; the plugin authenticates it itself (Qonto: HMAC over `req.rawBody`, 503 when
      no secret, 401 on a bad signature).
    - The guards in `index.js` and `enforceSubscription.js` ask `loader.isWebhook(method, path)`
      instead of naming `/payments/qonto/webhook`.
    - A webhook of an inactive plugin answers the 404 envelope.
    - The handler re-reads the payment at Qonto, then calls the core `processPaidLink`.
13. **Settings.**
    - The 20 `qonto*` columns of `app_settings` are copied once into `plugin_settings` by the plugin
      migration `settings_from_app_settings_v1`.
    - The five encrypted ones are declared secret: access token, refresh token, client secret,
      staging token, webhook secret.
    - `settingsStore.js` implements, over `ctx.settings`, the method names `qontoService` and the
      registrar use today (`qontoTokens`, `storeQontoTokens`, `qontoCredentials`, …).
    - `qontoService` loads that store when no store is passed. The control plane keeps passing its own
      (`qonto_settings`) and is otherwise unchanged.
    - `settingsModel` drops the Qonto methods and columns. The old columns stay in the table, unread;
      erase resets them to their defaults, as accounting does in phase 2.
14. **The poll job** is the plugin's.
    - `ctx.jobs.every({ name: 'payment-poll', intervalMs: tick, bootDelayMs: 110 s })` keeps today's
      cadence (`PAYMENT_POLL_TICK_MINUTES`) and the fair-use rules.
    - It ensures the webhook subscription, then runs the core `runPaymentPoll({ provider })`.
    - The core `scheduledTasks.js` loses its payment block.
15. **`publicSiteOrigin` stays core.** Its field « Adresse du site public » moves from the Qonto card to
    **Paramètres › Conditions générales**, since the CGV URL of the emails is the core reader.
    `qontoConfig` keeps reading it for the return URL of a public payment.
16. **Uninstall.**
    - Deactivating keeps everything.
    - Deactivation is still refused while a link is open (`OPEN_PAYMENT_LINKS`, phase 0).
    - « Effacer aussi ses données » erases the plugin settings and resets the old columns.
    - `payment_links`, the bucket flags and the email log stay: they are payments, not plugin data.

### 3.D Client

17. **The settings page moves.** `PaymentsSettingsPage` and `QontoConnectionCard` move to
    `client/src/plugins/online-payment/`. They contribute the route `/parametres/paiements` and the
    menu entry « Paiements en ligne ». The control plane's `App.jsx` imports the page from its new
    path.
18. **The fiche buttons are core and follow the server.**
    - « Envoyer la demande de paiement » (devis) and « Envoyer la demande de solde » (direct
      reservation with a positive unpaid balance) show when `onlinePayment` is non-null. They no longer
      ask `usePlugin(ONLINE_PAYMENT)`.
    - Their messages name the provider label instead of hard-coding Qonto.
19. **The dashboard card** hides « Envoyer la demande / Relancer » on `remindType: null`, as it already
    does for platform bookings.

### 3.E Existing databases, new customers

20. **Upgrade.**
    - The `payment_links` rename runs in `database.js` (`ALTER TABLE … RENAME COLUMN`, idempotent),
      with `provider` defaulting to `'qonto'`.
    - The settings copy runs at the plugin's first boot.
    - A Solio-like database keeps its connection, webhook subscription and open links. The first poll
      after the upgrade finds them by `(provider, providerLinkId)`.
21. **A new customer** starts with the plugin not installed (phase 0). Installing it and connecting Qonto
    is the only way to reach the fiche buttons and the dashboard reminder.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `utils/` | `stayPaymentRecorder.js` | C | Rule 1: the one transaction that records a paid bucket |
| `utils/` | `paymentProviders.js` | C | Rule 4: the registered provider, `active()` |
| `utils/` | `paymentPollRunner.js` | T | Provider-neutral; calls the recorder; retries pending deactivations (rule 8) |
| `utils/` | `paymentRequestService.js` | T | `createLink` and `cancelLink` from the provider; stale link deactivated (rule 7) |
| `utils/` | `cancelReservation.js` | T | Deactivates open links after the transaction (rule 7) |
| `utils/` | `paymentDeadlines.js` | T | `remindType: null` without an active provider |
| `utils/` | `scheduledTasks.js` | T | Payment block removed |
| `models/` | `paymentLinksModel.js` | T | Neutral columns, `findByProviderLinkId`, `remoteCancelPendingAt` |
| `models/` | `settingsModel.js` | T | Qonto methods and columns removed |
| `controllers/` | `paymentsController.js` | T | Provider from `paymentProviders`; 409 `NO_PAYMENT_PROVIDER` |
| `controllers/` | `reservationsController.js` | T | `updatePayment` uses the recorder; `getById` adds `onlinePayment` |
| `controllers/` | `dashboardController.js` | T | Remind refuses without a provider |
| `controllers/public/` | `publicPaymentController.js` | T | Provider from `paymentProviders`; same contract |
| `routes/` | `payments.js` | T | Keeps the provider-neutral routes only |
| `middleware/` | `enforceSubscription.js` | T | Webhook exemption from the loader |
| `plugins/sdk/` | `createContext.js`, `eventBus.js`, `index.js` | T | `ctx.paymentProvider`, `ctx.webhook`, event `reservation.paid`; Qonto entries leave `CORE_MODULES` |
| `plugins/` | `loader.js` | T | Mounts webhooks; `isWebhook()` |
| `plugins/online-payment/` | `index.js`, `provider.js`, `settingsStore.js`, `migrations.js`, `qonto/*`, controllers, `tests/` | C | Rules 10–16 |
| `plugins/website-booking/` | `routes/bookingRequests.js` | T | Gate on the active provider instead of `requirePlugin('online-payment')` |
| — | `index.js` | T | Guards ask the loader; `/api/payments` mounted without `requirePlugin` |
| — | `database.js`, `schema.sql` | T | Rule 20 migration |

### 4.2 Client side (`client/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `plugins/online-payment/` | `index.js`, `PaymentsSettingsPage.jsx`, `QontoConnectionCard.jsx` | C (moved) | Route and menu contribution (rule 17) |
| `pages/` | `ReservationPage.jsx` | T | Buttons from `onlinePayment`; deactivation warning (rules 9, 18) |
| `pages/settings/` | `TermsSettingsPage.jsx` | T | « Adresse du site public » (rule 15) |
| `components/` | `PaymentDeadlinesAlert.jsx` | — | Already hides on `remindType: null` |
| `constants/` | `plugins.js`, `settingsMenu.js` | T | Route and menu entry leave the core lists |
| `plugins/` | `index.js` | T | Registers the module |

It reuses `PageActionBar`, `StatusBadge` and `ErrorAlert`; no new generic component.

`control-plane/`: `server/src/utils/gf.js` points at the moved files, and `client/src/App.jsx` imports
the moved page. No behaviour change.

### 4.3 API contract

| Endpoint | Change |
|---|---|
| `GET /api/reservations/:id` | + `onlinePayment: { provider, label } \| null` |
| `POST /api/reservations/:id/cancel` | + `paymentLinksNotDeactivated: n` |
| `POST\|GET /api/payments/reservations/:id/payment-links`, `POST …/payment-emails`, `POST /api/payments/poll` | Same URLs; 409 `NO_PAYMENT_PROVIDER` without a provider |
| `GET /api/payments/reservations/:id/payment-links` | Rows carry `provider`, `remoteCancelPending` |
| `POST /api/dashboard/payment-deadlines/:id/remind` | 409 `NO_PAYMENT_PROVIDER` without a provider |
| `/api/payments/qonto/*`, `/api/payments/settings` | Same URLs, mounted by the plugin |
| `/public/v1/booking-requests/:id/pay\|status` | Unchanged |

## 5. Data model

- **`payment_links`** (core):
  - `qontoPaymentLinkId` → `providerLinkId`;
  - `qontoPaymentId` → `providerPaymentId`;
  - `+ provider TEXT NOT NULL DEFAULT 'qonto'`;
  - `+ remoteCancelPendingAt TEXT`;
  - the index moves to `(provider, providerLinkId)`.
- **`plugin_settings`** (`online-payment`): the 20 Qonto keys, five of them secret.
- **`app_settings`**: the 20 `qonto*` columns stay, unread, and reset on erase. `publicSiteOrigin`
  stays core.
- **Migration note** in `changelog.d/migration--plugins-phase-3a-online-payment.md`.

## 6. UI / UX

- **Paramètres › Paiements en ligne:**
  - unchanged, except that « Adresse du site public » leaves it;
  - it disappears with the plugin.
- **Paramètres › Conditions générales:** a field « Adresse du site public », with the help text « Sert à
  construire le lien vers vos conditions générales dans les emails, et le retour après un paiement en
  ligne. »
- **Fiche:**
  - the two buttons follow `onlinePayment`;
  - after a cancellation that could not deactivate a link, a warning alert sits under the action bar
    until the page is left;
  - in the payment links list, the badge « Désactivation en attente ».
- **Tableau de bord:** with no provider, the payment cards keep their amounts and « Reporter », without
  « Envoyer la demande / Relancer ».
- **Mobile:** nothing new in the layout. The warning alert is full width at 375 px; the moved field
  follows the CGV page's column.

## 7. Test plan

### Server — new tests

| File | Covers |
|---|---|
| `stay-payment-recorder.unit.test.js` | Rules 1–3: the deposit, balance and full flips capture the contribs like the manual path (same rows, same cents); idempotent; rollback on capture failure; `reservation.paid` emitted |
| `payment-provider-interface.unit.test.js` | Rules 4–6: one provider max; `active()` null when not live or not ready; 409 `NO_PAYMENT_PROVIDER` on the four endpoints; `remindType: null`; `onlinePayment` on the fiche |
| `payment-link-deactivation.unit.test.js` | Rules 7–9: cancellation and stale-amount replacement call `cancelLink`; a failure sets the marker without failing the action; the poll retries; a paid pending link is not recorded and notifies |
| `plugins/online-payment/tests/phase-3a-online-payment.unit.test.js` | Rules 10–16 and 20: isolation, routes at the same URLs, webhook through the guards (and 404 when off), settings copy and secrets, erase keeps `payment_links`, poll job gated, upgrade rename keeps open links findable |

### Moved and updated tests

- The 29 Qonto/payment suites keep their cases.
  - The Qonto ones move under `plugins/online-payment/tests/`.
  - The neutral ones stay and are updated to the new column names.
- `plugins-phase-0` and `plugins-phase-1-sdk` assert the new gates; the source scan of
  `paymentPollRunner` follows the file.
- The control plane's `qonto-settings` and billing suites run unchanged against the moved files.

### Client (Vitest)

- The fiche buttons follow `onlinePayment`.
- The deactivation warning shows on `paymentLinksNotDeactivated > 0`.
- `TermsSettingsPage` saves `publicSiteOrigin`.
- `QontoConnectionCard` has no origin field any more.
- The plugin registry lists the module.
- The control-plane `PaymentsSettingsPage` import resolves.

### E2E

- The existing suite, unchanged.
- A new spec: without the plugin, the fiche shows no payment button and `/parametres/paiements`
  redirects.

### Manual verification

- **Shadow on :4101**, a copy of the dev database (v3.8, secrets purged):
  - upgrade: links renamed, `provider='qonto'`, settings copied;
  - plugin off: no button, dashboard without « Relancer », 409 on the endpoints;
  - erase, then reinstall.
- **Qonto sandbox, with Adrien's sandbox credentials** (§9):
  - create a link, pay it, and check that the stay's contribs equal a manual tick;
  - cancel a stay with an open link, and check that the link is refused at Qonto;
  - cut the network during a cancellation, then check the marker and the retry.
- **375 px:** CGV page and fiche warning.

## 8. Out of scope

- **Neat** (3b) and **hourly resources** (3c). Neat's kick moves to the `reservation.paid` event in 3b.
- **A second provider.** The interface allows one; none is written.
- **A payments ledger.** Payments stay bucket flags plus `payment_links`.
- **Refunding at Qonto** a payment received on a cancelled link: the admin is told (rule 8) and refunds
  by hand.
- **Downloads:** phase 4.

## 9. Open questions

- **Q1 — Sandbox check of `cancelLink`. Resolved 2026-10-01:** Adrien connects his Qonto sandbox on the shadow instance; the manual verification of §7 runs against it.
