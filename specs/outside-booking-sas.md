# Mini SAS of an outside client — session, extras, what is left to pay

| Field | Value |
|---|---|
| **Status** | Approved _(2026-11-12: the owner decided Q1-Q9, §9)_ |
| **Branch** | delivered on `feature/pricing-components-c` (pricing-components **PR C**, its external-sale part, Q9 B) |
| **Created** | 2026-11-12 |
| **Author** | Adrien |
| **Related PR** | pricing-components PR C (link once opened) — target `inte/plugins` |
| **Target release** | 4.2.0, with PR C |
| **Plugins** | `hourly-resources` (owner of the screen, of the session line and of the `resource` suggestion contexts), `online-payment` (Qonto invoice and payment link), `accounting-export` (journal) |
| **Depends on** | [`pricing-components.md`](pricing-components.md) **PR B**, then **PR C**, which carries this spec (the external sale: `externalSale` pipeline, `standalone_sales`, the « Passage » client, rules 53, 74); PR B carries (lines, `payment_allocations`, SETTLEMENT on lines, REFUNDS owed, FULFILMENT port and bath adapter, `saleDetail`, `AccountingOutput`) |
| **Builds on** | [`resource-booking-pricing-and-invoicing.md`](resource-booking-pricing-and-invoicing.md) (rules 28-33: today's one-screen arrival of a resource-only guest), [`mixed-method-payments.md`](mixed-method-payments.md) (`TenderLines`, `validateSettlement`), [`sas-offer-complement-lines.md`](sas-offer-complement-lines.md) (« Offrir » gesture), [`reception-sas-today-only.md`](reception-sas-today-only.md) (day window), [`reopen-completed-sas.md`](reopen-completed-sas.md), [`payment-link-lifecycle.md`](payment-link-lifecycle.md) (validity, withdrawal, rules 6, 8, 14, 42), [`no-automatic-email-without-approval.md`](no-automatic-email-without-approval.md) |
| **Summary for the owner** | [`docs/rapports/2026-11-12-outside-booking-sas.html`](../docs/rapports/2026-11-12-outside-booking-sas.html) — French, interactive mock |

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
2. **The screen and the session line belong to `hourly-resources`; the visit's money belongs to the core.** The
   plugin owns the mini SAS screen, its routes, the session line (family `hourly`) and the slot (FULFILMENT
   adapter `hourly-slot`). The sale document, its extras lines, the payments, the allocations, the refunds and the
   journal are the core's external sale (`standalone_sales`, pricing-components rules 53, 74). With
   `hourly-resources` off there is no mini SAS and no `resource` suggestion context; the documents already written stay readable in Encaissements and in
   the journal (they are core rows). With the `sas` plugin off the mini SAS still works (rule 28 of the invoicing
   spec).
3. **No resource or platform named in code.** Nothing tests « bain », « nordique » or a platform name. What is
   specific to Solio's bath — heat-up, retention, the free hour granted to stays, the evening band — stays in the
   `hourly` family and the plugin's settings. The core sees an article of family `hourly` with a fulfilment ref.
4. **One computation of every figure.** The mini SAS never prices, sums, splits VAT or subtracts on the client.
   Lines come from the Articles head (`describe`), VAT from the VAT component, the remaining amount and each
   line's status from SETTLEMENT, refunds owed from REFUNDS, through the `saleDetail` read model extended to a
   standalone document (rule 31 of the refonte). The client renders the payload (CLAUDE.md §6.0).

### 3.B When it opens

5. **On the session's day window.** The mini SAS commits from `D 00:00` to `D+1 04:00` (Europe/Paris), `D` = the
   booking's `date`, through `sdk.coreModule('sasEditWindow').isWithinSasWindow` — the window of the stay SAS
   (reception-sas-today-only rules 1-2). _(Amends invoicing rule 28's strict Paris day; decided, Q2 A.)_ Outside the
   window: 409 `ARRIVAL_NOT_TODAY` « Arrivée : le jour de la séance seulement. », unless the visit is already
   opened (rule 22).
6. **Entry points, unchanged.** « Arrivée » on the booking's planning card and in the booking dialog, on its day
   only; no new menu item. The card's chip reads the server's state (rule 21).
7. **Roles.** An `admin` may open, commit and reopen at any time once opened. A `reception` user may open and
   commit inside the window of rule 5 and sees door money only (the session lines, the extras, the remaining
   amount; never a refund amount, reception-role-checkin-only rule 12bis). Removing or offering a **paid** line
   and anything that owes a refund is admin only (403 `ADMIN_ONLY` « Remboursement : réservé à l'administrateur. »).
   _(Decided, Q3 A.)_

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
9. **No identity on screen beyond what exists.** The mini SAS shows the booking's `displayName` (as today) and
   never asks a phone or address, except the optional billing address of the invoice (invoicing rules 25-27).

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
36. **A suggested-articles provider keyed by sale context** (server). A **sale context** is `{ kind, id }`. Kinds
    known at this change: `resource` (declared by `hourly-resources`, `id` = the resource id) and `property` (declared
    by the core, `id` = the property id, used by the stay SAS follow-up). The core module `suggestedArticles`
    answers `resolve({ context, customerContext })` → `[{ articleRef, label, unitCents, max }]`, ordered by the
    operator's position and **filtered by sellability for the caller** (`external`: `sellableExternally` and a
    family that needs no stay, rule 11; `hosted`: the article's `validate` against the stay). An article that left the
    catalogue or is no longer sellable for the caller is dropped silently at read time and never from the stored list.
    The resolver is a pure read; it prices nothing (rule 4 stands: the label and unit come from `describe`).
37. **The settings home is generic.** The lists live in a core table `suggested_articles` keyed `(contextKind,
    contextId)`, edited in **Réglages → Articles → « Proposés à l'arrivée »**, one list per context, grouped by kind.
    A plugin supplies the **contexts** of its kind (`ctx.suggestionContexts({ kind, label, list() → [{ id, label }] })`,
    SDK minor bump); `hourly-resources` supplies its resources, so the per-resource list the owner chose is the
    `resource` rows of this generic table, not a setting of the plugin. With the plugin off, its kind and its
    contexts disappear from the page and from `resolve`; the stored rows stay (reappear on re-enable). A list holds at
    most 12 articles, ordered by drag or by the up / down buttons; admin only; writing a reference the catalogue does
    not know answers 400 `ARTICLE_UNKNOWN`.
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
40. **The link bills the reste, once.** It is minted through the core payment-link path (`ensurePaymentLink`'s
    family: `paymentProviders.declared().createLink`, `paymentLinksModel`, `type = 'complement'`-style explicit
    basket with `basket.source = 'standalone-sale'`, `basket.ref = <saleRef>`), with the document's VAT basket from the
    VAT component. **Its amount is `remainingCents` computed by SETTLEMENT at that moment** (rule 15); the client
    never sends an amount. At most one open link per document: asking again reuses an open link of the same amount,
    and an open link whose amount no longer matches (a line added, offered or removed, a payment taken) is withdrawn
    and replaced (payment-link-lifecycle rule 8 reading). Validity 36 hours (lifecycle rule 6), not the 30 minutes of
    a guest order; the lifecycle pass lapses it. It is withdrawn when the document is cancelled (rules 26-27) and by
    hand with « Retirer le lien » (lifecycle rule 42). Zero or negative reste: 409 `NOTHING_DUE` « Rien à encaisser. ».
41. **A link paid after the sas is closed settles the sale.** The link poller's paid effect
    (`applyPaidEffect`, basket branch `standalone-sale`) writes one `standalone_sale_payments` row (method `link`,
    `source = payment-link:<id>`) and its `payment_allocations` through SETTLEMENT, in the same transaction that books
    the link paid: the reste falls to the amount still owed, the planning card turns « Payé », the invoice becomes
    offered (rule 31), and the journal books the payment on its payment day (rule 30). A payment that exceeds what is
    still owed (lines removed or offered meanwhile, document cancelled) is **booked in full and the surplus becomes a
    refund owed** through REFUNDS (rule 25), with an admin alert (lifecycle rule 14 spirit: money received is never
    dropped). A link paid at the deadline follows lifecycle rules 14-15 unchanged.
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
43. **The drinks revenue account is a setting of `accounting-export`** (decided 2026-11-12, Q8 A). The setting
    `drinksRevenueAccount` is empty by default. A journal export (CSV, sales JSON, synthesis) whose period holds a
    line of class `drinks` while the setting is empty is **refused** with 409 `DRINKS_ACCOUNT_REQUIRED` « Compte des
    boissons à renseigner avant l'export. » naming the setting's page; an export with no drink line is unaffected.
    The account plan maps `revenue:drinks` to the setting once filled. No default account is invented.

---

## 4. Architecture

> **Fat backend, thin frontend.** Every amount, status, remaining figure, VAT row, refusal and grouping comes from
> the server. The client keeps only the draft (requests, offered toggles, typed tenders) and renders quotes.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `standaloneSale.js` (from refonte PR C, the same PR) | T | `quote` / `sell` accept a `fulfilment` line request (the session) and an `originRef` (`resource-booking:<id>`); `offerLine`, `removeLine`, `pay` actions on an existing document, each a re-quote inside the transaction |
| `models/` | `standaloneSalesModel.js` (from PR C) | T | reads/writes the columns of §5; `byOrigin(originRef)`; document `version` for the concurrent-commit check |
| `utils/` | `suggestedArticles.js` | C | the `suggestedArticles` core module: provider registry keyed by sale context, `resolve({ context, customerContext })` with the sellability filter (rules 35-36) |
| `models/` | `suggestedArticlesModel.js` | C | reads/writes `suggested_articles` (rule 37) |
| `controllers/` | `suggestedArticlesController.js` | C | settings read/write (admin) and the resolved read; validates references |
| `routes/` | `suggestedArticles.js` | C | thin: §4.3 |
| `utils/` | `standaloneSaleLinks.js` | C | mints / reuses / withdraws the reste link through the payment-provider path (rule 40); the paid effect of the `standalone-sale` basket (rule 41); sends the manual e-mail on click (rule 42) |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | seeds `visit_payment_request`, `sendMode: 'manual'` (rule 42) |
| plugin `accounting-export` | `settings` + exporters | T | `drinksRevenueAccount` and the `DRINKS_ACCOUNT_REQUIRED` guard (rule 43) |
| `models/` | `standalonePaymentsModel.js` | C | writes `standalone_sale_payments` and their allocations (`payment_allocations`) inside the sale transaction |
| `controllers/` | `standaloneSalesController.js` (from PR C) | T | no new route for the counter dialog of Encaissements; exposes the actions above to the SDK |
| `utils/` | `saleDetail.js` (from PR B) | T | `saleDetail({ documentRef })` for a standalone document: lines, statuses, `totals { totalCents, paidCents, remainingCents, refundOwedCents }` from SETTLEMENT and REFUNDS |
| `utils/pricing/` | `settlement.js`, `refunds/owed.js` | T | SETTLEMENT and REFUNDS take a standalone document as input (no stay-level parts) — no new formula, rule 4 |
| `utils/accounting/` | read model of standalone documents | T | lines + VAT output + allocations as `standalone` entries (rule 30) |
| `utils/` | `standaloneSales.js` | T | the core lists its own documents beside the plugins' providers (rule 32) |
| `plugins/sdk/` | `coreModules.json`, `index.js` | T | expose `standaloneSale`, `saleDetail`, `suggestedArticles`, `sasEditWindow` (already) to plugins; add `ctx.suggestionContexts` (rule 37); SDK minor bump |
| `database.js` | `database.js` | T | idempotent columns and tables of §5, including `suggested_articles` and the `payment_links` standalone target |
| plugin | `plugins/hourly-resources/visitController.js` | C | `GET /:id/visit`, `POST /:id/visit/quote`, `POST /:id/visit` (commit), `POST /:id/visit/payment`, `PATCH /:id/visit/lines/:lineId`, `POST /:id/no-show`, the payment-link routes (rules 39-42); window and role guards (rules 5, 7) |
| plugin | `plugins/hourly-resources/visitModel.js` | C | links a booking to its document (`saleRef`), builds the session request from the booking, legacy money of rule 34 |
| plugin | `plugins/hourly-resources/bookingsModel.js` | T | `recordArrival` delegates money to the visit; `recordPayment` writes a document payment for rule-34 bookings; `standaloneSales` skips bookings with a `saleRef` (rule 32); `remove` cancels the document (rule 26) |
| plugin | `plugins/hourly-resources/invoicing.js` | T | invoice basis = the document's lines when `saleRef` is set (rule 31) |
| plugin | `plugins/hourly-resources/planningCardsModel.js` | T | `remainingCents` and the « Reste » state on the card (rule 22) |
| plugin | `plugins/hourly-resources/index.js` (`suggestionContexts`) | T | declares kind `resource` and lists the resources as contexts (rule 37); **no per-resource article list in the plugin's settings** |
| plugin | `plugins/hourly-resources/index.js` | T | mounts the visit routes; adds `GET/POST /resource-bookings/:id/visit*` to `ctx.reception` (rule 7) |
| plugin | `plugins/hourly-resources/migrations.js` | T | `resource_bookings_v6`: `saleRef`, `noShowAt` |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| plugin | `plugins/hourly-resources/ResourceArrivalDialog.jsx` | T | becomes the mini SAS: « Sa séance », « Proposés à l'arrivée », « Paiement », « Facture »; reads `visit` payloads only |
| plugin | `plugins/hourly-resources/useVisitQuote.js` | C | debounced quote of the draft (as `useResourceBookingPreview`), `fresh` / `pending` / `refusal` |
| plugin | `plugins/hourly-resources/PlanningResourceCard.jsx` | T | « Reste {amount} » / « Payé » / « Absent » from the server |
| plugin | `plugins/hourly-resources/ResourceBookingDialog.jsx` | T | « Client absent » action; payment through the visit for rule-34 bookings |
| component | `components/SuggestedArticlesStep.jsx` | C | **generic** « Proposés à l'arrivée » step: chips from a `suggestions` payload, « Autre article » search, quantity stepper, « Offrir », « Retirer », server refusal; prop-driven (`suggestions`, `lines`, `refusal`, `onAdd`, `onChange`), no resource, stay or plugin knowledge (rule 35) |
| component | `components/SalePaymentLink.jsx` | C | **generic** « Envoyer un lien » block: states `unavailable` / `needsEmail` / `ready` / `minted`, copy, e-mail click, withdraw; reads the `paymentLink` payload (rules 39-42); reusable by the Encaissements counter dialog |
| page section | `pages/settings/SettingsSuggestedArticlesSection.jsx` | C | Réglages → Articles → « Proposés à l'arrivée »: one reorderable list per context, grouped by kind (rule 37) |
| component | `components/SaleDetailList.js` (from refonte PR B) | T | renders a standalone document's lines with the « Offrir » toggle (prop `onOffer`), struck catalogue value, status chips |
| component | `components/TenderLines.jsx` | — | consumed as is, `dueCents = remainingCents`, shortfall `due` only (prop `shortfallKinds={['due']}` added, generic) |
| component | `components/StatusBadge`, `ConfirmDialog`, `LoadingState`, `ErrorAlert` | — | consumed |
| `api.js` / plugin sdk | `getResourceVisit`, `quoteResourceVisit`, `commitResourceVisit`, `payResourceVisit`, `patchResourceVisitLine`, `markResourceNoShow`, `mintVisitPaymentLink`, `withdrawVisitPaymentLink`, `emailVisitPaymentLink`, `getSuggestedArticles`, `saveSuggestedArticles` | T | plumbing |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `TenderLines`, `StatusBadge`, `ConfirmDialog`, `LoadingState`, `ErrorAlert`, `HelpedTextField`, `SaleDetailList` (PR B) | `OfferableLine` of the `sas` plugin is **not** imported (a plugin never requires another plugin); its behaviour is the `onOffer` prop of the core `SaleDetailList`. |
| **Created (new generic)** | `SuggestedArticlesStep` (the owner asked for a generic step, Q5), `SalePaymentLink`; `TenderLines` gains a generic `shortfallKinds` prop | both are named by what they do, not by who uses them; a second use is certain (stay SAS, rule 38; Encaissements counter dialog) |
| **Specific (kept feature-local)** | `useVisitQuote` | it debounces one plugin's quote endpoint; `ResourceArrivalDialog` composes the generic components above. |

`PageActionBar`: no page is added or changed — the mini SAS is a dialog opened from the planning (CLAUDE.md §7).

### 4.3 API contract

All under `/api/resource-bookings`, plugin `hourly-resources`, authenticated; reception allowed inside the window
(rule 7). Money in cents. Errors `{ error, code }`, French `error`.

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/:id/visit` | — | `{ booking, document: { ref, status, version, client: { id, label } }, lines: [{ id, kind: 'session'\|'extra', label, detail, quantity, unitCents, totalCents, catalogueCents, offered, status: 'paid'\|'due'\|'offered'\|'cancelled', vatRate }], totals: { totalCents, paidCents, remainingCents, refundOwedCents }, vatByRate: [{ rate, vatCents }], suggestions: [{ articleRef, label, unitCents, max }], paymentLink: { available, reason, email, open: { id, url, amountCents, expiresAt } \| null }, window: { open, reason }, invoice }` | `refundOwedCents` and refunds stripped for reception |
| POST | `/:id/visit/quote` | `{ offeredMinutes, sessionOffered, extras: [{ articleRef, quantity, offered }], removeLineIds: [] }` | same shape as GET, `quoted: true`, `refusals: [{ field, error }]` | no write |
| POST | `/:id/visit` | quote body + `version`, `acceptedTotalCents`, `payment: { tenders, shortfall: { kind: 'due' } \| null, paidAt? } \| null`, `invoice: boolean`, `billing?` | `{ visit, invoice: { ok, number?, code?, error? } }` | 409 `PRICE_CHANGED`, `ARRIVAL_NOT_TODAY`, `BOOKING_HAS_STAY`; 400 tender refusals; `invoice` not boolean → 400 (invoicing rule 45) |
| POST | `/:id/visit/payment` | `{ tenders, shortfall, paidAt? }` | `{ visit }` | collects a reste after closing |
| PATCH | `/:id/visit/lines/:lineId` | `{ offered?: bool, remove?: true, confirmRefund?: true }` | `{ visit }` | 409 `LINE_PAID` without `confirmRefund`; 403 `ADMIN_ONLY` for reception |
| POST | `/:id/no-show` | — | `{ booking }` | rule 27; refused once arrived |
| POST | `/:id/visit/payment-link` | `{ email? }` | `{ link: { id, url, amountCents, expiresAt, status, reused }, visit }` | rules 39-40; 409 `NOTHING_DUE`, `NO_EMAIL`, `PROVIDER_NOT_READY`; the amount is never in the request |
| DELETE | `/:id/visit/payment-link/:linkId` | — | `{ visit }` | « Retirer le lien »; 409 `LINK_ALREADY_PAID` (lifecycle rule 42) |
| POST | `/:id/visit/payment-link/:linkId/email` | — | `{ sent, recipientEmail }` | rule 42, explicit click only; 409 `NO_EMAIL`, `TEMPLATE_DISABLED` |
| POST | `/:id/invoice` | `{ billing? }` | unchanged | basis = document lines (rule 31); 409 `REMAINING_DUE` « Reste à payer : facture après le solde. » |


Core routes (outside the plugin), authenticated. **The sale core of PR C (C33)**, admin only, the server of the « Vente hors séjour » counter dialog and the service the visit builds on
(`standaloneSale` SDK module: `quote`, `sell`, `offerLine`, `removeLine`, `pay`, `cancel`, `documentOf`):

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/api/standalone-sales/quote` | `{ lines: [{ articleRef, quantity, offered? }], customer?: { name?, email?, registerAsClient? }, saleId? }` | `{ document, customer: { clientId, label, kind: 'passage'\|'match'\|'new'\|'registered' }, refusals: [{ articleRef, code, message }], quoted: true }` | no write; `refusals`: `ARTICLE_UNKNOWN`, `NOT_SELLABLE`, `NEEDS_STAY`, `QUANTITY_OUT_OF_BOUNDS` « Quantité : 1 à 99. », `VAT_RATE_UNKNOWN` |
| POST | `/api/standalone-sales` | the quote body + `acceptedTotalCents?`, `version?` (with `saleId`, to append), `payment?: { tenders, shortfall: { kind: 'due' } \| null, paidAt? }` | `{ document }` | 400 with the first refusal's `code` and `refusals`; 409 `PRICE_CHANGED` « Prix modifié — relire le panier »; 400 `NAME_REQUIRED`, `EMAIL_INVALID`, `TENDERS_INVALID`, `WAIVED_REFUSED`; `standaloneSale.sold` after the commit |

`document` is the document form of `saleDetail` (`buildDocumentDetail`): `{ document: { ref, id, status: 'paid'\|'due'\|'cancelled', version, soldAt, originRef, customerName, customerEmail, client: { id, label, kind } },
lines: [{ id, ref, kind: 'session'\|'extra', label, detail, quantity, unitCents, totalCents, catalogueCents, offered, status: 'paid'\|'due'\|'offered'\|'cancelled', statusLabel, settledCents, vatClass, vatRate, vatCents, fulfilmentRef }],
groups: [{ id, label, count, title, totalCents, refs }], totals: { totalCents, paidCents, remainingCents, refundOwedCents }, vatByRate: [{ rate, vatCents }] }`. The service actions beyond sell are SDK-only
(`offerLine(saleId, lineId, { offered, confirmRefund, version })` → 409 `LINE_PAID` « Ligne payée : remboursement à confirmer. »; `removeLine`; `pay(saleId, { tenders, shortfall, paidAt, version, source })`; `cancel(saleId)`),
the roles (`ADMIN_ONLY`, the window) being the visit controller's (C37).

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
| `standalone_sales` | invoice + attachment columns | as on `resource_bookings` (invoicing §5) | NULL | rule 31 |
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
| `email_templates` | `visit_payment_request` | row | seeded FR, EN, `sendMode 'manual'` | rule 42 |
| `plugin_settings` (`accounting-export`) | `drinksRevenueAccount` | TEXT | `''` | rule 43 |

**Why a new payments table rather than `payment_settlements`:** that table has `reservationId NOT NULL` and a
`CHECK` on `targetKind`; widening either needs a table rebuild of a money table, which this spec refuses for a
feature that can live beside it. The tender lines keep the shape `validateSettlement` returns.

**Backfill:** none on amounts. Bookings paid before (rule 34) get no document; `saleRef` stays NULL and their
journal rows are unchanged. **Data impact:** additive only; no existing amount, journal month or invoice moves.

## 6. UI / UX

The owner decides on the interactive mock in
[`docs/rapports/2026-11-12-outside-booking-sas.html`](../docs/rapports/2026-11-12-outside-booking-sas.html).
Design system « Maison » (`specs/design-system.md`): fir-green primary, paper background, serif section headers,
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

**Settings page (Réglages → Articles → « Proposés à l'arrivée »):** one card per context (« Bain nordique »…), articles as reorderable rows (drag, or ↑ / ↓ buttons ≥ 44 px), « Ajouter un article », limit message « 12 articles au plus. »; on `xs` the cards stack and the rows keep their buttons.

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

## 7. Test plan

### Server unit tests (one file per subject)
- [ ] `plugins/hourly-resources/tests/visit-window-and-roles.unit.test.js` — rules 1, 5, 7 (window `D+1 04:00`, reception allowed then read-only, `ADMIN_ONLY`)
- [ ] `plugins/hourly-resources/tests/visit-lines.unit.test.js` — rules 10-12, 14 (session line from the `hourly` family, suggestions, `NEEDS_STAY` never listed, quantity bounds, append after commit)
- [ ] `plugins/hourly-resources/tests/visit-offer.unit.test.js` — rule 13 (whole-line offer on session and extra, offered time kept as component, `waived` refused)
- [ ] `plugins/hourly-resources/tests/visit-remaining-and-payment.unit.test.js` — rules 15-19 (remaining from SETTLEMENT, partial `due`, over-payment refused, allocation order)
- [ ] `plugins/hourly-resources/tests/visit-commit-reopen.unit.test.js` — rules 21-24 (one transaction, `PRICE_CHANGED`, reopen appends, invoiced read-only)
- [ ] `plugins/hourly-resources/tests/visit-refund-cancel-noshow.unit.test.js` — rules 25-27
- [ ] `plugins/hourly-resources/tests/visit-legacy-money.unit.test.js` — rule 34 (paid before: session « Payée », extras on a new document, journal unchanged)
- [ ] `plugins/hourly-resources/tests/visit-card-batch-once.unit.test.js` — rule 32 (no double listing)
- [ ] `plugins/hourly-resources/tests/visit-invoice-document.unit.test.js` — rule 31 (all lines, `REMAINING_DUE`, money guard)
- [ ] `tests/standalone-sale-visit-vat.unit.test.js` — rules 28-29, 33 (external context, rate frozen at sale, franchise, no tourist tax)
- [ ] `plugins/accounting-export/tests/standalone-visit-journal.unit.test.js` — rule 30 (per payment day, caisse interne out, offered out, `revenue:drinks`)
- [ ] `tests/suggested-articles.unit.test.js` — rules 36-37 (context key, order, `external` / `hosted` sellability filter, dropped when sold out of the catalogue, `ARTICLE_UNKNOWN`, 12 max, plugin off hides its kind, rows kept)
- [ ] `plugins/hourly-resources/tests/visit-suggestion-contexts.unit.test.js` — rule 37 (resources listed as `resource` contexts; no list in the plugin's settings)
- [ ] `tests/standalone-sale-payment-link.unit.test.js` — rules 39-41 (provider not ready: absent; no e-mail: disabled; amount = SETTLEMENT reste, never the request's; reuse same amount, withdraw on drift; 36 h validity; paid after close writes payment + allocations; surplus → refund owed + alert; cancelled document)
- [ ] `tests/visit-payment-request-template.unit.test.js` — rule 42 (`sendMode manual`, not in `AUTO_SEND_EXCEPTIONS`, `autoSendPolicy` false, minting sends nothing, one send per click, history entry, no `email_log` row)
- [ ] `plugins/accounting-export/tests/drinks-account-required.unit.test.js` — rule 43 (refused with a drink and no account, accepted with an account or no drink)
- [ ] `tests/plugin-boundary-outside-visit.unit.test.js` — rules 2-3 (plugin off: documents readable; no resource or platform name in code)

### Client (Vitest, one file per subject)
- [ ] `plugins/hourly-resources/__tests__/ResourceArrivalDialog.extras.test.jsx` — add, stepper bounds, refusal shown
- [ ] `…/ResourceArrivalDialog.remaining.test.jsx` — figures rendered from the payload, never computed
- [ ] `…/ResourceArrivalDialog.offer.test.jsx` — offered line struck, paid line asks confirmation
- [ ] `components/__tests__/SuggestedArticlesStep.generic.test.jsx` — rule 35 (renders any `suggestions`, no resource or stay wording, refusal shown, quantity bounds)
- [ ] `components/__tests__/SalePaymentLink.states.test.jsx` — rules 39-42 (four states, disabled hint, copy, e-mail only on click)
- [ ] `pages/settings/__tests__/SettingsSuggestedArticlesSection.test.jsx` — rule 37 (reorder, limit message, unknown kind hidden)
- [ ] `…/ResourceArrivalDialog.mobile.test.jsx` (existing, updated) — sticky reste, action last
- [ ] `components/__tests__/TenderLines.shortfall-kinds.test.jsx` — only « Reste à percevoir » offered

### E2E
- [ ] `e2e/specs/planning/outside-visit.spec.js` — book a walk-in session, open « Arrivée » on its day, add 2 drinks, offer 1, partial card payment with reste, card shows « Reste », reopen, pay the reste, invoice offered; a second visit with an e-mail: « Envoyer un lien », link shown (no mail sent), paid through the sandbox → « Payé »

### Manual UI verification
- [ ] Desktop 1280 px and mobile 390 px: no horizontal scroll, sticky reste, thumb action, 44 px targets
- [ ] Session paid at booking time + drinks at the counter → reste = drinks only
- [ ] Qonto sandbox: link for the reste, paid after the sas is closed → card « Payé », journal on the payment day; link withdrawn after a line is offered
- [ ] Réglages → Articles → « Proposés à l'arrivée » on desktop and 390 px
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
