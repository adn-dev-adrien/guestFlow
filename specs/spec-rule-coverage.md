# Une règle de spec sans test est une règle non livrée

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/spec-rule-coverage` |
| **Created** | 2026-09-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Le 2026-09-01, une relecture règle par règle des quatre specs du paiement unique — 73 règles — a
trouvé **trois règles écrites et jamais construites** :

| Règle | Écrite en | Ce que le code faisait |
|---|---|---|
| 13 — le tableau des encaissements replie un paiement unique | v2.9.0 | il listait une ligne par échéance ; les cartes de journal, elles, regroupaient. **Les deux zones de la même page se contredisaient** |
| 10 — un check-in encaissé en une fois écrit UNE ligne d'historique | v2.9.0 | il en écrivait trois |
| 23 — la réduction meurt avec le groupe | 2026-08-31 | vrai depuis la fiche, faux depuis le SAS : la réduction survivait et **minorait la comptabilité** au nom d'une collecte disparue |

Aucune n'avait été détectée par les suites — 3 817 tests serveur et 1 191 tests client, tous verts
pendant que ces règles n'existaient que sur le papier. Elles ont été trouvées à l'œil, en relisant.
Et la première ne l'a été que parce qu'un opérateur a signalé « je vois toujours 2 entrées ».

**Ce n'est pas un défaut de rigueur, c'est un défaut d'outillage.** Le lien entre une règle et le
test qui la prouve existe déjà — **584 citations « rule N » dans 267 fichiers de test**, la
convention est vivante et respectée. Mais c'est du texte libre dans un commentaire : rien ne peut
répondre à « quelles règles n'ont pas de test ? », donc personne ne se pose la question.

### 1.1 L'ordre de grandeur

| | Mesure (2026-09-01) |
|---|---|
| Specs (hors template) | 208, dont 193 `Implemented` |
| Règles numérotées | 2 815 |
| Citations d'un numéro de règle dans les tests | 584, dans 267 fichiers |
| Specs touchant à l'argent | 103 (1 557 règles) |
| Noyau paiement / comptabilité | 44 specs, 830 règles |

Viser un test par règle sur 2 815 règles serait de l'effort déplacé : la plupart ne portent pas
d'argent, et l'audit seul coûterait des centaines d'heures. Cette spec construit **la mesure et la
barrière** ; le rattrapage de l'existant se fera famille par famille, hors de son périmètre (§8).

## 2. Goal

Pouvoir répondre, à tout moment et sans lire une ligne de code, à « **quelles règles de cette spec
n'ont aucun test ?** » — et empêcher qu'une règle **nouvelle** soit livrée sans le sien.

---

## 3. Functional rules

### 3.1 La mesure

1. **La convention existante est la convention.** Le lien règle → test se lit dans les commentaires
   déjà écrits : `specs/<nom>.md §3.2 rule 10`, `rules 4-5`, `règle 11bis`, `§3.E rules 28 + 30b`.
   Aucune nouvelle balise n'est imposée : les 584 citations en place deviennent immédiatement de la
   couverture, et la revue de code ne change pas d'habitude.
2. **Ce qui compte comme une règle** : les entrées numérotées de la section « Functional rules »
   (`## 3.`) d'une spec, sous-sections comprises, jusqu'au `##` suivant. Les listes numérotées des
   autres sections (architecture, plan de test, questions ouvertes) ne sont pas des règles et ne
   sont jamais comptées.
3. **Ce qui compte comme un test** : un fichier de test serveur (`server/src/tests/**`) ou client
   (`client/src/**/__tests__/**`) qui cite la spec puis le numéro. Une citation est rattachée à la
   **spec nommée le plus près au-dessus d'elle** dans le fichier — c'est ainsi qu'un humain lit un
   commentaire de plusieurs lignes.
4. **Les suffixes et les groupes sont compris** : `2bis`, `20c`, `rules 4-5` (plage), `rules 28 + 30b`
   (liste). Une plage couvre tous les entiers qu'elle contient.
5. **Une règle peut être déclarée non testable**, et alors elle est comptée couverte — mais
   **jamais en silence** : la spec elle-même porte, sous la règle, une ligne
   `> **Sans test** — <raison>`. Une prose de cadrage (« la ventilation ne change pas ») ou une
   décision (« arbitré avec Adrien ») n'a rien à prouver ; l'exiger produirait des tests décoratifs,
   qui sont pires que pas de test parce qu'ils font croire à une garantie.
