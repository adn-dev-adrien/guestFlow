- Outillage client : passage à **Vite 8** (+ `@vitejs/plugin-react` 6, indissociable). Vite 8 remplace
  esbuild par oxc **et** rollup par rolldown, et tous deux décident du JSX par l'extension du fichier
  — aucun réglage ne permet plus de parser du JSX dans un `.js`. Les **212 fichiers** qui en
  contenaient sont donc renommés en `.jsx` (`git mv`, l'historique suit) ; les 53 fichiers de pur JS
  restent en `.js`. Le seul chemin corrigé à la main est l'entrée `index.html`, la résolution
  d'extension ne s'appliquant pas au HTML. Gain mesuré : **build en 320 ms contre 2,74 s**, pour un
  bundle de taille identique. 788 tests client, 45 E2E et quatre écrans vérifiés à l'identique, sans
  erreur console. Voir `specs/vite-8-oxc-migration.md`.
