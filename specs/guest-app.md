# Guest app « Mon séjour » — booklet, gate, Soliomap and in-stay shop

| Field | Value |
|---|---|
| **Status** | Implemented (2026-11-09) — approved 2026-11-04 |
| **Branch** | `claude/granja-estival-app-spec-77uvgj` (spec) — implementation base `inte/plugins` |
| **Created** | 2026-11-04 |
| **Author** | Adrien |
| **Related PR** | (slice A: link once opened) |
| **Mock-ups** | [`specs/guest-app-maquettes.html`](guest-app-maquettes.html) |
| **Review boards** | [`specs/guest-app-planches.html`](guest-app-planches.html) — v5 (2026-11-06): stock per article, delivered or picked up, studio read from GuestFlow, tablet / desktop — validated 2026-11-08, slices F-G unblocked |
| **Plan** | [`specs/guest-app-plan.md`](guest-app-plan.md) |
| **Amendment** | 2026-11-10 « Mon séjour dès le J-7 » (rules 65-89, readings of rules 2, 9bis, 11bis, 27, 33, 34, 37ter, 38, 41, 44, 45; rules 66, 67, 69, 70, 71, 72, 76 amended the same day by Adrien's second to fifth messages: shop times, the nordic bath, the e-mail wording, the SAS list and its edits, card from J-7) — **Draft**, summary [`specs/guest-app-j7-resume.html`](guest-app-j7-resume.html), branch `feature/guest-app-from-j7` |
| **Builds on** | `public-api.md`, `wordpress-plugin.md` (catalogue projections), `gate-access-sowel-connector.md` + `sowel-stays-in-keys.md` (gate keys), `mid-stay-extras-on-locked-fiche.md` + `mid-stay-extras-to-end-of-stay-complement.md` (the end-of-stay bill), `online-payments-qonto.md` + `payment-link-lifecycle.md` (card payment), `resource-hourly-scheduling.md` (nordic bath slots), `pwa-push-notifications.md` (staff push) |

> Code references below point at `origin/inte/plugins` (HEAD `71d3b314`), the branch whose public API the
> WordPress site uses today. In code and data the second lodging is **L'Estiva** (property #2) — La Granja
> is property #1.

---

## 1. Context

Guests of La Granja and L'Estiva today receive a **paper welcome booklet**, gate instructions by email
(J-7 / J-2, `{{gateAccessCode}}` / `{{gateAccessUrl}}`), and discover the estate's surroundings through
**Soliomap** — a separate web app at `map.domainesolio.com` presenting things to do around the domain.

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

### 3.A Opening the app — one link per stay (Q10, option A, decided 2026-11-06)

1. **One link per stay.** Each reservation gets a `stayToken`: 128 random bits, base64url, created the first time
   it is needed (the SAS step, the J-7 e-mail, the fiche), stored **encrypted** in `guest_stay_links` (it must be
   shown again at the SAS, in the e-mails and after a regeneration) with its SHA-256 for lookup. The link is
   `https://<guest host>/s/<stayToken>`. « Régénérer le lien » (SAS step and fiche) replaces it: the old link and
   every session opened from it die at once. A guessed, stale or revoked token answers like an unknown one (no
   oracle); the app shows one copy for every unknown code: « Ce code n'est pas reconnu. »
2. **What the link opens, and when.** `POST /public/v1/guest/sessions { stayToken }` resolves the reservation
   (non-cancelled, its lodging enabled for the app, rule 11quater) and opens, depending on *now* against the
   stay window — `startDate`+`checkInTime` − 3 h → `endDate`+`checkOutTime` + 2 h, Europe/Paris, the gate key's
   window (`utils/stayWindow.js`, shared with `gate-access`):
   - from J-7 00:00 until the window opens → a **pre-arrival** session (booklet, Soliomap, the shop read-only, no
     gate, no order); **Amended 2026-11-10:** the shop, its orders and « Mes commandes » are open to it, still no gate
     (rules 65-69);
   - inside the window → a **stay** session (everything the lodging's modules allow);
   - before J-7 → the lodging's visitor mode; after the window → the lodging's visitor mode with « Votre séjour est
     terminé. Le livret reste disponible. ».
   The link proves the stay: **no name is ever asked** (not for the bill either, rule 33). Whoever holds the link —
   the guests it was shared with, by design — acts for that stay; a link that leaks is the operator's to
   regenerate (accepted risk, stated).
3. **The lodging poster opens the visitor mode only.** Each enabled lodging keeps a `lodgingCode` (128 bits,
   base64url, regenerable from the studio) printed as a QR in the lodging: `https://<guest host>/l/<lodgingCode>`
   opens that lodging's **visitor** mode, never a stay — so a photo of the poster shows nothing of anyone's stay,
   at any time. The visitor home offers « Vous séjournez ici ? Retrouver mon séjour » (rule 6).
4. **A session is a stay capability.** Opening the link creates a `guest_sessions` row bound to `reservationId` +
   `propertyId` (+ the link's id), returned as an `HttpOnly; SameSite=Strict` cookie `gf_guest` — `Secure` exactly when the core's own session cookie is
   (`HTTPS_ENABLED`; over plain HTTP a browser drops a Secure cookie, review of 2026-11-09) — scoped to
   `/public/v1/guest` (32 random bytes, only its SHA-256 stored), expiring at the window's end (pre-arrival: when
   the window opens). The app keeps the stay link on the device and exchanges it again when a session ends, so a
   pre-arrival session becomes a stay session by itself at H-3. The same device reopening the link during the same
   phase reuses its session; two devices have two sessions on the same stay.
5. **Visitor mode.** The lodging's booklet, Soliomap and the wifi; « Bienvenue à La Granja » without any personal
   data; no gate, no shop, no orders. A visitor session (`reservationId` NULL) lasts 24 h.
6. **Fallback, from anywhere: name + reservation number — a platform's number only.** `/retrouver` asks the last name
   and the reservation number (`reservations.reservationNumber`, which carries the platform's number for OTA stays
   filled by the intake skills) and opens the same session as the stay link would (pre-arrival or stay), from **J-7
   00:00** until the window's end. One generic error for every failure (« Nous n'avons pas trouvé ce séjour. Vérifiez
   le nom et le numéro. »), 5 attempts / 15 min per IP, constant-time comparison. Two live stays sharing a number are
   each tried against the name (review of 2026-11-09). **Amended 2026-11-10 (D28, audit R36 A36-1):** the rule assumed
   every number was a platform's; a direct stay's is the core's sequential `AAAAMM###`, so a surname walked through a
   month of them and held the gate key and the note. The lookup never opens a stay whose number the core made — rule
   54; the stay link stays the capability of direct guests.
7. **Name matching** (the fallback only). Normalised on both sides: NFD, accents stripped, lower-case, every
   non-letter removed (`Le Goff-Durand` = `legoffdurand`). Compared to the reservation's client `lastName`.
8. **Data minimisation.** A session reads only: the guest's first name, lodging name, arrival / departure
   instants, party size, language, its own stay's orders. Never the email, phone, address, amounts of the stay,
   nor any other stay. The visitor mode reads no personal data at all.
9. **Session end.** At its expiry the session is dead (401 `SESSION_EXPIRED`); the app reopens the stored link,
   or falls back to the lodging's visitor mode, keeping the booklet. A cancelled or deleted reservation, a
   regenerated link and a lodging switched off kill their sessions on the next request. After any such
   re-exchange the app reads `/me` and `/lodging` again, so the screen shows the session it now holds (visitor
   mode, or « Ce code n'est pas reconnu » when nothing on the device reopens one); a re-exchange that fails for
   the network alone keeps the session on screen and the link on the device (review 2026-11-09). The link of
   `/s/:token` is kept on the device **before** its exchange and forgotten only on `CODE_NOT_FOUND`: opened
   without network, the page stays, says « Pas de réseau » and « Réessayer » runs the exchange again.
9bis. **Where the link is given.** (a) The arrival SAS: while `guest-app` is active and the lodging enabled, its
   « Portail » step becomes « Mon séjour » — the QR of the stay link (« Flashez pour ouvrir Mon séjour : le portail,
   le livret, la boutique et le bain »), the gate keypad code, « Partager » (native share sheet, else « Copier le
   lien »), « Régénérer le lien », and a discreet « QR du portail seul » that shows today's gate QR for weak
   coverage. Plugin inactive, lodging disabled → the step is today's gate step, unchanged (contribution through
   the existing `sas.portal` slot, rule 22). (b) The J-7 and J-1 reminder e-mails: the plugin declares its own
   variable `{{stayAppUrl}}` « Lien Mon séjour » and the condition `hasStayApp` (offered in the J-7 and J-2 e-mails
   only), like `gate-access` declares the gate's: the stay link, else the gate key's link (lodging disabled, no
   e-mail address), `hasStayApp` true only for the app's own link. It is not a core variable (Adrien, 2026-11-09:
   the core keeps only generic extension points): while the plugin is inactive both are empty, so a template
   writes the app's sentence under `{{#if hasStayApp}}` and keeps its gate paragraph under `{{#if hasGateAccess}}`.
   **Amended 2026-11-10:** the J-7 carries the app's paragraph too, and the flags gain `hasStayAppShop` (rule 70). (c) The fiche: « Lien Mon séjour »
   (copy, regenerate) contributed to the reservation page.

### 3.B Home

10. **Personalised home** (stay session): hero photo of the lodging, « Bonjour Marie », lodging name, a
    **stay card** with arrival / departure dates and a server-computed status line (« Arrivée aujourd'hui à
    partir de 16 h », « Jour 2 sur 4 », « Départ demain avant 10 h »), then the **quick tiles** of the
    lodging's modules (rule 11bis), in the order configured for that lodging (default: Portail · Wifi ·
    Boutique · Bain nordique · Soliomap · Livret). A module that is off for the lodging is not rendered (no
    greyed tile).
11. **Contextual highlight.** One card under the tiles, chosen by the server among: « Le portail est
    actif » (arrival day), « Un bain nordique ce soir ? » (« aujourd'hui » when the first bookable slot starts before 18 h) + the
    first bookable hour as the card's line « Premier créneau libre à 20 h » (a slot in state `free` or `evening` remains today on an hourly resource sold in the app while the shop is open, read from the resource planning like the slot picker), « Votre commande est prête » (an order marked delivered in the last hour),
    « Départ demain : les consignes » (eve of departure → booklet page *Départ*). At most one highlight, plus at most one suggestion (rule 15bis), never a marketing carousel. A highlight is only chosen among the lodging's enabled modules. Priority: the order,
    the gate, the departure, the bath: a bath slot is free on nearly every evening, so ahead of the departure
    it would keep the instructions from ever showing.

#### Per-lodging configuration — each lodging decides what its guests see

11bis. **Modules per lodging.** Each lodging has its own list of modules, each **on / off** and ordered:
    `gate` (Portail), `wifi`, `shop` (Boutique), `bath` (Bain nordique shortcut), `soliomap` (tile « Activités »,
    Adrien 2026-11-06), `booklet`
    (Livret), `orders` (Mes commandes), `contacts` (Urgences & contacts shortcut). The server resolves them:
    a module is shown only if it is **on for the lodging** *and* its prerequisite holds (gate → `gate-access` active and the stay inside the gate window — before Sowel's key exists the tile reads « Accès en préparation », rule 13; shop → at least one item sold for this lodging; bath → an hourly resource
    sold for this lodging; wifi → wifi configured for this lodging, rule 11ter; soliomap → its URL set;
    contacts → at least one contact). The `bath` module is a shortcut tile only: the slot list, the quote and the orders belong to `shop`; `shop` off hides the bath tile too. A visitor has no `gate`, `shop`, `bath` or `orders`; a pre-arrival session
    keeps `shop` but has no `gate`, `bath` or `orders` (rules 5, 6) — **amended 2026-11-10:** a pre-arrival session
    keeps `shop`, `bath` and `orders`, and has no `gate` (rule 65). By default the six modules of rule 10 and
    `orders` are on, `contacts` off; `orders` feeds the tab of rule 51 and the home's « Commandes en cours » row,
    never a tile, so the home keeps rule 10's six. Every endpoint of an
    **off** module answers 404 `MODULE_OFF` for that lodging's sessions — hiding is enforced server-side,
    not only in the UI. The app's tab bar / rail follows the same list (no « Boutique » tab in a lodging
    without shop).
11ter. **Lodging facts** live per lodging, not in the booklet text: **wifi** (« Wifi disponible » on/off,
    network name, password, optional « Wifi seulement dans la pièce principale » note — off → no wifi tile,
    no wifi block, and the booklet may show the lodging's « Pas de wifi » message, prefilled from the
    existing stay text `noWifi` of `stayTextCatalogue.js`), **hero photo** (default: the hero of domainesolio.com's
    home page, the aerial view of the estate), **check-in /
    check-out wording**, **emergency contacts**. The `wifi` and `contact` booklet blocks read these facts
    (one place to change a password, both the tile and the booklet follow). The lodging's **name** is never stored
    by the plugin: it is the GuestFlow property name, read live (rule 48, Adrien 2026-11-06).
11quater. **App enabled per lodging.** A lodging can be left out of the app entirely (« Application
    clients » off for that lodging): no QR code is issued and its lookup answers like an unknown stay. A new property created in GuestFlow starts
    **off** but appears in the studio at once (rule 48), greyed « Hors application » with the switch to turn it on. Switching a lodging off kills its live sessions on their next request (401 `SESSION_EXPIRED`, then the generic « Ce code n'est pas reconnu » screen, without lookup).

### 3.C Gate — a door to the existing gate app

12. **The gate app already exists** (the one Sowel's key URL opens — the same link as the emails'
    `{{gateAccessUrl}}`). The guest app **does not rebuild any gate screen**: the « Portail » tile opens the
    stay's key URL (new tab / standalone window). No new gate logic: GuestFlow still never calls the house.
13. **Source and window.** The URL is read from the `gate-access` plugin — the very `{{gateAccessUrl}}` of its e-mail
    context (`gate_key_results` of the stay), read through what that plugin declares, never its tables — and returned
    only for a stay session inside the gate window (`GET /gate` and the gate tile carry `state` `active` | `preparing` |
    `outside`). Before the key exists (Sowel has not pulled
    yet) the tile reads « Accès en préparation » and is not clickable; outside the window the tile is absent.
    On arrival day, while the key does not exist yet, the highlight reads « Votre accès au portail se prépare » and « La tuile Portail s'activera dès que votre accès
    sera prêt. », with no time promised.
14. **Plugin off** (`gate-access` inactive or not installed) → tile absent, endpoint 404 `PLUGIN_INACTIVE`.

### 3.D Soliomap

15. **Tile + page.** The tile reads **« Activités »** (EN « Activities », Adrien 2026-11-06; the module key stays
    `soliomap`). Soliomap (`https://map.domainesolio.com`, URL stored in the studio settings) opens inside
    the app shell, in a full-height frame under the app bar, with « Ouvrir dans le navigateur » in the bar.
    A place opens on its permalink `/#<activity id>` (Soliomap's own deep link); Soliomap reads no language
    nor lodging from the URL. Checked on 2026-11-05: Soliomap answers `frame-ancestors 'self'` and
    `X-Frame-Options: SAMEORIGIN`, so framing needs the guest host allowed on Soliomap's side (§9 Q8). The
    studio switch « Intégrer dans l'app » is off by default and is turned on only once Soliomap allows the guest
    host; while it is off the tile and the suggestion card open Soliomap in a new tab (with ↗) — decided by that
    switch, not detected at runtime. The frame opens an address asked for only when it has Soliomap's own
    origin (compared as `URL.origin`, not as a prefix), else Soliomap's home (review 2026-11-09).
15bis. **One activity suggestion on the home.** Under the contextual highlight, a card « À faire pendant
    votre séjour » shows ONE dated event read from Soliomap's feed (`GET /api/activities`, the items that
    carry `startsOn` / `endsOn`, cached by the server for an hour): among the events still to come during the
    stay — they overlap the days from today (or, from 14 h on, from tomorrow; a pre-arrival session counts
    from the arrival day) to the eve of the departure day, and `visibleFrom` is reached; no such day left → no card — the one with the smallest
    `driveMinutes`, then the soonest. The card carries the date (one day: « sam. 7 nov. »; several days: « jusqu'au sam. 28 nov. », the event's
    real `endsOn`), the drive time (« 8 min en voiture », Soliomap's own estimate), the name, the category and
    opens that event on Soliomap (rule 15). No such event, Soliomap unreachable, a visitor session or the
    `soliomap` module off → no card. The guest sees no ranking, no list: one idea, never a carousel.

### 3.E Welcome booklet

16. **One booklet per lodging.** Each lodging has **its own booklet**: its own list of pages, in its own
    order, with its own cover photos. Each page has an icon, a cover photo, a title and a sequence of blocks.
    Seeded from the paper booklets (§9 Q1); typical pages: *Bienvenue*, *Arrivée*, *Le logement*
    (équipements & modes d'emploi), *Bain nordique*, *Le domaine* (règles, tri, animaux, calme), *Autour de
    nous* (→ Soliomap), *Départ*, *Urgences & contacts* — but a lodging may have pages the other does not
    (e.g. *Le poêle à bois* at La Granja only) and skip others.
17. **Sharing without copying, or copying to diverge.** What is truly common (the estate rules, the
    surroundings) need not be written twice:
    - a page can be **shared** with several lodgings — one content, edited once, placed independently in
      each lodging's booklet (own position, can be unpublished in one lodging only);
    - inside a shared page, a block can be **restricted** to some lodgings (« Seulement pour : La Granja »);
    - « Dupliquer vers… » copies a page into another lodging as an independent page, to diverge from there.
    The guest only ever sees their lodging's resolved booklet (server-resolved: the lodging's pages, in its
    order, with restricted blocks filtered and lodging facts injected). Visitor mode resolves the same
    booklet for the lodging of the QR.
18. **Block types** (closed list, each with a dedicated renderer): `text` (rich text: paragraphs, bold,
    lists, links), `image`, `gallery`, `callout` (info / warning), `steps` (numbered how-to with optional
    photo per step), `wifi` (network + password + « Copier », QR to join), `contact` (name, role, phone →
    `tel:`, WhatsApp, email), `place` (address + « Itinéraire » → maps link), `faq` (accordion),
    `button` (label + target `{ kind:'page', slug }` | `{ kind:'item', itemKind, itemId }` | `{ kind:'url', href }`), `hours` (opening times table). A `button`
    whose target is not available to the session (module off, item not sold here, a shop or bath target for a
    visitor or a pre-arrival session) is not rendered. Reading of 2026-11-10 (audit R36-INJ-L1): the wifi join QR
    escapes every character the `WIFI:` scheme reserves — backslash, `;`, `,`, `:` and `"` — so a password with a
    backslash joins as typed.
19. **Languages.** Every text field has FR and EN. The app language is the guest's `clients.emailLanguage`
    for a stay session, else the browser's (`fr` default), switchable from the app bar. A missing EN text
    falls back to FR, flagged in the studio (« 3 textes non traduits »). Reading of 2026-11-10 (audit R36-C-L1): the
    switch sets the language of every request before any screen reads again, so the orders and the booklet come back
    in the new language at once; the server's refusals follow it too (rule 56).
20. **Search.** A search field on the booklet index searches titles and texts of the resolved booklet
    (server-side, accent-insensitive).
21. **Offline.** The resolved booklet (texts + images at mobile size) is cached by the service worker on
    first load and readable without network (the domain has weak mobile coverage). The shop and the gate
    always require the network and say so (« Connexion nécessaire », the gate tile included — never « Accès en
    préparation » for a read that failed offline). The worker's data cache keeps at most 200 photos, oldest
    dropped first, and is emptied (the shell kept) once the device holds no stay any more — visitor mode or no
    session: the page posts it a `purge` message (review 2026-11-09).

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
    - options: `per_stay` (unit), `per_person` (unit = one person), `free` (always included), and the breakfast
      (rule 27bis); an internal option (`displayToClient = 0`), the cancellation insurance and the auto timed
      options (early check-in, late check-out) never;
    - resources: hourly resources (`per_hour`, scheduled — the nordic bath) and the `per_stay` and `free` resources,
      each only with an explicit `resource_properties` link to the stay's lodging. **Amended 2026-11-10 (audit R36b
      N2):** a `per_person` resource is refused, « Une ressource au prix par personne ne se vend pas dans
      l'application. »: the engine bills it quantity × party (`pricing.getTypeMultiplier`), so « 1 × Vélo » for 4 people
      was 40 € under « 10 € par personne », and « 4 » ordered for them paid 16 persons. A switch already on sells
      nothing (the shop re-judges every row); its editor then shows the reason under the switch, which stays enabled
      so it can be switched off (verification R36b R1, `GuestAppItemFields.stored-on.test.jsx`).
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
      (`property_resource_prices.freeMinutes`) are granted **once per stay** (the stay's tariff snapshot grant wins over today's catalogue): the server
      subtracts what the stay already received (its lines on the fiche, which already carry its confirmed, paid
      and delivered orders, rule 34, plus the orders still awaiting payment) and shows what is left
      (« 1 h offerte avec votre séjour », « 1 h offerte — déjà utilisée »);
    - an option **offered by default** to the lodging (`property_option_defaults.offered`) that the stay
      already carries is shown « Déjà inclus dans votre séjour » and not sold again;
    - an item not linked to the stay's lodging is not shown;
    - a 0 € item (included or free) is limited per stay to its `maxQuantity`, counted across orders.
    The quote prices an order **after** the stay's card orders awaiting payment (`priceOrder(…, { pending })`): those
    hold the free units and minutes they were quoted with, so a later order never takes them and the shop's « déjà
    utilisée » says the same (review of 2026-11-09).
    An order whose quote total is **0 €** (only free / included units) needs no payment and no name: one
    button « Réserver », the order is `confirmed` and written to the fiche like a note order (rule 34).
26. **Categories.** Items are grouped by the existing option `category` (e.g. « Boissons »,
    « Alimentation », « Bien-être »), in the core's category order (French collation, `groupOptionsByCategory`) until the studio gets a category
    order, and inside a category by the plugin's `sortOrder`, then title; hourly resources appear in « Bien-être »;
    items without a category and non-hourly resources come last under « Autres ». An empty category is not shown.
27. **When the shop is open.** Exactly when the core mid-stay extras window is open for the stay
    (`midStayExtrasWindow.js`: from `startDate` until the end-of-stay complement is collected). Pre-arrival sessions see the catalogue read-only (a visitor has no shop, rule 11bis) with « Disponible pendant votre séjour ». After the
    complement is collected: « La boutique est fermée. Bon retour chez vous ! ». **Amended 2026-11-10:** the shop is
    also open to a pre-arrival session, from J-7, while `orderCollection` is `arrival` (rules 65-68); read-only with
    « Pour ce séjour, les commandes ouvrent à votre arrivée. » when it is `unavailable`.
27bis. **Breakfast** (decided 2026-11-05 with Q9). The seeded breakfast option (`autoOptionType='breakfast'`,
    `per_person_per_night`, `utils/breakfastSeed.js`) is sellable despite rule 23's exclusion of its price
    type. Ordering it means choosing the mornings left in the stay, the number of people (up to the party size) and
    the hour: one hour chosen applies to every chosen morning where it is a valid delivery time (rule 41), a
    morning where it is not is shown unavailable at that hour; each morning keeps its own time in the stay's
    breakfast line `cardOccurrences`. Priced per person and night by the core engine, shown to the guest « par
    personne et par matin »;
    it appears on the planning's `BreakfastDayCard` only, never on a « Commande client » card. A stay that already
    includes it orders it at 0 €, which only sets its mornings and hour; a stay's breakfast line with no morning
    placed yet keeps its quantity — the order places mornings, never lowers the line. Staff-prepared items also follow the
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
    (they occupy the resource too). Removing a slot re-validates the others; the quote returns any session no
    longer bookable (past, taken, heating, staff) as `unavailable`, and a slot that was warm only thanks to a
    removed or moved session is re-checked under rule 31. In the cart each unavailable session has its own
    « Retirer » and blocks the order until removed; from the slot picker only the sessions still free go to the
    cart (review 2026-11-09).
30. **Ordering writes the planning.** A committed order adds its sessions to the stay's
    `reservation_resources` line (creating the line if the stay had none, raising its sold hours otherwise),
    so the session appears at once on Calendrier › Ressources, on the day's planning card, and on the
    ignition card « Allumer le bain » of `resource-ignition-task.md` — exactly as if the operator had placed
    it from the fiche. A slot taken between the quote and the order is refused (`SLOT_TAKEN`) and the picker
    reloads.
31. **Lighting needs staff.** When a slot needs the resource heated from cold, its ignition time
    (`start − heatUpMinutes`, as the ignition card computes it) must fall inside the service hours of §3.G;
    otherwise the slot is `staff` and is not listed (§6.4). A slot
    that follows a use while the resource is still warm needs no ignition and is not constrained.

#### Cart, payment, commit

32. **Cart.** Lives on the device (local UI state, persisted in `localStorage` for the session only). The
    total shown is **always** the server's answer to `POST /guest/orders/quote` — the client never adds
    prices. A quote that fails leaves no total: the order button waits for a quote that succeeds. Adding to
    the cart never goes past the article's bound: the product sheet's stepper counts what the cart already
    holds (review 2026-11-09). The cart survives a reload of the app.
33. **Two ways to pay, the guest chooses** at checkout (for a non-zero total):
    - **« Payer maintenant »** (card): the server creates the order `awaiting_payment` and a Qonto payment
      link of type `complement` for exactly its quoted total, with the order's lines as VAT basket (what the engine raised
      beside them, such as a percentage of the stay, is one more line « Ajustement du séjour lié à la commande »); the app
      redirects to Qonto; the return lands on `/commande/<id>` which polls the order status.
      No name asked — the stay link is the proof (rule 2).
    - **« Ajouter à ma note »** (end-of-stay bill): no name asked either (rule 2); the order is `confirmed` at
      once and its lines join the stay's end-of-stay complement, collected at the departure SAS as today.
    « Payer maintenant » is hidden while the `online-payment` plugin is inactive or Qonto is disconnected.
    ~~**Amended 2026-11-10:** and while the arrival is not marked~~ (struck the same day by the fifth message: card is
    offered from J-7, rules 67, 85); before the arrival the note reads « Régler à l'arrivée » and lands on the arrival
    complement (rules 66-67). The order of the two choices and their look: rule 86.
