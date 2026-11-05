# Remboursements — return money to a guest without touching the sale

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-refunds` |
| **Created** | 2026-08-10 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A guest left the gîte before the end of the stay. The unstayed **night is still billed** (no-show /
early-departure policy), but the **breakfasts that were never served must be given back**. The money
flow is: the guest pays the **full** stay (acompte + solde already collected), then the owner sends a
**bank transfer** back for the breakfasts.

GuestFlow has no way to represent that today. Every euro that exists on a reservation is an
**encaissement** — one of five buckets, all of them *incoming*:

| Bucket | Column(s) | Journal entry kind |
|---|---|---|
| Acompte | `depositAmount` / `depositPaid` / `depositPaidDate` | `deposit` |
| Solde | `balanceAmount` / `balancePaid` / `balancePaidDate` | `balance` |
| Complément d'arrivée | `complementAmount` / … | `complement` |
| Complément de fin de séjour | `endOfStayComplementAmount` / … | `endOfStayComplement` |
| Notes en séjour | `midStaySettledNotes` (register) | `midStayComplement` |

`accountingModel.encaissementsByMonth()` walks exactly those buckets and
`utils/accountingExport.js` turns each into one debit on the client auxiliary account + N credits
(70xxx revenue, 44571xx VAT, 46710000 tourist-tax pass-through). There is **no negative movement
anywhere in the chain**, and no `refund` concept in the DB.

The two workarounds available today are both wrong:

- **Shrink the billed line** (6 breakfasts → 4): `finalPrice` drops below what was already collected,
  so the reservation reads « trop-perçu » everywhere (`remainingToPay` goes negative, the collection
  alert and the operational payments table lie), it fights
  [reservation-option-immutability.md](reservation-option-immutability.md), and the accounting keeps
  the original full-price entries — the CA is never actually corrected.
- **A negative custom option**: same `finalPrice` corruption, plus it silently rewrites a sale that
  was genuinely made at that price on that date.

What is missing is the accountant's own primitive: an **avoir** — a separate, dated event that
reverses part of a sale without rewriting it.

## 2. Goal

From the reservation fiche, the operator records a **remboursement**: which prestations are being
given back, for how much, on which date, by which means. The sale and every collected échéance stay
exactly as they were; the refunded amount is deducted from the « total de séjour » and from the CA,
and the monthly accounting export carries a **reversed journal entry (avoir)** dated at the refund.

## 3. Functional rules

### 3.1 The refund register

1. A **remboursement** is money returned to the guest **after** the sale. It never mutates the sale:
   `finalPrice`, the option/custom/resource lines, `touristTaxTotal`, the échéance amounts
   (`depositAmount` / `balanceAmount` / `complementAmount` / `endOfStayComplementAmount`), the paid
   flags and their payment dates are all left untouched.
2. Refunds live in their own tables (§5), one **header** (date, means, total, reason) + N **lines**
   (what is being given back). A reservation carries 0..N refunds.
3. The header's `refundDate` is the **real money-out date** — the date the transfer/cash actually
   left. It drives the accounting month exactly like a `*PaidDate` drives an encaissement's.
4. Three means (`method`): **`transfer`** (virement — the default), **`cash`** (espèces), and
   **`internal`** (caisse interne). `transfer` and `cash` are *book money*; `internal` is **off the
   books**, following the exact convention the cash complements already use
   ([cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md),
   [mid-stay-notes.md](mid-stay-notes.md) rule 15).
5. `totalTtc` is **server-computed** as Σ line amounts — a client-sent total is never trusted
   ([mid-stay-notes.md](mid-stay-notes.md) rule 7, same philosophy).
6. A refund is **immutable** once created. A correction is a **delete + recreate**, mirroring the
   note-cancel design. Deleting is always allowed (no month lock exists in the app today).
   > **Reading of 2026-11-02 (audit R15-C1 and its aside).** « Always » has three exceptions, decided on the server
   > (`utils/refunds.refundDeletionRefusal`, read by the DELETE route and by the ledger alike), each a 409:
   > - the **`retained` avoir** a cancellation wrote is the cancellation itself, never a refund:
   >   `REFUND_RETAINED_AVOIR` « L'indemnité d'annulation ne se supprime pas. » (worded for every avoir — acompte,
   >   échéances or commission kept — since the review of PR #929). *Why:* deleting it through the API left the
   >   indemnity booked while the 706 reversal was gone — the same money booked as revenue and as indemnity;
   > - on a cancelled stay, a book refund the avoir was netted of: `REFUND_NETTED_BY_CANCELLATION`
   >   (payment-schedule-and-cancellation rule 55, second reading of PR #926);
   > - on a cancelled stay, any other **book** refund made before a cancellation that had book money to keep (the
   >   cancellation read it, and kept nothing because of it, then writing no avoir): `REFUND_BEFORE_CANCELLATION`
   >   « Remboursement antérieur à l'annulation. ». « Made after » is `utils/refunds.madeAfterCancellation`: a
   >   higher id than the avoir, or, with no avoir, the refund's own `afterCancellation` (below), or — for a refund
   >   recorded before that column existed — a `createdAt` later than the stay's `cancelledAt`.
   >
   > A refund made **after** the cancellation — book or caisse interne — is deleted like any other, and its money
   > goes back to the budget it was taken from (rule 48). The fiche of a cancelled stay offers « Supprimer » on
   > exactly the rows the server deletes, outside its disabled fieldset (specs/calendar-property-parity.md rule 25).
   > *Why:* since the ledger replaced the refunds block, a refund recorded on a cancelled stay had no « Supprimer »
   > at all: a 500 € typo for 50 € stayed in the journal and on the compensation card.
   >
   > **Reading of 2026-11-02 (review of PR #929, F2 and F5).** This reading amends the one above where it names it.
   > - **`REFUND_BEFORE_CANCELLATION` only when the cancellation had book money to keep**
   >   (`utils/refunds.cancellationHadBookMoney`): a paid acompte or paid installments, booked, or a commission
   >   withheld on a paid booked solde. A stay paid in full at booking with no commission — Solio's usual direct
   >   stay — had none: its cancellation read no refund, whatever was given back before it, so such a refund is
   >   deleted like one made after the cancellation, by the API and on the fiche. *Why:* stay #22306 (solde
   >   2 301,60 € paid, no acompte), 100 € refunded by transfer then cancelled: the refund could never be corrected
   >   (409), although deleting it only restores the sale money it took.
   > - **The order, not the clock.** `reservation_refunds.afterCancellation` records, when the refund is written,
   >   whether its stay was already cancelled (1, else 0; NULL on the rows written before). `createdAt` and
   >   `cancelledAt` know only the second: a refund recorded in the very second of the cancellation read as made
   >   before it.
   > - **A caisse-interne refund made before the cancellation** is offered « Supprimer » on the fiche too, as the API
   >   already deleted it: the cancellation never reads off-books refunds and the export never books them, so the
   >   deletion moves no journal line, it only gives the money back to the budget.
>
   > **Reading of 2026-11-02 (audit R16-L1, review of PR #930, F2).** This reading amends the two above where it
   > names it.
   > - **`REFUND_NETTED_BY_CANCELLATION` only for a refund that moved the avoir** — read as
   >   payment-schedule-and-cancellation rule 55 states it in its reading of 2026-11-02 (audit R16-L1): a book refund
   >   made before the `retained` avoir is refused only when the requalification rebuilt without it would keep
   >   another total, other lines outside the commission or another commission total
   >   (`cancelReservation.cancellationNettedRefundIds`, passed to `refundDeletionRefusal` by the DELETE route and the
   >   ledger). A refund the paid solde absorbed whole is deleted, by the API and on the fiche.
   > - **`REFUND_BEFORE_CANCELLATION` only when the cancellation wrote no avoir.** With an avoir, a book refund
   >   before it is judged by that set alone: one outside it is deleted. With no avoir, the bullet above stands
   >   unchanged. A stay that cannot be read back gets no set: every book refund before the avoir is then refused as
   >   netted, by id order.

### 3.2 What can be refunded

7. The server exposes, per reservation, a `refundableLines` payload — one entry per **billed** line:
   - **`accommodation`** — one aggregated line = `finalPrice − Σ options − Σ custom − Σ resources`
     (the same accommodation TTC the accounting model derives, `accountingModel.buildPerLineData`);
   - one line per **option** (`opt:<id>`), **custom option** (`custom:<label>`) and **resource**
     (`res:<id>`), keyed exactly like [midStayExtras.js](../server/src/utils/midStayExtras.js)
     (`extraLineKey`) so the two features never disagree on identity;
   - **`touristTax`** when `touristTaxTotal > 0`.

   Each entry carries `key`, `label`, `bucket`, `quantity`, `unitPrice`, `billedTtc`,
   `refundedTtc` (Σ of the refund lines already recorded on that key), `refundableTtc =
   max(0, billedTtc − refundedTtc)` and `vatRate`.
8. **Offered lines never appear** (they are stored at 0 € — there is nothing to give back), and
   neither do lines whose `refundableTtc` is 0.
9. A refund may also carry **free lines**: a label + an amount + a bucket chosen by the operator
   (default « Prestation complémentaire »). A free line has no `key` and no per-line cap — it is the
   commercial-gesture escape hatch.
10. **Per-key cap**: for every keyed line, Σ refunded on that key across all refunds must stay
    ≤ `billedTtc`. Violation → **409 `REFUND_EXCEEDS_LINE`** (the payload names the key).
11. **Global cap**: Σ of every refund of the reservation (all means, free lines included) must stay
    ≤ `finalPrice + touristTaxTotal`. Violation → **409 `REFUND_EXCEEDS_STAY`**.
12. Every line amount must be **> 0**, and the refund total must be > 0 → **400
    `REFUND_INVALID_AMOUNT`** otherwise.
13. `refundDate` must be a valid `YYYY-MM-DD` and **not in the future** (the money has to have moved)
    → **400 `REFUND_INVALID_DATE`**.
    *Reading of 2026-11-02 — the date window.* `refundDate` is a real calendar day (`2026-02-30` used to pass the
    regex) and not before today − 5 years, « Date trop ancienne : 5 ans au plus. » (`specs/reservations-backend-mvc.md` rule 13, second reading).
14. **VAT is frozen at creation.** Each line stores the `vatRate` that applied when it was recorded:
    the app's single global `vatRate` ([single-vat-rate.md](single-vat-rate.md)) for the three revenue
    buckets, **0** for the `touristTax` bucket (a pass-through bears no VAT). A later settings change
    never re-prices an avoir already issued — same principle as the stored-money accounting path.
15. Refunds are available on a **past-locked** reservation
    ([admin-unlock-past-reservations.md](admin-unlock-past-reservations.md)): an early departure is
    discovered *after* the stay by construction, so the past lock must not block them. They are
    **admin-only** — the reception role's path allowlist
    ([reception-role-checkin-only.md](reception-role-checkin-only.md)) is not extended, and the
    accountant role stays read-only.

### 3.3 Fiche & finance aggregates

16. **Nothing about the collection status changes.** `remainingToPay`, `isSettled`, the dashboard
    collection alert and the operational payments table
    ([finance-operational-remaining-to-pay.md](finance-operational-remaining-to-pay.md),
    [dashboard-collection-alert.md](dashboard-collection-alert.md)) ignore refunds entirely: a
    fully-paid, partly-refunded reservation stays **soldée**. A refund is money already returned, it
    is never « pending » — the same reasoning that keeps the notes register out of those paths
    ([mid-stay-notes.md](mid-stay-notes.md) rule 16).
17. The fiche's **« Total de séjour »** (`sejourNetTotal`, the figure
    [fiche-total-sejour-net-of-commission.md](fiche-total-sejour-net-of-commission.md) defines) is
    **net of refunds**, and a dedicated « Remboursements − X € » line appears in the pricing summary
    right below the collection buckets.
18. `financeModel.totalSejour()` and `financeModel.comptaCollected()` subtract refunds, so every
    figure derived from them follows automatically: the Suivi financier cards, the per-property
    revenue chart, the breakdown dialogs and their HT counterparts
    ([finance-overview-rework.md](finance-overview-rework.md),
    [finance-per-property-revenue-chart.md](finance-per-property-revenue-chart.md)).
19. **Means convention, mirroring the caisse interne rule:** `transfer` + `cash` refunds are deducted
    from the book aggregates (totalSejour, encaissé, CA, export). An `internal` refund is off the
    books: it is excluded from those, and only counted in the « avec caisse » readings — exactly what
    `complementPaidCash` does at each aggregate, site by site.
20. A refund is attached to a reservation's **period** for the finance windows (it rides
    `totalSejour`, whose window is the reservation's, not the refund's date). The accounting export is
    the only surface that uses `refundDate` as its own timeline — same asymmetry as today between the
    finance overview (by reservation window) and the journal (by payment date).

### 3.4 Accounting — the avoir

21. Every **non-`internal`** refund emits **one journal entry** of kind **`refund`** in the month of
    its `refundDate`, sourced by a dedicated `refundsByMonth()` query (a real table, so the month
    filter is a plain range predicate — no `LIKE` scan like the notes register needs).
22. The entry is the **exact mirror** of an encaissement:

    | Side | Account | Amount |
    |---|---|---|
    | **Crédit** | `C<NOM>` (client auxiliary) | refund total TTC |
    | **Débit** | `70600000` / `70600010` / `70601000` per bucket | HT of that bucket's lines |
    | **Débit** | `44571100` / `44571200` per rate | VAT of those lines |
    | **Débit** | `46710000` | tourist-tax lines, in full (no VAT) |

    Σ débits = Σ crédits = refund TTC, the rounding residue absorbed on the **last debit** line (the
    encaissement path absorbs it on the last credit).
23. **No commission line, ever** — the owner refunds the guest directly, out of their own bank
    account, whatever the platform of the original sale.
24. Journal `VT`, `Pièce` empty, libellé = the same uppercased « PRÉNOM NOM » as the sale's entries
    — so the accountant reads the avoir next to the invoice it corrects.
25. The visual journal preview on `/comptabilite` shows the refund as its own card, flagged
    « Remboursement », built from the very same row walk as the CSV (the existing
    `entryToStructured` guarantee that preview == export must keep holding).
26. **`internal` refunds never reach the export nor the preview**, exactly like a cash complement or
    a caisse-interne note.

**Edge cases:**

- **The trigger case** — early departure, night billed, 2 breakfasts (2 × 12 €) refunded by transfer:
  the sale stays at its full price, the solde stays « payé » at its full amount, one refund of 24 €
  is recorded → the fiche shows « Remboursements −24,00 € », the CA of the transfer's month drops by
  21,82 € HT + 2,18 € de TVA, and the accountant gets a balanced avoir.
- **Refund recorded before the money is fully collected**: refused above what was collected
  (rule 50, D10 of 2026-11-05, reversing the earlier « allowed, warning only »); within it, the fiche's
  « reste à payer » is unaffected.
- **A refunded line is later shrunk or removed on the fiche**: existing refunds keep their money (it
  physically left the bank). `refundableTtc` clamps to 0, so no *further* refund is possible on that
  key.
- **Tourist-tax refund**: single debit on `46710000`, no VAT, no revenue account touched.
- **Reservation deleted**: refunds cascade away (`ON DELETE CASCADE`).
- **Devis (`kind='devis'`)**: no refunds — the endpoints reject with 400, like every other money flow.

### 3.5 Taxe de séjour — remboursement et déclaration

27. The tourist tax is refunded **by night, never as a loose amount**: its refundable line carries
    `quantity` = the nights of the stay, `unitPrice` = the whole party's tax for one night
    (`touristTaxTotal ÷ nights`) and `unitLabel = 'nuit'`, so the dialog offers a night stepper and the
    caption reads « Facturé 13,20 € · 3 nuits à 4,40 € ».
28. The stored `quantity` is **derived server-side** from the amount (`amountTtc ÷ unitPrice`) for
    every keyed line — a client-sent quantity is never trusted, so nights and euros can never disagree.
29. **Every means counts towards the commune**, caisse interne included: « hors comptabilité » only
    ever meant « out of the turnover ». What matters here is that the tax physically went back to the
    guest, so it is not owed — whatever envelope it left in. (This is the one place the caisse-interne
    convention of rule 19 does **not** apply, and deliberately so.)
30. The « Taxe de séjour » extraction declares the **net**: a refunded night leaves the row's
    **« Nuits »**, its **« Adultes-nuits »** and its **tax amount**, and the same deduction flows into
    the per-property recap and the month totals. What is deducted is the **night**, and the amount
    follows from it — never the refunded euros themselves. Two reasons: the page recomputes the tax
    from the property's current rate (it may differ by cents from what was billed), so subtracting a
    foreign amount would break its own `taxe = nuitées × tarif` arithmetic; and what is owed to the
    commune depends on the nights occupied, not on what the operator kept. Consequence: a goodwill
    refund too small to free a whole night changes nothing in the declaration.
31. Nights are deducted as **whole nights** (the declaration counts nights, not fractions), clamped to
    the stay. A reservation whose tourist tax is **entirely** refunded **leaves the declaration** — 0
    night, nothing to remit.
32. The row **says why**: « ↳ dont 1 nuit remboursée (− 4,40 €) », so the net figure is never an
    unexplained gap against the fiche. The amount shown is the declaration's own deduction, hence
    `net + retiré = brut` to the cent.
33. Refunding anything else (petit-déjeuner, hébergement, ligne libre) leaves the declaration
    **untouched** — only the `touristTax` key feeds it.

### 3.6 Trop-perçu (2026-10-18)

> **Why this was added.** The review of 2026-10-18 (F3) found reservation 22296 with 798,20 € received
> online and a solde lowered to 665 € by a later save, with nothing on the fiche to say so. The money
> received and the sale diverged silently.

34. **A trop-perçu is computed by the server and offered as a refund.** It is what the acompte and the
    solde actually collected, minus every refund already given back, minus the schedule the stay now
    has (`acompte + solde`), floored at 0 (`utils/overpayment.js`). A paid bucket's collected amount is the
    sum of the contribs captured when it was ticked, which survives a later save that lowers it; without
    a capture it is the stored amount. A caisse-interne bucket counts as collected. A paid acompte or
    solde whose amount the engine keeps frozen above what the reduced stay now owes counts too: the
    engine reports that excess as `overCollectedTtc`, and the trop-perçu is the larger of the two.
    - **On save:** a save that adds to the trop-perçu is refused with 409 `OVERPAID`, carrying
      `overpaymentTtc`, and nothing is written. The fiche asks « Trop-perçu » with two answers:
      « Enregistrer et rembourser » (the same save, sent again with `forceOverpayment`; the fiche stays
      open and the refund dialog opens on the amount) or « Annuler ». A stay that is already
      over-collected can still be saved for anything else.
    - **On the fiche:** the live quote (`POST /calculate-price` with a `reservationId`) carries
      `overpaymentTtc`, priced as the save would price it, so the amount follows each edit before the
      save. When it is above 0, the
      Remboursements block shows « Trop-perçu : X € » with a « Rembourser » button. The button opens the
      refund dialog with a free line « Trop-perçu » (bucket Hébergement) set to that amount; the operator
      can change both. *Amended 2026-10-18 by rule 35: one line per poste, no longer always Hébergement.*
35. **The trop-perçu is split by poste (2026-10-18).** The server also returns `overpaymentLines`
    (`[{ bucket, label, amountTtc, collectedTtc, dueTtc }]`), on the 409 `OVERPAID` and on the live quote,
    built by `overpaymentLinesOf` (`utils/overpayment.js`): for each poste (Hébergement, Prestations
    complémentaires, Activités, Taxe de séjour) what the paid acompte and solde captured on it, what the
    stay now costs on it as the save would price it, and the excess. The trop-perçu is spread over the
    postes in proportion to their excess, the rounding cents going to the largest; without a capture to
    read, or no poste in excess, it stays whole on Hébergement.
    - **Refund dialog:** opened from « Rembourser » or after « Enregistrer et rembourser », it carries one
      free line « Trop-perçu » per poste of `overpaymentLines`, each on its bucket and amount.
    - **Fiche:** under « Trop-perçu : X € », one caption per poste that collected something:
      « Taxe de séjour : 21,60 € encaissés, 7,20 € dus ». The pricing summary may still show the tax at
      its frozen, collected amount while the save recomputes it; this caption gives the figure the save
      will store.
    *Why: the second review of 2026-10-18 reduced 22304 from 6 to 2 adults after payment. The whole
    14,40 € came from the tourist tax, yet the dialog proposed « Hébergement »: accepted as is, the refund
    debited the turnover and the VAT and left 46710000 14,40 € too high. The same review saw the summary
    say « Taxe de séjour 21,60 € » beside a 14,40 € trop-perçu, with nothing to reconcile the two.*
36. **A paid solde keeps what it collected; the refund is the only reduction (2026-10-18).** A save
    that reduces a stay whose solde is paid never lowers `balanceAmount` below the stored, collected
    amount: the engine re-prices the stay (`finalPrice` drops), the excess stays visible as
    `overCollectedTtc` / the trop-perçu (rule 34), and the trop-perçu refund (rule 35) is what brings the
    money down. The live quote of a stored reservation prices a paid acompte or solde on its **stored**
    amount, whatever figure the browser still carries. One model on every surface:
    - accounting journal: the solde entry books the amount received, the refund entry gives back the
      trop-perçu — client account net = received − refunded, 46710000 never negative for the stay;
    - finance « Encaissé » and the stay's total: received − refunded;
    - fiche « Total perçu sur le séjour »: received − refunded, and the trop-perçu reads 0 after the
      refund.
    *Why: the final review of 2026-10-18 (N1) paid 465,60 €, reduced the party (trop-perçu 110,40 €)
    and refunded it. The save had already lowered the paid solde to 355,20 € and the refund took the
    110,40 € off a second time: journal, « Encaissé » and « Total perçu » read 244,80 € for a real net
    of 355,20 €, and 46710000 read −7,20 €.*
37. **The refund dialog's amounts are typed as text and say why they are refused (2026-10-18).** Every
    « Montant » field is a text field with the decimal keypad (`inputmode="decimal"`), read by the
    money parser of the fiche (`utils/arithmetic`): « 12,5 » is 12,50 €. On a line refunded by the
    unit, an amount that is a whole number of units moves the stepper to that count; any other amount
    hides the stepper behind « Montant libre » — the dialog never shows a fractional quantity (the
    server still derives the quantity from the amount, rule 28). The line's ceiling shows under its
    amount from the start (« Max 28,00 € »). The refusal sits on one line right above the save button:
    « <ligne> : dépasse le remboursable de X € » or « Montant illisible. » (save disabled),
    « Dépasse l'encaissé de X € » (warning, save still allowed). The server stays the authority on
    every ceiling. *Why: the final review of 2026-10-18 (UI #1) typed 45 on « Linge de lit » 28 € and
    the stepper read « 6.43 », the refusal sat in body text far from a greyed button, and a French
    « 12,5 » typed on desktop was silently dropped by the `type="number"` field.*
38. **A platform stay has no trop-perçu (2026-10-19).** Rules 34–36 apply to the operator's own
    channels only (`isDirectChannel`). On a platform stay the guest paid the platform, which refunds
    them itself: a paid solde follows the platform amount the operator corrects, the save is never
    refused with `OVERPAID`, the fiche shows no trop-perçu and « Total perçu » is the platform's net.
    *Why: the second pass of the final review (minor 1) corrected an Abracadaroom stay from 600 € to
    450 € after ticking « payé »: the solde stayed at 600 € with a 150 € trop-perçu nobody can give
    back.*
39. **Money kept on a direct stay stays in the sale (2026-10-19).** The trop-perçu is not a state to
    dismiss: it says the stay, as now sold, costs less than what was received. When the operator keeps
    part of it — a night the CGV make non-refundable, say — that money is still a sale, so it is
    priced on the fiche: a free line in « Prestations » (« Nuit non remboursable », its amount) or the
    « Prix ajusté » of the stay. The trop-perçu then reads what is still owed back, 0 when everything
    is kept, and the journal books the kept amount as revenue with its VAT. No « conservé » outcome
    is added: it would leave received money with no line to book it on. *Why: the same pass reduced
    stay 22298 by a night without refunding it and saw a 107,20 € trop-perçu stay on the fiche with
    no documented way to close it.*

40. **Rule 38 holds on a platform that takes an acompte (audit 2026-10-27).** With both échéances
    paid, the paid acompte stays and the paid solde follows the statement: `solde = max(0, pre-arrival
    − acompte)`, and no arrival complement is asked for a correction upwards. Gîtes de France,
    acompte 180 + solde 420 paid on a brut of 600: brut corrected to 450 → solde 270 (it kept 420,
    with 150 of trop-perçu); corrected to 700 → solde 520 (it asked 100 at arrival). The same holds
    on a counts-as-direct channel whose platform amount is entered (plugins-phase-p-productisation.md
    rule 45).
41. **A free line with an amount and no label is refused, never dropped (audit R2, 2026-10-29).** The
    dialog flags the « Libellé » field, shows « Libellé manquant. » above the save button and disables it,
    so the total shown is always the total posted. A blank line left empty is ignored. The server already
    refused it (`REFUND_INVALID_LINE`, rule 9) and answers the recorded `totalTtc`; the dialog's own sum
    stays a display of the lines it is about to post.
42. **A refund made from the fiche refreshes the stored ledger, and a trop-perçu is refunded once (audit R2,
    2026-10-29).** After `POST` and `DELETE /refunds` the fiche re-reads the stored finance
    (`reloadReservationFinance`, which moves the clean baseline with it, so the fiche stays clean): the
    « Trop-perçu » row and its button no longer outlive the refund. The refund dialog opened on a
    trop-perçu (the ledger row or a `409 OVERPAID`) sends `fromOverpayment: true` and the prefill amount
    `overpaymentTtc` — decided by where it was opened, never by a label. The server then refuses, with
    `409 REFUND_EXCEEDS_OVERPAYMENT`, a request beyond what is still over-collected on the stored stay or
    built on a larger prefill (« Dépasse le trop-perçu restant (X €). »), and any request once nothing
    remains (« Le trop-perçu est déjà remboursé. »). A dialog opened from « + Nouveau remboursement »
    carries no flag: a commercial gesture is not capped by it (the money collected still is).
    The dialog opened from a `409 OVERPAID` takes the body's `overpaymentMethod` (`internal` or null) as its
    default means, like the GET's refund prefill.
43. **The refund dialog opened by « Enregistrer et rembourser » shows the lines as saved (audit R3 N4,
    2026-10-29).** `reloadReservationFinance` also replaces the refund register (`refunds`, `refundableLines`,
    `refundTotals`, `collectedTtc`) with the fiche payload it re-reads, so the per-line caps are those of the
    stay after the save, not of the loaded fiche. Nothing is computed in React.
44. **A sold-line refund never settles the trop-perçu; « + Nouveau remboursement » only warns (audit R3 N2,
    Adrien's decision 2026-10-29: « avertir seulement »).** Rule 42 is unchanged: the stored trop-perçu counts
    free « Trop-perçu » refunds only, a refund of a sold line stays independent and does not reduce it. While the
    ledger carries an open « Trop-perçu » row (its amount comes from the server, `ledger.rows`), the dialog opened
    from « + Nouveau remboursement » shows « Un trop-perçu de X € est ouvert. » with « Rembourser le trop-perçu »,
    which reopens the dialog on the trop-perçu prefill (the `fromOverpayment` flow). No warning when no trop-perçu
    is open or when the dialog was opened on it. No server change.
45. **A requalification avoir consumes the lines of the bucket it reverses (audit R13-M1, 2026-11-01).** The
    `retained` avoir of a cancellation (payment-schedule spec §3.6, `specs/direct-installments.md` rule 46)
    reverses whole buckets: its option and resource lines are keyed `options` / `resources`, a key no billed
    line carries. `buildRefundableLines` spreads such an amount over the bucket's lines, pro rata of what each
    still had to give back (cents by largest remainder, rule 46; never below 0), after the per-key refunds. *Why:*
    after cancelling a stay paid through a plan, the register offered every option as fully refundable
    although the cancellation had already requalified 702,76 € of them.
46. **What a cancellation requalified is told apart from what was given back (review of PR #921, 2026-11-01).**
    Every refundable line carries `refundedTtc` — what the guest got back, every means but `retained` — and
    `requalifiedTtc` — what a `retained` avoir kept as an indemnity — and `refundableTtc` is the billed amount
    minus both. A bucket-keyed amount (rule 45) is spread by **largest remainder**: each line takes the floor
    of its pro rata share, and the cents left go one by one to the largest remainders, so the whole amount
    lands on lines that still had it. `RefundDialog` captions a line `Facturé 110,00 € · déjà remboursé
    20,00 € · requalifié 53,33 €`, each part shown only when above 0. *Why:* after a cancellation the
    dialog read « déjà remboursé 540,07 € » on options whose money had never left; and rounding each share
    on its own while the last line took the rest could drop cents — lines of 0,03 / 0,03 / 0,03 / 0,03 /
    0,01 € under a 0,10 € avoir consumed 0,09 €, so the register offered 0,01 € too much.
    > **Reading of 2026-11-02 (audit R14-C1).** The fiche's ledger tells the same money apart: a `retained`
    > avoir is the row « Acompte conservé » (« Échéances conservées » on a stay paid through a plan), stateLabel
    > « Requalifié en indemnité le JJ/MM », with no action, never « Remboursement · Rendu le … · retained ».
    > A refund taken whole from the indemnity (rule 48) reads « Rendu sur l'indemnité le JJ/MM · virement »; a
    > mixed one keeps « Rendu le … » and names its indemnity lines « Hébergement · sur l'indemnité : − 60,00 € ».
    > `METHOD_LABELS` gains `retained: 'acompte conservé'` as a fallback, so no raw code reaches the screen.
    > *Why:* the cancelled fiche said money was given back that was kept, in an English code.
47. **A `retained` avoir is split HT / VAT line by line in the export (review of PR #921, 2026-11-01).**
    `accountingModel.buildRefundEntry` splits each line of a `retained` refund on its own and sums the HT
    and the VAT per bucket; a real refund keeps one split per bucket and rate. A cancellation's avoir
    reverses encaissements line for line (`specs/direct-installments.md` rule 46, reading of 2026-11-01),
    so this is the split each encaissement was booked with, and the accounts net to the cent. Every
    `retained` avoir booked before carries at most one line per bucket and rate, where both splits are the
    same numbers: no exported month moves. *Why:* 2 × 351,38 € of options split into 2 × 319,44 € HT on
    the installments, but 702,76 € split at once gave 638,87 € HT: 70600010 kept 0,01 €.
48. **On a cancelled stay, a refund gives back money collected, and reduces the indemnity first kept (audit
    R14-M1, Adrien's decision 2026-11-02: « Réduire l'indemnité »).** A cancellation moved the money it kept out
    of 706 + VAT into the indemnity (payment-schedule spec §3.6). On a stay with `kind = 'cancelled'`:
    - **What is refundable** is what the stay collected (`collectedTtc`, the book money net of every book refund,
      `comptaCollected`), never what it billed. `cancelledRefundBudget` splits it into `indemnityLeftTtc` — what
      the `retained` avoirs requalified, minus what refunds already took from the indemnity — and `saleLeftTtc`,
      the rest (a paid solde, which no cancellation requalifies). Each refundable line offers what the indemnity
      still holds on it (`indemnityTtc`: its `requalifiedTtc` minus its indemnity refunds) plus at most
      `saleLeftTtc` of its own headroom. The payload's `collectedTtc` is that same budget, so the dialog's
      « Dépasse l'encaissé » caption reads true.
    - **How it is booked:** each line is given back first from `saleLeftTtc` — it keeps its bucket and VAT rate,
      the sale is reversed as any refund (rule 22) — then from the indemnity: that part is stored as a line of
      bucket `indemnity`, same key and label, at 0 %. The export debits it on the indemnity account at the
      indemnity's rate (`cancellationCompensationAccount` / `vatRateCancellationCompensation`, 75880000 at 0 %
      by default; 0 % on a stay sold « Sans TVA »), never 706 nor 4457. Client account, 706, 4457 and 4671 are
      then exact; the indemnity is reduced by what went back.
    - **Refusals (409):** a keyed line beyond its share → `REFUND_EXCEEDS_LINE` (the per-line cap of rule 10), or,
      when the line's share is used up by an earlier line of the same refund, « <ligne> : dépasse l'encaissé (X €). »;
      a free line beyond what is left → `REFUND_EXCEEDS_COLLECTED` « Dépasse l'encaissé (X €). »; an indemnity share in caisse interne
      (`internal`, off the books, so it could not reduce the indemnity) → `REFUND_INDEMNITY_OFF_BOOKS`
      « Pris sur l'indemnité : virement ou espèces seulement. »
    A stay that is not cancelled is unchanged. *Why:* on stay #22326 (2 060 € collected by two installments, all
    kept), the register offered the 1 029,60 € never collected, and a 500 € refund debited 70600000 454,55 € and
    44571100 45,45 € — negative revenue and deductible VAT on money whose VAT was already reversed — while
    75880000 stayed at 2 060 €.
    - **The compensation card keeps what the cancellation kept.** The « Acompte conservé — annulation » card
      (payment-schedule spec rule 33) records the amount the cancellation retained; refunds reduce the indemnity
      **in the journal only** (the debit above). Never re-receive the card at a lower amount after such a
      refund: the reduction would count twice. `GET /api/accounting/cancellation-compensations` gives each
      received `retained_deposit` card `indemnityRefundedTtc` (Σ of its stay's `indemnity` lines, book money),
      and « Rouvrir » then adds « Déjà réduite de X € par des remboursements : la ré-encaisser au même montant. »
    > **Reading of 2026-11-02 (review of PR #925).**
    > - The indemnity share is split HT / VAT **cumulatively over the stay**: its HT is HT(Σ of the stay's earlier
    >   indemnity shares, by `refundDate` then id, + this one) − HT(that earlier Σ), so the shares' HT add up to
    >   the compensation's HT to the cent once all of it is given back, at any `vatRateCancellationCompensation`
    >   (`refundsModel.indemnityGivenBefore`). *Why:* at 20 %, 1 030 + 1 030 € split on their own gave
    >   858,33 × 2 = 1 716,66 € HT against 1 716,67 € on the compensation: 75880000 −0,01, 44571200 +0,01.
    > - What the **caisse interne** gave back of the sale (its non-`indemnity` lines) comes off `collectedTtc`
    >   and therefore off `saleLeftTtc`: that money left the stay, even off the books. *Why:* with the paid solde
    >   (640 €) given back in caisse interne, a free line of 274 € was still booked as a sale — 706 −249,09 and
    >   4457 −24,91 on revenue the cancellation had already reversed — instead of off the indemnity.
    > - The franchise turnover (specs/vat-optional-mode.md rule 37) subtracts a refund's `indemnity` share at
    >   face value, like the indemnity it reduces; its sale share keeps the stay's ratio.
    > - A VAT regime switch (and its undo) re-rates refund lines except `touristTax` **and `indemnity`**: an
    >   indemnity line is not a sale, it stays at 0 % (the export reads the compensation settings anyway).
    > - The refusals write their amounts with `formatEuros` (« Dépasse l'encaissé (2 060,00 €). »,
    >   « … dépasse le montant restant remboursable (1 333,24 €) »).
49. **A cancelled stay never offers more than it can give back** _(added 2026-11-02, round 15)_. On a cancelled
    stay the lines share two sums, the indemnity left and the sale money left (rule 48), so
    `buildRefundableLines` caps each sum over the lines: the excess comes off the first lines (accommodation, then
    the extras, the tourist tax last), and Σ `refundableTtc` never exceeds `collectedTtc`. Asking for every line at
    its offered amount is accepted. A refund above what is left is refused with what is left: the whole refund
    first, `REFUND_EXCEEDS_COLLECTED` « Dépasse l'encaissé (X €). » with X = `collectedTtc`; then a line that runs
    out after the earlier lines of the same refund, « « <ligne> » : dépasse l'encaissé restant (X €). » with X what
    was still left for it. A stay that is not cancelled is unchanged. *Why:* on stay #22326, after a 10 € free
    line the lines offered 1 547,45 € against 1 537,45 € left, and asking for all of them was refused with
    « Taxe de séjour : dépasse l'encaissé (12,00 €) » although 2 € were left for it. With a paid solde the lines
    each offered the whole sale money: a stay that had collected 195,94 € offered 290,26 €.
    > **Reading of 2026-11-02 (round 15).** A book refund made before the cancellation no longer reaches the
    > indemnity: the cancellation keeps only what it left (specs/payment-schedule-and-cancellation.md rule 55), so
    > `requalifiedTtc` and `indemnityTtc` read the net amount.
    > **Reading of 2026-11-02 (review of PR #926).** A line offers at most what THAT line collected
    > (`collectedByLine`): the paid acompte's and solde's contribs, plus a paid complement's share, net of the sale
    > money already given back on it; without contribs that add up to each paid entry, the accommodation and the
    > tax read what the acompte and the solde were booked on (`cancelReservation.bookedStayBuckets`) and a line paid
    > at arrival collected nothing while the complement is unpaid. A cancellation's options or resources avoir is
    > spread only over the lines that collected money. When the lines still add up to more than is left, the excess
    > comes off the lines paid at arrival first, then the lines whose own collection is unknown, the capped lines
    > last. A stay with a paid acompte and solde and a 32 € line paid at arrival: the register offers 714 + 200 +
    > 12 € (no longer 682 € of accommodation and the 32 € line) and giving all of it back nets every 706
    > sub-account to 0. A plan's money is all requalified, so its lines hold no sale money to cap.
    > **Reading of 2026-11-02 (second review of PR #926).**
    > - **The avoir is spread over the lines as they stood when it was written.** A cancellation's options or
    >   resources avoir is spread pro rata of what each line had left net of the refunds made before it
    >   (`spreadBucketRefund` with `roomOf`), never of what a later refund left: giving back the sale part of one line
    >   leaves what the others offer, and the indemnity each holds, unchanged, and a refund asked from an older view of
    >   the register takes no indemnity on a line that still holds sale money. *Why:* on stay #22226, giving back the
    >   sale part one line at a time offered 37,67 € on the dinner, then 6,16, 1,30, 0,29, 0,07 and 0,01 € more after
    >   each refund, and a tab left on the first view took 7,74 € of indemnity while sale money was left.
    > - **No cent of the money collected is left unoffered.** The per-line caps of a stored-money split can leave up to
    >   0,02 € that no line offers (a bucket booked a cent above what it billed, the solde's tax a cent below); those
    >   cents are offered on the line with the most room left within what it billed. A legacy stay of 358,10 € plus
    >   6,05 € of tax, acompte 179,05 € and solde paid: the lines offered 364,14 € of the 364,15 € collected; they
    >   offer all of it, and giving it back leaves nothing collected. The books keep the cent where the solde entry put
    >   it, as the refunds of a stay that is not cancelled do.
    > **Reading of 2026-11-02 (audit R15-L1, the caisse interne).** Money collected in the caisse interne never
    > reached the books, and a cancellation now requalifies book money only (payment-schedule-and-cancellation rule
    > 55, reading of the same day). On a cancelled stay:
    > - **The caisse interne has its own budget**: `cashCollected` (`utils/reservationSettlement`) — the acompte,
    >   solde, arrival and end-of-stay complements paid there, its notes, the réduction or pourboire of a
    >   caisse-interne arrival payment — minus the caisse-interne refunds, `cashLeftTtc`. Each line offers, beside its
    >   sale money and its indemnity, `cashTtc`: what the caisse interne collected on that line
    >   (`collectedByLine({ cash: true })`, the same reading as the book money, on the caisse-interne entries), within
    >   what the line billed, the lines together never above `cashLeftTtc`. `collectedTtc` in the payload is the book
    >   money left plus `cashLeftTtc`. An installment is never paid in caisse interne (`installmentsController`
    >   accepts transfer, cash, cheque, card, other).
    > - **A caisse-interne refund** takes the caisse interne's own money first, then the sale money (the review of
    >   PR #925 case: a transfer-paid solde given back in caisse interne), never the indemnity
    >   (`REFUND_INDEMNITY_OFF_BOOKS`, as before). Only what it gives back beyond the money the caisse interne
    >   collected comes off the book `collectedTtc`.
    > - **A book refund** never takes the caisse interne's money: `REFUND_CASH_ONLY_IN_CASH` « Encaissé en caisse
    >   interne : rendu en caisse interne seulement. » when only that money is left on the line.
    > *Why (probe P2):* acompte 274 € by transfer, solde 640 € paid in caisse interne, cancelled: the register
    > offered the 274 € indemnity only, and giving back the 640 € held in cash was refused (`REFUND_EXCEEDS_LINE`).
    > It now offers 914 € (274 € from the indemnity, 640 € in caisse interne), and once both are given back every
    > book account nets to 0. A stay with no money in the caisse interne reads exactly as before.
    > **Reading of 2026-11-02 (review of PR #929, F4).** `cashLeftTtc` never exceeds what the lines carry in
    > caisse interne (Σ `cashTtc`): cash collected on no line of the register — an end-of-stay complement, or a
    > complement whose composition is unknown — is neither offered nor counted in `collectedTtc`, so « Dépasse
    > l'encaissé (…) » names what can really be given back. *Why:* on stay #22226 the register counted 90 € of cash
    > collected while its lines could give back 32 €.
    > **Reading of 2026-11-02 (review of PR #926, residual A, the commissions withheld).** A direct stay collected
    > through a payment provider (Lodgify / Stripe) was booked gross, the commission on 622600, and reached the bank
    > net of it (`comptaCollected`). The cancellation now names those commissions on its avoir (lines keyed
    > `commission`, payment-schedule-and-cancellation rule 55). They leave their lines like the money kept
    > (`requalifiedTtc` includes them, an options or resources share spread like the avoir's own), but the indemnity
    > never gives them back: `indemnityLeftTtc` = requalified − the `commission` lines − what refunds took from the
    > indemnity, and a line's `indemnityTtc` excludes its share. *Why:* on stay #22226, once every collected euro
    > went back, 6,20 € HT + 0,62 € of VAT stayed as sales revenue on a cancelled stay; now 706, 4457, 4671 and the
    > client account end at 0, 75880000 at −6,82 € (the commissions, kept) and 622600 at +6,82 € (their cost). An
    > avoir written before carries no `commission` line: its register does not move. Since the review of PR #929
    > (F1), the solde's commission requalified is capped at what the books still hold of the solde
    > (payment-schedule-and-cancellation rule 55, reading of the same day): the same nets hold when part of the solde
    > was refunded before the cancellation.

    > **Reading of 2026-11-05 (audit R22-2).** A paid complement is not « whatever the solde did not hold »: that is false
    > while the solde is unpaid. `collectedByLine` splits on the solde, on both of its paths. Complement paid, solde unpaid:
    > a forced line collected its total, a non-forced line its acompte contrib (0 with no acompte, left unknown on a plan
    > with paid installments), the accommodation gains `extraGuestComplementSurcharge`, the tax is the whole tax if it rides
    > the complement (`taxRidesTheComplement`), else `touristTaxAddedGuestsAmount`. The arrival rank of the excess holds only
    > while the complement is unpaid. A forced 50 € line, complement paid, solde unpaid: the register offers 50 € on it and no
    > tax, where it offered 45,20 + 4,80 € and left 46710000 at −4,80 after the give-back. Giving everything back nets every
    > account to 0 in each order. Test: `plugins/accounting-export/tests/cancelled-register-complement-before-solde`.
    > **Reading of 2026-11-05 (audit R22-4).** On a cancelled stay a line's ceiling is `max(billed, collected)`, in the
    > register and in the spread of the avoir (`roomAtAvoir`): a line lowered after payment (tariff refresh 50 → 25 €, quantity
    > 10 → 5) offers what it collected. `validateRefundPayload` skips the stay cap when cancelled, `REFUND_EXCEEDS_COLLECTED`
    > rules there. A paid line removed since stays on the register for what it collected, under its name (billed = that
    > amount, `collectedLinesGone`; accounting-books rule 17); a free line remains possible, within what was collected. Test:
    > `plugins/accounting-export/tests/cancelled-register-lowered-line`, `removed-line-contribs`.
    > **Reading of 2026-11-05 (audit R22-6a).** A complement stamped at its flip (accounting-books rule 16) collected what
    > its split says: `collectedByLine` reads it first, so a stay that rose after solde and complement reads no phantom
    > accommodation or tax on the complement, and the give-back nets to 0 (the auditor's `p8` residue, 70600000 −13,82 /
    > 70600010 +13,82). A split that pro-rated its money names no line: the lines then read as without one.
    >
    > **Reading of 2026-11-05 (R22 verification, L1).** A plan's installments are book money: `collectedByLine` adds the
    > accommodation and the tax they were booked on (`bookedStayBuckets().installments`, frozen split first, then the plan's
    > `taxShares`), never in the caisse interne's reading. Without them the requalification came off the complement's money
    > alone: own channel reversed, gross 600 €, one adult more, plan of 2 paid, complement 42,40 € paid, cancelled, the register
    > offered 595,20 + 4,80 € for 642,40 € collected, and 42,40 € stayed on no line (70600000 36,36, 44571100 3,64, 46710000
    > 2,40). It now offers 635,20 + 7,20 € and every account nets to 0. A plan never sits beside a paid acompte or solde (D2),
    > so the reading with contribs does not add them. Test:
    > `plugins/accounting-export/tests/added-guests-tax-pre-arrival-readers`.
    >
    > **Reading of 2026-11-05 (audit R23 N5).** An installment's split knows the bucket, not the line, so what a plan booked
    > on options or resources beyond the lines still naming it (a paid line removed, lowered, or moved to the complement) was
    > on no line: 100 € left in 75880000, `lines: []`, `collected: 100`. `bookedStayBuckets().installments` also returns
    > `options` and `resources`; `collectedByLine` reads the part above the non-complement lines' billed amounts, keyed
    > `plan:options` / `plan:resources` (rounding cents excepted), and `collectedLinesGone` offers it as one line per bucket:
    > « Prestations encaissées », « Activités encaissées ». Line removed 100 €, lowered 100 → 40 €, half-paid line moved to the
    > complement 49,94 €, option + resource removed 80 + 54 €: everything given back, every account 0. Test:
    > `plugins/accounting-export/tests/cancelled-register-plan-and-eos-lines`.
    >
    > **Reading of 2026-11-05 (audit R23 N6).** On the books, a paid end-of-stay complement and the mid-stay notes hold lines
    > too (`collectedAfterArrival`): a detail or note line with a key reads on that key, once, and the excess of mid-stay
    > rule 20 (`arrivalComplementExcess`) is a gone line under its label, bucket `options`, where D9 books it (`res:` keys:
    > `resources`, as `splitEndOfStayDetail`). Solde, complement, one adult more, end of stay paid, cancelled: 42,40 € are offered
    > and every account nets to 0, where they sat on no line. A SAS line with no key names no line of the fiche. The caisse
    > interne's reading is unchanged (review of PR #929, F4). Same test.
    >
    > **Accepted, 2026-11-05 (audit R23 L5, L7).** An adjusted complement collects on its bucket, not its line: line 100 €,
    > complement adjusted to 120 €, paid alone, cancelled: the line offers 100 €, the other 20 € are collected on no line, and
    > the free line gives them back (a line on accommodation alone offers nothing: `lines: []`). `collectedByLine` does not read
    > `complementAllocation`: its buckets name no line, and that reading would be new logic for a rare gesture. A refund of a
    > trop-perçu on its free line, then a cancellation and the give-back, returns every euro but leaves a pair across revenue
    > accounts, for example 70600000 +90,90 / 70600010 -90,91 (line removed), ±54,55 (lowered), ±45,45 (complement line): no euro
    > lost. It is the exception to the cross-account residue rule 51 closes. Test: `live-refund-per-line`.
50. **A live stay refuses a book refund above what it collected** _(D10, Adrien, 2026-11-05; audit R22-7)_. The total of a
    refund made by transfer or in cash (`Espèces`) on a stay that is not cancelled cannot exceed `collectedTtc`, net of the
    refunds already made: 409 `REFUND_EXCEEDS_COLLECTED` « Dépasse l'encaissé (X €). », the same refusal as a cancelled
    stay. Only the total is judged, the per-line reading is unchanged. A caisse-interne refund is off the books and not
    judged by this rule. This reverses the earlier « allowed, warning only » (§3.4 edge case, §6 item 7). *Why:* a bank
    refund of money never received is not a real event, and rule 48 refused it on cancelled stays for that reason. On a
    direct stay nothing collected accepted 704,80 € and showed `collected −704,80`; on a reversed platform with a guest
    added, solde 600 € collected, 642,40 € was offered and accepted. Rule 44 (« + Nouveau remboursement » only warns about a
    trop-perçu) is a different case and does not change. The dialog disables the save with « Dépasse l'encaissé de X. » on a
    book means, and keeps the warning on the caisse interne. Test: `live-refund-above-collected`, `RefundDialog.test`.
    > **Reading of 2026-11-05 (D15).** « Only the total is judged » now reads « the total is judged first »: rule 51 judges the
    > lines within it. The refusal and the codes of this rule do not move.
51. **A live stay refuses a line refund above what that line collected** _(D15, Adrien, 2026-11-05; audit R23 N9)_. On a stay
    that is not cancelled, a book refund on a keyed line cannot exceed what that line collected (`collectedByLine`) net of the
    book refunds already made on it: 409 `REFUND_EXCEEDS_LINE_COLLECTED`, « Rien d'encaissé sur cette ligne. » at 0, otherwise
    « Disponible sur cette ligne : X €. ». Rule 7's own refusal comes first, then rule 50's total, then this one.
    - The server ships the figure: `refundableLines[].availableTtc`, never above `refundableTtc`. The dialog disables a line at
      0 and says why, pre-fills and caps a line at the figure on « Virement » and « Espèces », and does no math. Absent (a
      cancelled stay, money no contrib describes), it falls back to `refundableTtc`.
    - Free lines are judged on the total only, so a trop-perçu refund (rules 34, 42) is unchanged.
    - The caisse interne is not judged, and its refunds take nothing from a line's figure beyond `refundableTtc` itself.
    - A plan's installments know the bucket, not the line (N5): the lines no reading names share the bucket's booked money plus
      what the end of stay and the notes collected on them (`sharedBucketTtc`, refused too on their sum).
    - Legacy money no contrib describes reads as on the cancelled register: accommodation and tax from `booked`, the other
      lines carry no figure and the total judges them. Stored refunds are not re-judged, cancelled stays keep rules 48-49.
    *Why:* the journal is per account. 16 € refunded on an option added after the solde, then a cancellation and the give-back,
    left total 0 but 70600000 +14,54 and 70600010 −14,55; the same on the tax left 46710000 at −3,60. An acompte alone holds no
    tax yet, so the tax line refuses there too (it used to pass, D10's « free per line »). Test: `live-refund-per-line`,
    `live-refund-above-collected`, `RefundDialog.line-collected`, `plugins/accounting-export/tests/cancelled-register-plan-and-eos-lines`.
52. **A mark taken back never leaves book refunds above what stays collected** _(audit R23 N7, 2026-11-05)_. Rule 50's reverse
    order. The payment PATCH (`depositPaid`, `balancePaid`, complement and end of stay, their move to the caisse interne, a note
    cancelled or lowered), the arrival undo and the reconciliation's « Défaire » (installment or bucket, only the marks it would
    really take back) refuse with 409 `REFUND_BLOCKS_UNTICK` before anything is written, naming the refunds to delete first, most
    recent first and only as many as needed: « Remboursement du 05/11/2026 (300,00 €) à supprimer d'abord. », with `refundIds`. A
    gesture that does not lower `comptaCollected`, a caisse-interne refund and what stays collected above the refunds pass.
    *Why:* solde paid, 300 € refunded, un-tick: `collected −300`, 70600000 −272,73 and the bank +300 stayed in the journal, and a
    cancellation then left the negative revenue on an empty register. Shared guard: `utils/refundUntickGuard.js`. The departure and
    arrival SAS commits pass through it too since the reading of 2026-11-05 below (audit R24-DB-2). Test: `untick-with-open-refund`,
    `plugins/online-payment/tests/reconciliation-undo-open-refund`. *Reading of 2026-11-05 (audit R23 L6):* a save adjusting a paid
    complement or end-of-stay complement down is the same gesture by another door: same guard, same 409, nothing written.
    *Reading of 2026-11-05 (audit R24-DB-2):* three more doors, same guard, same 409, nothing written. A re-opened arrival SAS
    (plugin `sas`, `commitArrival`) answering « Pas maintenant » or moving to the caisse interne the acompte or solde it settled
    itself (`*PaidAtArrival`), or the arrival complement; a re-opened departure SAS doing the same on the end-of-stay complement
    it settled itself (`endOfStayComplementPaidAtDeparture`); « Sans acompte » saved on a paid acompte (the hand-ticked one:
    rule 13 of disable-deposit-per-reservation already keeps an acompte a link collected). The SAS calls the core's
    `takeBackRefusal` with the flags it would clear; a re-open with nothing refunded behaves as before. *Accepted (audit R24 L4,
    2026-11-05, pre-existing):* on a live stay a book refund is capped at `finalPrice` + tax (`REFUND_EXCEEDS_STAY`), so a paid
    departure-SAS charge (end-of-stay complement, outside `finalPrice`) cannot be given back with the rest; after a
    cancellation the cap is skipped and a free line reaches it. No money is lost.
    *Reading of 2026-11-05 (audit R24 verification DB-2):* a SAS takes back only what it settled: a solde ticked on the fiche then
    « Pas maintenant » at the arrival, or an end-of-stay complement ticked outside the departure SAS then « Pas maintenant » at the
    departure, keeps its mark and is never refused for a refund on it (pinned by `untick-with-open-refund`).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `reservations.js` | T | 3 thin routes: `GET /:id/refunds`, `POST /:id/refunds`, `DELETE /:id/refunds/:refundId` → refundsController |
| `controllers/` | `refundsController.js` | C | Orchestrates: load reservation, build refundable lines, validate the payload (rules 10–15), persist, return the fresh register + lines |
| `models/` | `refundsModel.js` | C | DB access: `listByReservation`, `create` (header + lines in one transaction), `remove`, `totalsByReservation` (book / with-cash split), `refundedByKey`, `refundsByMonth` |
| `models/` | `accountingModel.js` | T | New `refundsByMonth({month, year})` → `refund` entries (bucket HT/VAT already split, `direction: 'refund'`); `encaissementsByMonth` untouched |
| `models/` | `financeModel.js` | T | `totalSejour` / `comptaCollected` subtract the book refunds; `getTouristTaxExtraction` deducts the refunded nights from the declaration (row, per-property recap, month totals) and exposes `refundedTaxNights` / `refundedTaxAmount` |
| `models/` | `reservationsModel.js` | T | `getById` joins the refund register + totals into the payload consumed by the fiche |
| `controllers/` | `accountingController.js` | T | Merges encaissement + refund entries, sorted by date, for both `sales.csv` and `sales` |
| `controllers/` | `reservationsController.js` | T | Feeds `refundsTotal` into the quote inputs (like `midStayQuoteInputs`) and exposes `refundableLines` on `GET /:id` |
| `utils/` | `refunds.js` | C | **Pure**: `buildRefundableLines(...)` (incl. the per-night tourist-tax line), `validateRefundPayload(...)` (derives the quantity from the amount), `splitHtVat(...)`, `refundedTouristTax(refunds)` → `{ amount, nights }` |
| `utils/` | `refunds.js` | T | Rule 49 readings of 2026-11-05 (R23) — `PLAN_BUCKET_LINES`, `collectedAfterArrival`, both read by `collectedByLine` and `collectedLinesGone`; rule 51 — `applyLiveCollected` (`availableTtc`, `sharedBucketTtc`), the line check of `validateRefundPayload` |
| `utils/` | `cancelReservation.js` | T | Rule 49 reading (N5) — `bookedStayBuckets().installments` also returns `options` and `resources` |
| `utils/` | `refundUntickGuard.js` | C | Rule 52 — `untickRefusal(row, changes, refunds)`: pure, shared by the PATCH, the arrival undo and `takeBackRefusal` |
| `utils/` | `reservationPaymentMark.js` | T | Rule 52 — `takeBackRefusal(reservationId, { flags, installmentCents })` for a plugin taking a mark back |
| `plugins/sas/` | `controller.js` | T | Rule 52 reading (R24-DB-2) — `arrivalTakeBackFlags`, `departureTakeBackFlags`: a re-opened SAS asks `takeBackRefusal` before writing |
| `controllers/` | `reservationsController.js` | T | Rule 52 reading (R24-DB-2) — « Sans acompte » on a paid acompte adds `depositPaid: 0` to the save's guard |
| `controllers/` | `refundsController.js` | T | Rule 51 — reads `collectedByLine` on a live stay too, when its money can be read |
| `controllers/` | `reservationsController.js` | T | Rule 52 — `paymentPatchChanges`, `arrivalUndoChanges` feed the guard |
| `plugins/online-payment/reconciliation/` | `ficheWriter.js`, `controller.js`, `index.js` | T | Rule 52 — `undoRefusal`: « Défaire » answers the core's refusal before writing |
| `utils/` | `refunds.js` | T | Rule 48 — `cancelledRefundBudget(...)`; `buildRefundableLines({ cancelled })` caps each line at what was collected (`indemnityTtc`); `validateRefundPayload({ cancelled })` splits each line between the sale and the `indemnity` bucket |
| `utils/` | `refunds.js` | T | Rule 49 — `capInOrder`: the lines' sale and indemnity rooms add up to what is left; the refusals name what is left. Reading of 2026-11-02: `collectedByLine` caps each line at what it collected |
| `controllers/` | `refundsController.js` | T | Rule 49 reading — on a cancelled stay, hands `collectedByLine` (with `bookedStayBuckets`, read on `deps.database`) to `buildRefundableLines` |
| `utils/` | `refunds.js` | T | Rule 49 second reading — `spreadBucketRefund(lines, amount, roomOf)` spreads the avoir on the lines as they stood when it was written; the unoffered rounding cents (`STORED_SPLIT_ROUNDING_TTC`) go on the line with the most room |
| `controllers/` | `refundsController.js` | T | Rule 48 — on `kind = 'cancelled'`, passes the budget to both and answers `collectedTtc` = the budget |
| `plugins/accounting-export/` | `accountingModel.js`, `accountingExport.js` | T | Rule 48 — `buildRefundEntry` carries `indemnity` (account + rate of the compensation settings); `refundEntryToRows` debits it |
| `utils/` | `reservationLedger.js` | T | Rule 46 reading of 2026-11-02 — « Acompte conservé » / « Échéances conservées » row, « Rendu sur l'indemnité » |
| `utils/` | `refunds.js` | T | Rule 6 reading (R15-C1) — `refundDeletionRefusal`, `madeAfterCancellation`; rule 48 readings — `cancelledRefundBudget({ cashCollectedTtc })` (`cashLeftTtc`, the `commission` lines out of `indemnityLeftTtc`), `collectedByLine({ cash })`, the lines' `cashTtc`, `splitOnIndemnity` per method (`REFUND_CASH_ONLY_IN_CASH`) |
| `utils/` | `reservationSettlement.js` | T | Rule 48 reading (R15-L1) — `cashCollected(row)`: what the caisse interne collected on a stay |
| `controllers/` | `refundsController.js` | T | Rule 6 reading — `remove` answers `refundDeletionRefusal` (409); rule 48 reading — the caisse-interne budget and per-line reading, `collectedTtc` = book money left + `cashLeftTtc`, capped at what the lines carry in caisse interne (review of PR #929, F4) |
| `utils/` | `reservationLedger.js` | T | Rule 6 reading — on a cancelled stay, `deleteRefund` on every refund `refundDeletionRefusal` lets through (review of PR #929: a refund before a cancellation that had nothing to keep, a caisse-interne refund before it) |
| `models/` | `refundsModel.js` | T | Rule 6 reading (review of PR #929) — `create` records `afterCancellation` from the stay's `kind`; the register reads it |
| `database.js`, `schema.sql` | | T | Rule 6 reading (review of PR #929) — the `reservation_refunds.afterCancellation` column (idempotent `ALTER`) |
| `client/src/components/reservation/` | `FinanceSection.jsx` | T | Rule 6 reading — on a cancelled fiche, a refund's « Supprimer » is drawn through `closedActionsHost`, outside the disabled fieldset |
| `models/` | `refundsModel.js` | T | Rule 48 — `indemnityGivenBefore(refund)` (cumulative export split), `indemnityGivenBack(reservationId)` (the card's `indemnityRefundedTtc`) |
| `controllers/` | `cancellationCompensationsController.js` | T | Rule 48 — received `retained_deposit` cards carry `indemnityRefundedTtc` |
| `models/` | `financeDashboardModel.js`, `vatFranchiseModel.js` (via `utils/vatFranchise.js`) | T | Rule 48 — the franchise turnover subtracts a refund's indemnity share at face value |
| `models/` | `vatRegimeSwitchModel.js` | T | Rule 48 — a switch never re-rates an `indemnity` line |
| `client/src/components/` | `CancellationCompensationsSection.jsx` | T | Rule 48 — « Rouvrir » warns when refunds already reduced the indemnity |
| `utils/` | `accountingExport.js` | T | `refundEntryToRows()` (credit client / debit revenue+VAT+pass-through, residue on the last debit) routed from `entryToRows` on `entry.direction === 'refund'`; `entryToStructured` inherits it for free |
| `utils/` | `pricing.js` | T | New input `refundsTotal`; new output `refundsTotal` + `sejourNetTotal` net of refunds (single subtraction, no other engine change) |
| `constants/` | `accounting.js` | T | `REFUND_BUCKET_TO_ACCOUNT` (adds `touristTax → 46710000` on top of the existing `BUCKET_TO_ACCOUNT`) |
| `utils/` | `reservationSettlement.js` | T | Gains `comptaCollected` / `midStayNotesTotal` / `refundsBook` (extracted from `financeModel` so the fiche's « encaissé » caption and the finance views share ONE authority), all three net of refunds |
| `utils/` | `overpayment.js` | C | Rule 34 — **pure** `collectedOnSchedule` / `overpaymentOf`: collected on acompte + solde (captured contribs), minus refunds, minus the schedule, or the engine's `overCollectedTtc` when larger. Rule 35 — `overpaymentLinesOf` / `currentByPoste`: the same amount split by poste |
| `utils/` | `pricing.js` | T | Rule 34 — new output `overCollectedTtc`: what a paid acompte and solde hold beyond what the reduced stay now owes |
| `controllers/` | `reservationsController.js` | T | Rule 34 — `overpaymentIntroducedBy` (409 `OVERPAID` unless `forceOverpayment`) on update; `calculatePrice` returns `overpaymentTtc` for a stored reservation. Rule 35 — both also return `overpaymentLines` |
| `models/` | `reservationsModel.js` | T | Rule 35 — `capturedScheduleContribsByPoste`: the captured contribs of each schedule bucket, per poste |
| `middleware/` | `enforceRoleAccess.js` | — | (none — the new paths are admin-only by default; the reception allowlist drift test pins that) |
| `schema.sql` | `schema.sql` | T | The two tables + 2 indices. Per specs/migrations-baseline.md the baseline is re-executed at every boot with `CREATE TABLE IF NOT EXISTS`, so a brand-new table needs NO extra block in `database.js` (that file is only for altering existing rows) |

**Notes:**
- `utils/refunds.js` is pure (no DB, no clock) so every cap, every VAT split and every
  refundable-line derivation is unit-testable in isolation — same shape as `midStayExtras.js`.
- No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Refund dialog open/close state, create/delete handlers, refetch after mutation |
| `pages/` | `AccountingPage.jsx` | T | Renders `refund` entries as avoir cards (chip « Remboursement », inverted debit/credit reading) |
| `pages/` | `TouristTaxPage.jsx` | T | Annotates a row whose tax was partly refunded (« ↳ dont 1 nuit remboursée (− 4,40 €) »), desktop table + mobile card |
| `components/reservation/` | `FinanceSection.jsx` | T | New « Remboursements » block: total, « Nouveau remboursement » button, collapsible history with per-refund delete |
| `components/reservation/` | `RefundDialog.jsx` | C | Feature-local dialog: refundable-line picker + free lines + date + means + reason + live total |
| `components/` | `PricingSummary.jsx` | T | « Remboursements − X € » line + « Total de séjour » net of refunds |
| `services/` | `api.js` | T | `createReservationRefund(id, payload)`, `deleteReservationRefund(id, refundId)` |
| `hooks/` | — | — | (none) |
| `utils/` | — | — | (none — every amount and every cap comes from the server payload) |
| `constants/` | — | — | (French labels co-located in `RefundDialog.jsx`, like `MidStayNoteDialog.jsx`) |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `ConfirmDialog`, `DateField`, `ArithmeticTextField`, `EmptyState`, `CollapsibleSection` | All pre-existing; the dialog is a composition, not a new shell. |
| **Created (new generic)** | — | Nothing here is cross-page: the picker is bound to a reservation's billed lines. |
| **Specific (kept feature-local)** | `RefundDialog` | Mirrors `MidStayNoteDialog` (same « pick lines + one global settlement choice » shape) but reads the *billed* register instead of the *pending* one and writes a reversed movement. Generifying the two into one dialog would mean a props matrix larger than either component — deliberately kept separate. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/refunds` | — | `{ refunds, refundableLines, refundTotals: { book, withCash }, collectedTtc }` | Admin only. Also inlined in `GET /api/reservations/:id` so the fiche needs no extra round-trip — hence the `refund*` prefixes (a bare `totals` would collide in the reservation payload). `collectedTtc` feeds the dialog's over-refund caption. |
| POST | `/api/reservations/:id/refunds` | `{ refundDate, method, reason?, lines: [{ key?, label, bucket, quantity?, unitPrice?, amountTtc }] }` | `201 { refund, refunds, refundableLines, refundTotals, collectedTtc }` | Server recomputes `totalTtc` and freezes `vatRate` per line. |
| DELETE | `/api/reservations/:id/refunds/:refundId` | — | `200 { refunds, refundableLines, refundTotals, collectedTtc }` | 404 when the refund doesn't belong to `:id`. |

