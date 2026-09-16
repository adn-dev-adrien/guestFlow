# Payment polling — fair use of the provider API

| Field | Value |
|---|---|
| **Status** | Implemented (approved by delegation 2026-09-15) |
| **Branch** | `feature/payment-polling-fair-use` |
| **Created** | 2026-09-07 |
| **Author** | Adrien |
| **Related PR** | [#557](https://github.com/adn-dev-adrien/guestFlow/pull/557) — server suite 4100 pass / 0 fail (4082 before, +18) |

---

## 1. Context

Mollie's 2026 User Agreement — in force on 7 September 2026 for new customers and **7 October 2026 for
existing ones** — introduces an explicit **Article 4.6 « Politique d'utilisation équitable »** covering
the *Limites de taux* (Rate Limits) that apply to the use of the Payment Module, the option to request a
temporary increase, and the measures Mollie may take in case of abusive use or fraud risk. The full text
of that article was not yet published on `mollie.com/legal` on 2026-09-07 (the page still served the
previous version plus the `v10` archive), so only Mollie's own summary of it is on record here.

GuestFlow never calls the Mollie API. [`utils/qontoClient.js`](../server/src/utils/qontoClient.js) talks
to the **Qonto Business API** (`thirdparty.qonto.com`) for payment links; Mollie is the PSP behind the
hosted payment page, which is why connecting the provider required a Mollie onboarding/KYC
(`specs/online-payments-qonto.md` §4.1). The quota that actually binds our calls is therefore Qonto's —
**10 000 requests / 10 minutes per IP**, `429` beyond — and our current volume is orders of magnitude
below it. **We are not in breach of anything today.** This spec is not a compliance fix; it removes
waste that grows on its own and adds the back-off behaviour both providers ask for, before volume makes
either one matter.

Three facts from the audit of 2026-09-07:

- **Dead links are polled forever.**
  [`paymentLinksModel.listOpen()`](../server/src/models/paymentLinksModel.js) returns *every* row with
  `status = 'open'`, unbounded, and the 15-minute cron in
  [`scheduledTasks.js`](../server/src/scheduledTasks.js) spends **two Qonto calls on each of them, every
  pass, indefinitely**. `expiresAt` is written at creation
  ([`paymentRequestService.js`](../server/src/utils/paymentRequestService.js)) but never read back. On
  the dev database, two links created on 2026-08-19 were past their `expiresAt` and still `open` on
  2026-09-07 — roughly 1 800 passes × 2 calls ≈ **3 600 pointless requests**, with no end condition.
  Every abandoned devis adds one link to that loop.
- **A rate-limit response makes us speed up.**
  `readBody` throws on any non-2xx; `runPaymentPoll` catches per link and immediately issues the next
  link's request. A `429` is therefore answered with a burst, and `Retry-After` is ignored — the exact
  opposite of what Mollie's documentation ("adding an exponentially increasing delay between each
  attempt") and Qonto's rate-limit page ask for.
- **The second call per link is nearly always redundant.** `getPaymentLink` exists only to catch
  `expired` / `cancelled`; for a link whose expiry date is already in our record, it tells us nothing we
  do not know.

The webhook (`specs/public-online-payment.md` §3bis) is already the primary paid signal. The cron poll
is a reconciliation safety net, and a safety net does not need to run at full speed forever.

## 2. Goal

GuestFlow stops spending provider requests on payment links that can no longer be paid, slows down on
the ones that are merely old, and backs off when the provider says to — without ever losing or
double-processing a payment.

---

## 3. Functional rules

1. At the start of a poll pass, an `open` link whose stored `expiresAt` is in the past is retired
   locally to `expired` **without any provider call**.
2. `markPaid` flips a link from `open` **or** `expired`, so a payment confirmed after a local
   retirement is still processed exactly once; `paid` and `cancelled` stay final and still report
   `flipped: false`.
3. An `open` link is polled at a cadence that decays with its age: every pass under 24 h, at most once
   per hour from 24 h to 7 days, at most once per day beyond 7 days. A link not due is skipped with no
   provider call.
4. Every provider call made for a link stamps `lastPolledAt` on it, and the cadence of rule 3 is
   computed from that stamp — so a server restart never resets a link to the fastest tier.
5. `getPaymentLink` (the link-status call) is issued only when the payments call reported no payment
   **and** the link has no known `expiresAt`. When the expiry is known, rule 1 already retires the link
   and the second call buys nothing.
6. A provider response of `429` or `5xx` is retried with exponential back-off — 3 attempts at most,
   the first request included (so at most 2 retries), base delay 1 s doubling each time — honouring a
   `Retry-After` header when present (the longer of the header and the computed delay wins; both the
   delta-seconds and the HTTP-date forms are read), each wait capped at 60 s. A `4xx` other than `429`
   is not retried, and neither is a network error that carries no HTTP status.
7. A `429` that survives rule 6's retries **aborts the whole poll pass**. The links not yet examined
   are left to the next pass rather than requested immediately, and the pass reports why it stopped.
8. `POST /v2/payment_links` carries an `X-Qonto-Idempotency-Key` (UUID v4 — Qonto's documented header
   name, see §9) generated once per creation call and reused across that call's rule-6 retries only —
   never afterwards — so a creation answered by a `5xx` cannot produce two links for one request.
9. The cadence thresholds of rule 3 and the retry budget of rule 6 are environment-configurable, with
   the values stated above as defaults. A missing, non-numeric or non-positive value falls back to
   the default:

   | Variable | Default | Meaning |
   |---|---|---|
   | `PAYMENT_POLL_FRESH_HOURS` | `24` | Age under which a link is due every pass |
   | `PAYMENT_POLL_WARM_DAYS` | `7` | Age under which the hourly tier applies |
   | `PAYMENT_POLL_WARM_INTERVAL_MINUTES` | `60` | Minimum gap between two checks in the warm tier |
   | `PAYMENT_POLL_COLD_INTERVAL_MINUTES` | `1440` | Minimum gap between two checks beyond the warm tier |
   | `QONTO_RETRY_MAX_ATTEMPTS` | `3` | Requests per call, the first one included |
   | `QONTO_RETRY_BASE_DELAY_MS` | `1000` | First back-off delay, doubled on each retry |
   | `QONTO_RETRY_MAX_DELAY_MS` | `60000` | Cap on any single wait |
10. An explicit human request bypasses the cadence: the operator's « Relancer la détection » button and
    the guest-facing `/status` reconciliation always call the provider for the link concerned. They
    still obey rules 6–8.
11. The reconciliation pass runs **three times a day** — a tick of 8 hours, plus the existing pass shortly
    after boot — instead of every 15 minutes. The webhook is the paid signal and the guest's own success
    page reconciles on demand (`specs/public-online-payment.md` rules 6, 8–11); the cron exists to catch
    a webhook that never arrived, which is a question of hours, not of minutes. The tick is
    environment-configurable through `PAYMENT_POLL_TICK_MINUTES`, default `480`, with the same
    "missing, non-numeric or non-positive falls back to the default" reading as rule 9.

**Edge cases:**

- A link retired by rule 1 that the webhook then reports as paid → rule 2 processes it normally; the
  guest is confirmed and the confirmation email goes out once.
- A link with `expiresAt = NULL` (the provider returned no expiry) → never retired by rule 1; rule 3's
  daily tier bounds its cost, and rule 5 keeps its status call.
- **A link whose `expiresAt` is Qonto's zero date `0001-01-01T00:00:00Z`** → treated exactly like
  `NULL`: no known expiry. In production Qonto returned that value for **every** link (it is Go's zero
  time, not a real date), and `paymentRequestService` stores it verbatim. Read as a date it is two
  thousand years in the past, so rules 1 and 5 would retire every open link on the first pass and
  payment detection would silently stop. The rule is therefore: any stored value that is empty,
  unparseable, or at or before the Unix epoch (`1970-01-01T00:00:00Z`) is "no known expiry". The
  consequence in production today: rule 1 retires nothing and rule 5 keeps the status call, so the
  savings there come from rules 3 and 6–7; rules 1 and 5 pay off wherever Qonto sends a real date
  (the sandbox does).
- `createdAt` is SQLite's `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, UTC, no zone marker) and is read as
  UTC; `lastPolledAt` is an ISO-8601 string stamped with the **start time of the pass**, so a tier fires
  on the first eligible tick rather than drifting to the next one.
- Under rule 11's 8-hour tick the first two tiers of rule 3 coincide in practice: a link younger than
  24 h and a link in the hourly tier are both due at every pass. Only the daily tier still skips passes
  (one pass out of three). The tiers are kept as they are: they are expressed in time, not in ticks, so
  they stay correct if the tick ever changes again, and they are what bounds the cost of a link that
  Qonto gives no expiry for.
- The webhook for a link already retired to `expired` → `qontoWebhookController` accepts `open` **and**
  `expired` links before re-reading the payments at Qonto, so rule 2 is reachable from the webhook.
- A link cancelled in the Qonto app while its `expiresAt` is still in the future → detected on the next
  due pass only at the decayed cadence of rule 3, since rule 5 skips its status call. Accepted: a
  cancelled link is already unpayable, so the only cost is a stale local `open` until its expiry.
- A poll pass aborted by rule 7 → `paymentPollInProgress` is released as it is today, and the next tick
  (8 hours later, rule 11) retries from the start of the worklist. The link that hit the limit was already
  stamped by rule 4 (the calls were made), so in the hourly or daily tier it waits for its next slot;
  the webhook stays the primary paid signal meanwhile. The cron logs the abort as a warning.
- The manual poll (`POST /api/payments/poll`) takes no link id, so `force: true` bypasses the cadence
  for **every** open link, not only the devis on screen. Accepted: it is a human click, and rules 6–7
  still apply.
- The public `/status` route still only reconciles an `open` link. A link retired by rule 1 is past
  its provider expiry, so a guest returning from a successful payment on it is an edge the webhook
  covers.
- A `429`/`5xx` retried inside a call logs one `[qonto] … retry n/3 in … ms` warning per wait.
- `Retry-After` present but unparseable or negative → treated as absent; rule 6's computed delay applies.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — no endpoint changes) |
| `controllers/` | `paymentsController.js` | T | Manual poll passes `force: true` (rule 10) |
| `controllers/` | `public/publicPaymentController.js` | T | `/status` reconciliation stamps `lastPolledAt` and is exempt from the cadence (rule 10) |
| `controllers/` | `qontoWebhookController.js` | T | Accepts an `expired` link as well as an `open` one before re-reading its payments, so rule 2 is reachable (the model alone was not enough: the controller filtered on `open`) |
| `models/` | `paymentLinksModel.js` | T | `retireExpired({ now })` (rule 1), `listPollable({ now, force, cadence })` (rules 3–4), `touchPolled(id, at)` (rule 4), `hasKnownExpiry(link)` (rule 5, zero-date aware), `markPaid` widened to `expired` (rule 2); statics `resolvePollCadence(env)`, `isPollDue`, `knownExpiryMs` (rule 9) |
| `middleware/` | — | — | (none) |
| `utils/` | `httpRetry.js` | C | Pure `withRetry(fn, opts)` — exponential back-off, `Retry-After`, caps, retryable-status predicate — plus `resolveRetryOptions(env)` (rules 6, 9). No network, no timers of its own beyond an injectable `sleep` |
| `utils/` | `qontoClient.js` | T | Wraps every request in `withRetry`; sends `X-Qonto-Idempotency-Key` on link creation (rule 8); rethrows a surviving `429` with `code: 'RATE_LIMITED'` for rule 7; `config.retry` overrides the env options |
| `utils/` | `paymentPollRunner.js` | T | Calls `retireExpired()`, iterates `listPollable()`, stamps `touchPolled()`, skips the second call per rule 5, aborts the pass on `RATE_LIMITED` (rule 7); summary gains `retired` and `stoppedBy` |
| `utils/` | `paymentRequestService.js` | — | (none — it already stores `expiresAt`; the zero date is interpreted on read, so existing rows are covered too) |
| `utils/` | `paymentPollSchedule.js` | C | `resolvePaymentPollTickMs(env)` — the 8-hour tick of rule 11 and its env override, pure and unit-tested |
| `scheduledTasks.js` | — | T | Takes its tick from `paymentPollSchedule` (rule 11); logs the retired count and warns when a pass was stopped by a rate limit |
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE payment_links ADD COLUMN lastPolledAt TEXT` (column-presence check) |
| `schema.sql` | `schema.sql` | T | Test fixture schema gains `lastPolledAt` |

**Notes:**
- `utils/httpRetry.js` is a pure function taking an injectable `sleep`, so its tests run instantly with
  no real waiting.
- No new dependency: `crypto.randomUUID()` (Node built-in) generates the idempotency key.
- The retry wrapper sits in `qontoClient` rather than in the poll runner, so link creation, the manual
  poll and the public `/status` route all inherit it (rule 10's second sentence).

### 4.2 Client side (`client/src/`)

No client change. The work is entirely server-side scheduling and transport behaviour; nothing in the
payload shape, the settings page or the reservation view changes.

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | — | — | (none) |
| `components/` | — | — | (none) |
| `hooks/` | — | — | (none) |
| `services/` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |
| `styles/` | — | — | (none) |
| `api.js` | — | — | (none) |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | — | No UI surface. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | — | None. |

### 4.3 API contract

No endpoint signature or payload changes. `POST /api/payments/poll` keeps its shape; its summary object
gains two informational fields, both additive:

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/payments/poll` | — | `{ checked, paid, retired, stoppedBy, results }` | `retired` = links closed by rule 1; `stoppedBy` = `'rate-limit'` when rule 7 aborted the pass, else `null`. Auth unchanged. |

---

## 5. Data model

One additive column on `payment_links`:

```sql
ALTER TABLE payment_links ADD COLUMN lastPolledAt TEXT;
```

Migration strategy — idempotent block in `server/src/database.js`, guarded the way the existing
`payment_links` migrations are (column-presence check before `ALTER`).

- **Default for existing rows:** `NULL`. A `NULL` stamp means "never polled under the new scheme"; rule
  3 treats it as due, so every existing open link is examined once on the first pass after the upgrade
  and then falls into its age tier.
- **Backfill:** none.

**Data impact:** no existing record is modified by the migration itself. On the first pass afterwards,
links already past their `expiresAt` flip from `open` to `expired` (rule 1) — a local status correction
that reflects reality at the provider; no reservation, payment flag or amount is touched, and rule 2
keeps any late payment on those links processable.

## 6. UI / UX

No screen changes, and no client change.

_Implementation finding (2026-09-15):_ there is no « Relancer la détection » action under Réglages →
Paiements en ligne. The only client caller of `POST /api/payments/poll` is the « Vérifier le
paiement » confirm button on a devis (`ReservationPage.jsx`, `handleCheckDepositPayment`), which reads
`results[]` for a `paid` entry of the devis and ignores every other field. It keeps working unchanged
(the endpoint now passes `force: true`), and `retired` / `stoppedBy` are not surfaced to the operator.
No UI was added for them.

Responsive behaviour: unchanged, no new layout. Sticky action bar: unchanged, no page touched.

## 7. Test plan

### Server unit tests

- [ ] `tests/payment-poll-tick.unit.test.js` — rule 11
  - the default tick is 8 hours (three passes a day)
  - `PAYMENT_POLL_TICK_MINUTES` overrides it; a missing, non-numeric, zero or negative value falls back
- [x] `tests/payment-poll-fair-use.unit.test.js` — rules 1, 2, 3, 4, 5, 10 (9 tests)
  - a link past `expiresAt` is retired with zero provider calls, and its reservation is untouched
  - **a zero-date `expiresAt` (`0001-01-01T00:00:00Z`) is never retired and keeps its status call**, and
    a cancellation is still detected on it; `knownExpiryMs` rejects the zero date, the epoch, empty
    and unparseable values
  - `markPaid` flips an `expired` link once and is a no-op on a `paid` or `cancelled` one
  - a locally retired link later reported paid converts the devis once, with one confirmation email
  - the three cadence tiers select and skip the right links for a fixed injected `now`
  - `lastPolledAt` is stamped on every provider call and survives a rebuilt model
  - the second provider call is made only when there is no known expiry
  - `force: true` polls a link the cadence would have skipped
- [x] `tests/qonto-http-backoff.unit.test.js` — rules 6, 7, 8, 9 (9 tests)
  - `429` then `200` succeeds after one back-off; delays double; `Retry-After` wins when larger and is
    ignored when unparseable or negative; each wait is capped at 60 s
  - a `4xx` other than `429` is not retried; a `5xx` is
  - a `429` surviving the budget raises `RATE_LIMITED` and the pass stops with `stoppedBy: 'rate-limit'`,
    leaving the remaining links unexamined
  - link creation sends one `X-Qonto-Idempotency-Key`, identical across that call's retries and
    different between two separate calls; reads carry none
  - the env-configured thresholds override the defaults, and invalid values fall back
- [x] `tests/payment-links-model.unit.test.js` — its inline DDL gains `lastPolledAt` (no new case).
- Migration: `database.js` booted twice against a throwaway SQLite file — the column is added on the
  first boot and the second is a no-op (manual check, not a committed test).

### Manual UI verification

_Not performed (2026-09-15): production now runs on the real Qonto account and no sandbox payment was
available. The zero-date and retirement edge cases are covered by the unit tests above against an
in-memory SQLite database instead._

- [ ] Happy path: create a payment link on a devis, pay it in the Qonto sandbox, confirm the webhook
      still converts the devis and sends the confirmation email exactly once.
- [ ] Edge case: force a link's `expiresAt` into the past in the dev DB, run the poll, confirm it flips
      to `expired` with no Qonto call in the logs, then confirm a simulated webhook on it still marks it
      paid and converts.
- [ ] Regression check on adjacent feature: the devis « Vérifier le paiement » button still reports
      correctly, and the public `/status` route still confirms a paid devis on demand.

## 8. Out of scope

- Any change to the Qonto webhook subscription, its signature verification or its payload handling.
  _(Superseded on 2026-09-16: `specs/settings-one-save-and-automatic-webhook.md` makes the subscription
  automatic. The signature verification and the payload handling are still untouched.)_
- Retiring or archiving `paid` links, and any change to the accounting effects of a payment.
- Mollie's Article 4 merchant obligations on the sales channel (contact details, prices, payment and
  complaint conditions on `domainesolio.com`) — a WordPress-side audit, deliberately deferred.
