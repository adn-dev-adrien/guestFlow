# Qonto bank reconciliation — matching bank credits to reservation payments

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/qonto-bank-reconciliation` (PR → `inte/plugins`) |
| **Created** | 2026-10-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary page** | `docs/specs/2026-10-22-qonto-bank-reconciliation.html` |

---

## 1. Context

What GuestFlow believes was paid lives on the fiche: the paid flags and dates of each échéance
(`depositPaid`/`balancePaid`/… + `*PaidDate`), the « Paiement plateforme » block
(`platformPayoutAmount`, commissions), the payment links (`payment_links`) and the payments ledger
that renders them (`utils/reservationLedger.js`, `specs/reservation-payment-ledger.md`).

What was actually paid lives on the Qonto account that receives the money: the platform payouts
(Booking, Airbnb, GreenGo, Gîtes de France, Abracadaroom), the guests' transfers and cheques, and the
Mollie payouts of the Qonto payment links. Nothing compares the two. The tools that fill the fiche
(`platform-booking-intake`, the « Paiement plateforme » block, the ledger) are still being improved,
so the fiche can be wrong in four ways the operator never sees: an échéance marked received that
never reached the bank, a payout received but not entered, an amount that differs from the payout
(wrong commission, wrong tax), a date in the wrong month (which moves the receipt to another month
of the accounting export, `encaissementsByMonth` reads `*PaidDate`).

The Qonto connection already exists: the `online-payment` plugin holds the OAuth tokens of the
organisation, with the scope `organization.read`, which also covers `GET /v2/bank_accounts` and
`GET /v2/transactions` (Qonto docs, « Sync transactions »). No new consent is needed.

Facts that shape the matching, measured on the real export of the account (21 months of
operations, 114 credits, 2026-10-23) against a production copy:

| Source | Counterparty / reference on the credit | Shape | Amount | When |
|---|---|---|---|---|
| Booking | `Booking.com B.V.` or `Booking.com BV`, reference `NO.<payout id>/ID.<Booking property id>` | one per reservation, sometimes 2 reservations of the same property in one credit | exactly `platformPayoutAmount` | the Friday ~6 days after departure |
| Airbnb | `AIRBNB PAYMENTS LUXEMBOURG S.A.`, reference `Airbnb` | one per reservation | exactly `platformPayoutAmount` | 1–3 days after arrival |
| Gîtes de France | `Vir LOCATION RESERVATION GITES DE FRANCE ARDECHE` (older: `Vir E.U.R.L LOCATION RESERVATION GITES DE FR`), no reference | one per reservation | the payout, or the gross on the oldest fiches | 4–11 days after departure |
| GreenGo | `STRIPE`, reference `GREENGO <5-char code>` (`… ANNUL` for a cancellation compensation) | one per reservation | exactly `platformPayoutAmount` | ~2 days after departure |
| Abracadaroom | `Mangopay`, reference `<payout id>-domainesolio <text>` | one per reservation, sometimes 2 in one credit | exactly `platformPayoutAmount` | at booking time, months before the stay |
| Lodgify (site bookings paid by card) | `STRIPE`, reference `STRIPE` | **weekly batch on Monday** of every card payment of the week | each payment **net of Stripe's fee** (~2.8 %); exact when the fiche records the payout | the Monday after the payment |
| Abritel | `PayPal (Europe) Sarl et CIE SCA`, reference `abritel,<listing id>,…` | one per reservation | the payout | around arrival |
| Direct transfer | the guest's own name (often « M. OU MME … »), reference free text, sometimes « Acompte réservation <name> » or the stay dates | one per échéance, sometimes the whole stay in one | the échéance | any time |
| Card on site | `Paiements facturés`, reference `Paiements-En-Personne-<dd-mm-yyyy>` | **daily batch** of the day's card payments | gross of the day | the day itself |

None of the platforms puts the booking number GuestFlow stores (`reservationNumber`) in the credit:
the identifiers carried are payout ids, property ids and, for GreenGo, its own short code. Matching
is therefore by **platform + amount + date**, and every platform amount matched exactly when the
fiche recorded its payout. Two facts stay unmeasured: the account has received **no Mollie payout of
a real payment link yet** (the links marked paid belong to test reservations since deleted), and
the two older `Stichting Mollie Payments` credits (`REF T<id>.<yymm>.01`) predate the links.

## 2. Goal

The operator sees, for every reservation still in progress, whether each payment GuestFlow expects
or records actually reached the Qonto account — with the amount and the date it arrived — and gets
a short list of the gaps to fix on the fiches.

## 3. Functional rules

### 3.1 Placement and scope

1. The feature belongs to the `online-payment` plugin. It needs a connected Qonto organisation (the
   plugin's existing OAuth connection) and is inert otherwise: no page, no job, no attention item.
   A bare install (no plugin) shows nothing of it.
2. **In-scope reservations** = not cancelled, and departure date ≥ the **start date**. The start date
   is a plugin setting, set to the day the feature is first opened and editable afterwards. Nothing
   before it is reconciled. A reservation stays in scope after departure until all of its receipts
   are reconciled (that is where platform payouts arrive).
3. Only **credits** of the selected bank account are read (`side=credit`, `status=completed`).
   Refunds, debits and pending operations are out of scope (§8).
4. The bank account is a plugin setting, defaulting to the organisation's main account
   (`listBankAccounts` → `main`).

### 3.2 Reading the bank

5. A job reads the transactions every 8 hours (same fair-use rhythm as the payment poll), and the
   page's « Actualiser » reads them on demand. The first read covers `settled_at` from 13 months
   before the start date (deposits of in-scope stays can be that old); later reads are incremental
   on `updated_at_from` = the last successful read minus one day.
6. Each credit is stored in the plugin's own table with only what matching needs: Qonto id, amount
   in cents, currency, settled and emitted dates, operation type, label, counterparty name,
   reference, note. The counterparty's IBAN is **not** stored.
7. A Qonto failure never loses stored data: the page shows the last successful read and the failure
   in words (« Lecture du compte impossible le 22/10 à 14:05 · … »). Rate limits go through the
   existing retry (`httpRetry`).

### 3.3 What GuestFlow expects

8. An **expected receipt** is one row of the reservation's payments ledger that moves money through
   the bank: deposit, balance, complement, end-of-stay complement. A platform stay has **one** receipt,
   its payout, read from the balance row (the platform settles the whole stay in one transfer, so its
   acompte row is no receipt of its own); the settled mid-stay notes are paid on the spot and are no
   receipt. Rows in « caisse interne » or paid cash are excluded (they never reach the bank), and so is
   a row with nothing to collect (amount 0). A « paiement unique » group is one expected receipt for
   its total.
9. Each expected receipt carries: reservation, ledger key, channel (`platform:<name>`, `link`,
   `direct`), the **amount expected on the bank** (a platform stay: the payout recorded on the fiche,
   else the gross, flagged « payout not recorded » — rule 32; a link's gross amount; a direct
   échéance's amount), the expected date (the recorded paid date when marked paid, else the due date),
   and whether the fiche marks it paid.
10. The expected receipts are computed by the server from the core's ledger (`buildLedger`, reached
    through the SDK) — the plugin re-implements no amount (CLAUDE.md §6.0).

### 3.4 Matching

11. Matching produces **proposals**; a proposal is never a decision. Only the operator turns a
    proposal into a **reconciliation** (« Confirmer ») or discards it (« Écarter »). A discarded
    pair is never proposed again.
12. A transaction can be reconciled with several expected receipts (a batch payout), and an expected
    receipt with several transactions (a payment in two transfers). Each reconciliation line stores
    the amount allocated; a transaction's lines never exceed its amount.
13. **Identifier** — a token of the label, reference or note equal to a reservation's
    `reservationNumber`, its quote number, or a platform intake number → proposal on that
    reservation, confidence **sûr** when the amount also matches, **probable** otherwise.
14. **Platform payout** — a credit whose counterparty matches a platform's recognition patterns
    (setting, one list of text patterns per platform, defaults in rule 29) is proposed against that
    platform's unreconciled payout rows whose `settled_at` falls between 400 days before and 30 days
    after the row's expected date (Abracadaroom pays at booking time, Booking a week after departure
    — §1). No floor on the reservation's creation date: the fiches are often typed after the money
    moved, which the real export showed:
    - one row with the exact amount → **sûr** if it is the only one, **à vérifier** if several are;
    - else the smallest combination of up to 6 rows whose sum is exact → **probable**.
15. **Payment-link payout** — a credit recognised as a Mollie/Qonto acquiring payout
    (`operation_type = card_acquirer_payout` or pattern, §9 Q2) is proposed against the paid links
    whose `paidAt` is within the 7 days before `settled_at`, by the combination of up to 6 links whose
    sum net of the acquiring fee equals the credit, 1 cent of tolerance per link → **probable**
    (**sûr** for a single link). The fee formula is a setting (default 1,4 % + 0,25 € per payment,
    unmeasured: no real link payout has reached the account yet, §9 Q2).
16. **Direct transfer or cheque** — any other credit with the exact amount of an unreconciled direct
    receipt due or recorded within [−30, +30] days → **probable** when the counterparty or label
    contains the client's last name (case and accents ignored, « M. OU MME » prefixes dropped),
    **à vérifier** otherwise. A credit that carries the client's last name but not an échéance's amount
    is proposed « à vérifier » on that reservation's next échéance for the amount available (a deposit
    paid in advance against a balance, a transfer a few euros short). A credit whose amount equals the sum of several échéances of one
    direct reservation (the whole stay paid at once) is proposed against all of them, same
    confidence rule.
17. When several proposals compete for the same transaction, the highest confidence is shown and the
    others are listed as alternatives. A transaction with no proposal from a recognised source
    (platform or acquiring payout) is shown as **non rattaché**. Any other credit (owner's transfer,
    interest, refund from a supplier…) is listed only under « Autres crédits », where the operator can
    link it by hand or mark it « Hors réservation ».
18. Manual linking: from any credit, the operator picks one or more in-scope reservations and the
    échéance; the allocated amount defaults to the remainder of both sides.

### 3.5 Discrepancies

19. Each expected receipt has exactly one state, computed by the server from the reconciliations
    (confirmed only — a proposal never clears or raises a gap):

    | State | When | Shown as |
    |---|---|---|
    | `reconciled` | reconciled amount = expected amount (±1 cent per link for acquiring payouts) and the fiche marks it paid | Rapproché |
    | `amount_gap` | reconciled, amounts differ | Écart de montant · `+12,40 €` |
    | `received_not_recorded` | reconciled, the fiche does not mark it paid | Reçu, non saisi |
    | `recorded_not_received` | the fiche marks it paid, nothing reconciled, recorded date + 7 days passed | Saisi, rien sur le compte |
    | `late` | not marked paid, nothing reconciled, due date + 7 days passed | En retard |
    | `date_gap` | reconciled, the fiche's paid date and `settled_at` fall in different months | Date à corriger · `perçu le 03/11` |
    | `partial` | reconciled credits cover less than the expected amount, the fiche not marked paid yet | Reçu en partie · `300,00 € sur 700,00 €` |
    | `proposed` | not reconciled, a proposal exists (it wins over `late` and `recorded_not_received`) | À confirmer |
    | `waiting` | none of the above | Attendu le … |

    `amount_gap` wins over `received_not_recorded`, which wins over `date_gap`.
20. A proposal never writes to a reservation; only the operator's « Confirmer » (or a manual link)
    does, as rules 34–38 say. Every remaining gap links to its fiche, where the operator fixes it; the
    state is recomputed on the next read, so a fixed fiche clears its gap with no further step.
    *(Revised 2026-10-23: the plugin first never wrote to a fiche.)*
21. A reconciliation survives later edits of the fiche: if the expected amount changes afterwards,
    the receipt moves to `amount_gap` instead of silently losing its reconciliation.
22. The home's « À traiter » shows one item « Écarts de règlement » with the count of receipts in
    `amount_gap`, `received_not_recorded`, `recorded_not_received`, `late` and `date_gap`, plus the
    count of credits « non rattachés ». No item when both are zero.

### 3.6 Settings

23. In the « Paiements en ligne » settings, a « Rapprochement bancaire » card: bank account (select),
    start date, platform recognition patterns (one editable list per platform of the `platforms`
    table), acquiring fee formula, Stripe card fee (rule 30). Saved through the plugin's generic
    settings.
24. Deleting the plugin's data (« Effacer aussi ses données ») drops the stored transactions and every
    reconciliation; the fiches are untouched (rule 20).

### 3.7 On the reservation fiche

25. The reservation fiche is the main place of the reconciliation. For an in-scope reservation, a
    « Rapprochement bancaire » card sits directly under the payments ledger, with one line per
    expected receipt, in the ledger's order and with the ledger's labels: the expected amount and
    date, the bank side (« Sur le compte le 12/11 · 596,58 € · BOOKING.COM … ») and the state badge
    of rule 19.
26. The card carries the same actions as the page, on the spot: « Confirmer » / « Écarter » a
    proposal (alternatives folded under it), « Rattacher un virement » (manual linking restricted to
    this reservation's receipts), « Défaire » a reconciliation. A gap's line says what to fix on the
    fiche in words (« Le virement fait 596,58 €, la fiche attend 610,02 € »), and fixing the fiche
    clears it on the next load (rule 20).
27. Out of scope (departure before the start date, cancelled) or Qonto not connected → no card. The
    card never delays the fiche: its data comes with `GET /api/reservations/:id` as a plugin block
    computed from the stored transactions only, never from a call to Qonto.
28. The « Rapprochement bancaire » page of « Suivi financier » stays the overview: every gap and
    proposal across reservations, and the only place for credits no fiche claims (« Non rattachés »,
    « Autres crédits »).

### 3.8 Calibration from the real account (2026-10-23)

29. **Default recognition patterns** (rule 14), matched case-insensitively on counterparty or
    reference:

    | Platform | Patterns |
    |---|---|
    | Booking | `booking.com` |
    | Airbnb | `airbnb` |
    | GitesDeFrance | `gites de france`, `gites de fr` |
    | Greengo | reference starting with `greengo` (a `… annul` reference is a cancellation compensation → « Autres crédits », §8) |
    | Abracadaroom | `mangopay` + `domainesolio` |
    | Abritel | `abritel` |
    | Lodgify | counterparty `stripe` with reference exactly `stripe` (rule 30) |

30. **Weekly card batch** (Lodgify via Stripe) — the credit is the week's card payments, each net of
    Stripe's fee. It is proposed against the Lodgify rows paid (or due) in the 10 days before
    `settled_at` by the smallest combination of up to 6 rows whose sum equals the credit, where a
    row counts for its recorded payout when the fiche has one and for its amount net of the card fee
    otherwise (setting, default 2,8 %), with 1 % of tolerance on the estimated part → **probable**;
    **sûr** when the combination is a single row with a recorded payout.
31. **Daily card batch on site** (`Paiements-En-Personne-<date>`) — proposed against the direct
    échéances recorded paid by card on that date, by combination of up to 6 → **probable**. The
    batch may include sales outside any reservation; the remainder stays unallocated and the credit
    is not a gap.
32. **Platform row without a recorded payout** — the expected bank amount is unknown (the ledger
    only has the gross). Such a row is proposed against a credit of its platform equal to the
    **gross**, or to the gross net of the platform's commission rate (`platforms`), ±1 % → always
    **à vérifier**, and the line says « Versement non saisi sur la fiche ».
33. When every expected receipt of the fiche is `reconciled`, the fiche card folds to one line
    « Tout est rapproché » with « Voir le détail »; any other state shows the full card (rule 25).

### 3.9 Confirming marks the fiche (2026-10-23)

34. **Confirming a reconciliation marks the échéance received on the fiche**, in the same step: the
    paid flag of the ledger row (`depositPaid`, `balancePaid`, …) and its date. The write goes through
    the core's own payment mark (the code behind « Marquer perçu », `PATCH /reservations/:id/payment`,
    reached through `reservationPaymentMark.applyPaymentMark`, which hands `updatePayment` a
    request-shaped object — the fiche's behaviour is untouched) with every guard it has: cancelled
    fiche, valid past date, contribution capture, history entry « Rapprochement bancaire ». A refusal
    of the core cancels the whole confirmation: no reconciliation is stored, and the core's status and
    code are returned. **Only an échéance the fiche does not yet mark received is written**: the core
    refuses to mark one twice (re-dating it would move its accounting entry), so a receipt already
    marked keeps its recorded date and amount, the reconciliation is stored without any write
    (`notWritten: already-received`), and its gap (`date_gap`, `amount_gap`) stays shown for the
    operator to fix on the fiche.
35. **Date** — the date written is the credit's `settled_at` (the latest one when several credits
    cover the échéance).
36. **Amount** — when the reconciled amount differs from the fiche:
    - platform stay whose fiche carries no payout yet: the credit **is** the payout — the fiche's
      payout (`platformPayoutAmount`) takes the bank amount and the commission is computed by the
      core's `computePlatformCommission` (gross − payout − tourist tax − acompte commission), as when
      the operator types the transfer in « Marquer reçu »; the receipt is then `reconciled`;
    - platform stay whose fiche already carries a payout, or a direct échéance (deposit, balance,
      complements): the amount is never changed; the échéance is marked received and stays in
      `amount_gap` until the operator fixes the fiche.
37. **Partial cover** — an échéance is marked received only once its reconciled credits reach its
    expected amount (one cent of tolerance per credit for an acquiring payout); before that the line
    says « 300,00 € sur 700,00 € reçus » (`partial`, listed under « Attendus ») and the fiche is
    untouched. The date is the credit that completed it.
38. **Défaire** (per credit) puts back what the confirmations of that credit wrote: each write stores
    the prior values it replaced (flag, date, payout, commission) and the values it wrote. The
    échéance is unmarked through the core mark, the payout and commission go back, a history entry
    says so. If the fiche was edited since (flag, date or payout no longer the written ones), the
    reconciliation is removed only and the call answers `untouched` — « Fiche modifiée depuis : à
    vérifier à la main ».
39. On the fiche, a confirmation with unsaved edits follows « Marquer perçu »: the fiche is saved
    first, or the action is refused on a locked fiche with « Enregistrer ou annuler les
    modifications avant de rapprocher ». After a write the fiche's finance section reloads.
40. A credit's day is read on Paris time: Qonto settles at a UTC instant (`22:30Z` is the next day in
    Paris), so `day()` of an instant is its Europe/Paris date; plain dates pass through. The matcher's
    windows, the date written on the fiche and the date-gap check all use it.
41. The matcher's ±1 cent tolerance applies to payment-link payouts only (net of the acquirer's
    rounding); every other channel must match to the cent, as the fiche write does. Confirmation
    refuses (`RECEIPT_ALREADY_COVERED`, 422) a link to an échéance other credits already cover. A
    refused unmark during « Défaire » drops its stored fiche write, so a later « Défaire » never acts
    on an unrelated state. The list payload carries `counts.todo` and each item's `allocatedCents`
    (the page sums nothing). « Défaire » on a deposit leaves the core's `depositAmountOverride`
    frozen at the deposit's value, as « Marquer perçu » does: it is not restored.
42. A read that reaches the page cap (60 pages) fails with an error and leaves `lastReadAt` untouched,
    so the next read starts again instead of skipping the oldest credits.
43. « Direct » is `isDirectChannel(platform)` (core module `platformNameFormat`), never a comparison with
    the string `direct`: a platform the operator marked « Compté comme vente directe » (the booking engine
    of the own website) has the guest's own échéances, no platform payout and no commission written.

**Edge cases:**
- Reservation cancelled after a payment was reconciled → leaves the scope; its reconciliations stay
  stored and its credits reappear as « non rattaché » so the refund question is visible.
- A fiche with no amount yet (platform reservation not entered: `finalPrice = 0`) → its platform row
  has no expected amount; a payout proposed by identifier is shown with « Fiche sans montant ».
- Two reservations with the same amount on the same platform in the window → both proposed as
  alternatives, confidence « à vérifier », never auto-picked.
- The unclaimed credits listed (« Non rattachés », « Autres crédits ») are those settled from 31 days
  before the start date: older credits still take part in the matching but are never listed.
- A card batch (« Paiements-En-Personne ») or an « … ANNUL » platform credit that no fiche claims is an
  « Autre crédit », never « Non rattaché » (rules 31 and §8).
- Credit in a currency other than EUR → listed under « Autres crédits », never proposed.
- The operator changes the bank account → stored transactions of the previous account are kept but
  no longer read; reconciliations on them stay.

---

## 4. Architecture

> Fat backend: matching, states and every amount are computed on the server; the page renders the
> payload as it comes.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `reservationPaymentMark.js` | C | `applyPaymentMark({ reservationId, body, user })` → `{ status, body }`: calls `updatePayment` with a request-shaped object and returns its answer, so the fiche and the plugin share one implementation (rule 34); re-exports `computePlatformCommission`. `reservationsController.js` is untouched. |
| `plugins/sdk/` | `index.js`, `coreModules.json`, `version.js` | T | Allow `reservationLedger`, `reservationPaymentMark` and `platformDisplay` in `CORE_MODULES` (reviewed allowlist); SDK 1.6.0 (new entry points); the plugin requires `^1.6.0`. |
| `constants/` | `plugins.js` | T | `PLUGIN_PAGES`: `/finance/rapprochement` belongs to `online-payment`. |
| `utils/qonto/` | `qontoClient.js` | T | `listTransactions` (paginated by `meta.next_page`, completed credits, newest first). |
| `plugins/online-payment/` | `index.js` | T | Migrations, the 8-hour read job, the attention item, mounts the reconciliation routes, `ctx.data` tables, `ctx.reservationBlock('reconciliation', …)` for the fiche (rule 27). |
| `plugins/online-payment/` | `settingsStore.js` | T | New settings: `reconciliationBankAccountId`, `reconciliationStartDate`, `reconciliationPlatformPatterns` (JSON), `reconciliationAcquiringFee` (JSON), `reconciliationCardFeePercent`, `reconciliationLastReadAt`, `reconciliationLastError`. |
| `plugins/online-payment/` | `manifest.json` | T | Version bump + French changelog line. |
| `plugins/online-payment/reconciliation/` | `index.js` | C | `mountReconciliation(ctx, { store })`: migration, routes, fiche block, 8-hour job, attention subject, erasure declaration. |
| `plugins/online-payment/reconciliation/` | `schema.js` | C | The plugin tables (§5), migration `reconciliation_v1`. |
| `plugins/online-payment/reconciliation/` | `routes.js`, `attention.js` | C | Thin routes under `/api/payments/reconciliation`; the home subject's summary (rule 22). |
| `plugins/online-payment/reconciliation/` | `bankTransactionsModel.js` | C | Upsert/list of the stored credits. |
| `plugins/online-payment/reconciliation/` | `reconciliationModel.js` | C | Reconciliation lines, discarded pairs, « Hors réservation » marks. |
| `plugins/online-payment/reconciliation/` | `transactionsReader.js` | C | Reads Qonto through `withQonto`, maps a Qonto transaction to the stored shape (rule 6). |
| `plugins/online-payment/reconciliation/` | `expectedReceipts.js` | C | In-scope reservations → expected receipts from the core ledger (rules 2, 8–10). |
| `plugins/online-payment/reconciliation/` | `matcher.js` | C | Pure: credits × receipts × decisions → proposals with confidence (rules 11–17). |
| `plugins/online-payment/reconciliation/` | `receiptStates.js` | C | Pure: state of each receipt (rule 19) and the counts of rule 22. |
| `plugins/online-payment/reconciliation/` | `ficheWriter.js` | C | Rules 34–38: builds the mark patch (date, payout), calls `applyPaymentMark`, stores the prior/written values, restores them on « Défaire ». |
| `plugins/online-payment/reconciliation/` | `controller.js` | C | Orchestrates read → expected → match → states, shapes the page payload, validates writes, runs link + fiche write in one transaction. |
| `server/scripts/` | `bank-transactions-from-qonto-csv.js` | C | Recette tool: loads a Qonto CSV export into the stored credits of a shadow base (§7). |

No core table changes (plugin rule 6); the plugin writes to `reservations` only through the core's mark (rule 34). No change to `scheduledTasks.js` (the job is a plugin job).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/online-payment/` | `index.js` | T | Route `/finance/rapprochement`, `finance.menu` entry « Rapprochement bancaire » (order 60), `reservation.cards` contribution. |
| `plugins/online-payment/` | `ReconciliationAlert.jsx` | C | The home's « Écarts de règlement » content (`dashboard.alerts`, key `bank-reconciliation`, rule 22). |
| `plugins/online-payment/` | `ReservationReconciliationCard.jsx` | C | The fiche's card (rules 25–27), rendered from `pluginBlocks.reconciliation`. |
| `plugins/online-payment/` | `ReconciliationLine.jsx` | C | One receipt line (expected · bank · state · actions), shared by the card and the page so both read the same. |
| `plugins/online-payment/` | `ReconciliationPage.jsx` | C | The page: action bar, counters, tabs, rows (table on `md+`, cards on `xs`). |
| `plugins/online-payment/` | `LinkTransactionDialog.jsx` | C | Manual linking of a credit to reservations + allocated amounts. |
| `plugins/online-payment/` | `ReconciliationSettingsCard.jsx` | C | The settings card of rule 23. |
| `plugins/online-payment/` | `PaymentsSettingsPage.jsx` | T | Renders the card under the Qonto connection. |
| `constants/` | `plugins.js` | T | Route owned by the plugin (`ROUTE_PLUGINS`). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `StatusBadge`, `EmptyState`, `ErrorAlert`, `LoadingState`, `FormDialog`, `ConfirmDialog`, `TableCard`, `PlatformChip`, `AttentionCard` | Through `plugins/sdk`. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `ReconciliationPage`, `ReservationReconciliationCard`, `ReconciliationLine`, `LinkTransactionDialog`, `ReconciliationSettingsCard` | Tied to the reconciliation payload. |

