# English version of the public website

| Field | Value |
|---|---|
| **Status** | Approved _(2026-09-24)_ |
| **Branch** | `feature/site-english-version` |
| **Created** | 2026-09-23 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The Lodgify site that `domainesolio.com` replaced was bilingual. The WordPress rebuild only ever
produced French: measured on 2026-09-23, the database holds 11 published pages and 4 drafts, **all
in `fr`**, **zero** English content in any status, and **zero** translation group in Polylang's
`post_translations` taxonomy. The eight old `/en/…` Lodgify URLs are caught in one hop by
`gf-seo-redirects.php` and sent to their French equivalent, so no link is broken — but the English
audience simply has nowhere to land.

Polylang is nevertheless configured and declares the language `en` (`en_GB`). The consequence is a
live defect: `gf-seo-head.php:347-365` emits `<link rel="alternate" hreflang="en">` pointing at
`https://domainesolio.com/en/`, which answers **200 with an empty "Blog" archive**. The site
currently advertises to search engines an English version that does not exist.

**GuestFlow itself is already bilingual — on every axis except the one the website uses.** Three
complete, tested chains exist:

| Chain | Mechanism | Driven by |
|---|---|---|
| Devis PDF | `utils/devisPdfLabels.js` (FR/EN dictionaries, loud failure on a missing key), localised dates | `reservations.pdfLanguage` (`specs/devis-english-language.md`) |
| Guest emails | `email_templates.subjectEn`/`bodyEn` + a fully localised server context (`emailContextBuilder.js`, `stayContentContext.js`, `dateFr.js`) | `clients.emailLanguage` (`specs/email-language-fr-en.md`, `specs/email-client-language-and-fiche-polish.md`) |
| Terms (CGV) | `terms_versions.markdownEn`/`htmlEn`, `GET /public/v1/terms` returns both languages at once, flag switcher in the shortcode | always both |

What is missing is the façade. The public API has **no notion of language at all** — no `lang`
parameter, no `Accept-Language`, no middleware, no validator (verified by exhaustive grep over
`server/src`). Three consequences:

1. **`options.titleEn` is exposed and read by nobody.** `publicProjections.js:90` emits it on
   `GET /public/v1/properties/:id/options`; there are **zero** occurrences of `titleEn` anywhere in
   `integrations/wordpress/`. The field travels from the database to the browser and dies there.
2. **`resources.nameEn` is not even exposed.** The column exists and is seeded, but
   `toPublicResource()` (`publicProjections.js:179-195`) never copies it. `toPublicQuote()` has the
   same gap for both options and resources, so a computed quote is 100% French whatever is stored.
3. **A booking request carries no language.** `publicBookingRequestController.js` never mentions
   `lang`, so the client it creates inherits `emailLanguage = 'fr'` (`clientsModel.js:61`). Even
   with a perfect English site, an English guest would receive a French confirmation and a French
   devis PDF — from an engine that knows how to produce both.

The WordPress plugin is in the same state: the machinery is built and empty. `assets/runtime.js:12-18`
defines a working `GF.t()` helper, `class-gf-blocks.php` makes **80 `__()` calls**, the plugin header
declares `Text Domain: guestflow-booking` and `Domain Path: /languages`, and
`guestflow-booking.php:41` calls `load_plugin_textdomain()` — but **no `.po`, `.mo` or `.pot` file
exists anywhere in the repository**. Every `__()` returns its French source unchanged. Number and
date formatting are hard-pinned to French (`runtime.js:22`, `blocks/calendar/view.js:43`).

Finally, part of the site's visible text does not live in the repository at all: **12 of the 26
deployed mu-plugins are only on the server** (`gf-booking.php` — the 27 KB reservation drawer —
`gf-search.php`, `gf-contact.php`, `gf-gallery.php`, `gf-lodging-cards.php`, `gf-amenities.php`,
`gf-sticky-header.php`, `gf-anim.php`, `gf-brand.php`, `gf-caps.php`, `gf-relative-uploads.php`,
`zz-adn-security.php`). They cannot be changed under review while they are outside Git.

**This spec reverses an explicit earlier decision.** `specs/wordpress-plugin.md:289` lists
"Multilingual content beyond French i18n scaffolding (WPML/Polylang integration not in scope)" as a
non-goal. That line is superseded here and must be amended when this ships.

## 2. Goal

