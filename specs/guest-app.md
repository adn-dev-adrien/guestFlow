# Guest app « Mon séjour » — booklet, gate, Soliomap and in-stay shop

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `claude/granja-estival-app-spec-77uvgj` (spec) — implementation base `inte/plugins` |
| **Created** | 2026-11-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Mock-ups** | [`specs/guest-app-maquettes.html`](guest-app-maquettes.html) |
| **Builds on** | `public-api.md`, `wordpress-plugin.md` (catalogue projections), `gate-access-sowel-connector.md` + `sowel-stays-in-keys.md` (gate keys), `mid-stay-extras-on-locked-fiche.md` + `mid-stay-extras-to-end-of-stay-complement.md` (the end-of-stay bill), `online-payments-qonto.md` + `payment-link-lifecycle.md` (card payment), `resource-hourly-scheduling.md` (nordic bath slots), `pwa-push-notifications.md` (staff push) |

> Code references below point at `origin/inte/plugins` (HEAD `71d3b314`), the branch whose public API the
> WordPress site uses today. In code and data the second lodging is **L'Estiva** (property #2) — La Granja
> is property #1.

---

## 1. Context

Guests of La Granja and L'Estiva today receive a **paper welcome booklet**, gate instructions by email
(J-7 / J-2, `{{gateAccessCode}}` / `{{gateAccessUrl}}`), and discover the estate's surroundings through
**Soliomap** — a separate web app at `soliomap.domainesolio.com` presenting things to do around the domain.

Three gaps:

1. **Nothing centralises the guest's tools.** The gate link sits in an email, Soliomap is a URL nobody
   remembers, the booklet is paper (not translated, not updatable, lost under a magazine).
2. **A guest cannot buy anything during the stay without finding the operator.** Extra nordic-bath time,
   drinks, local products, breakfast… all exist in the GuestFlow catalogue (options + resources, per-property
   prices) and the fiche already accepts mid-stay additions (`midStayExtrasWindow.js`), but only the operator
   can enter them, and they are collected at the departure SAS only.
3. **No public API reads an existing stay.** `/public/v1/**` (plugin `website-booking`) is server-to-server,
   behind a shared key held by the WordPress proxy (`requirePublicApiKey.js`); the only guest capability
   token is a devis' `publicToken`. A phone in a guest's hand cannot carry that shared key.

And on the payment side: `payment_links.type` already allows `complement` (`schema.sql:271`), but
`ensurePaymentLink` refuses it (`paymentRequestService.js:55,121`) and `applyPaidEffect` has no complement
branch (`paymentPollRunner.js:46-145`) — **paying a supplement online is not wired today**.

Competitor products (Duve, Enso Connect « Boarding Pass », Touch Stay, Guesty Guest App, Hostfully,
GetWelcom, WelloGuest) converge on the same shape: a **no-download web app** opened by link or QR, a
**personalised home** (name, dates, countdown), the **digital guidebook**, **smart-lock / gate access**
and **upsells with photos**, the upsell unlocking only for the identified stay.

## 2. Goal

A guest of La Granja or L'Estiva scans the QR code in the lodging and gets, on phone, tablet or computer, a
beautiful installable app that opens the gate, gives the welcome booklet, opens Soliomap, and lets them order
and pay — by card right away or on their end-of-stay bill — extra nordic-bath time, drinks and any other
supplement GuestFlow sells, at GuestFlow's prices. The operator edits the booklet in a dedicated web app and
is pushed every order.

## 3. Functional rules

### 3.A Identifying the lodging and the stay

1. **One QR code per lodging.** Each property has a `lodgingCode`: 128 random bits, base64url, stored on the
   property, regenerable from the booklet studio (old printed QR stops working at once). The QR encodes
   `https://<guest host>/l/<lodgingCode>`. A guessed or stale code answers like an unknown one (no oracle).
2. **Scanning opens the app at that lodging.** `POST /public/v1/guest/sessions {lodgingCode}` resolves the
   property, then its **current stay**: the non-cancelled reservation of that property whose window contains
   *now*. The window is the gate window — `startDate`+`checkInTime` − 3 h → `endDate`+`checkOutTime` + 2 h,
   Europe/Paris, same inputs and fallbacks as `utils/gateWindow.js` (one helper, not a copy).
3. **Changeover day.** If two stays' windows contain *now*, the departing stay wins until its
   `checkOutTime`, the arriving one after. With the default times (10:00 + 2 h / 16:00 − 3 h) the windows
   never overlap; the rule only matters for custom times.
4. **A session is a stay capability.** The server creates a `guest_sessions` row bound to `reservationId` +
   `propertyId`, returns it as an `HttpOnly; Secure; SameSite=Strict` cookie `gf_guest` (32 random bytes,
   only its SHA-256 stored), expiring at the window's end. The same device rescanning during the same stay
   reuses its session.
5. **No current stay → visitor mode.** The lodging's booklet and Soliomap stay readable; the home shows
   « Bienvenue à La Granja » without any personal data; the gate tile and the shop are absent. A guest who
   scanned too early (e.g. 11:00 for a 16:00 check-in) sees « Votre séjour commence aujourd'hui à 16 h —
   le portail et la boutique s'ouvriront à 13 h. » (computed server-side).
