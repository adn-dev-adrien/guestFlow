# Guest app « Mon séjour » — booklet, gate, Soliomap and in-stay shop

| Field | Value |
|---|---|
| **Status** | Approved (2026-11-04) |
| **Branch** | `claude/granja-estival-app-spec-77uvgj` (spec) — implementation base `inte/plugins` |
| **Created** | 2026-11-04 |
| **Author** | Adrien |
| **Related PR** | (slice A: link once opened) |
| **Mock-ups** | [`specs/guest-app-maquettes.html`](guest-app-maquettes.html) |
| **Review boards** | [`specs/guest-app-planches.html`](guest-app-planches.html) — v5 (2026-11-06): stock per article, delivered or picked up, studio read from GuestFlow, tablet / desktop — validated 2026-11-08, slices F-G unblocked |
| **Plan** | [`specs/guest-app-plan.md`](guest-app-plan.md) |
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
     gate, no order);
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
   `propertyId` (+ the link's id), returned as an `HttpOnly; Secure; SameSite=Strict` cookie `gf_guest` scoped to
   `/public/v1/guest` (32 random bytes, only its SHA-256 stored), expiring at the window's end (pre-arrival: when
   the window opens). The app keeps the stay link on the device and exchanges it again when a session ends, so a
   pre-arrival session becomes a stay session by itself at H-3. The same device reopening the link during the same
   phase reuses its session; two devices have two sessions on the same stay.
5. **Visitor mode.** The lodging's booklet, Soliomap and the wifi; « Bienvenue à La Granja » without any personal
   data; no gate, no shop, no orders. A visitor session (`reservationId` NULL) lasts 24 h.
6. **Fallback, from anywhere: name + reservation number.** `/retrouver` asks the last name and the reservation
   number (`reservations.reservationNumber`, which carries the platform's number for OTA stays filled by the
   intake skills) and opens the same session as the stay link would (pre-arrival or stay), from **J-7 00:00**
   until the window's end. One generic error for every failure (« Nous n'avons pas trouvé ce séjour. Vérifiez le
   nom et le numéro. »), 5 attempts / 15 min per IP, constant-time comparison.
7. **Name matching** (the fallback only). Normalised on both sides: NFD, accents stripped, lower-case, every
   non-letter removed (`Le Goff-Durand` = `legoffdurand`). Compared to the reservation's client `lastName`.
8. **Data minimisation.** A session reads only: the guest's first name, lodging name, arrival / departure
   instants, party size, language, its own stay's orders. Never the email, phone, address, amounts of the stay,
   nor any other stay. The visitor mode reads no personal data at all.
9. **Session end.** At its expiry the session is dead (401 `SESSION_EXPIRED`); the app reopens the stored link,
   or falls back to the lodging's visitor mode, keeping the booklet. A cancelled or deleted reservation, a
   regenerated link and a lodging switched off kill their sessions on the next request.
9bis. **Where the link is given.** (a) The arrival SAS: while `guest-app` is active and the lodging enabled, its
   « Portail » step becomes « Mon séjour » — the QR of the stay link (« Flashez pour ouvrir Mon séjour : le portail,
   le livret, la boutique et le bain »), the gate keypad code, « Partager » (native share sheet, else « Copier le
   lien »), « Régénérer le lien », and a discreet « QR du portail seul » that shows today's gate QR for weak
   coverage. Plugin inactive, lodging disabled → the step is today's gate step, unchanged (contribution through
   the existing `sas.portal` slot, rule 22). (b) The J-7 and J-1 reminder e-mails: the plugin contributes the
   variable `{{stayAppUrl}}` and its sentence; while the plugin is inactive, the lodging disabled or the stay has
   no e-mail, the e-mails keep the gate link (`{{gateAccessUrl}}`) as today. (c) The fiche: « Lien Mon séjour »
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
    first bookable hour (a slot in state `free` or `evening` remains today and the resource is sold in the app), « Votre commande est prête » (an order marked delivered in the last hour),
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
    keeps `shop` but has no `gate`, `bath` or `orders` (rules 5, 6). By default the six modules of rule 10 and
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
13. **Source and window.** The URL is read from the `gate-access` plugin (`gate_key_results` of the stay)
    and returned only for a stay session inside the gate window. Before the key exists (Sowel has not pulled
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
    switch, not detected at runtime.
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
    visitor or a pre-arrival session) is not rendered.
19. **Languages.** Every text field has FR and EN. The app language is the guest's `clients.emailLanguage`
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
    - options: `per_stay` (unit), `per_person` (unit = one person), `free` (always included), and the breakfast
      (rule 27bis); an internal option (`displayToClient = 0`), the cancellation insurance and the auto timed
      options (early check-in, late check-out) never;
    - resources: hourly resources (`per_hour`, scheduled — the nordic bath) and the `per_stay`, `per_person` and
      `free` resources, each only with an explicit `resource_properties` link to the stay's lodging.
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
    An order whose quote total is **0 €** (only free / included units) needs no payment and no name: one
    button « Réserver », the order is `confirmed` and written to the fiche like a note order (rule 34).
26. **Categories.** Items are grouped by the existing option `category` (e.g. « Boissons »,
    « Alimentation », « Bien-être »), in the core's category order (French collation, `groupOptionsByCategory`) until the studio gets a category
    order, and inside a category by the plugin's `sortOrder`, then title; hourly resources appear in « Bien-être »;
    items without a category and non-hourly resources come last under « Autres ». An empty category is not shown.
