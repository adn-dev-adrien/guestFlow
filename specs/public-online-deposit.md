# Public online deposit payment (per-property « Acompte en ligne » mode)

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-07-03)_ — server (migration, mode decision, deposit link, balance cron, recap) + client (toggle, manual balance button) + plugin (mode-aware summary/button/recap) + tests (server 1983 green, client 603 green). Sandbox card E2E deferred to the next prod run. |
| **Branch** | `feature/public-online-deposit` |
| **Created** | 2026-07-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [public-online-payment.md](public-online-payment.md) (UC2 full payment — this spec adds a per-property mode on top), [online-payments-qonto.md](online-payments-qonto.md) (links/poll/emails), [tourist-tax-on-solde.md](tourist-tax-on-solde.md) (deposit base excludes the tax), [payment-links-vat.md](payment-links-vat.md) (VAT items on the same links) |

---

## 1. Context

The public booking flow (WordPress site → `/public/v1`) charges the **full stay** in one Qonto payment
(use case 2). But the site's quote summary displays **Acompte** and **Solde** lines (engine
`depositAmount`/`balanceAmount`, exposed by `toPublicQuote`), which contradicts the single charge —
found during the 2026-07-02 prod E2E: the guest reads « Acompte 76,88 € / Solde 189,17 € » yet the
button charges 266,05 € at once.

What exists today:
- Properties already carry `depositPercent` (30), `depositDaysBefore` (30), `balanceDaysBefore` (7) —
  edited in the « Acompte & Solde » card of `PropertyDetail.js`.
- The engine computes `depositAmount` = accommodation pre-arrival × `depositPercent`/100 (the tourist
  tax rides entirely on the solde, per [tourist-tax-on-solde.md](tourist-tax-on-solde.md)) and
  `balanceAmount` = remainder; both are persisted on the devis row and exposed in the public quote.
- The paid-link effect **already supports deposits**: a paid `deposit` link on a `kind='devis'` row
  converts it to a reservation, sets `depositPaid=1` (NOT `balancePaid`), re-checks availability
  (conflict flag + admin notify) and sends the confirmation email
  ([paymentPollRunner.js](../server/src/utils/paymentPollRunner.js) `applyPaidEffect`).
- A paid `balance` link on a reservation sets `balancePaid=1` silently (no email) — correct.
- **Nothing exists to collect the balance by email**: no `balance_request` template
  (`REQUEST_TEMPLATES` has only `deposit`), and the « Relances » payment-timing settings
  (`balanceReminderOffsets` etc., Paramètres → Paiements) are **dormant** — no cron reads them.
- The public `pay`/`status` controllers hardcode the `full` link type.

## 2. Goal

Per property, the operator chooses how the website guest pays: **acompte en ligne** (deposit charged at
booking, balance collected later by an emailed payment link) or **paiement unique** (current behavior).
When the mode is « paiement unique », the site no longer displays Acompte/Solde lines at all.

## 3. Functional rules

1. **New per-property toggle « Acompte en ligne »** (`properties.publicDepositEnabled`, boolean,
   **default OFF** — decision 2026-07-03: no silent behavior change at deploy). Shown in the existing
   « Acompte & Solde » card on the property page, next to `depositPercent`.
2. **The server decides the payment mode** — never the client. Effective mode for a quote/devis:
   `deposit` when the property has `publicDepositEnabled=1` **and** the computed `depositAmount > 0`
   (a `depositPercent` of 0 or a zero deposit falls back to `full`); otherwise `full`.
3. **Public quote** (`POST /public/v1/quote` and the booking-request receipt): the payload gains
   `payment.mode: 'deposit'|'full'`. The `deposit`/`balance` blocks are included **only when
   `mode='deposit'`** — in `full` mode they are omitted entirely, so the site cannot display Acompte /
   Solde lines that no longer mean anything (fat backend: display shaping is server-side).
4. **Site display** (plugin): in `deposit` mode the summary shows « Total », then « Acompte à payer
   maintenant » and « Solde à régler avant le {balance.dueDate} » ; the submit button reads
   **« Payer l'acompte »**. In `full` mode: current display (Total only, button « Payer en ligne »).
5. **`POST /booking-requests/:id/pay`**: the server resolves the mode from the devis's property **at
   pay time**. In `deposit` mode it creates/reuses a **`type='deposit'`** Qonto link whose amount is
   the **STORED devis `depositAmount`** (raw `reservations` column — same anti-drift rule as the full
   payment: never a fresh recompute, never client input). In `full` mode: unchanged (`fullPaymentCents`).
   ⚠️ Implementation trap: `devisModel.findById()` overrides `depositAmount` with a divergent
   tax-inclusive recompute (`enrichDevis`/`resolvePaymentSchedule`) — the resolver MUST read the raw
   column (`SELECT depositAmount FROM reservations`), not the enriched object.
