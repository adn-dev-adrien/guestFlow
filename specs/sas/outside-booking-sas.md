# Mini SAS of an outside client — session, extras, what is left to pay

| Field | Value |
|---|---|
| **Status** | Implemented — every rule is delivered on `feature/pricing-components-c` (the server C33-C37, the screens C38); approved 2026-11-12 (owner, Q1-Q9, §9). The manual checks of §7 that need a connected Qonto or a reception account wait for the shadow trial |
| **Branch** | delivered on `feature/pricing-components-c` (pricing-components **PR C**, its external-sale part, Q9 B) |
| **Created** | 2026-11-12 |
| **Author** | Adrien |
| **Related PR** | pricing-components PR C (#1054) — target `master` (`inte/plugins` retired 2026-11-13) |
| **Target release** | 4.2.0, with PR C |
| **Plugins** | `hourly-resources` (owner of the screen, of the session line and of the `resource` suggestion contexts), `online-payment` (Qonto invoice and payment link), `accounting-export` (journal) |
| **Depends on** | [`pricing-components.md`](../pricing/pricing-components.md) **PR B**, then **PR C**, which carries this spec (the external sale: `externalSale` pipeline, `standalone_sales`, the « Passage » client, rules 53, 74); PR B carries (lines, `payment_allocations`, SETTLEMENT on lines, REFUNDS owed, FULFILMENT port and bath adapter, `saleDetail`, `AccountingOutput`) |
| **Builds on** | [`resource-booking-pricing-and-invoicing.md`](../resources/resource-booking-pricing-and-invoicing.md) (rules 28-33: today's one-screen arrival of a resource-only guest), [`mixed-method-payments.md`](../payments/mixed-method-payments.md) (`TenderLines`, `validateSettlement`), [`sas-offer-complement-lines.md`](sas-offer-complement-lines.md) (« Offrir » gesture), [`reception-sas-today-only.md`](reception-sas-today-only.md) (day window), [`reopen-completed-sas.md`](reopen-completed-sas.md), [`payment-link-lifecycle.md`](../payments/payment-link-lifecycle.md) (validity, withdrawal, rules 6, 8, 14, 42), [`no-automatic-email-without-approval.md`](../emails/no-automatic-email-without-approval.md) |
| **Summary for the owner** | [`docs/rapports/2026-11-12-outside-booking-sas.html`](../../docs/rapports/2026-11-12-outside-booking-sas.html) — French, interactive mock (M5); the counter dialog and the catalogue fields: [`docs/rapports/2026-11-13-m4-vente-hors-sejour.html`](../../docs/rapports/2026-11-13-m4-vente-hors-sejour.html) (M4) |

> **Reviewed 2026-11-26 (spec reorganization).** Code paths corrected to the current tree (SAS and accounting export now live under `server/src/plugins/`, `client/src/plugins/sas/`; `.js` components are `.jsx`) and relative links re-based for the folder move.

> Code references point at `docs/outside-booking-sas` = `feature/pricing-components-a` @ `bc5b8f48`. Function names
> are the anchors; line numbers drift. Rule numbers are identities: a later rule is appended, never inserted.

---

## 1. Context

### 1.1 The owner's request (2026-11-12, after testing a 4.0.0 shadow by hand)

> « Pour une réservation de bain nordique d'un client extérieur (sans séjour), un mini sas pour cette
> prestation. À l'accueil il peut y avoir des options à proposer (ex. boissons), et il peut y avoir un montant
> restant à payer. »

Reading kept for this spec: « options à proposer » = articles **suggested for sale** at the counter (drinks,
snacks); the free « Offrir » gesture of the stay SAS applies to them as well (rule 13). « Montant restant à
payer » = what the visit still owes once the session, the extras, the offered lines and the money already taken
are counted.

### 1.2 What exists today (measured on the code)

| Topic | Today | File / function |
|---|---|---|
| Outside booking | a `resource_bookings` row with `reservationId IS NULL` (refused otherwise, rule 46 of the invoicing spec), owned by the `hourly-resources` plugin | `plugins/hourly-resources/migrations.js` `createTables`, `bookingsModel.createBooking` |
| A « mini SAS » | **already exists** as `ResourceArrivalDialog`: one screen with the session and its price lines, the 15-min offered time, the payment (`BookingPaymentFields` → `TenderLines`) or « Pas maintenant », the Qonto invoice | `client/src/plugins/hourly-resources/ResourceArrivalDialog.jsx`; `POST /api/resource-bookings/:id/arrival` → `controller.arrival` → `bookingsModel.recordArrival` |
| Extras (drinks) | **none**: the screen sells only the session. A drink to a walk-in has no path at all in 4.0.0 | — |
| Remaining amount | **none**: the payment is whole (`TenderLines whole`, invoicing rule 44 — « no reste, no geste »); `recordPayment` validates tenders against `totalPrice` with `shortfall: null`, so a partial payment is refused | `bookingsModel.recordPayment` |
| Money storage | on the booking row: `paymentTenders` JSON, `paidAt`, `paid`, `paidVatRate` (rate frozen at payment, rule 35) | `bookingsModel.recordPayment`, `frozenVatOf` |
| Price | `breakdownOf` → `bookingPricing.priceBookingLines` (bands, property free minutes, `offeredMinutes`, VAT via the VAT component) | `bookingsModel.breakdownOf` |
| VAT of an outside client | plugin setting `standaloneVatRate`, 20 % by default | `plugins/hourly-resources/settings.js` |
| Journal and card batch | the plugin lists one sale per paid booking through `ctx.standaloneSales` (single `vatRate`) | `bookingsModel.standaloneSales`, `utils/standaloneSales.js` |
| Day window | strict Paris day (`todayInParis`), 409 `ARRIVAL_NOT_TODAY`; the stay SAS uses `D 00:00 → D+1 04:00` (`utils/sasEditWindow.js`) | `bookingsModel.recordArrival` |
| Reception role | the arrival endpoint is **not** in the plugin's `ctx.reception` list: a reception-only user cannot run it | `plugins/hourly-resources/index.js` (`ctx.reception([...])`) |

### 1.3 Where the refonte stands

`pricing-components.md` already decided everything this feature must sit on, but delivers it in PR B and PR C:
the external sale (rule 53: `externalSale` pipeline, `customerContext = 'external'`, families `fixed` / `per_unit` /
`hourly` only, `sellableExternally`), sale documents with frozen lines and `payment_allocations` (rule 74, with the
anonymous sale on the shared « Passage » client), one « Offert » (rule 14), SETTLEMENT on lines (rule 21), REFUNDS
(rule 72), the VAT component fed by tagged amounts (rules 61-62), `AccountingOutput` (rule 63) and the FULFILMENT
port with the bath adapter (rule 49). The « Vente hors séjour (boissons) » use case of its summary prices a drink at
20 % for an outside client.

What the refonte leaves open, and this spec answers: **how a session booked outside a stay and the drinks sold
around it make one visit** with one remaining amount, one payment and one invoice.

### 1.4 No other spec covers it

`grep -ril "hors séjour\|outside a stay\|resource-only\|sans séjour\|standalone\|mini sas" specs/` (2026-11-12):
`resource-booking-pricing-and-invoicing.md` (the session alone, no extras, whole payment),
`pricing-components.md` (the external sale as a counter dialog on Encaissements, not tied to a booking),
`plugins-phase-3c-hourly-resources.md`, `resource-hourly-scheduling.md`, `resource-ignition-task.md` (planning
and heat-up), `payment-link-lifecycle.md`, `cancellation-compensation.md`, `clients-upcoming-past-directory.md`,
`plugin-operator-provisioning.md`, `plugins-phase-3a-online-payment.md` (mentions only). None defines extras or a
remaining amount for an outside booking.

## 2. Goal

At the counter, on the day of the session, the operator opens the visit of an outside client, sees the session and
its price, adds the drinks the client takes, offers a line when he wants to, takes one or several payments, and
always sees what is left to pay — the same figures in the journal, the card batch and the Qonto invoice, computed
once on the server by the refonte's components.

## 3. Functional rules

### 3.A Scope and boundary

1. **Who gets the mini SAS.** A resource booking with no `reservationId` whose resource is `per_hour` and
   scheduled (today's rule 28 of the invoicing spec). A booking linked to a stay never does (409
   `BOOKING_HAS_STAY`, unchanged): its stay's SAS covers it.
    > **Delivered by PR C** (C37, server): `visitController` refuses a stay-bound booking (409 `BOOKING_HAS_STAY`); test `visit-window-and-roles`.
2. **The screen and the session line belong to `hourly-resources`; the visit's money belongs to the core.** The
   plugin owns the mini SAS screen, its routes, the session line (family `hourly`) and the slot (FULFILMENT
   adapter `hourly-slot`). The sale document, its extras lines, the payments, the allocations, the refunds and the
   journal are the core's external sale (`standalone_sales`, pricing-components rules 53, 74). With
   `hourly-resources` off there is no mini SAS and no `resource` suggestion context; the documents already written stay readable in Encaissements and in
   the journal (they are core rows). With the `sas` plugin off the mini SAS still works (rule 28 of the invoicing
   spec).
    > **Delivered by PR C** (C37, server): `visitModel` / `visitController` (plugin) on the core `standaloneSale`; the documents stay readable with the plugin off; test `plugin-boundary-outside-visit`.
3. **No resource or platform named in code.** Nothing tests « bain », « nordique » or a platform name. What is
   specific to Solio's bath — heat-up, retention, the free hour granted to stays, the evening band — stays in the
   `hourly` family and the plugin's settings. The core sees an article of family `hourly` with a fulfilment ref.
    > **Delivered by PR C** (C37, server): no resource or platform named in the visit's code; test `plugin-boundary-outside-visit`.
4. **One computation of every figure.** The mini SAS never prices, sums, splits VAT or subtracts on the client.
   Lines come from the Articles head (`describe`), VAT from the VAT component, the remaining amount and each
   line's status from SETTLEMENT, refunds owed from REFUNDS, through the `saleDetail` read model extended to a
   standalone document (rule 31 of the refonte). The client renders the payload (CLAUDE.md §6.0).
    > **Delivered by PR C** (C37, server): every figure of the visit payload is `standaloneSale`'s (SETTLEMENT, VAT component, REFUNDS); tests `visit-remaining-and-payment`, `visit-lines`.

### 3.B When it opens

5. **On the session's day window.** The mini SAS commits from `D 00:00` to `D+1 04:00` (Europe/Paris), `D` = the
   booking's `date`, through `sdk.coreModule('sasEditWindow').isWithinSasWindow` — the window of the stay SAS
   (reception-sas-today-only rules 1-2). _(Amends invoicing rule 28's strict Paris day; decided, Q2 A.)_ Outside the
   window: 409 `ARRIVAL_NOT_TODAY` « Arrivée : le jour de la séance seulement. », unless the visit is already
   opened (rule 22).
    > **Delivered by PR C** (C37, server): `visitModel.windowOf` through `sasEditWindow.sasLockReason`; test `visit-window-and-roles`.
6. **Entry points, unchanged.** « Arrivée » on the booking's planning card and in the booking dialog, on its day
   only; no new menu item. The card's chip reads the server's state (rule 21).
    > **Delivered by PR C** (C38): « Arrivée » opens `ResourceArrivalDialog` from the planning card (`?arrival=<id>`, its day only) and from the booking dialog; the card chip is the server's `cardState` (« À encaisser », « Reste 13,00 € », « Payé », « Absent »); tests `PlanningResourceCard.test`, `ResourceArrivalDialog.remaining`.
7. **Roles.** An `admin` may open, commit and reopen at any time once opened. A `reception` user may open and
   commit inside the window of rule 5 and sees door money only (the session lines, the extras, the remaining
   amount; never a refund amount, reception-role-checkin-only rule 12bis). Removing or offering a **paid** line
   and anything that owes a refund is admin only (403 `ADMIN_ONLY` « Remboursement : réservé à l'administrateur. »).
   _(Decided, Q3 A.)_
    > **Delivered by PR C** (C37, server): `visitController.writeRefusal`, 403 `ADMIN_ONLY` on a paid line, a refund confirmation and « Client absent », `refundOwedCents` and the history stripped for the reception; test `visit-window-and-roles`.

### 3.C The client of the visit

8. **The visit is one sale document with one client** (refonte rule 74). The client is the booking's `clientId`
   when the booking names a registered client; otherwise the refonte's rule for a standalone sale applies: an
   anonymous visit goes to the shared « Passage » client; a typed name or e-mail attaches to a client record
   under rule 8a. The booking and its document always name the same client; changing the client
   on the booking changes it on the document in the same transaction, refused once the document is invoiced
   (« Facturée : à annuler dans Qonto avant de modifier. », invoicing rule 15).
    **8a. (Decided, Q4 A.)** The visit is attached to a client record in two cases only: the booking names a
    registered client, or the typed e-mail **exactly matches** (case-insensitive, trimmed) one client's e-mail.
    Otherwise it stays on the shared « Passage » client, whatever name was typed; the name is kept on the document
    for the receipt. A client record is created only when « Enregistrer comme client » is ticked (unticked by
    default; it needs a name). No fuzzy name matching, so no homonym attaches by accident. _(Narrows refonte rule 74
    for this caller.)_
    > _Amended 2026-11-15 (end review R1-3):_ a client a sale names, and the « Passage » client, are never orphans: the client cleanups (orphan
    > popup, property delete, iCal sync — `noResourceBookingSql`) leave them, and their own delete is refused (« Ce client a des ventes hors séjour :
    > suppression impossible. », « Le client « Passage » porte les ventes sans nom : suppression impossible. »). Test `client-deletion-standalone-sales`.
9. **No identity on screen beyond what exists.** The mini SAS shows the booking's `displayName` (as today) and
   never asks a phone or address, except the optional billing address of the invoice (invoicing rules 25-27).
    > **Delivered by PR C** (C38): the dialog shows `displayName` and asks nothing of the client — no phone, no address but the optional billing address of the invoice; the only e-mail field is the one of « Envoyer un lien » (rule 39); tests `ResourceArrivalDialog.test`, `SalePaymentLink.states`.

### 3.D The lines

10. **The visit document holds, in order:** the **session line** (family `hourly`, `fulfilmentRef =
    hourly-slot:<bookingId>`), with its components as `describe` gives them — day band, evening band, the
    property's free minutes, the offered time (« Jour · 18:00–19:00 · 1 h × 30,00 € », « Temps offert · 15 min ·
    −7,50 € ») — then the **extras lines** in sale order. Each line shows label, `quantity × unit`, total, status
    (« Payée », « À payer », « Offerte ») and the VAT rate when VAT applies.
11. **The articles on offer.** The extras picker lists only articles with `sellableExternally = true` (refonte
    rule 53) of a family that needs no stay (`fixed`, `per_unit`); `hourly` is not listed (another session is
    booked from the planning, where conflicts are judged). The articles suggested for the resource's context
    come first as one-tap suggestions through the generic « Proposés à l'arrivée » step (rules 35-38, decided Q5);
    the others are reached by search, grouped by catalogue category. An article of another family answers `NEEDS_STAY` and is never listed.
    > _Amended 2026-11-15 (end review R3-7):_ the « Autre article » search answers grouped by the server (`GET …/visit/articles` →
    > `groups: [{ category, articles }]`, `suggestedArticles.catalogueGroups`); `SuggestedArticlesStep` renders the groups and groups nothing.
    > Tests `suggested-articles-catalogue-groups`, `SuggestedArticlesStep.generic`.
12. **Adding an extra.** A request `{ articleRef, quantity }` is quoted by the `externalSale` pipeline (no nights,
    no tax, no schedule, no clock). Quantity bounds come from the instance's `limits` (default 1 to 99): out of
    bounds → refusal « Quantité : 1 à {max}. ». Before the first commit, the draft groups one article on one line;
    after a line is committed, more of the same article is a **new line** (refonte rule 13), shown grouped
    (« Bière locale — 3 : 1 × 6,50 € + 2 × 6,50 € »). An unpaid, uncommitted draft line can be removed freely.
13. **Offering.** Every line — the session line and each extra — carries « Offrir » / « Offert ». Offered sets the
    line's amount to 0 and keeps its catalogue value struck through (refonte rule 14, the single « Offert »). The
    session also keeps its partial offered time by steps of 15 min (invoicing rule 7), which is a component of the
    session line, priced by the `hourly` family. There is no third mechanism: the tender's « geste commercial »
    shortfall is not offered here (rule 17).
    > **Reading of 2026-11-13 (C37, lead's call).** Once the session line is on the document its offered time is fixed: another
    > `offeredMinutes` answers 409 `SESSION_SOLD` « Séance déjà enregistrée : l’offrir en entier si besoin. », the whole line is offered
    > instead. The session line is never retired alone (409 `SESSION_LINE` « La séance se retire en supprimant la réservation. »): it is
    > offered, or the booking deleted (rule 26). A booking moved while its session line is unpaid gets that line retired and the new price
    > appended, both journaled (edge case « booking moved after the arrival »).
14. **A committed line is frozen** (refonte rule 74): label, quantity, unit price, total, VAT class and rate are
    stored at the moment of sale; a later catalogue or setting change never moves it. An unpaid committed line may
    be removed or offered (journaled); a paid one follows rule 25.

### 3.E The remaining amount and the payment

15. **What is left to pay is SETTLEMENT's answer.** `remainingCents = Σ line totals (offered lines at 0) − Σ
    payment allocations − Σ refund allocations` of the document, computed once by SETTLEMENT on the stored lines
    and returned with every quote and read (`totals: { totalCents, paidCents, remainingCents, refundOwedCents }`).
    The mini SAS shows « Total », « Déjà payé » (when > 0) and « Reste à payer », and nothing else adds up.
16. **Taking a payment.** `TenderLines` on `remainingCents` (core component, through the client SDK), same methods
    as the fiches (`card`, `cash`, `cheque`, `transfer`, `holidayVoucher`, `other`), « Plusieurs moyens », the
    « Caisse interne » switch on cash, on by default (mixed-method-payments D2). The server validates with
    `paymentTenders.validateSettlement({ tenders, dueCents: remainingCents, shortfall })`.
17. **Partial payment is allowed; the gap is always a « reste à percevoir ».** A payment below the remaining
    amount needs the shortfall choice `due` (« Reste à percevoir »); `waived` is refused in the mini SAS
    (« Geste commercial : offrir une ligne. ») because offering is a line property (rule 13). _(Amends invoicing
    rule 44's « no reste ».)_
18. **Over the remaining amount is refused**, the lines kept: « Les moyens font {received} pour {due} dus. »
    (`validateSettlement` rule 6, unchanged). Nothing to collect (`remainingCents = 0`): the payment block reads
    « Rien à encaisser. » and is not offered. A non-numeric or negative amount is refused by `TenderLines` before
    the request (UX hint) and by the server (« Chaque moyen doit avoir un montant. »).
19. **Allocation is SETTLEMENT's, never the screen's.** A payment is allocated to the document's unpaid lines in
    sale order (session line first), each line covered whole before the next, the last one partly
    (`payment_allocations`, refonte rule 74). Several payments on one visit are several allocation sets.
20. **A reste can be collected by a Qonto payment link** (decided 2026-11-12, Q6 B; supersedes the first draft's
    « no link »): the « Envoyer un lien » action, rules 39-42. The counter keeps the card terminal (invoicing D1) for a
    payment taken on the spot; a reste left open is collected later from the booking, the reopened mini SAS or a link.
    > **Delivered by PR C** (C37, server): `POST /:id/visit/payment-link` and its withdraw / e-mail routes; test `visit-remaining-and-payment`.

### 3.F Closing and reopening

21. **« Valider l'arrivée » commits once, in one transaction:** the arrival mark (`arrivedAt`), the draft lines
    (`standaloneSale.sell`, quote = commit: a price that moved since the quote is refused « Prix modifié — relire
    le panier », refonte rule 30), the offered flags, the payment and its allocations; the session's fulfilment is
    confirmed in the same transaction (refonte rule 49). The Qonto invoice is asked after the commit (rule 30 of
    the invoicing spec): its failure never undoes the arrival nor the payment.
22. **A visit closed with a reste stays visible.** The planning card shows « Reste {amount} » (warning) instead of
    « À encaisser », from the server's `remainingCents`; « Payé » once it is 0. The reste is collected from the
    booking dialog or by reopening the mini SAS.
23. **Reopening.** A visit already opened reopens on any day (admin) or within the window (reception, rule 7), on
    the same screen filled from the stored lines. Adding a line appends (rule 12); every change is an explicit
    action of the sale service (append, offer, remove, pay) — never a delete-and-rewrite of the document (unlike
    the stay SAS's replace rule, because here the lines are the truth). Each change is journaled on the document's
    history (« Bière locale ×2 ajoutée », « Limonade offerte », « 12,00 € encaissés : CB »).
24. **An invoiced visit is read-only** but for the notes (invoicing rule 15). An extra sold after the invoice is a
    **new** standalone sale, with its own invoice; the mini SAS says « Facturée : nouvelle vente séparée. » and
    opens it on the same client.

### 3.G Refunds, cancellation, no-show

25. **Lowering a paid line goes through REFUNDS only.** Offering, removing or reducing a line below what its
    allocations cover is refused by default (409 `LINE_PAID` « Ligne payée : remboursement à confirmer. »); with
    the admin's confirmation, REFUNDS writes the refund owed on that line (a negative allocation naming the
    payment it gives back, refonte rules 23, 72, 74) and the screen shows « {amount} à rembourser » from
    `refundOwedCents`. The refund itself is executed through the refonte's refund path (means, date), never typed
    as a negative payment here.
26. **Cancelling an unpaid visit.** Deleting the booking (allowed while nothing is paid, invoicing rule 34) cancels
    its document: unpaid lines `cancelled`, the slot released through the fulfilment port. A visit with money is
    never deleted (409 `BOOKING_PAID`, unchanged).
27. **No-show** (decided, Q7 A). « Client absent », offered from the booking on or after its day, closes the visit without
    arrival: unpaid lines cancelled, the slot kept on the planning as past and marked « Absent », money already
    taken kept as it is; a refund of it is an explicit admin action through rule 25.
    > **Delivered by PR C** (C37, server): `POST /:id/no-show` (admin), `visitModel.noShow`; test `visit-refund-cancel-noshow`.

### 3.H VAT, accounting, invoice, card batch

28. **VAT of an outside client.** Every line of the document is a `TaggedAmount` with `customerContext =
    'external'` and its article's `vatClass`; the VAT component resolves `vat.rate.<vatClass>.external` (the
    session: `resources.external` = today's `standaloneVatRate`, read through the settings provider (the adapter over the plugin's setting) — delivered by PR C, it did not move in PR B; drinks:
    `drinks.external`, 20 % in the refonte's use case). VAT is rounded once per (class, rate) group of the document
    and allocated to its lines (refonte rule 62). Franchise mode: no VAT, « TVA non applicable ».
29. **The rate is frozen on the line at sale** (refonte rule 74), not at payment. A visit opened before a VAT change
    and paid after keeps the rate it was sold at. _(Supersedes invoicing rule 35's freeze-at-payment for the
    bookings whose money lives on a document, rule 34.)_
30. **Accounting through `AccountingOutput` only.** The document, its lines with their VAT output, its payments and
    allocations and its refunds are read models of `AccountingOutput` (refonte rule 63), kind `standalone`. Booking
    rule of today kept: revenue is journaled on each payment day for the allocated, on-the-books part (caisse
    interne excluded, invoicing rule 21), split by `revenue:<vatClass>` and `vat:<rate>`; the account plan maps
    `revenue:resources` to 70601000 as today and `revenue:drinks` to the account set in rule 43 (decided, Q8 A). Offered lines
    are not journaled. No exporter recomputes anything.
31. **One invoice per document, once fully paid on the books.** « Créer la facture dans Qonto » is offered when
    `remainingCents = 0`, the document total > 0 and no caisse-interne line (invoicing rule 13, extended to the
    document). It sends every money line of the document (session components and extras) with the VAT
    component's per-line output; Qonto's total must equal the on-the-books total (money guard, invoicing rules 14,
    40). The invoice and attachment columns move from the booking to the document for the visits of rule 34; the
    issuer contract (`ctx.invoiceIssuer`) is unchanged.
    > **Delivered by PR C** (C37, server): `invoicing.issueDocument`, 409 `REMAINING_DUE`; test `visit-invoice-document`. Reading of 2026-11-13 below.
    > **Reading of 2026-11-13 (C37, lead's call, to confirm by the owner).** The invoice and attachment columns stay on the booking: one
    > booking, one document, one invoice, and the hourly watch (attachment, mark, cancelled in Qonto) keeps working per booking with the
    > issuer contract unchanged; the document's invoice columns are not written. The session's parts go as items at the line's frozen
    > rate, its deductions (free minutes, offered time) as one discount, each extra as one item at its rate; Qonto's total must equal
    > the document's (`expectedTotalCents`). ~~A visit whose session was paid on the booking (rule 34) is invoiced from the booking as
    > before: its extras' document is not invoiced from the visit.~~ (superseded 2026-11-15, below)
    > **Reading of 2026-11-15 (owner).** A visit is ONE invoice. When the session was paid on the booking (rule 34) and the drinks or
    > extras are on the visit's document, the invoice covers the whole visit: the session's parts (from the booking, at the rate frozen
    > with its payment, its deductions as the discount) and every money line of the document, Qonto's total equal to the visit's
    > (session + document). It is issued once everything is settled: the document's reste at 0, the session's own payment naming a
    > method and on the books (`NO_METHOD`, `INTERNAL_CASH`), its tariff unchanged since that payment (`TARIFF_CHANGED`), dated the
    > last payment day. A visit with no document — or a document holding no money line of its own (only offered lines) — keeps the
    > booking's invoice exactly as before. The invoice and attachment columns stay on the booking (one booking, one invoice); the
    > card attachment follows the booking's payment as before. **Delivered by PR C**; test `visit-invoice-whole-visit`.
32. **The card batch counts each visit once.** `ctx.standaloneSales` lists the document's card part per payment
    day from the core `standalone_sales` reader; the plugin's own `bookingsModel.standaloneSales` skips every
    booking whose money is on a document (rule 34), so no session is counted twice.
33. **No tourist tax, no stay figure.** An outside visit has no nights; TOURIST TAX, NIGHTS, SCHEDULE and STAY CLOCK
    are not called (`externalSale` pipeline, refonte rule 52).

### 3.I Bookings that already hold money

34. **Where a booking's money lives.** A booking created or first paid after this release gets its document at
    creation; the booking dialog's « Maintenant » payment is a payment of the document. A booking paid before
    (money on `resource_bookings.paymentTenders`) keeps it there: its mini SAS shows the session as « Payée » from
    the legacy columns (one stay-level legacy allocation, refonte rule 74 backfill) and a new document holds only
    the extras sold from then on. The journal of past months does not move (byte-identical CSV, refonte rule 33).
    > **Delivered by PR C** (C37, server): `visitModel` (`paidElsewhere` for the session paid on the booking); test `visit-legacy-money`. Reading of 2026-11-13 below.
    > **Reading of 2026-11-13 (C37, lead's call, to confirm by the owner).** The document is born at the visit's first write — « Valider
    > l'arrivée », a payment or a link asked from the mini SAS — not at the booking's creation. A payment taken in the booking dialog
    > before any document stays on the booking (the « paid before » branch of this rule, « Retirer le paiement » still offered). A booking
    > with a document takes the booking dialog's payment on the document (its whole reste, `recordPayment` delegates) and refuses
    > « Retirer le paiement » (409 `SALE_PAYMENT` « Paiement de la vente : un remboursement par l’administrateur. »). The plugin's
    > `standaloneSales` lists the money on the booking's own columns only (`paid = 1`): a session paid there before its extras' document
    > is listed once, a document payment never touches those columns (rule 32).

**Edge cases:**
- Everything offered → total 0 €, « Rien à encaisser. », « Valider l'arrivée » still records the arrival; no invoice.
- Session paid at booking time, two beers added at the counter → « Déjà payé 70,00 € », « Reste à payer 13,00 € ».
- Partial card payment with « Reste à percevoir » → card shows « Reste 5,00 € »; the next payment is on 5,00 € only.
- Over-payment typed (60,00 € for 42,00 €) → refused, lines kept, nothing written.
- Quantity 13 on an article limited to 12 → « Quantité : 1 à 12. », the line not added.
- Article removed from the catalogue after a sale → the stored line keeps its label and price; it is no longer
  offered for new lines.
- Booking moved to another time after the arrival → re-priced only while the session line is unpaid; paid →
  409 `BOOKING_PAID` (invoicing rule 36, unchanged).
- Two devices on the same visit → the second commit re-quotes and refuses « Prix modifié — relire le panier » when
  the lines changed underneath (document `version` compared).
- Reception after `D+1 04:00` on an opened visit → read-only, « Arrivée : le jour de la séance seulement. ».
- VAT period changes between sale and payment → the line keeps its sale rate (rule 29).
- `hourly-resources` disabled after visits exist → the documents stay in Encaissements and in the journal; the
  session line renders from its snapshot.
- Client anonymised → one column on the document (refonte rule 74); the lines and the journal keep their amounts.
- Link minted for 13,00 €, then a drink is offered → the link is withdrawn and a new one for the new reste is minted on request (rule 40).
- Link paid after the document was cancelled → booked, whole amount a refund owed, admin alerted (rule 41).
- No e-mail on the visit → « Envoyer un lien » disabled, « Adresse e-mail requise. »; Qonto not connected → action absent (rule 39).
- Export period holding a drink with no account set → refused, nothing written (rule 43).


### 3.J Decisions of 2026-11-12 (appended; rule numbers are identities)

35. **« Proposés à l'arrivée » is a generic SAS step** (decided 2026-11-12, Q5 A, amended by the owner). It is one
    step — « Proposés à l'arrivée » — that shows the articles suggested for a **sale context**, lets the operator add
    them with a quantity, offer them (rule 13) and see the server's refusals. It knows nothing of baths, drinks,
    resources or stays: it renders a `suggestions` payload and posts add / offer / remove requests to the sale it is
    mounted on. The mini SAS mounts it for an outside visit; the stay arrival SAS can mount the same component later
    (rule 38). Its first screen is the suggestion chips; « Autre article » opens the search of rule 11.
    > **Delivered by PR C** (C38; its server C36, C37): `components/SuggestedArticlesStep.jsx`, prop-driven, no resource, stay or plugin wording; the mini SAS mounts it; the « Vente hors séjour » dialog mounts the same component; tests `SuggestedArticlesStep.generic`, `ResourceArrivalDialog.extras`.
36. **A suggested-articles provider keyed by sale context** (server). A **sale context** is `{ kind, id }`. Kinds
    known at this change: `resource` (declared by `hourly-resources`, `id` = the resource id) and `property` (declared
    by the core, `id` = the property id, used by the stay SAS follow-up). The core module `suggestedArticles`
    answers `resolve({ context, customerContext })` → `[{ articleRef, label, unitCents, max }]`, ordered by the
    operator's position and **filtered by sellability for the caller** (`external`: `sellableExternally` and a
    family that needs no stay, rule 11; `hosted`: the article's `validate` against the stay). An article that left the
    catalogue or is no longer sellable for the caller is dropped silently at read time and never from the stored list.
    The resolver is a pure read; it prices nothing (rule 4 stands: the label and unit come from `describe`).
37. **The settings home is generic.** The lists live in a core table `suggested_articles` keyed `(contextKind,
    contextId)`, edited in **Réglages → Options & ressources → « Proposés à l'arrivée »**, one list per context, grouped by kind.
    A plugin supplies the **contexts** of its kind (`ctx.suggestionContexts({ kind, label, list() → [{ id, label }] })`,
    SDK minor bump); `hourly-resources` supplies its resources, so the per-resource list the owner chose is the
    `resource` rows of this generic table, not a setting of the plugin. With the plugin off, its kind and its
    contexts disappear from the page and from `resolve`; the stored rows stay (reappear on re-enable). A list holds at
    most 12 articles, ordered by drag or by the up / down buttons; admin only; writing a reference the catalogue does
    not know answers 400 `ARTICLE_UNKNOWN`.
    > **Amended 2026-11-26** by `specs/site/site-outside-resource-booking.md` §3.H (rules 34-36): the tab is renamed « Options
    > proposées »; a `resource` list is also the « Ajouter à la séance » offer of the site's session page; each context says where it
    > shows (`shownOn`); the picker is a checklist that stays open, greys what the outside customer cannot buy, and the save of such a
    > list refuses an article the engine sells only with a stay (`ARTICLE_NEEDS_STAY`).
38. **Follow-up, out of this spec's scope: the stay arrival SAS gets the same step.** Nothing in the design may
    prevent it: the step is context-driven (rule 35), the resolver already serves `hosted` callers and the `property`
    kind (rule 36), and the settings page lists every kind a provider declares (rule 37). The follow-up spec will only
    mount `SuggestedArticlesStep` in `ReservationSasDialog` and feed it from the SAS sale pipeline; it adds no server
    contract. The test of rule 36 already covers the `hosted` filter so the follow-up cannot break it silently.
39. **« Envoyer un lien » for the reste** (decided 2026-11-12, Q6 B).
    In the Paiement block, beside « Encaisser » / « Pas maintenant », when `remainingCents > 0`.
    Conditions, all read from the server (`paymentLink: { available, reason }` in the visit payload): a payment
    provider is declared and ready (`online-payment` live, Qonto connected) **and** an e-mail is known — the
    client's, or the one typed on the visit. Without a ready provider the action is not shown. Without an e-mail it is
    **shown disabled** with « Adresse e-mail requise. » and an « E-mail » field under it; typing a valid address
    enables it. Admin and reception (inside the window, rule 7) may use it.
    > _Amended 2026-11-15 (end review R3-1, R3-16):_ « Retirer le lien » and « Envoyer par e-mail » are writes of the visit, judged like « Envoyer un
    > lien »: the reception inside the day window only, nobody on a no-show or invoiced visit (409 `ARRIVAL_NOT_TODAY`, `BOOKING_NO_SHOW`,
    > `BOOKING_INVOICED`); a visit that cannot be read answers its own status, never a 500. Test `visit-link-window-and-roles`.
    > _Amended 2026-11-15 (end-review verification V-8):_ « Retirer le lien » only reduces what the visit exposes, so the **administrator**
    > withdraws on any day, a visit with no arrival recorded included (a link minted on the day lives 36 h and could otherwise be withdrawn by
    > nobody the next morning); the reception keeps its day window, and nobody withdraws on a no-show or an invoiced visit. « Envoyer par
    > e-mail » is unchanged.
40. **The link bills the reste, once.** It is minted through the core payment-link path (`ensurePaymentLink`'s
    family: `paymentProviders.declared().createLink`, `paymentLinksModel`, `type = 'complement'`-style explicit
    basket with `basket.source = 'standalone-sale'`, `basket.ref = <saleRef>`), with the document's VAT basket from the
    VAT component. **Its amount is `remainingCents` computed by SETTLEMENT at that moment** (rule 15); the client
    never sends an amount. At most one open link per document: asking again reuses an open link of the same amount,
    and an open link whose amount no longer matches (a line added, offered or removed, a payment taken) is withdrawn
    and replaced (payment-link-lifecycle rule 8 reading). Validity 36 hours (lifecycle rule 6), not the 30 minutes of
    a guest order; the lifecycle pass lapses it. It is withdrawn when the document is cancelled (rules 26-27) and by
    hand with « Retirer le lien » (lifecycle rule 42). Zero or negative reste: 409 `NOTHING_DUE` « Rien à encaisser. ».
    > _Amended 2026-11-15 (end review R2-4, R3-2):_ the withdrawal happens **at the change itself**, not at the next « Envoyer un lien »: every write
    > of the document — a payment taken at the counter or by the visit's mini SAS, a line offered, removed or added, the visit's commit — compares
    > the open link with the new `remainingCents` inside its own transaction and withdraws it (`cancelReason = amount-changed`, a cancelled document
    > `operator`); the provider deactivates it after the commit (`remoteCancelPendingAt`, the poll). A reste paid in full therefore leaves no link
    > to pay twice, and the dialog offers « Envoyer un lien » again only when something is due. Test `standalone-sale-stale-link-withdrawn`.
41. **A link paid after the sas is closed settles the sale.** The link poller's paid effect
    (`applyPaidEffect`, basket branch `standalone-sale`) writes one `standalone_sale_payments` row (method `link`,
    `source = payment-link:<id>`) and its `payment_allocations` through SETTLEMENT, in the same transaction that books
    the link paid: the reste falls to the amount still owed, the planning card turns « Payé », the invoice becomes
    offered (rule 31), and the journal books the payment on its payment day (rule 30). A payment that exceeds what is
    still owed (lines removed or offered meanwhile, document cancelled) is **booked in full and the surplus becomes a
    refund owed** through REFUNDS (rule 25), with an admin alert (lifecycle rule 14 spirit: money received is never
    dropped). A link paid at the deadline follows lifecycle rules 14-15 unchanged.
    > _Amended 2026-11-15 (end review R2-4):_ the surplus is a **durable row**, not only the figure the document computes: one
    > `standalone_sale_obligations` row per paying link (`origin = linkSurplus`, its amount and reason, `open` until the refund is made), listed
    > on the document (`refundObligations`) and on the visit for the administrator only (the reception sees no refund, rule 7). Test
    > `standalone-sale-stale-link-withdrawn`.
    > _Amended 2026-11-15 (end-review verification V-4):_ the row is **shown and closed** like a stay's « À rembourser » row
    > (pricing-components rule 75). Each open row is served with its words (`label` « 13,00 € à rembourser », `detail` = its reason) and
    > `totals.refundUnheldCents` is the part of `refundOwedCents` no row holds (a paid line offered since), so a screen shows the rows and
    > that remainder, never the same euros twice. The mini SAS shows each row as a warning with « Marquer remboursé »; the counter card
    > « Ventes hors séjour · aujourd'hui » lists, above the day, « À rembourser »: the counter's documents of any day with an open row
    > (`GET /api/standalone-sales` → `owed`), each with the same action. The action asks a confirmation, then
    > `PATCH /api/standalone-sales/:id/obligations/:oid { status: 'settled' | 'cancelled' }` (admin only: the reception's allowlist does not
    > reach `/api/standalone-sales`) closes an open row once (400 `OBLIGATION_INVALID_STATUS`, 404 `SALE_NOT_FOUND` / `OBLIGATION_NOT_FOUND`,
    > 409 `OBLIGATION_ALREADY_CLOSED`), writes « 13,00 € remboursés » (or « 13,00 € : rien à rembourser », « 13,00 € gardés en pourboire » for a
    > link surplus since rule 49) in the document's history and answers
    > `{ document, sale, paymentLink }`; a closed row is money resolved outside the document, so `refundOwedCents` stops counting it. The
    > reception's visit payload carries neither the rows nor `refundUnheldCents`. Tests `standalone-sale-obligation-close`,
    > `visit-refund-cancel-noshow`, client `StandaloneSalesTodayCard.obligations`, `ResourceArrivalDialog.obligations`.
42. **No e-mail leaves by itself.** « Envoyer un lien » mints and **shows** the link in the dialog with « Copier le
    lien » and « Envoyer par e-mail ». Nothing is mailed by minting. The e-mail leaves only on the operator's explicit
    click on « Envoyer par e-mail » (same posture as a click on the fiche's « Demander le paiement »): template
    `visit_payment_request` (`defaultEmailTemplatesRegistry.js`, seeded FR and EN, `sendMode: 'manual'`, tone of
    `guest-email-tone`: warm, short, never selling; tokens `{{clientFirstName}}` when known, the amount, the link, its
    valid-until label, `{{senderName}}`). It is **not** in `AUTO_SEND_EXCEPTIONS` (lifecycle rule 44): `autoSendPolicy`
    answers `false` for it, a test asserts it, and the cron and the queue never list it. The send is logged in `email_log` like every other
    e-mail: **amended 2026-11-12 (lead's call, PR C)** — `email_log.reservationId` becomes nullable and the table gains `saleRef`, in the same
    migration as `payment_links` (`pricing_sales_v1`, pricing-components rule 86). The document's history also shows « Lien envoyé à {e-mail} »
    (« Lien copié » is not traced).
    > _Amended 2026-11-15 (end review R1-4):_ the rolling purge of `email_log` (email-history-rolling-window rule 3) keeps a sale's row like a
    > stay's: until the retention window (3 days) after the later of its sale day and its send — the row of a failed send is no longer purged as
    > an orphan the day it was written. Test `email-log-purge-sale-rows`.
43. **The drinks revenue account is a setting of `accounting-export`** (decided 2026-11-12, Q8 A). The setting
    `drinksRevenueAccount` is empty by default. A journal export (CSV, sales JSON, synthesis) whose period holds a
    line of class `drinks` while the setting is empty is **refused** with 409 `DRINKS_ACCOUNT_REQUIRED` « Compte des
    boissons à renseigner avant l'export. » naming the setting's page; an export with no drink line is unaffected.
    The account plan maps `revenue:drinks` to the setting once filled. No default account is invented.
44. **A paid line lowered on a document is a register row** _(stabilisation loop t1, B-1 / AV-1, 2026-11-15; reading of rule 25)_. Offering or removing a
    paid line with the confirmation, or cancelling a paid document, opens in the same transaction one `standalone_sale_obligations` row of origin
    `lineLowered` (no link) for what the document now owes back and no row holds yet (« Bière locale offerte après paiement », « Vente annulée après
    paiement »). The row is listed and closed like a `linkSurplus` row (rule 41 as amended V-4: the mini SAS, the counter's « À rembourser »,
    « Marquer remboursé »), so `refundUnheldCents` falls to 0 once it is open and `refundOwedCents` once it is closed. The visit's invoice waits for it:
    409 `REFUND_OWED` « Remboursement à faire : facture après le remboursement. ». The LINE_PAID refusal names the amount (« Ligne payée : remboursement
    à confirmer. 13,00 € à rembourser. », `refundCents`, mock M5). ~~_Not delivered:_ the negative journal entry of the money given back (an avoir in
    `salesOfDocument`) — the journal still books the line's revenue on its day; the owner decides it with the refund path of rule 25.~~ (delivered
    2026-11-16 by rule 49; reference corrected 2026-11-16, loop t2 B2-6)
    Migration: the table's CHECK is widened (rebuilt once, rows and ids kept). Tests `standalone-sale-paid-line-refund`,
    `pricing-sales-document-obligations-widened`, `visit-round1-reception-and-refunds`.
    > _Reading of 2026-11-16 (loop t3 B3-3):_ the amount the LINE_PAID refusal names is what the confirmed lowering would open (rule 55 d), not what
    > the line holds; a lowering that opens nothing asks nothing.
45. **What each caller is served, so the screens rebuild no rule** _(stabilisation loop t1, 2026-11-15)_. The visit payload adds `invoiceable: { ok, code, reason }`
    (the refusals `POST /:id/invoice` would answer before Qonto, admin; `null` for the reception), `access.withdrawLink` (the administrator on any day,
    V-8), and `newSale: { client }` on an invoiced visit; for the reception, `paymentLink.email` is `null` with `hasEmail`, a typed address that matches a
    client answers `document.client = { kind: 'match' }` without the name, `POST …/email` answers `recipientEmail: null`, and `invoice` / `billing` in
    the commit are refused 403 `ADMIN_ONLY` « Facture : réservée à l’administrateur. » (reception rule 17). The billing address is written inside the
    commit's transaction (a stale version writes none, rule 21). The booking payload adds `actions.noShow` (rule 27: an administrator, a visit with no
    stay, from its day on, not arrived nor absent), the sale links `expiresLabel` (« 16/11 à 14:30 », Europe/Paris), the counter list `owedTitle`
    « À rembourser » and each row's `soldDayLabel` « Vente du 14/11 » (reading of 2026-11-15 of the V-4 amendment: the block of any day sits above the
    day's list under its own title, each row names its day), `GET /api/standalone-sales/vat-rates` each class's `label`. Every visit line already carries
    its `vatRate` (rule 10). Tests `visit-round1-reception-and-refunds`, `booking-actions-no-show`, `sale-link-expires-label`,
    `catalogue-sellable-externally`.
    > _Reading of rule 24, 2026-11-15 (loop t1 AV-8):_ the mini SAS of an invoiced visit offers « Nouvelle vente » on the document's client, as rule 24
    > says; the server serves that client (`newSale.client`), the counter's « Vente hors séjour » dialog opens seeded with it.
46. **The booking's client is the document's** _(stabilisation loop t1, AV-2, 2026-11-15; rule 8 as delivered)_. A client changed on the booking changes the
    document's `clientId` in the same transaction (the « Passage » client when the booking names none) until the document is invoiced. Test
    `visit-round1-reception-and-refunds`.
47. **A visit's money is held where it lives** _(stabilisation loop t1, B-3, D-3, D-4, 2026-11-15; completes rules 28, 34 and plugins-phase-3c rule 17)_.
    (a) One outside rate per class: the rate typed on the catalogue for the `resources` class wins over the plugin's « TVA des ventes hors séjour »
    for the booking dialog's payment, the booking journal and the invoice basis too, as the core's settings provider reads it (before: the booking
    dialog booked 20 % while the mini SAS sold the same session at 10 %). (b) A booking whose document holds a payment, an open obligation or an
    invoice refuses a forced delete of its resource, lodging or client (409, invoicing rule 34), as a booking paid on itself does. (c) The purge
    warning of the plugin names the visits' money on their documents (« 1 visite hors séjour, 63,00 € encaissés sur leur vente, dont 13,00 € à
    rembourser : la vente reste dans « Ventes hors séjour » »), and the counter lists a document whose booking is gone (its « Ventes du jour » and
    « À rembourser »). Tests `outside-vat-rate-one-home`, `visit-money-blocks-deletion`, `visit-money-survives-purge`.
48. **The screens render what rule 45 serves** _(stabilisation loop t1, client round, 2026-11-16)_. « Client absent » shows iff the booking's own
    read (`GET /api/resource-bookings/:id`) answers `actions.noShow` (the planning rows carry no `actions`, so the dialog reads the booking on opening and
    again after the confirmation); no date is compared with the browser's clock. On the mini SAS, « Créer la facture » for money already on the books
    shows iff `invoiceable.ok`, otherwise the invoice section prints `invoiceable.reason` (~~the pay-now checkbox « Créer la facture dans Qonto » still
    depends on the tenders typed and the commit's `invoice` outcome judges it, rule 31~~ — superseded 2026-11-16 by rule 54: the pay-now checkbox is
    served too). Each visit line names its VAT rate as served (« TVA 20 % »:
    beside the session's status, in the detail of a stored or priced draft extra; `SuggestedArticlesStep` gains the optional `showVatRate` prop, set
    by the mini SAS only). An invoiced visit (`newSale` set) offers « Nouvelle vente », which opens « Vente hors séjour » seeded with `newSale.client`
    (« Vente rattachée à ce client. », no name, e-mail or « Enregistrer comme client » asked; the quote and the sale carry `customer: { clientId }`).
    A link reads « valable jusqu’au {expiresLabel} » as served (Europe/Paris), never a browser reading of `expiresAt`; « Envoyer par e-mail » is enabled
    when `email` or `hasEmail` is set (the reception gets `email: null`). The counter card lists the owed documents of any day ABOVE the day's list,
    under `owedTitle`, each row opening with its `soldDayLabel`. The « Classe de TVA » menu of the catalogue lists the server's `classes` with their
    `label` (no class is drawn until the list is read; the client constant `VAT_CLASS_LABELS` is gone). Tests `ResourceBookingDialog.no-show`,
    `ResourceArrivalDialog.invoiceable`, `ResourceArrivalDialog.vat-rate`, `ResourceArrivalDialog.new-sale`, `SalePaymentLink.expires-label`,
    `StandaloneSalesTodayCard.owed-day`, `ExternalSaleFields.server-labels`.
49. **The money given back on a document is its avoir** _(stabilisation loop t1, B-1 accounting part, 2026-11-16; delivers what rule 44 left « Not
    delivered », reading of rules 25 and 30)_. « Marquer remboursé » on a `lineLowered` row (`PATCH …/obligations/:oid { status: 'settled' }`) writes, in the
    same transaction, the money given back as **refund allocations** (refonte rule 74: `payment_allocations` `kind = 'refund'`, negative, `refundId` = the
    row, `paymentRef` `standalone-refund:<row>`, `…:internal` for the caisse interne, dated the day of the click). They are filed on the lines that hold
    more than they now ask (the offered, removed or cancelled lines), in sale order, each line's booked part before its caisse-interne part; what no line
    holds goes on no line. SETTLEMENT reads them as refunded (`paidCents` falls, the reste stays 0), so the closed row is no longer counted a second time
    as « resolved outside the document ». The journal books, on the refund day, one **avoir** of the document (`standaloneSales.list` row `role:
    'refund'`, key `standalone:<id>:<day>:refund`; entry kind `standaloneRefund`): the sale's lines mirrored (customer credit, `revenue:<class>` and
    `vat:<rate>` debit), its VAT cut on the group's cumulative booked TTC like a payment's, so a line refunded in full nets to zero revenue and zero VAT;
    the caisse interne stays off the books. The sales JSON renders it as a « Remboursement » card; the synthesis nets it in the VAT return. A
    `lineLowered` row closed « rien à rembourser » writes nothing: the line keeps the money it was paid, booked on its day. A `linkSurplus` row closed
    `settled` writes nothing either: that money never reached the books (rule 41). No month already booked moves: the avoir sits on its own day. Test
    `standalone-sale-refund-journal`.
    > _Reading of 2026-11-16 (loop t2 B2-1, B2-4):_ « the line keeps the money it was paid » holds row by row. A `lineLowered` row names the line it was
    > opened for (`standalone_sale_obligations.lineRef`; NULL for a whole document cancelled), and « Marquer remboursé » takes the money from THAT line
    > first, then from the other lines holding more than they ask in sale order, then on no line. Before, two rows settled out of order took the plank's
    > refund from the beers (sale `catering 14 € + drinks 13 €`, avoir `drinks 13 € + catering 1 €`: the books kept the plank at 10 % while the money kept
    > was the beers' at 20 %). Which line a cent leaves is REFUNDS' `refundRowsOfDocument` (refonte rule 72), no longer computed in `standaloneSale`.
    > Migration: one nullable column, NULL on the existing rows (they read as before: sale order). Tests `standalone-sale-lowered-line-in-step`,
    > `pricing-refunds-document-rows`.
    > _Reading of 2026-11-16 (loop t3 B3-2):_ a `linkSurplus` row closed `settled` now writes its refund on no line (rule 55 c): still off the journal,
    > but the money leaves the document, so it cannot pay a line sold later.
    > _Reading of 2026-11-16 (loop t4 B4-1, B4-3, owner):_ a `lineLowered` row closed « rien à rembourser » no longer writes nothing: it writes kept
    > allocations and is a tip (rule 56 a); a row takes its own line first, then the excess no other open row names (rule 56 b).
    > _Reading of 2026-11-16 (loop t5 D5-4):_ `refundRowsOfDocument` returns at most one row per (line, caisse): when a row takes a line's unnamed
    > excess and then what another row names on the same line, the two parts are one row, so the allocations written from them never collide on the
    > allocation key (before: the close was refused 500 every time). Test `pricing-refunds-document-rows`.
50. **A link surplus kept is a tip** _(owner decision 2026-11-16, stabilisation loop t1 B-6; completes rules 30, 41)_. A `linkSurplus` row closed
    « rien à rembourser » (`status: 'cancelled'`) is money the business keeps. The history says « 13,00 € gardés en pourboire », and the journal books it
    like a stay's tip: one entry on the day the row was closed (`standaloneSales.list` row `role: 'tip'`, key `standalone:<id>:<day>:tip:<row>`; entry kind
    `standaloneTip`), customer debit and `revenue:tip` credit on the plan's tip account (accounting-export `tipAccount`, named « Pourboire »), no VAT. The
    link's payment day is not moved: the surplus was on no line, so it never was on that day's books. Test `standalone-sale-kept-surplus-tip`.
    > _Reading of 2026-11-16 (loop t4 B4-1, owner):_ the tip is read from the kept allocations (their booked part, on their day), and a `lineLowered` row
    > closed « rien » is a tip too (rule 56 a).
    > _Reading 2026-11-16 (loop t4):_ the day of the tip is the Paris day of the application's clock when the row is closed: `settledAt` is written
    > from it (in SQLite's UTC text form), never from SQLite's own clock, so the tip and its kept allocation share one day at any hour. Test
    > `standalone-sale-kept-surplus-paris-day`.
    > _Reading 2026-11-16 (loop t5 D5-5):_ the tip and avoir days are the `at` of the allocations the close writes; `settledAt` is the row's displayed
    > stamp, which no reader decides money by.
51. **Every booking payload carries its actions; the invoice reason is the stored visit's** _(stabilisation loop t2, UI2-5 to UI2-8, 2026-11-16;
    completes rules 6, 11, 27, 45, 48)_. (a) Every booking payload carries `actions: { noShow, arrive }` for its caller: the booking read, the rows of
    `GET /api/resource-bookings` (the booking dialog opens on them) and of `GET /api/resource-bookings/planning-events` (the planning cards; the
    reception's projection keeps `actions`), and the answer of `POST /:id/no-show`. `arrive` (rule 6): a visit with no stay, not arrived nor absent,
    inside its day window (D 00:00 → D+1 04:00 on the server's clock, rule 5's window); `noShow` as rule 45. The planning card shows « Arrivée » iff
    `actions.arrive`; the booking dialog shows « Arrivée » iff `actions.arrive` and « Voir l'arrivée » on an arrived visit; neither compares a date with
    the browser's clock, and the dialog reads the booking a second time for nothing (rule 48's extra read is gone). (b) `invoiceable` adds `silent: true`
    on the refusals that state no step for the operator (`ISSUER_UNAVAILABLE`, `NOTHING_TO_INVOICE`, `NOT_PAID`, `BOOKING_HAS_STAY`,
    `BOOKING_NOT_FOUND`, `BOOKING_INVOICED`): the mini SAS prints the reason only when not silent, and only while nothing is typed (no draft, no payment
    being taken — the reason reads the stored visit; the commit answers its own invoice). A paid visit on an install without Qonto shows no « Facture »
    block, as before rule 45. (c) Rule 11: a class's external rate the operator emptied in an article form is sent empty and refused
    (`EXTERNAL_RATE_EMPTY`, « Taux du client extérieur requis. », on the field) — the class keeps one rate, which no save clears; an untouched rate is
    not sent. Tests `visit-round2-row-actions-and-invoice-reason`, `catalogue-external-rate-emptied`, `reception-planning-and-date-caps`; Vitest
    `ResourceBookingDialog.no-show`, `PlanningResourceCard`, `ResourceArrivalDialog.invoice-reason`, `externalSaleForm.emptied-rate`.
52. **Money a lowered line holds pays the lines still due** _(stabilisation loop t2, B2-3, 2026-11-16; completes rules 18-19, 28-30)_. After every change of a
    stored document (a line offered, removed or made payable again, a line sold on it, a payment, the document cancelled), in the same transaction, the
    money a line holds beyond what it now asks is filed on the lines that still ask, in sale order, each part kept on or off the books as it was taken
    (SETTLEMENT's `refileDocumentExcess`): one signed transfer of `payment` allocations (`paymentRef` `standalone-transfer:<sale>:<n>`, `…:internal` for
    the caisse interne), negative on the line it leaves, positive on the line it pays, **dated the day of the change**. The journal books it on that day:
    the line it leaves in the day's avoir, the line it pays in the day's sale, no money received (`totalCents 0`); the day the money came in keeps what it
    booked. Only what no line asks is owed back (rule 53). Before, the allocations were written once at payment: a partly paid document whose paid beers
    were offered read the 13 € as paying the plank while the journal kept them on the beers (drinks 13 € at 20 % for a document that sold one plank).
    Tests `standalone-sale-lowered-line-in-step`, `pricing-refunds-document-rows`.
53. **The open rows follow what the document owes** _(stabilisation loop t2, B2-2, 2026-11-16; completes rules 41, 44 and refonte rule 75)_. After every change
    of a stored document, after rule 52, the open `lineLowered` rows are kept in step (REFUNDS' `documentRowsInStep`): a row holds at most what its line
    still holds beyond what it asks, and the rows together at most what the document owes back less its open link surpluses, the newest cut first; a row
    cut to nothing is closed `cancelled` by `system` — no longer owed, so neither money given back nor money kept (it is not counted as resolved, a later
    lowering owes the money again). A confirmed lowering opens what no row holds yet, at most its line's excess. Before, a beer offered then made payable
    again left its 13 € row open (the counter listed it, the invoice waited `REFUND_OWED`, and « Marquer remboursé » wrote 13 € on no line).
    Test `standalone-sale-lowered-line-in-step`.
    > _Reading of 2026-11-16 (loop t3 B3-1):_ the open `linkSurplus` rows are kept in step too, each bounded by the unallocated money (rule 55 b).
54. **« Créer la facture dans Qonto » at « Payé maintenant » is served** _(stabilisation loop t2, B2-7, 2026-11-16; CLAUDE.md §6.0; completes rules 45, 48 and
    invoicing rules 13, 44, 45)_. With a payment typed, the arrival's quote (`POST …/visit/quote` with `payment: { tenders, shortfall?, paidAt }`) and the
    booking dialog's preview (`POST /api/resource-bookings/preview` with `payment`) answer `invoiceable: { ok, code, reason }` for the commit of that draft
    (admin only; `null` for the reception), nothing written: the tenders validated against what is due (`TENDERS_INVALID`), then the refusals `POST
    /:id/invoice` would answer once the commit is written — on the visit's document as the commit would leave it (`REMAINING_DUE`, `REFUND_OWED`,
    `INTERNAL_CASH`, `ISSUER_UNAVAILABLE`…), or on a booking paid on its own columns. The dialogs show the checkbox iff `ok`, ask it again when the payment
    or the draft changes, and the arrival waits for the answer before its commit; they no longer read the tenders to decide it. Tests
    `visit-draft-invoiceable`, `ResourceArrivalDialog.invoice-from-server`, `ResourceBookingDialog.invoice-from-server`.
    _Reading 2026-11-16 (loop t3, UI3-4, UI3-5):_ both dialogs wait for that answer — the booking dialog's « Enregistrer » too (before, a save made
    while it was on its way carried no invoice) — and keep the latest one on screen while a newer one is asked (no caption ↔ checkbox flip on each
    keystroke). A failed answer shows « Facture non vérifiée pour ce paiement. » with « Réessayer » (before, the arrival's « Valider » stayed disabled
    with no word); a refusal of the whole request is shown as such. The answer carries `silent` like the stored visit's `invoiceable` (rule 48):
    « Caisse interne : hors comptabilité, pas de facture » is printed for the server's `INTERNAL_CASH`, never decided from the tenders, any other
    refusal that is not silent prints the server's `reason` under « Facture » (« La facture se propose une fois le paiement saisi. » stays for a
    payment not typed yet), and a silent one shows nothing. Tests `visit-draft-invoice-reason`, `ResourceArrivalDialog.invoice-answer`,
    `ResourceBookingDialog.invoice-answer`.
    _Reading 2026-11-16 (loop t4, UI4-3):_ the payment's request carries the draft, so a refusal of the draft itself or a failure comes back on both
    requests; it is shown once. The arrival shows the payment answer's refusal or « Facture non vérifiée pour ce paiement. » only while the draft's
    own answer is neither refused nor failed (before: the same red message twice, or two « Réessayer »). The booking dialog already shows one: a
    refused draft has no price, hence no payment preview, and a failed one keeps its last price without a second message. Tests
    `ResourceArrivalDialog.invoice-answer`, `ResourceBookingDialog.invoice-answer`.
    _Reading 2026-11-18 (loop t23 S23-1):_ a failed draft no longer keeps its last figures (plugins-phase-1-sdk rule 54 reading of the same
    day): the arrival draws « Total », « Reste à payer », the VAT and the session amounts « — » and shows « — » instead of the payment until
    a new answer, so the payment's invoice answer is not asked meanwhile (its single message is the draft's own, with one « Réessayer »,
    which brings both back); the booking dialog's failed draft reads « Prix indisponible » with its « Réessayer » — the price on screen
    before is not kept — and offers no payment, hence no second message. Tests `ResourceArrivalDialog.invoice-answer`,
    `ResourceBookingDialog.invoice-answer`, `useLatestPreview.failed-recompute`.
    _Reading 2026-11-18 (loop t24 UI24-2):_ the payment's invoice answer that failed together with the draft belongs to THAT payment
    (plugins-phase-1-sdk rule 54 reading of the same day): once « Réessayer » brings the draft back, the payment the tenders report is asked
    as a new question, drawn pending like any other, never under the older payment's « Facture non vérifiée pour ce paiement. » (before:
    about a second of that message, measured in Chromium at 1280 px, while « Enregistrer et facturer » was already labelled). The message
    and its « Réessayer » stay only while « Réessayer » asks that same payment again. Tests `ResourceArrivalDialog.invoice-answer`,
    `ResourceBookingDialog.invoice-answer` (UI24-2).
    _Reading 2026-11-18 (loop t24, second pass — nominal path):_ **the invoice question is asked only for the payment typed against the
    draft on screen.** Before, an edit sent it at once with the edited draft and the payment still typed against the older amount; that
    stale pair came back as a false refusal (« Les moyens font 50,00 € pour 37,50 € dus. »), drawn under « Facture » for about a second,
    and the booking's save read « Enregistrer » instead of « Enregistrer et facturer » meanwhile (measured in Chromium at 1280 and 390 px,
    every answer +800 ms, both dialogs). Now the question leaves once the draft's own answer is in (`fresh`) and the tenders have followed
    it (`BookingPaymentFields` reports the `dueCents` its lines were typed against); until then the latest answer stays on screen and the
    commit stays disabled. The booking's save reads « Calcul du prix… » while the price is asked, then the decision of the latest answer
    (« Enregistrer et facturer »), never a plainer wording in between; the arrival's « Valider l’arrivée » does not change. Test
    `SaleDialogs.commit-label-pending` (every screen previewing through `useLatestPreview`, read from the code, has a row or a fixed label;
    each row edits the draft with a priced payment and records every label and every refusal drawn until the new answer).
    _Reading 2026-11-18 (loop t21, UI21-1):_ that answer always comes one quote after the content — the tender lines report their default card
    line on mount, and only then is the payment asked — so the « Facture » block landed late and moved the dialog (+34 px at 1280 px in the
    arrival: « Récapitulatif » and « Encaisser » 17 px up, the actions 17 px down; in the booking dialog « La facture se propose une fois le
    paiement saisi. » first, then the checkbox). Both dialogs now draw the block with the content whenever « Payé maintenant » can invoice
    (`qontoReady`, not the reception), **pending** until the answer for the payment typed comes: the offered state's checkbox, disabled, ticked
    as the default card line ticks it, the address fields of a guest with no client record in place (`BookingInvoiceBlock` prop `pending`).
    The answer fills it, and **every outcome keeps the pending block's height** while « Payé maintenant » can invoice (`BookingInvoiceBlock`
    prop `reserve`: the pending block's height is measured before paint and kept as the block's minimum height): accepted → the checkbox
    enabled; a refusal that is not silent (a VAT or tariff rule, rule 36, …) → its one-line reason, the space below it kept; « Caisse
    interne » → its notice; a `silent` refusal → nothing shown, as before (UI3-5), the arrival's « Facture » section hidden in place
    (`visibility: hidden`, `aria-hidden`) instead of removed; a failed answer → the block stays pending (checkbox disabled) beside
    « Facture non vérifiée pour ce paiement. ». The booking dialog's block keeps the same minimum height for its outcomes; its silent answer
    is not hidden but shows the block's own caption « La facture se propose une fois le paiement saisi. » (corrected 2026-11-18, loop t22:
    the round-21 text said a silent refusal shows nothing in both dialogs — that is the arrival only). Only a gesture changes the block's size (« Pas maintenant », another payment, or the operator ticking or unticking the box, which
    drops the reserved height). A payment
    no longer readable shows « La facture se propose une fois le paiement saisi. ». The commit waits for the answer as before. Test
    `SaleDialogs.pending-blocks` (the four outcomes, table-driven, and the unticking gesture).
    _Reading 2026-11-18 (loop t22, UI22-1/UI22-2; owner decision of 2026-11-18 on layout shifts):_ what the reserve guarantees, exactly:
    on the **accepted** answer (the nominal path) nothing moves in either dialog — measured in Chromium at 1280 and 390 px, answer +0 and
    +800 ms: « Récapitulatif » 120 / 492, « Paiement » 288 / 660, the actions 792 / 716 and the block 274 px in the arrival; « Facture »
    1044 / 989 and the actions 808 / 767 in the booking dialog, whose save button now reads « Enregistrer et facturer » from the moment the
    pending block is drawn ticked (it rewrapped at 390 px when the answer came: 784 → 775). On **another** outcome content may move and that
    is accepted: in the arrival a refusal, « Caisse interne » or a silent answer drops the address fields, so the block's content moves
    12 px up inside a section 316 → 304 px tall (nothing outside the section moves); in the booking dialog a failed check or a refused draft
    shows its alert above the « Facture » section (+64 px at 1280, +84 px at 390). On **every** outcome: the address fields of a pending
    block are disabled like its checkbox (`disabled={busy || pending}` — they stayed live, and an answer that removed the field being typed
    in dropped the focus on the page and the text with it), and the block and both dialogs' contents are `FocusKeeper` regions
    (plugins-phase-1-sdk rule 54 reading of 2026-11-18): an answer that removes or hides the field holding the focus leaves it on the block,
    or on the dialog's content when the section is hidden. Tests `SaleDialogs.pending-blocks` (no usable control in a pending block),
    `SaleDialogs.focus-on-answer` (the four outcomes of a second answer while the address holds the focus).
    _Reading of 2026-11-19 (loop t25 verifier; owner decision « no action on an unknown value »):_ **while the answer for the payment being
    typed is on its way, the block is pending — never the older payment's answer.** The arrival and the booking dialog kept the latest
    answer on screen while the next one was asked (a new draft, the tenders following it — `invoiceAwaiting` — or a slow answer): about
    2 s of « Créer la facture dans Qonto » ticked and clickable for a payment it did not answer (« Valider » stayed disabled and the commit
    carried the right decision). Both now take the « Facture » answer only when it is `fresh` for the payment typed; until then the block
    is drawn pending at its reserved height — checkbox disabled, ticked or not as the operator left it, address kept and disabled — and
    the answer fills it: accepted, the checkbox is live again with the operator's state; refused, its reason. Measured in Chromium at 1280
    and 390 px with a +800 ms answer and a refused one (arrival and booking): « ticked/disabled » from +100 ms, then « ticked/live » or the
    reason, the focus on « Plus 15 minutes ». Tests `InvoiceBlock.pending-answer` (4), `SaleDialogs.focus-on-answer` (the address is typed
    against the current answer; during the next one it is kept and disabled).
    _Reading of 2026-11-19 (loop t26, plugins-phase-1-sdk rule 58):_ the payment lines typed at « Payé maintenant » / « Maintenant » stay as
    typed when the due moves (an article, the offered time) and after a failed quote (mixed-method-payments rule 59 reading of the same
    day); « Valider l’arrivée » and the booking's save keep the focus in their actions row while busy (`MoneyActions`).
55. **One money model for a document: every cent on a line or on no line** _(stabilisation loop t3, B3-1, B3-2, B3-3, 2026-11-16; completes rules 41,
    44, 49, 50, 52, 53 and refonte rules 72, 74, 75)_. Every cent a document received sits either on one of its lines or **on no line** — its
    *unallocated money*: a link paid above the reste (rule 41), net of what was given back or kept from it (`payment_allocations` with `lineRef` NULL).
    (a) **The unallocated money pays first.** After every change of a stored document (rule 52), the unallocated money is the FIRST giver of
    SETTLEMENT's `refileDocumentExcess`: it is filed on the lines still due (a transfer `lineRef` NULL → the line, dated the day of the change, booked
    that day in the sale like rule 52's legs; the leg leaving no line puts nothing in the avoir), before a lowered line's money moves. Only what is left
    on no line is a link surplus. (b) **The `linkSurplus` row follows it.** Its row opens in the payment's transaction (`receive`) and is kept in step
    with the other rows (REFUNDS' `documentRowsInStep`, rule 53 widened to every open row): a `linkSurplus` row holds at most the unallocated money
    left, every row together at most what the document owes back, the newest cut first; a row cut to nothing is closed `cancelled` by `system` and is
    **no tip** (rule 50 reads only rows the operator closed). Before, a beer made payable again after a late 14 € link stayed due under a « 13,00 €
    à rembourser » row (13 € consumed, never asked, never booked; invoice refused `REFUND_OWED`). (c) **Closing a link surplus takes its money off the
    document.** « Marquer remboursé » writes it as a refund on no line (`kind = 'refund'`, `refundId` = the row, `paymentRef` `standalone-refund:<row>`;
    REFUNDS' `refundRowsOfDocument` with `unallocated`), off the journal since the surplus never was revenue — this replaces rule 49's « a
    `linkSurplus` row closed `settled` writes nothing ». « Rien à rembourser » writes a **kept** allocation: one negative `payment` allocation on no line
    (`paymentRef` `standalone-kept:<row>`, `refundId` = the row), so SETTLEMENT's `paidCents` falls by the tip; the journal still books the tip from the
    closed row (rule 50). Either way the closed row is counted once (`closedObligationCents` skips a row any allocation names), and a line sold later is
    asked in full: before, the 13 € given back or tipped kept paying it (« Payé » with nothing received, the beer never booked). (d) **The LINE_PAID
    refusal names what the confirmation opens** (rule 44's mock M5, reading of 2026-11-16). `refundCents` is the row the confirmed lowering would open:
    the plan of rule 52-53 run on the document as the change would leave it. A paid line whose money pays the lines still due opens nothing, so the
    lowering is applied with no question (the money « passe sur le reste »); a line holding 13 € on a document whose plank asks 7 € names 6 €. Before,
    the dialog asked to give back 13 € the confirmed change then filed on the plank, with no row to record it. In every case the journal nets, per
    class and rate, exactly the paid lines the Qonto invoice states (rule 31). Tests `standalone-sale-unallocated-money`,
    `standalone-sale-line-paid-refund-amount`.
    > _Reading of 2026-11-16 (loop t4 B4-1, B4-2):_ `closedObligationCents` is gone (rule 56 b): every closed row leaves the document through its
    > allocations, so none is counted apart. The closing claim holds since rule 56 (a) and (e).
56. **A row closed « rien à rembourser » is a tip; the books, the invoice and the rows follow the money** _(stabilisation loop t4, B4-1 to B4-6,
    2026-11-16; owner decision 2026-11-16 for (a); completes rules 31, 44, 49, 50, 53, 55 and refonte rules 62, 72, 74, 75)_.
    (a) **Kept money is a tip, whatever the row.** A `lineLowered` row (a paid line offered or removed, a paid document cancelled) closed « rien à
    rembourser » is money the business keeps, exactly like a kept link surplus (rule 50): it writes **kept** allocations — negative `payment`
    allocations, `paymentRef` `standalone-kept:<row>` (`…:internal` for the caisse interne, off the books), `refundId` = the row — on the lines a refund
    would take (REFUNDS' `refundRowsOfDocument`, (b)), dated the close day. The journal books, that day, the line's part in the document's avoir (its
    revenue and VAT leave, as for a refund) and the booked part as the tip of rule 50 (`role: 'tip'`, key `standalone:<id>:<day>:tip:<row>`); the
    history says « 13,00 € gardés en pourboire ». Rule 49's « a `lineLowered` row closed « rien à rembourser » writes nothing: the line keeps the money
    it was paid, booked on its day » is replaced: before, the invoice stated the plank (14 €) while the journal kept the offered beers' 13 € as drinks
    revenue at 20 % (VAT on money no invoice states). A cancelled document whose row is closed « rien » tips the lines' money the same way.
    (b) **What a document owes follows its lines.** No closed row is subtracted on its own any more (`closedObligationCents` removed): the money a row
    gave back or kept left the document by its allocations, so a line made payable again after a « rien » is asked again (the 13 € tipped pay no line),
    removing a paid line owes what its money no longer pays, and a late link above the reste is a surplus of exactly what no line asks. Before, a « rien »
    row counted forever: removing a 14 € plank asked 1 €, a cancel row held 14 € of 27 €, a late link hid 13 € on no line. **Which money a row takes**:
    its own line first, then the excess no other open row names, in sale order, and only then what another row holds (`refundRowsOfDocument`'s
    `reserved`, the other open `lineLowered` rows): the whole-document row of a cancelled document no longer takes the offered beers' money their own row
    was opened for (before: avoir beers 13 € + plank 1 €, the books keeping catering at 10 % while the money kept was the beers' at 20 %).
    (c) **`INTERNAL_CASH` is judged on the money held.** The document's `totals.internalHeldCents` is the caisse-interne money its lines (or no line)
    still hold, net of what was given back, kept or moved (`books = 0` allocations); the invoice is refused `INTERNAL_CASH` while it is above 0 (the draft
    of rule 54 adds the internal tenders typed), no longer whenever a payment once had an internal tender: beers paid in the caisse interne then offered
    and given back leave a card-paid plank that is invoiced. The reception's payload does not carry it (rule 7).
    (d) **The preview is the commit's plan.** A quote of a stored document runs the plan of rules 52-55 on the draft (nothing written): the unallocated
    money and a lowered line's money pay the new lines (« Payée » in the preview, the reste the commit will ask), and the open rows are served at the
    amounts the plan leaves them, a row planned to nothing left out. The mini SAS renders the quote's rows while a draft is typed and disables « Marquer
    remboursé » until it is saved (the stored row is not the one shown). Before, the preview showed the new beer « À payer » under « Reste 0 » beside
    the stored « 13,00 € à rembourser ».
    (e) **The invoice states the journal's VAT.** Qonto computes VAT item by item; each item of a document's invoice names its (class, rate) group
    (`vatGroup`, a session paid on the booking a group of its own), and the issuer sends a group's items so that their HT sum is the group's TTC less the
    VAT cut ONCE on it (the VAT component's `groupVatCents`, which the journal uses too): each item within three cents of HT, else further (one VAT cent
    moves only every 1 / rate cents of HT at a low rate), the least TTC moved first, else an « Arrondi de TVA » line; a discount folds into its own
    group only. Before, two beers at 6,50 € (20 %) were invoiced 2,16 € of VAT while the journal declared 2,17 €. Items with no group (a stay, a booking
    paid on its own columns) are sent exactly as before. (At 2,1 % a group may need lines moved by up to fifty cents; no article of the external
    catalogue uses that rate.)
    A fuzz of 300 random document lives (sales, card / caisse-interne / partial payments, offers, removals, late links, cancellation, rows refunded or
    kept) checks after every step that no cent is created or lost (booked money received − given back = journal revenue + tips + booked money on no
    line), that the journal nets per (class, rate) the paid lines an allowed invoice states, and that every owed cent sits in a row. Tests
    `standalone-sale-kept-lowered-line`, `standalone-sale-cancel-refund-order`, `standalone-sale-quote-plan`, `standalone-sale-money-conservation`,
    `visit-invoice-internal-held`, `invoice-issuer-vat-per-group`; Vitest `ResourceArrivalDialog.planned-rows`.
    _Reading 2026-11-16 (loop t5, UI5-2, UI5-3):_ « Réessayer » on a failed draft also re-sends the payment's answer, so the second message never
    follows the first; the failed-draft alert spans the whole grid (UI5-1). While a draft is typed and a row is open, « Marquer remboursé » is
    disabled with « Enregistrer d’abord les articles ajoutés. » shown under the rows.
    _Reading 2026-11-16 (loop t6, UI6-4):_ the caption under the rows is « Enregistrer d’abord les modifications. »: the draft is dirty for an added
    article, offered minutes or an offered session alike, and before the arrival is validated the primary button reads « Valider l’arrivée ». The
    payment-link caption keeps « … les articles ajoutés. » only when an article was added.
57. **A month already exported never moves; every invoice states the VAT its own journal declares** _(stabilisation loop t5, B5-1 to B5-3,
    2026-11-16; completes rules 30, 56 e; pricing-components rule 62)_.
    (a) **The document journal cuts the VAT in the order the money was written.** A payment may be dated (« Date du paiement », no minimum). The journal
    cut each group's VAT on its cumulative TTC in the order of the payment DAYS, so a payment recorded on 10 November and dated 20 September re-cut the
    entry of 5 October, already exported (3 beers at 6,50 € paid in thirds: October moved from 1,09 € to 1,08 € of VAT). The cut now follows the order
    of writing (the `payment_allocations` row ids: payments, refunds, kept rows and transfers alike): each movement takes the cut its group had left
    when it was recorded, so a back-dated payment books its own day (1,08 € on 20 September) and no entry written before it moves; the document's whole
    VAT is still one cut on its whole TTC. Chosen over refusing a date before the last paid day: a stay accepts a back-dated payment and never re-cuts
    a day already declared (pricing-components rule 99), so the document follows the same rule. With no back-dated payment the entries are the ones
    the days' order gave.
    (b) **A booking's invoice states the booking journal's VAT.** The journal books a booking sold outside a stay (and a session paid on the booking
    before its document) as ONE line whose HT is the net of its TTC (`netOfTtc`, net first). Its invoice's items and discount now name the group
    `booking:session|<rate>` (resource-booking rule 14), and the issuer sends a `booking:` group — this one, or a document's session paid on the booking
    (rule 56 e) — with that cut instead of `groupVatCents`. Before, Qonto's per-line VAT of a booking drifted a cent from the books (20 € − 15 €
    « 1 h offerte » at 10 %: 0,46 € invoiced, 0,45 € declared; 156 of 606 realistic breakdowns), and a document's session took the sale cut where the
    two cuts part (10,05 € at 20 %: 1,68 € against the booking's 1,67 €). Amends rule 56 e's « items with no group are sent exactly as before » for
    bookings; a stay's invoice still names no group. Nothing stored moves: an invoice already issued stays as Qonto numbered it.
    (c) **The folded fallback reaches what the ungrouped solver reached.** When Qonto refuses a negative line (Q3) the discount folds into its group,
    and no line may be negative. A group whose cut no single line carries then needs the lines moved further AND an « Arrondi de TVA » line (14,00 € −
    11,69 € at 20 %: 1,89 € HT + 0,03 €), or a rounding line large enough to carry a cent of VAT itself (5,50 € − 1,95 € at 5,5 %: no line under
    0,10 € HT carries VAT there); the issuer tries the rounding line with the lines within three cents, then moved further, then a wider rounding line.
    Before, 333 of ≈ 6 000 discounted baskets were `ISSUER_AMOUNT_UNREACHABLE` on the fold although the ungrouped solver invoiced them; now none, the VAT
    per rate still the journal's.
    Tests `standalone-journal-backdated-payment` (with the reviewer's multi-day fuzz, bounded: back-dated payments and links up to 40 days, no past
    day but the back-dated one rewritten), `invoice-issuer-folded-rounding` (4 000-basket fuzz against the ungrouped solver),
    `booking-invoice-vat-booking-journal` (the 606-breakdown sweep widened, wire and fold).

---

## 4. Architecture

> **Fat backend, thin frontend.** Every amount, status, remaining figure, VAT row, refusal and grouping comes from
> the server. The client keeps only the draft (requests, offered toggles, typed tenders) and renders quotes.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `standaloneSale.js` (from refonte PR C, the same PR) | T | `quote` / `sell` accept a `fulfilment` line request (the session) and an `originRef` (`resource-booking:<id>`); `offerLine`, `removeLine`, `pay` actions on an existing document, each a re-quote inside the transaction |
| `models/` | `standaloneSalesModel.js` (from PR C) | T | reads/writes the columns of §5; `byOrigin(originRef)`; document `version` for the concurrent-commit check |
| `utils/` | `suggestedArticles.js` | C | the `suggestedArticles` core module: provider registry keyed by sale context, `resolve({ context, customerContext })` with the sellability filter (rules 35-36); `catalogue({ customerContext, q })` (C38) lists every article the caller may sell, by category, for « Autre article » and the settings picker; `settingsView` names each listed article |
| `models/` | `suggestedArticlesModel.js` | C | reads/writes `suggested_articles` (rule 37) |
| `controllers/` | `suggestedArticlesController.js` | C | settings read/write (admin) and the resolved read; validates references |
| `routes/` | `suggestedArticles.js` | C | thin: §4.3 |
| `utils/` | `standaloneSaleLinks.js` | C | mints / reuses / withdraws the reste link through the payment-provider path (rule 40); the paid effect of the `standalone-sale` basket (rule 41); sends the manual e-mail on click (rule 42) |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | seeds `visit_payment_request`, `sendMode: 'manual'` (rule 42) |
| plugin `accounting-export` | `settings` + exporters | T | `drinksRevenueAccount` and the `DRINKS_ACCOUNT_REQUIRED` guard (rule 43) |
| `models/` | `standalonePaymentsModel.js` | C | writes `standalone_sale_payments` and their allocations (`payment_allocations`) inside the sale transaction; `recordRefund` writes a `lineLowered` row's refund allocations (rule 48); `recordTransfer` writes the transfer of rule 52; `documentsPaidBetween` lists the documents with a payment, a refund, a transfer or a kept surplus in the window, each allocation with its row id (loop t5, rule 57 a) |
| `controllers/` | `standaloneSalesController.js` (from PR C) | T | the counter dialog's routes (§4.3): `GET /` (« Ventes du jour »), the quote's and the sale's `paymentLink` block, the three link routes of a counter sale (C38); exposes the actions above to the SDK |
| `utils/` | `saleDetail.js` (from PR B) | T | `saleDetail({ documentRef })` for a standalone document: lines, statuses, `totals { totalCents, paidCents, remainingCents, refundOwedCents }` from SETTLEMENT and REFUNDS |
| `utils/pricing/` | `settlement.js`, `refunds/owed.js` | T | SETTLEMENT and REFUNDS take a standalone document as input (no stay-level parts) — no new formula, rule 4; loop t2: `refileDocumentExcess` (SETTLEMENT, rule 52), `documentRowsInStep` and `refundRowsOfDocument` (REFUNDS, rules 53, 49) |
| `utils/accounting/` | read model of standalone documents | T | lines + VAT output + allocations as `standalone` entries (rule 30); `standaloneDocuments.salesOfDocument` adds the refund day's avoir (rule 48) and the kept surplus's tip (rule 49), and books a transfer of rule 52 on its day (the avoir of the line it leaves, the sale of the line it pays); `journalLines` mirrors the avoir and books the tip; `exporters/salesJson` renders them as a « Remboursement » and a tip card; loop t5: the VAT of a group is cut in the order the money was written (rule 57 a) |
| `utils/` | `standaloneSale.js`, `standaloneSaleLinks.js` | T | `writeObligationRefund` (rule 48), called by `closeObligation` on a `lineLowered` row `settled`; a `linkSurplus` row `cancelled` is written « gardés en pourboire » (rule 49) |
| `models/` | `standaloneSalesModel.js` | T | loop t4: `closedObligationCents` and `keptSurpluses` removed — a closed row leaves the document through its allocations (rule 56 b); `recordKept` (`standalonePaymentsModel`) writes the kept rows of any row, the journal reads the tips from them (rule 56 a) |
| plugin `accounting-export` | `accountingModel.js` | T | a kept surplus's tip on the plan's tip account, named « Pourboire » (rule 49) |
| `utils/` | `standaloneSales.js` | T | the core lists its own documents beside the plugins' providers (rule 32) |
| `plugins/sdk/` | `coreModules.json`, `index.js` | T | expose `standaloneSale`, `saleDetail`, `suggestedArticles`, `sasEditWindow` (already) to plugins; add `ctx.suggestionContexts` (rule 37); SDK minor bump |
| `database.js` | `database.js` | T | idempotent columns and tables of §5, including `suggested_articles` and the `payment_links` standalone target |
| plugin | `plugins/hourly-resources/visitController.js` | C | (C38: `GET /:id/visit/articles?q=` for « Autre article »; every payload carries `access: { writable, reason, reception }` so the screen never guesses the window or the role) |
| plugin | `plugins/hourly-resources/visitController.js` | C | `GET /:id/visit`, `POST /:id/visit/quote`, `POST /:id/visit` (commit), `POST /:id/visit/payment`, `PATCH /:id/visit/lines/:lineId`, `POST /:id/no-show`, the payment-link routes (rules 39-42); window and role guards (rules 5, 7) |
| plugin | `plugins/hourly-resources/visitModel.js` | C | links a booking to its document (`saleRef`), builds the session `fulfilment` line from the booking (the plugin's hourly pricing) and the `paidElsewhere` session of rule 34, the client of rule 8, the window of rule 5; `view`, `commit`, `pay`, `patchLine`, `noShow`, `ensureDocument`, `moneyOf`, `repriceSession`, `cancelDocument` |
| plugin | `plugins/hourly-resources/bookingsModel.js` | T | `enrich` adds `visit`, `noShow`, `cardState`; `recordArrival` and `recordPayment` pay the document of a booking that has one; `clearPayment` refuses document money; `update` re-prices an unpaid session line when the slot moves; `standaloneSales` lists only the money on the booking's own columns (rule 32); `remove` cancels the document (rule 26) |
| plugin | `plugins/hourly-resources/invoicing.js` | T | invoice basis = the document's lines when the session is on a document (rule 31, `issueDocument`, `documentRequestOf`, `REMAINING_DUE`); `draftInvoiceability` judges the commit of a draft with a payment typed (rule 54), on `visitModel.draftMoneyOf`; served by `visitController.quote` and `controller.preview`; loop t4: `INTERNAL_CASH` on `totals.internalHeldCents`, each item names its `vatGroup` (rule 56 c, e); loop t5: a booking's own invoice names the group `booking:session|<rate>` (rule 57 b) |
| plugin `online-payment` | `invoiceIssuer.js` | T | loop t4 (rule 56 e): items naming a `vatGroup` are solved per group to the group's single VAT cut (`groupVatCents` of the VAT component); loop t5: a `booking:` group takes the booking journal's cut (net of the TTC), the folded fallback widens its rounding line (rule 57 b, c) |
| plugin | `plugins/hourly-resources/planningCardsModel.js` | T | `bookingCardState`: « À encaisser », « Reste {x} », « Payé », « Absent » from the server's figures (rule 22) |
| plugin | `plugins/hourly-resources/routes.js` | T | mounts the visit routes before `/:id`; the old `POST /:id/arrival` is removed with `controller.arrival` and `bookingsModel.recordArrival` (C38: no caller left once the screens use the visit routes) |
| plugin | `plugins/hourly-resources/index.js` (`suggestionContexts`) | T | declares kind `resource` and lists the resources as contexts (rule 37); **no per-resource article list in the plugin's settings** |
| plugin | `plugins/hourly-resources/index.js` | T | mounts the visit routes; adds `GET/POST /resource-bookings/:id/visit*` to `ctx.reception` (rule 7) |
| plugin | `plugins/hourly-resources/migrations.js` | T | `resource_bookings_v6`: `saleRef`, `noShowAt` |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| plugin | `plugins/hourly-resources/ResourceArrivalDialog.jsx` | T | becomes the mini SAS: « Sa séance », « Proposés à l'arrivée », « Paiement », « Facture »; reads `visit` payloads only |
| plugin | `plugins/hourly-resources/useVisitQuote.js` | C | debounced quote of the draft (as `useResourceBookingPreview`), `fresh` / `pending` / `refusal` |
| plugin | `plugins/hourly-resources/PlanningResourceCard.jsx` | T | « Reste {amount} » / « Payé » / « Absent » from the server |
| plugin | `plugins/hourly-resources/ResourceBookingDialog.jsx` | T | « Client absent » action; payment through the visit for rule-34 bookings; « Créer la facture dans Qonto » from the preview's `invoiceable` (rule 54) — `ResourceArrivalDialog.jsx` reads it from the quote the same way |
| component | `components/SuggestedArticlesStep.jsx` | C | **generic** « Proposés à l'arrivée » step: chips from a `suggestions` payload, « Autre article » search, quantity stepper, « Offrir », « Retirer », server refusal; prop-driven (`suggestions`, `lines`, `refusal`, `onAdd`, `onChange`), no resource, stay or plugin knowledge (rule 35) |
| component | `components/SalePaymentLink.jsx` | C | **generic** « Envoyer un lien » block: states `unavailable` / `needsEmail` / `ready` / `minted`, copy, e-mail click, withdraw; reads the `paymentLink` payload (rules 39-42); reusable by the Encaissements counter dialog |
| page section | `pages/settings/SettingsSuggestedArticlesSection.jsx` | C | Réglages → Options & ressources → « Proposés à l'arrivée » (a core tab of `OptionsResourcesPage`): one list per context, reordered with ↑ / ↓ buttons, grouped by kind (rule 37) |
| component | `components/SaleDetailList.jsx` (from refonte PR B) | — | **not used (C38 decision)**: it renders a stay's `saleDetail`; a document's lines are drawn by `SuggestedArticlesStep` (extras) and the dialog's own session block, with the « Offrir » toggle, the struck catalogue value and the status words of the payload |
| component | `components/StandaloneSaleDialog.jsx` | C | « Vente hors séjour » (owner M4, Q-C9): articles, quote, customer (rule 8a), payment or link, saved screen; core, no plugin |
| component | `components/StandaloneSalesTodayCard.jsx` | C | « Ventes hors séjour · aujourd'hui » on the Suivi financier, the button that opens the dialog |
| component | `components/ExternalSaleFields.jsx` + `hooks/useExternalVatRates.js` + `pages/options/externalSaleForm.js` | C | the three catalogue fields (« Vendable hors séjour », VAT class, external rate), drawn by the option and the resource editors (Q-C11) |
| component | `components/TenderLines.jsx` | — | consumed as is, `dueCents = remainingCents`, shortfall `due` only (prop `shortfallKinds={['due']}` added, generic) |
| component | `components/StatusBadge`, `ConfirmDialog`, `LoadingState`, `ErrorAlert` | — | consumed |
| `api.js` / plugin sdk | `getResourceVisit`, `searchResourceVisitArticles`, `quoteResourceVisit`, `commitResourceVisit`, `patchResourceVisitLine`, `markResourceNoShow`, `mintVisitPaymentLink`, `withdrawVisitPaymentLink`, `emailVisitPaymentLink`, `getSuggestedArticlesSettings`, `getSuggestedArticlesCatalogue`, `saveSuggestedArticles`, `getStandaloneSales`, `quoteStandaloneSale`, `sellStandaloneSale`, the three standalone link calls, `getStandaloneVatRates` | T | plumbing; the commit carries the payment, so no separate `payResourceVisit` call is made by the screen |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `TenderLines`, `StatusBadge`, `ConfirmDialog`, `FormDialog`, `LoadingState`, `ErrorAlert`, `PageActionBar`, `UnsavedChangesDialog`, `EmptyState` | `OfferableLine` of the `sas` plugin is **not** imported (a plugin never requires another plugin); « Offrir » is a prop of `SuggestedArticlesStep` and of the dialog's session block. `SaleDetailList` (a stay's lines) is not used: see the §4.2 table. |
| **Created (new generic)** | `SuggestedArticlesStep` (the owner asked for a generic step, Q5), `SalePaymentLink`, `ExternalSaleFields`; `TenderLines` gains a generic `shortfallKinds` prop; `BookingPaymentFields` gains `whole` / `shortfallKinds` | named by what they do, not by who uses them; a second use is real (the counter dialog mounts the step and the link block beside the mini SAS; the option and the resource editors share the catalogue fields; the stay SAS, rule 38) |
| **Specific (kept feature-local)** | `useVisitQuote`, `StandaloneSaleDialog`, `StandaloneSalesTodayCard` | `useVisitQuote` debounces one plugin's quote endpoint; the counter dialog and its card belong to the one « Vente hors séjour » feature; `ResourceArrivalDialog` composes the generic components above. |

`PageActionBar`: the mini SAS is a dialog opened from the planning; the Suivi financier gains the icon « Vente hors séjour » in its bar, and the new tab « Proposés à l'arrivée » of Options & ressources uses the bar's « Enregistrer » / « Annuler » (CLAUDE.md §7).

### 4.3 API contract

All under `/api/resource-bookings`, plugin `hourly-resources`, authenticated; reception allowed inside the window
(rule 7). Money in cents. Errors `{ error, code }`, French `error`.

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/:id/visit` | — | `{ booking, document: { ref, id, status, version, client: { id, label, kind } }, lines: [{ id, ref, kind: 'session'\|'extra', label, detail, components: [{ key, label, detail, amountCents }], quantity, unitCents, totalCents, catalogueCents, offered, status: 'paid'\|'due'\|'offered'\|'cancelled', statusLabel, settledCents, vatRate, legacy, draft }], groups, totals: { totalCents, paidCents, remainingCents, refundOwedCents }, vatByRate: [{ rate, vatCents }], suggestions: [{ articleRef, label, unitCents, max }], paymentLink: { available, reason, email, open: { id, url, amountCents, expiresAt } \| null }, window: { open, reason: null\|'future'\|'past'\|'noShow' }, invoice: { number, cancelled } \| null, history: [{ at, text, actor }], session: { offeredMinutes, editable } }` | before the first write `document.ref` / `id` are null and the session is a `draft` line; `legacy` marks a session paid on the booking (rule 34); for the reception `refundOwedCents` and `history` are left out and `booking` keeps the door fields only (no phone, no notes) |
| POST | `/:id/visit/quote` | `{ offeredMinutes?, sessionOffered?, extras: [{ articleRef, quantity, offered? }], customer?: { email?, name?, registerAsClient? } }` | same shape as GET, `quoted: true`, `refusals: [{ field, code, error }]` | no write; a stored line changes through PATCH, never through the quote (rule 23) |
| POST | `/:id/visit` | quote body + `version?`, `acceptedTotalCents?`, `payment: { tenders, shortfall: { kind: 'due' } \| null, paidAt? } \| null`, `invoice?: boolean`, `billing?` | `{ visit, invoice: { ok, number? , code?, error? } \| null }` | 409 `PRICE_CHANGED`, `ARRIVAL_NOT_TODAY`, `BOOKING_HAS_STAY`, `BOOKING_NO_SHOW`, `BOOKING_INVOICED` « Facturée : nouvelle vente séparée. », `SESSION_SOLD`, `NOTHING_DUE`; 400 tender refusals (`TENDERS_INVALID`, `WAIVED_REFUSED`), article refusals (`refusals`); `invoice` not boolean → 400 (invoicing rule 45) |
| POST | `/:id/visit/payment` | `{ tenders, shortfall, paidAt?, version? }` | `{ visit }` | collects a reste; the document is born here when the visit has none; 409 `NOTHING_DUE` for a session paid on the booking and no extra |
| PATCH | `/:id/visit/lines/:lineId` | `{ offered?: bool, remove?: true, confirmRefund?: true, version? }` | `{ visit }` | 409 `LINE_PAID` without `confirmRefund`, `SESSION_LINE` (the session is not retired alone); 403 `ADMIN_ONLY` for the reception on a paid line or with `confirmRefund` |
| POST | `/:id/no-show` | — | `{ booking }` | rule 27, admin (403 `ADMIN_ONLY`); 409 `BOOKING_ARRIVED` once arrived, `NO_SHOW_TOO_EARLY` « Client absent : à partir du jour de la séance. » before its day |
| POST | `/:id/visit/payment-link` | `{ email? }` | `{ visit, link: { id, url, amountCents, expiresAt, status, reused } }` | rules 39-40; 409 `NOTHING_DUE`, `NO_EMAIL`, `PROVIDER_NOT_READY` refused before anything is written; 400 `EMAIL_INVALID`; the amount is never in the request |
| DELETE | `/:id/visit/payment-link/:linkId` | — | `{ visit }` | « Retirer le lien »; 409 `LINK_ALREADY_PAID` (lifecycle rule 42) |
| POST | `/:id/visit/payment-link/:linkId/email` | — | `{ sent, recipientEmail }` | rule 42, explicit click only; 409 `NO_EMAIL`, `TEMPLATE_DISABLED`, `LINK_NOT_OPEN` |
| POST | `/:id/invoice` | `{ billing? }` | unchanged | basis = document lines (rule 31); 409 `REMAINING_DUE` « Reste à payer : facture après le solde. » |

C38 additions to the plugin routes: `GET /:id/visit/articles?q=` → `{ articles: [{ articleRef, label, unitCents, max, category }] }` (« Autre article », reception allowed inside the window; the articles sellable with no stay, filtered by a fragment of the label); every visit payload (`GET`, quote, and the `{ visit }` of each write) carries `access: { writable, reason, reception }` — `writable` is the commit's own refusal turned into a flag (the day window, the role, an invoiced or absent visit), `reason` the server's French sentence — and `invoiceReady` (whether an invoice can be made now). The old `POST /:id/arrival` of the one-screen arrival is removed: nothing calls it once the screens use `/visit`.

The booking payloads of the plugin (`GET /:id`, `GET /planning-events`, the list) gain `visit: { saleRef, totalCents, paidCents, remainingCents }` when the money is on a document, `noShow`, and `cardState: { state: 'toCollect'\|'remaining'\|'paid'\|'absent', label, remainingCents }` (rule 22: « À encaisser », « Reste 13,00 € », « Payé », « Absent »). The booking dialog's `POST /:id/payment` pays the document's whole reste when the booking has one; `DELETE /:id/payment` answers 409 `SALE_PAYMENT` for document money; `DELETE /:id` cancels the document of an unpaid visit (rule 26) and answers 409 `BOOKING_PAID` when the document holds money.


Loop t1 additions (2026-11-15, rules 44-46): every visit payload carries `invoiceable: { ok, code, reason } | null` (admin; `null` for the reception), `newSale: { client: { id, label, kind } } | null`
(an invoiced visit) and `access.withdrawLink`; for the reception `paymentLink.email` is `null` beside `hasEmail: boolean`, a matched client is `{ kind: 'match' }`; `paymentLink.open.expiresLabel` and the minted
`link.expiresLabel` (« 16/11 à 14:30 », Europe/Paris); `PATCH /:id/visit/lines/:lineId` 409 `LINE_PAID` carries `refundCents`; `POST /:id/visit` 403 `ADMIN_ONLY` for the reception's `invoice` / `billing`,
its `invoice` answer may be `{ ok: false, code: 'REFUND_OWED' }`; `POST …/email` answers `recipientEmail: null` to the reception; the booking payloads of `GET /:id` and the booking writes carry
`actions: { noShow: boolean }`. Core: `GET /api/standalone-sales` rows carry `soldDayLabel`, the answer `owedTitle`; `GET /api/standalone-sales/vat-rates` classes carry `label`; a document's
`refundObligations[].origin` is `linkSurplus` or `lineLowered`.

Core routes (outside the plugin), authenticated. **The sale core of PR C (C33)**, admin only, the server of the « Vente hors séjour » counter dialog and the service the visit builds on
(`standaloneSale` SDK module: `quote`, `sell`, `offerLine`, `removeLine`, `pay`, `cancel`, `documentOf`, `paymentsOf`; the request also takes `fulfilments`, the lines a
plugin's family priced for a booking it fulfils — the session, stored with its `fulfilmentRef` and its parts as `components` — and `paidElsewhere`, the lines paid outside the document
before it existed, counted by SETTLEMENT through one allocation and never stored; `standaloneSaleLinks.draftLinkOf({ remainingCents, email })` answers the link block of a sale not
written yet):

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/api/standalone-sales/quote` | `{ lines: [{ articleRef, quantity, offered? }], customer?: { name?, email?, registerAsClient? }, saleId? }` | `{ document, customer: { clientId, label, kind: 'passage'\|'match'\|'new'\|'registered' }, refusals: [{ articleRef, code, message }], quoted: true }` | no write; `refusals`: `ARTICLE_UNKNOWN`, `NOT_SELLABLE`, `NEEDS_STAY`, `QUANTITY_OUT_OF_BOUNDS` « Quantité : 1 à 99. », `VAT_RATE_UNKNOWN` |
| POST | `/api/standalone-sales` | the quote body + `acceptedTotalCents?`, `version?` (with `saleId`, to append), `payment?: { tenders, shortfall: { kind: 'due' } \| null, paidAt? }` | `{ document }` | 400 with the first refusal's `code` and `refusals`; 409 `PRICE_CHANGED` « Prix modifié — relire le panier »; 400 `NAME_REQUIRED`, `EMAIL_INVALID`, `TENDERS_INVALID`, `WAIVED_REFUSED`; `standaloneSale.sold` after the commit |

`document` is the document form of `saleDetail` (`buildDocumentDetail`): `{ document: { ref, id, status: 'paid'\|'due'\|'cancelled', version, soldAt, originRef, customerName, customerEmail, client: { id, label, kind } },
lines: [{ id, ref, kind: 'session'\|'extra', label, detail, quantity, unitCents, totalCents, catalogueCents, offered, status: 'paid'\|'due'\|'offered'\|'cancelled', statusLabel, settledCents, vatClass, vatRate, vatCents, fulfilmentRef }],
groups: [{ id, label, count, title, totalCents, refs }], totals: { totalCents, paidCents, remainingCents, refundOwedCents }, vatByRate: [{ rate, vatCents }] }`. The service actions beyond sell are SDK-only
(`offerLine(saleId, lineId, { offered, confirmRefund, version })` → 409 `LINE_PAID` « Ligne payée : remboursement à confirmer. »; `removeLine`; `pay(saleId, { tenders, shortfall, paidAt, version, source })`; `cancel(saleId)`),
the roles (`ADMIN_ONLY`, the window) being the visit controller's (C37).

C38 additions to the core routes of the counter (admin): `GET /api/standalone-sales?day=YYYY-MM-DD` → `{ day, sales: [{ id, ref, clientLabel, lines: ['Bière locale × 2'], totalCents, remainingCents, statusLabel: 'Payée' | 'Reste 5,00 €' | 'Offerte' | 'Annulée', tone: 'paid' | 'due' | 'off', refundObligations: [{ id, amountCents, label, detail }] }], owed: [same rows] }` (« Ventes du jour », the Paris day, newest first; `owed` = the counter's documents of any day with an open obligation, rule 41 amended V-4); `PATCH /api/standalone-sales/:id/obligations/:oid { status: 'settled' | 'cancelled' }` → `{ document, sale, paymentLink }` (« Marquer remboursé », rule 41); the quote answers `paymentLink` (the block of the draft: `draftLinkOf`) and the sale answers `{ document, sale, paymentLink }` (`sale` = the day's row in the counter's words); `POST /api/standalone-sales/:id/payment-link { email? }` → `{ document, sale, paymentLink, link }`, `DELETE …/payment-link/:linkId` → `{ document, sale, paymentLink }`, `POST …/payment-link/:linkId/email` → `{ sent, recipientEmail }` (rules 39-42, the e-mail on the click only). `GET /api/suggested-articles/catalogue?customerContext=&q=&context=&all=` → `{ articles: [{ articleRef, label, unitCents, unitLabel, max, category, sellable?, reason? }], groups: [{ category, articles }] }` (« Autre article » renders `groups`, like the visit's search; `unitLabel` is what a unit is counted in, « l’unité », « par personne »…; `context=<kind>:<id>` must be a context its kind lists, else 400 `CONTEXT_UNKNOWN`, and takes the customer from the kind; `all=1` also lists the articles the customer may not buy, `sellable: false` with their `reason` and no price, specs/site/site-outside-resource-booking.md §3.H rule 36); `GET /api/settings/suggested-articles` also names each listed article (`contexts[].articles: [{ articleRef, label, unitCents, unitLabel, reason }]`, `reason` set when the article is refused or cannot be priced now) and says where a list shows (`contexts[].shownOn`: `['arrival']` or `['arrival', 'site']`, §3.H rule 35); the save of a list for a customer with no stay answers 400 `ARTICLE_NEEDS_STAY` (`{ error, code, articleRef }`) for an article the engine does not sell outside a stay.

Core routes (outside the plugin), authenticated:

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/suggested-articles?kind=&id=&customerContext=` | — | `{ suggestions: [{ articleRef, label, unitCents, max }] }` | rule 36; the same call the stay SAS follow-up will make |
| GET | `/api/settings/suggested-articles` | — | `{ kinds: [{ kind, label, contexts: [{ id, label, articleRefs: [] }] }] }` | admin; rule 37 |
| PUT | `/api/settings/suggested-articles/:kind/:id` | `{ articleRefs: [] }` | `{ context }` | admin; ≤ 12, 400 `ARTICLE_UNKNOWN`, 404 for a context no provider lists |

---

## 5. Data model

Preferred: the refonte's tables (`standalone_sales`, `standalone_sale_lines` of PR C, `payment_allocations` of
PR B). This spec adds only what they lack, each in an idempotent block (`ADD COLUMN` after a `PRAGMA table_info`
check; `CREATE TABLE IF NOT EXISTS`).

| Table | Column / table | Type | Default | Meaning |
|---|---|---|---|---|
| `standalone_sales` | `clientId` | INTEGER NULL | NULL | rule 8 (if PR C does not already add it for rule 74) |
| `standalone_sales` | `originRef` | TEXT NULL | NULL | `resource-booking:<id>`; NULL for a counter sale |
| `standalone_sales` | `version` | INTEGER | 0 | bumped on every write (concurrent commit, rule 21) |
| `standalone_sales` | invoice + attachment columns | as on `resource_bookings` (invoicing §5), provider-neutral: no `qonto*` column (end review R3-9 — the invoice of a visit stays on `resource_bookings` in `hourly-resources`; a core table names no provider) | NULL | rule 31 |
| `standalone_sale_lines` | `offered` | INTEGER | 0 | rule 13 |
| `standalone_sale_lines` | `catalogueCents` | INTEGER NULL | NULL | value kept for the struck display |
| `standalone_sale_lines` | `components`, `vatClass`, `family`, `soldAt`, `source`, `cancelledAt` | TEXT | NULL | the rule-74 snapshot (if PR C stores fewer) |
| — | `standalone_sale_payments` | `id, saleId, paidAt, tendersJson, receivedCents, shortfallCents, shortfallKind, recordedAt, createdBy` | — | one row per payment; `payment_allocations.paymentRef = 'standalone-payment:<id>'` |
| `resource_bookings` (plugin `resource_bookings_v6`) | `saleRef`, `noShowAt` | TEXT NULL | NULL | rules 34, 27 |
| — | `suggested_articles` | `id, contextKind TEXT, contextId TEXT, articleRef TEXT, position INTEGER`, `UNIQUE(contextKind, contextId, articleRef)` | — | rule 37; core table, additive |
| `options`, `resources` | `vatClass` (TEXT NULL), `clients.isPassage` (INTEGER 0), table `vat_external_rates(vatClass PK, rate)` | NULL, 0 | — | PR C (C33): the article's VAT class (`options`, `resources`, `drinks`, `catering`), the shared « Passage » client, the external rate of a class (`vat.rate.<class>.external`) |
| `standalone_sales` | `customerEmail`, `customerName` | TEXT NULL | NULL | rules 8a, 39 (if PR C does not already store them, refonte rule 53); cleared by the anonymisation |
| `email_log` | `saleRef` (and `reservationId` nullable) | TEXT NULL | NULL | rule 42, amended 2026-11-12: the link e-mail is logged like every other |
| `payment_links` | `saleRef` | TEXT NULL | NULL | the document a link bills (rule 40); `reservationId` becomes nullable for those rows. **`reservationId` is `NOT NULL` today** (`database.js`): the table rebuild is done once, in PR C, which already owes a standalone link target (refonte rule 53), and is verified on a copy of production before merge |
| `standalone_sale_payments` | `source` | TEXT NULL | NULL | `payment-link:<id>` for rule 41 |
| — | `standalone_sale_obligations` | `id, saleId (FK CASCADE), origin ('linkSurplus', 'lineLowered' since rule 44), paymentLinkId UNIQUE, amountCents > 0, reason, lineRef (rule 49 reading, loop t2: the line a `lineLowered` row was opened for, NULL otherwise), createdAt, status ('open'/'settled'/'cancelled'), settledAt, settledBy ('system' for a row rule 53 cut to nothing)` | — | rule 41 amended 2026-11-15: the surplus of a link paid after the reste moved, one row per link (`refund_obligations` has `reservationId NOT NULL`, same reasoning as the payments table) |
| `payment_allocations` | refund rows of a document | `paymentRef 'standalone-refund:<row>'` (`…:internal`), `kind 'refund'`, negative, `refundId` = the obligation row | — | rule 48: the money a `lineLowered` row gave back (no new column) |
| `email_templates` | `visit_payment_request` | row | seeded FR, EN, `sendMode 'manual'` | rule 42 |
| `plugin_settings` (`accounting-export`) | `drinksRevenueAccount` | TEXT | `''` | rule 43 |

**Why a new payments table rather than `payment_settlements`:** that table has `reservationId NOT NULL` and a
`CHECK` on `targetKind`; widening either needs a table rebuild of a money table, which this spec refuses for a
feature that can live beside it. The tender lines keep the shape `validateSettlement` returns.

**Backfill:** none on amounts. Bookings paid before (rule 34) get no document; `saleRef` stays NULL and their
journal rows are unchanged. **Data impact:** additive only; no existing amount, journal month or invoice moves.

## 6. UI / UX

The owner decides on the interactive mock in
[`docs/rapports/2026-11-12-outside-booking-sas.html`](../../docs/rapports/2026-11-12-outside-booking-sas.html).
Design system « Maison » (`specs/design-system/design-system.md`): fir-green primary, paper background, serif section headers,
amounts in sans `tabular-nums`, radius 14.

**Mini SAS (dialog `ResourceArrivalDialog`)** — title « Arrivée · {displayName} », caption « {resource} · {day} ·
client sans séjour »:
1. **Sa séance** — the session lines, « Temps offert » stepper (15 min), « Offrir » on the line.
2. **Proposés à l'arrivée** — the generic `SuggestedArticlesStep` (rule 35): suggestion chips (« Bière locale 6,50 € »…), « Autre article » search; added lines below with
   a quantity stepper (− / +, ≥ 44 px), « Offrir », « Retirer » (unpaid only).
3. **Récapitulatif** — « Total », « Déjà payé », « Reste à payer » (largest figure), « dont TVA 20 % : … ».
4. **Paiement** — « Encaisser » / « Pas maintenant » / « Envoyer un lien »; `TenderLines` on the reste; under it, the shortfall choice
   « Reste à percevoir » only. « Envoyer un lien »: absent without a ready provider; disabled with « Adresse e-mail requise. » and an « E-mail » field
   without an address; once minted: « Lien · {amount} · valable jusqu'au {date} », « Copier le lien », « Envoyer par e-mail », « Retirer le lien ».
5. **Facture** — as today, offered once the reste is 0.
Primary action « Valider l'arrivée » (first commit) or « Enregistrer » (reopened); « Annuler » writes nothing.

**Copy (French, short, impersonal):** « Sa séance », « Proposés à l'arrivée », « Autre article », « Offrir », « Offert »,
« Retirer », « Déjà payé », « Reste à payer », « Rien à encaisser. », « Reste à percevoir », « Pas maintenant »,
« Valider l'arrivée », « Client absent », « Reste {x} », « Ligne payée : remboursement à confirmer. »,
« {x} à rembourser », « Quantité : 1 à {max}. », « Les moyens font {x} pour {y} dus. », « Geste commercial :
offrir une ligne. », « Prix modifié — relire le panier », « Facturée : nouvelle vente séparée. », « Reste à
payer : facture après le solde. », « Envoyer un lien », « Adresse e-mail requise. », « E-mail »,
« Copier le lien », « Lien copié », « Envoyer par e-mail », « Retirer le lien », « Lien envoyé à {e-mail} »,
« Rien à encaisser. », « Compte des boissons à renseigner avant l'export. ».

**Settings page (Réglages → Options & ressources → « Proposés à l'arrivée »):** one card per context (« Bain nordique »…), articles as reorderable rows (drag, or ↑ / ↓ buttons ≥ 44 px), « Ajouter un article », limit message « 12 articles au plus. »; on `xs` the cards stack and the rows keep their buttons.

**States:** loading (`LoadingState` in the dialog), load error (`ErrorAlert` + « Réessayer »), quote pending (figures
dimmed, action disabled), refusal (field in error, message under it, action disabled), committed (dialog closes,
planning reloads), invoiced (read-only, notes editable), window closed for reception (read-only banner).

**Responsive:**
- `xs` (≤ 600 px): full screen; the « Reste à payer » figure sticky at the top (today's sticky total); suggestion
  chips wrap; each line stacks label / `qty × unit` / total + actions; the stepper and « Offrir » ≥ 44 × 44 px;
  « Valider l'arrivée » filled, last, full width at the bottom under the thumb (StepperPage / SAS rule); no
  horizontal scroll.
- `md` (~900 px): dialog `maxWidth="sm"`, single column, the recap at the bottom of the content.
- `lg` (≥ 1200 px): dialog `maxWidth="md"`, two columns — lines and picker left, recap + payment right, sticky.

**Motion:** a line added fades and rises 4 px (150 ms ease-out); the reste figure changes without animation of the
number; `prefers-reduced-motion` → no movement.

**Choices of the screens (C38) — what M4 and M5 did not settle, the closest reading taken:**
- The « Proposés à l'arrivée » lists are reordered with the ↑ / ↓ buttons only (the drag of rule 37 is a second way of the same thing); the page is a core tab of Options & ressources (« Réglages → Options & ressources »).
- The mini SAS asks nothing of the client (rule 9): no « Client » block; the one e-mail field is the one under « Envoyer un lien » (rule 39). The counter dialog has the M4 « Client » block (name, e-mail, « Enregistrer comme client »).
- A reopened visit starts on « Pas maintenant » (closing it collects nothing); the first arrival starts on « Encaisser » with the card for the whole reste. The primary action reads « Valider l'arrivée » (first), « Enregistrer » (a change to save), « Créer la facture » (money on the books, no invoice) or « Fermer ».
- « Envoyer un lien » bills the stored document, so while an article is added and not saved the block is disabled and says « Enregistrer d'abord les articles ajoutés. ». In the counter dialog the link is created in the same click as the sale (« Enregistrer et créer le lien »): M4 drew the link before saving, which the server cannot do.
- The quote is asked only when the draft says something the loaded visit does not (an extra, the session offered, another offered time); otherwise the screen renders the loaded payload.
- The counter dialog lists the whole sellable catalogue as chips and searches it with « Autre article » (the same step as the mini SAS), instead of M4's search-first list; the external rate field shows the class's current rate and sends one only when retyped (the server accepts two decimals, M4 one).
- On a phone the Suivi financier bar keeps its single « Actualiser » icon (the shell gives a lone icon to the top bar, shell-and-home-day-first rule 23); « Vente hors séjour » is the icon of the bar from `sm` up and, on every width, the button of the day's card.
- The reception's planning events carry `external`, `arrived`, `noShowAt` and `cardState` (door money only) so the card can offer « Arrivée » and say « Reste … ».
- A line already paid asks the administrator's confirmation through `ConfirmDialog` (« Ligne payée : remboursement à confirmer. »); the reception is never asked, the server's 403 is shown as it is.

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `tests/standalone-sale-paid-line-refund.unit.test.js` — rules 44, 45 (loop t1 B-1, UI-18): a paid line lowered or a paid document cancelled opens one `lineLowered` row, closed by « Marquer remboursé », the counter's owed rows titled and dated
- [x] `tests/pricing-sales-document-obligations-widened.unit.test.js` — rule 44: the obligations table widened once, rows kept
- [x] `tests/standalone-sale-refund-journal.unit.test.js` — rule 48 (B-1): the refund allocations of a `lineLowered` row settled, the avoir of the refund day, the caisse interne kept off, nothing refunded twice
- [x] `tests/standalone-sale-kept-surplus-tip.unit.test.js` — rule 49 (B-6): a link surplus kept is a tip on the day it is kept, on the tip account; refunded, it books nothing
- [x] (loop t4, rule 56) `tests/standalone-sale-kept-lowered-line.unit.test.js` (5), `tests/standalone-sale-cancel-refund-order.unit.test.js` (4), `tests/standalone-sale-quote-plan.unit.test.js` (2), `tests/standalone-sale-money-conservation.unit.test.js` (1, 300 sequences × 12 steps), `plugins/hourly-resources/tests/visit-invoice-internal-held.unit.test.js` (2), `plugins/online-payment/tests/invoice-issuer-vat-per-group.unit.test.js` (5)
- [x] `tests/standalone-sale-kept-surplus-paris-day.unit.test.js` — rule 50 (loop t4): a surplus kept at 00:30 Paris is a tip of that Paris day
- [x] (loop t5, rule 57) `tests/standalone-journal-backdated-payment.unit.test.js` (3, incl. 25 lives × 20 steps), `plugins/online-payment/tests/invoice-issuer-folded-rounding.unit.test.js` (3, incl. 4 000 baskets), `plugins/hourly-resources/tests/booking-invoice-vat-booking-journal.unit.test.js` (4, incl. ≈ 1 700 breakdowns)
- [x] `plugins/hourly-resources/tests/visit-round1-reception-and-refunds.unit.test.js` — rules 44-46 (AV-1 to AV-8, AV-10, AV-11): the row and the invoice refusal, reception privacy, billing in the commit, `invoiceable`, `newSale`, the document's client follows the booking
- [x] `plugins/hourly-resources/tests/booking-actions-no-show.unit.test.js` — rule 45 (UI-9): `actions.noShow` by day and role
- [x] `tests/sale-link-expires-label.unit.test.js` — rule 45 (UI-15): the Paris label of a link's end
- [x] `plugins/hourly-resources/tests/outside-vat-rate-one-home.unit.test.js`, `visit-money-blocks-deletion.unit.test.js`, `visit-money-survives-purge.unit.test.js` — rule 47 (B-3, D-3, D-4)
- [x] `plugins/hourly-resources/tests/visit-window-and-roles.unit.test.js` — rules 1, 5, 7 (window `D+1 04:00`, reception allowed then read-only, `ADMIN_ONLY`)
- [x] `plugins/hourly-resources/tests/visit-lines.unit.test.js` — rules 10-12, 14 (session line from the `hourly` family, suggestions, `NEEDS_STAY` never listed, quantity bounds, append after commit)
- [x] `plugins/hourly-resources/tests/visit-offer.unit.test.js` — rule 13 (whole-line offer on session and extra, offered time kept as component, `waived` refused)
- [x] `plugins/hourly-resources/tests/visit-remaining-and-payment.unit.test.js` — rules 15-19 (remaining from SETTLEMENT, partial `due`, over-payment refused, allocation order)
- [x] `plugins/hourly-resources/tests/visit-commit-reopen.unit.test.js` — rules 21-24 (one transaction, `PRICE_CHANGED`, reopen appends, invoiced read-only)
- [x] `plugins/hourly-resources/tests/visit-refund-cancel-noshow.unit.test.js` — rules 25-27
- [x] `plugins/hourly-resources/tests/visit-legacy-money.unit.test.js` — rule 34 (paid before: session « Payée », extras on a new document, journal unchanged)
- [x] (loop t2, rule 51) `plugins/hourly-resources/tests/visit-round2-row-actions-and-invoice-reason.unit.test.js` (4) — the rows', cards' and no-show answer's `actions`, the silent refusal; `tests/catalogue-external-rate-emptied.unit.test.js` (1) — an emptied rate refused
- [x] `plugins/hourly-resources/tests/visit-card-batch-once.unit.test.js` — rule 32 (no double listing)
- [x] `plugins/hourly-resources/tests/visit-invoice-document.unit.test.js` — rule 31 (all lines, `REMAINING_DUE`, money guard)
- [x] `plugins/hourly-resources/tests/visit-invoice-whole-visit.unit.test.js` — rule 31, reading of 2026-11-15 (a session paid on the booking and the document's extras: one invoice; no document: the booking's invoice unchanged)
- [x] `tests/standalone-sale-visit-vat.unit.test.js` — rules 28-29, 33 (external context, rate frozen at sale, franchise, no tourist tax)
- [x] `plugins/accounting-export/tests/standalone-visit-journal.unit.test.js` — rule 30 (per payment day, caisse interne out, offered out, `revenue:drinks`)
- [x] `tests/suggested-articles.unit.test.js` — rules 36-37 (context key, order, `external` / `hosted` sellability filter, dropped when sold out of the catalogue, `ARTICLE_UNKNOWN`, 12 max, plugin off hides its kind, rows kept)
- [x] `plugins/hourly-resources/tests/visit-suggestion-contexts.unit.test.js` — rule 37 (resources listed as `resource` contexts; no list in the plugin's settings)
- [x] `tests/standalone-sale-payment-link.unit.test.js` — rules 39-41 (provider not ready: absent; no e-mail: disabled; amount = SETTLEMENT reste, never the request's; reuse same amount, withdraw on drift; 36 h validity; paid after close writes payment + allocations; surplus → refund owed + alert; cancelled document)
- [x] `tests/visit-payment-request-template.unit.test.js` — rule 42 (`sendMode manual`, not in `AUTO_SEND_EXCEPTIONS`, `autoSendPolicy` false, minting sends nothing, one send per click, history entry, no `email_log` row)
- [x] `plugins/accounting-export/tests/drinks-account-required.unit.test.js` — rule 43 (refused with a drink and no account, accepted with an account or no drink)
- [x] `tests/plugin-boundary-outside-visit.unit.test.js` — rules 2-3 (plugin off: documents readable; no resource or platform name in code)
- [x] (C38) `tests/standalone-sale-counter-routes.unit.test.js` — rules 11, 37, 39-42 (the catalogue search, « Ventes du jour », the quote's and the sale's link block, the counter's link routes, nothing mailed by minting); `plugins/hourly-resources/tests/visit-articles-search.unit.test.js` — rule 11 (« Autre article », reception included); `…/visit-invoice-explicit.unit.test.js` — invoicing rule 45 and rule 25 on the visit's commit (replaces `booking-arrival`, `booking-arrival-day`, `booking-invoice-explicit` with the old route); `visit-window-and-roles` gains the `access` flag, `visit-lines` the `invoiceReady` flag

### Client (Vitest, one file per subject)
- [x] `plugins/hourly-resources/__tests__/ResourceArrivalDialog.extras.test.jsx` — add, stepper bounds, refusal shown, « Autre article »
- [x] `…/ResourceArrivalDialog.remaining.test.jsx` — figures rendered from the payload, never computed; « Rien à encaisser. »; « Reste à percevoir » only
- [x] `…/ResourceArrivalDialog.offer.test.jsx` — offered line struck, paid line asks confirmation, the reception is never asked
- [x] `components/__tests__/SuggestedArticlesStep.generic.test.jsx` — rule 35 (renders any `suggestions`, no resource or stay wording, refusal shown, quantity bounds)
- [x] `components/__tests__/SalePaymentLink.states.test.jsx` — rules 39-42 (four states, disabled hint, copy, e-mail only on click)
- [x] (loop t4, rule 56 d; loop t6 UI6-4) `plugins/hourly-resources/__tests__/ResourceArrivalDialog.planned-rows.test.jsx` (3) — the quote's rows while a draft is typed, « Marquer remboursé » disabled; offered minutes alone read « les modifications »
- [x] `pages/settings/__tests__/SettingsSuggestedArticlesSection.test.jsx` — rule 37 (reorder, limit message, unknown kind hidden)
- [x] `…/ResourceArrivalDialog.mobile.test.jsx` — full screen, sticky reste, action last, 44 px, read-only with the server's reason (a new file: the arrival dialog had no mobile suite)
- [x] `components/__tests__/TenderLines.shortfall-kinds.test.jsx` — only « Reste à percevoir » offered
- [x] (C38) `plugins/hourly-resources/__tests__/ResourceArrivalDialog.test.jsx`, `.paid-before.test.jsx`, `.no-unasked-invoice.test.jsx` — the three former suites, moved onto the visit routes; `arrivalVisitFixtures.jsx` — their shared fixture
- [x] (C38) `components/__tests__/StandaloneSaleDialog.counter.test.jsx`, `StandaloneSalesTodayCard.list.test.jsx`, `ExternalSaleFields.fields.test.jsx`; `plugins/hourly-resources/__tests__/ResourceBookingDialog.no-show.test.jsx`; `PlanningResourceCard.test.jsx` gains the « Reste » and « Absent » cases; `SuggestedArticlesStep.worst-case.test.jsx` — the break-ui pass (a 120-character label, an emoji-first label, 99, 1, none, a thousand results)
- [x] (loop t2, rule 51) `ResourceBookingDialog.no-show.test.jsx` (rewritten on the row's `actions`, no second read, 5), `PlanningResourceCard.test.jsx` and `PlanningResourceCard.open-booking.test.jsx` (« Arrivée » on `actions.arrive`), `ResourceArrivalDialog.invoice-reason.test.jsx` (2), `pages/options/__tests__/externalSaleForm.emptied-rate.test.js` (1); named after the fact (P2-2): `ResourceArrivalDialog.withdraw-link.test.jsx` — rule 45 (`access.withdrawLink`)
- [x] (loop t2, rules 49 reading, 52-54) server `standalone-sale-lowered-line-in-step` (6), `pricing-refunds-document-rows` (7: +1 loop t5 D5-4), plugin `visit-draft-invoiceable` (4); client `ResourceArrivalDialog.invoice-from-server.test.jsx` (2), `ResourceBookingDialog.invoice-from-server.test.jsx` (2); the arrival suites' quote fixtures answer `invoiceable` for a payment typed
- [x] (loop t3, rule 54 reading) plugin `visit-draft-invoice-reason` (3); client `ResourceArrivalDialog.invoice-answer.test.jsx` (8: +2 loop t4 UI4-3, +1 loop t5 UI5-2, +1 loop t24 UI24-2), `ResourceBookingDialog.invoice-answer.test.jsx` (6: +2 loop t4 UI4-3, +1 loop t24 UI24-2); loop t23 S23-1: the arrival's UI4-3 / UI5-2 and the booking's UI4-3 rewritten for a failed draft that keeps no figure, same counts
- [x] (loop t25, rule 54 reading of 2026-11-19) `plugins/hourly-resources/__tests__/InvoiceBlock.pending-answer.test.jsx` (4) — the visit's and the booking's « Facture » block pending (checkbox disabled as left, address kept) until the fresh answer for the payment typed, slow and refused
- [x] (loop t26 UI26-1, plugins-phase-1-sdk rule 54 reading of 2026-11-19) `hooks/__tests__/useLatestPreview.non-amount-fields.test.jsx` (8) — the counter sale (rule 8a): the e-mail, the name and « Enregistrer comme client » typed key by key keep the Total, the payment and the typed tender lines (and, in « Envoyer un lien », the mode switch); the quote carries an address once it is one, « Enregistrer comme client » once a name is there
- [x] (loop t1, rule 48) `plugins/hourly-resources/__tests__/ResourceBookingDialog.no-show.test.jsx` (rewritten on `actions.noShow`, 4), `ResourceArrivalDialog.invoiceable.test.jsx` (3), `ResourceArrivalDialog.vat-rate.test.jsx` (2), `ResourceArrivalDialog.new-sale.test.jsx` (2); `components/__tests__/SalePaymentLink.expires-label.test.jsx` (3), `StandaloneSalesTodayCard.owed-day.test.jsx` (2), `ExternalSaleFields.server-labels.test.jsx` (2)

### E2E
- [x] `e2e/specs/planning/outside-visit.spec.js` — book a walk-in session, open « Arrivée » on its day, add 2 drinks, offer 1, partial card payment with reste, card shows « Reste », reopen, pay the reste; with Qonto not connected no invoice reason nor « Créer la facture dans Qonto » is shown (rules 51 b, 54; loop t2); _(the link part is not run: the E2E database never connects a provider; the spec asserts the block absent. A second E2E, `finance/standalone-sale.spec.js`, covers the counter dialog.)_

- [x] (C38) `e2e/specs/finance/standalone-sale.spec.js` — the counter dialog at 1280 and 390 px: quantity bound, invalid e-mail, partial card payment, « Nouvelle vente », the day's list; `e2e/specs/settings/suggested-articles.spec.js` — rule 37: add, reorder, save, the server's order

### Manual UI verification
- [x] Desktop 1280 px and mobile 390 px: no horizontal scroll, sticky reste, thumb action, 44 px targets _(by E2E, both specs, and `ResourceArrivalDialog.mobile`)_
- [x] Session paid at booking time + drinks at the counter → reste = drinks only _(server: `visit-legacy-money`; screen: `ResourceArrivalDialog.paid-before`)_
- [ ] Qonto sandbox: link for the reste, paid after the sas is closed → card « Payé », journal on the payment day; link withdrawn after a line is offered
- [x] Réglages → Options & ressources → « Proposés à l'arrivée » on desktop and 390 px _(E2E `settings/suggested-articles.spec.js`)_
- [ ] Reception account: commit inside the window, read-only after `D+1 04:00`
- [ ] Regression: stay SAS (bath sessions of a stay), booking dialog, planning cards, journal of a past month

## 8. Out of scope

- The planning card of a bath booking using the font size and order of information of a check-in card (done in
  4.0.0).
- The counter dialog « Vente hors séjour » of Encaissements (refonte PR C) — this spec only reuses its sale service.
- Mounting the generic « Proposés à l'arrivée » step in the stay arrival SAS (rule 38): a follow-up spec; the design here keeps it open.
- Any automatic e-mail: the link e-mail is a manual click (rule 42).
- Line discounts (percent / amount, refonte rule 39) in the mini SAS: « Offrir » and the offered time cover the
  counter gesture.
- Tips (« pourboire ») and stock counts of drinks.
- Booking another session or moving the slot from the mini SAS (invoicing Q10, unchanged).
- Migrating the money of bookings paid before this release onto documents (rule 34).
- Credit notes (avoirs): a paid invoice is corrected in Qonto by hand (invoicing §8).

## 9. Open questions — resolved

All nine were decided by the owner on **2026-11-12**. Nothing is open.

- **Q1. The sale document of a visit — A.** One standalone sale per visit, the session being one of its lines with
  the booking as its fulfilment (`fulfilmentRef`). One remaining amount, one invoice, one allocation table (rules
  10, 34). Amends refonte §8 for new bookings only.
- **Q2. The day window — A.** The stay SAS window `D 00:00 → D+1 04:00` (rule 5).
- **Q3. Reception — A.** Reception opens and reopens the mini SAS inside the window; paid-line changes and refunds
  are admin only (rule 7).
- **Q4. Client of an outside visit — A.** The booking's registered client; otherwise « Passage », and a record is
  attached only on an exact e-mail match or created when « Enregistrer comme client » is ticked (rule 8a).
- **Q5. Which articles are suggested — A, amended by the owner.** A per-resource list « Proposés à l'arrivée », but
  as a **generic, reusable SAS step** that the stay arrival SAS can mount later: a suggested-articles provider keyed
  by sale context, a generic settings home, one generic client component (rules 35-38). Mounting it in the stay SAS
  is a follow-up, not this spec.
- **Q6. Qonto link for a reste — B.** « Envoyer un lien » when an e-mail is known
  and online payment is live, on the existing payment-link machinery; the amount is SETTLEMENT's reste; a link paid
  after closing settles the sale; no e-mail ever leaves by itself (rules 20, 39-42).
- **Q7. No-show — A.** « Client absent » cancels unpaid lines, keeps money taken, refund only by an explicit admin
  action (rule 27).
- **Q8. Account of drinks revenue — A.** A setting of `accounting-export`, empty by default, required before the
  first export holding a drink (rule 43).
- **Q9. Delivery — B.** Inside refonte **PR C**, as part of its external-sale
  work, not a separate PR (§10). PR C grows; the refonte allows cutting the external sale out of C, not adding to
  it, so the PR C row of `pricing-components.md` §ordering is amended in the same PR (see §10).

## 10. Implementation progress

- 2026-11-12 — Draft written on `docs/outside-booking-sas` (from `feature/pricing-components-a`). Nothing
  implemented.
- 2026-11-12 — Owner decided Q1-Q9 (§9); status Approved. Q5 became a generic step (rules 35-38), Q6 an « Envoyer un
  lien » action (rules 39-42), Q8 a guard (rule 43). Rules 35-43 appended; rules 5, 7, 8, 11, 20, 27, 30 reworded in
  place, numbers kept.
- 2026-11-13 — Server pass 5 on `feature/pricing-components-c`: C33 (the sale core and the `/api/standalone-sales` routes, §4.3), C34 (rules 30, 32, 43: the documents in the journal and the card batch, the plugin's `bookingsModel.standaloneSales` skips a booking with a `saleRef`, the `drinksRevenueAccount` setting and the 409 `DRINKS_ACCOUNT_REQUIRED` guard of the CSV, the sales JSON and the synthesis; the class → account map is `accommodation`/`options`/`customOptions`/`catering` → 70600010, `resources`/`activities` → 70601000, `drinks` → the setting). Rules 1-9, 20, 27, 31, 34 (the visit's screen and money) wait for C37.
- 2026-11-13 — C35 (rules 39-42): `utils/standaloneSaleLinks.js` (SDK `standaloneSaleLinks`: `linkOf` → the `paymentLink` payload `{ available, reason: 'PROVIDER_NOT_READY' | 'NO_EMAIL' | 'NOTHING_DUE' | null, email, open: { id, url, amountCents, expiresAt } | null }`, `mint(saleId, { email })` → `{ link: { id, url, amountCents, expiresAt, status, reused }, document }` or 409 `NOTHING_DUE` / `NO_EMAIL` / `PROVIDER_NOT_READY` / `LINK_ALREADY_PAID`, `withdraw(saleId, linkId)`, `emailLink(saleId, linkId)` → `{ sent, recipientEmail }` or 409 `NO_EMAIL` / `TEMPLATE_DISABLED` / `LINK_NOT_OPEN`), the paid effect in `applyPaidEffect` (`standalone-sale-settled`, `standalone-sale-refund-owed` + admin e-mail and push), `standaloneSale.receive` for money that arrives outside the tenders, the document `history` (« Vente enregistrée », « Bière locale ×2 ajoutée », « 12,00 € encaissés : CB », « Lien envoyé à … »). A refund owed on a document is computed (`refundOwedCents` = received − what the lines ask − given back), not a row of `refund_obligations` (whose `reservationId` is NOT NULL).
- 2026-11-13 — C36 (rules 35-38, server): `utils/suggestedArticles.js` (SDK `suggestedArticles`: `kinds`, `resolve({ context, customerContext, stay })`, `save`, `settingsView`), `models/suggestedArticlesModel.js`, `controllers/suggestedArticlesController.js`, `routes/suggestedArticles.js` (`GET /api/suggested-articles`, `GET` and `PUT /api/settings/suggested-articles[/:kind/:id]`, §4.3), `ctx.suggestionContexts({ kind, label, list })` (SDK 2.32.0), `hourly-resources` declaring the kind `resource` (its `per_hour` resources placed on a planning); the core declares `property`. Saving answers 404 `CONTEXT_UNKNOWN`, 400 `ARTICLE_UNKNOWN` / `ARTICLE_DUPLICATE` / `TOO_MANY` (« 12 articles au plus. »). The catalogue forms carry `sellableExternally`, `vatClass` and `externalVatRate` (the rate of the whole class, `GET /api/standalone-sales/vat-rates` lists them): the server answers 422 `NEEDS_STAY` for an article of a family that reads the stay and 422 `EXTERNAL_RATE_REQUIRED` for a class with no external rate (franchise excepted).
- 2026-11-13 — C37 (rules 1-5, 7, 20, 27, 31, 34 delivered; 6, 9, 35 wait for the screens of C38): `plugins/hourly-resources/visitModel.js`, `visitController.js`, the visit routes of §4.3 (`hourly-resources` 1.7.0), the reception entries of rule 7, `bookingsModel` (`enrich` with `visit` / `cardState`, the document's money in `recordArrival`, `recordPayment`, `clearPayment`, `update`, `remove`), `invoicing.issueDocument`, `planningCardsModel.bookingCardState`; core: the `fulfilments` and `paidElsewhere` lines of `standaloneSale` (`externalSale` pipeline: `loadCatalogue` provides `fulfilments`, `externalVat` taxes them, `externalTotals` appends them), `standaloneSale.paymentsOf`, `standaloneSaleLinks.draftLinkOf`, the `components` of a session line in the document form of `saleDetail`. The three readings of 2026-11-13 (rules 13, 31, 34) are the lead's calls, listed for the owner. Server tests: 10 plugin files of §7 (46 tests) and `plugin-boundary-outside-visit` (3).
- 2026-11-13 — C38 (rules 6, 9, 35 delivered; the spec is Implemented): the screens. `ResourceArrivalDialog` on the visit routes (the old `POST /:id/arrival`, `controller.arrival` and `bookingsModel.recordArrival` are removed, nothing else calling them; their three suites move onto the visit's commit), `useVisitQuote`, `SuggestedArticlesStep`, `SalePaymentLink`, `TenderLines` `shortfallKinds`, `SettingsSuggestedArticlesSection`, `PlanningResourceCard` (`cardState`), `ResourceBookingDialog` (« Client absent »), `StandaloneSaleDialog` and its « Ventes du jour » card on the Suivi financier, the catalogue block `ExternalSaleFields`. Server additions the screens needed: the catalogue search, `GET /api/standalone-sales`, the link routes of a counter sale, `access` and `invoiceReady` on the visit payload, four fields on the reception's planning events (§4.3, `reception-role-checkin-only.md`). Counts: 59 Vitest tests in 13 new files (the eight suites of §7, the counter, its card, the catalogue block, « Client absent », the break-ui pass) beside the three arrival suites ported onto the visit routes; 17 server tests in 6 files (the old route's three suites removed). E2E: `planning/outside-visit.spec.js` (2 tests), `finance/standalone-sale.spec.js` and `settings/suggested-articles.spec.js` (1 test each) at 1280 and 390 px, 8 runs green inside the whole suite; the Options & ressources tab count of `mobile/page-tabs.spec.js` goes from 3 to 4. Not exercised: the Qonto link (the E2E database never connects a provider: the block is asserted absent) and the manual checks of §7 that need a Qonto sandbox or a reception account, left for the shadow trial.
- 2026-11-16 — stabilisation loop t2 (books): rules 52-54 and the reading of rule 49 delivered (B2-1 to B2-4, B2-7), rule 44's reference corrected (B2-6). Server: `standaloneSale.reconcile` (transfer then rows in step after every change), `refileDocumentExcess`, `documentRowsInStep`, `refundRowsOfDocument`, `standalone_sale_obligations.lineRef`, the transfer in the journal, `invoicing.draftInvoiceability`; client: the two dialogs read `invoiceable` for the payment typed. Tests: 16 server (3 files), 4 client (2 files).
- 2026-11-16 — stabilisation loop t4 (books): rule 56 delivered (B4-1 to B4-6, owner decision for B4-1). Server: `standaloneSale.writeKept` (any row
  closed « rien »), `rowsLeaving` (reserved rows), `owedOf` without `closedObligationCents`, `internalHeldOf`, `quote` on `planOf`; REFUNDS'
  `refundRowsOfDocument` `reserved`; `standalonePaymentsModel.recordKept` rows and `keptOf`; the journal's kept legs; the VAT component's `groupVatCents`;
  the Qonto issuer's per-group solve; `invoicing` `INTERNAL_CASH` on the money held. Client: the arrival dialog renders the quote's rows while dirty.
- 2026-11-16 — stabilisation loop t5 (books): rule 57 delivered (B5-1 to B5-3). Server: `standaloneDocuments.salesOfDocument` cuts in the order of writing
  (`documentsPaidBetween` hands the allocation ids), the Qonto issuer's `booking:` cut and widened folded rounding, `invoicing.requestOf` names the
  booking group. Tests: 10 server (3 files).
- **Delivery (Q9 B).** There is no separate « PR D ». The work lands in refonte PR C, in its external-sale part,
  after PR B. Order: PR B → PR C (external sale + this spec). Consequences to handle in that PR, not before:
  1. _(done 2026-11-12, commit C0)_ `pricing-components.md` PR C row and §8/ordering text gain « mini SAS of an outside visit
     (`outside-booking-sas.md`), generic `SuggestedArticlesStep`, standalone payment link » and the size estimate is
     revised; rule 53 and the API row `POST /api/standalone-sales` (`paymentLink?`) point at rules 39-41 here.
  2. The `payment_links` standalone target (§5) is one migration shared with the counter dialog's link.
  3. Cutting the external sale out of PR C (the refonte's escape hatch) would cut this spec with it; say so in the
     PR description.
- Specs to amend in the implementing PR: `resource-booking-pricing-and-invoicing.md` rules 21, 28, 35, 44 and §8
  (reste and money on a document for new bookings), `pricing-components.md` §8 and the PR C row (the session line of
  an outside visit is a document line; `resource_bookings` stays the slot), `reception-role-checkin-only.md`
  (reception on the mini SAS), `payment-link-lifecycle.md` (a link may bill a standalone document), `email-automation.md`
  or the registry's list of templates (`visit_payment_request`, manual).
