# Website traffic analytics and booking attribution

| Field | Value |
|---|---|
| **Status** | Implemented (code — the §4.0 infrastructure is deployed separately) |
| **Branch** | `feature/site-traffic-analytics` |
| **Created** | 2026-09-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **HTML summary** | `docs/specs/2026-09-28-site-traffic-analytics.html` |

---

## 1. Context

`domainesolio.com` has been served by our WordPress (VM 103, `192.168.0.23`) since 2026-09-15. It
measures nothing. Checked in production on 2026-09-28:

- no tracker in the rendered pages (no `gtag`, Matomo, Plausible, Umami, Jetpack);
- no statistics plugin in `wp-content/plugins` (only `guestflow-booking`, `ml-slider`, `polylang`,
  `two-factor`) or in the 30 `gf-*` mu-plugins;
- no consent banner. The only cookies are the functional `pll_language` / `gf_lang`;
- no `google-site-verification` meta. Search Console may still be verified by DNS: to confirm;
- no privacy page. The published pages are the lodging pages, `le-domaine`, `autour-de-nous`,
  `contact`, `cgv` and their English twins.

Adrien therefore cannot answer the three questions that drive the site's work:

1. **How many people come, from where, and to which pages?** The SEO/AEO work (`gf-seo-*`, English
   version) and the Instagram launch campaign run blind.
2. **Where do visitors drop out of the booking tunnel?** The drawer (`specs/site-booking-drawer.md`)
   has seven steps between "open" and "paid". Nothing tells which one loses people.
3. **Which source brings bookings and revenue?** This question matters most. A GuestFlow reservation
   born of the site only knows `requestOrigin = 'public'`. Whether the guest came from Google,
   Instagram, ChatGPT or a campaign link is lost.

A fourth need came up while discussing the tool: **being told when the site or the booking tunnel
is down.** On 2026-08-20 the tunnel was broken silently after the migration (see the
`wordpress-deploy-topology` notes). The homelab already has a working supervision stack on VM 108:
Prometheus, Grafana, and Alertmanager mailing Gmail through `pve01`'s postfix. None of it probes the
public site.

### Decisions taken in chat (2026-09-28)

| Decision | Choice | Why |
|---|---|---|
| Audience tool | **Umami, self-hosted** on the Proxmox | Cookieless, so no consent banner, and every visitor is counted. A GA4 banner loses 30–50 % of visitors on a site this small. Data stays home. Raw events sit in Postgres, so any missing report can be written in SQL. Rejected: GA4 (banner, data at Google), Matomo (heavier; funnels are a paid add-on), Plausible Cloud (paid, same data as Umami). |
| Scope | **Audience + booking funnel + GuestFlow attribution** | The GuestFlow layer is the only one that answers question 3 in euros. |
| Uptime alerts | **The existing Prometheus stack** (`blackbox_exporter` + rules), not Uptime Kuma | Alertmanager already mails Adrien and Grafana already has the dashboards. A second alerting tool would duplicate both and need its own upkeep. |
| Search keywords | **Google Search Console + Bing Webmaster Tools** | No audience tool has search queries, GA4 included. |

## 2. Goal

Adrien can see the visitors, their sources and pages, and the drop-off point in the booking tunnel.
He can see **which sources turn into GuestFlow reservations and revenue**. He is mailed when the
site or the booking tunnel stops answering. No visitor is asked for consent, because nothing
measured requires it.

## 3. Functional rules

### A. Audience measurement (Umami)

1. Umami runs on a new unprivileged Debian 13 LXC (`stats`, next free VMID, fixed IP outside the
   DHCP range). It is native (Node + PostgreSQL, systemd), not Docker in an LXC. It joins the fleet
   with the five settings that move together (notes `02-architecture-cible.md`, "piège 11"):
   firewall, `ADN_GUESTS`, `backup-nightly`, probe `/etc/adn/probes/<id>.sh`, and a Prometheus
   `nodes` target with `prometheus-node-exporter-collectors`.
