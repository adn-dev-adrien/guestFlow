# The single arrival payment, detailed and adjustable

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/arrival-payment-detail-and-adjustment` |
| **Created** | 2026-08-31 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Two specs built the single arrival payment:

- [single-payment-at-check-in.md](single-payment-at-check-in.md) (v2.9.0) — the SAS collects the stay
  and the arrival complement in one gesture and records the **group**;
- [single-payment-from-the-fiche.md](single-payment-from-the-fiche.md) (v2.10.x) — the same payment
  can be recorded from the fiche, at the operator's date, and the **end-of-stay complement** joined
  the groupable buckets (rule 2bis).

The block that carries it on the fiche
([FinanceSection.jsx:594-666](../client/src/components/reservation/FinanceSection.jsx#L594-L666))
reads, once a group exists:

> Encaissé à l'arrivée : paiement unique de 852,82 € le 30/08 — CB / Chèque
> *solde 720,82 € · complément 132,00 €*

Two things are missing from it.

**1. It names buckets, not prestations.** « solde » and « complément » answer *which column stores
this money*. The operator — and the guest asking « c'est quoi les 852 € ? » — wants *what did he pay
for*: the nights, le linge, le ménage, le repas des trappeurs, la taxe de séjour. The SAS renders
exactly that list at the end of the check-in
([ReservationSasDialog.jsx](../client/src/components/sas/ReservationSasDialog.jsx)), from
`arrivalComplementDetailFromReservation`
([reservationsModel.js:129](../server/src/models/reservationsModel.js#L129)). The fiche shows none of
it: the arrival complement is the only one of the three cards built without its `lines`.

**2. There is no way to say « il a payé 800, pas 852,82 ».** A price settled at the door — a guest who
arrives at 23 h, a night that went wrong, a regular one rewards, a rounded amount — has no home:

| Existing lever | Why it doesn't answer this |
|---|---|
| « Prix hébergement ajusté » (`customPrice`) | Rewrites the accommodation price silently. No line says a reduction was granted, and none of it reaches the Comptabilité. |
| `discountPercent` | A rate on the tariff — a grid decision taken before the stay, not a gesture at the door. |
| Ajustement de complément ([adjustable-complement-amounts.md](adjustable-complement-amounts.md)) | Corrects an **announced amount** and absorbs the écart with no compensating line (rule 5). It deliberately refuses the accommodation first (§3.6 rule 32). |
| « Offrir » une ligne ([sas-offer-complement-lines.md](sas-offer-complement-lines.md)) | All-or-nothing on one prestation, and only on the lines the SAS knows. |
| Un remboursement ([reservation-refunds.md](reservation-refunds.md)) | Money that actually left the bank, with a date and a means. Nothing left the bank here: it was never collected. |

So the operator either types a `customPrice` nobody can trace, or collects the full amount and hands
cash back off the books.

## 2. Goal

On the reservation fiche, the single payment made at check-in shows **what the guest paid for**, line
by line, with its total — and the operator can set **what was really handed over**. Less than the
computed total records a **« Réduction accordée »** on the accommodation; more records a
**« Pourboire »**. Both are visible in the Comptabilité, on the card of the payment they belong to.

---

## 3. Functional rules

### 3.1 The detail on the fiche

1. When a group exists, the block renders a **detail** in place of today's bucket caption: one line
   per prestation the payment covered, then the total. The header line is unchanged (date, means,
   caisse interne), and « Annuler ce paiement »
   ([single-payment-from-the-fiche.md](single-payment-from-the-fiche.md) rule 10) stays where it is.
2. **The lines, in this order:**
   1. **Hébergement — N nuits**, the accommodation share of the stay buckets the payment settled;
   2. the **options and ressources billed with the stay** (the pre-arrival lines), each `label ·
      qté × prix unitaire`;
   3. the **arrival complement's lines** when the group covers it, verbatim from
      `arrivalComplementDetailFromReservation` — the same source the SAS recap renders, so the two
      screens can never tell a different story;
   4. the **end-of-stay complement's lines** when the group covers it (rule 2bis of the previous
      spec), from `endOfStayComplementDetail`;
   5. **Taxe de séjour**, one line, wherever it sits (solde and/or complément), always last of the
      prestations;
   6. **Réduction accordée** (negative) or **Pourboire** (positive) when the payment is adjusted;
   7. **Total encaissé**, in bold — what the guest actually handed over.
3. An **offered** line (geste commercial) shows at **0 €** with its original amount struck through,
   exactly as the SAS recap shows it. It is part of what the guest received; hiding it would make the
   detail lie by omission.
4. **The per-bucket controls below are untouched.** The block is a reading of the buckets, never a
   replacement (rule 17 of [single-payment-at-check-in.md](single-payment-at-check-in.md)).
5. **The lines are shaped by the server** and rendered as they arrive (CLAUDE.md §6.0). The client
   sums nothing, derives nothing, labels nothing.
6. The accommodation and tax shares come from the **contribution snapshots captured at payment time**
   (`accommodationSoldeContribTtc`, `touristTaxSoldeContribTtc` and their acompte twins, plus the
   per-line `acompteContribTtc` / `soldeContribTtc`) — the very numbers the Comptabilité credits. The
   fiche detail and the journal are then the same arithmetic, not two implementations that agree
   today.
7. **The accommodation line is the residual**, `montant du bucket − (options + ressources + taxe)`, so
   the lines always sum to the bucket exactly, whatever rounding the snapshots carry.
8. When a stay bucket carries **no contribution snapshot** (a stay marked paid outside the app, a
   capture that legitimately failed on a platform booking — rule 7 of the fiche spec), that bucket
   falls back to **one line named after it** (« Solde », « Acompte »). A missing snapshot degrades the
   detail; it never invents a split. **Consequence, measured on production data during implementation:
   that bucket contributes 0 € of accommodation, so no réduction can be granted on it** (the floor
   equals the total). This is the honest outcome — the app cannot say how much of that money was the
   nights — and the helper text names the limit.

### 3.2 Adjusting the total

9. The block carries a **« Total encaissé »** field. Empty = the computed total, which is what every
   existing reservation shows.
10. **A lower value records a réduction**: `réduction = total calculé − total saisi`, imputed **on the
    accommodation** and on nothing else. Prestations, ressources and taxe de séjour keep their
    amounts.
11. **The réduction can never exceed the accommodation** the payment covers — the « Hébergement » line
    of rule 2. The field refuses to go below `total calculé − hébergement` with a helper naming the
    floor, **and the server clamps to it before storing**: the bound is not an interface politeness,
    it is what keeps the réduction a réduction on the accommodation rather than a silent discount on
    the taxe de séjour, which is owed to the commune whatever the operator granted.
12. **A higher value records a pourboire**: `pourboire = total saisi − total calculé`. It is not the
    price of anything — money given on top — and it is booked as such (§3.4).
13. **Only where a group exists.** No group, no block, no field. Adjusting a stay collected in two
    échéances is a different question and stays out (§8).
14. **Adjustable after the fact**, like every other amount of the fiche: realising a week later that
    the guest was given 50 € off is the ordinary case. A cancelled reservation stays read-only; a past
    one follows [admin-unlock-past-reservations.md](admin-unlock-past-reservations.md); a
    reception-only user never sees the block at all.
15. **Clearing the field drops both lines** and restores the computed total.
16. Server-side validation: finite, ≥ 0. A value under the floor is **raised to the floor**, never
    silently rejected — same discipline as rule 33 of
    [adjustable-complement-amounts.md](adjustable-complement-amounts.md).
17. **Traced in the history**: « Total encaissé à l'arrivée : 852,82 € → 800,00 € (réduction 52,82 €) ».
    It is money; it has to be re-readable months later.

### 3.3 What the adjustment moves — and what it does not

> **The réduction is modelled on the refund, not on the price.** A refund
> ([reservation-refunds.md](reservation-refunds.md)) is an independent dated object that **never
> touches the reservation row**: the readers subtract it. The réduction is the same movement without
> the bank transfer — money that was never collected rather than money given back. That is what keeps
> it out of the pricing engine, where it would have had to fight the frozen acompte/solde: an amount
> subtracted from a bucket the fiche pins would either be lost (the pin wins) or applied again at
> every save (the subtraction wins). Neither is acceptable for money.

18. **No bucket amount changes. No price changes.** `depositAmount`, `balanceAmount`,
    `complementAmount`, `endOfStayComplementAmount`, `finalPrice`, `totalPrice` are strictly
    untouched, and so is the payment schedule.
19. **`isSettled` and `remainingToPay` are unaffected**: every bucket the group named is paid, so the
    reservation is soldée, réduction or not. Nothing new to teach them.
20. **`comptaCollected` follows the money**: `− réduction + pourboire`. What the operator received is
    what the bank shows.
21. **The fiche's « Total du séjour » follows too** (`sejourNetTotal`), with its own row in the
    summary cascade, exactly like « Remboursements ». The invariant
    `comptaCollected + remainingToPay === totalSejour` therefore holds by construction, on the fiche
    and in the Suivi financier alike.
22. **The total is what the guest handed over**, `Σ buckets − réduction + pourboire`. The fiche
    computes it **live from the lines it prints**, so the two can never disagree; the stored
    `arrivalPaymentGroup.total` is refreshed at each adjustment, which is what the Comptabilité card
    header reads. A group whose adjusted total falls to 0 € keeps its stored total: `buildGroup`
    refuses a group worth nothing, and rewriting it would DELETE the payment instead of adjusting it.
23. **The adjustment dies with the group.** Un-ticking a bucket, « Annuler ce paiement », or a SAS
    re-run that settles nothing all clear the réduction and the pourboire along with the group: a
    réduction on a payment that no longer exists would keep lowering the books forever.

### 3.4 The Comptabilité

24. **The réduction is an entry of its own**, at the group's date, shaped like an « avoir » but on the
    rebate account: **débit `70900000` (« Rabais, remises et ristournes accordés ») for the HT, débit
    `44571x` for its VAT, crédit du compte client for the TTC**. The sale entries keep their gross
    credits — the accommodation is credited at full price and the rebate is a line of its own, which
    is what the operator asked to see (decided 2026-08-31).
25. **The pourboire is an entry of its own too**: **débit du compte client / crédit `75880000`
    (produit divers de gestion courante), hors TVA**. A freely given tip is not the consideration of a
    prestation — the same reasoning that put the indemnité d'annulation on that account
    ([cancellation-compensation.md](cancellation-compensation.md) rule 16). It is never in the taxe de
    séjour base and never accommodation revenue.
26. **Both are stamped with the payment group**, so the Comptabilité renders them inside the same
    « Paiement unique » card as the buckets they adjust, under them. The card header total is the
    adjusted total — what the bank statement shows.
27. **A caisse-interne group is excluded whole**: its buckets are off the books, and so are its
    réduction and its pourboire. Off the books stays off the books.
28. **The accountant's CSV gains the two entries.** Rule 14 of
    [single-payment-at-check-in.md](single-payment-at-check-in.md) kept the export's shape
    deliberately; this changes it, and it must be **announced to the accountant before the first
    export that carries one** (§9 Q1).

**Edge cases:**

- **Réduction = the whole accommodation** → accepted; the floor is « l'hébergement ne descend pas sous
  0 € », not « il doit rester quelque chose ».
- **A payment with no accommodation at all** (a group of complément + complément de fin de séjour, the
  stay being prepaid) → floor = the total, no réduction possible; the helper says why.
- **Adjusted total = computed total** → neither line, nothing stored.
- **A bucket amount changes afterwards** (an adjusted complement, a prestation sold later) → the
  réduction is unchanged and the total follows: the gesture was a number of euros off, not a
  percentage of a moving total. Should the réduction then exceed the accommodation, it is clamped at
  the next write, never silently.
- **Réduction + pourboire together** → impossible by construction: one target total yields one or the
  other.
- **Devis** → no payment buckets, no group, no block.

---

## 4. Architecture

> **Fat backend.** The lines, their order, their labels, the floor, the réduction, the pourboire and
> the journal entries are all resolved server-side. The fiche renders a payload and posts a target
> amount.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `arrivalPaymentDetail.js` | C | **Pure.** From a reservation + its per-line contributions + the group's buckets → the ordered lines, the accommodation share and the buckets' total. Used by the fiche payload AND by the floor, so they can never disagree. |
| `utils/` | `arrivalPaymentAdjustment.js` | C | **Pure.** `{ bucketsTotal, accommodation, target } → { reduction, tip, floor, floored }`. The floor rule of rule 11 lives here and nowhere else. |
| `utils/` | `arrivalPaymentGroup.js` | — | **Untouched.** The model re-serialises the group with its new total through the existing `serialiseGroup`; the group's own contract does not change. |
| `utils/` | `reservationSettlement.js` | T | `comptaCollected` − réduction + pourboire (rule 20). |
| `utils/` | `pricing.js` | T | `sejourNetTotal` − réduction + pourboire, and both echoed in the quote so the summary can print their rows (rule 21). **No other change: the engine prices nothing differently.** |
| `utils/` | `accountingExport.js` | T | `discountEntryToRows` (crédit client / débit 709 + TVA) and `tipEntryToRows` (débit client / crédit 758). |
| `utils/` | `receptionView.js` | — | **Untouched.** `toReceptionReservationView` picks an allow-list, so the two columns and the whole `arrivalPayment` payload are excluded by construction. |
| `constants/` | `accounting.js` | T | `DISCOUNT_ACCOUNT = '70900000'`, `TIP_ACCOUNT` (the cancellation-compensation constant reused) and the `Rabais accordé` label. The pourboire shares its account with the indemnité d'annulation, so `entryToStructured` gained a per-entry label override rather than renaming a shared account. |
| `models/` | `reservationsModel.js` | T | `setArrivalPaymentAdjustment(id, { target })`: clamps, stores, re-totals the group, writes the history line. Clears both amounts wherever the group is released. |
| `models/` | `accountingModel.js` | T | Emits the two entries when the group's date falls in the month and the group is not cash; stamps them with the group. |
| `controllers/` | `reservationsController.js` | T | `buildArrivalPaymentView` gains `lines`, `accommodation`, `floor`, `reduction`, `tip`; `settleArrivalPayment` gains the `adjust` mode. |
| `routes/` | `reservations.js` | — | No new route: the block's existing `POST /:id/arrival-payment` carries the new mode. |
| `database.js` | `database.js` | T | Two idempotent `ALTER TABLE` blocks + `schema.sql`. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `FinanceSection.jsx` | T | The group block renders the lines + the « Total encaissé » field, and posts the target. |
| `components/` | `PricingSummary.jsx` | T | Two rows in the cascade: « Réduction accordée » and « Pourboire ». |
| `pages/` | `AccountingPage.jsx` | T | Renders the two new entry kinds inside the « Paiement unique » card (labels, badge, and the « % du séjour » caption they must NOT carry). |
| `services/` | `api.js` | T | `adjustArrivalPayment(id, total)` on the existing endpoint. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `ArithmeticTextField` | The money field every other amount of the fiche already uses (it accepts `12+8` and commits on blur). |
| **Created (new generic)** | — | Nothing generic to extract: the block is one composition of existing primitives inside an existing card. |
| **Specific (kept feature-local)** | the detail block, inside `FinanceSection` | It renders one business object with its own vocabulary, next to the `ComplementCard` that already lives in that file. Both are candidates for a shared « payment detail » component **when a third one appears**; generalising from two would freeze the wrong shape. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id` | — | `arrivalPayment: { at, total, cash, means, covers[], lines: [{ kind, label, qty, unitPrice, amount, offered?, originalAmount? }], accommodation, bucketsTotal, floor, reduction, tip }` | `null` / `collectible` shapes unchanged. Absent for a reception-only user. |
| POST | `/api/reservations/:id/arrival-payment` | `{ mode: 'adjust', total: number\|null }` | the refreshed `arrivalPayment` + reservation | `null` = back to the computed total. `400 ADJUST_NO_GROUP` when there is no group, `403` for reception. The value is clamped to the floor, never rejected for being too low. |

