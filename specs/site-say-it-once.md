# Site — say each fact once

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/site-trim-duplicate-content` |
| **Created** | 2026-09-24 |
| **Author** | Adrien |
| **Related PR** | #593 for the code; the site itself was deployed on 2026-09-24 (§7 bis) |

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
   > **Sans test** — contenu de pages WordPress, stocké dans le conteneur `wp_app` et hors de ce
   >   dépôt ; vérifié par `curl … | grep -c 'gf-carte'` sur les deux pages en ligne (§7).

2. Consequence accepted on 2026-09-24: option prices are no longer server-rendered, so a robot that
   does not run JavaScript no longer reads them. The drawer remains the authoritative, live price —
   the removed card was a frozen copy of it.
   > **Sans test** — constat de conception, pas un comportement : rien à exécuter. La contrepartie
   >   est écrite ici pour qu'on ne la redécouvre pas plus tard.

3. The Lodgify redirects `/fr/options` and `/en/options`, which pointed at the now-absent anchor
   `/la-granja/#a-la-carte`, point at `/la-granja/#reserver`, which opens the drawer.
   > **Sans test** — table de redirections des mu-plugins Solio, déployés à la main hors de ce
   >   dépôt ; vérifiée par `curl -sI https://domainesolio.com/fr/options` (§7).

4. `[solio_geo]` is removed from `/le-domaine/` and from `/contact/`, so it is no longer placed on
   any page. The shortcode itself stays registered and documented: re-placing it is one edit.
   > **Sans test** — contenu de pages WordPress, hors de ce dépôt ; vérifié par
   >   `curl … | grep -c 'gf-geo"'` sur `/le-domaine/` et `/contact/` (§7).

5. Nothing is lost for the robots by rule 4: `gf-seo-indexation.php` already serves the same
   `gf_seo_distances()` list in `/llms.txt`, and `/contact/` still states the address and the GPS
   point in its contact card, in its prose and in its FAQ.
   > **Sans test** — code PHP des mu-plugins du site Solio, hors des suites JS de ce dépôt ;
   >   vérifié en lisant `/llms.txt` et la page `/contact/` en ligne.

6. The FAQ entry « Y a-t-il un tarif dégressif ? » is removed from the `privatisation` set.
   Because `gf-seo-schema.php` reads the same array, it leaves the visible FAQ and the `FAQPage`
   JSON-LD at the same time — they cannot diverge.
   > **Sans test** — code PHP des mu-plugins du site Solio, hors des suites JS de ce dépôt ;
   >   vérifié sur la page rendue et sur son JSON-LD `FAQPage` (§7).

7. On `/contact/`, the arbitration was between the three layers that say the same thing. The FAQ is
   kept because it is what `FAQPage` markup quotes; the prose is kept because it is the page a
   human reads; the geo block is the one that goes (rule 4).
   > **Sans test** — arbitrage éditorial tranché le 2026-09-24, pas un comportement exécutable.

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

Run on 2026-09-24, once the container had actually received the change (see § Deployment).

- [x] `/la-granja/` and `/estiva/` render no `#a-la-carte` section and no `gf-carte` card.
- [x] `/le-domaine/` and `/contact/` render no `gf-geo` block; « Où sommes-nous ? » is gone from both.
- [x] `/fr/options` lands on `/la-granja/`, and the redirect table now points at `/la-granja/#reserver`.
- [x] `/le-domaine/` shows 17 questions, and « Y a-t-il un tarif dégressif ? » is absent from the
      page and from the `privatisation` array that feeds both the visible FAQ and the `FAQPage`
      JSON-LD. The « Tarifs dégressifs dès 3 nuits » sentence in the privatisation prose stays: it
      is a quote request for a group, not the nightly price, and §8 keeps that wording.
- [x] The booking drawer still opens on both lodging pages and still lists the options with their
      prices (bain nordique, petit-déjeuner, panier, ménage, linge, apéro — from 3,00 € to 80,00 €),
      driven by Playwright against the live site.
- [x] `php -l` clean on `gf-seo-redirects.php` in the container, and `docker logs wp_app` carries no
      warning, error or fatal after the change.

## 7 bis. Deployment

The code half of this spec merged as PR #593, but **nothing had reached the site**: measured on
2026-09-24, all four pages still carried their blocks and the redirect table still pointed at the
dead anchor. Merging a spec that edits WordPress content deploys nothing by itself — the pages live
only in the `wp_app` container, and the mu-plugins are copied there by hand.

Applied to `192.168.0.23` on 2026-09-24, each target backed up first:

| Target | Change | Backup |
|---|---|---|
| pages 68, 69 | `wp:html` section `#a-la-carte` + `[solio_surdemande]` removed | `/tmp/bak-page-68-20260924-114203.txt`, `/tmp/bak-page-69-20260924-114203.txt` |
| pages 317, 87 | `[solio_geo]` removed | `/tmp/bak-page-317-20260924-115345.txt`, `/tmp/bak-page-87-20260924-115345.txt` |
| `gf-seo-redirects.php` | the two `/la-granja/#a-la-carte` retargeted to `/la-granja/#reserver` | `/tmp/bak-gf-seo-redirects-*.php` |

`gf-seo-facts.php` was **not** copied. The container's copy is `origin/master` plus the still-open
plancha change of PR #595; pushing the repository's copy over it would have reverted that work. A
whole-file copy is the wrong tool when another change is already live in the container — the two
redirect lines were changed in place instead, and the file is now identical to `origin/master`.

## 8. Out of scope

- Removing the `[solio_surdemande]` and `[solio_geo]` shortcodes from `gf-seo-blocks.php`. They are
  an editor-facing API, not dead code, and re-placing either is one edit.
- The « dégressif » wording elsewhere: the lodging FAQs, `[solio_tarifs_nuits]` and the meta
  descriptions keep it, because that is now its single home.
- `specs/site-lodging-fact-zones.md`, which rearranges the *fact* blocks of the same two pages and
  shipped as PR #592 while this one was open. The two changes touch different blocks; the only
  overlap is the `gf-seo-blocks.php` row of the site README, resolved by keeping both statements.
- The English version of any of this (`specs/site-english-version.md`).

## 9. Open questions

None. The one arbitration — which of the three layers on `/contact/` to drop — was settled on
2026-09-24: the geo block.