2. **The tracker is first-party.** Caddy (`edge`) proxies `https://domainesolio.com/_s/*` to the
   Umami LXC. That path carries the script and the `/_s/api/send` collect endpoint. The site never
   loads a third-party domain, so ad-blockers that match Umami hostnames or script names do not
   blind the measurement. The script is served under a neutral name.
3. **The Umami dashboard is not exposed to the Internet.** The admin UI is reachable on the LAN only,
   at `stats.maison.adn-dev.fr` (internal names, LXC 109). Only `/_s/script.js` and `/_s/api/send`
   are public. There is no access from outside the LAN, not even a read-only share link (§9 Q1).
4. A mu-plugin `gf-analytics.php` injects the tracker on every public page, FR and EN, `defer`,
   with `data-domains="domainesolio.com"`. This keeps local copies, staging and `wp.` hosts out of
   the statistics.
5. **No tracker for a logged-in WordPress user.** Adrien's own visits and edits must not inflate the
   numbers. The tracker is also absent from `wp-admin`, `wp-login.php`, previews and the REST API.
6. **No cookie, no identifier, no personal data** are sent to Umami. Event properties never include
   a name, e-mail, phone, message, reservation number or price. They are limited to the lodging slug,
   night count, guest count, language, step and refusal reason (rule 12).
7. Umami data is purged after **25 months** by a daily job on the LXC (§9 Q4). This matches the
   CNIL retention limit for exempt audience measurement.
8. The Umami version is pinned and upgraded manually, like the other self-hosted apps. The LXC's OS
   follows the automatic maintenance window (`09-maintenance-auto.md`).

### B. Booking funnel events

9. The GuestFlow Booking plugin exposes **`GF.track(name, detail)`** in `assets/runtime.js`. It
   dispatches a `CustomEvent('guestflow:booking', { detail: { name, ...detail } })` on `document`
   and knows nothing about Umami. The plugin stays tool-agnostic: any site running it can listen
   with GA4, Matomo or nothing.
10. The engine (`blocks/booking/view.js`), the Solio drawer (`gf-seo-reservation.php`) and the home
    search bar (`gf-search.php`) call `GF.track` at the steps below. Each event fires **once per
    step change**, not on every re-render. For example, re-picking the same dates does not fire
    `booking-dates` again.

    | Event | When | Properties |
    |---|---|---|
    | `search-go` | Home search "go" click | `nights`, `guests` |
    | `booking-open` | Drawer opens | `lodging`, `trigger` (`button` \| `hash` \| `link`) |
    | `booking-dates` | Both dates set | `lodging`, `nights` |
    | `booking-quote` | Quote displayed | `lodging`, `nights`, `guests` |
    | `booking-unavailable` | Quote refused (dates taken, minimum stay) | `lodging`, `reason` (`taken` \| `min-nights` \| `error`) |
    | `booking-step2` | Drawer moves to the recap + contact step | `lodging` |
    | `booking-refused` | Client-side refusal on submit | `lodging`, `reason` (`insurance` \| `fields` \| `terms`) |
    | `booking-requested` | `POST /booking-requests` succeeds | `lodging`, `nights`, `guests` |
    | `booking-error` | `POST /booking-requests` fails | `lodging`, `reason` (`terms-outdated` \| `server`) |
    | `booking-pay` | Redirect to Qonto | `lodging` |
    | `booking-paid` | Return with a confirmed status | `lodging` |

11. `gf-analytics.php` listens to `guestflow:booking` and forwards each event to `umami.track(name,
    props)`. If Umami did not load (blocked, down), nothing happens and the tunnel is unaffected.
    **Analytics must never be able to break a booking**: every listener is wrapped in `try/catch`.
12. `lodging` is a **slug of the lodging's name** as the engine displays it (`la-granja`,
    `l-estiva`, built by `GF.slug`), never the GuestFlow numeric id. The Umami funnel reads in words.