Auth: `requireAuth` + admin role (403 `FORBIDDEN_ROLE` for reception/accountant).
Errors: `{ error, code }` with the codes of rules 10–13, `REFUND_EXCEEDS_COLLECTED` (rule 50), `REFUND_EXCEEDS_LINE_COLLECTED` (rule 51). `refundableLines[]` also carries `availableTtc` on a live stay (rule 51). `PATCH /payment`, `POST /arrival-payment` (undo) and `DELETE /api/payments/reconciliation/links/:transactionId` answer 409 `REFUND_BLOCKS_UNTICK` `{ error, code, refundIds }` (rule 52).
Idempotency: none — a double POST creates two refunds (visible in the history, deletable).

**Audit 2026-10-27 (rule 40).** `utils/pricing.js` — the platform branch with both échéances paid,
and `paidSoldeFollowsStatement` for the rules 36/38 tests.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS reservation_refunds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL,
  refundDate    TEXT NOT NULL,                     -- YYYY-MM-DD, real money-out date
  method        TEXT NOT NULL DEFAULT 'transfer',  -- 'transfer' | 'cash' | 'internal'
  totalTtc      REAL NOT NULL DEFAULT 0,           -- server-computed Σ lines
  reason        TEXT DEFAULT '',
  createdAt     TEXT DEFAULT (datetime('now')),
  afterCancellation INTEGER,                       -- rule 6 reading of 2026-11-02: 1 written on a stay already cancelled, 0 before, NULL older rows
  FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reservation_refund_lines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  refundId  INTEGER NOT NULL,
  lineKey   TEXT,                                  -- 'accommodation' | 'opt:<id>' | 'res:<id>' | 'custom:<label>' | 'touristTax' | NULL (free line)
  label     TEXT NOT NULL,
  bucket    TEXT NOT NULL,                         -- 'accommodation' | 'options' | 'resources' | 'touristTax' | 'indemnity' (rule 48)
  quantity  REAL,
  unitPrice REAL,
  amountTtc REAL NOT NULL,
  vatRate   REAL NOT NULL DEFAULT 0,               -- frozen at creation (rule 14)
  FOREIGN KEY (refundId) REFERENCES reservation_refunds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refunds_reservation ON reservation_refunds(reservationId);
