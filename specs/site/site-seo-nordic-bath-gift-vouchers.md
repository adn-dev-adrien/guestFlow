# Site SEO — the nordic bath and the gift vouchers

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/site-seo-nordic-bath-gift-vouchers` (spec, guestFlow) · `feature/seo-nordic-bath-gift-vouchers` (code, solio-site) |
| **Created** | 2026-11-26 |
| **Author** | Adrien |
| **Related PR** | guestFlow #1117 (spec) · solio-site #6 (code) |
| **Decision page** | `solio-site/rapports/2026-11-26-seo-bain-bons/index.html` |

---

## 1. Context

Since 4.5.0 (2026-11-26) the nordic bath can be booked by the hour without a stay (`/bain-nordique/`,
`site-outside-resource-booking`), and gift vouchers are on sale for Christmas (`/offrir-un-bon-cadeau/`,
`gift-vouchers/gift-voucher-campaigns`). Both pages are rendered by GuestFlow blocks in JavaScript.

Measured on 2026-11-26 on the public site:

- `/bain-nordique/` carries **25 words** of HTML a crawler can read; Google does not know the URL yet.
  `/offrir-un-bon-cadeau/` carries **44 words**. Neither page states a price, a time band, a party
  size or a validity in HTML.
- Neither page has an entry in `gf_seo_pages()` nor a `_gf_seo_title` override: the `<title>` and
  description are built from the first text of the page (« Satillieu · Ardèche verte Bain nordique
  Une séance… »). Same on the English twins.
- `/le-domaine/` carries the Google title « Bain nordique privatif en Ardèche, face aux prés »
  (`_gf_seo_title`, 2026-10-19) and is the page ranking 4.6 on « bain nordique ». Left as is, it would
  compete with `/bain-nordique/` for the same query.
- `llms.txt` says nothing of the outside sessions nor of the vouchers, and quotes « à partir de 30 €
  l'heure », which is the guests' rate, without saying so.
- Search Console, 90 days: 184 clicks, almost all on the brand name.
- Competition within ~1 h (research of 2026-11-26): nobody rents a wood-fired private bath by the
  hour. Moments de Douceur (Boulieu-lès-Annonay) owns « spa privatif Ardèche / Annonay » with FAQ and
  Product markup; Le Spa des Pins (Davézieux) is an indoor private jacuzzi/sauna/hammam at 41 €/h;
  Cap Oxygène (Pilat) has a shared wood-fired bath; the Spa du Haut Plateau (Saint-Bonnet-le-Froid) is
  a shared spa. All of them target couples; none uses the calendar (Christmas, Valentine's Day,
  Mother's Day), groups of friends, solo guests or the view.

## 2. Goal

A person searching for a private nordic bath, a relaxing outing for two, with friends or alone, or a
gift idea in northern Ardèche finds Domaine Solio — on Google and in AI answers — and the page they
land on states plainly what is offered, when, for how many and at what price.

## 3. Functional rules

### 3.A Never degrade what is online

1. Every change is **additive or a replacement of a value named in this spec**. Blocks already on
   `/le-domaine/`, the home page, the lodging pages and `/reserver/` are not touched, except the
   `/le-domaine/` Google title and description (rule 20) and the home description (rule 21).
2. The GuestFlow blocks (`guestflow/session-booking`, `guestflow/gift-voucher`) stay where they are,
   unchanged. New content is placed **below** them, except the bath page H1 (rule 6).
3. Before any write to the WordPress database, the target `post_content` and post meta are saved to
   `/tmp/bak-page-<ID>-<timestamp>.txt` inside `wp_app`; before any mu-plugin is replaced, the online
   file is diffed both ways against `origin/main` (memory: the container is often behind or ahead).
4. A change is « done » only once measured on the public site (HTTP 200, words readable without
   JavaScript, `<title>`, JSON-LD parses), never at merge time.

### 3.B Facts are read, never written

5. Every price, time band, party size, validity, add-on and amount range shown or marked up comes from
   GuestFlow at render time — `/sessions/resources` and `/gift-vouchers/offer` through
   `GF_Api_Client`, cached 1 h like `[solio_seance]`. When GuestFlow does not answer, the line or the
   FAQ answer that needs the value is **omitted**, never guessed. No price, hour or head count is
   written in PHP, in a page or in a test fixture used as content.

### 3.C The nordic bath page (`/bain-nordique/`, `/en/nordic-bath/`)

6. H1: « Bain nordique en Ardèche verte » / « Nordic bath in the Ardèche verte ». The eyebrow
   (« Satillieu · Ardèche verte ») and the sentence under it stay.
7. Below the booking block, in this order: « L'essentiel » (rule 8), « Le jour, le soir » (rule 9),
   « Pour qui » (rule 10), the FAQ (rules 11-13). All of it is server-rendered HTML.
8. « L'essentiel » is a list: wood-fired bath, water around `bain_temperature` °C (`gf_seo_domaine()`);
   private, up to `maxPeople`; daytime band `from`–`to` at the day price per hour; evening band
   `from`–`to` at the evening price per hour; extra hour price; Satillieu, distance to Annonay
   (`gf_seo_distances()`). Bands and prices come from the bath campaigns of `/gift-vouchers/offer`
   (`band`, `totalCents`, `extraTime.prices[0]`), falling back to `/sessions/resources.fromCents` for
   the « from » price. The tub's material is **not** stated (Adrien, 2026-11-26).
9. « Le jour, le soir »: two short evocative paragraphs, no practical modality
   (memory `site-texte-evocateur-sans-pratique`). FR: « L'eau fume, la vallée s'ouvre jusqu'aux
   crêtes. Le poêle crépite, le vent passe dans les prés. Rien entre vous et l'horizon. » /
   « Le poêle rougeoie, l'air fraîchit, les étoiles arrivent une à une. Aucune lumière de ville pour
   les cacher. » Both are always in the HTML (no toggle).
10. « Pour qui »: three tiles — « À deux », « Entre amies », « Seul·e » — with the texts of the decision
    page. No « en famille » tile.
11. FAQ, new key `bain-seance` in `gf_seo_faq()` (the existing `bain-nordique` key stays for
    `/le-domaine/`), questions in this order: what a nordic bath is (also called « bain norvégien »
    or hot tub, wood-fired, no material named); is a stay needed (no; guests get one hour free per
    stay); price (per hour for the whole bath, not per person; extra hour); how many people;
    nordic bath vs spa or jacuzzi; winter, rain, snow (all year; a session may be moved if the
    weather makes it dangerous); children (not advised under 12, minors under their parents'
    responsibility — bath CGV); pregnancy or treatment (« Une eau à 38 °C est déconseillée pendant la
    grossesse et en cas de problème cardiaque sans l'avis d'un médecin. »); what to bring (rule 12);
    drinks (rule 13); how long from Annonay, Tournon, Saint-Étienne, Lyon, Valence (rule 14); can it
    be offered (link to the voucher page).
12. « Que faut-il apporter ? » answers: a swimsuit; a shelter to change near the bath (confirmed by
    Adrien). « Serviettes en option » is added **only if** a bath add-on whose label contains
    « serviette » / « towel » is returned by GuestFlow. Created on 2026-11-26: option 35 « Serviette de
    bain », 8 € per unit (the price of the lodgings' « Linge de toilette », Adrien's choice), sold
    outside a stay, attached to no lodging so the lodging booking flow is unchanged. The lodging option
    itself could not be reused: it is priced per person and feeds the linen counts, and the engine
    refuses per-person options outside a stay. It shows on the site once added to the bath voucher
    campaigns (« Options proposées ») and, for direct bookings, to the bath's suggested articles.
13. « Peut-on boire un verre ? » lists the add-on families GuestFlow returns for the bath campaigns
    (drinks, platters) without prices; omitted when there are none. On 2026-11-26 a direct session
    booking offers no add-on yet: that choice is being developed separately and ships in the same
    release, so the answer is kept as written (Adrien, 2026-11-26).
14. Travel times (OSRM, measured 2026-11-26, rounded): Annonay 15 min, Saint-Vallier 25 min, Tournon
    40 min, Valence 1 h, Saint-Étienne 1 h 05, Lyon 1 h 20. They live in **one folded FAQ question**,
    visible to anyone who opens it. **Never hidden from visitors while shown to crawlers** (cloaking;
    Adrien asked for it, refused for this reason, folded question chosen instead). The figures join
    `gf_seo_distances()` so `llms.txt` and the page read the same source.
15. JSON-LD on this page: a `Service` node (`serviceType` « Bain nordique privatif »,
    `provider` → `#domaine`, `areaServed` Ardèche verte, `offers`: one `Offer` per band with a
    `UnitPriceSpecification` per hour, EUR); `FAQPage` built from the same `bain-seance` array as the
    visible FAQ; `BreadcrumbList` Accueil → Bain nordique. No `AggregateRating` (self-serving reviews).