### C. Booking attribution in GuestFlow

13. On the first page view of a browsing session, the plugin records the visit's **attribution**
    in `sessionStorage` (key `gf_attr`). The capture is a separate script, `assets/attribution.js`,
    enqueued on **every public page**, because the landing page rarely has a booking block. It is not
    enqueued for a logged-in user, and a site can turn it off with the
    `guestflow_booking_capture_attribution` filter. The record keeps the first touch and is
    never overwritten during the session:
    - `referrer`: the **host** of `document.referrer`, only when it is external. The site's own
      pages and the Qonto return are not referrers. The full URL is never stored.
    - `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm`: from the landing URL.
    - `landingPath`: the landing page's path without its query string.
    - `firstSeenAt`: the landing timestamp.

    `sessionStorage` dies with the tab. Nothing survives the visit, and nothing is shared across
    sites (§9 Q2 records the legal reading).
14. `POST /booking-requests` sends that record as an optional **`attribution`** object. The WordPress
    proxy already forwards the body unfiltered (`class-gf-rest-proxy.php:198`), so the plugin adds no
    proxy change. An absent or empty record means "unknown", never an error.
15. The server validates `attribution` in a dedicated validator. It keeps known keys only, strings
    only, each capped at 200 characters and trimmed. `referrer` must look like a hostname and
    `landingPath` must start with `/`. **An invalid attribution is dropped silently. It never
    rejects the booking request.** A guest must never lose a booking over analytics metadata.
16. The server derives a **channel** from the validated record (pure function, unit-tested). The first
    matching rule wins:
    1. any `utm*` present → `campaign`, labelled by `utmCampaign` (fallback `utmSource`);
    2. referrer is a known AI assistant (`chatgpt.com`, `chat.openai.com`, `perplexity.ai`,
       `claude.ai`, `gemini.google.com`, `copilot.microsoft.com`) → `ai`;
    3. referrer is a known search engine (Google, Bing, DuckDuckGo, Qwant, Ecosia, Yahoo, any
       country TLD) → `search`;
    4. referrer is a known social network (`instagram.com`, `l.instagram.com`, `facebook.com`,
       `m.facebook.com`, `l.facebook.com`, `pinterest.*`, `linkedin.com`, `t.co`, `x.com`,
       `tiktok.com`, `youtube.com`) → `social`;
    5. any other external referrer → `referral`, labelled by its host;
    6. no referrer and no UTM → `direct`;
    7. no attribution sent at all (older plugin, blocked storage) → `NULL`, shown as "Inconnue".

    The label is normalized for display: `instagram` → "Instagram", `google` → "Google", etc.
17. The channel, label and raw record are stored on the devis row in the `persist` transaction of
    `publicBookingRequestController.create`. They **travel to the reservation on conversion**
    (`carryOverColumns` in `devisModel.js`, as `requestOrigin` does). A source that disappears at
    conversion would erase the site's share exactly when the booking becomes real.
18. Attribution is **read-only** in the back-office. It records how the guest arrived, not an
    operator setting. Reservations created by hand or imported by iCal have none.

### D. Back-office views

19. The reservation page, which also opens a devis, shows an **"Origine"** chip next to the existing
    "Site internet" badge. The devis list shows the same chip on the rows that carry the badge when the record has a channel: channel label + detail, e.g.
    "Réseaux sociaux · Instagram", "Campagne · lancement-2026", "Recherche · Google",
    "Assistant IA · ChatGPT", "Accès direct". A tooltip lists the raw fields (landing page, UTM).
    A public request without attribution shows "Origine inconnue".
20. The devis list's "Origine" filter (`specs/admin-public-request-visibility.md`) is unchanged.
    Filtering by channel is out of scope.
