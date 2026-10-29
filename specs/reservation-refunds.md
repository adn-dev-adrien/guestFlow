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
- **Refund recorded before the money is fully collected** (allowed, rules 10–11 are the only caps):
  the fiche's « reste à payer » is unaffected; the dialog surfaces a warning caption, not a block.
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
45. **A paid direct stay cannot switch to a platform (Adrien, 2026-10-29, audit R4 N6).** The channel change is refused
    while the acompte or the solde is ticked (`reservation-save-keeps-pricing.md` rule 19), so it never produces a
    trop-perçu, a frozen solde or a refund prompt. Rule 38 is unchanged for a stay already on a platform.

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
Errors: `{ error, code }` with the codes of rules 10–13.
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
  FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reservation_refund_lines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  refundId  INTEGER NOT NULL,
  lineKey   TEXT,                                  -- 'accommodation' | 'opt:<id>' | 'res:<id>' | 'custom:<label>' | 'touristTax' | NULL (free line)
  label     TEXT NOT NULL,
  bucket    TEXT NOT NULL,                         -- 'accommodation' | 'options' | 'resources' | 'touristTax'
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
   is not a whole number of units shows « Montant libre » instead of the stepper.)*
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
   « <ligne> : dépasse le remboursable de X € », « Montant illisible. » — shows too.)*
8. Validation errors from the server (`REFUND_EXCEEDS_LINE` / `REFUND_EXCEEDS_STAY`) surface as an
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

## 8. Out of scope

- **Cancelling a whole reservation / global cancellation policy** — a refund here is partial and
  manual; nothing computes « what should be refunded » from a policy.
- **Automating the bank transfer** (Qonto payout API): the operator makes the transfer themselves and
  records it. Only the bookkeeping is in scope.
- **Reissuing the devis/facture PDF** with the avoir on it.
- **Refunds initiated from the SAS de départ** (decision 2026-08-10: fiche only for now).
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
