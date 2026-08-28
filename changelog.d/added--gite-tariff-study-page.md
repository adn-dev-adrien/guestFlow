- **Le compte rendu de l'étude tarifaire du Gîte** (`docs/tarifs/2026-08-25-gite-etude-tarifaire.html`,
  2026-08-25) : une page auto-portante, au format des comptes rendus de déploiement de la Lodge, qui
  montre ce que l'ancienne grille disait vraiment, le calendrier redit en règles, le pivot net, la
  grille par canal, les 24 séjours 2026 retarifés et les réserves à lever. Elle est fabriquée par un
  générateur — `.claude/skills/tariff-recipe/build-study-page.mjs` — qui ne reçoit que des faits
  observés et recalcule tout le reste depuis le fichier de recette : les 22 contrôles arithmétiques
  s'affichent en bas de la page, et un seul en échec la barre en rouge avec un code de sortie 2.