An English-speaking visitor can read the whole site, book a stay, and receive their confirmation,
their reminders and their quote PDF in English — without a single French string appearing between
the first page and the last email.

## 3. Functional rules

### Language on the public API

1. Every `/public/v1/**` endpoint accepts an optional **`lang`** parameter — `fr` (default) or `en`
   — as a query parameter, and additionally in the JSON body for `POST /quote` and
   `POST /booking-requests`. An absent, empty, unknown or malformed value resolves to `fr`; it is
   **never** a validation error. Rationale: a visitor must never lose a booking funnel over a
   language token. Normalisation reuses the existing `normaliseLang()`
   (`utils/emailTemplateLanguage.js`).
2. Language never changes *which* rows are returned, only how they read. Prices, availability,
   degressivity, minimum stays and every monetary amount are identical in both languages.
3. All display labels computed by the server follow `lang`: `priceUnitLabel`, `quantityLabel`,
   `priceLabel` (cancellation insurance), `touristTax.label`, and the meal-portion `hint`. They live
   in **one** new dictionary module, `utils/publicLabels.js`, built like `devisPdfLabels.js`: two
   frozen maps of identical shape, accessed via `labels(lang).<key>`, **failing loudly** on an
   unknown key or language. This preserves the existing architectural choice documented at
   `publicProjections.js:55-60` — the label is computed server-side and rendered as-is by the site.
4. `toPublicOption()` returns `title` **already resolved**: for `en`, `titleEn` when non-empty,
   otherwise the French `title`. The raw `titleEn` field keeps being emitted unchanged so nothing
   that reads it today breaks.
5. `toPublicResource()` resolves `name` the same way from `nameEn`, and starts exposing `nameEn`
   alongside it — closing the asymmetry with options.
6. `toPublicQuote()` resolves option titles and resource names identically. A quote requested in
   English must not contain a French line item.
7. Option `description` stays French-only. `specs/devis-english-language.md` §3 rule 6 deliberately
   refused a `descriptionEn`; this spec does not overturn that. Consequence, accepted: the
   description is **omitted** from the payload when `lang=en` rather than shown in French — a
   missing line reads better than a French one.
8. Error envelopes keep their machine-readable `code` unchanged; only `message` follows `lang`,
   through a dictionary keyed by code in `utils/publicLabels.js`. This covers the ~20 hard-coded
   French messages in `controllers/public/*` and the messages propagated from the pricing engine.
9. Property names are proper nouns and are **not** translated. But `nameArticle` ("à la", "à l'") is
   French grammar: for `lang=en` the projection returns it as an empty string, and the consumer
   composes "at La Granja" instead of "à la Granja".
10. Amounts keep the format already sent to English guests by the devis PDF and the emails
    (`1 234,56 €`), per `specs/email-language-fr-en.md` §3 rule 4 — the property is in the euro zone
    and one formatting convention across PDF, email and site is worth more than local elegance.
    Dates follow the language: `dd/mm/yyyy` in French, `5 June 2026` in English, as
    `specs/devis-english-language.md` §3 rule 3 already decided.

### Carrying the language to the guest record

11. `POST /public/v1/booking-requests` reads `lang` and stores it: the created (or matched) client
    gets `emailLanguage`, and the reservation gets `pdfLanguage`. An English request therefore
    produces English confirmation, English reminders and an English quote PDF **with no further
    work** — the three existing chains take over.
12. An **existing** client's `emailLanguage` is never overwritten by a new booking request. The
    language recorded on the person is the operator's and the guest's, not a by-product of which
    page they happened to browse. A mismatch is not an error and is not surfaced.

### WordPress plugin (`guestflow-booking`)

13. The plugin resolves the current language once per request — `pll_current_language('slug')` when
    Polylang is present, otherwise `get_locale()` reduced to its two-letter prefix, otherwise `fr` —
    and sends it as `lang` on every upstream call (`class-gf-api-client.php`) and through the REST
    proxy (`class-gf-rest-proxy.php`).
14. The plugin ships real translation files (`/languages/guestflow-booking-en_GB.po` and `.mo`).
    Source strings stay French, which is what the 80 `__()` calls already assume; English arrives as
    a translation. The `.po` is the reviewable artefact and is versioned.
15. `runtime.js` and `blocks/calendar/view.js` stop hard-coding `fr-FR`: number and date formatting
    read the locale published by `wp_localize_script`.
