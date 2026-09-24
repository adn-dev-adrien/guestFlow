# Site WordPress Domaine Solio — modules SEO / AEO

Copie de référence du code SEO installé sur le site vitrine WordPress (`domainesolio.com`).

> **Attention — ce dossier est une copie, pas la source qui tourne.**
> Depuis la migration Proxmox, le site s'exécute dans le conteneur Docker `wp_app` sur
> `192.168.0.23` (et non plus sur le Pi `192.168.0.196`), son unique source vivante étant le
> volume `soliowebsite_wp_data`. Il n'existe aucun déploiement automatique depuis ce dépôt.
> Toute modification doit être **recopiée dans le conteneur**, en sauvegardant d'abord la
> version en place :
>
> ```bash
> scp mu-plugins/gf-seo-head.php adrien@192.168.0.23:/tmp/gf-seo-head.php
> ssh adrien@192.168.0.23 'docker cp /tmp/gf-seo-head.php wp_app:/tmp/gf-seo-head.php \
>   && docker exec wp_app php -l /tmp/gf-seo-head.php'
> ssh adrien@192.168.0.23 'docker cp wp_app:/var/www/html/wp-content/mu-plugins/gf-seo-head.php /tmp/bak-gf-seo-head.php'
> ssh adrien@192.168.0.23 'docker cp /tmp/gf-seo-head.php wp_app:/var/www/html/wp-content/mu-plugins/gf-seo-head.php \
>   && docker exec wp_app chown www-data:www-data /var/www/html/wp-content/mu-plugins/gf-seo-head.php'
> ```
>
> Cette copie existe pour que le travail ne vive plus uniquement dans un volume Docker
> non sauvegardé par git.

## Principe

Le site doit être **entièrement lisible sans JavaScript**, par Google comme par les robots
d'IA (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) qui n'exécutent aucun script. Toute
information commercialement utile — capacité, équipements, horaires, règles, **tarifs** —
existe donc en HTML rendu par le serveur.

Une seule source de vérité : `gf-seo-facts.php`. L'encadré « L'essentiel » affiché, la FAQ
visible et le JSON-LD sont générés du même tableau. Ils ne peuvent pas diverger.

## Les modules

| Fichier | Rôle |
|---|---|
| `gf-seo-facts.php` | **Source de vérité.** Adresse, GPS, capacités, horaires, équipements, distances, FAQ. Lit les tarifs vivants dans GuestFlow (cache 6 h, repli statique). |
| `gf-seo-head.php` | `<title>` 50-60 car., meta description 140-155 car., Open Graph, Twitter Card, `hreflang`, geo. Table page → référencement, surchargeable par page. Le visuel de partage se replie sur la première `<img>` du contenu, ce qui couvre les bandeaux écrits en HTML brut. |
| `gf-seo-schema.php` | JSON-LD : `LodgingBusiness`, `VacationRental` / `Campground` + `Accommodation`, `FAQPage`, `BreadcrumbList`. Fil d'Ariane visible. La galerie du logement reprend chaque diapo du carrousel en `ImageObject`, légende comprise. |
| `gf-seo-blocks.php` | Codes courts rendus côté serveur : `[solio_essentiel]`, `[solio_tarifs]`, `[solio_tarifs_nuits]`, `[solio_prix]`, `[solio_caution]`, `[solio_surdemande]`, `[solio_faq]`, `[solio_geo]`, `[solio_comparatif]`. |
| `gf-seo-images.php` | Complète les `<img>` du contenu : `alt`, `width`/`height`, `srcset`, `loading`, `fetchpriority` sur l'image LCP. |
| `gf-seo-indexation.php` | `robots.txt` (12 robots autorisés nommément), sitemap nettoyé, `/llms.txt`. |
| `gf-seo-redirects.php` | 301 des anciennes URLs WordPress et des 18 URLs Lodgify. |
| `gf-seo-activites.php` | Type de contenu `activite` (fiches territoire) + champs structurés + `TouristAttraction`. |
| `gf-seo-perf.php` | `defer` sur les scripts non critiques, préchargement de la police, retrait des assets inutiles. |
| `gf-seo-admin.php` | Metabox d'édition du titre et de la description, bouton « Actualiser les tarifs ». |
| `gf-seo-reservation.php` | Déplace le moteur GuestFlow dans un tiroir latéral en deux écrans, ouvert par un bouton flottant en bas à droite. |
| `gf-seo-urls.php` | Garde-fou : toute adresse générée suit l'hôte réellement utilisé par le visiteur. |
| `gf-caps.php` | Pictogrammes des pastilles de capacité, injectés en JS — `wp_kses` retire tout `<svg>` du contenu enregistré depuis l'administration. Le classement porte **trois étoiles en rangée**, l'unité dans laquelle il se compte, et non une feuille. |
| `gf-site-style.php` | Charte « forêt et heure dorée » : polices Marcellus et Karla auto-hébergées, palette sapin/papier/ocre, boutons, en-tête, carrousels, FAQ. |
| `apache/uploads.htaccess` | Sert les jumeaux WebP par négociation de contenu. À déposer dans `wp-content/uploads/.htaccess`. |
| `apache/roboto.css` | Feuille de la police auto-hébergée. Va dans `wp-content/uploads/fonts/`. |
| `mu-plugins/gf-footer.php` | Style du pied de page « nuit » : manifeste, liens, mention légale, crédit ADN Dev. |
| `template-parts/footer.html` | Balisage du pied de page : contenu de la *template part* WordPress n° 86. |
| `brand/solio-logo-negatif.png` + `.webp` | Salamandre en négatif (ivoire vers ocre) pour le fond sombre du pied de page. Va dans `wp-content/uploads/brand/`. |

