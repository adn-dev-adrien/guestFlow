# Mollie rolling reserve, incoming payments and their reconciliation

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/mollie-rolling-reserve` |
| **Created** | 2026-11-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary page** | `docs/specs/2026-11-16-mollie-rolling-reserve.html` |
| **Extends** | [qonto-bank-reconciliation.md](qonto-bank-reconciliation.md) (rule 15 replaced), [reconciliation-assisted-matching.md](reconciliation-assisted-matching.md), [reservation-payment-ledger.md](reservation-payment-ledger.md), [direct-installments.md](direct-installments.md), [finance-dashboard-redesign.md](finance-dashboard-redesign.md), [accountant-accounting-export.md](accountant-accounting-export.md) |

---

## 1. Context

A guest who pays by card pays either through a Qonto payment link or on site with **Tap to Pay** in
the Qonto app; both are acquired by **Mollie** (confirmed by Adrien 2026-11-16). Mollie applies a **rolling reserve** to this merchant: it keeps **20 % of each payment for
90 days** and pays it out afterwards. One card payment therefore reaches the Qonto account in **two
credits, three months apart**.

Measured on the real Qonto export of 2026-10-23 (the only Mollie credits of the account so far):

| Bank date | Counterparty | Reference | Amount | Reading |
|---|---|---|---|---|
| 2025-12-23 | `Stichting Mollie Payments` | `REF T19274230.2512.01` | 157,44 € | 80 % of 196,80 € |
| 2026-03-23 | `Stichting Mollie Payments` | `REF T19274230.2603.01` | 39,36 € | 20 % of 196,80 €, **90 days later to the day** |
| 2026-11 | `Stichting Mollie Payments` | `REF T19274230.2611.01` | 11,20 € | 80 % of a 14,00 € Tap to Pay sale of 2026-11-05 (client Gruat) |

The Gruat payment as Mollie shows it: description `F-2026-013` (the Qonto invoice number; Qonto files it
as `2610-F-2026-013-SOLIO.pdf`), id `tr_…`, paid 05/11 17:10, **available balance 09/11 17:10**
(4 days), fees **0,446 € = 1,4 % + 0,25 €**.

Four facts follow, and the current code ignores them:

- **The 80 % share is not net of fees**: 157,44 + 39,36 = 196,80 exactly, and 11,20 = 80 % of 14,00
  exactly although the Gruat payment bore 0,446 € of fees. The 2025 pair belongs to the 1 000 € Mollie
  offered without commission at the start; fees apply since. Where Mollie takes them (inside a
  settlement, on the reserve release, by invoice) is not measured yet (Q5). The reconciliation's rule 15
  assumes a single payout net of fees and would never match a real Mollie credit.
- **Mollie's payment description is the Qonto invoice number** when Qonto invoiced the sale: an exact
  key from a Mollie payment to the GuestFlow sale or échéance that holds that invoice number.
- **The reference names a Mollie settlement, not a payment**: `<org>.<yymm>.<nn>`. Mollie documents it
  as « the settlement's bank reference, as found in your Mollie account and on your bank statement »,
  and Mollie explicitly **groups payments** in one settlement (several guests, plus reserves released
  that day, minus refunds and costs). A credit can therefore be any mix of 80 % shares and 20 % releases.
- **The operation type is `Transférer`** (a transfer), not `card_acquirer_payout`: Mollie is recognised
  by its counterparty only.

Consequences today: a payment link marked paid on the fiche (by the webhook) shows a permanent gap in
the reconciliation; nobody sees that 20 % of the money is still at Mollie, nor when it will arrive; the
accountant sees a « Stichting Mollie Payments » credit he cannot attach to any client.

Payments in several instalments (direct-installments.md) and platform payouts share the same need: money
the operator expects on the bank on a known date. They are visible today one fiche at a time only.

The production holds one real paid link since the plugin's reconciliation went live (26/10/2026,
732,40 €): its 80 % should have arrived around 28/10, its 20 % is due around 24/01/2027.

Measured on the live Mollie account with a read-only token (2026-11-16) — the account holds three
payments in all:

| Mollie payment | Amount | `description` | `metadata` | What it is |
|---|---|---|---|---|
| 2025-12-18 | 196,80 € | `F-2025-016` | `{"payment_link_id":"<Qonto link id>"}` | an invoice paid through a Qonto link |
| 2026-10-26 | 732,40 € | the **Qonto payment id** of the link (= `payment_links.providerPaymentId`) | null | a GuestFlow payment link |
| 2026-11-05 | 14,00 € | `F-2026-013` (Qonto invoice number) | null | a Qonto invoice paid by card (Gruat) |

Every payment carries its `settlementId` (each of the three is in a different settlement) and a
`settlementAmount` **equal to its gross**: Mollie never nets a fee per payment. The settlement, balance
and invoice endpoints answer 403 « only available with an access token not restricted to a specific
profile »: a profile-restricted token reads payments only.

Mollie API facts (docs.mollie.com, read 2026-11-16): `GET /v2/settlements/{id|reference}` (reference
lookup supported), `GET /v2/settlements/{id}/payments` (ids `tr_…`, amount, description, paidAt),
settlement `periods.<year>.<month>.revenue|costs[]` with a `rollingreserve` method; balance transactions
with seven rolling-reserve types whose link to a payment is **not documented**. These endpoints need an
**advanced access token** (Mollie dashboard → Développeurs → Jetons d'accès, admin only) with scopes
`settlements.read`, `payments.read`, `balances.read`; a plain `live_` API key is not documented to work.

## 2. Goal

The operator sees, on the fiche and in Suivi financier, every sum still to arrive on the bank account —
Mollie's immediate share in transit, Mollie's 20 % held for 90 days, the instalments of a payment plan,
the platform payouts — with its expected date, then its real date and the exact Qonto transaction that
brought it; and the accountant receives entries that explain every Mollie credit.

## 3. Functional rules

### 3.1 The split of a card payment

1. **Every Mollie payment is split in two bank tranches** — a paid payment link, and a card payment
   recorded on site (tender « CB » on a fiche, a mid-stay note or a standalone sale) from the date of the
   setting « CB sur place via Tap to Pay (Mollie) depuis » (empty = off; Adrien sets it to the first Tap
   to Pay day). Each is split into the **versement immédiat** (gross − reserve) and the **retenue**
   (the reserve). `reserve = round(gross × rate)` to the cent, the immediate share
   absorbs the rounding. The split is computed by the server once, when the payment is seen paid, and stored
   with the rate and hold it used.
2. Rate and hold are settings of the `online-payment` plugin: **« Retenue Mollie » 20 %** and
   **« Durée de la retenue » 90 jours**, plus **« Retenue appliquée depuis »** (date, default: the
   reconciliation start date). A link paid before that date has no reserve (one tranche, 100 %). A rate
   of 0 disables the reserve. Changing a setting never moves a split already stored (rule 1); the
   settings card says so under the fields.
3. **Validation (server, authoritative)** — rate: a number from 0 to 50 with at most 2 decimals; hold: a
   whole number of days from 1 to 365; « depuis »: a valid date not in the future. A refused value keeps
   the stored one and returns the reason in French (« Le taux doit être compris entre 0 et 50 % »,
   « La durée est un nombre de jours entre 1 et 365 »).
4. **Expected dates** — immediate tranche: `paidAt` + 4 days (Mollie's « en solde disponible »,
   measured on Gruat; window [0, +8]); retenue: the immediate tranche's **bank date** + hold when it is
   reconciled, else `paidAt` + 4 + hold (window [−3, +10]). The measured release came 90 days after the
   immediate credit to the day.
5. **Fees are Mollie's, never a fiche's gap.** The fee formula stays a setting, default **1,4 % +
   0,25 €** (measured on Gruat), used only to estimate. The tranches are computed on the gross (rule 1:
   the 80 % arrives whole). When a settlement read from Mollie carries costs (rule 16), they are booked as
   that settlement's fees; without a Mollie connection, a Mollie credit lower than its tranches by at most
   the estimated fees of its payments is proposed with « frais Mollie estimés : x € » (Q5).
6. A **refund** of a link (if any) reduces the immediate tranche first, then the retenue; a fully
   refunded link has no tranche left to expect. A **chargeback** is out of scope (§8).
7. A link split into tranches stays **one échéance on the fiche**, paid at the guest's payment date, as
   today. The tranches never change what the guest owes, the fiche's paid flags, the encaissement date of
   the sales journal or any finance figure based on `*PaidDate`.

### 3.2 Reconciliation (extends qonto-bank-reconciliation)

8. A paid link yields **two expected receipts** instead of one, keyed `<ledgerKey>#immediat` and
   `<ledgerKey>#retenue`, each with its amount and window (rule 4). Existing reconciliation lines on the
   bare `<ledgerKey>` of a link are migrated to `#immediat` (§5, idempotent, nothing lost).