16. The CGV shortcode already renders both languages with a flag switcher
    (`class-gf-shortcodes.php:71-82`). On an English page it must open on **English** by default;
    the visitor's manual choice still wins and is still remembered.

### Solio site (mu-plugins)

17. **Prerequisite, before any behaviour change:** the server-only mu-plugins are imported into
    `integrations/wordpress/solio-site/mu-plugins/` as-is, in their own commit, so the diff that
    follows is reviewable. Each file is compared against the repository's history first — per
    `wordpress-deploy-topology`, the server copy can be *behind* master, and an import must not
    silently revert a deployed fix. **Measured 2026-09-24:** the container holds 26 mu-plugins, the
    repository 16, and those 16 are **byte-identical** to the deployed copies — nothing to reconcile.
    The gap is **10 files**, not the 12 estimated on 2026-09-23: `gf-caps.php` has since been
    versioned, and `gf-amenities.php` does not exist on the server at all. The ten are `gf-anim.php`,
    `gf-booking.php`, `gf-brand.php`, `gf-contact.php`, `gf-gallery.php`, `gf-lodging-cards.php`,
    `gf-relative-uploads.php`, `gf-search.php`, `gf-sticky-header.php`, `zz-adn-security.php`.
    One deviation from "as-is", and only one: `zz-adn-security.php` named the WordPress
    administrator's login in a comment, and this repository is public — the comment is reworded to
    say the same thing without the identifier.
18. The header and footer stop being frozen French HTML in the block template parts. They are
    rendered per language: labels and URLs both (`/la-granja/` ↔ `/en/la-granja/`), and the header
    carries a **language switcher** (§6, decided 2026-09-24 on
    `docs/specs/2026-09-24-site-language-switcher.html`) linking to the current page's translation —
    or to the English home when that page has no translation yet. **The switcher only exists when
    there is something to switch to:** it is not rendered at all while fewer than two languages have
    published content, so nothing advertises an English site before it stands — the discipline
    rule 20 applies to `hreflang`, applied to the interface.
19. `gf-booking.php`'s ~40 interface strings, including the singular/plural of "nuit", go through a
    small FR/EN map resolved from the current language, same shape as rule 3.
20. `gf-seo-head.php` keeps `x-default` on French. The `hreflang="en"` alternate is emitted **only
    for a page that actually has a published English translation** — which also fixes today's defect
    where the whole site advertises an empty `/en/`.

### Content

21. The 10 published French pages get an English translation, linked through Polylang, with English
    slugs under `/en/`. The English home replaces the empty "Blog" archive currently served there.
22. English is British (`en_GB`, already the declared locale) and keeps the French voice: sober,
    concrete, understated. The site never becomes salesier in translation than it is in French.
23. Pages are translated **one at a time, published only once validated**, exactly like the original
    French rebuild — an English page stays a draft until Adrien has read it.
24. Nothing advertises the English site before it stands: rule 20 makes the `hreflang` follow real
    translations, so the sequencing is automatic rather than a thing to remember.

**Edge cases:**

- `lang=en` while `titleEn` is empty → the French title is shown. Never an empty label, never a key.
- `lang=de` (or `EN`, or `en-GB`, or garbage) → treated as `fr` (`EN`/`en-GB` normalise to `en`), no
  error.
- An English visitor lands on a French page with no translation → the switcher points at the English
  home rather than 404-ing.
- A booking request in English for an existing client known as French → the request is honoured, the
  stored language is left alone (rule 12).
- Polylang deactivated → `pll_current_language()` is absent, everything resolves to `fr`, the site
  behaves exactly as it does today.

---

## 4. Architecture

