# Lodging pages — one fact, one place

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/site-lodging-fact-zones` _(user-managed)_ |
| **Created** | 2026-09-24 |
| **Author** | Adrien |
| **Related PR** | #592 |
| **Mockup** | `docs/specs/2026-09-24-lodging-fact-zones.html` |

---

## 1. Context

Each lodging page on `domainesolio.com` (`/la-granja/`, `/estiva/`) carries **three** separate blocks
of raw facts, measured on the live site on 2026-09-24:

| Block | Where | What | Icons |
|---|---|---|---|
| `.gf-caps` | right under the hero | 7 badges: capacity, bedrooms, double beds, single beds, shower rooms, toilets, label | 7, injected by JS |
| `.gf-essentiel` | just below | 8–9 definition lines: surface, check-in/out, season, pets, babies, nordic bath, non-smoking, accessibility | none |
| `.gf-amenities` | **after the whole story**, right before the booking drawer | 9–11 icon cards | 9–11, injected by JS |

Three defects follow from that layout.

**1. Facts are written twice.** La Granja repeats four (`2 salles d'eau`, `2 toilettes` in both the
badges and the amenity grid; `Bain nordique` and `Équipement bébé` in both L'essentiel and the
grid), L'Estiva repeats three. Two screens apart, nobody noticed; the moment the blocks sit next to
each other, it is glaring.

**2. The visible grid and `gf-seo-facts.php` have already diverged.** The amenity grid is
hand-written HTML inside the WordPress page, while `gf_seo_lodgings()['…']['equipements']` holds a
*different* list — the one feeding JSON-LD `amenityFeature` (`gf-seo-schema.php:247,283`).
`/llms.txt` never reads it, so the inventory is absent from the file AI agents fetch first. Five facts of La Granja exist for robots and not for the reader: wood stove, table for
10–12, sunrise terrace, attic playroom, wood-fibre insulation. The `solio-site/README.md` promise of
"une seule source de vérité" is already false for this block.

**3. None of it is versioned, and the icons need JS.** The markup lives in the WordPress page, the
CSS in two inline `<style>` blocks, and the SVG icons are drawn at load time by two inline
`<script>` blocks. No AI crawler sees an icon, a JS failure leaves the badges bare, and the work is
lost at the next container incident — the repository copy under `integrations/wordpress/solio-site/`
does not contain any of it.

## 2. Goal

A visitor gets every fact about a lodging **in one run, before the story starts**, each fact stated
once, in a table that reads on two columns when there is room and on one when there is not.

## 3. Functional rules

1. The amenity block moves **directly under "L'essentiel"**, above the narrative sections. The
   badge strip stays exactly where and as it is.
> **Sans test** — PHP of a WordPress mu-plugin, which no suite of this repository runs. Verified §7 — block order read end to end on both live pages.
2. The amenity block is a table of rows: one icon, a bold label, an optional grey precision line.
> **Sans test** — same PHP; verified §7 — the rendered rows carry one icon, one label and an optional precision.
3. The table lays out on **two columns when its own container is at least 600 px wide**, one column
   below — a container query, not a viewport query, so the block behaves the same in a narrow
   column and in full page.
> **Sans test** — a CSS container query; no suite of this repository renders a browser. Measured §7 with the computed `grid-template-columns` at 390 / 900 / 1400 px.
4. Counting facts (shower rooms, toilets) stay in the badge strip and **leave the amenity table**.
> **Sans test** — composition of the data file, not behaviour. Verified §7 — no fact appears twice.
5. Service facts (nordic bath, baby equipment) leave **"L'essentiel"** and live in the amenity
   table, where their commercial precision ("1 h offerte à chaque séjour") belongs.
> **Sans test** — composition of the data file, not behaviour. Verified §7 — the two lines left « L'essentiel » and are in the table.
6. After rules 4 and 5, **no fact appears twice** on the page.
> **Sans test** — consequence of rules 4 and 5; verified §7 by reading badges, « L'essentiel » and the table end to end.
7. Shared-domain facts (pool, nordic bath, farm animals, trail, river, parking) stay inside the
   lodging's amenity table, as today — no separate band.