34. **How an order lands on the fiche.** *(Amended 2026-11-10: before the arrival is marked, as ordinary lines on the
    arrival complement — rule 66.)* A confirmed order (note or 0 €) or a paid order (card) is written
    by the **core** as mid-stay extras on the reservation — the same write path as the operator's `PUT
    /api/reservations/:id` on a locked fiche (rules 1 and 9 of `mid-stay-extras-on-locked-fiche.md`), in one
    transaction with the order status, with the reservation history entry « Commande client #12 ». Quantities
    add to the existing line of the same option/resource (no duplicate line). Note orders flow into
    `endOfStayComplementDetail` with `source:'midStayExtra'` exactly like an operator addition — no new
    arithmetic.
35. **Card orders** are recorded as **already paid**: the lines join the reservation, and the payment is
    recorded against the reservation's payment ledger as a `complement` payment (amount, date, Qonto
    reference), so the end-of-stay complement owes nothing for them and the accounting books the money on
    the payment date. This wires the `complement` type end to end: `ensurePaymentLink` accepts it **only**
    with an explicit guest-order basket, `applyPaidEffect` gets a `complement` branch that commits the order.
    Exempt from the arrival-day lapse (`payment-link-lifecycle.md` rule 9); its own lifetime is **30 min**.
    While `awaiting_payment` the order **holds** its hourly slots (rule 28) and the free minutes it uses; the guest can abandon it from « Mes commandes » (status `abandoned`, chip *Abandonnée*, holds released at
    once, its lines back in the cart; a payment that lands on it anyway is `paid_conflict`, never committed). At payment, a `deliverAt` earlier than payment + lead moves to the next valid slot and the order says so.
    **The fiche is never billed beyond the payment** (review of 2026-11-09): when the commit costs more than was paid
    (a price raised meanwhile), the order is `paid_conflict` — unless orders committed while it awaited its payment
    were quoted that amount above what they added to the fiche (they priced after it, rule 25; `deferredCents`): that
    gap is theirs, left on the end-of-stay complement. When it costs less (a price lowered), the order is committed and
    only the gap is flagged « à rembourser » on the link (`basketJson.refundCents`), with its history entry
    (« 6,00 € sur 18,00 € payés… ») and the ledger row for that part. An order paid while it still awaited its payment
    held its units: it is never judged on the stock (rule 37quater is for a late payment). **One card order waits for
    its payment at a time** (final review of 2026-11-09): while one's link is live, a second card order is refused
    (`CARD_ORDER_PENDING`), the note staying open — two pending card orders paid out of order would see the later one
    take the earlier one's allowance. A hold that has lapsed holds nothing, even before the expiry job flips its order.
36. **Unpaid card order.** If the link is not paid within 30 min the order goes `expired`, its holds are
    released, nothing reaches the fiche. A payment confirmed after expiry (late webhook) still commits the
    order if its slots are still free; otherwise the order goes `paid_conflict`, the operator is pushed, and
    refunds by hand (refund out of scope). A `paid_conflict` payment is recorded on the reservation ledger as a
    `complement` payment flagged « à rembourser », with a history entry; no line is added. A late payment whose
    `deliverAt` is already past moves to the next valid delivery time and the order says so. A payment that lands after the
    stay was cancelled (or deleted) still reaches its order: the core hands a basket link to its owner before its
    cancelled / missing-stay exits, and the order goes `paid_conflict`.
37. **Limits.** Per order: ≤ 20 lines, each quantity 1…`maxQuantity` (plugin field, default 10), total
    ≤ 500 € (plugin setting). Per session: 10 orders / hour. Out-of-range → 400 with the documented code;
    the app's steppers already respect `maxQuantity` (UX only).
37bis. **Stock per article** (Adrien, 2026-11-06). Each option, and each non-hourly resource, may follow a stock,
    set in the GuestFlow editor's « Application clients » section (rule 22, §6.6) — the only place it is edited; the
    studio's shop screen shows it read-only with « Modifier dans GuestFlow »:
    - « Suivre le stock » (off by default — an article without it is never limited), « En stock » (an integer the
      operator types at each restock; saving it sets the stock at that moment, with the history line « Stock réglé
      à 24 — Sophie, 6 nov. 14:02 »), « Prévenir sous » (optional low-stock threshold);
    - « En rupture » (a manual switch, independent of the count: on = sold out now, whatever the count says).
    One stock per article for the whole estate (a single cellar), never per lodging. Hourly resources (the bath)
    have no stock: the resource planning is their truth (rule 28); neither has the breakfast, ordered by the morning
    (rule 27bis) — the editor refuses the switch for both (`NO_STOCK`). Switching « Suivre le stock » on asks for « En
    stock » once; a restock is what the cellar holds *now*: what the stays already took is not taken from it again.
37ter. **Every sale counts, when the article leaves the cellar** (Adrien, 2026-11-06). The stock goes down for the
    app's orders *and* for the lines the website or the staff put on a reservation, at the moment the article is
    actually taken:
    - an app order counts when it is confirmed (note, 0 €) or paid (card); a card order **holds** its units while it
      awaits its payment (rule 35) and releases them when it expires or is abandoned; *(amended 2026-11-10)* an order
      taken before the arrival holds its units until the arrival day (rule 74);
    - a line already on the reservation counts on the **arrival day** of the stay (the plugin's arrival sweep —
      idempotent, every 5 minutes, so within minutes of midnight — and at once for a stay created or moved to a start
      date already reached); a line added or raised
      during the stay counts when it is written; a stay cancelled before its arrival never counted anything;
    - a counted quantity that goes down (a line lowered or removed, a cancellation after arrival) returns to the stock.
    The plugin keeps what it has counted per reservation and article (`guest_app_stock_counts`) and reacts to the
    core's `reservation.created / updated / cancelled / deleted` events (`plugins/sdk/eventBus.js`), so nothing in
    the core changes; an app order writes its count in the same transaction as its commit, so the event that
    follows finds nothing left to count. Staff and website sales are never refused: the stock may go below 0
    (shown « −2 » in the editor).
37quater. **Sold out = the app stops selling it, the staff is told.** An article whose stock (minus the units held)
    is 0 or less, or switched « En rupture », shows **« Épuisé »** in the app, its « Ajouter » disabled; the
    stepper stops at what is left (« Plus que 2 »); a quote or an order beyond it answers 409 `OUT_OF_STOCK` with
    the units left (`{ itemKey, left }`), and the cart shows the line « Plus que 1 disponible » with the quantity lowered. The website keeps
    selling it for future stays (the cellar will be restocked) and the reservation editor shows a warning
    « Stock : épuisé » without blocking. Reaching the « Prévenir sous » threshold, then 0, pushes the channel
    « Commandes clients » once each (« Stock bas : Cidre — plus que 3 », « Cidre épuisé ») until the next restock.
    A late card payment (rule 36) whose units are no longer available goes `paid_conflict`, like a taken slot.
38. **Order follow-up.** « Mes commandes » lists the stay's orders with status chips: *En attente de paiement*, *Payée*, *Sur votre note*, *Offerte* (0 €), *Payée · à rembourser* (`paid_conflict`), *Expirée*, *Abandonnée*; a second chip *Prévue {jour heure}* / *Livrée* for orders with a delivery, *Prête {jour heure}* / *Retirée* in
    pickup mode (rule 41bis). An
    unpaid card order shows « Paiement par carte en attente » and no preparation step until it is paid. The guest cannot cancel a
    confirmed order from the app (« Contactez-nous » → booklet contact block). The return from Qonto follows the
    order without giving up on the network (tried again, waiting longer each time); after its try limit it says
    the payment is not confirmed yet and offers « Vérifier à nouveau ». « Abandonner et revenir au panier » merges
    the order's lines into the cart as it stands (review 2026-11-09). « Reprendre le paiement » is not offered: the
    order payload carries no payment link (§9). *(Amended 2026-11-10: the chips of an order collected at the arrival,
    rule 76.)*

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
    recevoir ? » with server-computed delivery times t (30-min steps) such that check-in ≤ t < check-out and the preparation
    interval [t − max(leadMinutes), t] lies after *now* inside one service range. Delivery times have no
    capacity limit (decided 2026-11-05): an order holds no delivery slot and there is no `DELIVERY_SLOT_GONE`. The first slot is preselected, labelled « Dès que possible — vers 17 h 30 » only while the service is open now
    *(amended 2026-11-10: and the check-in is reached; before it, the first time with its day — rule 69)*.
    No service hours stored at all (neither shared nor per lodging) = no constraint: the service counts as always
    open and the plugin's setup status says « horaires du service à configurer ». Once anything is stored — shared or
    of any lodging — a day without a range is closed. A lodging with weekly ranges of its own follows them with its
    own exceptions; one with exceptions only keeps the shared week, its dates replacing the shared ones (review of
    2026-11-09). t is strictly before the check-out. While nothing is stored, establishment closures are not applied either (a closed
    domain has no stay in progress). An ignition may fall at the very end of a range. Reading of 2026-11-10 (audit
    R36-S2): the times are real instants, labelled by the Paris wall clock — on the night the clocks go back the first
    time is still the lead away, and on the night they go forward a wall time that does not exist is never offered.
41bis. **Delivered or picked up — one setting for every lodging** (Adrien, 2026-11-06). Studio › Réglages ›
    Service holds « Les commandes sont… » **Livrées au logement** (default) | **À retirer**; « À retirer » asks for
    the **pickup place**, one plain text field (e.g. « À l'accueil, maison principale — sonnez à la porte
    verte »), required to save, relayed as typed in both languages. The mode and the place are stored on each order
    when it is taken, so a later change rewrites no order; « À retirer » saved without a place (through the generic
    plugin settings, which judge one key at a time) leaves the orders delivered rather than pointing nowhere. Pickup mode only changes the words: the cart asks
    « Quand souhaitez-vous la récupérer ? », a time t means « ready at t » (the same preparation interval as rule
    41), the push and the Commandes clients page say « à retirer » and their check reads « Retirée ».
41ter. **After ordering, the guest knows when and where.** The confirmation screen (once paid for a card order) and
    the order in « Mes commandes » state, built by the server from `deliverAt` and the mode:
    « Prête aujourd'hui à 17 h 30. Lieu de retrait : À l'accueil, maison principale… » (the place as typed) or
    « Livrée à L'Estiva aujourd'hui vers 17 h 30 ». The
    time is the chosen one (« Dès que possible » = now + the longest `leadMinutes` of the order's staff items,
    rounded to the next 30-min step inside the service hours, rule 41). Only staff-prepared items carry it: an
    hourly resource keeps its own line (« Bain nordique — ven. 20 h, il sera chaud »), a self-service item none;
    an order with no staff item shows no preparation time. A time moved at payment (rule 35) is the one shown, with
    « Votre commande sera prête un peu plus tard que prévu ».
42. **Outside service hours the guest can still order, for later.** The shop shows a banner « Le service
    reprend demain à 8 h — vous pouvez commander dès maintenant pour plus tard » and the delivery picker
    starts at the next opening + lead time (rule 41). No opening left before departure: « Le service est fermé
    jusqu'à votre départ ». An item whose last possible delivery is past check-out is shown
    « Plus disponible pour votre séjour ».
43. **The delivery time drives the staff.** The order carries `deliverAt`; the push of rule 44 states it;
    a planning card « Commande client » appears on the planning day of `deliverAt` (contributed by the plugin
    through `planning.days`), with the staff-prepared lines only (flagged `needsStaff` in the order's snapshot when it
    was taken; a self-service article of the same order is not prepared) and a « Livrée » check.

### 3.H Staff side

44. **Push.** Every confirmed or paid order pushes the new channel **« Commandes clients »**, **once**: an order put
    on the end-of-stay complement (or at 0 €) pushes as soon as it is confirmed; a card order pushes **only once
    paid**, never while it awaits its payment, nor when it is abandoned or expires (Adrien, 2026-11-06)
    (`guest-orders`, declared by the plugin with `ctx.pushChannel`, whose keys are kebab-case) to subscribed staff: « L'Estiva · Marie —
    2 × Cidre pour 18 h, 1 h bain nordique ven. 20 h (sur la note) » (pickup mode: « … à retirer 18 h »). The push opens the order in GuestFlow.
    *(Amended 2026-11-10: the day when it is not today, « à régler à l'arrivée » — rule 75.)*
45. **Orders list in GuestFlow.** A page *Commandes clients* (the same name as the push channel, review of
    2026-11-05) (contributed by the plugin; sidebar, under the
    day-to-day group) lists orders by delivery time, filter « À préparer / Toutes », each row: lodging, guest,
    lines, delivery time, payment mode, status, « Marquer livrée ». « À préparer » keeps to the stays not ended yet
    (an undelivered order of a past stay ages out; « Toutes » still shows it). Bath sessions appear in the resource
    planning as any session (rule 30). The page is the admin's (2026-11-09): the reception role sees only the
    dashboard, the planning and its account (`reception-role-checkin-only.md`) and marks an order delivered from its
    planning card (rule 43), whose endpoints it may call. Since 2026-11-10 (audit R36 A36-3) the list itself
    (`GET /api/guest-app/orders`, amounts and payment included) answers 403 to the reception: no money reaches it
    (`reception-role-checkin-only.md` rule 4). **Amended 2026-11-10:** an order of a cancelled stay leaves « À préparer »
    and the planning (rule 72); an order outside the stay's moved dates is flagged (rule 73).
46. **The fiche** shows the order's lines as normal lines (they are), and the history entry links to the
    order.

### 3.I Booklet studio (dedicated web app)

47. **A separate web app**, « Studio du livret », served by GuestFlow at `/studio` on the admin host while
    the plugin is active, with its own lightweight layout optimised for content editing (tablet-first),
    **signed in with the GuestFlow admin account** (same session cookie as `/api`, so no second login on the
    same browser). Roles: admin only; the reception role has no access. The user is re-read on every request through the
    core's own `requireAuth.revalidate`: a deactivated, deleted or demoted admin, or one held to a password change,
    gets no studio from an old session.
48. **Lodging first, read from GuestFlow** (Adrien, 2026-11-06: nothing hard-coded). The studio opens on a
    **lodging switcher** listing every non-archived GuestFlow property, with its GuestFlow name, in GuestFlow's
    order, read on each load — a property added in GuestFlow appears without any action (greyed « Hors
    application » until switched on, rule 11quater), a renamed one shows its new name, an archived one disappears
    (its configuration is kept). The articles, prices, titles, categories and stock are also read live. Only
    what comes from outside GuestFlow is cached — the Soliomap feed (rule 15bis) — and Réglages carries a
    **« Synchroniser »** button that refreshes it at once (« Synchronisé il y a 2 min »). Every screen works
    on the selected lodging: *Modules* (switches + drag order, rule 11bis), *Infos du logement* (wifi, hero,
    contacts, rule 11ter), *Livret* (that lodging's pages), *Boutique* (presentation of the items sold there).
    A shared page shows a « Partagée avec L'Estiva » chip, and saving it says « Modifie aussi L'Estiva ».
    **Edits:** pages (create, reorder by drag per lodging, share with / restrict to lodgings, duplicate to a
    lodging, publish / draft, icon, cover photo),
    blocks (add from a palette, reorder, edit FR / EN side by side), photos (upload, crop to the block's
    ratio, alt text), shop presentation (per sold item: photo, short description FR/EN, `maxQuantity`,
    `needsStaff`, `leadMinutes`, category order; the price, title and stock stay GuestFlow's — read-only here with
    « Modifier dans GuestFlow »), service hours and delivery / pickup (rules 40, 41bis), app settings (app name, hero photo per lodging,
    Soliomap URL + « Intégrer dans l'app », order limits, regenerate a lodging's QR code, print the QR poster
    PDF per lodging). « Publier » publishes one lodging's booklet; publishing a shared page republishes it in
    every lodging it is placed in.
49. **Live preview.** The editing screen shows a phone-frame preview of the page rendered by the real guest
    components, for the chosen lodging and language. « Publier » makes the draft the guest version; until
    then guests see the previous version.
50. **One flag, two views.** The sell switch and its fields (rule 22) are edited in the studio's shop
    screen *and* in GuestFlow's option / resource editors (plugin contribution) — same rows.

### 3.J App shell, install, look & feel

51. **One codebase, three layouts.** Mobile: bottom tab bar (Accueil · Livret · Boutique · Commandes) +
    floating cart bar. Tablet (≥ 900 px): navigation rail + two-pane booklet (index | page) and shop (catalogue
    | cart). Desktop (≥ 1200 px): same, content max 1200 px, hero wider.
52. **Installable PWA.** Manifest (`GET /public/v1/guest/manifest.webmanifest`: name from the studio, theme fir-green
    `#2E3B2A`, ground `#F5F0E6`, icons `/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`), standalone display,
    offline shell + booklet (rule 21). After the second visit a discreet « Installer l'app » card (Android
    `beforeinstallprompt`; iOS: a sheet with the share → « Sur l'écran d'accueil » steps). Never on first load.
53. **Look & feel** — §6: the Domaine Solio identity of the site and the gate app (Marcellus + Karla,
    sapin / ocre / paper, square-cut, photo-led), the night register at night, one orchestrated motion per
    screen, WCAG AA in both registers, 44 px touch targets.
54. **The lookup opens a platform's number only** (D28, Claude under Adrien's standing « refuse first » order,
    2026-11-10; audit R36 A36-1). « Retrouver mon séjour » never opens a stay whose number the core generated
    (sequential, guessable): a stay sold on an own channel — judged by the platform's mode (`isDirectChannel`: `direct`
    and every platform « Compté comme vente directe »), never by its name — and a platform stay still carrying the
    core's `AAAAMM###` (or older `AAAA-MM-###`) number answer the one generic 404 `STAY_NOT_FOUND`, as an unknown stay
    does; a lookup session already open on such a stay dies on its next request. « Régénérer le lien » (SAS and
    fiche) also ends every lookup session of that stay: the operator's one way to close a stay to everyone. The stay
    link stays the capability of direct guests (rule 2).
    **Amended 2026-11-10 (audit R36b N1):** the shape is the core's exact one, `20YY` + month + a 3-digit counter
    (`^20\d{2}(?:(0[1-9]|1[0-2])\d{3}|-(0[1-9]|1[0-2])-\d{3})$`), pinned to `utils/reservationNumber.js` by the suite. The
    first shape (`\d{4}-?MM-?\d{3,}`) took any 10-digit Booking number whose digits 5-6 read 01-12 for the core's (3 of
    10 on the production copy): those guests read « Nous n'avons pas trouvé ce séjour ». A month's 1000th core number
    (4-digit counter) is not recognised by its shape; a direct stay is refused by its mode all the same.
    **D28 scope (2026-11-10, round 36b):** a platform's number (Booking, Airbnb, Gîtes de France…) is the platform's
    own; how guessable it is — Gîtes de France's 4-5 digits included — is the platform's matter, with the surname as the
    second factor and the per-IP limit of rule 6. Nothing more is refused for it.
55. **Never more persons than the stay can still be served, never a priced article at 0 €** (audit R36-M-H1). The
    engine serves a per-person line at most max(1, party, the lodging's capacity) persons
    (`pricing.resolveServedPersons`): an order whose persons exceed what is left of it is refused before anything is
    priced — 409 `PERSONS_EXCEEDED` « 3 personnes au plus pour « Planche apéritive ». » / « « Couverts » sert déjà
    toutes les personnes du séjour. », on the quote and the order, on the note, by card (no link minted), at 0 € and in
    pickup mode alike; the persons of a card order awaiting its payment count as served. A breakfast asking more
    persons than its line already serves (that line keeps its persons, rule 27bis) is refused the same way: « Le
    petit-déjeuner du séjour est prévu pour 2 personnes. ». The refusal is the core's
    (`midStayOrderCommit` `ORDER_PERSONS_EXCEEDED`, `plugins-phase-1-sdk.md` rule 47 reading of 2026-11-10). And a
    priced article the engine adds nothing for, with no free unit or minute left to explain it (a line the fiche
    offers), is refused 409 `ITEM_UNAVAILABLE` « « Fagot de bois » ne se commande pas dans l'application pour ce séjour :
    contactez l'équipe. », never confirmed at 0 €.
56. **Every refusal in the guest's language** (audit R36-PUB-L1). The `code` of a `/public/v1/guest/**` refusal never
    moves; its `message` follows `?lang=`, else the guest's language (rule 19), as the public API's own envelope does
    (`site-english-version.md` rule 8) — the rate limits' answers included. One table (`refusals.js`) holds every
    refusal in French and English.
57. **Card orders per stay** (audit R36-PUB-L2). Each card order mints a payment link at the provider, abandoning frees
    the next one at once (rule 35) and a new session costs a link exchange: a stay places at most **6 card orders per
    hour**, whatever its sessions or addresses (`GUEST_CARD_ORDER_RATELIMIT_*`), the 7th → 429 « Trop de paiements par
    carte pour ce séjour en une heure : ajoutez la commande à votre note. ». A refused card order spends nothing; the
    note stays open.
58. **The guest host is never GuestFlow's own** (audit R36 A36-2 = R36-CON-M1 = R36-P1). A host-bound web app claims
    every path of its host but the core's trees (`plugins-phase-1-sdk.md` rule 48): set to the admin's address, the
    guest app took the back office over, its login and its settings included. « Adresse de l'application » is refused
    at save — 400 « C'est l'adresse de GuestFlow : en choisir une autre, par exemple sejour.domainesolio.com. » — when it
    equals the host of GuestFlow's public URL or one the saving request came through (its `Host`, its `Origin`). It is
    written by the plugin's own route only (`PUT /api/guest-app/studio/settings`, which sees that request): the generic
    plugin settings route refuses it, its GET leaves it out (an internal setting). A value already stored equal to
    GuestFlow's public host is ignored — no link, no QR, no app on it, the setup asks for an address again — and the
    core's loader never hands GuestFlow's own public host to any plugin's web app, so the back office stays reachable.
59. **The erase says what it drops, and drops the photos** (audit R36-P2). « Effacer aussi ses données » names the
    booklet pages and the photos besides the lodgings, orders and sessions (« 3 pages de livret », « 12 photos »), and
    deletes the photo files (`<uploads>/guest-app/`): erased, they are served no more. **Amended 2026-11-10 (audit R36b
    N5):** the core runs the plugin's clean-up inside its erase transaction, before the tables are dropped; the files
    are deleted once that transaction is over, and only when it dropped `guest_media`. A rolled-back erase (« Échec de
    l'effacement : rien n'a été effacé ») keeps the photos; a file deletion that fails after the commit is logged and
    leaves the files on the disk.
60. **Free units explain a 0 € line only up to what they cover** (audit R37-M-L1, reading of rule 55). The exemption of
    rule 55 for a priced article the engine adds nothing for holds only while the stay's free units left cover the
    line's quantity (an option), or its free minutes left cover the line's hours (an hourly resource). A line the fiche
    offers, asked beyond them, is refused 409 `ITEM_UNAVAILABLE` « « Fagot de bois » ne se commande pas dans
    l'application pour ce séjour : contactez l'équipe. », on the quote and the order, nothing written. *Why:* an option
    with 2 free units, offered on the fiche for 1 unit: an order of 4 units was confirmed at 0 €, the fiche line at 5
    units for 0 €, 30 € delivered unbilled per order.
61. **The article's title follows the request's language** (audit R37-C-L2, reading of rule 56). The quote's line
    labels (« 2 × Farm cider ») and every refusal naming an article — its `maxQuantity`, rule 55's persons left or
    none, rule 55 and 60's article not billable — read the title the shop shows in the request's language (the
    translation catalogue, French when none). The order stores the French catalogue title, as the stay-link notes
    say: its page, the staff's list, the push and the payment link read that one.
62. **The studio's refusals are sentences** (audit R37-INJ-L1). A refusal key of the guest's table that a shared helper
    returns (the booklet search's `searchLength`) reaches the studio as its French words, « La recherche fait de 2 à
    100 caractères. », never as the key.
63. **The plugin switched off during a visit shows « Application indisponible »** (audit R37-C-L1). Any request of the
    guest app answered 404 `PLUGIN_INACTIVE` naming the guest app — the loader's bare code — opens the « app
    unavailable » screen (§7, French or English), whichever page asked: never the code under « Réessayer ». `/gate`
    answering `PLUGIN_INACTIVE` for `gate-access` leaves the app open (rule 14). The studio reads the same answer as
    « Module inactif. ».
64. **The booklet import never echoes the password** (audit R37-EXT-2). `specs/guest-app-livret/import.mjs` reads the
    password at a prompt that writes nothing back (`prompt.mjs` `askSecret`: the question only, the typed keys never
    reach the terminal, Ctrl-C still stops the script), so it stays out of the scrollback, a screen share or a
    recording; `GUESTFLOW_PASSWORD` still replaces the prompt. The 2FA code keeps a plain prompt.

#### 3.K « Mon séjour » from J-7 — ordering before the arrival (Adrien, 2026-11-10; summary [`guest-app-j7-resume.html`](guest-app-j7-resume.html))

65. **The app is usable from J-7, ordering included** (Adrien, 2026-11-10). The pre-arrival session of rule 2 — opened by
    the stay link, or by the lookup of rule 6 for a platform's number only (rule 54 and D28 unchanged: a number the core
    made never opens anything) — from **J-7 00:00 Europe/Paris** (the arrival date minus 7 calendar days,
    `currentStay.preArrivalOpensAt`, the day the J-7 e-mail is due) until the window opens (check-in − 3 h) reads and
    uses the shop like a stay session: the catalogue, the slots, the delivery times, the quote, the order, « Mes
    commandes ». It still has no gate (rule 13). Before J-7 the link opens the visitor mode as today, and that visitor
    session ends at J-7 00:00 so the app's next exchange opens the pre-arrival one: a J-7 e-mail sent early by hand
    opens the booklet only until that midnight. A lookup session and a link session get exactly the same. The session
    keeps rules 4 and 9: at the window's opening a link session ends and the app exchanges the link again; a lookup
    session moves to the stay by itself. *Why:* a guest who wants cold drinks or a bath on the evening of the arrival
    orders them before leaving home.
66. **An order taken before the arrival is collected at the arrival.** The money follows where the core's engine
    routes it; no new bucket, no new arithmetic. While the arrival is not marked (`isArrivalNotMarked`: no arrival
    baseline and none due — no check-in done, no arrival SAS committed, the arrival complement not collected), the
    order's lines are written on the fiche as ordinary lines, through the same `performUpdate` as today (a fiche not
    started, or the arrival day before the arrival). The engine routes their amount to the **arrival complement** when
    the stay's pre-arrival money is settled (`preArrivalSettled` in `utils/pricing.js`: acompte and solde paid, or every
    installment of a plan paid). The core commit (`midStayOrderCommit`, `plugins-phase-1-sdk.md` rule 47 reading of
    2026-11-10) then measures the order on that complement — `byKey` = per line key, what the line's billed total gains
    — and refuses, nothing written:
    - 409 `ORDER_OFF_ARRIVAL_COMPLEMENT` when the order would move another bucket (acompte, solde, an installment, the
      end-of-stay complement) or when Σ `byKey` differs from the arrival complement's growth by a cent or more;
    - 409 `ORDER_STAY_PRICE_MOVED` when the stored stay, replayed without the order, would not land on its stored
      `finalPrice` and `touristTaxTotal`: an order never re-prices the stay;
    - ~~409 `ORDER_PAID_BEFORE_ARRIVAL` for a `paid` commit: no card money before the arrival (rule 67).~~
      **Amended 2026-11-10 (Adrien, Q13):** a `paid` commit before the arrival is accepted and settled by rule 85;
      `ORDER_PAID_BEFORE_ARRIVAL` is retired.

    The order is stored with `collectAt = 'arrival'`. Once the arrival is marked, the commit is today's (rule 34: the
    end-of-stay complement, `collectAt = 'departure'`). The arrival SAS collects that complement with the rest of the
    arrival payment — one payment (`single-payment-at-check-in.md`), the mixed-method rules of
    `mixed-method-payments.md`, « Plus tard » and « Percevoir en fin de séjour » exactly as for any complement. An order
    delivered after the arrival is still collected at the arrival; a complement left « Plus tard » or deferred carries
    it to the departure through the deferred complement (`defer-arrival-complement-to-checkout.md`), never billed twice.
    *Why:* before the arrival there is no end-of-stay remainder: the commit measured 0 for every priced article and
    refused it 409 `ITEM_UNAVAILABLE` (rule 55) — today already the case on the arrival day, between the window's opening
    and the arrival SAS (finding of 2026-11-10, pinned first by the suite).
