# Mollie settlement statement joined to its Qonto credit

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/mollie-settlement-receipts` |
| **Created** | 2026-11-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary page** | `docs/specs/2026-11-17-mollie-settlement-receipts.html` |
| **Extends** | [mollie-rolling-reserve-and-incoming-payments.md](mollie-rolling-reserve-and-incoming-payments.md), [qonto-bank-reconciliation.md](qonto-bank-reconciliation.md) |

---

## 1. Context

Every Mollie settlement lands in Qonto as one credit referenced `REF T<settlement reference>` (measured:
`REF T19274230.2611.01` ↔ settlement `19274230.2611.01`). Qonto asks for a supporting document on each transaction,
and the accountant needs to know what the credit is made of: which guest payments, how much Mollie held back as its
20 % reserve, which earlier reserves it released, and its fees.

The Mollie dashboard can export a settlement as PDF, but **the Mollie API offers no PDF** — not for a settlement, a
payment nor a balance transaction (measured 2026-11-17: `/v2/settlements/{id}` answers JSON only, `/report`,
`/export`, `/pdf` answer 404, the balance report refuses any format but JSON; docs.mollie.com documents JSON only).
The only Mollie PDFs reachable by API are its monthly fee invoices. Driving the dashboard with the operator's
password and two-factor login is fragile and against Mollie's terms: excluded.

What the API does give, exactly, is the content of that export: since PR #1067 GuestFlow reads the Mollie balance
transactions. A settlement is the `outgoing-transfer` carrying its `settlementId`, and the rows since the previous
transfer are its composition — `payment` (gross in `initialAmount`, reserve and fees in `deductions`, net in
`resultAmount`) and `api-payment-rolling-reserve-release` (a reserve released 90 days later). Qonto already accepts a
PDF on a transaction (`POST /v2/transactions/{id}/attachments`, OAuth scope `attachment.write`), used today by the
hourly-resources plugin for its invoices.

## 2. Goal

Every Mollie credit on the Qonto account carries, without the operator doing anything, a PDF statement written by
GuestFlow from Mollie's own data that explains the credit to the cent: one line per payment or released reserve,
with its guest and reservation. An installation with Mollie but without Qonto sees nothing of this feature.

## 3. Functional rules

1. **One statement per settlement.** The statement of a settlement is a PDF built from its composition
   (`compositionOf(settlementId)`, the balance transactions between its transfer and the previous one). It is never
   built from amounts alone: a settlement whose composition is unknown gets no statement. _(Amended 2026-11-17: a credit
   whose settlement is stored but whose composition is not is no candidate until the balance transactions are read — it
   takes no job slot (rule 8), shows no chip on its line and is counted nowhere.)_
2. **Available only with Qonto and Mollie both connected.** The feature exists when the online-payment plugin holds a
   Qonto connection **and** a Mollie access token. Without Qonto connected, neither the setting, the status, the
   endpoint nor the job exist (the endpoint answers 404, the job does nothing). Without a Mollie token there is no
   composition to write, so the same applies.
3. **Opt-in, with a start date.** The setting `mollieStatementsSince` (a date) turns the feature on: empty = off.
   Only Mollie credits settled on or after that date get a statement. Turning it on prefills the first day of the
   current month; the operator may choose an earlier date to cover past credits.
4. **Which credits.** A candidate is a `bank_transactions` row from Qonto, credited (`amountCents > 0`), recognised as
   Mollie (`isMollieCredit`) and whose reference resolves to a known settlement (`settlementReferenceOf` +
   `normalizeReference`). A Mollie credit with no matching settlement waits (the hourly settlement read may not have
   run yet).
5. **Sum check before any upload.** The statement is uploaded only if the sum of its lines' net amounts equals the
   credit's amount to the cent. Otherwise its state is `mismatch` with both amounts, and nothing is sent to Qonto.
6. **Content of the statement** (French, A4 portrait, one page as long as it fits):
   - header: the installation's company name, title « Relevé de versement Mollie », settlement reference, Mollie
     settlement id, date of the Qonto credit, Qonto reference, credited amount;
   - one line per composition row, in date order: date, kind (« Paiement » or « Libération de retenue »), Mollie
     payment id (`tr_…`), Mollie description (Qonto link id or invoice number), guest and reservation number when
     GuestFlow knows them (through `mollie_payment_splits`), gross, reserve held, fees, net;
   - totals line: gross, reserve held, reserve released, fees, net — the net total equals the credit (rule 5);
   - footer: « Établi par GuestFlow à partir des données de l'API Mollie », generation timestamp.
   Fees are `deductions − reserve held` per payment (0 while Mollie's « Fee Discount » applies; measured). A released
   reserve has no gross, no fees: its net is the reserve.
7. **Uploaded once, never twice.** The upload uses the idempotency key `mollie-statement:<settlementId>:<transactionId>`
   and its success is recorded; a recorded statement is never uploaded again, whatever the operator does.
   _(Amended 2026-11-17: the job and « Réessayer » never handle the same credit at the same time — a retry on a credit
   being handled answers its current state without uploading — and no write ever replaces a recorded `attached` row.
   The PDF is dated by the first attempt (`firstAttemptAt`, kept in the row): footer timestamp, document dates and file ID
   derive from it, so every render of a statement, retry or « Voir le relevé » included, is the same bytes under the same
   idempotency key.)
   _(Amended 2026-11-17: the in-flight check lives inside the single-credit handler itself, so a « Réessayer » started
   on a credit the job has not reached yet is not repeated by the job: one upload. Only the footer date depends on the
   first attempt; the guest names, reservation numbers and company name are read at each attempt. If they change between
   two attempts Qonto may refuse the same idempotency key with different content: the row goes `failed` (rule 9) and
   « Réessayer » is the way out. The key itself is never changed.)_
8. **Hourly, on what is already read.** The job `mollie-statements` runs every hour (first run 7 minutes after boot)
   on the Qonto credits and Mollie balance transactions already stored by the reconciliation read (its own schedule,
   or « Actualiser »), and treats every pending candidate, at most 20 per run (oldest first). A statement therefore
   follows the read that brought its credit within the hour. _(Amended 2026-11-17: the plugin has no hourly Mollie
   read of its own; the job does not trigger one.)_
9. **Failures are retried, then surfaced.** A network or Qonto 5xx error keeps the state `pending` with its message and
   an attempt count, retried next hour. After 24 attempts the state becomes `failed`. A Qonto 403 / `insufficient_scope`
   makes the state `reauth` for every pending statement and the setting card says « Reconnecter Qonto pour joindre les
   relevés » (the connection predates the `attachment.write` scope).
   _(Amended 2026-11-17: only a network error, a 429 or a 5xx is retried; a 401, a 403 or a failed token refresh
   (`invalid_grant`) is `reauth`; any other 4xx is `failed` at once with Qonto's message. `reauth` is applied to the
   statements that are pending or have no row yet, never to `mismatch`, `failed` or `attached`; the job handles a `reauth`
   row like a pending one, and any later outcome — attached, mismatch, failed — clears `reauth`.)_
   _(Amended 2026-11-17: an error flagged `overtaken` — a concurrent Qonto token refresh that won — is transient, never
   `reauth`: the credit stays `pending` and the next attempt uses the fresh token. Missing Qonto application credentials
   (`QONTO_NOT_CONFIGURED`, found on a shadow copy) are `reauth` too: they need the operator, not another hour.)_
10. **Retry by hand.** A `failed`, `reauth` or `mismatch` statement offers « Réessayer » on its reconciliation line,
    which runs rule 4–7 for that credit at once and resets its attempt count.
11. **Readable in GuestFlow.** The reconciliation line of a Mollie credit shows its statement state and, once
    built, « Voir le relevé » opens the same PDF (built on the fly, never stored on disk). _(Amended 2026-11-17: the
    link is offered in every state, « en attente » included — the PDF only needs the composition, which every
    candidate has.)_
12. **Read-only towards Mollie.** The feature calls no Mollie endpoint of its own: it reuses the stored balance
    transactions. It writes nothing to Mollie.
13. **The start date reaches back 2 years at most.** `mollieStatementsSince` older than 2 years before today is refused
    (« La date ne peut pas remonter à plus de 2 ans. »), like a date in the future (rule 3). On the card the date is saved
    when the field loses focus or on Enter, never while it is being typed, and saves are sent one after the other.
    _(Amended 2026-11-17: the value saved is the one the field holds when it loses focus — a calendar pick blurs the
    field in the same tick as its change — and a value equal to the one being saved is ignored, so a calendar pick, or
    Enter followed by the blur, saves exactly once.)_

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | Responsibility |
|---|---|---|
| plugin utils | `plugins/online-payment/reconciliation/mollieStatementPdf.js` _(new)_ | Pure: composition + settlement + credit → PDF bytes (pdfkit), and the line/total shaping (rule 6). |
| plugin model | `plugins/online-payment/reconciliation/mollieStatementsModel.js` _(new)_ | `mollie_settlement_statements` rows: candidates (rule 4), state transitions, attempt count. |
| plugin controller | `plugins/online-payment/reconciliation/mollieStatements.js` _(new)_ | Orchestrates rules 2–10: availability, sum check, build, upload through the Qonto client, error mapping. |
| plugin schema | `plugins/online-payment/reconciliation/schema.js` | Migration `reconciliation_v4`: the new table. |
| plugin settings | `plugins/online-payment/settingsStore.js` | Declares `mollieStatementsSince` (date, validated like `mollieReserveSince`). |
| plugin index / jobs | `plugins/online-payment/index.js` | Runs the statements job after the hourly Mollie read (rule 8). |
| plugin routes | `plugins/online-payment/reconciliation/routes.js` | `GET …/mollie-statements/:transactionId.pdf`, `POST …/mollie-statements/:transactionId/retry`, status in the Mollie connection payload. |
| plugin reconciliation reader | `plugins/online-payment/reconciliation/controller.js` | Adds `statement: { state, error, attachedAt }` to a Mollie credit's line. |
| core | `utils/qonto/qontoClient.js` | Reused as is (`uploadTransactionAttachment`). |
| tests | `plugins/online-payment/tests/mollie-settlement-statements.unit.test.js` _(new)_ | Rules 1–12. |

### 4.2 Client side (`client/src/`)

| Layer | File | Responsibility |
|---|---|---|
| plugin component | `plugins/online-payment/MollieConnectionCard.jsx` | Section « Relevés dans Qonto »: switch + start date, counters (joints / en attente / à revoir), reconnect hint. Rendered only when the server says the feature is available (rule 2). |
| plugin component | `plugins/online-payment/ReconciliationLine.jsx` | Statement chip (« Relevé joint », « Relevé en attente », « Écart de x € », « Reconnecter Qonto ») + « Voir le relevé » + « Réessayer ». |
| shared component | `components/StatusBadge` | Reused for the chip. No new generic component. |

### 4.3 API contract

- The plugin settings payload (existing `getPluginSettings` / `savePluginSettings` of `online-payment`) gains the
  writable `mollieStatementsSince` (`YYYY-MM-DD` or empty).
- `GET /api/payments/reconciliation/mollie-statements/status` → the read-only `mollieStatements`
  `{ available, since, counts: { attached, pending, toReview }, reauth }`, computed live. `available: false` → the
  client renders nothing of this feature. (Implementation note: the generic plugin-settings payload cannot carry a
  computed object, so the card reads it from this endpoint rather than from `getPluginSettings`.)
- `GET /api/payments/reconciliation/mollie-statements/:transactionId.pdf` → `application/pdf`; 404 when unavailable
  (feature off included) or not a Mollie credit with a known composition.
- `POST /api/payments/reconciliation/mollie-statements/:transactionId/retry` → `{ statement }`.
- Each bank side of a Mollie credit in the reconciliation payloads carries `statement: { state, error, attachedAt, gapCents } | null`
  (`gapCents` only for `mismatch`: statement total − credit).

## 5. Data model

New table (plugin migration `reconciliation_v4`, additive, no existing row touched):

```sql
CREATE TABLE IF NOT EXISTS mollie_settlement_statements (
  transactionId TEXT PRIMARY KEY,          -- the Qonto credit
  settlementId TEXT NOT NULL,
  state TEXT NOT NULL,                     -- pending | attached | mismatch | failed | reauth
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  attachmentId TEXT, attachedAt TEXT,
  firstAttemptAt TEXT,                     -- first attempt: dates the PDF (rule 7)
  updatedAt TEXT NOT NULL
);
```

New plugin setting `mollieStatementsSince` (empty by default = off).

## 6. UI / UX

- **Réglages → Paiements en ligne → Compte Mollie**: below the balance, a section « Relevés dans Qonto » with a
  switch « Joindre le relevé de chaque versement Mollie dans Qonto » and a date « À partir du ». Under it one line of
  counters. Absent without Qonto connected (rule 2).
- **Rapprochement**, line of a Mollie credit: a status chip next to « Lot Mollie », colour = state only (green joint,
  grey en attente, orange à revoir), and a text button « Voir le relevé ». On `xs` the chip wraps under the references,
  the button stays full width.
- Mobile: the PDF opens in a new tab (the browser's viewer).

## 7. Test plan

### Server unit tests

`mollie-settlement-statements.unit.test.js` — one test per rule 1–12 at least: composition shaping and fees, sum
check refusal, availability without Qonto / without Mollie token, opt-in date filter, idempotent single upload,
retries then `failed`, 403 → `reauth`, manual retry, PDF bytes start with `%PDF` and contain the reference.

### Manual UI verification

Shadow copy of prod: enable from a date covering the 29/10 and 10/11 credits, check the PDF content against Mollie,
check the chip on the reconciliation line (desktop and 390 px), and that the section disappears when Qonto is
disconnected. The real upload is not exercised in the shadow (sandbox Qonto only).

## 8. Out of scope

- The Mollie dashboard's own PDF (no API).
- Mollie's monthly fee invoices.
- Deleting or replacing an attachment already in Qonto.
- Debits (refunds, chargebacks) from Mollie.

## 9. Open questions

_None open._

Resolved:
- Q1 (2026-11-17, Adrien) — switching on prefills the first day of the current month; the operator may move it back.
- Q2 (2026-11-17, Adrien) — guest names and reservation numbers are printed: the PDF goes only to the operator's own Qonto.

## 10. Implementation progress

Status: **Implemented** (2026-11-17), plugin `online-payment` 1.9.0.

Built:
- Server: `mollieStatementPdf.js` (shaping + pdfkit rendering with the embedded Source Sans faces), `mollieStatementsModel.js`,
  `mollieStatements.js` (availability, sum check, upload, retries, status, line state, PDF), migration `reconciliation_v4`,
  setting `mollieStatementsSince`, `findByReference` on the settlements model, `attachPdf` on the Qonto issuer (Qonto origin
  « relevé de versement Mollie »), three routes, `statement` on the bank side of a credit, an hourly job `mollie-statements`.
- Client: « Relevés dans Qonto » section of `MollieConnectionCard`, `MollieStatementState` (chip, « Voir le relevé »,
  « Réessayer ») on `ReconciliationLine` and on the page's unmatched credits.
- Reading of rule 8: the Mollie read stays the reconciliation job's (every 8 hours or « Actualiser »); the statements job runs
  every hour on what is stored, so a statement follows the read within the hour. A `reauth` statement is tried again by the
  job (one refused call stops the run); `mismatch` and `failed` wait for « Réessayer ».
- Tests: server `mollie-settlement-statements.unit.test.js` (28, rules 1-13 + migration); client
  `MollieConnectionCard.statements.test.jsx` (10) and `ReconciliationLine.statement.test.jsx` (7).
- Review fixes (2026-11-17): credits without a known composition are no candidates (rule 1); `reauth` marks only pending or
  rowless statements and the job clears it (rule 9); one in-flight set shared by the job and « Réessayer », and no write over
  an `attached` row (rule 7); `firstAttemptAt` dates the PDF so every render is the same bytes (rule 7); 429 / 5xx / network
  retried, 401 / `invalid_grant` → `reauth`, other 4xx → `failed` (rule 9); date saved on blur / Enter, at most 2 years back
  (rule 13); « Réessayer » shows an error toast; saving the date refreshes the section only.
- Verification fixes (2026-11-17): the date is saved from the field's own value (a calendar pick saves once, Enter then blur once); the in-flight check sits inside the single-credit handler (a retry never doubles the job's upload); an `overtaken` refresh error stays pending; a retry's state gives way to the page's new one; a changed statement between attempts is documented in rule 7 (no key change).
