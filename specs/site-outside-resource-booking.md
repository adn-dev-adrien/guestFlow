# Book a session on the website — paid online or with a gift voucher

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/outside-resource-booking-site` |
| **Created** | 2026-11-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Mock-up** | [`site-outside-resource-booking.html`](site-outside-resource-booking.html) |

---

## 1. Context

Adrien's request of 2026-11-25, after the gift vouchers went on sale (`specs/gift-voucher-campaigns.md`):

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
  (first hour / following hours, `specs/hourly-extra-hour-rates.md`). Point 5 is therefore already how the engine prices; this spec
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
2. **One scrolling form, laid out like the lodging tunnel** (`specs/wp-booking-widget-redesign.md` rules 32-33): from 900 px of block
   width, two columns with the recap as a sticky aside holding the main button; below, one column and a sticky bottom bar (amount +
   button). Order of the sections: activity → gift voucher code → session (duration, people) → date → slot → « Ajouter à la séance »
   (folded extras, campaigns rule 64) → contact → terms.
3. **Duration before slots.** The visitor sets the duration first (the resource's minimum, then whole steps of its grid, up to the
   close); the slot list shows only the starts where the whole session fits, so changing the duration reloads the slots and drops a
   chosen start that no longer fits.
4. **People, for information.** A stepper « Personnes », 1 to the resource's `sessionMaxPeople` (new, rule 25); it does not change the
   price. It is stored on the booking and shown on the outside-booking fiche, the planning card tooltip and the notification.
5. **Dates.** Month chips and a day grid bounded by the resource's booking horizon (campaigns rule 51, default 3 months); a day with
   no free start of the chosen duration is shown unavailable.
6. **Slots.** Each free start is a chip `HH:MM – HH:MM` with the amount the session would cost from it (rule 9). Taken starts are shown
   disabled with « Pris ».
7. **Contact.** First name, last name, e-mail, phone — all required — and the activity's terms checkbox (the `resource` terms,
   campaigns rule 37). Refusals are shown at their field and the first wrong field takes the focus; the server is the judge.
8. **Abuse.** The confirm call carries the proof of work and the rate limits of the lodging tunnel (`website-booking/challenge.js`).

### 3.B Price — every hour at its own band

9. **Each slice of a session is billed at the band it starts in and at its rank** (`hourlyPricing.priceSessions`): a 19:00–21:00
   session with the evening switch at 20:00 owes the day first-hour rate for 19:00–20:00 and the evening following-hour rate for
   20:00–21:00. The slot chip, the recap and the bar show that amount, and the recap names each part with its band (« 20:00 – 21:00 ·
   soirée »). A chip carries « · dont soirée » when part of it is in the evening band.
10. **With a voucher**, the voucher settles what it covers at the band it was sold for (campaigns rules 25-26, unchanged): a « 1 h
    journée » voucher placed at 19:00 for 2 hours leaves the 20:00–21:00 hour due at the evening following-hour rate; placed at 20:00
    for 1 hour it leaves the evening supplement due (campaigns rule 44). The chip then shows « Inclus dans le bon » when nothing is due,
    else « + x € » with « · soirée » when the amount comes from the evening band.
11. **Every amount comes from the server** (`POST …/quote`); the page renders it. VAT lines as in the voucher recap.

### 3.C Settlement

12. **Without a voucher the session is paid online in full** before it exists: confirm holds the slot 15 minutes
    (`resourceBookingOffer.hold`), creates a Qonto link (`payments.saleLink`, 15 min) and sends the visitor to it. Only the bank's
    paid callback books the session (`bookOutside`, channel `site`, tender `card`). There is no « request without payment ».
13. **A paid callback after the hold lapsed** books the session if the slot is still free, else records the payment as owed back
    and tells the operator (same path as the voucher remainder, campaigns rule 29).
14. **With a voucher**, the tunnel is the voucher redemption of campaigns rules 24-32: nothing due → booked at once; something due →
    the same hold + link. The voucher's own contents (included options, extra time) show as « Inclus ».
15. **The voucher code field.** « Code bon cadeau · facultatif » + « Appliquer ». A known resource voucher shows its title, number,
    sender and recipient and a « Retirer » button; an unknown code says « Ce code n'est pas reconnu. Vérifiez les caractères au dos du
    bon (0 et O, 1 et I). »; a lodging voucher says it settles a stay and links to the lodging booking page with `#bon=<code>`. A
    resource voucher for another resource selects that resource.
16. **The return page** (`?gf_session=<ref>`) polls the booking status and shows « Séance réservée », the date, the slot, the people
    and the paid recap — not a bare « Paiement reçu ».
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

