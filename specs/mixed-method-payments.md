# One payment, several methods

| Field | Value |
|---|---|
| **Status** | Implemented (2026-11-09) |
| **Branch** | `feature/mixed-method-payments` (from `inte/plugins`) |
| **Created** | 2026-11-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary page** | [docs/specs/2026-11-08-mixed-method-payments.html](../docs/specs/2026-11-08-mixed-method-payments.html) — interactive mock, 390 and 1280 px |

---

## 1. Context

On 2026-11-08 the guests of the day took the end-of-stay cleaning at check-out and paid part of it in
cash and the rest by card. GuestFlow cannot record that.

Today each payment bucket of a reservation is a set of flags on `reservations`
(`<bucket>Paid`, `<bucket>PaidDate`, `<bucket>PaidCash`; `server/src/schema.sql`), and the only
« method » a bucket knows is the boolean `*PaidCash` = caisse interne (off the books). « CB / Chèque »
is stored nowhere: it only means `cash = 0`. One bucket is therefore either wholly on the books or
wholly in the caisse interne. The same holds for the single arrival payment (`arrivalPaymentGroup.cash`),
the mid-stay notes (`midStaySettledNotes[].paidCash`) and the SAS commits (`PaymentModeButtons`,
single-select). Only the installments carry a real `paidMethod`, still one per installment.

[reservation-payment-ledger.md](reservation-payment-ledger.md) §8 and Q2 explicitly left a per-payment
method out. This spec revisits that decision for the payments the operator records by hand, without
changing the ordinary one-click path.

**Benchmark (HIPPOCAMP, relevé of 2026-11-05).** A payment hangs off an invoice; a mixed payment is
entered as several successive payments, one per method (« Saisir un autre mouvement »), against a
configurable list of methods (Espèces and Chèque flagged as going through the till). A payment line
can be edited or deleted until the till is closed. Entry is always visible. We keep the idea « one line
per method » but enter all the lines in one gesture, with the remainder filled automatically, and keep
the whole thing out of sight until asked for.

**Decisions (AskUserQuestion, 2026-11-08):**
- D1 — Access: a **discreet « Plusieurs moyens » control** next to every manual mark-paid gesture; nothing
  changes otherwise.
- D2 — A cash line goes to the **caisse interne by default**, switch available to put it on the books.
- D3 — ~~The lines must add up exactly to the amount due; no partial payment.~~ **Revised 2026-11-09 by
  D6.**
- D4 — **Fixed list** of methods: CB, Espèces, Chèque, Virement, Chèques-vacances, Autre.

**Feedback of 2026-11-09 (Adrien, on the summary page):**
- D5 — A recorded split payment **can be modified** afterwards, to correct a mistake.
- D6 — When the lines do not cover the amount due, the form **warns** and asks what becomes of the
  amount not received, instead of refusing.

**Review of 2026-11-09 (AskUserQuestion):**
- D7 — A paid split bucket whose amount moves afterwards is **read again at its new amount**: a rise is a
  reste à percevoir, a fall cancels the reste and the geste and is then said as a trop-perçu (rules 39-40).
  Not chosen: refusing the change, or undoing the split payment.

## 2. Goal

When a guest settles one amount with several methods (cash + card, cheque + cash…), the operator
records it in one gesture where they already mark payments, says which part went to the caisse
interne, decides what happens to any amount not received, and can correct the record later. The
books, the bank reconciliation and the finance figures count exactly the part that went on the books.

## 3. Functional rules

### 3.1 Scope

1. A **split payment** (a *settlement*) is a manual payment recorded as 1 to 4 **tender lines**, each
   one `{ method, amountCents, internal }`, at one date. It is available on every target the operator
   marks by hand:
   - a ledger bucket of the fiche: acompte, solde, complément d'arrivée, fin de séjour;
   - the single arrival payment (« Encaisser en une fois », fiche and SAS);
   - the SAS departure settlement of the complements;
   - a mid-stay note settled from `MidStayNoteDialog`;
   - an installment of the direct-booking schedule.
2. Never available on a payment-link payment, a platform payout, a refund or the caution: the money
   did not change hands at the desk.
3. The ordinary gestures are unchanged: « Valider », « CB / Chèque », « Caisse interne », « Payé en
   liquide » keep writing exactly what they write today and create no settlement.

### 3.2 Methods

4. Fixed list, server-owned (`utils/paymentTenders.js`), in this order:
   `card` « CB », `cash` « Espèces », `cheque` « Chèque », `transfer` « Virement »,
   `holidayVoucher` « Chèques-vacances », `other` « Autre ». The client receives value + label from
   the ledger payload; it holds no list of its own.
5. `internal` (caisse interne) is accepted only on a `cash` line. A `cash` line is proposed with
   `internal = true` (D2); the switch puts it on the books.

### 3.3 Amounts

6. Every line is > 0 and in cents. Their sum is the **amount received**. Against the amount the target
   owes (`expectedAmountCents`, the same figure the ordinary mark already checks):
   - **equal** → the target is settled;
   - **lower** → the gap is a **shortfall**, handled by §3.5 — never silently;
   - **higher** → refused: « Les moyens font 130,00 € pour 122,00 € dus. » The form stays open with the
     typed values.
7. Entry is proposed with two lines: `cash` (empty, focused) then `card`. The **last line takes the
   remainder** while the operator types in the others; typing in the last line itself freezes it and
   the remainder moves to the meter. The meter under the lines reads « Reste 0,00 € » (covered),
   « 8,00 € non couverts » (shortfall, §3.5) or « 8,00 € de trop » (submit disabled). This running
   difference is a UX hint; rule 6 is the authority.
   *Reading of 2026-11-09 (audit R34-C-L2):* an untyped last line the others already cover (at 0) is no line: it is
   not sent and blocks nothing; a line typed at 0 still blocks.
8. Two lines with the same method and the same `internal` are refused (« Une seule ligne CB. »): the
   operator adds to the existing one.
9. The arithmetic already accepted in amount fields (`evaluateArithmetic`: `40+10`) is accepted in a
   line.

### 3.4 What a settlement writes

10. A settlement is one `payment_settlements` row (target, date, amount due, shortfall and its
    disposition, and `parts`: the buckets it paid, frozen with their amounts) and its `payment_tenders`
    rows. The lines are validated **before** the ordinary gesture runs (same endpoint, same guards:
    `paymentMarkRefusal`, locked fiche, D20 end-of-stay after departure, etc.); the settlement is written
    right **after** it, on the buckets that gesture just paid. Should that write fail, the gesture is
    undone. The target is marked paid with the settlement's date.
11. The target's existing caisse-interne flag (`*PaidCash`, group `cash`, note `paidCash`) is set to 1
    **only when every line is internal and there is no shortfall left to collect**, so a split that is
    entirely in the caisse interne is indistinguishable from today's « Caisse interne ». Otherwise it is
    0 and the internal share lives in the tender rows.