6. **Fallback, from anywhere: name + reservation number.** `/retrouver` asks the last name and the
   reservation number (`reservations.reservationNumber`, which carries the platform's number for OTA stays
   filled by the intake skills). Accepted from **J-7 00:00** until the window's end; before the window the
   session is « pré-arrivée » (booklet, Soliomap, shop catalogue read-only, no gate). One generic error for
   every failure (« Nous n'avons pas trouvé ce séjour. Vérifiez le nom et le numéro. »), 5 attempts / 15 min
   per IP, constant-time comparison.
7. **Name matching.** Normalised on both sides: NFD, accents stripped, lower-case, every non-letter removed
   (`Le Goff-Durand` = `legoffdurand`). Compared to the reservation's client `lastName`; a stay whose client
   has a second guest name on file accepts either.
8. **Data minimisation.** A session reads only: the guest's first name, lodging name, arrival / departure
   instants, party size, language, its own orders. Never the email, phone, address, amounts of the stay,
   nor any other stay. The visitor mode reads no personal data at all.
9. **Session end.** At the window's end the session is dead (401 `SESSION_EXPIRED`); the app falls back to
   the lodging's visitor mode, keeping the booklet. A cancelled or deleted reservation kills its sessions on
   the next request.

### 3.B Home

10. **Personalised home** (stay session): hero photo of the lodging, « Bonjour Marie », lodging name, a
    **stay card** with arrival / departure dates and a server-computed status line (« Arrivée aujourd'hui à
    partir de 16 h », « Jour 2 sur 4 », « Départ demain avant 10 h »), then the **quick tiles** in this order:
    Portail · Wifi · Boutique · Bain nordique · Soliomap · Livret. A tile whose feature is off for the lodging
    is not rendered (no greyed tile).
11. **Contextual highlight.** One card under the tiles, chosen by the server among: « Le portail est
    actif » (arrival day), « Prolongez votre bain nordique ce soir » (a bath slot is still free today and the
    resource is sold in the app), « Votre commande est prête » (an order marked delivered in the last hour),
    « Départ demain : les consignes » (eve of departure → booklet page *Départ*). At most one, never a
    marketing carousel.

### 3.C Gate — a door to the existing gate app

12. **The gate app already exists** (the one Sowel's key URL opens — the same link as the emails'
    `{{gateAccessUrl}}`). The guest app **does not rebuild any gate screen**: the « Portail » tile opens the
    stay's key URL (new tab / standalone window). No new gate logic: GuestFlow still never calls the house.
13. **Source and window.** The URL is read from the `gate-access` plugin (`gate_key_results` of the stay)
    and returned only for a stay session inside the gate window. Before the key exists (Sowel has not pulled
    yet) the tile reads « Accès en préparation » and is not clickable; outside the window the tile is absent.
14. **Plugin off** (`gate-access` inactive or not installed) → tile absent, endpoint 404 `PLUGIN_INACTIVE`.

### 3.D Soliomap

15. **Tile + page.** Soliomap (`soliomap.domainesolio.com`, URL stored in the studio settings) opens inside
    the app shell, in a full-height frame under the app bar, with « Ouvrir dans le navigateur » in the bar.
    The app passes `?lang=fr|en&from=guest-app&lodging=<propertySlug>` so Soliomap can centre on the domain.
    If Soliomap forbids framing (`X-Frame-Options` / `frame-ancestors`), the tile opens it in a new tab
    instead — decided once by a studio switch « Intégrer dans l'app », not detected at runtime.

### 3.E Welcome booklet

16. **Pages.** The booklet is an ordered list of pages, each with an icon, a cover photo, a title and a
    sequence of blocks. Seeded from the paper booklet (§9 Q1); expected pages: *Bienvenue*, *Arrivée*,
    *Le logement* (équipements & modes d'emploi), *Bain nordique*, *Le domaine* (règles, tri, animaux,
    calme), *Autour de nous* (→ Soliomap), *Départ*, *Urgences & contacts*.
17. **Scope.** A page is either **common** (both lodgings) or **lodging-specific**; a common page may hold
    lodging-specific blocks. The guest only ever sees their lodging's resolved booklet (server-resolved).
18. **Block types** (closed list, each with a dedicated renderer): `text` (rich text: paragraphs, bold,
    lists, links), `image`, `gallery`, `callout` (info / warning), `steps` (numbered how-to with optional
    photo per step), `wifi` (network + password + « Copier », QR to join), `contact` (name, role, phone →
    `tel:`, WhatsApp, email), `place` (address + « Itinéraire » → maps link), `faq` (accordion),
    `button` (label + internal page / shop item / external URL), `hours` (opening times table).
19. **Languages.** Every text field has FR and EN. The app language is the guest's `clients.language`
    for a stay session, else the browser's (`fr` default), switchable from the app bar. A missing EN text
    falls back to FR, flagged in the studio (« 3 textes non traduits »).
20. **Search.** A search field on the booklet index searches titles and texts of the resolved booklet
    (server-side, accent-insensitive).
21. **Offline.** The resolved booklet (texts + images at mobile size) is cached by the service worker on
    first load and readable without network (the domain has weak mobile coverage). The shop and the gate
    always require the network and say so (« Connexion nécessaire »).

### 3.F In-stay shop

22. **Everything lives in the `guest-app` plugin — the sell switch included.** Whether an option or a
    resource is sold in the app is stored in the plugin's own table (`guest_app_items`, §5), never in a core
    column. The « Vendu dans l'app » switch (and the photo / short description / `maxQuantity` fields
    beside it) is **contributed by the plugin** to the GuestFlow option and resource editors through the
    client contribution points `options.fields` (new, mirroring the existing `resources.fields` the
    `hourly-resources` plugin uses) and `resources.fields`. **While the plugin is not installed or not
    active, the switch is not rendered at all**, `/public/v1/guest/**` answers 404 `PLUGIN_INACTIVE`, and
    nothing in the core behaves differently. Deactivating keeps the plugin's rows (reactivation restores
    the catalogue as it was); uninstalling follows the usual plugin data rules.
23. **What is sold.** Options and resources **linked to the stay's lodging** (`property_options`,
    `resource_properties`) that are flagged in `guest_app_items`, not archived, and of a price type the app
    can sell by quantity:
    - options: `per_stay` (unit), `per_person` (unit = one person), `per_day_per_person` (unit = one
      person-day);
    - resources: hourly resources (`per_hour`, scheduled — the nordic bath) and quantity resources.
    Other types (`per_night`, `per_person_per_night`, `percent_of_stay`, progressive tiers, cancellation
    insurance, auto timed options such as late check-out) cannot be flagged — the switch is disabled with the
    reason. An item flagged but not linked to a lodging is simply absent from that lodging's shop.
24. **Prices come from GuestFlow, per lodging, as the site shows them.** Each item reuses the
    website-booking projections (`toPublicOption` / `toPublicResource`, `publicProjections.js`) for the
    **stay's** property: effective per-property price (`property_option_prices.price`,
    `property_resource_prices.price`), server-made `priceUnitLabel`, EN title from the translation catalogue.
    The guest-app projection adds only `imageUrl`, `shortDescription`, `maxQuantity`, `needsStaff` and the
    free / included state of rule 25. Prices are TTC. **Every amount is priced by the same core engine as
    the fiche** (`utils/pricing.js` + the `hourly-resources` price contributor): the app's quote, the order
    and the line written on the fiche can never disagree.
25. **Free in one lodging, paid in the other.** The per-lodging rules GuestFlow already holds are applied
    as they are, never re-implemented:
    - a per-property price of **0 €** → the item shows « Inclus » for that lodging (and its price elsewhere);
    - an option's **free units** (`property_option_prices.freeUnits`, own-channel bookings only — rule 53 of
      `tariff-recipes/spec.md`, `applyFreeUnitsToLine`) and a resource's **free minutes**
      (`property_resource_prices.freeMinutes`) are granted **once per stay**: the server subtracts what the
      stay already received (existing lines on the fiche, previous orders) and shows what is left
      (« 1 h offerte avec votre séjour », « 1 h offerte — déjà utilisée »);
    - an option **offered by default** to the lodging (`property_option_defaults.offered`) that the stay
      already carries is shown « Déjà inclus dans votre séjour » and not sold again;
    - an item not linked to the stay's lodging is not shown.
    An order whose quote total is **0 €** (only free / included units) needs no payment and no name: one
    button « Réserver », the order is `confirmed` and written to the fiche like a note order (rule 34).