### 3.E Operator notifications

22. **One push channel « Bons cadeaux et séances en ligne »** (key `online-sales`), declared by both gift-vouchers and
    hourly-resources as a *shared* channel (rule 24): one toggle in « Notifications push », listed while either plugin is live.
23. **Sent on, and only on:**
    - a voucher paid by a customer — on the website or through a payment link the team sent — when the bank confirms it
      (`orderPaid`). A voucher the team issues itself (« Offert », « Nouveau bon » without payment) sends nothing;
    - a session booked from the website, with or without a voucher (`bookOutside` with channel `site` or `mon-bain`);
    - a paid session that could not be booked (rule 13): « Paiement à rembourser ».

    Each sends a push on the channel **and** an e-mail to `notificationRecipientEmail` when it is set (the same recipient as « Nouvelle
    demande »). The e-mail does not depend on the push toggle. Texts are built from the voucher and the resource, never a literal
    activity name:
    - voucher: « Bon cadeau vendu · 70 € » / « <campaign title>, offert par <sender> à <recipient>. N° <number>, valable jusqu'au
      <date>. »
    - session: « Séance réservée en ligne · <resource name> » / « <day> · <start> – <end> · <first name> <initial>., <n> pers. ·
      <settlement> » where settlement is « 90 € payés », « bon n° 0042 » or « bon n° 0042 + 40 € payés ».
    - The push opens the outside-booking fiche (`/resource-planning?booking=…`) or the voucher (`/bons-cadeaux?voucher=…`); the e-mail
      carries the same link built on `publicUrl`.
24. **SDK: a shared push channel.** `ctx.pushChannel({ key, label, shared: true })` may be declared by several plugins when every
    declaration carries the same key and label and `shared: true`; the toggle is listed once while any declaring plugin is live. A
    non-shared key stays unique (unchanged).

### 3.F Data

25. **`resources.sessionMaxPeople`** (INTEGER, NULL): the most people in one session, set on the resource fiche next to the external
    sale fields. NULL → the stepper allows 1 to 20. To set to 8 for the bath in production.
26. **`resource_bookings.people`** (INTEGER, NULL): the people declared at booking. NULL for every existing row and for bookings made
    in GuestFlow (the operator may fill it on the fiche).
27. **`resource_bookings` channel `site`** is used for the bookings of rule 12; voucher bookings keep `mon-bain`.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| plugin | `plugins/hourly-resources/publicSessionService.js` | C | Rules 1-13, 16-17: resources on offer, slots, quote, confirm (hold + sale link), paid callback (`bookOutside` channel `site`), status for the return page, notifications |
| plugin | `plugins/hourly-resources/controllers/publicSessionController.js` | C | Parses and guards `/public/v1/sessions/*`, proof of work, rate limits |
| plugin | `plugins/hourly-resources/routes.js` | T | Mounts the public routes |
| plugin | `plugins/hourly-resources/index.js` | T | `ctx.paymentBasket({ source: 'outsideSession' })`, shared push channel `online-sales`, lapse job |
| plugin | `plugins/hourly-resources/outsideOffer.js` | T | `bookOutside` stores `people`; history line names the channel |
| plugin | `plugins/hourly-resources/migrations.js` | T | Rules 25-26 columns |
| plugin | `plugins/hourly-resources/visitModel.js` / `planningCardsModel.js` | T | `people` on the fiche payload and the card tooltip |
| plugin | `plugins/gift-vouchers/useService.js` | T | `people`, first/last name; notification on booking (rule 23) |
| plugin | `plugins/gift-vouchers/orderPaid.js` | T | Notification on a customer-paid voucher |
| plugin | `plugins/gift-vouchers/index.js` | T | Declares `online-sales` shared; `use` page link for rule 19 |
| sdk | `plugins/sdk/createContext.js` | T | `pushChannel({ shared })` (rule 24); SDK minor bump + `coreModuleHistory` if a core module is added |
| utils | `utils/pushChannels.js` | T | Lists a shared channel once |
| utils | `utils/notificationService.js` | T | `notifyOperator({ channel, title, body, url, subject, lines })`: push + e-mail, one-line sanitising as today |
| `database.js` | — | — | (none — plugin migrations) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| plugin page | hourly-resources resource fiche (external sale fields) | T | « Personnes par séance au plus » (`sessionMaxPeople`) |
| plugin page | outside-booking fiche (« Fiche passage ») | T | Shows and edits `people` |

Reused: `ExternalSaleFields`, existing fiche components. No new generic component.

