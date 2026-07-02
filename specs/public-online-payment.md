# Public online full-payment booking (website use case 2)

| Field | Value |
|---|---|
| **Status** | Implemented + **hardened 2026-07-02** (audit follow-up): per-devis capability token on `pay`/`status` (anti-enumeration), exactly-once confirmation under concurrency (`markPaid().flipped` gate), stale-link amount re-check, dedicated `/status` throttle, `trust proxy` off by default, numeric-id guard, fallback-tax fix. **Pending sandbox verification** of the Qonto webhook signature scheme + the payment-link return URL (§9 Q1/Q4); the poll fallback already confirms bookings regardless. |
| **Branch** | `feature/public-online-payment` _(user-managed)_ |
| **Created** | 2026-06-30 |
| **Author** | Adrien |
| **Related** | [online-payments-qonto.md](online-payments-qonto.md) (Qonto links + poll + confirmation email), [public-api.md](public-api.md) (the `/public/v1` surface), [site-booking-notifications.md](site-booking-notifications.md) |

---

## 1. Context

GuestFlow already exposes a **public API** (`/public/v1`, shared-API-key, consumed **server-to-server by
the WordPress proxy** — never the browser). The site can already build a price quote (`POST /quote`) and
submit a **booking request** (`POST /booking-requests`) which creates a **draft devis**
(`requestOrigin='public'`, engine pricing, availability/capacity/min-nights re-checked, client
resolve-or-create, admin notified). Today that devis is **pending** — a human converts it.

The other online-payment work (use case 1) built: Qonto links, the paid-link **poll** (convert devis on
a paid **deposit**, mark paid), and the **`reservation_confirmation`** email sent on a confirming payment.

## 2. Goal

Let a website visitor **pay their full stay online** and have the reservation confirmed automatically:

> The guest picks dates + options on the site → sees a recap → is sent to the **Qonto payment page** to
> pay the **full stay total** → on success lands on the site **success page** showing a summary. In the
> back, a successful payment **blocks the dates** (devis → reservation) and sends the guest the
> **confirmation email** (amount + dates + options).

