# Prestations vendues en cours de séjour → complément de fin de séjour

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/mid-stay-extras-to-end-of-stay-complement` _(user-managed)_ |
| **Created** | 2026-08-06 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A reservation is collected through four buckets: **acompte**, **solde**, **complément d'arrivée**
(`complementAmount`), **complément de fin de séjour** (`endOfStayComplementAmount` +
`endOfStayComplementDetail` JSON, written by the departure SAS —
[cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md)).

Each bucket **freezes** once it is marked paid:

- deposit / balance: [pricing.js:1723](../server/src/utils/pricing.js#L1723) and
  [pricing.js:1751](../server/src/utils/pricing.js#L1751) — `depositPaid && balancePaid` → the two
  amounts are re-emitted verbatim;
- arrival complement: [pricing.js:1785](../server/src/utils/pricing.js#L1785) — `complementPaid` →
  `resolvedComplementAmount = complementAmount` (stored value).

Consequence: **a prestation sold while the guest is already in the property is billed nowhere.**
Verified against the real engine (2 nights × 100 €, acompte 60 + solde 140 réglés, complément
d'arrivée réglé, puis ajout d'une option à 24 €) :

| | avant | après |
|---|---|---|
| `totalStayPrice` | 200 € | **224 €** |
| acompte + solde + complément | 60 + 140 + 0 = 200 € | 60 + 140 + 0 = **200 €** |
| `sejourNetTotal` (« Total perçu » de la fiche, résa plateforme) | 200 € | **200 €** |

Les 24 € ne sont réclamés nulle part, et sur une résa plateforme (où les extras sont routés par
défaut dans le complément — [force-extras-complement-on-platform.md](force-extras-complement-on-platform.md))
l'option disparaît même du total affiché sur la fiche.

Trois conséquences en aval :

1. **Encaissement** : `remainingToPay` ([reservationSettlement.js:69](../server/src/utils/reservationSettlement.js#L69))
   somme les quatre buckets → la réservation est « soldée » alors qu'il reste 24 € à percevoir.
2. **Compta** : `sumComplementContribution` ([accountingModel.js:519](../server/src/models/accountingModel.js#L519))
   attribue à l'écriture `complement` **la totalité** du TTC d'une ligne `inComplement`, alors que le
   débit client de cette écriture vaut le `complementAmount` **gelé**. L'écriture crédite donc plus de
   produit qu'elle ne débite : Σ crédits > débit.
3. **Suivi financier** : `totalSejour` ([financeModel.js:49](../server/src/models/financeModel.js#L49))
   somme les mêmes buckets → le CA de la période ignore la prestation vendue.

Deux mécanismes existants sont réutilisés tels quels :

- le complément de fin de séjour sait déjà porter des lignes écrites **hors SAS de départ** : une
  ligne taguée `source` est affichée, comptée et **renvoyée verbatim** par le SAS de départ
  (`carriedEndOfStayLines`, [ReservationSasDialog.js:514](../client/src/components/sas/ReservationSasDialog.js#L514)) —
  c'est ce que fait déjà le linge de toilette différé ([sas-bath-linen-upsell.md](sas-bath-linen-upsell.md)) ;
- le moteur sait déjà **extraire un sous-ensemble de lignes** du circuit pré-arrivée : c'est ce que
  fait `complementOptionsResourcesTotal` / `forcedItemsTotal`
  ([pricing.js:1510](../server/src/utils/pricing.js#L1510), [pricing.js:1661](../server/src/utils/pricing.js#L1661))
  pour les lignes routées au complément.

## 2. Goal

Toute prestation vendue **après l'arrivée du client** (option, ressource, ligne personnalisée) est
facturée dans le **complément de fin de séjour**, détaillée ligne par ligne, visible sur la **fiche de
réservation** et dans le **SAS de départ**, et encaissée au check-out — que le complément d'arrivée
ait été réglé ou non.

## 3. Functional rules

### 3.1 Base de référence (« ce qui était vendu à l'arrivée »)

1. La réservation porte une **base de référence** `arrivalExtrasBaseline` : un instantané JSON
   `{ clé de ligne → montant TTC }` des extras (options + ressources + lignes personnalisées) tels
   qu'ils étaient **au moment où le complément d'arrivée s'est fermé** — c'est-à-dire au début du
   séjour, **ou à l'encaissement du complément d'arrivée si celui-ci vient en premier** (élargi le
   2026-08-22, voir la règle 3bis). `NULL` tant qu'aucun des deux n'est arrivé.
2. **Clé de ligne** : `opt:<optionId>`, `res:<resourceId>`, `custom:<libellé normalisé>` (trim +
   minuscules + espaces compactés). Deux lignes personnalisées de même libellé sont agrégées sur la
   même clé, de façon identique côté base et côté état courant.
3. **Capture** — la base est écrite une seule fois, paresseusement, jamais recalculée globalement :
   - à la **création** d'une réservation dont `startDate ≤ aujourd'hui` (saisie a posteriori,
     walk-in, import iCal d'un séjour en cours) → base = les extras créés (donc aucun extra
     « en cours de séjour ») ;
   - à la **première sauvegarde** de la fiche à partir de `startDate` alors que la base est `NULL` →
     base = l'état des extras **avant** cette sauvegarde. Une option ajoutée dans cette même
     sauvegarde est donc bien détectée comme vendue en cours de séjour.