## La réservation

Le moteur GuestFlow n'est plus posé en bas de page. `gf-seo-reservation.php` l'intercepte au
rendu et le place dans un **tiroir latéral**, ouvert par un bouton flottant en bas à droite qui
suit le défilement. Le bloc n'est ni dupliqué ni modifié : c'est exactement le même moteur.

Le tiroir se parcourt en **deux écrans** : « Votre séjour » (dates, voyageurs et options, le
total se mettant à jour en direct) puis « Récapitulatif » (le détail chiffré, les coordonnées et
la case d'acceptation des CGV). Cette case appartient au plugin GuestFlow (≥ 1.8.0), qui l'envoie
avec la demande : GuestFlow horodate l'acceptation, garde la version acceptée, et refuse toute
demande qui ne la porte pas (`specs/terms-acceptance-record.md`). Le tiroir ne fait que l'habiller. Au retour de la page de paiement Qonto
(`?gf_payment=…`), le moteur reste dans la page plutôt que dans un tiroir fermé.

Deux détails qui comptent : le tiroir n'est jamais en `display:none` (il est décalé hors écran
par une transformation), sans quoi le calendrier se positionnerait mal à l'initialisation ; et
il porte l'attribut `inert` tant qu'il est fermé, pour rester hors de la navigation au clavier.

Un lien `href="#reserver"` ou un attribut `data-gf-reserver` posé n'importe où dans la page
ouvre le même tiroir — utile pour un bouton d'appel à l'action dans le corps du texte.

## Les conditions générales

Le texte des CGV s'écrit et se publie dans GuestFlow (Paramètres → Conditions générales), en
français et en anglais. La page `/cgv/` ne contient que le shortcode `[guestflow_cgv]` : elle affiche
la version en vigueur, ou une version précise avec `?v=N` (le lien de la case et du mail de
confirmation). Une version publiée ne change plus ; pour corriger une phrase, on publie la suivante.

## Où chaque information apparaît — une seule fois

La règle est qu'un fait ne soit affiché qu'à un endroit par page :