**No email step** (unlike use case 1's deposit flow). **Full payment**, not a deposit.

## 3. Functional rules

1. **The site owns the UI** (recap + success page). GuestFlow stays **API-only**: it exposes (a) a way to
   create the full-payment link for a public devis, (b) a status endpoint the site polls. _(decided
   2026-06-30)_
2. **Create the payment link.** After a booking request exists (its devis id + `publicToken`), the site
   calls `POST /public/v1/booking-requests/:id/pay` with `{ token }`. The server:
   - loads the devis; rejects unless it is `requestOrigin='public'`, `kind='devis'`, not converted, not
     already paid (`404`/`409`), **and the per-devis `publicToken` matches** (constant-time; a bad id or
     wrong/missing token is indistinguishable from `404` so the sequential id can't be enumerated — see
     rule 7).
   - **re-checks availability** for the dates (same engine/blocked-dates check as booking-request); if
     the dates are no longer free → `409 DATES_UNAVAILABLE` (we can still reject here — nothing paid yet).
   - resolves the full amount via `utils/devisQuote.fullPaymentCents` = **the amounts the guest agreed to
     on the quote**: the **stored** devis `finalPrice` (accommodation + the options/resources THEY chose)
     **+ the stored `touristTaxTotal`**, EXCEPT when the tourist tax is `collectedOnArrival` → then
     `finalPrice` only. Never the client; never a fresh engine recompute (a recompute can drift — e.g.
     the engine auto-adds a "Linge de lit" option the public quote never showed — which would over-charge;
     the engine is re-run ONLY to read the `collectedOnArrival` boolean). _(Decision 2026-06-30: the
     online full payment collects the taxe de séjour unless it's perceived on arrival. Anti-drift fix
     2026-06-30 after a live sandbox test charged 803,60 € instead of the quoted 789,60 €.)_
   - creates a Qonto **`full`** payment link, persisted in `payment_links` (`reservationId = devis id`,
     `type='full'`); reuses the current open `full` link **only if it still bills the current amount** —
     if the devis was edited between two `pay` calls the stored amount drifts, so the stale link is
     retired (`cancelled`) and a fresh one minted at the correct amount (else the guest would pay the old
     total while the stay is booked as fully paid at the new one). _(hardening 2026-07-02)_
   - sets the Qonto **return URL** to the site success page (built from a **configured site origin** +
     a `returnPath` from the body — allowlisted to the configured origin to prevent open redirects).
   - returns `{ paymentUrl, amountCents, status:'open' }`.
3. **Guest pays on Qonto.** On success Qonto redirects to the site success URL (see §9 Open Q — verify
   Qonto supports a return URL; fall back to "no redirect, site polls" if not).
4. **Confirmation is pushed by a Qonto webhook (primary), reconciled by the poll (fallback).** _(decided
   2026-06-30)_ Qonto notifies the backend the instant a payment succeeds via
   **`POST /api/payments/qonto/webhook`** (public, **signature-verified** — see §3bis). The handler runs
   the **same per-link effect** as the poll. The existing **poll** (cron + on-demand from the status
   endpoint) stays as a **reconciliation fallback** so a missed/late webhook still confirms the booking.
   Both funnel through one idempotent `processPaidLink` (a `paid` link is never processed twice). The
   idempotency is anchored on `paymentLinksModel.markPaid`, whose `UPDATE … WHERE status='open'` is
   atomic and reports whether **this** caller flipped the link; `processPaidLink` runs the effect +
   confirmation email **only** for the caller that flipped it, so when the webhook, the on-demand
   `/status` poll and the cron observe the same paid link at once the guest still gets **exactly one**
   confirmation email and the admin **one** conflict alert. _(hardening 2026-07-02 — previously the
   `flipped` result was ignored, allowing a duplicate email under that race.)_
   A paid **`full`** link on a **devis** now **converts it to a reservation** (was: only `deposit`
   converted), marks it **fully paid** (`depositPaid=1` + `balancePaid=1`, dates = today), and sends the
   **`reservation_confirmation`** email. Dates are blocked **only on successful payment** (the devis never
   blocked them).
5. **Overbooking at payment (decided 2026-06-30).** Because dates aren't held until payment, they can be
   taken between the booking request and a successful payment. The guest **already paid**, so we **convert
   anyway**, set a **conflict flag** on the reservation, and **notify the admin** (manual resolution:
   refund / relocate). We never reject a successful payment.
6. **Status endpoint.** `GET /public/v1/booking-requests/:id/status?token=…` returns a minimal, non-PII
   payload the site polls from its success page. Like `pay`, it **requires the per-devis `publicToken`**
   (the success page echoes it from the return URL) and is throttled by a dedicated
   `paymentStatusLimiter` (tighter than the broad public limiter — see rule 7). Statuses:
   - `pending` — link open, not yet paid.
   - `paid` — a paid payment exists but conversion hasn't run yet (between payment and the poll).
   - `confirmed` — devis converted → reservation; returns `reservationId` + a small recap (property name,
     dates, `finalPrice`).
   - `conflict` — confirmed but flagged over-booked (the site still shows success; admin handles it).
   To make `paid`/`confirmed` near-real-time (not wait for the 15-min cron), the status endpoint triggers
   an **on-demand poll of that devis's open link** before answering (bounded, best-effort).
7. **Security.** All three routes sit under `/public/v1` → shared API-key + `publicApiLimiter`; the `pay`
   write adds the stricter `bookingRequestLimiter`. Amounts are engine-side; the return URL is allowlisted;
   no PII beyond the booking the proxy already submitted is returned. Additional hardening _(2026-07-02
   security audit)_:
   - **Per-devis capability token.** The devis id is a sequential `INTEGER PRIMARY KEY` — guessable, and it
     reaches the browser via the proxy. So each public devis carries an unguessable `publicToken`
     (~192-bit, `crypto.randomBytes`), minted at booking-request creation, returned to the proxy, and
     **required + constant-time compared** on both `pay` and `status`. Without it a visitor could iterate
     ids to read other bookings' recaps or mint their payment links. A bad id / wrong token → `404`
     (indistinguishable from "not found"). Non-numeric / non-positive id → `404` before any DB bind (no
     `500`). `utils/publicDevisToken.js` (`generateToken` / `tokensMatch`).
   - **`/status` throttle.** `status` is a GET that also drives external Qonto calls + a devis→reservation
     conversion when the link is paid, so it gets its own `paymentStatusLimiter` (default 120 / 5 min /
     IP) — enough for a legit success page (polls every 3 s for ~1 min) but caps a Qonto-quota / cost DoS.
     Resolves §9 Q3.
   - **`trust proxy`.** The Node app is exposed **directly** (its own TLS, no reverse proxy today), so
     `trust proxy` defaults to **`false`** — otherwise any direct caller to `:4000` could spoof
     `X-Forwarded-For` and defeat the IP rate limiters. When a reverse proxy is put in front (WordPress
     prod), set `TRUST_PROXY_HOPS` to the exact trusted-hop count. _(The plugin's API client does not
     forward the visitor IP, so public-route limiting is per-proxy-IP regardless.)_
   - **Charged amount.** `fullPaymentCents`'s fallback row now carries `touristTaxTotal`, so a missed devis
     lookup can never silently charge tax-free.

### 3bis. Qonto webhook (primary confirmation signal)

8. **Endpoint.** `POST /api/payments/qonto/webhook` — **public** (Qonto calls it server-to-server; it
   bypasses the session guard like the OAuth callback) but **authenticated by signature**, not by our
   session/API key.
9. **Signature verification (scheme confirmed from docs.qonto.com, 2026-06-30).** Header
   **`X-Qonto-Signature`** = `t={unix_ts},v1={hex_hmac}`. The signed payload is `{t}.{raw_body}`,
   HMAC-SHA256 keyed by the **webhook secret**; the handler recomputes it on the **raw request body**
   (a raw-body capture feeds the HMAC) and constant-time-compares the hex. A delivery older than
   **5 minutes** is rejected (replay guard). Bad/absent/stale signature → `401`, nothing processed. The
   secret lives in **`.env.local` as `QONTO_WEBHOOK_SECRET`** (app-level, like the client secret /
   `PUBLIC_API_KEY`); unset → **fails closed** (`503`). Header name overridable via
   `QONTO_WEBHOOK_SIGNATURE_HEADER`.
10. **Effect.** The `v1/payment-links` webhook emits **`payment_links.created` / `payment_links.updated`**
    (no dedicated "paid" event); the id is at **`data.payment_link_id`**. On any delivery we resolve the
    local link by its Qonto id and run `processPaidLink` (mark paid → `applyPaidEffect` → confirmation
    email → conflict check/notify) — the same code path as the poll. **Idempotent**: a replay or a poll
    that already handled the link is a no-op. Always answer `200` once verified (Qonto retries on
    non-2xx); unknown/again-paid links still return `200`.
11. **Defence in depth.** The webhook never trusts amounts or status text blindly — it re-reads the
    link's authoritative paid state via `getPaymentLinkPayments` before applying the effect (same as the
    poll), so a forged-but-unsigned call can't confirm a booking even if the signature scheme changes.