---

## 5. Data model

Two nullable columns on `reservations`, added by idempotent `ALTER TABLE` in `database.js` and
mirrored in `schema.sql`:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `arrivalPaymentReduction` | REAL | NULL | The réduction granted on the accommodation of the single payment. NULL / 0 = none. |
| `arrivalPaymentTip` | REAL | NULL | The pourboire received on top of it. NULL / 0 = none. |

Only one of the two is ever non-zero.

**Data impact:** none. Both are NULL on every existing row, which is « rien d'ajusté », and every
reservation predating this spec renders and books exactly as it does today. No backfill. Both are
cleared wherever the group is released, so an undone payment can never leave a réduction behind.

## 6. UI / UX

**Fiche réservation — section Finances, bloc « Encaissé à l'arrivée » (desktop):**

```
┌──────────────────────────────────────────────────────────────┐
│ Encaissé à l'arrivée : paiement unique de 800,00 €           │
│ le 30/08/2026 — CB / Chèque                                  │
│                                                              │
│   Hébergement — 3 nuits                          720,82 €    │
│   Linge de lit · 2 × 12,00 €                      24,00 €    │
│   Repas des trappeurs · 2 × 25,00 €               50,00 €    │
│   Petit-déjeuner · 2 × 9,00 €           ~18,00~    0,00 €    │
│   Taxe de séjour                                   9,60 €    │
│   Réduction accordée                            − 52,82 €    │
│   ──────────────────────────────────────────────────────     │
│   Total encaissé                                 800,00 €    │
│                                                              │
│   [ Total encaissé   800,00 ]   Annuler ce paiement          │
│   Calcul auto (852,82 €)                                     │
└──────────────────────────────────────────────────────────────┘
```