67. **Before the arrival, card or « Régler à l'arrivée ».** **Amended 2026-11-10 (Adrien, fifth message; Q13 resolved):**
    ~~« Payer maintenant » is not offered while the order would be collected at the arrival (`canPayCard: false`); a card
    order sent anyway → 409 `CARD_AFTER_ARRIVAL`.~~ From J-7 the guest pays by card exactly as during the stay: the
    `complement` basket link of rule 35 (30-minute life, one card order awaiting payment at a time, `paid_conflict` rules
    unchanged), committed at payment by rule 85. `canPayCard` is true whenever the shop is open (`orderCollection` `arrival`
    or `departure`) and the `online-payment` plugin is live and connected; `CARD_AFTER_ARRIVAL` is retired (no refusal
    key left to translate). The note button reads the server's `noteLabel`: « Régler à l'arrivée » / « Pay on arrival »
    before the arrival, « Ajouter à ma note » / « Add to my bill » after it. The shop payload carries `orderCollection` ∈
    `arrival | departure | unavailable | closed`, from the core's `midStayOrderCommit.orderCollection(reservationId)`
    (`arrival`: not marked and `preArrivalSettled`; `departure`: marked, end-of-stay complement open; `closed`: end-of-stay
    complement collected; `unavailable`: rule 68). The commit's own guard (rule 66) stays the authority. The choice is
    presented by rule 86 (card first, preselected).
68. **A stay whose pre-arrival money is still due orders on site.** `orderCollection = 'unavailable'` (an acompte, a solde
    or an installment still due, so the engine would grow it): the shop shows its catalogue read-only, as before this
    amendment, under « Pour ce séjour, les commandes ouvrent à votre arrivée. » / « For this stay, ordering opens on
    arrival. »; the quote and the order answer 409 `ORDERS_OPEN_ON_ARRIVAL` with the same words. *Why:* a solde or an
    installment grown by an order would move a payment link or a plan (D2) the guest never asked for.
69. **Every time offered lies inside the stay, and the server judges it.** The bounds of rules 28, 27bis and 41 are kept
    and pinned for a pre-arrival session, where *now* lies days before the check-in: a delivery or pickup time t has
    check-in ≤ t < check-out (arrival day never before the check-in time, departure day strictly before the check-out
    time); an hourly session starts at or after the check-in and ends at or before the check-out (`hourly-resources`
    `boundsOf`); a breakfast morning is a morning of the stay (the day after each night). The check-in and check-out
    are the reservation's `checkInTime` / `checkOutTime` (filled from the lodging at creation), else 15:00 / 10:00
    (`stayWindow`), read the same by the delivery times, the slots and the window. A time sent outside is refused at the
    quote (`deliverAtUnavailable`, `unavailable` on the session or morning) and at the order (409
    `DELIVERY_TIME_UNAVAILABLE` for a time; `SLOT_TAKEN` or `ITEM_UNAVAILABLE` for a session or a morning, as rule 29
    answers), never moved into the stay. Before the check-in, « Dès que possible » is never offered (`asap: null` while now < check-in): the first time
    is preselected with its day (« ven. 13 nov., 16 h 30 »), and the service banner of rule 42 reads « À partir de votre
    arrivée, le ven. 13 nov. » / « From your arrival, Fri 13 Nov » (pickup alike).
    **Amended 2026-11-10 (Adrien, second message):** the day list the guest picks from holds **only the stay's days**
    (arrival day to departure day): a day that holds no time once presence, service hours and lead are combined (rule 77)
    is shown greyed with its reason (« Service fermé », « Complet ») and cannot be picked; a day before the arrival or
    after the departure is never listed, not even greyed. The nordic bath follows the
    same presence bound with the bath's own hours (rules 78-80).
70. **The J-7 e-mail gives the link and says what the guests can already do.** **Amended 2026-11-10 (Adrien, third
    message):** no word about paying or settling, no app name, no tour of the features: two short sentences and the link.
    The operator script `specs/guest-app-livret/import.mjs`, which already adds the J-2 paragraph (slice I), also adds a
    paragraph to the stored J-7 template (`arrival_reminder_7d`), French in `body`, English in `bodyEn`:
    - FR: `{{#if hasStayAppBath}}Vous pouvez déjà commander ce que vous aimeriez trouver à votre arrivée, et programmer
      votre séance de bain nordique : {{stayAppUrl}}` + blank line + `{{/if}}{{#if hasStayAppShopOnly}}Vous pouvez déjà
      commander ce que vous aimeriez trouver à votre arrivée : {{stayAppUrl}}` + blank line + `{{/if}}`
    - EN: the same two blocks (« You can already order anything you would like to find on arrival, and book your nordic
      bath session: … » / « … on arrival: … »).

    **Implementation note (2026-11-10):** the template renderer's conditionals do not nest (single-level, non-greedy), so the
    nested `{{#if hasStayAppShop}}…{{#if hasStayAppBath}}` first written here could not render; the paragraph is two flat
    blocks and the plugin declares a third flag, **`hasStayAppShopOnly`** « Si boutique Mon séjour sans bain » (`hasStayAppShop`
    and not `hasStayAppBath`). The three flags are offered in the J-7 and the J-2.

    ~~Earlier wording (« Votre séjour a sa petite application, « Mon séjour » … vous le réglerez sur place. »), struck by
    the third message.~~ The paragraph hangs on `hasStayAppShop` only: a stay whose guests cannot order (shop module off,
    nothing sold, `unavailable`, `closed`) gets no paragraph at all, so the sentence never promises something the link
    does not give. The bath clause hangs on **`hasStayAppBath`** (rule 89): it appears only when the stay holds the bath
    (booked on the reservation) or a session is offered to it, never otherwise.
    It goes immediately before « Une question » / « Any question » — at the anchor itself, never at its line start: in
    the J-7 that line opens with the `{{/if}}` of the previous block, and inserting at the line start would put the
    paragraph inside it. A body already holding `{{stayAppUrl}}` is left alone; no anchor → the script stops with
    « ajoutez le paragraphe à la main dans Paramètres › E-mails ». It sends `body` and `bodyEn` only: subject, `enabled`
    and `sendMode` are untouched (`no-automatic-email-without-approval.md`; every template stays manual unless the
    operator chose otherwise). The plugin's flags offered in the J-7 and J-2 (rule 9bis b) gain **`hasStayAppShop`**
    « Si boutique Mon séjour »: true only while `hasStayApp` is, the lodging shows the `shop` module with at least one
    article sold, and `orderCollection` is `arrival` or `departure` when the e-mail is rendered. Plugin inactive, lodging
    out of the app, no guest host, no e-mail address, stay not live → `hasStayApp` false and the paragraph renders
    nothing: never a dead link, never the gate link under the app's words (`stayAppUrl` falls back to it, the paragraph
    does not). The core seed stays neutral (`plugins-phase-p-productisation.md` rule 13). The J-2 paragraph stays.
71. **The arrival SAS names the app's orders it collects.** While the stay holds orders with `collectAt = 'arrival'`,
    status `confirmed` or `delivered`, payment `note`, and its arrival complement is not collected (`complementPaid` and
    `complementPaidCash` 0), the plugin's SAS data (`ctx.sasData`) carries `ordersAtArrival: { orders: [{ id, label,
    lines: [{ label, amountLabel }], deliveryLabel? }], total, totalLabel, changed }`, and its step **« Commandes Mon
    séjour »** (`sas.arrival.steps`, just before the recap) lists them read-only under « Comprises dans le complément
    d'arrivée. »; the recap recalls « Commandes Mon séjour : 18,00 € (dans le complément d'arrivée) ». The step collects
    nothing itself: the recap's single payment does (rule 66), so nothing is billed twice; a card order never appears
    (none exists before the arrival, rule 67). Amounts are the orders' snapshots; when the fiche's lines were lowered
    since (Σ snapshots above the arrival complement), `changed` is true and the step adds « Lignes modifiées depuis la
    commande : le montant à percevoir est celui du récapitulatif. ». The reception runs it (door money,
    `reception-role-checkin-only.md` rule 4): these lines and their amounts, nothing of the stay's other money. No such
    order → no step; plugin inactive → no step, the SAS as today.
    **Amended 2026-11-10 (Adrien, fourth and fifth messages).** The step is the stay's orders taken before the arrival,
    shown as a **collapsible list** under its line « Commandes Mon séjour — 2 commandes · 36,00 € à percevoir »: folded by
    default when every order is paid, unfolded otherwise; each order a group headed by its number, its delivery day and
    time (« ven. 13 nov., 18 h ») and its status chip, then one row per article — label, quantity, unit price, line price
    (« Cidre fermier · 2 × 6,00 € · 12,00 € »; a bath session « Bain nordique · ven. 13 nov. 20 h – 21 h · offerte ·
    + 10,00 € soirée »), then the order's total; under the list, « Total à percevoir » (the unpaid orders) and, when
    any, « Déjà payé par carte » (the paid ones). Every label, figure and caption is the server's
    (`ordersAtArrival.orders[].lines[] = { key, label, quantity, unitLabel, amountLabel, editable, maxQuantity }`,
    `order.{ number, deliveryLabel, statusLabel, paid, totalLabel, editable }`, `toCollectLabel`, `paidLabel`); the client
    folds and unfolds, nothing else. A **paid** order (card, rule 85) is listed read-only with « Payée par carte » and never
    counts in « Total à percevoir »: the SAS never collects it again. An **unpaid** order (`payment = note`, not
    collected) can be edited from the step (rule 87). Orders taken during the stay (`collectAt = 'departure'`) stay out of
    the arrival step. The step reads at 390 px as a single column, rows wrapping the price under the label.
72. **A cancelled stay cancels its orders.** **Amended 2026-11-10 (Adrien, fourth message):** a stay cancelled,
    superseded or deleted ends its sessions (rule 9) and moves every order of it not yet `expired`, `abandoned` or already
    `cancelled` to the new status **`cancelled`** (`cancelledAt`, `cancelReason = 'stay'`), in the plugin's handler of the
    core's `reservation.cancelled / deleted` event (and `updated` when `kind` leaves `reservation`): its held stock is
    released (rules 37ter, 74 — a unit already counted by the arrival sweep returns through the cancellation's count), its
    hourly holds end, it leaves « À préparer » and the planning's « Commande client » cards, it is never prepared nor
    billed, and the guest — whose session is closed by rule 9 — reads it « Annulée » if the stay comes back. Under
    « Toutes » it reads « Séjour annulé ». An unpaid order (note, collected at the arrival) was never collected: nothing to
    refund. A **paid** card order is cancelled too and its money is owed back (rule 88). A card order awaiting its payment
    is cancelled (link left to expire); a payment that still lands follows rule 36 (`paid_conflict`). The order rows and
    their history stay. No push to the guest; the staff's « Commandes clients » channel is not pushed either.
73. **A moved stay keeps its orders, flagged when they fall outside.** The session follows the new dates (rule 9, the
    « dates changed » edge case); a pre-arrival link session whose phase no longer matches dies and the app exchanges
    the link again. The order's lines move with the fiche like any line. An order whose `deliverAt` now lies outside
    [check-in, check-out) is never moved nor re-billed by the plugin: the staff list and its planning card read « Hors
    des dates du séjour : à replanifier », the guest's order « Horaire à revoir avec l'équipe ».
74. **An order taken before the arrival holds its stock until the arrival day.** Rule 37ter counts a reservation's lines
    on its arrival day; an app order with `collectAt = 'arrival'` holds its units (like a card order awaiting payment,
    rule 37quater's « Plus que 2 ») from its confirmation until that day, when the sweep counts the line and the hold
    ends; a cancelled stay releases it. Nothing is counted twice.
75. **The staff reads the day and the payment.** An order whose delivery time is not today names its day in the push
    and on the orders list (« L'Estiva · Marie — 2 × Cidre pour ven. 13 nov. 18 h (à régler à l'arrivée) »); the
    payment words are « à régler à l'arrivée » for `collectAt = 'arrival'`, the rest unchanged (rule 44).
76. **The guest's chips say when the order is paid.** An order with `collectAt = 'arrival'` reads « À régler à
    l'arrivée » while the arrival complement is open, « Sur votre note » once it is deferred to the departure, « Réglée »
    once collected (rule 38's other chips unchanged), built by the server from the stay's stored markers.
    **Amended 2026-11-10:** a card order paid before the arrival reads « Payée » (rule 85); a cancelled order « Annulée »
    (rule 72); an order the team changed at the arrival keeps its chip and adds the line « Modifiée à votre arrivée »
    with its new lines and total (rule 87).

**Added 2026-11-10 (Adrien, second, fourth and fifth messages) — times, the nordic bath, card from J-7, editing at the
arrival.** Everything below is judged by the server; the apps render what it offers.

77. **One judge for an order's times: presence × service × lead.** A delivery or pickup time is offered only when all
    three hold at once (`serviceHours.deliveryTimes`, the only producer): the guest is there (rule 69: arrival day from
    the check-in time, departure day strictly before the check-out time, the days between whole), the shop's service is
    open for the whole preparation interval [t − max(leadMinutes), t] (rules 40-41, exceptions and establishment closures
    included — never during a closing hour), and that interval starts after *now*. The payload is `days: [{ date,
    label, available, reasonLabel?, times: [{ at, label }] }]`, every day of the stay in order, `available: false` with
    its reason when no time is left; the client draws the day chips and the times it is given, never a time it could tap
    that the server did not send. A crafted `deliverAt` outside → refused, never moved (rule 69:
    `deliverAtUnavailable` at the quote, 409 `DELIVERY_TIME_UNAVAILABLE` at the order).
78. **The nordic bath from the app, from J-7: presence × the bath's own hours.** An hourly resource sold in the shop
    (rule 23) is bookable by a pre-arrival or stay session through the slot picker of rule 28. A slot is offered only when
    it lies inside the stay (starts at or after the check-in, ends at or before the check-out — the same bounds as rule
    69) **and** inside the bath's own opening: its `openTime` / `closeTime`, `openDays`, `closedDays`, its
    `minimumUsageMinutes` and `slotDuration` grid (never the shop's service hours, which govern only the ignition of rule
    31). Every day of the stay is in the day list; a day on which the bath is closed or has no slot left reads greyed
    « Fermé » / « Complet » and cannot be picked; outside the stay nothing is listed. The chosen day shows the bath's
    opening as a thin bar of the day (`openingBands: [{ from, to, open }]`, closed hours greyed); taken, heating and
    staff slots are not offered and never drawn (rule 28, §6.4: no other guest's use shows).
79. **A slot is offered only if the bath can be hot by then, counted from now.** For the app, the thermal model of
    `hourly-resources` (`heatUpMinutes` from cold, `heatRetentionMinutes` once warm) is measured **from the present
    moment**, not from the check-in: a slot starting sooner than now + `heatUpMinutes` is `heating` and not offered, unless
    the bath is already warm at its start from a use ending within `heatRetentionMinutes` before it (another stay's
    session, an outside booking, a held order, or a session of the same order taken earlier in time — rule 29). A cold
    slot also needs someone to light it at start − `heatUpMinutes` inside the service hours (rule 31, `staff`). A week
    ahead, the arrival evening is reachable; on the day, at 17 h with a 4 h heat-up, the first cold slot is 21 h. This is
    `hourly-resources`' `heatFrom` (`hourly-resource-quantity-and-sas-scheduling.md` rule 36): the arrival SAS keeps
    max(now, check-in), unchanged.
80. **Other uses of the bath come first, and a crafted slot is refused before anything.** Every guest session of every
    stay, every outside booking (« extérieurs ») and every slot held by an order awaiting payment occupies the bath with
    its turnover (rule 28, capacity `quantity`); a slot they take is not offered. A quote or an order asking a session the
    picker would not offer (taken, heating, staff, closed, past, outside the stay, off the grid, shorter than the minimum)
    is refused first, before any pricing, with one short sentence per reason and nothing written: `unavailable` on the
    session at the quote, 409 `SLOT_TAKEN` (taken) or 409 `SLOT_UNAVAILABLE` « Ce créneau n'est pas proposé. » / « This
    slot is not offered. » (every other reason) at the order. `SLOT_UNAVAILABLE` joins `refusals.js`.
81. **« 1 h offerte » covers the day rate, never the evening supplement.** The free time configured in GuestFlow for the
    stay's lodging (`property_resource_prices.freeMinutes`, granted once per stay — rule 25) is valued at the bath's
    **day rate**: an offered hour placed before `hourlyEveningStart` costs 0 €; placed in the evening it costs the
    evening supplement (evening rate − day rate per hour, `hourly-resources` `eveningSupplement`), shown and billed as
    such; a session straddling the switch owes the supplement of its evening part only. This is the reading the arrival
    SAS already applies (`hourly-resource-quantity-and-sas-scheduling.md` rules 22, 30); `hourlyPricing.priceSessions`
    is aligned on it (that spec's rule 37), so the fiche, the SAS and the app say the same. R36b N4 (« inside the free
    minutes the order is confirmed at 0 € ») holds for the day rate; an offered evening hour is a priced order.
82. **Hours already on the stay are placed first, at no charge.** When the reservation already holds the bath (a sold
    line: hours bought at booking or offered) whose hours are not all on a slot yet (`quantity` − placed hours), the
    bath sheet says « 2 h comprises dans votre séjour, à programmer » / « 2 h included in your stay, to schedule » and the
    sessions the guest picks take those hours first: they add sessions to the line without raising its sold hours (the
    line's quantity becomes max(sold, placed), `hourly-resource-quantity-and-sas-scheduling.md` rule 31), so they cost
    nothing but their evening supplement (rule 81). Beyond those hours, the free minutes left (rule 25), then the
    lodging's price. `midStayOrderCommit.withResource` follows: an order's sessions raise the line's quantity only by
    what they place beyond the hours not yet placed. Such an order needs no payment when its total is 0 € (rule 25,
    « Réserver »).
83. **The evening supplement of an app session is billed once, with its order.** The order's quote and commit carry
    the evening supplement of its sessions, computed by `hourly-resources` (the scheduler's `orderSupplement({ stay,
    sessions, lineGain })`: the evening difference of those sessions minus what the order's line gain already bills
    above the day rate, rule 30 of the hourly spec) as one line of the order « Bain nordique — supplément soirée »,
    written on the fiche by the core commit as a charge tagged with the order (`orderChargeKey = 'guest-order:<id>:evening:
    <resourceId>'`), collected like the rest of the order (card or note). The arrival SAS's recompute of the supplements
    (hourly rule 32) subtracts what such charges already bill (hourly rule 38), so the same evening is never billed twice,
    whether the SAS runs before or after the order, re-opened or not.
84. **Each slot says what it costs this stay, now.** The slot payload's `priceLabel` is the server's reading for one
    slot picked alone after the stay's lines and pending orders: « Compris dans votre séjour » (hours of rule 82),
    « Offert » (free minutes, day), « Offert · + 10,00 € soirée » (free minutes, evening), « 30,00 € », « 40,00 € · tarif
    soirée »; with `band: 'day' | 'evening'` for the gold dot of §6.4. Several picks are priced by the quote, the only
    total (rule 32); the slot labels never add up on the client.
85. **A card order before the arrival is paid at once and never collected again.** At payment (`applyPaidEffect`, rule
    35), an order whose stay is not marked arrived is committed by the core (`midStayOrderCommit.commitOrder` with
    `paid`) on the arrival path of rule 66 — measured on the arrival complement, refused by the same guards — and its
    money is recorded in the same transaction as a **settled order note** of the arrival moment
    (`midStaySettledNotes[]` entry `{ moment: 'arrival', items: [{ key, amount }], total, paidDate, source, ref,
    reference, paidCash: false }`). The engine reads the arrival complement **net of those notes** on every pricing
    (`utils/pricing.js`: `complementAmount` = what the lines route to it − Σ arrival-moment order notes, never below 0), so
    the arrival SAS, its single payment, the ledger, the J-2 and J-1 complement lines and the payment links all read what
    is left to collect, and a later fiche save never raises it back. The note counts once in the money collected
    (`complementBuckets` « réglé en ligne », finance, the notes' per-line collected amounts of `utils/refunds.js`); the
    books take it on its `paidDate` with its basket's VAT lines, exactly as an in-stay card order's note (rule 35), and
    the arrival complement booked at the SAS is the net amount. Once the arrival is marked the order's lines are arrival
    lines like any other (outside the end-of-stay remainder) and their note stays theirs. The order is `paid`, `collectAt
    = 'arrival'`, chip « Payée »; the SAS lists it read-only (rule 71). A payment whose commit is refused (the stay's money
    moved meanwhile, `ORDER_OFF_ARRIVAL_COMPLEMENT` / `ORDER_STAY_PRICE_MOVED`) is `paid_conflict`, recorded « à
    rembourser » as in rule 36.
86. **« Payer par carte » first, preselected, in the same family as the other choice.** For a non-zero total with
    `canPayCard`, the cart's payment choice is one group of two options of the **same component, size and weight**
    (`PaymentChoice`, one radio group): « Payer par carte » / « Pay by card » first and **selected when the cart opens**,
    its row carrying the card mark and the line « Paiement sécurisé, rien à régler sur place » / « Secure payment, nothing
    to settle on site »; « Régler à l'arrivée » (or « Ajouter à ma note ») second. The selected row takes the sapin
    outline and tint every selected control of the app takes; no banner, no badge, no colour or type style the rest of the
    app does not use. The main button follows the choice (« Payer 18,00 € » / « Commander, à régler à l'arrivée »). The
    guest's last choice is not remembered between carts: the card is preselected each time. Without `canPayCard`, the
    group shows the note alone, already selected.
87. **The arrival SAS can change an unpaid order.** From the step of rule 71, an order still unpaid (`payment = note`,
    `collectAt = 'arrival'`, status `confirmed` or `delivered`, arrival complement not collected) can be edited before it
    is collected: an article's quantity (stepper, 1 to the article's bounds of rules 37 and 37quater — `maxQuantity`, stock
    left, persons ceiling), an article removed (quantity 0), a bath session or a breakfast morning removed (moving a
    session stays the « Planifier les ressources » step's job), the whole order removed (« Retirer la commande », with a
    `ConfirmDialog`). Each edit is one request (`POST /api/guest-app/orders/:id/amend`), applied at once through the core
    (`midStayOrderCommit.amendOrder`): the stay's lines lowered by the difference, never below what the stay held without
    the order; re-priced by the engine (free units and minutes return to the allowance, rule 25), measured on the arrival
    complement (rule 66 guards); the order's snapshot and total rewritten; the stock released or taken (rules 37ter, 74,
    raising refused 409 `OUT_OF_STOCK` with what is left); the stay's history « Commande client #12 modifiée à l'arrivée :
    Cidre fermier 4 → 2 (Sophie) »; the order's own `amendmentsJson` entry `{ at, by, changes }`. An order left with no
    line is `cancelled` with `cancelReason = 'sas'`. The step then re-reads the SAS data and the recap's preview. The guest
    sees the new lines and total with « Modifiée à votre arrivée » (rule 76). A **paid** order is read-only: the request
    answers 409 `ORDER_PAID_READ_ONLY` « Commande payée par carte : non modifiable ici. »; an order of another stay, an
    already collected complement or a stay whose arrival is marked → 409 `ORDER_NOT_EDITABLE` « Commande non modifiable. ».
    Roles: the admin and the **reception** (`reception-role-checkin-only.md` rule 4, door money: these lines and their
    amounts only) — the reception only on a stay whose arrival SAS it may run, its arrival day (`reception-sas-today-only.md`),
    otherwise 403 as any reception call outside its scope.
