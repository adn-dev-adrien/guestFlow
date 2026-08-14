# Comptes rendus de déploiement tarifaire

Chaque fichier `AAAA-MM-JJ-<hébergement>-verification.html` est le compte rendu d'un déploiement de
la grille tarifaire vers les plateformes de réservation : les devis relevés côté client, leur
recalcul depuis les règles, et le net après commission comparé à la cible de la recette.

Les pages sont **auto-portantes** — polices et captures sont embarquées en data-URI, aucune requête
réseau à l'ouverture. Elles s'ouvrent directement dans un navigateur, y compris hors ligne.

## Pourquoi les archiver ici

La recette (`server/src/recipes/*.json`) dit ce que GuestFlow facture. Le compte rendu dit ce que
les plateformes facturaient réellement à une date donnée, preuves à l'appui. C'est la seule trace
de l'état des canaux à un instant T, et le point de comparaison quand un prix semble avoir dérivé.

## Comment en produire un

Le procédé complet est le skill `.claude/skills/platform-tariff-rollout/` : dériver la grille depuis
la recette, arbitrer les ambiguïtés, relever l'existant, configurer, prouver par devis, publier.
La page se fabrique avec :

```bash
node .claude/skills/platform-tariff-rollout/build-verification-page.mjs cases.json ./captures sortie.html
```

`cases.json` ne déclare que les **entrées** (prix de saison, nuits, remise, total observé) ; tout le
reste est recalculé, et un écart entre le calcul et le devis relevé est signalé en rouge dans la
page avec un code de sortie 2. La page doit pouvoir contredire celui qui l'a produite.

## Historique

| Date | Hébergement | Objet |
|---|---|---|
| 2026-08-14 | Aventura Lodge | Nouvelle grille (remises par durée, tarif 2 personnes + supplément) déployée sur Lodgify, GreenGo et Abracadaroom ; saisons 2027 ; fenêtre de réservation et prix forcés corrigés. |