### 3.D The gift voucher page (`/offrir-un-bon-cadeau/`, `/en/gift-voucher/`)

16. H1: « Offrir un bain nordique ou un séjour » / « Give a nordic bath or a stay ».
17. Below the voucher block: a line of occasions (Noël, Saint-Valentin, Anniversaire, Fête des mères,
    Entre amies, Pour dire merci), each with its one-line evocative text from the decision page, all
    present in the HTML; then « Les bons »: one line per campaign on sale (title, band, price), the
    stay voucher as a range `minAmountCents`–`maxAmountCents`, the validity `validityMonths`, « reçu par
    e-mail avec la carte à imprimer »; then a FAQ, key `bons-cadeaux`: when it arrives, validity, how it
    is used, what can be added.
18. JSON-LD: one `Product` per campaign on sale with an `Offer` (price, EUR, `availability` InStock);
    the stay voucher with an `AggregateOffer` (`lowPrice`/`highPrice`); `FAQPage` from `bons-cadeaux`.

### 3.E Titles and descriptions

19. New `gf_seo_pages()` entries (French), descriptions with their figures injected from GuestFlow
    (rule 5):
    - `bain-nordique` — « Bain nordique privatif à l'heure en Ardèche verte | Solio » / « Un bain
      nordique au feu de bois, rien que pour vous, face à la vallée. Jusqu'à {maxPeople} personnes, de
      {jour.from} à {soir.to}, dès {prix jour} l'heure, à 15 km d'Annonay. »
    - `offrir-un-bon-cadeau` — « Bon cadeau bain nordique en Ardèche : Noël, Saint-Valentin » /
      « Offrez une heure de bain nordique, le jour ou sous les étoiles, ou un séjour au Domaine Solio.
      Reçu par e-mail avec la carte à imprimer, valable {validityMonths} mois. »
    - `saint-valentin-en-ardeche` — rule 23.
    English pages get the same through their `_gf_seo_title` / `_gf_seo_description` meta (the table is
    keyed on French slugs).
