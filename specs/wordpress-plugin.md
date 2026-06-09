# WordPress plugin — GuestFlow Booking

| Field | Value |
|---|---|
| **Status** | Implemented (code) — pending manual verification on a live WordPress site |
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

**Edge cases:**
- API key not configured → blocks show "Réservation temporairement indisponible" and the settings
  page shows a prominent "clé API non configurée" notice; proxy routes return `503` with a generic
  body.
- Visitor picks blocked dates in the booking block → the live quote still renders (with
  `available:false` from the API) but the **Submit** button is disabled with an inline message; the
  server re-checks anyway and would return `409`.
- Quote breaches minimum nights → inline message from the quote's `minNights`/`minNightsBreached`;
  submit disabled.
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
| `includes/class-gf-settings.php` | C | Settings page + option storage (base URL, key, TTLs, default property). |
| `includes/class-gf-api-client.php` | C | Server-side HTTP client to `/public/v1` (`wp_remote_*`, key header, timeout, error normalization). **The only place the key is read.** |
| `includes/class-gf-rest-proxy.php` | C | Registers `/wp-json/guestflow/v1/*` routes; validates params, calls the client, caches reads, enforces nonce on write. |
| `includes/class-gf-cache.php` | C | Transient get/set/flush keyed by path+query; TTLs from settings. |
| `includes/class-gf-blocks.php` | C | Registers the 3 blocks via `register_block_type` (one per `block.json`); enqueues shared front assets. |
| `blocks/calendar/` | C | `block.json`, `render.php`, `editor.js`, `view.js`, `style.css` — availability calendar (build-free, plain JS). |
| `blocks/booking/` | C | Same set — quote→request wizard (the core block). |
| `blocks/properties/` | C | Same set — property list. |
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
| (all) | — | — | None in this spec. |

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
- `cache_ttl` (int seconds, default 600)
- `availability_cache_ttl` (int seconds, default 300)
- `default_property_id` (int, optional)

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
  teens/babies steppers bounded by the property capacity.
- Step 2 — options: list from `options`, with quantity inputs; live recompute.
- Live quote: on each change, debounced POST to `/quote`; renders nights, accommodation total, options,
  tourist tax (with `label`), final price, deposit/balance schedule. If `available:false` or
  `minNightsBreached`, show inline message and disable submit.
- Step 3 — contact + message: first/last name, email, phone, free-text message, hidden honeypot `_hp`,
  submit button. On success → confirmation panel showing the booking reference
  (`BookingRequestReceipt.reference`) and a "nous vous recontactons" message. On `409`/`422` → inline
  error mapped to French.
- Mobile: vertical stepper, full-width inputs, sticky summary/total at the bottom.

**`guestflow/properties`** — attributes: `columns` (2–4, default 3), `bookingPageUrl`.
- Renders bookable properties (name, capacity, "à partir de X €/nuit" from `fromPricePerNight`); each
  links to a configured booking page anchor. No images (the API exposes none; the editor can add theme
  images alongside).
- Mobile: single column; desktop: grid (`columns`, default 3).

### Admin settings page (Settings → GuestFlow)

- Fields: API base URL, API key (masked, "Modifier" toggle), cache TTL, availability cache TTL, default
  property. "Test connection" button + result chip (success/auth error/unreachable). French labels.
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
