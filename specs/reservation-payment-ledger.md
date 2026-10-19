# Payments as a status ledger

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `docs/payments-ledger-spec` (spec) — implementation branch to be cut once approved |
| **Created** | 2026-10-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
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
  received ([reservationsController.js `updatePayment`](../server/src/controllers/reservationsController.js)
  writes `cautionReturned` unconditionally); a paid date can be typed in the future for the acompte,
  the solde and the caution (only the single arrival payment validates its date —
  [arrivalPaymentDate.js](../server/src/utils/arrivalPaymentDate.js)).
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
  (`pricing.js` frozen-deposit branch) — the operator types 900 and sees 600 without a word.
- **Payment links drift.** A Qonto link is minted for an amount (`payment_links.amountCents`). When the
  acompte or solde changes afterwards, the open link stays payable at the old amount until somebody
  re-sends the request ([paymentRequestService.js](../server/src/utils/paymentRequestService.js)
  retires a stale link only on the next `ensurePaymentLink`). If the guest pays it in between, the poll
  records the bucket as paid at the **new** amount
  ([paymentPollRunner.js `applyPaidEffect`](../server/src/utils/paymentPollRunner.js)). The fiche
  never shows a link's status at all.
- **The client derives states.** Paid/unpaid, « payment unique », what can be edited and why: all
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
   **one** primary action, an optional `detail` (the lines, the commission, the link) and an
   `amountEdit` descriptor (`{ editable, min, max, reason }`, rule 13).
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

   The origin of a paid row is what the data already knows: « lien de paiement » (a `paid`
   `payment_links` row of that type), « caisse interne » (`*PaidCash`), « <plateforme> » (a platform
   payout), « paiement unique » (an `arrivalPaymentGroup` naming the bucket), else nothing. No new
   column (see §9 Q2).
5. **« Reste à percevoir »** closes the ledger: the sum of the due rows, computed by the server
   (same arithmetic as [paymentStatus.js](../server/src/utils/paymentStatus.js), extended to the
   complements). A platform row counts for the net the platform will transfer (gross − its
   commission), since that is what reaches the bank. It reads « Tout est perçu » when zero. It never repeats the « Net perçu » or
   « Total du séjour » of the pricing summary.
6. **Rows that do not apply** say why, in one muted line, with no input and no action:
   - acompte on a platform without acompte — « Sans objet · Booking.com encaisse en une fois »;
   - acompte disabled on the reservation — « Sans objet · acompte désactivé »;
   - acompte off for the property, or a last-minute stay
     ([deposit-blocks-the-dates.md](deposit-blocks-the-dates.md) rules 4-6) — « Sans objet · paiement
     en une fois »;
   - caution of a property with no caution — « Sans objet ».
7. **The ledger is rebuilt from the live quote.** While the fiche is being edited, the unpaid rows
   follow `POST /api/reservations/calculate-price` (the same live quote the pricing summary reads);
   the paid rows come from the stored row. Nothing in the ledger waits for « Enregistrer » to be
   truthful.

### 3.2 Recording a movement

8. **One action per due row: « Marquer perçu »** (« Recevoir » for the caution, « Restituer » for its
   return, « Marquer reçu » for a platform payout). It opens an inline form under the row — never a
   dialog — with the date prefilled to today, the « Caisse interne » switch where it exists today
   (acompte and solde collected at the door, complements), and « Valider » / « Annuler ». Closing the
   form restores the row exactly.
9. **The date is validated by the server**, for every row, with
   [arrivalPaymentDate.js](../server/src/utils/arrivalPaymentDate.js): not in the future (« Un
   encaissement ne peut pas être daté dans le futur. »), not before the reservation existed. The
   refusal is shown under the date field, the form stays open with the typed value.
10. **Marking saves the fiche first.** « Valider » runs through the page's existing `saveThenRun`
    pipeline (as the mid-stay notes do), then PATCHes the mark. A mark can never be recorded against
    an amount the server has not stored.
11. **The mark carries the amount the operator saw.** `PATCH /api/reservations/:id/payment` accepts
    `expectedAmount` for the acompte, the solde and the complements; when it differs from the stored
    amount the server refuses with 409 `AMOUNT_CHANGED` (« Le montant a changé entre-temps : relire la
    fiche. ») and records nothing. Two open tabs cannot book two different amounts.