> **Fat backend, thin frontend.** Every label the visitor reads is resolved on the server and
> rendered as-is by the site. No translation table, no pluralisation rule and no date formatting
> logic is duplicated in the plugin's JavaScript beyond reading what the server sent.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `routes/public/properties.js` | T | Passes `lang` from the query through to the controller |
| `routes/` | `routes/public/quote.js` | T | Accepts `lang` in query or body |
| `routes/` | `routes/public/bookingRequests.js` | T | Accepts `lang`, forwards it for persistence |
| `routes/` | `routes/public/terms.js` | T | Accepts `lang` for its error messages only (payload already bilingual) |
| `controllers/` | `controllers/public/publicCatalogController.js` | T | Resolves `lang`, passes it to the projections and to `fail()` |
| `controllers/` | `controllers/public/publicQuoteController.js` | T | Same, incl. the messages propagated from the pricing engine |
| `controllers/` | `controllers/public/publicBookingRequestController.js` | T | Same + writes `emailLanguage` / `pdfLanguage` (rules 11-12) |
| `controllers/` | `controllers/public/publicPaymentController.js` | T | Translated error messages |
| `controllers/` | `controllers/public/publicTermsController.js` | T | Translated error messages |
| `controllers/` | `controllers/public/publicHttp.js` | T | `fail()` takes a language and looks the message up by code |
| `models/` | `models/clientsModel.js` | T | Accepts an initial `emailLanguage` on creation; never overwrites an existing one |
| `models/` | `models/reservationsModel.js` | T | Accepts `pdfLanguage` when the reservation is created from a request |
| `utils/` | `utils/publicLabels.js` | **C** | The single FR/EN dictionary for public labels **and** error messages; loud failure on a missing key |
| `utils/` | `utils/publicProjections.js` | T | Every projection takes `lang`: resolves `title`/`name`, calls `publicLabels`, empties `nameArticle` in English, drops the French `description` |
| `utils/` | `utils/mealPortions.js` | T | `priceUnitLabel`, `quantityLabel` and `hint` move into the dictionary |
| `utils/` | `utils/pricing.js` | T | `touristTaxLabel` is composed in the requested language |
| `utils/` | `utils/publicInputValidation.js` | T | Normalises `lang`, never rejects it |
| `middleware/` | — | — | (none — `lang` is an ordinary input, not a request-wide context) |
| `database.js` | — | — | **(none — no migration: every column this needs already exists)** |

**Notes:**
- `utils/publicLabels.js` is a pure module with no I/O, unit-testable on its own, and its FR/EN maps
  are asserted to have identical key sets — the same guard `devisPdfLabels` has.
- No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| everything | — | — | **(none)** |

The React back-office is out of scope: it stays French, and the operator already edits `titleEn`,
`nameEn`, `subjectEn`/`bodyEn` and the bilingual terms through existing screens
(`OptionsPage.jsx:723`, `EmailTemplatesPage.jsx:95-96`, `TermsSettingsPage.jsx`).

**Component reuse declaration:** no new client component; no client change at all.

### 4.3 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `includes/class-gf-language.php` | **C** | Resolves the current language (Polylang → locale → `fr`) and exposes it to PHP and JS |
| `includes/class-gf-api-client.php` | T | Adds `lang` to every upstream request |
| `includes/class-gf-rest-proxy.php` | T | Accepts and forwards `lang` on the proxied routes |
| `includes/class-gf-blocks.php` | T | Publishes the locale next to `GF.i18n` for `wp_localize_script` |
| `includes/class-gf-shortcodes.php` | T | CGV open on the page's language (rule 16) |
| `assets/runtime.js` | T | `Intl.NumberFormat` / date formatting driven by the published locale |
| `blocks/calendar/view.js` | T | Same for the calendar's month and day names |
| `languages/guestflow-booking-en_GB.po` | **C** | The English translation, reviewable in the diff |
| `languages/guestflow-booking-en_GB.mo` | **C** | Its compiled form, loaded by `load_plugin_textdomain()` |

### 4.4 Solio site (`integrations/wordpress/solio-site/mu-plugins/`)

| File | T/C | Responsibility |
|---|---|---|
| 10 server-only mu-plugins | **C** | Imported as-is first (rule 17), no behaviour change in that commit |
| `gf-i18n.php` | **C** | The site's FR/EN string map + the current-language helper the others call |
| `gf-header.php` (from the `header` template part) | **C** | Navigation rendered per language + renders the language switcher (hidden while a single language has content) |
| `gf-seo-icons.php` | T | Gains the `globe` icon, on the existing 24 × 24 stroke grid |
| `gf-footer.php` | T | Footer links and labels per language |
| `gf-booking.php` | T | Its ~40 interface strings go through `gf-i18n` |
| `gf-seo-head.php` | T | `hreflang` only for really-translated pages; `x-default` stays French |

### 4.5 API contract

