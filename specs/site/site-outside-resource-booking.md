# Book a session on the website — paid online or with a gift voucher

| Field | Value |
|---|---|
| **Status** | Implemented (§3.G, the recap and the voucher prefill, added and implemented 2026-11-26) |
| **Branch** | `feature/outside-resource-booking-site` |
| **Created** | 2026-11-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Mock-up** | `site-outside-resource-booking.html` (folded into this spec, deleted 2026-11-26) · §3.G: [`docs/specs/2026-11-26-session-booking-voucher-prefill.html`](../../docs/specs/2026-11-26-session-booking-voucher-prefill.html) |

---

## 1. Context

Adrien's request of 2026-11-25, after the gift vouchers went on sale (`specs/gift-vouchers/gift-voucher-campaigns.md`):

1. The voucher card on the purchase page is tilted by 1° (`.gf-gv-front { transform: rotate(-1deg) }`). It must stand straight.
2. The redemption page « Utiliser un bon cadeau » exists (`/utiliser-un-bon-cadeau/`, block `guestflow/gift-voucher-use`), but nothing
   on the website leads to it: only the QR code and the printed link `/bon-cadeau/utiliser` do. Adrien could not find it.
3. Nobody can book the nordic bath from the website without a voucher. Adrien wants a page where an outside visitor picks a slot and
   pays, in the same tunnel as the voucher redemption, the voucher being one way to settle it (« sauf pour le bon cadeau où ils auront
   juste à entrer leur code »). That tunnel should feel like the lodging booking tunnel.
4. Nobody is told when a voucher is sold or when a session is booked from the website. The notification must be generic: no activity
   named in code, valid for any voucher kind and any resource booked outside a stay.
5. A session that spans the evening switch must bill each of its hours at its own band: a 2-hour session whose second hour is in the
   evening owes the evening rate for that hour, a voucher covering one day hour included.

What already exists (all on `master` at v4.4.0):

- `sdk.core.resourceBookingOffer()` (hourly-resources `outsideOffer.js`): `freeSlots`, `quote`, `hold`/`release`, `bookOutside`. It
  already declares a `site` channel nobody uses.
- `sessionQuote.quoteSession` / `hourlyPricing.priceSessions`: every slice is priced at the band it starts in, at the rank of its hour
  (first hour / following hours, `specs/resources/hourly-extra-hour-rates.md`). Point 5 is therefore already how the engine prices; this spec
  pins it with a rule and a test, and fixes the display that hid it (rule 9).
- `sdk.core.payments.saleLink` + `ctx.paymentBasket`: a payment link with no stay, and its paid callback.
- The gift-voucher redemption service (`gift-vouchers/useService.js`, rules 23-32 of the campaigns spec): code → slots → quote →
  confirm, with a 15-minute hold while a remainder is paid.
- Push channels declared by plugins (`ctx.pushChannel`) and the core's operator e-mail (`notificationService`, recipient
  `notificationRecipientEmail`).

## 2. Goal

One public page, « Réserver une séance », where anyone books a session of any resource sold outside a stay, and settles it by paying
online in full or with a gift voucher code — with the operator told, by push and e-mail, of every voucher sold and every session booked.

**Success criteria:**
- A visitor books a 2-hour bath on the website, pays with Qonto, and the session is on the planning with its sale paid.
- A recipient types their voucher code on the same page, the voucher settles what it covers, any remainder is paid.
- The operator's phone gets one push and the notification address one e-mail for each voucher paid by a customer and each session
  booked on the website.
- The voucher card stands straight, and the website links to the page from the purchase page, the header and the footer.

## 3. Functional rules

### 3.A The page

1. **A WordPress block « Réserver une séance »** (`guestflow/session-booking`, shortcode `[guestflow_session_booking]`) shows every
   resource that can be booked outside a stay: `sellableExternally = 1` and banded (`priceType = 'per_hour'`, planning card on), with
   a sellable external rate. With one resource, it is shown selected and nothing is asked; with several, the visitor picks one first.
   With none, the block shows a short French line (« Aucune activité à réserver en ce moment. ») — never an empty form.
