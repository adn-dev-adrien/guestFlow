# Recall the unpaid arrival complement at check-out

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/recall-arrival-complement-at-checkout` _(user-managed)_ |
| **Created** | 2026-06-23 |
| **Author** | Adrien |

---

## 1. Context

A reservation has two distinct complements (specs/arrival-departure-sas.md, cash-complement-and-endofstay-finance.md):

- **Arrival complement** (`complementAmount` / `complementPaid` / `complementPaidDate` / `complementPaidCash`) —
  the « complément à percevoir » collected on arrival: tourist tax routed to complement, on-site extras
  (`inComplement = 1`), SAS-added linen/cleaning. Has its own accounting routing (tourist tax → 46710000,
  extras → revenue).
- **End-of-stay complement** (`endOfStayComplementAmount` / `endOfStayComplementPaid` /
  `endOfStayComplementPaidDate` / `endOfStayComplementPaidCash` / `endOfStayComplementDetail` JSON) — the
  « complément de fin de séjour » captured at the departure SAS (ménage non fait, linge manquant, extincteur).
  Booked as a flat « prestation complémentaire » (70600010).

Today **the arrival SAS never marks the arrival complement paid** (`commitArrivalSas` updates the amount +
items + caution + breakfast, but not `complementPaid`), and **the departure SAS ignores the arrival
complement entirely**. So when the operator forgets to do the arrival check-in (or does it but never collects
the complement), the arrival complement silently stays unpaid and is never recalled at departure.

## 2. Goal

1. Give the operator an explicit button in the **arrival SAS** to confirm the arrival complement was
   collected → marks it paid. (So a normally-collected complement is NOT recalled later.)
2. At the **departure SAS**, if the arrival complement is still unsettled, **recall it**: show it alongside
   the end-of-stay complement (the recap displays the **combined total to collect** with the **full
   arrival + departure detail**), and on validation **collect both** (mark both paid).
3. **Keep the two amounts separate in the DB** (decision: accounting-safe) so the tourist tax keeps its
   46710000 routing and the end-of-stay complement keeps its 70600010 line. The « addition » is the
   collected/displayed total, not a DB merge.

## 3. Functional rules

1. **Unsettled arrival complement = recall trigger.** The arrival complement is *unsettled* when
   `complementAmount > 0 AND complementPaid = 0`. This covers BOTH cases the operator described: the arrival
   SAS was never done (`arrivalSasDoneAt` null → complement never marked paid), and the SAS was done but the
   complement wasn't collected. (The single authoritative signal is `complementPaid = 0`; `arrivalSasDoneAt`
   is informational only.)
2. **Arrival SAS — settle button.** On the arrival SAS recap, when there is an arrival complement to collect
   (`complementAmount > 0` and not yet paid), show an explicit **« Complément encaissé »** confirmation
   (toggle/checkbox). When it is ON at « Valider et terminer », the commit marks
   `complementPaid = 1, complementPaidDate = today` (cash flag follows the same « caisse interne » choice as
   the fiche, default off). When OFF (or « Quitter »), the complement stays unpaid → eligible for recall.
3. **Departure SAS — recall display.** When the arrival complement is unsettled, the departure SAS recap
   recalls the arrival complement detail (its line items, see rule 6) and the recap's **« total à percevoir »**
   = `endOfStayComplementAmount + complementAmount`. **Display depends on whether an end-of-stay complement is
   also present (revised 2026-07-20):**
   - **With an end-of-stay complement** (`endOfStayComplementAmount > 0`) → the arrival lines are **merged
     plainly into the same « à percevoir » list** (normal colour, **no** « non perçus » warning header, no
     « sous-total arrivée » line). Rationale: the amount to collect at check-out often includes services taken
     during the stay, so flagging the arrival part as « non perçu » is misleading — it is just part of what is
     collected now. The total still includes it.
   - **Alone** (no end-of-stay complement) → keeps the dedicated **« Compléments d'arrivée non perçus »**
     section (warning colour + « sous-total arrivée »), since it then genuinely signals a *forgotten arrival
     collection*.
   The end-of-stay detail (ménage / linge / extincteur) is shown as today, unchanged.
4. **Departure SAS — collect both.** On the departure recap, a **« Compléments encaissés »** confirmation
   (shown when there is anything to collect) marks, at « Valider et terminer »:
   - `endOfStayComplementPaid = 1, endOfStayComplementPaidDate = today` when `endOfStayComplementAmount > 0`;
   - `complementPaid = 1, complementPaidDate = today` when the arrival complement was unsettled (the recall).
   Both follow the same cash-flag choice. The amounts are **never merged**: `complementAmount` and
   `endOfStayComplementAmount` keep their stored values + their separate accounting.
5. **No double counting / idempotence.** A re-opened/re-committed departure SAS (specs/reopen-completed-sas.md)
   must stay correct: marking an already-paid complement paid again is a no-op (dates kept via COALESCE);
   if the arrival complement was already settled (paid), it is NOT recalled. Un-checking « encaissés » on a
   re-open clears the marker + date (faithful reversible edit, same tri-state contract as the caution).
6. **Arrival complement detail for the recall.** The recalled detail = the arrival complement's itemisation:
   the `inComplement = 1` custom options (incl. SAS-added linen/cleaning), in-complement options/resources,
   and the tourist-tax line when it is in the complement. Any residual auto-gap (the part of `complementAmount`
   not covered by enumerated lines) is shown as a single « Complément d'arrivée » remainder line so the listed
   detail always sums to `complementAmount`. (Itemisation is display-only; the authoritative recalled amount
   is `complementAmount`.)

9bis. **Le SAS départ ne défait que ce qu'il a encaissé lui-même** (ajouté le 2026-08-31, depuis la
   production). Le complément de fin de séjour peut avoir été réglé **ailleurs** : depuis la v2.10.1,
   « Encaisser en une fois » le couvre ([single-payment-from-the-fiche.md](single-payment-from-the-fiche.md)
   règle 2bis), et la fiche sait aussi le marquer payé. Répondre « pas maintenant » sur le récap de
   départ ne peut donc plus effacer l'encaissement : la colonne
   `endOfStayComplementPaidAtDeparture` dit qui l'a encaissé, et seul le SAS départ peut défaire ce
   qu'il a fait. Miroir exact de `complementPaidAtArrival` côté arrivée
   ([single-payment-at-check-in.md](single-payment-at-check-in.md) règle 9) et de la même discipline
   que `resolveStayPayment` : « déjà encaissé avant le check-in : ce n'est pas à nous de le
   re-tamponner ».

   Le marqueur se pose sur la **transition**, pas sur l'état final : re-valider un départ sur un
   complément déjà réglé à la porte n'en rend pas le SAS propriétaire — sinon le passage suivant se
   croirait autorisé à le dé-payer et le bug reviendrait d'un cran plus loin. Il est effacé dès que la
   fiche bascule le drapeau, dans un sens comme dans l'autre.

   **Côté récap**, deux corrections indissociables du serveur, sans lesquelles l'opérateur est conduit
   à la faute :
   - le mode de règlement se reconstitue depuis les drapeaux stockés **à tous les passages**, plus
     seulement à la ré-édition. Enfermée dans un `if (editing)`, la reconstitution laissait le premier
     passage sans mode sélectionné — donc « Valider et terminer » envoyait « pas encaissé » ;
   - le récap dit « **Déjà encaissé le JJ/MM — rien à percevoir** », et le total s'intitule « Total fin
     de séjour » au lieu de « Total à percevoir ». Sans ça, l'opérateur réclame au client une somme
     déjà payée.

   **Constaté en production** sur la réservation 22281 (Harmen Van Dijk), et **rejoué à l'identique en
   dev** le 2026-08-31 avant correction : même ligne d'historique « Complément de fin de séjour
   encaissé : oui → non », groupe promettant 281,98 € dont une moitié redevenue due, et deux écritures
   en comptabilité au lieu d'une carte.

**Edge cases**
- Arrival complement already paid (normal flow) → no recall, departure SAS unchanged.
- Arrival complement = 0 → nothing to recall.
- End-of-stay complement = 0 but arrival unsettled → recap still shown, collects the recalled arrival only.
- Past-reservation edit lock: the SAS commit path already bypasses the fiche lock; the new paid flags ride
  the same commit, so no allowlist change is needed (the SAS is the authoritative collection moment).

## 4. Architecture

### 4.1 Server
| Layer | File | Responsibility |
|---|---|---|
| `controllers/sasController.js` | T | `getSas`: add an `arrivalComplement` block (amount, paid, detail lines) to the payload so the departure flow can recall it. `commitArrival`: pass through `complementSettled` (+ `complementPaidCash`). `commitDeparture`: pass through `complementsSettled` (+ cash). |
| `models/reservationsModel.js` | T | `commitArrivalSas`: when `complementSettled`, set `complementPaid = 1, complementPaidDate = today` (+ cash flag), COALESCE the date. `commitDepartureSas`: when `complementsSettled`, mark `endOfStayComplementPaid` (amount > 0) and, if the arrival complement is unsettled, `complementPaid` — both dated today; reversible un-check. New helper `buildArrivalComplementDetail(reservationId)` → the itemised lines + remainder (rule 6). |
| `utils/` (if extracted) | C | `buildArrivalComplementDetail` itemiser (in-complement options/resources/customs + tax + remainder). Unit-tested. |
| `tests/` | C | `commitArrivalSas` settle → paid; `commitDepartureSas` recall (unsettled → both paid, amounts separate; already-paid → not recalled; reversible); `buildArrivalComplementDetail` sums to `complementAmount`; payload exposes the recall. |

### 4.2 Client
| Layer | File | Responsibility |
|---|---|---|
| `components/sas/ReservationSasDialog.js` | T | Arrival recap: « Complément encaissé » toggle → `complementSettled` in the commit. Departure recap: « Compléments d'arrivée non perçus » section (from `payload.arrivalComplement`), combined « total à percevoir », « Compléments encaissés » toggle → `complementsSettled`. |
| `components/reservation/FinanceSection.js` | (likely none) | The arrival complement block already shows paid/date; once the checkout marks it paid the fiche reflects it. Verify no double display. |

No new generic component expected (the SAS dialog owns its step UI). Reuses the existing recap layout.

## 5. Data model

**No schema change** — all columns already exist (`complementPaid`, `complementPaidDate`, `complementPaidCash`,
`endOfStayComplementPaid`, `endOfStayComplementPaidDate`, `endOfStayComplementPaidCash`, `arrivalSasDoneAt`).
Behaviour-only. **Data impact:** none retroactive; a future departure SAS now settles an outstanding arrival
complement instead of leaving it unpaid.

## 6. Test plan
- [x] `commitArrivalSas({ complementSettled: true })` → `complementPaid = 1` + date; `false` clears; absent → unchanged (`sas-commit.unit.test.js`).
- [x] `commitDepartureSas({ complementsSettled: true })` on an unpaid arrival complement → BOTH `complementPaid` and `endOfStayComplementPaid` = 1 (dated today); the two amounts unchanged (separate, not merged).
- [x] Departure recall is skipped when the arrival complement is already paid (the original paid date is untouched).
- [x] `arrivalComplementDetailFromReservation` lines sum to `complementAmount` (incl. the remainder line).
- [x] Reversible: re-commit with `complementsSettled: false` clears the end-of-stay marker + date.
- [x] Client (`ReservationSasDialog.test.js`): departure recap recalls an unsettled arrival complement (detail + combined total) and sends `complementsSettled`; a paid one is NOT recalled; arrival payload carries `complementSettled`.
- [x] Full server (1793) + client (586) suites green.

### Règle 9bis — vérification de bout en bout (2026-08-31)

Tests serveur : `tests/departure-sas-keeps-the-payment.unit.test.js` (5) — un complément encaissé à la
porte survit à un départ validé sans mode de règlement, à sa date et sans changer de propriétaire ; le
SAS qui encaisse vraiment devient propriétaire et peut se dédire ; re-valider un départ sur un
complément réglé ailleurs n'en fait pas le propriétaire (sinon le bug revient au passage suivant) ; et
sans la colonne, le comportement d'avant la règle est conservé.

**Et surtout, le parcours réel rejoué dans le navigateur sur l'environnement de dev**, sur une
réservation montée à la forme exacte de la production (directe, acompte désactivé, aucun complément
d'arrivée, 50 € de complément de fin de séjour) :

| Étape | Avant correction | Après |
|---|---|---|
| « Encaisser en une fois » au 30/08 | groupe écrit ✅ | groupe écrit ✅ |
| **Enregistrer** la fiche | groupe **perdu**, solde redevenu dû | groupe intact (prouvé par une note écrite dans la même sauvegarde + sa ligne d'historique) |
| SAS départ, récap | « Total à percevoir : 50,00 € », aucun mode sélectionné | « Total fin de séjour : 50,00 € » + « Déjà encaissé le 30/08/2026 — rien à percevoir », CB / Chèque pré-sélectionné |
| **Valider et terminer** sans mode (le pire cas) | « Complément encaissé : oui → non », paiement détruit | paiement intact, marqueur resté à 0 |
| Comptabilité d'août | 2 écritures séparées | **1 carte « Paiement unique »** de 184,95 € contenant les deux journaux, équilibrés |

C'est ce déroulé complet — et non les suites unitaires, vertes à chaque itération précédente — qui a
mis au jour le second mécanisme (le SAS départ) après la correction du premier (l'enregistrement).

## 7. Out of scope
- Merging the two amounts into one DB field (rejected — breaks the tourist-tax 46710000 routing).
- Changing how either complement is computed or accounted (only the *payment marking* + the recall display).
- Recalling anything other than the arrival complement (e.g. unpaid acompte/solde) at checkout.

## 8. Open questions
- **Resolved (2026-06-23):** The departure « Compléments encaissés » marks paid **whatever has a positive
  amount** at validation — the end-of-stay complement (even with no recall) AND the recalled arrival
  complement. This moves the end-of-stay « marquer payé » to the SAS validation moment (was fiche-only); the
  fiche toggle stays available for manual correction.
