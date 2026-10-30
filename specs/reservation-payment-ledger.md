# Payments as a status ledger

| Field | Value |
|---|---|
| **Status** | Implemented (rules 1-49) · Implemented — amendment of 2026-10-28 (rules 50-64, §3.8; 53-55 withdrawn) |
| **Branch** | `docs/payments-ledger-spec` (spec, #718) · `feature/reservation-payment-ledger` (implementation) |
| **Created** | 2026-10-19 |
| **Author** | Adrien |
| **Related PR** | #718 (spec) |
| **Amendment 2026-10-28** | Branch `feature/clients-directory-and-fiche-tariff` · summary [docs/specs/2026-10-28-clients-directory-and-fiche-tariff.html](../docs/specs/2026-10-28-clients-directory-and-fiche-tariff.html) |
| **Summary page** | [docs/specs/2026-10-19-reservation-payment-ledger.html](../docs/specs/2026-10-19-reservation-payment-ledger.html) — interactive mocks at 390 and 1280 px |

---

## 1. Context

UI/UX review of 2026-10-18 (`docs/rapports/2026-10-18-ui-ux-review.html`, reservations zone,
proposal 5, mock « ledger »). **Decision 8** (Adrien, 2026-10-19): « Spec d'abord, puis
implémentation » — with one condition: « il faut quand même pouvoir setter les montants notamment
pour la partie solde et acompte ».

The « Finance » card of the reservation fiche
([FinanceSection.jsx](../client/src/components/reservation/FinanceSection.jsx), 1 556 lines) mixes
inputs, explanations and actions:

- **State is never shown as a state.** Acompte, Solde and Caution are toggle buttons (« Marquer solde
  payé » → « Solde payé »). The only status signal is the button's fill colour. There is no
  « due on », « late », « paid by link », « paid at the door » anywhere on the card.
- **Empty inputs are always on screen.** « Date réception » / « Date restitution » of the caution show
  `mm/dd/yyyy` before anything was received; « Échéance acompte » / « Échéance solde » are editable
  date inputs although the server derives them
  ([payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) §3.1).
- **Four button styles** for one role (ink-outlined pill, green outlined, green filled, info filled).
- **Nothing guards the order of events.** « Marquer caution restituée » works on a caution never
  received: `updatePayment` writes `cautionReturned` unconditionally, and `PUT /api/reservations/:id`
  writes the four caution columns straight from the browser's form
  ([reservationsModel.js `updateReservation`](../server/src/models/reservationsModel.js); the
  past-locked whitelist of `reservationsController.update` lets them through too). A paid date can be
  typed in the future for the acompte, the solde and the caution — only the single arrival payment
  validates its date ([arrivalPaymentDate.js](../server/src/utils/arrivalPaymentDate.js)).
- **Caution writes are drafts, other marks are immediate.** Acompte, solde and complements are PATCHed
  at once (rule 11bis of [single-payment-from-the-fiche.md](single-payment-from-the-fiche.md)); the
  caution waits for « Enregistrer » unless the fiche is locked. Same gesture, two behaviours.
- **Marking can record the wrong amount.** The acompte amount is a form field saved with
  « Enregistrer », while « Marquer acompte payé » is an immediate PATCH: edit the amount, mark it paid
  without saving, and the server records the payment at the *stored* (old) amount.
- **Amounts: only the acompte is settable.** `depositAmountOverride`
  ([editable-deposit-amount.md](editable-deposit-amount.md)) freezes the acompte; the solde is always
  derived (`solde = pre-arrival − acompte`), and that spec lists « editing the balance directly » as
  out of scope. The engine **silently clamps** an acompte above the accommodation
  (`pricing.js` frozen-deposit branch) — the operator types 900 and sees 840 without a word.
- **Payment links drift.** A Qonto link is minted for an amount (`payment_links.amountCents`). When the
  acompte or solde changes afterwards, the open link stays payable at the old amount until somebody
  re-sends the request ([paymentRequestService.js](../server/src/utils/paymentRequestService.js)
  retires a stale link only on the next `ensurePaymentLink`). If the guest pays it in between, the poll
  records the bucket as paid at the **new** amount
  ([paymentPollRunner.js `applyPaidEffect`](../server/src/utils/paymentPollRunner.js)). The fiche
  never shows a link's status at all.
- **The client derives states.** Paid/unpaid, « paiement unique », what can be edited and why: all
  computed in `FinanceSection` from raw flags (CLAUDE.md §6.0 anti-pattern).

## 2. Goal

The operator reads the money of a stay as **one ledger**: one row per money movement, each with its
amount, its state in words and one action. Acompte and solde amounts stay settable from their row,
with the consequence shown before it is applied and any invalid amount refused on the spot, in French,
next to the field.

---

## 3. Functional rules

### 3.1 The ledger is a server payload

1. **One row per money movement**, built by the server and rendered as is (CLAUDE.md §6.0). The
   server decides the rows, their order, their labels, their amounts, their state, their single
   action, and whether and why their amount can be edited. The client computes none of it.
   Decision 8 of the UI/UX review 2026-10-18.
2. **Row order is the order money moves**: Acompte → Solde (or « Versement <plateforme> ») →
   Complément d'arrivée → Notes en séjour → Complément de fin de séjour → Remboursements →
   Caution reçue → Caution restituée. A row that does not apply collapses to one muted line
   (rule 6) instead of disappearing, except the complement, note and refund rows, which appear only
   when they carry money — as today.
3. **Each row carries**: `key`, `label`, `amount` (cents-exact, tabular), `state`, `stateLabel`
   (French, ready to print), `tone` (`due` | `late` | `done` | `muted` | `info` | `warning`), at most
   **one** primary action, an optional `detail` (the lines, the commission, the link, a warning) and
   an `amountEdit` descriptor (`{ editable, min, max, reason }`, rule 15).
4. **States and their labels** (dates `JJ/MM`, year only when it differs from the stay's):

   | State | Label | Tone |
   |---|---|---|
   | due, deadline ahead | « À percevoir avant le 23/08 » | `due` |
   | due, deadline passed | « En retard depuis le 23/08 » | `late` |
   | due, no deadline (complement) | « À percevoir à l'arrivée » / « … au départ » | `due` |
   | paid | « Perçu le 12/08 · <origine> » | `done` |
   | paid inside a single payment | « Perçu le 14/08 · paiement unique » | `done` |
   | caution received / returned | « Reçue le 14/08 » / « Rendue le 21/08 » | `done` / `done` |
   | waiting on another row | « Après réception » | `muted` |
   | not applicable | « Sans objet · <raison> » | `muted` |

   The origin of a paid row is what the data already knows, read-only: « lien de paiement » (a
   `paid` `payment_links` row of that type), « caisse interne » (`*PaidCash`, set today by the arrival
   SAS for acompte and solde, and by the complement toggles), « <plateforme> » (a platform payout),
   « paiement unique » (an `arrivalPaymentGroup` naming the bucket), else nothing. No new column
   (see §9 Q2).
5. **« Reste à percevoir »** closes the ledger. It is **`reservationSettlement.remainingToPay`** —
   the function the Finance « Suivi opérationnel » already uses
   ([finance-operational-remaining-to-pay.md](finance-operational-remaining-to-pay.md) §3): the sum
   of the still-unsettled buckets (acompte, solde, both complements; a caisse-interne bucket counts
   as settled), **net of the commission of each unsettled platform échéance**, so a Booking stay
   shows what will reach the bank. One « reste dû » in the whole application: the ledger adds no
   arithmetic of its own. It reads « Tout est perçu » at zero and never repeats the « Net perçu » or
   « Total du séjour » of the pricing summary. (`paymentStatus.computePaymentStatus` — `finalPrice`
   minus paid acompte and solde, gross, no complements — is referenced by its unit test only; the
   ledger does not use it.)
6. **Rows that do not apply** say why, in one muted line, with no input and no action:
   - acompte on a platform without acompte — « Sans objet · Booking.com encaisse en une fois »;
   - acompte disabled on the reservation — « Sans objet · acompte désactivé »;
   - acompte off for the property, or a last-minute stay
     ([deposit-blocks-the-dates.md](deposit-blocks-the-dates.md) rules 4-6) — « Sans objet · paiement
     en une fois »;
   - caution of a property with no caution — « Sans objet ».
7. **The ledger shown is the stored one; the live one only while the fiche is edited.** Opening a
   fiche shows the ledger of `GET /api/reservations/:id`, built from the stored row: the « Reste à
   percevoir » and the reconciliation chip are then exactly those of Finance (`remainingToPay`, the
   stored net). Once the operator changes the fiche, the unpaid rows follow `POST
   /api/reservations/calculate-price` (the live quote the pricing summary reads) and the paid rows keep
   the stored row — never on a past, locked fiche, which always shows the stored ledger. A fiche never
   saved (new reservation, devis) has only the live one. *Amended 2026-10-19 after the review of #727:*
   following the live quote on an unmodified fiche contradicted Finance on 20 of the 56 Solio stays
   (iCal imports without a price shown « En retard » with invented remainders, platform stays priced
   under an earlier tourist-tax rule showing a false écart, a 50 € meal hidden), and every mark then
   compared the live amount with the stored one (409 loops).

### 3.2 Recording a movement

8. **One action per due row: « Marquer perçu »** (« Recevoir » for the caution, « Restituer » for its
   return, « Marquer reçu » for a platform payout). It opens an inline form under the row — never a
   dialog — with the date prefilled to today and « Valider » / « Annuler ». The complement rows keep
   their existing « Caisse interne » toggle in that form
   ([cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md)); the
   acompte and solde rows have **none** — `depositPaidCash` / `balancePaidCash` are set only by the
   arrival SAS and shown read-only as the row's origin (rule 4), as today. Closing the form restores
   the row exactly.
9. **The date is validated by the server**, for every mark: a real calendar day, **not in the
   future** (« Un encaissement ne peut pas être daté dans le futur. »). The refusal is shown under the
   date field and the form stays open with the typed value. The « not before the reservation
   existed » bound of [arrivalPaymentDate.js](../server/src/utils/arrivalPaymentDate.js) is **not**
   applied to ledger marks: reservations entered after the fact (Abritel stays typed by hand, iCal or
   intake imports) carry a `createdAt` later than real payments. It stays on the single arrival
   payment, unchanged.
10. **Marking saves the fiche first.** « Valider » runs through the page's existing `saveThenRun`
    pipeline (as the mid-stay notes do), then PATCHes the mark. A mark can never be recorded against
    an amount the server has not stored.
11. **The mark carries the amount the operator saw.** `PATCH /api/reservations/:id/payment` accepts
    `expectedAmountCents` (an integer) for the acompte, the solde and the complements; the server
    compares it with `Math.round(storedAmount × 100)` and, when they differ, refuses with 409
    `AMOUNT_CHANGED` (« Le montant a changé entre-temps : relire la fiche. ») and records nothing.
    Two open tabs cannot book two different amounts.
12. **The caution follows the order of events.** « Restituer » is offered only once the caution is
    received (state « Après réception » until then); the server refuses `cautionReturned` without a
    received caution (409 `CAUTION_NOT_RECEIVED`, « La caution n'a pas encore été reçue. ») and a
    return date before the receipt date (« Restitution avant la réception (14/08). »). Caution marks
    become immediate PATCHes like every other mark (no more draft-until-save).
13. **The save never writes a payment state.** Rule 11bis of
    [single-payment-from-the-fiche.md](single-payment-from-the-fiche.md) (the paid flags of acompte,
    solde and complement are re-read from the database by `PUT /api/reservations/:id`, never taken
    from the browser) is extended to the four caution columns `cautionReceived`,
    `cautionReceivedDate`, `cautionReturned`, `cautionReturnedDate`: `reservationsModel.
    updateReservation` writes the stored values back, and the past-locked whitelist of
    `reservationsController.update` drops them. The PATCH of rules 9-12 is the only way to change
    them, so its guards cannot be bypassed by a save.
14. **Undoing a mark** is the row's action once it is done (« Annuler »). It asks for confirmation
    (« Annuler la perception de l'acompte du 12/08 ? L'écriture comptable correspondante disparaît. »,
    §9 Q4), then behaves exactly as un-ticking does today: contributions released
    (`clearContribsOnUnflip`), single-payment group dissolved
    ([single-payment-at-check-in.md](single-payment-at-check-in.md) rule 17). Undoing « Caution reçue »
    also undoes « Caution restituée ».

### 3.3 Setting the amounts — acompte and solde

Notation for a direct stay: **P** = pre-arrival amount (acompte + solde), **H** = its accommodation
part, **T** = the tourist tax riding on the solde (`P = H + T`,
[tourist-tax-on-solde.md](tourist-tax-on-solde.md)). All amounts are euros rounded to the cent
(`roundMoney`); the field accepts « 12,5 », « 12.5 » and arithmetic
([reservation-price-arithmetic.md](reservation-price-arithmetic.md)), and a value with more than two
decimals is rounded and shown rounded.

15. **Every row says whether its amount can be edited, and why not.** The server sends
    `amountEdit = { editable, min, max, reason }`. An editable amount shows a « Modifier » affordance
    on the amount itself; a non-editable one shows its reason on demand (« Acompte perçu le 12/08 :
    annuler la perception pour corriger le montant. »). Decision 8 condition: acompte and solde stay
    settable.
16. **Acompte, not yet perceived: `0 ≤ A ≤ H`.** Same freeze as today
    ([editable-deposit-amount.md](editable-deposit-amount.md) rules 2-3, 5-8): the value is stored in
    `depositAmountOverride`, the solde becomes `P − A` and absorbs every later price change; emptying
    the field restores the percentage. **What changes:** an out-of-range value is **refused**, no
    longer silently clamped — negative: « Un montant ne peut pas être négatif. »; above H:
    « L'acompte ne dépasse pas l'hébergement (840,00 €) : la taxe de séjour reste sur le solde. »
    The engine keeps its clamp as a last line of defence (rule 17).
17. **Solde, acompte not yet perceived: `T ≤ S ≤ P`.** Typing the solde sets the split, not the
    price: the server stores `depositAmountOverride = P − S` and the total of the stay does not move.
    Below T: « Le solde porte la taxe de séjour (26,40 €) : pas en dessous. »; above P: « Au-delà du
    séjour (866,40 €) : modifier le prix de l'hébergement. » What stays fixed afterwards is the
    **acompte**, exactly as if it had been typed (rule 16): a later price change moves the solde. If a
    later price drop brings H below the frozen acompte, the engine clamps the acompte to H as today
    and the row says so with a `warning` chip: « Acompte ramené à 780,00 € : l'hébergement a baissé ».
18. **Solde, acompte already perceived (or no acompte at all).** The split is fixed, so a different
    solde is a different price (§9 Q1, option a). The server translates it into the accommodation
    adjusted price (`customPrice`, the only price lever of a direct stay) and returns the consequence
    **before** anything is applied: « Hébergement : 840,00 € → 790,00 € · taxe de séjour 26,40 € →
    24,83 € ». Precisely:
    - **The whole engine is re-run** for each candidate price, not a formula: the tourist tax follows
      the accommodation, and so do the options priced on the stay (the cancellation insurance is a
      percentage of the accommodation, [pricing.js `cancellationInsuranceBase`](../server/src/utils/pricing.js)).
      The solver searches the cent price whose resulting solde equals S (bounded number of passes).
    - **When no cent price gives exactly S** (the tax or a percentage option rounds in steps), the
      server proposes the **nearest reachable solde** and says it: « Solde obtenu : 499,99 € (au
      centime près, la taxe suit l'hébergement) ». « Valider » applies that one, never a value the
      engine did not produce.
    - **Floor: the accommodation cannot fall below the acompte already received** (`H' ≥ A`), since
      that money is in the books as accommodation. Below: « Pas en dessous de 7,92 € : l'acompte
      perçu (252,00 €) couvre déjà l'hébergement. » (the floor is the solde at `H' = A`, its tax and
      percentage options included).
    - « Valider » applies the returned `formPatch` to the form (saved with the fiche as any price
      change, traced in the history); « Annuler » leaves everything as it was.
19. **A perceived row keeps what it collected.** On a paid acompte or solde the amount is not
    editable (rule 15). If the operator still types an amount in the editor of a paid row, the
    refusal names the right gesture: lower — « Déjà perçu : 866,40 €. Pour rendre 66,40 €, créer un
    remboursement. » with a « Créer le remboursement » button that opens the refund dialog prefilled
    ([reservation-refunds.md](reservation-refunds.md)); higher — « Déjà perçu : 866,40 €. Pour un
    autre montant, annuler la perception puis la refaire. » Consistent with
    [reservation-refunds.md](reservation-refunds.md) rule 36 (a paid solde keeps what it collected).
20. **A paid solde freezes the acompte.** If the solde is perceived and the acompte is not (an
    unusual order, but possible), the acompte amount is not editable: « Solde déjà perçu : l'acompte
    ne peut plus changer. »
21. **The server validates, the field only proposes.** The amount editor sends the typed value to
    the live quote (`ledgerEdit: { row, amount }` in the `calculate-price` body); the server answers
    with the refusal reason or with the effects (rule 18) and the exact form fields to apply
    (`formPatch`: `depositAmountOverride` or `customPrice`). The client applies `formPatch` verbatim
    and computes nothing. The same validation runs again at save (`PUT /api/reservations/:id`), so a
    crafted request gets the same refusal (400 with the same French message).
22. **Complements keep their own rules.** The arrival / end-of-stay / merged complement rows expose
    the existing « Montant ajusté » ([adjustable-complement-amounts.md](adjustable-complement-amounts.md)
    rules 1-30, floors and accounting split unchanged) through the same row editor; the mid-stay
    notes keep their per-note editing (§3.4 of that spec). Only the presentation moves.
23. **History.** Every amount set from the ledger is traced in `reservation_history` with a readable
    label (« Acompte : 252,00 € → 300,00 € », « Solde : 614,40 € → 600,00 € (acompte 266,40 €) »).

### 3.4 Platform reservations

24. **The platform row replaces the solde.** Label « Versement <plateforme> », amount = the gross
    pre-arrival amount the platform settles, state from the payout due date
    ([platform-payout-due-date.md](platform-payout-due-date.md)) — « Attendu le 22/10 » / « En retard
    depuis le 22/10 ». Its detail line reads « Commission 157,97 € · net 829,42 € ». A platform with
    acompte ([platform-deposit-toggle.md](platform-deposit-toggle.md)) shows both rows, each with its
    own commission.
25. **The platform's figures stay editable, in the row.** The amount of a platform row is not typed
    directly: « Modifier » opens the statement fields that are the levers today — « Total facturé
    par la plateforme » / « Montant total payé par le client », « Taxe de séjour retenue » and the
    per-échéance commission ([platform-payment-entry.md](platform-payment-entry.md),
    [platform-per-echeance-commission.md](platform-per-echeance-commission.md),
    [platform-tourist-tax-out-of-the-commission.md](platform-tourist-tax-out-of-the-commission.md)),
    with their labels, helpers and server rules unchanged. Once the payout is received they are
    locked like a paid row (rule 19).
26. **« Marquer reçu » asks for the transfer.** Its form holds the date and « Virement reçu »,
    prefilled with the expected net. When the typed transfer differs from the net, the form shows the
    gap (« Écart : 12,03 € avec le net attendu ») and one button, « Commission solde → 170,00 € »,
    which is today's « Calculer la commission » (`POST /api/reservations/platform-commission`, server
    computed). « Valider » writes « Virement reçu » (`platformPayoutAmount`) and, if taken, the
    commission into the form, runs `saveThenRun` (they are fiche fields saved by the PUT, as today),
    then PATCHes `balancePaid` / `balancePaidDate`. The PATCH contract is not widened. The
    reconciliation chip (« ✓ cohérent avec le virement » / « écart : … ») moves onto the row.
27. **The pricing summary keeps the hero figure** (decision 6, « Vous percevez »). The ledger does not
    repeat « Net perçu » as a separate line any more.

### 3.5 Payment links

28. **A link is shown on its row**, for every link type: `deposit` on the acompte, `balance` and
    `full` on the solde, `complement` on the arrival complement. The detail reads « Lien envoyé le
    03/08 · 252,00 € » (open), « Payé par lien le 05/08 » (paid), « Lien retiré · montant modifié »
    (rule 29) or « Lien retiré · perçu autrement » (settled another way,
    [plugins-phase-3a-online-payment.md](plugins-phase-3a-online-payment.md) rule 23). Sending a
    request stays where it is today (page actions); « Renvoyer la demande » is offered on the row
    **only while the row is still due** — never on a perceived one.
29. **Changing an amount retires its open link.** At save, for every open link whose type maps to a
    row (rule 28) and whose `amountCents` differs from the row's new amount in cents, the server checks
    the link was not paid meanwhile (`assertNotPaid`), cancels it with `cancelReason =
    'amount-changed'` and deactivates it at the provider
    ([plugins-phase-3a-online-payment.md](plugins-phase-3a-online-payment.md) rules 7-9 — provider
    down: retired locally with `remoteCancelPendingAt`, the poll retries). §9 Q3.
30. **A link paid before the save wins.** If `assertNotPaid` finds the open link paid, the save is
    refused (409 `LINK_ALREADY_PAID`, « Le lien de 252,00 € vient d'être payé : montant non
    modifié. ») and the poll records the payment as today.
31. **A link paid after it was retired still lands on the fiche.** `retryPendingCancellations` today
    records a paid retired link only for `cancelReason = 'settled'`; any other retired-but-paid link
    is just notified. For `'amount-changed'` the money is real and must be booked:
    - `deposit` → the acompte is recorded perceived **at the link's amount** (the server sets
      `depositAmountOverride` to it, then records the payment): the solde absorbs the difference;
    - `balance` / `full` → the solde is recorded perceived at the link's amount; what the stay still
      owes beyond it becomes the arrival complement (auto-gap, existing engine rule), what it owes
      less becomes a trop-perçu shown in the refund block
      ([reservation-refunds.md](reservation-refunds.md) rule 34);
    - `full` on a stay that has since grown an unpaid acompte (moved out of the last-minute window)
      → the payment covers the acompte first: the acompte is recorded perceived at its amount, the
      solde at the rest, both in one transaction, and the shortfall or the excess is handled as for
      `balance`. A payment below the acompte is booked as an acompte (`deposit` above). Review of
      2026-10-23: the solde alone used to be recorded, so the unpaid acompte was claimed on top of
      the full payment;
    - `complement` → the complement is recorded perceived the way « Marquer perçu » records it
      (`resolveComplementPayment`, single-payment group released, arrival extras baseline pinned),
      traced in the history, and the row carries a `warning` detail
      « Payé 24,00 € par un lien retiré, 30,00 € attendus » for the operator to settle;
    - in every case the row shows « Payé par lien le 05/08 (ancien montant) » and the admin is
      notified as today (`notifyPaidAfterCancel`).
    If the row was meanwhile perceived another way, the payment is a double payment: nothing is
    recorded, the admin is notified, the link keeps its `providerPaymentId` for the refund — the
    current behaviour. The withdrawal itself runs after the save has committed: a crash between the
    two leaves the link `open` and still stale, and the next save or the next poll (rule 23 of
    plugins-phase-3a, `remoteCancelPendingAt`) retires it — nothing is lost.

### 3.6 Nothing to collect

32. **A bucket with nothing to collect is never marked.** An acompte (or a solde, a complement) at
    0,00 € has no « Marquer perçu »: the acompte row reads « Aucun acompte » (muted, amount 0, no
    action; still editable when the split allows it, edge case « Solde typed equal to P »). The payment
    PATCH refuses to mark a bucket whose stored amount is zero and that is not already perceived: 409
    `NOTHING_TO_COLLECT`, « Rien à percevoir sur cette échéance. », nothing written. A 0 € acompte
    already stored as perceived (converted devis 22293 and 22296 on the Solio base, before this rule)
    is displayed as it is, with the warning « Acompte de 0,00 € marqué perçu ». A stay imported
    without a price (finalPrice 0) reads « Prix à renseigner » on its solde, never « En retard », and
    adds nothing to « Reste à percevoir ». Integrated review of 2026-10-19 on the Solio copy.

### 3.7 Review of #727 (2026-10-19)

33. **A row the save would change says so.** While the fiche is edited (live ledger, rule 7), each
    amount row carries `storedAmount`; when it differs from the live amount the row flags
    `changesOnSave` and reads « Enregistré : 45,00 € · « Enregistrer » applique le nouveau montant ».
    A mark on a modified fiche saves it first (rule 10), so the mark is compared with the amount the
    save stores; on an unmodified fiche nothing is saved — a mark never re-prices a stay on its own
    (a future stay whose stored price drifted from today's engine keeps its stored amounts until the
    operator changes something, and the history then records that change).
34. **A platform payout is received with its transfer, in one PATCH.** « Marquer reçu » sends
    `platformPayoutAmount` (and `platformCommissionAmount` when « Commission solde → … » was taken)
    with `balancePaid`: the server validates them (money ≥ 0, a commission never above the billed
    amount, only on the reception itself — unpaid → paid, rule 38 — of a stay settled by a platform;
    400 otherwise), writes them with the mark and records them in the history. « Virement reçu » is
    prefilled with the expected net only when the commission is known; otherwise it is typed, and the
    commission it implies is proposed from the gross (a gross prefilled as the transfer read « cohérent »
    with a zero commission, review of #727). No full save of the
    fiche, so a past or locked stay is never re-priced to record its payout. On a locked fiche with
    unsaved edits a mark is refused in the form (« Fiche modifiée : enregistrer ou annuler les
    modifications avant de marquer un paiement. ») instead of forcing a save. The commission button
    is offered only with a gross amount, and never when the gap equals the tourist tax (a stay priced
    under the earlier tax convention): the gap then says « (le montant de la taxe de séjour) ».
35. **Undoing a received acompte keeps its amount.** Un-ticking a perceived acompte sets
    `depositAmountOverride` to the amount received, so marking it again lands on the same amount
    instead of a re-priced one (and the solde absorbs any later price change, rule 16).
36. **A paid solde of a stay without acompte keeps what it collected.** On a direct-channel stay with
    no acompte to share the stay with, the engine keeps a perceived solde at its stored amount in both
    directions (`pricing.js`): when the stay costs more, the difference is owed as the arrival
    complement (auto-gap); when it costs less, the excess is the trop-perçu
    ([reservation-refunds.md](reservation-refunds.md) rule 34). A balance link paid after its
    retirement (rule 31) is booked that way in one transaction — solde at the link's amount, the
    shortfall added to the arrival complement, both traced in the history — so a later save never
    turns money never received into a paid solde. On the Solio base this changes one replayed stay
    (22278: the 50 € meal is no longer folded into its paid solde). The per-line accounting split of
    such a short solde cannot be captured (its conservation invariant); the payment is kept and the
    export uses its stored-money path, as for any online payment whose capture failed.
37. **A mark records the money even when the stay's stored amounts drifted.** A stay priced under an
    earlier rule (Solio 11, 12, 22245: Gîtes de France and Booking stays whose stored solde differs from
    today's engine by the tourist tax) cannot have its per-line accounting split captured — its
    conservation invariant fails. The fiche's mark used to refuse the payment (409
    `CONTRIB_CAPTURE_FAILED`); it now records it like an online payment does
    (`keepPaymentOnCaptureFailure`): flag and date written, nothing re-priced, and the bucket gets a
    **stored-amount split** (`captureStoredSplit`): the tourist tax the export puts on that entry, the
    pre-arrival lines pro rata of what is left to collect on them, the accommodation the rest. Without
    it a solde recorded after a captured acompte was booked whole on 46710000 (second review of #727,
    N1); online payments whose capture fails now get the same split. The history names the origin
    (« Encaissement (solde) » from the fiche, « Paiement en ligne (solde) » from a link), and the answer
    carries a warning the fiche shows (« Encaissement enregistré. Ses montants diffèrent du calcul actuel du séjour : la
    répartition comptable reprend les montants enregistrés. »).

38. **A bucket already perceived is never marked again.** Marking an acompte, a solde, a complement or
    a caution step that is already recorded is refused (409 `ALREADY_PAID`, « Le solde est déjà perçu.
    Relire la fiche. »): a second tab or a replayed request can neither re-date it — which would move
    its accounting entry to another month — nor rewrite its transfer or commission. Changing the date
    of a recorded payment is an undo then a redo (rules 14, 41).
39. **The sticky total bar follows the ledger.** `GET /api/reservations/:id` carries `storedHeadline`,
    built from the stored row (« Vous percevez » = Finance's net: what was collected plus what remains,
    net of commissions and refunds); the bar shows it whenever the fiche shows the stored ledger (rule
    7), the live quote's headline otherwise.
40. **A due end-of-stay complement stays due while the fiche is edited.** When the live quote no
    longer carries a mid-stay sale the stored end-of-stay complement still owes (its option line is gone
    from the fiche — Solio 22278's 50 € meal), the row keeps the stored amount and warns « « Enregistrer
    » retirerait 50,00 € encore dus : une prestation vendue en séjour n'est plus sur la fiche ».
41. **Redoing an undone payment proposes its date.** Each paid row carries `paidDate`; after « Annuler »
    the mark form proposes that date instead of today, and says so when the chosen date changes the
    accounting month (« Le mois comptable change : 03/2026 → 10/2026. »).

42. **Every path that records money shares one capture.** A mark on the fiche, an online payment, «
    Encaisser en une fois » (and its adjustment) and the SAS stay payment all capture a bucket through
    `captureBucketSplit`: the engine-replayed split, else the stored-amount split (rule 37), else — if
    even that fails — no split, logged and never thrown, so money received is never lost to its
    accounting split. Each attempt runs in its own savepoint. Before, the single payment and the SAS left
    a failed capture with no split, which, once the acompte had captured, booked the whole solde on
    46710000 (the cause of production stay 22224, June 2026, third review of #727). Already exported
    rows are not rewritten.
43. **The export announces a sale booked only on the tourist tax.** The journal (`salesJson`) lists in
    `totals.taxOnlyEntries` every sale entry whose credits are all on 46710000 — no revenue, no VAT — and
    the Comptabilité page shows them above the journal (« À vérifier avant l'envoi au cabinet »). The
    CSV itself is unchanged.
44. **The pricing summary follows the same switch.** `GET /api/reservations/:id` carries
    `storedSummary`, the money figures and dates of the stored row (accommodation, options,
    resources, tourist tax, HT / TVA computed on the stored total with the live summary's rule,
    échéances and their due dates, commissions, net, total). The ledger, the sticky bar and the summary
    never show two different totals (see rule 45).

45. **Never live lines next to stored totals.** `calculate-price` answers `storedDrift` when today's
    quote differs from the stored row (price, tourist tax, échéances or their due dates). While the
    fiche shows the stored ledger and the quote has drifted, the « Résumé tarifaire » (desktop panel and
    phone sheet) is the stored one, whole (`StoredPricingSummary`): stored figures and dates only, no
    per-night or per-option detail (the quote's lines no longer add up to the stored total), and the
    sentence « Montants enregistrés. Le calcul actuel du séjour diffère : il s'affiche dès que la fiche
    est modifiée. » Without drift the live summary already says the same and stays. Final review of
    #727 (fiche 11: Total HT 1 822,66 + TVA 182,26 = 2 004,92 and « À payer avant 03/09 » next to a
    stored 1 954,52 and « En retard depuis le 10/08 »).

46. **The stored-amount split only on a reservation that already has a contribution.** The export
    chooses its path per reservation (`accountingModel` `hasContribs`): the first contribution written
    on a stay moves every one of its entries onto the per-line path, where a bucket recorded without one
    reads 0 and is dropped. So when the engine split fails, `captureBucketSplit` writes the stored split
    (rule 37) only if the reservation already carries a contribution — the case of an acompte captured
    and a drifted solde (rule 42). On a stay with none — an older stay whose acompte was recorded before
    contributions existed — the bucket stays without one (`'legacy'`) and the whole stay keeps the
    stored-money path, as it always had: its earlier entries, possibly already sent to the accountant,
    are unchanged. Found while porting rule 42 to master (2026-10-19); reproduced on `inte/plugins`
    (acompte of May 2026 vanishing from the May export once the solde was marked in October).
47. **An open link paid for an amount the stay no longer asks for is booked at its amount.** Rule 29
    retires a stale link only on the fiche's save; a stay re-priced through `performUpdate` (plugins,
    arrival SAS, arrival payment) keeps it open. When the poll or the webhook finds such a `deposit`,
    `balance` or `full` link paid (`processPaidLink`), its `amountCents` is compared with the row and a
    mismatch is booked exactly as rule 31 books a retired link — never by ticking the bucket at the
    row's new amount. A bucket already perceived another way keeps the earlier behaviour (the
    idempotent recorder records nothing). Review of `inte/plugins`, 2026-10-23.

**Edge cases:**

- Acompte override set, then the platform switched from direct → the engine ignores it as today; the
  acompte row reads « Sans objet » and its editor is gone.
- Solde typed equal to P (acompte unpaid) → acompte 0 €, row « Acompte 0,00 € » kept (it is an
  explicit choice, distinct from « Sans objet »), deadline NULL as today.
- Solde typed with acompte unpaid **and** a single arrival payment group naming the acompte → the
  group is the truth: the acompte is perceived, so rule 18 applies, not rule 17.
- Cancelled reservation → the ledger is read-only (`cancelledGuard`); the rows keep their states, the
  retained acompte reads « Conservé · indemnité d'annulation »
  ([cancellation-compensation.md](cancellation-compensation.md)).
- Past reservation, locked → the marks stay available, as the lock banner promises (« les statuts de
  paiement/caution restent modifiables ») — a platform payout always arrives after the stay. A solde
  typed while the acompte is perceived (rule 18) changes the accommodation price, which the lock
  forbids: the editor refuses it (« Séjour commencé : déverrouiller la fiche pour changer le prix de
  l'hébergement. ») until an admin unlocks the fiche
  ([admin-unlock-past-reservations.md](admin-unlock-past-reservations.md)). Decided at implementation
  (2026-10-19): read-only would have blocked every payout.
- Reception-only user → the ledger is not sent (finance-stripped view, unchanged).
- Devis → the ledger shows the planned acompte / solde, no « Marquer perçu », no caution rows. The
  amounts are not editable from the ledger yet: the devis model does not store `depositAmountOverride`
  (editable-deposit-amount.md kept the devis out of scope), so an edit would be lost at save. The row
  says why; the price of a devis still moves through « Prix hébergement ajusté ». Follow-up, decided at
  implementation (2026-10-19).
- Stored rows that already break the new guards (a caution returned without receipt, a future paid
  date) are displayed as they are, with a `warning` detail (« Restituée sans réception
  enregistrée »); the guards apply to new writes only.

**Fixed at the 2026-10-27 spec review**

48. **« Total perçu » of a plan counts the stay, not a plan left above it.** After a price drop the plan
    keeps its amounts (direct-installments rule 8) and the ledger shows the gap. The headline's net counts
    the plan for every installment once all are paid, otherwise for the stay's pre-arrival amount — or for
    what was already collected, when that is more. The live quote (`pricing.js` `planCarries`) and the
    stored row (`quoteHeadline.storedNetTotal`, from `installmentsTarget` and the paid / unpaid aggregates)
    compute the same figure (rules 39, 44, 45). *Why:* a 515 € plan on a stay dropped to 415 € with 172 €
    collected read « Total du séjour 415 · Total perçu 515 » stored and « 415 » live.
49. **The stored ledger names the acompte ceiling too.** Without a live quote (`GET /api/reservations/:id`),
    the acompte row's `amountEdit.max` is the accommodation of the stored pre-arrival schedule — acompte +
    solde minus the tourist tax they carry (none when it is collected on arrival) — the ceiling the save
    refuses beyond (rule 16). It read `null`.

### 3.8 Amendment of 2026-10-28 — the stored summary looks like the summary; one alert for a platform price that looks misconfigured

Feedback of 2026-10-28: « Sur une fiche client, si le montant diffère pourquoi afficher un résumé
tarifaire sous un autre format, moi je veux le même visuel. En plus c'est très bizarre qu'on ait un
changement tarifaire ? Il faudrait marquer : "Cette réservation bénéficie d'un ancien tarif" si j'ai bien
compris l'idée de cet affichage. »

**What the block really means.** Rule 45's `StoredPricingSummary` appears when the amounts saved on the
fiche (price, tourist tax, acompte, solde, complement, their due dates) differ from what the engine
computes **today** for the same fiche. It is *not* an old tariff: the live quote already replays the
nightly prices, option lines and tariff the stay was saved with (`getPricingSnapshot`,
[tariff-recipes/spec.md](tariff-recipes/spec.md) rule 12bis), so a change of season prices never
raises it. What raises it is a change of *rules or settings* since the save: the tourist tax (rate,
platform collection mode), the payment schedule (acompte %, J-N, platform payout delay), or an engine
fix. Measured on the shadow (prod copy of 2026-10-22): **4 fiches out of 9 upcoming** show it — four
Booking stays of 2027 saved with a 0 € tourist tax before Booking's tax convention was switched to
« nous reverse » on 16/10 (live: 19,20 € to 33,60 €), so their solde and total differ by that tax, and
one also has its solde due date moved by the payout delay (31/07 → 23/08). In those 4 cases the stored
price is *higher* than today's calculation for 3 of them (905,00 € vs 901,82 €): « bénéficie d'un ancien
tarif » would be false twice over. The sentence on screen today, « Montants enregistrés. Le calcul
actuel du séjour diffère : il s'affiche dès que la fiche est modifiée. », is accurate but says neither
*what* differs nor what to do, and the card drops the « OPTIONS » section, the per-night detail, the
captions and the platform cascade labels the live card has.

50. **One summary, two sources.** When rule 45 shows the stored figures they render through the same
    `PricingSummary` component as the live quote — same sections in the same order, same labels, same
    row components and typography: « Prix hébergement » (with « Détail (N nuits) » when the stored
    nightly lines add up), « OPTIONS » with each stored option, custom option and resource line by name
    (quantity caption, « Comprise » / « Offert » state, struck amount when offered), « Taxe de séjour »
    with its collection caption, Total HT / TVA, « Total du séjour », the platform cascade (« Commission
    acompte / solde », « Versement plateforme »), « Total perçu sur le séjour », the échéances with
    « À payer avant », the complements and the caution. `StoredPricingSummary` is deleted.
51. **The server shapes the stored summary like the live quote.** `storedSummary` carries, beside its
    money figures and dates, what `PricingSummary` reads from a quote: `nights`; `nightlyBreakdown` (the
    saved nights; `[]` when their sum is more than 0,01 € away from the saved price of the nights (`totalPrice`, as the live card compares them) — « Détail »
    is then not offered rather than showing nights that do not add up); `optionLines` (the saved options
    by name, then the custom options) and `resourceLines`, each in the engine's line shape — `title` /
    `name`, `quantity`, `totalPrice` (0 when offered), `originalTotalPrice` (the real price, struck when
    offered), `offered`, `includedInRate` (an offered property default → « Comprise »), `inComplement`,
    the contributions; the tourist-tax case of the stay's platform (`touristTaxOfferedByPlatform`,
    `touristTaxReversedByPlatform`, `touristTaxCollectedOnArrival`, `touristTaxInComplement`) so the three
    captions read as on the live card; `platformSale`; `complementSplit`; `summaryCascade`; `refundsTotal`.
    The component renders the option and resource sections from `optionLines` / `resourceLines` in both
    modes, so the two cards cannot differ in wording. _Implementation note (2026-10-28): the first draft
    specified a separate `lines[]` shape and a `lines` field on the live quote; the live rows need the ids,
    the split between what was paid and what was added since and the scheduling captions that `lines`
    does not carry, so the stored rows are shaped as `optionLines` instead and the live quote is
    unchanged. Not itemised in the stored mode: the extra-guest surcharge (saved inside the
    accommodation)._
52. **Read-only while stored.** In stored mode the per-line controls (« Offrir », « compl. », « Recalculer
    la taxe de séjour », « Afficher détail » of the tax) are not rendered — a value shown as stored is
    never edited in place. Any change to the fiche brings the live summary back (rule 45 unchanged).
53. **The notice names what differs.** _(Withdrawn 2026-10-28, §9 Q-C: no list of differences is
    shown. Replaced by rules 57-64.)_
    > **Sans test** — withdrawn, nothing to test: the rule no longer exists.
54. **« Appliquer le calcul actuel ».** _(Withdrawn 2026-10-28, §9 Q-C: the existing « Actualiser
    tarifs » of the Finances section already re-prices a fiche; no second button. Rule 64.)_
    > **Sans test** — withdrawn, nothing to test: rule 64 (no second re-price button) is tested instead.
55. **A tariff change alone never raises the notice.** _(Withdrawn 2026-10-28 with the notice itself;
    its invariant — a tariff change alone leaves `storedDrift` false — is carried by rule 57.)_
    > **Sans test** — withdrawn, nothing to test: its invariant lives in rule 57.
56. **The phone sheet follows.** Below `lg` the summary sheet opened from the sticky total bar renders
    the same component in the same mode, notice included; the notice lines wrap, amounts never do.

**Second feedback of 2026-10-28, on the first draft of this amendment** (« montants enregistrés +
écarts »): « J'aime l'option montants enregistrés + écarts mais je trouve les explications pas claires,
surtout lorsque c'est une plateforme : nous avons forcément des écarts car on suit notre politique
tarifaire. Est-ce qu'il faut faire un check si on ne suit pas la politique ? J'en doute. Du coup je
remets en cause la pertinence de cette information ; on peut peut-être la conserver pour alerter en cas
d'écart trop important qui montrerait une erreur de paramétrage sur une plateforme. »

**What that changes.** The difference « stored vs today's calculation » is not information the operator
acts on: on a direct stay it only says a setting moved since the save (the 4 Booking stays above moved
because of a tax convention, not because anything is wrong with them), and the existing « Actualiser
tarifs » already re-prices a fiche on purpose. What *is* worth an alert is a platform that sells the
stay far from the price GuestFlow tells it to list — the « Prix plateformes » grid of the property
([platform-price-from-commission.md](platform-price-from-commission.md),
[tariff-recipes/spec.md](tariff-recipes/spec.md) rules 31-34bis) — because that gap does not come from
our policy, it comes from a channel configured wrong. Comparing the platform's brut with our *own*
tariff would fire on every platform stay (the brut is grossed up by the commission on purpose,
`gross = ceil(net / (1 − c))`, plus a cleaning fee on some channels); comparing it with the grid price
*of that channel* fires only when the channel is not what the grid says.

57. **No drift notice.** The stored summary of rule 50 renders the stored amounts with no notice, no
    list of differences, no sentence about the calculation: it is the usual card. This supersedes the
    sentence of rule 45 (« Montants enregistrés. Le calcul actuel du séjour diffère… »), which is
    removed; rule 45's switch itself is unchanged — `storedDrift` still decides which source the card
    reads, server-side, and is no longer shown. A tariff change alone (season price, option price,
    recipe re-applied) still leaves `storedDrift` false, the snapshot being replayed (rule 12bis of the
    tariff recipes). Where rule 56 says « notice included », read the alert of rule 62.
58. **The platform price check compares two amounts of the same channel.** On a commissioned
    platform stay (`!isDirectChannel(platform)`, `platformGrossAmount` entered) the server compares:
    - **paid** — the part of the brut that pays the stay: `platformGrossAmount` minus the tourist tax
      inside it (withheld or reversed, as the engine routes it) minus the pre-arrival options and
      resources it carries. It is the accommodation the engine back-solves from the brut
      ([platform-payment-entry.md](platform-payment-entry.md)) plus the in-brut extra-guest surcharge,
      so the platform's cleaning fee stays inside it;
    - **expected** — what the property's « Prix plateformes » grid says this channel should charge for
      these nights and these paid guests (rule 59).
    Both are TTC, rounded to the cent. The commission entered on the fiche plays no part: a wrong
    commission amount is the platform payout's business (the bank reconciliation), not this check.
59. **Expected = the grid, night by night.** For each night of the quote's `nightlyBreakdown` (the
    replayed snapshot when there is one, else today's nights), `nightPrice × grid / billed`, where
    `billed` is the season's `pricePerNight` and `grid` is the grid cell of that season and channel
    (`grossFromNet(COALESCE(netTargetPerNight, pricePerNight), commissionPercent)`, whole euro up —
    the exact number the grid displays). Using the ratio keeps the stay's degressivity, which platforms
    apply as a percentage of their nightly price (tariff recipes rule 54). Plus the in-brut extra-guest
    surcharge × `extraGrid / extraBilled` of the same seasons, plus the channel's cleaning fee grossed
    up (`platformCleaningFees`, [tariff-recipe-platform-cleaning-fee.md](tariff-recipe-platform-cleaning-fee.md)
    rules 8-9). The guests the platform did not bill (`platformPaidGuests`, collected on arrival) are
    out of both sides. _Implementation: `paid` is `accommodationAdjustedPrice + extraGuestInBrutSurcharge`
    of the quote — the engine's own back-solve; the extra-guest ratio is the mean over the nights' seasons,
    and a surcharge with no extra-guest price on the grid is compared with itself (ratio 1)._
60. **The alert fires on a gap that no normal pricing explains.** `gap = paid − expected`,
    `gapPercent = gap / expected`. The alert is raised when **`gapPercent < −15 %` or
    `gapPercent > +25 %`, and `|gap| ≥ 30 €`**. The band absorbs what is normal on a channel: whole-euro
    rounding (≤ 1 € a night), a non-refundable or early-booking rate (−10 % on Booking), a commission %
    a point off, a platform degressivity that rounds differently, a weekly discount set a little
    higher. It does not absorb what a misconfiguration produces: a season left at another season's price
    (the gîte recipe's net targets run from 288 € to 908 €), a missing extra-guest price, a cleaning fee
    missing on a short stay, a degressivity applied twice, a weekly price entered as nightly. The floor
    of 30 € keeps a one-night stay from alerting on a few euros. Asymmetric on purpose: below the grid
    the owner loses money (the net target is the floor, gîte recipe `_comment_pivot`); above it the
    guest overpaid, which matters later in a review but is rarer as an error. _(Q-D resolved 2026-10-28: (a).)_
61. **When the check is not run.** `platformPriceCheck` is `null` — no alert, nothing computed — when:
    the stay is a devis, is cancelled (`kind = 'cancelled'`), has started (`startDate ≤ today`: the
    fiche is locked, rule 7, and nothing on it can fix a channel); the channel is an own channel
    (`isDirectChannel`: direct, the booking engine, a sale channel counting as direct); the brut is not
    entered (an iCal import awaiting « Paiement plateforme »); the channel is not in the `platforms`
    table or its commission is ≥ 100 % (`grossFromNet` returns `null`); a night of the stay has no
    season (`unpricedNights`); or the nights were priced on today's seasons (no stored snapshot) **and**
    `tariff_change_events` holds an event for the property dated after the booking date — the grid
    then describes a tariff the guest never saw, and the comparison would only measure the change.
    The same holds when the nights come from the sale's snapshot but **differ from what today's seasons
    price for the same dates** (the tariff moved since the sale, or the sale was priced on the 100 €
    fallback of a night no season covered yet): the grid describes a tariff the guest never saw, whatever
    the journal says. _Added after the real-data pass of 2026-10-28: a Booking stay of August 2027,
    booked in August 2026 on the fallback 100 € nights, read +43 % against today's grid._
    A channel that bills a cleaning fee on the grid, whose brut also carries a line sold at the stay's own
    price (an option or a resource not collected on arrival), is read twice, because no flag tells a
    « Ménage » option from the fee (a stay may carry both for one chore): **(a)** « paid » without those
    lines (rule 58), **(b)** « paid » with them. The alert is raised only when both readings are out of
    band (rule 60) on the same side.
    _Known limit: an Airbnb stay booked before the channel cleaning fee existed (26/10) is judged against a
    grid that includes a fee its guest never paid, so a short upcoming stay can read about −17 %. The fee
    carries no date (`platformCleaningFees` entries hold only the nets) and the tariff journal records
    every change of a property, not this one, so there is no reliable date to count the fee from._
    _Accepted limit (review 2026-10-28): a stay sold before a season edit is silenced by the clause above
    rather than judged on today's grid._
    A manual price (`customPrice`) does not exist on a platform stay (the brut is the single lever,
    platform-payment-entry), so it needs no case.
62. **One short alert, in the card.** When raised, the « Résumé tarifaire » opens with a single
    warning-soft block, above « Prix hébergement », in live and stored mode alike, desktop panel and
    phone sheet: a title **« Prix {Plateforme} à vérifier »**, one line **« {paid} payés · {expected}
    selon la grille ({gapPercent}) »** (« 812,00 € payés · 1 180,00 € selon la grille (−31 %) »), and
    a text link **« Voir la grille »** to `/properties/:propertyId/pricing-seasons` (the « Prix
    plateformes » section: the link carries `#prix-plateformes`, the grid page scrolls to it, and a
    `from` parameter brings the operator back to the fiche). The link goes through the page's unsaved-changes
    guard like a sidebar link. Nothing else: no explanation of the mechanism, no « tarif » / « ancien »,
    no dismiss button (Q-F). It follows the live quote: entering the brut in « Paiement plateforme »
    shows or clears it on the next preview, so a mistyped brut is caught at intake too.
63. **The server decides, the client renders.** `calculate-price` returns `platformPriceCheck`
    (`null`, or `{ platformLabel, paid, expected, gap, gapPercent, direction: 'below'|'above',
    gridPath }`) computed by a pure util from the quote, the seasons, the platform row, the property's
    cleaning fees and the journal. The client prints it with `formatCurrency` and a signed
    `formatPercent`, and never compares two amounts itself. The thresholds are server constants
    exported by the util, not settings (Q-D). `platformLabel` is the channel's name in the `platforms`
    table; the client words it like the platform chips (`formatPlatformLabel`).
64. **No second re-price button.** The stored card carries no « Appliquer le calcul actuel »: the
    Finances section's « Actualiser tarifs » (`refreshToCurrentPricing`, confirmation, chip « Tarifs
    actuels appliqués (non sauvegardé) ») stays the one deliberate way to re-price a direct fiche. A
    platform stay has nothing to apply: its price is the brut.
65. **The booking date of rule 61 is the operator's day** (2026-10-30, audit R9-1). The day the journal
    is compared with is the local day of the stay's `createdAt` (`vatRegime.bookingDayOf`,
    `specs/finance-dashboard-redesign.md` rule 50), never its first ten characters: `createdAt` is UTC,
    while `tariffChangeJournalModel.hasEventAfter` reads `date(occurredAt, 'localtime')`. *Why:* a stay
    booked at 00:30 Paris read as booked the day before, so a tariff change made at 00:10 that same day,
    before the booking, counted as « after » and silenced the alert.

**Edge cases (amendment):**
- Only a due date or the tourist tax differs from today (the 4 Booking stays of 2027) → the stored card,
  no alert: the tax is out of rule 58's « paid », the dates are not compared.
- Normal Booking stay listed at the grid (`ceil(288 / 0,85) = 339 €` a night on the gîte) → `gap ≈ 0` →
  no alert, although the brut is ~6 % above the direct price and ~18 % above the net target.
- Booking non-refundable rate at −10 % → −10 % → no alert. Genius (−10 %) on top of it → −19 % → alert:
  that stacking is below the floor the grid defends, which is the point.
- Airbnb without its 145 € cleaning fee (122 € net grossed at 15,5 %, whole euro up) on 2 nights of the
  gîte (2 × 341 € + 145 € expected) → −18 % and −145 € → alert; the same omission on 7 nights → −6 % → no alert (accepted: the fee is a fixed part,
  diluted on long stays — the grid page shows it anyway).
- Channel at 0 % commission (Gîtes de France) → grid = net target: the check still runs.
- Extra guests collected on arrival → out of both sides (rule 59); the stay is judged on the guests the
  platform billed.
- The stored price is lower or higher than today's on a direct stay → no alert at all (rule 57).
- A platform stay whose stored nightly snapshot is empty (iCal import, `platformGrossAmount` pinned) →
  « Prix hébergement » without « Détail », as on the live card of such a stay; the check runs on today's
  nights unless the journal guard of rule 61 applies.
- A devis never gets the alert (rule 61).

---

## 4. Architecture

> **Fat backend, thin frontend.** The rows, their states, the editable ranges, the refusals, the
> translation of a typed solde into the form fields to apply: all server-side. The client renders the
> rows, keeps the open/closed state of the inline editor and the typed draft, and forwards values.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `reservationLedger.js` | C | Pure shaper: `(reservation or live quote, links, refund register, arrival group, today) → { rows, remaining }` (rules 1-7, 24, 28). `remaining` comes from `reservationSettlement.remainingToPay`. |
| `utils/` | `reservationSettlement.js` | — | Reused as is: `bucketStates`, `remainingToPay` (rule 5). |
| `utils/` | `ledgerAmountEdit.js` | C | Validates a typed acompte / solde against P, H, T and the paid flags; returns `{ ok, reason }` or `{ ok, effects, formPatch }` (rules 15-21). The solde-to-price solver takes the engine as an injected callback (rule 18). |
| `utils/` | `arrivalPaymentDate.js` | T | `validateCollectionDate` — the « not in the future » half, used by every ledger mark (rule 9); the arrival payment keeps both halves. |
| `utils/` | `moneyExpression.js` | C | Server twin of the client's arithmetic parser, so « 12,5 », « 100+20 » or « −5 » typed in a row editor are read by the server as typed (rule 21). |
| `utils/` | `ledgerLinks.js` | C | Which open links an amount change makes stale, whether one was paid meanwhile (fake-provider testable), and the booking of a link paid after its retirement (rules 29-31). |
| `utils/` | `paymentPollRunner.js` | T | `retryPendingCancellations` books a paid `'amount-changed'` link per rule 31 instead of only notifying; `processPaidLink` books an open link whose amount drifted the same way (rule 47). |
| `utils/` | `pricing.js` | T | Echoes `autoDepositAmount` (« Montant fixé · calcul auto », rule 16); the override branches and the clamp stay as defence (rules 16-17). |
| `controllers/` | `reservationsController.js` | T | `getById` adds `ledger`; `calculatePrice` adds `ledger`, feeds `depositDisabled` to the engine like the save does, and answers `ledgerEdit`; `update` (now async) plays the save in a rolled-back transaction when an open link exists, refuses a paid stale link (409), re-validates amounts (400), traces ledger edits, retires stale links (rules 21, 23, 29-30), re-reads the caution columns and drops them from the past-locked whitelist (rule 13); `updatePayment` validates dates, `expectedAmountCents`, caution order, zero buckets, and cascades the caution undo (rules 9, 11, 12, 14, 32); `platformCommission` words the transfer gap (rule 26). |
| `controllers/` | `refundsController.js` | — | Unchanged; its register feeds the refund rows. |
| `models/` | `reservationsModel.js` | — | Unchanged: the controller hands it the stored caution columns (rule 13); the ledger history entries are built by the controller (rule 23). |
| `models/` | `paymentLinksModel.js` | T | `retireForAmountChange(reservationId, type, newAmountCents)` (rule 29); `markRetiredLinkPaid` accepts the `'amount-changed'` reason (rule 31). |
| `routes/` | `reservations.js` | — | No new route. |
| `database.js` | — | — | No schema change (§5). |
| `tests/` | `reservation-ledger.unit.test.js` | C | Rows, order, states, labels, origins, remaining (rules 1-7, 24, 27-28). |
| `tests/` | `reservation-ledger-amounts.unit.test.js` | C | Ranges, refusals, split vs price translation, solver, paid rows (rules 15-23). |
| `tests/` | `reservation-ledger-marks.unit.test.js` | C | Dates, `AMOUNT_CHANGED`, caution order, PUT cannot write caution, undo (rules 8-14). |
| `tests/` | `reservation-ledger-links.unit.test.js` | C | Link display, retirement on amount change, paid-after-retirement booking (rules 28-31). |
| `tests/` | `ledger-link-amount-mismatch.unit.test.js` | C | A `full` link over a grown acompte, the traced complement booking (rule 31), an open link paid at a drifted amount (rule 47). |
| `tests/` | `reservation-ledger-parity.unit.test.js` | C | Parity on a neutralised copy of the Solio base (§7), `LEDGER_PARITY_DB=<copy>`; a synthetic base otherwise (CI). |
| `tests/` | `ledgerFixture.js` | C | Shared fixture: in-memory base, one property, the real controller driven like the fiche. |

**Amendment 2026-10-28 (rules 50-52, 56-64):**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `reservationsController.js` | T | `storedSummaryOf(row)` delegates to `utils/storedSummary.js`; `calculate-price` adds `platformPriceCheck` (rule 63) for a saved or new reservation, glue in `platformPriceCheckOf` (cheap guards first, the grid and the journal are read lazily). `storedDrift` keeps its inline computation, unchanged (rule 57). |
| `utils/` | `utils/storedSummary.js` | C | Pure but for the reads it is handed: the stored row → the quote-shaped `storedSummary` (rules 50-51), moved out of the controller. |
| `utils/` | `utils/platformPriceCheck.js` | C | Pure: `({ quote, stay, nightsReplayed, loadContext, today }) → null | check` (rules 58-61); exports `BELOW_PERCENT = -15`, `ABOVE_PERCENT = 25`, `MIN_GAP_EUR = 30`. Reads the grid from `propertiesModel.platformPrices` and the night's season with `matchNightRule` (now exported by `utils/pricing.js`), so the expected price is the grid's number, not a re-implementation. |
| `models/` | `tariffChangeJournalModel.js` | T | `hasEventAfter(propertyId, isoDay)` for the guard of rule 61. |
| `models/` | `propertiesModel.js` | — | Unchanged: `platformPrices()` already returns the cells and the channel cleaning fee; no `gridCellOf` extraction was needed. |
| `routes/`, `middleware/`, `tasks/`, `database.js` | — | — | Untouched: no new endpoint, no schema change. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `LedgerList.jsx` | C | Generic: renders server rows (label · amount · status · one action), the inline form slot and the closing total. |
| `components/` | `LedgerAmountEditor.jsx` | C | Generic: inline amount field (`ArithmeticTextField`) + server refusal or effects + Valider / Annuler. |
| `components/` | `StatusBadge.jsx` | T | Tones `due`, `late`, `done`, `muted`, `warning` on the Maison soft-bg chips. |
| `components/` | `reservation/FinanceSection.jsx` | T | Keeps the price block; replaces the Acompte / Solde / Caution / complements / refunds blocks with `LedgerList`; the complement adjustment, notes history and single-payment detail fold under « Détail »; « Sans acompte » and « Taxe de séjour en complément » sit under the ledger. |
| `components/` | `reservation/PaymentMarkForm.jsx` | C | Specific: the inline mark form (date, « Caisse interne » on complements, « Virement reçu » + gap + commission button on a payout) (rules 8-9, 26). |
| `components/` | `reservation/PlatformStatementEditor.jsx` | C | Specific: the statement fields of a payout row, a draft until « Valider » (rule 25). |
| `components/` | `reservation/RefundDialog.jsx` | — | Unchanged: « Créer le remboursement » opens it in its trop-perçu mode on the gap (rule 19). |
| `pages/` | `ReservationPage.jsx` | T | Holds `ledger` from the fiche and the live quote; `markFromLedger` saves first when the fiche is dirty or carries a transfer (rule 10); `checkLedgerEdit` re-sends the last quote body with `ledgerEdit`; `applyLedgerPatch` applies `formPatch` and remembers the edit for the history; stops sending the caution columns. |
| `api.js` | `api.js` | T | `sendPaymentRequestOfType` (« Renvoyer la demande », rule 28); `markPayment` / `calculatePrice` carry `expectedAmountCents` / `ledgerEdit` in their bodies. |
| `__tests__/` | `LedgerList.rendering.test.jsx`, `LedgerAmountEditor.refusals.test.jsx`, `FinanceSection.ledger.test.jsx` (+ `ledgerFixtures.jsx`) | C | One file per subject; the existing FinanceSection suites were moved onto the ledger rows. |

**Amendment 2026-10-28 (rules 50-52, 56-64):**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PricingSummary.jsx` | T | New props `mode: 'live'|'stored'` and `topNotice` (a node rendered above « Prix hébergement »); in stored mode the per-line controls, the tax refresh and the tax detail toggle are left out, an offered line keeps a static « ✓ Offert » / « Comprise » word, the « compl. » chips are read-only (rules 50-52, 57). |
| `components/` | `reservation/PlatformPriceAlert.jsx` | C | Specific to the fiche: renders `platformPriceCheck` (title, one line, « Voir la grille » link) — rule 62. Not generic: its only content is this check; the look is the theme's `Alert`, severity `warning`, no icon. |
| `components/` | `reservation/StoredPricingSummary.jsx` | D | Deleted (rule 50), with its test `StoredPricingSummary.drifted.test.jsx` (its cases live in `PricingSummary.stored-mode.test.jsx` and the server suites). |
| `pages/` | `ReservationPage.jsx` | T | One `PricingSummary` element for both sources: `mode` / `quote` / `form` (stored deposit, balance and due dates) / nights / accommodation follow `showStoredSummary`; `<PlatformPriceAlert check={pricingQuote?.platformPriceCheck} />` as `topNotice` in both modes, on the desktop panel and in the phone sheet (the same element). |
| `constants/` | `constants/pricingSummaryStrings.js` | C | « Prix {platform} à vérifier », « payés », « selon la grille », « Voir la grille ». |
| `utils/` | `utils/formatters.js` | T | `formatSignedPercent` (« +28 % » / « −31 % »). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `ArithmeticTextField`, `DateField`, `ConfirmDialog`, `PageActionBar` | `PageActionBar` untouched. |
| **Created (new generic)** | `LedgerList`, `LedgerAmountEditor` | Generic because the same « row = amount + state + one action » shape is wanted by the SAS recap payments ([sas-recap-payment-buttons.md](sas-recap-payment-buttons.md)) and the finance « paiements à venir » table; neither knows about reservations. |
| **Specific (kept feature-local)** | `FinanceSection` | Reservation-specific orchestration only. `ComplementCard` and `ArrivalPaymentCard` become the `detail` content of their rows. |

### 4.3 API contract

**Amendment 2026-10-28:** `storedSummary` and `calculate-price` additions (rules 51, 63) are specified with their payload at the end of §6, next to the UI they feed.

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id` | — | `{ …, ledger: { rows, remaining } }` | Additive. Absent for a reception-only user. |
| POST | `/api/reservations/calculate-price` | `{ …, ledgerEdit?: { row: 'deposit' \| 'balance', amount } }` | `{ …quote, ledger, ledgerEdit?: { ok, reason?, effects?, reached?, formPatch? } }` | Additive. `ledgerEdit` answered only when asked; `reached` = the solde actually produced (rule 18). |
| PUT | `/api/reservations/:id` | unchanged; caution columns ignored | unchanged | Amount validation (400 + French `message`); 409 `LINK_ALREADY_PAID` (rule 30). |
| PATCH | `/api/reservations/:id/payment` | `{ …, expectedAmountCents?, <bucket>PaidDate }` | `{ ok: true }` | 400 date refusal; 409 `AMOUNT_CHANGED`, `CAUTION_NOT_RECEIVED`. No new money field. |

Row shape:

```json
{ "key": "balance", "label": "Solde", "amount": 614.4, "state": "due", "tone": "due",
  "stateLabel": "À percevoir avant le 22/06", "action": { "kind": "mark", "label": "Marquer perçu" },
  "amountEdit": { "editable": true, "min": 26.4, "max": 866.4, "reason": null },
  "detail": { "link": { "status": "open", "label": "Lien envoyé le 15/10 · 614,40 €" } } }
```

---

## 5. Data model

**Amendment 2026-10-28:** no schema change, no migration — the stored lines are read from the existing `reservation_options`, `reservation_custom_options`, `reservation_resources` and the pricing snapshot.

**No schema change.** The ledger is a view over existing columns: `deposit*`, `balance*`,
`complement*`, `endOfStayComplement*`, `caution*`, `depositAmountOverride`, `customPrice`,
`platform*Amount`, `arrivalPaymentGroup`, `payment_links`, `reservation_refunds`.
`payment_links.cancelReason` gains the value `'amount-changed'` (free TEXT, no CHECK constraint).

**Data impact:** none on existing rows. The new refusals apply to new writes only (edge cases of §3).

## 6. UI / UX

Interactive rendering: [docs/specs/2026-10-19-reservation-payment-ledger.html](../docs/specs/2026-10-19-reservation-payment-ledger.html).

**Card « Paiements »** (replaces the lower half of « Finance »; the price block stays above):

- Each row: **label** (600) · **amount** (tabular, right-aligned, non-breaking) · **state chip**
  (Maison soft background + dark text: success / warning / error / muted) · **one action**
  (outlined primary pill; « Annuler » is a text button). One button treatment per role.
- The amount of an editable row is itself the « Modifier » affordance (dashed underline, pencil
  glyph, 44 px target); a locked amount shows a padlock and opens its reason. Opening it replaces
  the state line by the editor: field, help or refusal under it (`aria-live`), effects (rule 18) and
  « Valider » / « Annuler ».
- A refusal is red text under the field, the field keeps the typed value, focus stays in the field,
  « Valider » is disabled with the reason beside it — never a toast, never a disabled button
  without a reason.
- Marking opens the inline form under the row (date; « Caisse interne » on complements only;
  platform: « Virement reçu »), prefilled to today.
- Detail (complement lines, commission, link, warnings) sits under the row; long details fold under
  « Détail ».
- The closing line « Reste à percevoir 614,40 € » / « Tout est perçu ».
- Motion: the inline form appears with a 200 ms ease-out fade and 4 px slide, once, when it opens
  (not on every keystroke); a refusal does one 4 px shake; both become an opacity cross-fade under
  `prefers-reduced-motion`.

**Responsive:**

- `xs` (≤ 600 px): each row is two lines — label + amount on the first, chip + action on the second
  (action right-aligned, ≥ 44 × 44). The inline form stacks: date, then « Valider » and « Annuler ».
  No horizontal scroll; the amount never wraps.
- `md` (~900 px): one line per row, columns `label | amount | state | action`; the form lays out on
  one line.
- `lg` (≥ 1200 px): same as `md` inside the fiche column; the card no longer splits Acompte / Solde
  into two side-by-side columns.

**As built (2026-10-19):**

- « Encaisser en une fois » (single-payment-from-the-fiche) stays above the ledger: it spans rows. Once
  recorded, the rows it covered read « · paiement unique » and its detail (lines, total, « Annuler ce
  paiement ») folds under the first of them.
- « Sans acompte » (disable-deposit-per-reservation) and « Taxe de séjour en complément »
  (force-item-to-complement) sit under the ledger as two switches: they move money between rows, they
  are not rows. « + Nouvelle note » and « + Nouveau remboursement » sit under the closing line.
- The amount editor is a plain decimal field, not `ArithmeticTextField`: « −5 » and « 100+20 » reach
  the server as typed, so a negative amount is refused in words instead of silently clamped
  (`utils/moneyExpression.js` reads the arithmetic server-side).
- The undo confirmation is the shared `ConfirmDialog` (« Annuler la perception » / « Garder »), with the
  server's sentence as its message.
- The past-locked fiche keeps its marks (see Edge cases); its amount editors are read-only and say
  « Séjour commencé : déverrouiller la fiche pour modifier les montants. » (review of #727, M1).
- Accessibility (review of #727): every action is named with its row (« Marquer perçu : Acompte »),
  closing a panel gives the focus back to the amount or the action that opened it, an open panel
  replaces the row's state line, refusals live in a polite live region (no nested alert), the date
  label of the mark form comes from the server (« Perçu le », « Reçu le », « Reçue le », « Rendue
  le ») and the confirmation button names the gesture (« Annuler la perception », « Annuler le
  versement », « Annuler la réception », « Annuler la restitution »).

**Amendment 2026-10-28 (rules 50-64) — API.** `GET /api/reservations/:id` → `storedSummary` gains
`nights`, `nightlyBreakdown[]`, `optionLines[]`, `resourceLines[]`, the tourist-tax case flags,
`platformSale`, `complementSplit`, `summaryCascade`, `refundsTotal` (quote-shaped, rule 51). `POST
/api/reservations/calculate-price` → adds `platformPriceCheck` (absent for a reception-only user, like the
ledger). `storedDrift` is unchanged and no `storedDriftItems` is added.

```json
{
  "storedDrift": false,
  "platformPriceCheck": {
    "platformLabel": "Booking",
    "paid": 812,
    "expected": 1180,
    "gap": -368,
    "gapPercent": -31.2,
    "direction": "below",
    "gridPath": "/properties/3/pricing-seasons"
  }
}
```

`platformPriceCheck` is `null` whenever rule 61 applies **and** whenever the gap sits inside the band of
rule 60 — the client never receives a « no alert » object to interpret. `gapPercent` is rounded to one
decimal; the client prints it whole (« −31 % »).

**Amendment 2026-10-28 — UI.** Desktop: the stored card is the live card (same width, sections, labels),
no notice (rule 57). On a platform stay outside the band, the card opens with the alert of rule 62:
MUI `Alert` severity `warning` (Maison warning soft background), radius 10, 12 px padding, title in 600,
the line in `body2` with amounts in `tabular-nums`, « Voir la grille » as a text link under the line.
Phone (`xs`): the same alert at the top of the summary sheet; the line wraps after « payés · », the
amounts and the percentage never break; the link is a 44 px-high target. Mockups in the 2026-10-28
summary page (normal direct · normal platform · misconfigured platform, panel and phone width).

**`PageActionBar`:** unchanged. « Enregistrer » still saves the fiche; marks save first (rule 10).

**Copy** — short and impersonal: « Marquer perçu », « Recevoir », « Restituer », « Marquer reçu »,
« Annuler », « Valider », « Reste à percevoir », « Tout est perçu », plus the refusals of rules 9,
11, 12, 16-20, 30.

## 7. Test plan

### Server unit tests (76)
- [x] `tests/installment-headline-after-price-drop.unit.test.js` (3, spec review 2026-10-27) — rule 48: live and stored headlines agree on the stay after a drop, money above the stay stays counted, a plan without drop unchanged
- [x] `tests/ledger-stored-deposit-ceiling.unit.test.js` (1, spec review 2026-10-27) — rule 49: the stored acompte row carries `max` 500 on a 515 € stay
- [x] `reservation-ledger.unit.test.js` (15) — rules 1-7, 12, 24, 27-28: direct with acompte, without
  acompte, last-minute, platform without and with acompte, single arrival payment, refunds, caution
  states, cancelled stay, devis, stored rows breaking the guards; `remaining` equals `remainingToPay`.
- [x] `reservation-ledger-amounts.unit.test.js` (18) — rules 15-23 on the real engine: acompte 0 / H /
  H + 0,01 / −1; solde T − 0,01 / T / P / P + 0,01; clamp warning after a price drop; solde with the
  acompte perceived (exact, nearest cent with a percentage tax, a stay carrying a cancellation
  insurance, floor `H' = A`, no acompte at all); paid rows lower / higher; « 12,5 », « 100+20 », three
  decimals; PUT re-validation (400); history labels; the « Aucun acompte » 0 € row.
- [x] `reservation-ledger-marks.unit.test.js` (23) — rules 8-14, 26, 32-35, 37 (transfer with the mark on a past locked stay, drifted stay recorded with a warning, undo/redo of a received acompte, stored amount while edited, no commission from a tax gap, unpriced stays): future date refused, a date
  before `createdAt` accepted, `expectedAmountCents` one cent off → 409, merged complement, caution
  order and dates, forged caution columns ignored (also past-locked), undo confirmation and cascades,
  single payment dissolved, zero buckets refused, the transfer gap.
- [x] `reservation-ledger-links.unit.test.js` (12) — rules 28-31 and 36 with a fake provider (balance link paid short of / above the new solde, then saved): retire on change,
  unchanged link kept, provider down → remote-pending, the four link types, paid before the save → 409
  (dry run rolled back), paid after retirement → booked for `deposit`, `balance`, `complement`, double
  payment → notified only.
- [x] `ledger-link-amount-mismatch.unit.test.js` (7) — rules 31 and 47 on the fixture stay (acompte
  90 €, solde 217,20 €): a `full` link of 250 € → acompte 90 + solde 160 perceived, 57,20 € owed and
  kept after a save; 400 € → 92,80 € trop-perçu; 50 € → booked as the acompte; a retired complement
  link traced with its date and baseline; an open acompte link of 90 € paid after a re-price to 100 €
  → booked at 90 €; a matching solde link recorded as before.
- [x] `reservation-ledger-parity.unit.test.js` (1) — rules 1, 4, 5. **Run 2026-10-19 on a neutralised
  copy of the Solio base (56 reservations): every bucket state and amount matches `bucketStates`, every
  `remaining` matches `remainingToPay`, the accounting export (17 months, 12 116 bytes) is
  byte-identical before and after, and identical between `inte/plugins` and this branch (same
  SHA-256).** CI runs it on a synthetic base (10 stays covering every bucket state).

- [x] **Amendment 2026-10-28** `tests/stored-summary-same-visual.unit.test.js` (new, 6): rule 51 —
  `storedSummary.optionLines` / `resourceLines` list stored options, custom options and resources by name
  with offered / included / inComplement flags and the real price of an offered line; `nightlyBreakdown`
  empty when its sum is off by more than 0,01 €; the tourist-tax case flags per platform mode (offered,
  reversed, on arrival, direct); rule 50 — stored and live agree on every figure the card prints for an
  un-drifted stay (parity); rule 57 — a season price raised after the save leaves `storedDrift` false; a
  tourist-tax convention switched after the save raises `storedDrift` and returns no item list
  (`storedDriftItems` absent).
- [x] **Amendment 2026-10-28** `tests/platform-price-check.unit.test.js` (new, 16), the util behind the
  real controller and the pure util on synthetic inputs: rule 59 — a stay at the grid raises nothing
  (commissions 15 % and 0 %), the cleaning fee is grossed up with the commission read now, the
  degressivity of the nights is kept, the in-brut extra-guest surcharge is compared with the channel's
  extra-guest price; rule 60 — −14,97 % and +24,86 % pass, −15,25 % and +25,14 % alert, −20 % on a one-night
  stay (−24 €) passes (absolute floor), the payload shape; rule 58 — the withheld tourist tax is out of
  `paid`; rule 61 — null for devis, cancelled, started, own channel, brut empty, unknown platform,
  commission 100 %, unpriced night, replayed nights that differ from today's seasons, today's nights + a
  journal event after the booking date (and not null with the same event when the snapshot is replayed); rule 63 — `calculate-price` returns the object and
  omits it for a reception-only user. _The "eight channel totals of tariff recipes rule 54" were not
  replayed through the engine: the real-data pass on the shadow copy (§7 manual) stands in for them._
- [x] **Audit R9-1 (2026-10-30)** `tests/utc-timestamp-paris-day-labels.unit.test.js` (1 of 3): rule 65 — a
  stay booked at 00:30 Paris and a tariff change at 00:10 that day still raise the alert; a change on the
  next Paris day still silences it.
  The `properties-platform-prices` case planned for `gridCellOf` is dropped with the extraction.

### Client (Vitest)
- [x] `LedgerList.rendering.test.jsx` (8), `LedgerAmountEditor.refusals.test.jsx` (6),
  `FinanceSection.ledger.test.jsx` (19: locked amounts, confirmation per row type, stored-amount line,
  form-level refusal, server date label, focus return).
- [x] The FinanceSection suites of other specs moved onto the ledger rows (complement-adjust,
  deferred-complement, caisse-interne, mid-stay-notes, platform-no-deposit, platform-tourist-tax,
  refunds, single-arrival-payment, arrival-payment-detail, RefundDialog overpayment).

- [x] **Amendment 2026-10-28** `components/__tests__/PricingSummary.stored-mode.test.jsx` (new, 7):
  rule 50 — the stored mode renders « Options » and the option names, « Détail » with the nights, the same
  section labels as the live mode for the same fixture, the offered / included state words with the real
  price struck; rule 52 — no « Offrir », « compl. » toggle, tax refresh or tax detail toggle, a read-only
  « compl. » hint; rule 57 — no « Montants enregistrés » / « calcul actuel » text; the live mode keeps its
  controls.
- [x] **Amendment 2026-10-28** `components/reservation/__tests__/PlatformPriceAlert.rendering.test.jsx`
  (new, 5) and `utils/__tests__/formatters.signed-percent.test.js` (2): rule 62 — title with the platform
  label, « 812,00 € payés · 1 180,00 € selon la grille (−31 %) », « +28 % » above, link to `gridPath` as
  a 44 px target, nothing for `null`, no dismiss button; rule 56 — no « tarif » / « ancien » word.

### E2E
- [x] `e2e/specs/reservations/payment-ledger.spec.js` (5): a past locked Booking stay received with its
  transfer and no full save; a drifted stored amount shown and marked as stored, no save, the fiche left
  unmodified; set the solde, refusal of an acompte above
  the accommodation, future date refused then today, undo with confirmation, caution in order; a
  Booking payout received with its transfer and gap; no sideways scroll at 390 px.
- [x] `booking-intake.spec.js` anchors on « Paiements » (the « Paiement plateforme » heading is gone).

- [x] **Amendment 2026-10-28** `e2e/specs/reservations/stored-summary.spec.js` (new, 4): a drifted
  direct stay opens with the usual card (stored total, nights, no notice); a Booking stay at the grid
  shows no alert; a Booking stay 30 % under the grid shows « Prix Booking à vérifier » and « Voir la
  grille » opens the property's pricing page; 390 px: the sheet opened from the total bar carries the
  alert, a 44 px link, no horizontal scroll.
- [x] **Amendment 2026-10-28 — manual:** see the implementation progress at the end of the clients spec.

### Review of #727 — re-run on the reviewer's Solio copy (2026-10-19)
- [x] The 56 stored stays opened unmodified: the displayed « Reste à percevoir » equals
  `remainingToPay` on all 56 (was 20 mismatches); iCal imports without a price read « Prix à
  renseigner », no « En retard »; 22278 shows its 50 € end-of-stay meal still due; Gîtes de France 10,
  11, 12, 22218, 22225 show « ✓ cohérent avec le virement », no false écart.
- [x] « Marquer reçu » on the past stays 11, 12, 13, 22245, 22273, 22275: 6/6 recorded, no PUT, nothing
  re-priced (11, 12, 22245 with the rule-37 warning). 22224: its 45 € complement marked without 409.
- [x] Accounting export (2025-2027) byte-identical between `inte/plugins` and this branch on the copy;
  engine replay of the 56 stays identical except 22278 (rule 36).

### Manual UI verification (2026-10-19, Solio copy, 390 / 900 / 1280)
- [x] Direct stay without acompte (22290), Booking (22270), Gîtes de France with complement and
  reconciliation gap (11), single arrival payment (22278), the 0 € acompte of a converted devis (22293):
  no horizontal scroll at any width; solde edit with refusal and effects, future date refused, mark,
  undo with confirmation, Booking transfer with gap and commission button.

## 8. Out of scope

- Partial payments (several payments on one acompte or solde).
- A per-payment means column (Virement, CB, Chèque…) — §9 Q2 — and a « Caisse interne » switch on
  acompte / solde from the fiche.
- Moving « Envoyer la demande d'acompte / de solde » out of the page actions.
- The pricing summary rework (review proposal 6, separate lot) and the sticky total bar (decision 6).
- Editing the caution amount (frozen from the property at receipt,
  [caution-live-from-property.md](caution-live-from-property.md)).
- The SAS screens: they keep their own payment steps; reusing `LedgerList` there is a later spec.
- Removing `paymentStatus.computePaymentStatus` (unused outside its test): a separate clean-up.

**Amendment 2026-10-28 — out of scope:** correcting the 4 drifted Booking fiches themselves (« Actualiser
tarifs » + « Enregistrer » on each, the operator's call); showing *what* differs between stored and
today's calculation (withdrawn rules 53-55); a dashboard list of the platform stays out of the band (a
later spec if the alert proves useful); thresholds per channel or as settings; checking direct stays
against the tariff (a direct price comes from the engine itself, so a gap there is a manual price,
not a misconfiguration); reading the platform's own configuration through an API.

## 8bis. Specs amended

When this spec is approved and implemented, the same PR updates:

- [editable-deposit-amount.md](editable-deposit-amount.md) — **rule 4** (the override is clamped to
  `[0, preArrival]`) becomes « refused above the accommodation, clamp kept only as a defence »
  (rule 16 here); **§8 Out of scope** loses « Editing the balance directly », now rules 17-18.
- [single-payment-from-the-fiche.md](single-payment-from-the-fiche.md) — rule 11bis extended to the
  caution columns (rule 13 here).
- [plugins-phase-3a-online-payment.md](plugins-phase-3a-online-payment.md) — a new retirement reason
  `'amount-changed'` and its paid-after-retirement booking (rules 29-31 here).
- `payment-link-visible-and-renewable` — a Draft summary of 2026-09-25
  (`docs/specs/2026-09-25-payment-link-visible-and-renewable.html`) exists only, untracked, in
  Adrien's main checkout. Rule 28 covers its « visible » half; its « renewable » half (re-sending
  from the row) is to be reconciled with it when that spec lands. Not copied here.

**Amendment 2026-10-28** also updates [pricing-summary-extraction.md](pricing-summary-extraction.md)
(rule 7: `PricingSummary` gains the stored mode and the `topNotice` slot), [platform-price-from-commission.md](platform-price-from-commission.md) (the grid cell
is now also the reference of the fiche's price check — rules 59-60 here) and
[tariff-recipes/spec.md](tariff-recipes/spec.md) gets a rule 68 (appended) cross-referencing rule 57 here;
[platform-price-from-commission.md](platform-price-from-commission.md) gets a rule 8.

## 9. Open questions

None left. **Resolved 2026-10-19** — Adrien took the recommended option on all five:

- **Q1. Solde typed while the acompte is already perceived (or there is no acompte)** → (a) accepted as
  an accommodation price change: the server re-runs the whole engine (tourist tax, options priced on
  the stay such as the cancellation insurance), proposes the nearest reachable cent, floors the
  accommodation at the acompte received and shows the consequence before « Valider ». Rule 18.
- **Q2. Means of payment** → (a) no new column: each row shows the origin the data already knows (lien,
  caisse interne set by the SAS, plateforme, paiement unique). Rule 4.
- **Q3. Open payment link whose amount changes** → (a) retired and deactivated at save; « Renvoyer la
  demande » on the still-due row; a late payment of the old link is still recorded on the fiche at its
  real amount. Rules 28-31.
- **Q4. Undoing a recorded payment** → (a) a confirmation naming the date and the accounting entry.
  Rule 14.
- **Q5. Complements in the ledger** → (a) they are ledger rows; their lines, adjustment and « Percevoir
  en fin de séjour » fold under the row's « Détail ». Rule 22.

### Amendment of 2026-10-28

- **Q-C. The notice's wording — Resolved 2026-10-28.** Adrien kept the stored amounts in the usual card
  (rule 50) but questioned the « écarts » list itself: on a platform stay a gap with our tariff is the
  policy, not an anomaly. Decision: no drift notice at all (rules 53-55 withdrawn, rule 57); one alert
  only when a platform's brut is far from the « Prix plateformes » grid of that channel (rules 58-63);
  no « Appliquer le calcul actuel » (rule 64).

- **Q-D. The alert band — Resolved 2026-10-28:** (a) below −15 % or above +25 % of the grid, and at least
  30 € — absorbs a non-refundable rate and rounding, fires on Genius stacked on it and on any season or
  cleaning-fee mistake. Rejected: (b) symmetric ±20 % and 30 €; (c) below only. The constants live on
  the server (rule 63).
- **Q-F. Dismissing an alert — Resolved 2026-10-28:** (a) not dismissable — it is rare by construction
  and goes away when the channel is fixed or the stay starts. Rejected: (b) « Ignorer » per fiche.

### Review of 2026-10-28 — resolved

- **Gîtes de France fiche 22308 raises the alert — Resolved 2026-10-28 (Adrien):** keep the alert as it is. The
  gap is real; Adrien aligns the Gîtes de France prices in ITEA on the grid, so 22308 is expected to alert until then.
  No code change.
- Stored card: « Total du séjour » is the sticky bar's (`storedHeadline`, rule 31 of
  ui-review-2026-10-19-operations: one gross for live and stored): the saved price plus the tourist tax as the
  books know it — the amount the operator stated as withheld by the platform when there is one. That stated
  amount is printed on the tax line struck with its « Plateforme » tag and deducted in the cascade
  (« Taxe de séjour (plateforme) »), so the lines add up to the total. The stated amount counts only on a
  row that keeps no tourist tax of its own (`touristTaxTotal` 0, as the engine's « offered » mode leaves
  it): a leftover amount on a row that carries a tax — a platform switched to « nous reverse » — is
  ignored by the card and by the bar alike (`storedWithheldTax`), and the tax to declare stays on the card. A parity script over the shadow stays checks card = bar and printed lines = total.
- Rule 61, cleaning fee: the stay is read twice (extras taken out of « paid », and left in) and only a gap
  in both readings, on the same side, alerts.

## 10. Implementation progress — amendment of 2026-10-28

Implemented on `feature/clients-directory-and-fiche-tariff` (commits `feat(reservations): stored summary in the usual card, platform price alert` and `fix(reservations): skip the platform price check on nights the tariff has left behind`).

- Server: `utils/storedSummary.js`, `utils/platformPriceCheck.js`, `tariffChangeJournalModel.hasEventAfter`, `calculate-price` → `platformPriceCheck`; 6 + 16 new unit cases.
- Client: `PricingSummary` `mode` / `topNotice`, `PlatformPriceAlert`, `StoredPricingSummary` deleted; 7 + 5 + 2 new Vitest cases; E2E `reservations/stored-summary.spec.js` (4).
- Deviations: `lines[]` replaced by quote-shaped `optionLines` / `resourceLines` (rule 51 note); no `gridCellOf` extraction (rule 59 reads `platformPrices()`); the eight channel totals of tariff recipes rule 54 were not replayed (rule 59 test note); rule 61 gained the « replayed nights differ from today's seasons » clause.
- Real-data pass (shadow copy of 2026-10-22): of the 6 upcoming platform fiches, **1 raises the alert** — 22308 (Gîtes de France, Granja, 504,00 € paid against 640,00 € on the grid, −21 %; the ménage of 80 € and the withheld tax are out of « paid »). The first run raised 2: 22270 (Booking, Estiva, 2027) read +43 % because it was sold in August 2026 on the 100 € fallback nights of a season that did not exist yet; rule 61's new clause silences it. The Booking fiches 22324, 22282, 22301 and 22304 show no alert and the usual card. Checked at 390 (sheet from the total bar: alert, 44 px link, no horizontal scroll) and 1280.
- Suites: server 7113 pass in the full run (+1 case added afterwards, its file green), client Vitest 2607 pass, vite build and bundle budget (286.2 kB gzip of 313.3 kB) pass, E2E 165 pass + 1 skipped (one load-only failure, `devis-property-switch-offered`, passes alone), prod E2E 4, bare E2E 6; `check-spec-coverage --changed` and `check-plugin-versions --base origin/inte/plugins` pass.