27. **When the shop is open.** Exactly when the core mid-stay extras window is open for the stay
    (`midStayExtrasWindow.js`: from `startDate` until the end-of-stay complement is collected). Pre-arrival sessions see the catalogue read-only (a visitor has no shop, rule 11bis) with « Disponible pendant votre séjour ». After the
    complement is collected: « La boutique est fermée. Bon retour chez vous ! ».
27bis. **Breakfast** (decided 2026-11-05 with Q9). The seeded breakfast option (`autoOptionType='breakfast'`,
    `per_person_per_night`, `utils/breakfastSeed.js`) is sellable despite rule 23's exclusion of its price
    type. Ordering it means choosing the mornings left in the stay, the number of people (up to the party size) and
    the hour: one hour chosen applies to every chosen morning where it is a valid delivery time (rule 41), a
    morning where it is not is shown unavailable at that hour; each morning keeps its own time in the stay's
    breakfast line `cardOccurrences`. Priced per person and night by the core engine, shown to the guest « par
    personne et par matin »;
    it appears on the planning's `BreakfastDayCard` only, never on a « Commande client » card. A stay that already
    includes it orders it at 0 €, which only sets its mornings and hour. Staff-prepared items also follow the
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
    removed or moved session is re-checked under rule 31.
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
    prices.
33. **Two ways to pay, the guest chooses** at checkout (for a non-zero total):
    - **« Payer maintenant »** (card): the server creates the order `awaiting_payment` and a Qonto payment
      link of type `complement` for exactly its total, with the order's lines as VAT basket; the app
      redirects to Qonto; the return lands on `/commande/<id>` which polls the order status.
      No name asked — the stay link is the proof (rule 2).
    - **« Ajouter à ma note »** (end-of-stay bill): no name asked either (rule 2); the order is `confirmed` at
      once and its lines join the stay's end-of-stay complement, collected at the departure SAS as today.
    « Payer maintenant » is hidden while the `online-payment` plugin is inactive or Qonto is disconnected.
34. **How an order lands on the fiche.** A confirmed order (note or 0 €) or a paid order (card) is written
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
    once, its lines back in the cart). At payment, a `deliverAt` earlier than payment + lead moves to the next valid slot and the order says so.
36. **Unpaid card order.** If the link is not paid within 30 min the order goes `expired`, its holds are
    released, nothing reaches the fiche. A payment confirmed after expiry (late webhook) still commits the
    order if its slots are still free; otherwise the order goes `paid_conflict`, the operator is pushed, and
    refunds by hand (refund out of scope). A `paid_conflict` payment is recorded on the reservation ledger as a
    `complement` payment flagged « à rembourser », with a history entry; no line is added. A late payment whose
    `deliverAt` is already past moves to the next valid delivery time and the order says so.
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
    have no stock: the resource planning is their truth (rule 28).
37ter. **Every sale counts, when the article leaves the cellar** (Adrien, 2026-11-06). The stock goes down for the
    app's orders *and* for the lines the website or the staff put on a reservation, at the moment the article is
    actually taken:
    - an app order counts when it is confirmed (note, 0 €) or paid (card); a card order **holds** its units while it
      awaits its payment (rule 35) and releases them when it expires or is abandoned;
    - a line already on the reservation counts on the **arrival day** of the stay (the plugin's daily task at
      00:05, and at once for a stay created or moved to a start date already reached); a line added or raised
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
    the units left, and the cart shows the line « Plus que 1 disponible » with the quantity lowered. The website keeps
    selling it for future stays (the cellar will be restocked) and the reservation editor shows a warning
    « Stock : épuisé » without blocking. Reaching the « Prévenir sous » threshold, then 0, pushes the channel
    « Commandes clients » once each (« Stock bas : Cidre — plus que 3 », « Cidre épuisé ») until the next restock.
    A late card payment (rule 36) whose units are no longer available goes `paid_conflict`, like a taken slot.
38. **Order follow-up.** « Mes commandes » lists the stay's orders with status chips: *En attente de paiement*, *Payée*, *Sur votre note*, *Offerte* (0 €), *Payée · à rembourser* (`paid_conflict`), *Expirée*, *Abandonnée*; a second chip *Prévue {jour heure}* / *Livrée* for orders with a delivery, *Prête {jour heure}* / *Retirée* in
    pickup mode (rule 41bis). An
    unpaid card order shows « Paiement par carte en attente » and no preparation step until it is paid. The guest cannot cancel a
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
    recevoir ? » with server-computed delivery times t (30-min steps) such that check-in ≤ t < check-out and the preparation
    interval [t − max(leadMinutes), t] lies after *now* inside one service range. Delivery times have no
    capacity limit (decided 2026-11-05): an order holds no delivery slot and there is no `DELIVERY_SLOT_GONE`. The first slot is preselected, labelled « Dès que possible — vers 17 h 30 » only while the service is open now.
    No service hours stored at all (neither shared nor per lodging) = no constraint: the service counts as always
    open and the plugin's setup status says « horaires du service à configurer ». Once anything is stored, a day
    without a range is closed. While nothing is stored, establishment closures are not applied either (a closed
    domain has no stay in progress). An ignition may fall at the very end of a range.
41bis. **Delivered or picked up — one setting for every lodging** (Adrien, 2026-11-06). Studio › Réglages ›
    Service holds « Les commandes sont… » **Livrées au logement** (default) | **À retirer**; « À retirer » asks for
    the **pickup place**, one plain text field (e.g. « À l'accueil, maison principale — sonnez à la porte
    verte »), required to save, relayed as typed in both languages. Pickup mode only changes the words: the cart asks
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
    through `planning.days`), with the lines and a « Livrée » check.

