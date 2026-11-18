# Gift voucher campaigns — composed vouchers, merchant cards, typed vouchers

| | |
|---|---|
| **Status** | Approved |
| **Owner** | Adrien |
| **Created** | 2026-11-18 |
| **Revised** | 2026-11-18 (second review: composition from the catalogue, degressive hourly pricing, one-shot vouchers, visual library, terms per activity, outside-booking fiche, cancellation, booking horizons) |
| **Builds on** | `specs/gift-vouchers.md` (plugin `gift-vouchers`, PR #1055), `specs/pricing-components.md`, `specs/outside-booking-sas.md`, `specs/resource-hourly-scheduling.md`, `specs/terms-acceptance-record.md`, `specs/mixed-method-payments.md` §3.15 |
| **Summary for validation** | `specs/gift-vouchers-bain-nordique-propositions.html` (French, interactive mock-ups) |

## 1. Context

`specs/gift-vouchers.md` sells one kind of voucher: a free amount, spent on a lodging booking. The
owner now wants to sell the **nordic bath** as a gift too, in two ways:

- **on the website**, next to the free-amount voucher, with nothing left for the operator to do;
- **through printed cards left with local shops.** The A6 card is printed in advance and carries no
  code. Its QR code leads to the purchase page. The giver pays online, receives the code by e-mail,
  and may write it in a white box on the card.

A bath voucher is not an amount. It is a **content** composed from what GuestFlow sells: a bath in
the day or in the evening for a duration, possibly with drinks. The person who receives it must book
a slot without effort, and must not be able to spend it on a lodging stay — nor a lodging voucher on
a bath.

Every visible element comes from GuestFlow's configuration — the catalogue, the resource's hours
and tariff, the validity, the card visuals — and every price comes from the pricing engine. The
operator sets campaigns up from a page in GuestFlow, or from a recipe an AI assistant can write, and
can compose a single voucher on the fly for a phone customer.

What exists and is reused:

- **The gift-voucher plugin, as a whole:** the code (HMAC, check character), the movements ledger
  and the hold/settle/release redemption through `ctx.prepaid`; the 1-hour sale link through
  `core.payments.saleLink`, the order tunnel with proof of work and per-visitor limits; the PDF, the
  receipt mail, the admin page; the voucher sales contributed to the accounting journal through
  `ctx.standaloneSales` (`books.js`).
- **The pricing engine** (`utils/pricing/`, PR C): the `externalSale` pipeline, the article
  families, the outside-customer VAT per class (`vat_external_rates`), `utils/standaloneSale.js`.
- **The hourly resource** (`hourly-resources`): its opening hours, its evening switch
  (`hourlyEveningStart`), its slot step, its minimum use, its external rates
  (`hourlyExternalDayRate`/`hourlyExternalEveningRate`) and its availability (`checkBookable`).
  It has **no degressivity today** (rules 43–45 add it to the engine).
- **The outside visit** (`resource_bookings` with no reservation), its `standalone_sales` document
  and its `standalone_sale_history`, and its mini SAS.
- **The core terms** (`terms_draft`, `terms_versions`, `terms_acceptances`, Réglages → CGV), a
  single document today.

## 2. Goal

1. **Voucher campaigns, composed from the catalogue.** A campaign is an offer the operator
   configures once: a kind (`lodging` amount or composed `resource`), its contents picked among the
   resources and options of the database with their tariff modes, the add-ons a giver may choose, the
   validity, the card visuals and the public links.
2. **One-shot vouchers.** A single voucher composed on the fly follows the same path as a campaign
   voucher for pricing, payment and booking.
3. **Typed vouchers.** A voucher can only pay for what its contents allow. The server checks it on
   every use.
4. **Prices from the engine only.** Every price, including extra time crossing into the evening and
   the new degressive hourly rates, is computed by the pricing engine. No client computes.
5. **The giver's tunnel**, fully on the website; nothing exists until the bank confirms the payment.
6. **The receipt mail** with the code, an invoice-style recap and the A6 PDF with no amount.
7. **The recipient's page « Mon bain »**, the bath terms accepted, the slot held 15 minutes while a
   remainder is paid.
8. **Preparation**: the voucher's contents on the planning card, in the arrival SAS, and in a fiche
   of the outside booking with its history.
9. **Back-office**: a « Nouveau bon » page as rich as the site, taking the same server path; a
   visual library; PDF downloads; resend; cancellation.
10. **Terms per activity**, stored and published like the lodging terms, accepted and traced on the
    site, on « Mon bain » and in the guest app.

## 3. Functional rules

Rules are identities: a rule is never renumbered, new rules are appended
(`spec-rule-numbers-are-identities`). Rules revised by the second review say so.

### 3.A Campaigns

1. Campaigns live in the `gift-vouchers` plugin. Off or absent, nothing of them is visible: no menu,
   no public route, no field in the booking engine, no WordPress block content (rule 40).
2. A campaign has:
   - a **name** for the operator;
   - a **public title** printed on the voucher's back and shown on the site;
   - a **kind**;
   - a **state** (`draft`, `on sale`, `closed`);
   - a **validity in months**, counted from the payment and frozen on each voucher at its issue;
   - the **card visuals**, picked in the visual library (rules 7, 47);
   - a **permanent slug** (rule 9).

   A closed campaign sells nothing more. Its vouchers stay valid until their own end date.
3. **Kind `lodging`.**
   - The free amount of `specs/gift-vouchers.md`: its bounds, its price ideas and its VAT setting
     move from the plugin's settings into the campaign.
   - The existing settings become the first `lodging` campaign at migration, so nothing changes for
     the vouchers already sold.
4. **Kind `resource` — a composition from the catalogue** (revised 2026-11-18).
   - « Ajouter un élément » lists **every resource and every option of the database**, served by the
     server with, for each, its **tariff modes** read from its pricing configuration.
   - An hourly resource offers its outside-customer modes: « Extérieur · journée » and
     « Extérieur · soirée », each with its rate and its degressivity as the engine reads them, and
     the band's hours read from the resource. Choosing one fixes the **band**; the operator then
     sets the **included minutes**, at least `minimumUsageMinutes`, a multiple of `slotDuration`,
     inside the band.
   - An option offers its price type (per unit, per person, progressive per participant) and the
     operator sets its quantity or its number of persons.
   - A composition holds **exactly one hourly resource** (the session to book) and any number of
     options. Several sessions on one voucher are out of scope.
   - An element that cannot be sold to an outside customer is listed greyed, with the reason the
     server gives: not marked « vendable hors séjour », inactive, a price type that needs a stay
     (per night, percent of the stay), no external rate for the band.
   - The composition also fixes the **add-ons offered** to the giver and to the recipient (options
     picked the same way) and the **extra time offered** (yes/no, a maximum, in steps of
     `slotDuration`).
5. **Prices are read, never stored by the campaign** (revised 2026-11-18).
   - Every price shown — the campaign editor's preview, the giver's total, the recipient's remainder,
     the back-office total — is computed by the **pricing engine** at the time of the request, for
     the outside customer: the resource's external rate of each slice, its degressivity (rule 43),
     the options' catalogue prices, and the **outside-customer VAT rate of each line's class**
     (`vat_external_rates`: 20 % for the bath).
   - No client — GuestFlow's, the guest app or the WordPress block — computes a price, a total, a
     VAT amount, an hour or a band. They render what the server returns.
6. A campaign that cannot be priced is not offered. The public offer omits it, and the campaign page
   shows the engine's reason.
7. **Card visuals.**
   - **Voucher front** (mandatory to go on sale): the front of the two-sided PDF sent by mail.
   - **Merchant card front** (optional): when set, the campaign offers the merchant card's printable
     PDF (rules 33, 49).
   - Both are picked in the visual library (rule 47). Both backs are drawn by GuestFlow from the
     campaign and the settings. The operator never re-types a value GuestFlow already holds:
     company name, town, website, validity, contents, links.
8. A campaign can be **duplicated**, which is how a « soirée » campaign is made from a « journée » one.
9. **Permanent links.**
   - Each campaign has a slug, unique and editable only while no card has been printed. Downloading
     the merchant card PDF locks it.
   - The website serves two permanent paths: **`/<base>/offrir/<slug>`** leads to the campaign's
     purchase page; **`/<base>/utiliser`** leads to the redemption page of the voucher's kind,
     chosen from the code.
   - `<base>` is set once in the WordPress connector (default `bon-cadeau`).
   - Both are redirections the WordPress connector resolves by asking GuestFlow for the current
     target page, so a page moved on the site never breaks a printed card.
   - With the plugin off, they lead to the site's home page.
10. **Recipe.**
    - A campaign can be exported and imported as a JSON recipe (`docs/gift-voucher-campaign-recipe.md`
      documents the format), in the manner of the tariff recipes. The recipe names elements and
      tariff modes by their names in GuestFlow, never by a price.
    - An import is validated by the same rules as the form. Each refusal names the field. Nothing is
      written unless every field passes.
    - The images travel in the same archive (`.zip`: `campaign.json` + images) and join the visual
      library, or are picked afterwards.
    - A skill `.claude/skills/gift-voucher-campaign` lets an assistant draft a recipe, and its
      visuals, from a request.

### 3.B Typed vouchers

11. Every voucher stores its `campaignId` and a **frozen copy of its contents**: kind, resource,
    band, minutes, options with quantities, add-ons bought. It also stores the amount paid and its
    VAT lines, and the visual versions it was issued with (rule 48).
    - The existing vouchers belong to the migrated `lodging` campaign.
12. **A voucher pays only for its kind.**
    - A `lodging` voucher is refused on a bath, and a `resource` voucher is refused on a lodging
      quote and on any other resource than its own.
    - The refusal carries a sentence: « Ce bon est valable pour un séjour dans nos logements, pas
      pour le bain nordique. » or « Ce bon est valable pour un bain nordique, pas pour un séjour. »
      (the resource's name is read).
    - The check lives in the plugin's `apply`, which receives the consumer's kind (`lodging` from
      the booking engine, `resource:<id>` from the bath page).
13. **A `resource` voucher guarantees its contents once paid.**
    - It covers its band, its minutes and its options whatever the prices become.
    - It is used **once**. The first booking settles it whole, and the voucher reads « Utilisé ».
14. **Changing band** (revised 2026-11-18).
    - A **day** voucher may book a slot that runs into the evening. The engine prices the covered
      slices that fall after `hourlyEveningStart` at the evening rate, with their degressivity rank,
      and the remainder is the difference with the day price the voucher covers.
    - An **evening** voucher is offered evening slots only: a session starting at or after
      `hourlyEveningStart`. The evening-to-day direction does not exist and is not modelled.
15. **Unused value is traced.** When part of a voucher is not used — an option the operator marks
    « non pris » in the arrival SAS — nothing is kept as a balance. The settle movement records the
    unused part and its value at the day's prices. The admin detail shows « Écart non utilisé : … »
    so the owner can offer a small gift in return.
    - **As built (step 5)**: the plugin's `ctx.prepaid` declares an optional `unused({ ref, label, valueCents })`, called
      by the core's `prepaidSources.unusedFor` when the operator marks a line « non pris » on the outside visit; the
      plugin writes `gift_voucher_unused` (the ledger's `kind` constraint cannot take a new kind on an existing
      database), the admin detail reads `unusedCents` / `unused`. Nothing is kept as a balance.

### 3.C The giver's tunnel

16. The purchase page shows the campaigns on sale, grouped by kind.
    - Arriving by a campaign's permanent link (rule 9) opens that campaign directly.
    - A `lodging` campaign opens the existing free-amount page, unchanged: amount, ideas, « Prix
      indicatifs, susceptibles d'évoluer. »
17. A `resource` campaign shows:
    - its public title;
    - the included time and band, with the hours read from the resource;
    - the included options;
    - the extra time, when offered, in steps of `slotDuration`;
    - each add-on with a quantity.

    Every change asks the server for the price (`POST /public/v1/gift-vouchers/offer/price`), which
    answers the lines, the total incl. VAT and the VAT per rate. Extra time is priced by the engine
    in continuation of the included minutes (its degressivity ranks follow on). The page shows the
    server's answer only.
18. The giver fills « Pour », « De la part de », a message, and an e-mail. They accept the terms of
    the voucher's activity (rule 37) and pay. There is no field for the merchant card number.
19. **Nothing exists before the payment** (unchanged rule of `specs/gift-vouchers.md`).
    - The order is priced again by the engine at the moment of the payment link. The link lives one
      hour.
    - No voucher, no code and no booking exist before the bank confirms the payment.
    - A confirmation that arrives after the link was withdrawn still issues the voucher, at the
      price the order fixed.

### 3.D The receipt mail and the PDF

20. When the payment is confirmed, the giver receives one mail. This is the automatic exception of
    `specs/no-automatic-email-without-approval.md`, extended. The mail contains:
    - The greeting, the public title of the campaign, « Pour … de la part de … ».
    - **The code**, in large type.
    - Under the code (wording revised 2026-11-18): « Le PDF joint s'imprime tel quel. Si vous avez
      la carte du commerçant, vous pouvez aussi recopier le code dans l'encart blanc. »
    - **What the voucher contains**: the same lines as the PDF's back.
    - **An invoice-style recap of the payment**: date, voucher number, each line with quantity and
      price incl. VAT, the total incl. VAT, and « dont TVA » per rate. The amounts appear here and
      only here.
    - The validity date.
    - **The PDF attached.**
21. **The PDF is two-sided A6**, 105 × 148 mm with 3 mm bleed, and shows **no amount** for a
    `resource` voucher.
    - **Front**: the voucher front picked for the campaign, as uploaded, with nothing added.
    - **Back**, drawn by GuestFlow in the look of the cards (logo from the company settings):
      - « Pour l'utiliser »;
      - the QR code, beside « Scannez pour réserver votre cadeau ou suivez ce lien : » and the short
        link;
      - « Votre bon comprend : » with the frozen contents, written generically;
      - for a lodging voucher only, « Un séjour dans nos logements, d'une valeur de 150,00 € » (Q2);
      - « Pour … de la part de … » and the message;
      - the code;
      - « Valable jusqu'au … »;
      - the legal mention and the website (rule 50).
22. The QR code of the PDF points to the redemption page with the code in the URL fragment
    (`#bon=<code>`, never sent to a server). The printed link is `/<base>/utiliser` (rule 9).

### 3.E The recipient's page « Mon bain »

23. A new WordPress block « Utiliser un bon cadeau » (shortcode `[guestflow_gift_voucher_use]`)
    serves the redemption.
    - Opened from the QR code, it reads the code from the fragment and asks the server at once.
    - Opened from the typed link, it shows one field « Code du bon » with the existing pre-check
      (`assets/voucher-code.js`), then the same request.
    - A `lodging` code sends the visitor to the booking engine with `#bon=<code>`. A `resource` code
      stays on this page.
24. The server answers with the voucher's frozen contents, the giver and recipient names, the
    validity date, and the add-ons and extra time the recipient may buy (rule 27). The page lists
    the contents first, under « Votre bon comprend », before any choice.
25. The slots come from the server (`POST /public/v1/gift-vouchers/use/slots`, the code in the body
    so it never sits in a log).
    - They are built from the resource's opening days, opening hours, slot step, capacity, turnover,
      existing bookings and holds, and bounded by the resource's booking horizon (rule 51).
    - Each slot is tagged by the server: « Inclus » when it fits the voucher's band, or
      « + x € soirée » with the engine's supplement.
26. Choosing a slot asks the server for the recap: the included lines, the supplement, the added
    time and the added options, and the total still to pay.
27. **The recipient can add bath time** in steps of `slotDuration`, while the session ends by
    `closeTime` and the resource stays free, and any add-on of the campaign not already in the
    voucher. The engine prices each added slice at the rate of its band and with its degressivity
    rank, continuing the voucher's minutes (rule 44).
28. The recipient gives an e-mail and a phone number, and accepts the activity's terms (rule 37).
29. **Nothing is booked before the payment, except a 15-minute slot hold** (owner decision of
    2026-11-18, the one exception to « nothing is held before payment »).
    - When nothing is due, the confirmation creates the outside booking at once (`resource_bookings`,
      external rates, standalone sale with the voucher's lines) and settles the voucher.
    - When a remainder is due: the slot is held for **15 minutes**; the voucher is held for the same
      quote; a sale link valid for those 15 minutes is minted for the remainder.
    - On the bank's confirmation, the server books the slot and settles the voucher in one
      transaction. When the 15 minutes lapse unpaid, the hold and the link are withdrawn, and the
      slot and the voucher are free again.
    - A payment confirmed after the hold lapsed, when the slot is no longer free, opens a refund
      line and the voucher stays intact. When the slot is still free, the booking is made.
    - The hold blocks the slot in every availability read: planning, guest app, « Mon bain ».
30. The voucher's lines become lines of the booking's standalone sale, paid by the voucher's
    prepaid tender (`specs/mixed-method-payments.md` §3.15). The remainder becomes a card line, so
    accounting sees the voucher money once, never twice.
31. A confirmation mail goes to the recipient's e-mail: date, hours, address, what is included, what
    was paid. It is an automatic mail, in the same exception as rule 20, because it answers the
    recipient's own action.
32. Refusals, each with its sentence: unknown code; code with a typing error; voucher expired (with
    its date); voucher already used (with its date); voucher of the other kind (rule 12); voucher
    cancelled; slot no longer free; session past `closeTime`; date beyond the horizon (rule 51);
    five wrong attempts (the existing limit).
    - **As built (step 5)**: `POST /use`, `/use/slots`, `/use/quote`, `/use/confirm` of the plugin's `useService`
      (`controllers/publicUseController.js` only parses, guards and answers). The code is always in the body; the first
      read and the confirmation ask for the signed proof of work, every call that reads a code is behind the same
      per-visitor limits as `/check` (a typing error is never counted). `quote` takes `start` as
      `YYYY-MM-DDTHH:MM`. A voucher already used says its date (« Ce bon a déjà été utilisé le … ») and an expired one
      its date; a cancelled one says so. A recipient coming back finds a voucher held by one of its own pending uses; a
      second confirmation replaces the pending one.
    - **The 15-minute hold, as built**: the slot hold is `resource_booking_holds` (hourly-resources); the voucher hold
      is a `hold` movement keyed `hold:use:<use>` for the whole balance (a voucher is used once and settled whole,
      rule 13), released under the usual `release` key or turned into `redeem:use:<use>`. The use itself is
      `gift_voucher_uses` (`held`, `booked`, `lapsed`, `refund_owed`); the `uses-lapse` job (every minute) lapses a use
      past its 15 minutes. The remainder's link is a `giftVoucherUse` basket (`ctx.paymentBasket`), 15 minutes.
    - **Late payment, as built**: a payment confirmed after the lapse is booked again when the slot is still free (the
      voucher is held again first); when the slot was taken, the voucher used elsewhere or the amount differs, the
      callback answers `refundOwed` and the core flags the payment link « à rembourser » — the core's own refund line
      for a basket payment it cannot honour, already listed by its journal. `gift_voucher_refunds` stays the line of a
      cancelled voucher (rule 54); a use never opens one. The voucher stays intact.

### 3.F The merchant card

33. When a campaign has a merchant card front, its page offers the printable PDF (rule 49).
    - The PDF is A6 two-sided, with 3 mm bleed and crop marks.
    - **Front**: the picked front.
    - **Back**, drawn by GuestFlow:
      - « Pour offrir ce bon »;
      - the QR code to `/<base>/offrir/<slug>`, with the printed short link;
      - four steps: 1 « Scannez pour choisir la formule », 2 « Paiement sécurisé en ligne »,
        3 « Recopiez ci-dessous le code reçu par mail », 4 « Faites plaisir, offrez la carte »;
      - **a white box « Code du bon »** (enlarged 2026-11-18): the full width of the text block and
        at least 22 mm high, with four guide cells for the four groups of the code, so 19
        handwritten characters fit at a comfortable size;
      - a framed inset for the recipient: « Vous avez reçu cette carte ? Rendez-vous sur
        <`/<base>/utiliser`> et saisissez le code ci-dessus pour réserver. » (no QR code);
      - « Valable <validity> mois à partir du paiement. », read from the campaign;
      - the legal mention and the website (rule 50).
34. The card carries no number and no amount.

### 3.G Preparation and arrival

35. **The bath's planning card** of an outside booking paid by a voucher shows, under the client's
    name, the badge « Bon cadeau » and **every option to prepare**: the voucher's, the add-ons
    bought by the giver, and those added by the recipient. The list is built by the server. The
    planning card is the preparation ticket.
36. **The mini SAS « Arrivée »** of that booking shows, above « Proposés à l'arrivée », a section
    « Compris dans le bon cadeau » with the same lines marked « Réglé par bon ». The recap counts
    them as already paid. Each line can be marked « non pris » (rule 15).

### 3.H Terms per activity

37. **The core terms become one document per activity** (revised 2026-11-18).
    - The existing document is the `lodging` activity. A plugin declares another activity:
      hourly-resources declares `resource` (« Bain nordique et activités »).
    - Every activity is **stored and managed exactly like the lodging terms**: the same draft, the
      same versioned, insert-only publication with its variables, French and English, the same
      settings page (Réglages → Conditions générales, one tab per activity), the same public route
      (`/public/v1/terms?activity=`).
    - Every acceptance lands in the **same record** `terms_acceptances`, with its activity and its
      subject: a reservation, a voucher order, or an outside booking. It keeps the version, the time,
      the IP, the user agent and the channel, and it appears in the subject's history.
    - The acceptance is required, with the existing refusals `TERMS_NOT_ACCEPTED` /
      `TERMS_OUTDATED`:
      - on the site, at a voucher purchase (the voucher's activity) and on « Mon bain »;
      - **in the guest app**, when the cart holds a resource of an activity whose current version
        the reservation has not accepted yet: a checkbox and the link to the text, before the order;
      - for a payment link sent by the operator (rule 41), the mail carries the link to the text and
        the payment page states that paying accepts it; the acceptance is recorded at the payment
        with the channel « lien de paiement ».
    - The voucher orders' own `termsVersionId` / `termsAcceptedAt` columns move into
      `terms_acceptances` at migration.
38. **The first `resource` text** is drafted with this spec, in French and English (owner's review of
    2026-11-18):
    - object; booking and payment; course of the session and late arrival (30 minutes tolerated);
      postponement (free once up to 48 h before) and no-show; weather and safety (suspension on
      storm, strong wind or an orange weather warning, with a postponement offered);
    - **health**: hot water, contraindications and the client's declaration; **the bath is heated
      with wood: the stove is burning hot and can cause burns on contact**;
    - **participants**: the bath welcomes **8 people** at most; it is **not recommended for
      children under 12**; **minors are under the entire responsibility of their parents**;
    - hygiene and behaviour; belongings and damage;
    - gift vouchers: validity, used once, contents guaranteed, no cash; withdrawal (rule 39);
    - claims and applicable law.

    Removed on the owner's review: the clause on alcoholic drinks and the consumer mediator clause.
39. **Withdrawal right.**
    - A voucher bought online with no date is withdrawable for 14 days while unused (art. L221-18;
      the exception of L221-28 12° covers only a dated leisure service). The terms say so.
    - The admin cancellation (rule 54) follows from it.
    - Once a slot is booked, the exception of L221-28 12° applies.

### 3.I WordPress, with or without the plugin

40. The WordPress connector keeps working with the plugin off or absent.
    - The voucher blocks render **nothing**, not an error, when GuestFlow answers
      `PLUGIN_INACTIVE`.
    - The booking engine hides its « Bon cadeau » field, as today, when the quote lists no prepaid
      kind.
    - The permanent paths redirect to the home page.
    - The connector's settings page reads the plugin's state and says « Bons cadeaux inactifs dans
      GuestFlow », without blocking the other blocks.
    - Only the plugin's activation enables the voucher routes of the public API.

### 3.J Back-office vouchers

41. **« Nouveau bon » is a page as rich as the site** (revised 2026-11-18).
    - It offers the same choices as the giver's tunnel, in the same order and a close layout: a
      campaign on sale or « Sur mesure » (rule 46); the band and included time read from the
      campaign; the extra time; the add-ons with quantities; « Pour », « De la part de », the
      message, the e-mail; the server's recap with the VAT per rate.
    - **It takes the same server path as the site** (rule 52): the same offer payload, the same
      pricing call, the same order and issuance code. Nothing is computed or re-described on the
      page.
    - It then offers three outcomes:
      - **« Payé »** with the means of payment from the core list. The voucher is issued at once.
      - **« Offert »**: issued at no charge. No sale and no VAT are recorded. The ledger reads
        « Offert par l'établissement » with the operator's name. Its use is booked as a discount
        of the booking, never as money received (Q4).
      - **« Envoyer un lien de paiement »**: an order is created as a site order would be, and a
        mail with the 1-hour link is sent **on the operator's click**. Once paid, the order follows
        the standard path: voucher issued, receipt mail, PDF. Unpaid, it is discarded as a site
        order.
    - The giver's e-mail is optional for « Payé » and « Offert », mandatory for the link.
42. The admin list gains the columns « Campagne », « Contenu » and « Utilisé le » (with the
    booking), a filter by campaign and kind; the detail shows the frozen contents, the unused part
    (rule 15), the booking and its fiche (rule 53). The rest is unchanged.

### 3.K Degressive hourly pricing in the engine (added 2026-11-18)

43. **A resource may carry a degressivity table by hour rank**: `[{ fromHour, percent }]`, for
    example `[{ fromHour: 2, percent: 10 }, { fromHour: 3, percent: 20 }]` — the 2nd hour at −10 %,
    the 3rd and the following at −20 %. Empty means linear, as today.
    - It is edited on the resource's form, beside its rates, and read by the engine's hourly family.
    - It applies **everywhere the resource is priced** (owner decision of 2026-11-18): outside
      customers, vouchers, the guest app, the reservation fiche and the SAS. It is a rule of the
      resource, not of the vouchers.
    - Percents are integers from 0 to 100, `fromHour` strictly increasing from 2. A wrong table is
      refused with the sentence of the faulty row.
    - It belongs to the hourly resources shown on the planning card (the banded, slot-walked
      pricing). A flat hourly resource without a planning card has no table, and the form does not
      offer one.
    - A price shown for one isolated slot (a slot grid's unit price) is the first hour's; the
      session's total, priced by the engine, carries the ranks.
44. **Each slice takes the rate of its own band, then the discount of its rank.**
    - The engine walks the session in steps of `slotDuration` (`priceMinutes`), as today. The rank
      of a slice is the hour of the session it falls in, counted from the session's start (or from
      the voucher's first minute when time is added to a voucher).
    - A slice starting before `hourlyEveningStart` takes the day rate, after it the evening rate —
      of the customer context (guest or outside) — then the percent of its rank.
    - Example, outside rates 50/70 €/h, evening at 20:00, table above: 18:00–21:00 is 50 + 45
      + 56 = 151 €.
    - Free minutes (« 1 h offerte ») take the first ranks. Their value keeps today's rule (day rate).
    - Rounding: each slice to the cent, the line as the sum; the per-band breakdown of
      `roundedBands` keeps adding up to the gross.
45. The evening supplement of a day voucher (rule 14) is the engine's price of the covered evening
    slices minus their day price, both at their rank. No reverse case.

### 3.L One-shot vouchers (added 2026-11-18)

46. **« Sur mesure »** composes a single voucher on the fly, for a phone customer for example.
    - The composition editor of rule 4 opens inline in « Nouveau bon »: elements, tariff modes,
      minutes, options, add-ons offered to the recipient, validity, visuals.
    - It is stored as a campaign flagged `oneShot`, never on sale, never in the public offer, not
      listed among the campaigns, and bound to its only voucher. So it follows exactly the same path
      for pricing, payment (the three outcomes of rule 41), mail, PDF, redemption and accounting.
    - The voucher detail shows « Bon sur mesure ».

### 3.M Visual library (added 2026-11-18)

47. **A page « Visuels »** of the plugin lists the uploaded visuals: thumbnail, name, use (voucher
    front, merchant card front, or both), the campaigns that use it, the vouchers still valid that
    carry it.
    - **Add**: JPEG or PNG, A6 portrait ratio within 2 %, at least 1240 × 1748 px (300 dpi); a
      smaller or misshapen image is refused with its measured size. Stored as received, never
      recompressed for print.
    - **Edit**: rename; replace the image, which creates a new version.
    - **Delete**: refused while an on-sale campaign uses it (the sentence names the campaign);
      otherwise it leaves the library.
    - The campaign editor and « Sur mesure » pick from this list and can add a new visual without
      leaving the page.
48. **Issued vouchers keep their visuals.**
    - A voucher records the visual versions it was issued with. Replacing or deleting a visual never
      changes a voucher already issued.
    - A version is kept on disk while at least one voucher carrying it is still valid and not used,
      so its PDF can be downloaded and its mail resent. Once none is left, the file is purged.
    - For a voucher used, expired or cancelled, « Télécharger » and « Renvoyer le mail » are not
      offered.

### 3.N PDF downloads, resend, print quality (added 2026-11-18)

49. **Downloads.**
    - The campaign page offers « Carte commerçant (PDF imprimeur) »: A6 two-sided, 3 mm bleed, crop
      marks, the front embedded at its uploaded resolution (no resampling), text and QR as vectors,
      fonts embedded. Downloading it locks the slug (rule 9).
    - The voucher fiche offers « Télécharger le bon » (the same PDF as the mail) and « Renvoyer le
      mail » (to the giver's e-mail or another typed one), for a voucher valid and not used
      (rule 48). Each resend is written to the voucher's history.
50. **Every printed back** — voucher and merchant card — carries:
    - the legal mention **« Ne pas jeter sur la voie publique. »**, set vertically along the right
      edge, inside the safe area;
    - **the website** of the company settings (`siteOrigin`), at the bottom, beside the company name
      and town.

    The fronts stay the uploaded visuals, untouched.

### 3.O Booking horizons (added 2026-11-18)

51. **How far ahead the public may book is a setting**, never a constant (owner decision of
    2026-11-18).
    - **Lodging**: Réglages → Établissement (section « Réservation en ligne » — there is no separate
      « Réservations » page), « Horizon de réservation en ligne », default **12 months**, whole
      months from 1 to 36. It replaces the hard-coded 730 days of `website-booking`, and bounds the booking
      engine, its availability calendar, the next-availability search and the redemption of a lodging
      voucher.
    - **Resources**: on each resource's form, beside its opening hours, « Réservable jusqu'à »,
      default **3 months**. It bounds « Mon bain », the outside bookings on the site and the guest
      app (which also stays within the stay).
    - The back-office is never bounded.
    - The pickers stay quick over a long horizon: a row of month chips to jump to a month, a month
      grid with the days beyond the horizon disabled, and « Prochaine disponibilité ». The server
      refuses a date past the horizon with « Réservable jusqu'au … ».
    - **As built (step 3)**: the limit is « today + N months » on the server's clock (Europe/Paris)
      in `utils/bookingHorizon.js` (core module `bookingHorizon`, SDK 2.33.0). The public availability
      answer carries `horizonUntil`; its window and the next-availability search stop there; a stay
      or a window past it is refused with the sentence (French or English, per the visitor's
      language) on the `beyondHorizon` reason. A resource's horizon (1 to 24 months) bounds the
      scheduler's slots (`closed` past it) and is read through `horizonUntil(resource, now)` of the
      hourly-resources plugin; the guest app's slots answer carries it. `MonthJumpCalendar` is the
      generic picker; the WordPress calendar draws its own month chips from `horizonUntil`.

### 3.P Outside-booking fiche (added 2026-11-18)

52. **One path for the site and the back-office.** The plugin's `offerService` builds the offer
    payload (campaigns, their contents, labels, hours, add-ons), prices through the engine, creates
    orders and issues vouchers. The public controllers and the admin controllers are thin wrappers
    that call it: the public side adds the site key, the proof of work and the per-visitor limits;
    the admin side adds the session and the « Payé » / « Offert » outcomes. Neither re-implements a
    rule.
53. **A fiche for each outside booking** (hourly-resources, generic: it names no voucher).
    - Page « Fiche passage », reachable from the planning card, the visit's SAS and the voucher
      detail. `PageActionBar` with the title, back, and the SAS action.
    - It shows the client (name, e-mail, phone, linked client if any), the session(s), the sale's
      lines with what paid each (« Réglé par bon cadeau », card, cash…), the payments and the refund
      lines, the terms accepted (activity, version, date), the arrival or the no-show.
    - **History**: every event of the booking is written to `standalone_sale_history` and shown
      newest first: created (by whom, from which channel), slot held, paid, prepaid tender applied,
      terms accepted, moved, arrival, option marked « non pris », no-show, cancelled, refund line
      opened or settled.
    - Mobile: one column, history below.
    - **As built (step 5)**: `GET /api/resource-bookings/:id/fiche` (administrator) → `{ fiche: { booking, client,
      sessions, lines (with `paidBy`), totals, payments, refunds, terms, arrival, history } }`. Events written to
      `standalone_sale_history`: created, slot held, prepaid tender applied, paid (core), terms accepted
      (`ctx.terms.accept` `onAccepted`), moved, arrival, « non pris », no-show, cancelled and refunds (core). Only a
      booking made through the generic offer `bookOutside` writes « created » and « slot held ».

### 3.Q Cancelling a voucher (added 2026-11-18)

54. **« Annuler le bon »** on a voucher that is active and not used.
    - **Within 14 days of the payment** (rule 39): a confirmation dialog names the voucher and the
      amount to refund.
    - **After 14 days**: a forcing dialog states that the withdrawal period is over and asks the
      operator to confirm a goodwill cancellation; the reason is mandatory.
    - In both cases the voucher becomes « Annulé », every hold is released, and **a refund line**
      is opened for the paid amount (for a lodging voucher partly spent, its remaining balance): it
      reaches the accounting export as a refund dated the cancellation day through the plugin's
      journal contribution, and stays « à rembourser » until the operator marks it settled once the
      transfer is made. The refund itself is manual; GuestFlow makes no transfer.
    - An « Offert » voucher opens no refund line.
    - Every step is written to the voucher's history with the operator's name.
55. **A bath voucher can be bought entirely on the website**, from a campaign link or from the
    voucher page, with no action of the operator: priced, paid, issued, mailed.

### 3.R How the printed cards, the mail and the cancellation were built (added 2026-11-18)

56. **The mail is built from the voucher, so its template settings go.** The plugin no longer
    declares `mailSubjectFr/En`, `mailBodyFr/En` (the amount in an operator template contradicts
    rule 20) nor `bookingUrl` (the QR code points to `<siteOrigin>/<base>/utiliser`). `linkBase`
    (default `bon-cadeau`, one lowercase segment) is a plugin setting. The website printed on the
    cards is `publicSiteOrigin`; with none set, the PDF and the mail are refused (`NO_SITE_ORIGIN`).
57. **The recap of the mail reads frozen lines.** An order and its voucher keep, in `contents.lines`,
    the priced lines (label, quantity, unit and total incl. VAT, VAT rate) the engine answered when
    the order was priced; the recap and « dont TVA » read them and the voucher's `vatLines`, never
    the engine again.
58. **Cancellation details.** A voucher with any redemption, or expired, cannot be cancelled
    (`VOUCHER_ALREADY_REDEEMED`, `VOUCHER_EXPIRED`). The refund line is the balance left once the
    holds are released. The 14 days run from the Paris day of the payment, inclusive. Marking a
    refund settled is written to the history as « Remboursement effectué » with the operator's name;
    the journal receives a plugin's refund as `role: 'refund'` with one VAT rate per sale line.
59. **A campaign goes on sale with a voucher front** (rule 7): without one it is refused
    « Face du bon : un visuel est nécessaire pour mettre la campagne en vente. » A draft and a
    one-shot need none; a one-shot without a front draws a plain front with the company name. The
    migrated lodging campaign keeps its state until it is next edited.
60. **Terms and the public offer.** Each campaign of `GET /offer` carries the `termsVersionId` of its
    activity; a composed campaign whose activity has no published version is left out of the public
    offer and refused at the order (`TERMS_UNPUBLISHED`). The operator's payment link records the
    acceptance at the payment (`payment-link`); the mail of the link says « Le paiement vaut acceptation
    de nos conditions générales de vente : » and links the current version of the activity's text
    (`<siteOrigin>/cgv/?v=` for the lodging, `?activity=<key>&v=` for another activity).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | New / Touched | Responsibility |
|---|---|---|---|
| core | `utils/pricing/articles/families/hourly*.js`, `plugins/hourly-resources/hourlyPricing.js` (`priceMinutes`, `bandsOf`) | T | Degressivity by hour rank, per band rate, rank offset for time added to a voucher (rules 43–45) |
| core | `utils/pricing/pipelines.js`, `utils/standaloneSale.js` | T | `externalSale` prices an hourly line given `{ band, minutes, rankOffset }` (quote only, no date) or a dated session, through the hourly family with the outside context — the single price source of rules 5, 17, 26, 27 |
| core | `models/termsModel.js`, `controllers/termsController.js`, `routes/terms.js`, `database.js` | T | Terms per activity (draft, versions, publication), acceptance with activity, subject and channel (rule 37); migration of existing rows to `lodging` |
| core | `plugins/sdk/` + `coreModuleHistory.json` | T | `ctx.termsActivity({ key, label })`, `ctx.mail.send` attachments, `ctx.terms.requireAccepted(...)`; SDK minor |
| core | `utils/emailService.js`, `plugins/sdk/createContext.js` | T | `ctx.mail.send` gains `attachments: [{ filename, content, contentType }]` |
| core | `models/settingsModel.js`, `plugins/website-booking/publicInputValidation.js`, `nextAvailability.js` | T | Lodging booking horizon setting replaces the 730/365-day constants (rule 51) |
| plugin | `plugins/hourly-resources/migrations.js`, resource form fields | T | `hourlyDegressiveTiers`, `bookingHorizonMonths` on resources |
| plugin | `plugins/hourly-resources/index.js` | T | Declares the `resource` terms activity and a generic `resourceBookingOffer` hook: free slots in a window, hold 15 min, book an outside session with given lines and tender. No « voucher » word |
| plugin | `plugins/hourly-resources/visitModel.js`, `visitController.js`, `routes.js` | T | Fiche passage payload and history writes (rule 53), « non pris » marking (rule 36) |
| plugin | `plugins/hourly-resources/planningCardsModel.js`, `bookingsModel.js` | T | Options of the booking's sale and a badge from the tender source on the planning card (rule 35) |
| plugin | `plugins/guest-app/controllers/ordersController.js`, `routes/public.js` | T | Requires the activity's terms when the cart holds such a resource; records the acceptance on the reservation (rule 37) |
| plugin | `plugins/gift-vouchers/migrations.js` | T | `gift_voucher_campaigns`, `gift_voucher_visuals` + versions, `campaignId`, `contents`, `visualVersions` on vouchers and orders; settings → first `lodging` campaign; order terms → `terms_acceptances` |
| plugin | `plugins/gift-vouchers/offerService.js` | C | The one path of rule 52: offer payload, pricing through the engine, order creation, issuance |
| plugin | `plugins/gift-vouchers/catalogueView.js` | C | Every resource and option with its tariff modes and sellability reason, from the engine's articles (rule 4) |
| plugin | `plugins/gift-vouchers/campaignRules.js` | C | Composition validation (one hourly resource, band, minutes, step, sellability); shared by the form, « Sur mesure » and the recipe import |
| plugin | `plugins/gift-vouchers/models/campaignsModel.js`, `models/visualsModel.js` | C | Campaign CRUD, slug lock, duplicate, one-shot; visual library with versions and purge (rules 47–48) |
| plugin | `plugins/gift-vouchers/recipe.js` | C | Export / import of a campaign (`.zip`), all-or-nothing |
| plugin | `plugins/gift-vouchers/voucherPdf.js` | T | A6 two-sided voucher, merchant card PDF with bleed and crop marks, enlarged code box, vertical legal mention, website (rules 21, 33, 49, 50) |
| plugin | `plugins/gift-vouchers/redemption.js` | T | Kind and resource check (rule 12); settle whole; unused part (rule 15) |
| plugin | `plugins/gift-vouchers/controllers/publicUseController.js` | C | « Mon bain »: contents, slots, recap, hold, confirmation |
| plugin | `plugins/gift-vouchers/controllers/campaignsController.js`, `visualsController.js` | C | Admin campaigns, visuals, printer PDF |
| plugin | `plugins/gift-vouchers/controllers/adminController.js`, `publicOrdersController.js` | T | Thin wrappers over `offerService`; « Offert », « Envoyer un lien », cancellation with refund line (rule 54) |
| plugin | `plugins/gift-vouchers/books.js` | T | Refund lines of cancelled vouchers in the journal contribution |
| plugin | `plugins/gift-vouchers/receipt.js`, `mailTemplate.js` | T | Code + invoice recap + PDF attachment (rule 20); recipient confirmation (rule 31) |

### 4.2 Client side (`client/src/`)

| Layer | File | New / Touched | Responsibility |
|---|---|---|---|
| plugin | `plugins/gift-vouchers/CampaignsPage.jsx` | C | Campaign list (cards on xs), state, « Nouvelle campagne », « Importer une recette » |
| plugin | `plugins/gift-vouchers/CampaignEditor.jsx` | C | `PageActionBar` + sections Général, Contenu (composition), Options proposées, Visuels, Liens, Téléchargements; server-rendered preview |
| plugin | `plugins/gift-vouchers/CompositionEditor.jsx` | C | Element picker over the server's catalogue view, tariff modes, minutes, quantities; used by the campaign editor and « Sur mesure » |
| plugin | `plugins/gift-vouchers/NewVoucherPage.jsx` | C | Replaces the dialog: the site's steps (rule 41), « Sur mesure », the three outcomes |
| plugin | `plugins/gift-vouchers/VisualsPage.jsx` | C | Visual library (rule 47) |
| plugin | `plugins/gift-vouchers/GiftVouchersPage.jsx`, voucher detail | T | Columns, filters, downloads, resend, cancel with forcing dialog (rules 42, 49, 54) |
| plugin | `plugins/hourly-resources/OutsideBookingPage.jsx` | C | Fiche passage with history (rule 53) |
| plugin | `plugins/hourly-resources/PlanningResourceCard.jsx`, `ResourceArrivalDialog.jsx` | T | Server's option list, « Compris dans le bon cadeau », « non pris » |
| plugin | hourly resource form | T | Degressivity table, booking horizon |
| plugin | `plugins/guest-app/apps/guest/src/` (cart / order page) | T | Terms checkbox for an activity not yet accepted |
| component | `components/ImageDropField.jsx` | C (generic) | Upload field with preview, refusal from the server |
| component | `components/MonthJumpCalendar.jsx` | C (generic) | Month chips + month grid with disabled days, for long horizons |
| page | `pages/settings/TermsSettingsPage.jsx` | T | One tab per activity |
| page | settings « Établissement » (`SettingsBookingSection`) | T | Lodging booking horizon |

### 4.3 WordPress (`integrations/wordpress/guestflow-booking/`)

| File | New / Touched | Responsibility |
|---|---|---|
| `blocks/gift-voucher/view.js` | T | Campaign choice; resource campaigns render the server's lines; lodging keeps today's tunnel |
| `blocks/gift-voucher-use/` | C | « Utiliser un bon cadeau »: code, contents, month chips + slots, recap, terms, pay or confirm |
| `blocks/booking/view.js` | T | Month chips; forward limit from the horizon the server returns |
| `includes/class-gf-redirects.php` | C | Permanent paths (rule 9) |
| `includes/class-gf-rest-proxy.php` | T | New routes; `PLUGIN_INACTIVE` → empty render (rule 40) |

### 4.4 API contract

Public (existing key guard, proof of work on writes):

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/public/v1/gift-vouchers/offer` | — | `{ campaigns: [{ slug, kind, title, contents, addOns, extraTime, band:{ from, to } }] }` |
| POST | `/public/v1/gift-vouchers/offer/price` | `{ slug, extraMinutes, addOns:[{ articleRef, qty }] }` | `{ lines, totalCents, vat:[{ rate, cents }] }` |
| POST | `/public/v1/gift-vouchers/orders` | as today + `slug`, `extraMinutes`, `addOns`, `termsVersionId` | as today |
| POST | `/public/v1/gift-vouchers/use` | `{ code }` | `{ kind, contents, names, expiresOn, addOns, extraTime, horizonUntil }` or a refusal |
| POST | `/public/v1/gift-vouchers/use/slots` | `{ code, from, to }` | `{ days:[{ date, slots:[{ start, end, tag, supplementCents }] }] }` |
| POST | `/public/v1/gift-vouchers/use/quote` | `{ code, start: 'YYYY-MM-DDTHH:MM', extraMinutes, addOns }` | `{ included, extras, dueCents, vat }` |
| POST | `/public/v1/gift-vouchers/use/confirm` | quote + `{ email, phone, termsVersionId }` | `{ booked }` or `{ payUrl, heldUntil }` |
| GET | `/public/v1/gift-vouchers/links/:slug` | — | `{ target }` |
| GET | `/public/v1/terms` | `?activity=resource` | current version of the activity |

Admin (session):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/gift-vouchers/catalogue` | Elements with tariff modes (rule 4) |
| GET/POST/PUT | `/api/gift-vouchers/campaigns[/:id]`, `/:id/duplicate`, `/:id/merchant-card.pdf` | Campaigns, printer PDF |
| POST | `/api/gift-vouchers/campaigns/preview-price` | The engine's price of a composition being edited |
| GET/POST/PUT/DELETE | `/api/gift-vouchers/visuals[/:id]` | Visual library |
| GET | `/api/gift-vouchers/offer` · POST `/offer/price` | The same `offerService` payloads as the public routes |
| POST | `/api/gift-vouchers` | `{ slug | composition, extraMinutes, addOns, names, outcome: paid|offered|link }` |
| POST | `/api/gift-vouchers/:id/cancel` | `{ force?, reason? }` → refund line (rule 54) |
| POST | `/api/gift-vouchers/:id/refunds/:rid/settle` | The operator made the transfer: the refund line is settled (rule 54) |
| GET · POST | `/api/gift-vouchers/:id/pdf` · `/:id/resend` | The voucher PDF; the mail again, `{ email? }`, for a usable voucher (rules 48–49) |
| GET | `/api/gift-vouchers/campaigns/:id/recipe.zip` · POST `/campaigns/import` | Recipe export and import, all-or-nothing (rule 10) |
| GET | `/api/resource-bookings/:id/fiche` | Fiche passage with history (rule 53) |
| POST | `/api/resource-bookings/:id/visit/lines/:lineId/not-taken` | An element paid in advance that the client did not take (rules 15, 36) |

## 5. Data model

- `gift_voucher_campaigns`: `id`, `name`, `title`, `kind` (`lodging`|`resource`), `state`, `oneShot`,
  `slug` (unique, null for one-shot), `slugLockedAt`, `validityMonths`, `composition` (JSON: the
  hourly element `{ resourceId, band, minutes }`, `options:[{ articleRef, qty }]`), `addOns` (JSON
  `[articleRef]`), `extraTimeMaxMinutes`, `minAmountCents`, `maxAmountCents`, `ideas`,
  `vatRatePercent` (lodging only), `voucherVisualId`, `merchantVisualId`, timestamps.
- `gift_voucher_visuals` (`id`, `name`, `use`, `deletedAt`) and `gift_voucher_visual_versions`
  (`id`, `visualId`, `path`, `width`, `height`, `createdAt`, `purgedAt`).
- `gift_vouchers` and `gift_voucher_orders`: `campaignId`, `contents` (JSON, frozen), `vatLines`
  (JSON), `visualVersions` (JSON), `cancelledAt`, `cancelReason`, `cancelForced`.
- `gift_voucher_refunds`: `voucherId`, `amountCents`, `openedAt`, `settledAt`, `settledBy`.
- `gift_voucher_movements`: the `settle` movement gains `unused` (JSON, rule 15).
- `resources`: `hourlyDegressiveTiers` (JSON, default `[]`), `bookingHorizonMonths` (default 3).
- App settings: `bookingHorizonMonths` (lodging, default 12).
- Core `terms_draft`, `terms_versions`: `activity` (default `lodging`), one draft per activity.
  `terms_acceptances`: `activity`, `subjectType`, `subjectRef`, `channel`; `reservationId`
  becomes nullable.

**Migration:**
- The current settings become one `lodging` campaign; the existing vouchers and orders point to it,
  with contents `{ kind:'lodging' }`; existing images become library visuals.
- The existing terms rows get `activity = 'lodging'`; the voucher orders' terms move to
  `terms_acceptances`.
- The site's booking horizon goes from 730 days to 12 months (visible change, written in the
  changelog).

No row is deleted. The data change is recorded under « Migration ».

## 6. UI / UX

See the summary page. Mobile is the main case for the giver, who arrives from a shop's QR code, and
for the recipient: one column, a fixed bottom bar with the server's total, steppers at 44 px, month
chips that scroll horizontally. The back-office pages use `PageActionBar`; the campaign editor is
two-column on md+ (form | server-rendered preview), the preview opens full screen on xs. The
forcing dialog of rule 54 uses `ConfirmDialog` with a mandatory reason.

## 7. Test plan

One file per subject:

- `hourly-degressive-pricing.unit.test.js`: table validation; ranks and bands (18:00–21:00 =
  151 €); free minutes take the first ranks; rank offset for added time; guest and outside contexts;
  rounding adds up; empty table = today's prices.
- `gift-voucher-campaign-rules`: composition (one hourly resource, band, minutes, step), elements not
  sellable outside refused with the reason, campaign not priceable not offered.
- `gift-voucher-campaign-pricing`: engine only; extra time continues the ranks; day voucher into the
  evening; evening voucher offers evening slots only; VAT per class at the outside rate.
- `gift-voucher-offer-service`: public and admin wrappers return the same payload and price for the
  same request; one-shot follows the same path.
- `gift-voucher-campaign-orders`: nothing exists before payment; repricing at the link; late
  confirmation issues; « Offert » records no sale; admin link order follows the standard path and
  records the terms with the channel « lien de paiement ».
- `gift-voucher-campaign-redemption`: kind and resource refused; used once; unused part; a voucher
  covering everything books at once; a remainder books only on payment; the 15-minute hold blocks the
  slot and lapses; a late payment on a slot taken opens a refund line; one transaction; horizon.
- `gift-voucher-visuals`: size/ratio refusal; replace creates a version; delete refused while on sale;
  issued vouchers keep their version; purge once no valid unused voucher carries it; download and
  resend refused for used/expired.
- `gift-voucher-mail-pdf`: mail wording, code, recap, attachment; no amount on a bath PDF; back reads
  the campaign and settings; enlarged code box; vertical legal mention and website on both backs.
- `gift-voucher-cancel`: within 14 days; forced after with reason; refund line in the journal; balance
  of a partly spent lodging voucher; « Offert » opens none; history.
- `terms-per-activity`: draft/publish per activity; acceptance on order, outside booking, reservation
  (guest app); refusals; migration of existing rows.
- `guest-app-resource-terms`: cart with the bath requires the activity's terms once per version.
- `booking-horizons`: lodging setting replaces 730 days; resource horizon on slots; back-office
  unbounded.
- `outside-booking-fiche`: payload and history events.
- `resource-booking-holds` (hourly-resources): the offer is reached through the core; free slots, bands, the hold in
  every read, expiry and its job, one hold per reference, the booking that consumes a hold.
- `resource-planning-card-options`: options and badges of the card, the reception's whitelist.
- `resource-visit-prepaid-lines`: the SAS section, « non pris » and its generic callback, no refund of a prepaid line.
- `resource-booking-offer-sdk` (core, generic): the offer's declaration, `unused` and the wording of a prepaid source,
  `takePrepaid` and `paidByOf`.
- `gift-voucher-campaign-wordpress`: blocks render nothing with the plugin off; redirects; field
  hidden in the booking engine.

Client (Vitest, one file per subject): `CompositionEditor`, `NewVoucherPage`, `VisualsPage`,
`GiftVouchersPage.cancel`, `OutsideBookingPage`, `MonthJumpCalendar`.

E2E on the sandbox: buy a bath voucher on the site; redeem it with and without a remainder; the
planning card and the fiche; the merchant card QR to the purchase page; a bath ordered in the guest
app with the terms.

Manual checks: the printed A6 PDF at 100 % scale on the printer's proof; QR codes read from paper;
390 / 900 / 1280 px.

## 8. Out of scope

- Merchant accounts, commissions, per-merchant statistics.
- Pre-activated codes printed on the cards.
- Selling a bath without a voucher on « Mon bain »: the page makes it possible later.
- Several sessions, or several hourly resources, on one voucher; a voucher with options only.
- Redeeming a bath voucher inside the guest app during a stay.
- An automatic refund transfer: refunds are made by hand (rule 54).

## 9. Open questions

- **Q1 — resolved 2026-11-18:** the slot is held 15 minutes while the remainder is paid (rule 29).
- **Q2 — resolved 2026-11-18:** a lodging voucher's back shows its amount, a bath voucher never does.
- **Q3 — resolved 2026-11-18:** bath terms values: 8 people; not recommended under 12; minors
  under their parents' entire responsibility; the stove clause; no alcohol clause; no mediator
  clause; the other values as recommended (48 h postponement, 30 minutes of lateness, orange
  weather warning) (rule 38).
- **Q4 — VAT (for the accountant).** A bath voucher is single-purpose: VAT due at the sale, at the
  outside rates. A lodging amount voucher is multi-purpose: EU rules put its VAT at the redemption;
  today it is booked at the sale at 10 %. An « Offert » voucher records no sale.
- **Q5 — resolved 2026-11-18:** developed in PR #1055 (`feature/gift-vouchers`).
- **Q6 — resolved 2026-11-18:** degressivity is a percent per hour rank on the resource, applied
  everywhere the resource is priced (rules 43–45).
- **Q7 — resolved 2026-11-18:** a cancellation always opens a refund line, forced or not (rule 54).
- **Q8 — resolved 2026-11-18:** booking horizons are settings — lodging in Réglages → Réservations
  (12 months), resources on each resource (3 months) (rule 51).