12. **The caution follows the order of events.** « Restituer » is offered only once the caution is
    received (state « Après réception » until then); the server refuses `cautionReturned` without a
    received caution (409 `CAUTION_NOT_RECEIVED`, « La caution n'a pas encore été reçue. ») and a
    return date before the receipt date (« Restitution avant la réception (14/08). »). Caution marks
    become immediate like every other mark (no more draft-until-save).
12bis. **Undoing a mark** is the row's action once it is done (« Annuler »). It asks for confirmation
    (« Annuler la perception de l'acompte du 12/08 ? L'écriture comptable correspondante disparaît. »),
    then behaves exactly as un-ticking does today: contributions released
    (`clearContribsOnUnflip`), single-payment group dissolved
    ([single-payment-at-check-in.md](single-payment-at-check-in.md) rule 17). Undoing « Caution reçue »
    also undoes « Caution restituée ».

### 3.3 Setting the amounts — acompte and solde

Notation for a direct stay: **P** = pre-arrival amount (acompte + solde), **H** = its accommodation
part, **T** = the tourist tax riding on the solde (`P = H + T`,
[tourist-tax-on-solde.md](tourist-tax-on-solde.md)). All amounts are euros rounded to the cent
(`roundMoney`, half away from zero); the field accepts « 12,5 », « 12.5 » and arithmetic
([reservation-price-arithmetic.md](reservation-price-arithmetic.md)), and a value with more than two
decimals is rounded and shown rounded.

13. **Every row says whether its amount can be edited, and why not.** The server sends
    `amountEdit = { editable, min, max, reason }`. An editable amount shows a « Modifier » affordance
    on the amount itself; a non-editable one shows its reason on demand (« Acompte perçu le 12/08 :
    annuler la perception pour corriger le montant. »). Decision 8 condition: acompte and solde stay
    settable.
14. **Acompte, not yet perceived: `0 ≤ A ≤ H`.** Same freeze as today
    ([editable-deposit-amount.md](editable-deposit-amount.md) rules 2-8): the value is stored in
    `depositAmountOverride`, the solde becomes `P − A` and absorbs every later price change; emptying
    the field restores the percentage. **What changes:** an out-of-range value is **refused**, no
    longer silently clamped — negative: « Un montant ne peut pas être négatif. »; above H:
    « L'acompte ne dépasse pas l'hébergement (600,00 €) : la taxe de séjour reste sur le solde. »
    The engine keeps its clamp as a last line of defence.
15. **Solde, acompte not yet perceived: `T ≤ S ≤ P`.** Typing the solde sets the split, not the
    price: the server stores `depositAmountOverride = P − S` and the total of the stay does not
    move. Below T: « Le solde porte la taxe de séjour (19,80 €) : pas en dessous. »; above P:
    « Au-delà du séjour (987,39 €) : modifier le prix de l'hébergement. »
16. **Solde, acompte already perceived (or no acompte at all).** The split is fixed, so a different
    solde is a different price. The server translates it into the accommodation adjusted price
    (`customPrice`, the only price lever of a direct stay), re-runs the engine until the solde lands
    on the typed amount (the tax base follows the accommodation, so it may take two passes), and
    returns the consequence **before** anything is applied: « Hébergement : 600,00 € → 550,00 € ·
    taxe de séjour 19,80 € → 18,15 € ». « Valider » applies it to the form (saved with the fiche as
    any price change, traced in the history); « Annuler » leaves everything as it was. Floor: the
    solde cannot go below the tax it carries nor make the accommodation negative. **Pending
    Adrien's answer to §9 Q1.**
17. **A perceived row keeps what it collected.** On a paid acompte or solde the amount is not
    editable (rule 13). If the operator still types an amount in the editor of a paid row, the
    refusal names the right gesture: lower — « Déjà perçu : 987,39 €. Pour rendre 87,39 €, créer un
    remboursement. » with a « Créer le remboursement » button that opens the refund dialog prefilled
    ([reservation-refunds.md](reservation-refunds.md)); higher — « Déjà perçu : 987,39 €. Pour un
    autre montant, annuler la perception puis la refaire. » Consistent with
    [reservation-refunds.md](reservation-refunds.md) rule 36 (a paid solde keeps what it collected).
18. **A paid solde freezes the acompte.** If the solde is perceived and the acompte is not (an
    unusual order, but possible), the acompte amount is not editable: « Solde déjà perçu : l'acompte
    ne peut plus changer. »
19. **The server validates, the field only proposes.** The amount editor sends the typed value to
    the live quote (`ledgerEdit: { row, amount }` in the `calculate-price` body); the server answers
    with the refusal reason or with the effects (rule 16) and the exact form fields to apply
    (`formPatch`: `depositAmountOverride` or `customPrice`). The client applies `formPatch` verbatim
    and computes nothing. The same validation runs again at save (`PUT /api/reservations/:id`), so a
    crafted request gets the same refusal (400 with the same French message).
20. **Complements keep their own rules.** The arrival / end-of-stay / merged complement rows expose
    the existing « Montant ajusté » ([adjustable-complement-amounts.md](adjustable-complement-amounts.md)
    rules 1-30, floors and accounting split unchanged) through the same row editor; the mid-stay
    notes keep their per-note editing (§3.4 of that spec). Only the presentation moves.
21. **History.** Every amount set from the ledger is traced in `reservation_history` with a readable
    label (« Acompte : 296,22 € → 350,00 € », « Solde : 691,17 € → 600,00 € (acompte 387,39 €) »).

### 3.4 Platform reservations

22. **The platform row replaces the solde.** Label « Versement <plateforme> », amount = the gross
    pre-arrival amount the platform settles, state from the payout due date
    ([platform-payout-due-date.md](platform-payout-due-date.md)) — « Attendu le 02/09 » / « En retard
    depuis le 02/09 ». Its detail line reads « Commission 157,97 € · net 829,42 € ». A platform with
    acompte ([platform-deposit-toggle.md](platform-deposit-toggle.md)) shows both rows, each with its
    own commission.
23. **The platform's figures stay editable, in the row.** The amount of a platform row is not typed
    directly: « Modifier » opens the statement fields that are the levers today — « Total facturé
    par la plateforme » / « Montant total payé par le client », « Taxe de séjour retenue » and the
    per-échéance commission ([platform-payment-entry.md](platform-payment-entry.md),
    [platform-per-echeance-commission.md](platform-per-echeance-commission.md),
    [platform-tourist-tax-out-of-the-commission.md](platform-tourist-tax-out-of-the-commission.md)),
    with their labels, helpers and server rules unchanged.
24. **« Marquer reçu » asks for the transfer.** Its form holds the date and « Virement reçu »,
    prefilled with the expected net. When the typed transfer differs from the net, the form shows the
    gap (« Écart : 12,03 € avec le net attendu ») and one button, « Commission solde → 169,99 € »,
    which is today's « Calculer la commission » (server-computed, `POST
    /api/reservations/platform-commission`). Validating stores `balancePaid`,
    `balancePaidDate` and `platformPayoutAmount` together. The reconciliation chip (« ✓ cohérent avec
    le virement » / « écart : … ») moves onto the row.
25. **The pricing summary keeps the hero figure** (decision 6, « Vous percevez »). The ledger does not
    repeat « Net perçu » as a separate line any more.

### 3.5 Payment links

26. **A link is shown on its row.** When a `payment_links` row exists for the acompte, the solde or
    the full payment, the row's detail reads « Lien envoyé le 03/08 · 296,22 € » (open), « Payé par
    lien le 05/08 » (paid), or « Lien retiré · montant modifié » (cancelled by rule 27). Sending a
    request stays where it is today (page actions).
27. **Changing an amount retires its open link.** At save, when the acompte or solde amount differs
    from an open link of that type, the server checks the link was not paid meanwhile
    (`assertNotPaid`), cancels it with `cancelReason = 'amount-changed'` and deactivates it at the
    provider ([plugins-phase-3a-online-payment.md](plugins-phase-3a-online-payment.md) rules 7-9 —
    provider down: retired locally, the poll retries). The row then offers « Renvoyer la demande ».
    **Pending §9 Q3.**
28. **A link paid in the meantime wins.** If `assertNotPaid` finds the open link paid, the save is
    refused (409 `LINK_ALREADY_PAID`, « Le lien de 296,22 € vient d'être payé : montant non
    modifié. ») and the poll records the payment as today.

**Edge cases:**

- Acompte override set, then the platform switched from direct → the engine ignores it as today; the
  acompte row reads « Sans objet » and its editor is gone.
- Solde typed equal to P (acompte unpaid) → acompte 0 €, row « Acompte 0,00 € » kept (it is an
  explicit choice, distinct from « Sans objet »), deadline NULL as today.
- Solde typed with acompte unpaid **and** a single arrival payment group naming the acompte → the
  group is the truth: the acompte is perceived, so rule 16 applies, not rule 15.
- A paid link whose amount differs from its row (residual race) → the row shows a warning chip
  « Payé 296,22 € par lien, 350,00 € attendus »; no automatic correction (out of scope, §8).
- Cancelled reservation → the ledger is read-only (`cancelledGuard`); the rows keep their states, the
  retained acompte reads « Conservé · indemnité d'annulation »
  ([cancellation-compensation.md](cancellation-compensation.md)).
- Past reservation, locked → read-only until unlocked
  ([admin-unlock-past-reservations.md](admin-unlock-past-reservations.md)).
- Reception-only user → the ledger is not sent (finance-stripped view, unchanged).
- Devis → the ledger shows the planned acompte / solde with their amounts editable (rules 14-16), no
  « Marquer perçu », no caution rows.

---

## 4. Architecture

> **Fat backend, thin frontend.** The rows, their states, the editable ranges, the refusals, the
> translation of a typed solde into the form fields to apply: all server-side. The client renders the
> rows, keeps the open/closed state of the inline editor and the typed draft, and forwards values.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `reservationLedger.js` | C | Pure shaper: `(reservation or live quote, links, refund register, arrival group, today) → { rows, remaining }` (rules 1-7, 13, 22, 26). |
| `utils/` | `ledgerAmountEdit.js` | C | Pure: validates a typed acompte / solde against P, H, T and the paid flags; returns `{ ok, reason }` or `{ ok, effects, formPatch }` (rules 14-19). Solde-to-price translation re-runs an injected engine callback (rule 16). |
| `utils/` | `arrivalPaymentDate.js` | T | Reused for every mark date (rule 9); message wording generalised. |
| `utils/` | `paymentRequestService.js` | T | Expose the stale-link retirement so the save can call it (rule 27). |
| `utils/` | `pricing.js` | — | Unchanged: the override branches already exist; the clamp stays as defence (rule 14). |
| `controllers/` | `reservationsController.js` | T | `getById` adds `ledger`; `calculatePrice` adds `ledger` and answers `ledgerEdit`; `update` re-validates amounts and retires stale links (rules 19, 27-28); `updatePayment` validates dates, `expectedAmount`, caution order (rules 9, 11, 12). |
| `controllers/` | `refundsController.js` | — | Unchanged; its register feeds the refund rows. |
| `models/` | `paymentLinksModel.js` | T | `retireForAmountChange(reservationId, type, newAmountCents)` (rule 27). |
| `models/` | `reservationsModel.js` | T | History labels for ledger amount edits (rule 21). |
| `routes/` | `reservations.js` | — | No new route. |
| `database.js` | — | — | No schema change (§5). |
| `tests/` | `reservation-ledger.unit.test.js` | C | Rows, order, states, labels, origins, remaining (rules 1-7, 22, 26). |
| `tests/` | `reservation-ledger-amounts.unit.test.js` | C | Ranges, refusals, solde split vs price translation, paid rows (rules 13-19). |
| `tests/` | `reservation-ledger-marks.unit.test.js` | C | Date validation, `AMOUNT_CHANGED`, caution order, undo (rules 9-12bis). |
| `tests/` | `reservation-ledger-links.unit.test.js` | C | Link display and retirement on amount change (rules 26-28). |
| `tests/` | `reservation-ledger-parity.unit.test.js` | C | Accounting parity on a neutralised copy of the Solio base: for every stored reservation, the ledger's paid/unpaid amounts equal today's `computePaymentStatus` + complement flags (§7). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `LedgerList.jsx` | C | Generic: renders server rows (label · amount · status · one action), the inline form slot and the closing total. |
| `components/` | `LedgerAmountEditor.jsx` | C | Generic: inline amount field (`ArithmeticTextField`) + server refusal or effects + Valider / Annuler. |
| `components/` | `StatusBadge.jsx` | T | Tones `due`, `late`, `done`, `muted` on the Maison soft-bg chips. |
| `components/` | `reservation/FinanceSection.jsx` | T | Keeps the price block; replaces the Acompte / Solde / Caution / complements / refunds blocks with `LedgerList`; the platform statement fields move into the platform row's editor. |
| `components/` | `reservation/RefundDialog.jsx` | T | Accepts a prefilled amount (rule 17). |
| `pages/` | `ReservationPage.jsx` | T | Holds `ledger` from the fiche and the live quote; routes marks through `saveThenRun`; applies `formPatch`. |
| `api.js` | `api.js` | T | `markPayment` passes `expectedAmount`; `calculatePrice` passes `ledgerEdit`. |
| `__tests__/` | `LedgerList.rendering.test.jsx`, `LedgerAmountEditor.refusals.test.jsx`, `FinanceSection.ledger.test.jsx` | C | One file per subject. |

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
| POST | `/api/reservations/calculate-price` | `{ …, ledgerEdit?: { row: 'deposit' \| 'balance', amount } }` | `{ …quote, ledger, ledgerEdit?: { ok, reason? , effects?, formPatch? } }` | Additive. `ledgerEdit` answered only when asked. |
| PUT | `/api/reservations/:id` | unchanged | unchanged | Same amount validation (400 + French `message`); 409 `LINK_ALREADY_PAID` (rule 28). |
| PATCH | `/api/reservations/:id/payment` | `{ …, expectedAmount?, <bucket>PaidDate }` | `{ ok: true }` | 400 date refusal; 409 `AMOUNT_CHANGED`, `CAUTION_NOT_RECEIVED`. |

Row shape:

```json
{ "key": "balance", "label": "Solde", "amount": 691.17, "state": "due", "tone": "due",
  "stateLabel": "À percevoir avant le 23/08", "action": { "kind": "mark", "label": "Marquer perçu" },
  "amountEdit": { "editable": true, "min": 19.8, "max": 987.39, "reason": null },
  "detail": { "link": { "status": "open", "label": "Lien envoyé le 03/08 · 691,17 €" } } }
```

---

## 5. Data model

**No schema change.** The ledger is a view over existing columns: `deposit*`, `balance*`,
`complement*`, `endOfStayComplement*`, `caution*`, `depositAmountOverride`, `customPrice`,
`platform*Amount`, `arrivalPaymentGroup`, `payment_links`, `reservation_refunds`.
`payment_links.cancelReason` gains the value `'amount-changed'` (free TEXT, no CHECK constraint).

**Data impact:** none on existing rows. The new refusals (acompte above H, caution returned before
received, future dates) apply to new writes only; stored rows that already break them are displayed
as they are (a returned-but-never-received caution shows both rows done, with a warning chip
« Restituée sans réception enregistrée »).

## 6. UI / UX

Interactive rendering: [docs/specs/2026-10-19-reservation-payment-ledger.html](../docs/specs/2026-10-19-reservation-payment-ledger.html).

**Card « Paiements »** (replaces the lower half of « Finance »; the price block stays above):

- Each row: **label** (serif-free, 600) · **amount** (tabular, right-aligned, non-breaking) · **state
  chip** (Maison soft background + dark text: success / warning / error / muted) · **one action**
  (outlined primary pill; « Annuler » is a text button). One button treatment per role.
- The amount of an editable row is itself the « Modifier » affordance (underlined dotted, pencil
  glyph, 44 px target). Opening it replaces the state line by the editor: field, help or refusal
  under it (`aria-live`), effects (rule 16) and « Valider » / « Annuler ».
- A refusal is red text under the field, the field keeps the typed value, focus stays in the field,
  « Valider » is disabled with the reason beside it — never a toast, never a disabled button
  without a reason.
- Marking opens the inline form under the row (date, « Caisse interne » where it applies, platform:
  « Virement reçu »), prefilled to today.
- Detail (complement lines, commission, link) folds under a « Détail » disclosure on the row.
- The closing line « Reste à percevoir 691,17 € » / « Tout est perçu ».
- Motion: the inline form expands with a 200 ms ease-out height + opacity; a refusal does one 4 px
  shake; both replaced by an opacity cross-fade under `prefers-reduced-motion`.

**Responsive:**

- `xs` (≤ 600 px): each row is two lines — label + amount on the first, chip + action on the second
  (action right-aligned, ≥ 44 × 44). The inline form stacks: date, switch, then « Valider » full
  width and « Annuler » as text. No horizontal scroll; the amount never wraps.
- `md` (~900 px): one line per row, columns `label | amount | state | action`; the form lays out on
  one line.
- `lg` (≥ 1200 px): same as `md` inside the fiche column; the card no longer splits Acompte / Solde
  into two side-by-side columns.

**`PageActionBar`:** unchanged. « Enregistrer » still saves the fiche; marks save first (rule 10).

**Copy** — short and impersonal: « Marquer perçu », « Recevoir », « Restituer », « Marquer reçu »,
« Annuler », « Valider », « Reste à percevoir », « Tout est perçu », plus the refusals of rules 9,
11, 12, 14-18, 28.

## 7. Test plan

### Server unit tests
- [ ] `reservation-ledger.unit.test.js` — rules 1-7, 22, 25-26: direct with acompte, direct without
  acompte, last-minute, platform without and with acompte, complement deferred, single arrival
  payment, refunds and trop-perçu, caution states, cancelled stay.
- [ ] `reservation-ledger-amounts.unit.test.js` — rules 13-19, 21: acompte 0 / H / H + 0,01 / −1;
  solde T − 0,01 / T / P / P + 0,01 with acompte unpaid; solde with acompte paid (price translation,
  tax that follows the accommodation, floor); paid rows lower / higher; « 12,5 » and « 100+20 »;
  three-decimal input rounded.
- [ ] `reservation-ledger-marks.unit.test.js` — rules 9-12bis: future date, date before booking,
  `AMOUNT_CHANGED`, caution order and dates, undo cascades.
- [ ] `reservation-ledger-links.unit.test.js` — rules 26-28 with a fake provider: retire on change,
  provider down → remote-pending, paid meanwhile → 409.
- [ ] `reservation-ledger-parity.unit.test.js` — accounting parity: on a neutralised copy of the Solio
  base, the ledger reproduces exactly today's paid / unpaid amounts and remaining due for every
  reservation; the accounting export of the copy is byte-identical before and after.

### Client (Vitest)
- [ ] `LedgerList.rendering.test.jsx` — renders server rows verbatim, one action per row, xs layout.
- [ ] `LedgerAmountEditor.refusals.test.jsx` — shows the server refusal, keeps the typed value,
  applies `formPatch` verbatim.
- [ ] `FinanceSection.ledger.test.jsx` — marks go through `saveThenRun`; caution « Restituer » absent
  before receipt.

### E2E
- [ ] Update the finance specs that click « Marquer acompte payé » / « Marquer solde payé » /
  « Marquer caution reçue ».
- [ ] New flow: set the solde with the acompte unpaid, mark the acompte perceived, try a future date
  (refused), mark with today.

### Manual UI verification
- [ ] 390, 900 and 1280 px on a copy of the Solio base: a direct stay with acompte, a Booking stay, a
  Gîtes de France stay with withheld tax, a stay with a single arrival payment, a cancelled stay.
- [ ] Worst case: long platform name, five refunds, zero payment (devis), amounts ≥ 10 000 €.

## 8. Out of scope

- Partial payments (several payments on one acompte or solde) and an automatic correction when a
  link is paid at a stale amount (the warning chip of §3 edge cases is the whole answer here).
- A per-payment means column (Virement, CB, Chèque…) — §9 Q2.
- Moving « Envoyer la demande d'acompte / de solde » out of the page actions.
- The pricing summary rework (review proposal 6, separate lot) and the sticky total bar (decision 6).
- Editing the caution amount (frozen from the property at receipt,
  [caution-live-from-property.md](caution-live-from-property.md)).
- The SAS screens: they keep their own payment steps; reusing `LedgerList` there is a later spec.

## 9. Open questions

- **Q1. Solde typed while the acompte is already perceived (or there is no acompte).** Rule 16.
  - (a) **Recommended** — accepted as a price change: the server translates it into the
    accommodation adjusted price and shows « Hébergement 600 € → 550 € » before « Valider ».
  - (b) Refused, with a pointer to « Prix hébergement ajusté ».
- **Q2. Means of payment.**
  - (a) **Recommended** — no new column: the row shows the origin the data already knows (lien,
    caisse interne, plateforme, paiement unique).
  - (b) A `*PaidMethod` column (Virement, CB, Chèque, Espèces, ANCV) on acompte, solde and caution,
    asked in the mark form.
- **Q3. Open payment link when its amount changes.** Rule 27.
  - (a) **Recommended** — retire and deactivate the old link at save, the row offers « Renvoyer la
    demande ».
  - (b) Refuse the amount change while a link is open.
- **Q4. Undoing a recorded payment.** Rule 12bis.
  - (a) **Recommended** — confirmation dialog naming the date and the accounting entry.
  - (b) Immediate undo with a « Rétablir » toast.
- **Q5. Complements in the ledger.** Rule 20.
  - (a) **Recommended** — they become ledger rows, their lines, adjustment and « Percevoir en fin de
    séjour » folded under « Détail ».
  - (b) First version limited to acompte, solde, caution and refunds; complement cards stay as
    they are below the ledger.
