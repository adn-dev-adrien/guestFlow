- CI : **Dependabot** surveille désormais les trois manifestes npm (racine, `server/`, `client/`) plus
  les actions GitHub des workflows. Les patchs et mineures arrivent **groupés** en une PR par dossier
  et par semaine (lundi matin) ; chaque **majeure arrive seule**, parce qu'elle se valide au cas par
  cas — rupture d'API, module natif recompilé sur le Pi, outillage de test. Mis en place après
  l'incident du 2026-08-06 où un retard sur `better-sqlite3` (`^11` alors que la 13.x était publiée)
  a transformé un simple patch de Node en panne de CI, et où l'audit a révélé 8 failles « high »
  dormantes.