> **Sans test** — a scope statement: nothing to prove but an absence — no separate band exists.
8. The table is rendered **server-side, without JavaScript**, icons included, so crawlers and AI
   agents read the same page a visitor does.
> **Sans test** — the absence of JavaScript cannot be proved by a suite that runs none. Verified §7 by `curl` on the raw HTML: every `<svg>` is in the source.
9. The rendered table, `/llms.txt` and the JSON-LD `amenityFeature` come from **one source**,
   `gf-seo-facts.php`; they cannot diverge by construction.
> **Sans test** — a single PHP array read by three renderers; verified §7 by comparing the table, `amenityFeature` and `/llms.txt` on the live pages.
10. An amenity may carry `'visible' => false`: it stays in `equipements`, and therefore in the
    JSON-LD `amenityFeature` and in `/llms.txt`, but it never renders. The five La Granja facts and
    the three L'Estiva facts that exist only in `gf-seo-facts.php` today take that flag — decided
    2026-09-24. The rendered table is therefore a *subset* of the source, never a second list.
> **Sans test** — a flag read by a mu-plugin; verified §7 — 9 and 7 rows rendered, 14 and 12 published.
11. `/llms.txt` lists each lodging's inventory under its entry, so an assistant that reads only
    that file knows what each lodging holds without parsing the page.
> **Sans test** — same mu-plugin; verified §7 — `/llms.txt` read after deployment.

**Edge cases:**
- An amenity with no precision line → the row renders with the label alone, same height rhythm.
- An amenity flagged `'visible' => false` → absent from the table, present in `amenityFeature`
  and in `/llms.txt`.
- An unknown icon key → the row renders without an icon rather than breaking the grid.
- Odd number of rows on two columns → the last row sits alone in the left column; the column
  separator stays continuous.
- JS disabled → the whole block, icons included, is present in the HTML source.

---

## 4. Architecture

This change lives in the WordPress site, not in the GuestFlow client/server. The repository copy
under `integrations/wordpress/solio-site/` is the versioned source; deployment is manual
(see §7 and `solio-site/README.md`).

### 4.1 WordPress modules (`integrations/wordpress/solio-site/mu-plugins/`)

| File | T/C | Responsibility in this change |
|---|---|---|
| `gf-seo-facts.php` | T | Each `equipements` entry becomes `array( 'ic' => '<key>', 'nom' => '…', 'precision' => '…', 'visible' => bool )` instead of a bare string. Single source for the table, `/llms.txt` and the JSON-LD. Holds the whole inventory; the rows already said elsewhere on the page carry `'visible' => false` (rule 10). The nordic-bath sentence is written once (`$bain`) and shared by `bain_nordique` and the hot-tub row. |
| `gf-seo-blocks.php` | T | New shortcode `[solio_equipements logement="gite"]` rendering the table in PHP, icons inline. `[solio_essentiel]` drops the two lines moved by rule 5. Carries the `.gf-eqt*` CSS, including `@container (min-width:600px)` and its `@supports not` fallback — this module already ships the stylesheet of every `[solio_*]` block, so the rule lives beside the markup it dresses rather than in the site charter. |
| `gf-seo-schema.php` | T | `gf_seo_schema_equipements()` reads `$e['nom']` when the entry is a row, the string itself when it is one of the domain-wide sentences; `LocationFeatureSpecification` output unchanged. |
| `gf-seo-indexation.php` | T | `/llms.txt` lists each lodging's inventory under its entry (rule 11). |
| `gf-caps.php` | T | The badge pictograms stop being injected by JS: a `the_content` filter (priority 20) inserts them at render time, from the icon map. Render time and not save time, because `wp_kses` strips inline `<svg>` from post content on save — that constraint is what had pushed the drawing into JavaScript in the first place. |
| `gf-seo-icons.php` | C | The SVG icon set as a PHP map: the amenity icons on a 24 × 24 grid (`hottub`, `pool`, `kitchen`, `bbq`, `shower`, `wc`, `bed`, `terrace`, `parking`, `wifi`, `washer`, `baby`, `safety`, `power`, `games`, `pets`, `trail`, `petanque`, `billard`, `babyfoot`) and the badge icons on their taller grids (`badge-people`, `badge-tent`, `badge-door`, `badge-bed-single`, `badge-bed-double`, `badge-shower`, `badge-wc`, `badge-stars`). Exactly the paths already drawn in production, moved from JS to PHP. The stroke is `currentColor`, so the stylesheet decides the colour. |

