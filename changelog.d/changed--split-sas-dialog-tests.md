- **Les tests du SAS sont découpés par sujet** (interne, CLAUDE.md §9). `ReservationSasDialog.test.jsx`
  concentrait 65 tests et 1 846 lignes couvrant huit specs, et chaque feature ajoutait ses cas à la
  fin : deux branches parallèles y sont entrées en conflit le 2026-08-30 sur des tests pourtant
  indépendants. La suite est désormais éclatée en neuf fichiers `ReservationSasDialog.<sujet>.test.jsx`
  avec leurs fixtures communes dans `__tests__/sasFixtures.jsx` — le même principe que `changelog.d/`,
  et ce que le serveur fait déjà (un fichier de test par spec). Aucun test ajouté ni retiré.
