- CI : le workflow **« Unit tests »** est désormais lançable à la main (`workflow_dispatch`, avec une
  entrée `ref` optionnelle) — `gh workflow run "Unit tests" --ref <branche>`. Ajouté après un
  incident du 2026-08-06 où le job `client (vitest)` n'a obtenu aucun runner GitHub sur trois
  tentatives consécutives (aucune étape exécutée, tué par le délai de 15 min) alors que le job voisin
  et le workflow E2E tournaient normalement : relancer le job retombait dans la même file affamée, et
  sans déclencheur manuel le seul recours était un commit vide.