**Deleted from the container:** `gf-amenities.php` — the module that enqueued the grid's CSS on
every page of the site and drew its icons in JavaScript. It was never in the repository. Once the
shortcode ships, nothing on the site carries `.gf-amenity` markup any more.

**Rescued on the way:** `gf-site-style.php` in the repository was missing the whole film band (the
aerial video, its lazy-loading and its play fallback), which existed only inside the Docker volume.
Deploying the repository copy would have deleted it from the site. It is re-versioned by the first
commit of this branch, untouched.

### 4.2 WordPress pages (edited in the admin, not in the repo)

| Page | Change |
|---|---|
| `/la-granja/`, `/estiva/` | The hand-written `<div class="gf-amenities">…</div>` and its wrapper group are deleted and replaced by `[solio_equipements logement="…"]`, placed just after `[solio_essentiel]`. The badge strip keeps its markup, untouched, and is served by the PHP icon map. |

### 4.3 API contract

None. No GuestFlow endpoint is touched.

---

## 5. Data model

No database change. The PHP shape changes:

```php
'equipements' => array(
    array( 'ic' => 'kitchen', 'nom' => 'Cuisine des tribus',
           'precision' => 'four, lave-vaisselle, très grand réfrigérateur, cafetière, ustensiles' ),
    array( 'ic' => 'hottub',  'nom' => 'Bain nordique', 'precision' => $bain ),
    // Publié, jamais affiché : le poêle est raconté dans le récit et dans la FAQ.
    array( 'ic' => null, 'nom' => 'Poêle à bois', 'precision' => 'bois fourni', 'visible' => false ),
    // …
),
```

A missing `visible` key means `true`. A hidden row needs no icon: it is never drawn. Nine rows of
La Granja and seven of L'Estiva render; fourteen and twelve are published.

**Data impact:** none on guest data. The only regression risk is the JSON-LD: the field's single
consumer, `gf-seo-schema.php`, must be updated in the same change, or `amenityFeature` silently
emits `Array`.

## 6. UI / UX

Block order on a lodging page, top to bottom: hero → breadcrumb → **badge strip** → **L'essentiel**
→ **Équipements** → story and photos → booking drawer → FAQ.

- **Table rows:** 26 px icon in `#5a6b48`, label `.9rem/600` in `#2f3a26`, precision `.78rem` in
  `#6b7560`, 1 px bottom rule at 8 % black, 11 px vertical padding.
- **Columns:** `grid-template-columns:1fr` by default, `1fr 1fr` from a 600 px container, 36 px
  gutter. Row-major order, so reading left to right matches the source order.
- **Heading:** `Équipements`, unchanged. The `#f4f1ea` rounded box is kept — the block is now
  rendered by the shortcode, so the box is CSS (`.gf-eqt`, 820 px wide, 14 px radius) instead of a
  WordPress group written into the page.
- **Mobile (`xs`):** one column, full width, no horizontal scroll; the icon column keeps its 26 px
  so labels stay aligned.
- **Tablet (~900 px) / desktop (≥1200 px):** two columns inside the 920 px content width.
- **Copy:** French, taken verbatim from the current grid and from `gf-seo-facts.php`. No new
  commercial wording is introduced by this spec.
- **Sticky action bar:** not applicable — this is the public WordPress site, not a GuestFlow page.

