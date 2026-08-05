- Suite E2E : couverture du rôle « Accueil » (7 specs Playwright) — la fenêtre d'édition du jour
  (SAS actif aujourd'hui, verrouillé hier / demain / déjà validé, refus serveur avec motif) et le
  confinement du rôle (routes interdites redirigées, aucune donnée financière ni PII client dans les
  payloads, appels hors périmètre en 403). La suite sait désormais jouer un scénario sous un compte
  non-admin : `seed-e2e.js` crée un compte accueil et `global-setup.js` capture une seconde session.