21. The Finance page gains a **"Canaux de réservation"** card for the selected period (same period
    selector and the same "sur la période / depuis le début de l'exercice" tabs as the per-lodging
    chart). It has one row per channel:
    - each platform (`Airbnb`, `Booking`, `Gîtes de France`…), by `platform`;
    - the website, **split by attribution channel** (`Site · Recherche`, `Site · Réseaux sociaux`,
      `Site · Campagne`, `Site · Assistant IA`, `Site · Autre site`, `Site · Accès direct`,
      `Site · Inconnue`);
    - `Direct (saisie)` for direct reservations not born of the site. "Direct" is decided by
      `isDirectChannel(platform)` (`utils/platformNameFormat.js`): most direct bookings carry
      `lodgify`, never test `platform === 'direct'`.

    A reservation with `requestOrigin = 'public'` always lands in a website row, whatever its
    `platform`. Revenue is attributed by the same attribution date as the rest of the page.

    Columns: reservations, nights, revenue. The website rows add site requests and conversion rate
    (requests converted / requests created in the window, same source). The card has three blocks:
    the website rows with their subtotal, then the platforms and manual direct, then the total. Rows
    are sorted by revenue, descending, within each block.
22. **Revenue in that card uses exactly the definition of the per-lodging revenue chart**
    (`financeModel` `revenueByProperty` / `yearToDateByProperty`). The card's total equals that
    chart's total for the same period. This is an invariant with a unit test: two revenue figures
    that disagree on the same screen are a bug.
23. All grouping, labelling, sorting and rate computation happen on the server. The client renders
    the rows it receives.

### E. Search engines

24. Google Search Console and Bing Webmaster Tools are verified on the `domainesolio.com` domain
    property by DNS TXT record (Adrien adds it at the registrar). The sitemap `wp-sitemap.xml` is
    submitted to both. No meta tag goes in the site.

### F. Availability alerts (Prometheus, VM 108)

25. `prometheus-blackbox-exporter` is installed on VM 108 with three probe groups:
    - **site**: `https://domainesolio.com/` and `/en/`, expecting HTTP 200 and the string "Solio";
    - **tunnel**: `https://domainesolio.com/wp-json/guestflow/v1/properties`, expecting HTTP 200 and a
      JSON array. It exercises WordPress → proxy → GuestFlow → DB end to end, the chain that broke
      silently on 2026-08-20;
    - **stats**: `https://domainesolio.com/_s/script.js`, expecting HTTP 200.
26. Four rules join `adn-rules.yml`, routed through the existing Alertmanager → e-mail path:

    | Alert | Condition | For |
    |---|---|---|
    | `SiteDown` | site probe failing | 5 min |
    | `BookingTunnelDown` | tunnel probe failing | 5 min |
    | `TlsCertExpiringSoon` | any probed certificate expires in < 14 days | 1 h |
    | `StatsDown` | stats probe failing | 30 min |

