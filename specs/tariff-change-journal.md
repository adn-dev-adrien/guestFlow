# Journal des changements tarifaires

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/tariff-change-journal` |
| **Created** | 2026-08-14 |
| **Author** | Adrien |
| **Related PR** | https://github.com/adn-dev-adrien/guestFlow/pull/422 |

---

## 1. Context

Une grille tarifaire change en **deux temps**, et GuestFlow n'en retient aucun.

1. La recette est appliquée au logement dans GuestFlow (`POST /api/properties/:id/tariff-recipe/apply`).
   `tariffRecipeModel.apply()` écrit les saisons, puis `propertiesModel.setTariffRecipe()` pose le
   pointeur `tariffRecipeId` / `tariffRecipeVersion` et touche `properties.updatedAt`.
2. La nouvelle grille est répercutée **sur les plateformes** (Lodgify et ses canaux, GreenGo,
   Abracadaroom). C'est ce second moment qui change ce qu'un voyageur voit, donc le seul qui puisse
   expliquer une variation de réservations.

Aujourd'hui, du premier moment il ne reste que `properties.updatedAt` — **une colonne que le
prochain enregistrement de la fiche logement écrase**. Du second, rien du tout. La table
`tariff_recipe_runs` ressemble à un journal mais n'en est pas un : elle n'est alimentée que par la
tâche de fond qui étend l'horizon (`scheduledTasks.js`), jamais par une application manuelle, et
elle est vidée par « Ignorer » côté Tableau de bord.

Constat au 2026-08-14, en production : l'Aventura Lodge porte `aventura-lodge-2026` v1.1.0 avec
`updatedAt = 2026-08-12 16:08:41`, et `tariff_recipe_runs` compte **0 ligne**. La date de la refonte
tarifaire de l'été 2026 n'existe donc plus qu'à titre provisoire.

## 2. Goal

Qu'on puisse répondre, dans six mois comme dans trois ans, à « **à quelle date exacte les tarifs
ont-ils changé, et quand les voyageurs l'ont-ils vu ?** » — pour pouvoir mesurer l'effet d'un
changement de grille sur les réservations.

## 3. Functional rules

1. Un **journal des changements tarifaires** conserve un événement par changement, par logement.
2. Deux natures d'événement :
   - `recipe` — la recette a été appliquée dans GuestFlow ;
   - `platforms` — la grille a été mise en ligne sur les canaux de réservation.
3. Chaque événement porte : le logement, la nature, la recette et sa version, **la date et l'heure
   auxquelles le changement a pris effet** (`occurredAt`), la provenance de l'enregistrement
   (`source`), une note libre, et l'instant d'écriture (`createdAt`).
4. `occurredAt` et `createdAt` sont **deux choses différentes** : on peut déclarer aujourd'hui un
   déploiement fait la semaine dernière. Les statistiques lisent `occurredAt`.
5. **Un événement `recipe` est écrit automatiquement** à chaque application de recette qui modifie
   effectivement quelque chose. Une application sans effet (le diff ne change aucune saison et
   n'ajoute aucune fermeture) **n'écrit rien** : il n'y a pas eu de changement tarifaire.
6. L'écriture automatique se fait avec `source = 'apply'` et `occurredAt` = l'instant de
   l'application.
7. Un événement `platforms` **ne peut pas être deviné** : GuestFlow n'a aucun moyen de savoir quand
   l'opérateur a fini de saisir les prix chez Lodgify. Il est donc **déclaré à la main**, avec sa
   date, et enregistré avec `source = 'manual'`.
8. La saisie manuelle accepte aussi la nature `recipe`, pour réparer un historique (une application
   faite par script avant cette spec, par exemple).
9. Un événement est **supprimable** (une saisie manuelle erronée doit pouvoir partir). Rien n'est
   modifiable en place : on supprime et on ressaisit, pour qu'une correction reste une trace.
10. Le journal est **lisible par logement et globalement**, du plus récent au plus ancien.
11. La **migration récupère la date de l'application déjà faite** tant qu'elle est encore là : pour
    chaque logement qui porte une recette et n'a aucun événement, elle écrit un événement `recipe`
    daté de `properties.updatedAt`, avec `source = 'backfill'` et une note qui dit franchement que
    la date est **déduite** de la dernière modification de la fiche, pas observée.
12. Le journal **ne modifie aucun tarif** et n'entre dans aucun calcul de prix. C'est un registre.

**Edge cases :**
- Application de recette qui échoue (`blocking`) → aucun événement : rien n'a changé.
- Application dont seul le coût du pack accueil change (diff de saisons vide) → aucun événement,
  conformément à la règle 5 ; le pack accueil est une donnée de marge, invisible du voyageur.
- Détachement d'une recette (`detach`) → aucun événement : les saisons restent en place telles
  quelles, le tarif ne bouge pas.
- Suppression d'un logement → ses événements partent avec (`ON DELETE CASCADE`).
- Deux applications le même jour → deux événements ; le journal ne déduplique pas, c'est l'histoire
  réelle.
- Un logement sans recette et sans événement → la migration n'invente rien.

---

## 4. Architecture

> **Fat backend, thin frontend** — la totalité de la logique (validation des dates, choix de la
> nature, dérivation de la recette/version depuis le logement, tri) est côté serveur. Le client
> affiche une liste déjà ordonnée et déjà libellée, et tient un formulaire.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `tariffRecipes.js` | T | Expose le journal : liste, création, suppression |
| `controllers/` | `tariffRecipesController.js` | T | Valide l'entrée, délègue au modèle, met en forme |
| `models/` | `tariffChangeJournalModel.js` | C | Seul accès à `tariff_change_events` (lecture, écriture, suppression) |
| `models/` | `tariffRecipeModel.js` | T | Écrit l'événement `recipe` quand l'application a modifié quelque chose |
| `middleware/` | — | — | (aucun) |
| `utils/` | — | — | (aucun) |
| `scheduledTasks.js` | — | — | (aucun — la tâche de fond garde son propre journal d'alertes) |
| `database.js` | `database.js` | T | Création idempotente de la table, index, et rattrapage |
| `tests/` | `tariff-change-journal.unit.test.js` | C | Règles 2–11 sur une base en mémoire |

**Notes :**
- Le modèle est le seul à connaître le SQL, conformément à la politique de refactoring : la route
  reste mince, le contrôleur orchestre.
- `tariffRecipeModel.apply()` appelle le journal **après** sa transaction et seulement si
  `applied === true`. L'écriture du journal ne doit jamais pouvoir faire échouer une application de
  recette : une erreur y est avalée et tracée, car perdre une ligne d'historique est moins grave que
  perdre l'application d'une grille.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `TariffRecipesPage.jsx` | T | Affiche le journal sous les recettes + ouvre le formulaire de déclaration |
| `components/` | `TariffChangeJournal.jsx` | C | Frise des événements + dialogue de déclaration |
| `hooks/` | — | — | (aucun) |
| `services/` | — | — | (aucun) |
| `utils/` | — | — | (aucun) |
| `constants/` | — | — | (aucun) |
| `api.js` | `api.js` | T | Trois appels : liste, création, suppression |

**Component reuse declaration :**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `ConfirmDialog`, `EmptyState`, `ErrorAlert`, `LoadingState`, `PageActionBar` | Tous préexistants. Le dialogue de déclaration est un `FormDialog`, pas un `<Dialog>` maison. |
| **Created (new generic)** | — | Aucun composant générique nouveau : la frise est spécifique au journal. |
| **Specific (kept feature-local)** | `TariffChangeJournal` | Spécifique : il connaît les deux natures d'événement et leur sémantique métier. Il n'est pas une composition de génériques parce qu'il porte le libellé des natures et la règle d'affichage « date d'effet ≠ date de saisie ». |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/tariff-recipes/journal` | — | `{ events: [...] }` | Tous logements, du plus récent au plus ancien. `?propertyId=N` filtre. |
| POST | `/api/tariff-recipes/journal` | `{ propertyId, kind, occurredAt, note? }` | `{ event }` | `source = 'manual'`. Recette et version déduites du logement. |
| DELETE | `/api/tariff-recipes/journal/:id` | — | `{ ok: true }` | 404 si l'événement n'existe pas. |

