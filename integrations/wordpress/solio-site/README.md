# Site WordPress Domaine Solio — modules SEO / AEO

Copie de référence du code SEO installé sur le site vitrine WordPress (`domainesolio.com`).

> **Attention — ce dossier est une copie, pas la source qui tourne.**
> Le site s'exécute dans le conteneur Docker `wp_app` sur le Pi `192.168.0.196`, et son
> unique source vivante est le volume `soliowebsite_wp_data`. Il n'existe aucun déploiement
> automatique depuis ce dépôt. Toute modification doit être **recopiée dans le conteneur** :
>
> ```bash
> ssh pi@192.168.0.196 "docker exec -i wp_app sh -c 'cat > /tmp/gf-seo-head.php'" < mu-plugins/gf-seo-head.php
> ssh pi@192.168.0.196 'docker exec wp_app php -l /tmp/gf-seo-head.php \
>   && docker exec wp_app sh -c "cp /tmp/gf-seo-head.php /var/www/html/wp-content/mu-plugins/ \
>   && chown www-data:www-data /var/www/html/wp-content/mu-plugins/gf-seo-head.php"'
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
| `gf-seo-head.php` | `<title>` 50-60 car., meta description 140-155 car., Open Graph, Twitter Card, `hreflang`, geo. Table page → référencement, surchargeable par page. |
| `gf-seo-schema.php` | JSON-LD : `LodgingBusiness`, `VacationRental` / `Campground` + `Accommodation`, `FAQPage`, `BreadcrumbList`. Fil d'Ariane visible. |
| `gf-seo-blocks.php` | Codes courts rendus côté serveur : `[solio_essentiel]`, `[solio_tarifs]`, `[solio_faq]`, `[solio_geo]`, `[solio_comparatif]`. |
| `gf-seo-images.php` | Complète les `<img>` du contenu : `alt`, `width`/`height`, `srcset`, `loading`, `fetchpriority` sur l'image LCP. |
| `gf-seo-indexation.php` | `robots.txt` (12 robots autorisés nommément), sitemap nettoyé, `/llms.txt`. |
| `gf-seo-redirects.php` | 301 des anciennes URLs WordPress et des 18 URLs Lodgify. |
| `gf-seo-activites.php` | Type de contenu `activite` (fiches territoire) + champs structurés + `TouristAttraction`. |
| `gf-seo-perf.php` | `defer` sur les scripts non critiques, préchargement de la police, retrait des assets inutiles. |
| `gf-seo-admin.php` | Metabox d'édition du titre et de la description, bouton « Actualiser les tarifs ». |
| `gf-seo-reservation.php` | Déplace le moteur GuestFlow dans un tiroir latéral, ouvert par un bouton flottant en bas à droite. |
| `gf-seo-urls.php` | Garde-fou : toute adresse générée suit l'hôte réellement utilisé par le visiteur. |
| `apache/uploads.htaccess` | Sert les jumeaux WebP par négociation de contenu. À déposer dans `wp-content/uploads/.htaccess`. |
| `apache/roboto.css` | Feuille de la police auto-hébergée. Va dans `wp-content/uploads/fonts/`. |

## La réservation

Le moteur GuestFlow n'est plus posé en bas de page. `gf-seo-reservation.php` l'intercepte au
rendu et le place dans un **tiroir latéral**, ouvert par un bouton flottant en bas à droite qui
suit le défilement. Le bloc n'est ni dupliqué ni modifié : c'est exactement le même moteur.

Deux détails qui comptent : le tiroir n'est jamais en `display:none` (il est décalé hors écran
par une transformation), sans quoi le calendrier se positionnerait mal à l'initialisation ; et
il porte l'attribut `inert` tant qu'il est fermé, pour rester hors de la navigation au clavier.

Un lien `href="#reserver"` ou un attribut `data-gf-reserver` posé n'importe où dans la page
ouvre le même tiroir — utile pour un bouton d'appel à l'action dans le corps du texte.

## Où chaque information apparaît — une seule fois

La règle est qu'un fait ne soit affiché qu'à un endroit par page :

| Information | Seul endroit où elle figure |
|---|---|
| Capacité, chambres, lits, salles d'eau | les pastilles à icônes en haut de page (`gf-caps`) |
| Superficie, saison, horaires, wifi, animaux, caution, tarif de départ | l'encadré « L'essentiel » |
| Équipements détaillés | la grille de pictogrammes (`gf-amenities`) |
| Prix des options et des animations | la page `/tarifs-et-reservation/`, via GuestFlow |
| Contexte géographique | uniquement les deux pages de logement et `/acces/` |

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
# Jumeaux WebP après ajout de photos (idempotent, ignore ce qui existe déjà)
ssh pi@192.168.0.196 'docker exec wp_app php /tmp/lot7c.php'

# Vider le cache des tarifs GuestFlow après un changement de prix
# (ou bouton « Actualiser les tarifs » dans la barre d'admin)
ssh pi@192.168.0.196 'docker exec wp_app php -r "require \"/var/www/html/wp-load.php\"; gf_seo_purge_cache();"'
```
