# Indemnité d'annulation versée par la plateforme

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/cancellation-compensation` |
| **Created** | 2026-08-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Un client a annulé son séjour hors délai de gratuité (cas réel du 2026-08-19, alerte encore en
attente sur le dashboard de prod). La plateforme conserve une partie du montant et **nous reversera
une indemnité**, avec un décalage pouvant aller jusqu'à une semaine entre l'annulation et le
virement effectif. Aujourd'hui l'application n'a nulle part où poser cet argent :

- **Côté annulation.** La détection iCal fonctionne :
  [`propertyIcalModel.syncSource`](server/src/models/propertyIcalModel.js) repère l'UID disparu du
  flux, [`icalCancellationModel.recordPending`](server/src/models/icalCancellationModel.js) crée une
  alerte, et le dashboard l'affiche via
  [`IcalCancellationAlert.jsx`](client/src/components/IcalCancellationAlert.jsx)
  (spec [ical-cancellation-approval.md](specs/ical-cancellation-approval.md)). Mais
  `icalCancellationModel.approve()` **supprime la réservation** (`DELETE FROM reservations`) après
  avoir écrit une entrée d'historique. Une fois l'annulation validée, il ne reste donc **aucune
  ligne** à laquelle rattacher un futur versement : ni client, ni logement, ni plateforme, ni dates.
- **Côté comptabilité.** [`accountingModel`](server/src/models/accountingModel.js) ne sait produire
  que deux natures d'écriture : les encaissements **rattachés à une réservation** (acompte, solde,
  complément, complément de fin de séjour) et les **avoirs** de
  [`refundsModel`](server/src/models/refundsModel.js) (`direction: 'refund'`). Les deux passent par le
  même moteur pur [`accountingExport.js`](server/src/utils/accountingExport.js), qui accepte déjà des
  entrées de nature différente — le pipeline est donc extensible sans le réécrire.
- **Rien n'existe** sur le sujet : `grep -i "indemn|compensation|no-show|dédit"` ne remonte aucune
  logique métier dans `server/` ni `client/`.

Le besoin n'est pas un remboursement (`reservation_refunds` = argent qui **sort** vers le client),
c'est un **produit qui entre**, sans séjour en face, à une date qu'on ne connaît pas encore au
moment où l'annulation est validée.

**Arbitrages pris avec Adrien le 2026-08-19** (questionnaire) :

| Sujet | Décision |
|---|---|
| Rattachement | **Fiche d'indemnité autonome** — nouvelle table, instantané figé au moment de l'approbation. La réservation continue d'être supprimée. |
| Comptabilisation | **Produit divers hors TVA** — compte `75880000` par défaut, taux de TVA 0 %, les deux paramétrables. |
| Montant | **Net versé uniquement** — un seul montant, celui qui arrive sur le compte. Pas de brut/commission. |
| Déclenchement | **À l'approbation de l'annulation**, avec création manuelle possible depuis Comptabilité. |

## 2. Goal

Au moment de valider une annulation iCal, pouvoir déclarer **l'indemnité attendue de la plateforme**,
la garder **modifiable tant qu'elle n'est pas versée**, puis l'**encaisser à sa date réelle** — après
quoi elle apparaît dans l'aperçu du journal et dans le CSV des ventes du **mois du versement**.

## 3. Functional rules

### 3.1 Cycle de vie

1. Une **indemnité d'annulation** est une fiche autonome, indépendante de toute réservation (la
   réservation est supprimée à l'approbation, comportement inchangé). Elle porte un **instantané**
   pris avant la suppression : logement, plateforme, prénom/nom du client, dates du séjour annulé,
   montant net du séjour perdu (`finalPrice`), plus l'`id` historique de la réservation et l'`id` de
   l'alerte d'annulation.
2. Deux états seulement : **`pending`** (indemnité annoncée / attendue) et **`received`** (versement
   encaissé). Pas de troisième état : une indemnité qui n'arrivera jamais est **supprimée**.
3. **`pending`** porte un **montant attendu** (`expectedAmount`, ≥ 0, peut être 0 si le montant n'est
   pas encore connu) et une **date de versement prévue** facultative (`expectedDate`).
4. **Tant que la fiche est `pending`, tous ses champs sont modifiables** (montant attendu, date
   prévue, plateforme, nom du client, dates, note). C'est l'exigence centrale : la plateforme
   annonce souvent un montant approximatif, confirmé au virement.
5. **Encaisser** = fournir un **montant réellement versé** (`receivedAmount`, > 0) et une **date de
   versement** (`receivedDate`). La fiche passe à `received`. `receivedAmount` est **libre** : il n'a
   pas à être égal à `expectedAmount` (l'écart est normal et n'est pas signalé comme une erreur).
6. Une fiche **`received` est figée** : toute modification / suppression renvoie **409
   `COMPENSATION_LOCKED`**. Pour corriger, on la **rouvre** explicitement (`reopen`) — elle
   redevient `pending`, `receivedAmount` / `receivedDate` sont effacés, et elle **quitte
   immédiatement le journal comptable du mois**. Le dialogue de réouverture prévient en clair que
   si le CSV du mois a déjà été transmis au comptable, il devra être renvoyé.
7. **Suppression** possible uniquement en `pending` (la plateforme ne versera finalement rien), avec
   confirmation. Suppression physique : une indemnité jamais versée n'a aucune valeur comptable.
8. **Une seule indemnité par alerte d'annulation.** Ré-approuver une alerte déjà acquittée est déjà
   un 409 (règle existante) ; en plus, `cancellationAlertId` est **UNIQUE** côté schéma (NULL autorisé
   en multiple pour les créations manuelles).

### 3.2 Déclenchement depuis le dashboard

9. Le bouton **« Supprimer »** de la carte d'annulation iCal n'agit plus directement : il ouvre un
   dialogue **« Annulation — indemnité attendue ? »** rappelant client / logement / dates / montant du
   séjour perdu, avec deux issues :
   - **« Aucune indemnité »** → exactement le comportement actuel (suppression + acquittement).
   - **« Indemnité attendue »** → champs *Montant attendu (€)* et *Date de versement prévue*
     (facultative) + *Note*, puis suppression + acquittement + création de la fiche `pending`.
10. La suppression de la réservation et la création de l'indemnité sont **une seule transaction**
    serveur : si l'insertion de l'indemnité échoue, la réservation n'est pas supprimée et l'alerte
    reste en attente. L'instantané est lu **avant** le `DELETE`.
11. Si l'alerte concerne une réservation **déjà supprimée** (`reservationExists = false`), l'étape
    indemnité **n'est pas proposée** (aucun instantané disponible) — le bouton reste désactivé comme
    aujourd'hui. L'indemnité reste créable à la main depuis Comptabilité.
12. Le **✕ « Ignorer »** (reject) est inchangé : aucune indemnité créée.
13. Le reste du flux d'approbation est inchangé : entrée `reservation_history`, suppression des
    `ical_import_events`, suppression Google Calendar en fire-and-forget.

### 3.3 Comptabilité

14. Une indemnité **`pending` n'existe pas comptablement** : aucune écriture, aucun montant dans le
    CSV. Elle n'est qu'un pense-bête opérationnel.
15. Une indemnité **`received` produit une écriture** dans le journal des ventes (`VT`) **au mois de
    `receivedDate`**, exactement comme un encaissement ou un avoir — même endpoint, même CSV, même
    aperçu visuel. Elle apparaît donc dans le flux chronologique du mois, triée par date.
16. **Forme de l'écriture** (montant net, hors TVA par défaut) :
    - **1 ligne au DÉBIT** du compte client auxiliaire `C<NOM>` (même construction que partout
      ailleurs, `buildClientAccount`) pour le montant versé TTC — c'est le mouvement bancaire.
    - **1 ligne au CRÉDIT** du **compte indemnité** (`75880000` par défaut) pour le même montant.
    - **Si et seulement si** le taux de TVA indemnité configuré est > 0 : le crédit est éclaté en
      HT sur le compte indemnité + TVA sur le compte `44571100` (10 %) ou `44571200` (autre taux),
      via le `vatAccountForRate` existant. À 0 % (défaut) : une seule ligne de crédit, pas de ligne
      de TVA.
    - **Jamais** de ligne de commission (le montant saisi est déjà le net versé) ni de ligne de taxe
      de séjour (une annulation ne génère pas de taxe).
    - Σ débits = Σ crédits, au centime, avec absorption du résidu d'arrondi sur la dernière ligne de
      crédit — même garantie que les autres écritures.
17. **Libellé** de l'écriture : `PRÉNOM NOM` en majuscules (style comptable existant), et à défaut
    `INDEMNITÉ ANNULATION #<id>`.
