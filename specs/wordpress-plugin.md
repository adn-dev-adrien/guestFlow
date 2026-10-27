# WordPress plugin — GuestFlow Booking

| Field | Value |
|---|---|
| **Status** | Implemented (code) — pending manual verification on a live WordPress site. v1.3.0 adds the online full-payment flow (booking block `payOnline` + pay/status proxy routes; see §3 rule 6b). v1.15.0 (2026-10-18) derives the settings, makes the engine accessible and retries a failed payment on the same devis (rules 14–24); the review follow-up fixes the payment return on a generic page, the detected booking page and the retry comparison (rules 25–27). v1.16.0 (2026-10-19, UI/UX review 2026-10-18): refusal field by field (rule 28) and one accent colour (rule 29); the calendar and the sticky bar are in [wp-booking-widget-redesign.md](wp-booking-widget-redesign.md) rules 29–33. |
| **Branch** | `feature/wordpress-plugin` _(user-managed)_ |
| **Created** | 2026-06-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Depends on** | [public-api.md](public-api.md) (the API this plugin consumes) |

---

## 1. Context

[public-api.md](public-api.md) specifies a key-authenticated public API (`/public/v1/*`) for a
showcase website. This spec covers the **WordPress plugin** that consumes it: the visitor-facing
interface on the WordPress site.

The plugin lives **in this monorepo** under `integrations/wordpress/` (decision: monorepo + dedicated
directory, so the API contract, the spec, and the consumer move together in atomic PRs). It is
**inert for the Raspberry Pi deploy**: [release.sh](release.sh) is allow-list based — it archives only
`server/`, `client/dist→build/`, and the root `package.json`, so a new top-level directory is never
shipped to the Pi. The plugin has its own delivery path (build a `.zip`, upload to WordPress).

**Security anchor (from public-api.md):** the API key is a **server-to-server** secret. The plugin
must therefore act as a **PHP proxy**: the visitor's browser talks only to the plugin's own WordPress
REST routes; the plugin's PHP backend relays to GuestFlow `/public/v1` with the key in a header. The
key never reaches browser JavaScript.

The visitor UI is delivered as **Gutenberg blocks** (decision), built with `@wordpress/scripts`.

## 2. Goal

Ship an installable WordPress plugin that lets a site editor drop blocks on any page so a visitor can:
browse a property's availability calendar, build a quote with options, and submit a booking request —
all through the plugin's PHP proxy, with the GuestFlow API key kept server-side, and with GuestFlow
remaining the single source of truth for prices, availability, and validation.

## 3. Functional rules

1. **PHP proxy, key server-side.** All calls to `/public/v1/*` happen in PHP
   (`wp_remote_get`/`wp_remote_post`) with `Authorization: Bearer <key>`. The key is stored in WP
   options (settings page) or a `wp-config.php` constant, **never** output to the browser, **never**
   enqueued into JS, **never** placed in a URL.
2. **Browser → plugin REST only.** Blocks fetch the plugin's own namespace
   `/wp-json/guestflow/v1/*` (via `@wordpress/api-fetch`, which carries the WP REST nonce). They
   **never** call GuestFlow directly and never see the GuestFlow base URL or key.
3. **1:1 proxy mapping.** The plugin exposes proxy routes mirroring the public API (see §4.3). The PHP
   proxy adds the key, forwards validated params, and relays the JSON response + status code.
4. **No business logic in the plugin.** The plugin performs **no** price calculation, availability
   derivation, or quote re-shaping. It relays ready-to-render payloads (consistent with GuestFlow's
   fat-backend principle). It may only: cache reads, validate/whitelist params before forwarding, and
   map errors to display strings.
5. **Read caching.** GET proxy routes (`properties`, `properties/:id`, `options`, `availability`)
   cache responses in WP transients with a configurable TTL (default 600 s; availability default
   300 s). Cache key includes the path + query. The booking-request POST is never cached.
6. **Write protection.** `POST /wp-json/guestflow/v1/booking-requests` requires a valid WP REST nonce
   (`X-WP-Nonce`) emitted to the block script, so only the plugin's own frontend can trigger it.
   GuestFlow still enforces its own honeypot + rate limit (defense in depth). The plugin forwards the
   `_hp` honeypot field unchanged.
6b. **Online full-payment (v1.3.0, specs/public-online-payment.md).** The booking block has a `payOnline`
   option. When on, after the booking request creates the devis the block calls the proxy
   `POST /booking-requests/:id/pay` (nonce) → GuestFlow returns the Qonto hosted-payment URL → the
   visitor is redirected there to pay the **full stay**. Qonto returns them to the same page with
   `?gf_payment=<id>`; the block then polls the proxy `GET /booking-requests/:id/status` until
   `confirmed` and shows the stay recap. The proxy forwards only a same-origin `returnPath` (GuestFlow
   re-allowlists it). The amount, availability re-check, date-blocking and confirmation email are all
   server-side (GuestFlow); the plugin still holds no business logic.