**Copy (French):**

| String | Where |
|---|---|
| « Réduction accordée » / « Pourboire » | adjustment lines |
| « Total encaissé » | total row + field label |
| « Calcul auto (852,82 €) » | helper, field empty |
| « Réduction maximale 720,82 € : elle ne peut pas dépasser l'hébergement. » | helper, at the floor |
| « Hébergement — 3 nuits » | accommodation line |
| « Solde » / « Acompte » | fallback line, rule 8 |
| « Rabais accordé » | Comptabilité, `70900000` row |
| « Pourboire » | Comptabilité, `75880000` row |

**Responsive:**
- `xs` (≤600 px): each line is `label` / `amount` on one row with the label allowed to wrap and the
  amount `whiteSpace: nowrap`; the field goes full width under the total; padding `{ xs: 1.5, sm: 2 }`.
  No horizontal scroll.
- `md` / `lg`: unchanged layout, the block keeps the width of the finance card.
- Comptabilité: the two entries ride the existing `JournalEntryCard`, which already scrolls its table
  horizontally inside its own container on `xs`.

**Sticky action bar:** unchanged — the adjustment writes through its own endpoint, like the two
settlement buttons next to it, so the page's Save is not involved.

## 7. Test plan

### Server unit tests (one file per subject, CLAUDE.md §9) — +31, suite at 3794