### 4.3 API contract

All routes: role `admin`, 404 `PLUGIN_INACTIVE` when the plugin is off, 409 `QONTO_NOT_CONNECTED`
when Qonto is not connected.

| Method | Endpoint | Request body | Response |
|---|---|---|---|
| GET | `/api/payments/reconciliation?view=todo\|done\|waiting\|other` | — | `{ lastReadAt, lastError, startDate, counts: { gaps, proposed, unmatched, reconciled, waiting, other }, items: [...] }` — each item ready to render: reservation (id, client, property, dates, platform), receipt (label, expected amount + date, recorded state), bank side (transactions with amount, date, label), `state`, `stateLabel`, `tone`, `confidence`, `alternatives`, `actions`. |
| POST | `/api/payments/reconciliation/read` | — | Same payload after a read of Qonto. 429 `READ_TOO_SOON` under 60 s since the last read. |
| POST | `/api/payments/reconciliation/links` | `{ transactionId, allocations: [{ reservationId, ledgerKey, amount, expectedAmountCents }] }` | 201 `{ ok: true, marked: [{ reservationId, ledgerKey, date }] }`. 422 `ALLOCATION_EXCEEDS_TRANSACTION`, `RESERVATION_OUT_OF_SCOPE`, `UNKNOWN_RECEIPT`; the core mark's refusals pass through with their status and code (`AMOUNT_CHANGED`, cancelled fiche…), nothing stored (rule 34). |
| DELETE | `/api/payments/reconciliation/links/:transactionId` | — | Undoes every line of that transaction and restores the fiches (rule 38): `{ ok: true, restored: [...], untouched: [...] }`. |
| POST | `/api/payments/reconciliation/discards` | `{ transactionId, reservationId, ledgerKey }` | 201. |
| POST / DELETE | `/api/payments/reconciliation/transactions/:id/outside` | — | Marks / unmarks « Hors réservation ». |
| GET | `/api/payments/reconciliation/candidates?transactionId=&q=` | — | In-scope reservations and their open receipts for the manual dialog. |
| GET | `/api/payments/reconciliation/bank-accounts` | — | `[{ id, name, main }]` (no IBAN). |
| GET | `/api/reservations/:id` (core, unchanged) | — | Gains `pluginBlocks.reconciliation = { lines: [...same item shape as the page...], unclaimedCount }` for an in-scope reservation, absent otherwise (rule 27). |

