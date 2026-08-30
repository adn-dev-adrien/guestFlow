# Bascule de domainesolio.com vers le site WordPress

Tout le travail SEO décrit dans le `README.md` est en place et vérifié, mais il n'est
**visible que depuis le réseau local**, sur `http://192.168.0.196:8080`.

`domainesolio.com` résout aujourd'hui vers Cloudflare (`162.159.128.68`) et sert toujours le
site Lodgify. Tant que ce n'est pas changé, ni Google ni les robots d'IA ne voient quoi que
ce soit du nouveau site : ni le `robots.txt`, ni le sitemap, ni `/llms.txt`, ni les 301.

Ce document liste ce qui reste à faire le jour de la bascule. **Aucune de ces opérations
n'est automatisable depuis le Pi : elles se font chez le registraire, chez Cloudflare et
dans la Search Console.**

---

## 1. Avant la bascule

- [ ] **Résilier ou geler Lodgify au bon moment.** Les 14 photos qui étaient hébergées chez
      eux ont déjà été rapatriées dans la médiathèque : le site ne dépend plus du CDN
      `l.icdbcdn.com`. Vérification : `grep -c icdbcdn` doit renvoyer 0 sur toutes les pages.
- [ ] **Rendre le Pi joignable depuis l'extérieur.** Il n'y a aujourd'hui ni proxy inverse ni
      tunnel. Deux options : un tunnel Cloudflare vers `192.168.0.196:8080`, ou une
      redirection de port avec un certificat Let's Encrypt. Le second impose une IP publique
      stable.
- [ ] **HTTPS obligatoire.** Le `wp-config.php` gère déjà `X-Forwarded-Proto` : les URL
      suivront automatiquement le schéma et l'hôte du visiteur, sans rien changer en base
      (correctif du 27 juillet 2026).
- [ ] **Relire les `TODO:` restants** (liste en fin de document) et compléter ce qui peut l'être.
- [ ] **Sauvegarde fraîche** : `~/wp-backups/` sur le Pi.

## 2. Le jour J

- [ ] Faire pointer `domainesolio.com` (et `www.domainesolio.com`) vers le nouveau site.
- [ ] Vérifier immédiatement, depuis l'extérieur du réseau local :
      - `https://domainesolio.com/robots.txt` — doit lister GPTBot, ClaudeBot, PerplexityBot,
        OAI-SearchBot, Google-Extended, Bingbot, Applebot-Extended.
      - `https://domainesolio.com/wp-sitemap.xml` — 15 pages, sans `/disponibilites/`.
      - `https://domainesolio.com/llms.txt` — résumé factuel du domaine.
      - Quelques 301 : `/fr/options`, `/fr/decouverte`, `/fr/contactez-nous`.
- [ ] Vérifier que le `<link rel="canonical">` et les `og:url` portent bien `https://` et le
      domaine public, sur trois pages au hasard.

## 3. Les redirections déjà programmées

`gf-seo-redirects.php` traite automatiquement, dès que le domaine pointe ici :

| Ancienne URL Lodgify | Destination |
|---|---|
| `/fr/domaine-solio---gite-confort-nature-animaux` | `/gite-10-personnes-ardeche/` |
| `/fr/domaine-solio---lodge-isolee-nature-animaux` | `/tente-safari-glamping-ardeche/` |
| `/fr/bien-preparer-votre-sejour` | `/faq/` |
| `/fr/toutes-les-proprietes` | `/tarifs-et-reservation/` |
| `/fr/options` | `/tarifs-et-reservation/` |
| `/fr/decouverte` | `/activites-autour-du-domaine/` |
| `/fr/contactez-nous` | `/contact/` |
| `/fr/vie-du-domaine` | `/le-domaine/` |
| les 9 URL `/en/…` | vers l'équivalent français, à réaffecter quand la version anglaise existera |

Les anciennes URL du WordPress lui-même (`/le-gite/`, `/aventura-lodge/`,
`/experiences-options/`, `/bien-preparer-votre-sejour/`, `/activites-autour/`,
`/hebergements/` et ses deux pages filles) redirigent également en 301.

**Un point à vérifier une fois en ligne :** la première entrée du sitemap (la page d'accueil)
provient d'un cache interne de Polylang, qui n'est reconstruit qu'au premier affichage. Si elle
affiche encore `http://` au lieu de `https://` après la bascule, il suffit de purger ce cache
une fois depuis une vraie requête HTTPS :
`docker exec wp_app php -r 'require "/var/www/html/wp-load.php"; delete_transient("pll_languages_list");'`
puis d'ouvrir une page du site. Toutes les autres adresses suivent déjà l'hôte du visiteur
(`gf-seo-urls.php`).

## 4. `lafermedesexperiences.fr`

**À faire chez le registraire de ce domaine, pas sur le Pi.** Le plus propre est une
redirection 301 au niveau DNS/hébergeur du domaine, de `lafermedesexperiences.fr` et
`www.lafermedesexperiences.fr` vers `https://domainesolio.com/`, en conservant le chemin.
Si l'hébergeur ne propose qu'une redirection sans conservation du chemin, viser la racine
suffit : ce domaine n'a pas de contenu indexé à préserver.

## 5. Après la bascule

- [ ] **Search Console** : ajouter la propriété `https://domainesolio.com`, soumettre le
      sitemap, demander l'indexation des cinq pages prioritaires (accueil, gîte, tente safari,
      privatisation, tarifs).
