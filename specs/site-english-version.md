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

Polylang is nevertheless configured and declares the language `en` (`en_GB`).

> **Corrected 2026-09-24.** This paragraph first claimed a live defect: that `gf-seo-head.php`
> advertised an English version that does not exist. **Measured on the live site, it does not.**
> `curl https://domainesolio.com/la-granja/` emits `hreflang="fr-FR"` and `x-default` and nothing
> else, because the alternates loop only ever emits a language Polylang really holds a translation
> for. Rule 29 asks for exactly the behaviour already in place, so `gf-seo-head.php` needs **no
> change** — what remains true is that `/en/` answers `200` with an empty "Blog" archive, which is
> a soft 404 for anyone who reaches it by hand, and which the English home replaces (rule 30).

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

11. `POST /public/v1/booking-requests` reads `lang` and stores it **on both pipes, because they are
    disjoint**: the created (or matched) client gets `emailLanguage`, and the devis gets
    `pdfLanguage`. Measured 2026-09-24: a guest e-mail resolves its language from
    `clients.emailLanguage` (`controllers/emailsController.js:72`, same precedence on all four
    sending paths) while the quote PDF reads `reservations.pdfLanguage` and *only* that
    (`utils/devisPdf.js:98`) — the client's language is never consulted there. Setting one without
    the other ships English e-mails with a French PDF attached. Today the public path is hard-wired
    French end to end: `clientsModel` forces `'fr'` (`models/clientsModel.js:59-61`) and
    `devisModel.create` is called without any language
    (`controllers/public/publicBookingRequestController.js:123-146`).
12. **The request's language wins — when the request actually carries one** _(decided 2026-09-24,
    reversing this rule's first version, which protected the stored value instead)._ A booking
    request that explicitly declares `fr` or `en` updates the matched client's `emailLanguage`: the
    page the guest chose to read is the best evidence available of the language they want. But an
    **absent** `lang` writes nothing. That distinction is not a nicety: rule 1 resolves a missing
    value to `fr`, and the plugin deployed today sends no `lang` at all, so a blind overwrite would
    silently reset every English client to French on their next booking. The controller therefore
    separates "no language stated" from "language stated as fr".
13. The language the request arrived in is recorded on the devis and travels to the reservation, so
    the operator can see it even when it disagrees with the client's stored preference (§6).
    `requestOrigin` travels with it: measured 2026-09-24, `carryOverColumns`
    (`models/devisModel.js:822-836`) did **not** copy `requestOrigin` on `convertToReservation`, so
    a reservation born of a public request lost all trace of coming from the site — 54 reservations
    out of 54 read as internal in the development database, while 7 of the 9 devis came from the
    website. The origin badge is labelled **« Site internet »**, not « WordPress » _(Adrien,
    2026-09-24)_: the operator cares which channel brought the booking, not which software serves
    the pages. « Plugin WordPress » stays where it names the plugin's own version.

### Carrying the language beyond the site — **specified, not built**

_(Added 2026-09-24 at Adrien's request. Everything in this sub-section is a **contract on paper**.
No code in this spec's implementation touches the gate. It is written down now so the language does
not have to be retrofitted the day the gate app is built, and so the Sowel side has something to
build against.)_