9. **Rule 15 is replaced.** A credit classified Mollie (counterparty or label contains « mollie »,
   whatever the operation type) is matched against the open link tranches — immediate and retenue alike —
   by the smallest combination (≤ 8 tranches) whose sum equals the credit to the cent, or equals it less
    the estimated fees of those payments (rule 5). One tranche →
   **sûr**; several → **probable**; nothing exact → no proposal, the credit stays « non rattaché ».
10. **With a Mollie connection (§3.3), the settlement decides.** The credit's reference is looked up as a
    settlement; its payments list names the payments it paid. The proposal then allocates exactly the
    tranches of those payments plus the released reserves the settlement declares, and is **sûr** even
    when grouped. A settlement whose content cannot be fully mapped to links (a payment unknown to
    GuestFlow) falls back to rule 9 for the remainder and shows « 1 paiement Mollie inconnu de GuestFlow ».
11. Confirming a Mollie credit never writes the fiche (the échéance is already paid by the webhook,
    rule 7): it stores the reconciliation lines only. « Défaire » removes them.
12. Every reconciled tranche shows **the identifiers of the bank credit**: the Qonto transaction reference
    (`transaction_id`, e.g. `solio-6791-1-transaction-019d1b2f-…`, shortened in the middle with a copy
    button), the Mollie settlement reference (`T19274230.2603.01`) and, when known, the Mollie payment id
    (`tr_…`). The Qonto `transaction_id` is now stored (§5); it is the identifier Qonto's own search
    and exports show.
