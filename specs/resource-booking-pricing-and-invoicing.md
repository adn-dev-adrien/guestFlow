# Resource bookings outside a stay — priced like a fiche, offered time, Qonto invoice

| Field | Value |
|---|---|
| **Status** | Implemented (2026-11-09) |
| **Branch** | `feature/resource-booking-invoicing` (from `inte/plugins`) |
| **Created** | 2026-11-09 |
| **Author** | Adrien |
| **Related PR** | (link once opened) — target `inte/plugins` |
| **Plugins** | `hourly-resources` (owner), `online-payment` (Qonto issuer), `accounting-export` (journal) |
| **Builds on** | [`plugins-phase-3c-hourly-resources.md`](plugins-phase-3c-hourly-resources.md), [`resource-supplements-total-server-side.md`](resource-supplements-total-server-side.md), [`resource-hourly-scheduling.md`](resource-hourly-scheduling.md), [`qonto-bank-reconciliation.md`](qonto-bank-reconciliation.md), [`accountant-accounting-export.md`](accountant-accounting-export.md) |
| **Summary for decision** | [`docs/specs/2026-11-09-resource-booking-invoicing.html`](../docs/specs/2026-11-09-resource-booking-invoicing.html) |

---

## 1. Context

The owner's request (2026-11-09): « Dans Calendrier puis Ressources, on peut ajouter une réservation […].
Pour les clients qui ne viennent que pour la ressource, comme le bain nordique, je veux qu'on affiche
un système de calcul du prix comme pour la fiche de résa, et qu'on puisse offrir du temps
supplémentaire. Il faut aussi faire le système de facturation associé car ils vont nous payer par CB
et il faudra le justifier à la comptable. » He also asked that resource management be a plugin,
because some instances will not have it.

Map measured on `inte/plugins` at ad4dff66:

| Topic | What exists | What is missing |
|---|---|---|
| Plugin | `hourly-resources` 1.3.7 already owns Calendrier › Ressources, the external bookings (`resource_bookings`), the sessions, the SAS step and the `per_hour` price type (phase 3c). With the plugin off, none of it is shown. The resource catalogue (baby bed…) stays core: those are stay options. | Nothing structural. This spec only checks again that every new surface sits behind the plugin. |
| Price | `bookingsModel.breakdownOf` prices a booking on the server (day/evening bands, external rate pair, property free minutes). `POST /api/resource-bookings/preview` answers it. | The dialog renders it as **one line** (« 18:00 → 20:00 · 2h · 60 € »). No breakdown, no VAT, no payment block. |
| Offered time | `freeMinutes` per property (`property_resource_prices`) only. | A walk-in guest has no property, so 0 free minutes, and nothing lets the operator offer time case by case. |
| Payment | One boolean `paid`. | No method, no date, no amount collected. |
| Invoice | None. GuestFlow issues quotes (devis) only; the accounting export's « Pièce » column is empty. | Everything. |
| Accounting | `accounting-export` journals stays only. | `resource_bookings` never reach the journal. The plugin's own erase warning already says « encaissés, absents de la compta ». |
| Qonto | `qontoClient` can create clients and client invoices (`createClientInvoice`, used by the control plane), and read transactions. The reconciliation reads the on-site card batch `Paiements-En-Personne-<dd-mm-yyyy>` (rule 31) and leaves its unallocated remainder alone. The OAuth scopes are `offline_access organization.read payment_link.read payment_link.write webhook`. | No `client.write`, `client_invoice.*`, `attachment.write`. Nothing uploads to a transaction (`POST /v2/transactions/{id}/attachments` exists in the Qonto API). |

Decisions of 2026-11-09 (questionnaire):
- **D1 — payment:** card on site through Qonto's in-person payment (TPE / Tap to Pay). The money arrives
  in the day's batch `Paiements-En-Personne-<date>`, one credit for every card payment of the day.
- **D2 — invoice issuer:** Qonto's invoicing module. Qonto numbers, renders and keeps the invoice;
  GuestFlow never numbers an invoice.
- **D3 — offered time:** the booked slot stays as booked; the operator enters « dont N min offertes ».
- **D4 — accounting:** paid standalone bookings join the accounting export, with the Qonto invoice
  number as « Pièce ».

Owner's review of the summary (2026-11-09, second pass):
- **A1** — one VAT rate for resource sales to guests **without a lodging reservation**: 20 % today, and
  it may change → a setting, never a constant.
- **A2** — an invoice cancelled by hand in Qonto unfreezes the booking.
- **A3** — offered time by steps of **15 minutes**.
- **A4** — the journal takes the payments recorded **from the install on**; past « Payé » rows stay out.
- The billing address is **optional**: the operator can go on without it, as long as Qonto accepts it.
- The postcode field accepts **digits only**, and typing it lists the matching communes.
- The guest may **pay on arrival**: booking and payment are two moments.
- **Cash follows the fiches** (mixed-method-payments D2): caisse interne by default, switch to put it on
  the books, and the same code — `paymentTenders` on the server, `TenderLines` on the client (rule 11).
- A resource-only guest gets **one arrival SAS**, the moment he pays. It holds the payment and a recap
  of his resource time, nothing else (rules 28–33).

## 2. Goal

From Calendrier › Ressources, the operator books a walk-in guest on the bath, sees the price built line
by line as on a fiche, offers some of the time, records the card payment, and the invoice appears in
Qonto, numbered, attached to the day's card credit, and in the accountant's journal — without re-typing
anything anywhere.

## 3. Functional rules

Rules are numbered once and never renumbered (new rules go at the end).

### 3.A Plugin boundary

1. **Everything here belongs to plugins.** The price breakdown, offered time, payment block and
   invoicing live in `hourly-resources`. The Qonto issuing lives in `online-payment`. The journal rows
   live in `accounting-export`. The core only gains two inert SDK contracts (rules 20 and 27). With
   `hourly-resources` off, no screen, route, job or journal row of this spec exists.
