# Payments as a status ledger

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `docs/payments-ledger-spec` (spec, #718) · `feature/reservation-payment-ledger` (implementation) |
| **Created** | 2026-10-19 |
| **Author** | Adrien |
| **Related PR** | #718 (spec) |
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
    - `complement` → the complement is recorded perceived and the row carries a `warning` detail
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
| `utils/` | `paymentPollRunner.js` | T | `retryPendingCancellations` books a paid `'amount-changed'` link per rule 31 instead of only notifying. |
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
| `tests/` | `reservation-ledger-parity.unit.test.js` | C | Parity on a neutralised copy of the Solio base (§7), `LEDGER_PARITY_DB=<copy>`; a synthetic base otherwise (CI). |
| `tests/` | `ledgerFixture.js` | C | Shared fixture: in-memory base, one property, the real controller driven like the fiche. |

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

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `ArithmeticTextField`, `DateField`, `ConfirmDialog`, `PageActionBar` | `PageActionBar` untouched. |
| **Created (new generic)** | `LedgerList`, `LedgerAmountEditor` | Generic because the same « row = amount + state + one action » shape is wanted by the SAS recap payments ([sas-recap-payment-buttons.md](sas-recap-payment-buttons.md)) and the finance « paiements à venir » table; neither knows about reservations. |
| **Specific (kept feature-local)** | `FinanceSection` | Reservation-specific orchestration only. `ComplementCard` and `ArrivalPaymentCard` become the `detail` content of their rows. |

### 4.3 API contract

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

**`PageActionBar`:** unchanged. « Enregistrer » still saves the fiche; marks save first (rule 10).

**Copy** — short and impersonal: « Marquer perçu », « Recevoir », « Restituer », « Marquer reçu »,
« Annuler », « Valider », « Reste à percevoir », « Tout est perçu », plus the refusals of rules 9,
11, 12, 16-20, 30.

## 7. Test plan

### Server unit tests (69)
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
- [x] `reservation-ledger-parity.unit.test.js` (1) — rules 1, 4, 5. **Run 2026-10-19 on a neutralised
  copy of the Solio base (56 reservations): every bucket state and amount matches `bucketStates`, every
  `remaining` matches `remainingToPay`, the accounting export (17 months, 12 116 bytes) is
  byte-identical before and after, and identical between `inte/plugins` and this branch (same
  SHA-256).** CI runs it on a synthetic base (10 stays covering every bucket state).

### Client (Vitest)
- [x] `LedgerList.rendering.test.jsx` (8), `LedgerAmountEditor.refusals.test.jsx` (6),
  `FinanceSection.ledger.test.jsx` (19: locked amounts, confirmation per row type, stored-amount line,
  form-level refusal, server date label, focus return).
- [x] The FinanceSection suites of other specs moved onto the ledger rows (complement-adjust,
  deferred-complement, caisse-interne, mid-stay-notes, platform-no-deposit, platform-tourist-tax,
  refunds, single-arrival-payment, arrival-payment-detail, RefundDialog overpayment).

### E2E
- [x] `e2e/specs/reservations/payment-ledger.spec.js` (5): a past locked Booking stay received with its
  transfer and no full save; a drifted stored amount shown and marked as stored, no save, the fiche left
  unmodified; set the solde, refusal of an acompte above
  the accommodation, future date refused then today, undo with confirmation, caution in order; a
  Booking payout received with its transfer and gap; no sideways scroll at 390 px.
- [x] `booking-intake.spec.js` anchors on « Paiements » (the « Paiement plateforme » heading is gone).

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
