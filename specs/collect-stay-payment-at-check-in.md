# Collect the whole stay at check-in (arrival SAS)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/collect-stay-payment-at-check-in` _(user-managed)_ |
| **Created** | 2026-08-30 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A reservation is paid through four buckets — **acompte**, **solde**, **complément d'arrivée**,
**complément de fin de séjour** ([reservationSettlement.js](../server/src/utils/reservationSettlement.js)).
The arrival SAS only ever talks about the last two, plus the caution: it lists what to collect **at the
door** and settles it with the « CB / Chèque · Payé en liquide · En fin de séjour » buttons of
[sas-recap-payment-buttons.md](sas-recap-payment-buttons.md).

**Last-minute bookings break that assumption.** A stay booked inside the solde window gets
`depositAmount = 0` and the **whole pre-arrival total in the solde**
([pricing.js:2244](../server/src/utils/pricing.js#L2244) via
`isLastMinuteStay`, [deposit-blocks-the-dates.md](deposit-blocks-the-dates.md) rules 4-6), with a
`balanceDueDate` clamped to the booking day. The guest has not paid anything and arrives tomorrow: the
money is collected **at the door, at check-in** — exactly where the SAS is — but the SAS has no idea the
stay is unpaid and offers no way to record it. The operator has to leave the wizard, open the fiche and
tick « Marquer solde payé » by hand, which in practice happens later or not at all.

The same hole shows up outside the last-minute case: a direct booking whose solde was never wired, an OTA
where the guest pays « sur place ». In every one of them the money is handed over at check-in.

## 2. Goal

At check-in, the operator can collect **everything the guest still owes on the stay itself** — acompte
and solde — from inside the arrival SAS, with the same one-tap settlement buttons already used for the
complement, and the payment is recorded on the reservation (and in the accounting) without leaving the
wizard.

## 3. Functional rules

### 3.1 What is owed on the stay

1. **`stayDue`** = the sum of the stay buckets still **applicable and unpaid**:
   - acompte, when `depositAmount > 0` **AND** `depositDisabled = 0` **AND** `depositPaid = 0`;
   - solde, when `balanceAmount > 0` **AND** `balancePaid = 0`.

   Rounded to 2 decimals, never negative. On a last-minute stay the acompte is 0 € by construction, so
   `stayDue` is the whole solde.
2. **`stayDue` is the GROSS amount** — what the guest physically hands over — **not** netted of the
   platform commission. `remainingToPay` in
   [reservationSettlement.js](../server/src/utils/reservationSettlement.js) deliberately nets it (it
   answers « what will I actually receive? »); this step answers « how much do I ask the guest for? ».
   The commission stays owed to the platform and is unaffected.
3. The **taxe de séjour** rides inside the solde for a direct booking, so it is collected with it and
   needs no separate treatment here. A tax already routed to the complement
   (`touristTaxInComplement`, or an OTA collecting on arrival) stays in the complement block, untouched.
4. The two buckets are collected **together, as one payment**: the guest pays « le séjour », not
   « l'acompte puis le solde ». There is no per-bucket button.

### 3.2 The « Séjour à régler » step

5. **New arrival-SAS page**, placed **after** the caution page(s) and **before** « Prestations
   réservées » — the door-money pages are grouped, caution first. Departure SAS: never shown.
6. **Shown only when** `stayPayment.applicable` is true, i.e. **`stayDue > 0`** *(something to collect)*
   **OR** the stay was settled **by a previous run of this very SAS** (rule 14) *(so a re-opened SAS can
   show and undo its own decision)*. A stay that was already fully paid before the SAS — the normal,
   prepaid case — never displays the page, consistently with
   [sas-hide-settled-steps.md](sas-hide-settled-steps.md).
7. **Never shown to a reception-only user** (§3.6).
8. **Body — direct channel** (`isDirectChannel(platform)`: `direct`, `Lodgify`):
   - « **Séjour à régler : {stayDue}** » as the page's hero amount;
   - one detail line per unpaid bucket **when both are unpaid** (« Acompte : X € », « Solde : Y € »);
     a single bucket shows no redundant detail line;
   - the settlement buttons of rule 10.
9. **Body — OTA channel** (everything else): the same page, preceded by a warning block —
   « ⚠ Ce solde est versé par la plateforme après le séjour. À n'encaisser que si le client paie sur
   place. » The buttons render **unselected** by default there too (rule 11), so the page is a question,
   never a nudge.

### 3.3 Settling

10. **Three mutually-exclusive buttons**, same component and grammar as the complement's:
    - **CB / Chèque** → the stay is settled, ordinary accounting.
    - **Payé en liquide** → settled in the **caisse interne**: money collected, **excluded from the
      accounting, the accounting export and the turnover** (§3.4).
    - **Pas maintenant** → nothing is recorded; the stay stays due exactly as it is today.
11. **« Pas maintenant » is pre-selected and is the fallback**: clicking the active mode again returns
    to it, never to « nothing selected » (same rule as the arrival complement's « En fin de séjour »).
    Committing without touching the buttons therefore writes **nothing** on the stay buckets.
12. The chosen mode is **repeated on the recap** in a « Séjour » block (§3.5) and can be changed there;
    it is one piece of state rendered on two pages, committed once at « Valider et terminer ».
13. **Commit mapping** — for **every applicable unpaid bucket** (rule 1):
    - `depositPaid` / `balancePaid` → 1, `depositPaidDate` / `balancePaidDate` → **today**, kept via
      `COALESCE` when a date already existed;
    - `depositPaidCash` / `balancePaidCash` → 1 on « Payé en liquide », 0 on « CB / Chèque »;
    - `depositPaidAtArrival` / `balancePaidAtArrival` → 1 (the marker of rule 14);
    - the **per-bucket contribution snapshot** is attempted on each 0→1 flip, as
      `PATCH /reservations/:id/payment` does (`captureContribsOnFlip`,
      [force-item-to-complement.md](force-item-to-complement.md)) — **best effort** (revised
      2026-08-30, §9). The capture replays the pricing engine and asserts that the line contributions
      sum to the stored échéance; on a booking whose stored solde is the platform's own figure the two
      legitimately disagree and it throws — **6 of the 8 unpaid stays in the production copy** fail it,
      and the fiche's own quick « Marquer solde payé » already returns 409 on those same rows today.
      Aborting would cost the whole check-in (caution, upsells, planning flags) for something the
      operator cannot fix at the door, so the failure is **logged and the money is still recorded**,
      contribs left NULL: the accounting then derives the attribution the legacy way — exactly what a
      full fiche save has always done with these reservations. The assert runs **before** any write,
      so nothing partial is ever persisted.
13.bis. **Ordering inside the commit.** The acompte is settled before the solde, and the solde's
    capture re-reads the reservation: that capture is defined as « what the line still owes **after**
    its acompte snapshot », so a stale row would make it claim the whole line and break its own
    invariant on a stay where both buckets are collected at once.
14. **Reversibility on re-open** ([reopen-completed-sas.md](reopen-completed-sas.md)). The two
    `*PaidAtArrival` markers record which buckets **this SAS** settled. Re-opening the SAS pre-selects
    the mode from the stored flags (`cash → « Payé en liquide »`, `paid non-cash → « CB / Chèque »`,
    nothing → « Pas maintenant »); switching back to **« Pas maintenant »** clears
    `*Paid` / `*PaidDate` / `*PaidCash` / `*PaidAtArrival` **for the marked buckets only** and calls
    `clearContribsOnUnflip` for each. A bucket paid **outside** the SAS (bank transfer ticked on the
    fiche) carries no marker and is never touched.
15. **The markers follow the fiche.** A **flip** of `depositPaid` / `balancePaid` from outside the SAS
    (`PATCH /reservations/:id/payment`, the full fiche save) **clears that bucket's `*PaidAtArrival`
    marker and its cash flag** (`releaseStayBucket`): the SAS never claims a decision it no longer owns,
    and a bucket the operator just un-ticked must not keep reading « settled » through a stale cash flag.
    Only on a **real change** — saving the fiche for an unrelated reason must not silently pull a stay
    collected at the door back into the accounting.
16. **History.** The commit records « Acompte encaissé » / « Solde encaissé » (with « caisse interne »
    spelled out) in the reservation's « Historique des modifications », like every other SAS money
    decision ([arrival-departure-sas.md](arrival-departure-sas.md) §3.7).

### 3.4 « Caisse interne » on the stay

17. A stay bucket flagged `*PaidCash = 1` is treated **exactly like a cash complement**
    ([cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md) §3.2):
    - **excluded from the accounting entries** and therefore from the CSV export (`encaissementsByMonth`
      drops it, both in the SQL filter and in the per-entry emission);
    - **excluded from « encaissé »** (`comptaCollected`) and from the **« total de séjour »**
      (`financeModel.totalSejour`);
    - **counted as settled**: `bucketStates().settled` is true, so `remainingToPay` is 0 and the
      reservation reads « soldé » in the Suivi financier and on the dashboard.
18. **Consequence, accepted (decision 2026-08-30):** a stay entirely collected in caisse interne shows
    **0 € of turnover** on the Finances page while carrying no « reste à payer ». This is what keeps the
    documented invariant `comptaCollected(r) + remainingToPay(r) === totalSejour(r)` true, and it is the
    same treatment the two complements already get. « Hors comptabilité » means out of the turnover, not
    just out of the export.
19. The **taxe de séjour** owed to the commune is **not** affected: it is declared per stay
    (`touristTaxDeclaredAt`), never derived from the accounting entries — same rule as the refunds
    ([reservation-refunds.md](reservation-refunds.md) §3.5).
20. The **fiche** displays the flag: the « Acompte payé » / « Solde payé » buttons of
    [FinanceSection.jsx](../client/src/components/reservation/FinanceSection.jsx) gain the same
    « Caisse interne ✓ » marker the complement blocks already show. Un-ticking a bucket clears its cash
    flag. No new fiche control is added — the caisse-interne choice is made at the door, in the SAS.

### 3.5 Recap

21. When `stayDue > 0` (or the stay was settled by this SAS), the arrival recap gains a **« Séjour »**
    block **above** the complement detail: the amount, the bucket lines, and the same three buttons.
22. The complement keeps its own block, its own detail and its own « CB / Chèque · Payé en liquide · En
    fin de séjour » buttons — the two are different accounting objects and one may be deferred while the
    other is collected.
    **Superseded on 2026-08-30 by [single-payment-at-check-in.md](single-payment-at-check-in.md).**
    Separating them by default was wrong at the door: the guest hands over ONE card for the stay and
    the prestations taken during the check-in, and GuestFlow recorded two collections — two ticks on
    the fiche, two entries in the Comptabilité for one bank line. When both sides are collectible the
    recap now asks **once**. The case this rule was written for is real and stays reachable in one
    tap, behind « Régler séparément »; and the two buckets remain separate accounting objects, which
    is exactly why the unified settlement groups the *collection* and never merges the ventilation.
23. When both are non-zero the recap shows a **« Total à percevoir à l'arrivée »** = `stayDue` +
    complement total, purely as a reading aid (each block still settles independently).

### 3.6 Reception role

24. A **reception-only** user (`specs/reception-role-checkin-only.md`) **never sees the step**: the
    server serves `stayPayment = { applicable: false }` with **no amount at all**, so the page is not
    rendered and the numbers are not in the payload.
25. **Fail-closed on the write side**: `stayPaid` / `stayPaidCash` coming from a reception-only user are
    **dropped before processing** (same discipline as `toReceptionPaymentPatch`), never rejected — a
    stale client must not lose a whole check-in over a field it should not have sent.

**Edge cases:**
- `stayDue = 0` (prepaid stay, the ordinary case) → no step, no recap block, nothing written. Unchanged
  SAS.
- Deposit disabled (`depositDisabled = 1`) → the acompte is not applicable; only the solde counts.
- A stay whose solde is 0 € and acompte unpaid (rare, over-paid deposit split) → the step shows the
  acompte alone.
- `complementPaid = 1` already → unchanged; the complement block keeps its existing « déjà marqué payé »
  behaviour, the stay block is independent of it.
- Quitter at any point → nothing written, unchanged.
- Re-opening a SAS that settled the stay, then quitting → nothing written, the settlement stands.
- Cancelled reservation (`kind = 'cancelled'`) → the SAS is not reachable; unchanged.

---

## 4. Architecture

> **Fat backend.** `stayDue`, the applicability of the step, the channel flavour and every write live on
> the server. The client renders the payload and holds one local `stayPayMode` string until the commit.
> No amount is computed in React.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `routes/reservations.js` | — | (none — the SAS endpoints already exist) |
| `controllers/` | `controllers/sasController.js` | T | `getSas` builds the `stayPayment` block (`buildStayPayment`: amounts, `collectible`, channel flavour), forced to `{ applicable: false }` for a reception-only user; `commitArrival` reads `stayPaid` / `stayPaidCash`, drops them for reception, and passes the tri-state down to the model. |
| `controllers/` | `controllers/reservationsController.js` | T | `updatePayment` + the full save clear `depositPaidAtArrival` / `balancePaidAtArrival` (and the cash flag when a bucket goes back to unpaid) whenever they write a stay bucket — rule 15. |
| `models/` | `models/reservationsModel.js` | T | `commitArrivalSas` gains the stay-settlement block, at the **end** of the existing transaction (after the complement lines are written): flip / revert the buckets, write the dates + cash + marker columns. New `captureStayContribs` (best-effort snapshot, rule 13) and `releaseStayBucket` (ownership release, rule 15, also called by `updateReservation` on a real flip). |
| `models/` | `models/accountingModel.js` | T | `encaissementsByMonth`: exclude a cash-flagged acompte / solde, in the SQL `WHERE` **and** in the per-entry `inMonth(...)` guards — same shape as the two complements. |
| `models/` | `models/financeModel.js` | T | `totalSejour` drops a cash-paid acompte / solde (rule 17); the summary SQL selects the two new cash columns. |
| `utils/` | `utils/reservationSettlement.js` | T | `bucketStates` marks a cash-settled bucket `settled`; `remainingToPay` and `comptaCollected` exclude it; new pure `stayDueAtArrival(r)` returning `{ total, deposit, balance }` — the single source of truth shared by the SAS payload and the tests. |
| `utils/` | `utils/stayPayment.js` | C | Pure `resolveStayPayment({ paidInput, cashInput, prev… , today })` → `{ paid, cash, date }` per bucket, mirroring `utils/complementPayment.js`. Unit-testable, no DB. |
| `utils/` | `utils/receptionView.js` | T | New `toReceptionStayPayment()` (returns the `{ applicable: false }` shell) + `toReceptionSasCommit()` dropping `stayPaid` / `stayPaidCash`. |
| `utils/` | `utils/sasAudit.js` | T | Two new labelled fields (« Acompte encaissé », « Solde encaissé ») in `SAS_FIELD_LABELS` + `buildSasSnapshot`, with the caisse-interne mention in the text. |
| `database.js` | `database.js` | T | Idempotent migration block: 4 columns (§5). |
| `schema.sql` | `schema.sql` | T | Same 4 columns on the baseline `reservations` table, so a fresh DB matches production. |
| `middleware/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none) |

**Notes:**
- No new dependency.
- The contribution capture is the one non-obvious coupling: it must run **inside** the SAS transaction
  and **after** the complement lines are written (SAS lines are `inComplement = 1` → their contribs stay
  NULL, so the conservation invariant on acompte/solde is unaffected).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/sas/` | `components/sas/ReservationSasDialog.jsx` | T | New `stayPayment` step (key, icon `PaymentsIcon`, title « Séjour ») inserted after the caution steps; `stayPayMode` state (`'later' \| 'card' \| 'cash'`, default `'later'`) reused by the step and the recap block; re-open pre-fill from the payload flags; commit maps the mode → `stayPaid` / `stayPaidCash`; recap « Séjour » block + « Total à percevoir à l'arrivée ». |
| `components/sas/` | `components/sas/SasStayPaymentPage.jsx` | C | The step's body: hero amount, the per-bucket lines, the OTA warning, the mode buttons. Feature-local (SAS money semantics), same footing as `SasResourceSchedulingPage`. |
| `components/reservation/` | `components/reservation/FinanceSection.jsx` | T | « Caisse interne ✓ » marker on the acompte / solde buttons; un-ticking a bucket clears its cash flag (rule 20). |
| `pages/` | — | — | (none) |
| `services/` `api.js` | — | — | (none — the two SAS endpoints are unchanged in shape) |
| `utils/` `constants/` `styles/` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Stack` / `Typography` / `Button` / `Alert`, the dialog's existing `PaymentModeButtons` | `PaymentModeButtons` is reused verbatim with a third label variant (« Pas maintenant » in place of « En fin de séjour ») — it already takes its defer slot as a prop-driven option. |
| **Created (new generic)** | — | Nothing here is reusable outside the SAS. |
| **Specific (kept feature-local)** | `SasStayPaymentPage` | Renders one SAS step: channel-aware copy + bucket lines + settlement. Not a candidate for generification — it is the SAS's money grammar, not a layout. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/sas` | — | `{ …, stayPayment: { applicable, total, deposit: { amount, applicable, settled, due, owned, collectible }, balance: {…}, channel: 'direct'\|'platform', platformLabel, paid, paidCash } }` | Additive. Reception-only → `{ applicable: false }`, no amounts. `collectible` = still owed **plus** what this SAS already collected, so a re-opened wizard shows the amount it took instead of 0 €; `owned` = the `*PaidAtArrival` marker. |
| POST | `/api/reservations/:id/sas/arrival` | `{ …, stayPaid?: boolean, stayPaidCash?: boolean }` | `{ ok, complementAmount, eveningSupplement }` | Additive, tri-state: `stayPaid` absent = the step never ran → the stay buckets are untouched. Reception-only → both fields dropped. No new error shape: a contribution capture that fails is logged, not raised (rule 13). |

Auth: admin session for the stay fields; the endpoints' existing auth and reception allowlist are
unchanged.

---

## 5. Data model

Four new `reservations` columns, all `INTEGER NOT NULL DEFAULT 0`:

| Column | Meaning |
|---|---|
| `depositPaidCash` | The acompte was collected in the caisse interne (off the books). |
| `balancePaidCash` | Idem for the solde. |
| `depositPaidAtArrival` | This acompte was settled by the arrival SAS (ownership marker, rule 14). |
| `balancePaidAtArrival` | Idem for the solde. |

Migration: one idempotent `PRAGMA table_info` + guarded `ALTER TABLE … ADD COLUMN` block in
`database.js`, mirrored into `schema.sql` (baseline, [migrations-baseline.md](migrations-baseline.md)).

**Data impact:** none on existing rows — every column defaults to 0, which is exactly « paid the
ordinary way / not settled by the SAS ». No backfill. No existing amount, flag or accounting entry
changes; a reservation untouched by the new step behaves bit-for-bit as before.

## 6. UI / UX

### « Séjour à régler » step

```
┌──────────────────────────────────────────┐
│ ▸ Séjour                    Étape 3/8  ✕ │   ← header band, arrival orange
├──────────────────────────────────────────┤
│                 [ 💶 ]                    │
│            Séjour à régler                │
│                                           │
│  ⚠ Ce solde est versé par la plateforme   │   ← OTA only
│    après le séjour. À n'encaisser que si  │
│    le client paie sur place.              │
│                                           │
│              480,00 €                     │   ← kpiValue role, tabular
│         Acompte : 120,00 €                │   ← only when both buckets unpaid
│         Solde   : 360,00 €                │
│                                           │
│  Règlement du séjour                      │
│  [ CB / Chèque ][ Payé en liquide ]       │
│  [ Pas maintenant ]                       │
│  Le séjour reste dû (rien n'est encaissé).│   ← caption under the active mode
├──────────────────────────────────────────┤
│                            [ Suivant ]    │
└──────────────────────────────────────────┘
```

The hero block (label + amount + bucket lines) is **centred under the step icon**, like the « Code
portail » page — the amount is the whole point of the page.

French copy:
- Title: « Séjour à régler ».
- Captions per mode: « Encaissé par CB ou chèque. » / « Encaissé en caisse interne (hors
  comptabilité). » / « Le séjour reste dû (rien n'est encaissé). »
- OTA warning: « ⚠ Ce solde est versé par la plateforme après le séjour. À n'encaisser que si le client
  paie sur place. »
- Recap block header: « Séjour » ; total line: « Total à percevoir à l'arrivée ».

**Responsive:** the step inherits the SAS dialog shell — `fullScreen` on `xs`, centred dialog on `sm+`.
The three mode buttons are **full-width stacked on `xs`**, side-by-side from `sm`, touch targets
≥ 44 px, exactly like the existing recap buttons. The hero amount scales down on `xs`
(`fontSize: { xs: '2rem', sm: '2.6rem' }`) so a 4-digit total never wraps. No horizontal scroll.

**Empty / error states:** the step is simply absent when there is nothing to collect. A commit rejected
by the contribution capture (409) surfaces the SAS's existing error snackbar and leaves the wizard open
on the recap — nothing is written.

**PageActionBar:** not applicable — this is a step inside the SAS dialog, not a page. The dialog's own
header (title + progress + ✕ = Quitter) and pinned footer actions are unchanged.

## 7. Test plan

### Server unit tests (`cd server && npm test` — 3 713 ✅, +33)
- [x] `tests/stay-payment-resolve.unit.test.js` (new, 9) — `resolveStayPayment`: the step never ran →
      nothing written; settling stamps today; cash flag; a non-applicable bucket untouched; a bucket
      paid OUTSIDE the SAS never re-stamped nor cleared; a re-commit keeps the original date and may
      still correct the mode; « Pas maintenant » undoes only our own.
- [x] `tests/sas-stay-payment.unit.test.js` (new, 11) — `commitArrivalSas` end to end: « CB / Chèque »
      settles the solde with today's date + the marker **and captures the contribs**; « Payé en
      liquide » sets the cash flag; both unpaid buckets settle together with a correct acompte→solde
      capture chain; an acompte paid before the check-in keeps its date and gets no marker; a disabled
      acompte is skipped; « Pas maintenant » on a re-open reverts only the marked bucket and clears its
      contribs; a re-commit keeps the paid date; `stayPaid` absent leaves the buckets alone while the
      rest of the check-in commits; a stay whose stored solde disagrees with the engine is **still
      collected**, contribs NULL, check-in preserved (rule 13); `releaseStayBucket` drops the marker
      and the cash flag.
- [x] `tests/reservation-settlement.unit.test.js` (+5) — `stayDueAtArrival`: last-minute solde, both
      buckets, GROSS (commission not netted), disabled acompte / fully paid stay; a cash-settled bucket
      is `settled`, out of `remainingToPay` and out of `comptaCollected`.
- [x] `tests/accounting-encaissements-integration.unit.test.js` (+2) — a cash solde emits **no**
      encaissement; a cash acompte does not stop the solde from booking normally.
- [x] `tests/finance-model.unit.test.js` (+3) — matrix: a cash séjour is out of the turnover, out of
      « encaissé » and settled; a cash acompte leaves only the solde counted; a cash solde on a
      platform booking takes **its own commission** with it (no negative turnover), invariant
      `encaissé + reste = total` asserted on each.
- [x] `tests/reception-view.unit.test.js` (+3) — `toReceptionStayPayment` carries `applicable: false`
      and **no other key**; `toReceptionSasCommit` drops `stayPaid` / `stayPaidCash` and passes the
      rest of the check-in through; an empty body does not throw.

### Client tests (`cd client && npx vitest run` — 1 156 ✅, +6)
- [x] `components/sas/__tests__/ReservationSasDialog.test.jsx` — the step is absent when nothing is
      owed; « CB / Chèque » → `stayPaid: true, stayPaidCash: false`; « Payé en liquide » → both true;
      « Pas maintenant » (the default) → `stayPaid: false`; the OTA warning renders on
      `channel: 'platform'`; a re-opened SAS shows the amount it collected + its mode and can undo it;
      the recap shows the « Séjour » block, « Total complément » and the combined arrival total, with
      two independent settlement rows.
- [x] The pre-existing exact-payload test now pins `stayPaid: undefined` on a stay that owes nothing.

### E2E (`npm run test:e2e`)
- [x] 65 passed, 1 skipped — no regression on the existing flows.

### Manual UI verification (dev server, real data, 2026-08-30)
- [x] Direct (Lodgify) stay put back to unpaid: the step appears at « Étape 4/9 » with the hero amount
      313,48 €, three buttons, « Pas maintenant » pre-selected.
- [x] « Payé en liquide » → recap « Récapitulatif — à percevoir » with « Séjour : 313,48 € », its own
      settlement row and the caisse-interne caption → commit `200` → the payload comes back
      `paid: true, paidCash: true, owned: true, settled: true`.
- [x] Re-open: the mode is pre-selected on « Payé en liquide » and the amount is still 313,48 € (not
      0 €) → « Pas maintenant » → commit `200` → back to unpaid, marker cleared.
- [x] OTA arrival (Booking, 140,97 €): the warning renders above the amount, nothing pre-selected.
- [x] Prepaid stay: no step (verified through `stayPayment.applicable = false` on the live payload).
- [x] Mobile 390×844: buttons full-width stacked, amount not wrapped, **0 px** horizontal overflow.
- [x] The reservation used for the test was restored to its prior state (see §9).

## 8. Out of scope

- **Partial payments.** A bucket is paid or it is not; the step collects the whole `stayDue`. An
  operator taking half the stay at the door still splits it by hand on the fiche.
- **A new payment-method / Stripe model** — direct bookings stay modelled as a platform commission
  (decision 2026-06-22).
- **The dashboard's red « Paiements » alert**, which deliberately ignores the deposit/balance
  ([dashboard-collection-alert.md](dashboard-collection-alert.md) rule 3). An unpaid stay still does not
  turn a row red; this spec adds the *means to collect*, not a new alert.
- **Collecting the stay at check-out.** The departure SAS keeps recalling the arrival *complement* only.
- **The pre-existing reception leak**: `GET /reservations/:id/sas` returns the reservation row with
  `SELECT r.*` ([reservationsModel.js:709](../server/src/models/reservationsModel.js#L709)), so
  `depositAmount` / `balanceAmount` / `finalPrice` are already in the payload of a reception-only user,
  contrary to what [reception-role-checkin-only.md](reception-role-checkin-only.md) §3.5 claims. This
  spec does not widen it (its own `stayPayment` block is stripped, rule 24) and does not fix it —
  worth its own small spec.

## 9. Open questions

Resolved during scoping (2026-08-30):
- **Which reservations get the step?** → **any unpaid stay, whatever the channel**, with an explicit
  warning on OTA arrivals (§3.2 rules 6 and 9).
- **Which amount?** → **the whole remaining stay** (acompte + solde still unpaid), gross.
- **Which settlement modes?** → **CB / Chèque + Payé en liquide (caisse interne)**, plus the
  « Pas maintenant » default.
- **Where in the SAS?** → **a dedicated page** before the recap **plus** a « Séjour » block on the recap.
- **What does « caisse interne » mean for a whole stay?** → **out of the accounting AND out of the
  turnover**, like the complements, preserving the settlement invariant (§3.4 rules 17-18).
- **Reception role?** → **admin only**: the step is not served and its commit fields are dropped (§3.6).

Resolved during implementation (2026-08-30):
- **What if the per-bucket contribution capture fails?** → **collect anyway, contribs left NULL**
  (rule 13). Measured on the production copy: **6 of the 8 unpaid stays fail the conservation
  invariant**, because the stored solde is the platform's figure while the engine re-derives another
  number — and the fiche's own quick toggle already returns 409 on those same rows, while the full
  fiche save has always written the flag with no capture at all. Refusing the check-in would have made
  the step unusable in practice for something the operator cannot fix at the door.
- **Does a fiche save release the SAS markers?** → **only a real flip does** (rule 15). Clearing them
  on every save would silently pull a stay collected in the caisse interne back into the accounting.

**Dev-database note (2026-08-30):** the manual verification ran on reservation 22272 of the dev copy.
Everything it touched was restored through the application's own endpoints (solde back to « payé le
17/08 », caution and check-in flags cleared) **except `arrivalSasDoneAt`**, which no app path can
un-set: that August arrival keeps a green ✓ on its planning card in dev only.
