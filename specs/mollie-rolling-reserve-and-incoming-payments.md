# Mollie rolling reserve, incoming payments and their reconciliation

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/mollie-rolling-reserve` |
| **Created** | 2026-11-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary page** | `docs/specs/2026-11-16-mollie-rolling-reserve.html` |
| **Extends** | [qonto-bank-reconciliation.md](qonto-bank-reconciliation.md) (rule 15 replaced), [reconciliation-assisted-matching.md](reconciliation-assisted-matching.md), [reservation-payment-ledger.md](reservation-payment-ledger.md), [direct-installments.md](direct-installments.md), [finance-dashboard-redesign.md](finance-dashboard-redesign.md), [accountant-accounting-export.md](accountant-accounting-export.md) |

---

## 1. Context

A guest who pays by card pays either through a Qonto payment link or with the Qonto app (an invoice paid by
card, **Tap to Pay** on site); both are acquired by **Mollie** (confirmed by Adrien 2026-11-16). Mollie applies a **rolling reserve** to this merchant: it keeps **20 % of each payment for
90 days** and pays it out afterwards. One card payment therefore reaches the Qonto account in **two
credits, three months apart**.

Measured on the real Qonto export of 2026-10-23 (the only Mollie credits of the account so far):

| Bank date | Counterparty | Reference | Amount | Reading |
|---|---|---|---|---|
| 2025-12-23 | `Stichting Mollie Payments` | `REF T19274230.2512.01` | 157,44 € | 80 % of 196,80 € |
| 2026-03-23 | `Stichting Mollie Payments` | `REF T19274230.2603.01` | 39,36 € | 20 % of 196,80 €, **90 days later to the day** |
| 2026-11 | `Stichting Mollie Payments` | `REF T19274230.2611.01` | 11,20 € | 80 % of a 14,00 € card payment of Qonto invoice `F-2026-013` of 2026-11-05 (client Gruat) |

The Gruat payment as Mollie shows it: description `F-2026-013` (the Qonto invoice number; Qonto files it
as `2610-F-2026-013-SOLIO.pdf`), id `tr_…`, paid 05/11 17:10, **available balance 09/11 17:10**
(4 days), fees **0,446 € = 1,4 % + 0,25 €**.

Four facts follow, and the current code ignores them:

- **The 80 % share is not net of fees**: 157,44 + 39,36 = 196,80 exactly, and 11,20 = 80 % of 14,00
  exactly although the Gruat payment bore 0,446 € of fees. The 2025 pair belongs to the 1 000 € Mollie
  offered without commission at the start. Where Mollie takes its fees is measured (2026-11-16, Q5): **inside
  the settlement**, as cost lines, and every one so far is cancelled by a « Fee Discount » cost line (the first
  1 000 € processed carry no commission, ~943 € used). The reconciliation's rule 15 assumed a single payout net
  of fees and would never match a real Mollie credit.
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

**Measured on the live account with an organisation-level token, 2026-11-16** (settlements, balance transactions,
Qonto bank dates), which settled the assumptions above:

| Settlement (`stl_…`) | Reference (Mollie) | Settled | Amount | Periods (revenue / costs) |
|---|---|---|---|---|
| 1 | `19274230.2611.01` | 2026-11-10 | 11,20 € | card 14,00 · « Rolling Reserve Reservation » −2,80 · card cost 0,446 · « Fee Discount » −0,446 · « Rounding differences » 0 |
| 2 | `19274230.2610.01` | 2026-10-29 | 585,92 € | card 732,40 · reservation −146,48 · card cost 11,236 (1,5 % + 0,25 €, Visa debit) · « Fee Discount » −11,236 |
| 3 | `19274230.2603.01` | 2026-03-23 | 39,36 € | « Rolling Reserve Release » +39,36 (period 2025-12), **released alone** in its settlement |
| 4 | `19274230.2512.01` | 2025-12-23 | 157,44 € | card 196,80 · reservation −39,36 · card cost 3,0052 · « Fee Discount » −3,0052 |

- **Reference.** Qonto prints `REF T19274230.2611.01`; Mollie's settlement reference is `19274230.2611.01`: « REF » and
  the leading « T » are stripped before the lookup (both forms are the same settlement).
- **A settlement's amount = Σ revenue − Σ costs.** The reserve lines are told by their **description**
  (`Rolling Reserve Reservation` negative = hold, `Rolling Reserve Release` positive = release); their `method` is null.
  Fees are the settlement's costs: the card cost lines, minus « Fee Discount », plus « Rounding differences ».
- **Balance transactions** (`GET /v2/balances/primary/transactions`) are exact, per payment: a `payment` transaction
  (`resultAmount` = the immediate share, `initialAmount` = the gross, `deductions` = the reserve held plus the fees,
  `context.paymentId`), an `api-payment-rolling-reserve-release` transaction that **carries the payment id** of the reserve
  it frees, and an `outgoing-transfer` carrying `context.settlementId`. The transactions between two outgoing transfers
  are exactly what that settlement — hence that Qonto credit — contains. A `payment` appears when the money becomes
  available (paid 26/10 → 28/10; 05/11 → 09/11; 18/12 → 22/12).
- **Bank dates**: the Qonto credit is the outgoing transfer, the same morning; paid 2025-12-18 → 80 % on 2025-12-23 and the
  20 % on 2026-03-23 (immediate bank date + 90 days, to the day; the release transaction itself was created 2026-03-20).
- `GET /v2/balances/primary`: `transferFrequency` daily, `transferThreshold` 5,00 €, `pendingAmount` 149,28 € (the
  146,48 + 2,80 reserves still held), `availableAmount` 0.

Mollie API facts (docs.mollie.com, read 2026-11-16): `GET /v2/settlements/{id|reference}` (reference
lookup supported), `GET /v2/settlements/{id}/payments` (ids `tr_…`, amount, description, paidAt),
settlement `periods.<year>.<month>.revenue|costs[]` with a `rollingreserve` method (in practice the reserve lines are told by their description, above); balance transactions
with rolling-reserve types whose link to a payment is not documented but **measured** (the release carries `context.paymentId`). These endpoints need an
**advanced access token** (Mollie dashboard → Développeurs → Jetons d'accès, admin only) with scopes
`settlements.read`, `payments.read`, `balances.read`; a plain `live_` API key is not documented to work.

## 2. Goal

The operator sees, on the fiche and in Suivi financier, every sum still to arrive on the bank account —
Mollie's immediate share in transit, Mollie's 20 % held for 90 days, the instalments of a payment plan,
the platform payouts — with its expected date, then its real date and the exact Qonto transaction that
brought it; and the accountant receives entries that explain every Mollie credit.

## 3. Functional rules

### 3.1 The split of a card payment

1. **Every Mollie payment is split in two bank tranches** — a paid payment link, a **Qonto invoice paid by
   card**, and a card payment recorded on site (tender « CB » on a fiche échéance, a mid-stay note or a
   standalone sale; confirmed by Adrien 2026-11-16: the Qonto app's card payments go through Mollie and bear the
   same 20 % / 90-day reserve). Each is split into the **versement immédiat** (gross − reserve) and the
   **retenue** (the reserve). `reserve = round(gross × rate)` to the cent, the immediate share
   absorbs the rounding. The split is computed by the server once, when the payment is seen paid, and stored
   with the rate and hold it used. Until that stored split exists, every READ (the fiche, « Versements à venir »,
   the reconciliation pass, the journal) derives a **provisional** one in memory — same formula, the settings in
   force now, never stored — so a link that turned paid without a `reservation.paid` event (a complement link
   ended `noop`, a basket link, a double payment, a card taken on site) shows its tranches at once; a read never
   writes, and the stored split is made by the event, the read job, « Actualiser » or the page that lists the
   reconciliation. A paid link the ledger has no row for can never have a split and never triggers a sync. A split belongs to a **source** (`sourceType` + `sourceKey`):
   - `link` — a paid payment link (key: the link id);
   - `invoice` — a sale outside a stay that holds a Qonto invoice number (key: the number). When a Mollie payment
     read with the token has that number as its `description`, the split is made from the Mollie payment
     itself — **gross and date exact** (rule 16); a split already made from the on-site tender (below) is
     corrected to it, with the rate and the hold it carries;
   - `tender` — a card (« CB », tender `card`) payment recorded on a fiche échéance paid without a link, on the
     CB line of a split payment (one split per settlement: its cheque and transfer lines stay one receipt), or on
     a sale outside a stay that has no invoice. It is split only from the day of the plugin setting
     **« CB sur place via Mollie depuis »** (`mollieCardOnSiteSince`; empty = off; validated like rule 3's date).
     Without a Mollie token this is how such payments are split; before that day, or with the setting empty, a
     card payment is unchanged and expected in the day's « Paiements-En-Personne » batch
     (qonto-bank-reconciliation rule 31). From that day a card payment of these sources expects Mollie tranches
     **instead of** a batch share, and a sale that went through Mollie is no longer counted in the batch's
     « hors séjour » part.
2. Rate and hold are settings of the `online-payment` plugin: **« Retenue Mollie » 20 %** and
   **« Durée de la retenue » 90 jours**, plus **« Retenue appliquée depuis »** (date, default: the
   reconciliation start date). A link paid before that date has no reserve (one tranche, 100 %). A rate
   of 0 disables the reserve. Changing a **setting** never moves a split already stored (rule 1); the
   settings card says so under the fields. This is about settings, not about the data: a card payment recorded on site
   is an estimate until Mollie's own payment is read, so while no Mollie payment is attached it follows the amount and
   the day the fiche or the sale carries now, and it disappears with that card payment (unless a bank line rests on it);
   a link's split, and any split a Mollie payment is attached to, is never corrected from the data.
3. **Validation (server, authoritative)** — rate: a number from 0 to 50 with at most 2 decimals; hold: a
   whole number of days from 1 to 365; « depuis »: a valid date not in the future. A refused value keeps
   the stored one and returns the reason in French (« Le taux doit être compris entre 0 et 50 % »,
   « La durée est un nombre de jours entre 1 et 365 »).
4. **Expected dates** — immediate tranche: `paidAt` + 4 days (Mollie's « en solde disponible »,
   measured on Gruat; window [0, +8]); retenue: the immediate tranche's **bank date** + hold when it is
   reconciled, else `paidAt` + 4 + hold (window [−3, +10]). The measured release came 90 days after the
   immediate credit to the day. A tranche is **late** (`en retard`) once its window has passed without a credit — **whether or not a proposal waits for the operator's click**: the reconciliation item (`mollie.late`, `mollie.daysLate` = days since the expected date), the payments ledger (« en retard de N j ») and « Versements à venir » (« En retard de N j ») read the same definition (`trancheDaysLate`). **The reserve itself is read from Mollie** (2026-11-16): the hold Mollie applied to a payment
   (its balance transaction's `deductions`, minus the fees of the settlement) replaces the stored `round(gross × rate)` when
   they differ — the immediate share absorbs the difference; with several payments in one settlement and some cost, the
   split is left as stored.
5. **Fees are Mollie's, never a fiche's gap.** They are **read from Mollie**: a settlement's fees are its cost lines
   (card cost − « Fee Discount » + « Rounding differences », rule 16). **Today « Fee Discount » cancels every fee**
   (measured on the four settlements), so a settlement read from Mollie yields **0 € of fees**, and a tranche is
   reconciled for exactly its amount. The formula stays a setting, default **1,4 % + 0,25 €**, and is only the
   **estimate** for a payment whose settlement was not read (no token): then a Mollie credit lower than its tranches by at
   most the estimated fees of its payments is proposed with « frais Mollie estimés : x € » (resolved Q5). The tranches are
   computed on the gross (rule 1). Only the **immediate** share bears fees (real or estimated): a reserve release is paid whole, its tolerance is 0. When fees do apply, a payment alone in its settlement bears them
   (`deductions − reserve`); with several payments and some cost, which one bore it is unknown and the estimate stays.
6. A **refund** of a link (if any) reduces the immediate tranche first, then the retenue; a fully
   refunded link has no tranche left to expect. A **chargeback** is out of scope (§8).
7. A link split into tranches stays **one échéance on the fiche**, paid at the guest's payment date, as
   today. The tranches never change what the guest owes, the fiche's paid flags, the encaissement date of
   the sales journal or any finance figure based on `*PaidDate`.

### 3.2 Reconciliation (extends qonto-bank-reconciliation)

8. A paid link — and any other source of rule 1 — yields **two expected receipts** instead of one, keyed
   `<ledgerKey>#immediat` and `<ledgerKey>#retenue` (a sale outside a stay: ledger key `sale:<sale key>`, reservation
   id `0` in the stored lines, `reservation.id` null in the payload; the CB line of a split payment:
   `settlement-<id>-card`), each with its amount and window (rule 4). Existing reconciliation lines on the
   bare `<ledgerKey>` of a link are migrated to `#immediat` (§5, idempotent, nothing lost). A `complement` link is split on the row the
   ledger draws it on — `complement`, or `checkoutComplement` once the complement is deferred to the check-out (the link is typed
   `complement` either way). A **basket link** (`basket-<id>`, a guest order) is split and reconciled like any other, but no row of the
   payments ledger carries it: its tranches count in the fiche's recap line (rule 19) and on the reconciliation page, with no
   `bankTranches[]` line. On the reconciliation page the **reserve of a paid link is a future receipt like any other**: it is listed
   with its waiting state (« Attendu ») under « Attendus », and moves to « À traiter » only once it is a gap, a proposal or late;
   the fiche's card lists both tranches. Confirming **and
   discarding** a proposal of such a sale name it by reservation id `0` (a discard of id 0 is accepted when a receipt
   `0|<ledgerKey>` exists, else 404; the client sends `0` for a null `reservation.id`).