20. `/le-domaine/` (page 317): `_gf_seo_title` « Le Domaine Solio : 13 hectares de nature en Ardèche
    verte », `_gf_seo_description` « Prairie, forêt, ânes, chèvres et moutons, une boucle de 2 km et un
    bain nordique face à la vallée : 13 hectares rien que pour vous à Satillieu. » Its bath section gains
    one link to `/bain-nordique/`; nothing else on the page changes.
21. Home description: « 13 ha rien que pour vous à Satillieu : gîte 3 étoiles pour 10, tente safari,
    bain nordique à l'heure face à la vallée, ânes et chèvres. Bons cadeaux. » Title: « Domaine Solio,
    Satillieu : gîte pour 10 et tente safari, Ardèche ».
22. The voucher page title follows the calendar, computed from the date in PHP (Europe/Paris) — no
    manual edit:
    - 1 November → 25 December: « Bon cadeau bain nordique en Ardèche : Noël, Saint-Valentin »;
    - 26 December → 14 February: « Bon cadeau Saint-Valentin : bain nordique en Ardèche »;
    - 15 February → French Mother's Day (last Sunday of May, or the first Sunday of June when it is
      Pentecost): « Bon cadeau fête des mères : bain nordique en Ardèche »;
    - otherwise: « Bon cadeau bain nordique en Ardèche, à offrir toute l'année ».
    Each title stays ≤ 60 characters.

### 3.F The Valentine's Day page (`/saint-valentin-en-ardeche/`)