7. **Three Gutenberg blocks** (namespace `guestflow/`), all shipped in v1:
   - `guestflow/calendar` — availability calendar for one property.
   - `guestflow/booking` — the quote→request wizard (dates + guests + options → live quote → contact
     → submit request).
   - `guestflow/properties` — list of bookable properties (cards linking to a configured booking page).
8. **Dynamic, build-free blocks.** Blocks are registered server-side via `register_block_type` +
   `block.json` and render a lightweight server-side container (`render.php`) that hydrates
   client-side from the plugin REST routes. The editor UI and the frontend hydration are written in
   **plain JavaScript** (`wp.blocks` / `wp.element.createElement`, no JSX) so there is **no npm
   toolchain and no build step** — the source files ship as-is. Data is **never** baked into post
   content at save time (prices/availability must always be live).
9. **Editor experience.** In the block editor, each block shows its configurable attributes (property
   selector populated from the proxy, months-to-show, etc.) and a non-interactive preview/placeholder
   — no live booking submission from the editor.
10. **Settings page.** An admin settings screen (Settings → GuestFlow) configures: API base URL, API
    key (masked input), read cache TTL, availability cache TTL, and a default property. Includes a
    "Test connection" button that calls `GET /public/v1/properties` through the proxy and reports
    OK/auth-failure/unreachable.
11. **Graceful failure.** If the API is unreachable or returns an error, blocks render a friendly
    French message (no stack traces, no key, no internal codes). The uniform error envelope from the
    API (`error.code`/`error.message`) is mapped to a user-facing string; unknown codes fall back to a
    generic message.
12. **i18n.** All visitor-facing strings are French by default and wrapped in WordPress i18n
    (`__()`, `_e()`) with the `guestflow-booking` text domain, so they remain translatable.
13. **Packaging.** No build step (Rule 8). `bin/make-zip.sh` simply zips the plugin folder into an
    installable `guestflow-booking.zip` (the deliverable uploaded to WordPress), excluding VCS/OS
    cruft. Source = shipped artifact.

> **Rules 14–24 added 2026-10-18** (review of the website plugin, plugin v1.15.0). Earlier rules keep
> their numbers.

14. **Paste the URL and the key — nothing else to type.** The settings screen derives the rest:
    - **Logement par défaut** is a select filled from `GET /public/v1/properties` (chosen by name,
      pre-selected when GuestFlow has a single property). While GuestFlow cannot be read, the typed id
      field stays, with a line saying the list appears once connected.
    - **Page de réservation** and **Page des conditions générales** are page pickers. *Automatique*
      (the default, stored as `''`) = the oldest published page whose content holds the booking block
      (`<!-- wp:guestflow/booking`) or the `[guestflow_cgv]` shortcode; the detection is cached in a
      transient dropped whenever a page is saved or deleted. When none exists the picker offers
      « Créer la page » (a published « Réserver » page holding the booking block, or a « Conditions
      générales » page holding the shortcode); a second sanitize of the same save reuses the page it
      just created. A booking block with no property anywhere (no attribute, no `?property=`, no
      default) renders the properties block, whose cards link back to it — except on the payment
      return (rule 25). A page whose block fixes a lodging is never detected (rule 26).
    - **Proxys du réseau local** (on by default, `trust_local_proxies`): a reverse proxy with a private
      or loopback address is trusted to pass the visitor's IP in `X-Forwarded-For` without being
      listed. **Proxys de confiance** stays, under « Réglages avancés », for a proxy with a public
      address; the screen names the one it sees (`REMOTE_ADDR` public + `X-Forwarded-For` present).
      Without `X-Forwarded-For` the visitor IP is the connecting address, never empty. When every
      `X-Forwarded-For` hop is itself trusted, the visitor IP is the connecting address too — the
      left-most hop is whatever the client wrote, so it is never relayed (plugin 1.16.1).
    - Once configured, the connection test runs on arrival; its result is a `role="status"` region.
15. **The booking engine is usable with a screen reader.** Every input has an `id` and a `<label for>`;
    the contact fields carry `aria-required`. A stepper is a `role="group"` named after its line and
    its buttons read « Ajouter : Adultes » / « Retirer : Adultes » (`stepAdd`/`stepRemove`, translated);
    the count is `aria-live`. A calendar day is named in full in the page's language (« vendredi
    6 novembre 2026 », plus «, indisponible » when blocked, `GF.dayLabel`) and carries `aria-pressed`
    on the selected edges; the weekday headings are `aria-hidden`. The calendar hint, the quote
    summary, the inline warnings, the insurance and CGV notices and the submit feedback are
    `aria-live="polite"` regions. The honeypot is `aria-hidden`.