3bis. **Un complément d'arrivée encaissé ferme le bucket, quelle que soit la date.** La capture était
   gardée par le seul calendrier, et il manquait le cas qui perd de l'argent : le moteur **gèle** un
   complément encaissé, donc une prestation vendue après ne peut plus y entrer — et sans base de
   référence elle n'entrait nulle part non plus. Constaté en production le 2026-08-22 sur une
   réservation à venir dont le complément avait été encaissé : ajouter une option de 30 € montait le
   « total du séjour » de 30 € pendant que la somme des échéances restait inchangée. Trente euros
   vendus que personne n'aurait réclamés.

   La base est donc écrite aussi :
   - **à l'encaissement** du complément d'arrivée (`complementPaid` ou `complementPaidCash` passant à
     1, depuis la fiche comme depuis la réception) → base = les extras du moment ;
   - et le même élargissement vaut pour la **résolution paresseuse** du devis live, sans quoi l'aperçu
     perdrait l'argent jusqu'au prochain enregistrement.

   Corollaire opérateur, demandé explicitement : « si le complément d'arrivée est payé et que j'ajoute
   une option, elle doit aller dans un complément de fin de séjour ». C'est exactement ce que produit
   la règle.
4. **Le SAS d'arrivée alimente la base**, il ne la remplace pas : les lignes que
   `commitArrivalSas` écrit (linge manquant, ménage / linge de toilette activés au SAS — toutes
   taguées `sasArrivalOrigin`) sont, à la fin du commit, **reportées dans la base à leur montant
   courant**. Elles appartiennent au complément d'**arrivée** par construction et ne doivent jamais
   basculer en fin de séjour, y compris lorsque le SAS est ré-ouvert et re-commité plus tard.
5. Une ligne **offerte** (`offered = 1`, montant 0) ne participe ni à la base ni au calcul.

### 3.2 Part « vendue en cours de séjour »

6. Pour chaque ligne d'extra de clé `k` et de total TTC `T` : `midStay(k) = max(0, T − base[k])`
   (`base[k] = 0` si la clé est absente). La part `min(T, base[k])` reste routée comme aujourd'hui.
   Le découpage est **au montant**, pas à la ligne : passer une option de 1 à 2 unités pendant le
   séjour ne bascule que l'unité ajoutée.
7. Retirer ou réduire une ligne ramène `midStay(k)` à 0 (jamais de montant négatif) ; le complément
   de fin de séjour diminue d'autant.
8. `midStayTotal = Σ midStay(k)`, `midStayForced = Σ midStay(k)` sur les lignes `inComplement = 1`,
   `midStayUnforced = midStayTotal − midStayForced`.

### 3.3 Routage — la part « en cours de séjour » quitte les trois autres buckets

9. Le moteur retire la part « en cours de séjour » du circuit pré-arrivée **et** du complément
   d'arrivée (formules ; à `midStayTotal = 0` elles se réduisent exactement aux formules actuelles,
   donc aucune régression sur les réservations sans vente en cours de séjour) :

   ```
   accommodationPreArrival = finalPrice − forcedItemsTotal − midStayUnforced
   preArrivalAmount        = accommodationPreArrival + taxInPreArrival
   complementForced        = forcedItemsTotal − midStayForced
   autoGap                 = max(0, totalStayPrice − acompte − solde
                                    − complementForced − taxInComplement − midStayTotal)
   complementAmount        = complementForced + taxInComplement + autoGap   (règles de gel inchangées)
   ```