9. **Rule 15 is replaced.** A credit classified Mollie (counterparty or label contains « mollie »,
   whatever the operation type) is matched against the open link tranches — immediate and retenue alike —
   by the smallest combination (≤ 8 tranches) whose sum equals the credit to the cent, or equals it less
    the estimated fees of those payments (rule 5). One tranche →
   **sûr**; several → **probable**; nothing exact → no proposal, the credit stays « non rattaché ». By amount alone a credit never
   takes an immediate share past its window (expected date + `lateAfterDays`) nor a reserve before its window opens; the exact
   composition of rule 10 knows no date window. **When a settlement read from Mollie exists for the credit and its composition does not
   match the open tranches** (a payment unknown to GuestFlow, a tranche not open), the amount path is only a coincidence to look at: its
   proposals are capped at **probable**, never « sûr », never confirmed automatically. A platform that pays through Mollie (Mollie
   Connect) stays a platform: the platform patterns are read before the Mollie name.
10. **With a Mollie connection (§3.3), the settlement decides, and the balance transactions say exactly what it paid.**
    The credit's reference is looked up as a settlement (rule 16). The **balance transactions** between the previous
    `outgoing-transfer` and the one naming the settlement are its composition: each `payment` is the **immediate tranche**
    of `context.paymentId` for its `resultAmount`, each `api-payment-rolling-reserve-release` is the **reserve tranche** of
    `context.paymentId`. Every tranche is allocated to the cent, so the proposal is **sûr even when grouped** (several
    payments, a release of an older one, a release alone). A settlement whose composition is not available (the token
    cannot read balances) falls back on the settlement's payments list plus the released reserve it declares; a payment
    unknown to GuestFlow leaves the known part **probable** (as do reserves freed in a settlement whose released sum several sets of open
    reserves can make) and shows « 1 paiement Mollie inconnu de GuestFlow »; a
    composition that does not add up to the credit falls back to rule 9.