13. A retenue whose window has passed without a matching credit is **en retard** and raises one attention
    item « Retenue Mollie non reçue » on the home page (one per fiche, with the expected date).

### 3.3 Mollie connection (optional)

14. The `online-payment` plugin gets an optional **« Compte Mollie »** card under the Qonto connection:
    an **advanced access token** (Mollie: Développeurs → Clés API → « + Créer une clé API », type « Jeton
    d'accès avancé », **no profile restriction** (settlements, balances and invoices refuse a
    profile-restricted token — measured), mode « En direct », read-only
    authorisations (named in English in the dashboard): `payments.read`, `settlements.read`,
    `balances.read`, `balance-reports.read`, `invoices.read`, `refunds.read`, `profiles.read`, `organizations.read`, never a `.write` — and **request signing
    off**; the card's help text repeats these steps) (stored encrypted, `ENCRYPTED_COLUMNS`-equivalent plugin secret), a profile id
    when the token is organisation-level, a « Tester » button and the last read. Without a token,
    everything works by amounts (rule 9); the card says what the token adds (« les versements groupés sont
    détaillés paiement par paiement »).
15. A token that does not start with `access_` is refused before any call (« Ce n'est pas un jeton
    d'accès Mollie : il commence par access_ »). « Tester » calls `GET /v2/settlements?limit=1` and reports
    the cause in words when Mollie answers 401/403 — a profile-restricted token gets « Ce jeton est limité
    à un profil : le recréer sans restriction de profil pour lire les règlements ».
16. The plugin reads, at each reconciliation read (8 h) and on demand: the settlements referenced by the
    stored Mollie credits not yet detailed, their payments, and their `periods` revenue/costs (the
    `rollingreserve` and cost lines). Read-only; nothing is ever written to Mollie. The Mollie payment
    `tr_…` is attached to GuestFlow, first match wins (measured, §1): its `description` equals a payment
    link's `providerPaymentId` (the Qonto payment id); its `metadata.payment_link_id` equals a link's
    `providerLinkId`; its `description` equals a Qonto invoice number GuestFlow stores (standalone sales,
    hourly-resource bookings); else amount + `paidAt` within 10 minutes, unique match only. The payment's
    `settlementId` names the settlement that paid its immediate share. With an organisation-level token the
    payments are listed with the profile id (setting, filled by « Tester » from `profiles.read`).
17. A Mollie failure never blocks the reconciliation: the last read stays, the error is shown in words
    on the card, rule 9 applies.

### 3.4 On the fiche

18. **In the payments ledger, a paid link shows its tranches the way an instalment plan shows its
    instalments**: one dated line per tranche, under the échéance, with amount, label and state —
    « Versement immédiat · 585,92 € · reçu le 28/10 » / « Retenue Mollie 20 % · 146,48 € · prévue vers le
    24/01/2027 ». States: `en transit`, `reçu le …`, `retenue jusqu'au …`, `en retard`. The lines are
    built by the server (ledger row `bankTranches[]`, contributed by the plugin) and drawn by the same
    component as the instalment lines.
19. The **reservation summary** (top of the fiche, the money recap) shows the same split as a schedule:
    « Payé par carte 732,40 € — 585,92 € reçus · 146,48 € attendus le 24/01/2027 », exactly as a payment
    plan reads « 2 échéances payées · 1 à venir le … ». A fiche with no pending tranche shows nothing new.
20. The reconciliation card of the fiche lists the two tranches as two receipts, each with its credit
    identifiers (rule 12).

### 3.5 Suivi financier — « Versements à venir »

21. The Vue générale gets a tile **« Versements à venir »**: the total still to arrive on the bank, the
    number of clients, and the next date (« 1 842,30 € · 6 clients · prochain le 18/11 »). It ignores the
    period selector (like « En attente de règlement »): it is a state, not a window.
22. Clicking it opens the detail **grouped by client**: one block per client — a header (name, stays,
    total still to arrive, « Ouvrir la fiche ») and one line per sum (date + weekday, nature in words with
    its icon and detail, amount, state), sorted by next date. **Colour carries the state only**: neutral
    « Dans 3 jours / Dans 2 mois », red « En retard de 12 j », green « Reçu le … »; a legend says so. The
    nature is never a colour: words (« Retenue Mollie », « Paiement carte · 80 % », « Échéance 2 sur 4 »,
    « Versement plateforme · Booking ») plus a drawn icon (hourglass, card, calendar, house). Clicking
    the header opens the reservation fiche (a client with several stays: the line names its stay and
    opens that stay).
23. The table holds four kinds, each with its own icon and filter chip: **Retenue Mollie** (20 %, J+90),
    **Mollie en transit** (immediate share not reconciled yet), **Échéance** (an unpaid instalment of a
    direct payment plan, due date), **Versement plateforme** (a platform payout expected, its derived due
    date — paymentDeadlines `buildPlatformPayoutRow`). An item past its window is red « en retard » and
    sorts first.
24. A toggle **« Reçus récemment »** (last 30 days) shows the tranches already arrived, with their real
    bank date and Qonto reference, so the operator can see « when was it paid » after the fact.
25. Without the `online-payment` plugin (or without Qonto), the tile lists instalments and platform
    payouts only; the Mollie kinds are absent, not zero.
26. Every amount, date, state and grouping is computed by the server (`GET /api/finance/incoming`); the
    client filters by kind locally only on the rows it received.
27. « Versements à venir » overlaps « En attente de règlement » for instalments on purpose: the latter is
    what guests owe, the former what the bank will receive. The tile's help text says so.

### 3.6 Accounting export — Mollie clearing account

28. The accounting export gains a **Mollie journal** (code setting, default `MO`) and a **clearing
    account** (setting « Compte d'attente Mollie », default `46720000`):
    - at each paid link, on its payment date: **D 46720000 / C client account** (`C+NOM`) for the gross —
      Mollie owes the money, the client is settled;
    - at each reconciled Mollie credit, on its bank date: **D 512 (bank account setting) / C 46720000** for
      the credit amount, the libellé carrying the Mollie settlement reference and the Qonto reference;
    - a settlement cost (rule 5), if any: **D 627 (setting) / C 46720000**.
    The balance of 46720000 at any date is then exactly the money still at Mollie (transit + reserves).
29. The bank lines of rule 28 can be switched off (setting « Exporter les versements Mollie reçus »,
    default on) for an accountant who books the bank from the bank feed himself — Q2.
30. The export page shows, for the exported month, the clearing account's balance at month end and its
    detail (which clients' reserves are still held), as a reconciliation aid for the accountant.
31. A Mollie credit not reconciled at export time is listed as « Versement Mollie non rattaché » in the
    export summary and produces no line (never guess an allocation into the books).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/online-payment/reconciliation/` | `molliePaymentSplits.js` | C | Rules 1–4, 6: compute and store the split of a paid link; expected dates; refunds. Pure core + model. |
| | `expectedReceipts.js` | T | Rule 8: a paid link yields `#immediat` and `#retenue` receipts. |
| | `matcher.js` | T | Rule 9 replaces `acquiringProposals`; rule 10 consumes settlement details; `classify` Mollie by counterparty whatever the type. |
| | `mollieSettlements.js` | C | Rule 10, 16: map a settlement's payments and reserve lines to tranches. Pure. |
| | `transactionsReader.js`, `bankTransactionsModel.js` | T | Rule 12: store Qonto `transaction_id` as `qontoReference`. |
| | `controller.js` | T | Tranche states and identifiers in the fiche/page payloads; attention item (rule 13). |
| | `schema.js` | T | Tables of §5, `reconciliation_v3` migration. |
| `plugins/online-payment/` | `mollieClient.js` | C | Read-only Mollie API client (settlements, settlement payments), `httpRetry`, token from settings. |
| | `index.js`, `settingsStore.js`, `manifest.json` | T | Settings of rules 2, 14; registration of the SDK contributions below; version → 1.8.0. |
| `plugins/sdk/` | `createContext.js`, `version.js` | T | New entries (MINOR, SDK 2.29.0): `ledgerBankTranches(provider)` (rule 18), `incomingPayments(provider)` (rule 23), `journalEntries(provider)` (rule 28). |
| `utils/` | `reservationLedger.js` | T | Ledger rows carry `bankTranches[]` from the providers; summary line (rule 19). |
| | `incomingPayments.js` | C | Rules 21–27: gather core kinds (instalments, platform payouts) + plugin providers, group by client, sort, totals. Pure. |
| `models/` | `financeDashboardModel.js` | T | Tile `incoming` (rule 21) and detail `incoming`. |
| `routes/` + `controllers/` | `finance.js`, `financeController.js` | T | `GET /api/finance/incoming?recent=1`. |
| `plugins/accounting-export/` | `accountingExport.js`, `accountPlan.js`, `settings.js`, `controller.js` | T | Rules 28–31: Mollie journal lines from `journalEntries` providers; clearing balance; settings. Version → 1.3.0. |
| `database.js` | — | — | No core schema change. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `ScheduleLines.jsx` | C | Generic dated-amount lines with state badge — extracted from `InstallmentPlanCard`'s read view, reused by instalments and Mollie tranches (rule 18). |
| | `TransactionRef.jsx` | C | A bank/provider identifier shortened in the middle + copy button (rule 12). Generic: any external id. |
| `components/reservation/` | `FinanceSection.jsx`, `InstallmentPlanCard.jsx` | T | Render `bankTranches[]` and the summary line (rules 18–19); the plan card uses `ScheduleLines`. |
| `pages/` | `FinancePage.jsx` | T | Tile « Versements à venir » + its detail. |
| `components/finance/` | `IncomingPaymentsTable.jsx` | C | Rules 22–24: grouped table (md+), cards (xs), kind filter chips, recent toggle, row → fiche. Feature-specific. |
| `plugins/online-payment/` | `MollieConnectionCard.jsx`, `ReconciliationSettingsCard.jsx`, `ReconciliationLine.jsx` | C/T | Token card (rules 14–15), reserve settings (rules 2–3), identifiers on bank rows (rule 12). |
| `plugins/accounting-export/` | export page | T | Clearing account balance + unattached credits (rules 30–31), settings. |
| `api.js` | — | T | `finance.incoming`, Mollie test. |

**Component reuse:** consumes `StatusBadge`, `TableCard`, `EmptyState`, `ErrorAlert`, `LoadingState`,
`MaskedTextField`, `HelpedTextField`, `PlatformChip`. Creates `ScheduleLines` (generic: instalments,
Mollie tranches, later any staged payment) and `TransactionRef` (generic: Qonto, Mollie, Stripe ids).
`IncomingPaymentsTable` is specific (one page, one payload).

### 4.3 API contract

| Method | Endpoint | Response | Notes |
|---|---|---|---|
| GET | `/api/finance/incoming[?recent=1]` | `{ totals: { amount, clients, nextDate }, kinds: [{ key, label, count }], clients: [{ clientId, name, totalCents, nextDate, late, stays: [{ reservationId, label, items: [{ kind, label, amountCents, expectedDate, receivedDate, state, stateLabel, refs: { qonto, mollieSettlement, molliePayment } }] }] }] }` | Admin + accounting role. |
| GET | `/api/finance/dashboard` | `tiles.incoming: { amount, clients, nextDate }` | Added field. |
| GET | `/api/reservations/:id` (ledger) | rows gain `bankTranches[]`, summary gains `schedule` | Additive. |
| POST | `/api/plugins/online-payment/mollie/test` | `{ ok, settlements, error? }` | Never returns the token. |
| PUT | plugin settings | 400 `{ error }` on rule 3 / 15 refusal | |

## 5. Data model (plugin `online-payment`, migration `reconciliation_v3`)

- `payment_link_splits` — `paymentLinkId` PK, `reservationId`, `ledgerKey`, `grossCents`, `immediateCents`,
  `reserveCents`, `ratePercent`, `holdDays`, `paidAt`, `molliePaymentId` NULL, `refundedCents` 0,
  `createdAt`. Backfill: every paid link from « Retenue appliquée depuis » on.
- `mollie_settlements` — `id` (`stl_…`) PK, `reference`, `settledAt`, `amountCents`, `costsCents`,
  `reserveHeldCents`, `reserveReleasedCents`, `fetchedAt`.
- `mollie_settlement_payments` — `settlementId`, `molliePaymentId`, `amountCents`, `paidAt`,
  `description`, `paymentLinkId` NULL; PK (`settlementId`, `molliePaymentId`).
- `bank_transactions.qontoReference` TEXT NULL (filled on next read; CSV imports already use it as id).
- `bank_reconciliation_lines`: rows whose `ledgerKey` is a link's bare key are rewritten to `#immediat`
  — idempotent, a rerun finds nothing to rewrite.

**Data impact:** additive; one rewrite of reconciliation keys for links (production has at most one).

## 6. UI / UX

See the summary page for the interactive mock-ups (fiche, tile + table, settings, journal).

- **Fiche ledger:** under a paid link échéance, 2 indented lines, same typography as instalment lines;
  a `TransactionRef` after « reçu le … ». Mobile: the lines stack, the reference wraps under the amount.
- **Summary:** one line, sans-serif figures, « reçus » in success, « attendus » in muted ink, « en retard »
  in error.
- **Tile:** same shape as the other tiles; secondary text « 6 clients · prochain le 18/11 ».
- **Detail (md+):** one bordered block per client (red border when late), header button « Ouvrir la
  fiche », lines Date · Nature · Montant · État. Nature filter chips above (words + icon, counts) and the
  « Reçus ces 30 derniers jours » switch; the state legend under them. **xs:** same blocks, each line
  stacks nature on top, then date + amount + state; the header stays a ≥ 44 px tap target.
- **Empty state:** « Rien à recevoir : tout ce qui était attendu est arrivé. »
- **Settings:** three fields + inline refusal (rule 3); Mollie card with `MaskedTextField`.
- No new page, so no new `PageActionBar`; the finance page keeps its bar.

## 7. Test plan

### Server unit tests (one file per subject)
- `mollie-payment-split.unit.test.js` — rules 1–4, 6–7 (rounding, since-date, rate 0, refunds, settings change).
- `mollie-reconciliation-matching.unit.test.js` — rules 8–11 (two receipts, grouped credit of 3 payments +
  1 release, no fee, measured 157,44/39,36 pair, migration of bare keys).
- `mollie-settlements.unit.test.js` — rules 10, 16–17 (mapping, unknown payment, failure fallback).
- `mollie-settings-validation.unit.test.js` — rules 3, 15.
- `incoming-payments.unit.test.js` — rules 21–27 (grouping, sort, late first, without plugin).
- `accounting-mollie-journal.unit.test.js` — rules 28–31 (balanced entries, clearing balance, switch, unattached).

### Client tests
- `ScheduleLines.test.jsx`, `TransactionRef.test.jsx`, `IncomingPaymentsTable.test.jsx`,
  `FinanceSection.mollie-tranches.test.jsx`, `MollieConnectionCard.test.jsx`.

### Manual UI verification
- Shadow on a fresh production copy (secrets purged) + the CSV export with the Mollie pair: fiche, tile,
  table at 390 / 900 / 1280 px, settings refusal, export of December 2025 and March 2026.
- Live Mollie token: only after release, on production, read-only (Q1).
- E2E suite after the UI changes.

## 8. Out of scope

- Chargebacks and disputes (Mollie deducts them from a settlement: shown as an unexplained remainder).
- Writing anything to Mollie or Qonto; Mollie webhooks.
- The historical « Paiements-En-Personne » daily batches (rule 31 of the reconciliation, unchanged);
  Tap to Pay through Mollie is in scope (rule 1).
- Forecasting cash beyond what is already paid or scheduled.

## 9. Open questions

- Q1: What does a payment link's Mollie payment carry? — **resolved 2026-11-16 (measured)**: the Qonto
  payment id in `description`; an invoice paid by card carries the Qonto invoice number; a 2025 link
  carried `metadata.payment_link_id` (rule 16).
- Q5: Where does Mollie take its fees (0,446 € on Gruat): inside a settlement, on the reserve release, or
  by monthly invoice? → measured on settlement `T19274230.2611.01` and the Mollie invoices.
- Q2: Does the accountant book the bank account from the bank feed (then rule 29 off) or import our bank
  lines? Account numbers `46720000`, `MO`, `627` to confirm with him.
- Q3: Is a direct link to a transaction in the Qonto web app stable enough to offer « Ouvrir dans Qonto »?
  Until measured: copy button only.
- Q4: Does Mollie release a reserve inside the regular settlement of the day (grouped) or alone? Both are
  handled (rules 9–10); the measured case was alone.