12. An installment paid by a settlement gets `paidMethod = 'mixed'`; its lines live in `payment_tenders`.
13. Undoing the mark (any existing undo path, « Annuler l'encaissement », the SAS re-committed, the bank
    reconciliation's « Défaire », a group dissolved, a note cancelled) deletes every settlement of the
    target and their lines: the model's writes that can take a payment back re-check the settlements of
    the stay (`sync`), so no undo path has to know about them.
14. `reservation_history` records each settlement in one entry:
    « Fin de séjour payée le 08/11/2026 : Espèces 50,00 € (caisse interne) · CB 72,00 € ».

### 3.5 Amount not received (D6)

15. When the lines are lower than the amount due, an inline warning appears under the meter, before
    submitting: « 8,00 € ne sont pas couverts. » with two choices, one of which must be picked before
    « Encaisser 114,00 € » is enabled:
    - **« Reste à percevoir »** — « La fiche garde 8,00 € à encaisser plus tard. »
    - **« Geste commercial »** — « 8,00 € accordés, enregistrés en réduction. »
    Correcting the amounts so that they cover the total removes the warning and the choice.
16. **Reste à percevoir.** The target is marked paid (rule 10) and the settlement keeps
    `shortfallCents` with `shortfallKind = 'due'`. The target is **not settled**: `remainingToPay`
    includes the shortfall, `isSettled` is false while any shortfall is due, the fiche row reads
    « Perçu en partie » with a line « Reste à percevoir 8,00 € » and its own « Marquer payé ».
    *Reading of 2026-11-09 (audit R34-C-L3):* the « Résumé tarifaire » says it too: the acompte, solde or complement
    badge reads the ledger row's state (« Perçu en partie ») while its split payment has a reste, never « … payé ». The
    operational lists keep their « Acompte / Solde payé » chips beside the server's « Reste X » chip, which says it.
17. Collecting the remainder opens the same lines (one line proposed, `cash` with the remainder) and
    records a **second settlement** on the same target, at its own date (its own accounting month). Its
    amount due is the remaining shortfall; it can itself leave a shortfall (rule 15). When the
    shortfall due reaches 0, the target is settled.
18. **Geste commercial.** The settlement keeps `shortfallCents` with `shortfallKind = 'waived'`; the target
    is settled. The waived amount is a **« Réduction accordée »**, the same movement as the single arrival
    payment's réduction ([arrival-payment-detail-and-adjustment.md](arrival-payment-detail-and-adjustment.md)
    rules 10, 20, 24): `comptaCollected` and the turnover subtract it, and the books get a rabais entry
    (crédit client / débit `70900000` + TVA at the stay's rate) at the settlement date. Its share on the
    books is `waived × booksCents / receivedCents`; a settlement entirely in the caisse interne books no
    réduction. Tourist-tax reporting is untouched (rule 29). On a single arrival payment split over several
    methods, the geste commercial replaces the existing « Total encaissé » adjustment: `mode: 'adjust'`
    is refused there (« Ce paiement est réparti sur plusieurs moyens : modifiez-le plutôt. »).
19. The fiche shows the réduction under the settlement: « Geste commercial 8,00 € ».

### 3.6 Modifying a settlement (D5)

20. A paid row that has settlements shows **« Modifier »** next to « Annuler l'encaissement ». It reopens
    the lines prefilled with the recorded date, methods, amounts, caisse-interne switches and shortfall
    choice. « Enregistrer » replaces the settlement — date, lines, shortfall and its disposition — in one
    transaction; the meter, the warning and the choices behave as at entry.
21. When a target has several settlements (rule 17), each one is modified on its own; the amount due of
    a remainder settlement stays the shortfall it collects.
22. Modifying is refused wherever undoing would be refused (bank reconciliation already matched to the
    card line, closed-stay rules…), with the same message.
    *Amended 2026-11-09 (audit R34-EXT-1):* the undo itself was not refused; it is now (rule 43).
23. When the date moves to another month, the form warns as the ordinary form already does:
    « Le mois comptable change : 11/2026 → 12/2026. »
24. `reservation_history` records the correction as one entry, before → after:
    « Fin de séjour corrigée : Espèces 50,00 € (caisse interne) · CB 72,00 € → Espèces 40,00 € (caisse
    interne) · CB 82,00 € ».
25. Turning a « Reste à percevoir » into a « Geste commercial » (or back) is a modification like any
    other. Modifying the first settlement so that it covers the whole amount while a remainder
    settlement exists is refused: « Un reste a déjà été encaissé le 10/11 : modifiez-le d'abord. »

### 3.7 What the money counts for

The stay's row carries four aggregates refreshed on every settlement write (the installments' pattern):
`splitOffBooksAmount` (cash lines in the caisse on a payment otherwise on the books), `splitWaivedAmount`,
`splitWaivedCashAmount` (geste commercial on a payment entirely in the caisse) and `splitShortfallDue`.
The settlement rules of `utils/reservationSettlement.js` (`comptaCollected`, `cashCollected`,
`remainingToPay`, `isSettled`) and the turnover read them, so no reader keeps its own copy of the rule;
the readers that list payments one by one (accounting export, « Encaissé » table, bank reconciliation)
read the settlements themselves (`utils/paymentTenders.settlementFigures`).

26. **Books (accounting export, encaissements by month, VAT):** one encaissement per settlement, at its
    date, of its books share of what it covers: `booksCents + booked réduction` — gross of the réduction,
    exactly like the single arrival payment, whose réduction entry (rule 18) then brings the client
    account back to the money received. When that share is lower than what the settlement covers, each
    revenue line of the target (accommodation, options, tourist tax, as already allocated by
    `complementPaidSplit` / `paidSplit`) is prorated; the last line absorbs the rounding cent.
    `booksCents = 0` → no entry (today's caisse interne).
27. **Finance figures:** `comptaCollected` and « Déjà payé » count `booksCents` (the encaissement minus
    its réduction: the money received on the books);
    `cashCollected` counts `internalCents`; `remainingToPay` counts `shortfallDueCents`; `isSettled`
    follows rule 16. `totalSejour` (turnover declared) excludes `internalCents` and the réduction.
28. **Bank reconciliation (`expectedReceipts`):** the expected bank receipt of a settlement is the sum of
    its `card`, `cheque` and `transfer` lines. `cash` (books or internal), `holidayVoucher` and `other`
    lines are not expected at the bank.
29. **Tourist tax reporting is unchanged**: it is computed from the stay, never from how it was paid.
    > **Sans test** — a non-change: the tourist-tax readers never read a payment, so nothing of this feature reaches
    > them; their own suites (`tourist-tax-*`) stay green untouched.

### 3.8 Display

30. A paid ledger row with settlements shows, under its state label, one muted line per tender in entry
    order (« Espèces 50,00 € · caisse interne », « CB 72,00 € »), then « Geste commercial 8,00 € » when
    there is one. A reste still due is not repeated in the lines: it is the « Reste à percevoir 8,00 € »
    block of rule 16, with its « Marquer payé » (browser check of 2026-11-09). Its state reads « Perçu le
    08/11 · plusieurs moyens », or « Perçu en partie » while a reste is due; the lines sit under « Moyens de
    paiement » so the date is not said twice. A remainder settlement is listed under the first, headed
    « Reste perçu le 10/11 ». Rows without settlements are unchanged.
31. The SAS recap and the mid-stay note history show the same lines.

### 3.9 Access (D1)

32. The split is **never shown by default**. Its only entry at payment time is a low-emphasis text button
    « Plusieurs moyens » placed after « Annuler » in each manual payment form listed in rule 1. It
    appears only once the operator has already started marking (the form is open, or the SAS payment
    step is on screen), so a fiche at rest shows nothing new. « Modifier » (rule 20) and the remainder's
    « Marquer payé » (rule 16) only exist on rows that already have a settlement.
    *Reading of 2026-11-09 (audits R34-C-M1, R34-C-L1):* every opening of the SAS dialog (mounted for the whole page)
    starts with one method, arrival and departure; the departure lines only count while the recap has something to
    collect. On the fiche, a correction or a reste form left open on a settlement the row no longer has (undone, then
    recorded again) is closed, so the new settlement keeps its « Modifier » and its reste its « Marquer payé ».
33. Opening it replaces the form's single choice (caisse interne switch, method select, or the mode
    buttons) by the tender lines, in place — no dialog. « Un seul moyen » closes them and restores the
    ordinary form with the date kept.

