# Neat cancellation insurance — automatic subscription at deposit payment

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/neat-insurance-subscription` _(Claude-managed)_ |
| **Created** | 2026-09-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

[cancellation-insurance.md](cancellation-insurance.md) shipped the « Assurance annulation » as a
guest-side option: priced per night in Réglages → Options, offered with a mandatory Oui / Non choice
in the WordPress funnel, billed like any other extra. Its §8 explicitly left « any real insurer » out
of scope.

The real insurer exists: the guarantee sold on the site is **Neat**'s cancellation insurance (the
funnel already links Neat's notice PDF, see `gf-seo-reservation.php`). Today the loop is manual —
when a guest takes the insurance, someone must subscribe the policy on the Neat side by hand, or the
guest is billed for a coverage that does not exist. That step is easy to forget and impossible to
audit.

Neat exposes a partner API ([docs.neat.eu](https://docs.neat.eu/docs/guide-dint%C3%A9gration-par-api))
that covers the whole need:

| Capability | Endpoint |
|---|---|
| Auth (service account) | `POST /service-accounts/auth` → Bearer token (7-day sliding expiry) |
| Discovery | stores → sales channels (payment methods) → contracts (with their `serviceFields` schema) |
| Pricing | `POST /pricings/{contractId}/price` → `{ amount }` |
| Subscribe | `POST /contracts/{id}/subscriptions` — customers, `serviceFieldValues`, `totalAmount`, `paymentContext`, **`externalId`** |
| Lookup | `GET` subscription by id / reference / **external id** |
| Void | cancel a subscription |
| Environments | `https://api.neat.eu` (production) and `https://api.staging.neat.eu` (staging) |

A contract's `serviceFields` (the stay data Neat wants: dates, amount, guests…) are **defined per
contract on the Neat side** — their ids and required flags are only knowable through the API, so the
integration must discover them and let the operator bind each one to a GuestFlow value instead of
hardcoding a payload shape.

What exists in GuestFlow and is reused:

- The flagged insurance option (`options.isCancellationInsurance`) and its billed line on the
  reservation — the single source of « this stay is insured ».
- `reservations.depositPaid` (+ `balancePaid` for single-payment schedules) — the money milestones,
  written by the fiche, the arrival SAS and the Qonto payment poll.
- `settingsModel`'s `ENCRYPTED_COLUMNS` (AES-256-GCM at rest) for operator secrets.
- `scheduledTasks.js` tick-based passes and `utils/pushService.js` for operator notifications.
- The clients table: `firstName`, `lastName`, `email`, `phone`, `streetNumber`, `street`,
  `postalCode`, `city`.

**Arbitrages taken with Adrien on 2026-09-05** (questionnaire):

| Subject | Decision |
|---|---|
| Neat access | Adrien has a Neat partner account but **no API service account yet** — the integration ships fully testable against staging; credentials are entered in Réglages when Neat provides them. |
| Trigger | **When the deposit (acompte) is recorded as paid** — not at booking request, not at devis→reservation conversion. |
| Scope | **Every direct reservation** carrying the insurance line — from the website funnel or added by hand on the fiche/devis. |
| Failure mode | **Never blocks** the reservation flow: queued with automatic retries + operator push notification until subscribed. |

**Amendment 2026-09-05 (Adrien, questionnaire)** — guest pricing follows Neat:

| Subject | Decision |
|---|---|
| Guest price | **Neat premium + margin %**, rounded **up to the whole euro**: `ceil(premium × (1 + marginPercent/100))`. The margin (`neatMarginPercent`) is set in the Neat Réglages card, expressed as « marge ajoutée en % ». When unset, pricing behaves exactly as before (static tariff from Réglages → Options). |
| Fallback | When Neat cannot price at display time: last known cached premium for the same stay parameters (stale allowed) → otherwise the static option tariff. The funnel never breaks and the insurance stays sellable. |

## 2. Goal

When a guest has taken the cancellation insurance and their deposit is paid, the policy is
subscribed at Neat automatically — Adrien configures the connection once in Réglages, then never
touches Neat again for a normal booking, and is alerted whenever a subscription could not go
through.

## 3. Functional rules

### 3.1 Connection & configuration (Réglages)