2. **No hard dependency between the three plugins.** `hourly-resources` does not `require`
   `online-payment`:
   - Qonto live (plugin `online-payment` live **and** connected with the new scopes): the invoice block is
     offered.
   - Otherwise the block shows « Facturation Qonto non connectée » with a link to Réglages → Intégrations,
     and payment is still recorded (method, date, amount). An invoice can be issued later from the
     booking, once Qonto is connected.
   - `accounting-export` off: no journal rows, nothing else changes.

### 3.B Price breakdown (server)

3. **One function prices a booking**: `breakdownOf` (existing). Its answer gains `lines` and `vat`;
   the preview and the stored total keep coming from it (resource-supplements rule 1).
4. **The lines**, in order, each `{ key, label, detail, amount }`:
   - one line per band (`day`, `evening`) : « Jour · 18:00–20:00 », detail « 2 h × 50,00 € », amount;
   - « Offert par le logement » (the property's free minutes, existing), negative;
   - « Temps offert » (rule 7), negative;
   - nothing for a band of 0 minutes.
   The lines add up to `total` to the cent; the last money line takes the rounding remainder, as
   `roundedBands` already does.
5. **VAT is shown, never re-computed by the client.** `vat = { rate, amount, net }`:
   - a booking **without** `reservationId` (a guest with no lodging reservation) takes the plugin
     setting « TVA des ventes hors séjour » (`hourly-resources` plugin settings, default **20 %**,
     editable in Réglages › Intégrations › « Ressources à l'heure », A1);
   - a booking linked to a stay keeps the instance's rate (single-vat-rate);
   - with VAT off for the instance (vat-optional-mode), `vat` is `null` and the summary says
     « TVA non applicable », whatever the setting.
   The rate is frozen on the booking when it is invoiced (rule 15): changing the setting later never
   moves an issued invoice, and the preview of a non-invoiced booking follows the new rate. Since 2026-11-09 the rate
   is frozen earlier, at the payment (rule 35): only an unpaid booking's preview follows the setting.
6. **External vs guest rates** keep their current rule: no `reservationId` → external rate pair.
   The breakdown names the grid: « Tarif extérieur » or « Tarif client du séjour ».

### 3.C Offered time

7. **`offeredMinutes`** on a booking: 0 by default, a multiple of **15 minutes** (A3), at most the booking's duration minus the property's free minutes already applied.
   Offered minutes are deducted **after** the property's free minutes, from the start of the slot,
   priced on the band they fall in (same slot walk as `priceSessions`).
8. **The slot does not grow.** The planning blocks the booked range only; offered time never
   changes occupancy, turnover or conflicts.
9. Refusals (server, French): « Temps offert invalide : par tranche de 15 min. » (not a non-negative
   multiple of 15),
   « Le temps offert dépasse la durée réservée. » (rule 7 cap). The preview gives the same refusals.
10. An offered amount of 100 % is allowed: total 0 €, no invoice is offered (rule 13), the booking is
    still on the planning.

### 3.D Payment

11. **A booking records one payment, through the fiches' tender code** (decision of 2026-11-09:
    « on suit exactement la même chose, dans l'idéal du code commun »): the lines are validated by
    `paymentTenders.validateSettlement` (core, already exposed to plugins) against the booking's total,
    and typed with the shared `TenderLines` component. Same methods (`card`, `cash`, `cheque`,
    `transfer`, `holidayVoucher`, `other`), same « Plusieurs moyens », same **caisse interne** switch on a
    cash line, **on by default** (mixed-method-payments D2). Stored: `paymentTenders` (JSON lines),
    `paidAt` (date, default today in Europe/Paris). Paying is **not part of booking**: the dialog offers « À l'arrivée » (default) or
    « Maintenant ». « À l'arrivée » records nothing; the payment is then taken in the arrival SAS
    (rule 28), or later from the booking. `paid` becomes derived (`paidAt IS NOT NULL`) and keeps its JSON field for the
    existing planning cards and reception view.
12. Recording a payment on a 0 € booking is refused (« Rien à encaisser. »). Un-recording a payment
    is allowed until an invoice is issued.

### 3.E Invoice (Qonto)

13. **When an invoice is offered**: a booking with `total > 0`, a payment recorded **entirely on the
    books** (no caisse-interne line), and Qonto live (rule 2). The dialog proposes « Créer la facture »
    checked by default when a line is `card`, unchecked otherwise (D1: card is what has to be justified).
    A payment with a caisse-interne line offers no invoice: « Caisse interne : hors comptabilité. »
14. **Issuing** (`POST /api/resource-bookings/:id/invoice`), server only:
    - the guest identity: last name (required), first name, and the billing address (street,
      postcode, city), **all optional** beyond the last name (rule 25). For a registered client, taken
      from the client record; for an « extérieur », typed in the dialog or the arrival SAS. GuestFlow
      sends what it has;
    - a Qonto client is created once per GuestFlow client (the id an earlier invoice of that client stored on its
      booking is reused, for the same name and address only, rule 50) or once per external booking;
    - Qonto takes each line **excluding VAT** and adds the VAT itself: every line goes back to its HT, and the largest
      moves by a cent until the totals Qonto computes, line by line, add up to the TTC charged (Q3);
    - one invoice item per breakdown money line, the negative lines as one discount item (or a
      negative line if Qonto accepts it — Q3), VAT rate of rule 5, `issue_date` = `paidAt`,
      `performance_start/end_date` = booking date;
    - `expectedTotalCents` = booking total: the existing money guard cancels the invoice in Qonto and
      refuses if Qonto's total differs (« Le total calculé par Qonto diffère : facture annulée. »);
    - idempotency key `resource-booking:<id>:invoice:<attempt>`: a retried click never makes two invoices;
    - the invoice is then marked paid in Qonto when the API allows it (Q4); otherwise it stays
      « à payer » in Qonto until matched there, which the summary states.
15. **Stored on the booking**: `qontoInvoiceId`, `invoiceNumber`, `invoiceIssuedAt`, `invoiceVatRate`,
    `invoiceTotal`. From then on the booking is **frozen**: date, times, offered minutes, client,
    property and payment can no longer change (« Facturée : à annuler dans Qonto avant de modifier. »)
    and delete is refused. Notes stay editable.
16. **No GuestFlow numbering.** The number shown is Qonto's. A failed issue leaves no number and no
    frozen booking.

### 3.F Attaching the invoice to the card credit

17. **Card payments only.** For an invoiced booking with a `card` line, the plugin `online-payment` looks for
    the transaction whose reference is `Paiements-En-Personne-<dd-mm-yyyy of paidAt>` (the matcher of
    reconciliation rule 31 already parses it) and uploads the invoice PDF to it
    (`POST /v2/transactions/{id}/attachments`, multipart, idempotency key per booking).
18. **When**: right after issuing if the batch is already there, else by the existing hourly
    transactions poll, for 7 days. After 7 days the booking shows « Pièce non rattachée » with
    « Réessayer » and « Choisir la transaction ». No silent give-up.
19. **Several invoices, one credit**: each invoice of the day is attached to the same batch credit.
    The attachment state (`pending | attached | failed`, transaction id, attempt count, last error) is
    stored per booking. Re-attaching never uploads twice (stored transaction id + Qonto attachment id).
20. **The batch counts them.** Reconciliation rule 31 counts the card part of the day's standalone sales
    first, through a new core contract `ctx.standaloneSales(list)` (a plugin lists its sales `{ key, date,
    totalCents, booksCents, cardCents, label, client, vatRate, invoiceNumber }`): the fiches of the day
    are matched against what they leave, and the proposal's reason says « dont N ventes hors séjour
    (X €) ». No fiche is written for them; the remainder is still never a gap.

### 3.G Accounting export

21. Each paid standalone booking becomes one sales entry on its `paidAt` day **for its on-the-books
    part** (total minus the caisse-interne lines, exactly as a fiche's settlement; nothing when it is all
    caisse interne), read through `standaloneSales`: debit the client account (existing auxiliary format, derived from
    the guest's name for an extérieur too — corrected 2026-11-09, audit R35-M-L5: this rule said « EXT », the code and its
    test never did), credit `70601000` ACTIVITÉS DIVERSES (net) and the VAT account of its frozen rate.
    The offered time is not journaled (the net already excludes it).
22. « Pièce » = the Qonto invoice number when there is one, empty otherwise (unchanged elsewhere).
23. The synthesis reads the same month stream as the CSV, so these sales appear under the account
    « Activité diverse » (70601000) with the other resource revenue — no second derivation.

### 3.I Billing address (2026-11-09, second pass)

25. **Never blocking on GuestFlow's side.** The address is optional: « Enregistrer », « Enregistrer et
    facturer » and « Valider l'arrivée » never wait for it. If Qonto refuses the client or the invoice
    for a missing address (Q2), the refusal is shown where the invoice is (« Qonto demande l'adresse de
    facturation pour émettre la facture. »), the address fields open, the **payment stays recorded**,
    the booking is not frozen, and « Créer la facture » stays offered. Nothing else is lost.
26. **Postcode: digits only.** The field keeps digits and stops at 5 (the existing `ClientFormFields`
    rule). The server refuses any other shape (« Code postal : 5 chiffres. »). An empty postcode is
    allowed (rule 25).
27. **The city is picked, not typed.** From 2 digits on, the field lists the communes of that
    postcode (same source as the client form: `geo.api.gouv.fr/communes?codePostal=`, debounced 250 ms);
    with exactly one commune at 5 digits, it is filled in. Free typing stays possible (lookup down,
    commune not listed); the list is a help, never a check. The lookup moves out of `ClientsPage` and
    `ReservationPage` into one core hook, `usePostalCodeCities`, exposed to plugins by the client SDK.

### 3.J Arrival SAS of a resource-only guest (2026-11-09, second pass)

28. **Who gets it.** A booking without `reservationId` (no lodging reservation). A booking linked to a
    stay never does: its stay's SAS covers it. It is offered from the booking's card in Calendrier ›
    Ressources and from its planning card (« Arrivée »), on its day only — the server refuses another day (409
    ARRIVAL_NOT_TODAY « Arrivée : le jour de la séance seulement. ») unless the arrival is already recorded (rule 32), and
    the card and the dialog offer « Arrivée » on that day only (2026-11-09, audit R35-C-L4). It belongs to
    `hourly-resources` and works with the plugin `sas` off.
29. **One screen, no departure SAS.** It holds, in this order:
    - **Sa séance**: date, slot, duration, the price lines of rule 4 and the total;
    - **Temps offert**: the 15-minute stepper (rule 7), adjustable at the counter (a late start, a
      gesture). The slot itself is never changed here (Q10);
    - **Paiement**: the method chips, or « Pas maintenant »;
    - **Facture**: « Créer la facture dans Qonto » (rule 13) and the optional billing address (rules
      25–27).
    Nothing else: no checklist, no rules to accept, no inventory.
30. **Commit** (`POST /api/resource-bookings/:id/arrival`), one transaction: stores `arrivedAt`, the
    offered minutes, the payment; then issues the invoice if asked (outside the transaction: a Qonto
    failure leaves the arrival and the payment recorded, rule 25).
31. « Pas maintenant » stores the arrival only: the booking stays « À encaisser » on the planning, in
    warning colour, until paid from the booking.
32. **Re-opening** an arrived booking shows the same screen filled in. Once invoiced, it is read-only
    (rule 15) except the notes.
33. **Phone:** full screen, the total sticky at the top, the primary action « Valider l'arrivée »
    filled, last, at the bottom under the thumb (StepperPage / SAS rule).

### 3.K Round 35 audit (2026-11-09)

34. **A paid or invoiced booking is a sale: no delete takes it** (R35-C-M2, R35-DB-M1, R35-DB-M2). `DELETE
    /api/resource-bookings/:id` on a paid booking → 409 BOOKING_PAID « Payée : retirer d'abord le paiement enregistré. »
    (the invoiced one keeps rule 15's refusal); the dialog's « Supprimer » is disabled on it and asks a confirmation
    otherwise. A resource, forced or not, is refused while one of its bookings is paid or carries a live invoice (409
    RESOURCE_CARRIES_MONEY « Une séance payée ou facturée utilise cette ressource : retirer d'abord son paiement. »;
    `getDeleteImpact.saleBlocker`, the screen refuses before asking); a client or a property alike (their deletion
    blocker, 409 …_CARRIES_MONEY). A client booked on a resource, paid or not, is no orphan of the cleanup (preview, by
    ids, bulk). The core reads the plugin table only when present (`utils/deletionGuard.bookingMoneyBlocker`).
35. **The VAT rate is frozen with the payment** (R35-DB-M3 = R35-M-M1; extends rule 5). `recordPayment` stores the rate
    in force (`paidVatRate`, NULL = not subject), `clearPayment` clears it. The journal (`standaloneSales`), the invoice
    lines and the preview of a paid booking read it; a later change of the setting or of a VAT period never re-books a
    paid sale. Migration `resource_bookings_v3` freezes the bookings paid before it at the rate in force at install (the
    rate they were journaled with until then), an invoiced one at its invoice's rate.
36. **A paid booking keeps the total its payment covers** (R35-M-L1). An edit that moves no priced input (date, times,
    offered minutes, property, stay) — notes, client, address — saves at the stored total whatever the tariff now; a
    priced move that changes the total keeps rule 12's 409 BOOKING_PAID. The invoice of a booking whose live breakdown no
    longer adds up to the paid total is refused before any Qonto call: 409 TARIFF_CHANGED « Le tarif a changé depuis le
    paiement : facture à établir dans Qonto. ».
    Once its payment is taken back (« Retirer le paiement »), the booking is unpaid and priced like any other: its next
    save stores the live total, even when nothing priced moved (2026-11-09, audit R35b N2, accepted). It is never silent:
    the dialog's preview and its payment fields already show that total before the save, the save warns when the shown and
    stored totals differ, and the payment must then cover the new total. To correct only the method after a tariff change,
    the operator re-records at the amount shown, or invoices by hand in Qonto.
37. **`paid` is the truth of a payment** (R35-DB-L1). Every write of this release sets `paid` with the payment columns;
    the planning, the payload, the guards and the journal read `paid = 1`. A release before 1.4.0 (rollback window)
    unticks with `paid = 0` only: after the roll-forward the booking reads unpaid and leaves the journal (self-update rule
    39, accepted exception).
38. **A numbered invoice is never lost** (R35-EXT-1). « Marquer payée » (Q4) is optional: any failure after Qonto numbered
    the invoice leaves `markedPaid: false, markPending: true`; the invoice is stored and the booking frozen as usual, so a
    second click never makes a second invoice. The hourly job retries it (issuer member `markPaid`, optional in the
    contract) until Qonto says paid; 404/405/501 is final (« à payer » in Qonto). Column `invoiceMarkPending`.
39. **Qonto idempotency keys are UUIDs** (R35-EXT-2, R35-M-L3), hashed from the caller's key and what the request
    depends on (the control plane's rule): the client key covers the name and the billing address, the invoice key the
    Qonto client, the attachment key the booking and the transaction. The address typed after « Qonto demande l'adresse »
    makes a new client and a new invoice key; a retry of the same request replays.
40. **The HT lines always land on the TTC charged** (R35-EXT-3 = R35-M-L4 = R35-S1; amends rule 14's « the largest moves
    by a cent »). Every line goes back to its HT and any line may move by up to 3 cents, the fewest cents off each line's
    own price winning, until the per-line rounded totals add up to the total charged; a set no move reaches (a single
    line whose TTC falls between two roundings) gets one « Arrondi de TVA » line of 1–2 cents HT; when even that cannot
    reach it, ISSUER_AMOUNT_UNREACHABLE (422) « Total impossible à facturer au centime près : facture à établir dans
    Qonto. » before any call. The money guard of rule 14 still checks Qonto's own total.
41. **A registered client's address is his record's** (R35-M-L2): `streetNumber street` (else `address`), `postalCode`,
    `city`; the booking's billing fields serve an « extérieur » only.
42. **The invoice PDF is read like every Qonto call** (R35-EXT-4, R35-INJ-L1): its signed URL must be `https:`
    (ATTACHMENT_URL_REFUSED otherwise, nothing fetched) and the download runs within the client's timeout, aborted past
    it; a timeout leaves the attachment `pending` for the job.
43. **A « Payé » with no method is refused as such** (R35-M-L5): invoicing a booking ticked before 1.4.0 → 400 NO_METHOD
    « Moyen de paiement non saisi : retirer le paiement puis l'enregistrer à nouveau. », never « Caisse interne ».
44. **The booking's money actions in its dialogs** (R35-C-M1, R35-C-L1/L2/L3/L5/L6):
    - « Retirer le paiement » on a paid, non-invoiced booking (confirmation « Retirer le paiement ? »), calling `DELETE
      /:id/payment`; the dialog then shows the booking unpaid without losing what is typed;
    - « Créer la facture » on a payment on the books with no invoice or a cancelled one (A2), in both dialogs;
    - an invoiced booking's « Réessayer » / « Choisir la transaction » work in both dialogs, a refusal is shown; its
      date, times, client switch, client fields and logement are read-only;
    - the payment is paid whole (`TenderLines whole`: no reste, no geste — §8);
    - a payment refused after the booking is created is shown under the payment; the next click edits that booking,
      never creates it again; from then on the dialog previews it as itself (`bookingId` of the created booking) and its
      own slot never counts as taken when the slot is moved (2026-11-09, audit R35b N3);
    - the planning reloads after the dialog's last step (payment, invoice);
    - a guest who paid at booking time gets « Valider l'arrivée » on his day, posting no payment.
45. **No invoice without the operator's choice** (2026-11-09, audit R35b N1; reading of rule 13). A Qonto invoice is made
    only by an explicit action: the box « Créer la facture dans Qonto » ticked (rule 13: ticked by default on a card
    payment typed in the dialog, unticked otherwise) or the button « Créer la facture ». « Valider l'arrivée » of a guest
    who paid at booking time records the arrival with `invoice: false`; the invoice block's « Créer la facture » records
    the arrival then asks the invoice. Server side, `POST /:id/arrival` issues only on `invoice: true`, and an `invoice`
    that is not a boolean is refused before anything is written (400 « Facture : oui ou non. »); recording a payment,
    editing a booking and the hourly job never issue one.

### 3.L Round 36 audit (2026-11-10)

46. **A booking takes no stay link** (R36-DB-L2). No screen links a booking to a stay, and money recorded on such a
    link was booked nowhere (`standaloneSales` skips it, the stay's books never read `resource_bookings`), then booked
    late as a « VENTE HORS SÉJOUR » once the stay was deleted. `reservationId` sent in a create or an update (other than
    the stored value sent back) → 400 `BOOKING_STAY_LINK` « Séance hors séjour : aucune réservation à lier. », nothing
    written; a row stored with a link (legacy) takes no payment: 409 `BOOKING_HAS_STAY` « Cette séance appartient à un
    séjour : son paiement est celui du séjour. », as its arrival already was.
47. **The attachment never waits on « marquer payée »** (R36-EXT-1, reading of rule 38). The hourly job retries the mark
    and joins the PDF in two separate steps: a mark Qonto keeps refusing (403, 422, 5xx) no longer skips the
    attachment of a card credit that landed after the issue, so rule 18's 7-day cutoff applies again. The mark is
    retried for 7 days after the issue (`invoiceIssuedAt`), then given up: `invoiceMarkPending` cleared, the invoice
    left « à payer » in Qonto, as a 404/405/501 already was; Qonto is no longer called for it every hour.
48. **The folded lines keep their sign** (R36-EXT-2, reading of rules 40 and Q3). The fallback sent after Qonto refused a
    negative discount line leaves out a band the discount covers whole (never a 0 € line), moves the cents on the
    positive lines only, never below 1 cent HT, and its « Arrondi de TVA » line is positive; nothing reachable leaves the
    existing `ISSUER_AMOUNT_UNREACHABLE` refusal. The main path keeps each line's sign too (a band never 0 € or below, the
    discount never 0 €). The description of a band left out is not carried over (accepted: the invoice states the
    other band and its own share of the discount).
49. **Every client cleanup keeps a buyer of a session** (R36-DB-M1 = R36-RES-L1, reading of rule 34). The logement
    delete (clients of its stays left with no reservation) and the two iCal sync cleanups (clients created by an import,
    « Ical » placeholders) share the orphan popup's condition, `utils/deletionGuard.noResourceBookingSql`: a client a
    resource booking names, paid or not, on any logement or none, is kept, and his booking keeps him. *Why:* a logement
    deleted with an unpaid stay of a client who had paid and invoiced a 50 € session: the client was deleted, the
    session's buyer became « VENTE HORS SÉJOUR » and a later invoice went to « Client » with no address.
50. **A Qonto client is reused only for the identity it was created with** (R37-EXT-1, reading of rules 39 and 41). Each
    invoiced booking stores, beside its Qonto client, a digest of the name and billing address that client was created
    with (`qontoClientIdentity`, migration `resource_bookings_v4`). An invoice reuses the booking's own Qonto client (a
    re-issue) or, for a registered client, the one an earlier invoice of his made, only when the identity it would
    send is that same one; otherwise it creates a Qonto client with what the record (or the booking's typed address)
    now holds, under rule 39's key. A booking invoiced before the migration (no digest) is never reused: the next
    invoice creates one. *Why:* a client invoiced once with no address, his address then filled on his record: every
    later invoice went to the first Qonto client, with no address, and only an edit in Qonto by hand fixed it.

### 3.M Pricing refonte (2026-11-12)

51. **The free hour is worth the day rate, for new bookings only** (owner, 2026-11-12; `pricing-components` rules 24, 37 and 83). A booking
    created, or whose slot or party the operator moves, values the lodging's free minutes at the day rate of the grid (external or guest);
    a booking stored before keeps the valuation it was sold with (`freeHourAtDayRate` NULL) until the operator moves it. The offered
    minutes (rule 7) still keep the band they fall in. Edge case: an unpaid booking saved without moving its slot is still priced again
    (rule 36 reading), with the valuation it already has.

**Edge cases:**
- Booking edited before payment → priced again, as today.
- Two card payments of the bath on the same day + a card payment of a stay → one batch; three rows
  proposed against it; two invoices attached.
- Card payment recorded on a day without batch (refund, Qonto delay) → rule 18.
- Qonto invoice cancelled in Qonto by hand → next read marks the booking « Facture annulée dans Qonto »
  and unfreezes it (Q5).
- Plugin `online-payment` deactivated after invoices exist → numbers and states stay readable; nothing
  is retried.
- Erase of `hourly-resources` → the warning lists the invoiced bookings (« N factures Qonto émises :
  elles restent dans Qonto »). Nothing is cancelled in Qonto.

---

## 4. Architecture

> Fat backend, thin frontend: every amount, line, VAT figure, freeze and refusal comes from the server.
> The dialog renders the answer and keeps the draft only.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| plugin | `plugins/hourly-resources/migrations.js` | T | `resource_bookings_v2`: `offeredMinutes`, `paymentTenders`, `paidAt`, invoice and attachment columns, client billing address of an external booking; backfill `paidAt` from `paid = 1` (`updatedAt` date). |
| plugin | `plugins/hourly-resources/bookingPricing.js` | C | Pure: lines, offered time, VAT of a booking (extracted from `breakdownOf`). |
| plugin | `plugins/hourly-resources/bookingsModel.js` | T | Calls `bookingPricing`; offered time refusals; payment through `sdk.coreModule('paymentTenders').validateSettlement`; freeze; delete guard. |
| plugin | `plugins/hourly-resources/invoicing.js` | C | Builds the invoice request from a frozen breakdown; asks the issuer; stores the result. |
| plugin | `plugins/hourly-resources/controller.js`, `routes.js` | T | `POST /:id/payment`, `DELETE /:id/payment`, `POST /:id/arrival`, `POST /:id/invoice`, `POST /:id/invoice/attach`. |
| plugin | `plugins/hourly-resources/settings.js` | C | « TVA des ventes hors séjour » (default 20 %), validated 0–100. |
| plugin | `plugins/hourly-resources/index.js` | T | Registers `standaloneSales`; erase warning counts invoices. |
| plugin | `plugins/online-payment/invoiceIssuer.js` | C | Implements the `invoiceIssuer` contract on Qonto: client, invoice, mark paid, PDF, attachment. |
| plugin | `plugins/online-payment/reconciliation/matcher.js` | T | Rule 20: batch candidates include standalone card sales. |
| plugin | `plugins/hourly-resources/index.js` (job) | T | Rule 18, A2: an hourly `resource-invoices-watch` job retries pending attachments and frees bookings whose invoice was cancelled in Qonto. |
| plugin | `plugins/accounting-export/accountingModel.js`, `controller.js`, `accountingExport.js` | T | Rules 21–23: `standaloneSalesByMonth`, the month stream, `standaloneEntryToRows` (synthesis unchanged: it reads the stream). |
| core | `plugins/sdk/index.js`, `utils/invoiceIssuers.js`, `utils/standaloneSales.js` | T/C | Two contracts: `ctx.invoiceIssuer(issuer)` (at most one, live only) and `ctx.standaloneSales(provider)`. Inert without plugins. SDK minor bump. |
| core | `utils/qonto/qontoClient.js` | T | `INVOICING_SCOPES` + `uploadTransactionAttachment` (multipart), `markClientInvoicePaid` (404 → unsupported, Q4), `getClientInvoicePdf`, `createIndividualClient`. |
| core | `utils/qonto/qontoService.js` | T | Origin label « facture d'une vente hors séjour » (`invoicing`). |
| plugin | `plugins/online-payment/index.js` | T | Declares the issuer; the consent asks `INVOICING_SCOPES` too. |
| plugin | `plugins/online-payment/reconciliation/controller.js` | T | Hands `standaloneSales` to the matcher (rule 20). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| plugin | `plugins/hourly-resources/ResourceBookingDialog.jsx` | T | Two-column layout kept; the summary becomes `ResourceBookingSummary`; adds offered time, payment and invoice blocks. |
| plugin | `plugins/hourly-resources/ResourceBookingSummary.jsx` | C | Renders `lines`, VAT and total of the preview. Specific: tied to the booking payload. |
| plugin | `plugins/hourly-resources/OfferedTimeField.jsx` | C | Stepper by 15 min; shows the server's refusal. |
| plugin | `plugins/hourly-resources/BookingPaymentFields.jsx` | C | `TenderLines` (one CB line of the total by default) + payment date. |
| plugin | `plugins/hourly-resources/SettingsSection.jsx` | C | « TVA des ventes hors séjour » card of Réglages › Intégrations. |
| plugin | `plugins/hourly-resources/PlanningResourceCard.jsx` | T | « À encaisser » chip and « Arrivée » button on a booking outside a stay. |
| plugin | `plugins/hourly-resources/BookingInvoiceBlock.jsx` | C | Invoice state, number, attachment state, retry. |
| component | `components/TenderLines` (via client SDK) | — | Consumed as is for the payment (rule 11); no fork. |
| plugin | `plugins/hourly-resources/ResourcePlanningPage.jsx` | T | Card of a booking shows « Payé CB · F-2026-0142 » / « À encaisser » and « Arrivée ». |
| plugin | `plugins/hourly-resources/ResourceArrivalDialog.jsx` | C | Rules 28–33: the one-screen arrival SAS (recap, offered time, payment, invoice). |
| plugin | `plugins/hourly-resources/BillingAddressFields.jsx` | C | Optional street / postcode (digits) / city picked from the list. |
| hook | `hooks/usePostalCodeCities.js` | C | Generic: communes of a postcode (debounced, abortable). Replaces the two copies in `ClientsPage` and `ReservationPage`; exported by the client SDK. |
| page | `pages/ClientsPage.jsx`, `pages/ReservationPage.jsx` | T | Use the hook; no behaviour change. |
| component | `components/StatusBadge` | — | Consumed for invoice and attachment states. |

**Component reuse:** consumed `FormDialog` conventions, `StatusBadge`, `ConfirmDialog`, the quantity
stepper of the fiche (`reservation-quantity-stepper`). Created specific: the three plugin components
above (they render one payload, no second use foreseen). The fiche's price summary is not reused as is:
it renders a reservation quote, not a booking breakdown; the visual rhythm (label · detail · amount,
total on its own row) is copied.

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/api/resource-bookings/preview` | `+ offeredMinutes` | `+ lines[], vat, offeredMinutesApplied` | Same refusals as the commit. |
| POST/PUT | `/api/resource-bookings[/:id]` | `+ offeredMinutes`, `+ billing` (external) | unchanged | 409 `BOOKING_INVOICED` when frozen. |
| POST | `/api/resource-bookings/:id/payment` | `{ tenders: [{ method, amountCents, internal }], paidAt }` | booking | 400 with `validateSettlement`'s refusals. |
| DELETE | `/api/resource-bookings/:id/payment` | — | booking | 409 when invoiced. |
| POST | `/api/resource-bookings/:id/arrival` | `{ offeredMinutes, payment: { tenders, paidAt } \| null, invoice: bool, billing? }` | `{ booking, invoice: { ok, number? , refusal? } }` | Rules 30–31; 400 when `invoice` is not a boolean, issues only on `true` (rule 45). |
| POST | `/api/resource-bookings/:id/invoice` | `{ billing? }` | `{ invoiceNumber, attachment }` | 409 `ISSUER_UNAVAILABLE`, 422 `QONTO_NEEDS_ADDRESS`, 502 Qonto. |
| POST | `/api/resource-bookings/:id/invoice/attach` | `{ transactionId? }` | `{ attachment }` | Retry or manual choice. |

---

## 5. Data model

`resource_bookings` (plugin migration `resource_bookings_v2`, idempotent `ADD COLUMN`, 22 columns — corrected
2026-11-09, audit R35-DB-L2): `offeredMinutes INTEGER NOT NULL DEFAULT 0`, `paymentTenders TEXT` (JSON lines), `paidAt
TEXT`, `paymentRecordedAt TEXT`, `arrivedAt TEXT`, `billingStreet/Postcode/City TEXT`, `billingCountry TEXT` (created,
never written: Qonto gets `FR`), `qontoClientId TEXT`, `qontoInvoiceId TEXT`, `invoiceNumber TEXT`, `invoiceIssuedAt TEXT`,
`invoiceVatRate REAL`, `invoiceTotal REAL`, `invoiceMarkedPaid INTEGER NOT NULL DEFAULT 0`, `invoiceCancelledAt TEXT`
(A2: unfreezes), `attachmentState TEXT`, `attachmentTransactionId TEXT`, `attachmentId TEXT`, `attachmentAttempts INTEGER
NOT NULL DEFAULT 0`, `attachmentLastError TEXT`. No billing name column: the name is `clientName` or the client record.
Migration `resource_bookings_v3` (2026-11-09): `paidVatRate REAL` (rule 35, NULL = not subject), `invoiceMarkPending
INTEGER NOT NULL DEFAULT 0` (rule 38).
Migration `resource_bookings_v4` (2026-11-10): `qontoClientIdentity TEXT` (rule 50, NULL on rows invoiced before: their
Qonto client is not reused).
Migration `resource_bookings_v5` (2026-11-12): `freeHourAtDayRate INTEGER` (rule 51: NULL on rows priced before, 1 on rows priced on the
one hourly grid).
`clients` is not touched: the Qonto client of a registered guest is read back from his earlier invoiced booking.

**Data impact:** existing rows keep their price (`offeredMinutes = 0`). `paid = 1` rows get
`paidAt = date(updatedAt)` and `paymentTenders = NULL` (« Moyen non saisi »). They stay out of the
journal (A4): `standaloneSales` lists only payments recorded after the migration (`paymentRecordedAt`
set by rule 11, never backfilled). The erase of `hourly-resources` drops the columns with the table.
No invoice is ever created for a past booking without a click.

## 6. UI / UX

See the interactive summary. In short, the dialog keeps its two zones (planner left, form right):
- **Prix** (top right, sticky on a phone): the lines of rule 4, « Temps offert » with its stepper
  inline, a hairline, « Total TTC », « dont TVA 10 % » in secondary text.
- **Client**: « Client enregistré » switch as today; an extérieur gets « Adresse de facturation »
  folded, unfolded automatically when « Créer la facture » is checked.
- **Encaissement**: method chips (CB, Espèces, Chèque, Virement, Chèques-vacances, Autre), date.
- **Facture**: « Créer la facture dans Qonto » (checked by default on CB); after issue, « Facture
  F-2026-0142 · Pièce jointe au lot CB du 09/11 » or « En attente du lot CB du 09/11 ».
- Save button: « Enregistrer » / « Enregistrer et facturer ».
- Frozen booking: fields read-only with « Facturée — à annuler dans Qonto avant de modifier. »
- **xs**: full screen (existing), price block first and sticky, chips wrap, buttons full width.
  **md/lg**: two columns, 240 px planner.

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `plugins/hourly-resources/tests/booking-pricing-lines.unit.test.js` — rules 3–6
- [x] `…/booking-offered-time.unit.test.js` — rules 7–10
- [x] `…/booking-payment.unit.test.js` — rules 11–12
- [x] `…/booking-arrival.unit.test.js` — rules 28–33
- [x] `…/booking-billing-address.unit.test.js` — rules 25–26 (address optional, postcode shape, Qonto refusal keeps the payment)
- [x] `…/booking-vat-standalone.unit.test.js` — rules 5, 21, 35 on a core database (20 % setting, stay-linked booking, VAT
  off, rate frozen at payment, a split payment's books part, the v3 backfill). The line was ticked before the file existed;
  written 2026-11-09 (audit R35-S2).
- [x] `…/booking-paid-sale-guards.unit.test.js` — rules 34, 36, 37
- [x] `…/booking-invoice-numbered-kept.unit.test.js` — rules 38, 41, 43
- [x] `…/booking-arrival-day.unit.test.js` — rules 28, 32
- [x] `…/booking-invoice-explicit.unit.test.js` — rule 45
- [x] `…/booking-payment-taken-back.unit.test.js` — rule 36 (re-priced after « Retirer le paiement »)
- [x] `…/hourly-erase-journaled-sales.unit.test.js` — rule 21 (erase warning)
- [x] `…/booking-stay-link-refused.unit.test.js` (3, 2026-11-10) — rule 46
- [x] `…/booking-invoice-attach-without-mark.unit.test.js` (4, 2026-11-10) — rule 47 (mark refused 403/422/500, the
  batch lands, the PDF joined; given up after 7 days)
- [x] `tests/client-cleanup-keeps-resource-buyer.unit.test.js` (5, 2026-11-10) — rule 49 (logement delete, iCal import
  clients, placeholders, no plugin table; verification R36b L2: a real sync pass, `syncSourceAndRecord` with a stubbed
  fetch, keeps the iCal client and the placeholder a booking names and drops the ones with nothing)
- [x] `plugins/online-payment/tests/invoice-issuer-folded-signs.unit.test.js` (5, 2026-11-10) — rule 48 (the auditor's
  382 347-case sweep, discount equal to the larger then the smaller band, main path signs)
- [x] `plugins/online-payment/tests/invoice-issuer-cent-signs.unit.test.js` (4, 2026-11-10, verification R36b L3) — rule
  48 where the guard binds, on lines of a few cents: 1 c + 3 c at 20 % (main path), 1 c + 4 c with 1 c offered (folded),
  a charged total below what the positive lines reach (null), and every cent-level case of both paths: every non-discount
  line ≥ 1 cent HT, the discount ≤ −1 cent, Qonto's total exact
- [x] `tests/resource-booking-sale-deletes.unit.test.js` — rule 34 (resource, client, property, orphans)
- [x] `plugins/online-payment/tests/invoice-issuer-mark-paid-optional.unit.test.js` — rule 38
- [x] `…/invoice-issuer-idempotency-keys.unit.test.js` — rule 39
- [x] `…/invoice-issuer-ht-rounding.unit.test.js` — rule 40
- [x] `…/qonto-invoice-pdf-timeout.unit.test.js` — rule 42
- [x] `…/booking-invoice.unit.test.js` — rules 13–16 (fake issuer)
- [x] `plugins/online-payment/tests/invoice-issuer-qonto.unit.test.js` — rules 14, 17–19 (fake Qonto)
- [x] `plugins/online-payment/tests/reconciliation-standalone-sales.unit.test.js` — rule 20
- [x] `plugins/accounting-export/tests/standalone-sales-journal.unit.test.js` — rules 21–23
- [x] `tests/plugin-boundary-invoicing.unit.test.js` — rules 1–2 (plugins off)

### Client
- [x] Vitest per subject: `OfferedTimeField`, `BillingAddressFields`, `BookingInvoiceBlock`, `ResourceArrivalDialog`,
  `PlanningResourceCard` (rule 28), `ResourceBookingDialog.preview` (rules 4–5), `resourceBookingDraft` (rule 7),
  `hooks/__tests__/usePostalCodeCities` (rule 27), `ResourceBookingDialog.paid-actions`, `ResourceBookingDialog.payment-refused`,
  `ResourceArrivalDialog.paid-before` (rules 28, 34, 44), `ResourceArrivalDialog.no-unasked-invoice` (rules 13, 45),
  `ResourceBookingDialog.created-id` (rule 44).

### Manual UI verification
- [ ] Walk-in, 2 h across the evening switch, 30 min offered, CB, invoice → lines add up, number shown.
- [ ] Qonto sandbox: invoice created, PDF attached to a sandbox transaction (Q1–Q4 measured).
- [ ] Plugin `online-payment` off → « Facturation Qonto non connectée », payment still recorded.
- [ ] Mobile 375 px: sticky price, chips wrap, no horizontal scroll; arrival SAS full screen, action under the thumb.
- [ ] Booked « À l'arrivée » by phone, then arrival SAS on the day: +15 min offered, CB, invoice without address.
- [ ] Postcode 07200 → communes listed; letters ignored; lookup offline → free typing still works.
- [ ] Regression: SAS sessions and fiche `per_hour` lines unchanged; E2E suite.

## 8. Out of scope

- Invoices for stays (the fiche) — this spec only builds the issuer contract they could reuse later.
- Several payment methods on one booking (mixed-method-payments is for fiches).
- Credit notes (avoirs): a paid invoice is corrected in Qonto by hand.
- Selling a bath through the public website or by payment link.
- Hourly resources other than `per_hour` + scheduled (unchanged pricing).

## 9. Open questions

- **Q1** — VAT rate of the bath. **Resolved 2026-11-09 (A1):** a plugin setting for sales without a
  lodging reservation, 20 % by default, frozen per invoice (rule 5).
- **Q2** — Does Qonto create an `individual` client and invoice it without a postal address? Measure in
  sandbox. Either way GuestFlow never blocks on it (rule 25); only the refusal path depends on it.
- **Q3** — Negative invoice line vs discount: which one Qonto accepts on a client invoice. Both handled: a
  negative line first, the discount folded into the lines when Qonto refuses it. Still to measure: whether Qonto
  rounds the VAT per line (assumed) or on the total — a mismatch cancels the invoice (rule 14), it never invoices
  a wrong amount.
- **Q4** — Can the API mark a client invoice paid (`mark_as_paid` is not documented)? If not, the
  invoice stays « à payer » in Qonto until matched there by hand. Whatever it answers, it never loses the numbered
  invoice (rule 38, 2026-11-09).
- **Q5** — Invoice cancelled in Qonto. **Resolved 2026-11-09 (A2):** the booking is unfrozen and shows
  « Facture annulée dans Qonto ».
- **Q6** — New OAuth scopes force a Qonto reconnection in Réglages → Intégrations once, in prod.
- **Q7** — Step of the offered time. **Resolved 2026-11-09 (A3):** 15 minutes.
- **Q8** — Bookings already « Payé ». **Resolved 2026-11-09 (A4):** journal from the install on.
- **Q9** — Default of « Paiement » when booking. **Resolved 2026-11-09:** « À l'arrivée » (rule 11).
- **Q10** — May the arrival SAS also change the slot? **Resolved 2026-11-09:** no. The SAS only adjusts
  the offered time (rule 29); the slot is changed from the booking, where the planner checks conflicts.

## 10. Implementation progress

- 2026-11-09 — implemented on `feature/resource-booking-invoicing` (from `inte/plugins`):
  - core: SDK 2.25.0 (`ctx.invoiceIssuer`, `ctx.standaloneSales`, core modules `invoiceIssuers`, `standaloneSales`),
    Qonto client invoicing calls and scopes, `usePostalCodeCities` hook (ClientsPage and ReservationPage use it);
  - plugins: `hourly-resources` 1.4.0, `online-payment` 1.7.0, `accounting-export` 1.2.0;
  - tests: 12 new server files (63 tests), 6 new client files + 4 updated; route, job and SDK censuses updated.
- 2026-11-09 — audit round 35 (`fix/audit-r35-resources`): rules 34–44; `hourly-resources` 1.4.2, `online-payment` 1.7.2;
  migration `resource_bookings_v3`; 10 new server files, 3 new client files + 2 updated.
- 2026-11-09 — audit round 35b (same branch): rule 45 (no invoice without the operator's choice), rule 36 note (re-priced
  after « Retirer le paiement »), rule 44 (created booking previewed as itself); 2 new server files, 2 new client files +
  1 updated.
- Not verifiable without Qonto: Q2–Q4 and the real upload are coded for both outcomes and covered with stubs; they
  are measured in the Qonto sandbox before the first real invoice, then Qonto is reconnected once in production (Q6).