### 3.10 Guards (review of 2026-11-09)

34. « Plusieurs moyens » is offered only where the server accepts it: on a platform sale
    (`saleChannel().platformSale`) the acompte and the solde rows carry no `action.split` (rule 2).
35. A mid-stay note paid with several methods is not edited in place (`adjustMidStayNote`: total, means,
    date): the PATCH answers 409 « Ce paiement est réparti sur plusieurs moyens : modifiez-le plutôt. », as
    `mode: 'adjust'` does on the single arrival payment (rule 18). It is corrected through its settlement.
36. The installment schedule labels an installment paid with several methods « Payée le … · plusieurs
    moyens » (rule 12), and a split recorded on an installment paid in the meantime by another path is
    refused (409 `ALREADY_PAID`).
37. Collecting a reste and correcting a settlement accept the same date as every payment mark
    (`validateCollectionDate`: a real calendar day, not in the future, not before today − 5 years).
38. The refund guard of an undo (reservation-refunds.md rule 52) drops only the settlements of the payment
    taken back: the other split payments of the stay keep their deduction from what stays collected.

### 3.11 An amount that moves after the payment (D7, Adrien, 2026-11-09)

39. A bucket paid with several methods may still change amount afterwards (a paid complement adjusted, a
    final price saved on a locked fiche). Its settlements stay as they were typed; every reader takes the
    target at what it is worth **now** (`paymentTenders.targetFigures` with `currentCentsOf`):
    - a **rise** is a reste à percevoir: added to `splitShortfallDue`, never booked, collected with the
      remainder's « Marquer payé » (rule 17) like any other reste;
    - a **fall** cancels the reste first, then the geste commercial; what is left of it was received beyond
      what is owed, and the money counted comes down by the same factor on the books and in the caisse, so
      `encaissé + reste à payer = total de séjour` keeps holding and the journal books what is still owed.
    A target entirely in the caisse that rises is owed without being booked. A paid installment and a split
    note cannot change amount (rule 35), so only the four buckets of the stay are read again.
40. A fall beyond the reste and the geste is said on the row, under its settlements: « Trop-perçu 22,00 € :
    le montant a baissé depuis l'encaissement ». Nothing is refunded automatically; the refund stays the
    operator's gesture.
41. The « Notes en séjour » row gathers every note: each note settled with several methods keeps its own
    « Note du … : Reste à percevoir … » block and its own « Marquer payé » (`split.remainders[]`).

### 3.12 Round-34 audit (2026-11-09)

42. **An amount lowered on a split payment is judged at its new amount (R34-DB-M1).** The refund guard of an undo or of
    a lowered complement ([reservation-refunds.md](reservation-refunds.md) rule 52, `utils/refundUntickGuard`) reads the
    split aggregates of the state the gesture writes (rule 39), never the stored ones of the old amount; and a stay
    with no book refund has nothing to protect: no refusal. A paid complement of 80 € (30 € caisse + 50 € CB) lowered to
    20 € on the fiche saves, read at 20 € (`splitOffBooksAmount` 7,50 €).
43. **Matched at the bank, a split payment is not taken back (R34-EXT-1).** Rule 22's premise made true: every gesture
    that would drop a settlement whose receipt `settlement-<id>` holds a bank line (« Annuler l'encaissement », the
    arrival undo, a group dissolved, a note cancelled, « Sans acompte », the SAS re-committed, the reconciliation's
    « Défaire » of another receipt) answers 409 `SETTLEMENT_RECONCILED` « Déjà rapproché avec la banque : défaites le
    rapprochement d'abord. », nothing written (`paymentSettlementService.takeBackReconciledRefusal`, beside the refund
    guard). And a split recorded over a target whose plain receipt (`deposit`, `balance`, `complement` /
    `checkoutComplement`, `endOfStayComplement`, `group`, `installment-N`) already holds a bank line is refused the
    same way (`prepare({ reservationId, target })`): the line would point at a receipt no longer expected. In both
    cases « Défaire » the reconciliation first, record the payment, confirm the credit again on its new receipt.
44. **The acompte and the installments are paid whole (R34-M-M1 / R34-S1, refusal first).** They are the money a
    cancellation keeps and requalifies ([payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) rule 55, D8). Paid with several methods, the acompte goes
    on the books whole or in the caisse interne whole, for its whole amount; an installment goes on the books whole (it
    has no caisse interne), for its whole amount. Refused 400 `field: 'tenders'`: « Acompte : tout en compta ou tout en
    caisse interne. », « Acompte : le montant entier, sans reste ni geste. », « Échéance : pas de caisse interne. »,
    « Échéance : le montant entier, sans reste ni geste. ». Judged on every write of such a settlement: the PATCH, the
    single arrival payment (fiche and SAS) that carries the acompte, the installment, the correction (rule 20). The
    form says it before submitting: `action.split.whole` on the acompte row, `whole` + `noCaisse` on an installment,
    `edit.whole` on their correction make `TenderLines` start a cash line on the books, offer no shortfall choice (« Le
    montant entier, sans reste ni geste. ») and, on an installment, show no « Caisse interne » switch; the single
    arrival payment carrying the acompte shows the server's refusal. Amends rule 1 and D2 for these two targets; the
    desk cases the feature was written for (complement, end of stay, solde, notes) are unchanged. **Adrien's decision of
    2026-11-09 (D26 « Garder la restriction »):** this restriction stands as written — the split acompte all on the books
    or all in the caisse with no reste or geste, no caisse interne on an installment split, and the single arrival
    payment carrying the acompte refused when it mixes caisse cash with CB; the root-fix alternative (the cancellation
    reading `targetFigures`) is not taken.
45. **Reception records a check-out with one method (R34-A1).** The SAS payload says `canSplitPayment: false` to a
    reception-only user and the departure step shows no « Plusieurs moyens »; a crafted `complementsTenders` still
    answers 403 with « Plusieurs moyens : réservé à l'administrateur. », nothing recorded (never dropped silently: the
    lines carry the caisse-interne share). The arrival side was already closed (`toReceptionSasCommit`).