### 3.H Staff side

44. **Push.** Every confirmed or paid order pushes the new channel **« Commandes clients »**, **once**: an order put
    on the end-of-stay complement (or at 0 €) pushes as soon as it is confirmed; a card order pushes **only once
    paid**, never while it awaits its payment, nor when it is abandoned or expires (Adrien, 2026-11-06)
    (`guest-orders`, declared by the plugin with `ctx.pushChannel`, whose keys are kebab-case) to subscribed staff: « L'Estiva · Marie —
    2 × Cidre pour 18 h, 1 h bain nordique ven. 20 h (sur la note) » (pickup mode: « … à retirer 18 h »). The push opens the order in GuestFlow.
45. **Orders list in GuestFlow.** A page *Commandes clients* (the same name as the push channel, review of
    2026-11-05) (contributed by the plugin; sidebar, under the
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
52. **Installable PWA.** Manifest (name from the studio, theme fir-green), icons, standalone display,
    offline shell + booklet (rule 21). After the second visit a discreet « Installer l'app » card (Android
    `beforeinstallprompt`; iOS: a sheet with the share → « Sur l'écran d'accueil » steps). Never on first load.
53. **Look & feel** — §6: the Domaine Solio identity of the site and the gate app (Marcellus + Karla,
    sapin / ocre / paper, square-cut, photo-led), the night register at night, one orchestrated motion per
    screen, WCAG AA in both registers, 44 px touch targets.

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
| `plugins/guest-app/` | `manifest.json`, `index.js` | C | Declares the plugin, push channel `guest-orders`, settings, migrations, public + admin mounts, the expiry runner |
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
| `plugins/guest-app/controllers/` | `ordersAdminController.js` | C | Orders list, mark delivered, the planning's « Commande client » cards (rules 43, 45) |
| `plugins/guest-app/` | `orderLabels.js` | C | Pure: the chips, notices, line labels and the staff push text (rules 38, 44) |
| `plugins/guest-app/controllers/` | `lodgingsController.js` | C | Read/write the per-lodging configuration, validated at the boundary (rules 11bis-11quater) |
| `plugins/guest-app/models/` | `lodgingsModel.js`, `sessionsModel.js`, `staysModel.js`, `itemsModel.js`, `bookletModel.js`, `ordersModel.js`, `mediaModel.js`, `serviceHoursModel.js` | C | DB access (prepared statements). `staysModel.js` holds the only SELECT of a reservation on the session path: rule 8's minimisation is its column list |
| `plugins/guest-app/` | `modules.js` | C | Pure: the modules a lodging shows, from its configuration, the facts and the session's mode (rule 11bis) |
| `plugins/guest-app/` | `settings.js` | C | The declared settings and their checks (§5) |
| `plugins/guest-app/` | `currentStay.js` | C | Pure: lodging + instant → current stay (rules 2, 3, 5, 6) |
| `plugins/guest-app/` | `nameMatch.js` | C | Pure: normalisation + comparison, for the fallback lookup only (rule 7) |
| `plugins/guest-app/models/` | `stayLinksModel.js` | C | The stay links: create on first need, read back for the SAS / e-mails / fiche, regenerate (rule 1); a token that no longer decrypts is replaced like a regeneration |
| `utils/` | `emailContextBuilder.js` | T | `{{stayAppUrl}}` = the guest app's stay link, else the gate key's `{{gateAccessUrl}}`, else empty (rule 9bis b) |
| `utils/` | `templateTokens.js` | T | `stayAppUrl` « Lien Mon séjour » in the catalogue (J-7, J-2 chips): a core variable, so it exists, with its fallback, while the plugin is absent; the plugin declares only the flag `hasStayApp` « Si lien Mon séjour » |
| `plugins/guest-app/` | `sellable.js` | C | Pure: which items a lodging's shop shows and their free / included state (rules 23, 25) |
| `plugins/guest-app/` | `serviceHours.js` | C | Pure: open ranges for a date, next opening, delivery slots from now + lead time to check-out, ignition-in-hours check (rules 31, 40-42) |
| `plugins/guest-app/` | `homeHighlight.js` | C | Pure: status line + the single highlight (rules 10, 11) |
| `plugins/guest-app/` | `soliomapFeed.js` | C | Reads Soliomap's `GET /api/activities` (outbound HTTPS, 1 h cache, 5 s timeout; a failure → no card) and picks the stay's suggestion (rule 15bis) |
| `plugins/guest-app/` | `orderExpiryRunner.js` | C | Every minute: expire unpaid orders, release holds (rule 36) |
| `plugins/guest-app/` | `planningCards.js` | C | `planning.days` server feed: « Commande client » cards on the delivery day (rule 43) |
| `plugins/guest-app/` | `migrations.js` | C | Tables of §5 |
| `utils/` | `publicCatalogProjection.js` | C | `toPublicOption` / `toPublicResource` moved out of `website-booking/publicProjections.js` (which imports them back) so the guest app does not depend on the website plugin |
| `plugins/sdk/createContext.js` · `coreServices.js` | — | T | Three SDK hooks: `ctx.resourceScheduler(provider)` (one provider app-wide, like `paymentProvider`), `ctx.resourceHolds(fn)` and `ctx.paymentBasket({ source, paid })` (rules 35-36); the core exposes `coreServices.resourceScheduler()` and `coreServices.payments` — plugins never `require` each other |
| `plugins/hourly-resources/` | `index.js` | T | Declares the scheduler: `slotsForStay` (occupancy + `buildDays` + `priceSessions`, rule 28), `validateSessions`; reads every holds source as pending occupancy in **every** consumer (planning page, SAS picker, outside bookings) |
| `plugins/gate-access/` | `index.js` | T | Declares a gate-key provider hook (`keyUrlForReservation(id, now)`, rules 12-13); `window.js` moves to core `utils/stayWindow.js` |
| `utils/paymentRequestService.js` | — | T | `complement` link type with explicit basket and 30-min lifetime (rule 35) |
| `utils/` | `basketPayments.js` | C | `ctx.core.payments`: mint, read on demand and withdraw a basket's link (rules 33, 35) |
| `models/paymentLinksModel.js` · `utils/ledgerLinks.js` · `utils/reservationLedger.js` | — | T | `basketJson` read and written; a basket link is no bucket's link (stale, settled, the complement row); the ledger row « Commande client à rembourser » (rule 36) |
| `utils/paymentPollRunner.js` | — | T | `applyPaidEffect` `complement` branch → `guestOrderCommit` |
| `utils/` | `guestOrderCommit.js` | C | **Core**: commits an order's lines (options + resource sessions) as mid-stay extras, records a complement payment when paid, history entry — one transaction (rules 30, 34, 35) |
| `utils/` | `stayWindow.js` | C | The stay window, moved from `gate-access/window.js` (rule 2) |
| `plugins/sdk/index.js` | — | T | Add `stayWindow`, `encryption` (SDK 2.22.0), `guestOrderCommit`, `pricing` free-units helper, `midStayExtrasWindow` to `CORE_MODULES` (one reviewed line each) |
| `middleware/` | `rateLimiters.js` | T | `guestSessionLimiter` (30/h/IP), `guestLookupLimiter` (5/15 min/IP), `guestOrderLimiter` (10/h/session), each `GUEST_*_RATELIMIT_*`-overridable |
| `index.js` | — | T | Serve the guest app build on the guest host and the studio build at `/studio` (only while the plugin is live) |
| `database.js` | — | T | `payment_links.basketJson` (nullable), through `utils/paymentLinksProviderMigration.js`: the only core column, the link's own basket (rule 35); everything else is in plugin migrations |