26. **Categories.** Items are grouped by the existing option `category` (e.g. « Boissons »,
    « Restauration », « Bien-être »), in the plugin's category order; hourly resources appear in
    « Bien-être ». An empty category is not shown.
27. **When the shop is open.** Exactly when the core mid-stay extras window is open for the stay
    (`midStayExtrasWindow.js`: from `startDate` until the end-of-stay complement is collected). Pre-arrival
    and visitor sessions see the catalogue read-only with « Disponible pendant votre séjour ». After the
    complement is collected: « La boutique est fermée — bon retour ! ». Staff-prepared items also follow the
    service hours of §3.G.

#### Hourly resources — the GuestFlow resource planning is the only truth

28. **Availability is read from GuestFlow's resource planning, never from a copy.** The slot list of an
    hourly resource is computed by the `hourly-resources` plugin itself, through the same functions as the
    arrival SAS picker and the Calendrier › Ressources page:
    - occupancy = `occupancyModel.listRange` — every **guest session** of every reservation
      (`reservation_resources.sessions`), every **outside booking** (`resource_bookings`, the
      « extérieurs »), plus the slots **held** by guest-app orders awaiting payment (rule 35);
    - slots = `availability.buildDays` / `validateBlock` — slot grid (`slotDuration`), opening window
      (`openTime`/`closeTime`), open days and closed days, turnover between uses (`turnoverMinutes`),
      minimum use (`minimumUsageMinutes`), capacity (`quantity` units of the resource), the thermal model
      (`heatUpMinutes` from cold, `heatRetentionMinutes` once warm), the past (`notBefore = now`), and the
      stay's own bounds (check-in → check-out);
    - prices = `hourlyPricing.priceSessions` — day rate, evening rate after `hourlyEveningStart`, the
      lodging's price and free minutes (rule 25).
    The guest app never sees another guest's identity (the occupancy rows carry none) — it receives only
    `{ date, slots:[{ start, end, state, priceLabel }] }` with `state ∈ free | evening | taken | closed |
    heating | staff | past`.
29. **Several uses, several days.** The guest may book several slots, on several days of the stay, of one
    or more hourly resources, in one order; each slot is validated against the others of the same order
    (they occupy the resource too).
30. **Ordering writes the planning.** A committed order adds its sessions to the stay's
    `reservation_resources` line (creating the line if the stay had none, raising its sold hours otherwise),
    so the session appears at once on Calendrier › Ressources, on the day's planning card, and on the
    ignition card « Allumer le bain » of `resource-ignition-task.md` — exactly as if the operator had placed
    it from the fiche. A slot taken between the quote and the order is refused (`SLOT_TAKEN`) and the picker
    reloads.
31. **Lighting needs staff.** When a slot needs the resource heated from cold, its ignition time
    (`start − heatUpMinutes`, as the ignition card computes it) must fall inside the service hours of §3.G;
    otherwise the slot is `staff` (« Trop tôt pour préparer le bain — premier créneau possible 18 h »). A slot
    that follows a use while the resource is still warm needs no ignition and is not constrained.

#### Cart, payment, commit

32. **Cart.** Lives on the device (local UI state, persisted in `localStorage` for the session only). The
    total shown is **always** the server's answer to `POST /guest/orders/quote` — the client never adds
    prices.
33. **Two ways to pay, the guest chooses** at checkout (for a non-zero total):
    - **« Payer maintenant »** (card): the server creates the order `awaiting_payment` and a Qonto payment
      link of type `complement` for exactly its total, with the order's lines as VAT basket; the app
      redirects to Qonto; the return lands on `/commande/<id>` which polls the order status.
      **No name confirmation** — the card payment is the proof.
    - **« Ajouter à ma note »** (end-of-stay bill): **only here** the guest confirms their last name (rule 7,
      once per session — a fallback session already proved it); on success the order is `confirmed` at
      once and its lines join the stay's end-of-stay complement, collected at the departure SAS as today.
      3 wrong names lock « Ajouter à ma note » for that session for 1 h; card payment stays available.
    « Payer maintenant » is hidden while the `online-payment` plugin is inactive or Qonto is disconnected.