---

## 5. Data model

Plugin-owned tables, created by `ctx.migrations` (`plugin:online-payment:reconciliation_v1`):

```sql
CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,                 -- Qonto transaction id (or csv:<hash> for the recette tool)
  bankAccountId TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  settledAt TEXT, emittedAt TEXT, updatedAt TEXT,
  operationType TEXT, label TEXT, counterpartyName TEXT, reference TEXT, note TEXT,
  source TEXT NOT NULL DEFAULT 'qonto', -- qonto | csv
  fetchedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_reconciliation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transactionId TEXT NOT NULL, reservationId INTEGER NOT NULL, ledgerKey TEXT NOT NULL,
  amountCents INTEGER NOT NULL, createdAt TEXT NOT NULL, createdBy INTEGER
);
CREATE TABLE IF NOT EXISTS bank_reconciliation_fiche_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL, ledgerKey TEXT NOT NULL,
  transactionIds TEXT NOT NULL,        -- JSON array, the credits that completed the échéance
  priorJson TEXT NOT NULL,             -- fields replaced (flag, date, payout, commission) — rule 38
  writtenJson TEXT NOT NULL,           -- what the reconciliation wrote, to detect later edits
  createdAt TEXT NOT NULL, createdBy INTEGER
);
CREATE TABLE IF NOT EXISTS bank_reconciliation_discards (
  transactionId TEXT NOT NULL, reservationId INTEGER NOT NULL, ledgerKey TEXT NOT NULL,
  createdAt TEXT NOT NULL, PRIMARY KEY (transactionId, reservationId, ledgerKey)
);
CREATE TABLE IF NOT EXISTS bank_transactions_outside (
  transactionId TEXT PRIMARY KEY, createdAt TEXT NOT NULL, createdBy INTEGER
);
```

