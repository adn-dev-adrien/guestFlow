# Ajuster le montant d'un complément

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/complement-defer-and-adjust` |
| **Created** | 2026-08-21 |
| **Updated** | 2026-08-22 — ventilation comptable (§3.6), cartes côte à côte (§6.5), implémentée |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Un complément est de l'argent encaissé en face-à-face, et son montant est **annoncé au client avant
d'être encaissé** — au téléphone, dans un mail, ou de vive voix au moment du check-in. L'opérateur se
trompe parfois dans ce montant annoncé. Une fois la parole donnée, c'est le montant annoncé qui sera
encaissé : c'est donc lui qui doit figurer dans les livres, pas celui que le moteur avait calculé.

Aujourd'hui aucun des trois compléments n'est modifiable sur la fiche réservation :

| Bucket | Origine du montant | Modifiable ? |
|---|---|---|
| Complément d'arrivée (`complementAmount`) | calculé par `pricing.js` (lignes forcées + taxe de séjour + auto-gap acompte/solde), **gelé** dès `complementPaid = 1` | non |
| Complément durant le séjour (`midStaySettledNotes`) | Σ des notes encaissées pendant le séjour | non — seulement ✕ « annuler la note » puis ressaisie |
| Complément de fin de séjour (`endOfStayComplementAmount`) | Σ des lignes de `endOfStayComplementDetail`, écrites par le SAS départ + le reste des ventes en séjour | non |

Le seul levier existant est la ligne « Offrir » du SAS départ
([sas-offer-complement-lines.md](sas-offer-complement-lines.md)), qui met une ligne à 0 € — tout ou
rien, et seulement sur les lignes que le SAS départ connaît. Et
[frozen-complement-trusts-client.md](frozen-complement-trusts-client.md) a délibérément fermé la
dernière porte : depuis ce correctif, le serveur **ignore** le `complementAmount` envoyé par le
navigateur dès que le complément est encaissé. Corriger une erreur de montant demande aujourd'hui une
écriture SQL à la main en production.

Spec sœur : [defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md) §3.3
(« la fiche décide aussi ») ajoute l'interrupteur qui bascule le complément d'arrivée en fin de séjour.
Les deux se rencontrent sur la carte fusionnée (§3.5) et n'ont aucune autre dépendance : l'une déplace
le **moment** de la collecte, l'autre le **montant**.

Le précédent à copier existe : [editable-deposit-amount.md](editable-deposit-amount.md) a rendu
l'acompte ajustable via une colonne `depositAmountOverride` (NULL = calcul auto) réinjectée dans le
moteur à chaque recalcul.

## 2. Goal

Sur la **fiche réservation**, l'opérateur peut fixer à la main le montant de chacun des trois
compléments — y compris après encaissement — pour qu'il corresponde à ce qui a été annoncé au client.
L'écart avec le montant calculé est absorbé : le total du séjour et la comptabilité suivent le montant
ajusté, sans écriture compensatoire.

---

## 3. Functional rules

### 3.1 Règles communes aux trois compléments

1. Chaque point de collecte d'un complément affiché sur la fiche porte un montant **éditable**, placé
   dans le même bloc que la date de paiement et le sélecteur « Caisse interne » — c'est-à-dire dans la
   carte du complément elle-même, jamais dans un dialogue séparé.
2. **Uniquement sur la fiche réservation.** Le SAS arrivée, le SAS départ, la page Réception, le suivi
   financier et la comptabilité continuent d'**afficher** les montants ajustés mais n'offrent aucun
   moyen de les modifier.
3. **Champ vide = calcul automatique.** Le bucket garde le montant que le moteur (ou le registre des
   notes) produit, comme aujourd'hui.
4. **Une valeur fige le bucket.** Tant qu'elle est présente, aucun recalcul ultérieur (ajout d'une
   option, « Actualiser tarifs », re-run d'un SAS, encaissement d'une note) ne déplace le montant.
   Les recalculs qui passent par le moteur de prix le respectent par construction (règle 13). **Deux
   chemins écrivent `complementAmount` en direct, hors moteur** — le commit du SAS arrivée, qui ajoute
   ses lignes, et « Offrir » qui passe une ligne du complément d'arrivée à 0 € — et doivent donc
   rendre la main à l'ajustement juste après avoir écrit, sinon un passage au SAS effacerait
   silencieusement le montant annoncé jusqu'au prochain enregistrement de la fiche (constaté à
   l'implémentation, 2026-08-22). La ventilation comptable est recalculée dans la foulée, sur la
   nouvelle composition des lignes.
5. **L'écart est absorbé.** Le montant ajusté devient le montant du bucket, point : le « total du
   séjour » de la fiche (`sejourNetTotal`), le suivi financier et l'écriture comptable reprennent
   cette valeur. Aucune ligne de compensation n'est créée ailleurs, aucun autre bucket n'est touché.
6. **Ajustable même après encaissement** (`*Paid = 1` / `*PaidCash = 1`). C'est le cas d'usage
   principal : on s'aperçoit après coup que le montant annoncé — donc encaissé — était le mauvais.
7. Le montant ajusté est validé côté serveur : nombre fini ≥ 0, sinon `NEGATIVE_AMOUNT` /
   `NOT_A_NUMBER` (`financeValidation.validateMoneyAmount`, déjà en place).
8. **Vider le champ restaure le calcul automatique** au recalcul suivant.
9. Une carte dont le montant vaut 0 € **parce qu'un ajustement le force à 0** reste affichée — sinon
   l'opérateur n'aurait plus aucun moyen d'effacer l'ajustement. Une carte à 0 € sans ajustement reste
   masquée, comme aujourd'hui.
10. Une réservation annulée reste en lecture seule (`cancelledGuard` existant) ; une réservation passée
    verrouillée suit la règle de déverrouillage existante
    ([admin-unlock-past-reservations.md](admin-unlock-past-reservations.md)).
11. Chaque ajustement est tracé dans l'historique de la réservation (`reservation_history`) sous un
    libellé lisible — c'est de l'argent, ça doit se relire.

### 3.2 Complément d'arrivée

12. Nouvelle colonne `reservations.complementAmountOverride` (REAL, NULL = auto). Elle est réinjectée
    dans le moteur à chaque devis/recalcul, comme `depositAmountOverride`.
13. Dans `pricing.js`, l'ajustement s'applique **en dernier**, après toutes les branches existantes
    (gelée, contributions forcées, auto-gap) : `resolvedComplementAmount = max(0, round(override))`.
    C'est ce qui le rend capable de corriger un complément déjà gelé (règle 6).
14. La règle 1 de [frozen-complement-trusts-client.md](frozen-complement-trusts-client.md) reste
    intacte : le `complementAmount` **calculé** que le navigateur envoie continue d'être ignoré sur un
    bucket gelé. L'ajustement est un champ distinct, explicite et saisi à la main — c'est une
    intention d'opérateur, pas un résultat de calcul client.
15. `complementSplit` ([complement-buckets-by-moment.md](complement-buckets-by-moment.md)) suit
    mécaniquement : il lit `resolvedComplementAmount`. Les trois buckets somment toujours au même total.

### 3.3 Complément de fin de séjour

16. Nouvelle colonne `reservations.endOfStayComplementAmountOverride` (REAL, NULL = auto).
17. `endOfStayComplementAmount` doit rester **exactement la somme de `endOfStayComplementDetail`** :
    c'est l'invariant que tout le code aval suppose. L'ajustement est donc matérialisé par une ligne de
    détail dédiée — `{ label: 'Ajustement', amount: <delta>, source: 'adjustment' }` — dont le montant
    est recalculé à chaque écriture pour combler l'écart : `delta = override − Σ(autres lignes)`.
18. Cette ligne **peut être négative** (c'est le cas courant : on a annoncé moins que ce qui est dû).
    Le filtre « montant > 0 » du point d'écriture unique doit la conserver, au même titre qu'une ligne
    offerte à 0 €.
19. Elle est **visible** dans les lignes de la carte et sur le récapitulatif de départ : l'opérateur
    doit voir de combien il a corrigé, même si aucune écriture séparée n'est produite.
20. La réconciliation vit dans le **point d'écriture unique** du complément de fin de séjour, si bien
    que l'ajustement est re-appliqué par tous les chemins qui réécrivent le détail : sync des ventes en
    séjour à chaque enregistrement de la fiche, encaissement/annulation d'une note, « Offrir » une
    ligne, re-run du SAS départ.
21. Vider l'ajustement supprime la ligne « Ajustement » et re-totalise les lignes réelles.
22. Contrairement à `syncMidStayComplement`, l'application d'un ajustement **n'est pas bloquée** par un
    complément de fin de séjour déjà encaissé (règle 6) : c'est un acte explicite de l'opérateur.

### 3.4 Complément durant le séjour (notes en séjour)

23. Ce bucket n'est pas un montant mais un **registre de notes**, chacune avec son total, sa date de
    paiement et son mode (CB / caisse interne). L'unité ajustable est donc **la note**, pas le total du
    bucket : `Σ notes` doit continuer à égaler le montant affiché.
24. Chaque note de l'historique est modifiable sur place : **montant**, **date de paiement**, **CB /
    caisse interne**.
25. Changer le montant d'une note déplace l'écart entre la note et le **reste à percevoir en fin de
    séjour**, dans une seule transaction — exactement le mouvement que font déjà « encaisser une note »
    et « annuler une note ». Les prestations vendues ne sont jamais dé-vendues
    ([mid-stay-notes.md](mid-stay-notes.md) §3.1 rule 3).
26. C'est la seule exception à la règle 5, et elle est structurelle : la prestation vendue existe
    toujours en ligne. Baisser une note ne détruit pas l'argent, elle le remet à percevoir au départ.
    Pour l'absorber vraiment, l'opérateur offre la ligne dans le SAS départ.
27. Augmenter une note est plafonné par le reste à percevoir de ses clés, comme un encaissement normal
    (`NOTE_AMOUNT_INVALID`, message portant le reste disponible).
28. Une note n'est pas ajustable une fois le complément de fin de séjour encaissé — même garde que
    l'encaissement et l'annulation d'une note (`END_OF_STAY_SETTLED`).

### 3.5 Carte fusionnée « complément de fin de séjour » (arrivée reportée au départ)

29. Quand le complément d'arrivée est reporté au check-out
    ([defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md)), la fiche
    n'affiche qu'**une** carte dont le montant est `arrivée + fin de séjour`. Ajuster ce total écrit
    l'ajustement du **complément d'arrivée** à `cible − montant de fin de séjour`, borné à 0.
30. Si la cible est inférieure au montant de fin de séjour, l'ajustement d'arrivée tombe à 0 et un
    texte d'aide indique le plancher atteint : descendre plus bas demande de corriger les lignes de fin
    de séjour, qui ont leur propre vérité (lignes du SAS départ).

**Edge cases :**

- Ajustement à `0` → le bucket vaut 0 €, la carte reste affichée (règle 9) et son écriture comptable
  disparaît (les constructeurs d'écritures retournent déjà `null` sur un TTC ≤ 0).
- Ajustement supérieur au total du séjour → accepté sans borne haute : un complément peut légitimement
  dépasser le séjour (extras vendus sur place).
- Ajustement posé puis complément encaissé → rien ne bouge, l'ajustement continue de gagner.
- Ajustement d'arrivée posé sur un devis → accepté (le complément y est une prévision) ; il est repris
  tel quel à la conversion en réservation, comme les autres montants.
- Ajustement de fin de séjour posé alors qu'il n'existe **aucune** ligne de détail → la ligne
  « Ajustement » porte seule le montant.
- Note ajustée à 0 € ou moins → refusé (`NOTE_AMOUNT_INVALID`) ; annuler la note est le geste prévu.
- « Actualiser tarifs » → n'efface aucun ajustement, par parité avec l'acompte
  ([editable-deposit-amount.md](editable-deposit-amount.md) règle 7). Pour revenir à l'auto, on vide le
  champ.

---

### 3.6 Ventilation comptable de l'ajustement

> Arbitré avec Adrien le 2026-08-22 : **la comptabilité ne recalcule jamais un montant.** La fiche
> décide, la fiche stocke, l'export ne fait plus que convertir un TTC en HT + TVA.

31. Un encaissement « complément d'arrivée » ne crédite pas une ligne mais **plusieurs postes**
    ([accountingExport.js](../server/src/utils/accountingExport.js) `entryToRows`) :

    | Compte | Contenu |
    |---|---|
    | `70600000` | location gîte — la part hébergement (auto-gap) |
    | `70600010` | prestations complémentaires — options + prestations personnalisées |
    | `70601000` | activités diverses — ressources (bain nordique) |
    | `44571100` / `44571200` | TVA, une ligne par taux |
    | `46710000` | taxe de séjour — pass-through, jamais un produit |

    Exemple : linge 24 € + bain nordique 60 € + taxe 9,60 € = 93,60 € → quatre crédits
    (21,82 + 54,55 + 7,63 de TVA + 9,60).

32. **L'ajustement se ventile sur les seules prestations** — options, prestations personnalisées et
    ressources — au prorata de leur montant courant. **L'hébergement n'est jamais touché**, **la taxe
    de séjour non plus.**
33. **Plancher = part hébergement + taxe de séjour.** Le champ refuse d'aller en dessous, avec un texte
    d'aide qui nomme le plancher et sa composition — et **le serveur remonte la valeur au plancher
    avant de la stocker**, parce que la borne n'est pas une politesse d'interface : la somme des
    postes est bornée elle aussi, donc un montant stocké plus bas ferait dépasser les crédits et
    l'écart repartirait dans la ligne de résidu (règle 37).
34. Corollaire : un complément fait **uniquement** d'un auto-gap hébergement — aucune prestation, pas
    de taxe — n'est pas ajustable, son plancher égale son montant. Baisser cet argent-là est une remise
    sur le séjour : elle se fait dans « Prix hébergement ajusté » / « Réduction ». Le champ est alors
    désactivé, ce motif en infobulle.
35. Ajustement **à la hausse** sans aucune prestation à proratiser → le surplus va sur `70600010`, le
    poste naturel d'un extra vendu sur place.
36. La ventilation est **calculée à l'enregistrement de la fiche et stockée** (§5). L'export la lit
    telle quelle au lieu de la dériver de `totalPrice − acompte − solde` comme aujourd'hui
    ([accountingModel.js](../server/src/models/accountingModel.js) `computeBucketTtcsFromContribs`), et
    ne fait plus que le découpage TTC → HT + TVA au taux général.
37. **Aucun écart d'ajustement ne tombe dans la ligne de résidu de l'export.** Aujourd'hui
    [accountingExport.js:192](../server/src/utils/accountingExport.js#L192) rattrape la différence
    entre Σ crédits et le débit sur le **dernier** crédit — qui se trouve être la ligne `46710000`. Sur
    le complément de 93,60 € ci-dessus annoncé 85 €, la taxe de séjour serait passée de 9,60 € à
    1,00 € : écriture équilibrée, taxe fausse. Avec la ventilation stockée, Σ crédits = débit par
    construction et le résidu redevient ce qu'il doit être — deux centimes d'arrondi.

    Deux mécanismes de l'export devaient être neutralisés pour y arriver (constatés en vérifiant une
    vraie réservation, 2026-08-22) :
    - **la taxe re-dérivée** : l'export recalculait sa propre part de taxe de séjour, différente de
      celle contre laquelle la fiche avait ventilé → l'écart repartait dans le résidu. La part taxe
      est donc stockée avec la ventilation et lue telle quelle.
    - **le `grossRatio`** : il grossit les montants stockés jusqu'à ce que le client a réellement
      payé, avec `acompte + solde + complément` au dénominateur. Baisser le complément faisait donc
      monter le ratio, qui re-gonflait l'écriture (140 € annoncés → 142,12 € bookés) **et faisait
      bouger l'acompte et le solde de la même réservation**. Le dénominateur prend désormais le
      complément d'avant l'ajustement, et l'écriture du complément ajusté n'est plus mise à l'échelle
      du tout : le montant annoncé EST le montant booké.
38. **Complément de fin de séjour : rien à ventiler.** Son écriture est une ligne `70600010` unique à
    plat, donc le montant ajusté s'y applique directement — c'est déjà l'effet de la ligne
    « Ajustement » de la règle 17.
39. **Note en séjour : rien à ventiler non plus** — même écriture à plat, le total ajusté de la note
    est le montant booké.
40. Le suivi financier ([financeModel.js](../server/src/models/financeModel.js)) lit les montants
    stockés des trois buckets : il suit l'ajustement sans une ligne de code.

**Edge cases :**

- Ajustement d'un complément où la taxe est routée ailleurs (sur le solde) → pas de plancher taxe, le
  plancher se réduit à la part hébergement.
- Prestation offerte (montant 0 €) → poids nul dans le prorata, elle reste à 0 €.
- Deux postes dont un à 0,01 € → le prorata arrondit à la ligne près, le reste de centime tombe sur le
  poste le plus lourd pour que Σ postes = montant ajusté **exactement**.
- Réservation sans contribution par ligne (`acompteContribTtc` NULL partout, chemin « stored-money
  fallback ») → la ventilation stockée s'impose de la même manière ; c'est elle qui décide, pas le
  `fraction` de l'export.

---

## 4. Architecture

> **Fat backend, thin frontend.** Le gel, la borne, la réconciliation de la ligne « Ajustement » et le
> déplacement d'argent entre une note et le reste à percevoir vivent entièrement côté serveur. Le
> client rend un champ et fait l'aller-retour de la valeur brute.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `reservations.js` | — | Aucune signature ne change : les deux ajustements sont des champs de corps additifs, l'ajustement de note est une action de plus sur le PATCH paiement existant. |
| `controllers/` | `reservationsController.js` | T | Lit + valide `complementAmountOverride` / `endOfStayComplementAmountOverride` sur `create`, `update` et `calculate-price` ; les passe au moteur ; calcule la ventilation via `complementAllocation` et la persiste à l'enregistrement (règle 36) ; applique l'ajustement de fin de séjour juste après `syncMidStayComplement` ; route `adjustMidStayNote` dans `applyMidStayNoteActions` (même contrat d'erreurs 404/409). |
| `models/` | `reservationsModel.js` | T | Persiste + réhydrate les trois colonnes (dont la ventilation, règle 36) ; réconcilie la ligne « Ajustement » dans `writeEndOfStayDetail` (point d'écriture unique) ; nouvelle `applyEndOfStayAdjustment(id)` (sans la garde « déjà encaissé ») ; nouvelle `adjustMidStayNote(id, noteId, { total, paidDate, cash })` ; fait passer l'écriture directe du commit SAS départ par le même réconciliateur. |
| `utils/` | `pricing.js` | T | Nouveau paramètre `complementAmountOverride`, appliqué **après** toutes les branches existantes de `resolvedComplementAmount`. |
| `utils/` | `endOfStayAdjustment.js` | C | Pur : `reconcileEndOfStayLines({ lines, override })` → `{ lines, amount }`. Retire l'ancienne ligne d'ajustement, re-somme les lignes réelles, réinsère le delta si un ajustement est posé. Unit-testable sans DB. |
| `utils/` | `financeValidation.js` | — | Réutilisé tel quel (`validateMoneyAmount` traite vide/null comme « non fourni »). |
| `utils/` | `reservationAudit.js` | T | Deux libellés d'historique : « Complément d'arrivée ajusté », « Complément de fin de séjour ajusté ». |
| `utils/` | `complementBuckets.js` | — | Inchangé : il lit le montant résolu, donc il suit. |
| `utils/` | `checkoutComplement.js` | — | Inchangé : `amount = arrivée + fin de séjour`, les deux déjà ajustés. |
| `models/` | `accountingModel.js` | T | Le débit lit déjà les montants ajustés (`complementAmount`, `endOfStayComplementAmount`, `note.total`). Changements : `buildEntry` lit la **ventilation stockée** au lieu de dériver les postes, prend sa part de taxe dans la ventilation, force `grossRatio = 1` sur l'écriture du complément ajusté et calcule le ratio des autres échéances sur le complément d'AVANT ajustement (règles 36-37). Sans ventilation stockée : comportement actuel, à l'octet près. |
| `models/` | `financeModel.js` | — | Inchangé, même raison. |
| `models/` | `reservationsModel.js` (SAS) | T | `commitArrivalSas` et « Offrir » écrivent `complementAmount` hors moteur : tous deux rappellent l'ajustement et re-synchronisent la ventilation juste après (règle 4). |
| `utils/` | `complementAllocation.js` | C | Pur : `allocateComplementAdjustment({ target, accommodation, options, resources, tax })` → `{ accommodation, options, resources, floor, floored }`. Prorata sur les seules prestations, hébergement et taxe intouchés, Σ postes = cible au centime (règles 32-35). |
| `utils/` | `accountingExport.js` | — | Inchangé : sa ligne de résidu redevient un simple rattrapage d'arrondi (règle 37). |
| `database.js` | `database.js` | T | Trois blocs `ADD COLUMN` idempotents. |
| `tests/` | `pricing-complement-override.unit.test.js` | C | Règles 12-15 + edge cases. |
| `tests/` | `end-of-stay-adjustment.unit.test.js` | C | Règles 17-22 sur le util pur + le point d'écriture. |
| `tests/` | `mid-stay-note-adjust.unit.test.js` | C | Règles 24-28. |
| `tests/` | `complement-allocation.unit.test.js` | C | Règles 31-37 : prorata, planchers, arrondi, Σ postes = cible. |

**Notes :**
- `reconcileEndOfStayLines` est extrait en util pur exprès : il est appelé depuis deux endroits (le
  point d'écriture unique et le commit du SAS départ), et c'est la seule brique qui décide du montant.
- `adjustMidStayNote` réutilise la mécanique de consommation de `settleMidStayNote` : on rend les
  lignes de la note au reste à percevoir, puis on reconsomme le nouveau montant sur les mêmes clés,
  dans le même ordre, en gardant l'`id`, la date et le mode de la note.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Les deux ajustements dans l'état du formulaire, dans l'entrée du devis live, dans la charge utile de sauvegarde et dans l'hydratation au chargement (même patron que `depositAmountOverride`). |
| `components/` | `reservation/FinanceSection.jsx` | T | `ComplementCard` reçoit `overrideValue` + `onOverrideCommit` et rend le champ ajustable entre les lignes et le bouton « Marquer complément payé » ; câblage des trois cartes (arrivée, fin de séjour, fusionnée) ; édition en place d'une note dans l'historique. |
| `components/` | `reservation/MidStayNoteRow.jsx` | C | Une ligne de l'historique des notes : lecture (date — montant — mode, ✎, ✕) et édition en place (montant, date, mode, Enregistrer/Annuler). Extrait parce que `FinanceSection.jsx` fait déjà 1 000 lignes et que la ligne porte désormais un état local. |
| `hooks/` | — | — | (aucun) |
| `services/` | — | — | (aucun) |
| `utils/` | — | — | (aucun) |
| `constants/` | `complements.js` | — | Inchangé : les trois libellés de bucket ne bougent pas. |
| `styles/` | — | — | (aucun) |
| `api.js` | `api.js` | T | Nouvelle action `adjustMidStayNote` sur le PATCH paiement existant. |

**Component reuse declaration :**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `ArithmeticTextField`, `DateField` | `ArithmeticTextField` porte déjà le montant de l'acompte et le prix ajusté : mêmes commit-on-blur, même arithmétique, même bornage ≥ 0. |
| **Created (new generic)** | — | Aucun. |
| **Specific (kept feature-local)** | `ComplementCard` (déjà local), `MidStayNoteRow` | Tous deux collés au registre des notes et aux trois buckets de complément : rien de réutilisable hors de la fiche. `MidStayNoteRow` est une composition de génériques (`ArithmeticTextField`, `DateField`, boutons MUI), pas un nouveau primitif. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations` | `{ …, complementAmountOverride?, endOfStayComplementAmountOverride? }` | `{ id }` | Nombre ≥ 0, ou `null`/`''` = auto. |
| PUT | `/api/reservations/:id` | idem | réservation | `NEGATIVE_AMOUNT` / `NOT_A_NUMBER` en 400. |
| GET | `/api/reservations/:id` | — | `{ …, complementAmountOverride, endOfStayComplementAmountOverride }` | `''` quand auto, nombre quand ajusté. |
| POST | `/api/reservations/calculate-price` | `{ …, complementAmountOverride? }` | devis | L'aperçu live montre le montant ajusté avant même l'enregistrement. |
| PATCH | `/api/reservations/:id/payment` | `{ adjustMidStayNote: { id, total?, paidDate?, cash? } }` | `{ ok: true }` | 404 `NOTE_NOT_FOUND` ; 409 `NOTE_AMOUNT_INVALID` / `END_OF_STAY_SETTLED`. |