11. Confirming a Mollie credit never writes the fiche (the échéance is already paid by the webhook,
    rule 7): it stores the reconciliation lines only. « Défaire » removes them.
12. Every reconciled tranche shows **the identifiers of the bank credit**: the Qonto transaction reference
    (`transaction_id`, e.g. `solio-6791-1-transaction-019d1b2f-…`, shortened in the middle with a copy
    button), the Mollie settlement reference (`T19274230.2603.01`) and, when known, the Mollie payment id
    (`tr_…`). The Qonto `transaction_id` is now stored (§5); it is the identifier Qonto's own search
    and exports show.
13. A retenue whose window has passed without a matching credit is **en retard** and raises one attention
    item « Retenue Mollie non reçue » on the home page (one per fiche, with the **oldest** expected date of its late reserves). The server
    builds the whole line (`items[].line`: « Jean Dupont · 146,48 € · attendue le 24/01 ») and serves it on
    `GET /api/payments/reconciliation/reserve-attention` as well as in the attention payload.

### 3.3 Mollie connection (optional)

14. The `online-payment` plugin gets an optional **« Compte Mollie »** card under the Qonto connection:
    an **advanced access token** (Mollie: Développeurs → Clés API → « + Créer une clé API », type « Jeton
    d'accès avancé », **no profile restriction** (settlements, balances and invoices refuse a
    profile-restricted token — measured), mode « En direct », read-only
    authorisations (named in English in the dashboard): `payments.read`, `settlements.read`,
    `balances.read`, `balance-reports.read`, `invoices.read`, `refunds.read`, `profiles.read`, `organizations.read`, never a `.write` — and **request signing
    off**; the card's help text repeats these steps) (stored encrypted, `ENCRYPTED_COLUMNS`-equivalent plugin secret), a profile id
    when the token is organisation-level, a « Tester » button and the last read. The card also shows
    **what Mollie still holds**: the `pendingAmount` of the primary balance (« Encore chez Mollie : 149,28 € »), read with
    the settlements (plugin setting `mollieBalance`, written by the reader only; `status().balance`). Without a token,
    everything works by amounts (rule 9); the card says what the token adds (« les versements groupés sont
    détaillés paiement par paiement »).