2. **One scrolling form, laid out like the lodging tunnel** (`specs/site/wp-booking-widget-redesign.md` rules 32-33): from 900 px of block
   width, two columns with the recap as a sticky aside holding the main button; below, one column and a sticky bottom bar (amount +
   button). Order of the sections: activity → gift voucher code → session (duration, people) → date → slot → « Ajouter à la séance »
   (folded extras, campaigns rule 64) → contact → terms.
3. **Duration before slots.** The visitor sets the duration first (the resource's minimum, then whole steps of its grid, up to the
   close); the slot list shows only the starts where the whole session fits, so changing the duration reloads the slots and drops a
   chosen start that no longer fits.
4. **People, for information.** A stepper « Personnes », 1 to the resource's `sessionMaxPeople` (new, rule 25); it does not change the
   price. It is stored on the booking and shown on the outside-booking fiche, the planning card tooltip and the notification. A booking made with a
   voucher is bounded the same way (the resource's `sessionMaxPeople`, 20 when none is set), and refused above it.
5. **Dates.** Month chips and a day grid bounded by the resource's booking horizon (campaigns rule 51, default 3 months); a day with
   no free start of the chosen duration is shown unavailable.
6. **Slots.** Each free start is a chip `HH:MM – HH:MM` with the amount the session would cost from it (rule 9). Taken starts are shown
   disabled with « Pris ».
7. **Contact.** First name, last name, e-mail, phone — all required — and the activity's terms checkbox (the `resource` terms,
   campaigns rule 37). Refusals are shown at their field and the first wrong field takes the focus; the server is the judge.
