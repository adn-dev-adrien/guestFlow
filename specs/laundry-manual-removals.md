# Retirer du linge d'une tournée blanchisserie (lavé par mes soins)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/laundry-manual-removals` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [manual-laundry-additions.md](manual-laundry-additions.md), [linen-inventory-shortage-tracking.md](linen-inventory-shortage-tracking.md), [weekly-bed-linen-tracking.md](weekly-bed-linen-tracking.md) |

---

## 1. Context

The laundry card already lets the operator **add** linen to a trip that no reservation implies
([manual-laundry-additions.md](manual-laundry-additions.md)): six per-type counts, folded into
« À apporter », returning in the next « À récupérer », and simulated in « Disponible après ce dépôt ».

The mirror case has no answer. Issue **#428**: *« Je veux pouvoir aussi retirer du linge du calcul de la
blanchisserie dans le cas où je fais moi-même le lavage. »* When the host washes two sets of sheets
himself, the trip still carries them: the drop-off over-states what goes in the van, the next pick-up
promises linen that will never come back, and the clean-stock projection is wrong for a full week.

## 2. Goal

On a laundry trip, the operator can **withdraw** linen from the calculation — the linen he washes
himself. It leaves « À apporter », never comes back in « À récupérer », and stays available in the
clean stock.

## 3. Functional rules

1. **Same field, signed value** (decision 2026-08-17): the manual per-type counters accept a
   **negative** number. Positive = du linge en plus à laver ; négatif = du linge **lavé par vos soins**,
   retiré du voyage. No second table, no second dialog — the trip keeps exactly one row of six integers.
2. **The stored value is a signed integer.** The server rounds and stores it as-is (no clamping to 0);
   an all-zero row is still deleted, so a trip reverts to reservation-only.
3. **« À apporter » / « À récupérer » never go negative.** The summary adds the (signed) manual sum of
   the window to the reservation linen, then **clamps each type at 0**: one cannot deposit −2 sheets.
   The clamp is per type, on the drop-off and on the pick-up alike (the pick-up is the previous
   drop-off).
4. **Stock simulation — the linen comes back clean the same day** (decision 2026-08-17). On the trip
   date a withdrawal moves the linen **dirty → clean**: the host washed it, so it never joins the
   at-laundry batch, never returns on the +7 j pick-up, and stays available for the next stay. This is
   the exact mirror of an addition (clean → dirty → at-laundry → clean).
5. **A withdrawal cannot exceed the dirty pile.** Per type, the applied withdrawal is capped at what is
   actually dirty on that day: linen still in a guest's room (`inCirculation`) or already clean cannot
   be « washed at home ». The excess is ignored (never turns into phantom clean linen), which keeps the
   engine's conservation invariant `stock = clean + inCirculation + dirty + atLaundry` true.
6. **Skips.** A skipped trip defers its manual line like everything else: the withdrawal applies on the
   next non-skipped trip, together with the deferred reservation backlog (unchanged mechanics —
   negatives ride the same path).
7. **The card says which is which.** The « dont ajout manuel : … » caption keeps listing the positive
   part; a second caption « dont lavé par vos soins : … » lists the withdrawals, in positive numbers.
   A trip with only withdrawals shows only the second caption.
8. **No reservation coupling** — unchanged: a manual line never touches a reservation, an option, or
   the money. It is a linen-trip overlay.

**Edge cases:**
- Withdrawal larger than the trip's linen → the block floors at 0 (rule 3) and the stock effect is
  capped at the dirty pile (rule 5).
- A trip whose reservation linen is 0 and whose only manual line is negative → both blocks are 0 and
  the card stays hidden (nothing to bring, nothing to fetch): the existing hide-when-empty rule.
- Mixed signs across types on the same trip (e.g. `+2 doubles / −3 simples`) → each type is independent.
- An existing all-positive trip is unaffected: the stored values, the blocks and the stock are
  bit-for-bit what they were.

---

## 4. Architecture

