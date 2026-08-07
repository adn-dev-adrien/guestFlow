- Outillage de test client : `@testing-library/jest-dom` 6 → 7 et `jsdom` 25 → 30, sur vitest 4.
  Les 788 tests passent inchangés. En revanche **Vite 8 et `@vitejs/plugin-react` 6 sont écartés** :
  Vite 8 remplace esbuild par oxc comme transformeur, et ce dépôt fait tenir le JSX écrit dans des
  fichiers `.js` (convention héritée de CRA) par un bloc de config `esbuild` qu'oxc ignore — 82 des
  99 fichiers de tests cessaient de compiler. Il n'existe pas de réglage équivalent : `lang` est
  explicitement retiré des options oxc de Vite 8. C'est une migration à part entière, spécifiée dans
  `specs/vite-8-oxc-migration.md`, qui lèvera au passage l'avis de sécurité `esbuild`.