- Requesting a temporary rate-limit increase from Mollie or Qonto; nothing in our volume calls for it.
- Client-side changes of any kind.

## 9. Open questions

- Q: Should a link with no `expiresAt` eventually be retired on age alone rather than polled daily
  forever?
  - A: No. Retiring on our own clock could close a link the provider still considers payable, and
    rule 3's daily tier already bounds the cost at one call per link per day. Revisit only if a
    provider guarantee on link lifetime is confirmed. The same answer covers the zero-date links
    production holds today (§3 edge cases).
- Q: Does Qonto document an idempotency key on `POST /v2/payment_links`?
  - A (resolved 2026-09-15, from docs.qonto.com): **not on that endpoint.** Qonto's general page
    « Idempotent requests » names the header **`X-Qonto-Idempotency-Key`** (not `Idempotency-Key`),
    recommends a UUID v4, caches the successful response for 30 minutes, and says the endpoints that
    accept it list it and make it mandatory there. The transfer endpoints (internal transfer, transfer
    requests) declare it as a parameter; the payment-link creation reference lists only
    `X-Qonto-Staging-Token`. Decision: send `X-Qonto-Idempotency-Key` anyway. An HTTP API ignores a
    request header it does not read, so if Qonto does not honour it on this endpoint the call behaves
    exactly as before; if it does, rule 8's guarantee holds. This has **not** been observed against the
    live API — the first real link creation after deployment is the check.
- Q: Does Qonto send `Retry-After` on a `429`?
  - A (2026-09-15): undocumented. The « Rate limitations » page gives 1 000 requests / 10 s and
    10 000 requests / 10 min per IP, a `429 Too Many Requests` beyond, and throttling after 200 `401`s
    within an hour, but no header and no back-off advice. Rule 6 reads the header when present and
    falls back to its own exponential delay otherwise.