15. A token that does not start with `access_` is refused before any call (« Ce n'est pas un jeton
    d'accès Mollie : il commence par access_ »). « Tester » calls `GET /v2/settlements?limit=1` and reports
    the cause in words when Mollie answers 401/403 — a profile-restricted token gets « Ce jeton est limité
    à un profil : le recréer sans restriction de profil pour lire les règlements ».
16. The plugin reads, at each reconciliation read (8 h) and on demand: the settlements referenced by the
    stored Mollie credits not yet detailed. The reference is **normalised** before the lookup (`REF ` and a leading `T`
    stripped: Qonto `REF T19274230.2611.01` ↔ Mollie `19274230.2611.01`, both forms accepted). Per settlement: its
    `periods` revenue/costs (the reserve lines by description, the fees as signed cost lines, rule 5) and, as the primary
    source of its composition, the **balance transactions** (`GET /v2/balances/primary/transactions`, read newest first and
    stored incrementally in `mollie_balance_transactions`: a re-read stops at the first page that holds a known id); the
    settlement's `/payments` list is the fallback when balances cannot be read. Read-only; nothing is ever written to
    Mollie. Each Mollie payment `tr_…` (a reserve release carries it too) is attached to GuestFlow, first match wins
    (measured, §1): its `description` equals a payment link's `providerPaymentId` (the Qonto payment id); its
    `metadata.payment_link_id` equals a link's `providerLinkId`; its `description` equals a Qonto invoice number GuestFlow
    stores (a sale outside a stay — hourly-resource bookings — whatever tender was typed: the Mollie payment is the proof of
    the card), which creates or corrects the `invoice` split of rule 1; else amount + `paidAt` within 10 minutes, unique
    match only; a payment already attached to a split is not asked again. The hold Mollie really applied corrects the split
    (rule 4). With an organisation-level token the payments are listed with the profile id (setting, filled by « Tester »
    from `profiles.read`).
17. A Mollie failure never blocks the reconciliation: the last read stays, the error is shown in words
    on the card, rule 9 applies. **One reference failing never stops the others** (not a settlement: 404, a body that does not parse, a
    transient refusal): it is kept in `mollie_settlement_failures` with a 24-hour delay before it is asked again, the loop goes on, and
    `lastError` says how many settlements could not be read (only a refused token, 401, ends the pass). A stored settlement holding a
    payment GuestFlow could not name — or composed from the payments list only — is read again (at most 5 per pass, at least an hour after
    the previous read), so a sale typed afterwards gets paired; the refunds of the payments whose reserve is still held are refreshed
    (at most 10 per pass). Costs are summed as Mollie writes them and rounded once. The token goes only to Mollie's own origin: a
    `_links.next` pointing elsewhere is not followed; « Tester » with a token typed but not saved never stores the profile it found.

### 3.4 On the fiche

18. **In the payments ledger, a paid link shows its tranches the way an instalment plan shows its
    instalments**: one dated line per tranche, under the échéance, with amount, label and state —
    « Versement immédiat · 585,92 € · reçu le 28/10 » / « Retenue Mollie 20 % · 146,48 € · prévue vers le
    24/01/2027 ». The percentage is what was kept of the payment (`reserveCents / grossCents`, so Mollie's real hold prints as it was),
    never the setting — likewise « Paiement carte · 80 % » and « Retenue Mollie 20 % » of rule 22. States: `en transit`, `reçu le …`,
    `retenue jusqu'au …`, `en retard de N j`. The lines are
    built by the server (ledger row `bankTranches[]`, contributed by the plugin) and drawn by the same
    component as the instalment lines.
19. The **reservation summary** (top of the fiche, the money recap) shows the same split as a schedule:
    one segment per kind of tranche — « Payé par carte 732,40 € — 585,92 € attendus le 30/10 · 146,48 € retenus jusqu'au 28/01/2027 »,
    then « 585,92 € reçus · 146,48 € retenus jusqu'au … », and « 585,92 € en retard » once the immediate window has passed — exactly as a
    payment plan reads « 2 échéances payées · 1 à venir le … ». The ledger of the fiche is read per fiche (its own receipts and bank
    lines, no proposal) and never writes; the quote preview's ledger carries no bank tranches. A fiche with no pending tranche shows nothing new.
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
    opens that stay). A **sale outside a stay** (rule 1) has no fiche: it groups under its client (the stay client
    of the same name, else a group of its own) or, when it names none, under its label; its line carries
    `saleKey`, never a fiche link. A reserve of such a sale that is late raises the item of rule 13 named by
    the sale.
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
    - at each paid link — or any other split source of rule 1, a sale outside a stay included (its client is the
      one named on the sale) — on its payment date: **D 46720000 / C client account** (`C+NOM`) for the gross —
      Mollie owes the money, the client is settled. The sale's own entry (D client / C revenue) is unchanged:
      the Mollie entry settles it exactly as for a link, so nothing is counted twice;
    - at each reconciled Mollie credit, on its bank date: **D 512 (bank account setting) / C 46720000** for
      the credit amount, the libellé carrying the Mollie settlement reference and the Qonto reference;
    - a settlement cost (rule 5), if any: **D 627 (setting) / C 46720000** — the costs of the payments GuestFlow knows; the share of
      unknown payments is listed apart as unattached (`kind: 'cost'`), never booked on a client. Without a token (no settlement read), a
      credit confirmed short of its tranche by the estimated fee books that gap as a cost (« FRAIS MOLLIE ESTIMÉS »); with a settlement
      the settlement's own costs are booked, never both;
    - the gross of a link is net of what Mollie refunded of it (rule 6); dates are the Paris day of the instant, whatever its stored
      format (ISO with a zone, or SQLite's UTC `datetime`); the libellé of a credit is « VERSEMENT MOLLIE <settlement> <last 6 characters of
      Qonto's reference> » (the export sets no maximum length; the 50-character id would drown the line).
    The balance of 46720000 at any date is then exactly the money still at Mollie (transit + reserves).
29. The bank lines of rule 28 can be switched off (setting « Exporter les versements Mollie reçus »,
    default on) for an accountant who books the bank from the bank feed himself — Q2.
30. The export page shows, for the exported month, the clearing account's balance at month end and its
    detail (which clients' reserves are still held), as a reconciliation aid for the accountant.
31. A Mollie credit not reconciled at export time is listed as « Versement Mollie non rattaché » in the
    export summary and produces no line (never guess an allocation into the books).

### 3.7 Sales outside a stay of the pricing refonte (stabilisation loop t10, 2026-11-17)

32. **The payment link of a sale outside a stay is a Mollie payment like any link** (outside-booking-sas rules 39-42: a
    `complement` link with `saleRef`, no stay). Once paid, its split is stored with no reservation id and the ledger key
    `sale:<sale key>:link-<link id>`, the sale key being `<saleRef>:<Paris day paid>` — the key of the sale day its payment
    books on. The reconciliation lists every paid link of a sale from the reconciliation start date as two receipts of its
    own (reservation id `0`, `reservation.id` null, the brief of that sale day — its label and client — or « Vente hors
    séjour » when no sale day lists it), beside the sale day's own card tranches (`sale:<sale key>`); so its Mollie credits
    are matched and confirmed, « Versements à venir » lists its tranches and the Mollie journal books its `link` entry
    (rule 28) on the payment day under the sale. (D10-2: before, the split was stored under `basket-<id>`, reservation 0,
    and nothing read it.)
33. **One Mollie split per card payment, never one per invoice.** A sale outside a stay is listed once per document and
    payment day, every day carrying the document's invoice number. Only one of those days is the `invoice` source of rule 1
    — the first day paid by card (else the first day; never a refund or a tip row), read over every sale up to today — and
    the number a Mollie payment's `description` is paired with (rule 16) points to it; every other day is a `tender`
    source of its own (`sale:<sale key>`). A document paid by card 30 € then 50 € on two days is two splits, four tranches
    (24 + 6, 40 + 10) and two `link` entries in the journal. (D10-1: before, the two days shared one split whose gross
    followed the last candidate.)
    > _Reading of 2026-11-17 (loop t11 B11-1):_ a split already bound to a Mollie payment is never re-pointed to another one
    > (`fromMolliePayment` leaves it as it is). A second Mollie payment whose `description` names the same invoice number pairs
    > with the document's card day of the same amount still free (the invoice day or one of its later card days, `nextDays` of
    > `invoiceSources`; the closest date first), else it stays unknown. Two payments 30 € and 20 € naming one invoice are two
    > splits bound to their own payment, journal 30 + 20, with or without « CB sur place via Mollie depuis » (before: the
    > second re-pointed the first split, and without the setting the 20 € never reached 46720000).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/online-payment/reconciliation/` | `molliePaymentSplits.js` | C | Rules 1–4, 6: compute and store the split of a source (link, invoice, tender); expected dates; refunds. Pure core + model. |
| | `mollieCardSources.js` | C | Rule 1 (second half): reads the card payments recorded on site (instalments paid by card, the CB line of a split payment, sales outside a stay) and the Qonto invoices GuestFlow holds. |
| | `expectedReceipts.js` | T | Rule 8: a paid link or any other source yields `#immediat` and `#retenue` receipts; a sale outside a stay has its own (reservation id 0). |
| | `matcher.js` | T | Rule 9 replaces `acquiringProposals`; rule 10 consumes settlement details; `classify` Mollie by counterparty whatever the type. |
| | `mollieSettlements.js` | C | Rules 10, 16: normalise the reference, store settlements and balance transactions, compose a settlement from them, attach payments, correct the reserve (rule 4). |
| | `transactionsReader.js`, `bankTransactionsModel.js` | T | Rule 12: store Qonto `transaction_id` as `qontoReference`. |
| | `controller.js` | T | Tranche states and identifiers in the fiche/page payloads; attention item (rule 13). |
| | `schema.js` | T | Tables of §5, `reconciliation_v3` and the remediation `reconciliation_v3b` (final schema from any state). |
| | `mollieTranches.js`, `mollieJournal.js` | C | Rules 18-19 (the words and states of a tranche, the recap line); rules 28-31 (the Mollie facts a month books). Pure. |
| | `receiptStates.js` | T | `trancheDaysLate`: the one definition of a late tranche (rule 4). |
| `plugins/online-payment/` | `mollieClient.js` | C | Read-only Mollie API client (settlements, settlement payments, balance transactions, primary balance, a payment), `httpRetry`, token from settings; reads every amount in cents through `coreModule('money').toCentsStrict` (SDK 2.31, pricing-components rule 38; test `mollie-cents-shared-helper`). |
| | `mollieConnection.js` | C | « Compte Mollie »: token check, « Tester », the read (settlements + balance), `status()` with `balance`. |
| | `index.js`, `settingsStore.js`, `manifest.json` | T | Settings of rules 2, 14; registration of the SDK contributions below; version → 1.8.0. |
| `plugins/sdk/` | `createContext.js`, `version.js` | T | New entries (MINOR, SDK 2.29.0): `ledgerBankTranches(provider)` (rule 18), `incomingPayments(provider)` (rule 23), `journalEntries(provider)` (rule 28). |
| `utils/` | `pluginLedgerTranches.js`, `pluginIncomingPayments.js`, `pluginJournalEntries.js` | C | The three provider registries read from live plugins; `decorateLedger` adds `bankTranches[]` to the rows and `schedule` to the ledger (rules 18-19). |
| `controllers/` | `reservationsController.js` | T | Decorates the stored fiche's ledger only (never the quote preview's). |
| | `incomingPayments.js` | C | Rules 21–27: gather core kinds (instalments, platform payouts) + plugin providers, group by client, sort, totals. Pure. |
| `models/` | `financeDashboardModel.js` | T | Tile `incoming` (rule 21) and detail `incoming`. |
| `routes/` + `controllers/` | `finance.js`, `financeController.js` | T | `GET /api/finance/incoming?recent=1`. |
| `plugins/accounting-export/` | `accountingExport.js`, `accountPlan.js`, `settings.js`, `controller.js` | T | Rules 28–31: Mollie journal lines from `journalEntries` providers; clearing balance; settings. Version → 1.3.0. |
| `database.js` | — | — | No core schema change. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `ScheduleLines.jsx` | C | Generic dated-amount lines with a state badge — used by `BankTranches` (rule 18); `InstallmentPlanCard` keeps its own read view. |
| | `TransactionRef.jsx` | C | A bank/provider identifier shortened in the middle + copy button (rule 12). Generic: any external id. |
| `components/reservation/` | `BankTranches.jsx` (C), `FinanceSection.jsx` (T) | | Render `bankTranches[]` under a paid row and the summary line (rules 18-19). |
| `pages/` | `FinancePage.jsx` | T | Tile « Versements à venir » + its detail. |
| `components/finance/` | `IncomingPaymentsTable.jsx` | C | Rules 22-24: grouped table (md+), cards (xs), kind filter chips, recent toggle, row → fiche. Feature-specific. |
| `plugins/online-payment/` | `MollieConnectionCard.jsx` (C), `ReconciliationSettingsCard.jsx` (T), `ReconciliationLine.jsx` (T), `MollieReserveAlert.jsx` (C) | | Token card (rules 14-15), reserve settings (rules 2-3), identifiers on bank rows (rule 12), the home alert of rule 13. The Mollie cards have their own « Enregistrer » buttons, like the existing reconciliation card: they save plugin settings, not the page's form. |
| `plugins/accounting-export/` | `MollieJournalCard.jsx` (C), `MollieClearingCard.jsx` (C) | | Mollie journal settings with their own « Enregistrer »; clearing balance + unattached credits (rules 30-31). |
| `api.js` | — | T | `finance.incoming`, Mollie test, reserve attention. |

**Component reuse:** consumes `StatusBadge`, `EmptyState`, `MaskedTextField`, `HelpedTextField` and the
reconciliation's own `PlatformChip`; the incoming table is its own markup (`TableCard` and the error / loading states are not used there).
Creates `ScheduleLines` (generic: Mollie tranches, later any staged payment) and `TransactionRef` (generic: Qonto, Mollie, Stripe ids).
`IncomingPaymentsTable` is specific (one page, one payload).

### 4.3 API contract

| Method | Endpoint | Response | Notes |
|---|---|---|---|
| GET | `/api/finance/incoming[?recent=1]` | `{ totals: { amount, amountCents, clients, nextDate, nextDateLabel }, kinds: [{ key, label, count }], clients: [{ clientId, name, totalCents, nextDate, nextDateLabel, late, stays: [{ reservationId (null for a sale outside a stay), saleKey (null for a stay), label, startDate, endDate, items: [{ key, kind, label, icon, natureLabel, natureDetail, amountCents, expectedDate, receivedDate, dateLabel, state, stateLabel, tone, refs: { qonto, mollieSettlement, molliePayment } }] }] }] }` | Admin + accounting role (`enforceRoleAccess`: accountant `GET /finance/incoming`). |
| GET | `/api/finance/dashboard` | `tiles.incoming: { amount, clients, nextDate, nextDateLabel }` | Added field; `nextDateLabel` « jeu. 11/02 ». Each `clients[]` group of `/api/finance/incoming` also carries a unique `key`. |
| GET | `/api/payments/reconciliation/reserve-attention` | `{ count, items: [{ reservationId, saleKey, clientName, saleLabel, amountCents, amount, amountLabel, expectedDate, expectedDateLabel, line }] }` | One item per fiche (or sale), oldest expected date first (rule 13); same role access as the other reconciliation GETs (admin). |
| GET | `/api/reservations/:id` (ledger) | rows gain `bankTranches[]`, summary gains `schedule` | Additive. |
| POST | `/api/plugins/online-payment/mollie/test` | `{ ok, settlements, error? }` | Never returns the token. |
| GET | reconciliation payload | `mollie: { configured, profileId, lastRead: { at, settlements, unknownPayments, balances }, lastError, balance: { pendingCents, pendingAmount, availableCents, at } or null, settlements }` | `balance` added (rule 14); the plugin setting `mollieBalance` (JSON) carries the same for the settings card. |
| POST | `/api/payments/reconciliation/discards` | 201 / 404 `UNKNOWN_RESERVATION` | `reservationId` 0 accepted for a sale outside a stay (rule 8). |
| PUT | plugin settings | 400 `{ error }` on rule 3 / 15 refusal | |

## 5. Data model (plugin `online-payment`, migration `reconciliation_v3`)

- `mollie_payment_splits` — PK (`sourceType`, `sourceKey`) with `sourceType` ∈ `link | invoice | tender`
  (`link`: the payment link id; `invoice`: the Qonto invoice number; `tender`: `installment:<id>`, `settlement:<id>`
  or `sale:<sale key>`), `reservationId` NULL (a sale outside a stay has none), `ledgerKey` NULL, `grossCents`,
  `immediateCents`, `reserveCents`, `ratePercent`, `holdDays`, `paidAt`, `molliePaymentId` NULL, `refundedCents` 0,
  `createdAt`. Replaces the `payment_link_splits` of the first draft of this migration (never released: edited in
  place). Backfill: every paid link from « Retenue appliquée depuis » on; the on-site card payments from
  « CB sur place via Mollie depuis » on, when the setting is set.
- `mollie_settlements` — `id` (`stl_…`) PK, `reference`, `settledAt`, `amountCents`, `costsCents`,
  `reserveHeldCents`, `reserveReleasedCents`, `fetchedAt`.
- `mollie_settlement_payments` — `settlementId`, `molliePaymentId`, `amountCents`, `paidAt`,
  `description`, `splitId` NULL (`link:<id>` or `invoice:<number>`: the split the payment is); PK (`settlementId`, `molliePaymentId`).
- `mollie_settlement_failures` — `reference` PK, `failedAt`, `retryAt`, `message`: a settlement Mollie could not give, not asked again before `retryAt` (rule 17).
- `mollie_settlements.source` — `balance` (composed from balance transactions, exact) or `payments` (fallback); `reference` is
  stored in Mollie's form (no `T`).
- `mollie_settlement_payments` also carries `kind` (`immediate` | `release`; part of the PK), `grossCents`, `reserveCents`
  (the hold Mollie applied, NULL when unknown) and `feeCents` (NULL when unknown); `amountCents` is the share the settlement
  paid (a `payment`'s `resultAmount`, a release's amount).
- `mollie_balance_transactions` — `id` PK, `type`, `createdAt`, `resultCents`, `initialCents`, `deductionsCents`,
  `settlementId` NULL (outgoing transfers), `paymentId` NULL, `description`.
- `bank_transactions.qontoReference` TEXT NULL (filled on next read; CSV imports already use it as id).
- `bank_reconciliation_lines`: rows whose `ledgerKey` is a link's bare key are rewritten to `#immediat`
  — idempotent, a rerun finds nothing to rewrite.

Migration `reconciliation_v3b` (idempotent, `IF NOT EXISTS` / column checks) reaches this schema from ANY state: a database that ran a draft of
`reconciliation_v3` has its two settlement tables rebuilt when they carry the draft shape (they hold only what Mollie can say again) and its
`payment_link_splits` copied into `mollie_payment_splits`; a database already on the final shape is untouched. The bare-key rewrite reads
exactly the links the splits model splits (paid, dated, above zero), covers a complement drawn on `checkoutComplement`, and drops a discard
whose `#immediat` twin exists instead of leaving it to the primary key.

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
- `mollie-balance-composition.unit.test.js` — rules 4, 5, 10, 14, 16 (T-prefix lookup; the four measured settlements; a settlement of two immediate shares + a release composed exactly and « sûr »; a release alone; fee discount → 0 € fees; hold from `deductions` correcting a split; balances unreadable → fallback; pending amount).
- `mollie-sale-discard.unit.test.js` — rule 8 (discard of a sale outside a stay).
- `mollie-settings-validation.unit.test.js` — rules 3, 15.
- `mollie-card-sources.unit.test.js` — rule 1 second half (Gruat invoice case, tender before / after the setting date, split payment CB line, batch exclusion), rule 3 (`mollieCardOnSiteSince`), rules 13, 16, 23, 28 for a sale outside a stay.
- `mollie-review-matching`, `mollie-review-settlements-read`, `mollie-review-splits`, `mollie-review-migration`, `mollie-review-read-paths`, `mollie-review-journal`, `mollie-review-lateness-and-words` (online-payment) and `accounting-mollie-libelle` (accounting-export) — the review of 2026-11-16: rules 1, 4-6, 8-10, 13-19, 28 (no amount fallback « sûr » next to a settlement read; one failing reference; re-read of unknown payments; complement and basket links; estimates that follow the data; `reconciliation_v3b` from both drafts; no write on a read; fee gap, refunds, unknown costs and Paris days in the journal; late everywhere; the recap line; the reserve-attention route).
- `mollie-final-reserve-reachable`, `mollie-final-journal-fees-per-client`, `mollie-final-provisional-splits`, `mollie-final-connection-and-rotation`, `mollie-final-late-reserve-attention`, `mollie-final-since-crossing` (online-payment) — the final pass of 2026-11-16: rule 10 (a reserve picked by amount from a payments-list settlement must be reachable on the credit's day), rule 28 (the clearing per client takes fees off as well as credits), rule 1 (provisional splits on every read, no write from the journal, links that can never have a ledger key never trigger a sync), rules 6, 16, 17 (the card tells every settlement still cooling down; a network failure stops the pass; refund refresh rotates on `refundCheckedAt`; the re-read selection only holds references a credit names), rules 4 and 13 (a late reserve is late whether or not a proposal waits), rule 2 (a correction crossing « Retenue appliquée depuis » decides the reserve again).
- `incoming-payments.unit.test.js` — rules 21–27 (grouping, sort, late first, without plugin).
- `mollie-sale-payment-link.unit.test.js` (6) — rule 32 (split with no stay, two receipts, credit proposed and confirmed under id 0, journal `link` entry, « Versements à venir », a link no sale day lists).
- `mollie-invoice-several-card-days.unit.test.js` (5) — rule 33 (two candidates, two splits idempotent, four tranches, invoice pairing on the first card day, « Versements à venir » 80 €).
- `mollie-invoice-two-payments.unit.test.js` (3) — rule 33 reading (loop t11 B11-1): two Mollie payments naming one invoice → two splits bound to their own payment, journal 30 + 20, with and without the on-site card setting; a split bound to another payment is never taken again.
- `accounting-synthesis-mollie-plan.unit.test.js` (3, accounting-export) — rule 29 in the synthesis: it reads the export's plan (bank lines off, operator's accounts).
- `accounting-mollie-anonymous-sale-libelle.unit.test.js` (3, accounting-export) — rule 28: an anonymous sale's `link` entry reads the sale's label, never « RÉSERVATION #null ».
- `accounting-mollie-journal.unit.test.js` — rules 28–31 (balanced entries, clearing balance, switch, unattached).

### Client tests
- `ScheduleLines.test.jsx`, `TransactionRef.test.jsx`, `IncomingPaymentsTable.test.jsx`,
  `FinanceSection.mollie-tranches.test.jsx`, `MollieConnectionCard.test.jsx`, `MollieConnectionCard.pending-amount.test.jsx`,
  `IncomingPaymentsTable.sale-outside-stay.test.jsx`, `MollieReserveAlert.sale-outside-stay.test.jsx`, `ReconciliationPage.sale-outside-stay.test.jsx`.

### Manual UI verification
- Shadow on a fresh production copy (secrets purged) + the CSV export with the Mollie pair: fiche, tile,
  table at 390 / 900 / 1280 px, settings refusal, export of December 2025 and March 2026.
- Live Mollie token: only after release, on production, read-only (Q1).
- E2E suite after the UI changes.

## 8. Out of scope

- Chargebacks and disputes (Mollie deducts them from a settlement: shown as an unexplained remainder).
- Writing anything to Mollie or Qonto; Mollie webhooks.
- The historical « Paiements-En-Personne » daily batches (rule 31 of the reconciliation) stay as they are for
  every card payment before « CB sur place via Mollie depuis » (or while it is empty); from that day Tap to Pay
  through Mollie is in scope (rule 1).
- A direct bucket (acompte, solde) marked paid without a recorded tender: its method is not stored, so it cannot be
  told to be a card — it stays in the card batch. Bookings tied to a stay that hold a Qonto invoice number are not
  paired by number (only sales outside a stay are exposed to the plugin).
- Forecasting cash beyond what is already paid or scheduled.

## 9. Open questions

- Q1: What does a payment link's Mollie payment carry? — **resolved 2026-11-16 (measured)**: the Qonto
  payment id in `description`; an invoice paid by card carries the Qonto invoice number; a 2025 link
  carried `metadata.payment_link_id` (rule 16).
- Q5: Where does Mollie take its fees (0,446 € on Gruat)? — **resolved 2026-11-16 (measured)**: inside the settlement, as cost
  lines (`periods.….costs[]`), and every fee so far is cancelled by a « Fee Discount » cost line (first 1 000 € without
  commission, ~943 € processed): the settlements carry 0 € of fees (rule 5). No fee is taken on the release.
- Q2: Does the accountant book the bank account from the bank feed (then rule 29 off) or import our bank
  lines? Account numbers `46720000`, `MO`, `627` to confirm with him.
- Q3: Is a direct link to a transaction in the Qonto web app stable enough to offer « Ouvrir dans Qonto »?
  Until measured: copy button only.
- Q4: Does Mollie release a reserve inside the regular settlement of the day (grouped) or alone? — **resolved 2026-11-16
  (measured)**: alone, in its own settlement (39,36 € of 2026-03-23); the balance transactions name the payment it frees,
  so both cases are exact (rule 10).

## 10. Implementation progress

### Server (2026-11-16)

- [x] Rules 1-7 — `molliePaymentSplits.js` (split, since-date, refunds, validation), `mollie_payment_splits` filled the first time a paid link is seen: by the `reservation.paid` event, the read job, « Actualiser » and the page that lists the reconciliation — never by the fiche, the quote preview, the dashboard or the journal, which read a provisional split in memory until then (review 2026-11-16, final pass).
- [x] Rules 8-13 — `expectedReceipts.js` (`#immediat` / `#retenue`), `matcher.js` (`classify` Mollie by name, `mollieProposals`, `settlementProposal`), `ficheWriter` untouched (the controller skips the write for a tranche), `qontoReference`, late reserve attention (`mollie-reserve-late`).
- [x] Rules 14-17 — `mollieClient.js`, `mollieSettlements.js`, `mollieConnection.js`, `POST /api/plugins/online-payment/mollie/test`.
- [x] Rules 18-20 — `ctx.ledgerBankTranches` → ledger rows `bankTranches[]` and `ledger.schedule` (`utils/pluginLedgerTranches.js`), the fiche's reconciliation card lists the two receipts.
- [x] Rules 21-27 — `utils/incomingPayments.js`, `models/incomingPaymentsModel.js`, `GET /api/finance/incoming`, `tiles.incoming`, detail `incoming`; `ctx.incomingPayments`.
- [x] Rules 28-31 — `ctx.journalEntries`, `mollieJournal.js`, accounting-export settings, entries, clearing balance and unattached credits in `GET /api/accounting/sales`.
- [x] SDK 2.29.0, `online-payment` 1.8.0, `accounting-export` 1.3.0, `reconciliation_v3`.
- [x] Rule 1, second half (2026-11-16) — `mollie_payment_splits` keyed by `sourceType` (`link | invoice | tender`) + `sourceKey`; `mollieCardSources.js`; setting `mollieCardOnSiteSince` (« CB sur place via Mollie depuis »); `invoice` splits made from the Mollie payment paired by its `description` (Gruat, F-2026-013: 14,00 € → 11,20 € + 2,80 €); `tender` splits for an instalment paid by card without a link, the CB line of a split payment (its cheque / transfer lines stay `settlement-<id>`) and a sale outside a stay without invoice; receipts, matching, ledger `bankTranches`, `incomingPayments` (items carry `sale`), journal and late-reserve attention work for every source; a sale that went through Mollie leaves the day's card batch.
- [x] Client — done (2026-11-16): `BankTranches`, `ScheduleLines`, `TransactionRef`, `IncomingPaymentsTable`, the Mollie cards and the reserve alert (see §4.2).

### Readings that settled what the rules left open

- **Windows (rule 4).** « Window [0, +8] / [−3, +10] » is read as the days after the expected date during which the tranche is still on time: past `expected + 8` (immediate) or `expected + 10` (reserve) without a credit it is `en retard`. A credit is a candidate from the day of the payment (never before it); a reserve from `expected − 3`. By amount alone an immediate share is not matched to a credit past `expected + lateAfterDays`, nor a reserve to a credit before `expected − 3`; the exact composition of rule 10 has no date window (review 2026-11-16).
- **Fees (rule 5).** An immediate tranche is reconciled when its credit is short of it by at most the estimated fees of the whole payment (`1,4 % + 0,25 €` setting `reconciliationAcquiringFee`), never above it; a reserve tranche has no tolerance.
- **Settlement costs and reserve lines (rule 16).** Read from `periods.<year>.<month>.revenue|costs[]`: the `rollingreserve` lines are a release when their gross is positive and a hold when negative; every other costs line is a cost. Where Mollie takes its fees is still Q5: a settlement whose credit is short of its tranches by its `costsCents` is explained by them.
- **« Versement plateforme » (rule 23).** Listed once the guest has left (`endDate <= today`): its due date is the end date plus the platform's payout delay, its amount the solde net of the platform's commission and penalties — the same figures as « En retard ».
- **« Reçus récemment » (rule 24)** — instalments paid by transfer or cheque (a card instalment is a Mollie tranche), platform payouts marked received, Mollie tranches reconciled.
- **Roles (§4.3).** The accountant reads `GET /api/finance/incoming`; the dashboard and its detail endpoints stay admin-only.
- **Invoice-number pairing (rule 16, third key).** A Mollie payment paired by a Qonto invoice number is stored as `invoice:<number>` in `mollie_settlement_payments.splitId` and creates (or corrects) the `invoice` split of that sale: its tranches are real receipts.
- **Sales outside a stay (rule 1, second half).** Their receipts carry reservation id `0` in `bank_reconciliation_lines` (the column is NOT NULL) and `reservation: { id: null, saleKey, saleLabel, hasClient, clientName }` in the payload; they are never written to a fiche. The sale's card amount (`cardCents`) is the estimate until the Mollie payment is read.
- **Tender sources.** An instalment paid by card via a payment link is the link's split, never a second one; a settlement's `internal` card line cannot exist (only cash goes to the caisse interne).

- **Sales outside a stay of the pricing refonte (loop t10, 2026-11-17).** A sale's payment link (rule 32) and a document paid by card on several days (rule 33) — both reached only once the core lists its own standalone documents. Two OLD items of the same pass: the accounting synthesis reads the Mollie entries with the export's own plan (rule 29: « Exporter les versements Mollie reçus » off totals like the CSV; B10-3), and an anonymous sale's Mollie `link` entry reads the sale's label, else « VENTE HORS SÉJOUR » (rule 28; B10-4).

### Tests (server)

94 new tests in 10 files (the 10 of `mollie-card-sources` are rule 1 second half, 3, 13, 16, 23, 28): `mollie-payment-split` (10), `mollie-reconciliation-matching` (16), `mollie-settlements` (8), `mollie-settings-validation` (9), `mollie-ledger-tranches` (6), `mollie-incoming-payments` (5), `mollie-journal-entries` (5) under `server/src/plugins/online-payment/tests/`; `accounting-mollie-journal` (11) under `server/src/plugins/accounting-export/tests/`; `incoming-payments` (14) under `server/src/tests/`. Existing suites adjusted: the route census, the env-name list, the VAT golden (`tiles.incoming`), the dashboard payload pin, the accounting settings key lists, the hardening floor. Full server suite: green. The old acquirer test of rule 15 was removed (replaced by rule 9).

### Corrections after reading the live Mollie account (2026-11-16)

- [x] Reference normalised (`REF T…` ↔ Mollie form), rule 16.
- [x] Exact composition from balance transactions (`mollie_balance_transactions`, `compositionOf` in `mollieSettlements.js`, `compositionProposal` in `matcher.js`): rule 10; the settlement's payments list is the fallback, the amount combination (rule 9) stays without a token.
- [x] Settlement periods: reserve lines by description, signed costs (« Fee Discount »), rule 5 → 0 € of fees; real per-payment fees (`realFees`) replace the estimate in the receipts.
- [x] Reserve hold read from `deductions` and corrected on the split (rule 4); the reserve's expected date stays « immediate bank date + hold ».
- [x] `balance.pendingCents` on the Mollie status and card (rule 14).
- [x] Discard of a sale outside a stay (reservation id 0); the client sends 0 for a null `reservation.id`, hides « Ouvrir la fiche » and the fiche links of a sale (`IncomingPaymentsTable`, `MollieReserveAlert`, `ReconciliationAlert`, `ReconciliationLine`, `ReconciliationPage`).
- Migration `reconciliation_v3` was edited in place while unreleased; `reconciliation_v3b` (review 2026-11-16) makes the final schema reachable from any state, including a development or shadow database that ran a draft.
- Tests: `mollie-balance-composition` (9), `mollie-sale-discard` (2) on the server; 4 new files / 7 tests on the client.
- Reading of 2026-11-17 (loop t11 UI11-2): the reconciliation items carry `expectedWording` (« Attendu » for a sale outside a stay, « La fiche attend » for a stay) and `clientHeading` (empty for a sale without a client, so its label is printed once). Tests: `reconciliation-sale-wording` (1) on the server, `ReconciliationLine.sale-wording` (2) on the client.

### Review corrections (2026-11-16, server)

- [x] No « sûr » by amount next to a settlement read from Mollie that does not match (rule 10); ambiguous reserve releases « probable »; the exact composition has no date window and the amount path bounds the immediate share (rules 9, 14); reserve tolerance 0 (rule 15); platform patterns before the Mollie name.
- [x] One failing reference never stops the settlements read; re-read of unknown payments; refunds refreshed; costs rounded once; next page on Mollie's origin only; « Tester » never stores a typed token's profile (rules 16-17).
- [x] Splits: complement on `checkoutComplement`, basket links without a ledger row, estimates that follow the data and leave with it (rules 1-2, 8); `reconciliation_v3b` and the exact bare-key rewrite (§5).
- [x] No write on a reading path: the splits sync on the event, the job, « Actualiser » and the reconciliation page; the fiche reads its own tranches; the quote preview is not decorated; one journal pass per request.
- [x] Journal: fee gap of a credit confirmed short, net of refunds, unknown payments' costs apart, Paris days, short libellé (rule 28).
- [x] « En retard » is one definition everywhere; the recap line tells the tranches apart; labels from the real share; the reserve-attention route and `line`; `tiles.incoming.nextDateLabel`; client group `key`.
- [x] Final pass: the settlement read from the payments list only frees a reserve reachable on the credit's day (rule 10); the clearing per client subtracts fees (rule 28); provisional splits on every read and no journal write (rule 1); `mollieLastError` lists every settlement still cooling down and a network failure stops the pass without a cooldown (rule 17); refund refresh rotates by `refundCheckedAt` (column added to `reconciliation_v3b`, idempotent) and the re-read selection is limited to references a credit names (rules 6, 16); a late reserve with a pending proposal is on the home alert, which draws the server's `line` (rule 13); a day moved across « Retenue appliquée depuis » re-decides the reserve of an estimate (rule 2). `counts.waiting` of the reconciliation payload keeps counting the `waiting` state only (qonto-bank-reconciliation contract, older than this branch).
- Tests: 43 new server tests in 8 files (`mollie-review-*` ×7 under `plugins/online-payment/tests/`, `accounting-mollie-libelle` under `plugins/accounting-export/tests/`); existing suites adjusted for the new behaviour (splits are synced by the fixture's `build`, as the `reservation.paid` event would).