8. **Abuse.** The confirm call carries the proof of work and the rate limits of the lodging tunnel. The proof is judged by the one guard the SDK
   exposes (`sdk.proofGuard`, the lodging request's own): signed for the visitor's address, solved at the difficulty the address owes now, and
   spent once in one memory shared by `/booking-requests`, `/gift-vouchers/*` and `/sessions/confirm`. The booking-request budget (5 an hour)
   counts the confirmations that went through: every refusal of the visitor's — a field, a taken slot, the horizon, the terms, a proof
   refused — is answered 422, as in the lodging tunnel, and gives its hit back.

### 3.B Price — every hour at its own band

9. **Each slice of a session is billed at the band it starts in and at its rank** (`hourlyPricing.priceSessions`): a 19:00–21:00
   session with the evening switch at 20:00 owes the day first-hour rate for 19:00–20:00 and the evening following-hour rate for
   20:00–21:00. The slot chip, the recap and the bar show that amount, and the recap names each part with its band (« 20:00 – 21:00 ·
   soirée »). A chip carries « · dont soirée » when part of it is in the evening band.
10. **With a voucher**, the voucher settles what it covers at the band it was sold for (campaigns rules 25-26, unchanged): a « 1 h
    journée » voucher placed at 19:00 for 2 hours (evening switch at 20:00) leaves the 20:00–21:00 hour due at the evening following-hour rate;
    on a half-hour grid, placed at 19:30 for 1 hour it leaves the evening supplement due (campaigns rule 44). A voucher offers the starts of
    its own band only: a day voucher has no start at 20:00, the evening part is due when the session runs past the switch. The chip then shows « Inclus dans le bon » when nothing is due,
    else « + x € » with « · soirée » when the amount comes from the evening band.
11. **Every amount comes from the server** (`POST …/quote`); the page renders it. VAT lines as in the voucher recap.

### 3.C Settlement

12. **Without a voucher the session is paid online in full** before it exists: confirm holds the slot 15 minutes
    (`resourceBookingOffer.hold`), creates a Qonto link (`payments.saleLink`, 15 min) and sends the visitor to it. Only the bank's
    paid callback books the session (`bookOutside`, channel `site`, tender `card`). There is no « request without payment ».
13. **A paid callback after the hold lapsed** books the session if the slot is still free, else records the payment as owed back
    and tells the operator (same path as the voucher remainder, campaigns rule 29).
14. **With a voucher**, the tunnel is the voucher redemption of campaigns rules 24-32: nothing due → booked at once; something due →
    the same hold + link. The voucher's own contents (included options, extra time) show as « Inclus ». Redeeming does not depend on the
    activity being sold online on its own: the page still draws the code field when `GET /resources` is empty (with « Aucune activité à
    réserver en ce moment. » above it), and a known resource voucher brings its activity from the `use` answer — `resource` carries its
    `stepMinutes`, `maxMinutes` and `maxPeople`, the answer its `horizonUntil` and `termsVersionId`; the browser computes none of them.
15. **The voucher code field.** « Code bon cadeau · facultatif » + « Appliquer ». A known resource voucher shows its title, number,
    sender and recipient and a « Retirer » button; an unknown code says « Ce code n'est pas reconnu. Vérifiez les caractères au dos du
    bon (0 et O, 1 et I). »; a lodging voucher says it settles a stay and links to the lodging booking page with `#bon=<code>`. A
    resource voucher for another resource selects that resource, and one for a resource not on the list opens it from its own answer.
16. **The return page** (`?gf_session=<ref>`) polls the booking status and shows « Séance réservée », the date, the slot, the people
    and the paid recap — not a bare « Paiement reçu ». The remainder of a voucher returns to `?gf_use=paid&gf_ref=<ref>` and reads the same
    answer from `GET /public/v1/gift-vouchers/use/status/:ref` (the use's unguessable reference, the recap chosen, no name, no e-mail).
17. **Confirmation e-mail to the visitor** as the voucher one (campaigns rule 31): date, slot, people, recap, terms, address.

### 3.D One page for both, old links kept

18. **The voucher redemption moves into this page.** `/<base>/utiliser` (campaigns rule 9) now leads to the page holding
    `guestflow/session-booking`, the fragment `#bon=<code>` filling the code field. The block `guestflow/gift-voucher-use` stays
    registered as an alias that renders the same tunnel, so the page already published keeps working.
19. **The purchase page links to it**: below the purchase form, « Vous avez reçu un bon cadeau ? » + link « Réserver votre séance »,
    rendered by the plugin from the page found in rule 18 (no link when no page holds the block).
20. **The voucher card stands straight** on the purchase page (amends campaigns rule 62): no rotation, the entrance keeps its fade and
    rise, none under `prefers-reduced-motion`.
21. **Site navigation (Solio, deployment step, not code):** a header menu entry « Bain nordique » and a footer link to the page, next
    to « Bon cadeau ». The header and footer template parts are not versioned: back them up before editing (as on 2026-11-24).
    > **Sans test** — a deployment step on the production site's template parts, not code.

### 3.E Operator notifications

22. **One push channel « Bons cadeaux et séances en ligne »** (key `online-sales`), declared by both gift-vouchers and
    hourly-resources as a *shared* channel (rule 24): one toggle in « Notifications push », listed while either plugin is live.
23. **Sent on, and only on:**
    - a voucher paid by a customer — on the website or through a payment link the team sent — when the bank confirms it
      (`orderPaid`). A voucher the team issues itself (« Offert », « Nouveau bon » without payment) sends nothing;
    - a session booked from the website, with or without a voucher (`bookOutside` with channel `site` or `mon-bain`);
    - a paid session that could not be booked (rule 13): « Paiement à rembourser ».

    Each sends a push on the channel **and** an e-mail to `notificationRecipientEmail` when the operator typed one (never the sender's own
    address by default, unlike « Nouvelle demande »). The e-mail does not depend on the push toggle; « Activer les notifications par email »
    (`notificationsEnabled`) is the operator's master switch for these e-mails and is honoured. A notice is sent after the booking's transaction
    has committed, never from inside it (a rolled-back booking tells nobody). Texts are built from the voucher and the resource, never a literal
    activity name:
    - voucher: « Bon cadeau vendu · 70 € » / « <campaign title>, offert par <sender> à <recipient>. N° <number>, valable jusqu'au
      <date>. »
    - session: « Séance réservée en ligne · <resource name> » / « <day> · <start> – <end> · <first name> <initial>., <n> pers. ·
      <settlement> » where settlement is « 90 € payés », « bon n° 0042 » or « bon n° 0042 + 40 € payés ».
    - The push opens the outside-booking fiche (`/passages/<booking id>`) or the voucher (`/bons-cadeaux?bon=<voucher id>`); the e-mail
      carries the same link built on `publicUrl`.
24. **SDK: a shared push channel.** `ctx.pushChannel({ key, label, shared: true })` may be declared by several plugins when every
    declaration carries the same key and label and `shared: true`; the toggle is listed once while any declaring plugin is live. A
    non-shared key stays unique (unchanged).

### 3.F Data

25. **`resources.sessionMaxPeople`** (INTEGER, NULL — a column of the core `resources` table, added in `database.js` and `schema.sql` like
    `bookingHorizonMonths`): the most people in one session, set on the resource fiche in the « Vente hors séjour » section, under the external
    sale fields, for a resource shown on the planning and sold outside a stay. NULL → the stepper allows 1 to 20. To set to 8 for the bath in production.
26. **`resource_bookings.people`** (INTEGER, NULL): the people declared at booking. NULL for every existing row and for bookings made
    in GuestFlow (the operator may fill it on the fiche).
27. **`resource_bookings` channel `site`** is used for the bookings of rule 12; voucher bookings keep `mon-bain`.

### 3.G The recap before a slot, and a voucher that fills the form (amendment 2026-11-26)

Asked by Adrien on 2026-11-26 after the page went live: the visitor read a hold notice they cannot act on, a recap that said
nothing until a slot was chosen, and had to type again what the giver already gave.

28. **No hold notice.** The line « Le créneau vous est réservé 15 minutes pendant le paiement. » under the button is removed
    (`sbHold`). The 15-minute hold of rules 12 and 14 is unchanged; only its notice goes.
29. **« Choisissez un horaire ».** While no slot is chosen, the recap's date line — which said « Le récapitulatif apparaît dès
    qu'un créneau est choisi. » (`sbSummaryEmpty`) — says « Choisissez un horaire », in the muted text colour. It turns red (the
    connector's error colour) once the visitor presses the button (in-flow or sticky bar) without a slot, and back to muted when a
    slot is chosen or the activity, duration or voucher changes. The red is announced (`role="status"` region already in place).
30. **A voucher's contents at 0 €, at once.** As soon as a resource voucher is accepted, the recap lists, before any slot, every
    line of the voucher's `contents` from `POST /gift-vouchers/use` (the session with its band, included minutes and any extra time
    given; every option and every add-on of the voucher, with its quantity), each priced « 0 € » with « inclus dans le bon » under
    it in the success colour. Once a slot is chosen, the quote's `included` lines are drawn the same way (« 0 € » + « inclus dans
    le bon », replacing the bare « Inclus »); the supplement and the extras keep their amounts. The page builds no line of its own:
    a held option or add-on missing from `contents` or from `included` is a server defect, and a server test asserts that every
    option and add-on of a voucher appears in both, with its quantity.
