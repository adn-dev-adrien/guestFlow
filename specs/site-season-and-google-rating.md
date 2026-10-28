# Site — the Estiva's season and the Google rating, each written once

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/site-season-and-google-rating` (this repository: spec and mock-up; the deployment's private repository: code) |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | solio-site#1 (code); this repository: spec and mock-up |

Mock-up validated on 2026-10-28: [`docs/specs/2026-10-28-site-season-and-google-rating.html`](../docs/specs/2026-10-28-site-season-and-google-rating.html).

---

## 1. Context

A comparison with the camping websites of a tourism web agency (2026-10-28) turned up two facts
on the Solio site that had drifted, each because it was copied into several places.

- **The Google rating.** The home page said « Note 5,0 sur Google — 11 avis », Le Domaine said
  « 5,0 sur 5 · 22 avis Google », and the English pages copied each figure. The listing had
  **25** reviews that day. The four figures were typed into the page content, which lives only in
  the WordPress database, so no code change could ever have kept them right. The two pages also
  linked to two different Google URLs.
- **The Estiva's season.** « du 1er avril au 14 octobre » was spelled out in five places: the
  `saison` fact, two FAQ answers, the privatisation line of `/llms.txt`, and (as « avril à
  mi-octobre ») the hero line of the Estiva page. None gave a year. On 28 October, with the tent
  closed, nothing told a visitor that it reopens on 1 April 2027. The JSON-LD carried no season
  at all.

The agency's sites open their home page with « vous accueille du 14 mai au 13 septembre 2027 »:
the year is what makes the line useful.

## 2. Goal

A visitor reads the right number of Google reviews everywhere, and knows from the Estiva page
when the tent is next open. Search engines get the same season, as structured data.

## 3. Functional rules

1. The Google rating (score and number of reviews) is stored once, as two WordPress options, and
   edited in **Réglages → Note Google**. No page writes it.
2. Every page that shows the rating renders it with `[solio_note_google]`: « Note 5,0 sur Google —
   25 avis » in French, « Rated 5.0 on Google — 25 reviews » in English. It links to the
   domain's Google listing (`cid=8290763928945273589`), the same URL as the `sameAs` entry.
3. The settings page refuses a score outside 1.0–5.0 or with more than one decimal (a comma is
   accepted), and a review count that is not a whole number above 0. It names the reason and keeps
   the previous value.
4. Until the options are first saved, the rating reads 5.0 and 25 (the listing on 2026-10-28).
5. No `AggregateRating` or `Review` in the JSON-LD. Google shows no stars for reviews a business
   publishes about itself, and its rules forbid the markup.
6. `/llms.txt` states the rating and the listing URL among its facts.
7. The Estiva's opening is stored once, as month-day: `'ouverture' => array( 'debut' => '04-01',
   'fin' => '10-14' )`. The rule text (`saison`, `saison_en`), the FAQ answers and `/llms.txt` are
   derived from it.
8. The **period shown** is the current season, or the next one when the tent is closed. The day
   after the closing date, the next year's season is shown.
9. « L'essentiel » on the Estiva page shows the period with its year: « du 1er avril au 14 octobre
   2027 » / « 1 April to 14 October 2027 ».
10. The Estiva hero line reads « Tente safari · dès le 1er avril 2027 » when closed and
    « Tente safari · jusqu'au 14 octobre » when open, through `[solio_saison logement="lodge"]`
    (English: « from 1 April 2027 », « until 14 October »). The date is written with non-breaking
    spaces, so it moves to the next line as a whole and is never cut in two.
    *Amended 2026-10-28, after the mock-up:* the mock-up said « réouverture le 1er avril 2027 » and
    « ouverte jusqu'au 14 octobre ». Measured on the live page at 375 px, the kicker (spaced
    capitals) needed three lines and split « 1ER / AVRIL ». Even unbreakable, it overflowed by
    46 px. The short forms fit, with a 60 px margin.
11. The Estiva's `Campground` node carries an `openingHoursSpecification`: every day, `00:00` to
    `23:59`, `validFrom` / `validThrough` = the period of rule 8.
12. A lodging with no `ouverture` (La Granja, open all year) keeps its `saison` text, gets no year
    and no `openingHoursSpecification`.
13. The FAQ, `/llms.txt` and the comparison table keep the rule without a year. They describe how
    the tent works, not the season of the moment.

**Edge cases:**
- 31 March → closed, « dès le 1er avril 2027 ».
- 1 April and 14 October → open, « jusqu'au 14 octobre ».
- 15 October 2027 → closed, period 2028.
- Score « 4,75 », « 7 », « abc » or count « 0 », « -3 », « 2.5 » → refused, previous value kept.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

None. GuestFlow is not touched.

### 4.2 Site side (the site's mu-plugins, in the deployment's private repository)

| File | T/C | Responsibility in this change |
|---|---|---|
| `gf-seo-facts.php` | T | `ouverture` replaces the literal season; `gf_seo_avec_saison()` derives `saison`/`saison_en`; `gf_seo_jour_mois()` writes « 1er avril » / « 1 April »; `gf_seo_saison_periode()` picks the current or next season; `gf_seo_avis_google()` reads the two options; the FAQ builds its dates from `ouverture`. |
| `gf-seo-blocks.php` | T | « L'essentiel » shows `gf_seo_saison_datee()`; new shortcodes `[solio_saison]` and `[solio_note_google]`. |
| `gf-seo-schema.php` | T | `gf_seo_schema_ouverture()` adds `openingHoursSpecification` to the lodging node; header comment on why there is no `AggregateRating`. |
| `gf-seo-indexation.php` | T | `/llms.txt`: privatisation dates from `ouverture`, plus the rating line. |
| `gf-seo-admin.php` | T | Réglages → Note Google: two fields, validation by `sanitize_callback` and `add_settings_error`. |
| `gf-i18n.php` | T | Four labels in both languages: `val_saison_du_au`, `accroche_ouverte`, `accroche_fermee`, `note_google`. |
| `tests/season-and-google-rating.test.js` | C | Holds rules 1–3, 7, 9–11 and the bilingual labels. |

### 4.3 WordPress content (container `<container>`, host `<wp-host>`)

| Page | Change |
|---|---|
| Accueil (51) and its English page (647) | The rating link becomes `[solio_note_google classe="gf-band-link"]`. |
| Le Domaine (317) and The Estate (651) | The rating link becomes `[solio_note_google]`. |
| L'Estiva (69) and its English page (653) | « avril à mi-octobre » / « April to mid-October » in the hero kicker becomes `[solio_saison logement="lodge"]`. |

The home page's Estiva card (« Tente safari · avril à mi-octobre · 5 personnes ») and the
navigation note are left as they are: they describe the rule, not the season of the moment.

### 4.4 API contract

None.

## 5. Data model

Two WordPress options: `gf_avis_google_note` (float) and `gf_avis_google_nombre` (int). No
GuestFlow schema change.

## 6. UI / UX

- Réglages → Note Google: two fields (Note « 5,0 » sur 5, Nombre d'avis), the standard WordPress
  save button, the WordPress error banner when a value is refused.
- Estiva page: only the hero kicker and the « Saison » line change. Same style, same place, on
  desktop and mobile alike. At 375 px the kicker takes two lines: « Tente safari · », then the
  whole date.

## 7. Test plan

### Site tests (`node --test tests/`, private repository)

`season-and-google-rating.test.js`, 5 tests: dates stored once as month-day and never spelled out
again in the code; season, hero line and JSON-LD read the same period; the rating comes from the
options and no count is written in code; the settings refuse invalid input; the four labels exist
in both languages. Whole suite: 38 tests.

Logic run in the container's PHP on an isolated copy with WordPress stubbed: 33 assertions
(boundaries 31/03, 01/04, 14/10, 15/10; FR/EN strings; shortcode output; validation; JSON-LD node;
FAQ text).

### Manual verification

- `/estiva/` and `/en/estiva-safari-tent/`: hero kicker and « Saison » line as in rules 9–10;
  JSON-LD has `openingHoursSpecification` 2027-04-01 → 2027-10-14.
- `/`, `/en/`, `/le-domaine/`, `/en/the-estate/`: « 25 avis » / « 25 reviews », link to the `cid`
  URL.
- `/llms.txt`: rating line, privatisation dates.
- Réglages → Note Google: a refused value shows the error and leaves the pages unchanged.
- Mobile 375 px: the Estiva hero has no overflow.

## 7 bis. Deployment

**Mu-plugins — live since 2026-10-28.** The six files were patched with this change's diff
only. The container was behind the private repository on four of them (`gf-i18n.php`,
`gf-seo-schema.php`, `gf-seo-reservation.php`, `gf-site-style.php`), and copying whole files
would have shipped undeployed work. Measured live that day: « Saison » reads « du 1er avril au
14 octobre 2027 » (« 1 April to 14 October 2027 »), the `Campground` node carries the
2027-04-01 → 2027-10-14 period, and `/llms.txt` has the rating line. Backups of the previous files:
`/tmp/bak-season-rating-20261028-092416/` in the container.

**Page contents (§4.3) — to be run by Adrien.** Writing to the production database from a
session was refused by the safety check. `rapports/season-rating-2026-10-28/deploy-pages.sh` in
the private repository replaces the six snippets by exact match (it stops before any write if a
page does not hold exactly one occurrence), saves each page to `/tmp/bak-page-<id>-<ts>.txt`,
rebuilds the Polylang language cache, and prints the live checks. Until it runs, the four pages
still show 11 and 22 reviews and the hero kicker still reads « avril à mi-octobre ».

## 8. Out of scope

- Reading the rating from Google automatically (Places API: a paid key for a number that changes
  monthly).
- Dating La Granja's or the home page's season lines.
- `openingHoursSpecification` on the domain node.

## 9. Open questions

None. Resolved on 2026-10-28 from the mock-up: the hero kicker is dated (rule 10, wording
shortened the same day for mobile), and the rating is edited in the WordPress admin rather than
in the facts file (rule 1).