Authentification : même middleware que le reste de `/api` (session admin). Erreurs : `400` avec
`{ error }` en français pour une entrée invalide, `404` pour un identifiant inconnu.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS tariff_change_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  propertyId    INTEGER NOT NULL,
  kind          TEXT    NOT NULL,            -- 'recipe' | 'platforms'
  recipeId      TEXT    NOT NULL DEFAULT '',
  recipeVersion TEXT    NOT NULL DEFAULT '',
  occurredAt    TEXT    NOT NULL,            -- 'YYYY-MM-DD HH:MM:SS', date d'EFFET
  source        TEXT    NOT NULL DEFAULT 'manual', -- 'apply' | 'manual' | 'backfill'
  note          TEXT    NOT NULL DEFAULT '',
  createdAt     TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tariff_change_events_property ON tariff_change_events(propertyId, occurredAt);
```

**Migration** — bloc idempotent dans `database.js`, à la suite du bloc « TARIFF RECIPES ».
Création de la table et de l'index, puis **rattrapage en une passe** (règle 11) : pour chaque
logement dont `tariffRecipeId != ''` et qui n'a encore aucun événement, insertion d'un `recipe` daté
de `properties.updatedAt`, `source = 'backfill'`, note explicite sur le caractère déduit de la date.

Le rattrapage est gardé par l'absence d'événement pour ce logement, pas par la création de la table :
il peut donc aussi rattraper un logement dont la recette a été posée après coup par un script.

**Data impact :** aucune donnée existante n'est modifiée. Le journal n'écrit que dans sa propre
table. Aucun tarif, aucune réservation, aucune fiche logement n'est touché. Le seul risque serait
d'écrire une date fausse au rattrapage — d'où la note qui la marque comme déduite.

## 6. UI / UX

**Où :** Paramètres → **Recettes tarifaires** (`/settings/tariff-recipes`), sous les cartes de
recettes. C'est la page qui parle déjà de recettes et de versions appliquées ; le journal y est la
suite naturelle. Le logement, lui, garde sa page de saisons pour la configuration.

**La frise.** Un titre « Journal des changements », puis une ligne par événement, de la plus récente
à la plus ancienne :

- une puce colorée et un libellé de nature — **« Recette appliquée »** (vert sapin) ou
  **« Mise en ligne sur les plateformes »** (bleu) ;
- le logement en gras, la recette et sa version en petit ;
- la **date d'effet** en toutes lettres (« 12 août 2026 à 16:08 ») ;
- quand la saisie est postérieure à l'effet, une mention discrète « enregistré le … » ;
- une puce « déduite » sur les événements de rattrapage, avec l'explication en infobulle ;
- une corbeille à droite, qui ouvre un `ConfirmDialog`.

**Déclarer un événement.** Un bouton « Déclarer un changement » ouvre un `FormDialog` : logement
(liste), nature (deux choix), date et heure d'effet (par défaut maintenant), note libre. Le bouton
d'enregistrement reste désactivé tant que logement, nature et date ne sont pas renseignés.

**Copie française :**
- Titre : « Journal des changements » ; sous-titre : « Quand la grille a changé, et quand les
  voyageurs l'ont vu. »
- Vide : « Aucun changement enregistré pour l'instant. » + « Déclarer un changement ».
- Erreur de chargement : `ErrorAlert` avec « Réessayer ».
- Suppression : « Supprimer cet événement ? Il ne sera plus possible de dater ce changement. »

**Responsive :**
- `xs` — une ligne par événement passe en pile : nature et logement d'abord, dates dessous ; le
  `FormDialog` est `fullScreen` ; la corbeille reste à ≥ 44 × 44 px ; aucun défilement horizontal.
- `md` — deux colonnes : identité de l'événement à gauche, dates à droite.
- `lg` — même mise en page que `md`, largeur bornée par le conteneur de la page.

**`PageActionBar` :** la page en a déjà une (`title="Recettes tarifaires"`, `backTo="/settings"`).
Elle est complétée par une action `actionsBefore` : icône « + », infobulle **« Déclarer un
changement tarifaire »**, couleur `primary`.

## 7. Test plan

### Server unit tests
- [x] `tests/tariff-change-journal.unit.test.js` — la table accepte les deux natures et refuse le reste (règle 2)
- [x] — `occurredAt` et `createdAt` sont indépendants (règle 4)
- [x] — une application effective écrit un événement `recipe` en `source='apply'` (règles 5, 6)
- [x] — une application sans effet n'écrit rien (règle 5, cas limite)
- [x] — une saisie manuelle déduit recette et version depuis le logement (règle 7)
- [x] — une date invalide est refusée en 400 (règle 3)
- [x] — la suppression retire l'événement et rend 404 la seconde fois (règle 9)
- [x] — la liste est triée par date d'effet décroissante et filtrable par logement (règle 10)
- [x] — le rattrapage date depuis `updatedAt`, ne s'exécute qu'une fois, et n'invente rien pour un logement sans recette (règle 11)

### Manual UI verification — faite le 2026-08-14 sur `npm run dev`
- [x] Chemin nominal : mise en ligne plateformes déclarée au 14/08/2026 11:00, apparue en tête de frise
- [x] Rattrapage : l'application du 12/08/2026 12:41 s'affiche avec sa puce « date déduite » et
      « enregistré le 14 août 2026 à 10:24 » — l'écart entre effet et saisie est lisible
- [x] Suppression : la confirmation s'ouvre, « Annuler » laisse l'événement en place
- [x] Mobile (390 px) : frise empilée, dialogue plein écran, aucun défilement horizontal
      (`scrollWidth == clientWidth`)
- [x] Régression : suite E2E Playwright complète au vert (59 passés, 1 ignoré), dont les six
      scénarios `tariff/recipe-apply` qui passent par le vrai chemin d'application

## 8. Out of scope

- **Les statistiques elles-mêmes.** Cette spec produit la donnée datée ; le croisement avec les
  réservations (avant/après, par canal) fera l'objet d'un travail séparé, quand il y aura assez de
  recul pour que la comparaison veuille dire quelque chose.
- La détection automatique d'un déploiement plateforme : GuestFlow ne parle pas aux consoles
  Lodgify / GreenGo / Abracadaroom, et cette spec ne l'y engage pas.
- La modification d'un événement existant (règle 9 : on supprime et on ressaisit).
- Le rattrapage des changements tarifaires antérieurs à la recette (2025 et avant) : la donnée
  n'existe nulle part, l'inventer serait pire que l'absence.

## 9. Open questions

- Q : faut-il journaliser aussi les modifications de saisons faites à la main sur la page Saisons,
  hors recette ?
  - A (2026-08-14) : **non pour l'instant.** Elles sont fréquentes et souvent cosmétiques ; les
    journaliser noierait les vrais changements de grille. À revoir si l'analyse montre des écarts
    inexpliqués.
- Q : où lire le journal — page logement ou Paramètres ?
  - A (2026-08-14) : **Paramètres → Recettes tarifaires**, avec filtre par logement. Un changement
    de grille concerne l'exploitation, pas la fiche d'un logement.