`lang` is additive and optional everywhere. A consumer that never sends it — today's deployed plugin
included — receives byte-identical payloads to today. `specs/public-api.md` gains a "Language"
section documenting the parameter, the fallback chain and which fields it affects;
`specs/wordpress-plugin.md:289` is amended to record that multilingual support is now in scope.

## 5. Data model

**No migration.** Every column required already exists and is already seeded and backfilled on
boot: `options.titleEn`, `resources.nameEn`, `clients.emailLanguage`, `reservations.pdfLanguage`,
`reservations.emailLanguage`, `terms_versions.markdownEn`/`htmlEn`,
`email_templates.subjectEn`/`bodyEn`, `app_settings.quoteFooterTextEn`.

The work is to *use* what three previous specs already built.

## 6. UI / UX

**Language switcher — decided 2026-09-24 on an interactive mock-up**
(`docs/specs/2026-09-24-site-language-switcher.html`, three forms compared in the real header).

*Form.* A **globe, the current language code, a chevron**, opening a menu of two entries:
`Français` / `English`. It is not a new widget: it reuses the header's existing `.gf-dropdown` /
`.gf-dd-menu` — the very components that serve the "Réserver" menu — so it inherits their padding,
their `rgba(14,18,14,.97)` panel, their hover opening and their accordion fallback on small screens.
Two rejected forms are recorded here so they are not re-proposed: a bare `FR / EN` pair (fastest,
but permanently displays a language nine visitors in ten do not want) and a lone globe that toggles
(most discreet, but a toggle cannot say "this page exists in French only").

*Icon.* A globe drawn on **the site's own icon grid** — `gf-seo-icones()` in `gf-seo-icons.php`:
24 × 24, stroke only, width 1.7, round caps and joins, `currentColor`, no filled surface. It joins
that array as `globe` rather than arriving as a second icon family. The chevron reuses the same
grammar at width 2.

*Not flags.* A flag names a country, not a language: a Union Jack would say "United Kingdom" to the
Dutch, German and American visitors who all read the same page. The globe says the one thing worth
saying — "change language". Each entry is a real `<a hreflang lang>`, named in its own language
("English", never "Anglais"), with `aria-current` on the active one.

*Placement.* Desktop: between the last navigation link and the "Réserver" button, so the call to
action keeps the end of the bar where the eye looks for it. Mobile: **first block of the burger
menu** (CSS `order`, the DOM order is unchanged).

*Mobile fold.* In the burger the language block is **collapsed by default** — a single
`globe · FR · chevron` row, the chevron pushed to the right edge — and unfolds on tap into two
full-width 44 px targets, the active one on an ocre wash. This deliberately departs from the
"Réserver" dropdown, which stays unfolded on mobile: that menu *is* the destination of the menu,
while the language is a setting nine visitors in ten never touch, and unfolded it would push the
whole navigation two rows down. Consequence for the implementation: on `xs` the site's blanket
`.gf-dd-menu{display:block}` rule must not apply to the language dropdown, which keeps its
`open` state.

*Behaviour.* The menu points at the current page's translation when one is published, and at the
English home otherwise — never a 404, never a greyed entry without an explanation. No
`Accept-Language` redirect (it breaks shared links, crawlers and the back button) and no preference
cookie: the choice lives in the URL, which is shareable and indexable.

**Mobile.** Nothing in this change alters the existing responsive behaviour: the header stays
sticky, the burger still collapses the navigation below 1080 px, the booking drawer keeps its
full-screen mobile presentation. The English labels are longer than the French ones in several
places ("Send the request" vs "Envoyer la demande"), so each translated string is checked at 360 px
for wrapping and truncation — that is the one mobile-specific risk this work carries.

**The drawer in English.** Option titles come from `titleEn`; when one is missing the French title
appears, which is deliberate (rule 4) and must remain visually ordinary — no asterisk, no badge, no
apology. The price unit ("per night", "per stay", "per person per night") and the quantity label
("Number of covers") come from the server, so the drawer's layout is unchanged.

**What the English visitor must never see:** a French error message, a French price unit, a French
month name in the calendar, or a French confirmation email. Those four are the acceptance criteria
of the whole spec.

## 7. Test plan

**Server unit tests** (`server/src/tests/`, one file per subject per §9 of CLAUDE.md):