> **Fat backend.** The client only sends six signed integers; the clamping, the window sums and the
> whole stock simulation stay server-side.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/laundryManualAdditionsModel.js` | T | Stores a **signed** integer per type (the ≥ 0 clamp becomes a round); all-zero still deletes the row. |
| `controllers/` | `controllers/planningController.js` | T | `buildBlock` clamps every type at 0 after folding the manual sum (rule 3). |
| `utils/` | `utils/linenInventory.js` | T | A negative manual value is applied as `dirty → clean`, capped at the dirty pile of that type (rules 4-5). |
| `database.js` | — | — | (none — the columns already exist and hold integers) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/LaundryManualAdditionsDialog.jsx` | T | The steppers accept negatives (« − » no longer stops at 0, the field accepts a leading `-`); title + helper text explain the two directions; a per-line hint marks a withdrawal. |
| `components/` | `components/LaundryDayCard.jsx` | T | Splits the manual caption in two: « dont ajout manuel » (positives) and « dont lavé par vos soins » (negatives, rendered positive). |
| `pages/` | `pages/PlanningPage.jsx` | — | (none — it already fetches, passes and saves the six values) |
| `services/` | `api.js` | — | (none — same endpoint, same shape) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Dialog`/`Button`/`TextField`/`Stack`, the existing `LaundryManualAdditionsDialog` | Reused, extended in place. |
| **Created (new generic)** | — | None: the change lives in the two components that already own this UI. |

### 4.3 API contract

Unchanged endpoints; the six values may now be negative:

`PUT /api/laundry/manual-additions/:date` — body `{ singleBeds, doubleBeds, babyBeds, largeTowels,
mediumTowels, smallTowels }`, **signed** integers. `GET /api/laundry/manual-additions` returns them as
stored.

---

## 5. Data model

No migration: `laundry_trip_manual_additions` already stores integers, and SQLite holds negatives in
the same columns. The only change is which values the model accepts.

## 6. UI / UX

- **Dialog** — title « Linge ajouté ou retiré », helper text: « Valeur positive : du linge en plus à
  laver. Valeur négative : du linge que vous lavez vous-même, retiré du voyage. » Each line with a
  negative value shows a discreet « lavé par vos soins » hint. The « − » button keeps working below 0;
  the numeric field accepts `-`. Touch targets unchanged (≥ 40 px), `fullScreen` on `xs` as today.
- **Card** — two italic captions under the two blocks, only when non-empty.
- Nothing else moves: the blocks, the stock line and the skip toggle are untouched.

## 7. Test plan

### Server unit tests
- [x] `laundry-manual-additions-model.unit.test.js` (+3): a negative value is stored as-is; mixed signs
      round-trip; all-zero still deletes the row; `sumForWindow` sums signed values.
- [x] `planning-laundry-controller.unit.test.js` (+2): a withdrawal reduces « À apporter »; a withdrawal
      bigger than the reservation linen floors the block at 0 (never negative).
- [x] `linen-inventory-manual-additions.unit.test.js` (+3): a withdrawal returns the linen to the clean
      stock on the trip date and never joins the at-laundry batch (so the +7 j pick-up doesn't carry it);
      it is capped at the dirty pile; conservation holds on every day.

### Client tests (vitest)
- [x] `LaundryManualAdditionsDialog.test.jsx` (+2): « − » goes below zero and the negative value is sent
      on save; typing `-2` is accepted.
- [x] `LaundryDayCard.manual.test.jsx` (+2): a negative manual line renders « dont lavé par vos soins :
      2 simples » and not « dont ajout manuel »; a mixed trip renders both captions.

### Manual UI verification
- [x] Planning → carte blanchisserie → crayon : saisir −2 draps simples, enregistrer, vérifier « À
      apporter » et le stock « Disponible après ce dépôt ». Desktop + mobile. Screenshot in the PR.

## 8. Out of scope

- A per-reservation « linge lavé par mes soins » flag (rejected 2026-08-17: the operator wants
  quantities, not whole stays).
- Tracking WHERE the home-washed linen is (no « lavé maison » bucket: it returns to the clean stock).
- Any change to the skip mechanics or to the laundry-day weekday configuration.

## 9. Open questions

Resolved during scoping (2026-08-17, issue #428):
- **Saisie** → **valeur négative dans le champ existant** (rejected: a second « lavé par mes soins »
  block, and a per-reservation flag).
- **Effet sur le stock** → **retour en propre le jour même** (rejected: disparition du suivi, retour le
  lendemain).