10. Le moteur expose `midStayExtrasTotal` + `midStayExtrasLines` (détail) et
    `endOfStayComplementTotal = endOfStaySasAmount + midStayExtrasTotal`, où `endOfStaySasAmount` est
    la somme des lignes **non** `midStayExtra` déjà stockées dans `endOfStayComplementDetail`
    (ménage de fin de séjour, linge manquant, extincteur, linge de toilette différé…).

### 3.4 Persistance et affichage

11. À chaque sauvegarde de la réservation, le serveur **resynchronise** le complément de fin de
    séjour : les lignes `source = 'midStayExtra'` de `endOfStayComplementDetail` sont **remplacées**
    par `midStayExtrasLines`, les autres lignes sont conservées telles quelles, et
    `endOfStayComplementAmount = Σ des lignes`. Le calcul est **dérivé** (recalculé depuis la base à
    chaque fois), jamais incrémental : il s'auto-corrige.
12. Chaque prestation vendue en cours de séjour est **une ligne** :
    `{ label, qty, unitPrice, amount, source: 'midStayExtra', key }`. `qty`/`unitPrice` sont
    renseignés quand le montant bascule sur un nombre entier d'unités (« Petit-déjeuner : 2 × 12 € =
    24 € ») ; sinon `qty = 1` et `unitPrice = amount`.
13. **Fiche de réservation** : le bloc « Complément de fin de séjour » existant s'affiche dès que
    `endOfStayComplementAmount > 0` et liste déjà les lignes du détail — les prestations vendues en
    cours de séjour y apparaissent donc avec leur libellé, sans nouveau bloc.
14. **SAS de départ** : les lignes taguées `source` sont déjà affichées dans le récapitulatif, comptées
    dans le total à percevoir et renvoyées verbatim au commit — les prestations vendues en cours de
    séjour sont donc encaissées au check-out avec le reste (`complementsSettled`).
15. **« Total du séjour » de la fiche** : `sejourNetTotal = netReçu + complementAmount +
    endOfStayComplementTotal`. Aujourd'hui la fiche exclut le complément de fin de séjour alors que la
    page Finances l'inclut déjà (`totalSejour`) : les deux écrans se contredisent. Le complément de fin
    de séjour **entier** (y compris ménage / linge / extincteur du SAS de départ) entre dans le total.
16. **Compta** : la part « en cours de séjour » d'une ligne est exclue de l'écriture `complement`
    (`sumComplementContribution` retranche `midStay(k)`) ; elle est déjà couverte par l'écriture
    `endOfStayComplement`, qui comptabilise le montant TTC forfaitaire au `vatRate` général sur le
    compte produit « options » (70600010). L'écriture `complement` redevient équilibrée.
17. **Suivi financier / reste à percevoir** : aucun changement de code — `totalSejour`,
    `comptaCollected`, `remainingToPay` et `isSettled` somment déjà les quatre buckets ; le montant
    bascule simplement du bucket « complément d'arrivée » vers « complément de fin de séjour ».

### 3.5 Gel