18. **Colonnes d'extension** du CSV (`Plateforme` / `Prix payé client` / `Commission`) : la
    plateforme est renseignée sur la ligne d'ancrage ; `Prix payé client` et `Commission` restent
    vides (on ne saisit que le net).
19. Le compte indemnité et le taux de TVA indemnité sont **deux réglages globaux**, séparés comme le
    reste de l'application : le **compte** (`75880000` par défaut) s'édite sur la page **Plan
    comptable** (`/comptabilite/plateformes`), à côté du compte de commission par défaut, et y est
    accessible au rôle comptable ; le **taux de TVA** (`0` par défaut) vit dans **Réglages → Général →
    Taux de TVA**, avec les deux autres taux, et n'est affiché qu'en lecture seule sur le Plan
    comptable — exactement le partage déjà en place pour la TVA déductible sur commissions.
20. La page **Comptabilité** gagne une section **« Indemnités d'annulation »** qui liste, pour le
    mois sélectionné : les indemnités **encaissées ce mois-là** (avec leur total) et — hors mois,
    toujours visibles — les indemnités **en attente** (elles n'ont pas de date comptable).
    Encaisser ou rouvrir depuis cette section **rafraîchit immédiatement le journal du mois** affiché
    au-dessus : sans cela, la carte « Détail des écritures » garderait une écriture périmée jusqu'au
    prochain rechargement (constaté en vérification visuelle le 2026-08-19).
21. **Rôles** : la lecture est ouverte à `admin` **et** `accountant` (GET sous `/api/accounting/*`,
    déjà autorisé par le guard). **Toutes les écritures sont admin uniquement** — le guard actuel
    refuse déjà tout non-GET au comptable sous `/accounting/*` hors la liste blanche
    `platform-accounts` ; on **n'ajoute rien** à cette liste blanche.

### 3.4 Rappel opérationnel

22. Le dashboard affiche une alerte **« Indemnités d'annulation en attente »** (severity `info`) dès
    qu'il existe au moins une fiche `pending`, listant chacune : client · logement, dates du séjour
    annulé, plateforme, montant attendu, date prévue. Trois actions par ligne : **« Encaisser »**
    (ouvre le dialogue montant + date), **« Modifier »**, **✕ « Supprimer »** (confirmation).
23. Une indemnité dont la `expectedDate` est **dépassée** (< aujourd'hui) est mise en avant
    (`StatusBadge` orange « En retard ») ; les autres portent un badge neutre « En attente ».
    Aucune notification e-mail ni push en v1.

### 3.5 Validation (serveur, autoritaire)

24. `expectedAmount` : nombre ≥ 0, ≤ 100 000, arrondi au centime. `receivedAmount` : > 0, ≤ 100 000.
25. `receivedDate` : `YYYY-MM-DD` valide, **ni dans le futur** (400 `RECEIVED_DATE_IN_FUTURE` — on
    n'encaisse pas de l'argent pas encore arrivé), ni antérieure de plus de 5 ans.
26. `expectedDate` : `YYYY-MM-DD` valide ou vide. Une date future est parfaitement normale ici.
27. `platform` : chaîne libre non vide, proposée depuis la liste `platforms` existante mais non
    contrainte (une plateforme peut disparaître de la table). `clientLastName` peut être vide → le
    compte auxiliaire retombe sur `CXXXXX` (comportement existant de `buildClientAccount`).
28. Les montants sont stockés en `REAL` arrondi au centime, comme partout ailleurs.

**Edge cases :**

- **La plateforme verse moins / plus qu'annoncé** → on encaisse le montant réel ; l'écart n'est ni
  bloqué ni signalé. L'attendu reste visible dans la fiche à titre d'historique.
- **La plateforme ne verse rien** → suppression de la fiche `pending`.
- **Le versement arrive à cheval sur deux mois** (annoncé en août, versé le 2 septembre) → l'écriture
  tombe en **septembre** (mois de `receivedDate`), ce qui est le comportement voulu : la compta suit
  l'encaissement, comme le reste de l'export.
- **Erreur de montant détectée après encaissement** → `reopen` puis nouvel encaissement. Le journal
  du mois change ; le dialogue prévient.
- **Deux annulations pour le même client** → deux fiches distinctes (aucune déduplication par nom).
- **Approbation d'annulation sans réservation** (déjà supprimée entre le sync et le clic) →
  pas d'étape indemnité (règle 11), l'approbation reste idempotente.
- **Le logement est supprimé plus tard** → la fiche garde `propertyName` en dur dans son instantané,
  donc l'affichage et l'écriture survivent (`propertyId` devient orphelin, jamais joint en dur).
- **Restauration d'une sauvegarde antérieure à la migration** → la table est recréée vide par le bloc
  idempotent au boot ; aucune indemnité n'est inventée.

---

## 4. Architecture

> **Fat backend, thin frontend.** Le client n'effectue **aucun** calcul : il envoie des montants
> saisis et affiche des payloads prêts à rendre. Le choix du mois comptable, la construction des
> lignes d'écriture, la validation des montants/dates, le verrouillage `received` et le total des
> indemnités du mois sont **tous** côté serveur.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `accounting.js` | T | Monte les 6 endpoints CRUD `/cancellation-compensations` (routes fines, zéro logique). |
| `routes/` | `dashboard.js` | T | `POST /ical-cancellation/:id/approve` accepte désormais un corps optionnel `{ compensation }`. |
| `controllers/` | `cancellationCompensationsController.js` | C | Parse + valide les entrées (montants, dates, mois), délègue au modèle, mappe les erreurs métier en codes HTTP. |
| `controllers/` | `dashboardController.js` | T | Passe le payload `compensation` validé à `icalCancellationModel.approve()` et renvoie `compensationId`. |
| `controllers/` | `accountingController.js` | T | Ajoute `compensationsByMonth` au flux `monthEntries` (CSV **et** JSON) — une seule ligne à changer, les deux sorties suivent. |
| `models/` | `cancellationCompensationsModel.js` | C | Seul accès SQL à `cancellation_compensations` : `create`, `listPending`, `listReceivedByMonth`, `getById`, `update` (pending only), `receive`, `reopen`, `remove`. Factory `buildModel(db)` pour les tests. |
| `models/` | `icalCancellationModel.js` | T | `approve(id, { compensation })` : lit l'instantané réservation **avant** le DELETE, crée la fiche dans la **même** transaction, renvoie `compensationId`. |
| `models/` | `accountingModel.js` | T | `compensationsByMonth({month, year})` → entrées normalisées `direction: 'compensation'` (compte + taux lus dans `app_settings`). |
| `models/` | `settingsModel.js` | T | Ajoute `cancellationCompensationAccount` + `vatRateCancellationCompensation` aux clés écrivables + defaults. |
| `controllers/` | `settingsController.js` | T | Le taux rejoint `VAT_FIELDS` (même validateur que les deux autres taux). |
| `utils/` | `settingsResponse.js` | T | Expose `vat.rateCancellationCompensation` dans le GET /settings. |
| `utils/` | `cancellationCompensations.js` | C | Validateurs purs partagés par les deux surfaces d'écriture (approbation + CRUD) : montants, dates, versement non futur. |
| `models/` | `platformAccountsModel`* | — | (pas de modèle dédié : la page Plan comptable lit/écrit ces 2 réglages via `platformAccountsController` → `settingsModel`). |
| `controllers/` | `platformAccountsController.js` | T | Expose et enregistre les 2 nouveaux réglages avec le compte de commission par défaut. |
| `utils/` | `accountingExport.js` | T | `compensationEntryToRows(entry)` (débit `C<NOM>` / crédit 75xx [+ TVA]) branché dans `entryToRows` sur `direction === 'compensation'` ; `classifyLine` reconnaît `75…` → `revenue` ; `entryToStructured` porte `direction: 'compensation'` + `kind: 'compensation'`. |
| `constants/` | `accounting.js` | T | `DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT = '75880000'` + libellé « Indemnité d'annulation » dans `ACCOUNT_LABELS`. |
| `middleware/` | `enforceRoleAccess.js` | — | Aucun changement : les GET `/accounting/*` sont déjà ouverts au comptable, les écritures déjà refusées. Un test de dérive le vérifie. |
| `database.js` | `database.js` | T | Bloc idempotent : table `cancellation_compensations` + index + 2 colonnes `app_settings`. |
| — | `schema.sql` | T | Même table + index + colonnes dans la baseline de schéma (convention `migrations-baseline` : toute table nouvelle vit aux deux endroits). |
| `scheduledTasks.js` | — | — | (aucun) |

**Notes :**
- `utils/accountingExport.js` reste **pur** (aucun accès DB) : le compte et le taux arrivent dans
  l'entrée construite par `accountingModel`, comme le fait déjà le contexte commission.
- Aucune nouvelle dépendance npm.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `IcalCancellationAlert.jsx` | T | « Supprimer » ouvre le dialogue indemnité au lieu d'appeler l'API directement ; transmet le payload à `approveIcalCancellation`. |
| `components/` | `CancellationCompensationDialog.jsx` | C | Dialogue unique à 3 modes (`ask` à l'approbation / `edit` / `receive`) : montant, date, note. Spécifique métier. |
| `components/` | `CancellationCompensationsPendingAlert.jsx` | C | Alerte dashboard listant les indemnités en attente + actions Encaisser / Modifier / Supprimer. |
| `components/` | `CancellationCompensationsSection.jsx` | C | Carte de la page Comptabilité : encaissées du mois + en attente, lecture seule pour le rôle comptable. |
| `pages/` | `Dashboard.jsx` | T | Monte l'alerte des indemnités en attente sous les alertes iCal existantes. |
| `pages/` | `AccountingPage.jsx` | T | Monte la section « Indemnités d'annulation » ; le libellé de nature `compensation` rejoint `KIND_LABELS` / badge. |
| `pages/` | `PlatformAccountsPage.jsx` | T | Nouvelle carte « Indemnités d'annulation » : compte éditable + rappel **lecture seule** du taux de TVA. |
| `pages/` | `SettingsPage.jsx` | T | Câble `vat.rateCancellationCompensation` (état + mapping d'erreurs). |
| `components/` | `SettingsVatSection.jsx` | T | Troisième champ de la carte « Taux de TVA ». |
| `api.js` | `api.js` | T | 6 méthodes CRUD + le corps optionnel de `approveIcalCancellation`. |
| `hooks/` `utils/` `constants/` `styles/` | — | — | (aucun) |

**Component reuse declaration (mandatory) :**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `ConfirmDialog`, `DateField`, `ArithmeticTextField`, `StatusBadge`, `EmptyState`, `ResponsiveTable`, `PlatformChip`, `LoadingState`, `ErrorAlert`, `PageActionBar`, `useToast` | Rien de nouveau à inventer : le dialogue est un `FormDialog`, le montant un `ArithmeticTextField` (saisie à la virgule / calcul), la date un `DateField`, la liste une `ResponsiveTable` (table `md+`, cartes `xs`). |
| **Created (new generic)** | — | Aucun composant générique nécessaire. |
| **Specific (kept feature-local)** | `CancellationCompensationDialog`, `CancellationCompensationsPendingAlert`, `CancellationCompensationsSection` | Les trois portent des règles métier propres à l'indemnité (états `pending`/`received`, verrouillage, mois comptable) ; ce sont des compositions de génériques, pas de nouveaux primitifs visuels. |

### 4.3 API contract

Toutes les routes exigent une session authentifiée. Lecture : `admin` + `accountant`. Écriture :
`admin` seul (403 `FORBIDDEN_ROLE` sinon, via le guard existant).

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/dashboard/ical-cancellation/:id/approve` | `{ compensation?: { expectedAmount, expectedDate?, notes? } }` | `{ ok: true, outcome, compensationId: number \| null }` | Corps **optionnel** — sans lui, comportement strictement actuel. Transaction unique. 404 / 409 inchangés. |
| GET | `/api/accounting/cancellation-compensations?month=&year=` | — | `{ pending: [Compensation], received: [Compensation], totals: { pendingExpected, receivedInMonth } }` | `month`/`year` filtrent **uniquement** `received` (les `pending` n'ont pas de mois). 400 `INVALID_MONTH_OR_YEAR`. |
| POST | `/api/accounting/cancellation-compensations` | `{ propertyId?, propertyName, platform, clientFirstName?, clientLastName, startDate?, endDate?, expectedAmount, expectedDate?, notes? }` | `{ compensation }` | Création manuelle (pas d'alerte iCal derrière). |
| PUT | `/api/accounting/cancellation-compensations/:id` | mêmes champs que POST | `{ compensation }` | **409 `COMPENSATION_LOCKED`** si `status = 'received'`. |
| POST | `/api/accounting/cancellation-compensations/:id/receive` | `{ receivedAmount, receivedDate }` | `{ compensation }` | 409 si déjà `received`. 400 `RECEIVED_DATE_IN_FUTURE`. |
| POST | `/api/accounting/cancellation-compensations/:id/reopen` | — | `{ compensation }` | 409 si déjà `pending`. Efface `receivedAmount` / `receivedDate`. |
| DELETE | `/api/accounting/cancellation-compensations/:id` | — | `{ ok: true }` | 409 `COMPENSATION_LOCKED` si `received`. 404 si inconnue. |

`Compensation` :
```json
{
  "id": 3, "status": "pending",
  "reservationId": 12345, "cancellationAlertId": 8,
  "propertyId": 2, "propertyName": "Le Lodge", "platform": "Airbnb",
  "clientFirstName": "Claire", "clientLastName": "Notin",
  "startDate": "2026-09-04", "endDate": "2026-09-07",
  "cancelledStayAmount": 612.50,
  "expectedAmount": 84.00, "expectedDate": "2026-08-26",
  "receivedAmount": null, "receivedDate": null,
  "overdue": false, "notes": "",
  "createdAt": "2026-08-19 10:12:00", "updatedAt": "2026-08-19 10:12:00"
}
```
`overdue` est **calculé côté serveur** (`expectedDate < aujourd'hui` et `status = 'pending'`) — le
client se contente de choisir la couleur du badge.

---

## 5. Data model

**Nouvelle table** (bloc idempotent dans `server/src/database.js`) :

```sql
CREATE TABLE IF NOT EXISTS cancellation_compensations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  cancellationAlertId INTEGER UNIQUE,                 -- ical_cancellation_alerts.id ; NULL = saisie manuelle
  reservationId       INTEGER,                        -- id historique, PAS une clé étrangère (la résa est supprimée)
  propertyId          INTEGER,                        -- informatif, jamais joint en dur
  propertyName        TEXT    NOT NULL DEFAULT '',    -- instantané : survit à la suppression du logement
  platform            TEXT    NOT NULL DEFAULT '',
  clientFirstName     TEXT    NOT NULL DEFAULT '',
  clientLastName      TEXT    NOT NULL DEFAULT '',
  startDate           TEXT,                           -- séjour annulé (contexte)
  endDate             TEXT,
  cancelledStayAmount REAL,                           -- finalPrice de la résa au moment de l'annulation
  expectedAmount      REAL    NOT NULL DEFAULT 0,
  expectedDate        TEXT,
  receivedAmount      REAL,
  receivedDate        TEXT,                           -- DATE COMPTABLE quand status='received'
  status              TEXT    NOT NULL DEFAULT 'pending',  -- 'pending' | 'received'
  notes               TEXT    NOT NULL DEFAULT '',
  createdAt           TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cancellation_comp_status ON cancellation_compensations (status);
CREATE INDEX IF NOT EXISTS idx_cancellation_comp_received ON cancellation_compensations (receivedDate);
```

**Colonnes `app_settings`** (via l'helper idempotent `tryAddAppSettingsCol` existant) :

| Colonne | Type | Défaut | Rôle |
|---|---|---|---|
| `cancellationCompensationAccount` | TEXT NOT NULL | `'75880000'` | Compte de produit crédité par une indemnité encaissée. |
| `vatRateCancellationCompensation` | REAL NOT NULL | `0` | Taux de TVA appliqué à l'indemnité. `0` = hors champ (défaut retenu). |

**Migration :** purement additive. Aucune colonne existante touchée, aucune donnée réécrite, aucun
backfill (il n'existe aucune indemnité passée à récupérer — l'annulation en cours sur la prod sera la
première, saisie à la main ou via l'approbation quand Adrien validera l'alerte).

**Data impact :** nul sur l'existant. Le seul changement de comportement sur des données existantes
est que `approve()` peut désormais créer une ligne supplémentaire — dans la même transaction que la
suppression, donc jamais de demi-état.

---

## 6. UI / UX

### 6.1 Dashboard — dialogue d'approbation

Le clic sur **« Supprimer »** d'une carte d'annulation iCal ouvre un `FormDialog` :

```
┌──────────────────────────────────────────────┐
│ Annulation — indemnité attendue ?            │
├──────────────────────────────────────────────┤
│ Claire Notin · Le Lodge                      │
│ Du 04/09/2026 au 07/09/2026 · Airbnb         │
│ Séjour annulé : 612,50 €                     │
│                                              │
│ ( ) Aucune indemnité                         │
│ (•) Indemnité attendue de la plateforme      │
│     Montant attendu (€)  [   84,00 ]         │
│     Versement prévu le   [ 26/08/2026 ]      │
│     Note (facultatif)    [            ]      │
│                                              │
│ La réservation sera supprimée dans tous les  │
│ cas.                                         │
│                          [Annuler] [Valider] │
└──────────────────────────────────────────────┘
```

- Option par défaut : **« Aucune indemnité »** (cas le plus fréquent) → un clic + Valider suffit.
- Les champs montant/date/note ne sont montés que sur le second choix.
- `fullScreen` sur `xs`, largeur `sm` au-dessus. Boutons empilés en colonne sur `xs`.

### 6.2 Dashboard — alerte « Indemnités d'annulation en attente »

`<Alert severity="info" variant="outlined">`, même grammaire visuelle que les alertes iCal
existantes, affichée **seulement** s'il y a au moins une fiche `pending`, sous les alertes iCal.

```
Indemnités d'annulation — 1 versement en attente
──────────────────────────────────────────────────
Claire Notin · Le Lodge                        [✕]
Du 04/09 au 07/09 · Airbnb
Attendu : 84,00 €  ·  prévu le 26/08   [En retard]
[ Encaisser ]  [ Modifier ]
```

- **« Encaisser »** ouvre le dialogue mode `receive` : *Montant versé* (pré-rempli avec l'attendu) +
  *Date du versement* (pré-remplie à aujourd'hui). Valider ⇒ toast « Indemnité encaissée », la ligne
  disparaît de l'alerte.
- **« Modifier »** ouvre le même dialogue en mode `edit`.
- **✕** supprime après `ConfirmDialog` (« Supprimer cette indemnité ? Elle ne sera plus attendue. »).
- Badge `StatusBadge` : « En retard » (orange) si `overdue`, « En attente » (neutre) sinon.
- Sur `xs` : une carte par indemnité, boutons pleine largeur empilés.

### 6.3 Comptabilité — section « Indemnités d'annulation »

Nouvelle `Card` sous « Encaissements du mois », pilotée par le `MonthYearPicker` déjà en place :

- **Encaissées en <mois>** — `ResponsiveTable` : Date · Logement · Client · Plateforme · Montant, avec
  un total en pied. Table sur `md+`, cartes empilées sur `xs`.
- **En attente** (sous-titre séparé, indépendant du mois) — mêmes colonnes, colonne Date = date
  **prévue**, badge « En retard » si dépassée.
- Chaque ligne encaissée ouvre en lecture le détail (montant attendu vs versé, note) ; pour un
  **admin** deux actions : « Rouvrir » (avec avertissement CSV déjà transmis) et « Modifier » une fois
  rouverte. Pour le rôle **comptable** : lecture seule, aucun bouton d'action.
- `EmptyState` : « Aucune indemnité d'annulation ce mois-ci. »
- L'indemnité encaissée apparaît **aussi** dans la carte « Détail des écritures du mois » comme une
  écriture normale, avec la puce de nature **« Indemnité »** (nouveau libellé dans `KIND_LABELS`,
  badge lettre **I**), et bien sûr dans le CSV téléchargé.

### 6.4 Plan comptable (`/comptabilite/plateformes`) + Réglages

Sur le **Plan comptable**, une carte « Indemnités d'annulation » sous « Compte par défaut » :

- `TextField` **« Compte indemnités d'annulation »** — défaut `75880000`, aide : « 6 à 8 chiffres
  (ex. 75880000, produits divers de gestion courante). » Enregistré par le PUT existant de la page.
- Une ligne **lecture seule** : « TVA appliquée aux indemnités : **0 %** (hors champ) » suivie du lien
  « ouvrir les Réglages » pour un admin, ou de « (réservé à un administrateur) » pour le comptable.
  Formulation volontairement distincte de celle de la TVA commissions : deux liens au libellé
  identique sur la même page seraient ambigus.

Dans **Réglages → Général → Taux de TVA**, un troisième champ sous les deux existants :

- `TextField` numérique **« TVA sur indemnités d'annulation (%) »** — défaut `0`, aide : « 0 % =
  indemnité hors champ de TVA (recommandé). À changer seulement si votre comptable demande à la
  soumettre à TVA. »

### 6.5 PageActionBar

Aucune page nouvelle. `AccountingPage` et `PlatformAccountsPage` conservent leur `PageActionBar`
existante (CSV / Save-Cancel) — aucune action de page à ajouter, les actions indemnité étant à
l'échelle de la ligne.

---

## 7. Test plan

### Server unit tests (`node --test`) — 48 tests ajoutés, suite à 3055 ✅

- [x] `tests/cancellation-compensations-model.unit.test.js` (11) — create / update pending / verrou
      `received` (update, delete, receive → `COMPENSATION_LOCKED`) / reopen efface montant + date /
      `listReceivedByMonth` borne bien le mois (1er inclus, 1er du suivant exclu) / tri des `pending`
      du plus en retard au sans-date / `overdue` jamais vrai une fois encaissée.
- [x] `tests/ical-cancellation-approve-compensation.unit.test.js` (6) — approve **sans** payload =
      suppression seule (non-régression) ; approve **avec** payload = résa supprimée + fiche créée avec
      l'instantané complet ; l'entrée d'historique reste écrite ; échec d'insertion ⇒ rollback (résa,
      mapping et alerte survivent) ; alerte déjà acquittée ⇒ 409 sans fiche ; réservation déjà
      supprimée ⇒ idempotent sans fiche.
- [x] `tests/accounting-compensation-entry.unit.test.js` (10) — 2 lignes équilibrées à 0 % ; 3 lignes
      (débit client + HT + TVA) à 10 % ; arrondi qui tombe juste au centime ; le compte suit le
      réglage ; mois = date de versement ; `pending` invisible ; libellé de repli ;
      `classifyLine('75880000') === 'revenue'` ; jamais de ligne de commission.
- [x] `tests/accounting-compensation-month-stream.unit.test.js` (5) — l'indemnité apparaît dans le JSON
      **et** dans le CSV, triée à sa date parmi les encaissements ; totaux du mois ; un modèle sans
      `compensationsByMonth` exporte quand même.
- [x] `tests/cancellation-compensations-controller.unit.test.js` (15) — bornes du mois (décembre →
      année suivante), montants (négatif, > 100 000, non numérique, 0 accepté à l'attendu / refusé au
      versement), dates (format, futur, année mal tapée), plateforme requise, 400 / 404 / 409.
- [x] `tests/enforce-role-access.unit.test.js` — dérive du guard : le comptable peut GET les
      indemnités, aucune de ses écritures ne passe.
- [x] `tests/dashboard-controller-ical-cancellation.unit.test.js` — 3 cas de plus : corps absent ⇒
      `null` au modèle, payload validé transmis (arrondi + trim), payload invalide ⇒ 400 sans
      suppression.

### Client (`npx vitest run`) — suite à 985 ✅

- [x] `components/__tests__/IcalCancellationAlert.compensation.test.jsx` (4) — « Supprimer » ouvre la
      question au lieu de supprimer ; la réponse par défaut approuve **sans** payload ; l'indemnité
      déclarée part avec son montant ; un échec serveur conserve la carte.
- [x] `components/__tests__/CancellationCompensationsSection.test.jsx` (5) — les deux listes et leurs
      totaux, le badge « En retard », le rôle comptable sans aucun bouton, l'encaissement qui poste le
      montant + la date puis recharge, l'état vide.
- [x] `pages/__tests__/PlatformAccountsPage.test.jsx` (2 de plus) — compte indemnité éditable et
      transmis au PUT, TVA affichée « hors champ », comptable autorisé sur le compte.

### Manual UI verification (`npm run dev`) — fait le 2026-08-19 (Chrome, compte admin de dev)

- [x] Happy path : approuver l'annulation en cours avec indemnité → fiche en attente au dashboard →
      « Encaisser » avec la date du jour → l'écriture apparaît dans le journal du mois + le CSV.
- [x] Edge : approuver **sans** indemnité → comportement strictement identique à aujourd'hui.
- [x] Edge : rouvrir une indemnité encaissée → elle quitte le journal du mois **immédiatement** et
      revient en attente avec son montant attendu (le versé est effacé).
- [x] Edge : montant versé ≠ montant attendu (84,00 € annoncés, 79,20 € versés) → accepté, c'est le
      versé qui part en compta.
- [x] CSV du mois téléchargé : les 2 lignes (débit `CNOTINT` 79,20 / crédit `75880000` 79,20) au
      format du comptable.
- [x] Mobile (390 px) : dialogue plein écran, alerte dashboard en cartes avec boutons empilés, section
      Comptabilité en cartes, `scrollWidth === clientWidth` (aucun défilement horizontal).
- [x] Régression : alerte d'annulation iCal restante intacte, encaissements du mois, Plan comptable,
      Réglages → Taux de TVA. Zéro erreur console.
- [x] `npm run test:e2e` (Playwright) : 62 passés, 1 ignoré.

## 8. Out of scope

- **Suivi financier** (`/finance`) : le CA, les projections et les tableaux opérationnels **ne
  comptent pas** les indemnités en v1. Elles n'ont ni séjour, ni nuitées, ni logement occupé — les
  agrégats par logement/nuit deviendraient faux. À rouvrir si Adrien veut les voir dans le CA annuel.
- **Brut client + commission plateforme** sur l'indemnité (arbitrage explicite : net versé seul).
- **Réconciliation automatique** avec les mouvements bancaires Qonto.
- **Acompte déjà encaissé et conservé** sur une réservation directe : ce cas passe par la
  réservation elle-même et, si besoin, par les avoirs
  ([reservation-refunds.md](specs/reservation-refunds.md)).
- **Notification e-mail / push** quand un versement tarde.
- **Conservation de la réservation annulée** (statut « annulée ») : arbitrage explicite, la
  suppression reste le comportement.
- **Taxe de séjour** : une annulation n'en génère pas.

## 9. Open questions

- Q : Le compte `75880000` (« Produits divers de gestion courante ») est-il celui que le comptable
  veut voir, ou préfère-t-il un `7588xxxx` dédié, voire un `708xxxx` ?
  - A : à confirmer par Adrien auprès du comptable. **Sans blocage** : la valeur est un réglage
    modifiable sur la page Plan comptable, une seule saisie suffit à corriger le passé **et** le futur
    (l'écriture est construite à la lecture, pas figée en base).
- Q : L'indemnité doit-elle être soumise à TVA ?
  - A : défaut **hors TVA** (0 %), sur la base de l'arrêt CJUE *Société thermale d'Eugénie-les-Bains*
    (C-277/05) : les arrhes conservées en cas de désistement sont une indemnité forfaitaire de
    résiliation, hors champ de la TVA. Le taux est paramétrable si le comptable tranche autrement.
- Q : Le débit doit-il aller sur le compte client auxiliaire `C<NOM>` (choix retenu, cohérent avec
  toutes les autres écritures) ou sur un compte de tiers « plateforme » ?
  - A : `C<NOM>` en v1 ; à revoir seulement si le comptable le demande — c'est un changement d'une
    ligne dans `compensationEntryToRows`.