14. The guest's language is part of the stay, not of the website. Any GuestFlow surface a guest
    reaches during their stay must be able to read it, and the gate is the first one coming:
    `specs/guest-gate-access.md` ships a guest-facing page (`/gate/v1/session`) plus a Sowel-facing
    poller tree (`/public/v1/gate/*`, that spec's §4.3). Today both are French-only, and the guest
    page is the **first guest-facing UI this app has ever had** — it must not become the one place
    where an English guest hits French.
    > **Sans test** — contrat écrit d'avance pour l'app portail ; aucune ligne de code ne l'implémente ici (§8)
15. **Contract, when the gate app is written:** `GET`/`POST /gate/v1/session` gains `stay.lang`
    (`'fr' | 'en'`), resolved exactly like an e-mail — `clients.emailLanguage` first, the
    reservation's language as a fallback, `fr` last (`controllers/emailsController.js:72`) — so one
    rule governs the whole guest-facing surface and the page can render itself accordingly. The
    Sowel long-poll payload (`GET /public/v1/gate/requests`) gains the same `lang` on its `request`
    object, so a notification the Sowel recipe raises can be worded in the guest's language.
    > **Sans test** — contrat écrit d'avance pour l'app portail ; aucune ligne de code ne l'implémente ici (§8)
16. `lang` is **additive and optional** there too: a consumer that ignores it behaves exactly as
    today. The gate's own security model is untouched — language is a display attribute, never a
    capability, and it must never widen what a token can do.
    > **Sans test** — contrat écrit d'avance pour l'app portail ; aucune ligne de code ne l'implémente ici (§8)
17. Whoever implements this amends `specs/guest-gate-access.md` §4.3 in the same commit. That spec
    owns the gate contract; this one only records what the contract must eventually say.
    > **Sans test** — consigne de tenue de spec, pas un comportement du logiciel

### What the operator sees in GuestFlow

_(Added 2026-09-24 at Adrien's request. The first version of this spec declared the back-office out
of scope; an operator about to write to a guest must be able to see which language that message will
leave in, without opening another screen.)_

18. The reservation fiche states, beside the guest's name, **the language that guest is written to
    in**, and says where it comes from. It is the client's `emailLanguage`, because that is what
    every sending path resolves first (`controllers/emailsController.js:72`) — not the reservation's
    own column, which only applies when no client is attached.
19. The fiche also states **where the booking came from** when it came from the website, with the
    same wording as the devis list: « Site internet ». Both markers are read-only on the fiche —
    they are facts about the guest and about the past, not settings to change here.
20. The manual send dialog **names the language the message will leave in** before it is sent, and
    lets the operator write this one in the other language. That override applies to **this send
    only** and never rewrites the guest's record: a French e-mail sent once to an English guest is a
    courtesy, not a change of preference. The server already accepted `lang` on preview and send and
    already returned the language it resolved — the dialog neither sent nor read it.
21. A form that does not carry `emailLanguage` must not decide it. `clientsModel.update` keeps the
    stored value when the payload does not mention the field, and the reservation page's client
    dialog carries the field it displays. Before this, editing a guest's phone number from the
    reservation page reset them to French.

### WordPress plugin (`guestflow-booking`)

22. The plugin resolves the current language once per request — `pll_current_language('slug')` when
    Polylang is present, otherwise `get_locale()` reduced to its two-letter prefix, otherwise `fr` —
    and sends it as `lang` on every upstream call (`class-gf-api-client.php`), in the query string
    and, for the two POSTs that read it there, in the body. **The transient cache key carries the
    language** (`class-gf-cache.php`): the same path now answers different labels per language, so
    without it whichever visitor arrived first would decide what every later one reads — a French
    drawer served to an English reader, held for ten minutes.
    > **Sans test** — code PHP du plugin WordPress — hors de la suite Node ; vérifié sur le site (§7)
23. The plugin ships real translation files (`/languages/guestflow-booking-en_GB.po` and `.mo`).
    Source strings stay French, which is what the 80 `__()` calls already assume; English arrives as
    a translation. The `.po` is the reviewable artefact and is versioned.
    > **Sans test** — fichiers de traduction `.po`/`.mo` — un artefact, pas un comportement
24. `runtime.js` and `blocks/calendar/view.js` stop hard-coding `fr-FR`: number and date formatting
    read the locale published by `wp_localize_script`.
    > **Sans test** — formatage côté navigateur dans le plugin — vérifié sur le site (§7)
25. The CGV shortcode already renders both languages with a flag switcher
    (`class-gf-shortcodes.php:71-82`). On an English page it must open on **English** by default;
    the visitor's manual choice still wins and is still remembered.
    > **Sans test** — shortcode PHP du plugin — vérifié sur le site (§7)

### Solio site (mu-plugins)

26. **Prerequisite, before any behaviour change:** the server-only mu-plugins are imported into
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
    > **Sans test** — import de fichiers à l'identique ; le test est la comparaison octet à octet faite avant l'import
27. The header and footer stop being frozen French HTML in the block template parts. They are
    rendered per language: labels and URLs both (`/la-granja/` ↔ `/en/la-granja/`), and the header
    carries a **language switcher** (§6, decided 2026-09-24 on
    `docs/specs/2026-09-24-site-language-switcher.html`) linking to the current page's translation —
    or to the English home when that page has no translation yet. The automatic first-language
    redirect described in §6 lives in `gf-i18n.php` and nowhere else — one function, its conditions
    readable in one place. **The switcher only exists when
    there is something to switch to:** it is not rendered at all while fewer than two languages have
    published content, so nothing advertises an English site before it stands — the discipline
    rule 29 applies to `hreflang`, applied to the interface.
    > **Sans test** — mu-plugins PHP du site Solio — hors de la suite Node ; vérifiés sur le site (§7)
28. `gf-booking.php`'s interface strings, including the singular/plural of "nuit", go through a
    small FR/EN map resolved from the current language, same shape as rule 3.

    > **Measured in a browser, 2026-09-24, after a first reading got it backwards.** The two files
    > share the funnel rather than competing for it: `gf-seo-reservation.php` draws the drawer's
    > chrome (`.gf-resa-*` — the trigger, the panel, the steps) and **`gf-booking.php`'s JavaScript
    > builds what is inside it**, the calendar included — `.gf-cal-title` and `.gf-cal-month` exist
    > in that file and in no other. What is inert is only its *block* rendering: the
    > `.gf-booking-block` anchor sits empty and `display:none` inside the drawer, which is what
    > `gf-seo-reservation.php`'s own comment calls « devenu muet ». So `gf-booking.php` is neither a
    > leftover nor removable — it is the funnel, and it is the file this rule names.

    Two consequences beyond the strings. The drawer now renders the **`priceUnitLabel` the server
    wrote** instead of rebuilding its own French units, which is what rule 3 asked for all along.
    And the language travels **explicitly** on every call to the `gf-solio/v1` relay, in the query
    string and in the booking request's body: a REST call is not the page, Polylang does not
    necessarily see the same thing there, and the drawer is the one that knows which language it is
    showing. Without it a stay asked for in English would have produced a French confirmation.
    > **Sans test** — mu-plugin PHP du site Solio — vérifié sur le site (§7)
29. `gf-seo-head.php` keeps `x-default` on French, and the `hreflang="en"` alternate is emitted
    **only for a page that actually has a published English translation**. Measured 2026-09-24: the
    deployed code already does this and needs no change — the alternates loop reads
    `pll_get_post_translations()` and emits nothing for a language with no translation. The rule
    stays written down because it is the behaviour the English rollout depends on, and a future
    edit must not lose it.
    > **Sans test** — mu-plugin PHP du site Solio — vérifié sur le site (§7)

### Content

30. The published French pages get an English translation, linked through Polylang, with English
    slugs under `/en/`. The English home replaces the empty "Blog" archive currently served there.
    **Measured on the live site 2026-09-24: there are 7 of them**, not the 10 this rule first
    claimed — `accueil-solio`, `la-granja`, `estiva`, `le-domaine`, `autour-de-nous`, `contact`,
    `cgv`. The earlier count came from a database that still held drafts; the path map in
    `gf-i18n.php` carries the same 7 and is the list to trust.
    > **Sans test** — contenu rédactionnel, pas du code
31. English is British (`en_GB`, already the declared locale) and keeps the French voice: sober,
    concrete, understated. The site never becomes salesier in translation than it is in French.
    > **Sans test** — contenu rédactionnel, pas du code
32. Pages are translated **one at a time and published straight away** _(decided 2026-09-24,
    reversing this rule's first version)_. Adrien does not want to proof-read the English before it
    goes live. The safety net is no longer his reading, so it has to be somewhere else: rule 29
    already keeps `hreflang` on really-translated pages only, and each page is published with its
    French twin open beside it so no fact — a price, a capacity, a date, a rule — drifts in
    translation. Facts are checked against the French page; prose is not sent for approval.
    > **Sans test** — procédure de publication, pas un comportement du logiciel
33. Nothing advertises the English site before it stands: rule 29 makes the `hreflang` follow real
    translations, so the sequencing is automatic rather than a thing to remember.
    > **Sans test** — conséquence de la règle 29, qui porte déjà sa propre vérification

### The facts inside the pages

_Added 2026-09-24, after measuring what the French pages actually contain. The first version of this
spec treated a page as prose, and it is not: the two pages that sell — `la-granja` and `estiva` —
call `[solio_essentiel]`, `[solio_equipements]` and `[solio_faq]`, whose text lives in
`gf-seo-facts.php` and was French-only. Translating the prose alone would have published an English
page carrying a French facilities table and a French FAQ, on exactly the page a visitor reads before
booking._

34. A fact carries its English **on the same line of the same array** as its French: `saison` and
    `saison_en`, `nom` and `nom_en`, `q`/`q_en`, `r`/`r_en`. One source of truth, two languages,
    never two files. A second English file would drift at the first price or opening-date correction
    made in a hurry, and a bilingual site that lies in only one of its languages is worse than a
    monolingual one.
35. `gf_fait( $tableau, $clef )` is the only way those facts are read. It returns the English on an
    English page **when it exists and is non-empty**, and the French otherwise. A missing translation
    shows a French word, never a blank row: a holed table is a worse answer than a French one.
36. **Labels and values are translated in different places, and that is deliberate.** A column
    heading ("Facilities", "Season") belongs to the interface and lives once in `gf-i18n.php`'s
    dictionary; "open all year round" is a fact and is corrected where the fact is written. The
    blocks reach the dictionary through `gf_seo_lbl()`, which falls back to the French string when
    `gf-i18n.php` is absent — a load-order change must not produce a mute page.
37. Times follow the language: `16:00` reads `16h00` in French and `4pm` in English, on the hour,
    with `9.30am` when there are minutes. A French page is unchanged, byte for byte.
    > **Sans test** — fonction PHP d'un mu-plugin du site Solio, aucun exécuteur PHP dans ce dépôt ;
    > mesurée en rendu réel le 2026-09-24 (`4pm`, `10am`, `9.30am`) et la non-régression française
    > prouvée par un diff avant/après du rendu des trois blocs (§7)
38. The JSON-LD follows the page too — equipment names, FAQ questions and answers, and
    `inLanguage`, which says `en-GB` on an English page. `fr-FR` markup under an English `hreflang`
    tells search engines the opposite of what the page says.
    > **Sans test** — mu-plugin PHP du site Solio ; vérifié sur le balisage rendu (§7)
39. Only the three blocks the published pages actually use are translated:
    `[solio_essentiel]`, `[solio_equipements]`, `[solio_faq]`. `[solio_tarifs]`, `[solio_geo]`,
    `[solio_comparatif]`, `[solio_caution]`, `[solio_surdemande]` and `[solio_tarifs_nuits]` keep
    French text: **none of them appears on any published page** (measured 2026-09-24). They read
    their data through the same `gf_fait()`, so translating one later is adding `_en` keys, not
    rewriting a block.
    > **Sans test** — mu-plugins PHP du site Solio, hors périmètre des suites du dépôt ; vérifié en
    > rendu réel (§7)
40. The terms page needs no translation: `[guestflow_cgv]` already renders its own FR/EN toggle from
    GuestFlow. Measured 2026-09-24 — the English text is served today.
    > **Sans test** — constat de mesure sur une fonctionnalité déjà livrée

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
| `models/` | `models/devisModel.js` | T | `carryOverColumns` also carries `requestOrigin` and the request's language to the reservation (rule 13) |
| `controllers/` | `controllers/emailsController.js` | — | **(unchanged)** — it already accepts a `lang` override; only the dialog was not sending it |
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

_(Added 2026-09-24. The first version of this spec declared the back-office out of scope; the
operator needs to **see** the language a request arrived in, at the moment they prepare a message.)_

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/ReservationPage.jsx` | T | Shows the request's language on the fiche; the FR/EN quote-language toggle stops being devis-only; `EMPTY_CLIENT` gains `emailLanguage` (bug below) |
| `components/` | `components/EmailManualSendDialog.jsx` | T | States the language the message will be sent in, and lets the operator change it **for that send** — the server already accepts `lang` (`emailsController.js:143`,`:159`) and the dialog simply never sent it |
| `components/` | `components/LanguageBadge.jsx` | **C** | Generic `FR`/`EN` marker, built on the existing `StatusBadge` grammar; used by the fiche and reusable by any list later |

**The back-office interface itself stays French** — this adds the display of the *guest's* language,
not a translation of the admin. `titleEn`, `nameEn`, `subjectEn`/`bodyEn` and the bilingual terms
keep their existing editors (`OptionsPage.jsx:723`, `EmailTemplatesPage.jsx:95-96`,
`TermsSettingsPage.jsx`), and the client fiche keeps its "Langue des emails" select
(`ClientFormFields.jsx:138-148`).

**Bug found while mapping this, fixed here** (`ReservationPage.jsx:122-133`): `EMPTY_CLIENT` omits
`emailLanguage`, while `clientsModel` rewrites that column from the payload on **every** update with
no "absent → keep" guard (`models/clientsModel.js:59-61`, `:192-193`). Editing a client from the
reservation page can therefore reset a guest silently to French — the exact accident this whole spec
exists to prevent. The fix is both sides: the constant carries the field, and the model keeps the
stored value when the payload does not mention it.

**Component reuse declaration:** one new generic component (`LanguageBadge`), justified because a
language marker will be wanted in the devis list the day English requests become common; everything
else reuses existing screens.

### 4.3 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `includes/class-gf-language.php` | **C** | Resolves the current language (Polylang → locale → `fr`) and exposes it to PHP and JS |
| `includes/class-gf-api-client.php` | T | Adds `lang` to every upstream request |
| `includes/class-gf-cache.php` | T | The transient key carries the language, so one visitor's language is not served to the next |
| `includes/class-gf-blocks.php` | T | Publishes the locale next to `GF.i18n` for `wp_localize_script` |
| `includes/class-gf-shortcodes.php` | T | CGV open on the page's language (rule 25) |
| `assets/runtime.js` | T | `Intl.NumberFormat` / date formatting driven by the published locale |
| `blocks/calendar/view.js` | T | Same for the calendar's month and day names |
| `languages/guestflow-booking-en_GB.po` | **C** | The English translation, reviewable in the diff |
| `languages/guestflow-booking-en_GB.mo` | **C** | Its compiled form, loaded by `load_plugin_textdomain()` |

### 4.4 Solio site (`integrations/wordpress/solio-site/mu-plugins/`)

| File | T/C | Responsibility |
|---|---|---|
| 10 server-only mu-plugins | **C** | Imported as-is first (rule 26), no behaviour change in that commit |
| `gf-i18n.php` | **C** | The site's FR/EN string map, the current-language helper the others call, and the first-visit `Accept-Language` redirect with its guards (§6) |
| `gf-header.php` (from the `header` template part) | **C** | Navigation rendered per language + renders the language switcher (hidden while a single language has content) |
| `gf-seo-icons.php` | T | Gains the `globe` icon, on the existing 24 × 24 stroke grid |
| `gf-footer.php` | T | Footer links and labels per language |
| `gf-booking.php` | T | Its ~40 interface strings go through `gf-i18n` |
| `gf-seo-head.php` | T | `hreflang` only for really-translated pages; `x-default` stays French |
| `gf-seo-facts.php` | T | The source of truth gains its English siblings (`*_en`) and the `gf_fait()` accessor (rules 34-35) |
| `gf-seo-blocks.php` | T | `gf_seo_lbl()` for the labels, `gf_fait()` for the values, language-aware time format (rules 36-37) |
| `gf-seo-schema.php` | T | The JSON-LD reads through `gf_fait()`; `inLanguage` follows the page (rule 38) |

### 4.5 API contract

`lang` is additive and optional everywhere. A consumer that never sends it — today's deployed plugin
included — receives byte-identical payloads to today. The same additive promise is written ahead for
the gate tree (rules 14-17), which this branch does not touch. `specs/public-api.md` gains a "Language"
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
English home otherwise — never a 404, never a greyed entry without an explanation.

*Automatic first language — decided 2026-09-24, reversing this section's first version.* A visitor
arriving for the first time is sent to the version matching their browser. The first draft refused
this outright; Adrien asked for it, so it is built — with the guards that make the difference
between a helpful default and a site that breaks under a cache:

1. **Server-side, in PHP** (`gf-i18n.php`), never in JavaScript. A redirect after paint flickers,
   and a language chosen by a script is a language no crawler ever sees.
2. **A browser whose language the site does not speak gets English** _(decided 2026-09-24)_.
   `fr*` → French; **anything else stated** → English; nothing stated at all → French. A German, a
   Dutch or a Spanish visitor reads English, which they are far likelier to follow than French.
   **This is the site's landing rule and nothing else.** The API's own `lang` fallback stays French
   (rule 1): a consumer that sends no language — the plugin deployed today included — must keep
   receiving byte-identical payloads, and flipping that default to English would turn every existing
   integration English overnight.
3. **Only on a first visit.** The moment the visitor touches the switcher, a `gf_lang` cookie is
   written (one year) and detection never runs again. **An explicit choice always wins**, including
   the choice to read French with an English browser.
4. **Only when there is somewhere to go:** the page must have a published translation. A visitor is
   never redirected to the English home for a page that only exists in French.
5. **Never for a crawler.** Googlebot and friends must receive the URL they asked for, or the
   `hreflang` mesh rule 25 builds describes a site that answers something else.
6. **Never on a URL carrying a query string.** This is not caution in the abstract: the Qonto
   payment return comes back as `…/la-granja/?gf_payment=…`, and a redirect that drops or re-writes
   those parameters loses a guest mid-payment. A URL with a query string is a URL in the middle of
   something.
7. **`302`, never `301`**, and `Vary: Accept-Language, Cookie` on the response. The mapping is
   per-visitor: cached as permanent, one visitor's language would be served to the next.
8. The canonical URL and `x-default` do not move (rule 25). Detection changes which page a person
   lands on, never what the site tells a search engine about itself.

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
   (rule 27).
6. The request produces a client with `emailLanguage = 'en'`; the confirmation email and the devis
   PDF are English.
7. A French visitor sees strictly today's site (the regression that matters most).
8. `hreflang` present only on pages with a real translation; `x-default` on French.
9. First visit with an English browser → the English page. Switch to French → the French page, and
   **it stays French** on the next visit. First visit with a French browser → nothing moves.
10. `curl -H 'User-Agent: Googlebot'` on a French URL → `200`, never a redirect.
11. A payment return (`…/?gf_payment=…`) is never redirected, whatever the browser language.

**Client Vitest / Playwright E2E:** unchanged and unaffected — no React code is touched. Both suites
must still pass.

## 8. Out of scope

- **Back-office i18n.** The React admin stays French.
- **`options.description` in English** — `specs/devis-english-language.md` §3 rule 6 stands.
- **Property names.** "La Granja" and "L'Estiva" are proper nouns.
- **Operator-typed data**: tariff season names, option descriptions, free-text notes.
- **Any third language.** The design must not make one harder, but none is built.
- **Region-specific variants.** `en-US` and `en-GB` both resolve to `en`; the site has one English.
- **The gate app, and every line of code behind rules 14-17.** Those rules are a contract written
  in advance, at Adrien's request (2026-09-24), so the language does not have to be retrofitted the
  day `specs/guest-gate-access.md`'s guest page and Sowel plugin are built. **Nothing in this
  implementation touches `/gate/v1/*` or `/public/v1/gate/*`.**
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
- [x] `utils/publicLabels.js` + tests (2026-09-24)
- [x] Projections take `lang`; catalogue, terms and payment controllers resolve it (2026-09-24)
- [x] Every public error message is bilingual, including the `MIN_NIGHTS` sentence, the portion
      refusal and the engine's propagated refusal — whose French wording now travels in `details`
      as the diagnostic it is (2026-09-24)
- [x] Booking request carries the language through to client and reservation, `requestOrigin`
      survives the conversion, and the origin badge reads « Site internet » (2026-09-24)
- [x] Plugin: language resolution, `lang` upstream, `.po`/`.mo` (124 strings), locale-aware dates,
      language-keyed cache, terms opening on the page's language, v1.12.0 (2026-09-24)
- [x] Site: `gf-i18n` (language, dictionary, path map), header and footer per language, the
      switcher, the first-visit browser redirect, the `globe` icon (2026-09-24)
- [x] Site: the booking drawer's strings, its month and day names, and the language carried on
      every one of its REST calls — including the booking request, so a stay asked for in English
      produces an English confirmation (2026-09-24)
- [x] `gf-seo-head`: verified 2026-09-24 — already correct, no change needed (rule 29)
- [ ] 10 pages translated and published one by one (no review — rule 28)
- [ ] Back-office: request language on the fiche, quote-language toggle outside devis mode, language
      in the send dialog, `EMPTY_CLIENT` / `clientsModel` overwrite guard
- [ ] `specs/public-api.md` + `specs/wordpress-plugin.md:289` amended
- [ ] _(not in this branch — rules 14-17)_ `specs/guest-gate-access.md` §4.3 amended when the gate
      app is built