CREATE INDEX IF NOT EXISTS idx_refunds_date        ON reservation_refunds(refundDate);
```

Migration strategy: the two tables + their indices live in `server/src/schema.sql`, which
`database.js` re-executes at every boot with `CREATE … IF NOT EXISTS`
([migrations-baseline.md](migrations-baseline.md)) — so both a fresh install and the production DB get
them without a separate migration block (that file is reserved for changes that must alter existing
rows, which this one doesn't).

**Rule 48 (2026-11-02):** the indemnity share of a refund on a cancelled stay is a line of bucket `indemnity` —
a value, not a column: no schema change, and every refund booked before carries none.

**Rule 6 reading of 2026-11-02 (review of PR #929):** `afterCancellation` is added to an existing table, so
`database.js` carries an idempotent `ALTER TABLE reservation_refunds ADD COLUMN afterCancellation INTEGER`
(`PRAGMA table_info` guard). No backfill: a row written before stays NULL and reads `createdAt` against
`cancelledAt`, as it did. `refundsModel.create` fills it in the INSERT itself, from the stay's `kind`.

**Data impact:** none. Purely additive — no column added to `reservations`, no existing row read or
rewritten, no backfill. Removing the feature would be a pure table drop. Existing reservations simply
have an empty register, and every aggregate subtracts 0.

## 6. UI / UX

### Fiche réservation — bloc « Remboursements » (`FinanceSection`)

Placed **after every collection block** (arrival complement → notes en séjour → complément de fin de
séjour) and **before « Caution »** — the money flows out once everything above has flowed in. Same
visual grammar as the notes block (title + total chip + entry-point button + collapsible history):

```
Remboursements                                    (−24,00 €)
                                        [ + Nouveau remboursement ]
  Voir l'historique (1 remboursement)
  ── 14/08/2026 · Virement · −24,00 €                        [🗑]
     Petit-déjeuner × 2 …………………………………… −24,00 €
     « Départ anticipé — petits-déjeuners non pris »