| Information | Seul endroit où elle figure |
|---|---|
| Capacité, chambres, lits, salles d'eau | les pastilles à icônes en haut de page (`gf-caps`) |
| Superficie, saison, horaires, animaux, bébés, bain nordique | l'encadré « L'essentiel » (le wifi n'y figure que lorsqu'il n'y en a pas) |
| Équipements détaillés | la grille de pictogrammes (`gf-amenities`) |
| Prix des options | la carte « à la carte » des deux pages de logement (`[solio_surdemande]`), via GuestFlow |
| Montant des cautions | `[solio_caution]`, lu dans les faits ; dans les CGV, `{{cautions}}`, lu dans GuestFlow (caution par défaut de chaque logement) — les deux doivent dire la même chose |
| Contexte géographique | uniquement les deux pages de logement et `/contact/` |
| Ce que montre chaque photo | la légende de la diapo, sous l'image du carrousel |

## Les pages

Le site tient en **sept pages** : l'accueil, les deux logements, Le Domaine, Autour de nous,
Accès & contact, et les CGV. Tout ce qui n'était pas dans le bandeau du haut a été retiré le
**2026-09-24** — `/reserver/`, `/faq/`, `/acces/`, `/disponibilites/` et quatre brouillons jamais
publiés — et chacune de ces URLs garde une redirection 301 dans `gf-seo-redirects.php` : une page
supprimée sans porte de sortie est un lien mort pour Google comme pour un visiteur qui a gardé
l'adresse.

Deux conséquences à connaître :

- **`/reserver/` était l'étape « lequel des deux ? »**. Les appels à l'action qui y menaient
  proposent désormais les deux logements côte à côte, vers `#reserver`, qui ouvre le tiroir.
- **La carte « À la carte » vivait là**, et c'était le seul endroit où le prix des options
  s'affichait. Elle est reprise sur les deux fiches logement, juste avant le moteur, sous l'ancre
  `#a-la-carte` vers laquelle pointent les anciennes URLs Lodgify `/fr/options` et `/en/options`.

## Les carrousels

Chaque diapo MetaSlider porte une **légende** (`post_excerpt` de la diapo), affichée sous la
photo plutôt qu'en bandeau sombre par-dessus : les diapos ne sont pas recadrées, un bandeau
absolu masquerait le bas de l'image. La légende est du texte rendu par le serveur, donc lue par
Google comme par les robots d'IA, et elle est reprise telle quelle dans le `ImageObject` du
JSON-LD. Le texte alternatif, lui, décrit la photo pour qui ne la voit pas — les deux ne disent
pas la même chose et ne doivent pas être copiés l'un sur l'autre.

## Le pied de page

Le balisage vit dans la *template part* n° 86 (un bloc HTML), le style dans `gf-footer.php`.

**Le crédit ADN Dev** coupe un filet sous la mention légale : l'hélice du logo ADN Dev, vectorisée
et passée dans le dégradé de la salamandre (lichen vers ocre), puis « Cousu main par ADN Dev ».
Le lien mène à `https://adn-dev.fr` dans un nouvel onglet, sans `nofollow`. Au survol l'hélice
fait un tour sur elle-même, sauf si le visiteur a demandé moins d'animations. L'hélice est un SVG
en ligne : aucune requête de plus, et le dégradé suit la palette.

**Le logo Solio est en négatif.** Le PNG d'origine n'a pas de transparence et formait un carré
blanc sur le fond de nuit ; le détourer ne suffit pas, le corps vert très sombre de la salamandre
disparaît alors dans le fond. `solio-logo.png` reste en place pour tout autre usage.

Sur téléphone, le pied de page réserve 104 px sous le crédit dès que la page porte le bouton
flottant « Réserver » (`.gf-resa-declencheur`), qui le masquait sinon.

Pour republier le balisage, il faut **couper le filtrage HTML de WordPress** : lancé en ligne de
commande, `wp_update_post` s'exécute sans utilisateur, donc sans le droit `unfiltered_html`, et
`kses` retire le SVG en silence.

```bash
scp template-parts/footer.html adrien@192.168.0.23:/tmp/footer.html
ssh adrien@192.168.0.23 'docker cp /tmp/footer.html wp_app:/tmp/footer.html \
  && docker exec wp_app php -r "require \"/var/www/html/wp-load.php\"; kses_remove_filters();
     wp_update_post([\"ID\" => 86, \"post_content\" => wp_slash(file_get_contents(\"/tmp/footer.html\"))]);"'
```

## Ce qui est intentionnellement absent

- **Pas de `Review` ni d'`AggregateRating`.** Les six avis Google connus portent une note de
  5 étoiles mais **aucun texte**. Marquer une note sans avis lisible sur la page serait à la
  fois contraire aux règles de Google et inutile pour les IA. Dès que des avis rédigés seront
  publiés sur le site, le nœud pourra être ajouté dans `gf-seo-schema.php`.
- **Pas de `<picture>` autour des images.** La conversion WebP passe par Apache, ce qui évite
  de restructurer le balisage des carrousels MetaSlider, qui est fragile.
- **Pas de plugin SEO tiers.** Un site de quinze pages entièrement piloté par des mu-plugins
  n'a pas besoin de Rank Math ni de SEOPress, et leurs assets pèseraient sur les Core Web Vitals.

## Régénérer les fichiers dérivés

```bash
# Jumeaux WebP après ajout de photos (idempotent : un jumeau à jour est laissé tel quel)
scp scripts/webp-twins.php adrien@192.168.0.23:/tmp/webp-twins.php
ssh adrien@192.168.0.23 'docker cp /tmp/webp-twins.php wp_app:/tmp/webp-twins.php \
  && docker exec wp_app php /tmp/webp-twins.php'

# Vider le cache des tarifs GuestFlow après un changement de prix
# (ou bouton « Actualiser les tarifs » dans la barre d'admin)
ssh adrien@192.168.0.23 'docker exec wp_app php -r "require \"/var/www/html/wp-load.php\"; gf_seo_purge_cache();"'
```