31. **The form filled from the voucher.** The duration and the activity follow the voucher (unchanged). The contact's first name
    and last name are filled from the recipient's first and last names stored on the voucher (rule 32), only into empty fields,
    never over what the visitor typed. Never the e-mail or the phone: the voucher holds the giver's e-mail, not the recipient's.
    The voucher holds no party size: « Personnes » is not filled. « Retirer » the voucher clears a filled name only if the visitor
    left it untouched. A voucher issued before rule 32 (no last name) fills nothing.
32. **The recipient in two fields.** Where a voucher is ordered — the site's purchase block (`guestflow/gift-voucher`, every
    campaign kind) and « Nouveau bon » in GuestFlow — « Pour » becomes « Prénom » and « Nom » of the recipient, **both required**,
    40 characters each, refused by the server when empty (`RECIPIENT_FIRST_NAME_REQUIRED`, `RECIPIENT_LAST_NAME_REQUIRED`, with
    their `field`). They are stored separately on the order (`recipientFirstName`, `recipientLastName`). **The recipient's first
    name alone** is printed on the voucher PDF, in the e-mails and in the tunnel (« Pour Marie »); GuestFlow's voucher list and
    detail show « Prénom Nom », and the list search covers both. Amends `specs/gift-vouchers/gift-voucher-campaigns.md` rules 18 and 41. The public order path still accepts the legacy single `recipientName` (taken as the first name, last name empty, optional as before) from connectors before 1.24.0, so the release stays a minor under CLAUDE.md §5.6; « Nouveau bon » and any request carrying the new fields get the two-required rule. The operator's list search also matches the full « Prénom Nom ».
