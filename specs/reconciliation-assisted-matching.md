# Bank reconciliation v2 — assisted matching, split and grouped payments, platform penalties

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/reconciliation-assisted-matching` (PR → `inte/plugins`, one PR per lot) |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [qonto-bank-reconciliation.md](qonto-bank-reconciliation.md) (v1, Implemented) — its rules 1–46 stand unless a rule below names one it revises |
| **Summary page** | [docs/specs/2026-10-28-reconciliation-assisted-matching.html](../docs/specs/2026-10-28-reconciliation-assisted-matching.html) — interactive mock-ups, 1280 and 390 px |

**Why a new spec rather than more rules in v1.** v1 is Implemented, 46 rules long and its architecture
table describes shipped files. This change adds three new surfaces (the fiche's linking dialog, bulk
confirmation, platform penalties), two new endpoints families and a core data model (penalties). Appending
it to v1 would interleave « shipped » and « draft » in the same tables. v1 keeps its rule numbers; the
rules it loses or changes carry a one-line « Revised 2026-10-28 » pointer to the rule here (v1 rules 11,
18, 22, 26 and §6).

---

## 1. Context

Feedback of 2026-10-28 on the `inte/plugins` shadow (production copy of 2026-10-22, real Qonto CSV export of
114 credits, start date 2026-01-01). Measured on that shadow: 49 receipts « À traiter » — 40 proposals (21
« sûr », 12 « probable », 7 « à vérifier »), 9 gaps, 14 platform credits « non rattachés », 27 « autres
crédits ». Six problems, each grounded in the code:

**A — « Rattacher un virement » on the fiche lists the wrong credits.**
[controller.js:360-362](../server/src/plugins/online-payment/reconciliation/controller.js#L360) hands the fiche
`data.credits.filter(remaining > 0, not outside, EUR).slice(0, 40)`: the 40 **newest** credits of the
account, whatever the fiche expects. On the shadow, the fiche of a stay whose acompte was due on 14/03
gets 40 credits settled between 05/06 and 12/10 — the transfers that could pay it are **not in the list at
all** (the cap cuts them off). 25 of the 40 are platform payouts already proposed to other fiches and 12 are
« autres crédits » (owner transfers, interest…). There is no amount or date filter and no search.
[LinkTransactionDialog.jsx:62-83](../client/src/plugins/online-payment/LinkTransactionDialog.jsx#L62) renders them
as one flat radio list, and links **one** credit to **one** échéance per opening.

**B — A guest who pays in two transfers.** The data model already allows several credits per receipt
(v1 rule 12) and the `partial` state (v1 rule 37), but the only way to get there is to open the dialog twice
and type each amount. The matcher never proposes two credits together: `directProposals`
([matcher.js:185-233](../server/src/plugins/online-payment/reconciliation/matcher.js#L185)) works one credit at a
time, so two 150 € transfers for a 300 € acompte are two « à vérifier » guesses at best. With an
installment plan ([direct-installments.md](direct-installments.md)) the receipts are `installment-N`, often of
**equal amounts** (334 + 334 + 333,50): the matcher picks among them by date distance only, so a late first
payment can land on installment 2.

**C — Not automatic enough.** Every proposal waits for a click (v1 rule 11), including the 21 « sûr » ones
(a recognised platform, one fiche, the amount to the cent). The home already has two alerts that speak about
the same money without knowing each other: the core « Échéances » card
([PaymentDeadlinesAlert.jsx](../client/src/components/PaymentDeadlinesAlert.jsx),
[paymentDeadlines.js](../server/src/utils/paymentDeadlines.js) — overdue from the **fiche's** flags) and the
plugin's « Écarts de règlement » ([attention.js](../server/src/plugins/online-payment/reconciliation/attention.js)).
Adrien asks for « une alerte quand un paiement n'a pas été reçu à l'échéance »: the core card already raises it,
but it cannot say whether the money is in fact on the account.

**D — Grouped platform payouts.** The matcher already looks for the smallest combination of up to 6 payout
rows whose sum is exact (v1 rule 14, [matcher.js:132-138](../server/src/plugins/online-payment/reconciliation/matcher.js#L132)),
and the shadow shows it working (two Booking pairs, two Abracadaroom pairs). It only combines rows **whose
payout is recorded** (`recorded`), with no constraint on how far apart the stays are. A week of bookings whose
fiches carry the gross only (`platform-unrecorded`, rule 32) is never combined: those credits end « non
rattachés ».

**E — Platform penalties.** A platform sometimes withholds part of a payout (host cancellation, relocation
costs, non-compliance). Nothing can express it. When the operator types the bank amount as the payout, the
core computes `commission = gross − payout − tax − acompte commission`
([platformCommission.js:14-21](../server/src/utils/platformCommission.js#L14)): the penalty silently becomes
**commission**, booked on the commission account with deductible VAT
([accountingModel.js:740-760](../server/src/plugins/accounting-export/accountingModel.js#L740)) — wrong in the
books, and wrong in every « commissions » figure of the finance pages. When the operator types the statement
figure instead, the reconciliation shows an `amount_gap` forever. Vocabulary trap: « Taxe de séjour retenue »
already names the tourist tax a platform keeps (`booking-intake`, `airbnb-intake`), so a penalty must never be
called « retenue ».

**F — The reconciliation page.** The four counters only switch the tab
([ReconciliationPage.jsx:30-35, 136](../client/src/plugins/online-payment/ReconciliationPage.jsx#L30)): « Écarts »
and « À confirmer » both open « À traiter » with everything mixed. Confirming 40 proposals is 40 clicks.

## 2. Goal

The operator reconciles the account with as few gestures as the evidence allows: certain matches confirm
themselves, the rest is confirmed in one batch or picked from a short list of plausible transfers — one or
several, for one échéance or a whole group of stays — and a platform's penalty is declared once and lands
on the right account, on the fiche, in the finance pages and in the accounting export.

## 3. Functional rules

### 3.1 The fiche's linking dialog (Lot 1 — A, B)

1. **Only credits still available.** The dialog lists credits of the selected account that are EUR, not
   « Hors réservation », and have money left to allocate (`remainingCents > 0`, confirmed lines only — a
   proposal for another fiche does not consume a credit). A credit already partly allocated shows « reste
   120,00 € sur 450,00 € ». Debits are never stored (v1 rule 3), so every row is money in.
2. **Plausible first.** The server splits the available credits into « Correspondances probables » and the
   rest. A credit is plausible for the fiche when it is settled within **±15 days** of the anchor date of one
   of the fiche's open receipts (its due date, else its expected date, else the stay's departure for a
   platform payout) **and** at least one of:
   - its remaining amount is within **±5,00 €** of one open receipt's open amount, or of the sum of all the
     fiche's open receipts;
   - its counterparty, label, reference or note contains the client's last name (v1 rule 16 normalisation).
   Each plausible credit carries its reasons (`amount`, `name`, `exact`) and the receipt it fits best;
   ordering: exact amount first, then amount within margin, then name only; then by date distance.
3. **The full list is folded.** The other available credits sit under « Tous les virements disponibles
   (N) », folded by default, newest first, 50 per page with « Afficher plus ». No 40-credit cap and no
   window cut: the fiche of a March acompte reaches March credits (fixes A).
4. **Search.** One search field filters both groups, on the server, as the operator types (debounced 250 ms).
   Each whitespace-separated token must match (AND); a token is read as:
   - a **date** when it is `jj/mm`, `jj/mm/aaaa` or `aaaa-mm-jj` → credits settled that day (`jj/mm`: any year);
   - an **amount** when it is digits with an optional `,` or `.` and up to 2 decimals → credits whose amount or
     remaining equals it; an integer `596` also matches 596,00 € to 596,99 €;
   - **text** otherwise → contained in counterparty, label, reference or note (case, accents ignored).
   No match → « Aucun virement ne correspond à « … » » with « Effacer la recherche ».
5. **Several credits at once.** Credits are ticked (checkboxes, any number up to 10). The server allocates
   the ticked credits over the fiche's open receipts, **oldest credit first onto the earliest due receipt**
   (FIFO), and answers the allocation before anything is written. The dialog shows it live: per receipt
   « couvert » / « 300,00 € sur 700,00 € » and, under the list, « 2 virements · 1 000,00 € ». Rule 37 of v1
   applies: a receipt is marked received only once fully covered.
6. **Over and under.** Ticked credits that exceed what the fiche still expects are allowed: the surplus
   stays on the last credit, available for another fiche, and the dialog says « 50,00 € restent
   disponibles sur le virement du 12/03 ». Ticked credits that cover less are allowed: the receipts stay
   « Reçu en partie ».
7. **Manual split.** « Modifier la répartition » opens one amount field per (credit, receipt) pair the FIFO
   produced, prefilled. The server refuses (422) a pair above the credit's remaining or the receipt's open
   amount, a non-positive amount, or more than 2 decimals; the field shows the refusal inline and « Rattacher »
   stays disabled until the server's preview is valid.
8. **One gesture, one transaction.** « Rattacher » sends every pair in one call; all pairs and their fiche
   writes (v1 rules 34–37) succeed together or none is stored, and the core's refusal passes through (v1
   rule 34).
9. **An installment plan follows its order.** When several open receipts of a plan have the same amount, an
   allocation (FIFO, rule 5) and a proposal (rule 13) always take the **earliest due unpaid installment**
   first, whatever the credit's date. A paid installment never takes money (direct-installments rule 9).
10. **The fiche no longer ships the credits.** The fiche's `pluginBlocks['online-payment']` drops `credits`
    (v1 controller); the dialog asks for them when it opens. The fiche payload stays light and never depends
    on the size of the account.

### 3.2 The reconciliation page (Lot 1 — F)

11. **A counter is a filter.** Clicking « Écarts », « À confirmer », « Non rattachés » or « Rapprochés »
    shows only that set (`?view=…&filter=gaps|proposed|unmatched|reconciled`, computed by the server). The
    active counter is drawn pressed (`aria-pressed`), and a chip « Écarts · 9 » with a close button sits above
    the list. The chip's close button, a second click on the active counter, the tab bar, or `Échap` returns
    to the unfiltered tab. The filter lives in the URL, so a reload or « retour » keeps it.
12. **Confirm everything at once.** When the current view holds proposals, the action bar shows « Tout
    confirmer » (check-all icon, `success`). Its dialog states what will be written, from the server's
    `bulk` summary: « Confirmer 33 rapprochements · 18 420,50 € — les fiches seront marquées reçues à la
    date du virement. » Proposals « à vérifier » are **excluded by default**, counted on a checkbox
    « Inclure aussi les 7 à vérifier (2 310,00 €) »; ticking it updates the count and total. Proposals whose
    confirmation would need typed shares (rule 18) are never included.
13. **Bulk confirmation is per proposal and guarded.** The client sends the proposal ids it showed. The
    server recomputes, confirms each id still present **with the same allocations**, each in its own
    transaction (one fiche's refusal never blocks the others), and answers `confirmed`, `skipped`
    (`changed` | `refused` with the core's message). The page then reloads and a toast says « 33
    rapprochements confirmés » or « 31 confirmés · 2 non confirmés — voir la liste ». « Défaire » stays per
    credit (v1 rule 38).
14. **Linking from a credit, to several fiches.** On the page, « Rattacher à des fiches » from an unmatched
    credit opens the same dialog in the other direction: plausible receipts first (open amount within ±5,00 €
    of the credit's remaining, or a combination found by rule 17; anchor within ±15 days), all open receipts
    folded, same search (rule 4, matching client, property, booking number, amount, date), several receipts
    ticked, each with its amount, sum ≤ the credit's remaining (422 `ALLOCATION_EXCEEDS_TRANSACTION`).

### 3.3 Matching v2 (Lot 2 — B, C, D)

15. **Split payments are proposed.** For a direct reservation with no single-credit match, the matcher looks
    for 2 or 3 available credits that all carry the client's last name, are settled within ±30 days of the
    receipts' anchor, and whose sum equals exactly one open receipt or the sum of the reservation's open
    receipts → one proposal covering several credits, confidence « probable », reason « 2 virements du
    client ». Allocation follows rule 5 (FIFO) and rule 9.
16. **Equal installments.** Rule 9 applies to proposals: among several exact candidates of one plan, the
    earliest due unpaid installment is proposed, the others never appear as competing alternatives.
17. **Grouped platform payouts include estimated rows.** For a recognised platform credit with no single
    exact row, the combination search (v1 rule 14) runs over the platform's open payout rows whose recorded
    payout is known **and** those whose payout is not recorded yet, counted at `gross × (1 − commission
    rate of the platform)`, with a tolerance of 1 % of each estimated row. Constraints: at most 6 rows; every
    row's expected date between 3 days after and 30 days before `settled_at` (400 days for a platform that
    pays at booking time, as v1 rule 14); all rows' expected dates within **14 days** of each other (one
    payout run). The smallest combination wins; ties → the one whose expected dates are the closest together.
18. **Confidence of a group.** All rows recorded and exact → « probable » (v1). One estimated row →
    « probable », its share is the credit minus the exact rows. Two or more estimated rows → « à vérifier »,
    reason « Versement groupé de 3 séjours · montants estimés », and « Confirmer » opens the split dialog
    (rule 7) prefilled with the estimates; the server refuses (422 `SHARES_DO_NOT_SUM`) until the shares sum
    to the credit to the cent. Each typed share becomes that fiche's payout (v1 rule 36).
19. **A group is shown as one.** Every fiche of a group proposal shows « Versement groupé · couvre aussi
    Dupont (Versement Booking), Martin (Versement Booking) »; confirming it from any of them confirms the
    whole group; « Écarter » discards the group pairing for that credit (v1 rule 11).
20. **Automatic confirmation of certain matches.** After each read of the account (the 8-hour job or
    « Actualiser », never on a page load), every « sûr » proposal is confirmed by the server **when** it is a
    single credit to a single receipt, the receipt's expected bank amount is known (recorded payout, direct
    échéance or link), the amounts are equal to the cent, the fiche is not cancelled, and the confirmation
    writes only the paid flag and the date (never a payout, never an amount). The setting « Confirmer
    automatiquement les correspondances sûres » (on by default — arbitration A1) turns it off. *(Revises
    v1 rule 11 for that case only.)*
21. **An automatic confirmation is visible and undoable.** It is stored like a manual one with `auto = 1`
    and no user; the fiche's history says « Rapprochement bancaire automatique : reçu le 12/11 (virement) ».
    The page shows after the read « 12 rapprochements automatiques » with « Voir », and the « Rapprochés »
    rows carry an « auto » badge. « Défaire » works as for a manual one (v1 rule 38) and also discards the
    pair, so it is never auto-confirmed again.
22. **The due-date alert knows the bank.** The core « Échéances » card of the home
    (`payment-schedule-and-cancellation.md` §3.4) gains a generic, inert decoration hook. When the plugin is
    active, each overdue row is decorated from the reconciliation:
    - a proposal exists for that échéance → « Virement trouvé : 596,58 € le 12/11 » + « Confirmer » (writes
      as v1 rule 34; the row leaves the card on reload);
    - nothing on the account → « Rien sur le compte » under the row (unchanged actions);
    - the échéance was in fact reconciled after the card was computed → the row is dropped.
    Without the plugin the card is unchanged. No new home card: one alert per échéance (no duplicate with
    « Écarts de règlement », whose count excludes `late` receipts that the « Échéances » card already shows).
    *(Revises v1 rule 22: `late` leaves the « Écarts de règlement » count.)*

### 3.4 Platform penalties (Lot 3 — E)

23. **What a penalty is.** An amount a platform keeps on a stay's payout for a reason other than its
    commission or the tourist tax (host cancellation fee, relocation costs, non-compliance…). It is declared
    on the platform stay whose payout it reduced. Core feature (any platform, any accommodation); offered
    only on a stay settled by a platform (`reservation-payment-ledger.md` rule 24), never on a direct stay.
24. **Declaring.** From the fiche's « Paiement plateforme » block (« Déclarer une pénalité ») or from a
    reconciliation `amount_gap` line whose credit is below the expected payout (« Déclarer une pénalité de
    40,00 € », prefilled with the gap), the operator gives: **amount** (> 0, 2 decimals max), **motif**
    (required, 3–120 characters, suggestions « Frais d'annulation hôte », « Frais de relogement », « Non-
    conformité »), **date** (default: the payout's received date, else today; never in the future).
25. **Before or after the penalty.** The server needs to know whether the payout recorded on the fiche is
    the platform's statement figure (before the penalty) or the bank amount (after it):
    - declared from a reconciliation gap → the payout is the statement figure: it is kept, the commission is
      kept, and the bank now expects `payout − acompte net − penalties`;
    - declared from the fiche with a payout recorded → the dialog asks « Le versement saisi (570,02 €) est :
      ○ le montant du relevé, avant pénalité · ○ le montant reçu sur le compte, pénalité déjà déduite ».
      The second choice adds the penalty to the payout (610,02 €) so the commission drops by the same amount
      (`computePlatformCommission`, unchanged) — the penalty stops being booked as commission;
    - no payout recorded → nothing to choose; when the payout is recorded later (by hand or by v1 rule 36),
      the reconciliation's written payout is `credit + acompte net + penalties`.
    The dialog shows the server's preview of both figures, e.g. « Commission 152,40 € → 112,40 € · Net reçu
    610,02 € → 570,02 € ».
26. **Guards.** The server refuses (422) a penalty on a direct or cancelled stay, an amount ≤ 0, a total of
    penalties above the stay's payout net of its acompte (or above the gross minus the entered commission when
    no payout is recorded), a commission that would turn negative (rule 25, second choice), a future date or
    an empty motif. Refusals are inline in the dialog, in words.
27. **Where it shows.** The ledger's platform balance row gains a detail line « Pénalité plateforme −40,00 € ·
    Frais de relogement » per penalty; its « net » figures subtract the penalties. The fiche's history records
    each declaration and removal. Every « net received » reader subtracts the penalties of the stay: the
    finance pages (`financeModel.js` received/payout, `financeDashboardModel.js` collected), the reconciliation's
    expected bank amount (rule 25). Commissions shown anywhere stay the commission alone.
28. **Accounting.** Each penalty is its **own** journal entry, dated on the penalty's date: debit the
    « Pénalités plateformes » account (accounting-export setting, default `658000` pending the accountant —
    open question Q3), credit the client's auxiliary account, **no VAT**. The balance entry is unchanged
    (case « before »), or carries the lowered commission (case « after », rule 25). Σ debit = Σ credit on
    each entry; the client account nets to the money actually received. The Plan comptable page lists the new
    account with the others. A penalty never touches the 70xxx revenue lines.
29. **Already-exported months.** When a declaration or a removal changes an entry dated in a month before the
    current one (the balance entry in case « after », or a back-dated penalty), the preview warns « L'écriture
    de juin change : si juin est déjà transmis, prévenir le comptable. » The write is not refused.
30. **Removing.** « Supprimer » on a penalty line (confirm dialog) removes it and its accounting entry; in
    case « after » it takes the penalty back off the payout **only if** the payout still is the value the
    declaration wrote, otherwise the penalty is removed alone and the answer says « Versement modifié depuis :
    vérifier la commission à la main » (same principle as v1 rule 38).
31. **The reconciliation clears with it.** Once a penalty is declared, a platform receipt's expected bank
    amount is `payout − acompte net − penalties`; the `amount_gap` that triggered it becomes `reconciled` on
    the next load with no further step.

**Edge cases:**
- A credit plausible for two échéances of the same fiche (acompte 300, solde 300) → listed once, best-fit
  receipt = the earliest due; FIFO decides the allocation.
- A search token like `12/13` (no such date) → read as text, so it matches nothing rather than erroring.
- A name of 1–2 letters (« Li ») → never used for plausibility or split proposals (v1 tokens of ≥ 3 letters).
- Bulk confirmation while the job reads in the background → ids that changed are `skipped: changed`, never
  confirmed on stale data.
- Auto-confirmation meets a fiche with unsaved edits open in a browser → the write goes through the core mark
  like any confirmation; the open fiche refreshes its finance section on its next save conflict check
  (unchanged core behaviour, v1 rule 39 concerns the operator's own click only).
- A grouped payout where one stay was cancelled since → that row leaves the open receipts; the group is no
  longer exact and is not proposed; the credit shows « non rattaché ».
- A penalty withheld on another stay's payout (the platform cut stay B's payout for stay A's issue) → declare
  it on stay B, the payout it reduced, and name stay A in the motif. Out of scope to link the two stays.
- A penalty larger than the payout (the platform invoices the host instead) → refused (rule 26); the invoice
  is a debit, out of scope (§8).

---

## 4. Architecture

> Fat backend: plausibility, search parsing, FIFO allocation, combinations, confidence, auto-confirmation,
> bulk summaries, penalty guards and previews are all server-side. The dialogs render the server's previews
> and send ids; the client sums nothing.

### 4.1 Server side (`server/src/`)

| Lot | Layer | File | T/C | Responsibility in this change |
|---|---|---|---|---|
| 1 | `plugins/online-payment/reconciliation/` | `ficheCredits.js` | C | Pure: available credits × a fiche's open receipts → `{ likely, others }` with reasons and best-fit receipt (rules 1–3); search token parser and filter (rule 4). |
| 1 | `plugins/online-payment/reconciliation/` | `allocation.js` | C | Pure: FIFO allocation of ticked credits over open receipts, plan order (rules 5, 6, 9); validation of manual pairs (rule 7); shares validation (rule 18). |
| 1 | `plugins/online-payment/reconciliation/` | `controller.js` | T | `ficheCredits()`, `previewAllocation()`, `linkBatch()` (one transaction, rule 8), `bulkSummary()` + `confirmAll()` (rules 12–13), `filter` on `list()` (rule 11), plausible-first `candidates()` (rule 14); `buildFicheBlock` drops `credits` (rule 10). |
| 1 | `plugins/online-payment/reconciliation/` | `routes.js` | T | New thin routes (§4.3). |
| 2 | `plugins/online-payment/reconciliation/` | `matcher.js` | T | Split-payment proposals (rule 15), plan order (rule 16), grouped payouts with estimated rows and the 14-day run constraint (rules 17–18); proposals gain `parts[]` (several credits) and `needsShares`. |
| 2 | `plugins/online-payment/reconciliation/` | `autoConfirm.js` | C | After a read: selects the proposals eligible by rule 20, confirms them through the controller's confirm path with `auto: true`, returns the count for the page banner (rule 21). |
| 2 | `plugins/online-payment/reconciliation/` | `index.js` | T | Runs `autoConfirm` after the job's and « Actualiser »'s read; registers the payment-deadline decorator (rule 22); migration `reconciliation_v2`. |
| 2 | `plugins/online-payment/reconciliation/` | `schema.js` | T | `reconciliation_v2`: `bank_reconciliation_lines.auto`, `bank_reconciliation_lines.groupId` (§5). |
| 2 | `plugins/online-payment/reconciliation/` | `deadlineDecorator.js` | C | Overdue row × reconciliation → `bank: { state: 'proposed'|'nothing'|'reconciled', label, proposalId }` (rule 22). |
| 2 | `plugins/online-payment/reconciliation/` | `receiptStates.js` | T | `late` leaves the gap count used by « Écarts de règlement » (rule 22). |
| 2 | `plugins/online-payment/` | `settingsStore.js`, `manifest.json` | T | Setting `reconciliationAutoConfirm` (default `true`); version 1.4.0 (lot 1: 1.3.1). |
| 2 | `plugins/sdk/` | `createContext.js`, `registry.js`, `version.js` | T | `ctx.paymentDeadlineDecorator(fn)` — generic, inert without a plugin; SDK 2.8.0 (minor). |
| 2 | `controllers/` | `dashboardController.js` | T | `paymentDeadlines` passes its rows through the registered decorators (rule 22); a decorator's failure leaves the rows undecorated (logged). |
| 3 | `database.js` | `database.js` | T | Table `reservation_platform_penalties`, column `reservations.platformPenaltyAmount` (§5). |
| 3 | `models/` | `platformPenaltiesModel.js` | C | CRUD of penalty lines; keeps `reservations.platformPenaltyAmount` = Σ lines in the same transaction. |
| 3 | `controllers/` | `platformPenaltiesController.js` | C | Guards (rules 23, 26), preview (rule 25, 29), declare / remove with the payout adjustment and its undo condition (rules 25, 30), history entries (rule 27). |
| 3 | `routes/` | `reservations.js` | T | Thin routes `…/:id/platform-penalties` (§4.3). |
| 3 | `utils/` | `reservationLedger.js` | T | Penalty detail lines on the platform balance row, net figures net of penalties (rule 27). |
| 3 | `models/` | `financeModel.js` (L84, L248), `financeDashboardModel.js` (L64, L347) | T | Net received − penalties (rule 27). |
| 3 | `plugins/online-payment/reconciliation/` | `expectedReceipts.js`, `ficheWriter.js`, `receiptStates.js` | T | Expected bank amount and written payout account for penalties (rules 25, 31); `amount_gap` below the payout carries the `declarePenalty` action with the gap (rule 24). |
| 3 | `plugins/accounting-export/` | `accountingModel.js`, `accountPlan.js`, `settings.js`, `manifest.json` | T | One penalty entry per line (rule 28); setting `platformPenaltyAccount` (default `658000`); Plan comptable row; version 1.0.15. |
| 3 | `plugins/sdk/` | `coreModules.json` | T | Expose `platformPenaltiesModel` (read) to plugins (accounting, reconciliation) — included in SDK 2.8.0 if lot 3 ships with lot 2, else 2.9.0. |
| — | `scheduledTasks.js` | — | — | (none — the job is the plugin's) |
| — | `middleware/` | — | — | (none — existing `admin` role check) |

### 4.2 Client side (`client/src/`)

| Lot | Layer | File | T/C | Responsibility in this change |
|---|---|---|---|---|
| 1 | `plugins/online-payment/` | `LinkTransactionDialog.jsx` | T (rewrite) | Both directions (fiche → credits, credit → receipts): plausible list, search, folded full list, checkboxes, live server preview, « Modifier la répartition », inline refusals (rules 1–8, 14). Full screen on `xs`. |
| 1 | `plugins/online-payment/` | `ReservationReconciliationCard.jsx` | T | Opens the dialog without credits from the block (rule 10); shows a group's « couvre aussi » (rule 19). |
| 1 | `plugins/online-payment/` | `ReconciliationPage.jsx` | T | Counters as filters + chip + `Échap` + URL param (rule 11); « Tout confirmer » + its dialog (rules 12–13). |
| 1 | `plugins/online-payment/` | `BulkConfirmDialog.jsx` | C | The bulk dialog (count, total, « à vérifier » checkbox, result). Specific: bound to the `bulk` payload. |
| 1 | `plugins/online-payment/` | `api` (sdk) / `reconciliationApi.js` | T | `getFicheCredits`, `previewAllocation`, `linkBatch`, `confirmAll`, `filter` param. |
| 2 | `plugins/online-payment/` | `ReconciliationLine.jsx` | T | Multi-credit proposal (« 2 virements : … »), « auto » badge, group shares → opens the split dialog (rules 15, 18, 21). |
| 2 | `plugins/online-payment/` | `ReconciliationSettingsCard.jsx` | T | Switch « Confirmer automatiquement les correspondances sûres » (rule 20). |
| 2 | `components/` | `PaymentDeadlinesAlert.jsx` | T | Renders an optional `row.bank` decoration (label + « Confirmer ») — generic, nothing when absent (rule 22). |
| 3 | `components/reservation/` | `PlatformStatementEditor.jsx` | T | « Déclarer une pénalité » + penalty lines with « Supprimer » (rules 24, 30). |
| 3 | `components/reservation/` | `PlatformPenaltyDialog.jsx` | C | Amount, motif (with suggestions), date, the before/after choice, server preview, inline refusals (rules 24–26, 29). Specific to the platform statement. |
| 3 | `plugins/online-payment/` | `ReconciliationLine.jsx` | T | `declarePenalty` action on a gap opens `PlatformPenaltyDialog` through the client SDK (rule 24). |
| 3 | `plugins/sdk/` (client) | `index.js` | T | Re-export `PlatformPenaltyDialog` so the plugin opens the core dialog. |
| 3 | `services` / `api.js` | `api.js` | T | `listPenalties`, `previewPenalty`, `declarePenalty`, `removePenalty`. |
| — | `hooks/`, `utils/`, `constants/` | — | — | (none — search is server-side; motif suggestions come with the preview payload) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `FormDialog`, `ConfirmDialog`, `StatusBadge`, `EmptyState`, `ErrorAlert`, `LoadingState`, `PageTabs`, `TableCard`, `PlatformChip`, `AttentionCard`, `useToast` | Through the SDK for the plugin. |
| **Created (new generic)** | `FilterChip` — « Écarts · 9 ✕ » active-filter chip with a close button and `Échap` handling. | Generic: the Clients page (« passés masqués ») and the finance tables need the same « active filter, one click to leave » pattern. `client/src/components/FilterChip.jsx`, JSDoc. |
| **Specific (kept feature-local)** | `LinkTransactionDialog`, `BulkConfirmDialog`, `PlatformPenaltyDialog` | Each is bound to one server payload (allocation preview, bulk summary, penalty preview); their parts are compositions of `FormDialog`, MUI `Checkbox`, `TextField`. |

### 4.3 API contract

Reconciliation routes: role `admin`, 404 `PLUGIN_INACTIVE` when the plugin is off, 409 `QONTO_NOT_CONNECTED`.

| Method | Endpoint | Request | Response |
|---|---|---|---|
| GET | `/api/payments/reconciliation/reservations/:id/credits?q=&offset=` | — | `{ receipts: [{ key, label, openCents, anchorDateLabel }], likely: [Credit], others: { total, offset, items: [Credit] }, query: { tokens: [{ kind: 'date'\|'amount'\|'text', value }] } }`, `Credit = { transactionId, amountCents, remainingCents, dateLabel, counterparty, reference, reasons: ['exact'\|'amount'\|'name'], fitsKey, proposedElsewhere, partlyUsed }`. 422 `RESERVATION_OUT_OF_SCOPE`. |
| POST | `/api/payments/reconciliation/allocation-preview` | `{ reservationId?, transactionIds: [id], receiptKeys?: [key], pairs?: [{ transactionId, reservationId, ledgerKey, amountCents }] }` | `{ valid, pairs: [...], receipts: [{ key, label, expectedCents, coveredCents, after: 'covered'\|'partial' }], leftover: [{ transactionId, cents, dateLabel }], errors: [{ field, message }] }` — never writes. |
| POST | `/api/payments/reconciliation/links/batch` | `{ pairs: [{ transactionId, reservationId, ledgerKey, amountCents }] }` (≤ 10 credits) | 201 `{ ok, marked, notWritten }`; 422 `ALLOCATION_EXCEEDS_TRANSACTION`, `ALLOCATION_EXCEEDS_RECEIPT`, `SHARES_DO_NOT_SUM`, `INVALID_ALLOCATION`; core refusals pass through; nothing stored on any error. |
| GET | `/api/payments/reconciliation?view=&filter=` | — | v1 payload + `filter` echoed + `bulk: { proposalIds, count, totalCents, toVerify: { proposalIds, count, totalCents } }` + `autoConfirmed: { count, at }` (last read). |
| POST | `/api/payments/reconciliation/confirm-all` | `{ proposalIds: [id] }` | 200 `{ confirmed: [{ proposalId, keys }], skipped: [{ proposalId, reason: 'changed'\|'refused', message }], totalCents }`. |
| GET | `/api/dashboard/payment-deadlines` (core) | — | Each row may carry `bank: { state, label, proposalId? }` when a decorator is registered. |
| GET | `/api/reservations/:id/platform-penalties` (core) | — | `{ items: [{ id, amount, reason, date, dateLabel, payoutAdjusted }], total, canDeclare, suggestions: [string] }` |
| POST | `/api/reservations/:id/platform-penalties/preview` | `{ amount, reason, date, payoutIncludesPenalty? , source? }` | `{ valid, needsChoice, before: { payout, commission, netReceived }, after: {…}, warnings: [string], errors: [{ field, message }] }` |
| POST | `/api/reservations/:id/platform-penalties` | same body | 201 `{ item, reservation: { platformPayoutAmount, platformCommissionAmount, platformPenaltyAmount } }`; 422 `PENALTY_NOT_PLATFORM`, `PENALTY_EXCEEDS_PAYOUT`, `COMMISSION_NEGATIVE`, `INVALID_PENALTY`; 409 on a cancelled stay. |
| DELETE | `/api/reservations/:id/platform-penalties/:penaltyId` | — | 200 `{ ok, payoutRestored: boolean, message? }` |

---

## 5. Data model

Plugin migration `plugin:online-payment:reconciliation_v2` (idempotent, column-existence checked):

```sql
ALTER TABLE bank_reconciliation_lines ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;   -- rule 21
ALTER TABLE bank_reconciliation_lines ADD COLUMN groupId TEXT;                      -- lines confirmed together (rules 8, 19)
```

Core migration in `database.js`:

```sql
CREATE TABLE IF NOT EXISTS reservation_platform_penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amountCents INTEGER NOT NULL CHECK (amountCents > 0),
  reason TEXT NOT NULL,
  penaltyDate TEXT NOT NULL,                 -- YYYY-MM-DD, the accounting date (rule 28)
  source TEXT NOT NULL DEFAULT 'fiche',      -- fiche | reconciliation
  payoutAdjustedFrom REAL,                   -- payout before the declaration, case « after » (rule 30)
  payoutAdjustedTo REAL,                     -- payout the declaration wrote
  createdAt TEXT NOT NULL DEFAULT (datetime('now')), createdBy INTEGER
);
CREATE INDEX IF NOT EXISTS idx_platform_penalties_res ON reservation_platform_penalties (reservationId);
ALTER TABLE reservations ADD COLUMN platformPenaltyAmount REAL NOT NULL DEFAULT 0;  -- Σ lines, euros
```

`platformPenaltyAmount` follows the precedent of `installmentsPaidAmount` (direct-installments rule 23): every
reader of the stay's money already loads the row, so none of them learns about the table.

**Data impact:** new columns default to 0 / NULL — every existing reservation, line and accounting entry is
unchanged until a penalty is declared or an automatic confirmation runs. Past penalties already hidden in a
commission are not detected; declaring them (case « after ») moves the amount out of the commission (rule 25).
`CHANGELOG` gets a `Migration` fragment for each lot that adds a column.

## 6. UI / UX

The interactive mock-ups of the summary page are the reference.

- **Fiche — « Rattacher un virement »** (`FormDialog`, title « Rattacher des virements », full screen on `xs`):
  1. head: the fiche's open receipts as compact lines « Acompte · 300,00 € · avant le 14/03 »;
  2. search field « Nom, date (12/03) ou montant (596,58) » — 16 px font on mobile (no zoom);
  3. « Correspondances probables » — rows: checkbox · amount (tabular) · date · counterparty + reference
     (wrapping, `overflow-wrap:anywhere`) · reason chips « montant exact » / « ±5 € » / « nom » ·
     « reste 120,00 € » when partly used · « proposé ailleurs » in neutral when the matcher proposes it to
     another fiche;
  4. « Tous les virements disponibles (63) » — folded `details`-like disclosure, same rows, « Afficher plus »;
  5. sticky footer: « 2 virements · 1 000,00 € » + per receipt « Acompte couvert · Solde 700,00 € sur
     700,00 € » + leftover warning, « Modifier la répartition » link, primary « Rattacher » (disabled until
     the preview is valid). Empty search: « Aucun virement ne correspond à « … » » + « Effacer la recherche ».
     No plausible credit: the probable section says « Aucun virement proche du montant attendu » and the
     full list opens.
- **Page** — `PageActionBar`: title « Rapprochement bancaire », subtitle « Lu le 22/10 à 14:05 »; actions
  before Save-less zone: « Actualiser » (sync, `info`), « Tout confirmer » (done-all, `success`, hidden when the
  view holds no proposal). Counters = toggle buttons (pressed state: 2 px primary ring + tinted fill); active
  filter chip `FilterChip` above the list. After a read with automatic confirmations, an info line « 12
  rapprochements automatiques · Voir » above the counters.
- **Bulk dialog** — `ConfirmDialog`-shaped: count + total in large tabular figures, one sentence on what is
  written, checkbox for « à vérifier », primary « Confirmer 33 ». Result as a toast; skipped items stay in the
  list with their reason.
- **Group proposal** — the line shows « Versement groupé · 3 séjours » and the other fiches covered; when
  shares are needed, « Confirmer » reads « Répartir et confirmer ».
- **Home « Échéances » card** — under a decorated row, one caption line: « Virement trouvé : 596,58 € le
  12/11 » with a text button « Confirmer », or « Rien sur le compte » in secondary text.
- **Penalty dialog** — `FormDialog` « Pénalité plateforme »: amount (inputMode decimal), motif (`Autocomplete`
  freeSolo with the suggestions), date; the before/after radio when needed; a preview block « Commission
  152,40 € → 112,40 € · Net reçu 610,02 € → 570,02 € »; warnings (exported month) in `warning.soft`. On the
  fiche, each penalty is one line in the « Paiement plateforme » block: « Pénalité · Frais de relogement ·
  −40,00 € · 12/06 » + delete icon (tooltip « Supprimer la pénalité »).
- **Copy rules** — short, impersonal, no mechanics: never « FIFO », « algorithme », « sous-ensemble ».
- **Responsive** — `xs`: dialogs full screen, list rows stack (amount + date on line 1, counterparty on line 2,
  chips line 3), footer sticky at the bottom with the primary button full width; counters 2 × 2; the filter
  chip wraps under them; table → cards (v1). `md`: dialog 640 px wide. `lg`: page table as v1. Touch targets
  ≥ 44 px (checkbox rows are whole-row tap targets).

## 7. Test plan

### Server unit tests (`server/src/plugins/online-payment/tests/`, one file per subject)
- [ ] `reconciliation-fiche-credits.unit.test.js` (12) — rules 1–4, 10: available only, partly used shown,
      ±15 d × ±5 € plausibility, name reason, ordering, no 40 cap (a March credit reaches a March fiche),
      search tokens date / amount / integer amount / text / AND / invalid date as text, block without credits.
- [ ] `reconciliation-allocation.unit.test.js` (10) — rules 5–9: FIFO over deposit + balance, over-cover leftover,
      under-cover partial, manual pairs refused (above credit, above receipt, ≤ 0, 3 decimals), equal
      installments take the earliest due, paid installment skipped.
- [ ] `reconciliation-link-batch.unit.test.js` (6) — rule 8 on a real schema: two credits mark the acompte, one
      refusal stores nothing, core refusal passes through, ≤ 10 credits.
- [ ] `reconciliation-page-filters.unit.test.js` (5) — rule 11: each filter's set, unknown filter ignored.
- [ ] `reconciliation-confirm-all.unit.test.js` (8) — rules 12–13: summary excludes « à vérifier » and
      share-needing groups, totals, changed id skipped, one refusal doesn't block the others.
- [ ] `reconciliation-credit-to-receipts.unit.test.js` (4) — rule 14.
- [ ] `reconciliation-split-payments.unit.test.js` (6) — rules 15–16: 150 + 150 → acompte, 3 credits → stay,
      name required, ±30 d, equal installments not alternatives.
- [ ] `reconciliation-grouped-payouts.unit.test.js` (9) — rules 17–19: 3 estimated Booking rows in one credit,
      14-day run constraint refuses a cross-month combo, tolerance 1 % per estimated row, confidence table,
      `SHARES_DO_NOT_SUM`, group shown on every fiche, discard of the group.
- [ ] `reconciliation-auto-confirm.unit.test.js` (8) — rules 20–21: only « sûr » single exact, never a payout
      write, never on page load, setting off, `auto = 1`, history wording, undo discards the pair.
- [ ] `reconciliation-deadline-decorator.unit.test.js` (5) — rule 22: proposed / nothing / reconciled-dropped,
      `late` out of the gap count.
- [ ] `server/src/tests/payment-deadlines-decorator.unit.test.js` (3) — rule 22 core side: no decorator →
      rows unchanged, decorator applied, decorator throwing → rows unchanged.
- [ ] `server/src/tests/platform-penalties.unit.test.js` (14) — rules 23–27, 29–30: direct refused, guards,
      before / after cases with commission figures, negative commission refused, preview warnings for a past
      month, removal restores the payout only if unchanged, aggregate column kept in sync, history entries,
      ledger detail line, finance readers net of penalties.
- [ ] `server/src/plugins/accounting-export/tests/accounting-platform-penalty.unit.test.js` (6) — rule 28 (and
      `accountant-accounting-export.md` rule 36): own entry, no VAT, balanced, account setting, case « after »
      commission lowered, no 70xxx touched.
- [ ] `reconciliation-penalty.unit.test.js` (4) — rules 24, 31: gap → `declarePenalty` with the gap, expected
      bank amount net of penalties, written payout = credit + acompte net + penalties.

### Client tests
- [ ] `client/src/plugins/online-payment/__tests__/LinkTransactionDialog.fiche.test.jsx` (8) — groups render, folded
      list, search calls the server, ticking calls the preview, footer from the preview, inline refusal disables
      « Rattacher », mobile full screen.
- [ ] `…/__tests__/LinkTransactionDialog.from-credit.test.jsx` (4) — rule 14.
- [ ] `…/__tests__/ReconciliationPage.filters.test.jsx` (5) — counter pressed, chip, close, `Échap`, URL.
- [ ] `…/__tests__/BulkConfirmDialog.test.jsx` (5) — count / total, checkbox updates both, result toast.
- [ ] `client/src/components/__tests__/FilterChip.test.jsx` (3).
- [ ] `client/src/components/__tests__/PaymentDeadlinesAlert.bank.test.jsx` (3) — decoration rendered, absent.
- [ ] `client/src/components/reservation/__tests__/PlatformPenaltyDialog.test.jsx` (6) — choice shown only when
      needed, preview figures, refusals inline, suggestions.

### E2E (Playwright)
- [ ] `e2e/reconciliation-fiche-link.spec.js` — fiche → dialog → search « 12/03 » → tick two credits → « Rattacher »
      → ledger « Perçu le 20/03 »; 390 px run with the full-screen dialog.
- [ ] `e2e/reconciliation-bulk-confirm.spec.js` — counter filter on/off, « Tout confirmer », count matches.

### Recette on the shadow (CSV export, never the real Qonto)
- [ ] Before / after on the 2026-10-22 copy: fiche dialog lists (plausible count per fiche, no fiche without its
      own credits in reach), grouped payouts found among the 14 unmatched credits, auto-confirmed count vs the
      21 « sûr », each auto-confirmation checked by hand. Report with real names stays in the private shadow folder.

### Manual UI verification
- [ ] Happy path per lot (dialog, bulk, penalty), one edge case each (search with no result, a changed id in
      bulk, a penalty above the payout), mobile 390 px (no horizontal scroll, sticky footer reachable with the
      keyboard open), regression: v1 confirm / discard / undo, the home « Échéances » card without the plugin.

## 8. Out of scope

- Debits: a platform invoicing a penalty to be paid by card or transfer, refunds to guests, chargebacks.
- Linking a penalty to a second stay (the stay it concerns vs the payout it reduced).
- Auto-confirming anything but « sûr » single exact matches; auto-writing a payout or an amount.
- Configurable margins (±5 € / ±15 days are constants; revisit after the recette).
- Penalties on direct stays (a guest's deduction is a discount: `DISCOUNT_ACCOUNT`, existing).
- Changing the Qonto read rhythm (8 h) or adding the transactions webhook.

## 9. Open questions

All resolved by Adrien on 2026-10-28.

- A1: Automatic confirmation of « sûr » matches. **Resolved 2026-10-28: on by default** (rule 20), undoable,
  marked « auto », with a setting to turn it off.
- A2: The due-date alert. **Resolved 2026-10-28: decorate the existing core « Échéances » card** through a new
  generic hook `ctx.paymentDeadlineDecorator` (rule 22); no separate plugin alert.
- A3: Penalty account. **Resolved 2026-10-28: `658000` by default, editable** in the accounting-export settings
  (Plan comptable card). The number is a placeholder: **it must be confirmed with the accountant** before the
  first penalty is booked for real (noted in the PR).
- A4: Lot order. **Resolved 2026-10-28: 1 → 2 → 3.**
- Q5: The amount margin. **Resolved 2026-10-28: fixed ±5,00 €** (rule 2); not configurable.

## 10. Implementation lots

| Lot | Content | Rules | Ships alone? | Size |
|---|---|---|---|---|
| 1 | Fiche dialog (plausible, search, folded list, multi-credit, manual split), page filters, bulk confirmation, linking a credit to several receipts | 1–14 | Yes — plugin only, no core change | ~10 files, ~55 tests |
| 2 | Split-payment and grouped-payout proposals, plan order, automatic confirmation, due-date card decoration (SDK 2.8.0) | 15–22 | Yes, after lot 1 (uses its batch path and split dialog) | ~12 files, ~40 tests |
| 3 | Platform penalties: core table + column, fiche dialog, ledger + finance readers, accounting entry, reconciliation link | 23–31 | Yes — core + 2 plugins; the reconciliation link needs lot 1 | ~16 files, ~35 tests |