The three candidate renderings were produced and arbitrated on the mockup
`docs/specs/2026-09-24-lodging-fact-zones.html`; "lignes à icône" was chosen on 2026-09-24. The
mockup keeps showing the *before* state alongside the proposal — that is what it is for, and it is
not updated as the code ships.

## 7. Test plan

### Server unit tests
None: no GuestFlow business logic is touched. `php -l` on each modified mu-plugin before copying
into the container.

### Manual verification — run on production on 2026-09-24
- [x] Both pages, three widths (390 px, 900 px, 1400 px): the table switches at 600 px of
      container width, no horizontal scroll on `xs`.
- [x] `curl -s https://domainesolio.com/la-granja/ | grep -c '<svg'` — the icons are in the HTML
      source, not added by JS. No script on either page draws an icon any more.
- [x] No fact appears twice: badge strip, L'essentiel and the table read end to end.
- [x] JSON-LD: `amenityFeature` lists all 14 amenities of La Granja and 12 of L'Estiva as
      `LocationFeatureSpecification`, the nine and seven visible ones named exactly as the table
      names them.
- [x] `/llms.txt` carries the same inventory, under each lodging.
- [x] `php:warn` log clean after the copy (see the WordPress container memory).
- [x] Regression: the badge strip, the booking drawer trigger and the FAQ still render.

## 8. Out of scope

- The badge strip's content and position (untouched).
- The hero, the photos, the narrative sections, the booking drawer, the FAQ.
- Any new icon: the set is the one already drawn in production, moved from JS to PHP.
- A separate "Sur le domaine" band — explicitly declined on 2026-09-24, domain facts stay in the
  lodging table.
- The domain page (`/le-domaine/`) and its own amenity list.
- An English version of the block (`specs/site-english-version.md` covers the site-wide question).

## 9. Open questions

None left.

### Resolved

- **2026-09-24 — The plancha is no longer conditional.** It used to be a gesture offered from two
  nights on, so it was said at the tariff and flagged invisible. It is now on site for every stay,
  which makes it a plain amenity: it becomes a visible row, "Plancha à disposition" with the
  barbecue icon, and L'Estiva's FAQ drops "offerte à partir de 2 nuits" for "à disposition à chaque
  séjour". The wording avoids "offerte", which promises a conditional gift — the very thing being
  removed.

- **2026-09-24 — The facts that only robots could see.** They stay published and gain
  `'visible' => false` (rule 10). Wood stove, table for 10–12, sunrise terrace, attic playroom and
  wood-fibre insulation for La Granja; safari tent on stilts and starry sky for L'Estiva — each of
  them is already said on the page, in the story or in the FAQ, where it
  reads better than in a list. The rejected outcome was a *second list* drifting away from the
  first; a flag on the single list cannot drift. L'Estiva's private bathroom and its absence of
  wifi take the same flag, for the same reason: the badges and « L'essentiel » already say them.
- **2026-09-24 — `/llms.txt`.** It gains the inventory, one indented line per amenity under each
  lodging (rule 11).
- **2026-09-24 — The `Gîtes de France 3 épis` badge.** Answered before this spec: it carries three
  stars in a row, the unit a rating is counted in (PR #590, shipped). No text chip.

- **2026-09-24 — Where does the amenity block go?** Directly under "L'essentiel", not in a
  restructured page. Three fuller layouts (numbers band, editorial sheet, folded inventory) were
  mocked up and declined: the ask is a move, not a redesign.
- **2026-09-24 — Which rendering?** Rows with one icon each, closest to what is already shipped.
- **2026-09-24 — How are the duplicates split?** Counters stay in the badge strip, services move to
  the table (rules 4–5).
- **2026-09-24 — Where do shared-domain facts go?** They stay in the lodging's table (rule 7).
- **2026-09-24 — Where does the `.gf-eqt` CSS live?** In `gf-seo-blocks.php`, with the other
  `[solio_*]` blocks it belongs to, rather than in `gf-site-style.php` as first planned. The site
  charter dresses the site; each block dresses itself.
