- Serveur : montée d'**express 4 → 5**, dernière majeure en retard. Aucune route ni aucun contrôleur
  n'a été touché : l'analyse d'impact préalable a montré qu'aucune des sept ruptures documentées
  (mutation de `req.query`, wildcards de routes, `res.send(status)`, `app.del`, `req.param`,
  `res.sendfile`, `redirect('back')`) n'existait dans le dépôt. 2364 tests serveur et 45 E2E verts,
  inchangés.
- Serveur : **nouveau middleware d'erreur global**, ajouté avec express 5. La v5 achemine désormais le
  rejet d'une promesse d'un handler asynchrone vers ce middleware, là où la v4 le laissait s'échapper
  en `unhandledRejection` — **la requête restait alors suspendue, sans réponse**. Le client reçoit un
  500 JSON stable ; le détail (chemin de fichier, fragment SQL, jeton) est journalisé côté serveur et
  **jamais renvoyé**. Une erreur portant un `status` valide le conserve. 5 tests dédiés.
  Voir `specs/express-5-upgrade.md`.