16. **A failed online payment is retried on the same devis.** After `POST /booking-requests` answers
    201 in pay-online mode, the block keeps `requestId`/`publicToken`; while the visitor resubmits the
    very same request body, the retry calls `/booking-requests/:id/pay` only — no second devis, no
    second reference. The error shows the request reference and says the payment can be retried. A
    changed form (dates, guests, contact…) is a new request. _(2026-10-18: narrowed to the stay — see
    rule 27.)_
17. **The plugin stylesheet sets `box-sizing: border-box` on its own blocks** (`.gf-block` and its
    descendants, pseudo-elements included) and `min-width: 0` on `.gf-field`, so a field's padding
    never overflows its column on a stock theme. Nothing outside `.gf-block` is touched.
18. **A website booking switched off in GuestFlow reads as such.** `{"error":"PLUGIN_INACTIVE"}` (a
    string error) and a 404 `{"error":{"code":"NOT_FOUND"}}` from `/public/v1` make « Tester la
    connexion » answer « Module « Réservation depuis le site » inactif dans GuestFlow. », and the
    blocks show their « Réservation temporairement indisponible. » state (`GF.t('unavailable')`), not
    the generic error.
19. **Weekday headings follow the page's language** in both the booking and the calendar blocks, from
    one `GF.weekdays()` helper (`Intl.DateTimeFormat(GF.locale, { weekday: 'short' })`, Monday first).
    The calendar block's navigation buttons use the translated `calPrevMonth`/`calNextMonth`.
20. **`Update URI: https://github.com/adn-dev-adrien/guestFlow`** is in the plugin header, so WordPress
    never offers a wordpress.org plugin of the same slug as an update; the self-update filter
    (`specs/wordpress-plugin-self-update.md`) is unchanged.
21. **No CGV published while GuestFlow requires them → no form.** `GET /public/v1/terms` answers
    `503 TERMS_NOT_CONFIGURED` with `details: [{ bookingClosed: <requireTermsAcceptance> }]` (field
    added, envelope unchanged). When `bookingClosed` is `true` the booking block renders « Réservation
    en ligne fermée pour le moment. » instead of a form the server would refuse at the end. With the
    enforcement off, the form shows without a CGV box, as before.
22. **Real plurals in the recap:** « 1 nuit » / « 3 nuits » (`night` / `nights` strings), never
    « nuit(s) ».
23. **Narrow layouts and the CGV switch.** The booking block is a size container: below 520 px of its
    own width the e-mail field and « Effacer » take a row each, so an address is never cut in half.
    The CGV language switch is text (« FR », « EN », with `lang`), not flag emojis.
24. **Every plugin change bumps its version in the three places the release reads** — the header
    `Version`, `GF_BOOKING_VERSION` and readme `Stable tag` — with a readme changelog entry, so a
    release never publishes two different `guestflow-booking-X.Y.Z.zip`. The update manifest's
    `tested` (`TESTED_WP`) names a current WordPress (≥ 6.8), the one the plugin was last tested on.

