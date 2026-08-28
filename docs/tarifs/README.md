# Comptes rendus tarifaires

Deux types de page, un fichier par événement, nommé `AAAA-MM-JJ-<hébergement>-<type>.html`.

**`-verification`** — le compte rendu d'un **déploiement** de la grille vers les plateformes de
réservation : les devis relevés côté client, leur recalcul depuis les règles, et le net après
commission comparé à la cible de la recette.

**`-etude-tarifaire`** — le compte rendu de **l'étude** qui a produit une recette, avant tout
déploiement : ce que l'ancienne grille disait vraiment, le calendrier redit en règles, le pivot net,
et le contrôle iso-tarif sur les séjours déjà au planning. La preuve y est arithmétique là où la
page de vérification apporte des captures.

Les pages sont **auto-portantes** — polices et captures sont embarquées en data-URI, aucune requête
réseau à l'ouverture. Elles s'ouvrent directement dans un navigateur, y compris hors ligne.

## Pourquoi les archiver ici

La recette (`server/src/recipes/*.json`) dit ce que GuestFlow facture. Le compte rendu dit ce que
les plateformes facturaient réellement à une date donnée, preuves à l'appui. C'est la seule trace
de l'état des canaux à un instant T, et le point de comparaison quand un prix semble avoir dérivé.

## Comment en produire un

Le procédé de déploiement est le skill `.claude/skills/platform-tariff-rollout/` : dériver la grille
depuis la recette, arbitrer les ambiguïtés, relever l'existant, configurer, prouver par devis,
publier. Celui de l'étude est `.claude/skills/tariff-recipe/`. Les deux pages se fabriquent avec :

```bash
node .claude/skills/platform-tariff-rollout/build-verification-page.mjs cases.json ./captures sortie.html
node .claude/skills/tariff-recipe/build-study-page.mjs entrees.json server/src/recipes/<id>.json sortie.html
```

Même règle d'or des deux côtés : le fichier d'entrées ne déclare que des **faits observés** (prix de
saison, nuits, remise, total relevé ; ou la grille en base, les séjours au planning, les
commissions) ; tout le reste est recalculé, et un écart est signalé en rouge dans la page avec un
code de sortie 2. La page doit pouvoir contredire celui qui l'a produite.

## Historique

| Date | Hébergement | Objet |
|---|---|---|
| 2026-08-14 | Aventura Lodge | **Déploiement.** Nouvelle grille (remises par durée, tarif 2 personnes + supplément) déployée sur Lodgify, GreenGo et Abracadaroom ; saisons 2027 ; fenêtre de réservation et prix forcés corrigés. |
| 2026-08-25 | Gîte | **Étude.** Démontage de la grille peinte à la main (« la semaine vaut quatre nuits »), très haute saison incohérente rétablie, calendrier redit en règles, saison Nouvel An, ponts fériés plafonnés, pivot net à 5 %. Aucun déploiement : deux réserves à lever d'abord. |
| 2026-08-28 | Gîte | **Étude, révision.** Même page, même lien. Le propriétaire sort les relevés de canaux des fêtes 2025 — la seule preuve qui existe, GuestFlow ne contenant rien avant 2026. Réveillon arbitré à 750 € la nuit, à plat, sur trois nuits ; Noël maintenu en Haute ; L'Ardéchoise ajoutée ; la commission Gîtes de France élucidée par un contrat. |
