# Complements ranked by the moment they are collected

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/sas-bath-linen-ghost-line` _(shipped in PR #405)_ |
| **Created** | 2026-08-07 |
| **Author** | Adrien |
| **Related PR** | #405 |

---

## 1. Context

A reservation collects extras at three different moments, but the UI only names two of them, and it
files an amount by **where it is stored** rather than by **when it is collected**.

Reported: an arrival complement settled « En fin de séjour » at check-in still shows under
« Complément d'arrivée » in the reservation summary panel — only its caption changes
([PricingSummary.jsx:708-725](client/src/components/PricingSummary.jsx#L708-L725) flips the label to
« dont complément perçu en fin de séjour » while leaving the amount on the arrival line).

The rest of the page is inconsistent with it: `FinanceSection` already merges a deferred complement
into a single « Complément de fin de séjour » card
([FinanceSection.jsx:613-651](client/src/components/reservation/FinanceSection.jsx#L613-L651)), so the
same money is filed under two different headings on one page.

### 1.1 The rule this spec writes down

> **A complement is filed under the moment it is collected, not under the column that stores it.**
> « Complément d'arrivée » holds only what is (or will be) collected at check-in.

| Situation | Bucket |
|---|---|
| Stay **not started** — everything routed to Complément | **Complément d'arrivée** (a forecast) |
| Stay started/finished, complement **collected** | **Complément d'arrivée** |
| Sold during the stay and **collected on the spot** (notes en séjour) | **Complément durant le séjour** |
| Stay started, complement **not collected** — deferred at check-in *or* simply not settled | **Complément de fin de séjour** |
| Sold during the stay, **still due** (mid-stay remainder) | **Complément de fin de séjour** |

The last two are already collected together at the door
(specs/recall-unpaid-arrival-complement-at-checkout.md + specs/defer-arrival-complement-to-checkout.md),
so the display now matches what actually happens.

## 2. Goal

On a reservation fiche, an amount appears under the heading matching the moment it is collected —
the same way in the summary panel and in the Finance cards.

---

## 3. Functional rules

1. The server computes the split and returns three amounts; the client renders them and picks no bucket.
2. `arrival` = the arrival complement when the stay has **not started**, or when it is **collected**
   (`complementPaid = 1`). Otherwise 0.
3. `duringStay` = the mid-stay sales already collected through a note (`midStaySettledTotal`).
4. `endOfStay` = the end-of-stay complement (SAS lines + mid-stay remainder) **plus** the arrival
   complement when the operator has marked it « Percevoir en fin de séjour »
   ([defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md) §3.3) and it is
   not collected.

   > **Révision du 2026-08-22.** Cette règle disait initialement « … plus le complément d'arrivée
   > quand le séjour a commencé et qu'il n'est pas encaissé, qu'il ait été explicitement reporté ou
   > simplement laissé impayé ». L'inférence par le calendrier avait raison dans le cas courant et
   > tort dans tous les autres : elle déplaçait l'argent d'elle-même le jour de l'arrivée, verrouillait
   > le report, et ne laissait aucun moyen de revenir en arrière. **Le moment de collecte est une
   > décision d'opérateur, pas une déduction** : seul le marqueur le fixe désormais.
   >
   > Ce qui ne change pas : les alertes du jour (tableau de bord, réception) continuent de lire
   > « ce qui reste à encaisser aujourd'hui » depuis l'état réel des buckets
   > ([operationalCollection.js](../server/src/utils/operationalCollection.js)) — là, c'est bien un
   > fait, pas une intention.
5. _(retirée le 2026-08-22 — la définition de « le séjour a commencé » n'entre plus dans le split.)_
6. **Invariant:** `arrival + duringStay + endOfStay` equals the total collected on site
   (`complementAmount + midStaySettledTotal + endOfStayComplementTotal`) in every case. The split
   moves money between headings, never changes a total.
7. Wording, used identically in the summary panel and the Finance cards:
   `Complément d'arrivée` / `Complément durant le séjour` / `Complément de fin de séjour`.
   The « Encaissements en séjour » block is renamed « Complément durant le séjour » (its « Nouvelle
   note » entry point and history are unchanged).
8. A bucket at 0 renders nothing, as today.

**Edge cases:**
- A complement collected **during** the stay rather than at check-in (`complementPaidDate > startDate`)
  is still filed under « Complément d'arrivée ». Accepted simplification: the arrival SAS is what
  settles it in practice, and a late-recorded check-in must not jump heading. Revisit if it misleads.
- An arrival complement forgotten on a past stay stays under « Complément d'arrivée » until someone
  moves it (revision of rule 4). The departure SAS still recalls it, and the reception still lists it
  as due — the split is a heading, not an alert.
- Stay not started but an end-of-stay complement already exists (departure SAS lines cannot exist yet;
  a mid-stay line cannot either) → `endOfStay` keeps whatever is stored, no special case.
- Deferred **and** collected (`complementDeferredToCheckout = 1` and `complementPaid = 1`) → `arrival`,
  by rule 2: it *was* collected. Matches `buildCheckoutComplement`, whose `deferred` flag already
  drops once the arrival complement is paid.
- Devis / public quote (no reservation) → not started → everything under `arrival`, as today.

---

## 4. Architecture