18. Une fois le complément de fin de séjour **encaissé** (`endOfStayComplementPaid = 1` ou
    `endOfStayComplementPaidCash = 1`), la resynchronisation s'arrête : `endOfStayComplementAmount` et
    ses lignes sont **figés**, et le moteur continue d'extraire exactement les parts **stockées**
    (pour qu'elles ne soient pas re-facturées ailleurs). Une prestation ajoutée après cet encaissement
    suit le routage normal (complément d'arrivée / solde), comme avant cette spec.
19. Pour facturer malgré tout une prestation après l'encaissement : l'opérateur **décoche « payé »**
    sur le bloc complément de fin de séjour de la fiche → la resynchronisation reprend, le montant se
    met à jour, il ré-encaisse. Un montant déjà encaissé n'est **jamais** modifié automatiquement
    (même règle que le complément d'arrivée, gelé au paiement).

**Edge cases:**

- Réservation en cours **sans base** (créée avant cette spec) → la base est capturée à la prochaine
  sauvegarde, à partir de l'état courant : rien n'est requalifié rétroactivement, les extras déjà
  vendus restent où ils sont. Aucun backfill.
- Sauvegarde de la fiche après l'arrivée **sans toucher aux extras** (changement d'heure de départ,
  note…) → base capturée, `midStayTotal = 0`, aucun effet.
- Prestation vendue **après la fin du séjour** (`endDate` passé) et complément de fin de séjour non
  encaissé → part « en cours de séjour », donc complément de fin de séjour : c'est bien là qu'elle
  sera encaissée. Encaissé → règle 18.
- Séjour **non encore commencé** (`startDate > aujourd'hui`) → base `NULL`, `midStayTotal = 0` :
  comportement strictement inchangé.
- Ligne offerte pendant le séjour (`offered = 1`) → montant 0, aucune ligne créée.
- La réservation est **verrouillée « passée / en cours »** ([admin-unlock-past-reservations.md](admin-unlock-past-reservations.md)) :
  ajouter une option depuis la fiche reste refusé (`PAST_RESERVATION_LOCKED`) tant que le réglage
  admin « Modifier les réservations passées » est à OFF. Décision 2026-08-06 : **le verrou n'est pas
  assoupli** par cette spec (le réglage est activé sur l'installation d'Adrien). Les upsells du SAS
  d'arrivée passent, eux, par `commitArrivalSas` et n'ont jamais été concernés par le verrou.
- Complément **d'arrivée** encaissé puis prestation vendue en cours de séjour → le complément
  d'arrivée reste gelé à son montant encaissé, la prestation part en fin de séjour. C'est le cas
  d'usage nominal de cette spec.
- Complément d'arrivée **différé au check-out** (`complementDeferredToCheckout = 1`,
  [defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md)) → inchangé : la
  fiche et le SAS présentent une seule collecte, la part « en cours de séjour » s'ajoute simplement au
  bucket fin de séjour de ce bloc fusionné.

---

## 4. Architecture

> **Fat backend, thin frontend.** Le découpage base/vente-en-cours-de-séjour, le routage entre buckets,
> la synchronisation du complément de fin de séjour et l'attribution comptable sont **intégralement**
> serveur. Le client n'affiche que des montants et des lignes déjà calculés.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `midStayExtras.js` | **C** | Fonctions pures : `extraLineKey`, `buildExtrasBaseline`, `splitMidStayExtras(lines, baseline)` → `{ total, forced, unforced, byKey, lines[] }`, `splitFromStoredLines` (variante gelée §3.5), `resolveMidStaySplit` (la décision « base ou lignes stockées », partagée par le moteur et la compta), `mergeMidStayIntoDetail`, `sasDetailAmount`, `storedMidStayLines`. Seul endroit où vivent les règles §3.1–§3.2 et §3.4 rules 11-12. |
| `utils/` | `pricing.js` | T | Nouvelles entrées `arrivalExtrasBaseline`, `endOfStaySasAmount`, `endOfStayComplementSettled`, `frozenMidStayLines`. Applique le routage §3.3 (retrait de `midStayUnforced` du pré-arrivée, de `midStayForced` du complément forcé, de `midStayTotal` de l'auto-gap) et expose `midStayExtrasTotal` / `midStayExtrasLines` / `endOfStayComplementTotal`. `sejourNetTotal` intègre `endOfStayComplementTotal` (§3.4 rule 15). |
| `controllers/` | `reservationsController.js` | T | `midStayQuoteInputs(reservationId)` : charge base + état du complément de fin de séjour et les passe au moteur (`calculate-price` en lecture seule, `update` après capture). `create`/`update` capturent la base (§3.1 rule 3) ; `update` appelle la resynchronisation après l'écriture des lignes. Routes inchangées. |
| `models/` | `reservationsModel.js` | T | `arrivalExtrasBaselineIsDue(row, today)` — le prédicat partagé « séjour commencé **ou** complément d'arrivée encaissé » (§3.1 rule 3bis) ; `readExtraLines`, `getArrivalExtrasBaseline`, `captureArrivalExtrasBaselineIfDue` (idempotente), `addKeysToArrivalExtrasBaseline`, `syncMidStayComplement` (fusion du détail + total, gelée quand le complément est encaissé). `commitArrivalSas` reporte ses propres lignes `sasArrivalOrigin` dans la base (§3.1 rule 4). Colonne gardée par `HAS_ARRIVAL_EXTRAS_BASELINE` (schémas de test minimaux). |
| `models/` | `accountingModel.js` | T | `sumComplementContribution` retranche la part « en cours de séjour » de chaque ligne — déduction **consommée** par clé pour que deux lignes personnalisées de même libellé se la partagent (§3.4 rule 16). La requête sélectionne `arrivalExtrasBaseline` + `endOfStayComplementDetail`, colonnes gardées par un `PRAGMA table_info`. `buildEndOfStayEntry` inchangé. |
| `models/` | `financeModel.js` | — | Aucun changement : `totalSejour` / `comptaCollected` somment déjà les quatre buckets. |
| `utils/` | `reservationSettlement.js` | — | Aucun changement : `remainingToPay` / `isSettled` idem. |
| `utils/` | `checkoutComplement.js` | — | Aucun changement : les lignes `midStayExtra` sont déjà agrégées par `parseDetail` avec `origin: 'endOfStay'`. |
| `database.js` | `database.js` | T | Migration idempotente : `arrivalExtrasBaseline TEXT DEFAULT NULL`. |

**Notes :** les routes restent minces. `midStayExtras.js` est le seul nouveau fichier et n'est composé
que de fonctions pures (aucun accès DB) — testables unitairement sans base.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PricingSummary.js` | T | Cascade des totaux : le brut absorbe la part SAS du complément de fin de séjour, la déduction « perçus sur place » couvre les deux compléments, et chacun revient sur sa propre ligne (« Complément d'arrivée (perçu sur place) » / « Complément de fin de séjour »). Direct : ligne « dont complément de fin de séjour ». |
| `components/sas/` | `ReservationSasDialog.js` | T | `carriedEndOfStayLines` transporte aussi la clé `key` de la ligne, pour que le commit du SAS de départ (qui réécrit tout le détail) ne perde pas le rattachement à l'extra — sans quoi le moteur reclasserait la part vendue en cours de séjour. Le reste (affichage + total + renvoi verbatim) fonctionnait déjà (§3.4 rule 14). |
| `components/reservation/` | `FinanceSection.js` | — | Aucun changement : le bloc « Complément de fin de séjour » et son détail existent déjà (§3.4 rule 13). |
| `pages/` | `ReservationPage.js` | — | Aucun changement : la sauvegarde quitte la fiche (retour planning / action différée), donc le bloc est rechargé à la réouverture ; le retour live avant sauvegarde passe par `PricingSummary`. Les 4 appels `calculatePrice` envoient déjà `reservationId`. |
| `api.js` | `api.js` | — | Aucun changement : la réponse du quote est passée telle quelle. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PricingSummary`, `StatusBadge` | Pré-existants. |
| **Created (new generic)** | — | Aucun composant créé : la fonctionnalité est serveur, l'affichage réutilise les blocs existants. |
| **Specific (kept feature-local)** | — | — |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/calculate-price` | inchangé (`reservationId` déjà envoyé) | `+ midStayExtrasTotal`, `+ midStayExtrasLines[]`, `+ endOfStayComplementTotal` ; `complementAmount` / `preArrivalAmount` / `sejourNetTotal` recalculés | Additif. Sans `reservationId` (devis, tunnel public) la base est absente → comportement inchangé. |
| PUT | `/api/reservations/:id` | inchangé | inchangé | Effet de bord : capture de la base + resynchronisation du complément de fin de séjour. |
| GET | `/api/reservations/:id` | — | inchangé (`r.*` porte la nouvelle colonne) | Le détail du complément de fin de séjour contient les lignes `midStayExtra`. |
| GET | `/api/accounting/sales[.csv]` | — | inchangé | L'écriture `complement` exclut la part vendue en cours de séjour ; l'écriture `endOfStayComplement` la porte. |

Auth : inchangée (les endpoints existants gardent leurs contrôles de rôle).

---

## 5. Data model

Bloc `ALTER TABLE` idempotent dans [database.js](../server/src/database.js) :

```sql
ALTER TABLE reservations ADD COLUMN arrivalExtrasBaseline TEXT DEFAULT NULL;
```

Contenu : JSON `{ "opt:9": 24, "res:3": 30, "custom:linge manquant": 18 }`, ou `NULL` tant que le
séjour n'a pas commencé.

**Data impact :** purement additif. Les lignes existantes valent `NULL` → aucune réservation n'est
requalifiée rétroactivement, aucun montant existant n'est recalculé. Le complément de fin de séjour
(`endOfStayComplementAmount` / `Detail`) n'est réécrit que lorsqu'une part « en cours de séjour » est
détectée, et jamais lorsqu'il est encaissé (§3.5). Aucun backfill, aucune perte.

## 6. UI / UX

- **Fiche de réservation → bloc « Complément de fin de séjour »** (existant) : apparaît dès qu'il y a
  un montant, avec le détail ligne par ligne.

  ```
  Complément de fin de séjour ............ 54,00 €
    Petit-déjeuner : 2 × 12,00 € = 24,00 €
    Location vélo : 30,00 €
    [ Marquer payé ]  [ Caisse interne ]   Payé le [ ____ ]
  ```

- **Fiche → PricingSummary (cascade des totaux)** : nouvelle ligne « Complément de fin de séjour »
  entre le complément d'arrivée et « Total perçu sur le séjour », affichée uniquement si le montant
  est > 0. Le total inclut désormais ce complément (§3.4 rule 15).
- **SAS de départ → récapitulatif** (existant) : les prestations vendues en cours de séjour sont
  listées avec les lignes du SAS et incluses dans le total à percevoir, encaissées par les boutons de
  règlement existants.
- **Copy (FR)** : libellé de ligne = le titre de l'option / ressource / ligne personnalisée
  (aucun libellé générique). Ligne de cascade : « Complément de fin de séjour ».
- **États** : aucun état vide/erreur/chargement nouveau — les blocs concernés existent et gèrent déjà
  le cas « aucun complément ».
- **Responsive :** aucune structure nouvelle ; les blocs touchés (bloc complément de la fiche, cascade
  du PricingSummary, récap du SAS) sont déjà en colonnes empilées `xs` / deux colonnes `md+`, et le
  dialogue SAS est déjà `fullScreen` sur `xs`. Vérification manuelle à 600 / 900 / 1200 px.
- **PageActionBar :** N/A — le changement vit à l'intérieur de pages existantes, aucune action de page
  ajoutée.

## 7. Test plan

### Server unit tests (`cd server && npm test` → **2333 verts**, +34)

- [x] `tests/mid-stay-extras.unit.test.js` (**new**, 14 tests) — `midStayExtras.js` pur : clé de ligne
      par type ; `max(0, T − base)` ; hausse de quantité → seule l'unité ajoutée bascule ;
      baisse/suppression → 0, jamais de négatif ; ligne offerte ignorée ; part non entière → montant
      forfaitaire (pas de « × » trompeur) ; `splitFromStoredLines` gelé ; `mergeMidStayIntoDetail`
      remplace les lignes `midStayExtra` et préserve ménage/extincteur/linge différé ; agrégation de
      deux lignes personnalisées de même libellé.
- [x] `tests/pricing-mid-stay-extras.unit.test.js` (**new**, 8 tests) — routage §3.3 : direct (option
      non forcée) et plateforme (option forcée) → `complementAmount` gelé, `midStayExtrasTotal = 12`,
      et l'invariant `acompte + solde + complément + fin de séjour = totalStayPrice` ; complément
      d'arrivée non réglé → bascule quand même (décision Q2) ; base `NULL` → moteur strictement
      identique à avant (non-régression, comparé quote à quote) ; complément de fin de séjour
      encaissé → parts stockées figées ; `sejourNetTotal` inclut le complément de fin de séjour, y
      compris avec une commission plateforme.
- [x] `tests/reservations-mid-stay-sync.unit.test.js` (**new**, 10 tests) — `readExtraLines` ;
      capture de la base (séjour futur → `NULL` / séjour commencé / idempotence) ; `commitArrivalSas`
      reporte ses lignes `sasArrivalOrigin` dans la base, y compris au re-commit sans avaler une vente
      du séjour ; resynchronisation du détail et du montant ; gel sur `endOfStayComplementPaid` **et**
      `…PaidCash`.
- [x] `tests/accounting-encaissements-integration.unit.test.js` (**extend**, +2) — l'écriture
      `complement` ne crédite que ce qu'elle encaisse (Σ crédits = débit) et l'écriture
      `endOfStayComplement` porte la vente ; contrôle : une option forcée **non** vendue en cours de
      séjour reste intégralement créditée au complément.

`financeModel` / `reservationSettlement` ne sont pas modifiés (ils somment déjà les quatre buckets) :
leur couverture existante suffit, aucun test ajouté.

### Client tests (`cd client && npx vitest run` → **774 verts**, +2)

- [x] `PricingSummary.commission.test.js` — nouvelle ligne « Complément de fin de séjour » (déduite du
      montant soumis à commission puis rajoutée au total perçu) ; cas direct (« dont complément de fin
      de séjour ») ; libellés de la cascade mis à jour dans le test existant.

### E2E (`npm run test:e2e`)

- [x] Suite existante verte (45 passed, 1 skipped) — aucun parcours nouveau.

### Manual UI verification — exécutée le 2026-08-06 sur le serveur de dev

- [x] Happy path : réservation Lodgify **en cours** (05→08/08), vente d'un « Ménage » 30 € depuis la
      fiche → base capturée `{"opt:8":7}` (le linge déjà vendu), `endOfStayComplementAmount = 30` avec
      la ligne `{label:"Ménage", amount:30, source:"midStayExtra", key:"opt:7"}`, **acompte 124,50 € et
      solde 310,90 € inchangés**, complément d'arrivée à 0.
- [x] Fiche : bloc « Complément de fin de séjour (30,00 €) » avec la ligne « Ménage : 30,00 € » +
      « Marquer complément payé » / « Caisse interne ».
- [x] Fiche → résumé tarifaire : Total du séjour 465,40 → − 30,00 (perçus sur place) → Montant soumis
      à commission 435,40 → Versement plateforme 435,40 → + 30,00 (complément de fin de séjour) →
      Total perçu 465,40. Cascade équilibrée.
- [x] SAS de départ : « Ménage : 30,00 € » listé au récapitulatif, « Total à percevoir : 30,00 € »,
      boutons de règlement présents.
- [ ] Mobile (≤600 px) : non rejoué — aucune structure nouvelle (les blocs touchés étaient déjà
      responsives), la suite E2E couvre le rendu mobile des pages concernées.
- [ ] Edge « complément de fin de séjour déjà encaissé » : couvert par les tests unitaires (modèle +
      moteur), non rejoué à la main.

## 8. Out of scope

- Assouplissement du verrou « réservation passée / en cours » (décision 2026-08-06 : inchangé).
- Paiement en ligne du complément de fin de séjour (`paymentLinksModel` inchangé).
- Paiement partiel d'un bucket (un complément est encaissé en une fois).
- Ventilation TVA par ligne du complément de fin de séjour : il reste comptabilisé au `vatRate`
  général sur le compte produit « options », comme aujourd'hui.
- Requalification rétroactive des réservations en cours au moment du déploiement.
- Notification / e-mail au client pour les prestations vendues en cours de séjour.

## 9. Open questions — résolues le 2026-08-06

- **Q1 — détail affiché.** → **Ligne par ligne** (libellé + qté × PU), comme les lignes du SAS de
  départ, plutôt qu'un montant global « prestations ajoutées en cours de séjour ».
- **Q2 — déclencheur.** → **Toute prestation ajoutée après l'arrivée**, que le complément d'arrivée
  ait été réglé ou non (et non pas seulement le cas où il est réglé). Conséquence : le découpage doit
  être fait **par ligne**, d'où la base de référence §3.1 plutôt qu'un simple reliquat arithmétique.
- **Q3 — « Total du séjour » de la fiche.** → Il intègre **tout** le complément de fin de séjour, pour
  s'aligner sur `totalSejour` de la page Finances qui l'inclut déjà.
- **Q4 — verrou réservation passée.** → **Inchangé** : la vente en cours de séjour depuis la fiche
  continue de dépendre du réglage admin « Modifier les réservations passées » (activé sur
  l'installation d'Adrien).
- **Q5 — complément de fin de séjour déjà encaissé.** → **Gelé** : un montant encaissé n'est jamais
  modifié automatiquement ; l'opérateur décoche « payé » pour reprendre la synchronisation.