6. **Le rapport est lisible sans contexte** : par spec, le nombre de règles, le nombre couvertes, les
   numéros manquants. Trié par nombre de règles non couvertes, le pire d'abord.
7. `node scripts/check-spec-coverage.mjs` sort le rapport global ; `--spec <nom>` détaille une spec,
   règle par règle, avec le fichier de test qui l'épingle.
   > **Sans test** — plomberie de CLI : le contenu vient de `buildCoverage`, déjà épinglé (règles 5 et
   > 6) ; il ne resterait à prouver que du formatage de terminal.

### 3.2 La barrière

8. **Une règle AJOUTÉE doit être citée par un test.** Sur une PR, le contrôle compare les specs au
   `master` d'origine : toute règle nouvelle qui n'est citée nulle part dans les tests **après** le
   changement fait échouer le contrôle, avec son numéro et le nom de sa spec.
9. **Une règle MODIFIÉE ne bloque pas**, elle avertit. Sinon corriger une faute de frappe dans une
   règle exigerait de toucher un test, et la barrière deviendrait un péage qu'on apprend à
   contourner. C'est précisément ce qu'il faut éviter : une barrière qu'on désactive ne protège rien.
10. **Aucune dette héritée n'est exigée.** Le contrôle ne regarde que le diff : les 2 815 règles
    existantes ne bloquent aucune PR. Le rattrapage est un chantier à part (§8).
    > **Sans test** — structurel plutôt que testable : `gateVerdict` ne reçoit QUE les règles du diff,
    > il n'a aucun moyen d'en voir d'autres. Un test ne prouverait rien de plus que la signature.
11. **La citation peut venir d'un test déjà écrit.** Une règle nouvelle couverte par un test existant
    qui la nomme passe : ce qui compte est que la règle soit prouvée, pas qu'un fichier ait changé.
12. **Le contrôle est un job de CI à part**, sur les PR uniquement, à côté des suites. Il ne bloque
    ni la release ni un push sur `master` — une règle non citée est un défaut de livraison, pas une
    urgence de production.
    > **Sans test** — c'est de la configuration de workflow (`if: github.event_name ==
    > 'pull_request'`), prouvée par l'exécution du job lui-même : il tourne sur cette PR, et nulle
    > part ailleurs.

**Edge cases :**

- Une spec sans section `## 3.` → aucune règle, absente du rapport (c'est le cas des specs de
  cadrage et des index).
- Une spec renommée → ses citations pointent l'ancien nom et deviennent orphelines : le rapport les
  liste dans une section « citations sans spec », ce qui rend le renommage visible au lieu de le
  laisser dégrader la couverture en silence.
- Une citation vers une règle qui n'existe pas (numéro périmé après une renumérotation) → même
  section « citations orphelines ». C'est un signal, pas une erreur bloquante.
- Un test supprimé → la couverture baisse au rapport suivant ; la barrière ne s'en émeut pas, elle ne
  regarde que les règles ajoutées.

---

## 4. Architecture

> **Rien côté application.** C'est de l'outillage de dépôt : un script pur, ses tests, un job de CI.
> Aucun octet n'entre dans l'archive livrée à l'opérateur.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `tests/` | `spec-rule-coverage.unit.test.js` | C | Épingle les fonctions pures du script : extraction des règles, lecture des citations, plages et suffixes, exemptions, rattachement à la spec la plus proche, et le verdict de la barrière. |

Rien d'autre : le serveur applicatif n'est pas concerné.

### 4.2 Outillage (`scripts/`)

| File | T/C | Responsibility |
|---|---|---|
| `scripts/check-spec-coverage.mjs` | C | Fonctions pures exportées (`parseSpecRules`, `parseCitations`, `buildCoverage`, `gateVerdict`) + une CLI qui lit les fichiers. Même forme que `build-changelog.mjs` : la logique est exportée pour être testée, la CLI ne fait que des entrées-sorties. |

### 4.3 CI (`.github/workflows/`)

| File | T/C | Responsibility |
|---|---|---|
| `unit-tests.yml` | T | Un job `spec rules` sur les PR : `node scripts/check-spec-coverage.mjs --changed --base origin/${{ github.base_ref }}`. Échoue si une règle ajoutée n'est citée par aucun test. |