6. **Paid deposit effect**: existing behavior (convert devis → reservation, `depositPaid=1` only,
   availability re-check → `bookingConflictAt` + admin notify, `reservation_confirmation` email,
   exactly-once via the `markPaid().flipped` gate). No code change expected beyond tests.
7. **`GET /booking-requests/:id/status`**: no longer hardcodes the `full` link — it looks up the open
   link of the devis's mode (`deposit` first, then `full` fallback so an in-flight devis created
   before a toggle flip still resolves). The `confirmed` recap gains, when the reservation's balance
   is not settled: `payment: { mode:'deposit', depositAmount, balanceAmount, balanceDueDate }` so the
   success page can display « Acompte de X € payé — solde de Y € à régler avant le {date} ».
8. **Balance collection — automatic email + manual button** (decision 2026-07-03):
   - New email template **`balance_request`** (FR/EN), seeded like `deposit_request`: stay recap,
     « Solde à régler : {{balanceAmount}} », the Qonto payment link URL (`{{paymentLink}}`,
     `{{#if hasPaymentLink}}` fallback like the existing templates).
   - **Automatic send**: a daily scheduled pass (same 08:00-tick pattern as the auto-email cron) selects
     reservations with `kind='reservation'`, `balancePaid=0`, `balanceAmount > 0`, a **paid `deposit`
     payment link** (proof the deposit was collected online — covers both the public flow and UC1
     email-paid deposits), and `balanceDueDate ≤ today`. For each: create/reuse the `type='balance'`
     Qonto link (amount = stored `balanceAmount`; in deposit mode the tourist tax rides on the solde,
     so balance = remainder incl. tax) and send `balance_request`. Dedup: one send ever per
     (template, reservation) pair via the existing `email_log` mechanism; a `failed` send retries the
     next day (existing `existsFor(status='sent')` semantics). Qonto disconnected → skip + log, retry
     next day.
   - **Manual button** « Envoyer la demande de solde » on the reservation fiche (`PageActionBar`,
     mirror of « Envoyer la demande d'acompte ») — visible when `kind='reservation'`,
     `balanceAmount > 0`, `balancePaid=0`. Uses the same service path (`sendPaymentRequest(type
     'balance')`), which also allows re-sending after the automatic email.
9. **Paid balance effect**: existing (`balancePaid=1`, no email). The reservation's payment chips
   (balance overdue…) already derive from `balancePaid`/`balanceDueDate` — no change.
10. **Security**: unchanged — per-devis `publicToken` required on `pay`/`status`, `paymentStatusLimiter`,
    amounts server-side only.

**Edge cases:**
- Toggle flipped OFF between quote and pay → pay re-resolves at pay time: creates a `full` link; a
  stale open `deposit` link for that devis is retired by the existing stale-amount/type logic (extend
  the reuse check: an open link of the WRONG type for the current mode is cancelled).
- Toggle flipped ON between quote and pay → symmetric: deposit link minted, ditto.
- `depositPercent=0` / computed deposit ≤ 0 → mode falls back to `full` (rule 2) — never a ZERO_AMOUNT error for the guest.
- Guest pays deposit, dates conflict at conversion → existing conflict flow (paid, flagged, admin notified).
- Guest never pays the balance → reservation stays `balancePaid=0`, overdue chip + manual relance
  (auto-reminders beyond the single request are out of scope, §8).
- Balance already paid by other means (cash/transfer, operator marks `balancePaid=1`) before the
  cron fires → the pass skips it (`balancePaid=0` filter).
- Devis edited by the admin between site quote and pay → stored `depositAmount` is re-persisted by the
  edit (devisModel.update reruns the engine), and the stale-amount re-mint guard already covers the link.

---

## 4. Architecture

> **Fat backend, thin frontend.** The mode decision, amounts, link type, email scheduling and recap
> shaping are all server-side. The plugin only renders fields present in the payload.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE properties ADD COLUMN publicDepositEnabled INTEGER NOT NULL DEFAULT 0` (pattern of `platformTakesDeposit`), + mirror in `schema.sql` baseline (line ~261). |
| `models/` | `propertiesModel.js` | T | Add the column to the **positional** INSERT/UPDATE lists (4 synchronized edits — column list + values, create + update); coerce to 0/1 (multipart sends strings). |
| `controllers/public/` | `publicQuoteController.js` | T | Compute `payment.mode` (rule 2) and strip/include `deposit`/`balance` blocks accordingly. |
| `utils/` | `publicProjections.js` | T | `toPublicQuote` gains `payment.mode`; deposit/balance conditional. (Deliberate, documented exception to the "deposit config never leaves the building" note — the mode + amounts are needed by the checkout.) |
| `controllers/public/` | `publicPaymentController.js` | T | `pay`: resolve mode at pay time → link type + amount resolver (`deposit` = raw stored `depositAmount`); `status`: link lookup by mode with `full` fallback; recap gains the `payment` block (rule 7). |
| `utils/` | `devisQuote.js` | T | New `depositPaymentCents(db, devisId)` — raw-column read (anti-drift + enrichDevis trap documented at the definition). |
| `utils/` | `paymentRequestService.js` | T | `REQUEST_TEMPLATES.balance = 'balance_request'`; reuse-check extended: open link of the wrong type for the requested type is cancelled + re-minted. |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | Seed `balance_request` FR/EN (event-triggered set: excluded from the manual pending queue). |
| `utils/` | `balanceRequestRunner.js` | C | Pure, injectable daily pass (rule 8): select eligible reservations → ensure `balance` link → send template → log. Unit-testable like `emailAutoSendRunner`. |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Wire the daily balance pass (08:00-tick pattern, once per local day). |
| `controllers/` | `paymentsController.js` | T | `sendPaymentRequestEmail` accepts type `balance` (route already generic); resolveAmountCents already handles `balance`. |
| `routes/` | — | — | (none — existing routes are generic on type) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `PropertyDetail.js` | T | « Acompte en ligne » switch in the « Acompte & Solde » card (send 0/1, not booleans — multipart). |
| `pages/` | `ReservationPage.js` | T | « Envoyer la demande de solde » action (PageActionBar `actionsBefore`, visibility rule 8). |
| `api.js` | `api.js` | T | `sendBalanceRequestEmail(id)` (mirror of the deposit call). |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `ConfirmDialog` (send confirmation), MUI `Switch` | No new generic component needed. |
| **Created (new generic)** | — | — |
| **Specific (kept feature-local)** | — | — |

**WordPress plugin** (`integrations/wordpress/guestflow-booking/`):

| File | T/C | Responsibility |
|---|---|---|
| `blocks/booking/view.js` | T | Summary renders Acompte/Solde ONLY when present in the payload; button label « Payer l'acompte » vs « Payer en ligne » from `payment.mode`; success recap renders the balance-due line when the status payload carries it. |
| `assets/runtime.js` | T | New FR strings (`payDeposit`, `balanceDueBefore`, `depositPaidBalanceDue`). |

⚠️ **Deploy reminder:** the plugin is NOT deployed by the `release` pipeline — copy the changed files
into the `wp_app` container (see memory `wp-plugin-deploy-gap`, incident 2026-07-02).

### 4.3 API contract (`/public/v1`)

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/quote` | unchanged | + `payment: { mode: 'deposit'\|'full' }`; `deposit`/`balance` blocks present **only** in deposit mode | Backward-compatible narrowing. |
| POST | `/booking-requests` | unchanged | receipt unchanged (+ mode implicitly via the follow-up quote) | |
| POST | `/booking-requests/:id/pay` | unchanged (`token`, `returnPath`) | `{ paymentUrl, amountCents, currency, status, paymentMode }` | `amountCents` = deposit amount in deposit mode. |
| GET | `/booking-requests/:id/status?token=…` | — | confirmed recap + `payment: { mode, depositAmount, balanceAmount, balanceDueDate }` when balance unsettled | |

**Internal:** `POST /api/payments/reservations/:id/payment-emails` now accepts `{ type: 'balance' }`
(401-guarded admin session as today; 400 `INVALID_TYPE` otherwise unchanged).

---

## 5. Data model

- **`properties.publicDepositEnabled INTEGER NOT NULL DEFAULT 0`** — idempotent ALTER in
  `database.js` **and** `schema.sql` baseline (both required, migrations-baseline convention).
  Existing rows default to 0 → behavior unchanged until the operator opts in.
- New seeded email template `balance_request` (FR/EN) — additive, `email_templates` rows created by
  the existing registry seeding (idempotent by stableKey).
- No new table. `payment_links.type='balance'` already valid.

**Data impact:** none on existing rows (default 0; templates additive).

## 6. UI / UX

- **PropertyDetail — « Acompte & Solde » card:** MUI `Switch` « Acompte en ligne » + helper text
  « Le site encaisse l'acompte à la réservation ; le solde est demandé par email à l'échéance. »
  Responsive: the card already stacks on `xs`; the switch takes a full row on `xs`, inline on `md+`.
  PageActionBar: unchanged (existing page Save/Cancel).
- **ReservationPage:** new icon action (tooltip « Envoyer la demande de solde », `color: 'info'`,
  icon `RequestQuoteIcon` or similar) in `actionsBefore`, next to the deposit-request action; hidden
  when not applicable. Confirmation dialog before sending (existing pattern). On `xs` it collapses
  into the existing "…" overflow like other secondary actions.
- **Site (plugin):** deposit mode summary —
  « Total 266,05 € / **Acompte à payer maintenant : 76,88 €** / Solde à régler avant le 07/09/2026 :
  189,17 € » ; bouton « Payer l'acompte ». Success page: « Paiement confirmé — votre réservation est
  validée ! Acompte de 76,88 € payé. Solde de 189,17 € à régler avant le 07/09/2026 (un email vous
  sera envoyé). » Full mode: current copy, no Acompte/Solde lines. The block is already responsive
  (single column on `xs`).
- **Email `balance_request` (FR):** sujet « Votre solde pour {{propertyName}} » ; corps = récap séjour
  + « Solde à régler : {{balanceAmount}} » + lien de paiement + date limite. EN mirror.

## 7. Test plan

### Server unit tests
- [x] `public-payment-mode.unit.test.js` — rule 2: deposit only when opted in AND deposit>0; defensive (missing column/unknown property → full); `depositPaymentCents` reads the RAW stored column (anti-drift, pins the enrichDevis trap); deposit VAT components.
- [x] `public-projections.unit.test.js` — rule 3: `payment.mode` exposed; deposit/balance blocks present ONLY in deposit mode, absent (with mode='full') by default.
- [x] `balance-request-runner.unit.test.js` — eligibility (balancePaid=0, positive balance, due date reached, paid deposit link on the converted devis), send-once dedup, failed-send retry, disabled-template no-op.
- [x] `property-public-deposit-toggle.unit.test.js` — create/update coerce string/boolean/number `publicDepositEnabled` to a 0/1 bit ("false" → 0).
- [x] `payment-request-service` — type `balance` resolves `balance_request` (INVALID_TYPE now only for unsupported types); full suite 1983 green.
- Note: `applyPaidEffect` already converts + sets `depositPaid` only for a paid deposit link (covered by existing payment-poll-runner tests) — unchanged by this spec.

### Manual UI verification
- [x] Client Vitest 603 green (PropertyDetail/ReservationPage/api compile + existing coverage).
- [ ] PropertyDetail: toggle save/reload at 3 breakpoints (next prod sandbox run).
- [ ] Site sandbox E2E (deposit mode ON): quote shows Acompte/Solde + « Payer l'acompte » → pay deposit → success page shows balance due → DB `depositPaid=1, balancePaid=0` (next prod sandbox run).
- [ ] Balance flow: force `balanceDueDate=today` → cron sends `balance_request` → pay → `balancePaid=1`, no duplicate (next prod sandbox run).
- [ ] Full mode (toggle OFF): site shows NO Acompte/Solde lines, single « Payer en ligne » charge — regression on the 2026-07-02 scenario (next prod sandbox run).

## 8. Out of scope

- **Multi-offset balance reminders** (the dormant `balanceReminderOffsets` settings): v1 sends ONE
  automatic request at the due date + manual resends. Hooking the full offsets cadence (and the
  `email_log` per-offset dedup it requires) is deferred.
- Auto-abandon of unpaid-balance reservations.
- Deposit mode for the admin-driven UC1 email flow (unchanged).
- Card-on-file / automatic second charge (Mollie mandates) — not supported by Qonto payment links.
- Amendments this spec requires in [public-online-payment.md](public-online-payment.md) §2/§3/§8 (full-only wording) and [wordpress-plugin.md](wordpress-plugin.md) §3 rule 6b are applied at implementation time.

## 9. Open questions

- Q: Should the automatic balance email also cover direct reservations whose deposit was paid
  **offline** (no paid deposit link)?
  - A (2026-07-03, proposed): no — the paid-deposit-link condition keeps the automation scoped to
    online-collected deposits; offline flows keep today's manual handling. Revisit if Adrien wants it.
- Q: `reservation_confirmation` email wording in deposit mode (it currently implies the stay is paid)?
  - A (proposed): add `{{#if balanceDue}}` block « Solde de {{balanceAmount}} à régler avant le
    {{balanceDueDate}} » — confirmed at implementation.
