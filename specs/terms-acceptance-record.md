# Terms and conditions (CGV) owned by GuestFlow, with a recorded acceptance

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/terms-acceptance-record` |
| **Created** | 2026-09-21 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Release** | **X** — `/public/v1/booking-requests` refuses a request without acceptance (§3.4, decided by Adrien 2026-09-21) |
| **Depends on** | [public-api.md](public-api.md), [wordpress-plugin.md](wordpress-plugin.md), [public-online-payment.md](public-online-payment.md) |
| **Decision page** | [terms-acceptance-record/resume.html](terms-acceptance-record/resume.html) |

---

## 1. Context

A guest booking on domainesolio.com must tick « J'ai lu et j'accepte les conditions générales de
location » before the « Réserver » button unlocks. That checkbox is **not part of the booking engine**:
it is injected by the site mu-plugin `integrations/wordpress/solio-site/mu-plugins/gf-seo-reservation.php`
(lines 403-411) and only toggles the button's `disabled` state (line 611). The click then forwards to
the GuestFlow plugin's own button, which posts `stay + guest + message + _hp` to
`POST /public/v1/booking-requests`. Nothing about the terms travels:

- `publicBookingRequestController.create` reads no acceptance field;
- no column or table stores an acceptance, a timestamp, or which text was accepted;
- the only date kept is the devis `createdAt`, which proves a request was made, not that the terms
  were accepted;
- the check is purely cosmetic: a request that skips the checkbox is accepted by the server.

The CGV themselves live in a WordPress page (`/cgv/`, FR + EN blocks with a language switch), edited in
place, whose text also moves when a quoted fact changes (`[solio_caution]`). « The current page » is
therefore no evidence of what a guest saw on a given day. For a distance contract the burden of
proving the pre-contractual information rests on the professional (Code de la consommation,
art. L221-7), and the contract must be confirmed on a durable medium (art. L221-13).

**Rate-limit defect found on the way (fixed here, §3.6).** The plugin's PHP proxy calls GuestFlow
server-to-server without forwarding the visitor's address, so every booking request reaches GuestFlow
from the WordPress host's single IP. `bookingRequestLimiter` (5 / hour / IP) therefore caps the
**whole site** at 5 booking requests an hour — the sixth guest of a busy hour is refused.

## 2. Goal

The CGV are written and versioned in GuestFlow and published to the site from there. Every booking
made on the website carries a tamper-resistant record of the version accepted — server time, IP,
browser — shown on the fiche; a request without it is refused; the confirmation email links to the
exact version accepted.

## 3. Functional rules

### 3.1 Writing and publishing the CGV (GuestFlow)

1. A new page **Paramètres → Conditions générales** holds the CGV as **Markdown, one text in French and
   one in English**, with a live preview of each.
2. The text may use **variables** resolved by GuestFlow from its own data: `{{raisonSociale}}`,
   `{{adresse}}`, `{{siret}}`, `{{email}}`, `{{telephone}}` (Paramètres → Établissement) and
   `{{cautions}}` (a Markdown list « <logement> : <montant> » of every property's default security
   deposit — properties carry no active/archived flag). An unknown variable blocks publication; the page
   names it in an alert above the draft.
3. There is always at most **one draft** (saved with the page's Save) and zero or more **published
   versions**, numbered 1, 2, 3… **A published version can never be edited or deleted.** « Publier »
   freezes the **saved** draft into version N+1 (the button stays disabled while the editor holds
   unsaved changes, and when nothing changed since the current version); the draft stays as it is.
4. Publishing **freezes** the version: variables are resolved, Markdown is rendered to sanitised HTML
   (FR and EN), and GuestFlow stores that HTML with its SHA-256 and the publication instant. A later
   change to a fact (a deposit amount, the address) does **not** alter a published version; the page
   instead shows « Un élément cité a changé depuis la version N — publiez une nouvelle version pour
   l'intégrer » with the list of the changed variables.
5. The **current version** is the most recent published one. Publishing a version makes it current
   immediately (no scheduled date in this spec).
6. The page lists the published versions (number, publication date, number of acceptances, « Voir »),
   newest first.

### 3.2 Showing the CGV on the site (plugin 1.8.0)

7. `GET /public/v1/terms` returns the current version (`version`, `publishedAt`, `html.fr`, `html.en`);
   `GET /public/v1/terms/:version` returns a given published version; unknown → `404 TERMS_NOT_FOUND`;
   nothing published → `503 TERMS_NOT_CONFIGURED`. Both carry `currentVersion`. No draft is ever exposed.
8. A new plugin shortcode **`[guestflow_cgv]`** renders the current version with the FR/EN switch the
    > **Sans test** — PHP shortcode `[guestflow_cgv]`: the plugin and the site mu-plugins have no test harness (PHP / build-free JS). Verified by hand on a throwaway WordPress with plugin 1.8.0 on 2026-09-22 (§7).
   site already uses (`.gf-cgv-lang` / `.gf-cgv-switch`), or version N when the URL carries `?v=N`
   (then headed « Version N du JJ/MM/AAAA — la version en vigueur est la N' », with a link). The
   WordPress `/cgv/` page's content becomes that single shortcode.
9. The plugin caches the current version for **60 s** (the shortcode and the proxy route the booking
    > **Sans test** — plugin transient cache: the plugin and the site mu-plugins have no test harness (PHP / build-free JS). Verified by hand on a throwaway WordPress with plugin 1.8.0 on 2026-09-22 (§7).
   block reads) and a numbered version for the usual read TTL (it never changes). A publication reaches
   the site within a minute; the booking flow never relies on that cache (rule 13).

### 3.3 Accepting (plugin 1.8.0)

10. The booking block renders the checkbox itself, on the recap, just above the submit button:
    « J'ai lu et j'accepte les [conditions générales de location]. » The version number is **not shown**
    to the guest (2026-09-25): it is an internal reference that says nothing to the person reading it,
    and the acceptance is still recorded against it (rule 12). The booking block is
    French-only (its strings are `__()` translations, no FR/EN switch): the English text lives on the CGV
    page. The link opens `<page des CGV>?v=N` in a new tab — the page is the plugin setting « Page des
    conditions générales » (a URL, `/cgv/` when empty). The block reads N from `GET /terms` when it loads;
    when nothing is published it shows no checkbox and GuestFlow answers the request with rule 16.
    > **Sans test** — booking-block checkbox (view.js): the plugin and the site mu-plugins have no test harness (PHP / build-free JS). Verified by hand on a throwaway WordPress with plugin 1.8.0 on 2026-09-22 (§7).
11. The checkbox is **never pre-ticked**. Clicking the submit button while it is unticked refuses on
    click with an inline message (« Acceptez d'abord les conditions générales de location. ») and
    scrolls to it — the same pattern as the mandatory insurance answer.
    > **Sans test** — refusal on click in view.js: the plugin and the site mu-plugins have no test harness (PHP / build-free JS). Verified by hand on a throwaway WordPress with plugin 1.8.0 on 2026-09-22 (§7).
12. The body sent by the browser carries `termsVersion: N` only. The proof around it (visitor IP,
    User-Agent, plugin version) travels in headers set by the PHP proxy (rule 23), never in the body; the
    proxy drops any `termsAcceptance` / `acceptedAt` key the browser might send, and GuestFlow ignores
    them anyway.
13. If N is no longer current when the request reaches GuestFlow → `409 TERMS_OUTDATED` with the current
    version in `details[0].currentVersion`; the block switches to that version (no refetch, so the
    60 s cache cannot loop), unticks the box, and says « Les conditions
    générales ont été mises à jour. Merci de les relire et de les accepter à nouveau. »
14. The site mu-plugin's own checkbox (`gf-seo-reservation.php` lines 403-411 and its hook in `majNav`)
    is **removed**.
    > **Sans test** — removal of code in the Solio mu-plugin (no test harness); checked by reading, to confirm in the Solio drawer at rollout step (4).

### 3.4 Enforcement

15. A public booking request **without** a valid acceptance is refused: `422 TERMS_NOT_ACCEPTED`,
    « Vous devez accepter les conditions générales de location. », nothing persisted (no client, no
    devis). This is the default from the first start of the new server; a site still on plugin
    ≤ 1.7.x stops taking bookings until it is updated — hence the **X release**, and the rollout order
    in §3.8.
16. **No published version yet** → public booking requests are refused with
    `503 TERMS_NOT_CONFIGURED` (« Les réservations en ligne sont momentanément indisponibles. »), and
    Paramètres → Conditions générales shows a blocking alert « Aucune version publiée : la réservation en
    ligne est fermée. Publiez vos conditions générales pour la rouvrir. » (no dashboard alert in this
    spec). Taking bookings without any terms is exactly what this spec removes.
17. A setting « Exiger l'acceptation des CGV sur le site » (`requireTermsAcceptance`, **default on**)
    exists only as an emergency switch: off → rules 15-16 are lifted (requests are created, with an
    acceptance when one is sent). Turning it off asks for confirmation and the card then says so. It is
    written through `PUT /api/terms/enforcement`, not the generic settings form.

### 3.5 What is recorded, and where it shows

18. An **acceptance** holds: the reservation/devis, the **acceptance instant** (GuestFlow server clock,
    UTC, millisecond precision — never a client time), the **version** accepted, the visitor's **IP**
    and **User-Agent** relayed by the proxy, and the plugin version (`X-GuestFlow-Plugin` header).
19. It is **append-only**: no endpoint edits or deletes it; editing the devis, converting it into a
    reservation (same row), re-pricing or cancelling keep it. It is deleted only with its row.
20. The creation writes a `terms_accepted` entry in `reservation_history` (« Historique des
    modifications »).
21. The fiche of a public request (`GET /api/reservations/:id` and `GET /api/devis/:id` both carry the
    block as `cgv`) shows in the client block « CGV v3 acceptées le 21/09/2026 à
    14:32:07 » (Europe/Paris) with « Détails » opening a dialog: instant (Paris + UTC), IP, browser, plugin
    version, version number, publication date and short hash, and « Voir le texte accepté » (the frozen HTML, in a
    sandboxed iframe, FR/EN tabs). A public request without acceptance (made before this feature, or
    while the emergency switch was off) shows « CGV : aucune acceptation enregistrée » in the warning
    colour. A back-office devis shows nothing.
22. The server ships this block ready to print (`termsAcceptance` + `termsAcceptanceState:
    'recorded' | 'missing' | 'not_applicable'`); the client formats nothing.

### 3.6 Visitor IP and the booking rate limit

23. The proxy determines the visitor IP: `REMOTE_ADDR`, unless it belongs to the plugin's new
    « Proxys de confiance » list (empty by default; set to the edge Caddy on Solio), in which case the
    right-most `X-Forwarded-For` entry not in that list. It sends it on **every** proxied call as
    `X-GuestFlow-Visitor-IP`, and the User-Agent as `X-GuestFlow-Visitor-UA` (≤ 512 chars).
    > **Sans test** — visitor IP resolution in `class-gf-api-client.php`: the plugin and the site mu-plugins have no test harness (PHP / build-free JS). Verified by hand on a throwaway WordPress with plugin 1.8.0 on 2026-09-22 (§7).
24. GuestFlow trusts those headers **only on an API-key-authenticated request**. `bookingRequestLimiter`
    and `paymentStatusLimiter` key on the visitor IP when present, on `req.ip` otherwise. To make that
    safe, `requirePublicApiKey` moves **before** `publicApiLimiter`, and `publicApiLimiter` keys the same
    way (an unauthenticated caller is refused 401 before being counted). The relayed address must be a
    valid IP (`net.isIP`), else it is ignored.
25. The acceptance's `ip` / `userAgent` (rule 18) are read from those same headers — one source.

### 3.7 Confirmation email

26. The `reservation_confirmation` template (FR and EN) gains a variable **`{{cgvUrl}}`** =
    `<PUBLIC_SITE_ORIGIN>/cgv/?v=<accepted version>` — the online CGV pinned to the version accepted.
    For a reservation without acceptance the variable resolves to the current version's URL.
27. The default template gets one paragraph, in the tone of guest emails, just before « Une question… »:
    FR « Vous retrouverez à tout moment les conditions générales de votre séjour ici : {{cgvUrl}} » /
    EN « You can find the terms and conditions of your stay here at any time: {{cgvUrl}} », wrapped in
    `{{#if hasCgvUrl}}…{{/if}}` so it disappears while no version is published or no site origin is
    known. (Wording changed at implementation from « que vous avez acceptées »: a stay booked by phone
    gets the current version and never ticked anything.) A migration inserts the same paragraph into the
    stored FR and EN confirmation templates when they do not already contain `{{cgvUrl}}` (end of body
    when the operator removed « Une question… »). The template editor gains « Lien CGV » and « Si CGV
    publiées ». Sending mode is unchanged (each template's `sendMode`). The origin is
    `app_settings.publicSiteOrigin`, else `PUBLIC_SITE_ORIGIN`.

### 3.8 Rollout order (production)

28. (1) Install the release; online booking answers 503 until (2). (2) In Paramètres → Conditions
    générales, publish version 1 (Claude prepares the draft from the current `/cgv/` text, with
    variables in place of the hard-coded facts; Adrien reviews and publishes). (3) Update the plugin to
    1.8.0 from WordPress, set « Proxys de confiance », replace the `/cgv/` page content with
    `[guestflow_cgv]`, deploy the mu-plugin without its checkbox. (4) Test booking end to end.
    Window of unavailability: between (1) and (3), to be done in one sitting, off-peak.
    > **Sans test** — production procedure, not behaviour of the code.

**Edge cases:**
- Honeypot filled → fake success, nothing stored.
- Request fails later (dates taken, capacity, min nights) → no acceptance (one transaction, after all
  validations).
- Online payment: acceptance at request creation, before the Qonto redirection; `/pay` and `/status`
  unchanged.
- Version published while a guest fills the form → rule 13.
- `?v=` unknown on the site → the shortcode shows the current version with « Version introuvable ».
- Draft with an unknown variable → « Publier » disabled, error listing the names.
- Existing public devis → `missing`, no backfill.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `routes/public/terms.js` | C | `GET /public/v1/terms`, `GET /public/v1/terms/:version`. |
| `routes/` | `routes/public/index.js` | T | Order: API key → `visitorContext` → `publicApiLimiter` (rule 24); mounts `terms`. |
| `routes/` | `routes/terms.js` | C | Admin: overview, draft save, preview, publish, enforcement switch, version content. |
| `index.js` | `index.js` | T | Mounts `/api/terms` (admin-only through the deny-by-default role guard). |
| `controllers/` | `controllers/termsController.js` | C | Overview (can publish? unknown variables, stale facts, outdated plugin), publication of the saved draft, fiche block (rules 21-22), Paris-time labels. |
| `controllers/` | `controllers/public/publicTermsController.js` | C | Public reads (rule 7). |
| `controllers/` | `controllers/public/publicBookingRequestController.js` | T | `checkTermsAcceptance` (rules 13, 15-17); client + devis + origin marker + acceptance written in one `db.transaction`; last plugin version stored. |
| `controllers/` | `controllers/reservationsController.js`, `controllers/devisController.js` | T | Add the `cgv` fiche block to `GET /api/reservations/:id` and `GET /api/devis/:id`. |
| `models/` | `models/termsModel.js` | C | Draft, versions (insert-only, number allocated in a transaction), acceptances (insert-only, with their `terms_accepted` history entry). Statements prepared lazily so controllers stay loadable on test schemas. |
| `models/` | `models/settingsModel.js` | T | `requireTermsAcceptance` (default 1), `lastSeenPluginVersion`, accessor `termsSettings()`. |
| `middleware/` | `middleware/visitorContext.js` | C | Reads `X-GuestFlow-Visitor-IP` (validated), `-UA` (≤ 512), `X-GuestFlow-Plugin` into `req.visitor`, after the key check. |
| `middleware/` | `middleware/rateLimiters.js` | T | `publicVisitorKey` (visitor IP, else `req.ip`, through `ipKeyGenerator`) for the three public limiters. |
| `utils/` | `utils/termsRenderer.js` | C | Pure: variables, escape-first Markdown subset → HTML, SHA-256. **No dependency**: every character is HTML-escaped before any tag is produced, so no operator HTML can reach the site; supported: `##`/`###`, paragraphs, `-` lists, `**bold**`, `*italic*`, `[text](https://…)`. |
| `utils/` | `utils/reservationEmailGraph.js` | T | `loadTermsVersion` — accepted version, else current, else null. |
| `utils/` | `utils/emailContextBuilder.js` | T | `{{cgvUrl}}` + flag `hasCgvUrl`. |
| `utils/` | `utils/reservationEmailSender.js`, `utils/emailAutoSendRunner.js`, `controllers/emailsController.js` | T | Pass `termsVersion` to the context builder (the sequence runner gets it from the graph). |
| `utils/` | `utils/guestEmailSequenceTemplates.js` | T | The confirmation paragraph (rule 27), exported for the migration. |
| `utils/` | `utils/migrateConfirmationCgvLink.js` | C | One-shot insertion of that paragraph into the stored template. |
| `database.js` / `schema.sql` | both | T | Tables, settings columns, migration (§5). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/settings/TermsSettingsPage.jsx` | C | Draft editor FR/EN + preview, publish, versions, emergency switch; renders the server overview. |
| `App.jsx`, `constants/` | `App.jsx`, `constants/settingsMenu.js`, `constants/roles.js` | T | Route `/parametres/conditions-generales` (admin), menu entry after Plateformes (Q6). |
| `pages/` | `pages/ReservationPage.jsx` | T | `TermsAcceptanceLine` in the client block, from `res.cgv` / `devis.cgv`. |
| `pages/` | `pages/EmailTemplatesPage.jsx` | T | Buttons « Lien CGV » and « Si CGV publiées ». |
| `components/` | `components/reservation/TermsAcceptanceLine.jsx` | C | Line + « Détails » dialog + archived text. |
| `components/` | `components/reservation/ReservationHistoryPanel.jsx` | T | Title « CGV acceptées en ligne » for `terms_accepted`. |
| `components/` | `components/SandboxedHtmlFrame.jsx` | C | Generic: server HTML in an `<iframe sandbox="">` — the one way GuestFlow shows HTML it did not build as React. |
| `components/` | `components/ArchivedHtmlDialog.jsx` | C | Generic: dialog around `SandboxedHtmlFrame`, optional tabs (FR/EN). |
| `components/` | `components/MarkdownEditorField.jsx` | C | Generic: textarea + server-rendered preview; side by side from `md`, « Aperçu » toggle below. |
| `api.js` | `api.js` | T | Terms endpoints. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed** | `PageActionBar`, `ConfirmDialog`, `SummaryItem`, `EmptyState`, `ErrorAlert`, `LoadingState` | |
| **Created (generic)** | `SandboxedHtmlFrame`, `ArchivedHtmlDialog`, `MarkdownEditorField` | Archived emails (`email_log`) and email-template editing are the next users. |
| **Specific** | `TermsAcceptanceLine` | Tied to this record's shape. |

### 4.3 WordPress

| File | T/C | Responsibility |
|---|---|---|
| `guestflow-booking/includes/class-gf-api-client.php` | T | `X-GuestFlow-Plugin`, `X-GuestFlow-Visitor-IP` (REMOTE_ADDR, or the right-most untrusted `X-Forwarded-For` hop behind a trusted proxy), `X-GuestFlow-Visitor-UA` on every call. |
| `guestflow-booking/includes/class-gf-rest-proxy.php` | T | `GET /terms` (60 s) and `/terms/{n}` routes; booking body: drops `termsAcceptance` / `acceptedAt`. |
| `guestflow-booking/includes/class-gf-settings.php` | T | « Page des conditions générales » (URL) and « Proxys de confiance ». |
| `guestflow-booking/includes/class-gf-shortcodes.php` | C | `[guestflow_cgv]` (rule 8), output through `wp_kses_post`. |
| `guestflow-booking/includes/class-gf-blocks.php`, `assets/style.css` | T | `cgvPageUrl` + i18n strings; checkbox style. |
| `guestflow-booking/blocks/booking/view.js` | T | Checkbox, refusal on click, `termsVersion`, `TERMS_OUTDATED` handling. |
| `guestflow-booking/guestflow-booking.php`, `readme.txt` | T | 1.8.0 + changelog. |
| `solio-site/mu-plugins/gf-seo-reservation.php` | T | Removes its own checkbox and its gating of « Réserver »; dresses the plugin's checkbox in the site colours. |

### 4.4 API contract

Public (API key):

| Method | Endpoint | Response / errors |
|---|---|---|
| GET | `/public/v1/terms` | `{ data: { version, publishedAt, html: { fr, en }, currentVersion } }` · `503 TERMS_NOT_CONFIGURED` |
| GET | `/public/v1/terms/:version` | same shape · `404 TERMS_NOT_FOUND` |
| POST | `/public/v1/booking-requests` | body + `termsVersion` · new errors `422 TERMS_NOT_ACCEPTED`, `409 TERMS_OUTDATED` (`details[0].currentVersion`), `503 TERMS_NOT_CONFIGURED` |

Headers set by the proxy on every public call: `X-GuestFlow-Plugin`, `X-GuestFlow-Visitor-IP`,
`X-GuestFlow-Visitor-UA` — honoured only after the API-key check.

Admin (session, admin role):

| Method | Endpoint | Body / response |
|---|---|---|
| GET | `/api/terms` | Overview: `draft`, `current`, `nextVersion`, `canPublish`, `publishBlockedReason`, `unknownVariables`, `staleVariables`, `variables`, `versions[{ version, publishedAtLabel, shortHash, acceptanceCount }]`, `requireTermsAcceptance`, `lastSeenPluginVersion`, `pluginOutdated`, `minPluginVersion` |
| PUT | `/api/terms/draft` | `{ fr, en }` → overview |
| POST | `/api/terms/preview` | `{ fr, en }` → `{ html: { fr, en }, unknownVariables }` |
| POST | `/api/terms/publish` | → overview · `422` if empty text, unknown variables or nothing new |
| PUT | `/api/terms/enforcement` | `{ requireTermsAcceptance: boolean }` → overview |
| GET | `/api/terms/versions/:version` | `{ version, publishedAtLabel, contentHash, html: { fr, en } }` |
| GET | `/api/reservations/:id`, `/api/devis/:id` (existing) | + `cgv: { termsAcceptanceState, termsAcceptance }` |

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS terms_draft (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  markdownFr TEXT NOT NULL DEFAULT '',
  markdownEn TEXT NOT NULL DEFAULT '',
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS terms_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  markdownFr TEXT NOT NULL, markdownEn TEXT NOT NULL,
  htmlFr TEXT NOT NULL, htmlEn TEXT NOT NULL,
  variablesJson TEXT NOT NULL,          -- resolved values at publication, for rule 4
  contentHash TEXT NOT NULL,            -- sha256 of htmlFr + htmlEn, computed by GuestFlow
  publishedAt TEXT NOT NULL,
  publishedBy INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL,       -- FK reservations(id) ON DELETE CASCADE
  termsVersionId INTEGER NOT NULL,      -- FK terms_versions(id)
  acceptedAt TEXT NOT NULL,             -- ISO UTC with ms, server clock
  ip TEXT, userAgent TEXT, pluginVersion TEXT
);
CREATE INDEX IF NOT EXISTS idx_terms_acceptances_reservation ON terms_acceptances (reservationId);
```

`app_settings.requireTermsAcceptance INTEGER NOT NULL DEFAULT 1`, `app_settings.lastSeenPluginVersion TEXT`.
One-shot migration `terms_cgv_url_confirmation_v1` (rule 27).

**Data impact:** additive, except the confirmation-template paragraph inserted into the stored template
(rule 27). Existing public devis read as `missing`. IP and User-Agent are personal data, kept with the
reservation and never exposed on the public API. A version cannot be deleted (no delete endpoint at all).

## 6. UI / UX

The decision page [terms-acceptance-record/resume.html](terms-acceptance-record/resume.html) was the
interactive mock-up validated on 2026-09-22.

- **Paramètres → Conditions générales:** `PageActionBar` title « Conditions générales » with a chip
  « vN en vigueur » / « Aucune version publiée »; Save (tooltip « Enregistrer le brouillon ») and Cancel
  for the draft; `actionsBefore`: « Publier la version N » (icon Publish, `success`, disabled while
  unsaved or while the server says it cannot publish, tooltip = the reason; opens a `ConfirmDialog`
  « La version N sera figée et proposée aux clients dès maintenant. Elle ne pourra plus être
  modifiée. »). Body: closed-booking alert (no version), unknown-variables alert, stale-facts alert,
  outdated-plugin alert; « Brouillon » card with FR/EN tabs, editor + preview side by side from `md`,
  one at a time with an « Aperçu » toggle below; variables chips and syntax help; « Versions publiées »
  (table from `sm`, stacked rows with « Voir » on `xs`); « Réservation en ligne » card with the
  emergency switch (confirmation before turning it off) and the plugin version last seen.
- **Site:** checkbox between the contact fields and the submit button (in the Solio drawer: the
  « Récapitulatif » screen); refusal and `TERMS_OUTDATED` message inline under it. Mobile: label wraps,
  20 px box, the whole line is the hit area.
- **Fiche:** one line under « Changer le client »; « Détails » dialog `fullScreen` on `xs`; « Voir le
  texte accepté » opens the frozen text (FR/EN tabs).

## 7. Test plan

### Server unit tests (+45)
- [x] `tests/terms-renderer.unit.test.js` (9) — raw HTML escaped, `javascript:` links inert, attribute
      break-out impossible, subset, variables, `{{cautions}}` list, hash.
- [x] `tests/terms-publishing.unit.test.js` (11) — empty / unknown variable / nothing new refused,
      frozen version 1, next number, v1 untouched, stale facts (only quoted ones), versions + counts, fiche
      states + history entry, cascade on reservation delete, plugin version comparison.
- [x] `tests/terms-acceptance.unit.test.js` (9) — 422 / 409 / 503 with nothing written, 201 with server
      clock + relayed visitor + plugin version, client-supplied fields ignored, emergency switch (with and
      without acceptance), rollback when the devis fails, honeypot.
- [x] `tests/terms-public-reads.unit.test.js` (4) — current version (no Markdown source), a given
      version, 503 with nothing published, 404 for an unknown / malformed version.
- [x] `tests/public-visitor-ip-limiter.unit.test.js` (4) — two visitors through one proxy address,
      visitor relayed to the controller (IPv6 too), malformed IP dropped, 401 not counted.
- [x] `tests/email-cgv-url.unit.test.js` (8) — `{{cgvUrl}}` / `hasCgvUrl`, paragraph gone without a
      version, rendered before « Une question », accepted version wins, missing tables, migration
      (placement, EN, idempotent, fallback at end, no template).
- [x] `tests/public-booking-request-controller.unit.test.js` — fixtures accept version 1.

### Client (Vitest, +13)
- [x] `pages/settings/__tests__/TermsSettingsPage.test.jsx` (9)
- [x] `components/reservation/__tests__/TermsAcceptanceLine.test.jsx` (4)
- [x] E2E menu lists (`settings-redirects.spec.js`, `sidebar-navigation.spec.js`) include the new page.

### Manual verification (2026-09-22)
- [x] GuestFlow dev: draft with variables + `<script>` + unknown variable (publication blocked, alert,
      script stays text), save, publish v1; fiche « CGV v1 acceptées le … », Détails, archived text;
      390 / 900 / 1280 px, no horizontal scroll.
- [x] Public API by curl: no `termsVersion` → 422, version 0 → 409 with `currentVersion`, version 1 → 201.
- [x] Throwaway WordPress (Docker, plugin 1.8.0 + the Solio mu-plugins): `[guestflow_cgv]` renders v1
      with the FR/EN switch, unknown `?v=` falls back; booking block: unticked → refusal, ticked → « Demande
      envoyée »; v2 published while the form was open → unticked, « (version 2) », message, then sent;
      `?v=1` shows « Version 1 du … — la version en vigueur est la 2 » once the 60 s cache expired;
      acceptances stored with the visitor IP / UA relayed by the real plugin.
- [ ] The Solio **drawer** (`gf-seo-reservation.php`) could not be opened on the throwaway site's
      default theme; its change (removal of its own checkbox) is verified by reading only — to check at
      rollout step (4).
- [ ] E2E suite: run by CI on the PR (ports 3000/4000 busy locally).

## 8. Out of scope

- Acceptance for back-office devis (phone/email bookings).
- A PDF of the CGV attached to emails (Adrien chose the pinned online link, 2026-09-21).
- Scheduled publication (a version effective from a future date).
- Bookings on Airbnb/Booking/Gîtes de France (the platform's own terms apply).

## 9. Open questions

- **Q1 — Who holds the CGV text?** — **Resolved 2026-09-21:** GuestFlow is the editor (Markdown FR + EN
  with variables); the site renders it through the plugin.
- **Q2 — Store IP and User-Agent?** — **Resolved 2026-09-21:** yes.
- **Q3 — CGV with the confirmation email?** — **Resolved 2026-09-21:** in this spec, as a link to the
  online CGV pinned to the accepted version (`/cgv/?v=N`).
- **Q4 — Default of the enforcement.** — **Resolved 2026-09-21:** on from the start (X release, rollout
  §3.8).
- **Q5 — Rate-limit defect.** — **Resolved 2026-09-21:** fixed in this spec (§3.6).
- **Q6 — Where the menu entry sits.** — **Resolved 2026-09-22:** first family, after Plateformes.
- **Q7 — Does a link alone meet the durable-medium requirement?** A link depends on the site being up;
  case law tends to want the text itself in the guest's hands. Adrien's call stands; flagged so it can be
  revisited (a PDF attachment would be a small follow-up on top of the frozen HTML).

## 10. Implementation notes (2026-09-22)

Deviations from the approved text, all reflected in the rules above: booking block French-only
(rule 10); the proof travels in headers, not in the body (rule 12); no Markdown dependency (§4.1);
`{{cautions}}` lists every property (rule 2); confirmation wording « de votre séjour » and paragraph
conditional on `hasCgvUrl` (rule 27); no dashboard alert (rule 16); `GET /api/devis/:id` also carries
the block (rule 21); the page names unknown variables and warns about an outdated plugin, both verdicts
computed by the server.
