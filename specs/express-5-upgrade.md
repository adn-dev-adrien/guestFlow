# Express 4 → 5

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `chore/express-5-upgrade` _(user-managed)_ |
| **Created** | 2026-08-07 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Dernière majeure en retard de la remise à niveau du 2026-08-07 : le serveur tourne sur
**express ^4.18.2** alors que la **5.2.1** est publiée. Express 5 est sorti après dix ans de
développement ; rester en 4 signifie s'éloigner du support et des correctifs de sécurité amont.

C'est le cœur de l'application — **201 routes réparties dans 27 fichiers** — d'où cette spec plutôt
qu'une montée de version dans un lot.

**L'analyse d'impact a été faite avant d'écrire la spec, et elle est étonnamment favorable :**

| Rupture connue d'express 5 | Présente ici ? |
|---|---|
| `req.query` devient un getter (non assignable) | **Non** — aucune mutation dans le code |
| Syntaxe de routes (`*`, `:param?`, regex) via path-to-regexp v8 | **Non** — aucune route n'utilise de wildcard, d'optionnel ni de regex |
| `res.send(status)`, `res.json(status, body)` retirés | **Non** |
| `app.del()` retiré (→ `app.delete()`) | **Non** |
| `req.param(name)` retiré | **Non** |
| `res.sendfile()` retiré (→ `res.sendFile()`) | **Non** |
| `res.redirect('back')` retiré | **Non** |

Le seul point qui demande de l'attention est un **changement de comportement, pas une rupture d'API** :
express 5 **capture les promesses rejetées** des handlers asynchrones et les envoie au middleware
d'erreur, là où express 4 laissait filer un `unhandledRejection`. Le dépôt compte des contrôleurs
asynchrones (`paymentsController` 9, `googleCalendarController` 7, `propertyIcalController` 2,
`propertiesController` 2, plus quelques autres) : une erreur qui, aujourd'hui, remonte en log non
géré ira désormais au middleware d'erreur — **une amélioration**, à condition qu'un middleware
d'erreur existe et réponde proprement.

## 2. Goal

Le serveur tourne sur express 5, avec un comportement identique du point de vue du client : mêmes
routes, mêmes codes de statut, mêmes charges utiles, mêmes sessions.

## 3. Functional rules

1. **Aucun changement de contrat d'API.** Les 201 routes répondent à l'identique — mêmes chemins,
   mêmes verbes, mêmes codes, mêmes corps de réponse. Toute divergence est un bug, pas une adaptation.
2. **La suite serveur passe inchangée.** Un test qu'il faudrait modifier pour « faire passer » la
   montée est un signal d'alerte, pas une tâche.
3. **L'écosystème suit** : `express-session`, `express-rate-limit` (peer `>= 4.11`, compatible),
   `cors`, `helmet`, `multer`, `better-sqlite3-session-store`. Aucun ne déclare d'incompatibilité
   avec express 5 ; à vérifier au runtime, pas seulement dans les `peerDependencies`.
4. **Les erreurs asynchrones doivent atterrir quelque part.** Express 5 les route vers le middleware
   d'erreur : s'il n'y en a pas de global, une erreur asynchrone deviendrait une réponse vide au lieu
   d'un plantage visible. Vérifier qu'`index.js` termine par un middleware d'erreur qui renvoie un
   statut et un corps JSON, et l'ajouter sinon.
5. **La session survit.** L'authentification repose sur `express-session` + un store SQLite : une
   session ouverte avant la montée doit rester valide après (pas de déconnexion générale au déploiement).
6. **Les limiteurs de débit et l'API publique restent en place** — ce sont les chemins exposés à
   Internet via le proxy WordPress.

**Points de vigilance :**
- `res.status()` valide désormais son argument : un code hors norme lève au lieu d'être envoyé tel quel.
- Le corps d'une requête sans `Content-Type` n'est plus deviné de la même façon ; les endpoints
  publics (webhook Qonto, API publique) doivent être re-testés avec leurs vrais en-têtes.
- `express.urlencoded({ extended })` n'a plus la même valeur par défaut — à expliciter si utilisé.

---

## 4. Architecture

> Montée de dépendance. Aucune logique métier, aucun schéma, aucun changement client.

### 4.1 Server (`server/`)

| Fichier | T/C | Responsabilité |
|---|---|---|
| `package.json` | T | `express` ^5.2.1. |
| `package-lock.json` | T | Mis à jour **en place** (`npm install`), jamais recréé — leçon du 2026-08-07 : un verrou régénéré depuis un Mac ne contient que ses binaires optionnels et casse `npm ci` sur le runner Linux. |
| `src/index.js` | ? | Middleware d'erreur global si absent (règle 4) ; ordre des middlewares à re-vérifier. |
| `src/routes/**` (27 fichiers) | — | Attendus inchangés : aucun motif de route à risque détecté. |
| `src/controllers/**` | — | Attendus inchangés. |
| `src/utils/propertyUploads.js` | — | Contient le seul middleware d'erreur à 4 arguments (multer) — signature toujours valide en v5. |

