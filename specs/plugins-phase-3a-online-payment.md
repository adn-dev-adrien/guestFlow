# Plugins — phase 3a: the payment-provider interface, and online payment (Qonto) moves out of the core

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugins-phase-3` (from `inte/plugins` after #650) |
| **Created** | 2026-10-01 |
| **Author** | Adrien |
| **Related PR** | [#651](https://github.com/adn-dev-adrien/guestFlow/pull/651) (target `inte/plugins`) |
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
   `recordStayPayment(deps, { reservationId, bucket, paidDate, keepPaymentOnCaptureFailure })`,
   `bucket` ∈ `deposit | balance | full`:
   - one `database.transaction`;
   - for each bucket that flips 0→1 (`full` = deposit, then balance): `captureContribsOnFlip`, the flag
     and its date, `updatedAt`, `releaseStayBucket`;
   - a bucket already paid is left untouched (idempotent);
   - by hand, a capture failure throws and rolls everything back (the fiche answers 409, as before);
   - online (`keepPaymentOnCaptureFailure`), the money is already received: the flag is ticked anyway,
     as it always was, the capture is skipped and the failure logged — a payment the guest made never
     vanishes from the stay.

   `reservationsController.updatePayment` (manual 0→1 flips) and the online path both call it. The
   1→0 un-flip stays where it is: only a human un-ticks a payment. A manual tick writes no history line,
   and neither does an online payment: its trace is the `payment_links` row.
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
   - The public `pay` / `status` answer the 404 envelope they answered while the plugin was off
     (`{ error: 'PLUGIN_INACTIVE', plugin: 'online-payment' }`) when no provider plugin is live. A live
     provider that is not connected still answers, and fails like it always did (502
     `QONTO_API_ERROR`).
6. **`payment_links` becomes provider-neutral.**
   - `qontoPaymentLinkId` → `providerLinkId`, `qontoPaymentId` → `providerPaymentId`.
   - A new `provider` column (`'qonto'` for every existing row).
   - A new `remoteCancelPendingAt` column (rule 8).
   - The poll and the webhook find a link by `(provider, providerLinkId)`.
   - The migration lives in `utils/paymentLinksProviderMigration.js`, called by `database.js`.
   - The rows are core data: they survive uninstall and erase (phase 0 rule 20 already keeps them).

### 3.B No abandoned link stays payable (defect 3)

7. **GuestFlow deactivates every link it abandons.** Two places abandon a link:
   - **cancelling a stay** (`utils/cancelReservation.js`) closes its open links;
   - **`ensurePaymentLink`** retires an open link whose amount no longer matches the record.

   A third place does the same: the public `pay` retires an open link of the other public type when
   the property's payment mode changed between the quote and the payment.

   In all three, after the local write, the core calls `provider.cancelLink(providerLinkId)`
   (`utils/paymentLinkDeactivation.js`).
   - On success the row is `cancelled`.
   - On failure (provider down, plugin off, error) the row is `cancelled` with `remoteCancelPendingAt`
     set, and the action still succeeds.
8. **A pending deactivation is retried, and a payment on it is caught.** Each poll pass (every 8 hours
   by default, rule 14) first reads the payment of each row with `remoteCancelPendingAt`, then retries
   `cancelLink`, before polling open links.
   - Success clears the marker.
   - A failure leaves it for the next pass; a rate limit stops the pass, as for open links.
   - If the provider reports the link **paid** instead, nothing is recorded on the stay. The admin
     gets a push and an email « Paiement reçu sur un lien annulé », with the reservation number and the
     amount, and the row keeps `providerPaymentId` and `paidAt` for the refund. The marker is then
     cleared.
9. **The admin is told when a deactivation failed.**
   - The cancellation answer carries `paymentLinksNotDeactivated: n` and, when `n > 0`,
     `paymentLinksWarning`, worded by the server with the provider's label: « Lien de paiement encore
     actif chez Qonto : à désactiver depuis Qonto. » (shortened 2026-10-04).
   - The fiche closes on a cancellation: the warning follows the « Séjour annulé » message of its
     dialog. The dashboard card shows it in its error toast, after the cancellation's own message (the
     deposit kept, when there is one — it used to be lost).
   - `GET /api/payments/reservations/:id/payment-links` carries `remoteCancelPending` on each row. The
     fiche has no payment-link list today; none is added.

### 3.C The plugin `online-payment`

10. **What moves into `server/src/plugins/online-payment/`.**
    - `qonto/`: `qontoClient`, `qontoConfig`, `qontoService`, `qontoAuth`, `qontoHealth`,
      `qontoWebhookSignature`, `qontoWebhookRegistrar`, `httpRetry`, `paymentProviderValidation`.
    - `qontoSettingsController` and `webhookController` (from `qontoWebhookController`).
    - `paymentPollSchedule.js`: the poll cadence, now the plugin job's.
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
    - The 19 `qonto*` columns of `app_settings` are copied once into `plugin_settings` by the plugin
      migration `settings_from_app_settings_v1`, under the same names, the secrets as their stored
      blobs.
    - The generic `PUT /api/plugins/online-payment/settings` refuses every key: these values come from
      the OAuth flow and the Paiements page only.
    - The five encrypted ones are declared secret: access token, refresh token, client secret,
      staging token, webhook secret.
    - `settingsStore.js` implements, over `ctx.settings`, the method names `qontoService` and the
      registrar use today (`qontoTokens`, `storeQontoTokens`, `qontoCredentials`, …).
    - The store reads `publicUrl` and `publicSiteOrigin` from the core settings of the plugin's own
      database.
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
    - `GET /api/terms` carries `publicSiteOrigin`; `PUT /api/terms/public-site-origin` saves it.
    - The server accepts '' or an http(s) origin without path, query or fragment, and stores it without
      its trailing slash. Anything else: 400 « Adresse invalide : saisis seulement le domaine, par
      exemple https://www.domainesolio.com ».
    - `settingsModel.publicSiteOrigin()` reads it over `PUBLIC_SITE_ORIGIN`; the public payment builds
      its return URL from it, and `qontoConfig` keeps showing it on the Paiements page.
16. **Uninstall.**
    - Deactivating keeps everything.
    - Deactivation is still refused while a link is open (`OPEN_PAYMENT_LINKS`, phase 0).
    - « Effacer aussi ses données » erases the plugin settings and resets the old columns.
    - `payment_links`, the bucket flags and the email log stay: they are payments, not plugin data.

### 3.D Client

17. **The settings page moves.** `PaymentsSettingsPage` and `QontoConnectionCard` move to
    `client/src/plugins/online-payment/`. They contribute the route `/parametres/paiements` and the
    menu entry « Paiements en ligne », placed with `before: '/settings/tva-exercice'` (the menu slot
    learns `before`, to open a family). The control plane's `App.jsx` imports the page from its new
    path.
    - The two files import the core through `plugins/sdk/ui.js`, the SDK's generic components without
      the plugin registry, so the console renders the page without loading the instance's plugins.
    - The card loses its « Origine publique du site » field (rule 15).
18. **The fiche buttons are core and follow the server.**
    - « Envoyer la demande de paiement » (devis) and « Envoyer la demande de solde » (direct
      reservation with a positive unpaid balance) show when `onlinePayment` is non-null. They no longer
      ask `usePlugin(ONLINE_PAYMENT)`. `GET /api/devis/:id` carries `onlinePayment` too.
    - Their messages name the provider label instead of hard-coding Qonto.
19. **The dashboard card** hides « Envoyer la demande / Relancer » on `remindType: null`, as it already
    does for platform bookings.

### 3.E Existing databases, new customers

20. **Upgrade.**
    - The `payment_links` rename runs at boot (`ALTER TABLE … RENAME COLUMN`, idempotent), with
      `provider` defaulting to `'qonto'`.
    - The settings copy runs at the plugin's first boot.
    - A Solio-like database keeps its connection, webhook subscription and open links. The first poll
      after the upgrade finds them by `(provider, providerLinkId)`.
21. **A new customer** starts with the plugin not installed (phase 0). Installing it and connecting Qonto
    is the only way to reach the fiche buttons and the dashboard reminder.

### Review fixes (2026-10-04)

- Rule 7: before an open link whose amount went stale (or the other public type) is retired, its
  payment is read at the provider. Paid → nothing is retired and no new link is made: `409
  LINK_ALREADY_PAID` « Le lien en cours vient d’être payé : aucun nouveau lien créé. » (the poll
  records the payment). Unreadable → `502 PROVIDER_UNREACHABLE`.
- Rule 8: a deactivation the provider refuses because the link is already dead (expired, or
  deactivated in the provider's app) is checked with `getLinkStatus` and counts as done; such a link
  is no longer retried at every pass.
- Rule 16: deactivating or uninstalling `online-payment` is also refused while a link cancelled here
  is still payable at the provider (`LINKS_PENDING_DEACTIVATION`), since only the plugin's poll
  retries it.
- Rule 3: a payment that lands on a stay already cancelled records nothing on it
  (`reservation-cancelled`) and the admin gets the « Paiement reçu sur un lien annulé » notice. An
  online payment is dated by the provider's `paidAt` as a Paris day (it was the UTC day of the
  detection). A contribs capture that fails is written in the stay's history (« Paiement en ligne
  (acompte) : reçu, répartition comptable non enregistrée »), not only in the server log.
- Rule 5: `GET /api/payments/reservations/:id/payment-links` is stored data and answers without a
  provider (it answered 409).
- The provider form starts from this space's public site (`providerDefaults.websiteUrl`), never a
  fixed address.
- Tests: `payment-link-deactivation.unit.test.js` (+2), `stay-payment-recorder.unit.test.js` (+2, history line), `payment-provider-interface.unit.test.js`, `phase-3a-online-payment.unit.test.js` (+1), `PaymentDeadlinesAlert.payment-provider.test.jsx`.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `utils/` | `stayPaymentRecorder.js` | C | Rules 1, 3: the one transaction that records a paid bucket; `reservation.paid` |
| `utils/` | `paymentProviders.js` | C | Rules 4–5: the declared provider, `active()`, `summary()`, `NO_PROVIDER` |
| `utils/` | `paymentLinkDeactivation.js` | C | Rule 7: deactivate abandoned links, mark the ones the provider refused |
| `utils/` | `paymentLinksProviderMigration.js` | C | Rules 6, 20: neutral columns, `provider`, `remoteCancelPendingAt` |
| `utils/` | `paymentPollRunner.js` | T | Provider-neutral; records through the recorder; retries owed deactivations (rule 8) |
| `utils/` | `paymentRequestService.js` | T | Link from `provider.createLink`; stale link deactivated (rule 7) |
| `utils/` | `cancelReservation.js` | T | Returns the links it cancelled |
| `utils/` | `paymentEffectDeps.js` | T | + `notifyPaidAfterCancel` |
| `utils/` | `notificationService.js` | T | + « Paiement reçu sur un lien annulé » (push + email, rule 8) |
| — | `scheduledTasks.js` | T | Payment block removed |
| `models/` | `paymentLinksModel.js` | T | Neutral columns, `findByProviderLinkId`, `cancel`, `listRemoteCancelPending`, `clearRemoteCancelPending` |
| `models/` | `settingsModel.js` | T | Qonto methods and columns removed; `publicSiteOrigin()`, `storePublicSiteOrigin()` |
| `controllers/` | `paymentsController.js` | T | Provider from `paymentProviders`; 409 `NO_PAYMENT_PROVIDER` |
| `controllers/` | `reservationsController.js` | T | `updatePayment` records 0→1 flips through the recorder; `getById` adds `onlinePayment` |
| `controllers/` | `devisController.js` | T | `getOne` adds `onlinePayment` |
| `controllers/` | `reservationCancellationController.js` | T | Deactivates after the commit; `paymentLinksNotDeactivated`, `paymentLinksWarning` |
| `controllers/` | `dashboardController.js` | T | `remindType: null` and 409 without a provider |
| `controllers/` | `termsController.js` | T | `publicSiteOrigin` in the overview; `updatePublicSiteOrigin` (rule 15) |
| `controllers/public/` | `publicPaymentController.js` | T | Provider from `paymentProviders`; `requireProvider`; same contract |
| `routes/` | `payments.js`, `terms.js` | T | Provider-neutral payment routes only; `PUT /terms/public-site-origin` |
| `middleware/` | `enforceSubscription.js` | T | Webhook exemption from the loader (injectable) |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `eventBus.js`, `index.js` | T | `ctx.paymentProvider`, `ctx.webhook`, event `reservation.paid`; `CORE_MODULES` gains the three payment modules the plugin calls |
| `plugins/` | `loader.js`, `index.js` | T | Mounts webhooks, `isWebhook()`; registers the module |
| `plugins/online-payment/` | `index.js`, `provider.js`, `settingsStore.js`, `webhookController.js`, `qontoSettingsController.js`, `paymentPollSchedule.js`, `qonto/*`, `tests/` | C (mostly moved) | Rules 10–16 |
| `plugins/website-booking/` | `routes/bookingRequests.js` | T | Gate on a declared provider |
| — | `index.js` | T | Guards ask the loader; `/api/payments` mounted without `requirePlugin` |
| — | `database.js`, `schema.sql` | T | Rule 20 migration; fresh databases get the neutral table |

### 4.2 Client side (`client/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `plugins/online-payment/` | `index.js`, `PaymentsSettingsPage.jsx`, `QontoConnectionCard.jsx` | C (moved) | Route and menu contribution (rule 17) |
| `plugins/sdk/` | `ui.js` | C | The generic components without the registry (rule 17) |
| `plugins/sdk/` | `index.js` | T | Exports `HelpedTextField` |
| `components/` | `PublicSiteOriginCard.jsx` | C | The address field and its own save (rule 15). Specific: one setting, one page |
| `pages/` | `ReservationPage.jsx` | T | Buttons from `onlinePayment`; cancellation warning (rules 9, 18) |
| `pages/settings/` | `TermsSettingsPage.jsx` | T | Hosts `PublicSiteOriginCard` |
| `components/` | `PaymentDeadlinesAlert.jsx` | T | Cancellation warning (rule 9); already hides on `remindType: null` |
| `constants/` | `plugins.js`, `settingsMenu.js`, `roles.js` | T | Route and menu entry leave the core lists; the menu slot learns `before` |
| — | `api.js` | T | `saveTermsPublicSiteOrigin` |
| — | `App.jsx` | T | The core route goes |

It reuses `PageActionBar`, `StatusBadge`, `HelpedTextField` and `ErrorAlert`.

`control-plane/`: `server/src/utils/gf.js` points at the moved files, and `client/src/App.jsx` imports
the moved page. No behaviour change.

### 4.3 API contract

| Endpoint | Change |
|---|---|
| `GET /api/reservations/:id`, `GET /api/devis/:id` | + `onlinePayment: { provider, label } \| null` |
| `POST /api/reservations/:id/cancel` | + `paymentLinksNotDeactivated: n`, `paymentLinksWarning: string \| null` |
| `POST\|GET /api/payments/reservations/:id/payment-links`, `POST …/payment-emails`, `POST /api/payments/poll` | Same URLs; 409 `NO_PAYMENT_PROVIDER` without a provider |
| `GET /api/payments/reservations/:id/payment-links` | Rows carry `provider`, `providerLinkId`, `providerPaymentId`, `remoteCancelPending` |
| `GET /api/dashboard/payment-deadlines` | `remindType: null` without a provider |
| `POST /api/dashboard/payment-deadlines/:id/remind` | 409 `NO_PAYMENT_PROVIDER` without a provider |
| `GET /api/terms` | + `publicSiteOrigin` |
| `PUT /api/terms/public-site-origin` | New: `{ publicSiteOrigin }` → the overview, or 400 |
| `/api/payments/qonto/*`, `/api/payments/settings` | Same URLs, mounted by the plugin |
| `PUT /api/plugins/online-payment/settings` | 400 on every key |
| `/public/v1/booking-requests/:id/pay\|status` | Unchanged |

## 5. Data model

- **`payment_links`** (core):
  - `qontoPaymentLinkId` → `providerLinkId`;
  - `qontoPaymentId` → `providerPaymentId`;
  - `+ provider TEXT NOT NULL DEFAULT 'qonto'`;
  - `+ remoteCancelPendingAt TEXT`;
  - `+ idx_payment_links_provider (provider, providerLinkId)`.
- **`plugin_settings`** (`online-payment`): the 19 Qonto keys, five of them secret.
- **`app_settings`**: the 19 `qonto*` columns stay, unread, and are emptied on erase. `publicSiteOrigin`
  stays core.
- **Migration note** in `changelog.d/migration--plugins-phase-3a-online-payment.md`.

## 6. UI / UX

- **Paramètres › Paiements en ligne:**
  - unchanged, except that « Origine publique du site » leaves it;
  - it disappears with the plugin, menu entry included.
- **Paramètres › Conditions générales:** a card « Adresse du site public » between the published
  versions and the online-booking card. One field, the help text « Sert à construire le lien vers vos
  conditions générales dans les emails, et le retour après un paiement en ligne. », and its own button
  « Enregistrer l’adresse » (the page bar saves the CGV draft). The server's refusal shows under the
  field.
- **Fiche:**
  - the two buttons follow `onlinePayment`;
  - after a cancellation that could not deactivate a link, the « Séjour annulé » message carries the
    warning.
- **Tableau de bord:**
  - with no provider, the payment cards keep their amounts and « Reporter », without « Envoyer la
    demande / Relancer »;
  - a cancellation with a link not deactivated shows the warning in the error toast.
- **Mobile:** the address card stacks the field over a full-width button at 375 px; nothing else moves.

## 7. Test plan

### Server — new tests (25)

| File | Tests | Covers |
|---|---|---|
| `stay-payment-recorder.unit.test.js` | 5 | Rules 1–3: same rows by hand and online; full; idempotent; failed capture (rollback by hand, kept online); `reservation.paid` |
| `payment-provider-interface.unit.test.js` | 6 | Rules 4–6, 20: missing member; one provider; `active()`; 409 on the endpoints; dashboard; the upgrade migration |
| `payment-link-deactivation.unit.test.js` | 7 | Rules 7–9: deactivated; refused → marked; stale link; retry; paid after cancel; failing retry; admin email |
| `plugins/online-payment/tests/phase-3a-online-payment.unit.test.js` | 7 | Rules 4, 10–16, 21: provider; routes and webhook at their URLs; settings copy and secrets; poll job; erase keeps payments; open-link blocker; a new customer has no provider |

### Moved and updated tests

- The 15 Qonto suites and `payment-provider-validation`, `payment-poll-tick` moved under
  `plugins/online-payment/tests/`, with `qontoSettingsFixture` rebuilt over the plugin store;
  `settings-qonto` now tests the store.
- The neutral suites stay and use the new names and the provider stubs: `payment-links-model`,
  `payment-poll-runner`, `payment-poll-fair-use`, `payment-request-service`, `payment-request-type`.
- `plugins-phase-0`, `plugins-phase-1-sdk`, `subscription-entitlement`, `dashboard-remind-refuses-platform`
  and website-booking's `phase-2-website-booking` assert the new gates, jobs and events.
- The control plane's suites run unchanged against the moved files (87).
- Server total: 4,765.

### Client (Vitest) — new tests (7)

- `PaymentDeadlinesAlert.payment-provider.test.jsx` (2): no « Relancer » on `remindType: null`; the
  cancellation warning.
- `PublicSiteOriginCard.test.jsx` (2): saves; shows the refusal.
- `plugins/online-payment/__tests__/module.test.js` (2): menu entry before « TVA & exercice »; route.
- `QontoConnectionCard.test.jsx` (moved, +1): no address field.
- Client total: 1,499.

### E2E (95: 94 passed, 1 skipped as before)

- `e2e/specs/plugins/online-payment.spec.js` (3): no payment request without a connected provider, and
  409; the page and its menu entry go with the plugin and come back; the address saved with the CGV,
  refused with a path.

### Manual verification

- **Shadow on :4101**, a copy of the dev database (v3.8, secrets purged):
  - upgrade: links renamed, `provider='qonto'`, settings copied;
  - plugin off: no button, dashboard without « Relancer », 409 on the endpoints;
  - erase, then reinstall.
- **Qonto sandbox, with Adrien's sandbox credentials** (Q1):
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