> Fat backend: the classification is a business rule about when money is collected, so it lives in the
> pricing engine. The client receives three numbers and prints them.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `complementBuckets.js` | C | Pure `splitComplementBuckets({ complementAmount, complementPaid, midStaySettledTotal, endOfStayComplementTotal, stayStarted })` → `{ arrival, duringStay, endOfStay }`. Unit-tested, invariant included. |
| `utils/` | `pricing.js` | T | Accepts `stayStarted`; returns `complementSplit` next to the existing totals. No existing field changes value. |
| `controllers/` | `reservationsController.js` | T | `midStayQuoteInputs` also resolves `stayStarted` from the row's `startDate` vs `getTodayIsoDate()`, so preview and save agree. |
| `models/` | — | — | (none) |
| `database.js` | — | — | No schema change. |

`complementDeferredToCheckout` is **not** needed as an engine input: rule 4 keys off « started and not
collected », which already covers the deferred case (the flag only exists to remember the operator's
answer at check-in).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PricingSummary.jsx` | T | Renders the three lines from `quote.complementSplit`; drops the label-flipping branch that kept a deferred complement on the arrival line. |
| `components/reservation/` | `FinanceSection.jsx` | T | Card titles + which cards show come from the same split; « Encaissements en séjour » → « Complément durant le séjour ». |
| `constants/` | `complements.js` | C | The three French headings, shared by both so they cannot drift apart. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge` | Unchanged usage. |
| **Created (new generic)** | — | |
| **Specific (kept feature-local)** | `ComplementCard` | Already local to `FinanceSection`; only its `title` changes. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/calculate-price` | unchanged | `+ complementSplit: { arrival, duringStay, endOfStay }` | Additive. |
| GET | `/api/reservations/:id` | — | unchanged | The fiche reads the split from the live quote, like the other totals. |

---

## 5. Data model

No schema change, no migration. The split is derived at read time from columns that already exist.

**Data impact:** none — no stored amount moves. Only headings change.

## 6. UI / UX

**Summary panel — deferred complement, stay in progress (the reported case):**

```
before                                    after
Total du séjour            1 200,00 €     Total du séjour            1 200,00 €
dont complément perçu en                  dont complément de fin
  fin de séjour              40,00 €        de séjour                 40,00 €
```

The amount leaves the arrival line instead of staying there with a reworded caption. On a platform
reservation the same move applies to the « Complément d'arrivée (perçu sur place) » /
« Complément de fin de séjour » rows of the cascade; « Total perçu sur le séjour » is unchanged
(rule 6).

**Finance cards:** unchanged when the complement is deferred (already one merged card). New: a stay in
progress whose complement was never settled now shows it under « Complément de fin de séjour » instead
of « Complément à percevoir », and the notes block is titled « Complément durant le séjour ».

**Responsive:** no layout change — same rows, same cards, different headings. Checked at `xs` (390px),
`md` and `lg`.

**PageActionBar:** untouched.

## 7. Test plan

### Server unit tests
- [x] `tests/complement-buckets.unit.test.js` (8 tests) — rules 2/3/4/5 and the rule 6 invariant,
      asserted on **every** case: not started, started+collected, started+uncollected, on top of an
      existing end-of-stay complement, the three buckets together, deferred+collected, no reservation,
      and cent rounding.
- [x] Full server suite: 2383 pass — no existing total moved.

### Client tests
- [x] `PricingSummary.complement-buckets.test.jsx` (4 tests) — an uncollected complement renders under
      « Complément de fin de séjour » and not under the arrival line; the two removed captions are gone;
      the three buckets coexist; a payload without `complementSplit` falls back without crashing.
- [x] Renamed headings updated in `PricingSummary.commission`, `FinanceSection.deferred-complement`
      and `FinanceSection.mid-stay-notes`. Full client suite: 801 pass. E2E: 45 pass.

### Manual UI verification (2026-08-07, dev DB)
- [x] #22226 (stay started 02/08, complement 64 € uncollected): the 64 € left « Complément d'arrivée
      (perçu sur place) » for « Complément de fin de séjour ». **Total perçu unchanged at 309,94 €**
      (rule 6 verified on screen).
- [x] Finance cards on the same reservation: 0 × « Complément d'arrivée », the merged
      « Complément de fin de séjour » card, and the notes block titled « Complément durant le séjour ».
      No « Complément à percevoir » / « Encaissements en séjour » left anywhere.
- [x] Control — #22209 (complement collected): stays under « Complément d'arrivée (perçu sur place) »
      with its « Complément payé » badge.
- [x] Mobile (`xs`, 390px) on #22226: the heading renders on one line, no overflow.

## 8. Out of scope

- The dashboard « à percevoir à la porte » block and the J-2 email, which have their own wording
  (decision 2026-08-07: fiche only).
- Moving any stored amount between columns — the two DB buckets keep their meaning
  (specs/defer-arrival-complement-to-checkout.md §3.2 rule 9).
- Re-classifying a complement collected during the stay (see edge cases).
- The accounting export, which books by payment date and bucket, not by heading.

## 9. Open questions

- Q: Stay started, complement unpaid and NOT explicitly deferred — which bucket?
  - A: (2026-08-07) End of stay. Consistent with the automatic recall at check-out, and with « arrival
    holds only what was collected at arrival ».
- Q: Scope — summary only, or the Finance cards too?
  - A: (2026-08-07) Both, so one amount is never filed under two headings on the same page.
- Q: Rename « Encaissements en séjour »?
  - A: (2026-08-07) Yes → « Complément durant le séjour »: one vocabulary for the three moments.