**Data impact:** new tables only, no core column. A confirmation writes the échéance's paid flag,
date and, for a platform row, payout and commission, through the core's mark (rules 34–36).

## 6. UI / UX

The interactive mock-up of the summary page is the reference
(`docs/specs/2026-10-23-qonto-bank-reconciliation.html`; its fiche examples follow rules 34–38).

- **Reservation fiche (main place, rules 25–27):** card « Rapprochement bancaire » right under the
  payments ledger. One line per receipt: label · « Attendu » amount and date · « Sur le compte »
  amount, date and credit label · state badge · actions. On `xs` each line stacks (expected, bank,
  badge, actions full width).
- **Menu:** Suivi financier → « Rapprochement bancaire » (overview, rule 28).
- **`PageActionBar`:** title « Rapprochement bancaire », subtitle « Lu le 22/10 à 14:05 » (or the
  failure in `error` tone); actions before: « Actualiser » (sync icon, `info`). No Save/Cancel.
- **Counters** (clickable, they switch the tab): Écarts · À confirmer · Non rattachés · Rapprochés.
- **Tabs:** « À traiter » (gaps, then proposals, then unmatched credits) · « Rapprochés » ·
  « Attendus » · « Autres crédits ».
- **Row:** client + property + stay dates, platform chip, échéance label; left « Attendu » amount and
  date; right « Sur le compte » amount, date, label of the credit; state badge; actions:
  « Confirmer » / « Écarter » on a proposal, « Ouvrir la fiche » on a gap, « Rattacher » /
  « Hors réservation » on a credit, « Défaire » on a reconciliation. Alternatives fold under the row.