- [x] `tests/arrival-payment-adjustment.unit.test.js` (11) — rules 10-12, 15, 16: réduction, pourboire,
      the floor, a target under it raised to it, a payment with no accommodation, a nonsense or
      negative target, and a corrupt accommodation share that must not open a bigger réduction than
      the payment itself.
- [x] `tests/arrival-payment-detail.unit.test.js` (9) — rules 2, 3, 6, 7, 8: composition and order, the
      accommodation as the residual (a snapshot lying by 3 € does not move the total), the single tax
      line, an option split acompte/solde listed once, the offered line at 0 € with its original, the
      fallback when a snapshot is missing, and the end-of-stay lines topped up so they sum to the
      bucket.
- [x] `tests/arrival-payment-books.unit.test.js` (11) — rules 20, 21, 24-27: `comptaCollected` and
      `totalSejour` moving together, the invariant `comptaCollected + remainingToPay === totalSejour`,
      the balanced `70900000` entry with its VAT debit, the sale entries keeping their GROSS credits,
      the tip on `75880000` with no VAT and its own account label, both stamped with the group, a
      caisse-interne group emitting neither, and an adjustment dated in another month staying there.

### Client tests (vitest) — +10, suite at 1185

- [x] `components/reservation/__tests__/FinanceSection.arrival-payment-detail.test.jsx` (9) — the lines
      in order, the offered line struck through, the bucket caption kept when there are no lines, the
      réduction and the pourboire rows, the field posting the target and `null` when cleared, and the
      helper naming the floor.