34. **How an order lands on the fiche.** A confirmed order (note or 0 €) or a paid order (card) is written
    by the **core** as mid-stay extras on the reservation — the same write path as the operator's `PUT
    /api/reservations/:id` on a locked fiche (rules 1 and 9 of `mid-stay-extras-on-locked-fiche.md`), in one
    transaction with the order status, with the reservation history entry « Commande app #12 ». Quantities
    add to the existing line of the same option/resource (no duplicate line). Note orders flow into
    `endOfStayComplementDetail` with `source:'midStayExtra'` exactly like an operator addition — no new
    arithmetic.
35. **Card orders** are recorded as **already paid**: the lines join the reservation, and the payment is
    recorded against the reservation's payment ledger as a `complement` payment (amount, date, Qonto
    reference), so the end-of-stay complement owes nothing for them and the accounting books the money on
    the payment date. This wires the `complement` type end to end: `ensurePaymentLink` accepts it **only**
    with an explicit guest-order basket, `applyPaidEffect` gets a `complement` branch that commits the order.
    Exempt from the arrival-day lapse (`payment-link-lifecycle.md` rule 9); its own lifetime is **30 min**.
    While `awaiting_payment` the order **holds** its hourly slots (rule 28) and its staff delivery slot.
36. **Unpaid card order.** If the link is not paid within 30 min the order goes `expired`, its holds are
    released, nothing reaches the fiche. A payment confirmed after expiry (late webhook) still commits the
    order if its slots are still free; otherwise the order goes `paid_conflict`, the operator is pushed, and
    refunds by hand (refund out of scope).
37. **Limits.** Per order: ≤ 20 lines, each quantity 1…`maxQuantity` (plugin field, default 10), total
    ≤ 500 € (plugin setting). Per session: 10 orders / hour. Out-of-range → 400 with the documented code;
    the app's steppers already respect `maxQuantity` (UX only).
38. **Order follow-up.** « Mes commandes » lists the stay's orders with status chips: *En attente de
    paiement*, *Payée*, *Sur votre note*, *Prévue {jour heure}*, *Livrée*, *Expirée*. The guest cannot cancel a
    confirmed order from the app (« Contactez-nous » → booklet contact block).

### 3.G Service hours — orders that need someone on site

39. **Staff-prepared items.** Each sold item has a plugin flag **« Préparé par l'équipe »** (`needsStaff`)
    and a **preparation lead time** (`leadMinutes`, default 30). Drinks, platters, firewood, breakfast… are
    staff-prepared; a self-service item (e.g. a code-locked product) is not. Hourly resources are governed by
    rule 31 (their ignition), not by `needsStaff`.
40. **Service hours are configured in the plugin** (Studio › Réglages › Horaires du service): for each
    weekday, zero to three time ranges (e.g. Mon–Sat 08:00–12:00 and 16:00–20:00, Sun 09:00–12:00), plus
    **exception dates** (closed day or different ranges — holidays, staff absence). The establishment
    closures of GuestFlow (`establishment_closures`, all-properties rows) close the service too. Optionally
    per lodging (both lodgings share them by default).
41. **Ordering a staff item = choosing a delivery time.** The cart asks « Quand souhaitez-vous la
    recevoir ? » with server-computed delivery slots (30-min steps) that fall inside service hours, at least
    `max(leadMinutes)` of the cart after *now*, and before the stay's check-out. The first slot is
    preselected (« Dès que possible — vers 17 h 30 »).
42. **Outside service hours the guest can still order, for later.** The shop shows a banner « Le service
    reprend demain à 8 h — vous pouvez commander dès maintenant pour plus tard » and the delivery picker
    starts at the next opening + lead time. An item whose last possible delivery is past check-out is shown
    « Plus disponible pour votre séjour ».
43. **The delivery time drives the staff.** The order carries `deliverAt`; the push of rule 44 states it;
    a planning card « Commande app » appears on the planning day of `deliverAt` (contributed by the plugin
    through `planning.days`), with the lines and a « Livrée » check.

### 3.H Staff side

44. **Push.** Every confirmed or paid order pushes the new channel **« Commandes clients »**
    (`guestOrders`, declared by the plugin with `ctx.pushChannel`) to subscribed staff: « L'Estiva · Marie —
    2 × Cidre pour 18 h, 1 h bain nordique ven. 20 h (sur la note) ». The push opens the order in GuestFlow.
45. **Orders list in GuestFlow.** A page *Commandes app* (contributed by the plugin; sidebar, under the
    day-to-day group) lists orders by delivery time, filter « À préparer / Toutes », each row: lodging, guest,
    lines, delivery time, payment mode, status, « Marquer livrée ». Bath sessions appear in the resource
    planning as any session (rule 30).
46. **The fiche** shows the order's lines as normal lines (they are), and the history entry links to the
    order.

### 3.I Booklet studio (dedicated web app)

47. **A separate web app**, « Studio du livret », served by GuestFlow at `/studio` on the admin host while
    the plugin is active, with its own lightweight layout optimised for content editing (tablet-first),
    **signed in with the GuestFlow admin account** (same session cookie as `/api`, so no second login on the
    same browser). Roles: admin only; the reception role has no access.
48. **Edits:** pages (create, reorder by drag, scope common / lodging, publish / draft, icon, cover photo),
    blocks (add from a palette, reorder, edit FR / EN side by side), photos (upload, crop to the block's
    ratio, alt text), shop presentation (per sold item: photo, short description FR/EN, `maxQuantity`,
    `needsStaff`, `leadMinutes`, category order; the price and title stay GuestFlow's — read-only here with
    « Modifier dans GuestFlow »), service hours (rule 40), app settings (app name, hero photo per lodging,
    Soliomap URL + « Intégrer dans l'app », order limits, regenerate a lodging's QR code, print the QR poster
    PDF per lodging).
49. **Live preview.** The editing screen shows a phone-frame preview of the page rendered by the real guest
    components, for the chosen lodging and language. « Publier » makes the draft the guest version; until
    then guests see the previous version.
50. **One flag, two views.** The sell switch and its fields (rule 22) are edited in the studio's shop
    screen *and* in GuestFlow's option / resource editors (plugin contribution) — same rows.

### 3.J App shell, install, look & feel

51. **One codebase, three layouts.** Mobile: bottom tab bar (Accueil · Livret · Boutique · Commandes) +
    floating cart bar. Tablet (≥ 900 px): navigation rail + two-pane booklet (index | page) and shop (catalogue
    | cart). Desktop (≥ 1200 px): same, content max 1200 px, hero wider.
52. **Installable PWA.** Manifest (name from the studio, theme fir-green), icons, standalone display,
    offline shell + booklet (rule 21). After the second visit a discreet « Installer l'app » card (Android
    `beforeinstallprompt`; iOS: a sheet with the share → « Sur l'écran d'accueil » steps). Never on first load.
53. **Look & feel** — see §6 and the mock-ups: photo-led, generous whitespace, the GuestFlow « maison »
    palette (fir green `#2F5D46`, honey `#C99038`, warm paper) and fonts (Source Serif 4 for display, Inter for
    text), soft large-radius cards, subtle motion (tile press, bottom sheets, page transitions ≤ 250 ms,
    `prefers-reduced-motion` respected), automatic dark mode for the evening, WCAG AA contrast, 44 px touch
    targets.

**Edge cases:**
- Guest scans the La Granja QR while staying at L'Estiva (wrong lodging, same estate) → the La Granja stay
  (or visitor mode) — the QR is the lodging; the fallback lookup always finds the right one.
- Two devices of the same family → two sessions on the same stay; orders and the name confirmation are per
  session, « Mes commandes » shows the stay's orders from every session.
- Reservation dates changed by the operator → the session expiry follows on the next request (re-derived).
- Option archived or unflagged while in a cart → quote returns the line `unavailable`, the cart shows it
  struck through with « Plus disponible », checkout disabled until removed.
- Price changed while in a cart → the quote is the truth; the cart re-renders the new price, no warning
  needed (the total shown before paying is always fresh).
- Qonto disconnected → « Payer maintenant » hidden, « Ajouter à ma note » only.
- Reservation from a platform with no client last name (rare iCal-only stay) → note payment impossible
  (« Ajouter à ma note » hidden), card only; fallback lookup impossible.
- Stay cancelled mid-cart → next request 401, app back to visitor mode, cart cleared.
- Operator places a bath session from the fiche while the guest looks at the picker → the guest's next
  quote / order sees it (`SLOT_TAKEN` if they picked that slot); no cache between the planning and the app.
- Operator moves or deletes a session that came from an app order → the planning is the truth; the order
  keeps its history, its status line reads « Modifiée par l'équipe ».
- Free minutes partly used by a session placed at the arrival SAS → the app offers only the remainder
  (rule 25), priced by the same engine.
- A resource linked to La Granja only → absent from L'Estiva's shop; free at La Granja (0 € or free
  minutes) and paid at L'Estiva → each lodging sees its own price.
- Service closed on an exception date for the whole stay remainder → staff items read « Plus disponible
  pour votre séjour »; self-service items and the bath (if warm or lit in hours) stay orderable.
- `hourly-resources` plugin inactive → hourly resources are absent from the shop (the guest app never
  prices hours itself); `gate-access` inactive → no gate tile; `online-payment` inactive → note only.

---

## 4. Architecture

