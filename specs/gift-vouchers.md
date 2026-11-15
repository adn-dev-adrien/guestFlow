# Gift vouchers

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/gift-vouchers`, one PR, created once pricing-components PR C is merged |
| **Created** | 2026-11-15 |
| **Author** | Adrien |
| **Related PR** | — |
| **Summary for validation** | `specs/gift-vouchers-resume.html` (French, interactive mock-ups) |

---

## 1. Context

GuestFlow sells one thing online: a dated stay. The website tunnel (`website-booking` plugin, WordPress
block `blocks/booking/view.js`) creates a draft devis, mints a Qonto payment link for its acompte or its
total, and converts the devis into a reservation when the link is paid. There is no way to collect an
amount "to be used later", and nothing can deduct such an amount from a later booking. The only "gift
voucher" in the code is the seasonal marketing e-mail `season_gift_vouchers`.

Adrien wants to sell gift vouchers on his site, the way
`https://www.location-en-dordogne.com/bonscadeaux.html` does: a « Bon cadeau » button next to
« Réserver », a free amount, a printable voucher, and a code the beneficiary types when booking real
dates. That site (engine: vac-office) sells a free amount valid 18 months, e-mails the voucher within
minutes, and accepts it as a payment method at booking; the unused remainder stays usable. It shows no
price guidance and says nothing of how the code is protected.

What the code base offers today, and what it lacks (measured 2026-11-15):

- **Plugins.** A plugin owns its tables, routes, jobs and client pages (`specs/plugins-phase-1-sdk.md`).
  `guest-app` is the structural model: own tables, a public tree with its own rate limiters, an admin
  router, a pdfkit document, tokens stored hashed.
- **A payment link needs a reservation** on `master` (`payment_links.reservationId NOT NULL`). The
  pricing-components branch C (`feature/pricing-components-c`, unmerged, `specs/pricing-components.md`
  rule 53) makes it nullable, adds `saleRef`, the `standalone_sales` tables and the paid-link branch
  `standaloneSaleLinks.settlePaidLink`.
- **No prepaid amount exists on a reservation.** The public « due now » is the stored acompte, or acompte
  + solde; a paid link whose amount differs from its bucket goes through the mismatch path. Payment
  methods are a fixed core list with a CHECK on `payment_tenders.method`; a settlement is never used on
  a link payment and never on the acompte (`specs/mixed-method-payments.md` rules 2 and 44).
- **A plugin cannot send an e-mail** of its own, and e-mails carry no attachment.
- **The public API key guard** (`requirePublicApiKey`, `visitorContext`) belongs to `website-booking`;
  a second plugin cannot import it. The WordPress REST proxy forwards a fixed list of routes.

## 2. Goal

A visitor buys a gift voucher of the amount they choose on the website, pays it through the same hosted
payment page as a booking, and gets a printable voucher bearing a code at once. Later, whoever holds the
code types it while booking dates, and the voucher's balance pays for the stay, in part or in full.

## 3. Functional rules

### 3.A The plugin

1. Everything lives in a plugin `gift-vouchers` (server and client). Off or absent, GuestFlow shows no
   trace of vouchers: no menu, no public route (404 `PLUGIN_INACTIVE`), no field in the booking engine.
2. The online sale needs a payment provider, but `manifest.json` declares **no** `requires` (decided at
   implementation, 2026-11-15): a dependency edge would stop the plugin from running without the
   payment plugin, whereas vouchers sold by hand (rule 24) must work without one, and the shipped
   graph admits only the edges rule 20 of `specs/plugin-dependencies.md` arbitrated. The plugin reads
   the provider live: while none is connected the public offer answers `available: false`.
3. Nothing in the plugin or in the core additions names an establishment, a property or a platform. The
   brand printed on the voucher is the company name from the settings.
4. Deactivating the plugin keeps every voucher. Erasing its data (`ctx.data.purge`) is refused while any
   voucher has a balance above 0 or a movement on a live reservation (« Money never moves »,
   phase-1 rule 20): the operator must cancel or let them expire first.

### 3.B What a voucher is

5. A voucher is **an amount in euros**, never a package, a stay or a date. It is identified by a number
   (`BC-<year>-<4 digits>`, per-year sequence, shown to the operator and on the voucher) and
   authenticated by a **code** (section 3.F). The number alone gives no right.
6. The amount is free, between `minAmountCents` and `maxAmountCents` (settings, defaults 20 € and
   2 000 €), in cents, at most two decimals.
7. A voucher is valid `validityMonths` (setting, default 18) from the day its payment is confirmed. The
   expiry date is stored on the voucher at issue: changing the setting never moves an issued voucher.
8. A voucher is usable **in one or several bookings** until its balance is 0 or it expires. Its balance
   is never paid out in money and never gives change.