## 4. Architecture

### 4.1 Server (`server/src/`)

| Layer | File | Responsibility |
|---|---|---|
| `routes/public/` | `bookingRequests.js` | `POST /:id/pay` (bookingRequestLimiter) + `GET /:id/status` (**`paymentStatusLimiter`**). Both token-gated. |
| `controllers/public/` | `publicPaymentController.js` _(new)_ | `pay` (validate devis state **+ token** → availability re-check → engine amount → create/reuse `full` link with return URL → `{ paymentUrl, amountCents }`) + `status` (**token-gated** on-demand poll → map link/devis state → `pending|paid|confirmed|conflict`). `loadPublicDevis(id, token)` guards numeric id + constant-time token. Reuses `paymentRequestService.ensurePaymentLink` + `processPaidLink`. |
| `controllers/public/` | `publicBookingRequestController.js` | **Change:** mint the per-devis `publicToken` at create (same write as `requestOrigin='public'`) + return it in the create response. |
| `utils/` | `publicDevisToken.js` _(new)_ | `generateToken()` (~192-bit base64url) + `tokensMatch(stored, provided)` (constant-time, never throws). |
| `utils/` | `paymentRequestService.js` | **Change:** reuse an open link only if `amountCents` still matches (else retire it `cancelled` + create fresh); select `touristTaxTotal` onto the row so the amount resolver never loses the tax on the fallback. |
| `middleware/` | `rateLimiters.js` | **Add** `paymentStatusLimiter` (default 120 / 5 min / IP) for `GET /status`. |
| `index.js` | `index.js` | **Change:** `trust proxy` = `TRUST_PROXY_HOPS` if set, else **`false`** (direct-exposure default; no XFF spoofing). |
| `utils/` | `paymentPollRunner.js` | **Change:** extract a reusable **`processPaidLink({ link, ... })`** (mark paid → effect → confirmation → conflict) shared by the poll **and** the webhook. **Gates on `markPaid().flipped`** so only the caller that actually flips open→paid runs the effect + email (exactly-once under the webhook/poll/cron race). `applyPaidEffect` — a paid **`full`** link on a **`kind='devis'`** row now **converts** it (like `deposit`) + marks it fully paid; on conversion, **availability re-check** → set `bookingConflictAt` + return a `conflict` marker. |
| `controllers/` | `qontoWebhookController.js` _(new)_ | Verify the Qonto signature (HMAC over raw body, constant-time) → resolve the link by Qonto id → `processPaidLink` (re-reads paid state via `getPaymentLinkPayments`) → `200`. Idempotent; bad signature → `401`. |
| `routes/` | `payments.js` | Add `POST /qonto/webhook` (raw-body parser for that route only; **no** session guard). |
| `middleware/` | raw-body capture | Capture the raw bytes for the webhook route so the HMAC matches Qonto's signature (the global JSON parser would discard them). |
| _env_ | `.env.local` → `QONTO_WEBHOOK_SECRET` | App-level webhook secret (like the Qonto client secret / `PUBLIC_API_KEY`); read by the webhook controller. No DB column. |
| `utils/` | `qontoClient.js` | **Change:** `createPaymentLink` accepts an optional `redirectUrl` and includes it in the Qonto payload (field name per §9). |
| `models/` | `devisModel.js` | Reuse `convertToReservation`; add a guarded read for the public status (by id + origin). |
| `models/` | `reservationsModel.js` | Reuse availability/conflict helpers (the iCal anti-overbooking check) for the conversion-time re-check. |
| `utils/` | `notificationService.js` | **Add** `notifyBookingConflict(reservationId)` — admin email when a paid online booking lands on now-unavailable dates. |
| `database.js` | `database.js` | Migrations: `reservations.bookingConflictAt TEXT` (conflict flag) + **`reservations.publicToken TEXT`** (per-devis capability token). Both nullable, idempotent `ADD COLUMN`. |
| `controllers/` | `paymentsController.js` | Wire `notifyBookingConflict` into the poll deps (admin path), mirroring `sendConfirmation`. |

