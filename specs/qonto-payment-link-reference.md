# Référence de réservation sur les liens de paiement Qonto

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/qonto-payment-link-reference` _(user-managed)_ |
| **Created** | 2026-09-10 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Les liens de paiement Qonto créés par GuestFlow (tunnel public + demandes d'acompte/solde côté
admin) envoient des articles au libellé générique : **« Séjour et prestations »** et **« Taxe de
séjour »** (`utils/devisQuote.js` `fullPaymentComponents`, `controllers/paymentsController.js`
`resolveVatComponents`). Côté Qonto, dans la liste **« Payment links »** de l'organisation, chaque
encaissement s'affiche donc « Séjour et prestations + 1 item » — **rien ne le rattache à une
réservation précise ni à un client**. Pour réconcilier un paiement, l'opérateur n'a que le montant et
l'e-mail du payeur.

L'API Qonto `POST /v2/payment_links` (forme *basket*, celle utilisée) accepte par article : `title`,
`description`, `quantity`, `unit_price`, `vat_rate`, `type`. Il n'existe **pas** de champ
`reference`/`debitor_name` au niveau du lien dans cette forme (ces champs n'existent que sur la forme
*invoice payment link*, qui exige une facture Qonto préalable — hors périmètre). Le levier disponible
et suffisant est donc **`title` + `description` de l'article principal**.

Vérifié en test E2E (2026-09-10, sandbox/Abacate) : la liste « Payment links » de Qonto affiche bien
le `title` de l'article. La transaction bancaire *settlée* (versement Mollie agrégé à J+2) ne porte pas
ce libellé — l'endroit fiable de réconciliation reste **l'enregistrement du lien** + l'e-mail payeur.

## 2. Goal

Que chaque lien de paiement Qonto porte, de façon lisible dans l'interface Qonto, **le numéro de
réservation (`devisNumber`) et le nom du client**, afin d'identifier sans ambiguïté à quelle
réservation correspond un encaissement.

## 3. Functional rules

1. L'**article principal** (la ligne « séjour ») d'un lien de paiement porte un **titre enrichi** de
   la forme : `Séjour <Bien> — <Réf> — <Nom Prénom>`
   (ex. `Séjour La Granja — 2026-09-002 — Claude Dupont`).
2. Ce même article porte une **`description`** détaillée :
   `Séjour du <JJ/MM/AAAA> au <JJ/MM/AAAA> · <N> nuit(s) · réf <Réf>` (client rappelé si utile).
3. La ligne **« Taxe de séjour »** garde son libellé inchangé (une seule ligne enrichie suffit ; la
   liste Qonto affiche « … + 1 item »).
4. L'enrichissement s'applique aux **trois types** de lien : `full` (paiement complet public),
   `deposit` (acompte) et `balance` (solde). Le libellé du type reste implicite dans la description si
   pertinent (ex. « Acompte — … »).
5. La **référence** est le `devisNumber` de la réservation. Le **nom** est `firstName lastName` du
   client rattaché. Le **bien** est le nom de la propriété (`properties.name`).
6. **Le montant facturé reste strictement inchangé.** L'enrichissement ne touche que des champs texte ;
   il ne modifie ni `unit_price`, ni `vat_rate`, ni la somme (le garde-fou `expectedTotalCents` de
   `payment-links-vat.md` reste vérifié à l'identique).
7. **Repli propre** si une donnée manque : pas de `devisNumber` → on omet le segment référence ; pas de
   client nommé → on omet le segment nom ; pas de nom de bien → « Séjour » seul. Jamais de segment vide
   (`—  —`) ni de `undefined`/`null` dans le libellé.
8. Longueur : le `title` est **tronqué proprement** à une limite sûre (≤ 120 caractères, coupe sur mot
   + « … ») pour rester lisible dans Qonto ; la `description` porte le détail complet.
9. Aucun secret ni donnée superflue dans le libellé : uniquement bien, référence, nom, dates, nb de
   nuits. Pas d'e-mail, pas de téléphone, pas de montant (déjà porté par le lien).

**Edge cases :**
- Devis sans numéro encore attribué → titre `Séjour <Bien> — <Nom>` (segment réf omis, règle 7).
- Client anonyme / sans nom → titre `Séjour <Bien> — <Réf>` (segment nom omis).
- Réservation d'une nuit → description « … · 1 nuit · … ».
- Taxe collectée à l'arrivée (pas de ligne taxe) → l'article séjour enrichi est la seule ligne.

---

## 4. Architecture

> **Fat backend, thin frontend.** Changement 100 % serveur : construction du libellé + transport du
> champ `description` jusqu'au payload Qonto. Aucune logique côté client.

### 4.1 Server side (`server/src/`)

**Choix d'implémentation (choke point unique).** Plutôt que d'enrichir chaque constructeur de
composants (`devisQuote.fullPaymentComponents`, `publicPaymentMode.depositPaymentComponents`,
`paymentsController.resolveVatComponents`), l'enrichissement se fait **au point de passage commun**
`ensurePaymentLink` (`utils/paymentRequestService.js`), juste avant `buildVatItems` — chemin par lequel
transitent **tous** les liens (public + admin, `full`/`deposit`/`balance`). Un seul endroit à lire,
une seule requête, aucun constructeur de composants modifié.

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `paymentLinkLabel.js` | **C** | Helper pur `buildStayLineLabel({ propertyName, reference, guest, startDate, endDate, kind })` → `{ title, description }`. Applique règles 1-2-4-7-8-9. Unit-testé. |
| `utils/` | `paymentRequestService.js` | T | `enrichStayComponent(database, id, type, components)` : un JOIN reservations⋈clients⋈properties, pose `title`/`description` sur `components[0]` (la ligne séjour taxable) via le helper. Appelé dans `ensurePaymentLink` avant `buildVatItems`. Échoue en silence → titres génériques conservés. |
| `utils/` | `paymentLinkItems.js` | T | `buildVatItems` : transporte un `description` optionnel des `components` vers les `items` de sortie (préservé quand une ligne est repliée ; jamais de clé vide). |
| `utils/` | `qontoClient.js` | T | `createPaymentLink`/`toLine` : ajoute `description` au wire item quand présent (champ API Qonto). Payload sinon inchangé. |
| `tests/` | `payment-link-label.unit.test.js` | **C** | Couvre le helper : format nominal, repli (règle 7), troncature (règle 8), 1 nuit, type dans la description (règle 4). |
| `tests/` | `payment-link-items.unit.test.js` | T | Ajoute : `description` transporté jusqu'aux items + **montant identique** avant/après (règle 6), survit au repli, blanc = absent. |
| `tests/` | `qonto-client.unit.test.js` | T | Ajoute : le `description` d'un item atteint le payload Qonto ; absent → pas de clé. |

**Notes :**
- Le helper est une **fonction pure** (aucun accès DB) : tout ce dont il a besoin lui est passé.
- La résolution bien/réf/nom/dates se fait **une fois**, là où les composants sont bâtis.
- Pas de nouvelle dépendance.

### 4.2 Client side (`client/src/`)

Aucun changement client. L'enrichissement est invisible dans GuestFlow ; il ne se voit que côté Qonto
et sur la page de paiement hébergée.

**Component reuse declaration :** N/A (aucun composant).

### 4.3 API contract

- **Externe (Qonto)** : le payload `POST /v2/payment_links` gagne un `description` sur l'article
  principal, et un `title` enrichi. Champs déjà supportés par l'API Qonto — pas de nouvelle forme.
- **Interne** : aucun endpoint GuestFlow modifié (mêmes routes, mêmes réponses).

## 5. Data Model

Aucune migration. On lit l'existant : `reservations.devisNumber`, `clients.firstName/lastName`,
`properties.name`, `reservations.startDate/endDate`.

## 6. UI / UX

- **GuestFlow** : rien de visible (server-only).
- **Qonto (constaté)** : liste « Payment links » → l'article affiche le titre enrichi ; le détail du
  lien et la page de paiement hébergée affichent titre + description.
- **Page de paiement client** : la ligne « séjour » montre le détail (bien, réf, dates) — utile aussi
  pour le client. Aucun montant/donnée sensible ajouté (règle 9).

## 7. Test Plan

**Unitaires (serveur) :**
1. `buildStayLineLabel` — format nominal `Séjour La Granja — 2026-09-002 — Claude Dupont` + description.
2. Repli : réf absente, nom absent, bien absent → pas de segment vide (règle 7).
3. Troncature ≤ 120 car., coupe sur mot (règle 8).
4. `buildVatItems` transporte `description` jusqu'aux items ; **somme inchangée** vs avant (règle 6).

**Manuel (sandbox Qonto) :**
5. Créer un lien full public → vérifier dans la liste « Payment links » Qonto que le titre porte réf +
   nom, et que le montant est identique au récap.
6. Créer un lien acompte (admin) → même vérification.

## 8. Out of Scope

- La forme **« invoice payment link »** de Qonto (`invoice_number`/`debitor_name`) — exige une facture
  Qonto préalable ; non retenue.
- Faire apparaître la référence sur la **transaction bancaire settlée** (versement Mollie agrégé) —
  hors de portée de l'API des liens.
- Toute modification de montant, de TVA ou de la logique de répartition (inviolable, règle 6).

## 9. Resolved (2026-09-10)

1. **Format du titre** — ✅ retenu : `Séjour <Bien> — <Réf> — <Nom>` (séparateur « — »,
   ordre bien / réf / nom).
2. **Ordre du nom** — ✅ `Prénom Nom` (ex. « Claude Dupont »).
3. **Nom dans la description** — ✅ **non** : le nom reste au titre seul ; la description porte
   dates + nuits + réf uniquement (pas de doublon). Règle 2 confirmée telle quelle.

---

## 10. Implementation progress

- **2026-09-11** — Implémenté. Helper pur `utils/paymentLinkLabel.js` + enrichissement au choke point
  `ensurePaymentLink` (`utils/paymentRequestService.js`), transport du `description` dans
  `buildVatItems` et `qontoClient.createPaymentLink`. Couvre les 3 types de lien (public + admin).
- **Tests** : `payment-link-label.unit.test.js` (11), ajouts à `payment-link-items.unit.test.js` (3,
  dont montant inchangé) et `qonto-client.unit.test.js` (1). **Suite serveur complète : 4053 pass /
  0 fail.**
- **Reste** : vérification manuelle en sandbox Qonto (Test Plan §7.5-6) — à faire lors du prochain
  passage sandbox connecté ; le rendu attendu est décrit dans le résumé HTML de validation.
