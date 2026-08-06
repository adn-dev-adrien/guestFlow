- `options` gagne deux colonnes : `category` (libellé de regroupement, `''` = aucun) et `seedKey`
  (identité stable des articles seedés, pour qu'un renommage ne crée pas de doublon au redémarrage).
  Ajout idempotent au boot, valeur par défaut `''` sur les lignes existantes — aucun impact sur
  l'affichage des options déjà en place.
- Migration one-shot `option_categories_v1` : les 5 options « Animation… » passent en catégorie
  `Animations`, « Le repas des trappeurs » en `Restauration`. Les options portant déjà une catégorie
  ne sont pas touchées. Aucune réservation, aucun prix, aucun total n'est modifié.