88. **A paid order of a cancelled stay is owed back, never kept.** When a stay with a card-paid order is cancelled
    (rule 72), the order is `cancelled` and its payment is flagged « à rembourser » on its link (`basketJson.refundOwed`,
    `refundCents` = what the order's note collected) with a history entry « Commande client #12 payée 18,00 € : à
    rembourser (séjour annulé) »; « Commandes clients » shows « Payée · à rembourser ». The money is given back by the
    operator through the existing refund of a cancelled stay (`reservation-refunds.md`: D3, booked as any refund on a
    cancelled stay; D15, never above what that line collected — the order's note is that collected money); no automatic
    refund at the provider (§8). The flag clears when refunds on the stay cover the order's notes. The cancellation's own
    retention rules are not changed by this rule.
89. **The J-7 knows whether the stay has a bath to schedule.** The plugin's e-mail flags gain **`hasStayAppBath`** « Si
    bain nordique à programmer », offered in the J-7 and the J-2 beside `hasStayAppShop`: true only while
    `hasStayAppShop` is, the lodging's shop sells an hourly resource (rule 23), and the stay either holds a line of that
    resource with hours (booked on the reservation, bought or offered, rule 82) or has free minutes of it left for the stay
    (« 1 h offerte », rule 25). Neither → false and the bath clause of rule 70 renders nothing.

**Edge cases:**
- Guest scans the La Granja poster while staying at L'Estiva → La Granja's visitor mode; their own stay opens
  from their stay link or the fallback lookup.
- Two devices of the same family → two sessions on the same stay; orders are per
  session, « Mes commandes » shows the stay's orders from every session.
- Reservation dates changed by the operator → the session expiry follows on the next request (re-derived).
- Option archived or unflagged while in a cart → quote returns the line `unavailable`, the cart shows it
  struck through with « Plus disponible », checkout disabled until removed.
- Price changed while in a cart → the quote is the truth; the cart re-renders the new price, no warning
  needed (the total shown before paying is always fresh).
- Qonto disconnected → « Payer maintenant » hidden, « Ajouter à ma note » only.
- Reservation from a platform with no client last name (rare iCal-only stay) → the fallback lookup is
  impossible; the stay link works as for any stay.
- Stay cancelled mid-cart → next request 401, app back to visitor mode, cart cleared — on the device too — and the
  service worker's offline data purged (rules 9, 21).
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
- J-7 e-mail sent by hand at J-9 → the link opens the visitor mode until J-7 00:00, then the pre-arrival session (rule 65).
- Order for the arrival evening placed at J-5, stay paid at booking → on the arrival complement, named in the arrival
  SAS, collected with the arrival payment (rules 66, 71).
- Same order on a stay whose solde is still due → shop read-only « Pour ce séjour, les commandes ouvrent à votre
  arrivée. » (rule 68).
- Arrival day, 13 h, check-in 15 h, arrival SAS not done → the order lands on the arrival complement, no longer refused
  (rule 66).
- Stay cancelled at J-3 with an order collected at the arrival → order `cancelled`, out of « À préparer », stock
  released, nothing collected, nothing to refund (rule 72).
- Stay cancelled at J-3 with a cider order paid by card at J-5 → order `cancelled`, « Payée · à rembourser », the operator
  refunds it from the cancelled stay (rule 88).
- Card order at J-5 → paid at once, « Payée »; the arrival SAS lists it read-only under « Déjà payé par carte » and its
  recap does not collect it (rules 71, 85).
- At the door the guests want 2 ciders, not 4, ordered « à régler à l'arrivée » → the SAS step lowers the line, the recap
  re-reads 12,00 € less, the guest's order reads « Modifiée à votre arrivée » (rule 87).
- Bath with a 4 h heat-up, nothing booked around: ordered at J-5 the arrival day's 19 h slot is offered (the bath can be
  heated before the guests come); ordered the same day at 17 h, the first cold slot is 21 h, but 18 h is offered when
  another stay's session ends at 17 h 30 with 30 min turnover and the retention covers it (rule 79).
- The stay's « 1 h offerte » placed at 20 h with the evening from 19 h → « Offert · + 10,00 € soirée », the order costs
  10,00 € (rule 81); placed at 17 h → « Offert », « Réserver » at 0 € (rule 25).
- The reservation holds 2 h of bath bought at booking, none placed → the app places them at no charge; a third hour is
  priced (rule 82).
- A request sent by hand with a bath session at 03:00, or on the day before the arrival → 409 `SLOT_UNAVAILABLE`, nothing
  priced, nothing written (rule 80).
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
| `plugins/guest-app/` | `manifest.json`, `index.js` | C | Declares the plugin, push channel `guest-orders`, settings, migrations, public + admin mounts, its jobs (`ctx.jobs`: the order expiry every minute, rule 36; the stock's arrival sweep, rule 37ter; the session purge) |
| `plugins/guest-app/routes/` | `public.js` | C | `/public/v1/guest/**` — thin: parse → controller → JSON |
| `plugins/guest-app/routes/` | `admin.js` | C | `/api/guest-app/**` — items, studio, service hours, orders list; admin session guard |
| `plugins/guest-app/middleware/` | `guestSession.js` | C | Reads `gf_guest`, loads the session, re-derives the window, 401 when dead |
| `plugins/guest-app/controllers/` | `sessionController.js` | C | Stay link → stay / pre-arrival / visitor, lodging poster → visitor only, fallback lookup, `/me` payload |
| `plugins/guest-app/controllers/` | `stayLinksController.js` | C | `GET …/reservations/:id/stay-link` (created on first need) and `POST …/regenerate` for the SAS and the fiche; `available` (the SAS payload's switch) and `emailUrl` (the `{{stayAppUrl}}` variable) (rules 1, 9bis) |
| `plugins/guest-app/controllers/` | `bookletController.js` | C | Resolved booklet + search for a session / visitor |
| `plugins/guest-app/controllers/` | `shopController.js` | C | Sellable catalogue for the stay's lodging, slots, delivery slots, quote, create order |
| `plugins/guest-app/controllers/` | `itemsController.js` | C | Read/write `guest_app_items` (the switch + fields shown in GuestFlow's editors and the studio) |
| `plugins/guest-app/controllers/` | `studioController.js` | C | CRUD pages / blocks / media / settings / service hours, publish, QR poster |
| `plugins/guest-app/controllers/` | `ordersController.js` | C | Quote, order, follow-up, abandon (rules 24-38, 41); the order's side of its paid card link (`paid`, rules 35-36) and the expiry pass |
| `plugins/guest-app/controllers/` | `ordersAdminController.js` | C | Orders list, mark delivered, the planning's « Commande client » cards — the `planning.days` server feed (rules 43, 45) |
| `plugins/guest-app/` | `orderLabels.js` | C | Pure: the chips, notices, line labels and the staff push text (rules 38, 44) |
| `plugins/guest-app/controllers/` | `lodgingsController.js` | C | Read/write the per-lodging configuration, validated at the boundary (rules 11bis-11quater) |
| `plugins/guest-app/models/` | `lodgingsModel.js`, `sessionsModel.js`, `staysModel.js`, `itemsModel.js`, `bookletModel.js`, `ordersModel.js`, `mediaModel.js`, `serviceHoursModel.js` | C | DB access (prepared statements). `staysModel.js` holds the only SELECT of a reservation on the session path: rule 8's minimisation is its column list |
| `plugins/guest-app/` | `modules.js` | C | Pure: the modules a lodging shows, from its configuration, the facts and the session's mode (rule 11bis) |
| `plugins/guest-app/` | `settings.js` | C | The declared settings and their checks (§5) |
| `plugins/guest-app/` | `currentStay.js` | C | Pure: lodging + instant → current stay (rules 2, 3, 5, 6) |
| `plugins/guest-app/` | `nameMatch.js` | C | Pure: normalisation + comparison, for the fallback lookup only (rule 7) |
| `plugins/guest-app/models/` | `stayLinksModel.js` | C | The stay links: create on first need, read back for the SAS / e-mails / fiche, regenerate (rule 1); a token that no longer decrypts is replaced like a regeneration |
| `plugins/guest-app/` | `emailContext.js` | C | The plugin's own e-mail variable `{{stayAppUrl}}` « Lien Mon séjour » and condition `hasStayApp` (J-7, J-2): the stay link, else the gate key's link (rule 9bis b) |
| `plugins/guest-app/` | `rateLimiters.js` | C | The plugin's own limits, built with the core's `express-rate-limit`: sessions 30/h/IP, lookup 5/15 min/IP, orders 10/h/session, each `GUEST_*_RATELIMIT_*`-overridable |
| `utils/` | `templateTokens.js` | T | Generic: a plugin's e-mail variable or condition may name its e-mails (`in`), honoured by the editor's chips like the catalogue's (`plugins-phase-1-sdk.md` rule 13) |
| `plugins/guest-app/` | `sellable.js` | C | Pure: which items a lodging's shop shows and their free / included state (rules 23, 25) |
| `plugins/guest-app/` | `serviceHours.js` | C | Pure: open ranges for a date, next opening, delivery slots from now + lead time to check-out, ignition-in-hours check (rules 31, 40-42) |
| `plugins/guest-app/` | `homeHighlight.js` | C | Pure: status line + the single highlight (rules 10, 11) |
| `plugins/guest-app/` | `soliomapFeed.js` | C | Reads Soliomap's `GET /api/activities` (outbound HTTPS, 1 h cache, 5 s timeout; a failure → no card) and picks the stay's suggestion (rule 15bis) |
| `utils/paymentPollRunner.js` · `utils/reservationLedger.js` | — | T | A basket link goes to its owner before the cancelled / missing-stay exits; `refundCents` flags part of a payment « à rembourser » (rules 35, 36) |
| `models/resourceOtherUsesModel.js` | — | T | The fiche save's conflict check reads the live plugins' holds (`coreServices.resourceHolds`) for another stay (rule 35) |
| `middleware/requireAuth.js` · `plugins/sdk/index.js` | — | T | `requireAuth.revalidate` (generic, the session's user re-read) and the `requireAuth` / `securityConfig` core modules (rules 4, 47) |
| `plugins/online-payment/reconciliation/` | `expectedReceipts.js` | T | A paid basket link is one expected receipt for its whole amount (online-payment 1.7.3) |
| `plugins/guest-app/` | `migrations.js` | C | Tables of §5 |
| `plugins/guest-app/models/` | `stockModel.js` | C | The stock of rules 37bis-37ter: held units of the unpaid card orders, a reservation's counts brought to date (idempotent), the restock, the arrival sweep's reads, the low / out alerts due |
| `plugins/guest-app/` | `stock.js` | C | Pure: the editor's « Stock » view and restock line, the shop's `stock`, the quote's `outOfStock`, the editor warning, the push texts (rule 37quater) |
| `plugins/guest-app/controllers/` | `studioSettingsController.js` | C | The studio's lodging switcher read live, the app settings judged together (« À retirer » needs its place), « Synchroniser » (rules 41bis, 48) |
| `plugins/guest-app/` | `gate.js` | C | The gate tile's state and URL, read from `gate-access`'s own e-mail context (rules 12-14) |
| `plugins/guest-app/` | `sun.js` | C | Pure: sunrise / sunset at the estate, `isNight` (§6.1) |
| `plugins/guest-app/` | `webManifest.js` | C | The install manifest (rule 52) |
| `plugins/guest-app/` | `appHosting.js` | C | Serves the guest build on the guest host and the studio build at `/studio` for an admin (caching, SPA fallback, CSP, 503 without a build) — plan step 50 |
| `plugins/sdk/createContext.js` · `registry.js` · `plugins/loader.js` | — | T | `ctx.webApp({ key, path?, host?, handler })` and `mountWebApps` (`plugins-phase-1-sdk.md` rule 48): a web app on the plugin's own host or path, the core's trees kept |
| `utils/` | `publicCatalogProjection.js` | C | `toPublicOption` / `toPublicResource` moved out of `website-booking/publicProjections.js` (which imports them back) so the guest app does not depend on the website plugin |
| `plugins/sdk/createContext.js` · `coreServices.js` | — | T | Three generic SDK hooks: `ctx.resourceScheduler(provider)` (one provider app-wide, like `paymentProvider`), `ctx.resourceHolds(fn)` (a hold may carry the planning's `label`) and `ctx.paymentBasket({ source, paid, labels })` (rules 35-36; `labels` = the owner's refund words); the core exposes `coreServices.resourceScheduler()` and `coreServices.payments` — plugins never `require` each other |
| `plugins/hourly-resources/` | `index.js` | T | Declares the scheduler: `slotsForStay` (occupancy + `buildDays` + `priceSessions`, rule 28), `validateSessions`; reads every holds source as pending occupancy in **every** consumer (planning page, SAS picker, outside bookings) |
| `plugins/gate-access/` | `index.js` | T | `window.js` moves to core `utils/stayWindow.js`; no new hook: the guest app reads the stay's key link from the e-mail context this plugin already declares (`gateAccessUrl`, rules 12-13) |
| `utils/paymentRequestService.js` | — | T | `complement` link type with explicit basket and 30-min lifetime (rule 35) |
| `utils/` | `basketPayments.js` | C | `ctx.core.payments`: mint, read on demand and withdraw a basket's link (rules 33, 35) |
| `models/paymentLinksModel.js` · `utils/ledgerLinks.js` · `utils/reservationLedger.js` | — | T | `basketJson` read and written; a basket link is no bucket's link (stale, settled, the complement row); the ledger row of a basket to refund, in the owner's words (« Commande client à rembourser », else the core's neutral « Paiement en ligne à rembourser », rule 36) |
| `utils/paymentPollRunner.js` | — | T | `applyPaidEffect` `complement` branch → the basket owner's `paid` (`ctx.paymentBasket`) |
| `utils/` | `midStayOrderCommit.js` | C | **Core, generic**: commits a plugin's order lines (options + resource sessions) as mid-stay extras, records a card payment as a settled note `{ source, ref }`, the history entry in the caller's words — one transaction (rules 30, 34, 35). The guest app names its orders « Commande client #N » |
| `utils/` | `stayWindow.js` | C | The stay window, moved from `gate-access/window.js` (rule 2) |
| `plugins/sdk/index.js` | — | T | Add `stayWindow`, `encryption` (SDK 2.26.0), `midStayOrderCommit`, `pricing` free-units helper, `midStayExtrasWindow` to `CORE_MODULES` (one reviewed line each) |
| `index.js` | — | T | `pluginLoader.mountWebApps(app)` before the favicon and the client: the plugin serves its guest app on the guest host and its studio at `/studio`, only while it is live |
| `database.js` | — | T | `payment_links.basketJson` (nullable), through `utils/paymentLinksProviderMigration.js`: the only core column, the link's own basket (rule 35); everything else is in plugin migrations |

New dependency: `qrcode` (server, QR poster + wifi QR) if not already present; `pdfkit` already serves the
devis PDF.

### 4.2 Client side

Two new Vite apps, kept in the plugin's own folder (`server/src/plugins/guest-app/apps/guest/` and `…/apps/studio/`,
2026-11-09: everything the feature needs lives in its plugin). `scripts/build-plugin-packages.mjs` finds any plugin's
`apps/<name>/` (its own `package.json`), never ships its sources, and copies its `dist/` into the package's
`server/assets/<name>` (`specs/plugins-phase-1-sdk.md` rule 48); a build not made is skipped with a warning and that
app answers 503. The release builds every plugin app first. Below, `apps/<name>` is short for that folder. Plus plugin
contributions to the GuestFlow admin client.

**`apps/guest/` — the guest PWA** (React 19, MUI 9 for the modal layer of the sheets only, React Router 8; its own
package and lockfile; `src/theme.js` is the single source of the §6.1 tokens, written as CSS custom properties on the
`.app` root and as the MUI theme; the look itself is `src/styles.css`, the validated review boards v5 ported to a real
viewport — safe areas, `46dvh` hero, rail and two panes from 900 px, content capped at 1200 px from 1200 px; fonts: the
site's own Marcellus 400 and Karla variable woff2 in `public/fonts/` (OFL), preloaded, no request to Google; icons
`lucide-react`, tree-shaken, 1.75 px stroke):

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `src/` | `main.jsx`, `App.jsx` | C | Mount, routes, the `.app` root (register tokens, `wide` / `desk` layout classes, `lang`), the service worker registration and its warm-up |
| `src/` | `theme.js`, `styles.css` | C | Tokens (day / night) and the look |
| `pages/` | `HomePage`, `BookletPages` (index + search + page, two panes from 900 px), `ShopPage`, `SlotPickerPage` (`/boutique/bain/:id`), `CartPage`, `OrdersPages` (`OrdersPage`, `OrderPage` — confirmation, detail, the Qonto return `/commande/:id`), `SoliomapPage` (`/activites`), `LookupPage` (`/retrouver`), `EntryPage` (`/s/:token`, `/l/:code`), `GateScreens` (unknown code, app unavailable) | C | Route-level views |
| `components/` | `AppShell` (tab bar / rail, cart bar, offline pill), `AppBar`, `HeroHeader` (+ the language / day-night pill), `StayCard`, `QuickTile`, `MomentCard`, `PhotoCard`, `Photo`, `BlockRenderer` + `blocks/*` (one renderer per block type, props only), `ProductCard`, `ProductSheet`, `BreakfastSheet`, `QuantityStepper`, `SlotGrid`, `DeliveryTimeChips`, `ServiceHoursBanner`, `CartBar`, `CartBody` (phone page and tablet panel), `PaymentChoice`, `OrderCard`, `OrderTimeline`, `StatusChip`, `Banner`, `EmptyState`, `ErrorAlert`, `Skeleton`, `BottomSheet` (sheet on a phone, centred dialog from 900 px, pull-to-dismiss), `Toast`, `InstallPrompt`, `OfflineBanner`, `Icon` | C | Rendering only — anatomy in §6.4 |
| `services/` | `api.js`, `device.js` | C | `fetch` with the cookie, the envelope → `ApiError`, `?lang=`, one re-exchange on `SESSION_EXPIRED`; what the device keeps (stay link, poster code, language, register, visits, the cart) |
| `hooks/` | `useSession`, `useCart`, `useLineQuote`, `useOrderStatus`, `useLoad`, `useLayout`, `useOnline`, `useActions` | C | UI state: the session and its re-exchange (rules 4, 9), the cart and its quotes (rule 32), the price of one prospective line (§6.5 rule 4), the order poll, the layout of rule 51, the network, what a tile / button opens |
| `utils/` | `format.js` | C | Presentational only: a clock time `HH:MM` or an instant as the guest reads it, the stay card's « 6 → 9 nov. », copy to the clipboard |
| `i18n/` | `index.js`, `fr.json`, `en.json` | C | App chrome strings (booklet content, titles, prices and order words come from the server) |
| `public/` | `sw.js`, `icons/`, `fonts/`, `img/hero-domaine.jpg` | C | Offline shell + booklet (rule 21), install icons (sapin ground, the site's Marcellus « S »), the default lodging photo (the site's home hero). The manifest is the server's `GET /public/v1/guest/manifest.webmanifest` |

Built to `apps/guest/dist` (`npm run build`), checked by `node scripts/check-bundle-budget.mjs --dist
server/src/plugins/guest-app/apps/guest/dist --budget 200000` (151 kB gzip on 2026-11-09). Development: `cd
server/src/plugins/guest-app/apps/guest && GUEST_API=http://localhost:4000 npm start`
(port 5175, `/public/v1/guest` and `/uploads` proxied).

**`apps/studio/` — the booklet studio** (React, MUI using GuestFlow's `client/src/theme.js` and shared components,
read-only through the `@guestflow` alias; the guest app's renderers and styles through `@guest` / `@guest-public`; its
dependencies deduplicated to its own copy, so it tests and builds with its own install only). Base `/studio/`, two
pages: `index.html` (the studio) and `preview.html` (the phone preview, isolated in an iframe so neither app's CSS
reaches the other, rule 49). Development: `STUDIO_API=http://localhost:4000 npm start` (port 5176).

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `ModulesPage`, `LodgingInfoPage`, `BookletPage` (pages list + page editor), `ShopItemsPage` (per lodging); `ServicePage`, `SettingsPage`, `MediaLibraryPage` (shared) | C | Studio screens (rules 47-50) |
| `components/` | `StudioShell`, `StudioPage`, `LodgingSwitcher` (« Hors application » greyed, still selectable), `PagesList`, `PageEditor`, `BlockEditor` + `blockEditors/*` (one per type), `BilingualField`, `MediaDialog`, `MediaPicker`, `PhonePreview`, `RangesEditor`, `SortableList`, `Section`, `ModuleIcon` | C | Editing UI; every screen saves through `PageActionBar` |
| `preview/` | the phone preview entry | C | Draws the guest app's own components from what the studio posts (home, a booklet page, the shop); fetches nothing itself, shows the saved draft and says so |
| `hooks/`, `utils/`, `services/` | `useDirtyGuard`, `useLoad`, `usePreviewLang`; `pageDraft` (only what changed is written; a partial refusal keeps the draft and never creates a block twice), `previewViews`, `richText`; `api.js` (a 401 opens `/login?next=…`) | C | State, drafts, the API |

**`client/` (GuestFlow admin) — only through the plugin's client module `client/src/plugins/guest-app/`:**

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/guest-app/` | `index.js` | C | Contributions: `options.fields`, `resources.fields` (with `section`), `routes` (`/commandes-app`, admin only), `nav.items`, `planning.days` card, `reservation.cards` (« Lien Mon séjour »), `reservation.optionLine` / `resourceLine` (« Stock : épuisé »), `sas.portal`, `settings.integrations` card |
| `plugins/guest-app/` | `guestAppApi.js` | C | Every `/api/guest-app/**` call, the stay link included, through the core's generic `api.pluginRequest` |
| `plugins/guest-app/` | `StayLinkCard.jsx`, `StockLineWarning.jsx` | C | The fiche's « Lien Mon séjour » card (rule 9bis c); the never-blocking stock warning under a line (rule 37quater) |
| `plugins/guest-app/` | `SasStayAppStep.jsx` | C | The SAS « Mon séjour » step (rule 9bis a): the stay link's QR and validity line, the keypad code, Partager / Copier le lien, Régénérer le lien (confirmed first), « QR du portail seul » unfolding the gate step. Contributed to `sas.portal` with `leadsStep: { title: 'Mon séjour' }` |
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | A `sas.portal` contribution with `leadsStep` takes the « Portail » step (and its title) while its plugin's SAS data says `available`; the other contributions are handed to it as `gateStep` (without the keypad code, shown once). Otherwise today's step |
| `plugins/guest-app/` | `SettingsGuestAppSection.jsx` | C | « Application clients » card of Paramètres › Intégrations: the guest host, saved by the page's bar through `PUT /api/guest-app/studio/settings` (rule 58), and « Ouvrir le Studio » |
| `plugins/guest-app/` | `GuestAppItemFields.jsx`, `itemDraft.js`, `GuestAppMediaPicker.jsx` | C | « Application clients » section of the option / resource editor (rule 22) with its Stock group (rule 37bis); a new article shows « Enregistrez d'abord… » so the core row is never created twice |
| `plugins/guest-app/` | `GuestOrdersPage.jsx`, `PlanningOrderCard.jsx`, `planningOrders.js`, `planningOrderTasks.js` | C | Orders list (rule 45, the push deep-link `?order=`) and planning card (rule 43) |
| `pages/options/` | `OptionEditorPanel.jsx`, `ResourceEditorPanel.jsx`, `usePluginFields.js` | T | New contribution point `options.fields`, rendered like `resources.fields`; a `*.fields` contribution with `section: { title }` saves its own rows after the core row, counted by « Enregistrer » and the unsaved guard (an editor with only plugin changes no longer rewrites the core row) — empty when no live plugin contributes |
| `constants/`, `App.jsx`, `api.js`, `utils/navigation.js` | `navMenu.js`, `App.jsx`, `api.js`, `navigation.js` | T | Generic points: `nav.items` (a plugin page at the top level of the side menu), `api.pluginRequest(path, options)`, `/login?next=` (same-origin paths only: no `//`, scheme, backslash or control character, never `/login`) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `DataPageScaffold`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `FormDialog` (admin page + studio) | Studio and admin keep GuestFlow's component library. |
| **Created (new generic, guest app)** | `QuickTile`, `PhotoCard`, `BottomSheet`, `QuantityStepper`, `StatusChip`, `BlockRenderer`, `OrderTimeline` | Generic inside the guest app; `BlockRenderer` is shared with the studio preview. |
| **Specific** | `SlotGrid`, `DeliveryTimeChips`, `PaymentChoice`, `StayCard`, `MomentCard`, `GuestAppItemFields` | Tied to the stay / order flows. |

Why not reuse `client/` for the guest app: different audience, origin, auth and bundle budget (the guest
app must load fast on 3G and be cacheable offline; the admin bundle is several MB).

### 4.3 API contract

Envelope as `public-api.md` §4.3: `{ data }`, and `{ error: { code, message, details? } }`. All guest routes are
same-origin with the guest app (served by GuestFlow on the guest host — no CORS), cookie-authenticated,
never accept the site's shared key. Plugin inactive → every route 404 `PLUGIN_INACTIVE`, in the loader's
shape for every plugin: `{ error: 'PLUGIN_INACTIVE', plugin }`.

| Method | Endpoint | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/public/v1/guest/sessions` | — | `{ stayToken }` or `{ lodgingCode }` | `{ mode: 'stay'\|'preArrival'\|'visitor', lodging:{id,name,slug}, opensAt?, ended? }` + cookie; a `lodgingCode` always opens the visitor mode; unknown → 404 `CODE_NOT_FOUND` (one answer for every unknown, stale, revoked or disabled code) |
| POST | `/public/v1/guest/sessions/lookup` | — | `{ lastName, reservationNumber }` | same; 404 `STAY_NOT_FOUND` generic — a number the core made included (rule 54) |
| GET | `/public/v1/guest/me` | session | — | stay / pre-arrival: `{ mode, appName, guest:{firstName}, lodging, stay:{arrival,departure,partySize,statusLine}, language, isNight, tiles:[{key,label,order, state?, url?, stateLabel?}] (the gate tile carries rule 13's `state`, its `url` once active, « Accès en préparation » before), highlight?.detail (the arrival-day « se prépare » card), suggestion?:{id,name,category,dateLabel,driveLabel,url}, highlight?:{key,text,module,page?} }`; a pre-arrival session on the arrival day, before the window, adds `opensAt` and `openingLine`; visitor: `{ mode, appName, lodging, language, tiles:[…], welcome }` — nothing of any stay (rule 3); dead session 401 `SESSION_EXPIRED` |
| GET | `/public/v1/guest/booklet?lang=` | session or `lodgingCode` | — | `{ version, pages:[{slug,icon,title,cover}] }` |
| GET | `/public/v1/guest/booklet/pages/:slug?lang=` | idem | — | `{ slug, title, cover, blocks:[{type, …}] }` |
| GET | `/public/v1/guest/booklet/search?q=&lang=` | idem | — | `{ results:[{slug,title,excerpt}] }` |
| GET | `/public/v1/guest/lodging` | session or `lodgingCode` | — | `{ name, heroUrl, modules:[{key, label, order}], wifi?:{network, password, note?, joinQr}, contacts:[…], soliomap?:{url, embed} }` (`soliomap` only while the module shows; `embed` = the studio switch « Intégrer dans l'app », rule 15) — only enabled modules / configured facts |
| GET | `/public/v1/guest/gate` | session | — | `{ state:'active'\|'preparing'\|'outside', url? }` — `url` only when `active` (a stay session whose key exists); any other session `outside`; the lodging's gate module off → 404 `MODULE_OFF`; `gate-access` off → 404 `{ error:'PLUGIN_INACTIVE', plugin:'gate-access' }` |
| GET | `/public/v1/guest/shop` | stay or pre-arrival session (visitor → 404 `MODULE_OFF`) | — | `{ open, closedReason?, service (slice C), canPayCard, canPayNote, categories:[{ name, items:[{ kind:'option'\|'breakfast'\|'resource', id, title, shortDescription, imageUrl, price, priceLabel, priceUnitLabel, included?, includedLeft?, freeLeftLabel?, maxQuantity, needsStaff, scheduling?:'hourly', unavailableReason?, stock?:{ soldOut, left, leftLabel } }] }] }` (`stock` only on a tracked article: `left` never below 0, `leftLabel` « Plus que 2 » once `left` ≤ `maxQuantity`, rule 37quater); a `breakfast` item adds `state:'included'\|'sold'`, `defaultTime`, `mornings:[{date,label}]`, `occurrences:[{date,time}]` |
| GET | `/public/v1/guest/shop/resources/:id/slots?from&to` | stay session, `shop` module | — | `{ freeMinutesLeft, freeLabel?, days:[{date, label, slots:[{start, end, state:'free'\|'evening', priceLabel}]}] }` — bookable slots only, days without one dropped; 404 `ITEM_NOT_FOUND` (not a sold hourly item here, or `hourly-resources` inactive), 400 `INVALID_INPUT` |
| POST | `/public/v1/guest/shop/delivery-slots` | stay session | `{ lines:[{kind, id}] }` (1-20) | `{ needed, mode:'delivery'\|'pickup', question (« Quand souhaitez-vous la recevoir ? » / « … la récupérer ? », rule 41bis), asap:{at,label}\|null (null while the service is closed), days:[{date, label, slots:[{at, label}]}], bannerLabel? }`; lead = the longest `leadMinutes` of the cart's staff items |
| POST | `/public/v1/guest/orders/quote` | stay session, `shop` module, shop open | `{ lines:[{kind:'option',id,quantity} \| {kind:'resource',id,sessions:[{date,start,end}]} \| {kind:'breakfast',id,mornings,time,persons}], deliverAt? }` | `{ lines:[{kind, id, title, label, quantity?, sessions?:[{…, unavailable?, reason?, reasonLabel?}], mornings?, unavailableMornings?, unitPrice, total, totalLabel, unavailable?, unavailableReason?, outOfStock?:{left, label}}], total, totalLabel, needsDelivery, deliverAt?, deliverAtUnavailable? }`; 409 `SHOP_CLOSED`, 400 `INVALID_INPUT` / `ORDER_LIMIT` |
| POST | `/public/v1/guest/orders` | idem, 10 / hour / session; optional header `Idempotency-Key` (8-100 of `A-Z a-z 0-9 . _ : -`, else 400): a replay within the session answers the first order's response (a card order's link only while it is live; a paid one `{ orderId, status }`), nothing created again | `{ lines, deliverAt?, payment:'card'\|'note'\|'none', returnPath? }` | card → `{ orderId, paymentUrl }`; note/none → `{ orderId, status:'confirmed' }`; 409 `SLOT_TAKEN` (details `{ quote }`), `OUT_OF_STOCK` (details `{ itemKey:'option:12', left, quote }`), `ITEM_UNAVAILABLE`, `DELIVERY_TIME_UNAVAILABLE`, `SHOP_CLOSED`, `CARD_UNAVAILABLE`, `CARD_ORDER_PENDING` (a card order of the stay still waits for its payment: pay or abandon it first), `ORDER_KEY_SPENT` (a replayed key whose card order is no longer awaiting payment: start again with a new key), `STAY_NOT_WRITABLE`, `PERSONS_EXCEEDED` (rule 55); 400 `ORDER_LIMIT`, `INVALID_INPUT`; 429 (10 / hour / session; 6 card orders / hour / stay, rule 57) |
| POST | `/public/v1/guest/orders/:id/abandon` | idem | — | the order, `abandoned`, with `cartLines`; 409 `ORDER_NOT_PENDING` |
| GET | `/public/v1/guest/orders` | stay session | — | `{ orders:[{id, createdAt, deliverAt, lines, total, payment, status, statusLabel, deliveryLabel?, fulfilment:'delivery'\|'pickup', promise:string\|null, extraPromises?:[string], movedNotice:string\|null, notices?, cartLines?, paymentUrl?}] }` — `paymentUrl` (« Reprendre le paiement ») only on a card order still `awaiting_payment` whose link lives (its 30 minutes); `promise` (rule 41ter) once the order stands (confirmed, paid) and has a `deliverAt`: « Livrée à L'Estiva aujourd'hui vers 17 h 30 » / « Prête aujourd'hui à 17 h 30. Lieu de retrait : … »; `extraPromises` the bath's own lines (« Bain nordique — ven. 9 oct., 20 h, il sera chaud »); `movedNotice` « Votre commande sera prête un peu plus tard que prévu »; `deliveryLabel` « Prévue … » / « Livrée », pickup « Prête … » / « Retirée » |
| GET | `/public/v1/guest/orders/:id` | stay session, the core's `paymentStatusLimiter` | — | one order (an unpaid card order reads its link at the provider, like `/booking-requests/:id/status`, at most once per 10 s per link) |
| GET | `/public/v1/guest/manifest.webmanifest` | — | — | manifest with the plugin's app name (rule 52), `application/manifest+json`, `Cache-Control: no-cache` |
| GET | `/api/guest-app/items` | admin | — | every option and resource: `{ kind, id, title, priceType, category?, archived?, sellable:{ok, reason}, sold, mediaId, shortDescriptionFr, shortDescriptionEn, maxQuantity, needsStaff, leadMinutes, stockable, stock:{ tracked, quantity, quantityLabel (« −2 »), held, heldLabel, left, alertBelow, soldOut, out, restockLine (« Stock réglé à 24 — Sophie, 6 nov. 14:02 ») } }` |
| GET | `/api/guest-app/items?propertyId=` | admin | — | the studio's Boutique: only the options and resources linked to that lodging, each with that lodging's `price`, `priceLabel` (« 4,50 € », « Inclus (0 €) ») and `priceUnitLabel` (rule 50) |
| GET | `/api/guest-app/stock` | admin, reception | — | `{ items:[{ kind, id, title, quantity, held, left, soldOut, out, label:'Stock : épuisé'\|'Stock : 3' }] }` — the tracked articles, for the reservation editor's warning (rule 37quater), never a refusal |
| GET/PUT | `/api/guest-app/items/:kind/:id` | admin | `{ sold?, mediaId?, shortDescriptionFr?, shortDescriptionEn?, maxQuantity?, needsStaff?, leadMinutes?, stockTracked?, stockQuantity? (0-100 000, a restock), stockAlertBelow?, soldOut? }` (only the keys sent are written; unknown keys refused) | the item view; 400 on a description over 140 characters, `maxQuantity` outside 1-50, `leadMinutes` outside 0-240, an unknown `mediaId`; 400 `NOT_SELLABLE` + the reason for `sold:true` on a type rule 23 excludes; `needsStaff` always false for a resource; 400 `NO_STOCK` for a stock on an hourly resource or the breakfast; 400 « Quantité en stock requise. » for tracking without a count |
| GET | `/api/guest-app/studio/lodgings` | admin | — | `{ lodgings:[{ propertyId, name, enabled, hasLodgingCode, stateLabel:'Hors application'\|null }] }` — every GuestFlow property, by name as GuestFlow lists them, read live (rule 48) |
| GET/PUT | `/api/guest-app/studio/settings` | admin | PUT any of `{ appName, guestHost, soliomapUrl, soliomapEmbed (boolean), maxOrderTotal, fulfilment:'delivery'\|'pickup', pickupPlace (≤ 200) }` | `{ appName, guestHost, soliomapUrl, soliomapEmbed, maxOrderTotal, fulfilment, pickupPlace, soliomap:{ syncedAt, syncedLabel (« Synchronisé il y a 2 min »), ok, count } }`; 400 on an unknown key, a key its own check refuses, « À retirer » without a place, `{ error, field:'guestHost' }` on GuestFlow's own address (rule 58) — the only write path of `guestHost`, also used by Paramètres › Intégrations |
| POST | `/api/guest-app/studio/soliomap/sync` | admin | — | the `soliomap` sync state after reading the feed again now; 409 without a Soliomap address (rule 48) |
| GET/PUT | `/api/guest-app/lodgings/:propertyId` | admin | `{ enabled, heroMediaId, modules:[{key, on, order}], wifi:{available, network, password, note}, contacts:[{name, role?, phone?, whatsapp?, email?}] }` — a PUT writes the keys it names, an unknown key (`displayName` included: the name is GuestFlow's, rule 48) refused; a `wifi` without `password` keeps the stored one, `''` clears it | the lodging config with `hasLodgingCode`, never the code itself (rules 11bis-11quater) |
| POST | `/api/guest-app/studio/pages/:id/duplicate` | admin | `{ toPropertyId }` | the new independent page |
| PUT | `/api/guest-app/studio/lodgings/:propertyId/booklet` | admin | `{ pages:[{pageId, sortOrder, published}] }` | that lodging's page order and visibility |
| GET/PUT | `/api/guest-app/service-hours[?propertyId=]` | admin | PUT `{ weekly:{0..6 (0 = Sunday):[{from,to}]}, exceptions:[{date, closed:true} \| {date, ranges:[{from,to}]}] }` (both keys required, the whole configuration replaced) | `{ propertyId, shared, weekly, exceptions }`; 400 on more than 3 ranges, a bad `HH:MM`, start ≥ end, an overlap, a duplicate date, a closed exception with ranges |
| GET/PUT | `/api/guest-app/studio/lodgings/:id/booklet` | admin | PUT `{ pages:[{pageId, sortOrder, published}] }` (every page once) | the lodging's pages with `sharedWith`, `placeholder`, `blockCount`, plus `version`, `upToDate`, `untranslated` |
| GET | `/api/guest-app/studio/lodgings/:id/preview?lang=` · `…/search?q=` | admin | — | the lodging's draft resolved like the guest's · search results |
| POST | `/api/guest-app/studio/lodgings/:id/publish` | admin | — | `{ versions:[{propertyId, id, publishedAt}] }` (a shared page is patched into the other lodgings' latest version, rule 48) |
| POST/GET/PUT/DELETE | `/api/guest-app/studio/lodgings/:id/pages`, `…/studio/pages/:id` | admin | `{ slug, title:{fr,en?}, icon?, coverMediaId? }` | the page; slug unique within one lodging's booklet |
| POST/DELETE | `…/studio/pages/:id/placements[/:propertyId]`, `…/pages/:id/duplicate` | admin | `{ propertyId }` · `{ toPropertyId }` | share / unshare (409 on the last placement) · independent copy (blocks the target would see, `-2` on a slug clash) |
| POST/PUT/DELETE | `…/studio/pages/:id/blocks`, `…/pages/:id/blocks/order`, `…/studio/blocks/:id` | admin | `{ type, data, onlyForPropertyIds? }` · `{ blockIds }` | the block, validated per type (rule 18), rich text sanitised |
| GET/POST/PUT | `/api/guest-app/studio/media[/:id]` | admin | multipart `file` (JPG / PNG / WEBP, ≤ 10 MB, ≤ 50 MP) + `altFr`, `altEn` | `{ id, url, sizes:{1600,800,400}, width, height, alt }` (WebP, never enlarged) |
| POST | `/api/guest-app/lodgings/:propertyId/regenerate-qr` | admin | — | the lodging view (never the code); the old code dies at once, its live visitor sessions survive; 409 if the lodging is off |
| GET | `/api/guest-app/reservations/:id/stay-link` | admin, reception | — | `{ url, qrDataUri, createdAt, validUntil, validUntilLabel }` (« Le lien vaut jusqu’au lun. 9 nov., 12 h. », the window's end), created on first need, `no-store`; 404 unknown reservation, 409 not a live reservation, lodging off or guest host not set (rules 1, 9bis) |
| POST | `/api/guest-app/reservations/:id/stay-link/regenerate` | admin, reception | — | the new link, same shape; the old link, every session opened from it and every lookup session of the stay die at once (rule 54); same 404 / 409 |
| GET | `/api/guest-app/lodgings/:propertyId/qr-poster.pdf` | admin | — | A4 PDF of `https://<guestHost>/l/<code>`; 409 if the lodging is off or the guest host is not set |
| GET | `/api/guest-app/orders?status=todo\|all` | admin (reception 403, rule 45) | — | `{ orders:[{ id, reservationId, lodging, guest, lines:[{label,total,totalLabel}], deliverAt, deliverLabel, payment, paymentLabel, status, statusLabel, total, totalLabel, canMarkDelivered }] }` by delivery time, each row also `fulfilment`, `fulfilmentLabel` (« Livraison au logement » / « À retirer »), `markLabel` (« Marquer livrée » / « Marquer retirée »), `pickupPlace?`, a delivered pickup's `statusLabel` « Retirée », a pickup's `deliverLabel` « À retirer ven. 9 oct., 18 h »; `todo` (default) = on the fiche, not delivered; `all` = the last 30 days (rule 45) |
| POST | `/api/guest-app/orders/:id/delivered` | admin, reception | — | `{ status:'delivered' }` (twice is once); 409 `ORDER_NOT_DELIVERABLE`, 404 |
| GET | `/api/guest-app/planning/order-cards?from&to` | admin, reception | — | `{ days:[{ date, cards:[{ orderId, reservationId, time, timeLabel (pickup: « À retirer 18 h »), lodging, guest, lines, paymentLabel, delivered, fulfilment, doneLabel:'Livrée'\|'Retirée' }] }] }` — the staff-prepared lines only (rule 43) |

A stay session only (`mode = 'stay'`, else 403 `STAY_REQUIRED`) reaches the slots, the delivery times, the quote, the
orders and an order's page or abandon; a pre-arrival session reads `/shop` read-only (rule 27).

Rate limits: sessions 30/h/IP, lookup 5/15 min/IP, orders 10/h/session, card orders 6/h/stay (rule 57),
reads under the existing `publicApiLimiter` budget. Every refusal answers in the request's language (rule 56).

**The two apps' pages** (plan step 50, through `ctx.webApp`): on the guest host, every path but `/api`, `/public`,
`/uploads` and `/plugin-assets` is the guest app — a file of its build, else its `index.html` (`/`, `/s/<token>`,
`/l/<code>`, `/retrouver`, `/commande/<id>`, `/livret/…`); a missing file with an extension is a 404. `/assets/*` is
`Cache-Control: public, max-age=31536000, immutable`, `index.html`, `sw.js` and `manifest.webmanifest` `no-cache`,
the rest a day. Policy: `default-src 'self'`, styles `'self' 'unsafe-inline'` (MUI), images `'self' data: blob:`,
`frame-src` the Soliomap origin only while « Intégrer dans l'app » is on, else `'none'`, `frame-ancestors 'none'`. The
studio is the same at `/studio` on any other host, for an admin session: none → 302 `/login?next=/studio…`, another role
→ 403. No build → 503 « Application indisponible ».

### 4.4 Amendment 2026-11-10 — « Mon séjour » from J-7 (rules 65-89)

> Fat backend, thin frontend: where an order is collected, the guards, the times, the labels, the chips and the SAS
> block are the server's. The apps render `orderCollection`, `noteLabel`, `canPayCard`, the banners and the chips.
> Plugin-specific behaviour stays in `guest-app`; the core gains only generic behaviour of its order commit (PR target
> `inte/plugins`). SDK stays **2.26.0** (unreleased: additions recorded on it); `guest-app` **1.0.2 → 1.1.0**;
> `hourly-resources` **1.5.2 → 1.6.0** (rules 79, 81, 83: `heatFrom`, free minutes at the day rate, the order's evening
> supplement, `hourly-resource-quantity-and-sas-scheduling.md` rules 36-38); `accounting-export` **1.2.2 → 1.2.3** only if
> its note reader needs the `moment` field (rule 85 — the coder checks first, a note already books on its `paidDate`);
> `sas`, `online-payment` and `gate-access` unchanged.
>
> Tables below: the first block is rules 65-76 as first written; the **« Added the same day »** rows cover rules 77-89 and
> the amended 66, 67, 69, 70, 71, 72, 76.

**Server — core (`server/src/`)**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `midStayOrderCommit.js` | T | `orderCollection(reservationId)` (rule 67); `priceOrder` / `commitOrder` measure an order before the arrival on the arrival complement (per-key line totals), refuse `ORDER_OFF_ARRIVAL_COMPLEMENT`, `ORDER_STAY_PRICE_MOVED`, ~~`ORDER_PAID_BEFORE_ARRIVAL`~~ (retired, rule 85) (rule 66), answer `collectAt` |
| `utils/` | `pricing.js` | T | Return `preArrivalSettled` on the engine's result (additive field, read by `orderCollection`); no arithmetic changes |
| `models/` | `reservationsModel.js` | — | Read only: `isArrivalNotMarked` (exists) |
| `tests/` | `mid-stay-order-before-arrival.unit.test.js` | C | Rule 66-67 core cases (§7) |
| `utils/` | `midStayOrderCommit.js` | T | *Added the same day.* `commitOrder` with `paid` before the arrival: rule 66's measure, then the arrival-moment order note (rule 85), `ORDER_PAID_BEFORE_ARRIVAL` retired; `withResource` raises the sold hours only beyond the hours not yet placed (rule 82); order **charges** `{ kind: 'charge', key, label, amount }` written as custom lines tagged `orderChargeKey` (rule 83); `amendOrder(reservationId, { source, ref, history, from, to })` lowers / raises / removes an order's lines on the fiche, measured as rule 66, in one transaction with the plugin's `within` (rule 87) |
| `utils/` | `pricing.js` | T | *Added.* The arrival complement net of the arrival-moment order notes, on every pricing, never below 0 (rule 85); answered as `arrivalPrepaidByOrders` beside `complementAmount` |
| `models/` | `reservationsModel.js` | T | *Added.* `settleOrderNoteBeforeArrival(id, { items, paidDate, source, ref, reference })` writes the `moment: 'arrival'` note (no end-of-stay detail touched); `settleMidStayNote` unchanged |
| `utils/` | `complementBuckets.js`, `refunds.js`, `stayMoney.js` | T | *Added.* An arrival-moment note counts once: in the money collected online, as its lines' collected amount (D15), never inside the arrival complement (rule 85) |
| `database.js` | — | — | No core column: the note is a JSON entry of `midStaySettledNotes`; `reservation_custom_options.orderChargeKey TEXT NULL` added idempotently (rule 83) |
| `tests/` | `guest-order-card-before-arrival.unit.test.js`, `guest-order-amend.unit.test.js`, `guest-order-charges.unit.test.js` | C | Rules 82, 83, 85, 87 core cases (§7) |

**Server — plugin `guest-app` (`server/src/plugins/guest-app/`)**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | `manifest.json` | T | 1.1.0, changelog FR entry, surfaces gain « L'étape « Commandes Mon séjour » du sas d'arrivée » |
| — | `modules.js` | T | `bath` and `orders` open to `preArrival` (rule 65); `gate` stays `stay` only |
| `middleware/` | `guestSession.js` | T | `requireStay` → `requireStayGuest` (`stay` or `preArrival`) on slots, delivery slots, quote, orders, list, one order, abandon; `/gate` keeps `stay` only |
| `controllers/` | `shopController.js` | T | `shopState` opens for `preArrival` per `orderCollection`; payload `orderCollection`, `noteLabel`, ~~`canPayCard` false before the arrival~~ (card from J-7, rule 67), `preArrivalBanner`, `closedReason` `ordersOpenOnArrival` (rules 65-69) |
| — | `serviceHours.js` | T | `asap` null while now < check-in; banner « À partir de votre arrivée, le … » before the check-in (rule 69) |
| `controllers/` | `ordersController.js` | T | ~~Refuse card before the arrival (`CARD_AFTER_ARRIVAL`)~~ (retired, rule 67), `ORDERS_OPEN_ON_ARRIVAL`; map the core's three new refusals; store `collectAt`; order view chips (rule 76) and « Horaire à revoir avec l'équipe » (rule 73) |
| — | `refusals.js` | T | FR / EN words of ~~`CARD_AFTER_ARRIVAL`~~ (retired), `ORDERS_OPEN_ON_ARRIVAL`, `ORDER_OFF_ARRIVAL_COMPLEMENT` / `ORDER_STAY_PRICE_MOVED` (both « Cette commande ne peut pas être prise en ligne pour ce séjour : contactez l'équipe. ») |
| — | `orderLabels.js` | T | Chips of rule 76; push and list name the day when not today, « à régler à l'arrivée » (rule 75) |
| `models/` | `ordersModel.js` | T | `collectAt` read/written; `listForStaff` / `deliveriesBetween` drop orders of a stay no longer `kind = 'reservation'` from « À préparer » and the planning (rule 72); `atArrivalFor(reservationId)` for the SAS block |
| `controllers/` | `ordersAdminController.js` | T | Row and card flags `stayCancelled` (« Séjour annulé »), `outsideStay` (« Hors des dates du séjour : à replanifier ») (rules 72-73) |
| `models/` | `stockModel.js` | T | Held units also count `collectAt = 'arrival'` orders of a live stay whose arrival day is not reached (rule 74) |
| — | `emailContext.js` | T | Flag `hasStayAppShop` « Si boutique Mon séjour », scope J-7 / J-2 (rule 70) |
| — | `index.js` | T | `ctx.sasData` adds `ordersAtArrival` (rule 71); the e-mail provider passes the shop state for `hasStayAppShop` |
| — | `migrations.js` | T | `guest_app_orders_collect_at_v2`: `ALTER TABLE guest_orders ADD COLUMN collectAt TEXT NOT NULL DEFAULT 'departure'` (existing rows were all collected at the departure or by card) |
| `tests/` | see §7 | C | One file per subject |
| `controllers/` | `shopController.js` | T | *Added.* `canPayCard` from J-7 (rule 67); slot payload per rule 84 (`priceLabel`, `band`, `includedHoursLeft`); delivery days of the stay only (rules 69, 77); slots asked with `heatFrom = now` (rule 79) |
| — | `serviceHours.js` | T | *Added.* `deliveryTimes` the single judge of rule 77, days without a time dropped |
| `controllers/` | `ordersController.js` | T | *Added.* `CARD_AFTER_ARRIVAL` removed; quote and order carry the bath's evening charge from the scheduler (rule 83); crafted sessions refused first `SLOT_UNAVAILABLE` (rule 80); sold hours placed first (rule 82) |
| `controllers/` | `ordersAdminController.js` | T | *Added.* `POST /api/guest-app/orders/:id/amend` (rule 87): role and scope (admin; reception on its arrival day), paid → 409 `ORDER_PAID_READ_ONLY`, not editable → 409 `ORDER_NOT_EDITABLE`; answers the order and the fresh `ordersAtArrival` |
| `models/` | `ordersModel.js` | T | *Added.* `cancelled` status, `cancelForStay(reservationId)` (rule 72), `amend(id, …)` writes the snapshot, total and `amendmentsJson` (rule 87); `atArrivalFor` returns every pre-arrival order with lines, quantities, unit and line prices, `editable`, `paid` (rule 71) |
| — | `index.js` | T | *Added.* `reservation.cancelled / deleted / updated(kind)` → `cancelForStay`, stock and holds released, paid orders flagged à rembourser (rules 72, 88); `ordersAtArrival` per rule 71 amended; mail flag `hasStayAppBath` (rule 89) |
| — | `emailContext.js` | T | *Added.* `hasStayAppBath` « Si bain nordique à programmer » (rule 89) |
| `models/` | `stockModel.js` | T | *Added.* An order amended or cancelled moves its hold / count by the difference (rules 72, 87) |
| — | `orderLabels.js` | T | *Added.* Chips « Payée » (before arrival), « Annulée », « Modifiée à votre arrivée », « Payée · à rembourser » on a cancelled stay; SAS line labels « 2 × 6,00 € · 12,00 € » (rules 71, 76, 88) |
| — | `refusals.js` | T | *Added.* FR / EN `SLOT_UNAVAILABLE`; `CARD_AFTER_ARRIVAL` removed |
| — | `migrations.js` | T | *Added.* `guest_app_orders_status_v3`: rebuild of `guest_orders` (status CHECK + `cancelled`; `cancelledAt`, `cancelReason`, `amendmentsJson`), rows copied, indexes recreated, in one transaction (§5) |

**Server — plugin `hourly-resources` (`server/src/plugins/hourly-resources/`)** *(added the same day)*

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | `availability.js` | T | `buildDays` / `validateBlock` / `classifyBlock` accept `heatFrom` (absolute minutes, default `notBefore`): the cold path is `start ≥ heatFrom + heatUp` (rule 79; hourly rule 36) |
| — | `scheduler.js` | T | `slotsForStay` / `validateSessions` take `heatFrom` (the guest app passes now); `slotsForStay` answers per slot `band` and the price of rule 84 given `freeMinutesLeft` and `includedHoursLeft`; new `orderSupplement({ stay, sessions, lineGain })` (rule 83) |
| — | `hourlyPricing.js` | T | `priceSessions`: the free minutes valued at the day rate (rule 81; hourly rule 37) |
| — | `schedulingModel.js` | T | `supplementsFor` subtracts the evening charges orders already wrote (`orderChargeKey … :evening:<resourceId>`, rule 83; hourly rule 38) |
| — | `manifest.json` | T | 1.6.0, FR changelog entry |
| `tests/` | `hourly-heat-from-now.unit.test.js`, `hourly-free-minutes-day-rate.unit.test.js`, `hourly-order-supplement.unit.test.js` | C | §7 |

**Client — guest app (`server/src/plugins/guest-app/apps/guest/src/`)**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ShopPage.jsx` | T | « Ajouter » enabled for a pre-arrival session when the shop is open; the server's `preArrivalBanner` / `closedReason` |
| `components/` | `CartBody.jsx`, `PaymentChoice.jsx` | T | The note button's label is `noteLabel`; « Payer maintenant » only when `canPayCard`; the `cart.preArrival` reason only when the shop is closed. *Added:* rule 86 — one radio group, card first and preselected on every cart, same row component for both choices, main button label follows the choice |
| `components/` | `SlotGrid.jsx`, `DeliveryTimeChips.jsx` | T | *Added.* Render the server's days and times only (rules 77-80), `priceLabel` and the evening dot from `band` (rule 84); « 2 h comprises dans votre séjour, à programmer » from the payload (rule 82) |
| `components/` | `StatusChip.jsx`, `OrderCard.jsx` | T | *Added.* « Annulée », « Payée », « Modifiée à votre arrivée » as sent (rules 72, 76, 87) |
| `components/` | `ProductSheet.jsx`, `BreakfastSheet.jsx` | T | `readOnly` follows `shop.open`, no longer `me.mode` |
| `pages/` | `HomePage.jsx`, app shell tabs | T | « Commandes » tab and « Commandes en cours » row for a pre-arrival session (module list from `/lodging`, as today) |
| `i18n/` | `fr.json`, `en.json` | T | Only the strings the client owns (none of the server's labels) |
| `__tests__/` | see §7 | C | One file per subject |

**Client — GuestFlow admin (`client/src/plugins/guest-app/`)**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | `SasArrivalOrdersStep.jsx` | C | Specific (one feature): the « Commandes Mon séjour » SAS step from `pluginData['guest-app'].ordersAtArrival`; `recapNotes` (rule 71). *Amended:* the collapsible list (one `Collapse` per order under a summary line), rows label / quantity × unit / line price, totals « Total à percevoir » and « Déjà payé par carte »; for an editable order a `QuantityStepper`-style stepper per line (the core client's, 44 px targets), « Retirer » per line and « Retirer la commande » through the existing `ConfirmDialog`; each gesture posts `amend`, then re-reads the SAS data and the recap preview (rule 87). Reuses `SummaryItem`, `ConfirmDialog`, `ErrorAlert`; no new generic component (the list is one feature's) |
| — | `guestAppApi.js` | T | *Added.* `amendOrder(id, { lines })` |
| — | `index.js` | T | Contributes `sas.arrival.steps` `{ key: 'stay-app-orders', title: 'Commandes Mon séjour', isShown }` |
| — | `GuestOrdersPage.jsx`, `PlanningOrderCard.jsx` | T | Render the server's `stayCancelled` / `outsideStay` captions and the payment words |
| `__tests__/` | see §7 | C | One file per subject |

**Operator script**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `specs/guest-app-livret/` | `import.mjs` | T | Adds the J-7 paragraph (rule 70 as amended: `hasStayAppShop` / `hasStayAppBath`, no payment words, no app name) beside the J-2 one, inserted at the anchor; PUT `{ body, bodyEn }` only; `--dry-run` says what it would do |

**API contract — additions** (envelope and codes as §4.3)

| Method | Endpoint | Change |
|---|---|---|
| GET | `/public/v1/guest/shop` | stay **or pre-arrival** session: `+ orderCollection: 'arrival'\|'departure'\|'unavailable'\|'closed'`, `+ noteLabel`, `+ preArrivalBanner?`; `closedReason` may read « Pour ce séjour, les commandes ouvrent à votre arrivée. »; ~~`canPayCard` false before the arrival~~ (amended, rule 67) |
| GET | `/public/v1/guest/shop/resources/:id/slots` · POST `/shop/delivery-slots` | open to a pre-arrival session; `asap: null` before the check-in |
| POST | `/public/v1/guest/orders/quote` · `/orders` · `/orders/:id/abandon` · GET `/orders` · `/orders/:id` | open to a pre-arrival session; new 409 ~~`CARD_AFTER_ARRIVAL`~~ (retired), `ORDERS_OPEN_ON_ARRIVAL`, `ORDER_OFF_ARRIVAL_COMPLEMENT`, `ORDER_STAY_PRICE_MOVED`; the order view `+ collectAt`, its `statusLabel` per rule 76 |
| GET | `/api/guest-app/orders` · `/api/guest-app/planning/order-cards` | rows / cards `+ stayCancelled`, `+ outsideStay` (with their captions); cancelled stays out of « À préparer » and the cards |
| GET | `/api/reservations/:id/sas` (core, unchanged route) | `pluginData['guest-app'] + ordersAtArrival` (rule 71), served to the reception unchanged |
| core | `midStayOrderCommit` | `+ orderCollection(reservationId)`; `priceOrder` / `commitOrder` answer `collectAt` and the new 409 (`ORDER_OFF_ARRIVAL_COMPLEMENT`, `ORDER_STAY_PRICE_MOVED`) |
| GET | `/public/v1/guest/shop` *(added the same day)* | `canPayCard` true from J-7 when the provider is live (rule 67); `CARD_AFTER_ARRIVAL` no longer answered by any route |
| GET | `/public/v1/guest/shop/resources/:id/slots` | `+ includedHoursLeft`, `+ includedLabel?`; days `{ date, label, available, reasonLabel?, openingBands, slots }`, slots `{ start, end, state, band: 'day'\|'evening', priceLabel }` per rule 84; every day of the stay, closed ones `available: false`; heat-up from now (rules 78-80) |
| POST | `/public/v1/guest/shop/delivery-slots` | `days: [{ date, label, available, reasonLabel?, times: [{ at, label }] }]`, every day of the stay, none outside (rule 77) |
| POST | `/public/v1/guest/orders/quote` · `/orders` | lines may answer the bath's charge `{ kind: 'charge', label: 'Bain nordique — supplément soirée', amountLabel }` (rule 83); 409 `SLOT_UNAVAILABLE` (rule 80); card before the arrival accepted (rule 85) |
| GET | `/public/v1/guest/orders` · `/orders/:id` | `status` may read `cancelled`; `amendedLabel?` « Modifiée à votre arrivée »; chips per rule 76 amended |
| POST | `/api/guest-app/orders/:id/amend` (admin, reception on its arrival day) | body `{ lines: [{ key, quantity }], removeSessions?: [{ resourceId, date, start }], removeMornings?: [{ date }], removeOrder?: true }` → 200 `{ order, ordersAtArrival }`; 409 `ORDER_PAID_READ_ONLY`, `ORDER_NOT_EDITABLE`, `OUT_OF_STOCK { itemKey, left }`, `ORDER_PERSONS_EXCEEDED`, rule 66's two; 403 outside the role's scope; 400 `INVALID_INPUT` (each quantity a whole number 0..the article's bound, a key the order holds) |
| GET | `/api/reservations/:id/sas` | `pluginData['guest-app'].ordersAtArrival = { orders: [{ id, number, deliveryLabel, statusLabel, paid, editable, totalLabel, lines: [{ key, label, quantity, unitLabel, amountLabel, editable, maxQuantity }] }], toCollect, toCollectLabel, paid, paidLabel, changed }` (rule 71 amended) |
| core | `midStayOrderCommit` | `+ amendOrder`; `commitOrder` with `paid` before the arrival (rule 85); `charge` lines (rule 83) |
| core | `ctx.resourceScheduler` (SDK 2.26.0, unreleased) | `slotsForStay` / `validateSessions` `+ heatFrom`; `+ orderSupplement` |

---

## 5. Data model

**Core columns** *(one until 2026-11-10; `reservation_custom_options.orderChargeKey` added by rule 83, below)*: `payment_links.basketJson` (`{ source, ref, refundOwed?, refundCents? }` — `refundCents`: only
that part of the payment is owed back, rule 35), the basket a `complement` link
bills (rule 35). Everything below is created by the `guest-app` plugin's migrations:

- `guest_app_lodgings(propertyId PK, enabled INTEGER DEFAULT 0, lodgingCode TEXT UNIQUE,
  heroMediaId, modulesJson, wifiAvailable INTEGER DEFAULT 0, wifiNetwork, wifiPasswordEncrypted, wifiNote,
  contactsJson, bookletSeededAt)` — the per-lodging configuration (rules 11bis-11quater). No name: it is GuestFlow's (rule
  48); the `displayName` lot A wrote is gone from the v1 migration, which never shipped. The QR code is generated when a
  lodging is enabled, never logged. The wifi password is encrypted at rest like the other stored secrets
  (`settingsModel` encryption helper) — it is shown to guests, but must not sit in clear in a backup.
- `guest_app_items(kind 'option'|'resource', itemId, sold INTEGER DEFAULT 0, mediaId, shortDescriptionFr,
  shortDescriptionEn, maxQuantity DEFAULT 10, needsStaff INTEGER DEFAULT 0, leadMinutes DEFAULT 30,
  sortOrder, stockTracked INTEGER DEFAULT 0, stockQuantity INTEGER NULL, stockSetQuantity INTEGER NULL (the count typed at
  the last restock, for its history line), stockSetAt, stockSetBy, stockAlertBelow NULL,
  soldOut INTEGER DEFAULT 0, stockLowPushedAt, stockOutPushedAt, PRIMARY KEY(kind,itemId))` — the sell switch, its
  presentation and the stock (rules 22, 37bis, 39); the two `…PushedAt` keep rule 37quater's pushes to once each until
  the next restock clears them. `stockQuantity` is what is left now: set at a restock, lowered and raised by the counts of rule 37ter.
- `guest_app_stock_counts(reservationId, kind, itemId, quantity, PRIMARY KEY(reservationId,kind,itemId))` — what
  rule 37ter has already taken from the stock for each reservation (a later event moves the stock by the difference). Default
  `sold = 0`: nothing is sold until the operator flags it.
- `guest_app_service_hours(weekday 0-6, fromTime, toTime, propertyId NULL)` and
  `guest_app_service_exceptions(date, propertyId NULL, closed, rangesJson)` (rule 40).
- `guest_sessions(id, tokenHash UNIQUE, propertyId, reservationId NULL, mode, origin 'link'|'poster'|'lookup',
  stayLinkId, createdAt, lastSeenAt, expiresAt)` — purged 30 days after
  expiry. `reservationId` is NULL for a visitor session (rule 5).
- `guest_stay_links (id, reservationId UNIQUE while not revoked, tokenEncrypted, tokenHash UNIQUE, createdAt,
  revokedAt)` — one live link per reservation (rule 1); `tokenEncrypted` through the core encryption helper so
  the SAS, the e-mails and the fiche can show it again; regenerating revokes the row and creates a new one.
- `guest_booklet_pages(id, slug, icon, coverMediaId, titleFr, titleEn, placeholder INTEGER DEFAULT 0, updatedAt)` — page
  content (`placeholder`: a seeded page not written yet, shown as such in the studio, cleared at its first edit);
  `guest_booklet_placements(pageId, propertyId, sortOrder, published, PRIMARY KEY(pageId, propertyId))` —
  which lodgings' booklets show the page, where (a page placed in two lodgings is « shared », rule 17);
  `guest_booklet_blocks(id, pageId, sortOrder, onlyForPropertyIdsJson NULL, type, dataJson, updatedAt)`;
  `guest_booklet_versions(id, propertyId, publishedAt, publishedBy, snapshotJson)` — « Publier » freezes the
  resolved booklet of one lodging.
- `guest_media(id, path, width, height, altFr, altEn, createdAt)` — files under `server/uploads/guest-app/`,
  resized at upload (1600 / 800 / 400 px, WebP).
- `guest_orders(id, reservationId, sessionId, payment 'card'|'note'|'none', status 'awaiting_payment'|
  'confirmed'|'paid'|'delivered'|'expired'|'paid_conflict'|'abandoned', linesJson (priced snapshot, sessions included),
  total, deliverAt NULL, deliverMoved, fulfilment 'delivery'|'pickup', pickupPlace NULL, heldUntil NULL, paymentLinkId NULL,
  paymentUrl NULL, createdAt, confirmedAt, paidAt, closedAt, deliveredAt, deliveredBy, deferredCents DEFAULT 0, clientKey NULL,
  UNIQUE(sessionId, clientKey))` — `heldUntil` makes the hourly `holds` provider cheap to query; `paymentUrl` the card
  link's address (« Reprendre le paiement », an `Idempotency-Key` replay); `deferredCents` what an order was quoted above
  what its commit added to the fiche because a card order awaiting payment held an allowance (rule 35); `clientKey` the
  `Idempotency-Key` of §4.3. A line of `linesJson` carries `needsStaff: true` when staff-prepared (rule 43).
- Plugin settings (`ctx.settings.declare`): `appName`, `soliomapUrl`, `soliomapEmbed` (default off), `maxOrderTotal`,
  `fulfilment` (`delivery` | `pickup`, default `delivery`), `pickupPlace` (rule 41bis),
  `guestHost`. The property has no slug column: `lodging.slug` is derived from its name (`L'Estiva` → `l-estiva`).

- *(Amendment 2026-11-10, rules 66 and 74)* `guest_orders.collectAt TEXT NOT NULL DEFAULT 'departure' CHECK (collectAt IN
  ('arrival', 'departure'))` — where the order's money is collected; added by the plugin migration
  `guest_app_orders_collect_at_v2` (one `ALTER TABLE … ADD COLUMN` carrying the default and the CHECK). Every existing row
  keeps `departure`: until now an order was only taken during the stay. No core column.
- *(Added the same day, rules 72, 85, 87, 88)* plugin migration **`guest_app_orders_status_v3`** rebuilds `guest_orders`
  (SQLite cannot widen a CHECK): `status` CHECK gains `'cancelled'`; new `cancelledAt TEXT NULL`, `cancelReason TEXT NULL
  CHECK (cancelReason IN ('stay', 'sas'))`, `amendmentsJson TEXT NULL` (`[{ at, by, changes: [{ key, from, to }] }]`);
  rows copied as they are, the four indexes recreated, inside one transaction; idempotent (skips when `cancelled` is
  already accepted). No row changes status at migration time.
- *(Added, rule 85)* core: `reservations.midStaySettledNotes[]` entries may carry `moment: 'arrival'` — an order note
  settled before the arrival, read by the engine as already collected on the arrival complement. JSON shape only, no
  column; an absent `moment` reads as today.
- *(Added, rule 83)* core: `reservation_custom_options.orderChargeKey TEXT NULL` (idempotent `ADD COLUMN`) — the order and
  resource a charge belongs to (`guest-order:<id>:evening:<resourceId>`), so the hourly recompute can subtract it and an
  amend can remove it. Existing rows: NULL.
- *(Added, rule 88)* core: `payment_links.basketJson` gains no field: `refundOwed` / `refundCents` already exist (rule 35).

**Data impact:** additive only, all in plugin tables. Reservations receive lines and resource sessions only
through the existing mid-stay path. Changelog `Migration` note at implementation.

## 6. UI / UX

Review boards: **`specs/guest-app-planches.html`** (v2, 2026-11-05: every surface wired to one simulated state —
the guest app on a bench of moments and conditions, the studio, the editor contribution, the orders page, the
access proposal). The v1 charter board and prototype stay in `specs/guest-app-maquettes.html`.

### 6.0 Two identities, one rule: who is looking

| Surface | Identity | Why |
|---|---|---|
| **Guest app** (`apps/guest/`) | **Domaine Solio — « forêt et heure dorée »**, the charter of the showcase site (`gf-site-style.php`, 2026-09, now in the site's private repo) and of the gate app (`gate-access-portier.md` / `guest-gate-access.md` §6.0) | The guest is a guest of the estate, not a user of GuestFlow. Website → booking → gate app → guest app must read as one house: same fonts, same ocre button, same night register. Tapping « Portail » hops into the gate app without a visual jolt. |
| **Studio** (`apps/studio/`) and the **Commandes clients** page | **GuestFlow « Maison »** (`design-system.md`, `design-system-reference.md`, `client/src/theme.js`) | Operator tools. Same component library (`PageActionBar`, `StatusBadge`, `EmptyState`…), same tokens, same rules (formatters, tabular figures, fullscreen dialogs on `xs`). |
| **Studio's phone preview** | Domaine Solio | It renders the real guest components (rule 49). |

What both share, so the house stays coherent: the **semantic colours** of « Maison » (success / warning /
error soft-chip pattern, contrast ≥ 4.5:1), the **money and date formats** (`1 234,50 €`, « ven. 9 oct. »,
« 20 h – 21 h »), **figures never in a display face** (Karla / Inter, `tabular-nums`), 44 px touch targets,
and French copy written from the guest's side.

### 6.1 Guest app tokens (`apps/guest/src/theme.js`, single source)

| Token | Day | Night | Use |
|---|---|---|---|
| `paper` | `#F5F0E6` | `#161C16` (« nuit ») | page ground |
| `card` | `#FDFAF3` | `#1F261E` | cards, sheets, fields |
| `ink` | `#22271F` | `#EFE8D6` | text |
| `inkSoft` | `#5C6153` | `#A9AE9C` | secondary text (5.6:1 / 7.6:1) |
| `sapin` | `#2E3B2A` | `#EFE8D6` | headings, outline buttons, active tab |
| `lichen` | `#5A6B48` | `#9DB087` | icons, quiet accents |
| `ocre` | `#B87B2A` | `#E8C286` (« or ») | non-text accents: active chip, progress, stars, focus ring |
| `ocreInk` | `#8A5816` | `#E8C286` | eyebrows, links, prices in accent (5.3:1 on paper) |
| `action` / `onAction` | `#9A6318` / `#FFFFFF` | `#E8C286` / `#161C16` | the primary button (5.0:1 / 10.3:1) |
| `line` | `#DCD4C2` | `#2E362C` | rules, borders |
| `scrim` | `linear-gradient(to top, rgba(10,14,10,.74), rgba(10,14,10,.22) 45%, rgba(10,14,10,.12))` | same | over every photo carrying text — the site's hero gradient |
| semantic | « Maison » `success` / `warning` / `error` main + soft | darkened soft, light text | status chips only |

**Accessibility adjustment, recorded:** the site's button (`#B87B2A` + white, 3.6:1) fails AA for the
app's 15 px label, so the app's filled button uses `ocre-deep` `#9A6318` (5.0:1); the bright ocre is kept
for non-text accents. Eyebrows use `ocreInk` `#8A5816` because `#9A6318` on paper is 4.4:1.

**Night register.** Under `prefers-color-scheme: dark` — and automatically from sunset to sunrise
(Europe/Paris, server-provided `isNight`) unless the guest chose « Jour » in the app bar — the app moves to
« nuit » with the header's gold, the pairing the site uses for its header and « band ciel ». A guest
opening the app on the terrace at 22:00 must not be blinded; the bath, the gate and the evening drinks
are night-time uses.

### 6.2 Typography (the site's faces, self-hosted)

| Role | Face | Spec |
|---|---|---|
| `display` (hero greeting, page titles) | **Marcellus** 400 | 30–34 px mobile / 44 px desktop, line-height 1.1, mixed case for the greeting (« Bonjour Marie »), **uppercase + `letter-spacing .06em`** for page titles (« LA BOUTIQUE ») |
| `title` (card / sheet titles) | Marcellus 400 | 19–22 px, mixed case |
| `eyebrow` (the site's signature) | Karla 700 | 11.5 px, uppercase, `letter-spacing .32em`, `ocreInk` — above each title (« VOTRE SÉJOUR », « BIEN-ÊTRE ») |
| `body` | Karla 400 / 500 | 16 px, line-height 1.55; 15 px in dense lists |
| `label` (buttons, tabs) | Karla 700 | 13 px uppercase `letter-spacing .16em` for buttons (site: .22em, tightened for phones); tabs 11 px sentence case |
| `figure` (prices, times, codes) | Karla 700 `tabular-nums` | never Marcellus |

Fonts are the very woff2 files the site serves (Marcellus 400, Karla variable + italic), bundled in
`apps/guest/public/fonts/`, `font-display: swap`, preloaded — no Google Fonts request in production (the
mock-ups load them from Google Fonts only because they are static files).

### 6.3 Shape, depth, iconography, photography, motion

- **Shape.** The site is square-cut: buttons **2 px**, cards and photos **4 px**. The app keeps it — it is
  what makes it read as Domaine Solio rather than a generic rounded app. Exceptions where the platform
  speaks: bottom sheets **16 px** top corners, chips and the cart pill fully rounded, the phone's own
  safe-area curves.
- **Depth.** Paper is flat; cards are set off by a `line` border, not a shadow. One shadow only, for things
  that float: the cart bar and sheets (`0 12px 32px rgba(22,28,22,.22)`).
- **Icons.** One line set, 1.75 px stroke, rounded caps (Lucide, MIT, tree-shaken), drawn in `lichen` on
  a `card` tile; filled glyphs only for the active tab. No emoji anywhere in the UI.
- **Photography carries the brand.** Every page opens on a real photo of the estate — golden hour, forest,
  stone, steam on the bath — under the site's scrim. Product photos are square, natural light, on wood or
  linen. The studio enforces ratios (hero 4:5 mobile / 16:9 desktop, product 1:1, page cover 3:2) and
  shows a warning on a photo under 1200 px.
- **Motion, one orchestrated moment per screen.** Page enter: 8 px rise + fade, 220 ms ease-out.
  Sheets: 280 ms decelerate. Add to cart: the product thumbnail flies to the cart bar (320 ms) and the
  count ticks. Order confirmed: a gold check is drawn (600 ms). Nothing loops, nothing auto-plays.
  `prefers-reduced-motion` → cross-fades only.

### 6.4 Components (guest app)

| Component | Anatomy & behaviour |
|---|---|
| `HeroHeader` | Full-bleed photo (≈ 46 % of the viewport on mobile, never 100 vh), scrim, eyebrow (lodging), greeting in Marcellus, language + day/night switch top-right on a frosted pill. |
| `StayCard` | `card` panel overlapping the hero by 48 px: dates (« 6 → 9 oct. »), status line from the server, a 3-segment night progress (« nuit 2 sur 3 »). |
| `QuickTile` | 1:1 tile, `line` border, 4 px radius, lichen line icon, Karla 13 px label; pressed state darkens the border to `sapin` and scales 0.98. External tiles (Portail, Soliomap) carry a small ↗. |
| `MomentCard` | The single highlight of rule 11: photo left, eyebrow + one sentence + one text button. Time-aware copy (« Ce soir », « Demain matin »). |
| `PhotoCard` | Booklet / shop entry: photo with scrim, eyebrow + Marcellus title inside the photo, bottom-left. |
| `ProductCard` | Square photo, title (Karla 600), price `figure` + unit (« 4,50 € · la bouteille »), a 44 px « + » button on the photo corner. Included / free states replace the price with a success soft chip « Inclus » / « 1 h offerte ». |
| `ProductSheet` | Bottom sheet (`xs`) / centred dialog (`md+`): large photo, eyebrow, Marcellus title, description, stepper, full-width primary button carrying the server total (« AJOUTER · 12,00 € »). |
| `SlotGrid` | Day chips (weekday + date) of the days that still have a bookable slot, then 2-column slot buttons: time range + price. Only bookable slots are shown (free, evening with gold dot + « tarif soirée », selected in sapin fill); taken, past, heating and staff slots are not rendered, and no « bain déjà chaud » note (review of 2026-11-05). |
| `DeliveryTimeChips` | Horizontal chips grouped by day, first one « Dès que possible · 17 h 30 ». Out-of-hours banner above (warning soft). |
| `CartBar` | Floating pill above the tab bar: count, « Voir le panier », server total; slides up on first add. |
| `PaymentChoice` | Two large selectable cards with icon, title, one-line explanation; the selected one gets a sapin border and check. |
| `OrderTimeline` | Status as a vertical 3-step line: Reçue → En préparation → Livrée (or Payée / Sur votre note), times in `figure`. |
| `TabBar` / `NavRail` | 4 entries max (rule 11bis decides which); active = filled icon + sapin label + 2 px ocre bar on top. |
| `BlockRenderer` | One renderer per booklet block; `steps` as a vertical timeline with lichen numerals, `wifi` as a ticket with a perforated edge, `callout` as a soft panel with a left icon, `contact` as a row with « Appeler » / « WhatsApp » buttons, `place` with a static map tile + « Itinéraire ». |

States, for every list: skeletons in the final layout (no spinner on a blank page), `EmptyState` with an
illustration-free icon + one sentence + one action, `ErrorAlert` with « Réessayer », offline banner
« Hors connexion — le livret reste disponible ».

### 6.5 UX principles — what makes it feel effortless

1. **Zero steps before value.** The QR opens straight on the guest's home — no splash, no login, no cookie
   wall (the session cookie is strictly necessary). The app never asks who the guest is: the stay link proves it (rule 2); only the fallback lookup asks a name
   and a number (rule 6).
2. **The home answers « what now? ».** Tiles are the stable map; the `MomentCard` is the one thing that
   matters at this hour (arrival day → Portail; evening → bath; morning → breakfast delivery; eve of
   departure → « Départ : les consignes »).
3. **Thumb zone.** Primary actions sit in the bottom third: cart bar, sheet buttons, payment confirmation.
   Nothing important in the top corners except language / night.
4. **Show the real price before every commitment.** Each button that commits carries the server total
   (« COMMANDER · 33,00 € »); free and included items say so in green before the guest asks.
5. **Never a dead end.** Every refusal names the next step: slot taken → the next free slots; service
   closed → « commandez pour demain 8 h 30 »; name mismatch → « Payer par carte plutôt »; offline → the
   booklet still works.
6. **One house.** Same eyebrow, same button, same night register as the site and the gate app; the gate
   tile opens the gate app, Soliomap opens Soliomap — the guest app is the hall, not a copy of the rooms.
7. **Readable anywhere.** 16 px body minimum, supports system text size up to 200 % without overlap,
   contrast ≥ 4.5:1 in both registers, visible focus (2 px ocre ring, 2 px offset), every tile and price
   labelled for screen readers (« 12 euros, plateau picodons, ajouter »), `lang` switched with the content.

### 6.6 Screen by screen

- **Home** — hero (46 %), `StayCard`, tiles grid (3 × 2 on phone, 6 in a row on desktop), `MomentCard`, the suggestion card (rule 15bis), « Commandes en cours » row if any, « Le livret » photo strip.
- **Booklet index** — search field (sticky), then `PhotoCard`s in one column (phone) / 2 (tablet) / 3
  (desktop); a shared page is indistinguishable from a lodging one.
- **Booklet page** — cover photo with title inside, then blocks with 24 px rhythm; « Page suivante » card at
  the bottom (no dead end); offline-cached badge discreet in the footer.
- **Shop** — page title « LA BOUTIQUE », sticky category chips, a featured `PhotoCard` for the bath when it
  is sold here, then a 2-column `ProductCard` grid (3 on tablet, 4 on desktop). Service banner on top when
  closed. `CartBar` floats.
- **Bath** — eyebrow « BIEN-ÊTRE », title, free-time chip (« 1 h offerte · déjà utilisée lundi »), day
  chips, `SlotGrid`, sticky button with the server price of the selection.
- **Cart** — lines with thumbnails and steppers, delivery chips (if any staff item), total, `PaymentChoice`,
  one primary button whose label follows the choice (« PAYER 33,00 € » / « AJOUTER À MA NOTE · 33,00 € » / « RÉSERVER » at 0 €).
- **Confirmation** — gold check drawn, « Commande envoyée », one-sentence promise built by the server
  (« Livrée à L'Estiva vers 18 h » or « Prête à 18 h. Lieu de retrait : {lieu} », « Le bain sera chaud à 20 h », rule 41ter), `OrderTimeline`, « Retour à
  l'accueil ».
- **Orders** — current orders first with `OrderTimeline`, then past ones collapsed.
- **Lookup** (`/retrouver`) — night-register hero photo, two fields, one button; the same calm error.

**Responsive:**
- `xs` (≤ 600): bottom tab bar, single column, bottom sheets, cart bar floating, hero 46 % of the viewport.
- `md` (~900): navigation rail left (72 px), booklet two-pane (index 320 px | page), shop two-pane (catalogue
  | cart panel always visible — no cart bar), sheets become centred dialogs (max 560 px).
- `lg` (≥ 1200): content max 1200 px centred, hero 420 px high with the greeting at 44 px, tiles 6 in a row,
  booklet 3 columns.

**GuestFlow option / resource editors (plugin contribution, « Maison »):** while `guest-app` is active, a
section « Application clients » appears at the bottom of the editor: switch « Vendu dans l'app », and when
on: photo, short description FR/EN, « Préparé par l'équipe » + « Délai de préparation (min) », « Quantité
max. par commande », then the **Stock** group (rule 37bis): « Suivre le stock », « En stock » with the last restock
line and what is held by unpaid orders, « Prévenir sous », « En rupture ». Plugin inactive → the section does not exist.

**PageActionBar:** applies to the GuestFlow admin page *Commandes clients* (title « Commandes clients », action
« Actualiser » `RefreshIcon` info) and to the studio pages (editor: Save « Enregistrer le brouillon »,
Cancel, `actionsBefore` « Aperçu » and « Publier » success, `actionsAfter` « Supprimer la page » error).
The **guest app does not use `PageActionBar`**: it is not a GuestFlow back-office page, and its app bar +
tab bar is the guest-facing pattern (deliberate exception to CLAUDE.md §7, accepted 2026-11-04).

Copy (FR; EN in `en.json`): « Bonjour {prénom} », « Votre séjour », « Le livret », « La boutique »,
« Ajouter », « Voir le panier », « Quand souhaitez-vous la recevoir ? », « Dès que possible », « Inclus »,
« 1 h offerte avec votre séjour », « Le service reprend demain à 8 h », « Payer maintenant », « Ajouter à
ma note », « Commande
envoyée », « Hors connexion — le livret reste disponible », « Nous n'avons pas trouvé ce séjour. Vérifiez
le nom et le numéro. »

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `plugins/guest-app/tests/guest-app-current-stay.unit.test.js` (15) — rules 2, 4, 5, 6, 9 (window edges and
  DST, what the link opens before J-7 / from J-7 / in the window / after, cancelled, a pre-arrival link session
  ending at H-3, a lookup session moving on by itself)
- [x] `…/guest-app-name-match.unit.test.js` — rule 7 (accents, hyphens, second name, empty)
- [x] `…/guest-app-sessions.unit.test.js` (30) — rules 1-6, 8, 9, 33 (two stays sharing a number, the cookie's `Secure` following `HTTPS_ENABLED`): the stay link (stay / pre-arrival from
  J-7 / visitor before and « ended » after), the poster opens the visitor mode only and tells nothing of a stay,
  no name state left, phase-bound reuse, a regenerated link kills its sessions, lookup throttling, generic
  errors, payload minimisation
- [x] `…/guest-app-stay-links.unit.test.js` (11) — rules 1, 2, 9, 9bis, 11quater: created on first need and shown
  again, regenerate kills the old link and its sessions, undecryptable token replaced, cancelled stay / lodging
  off / no guest host → 409, SAS switch reads without writing, e-mail URL (none without an address), the plugin's
  own `{{stayAppUrl}}` → gate-link fallback (absent from the core context), reception allowed
- [x] `client/src/plugins/sas/__tests__/ReservationSasDialog.stay-app.test.jsx` (7) — rules 1, 9bis a: « Mon séjour »
  replaces the step, « QR du portail seul », regenerate after confirmation, plugin off / lodging off → gate step,
  link unreadable → warning + gate step
- [x] `…/guest-app-block-validation.unit.test.js` (8) — rule 18: shapes per type, sanitising, unavailable buttons dropped
- [x] `…/guest-app-media.unit.test.js` (5) — limits, three WebP sizes · `…/guest-app-qr.unit.test.js` (4) — rule 1: regenerate kills the old code, poster PDF
- [x] `…/guest-app-booklet.unit.test.js` (11) — rules 16, 17, 19, 20: each lodging resolves only its own
  placements in its own order, shared page edited once appears in both, restricted block filtered,
  duplicate diverges, per-lodging publish, draft vs published
- [x] `…/guest-app-lodging-config.unit.test.js` — rules 11bis-11quater: module off → absent from `/me` and
  404 `MODULE_OFF` on its endpoints, prerequisites, wifi off → no tile / no wifi block, wifi password
  encrypted at rest, lodging disabled → no QR and lookup refused, new property starts off
- [x] `…/guest-app-input-shape.unit.test.js` — rules 1, 3, 6: a stay token, poster code or lookup whose fields are
  not text answers the generic 404 (never a 500)
- [x] `…/guest-app-plugin-gating.unit.test.js` — rule 22: plugin inactive → 404 `PLUGIN_INACTIVE`, items
  rows kept, no core column touched
- [x] `…/guest-app-items.unit.test.js` (11) — rules 22, 23, 27bis: the admin routes' validation, `NOT_SELLABLE` (a
  per-person resource included, R36b N2), roles
- [x] `…/guest-app-shop.unit.test.js` (12) — rules 11bis, 24, 25, 26, 27, 27bis (a pre-arrival session reaches nothing but the catalogue): payload per lodging and language, categories, window states, visitor, `canPayCard`
- [x] `…/guest-app-sellable.unit.test.js` (17 tests) — rules 23, 25, 27bis: per price type (a per-person resource refused
  and absent from the shop with its switch on, R36b N2), archived, lodging scope, 0 € in
  one lodging and paid in the other, free units (direct only) and free minutes left after existing lines,
  offered-by-default already on the stay
- [x] `…/guest-app-shop-quote.unit.test.js` (13) — rules 23, 24, 25, 27, 27bis, 29, 30, 32, 37, 41: quote equals the
  fiche's pricing engine for the same lines and writes nothing, free hour, sessions of one order judged together,
  `SLOT_TAKEN`, breakfast mornings, delivery time, input shapes, pre-arrival refused, « Modifiée par l'équipe »
- [x] `plugins/hourly-resources/tests/resource-scheduler-hook.unit.test.js` (9) + `guest-app/tests/guest-app-slots.unit.test.js` (8) — rules 11 (the home's bath card from the planning), 28-31: guest sessions of other
  stays, outside bookings, held orders, turnover, capacity, heat-up / retention, closed days, evening rate,
  multi-slot order, ignition outside service hours → `staff`, warm slot not constrained
- [x] `…/guest-app-service-hours.unit.test.js` (16) — rules 39-42 (unconstrained only when nothing is stored, a lodging's exceptions over the shared week, t strictly before the check-out): weekly ranges, exceptions, establishment
  closures, lead time, next opening, last delivery before check-out
- [x] `…/guest-app-order-note.unit.test.js` (12) — rules 11bis, 25, 27, 33, 34, 37, 38, 44: no name asked, 0 € order and
  its allowance, lines land on the fiche and in `endOfStayComplementDetail`, quantities merge, limits, 10 / hour, push
- [x] `…/guest-app-order-card.unit.test.js` (10) — rules 33, 35, 36, 38, 44 (the fiche refuses a held slot): complement link, paid → lines + payment,
  abandon, holds, expiry releases slots, late payment committed or `paid_conflict`, delivery moved
- [x] `…/guest-app-order-money.unit.test.js` (11) — rules 25, 33, 35, 36, 37quater, §4.3 (review of 2026-11-09): a card
  order awaiting payment holds its free hour, a price raised → `paid_conflict`, lowered → the gap « à rembourser », on-time
  payment never judged on the stock, abandoned → conflict, cancelled stay → conflict, provider read once per 10 s,
  `Idempotency-Key`, the link equals the quote, a 0 € order needs no link, `paymentUrl` while the link lives
- [x] `…/guest-app-orders-admin.unit.test.js` (8) — rules 11, 38, 43, 45 (staff-prepared lines only on the card, « À préparer » ages out): the list, « Marquer livrée », planning cards, reception
- [x] `tests/payment-complement-link.unit.test.js` (9) — a part owed back (`refundCents`), a basket paid after its stay was cancelled, `ensurePaymentLink` / `applyPaidEffect` complement
  branch, refusal without basket, 30 min, no arrival lapse, « à rembourser », `ctx.paymentBasket`
- [x] `tests/mid-stay-order-commit.unit.test.js` (12) — the pending lines priced first, a breakfast line kept, rules 24, 25, 27bis, 30, 34, 35: the core commit and its pricing
- [x] `…/guest-app-stock.unit.test.js` (13) — rules 37bis-37quater (a per-person article counts its people): restock sets the count with its history line and
  is what the cellar holds now, « En rupture », no stock for the bath or the breakfast, holds of an unpaid card order
  released on expiry / abandon and counted once paid, a site line counted on the arrival day and not before, a line
  added mid-stay counted at once, lowered / cancelled / deleted after arrival returned, the app order not counted twice
  by the event, the four reservation events listened to, `OUT_OF_STOCK` with `left`, website and staff never refused
  (« −2 », « Stock : épuisé »), the two pushes once each until a restock, late payment without its units → `paid_conflict`
- [x] `…/guest-app-fulfilment.unit.test.js` (6) — rules 41bis-41ter: pickup needs a place, the picker's question, the
  sentence per mode with the order's own place, longest lead of the staff items only, the bath's own line and no time for
  a self-service order, the moved time and its notice, the staff's « à retirer » / « Retirée »
- [x] `…/guest-app-studio-lodgings.unit.test.js` (4) — rule 48: every property listed live in GuestFlow's order, a new one
  greyed « Hors application », a renamed one renamed, no name of the plugin's; the settings read and judged together;
  « Synchroniser » re-reads the Soliomap feed at once (GuestFlow properties are never archived: nothing to hide)
- [x] `…/guest-app-gate.unit.test.js` (6) — rules 11bis, 12-14: active with the key URL, « Accès en préparation » and the
  arrival-day card, no URL outside the window or for a visitor, module off, plugin off, the URL read from gate-access's
  e-mail context
- [x] `…/guest-app-install.unit.test.js` (4) — rules 52, 53: the manifest, `isNight` by the season's sun
- [x] `…/guest-app-hosting.unit.test.js` (7) — rules 15, 47 (the studio's admin re-read), 52 (plan step 50): caching, the app's routes, 404, no file
  outside the build, the CSP and its Soliomap frame, 503 without a build, the studio's admin gate
- [x] `tests/plugins-web-apps.unit.test.js` (4) — `plugins-phase-1-sdk.md` rule 48: host and path web apps, the core's
  trees kept, a plugin not live falls through, registration refusals
- [x] `…/guest-app-home.unit.test.js` — rules 10-11
- [x] `…/guest-app-suggestion.unit.test.js` (9) — rule 15bis: 14 h cut-off, eve of departure, `visibleFrom`, nearest
  then soonest, multi-day label with the real end date, feed down or slow → no card, visitor → none
- [x] `…/guest-app-lookup-core-numbers.unit.test.js` (7) — rules 6, 54 (D28): a direct stay's sequential numbers walked
  with the right surname open nothing, a platform counted as a direct sale refused by its mode, a platform stay still
  carrying the core's number refused and its own number opening it, an open lookup session dying once the stay becomes
  an own-channel sale, « Régénérer le lien » ending that stay's lookup sessions only; genuine 10-digit platform numbers
  (digits 5-6 between 01 and 12) opening their stay, and the refused shape pinned to the core's generator for every
  month, both forms, nothing wider (R36b N1)
- [x] `…/guest-app-order-free-units.unit.test.js` (2) — rules 25, 55 (R36b N4): a priced option's free unit confirmed at
  0 € and the next unit billed; the bath's free hour confirmed at 0 € and the next hour billed
- [x] `…/guest-app-order-persons.unit.test.js` (6) + `tests/mid-stay-order-persons.unit.test.js` (2) — rule 55 and
  `plugins-phase-1-sdk.md` rule 47 reading: a full party's repeat order refused, the persons left named and billed whole
  (pickup mode), a 0 € per-person item, a pending card order's persons, a card order beyond them minting no link, the
  breakfast line's persons, an offered line never confirmed at 0 €; the core's `priceOrder` / `commitOrder` refusal
- [x] `…/guest-app-refusals-language.unit.test.js` (4) — rule 56: the table complete in both languages, no route writing
  its own words, the auditor's refused orders in English, the lookup, a dead session and the throttle in English
- [x] `…/guest-app-card-order-limit.unit.test.js` (1) — rule 57: the 7th card order of a stay in an hour refused across
  sessions, refused ones and the note free
- [x] `…/guest-app-own-host.unit.test.js` (3) + `…/guest-app-register-wiring.unit.test.js` (4) + `tests/plugins-web-apps-own-host.unit.test.js` (1) — rules 58, 59 and
  `plugins-phase-1-sdk.md` rule 48 reading: the request's Host, its Origin and the public URL's host refused at save,
  the generic route unable to write it, a stored own host ignored at boot, the loader never handing GuestFlow's host to
  a web app; the erase naming the booklet pages and photos and deleting the photo files, only once the erase has
  committed (a rolled-back erase keeps them, R36b N5)
- [x] `…/guest-app-wifi-qr.unit.test.js` (1) — rule 18 reading: the join text read back as typed, backslash included
- [x] `…/guest-app-delivery-dst.unit.test.js` (2) — rule 41 reading: the next two Paris clock changes, computed from
  today: the first time the lead away, no wall time that does not exist, the times in their real order

### Guest app client tests (Vitest, `apps/guest/src/__tests__/`, 81)
- [x] `HomePage.language-switch.test.jsx` (1) — rule 19 reading: after « EN » the orders and the booklet are read with
  `lang=en`, never again in the old language
- [x] `HomePage.modules.test.jsx` (6) — rules 3, 5, 10, 11, 11bis, 13, 51: server tiles in order, gate « Accès en
  préparation » / absent outside, no shop tab without shop, visitor home, the highlight's words
- [x] `ShopPage.free-states.test.jsx` (6) — rules 25, 27, 32, 37quater, 42: included / free chips, « Épuisé » without
  « + », « Plus que 2 », unavailable reason, pre-arrival read only, closed-service banner, the cart bar's server total
- [x] `SlotGrid.states.test.jsx` (4) — rules 28-31: only the slots sent, evening rate, FR / EN times, several picks
- [x] `CartPage.payment-choice.test.jsx` (6) — rules 25, 32, 33, 37quater, 41bis: note / card choice and the button's
  server total, card off → note stated, 0 € → « Réserver », a line lowered to the stock left, pickup question, the order
- [x] `BlockRenderer.blocks.test.jsx` (10) — rules 11ter, 18, 49: every block type, wifi copy / « Pas de wifi », targets
- [x] `AppShell.night.test.jsx` (4) — §6.1, rules 19, 53: day / server night / device dark, the guest's choice kept, EN
- [x] `session.reexchange.test.jsx` (5) — rules 1, 4, 9, 22: the stay link kept, a dead session reopened once, a stale
  link forgotten, the poster's visitor fallback, « Application indisponible »
- [x] `sw.offline.test.js` (7) — rule 21: the service worker run without network: the booklet, `/me` and `/lodging`
  from the cache, the photos stale-while-revalidate, the shell offline; the shop, orders, gate and sessions never cached; the data cache purged on `purge` (shell kept) and capped at 200 photos
- [x] `session.recovery.test.jsx` (4) — rules 1, 4, 9, 21, edge case « stay cancelled mid-cart »: a link opened
  offline kept and « Réessayer », a 401 reopened as a visitor or not at all (cart cleared, `purge` posted), a
  re-exchange offline keeps the stay
- [x] `cart.integrity.test.jsx` (5) — rules 24, 29, 32, 37quater: a failed quote leaves no total to order, an
  unavailable bath session removed alone and blocking the order, the picker drops it, the sheet's bound counts the
  cart, `mergeLine` clamps
- [x] `OrderPage.unpaid.test.jsx` (2), `useOrderStatus.retry.test.jsx` (3) — rules 33, 35: « Vérifier à nouveau », an
  abandoned order merged into the cart, network retries with a growing wait, the try limit, a refusal stops
- [x] `BreakfastSheet.hours.test.jsx` (2), `BottomSheet.close.test.jsx` (3) — rules 27bis, 41, §6.4: the first hour
  offered taken, a single hour stated, « pas à » / « not at »; « Fermer » named, 44 px, focus kept in the sheet
- [x] `links.guard.test.jsx` (4), `HomePage.gate-offline.test.jsx` (1), `styles.touch-targets.test.js` (3) — rules 13,
  15, 18, 21, §6.4: Soliomap's origin only, a bad suggestion URL, web links in a new tab, the gate tile offline,
  44 px targets and the search focus ring

### Studio client tests (Vitest, `apps/studio/src/__tests__/`, 35)
- [x] `ModulesPage.test.jsx` (4), `LodgingSwitcher.test.jsx` (2) — rules 10, 11bis, 48: the lodging's tiles, a
  lodging « Hors application » greyed but selectable
- [x] `PageEditor.blocks.test.jsx` (6), `richText.test.js` (3) — rules 16-18, 49: one editor per block type, a shared
  page's block kept to one lodging, only what changed written, a partial refusal keeps the draft
- [x] `ShopItemsPage.test.jsx` (4) — rule 50: the lodging's own articles at its price, the sell switch shown, edited
  in GuestFlow
- [x] `ServiceHoursPage.test.jsx` (5), `SettingsPage.test.jsx` (3) — rules 38-41ter, 47: shared and per-lodging hours,
  « À retirer » needs a place, the app settings
- [x] `PageEditor.save.test.jsx` (4) — rules 16-18, §4.2: clean after a save the server trimmed, a partial save
  retried without the page read back creates each block once, « Annuler » resets the editors, blocks compared as stored
- [x] `SettingsPage.max-order.test.jsx` (2), `studio.a11y.test.jsx` (2) — rules 40, 48: an emptied ceiling sent as
  null; followed hours `inert`, the article toggle 44 px

### GuestFlow admin client tests (Vitest, `client/src/`)
- [x] `GuestAppItemFields.sell` (7), `GuestAppItemFields.stock` (5) — rules 22, 37bis: the sell switch and its
  reason, the stock group (follow, count, restock line, « Prévenir sous », « En rupture »)
- [x] `GuestOrdersPage` (7), `PlanningOrderCard` (4) — rules 43-45: by delivery time, « Marquer livrée / retirée »,
  the push deep-link, only the latest read lands; the planning card and the day counter
- [x] `StayLinkCard` (4), `StockLineWarning` (2), `SasStayAppStep.sas-portal` (7, moved from the SAS folder), the SAS's
  generic `ReservationSasDialog.portal-lead` (2) — rules 1, 9bis, 37quater
- [x] `SettingsGuestAppSection` (6, rule 58: GuestFlow's own address said on the field), `itemDraft.unsold` (3), `roles.plugins` (Intégrations follows every plugin that
  contributes to it) — rules 22, 39, 47: the URL field's attributes through `slotProps`, the bound and lead time
  judged only while sold, the Intégrations page kept visible for guest-app
- [x] `OptionEditorPanel.plugin-fields` (4), `ResourceEditorPanel.plugin-fields` (2), `navMenu.plugin-entries` (3),
  `navigation.safe-return-path` (3) — the generic client points (`plugins-phase-1-sdk.md` rule 49)

### Manual UI verification
- [ ] Happy path mobile (390 px): scan QR → home → order 2 drinks for 18 h + 1 h bath → note with name → push
  received → bath session visible on Calendrier › Ressources and its ignition card, order card on the
  planning → line on the fiche → collected at the departure SAS.
- [ ] Card path: Qonto sandbox payment → return page → order paid → fiche shows paid lines, end-of-stay
  complement unchanged.
- [ ] Free per lodging: same resource free at La Granja, paid at L'Estiva → each shop shows its own price;
  free hour used at the arrival SAS → app shows « déjà utilisée ».
- [ ] Out of service hours (e.g. 22:00): banner, drinks orderable for tomorrow 8 h + lead time; cold-bath slot whose ignition falls outside service hours is not listed.
- [ ] Plugin deactivated → switch gone from the option / resource editors, guest app answers « indisponible »;
  reactivated → flags back.
- [ ] Edge: slot taken from the fiche between quote and order.
- [ ] Arrival SAS (390 px and desktop): « Mon séjour » step, QR flashed opens the stay, Partager, Régénérer (the
  old QR shows « Ce code n'est pas reconnu »), « QR du portail seul »; plugin off → the gate step as before.
- [ ] Visitor mode (no stay) and pre-arrival lookup; offline booklet in airplane mode.
- [ ] Tablet (900 px) two-pane layouts; desktop (1280 px); dark mode; EN.
- [ ] Per lodging: wifi off at one lodging → no wifi tile, wifi block replaced by « Pas de wifi »; shop off at
  one lodging → no Boutique tab; booklet of La Granja and L'Estiva differ (own pages, shared page edited
  once shows in both).
- [ ] Studio: create page, add each block type, preview, publish, service hours, regenerate QR (old QR no
  longer resolves).
- [ ] Regression: website booking tunnel prices unchanged; mid-stay extras from the fiche unchanged; arrival
  SAS bath picker unchanged.

### Amendment 2026-11-10 — « Mon séjour » from J-7 (rules 65-89)

Every new case in a file of its own (CLAUDE.md §9); dates built from the local day (`todayIso()` / `addIsoDays`), the
J-7 boundary under a mocked clock only (`mock.timers`, server-test-isolation rule 7).

**Server, core** — `server/src/tests/mid-stay-order-before-arrival.unit.test.js`:
- arrival day, before the arrival SAS, stay paid at booking: a priced option is committed on the arrival complement
  (`complementAmount` + its price, `collectAt: 'arrival'`), no longer 409 `ITEM_UNAVAILABLE` — **written first, red on
  the current code** (the finding of rule 66);
- J-5, acompte and solde paid: same; history entry written; acompte, solde, end-of-stay complement unchanged;
- solde unpaid → 409 `ORDER_OFF_ARRIVAL_COMPLEMENT` and `orderCollection` `unavailable`, nothing written; plan with an
  installment due → same (D2); plan all paid → `arrival`;
- stored stay replaying to another price (a stored `finalPrice` edited in the fixture) → 409 `ORDER_STAY_PRICE_MOVED`;
- ~~`paid` before the arrival → 409 `ORDER_PAID_BEFORE_ARRIVAL`, no note settled~~ — replaced by
  `guest-order-card-before-arrival.unit.test.js` below (rule 85);
- arrival marked (SAS committed / complement collected) → today's end-of-stay path, byte-identical answer;
- free units and a 0 € item before the arrival; a per-person option's persons (rule 55) before the arrival; a
  percentage line raised by the order counted in `byKey`;
- `orderCollection` matrix: arrival / departure / unavailable / closed.

**Server, plugin** (`server/src/plugins/guest-app/tests/`):
- `guest-app-pre-arrival-window.unit.test.js` — J-8 23:59 Paris visitor, J-7 00:00 pre-arrival (winter and summer
  time), the visitor session expiring at J-7 00:00; link and lookup sessions equal; a core number still refused (D28);
- `guest-app-pre-arrival-orders.unit.test.js` — shop open with `orderCollection`, `noteLabel` « Régler à l'arrivée »,
  `canPayCard` true from J-7 with the provider live, false without it (amended, rule 67); note order committed with
  `collectAt = 'arrival'`; card order mints its basket link (rule 85);
  `unavailable` → read-only and 409 `ORDERS_OPEN_ON_ARRIVAL`; gate still `outside`; FR and EN refusals;
- `guest-app-pre-arrival-times.unit.test.js` — first delivery time ≥ check-in on the arrival day, none ≥ check-out, a
  `deliverAt` before the check-in or at the check-out refused (`deliverAtUnavailable`, 409 `DELIVERY_TIME_UNAVAILABLE`),
  `asap` null before the check-in, the banner « À partir de votre arrivée, le … »; hourly sessions inside
  [check-in, check-out]; breakfast mornings of the stay only; a stay with the lodging's 16:00 check-in;
- `guest-app-j7-email.unit.test.js` — `hasStayApp` / `hasStayAppShop` / `hasStayAppBath` / `stayAppUrl` matrix (plugin
  off, lodging out, no host, no e-mail, shop module off, nothing sold, `unavailable`; bath line with hours, free minutes
  left, both used, neither, bath not sold at the lodging); the J-7 FR / EN body rendered for each (no paragraph without
  the shop, the bath clause only with the bath, no word « régler » / « settle » / « Mon séjour », no dead link, no gate
  link) (rules 70 amended, 89);
- `guest-app-arrival-sas-orders.unit.test.js` — `ordersAtArrival` only for note orders `collectAt = 'arrival'`
  confirmed / delivered of this stay while the complement is open; gone once collected; `changed` when the fiche's lines
  were lowered; the reception's SAS payload carries it;
- `guest-app-stay-cancelled-orders.unit.test.js` — cancelled / deleted stay: out of « À préparer » and the cards,
  « Séjour annulé » under « Toutes »; moved stay: `outsideStay` and the guest's « Horaire à revoir avec l'équipe »;
- `guest-app-pre-arrival-stock.unit.test.js` — the hold until the arrival day, released by a cancellation, counted once
  by the sweep on the arrival day;
- `guest-app-staff-day-label.unit.test.js` — push and list name the day when not today, « à régler à l'arrivée ».

**Operator script** — `specs/guest-app-livret/__tests__/import.j7-paragraph.test.mjs` (node --test): inserted at the
anchor, never inside the previous `{{#if}}`; skipped when `{{stayAppUrl}}` is there; stops with no anchor; the PUT body
holds `body` and `bodyEn` only; the J-2 insertion unchanged.

**Guest app client** (Vitest, `apps/guest/src/__tests__/`): `ShopPage.pre-arrival.test.jsx` (« Ajouter » enabled, the
banner, read-only with `unavailable`), `CartPage.pay-at-arrival.test.jsx` (amended: « Régler à l'arrivée » as the note's label; without `canPayCard` the note
alone), `PaymentChoice.card-first.test.jsx` (rule 86: one radio group, card first and checked on every open, same row
component, main button label follows the choice, keyboard arrows move the choice), `SlotGrid.priced-slots.test.jsx`
(rule 84 labels and the evening dot as sent, « comprises dans votre séjour »), `DeliveryTimeChips.stay-days.test.jsx`
(only the days and times sent), `OrderCard.cancelled-amended.test.jsx` (« Annulée », « Modifiée à votre arrivée »),
`OrdersPage.pre-arrival.test.jsx` (tab present, chips as sent).

**GuestFlow admin client** (Vitest, `client/src/plugins/guest-app/__tests__/`): `SasArrivalOrdersStep.test.jsx` (lines,
total, caption, `changed`, hidden without orders, recap note), `SasArrivalOrdersStep.collapsible.test.jsx` (folded when
all paid, unfolded otherwise, per-article rows « 2 × 6,00 € · 12,00 € », « Total à percevoir » / « Déjà payé par carte »
as sent, 390 px single column), `SasArrivalOrdersStep.amend.test.jsx` (stepper and « Retirer » only on editable orders,
« Retirer la commande » through `ConfirmDialog`, one `amend` per gesture then the SAS data and preview re-read, the
server's refusal shown, a paid order without any control), `GuestOrdersPage.stay-state.test.jsx`,
`PlanningOrderCard.stay-state.test.jsx`.

**Added the same day (rules 77-89 and the amended 66, 67, 69-72, 76)** — one file per subject:

- core `server/src/tests/guest-order-card-before-arrival.unit.test.js` — J-5, stay paid at booking: a `paid` commit
  writes the lines and the `moment: 'arrival'` note; `complementAmount` net of it; the arrival SAS preview and single
  payment do not collect it; a fiche save does not raise it back; the books take the note on its `paidDate` (VAT lines of
  the basket) and the SAS's complement net; `complementBuckets` counts it once; a refund on that line allowed up to the
  note (D15); `ORDER_OFF_ARRIVAL_COMPLEMENT` at payment → `paid_conflict`; arrival marked between quote and payment →
  today's departure path, byte-identical;
- core `guest-order-amend.unit.test.js` — lower, raise within bounds, remove a line, remove a session, remove a morning,
  empty the order (→ `cancelled`, `sas`); never below the stay's own quantity; free units back to the allowance; rule 66
  guards; history entry; the arrival complement moves by the difference; a paid order refused;
- core `guest-order-charges.unit.test.js` — a `charge` line written with its `orderChargeKey`, removed by an amend,
  carried by a fiche save (`reservation-save-keeps-pricing` rule 19 invariant: contribs byte-identical);
- hourly `hourly-heat-from-now.unit.test.js` — `heatFrom` absent = today's answer on every existing fixture (SAS
  unchanged); J-5 with 240 min heat-up: arrival evening offered; same day 17:00: cold 19:00 `heating`, 21:00 free, 18:00
  free when warm from an adjacent use within retention; ignition outside service → `staff`;
- hourly `hourly-free-minutes-day-rate.unit.test.js` — 60 free minutes at 17:00 → 0 €; at 20:00 (evening from 19:00, 30 /
  40 €) → 10 €; straddling 18:30-19:30 → 5 €; day rate only resource unchanged; `freeValue` at the day rate; a stored
  (locked) line never re-priced;
- hourly `hourly-order-supplement.unit.test.js` — `orderSupplement` on a sold line (full difference), on an unsold line
  priced from sessions (0, already billed); the arrival recompute subtracts the order's charge (no double), before and
  after the order, SAS re-opened;
- plugin `guest-app-shop-times-combined.unit.test.js` — presence × service × lead: a closing hour never offered, a day
  without any time `available: false` with its reason, days before the arrival and after the departure absent, departure day before the check-out only (rule 77);
- plugin `guest-app-bath-slots-pre-arrival.unit.test.js` — every day of the stay (none outside), the bath's own
  hours and `openingBands`, a closed day `available: false` « Fermé », taken by another stay / an outside booking / a held order not offered, heat-up from now, labels of rule 84,
  hours included placed first (rules 78-80, 82, 84);
- plugin `guest-app-bath-crafted-slot.unit.test.js` — 03:00, the day before the arrival, off grid, shorter than the
  minimum, taken → `unavailable` / 409 `SLOT_UNAVAILABLE` or `SLOT_TAKEN`, nothing priced (spy on the engine), FR / EN
  (rule 80);
- plugin `guest-app-card-before-arrival.unit.test.js` — `canPayCard` from J-7, link minted, paid → order `paid`,
  `collectAt = 'arrival'`, chip « Payée », listed read-only in `ordersAtArrival.paid`; one card order awaiting at a time
  still holds (rules 67, 85);
- plugin `guest-app-sas-amend.unit.test.js` — the amend route: admin, reception on its arrival day (403 the day before),
  paid → 409 `ORDER_PAID_READ_ONLY`, collected complement → 409 `ORDER_NOT_EDITABLE`, stock moved by the difference,
  `amendmentsJson`, the guest's « Modifiée à votre arrivée » (rule 87);
- plugin `guest-app-stay-cancelled-orders.unit.test.js` (amended) — every live order `cancelled`, stock and holds
  released, out of « À préparer » and the cards, a paid order « Payée · à rembourser » with the link's `refundOwed` and the
  history entry, the flag cleared once a refund covers it (rules 72, 88);
- plugin `guest-app-orders-status-v3.unit.test.js` — the rebuild keeps every row and index, accepts `cancelled`, runs twice
  without change.

**E2E** — `e2e/specs/plugins/guest-app-pre-arrival.spec.js`: a stay paid at booking 5 days ahead; a note order placed
through `/public/v1/guest` with a pre-arrival session (stay link); the arrival SAS shows « Commandes Mon séjour » with
its line; the recap's total includes it; the single payment collects it; the fiche's complement paid, the order chip
« Réglée ». Then the same at 390 px. Outbound disabled, no real mail. *Added:* a second order lowered from the SAS step
before the recap (the recap's total follows), and a card order paid through the provider's test double before the
arrival, listed « Payée par carte » and not collected; then the stay cancelled with a paid order → « Payée · à
rembourser ».

**Manual** — the guest app at 390 / 900 / 1280 px on a shadow copy: a pre-arrival session orders cider for the arrival
evening and a bath, the cart shows « Payer par carte » preselected then « Régler à l'arrivée », a time before the
check-in or in a closing hour is never offered, the bath's « 1 h offerte » in the evening reads « + 10,00 € soirée »; the J-7 preview
in Paramètres › E-mails carries the paragraph and the stay's link; the arrival SAS as admin and as reception.

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
- *(Amendment 2026-11-10)* ~~Card payment before the arrival (rule 67, Q13)~~ — brought in scope by Adrien's fifth
  message (rules 67, 85, 86); an automatic refund at the provider for a cancelled stay's paid order (rule 88: the operator
  refunds through the existing refund); moving a bath session from the arrival SAS's « Commandes Mon séjour » step (the
  « Planifier les ressources » step moves sessions); the guest cancelling an order from the app (Q23); orders before the arrival on a stay whose
  pre-arrival money is still due (rule 68, Q14); the app's paragraph in the J-2 of a stay booked within the week beyond
  the slice-I paragraph (Q15); keeping the cart across the pre-arrival → stay hand-over (it is emptied, as any session
  change); naming each order line inside the « Complément d'arrivée » remainder of the ledger and the J-2 (the SAS step names them, rule 71); moving an order's time when the stay moves (rule 73).
- The guest host of a console-hosted instance (audit R36-CON-M1, recorded 2026-11-10): the console routes only
  `<slug>.<domain>` to an instance and provisions no second host (DNS, Caddy site, certificate), so the guest app
  needs its own address pointed at the server by the operator; on a hosted customer it waits for a console step.

## 9. Open questions

### Resolved (2026-11-10, « Mon séjour » from J-7) — Adrien's fourth message accepts every recommended default

- **Q13 — Card payment before the arrival?** ~~Default: no~~. **Resolved 2026-11-10 (owner, fifth message): card allowed
  from J-7** — « J'aimerais aussi que le client puisse payer par CB dans la période J-7 de son séjour. » Rules 67, 85, 86;
  the part-payment of the arrival complement the ledger lacked is the arrival-moment order note of rule 85.
- **Q14 — A stay whose acompte, solde or installment is still due?** Ordering opens on arrival for it (rule 68). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q15 — J-2 too?** J-7 gets the paragraph, the slice-I J-2 paragraph stays as it is. Resolved 2026-11-10 (owner: follows the recommendation).
- **Q16 — Where the paragraph comes from.** The operator script `import.mjs` (rule 70), run by Adrien. Resolved 2026-11-10 (owner: follows the recommendation).
- **Q17 — Stock of an order taken a week ahead.** Held until the arrival day (rule 74). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q18 — The SAS step: information or its own collection?** Information for the money (the recap's single payment
  collects, rule 71), with the edits of rule 87 since the fifth message. Resolved 2026-11-10 (owner: follows the recommendation).
- **Q19 — The bath before the arrival?** Yes, slots strictly inside the stay (rules 65, 69, 78). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q20 — A stay moved with orders on it.** Flagged, never moved (rule 73). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q21 — An offered hour straddling the evening switch?** The free minutes are valued at the day rate across the
  switch; the evening part owes only its supplement (rule 81). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q22 — How many bath sessions per stay from the app?** No cap beyond availability and rule 37's order limits (20 lines,
  500 €); the free minutes count once per stay (rule 25). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q23 — Can the guest cancel an order from the app?** No, as before (rule 38, « Contactez-nous »); the team changes an
  unpaid order at the arrival (rule 87). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q24 — How is the evening supplement paid?** With its order, card or note like the rest (rule 83), never a second time
  by the arrival SAS (hourly rule 38). Supersedes the earlier draft default « on the note, never by card before the
  arrival », written while Q13 was still no. Resolved 2026-11-10 (owner: follows the recommendation).
- **Q25 — Who edits an order at the SAS, and how far?** Admin and reception (door money); the reception on its arrival
  day only; quantities 0 to the article's bound, sessions and mornings removed, never moved (rule 87). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q26 — How a card paid before the arrival meets the arrival complement.** An arrival-moment order note; the engine
  reads the complement net of it (rule 85). Not chosen: holding the order until the arrival is marked (the money would
  reach the books late, possibly in a month already exported). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q27 — A cancelled stay's paid order.** Owed back in full, flagged « à rembourser », refunded by the operator through the
  existing refund of a cancelled stay; no automatic refund at the provider; the cancellation's retention untouched
  (rule 88). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q28 — Heat-up counted from now in the SAS as well?** No: only the guest app passes `heatFrom = now`; the SAS keeps
  max(now, check-in) (rule 79; hourly rule 36). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q29 — Hours already on the reservation, placed from the app?** Yes, first, at no charge but their evening supplement
  (rule 82). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q30 — When does the J-7 name the bath?** When the stay holds the bath's hours or has free minutes of it left, and the
  lodging's shop sells it (rule 89). Resolved 2026-11-10 (owner: follows the recommendation).
- **Q31 — An order emptied at the SAS.** `cancelled` with `cancelReason = 'sas'`, kept with its history (rule 87). Resolved 2026-11-10 (owner: follows the recommendation).

Raised by the browser-side review of 2026-11-09:
- **Q11 — « Reprendre le paiement ».** Resolved the same day: the order view carries `paymentUrl` while an unpaid
  card order's link is live (§4.3), and the order page offers « Reprendre le paiement » beside « Abandonner et
  revenir au panier ».
- **Q12 — `lang="fr"` on French read in English.** Rule 19 falls back to the French per field, but the resolved
  booklet does not say which fields fell back, so the app cannot mark them `lang="fr"` for screen readers. Needs
  `resolvePages` to tag the fallback (e.g. a `lang` beside each picked text).

### Settled while implementing the orders (2026-11-06, lot D server)

Decided by Adrien:
- **The core column `payment_links.basketJson`** is kept (§5): without a marker, `staleLinks`, `retireSettled` and
  the ledger's complement line would read an order's `complement` link as the arrival complement's.
- **Overpayment when a price changes during the 30 minutes** → ignored: the order's note books at most what was
  paid, the engine keeps the rest on the end-of-stay complement, and an excess is neither flagged nor recorded.

Points the rules left open, decided in code:
- The plugin owning a basket settles its payment through `ctx.paymentBasket({ source, paid })`
  (`specs/plugins-phase-1-sdk.md` rule 47); with no live owner the effect is `basket-unallocated` and the usual admin
  alert fires.
- A card payment is a settled mid-stay note (`midStaySettledNotes`, `source: guestOrder`, `ref` = the order id, the provider's reference
  and payment day). `paid_conflict` books no note (it would count as revenue): the link stays paid with `refundOwed`,
  the history says « Remboursement à faire » and the ledger shows « Commande client à rembourser ».
- A late payment on an abandoned order is handled like an expired one: booked if its slots are free, else
  `paid_conflict`. A cancelled stay takes the existing `reservation-cancelled` path and alert.
- Platform stays accept the basket link (extras are paid on the spot).
- A planning option other than breakfast cannot be « Vendu dans l'app » (`NOT_SELLABLE`): it sells by moment, not
  by quantity. A per-person option's ordered quantity adds that many persons served.
- Breakfast: an existing line keeps its persons; more persons than the stay → 400; chosen mornings take the chosen
  time, a morning already prepared keeps that status; a morning outside the stay or at an invalid delivery time
  comes back in `unavailableMornings`.
- Inputs: the same item twice → 400; the quote needs the shop open (409 `SHOP_CLOSED` before arrival);
  `payment: 'none'` with a positive total → 400; a card or note order at 0 € is recorded as `none`.
- Codes: `ITEM_UNAVAILABLE`, `DELIVERY_TIME_UNAVAILABLE`, `CARD_UNAVAILABLE`, `STAY_NOT_WRITABLE` (409); a missing
  delivery time is a 400; the core's `RESOURCE_SLOT_TAKEN` / `SESSIONS_OVERLAP` map to `SLOT_TAKEN` and
  `MID_STAY_EXTRAS_CLOSED` to `SHOP_CLOSED`; `ORDER_NOT_PENDING`, `ORDER_NOT_DELIVERABLE`. The 10 orders per hour and
  session answer 429 `TOO_MANY_REQUESTS`; a refused order does not count.
- `returnPath` is ignored: the return is always `https://<guestHost>/commande/<id>`, built server-side (no open
  redirect); no host configured, no return. A provider failure expires the order and relays the error (502
  `PAYMENT_UNAVAILABLE` by default).
- Delivery moved at payment: the next valid time at or after the one asked; none left → `deliverAt` emptied and
  « Livraison à convenir avec l'équipe ».
- Modules: quote, order, order page and abandon belong to `shop`; the list to `orders`. « Commandes clients »:
  « À préparer » = confirmed or paid, not delivered; « Toutes » = the last 30 days. Reception sees « Marquer livrée »
  and the planning cards, never the list and its amounts (rule 45, 2026-11-10). A planning card lists prepared option lines only (breakfast- or bath-only orders
  have none).
- Push (French, link `/commandes-app?order=<id>`) on creation (note or 0 €), on payment, and on a conflict
  (« Commande client à rembourser »).
- Stored line titles are the French catalogue titles (the quote and the refusals, which store nothing, read the
  request's language, rule 61). The payment link reads « Commande #N », VAT at the stay's
  rate; the history writes « Commande client #N » (+ « — payée par carte »). Abandon returns `cartLines`. « Modifiée
  par l'équipe » shows when a booked session of the order is no longer on the stay record.
- Expiry runs every 60 s (first pass at 30 s) on `heldUntil` (creation + 30 min); the link expires through its own
  lifecycle. Status `abandoned` and columns `deliverMoved`, `paidAt`, `closedAt` are in the unreleased v1 migration.

### Settled while implementing the stay link (2026-11-06, step 13bis)

Points the rules left open, decided in code and recorded here:
- A link session keeps its phase; the app exchanges the link again when it ends (rule 4). A lookup session moves
  from pre-arrival to stay by itself, having no link to exchange.
- A visitor session opened by a link before D-7 lasts 24 h at most and ends at D-7 00:00.
- Regenerating kills every session opened from the link, visitor ones included; since D28 (2026-11-10, rule 54) the
  stay's lookup sessions die with it.
- The poster's visitor `/me` no longer carries `opensAt` / `openingLine` (rule 3); the pre-arrival `/me` does.
- `stayToken` wins when a request sends both `stayToken` and `lodgingCode`.
- A token that no longer decrypts (key changed) is revoked and replaced, like a regeneration.
- The stay-link routes answer 409 for a non-active reservation, a lodging off the app or an unset app host, and
  404 for an unknown reservation. Reception may read and regenerate (it runs the SAS).
- `{{stayAppUrl}}` was first a core template variable; since 2026-11-09 (« cœur générique ») it is the plugin's own
  (`emailContext.js`), its gate-link fallback computed in the plugin, empty while the plugin is inactive; the
  operator writes the sentence in the template under `{{#if hasStayApp}}`. A guest with no
  e-mail address gets no link from the e-mails.
- The `sas.portal` slot: a contribution flagged `leadsStep: { title }` leads the step while its SAS data says
  `available`; the other contributions are passed to it as `gateStep`, so the keypad code shows once
  (`specs/plugins-phase-1-sdk.md`, slots table).
- The SAS line « Le lien vaut jusqu'au… » shows the end of the stay window (check-out + 2 h).

### Resolved (2026-11-09, « cœur générique »)

Adrien: the feature is a plugin — what GuestFlow does not have is built in the plugin; the core keeps only generic
extension points any plugin could use, with no guest-app name or wording, and the money and the reservation write
stay on the core's path (plugins phase 2 rule 2). Applied:
- the session / lookup / order limits live in the plugin (`rateLimiters.js`), no longer in the core's limiters;
- `coreModule('guestOrderCommit')` became `coreModule('midStayOrderCommit')`: the caller names its order (`source`,
  `ref`) and writes the history entry in its own words;
- `ctx.paymentBasket({ source, paid, labels })`: the ledger row of a basket to refund reads its owner's words, the
  core's neutral « Paiement en ligne à rembourser » otherwise; the provider origin is `basket`;
- a resource hold carries its `label` (« Commande client en attente de paiement »), hourly-resources showing
  « Créneau réservé, en attente » for a hold without one;
- `{{stayAppUrl}}` is the plugin's own e-mail variable (rule 9bis b); a plugin e-mail variable may name its e-mails
  (`in`).

### Resolved (2026-11-08, review of the boards v5)

Adrien validated the four remaining verdicts as drawn on the boards v5:
- **Stock** → rules 37bis-37quater as written: one stock for the estate, none on the bath, the site and the staff
  never blocked, « Stock bas » / « épuisé » pushed to the staff.
- **Delivered or picked up** → rules 41bis-41ter as written.
- **Studio built from GuestFlow** → rule 48 as written; the lot A `displayName` is removed server-side.
- **Tablet / desktop** → rule 51 as written: navigation rail and two-pane booklet and shop from 900 px, content
  capped at 1200 px from 1200 px.

### Resolved (2026-11-06, review of the boards v4)

Adrien's verdicts: phone app, studio, Réglages › Intégrations card, Commandes clients validated; the editors'
« Application clients » section to rework with a stock.
- **Tile** « Soliomap » → « Activités » (rule 15).
- **When and where the order is ready** → rules 41bis-41ter: one estate-wide setting delivered / to pick up with a
  free-text pickup place; the guest keeps « Dès que possible » or a later time; the summary states the time (the
  longest preparation of the order's staff items) and the place; activities such as the bath are not concerned.
- **Studio built from GuestFlow** → rule 48: lodgings, names, articles read live; « Synchroniser » for the
  Soliomap feed only.
- **Stock** → rules 37bis-37quater: count + « En rupture », edited in GuestFlow only, every sale counts on the day the
  article leaves (arrival day for lines booked ahead), the app alone stops selling at 0, the staff is pushed.
- Tablet / desktop: no verdict yet, asked again on the boards v5 (validated 2026-11-08, see above).

### Resolved (2026-11-06, review of the boards v3)

- **Q10 — How the guest opens the app** → option A: one link per stay, shown as the QR of the arrival SAS step in
  place of the gate QR and sent in the J-7 / J-1 e-mails; it proves the stay, no name is ever asked; the lodging
  poster opens the visitor mode only (rules 1-9bis, 33).
- **Q8 — Soliomap framing** → Soliomap allows `sejour.domainesolio.com` (solioMap PR #34, edge note homelab PR
  #40; Safari checked on an iPhone once deployed); the studio switch « Intégrer dans l'app » is turned on once that change is live (rule 15).

### Resolved (2026-11-05, review of the boards v1)

- **Q1 — Booklet content** → the user's own complete booklets of both lodgings, entered in a dedicated slice
  (plan, slice I); until then the booklet holds neutral placeholder pages.
- **Q2 — Guest host** → `sejour.domainesolio.com`.
- **Q3 — App name** → « Domaine Solio », subtitle « Mon séjour ».
- **Q9 — Sold at launch** → the breakfast, the nordic bath, and every option of the GuestFlow categories
  « Boissons » and « Alimentation ». Nothing else is flagged at launch.
- **Bath picker** → only bookable slots are listed, without the « bain déjà chaud » note (§6.4 `SlotGrid`).
- **Activity suggestion** → one dated Soliomap event on the home (rule 15bis).
- **Home photo** → the hero of domainesolio.com by default, per lodging in the studio (rule 11ter).

### Resolved (2026-11-04)

- **Identification** — *(superseded on 2026-11-06 by Q10: one link per stay)* lodging QR + current stay;
  fallback last name + reservation number.
- **Payment** — the guest chooses card (Qonto `complement` link) or end-of-stay bill (rules 33-36).
- **Hosting** — served by GuestFlow, plugin `guest-app`, `/public/v1/guest/**` with a per-stay session; the
  catalogue projections are those of the website-booking API on `inte/plugins` (rules 4, 24).
- **Gate** — the gate app already exists: the tile opens the stay's Sowel key link, no gate screen is built
  (rules 12-14). The gate link is served to stay sessions only, opened from the stay's own link (Q10, 2026-11-06), so a photo of
  the lodging poster never reaches it.
- **Soliomap** — existing app at `map.domainesolio.com` (address corrected 2026-11-05), opened from a tile (rule 15).
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
- **Per-lodging configuration** — what the app shows (modules, wifi and other lodging facts) and the booklet
  are configured per lodging; common content can be shared without being copied (rules 11bis-11quater,
  16-17, 48).
- **Visual identity (Q6)** — the guest app wears the Domaine Solio charter of the site and the gate app
  (Marcellus + Karla, sapin / ocre / paper, square buttons, night register); the studio and the admin page
  stay GuestFlow « Maison »; both share the semantic colours and formats (§6.0-§6.3).
- **Accepted as proposed** — PageActionBar exception for the guest app (§6); 30-min card link lifetime
  (rule 35).

## 10. Implementation progress

| Slice | State |
|---|---|
| A — Plugin, lodgings, sessions | Done on `feature/guest-app-plugin` (2026-11-05); A6 (Q10, one link per stay, step 13bis) done 2026-11-06: stay links, poster visitor-only, name confirmation removed, SAS « Mon séjour », `{{stayAppUrl}}`; the fiche's « Lien Mon séjour » has its server routes, its card comes with the UI lots |
| B — Sellable catalogue (server) | Done (2026-11-05): items routes, shop payload, catalogue projections moved to the core (`publicCatalogProjection`, SDK 2.26.0); full server suite 10 561 / 10 561 |
| C — Planning and service hours (server) | Done (2026-11-05): `ctx.resourceScheduler` / `ctx.resourceHolds` (SDK 2.26.0), hourly-resources 1.5.0, slots, delivery times, service hours; full server suite 10 591 / 10 591 before the last change, targeted suites green after it |
| E — Booklet and studio API (server) | Done (2026-11-05): booklet per lodging with shared pages and versions, studio API, media, QR poster, the Soliomap suggestion (`safeFeedFetch`, `instancePaths` core modules, SDK 2.26.0); guest-app suites 186 / 186, full suite 10 631 / 10 632 (the one failure is a core baseline that fails between 0 h and 1 h Paris time on the previous commit too) |
| D — Orders and payment (server) | Done (2026-11-06): quote and orders priced by the fiche's engine, note / 0 € / card, the core commit `midStayOrderCommit` (generic since 2026-11-09), `complement` basket links (`ctx.paymentBasket`, `ctx.core.payments`, `payment_links.basketJson`, SDK 2.26.0), abandon, expiry, late payment and `paid_conflict`, push, the orders list and planning cards (server); +56 server tests. The page and the card wait for the UI lots |
| F-G — Guest app, studio, GuestFlow screens | Done (2026-11-09). The studio (`feature/guest-app-studio`): every screen of rules 47-50, the phone preview, 27 tests, plus `GET /api/guest-app/items?propertyId=`. The GuestFlow screens (`feature/guest-app-admin`): « Application clients » in the option / resource editors with the stock, « Stock : épuisé », « Commandes clients » (admin), the planning card, « Lien Mon séjour », « Ouvrir le Studio »; generic client points (SDK rule 49). Both apps moved into the plugin's folder and shipped in its package (SDK rule 48). Earlier: unblocked: every review-board verdict given (2026-11-08). Server side done 2026-11-09 (`feature/guest-app-server`): stock (rules 37bis-37quater), delivered or picked up (41bis-41ter), the studio's lodgings and settings read live with « Synchroniser » (48, `displayName` removed), the gate tile and `/gate` (12-14), `isNight`, the manifest (52), and the serving of both builds through `ctx.webApp` (plan step 50); guest-app suites 274 / 274. The screens come next. Guest app (slice F) built 2026-11-09 on `feature/guest-app-pwa`: every screen of §6.6 on the boards v5, offline booklet, install, FR / EN, night; 41 client tests; first load 151 kB gzip; walked at 390 / 900 / 1280 px, day and night, EN, against the plugin's routers; axe 0 serious on every screen in both registers. The studio (slice G) is next |
| H — Hardening and rollout | Audit round 36 (2026-11-10, `fix/audit-r36-guestapp`, guest-app 1.0.1): rules 54-59, readings of rules 6, 18, 19, 41, 45; D28 applied. Round 36b: rules 23, 54, 59 amended (exact core number shape, per-person resources refused, photos erased after the commit), the free-unit exemption pinned. Rollout not started |
| I — Booklet content | Ready (2026-11-09): the two PDF booklets (La Granja 20 pages, L'Estiva 14) rewritten as one bilingual booklet of 17 pages (15 shared, lodging-only pages and blocks restricted), validated by Adrien on the review board `specs/guest-app-livret-planches.html` (every recommended decision, A2 « accueil en personne »; loop lengths, the Google review and Instagram links left for later). Source `specs/guest-app-livret/livret.mjs`; `node specs/guest-app-livret/import.mjs --base <GuestFlow> --email <admin> [--dry-run]` writes it through the studio API once guest-app is installed (refuses a booklet the operator already edited; deletes the starter pages; publishes both lodgings). The same script first adds the « Mon séjour » paragraph to the J-2 e-mail, in French and English, under `{{#if hasStayApp}}` before « Un imprévu… » (Adrien, 2026-11-09: J-2 only, not J-7); it skips a template that already has `{{stayAppUrl}}` and stops when it finds no anchor. Tried on a local GuestFlow: 16 + 15 pages published, nothing untranslated, rendered in the guest app; the J-2 preview carries each stay's own link. Run in production by the operator, never by Claude |
| J — « Mon séjour » from J-7 (2026-11-10) | Spec written (Draft) on `feature/guest-app-from-j7`: rules 65-76, readings of rules 2, 9bis, 11bis, 27, 33, 34, 37ter, 38, 41, 44, 45; summary `specs/guest-app-j7-resume.html`. Amended the same day by Adrien's second to fifth messages: rules 77-89 added, 66, 67, 69, 70, 71, 72, 76 amended, Q13-Q31 resolved, `hourly-resource-quantity-and-sas-scheduling.md` rules 36-38. Implemented (2026-11-10): core `midStayOrderCommit` (arrival measure, card note, hours first, charges, `amendOrder`), pricing net of arrival notes, `hourly-resources` 1.6.0 (`heatFrom`, day-rate free minutes, `orderSupplement`), `guest-app` 1.1.0 (J-7 sessions, shop, bath, cancellation, SAS data and `amend`, e-mail flags), guest app (payment choice, pickers), GuestFlow SAS step « Commandes Mon séjour ». Readings: `changed` in the SAS payload is true when an order of the stay was amended at the SAS; the flag of rule 88 clearing on refunds is not implemented (the operator reads the ledger); `hasStayAppShopOnly` added to the J-7 paragraph (the renderer does not nest) |

The whole spec ships in ONE pull request (the user's decision of 2026-11-05): the spec-coverage gate refuses
code citing a spec that is still Approved, and only a spec moved to Implemented with every rule cited passes it.