33. **Data.** `gift_voucher_orders` gains `recipientFirstName` and `recipientLastName` (TEXT NOT NULL DEFAULT ''), added by a
    gift-vouchers plugin migration. Existing rows: `recipientFirstName` takes the old `recipientName`, `recipientLastName` stays
    empty — nothing lost, the printed name unchanged. `recipientName` stays readable as that first name for every reader that
    prints it (PDF, mails, notices), so no reader changes meaning. No voucher had been sold in production on 2026-11-26.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| plugin | `plugins/hourly-resources/publicSessionService.js` | C | Rules 1-13, 16-17: resources on offer, slots, quote, confirm (hold + sale link), paid callback (`bookOutside` channel `site`), status for the return page, notifications |
| plugin | `plugins/hourly-resources/publicSessionController.js` | C | Parses and guards `/public/v1/sessions/*`, the proof of work, refusals answered 422 |
| plugin | `plugins/hourly-resources/publicSessionRoutes.js` | C | Mounts `/public/v1/sessions/*` behind the public guard; the confirmation has the booking-request limiter, the status read the payment-status limiter |
| plugin | `plugins/hourly-resources/sessionOrdersModel.js` / `sessionNotices.js` / `sessionMail.js` / `sessionProof.js` | C | The orders awaiting payment (`resource_session_orders`), the operator's push/e-mail texts, the visitor's confirmation mail, the proof-of-work check |
| plugin | `plugins/hourly-resources/routes.js` / `controller.js` / `bookingsModel.js` | T | `PATCH /api/resource-bookings/:id/people` (rule 26), moving no price |
| plugin | `plugins/hourly-resources/index.js` | T | `ctx.paymentBasket({ source: 'outsideSession' })`, shared push channel `online-sales`, lapse job |
| plugin | `plugins/hourly-resources/outsideOffer.js` | T | `bookOutside` stores `people`; history line names the channel |
| plugin | `plugins/hourly-resources/ficheModel.js` | T | `people` on the fiche payload (the planning tooltip reads the booking rows, which carry it) |
| utils | `utils/proofOfWorkGuard.js` / `proofOfWorkStore.js` | C | The one proof-of-work judgment and its memory (spent challenges, request log), shared by every public form; `sdk.proofGuard` (SDK 2.35.0) |
| plugin | `plugins/hourly-resources/outsideOffer.js` | T | `limits({ resourceId })`; `bookOutside` returns `announce()` when called inside a transaction (SDK 2.35.0) |
| plugin | `plugins/gift-vouchers/useService.js` | T | `people`, first/last name, `dueCents` and `evening` per slot (the session is announced by the plugin that books it); « Paiement à rembourser » on a remainder it cannot honour |
| plugin | `plugins/gift-vouchers/voucherNotices.js` / `orderPaid.js` | C / T | The texts of a voucher sold; the notification on a customer-paid voucher |
| plugin | `plugins/gift-vouchers/index.js` / `migrations.js` / `models/usesModel.js` | T | Declares `online-sales` shared and the notifier; `gift_voucher_uses.people`; migration `gift_voucher_recipient_names_v4` (rule 33) |
| plugin | `plugins/gift-vouchers/offerService.js` | T | `partiesOf`: both recipient names required, 40 characters, `RECIPIENT_*_REQUIRED` with their `field`; stores `recipientFirstName`, `recipientLastName` and `recipientName` = first name (rules 32-33) |
| plugin | `plugins/gift-vouchers/models/ordersModel.js` / `vouchersModel.js` | T | Write and read the two names |
| plugin | `plugins/gift-vouchers/useService.js` | T | `open` answers `recipientFirstName`, `recipientLastName` (and `recipientName`, the first name); `contents` and the quote's `included` list every option and add-on held, with its quantity (rule 30) |
| plugin | `plugins/gift-vouchers/controllers/adminController.js` / `publicOrdersController.js` | T | Refusals with their `field`; the list and detail carry both names and `recipientLabel` (« Prénom Nom »), the search reads both |
| sdk | `plugins/sdk/createContext.js` | T | `pushChannel({ shared })` (rule 24); SDK 2.35.0 (`version.js`, `coreModules.json`, `coreModuleHistory.json`: `notificationService.notifyOperator`) |
| utils | `utils/pushChannels.js` | T | Lists a shared channel once |
| utils | `utils/notificationService.js` | T | `notifyOperator({ channel, title, body, url, subject, lines })`: push + e-mail, one-line sanitising as today |
| `database.js` / `schema.sql` / `models/resourcesModel.js` / `controllers/resourcesController.js` | T | `resources.sessionMaxPeople` (rule 25), validated 1-100 on its own field |
| plugin migrations | `hourly-resources/migrations.js` | T | `resource_bookings.people` (rule 26), `resource_session_orders` |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| page | `pages/options/ResourceEditorPanel.jsx` / `resourceForm.js` | T | « Personnes par séance au plus » (`sessionMaxPeople`) under the external-sale fields, for a resource shown on the planning and sold outside a stay |
| plugin page | `hourly-resources/OutsideBookingPage.jsx` (« Passage ») | T | Shows `people` in the session block and corrects it in place |
| plugin page | `hourly-resources/ResourcePlanningPage.jsx` | T | The booking tooltip names the people |
| plugin page | `gift-vouchers/NewVoucherPage.jsx`, `giftVoucherTexts.js` | T | « Pour » becomes « Prénom » and « Nom », required, each refusal on its field (rule 32) |
| plugin page | `gift-vouchers/GiftVouchersPage.jsx`, `GiftVoucherDetail.jsx` | T | Show the server's `recipientLabel` |