### 4.2 Client

Aucun changement.

### 4.3 Déploiement

`deploy.yml` inchangé. Le serveur est relancé par PM2 : surveiller les logs au premier démarrage.

## 5. Data model

Aucun changement de schéma. La table de sessions (`better-sqlite3-session-store`) n'est pas touchée —
règle 5.

## 6. UI / UX

Aucun changement visible. Le client ne sait pas quelle version d'express le sert.

## 7. Test plan — exécuté le 2026-08-07

### Tests serveur
- [x] `cd server && npm test` — **2364 verts** (2359 + 5 nouveaux), **aucun test existant modifié**.
- [x] `tests/express5-async-error-handler.unit.test.js` (**nouveau**, 5 tests) — le contrat du
      middleware ajouté : un rejet asynchrone donne un 500 **JSON** (pas la page HTML par défaut, pas
      une requête suspendue) ; le détail de l'erreur (chemin, SQL, jeton) **ne fuit jamais** au
      client ; un `status` porté par l'erreur est conservé (404, 409…) ; un `status` aberrant
      retombe sur 500 au lieu de faire lever `res.status()` — qui valide désormais son argument en
      v5 ; une réponse déjà envoyée n'est pas réécrite.

### E2E
- [x] `npm run test:e2e` — **45 passés / 1 ignoré**, contre le vrai serveur express 5 : session,
      authentification, écritures, navigation.

### Client
- [x] Non concerné (aucun changement) ; la suite client tourne par ailleurs dans la CI.

### Manuel
- [x] `npm ci` dans `server/` propre ; verrou à jour (`express 5.2.1`) et matrice `sharp` intacte
      (16 linux / 4 darwin).
- [x] **La route de repli SPA testée en conditions de production** — c'était le vrai angle mort. Ce
      n'est pas une route en chaîne mais une **regex** : `app.get(/^\/(?!api|uploads).*/)`, montée
      seulement si `client/build/index.html` existe (le déploiement renomme `dist` → `build`, cf.
      `deploy.yml`). Ni les tests unitaires ni l'E2E ne l'atteignent — l'E2E passe par le serveur de
      dev Vite. Reproduit à la main : build réel, renommé, serveur démarré →
      `/planning` et `/reservations/42` renvoient bien **200 text/html** avec l'index de la SPA.
- [x] `/api/inconnue` sans session → **401 JSON**, et non 404 : `requireAuth` est monté sur `/api`
      (ligne 144) **avant** le 404 (ligne 223). Comportement voulu, identique en v4 — c'était
      l'attente du contrôle qui était fausse, pas le serveur.

## 8. Out of scope

- Refondre le routage ou la structure des contrôleurs (la dette « routes grasses » a sa propre
  feuille de route dans `specs/ROADMAP.md`).
- `react-router` 8 côté client.
- L'avis `esbuild` (lié à Vite, pas à express).

## 9. Open questions — tranchées le 2026-08-07

- **Q : existe-t-il un middleware d'erreur global ?** → **Non, il n'y en avait aucun.** Ajouté en fin
  d'`index.js`. Ce n'est pas cosmétique : en v4 un rejet asynchrone s'échappait en
  `unhandledRejection` et **laissait la requête sans réponse** ; en v5 il arrive ici. Sans handler,
  il tomberait sur le gestionnaire HTML par défaut d'express, sur une API qui ne parle que JSON. Le
  message d'erreur n'est **pas** renvoyé au client (il peut contenir un chemin, du SQL, un jeton) :
  il est journalisé côté serveur, le client reçoit une forme stable et opaque.
- **Q : `better-sqlite3-session-store` (0.1.0, peu maintenu) tient-il sous express 5 ?** → **Oui,
  vérifié au runtime** et non sur les métadonnées : la suite E2E ouvre une vraie session, navigue et
  écrit — 45 scénarios verts.
- **Q3 (surgie en route) : la route de repli SPA est une regex — path-to-regexp v8 la casse-t-elle ?**
  → **Non.** Vérifié en reproduisant la production (build renommé en `build`, serveur démarré) :
  `/planning` et `/reservations/42` renvoient l'index de la SPA en 200. C'était le seul vrai risque
  du dossier, et il était invisible pour les deux suites automatisées.

**Ce que l'analyse d'impact a évité :** aucune des sept ruptures documentées d'express 5 (mutation de
`req.query`, wildcards de routes, `res.send(status)`, `app.del`, `req.param`, `res.sendfile`,
`redirect('back')`) n'est présente dans le dépôt. La montée s'est donc faite **sans toucher une seule
route ni un seul contrôleur** — le seul ajout est le middleware d'erreur, qui est une amélioration
autonome.
