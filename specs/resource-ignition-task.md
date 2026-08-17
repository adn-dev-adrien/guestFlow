# Une tâche « démarrer » la veille pour une ressource à chauffer

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/resource-ignition-task` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [hourly-resource-quantity-and-sas-scheduling.md](hourly-resource-quantity-and-sas-scheduling.md) §3.3, [resource-hourly-scheduling.md](resource-hourly-scheduling.md) |

---

## 1. Context

Le bain nordique met des heures à monter en température : la ressource porte déjà ce délai
(`resources.heatUpMinutes`, « Montée en chauffe ») et le SAS d'arrivée s'en sert pour n'offrir que des
créneaux réellement chauds. Mais **personne ne rappelle d'allumer**. Une séance à 9 h avec 8 h de chauffe
doit être démarrée **la veille à 1 h du matin** — autant dire que si le planning ne le dit pas la veille,
c'est raté.

Issue **#13** : *« Pour une ressource complexe, pour par exemple le bain nordique il faut le démarrer 8 h
avant. Donc si nous avons au moins une réservation un matin, il faut ajouter une tâche dans planning pour
démarrer le bain nordique la veille. En revanche si la réservation est l'après-midi ce n'est pas
nécessaire car on le démarre le matin même. »*

## 2. Goal

Le planning porte, **le jour où il faut allumer**, une tâche « Démarrer <la ressource> » pour chaque
séance qui ne peut pas être chauffée le jour même.

## 3. Functional rules

1. **Heure d'allumage** d'une séance qui démarre à `S` le jour `D` : `S − heatUpMinutes`. Le délai vient
   de la ressource — rien n'est codé en dur : une ressource sans montée en chauffe (`0`, le défaut)
   n'engendre jamais de tâche.
2. **La tâche n'existe que si l'allumage n'est pas faisable dans la journée de travail.** La journée de
   l'exploitant commence à **08:00** : un allumage calculé avant cette heure n'est pas « le matin même »,
   il se fait la veille au soir.
   - Séance à **9 h** avec 8 h de chauffe → allumage à **01:00**, en pleine nuit → **tâche la veille**,
     placée **en fin de journée** (le créneau sans heure du planning, donc le soir).
   - Séance à **6 h** → allumage à **22:00 la veille** → tâche la veille, **à 22:00**, à sa place dans le
     fil de la soirée.
   - Séance à **17 h** → allumage à **09:00 le jour même** → **aucune tâche** : on l'allume le matin
     même, comme le dit l'issue.
3. **Une ressource encore chaude n'est pas rallumée.** Si une autre séance de la même ressource se
   termine dans les `heatRetentionMinutes` qui précèdent le début de la séance, la ressource est encore
   en température (le « hot path » du modèle thermique) : pas de tâche. Sinon la carte réclamerait un
   feu inutile après une soirée d'utilisation.
4. **La tâche est une carte de planning comme les autres** : même thème « ressource », placée à son
   heure d'allumage dans le fil chronologique de sa journée — ou **en fin de journée** quand l'allumage
   tombe dans la nuit qui suit — avec sa **coche**, donc comptée dans le compteur de tâches du jour
   ([planning-day-task-count.md](planning-day-task-count.md)).
5. **Libellé** : « Démarrer <nom de la ressource> », suivi du client et du logement de la séance, et de
   la séance qu'elle prépare : « pour demain 09:00 » (ou « dans 2 jours » au-delà).
6. **La coche est indépendante** de celle de la séance : allumer la veille et préparer le lendemain sont
   deux gestes. Elle est stockée dans la séance elle-même (`ignitionDone`), donc suit la séance quand
   elle est déplacée ou supprimée.
7. **Une séance déplacée ou supprimée emporte sa tâche** : les cartes sont dérivées des séances à chaque
   lecture, jamais stockées à part.

**Edge cases:**
- `heatUpMinutes = 0` (toute ressource non thermique) → aucune tâche, comportement inchangé.
- Allumage tombant deux jours avant (chauffe > 24 h) → la tâche est posée le jour calculé, à son heure.
- **08:00 est une constante du modèle**, documentée ici : si l'exploitation change d'horaires, elle
  deviendra un réglage — pas la peine d'un écran pour un seuil qui n'a jamais bougé.
- Deux séances le même matin → une seule tâche : la seconde est couverte par la rétention (rule 3).
- Une séance déjà cochée « préparé » garde sa tâche d'allumage telle quelle (les deux coches sont
  indépendantes).

---

## 4. Architecture

> **Fat backend.** Le calcul (heure d'allumage, jour antérieur, rétention) est fait par le modèle des
> cartes ; le client rend une carte de plus dans le flux du jour.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/planningResourceCardsModel.js` | T | Lit `heatUpMinutes` / `heatRetentionMinutes` (colonnes gardées) ; émet, en plus de la carte de séance, une carte `kind: 'ignition'` sur le jour d'allumage quand il est antérieur et que la ressource est froide ; `setSessionDone` accepte la coche `ignitionDone`. |
| `controllers/` | `controllers/planningController.js` | T | Le toggle transporte le `kind` pour viser la bonne coche. |
| `routes/` | — | — | (aucune — même endpoint) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/PlanningPage.jsx` | T | Rend la carte d'allumage dans le fil du jour (thème ressource, libellé « Démarrer … »), et transmet le `kind` au toggle. |

### 4.3 API contract

`GET /api/planning/resource-cards` — chaque item gagne `kind: 'session' | 'ignition'` ; une carte
d'ignition porte en plus `cardDate` (le jour où elle s'affiche), `ignitionAt` (l'heure d'allumage
calculée), `dayOffset` (combien de jours la séparent de la séance), `sessionDate` / `sessionStart`, et
sa propre coche. `time` est `null` quand l'allumage tombe dans la nuit : la carte va en fin de journée.
`POST …/done` accepte `kind` (défaut `session`).

---

## 5. Data model

Aucune migration : la coche d'allumage vit dans le JSON `reservation_resources.sessions`
(`{ date, start, end, done, ignitionDone }`), comme la coche de préparation.

## 6. UI / UX

Une carte « ressource » de plus, à son heure d'allumage : « **Démarrer Bain nordique** — pour 09:00 »
avec le client et le logement, et sa coche. Rien d'autre ne bouge.

## 7. Test plan

### Server unit tests (`server/src/tests/resource-ignition-task.unit.test.js`, 7 tests)
- [x] Séance le matin (09:00) + 8 h de chauffe → carte la veille, en fin de journée, `ignitionAt = 01:00`.
- [x] Séance l'après-midi → aucune carte (allumage le matin même).
- [x] `heatUpMinutes = 0` → aucune carte (non-régression).
- [x] Ressource encore chaude (séance précédente dans la rétention) → aucune carte.
- [x] Allumage tombant réellement la veille au soir (séance à 06:00) → carte à 22:00, à sa place.
- [x] Chauffe > 24 h → la carte tombe deux jours avant, à son heure.
- [x] La carte n'apparaît que si son jour est dans la fenêtre demandée.
- [x] `setSessionDone({ kind: 'ignition' })` coche `ignitionDone` sans toucher `done`.

### Manual UI verification
- [x] Séance du bain nordique planifiée un matin : la tâche « Démarrer » apparaît la veille dans le
      planning. Screenshot in the PR.

## 8. Out of scope

- Une tâche d'allumage **le jour même** (l'issue dit explicitement que ce n'est pas nécessaire).
- Les réservations de ressource « hors séjour » (`resource_bookings`) : la rétention ne regarde que les
  séances des réservations. À reprendre si l'usage montre des allumages inutiles.
- Une notification push pour l'allumage (le planning suffit pour l'instant).

## 9. Open questions

None.