> **Rules 25–27 added 2026-10-18** (second review of plugin v1.15.0, PR #698).

25. **The way back from the payment page always shows that payment.** A booking block with no lodging
    (rule 14) renders its container — not the properties cards — when the address carries
    `gf_payment`, and the return address the block sends is
    `<page>?property=<id>&gf_payment=<devis>&gf_token=<token>`, so a page shared by every lodging
    knows both the payment and the lodging when the visitor comes back.
26. **The automatic booking page is a generic one.** The detection of rule 14 skips a page whose
    content holds `"propertyId":` (a booking block with its lodging fixed belongs to that lodging's
    page): with « Automatique », a site with one booking block per lodging page has no detected
    booking page, and its cards keep no button rather than opening another lodging's form. The
    detection cache moved to `gf_detected_pages_v2` so an earlier lodging-page answer is not reused.
27. **The stay alone decides a payment retry.** Rule 16's comparison covers the stay sent to
    `/quote` — dates, times, guests, options (insurance included) and resources — not the contact
    fields or the message: a corrected message or phone after a failed payment pays the same devis
    (which keeps the first request's message). Any change of the stay is a new request.

> **Rules 28–29 added 2026-10-19** (UI/UX review 2026-10-18, decisions 3 and 16; plugin v1.16.0).

28. **Refused on the field, in French** (UI/UX review 2026-10-18, decision 3). Every requirement of
    the form refuses the same way, on click, never by greying the button: the insurance answer, each
    contact field and the CGV box are all marked at once where they sit, and the first one in reading
    order is scrolled to the centre and given the focus. A contact field gets a red edge,
    `aria-invalid`, and its reason on a line under it (`aria-describedby`): « Champ requis. »,
    « Adresse e-mail incomplète. ». The marks are re-checked live as the visitor types, but only
    after a first refusal — no red while the guest is still typing. The local check is UX only
    (presence, and the browser's own `type=email` validity); the server decides: a `422` whose
    `details[]` names `guest.firstName|lastName|email|phone` is printed under that field with the
    server's `details[].message` (in the page language — public-api.md, booking-requests), the
    plugin's two strings serving as the fallback for an older GuestFlow. A mapped refusal is not
    repeated under the button. The generic line « Merci de renseigner tous les champs
    obligatoires. » is gone. Inputs carry `autocomplete`, `inputmode` (`email`, `tel`) and
    `enterkeyhint`, and are at least 16 px (iOS zooms into anything smaller).
    *Review of PR #722 (2026-10-19):* each error line is named by `aria-describedby` and reached with
    the focus — no live region per field, which read every refusal at once. Before revealing, the
    engine dispatches a bubbling, cancelable `gf:refused` event on the refused requirement's box, with
    `detail: { field, element }` (`field` ∈ `insurance`, `firstName`, `lastName`, `email`, `phone`,
    `terms`, `feedback`). A host that re-homes the engine's children — the Solio drawer, whose two
    screens can hide the refused field — shows the right screen and calls `preventDefault()`, then
    scrolls and focuses the field itself ([site-booking-drawer.md](site-booking-drawer.md) rule 17);
    otherwise the engine scrolls it to the centre and focuses it.
29. **One accent drives every colour of the engine; Maison fir green by default** (UI/UX review
    2026-10-18, decision 16). `assets/style.css` declares private tokens (`--gfb-*`) derived with
    `color-mix()` from one accent and one neutral ink — tint 8 %, range 15 %, hover 24 %, focus ring
    40 % — with hex fallbacks under `@supports`. The accent is the
    site's `--gf-accent`, else the theme's `--wp--preset--color--primary`, else Maison fir `#2F5D46`
    (it was MUI blue `#1976d2`). Notes and offers keep one semantic pair each, all at least 4.5 : 1
    (warning `#73551A` on `#F6EDD7`, success `#356B48` on `#E6EFE7`, error `#A8433A` on white and on
    `#F7E8E5`); the Tailwind amber/green/sky and slate surfaces, and the calendar block's always-blue
    free days, are gone. Where the accent carries white text or is itself text (chosen days, buttons,
    links, hints) the engine uses `--gfb-fill`: the accent itself when dark enough, else darkened to
    reach 4.5 : 1 on white — `oklch(from accent min(l, .54) c h)` where relative colours exist (fir
    green stays itself), the accent mixed 74 % with black otherwise (Solio ocre, 3.6 : 1 raw, reaches
    5.8 : 1). The tokens are declared on `.gf-block` and on every direct child of the engine form,
    which view.js marks `.gf-engine` — never site-wide, and no default is set on `--gf-accent`
    itself: the Solio drawer moves the engine's children out of the block and re-declares
    `--gf-accent` on its panel ([site-booking-drawer.md](site-booking-drawer.md) rule 12), so each
    child must recompute from the accent it actually inherits.
    *Review of PR #722 (2026-10-19):* the stylesheet never styles a class the site may own on its
    own: `.gf-btn` is reached as `.gf-block .gf-btn` or `.gf-btn.gf-engine` (Solio's `.gf-btn`,
    `.gf-btn-ghost`, `.gf-btn-forest` were repainted fir green), `.gf-section` likewise, the
    out-of-flow button is `.gfb-cta` (Solio's header has a `.gf-cta`), and the tap-highlight reset
    applies to engine buttons only. A test reads the stylesheet for each of these.
30. **A stay the seasons refuse reads as refused, in GuestFlow's words** (2026-10-27 audit, plugin
    1.17.1). When the quote carries `stayRefusal` (maximum stay or changeover days,
    [public-api.md](public-api.md) rule 12), the booking block treats it like a minimum-stay breach:
    the sentence under the calendar and in the récapitulatif, the bar's amount replaced by it, no quote
    kept, the request button disabled — the period stays on screen. The plugin writes no sentence of
    its own; a submit that still reaches GuestFlow is answered `409 MAX_NIGHTS` / `CHANGEOVER` with the
    same sentence, which the block already prints. A GuestFlow without the field behaves as before.

**Edge cases:**
- API key not configured → blocks show "Réservation temporairement indisponible" and the settings
  page shows a prominent "clé API non configurée" notice; proxy routes return `503` with a generic
  body.
- Visitor picks blocked dates in the booking block → the live quote still renders (with
  `available:false` from the API) but the **Submit** button is disabled with an inline message; the
  server re-checks anyway and would return `409`.
- Quote breaches minimum nights → inline message from the quote's `minNights`/`minNightsBreached`;
  submit disabled. Maximum stay or changeover days → the quote's `stayRefusal`, same treatment (rule 30).
- Slow/timeout API call → proxy uses a bounded timeout (e.g. 8 s) and surfaces a retry message; reads
  fall back to the last cached value when still within a stale-OK grace window (optional, see §9).
- Multiple blocks on one page → each block instance fetches independently; shared reads hit the same
  transient cache, so no duplicate upstream calls within the TTL.

---

## 4. Architecture

> **Fat backend, thin frontend — still holds.** GuestFlow stays the brain. The WordPress plugin is a
> thin proxy + renderer: PHP relays and caches; blocks render. **No** pricing/availability logic lives
> in PHP or JS. This spec adds **no** change to GuestFlow's `server/` or `client/` — the API itself is
> specified and implemented in [public-api.md](public-api.md).

### 4.1 Plugin codebase (`integrations/wordpress/guestflow-booking/`)

This is a standalone PHP/JS codebase, not part of GuestFlow's Node app. Layout:

| Path | T/C | Responsibility |
|---|---|---|
| `guestflow-booking.php` | C | Plugin header (Name, Version, Text Domain), bootstrap, hooks registration. |
| `uninstall.php` | C | Delete plugin options + transients on uninstall. |
| `readme.txt` | C | WordPress-style readme (install, config, blocks). |
| `includes/class-gf-plugin.php` | C | Singleton bootstrap: wires settings, REST proxy, blocks. |
| `includes/class-gf-settings.php` | C | Settings page + option storage (base URL, key, TTLs, default property). Since rule 14: property select from the API, page pickers with content detection / « Créer la page », local-proxy trust, test on arrival, « module inactif » (rule 18). |
| `includes/class-gf-api-client.php` | C | Server-side HTTP client to `/public/v1` (`wp_remote_*`, key header, timeout, error normalization). **The only place the key is read.** `visitor_ip()` trusts a private/loopback proxy when `trust_local_proxies` is on (rule 14). |
| `includes/class-gf-rest-proxy.php` | C | Registers `/wp-json/guestflow/v1/*` routes; validates params, calls the client, caches reads, enforces nonce on write. |
| `includes/class-gf-cache.php` | C | Transient get/set/flush keyed by path+query; TTLs from settings. |
| `includes/class-gf-blocks.php` | C | Registers the 3 blocks via `register_block_type` (one per `block.json`); enqueues shared front assets. |
| `blocks/calendar/` | C | `block.json`, `render.php`, `editor.js`, `view.js`, `style.css` — availability calendar (build-free, plain JS). |
| `blocks/booking/` | C | Same set — quote→request wizard (the core block). |
| `blocks/properties/` | C | Same set — property list. |
| `assets/runtime.js` | C | Shared helpers; since 2026-10-18 `GF.weekdays()` (rule 19), `GF.dayLabel()` and `GF.uid()` (rule 15), string-error → « unavailable » (rule 18). |
| `assets/style.css` | C | Shared styles; scoped `box-sizing` (rule 17), container query for narrow blocks (rule 23). Since 2026-10-19: the colour tokens (rule 29), field errors (rule 28), hover gated to fine pointers, day states, sticky bar and wide summary card (widget spec rules 29–33). |
| `blocks/booking/view.js` | T (2026-10-19) | `refuseMissing()` / `refuseFromServer()` / `contactField()` (rule 28); calendar states, next availability, sticky bar, summary card (widget spec rules 29–33). |
| `includes/class-gf-blocks.php` + `languages/guestflow-booking-en_GB.po/.mo` | T (2026-10-19) | 9 strings added (`legendFree`, `legendTaken`, `nextAvailable`, `nextAvailableGo`, `fieldRequired`, `emailInvalid`, `barPickDates`, `barContinue`, `taxIncluded`), `requiredFields` removed. |
| `bin/make-zip.sh` | C | Zips the plugin folder into `guestflow-booking.zip` (no build; excludes VCS/OS cruft). |
| `.gitignore` | C | Ignores `*.zip` + OS cruft. |

**Notes:**
- **No build toolchain** (Rule 8): no `package.json`, no `node_modules/`, no `build/`. Block editor +
  frontend JS is plain ES (`wp.blocks`, `wp.element.createElement`, `wp.apiFetch`), loaded directly.
- PHP only; no Composer dependency required (uses WP core `wp_remote_*`, REST, transients, i18n).
- The proxy is the trust boundary: reads = `permission_callback` open (public site) but param-validated
  + cached; write = nonce-checked.
- No PHP business logic — `class-gf-api-client.php` relays bytes, it does not interpret prices.

### 4.2 GuestFlow app (`server/`, `client/`)

**Untouched by this spec.** The public API endpoints this plugin calls are defined and implemented in
[public-api.md](public-api.md). If, during plugin work, a gap in the API surfaces, it is fixed in the
public-api spec + code (and this spec references it), never patched around in the plugin.

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| (all) | — | — | None in this spec until 2026-10-18. |
| server | `plugins/website-booking/controllers/publicTermsController.js` | T | `TERMS_NOT_CONFIGURED` carries `details[0].bookingClosed` (rule 21). |
| server | `plugins/website-booking/controllers/pluginUpdateController.js` | T | `TESTED_WP` kept current (rule 24). |
| server | `plugins/website-booking/publicProjections.js` + `publicQuoteController.js` | T | `payment.onlineReady` on the quote (specs/public-online-payment.md rule 12). |
| server + client | `siteConnectionController.js`, `SettingsWebsiteSection.jsx` | C | The URL and key the operator pastes (specs/plugins-phase-2-hosts.md rules 30–31). |
| server | `plugins/website-booking/publicInputValidation.js`, `controllers/publicBookingRequestController.js`, `utils/publicLabels.js` | T (2026-10-19) | Each refused contact field gets `reason` + `message` in the request's language (rule 28; additive, public-api.md). Plugin manifest 1.2.0. |
| server | `plugins/website-booking/nextAvailability.js`, `controllers/publicCatalogController.js`, `publicProjections.js` | C/T (2026-10-19) | `nextAvailableDate` on the availability payload (widget spec rule 30; additive). |

### 4.3 API contract (plugin REST proxy)

**Plugin namespace:** `/wp-json/guestflow/v1`. Each route forwards to the matching `/public/v1` route
(see [public-api.md §4.3](public-api.md)) with the key injected server-side. The browser uses
`@wordpress/api-fetch` (auto-attaches `X-WP-Nonce`).

| Method | Plugin route | Forwards to | Cache | Nonce |
|---|---|---|---|---|
| GET | `/guestflow/v1/properties` | `GET /public/v1/properties` | yes (TTL) | no |
| GET | `/guestflow/v1/properties/{id}` | `GET /public/v1/properties/:id` | yes (TTL) | no |
| GET | `/guestflow/v1/properties/{id}/options` | `GET /public/v1/properties/:id/options` | yes (TTL) | no |
| GET | `/guestflow/v1/properties/{id}/availability?from=&to=` | `GET /public/v1/properties/:id/availability` | yes (avail TTL) | no |
| POST | `/guestflow/v1/quote` | `POST /public/v1/quote` | no | recommended |
| POST | `/guestflow/v1/booking-requests` | `POST /public/v1/booking-requests` | no | **required** |

The proxy relays the upstream HTTP status and the uniform error envelope verbatim to the block, except
it strips any field the plugin shouldn't surface (none expected — the public API is already projected).
On upstream auth failure (`401`), the proxy returns `503` to the browser (the visitor must never learn
the key is wrong; that's an admin concern shown on the settings page).

---

## 5. Data model

**WordPress options** (single option array `guestflow_booking_settings`):
- `api_base_url` (string, e.g. `https://guestflow.example.com`)
- `api_key` (string; stored in wp_options — see §9 on hardening; masked in the UI)
- `ssl_verify` (int 0/1, default 1) — verify the GuestFlow server's TLS certificate. Default ON
  (secure). Set to 0 ONLY for a trusted local/LAN server with a self-signed certificate; otherwise
  `wp_remote_request` rejects the cert and the client returns 502. The `wp-config.php` constant
  `GUESTFLOW_SSL_VERIFY` wins over this option (production can pin it), mirroring the API-key rule.
- `cache_ttl` (int seconds, default 600)
- `availability_cache_ttl` (int seconds, default 300)
- `default_property_id` (int, optional)
- `booking_page_url`, `cgv_page_url` (string; `''` = *Automatique*, the detected page — rule 14)
- `trusted_proxies` (string, IP list) and `trust_local_proxies` (int 0/1, default 1 — rule 14)

**Transient** `gf_detected_pages` (1 day): the pages found by content, dropped on any page save/delete.

**Transients:** `gf_cache_<hash(path+query)>` holding cached GET responses, TTL per §5 above. Flushed
on settings save and on uninstall.

**No GuestFlow database change in this spec** (the `reservations.requestOrigin` column belongs to
[public-api.md](public-api.md)). **Data impact:** none on GuestFlow; the plugin only adds WP options +
transients, removed on uninstall.

## 6. UI / UX

All visitor strings in French, i18n-wrapped. Responsive by default (blocks use fluid layouts; calendar
collapses to a single month on narrow screens). The plugin inherits the active theme's typography and
respects its container width.

### Blocks

**`guestflow/calendar`** — attributes: `propertyId` (required), `monthsToShow` (1–3, default 2).
- Renders a month grid; blocked dates (from `availability.blockedDates`) are visually disabled
  (greyed, not selectable), available dates normal. No reason/label is shown (API is opaque).
- Loading state (skeleton), error state (friendly message), empty/no-availability state.
- Mobile (`xs`): one month, swipe/prev-next; desktop: up to `monthsToShow` side by side.

**`guestflow/booking`** — the core wizard. Attributes: `propertyId` (or a property selector if unset),
`showOptions` (bool, default true).
- Step 1 — dates + guests: date range picker (blocked dates disabled via availability), adults/children/
  teens/babies steppers bounded by the property capacity. Since 2026-08-14
  (specs/property-capacity-single-total.md §3 rule 13) that bound is ONE shared total: the `+` of
  adults/ados/enfants goes inert as soon as their sum reaches `maxGuests`, babies are capped by
  `maxBabies`, and a `Capacité : N voyageurs · N bébés` caption sits under the section title. Purpose:
  a visitor can no longer compose an occupancy the API rejects with `409 OVER_CAPACITY` at submit.
  `maxGuests: 0` = capacity not configured → no cap, no caption.
- Step 2 — options: list from `options`, with quantity inputs; live recompute. Only the
  **time-derived** auto-options are hidden (`autoOptionType` ∈ {`early_check_in`, `late_check_out`} —
  they are driven by the arrival/departure time fields, not a quantity). All other options are
  selectable, **including paid auto-options** (`bed_linen`, `bathroom_linen`, `breakfast`, …). The
  price label shows the unit (`/ pers.`, `/ pers. / nuit`) for per-person price types. (Options must
  be linked to the property in GuestFlow's `property_options` to appear at all.)
- Live quote: on each change, debounced POST to `/quote`; renders nights, accommodation total, options,
  tourist tax (with `label`), final price, deposit/balance schedule. If `available:false` or
  `minNightsBreached`, show inline message and disable submit.
- Step 3 — contact + message: first/last name, email, phone, free-text message, hidden honeypot `_hp`,
  submit button. On success → confirmation panel showing the booking reference
  (`BookingRequestReceipt.reference`) and a "nous vous recontactons" message. On `409`/`422` → inline
  error mapped to French. Since 2026-10-19 (rule 28) a refused contact field shows its reason under
  itself, red edge and focus on the first one; nothing about the refusal sits under the button.
- Colours (rule 29): one accent (site → theme primary → Maison fir), tints derived from it.
- Mobile: vertical stepper, full-width inputs, 16 px fields, phone/e-mail keyboards; below 900 px of
  block width the total and the button sit in a translucent bar pinned to the bottom of the block
  (widget spec rule 32), above 900 px the summary is a sticky card in a right column (rule 33).

**`guestflow/properties`** — attributes: `columns` (2–4, default 3), `bookingPageUrl`.
- Renders bookable properties (name, capacity = `maxGuests`, **never** a sum of the capacity fields —
  it used to add `maxAdults + maxChildren + maxBabies` and advertised 21 personnes for a 10-person
  gîte —, "à partir de X €/nuit" from `fromPricePerNight`); each
  links to a configured booking page anchor. No images (the API exposes none; the editor can add theme
  images alongside).
- Mobile: single column; desktop: grid (`columns`, default 3).

### Admin settings page (Settings → GuestFlow)

- Fields: API base URL, API key (masked, "Modifier" toggle), cache TTL, availability cache TTL, default
  property. "Test connection" button + result chip (success/auth error/unreachable). French labels.
- Since 2026-10-18 (rule 14): URL and key point to « Paramètres › Intégrations › Site internet » in
  GuestFlow; « Logement par défaut » is a select by name; the two pages are pickers (*Automatique :
  « Réserver »*, every published page, « Créer la page »); proxies and cache TTLs sit under a closed
  « Réglages avancés »; the test runs on arrival and says « Module … inactif dans GuestFlow. » when the
  module is off (rule 18).
- This is a WP admin screen (not a GuestFlow `PageActionBar` page — that component is GuestFlow-SPA
  specific and does not apply here).

## 7. Test plan

> The plugin is PHP/JS outside GuestFlow's `node --test` suite. Tests here are plugin-local + manual.

### Automated (plugin)
- [x] All `block.json` files are valid JSON; all block JS (`editor.js`/`view.js`) + `runtime.js` pass
      `node --check`. (Done 2026-06-08.)
- [ ] `php -l` on every PHP file — **not run** (no PHP in the build environment); to be run by the
      operator before packaging. No JS build to lint (build-free, Rule 8).
- [ ] PHP unit (if a WP test harness is set up): `class-gf-api-client` injects the key header and never
      logs it; `class-gf-rest-proxy` rejects the write route without a valid nonce; cache honors TTL.
- [x] Rules 25–27 (2026-10-18): `server/src/tests/wordpress-plugin-generic-booking-page.unit.test.js`
      (3 shape tests: payment return renders the container, return address keeps `property`, a
      fixed-lodging block is never detected) and `client/src/__tests__/wordpress-booking-view.payment-retry.test.js`
      (+2: a corrected message keeps the devis, the return address names the lodging; the « stay
      changed » case now changes the guests). Behaviour checked on WordPress 7.1 in Docker.
- [x] Rules 28–29 (2026-10-19): `server/src/plugins/website-booking/tests/public-guest-field-errors.unit.test.js`
      (5: reasons, FR/EN sentences, the 422 through the controller), `client/src/__tests__/wordpress-booking-view.field-refusal.test.js`
      (5: all marked at once + focus, no red before a refusal then live clearing, server message under
      its field, older server fallback, keyboards), `server/src/tests/wordpress-plugin-engine-colours.unit.test.js`
      (5: accent chain and fir default, no colour outside the tokens, tokens on every engine element,
      hover gated, edge above hover). Browser check at 390 / 900 / 1280 on a local harness (real
      `style.css`, `runtime.js`, `view.js`) against a GuestFlow on a neutralised copy of the Solio
      database: refusals in FR and EN, Solio ocre, theme primary and default fir accents, and a
      simulated Solio drawer (children moved out of the block: tokens resolve to the panel's ocre,
      no second bar, no summary button).
- [x] Review of PR #722 (2026-10-19): `field-refusal` +3 (`gf:refused` with the first field, a host's
      `preventDefault` keeps the reveal to itself, no live region per error line);
      `wordpress-plugin-engine-colours` +5 (tokens never site-wide, no bare `.gf-btn` / `.gf-section`
      / `.gf-cta`, default tokens ≥ 4.5 : 1, ocre darkened under white text, legacy-hover
      specificity, phone-only bar). Browser re-check with the real Solio CSS (`gf-site-style.php`,
      the drawer of `gf-seo-reservation.php`, the legacy `gf-booking.php`) injected into the harness,
      Chromium and WebKit, 390 touch / 900 / 1280.

- [x] Rule 30 (2026-10-27): `client/src/__tests__/wordpress-booking-view.stay-refusal.test.js` (2: the
      real `view.js` prints `stayRefusal` and keeps the request disabled; a quote without it is drawn
      as before); the refusal itself is `plugins/website-booking/tests/public-stay-rules.unit.test.js`.

### Manual verification
- [ ] Install the built `.zip` on a WordPress test site; configure base URL + key; "Test connection" =
      success.
- [ ] Calendar block: blocked dates greyed, available dates selectable; matches GuestFlow availability.
- [ ] Booking block happy path: pick dates + options → live quote matches a quote computed in GuestFlow
      → submit → confirmation with reference → the pending devis appears in GuestFlow's admin.
- [ ] Booking block edge: blocked dates disable submit; min-nights breach shows message; honeypot filled
      → silent non-persist.
- [ ] Security: confirm via browser devtools that the API key is **never** present in any JS, HTML, or
      network request from the browser (only the plugin's `/wp-json/guestflow/...` calls are visible).
- [ ] Security: a direct browser POST to `/wp-json/guestflow/v1/booking-requests` without a valid nonce
      is rejected.
- [ ] Responsive: calendar + booking wizard on mobile (≤600px), tablet, desktop.
- [ ] Failure: stop the API → blocks show the friendly French message, no leak.

## 8. Out of scope

- The public API itself (endpoints, auth, rate limiting) — see [public-api.md](public-api.md).
- Any change to GuestFlow `server/` or `client/`.
- Online payment from the WordPress site (a request is always a pending devis; the admin converts it).
- Publishing the plugin to the wordpress.org directory / SVN (it's a private plugin for the owner's
  site).
- Multilingual content beyond French i18n scaffolding (WPML/Polylang integration not in scope).
- A standalone availability calendar that shows reasons (booked vs closed) — the API is opaque by
  design.

## 9. Open questions

### Resolved (2026-06-08)

- **Q1 — API key storage → WP-CONFIG CONSTANT + OPTION FALLBACK.** If `GUESTFLOW_API_KEY` is defined in
  `wp-config.php` it takes precedence (not editable from the DB/UI); otherwise the masked
  `wp_options` value is used. `class-gf-api-client` is the single reader.
- **Q2 — Block set → ALL THREE IN V1.** `calendar`, `booking`, and `properties` all ship in v1.
- **Q5 — Floor → WP ≥ 6.4, PHP ≥ 8.0.** Determines block API version and allowed PHP syntax; declared in
  the plugin header (`Requires at least`, `Requires PHP`).
- **Q6 — Build artifacts → NONE (build-free).** The blocks use plain ES loaded directly, so there is no
  build step and no `build/` directory. `bin/make-zip.sh` just zips the source folder. (Supersedes the
  earlier wp-scripts plan — decided 2026-06-08 because the build can't be run/tested in this
  environment and a build-free plugin is simpler to install and maintain.)

### Resolved by default (override if needed)

- **Q3 — Stale-cache grace → YES, bounded.** On an upstream timeout a GET may serve the last cached
  value past its TTL within a bounded grace window (default up to 1 h), read endpoints only. The
  booking-request write never uses stale data.
- **Q4 — `properties` → booking page wiring → SINGLE CONFIGURABLE PAGE + QUERY PARAM.** Property cards
  link to one configurable booking-page URL with `?property=ID`; the `booking` block reads the param to
  preselect the property. (`bookingPageUrl` block attribute / settings default.)