Auth : mêmes règles que le reste de la fiche (session admin, garde réservation annulée / passée
verrouillée).

---

## 5. Data model

```sql
ALTER TABLE reservations ADD COLUMN complementAmountOverride REAL;            -- NULL = calcul auto
ALTER TABLE reservations ADD COLUMN endOfStayComplementAmountOverride REAL;   -- NULL = calcul auto
ALTER TABLE reservations ADD COLUMN complementAllocation TEXT;                -- NULL = ventilation dérivée
```

- Deux blocs idempotents dans [database.js](../server/src/database.js), gardés par
  `rcols.includes(...)`, à côté des colonnes de complément existantes.
- Valeur par défaut des lignes existantes : `NULL` → calcul automatique → **comportement strictement
  inchangé**.
- Aucun backfill. `complementAmount` et `endOfStayComplementAmount` restent les montants résolus et
  stockés que la comptabilité et le suivi financier lisent ; les deux nouvelles colonnes ne portent que
  l'intention de l'opérateur, réinjectée à chaque recalcul.
- La ligne `{ label: 'Ajustement', source: 'adjustment' }` vit dans le JSON
  `endOfStayComplementDetail` existant — pas de colonne, pas de table.
- `complementAllocation` porte la ventilation comptable du complément d'arrivée ajusté, en JSON :
  `{ "accommodation": 0, "options": 21.54, "resources": 53.86, "tax": 9.6, "auto": 93.6 }` — des TTC, par poste, jamais par
  ligne (l'export regroupe déjà par poste). Écrite en même temps que `complementAmountOverride`,
  effacée avec lui. `NULL` → l'export dérive comme aujourd'hui, donc **zéro changement** pour les
  réservations existantes et pour toutes celles qu'on n'ajuste pas.
- Le JSON porte deux champs de plus que les trois postes, tous deux découverts à l'implémentation
  (2026-08-22) et tous deux indispensables à la règle 37 :
  - `tax` — la part taxe de séjour que la fiche a ventilée. C'est elle qui ferme Σ crédits sur le
    montant annoncé ; sans elle l'export re-dérivait sa propre taxe et l'écart repartait dans la
    ligne de résidu, c'est-à-dire dans le 46710000.
  - `auto` — le complément AVANT ajustement. Le `grossRatio` de l'export (qui répare deux formes
    d'échéancier historiques) prend `acompte + solde + complément` au dénominateur : baisser le
    complément faisait monter le ratio, ce qui re-gonflait l'écriture du complément **et celles de
    l'acompte et du solde** de la même réservation. Le dénominateur utilise donc le complément que
    le moteur produisait, et l'écriture du complément ajusté n'est plus mise à l'échelle du tout.
- La taxe de séjour n'y figure pas : elle reste calculée depuis `touristTaxTotal` moins les parts
  acompte/solde, intouchée par construction (règle 32), et le plancher garantit que le clamp de
  `computeTaxTtcForKind` ne mord jamais.

**Data impact :** aucun sur les enregistrements existants. Aucune migration destructive, aucune
réécriture au démarrage.

## 6. UI / UX

### 6.1 Carte d'un complément (arrivée, fin de séjour, fusionnée)

Le champ se glisse **dans la carte**, entre les lignes de détail et le bouton « Marquer complément
payé » — donc dans le même bloc que la date de paiement et « Caisse interne ». Sur le complément
d'arrivée, la ventilation obtenue s'affiche juste en dessous : l'opérateur voit ce qui partira en
comptabilité avant de quitter la fiche.

```
┌─ Complément d'arrivée  (93,60 €) ───────────────┐
│  Linge de toilette : 24,00 €                    │
│  Bain nordique     : 60,00 €                    │
│  Taxe de séjour    :  9,60 €                    │
│                                                 │
│  Montant ajusté (€)  [ 85           ]           │
│  Montant figé — l'écart est absorbé par le      │
│  total du séjour.                               │
│                                                 │
│  Ventilation : Prestations 21,54 €              │
│                Activités   53,86 €              │
│                Taxe         9,60 € (inchangée)  │
│                                                 │
│  [ ✓ Complément payé                        ]   │
│  [ Payé le          05/08/2026              ]   │
│  [ Caisse interne ✓                         ]   │
└─────────────────────────────────────────────────┘
```

Copie française :
- Label : **« Montant ajusté (€) »**
- Aide, champ vide : **« Calcul auto (93,60 €) »** — le montant que le moteur produirait.
- Aide, champ rempli : **« Montant figé — l'écart est absorbé par le total du séjour. »**
- Aide, plancher atteint : **« Minimum X,XX € : taxe de séjour Y,YY € + hébergement Z,ZZ €, que
  l'ajustement ne touche pas. »**
- Infobulle, champ désactivé (règle 34) : **« Ce complément ne contient que de l'hébergement. Pour le
  réduire, utilisez « Prix hébergement ajusté ». »**
- Aide, carte fusionnée bornée à 0 : **« Plancher atteint : le complément de fin de séjour vaut déjà
  X,XX €. »**
- Titre du bloc de ventilation : **« Ventilation comptable »**, en `caption`, replié par défaut sur
  `xs`.

La ventilation n'est affichée que sur le **complément d'arrivée ajusté** : le complément de fin de
séjour et les notes en séjour ont une écriture à ligne unique, il n'y a rien à ventiler (règles 38-39).

Le titre de la carte continue d'afficher le montant effectif entre parenthèses, donc le montant ajusté
dès qu'il est posé. La bordure rouge « impayé » ne change pas de règle.

### 6.2 Historique des notes en séjour

```
Complément durant le séjour  (32,50 €)
  [ + Nouvelle note ]
  [ Voir l'historique (2 notes) ]
  │ 06/08 — 26,00 € — CB                        [✎] [✕]
  │   Bière Blonde du Pilat : 6,50 €
  │   Linge de toilette : 19,50 €
  │ 07/08 — 6,50 € — Caisse interne             [✎] [✕]
```

En mode édition, la ligne s'ouvre sur place :

```
  │ Montant (€) [ 22    ]  Payé le [ 06/08/2026 ]
  │ [ CB ] [ Caisse interne ]
  │ [ Enregistrer ]  [ Annuler ]
  │   Reste à percevoir sur ces prestations : 26,00 €
```

- ✎ désactivé (avec l'infobulle du motif) quand le complément de fin de séjour est encaissé, comme ✕
  l'est déjà.
- Erreur serveur (`NOTE_AMOUNT_INVALID`) rendue sous le champ montant, sans fermer l'édition.

### 6.3 Panneau de droite

`PricingSummary` est inchangé : il rend déjà `quote.complementAmount` et le `complementSplit`, donc
l'ajustement d'arrivée s'y voit en direct pendant la frappe.

### 6.4 Responsive

- Les cartes de complément vivent déjà dans une `Grid size={{ xs: 12, md: 6 }}` ; le champ est
  `fullWidth` et hérite de la colonne. Rien à changer sur `xs`.
- La ligne d'édition d'une note empile ses contrôles sur `xs`
  (`flexDirection: { xs: 'column', sm: 'row' }`, champs `fullWidth`), et les aligne à partir de `sm`.
- Boutons ✎ / ✕ : cibles tactiles ≥ 44 × 44 px (`IconButton` MUI, à forcer si la taille `small` passe
  en dessous).
- Vérification aux trois points de rupture : `xs` ≤ 600 px, `md` ~900 px, `lg` ≥ 1200 px.

### 6.5 Les cartes de complément côte à côte (desktop)

Demande Adrien 2026-08-22. Aujourd'hui chaque `ComplementCard` fabrique son propre `<Divider>` **et**
son propre `<Grid container>` à une seule colonne `md: 6`
([FinanceSection.jsx:53-59](../client/src/components/reservation/FinanceSection.jsx#L53-L59)) : les
blocs s'empilent et la moitié droite de l'écran reste vide.

- Le conteneur remonte dans `FinanceSection` : **une** `<Grid container>` pour les blocs de complément,
  chaque bloc devenant un item `size={{ xs: 12, md: 6 }}`.
- Résultat : **deux cartes par ligne** à partir de `md`, empilées sur `xs`. Le troisième bloc quand il
  existe (arrivée / durant le séjour / fin de séjour) passe à la ligne suivante, sans traitement
  spécial.
- `alignItems: 'stretch'` pour que deux cartes voisines de hauteurs différentes gardent la même
  hauteur, comme la paire « Prix brut / Prix ajusté » juste au-dessus.
- Le `<Divider>` sort de la carte et devient le séparateur du groupe : un seul trait au-dessus des
  cartes de complément, plus un par carte.
- État fusionné (arrivée reportée au départ) : une seule carte de complément + éventuellement le bloc
  « durant le séjour » → les deux se retrouvent côte à côte, ce qui est exactement l'effet demandé.

### 6.6 Sticky action bar

`ReservationPage` porte déjà sa `PageActionBar` (titre, retour, Enregistrer/Annuler, actions
spécifiques). **Aucune action de page nouvelle** : un ajustement se saisit dans la carte et part avec
l'enregistrement de la fiche ; l'ajustement d'une note part par son propre bouton « Enregistrer ».

## 7. Test plan

### Server unit tests

- [x] `tests/pricing-complement-override.unit.test.js` (9 tests)
  - [x] Ajustement vide → montant calculé inchangé (règle 3).
  - [x] Ajustement posé → le moteur retourne ce montant, malgré des lignes forcées et une taxe en
        complément (règle 13).
  - [x] Ajustement posé sur un complément **gelé** (`complementPaid = 1`) → l'ajustement gagne sur le
        montant stocké (règles 6, 13).
  - [x] `complementAmount` client ignoré sur un bucket gelé quand aucun ajustement n'est posé — non-
        régression de `frozen-complement-trusts-client` (règle 14).
  - [x] Ajustement négatif → `NEGATIVE_AMOUNT` à la frontière de validation (règle 7).
  - [x] `complementSplit` somme toujours au même total après ajustement (règle 15).
  - [x] Ajout d'une option après ajustement → le complément ne bouge pas (règle 4).
- [x] `tests/end-of-stay-adjustment.unit.test.js` (10 tests)
  - [x] `reconcileEndOfStayLines` : delta négatif, delta positif, pas d'ajustement, aucune ligne
        réelle, ancienne ligne d'ajustement remplacée et non empilée (règles 17, 21).
  - [x] Le point d'écriture unique conserve la ligne d'ajustement négative (règle 18).
  - [x] `endOfStayComplementAmount == Σ endOfStayComplementDetail` après chaque chemin : sync des
        ventes en séjour, encaissement de note, annulation de note, « Offrir », re-run SAS départ
        (règle 20).
  - [x] Ajustement appliqué malgré `endOfStayComplementPaid = 1` (règle 22).
  - [x] Écriture comptable `endOfStayComplement` = montant ajusté (règle 5).
- [x] `tests/mid-stay-note-adjust.unit.test.js` (8 tests)
  - [x] Baisse d'une note → l'écart revient au reste à percevoir, `Σ notes + reste` invariant (règle 25).
  - [x] Hausse au-delà du reste → `NOTE_AMOUNT_INVALID` portant le reste (règle 27).
  - [x] Note à 0 ou négative → `NOTE_AMOUNT_INVALID` (edge case).
  - [x] Date et mode modifiés seuls → montants inchangés (règle 24).
  - [x] Complément de fin de séjour encaissé → `END_OF_STAY_SETTLED` (règle 28).
  - [x] Écriture comptable `midStayComplement` = total ajusté de la note (règle 5).
- [x] `tests/sas-commit.unit.test.js` (existant, +2) — un montant ajusté survit au commit du SAS
      arrivée ; sans ajustement le commit est strictement inchangé (règle 4).
- [ ] Plancher appliqué **côté serveur** (règle 33) : pas de test unitaire — `syncComplementAllocation`
      demande la réservation détaillée, que les schémas de test minimaux ne portent pas. Vérifié à la
      main sur la base de dev (3 € posés sur un complément 100 % taxe de séjour → remontés à 4,30 €,
      ventilation cohérente). Le clamp lui-même est couvert par `complement-allocation.unit.test.js`.
- [x] `tests/complement-allocation.unit.test.js` (12 tests)
  - [x] Prorata sur deux prestations (options + ressources), hébergement et taxe intouchés (règle 32).
  - [x] Cible sous le plancher → clampée à `hébergement + taxe`, `floored = true` (règle 33).
  - [x] Complément 100 % hébergement → plancher = montant, aucune ventilation possible (règle 34).
  - [x] Cible au-dessus sans prestation → tout sur `options` / `70600010` (règle 35).
  - [x] Σ postes == cible au centime, reste d'arrondi sur le poste le plus lourd (edge case).
  - [x] Prestation offerte (0 €) → poids nul, reste à 0 € (edge case).
- [x] `tests/accounting-complement-allocation.unit.test.js` (7 tests)
  - [x] Ventilation stockée → les crédits de l'écriture « complément » la reprennent poste par poste,
        la compta ne dérive plus (règle 36).
  - [x] Σ crédits == débit **sans** passer par la ligne de résidu ; la ligne `46710000` vaut exactement
        la taxe de séjour (règle 37) — le cas 93,60 € annoncé 85 €.
  - [x] Témoin du bug : sans ventilation, la ligne taxe tomberait à 1,00 € (règle 37).
  - [x] Le gross-up ne réagit pas à l'ajustement — ni sur le complément, ni sur l'acompte / le solde
        de la même réservation (règle 37).
  - [x] `complementAllocation` NULL → export strictement identique à aujourd'hui (non-régression).
  - [x] La ventilation ne s'applique qu'au complément : acompte et solde l'ignorent.
- [x] `tests/reservation-audit.unit.test.js` (existant, complété) — les deux ajustements apparaissent
      dans le diff d'historique (règle 11).

### Client tests (`cd client && npx vitest run`)

- [x] `ComplementCard` rend le champ ajustable et remonte la valeur committée.
- [x] Carte affichée quand le montant ajusté vaut 0 (règle 9).
- [x] `MidStayNoteRow` : bascule lecture ↔ édition, ✎ désactivé quand le complément de fin de séjour
      est encaissé.
- [ ] `ReservationPage` : les deux ajustements sont hydratés au chargement et présents dans la charge
      utile de sauvegarde. **Non couvert par un test** — la page n'a pas de harnais vitest (aucun
      `pages/__tests__/ReservationPage*`) ; vérifié à la main (saisie → enregistrement → rechargement).

### Manual UI verification (`npm run dev`)

- [x] **Happy path** — réservation avec complément d'arrivée à 24 €, ajustement à 20 € : le titre de la
      carte, le panneau de droite et le total du séjour affichent 20 € ; après enregistrement +
      rechargement, la valeur tient.
- [x] **Après encaissement** — cocher « Complément payé », puis ajuster : le montant change, la date et
      « Caisse interne » sont préservées.
- [x] **Fin de séjour** — ajuster à un montant inférieur aux lignes du SAS départ : une ligne
      « Ajustement −X,XX € » apparaît dans la carte, le total colle.
- [x] **Note en séjour** — ✎ sur une note, baisser le montant : le reste à percevoir au départ augmente
      d'autant, le total « durant le séjour » suit.
- [x] **Retour à l'auto** — vider les trois champs : les montants calculés reviennent.
- [x] **Mobile** (`xs` 390 px) — les trois cartes s'empilent pleine largeur, aucun scroll horizontal
      (`scrollWidth === clientWidth`). La ligne d'édition d'une note n'a été vérifiée qu'en desktop et
      par son test vitest ; ses contrôles empilent sur `xs` par construction
      (`flexDirection: { xs: 'column', sm: 'row' }`).
- [x] **Comptabilité** — export du mois de l'encaissement : le débit CCLIENT vaut le montant ajusté, les
      crédits somment pareil, la ligne taxe de séjour est intacte.
- [x] **Deux cartes côte à côte** — sur `md+`, « Complément d'arrivée » et « Complément de fin de
      séjour » occupent la même ligne ; sur `xs` elles s'empilent (§6.5).
- [x] **Régressions adjacentes** — page Réception et écran Comptabilité (le montant ajusté est bien
      celui qui est écrit), [complement-buckets-by-moment](complement-buckets-by-moment.md) (les trois
      buckets somment juste). L'absence de champ ajustable dans les SAS est vérifiée par construction :
      `ComplementCard` est local à `FinanceSection` et aucun fichier de `components/sas/` ne référence
      l'ajustement.

### E2E (`npm run test:e2e`)

- [x] La suite Playwright passe (aucun scénario nouveau : les compléments ne sont pas couverts par les
      parcours de fumée existants).

## 8. Out of scope

- **Modifier un complément ailleurs que sur la fiche** : SAS arrivée, SAS départ, page Réception,
  suivi financier, comptabilité restent en lecture seule (règle 2, demande explicite).
- **Tracer l'écart comme un « geste commercial »** — compte comptable dédié, ligne d'écriture séparée,
  statistique des erreurs de facturation. L'écart est absorbé silencieusement (choix arbitré) ; la
  ligne « Ajustement » du complément de fin de séjour est un artefact de stockage, visible mais sans
  écriture propre.
- **L'acompte et le solde** : l'acompte a déjà son ajustement
  ([editable-deposit-amount.md](editable-deposit-amount.md)), le solde absorbe par construction.
- **Ajuster le total du bucket « durant le séjour »** en tant que tel : l'unité est la note (règle 23).
- **Réservations annulées** : elles restent en lecture seule.
- **Reprise rétroactive** des compléments déjà mal facturés en production : rien n'est réécrit au
  démarrage, l'opérateur corrige au cas par cas depuis la fiche.

## 9. Open questions

**Résolues le 2026-08-22 (Adrien) :**

- Q : Sur la carte fusionnée (complément d'arrivée reporté au départ), l'ajustement doit-il pouvoir
  descendre sous le montant de fin de séjour ?
  - **R : non** — il est borné à 0 sur la part « arrivée », et un texte d'aide indique le plancher.
    Descendre plus bas veut dire corriger des lignes facturées par le SAS départ, qui ont leur propre
    vérité et leur propre geste (« Offrir »). Règles 29-30.
- Q : Comment l'écart d'ajustement tombe-t-il dans l'écriture comptable ?
  - **R : un seul champ, ventilation calculée puis stockée par la fiche, affichée sur la carte.** La
    comptabilité ne recalcule rien, elle ne fait plus que le découpage TTC → HT + TVA. Règles 31-37.
- Q : Sur quels postes la ventilation s'applique-t-elle ?
  - **R : sur les seules prestations** (options, prestations personnalisées, ressources), au prorata.
    **Jamais sur l'hébergement**, jamais sur la taxe de séjour. Règle 32.
- Q : Peut-on ajuster un complément sous le montant de sa taxe de séjour ?
  - **R : non**, plancher = taxe + hébergement, sinon l'écriture `46710000` et la déclaration de taxe
    divergent. Règle 33.

**Encore ouvertes :**

- Q : « prestations » inclut-il les **ressources** (bain nordique, compte `70601000`) ou seulement les
  options (`70600010`) ? La spec suppose **oui, les deux** — tout ce qui n'est ni hébergement ni taxe.
  À confirmer avant implémentation.
- Q : Faut-il afficher la ventilation aussi quand aucun ajustement n'est posé (pédagogie) ou seulement
  quand le montant est figé ? La spec dit : seulement quand un ajustement est posé.