- [ ] **Bing Webmaster Tools** : même chose. Bing alimente aussi ChatGPT.
- [ ] **Google Business Profile** : vérifier que le lien du site pointe vers la nouvelle URL.
- [ ] Mettre à jour le lien du site sur **Facebook**, **Instagram**, **Gîtes de France** et
      les plateformes de réservation.
- [ ] Surveiller les 404 pendant deux semaines et compléter la table des 301 si nécessaire.

## 6. Version anglaise

Polylang est installé et configuré : français par défaut sans préfixe, anglais déclaré et
prêt à servir sous `/en/`. **Aucune traduction n'existe.** Les balises `hreflang` sont déjà
émises (auto-référence `fr-FR` + `x-default`) et s'enrichiront automatiquement de la version
anglaise dès qu'une page sera traduite : rien à modifier dans le code.

Pour traduire une page : la modifier dans l'admin, puis utiliser la colonne « English » de la
liste des pages.

## 7. Ce qui reste à compléter

**Tous les `TODO:` du contenu ont été comblés le 10 août 2026** avec les réponses d'Adrien.
Plus aucune page ne porte de mention à trous. Il ne reste que deux chantiers de fond, qui
demandent de la rédaction et non une décision :

| Où | Ce qui manque |
|---|---|
| Fiches `activite` | 20 fiches créées en brouillon, à rédiger et publier. Les champs structurés (distance, durée, période, lien officiel) se saisissent dans l'admin. |
| Avis clients | Aucun des 6 avis Google n'a de texte en base. Sans avis rédigé et publié sur le site, pas de balisage `Review` possible — c'est la dernière brique manquante du dispositif. |

**Accessibilité PMR :** aucun des deux hébergements n'est accessible aux personnes à mobilité
réduite, et les deux pages le disent. Un logement dédié PMR est à l'étude, à plusieurs années
d'échéance : il n'est **volontairement pas annoncé** sur le site. Annoncer une ouverture sans
date attire des demandes qu'on ne peut pas satisfaire ; la mention sera ajoutée quand le projet
aura un calendrier.

**Un chiffre à confirmer :** la page du lodge annonçait « 30 m² sous toile » et « plus de 80 m²
de terrasse ». Vos réponses du 10 août donnent 24 m² sous toile (sanitaires exclus, ils sont sur
la terrasse) et environ 50 m² de terrasse. Le site a été aligné sur **24 + 50**. Si la terrasse
fait bien 80 m², une seule valeur est à corriger dans `gf-seo-facts.php` (`terrasse_m2`) et une
phrase sur la page du lodge.

### Faits arrêtés le 10 août 2026

| Sujet | Décision |
|---|---|
| Caution du gîte | 500 € |
| Superficie du gîte | 180 m² sur trois niveaux, 60 m² par niveau |
| Superficie du lodge | 24 m² sous la tente + 50 m² de terrasse (salle d'eau et WC sur la terrasse) |
| Saison du lodge | de mai à septembre ; le gîte reste ouvert toute l'année |
| Bain nordique | eau chauffée autour de 38 °C |
| Accueil Cavalier | pré clôturé, point d'eau, foin fourni ; **pas de box** ; 10 € par cheval et par nuit |
| Gare | Saint-Vallier-sur-Rhône ; transfert possible sur demande, 50 € |
| Événements | séminaires acceptés, **mariages non** |
| Garde d'enfants | possible sur demande, tarif à convenir |
| Visuel de partage | chaque page utilise sa propre image de bandeau ; pas de visuel unique |

Conséquence repérée en remplissant ces faits : **la privatisation complète du domaine n'est
possible que de mai à septembre**, puisqu'elle suppose les deux hébergements. Une section
« Quand privatiser » le dit désormais explicitement sur la page concernée, et rappelle que le
gîte seul reste disponible le reste de l'année.

## 8. Points de vigilance repérés pendant le chantier

- **Une image de remplacement externe subsiste** sur `/tarifs-et-reservation/` :
  `https://picsum.photos/seed/solio17/800/600`. C'est un reste de la construction du site,
  qui tire une photo aléatoire chez un tiers à chaque affichage. À remplacer par une photo
  du domaine — c'est la seule image du site qui n'a ni texte alternatif ni contrôle éditorial.
- **Deux images sont des captures d'écran de sites tiers** :
  `itineraire-gr42-saint-etienne-satillieu` (page d'un site de randonnée) et
  `gastronomie-ardeche-assiette-dessert` (visuel Maisons Marcon). Elles portent des marques
  et du texte appartenant à d'autres : à remplacer par vos propres visuels, ou à retirer.

- **Deux images portent un filigrane de banque d'images** — `domaine-solio-ambiance-liberte-bras-ouverts`
  (mention iStock visible) et `domaine-solio-ambiance-detente-champ-de-fleurs`. À remplacer par
  des photos du domaine, pour la crédibilité comme pour le droit d'usage.
- **Une image est générée par IA** et porte la mention « Photo non contractuelle, générée par IA »
  (`domaine-solio-consigne-securite-incendie`). Acceptable pour une consigne de sécurité,
  à ne pas confondre avec une photo du domaine.
- **Le carrousel des pages hébergement pèse environ 1,5 Mo.** C'est le poste le plus lourd du
  site. Réduire la taille des images sources des diaporamas 187 et 195 (2048 px n'est pas utile)
  ferait gagner beaucoup, sans toucher au code.