Reused: `ExternalSaleFields`, existing fiche components. No new generic component.

### 4.3 WordPress connector (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `blocks/session-booking/{block.json,render.php,view.js}` | C | The tunnel of rules 1-17; reuses the calendar (`gf-cal-*`), summary (`gf-summary`), bar (`gf-bar`), fold (`GF.voucherExtrasFold`) and field styles; rules 28-31: no hold notice, « Choisissez un horaire », the voucher's lines at « 0 € · inclus dans le bon », the names prefilled |
| `blocks/gift-voucher-use/*` | T | Alias rendering the session tunnel (rule 18); its own `view.js` is removed, the alias runs the session block's script |
| `blocks/gift-voucher/view.js` | T | « Vous avez reçu un bon cadeau ? » link (rule 19), from the runtime's `sessionPageUrl`; « Prénom » / « Nom » of the recipient, both required, the card preview naming the first name only (rule 32) |
| `assets/voucher-parts.js` | T | `voucherExtrasFold` takes a `title` and a `foot` |
| `includes/class-gf-blocks.php` / `class-gf-settings.php` | T | The block, its French strings, `sessionPageUrl`; the page holding either block is « the use page »; connector 1.24.0 (`sbHold` and `sbIncludedShort` removed, `sbIncludedIn`, `gvFirstName`, `gvLastName` added) |
| `assets/style.css` | T | No rotation on `.gf-gv-front` (rule 20); session tunnel styles on the existing tokens |
| `includes/class-gf-rest-proxy.php` | T | Proxies `/sessions/*`; forwards `recipientFirstName` and `recipientLastName` of an order |
| `includes/class-gf-redirects.php` | T | `/utiliser` → page holding either block |
| `includes/class-gf-shortcodes.php` | T | `[guestflow_session_booking]` |

### 4.4 API contract (public, `/public/v1/sessions`)

All POST except where noted; refusals `{ code, message }` with French messages.