| File | Covers |
|---|---|
| `public-labels.unit.test.js` | FR/EN key-set parity, loud failure on an unknown key or language, every `priceType` and every error code has both languages |
| `public-projections-language.unit.test.js` | `title`/`name` resolution incl. the empty-`titleEn` fallback, `nameArticle` emptied in English, `description` dropped, quote lines resolved |
| `public-api-language-param.unit.test.js` | `lang` accepted in query and body, unknown/garbage values fall back to `fr` without a 400, payload identity when `lang` is absent |
| `booking-request-language.unit.test.js` | An English request sets `emailLanguage`/`pdfLanguage`; an existing client's language is left untouched (rule 12) |
| `tourist-tax-label-language.unit.test.js` | The composed tourist-tax label in both languages |

**Manual verification** (no automated coverage exists for the site itself):

1. `/en/` home renders the English page, not the Blog archive.
2. Switch FR ↔ EN on each translated page: same page, other language, URL follows.
3. Full English booking funnel on La Granja: dates, options, quote, request — no French string.
4. The same funnel at **360 px**: no wrapping break, no truncated button, switcher first in the
   burger with a 44 px target.
5. With English unpublished, the switcher is **absent** from the header — desktop and burger alike
   (rule 18).
6. The request produces a client with `emailLanguage = 'en'`; the confirmation email and the devis
   PDF are English.
7. A French visitor sees strictly today's site (the regression that matters most).
8. `hreflang` present only on pages with a real translation; `x-default` on French.

**Client Vitest / Playwright E2E:** unchanged and unaffected — no React code is touched. Both suites
must still pass.

## 8. Out of scope

- **Back-office i18n.** The React admin stays French.
- **`options.description` in English** — `specs/devis-english-language.md` §3 rule 6 stands.
- **Property names.** "La Granja" and "L'Estiva" are proper nouns.
- **Operator-typed data**: tariff season names, option descriptions, free-text notes.
- **Any third language.** The design must not make one harder, but none is built.
- **The 19 `activite` drafts and the 4 page drafts.** They are not published in French; translating
  unpublished content is premature.
- **Automated E2E coverage of the public website.** None exists today; this spec does not create it.

## 9. Open questions

**Resolved 2026-09-24 — the four questions below were approved as proposed.** Money stays
`1 234,56 €` (question 1), property slugs stay identical and only editorial ones are translated
(question 2), `hreflang` follows real translations page by page so indexation is automatic
(question 3), and the contact notification stays French because its reader is French (question 4).
They are kept in full underneath, since the reasoning is what makes them re-decidable later.

**Resolved 2026-09-24 — the shape of the language switcher.** Three forms were rendered in the real
header and compared interactively (`docs/specs/2026-09-24-site-language-switcher.html`). Chosen: the
globe + current language + menu, placed before the "Réserver" button on desktop and first in the
burger on mobile. Written up in §6.

1. **Money formatting in English.** Rule 10 keeps `1 234,56 €`, consistent with the devis PDF and
   the emails already sent to English guests. `€1,234.56` would read more naturally on an English
   page but would then disagree with the PDF attached to it. → **Proposed: keep `1 234,56 €`.**
2. **English slugs.** `/en/la-granja/` (identical, proper noun) versus `/en/the-gite/`. Proposed:
   keep the property slugs identical, translate only the editorial ones (`/en/the-estate/`,
   `/en/around-us/`, `/en/book/`).
3. **Should `/en/` be indexed before it is complete?** Rule 20 makes it automatic per page, but a
   partially translated site is a product decision as much as an SEO one.
4. **The contact form** (`gf-contact.php`) sends its notification to Adrien. Does an English enquiry
   arrive in English, or always in French for the reader? Proposed: French, since the reader is
   French.

## 10. Implementation progress

_(filled during implementation)_

- [x] Prerequisite: 10 mu-plugins imported into the repository (2026-09-24)
- [ ] `utils/publicLabels.js` + tests
- [ ] Projections and controllers take `lang`
- [ ] Booking request carries the language through to client and reservation
- [ ] Plugin: language resolution, `lang` upstream, `.po`/`.mo`, locale-aware formatting
- [ ] Site: `gf-i18n`, header/footer per language, `gf-booking` strings
- [ ] Site: the `globe` icon in `gf-seo-icons.php` + the switcher itself (§6)
- [ ] `gf-seo-head`: `hreflang` only for real translations
- [ ] 10 pages translated and validated one by one
- [ ] `specs/public-api.md` + `specs/wordpress-plugin.md:289` amended
