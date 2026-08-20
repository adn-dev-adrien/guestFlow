# The deposit is what blocks the dates — say it on the quote, drop it when the stay is too close

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-08-20)_ — engine switch, PDF block, `full_request` circuit, 28 new server tests (3426 green) + 2 client tests (1066 green). |
| **Branch** | `feature/deposit-blocks-the-dates` _(Claude-managed)_ |
| **Created** | 2026-08-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [online-payments-qonto.md](online-payments-qonto.md) §3.7 (the last-minute rule, specified 2026-06-11 and still unimplemented), [payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) (acompte/solde deadlines), [public-online-deposit.md](public-online-deposit.md) (the deposit/full mode the website reads), [devis-english-language.md](devis-english-language.md) (the FR/EN label maps) |

---

## 1. Context

A quote promises dates. **What actually holds them is the deposit** — the app already behaves that way:
a paid deposit link converts the devis into a reservation and blocks the dates
([paymentPollRunner.js](../server/src/utils/paymentPollRunner.js) `applyPaidEffect`), and the deposit
request email says it in as many words: *« le règlement de l'acompte bloque vos dates. Tant qu'il n'est
pas payé, les dates restent disponibles et peuvent être réservées par un autre client. »*
([defaultEmailTemplatesRegistry.js:230](../server/src/utils/defaultEmailTemplatesRegistry.js#L230)).

**The quote itself never says it.** The PDF's « MODALITÉS DE RÈGLEMENT » block prints an amount and a
deadline ([devisPdf.js:645](../server/src/utils/devisPdf.js#L645)) and nothing else — a guest reads a
date, not a condition, and believes the stay is held.

Second, related hole: **the last-minute rule was specified and never built.** [online-payments-qonto.md
§3.7](online-payments-qonto.md) rule 18 says a stay starting inside the property's `balanceDaysBefore`
window (30 days — already enforced on every property by the `balance_days_before_30_v1` migration,
[database.js:1329](../server/src/database.js#L1329)) must drop the deposit and ask for the **full
amount in one payment**. Its checklist entry is still unticked, and nothing in
[pricing.js](../server/src/utils/pricing.js) implements it. Today a quote issued 10 days before arrival
carries an acompte due on the quote's validity date **and** a solde due the day the quote was written —
two deadlines for a stay that should simply be paid in full, once.

## 2. Goal

A quote tells the guest what secures the dates, and asks for the right thing: a deposit when there is
time to collect one, the full amount when the stay is too close. Direct bookings only — a platform
booking is settled by the platform and carries no such promise.

## 3. Functional rules

### 3.1 The mention on the quote

1. **The acompte line carries a mention.** When a direct-channel quote shows an acompte, the PDF prints,
   under the acompte box, in the document's language:
   - FR — *« Le règlement de l'acompte bloque vos dates : tant qu'il n'est pas payé, elles restent
     disponibles et peuvent être réservées par un autre client. »*
   - EN — *« Paying the deposit secures your dates: until it is paid, they remain available and may be
     booked by another guest. »*

   Wording deliberately mirrors the `deposit_request` email so a guest reads the same sentence twice.
2. **Fixed copy, not a setting.** Both strings live in
   [devisPdfLabels.js](../server/src/utils/devisPdfLabels.js) like every other PDF literal — no new
   `app_settings` column, no operator input. The existing free-text quote footer is unaffected.
3. **Direct channel only.** The mention is printed when `isDirectChannel(devis.platform)` is true
   (`direct` + `Lodgify`, per [platformNameFormat.js](../server/src/utils/platformNameFormat.js) — never
   a `platform === 'direct'` string test). A quote carrying an OTA name prints the current block,
   unchanged and mention-free: the platform holds the dates, not us.

### 3.2 No deposit when the stay is too close

4. **Last-minute switch (engine).** In the pricing engine, a **direct** quote/reservation whose stay
   starts within the property's `balanceDaysBefore` window gets `depositAmount = 0` and the whole
   pre-arrival total on the single remaining payment. Formally: the switch applies when
   `daysBetween(bookingDate, startDate) <= property.balanceDaysBefore`.
5. **The pivot is the booking day, never "today".** `bookingDate` is the devis/reservation `createdAt`
   (today for a creation) — the value the engine is already given. A quote therefore decides once, at
   issue time, and never changes its mind: a guest cannot receive one PDF with an acompte and a later
   one without. This also preserves the engine's no-clock property (same inputs → same output).
6. **Precedence — the switch is the last word, not the first.** It applies only after every existing
   branch has declined, in this order (all pre-existing):
   1. non-direct platform → its own rules;
   2. `depositDisabled` → deposit already forced to 0;
   3. `depositPaid` (with or without `balancePaid`) → the collected amounts are frozen;
   4. `depositAmountOverride` → **the operator's manual acompte wins**, even last-minute;
   5. **new:** last-minute → deposit 0, everything on the single payment;
   6. otherwise → the usual `depositPercent` split.
7. **Deadline of the single payment.** A **devis** owes it on its **validity date** (`validUntil`) —
   the day up to which the quote promises the dates, exactly as the acompte does today
   ([paymentSchedule.js](../server/src/utils/paymentSchedule.js) rule 5. Printing the quote's issue day
   instead, which the raw solde clamp would produce, would contradict the « Valable jusqu'au » pill on
   the same page). A **reservation** keeps the current solde derivation (`startDate −
   balanceDaysBefore`, clamped to the booking day).
8. **PDF, last-minute case.** With no acompte and a positive balance on a direct channel, the payment
   block prints **one** line — FR « Paiement intégral : », EN « Full payment: » — with the amount, the
   deadline, and the matching mention (FR *« Le règlement du séjour bloque vos dates : … »* / EN
   *« Paying for the stay secures your dates: … »*). Calling 100 % of a stay a « solde » when no acompte
   ever existed describes nothing.
9. **Caution row.** Same copy as before in both cases, with one fix found while rendering the English
   quote: its amount was printed at a fixed offset that overprinted the end of a long label
   (« Security deposi**500,00 €** — payable on arrival »). Every row of the block now opens its amount
   column after its own label, so no translation can collide with its figure.

### 3.3 Collecting it

10. **The server picks the request type.** `POST /reservations/:id/payment-emails` without an explicit
    `type` resolves it from the record: `deposit` when `depositAmount > 0`, otherwise `full`. The client
    stops naming the type for that button (fat backend); `balance` stays explicit where it is used today.
11. **New email template `full_request`** (FR/EN), seeded like `deposit_request`: stay recap, « Montant à
    régler : {{finalPrice}} », the Qonto link (`{{paymentLink}}` / `{{#if hasPaymentLink}}`), and the
    same dates-are-not-held sentence. Registered as event-triggered (host action) and as a payment
    template, so no cron may ever auto-send it — money is never chased automatically.
12. **The fiche's button reads « Envoyer la demande de paiement »** and reports what was actually sent
    (acompte or paiement intégral). It no longer promises an acompte a last-minute devis does not have.
13. **The email announces what the link charges.** _(Amended 2026-08-20, during implementation: the
    guard first written here was unnecessary — the acompte reminder is anchored on `depositDueDate`,
    whose branch already filters `depositAmount > 0` and the direct channel
    ([emailLogModel.js:93](../server/src/models/emailLogModel.js#L93)). The devis branch must keep
    listing a last-minute quote, which still owes money.)_ The real gap was the amount: the email
    context exposed only `{{depositAmount}}` and `{{finalPrice}}` (tourist tax excluded) while the
    Qonto link charges stay + tax. The sender therefore injects **`{{paymentAmount}}`** — the link's
    own amount — the way it already injects `{{paymentLink}}`, so no payment email can quote a figure
    the payment page contradicts.

### 3.4 What does not change

14. **No retroactive migration.** Existing devis and reservations keep their stored split; the rule
    applies to creations and to recomputes (a save, « Actualiser tarifs »). A last-minute devis already
    carrying a paid acompte keeps it (rule 6.3).
15. **`balanceDaysBefore` stays operator-owned.** The 30-day policy is already applied in production by
    `balance_days_before_30_v1`; this spec adds no migration and no new setting. The value to verify per
    property is the « solde X jours avant » field of *Paramètres → logement → Acompte & solde*.
16. **The public website follows for free.** [public-online-deposit.md](public-online-deposit.md) rule 2
    already resolves the payment mode as `deposit` only when `depositAmount > 0`; a last-minute stay
    therefore falls back to `full` — one charge, no Acompte/Solde lines — with no plugin change. Covered
    by a test, not by new code.

**Edge cases:**
- Stay starting **exactly** on the threshold (30 days out) → last-minute, full payment
  ([online-payments-qonto.md §3.7](online-payments-qonto.md) edge case, kept verbatim).
- No `bookingDate` (stateless public preview) → no switch. The public quote controller already injects
  `getTodayIsoDate()` ([publicQuoteController.js:73](../server/src/controllers/public/publicQuoteController.js#L73)),
  so the site and the devis it later creates agree.
- Devis with no dates yet → no switch (nothing to compare), no mention beyond the acompte one.
- Devis converted to a reservation → the stored split (deposit 0) is copied as-is; no acompte resurrects.
- Direct devis with `depositPercent = 0` → deposit already 0; it prints the « Paiement intégral » block
  and its mention, which is the correct promise.
- Platform devis, last-minute → untouched: no switch, no mention, current block.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `paymentSchedule.js` | T | New pure `isLastMinuteStay({ bookingDate, startDate, balanceDaysBefore })` (rule 4, threshold inclusive); `resolveBalanceDueDate` gains a caller-set `dueOnValidUntil` flag (rule 7) — the caller decides, because only it knows the channel. |
| `utils/` | `pricing.js` | T | The switch itself: one branch in the direct deposit chain, placed after the override branch (rule 6). |
| `utils/` | `devisPdf.js` | T | Payment block: mention under the acompte, « Paiement intégral » line + mention when there is no acompte, both gated on `isDirectChannel(full.platform)`. Row drawing factored into one geometry (label-relative amount column, rule 9); the direct/full decision extracted as the pure `__resolvePaymentBlock` for testing. |
| `utils/` | `devisPdfLabels.js` | T | 3 new keys × FR/EN: `depositSecuresDates`, `fullPaymentLabel`, `fullPaymentSecuresDates`. |
| `utils/` | `paymentRequestService.js` | T | `REQUEST_TEMPLATES.full = 'full_request'`; new pure `resolveRequestType(row, requested)` (rule 10). |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | `full_request` FR/EN + its two key lists (`EVENT_TRIGGERED_STABLE_KEYS`, `PAYMENT_STABLE_KEYS`). |
| `controllers/` | `paymentsController.js` | T | Stops assuming `deposit` when the request names no type; injects `{{paymentAmount}}` from the link into the email context. |
| `utils/` | `emailContextBuilder.js` | T | New `{{paymentAmount}}` variable, overridden per-send by the sender (rule 13). |
| `models/` | `devisModel.js` | T | `resolvePaymentSchedule` mirrors rule 7 for a stored deposit-less **direct** devis (the enriched fiche and the PDF must not disagree with the engine). |
| `routes/` | — | — | (none — the endpoint keeps its shape) |
| `database.js` | — | — | (none — no schema change; the email template arrives through the existing boot seed) |
| `scheduledTasks.js` | — | — | (none) |

**Notes:** `isLastMinuteStay` and `resolveRequestType` are pure and unit-tested; no new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Action renamed « Envoyer la demande de paiement »; the confirm/success copy uses what the server reports; no `type` sent. |
| `services/` | `api.js` | T | `sendPaymentRequestEmail(id)` stops hardcoding `type: 'deposit'`. |
| `components/`, `hooks/`, `utils/`, `constants/`, `styles/` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `DialogProvider` (`alert` / `confirm`) | The action lives in the existing bar; no new dialog. |
| **Created (new generic)** | — | None: no new UI surface, only copy and a server-resolved type. |
| **Specific (kept feature-local)** | — | — |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/:id/payment-emails` | `{ type?: 'deposit' \| 'balance' \| 'full' }` | `{ sent, type, url, amountCents, emailLogId, recipientEmail }` | Auth required. **Omitted `type` is resolved server-side** (rule 10) and echoed back so the UI can name what it sent. An explicit type is honoured; an explicit *unknown* one is refused with `400 INVALID_TYPE` rather than quietly swapped. Unknown record → `404`. `400 ZERO_AMOUNT` is now unreachable from the devis button. |
| GET | `/api/devis/:id/pdf` | — | PDF stream | Unchanged contract; new content per rules 1–9. |

---

## 5. Data model

**No schema change.** No new column, no index, no migration block.

- `full_request` is inserted by the existing idempotent boot seed
  ([defaultEmailTemplatesSeed.js](../server/src/utils/defaultEmailTemplatesSeed.js)) — insert-if-missing,
  operator edits never overwritten.
- `balanceDaysBefore` is already 30 everywhere via `balance_days_before_30_v1`; this spec neither
  re-runs nor changes it.

**Data impact:** none on existing rows. Stored splits are left alone; the new rule only bites on a
recompute (rule 14). A recompute of an *open* last-minute devis will move its acompte to 0 and grow the
single payment by the same amount — intended, and the reason the operator's manual override keeps
precedence.

## 6. UI / UX

**Quote PDF — normal case (stay more than 30 days out, direct):**

```
MODALITÉS DE RÈGLEMENT
──────────────────────────────────────────────────────────
▌ Acompte : 129,00 €    À payer avant le 03/09/2026        (amber box, unchanged)
  Le règlement de l'acompte bloque vos dates : tant qu'il    (8 pt italic, grey)
  n'est pas payé, elles restent disponibles et peuvent
  être réservées par un autre client.
▌ Solde :   307,00 €    À payer avant le 05/10/2026        (grey box, unchanged)
▌ Caution : 500,00 € — à remettre le jour de votre arrivée  (green box, unchanged)
```

**Quote PDF — last-minute case (stay within 30 days, direct):**

```
MODALITÉS DE RÈGLEMENT
──────────────────────────────────────────────────────────
▌ Paiement intégral : 436,00 €   À payer avant le 27/08/2026   (amber box)
  Le règlement du séjour bloque vos dates : tant qu'il
  n'est pas payé, elles restent disponibles et peuvent
  être réservées par un autre client.
▌ Caution : 500,00 € — à remettre le jour de votre arrivée
```

The mention wraps inside the page width and participates in the existing page-break accounting
(`checkBreak`), so it can never be orphaned from the amount it explains. Platform quotes render exactly
as today.

**Fiche devis (screen):** the action-bar button keeps its `PaymentsIcon` and its position; only the
tooltip changes to « Envoyer la demande de paiement ». Success copy becomes « Demande d'acompte
envoyée ✓ » or « Demande de paiement envoyée ✓ » depending on what the server sent. The finance
summary needs no change: a 0 € acompte already renders as no acompte.

**Responsive:** no new screen surface. The action bar already collapses per
[CLAUDE.md §7](../CLAUDE.md); the PDF is a fixed-width document.

## 7. Test plan

### Server unit tests
- [x] `tests/last-minute-full-payment.unit.test.js` (11) — rules 4-7: stay at 31 j → acompte; at 30 j
      (threshold) → none; at 10 j → none; no `bookingDate` → acompte; platform → untouched (payout
      schedule intact); `depositAmountOverride` → the manual acompte survives; `depositPaid` → frozen;
      devis deadline = `validUntil`, reservation deadline = clamped solde date.
- [x] `tests/devis-pdf-deposit-mention.unit.test.js` (7) — rules 1-3, 8: the 3 new keys exist and are
      translated, direct (incl. Lodgify) vs platform gating, the full-payment decision, and that the
      mention repeats the `deposit_request` email word for word.
- [x] `tests/payment-request-type.unit.test.js` (9) — rules 10-11: `resolveRequestType`; a devis with
      an acompte → `deposit_request`; a last-minute one → `full_request`; the link amount reaches the
      email; unknown record → 404; `full_request` is bilingual, manual and in both key lists.
- [x] `tests/payment-request-service.unit.test.js` (T) — an unknown explicit type is still refused now
      that `full` is supported.
- [x] `tests/public-payment-mode.unit.test.js` (T) — rule 16: no acompte → the website asks for the
      whole stay.
- [x] Full suite green: **3426 tests, 0 failures** (`cd server && npm test`).

### Client tests
- [x] `client/src/__tests__/payment-request-no-hardcoded-type.test.js` (2) — the request carries no
      type and the answered type is relayed. Full suite: **1066 tests green** (`npx vitest run`).

### Manual UI verification
- [ ] Happy path: devis for a stay 3 months out → PDF shows acompte + mention; « Envoyer la demande de
      paiement » sends the acompte email.
- [ ] Last-minute: devis for a stay in 10 days → fiche shows no acompte, PDF shows « Paiement intégral »
      + mention + validity deadline; the button sends the `full_request` email with a Qonto link for the
      full amount.
- [ ] EN devis (`pdfLanguage = 'en'`) → both cases print the English copy, no French leak.
- [ ] Platform devis, last-minute → PDF unchanged, no mention, acompte rules untouched.
- [ ] Regression: an existing reservation with a paid acompte, recomputed via « Actualiser tarifs »,
      keeps its acompte and its deadlines.
- [ ] Mobile (`xs`): the devis action bar still shows the payment action (or its overflow entry).

## 8. Out of scope

- **Renaming « Solde » on screen** (fiche finance, dashboard, accounting) for a last-minute stay. The
  amounts are right; only the PDF, which the guest reads, gets the new wording.
- **Automatic dunning for the full payment.** No `full_reminder` template, no cron: per
  [CLAUDE.md](../CLAUDE.md) and the no-automatic-dunning rule, money is chased by the operator.
- **Retroactive recompute** of existing devis/reservations (rule 14).
- **Making the deposit gate the conversion in the app.** Marking the acompte received already converts
  the devis and blocks the dates; « Accepté » still converts on the operator's decision, by design.
- **Changing `balanceDaysBefore`** or adding a separate last-minute setting (rule 15, and
  [online-payments-qonto.md §3.7](online-payments-qonto.md) rule 18 which explicitly refuses one).
- **WordPress plugin changes** (rule 16 — the existing mode resolution covers it).

## 9. Open questions

_All resolved with Adrien on 2026-08-20, before implementation:_

- Q: Does the quote merely state the rule, or must the app enforce it?
  - A: **State it** — and only for direct bookings, never for platforms (rules 1, 3).
- Q: Which date decides « the stay starts within 30 days »?
  - A: **The quote's creation date** (rule 5) — a quote must not change its terms as time passes, and the
    pricing engine has no clock.
- Q: What does the payment block look like when there is no acompte?
  - A: A single **« Paiement intégral »** line (rule 8); « solde » would name something that never existed.
- Q: Does the switch apply to reservations too, or to quotes only?
  - A: **Both**, on the direct channel — it is one engine, and a direct reservation entered 10 days out
    has the same two-contradictory-deadlines bug (rule 4).
- Q: How is a deposit-less devis collected, since the deposit button would build a 0 € link?
  - A: **Full circuit** (rules 10-12): the server resolves the request type and a new `full_request`
    template asks for the whole amount with its Qonto link.