- **Empty states:** « Rien à traiter » on « À traiter »; « Qonto n'est pas connecté » with a link to
  the settings when disconnected.
- **Responsive:** `md+` table inside `TableCard`; `xs` one card per row (expected and bank stacked,
  actions full width), counters on two lines, `LinkTransactionDialog` full screen.

## 7. Test plan

### Server unit tests (`server/src/plugins/online-payment/tests/`)
- [ ] `reconciliation-matcher.unit.test.js` — rules 11–17 (identifier, platform single and batch,
      acquiring payout with fees, direct with/without name, competing proposals, discarded pairs).
- [ ] `reconciliation-receipt-states.unit.test.js` — rule 19 table, priorities, rule 21.
- [ ] `reconciliation-expected-receipts.unit.test.js` — rules 2, 8–10 on a real schema (cash and
      caisse interne excluded, paiement unique, platform net).
- [ ] `reconciliation-transactions-reader.unit.test.js` — rules 5–7 with a fake `fetchImpl`
      (pagination, incremental window, IBAN never stored, failure keeps data).
- [ ] `reconciliation-controller.unit.test.js` — API contract, validation errors, rule 20 (a proposal
      never writes), rule 22 counts, rule 24 purge.
- [ ] `reconciliation-fiche-writer.unit.test.js` — rules 34–38 on a real schema: flag + bank date
      written, date replaced, platform payout corrected and commission recomputed, direct amount
      untouched, partial cover writes nothing, core refusal stores nothing, « Défaire » restores the
      prior values, edited-since leaves the fiche alone.