> **Fat backend, thin frontend.** Stay resolution, windows, name matching, catalogue filtering, every price,
> every total, free units / minutes left, slot availability (from the resource planning), service-hour
> delivery slots, the payment link, the commit to the fiche and the booklet resolution (scope + language
> fallback) are server-side. The guest app and the studio render payloads and keep local UI state (cart
> lines and quantities, open sheet, current tab, editor drafts).

### 4.1 Server side (`server/src/`)

New plugin **`guest-app`** (« Application clients »), installed and activated from Paramètres ›
Intégrations like every plugin. It owns `/public/v1/guest/**`, `/api/guest-app/**`, its tables, its
settings and its client contributions. **Nothing in the core changes behaviour when it is absent.** Money
and the reservation write stay core (plugins phase 2 rule 2), reached through `sdk.coreModule`.

Dependencies: `requires: []` — the plugin degrades instead: `hourly-resources` inactive → no hourly
items; `gate-access` inactive → no gate tile; `online-payment` inactive → note only. It reaches those
plugins only through the functions they export to other plugins (no direct table reads).

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/guest-app/` | `manifest.json`, `index.js` | C | Declares the plugin, push channel `guestOrders`, settings, migrations, public + admin mounts, the expiry runner |
| `plugins/guest-app/routes/` | `public.js` | C | `/public/v1/guest/**` — thin: parse → controller → JSON |
| `plugins/guest-app/routes/` | `admin.js` | C | `/api/guest-app/**` — items, studio, service hours, orders list; admin session guard |
| `plugins/guest-app/middleware/` | `guestSession.js` | C | Reads `gf_guest`, loads the session, re-derives the window, 401 when dead |
| `plugins/guest-app/controllers/` | `sessionController.js` | C | QR resolution, fallback lookup, name confirmation, `/me` payload |
| `plugins/guest-app/controllers/` | `bookletController.js` | C | Resolved booklet + search for a session / visitor |
| `plugins/guest-app/controllers/` | `shopController.js` | C | Sellable catalogue for the stay's lodging, slots, delivery slots, quote, create order |
| `plugins/guest-app/controllers/` | `itemsController.js` | C | Read/write `guest_app_items` (the switch + fields shown in GuestFlow's editors and the studio) |
| `plugins/guest-app/controllers/` | `studioController.js` | C | CRUD pages / blocks / media / settings / service hours, publish, QR poster |
| `plugins/guest-app/controllers/` | `ordersAdminController.js` | C | Orders list, mark delivered |
| `plugins/guest-app/models/` | `sessionsModel.js`, `itemsModel.js`, `bookletModel.js`, `ordersModel.js`, `mediaModel.js`, `serviceHoursModel.js` | C | DB access (prepared statements) |
| `plugins/guest-app/` | `currentStay.js` | C | Pure: lodging + instant → current stay (rules 2, 3, 5, 6) |
| `plugins/guest-app/` | `nameMatch.js` | C | Pure: normalisation + comparison (rule 7) |
| `plugins/guest-app/` | `sellable.js` | C | Pure: which items a lodging's shop shows and their free / included state (rules 23, 25) |
| `plugins/guest-app/` | `serviceHours.js` | C | Pure: open ranges for a date, next opening, delivery slots from now + lead time to check-out, ignition-in-hours check (rules 31, 40-42) |
| `plugins/guest-app/` | `homeHighlight.js` | C | Pure: status line + the single highlight (rules 10, 11) |
| `plugins/guest-app/` | `orderExpiryRunner.js` | C | Every minute: expire unpaid orders, release holds (rule 36) |
| `plugins/guest-app/` | `planningCards.js` | C | `planning.days` server feed: « Commande app » cards on the delivery day (rule 43) |
| `plugins/guest-app/` | `migrations.js` | C | Tables of §5 |
| `plugins/website-booking/` | `publicProjections.js` | T | Export `toPublicOption` / `toPublicResource` for reuse (no behaviour change) |
| `plugins/hourly-resources/` | `index.js` | T | Export to other plugins: `slotsForStay({resourceId, reservationId, propertyId, from, to, held, notBefore})` (occupancy + `buildDays` + `priceSessions`, rule 28), `validateSessions(...)`, and a `holds` provider so held guest orders count as occupancy in **every** consumer (planning page, SAS picker, outside bookings) |
| `plugins/gate-access/` | `index.js` | T | Export `keyUrlForReservation(id, now)` (rules 12-13) |
| `utils/paymentRequestService.js` | — | T | `complement` link type with explicit basket and 30-min lifetime (rule 35) |
| `utils/paymentPollRunner.js` | — | T | `applyPaidEffect` `complement` branch → `guestOrderCommit` |
| `utils/` | `guestOrderCommit.js` | C | **Core**: commits an order's lines (options + resource sessions) as mid-stay extras, records a complement payment when paid, history entry — one transaction (rules 30, 34, 35) |
| `utils/` | `gateWindow.js` | T | Export the window as a reusable function if not already (rule 2) |
| `plugins/sdk/index.js` | — | T | Add `guestOrderCommit`, `pricing` free-units helper, `midStayExtrasWindow` to `CORE_MODULES` (one reviewed line each) |
| `middleware/` | `rateLimiters.js` | T | `guestSessionLimiter` (30/h/IP), `guestLookupLimiter` (5/15 min/IP), `guestOrderLimiter` (10/h/session) |
| `index.js` | — | T | Serve the guest app build on the guest host and the studio build at `/studio` (only while the plugin is live) |
| `database.js` | — | — | (none — no core column; everything is in plugin migrations) |

New dependency: `qrcode` (server, QR poster + wifi QR) if not already present; `pdfkit` already serves the
devis PDF.

### 4.2 Client side

Two new Vite apps in the repo, plus plugin contributions to the GuestFlow admin client.

**`guest/` — the guest PWA** (React, MUI with a dedicated theme built from GuestFlow's tokens, React Router):

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `HomePage`, `BookletIndexPage`, `BookletPage`, `ShopPage`, `SlotPickerPage`, `CartPage`, `OrderPage`, `OrdersPage`, `SoliomapPage`, `LookupPage`, `LodgingEntryPage` (`/l/:code`) | C | Route-level views |
| `components/` | `AppShell` (tab bar / rail), `HeroHeader`, `StayCard`, `QuickTile`, `HighlightCard`, `BlockRenderer` + one renderer per block type, `ProductCard`, `ProductSheet`, `QuantityStepper`, `SlotGrid`, `DeliveryTimeChips`, `ServiceHoursBanner`, `CartBar`, `PaymentChoice`, `NameConfirmDialog`, `StatusChip`, `InstallPrompt`, `OfflineBanner` | C | Rendering only |
| `services/` | `api.js` | C | `fetch` with credentials, error envelope → typed errors |
| `hooks/` | `useSession`, `useCart` (local state + localStorage), `useOrderStatus` (poll) | C | UI state |
| `i18n/` | `fr.json`, `en.json` | C | App chrome strings (booklet content comes from the server) |
| `public/` | `manifest.webmanifest`, `sw.js`, icons | C | Install + offline booklet |

**`studio/` — the booklet studio** (React, MUI using GuestFlow's `client/src/theme.js`):

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `PagesListPage`, `PageEditorPage`, `ShopItemsPage`, `ServiceHoursPage`, `MediaLibraryPage`, `AppSettingsPage` | C | Studio screens |
| `components/` | `BlockPalette`, `BlockEditor` (one per type), `BilingualField`, `PhonePreview` (imports `guest/` renderers), `ImageCropper`, `SortableList`, `WeeklyHoursEditor` | C | Editing UI |

**`client/` (GuestFlow admin) — only through the plugin's client module `client/src/plugins/guest-app/`:**

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/guest-app/` | `index.js` | C | Contributions: `options.fields`, `resources.fields`, `routes` (`/commandes-app`), sidebar entry, `planning.days` card, `settings.integrations` card |
| `plugins/guest-app/` | `GuestAppItemFields.jsx` | C | « Application clients » section of the option / resource editor (rule 22) |
| `plugins/guest-app/` | `GuestOrdersPage.jsx`, `PlanningOrderCard.jsx` | C | Orders list (rule 45) and planning card (rule 43) |
| `pages/options/` | option editor panel | T | New contribution point `options.fields`, rendered like `resources.fields` in `ResourceEditorPanel.jsx` — empty when no live plugin contributes |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `DataPageScaffold`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `FormDialog` (admin page + studio) | Studio and admin keep GuestFlow's component library. |
| **Created (new generic, guest app)** | `QuickTile`, `BottomSheet`, `QuantityStepper`, `StatusChip`, `BlockRenderer` | Generic inside the guest app; `BlockRenderer` is shared with the studio preview. |
| **Specific** | `SlotGrid`, `DeliveryTimeChips`, `PaymentChoice`, `NameConfirmDialog`, `StayCard`, `GuestAppItemFields` | Tied to the stay / order flows. |

Why not reuse `client/` for the guest app: different audience, origin, auth and bundle budget (the guest
app must load fast on 3G and be cacheable offline; the admin bundle is several MB).

### 4.3 API contract

Error envelope as `public-api.md` §4.3: `{ error: { code, message, details? } }`. All guest routes are
same-origin with the guest app (served by GuestFlow on the guest host — no CORS), cookie-authenticated,
never accept the site's shared key. Plugin inactive → every route 404 `PLUGIN_INACTIVE`.

| Method | Endpoint | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/public/v1/guest/sessions` | — | `{ lodgingCode }` | `{ mode: 'stay'\|'preArrival'\|'visitor', lodging:{id,name,slug}, opensAt? }` + cookie |
| POST | `/public/v1/guest/sessions/lookup` | — | `{ lastName, reservationNumber }` | same; 404 `STAY_NOT_FOUND` generic |
| GET | `/public/v1/guest/me` | session | — | `{ mode, guest:{firstName}, lodging, stay:{arrival,departure,partySize,statusLine}, language, nameConfirmed, tiles:[…], highlight? }` |
| POST | `/public/v1/guest/me/confirm-name` | session | `{ lastName }` | `{ nameConfirmed:true }`; 422 `NAME_MISMATCH` `{attemptsLeft}`; 423 `NAME_LOCKED` |
| GET | `/public/v1/guest/booklet?lang=` | session or `lodgingCode` | — | `{ version, pages:[{slug,icon,title,cover}] }` |
| GET | `/public/v1/guest/booklet/pages/:slug?lang=` | idem | — | `{ slug, title, cover, blocks:[{type, …}] }` |
| GET | `/public/v1/guest/booklet/search?q=&lang=` | idem | — | `{ results:[{slug,title,excerpt}] }` |
| GET | `/public/v1/guest/gate` | stay session | — | `{ state:'active'\|'preparing'\|'outside', url? }` |
| GET | `/public/v1/guest/shop` | session | — | `{ open, closedReason?, service:{openNow, nextOpening?, bannerLabel?}, canPayCard, canPayNote, categories:[{name, items:[{kind:'option'\|'resource', id, title, shortDescription, imageUrl, price, priceUnitLabel, included?, freeLeftLabel?, maxQuantity, needsStaff, scheduling?:'hourly', unavailableReason?}]}] }` |
| GET | `/public/v1/guest/shop/resources/:id/slots?from&to` | stay session | — | `{ freeMinutesLeft, freeLabel?, days:[{date,label,closed,slots:[{start,end,state,priceLabel,reasonLabel?}]}] }` |
| POST | `/public/v1/guest/shop/delivery-slots` | stay session | `{ lines }` | `{ asap:{at,label}, slots:[{at,label}], bannerLabel? }` |
| POST | `/public/v1/guest/orders/quote` | stay session | `{ lines:[{kind,id,quantity?,sessions?}], deliverAt? }` | `{ lines:[{…, unitPrice, freeUnits?, total, label, unavailable?}], total, totalLabel, needsDelivery }` |
| POST | `/public/v1/guest/orders` | stay session | `{ lines, deliverAt?, payment:'card'\|'note'\|'none', returnPath }` | card → `{ orderId, paymentUrl }`; note/none → `{ orderId, status:'confirmed' }`; 403 `NAME_REQUIRED`, 409 `SLOT_TAKEN`, 409 `DELIVERY_SLOT_GONE`, 409 `SHOP_CLOSED`, 400 `ORDER_LIMIT` |
| GET | `/public/v1/guest/orders` | stay session | — | `{ orders:[{id, createdAt, deliverAt, lines, total, payment, status, statusLabel}] }` |
| GET | `/public/v1/guest/orders/:id` | stay session | — | one order (triggers the on-demand Qonto poll like `/booking-requests/:id/status`) |
| GET | `/public/v1/guest/manifest.webmanifest` | — | — | manifest with the plugin's app name |
| GET/PUT | `/api/guest-app/items/:kind/:id` | admin | `{ sold, mediaId?, shortDescriptionFr/En, maxQuantity, needsStaff, leadMinutes }` | the row — used by the editor contribution and the studio |
| GET/PUT | `/api/guest-app/service-hours` | admin | `{ weekly:{1:[{from,to}],…}, exceptions:[{date, closed\|ranges}] }` | the config |
| GET/POST/PUT/DELETE | `/api/guest-app/studio/**` | admin | pages, blocks, media, settings, publish, `lodgings/:id/regenerate-qr`, `lodgings/:id/qr-poster.pdf` | — |
| GET | `/api/guest-app/orders?status=` | admin/staff | — | orders list (rule 45) |
| POST | `/api/guest-app/orders/:id/delivered` | admin/staff | — | `{ status:'delivered' }` |

Rate limits: sessions 30/h/IP, lookup 5/15 min/IP, confirm-name 3 failures/h/session, orders 10/h/session,
reads under the existing `publicApiLimiter` budget.

---

## 5. Data model

**No core column.** Everything below is created by the `guest-app` plugin's migrations:

- `guest_app_lodgings(propertyId PK, lodgingCode TEXT UNIQUE, heroMediaId)` — the QR code of each
  property, generated on install for every property (and for a property created later), never logged.
- `guest_app_items(kind 'option'|'resource', itemId, sold INTEGER DEFAULT 0, mediaId, shortDescriptionFr,
  shortDescriptionEn, maxQuantity DEFAULT 10, needsStaff INTEGER DEFAULT 0, leadMinutes DEFAULT 30,
  sortOrder, PRIMARY KEY(kind,itemId))` — the sell switch and its presentation (rules 22, 39). Default
  `sold = 0`: nothing is sold until the operator flags it.
- `guest_app_service_hours(weekday 0-6, fromTime, toTime, propertyId NULL)` and
  `guest_app_service_exceptions(date, propertyId NULL, closed, rangesJson)` (rule 40).
- `guest_sessions(id, tokenHash UNIQUE, propertyId, reservationId NULL, mode, origin 'qr'|'lookup',
  nameConfirmedAt, nameFailures, nameLockedUntil, createdAt, lastSeenAt, expiresAt)` — purged 30 days after
  expiry.
- `guest_booklet_pages(id, slug, icon, coverMediaId, scopePropertyId NULL, sortOrder, status
  'draft'|'published', titleFr, titleEn, updatedAt)`; `guest_booklet_blocks(id, pageId, sortOrder,
  scopePropertyId NULL, type, dataJson, updatedAt)`; `guest_booklet_versions(id, publishedAt, publishedBy,
  snapshotJson)` — « Publier » freezes the resolved structure guests read.
- `guest_media(id, path, width, height, altFr, altEn, createdAt)` — files under `server/uploads/guest-app/`,
  resized at upload (1600 / 800 / 400 px, WebP).
- `guest_orders(id, reservationId, sessionId, payment 'card'|'note'|'none', status 'awaiting_payment'|
  'confirmed'|'paid'|'delivered'|'expired'|'paid_conflict', linesJson (priced snapshot, sessions included),
  total, deliverAt NULL, heldUntil NULL, paymentLinkId NULL, createdAt, confirmedAt, deliveredAt,
  deliveredBy)` — `heldUntil` makes the hourly `holds` provider cheap to query.
- Plugin settings (`ctx.settings.declare`): app name, Soliomap URL + embed switch, max order total, guest
  host.

**Data impact:** additive only, all in plugin tables. Reservations receive lines and resource sessions only
through the existing mid-stay path. Changelog `Migration` note at implementation.

## 6. UI / UX

See **`specs/guest-app-maquettes.html`** (mobile home, booklet page, shop, bath slot picker, cart with the
payment choice and name confirmation, staff delivery time, tablet/desktop layout, studio editor, the
plugin switch in GuestFlow's option editor).

Design direction — « boarding pass » apps (Enso, Duve) meet a boutique-hotel magazine:
- **Home**: full-bleed lodging photo with a dark gradient, greeting in Source Serif 4, a frosted stay card
  overlapping the photo (dates, status line, countdown), then a 3 × 2 grid of large rounded tiles with
  duotone icons; one highlight card; booklet shortcuts as a horizontal photo strip.
- **Booklet**: index as photo cards; page = cover photo, title, blocks with generous rhythm; `steps` as a
  vertical timeline; `wifi` as a ticket-like card with copy + join QR.
- **Shop**: category chips (sticky), product cards with photo, name, price label; tap → bottom sheet with
  large photo, description, stepper, « Ajouter · 9,00 € »; floating cart bar « 3 articles · 24,00 € » above
  the tab bar.
- **Bath**: day chips, then a slot grid read from the GuestFlow planning (free / evening rate / taken /
  heating / « équipe absente »), price per slot shown by the server, free-minutes banner on top.
- **Delivery time** (staff items): horizontal time chips « Dès que possible · 17 h 30 », « 18 h », … and, out
  of service hours, a honey banner « Le service reprend demain à 8 h ».
- **Checkout**: two big choice cards — « Payer maintenant » (card icon, « Paiement sécurisé Qonto ») and
  « Ajouter à ma note » (« Réglée à votre départ ») → the latter opens the name confirmation sheet.
- **Gate**: no screen of its own — the « Portail » tile opens the existing gate app (Sowel key link).

Copy (FR, EN in `en.json`): « Bonjour {prénom} », « Votre séjour », « Ouvrir le portail », « Le livret »,
« La boutique », « Ajouter au panier », « Payer maintenant », « Ajouter à ma note », « Pour mettre cette
commande sur votre note, confirmez votre nom de famille », « Commande envoyée ! Nous la préparons. »,
« Quand souhaitez-vous la recevoir ? », « Inclus », « 1 h offerte avec votre séjour »,
« Le service reprend demain à 8 h », « Connexion nécessaire », « Nous n'avons pas trouvé ce séjour. Vérifiez le nom et le numéro. »

States: skeleton loading on every list, `EmptyState` for empty categories / no orders, offline banner,
error toasts with retry.

**Responsive:**
- `xs` (≤ 600): bottom tab bar, single column, bottom sheets for product / name / install, cart bar floating.
- `md` (~900): navigation rail left, booklet two-pane (index 320 px | page), shop two-pane (catalogue | cart
  panel always visible), sheets become centred dialogs.
- `lg` (≥ 1200): content max 1200 px centred, hero 420 px high, tiles 6 in a row.

**GuestFlow option / resource editors (plugin contribution):** while `guest-app` is active, a section
« Application clients » appears at the bottom of the editor: switch « Vendu dans l'app », and when on: photo,
short description FR/EN, « Préparé par l'équipe » + « Délai de préparation (min) », « Quantité max. par
commande ». Plugin inactive → the section does not exist.

**PageActionBar:** applies to the GuestFlow admin page *Commandes app* (title « Commandes app », action
« Actualiser » `RefreshIcon` info) and to the studio pages (editor: Save « Enregistrer le brouillon »,
Cancel, `actionsBefore` « Aperçu » and « Publier » success, `actionsAfter` « Supprimer la page » error).
The **guest app does not use `PageActionBar`**: it is not a GuestFlow back-office page, and its app bar +
tab bar is the guest-facing pattern (deliberate exception to CLAUDE.md §7, to confirm — §9 Q7).

## 7. Test plan

### Server unit tests (one file per subject)
- [ ] `plugins/guest-app/tests/guest-app-current-stay.unit.test.js` — rules 2, 3, 5, 6, 9 (window edges,
  changeover, cancelled, pre-arrival J-7)
- [ ] `…/guest-app-name-match.unit.test.js` — rule 7 (accents, hyphens, second name, empty)
- [ ] `…/guest-app-sessions.unit.test.js` — rules 1, 4, 6, 8, lookup throttling, generic errors, payload
  minimisation
- [ ] `…/guest-app-booklet.unit.test.js` — rules 17, 19, 20, draft vs published
- [ ] `…/guest-app-plugin-gating.unit.test.js` — rule 22: plugin inactive → 404 `PLUGIN_INACTIVE`, items
  rows kept, no core column touched
- [ ] `…/guest-app-sellable.unit.test.js` — rules 23, 25: per price type, archived, lodging scope, 0 € in
  one lodging and paid in the other, free units (direct only) and free minutes left after existing lines,
  offered-by-default already on the stay
- [ ] `…/guest-app-shop-quote.unit.test.js` — rules 24, 32, 37: quote equals the fiche's pricing engine for
  the same lines, limits
- [ ] `plugins/hourly-resources/tests/guest-app-slots.unit.test.js` — rules 28-31: guest sessions of other
  stays, outside bookings, held orders, turnover, capacity, heat-up / retention, closed days, evening rate,
  multi-slot order, ignition outside service hours → `staff`, warm slot not constrained
- [ ] `…/guest-app-service-hours.unit.test.js` — rules 39-42: weekly ranges, exceptions, establishment
  closures, lead time, next opening, last delivery before check-out
- [ ] `…/guest-app-order-note.unit.test.js` — rules 33-34: name only for the note, lock, 0 € order without
  name, lines + sessions land on the fiche and in `endOfStayComplementDetail`, quantities merge
- [ ] `…/guest-app-order-card.unit.test.js` — rules 35-36: complement link, paid → lines + payment, holds,
  expiry releases slots, late payment conflict
- [ ] `tests/payment-complement-link.unit.test.js` — `ensurePaymentLink` / `applyPaidEffect` complement
  branch, refusal without basket
- [ ] `…/guest-app-gate.unit.test.js` — rules 12-14, no URL outside the window
- [ ] `…/guest-app-home.unit.test.js` — rules 10-11

### Manual UI verification
- [ ] Happy path mobile (390 px): scan QR → home → order 2 drinks for 18 h + 1 h bath → note with name → push
  received → bath session visible on Calendrier › Ressources and its ignition card, order card on the
  planning → line on the fiche → collected at the departure SAS.
- [ ] Card path: Qonto sandbox payment → return page → order paid → fiche shows paid lines, end-of-stay
  complement unchanged.
- [ ] Free per lodging: same resource free at La Granja, paid at L'Estiva → each shop shows its own price;
  free hour used at the arrival SAS → app shows « déjà utilisée ».
- [ ] Out of service hours (e.g. 22:00): banner, drinks orderable for tomorrow 8 h + lead time; cold-bath
  slot whose ignition falls at night shown « équipe absente ».
- [ ] Plugin deactivated → switch gone from the option / resource editors, guest app answers « indisponible »;
  reactivated → flags back.
- [ ] Edge: wrong name × 3 → note locked, card still possible; slot taken from the fiche between quote and
  order.
- [ ] Visitor mode (no stay) and pre-arrival lookup; offline booklet in airplane mode.
- [ ] Tablet (900 px) two-pane layouts; desktop (1280 px); dark mode; EN.
- [ ] Studio: create page, add each block type, preview, publish, service hours, regenerate QR (old QR no
  longer resolves).
- [ ] Regression: website booking tunnel prices unchanged; mid-stay extras from the fiche unchanged; arrival
  SAS bath picker unchanged.

## 8. Out of scope

- Late check-out / early check-in purchase (auto timed options) — next iteration.
- Guest-side cancellation or refund of an order (operator refunds by hand).
- Guest push notifications, chat / messaging with the operator.
- Online check-in, ID upload, police forms.
- Any gate screen in the guest app — the existing gate app (Sowel key link) is opened as is; Portier
  (`feature/guest-gate-access`) is not used.
- Any change to Soliomap itself.
- Selling to people without a stay (day visitors of the nordic bath).
- Native store apps.

## 9. Open questions

- **Q1 — Booklet content.** Can you share the paper booklet (photos or PDF)? It seeds the default pages
  and blocks (rule 16).
- **Q2 — Guest host name.** `sejour.domainesolio.com`? `app.domainesolio.com`? (needs a DNS record + the
  reverse proxy route to GuestFlow).
- **Q3 — App name.** « Domaine Solio » with « Mon séjour » as subtitle? One app for both lodgings, branded
  per lodging inside (hero, name).
- **Q6 — Brand tokens.** Guest app reuses GuestFlow's « maison » palette and fonts, or Domaine Solio has its
  own charter (logo, colours, fonts) to apply?
- **Q8 — Soliomap framing.** Does `soliomap.domainesolio.com` allow being framed by the guest host
  (`frame-ancestors`)? Can it read `?lang=&lodging=`?
- **Q9 — What is sold at launch.** Which catalogue items get « Vendu dans l'app » first, and which are
  « Préparé par l'équipe » (drinks list, local products, bath extra hour, breakfast, firewood…)? And the
  service hours to start with.

### Resolved (2026-11-04)

- **Identification** — lodging QR + current stay; fallback last name + reservation number. The name is
  asked **only** when the guest puts an order on the end-of-stay bill (rules 1-9, 33).
- **Payment** — the guest chooses card (Qonto `complement` link) or end-of-stay bill (rules 33-36).
- **Hosting** — served by GuestFlow, plugin `guest-app`, `/public/v1/guest/**` with a per-stay session; the
  catalogue projections are those of the website-booking API on `inte/plugins` (rules 4, 24).
- **Gate** — the gate app already exists: the tile opens the stay's Sowel key link, no gate screen is built
  (rules 12-14). The residual risk (an old QR photo shows the tile during a later stay) is accepted: the
  link is per stay and window-bound.
- **Soliomap** — existing app at `soliomap.domainesolio.com`, opened from a tile (rule 15).
- **Booklet editing** — a dedicated web app (« Studio du livret », `/studio`, GuestFlow account) (rules
  47-50).
- **Staff notification** — admin push channel « Commandes clients » (rule 44).
- **Plugin-only** — the whole feature is a plugin; the « Vendu dans l'app » switch exists only while it is
  installed and active (rule 22).
- **Per-lodging free items and the bath planning** — prices, free units / minutes and included options are
  read per lodging from GuestFlow; hourly availability comes from the GuestFlow resource planning through
  the `hourly-resources` plugin (rules 25, 28-31).
- **Service hours** — staff-prepared items follow configurable service hours; outside them the guest orders
  for later by picking a delivery time (rules 39-43).
- **Accepted as proposed** — PageActionBar exception for the guest app (§6); 30-min card link lifetime
  (rule 35).