- [x] `pages/__tests__/AccountingPage.payment-groups.test.js` (+1) — the réduction joins its payment's
      card rather than standing alone.

### Full suites (2026-08-31)
- [x] `cd server && npm test` — 3794.
- [x] `cd client && npx vitest run` — 1185.
- [x] `cd client && npm run build`.
- [x] `npm run test:e2e` — 65 passed, 1 skipped.

### Manual UI verification (2026-08-31, dev server on a copy of production)
- [x] Reservation 22224 (acompte 67,13 € + solde 67,13 € + complément 45 €): « Encaisser en une fois »
      → the block lists « Hébergement — 1 nuit 57,25 € », « Linge de lit · 3 × 7,00 € », « Solde »
      (the bucket whose capture failed — rule 8), « Linge de toilette », « Complément d'arrivée » and
      totals 179,26 €.
- [x] Adjusted to 150 € → « Réduction accordée − 29,26 € », header at 150,00 €, and the Résumé
      tarifaire's « Total perçu sur le séjour » follows.
- [x] Floor: asked for 10 € → clamped to 122,01 €, the field shows the clamped value and the helper
      reads « Réduction maximale 57,25 € : elle ne peut pas dépasser l'hébergement. »
- [x] Comptabilité, August 2026: one « Paiement unique » card headed « Encaissé le 31/08/2026 —
      122,01 € » holding the three bucket entries plus a « Rabais accordé » entry — débit `70900000`
      52,05 €, débit TVA 5,20 €, crédit client 57,25 € — marked **Équilibré**.
