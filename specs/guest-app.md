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

### 3.C Gate (Sowel connector)

12. **Source.** The gate tile reads the stay's key from the `gate-access` plugin (`gate_key_results`: code +
    URL created by Sowel). No new gate logic: GuestFlow still never calls the house.
13. **Display.** Inside the gate window: a large « Ouvrir le portail » button opening the Sowel key URL, the
    keypad code shown big with « Copier », the validity (« Valable jusqu'au 9 oct. à 12 h »). Before the key
    exists (Sowel has not pulled yet): « Votre accès est en cours de préparation » + the fallback keypad code
    `app_settings.portalCode` if set. Outside the window: no code is ever returned.
14. **Plugin off** (`gate-access` inactive) → tile absent, endpoint 404 `PLUGIN_INACTIVE`.

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

22. **What is sold.** Options and resources linked to the lodging (`property_options`,
    `resource_properties`) that carry the new flag **« Vendu dans l'app »** (`soldInGuestApp`), are not
    archived, and have a price type the app can sell by quantity:
    - options: `per_stay` (unit), `per_person` (unit = one person), `per_day_per_person` (unit = one
      person-day);
    - resources: `per_hour` hourly resources (nordic bath) and quantity resources.
    Other types (`per_night`, `per_person_per_night`, `percent_of_stay`, progressive tiers, cancellation
    insurance, auto timed options such as late check-out) cannot get the flag — the studio switch is disabled
    with the reason. Late check-out is §8.
23. **Prices come from GuestFlow, as the site shows them.** Each item reuses the website-booking
    projections (`toPublicOption` / `toPublicResource`, `publicProjections.js`): effective per-property
    price, server-made `priceUnitLabel`, EN title from the translation catalogue. The guest-app projection
    adds only `imageUrl`, `shortDescription` and `maxQuantity`. Prices are TTC.
24. **Categories.** Items are grouped by the existing option `category` (e.g. « Boissons »,
    « Restauration », « Bien-être »), in the studio's category order; hourly resources appear in
    « Bien-être ». An empty category is not shown.
25. **When the shop is open.** Exactly when the core mid-stay extras window is open for the stay
    (`midStayExtrasWindow.js`: from `startDate` until the end-of-stay complement is collected). Pre-arrival
    and visitor sessions see the catalogue read-only with « Disponible pendant votre séjour ». After the
    complement is collected: « La boutique est fermée — bon retour ! ».
26. **Nordic bath — extra time.** The guest picks a day of the stay and a slot from the server's
    availability (`hourly-resources/availability.js` `buildDays`, same grid, turnover, opening hours,
    heat-up retention and evening rate as the fiche). Free minutes already offered by the stay
    (`property_resource_prices.freeMinutes`) are consumed first and shown (« 1 h offerte déjà utilisée »).
    The price shown per slot is the server's. A slot taken meanwhile is refused at order time
    (`SLOT_TAKEN`) and the picker refreshes.
27. **Cart.** Lives on the device (local UI state, persisted in `localStorage` for the session only). The
    total shown is **always** the server's answer to `POST /guest/orders/quote` — the client never adds
    prices.
28. **Two ways to pay, the guest chooses** at checkout:
    - **« Payer maintenant »** (card): the server creates the order `awaiting_payment` and a Qonto payment
      link of type `complement` for exactly its total, with the order's lines as VAT basket; the app
      redirects to Qonto; the return lands on `/commande/<id>` which polls the order status.
      **No name confirmation** — the card payment is the proof.
    - **« Ajouter à ma note »** (end-of-stay bill): the guest must **confirm their last name** (rule 7,
      once per session — a fallback session already proved it); on success the order is `confirmed` at
      once and its lines join the stay's end-of-stay complement, collected at the departure SAS as today.
      3 wrong names lock « Ajouter à ma note » for that session for 1 h; card payment stays available.
    « Ajouter à ma note » is offered only while the end-of-stay complement is uncollected (it always is
    while the shop is open — rule 25 — but the server re-checks).
29. **How an order lands on the fiche.** A confirmed order (note) or a paid order (card) is written by the
    **core** as mid-stay extras on the reservation — the same write path as the operator's `PUT
    /api/reservations/:id` on a locked fiche (rules 1 and 9 of `mid-stay-extras-on-locked-fiche.md`), in one
    transaction with the order status, with the reservation history entry « Commande app #12 ». Quantities
    add to the existing line of the same option/resource (no duplicate line).
30. **Note orders** flow into `endOfStayComplementDetail` with `source:'midStayExtra'` exactly like an
    operator addition — no new arithmetic.
31. **Card orders** are recorded as **already paid**: the lines join the reservation, and the payment is
    recorded against the reservation's payment ledger as a `complement` payment (amount, date, Qonto
    reference), so the end-of-stay complement owes nothing for them and the accounting books the money on
    the payment date. This wires the `complement` type end to end: `ensurePaymentLink` accepts it **only**
    with an explicit guest-order basket, `applyPaidEffect` gets a `complement` branch that commits the order.
    Exempt from the arrival-day lapse (`payment-link-lifecycle.md` rule 9); its own lifetime is **30 min**.
32. **Unpaid card order.** If the link is not paid within 30 min the order goes `expired`, the bath slot it
    held is released, nothing reaches the fiche. A payment confirmed after expiry (late webhook) still
    commits the order if the slot is still free; otherwise the order goes `paid_conflict`, the operator is
    pushed, and refunds by hand (refund out of scope).
33. **Slot holds.** An `awaiting_payment` order holds its bath slots (counted as pending occupancy by the
    availability) until paid or expired; a note order commits them at once.
34. **Limits.** Per order: ≤ 20 lines, each quantity 1…`maxQuantity` (studio, default 10), total
    ≤ 500 € (studio setting). Per session: 10 orders / hour. Out-of-range → 400 with the documented code;
    the app's steppers already respect `maxQuantity` (UX only).
35. **Order follow-up.** « Mes commandes » lists the session's stay orders with status chips: *En attente de
    paiement*, *Payée*, *Sur votre note*, *Préparée / livrée*, *Expirée*. The guest cannot cancel a confirmed
    order from the app (« Contactez-nous » → booklet contact block).

### 3.G Staff side

36. **Push.** Every confirmed or paid order pushes the new channel **« Commandes clients »**
    (`guestOrders`, declared by the plugin with `ctx.pushChannel`) to subscribed staff: « L'Estiva · Marie —
    2 × Cidre, 1 h bain nordique ven. 20 h (sur la note) ». The push opens the order in GuestFlow.
37. **Orders list in GuestFlow.** A page *Commandes app* (sidebar, under the day-to-day group) lists orders,
    newest first, filter « À préparer / Toutes », each row: lodging, guest, lines, payment mode, status,
    « Marquer livrée ». Bath sessions also appear in the planning as today (they are reservation sessions).
38. **The fiche** shows the order's lines as normal lines (they are), and the history entry links to the
    order.

### 3.H Booklet studio (dedicated web app)

39. **A separate web app**, « Studio du livret », served by GuestFlow at `/studio` on the admin host, with
    its own lightweight layout optimised for content editing (tablet-first), **signed in with the GuestFlow
    admin account** (same session cookie as `/api`, so no second login on the same browser). Roles: admin
    only; the reception role has no access.
40. **Edits:** pages (create, reorder by drag, scope common / lodging, publish / draft, icon, cover photo),
    blocks (add from a palette, reorder, edit FR / EN side by side), photos (upload, crop to the block's
    ratio, alt text), shop presentation (per sold item: photo, short description FR/EN, `maxQuantity`,
    category order; the price and title stay GuestFlow's — read-only here with « Modifier dans GuestFlow »),
    app settings (app name, hero photo per lodging, Soliomap URL + « Intégrer dans l'app », order limits,
    regenerate a lodging's QR code, print the QR poster PDF per lodging).
41. **Live preview.** The editing screen shows a phone-frame preview of the page rendered by the real guest
    components, for the chosen lodging and language. « Publier » makes the draft the guest version; until
    then guests see the previous version.
42. **Item flag.** « Vendu dans l'app » is edited in the studio's shop screen *and* shown on the option /
    resource edit dialogs of GuestFlow (one column, two views).

### 3.I App shell, install, look & feel

43. **One codebase, three layouts.** Mobile: bottom tab bar (Accueil · Livret · Boutique · Commandes) +
    floating cart bar. Tablet (≥ 900 px): navigation rail + two-pane booklet (index | page) and shop (catalogue
    | cart). Desktop (≥ 1200 px): same, content max 1200 px, hero wider.
44. **Installable PWA.** Manifest (name from the studio, theme fir-green), icons, standalone display,
    offline shell + booklet (rule 21). After the second visit a discreet « Installer l'app » card (Android
    `beforeinstallprompt`; iOS: a sheet with the share → « Sur l'écran d'accueil » steps). Never on first load.
45. **Look & feel** — see §6 and the mock-ups: photo-led, generous whitespace, the GuestFlow « maison »
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

---

## 4. Architecture

> **Fat backend, thin frontend.** Stay resolution, windows, name matching, catalogue filtering, every price,
> every total, slot availability, the payment link, the commit to the fiche and the booklet resolution
> (scope + language fallback) are server-side. The guest app and the studio render payloads and keep local
> UI state (cart lines and quantities, open sheet, current tab, editor drafts).

### 4.1 Server side (`server/src/`)

New plugin **`guest-app`** (one plugin, enable/disable from Paramètres › Intégrations, like
`website-booking`). It owns `/public/v1/guest/**` and `/api/guest-app/**`; money stays core (plugins
phase 2 rule 2).

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/guest-app/` | `manifest.json`, `index.js` | C | Declares the plugin, push channel `guestOrders`, migrations, public + admin mounts, the order-expiry runner |
| `plugins/guest-app/routes/` | `public.js` | C | `/public/v1/guest/**` — thin: parse → controller → JSON |
| `plugins/guest-app/routes/` | `admin.js` | C | `/api/guest-app/**` — studio + orders list, admin session guard |
| `plugins/guest-app/middleware/` | `guestSession.js` | C | Reads `gf_guest`, loads the session, re-derives the window, 401 when dead |
| `plugins/guest-app/controllers/` | `sessionController.js` | C | QR resolution, fallback lookup, name confirmation, `/me` payload |
| `plugins/guest-app/controllers/` | `bookletController.js` | C | Resolved booklet + search for a session / visitor |
| `plugins/guest-app/controllers/` | `shopController.js` | C | Sellable catalogue, bath availability, quote, create order (card / note) |
| `plugins/guest-app/controllers/` | `studioController.js` | C | CRUD pages / blocks / media / settings, publish, QR poster |
| `plugins/guest-app/controllers/` | `ordersAdminController.js` | C | Orders list, mark delivered |
| `plugins/guest-app/models/` | `sessionsModel.js`, `bookletModel.js`, `ordersModel.js`, `mediaModel.js` | C | DB access (prepared statements) |
| `plugins/guest-app/` | `currentStay.js` | C | Pure: lodging + instant → current stay (rules 2, 3, 5, 6) |
| `plugins/guest-app/` | `nameMatch.js` | C | Pure: normalisation + comparison (rule 7) |
| `plugins/guest-app/` | `sellable.js` | C | Pure: which options/resources may be sold (rule 22) |
| `plugins/guest-app/` | `homeHighlight.js` | C | Pure: status line + the single highlight (rules 10, 11) |
| `plugins/guest-app/` | `orderExpiryRunner.js` | C | Every minute: expire unpaid orders, release holds (rule 32) |
| `plugins/guest-app/` | `migrations.js` | C | Tables of §5 |
| `plugins/website-booking/` | `publicProjections.js` | T | Export `toPublicOption` / `toPublicResource` for reuse (no behaviour change) |
| `plugins/hourly-resources/` | `availability.js` | T | Accept held guest orders as `pending` occupancy (rule 33) |
| `plugins/gate-access/` | `index.js` | T | Expose `keyForReservation(id, now)` to other plugins (rules 12-13) |
| `plugins/online-payment/` · `utils/paymentRequestService.js` | — | T | `complement` link type with explicit basket and 30-min lifetime (rule 31) |
| `utils/paymentPollRunner.js` | — | T | `applyPaidEffect` `complement` branch → `guestOrderCommit` |
| `utils/` | `guestOrderCommit.js` | C | **Core**: commits an order's lines as mid-stay extras, records a complement payment when paid, history entry — one transaction (rules 29-31) |
| `utils/` | `gateWindow.js` | T | Export the window as a reusable function if not already (rule 2) |
| `models/` | `optionsModel.js`, `resourcesModel.js` | T | Read/write `soldInGuestApp`, `guestAppImagePath`, short descriptions |
| `plugins/sdk/index.js` | — | T | Add `guestOrderCommit` to `CORE_MODULES` (one reviewed line) |
| `middleware/` | `rateLimiters.js` | T | `guestSessionLimiter` (30/h/IP), `guestLookupLimiter` (5/15 min/IP), `guestOrderLimiter` (10/h/session) |
| `index.js` | — | T | Serve the guest app build on the guest host and the studio build at `/studio` |
| `database.js` | — | — | (none — the plugin owns its migrations; the two core columns go in the core migration block, §5) |

New dependency: `qrcode` (server, QR poster + wifi QR) if not already present; `pdfkit` already serves the
devis PDF.

### 4.2 Client side

Two new Vite apps, in the repo, sharing GuestFlow's theme tokens (`client/src/theme.js` values copied into a
small shared `packages/guest-ui` is **not** done — the guest app has its own theme file built from the same
tokens; one source of truth for brand values is §9 Q6).

**`guest/` — the guest PWA** (React, MUI with a dedicated theme, React Router):

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `HomePage`, `BookletIndexPage`, `BookletPage`, `ShopPage`, `BathSlotPage`, `CartPage`, `OrderPage`, `OrdersPage`, `GatePage`, `SoliomapPage`, `LookupPage`, `LodgingEntryPage` (`/l/:code`) | C | Route-level views |
| `components/` | `AppShell` (tab bar / rail), `HeroHeader`, `StayCard`, `QuickTile`, `HighlightCard`, `BlockRenderer` + one renderer per block type, `ProductCard`, `ProductSheet`, `QuantityStepper`, `SlotPicker`, `CartBar`, `PaymentChoice`, `NameConfirmDialog`, `StatusChip`, `InstallPrompt`, `OfflineBanner` | C | Rendering only |
| `services/` | `api.js` | C | `fetch` with credentials, error envelope → typed errors |
| `hooks/` | `useSession`, `useCart` (local state + localStorage), `useOrderStatus` (poll) | C | UI state |
| `i18n/` | `fr.json`, `en.json` | C | App chrome strings (booklet content comes from the server) |
| `public/` | `manifest.webmanifest`, `sw.js`, icons | C | Install + offline booklet |

**`studio/` — the booklet studio** (React, MUI using GuestFlow's `client/src/theme.js` via import):

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `PagesListPage`, `PageEditorPage`, `ShopPresentationPage`, `MediaLibraryPage`, `AppSettingsPage` | C | Studio screens |
| `components/` | `BlockPalette`, `BlockEditor` (one per type), `BilingualField`, `PhonePreview` (imports `guest/` renderers), `ImageCropper`, `SortableList` | C | Editing UI |

**`client/` (GuestFlow admin):**

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `GuestOrdersPage.js` | C | Orders list + « Marquer livrée » (rule 37) |
| `components/` | option / resource edit dialogs | T | « Vendu dans l'app » switch (rule 42) |
| sidebar | — | T | « Commandes app » entry, plugin-gated |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `DataPageScaffold`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `FormDialog` (admin page + studio) | Studio and admin keep GuestFlow's component library. |
| **Created (new generic, guest app)** | `QuickTile`, `BottomSheet`, `QuantityStepper`, `StatusChip`, `BlockRenderer` | Generic inside the guest app; `BlockRenderer` is shared with the studio preview. |
| **Specific** | `SlotPicker`, `PaymentChoice`, `NameConfirmDialog`, `StayCard` | Tied to the stay / order flows. |

Why not reuse `client/` for the guest app: different audience, origin, auth and bundle budget (the guest
app must load fast on 3G and be cacheable offline; the admin bundle is several MB).

### 4.3 API contract

Error envelope as `public-api.md` §4.3: `{ error: { code, message, details? } }`. All guest routes are
same-origin with the guest app (served by GuestFlow on the guest host — no CORS), cookie-authenticated,
never accept the site's shared key.

| Method | Endpoint | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/public/v1/guest/sessions` | — | `{ lodgingCode }` | `{ mode: 'stay'\|'preArrival'\|'visitor', lodging:{id,name,slug}, opensAt? }` + cookie |
| POST | `/public/v1/guest/sessions/lookup` | — | `{ lastName, reservationNumber }` | same; 404 `STAY_NOT_FOUND` generic |
| GET | `/public/v1/guest/me` | session | — | `{ mode, guest:{firstName}, lodging, stay:{arrival,departure,partySize,statusLine}, language, nameConfirmed, tiles:[…], highlight? }` |
| POST | `/public/v1/guest/me/confirm-name` | session | `{ lastName }` | `{ nameConfirmed:true }`; 422 `NAME_MISMATCH` `{attemptsLeft}`; 423 `NAME_LOCKED` |
| GET | `/public/v1/guest/booklet?lang=` | session or `lodgingCode` | — | `{ version, pages:[{slug,icon,title,cover}] }` |
| GET | `/public/v1/guest/booklet/pages/:slug?lang=` | idem | — | `{ slug, title, cover, blocks:[{type, …}] }` |
| GET | `/public/v1/guest/booklet/search?q=&lang=` | idem | — | `{ results:[{slug,title,excerpt}] }` |
| GET | `/public/v1/guest/gate` | stay session | — | `{ state:'active'\|'preparing'\|'outside', url?, code?, validUntil?, fallbackCode? }` |
| GET | `/public/v1/guest/shop` | session | — | `{ open, closedReason?, canPayCard, canPayNote, categories:[{name, items:[{kind:'option'\|'resource', id, title, shortDescription, imageUrl, price, priceUnitLabel, maxQuantity, scheduling?:'hourly'}]}] }` |
| GET | `/public/v1/guest/shop/resources/:id/slots` | stay session | — | `{ days:[{date,label,slots:[{start,end,state,price,priceLabel}]}], freeMinutesLeft }` |
| POST | `/public/v1/guest/orders/quote` | stay session | `{ lines:[{kind,id,quantity?,slots?}] }` | `{ lines:[{…, unitPrice, total, label, unavailable?}], total, totalLabel }` |
| POST | `/public/v1/guest/orders` | stay session | `{ lines, payment:'card'\|'note', returnPath }` | card → `{ orderId, paymentUrl }`; note → `{ orderId, status:'confirmed' }`; 403 `NAME_REQUIRED`, 409 `SLOT_TAKEN`, 409 `SHOP_CLOSED`, 400 `ORDER_LIMIT` |
| GET | `/public/v1/guest/orders` | stay session | — | `{ orders:[{id, createdAt, lines, total, payment, status, statusLabel}] }` |
| GET | `/public/v1/guest/orders/:id` | stay session | — | one order (triggers the on-demand Qonto poll like `/booking-requests/:id/status`) |
| GET | `/public/v1/guest/manifest.webmanifest` | — | — | manifest with the studio's app name |
| GET/POST/PUT/DELETE | `/api/guest-app/studio/**` | admin | pages, blocks, media, settings, publish, `lodgings/:id/regenerate-qr`, `lodgings/:id/qr-poster.pdf` | — |
| GET | `/api/guest-app/orders?status=` | admin/staff | — | orders list (rule 37) |
| POST | `/api/guest-app/orders/:id/delivered` | admin/staff | — | `{ status:'delivered' }` |

Rate limits: sessions 30/h/IP, lookup 5/15 min/IP, confirm-name 3 failures/h/session, orders 10/h/session,
reads under the existing `publicApiLimiter` budget.

---

## 5. Data model

Core (`database.js` idempotent block):
- `options.soldInGuestApp INTEGER NOT NULL DEFAULT 0`, `resources.soldInGuestApp INTEGER NOT NULL DEFAULT 0`
  — default 0: nothing is sold until the operator flags it.
- `properties.lodgingCode TEXT` (unique index where not null) — generated on plugin install for every
  property, never logged.

Plugin `guest-app` migrations:
- `guest_sessions(id INTEGER PK, tokenHash TEXT UNIQUE, propertyId, reservationId NULL, mode, origin
  'qr'|'lookup', nameConfirmedAt, nameFailures, nameLockedUntil, createdAt, lastSeenAt, expiresAt)` — purged
  30 days after expiry.
- `guest_booklet_pages(id, slug, icon, coverMediaId, scopePropertyId NULL, sortOrder, status
  'draft'|'published', titleFr, titleEn, updatedAt)`; `guest_booklet_blocks(id, pageId, sortOrder,
  scopePropertyId NULL, type, dataJson, updatedAt)` — draft rows; `guest_booklet_versions(id, publishedAt,
  publishedBy, snapshotJson)` — « Publier » freezes the resolved structure guests read.
- `guest_media(id, path, width, height, altFr, altEn, createdAt)` — files under `server/uploads/guest-app/`,
  resized at upload (1600 / 800 / 400 px, WebP).
- `guest_item_presentation(kind 'option'|'resource', itemId, mediaId, shortDescriptionFr,
  shortDescriptionEn, maxQuantity DEFAULT 10, PRIMARY KEY(kind,itemId))`.
- `guest_orders(id, reservationId, sessionId, payment 'card'|'note', status 'awaiting_payment'|'confirmed'|
  'paid'|'delivered'|'expired'|'paid_conflict', linesJson (priced snapshot), total, paymentLinkId NULL,
  createdAt, confirmedAt, deliveredAt, deliveredBy)`.
- Plugin settings: app name, hero media per property, Soliomap URL + embed switch, max order total.

**Data impact:** additive only. No existing row changes meaning; reservations receive lines only through the
existing mid-stay path. Changelog `Migration` note at implementation.

## 6. UI / UX

See **`specs/guest-app-maquettes.html`** (mobile home, booklet page, shop, bath slot picker, cart with the
payment choice and name confirmation, gate, tablet/desktop layout, studio editor).

Design direction — « boarding pass » apps (Enso, Duve) meet a boutique-hotel magazine:
- **Home**: full-bleed lodging photo with a dark gradient, greeting in Source Serif 4, a frosted stay card
  overlapping the photo (dates, status line, countdown), then a 3 × 2 grid of large rounded tiles with
  duotone icons; one highlight card; booklet shortcuts as a horizontal photo strip.
- **Booklet**: index as photo cards; page = cover photo, title, blocks with generous rhythm; `steps` as a
  vertical timeline; `wifi` as a ticket-like card with copy + join QR.
- **Shop**: category chips (sticky), product cards with photo, name, price label; tap → bottom sheet with
  large photo, description, stepper, « Ajouter · 9,00 € »; floating cart bar « 3 articles · 24,00 € » above
  the tab bar.
- **Bath**: day chips, then a slot grid (free / evening rate / taken), price per slot shown by the server.
- **Checkout**: two big choice cards — « Payer maintenant » (card icon, « Paiement sécurisé Qonto ») and
  « Ajouter à ma note » (« Réglée à votre départ ») → the latter opens the name confirmation sheet.
- **Gate**: one giant circular « Ouvrir le portail » button, code in large monospaced digits with copy,
  validity line.

Copy (FR, EN in `en.json`): « Bonjour {prénom} », « Votre séjour », « Ouvrir le portail », « Le livret »,
« La boutique », « Ajouter au panier », « Payer maintenant », « Ajouter à ma note », « Pour mettre cette
commande sur votre note, confirmez votre nom de famille », « Commande envoyée ! Nous la préparons. »,
« Connexion nécessaire », « Nous n'avons pas trouvé ce séjour. Vérifiez le nom et le numéro. »

States: skeleton loading on every list, `EmptyState` for empty categories / no orders, offline banner,
error toasts with retry.

**Responsive:**
- `xs` (≤ 600): bottom tab bar, single column, bottom sheets for product / name / install, cart bar floating.
- `md` (~900): navigation rail left, booklet two-pane (index 320 px | page), shop two-pane (catalogue | cart
  panel always visible), sheets become centred dialogs.
- `lg` (≥ 1200): content max 1200 px centred, hero 420 px high, tiles 6 in a row.

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
- [ ] `…/guest-app-sellable.unit.test.js` — rule 22 per price type, archived, scope
- [ ] `…/guest-app-shop-quote.unit.test.js` — rules 23, 26, 27, 34 (prices equal the site's projection and
  the fiche's pricing)
- [ ] `…/guest-app-order-note.unit.test.js` — rules 28-30: name required, lock, lines land in
  `endOfStayComplementDetail`, quantities merge
- [ ] `…/guest-app-order-card.unit.test.js` — rules 31-33: complement link, paid → lines + payment, expiry
  releases slot, late payment conflict
- [ ] `tests/payment-complement-link.unit.test.js` — `ensurePaymentLink` / `applyPaidEffect` complement
  branch, refusal without basket
- [ ] `…/guest-app-gate.unit.test.js` — rules 12-14, no code outside the window
- [ ] `…/guest-app-home.unit.test.js` — rules 10-11

### Manual UI verification
- [ ] Happy path mobile (390 px): scan QR → home → order 2 drinks + 1 h bath → note with name → push received
  → line on the fiche → collected at the departure SAS.
- [ ] Card path: Qonto sandbox payment → return page → order paid → fiche shows paid lines, end-of-stay
  complement unchanged.
- [ ] Edge: wrong name × 3 → note locked, card still possible; slot taken between quote and order.
- [ ] Visitor mode (no stay) and pre-arrival lookup; offline booklet in airplane mode.
- [ ] Tablet (900 px) two-pane layouts; desktop (1280 px); dark mode; EN.
- [ ] Studio: create page, add each block type, preview, publish, regenerate QR (old QR → visitor mode no
  longer resolves).
- [ ] Regression: website booking tunnel prices unchanged; mid-stay extras from the fiche unchanged.

## 8. Out of scope

- Late check-out / early check-in purchase (auto timed options) — next iteration.
- Guest-side cancellation or refund of an order (operator refunds by hand).
- Guest push notifications, chat / messaging with the operator.
- Online check-in, ID upload, police forms.
- Opening the gate through Portier (`feature/guest-gate-access`) — the app reads Sowel keys only.
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
- **Q4 — Gate without name confirmation.** As decided, the lodging QR alone gives the gate. Someone who
  kept a photo of the QR could, during a later stay, see the current guest's gate code and first name.
  Accept (the QR is inside the lodging, the window is per stay), or ask the name once before showing the
  gate code?
- **Q5 — Studio interpretation.** « Nouvelle application web dédiée » is read as a separate studio app at
  `/studio` on the GuestFlow host, signed in with the GuestFlow account (rule 39). Correct, or should the
  studio be a separate site with its own accounts?
- **Q6 — Brand tokens.** Guest app reuses GuestFlow's « maison » palette and fonts, or Domaine Solio has its
  own charter (logo, colours, fonts) to apply?
- **Q7 — PageActionBar exception** for the guest app (§6) — confirm.
- **Q8 — Soliomap framing.** Does `soliomap.domainesolio.com` allow being framed by the guest host
  (`frame-ancestors`)? Can it read `?lang=&lodging=`?
- **Q9 — What is sold at launch.** Which catalogue items get « Vendu dans l'app » first (drinks list, local
  products, bath extra hour, breakfast, firewood…)?
- **Q10 — Card link lifetime** 30 min (rule 31) acceptable vs. the standard 36 h?