- [ ] `reservation-payment-mark.unit.test.js` — the extracted mark answers as `updatePayment` did
      (fiche regression).
- [ ] `bank-transactions-from-qonto-csv.unit.test.js` — the recette tool's CSV mapping.

### Client tests
- [ ] `client/src/plugins/online-payment/__tests__/ReconciliationPage.test.jsx` — renders states,
      confirm/discard calls, mobile cards.
- [ ] `client/src/plugins/online-payment/__tests__/ReservationReconciliationCard.test.jsx` — rules
      25–27: lines in ledger order, actions on the spot, no card without the block.
- [ ] Server: `reconciliation-reservation-block.unit.test.js` — rule 27 (in scope only, no Qonto
      call while building the block).

### Recette on real data (shadow)
- [ ] Fresh production snapshot (procedure of `copy-prod-db-to-dev`, secrets purged), real Qonto CSV
      export loaded with the recette tool, shadow on `:4103`.
- [ ] Every in-scope reservation of the snapshot reviewed: each proposal checked by hand against the
      platform extranets; the false positives and misses written in a report
      `docs/rapports/2026-10-xx-bank-reconciliation-recette.html`.
- [ ] `GET /v2/transactions` itself checked in the Qonto sandbox (shape, pagination).

### Manual UI verification
- [ ] Happy path: confirm a platform payout proposal → the ledger row shows « reçu le <bank date> »
      with the bank amount; « Défaire » puts it back.
