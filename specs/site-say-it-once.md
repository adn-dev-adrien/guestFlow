# Site — say each fact once

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/site-trim-duplicate-content` |
| **Created** | 2026-09-24 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

`integrations/wordpress/solio-site/README.md` states the site's own rule: *« un fait ne soit
affiché qu'à un endroit par page »*. Measured against the live site on 2026-09-24, four blocks
break it.

| Block | Where | What it repeats |
|---|---|---|
| `#a-la-carte` section + `[solio_surdemande]` | `/la-granja/`, `/estiva/` | The option prices the booking drawer already lists, option by option, at the moment the visitor chooses them. |
| `[solio_geo]` « Où sommes-nous ? » | `/le-domaine/` | The surroundings and distances that `/autour-de-nous/` is the page for. It is also outside the README's own placement rule, which named the lodging pages and `/contact/`. |
| `[solio_geo]` « Où sommes-nous ? » | `/contact/` | A third copy of the address, the GPS point and the distances, after the contact cards and the prose, and before the FAQ says them a fourth time. |
| FAQ « Y a-t-il un tarif dégressif ? » | `/le-domaine/` (`privatisation`) | The two lodging FAQs already answer « Combien coûte une nuit ? » with *« dégressif dès 3 nuits »*, and `[solio_tarifs_nuits]` prints the same note under the price table. |

## 2. Goal

Each of those facts survives in exactly one place, chosen for who reads it there, and nothing that
only the removed blocks carried is lost to a search engine or an assistant.

## 3. Functional rules

1. The `#a-la-carte` section and `[solio_surdemande]` are removed from both lodging pages. Option
   prices then live **only** in the booking drawer.
2. Consequence accepted on 2026-09-24: option prices are no longer server-rendered, so a robot that
   does not run JavaScript no longer reads them. The drawer remains the authoritative, live price —
   the removed card was a frozen copy of it.
3. The Lodgify redirects `/fr/options` and `/en/options`, which pointed at the now-absent anchor
   `/la-granja/#a-la-carte`, point at `/la-granja/#reserver`, which opens the drawer.
4. `[solio_geo]` is removed from `/le-domaine/` and from `/contact/`, so it is no longer placed on
   any page. The shortcode itself stays registered and documented: re-placing it is one edit.
5. Nothing is lost for the robots by rule 4: `gf-seo-indexation.php` already serves the same
   `gf_seo_distances()` list in `/llms.txt`, and `/contact/` still states the address and the GPS
   point in its contact card, in its prose and in its FAQ.
6. The FAQ entry « Y a-t-il un tarif dégressif ? » is removed from the `privatisation` set.
   Because `gf-seo-schema.php` reads the same array, it leaves the visible FAQ and the `FAQPage`
   JSON-LD at the same time — they cannot diverge.
7. On `/contact/`, the arbitration was between the three layers that say the same thing. The FAQ is
   kept because it is what `FAQPage` markup quotes; the prose is kept because it is the page a
   human reads; the geo block is the one that goes (rule 4).

## 4. Architecture

Both halves of the site are touched: the versioned mu-plugins, and the page content that lives only
in the WordPress database.

### 4.1 Server side (`server/src/`)

Untouched. No GuestFlow endpoint, model or task takes part.

### 4.2 Site side (`integrations/wordpress/solio-site/`)

| File | Change |
|---|---|
| `mu-plugins/gf-seo-facts.php` | Drops the « Y a-t-il un tarif dégressif ? » entry from the `privatisation` FAQ. Single source, so the visible FAQ and the JSON-LD follow. |
| `mu-plugins/gf-seo-redirects.php` | `/fr/options` and `/en/options` retargeted from `/la-granja/#a-la-carte` to `/la-granja/#reserver`. |
| `README.md` | The « Où chaque information apparaît » table records the new single home of the option prices and of the geographic context; the shortcode inventory notes that `[solio_surdemande]` and `[solio_geo]` are no longer placed. |

### 4.3 WordPress content (container `wp_app`, host `192.168.0.23`)

Not versioned — applied by script, each page's previous content written to `/tmp/bak-page-<ID>-<stamp>.txt`
in the container first.

| Page | ID | Removed |
|---|---|---|
| `/la-granja/` | 68 | `wp:html` section `#a-la-carte`, `[solio_surdemande]` |
| `/estiva/` | 69 | `wp:html` section `#a-la-carte`, `[solio_surdemande]` |
| `/le-domaine/` | 317 | `[solio_geo]` |
| `/contact/` | 87 | `[solio_geo]` |

`kses_remove_filters()` is required: run from the CLI, `wp_update_post` has no user and therefore no
`unfiltered_html`, and `kses` would strip the raw HTML of the `wp:html` blocks in silence.

### 4.4 API contract

Unchanged.

## 5. Data model

No schema change, no guest data touched.

## 6. UI / UX

- **Lodging pages:** the block order becomes hero → breadcrumb → badge strip → L'essentiel →
  Équipements → story and photos → *« Choisissez vos dates… »* → booking drawer → FAQ. The card of
  option prices that sat before the drawer is gone.
- **`/le-domaine/`:** ends on its three FAQ sets, with no geographic block between the narrative and
  them.
- **`/contact/`:** contact cards → prose (En voiture, En train, Se garer, Les courses) → FAQ. One
  heading level less between the prose and the questions.
- **Mobile:** nothing gained or lost — every removed block was full-width and stacked already.
- **Copy:** no new wording. This spec only deletes.

## 7. Test plan

### Server unit tests

None: no GuestFlow business logic is touched. `php -l` on each modified mu-plugin before copying it
into the container.

### Manual verification

- [ ] `curl -s https://domainesolio.com/la-granja/ | grep -c 'gf-carte'` → `0`, same on `/estiva/`.
- [ ] `curl -s https://domainesolio.com/le-domaine/ | grep -c 'gf-geo"'` → `0`, same on `/contact/`.
- [ ] `curl -sI https://domainesolio.com/fr/options` → `301` to `/la-granja/#reserver`.
- [ ] `/le-domaine/` shows 17 questions, and « Y a-t-il un tarif dégressif ? » is absent from the
      page and from its `FAQPage` JSON-LD.
- [ ] The booking drawer still opens on both lodging pages and still lists the options with prices.
- [ ] `php:warn` log clean after the copy (see the WordPress container memory).

## 8. Out of scope

- Removing the `[solio_surdemande]` and `[solio_geo]` shortcodes from `gf-seo-blocks.php`. They are
  an editor-facing API, not dead code, and re-placing either is one edit.
- The « dégressif » wording elsewhere: the lodging FAQs, `[solio_tarifs_nuits]` and the meta
  descriptions keep it, because that is now its single home.
- `specs/site-lodging-fact-zones.md`, which rearranges the *fact* blocks of the same two pages and
  is still Approved-not-implemented. The two changes touch different blocks.
- The English version of any of this (`specs/site-english-version.md`).

## 9. Open questions

None. The one arbitration — which of the three layers on `/contact/` to drop — was settled on
2026-09-24: the geo block.