```

Empty state: the block renders with the button only, no total chip, no history link.

### Dialogue « Nouveau remboursement » (`RefundDialog`)

1. **Prestations facturées** — one row per refundable line: checkbox, label, `Facturé 72,00 €` /
   `Déjà remboursé 0,00 €`, and an amount field prefilled at the full `refundableTtc`, editable,
   capped client-side as a UX hint (the server is the authority). Options priced per unit also show a
   quantity stepper that drives the amount (`qty × unitPrice`). *(2026-10-18, rule 37: the amount is
   a text field accepting « 12,5 », « Max X € » shows under it from the start, and a typed amount that
   is not a whole number of units shows « Montant libre » instead of the stepper.)* *(2026-11-01, rule 46: money a
   cancellation requalified reads « · requalifié X € », apart from « déjà remboursé ».)*
2. **Autre ligne** — « + Ajouter une ligne libre » : libellé + montant + catégorie
   (Hébergement / Prestation complémentaire / Activité / Taxe de séjour), default « Prestation
   complémentaire ».
3. **Date du remboursement** — `DateField`, default today, future dates refused.
4. **Moyen** — radio: « Virement » (default) / « Espèces » / « Caisse interne », the last one with the
   caption « hors comptabilité » (same wording as the existing caisse-interne choices).
5. **Motif** (optionnel) — free text, e.g. « Départ anticipé — petits-déjeuners non pris ».
6. **Total remboursé : −24,00 €** at the bottom, live.
7. Caption warning (not a block) when the total exceeds what has actually been collected so far:
   « Ce remboursement dépasse le montant encaissé à ce jour. » *(2026-10-18, rule 37: it now reads
   « Dépasse l'encaissé de X € » on one line right above the save button, where a blocking refusal —
   « <ligne> : dépasse le remboursable de X € », « Montant illisible. » — shows too.)* *(2026-11-05,
   rule 50: a block on « Virement » and « Espèces », still a warning on « Caisse interne ».)* *(2026-11-05, rule 51: on those
   two means a line carries the server's `availableTtc`: at 0 its checkbox is disabled and its caption ends « Rien d'encaissé sur
   cette ligne. », otherwise the pre-filled amount and « Max » are that figure. « Caisse interne » reopens the line; going back to
   a book means with the line ticked blocks the save with « <ligne> : rien d'encaissé sur cette ligne. ». Mobile: same content,
   in the full-screen dialog.)*
8. Validation errors from the server (`REFUND_EXCEEDS_LINE` / `REFUND_EXCEEDS_STAY` / `REFUND_EXCEEDS_COLLECTED` / `REFUND_EXCEEDS_LINE_COLLECTED`) surface as an
   `ErrorAlert` inside the dialog, the dialog stays open with the input preserved.

Deleting a refund goes through `ConfirmDialog`: « Supprimer ce remboursement ? L'écriture d'avoir
correspondante disparaîtra de l'export comptable. »

### Page Comptabilité

The refund card sits in the month's journal, chronologically, with a « Remboursement » chip and the
inverted reading (crédit compte client / débits 70xxx + TVA). The « équilibré » indicator applies
unchanged. The CSV gains the same rows — no new column.

### Responsive behavior (mandatory)

- **`xs` (≤600px):** `RefundDialog` is `fullScreen`. Each refundable line stacks (label on one row,
  `Facturé / Déjà remboursé` caption below, amount field full-width). The means radio stacks
  vertically. The history rows in `FinanceSection` wrap: date + means on one line, amount right-
  aligned below, delete icon ≥44×44.
- **`md` (~900px):** dialog back to a standard `sm` modal, each line on one row (label · caption ·
  qty · amount), means radios inline.
- **`lg` (≥1200px):** identical to `md`; the fiche block sits in the existing finance column with no
  layout change.
- No horizontal scroll anywhere; the Comptabilité journal keeps its existing contained scroll.

### Sticky action bar

No new page — the fiche's existing `PageActionBar` is untouched (a refund is a section-level action,
like « Nouvelle note », not a page-level one).

## 7. Test plan

### Server unit tests (38 new — full suite 2421 ✅)
- [x] `tests/live-refund-per-line.unit.test.js` (18) — rule 51 (D15). `tests/untick-with-open-refund.unit.test.js` (24),
      `plugins/online-payment/tests/reconciliation-undo-open-refund.unit.test.js` (4) — rule 52.
      `plugins/accounting-export/tests/cancelled-register-plan-and-eos-lines.unit.test.js` (11) — rule 49 readings N5, N6 and D15's
      give-back. Client: `RefundDialog.line-collected.test.jsx` (6). The auditor's unheld lines (R23-S3):
      `complement-split-stamped-on-every-flip` (+5), `cancelled-register-complement-no-split` (+2), `removed-line-contribs` (+4),
      `platform-added-guests-tourist-tax-books` (+1).
- [x] `tests/trop-percu-refund-books.unit.test.js` (1) — rule 36: 465,60 € paid, 6 → 2 adults, 409
      `OVERPAID` 110,40 € (options 96 + taxe 14,40), forced save keeps the paid solde at 465,60 €, the
      refund of the two lines → journal client account 355,20 €, 46710000 7,20 € with no negative
      line, « Encaissé » and the stay's total 355,20 €, live quote « Total perçu » 355,20 € and
      trop-perçu 0, even with a stale 355,20 € solde sent by the browser.
- [x] `tests/platform-paid-solde-follows-statement.unit.test.js` (3) — rule 38: Abracadaroom 600 €
      paid, corrected to 450 € → saved without 409, solde 450 €; `overpaymentOf` 0 on a platform row,
      150 € on a direct one; the engine keeps a direct paid solde only.
- [x] `tests/kept-money-priced-closes-trop-percu.unit.test.js` (1) — rule 39: 465,60 € paid, 6 → 2
      adults, the 96 € of breakfasts kept as a free line → trop-perçu 14,40 €, tax only.
- [x] `tests/refunds-utils.unit.test.js` — `buildRefundableLines` (accommodation derivation, offered
      lines excluded, `refundedTtc` accumulation, clamp to 0 after a line shrinks), per-key cap,
      global cap, amount/date validation, HT/VAT split incl. `touristTax` at rate 0 (rules 7–14).
- [x] `tests/refunds-model.unit.test.js` — header+lines created in one transaction, `totalTtc` =
      Σ lines, `totalsByReservation` book vs with-cash split, delete cascade, reservation delete
      cascade (rules 1–6, 19).
- [x] `tests/accounting-refunds.unit.test.js` — one `refund` entry per non-internal refund in
      the right month; rows balanced (Σ débits == Σ crédits) with the residue on the last debit;
      credit on `C<NOM>`, debits on 70xxx/44571xx/46710000; no commission line on a platform
      reservation; `internal` refunds absent from both CSV and structured preview (rules 21–26).
- [x] `tests/finance-refunds.unit.test.js` — `totalSejour` and `comptaCollected` net of book
      refunds, unchanged by an `internal` refund; `remainingToPay` / `isSettled` untouched
      (rules 16–19).
- [x] `tests/finance-refunds.unit.test.js` (moteur) — `sejourNetTotal` net of refunds, every other quote figure
      byte-identical to the no-refund run (rule 17).
- [x] `tests/tourist-tax-refund-declaration.unit.test.js` — per-night refundable line, server-derived
      quantity, `refundedTouristTax` across means, night + adult-nights + amount deducted from the row,
      the per-property recap and the totals, caisse interne included, a fully-refunded stay leaving the
      declaration, a sub-night refund changing nothing, `net + retiré = brut` (rules 27–33).
- [x] `tests/reception-role-allowlist.unit.test.js` (existing drift test) — still red-flags the new
      refund paths as admin-only (rule 15).

Round 22 (2026-11-05): `live-refund-above-collected` (6, rule 50), `plugins/accounting-export/tests/cancelled-register-complement-before-solde` (10, rule 49 reading), `cancelled-register-lowered-line` (5, rule 49 reading), `cancelled-register-complement-no-split` (10, the same readings on a complement with no split, as every production complement has today); `refunds-model` and `refund-exceeds-overpayment` reviewed: their stubs now hold a paid solde, the assertions unchanged.

### Client tests (`npx vitest run` — 15 new, full suite 820 ✅)
- [x] `RefundDialog.test.jsx` — line selection drives the total, free line adds up, future date
      refused, server error rendered inline.
- [x] `FinanceSection.refunds.test.jsx` — block hidden-when-empty, total, history, delete flow.
- [x] `RefundDialog.test.jsx` — the tourist-tax line announces its unit and refunds by night.
- [x] `TouristTaxPage.test.jsx` — the refunded-night annotation, absent when nothing was refunded.
- [x] `RefundDialog.amount-input.test.jsx` (5) — rule 37: ceiling before typing, 45 € on 28 € → no
      « 6.43 », « Montant libre », refusal by the button; « 12,5 » sent as 12,50 €; 14 € → stepper 2;
      « abc » → « Montant illisible. ».

### Manual UI verification
- [x] Happy path: the trigger case end-to-end — full payment collected, refund 2 breakfasts by
      transfer, check the fiche total, the Suivi financier card, the journal preview and the CSV.
- [x] Edge case: caisse-interne refund → visible on the fiche, absent from `/comptabilite`.
- [x] Taxe de séjour: refund one night on a 2-night stay → « Taxe de séjour » page shows 1 night,
      2 adultes-nuits, the halved amount and the annotation; totals and per-property recap follow.
- [x] Edge case: over-cap refund → 409 surfaced in the dialog, nothing persisted.
- [x] Regression: a reservation with mid-stay notes + end-of-stay complement keeps its exact previous
      figures with no refund recorded.
- [x] Mobile (`xs`): dialog fullscreen, history readable, no horizontal scroll.
- [x] `npm run test:e2e` (Playwright) green — 45 passed, 1 skipped.

**Audit 2026-10-27:** `tests/platform-acompte-paid-follows-statement.unit.test.js` (3, rule 40).
**Audit R13-M1 (2026-11-01):** `tests/installment-cancellation-buckets.unit.test.js` (5 of 9, rules 45–47) — the
register after a plan's cancellation (requalified, not refunded); a bucket amount spread pro rata, clamped,
beside a per-key refund; the largest-remainder spread of 0,10 € over 0,03 × 4 + 0,01 €; a one-line-per-bucket
`retained` avoir booked byte for byte as the per-bucket split, two lines on one bucket split each.
`client/src/components/reservation/__tests__/RefundDialog.requalified.test.jsx` (3, rule 46) — « requalifié »,
both parts on one line, a line without requalification unchanged.
**Audit R14 (2026-11-02):** `tests/cancelled-stay-refund-from-indemnity.unit.test.js` (6, rule 48) — a cancelled
plan offers the 2 060 € collected, never the unpaid remainder; 500 € refunded → 706 / 4457 / 4671 at 0, 75880000
−1 560, client account 1 560; above the collected refused (line and free); caisse interne refused on the
indemnity; a retained acompte refunded 200 € → 706 / 4457 at 0, 75880000 −74; a paid solde keeps its 706 + VAT
refund, the 60 € beyond it off the indemnity. `tests/reservation-ledger-retained-avoir.unit.test.js` (4, rule 46
reading of 2026-11-02) — « Acompte conservé » / « Échéances conservées », « Rendu sur l'indemnité », no raw code.
**Review of #925 (2026-11-02):** `tests/cancelled-stay-refund-from-indemnity.unit.test.js` grows to 10 — at a 20 %
indemnity rate, 1 030 + 1 030 € given back net every account to 0; after the paid solde went back in caisse
interne, a free 274 € line is stored `indemnity` and 75880000 nets to 0; refusals read « 2 060,00 € »; the kept
acompte's card carries `indemnityRefundedTtc` 500. `tests/vat-franchise-indemnity-refund.unit.test.js` (2) — an
indemnity refund lowers the franchise turnover at face value, a mixed one splits. `tests/vat-regime-switch-indemnity-lines.unit.test.js`
(2) — a switch and its undo leave an `indemnity` line at 0 %. `client/src/components/__tests__/CancellationCompensationsSection.indemnity-refunds.test.jsx`
(2) — the reopen warning, and its absence when no refund touched the card.
`tests/vat-regime-golden.unit.test.js` — `fiche/109` regenerated: a cancelled stay that collected nothing offers no line.
**Round 15 (2026-11-02):** `tests/refund-before-cancellation.unit.test.js` (6 of 22, rule 49) — after a free line on
a cancelled plan the lines add up to the 1 537,45 € left and asking for all of them is accepted; after 2 050 € the
tax line offers the 10 € left and a refusal names 10,00 €, never the 12 € it once held; with a paid solde and a 32 €
line paid at arrival (no contribs) the lines add up to the 914 € collected, that line is not offered, and asking for
all of them is accepted; with contribs, the lines offer 714 + 200 + 12 € and every 706 sub-account nets to 0.
Second review of PR #926: on the #22226 shape, giving back one line's sale part leaves the others' offer unchanged
and never takes the indemnity; a legacy stay with a paid solde offers all 364,15 € collected and ends at 0.
**Audit R15 follow-up (2026-11-02):** `tests/cancelled-stay-refund-deletion.unit.test.js` (9, rule 6 reading) — the
retained avoir refused (409 `REFUND_RETAINED_AVOIR`, « L'indemnité d'annulation ne se supprime pas. »); a book and a
caisse-interne refund made after the cancellation deleted, their money offered again; a refund made before a
cancellation that kept nothing refused (`REFUND_BEFORE_CANCELLATION`), even within the same second; the ledger offers
« Supprimer » on the later refund and on a caisse-interne refund made before, never on a netted one nor the avoir;
review of PR #929 — a stay paid in full (#22306 shape): its pre-cancellation refund deleted by the API and offered
on the fiche; `afterCancellation` 0 / 1 recorded; with no avoir, the flag orders a refund of the cancellation's own
second, a NULL flag reads the clock; a caisse-interne refund made before the cancellation offered and deleted.
`tests/cancelled-stay-caisse-interne.unit.test.js` (6, rule 48 reading) — P1: a caisse-interne acompte goes back in
caisse interne only (`REFUND_CASH_ONLY_IN_CASH` by transfer), the books untouched; P2: a caisse-interne solde is
offered beside the indemnity (914 €), given back in caisse interne, the rest refused there, the indemnity by
transfer, every book account at 0; a caisse-interne refund beyond the cash collected comes off the book money; the
caisse-interne budget is shared between refunds; review of PR #929 (F4) — cash collected on no line (an end-of-stay
complement) is neither offered nor counted in `collectedTtc`. `tests/cancelled-stay-withheld-commission.unit.test.js`
(9, rule 48 reading) — the indemnity never offers the commissions withheld (265,78 € of a 274 € acompte), giving
everything back leaves 75880000 at −commission and 622600 at +commission, every other book account at 0; the avoir
row reads « Acompte et commission conservés » when it adds the solde's commission (F3).
`tests/cancelled-stay-refunded-solde-commission.unit.test.js` (6, review of PR #929, F1) — 640 / 630 / 620,80 / 300 €
of the solde refunded before the cancellation: the solde commission requalified is 0 / 10 / 19,20 / 19,20 €, the
avoir and the card agree, and everything given back leaves 706, 4457, 4671 and the client at 0, 75880000 at −27,42 €,
622600 at +27,42 €; the commission lands on the buckets that still hold solde money; the #22226 shape, its solde
refunded before, at −6,82 / +6,82 €.
`client/src/components/reservation/__tests__/FinanceSection.cancelled-refund-delete.test.jsx` (3) — on a cancelled
fiche « Supprimer » is drawn outside the fieldset and deletes the refund; « Acompte conservé » offers none; a
duplicate set aside none.

## 8. Out of scope

- **Cancelling a whole reservation / global cancellation policy** — a refund here is partial and
  manual; nothing computes « what should be refunded » from a policy.
- **Automating the bank transfer** (Qonto payout API): the operator makes the transfer themselves and
  records it. Only the bookkeeping is in scope.
- **Reissuing the devis/facture PDF** with the avoir on it.
- **Refunds initiated from the SAS de départ** (decision 2026-08-10: fiche only for now).
- **Switching a paid direct stay to a platform** — not a supported use case (decision 2026-10-29): see `reservation-save-keeps-pricing.md` §8.
- **A month-close lock** preventing the deletion of a refund already exported.
- **Refund of a platform commission** or any platform-side money flow.
- **Refunding accommodation does not change the declared « Montant hébergement HT »** (the tax base of
  the percentage modes). Only the tourist-tax line drives the declaration — a separate rule, deliberately
  not bundled here.

## 9. Open questions

- **Resolved 2026-08-10** — where does the « encaissé » figure behind the dialog's over-refund caption
  come from? `financeModel.comptaCollected` was moved to `utils/reservationSettlement.js` and reused
  as-is, rather than re-deriving the number in the refunds controller: one authority, no drift.
- Q: Should an avoir carry its own `Pièce` number once the accountant provides a numbering scheme?
  - A: Deferred — the whole export leaves `Pièce` empty today
    ([accountant-accounting-export.md](accountant-accounting-export.md) §3.4 rule 13b); refunds join
    whatever scheme lands there.