- [ ] A direct échéance with a different amount: marked received, the gap stays until the fiche is
      fixed.
- [ ] Edge case: manual link of one credit to two reservations.
- [ ] Mobile (≤600 px): cards, dialog full screen, no horizontal scroll.
- [ ] Regression: payment links, payment poll and the Qonto settings page unchanged.

## 8. Out of scope

- Changing a direct échéance's amount, or any write without the operator's confirmation.
- Debits: refunds to guests, platform chargebacks, Qonto fees.
- Cancellation compensations and cancelled reservations' money.
- Banks other than Qonto, and a CSV import as a product feature (the CSV loader is a recette tool).
- Reservations whose departure is before the start date.
- The Qonto transactions webhook (polling is enough at this volume).

## 9. Open questions

- Q1: Platform payouts — **resolved 2026-10-23** on the real export (§1 table): one credit per
  reservation except occasional pairs (Booking, Abracadaroom) and the Lodgify weekly Stripe batch;
  no booking number in any credit → rules 29–32.
- Q2: How does a payment-link payment arrive (`card_acquirer_payout`? counterparty « Mollie »?
  aggregated? exact fee)? → **still open**: no real link payment has reached the account. Rule 15
  ships with its default and is re-measured on the first real link payout.
- Q3: Direct transfers — **resolved 2026-10-23**: they carry the payer's name (sometimes a spouse's),
  never the quote number; the reference is free text (« Acompte réservation … », stay dates).