- [x] A pourboire (scripted on a copy of the dev base, réservation 22227 adjusted to 200 €): its own
      entry, débit client 3,41 € / crédit `75880000` 3,41 €, no VAT line.
- [x] Mobile 420 px: `scrollWidth === clientWidth` (no sideways scroll), the field goes full width
      above the button, and « Annuler ce paiement » is a 44 px tap target.

## 8. Out of scope

- **Adjusting a stay collected in two échéances.** « Prix hébergement ajusté » covers the price
  decision taken before arrival.
- **Adjusting from the SAS.** The recap keeps its own total and its « Offrir » lines; the fiche is the
  only place that adjusts, by parity with rule 2 of
  [adjustable-complement-amounts.md](adjustable-complement-amounts.md).
- **A réduction on the taxe de séjour or on the prestations.** Named on purpose: the réduction is an
  accommodation gesture, and the complement has its own adjustment.
- **A settings page for the two accounts.** `70900000` is a constant; the pourboire reuses the
  configurable produit-divers account.
- **Making a pourboire possible without a réduction-capable payment** (a tip left at the departure,
  say). One gesture, one place, for now.

## 9. Open questions

- **Q1 — The accountant's export gains two entry kinds (rule 28). When do we tell them?**
  - A: (pending Adrien) — proposal: ship it, and send the accountant the two account numbers
    (`70900000` rabais accordés, `75880000` pourboires) before the first export that carries one.
    Nothing in the app forces the timing: an export only changes shape once a réduction or a pourboire
    is actually recorded.
- **Q2 — The « paiement global » that left a complément de fin de séjour due.** Diagnosed on a copy of
  the dev base on 2026-08-31 (réservation 22275: 852,82 € collected, 30 € still due, the fiche showing
  a red « Complément de fin de séjour »).
  - A: **Resolved** — rule 2bis of
    [single-payment-from-the-fiche.md](single-payment-from-the-fiche.md) (PR #518, 2026-08-31) made
    the end-of-stay complement groupable, which is exactly that case. This spec follows it: the block
    lists that bucket's lines like any other (rule 2.4).