New dependency: `qrcode` (server, QR poster + wifi QR) if not already present; `pdfkit` already serves the
devis PDF.

### 4.2 Client side

Two new Vite apps in the repo (`apps/guest/`, `apps/studio/`, shipped inside the `guest-app` plugin
package by `scripts/build-plugin-packages.mjs`), plus plugin contributions to the GuestFlow admin client.

**`apps/guest/` — the guest PWA** (React, MUI with its own theme `apps/guest/src/theme.js` carrying the Domaine Solio
tokens of §6.1 and GuestFlow's semantic colours, React Router; fonts Marcellus + Karla self-hosted in
`apps/guest/public/fonts/`; icons `lucide-react`):

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `HomePage`, `BookletIndexPage`, `BookletPage`, `ShopPage`, `SlotPickerPage`, `CartPage`, `OrderPage`, `OrdersPage`, `SoliomapPage`, `LookupPage`, `LodgingEntryPage` (`/l/:code`) | C | Route-level views |
| `components/` | `AppShell` (`TabBar` / `NavRail`), `HeroHeader`, `StayCard`, `QuickTile`, `MomentCard`, `PhotoCard`, `BlockRenderer` + one renderer per block type, `ProductCard`, `ProductSheet`, `QuantityStepper`, `SlotGrid`, `DeliveryTimeChips`, `ServiceHoursBanner`, `CartBar`, `PaymentChoice`, `OrderTimeline`, `StatusChip`, `InstallPrompt`, `OfflineBanner` | C | Rendering only — anatomy in §6.4 |
| `services/` | `api.js` | C | `fetch` with credentials, error envelope → typed errors |
| `hooks/` | `useSession`, `useCart` (local state + localStorage), `useOrderStatus` (poll) | C | UI state |
| `i18n/` | `fr.json`, `en.json` | C | App chrome strings (booklet content comes from the server) |
| `public/` | `manifest.webmanifest`, `sw.js`, icons | C | Install + offline booklet |