46. **A split bucket counts its share on each side of the refund register (R34-M-M1).** `refunds.collectedByLine`
    scales a bucket paid with several methods, partly on the books, by its share (`paymentTenders.bucketSharesOf`, read
    at the bucket's current amount): the book reading holds its lines on the books, the caisse-interne reading its
    caisse lines. A solde paid partly in the caisse interne, the stay cancelled: the register offers its caisse share
    back in the caisse interne only, the books their own share.
47. **A paid bucket keeps what it RECEIVED (R34-M-H1).** A split that left a « Reste à percevoir » or a « Geste
    commercial » received less than its amount. The engine keeps a paid acompte, solde or arrival complement at what it
    received (`utils/splitReceived`, reservation-refunds rule 36 read for a split payment): a cut of the stay lowers the
    bucket down to that before any trop-perçu is left, so rule 39 cancels the reste, then the geste, on its new amount.
    The trop-perçu readers (`utils/overpayment`: the save's 409 `OVERPAID`, the live and stored « Trop-perçu » rows, the
    lines by poste, `unclaimedRise`'s open trop-perçu) count such a bucket, a split end of stay and a split note at what
    they received. Solde 600 € paid 400 € + reste, then 20 % off: no trop-perçu, solde 480 €, reste 80 €; paid 580 € +
    geste 20 €, then 3 % off: geste 2 €; then 20 % off: trop-perçu 100 € (580 − 480), geste 0. Reading of 2026-11-09
    (R34 verification NEW-1): a settlement over several buckets is one pool, rule 50. A split end of stay counts its
    mid-stay lines (the only ones inside the price) at the share it received, never its departure lines.
48. **Every boot re-checks the split payments (R34-DB-L1).** `paymentSettlementsModel.syncAll()` runs at every boot
    before the server answers (beside the devis re-store): a settlement whose payment was taken back by a release that
    knew nothing of them (a rollback, then the roll-forward) is dropped and the aggregates refreshed. Accepted, recorded
    as a reading of [self-update-and-releases.md](self-update-and-releases.md) rule 39: during the rollback window
    itself the older release counts a split bucket whole (its caisse-interne share and its reste on the books).
49. **The VAT regime switch names the months of a split payment (R34-M-L1).** `vatRegimeSwitchModel.monthsOfPayments`
    adds each settlement's month when it has a line on the books (a reste collected later included): the preview's
    `exportMonths` lists every month the switch rewrites ([vat-optional-mode.md](vat-optional-mode.md) rule 17).

### 3.13 Round-34 verification (2026-11-09)

50. **One payment over several buckets received one sum (NEW-1, D25 « Une seule somme », Adrien, 2026-11-09).** The
    money a settlement received for several buckets (the single arrival payment, fiche and SAS; the SAS departure over
    the complement and the end of stay; the complement carrying the end of stay) is ONE pool. The engine may lower any
    paid bucket of the pool down to what the whole pool did not receive (`splitReceived.unreceivedOf`, at the amounts
    its buckets are worth now), the solde first, so a cut lowers the reste, then the geste, before any trop-perçu: never
    a false `OVERPAID`, never a refund prompt for money never received. Every trop-perçu reader (`collectedOnSchedule`,
    `storedOverpaymentOf`, `receivedByPoste`) counts the pool once: `readSplitReceived` attributes it at the buckets'
    current amounts, the end of stay, the complement and the acompte full first and the solde the rest. Solde 604,80 €
    + complement 80 € paid 634,80 € + reste 50 €, then 5 % off: reste 50 − 30 = 20 €, no trop-perçu; the 80 € line
    removed instead: trop-perçu 30 € (634,80 − 604,80), reste 0. The reste or geste is never refused on such a split.
51. **A payment over several buckets is taken back whole (NEW-2).** Un-ticking ONE bucket of a settlement that paid
    several (one row of the single arrival payment, the end of stay alone of the merged complement + end of stay, a
    caller taking one flag back: the SAS re-commit, the reconciliation's « Défaire ») answers 409
    `SPLIT_TAKEN_BACK_IN_PART` « Paiement en plusieurs moyens : annulez le paiement unique en entier. », nothing written:
    dropping the settlement would leave the other bucket paid in full on the books (its caisse-interne share turned into
    revenue) or forget the reste. The group's « Annuler » (`mode: 'undo'`) and the merged card's « Annuler » take the
    whole payment back; a split over one bucket is un-ticked alone, as rule 13 says
    (`paymentSettlementService.takeBackReconciledRefusal`, beside rule 43).
52. **A geste comes off the accommodation (NEW-3).** The export books a split payment's lines gross and its geste on
    70900000 (rule 18). The refund register reads it the same way: `bucketSharesOf` gives each side its share gross of
    its geste (`books`, `internal`) and the geste apart (`waivedBooks`, `waivedInternal`, on the target's first bucket),
    and `collectedByLine` takes the geste off the accommodation alone: the tourist tax and the extras keep their whole
    share. A cancelled stay refunded in full leaves no tourist tax owed (and, since rule 56, no 706 / 709 pair either);
    a live stay's accommodation answers for what it collected net of the geste (D15).
53. **A bucket paid with several methods has no caisse switch (found with NEW-2).** Its lines say where its money is
    (rule 11): a PATCH switching `complementPaidCash` / `endOfStayComplementPaidCash` on a bucket a kept settlement
    paid (the bucket alone or one row of the single arrival payment) answers 409 `SPLIT_CAISSE_SWITCH` « Paiement en
    plusieurs moyens : passer par « Modifier ». », nothing written; « Modifier » (rule 20) moves the money. Without it the
    complement's card money went to the caisse while its caisse lines stayed deducted from the books. A bucket paid
    with one method keeps its switch.

### 3.14 Round-35 leftovers (2026-11-09, verification R34b)

54. **A geste the accommodation cannot hold comes off the other lines (R34b-2).** Rule 52 takes the geste off the
    accommodation; when the target paid little or no accommodation (a complement paid before the solde), the rest of the
    geste comes off the extras the reading holds, pro rata, then the tourist tax, so no line answers for more than it
    collected. A complement alone (a forced line of 80 €) paid 50 € by card with a geste of 30 €: the live register
    offers 50 € on that line (30 € on the books when 20 € went to the caisse interne), never 80 €. The stay-level cap
    (rule 50 of reservation-refunds) already refused the refund; the screen now says the same.
55. **A split reading adds up to the money received, to the cent (R34b-3).** A bucket's shares are not whole cents:
    `collectedByLine` sums a split reading exact and rounds it once, largest remainder first, so its lines add up to the
    money the books (or the caisse interne) received; `bucketSharesOf`'s two gestes (`waivedBooks`, `waivedInternal`)
    add up to the geste left. A pool of 634,80 € (200 € in the caisse interne, 50 € short) cancelled: the register holds
    634,80 € and its caisse lines 200,00 €, not 634,79 € and 199,99 €. The books after a full refund: rule 56.
56. **The refund that gives back the last book money closes every account (R35 leftovers, R34b-3).** The export books
    a split payment settlement by settlement, each entry rounded on its own (`scaleEntry`, rule 26), and a refund line by
    line from the register (rule 55): the two can put a cent on different lines (tourist tax 46710000 +0,01 € against a
    prestation 70600010 −0,01 €), and the geste's rabais (70900000) stayed against a 70600000 the refund debited net. On
    a stay with a split payment, the refund whose sale share equals what is still on the stay's sale accounts — the
    revenue 706 / 706010 / activities, the rabais 709, the VAT collected 4457 and the tourist tax 4671, every encaissement
    up to its date less the earlier refunds — debits what is left on each of them instead of its lines (a rabais left
    is credited back). Every one of those accounts of the stay ends at exactly 0, as the registry's « every 706 / 4457 /
    4671 account nets to exactly 0 after a cancellation and full give-back » says; nothing is accepted within a cent.
    The cancellation's avoir (method `retained`) is read the same way when it is the one that empties the books. A
    partial refund keeps its lines; the refund that empties the stay's sale accounts closes them, on a live stay as on a
    cancelled one (wording corrected 2026-11-09, verification R35b finding 3: it said a live stay's refunds keep their
    lines, which the code never did). A stay paid with one method closes the same way from rule 58's cutoff on. Its
    encaissements are read up to the refund's own date (a payment dated after it is not), which is why a book refund is
    never dated before the stay's last book payment (reservation-refunds rule 53). Its indemnity share (7588) and that share's VAT are not sale legs: they keep their own debit. A sale line of
    the register can never be negative: the engine drops a custom line at 0 € or below, an end-of-stay line below 0 is
    read by no line, and a complement's split names only lines above 0, so `settleSplitCents`'s floor at 0 only absorbs
    floating-point noise and never lifts the lines above the money received (`mixed-method-payments-pool-geste-cents`).
57. **A cancellation reads a split solde at its book share (verification R35b, finding 1).** The book refunds made
    before a cancellation are absorbed by the paid solde first (payment-schedule-and-cancellation rule 55), and only the
    money the solde put on the books can absorb them: `cancelReservation`'s `saleBooksOf` reads the solde per bucket at
    `bucketSharesOf(...).balance.books`, less its geste on the books (`waivedBooks`: the accommodation, then the extras pro
    rata, the tax last, as rule 54), summed exact and rounded once (rule 55), the reading `collectedByLine` already gives
    the register. The commission spread of the solde (`soldeBuckets`) reads the same share. A solde in the caisse interne
    whole still absorbs nothing (audit R15-L1). *Why:* acompte by card, solde 70,01 € in the caisse interne + card + a
    geste of 13,33 €, everything on the books given back live, then « Annuler »: the solde was read gross, so it absorbed
    83,34 € it never booked and the acompte « kept » them — 7588 −83,34 €, 706 / 706010 / 4457 / 4671 left open, and the
    register offered 3,03 € of the 70,01 € collected in the caisse. Now nothing is retained, the books are empty and the
    caisse lines offer the 70,01 € (`mixed-method-payments-refund-then-cancel`).
58. **A stay paid with one method closes its books too, from the month after the install (verification R35b, finding
    2).** The entries of a one-method stay and its refunds round their cents apart as a split's do (a cent on 4457
    against 706). Rule 56's closing applies to every stay's refund dated on or after `stayClosingFrom`: the first day of
    the month after the accounting-export version bringing it was installed, stored once by the plugin's migration
    `stay_closing_from_v1` exactly like `ttcSplitFrom` (accountant-accounting-export rules 33, 35); an erased store reads
    the first month no earlier release could have exported (2026-12-01). A refund dated before it keeps its lines, so a
    month the accountant may already hold keeps its cents. A split stay closes whatever the date (rule 56). Pinned by
    `mixed-method-payments-closing-edges` and the fuzz of the verification (40 stays per order, 0 left a cent).

**Edge cases:**
- All lines `cash` + internal, no shortfall → same storage as « Caisse interne » + settlement (rule 11).
- A single line equal to the amount due → accepted; it records the method (« Chèque 122,00 € »).
- Amount due changes between opening and submitting (another tab) → the server refuses on
  `expectedAmountCents` exactly as today; the form shows the new amount and keeps the lines.
- Amount due changes after the payment, a reste or not → rules 39-40.
- 0,01 € residue after typing `61,005` → amounts are rounded to the cent on input; the meter shows the
  real remainder.
- Platform reservation complement paid at the desk (`isDirectChannel` false) → allowed: it is a desk
  payment, not the platform payout.
- The single arrival payment of the SAS is split only as the unified payment (one amount asked), never
  with an installment plan (the plan's installments are each recorded with their own method).
- A SAS commit that settles another total than its recap showed re-checks the lines on what it really
  settled; when they no longer fit, the ordinary payment stands and the answer says
  « Paiement enregistré sans le détail des moyens : le total a changé. Le corriger depuis la fiche. »

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` / `schema.sql` | both | T | `payment_settlements` + `payment_tenders` tables + indexes (§5) |
| `utils/` | `paymentTenders.js` | C | Method list + labels; `validateSettlement` (rules 4-9, 15); `settlementFigures` / `targetFigures` / `reservationAggregates` (rules 16-18, 26-28); history wording (rules 14, 24). Pure, unit-tested |
| `utils/` | `paymentSettlementsMigration.js` | C | The two tables and the four `reservations` aggregates, idempotent |
| `utils/` | `paymentSettlementService.js` | C | The one writer: `prepare` (before the gesture), `flippedParts` + `record` (after it), caisse-interne flag (rule 11), `collectRemainder` (rule 17), `modify` (rules 20-25), history |
| `models/` | `paymentSettlementsModel.js` | C | Settlements and their lines; `sync(reservationId)` drops the settlements whose target is no longer paid and refreshes the aggregates |
| `controllers/` | `paymentSettlementsController.js` | C | Thin HTTP for the remainder and the modification |
| `models/` | `reservationsModel.js`, `installmentsModel.js` | T | Every write that can take a payment back calls `sync` |
| `utils/` | `refundUntickGuard.js` | T | A payment taken back no longer subtracts its settlement's caisse share; the aggregates of the written state, no refusal without a book refund (rule 42) |
| `plugins/sdk/` | `index.js`, `coreModules.json`, `coreModuleHistory.json`, `version.js` | T | SDK 2.24.0: `paymentTenders`, `paymentSettlementsModel`, `paymentSettlementService` ([plugins-phase-1-sdk.md](plugins-phase-1-sdk.md) rule 42); `accounting-export` 1.1.0, `online-payment` 1.6.0, `sas` 1.8.0 ask for `^2.24.0` |
| `routes/` | `reservations.js` | T | Two routes for the controller above (§4.3) |
| `controllers/` | `reservationsController.js` | T | `updatePayment`, `settleArrivalPayment`: accept optional `tenders` + `shortfall`, write the mark and the settlement atomically; undo deletes settlements |
| `controllers/` | `installmentsController.js` | T | Installment payment accepts `tenders`, writes `paidMethod = 'mixed'` |
| `models/` | `reservationsModel.js` | T | Mid-stay note settle/undo carry `tenders`; settlements deleted with the note |
| `plugins/sas/` | `controller.js` | T | Arrival `arrivalPaymentMode: 'split'` + departure `complementsTenders`; same validation |
| `utils/` | `reservationLedger.js` | T | `action.split: { dueCents, methods }` on markable rows; paid rows carry `settlements[]` with lines, shortfall and `canModify` / `modifyRefusal` |
| `utils/` | `reservationSettlement.js` | T | `comptaCollected`, `cashCollected`, `remainingToPay`, `isSettled` read the aggregates |
| `models/` | `financeModel.js`, `financeDashboardModel.js` | T | Turnover through the aggregates; the « Encaissé » table lists one row per settlement |
| `plugins/accounting-export/` | `accountingModel.js`, `accountingExport.js` | T | Encaissement = `booksCents` per settlement, prorated lines (rule 26); réduction entry reusing `discountEntryToRows` (rule 18) |
| `plugins/online-payment/reconciliation/` | `expectedReceipts.js` | T | Expected receipt = card + cheque + transfer lines per settlement (ledger key `settlement-<id>`), the bucket it paid not expected again (rule 28) |
| `utils/` | `paymentSettlementService.js` | T | _(round 34)_ `prepare({ reservationId, target })` judges rules 43-44; `takeBackReconciledRefusal` (rule 43) |
| `models/` | `paymentSettlementsModel.js` | T | _(round 34)_ `droppedBy(row)` (rule 43), `syncAll()` (rule 48) |
| `utils/` | `splitReceived.js` | C | _(round 34)_ What each split bucket, end of stay and note received, read by the engine and the trop-perçu (rule 47) |
| `utils/` | `pricing.js`, `overpayment.js` | T | _(round 34)_ A paid split bucket kept at what it received; the trop-perçu counts it so (rule 47) |
| `utils/` | `paymentTenders.js`, `refunds.js` | T | _(round 34)_ `bucketSharesOf`; the register's lines read a split bucket's share on each side (rule 46) |
| `controllers/` | `reservationsController.js`, `installmentsController.js`, `refundsController.js` | T | _(round 34)_ Rules 43-44 on the split writes and the undos; `received` to the trop-perçu readers; split shares to the register |
| `utils/` | `reservationPaymentMark.js` | T | _(round 34)_ `takeBackRefusal` adds rule 43 (SAS re-commit, reconciliation « Défaire ») |
| `utils/` | `reservationLedger.js` | T | _(round 34)_ `action.split.whole` on the acompte, `edit.whole` / `noCaisse` on corrections (rule 44) |
| `plugins/sas/` | `controller.js` | T | _(round 34)_ Rules 43-44 on both SAS splits; `canSplitPayment` and the French 403 (rule 45) |
| `models/` | `vatRegimeSwitchModel.js` | T | _(round 34)_ Settlement months in `monthsOfPayments` (rule 49) |
| — | `index.js` | T | _(round 34)_ `syncAll()` at every boot (rule 48) |
| `utils/` | `splitReceived.js`, `pricing.js` | T | _(round 34b)_ `pools` + `unreceivedOf`: a settlement over several buckets is one pool, the engine's cut capacity is the pool's (rule 50) |
| `utils/` | `paymentSettlementService.js` | T | _(round 34b)_ `takeBackReconciledRefusal` also refuses a partial take-back (rule 51) and a caisse switch on a split bucket (rule 53) |
| `utils/` | `paymentTenders.js`, `refunds.js` | T | _(round 34b)_ `bucketSharesOf` gross of the geste + `waivedBooks` / `waivedInternal`; `collectedByLine` takes the geste off the accommodation (rule 52) |
| `controllers/` | `reservationsController.js` | T | _(round 34b)_ A split end of stay counts its mid-stay lines at the share it received (rule 47 reading) |
| `utils/` | `refunds.js`, `paymentTenders.js` | T | _(round 35)_ A geste the accommodation cannot hold comes off the extras then the tax (rule 54); a split reading summed exact and rounded once (rule 55) |
| `plugins/accounting-export/` | `accountingModel.js`, `accountingExport.js` | T | _(round 35b)_ `encaissementsIn` (one stay over any window), `refundEntryReader` + `addSaleLegs`: the refund emptying a split stay's sale accounts carries `closing`, `refundEntryToRows` debits (or credits) what is left on each (rule 56); 1.2.2 |
| `utils/` | `cancelReservation.js` | T | _(round 35c)_ `saleBooksOf`: the paid solde's book share absorbs the earlier refunds, never its caisse money or its geste (rule 57) |
| `plugins/accounting-export/` | `settings.js`, `index.js`, `accountingModel.js` | T | _(round 35c)_ `stayClosingFrom` (migration `stay_closing_from_v1`, `readStayClosingFrom`): one-method stays close from the month after the install (rule 58); 1.2.2 |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `TenderLines.jsx` | C | The tender lines + meter + shortfall warning and its two choices + « Ajouter un moyen », controlled; renders server labels |
| `components/reservation/` | `PaymentMarkForm.jsx` | T | « Plusieurs moyens » / « Un seul moyen » toggle; sends `tenders` + `shortfall` |
| `components/reservation/` | `FinanceSection.jsx` | T | « Encaisser en une fois » block gets the same toggle; paid rows render settlements, « Modifier », the remainder's « Marquer payé » |
| `components/reservation/` | `InstallmentPlanCard.jsx`, `MidStayNoteDialog.jsx` | T | Same toggle in their payment step |
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | « Plusieurs moyens » under `PaymentModeButtons` (arrival and departure); _(round 34)_ reset on every opening, departure lines only while settleable, hidden for reception (rules 32, 45) |
| `components/` | `TenderLines.jsx` | T | _(round 34)_ `whole` / `noCaisse` (rule 44); an untyped last line at 0 is no line (rule 7 reading) |
| `components/` | `PricingSummary.jsx`, `pages/ReservationPage.jsx` | T | _(round 34)_ `ledgerRows`: the paid badge reads « Perçu en partie » with a reste (rule 16 reading) |
| `components/reservation/` | `FinanceSection.jsx`, `PaymentMarkForm.jsx`, `InstallmentPlanCard.jsx` | T | _(round 34)_ a stale correction panel closed (rule 32 reading); `whole` / `noCaisse` passed on (rule 44) |

**Client-side computation, justified:** the running remainder and the decision to show the shortfall
warning (rules 7, 15) are a subtraction over the typed fields, shown as a UX hint so the operator sees
where they stand before submitting. They never decide anything: the server re-validates every line and
the disposition (rules 6, 15-18) and the persisted figures all come from the settlements and the stay's aggregates.

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `DateField`, `Switch`, `evaluateArithmetic` | |
| **Created (new generic)** | `TenderLines` | Used by 5 surfaces (fiche row, arrival block, installment, mid-stay note, SAS) and by the modification and remainder forms |
| **Specific** | — | |

### 4.3 API contract

The write paths below accept an optional `tenders` array and, when the lines are lower than the amount
due, a mandatory `shortfall`. When `tenders` is absent behaviour is unchanged.

```json
"tenders": [
  { "method": "cash", "amountCents": 5000, "internal": true },
  { "method": "card", "amountCents": 6400, "internal": false }
],
"shortfall": { "kind": "due" }
```

| Method | Endpoint | Change |
|---|---|---|
| PATCH | `/api/reservations/:id/payment` | `tenders` (+ `shortfall`) with `flag: true` (acompte, solde, complément, fin de séjour, mid-stay note settle) |
| POST | `/api/reservations/:id/arrival-payment` | `mode: 'split'` + `tenders` (+ `shortfall`) |
| POST | `/api/reservations/:id/installments/:installmentId/payment` | `tenders` instead of `method` (+ `shortfall`) |
| POST | SAS arrival / departure commit (`plugins/sas`) | `arrivalPaymentMode: 'split'` + `tenders`; `complementsTenders` (+ `shortfall`) |
| POST | `/api/reservations/:id/settlements` | **new** — collect a remainder: `{ target, date, tenders, shortfall? }` (rule 17) |
| PUT | `/api/reservations/:id/settlements/:settlementId` | **new** — modify: `{ date, tenders, shortfall? }` (rules 20-25) |
| GET | `/api/reservations/:id` (and the quote) | `ledger` rows (`ledgerFor` → `buildLedger`) gain `action.split`; a paid row gains `split { settlements[], remainders[], overpaid[], methods }` (rules 30, 40, 41) |

Refusals: `400 { error, field: 'tenders' | 'shortfall' | 'date' }`, French message naming the problem
(rules 6, 8, 15, 18, 25); `409` with the undo guard's message (rule 22). Same role guard as the existing
payment routes.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS payment_settlements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId  INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  targetKind     TEXT NOT NULL CHECK (targetKind IN ('bucket','arrivalGroup','midStayNote','installment')),
  targetKey      TEXT NOT NULL,          -- bucket name, note id, installment id; the group's payment date for the group
  paidDate       TEXT NOT NULL,          -- YYYY-MM-DD, its accounting month
  dueCents       INTEGER NOT NULL CHECK (dueCents > 0),
  shortfallCents INTEGER NOT NULL DEFAULT 0 CHECK (shortfallCents >= 0),
  shortfallKind  TEXT CHECK (shortfallKind IN ('due','waived')),
  createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt      TEXT,
  CHECK ((shortfallCents = 0) = (shortfallKind IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_payment_settlements_target ON payment_settlements(reservationId, targetKind, targetKey);

CREATE TABLE IF NOT EXISTS payment_tenders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  settlementId INTEGER NOT NULL REFERENCES payment_settlements(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,         -- entry order, for display
  method       TEXT NOT NULL CHECK (method IN ('card','cash','cheque','transfer','holidayVoucher','other')),
  amountCents  INTEGER NOT NULL CHECK (amountCents > 0),
  internal     INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1) AND (internal = 0 OR method = 'cash'))
);
CREATE INDEX IF NOT EXISTS idx_payment_tenders_settlement ON payment_tenders(settlementId);
```

- `targetKey` of the single arrival payment is the group's payment date (`arrivalPaymentGroup.at`, `YYYY-MM-DD`),
  re-keyed when the first settlement's date is corrected (`paymentSettlementService.moveTargetDate`). Corrected
  2026-11-09 (audit R34-DB-L2): the draft said `'arrival'`.
- `parts TEXT NOT NULL DEFAULT '[]'` on `payment_settlements`: the buckets the settlement paid,
  `[{ kind, key, amountCents }]`, frozen at the write (a complement that carried the end of stay, the
  buckets of a single arrival payment).
- `reservations` gains `splitOffBooksAmount`, `splitWaivedAmount`, `splitWaivedCashAmount`,
  `splitShortfallDue` (`REAL NOT NULL DEFAULT 0`, euros).
- Idempotent creation in `database.js` (`utils/paymentSettlementsMigration.js`); the tables are in
  `schema.sql` too. No backfill: existing payments have no settlement and their aggregates are 0.
- `reservation_installments.paidMethod` gains the value `'mixed'` (no CHECK on that column today).
- **Data impact:** additive only. No existing row changes.

## 6. UI / UX

See the summary page for the interactive mock (fiche row, SAS departure, modification, shortfall;
390 / 1280 px).

- **Fiche, ledger row** — « Marquer payé » opens `PaymentMarkForm` as today. After « Annuler », a text
  button « Plusieurs moyens » (text.secondary, no border). Clicked: the caisse-interne switch is
  replaced by the lines; the date stays on top; « Valider » becomes « Encaisser 122,00 € ».
- **A line** — method as a native select (6 entries, server labels), amount field (`inputMode=decimal`,
  16 px to avoid iOS zoom, tabular numerals), on a cash line a « Caisse interne » switch (on), a
  remove button (44×44) from the second line on. The auto line shows its amount in text.secondary with
  « reste » until typed in.
- **Meter** — one line, `aria-live="polite"`: « Reste 0,00 € » success colour; « 8,00 € non couverts »
  warning colour; « 8,00 € de trop » error colour, submit disabled.
- **Shortfall warning** — inline, warning-soft background, under the meter: « 8,00 € ne sont pas
  couverts. » then two selectable cards side by side (stacked on `xs`), each a 44 px+ target with a
  title and one line of explanation. The submit button reads « Encaisser 114,00 € » and stays disabled
  until one is picked.
- **Paid row** — « Perçu le 08/11 · plusieurs moyens » (or « Perçu en partie » with a warning badge when
  a remainder is due), one muted line per tender, then the shortfall line. Actions: « Modifier »
  (text button), « Annuler l'encaissement » (quiet), and for a remainder « Marquer payé » (outlined).
- **Modification** — the same form, prefilled, inline on the row; « Enregistrer » / « Annuler ».
- **SAS** — « Plusieurs moyens » is a text button under the mode buttons; the lines open below them,
  the commit button reads « Encaisser 122,00 € ».
- **Responsive** — `xs`: one line = method select full width, then the amount with the remove button,
  then the caisse-interne switch on its own row; the two shortfall cards stack; actions full-width.
  `md+`: one row per line (method · amount · switch · remove), shortfall cards side by side. The SAS
  dialog is already full-screen on `xs`.
- **Reduced motion** — the lines open with the form's existing `ledgerOpen` / `ledgerFade`.

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `tests/mixed-method-payments.unit.test.js` (17) — `validateSettlement` (over, under with and without a
      choice, 1 and 5 lines, duplicate method, caisse interne on a non-cash line, cents), settlement and target
      figures, stay aggregates, history wording (rules 4-9, 11, 14-18, 26-28).
- [x] `tests/mixed-method-payments-writes.unit.test.js` (17) — PATCH payment (fin de séjour, acompte, platform
      refusal, one at a time), the undo that takes the settlement, reste à percevoir then its collection,
      geste commercial, corrections (lines, shortfall, date, refusal 25), the single arrival payment split and
      undone, the refund guard on an undo, an impossible correction date (rules 1-2, 6, 10-25, 37-38).
- [x] `tests/mixed-method-payments-amount-change.unit.test.js` (6) — a rise is a reste then collected, a fall
      cancels the reste then the geste, a trop-perçu said on the row, a rise in the caisse, one reste per note
      (rules 39-41).
- [x] `tests/mixed-method-payments-targets.unit.test.js` (5) — an installment recorded as 'mixed' and labelled so,
      the geste commercial under its settlement, the lines of a note on the « Notes en séjour » row, no split on
      a platform sale's acompte, a split note not edited in place (rules 12, 19, 31, 34-36).
- [x] `tests/mixed-method-payments-finance.unit.test.js` (5) — `encaissé + reste à payer = total de séjour` on
      four shapes; the turnover (rule 27).
- [x] `plugins/accounting-export/tests/accounting-mixed-method-payments.unit.test.js` (7) — the books share,
      the rabais, a reste booked in its own month, all in the caisse books nothing, an amount raised or lowered
      after the payment (rules 18, 26, 39).
- [x] `plugins/online-payment/tests/reconciliation-mixed-method-payments.unit.test.js` (2) — only card, cheque
      and transfer expected, once (rule 28).
- [x] `plugins/sas/tests/sas-mixed-method-payments.unit.test.js` (5) — the check-out SAS (rules 1, 6, 10-11, 16).
- [x] Updated: `reservation-ledger-marks` (rule 21's `split` on the marks), `route-census` baselines for the two
      routes, `plugin-core-hardening-floor` (SDK 2.24.0), the VAT golden (the four aggregates, nothing else).
- [x] _(round 34, 2026-11-09)_ `tests/mixed-method-payments-complement-lowered.unit.test.js` (3) — rule 42.
- [x] _(round 34)_ `plugins/online-payment/tests/reconciliation-mixed-method-undo.unit.test.js` (5) — rules 22, 43.
- [x] _(round 34)_ `tests/mixed-method-payments-retained-money.unit.test.js` (9) — rules 44, 46.
- [x] _(round 34)_ `tests/mixed-method-payments-price-cut.unit.test.js` (8) — rule 47.
- [x] _(round 34)_ `tests/mixed-method-payments-boot-sync.unit.test.js` (2) — rule 48.
- [x] _(round 34)_ `tests/mixed-method-payments-vat-switch-months.unit.test.js` (2) — rule 49.
- [x] _(round 34)_ `plugins/sas/tests/sas-mixed-method-reception.unit.test.js` (2) — rule 45.
- [x] _(round 34)_ Updated for rule 44: `mixed-method-payments-targets` (the installment split CB + chèque),
      `mixed-method-payments-writes` (the single arrival payment without an acompte in it).
- [x] _(round 34b)_ `tests/mixed-method-payments-pooled-received.unit.test.js` (6) — rule 50.
- [x] _(round 34b)_ `tests/mixed-method-payments-partial-take-back.unit.test.js` (10) — rules 51, 53.
- [x] _(round 34b)_ `tests/mixed-method-payments-geste-accommodation.unit.test.js` (6) — rule 52.
- [x] _(round 34b)_ Added cases: `mixed-method-payments-complement-lowered` (now 5: a refund between the stale and the
      true « after », nothing refunded), `mixed-method-payments-price-cut` (now 8: lines by poste at what was received,
      a split end of stay and a split note in the stored trop-perçu, an end of stay with a departure line),
      `mixed-method-payments-retained-money` (now 9: the acompte row's `whole`).
- [x] _(round 35)_ `tests/mixed-method-payments-pool-geste-cents.unit.test.js` (9) — rules 52, 54, 55 (R34b-1, R34b-2,
      R34b-3): a pool of caisse 200 € + CB with a reste or a geste, cancelled: the register holds the money received to
      the cent, caisse lines 200,00 €; refunded in full, every account nets to zero (a reste: nothing left at all); the
      geste pool live after a cut: the lines answer for the book money; a card pool with a geste after a cut: the geste
      off the accommodation once, tax and extra whole (Q13); a complement alone with a geste 30 €, by card or caisse +
      card: the line offers what it collected (Y1); `bucketSharesOf`'s gestes add up after a cut. Kills the
      verification's mutants N9 (geste on every bucket of the pool) and N12 (the caisse reading its books geste).
- [x] _(round 35b)_ `tests/mixed-method-payments-pool-geste-cents.unit.test.js` (now 11) — the pool refunded in full
      nets every account to exactly 0, 4671 / 706 / 706010 / 709 included (rule 56); a pool paid 3 € by card with the
      rest a geste leaves the tax line at 3,00 € and the accommodation and the extra at 0 (rule 54's last step; kills
      the verification's mutants X2, tax step removed, and X3, tax before the extras); a −20 € custom line never reaches
      the register (rule 56's last sentence).
- [x] _(round 35b)_ `tests/mixed-method-payments-closing-refund.unit.test.js` (4) — rule 56: acompte kept + split solde
      with caisse and geste + extras, cancelled and given back in full: every account at 0, one closing refund crediting
      709 back; a partial refund keeps its lines and the next one closes; a live stay's partial refund closes nothing; a
      one-method stay keeps its lines before rule 58's cutoff (that last case reworded in round 35c).
- [x] _(round 35c)_ `tests/mixed-method-payments-refund-then-cancel.unit.test.js` (6) — rule 57: acompte + split solde
      (caisse share, geste, both, extras on both sides) refunded live in full then cancelled: no retained avoir, books
      empty, the caisse lines still offer the caisse money; a partial refund keeps the acompte whole; a one-method solde
      unchanged.
- [x] _(round 35c)_ `tests/mixed-method-payments-closing-edges.unit.test.js` (8) — rules 56, 58: a live split stay
      refunded in full closes; acompte kept + split complement with a 20 % indemnity closes at 0 (kills Me); negative
      4457 / 4671 closing legs in the credit column (kills Mf, Mg); a solde paid after the refund is not in its closing
      (kills Mc); one-method stays close from the cutoff, keep their cent before it; a split stay closes whatever the
      cutoff; the migration stores the cutoff once.

### Client (Vitest)
- [x] `components/__tests__/TenderLines.remainder.test.jsx` (6), `TenderLines.shortfall.test.jsx` (4).
- [x] `components/reservation/__tests__/FinanceSection.mixed-method-payments.test.jsx` (6).
- [x] `plugins/sas/__tests__/ReservationSasDialog.mixed-method-payments.test.jsx` (3).
- [x] _(round 34)_ `components/__tests__/TenderLines.whole-and-blank-line.test.jsx` (4) — rules 7, 44.
- [x] _(round 34)_ `components/reservation/__tests__/FinanceSection.split-panel-stale.test.jsx` (1) — rule 32 reading.
- [x] _(round 34)_ `plugins/sas/__tests__/ReservationSasDialog.split-reopen.test.jsx` (3) — rules 32, 45.
- [x] _(round 34)_ `components/__tests__/PricingSummary.split-reste-badge.test.jsx` (2) — rule 16 reading.
- [x] _(round 34b)_ `components/reservation/__tests__/FinanceSection.split-whole.test.jsx` (2) — rule 44 (the mark form
      passes `whole`); `InstallmentPlanCard.test.jsx` gains one case — rule 44 (`whole` + `noCaisse` on an installment).

### Manual UI verification (2026-11-09, isolated server + client, Chromium 1280 and 390 px)
- [x] Fiche: fin de séjour 122 € → « Plusieurs moyens », 50 € espèces, CB auto-filled to 72,00 €.
- [x] 50 € + 64 € → « 8,00 € non couverts », the two choices, « Encaisser 114,00 € » enabled only once chosen;
      row « Perçu en partie », « Reste à percevoir 8,00 € » block; reste collected in cash.
- [x] « Modifier » the first payment to cover all while a reste was collected → refused with the rule 25
      message, the form kept open.
- [x] SAS de départ at 390 px: ménage 122 € → 50 € espèces + 72 € CB, « Encaisser 122,00 € », stored as one
      settlement with its two lines; no horizontal scroll on the fiche at 390 px.

## 8. Out of scope

- A configurable method list, accounting journals per method (D4).
- Cash register, till closing, bank deposit slips (HIPPOCAMP's caisse module).
- Splitting a payment-link or platform payment.
- Sending a payment link for a « Reste à percevoir ».
- Modifying an ordinary (non-split) payment: undo and redo, as today.
- A pourboire when the lines exceed the amount due (refused, rule 6).
- « Encaissements par moyen de paiement » in the accounting synthesis broken down by the new methods
  (the data will exist; the panel is a follow-up).
- **Accepted (audit R34-CON-L1, 2026-11-09):** a plugin rollback ([plugins-phase-4-registry.md](plugins-phase-4-registry.md)
  rule 16, « Revenir à la version précédente ») below accounting-export 1.1.0 or online-payment 1.6.0 exports and
  reconciles split payments as whole payments (the caisse-interne share booked as revenue, a reste as collected, no
  rabais for a geste, the cash share expected at the bank) for as long as the rollback stands. Nothing stored changes;
  rolling forward restores the right export. No code.

## 9. Open questions

- Resolved 2026-11-09 (Adrien, D25 « Une seule somme »): a settlement over several buckets is one pool; the reste or
  geste on it is kept, never refused (rule 50).
- Resolved 2026-11-09 (Adrien, D26 « Garder la restriction »): rule 44 stands (recorded under rule 44).

- Q1: Should « Caisse interne » also be possible on a cheque line (cheque cashed outside the business
  account)? Proposed: no, cash only.
- Q2: Chèques-vacances: should they be expected at the bank (ANCV reimburses later, net of
  commission)? Proposed: not expected, like cash.
