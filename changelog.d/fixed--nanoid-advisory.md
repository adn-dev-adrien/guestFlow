- Sécurité : `nanoid` 3.3.17 → 3.3.18 côté client (GHSA-2v37-7h3g-55p8, gravité *high*) — un
  générateur personnalisé appelé avec une taille nulle pouvait boucler indéfiniment. La dépendance
  est transitive et purement outillage de build (`vite` → `postcss` → `nanoid`, marquée `dev`) :
  elle n'est pas embarquée dans le bundle servi aux navigateurs. Correctif verrouillage seul, sans
  changement de `package.json` ; `npm audit` du client repasse à **0** vulnérabilité. L'avis n'avait
  jamais été remonté par Dependabot parce que les **alertes de sécurité sont désactivées** sur le
  dépôt — seules les montées de version hebdomadaires tournent.