**`apps/studio/` — the booklet studio** (React, MUI using GuestFlow's `client/src/theme.js`):

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `PagesListPage`, `PageEditorPage`, `ShopItemsPage`, `ServiceHoursPage`, `MediaLibraryPage`, `AppSettingsPage` | C | Studio screens |
| `components/` | `BlockPalette`, `BlockEditor` (one per type), `BilingualField`, `PhonePreview` (imports `apps/guest/` renderers), `ImageCropper`, `SortableList`, `WeeklyHoursEditor` | C | Editing UI |

**`client/` (GuestFlow admin) — only through the plugin's client module `client/src/plugins/guest-app/`:**

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/guest-app/` | `index.js` | C | Contributions: `options.fields`, `resources.fields`, `routes` (`/commandes-app`), sidebar entry, `planning.days` card, `settings.integrations` card |
| `plugins/guest-app/` | `SasStayAppStep.jsx` | C | The SAS « Mon séjour » step (rule 9bis a): the stay link's QR and validity line, the keypad code, Partager / Copier le lien, Régénérer le lien (confirmed first), « QR du portail seul » unfolding the gate step. Contributed to `sas.portal` with `leadsStep: { title: 'Mon séjour' }` |
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | A `sas.portal` contribution with `leadsStep` takes the « Portail » step (and its title) while its plugin's SAS data says `available`; the other contributions are handed to it as `gateStep` (without the keypad code, shown once). Otherwise today's step |
| `plugins/guest-app/` | `SettingsGuestAppSection.jsx` | C | « Application clients » card of Paramètres › Intégrations: the guest host, saved by the page's bar. The link to the studio joins it with slice G, when `/studio` exists |
| `plugins/guest-app/` | `GuestAppItemFields.jsx` | C | « Application clients » section of the option / resource editor (rule 22) |
| `plugins/guest-app/` | `GuestOrdersPage.jsx`, `PlanningOrderCard.jsx` | C | Orders list (rule 45) and planning card (rule 43) |
| `pages/options/` | option editor panel | T | New contribution point `options.fields`, rendered like `resources.fields` in `ResourceEditorPanel.jsx` — empty when no live plugin contributes |

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
| POST | `/public/v1/guest/sessions/lookup` | — | `{ lastName, reservationNumber }` | same; 404 `STAY_NOT_FOUND` generic |
| GET | `/public/v1/guest/me` | session | — | stay / pre-arrival: `{ mode, guest:{firstName}, lodging, stay:{arrival,departure,partySize,statusLine}, language, tiles:[…], suggestion?:{id,name,category,dateLabel,driveLabel,url}, highlight?:{key,text,module,page?} }`; a pre-arrival session on the arrival day, before the window, adds `opensAt` and `openingLine`; visitor: `{ mode, lodging, language, tiles:[…], welcome }` — nothing of any stay (rule 3); dead session 401 `SESSION_EXPIRED` |
| GET | `/public/v1/guest/booklet?lang=` | session or `lodgingCode` | — | `{ version, pages:[{slug,icon,title,cover}] }` |
| GET | `/public/v1/guest/booklet/pages/:slug?lang=` | idem | — | `{ slug, title, cover, blocks:[{type, …}] }` |
| GET | `/public/v1/guest/booklet/search?q=&lang=` | idem | — | `{ results:[{slug,title,excerpt}] }` |
| GET | `/public/v1/guest/lodging` | session or `lodgingCode` | — | `{ name, heroUrl, modules:[{key, label, order}], wifi?:{network, password, note?, joinQr}, contacts:[…] }` — only enabled modules / configured facts |
| GET | `/public/v1/guest/gate` | stay session | — | `{ state:'active'\|'preparing'\|'outside', url? }` |
| GET | `/public/v1/guest/shop` | stay or pre-arrival session (visitor → 404 `MODULE_OFF`) | — | `{ open, closedReason?, service (slice C), canPayCard, canPayNote, categories:[{ name, items:[{ kind:'option'\|'breakfast'\|'resource', id, title, shortDescription, imageUrl, price, priceLabel, priceUnitLabel, included?, includedLeft?, freeLeftLabel?, maxQuantity, needsStaff, scheduling?:'hourly', unavailableReason? }] }] }`; a `breakfast` item adds `state:'included'\|'sold'`, `defaultTime`, `mornings:[{date,label}]`, `occurrences:[{date,time}]` |
| GET | `/public/v1/guest/shop/resources/:id/slots?from&to` | stay session, `shop` module | — | `{ freeMinutesLeft, freeLabel?, days:[{date, label, slots:[{start, end, state:'free'\|'evening', priceLabel}]}] }` — bookable slots only, days without one dropped; 404 `ITEM_NOT_FOUND` (not a sold hourly item here, or `hourly-resources` inactive), 400 `INVALID_INPUT` |
| POST | `/public/v1/guest/shop/delivery-slots` | stay session | `{ lines:[{kind, id}] }` (1-20) | `{ needed, asap:{at,label}\|null (null while the service is closed), days:[{date, label, slots:[{at, label}]}], bannerLabel? }`; lead = the longest `leadMinutes` of the cart's staff items |
| POST | `/public/v1/guest/orders/quote` | stay session, `shop` module, shop open | `{ lines:[{kind:'option',id,quantity} \| {kind:'resource',id,sessions:[{date,start,end}]} \| {kind:'breakfast',id,mornings,time,persons}], deliverAt? }` | `{ lines:[{kind, id, title, label, quantity?, sessions?:[{…, unavailable?, reason?, reasonLabel?}], mornings?, unavailableMornings?, unitPrice, total, totalLabel, unavailable?, unavailableReason?}], total, totalLabel, needsDelivery, deliverAt?, deliverAtUnavailable? }`; 409 `SHOP_CLOSED`, 400 `INVALID_INPUT` / `ORDER_LIMIT` |
| POST | `/public/v1/guest/orders` | idem, 10 / hour / session | `{ lines, deliverAt?, payment:'card'\|'note'\|'none', returnPath? }` | card → `{ orderId, paymentUrl }`; note/none → `{ orderId, status:'confirmed' }`; 409 `SLOT_TAKEN`, `OUT_OF_STOCK` (`{ itemKey, left }`), `ITEM_UNAVAILABLE`, `DELIVERY_TIME_UNAVAILABLE`, `SHOP_CLOSED`, `CARD_UNAVAILABLE`, `STAY_NOT_WRITABLE`; 400 `ORDER_LIMIT`, `INVALID_INPUT`; 429 |
| POST | `/public/v1/guest/orders/:id/abandon` | idem | — | the order, `abandoned`, with `cartLines`; 409 `ORDER_NOT_PENDING` |
| GET | `/public/v1/guest/orders` | stay session | — | `{ orders:[{id, createdAt, deliverAt, lines, total, payment, status, statusLabel}] }` |
| GET | `/public/v1/guest/orders/:id` | stay session | — | one order (triggers the on-demand Qonto poll like `/booking-requests/:id/status`) |
| GET | `/public/v1/guest/manifest.webmanifest` | — | — | manifest with the plugin's app name |
| GET | `/api/guest-app/items` | admin | — | every option and resource: `{ kind, id, title, priceType, category?, archived?, sellable:{ok, reason}, sold, mediaId, shortDescriptionFr, shortDescriptionEn, maxQuantity, needsStaff, leadMinutes }` |
| GET/PUT | `/api/guest-app/items/:kind/:id` | admin | `{ sold?, mediaId?, shortDescriptionFr?, shortDescriptionEn?, maxQuantity?, needsStaff?, leadMinutes? }` (only the keys sent are written; unknown keys refused) | the item view; 400 on a description over 140 characters, `maxQuantity` outside 1-50, `leadMinutes` outside 0-240, an unknown `mediaId`; 400 `NOT_SELLABLE` + the reason for `sold:true` on a type rule 23 excludes; `needsStaff` always false for a resource |
| GET/PUT | `/api/guest-app/lodgings/:propertyId` | admin | `{ enabled, displayName, heroMediaId, modules:[{key, on, order}], wifi:{available, network, password, note}, contacts:[{name, role?, phone?, whatsapp?, email?}] }` — a PUT writes the keys it names; a `wifi` without `password` keeps the stored one, `''` clears it | the lodging config with `hasLodgingCode`, never the code itself (rules 11bis-11quater) |
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
| POST | `/api/guest-app/reservations/:id/stay-link/regenerate` | admin, reception | — | the new link, same shape; the old link and every session opened from it die at once (lookup sessions survive); same 404 / 409 |
| GET | `/api/guest-app/lodgings/:propertyId/qr-poster.pdf` | admin | — | A4 PDF of `https://<guestHost>/l/<code>`; 409 if the lodging is off or the guest host is not set |
| GET | `/api/guest-app/orders?status=todo\|all` | admin, reception | — | `{ orders:[{ id, reservationId, lodging, guest, lines:[{label,total,totalLabel}], deliverAt, deliverLabel, payment, paymentLabel, status, statusLabel, total, totalLabel, canMarkDelivered }] }` by delivery time; `todo` (default) = on the fiche, not delivered; `all` = the last 30 days (rule 45) |
| POST | `/api/guest-app/orders/:id/delivered` | admin, reception | — | `{ status:'delivered' }` (twice is once); 409 `ORDER_NOT_DELIVERABLE`, 404 |
| GET | `/api/guest-app/planning/order-cards?from&to` | admin, reception | — | `{ days:[{ date, cards:[{ orderId, reservationId, time, timeLabel, lodging, guest, lines, paymentLabel, delivered }] }] }` — the staff-prepared lines only (rule 43) |

Rate limits: sessions 30/h/IP, lookup 5/15 min/IP, orders 10/h/session,
reads under the existing `publicApiLimiter` budget.

---

## 5. Data model

**One core column only:** `payment_links.basketJson` (`{ source, ref, refundOwed? }`), the basket a `complement` link
bills (rule 35). Everything below is created by the `guest-app` plugin's migrations:

- `guest_app_lodgings(propertyId PK, enabled INTEGER DEFAULT 0, lodgingCode TEXT UNIQUE, displayName,
  heroMediaId, modulesJson, wifiAvailable INTEGER DEFAULT 0, wifiNetwork, wifiPasswordEncrypted, wifiNote,
  contactsJson)` — the per-lodging configuration (rules 11bis-11quater). `displayName`, written by lot A, is no longer read nor
  written (rule 48: the name is GuestFlow's); a later migration drops it. The QR code is generated when a
  lodging is enabled, never logged. The wifi password is encrypted at rest like the other stored secrets
  (`settingsModel` encryption helper) — it is shown to guests, but must not sit in clear in a backup.
- `guest_app_items(kind 'option'|'resource', itemId, sold INTEGER DEFAULT 0, mediaId, shortDescriptionFr,
  shortDescriptionEn, maxQuantity DEFAULT 10, needsStaff INTEGER DEFAULT 0, leadMinutes DEFAULT 30,
  sortOrder, stockTracked INTEGER DEFAULT 0, stockQuantity INTEGER NULL, stockSetAt, stockSetBy, stockAlertBelow NULL,
  soldOut INTEGER DEFAULT 0, PRIMARY KEY(kind,itemId))` — the sell switch, its presentation and the stock (rules 22,
  37bis, 39). `stockQuantity` is what is left now: set at a restock, lowered and raised by the counts of rule 37ter.
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
- `guest_booklet_pages(id, slug, icon, coverMediaId, titleFr, titleEn, updatedAt)` — page content;
  `guest_booklet_placements(pageId, propertyId, sortOrder, published, PRIMARY KEY(pageId, propertyId))` —
  which lodgings' booklets show the page, where (a page placed in two lodgings is « shared », rule 17);
  `guest_booklet_blocks(id, pageId, sortOrder, onlyForPropertyIdsJson NULL, type, dataJson, updatedAt)`;
  `guest_booklet_versions(id, propertyId, publishedAt, publishedBy, snapshotJson)` — « Publier » freezes the
  resolved booklet of one lodging.
- `guest_media(id, path, width, height, altFr, altEn, createdAt)` — files under `server/uploads/guest-app/`,
  resized at upload (1600 / 800 / 400 px, WebP).
- `guest_orders(id, reservationId, sessionId, payment 'card'|'note'|'none', status 'awaiting_payment'|
  'confirmed'|'paid'|'delivered'|'expired'|'paid_conflict'|'abandoned', linesJson (priced snapshot, sessions included),
  total, deliverAt NULL, deliverMoved, heldUntil NULL, paymentLinkId NULL, createdAt, confirmedAt, paidAt, closedAt,
  deliveredAt, deliveredBy)` — `heldUntil` makes the hourly `holds` provider cheap to query.
- Plugin settings (`ctx.settings.declare`): `appName`, `soliomapUrl`, `soliomapEmbed` (default off), `maxOrderTotal`,
  `fulfilment` (`delivery` | `pickup`, default `delivery`), `pickupPlace` (rule 41bis),
  `guestHost`. The property has no slug column: `lodging.slug` is derived from its name (`L'Estiva` → `l-estiva`).

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
- [x] `…/guest-app-sessions.unit.test.js` (28) — rules 1-6, 8, 9, 33: the stay link (stay / pre-arrival from
  J-7 / visitor before and « ended » after), the poster opens the visitor mode only and tells nothing of a stay,
  no name state left, phase-bound reuse, a regenerated link kills its sessions, lookup throttling, generic
  errors, payload minimisation
- [x] `…/guest-app-stay-links.unit.test.js` (11) — rules 1, 2, 9, 9bis, 11quater: created on first need and shown
  again, regenerate kills the old link and its sessions, undecryptable token replaced, cancelled stay / lodging
  off / no guest host → 409, SAS switch reads without writing, e-mail URL (none without an address), the core
  `{{stayAppUrl}}` → gate-link fallback, reception allowed
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
- [x] `…/guest-app-items.unit.test.js` (9) — rules 22, 23, 27bis: the admin routes' validation, `NOT_SELLABLE`, roles
- [x] `…/guest-app-shop.unit.test.js` (11) — rules 11bis, 24, 25, 26, 27, 27bis: payload per lodging and language, categories, window states, visitor, `canPayCard`
- [x] `…/guest-app-sellable.unit.test.js` (16 tests) — rules 23, 25, 27bis: per price type, archived, lodging scope, 0 € in
  one lodging and paid in the other, free units (direct only) and free minutes left after existing lines,
  offered-by-default already on the stay
- [x] `…/guest-app-shop-quote.unit.test.js` (13) — rules 23, 24, 25, 27, 27bis, 29, 30, 32, 37, 41: quote equals the
  fiche's pricing engine for the same lines and writes nothing, free hour, sessions of one order judged together,
  `SLOT_TAKEN`, breakfast mornings, delivery time, input shapes, pre-arrival refused, « Modifiée par l'équipe »
- [x] `plugins/hourly-resources/tests/resource-scheduler-hook.unit.test.js` (9) + `guest-app/tests/guest-app-slots.unit.test.js` (7) — rules 28-31: guest sessions of other
  stays, outside bookings, held orders, turnover, capacity, heat-up / retention, closed days, evening rate,
  multi-slot order, ignition outside service hours → `staff`, warm slot not constrained
- [x] `…/guest-app-service-hours.unit.test.js` (14) — rules 39-42: weekly ranges, exceptions, establishment
  closures, lead time, next opening, last delivery before check-out
- [x] `…/guest-app-order-note.unit.test.js` (12) — rules 11bis, 25, 27, 33, 34, 37, 38, 44: no name asked, 0 € order and
  its allowance, lines land on the fiche and in `endOfStayComplementDetail`, quantities merge, limits, 10 / hour, push
- [x] `…/guest-app-order-card.unit.test.js` (9) — rules 33, 35, 36, 38, 44: complement link, paid → lines + payment,
  abandon, holds, expiry releases slots, late payment committed or `paid_conflict`, delivery moved
- [x] `…/guest-app-orders-admin.unit.test.js` (6) — rules 11, 38, 43, 45: the list, « Marquer livrée », planning cards, reception
- [x] `tests/payment-complement-link.unit.test.js` (7) — `ensurePaymentLink` / `applyPaidEffect` complement
  branch, refusal without basket, 30 min, no arrival lapse, « à rembourser », `ctx.paymentBasket`
- [x] `tests/guest-order-commit.unit.test.js` (9) — rules 24, 25, 27bis, 30, 34, 35: the core commit and its pricing
- [ ] `…/guest-app-stock.unit.test.js` — rules 37bis-37quater: restock sets the count, « En rupture », holds of an
  unpaid card order released on expiry / abandon, a site line counted on the arrival day and not before, a line added
  mid-stay counted at once, lowered / cancelled after arrival returned, the app order not counted twice by the event,
  `OUT_OF_STOCK` with `left`, website and staff never refused, the two pushes once each, late payment → `paid_conflict`
- [ ] `…/guest-app-fulfilment.unit.test.js` — rules 41bis-41ter: pickup needs a place, the sentence of the
  confirmation per mode, longest lead of the staff items only, the bath and self-service items carry no time, moved time
- [ ] `…/guest-app-studio-lodgings.unit.test.js` — rule 48: a property added in GuestFlow listed greyed, renamed,
  archived; « Synchroniser » refreshes the Soliomap cache
- [ ] `…/guest-app-gate.unit.test.js` — rules 12-14, no URL outside the window
- [x] `…/guest-app-home.unit.test.js` — rules 10-11
- [x] `…/guest-app-suggestion.unit.test.js` (9) — rule 15bis: 14 h cut-off, eve of departure, `visibleFrom`, nearest
  then soonest, multi-day label with the real end date, feed down or slow → no card, visitor → none

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

None open (2026-11-06).

### Settled while implementing the orders (2026-11-06, lot D server)

Decided by Adrien:
- **The core column `payment_links.basketJson`** is kept (§5): without a marker, `staleLinks`, `retireSettled` and
  the ledger's complement line would read an order's `complement` link as the arrival complement's.
- **Overpayment when a price changes during the 30 minutes** → ignored: the order's note books at most what was
  paid, the engine keeps the rest on the end-of-stay complement, and an excess is neither flagged nor recorded.

Points the rules left open, decided in code:
- The plugin owning a basket settles its payment through `ctx.paymentBasket({ source, paid })`
  (`specs/plugins-phase-1-sdk.md` rule 46); with no live owner the effect is `basket-unallocated` and the usual admin
  alert fires.
- A card payment is a settled mid-stay note (`midStaySettledNotes`, `source: guestOrder`, the provider's reference
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
  « À préparer » = confirmed or paid, not delivered; « Toutes » = the last 30 days. Reception sees the list, « Marquer
  livrée » and the planning cards. A planning card lists prepared option lines only (breakfast- or bath-only orders
  have none).
- Push (French, link `/commandes-app?order=<id>`) on creation (note or 0 €), on payment, and on a conflict
  (« Commande client à rembourser »).
- Stored line titles are the French catalogue titles. The payment link reads « Commande #N », VAT at the stay's
  rate; the history writes « Commande client #N » (+ « — payée par carte »). Abandon returns `cartLines`. « Modifiée
  par l'équipe » shows when a booked session of the order is no longer on the stay record.
- Expiry runs every 60 s (first pass at 30 s) on `heldUntil` (creation + 30 min); the link expires through its own
  lifecycle. Status `abandoned` and columns `deliverMoved`, `paidAt`, `closedAt` are in the unreleased v1 migration.

### Settled while implementing the stay link (2026-11-06, step 13bis)

Points the rules left open, decided in code and recorded here:
- A link session keeps its phase; the app exchanges the link again when it ends (rule 4). A lookup session moves
  from pre-arrival to stay by itself, having no link to exchange.
- A visitor session opened by a link before D-7 lasts 24 h at most and ends at D-7 00:00.
- Regenerating kills every session opened from the link, visitor ones included; lookup sessions survive.
- The poster's visitor `/me` no longer carries `opensAt` / `openingLine` (rule 3); the pre-arrival `/me` does.
- `stayToken` wins when a request sends both `stayToken` and `lodgingCode`.
- A token that no longer decrypts (key changed) is revoked and replaced, like a regeneration.
- The stay-link routes answer 409 for a non-active reservation, a lodging off the app or an unset app host, and
  404 for an unknown reservation. Reception may read and regenerate (it runs the SAS).
- `{{stayAppUrl}}` is a core template variable with its gate-link fallback in `emailContextBuilder.js`, so it works
  without the plugin; the operator writes the sentence in the template under `{{#if hasStayApp}}`. A guest with no
  e-mail address gets no link from the e-mails.
- The `sas.portal` slot: a contribution flagged `leadsStep: { title }` leads the step while its SAS data says
  `available`; the other contributions are passed to it as `gateStep`, so the keypad code shows once
  (`specs/plugins-phase-1-sdk.md`, slots table).
- The SAS line « Le lien vaut jusqu'au… » shows the end of the stay window (check-out + 2 h).

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
| B — Sellable catalogue (server) | Done (2026-11-05): items routes, shop payload, catalogue projections moved to the core (`publicCatalogProjection`, SDK 2.22.0); full server suite 10 561 / 10 561 |
| C — Planning and service hours (server) | Done (2026-11-05): `ctx.resourceScheduler` / `ctx.resourceHolds` (SDK 2.22.0), hourly-resources 1.4.0, slots, delivery times, service hours; full server suite 10 591 / 10 591 before the last change, targeted suites green after it |
| E — Booklet and studio API (server) | Done (2026-11-05): booklet per lodging with shared pages and versions, studio API, media, QR poster, the Soliomap suggestion (`safeFeedFetch`, `instancePaths` core modules, SDK 2.22.0); guest-app suites 186 / 186, full suite 10 631 / 10 632 (the one failure is a core baseline that fails between 0 h and 1 h Paris time on the previous commit too) |
| D — Orders and payment (server) | Done (2026-11-06): quote and orders priced by the fiche's engine, note / 0 € / card, the core commit `guestOrderCommit`, `complement` basket links (`ctx.paymentBasket`, `ctx.core.payments`, `payment_links.basketJson`, SDK 2.22.0), abandon, expiry, late payment and `paid_conflict`, push, the orders list and planning cards (server); +56 server tests. The page and the card wait for the UI lots |
| F-G — Guest app, studio | Unblocked: every review-board verdict given (2026-11-08); stock server side and the lot A `displayName` removal come with them |
| H — Hardening and rollout | Not started |
| I — Booklet content | Waiting for the user's booklets |

The whole spec ships in ONE pull request (the user's decision of 2026-11-05): the spec-coverage gate refuses
code citing a spec that is still Approved, and only a spec moved to Implemented with every rule cited passes it.