- Q4: In-scope reservations — **resolved 2026-10-22**: departure ≥ start date, kept until reconciled
  (Adrien, « Départ après la mise en service »).
- Q5: Placement — **resolved 2026-10-22**: inside the `online-payment` plugin, reusing its Qonto
  connection (Adrien).
- Q9: Confirmation writes to the fiche — **resolved 2026-10-23**, replaces Q6's « fiches never
  modified »: confirming marks the échéance received at the bank date, corrects a platform payout to
  the bank amount, waits for full cover, and « Défaire » restores the fiche (rules 34–39) (Adrien).
- Q6: Action level — **resolved 2026-10-22, revised by Q9**: detection + manual reconciliation, fiches never
  modified (Adrien).
- Q8: Placement in the UI — **resolved 2026-10-22**: on the reservation fiche first, with the
  « Suivi financier » page as overview and home of unclaimed credits (Adrien).
- A1: Fully reconciled fiche — **resolved 2026-10-23**: the card folds to one line (rule 33) (Adrien).
- A2: On-site card batches — **resolved 2026-10-23**: in scope, the unallocated remainder is never a
  gap (rule 31) (Adrien).
- Q7: Recette — **resolved 2026-10-22**: real Qonto CSV export + fresh production copy in a shadow;
  no OAuth connection of the shadow to the real account (Adrien).

## 10. Implementation progress

- [x] Server: Qonto client `listTransactions`, tables, reader, expected receipts, matcher, states, fiche
      writer, controller, routes, 8-hour job, home subject, fiche block, erasure, settings, manifest
      1.2.0, SDK 1.6.0, `reservationPaymentMark`, recette CSV tool.
- [x] Server tests: `reconciliation-matcher` (16), `reconciliation-receipt-states` (10),
      `reconciliation-transactions-reader` (6), `reconciliation-expected-receipts` (8),
      `reconciliation-controller` (17), `reconciliation-settings` (4), `reservation-payment-mark` (3),
      `bank-transactions-from-qonto-csv` (4); four core tests updated (SDK 1.6.0, job list, page owner).
- [x] Client (card, page, dialog, settings card, home alert) and its tests: `ReconciliationPage.test.jsx` (6), `ReservationReconciliationCard.test.jsx` (8); whole client suite 2053 passing. The card sits at `reservation.cards` order 5, right under the Finance card; the dialog and settings card follow the MUI v9 `slotProps` API.
- [x] Recette on the shadow `:4103` (production copy of 2026-10-22, secrets purged, no credentials and a dead Qonto base URL so nothing can leave; real CSV export of 114 credits; start date set back to 2026-01-01 to exercise the history): 58 expected receipts, 39 proposed (most « sûr », to the cent), 11 gaps, 15 unmatched credits, 26 other credits. Browser run on desktop and 390 px: confirm → the fiche is marked received at the bank date and its ledger reads « Tout est perçu », « Défaire » → proposed again; manual link refuses an over-allocation. The detailed report holds real names and amounts, so it stays in the private shadow folder, not in this public repository.
- [ ] To redo on the first real payment-link payout (Q2) and with the live Qonto connection after the release.