23. A permanent French page, online **before 2027-01-05**, same URL every year. Title « Saint-Valentin
    en Ardèche : bain nordique à deux sous les étoiles », short evocative copy: the evening bath for
    two, the evening voucher, a stay voucher to use later (L'Estiva is closed in February — the page
    never suggests a February stay at L'Estiva). Links to `/bain-nordique/` and
    `/offrir-un-bon-cadeau/`. FAQ key `saint-valentin` (evening band and price read live, voucher
    arrives by e-mail, validity). No English twin (out of scope).

### 3.G AI readability

24. `llms.txt`: the bath line distinguishes the outside session (day/evening price, bands, party size,
    not advised under 12) from the guests' free hour and their 30 €/h extra; a gift voucher line; the
    two pages (and the Valentine page once published) in « Pages » with one-line summaries; the stale
    slugs of `$resumes` that no longer exist (`hebergements`, `privatiser-le-domaine`,
    `bain-nordique-ardeche`, `faq`, `acces`, `vos-hotes`) are removed. All figures from GuestFlow.
25. After each deployment: IndexNow ping of the changed URLs (`gf_indexnow_signaler`), sitemap
    resubmitted in Search Console, URL inspection requested for `/bain-nordique/`.

### 3.H Off-site (Google Business Profile — Adrien's account)

26. On the existing profile: service « Bain nordique privatif » with its price, products for each
    voucher, three posts (Christmas vouchers now, outside bath bookings now, Valentine's Day around
    2027-01-10). Texts and images: `solio-site/rapports/2026-11-26-seo-bain-bons/fiche-google.md`.
    No second profile. No marketplace (Funbooker etc.: their calendar is not linked to GuestFlow). No
    press release (Adrien, 2026-11-26).

**Edge cases:**
- GuestFlow down → « L'essentiel » keeps the non-priced lines; FAQ answers that need a figure are
  dropped from both the HTML and the `FAQPage`; `Service`/`Product` nodes without a price are not
  emitted.
- A campaign is withdrawn from sale → its line, its `Product` node and its mention in the
  description disappear at the next cache refresh.
- English page → every label from `gf-i18n.php` (`en` half); FAQ answers from the `_en` fields.

---

## 4. Architecture

No GuestFlow server or client code changes: everything lives in the WordPress site
(`solio-site` repository, deployed manually to `wp_app` on .23) and in page content.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | None. The public endpoints `/sessions/resources` and `/gift-vouchers/offer` already return every figure. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | None. |

**Component reuse declaration:** not applicable (no GuestFlow UI).

### 4.3 WordPress site (`solio-site/mu-plugins/`)

| File | T/C | Responsibility |
|---|---|---|
| `gf-seo-facts.php` | T | FAQ keys `bain-seance`, `bons-cadeaux`, `saint-valentin` (FR + `_en`); travel times in `gf_seo_distances()`; a reader `gf_seo_offre_bain()` returning bands/prices/party size/add-on families from `/gift-vouchers/offer` + `/sessions/resources` (cached 1 h, null on failure). |
| `gf-seo-blocks.php` | T | Shortcodes `[solio_bain]` (L'essentiel, le jour/le soir, pour qui) and `[solio_bons]` (occasions, les bons); token replacement for live figures in FAQ answers, dropping an answer whose token cannot be filled. |
| `gf-seo-schema.php` | T | `Service` node on the bath page, `Product`/`AggregateOffer` nodes on the voucher page; `FAQPage` reuses the same token-filled arrays. |
| `gf-seo-head.php` | T | `gf_seo_pages()` entries for the three pages, seasonal voucher title, home title/description, live figures in descriptions. |
| `gf-seo-indexation.php` | T | `llms.txt` bath and voucher lines, page summaries, stale slugs removed. |
| `gf-i18n.php` | T | Every new label in `fr` and `en`. |
| `gf-site-style.php` | T | Styles for the new blocks, reusing the existing tokens (`.essentiel`-like list, tiles, occasions). |
| `tests/seo-nordic-bath-gift-vouchers.test.js` | C | Shape tests (rules 5, 8, 10-15, 17-19, 22, 24). |

### 4.4 Page content (WordPress database, not versioned)

| Page | ID | Change |
|---|---|---|
| Bain nordique FR / EN | 683 / 689 | H1; `[solio_bain]` + `[solio_faq page="bain-seance"]` appended under the booking block. |
| Offrir un bon cadeau FR / EN | 682 / 688 | H1; `[solio_bons]` + `[solio_faq page="bons-cadeaux"]` appended under the voucher block. |
| Le Domaine | 317 | `_gf_seo_title`, `_gf_seo_description`; one link to `/bain-nordique/` in the bath section. |
| Saint-Valentin | new | Created and published (rule 23). |

### 4.5 API contract

Unchanged — read only: `GET /sessions/resources`, `GET /gift-vouchers/offer` (WordPress proxy
`/wp-json/guestflow/v1/...`, server side through `GF_Api_Client`).

---

## 5. Data model

None in GuestFlow. WordPress: post content and the `_gf_seo_*` meta of the pages above, one new page.
**Data impact:** each touched page is backed up before the write (rule 3).

## 6. UI / UX

Decision page with interactive mock-ups: `solio-site/rapports/2026-11-26-seo-bain-bons/index.html`.

- Bath page: hero and booking block unchanged; under them « L'essentiel » (bordered list on the paper
  background), the two moments side by side from 760 px and stacked below, three tiles (auto-fit,
  min 190 px), the FAQ as native `<details>` (text in the source even when folded).
- Voucher page: occasions as a wrapping row of short lines (all visible, no toggle in production),
  « Les bons » list, FAQ.
- Mobile (≤600 px): every block single column, padding reduced, no horizontal scroll, touch targets of
  the FAQ summaries ≥ 44 px.
- Copy: evocative above the fold, practical only in « L'essentiel » and the FAQ.

## 7. Test plan

- `tests/seo-nordic-bath-gift-vouchers.test.js` (node --test, shape only — PHP has no runner here):
  shortcodes registered; no literal price/hour/head count in the new code; every new label in both
  halves of `gf-i18n.php`; FAQ keys present in FR and EN; travel-time question exists and no
  `display:none` / `hidden` / `visibility` / off-screen class wraps any SEO block; `Service`, `Product`,
  `FAQPage` builders read the offer reader; seasonal title switch dates; `llms.txt` stale slugs gone.
- `php -l` on every touched mu-plugin (in `wp_app`, before deployment).
- Online, after deployment (rule 4): words readable without JS on the 2 + 2 + 1 pages; `<title>` and
  description; JSON-LD parses and holds the expected types; Rich Results Test on `/bain-nordique/` and
  `/offrir-un-bon-cadeau/`; unchanged pages (`/`, `/la-granja/`, `/estiva/`, `/le-domaine/` body,
  `/reserver/`) return the same visible text as before except the named fields; booking a bath slot and
  opening the voucher purchase still work; mobile 375 px check.

## 8. Out of scope

- One page per origin city (doorway pages) — the folded travel-time question covers it.
- Marketplaces (Funbooker, Cap Adrénaline…), press release, a second Google Business Profile.
- English Valentine's Day page; blog.
- The towel add-on itself (created by Adrien in GuestFlow; rule 12 picks it up automatically).
- Review markup on the site.

## 9. Open questions

- **Resolved 2026-11-26** (decision page): H1 with place; three « Pour qui » tiles; permanent Valentine
  page before 5 January; no city pages; pregnancy line in the FAQ; no marketplace; service + products on
  the existing Google profile; no press release; English twins at the same time; tub material not
  stated; towels as a paid option; changing shelter exists; travel times measured by Claude; « spa de
  Pain » = Le Spa des Pins (Davézieux).
- **Resolved 2026-11-26**: travel times hidden from visitors → refused (cloaking); one folded FAQ
  question instead (Adrien's choice).

## 10. Implementation progress

- [x] mu-plugins (solio-site #6, deployed 2026-11-26, backups `/tmp/bak-mu-plugins-20261126-115242.tgz` in `wp_app`)
- [x] page content and new page (683, 689, 682, 688, 317 and 51 meta; Valentine's Day page id 722; backups `/tmp/bak-page-*-20261126-115243.txt`)
- [x] online measurement (rule 4): readable words without JS — bath 25 → 528, bath EN 22 → 512, vouchers EN 48 → 287, Valentine 229; titles, descriptions and JSON-LD as specified; no raw shortcode; other pages unchanged (staged render diff before deployment); mobile 390 px without horizontal scroll; sitemap resubmitted to Search Console
- [ ] Google Business Profile (rule 26) — posts and texts ready in `solio-site/rapports/2026-11-26-seo-bain-bons/fiche-google.md`, to publish with Adrien logged in
- [ ] towel option 35 added to the two bath voucher campaigns (Adrien, campaign editor) and its English label « Bath towel » in the translation CSV
