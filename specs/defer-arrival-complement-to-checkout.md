# Deferred complement — one single « complément de fin de séjour » at check-out

| Field | Value |
|---|---|
| **Status** | Implemented (Part C ajoutée et implémentée le 2026-08-22) |
| **Branch** | `fix/defer-arrival-complement-to-checkout` _(user-managed)_ |
| **Created** | 2026-08-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A reservation carries **two complement buckets** (specs
[cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md),
[recall-unpaid-arrival-complement-at-checkout.md](recall-unpaid-arrival-complement-at-checkout.md)):

- **arrival complement** — `complementAmount` / `complementPaid` / `complementPaidCash`. Fed by the
  in-complement extras, the tourist tax when routed there, and the lines the **arrival SAS** adds
  (`reservation_custom_options`, `inComplement = 1`, `sasArrivalOrigin = 1`);
- **end-of-stay complement** — `endOfStayComplementAmount` / `endOfStayComplementDetail` (JSON lines).
  Written by the **departure SAS** (ménage non fait, linge manquant, extincteur).

Since [sas-bath-linen-upsell.md](sas-bath-linen-upsell.md) §3.2 (PR #366, 2026-08-02), choosing
**« En fin de séjour »** on the arrival recap no longer moves anything: it leaves the **arrival**
complement unpaid, and the departure SAS *recalls* it and collects both together
([recall-unpaid-arrival-complement-at-checkout.md](recall-unpaid-arrival-complement-at-checkout.md)).

**Two problems surfaced on a real stay (2026-08-03):**

1. **The cleaning was billed twice.** The guest had a « Ménage » line on the reservation, and the
   **departure SAS still asks « le ménage de fin de séjour a-t-il été fait correctement ? »**. Answering
   « Non » writes a second « Ménage de fin de séjour » line into the end-of-stay complement — while the
   cleaning is already paid for on the arrival side. The arrival SAS hides its own ménage page when
   `cleaning.included` ([sas-hide-settled-steps.md](sas-hide-settled-steps.md) §3 rule 3) but the
   **departure page was explicitly left ungated** (same spec, §3 rule 5). Both amounts are summed by the
   finance layer ([financeModel.js:86](../server/src/models/financeModel.js#L86)) → the guest is
   over-charged and « Reste à payer » is wrong.
2. **The fiche shows two complements for one single collection.** Bath linen taken at check-in and
   deferred stays in « Complément à percevoir »; the ménage billed at check-out sits in « Complément de
   fin de séjour ». The operator collects **one** amount at the door but reads **two blocks** on the
   fiche, which looks like a double count even when it isn't.

## 2. Goal

1. Never bill the end-of-stay cleaning when the cleaning is already sold on the reservation.
2. When the operator chooses **« En fin de séjour »** on the arrival recap, everything to collect —
   arrival complement *and* end-of-stay complement, tourist tax included — is presented as **one single
   « Complément de fin de séjour »**, with one detail list, one total, and one « payé » action.

## 3. Functional rules

### 3.1 Part A — the cleaning is never billed twice

1. **Departure ménage page gated on `cleaning.included`.** When the reservation already carries the
   cleaning — a booked cleaning option, a « Ménage » line added by the arrival SAS, or a property
   default, i.e. exactly the existing `cleaning.included` flag computed by
   [`sasController.getSas`](../server/src/controllers/sasController.js#L38) via
   [`isCleaningOption`](../server/src/utils/cleaningOption.js) — the **departure** `cleaning` page is
   **dropped from the departure key list**, exactly like the arrival one. The guest is not responsible
   for a cleaning the host was paid to do, so there is nothing to check and nothing to bill.
   **This revises [sas-hide-settled-steps.md](sas-hide-settled-steps.md) §3 rule 5** (which kept the
   departure page unconditionally).
2. **Recap reminder instead.** When the departure ménage page is hidden, the **departure recap** shows
   a secondary line « Ménage déjà réglé — aucune facturation de fin de séjour. » (mirrors the arrival
   recap's « Ménage inclus » reminder).
3. **Authoritative server guard.** `commitDepartureSas` **drops any « Ménage de fin de séjour » line**
   from the submitted `endOfStayComplementDetail` when the reservation carries the cleaning (same
   `isCleaningOption` / property-default rule), and recomputes `endOfStayComplementAmount` from what is
   left. A stale client, a re-play, or a hand-crafted payload can never re-create the double charge.
4. **Self-healing on re-run.** Re-running the departure SAS on an affected reservation removes the
   duplicate line (rule 3) and recomputes the amount → **no data migration is needed**; the operator
   just re-opens the departure SAS on the affected stay.

### 3.2 Part B — « En fin de séjour » ⇒ one single complement

5. **Explicit deferral marker.** New column `reservations.complementDeferredToCheckout` (0/1).
   `commitArrivalSas` sets it from the recap payment mode
   ([sas-recap-payment-buttons.md](sas-recap-payment-buttons.md)):
   - **« En fin de séjour »** (`complementSettled === false`) → `1`;
   - **CB/Chèque** or **Payé en liquide** (`complementSettled === true`) → `0`;
   - `complementSettled === undefined` (recap not reached) → unchanged.
   Re-running the arrival SAS and settling on the spot clears the marker (fully reversible).
6. **One presented complement.** When `complementDeferredToCheckout = 1`, every operator-facing view
   presents **a single « Complément de fin de séjour »** whose amount is
   `complementAmount + endOfStayComplementAmount` and whose detail is the concatenation of
   the arrival complement detail (`buildArrivalComplementDetail`, incl. the tourist-tax line) and the
   end-of-stay detail lines. The separate « Complément à percevoir » block **disappears** from the
   fiche in that state.
7. **Server builds the merged block.** The reservation payload gains a server-computed
   `checkoutComplement: { deferred, amount, arrivalAmount, endOfStayAmount, paid, paidCash, paidDate,
   lines: [{ label, qty, unitPrice, amount, origin: 'arrival' | 'endOfStay' }] }`. The client renders it
   as-is — no client-side merge, no client-side sum (CLAUDE.md §6.0).
8. **One « payé » action.** In the merged state, marking the complement paid (or « Caisse interne »)
   from the fiche marks **both** buckets — `complementPaid` + `endOfStayComplementPaid` (and the two
   `*PaidCash` flags) — with the same date. Un-marking clears both. This mirrors what the departure SAS
   « Compléments encaissés » already does
   ([recall-unpaid-arrival-complement-at-checkout.md](recall-unpaid-arrival-complement-at-checkout.md)
   §3 rule 4).
9. **The DB split and the accounting stay untouched.** `complementAmount` and
   `endOfStayComplementAmount` remain two separate columns: the pricing engine recomputes
   `complementAmount` on every fiche save ([reservationsModel.js:959](../server/src/models/reservationsModel.js#L959)),
   so a literal row move would be undone at the next save — and, more importantly, the **tourist tax
   must keep its 46710000 routing** (a debt to the commune, not revenue) and the SAS extras their
   70600010 line. **The merge is a presentation + collection contract, not a data move**: the operator
   sees and collects one amount; the accountant still gets each part on its own account, at the
   check-out collection date. No change to `accountingModel`.
10. **Financial tracking unchanged in value, aligned in wording.** `totalSejour`, `remainingToPay`,
    `isSettled`, `comptaCollected` already sum both buckets — no arithmetic change. Outside the fiche,
    the merge is a **relabel, not a row move** (decided at implementation, 2026-08-03): the Suivi
    opérationnel keeps its two rows / two checkboxes — moving an amount between rows would desync the
    per-bucket toggles — but a deferred complement's row reads **« Complément (fin de séjour) »**.
    Same for the planning/dashboard card chip and the fiche's summary line
    (« dont complément perçu en fin de séjour »). No line claims money is collected at check-in when it
    is collected at the door.
11. **Departure SAS unchanged.** It already recalls an unpaid arrival complement, shows the combined
    total, and settles both. With the marker set, its recap wording is the same — the fiche now simply
    agrees with it.

**Edge cases:**
- `complementAmount = 0` and « En fin de séjour » chosen → marker set to 1, but nothing to merge; the
  fiche shows only the end-of-stay complement (or nothing). No empty block.
- Arrival complement already paid (`complementPaid = 1`) → the marker is 0; the fiche keeps the two
  distinct blocks (« Complément à percevoir » shown as paid + « Complément de fin de séjour »), because
  the two collections really happened at two different moments.
- Deferred marker set but the departure SAS never runs → the fiche keeps showing one unpaid merged
  complement; « Reste à payer » unchanged in value.
- Arrival SAS never run at all (no marker) → unchanged behaviour, two blocks, the departure recall still
  applies.
- Cleaning included **and** a legacy « Ménage de fin de séjour » line already stored → dropped on the
  next departure commit (rule 3-4); the amount is recomputed downwards.
- Cleaning NOT included → the departure ménage page and its billing are unchanged.

---

### 3.3 Part C — la fiche décide aussi (2026-08-22)

Le marqueur n'a aujourd'hui qu'un seul point d'écriture : le récap du SAS arrivée
([reservationsModel.js:2148](../server/src/models/reservationsModel.js#L2148)). La fiche le **lit**
([ReservationPage.jsx:795](../client/src/pages/ReservationPage.jsx#L795)) sans jamais pouvoir l'écrire.
Le trou est donc précis : **avant le check-in, l'opérateur ne peut rien décider depuis la fiche** —
alors que c'est là qu'il prépare le séjour et qu'il annonce le montant au client.

12. **La fiche porte l'interrupteur.** Sur la carte « Complément d'arrivée », un interrupteur
    **« Percevoir en fin de séjour »** écrit le même `complementDeferredToCheckout` que le récap du SAS
    arrivée. Même colonne, même contrat de fusion : les règles 6 à 11 s'appliquent telles quelles.
13. **Bidirectionnel.** Le remettre à « arrivée » repasse le marqueur à 0 et la fiche ré-affiche les
    deux cartes. Fiche et SAS écrivent la même colonne : **le dernier geste gagne**, et le SAS reste
    souverain au check-in (encaisser sur place efface le marqueur, règle 5).
14. **Effet immédiat**, comme les boutons « payé » / « caisse interne » voisins : `PATCH /payment`,
    sans attendre l'enregistrement de la fiche. En création de réservation et sur un devis (pas
    d'`id`), le contrôle est masqué — il n'y a pas encore de séjour à reporter.
15. **Disponible à tout moment** (révisé le 2026-08-22, après essai en production). Il ne se verrouille
    pas au début du séjour et ne disparaît pas une fois le complément encaissé : un encaissement se
    corrige, et regrouper la collecte au départ est précisément la correction qu'on veut pouvoir
    faire. Deux conséquences :
    - reporter un complément **marqué encaissé** le remet à percevoir — donc on le **confirme** avant
      (« Il est marqué encaissé. Le reporter le remet à percevoir, avec le complément de fin de
      séjour, en une seule collecte. ») ;
    - le contrôle ne s'efface que lorsqu'il n'y a matériellement rien à déplacer : pas de réservation
      enregistrée, ou pas de complément d'arrivée.

    La version précédente affichait l'interrupteur **coché et grisé** dès le jour d'arrivée, au motif
    qu'un complément non encaissé se perçoit de toute façon à la porte. C'était vrai et inutilisable :
    l'opérateur ne pouvait plus rien décider au moment où il en avait justement besoin.
16. **Le marqueur EST le split.** `splitComplementBuckets` ne regarde plus que lui (et l'encaissement,
    qui l'emporte) : `arrival = 0` dès que `complementDeferredToCheckout = 1` et que le complément
    n'est pas encaissé. La déduction par le calendrier est retirée du split
    ([complement-buckets-by-moment.md](complement-buckets-by-moment.md) règle 4 révisée), si bien que
    la carte de la fiche, le panneau de droite et le marqueur disent tous la même chose, décidée au
    même endroit. L'invariant « la somme ne bouge jamais » est préservé.
16ter. **Les boutons d'encaissement de la carte écrivent tous immédiatement.** « Marquer complément
    payé » n'appelait le serveur que sur une réservation **verrouillée** ; ailleurs il ne changeait que
    le formulaire, en attendant un « Enregistrer » — alors que ses voisins (« Caisse interne », le
    bouton de la carte de fin de séjour, le report lui-même) écrivaient tout de suite. Le formulaire
    et la base divergeaient donc, et c'est la base qui décide de la fusion : **dé-marquer un
    encaissement puis reporter ne fusionnait rien** (constaté par Adrien le 2026-08-22, et c'est aussi
    l'explication de l'écran « impossible » de sa première capture — contrôle visible côté formulaire,
    deux cartes côté serveur). Le rechargement financier relit désormais l'état d'encaissement, pour
    que les deux ne puissent plus se contredire.
16bis. **Le contrôle est un bouton, pas un interrupteur.** Un `Switch` MUI glissé entre le champ de
    montant et les boutons de paiement est passé inaperçu de l'opérateur — le retour du 2026-08-22 est
    littéralement « il n'y a pas de bouton percevoir en fin de séjour », alors qu'il était à l'écran.
    Il prend donc la même forme que ses voisins : bouton pleine largeur, bordé quand inactif, plein
    quand actif (« Perçu en fin de séjour ✓ »).
17. **Les emails suivent.** `emailContextBuilder` écrit aujourd'hui « à régler directement sur place à
    **votre arrivée** » sans regarder le marqueur
    ([emailContextBuilder.js:286](../server/src/utils/emailContextBuilder.js#L286)). Sur une
    réservation reportée, le J-2 et le J-1 disent « **à votre départ** » — même liste de prestations,
    même total, seul le moment change ; en anglais « on departure ». Les tokens de template ne bougent
    pas (`{{complementNotice}}`, `{{#if complementToCollect}}`), donc aucun template à ré-éditer.
18. **Aucun montant comptable ne bouge.** Exigence Adrien du 2026-08-22, et c'est déjà la promesse de
    la règle 9 : le report est un **marqueur de collecte**, pas un déplacement d'argent. Les deux
    colonnes restent séparées, la taxe de séjour garde son `46710000`, les prestations leur
    `70600010` / `70601000`, et l'écriture porte la date d'encaissement réelle. **La comptabilité d'une
    réservation reportée est strictement identique à celle de la même réservation non reportée**, au
    jour d'encaissement près. C'est ce qui disqualifie l'autre modèle envisagé — déplacer réellement
    les lignes dans `endOfStayComplementDetail` re-bookerait la taxe de séjour en produit `70600010` au
    taux de TVA général.
19. **Traçabilité.** Le basculement depuis la fiche est écrit dans `reservation_history`
    (« Complément reporté en fin de séjour » / « Complément perçu à l'arrivée ») — c'est une décision
    d'argent, elle doit se relire. Le libellé existe déjà côté SAS
    ([sasAudit.js:25](../server/src/utils/sasAudit.js#L25)).
20. **Réservation annulée ou passée verrouillée** : interrupteur en lecture seule, mêmes gardes que le
    reste de la carte.

**Edge cases (Part C) :**

- Complément d'arrivée **déjà encaissé** → contrôle affiché quand même ; l'activer le remet à
  percevoir, après confirmation (règle 15).
- Complément d'arrivée à **0 €** → pas de carte, donc pas de contrôle.
- Report posé sur la fiche, puis SAS arrivée encaissé en CB → le marqueur retombe à 0 (règle 5) :
  l'argent a bien été perçu à l'arrivée, l'événement le plus récent gagne.
- Report posé, puis le complément grossit (option ajoutée) → rien de spécial, la carte fusionnée
  affiche le nouveau total ; le marqueur est indépendant du montant.
- Report posé, puis la réservation est annulée → lecture seule, le marqueur reste tel quel.
- Séjour déjà commencé, complément impayé, aucun marqueur → il reste sous « arrivée » et le contrôle
  est là pour le déplacer. C'est le changement de la règle 16 : plus rien ne bouge tout seul.

---

## 4. Architecture

> **Fat backend, thin frontend.** The deferral marker, the merged block (amount + detail lines + paid
> state), and the anti-double-billing guard are all resolved server-side. The client renders
> `checkoutComplement` and sends the operator's clicks — no merge, no sum, no rule in React.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `routes/reservations.js` | T | No new endpoint; the merged block rides the existing reservation payload. `markPayment` accepts the merged paid action (rule 8). |
| `controllers/` | `controllers/sasController.js` | T | `getSas` (departure) already returns `cleaning.included` — no change; `commitDeparture` forwards to the guarded model. |
| `controllers/` | `controllers/reservationsController.js` | T | `markPayment`: when the reservation is deferred (`complementDeferredToCheckout = 1`), a complement paid/cash toggle marks **both** buckets (rule 8). |
| `models/` | `models/reservationsModel.js` | T | `commitArrivalSas`: write `complementDeferredToCheckout` from `complementSettled` (rule 5). `commitDepartureSas`: drop « Ménage de fin de séjour » when the cleaning is already sold (rule 3). `getByIdWithDetails` + list payloads: expose `complementDeferredToCheckout` and the computed `checkoutComplement` block (rule 7). |
| `models/` | `models/financeModel.js` | — | No arithmetic change (rule 10); already sums both buckets. |
| `models/` | `models/accountingModel.js` | — | **Untouched** (rule 9) — each bucket keeps its account. |
| `utils/` | `utils/checkoutComplement.js` | C | Pure builder: `buildCheckoutComplement(reservation, arrivalDetailLines, endOfStayDetailLines)` → the merged block (amount, lines with `origin`, paid state). Unit-tested. |
| `utils/` | `utils/cleaningOption.js` | REUSE | Single source of truth for « is the cleaning already sold? » — reused by the departure guard. |
| `utils/` | `utils/receptionView.js` | T | Pass the marker through so the reception view labels the complement correctly. |
| `controllers/` | `controllers/reservationsController.js` | T | **Part C** — `markPayment` accepts `complementDeferredToCheckout` (boolean) and writes it through the model, with the cancelled / locked guards and a `reservation_history` entry (rules 12-14, 19-20). |
| `utils/` | `utils/complementBuckets.js` | T | **Part C** — `splitComplementBuckets` gains a `deferred` input: `arrival = 0` when the marker is on and the complement is unpaid, whatever `stayStarted` says (rule 16). |
| `utils/` | `utils/pricing.js` | T | **Part C** — passes the marker to `splitComplementBuckets` (it already resolves `stayStarted` and `complementPaid`). |
| `utils/` | `utils/emailContextBuilder.js` | T | **Part C** — the complement notice reads « à votre départ » / « on departure » when the marker is on; wording only, same lines, same total (rule 17). |
| `utils/` | `utils/reservationAudit.js` | T | **Part C** — history label for the fiche-side toggle (rule 19). |
| `database.js` | `database.js` | T | Idempotent migration: `complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0` + one-shot backfill (see §5). |
| `tests/` | `tests/sas-commit.unit.test.js`, `tests/checkout-complement.unit.test.js` (C) | T/C | Rules 1-8 (see §7). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/sas/ReservationSasDialog.js` | T | Departure `activeKeys`: drop `cleaning` when `data.cleaning.included` (rule 1); departure recap reminder line (rule 2). No change to the recall logic. |
| `components/` | `components/reservation/FinanceSection.js` | T | Render `checkoutComplement` when `deferred`: single « Complément de fin de séjour » card (detail lines + total), hide the « Complément à percevoir » card; the paid / caisse-interne buttons post the merged action (rule 8). The three complement cards (arrival / end-of-stay / merged) now share one local `ComplementCard` renderer so they can't drift apart. |
| `components/` | `components/PricingSummary.js` | T | Deferred → the « dont complément à percevoir sur place » line reads « dont complément perçu en fin de séjour » (value unchanged). |
| `components/` | `components/OperationalPaymentsTable.js` | T | Deferred → the « Complément » row is relabelled « Complément (fin de séjour) » (rule 10; amounts and checkboxes unchanged). |
| `components/` | `components/ReservationCard.js` | T | Deferred → the chip reads « Complément (fin de séjour) ». |
| `pages/` | `pages/ReservationPage.js` | T | Carry `complementDeferredToCheckout` + `checkoutComplement` in the form state so the fiche re-renders after a SAS commit. |
| `components/` | `components/reservation/FinanceSection.jsx` | T | **Part C** — « Percevoir en fin de séjour » switch on the arrival complement card: posts `markPayment`, flips the local form flag, reloads the finance block so the merged card appears at once. Hidden without an `id` / with a settled or empty complement; shown ON and disabled once the stay started (rules 12-15). |
| `services/` | `services/api.js` | T | **Part C** — `markPayment` payload gains `complementDeferredToCheckout`. Otherwise unchanged. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `DateField`, MUI `Box`/`Grid`/`Button`/`Typography` | Reused as-is. |
| **Created (new generic)** | — | None. The merged card is a variant of the existing end-of-stay block in `FinanceSection`. |
| **Specific (kept feature-local)** | The merged complement card inside `FinanceSection.js` | Bound to reservation finance semantics; not reusable elsewhere. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id` | — | adds `complementDeferredToCheckout` + `checkoutComplement: { deferred, amount, arrivalAmount, endOfStayAmount, paid, paidCash, paidDate, lines[] }` | Server-computed; client renders as-is. |
| POST | `/api/reservations/:id/sas/arrival` | `complementSettled` (existing) | `{ ok, complementAmount }` | `false` now also sets the deferral marker. |
| POST | `/api/reservations/:id/sas/departure` | `endOfStayComplementDetail` (existing) | `{ ok }` | Server drops a « Ménage de fin de séjour » line when the cleaning is already sold. |
| PATCH | `/api/reservations/:id/payment` | `{ complementPaid, complementPaidDate }` / `{ complementPaidCash }` | `{ ok }` | When the marker is set, marks both buckets (rule 8). |
| PATCH | `/api/reservations/:id/payment` | `{ complementDeferredToCheckout: boolean }` | `{ ok }` | **Part C** — sets/clears the marker from the fiche (rules 12-14). 409 on a cancelled or locked reservation, like the other payment actions. |

---

## 5. Data model

**One new column**, idempotent migration in `server/src/database.js`:

```sql
ALTER TABLE reservations ADD COLUMN complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0;
```

**Backfill (one-shot, guarded by the column-creation branch):** set to `1` for reservations whose
arrival SAS ran, whose arrival complement is positive and still unpaid — i.e. exactly the population the
departure recall already treats as deferred:

```sql
UPDATE reservations
   SET complementDeferredToCheckout = 1
 WHERE arrivalSasDoneAt IS NOT NULL
   AND COALESCE(complementAmount, 0) > 0
   AND COALESCE(complementPaid, 0) = 0;
```

**Data impact:** display/collection only — no amount is moved, recomputed, or lost. `complementAmount`,
`endOfStayComplementAmount` and every accounting entry keep their current values. The Part A guard can
only *lower* an end-of-stay amount, and only when the operator re-runs the departure SAS on a
double-billed stay.

## 6. UI / UX

**Fiche réservation — Suivi financier (deferred state):**

```
┌──────────────────────────────────────────────┐
│ Complément de fin de séjour        (78,00 €) │   ← red border while unpaid
│   Linge de toilette : 4 × 8,00 = 32,00 €     │   ← origin: arrival
│   Taxe de séjour : 6,00 €                    │   ← origin: arrival
│   Ménage de fin de séjour : 40,00 €          │   ← origin: endOfStay
│   [ Marquer complément payé ]                │   ← marks BOTH buckets
│   [ Caisse interne ]                         │
└──────────────────────────────────────────────┘
```
The « Complément à percevoir » card is not rendered in this state. Non-deferred reservations keep
today's two-card layout untouched.

**SAS de départ:** the « Ménage de fin de séjour » page disappears when the cleaning is already sold;
the recap gains « Ménage déjà réglé — aucune facturation de fin de séjour. » in `text.secondary`.

**Copy (French):**
- Card title: « Complément de fin de séjour » (unchanged).
- Sub-line when lines come from the check-in: no special marker — the operator collects one amount.
- Recap reminder: « Ménage déjà réglé — aucune facturation de fin de séjour. »
- Operational table row: « Complément (fin de séjour) ».

**Responsive:** the merged card reuses the existing `Grid size={{ xs: 12, md: 6 }}` block — full width on
`xs`, half on `md+`; detail lines wrap, no horizontal scroll. The SAS dialog is already fullscreen on
mobile and simply loses one page. Verified at `xs` / `md` / `lg`.

**Sticky action bar:** no page-level action added; `ReservationPage` keeps its existing `PageActionBar`.

### Part C — l'interrupteur sur la fiche

Il vit **dans** la carte « Complément d'arrivée », sous les lignes de détail et au-dessus de
« Marquer complément payé » — le même bloc que la date de paiement et « Caisse interne », donc au même
endroit que les autres décisions d'encaissement.

```
┌─ Complément d'arrivée  (93,60 €) ───────────────┐
│  Linge de toilette : 24,00 €                    │
│  Bain nordique     : 60,00 €                    │
│  Taxe de séjour    :  9,60 €                    │
│                                                 │
│  Montant ajusté (€)  [              ]           │
│  Calcul auto (93,60 €)                          │
│                                                 │
│  [ Percevoir en fin de séjour               ]   │
│  [ Marquer complément payé                  ]   │
│  [ Caisse interne                           ]   │
└─────────────────────────────────────────────────┘
```

Trois boutons pleine largeur qui se lisent d'un coup d'œil, dans l'ordre des décisions : *où* on
encaisse, *si* c'est encaissé, *comment*. Une fois le report actif, le bouton devient plein et lit
« Perçu en fin de séjour ✓ ».

Une fois basculé, les deux cartes fusionnent en une seule « Complément de fin de séjour » (règle 6) et
l'interrupteur réapparaît **dedans**, en position active, pour pouvoir revenir en arrière.

Copie française :
- Bouton inactif : **« Percevoir en fin de séjour »**, infobulle **« Regrouper ce complément avec
  celui de fin de séjour : une seule ligne, un seul encaissement. »**
- Bouton actif : **« Perçu en fin de séjour ✓ »**, infobulle **« Le complément d'arrivée est encaissé
  au départ, avec le complément de fin de séjour — une seule collecte. »**
- Confirmation sur un complément encaissé : titre **« Reporter ce complément au départ ? »**, corps
  **« Il est marqué encaissé. Le reporter le remet à percevoir, avec le complément de fin de séjour,
  en une seule collecte. »**

Responsive : un bouton pleine largeur dans la carte, qui suit la colonne (`xs: 12` / `md: 6`) — rien
de spécifique à `xs`. Cible tactile ≥ 44 px de haut.

## 7. Test plan

### Server unit tests (`sas-commit.unit.test.js`, `checkout-complement.unit.test.js`)
- [x] `commitDepartureSas` drops « Ménage de fin de séjour » when a cleaning option is on the reservation
      (tag OR name « ménage ») or the property offers it by default; keeps it otherwise (rule 3).
- [x] Re-running the departure commit on a double-billed reservation lowers `endOfStayComplementAmount`
      by the cleaning price and leaves the other lines intact (rule 4).
- [x] `isCleaningSoldForReservation`: booked option, custom « Ménage » line, else false (rule 1).
- [x] `commitArrivalSas` sets `complementDeferredToCheckout = 1` on « En fin de séjour », `0` when
      settled, unchanged when `complementSettled` is `undefined` (rule 5).
- [x] `buildCheckoutComplement` — amount = arrival + end-of-stay, lines concatenated in order with the
      right `origin`, tourist-tax line present, `deferred = false` when the marker is 0 or the arrival
      part is already paid, `paid` only when both buckets are settled, broken JSON tolerated (rules 6-7).
- [x] `updatePayment` on a deferred reservation (`reservations-controller-payment-cash.unit.test.js`):
      marking paid / « caisse interne » settles **both** buckets with the same date, un-marking reverts
      both, a zero end-of-stay bucket is left alone, a NON-deferred reservation keeps the two toggles
      independent, and an explicit `endOfStayComplementPaid` in the same payload wins over the mirror
      (rule 8).
- [x] Full server suite green (2157), incl. the untouched accounting + finance arithmetic (rules 9-10).

### Client tests (vitest)
- [x] `ReservationSasDialog` departure: no `cleaning` page when `cleaning.included`; recap shows the
      reminder; the commit payload carries no « Ménage de fin de séjour » line; a re-open drops a
      previously stored cleaning line.
- [x] `FinanceSection.deferred-complement.test.js`: deferred → one merged card with all lines + combined
      total, no « Complément à percevoir » card; paid / caisse-interne settle both buckets;
      non-deferred → today's two cards.
- [x] Full client suite green (715) + Playwright E2E (32).

### Manual UI verification (dev, 2026-08-03)
- [x] Deferred reservation (arrival complement 64 € + end-of-stay 40 €) → **one** « Complément de fin de
      séjour (104,00 €) » card listing the arrival lines and the end-of-stay line; no « Complément à
      percevoir » card.
- [x] « Marquer complément payé » on the merged card → `complementPaid` **and** `endOfStayComplementPaid`
      set to 1 with the same date in the DB (single click, single collection).
- [x] Bug case: reservation carrying a « Ménage » line → departure SAS goes from 7 to 6 steps, no ménage
      page, recap reads « Ménage déjà réglé — aucune facturation de fin de séjour. », nothing billed.
- [x] Edge case: once the arrival complement is paid, the two distinct cards come back (unchanged flow).
- [x] Responsive: `xs` 390px (full-width card, no horizontal scroll) and `lg` 1280px OK. At `md` 900px the
      page does scroll horizontally — **pre-existing**, caused by the « Résumé tarifaire » side panel
      (reproduced identically on an untouched reservation), not by this change.

### Part C

**Server unit tests**
- [x] `complementBuckets` : marqueur ON + complément impayé + séjour **non commencé** → `arrival = 0`,
      `endOfStay = arrivée + fin de séjour` ; la somme des trois buckets ne change pas (rule 16).
- [x] `complementBuckets` : marqueur ON mais complément **encaissé** → `arrival` reprend le montant
      (rule 2 de complement-buckets-by-moment, non-régression).
- [x] `markPayment` : `complementDeferredToCheckout: true/false` écrit la colonne, trace l'historique,
      et n'écrit rien quand la valeur ne change pas (rules 12-14, 19). Le refus sur réservation annulée
      vient du `cancelledGuard` existant du PATCH, couvert par ses propres tests.
- [x] `emailContextBuilder` : marqueur ON → « à votre départ » / « on departure », mêmes lignes, même
      total ; marqueur OFF → texte actuel mot pour mot (rule 17).
- [x] Comptabilité : la même réservation, reportée ou non, produit **les mêmes écritures** au même
      montant (rule 18).

**Client tests (vitest)**
- [x] Le contrôle est masqué sans `id` et sur un complément à 0 € ; il reste affiché sur un complément
      encaissé (rule 15).
- [x] Séjour commencé → toujours actif et modifiable (rule 15 révisée).
- [x] Reporter un complément encaissé demande confirmation, puis envoie le marqueur ET la remise à
      percevoir dans le même PATCH (rule 15).
- [x] Le basculer appelle `markPayment` puis fait apparaître la carte fusionnée (rules 12-14).

**Manual UI verification**
- [x] Réservation à venir avec complément d'arrivée : basculer depuis la fiche → une seule carte
      « Complément de fin de séjour », panneau de droite d'accord avec elle (rule 16).
- [x] Rebasculer → les deux cartes reviennent.
- [x] Aperçu du J-2 sur cette réservation : le texte annonce le départ (rule 17).
- [ ] Réception + planning : plus d'alerte à l'arrivée, alerte au départ. **Non rejoué à la main** —
      il faudrait une arrivée du jour ; `buildOperationalCollection` n'est pas modifié par cette part
      et garde ses tests (`operational-collection.unit.test.js`).
- [x] Séquence de correction complète : complément d'arrivée encaissé + une option déjà partie en fin
      de séjour → dé-marquer l'encaissement → « Percevoir en fin de séjour » → **une seule carte à
      34,30 €** (2,16 d'arrivée + 30 de fin de séjour), détail sans doublon (règle 16ter).
- [x] Sur la réservation qui a motivé la révision (compl. d'arrivée encaissé 153,05 € + bain nordique
      30 €) : le bouton est visible, le report demande confirmation, la fiche tombe à **une seule
      carte à 187,01 €** listant toutes les lignes, le montant s'ajuste à 150 € et l'aller-retour
      rétablit les deux cartes.
- [x] Mobile `xs` (390 px) : la carte et son interrupteur tiennent, aucun scroll horizontal.

## 8. Out of scope

- **Part C** — ajuster le *montant* d'un complément : c'est
  [adjustable-complement-amounts.md](adjustable-complement-amounts.md). Cette spec-ci ne déplace que le
  *moment* de la collecte.

- Merging the two columns in the DB, or changing the accounting routing of either bucket (rule 9).
- Recalling anything other than the arrival complement at check-out (acompte / solde impayés).
- Reworking the departure SAS page order beyond dropping the ménage page.
- Retroactive correction of already-collected double-billed stays (rule 4 covers it by re-running the
  departure SAS; no data migration).

## 9. Open questions

- **Resolved (2026-08-03):** « Tout basculer, taxe comprise » — the operator sees and collects a single
  end-of-stay complement including the tourist tax. Implemented as a **presentation + collection**
  merge (rule 9), not a row move, so the tourist tax keeps its 46710000 account and the pricing engine
  keeps recomputing `complementAmount` normally.
- **Resolved (2026-08-03):** the departure ménage page is **hidden**, not merely non-billable — there is
  nothing for the operator to assess when the host is paid to do the cleaning.
