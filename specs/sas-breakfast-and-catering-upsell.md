# SAS d'arrivée — vendre le petit déjeuner et la restauration au check-in

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/sas-breakfast-and-catering-upsell` |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

L'**arrival SAS** ([ReservationSasDialog.jsx](../client/src/components/sas/ReservationSasDialog.jsx),
[sasController.js](../server/src/controllers/sasController.js), spec
[arrival-departure-sas.md](arrival-departure-sas.md)) sait déjà vendre deux prestations sur place — le
**ménage** et le **linge de toilette** — en activant leur option catalogue
([sas-upsells-activate-catalogue-option.md](sas-upsells-activate-catalogue-option.md),
[sas-bath-linen-upsell.md](sas-bath-linen-upsell.md)) : ligne `reservation_options` avec
`inComplement = 1` + `sasArrivalOrigin = 1`, prix résolu serveur, réglée sur le récap.

Ce mécanisme ne sait faire qu'une chose : **une ligne, quantité 1**. Il ne sait pas écrire de
`cardOccurrences`, donc il ne peut pas vendre les deux prestations que l'hôte propose le plus souvent
au moment du check-in :

- le **petit déjeuner** (option `autoOptionType = 'breakfast'`, carte `once_per_day`, `per_person_per_night`) —
  facturé aux **moments** servis (`quantity = occurrences`, `billedUnits = occurrences × personnes`,
  [pricing.js](../server/src/utils/pricing.js) branche `showsPlanningCard`) et **préparé** à partir de
  ces mêmes occurrences ([breakfastModel.js](../server/src/models/breakfastModel.js)) ;
- la **restauration** (catégorie « Restauration » : *Le repas des trappeurs*, planches apéro —
  [option-categories.md](option-categories.md)).

Aujourd'hui l'opérateur qui vend un petit déjeuner à l'arrivée doit sortir du SAS, ouvrir la fiche, y
cocher les matins, sauvegarder, puis revenir — et la vente ne tombe pas dans le complément d'arrivée
qu'il est en train d'encaisser.

Deux pièges découverts pendant l'étude, traités ici :

- `commitArrivalSas` écrit les compteurs de composition du petit déjeuner **à 0** quand la page n'a pas
  tourné, et les valeurs par défaut (viennoiseries = nb de personnes, ½ baguette/pers.) ne s'appliquent
  plus une fois `arrivalSasDoneAt` posé ([breakfastModel.js](../server/src/models/breakfastModel.js)) :
  un petit déjeuner vendu au SAS arriverait en cuisine « 0 partout » ;
- toute l'activation d'option est sous le garde `complementPaid !== 1`, donc une vente sur un
  complément **déjà encaissé** était purement et simplement perdue.

## 2. Goal

À la **fin du check-in**, l'opérateur peut vendre au client **le petit déjeuner** (en choisissant les
matins, dans la même fenêtre qu'à la réservation) et **la restauration** (les options « Restauration »
du logement, en choisissant les moments ou le nombre) ; la prestation devient une vraie ligne de la
réservation — préparée, planifiée, comptée — et son montant rejoint le **complément à percevoir**.

## 3. Functional rules

### 3.1 Le petit déjeuner

1. **Nouvelle page « Petit déjeuner » (offre)**, insérée **après la page « Linge de toilette »** et
   avant la caution reportée / la météo / le récap. Affichée uniquement quand le serveur propose
   l'offre (`sasSales.breakfast.available`). Elle annonce le tarif : `prix unitaire` + le coût d'un
   matin pour la tablée, et **le nombre de matins possibles sur ce séjour**.
2. **L'étape est fermée si le petit déjeuner a été pris à la réservation** (ligne d'option non
   `sasArrivalOrigin`) — décision 2026-08-17 : ajouter des matins à une prestation déjà vendue se fait
   depuis la fiche, une option ne portant qu'**une seule** ligne par réservation
   (`PRIMARY KEY (reservationId, optionId)`), donc qu'un seul routage acompte/complément.
   Une ligne que **ce SAS** a vendue laisse au contraire l'étape ouverte, pré-cochée, pour pouvoir la
   corriger ou la retirer.
3. Deux boutons, comme le ménage : **« Ajouter le petit déjeuner »** → page des matins ;
   **« Non merci »** → rien n'est vendu (et une vente d'un run précédent est retirée).
4. **Page « Quels matins ? »** : la grille d'occurrences **identique à la fiche** (un chip par matin),
   avec la même légende de quantité — « Quantité : **6** (3 × 2 pers.) » — plus le nombre de petits
   déjeuners et le montant. **Les matins candidats sont ceux du séjour** : le matin d'arrivée est exclu
   (le client n'est pas encore là à 9 h), le matin de départ est inclus — et retimé à 30 min avant le
   check-out quand celui-ci précède l'heure du petit déjeuner
   ([option-planning-card.md](option-planning-card.md) §3.2). Le nombre de matins proposés est donc
   exactement le **nombre de nuits** : c'est le contrôle demandé, il est structurel.
   À l'ouverture, **tous les matins sont cochés** (l'upsell naturel est « le séjour entier ») ;
   décocher est libre, et n'en garder aucun annule la vente (message explicite).
   4.bis **Le nombre de petits déjeuners par matin est réglable** (2026-08-20,
   [card-option-served-persons.md](card-option-served-persons.md)) : un pas-à-pas « Personnes servies »
   sous la grille, pré-rempli avec la tablée (ou avec ce que ce SAS a vendu en ré-ouverture) et plafonné
   à la capacité du logement. La légende devient « Quantité : 6 (2 × 3 pers. servies) », et le montant
   suit. La composition enchaînée (rule 5) est pré-remplie **à partir du nombre servi**, pas de la
   tablée : 3 servis → 3 viennoiseries et 1,5 baguette.
5. **La composition enchaîne la vente** : la page « Petit déjeuner » existante (café / thé / chocolat /
   lait, viennoiseries / céréales / pain) s'ouvre juste après, **pré-remplie** avec l'heure de l'option
   et les défauts d'un check-in jamais validé (viennoiseries = nb de personnes, ½ baguette/pers. —
   [sas-breakfast-bread-and-push.md](sas-breakfast-bread-and-push.md) rule 3). Un petit déjeuner
   **déjà réservé** garde sa page à sa place habituelle (plus haut dans le SAS) : la page n'apparaît
   jamais deux fois.

### 3.2 La restauration

6. **Nouvelle page de demande « Restauration »** après le petit déjeuner : « Le client souhaite-t-il de
   la restauration ? » → **« Oui, proposer »** ouvre le catalogue, **« Non merci »** ne vend rien.
   Affichée seulement si le logement a au moins une option vendable dans la catégorie
   **« Restauration »** (décision 2026-08-17 — pas les boissons, pas tout le catalogue).
7. **Page catalogue** : une ligne par option, avec son prix et son type de prix, et le contrôle qui
   correspond à sa nature — **le même système que la fiche** :
   - option à carte (*Le repas des trappeurs*) → la **grille des moments** (jour × créneau) ; la
     quantité facturée est `moments × personnes servies`, affichée comme sur la fiche. Rien n'est
     pré-coché : un repas se prend moment par moment (divergence assumée avec la fiche, qui pré-coche
     tout). Dès qu'un moment est coché, le pas-à-pas **« Personnes servies »** apparaît (2026-08-20,
     [card-option-served-persons.md](card-option-served-persons.md)) : la tablée par défaut, baissée
     quand les enfants ne mangent pas, plafonnée à la capacité du logement.
   - option simple (planches) → un **interrupteur** qui remplit tout seul la quantité par défaut (le
     multiplicateur du type de prix : `per_person` → la tablée, `per_stay` → 1), puis un pas-à-pas
     pour l'ajuster.
   Un total « Total restauration » ferme la page.
8. Les options **déjà prises à la réservation** ne sont pas listées (même règle que le petit déjeuner,
   rule 2) ; celles que ce SAS a vendues restent listées, pré-sélectionnées.

### 3.3 Ce qui est écrit, et où va l'argent

9. **Une vraie option catalogue, jamais une ligne custom** : chaque prestation vendue crée/rafraîchit
   une ligne `reservation_options` avec `inComplement = 1`, `sasArrivalOrigin = 1` et — pour une option
   à carte — ses `cardOccurrences`. C'est ce qui fait apparaître les cartes du planning, la préparation
   du petit déjeuner et le comptage habituel des prestations, exactement comme si la prestation avait
   été prise avant le check-in.
10. **Le client envoie l'intention, jamais un prix** (CLAUDE.md §6.0) : `soldOptions` =
    `[{ optionId, occurrences, persons }]` (option à carte — `persons` = les couverts, 2026-08-20) ou
    `[{ optionId, units }]` (les unités facturées, ce que la fiche appelle « Qté »). Le serveur résout
    l'option, le **prix par logement** (`property_option_prices` sinon `options.price`) et
    l'arithmétique du moteur : `billedUnits = occurrences × personnes servies` / `units`,
    `quantity = occurrences` / `units ÷ multiplicateur`, `totalPrice = prix × billedUnits`. Un moment
    que le client ne peut pas honorer (hors présence) est refusé côté serveur, et `persons` est borné à
    la capacité du logement puis persisté dans `reservation_options.cardPersons` (`NULL` = toute la
    tablée).
11. **Remplacement, jamais empilement** ([reopen-completed-sas.md](reopen-completed-sas.md) §4 rule 4) :
    le tableau `soldOptions` est la sélection complète du run. Toute option `sasArrivalOrigin = 1`
    absente du tableau est supprimée (sauf le ménage et le linge de toilette, qui gardent leurs propres
    booléens) ; le delta du complément est recalculé, donc rejouer le SAS ne double jamais la facture.
    `soldOptions` **absent** (les deux étapes n'ont pas tourné) = on ne touche à rien.
12. **Règlement** : rien n'est demandé sur les pages de vente. Le montant rejoint le **complément
    d'arrivée** et se règle en une fois sur le récap (**CB/Chèque · Payé en liquide · En fin de
    séjour**, [sas-recap-payment-buttons.md](sas-recap-payment-buttons.md)) avec le reste.

### 3.4 Vente sur un complément déjà encaissé

13. Un complément encaissé ne bouge plus jamais
    ([frozen-complement-trusts-client.md](frozen-complement-trusts-client.md)). Vendre après coup est
    donc une **vente en cours de séjour**, et suit exactement le circuit existant des boissons
    ([mid-stay-notes.md](mid-stay-notes.md)) :
    - la ligne d'option **est écrite quand même** (la prestation doit être préparée et planifiée) ;
    - son montant part dans le **complément de fin de séjour**, donc encaissable **de suite par une
      note** ou **au check-out** ;
    - `complementAmount` n'est pas touché.
    Techniquement : la baseline des extras est figée **avant** l'écriture
    (`captureArrivalExtrasBaseline`, sans la garde de date — le SAS d'arrivée *est* le moment où le
    séjour commence), la vente est fusionnée dans les lignes mid-stay déjà stockées (celles vendues
    plus tôt depuis la fiche sont conservées telles quelles), et sa clé `opt:<id>` est **exclue** du
    repli dans la baseline — sinon le split mid-stay l'effacerait au prochain enregistrement.

### 3.5 Traces

14. L'historique de la fiche gagne une ligne **« Prestations vendues au check-in »** (titre × unités et
    montant, plus « — 1 × 2 pers. servies » quand les couverts ne sont pas toute la tablée), à côté des
    lignes ménage / linge de toilette existantes
    ([arrival-departure-sas.md](arrival-departure-sas.md) §3.7).

**Edge cases:**
- Aucune option « Restauration » vendable pour ce logement → la page de demande n'apparaît pas.
- Petit déjeuner sans carte de planning (config héritée) → non vendable au SAS (les matins *sont* le
  produit) ; il reste vendable depuis la fiche.
- Séjour d'une nuit → un seul matin candidat ; check-out avant l'heure du petit déjeuner → ce matin est
  proposé retimé, jamais perdu.
- SAS rouvert plusieurs jours après l'arrivée → tous les matins du séjour restent proposés, y compris
  passés : rouvrir le SAS est justement la façon de corriger ce qui a été servi.
- Prix ≤ 0 (option non tarifée pour ce logement) → l'option n'est pas proposée.
- « Quitter » à tout moment → rien n'est écrit (l'état vit en mémoire jusqu'au commit unique).

---

## 4. Architecture

> **Fat backend, thin frontend.** Les matins candidats, les moments servis, les prix par logement, la
> quantité facturée et le routage de l'argent sont **tous** résolus côté serveur. Le client rend
> l'offre, garde la sélection en mémoire et l'envoie dans le commit unique. Les montants affichés sur
> les pages de vente et le récap sont un **aperçu** (même contrat que les frais d'extincteur) : le
> serveur re-tarife chaque ligne au commit, aucun montant client n'est cru.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `utils/cardOccurrences.js` | C | Jumeau serveur de `client/src/utils/cardOccurrences.js` : jours du séjour, créneaux d'une option à carte, règle de présence (+ retiming du petit déjeuner du matin de départ), **grille des moments candidats**, normalisation des occurrences. |
| `utils/` | `utils/sasOptionSale.js` | C | Pur : tarification d'une vente SAS (`priceOptionSale`, exactement l'arithmétique du moteur), construction de l'offre d'une option (`buildOptionOffer`), assemblage des deux étapes (`buildSasSaleOffers`), défauts de composition du petit déjeuner. |
| `utils/` | `utils/welcomePack.js` | T | Réutilise les helpers extraits (jours du séjour, présence) au lieu de ses copies locales — comportement inchangé. |
| `utils/` | `utils/sasAudit.js` | T | Nouveau champ d'historique « Prestations vendues au check-in ». |
| `models/` | `models/reservationsModel.js` | T | `resolveSasOptionSales` (intention → lignes tarifées, prix par logement, options de la fiche protégées) ; `listSasArrivalOptionLines` (historique) ; `captureArrivalExtrasBaseline` (capture sans garde de date) ; `commitArrivalSas` accepte `soldOptions` : écriture remplaçante des lignes vendues (avec `cardOccurrences`), delta du complément, et routage fin de séjour quand le complément est gelé. |
| `controllers/` | `controllers/sasController.js` | T | `getSas` expose `sasSales` (offre petit déjeuner + catalogue restauration) via `optionsModel.listForProperty` ; `commitArrival` transmet `soldOptions` ; le snapshot d'historique inclut les prestations vendues. |
| `database.js` | — | — | **Aucune migration** : `reservation_options.cardOccurrences`, `inComplement`, `sasArrivalOrigin` et `arrivalExtrasBaseline` existent déjà. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/OccurrenceGrid.jsx` | C | **Composant générique** : la grille de moments (une ligne par jour, un chip par créneau) + l'éditeur d'heures optionnel + la légende de quantité. Extrait de `OptionRow` pour être partagé fiche ↔ SAS. |
| `components/` | `components/reservation/OptionRow.jsx` | T | `OptionCardOccurrences` garde sa logique de formulaire et délègue le rendu à `OccurrenceGrid` (aucun changement visuel). |
| `components/` | `components/sas/ReservationSasDialog.jsx` | T | 4 nouvelles pages (`breakfastSale`, `breakfastMornings`, `cateringAsk`, `cateringItems`), l'état des ventes, la composition enchaînée + ses défauts, les lignes d'aperçu du récap, `soldOptions` dans le commit, et la ré-ouverture pré-remplie. |
| `services/` | `api.js` | — | Inchangé : `commitArrivalSas` passe l'objet payload tel quel. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Switch`/`Chip`/`Divider`/`Stack`, le `CountStepper` du SAS, `ConfirmDialog`, `formatCurrency`, `PRICE_TYPE_LABELS` | Réutilisés tels quels. |
| **Created (new generic)** | `OccurrenceGrid` | Générique par construction : deux consommateurs dès le premier jour (fiche + SAS), aucun couplage au contexte du formulaire. |
| **Specific (kept feature-local)** | Les 4 pages de vente dans `ReservationSasDialog` | Étapes de l'assistant, comme le ménage et le linge de toilette. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/sas?mode=arrival` | — | ajoute `sasSales: { persons, nights, breakfast: { available, optionId, title, unitPrice, priceType, perPerson, showsPlanningCard, mornings[], selected[], defaultUnits, defaultPersons, maxPersons, selectedPersons, compositionPerPerson, sasOrigin }, catering: { available, options: [{ optionId, title, description, unitPrice, priceType, perPerson, showsPlanningCard, occurrences[], selectedOccurrences[], selectedUnits, defaultUnits, multiplier, defaultPersons, maxPersons, selectedPersons }] } }` | Le serveur décide de ce qui est vendable, à quel prix et pour combien de couverts au maximum. `mode=departure` → tout vide. `compositionPerPerson` remplace `defaultComposition` (2026-08-20) : la règle par personne servie, que l'assistant multiplie par le nombre vendu. |
| POST | `/api/reservations/:id/sas/arrival` | `soldOptions: [{ optionId, occurrences: [{date,time}], persons } \| { optionId, units }]` — sélection complète, `undefined` si les étapes n'ont pas tourné | `{ ok, complementAmount }` | Le serveur tarife, remplace les lignes du SAS et route l'argent (complément d'arrivée, ou fin de séjour si le complément est gelé). `persons` (les couverts) est borné à la capacité du logement. |

---

## 5. Data model

**Aucun changement de schéma.** Réutilise :
- `reservation_options` : `quantity`, `unitPrice`, `billedUnits`, `priceType`, `totalPrice`,
  `cardOccurrences` (JSON `[{date,time}]`), `inComplement = 1`, `sasArrivalOrigin = 1` ;
- `reservations.complementAmount` (delta de la vente) ;
- `reservations.arrivalExtrasBaseline` + `endOfStayComplementAmount/Detail` (vente sur complément gelé) ;
- `options` (`category`, `showsPlanningCard`, `cardRepeat`, `planningCardTimes`, `priceType`) +
  `property_option_prices` (prix par logement).

**Data impact :** purement additif ; aucune migration, aucun backfill, aucune réservation existante
recalculée.

## 6. UI / UX

- **Page « Petit déjeuner » (offre)** — icône viennoiserie : « Le client n'a pas pris le petit
  déjeuner. », le tarif (« 8,00 € par personne et par matin — 16,00 € le matin pour 2 pers. »), le
  nombre de matins possibles, et le chip « Petit déjeuner ajouté » en ré-ouverture. Boutons :
  **« Ajouter le petit déjeuner »** (outlined) / **« Non merci »** (contained).
- **Page « Quels matins ? »** — la grille de chips (un par matin), la légende « Quantité : 6 (3 × 2
  pers.) », puis « 6 petits déjeuners — 48,00 € ». Avertissement quand plus aucun matin n'est coché.
- **Page « Restauration » (demande)** — icône couverts, question + une phrase (« Repas, planches
  apéro… ajoutés au complément à percevoir »), boutons **« Oui, proposer »** / **« Non merci »**.
- **Page catalogue** — une ligne par option (titre, prix + type de prix), grille de moments pour les
  options à carte, interrupteur + pas-à-pas pour les autres, total en pied de page.
- **Récap d'arrivée** — chaque vente apparaît en « + » (« Petit déjeuner : 6 × 8,00 € = 48,00 € »),
  entre dans le total à percevoir et se règle avec les boutons de règlement existants.
- **Responsive** — hérite de la coquille du SAS : plein écran sur `xs`, boutons empilés, cibles
  tactiles ≥ 48 px ; les chips de moments passent à la ligne (`flexWrap`) et les lignes du catalogue
  s'empilent verticalement. Aucun tableau, aucun défilement horizontal.
- **Sticky action bar** — sans objet (assistant en dialogue).

## 7. Test plan

### Server unit tests — `tests/sas-option-sales.unit.test.js` (21 tests)
- [x] Offres : matins = nuits du séjour (matin d'arrivée exclu, matin de départ inclus), retiming quand
      le check-out précède l'heure ; étape fermée si pris à la réservation ; rouverte pré-sélectionnée
      si vendue par le SAS ; catalogue restauration filtré (boissons, options déjà prises, exclues) ;
      quantité par défaut = multiplicateur du type de prix.
- [x] Tarification : `occurrences × personnes` pour une option à carte ; refus d'un moment hors
      présence ; `units` → `quantity = units ÷ multiplicateur` ; rien vendu → aucune ligne.
- [x] Commit : ligne catalogue avec `cardOccurrences`, `inComplement`, `sasArrivalOrigin` + complément
      bumpé ; re-run qui re-tarife sans empiler ; `[]` qui retire la vente et son argent ; option de la
      fiche jamais touchée ; repas + planche vendus ensemble ; prix par logement ; `undefined` = on ne
      touche à rien ; complément gelé → ligne écrite, complément d'arrivée intact, montant en fin de
      séjour, clé hors baseline ; re-run qui dé-sélectionne et rend l'argent sans toucher aux ventes
      faites depuis la fiche ; historique des prestations vendues.

### Client tests (vitest) — `components/sas/__tests__/ReservationSasDialog.test.jsx` (6 tests)
- [x] Vente du petit déjeuner : matins pré-cochés, légende « (2 × 2 pers.) », total, composition
      enchaînée pré-remplie, payload `soldOptions` + composition.
- [x] « Non merci » → `soldOptions: []`, page des matins sautée.
- [x] Décocher tous les matins → avertissement + vente annulée.
- [x] Ré-ouverture : seule la matinée vendue est cochée.
- [x] Restauration : repas vendu au moment (1 × 2 pers. = 50 €), planche vendue à la quantité par
      défaut, payload conforme.
- [x] Rien en offre → aucune page de vente, `soldOptions` absent.

### Full suites
- [x] `cd server && npm test` — 2951 tests.
- [x] `cd client && npx vitest run` — 951 tests.
- [x] `npm run test:e2e` (Playwright).
- [x] `cd client && npm run build`.

### Manual UI verification
- [x] Parcours complet dans le navigateur : vente du petit déjeuner (2 matins), composition, vente d'un
      repas + d'une planche, récap, validation, puis vérification de la fiche (options créées, en
      complément) et du planning (cartes créées).
- [x] Mobile (`xs`) : pages plein écran, chips et lignes empilés, boutons pleine largeur.

## 8. Out of scope

> **Amendé le 2026-08-20** par [card-option-served-persons.md](card-option-served-persons.md) : le
> nombre de couverts d'une option à carte facturée par personne est désormais réglable au check-in
> (et sur la fiche). Le reste de cette section tient toujours.

- Ajouter des matins à un petit déjeuner **déjà réservé** (décision 2026-08-17 : ça passe par la fiche).
- Vendre au **check-out** (le SAS de départ ne vend rien).
- Les **boissons** au check-in (elles restent vendues en cours de séjour par les notes).
- Encaissement en ligne (Qonto) d'une vente de check-in : le règlement reste manuel, sur le récap.
- Éditer l'heure d'un moment depuis le SAS (elle vient de la configuration de l'option).

## 9. Open questions

Toutes tranchées le 2026-08-17 (questionnaire) :
- **Petit déjeuner déjà pris** → **étape masquée** ; les matins supplémentaires passent par la fiche (§3.1 rule 2).
- **Périmètre du catalogue** → **catégorie « Restauration » uniquement** (§3.2 rule 6).
- **Composition d'un petit déjeuner vendu** → **page enchaînée**, pré-remplie (§3.1 rule 5).
- **Complément déjà encaissé** → **même mécanisme que les boissons en séjour** : payé de suite (note) ou
  au check-out (§3.4).