27. Each rule is proven once by forcing its condition, then checked to arrive in Gmail, as the
    existing rules were (`09-maintenance-auto.md`: "avant de croire un mail d'alerte, rejouer la
    sonde à la main"). A rule never seen firing is not trusted.

### G. Privacy notice

28. A **"Confidentialité"** page (FR) and its **"Privacy"** twin (EN) are published and linked from
    the footer next to the CGV. They say:
    - that the audience is measured by a self-hosted, cookieless tool, with no personal data and a
      25-month retention;
    - that a booking request carries the visit's source (referrer site, campaign) to the owner's
      management software, and why;
    - the identity of the controller and the rights of the data subject.

    The page content lives in the WordPress database. Only the footer template is versioned.

**Edge cases:**
- Visitor blocks `sessionStorage` or has an old cached plugin → no `attribution` sent → channel `NULL` → "Origine inconnue". The booking goes through.
- Visitor lands through an old Lodgify URL with UTMs → `gf-seo-redirects.php` rebuilds the target from the path and **drops the query string today**. The redirect must preserve `utm_*` parameters, otherwise every campaign link to an old URL reads as "direct".
- Visitor goes to Qonto and back → the Qonto host is not an external referrer (rule 13), and the first-touch record is already in `sessionStorage`.
- Visitor comes from Instagram, leaves, and returns via Google the next day to book → recorded as `search`. This is last-session attribution, not multi-day; §8 lists it as out of scope.
- A devis from the site is deleted, then re-requested → the new request carries its own attribution.
- `utm_campaign` contains HTML or 5 KB of junk → trimmed to 200 characters, stored as text, rendered escaped. It never reaches the DOM as markup.
- Umami LXC is down → `/_s/*` returns 502. The tracker fails silently, the site and the tunnel are unaffected, and `StatsDown` mails after 30 min.

---

## 4. Architecture

> **Fat backend, thin frontend.** Channel classification, label normalization, grouping and revenue
> all live on the server. The only client-side logic is in the WordPress plugin runtime: reading
> `document.referrer` and the landing URL can only happen in the visitor's browser. It records raw
> facts and classifies nothing.

### 4.0 Infrastructure (outside this repository, recorded in `~/.claude/notes/migration-proxmox/`)

| Where | What | T/C | Responsibility |
|---|---|---|---|
| Proxmox `pve01` | LXC `stats` | C | Umami + PostgreSQL, native, systemd. Fleet integration per rule 1 |
| LXC `stats` | `/etc/cron.daily/umami-retention` | C | Deletes events older than 25 months (rule 7) |
| LXC 101 `edge` | `Caddyfile` | T | `handle_path /_s/*` on the `domainesolio.com` block → Umami; `stats.maison.adn-dev.fr` internal block |
| LXC 101 `edge` | `101.fw` | T | Egress rule to the `stats` LXC |
| LXC 109 `intra` | internal names | T | `stats.maison.adn-dev.fr` |
| VM 108 | `blackbox_exporter`, `prometheus.yml`, `rules/adn-rules.yml` | C/T | Probes and alerts, rules 25–27 |
| Registrar DNS | TXT records | C | Search Console + Bing verification (Adrien) |

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `attributionChannel.js` | C | Pure: `classifyAttribution(record) → { channel, label }` per rule 16, plus the channel display labels |
| `utils/` | `publicInputValidation.js` | T | `validateAttribution(raw)`: known keys, strings, 200-char caps, hostname/path shape. Returns a clean record or `null`, never throws (rule 15) |
| `controllers/public/` | `publicBookingRequestController.js` | T | `create()` validates, classifies and writes the attribution in the `persist` transaction (rule 17) |
| `models/` | `devisModel.js` | T | `carryOverColumns` copies the attribution columns on conversion. The devis detail payload exposes them |
| `models/` | `reservationsModel.js` | T | The reservation detail payload exposes the attribution columns and the ready-to-render `originLabel` / `originDetail` |
| `utils/` | `attributionChannel.js` | — | Also `bookingChannelOf` (a reservation's row in the card, rule 21) and `platformDisplayName` (« GitesDeFrance » → « Gîtes de France ») |
| `models/` | `financeModel.js` | T | `revenueByChannel` / `yearToDateByChannel`: accumulated in the same loops and with the same per-row figures as `revenueByProperty`, grouped per rule 21, and shaped into `{ site: { rows, subtotal }, others, total }` |
| `controllers/` | `financeController.js` | T | Passes the channel breakdown through `/api/finance/summary` |
| `routes/` | `finance.js` | — | Unchanged; the payload grows |
| `database.js` | `database.js` | T | Idempotent migration, §5 |
| `schema.sql` | `schema.sql` | T | Baseline columns for fresh databases |

No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `OriginBadge.jsx` | C | Renders `originLabel` / `originDetail` + tooltip of raw fields. Generic: used by the reservation page (devis and reservation) and the devis list |
| `components/` | `ChannelBreakdownCard.jsx` | C | Renders the "Canaux de réservation" rows. It is a table from `sm` up and stacked cards on `xs` |
| `pages/` | `ReservationPage.jsx` | T | Shows `OriginBadge` next to the "Site internet" badge |
| `pages/` | `DevisPage.jsx` | T | Same chip on the list rows badged "Site internet" (the list payload carries `originLabel`) |
| `pages/` | `FinancePage.jsx` | T | Adds `ChannelBreakdownCard` under the per-lodging chart, fed by the summary payload |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed** | `TableCard`, `EmptyState`, `PageTabs`, existing `LanguageBadge` placement | |
| **Created (generic)** | `OriginBadge` | Chip + tooltip for a labelled origin. Reused on two pages now |
| **Specific** | `ChannelBreakdownCard` | Bound to the finance payload shape. It is kept feature-local because one page uses it |

### 4.3 WordPress (`integrations/wordpress/`)

| Where | File | T/C | Responsibility |
|---|---|---|---|
| plugin | `assets/attribution.js` | C | First-touch attribution capture on every public page (rule 13) |
| plugin | `assets/runtime.js` | T | `GF.track()` (rule 9), `GF.attribution()` (reads the record) and `GF.slug()` (rule 12) |
| plugin | `includes/class-gf-blocks.php` | T | Enqueues `attribution.js` on every public page, except for a logged-in user or when the filter says no |
| plugin | `blocks/booking/view.js` | T | Events per rule 10. `attribution` is sent in `submit()` |
| plugin | `guestflow-booking.php`, `readme.txt` | T | Version **1.14.0** + changelog |
| site | `mu-plugins/gf-analytics.php` | C | Tracker injection (rules 4–5) and the `guestflow:booking` → `umami.track` bridge (rule 11) |
| site | `mu-plugins/gf-seo-reservation.php` | T | Drawer events `booking-open` (with `trigger`) and `booking-step2` |
| site | `mu-plugins/gf-search.php` | T | `search-go` |
| site | `mu-plugins/gf-seo-redirects.php` | T | Preserves `utm_*` through the 301s (edge case) |
| site | `template-parts/footer.html` | T | Privacy link (rule 28) |
| site | `mu-plugins/gf-i18n.php` | T | « Privacy » label and `/confidentialite/` → `/en/privacy/` |

`gf-booking.php`, the legacy widget, is **not** instrumented. It must be removed from the site
before this ships, if no page still uses it.

### 4.4 API contract

| Method | Endpoint | Change |
|---|---|---|
| POST | `/public/v1/booking-requests` | Optional `attribution: { referrer?, utmSource?, utmMedium?, utmCampaign?, utmContent?, utmTerm?, landingPath?, firstSeenAt? }`. It is additive and backward-compatible: older plugins send nothing, and the response is unchanged |
| GET | `/api/reservations/:id`, `/api/devis/:id`, `/api/devis` (list rows) | Adds `attributionChannel`, `attributionLabel`, `attribution` (raw object), `originLabel`, `originDetail` |
| GET | `/api/finance/summary` | Adds `revenueByChannel`, `yearToDateByChannel`, each `{ site: { rows, subtotal }, others, total }`. A row is `{ key, group: 'platform'\|'site'\|'direct', channel, label, reservations, nights, revenue, revenueHt }`. Site rows and the site subtotal add `requests`, `converted` and `conversionRate` (a percentage with one decimal, `null` when there are no requests) |

This is an additive change to `/public/v1`, so it is **not an X** (CLAUDE.md §5.6). Release: **Y**.
`specs/public-api.md` is updated: the request body example gains `attribution`, and the
long-standing gap the exploration found is closed at the same time (the documented body lacks
`resources`, `babyBeds`, `termsVersion` and the insurance fields).

---

## 5. Data model

Four nullable columns on `reservations` (devis and reservations share the table):

| Column | Type | Content |
|---|---|---|
| `attributionChannel` | TEXT | `campaign` \| `ai` \| `search` \| `social` \| `referral` \| `direct` \| NULL |
| `attributionLabel` | TEXT | Normalized detail: "Instagram", "Google", "lancement-2026"… |
| `attribution` | TEXT (JSON) | The validated raw record (rule 15) |
| `attributionAt` | TEXT | Server timestamp of capture |

Plus `CREATE INDEX IF NOT EXISTS idx_reservations_attribution_channel ON reservations(attributionChannel)`.

- Migration: idempotent `ADD COLUMN` guards in `database.js`, mirrored in `schema.sql`.
- Existing rows stay `NULL` → "Inconnue" for past site requests. **No backfill**: the source of a
  past visit cannot be recovered.
- **Data impact:** additive only. No existing value is read, changed or deleted.

## 6. UI / UX

### 6.1 "Origine" on the reservation page and the devis list

A chip is placed right after the "Site internet" badge, in the same row as `LanguageBadge`:

- `Réseaux sociaux · Instagram` / `Recherche · Google` / `Assistant IA · ChatGPT` /
  `Campagne · lancement-2026` / `Autre site · booking-guide.fr` / `Accès direct` / `Origine inconnue`.
- Tooltip (desktop hover, mobile long-press): the label followed by the server's detail, e.g.
  `Campagne · lancement-2026 — Arrivé sur /la-granja/ · utm_source=instagram · utm_medium=story`.
  Without detail: `Origine de la demande : Origine inconnue`.
- Not shown at all for a reservation that is not a website request.
- **Mobile (`xs`)**: the chip wraps under the badges row. It is capped at 220 px and ends in an
  ellipsis; the tooltip carries the full text.
- The devis list shows the same chip next to the "Site internet" badge of the devis number.

### 6.2 "Canaux de réservation" on the Finance page

This full-width card sits under the "Revenu par logement" / "Répartition" row. It follows the tab
of "Revenu par logement" ("Sur la période" / "Depuis le début de l'exercice"). Its caption reads
« Même fenêtre et même total que « Revenu par logement » · montants TTC ».

- **`sm+`**: a table with columns Canal · Résas · Nuits · CA · Demandes · Conversion. The website
  rows come first, under a "Site internet" sub-header, with a "Sous-total site" row. The platforms
  and "Direct (saisie)" follow, then a "Total" row that equals the "Revenu par logement" total.
  Platform rows read « — » in the two website columns.
- **`xs`**: one stacked card per channel (label, CA large, then "N résas · N nuits"; website cards are
  labelled "Site · <source>" and add "N demandes · N % convertis"), then a "Total" card. No horizontal
  scroll.
- Empty period → `EmptyState` "Aucune réservation sur la période".
- No new page-level action. `PageActionBar` is unchanged.

### 6.3 What the operator sees in Umami

These are Umami's own screens, not ours. They are listed so the acceptance can check them:
dashboard (visitors, views, sources, pages, countries, devices, languages), a **"Tunnel de
réservation" funnel report** pre-built from `booking-open` → `booking-dates` → `booking-quote` →
`booking-step2` → `booking-requested` → `booking-paid`, and a **UTM report** for the campaign.

## 7. Test plan

### Server unit tests — 16
`site-traffic-analytics.unit.test.js` (10), `finance-channel-breakdown.unit.test.js` (3), plus 2 cases
in `public-booking-request-controller.unit.test.js` and 1 in `booking-request-language.unit.test.js`
(the existing conversion fixture). Seven finance suites gained the four columns in their minimal
schema.
- [x] `classifyAttribution`: one table-driven case per rule 16 branch, including precedence (UTM + Google referrer → `campaign`), country TLDs (`google.fr`, `google.co.uk`), `l.instagram.com`, and unknown host → `referral`.
- [x] `validateAttribution`: unknown keys dropped, non-strings dropped, 200-char cap, bad hostname or path → field dropped, garbage object → `null`, **never throws** (rule 15).
- [x] `create()`: a request with attribution persists channel, label and raw. A request with an invalid attribution **still succeeds** with channel `NULL`.
- [x] Conversion: devis → reservation carries the four columns (rule 17).
- [x] `revenueByChannel`: rows grouped per rule 21, and **the total equals the `revenueByProperty` total** and `revenueTotal`, for the period and the exercise (rule 22). Conversion rate with zero requests → `null`, not `NaN`.
- [x] `originDisplay` and `bookingChannelOf` (Lodgify is direct; a website request is a website row whatever its platform).

### Client (Vitest, one file per subject) — 6
- [x] `components/__tests__/OriginBadge.test.jsx` (3): label, tooltip content with and without detail, no render without a label.
- [x] `components/__tests__/ChannelBreakdownCard.test.jsx` (3): table blocks, subtotal and total from the payload, phone cards, empty state.

### Plugin / site (manual, on the live site after deployment)
- [ ] Visit `/?utm_source=instagram&utm_campaign=test-analytics`, open the drawer, request a stay → the devis shows "Campagne · test-analytics". The Umami funnel shows the steps.
- [ ] Same through an old Lodgify URL with UTMs → UTMs survive the 301.
- [ ] Logged in to WordPress → no request to `/_s/api/send`.
- [ ] Block `/_s/` in the browser → the booking goes through end to end.
- [ ] Mobile (390 px): drawer events fire, origin chip wraps, Finance card stacks.

### Infrastructure
- [ ] Each of the four alerts is forced once and received in Gmail (rule 27).
- [ ] `backup-nightly` includes the new LXC. One restore is tested.
- [ ] Retention job dry-run lists the right rows.

## 8. Out of scope

- **Consent banner.** Nothing measured requires one (§9 Q2). If a future tool does (GA4, Meta pixel,
  ads), it comes with its own spec.
- **Multi-day or cross-device attribution.** Tracking the same visitor across days needs a
  persistent identifier, which means consent.
- Heatmaps and session replay.
- Advertising integrations: Google Ads, Meta conversions API.
- Filtering the devis list by channel. Attribution on reservations imported from platforms, which
  have their own channel.
- External uptime monitoring from outside the LAN. The probes run from VM 108, inside the LAN, so
  an ISP or DNS outage is not seen. It would not be mailable anyway while the line is down.
- Instrumenting the legacy `gf-booking.php` widget.
- Reading the Umami dashboard from outside the LAN (§9 Q1).

## 9. Open questions

All four resolved by Adrien on 2026-09-28.

- **Q1 — Umami dashboard access from outside.** LAN only + an optional read-only share link, LAN
  only, or a public `stats.adn-dev.fr` login?
  - A (2026-09-28): **LAN only.** No share link, nothing of the dashboard published. Rule 3.
- **Q2 — Legal reading of the attribution capture.** The CNIL exempts audience-measurement trackers
  from consent under conditions. Two of them matter here: the data serves the publisher's statistics
  only, and it is not combined with other processing. Attaching the source to a booking request
  combines it with an identified person. Options:
  (a) `sessionStorage` first-touch, disclosed in the privacy page (recommended: session-scoped, no
  identifier, only the facts a "how did you hear of us?" answer would give);
  (b) no storage: read `document.referrer` and the URL only on the page where the request is
  submitted. This is safer, but a visitor who browses home → lodging loses the source;
  (c) (a) plus an optional "Comment nous avez-vous connus ?" field in the form (declarative, fully
  consent-free, catches word of mouth). This is not legal advice.
  - A (2026-09-28): **(a) `sessionStorage` first-touch**, disclosed in the privacy page. Rules 13, 28.
- **Q3 — Scope of "Canaux de réservation".** Platforms + site split by source + manual direct
  (recommended), or website sources only?
  - A (2026-09-28): **Platforms + site split by source + manual direct.** Rule 21.
- **Q4 — Umami retention.** 25 months (recommended, CNIL limit), or unlimited?
  - A (2026-09-28): **25 months.** Rule 7.