### 4.3 WordPress connector (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `blocks/session-booking/{block.json,render.php,view.js}` | C | The tunnel of rules 1-17; reuses the calendar (`gf-cal-*`), summary (`gf-summary`), bar (`gf-bar`), fold (`GF.voucherExtrasFold`) and field styles |
| `blocks/gift-voucher-use/*` | T | Alias rendering the session tunnel (rule 18) |
| `blocks/gift-voucher/view.js` | T | « Vous avez reçu un bon cadeau ? » link (rule 19) |
| `assets/style.css` | T | No rotation on `.gf-gv-front` (rule 20); session tunnel styles on the existing tokens |
| `includes/class-gf-rest-proxy.php` | T | Proxies `/sessions/*` |
| `includes/class-gf-redirects.php` | T | `/utiliser` → page holding either block |
| `includes/class-gf-shortcodes.php` | T | `[guestflow_session_booking]` |

### 4.4 API contract (public, `/public/v1/sessions`)

All POST except where noted; refusals `{ code, message }` with French messages.

- `GET /resources` → `[{ id, name, blurb, fromCents, minMinutes, stepMinutes, maxPeople, horizonUntil, termsVersionId }]`
- `POST /slots { resourceId, from, to, minutes }` → `{ horizonUntil, days: [{ date, slots: [{ start, end, dueCents, evening }] }] }` (≤ 62 days)
- `POST /quote { resourceId, start: 'YYYY-MM-DDTHH:MM', minutes, addOns: [{ articleRef, qty }] }` → `{ date, start, end, parts: [{ label, band, cents }], extras[], dueCents, vat[] }`
- `POST /confirm { resourceId, start, minutes, addOns, people, firstName, lastName, email, phone, termsVersionId, returnPath }` + proof → `{ payUrl, heldUntil, dueCents }`
- `GET /status/:ref` → `{ state: 'held' | 'booked' | 'lapsed' | 'refundOwed', date, start, end, people, recap }`
- Gift-voucher `use/*` endpoints: `slots` gains `dueCents` and `evening` per slot, `confirm` gains `people`, `firstName`, `lastName`
  (`name` kept for older connectors).

Refusal codes: `RESOURCE_UNAVAILABLE`, `SLOT_TAKEN`, `BEYOND_HORIZON`, `SESSION_*` (from `quoteSession`), `PEOPLE_INVALID`,
`EMAIL_INVALID`, `PHONE_INVALID`, `NAME_REQUIRED`, `TERMS_*`, `PROOF_INVALID`, `RATE_LIMITED`.

## 5. Data model

- `resources.sessionMaxPeople INTEGER NULL` — plugin migration, NULL for every existing row.
- `resource_bookings.people INTEGER NULL` — plugin migration, NULL for every existing row.
- Payment basket source `outsideSession` (sale link `ref` = hold ref).
- No data rewritten. CHANGELOG `Migration` fragment for the two columns.

## 6. UI / UX

See the mock-up. Mobile: one column, the bar sticky at the bottom with the amount and the button (« Choisir un créneau », « Payer
x € », « Confirmer la séance »), 44 px targets, 16 px inputs, no horizontal scroll at 360 px. Desktop (≥ 900 px of block): recap aside
sticky, in-flow button hidden. Texts French, short, impersonal.

## 7. Test plan

**Server unit tests** (one file per subject):
- `hourly-resources/tests/public-session-booking.unit.test.js`: offerable resources; slots respect duration, horizon, holds; quote
  across the evening switch (19:00–21:00 = day first + evening following; 20:00–22:00 = evening first + evening following); confirm
  holds and links; paid books with channel `site`, `people`, card tender; paid after lapse → booked or refund owed; refusals.
- `gift-vouchers/tests/voucher-across-evening.unit.test.js`: a « 1 h journée » voucher at 19:00 for 2 h leaves the evening following
  hour due; at 20:00 for 1 h leaves the evening supplement.
- `tests/operator-notifications-online-sales.unit.test.js`: push on `online-sales` + e-mail for a paid voucher, none for an issued
  one, one for each site booking, texts without a literal activity.
- `tests/shared-push-channel.unit.test.js`: shared declaration listed once; mismatched label refused; non-shared still unique.

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

## 10. Implementation progress

- [ ] Server: shared push channel, `notifyOperator`, columns
- [ ] Server: public session service + routes + paid basket
- [ ] Server: voucher use additions + notifications
- [ ] Client: `sessionMaxPeople`, `people` on the fiche
- [ ] WordPress: session block, alias, purchase link, straight card, proxy, redirect
- [ ] Tests, CHANGELOG fragments, plugin/connector versions
