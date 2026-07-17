# Finance overview — « En attente de règlement » global & au restant dû

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/finance-pending-global-remaining` |
| **Created** | 2026-07-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Amends** | [finance-overview-rework.md](finance-overview-rework.md) §3.2 item 5 |

---

## 1. Context

On the « Suivi financier » → Vue générale, the « En attente de règlement » card
(`financeModel.getSummary().totalPending`) is **bounded to the selected du/au period** (default: the
current month) and counts the **whole** `totalSejour` of past unsettled reservations. Two problems
Adrien reported (2026-07-17, prod):

1. **Past unpaid stays fall out of the card** when their `endDate` predates the selected window.
   Prod example (period = July 2026): Stéphane Grimaud (ended 28/06, 668 € unpaid) is missing —
   the card shows 1 298,21 € while the « Paiements en attente » operational tab (already
   period-free) correctly shows all 3 reservations / 1 966,21 €. The mismatch made the operational
   table *look* incomplete; it is in fact complete (verified against raw SQL on the prod import) —
   the card is the wrong one.
2. **Double counting**: a past, partially-paid reservation counts for its FULL `totalSejour` in the
   card even though the paid part already sits in « Encaissé ».

The other two figures already match Adrien's rules and stay unchanged: « Revenu total » =
Σ `totalSejour` of the period's reservations (`endDate` in range); « Encaissé » = Σ paid components
(net of each échéance's commission, caisse interne excluded) of the period's reservations. All
figures are already **net of platform commission** (specs/fiche-total-sejour-net-of-commission.md).

## 2. Goal

The « En attente de règlement » card shows the money actually still owed to the operator across
**all** finished stays — regardless of the selected period — matching the « Paiements en attente »
operational tab to the euro.

## 3. Functional rules

Decision (AskUserQuestion, 2026-07-17): amount = **restant dû** (`remainingToPay`), not the whole
`totalSejour` — no double counting with « Encaissé », and the card equals the operational chip.

1. **Scope becomes global**: `totalPending` = over ALL reservations (`kind='reservation'`) with
   `endDate < today` AND not `isSettled` — **no `from`/`to` bound**. Same predicate as
   `getOperational().pending`.
2. **Amount becomes the outstanding part**: Σ `remainingToPay(r)` (still-owed buckets only, net of
   the unpaid échéances' commissions). Invariant: card value === Σ of the operational tab's
   « En attente de paiement » chip (`pending.totals.remainingToPay`).
3. **HT counterpart** follows: `totalPendingHt` = Σ `htAmount(r, remainingToPay(r), vatRate)`.
4. **`getBreakdown('totalPending')` mirrors**: include = `endDate < today && !isSettled(r)` (no
   period bound — the breakdown query keeps receiving `from`/`to` for the other metrics but ignores
   them for this one); amount = `remainingToPay(r)`. Dialog subtitle no longer implies the period.
5. **Client card**: caption « sur la période » is replaced by « séjours terminés » (it is not a
   period figure anymore). No client-side computation (unchanged — reads `summary.totalPending`).
6. **« Répartition » pie**: keeps plotting the two card values (« Encaissé » period vs « En
   attente » global) — the pie mirrors the cards the user sees. Documented as a deliberate mixed
   scope (the pie is a visual echo of the cards, not an accounting statement).
7. **« Revenu total » and « Encaissé » unchanged** (they already match the requested rules); pinned
   by existing tests.
8. **Operational « Paiements en attente » tab unchanged** (already global + correct); its
   completeness gets pinned by a test (endDate-passed unpaid reservation OUTSIDE any typical
   period still listed).

**Edge cases:**
- Past reservation with deposit paid, balance unpaid → card counts only the unpaid balance (net of
  solde commission); « Encaissé » keeps the deposit. Sum of the two = totalSejour.
- Caisse-interne complement → still settled → excluded (unchanged).
- `endDate === today` → not yet « terminé » (strictly `<`, matches operational; unchanged).
- Empty period selection → `totalPending` unaffected (global).

---

## 4. Architecture

> Fat backend, thin frontend: computation changes live in `financeModel` only.

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `financeModel.js` | T | `getSummary`: `totalPending`/`totalPendingHt` computed from a global past-unsettled query (Σ `remainingToPay`), decoupled from the `[from,to]` loop. `getBreakdown`: `totalPending` predicate/amount mirrored + period-free row source for that metric. |
| `controllers/` | `financeController.js` | — | (pass-through, unchanged) |

### 4.2 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `FinancePage.js` | T | Card caption « sur la période » → « séjours terminés » on the `totalPending` card only. |
| `pages/__tests__/` | `FinancePage.test.js` | T | Caption assertion updated. |

### 4.3 API — shapes unchanged; only the semantics/values of `totalPending`, `totalPendingHt`, and the `totalPending` breakdown rows change.

## 5. Data model — none.

## 6. UI / UX

Card « En attente de règlement » keeps its place/accent; caption becomes « séjours terminés ».
Values now always equal the operational tab's chip. No layout change, no responsive change.

## 7. Test plan

### Server unit tests (`finance-model.unit.test.js` + `financeBreakdown.unit.test.js`)
- [x] `totalPending` ignores the period: a past unsettled reservation with `endDate` BEFORE `from`
      still counts (the prod Grimaud shape); `revenueTotal` stays period-bound in the same fixture.
- [x] `totalPending` = Σ `remainingToPay`: past reservation with paid deposit + unpaid balance →
      only the balance counts; `totalCollected + totalPending` reconstructs the stay total; platform
      variant nets the unpaid échéance's commission (300 − 30 = 270).
- [x] `totalPendingHt` follows the remaining amount (200 → 181,82 at 10 %).
- [x] Breakdown `totalPending`: `window.kind = 'global'`, finished stay outside the period listed,
      row amount = restant dû, total === summary figure.
- [x] Operational pin + invariant: `getOperational().pending` lists both finished unpaid stays
      period-free and `totals.remainingToPay === getSummary().totalPending`.
- [x] Existing suites: no re-baseline needed (their fixtures were fully-unpaid within wide windows,
      so old and new semantics coincided); full server suite 2014/2014.

### Client (vitest)
- [x] `FinancePage.test.js`: caption « séjours terminés » on the pending card (and « sur la
      période » no longer asserted on it). Full client suite 652/652; E2E 32 passed.

### Manual UI verification (2026-07-17, prod-import DB, headless Playwright)
- [x] Period = July 2026: card shows 1 966 € / 1 783 € HT « séjours terminés » (was 1 298 € before —
      Grimaud restored) = operational chip.
- [x] Breakdown dialog: « séjours terminés (toutes périodes) », 3 rows (668 + 237,21 + 1 061),
      total 1 966,21 €.

## 8. Out of scope

- « Revenu total » / « Encaissé » definitions (already conform; period by `endDate`).
- `getProjection` (its own pending notion is date-targeted, untouched).
- Overdue tab logic (direct-only dunning), upcoming tab.

## 9. Open questions

- Q: Amount = restant dû or whole totalSejour? — **A (2026-07-17): restant dû** (`remainingToPay`),
  aligned with the operational chip, no double counting.