### 4.4 API contract

Aucun. Rien n'est exposé à l'application.

---

## 5. Data model

**Aucun changement.** Ni colonne, ni migration, ni donnée.

## 6. UI / UX

**Aucune interface.** La sortie est un rapport de terminal et un job de CI. Le format du rapport :

```
specs/single-payment-at-check-in.md      15/17 règles   manquantes : 10, 13
specs/arrival-payment-detail-...md       27/28 règles   manquantes : 23
...
Total : 2 815 règles, 1 042 couvertes (37 %), 118 exemptées.

Citations orphelines (spec ou règle inexistante) : 4
  server/src/tests/xxx.unit.test.js → specs/ancien-nom.md rule 3
```

Et pour la barrière, sur une PR :

```
✗ specs/ma-spec.md règle 7 : ajoutée par cette PR, citée par aucun test.
  Ajoutez un test qui la nomme (« specs/ma-spec.md rule 7 »), ou déclarez-la
  non testable avec une ligne « > **Sans test** — <raison> » sous la règle.
```

## 7. Test plan

### Server unit tests
- [ ] `tests/spec-rule-coverage.unit.test.js` — les règles du §3 et elles seules ; les sous-sections
      comptent ; les listes des autres sections ne comptent pas ; suffixes `bis`/`ter`/lettre ;
      plages `4-5` ; listes `28 + 30b` ; rattachement à la spec la plus proche au-dessus ; exemption
      `> **Sans test**` ; citations orphelines ; et la barrière : une règle ajoutée sans citation
      échoue, avec citation passe, une règle modifiée avertit sans échouer.

### Vérification réelle (2026-09-01)

- [x] **Le rapport tourne sur les 208 specs** : 2 501 règles retenues (les 314 lignes numérotées hors
      §3 sont bien écartées), **474 couvertes — 19 %**. C'est le point de départ mesuré.
- [x] **Il retrouve le cas connu** : `--spec single-payment-at-check-in` liste les règles 10, 13 et
      8bis comme couvertes, épinglées par les tests écrits la veille — et les 15 autres comme
      manquantes.
- [x] **Deux défauts du parseur trouvés et corrigés en le confrontant au dépôt réel**, pas en
      théorie : une date (« règle 2026-08-31 ») était lue comme une plage de règles, et une citation
      était attribuée à une spec mentionnée en passant 25 lignes plus haut. Les deux produisaient de
      la couverture fantôme — une règle comptée prouvée sans l'être — ce qui est pire que pas de
      mesure. Chacun a son test.
- [x] **La barrière a mordu son propre auteur** : au premier passage sur cette PR, elle a refusé 8 des
      12 règles de cette spec. Elles ont été satisfaites comme n'importe quelle autre — 9 par un test
      qui les nomme, 3 déclarées `> **Sans test**` avec leur raison. C'est la démonstration que le
      mécanisme n'a pas de porte dérobée pour celui qui l'écrit.
- [x] **Le message final ne surestime pas** : « 12 règles ajoutées : 9 citées par un test, 3 déclarées
      sans test » — une règle exemptée n'est pas une règle prouvée, et l'annoncer autrement rendrait
      le contrôle rassurant à tort.

## 8. Out of scope

- **Le rattrapage des 2 815 règles existantes.** La barrière ne regarde que le diff. Le noyau
  paiement-comptabilité (44 specs, 830 règles) sera repris famille par famille, une PR par famille,
  et le rapport de cette spec est ce qui rendra ce chantier pilotable.
- **Vérifier qu'une règle est correctement implémentée.** La couverture attrape l'oubli, pas
  l'erreur. Contre l'erreur il n'y a que le rejeu du parcours réel dans le navigateur.
- **Imposer un test par règle sur les specs non touchées.** Une règle ancienne se fait épingler
  quand on touche sa spec, pas avant.

## 9. Open questions

- **Q1 — faut-il un seuil de couverture qui ne doit jamais baisser ?** Tentant, mais un seuil global
  sur 2 815 règles bouge à chaque spec ajoutée et finit ignoré. Proposition : pas de seuil au
  départ ; on regarde le rapport après trois mois et on décide alors s'il mérite un plancher, et sur
  quel périmètre (le noyau argent, sans doute, plutôt que le total).