- `GET /resources` → `[{ id, name, blurb, fromCents, minMinutes, stepMinutes, maxMinutes, maxPeople, horizonUntil, termsVersionId, addOns: [{ articleRef, label, maxQty, unitLabel, linear, prices: [{ qty, cents }] }] }]`
- `POST /slots { resourceId, from, to, minutes }` → `{ horizonUntil, days: [{ date, slots: [{ start, end, dueCents, evening } | { start, end, taken: true }] }] }` (≤ 62 days; only the days with a free start)
- `POST /quote { resourceId, start: 'YYYY-MM-DDTHH:MM', minutes, addOns: [{ articleRef, qty }] }` → `{ date, start, end, parts: [{ label, band, cents }], extras[], dueCents, vat[] }`
- `POST /confirm { resourceId, start, minutes, addOns, people, firstName, lastName, email, phone, termsVersionId, returnPath }` + proof → `{ payUrl, heldUntil, dueCents }`
- `GET /gift-vouchers/use/status/:ref` → the same shape for the remainder of a voucher (`recap` = the chosen recap: included, supplement, extras, dueCents, vat); `use` answers `resource: { id, name, band, minutes, stepMinutes, maxMinutes, maxPeople }`
- `GET /status/:ref` → `{ state: 'held' | 'booked' | 'lapsed' | 'refundOwed', resourceName, date, start, end, people, recap }` (`ref` is the 32-hex token of the order, also the sale link's `ref`)
- `PATCH /api/resource-bookings/:id/people { people }` (admin) → `{ ok, people }`
- Gift-voucher `use/*` endpoints: `slots` gains `dueCents` and `evening` per slot, `confirm` gains `people`, `firstName`, `lastName`
  (`name` kept for older connectors).
- §3.G: `POST /gift-vouchers/use` also answers `recipientFirstName` and `recipientLastName` (`recipientName` stays the first name);
  `POST /gift-vouchers/orders` and `POST /api/gift-vouchers` take `recipientFirstName` and `recipientLastName` in place of `recipientName`, both required (the public orders endpoint still accepts the legacy `recipientName` alone, as the first name, from connectors ≤ 1.23.0)
  (`RECIPIENT_FIRST_NAME_REQUIRED`, `RECIPIENT_LAST_NAME_REQUIRED`, with `field` in the public `details` and in the admin body); the admin list items and the detail carry
  both names and `recipientLabel`.

Refusal codes: `RESOURCE_UNAVAILABLE`, `SLOT_TAKEN`, `BEYOND_HORIZON`, `SESSION_*` (from `quoteSession`), `PEOPLE_INVALID`,
`EMAIL_INVALID`, `PHONE_INVALID`, `NAME_REQUIRED`, `TERMS_*`, `PROOF_INVALID`, `RATE_LIMITED`; voucher orders: `RECIPIENT_FIRST_NAME_REQUIRED`, `RECIPIENT_LAST_NAME_REQUIRED`.

## 5. Data model

- `resources.sessionMaxPeople INTEGER NULL` — core `database.js` migration and `schema.sql`, NULL for every existing row.
- `resource_bookings.people INTEGER NULL` — plugin migration, NULL for every existing row.
- `resource_session_orders` — plugin migration, starts empty: the sessions ordered on the website and their 15 minutes (`held` / `booked` / `lapsed` / `refund_owed`), keyed by an unguessable `ref`.
- `gift_voucher_uses.people INTEGER NULL`, `.ref TEXT` (unique, random) and `.recap TEXT` — plugin migrations, NULL for every existing use.
- `gift_voucher_orders.recipientFirstName`, `.recipientLastName` TEXT NOT NULL DEFAULT '' — plugin migration `gift_voucher_recipient_names_v4` (rule 33): each existing order takes its `recipientName` as first name, last name empty.
- Payment basket source `outsideSession` (sale link `ref` = the order's `ref`; the slot hold is `site-session:<ref>`).
- No data rewritten except the first-name copy of rule 33. CHANGELOG `Migration` fragments for the columns and the table.

## 6. UI / UX

See the mock-up. Mobile: one column, the bar sticky at the bottom with the amount and the button (« Choisir un créneau », « Payer
x € », « Confirmer la séance »), 44 px targets, 16 px inputs, no horizontal scroll at 360 px. Desktop (≥ 900 px of block): recap aside
sticky, in-flow button hidden. Texts French, short, impersonal.

## 7. Test plan

**Implemented 2026-11-25** — server: the 4 suites below plus `resource-session-max-people.unit.test.js`; client: 7 new files
(`wordpress-session-booking{,.voucher,.return,.site}.test.js`, `resourceForm.session-max-people.test.js`, `OutsideBookingPage.people.test.jsx`,
`ResourcePlanningPage.people.test.jsx`); the two suites of the former use block were replaced by the first four.

**Server unit tests** (one file per subject):
- `hourly-resources/tests/public-session-booking.unit.test.js`: offerable resources; slots respect duration, horizon, holds; quote
  across the evening switch (19:00–21:00 = day first + evening following; 20:00–22:00 = evening first + evening following); confirm
  holds and links; paid books with channel `site`, `people`, card tender; paid after lapse → booked or refund owed; refusals.
- `gift-vouchers/tests/voucher-across-evening.unit.test.js`: a « 1 h journée » voucher at 19:00 for 2 h (switch at 20:00) leaves the evening
  following hour due; at 19:30 for 1 h on a half-hour grid leaves the evening supplement; a day voucher has no start at 20:00.
- `gift-vouchers/tests/voucher-use-return.unit.test.js`, `voucher-proof-guard.unit.test.js`: the opening answer's limits, the party bound,
  the return page of a remainder by reference, announcements after commit; one challenge spent once across the forms, `tooEasy`.
- `tests/operator-notifications-online-sales.unit.test.js`: push on `online-sales` + e-mail for a paid voucher, none for an issued
  one, one for each site booking, texts without a literal activity.
- `tests/shared-push-channel.unit.test.js`: shared declaration listed once; mismatched label refused; non-shared still unique.

**§3.G, implemented 2026-11-26** — server: `gift-vouchers/tests/gift-voucher-recipient-names.unit.test.js` (6: both names required with their field, 40 characters,
trimming, storage with `recipientName` = first name, `open` payload, the backfill migration and its idempotence, « Nouveau bon » refusals, list search and detail) and
`gift-voucher-use-contents-complete.unit.test.js` (2: every option and add-on held, with its quantity, in `contents` and in the quote's `included`); the
existing voucher suites were moved to the two-field body. Client: `wordpress-session-booking.voucher-prefill.test.js` (10: no hold notice, « Choisissez un horaire »
muted / red / muted again, the voucher's lines at 0 € before and after a slot, the prefill rules), `wordpress-gift-voucher.recipient-names.test.js` (4),
`NewVoucherPage.recipient-names.test.jsx` (3).

**WordPress:** PHP lint; block JS checked in the browser on a dev site.

**Manual (browser, dev copy):** book a 2-hour session 19:00–21:00 and check the recap parts; pay through the Qonto sandbox and land on
the return page; apply a voucher at 19:00 for 2 h; an unknown code; a lodging code; refusals on empty contact; mobile 390 px with the
sticky bar; the purchase page card straight with its link; push + e-mail received.

**E2E:** one Playwright journey on the public API (book without voucher up to the payment link, voucher booked with nothing due).

## 8. Out of scope

- A session requested without payment; several sessions in one order; per-person pricing; a customer account, online change or
  cancellation (the team cancels, campaigns rule 54).
- Turning the e-mail off separately from the push toggle.
- Selling options alone (without a session) on this page.

## 9. Open questions

_Resolved 2026-11-25 (Adrien, mock-up §4 + chat):_ the e-mail is always sent when the recipient is set (the toggle governs the push only) · one page with a code field · people asked for information, max from the resource · paid
in full online · one push line « Bons cadeaux et séances en ligne » covering vouchers sold and every site session · header « Bain
nordique » + footer + purchase-page links · notify only customer-paid vouchers · push **and** e-mail · each hour of a session billed
at its band, the evening part due even with a day voucher.

_Resolved 2026-11-26 (Adrien, chat):_ « Choisissez un horaire » muted then red on a press without a slot · voucher lines « 0 € » +
« inclus dans le bon » · recipient first and last names entered separately at purchase, both required, stored in GuestFlow,
used to fill the booking · the printed voucher, e-mails and tunnel name the recipient by first name only.

## 10. Implementation progress

- [x] Server: shared push channel, `notifyOperator`, columns
- [x] Server: public session service + routes + paid basket
- [x] Server: voucher use additions + notifications
- [x] Client: `sessionMaxPeople`, `people` on the fiche
- [x] WordPress: session block, alias, purchase link, straight card, proxy, redirect
- [x] Tests, CHANGELOG fragments, plugin/connector versions
- [x] §3.G (2026-11-26): recap before a slot, voucher lines at 0 €, names prefilled, recipient in two fields — connector 1.24.0, gift-vouchers 1.7.0

Deviations from the first draft, all written above: the notification links open `/passages/<id>` and `/bons-cadeaux?bon=<id>` (the pages that exist);
`sessionMaxPeople` is a core column; the people are corrected through their own `PATCH` so no price moves; a settled voucher is named from its tender's label
(« bon cadeau n° BC-2026-0042 »).
