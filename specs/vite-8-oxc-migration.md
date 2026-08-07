# Vite 8 — migrer du transformeur esbuild à oxc

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `chore/vite-8-oxc-migration` _(user-managed)_ |
| **Created** | 2026-08-07 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

La remise à niveau des dépendances du 2026-08-07 a monté toute la chaîne d'outillage client sauf un
couple : **`vite` 7 → 8** et **`@vitejs/plugin-react` 4 → 6**. Ces deux-là sont indissociables —
`@vitejs/plugin-react@6` déclare `peerDependencies: { vite: "^8.0.0" }`.

La montée a été tentée puis **écartée** : 82 des 99 fichiers de tests ont cessé de se transformer.

```
Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored.
The following esbuild options were set: { loader: 'jsx', include: /src\/.*\.jsx?$/, exclude: [] }

[PARSE_ERROR] Unexpected JSX expression
  Help: JSX syntax is disabled and should be enabled via the parser options
  Plugin: vite:oxc
```

**Vite 8 a remplacé esbuild par oxc** comme transformeur interne. Or ce dépôt a délibérément conservé
la convention CRA — **du JSX à l'intérieur de fichiers `.js`** — et la fait tenir par un bloc
`esbuild` présent en double, dans [vite.config.js](../client/vite.config.js) et
[vitest.config.js](../client/vitest.config.js) :

```js
esbuild: { loader: 'jsx', include: /src\/.*\.jsx?$/, exclude: [] },
optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
```

Sous Vite 8 ce bloc est **ignoré**, et il n'existe pas d'équivalent direct : dans les types de Vite 8,
`OxcOptions` est déclaré `Omit<TransformOptions, "cwd" | "sourceType" | "lang" | …>` — **`lang` est
explicitement retiré**, c'est-à-dire précisément le réglage qui dirait à oxc de parser un `.js`
comme du JSX.

C'est donc une migration, pas une montée de version. Elle a sa propre spec pour cette raison.

## 2. Goal

Le client tourne sur Vite 8 (+ `@vitejs/plugin-react` 6), sans perdre la capacité de compiler le code
existant, et sans que la suite de tests ni le build de production ne changent de comportement.

Bénéfice attendu, au-delà de la mise à jour : la faille `esbuild` (gravité *low* — lecture de fichier
arbitraire par le serveur de dev sous Windows) disparaît avec le transformeur.

## 3. Functional rules

1. `npm run dev`, `npm run build` et les trois suites (serveur, client, E2E) se comportent à
   l'identique avant/après. Aucun test modifié pour « faire passer » la migration.
2. Le **rendu de l'application ne change pas** : mêmes écrans, mêmes styles, même bundle
   fonctionnellement (la taille peut varier, pas le comportement).
3. Les deux configs (`vite.config.js`, `vitest.config.js`) restent **cohérentes entre elles** — elles
   partagent aujourd'hui le même bloc de transformation dupliqué ; toute divergence introduite ici
   serait un piège pour la suite.
4. Le port du serveur de dev (3000), le proxy `/api` + `/uploads` et le dossier de sortie (`dist`)
   sont **inchangés** — l'E2E et le déploiement en dépendent.

**Trois voies possibles, à départager par l'expérimentation (§9) :**

| Voie | Principe | Coût | Risque |
|---|---|---|---|
| **A. Renommer** | Les fichiers `.js` contenant du JSX deviennent `.jsx` | Mécanique mais **très large** (des centaines de fichiers, tout l'historique git suit) | Faible techniquement, lourd en revue et en conflits pour toute branche ouverte |
| **B. `oxc: false`** | Désactiver le transformeur natif, laisser `@vitejs/plugin-react` (babel) tout traiter | Une ligne | Perte de performance de build à mesurer ; comportement à valider |
| **C. Transform dédié** | Un plugin maison qui pré-transforme les `.js` JSX avant `vite:oxc` | Moyen | Code d'outillage maison à maintenir |

## 4. Architecture

> Changement d'outillage uniquement. Aucune logique applicative, aucun schéma, aucun contrat d'API.

### 4.1 Client (`client/`)

| Fichier | T/C | Responsabilité |
|---|---|---|
| `package.json` | T | `vite` ^8, `@vitejs/plugin-react` ^6 (couple obligatoire). |
| `package-lock.json` | T | Régénéré **en place** (`npm install`), jamais recréé — voir la leçon du 2026-08-07 : un verrou recréé depuis un Mac ne contient que ses binaires optionnels et casse `npm ci` sur le runner Linux. |
| `vite.config.js` | T | Bloc `esbuild` → équivalent oxc selon la voie retenue. |
| `vitest.config.js` | T | Idem, en restant aligné sur `vite.config.js`. |
| `src/**` | ? | Renommages `.js` → `.jsx` seulement si la voie A est retenue. |

### 4.2 Serveur

Aucun changement.

### 4.3 CI / déploiement

Aucun changement attendu. `deploy.yml` construit le client (`npm run build`) : la sortie doit rester
dans `dist/`.

## 5. Data model

Aucun.

## 6. UI / UX

Aucun changement visible attendu — c'est précisément ce que la vérification doit confirmer.

## 7. Test plan

- [ ] `cd client && npx vitest run` — **788 tests verts, aucun fichier modifié**. C'est le juge de
      paix : la panne actuelle est justement une panne de transformation des tests.
- [ ] `cd client && npm run build` — build de production réussi ; comparer la taille du bundle
      avant/après et signaler tout écart notable.
- [ ] `npm run test:e2e` — la suite tourne sur le **vrai** serveur de dev Vite : elle valide le proxy,
      le port et le rendu réel.
- [ ] `npm ci` dans `client/` — garde-fou verrou multi-plateformes (linux + darwin + win présents).
- [ ] Manuel : `npm run dev`, puis quelques écrans denses (planning, fiche de réservation, suivi
      financier) — rendu et console propres.
- [ ] `npm audit` — confirmer la disparition de l'avis `esbuild`.

## 8. Out of scope

- Passer à un autre outil de build.
- Toucher au serveur ou à la base.
- Le reste des majeures en attente : `express` 4 → 5 (sa propre spec), `react-router` 8.

## 9. Open questions

- Q : quelle voie — renommage massif, `oxc: false`, ou transform dédié ?
  - A : à trancher en mesurant. Commencer par **B** (une ligne, réversible) : si le build et les
    tests passent avec une performance acceptable, c'est la réponse. **A** est la voie « propre à
    long terme » mais elle touche des centaines de fichiers et entrerait en conflit avec toute
    branche ouverte — à faire seule, sur un dépôt calme.
- Q : `@vitejs/plugin-react` 6 change-t-il le Fast Refresh ou le traitement du JSX runtime ?
  - A : à lire dans ses notes de version avant de conclure que la migration est neutre.