### 4.2 Client (`client/src/`)

**None for the public flow** (the website owns it). Internal admin (**in scope, decided 2026-06-30**): a
**warning chip** « Conflit de dates — paiement en ligne » on a reservation that carries
`bookingConflictAt`, shown on the reservation fiche **and** the calendar, reusing the existing
reservation status-chip pattern. Responsive per the existing chip rules. **Vitest** coverage for the chip
(renders when `bookingConflictAt` is set, absent otherwise) — required, to lock against regression.

### 4.3 API contract (`/public/v1`)

| Method | Endpoint | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/booking-requests/:id/pay` | `{ token: string, returnPath?: string }` | `{ data: { paymentUrl, amountCents, currency, status } }` | Creates/reuses the `full` link. **`token` required** (per-devis capability). `409` if dates no longer free / already paid; `404` unknown / non-public devis / bad-or-missing token. |
| GET | `/booking-requests/:id/status?token=…` | — | `{ data: { status, reservationId?, propertyName?, startDate?, endDate?, finalPrice? } }` | `status ∈ pending\|paid\|confirmed\|conflict`. **`token` required**; `404` on mismatch. `paymentStatusLimiter`. On-demand poll before answering. |

`POST /booking-requests` is unchanged except its response now also returns **`publicToken`** (the site
calls it first to get the devis id **+ token**, then echoes the token to `pay`/`status`).

**Internal API (not `/public/v1`):**

| Method | Endpoint | Auth | Response | Notes |
|---|---|---|---|---|
| POST | `/api/payments/qonto/webhook` | Qonto **HMAC signature** (no session) | `200` (always, once verified) | `payment_links.*` push → re-read paid state → `processPaidLink`. Bad/absent/stale signature → `401`. Idempotent. |
| POST | `/api/payments/qonto/webhook/register` | admin session | `{ ok, id, callbackUrl }` | One-shot: `POST /v2/webhook_subscriptions` (`callback_url` = publicUrl + the webhook path, `types:['v1/payment-links']`, `secret`=`QONTO_WEBHOOK_SECRET`). Needs the OAuth **`webhook`** scope. Button on the Paiements page. |

## 5. Data model

- **`reservations.bookingConflictAt TEXT`** (nullable) — timestamp set when a paid online payment was
  converted onto dates that had become unavailable. Drives the admin notification + badge. Idempotent
  migration in `database.js`.
- **`reservations.publicToken TEXT`** (nullable) — per-devis capability token minted at booking-request
  creation; required (constant-time) on the public `pay`/`status` routes. NULL on non-public rows.
  Idempotent migration in `database.js`.
- The webhook secret is **not** a DB column — it lives in `.env.local` as `QONTO_WEBHOOK_SECRET`.
- No new table; reuses `payment_links` (`type='full'`) + the devis row.

## 6. UI / UX

- **Public:** none in GuestFlow (site-side). The site shows the recap, redirects to Qonto, then a success
  page polling the status endpoint; it renders the recap returned by `confirmed`.
- **Admin (internal):** a reservation with `bookingConflictAt` shows a warning chip
  (« Conflit de dates — paiement en ligne ») on the reservation fiche / calendar, plus the existing admin
  email. Mobile: the chip follows the existing responsive status-chip rules.

## 7. Test plan

### Server unit tests
- `paymentPollRunner` — a paid **`full`** link on a **devis** converts it + marks fully paid + returns a
  confirming effect (so the confirmation email fires); a paid `full` on a **reservation** still just marks
  paid. Availability conflict at conversion → `bookingConflictAt` set + conflict effect surfaced.
- `publicPaymentController.pay` — non-public/converted/paid devis rejected; dates-unavailable → 409;
  engine amount used; reuse of an open `full` link; return URL allowlisted (rejects a foreign origin).
- `publicPaymentController.status` — maps link/devis state to `pending|paid|confirmed|conflict`; no PII
  leak (only the whitelisted fields).
- `qontoClient.createPaymentLink` — includes the redirect URL in the payload when provided; omits it
  otherwise.
- `notificationService.notifyBookingConflict` — builds the admin email; best-effort (never throws).
- **Webhook** (`qontoWebhookController`) — valid signature → `processPaidLink` runs + `200`; bad/absent
  signature → `401`, nothing processed; replayed event / already-paid link → `200` no-op (idempotent);
  unknown link id → `200` no-op. `processPaidLink` re-reads paid state via `getPaymentLinkPayments`
  before applying the effect.
- **Hardening (2026-07-02):**
  - `publicDevisToken` — `generateToken` is url-safe / long / unique; `tokensMatch` is true only on an
    exact non-empty match and rejects empty / missing / non-string / different-length inputs (no throw).
  - `paymentPollRunner` — **concurrent `processPaidLink` on the same paid link** converts once, sends
    **one** confirmation email and **one** conflict notify (the second caller no-ops on `flipped=false`).
  - `paymentRequestService` — an open link whose amount **drifted** is `cancelled` + a fresh link minted
    at the current amount (not reused).
  - `devisQuote` — the fallback row **still carries the tourist tax** (no silent tax-free undercharge).
  - `publicBookingRequestController` — a `publicToken` is minted, persisted, and returned to the proxy.

### Client tests (Vitest) — required
- The reservation **conflict chip** renders when `bookingConflictAt` is set and is absent otherwise
  (fiche + calendar). Locks the badge against regression.

### Manual verification (sandbox)
- Full public flow on Qonto **sandbox**: booking-request → `pay` → Qonto test card → return URL →
  status flips `pending → paid → confirmed`; devis converted, dates blocked, confirmation email rendered.
- Force an overbooking (block the dates after the link is created) → pay → `confirmed` **conflict**, admin
  notified, reservation flagged.

## 7bis. Website side (WordPress plugin)

The visitor flow is implemented in the in-repo **WordPress plugin** (`integrations/wordpress/`, v1.3.0,
see [wordpress-plugin.md](wordpress-plugin.md) §3 rule 6b): the `guestflow/booking` block gains a
`payOnline` option that, after the booking request, calls the plugin proxy
`POST /booking-requests/:id/pay` → redirects the visitor to the Qonto page → on return polls
`GET /booking-requests/:id/status` and shows the stay recap. The plugin proxies to this spec's
`/public/v1` endpoints with the API key server-side; no business logic on the WordPress side.

**Capability token threading (2026-07-02).** The create response returns `publicToken`; the block
captures it, sends it in the `pay` body **and** embeds it in the Qonto return URL
(`?gf_payment=<id>&gf_token=<token>`), so the success page reads it back and passes it as `?token=` to
the status poll. The proxy (`class-gf-rest-proxy.php`) forwards `token` from the `pay` body and the
`status` query to `/public/v1`. Without the token the routes answer `404`.

## 8. Out of scope

- Hand-coding a bespoke website outside the plugin (the plugin IS the website integration).
- Deposit/partial online payment from the site (use case 2 is **full** only).
- Caution card imprint (separate Mollie-direct project).
- Auto-refund on conflict (manual admin resolution only).

## 9. Open questions

1. **Qonto return URL** — confirm the payment-link API accepts a redirect/success URL and the exact field
   name (sandbox check). If unsupported → ship "status polled only" (the site provides its own return
   link); the rest of the flow is unchanged.
2. ~~Admin conflict badge~~ — **Resolved 2026-06-30: in scope** (chip on the reservation fiche + calendar).
3. ~~On-demand poll cost~~ — **Resolved 2026-07-02:** `GET /status` now has a dedicated
   `paymentStatusLimiter` (default 120 / 5 min / IP) capping the external Qonto calls it drives; the fast
   paths (already confirmed / no open link) short-circuit before any Qonto call. A finer per-link
   min-interval cache was considered unnecessary given the limiter.
4. ~~Qonto webhook support + signature scheme~~ — **VERIFIED LIVE 2026-06-30 (sandbox + webhook.site).**
   Registered a `v1/payment-links` subscription via `POST /v2/webhook_subscriptions` (OAuth scope
   **`webhook`**, secret supplied by us) pointing at a webhook.site URL, created a payment link, and
   Qonto delivered a signed `POST` with header **`X-Qonto-Signature: t={ts},v1={hex_hmac}`** over
   `{ts}.{body}`. **Our `verifySignature` accepts the real signature with the correct secret and rejects
   a wrong one; `extractPaymentLinkId` read the real `data.payment_link_id`.** The scheme + code are
   confirmed on the real Qonto environment.
   - **Prerequisite captured:** the OAuth **app must have the `webhook` scope enabled** (Developer Portal
     → app scopes) and the connection re-consented — done for the **sandbox** app; the **prod** app will
     need the same one-time scope enable + re-consent (and possibly Qonto validation, like `payment_link`).
   - **Remaining for true prod end-to-end:** register the subscription against the public Pi URL
     (`https://<public-host>/api/payments/qonto/webhook`) with `QONTO_WEBHOOK_SECRET`, and confirm Qonto
     can reach it over TLS (self-signed cert may need fronting). The « Enregistrer le webhook » button
     does the registration. The **poll fallback confirms bookings** regardless.
5. **Return URL field** — confirm `createPaymentLink`'s `redirect_url` is the field Qonto honours for the
   post-payment redirect (sandbox); set `PUBLIC_SITE_ORIGIN`.