9. A voucher is usable on **direct reservations only** (the website tunnel and a fiche whose platform is
   in direct mode — read from the platform's mode, never from its name).
10. States: `pending` (order created, payment not confirmed — no code exists yet), `active`
    (untouched), `started` (usable, balance below the issued amount), `exhausted` (balance 0), `expired`,
    `cancelled`. `started`, `expired` and `exhausted` are derived at read time from the expiry date and the
    ledger, never stored; only `pending`, `active` and `cancelled` are stored. `active` and `started` are both
    usable (rule 8), and the public check answers `usable: true` for either.
11. The balance is **always** the sum of the voucher's movements (rule 31). No column stores a balance
    that could drift from the ledger.

### 3.C Buying on the website

12. The purchase is a tunnel of its own: its own WordPress block, its own public routes, its own tables.
    It never creates a devis, a reservation or a client fiche, and never goes through the booking
    controller. It shares only stateless parts with the booking tunnel: the API runtime, the
    proof-of-work, the form field styles, the hosted payment page and the payment-return polling.
13. The form asks for: the amount; « Pour » and « De la part de » (optional, 40 characters each); a
    message (optional, 200 characters); the buyer's e-mail (required); acceptance of the terms
    (required). Nothing else. Free texts are stored as typed and escaped at every output (HTML, PDF).
14. **Price guidance.** Under the amount, the form lists « idées » the operator configured (setting
    `ideas`, at most 6). An idea is always a stay to price, `{ label, propertyId, nights, guests }` —
    never a bare amount: the free amount field already covers that (Adrien, 2026-11-15). The **server**
    prices it with the direct quote engine over the next 12 months and returns one amount per tariff
    season it finds (label and lowest price of that season), or a single « à partir de » amount when the
    property has no named season. A click on an amount fills the field; it never locks it. Ideas are
    recomputed at most once a day and on `pricing.changed`. The list always ends with the sentence
    « Prix indicatifs, susceptibles d'évoluer. » (Adrien, 2026-11-15): an idea is a hint at today's
    tariff, never a promise that the amount will pay for that stay. With no idea configured, neither
    the list nor the sentence is shown.
15. The order is created by `POST /public/v1/gift-vouchers/orders` behind the public API key, the
    visitor context, a solved proof-of-work and a rate limit (5 orders per visitor per hour). The server
    validates every field again and answers the order id and a public token.
16. Paying mints a payment link **with no reservation**, labelled « Bon cadeau de <montant> » (the
    voucher number does not exist before the payment: it is drawn at issuance), through the core's
    link of a plugin basket with no stay (`core.payments.saleLink`, SDK 2.31.0). It sits on the same
    `payment_links` row and the same `saleRef` column as the standalone sale of pricing-components
    PR C — `saleRef = giftVoucher:<orderId>` — but not on its sale document, which prices articles:
    a voucher is not an article. The link lives 30 minutes; asking again hands back the open link
    while it has 5 minutes left, otherwise the old one is retired and a new one minted. The visitor
    is redirected to the hosted page and returns to the page they left (`returnPath`, a path of the
    site; the server builds the address from the site origin) with
    `?gf_voucher=<orderId>&gf_token=<token>`.
17. **A voucher is issued only when the bank says the link is paid** (webhook re-read or poll — the
    existing paid-link path), never on the browser's return. Issue is one transaction: the code is drawn,
    the voucher becomes `active`, the `issue` movement is written. A link paid twice or a replayed
    webhook issues nothing more (idempotent on the link id: movement key `issue:link:<id>`). The core
    hands the paid link to the plugin through `ctx.paymentBasket({ source: 'giftVoucher', paid })`
    (`reservationId` null); a second link of an already issued order, an amount that is not the
    order's, or an order that is gone are money flagged « à rembourser » on the link, never a voucher.
    The status read of the voucher page asks the bank again while the order is pending (the same
    on-demand read as a booking's), so the page does not wait for the poll.
18. An order whose link expires or is abandoned stays `pending` and is deleted after 7 days by a job. It
    never shows in the operator's list.
19. The terms accepted at purchase are recorded by the plugin on the order (version id of the terms,
    date, visitor IP hash): `terms_acceptances` requires a reservation and is not touched.

### 3.D Delivering the voucher

20. On return from a confirmed payment the page shows the voucher itself — amount, names, message, code,
    expiry — with « Télécharger le PDF » and « Imprimer ». While the payment is not confirmed yet it
    shows the same waiting state as a booking, and polls.
21. The same page stays reachable through a **voucher link** (`/…?gf_voucher=<id>&gf_token=<token>`):
    a 24-byte random token stored hashed. The link shows and prints the voucher; it cannot spend it.
22. The PDF is one A4 page generated by the server with pdfkit and the embedded fonts of the devis: the
    voucher on the top half, the conditions of use below, and a QR code to the booking page carrying the
    code in the URL **fragment** (`#bon=<code>`), which browsers do not send to servers.
23. An e-mail goes to the buyer when the voucher is issued: subject and body from a template the
    operator edits in the plugin's settings (French and English), holding the amount, the expiry and the
    voucher link — **not** the code, and no attachment. It is sent automatically: this is the one
    exception to `specs/no-automatic-email-without-approval.md`, recorded there (2026-11-15), because
    the e-mail is the receipt of a payment the buyer just made (Q2, resolved). It leaves through
    `ctx.mail.send` and writes a `mail` movement (actor « Automatique »). A failed send is retried every
    15 minutes for 3 days after issuance (a voucher sold by hand is never mailed automatically) and
    shown on the voucher (« Mail non parti » = `mailError` set, `mailSentAt` null, in the list and the
    detail payloads) with « Renvoyer », which uses the same delivery.

### 3.E The operator's page

24. « Bons cadeaux » page (admin role): the list of issued vouchers (number, buyer, date, state, balance
    over amount, expiry), searchable by number, e-mail or name, with the total outstanding balance. A
    voucher sold outside the site is created there (« Nouveau bon » : amount, names, message, buyer
    e-mail optional, how it was paid among the core payment methods, date) and issued at once.
25. A voucher's detail shows its movements and offers: « Renvoyer le mail », « Télécharger le PDF »,
    « Prolonger » (new expiry date, in the future; allowed on an expired voucher, which becomes usable
    again), « Annuler » and « Corriger le solde ». Every action writes a movement with its author.
26. The code is shown **masked** (last 4 characters). « Afficher le code » is an admin-only call that
    decrypts it and writes a `reveal` movement.
27. « Annuler » is offered on a voucher with no `redeem` movement. It sets `cancelled`, writes a
    `cancel` movement of minus the balance, and — for a voucher paid by link — flags the amount as a
    refund owed in the core's refund register; GuestFlow sends no money itself.
28. « Corriger le solde » (admin, reason required) writes an `adjust` movement, positive or negative,
    never taking the balance below 0 or above the issued amount.
29. The reception role sees nothing of the plugin.

### 3.F The code

30. Format: 16 characters of the Crockford base-32 alphabet (`0-9 A-Z` without `I L O U`), printed in
    groups of four: `7K2Q-HD9M-4TXB-3NPC`. 15 characters come from `crypto.randomBytes` (75 bits) with
    rejection sampling; the 16th is a check character. Nothing in it derives from the amount, the date,
    the number or the buyer. Input is normalised before any check: upper case, `I`/`L` → `1`, `O` → `0`,
    separators dropped.
31. **Ledger.** `gift_voucher_movements` holds one row per event: `issue` (+amount), `hold` and
    `release` (rule 36), `redeem` (−), `refund` (+, rule 40), `adjust` (±), `cancel` (−), `extend`,
    `reveal`, `mail`. Each row has its date, author (user id, `public` or `system`), the reservation or
    order it concerns and a unique idempotency key. Rows are never updated or deleted.
32. **Storage.** The code is never stored in clear. The voucher keeps `codeHash` =
    HMAC-SHA-256(pepper, normalised code), unique-indexed, and `codeEncrypted` (AES-256-GCM, the core
    helper) so the voucher can be shown and printed again. The pepper is a plugin secret created in
    `.env.local` (`sdk.secrets.getOrCreate`), never in the database: a stolen database or backup can
    neither read nor test a code.
33. **Checking a code** (`POST /public/v1/gift-vouchers/check`) requires the public API key, a solved
    proof-of-work and passes three limits: 5 failed checks per visitor per 15 minutes, 20 per visitor
    per day, and a global breaker — more than 30 failed checks in an hour over the whole instance
    refuses every public check for 30 minutes (`429 VOUCHER_CHECKS_PAUSED`), raises an « À traiter »
    item and a push to the operator. The operator's fiche is not subject to the breaker.
34. A code whose check character is wrong is answered `400 VOUCHER_CODE_MISTYPED` before any lookup and
    **does not count** as a failed check. A well-formed unknown code answers `404 VOUCHER_UNKNOWN` and
    counts. A known code answers its state: balance and expiry when usable, « expiré le … »,
    « entièrement utilisé », or `VOUCHER_UNKNOWN` when cancelled. Only the holder of a full real code
    learns anything about it.
35. A check never changes anything. Every check, failed or not, is counted in `gift_voucher_checks`
    (visitor hash, time, outcome — never the typed code); rows older than 30 days are purged.

### 3.G Using a voucher on a booking

36. **On the website**, the payment step of the booking engine shows a « Bon cadeau » field while the
    plugin is live. A valid code is sent with the booking request. The server checks it again and, in
    the transaction that creates the draft devis, writes a `hold` of `min(balance, total of the stay)`
    for that devis. One voucher per online request.
37. A held amount is unavailable to any other request. The hold is released (`release` movement) when
    the devis is deleted (the operator's delete, the 30-day purge of untouched requests) or lapses unpaid
    (an hourly job gives back the holds of a quote still unconverted 72 hours later — longer than a
    payment link lives, so a link paid at the last minute still finds its hold). A devis has no « refused »
    state in the code base: deletion is the only refusal.
38. **The voucher pays the earliest amounts due first**: the acompte, then the solde. « À payer
    aujourd'hui » is what the chosen mode (acompte or total) still asks after the voucher; the card link
    is minted for that amount (its VAT basket reduced the stay line first, and the amount-mismatch guard of
    the paid link expects that reduced amount). When nothing is due now, no link is minted: the payment
    step confirms at once and the devis converts to a reservation through the same effect a paid link has.
    The hold may exceed what the mode asks (300 € on a 268 € stay in acompte mode): the solde is then
    paid by the voucher too — whole, or in part with a « Reste à percevoir » (mixed-method-payments rule 16).
39. At conversion the hold becomes a `redeem` movement and the reservation carries the voucher amount as
    **money received, method « Bon cadeau »**, dated that day, visible as its own line in the fiche's
    payments. The stay's price, tourist tax, commission and statistics are those of the same stay paid
    by card (Q1, resolved).
40. **On a fiche**, « Payer par bon cadeau » (admin) takes a code and an amount up to the balance and
    what the stay still owes — its acompte and solde, the stay's price; the arrival complement and the end
    of stay keep their own gestures — and writes the same `redeem` and the same received amount (acompte
    first, whole or not at all; then the solde, a part being a reste à percevoir). Undoing it
    writes a `refund` movement and removes the received amount. Cancelling the reservation offers
    « Recréditer le bon » for the voucher part, never a refund in money; the cancellation indemnity is
    taken from the card and other payments first.
41. A voucher that expires while held or redeemed is not taken back: expiry stops new uses only. A
    `refund` on an expired voucher re-credits it and extends it by 3 months from that day.
42. The books count a voucher's money once: when it was collected (the voucher's sale). The « Bon
    cadeau » amount received by a stay is not a second encaissement and is never expected at the bank:
    the tender line is `prepaid`, which is no bank method and whose `collectedCents` the accounting export
    and the finance dashboard's encaissements leave out (mixed-method-payments rule 60). The stay still
    counts it as received (what it owes, « Perçu »). Open question Q3 settles accounts and VAT.

**Edge cases:**
- Amount `19,99`, `2000,01`, `12,345`, `abc`, empty → refused inline, each with its own sentence.
- The buyer closes the tab on the payment page → the order stays `pending`; when the bank confirms, the
  voucher is issued and the e-mail carries the link.
- The buyer pays, the webhook never comes → the poll issues the voucher.
- Two visitors apply the same code at the same second → one `hold` wins (`BEGIN IMMEDIATE`), the other
  is told the balance left.
- Voucher 300 € on a 268 € stay → 268 € used, 32 € stay on the voucher until its expiry.
- Voucher 50 € on an 80,40 € acompte → 30,40 € by card now, the solde unchanged.
- The stay's price changes after a voucher was applied → the received amount is unchanged; what is
  owed is recomputed around it as for any received money.
- A name of 40 `W`, a message of 200 characters without a space, an emoji → the voucher wraps and never
  overflows, on screen and in the PDF.

---

## 4. Architecture

> Fat backend, thin frontend: amounts, validity, balances, price ideas, code checks and limits are all
> computed and judged by the server. The client formats what it receives. The one piece of logic on the
> client is the code's check character, a UX hint (rule 34) the server re-verifies.

### 4.1 Server side (`server/src/`)

**Plugin `server/src/plugins/gift-vouchers/` (all created):**

| Layer | File | Responsibility |
|---|---|---|
| entry | `index.js`, `manifest.json` | `register(ctx)`: migrations, settings, mounts, jobs, events, hooks |
| schema | `migrations.js` | The four tables of §5 |
| routes | `routes/public.js` | `/public/v1/gift-vouchers/*` behind key, visitor context, limiters |
| routes | `routes/admin.js` | `/api/gift-vouchers/*` (admin role) |
| controllers | `controllers/publicOrdersController.js` | Offer, order, pay, status (voucher view), PDF |
| utils | `orderPaid.js` | The plugin's `paymentBasket` effect: issue on a paid link, idempotent, refund flags |
| utils | `receipt.js` | The e-mail of a voucher: automatic receipt at issuance, the operator's « Renvoyer », the retry job |
| utils | `visitorHash.js` | HMAC of the visitor's address, for the order and check limits |
| controllers | `controllers/publicCheckController.js` | Code check (rules 33-35) |
| controllers | `controllers/adminController.js` | List, detail, manual issue, extend, cancel, adjust, reveal, resend |
| utils | `movementView.js` | Shapes a ledger row for the screen: French label, Paris day, author name |
| models | `models/vouchersModel.js`, `models/ordersModel.js`, `models/movementsModel.js`, `models/checksModel.js` | DB access; `movementsModel` is the only writer of balances |
| utils | `code.js` | Draw, normalise, check character, HMAC, encrypt/decrypt — pure, injected randomness |
| utils | `voucherRules.js` | Amount bounds, expiry, derived state, what a redeem may take — pure |
| utils | `ideas.js` | Price guidance from the quote engine, cached (rule 14) |
| utils | `voucherPdf.js` | pdfkit A4 voucher + QR |
| utils | `rateLimiters.js` | Per-visitor limits and the global breaker |
| utils | `redemption.js` | The plugin's side of `ctx.prepaid` (`apply` holds, `held`, `settle` releases then redeems, `release`), the lapsed-hold job, and `refund` (re-credit, +3 months on an expired voucher) |
| controllers | `controllers/stayController.js` | The fiche's payload, « Payer par bon cadeau », its undo and « Recréditer le bon » |
| jobs | in `index.js` | Purge pending orders (daily), retry receipts (15 min), release lapsed holds (hourly), purge checks (daily) |

**Core additions — generic, none names vouchers:**

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/sdk/` | `index.js`, `createContext.js` | T | Export the public API guard chain (`middleware.publicApi`), moved out of `website-booking`; `ctx.mail.send({ to, subject, text, html, key })` for an e-mail not tied to a stay, logged in the e-mail history; SDK minor recorded in `coreModuleHistory.json` |
| `plugins/website-booking/` | `requirePublicApiKey.js`, `visitorContext` | T | Re-exported from the SDK; behaviour unchanged |
| `utils/`, `controllers/` | `paymentRequestService.js` (`ensureSaleLink`), `basketPayments.js` (`saleLink`), `paymentsController.js`, `plugins/sdk/coreServices.js` | C/T | `core.payments.saleLink({ source, ref, title, amountCents }, { redirectUrl })` (SDK 2.31.0): the link of a plugin's basket with no stay, billed to `<source>:<ref>` in the existing `payment_links.saleRef`; PR C's `saleRef` column and no-orphan rules are consumed as delivered |
| `utils/` | `paymentPollRunner.js` (`applyPaidEffect`) | T | A paid link whose `saleRef` is a plugin's basket source goes to `ctx.paymentBasket`'s `paid` with `reservationId: null` (stays and `standalone-sale` links unchanged) |
| `utils/`, `models/`, `schema.sql` | `paymentTenders.js`, `paymentSettlementsModel.js`, `paymentSettlementsMigration.js` | T | The received-in-advance amount is a tender line of the method `prepaid` with its `source`, `ref` and `label`: the CHECK of `payment_tenders.method` is widened and the three columns added by an idempotent table rebuild (`changelog.d/migration--gift-vouchers-tender-method.md`); `settlementFigures` gains `prepaidCents` and `collectedCents` (mixed-method-payments rules 59-60) |
| `utils/` | `prepaidSources.js`, `prepaidReceipts.js` (SDK modules) | C | What a quote holds, what it takes off the public payment, the settlements written at conversion and by the fiche, the confirmation without a link (rules 59-62) |
| `utils/`, `controllers/`, `models/` | `paymentPollRunner.js`, `publicPaymentController.js`, `devisModel.js`, `reservationLedger.js`, `accountingOutput.js`, `financeDashboardModel.js` | T | The reduced amount and the conversion hook, the pay route's reduction and no-link path, the release on delete, the ledger line « Bon cadeau » (no « Modifier »), the journals reading `collectedCents` |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `index.js`, `coreModules.json`, `coreModuleHistory.json` | T | `ctx.prepaid({ source, label, apply, held, settle, release })` and the two modules, all at the 2.31.0 entry (no new minor) |
| `plugins/website-booking/` | `publicPrepaid.js`, `publicBookingRequestController.js`, `publicQuoteController.js` | T | Passes the opaque `prepaid` field of the request and of the quote to the live source, in the request's own transaction; knows nothing of vouchers; the quote lists `payment.prepaidKinds` while a plugin takes one |

**Notes:**
- Depends on pricing-components **PR C merged** (link without reservation, standalone sale). Building
  on `master` before that would duplicate a table rebuild of `payment_links` that PR C already does.
- New dependency: none (`pdfkit`, `qrcode` are present).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| plugin | `plugins/gift-vouchers/index.js` | C | `routes`, `nav.items`, `settings.menu` contributions |
| plugin | `plugins/gift-vouchers/GiftVouchersPage.jsx` | C | List + detail, `PageActionBar` |
| plugin | `plugins/gift-vouchers/GiftVoucherDialog.jsx` | C | « Nouveau bon » and the detail's actions |
| plugin | `plugins/gift-vouchers/GiftVoucherSettings.jsx` | C | Settings route `/parametres/bons-cadeaux` (`settings.menu`, after « Emails & notifications »): validity, bounds, ideas, e-mail template |
| plugin | `plugins/gift-vouchers/GiftVoucherDetail.jsx`, `GiftVoucherActionDialogs.jsx` | C | The detail (side panel on `lg`, dialog below) and its « Prolonger » / « Corriger le solde » dialogs |
| plugin | `plugins/gift-vouchers/giftVouchersApi.js`, `giftVoucherTexts.js`, `giftVoucherFormat.js` | C | `/api/gift-vouchers/*` calls, French copy and state maps, cents ↔ euros display |
| core (client) | `constants/plugins.js`, `plugins/sdk/index.js` | M | `GIFT_VOUCHERS` id; no payment-method list on the client: the admin list payload carries `paymentMethods` |
| plugin | `plugins/gift-vouchers/ReservationVoucherCard.jsx` | C | « Payer par bon cadeau », its undo and « Recréditer le bon » in the `reservation.cards` slot; renders what `GET /api/gift-vouchers/stays/:id` shapes |

| Category | Components | Notes |
|---|---|---|
| **Consumed** | `PageActionBar`, `DataPageScaffold`, `TableCard`, `FormDialog`, `ConfirmDialog`, `StatusBadge`, `SummaryItem`, `EmptyState`, `ErrorAlert`, `LoadingState`, `HelpedTextField` | Through the client SDK |
| **Created (generic)** | `MaskedValue` — a value shown masked with a « Afficher » action that calls the server | Only if `SummaryItem`'s masked mode cannot call the server on reveal; reusable for any secret a page must be able to show once |
| **Specific** | The four plugin files above | Voucher business only |

**WordPress plugin `integrations/wordpress/guestflow-booking/`:**

| File | T/C | Responsibility |
|---|---|---|
| `blocks/gift-voucher/{block.json,render.php,view.js}` | C | The purchase tunnel and the voucher page; its own state machine |
| `includes/class-gf-rest-proxy.php` | T | Proxy routes for `gift-vouchers/{offer,orders,orders/:id/pay,orders/:id,check}` and the PDF stream; the pay route forwards the token and a same-site `returnPath` only |
| `includes/class-gf-shortcodes.php`, `class-gf-blocks.php` | T | `[guestflow_gift_voucher]`, `[guestflow_gift_voucher_button]`, block registration |
| `assets/voucher-code.js` | C | Normalise, group and pre-check a code — used by both blocks |
| `blocks/booking/view.js` | T | One « Bon cadeau » field at the payment step (code normalised and check-verified by `GF.voucherCode`, `#bon=` of the QR prefilled), sent as `prepaid` with the quote and with a paying request; rendered only while the quote lists `payment.prepaidKinds`; shows the server's `− applied` and « À payer aujourd'hui » |
| `assets/style.css` | T | Voucher card and code field, on the existing `--gfb-*` tokens |

The Solio header button and the « Bon cadeau » page are site content (WordPress on the site host), not
part of this repository.

### 4.3 API contract

Public — API key + visitor context; `POST` also need a solved proof-of-work unless noted:

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/public/v1/gift-vouchers/offer` | — | `{ available, brand, minAmountCents, maxAmountCents, validityMonths, ideas:[{ label, amounts:[{ label, amountCents }] }], termsVersionId }` | Cached |
| POST | `/public/v1/gift-vouchers/orders` | `{ amountCents, recipientName?, senderName?, message?, email, termsVersionId, language, challenge, nonce }` | `201 { orderId, token }` | 403 `CHALLENGE_INVALID`; 400 `VOUCHER_AMOUNT_OUT_OF_BOUNDS`, `AMOUNT_INVALID`, `EMAIL_INVALID`, `TERMS_REQUIRED` (the version id is not the current one), `FIELD_INVALID`, `BODY_INVALID`; 429 `TOO_MANY_ORDERS` + `Retry-After` (5 per visitor per hour, counted on stored orders) |
| POST | `/public/v1/gift-vouchers/orders/:id/pay` | `{ token, returnPath? }` | `{ paymentUrl }` | No proof-of-work; `paymentStartLimiter`; 404 `VOUCHER_ORDER_NOT_FOUND`; 409 `ONLINE_SALE_UNAVAILABLE`, `VOUCHER_ALREADY_ISSUED`, `PAYMENT_PENDING`; 502 `PAYMENT_PROVIDER_ERROR` |
| GET | `/public/v1/gift-vouchers/orders/:id?token=` | — | `{ state, voucher?: { number, brand, amountCents, balanceCents, expiresOn, recipientName, senderName, message, code } }` | `state` `pending` (no `voucher`) or the voucher's state; `code` null once cancelled; 404 on a wrong token or an unknown id (same answer); `paymentStatusLimiter` |
| GET | `/public/v1/gift-vouchers/orders/:id/pdf?token=` | — | `application/pdf` | 404 while pending or cancelled; `?lang=` overrides the order's language |
| POST | `/public/v1/gift-vouchers/check` | `{ code }` | `{ usable, balanceCents?, expiresOn?, reason? }` | 400 `VOUCHER_CODE_MISTYPED`, 404 `VOUCHER_UNKNOWN`, 429 `VOUCHER_CHECKS_EXCEEDED` / `VOUCHER_CHECKS_PAUSED` |

Admin — session, admin role, `requirePlugin`:

| Method | Endpoint | Request | Response |
|---|---|---|---|
| GET | `/api/gift-vouchers?q=&state=` | `state` ∈ pending, active, started, exhausted, expired, cancelled | `{ items:[…], outstandingCents, paymentMethods:[{ value, label }] }` — `paymentMethods` is the core list, for the « Payé par » select of « Nouveau bon » |
| GET | `/api/gift-vouchers/:id` | — | voucher + code masked + `movements:[{ id, kind, label, amountCents, date, actorName, reservationId, note }]` — `label` in French (« Émission », « Prolongé jusqu’au 15/01/2029 », « Solde corrigé : <motif> »…), `date` the Paris day (`YYYY-MM-DD`), `actorName` the user's display name, « Site » or « Automatique »; `note` is null for `extend`/`adjust` (already in the label) |
| POST | `/api/gift-vouchers` | manual issue (rule 24) | `201` voucher |
| POST | `/api/gift-vouchers/:id/{extend,cancel,adjust,resend,reveal}` | per action | voucher, or `{ code }` for `reveal` |
| GET | `/api/gift-vouchers/:id/pdf` | — | `application/pdf` |
| GET | `/api/gift-vouchers/stays/:reservationId` | — | `{ reservationId, kind, canPay, owedCents, lines:[{ ref, label, amountCents, paidDate, buckets, undoable }], recredit?:{ voucherCents, recreditCents, keptCents } }` (`recredit` on a cancelled stay) |
| POST | `/api/gift-vouchers/stays/:reservationId/pay` | `{ code, amountCents }` | the same payload; 400/404/409 with `{ error, message }` |
| DELETE | `/api/gift-vouchers/stays/:reservationId/payments/:ref` | — | the same payload |
| POST | `/api/gift-vouchers/stays/:reservationId/recredit` | — | the same payload |

The fiche's routes live under the plugin's own tree (`/api/gift-vouchers/stays/…`), not under `/api/reservations`: a plugin owns no path outside its mounts.

The booking request and the quote gain `prepaid: { kind: 'giftVoucher', code }` (`POST /public/v1/booking-requests`,
`POST /public/v1/quote`); an unknown `kind` or an inactive plugin → 400 `PREPAID_UNAVAILABLE`. On the request, a refused code
answers its own status and code (`VOUCHER_CODE_MISTYPED` 400, `VOUCHER_UNKNOWN` 404 with `triesLeft`, `VOUCHER_EXPIRED` /
`VOUCHER_EXHAUSTED` 409, `VOUCHER_BALANCE_CHANGED` 409 with `balanceCents`, the check limits 429 + `Retry-After`) and creates
nothing; the response carries `prepaid: { label, appliedCents, dueTodayCents, balanceLeftCents }`. On the quote, a refused
code never fails the quote: `payment.prepaid` is `{ refused: { code, message, … } }` or the same block as the request's, and
`payment.prepaidKinds: [{ kind, label }]` is present while a plugin takes a prepaid means of payment (the field the page
shows). `POST /booking-requests/:id/pay` answers `{ paymentUrl: null, amountCents: 0, confirmed: true }` when nothing is due.
Additions only: `/public/v1/**` keeps every existing field (a Y release).

---

## 5. Data model

Plugin tables, created by plugin migrations (`plugin:gift-vouchers:*`), no core table touched by the plugin:

- `gift_voucher_orders` — `id`, `publicTokenHash`, `amountCents`, `recipientName`, `senderName`,
  `message`, `email`, `language`, `termsVersionId`, `termsAcceptedAt`, `visitorHash`, `source`
  (`site` | `manual`), `paymentMethod` (manual only), `linkId` (nullable), `state`, `createdAt`,
  `createdBy`.
- `gift_vouchers` — `id`, `orderId` UNIQUE, `number` UNIQUE, `codeHash` UNIQUE, `codeEncrypted`,
  `amountCents`, `issuedAt`, `expiresOn`, `cancelledAt`, `mailSentAt`, `mailError`.
- `gift_voucher_movements` — `id`, `voucherId`, `kind`, `amountCents` (signed, 0 for non-money kinds),
  `reservationId`, `devisId`, `actor`, `note`, `idempotencyKey` UNIQUE, `createdAt`.
- `gift_voucher_checks` — `id`, `visitorHash`, `outcome`, `createdAt`.

The generic received-in-advance amount is a tender line, not a table (decided at implementation, 2026-11-15, as the plan
asked for the reconciliation, the export and the ledger to read it where they already read a payment): `payment_tenders`
gains the method `'prepaid'` and the nullable columns `source`, `ref`, `label` (a rebuild of that one table, rows kept —
`changelog.d/migration--gift-vouchers-tender-method.md`); the buckets are untouched. The settlement of a stay paid with a voucher
and a card holds two lines (`Bon cadeau` and `CB`), so the reconciliation expects the card line only.

**Data impact:** none on existing records. New secret in `.env.local` (the pepper): losing it makes
every issued code unverifiable — it joins the backup of `.env.local` documented in
`specs/backup-restore.md`, and the plugin refuses to start with existing vouchers and a missing pepper
rather than drawing a new one.

## 6. UI / UX

Interactive mock-ups: `specs/gift-vouchers-resume.html`.

- **Purchase (site).** One screen: amount (large field), ideas as chips grouped by label and closed by
  « Prix indicatifs, susceptibles d'évoluer. », the three
  optional texts, e-mail, terms, « Payer 150,00 € ». A live preview of the voucher sits beside the form
  on `md+`, under it on `xs`. Errors are inline under their field; the button never disables silently.
- **Voucher page.** « Le bon est prêt », the voucher, « Télécharger le PDF », « Imprimer », one sentence
  on how to use it. Waiting and failed-payment states reuse the booking return screen's wording.
- **Code field (booking engine).** One field + « Appliquer », grouped as typed, then a line in
  the summary « Bon cadeau ····3NPC − 150,00 € », « Reste à payer », « À payer aujourd'hui ». The
  button reads « Confirmer la réservation » when nothing is due. Messages: « Le code compte 16
  caractères. », « Code mal recopié : vérifier chaque caractère. », « Code inconnu. Encore 3 essais. »,
  « Ce bon a expiré le … », « Ce bon est entièrement utilisé. », « Trop d'essais. Nouvelle saisie
  possible dans 15 minutes. ».
- **GuestFlow page.** `<PageActionBar title="Bons cadeaux" actionsBefore=[{ Nouveau bon }] />`, no
  Save/Cancel. List as a table on `md+`, stacked cards on `xs`; the detail is a side panel on `lg`, a
  full-screen dialog on `xs`. States: Valable, Entamé, Épuisé, Expiré, Annulé (`StatusBadge`).
- **Texts** are short and impersonal (no « vous », no word on the internal mechanics).
- **Responsive:** every screen at 390, 900 and 1280 px; touch targets ≥ 44 px; no horizontal scroll.
- **Motion:** press feedback on pointer-down, the summary line of an applied voucher fades in;
  `prefers-reduced-motion` removes it.

## 7. Test plan

### Server unit tests (`server/src/tests/`)
- [ ] `gift-voucher-code.unit.test.js` — rules 30, 32, 34: alphabet, length, check character catches
      every single-character substitution and adjacent swap, normalisation, no code in clear in any row,
      HMAC differs with the pepper, 10 000 draws without collision or bias beyond tolerance.
- [ ] `gift-voucher-rules.unit.test.js` — rules 6-11: bounds, expiry frozen at issue, derived states.
- [x] `gift-voucher-orders.unit.test.js` — rules 2, 13, 15-21, 23 (26 tests): validation and every refusal, proof of
      work spent once, 5 orders per hour, pay without reservation and the return path, token access and its
      one 404, issue only on a paid link, idempotent replay and refund flags, browser return alone issues
      nothing, voucher page and PDF, pending purge, receipt sent once without the code, failed send flagged
      and retried, no automatic mail for a voucher sold by hand.
- [x] `src/tests/gift-voucher-sale-link.unit.test.js` — rules 16-17 on the real core (12 tests): the link with no
      reservation, reuse and replacement, no orphan sweep, the paid effect called with `reservationId` null,
      replay and concurrent reads, a plugin off, a withdrawn link paid late, standalone sales unchanged,
      nothing in the core names the plugin.
- [ ] `gift-voucher-checks.unit.test.js` — rules 33-35: the three limits, the breaker, a mistyped code
      not counted, a cancelled code answers unknown, nothing typed is stored.
- [ ] `gift-voucher-admin.unit.test.js` — rules 24-29: manual issue, extend, cancel, adjust bounds,
      reveal audited, reception refused.
- [ ] `gift-voucher-ideas.unit.test.js` — rule 14: seasons from the quote engine, cache invalidation,
      a bare-amount idea refused by the settings.
- [ ] `gift-voucher-pdf.unit.test.js` — rule 22: one page, worst-case texts, fragment in the QR.
- [x] `src/plugins/gift-vouchers/tests/gift-voucher-redemption.unit.test.js` — rules 36-42 and every edge case of §3, on the real
      core database (19 tests): the hold is the lower of the balance and the stay, two requests for the last cents (one wins,
      the other is told the balance), code refusals, 50 € on an 80,40 € acompte (link of 30,40 €, settlement « Bon cadeau 50 € +
      CB 30,40 € »), a full-mode property, nothing due (no link, converted at once, 300 € on 268 € leaves 32 €), a voucher worth the
      acompte and part of the solde, release on delete / purge / lapse and never on a converted quote, price and tax and commission
      identical to a card-paid stay, a price change after the voucher, the fiche's payment / bounds / undo, the cancelled stay's
      re-credit (indemnity from the card first), an expired voucher refunded (+3 months), the books counting the money once.
- [x] `src/tests/prepaid-received-amount.unit.test.js` — the generic core part (13 tests): the CHECK migration keeps every row and is
      idempotent, the prepaid line is received money but never collected, the accounting export reads the collected share, sources
      held / released / reduced, `allocate`, the conversion and the fiche's record / undo with a made-up instrument.
- [x] `src/plugins/website-booking/tests/public-prepaid.unit.test.js` — the opaque `prepaid` field in the booking plugin (3 tests): read, the acompte-first amounts, the projection and the refusal. Not covered by a test: the HTTP booking request and quote carrying the field end to end (the plugin's own and the core's halves are, separately).
- [x] `src/plugins/gift-vouchers/tests/wordpress-voucher-field.unit.test.js` — the booking block's field (8 tests): check before any
      call, only a paying request carries the code, the amounts are the server's, `#bon=`, the sentences, the 1.20.0 changelog.
- [ ] Plugin isolation walk and removal matrix include `gift-vouchers`.

### Client / WordPress
- [ ] `plugins/gift-vouchers/__tests__/GiftVouchersPage.list.test.jsx`, `.actions.test.jsx`.
- [x] `plugins/gift-vouchers/__tests__/ReservationVoucherCard.stay.test.jsx` — the fiche's card (8 tests): inline refusals before any call, pay, the server's refusal, undo after a confirmation, re-credit, nothing rendered where there is nothing to show.
- [ ] E2E: buy with the sandbox provider → voucher page → code accepted at booking.

### Manual UI verification
- [ ] Buy a voucher on the site at 390 px and 1280 px; refuse each invalid amount.
- [ ] Abandon the payment; pay; reopen the voucher from the e-mail link; print the PDF.
- [ ] Five wrong codes block the field; a mistyped code does not count.
- [ ] Book with a voucher at 390 px and 1280 px: each message of the field, the summary lines, « Confirmer la réservation » when nothing is due; then the fiche shows « Bon cadeau » as its own payment line and « Payer par bon cadeau » / « Recréditer le bon » work. **Not done in this session (no browser run of the WordPress block nor of the fiche): to do before the PR.**
- [ ] Regression: a booking without a voucher is unchanged, request without paying included.

## 8. Out of scope

- Package vouchers (a named stay), a choice of visuals, scheduled delivery to the beneficiary, postal
  vouchers.
- Vouchers on platform reservations; several vouchers on one online request.
- Paying the remainder out in money; promotional codes and discounts.
- Booking the unused balance of expired vouchers as income (the operator's accountant decides; the
  page only shows it).
- The Solio header button and page (site content).

## 9. Open questions

- **Q3 — Books and VAT.** Is the sale a single-purpose voucher (VAT due at the sale) or a multi-purpose
  one (due when used)? Which account holds the outstanding balance? To be answered by the accountant
  before the first sale; rule 42 holds either way.
- **Q4 — Withdrawal right.** Does the 14-day right apply to an unused voucher bought online? The terms
  of sale must say so; rule 27 already lets the operator cancel and refund an unused voucher.

**Resolved (Adrien, 2026-11-15):**

- **Q1 — A voucher at booking is money received**, method « Bon cadeau », not a fixed discount: the
  stay keeps its price, tourist tax, average night price and cancellation indemnity (rule 39). The
  fixed-amount discount of PR C was the cheaper path and was refused for lowering the stay's price.
- **Q2 — The voucher e-mail leaves automatically** once the payment is confirmed; this template only
  (rule 23).
- **Q5 — Default validity: 18 months** (rule 7).
- **Q6 — One delivery, after PR C is merged.** Sale, delivery, management and redemption ship in a
  single PR; nothing is stacked on the PR C branch.
