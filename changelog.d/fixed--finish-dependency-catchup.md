- Dépendances : les **trois paquets sont désormais à `0 vulnérabilité`** et sans majeure en retard.
  Les deux derniers avis ouverts sont levés — `esbuild` 0.27.7 → **0.28.1** (aucune montée de Vite
  n'était nécessaire : la 0.28 était déjà dans la plage `^0.27.0 || ^0.28.0` déclarée par Vite 8, npm
  avait simplement conservé la version présente), et **`react-router-dom` 7 → `react-router` 8.3.0**,
  ce qui clôt l'avis CSRF en mode RSC. En v8 le paquet `-dom` n'est plus publié, tout étant fusionné
  dans `react-router` : les imports de 61 fichiers ont été réécrits, sans autre changement — les 11
  symboles utilisés (`useNavigate`, `useLocation`, `useSearchParams`, `useParams`, `Routes`, `Route`,
  `Link`, `Navigate`, `BrowserRouter`, `MemoryRouter`) portent les mêmes noms. Complété par
  `googleapis` 174.0.1 et `concurrently` 10. 2364 tests serveur, 788 client et 45 E2E verts,
  inchangés ; navigation vérifiée dans le navigateur (URL profonde avec paramètres, lien, paramètres
  de recherche, retour arrière).