1. A new Réglages section « Assurance annulation (Neat) » holds: **environment** (`production` |
   `staging`, default `staging` until Adrien flips it), **clientId**, **clientSecret**. The secret is
   encrypted at rest (`ENCRYPTED_COLUMNS`) and never returned to the client (masked to a boolean).
2. « Tester la connexion » authenticates against the selected environment and reports success or the
   exact Neat error. No credentials, or a failed auth → the whole feature is **off** (rule 12).
3. **Discovery is server-driven.** Once authenticated, the server lists the service account's stores
   → sales channels → contracts, and the operator picks: the **sales channel**, the **contract**
   (the cancellation-insurance product), and the **payment method** among the channel's
   `paymentMethods` (expected: the merchant-collected / cash-like method — GuestFlow bills the guest,
   Neat bills the establishment; a channel offering only card methods is surfaced as a blocking
   configuration error, not worked around).
4. **Field mapping.** The chosen contract's `serviceFields` are displayed and each **required** field
   must be bound to a GuestFlow source from a fixed catalogue: stay start date, stay end date, number
   of nights, number of guests (adults + children), accommodation amount, insurance line amount,
   total stay amount, property name, reservation reference, or a constant typed by the operator.
   The mapping is stored as JSON; configuration is **incomplete** while any required field is
   unmapped, and an incomplete configuration keeps the feature off (rule 12). Types are enforced
   (`datetime` sources only on datetime fields, numbers on number fields, dropdown values picked
   from the contract's own options).
5. **Customer payload** is fixed (not mapped): the reservation's client as Neat's `customers[0]` —
   `firstName`, `lastName`, `email`, `phone`, and the postal address when present. Fields GuestFlow
   does not hold (birthdate, birthplace…) are omitted; if the real contract rejects their absence,
   that is the open question §9-Q2, not a silent failure — the Neat 400 lands in the job's
   `lastError` and the operator is notified like any other failure.
6. The Réglages card shows a status summary: environment, connection ok/ko, chosen channel/contract
   labels, mapping completeness, and the counts of pending / failed subscriptions.

### 3.2 Trigger & queue

7. **Trigger = insured + deposit paid.** A subscription job exists for every **direct** (non-platform,
   non-cancelled) reservation that (a) carries the flagged insurance option line — **including an
   « offert » line**: a free premium still insures the guest — and (b) has its stay money engaged:
   `depositPaid = 1`, or, for a schedule without an acompte, its single/balance payment recorded
   (`balancePaid = 1`).
8. **Detection is a state scan, not a write hook.** A scheduled pass (every 5 min) scans for
   reservations matching rule 7 with no `neat_subscriptions` row and enqueues them. This makes the
   trigger robust to every way a deposit becomes paid (fiche edit, arrival SAS, Qonto poll) and
   covers an insurance line added *after* the deposit was already paid. The Qonto payment poll and
   the reservation save path also kick the pass immediately so the normal case subscribes within
   seconds, not minutes.
9. **Subscribing a job** runs, against the configured environment: (a) idempotency lookup — `GET`
   subscription by `externalId` (`guestflow-<reservationId>`, plus a `staging-` prefix outside
   production); an existing live subscription is adopted, not duplicated; (b) `POST /price` with the
   mapped `serviceFieldValues` → Neat's premium; (c) `POST /contracts/{id}/subscriptions` with the
   same fields, the customer block, `totalAmount` = the priced amount, the configured payment
   method, and the `externalId`. Success stores the Neat subscription id + the Neat premium and sets
   the job `active`.
10. **Retries with backoff.** A failed attempt schedules the next one at 1 min, 5 min, 30 min, 2 h,
    then every 6 h. A Neat **400 validation error** is retried on the same schedule too (the fix is
    an operator action — mapping or data — and the retry picks it up), but is labelled « à corriger »
    rather than « Neat indisponible » in the UI. Attempts, `lastError` and `nextAttemptAt` are
    stored.
11. **Operator alerting.** The first failure of a job sends a push notification to admins
    (« Souscription Neat en échec — <client>, <dates> »), repeated at most once per 24 h while
    failures persist. The Réglages card (rule 6) and the fiche chip (rule 15) carry the same truth.
12. **Feature off = no queue.** With no/invalid credentials or an incomplete mapping, the scan pass
    does not enqueue and existing pending jobs are left untouched (no failure spam); the Réglages
    card says why. Nothing anywhere blocks reservations, payments or the funnel.
13. **Guest price = Neat premium + margin, rounded up to the euro** (2026-09-05). When the feature
    is configured **and** `neatMarginPercent` is set, the insurance line's unit price becomes
    `ceil(neatPremium × (1 + marginPercent/100))` in whole euros — the premium being Neat's own
    `POST /price` answer for this stay's mapped fields. The margin follows Neat's tariff changes
    automatically. Sub-rules:
    - **Resolution happens at the request boundary** (public catalog/quote/booking, admin fiche
      quote), asynchronously, and is handed to the pricing engine as a pre-resolved unit-price
      override — the engine itself stays pure and synchronous, and remains the single source of
      truth for the line (`quantity` still clamped to 1, price lock, « offert », VAT unchanged).
    - **Premiums are cached** (`neat_price_cache`, keyed by environment + contract + a hash of the
      priced fields, 24 h freshness) so the funnel stays fast and quoting does not hammer Neat.
    - **Fallback ladder** when no live answer: fresh cache → stale cache → the static tariff from
      Réglages → Options (today's behavior). Never an error, never a hidden block.
    - **Price lock unchanged:** a sold line stays frozen at its sold amount; the subscription
      worker re-prices the premium at subscription time (`totalAmount` = Neat's amount then) and
      stores both `premiumAmount` and `billedAmount`, so any drift between the frozen guest price
      and the day's premium is visible on the fiche.
    - **Public catalog before dates are picked:** a Neat-priced insurance has no per-stay label, so
      `priceLabel` reads « Tarif calculé pour vos dates de séjour ».

### 3.3 Reservation fiche

14. The insurance card on the fiche gains a **Neat status chip**: « Souscrite » (green, with the Neat
    id and premium), « En attente » (grey), « En échec » (red, tooltip = `lastError`), or nothing
    when the feature is off / the reservation is not insured / the deposit is unpaid yet.
15. A failed job offers « Réessayer maintenant » (re-runs the job immediately). An `active`
    subscription offers « Résilier chez Neat » behind a `ConfirmDialog` — **voiding is always a
    manual act**: a guest cancelling their stay is precisely when the policy must live (the claim),
    so GuestFlow never voids automatically, including when the reservation is cancelled. Voiding
    marks the job `voided` and keeps the history.
16. Removing the insurance line from a reservation whose job is `active` does **not** void anything:
    the fiche shows a warning state (« Ligne assurance retirée — souscription Neat toujours
    active ») until the operator either restores the line or voids (rule 15). A `pending` job whose
    line disappears is simply dropped by the next scan.

**Edge cases:**

- Deposit paid then un-paid (operator correction) → an already `active` subscription stays active
  (money moved, coverage exists; voiding is manual); a `pending` job is dropped by the next scan.
- Reservation cancelled with a `pending` job → job dropped (nothing was subscribed).
- Reservation cancelled with an `active` subscription → nothing automatic (rule 15); the chip stays
  visible on the cancelled fiche.
- Same reservation re-triggering (e.g. deposit re-marked paid) → the `externalId` lookup (rule 9a)
  guarantees at most one live Neat subscription per reservation.
- Environment switched staging → production with staging-era jobs → their `externalId` carries the
  `staging-` prefix and their environment is stored on the job; they are never retried against
  production. The scan re-enqueues eligible reservations as fresh production jobs.
- Neat token expiry mid-pass → one re-auth and one retry inside the same attempt, then normal
  failure handling.
- Contract `serviceFields` changed on the Neat side (a required field appears) → subscriptions start
  failing with Neat's 400; the operator re-opens the mapping UI, which re-fetches the schema and
  flags the unmapped field.
- Platform reservations → never scanned (rule 7), even if an insurance line was added by hand; the
  chip is absent.

---

## 4. Architecture

> **Fat backend, thin frontend — holds.** Discovery, mapping validation, payload construction,
> pricing, retries, idempotency and status derivation are all server-side. The client renders
> settings forms and a status chip, and calls action endpoints.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `neatClient.js` | C | Pure HTTP client for the Neat API (injectable `fetch`): auth + token cache with re-auth-once-on-401, stores / sales channels / contracts discovery, `price`, `subscribe`, `getByExternalId`, `void`. Base URL from the environment setting. Never logs secrets. |
| `utils/` | `neatFieldMapping.js` | C | Pure functions: validate a mapping JSON against a contract's `serviceFields` schema (completeness + type compatibility) and build `serviceFieldValues` from a reservation snapshot (dates, nights, guests, amounts, property, reference, constants). |
| `utils/` | `neatGuestPricing.js` | C | Rule 13: pure `computeGuestPrice(premium, marginPercent)` (euro ceil) + async `resolveInsurancePricing` (Neat price through `neat_price_cache`, fallback ladder). |
| `utils/` | `pricing.js` | T | Optional `cancellationInsurancePriceOverride` input: when present, the flagged insurance line is priced at that unit price (quantity 1) instead of its catalogue tariff. |
| `controllers/public/` | `publicCatalogController.js`, `publicQuoteController.js`, `publicBookingRequestController.js` | T | Resolve the Neat-derived price before invoking the engine (rule 13); catalog label when no dates. |
| `models/` | `neatSubscriptionsModel.js` | C | CRUD on `neat_subscriptions`; `findEligibleWithoutJob()` (the rule-7 scan query); `listDue(now)` for the worker; status counters for Réglages. |
| `models/` | `settingsModel.js` | T | New columns (rule-1 settings + channel/contract/paymentMethod ids + mapping JSON); `neatClientSecretEncrypted` joins `ENCRYPTED_COLUMNS`, masked to a boolean on read. |
| `utils/` | `neatSubscriptionRunner.js` | C | The pass itself (rules 8-11): scan → enqueue/drop → process due jobs (idempotency, price, subscribe, backoff, push throttle). Fully dependency-injected. |
| `controllers/` | `neatController.js` | C | Orchestrates: settings (secret 3-way), test-connection, discovery, selection (labels + contract schema resolved from Neat), mapping save (validated), `runPass()` with a re-entrancy guard, retry-now, void, and the fiche `neat` block. |
| `models/` | `pushSubscriptionsModel.js` | T | `neat` joins `PREF_KEYS` (default ON) — the « Souscriptions Neat » push preference (rule 11). |
| `models/` | `devisModel.js` | T | `computeQuote` repriced through the sync cache wrapper (rule 13) — the booking-request devis bills what the funnel preview announced. |
| `routes/` | `neat.js` | C | Thin admin routes → controller (see §4.3); mounted in `index.js`. |
| `scheduledTasks.js` | `scheduledTasks.js` | T | 5-min tick → `runNeatSubscriptionPass('cron')`; the Qonto payment poll pass kicks it after marking payments. |
| `controllers/` | `reservationsController.js` | T | Includes the Neat status block in the fiche payload; kicks the pass after a save that flips a paid flag. |
| `database.js` | `database.js` | T | Idempotent `CREATE TABLE neat_subscriptions` + settings columns migration. |

**Notes:** no new dependency (Node ≥18 global `fetch`). All Neat calls live in `neatClient.js` only.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `SettingsNeatSection.jsx` | C | « Assurance annulation (Neat) » self-contained card (Google-section family, card-local save): env select, credentials (MaskedTextField), margin %, test button, discovery selects, mapping table, status summary + counters. Mounted in `SettingsPage.jsx`. |
| `components/` | `SettingsPushNotificationsSection.jsx` | T | « Souscriptions Neat » preference row. |
| `components/reservation/` | `OptionRow.jsx` | T | Renders the server-provided Neat status chip + « Réessayer » / « Résilier » actions on the flagged insurance card. No status derivation client-side. |
| `pages/` | `ReservationPage.jsx` | T | Unpacks `res.neat`, owns the two actions (retry, confirmed void) and exposes them on the form context. `mockReservationForm.js` mirrors the new keys. |
| `services/` | `api.js` | T | Passthrough for the new endpoints. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusCard`, `StatusBadge`, `SummaryItem`, `MaskedTextField`, `HelpedTextField`, `ErrorAlert`, `LoadingState`, `ConfirmDialog`, `FormDialog` | The Réglages card follows the Google/Qonto connection-card pattern. |
| **Created (new generic)** | — | None. The mapping table is Neat-specific (contract schema driven). |
| **Specific (kept feature-local)** | Neat mapping rows inside the settings card | Bound to Neat's `serviceFields` shape; no second consumer imaginable. |

### 4.3 API contract (admin, session auth)

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/neat/settings` | — | settings (secret masked) + connection/mapping status + queue counters | Feeds the Réglages card. |
| PUT | `/api/neat/settings` | env, clientId, clientSecret?, channel/contract/paymentMethod ids | updated status | Secret only when re-entered. |
| POST | `/api/neat/test-connection` | — | `{ ok, error? }` | Auth round-trip. |
| GET | `/api/neat/discovery` | — | stores → channels → contracts (+ `serviceFields`, `paymentMethods`) | Live from Neat. |
| PUT | `/api/neat/selection` | salesChannelId, contractId, paymentMethodId | updated status | Labels + the contract's `serviceFields` schema are resolved from Neat server-side and cached (`neatContractFieldsJson`) — never trusted from the client. |
| PUT | `/api/neat/mapping` | mapping JSON | validated status or `422` with per-field error codes | |
| POST | `/api/neat/reservations/:id/retry` | — | job after attempt | Immediate re-run. |
| POST | `/api/neat/reservations/:id/void` | — | job `voided` | Confirmed client-side. |

The fiche payload (`GET /api/reservations/:id`) gains a `neat` block:
`{ status, neatId, premiumAmount, lastError, attemptedAt } | null`. Public API and WordPress plugin:
**unchanged**.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS neat_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL REFERENCES reservations(id),
  -- UNIQUE(reservationId, environment): staging-era jobs stay dead when the environment flips to
  -- production and a fresh production job is enqueued (see the environment-switch edge case).
  environment TEXT NOT NULL,                 -- 'production' | 'staging'
  externalId TEXT NOT NULL,                  -- 'guestflow-<id>' ('staging-guestflow-<id>' on staging)
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | active | failed | voided
  neatSubscriptionId TEXT,
  premiumAmount REAL,                        -- Neat's priced premium
  billedAmount REAL,                         -- the GuestFlow insurance line at subscription time
  attempts INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt TEXT,
  lastError TEXT,
  lastNotifiedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

A second table caches Neat premiums for guest pricing (rule 13):

```sql
CREATE TABLE IF NOT EXISTS neat_price_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  environment TEXT NOT NULL,
  contractId TEXT NOT NULL,
  fieldsHash TEXT NOT NULL,                  -- sha256 of the priced serviceFieldValues
  premium REAL NOT NULL,
  fetchedAt TEXT NOT NULL,
  UNIQUE(environment, contractId, fieldsHash)
);
```

New `app_settings` columns (idempotent ALTERs): `neatEnvironment` (default `'staging'`),
`neatClientId`, `neatClientSecretEncrypted`, `neatStoreId`, `neatSalesChannelId`,
`neatContractId`, `neatPaymentMethodId`, `neatPaymentMethodKind`, `neatFieldMappingJson`,
`neatMarginPercent`, plus cached labels (`neatSalesChannelLabel`, `neatContractLabel`,
`neatPaymentMethodLabel`) for the Réglages summary. `user_push_prefs` gains a `neat` column
(default 1) backing the « Souscriptions Neat » push preference (rule 11).

**Data impact:** none on existing records — one new table, additive settings columns, no backfill.
Pre-existing insured reservations are picked up by the very first scan once the feature is
configured, but the scan only considers reservations whose stay **has not started yet**: an
insurance is never sold nor subscribed once the stay began, mirroring
[cancellation-insurance.md](cancellation-insurance.md) rule 17.

## 6. UI / UX

### 6.1 Réglages — « Assurance annulation (Neat) »

- `StatusCard` in the integrations column, badge: « Non configurée » (grey) / « Connectée —
  staging » (orange) / « Connectée » (green) / « En échec » (red).
- Form: env select (« Environnement : Production / Test (staging) »), « Identifiant client »,
  « Secret client » (`MaskedTextField`), « Tester la connexion ». Then three selects fed by
  `/discovery` (canal de vente, contrat, mode de paiement), the « Marge sur la prime Neat (%) »
  field (helper: « Prix client = prime Neat + X %, arrondi à l'euro supérieur ; vide = tarif
  manuel des Options », rule 13) and the mapping table: one row per contract field — name, badge
  « requis », source select, constant input when « Valeur fixe ».
- Summary lines (`SummaryItem`): canal, contrat, « Champs requis mappés : 4/4 », « Souscriptions :
  2 en attente · 1 en échec ».
- Copy for errors: « Connexion Neat impossible : <message> », « Champ requis non mappé : <name> »,
  « Ce canal ne propose pas de mode de paiement à la charge de l'établissement — contacte Neat. »
- **Responsive:** the mapping table becomes stacked rows on `xs` (label above select, full-width);
  the card follows the existing settings column layout. No horizontal scroll.
- **Sticky action bar:** unchanged — `SettingsPage` keeps its existing `PageActionBar` (global
  Save/Cancel apply to these fields too; the test/discovery buttons live in the card).

### 6.2 Reservation fiche — insurance card

- Chip after the line title: « Neat : souscrite » / « Neat : en attente » / « Neat : en échec »
  (tooltip = motif) / warning « Ligne retirée — souscription active » (rule 16).
- A Neat-priced line shows its derivation beside the amount: « Prime Neat 17,50 € • marge +30 % •
  arrondi €↑ » (rule 13) — the drift between a frozen sold price and the day's premium stays
  readable.
- Actions: « Réessayer maintenant » (failed), « Résilier chez Neat » (active, ConfirmDialog:
  « Résilier la souscription Neat de <client> ? Le client ne sera plus couvert. »).
- **Responsive:** the chip wraps under the title on `xs`; actions are ≥44 px targets.

## 7. Test plan

### Server unit tests (new files, `node --test`)

- [x] `tests/neat-client.unit.test.js` (9) — auth + token reuse, re-auth on 401 once, env base
      URLs, discovery/price/subscribe/void payloads, `getByExternalId` (404 → null), 400 per-field
      detail surfacing (injected fetch stub).
- [x] `tests/neat-field-mapping.unit.test.js` (11) — mapping validation (required coverage, type
      compatibility, dropdown options), payload building from a stay snapshot, customer payload,
      rejection of an unknown source, corrupt-JSON tolerance.
- [x] `tests/neat-subscription-scan.unit.test.js` (9) — rule 7/8: insured + depositPaid enqueued;
      offert line enqueued; single-payment schedule via `depositDisabled`; platform / cancelled /
      stay-started / not-paid / uninsured excluded; Lodgify is direct; insurance added later picked
      up; pending dropped when the line disappears (active kept); feature off → silent no-op;
      staging/production job isolation.
- [x] `tests/neat-subscription-worker.unit.test.js` (9) — rules 9-11: price→subscribe dto,
      `externalId` idempotency (adopts a live subscription, ignores a voided one), backoff ladder
      1 min→6 h + due-date respect, 400 labelled « validation », push on first failure + 24 h
      throttle, success clears the failure state.
- [x] `tests/neat-controller.unit.test.js` (12) — secret masking + 3-way, environment/margin
      validation, mapping `422` shape, selection resolved server-side from Neat, retry/void
      endpoints (409/404/502 paths), fiche `neat` block derivation incl. `line_removed_active`.
- [x] `tests/neat-guest-pricing.unit.test.js` (13) — rule 13: euro-ceil rounding (exact-euro
      premium, 0 % margin, absent margin), cache fresh/live/stale/fallback ladder, sync cache-only
      resolver, engine override stay-wide + sold-line full freeze, reprice wrappers, catalog label.
- [x] Existing suites adapted: `public-cancellation-insurance` / `public-quote-controller` /
      `public-quote-progressive-participants` await the now-async public quote;
      `push-subscriptions-model` covers the `neat` preference. Full server suite: **3921 ✅**.

### Client tests (vitest)

- [x] `components/__tests__/SettingsNeatSection.test.jsx` (7) — badge states, secret 3-way payload,
      test-connection verdicts, mapping rows + « requis » badge, 422 row errors in French,
      load-failure retry.
- [x] `components/reservation/__tests__/ExtrasSection.neat-status.test.jsx` (6) — the four chip
      states + actions wired to the context, premium derivation caption, no leak onto ordinary
      option cards.
- [x] `cd client && npx vitest run` — **1208 tests ✅** (158 files).

### Manual UI verification (2026-09-06, `npm run dev`, worktree copy of the dev DB)

- [x] **Réglages:** the card renders « Non configurée », saves fake credentials (badge →
      « Configuration incomplète », secret masked with « Modifier »), and « Tester la connexion »
      reaches the REAL Neat staging API and surfaces its verdict: « Connexion Neat impossible :
      Neat auth failed (HTTP 404): service_accounts_not_found » — the documented endpoints answer.
      The summary lines + counters read the seeded job (« 1 en échec »).
- [x] **Fiche** (seeded job on a future Lodgify reservation): « Neat : en échec » chip +
      « Réessayer maintenant »; the retry ran a REAL pass against Neat staging (attempts 2 → 3,
      fresh lastError, nextAttemptAt +30 min — the ladder's 3rd step); flipped to `active` → « Neat :
      souscrite » chip, « Prime Neat 17,50 € • marge +30 % • arrondi €↑ » caption, « Résilier chez
      Neat » behind the ConfirmDialog (« Le client ne sera plus couvert. », cancelled); insurance
      line deleted → « Ligne retirée — souscription active » warning state with its guidance.
- [x] **Mobile 390 px:** chip wraps under the title, guidance and button full-width, no horizontal
      scroll (fiche card + Réglages card).
- [x] **Public pricing end-to-end by curl** (`POST /public/v1/quote`): fake-configured Neat +
      unreachable → fallback to the static tariff (8 € × 3 nuits = 24 €) with the per-stay
      `priceLabel`; premium 17,50 € seeded in `neat_price_cache` → preview `amount: 23` and the
      selected line bills 23 € — `ceil(17,50 × 1,30)`, preview === billed (rule 13).
- [x] Regression: fiche save, Qonto-poll wiring and the funnel quote untouched while the feature
      is unconfigured (silent no-op passes in the dev log).
- [ ] **Staging end-to-end (deferred until Adrien has credentials, §9-Q1):** configure for real,
      insure a test reservation, mark the deposit paid, watch the subscription appear on Neat
      staging; then void it.

## 8. Out of scope

- **Claims (sinistres).** Declaring or tracking a claim stays on the Neat side; the API's claim
  endpoints are not integrated.
- **Automatic voiding** — on stay cancellation or insurance-line removal (rule 15/16: manual only).
- **Collecting new guest data** (birthdate…) in the funnel — pending §9-Q2.
- **Platform reservations** and the WordPress plugin (untouched).
- **CSV import integration** (Neat's other integration path) — API only.

## 9. Open questions

(Resolved before moving Status to Approved — Q1 blocks nothing: the build is staging-testable.)

- **Q1 — API credentials.** Adrien asks his Neat contact for a *service account* (clientId /
  clientSecret) with access to the cancellation-insurance contract, ideally on staging first.
  - A: …
- **Q2 — Required customer fields.** Does the real contract require customer data GuestFlow does not
  hold (birthdate, birthplace)? Known only once discovery runs against the real contract. If yes →
  follow-up spec to collect it in the funnel + fiche.
  - A: …
- **Q3 — Tariff alignment.** Should the guest-facing per-night price in Réglages → Options be
  checked against Neat's premium (warning on drift), or is the margin deliberate?
  - A (2026-09-05): resolved by the guest-pricing amendment — the guest price is **derived** from
    Neat's premium (`+ marginPercent`, euro ceil, rule 13), so it follows Neat's tariffs by
    construction. The static Options tariff remains only as the last-resort fallback.
- **Q4 — Payment method.** Confirm with Neat that the sales channel exposes a merchant-collected
  payment method (the establishment is billed, not the guest's card). Rule 3 treats its absence as
  a blocking configuration error.
  - A: …
