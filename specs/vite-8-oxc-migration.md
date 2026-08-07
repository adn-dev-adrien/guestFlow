# Vite 8 — migrer du transformeur esbuild à oxc

| Field | Value |
|---|---|
| **Status** | Implemented |
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

> **Correction 2026-08-07 :** on attendait de cette migration qu'elle lève la faille `esbuild`
> (gravité *low* — lecture de fichier arbitraire par le serveur de dev sous Windows). **C'est faux.**
> Vite 8 dépend toujours d'`esbuild@0.27.7` pour le pré-bundling des dépendances (`npm ls esbuild` →
> `vite@8.2.1 └── esbuild@0.27.7`). L'avis reste ouvert. C'était une hypothèse, pas une vérification.

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

## 7. Test plan — exécuté le 2026-08-07

- [x] `cd client && npx vitest run` — **788 tests verts, aucun test modifié**. C'est le juge de paix :
      la panne était justement une panne de transformation des tests.
- [x] `cd client && npm run build` — **build réussi en 320 ms contre 2,74 s** sous Vite 7 (rolldown),
      pour un bundle de **taille identique (3,2 Mo)**. 1971 modules transformés.
- [x] `npm run test:e2e` — **45 passés / 1 ignoré**, sur le vrai serveur de dev Vite 8 : proxy, port
      et rendu réel validés.
- [x] `npm ci` dans `client/` — verrou multi-plateformes intact.
- [x] Manuel : `npm run dev` (« VITE v8.2.1 ready in 259 ms »), puis planning, fiche de réservation,
      suivi financier et paramètres — rendu identique, **zéro erreur console**.
- [x] `npm audit` — l'avis `esbuild` **subsiste** (voir la correction en §1), les deux avis
      `react-router` aussi. Aucune régression : mêmes 3 avis qu'avant la migration.

## 8. Out of scope

- Passer à un autre outil de build.
- Toucher au serveur ou à la base.
- Le reste des majeures en attente : `express` 4 → 5 (sa propre spec), `react-router` 8.

## 9. Open questions — tranchées le 2026-08-07, par l'expérience

- **Q : quelle voie — renommage, `oxc: false`, ou transform dédié ?** → **A, le renommage**, parce
  que les deux autres sont impossibles, pas parce qu'elle est préférable :
  - **B (`oxc: false`) essayée et écartée.** Elle retire bien le plugin (`config.oxc !== false ?
    oxcPlugin(config) : null` dans les sources de Vite 8), mais le build échoue quand même — et
    l'erreur vient alors de **rolldown** : `[builtin:vite-transform] Unexpected JSX expression`.
    Vite 8 n'a pas seulement changé de transformeur, il a changé de **bundler**, et rolldown parse
    lui-même les `.js` comme du JS pur. Au passage, `optimizeDeps.esbuildOptions` est déprécié
    (→ `rolldownOptions`).
  - **C (transform dédié)** aurait dû se battre contre le même parseur natif, pour du code
    d'outillage maison à maintenir.
  - Aucun réglage n'existe : `lang` est retiré des `OxcOptions`, rolldown n'expose rien d'équivalent,
    et le code de Vite tranche par l'extension — `const isJSX = filepath.endsWith("x")`.
- **Q : `@vitejs/plugin-react` 6 change-t-il le Fast Refresh ou le JSX runtime ?** → Aucun effet
  observable : 788 tests, 45 E2E et quatre écrans rendus à l'identique, sans erreur console.

**Deux pièges rencontrés, à connaître si l'exercice se répète :**

1. **La détection du JSX par expression régulière rate les balises en fin de ligne.** Le premier
   passage a renommé 206 fichiers ; 13 manquaient, tous de la forme `<Chip` suivi d'un retour à la
   ligne — mon motif exigeait un caractère après le nom de balise. Il faut ancrer la fin de ligne.
2. **…et elle produit des faux positifs sur les commentaires.** 7 fichiers ont été renommés à tort
   parce qu'un commentaire mentionnait `<Select>`. C'est le test d'architecture
   `calendar-platform-colors` — qui autorise `constants/platforms.js` **par son nom** — qui les a
   signalés en échouant. Ils sont revenus en `.js`. Bilan : **212 `.jsx`, 53 `.js`**.
3. **L'entrée HTML ne résout pas les extensions.** `index.html` référençait `/src/index.js` en dur :
   c'est le seul import du dépôt qui devait être corrigé à la main (tous les autres sont
   extensionless, donc résolus par `resolve.extensions`).
