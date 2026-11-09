# One payment, several methods

| Field | Value |
|---|---|
| **Status** | Implemented (2026-11-09) |
| **Branch** | `feature/mixed-method-payments` (from `inte/plugins`) |
| **Created** | 2026-11-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary page** | [docs/specs/2026-11-08-mixed-method-payments.html](../docs/specs/2026-11-08-mixed-method-payments.html) — interactive mock, 390 and 1280 px |

---

## 1. Context

On 2026-11-08 the guests of the day took the end-of-stay cleaning at check-out and paid part of it in
cash and the rest by card. GuestFlow cannot record that.

Today each payment bucket of a reservation is a set of flags on `reservations`
(`<bucket>Paid`, `<bucket>PaidDate`, `<bucket>PaidCash`; `server/src/schema.sql`), and the only
« method » a bucket knows is the boolean `*PaidCash` = caisse interne (off the books). « CB / Chèque »
is stored nowhere: it only means `cash = 0`. One bucket is therefore either wholly on the books or
wholly in the caisse interne. The same holds for the single arrival payment (`arrivalPaymentGroup.cash`),
the mid-stay notes (`midStaySettledNotes[].paidCash`) and the SAS commits (`PaymentModeButtons`,
single-select). Only the installments carry a real `paidMethod`, still one per installment.

[reservation-payment-ledger.md](reservation-payment-ledger.md) §8 and Q2 explicitly left a per-payment
method out. This spec revisits that decision for the payments the operator records by hand, without
changing the ordinary one-click path.

**Benchmark (HIPPOCAMP, relevé of 2026-11-05).** A payment hangs off an invoice; a mixed payment is
entered as several successive payments, one per method (« Saisir un autre mouvement »), against a
configurable list of methods (Espèces and Chèque flagged as going through the till). A payment line
can be edited or deleted until the till is closed. Entry is always visible. We keep the idea « one line
per method » but enter all the lines in one gesture, with the remainder filled automatically, and keep
the whole thing out of sight until asked for.

**Decisions (AskUserQuestion, 2026-11-08):**
- D1 — Access: a **discreet « Plusieurs moyens » control** next to every manual mark-paid gesture; nothing
  changes otherwise.
- D2 — A cash line goes to the **caisse interne by default**, switch available to put it on the books.
- D3 — ~~The lines must add up exactly to the amount due; no partial payment.~~ **Revised 2026-11-09 by
  D6.**
- D4 — **Fixed list** of methods: CB, Espèces, Chèque, Virement, Chèques-vacances, Autre.

**Feedback of 2026-11-09 (Adrien, on the summary page):**
- D5 — A recorded split payment **can be modified** afterwards, to correct a mistake.
- D6 — When the lines do not cover the amount due, the form **warns** and asks what becomes of the
  amount not received, instead of refusing.

## 2. Goal

When a guest settles one amount with several methods (cash + card, cheque + cash…), the operator
records it in one gesture where they already mark payments, says which part went to the caisse
interne, decides what happens to any amount not received, and can correct the record later. The
books, the bank reconciliation and the finance figures count exactly the part that went on the books.

## 3. Functional rules

### 3.1 Scope

1. A **split payment** (a *settlement*) is a manual payment recorded as 1 to 4 **tender lines**, each
   one `{ method, amountCents, internal }`, at one date. It is available on every target the operator
   marks by hand:
   - a ledger bucket of the fiche: acompte, solde, complément d'arrivée, fin de séjour;
   - the single arrival payment (« Encaisser en une fois », fiche and SAS);
   - the SAS departure settlement of the complements;
   - a mid-stay note settled from `MidStayNoteDialog`;
   - an installment of the direct-booking schedule.
2. Never available on a payment-link payment, a platform payout, a refund or the caution: the money
   did not change hands at the desk.
3. The ordinary gestures are unchanged: « Valider », « CB / Chèque », « Caisse interne », « Payé en
   liquide » keep writing exactly what they write today and create no settlement.

### 3.2 Methods

4. Fixed list, server-owned (`utils/paymentTenders.js`), in this order:
   `card` « CB », `cash` « Espèces », `cheque` « Chèque », `transfer` « Virement »,
   `holidayVoucher` « Chèques-vacances », `other` « Autre ». The client receives value + label from
   the ledger payload; it holds no list of its own.
5. `internal` (caisse interne) is accepted only on a `cash` line. A `cash` line is proposed with
   `internal = true` (D2); the switch puts it on the books.

### 3.3 Amounts

6. Every line is > 0 and in cents. Their sum is the **amount received**. Against the amount the target
   owes (`expectedAmountCents`, the same figure the ordinary mark already checks):
   - **equal** → the target is settled;
   - **lower** → the gap is a **shortfall**, handled by §3.5 — never silently;
   - **higher** → refused: « Les moyens font 130,00 € pour 122,00 € dus. » The form stays open with the
     typed values.
7. Entry is proposed with two lines: `cash` (empty, focused) then `card`. The **last line takes the
   remainder** while the operator types in the others; typing in the last line itself freezes it and
   the remainder moves to the meter. The meter under the lines reads « Reste 0,00 € » (covered),
   « 8,00 € non couverts » (shortfall, §3.5) or « 8,00 € de trop » (submit disabled). This running
   difference is a UX hint; rule 6 is the authority.
8. Two lines with the same method and the same `internal` are refused (« Une seule ligne CB. »): the
   operator adds to the existing one.
9. The arithmetic already accepted in amount fields (`evaluateArithmetic`: `40+10`) is accepted in a
   line.

### 3.4 What a settlement writes

10. A settlement is one `payment_settlements` row (target, date, amount due, shortfall and its
    disposition, and `parts`: the buckets it paid, frozen with their amounts) and its `payment_tenders`
    rows. The lines are validated **before** the ordinary gesture runs (same endpoint, same guards:
    `paymentMarkRefusal`, locked fiche, D20 end-of-stay after departure, etc.); the settlement is written
    right **after** it, on the buckets that gesture just paid. Should that write fail, the gesture is
    undone. The target is marked paid with the settlement's date.
11. The target's existing caisse-interne flag (`*PaidCash`, group `cash`, note `paidCash`) is set to 1
    **only when every line is internal and there is no shortfall left to collect**, so a split that is
    entirely in the caisse interne is indistinguishable from today's « Caisse interne ». Otherwise it is
    0 and the internal share lives in the tender rows.
12. An installment paid by a settlement gets `paidMethod = 'mixed'`; its lines live in `payment_tenders`.
13. Undoing the mark (any existing undo path, « Annuler l'encaissement », the SAS re-committed, the bank
    reconciliation's « Défaire », a group dissolved, a note cancelled) deletes every settlement of the
    target and their lines: the model's writes that can take a payment back re-check the settlements of
    the stay (`sync`), so no undo path has to know about them.
14. `reservation_history` records each settlement in one entry:
    « Fin de séjour payée le 08/11/2026 : Espèces 50,00 € (caisse interne) · CB 72,00 € ».

### 3.5 Amount not received (D6)

15. When the lines are lower than the amount due, an inline warning appears under the meter, before
    submitting: « 8,00 € ne sont pas couverts. » with two choices, one of which must be picked before
    « Encaisser 114,00 € » is enabled:
    - **« Reste à percevoir »** — « La fiche garde 8,00 € à encaisser plus tard. »
    - **« Geste commercial »** — « 8,00 € accordés, enregistrés en réduction. »
    Correcting the amounts so that they cover the total removes the warning and the choice.
16. **Reste à percevoir.** The target is marked paid (rule 10) and the settlement keeps
    `shortfallCents` with `shortfallKind = 'due'`. The target is **not settled**: `remainingToPay`
    includes the shortfall, `isSettled` is false while any shortfall is due, the fiche row reads
    « Perçu en partie » with a line « Reste à percevoir 8,00 € » and its own « Marquer payé ».
17. Collecting the remainder opens the same lines (one line proposed, `cash` with the remainder) and
    records a **second settlement** on the same target, at its own date (its own accounting month). Its
    amount due is the remaining shortfall; it can itself leave a shortfall (rule 15). When the
    shortfall due reaches 0, the target is settled.
18. **Geste commercial.** The settlement keeps `shortfallCents` with `shortfallKind = 'waived'`; the target
    is settled. The waived amount is a **« Réduction accordée »**, the same movement as the single arrival
    payment's réduction ([arrival-payment-detail-and-adjustment.md](arrival-payment-detail-and-adjustment.md)
    rules 10, 20, 24): `comptaCollected` and the turnover subtract it, and the books get a rabais entry
    (crédit client / débit `70900000` + TVA at the stay's rate) at the settlement date. Its share on the
    books is `waived × booksCents / receivedCents`; a settlement entirely in the caisse interne books no
    réduction. Tourist-tax reporting is untouched (rule 29). On a single arrival payment split over several
    methods, the geste commercial replaces the existing « Total encaissé » adjustment: `mode: 'adjust'`
    is refused there (« Ce paiement est réparti sur plusieurs moyens : modifiez-le plutôt. »).
19. The fiche shows the réduction under the settlement: « Geste commercial 8,00 € ».

### 3.6 Modifying a settlement (D5)

20. A paid row that has settlements shows **« Modifier »** next to « Annuler l'encaissement ». It reopens
    the lines prefilled with the recorded date, methods, amounts, caisse-interne switches and shortfall
    choice. « Enregistrer » replaces the settlement — date, lines, shortfall and its disposition — in one
    transaction; the meter, the warning and the choices behave as at entry.
21. When a target has several settlements (rule 17), each one is modified on its own; the amount due of
    a remainder settlement stays the shortfall it collects.
22. Modifying is refused wherever undoing would be refused (bank reconciliation already matched to the
    card line, closed-stay rules…), with the same message.
23. When the date moves to another month, the form warns as the ordinary form already does:
    « Le mois comptable change : 11/2026 → 12/2026. »
24. `reservation_history` records the correction as one entry, before → after:
    « Fin de séjour corrigée : Espèces 50,00 € (caisse interne) · CB 72,00 € → Espèces 40,00 € (caisse
    interne) · CB 82,00 € ».
25. Turning a « Reste à percevoir » into a « Geste commercial » (or back) is a modification like any
    other. Modifying the first settlement so that it covers the whole amount while a remainder
    settlement exists is refused: « Un reste a déjà été encaissé le 10/11 : modifiez-le d'abord. »

### 3.7 What the money counts for

The stay's row carries four aggregates refreshed on every settlement write (the installments' pattern):
`splitOffBooksAmount` (cash lines in the caisse on a payment otherwise on the books), `splitWaivedAmount`,
`splitWaivedCashAmount` (geste commercial on a payment entirely in the caisse) and `splitShortfallDue`.
The settlement rules of `utils/reservationSettlement.js` (`comptaCollected`, `cashCollected`,
`remainingToPay`, `isSettled`) and the turnover read them, so no reader keeps its own copy of the rule;
the readers that list payments one by one (accounting export, « Encaissé » table, bank reconciliation)
read the settlements themselves (`utils/paymentTenders.settlementFigures`).

26. **Books (accounting export, encaissements by month, VAT):** one encaissement per settlement, at its
    date, of its books share of what it covers: `booksCents + booked réduction` — gross of the réduction,
    exactly like the single arrival payment, whose réduction entry (rule 18) then brings the client
    account back to the money received. When that share is lower than what the settlement covers, each
    revenue line of the target (accommodation, options, tourist tax, as already allocated by
    `complementPaidSplit` / `paidSplit`) is prorated; the last line absorbs the rounding cent.
    `booksCents = 0` → no entry (today's caisse interne).
27. **Finance figures:** `comptaCollected` and « Déjà payé » count `booksCents` (the encaissement minus
    its réduction: the money received on the books);
    `cashCollected` counts `internalCents`; `remainingToPay` counts `shortfallDueCents`; `isSettled`
    follows rule 16. `totalSejour` (turnover declared) excludes `internalCents` and the réduction.
28. **Bank reconciliation (`expectedReceipts`):** the expected bank receipt of a settlement is the sum of
    its `card`, `cheque` and `transfer` lines. `cash` (books or internal), `holidayVoucher` and `other`
    lines are not expected at the bank.
29. **Tourist tax reporting is unchanged**: it is computed from the stay, never from how it was paid.

### 3.8 Display

30. A paid ledger row with settlements shows, under its state label, one muted line per tender in entry
    order (« Espèces 50,00 € · caisse interne », « CB 72,00 € »), then « Geste commercial 8,00 € » when
    there is one. A reste still due is not repeated in the lines: it is the « Reste à percevoir 8,00 € »
    block of rule 16, with its « Marquer payé » (browser check of 2026-11-09). Its state reads « Perçu le
    08/11 · plusieurs moyens », or « Perçu en partie » while a reste is due; the lines sit under « Moyens de
    paiement » so the date is not said twice. A remainder settlement is listed under the first, headed
    « Reste perçu le 10/11 ». Rows without settlements are unchanged.
31. The SAS recap and the mid-stay note history show the same lines.

### 3.9 Access (D1)

32. The split is **never shown by default**. Its only entry at payment time is a low-emphasis text button
    « Plusieurs moyens » placed after « Annuler » in each manual payment form listed in rule 1. It
    appears only once the operator has already started marking (the form is open, or the SAS payment
    step is on screen), so a fiche at rest shows nothing new. « Modifier » (rule 20) and the remainder's
    « Marquer payé » (rule 16) only exist on rows that already have a settlement.
33. Opening it replaces the form's single choice (caisse interne switch, method select, or the mode
    buttons) by the tender lines, in place — no dialog. « Un seul moyen » closes them and restores the
    ordinary form with the date kept.

**Edge cases:**
- All lines `cash` + internal, no shortfall → same storage as « Caisse interne » + settlement (rule 11).
- A single line equal to the amount due → accepted; it records the method (« Chèque 122,00 € »).
- Amount due changes between opening and submitting (another tab) → the server refuses on
  `expectedAmountCents` exactly as today; the form shows the new amount and keeps the lines.
- Amount due changes after a « Reste à percevoir » (an option added later) → the shortfall due is
  recomputed as `dueCents − receivedCents − waivedCents` of the target; never negative (an amount lowered
  below what was received is the existing overpayment path).
- 0,01 € residue after typing `61,005` → amounts are rounded to the cent on input; the meter shows the
  real remainder.
- Platform reservation complement paid at the desk (`isDirectChannel` false) → allowed: it is a desk
  payment, not the platform payout.
- The single arrival payment of the SAS is split only as the unified payment (one amount asked), never
  with an installment plan (the plan's installments are each recorded with their own method).
- A SAS commit that settles another total than its recap showed re-checks the lines on what it really
  settled; when they no longer fit, the ordinary payment stands and the answer says
  « Paiement enregistré sans le détail des moyens : le total a changé. Le corriger depuis la fiche. »

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` / `schema.sql` | both | T | `payment_settlements` + `payment_tenders` tables + indexes (§5) |
| `utils/` | `paymentTenders.js` | C | Method list + labels; `validateSettlement` (rules 4-9, 15); `settlementFigures` / `targetFigures` / `reservationAggregates` (rules 16-18, 26-28); history wording (rules 14, 24). Pure, unit-tested |
| `utils/` | `paymentSettlementsMigration.js` | C | The two tables and the four `reservations` aggregates, idempotent |
| `utils/` | `paymentSettlementService.js` | C | The one writer: `prepare` (before the gesture), `flippedParts` + `record` (after it), caisse-interne flag (rule 11), `collectRemainder` (rule 17), `modify` (rules 20-25), history |
| `models/` | `paymentSettlementsModel.js` | C | Settlements and their lines; `sync(reservationId)` drops the settlements whose target is no longer paid and refreshes the aggregates |
| `controllers/` | `paymentSettlementsController.js` | C | Thin HTTP for the remainder and the modification |
| `models/` | `reservationsModel.js`, `installmentsModel.js` | T | Every write that can take a payment back calls `sync` |
| `utils/` | `refundUntickGuard.js` | T | A payment taken back no longer subtracts its settlement's caisse share |
| `plugins/sdk/` | `index.js`, `coreModules.json`, `coreModuleHistory.json`, `version.js` | T | SDK 2.24.0: `paymentTenders`, `paymentSettlementsModel`, `paymentSettlementService` ([plugins-phase-1-sdk.md](plugins-phase-1-sdk.md) rule 42); `accounting-export` 1.1.0, `online-payment` 1.6.0, `sas` 1.8.0 ask for `^2.24.0` |
| `routes/` | `reservations.js` | T | Two routes for the controller above (§4.3) |
| `controllers/` | `reservationsController.js` | T | `updatePayment`, `settleArrivalPayment`: accept optional `tenders` + `shortfall`, write the mark and the settlement atomically; undo deletes settlements |
| `controllers/` | `installmentsController.js` | T | Installment payment accepts `tenders`, writes `paidMethod = 'mixed'` |
| `models/` | `reservationsModel.js` | T | Mid-stay note settle/undo carry `tenders`; settlements deleted with the note |
| `plugins/sas/` | `controller.js` | T | Arrival `arrivalPaymentMode: 'split'` + departure `complementsTenders`; same validation |
| `utils/` | `reservationLedger.js` | T | `action.split: { dueCents, methods }` on markable rows; paid rows carry `settlements[]` with lines, shortfall and `canModify` / `modifyRefusal` |
| `utils/` | `reservationSettlement.js` | T | `comptaCollected`, `cashCollected`, `remainingToPay`, `isSettled` read the aggregates |
| `models/` | `financeModel.js`, `financeDashboardModel.js` | T | Turnover through the aggregates; the « Encaissé » table lists one row per settlement |
| `plugins/accounting-export/` | `accountingModel.js`, `accountingExport.js` | T | Encaissement = `booksCents` per settlement, prorated lines (rule 26); réduction entry reusing `discountEntryToRows` (rule 18) |
| `plugins/online-payment/reconciliation/` | `expectedReceipts.js` | T | Expected receipt = card + cheque + transfer lines per settlement (ledger key `settlement-<id>`), the bucket it paid not expected again (rule 28) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `TenderLines.jsx` | C | The tender lines + meter + shortfall warning and its two choices + « Ajouter un moyen », controlled; renders server labels |
| `components/reservation/` | `PaymentMarkForm.jsx` | T | « Plusieurs moyens » / « Un seul moyen » toggle; sends `tenders` + `shortfall` |
| `components/reservation/` | `FinanceSection.jsx` | T | « Encaisser en une fois » block gets the same toggle; paid rows render settlements, « Modifier », the remainder's « Marquer payé » |
| `components/reservation/` | `InstallmentPlanCard.jsx`, `MidStayNoteDialog.jsx` | T | Same toggle in their payment step |
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | « Plusieurs moyens » under `PaymentModeButtons` (arrival and departure) |

**Client-side computation, justified:** the running remainder and the decision to show the shortfall
warning (rules 7, 15) are a subtraction over the typed fields, shown as a UX hint so the operator sees
where they stand before submitting. They never decide anything: the server re-validates every line and
the disposition (rules 6, 15-18) and the persisted figures all come from the settlements and the stay's aggregates.

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `DateField`, `Switch`, `evaluateArithmetic` | |
| **Created (new generic)** | `TenderLines` | Used by 5 surfaces (fiche row, arrival block, installment, mid-stay note, SAS) and by the modification and remainder forms |
| **Specific** | — | |

### 4.3 API contract

The write paths below accept an optional `tenders` array and, when the lines are lower than the amount
due, a mandatory `shortfall`. When `tenders` is absent behaviour is unchanged.

```json
"tenders": [
  { "method": "cash", "amountCents": 5000, "internal": true },
  { "method": "card", "amountCents": 6400, "internal": false }
],
"shortfall": { "kind": "due" }
```

| Method | Endpoint | Change |
|---|---|---|
| PATCH | `/api/reservations/:id/payment` | `tenders` (+ `shortfall`) with `flag: true` (acompte, solde, complément, fin de séjour, mid-stay note settle) |
| POST | `/api/reservations/:id/arrival-payment` | `mode: 'split'` + `tenders` (+ `shortfall`) |
| POST | `/api/reservations/:id/installments/:installmentId/payment` | `tenders` instead of `method` (+ `shortfall`) |
| POST | SAS arrival / departure commit (`plugins/sas`) | `arrivalPaymentMode: 'split'` + `tenders`; `complementsTenders` (+ `shortfall`) |
| POST | `/api/reservations/:id/settlements` | **new** — collect a remainder: `{ target, date, tenders, shortfall? }` (rule 17) |
| PUT | `/api/reservations/:id/settlements/:settlementId` | **new** — modify: `{ date, tenders, shortfall? }` (rules 20-25) |
| GET | `/api/reservations/:id` (and the quote) | `ledger` rows (`ledgerFor` → `buildLedger`) gain `action.split` and paid `settlements[]` |

Refusals: `400 { error, field: 'tenders' | 'shortfall' | 'date' }`, French message naming the problem
(rules 6, 8, 15, 18, 25); `409` with the undo guard's message (rule 22). Same role guard as the existing
payment routes.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS payment_settlements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId  INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  targetKind     TEXT NOT NULL CHECK (targetKind IN ('bucket','arrivalGroup','midStayNote','installment')),
  targetKey      TEXT NOT NULL,          -- bucket name, note id, installment id; 'arrival' for the group
  paidDate       TEXT NOT NULL,          -- YYYY-MM-DD, its accounting month
  dueCents       INTEGER NOT NULL CHECK (dueCents > 0),
  shortfallCents INTEGER NOT NULL DEFAULT 0 CHECK (shortfallCents >= 0),
  shortfallKind  TEXT CHECK (shortfallKind IN ('due','waived')),
  createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt      TEXT,
  CHECK ((shortfallCents = 0) = (shortfallKind IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_payment_settlements_target ON payment_settlements(reservationId, targetKind, targetKey);

CREATE TABLE IF NOT EXISTS payment_tenders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  settlementId INTEGER NOT NULL REFERENCES payment_settlements(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,         -- entry order, for display
  method       TEXT NOT NULL CHECK (method IN ('card','cash','cheque','transfer','holidayVoucher','other')),
  amountCents  INTEGER NOT NULL CHECK (amountCents > 0),
  internal     INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1) AND (internal = 0 OR method = 'cash'))
);
CREATE INDEX IF NOT EXISTS idx_payment_tenders_settlement ON payment_tenders(settlementId);
```

- `parts TEXT NOT NULL DEFAULT '[]'` on `payment_settlements`: the buckets the settlement paid,
  `[{ kind, key, amountCents }]`, frozen at the write (a complement that carried the end of stay, the
  buckets of a single arrival payment).
- `reservations` gains `splitOffBooksAmount`, `splitWaivedAmount`, `splitWaivedCashAmount`,
  `splitShortfallDue` (`REAL NOT NULL DEFAULT 0`, euros).
- Idempotent creation in `database.js` (`utils/paymentSettlementsMigration.js`); the tables are in
  `schema.sql` too. No backfill: existing payments have no settlement and their aggregates are 0.
- `reservation_installments.paidMethod` gains the value `'mixed'` (no CHECK on that column today).
- **Data impact:** additive only. No existing row changes.

## 6. UI / UX

See the summary page for the interactive mock (fiche row, SAS departure, modification, shortfall;
390 / 1280 px).

- **Fiche, ledger row** — « Marquer payé » opens `PaymentMarkForm` as today. After « Annuler », a text
  button « Plusieurs moyens » (text.secondary, no border). Clicked: the caisse-interne switch is
  replaced by the lines; the date stays on top; « Valider » becomes « Encaisser 122,00 € ».
- **A line** — method as a native select (6 entries, server labels), amount field (`inputMode=decimal`,
  16 px to avoid iOS zoom, tabular numerals), on a cash line a « Caisse interne » switch (on), a
  remove button (44×44) from the second line on. The auto line shows its amount in text.secondary with
  « reste » until typed in.
- **Meter** — one line, `aria-live="polite"`: « Reste 0,00 € » success colour; « 8,00 € non couverts »
  warning colour; « 8,00 € de trop » error colour, submit disabled.
- **Shortfall warning** — inline, warning-soft background, under the meter: « 8,00 € ne sont pas
  couverts. » then two selectable cards side by side (stacked on `xs`), each a 44 px+ target with a
  title and one line of explanation. The submit button reads « Encaisser 114,00 € » and stays disabled
  until one is picked.
- **Paid row** — « Perçu le 08/11 · plusieurs moyens » (or « Perçu en partie » with a warning badge when
  a remainder is due), one muted line per tender, then the shortfall line. Actions: « Modifier »
  (text button), « Annuler l'encaissement » (quiet), and for a remainder « Marquer payé » (outlined).
- **Modification** — the same form, prefilled, inline on the row; « Enregistrer » / « Annuler ».
- **SAS** — « Plusieurs moyens » is a text button under the mode buttons; the lines open below them,
  the commit button reads « Encaisser 122,00 € ».
- **Responsive** — `xs`: one line = method select full width, then the amount with the remove button,
  then the caisse-interne switch on its own row; the two shortfall cards stack; actions full-width.
  `md+`: one row per line (method · amount · switch · remove), shortfall cards side by side. The SAS
  dialog is already full-screen on `xs`.
- **Reduced motion** — the lines open with the form's existing `ledgerOpen` / `ledgerFade`.

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `tests/mixed-method-payments.unit.test.js` (17) — `validateSettlement` (over, under with and without a
      choice, 1 and 5 lines, duplicate method, caisse interne on a non-cash line, cents), settlement and target
      figures, stay aggregates, history wording (rules 4-9, 11, 14-18, 26-28).
- [x] `tests/mixed-method-payments-writes.unit.test.js` (15) — PATCH payment (fin de séjour, acompte, platform
      refusal, one at a time), the undo that takes the settlement, reste à percevoir then its collection,
      geste commercial, corrections (lines, shortfall, date, refusal 25), the single arrival payment split and
      undone (rules 1-2, 6, 10-25).
- [x] `tests/mixed-method-payments-finance.unit.test.js` (5) — `encaissé + reste à payer = total de séjour` on
      four shapes; the turnover (rule 27).
- [x] `plugins/accounting-export/tests/accounting-mixed-method-payments.unit.test.js` (5) — the books share,
      the rabais, a reste booked in its own month, all in the caisse books nothing (rules 18, 26).
- [x] `plugins/online-payment/tests/reconciliation-mixed-method-payments.unit.test.js` (2) — only card, cheque
      and transfer expected, once (rule 28).
- [x] `plugins/sas/tests/sas-mixed-method-payments.unit.test.js` (5) — the check-out SAS (rules 1, 6, 10-11, 16).
- [x] Updated: `reservation-ledger-marks` (rule 21's `split` on the marks), `route-census` baselines for the two
      routes, `plugin-core-hardening-floor` (SDK 2.24.0), the VAT golden (the four aggregates, nothing else).

### Client (Vitest)
- [x] `components/__tests__/TenderLines.remainder.test.jsx` (6), `TenderLines.shortfall.test.jsx` (4).
- [x] `components/reservation/__tests__/FinanceSection.mixed-method-payments.test.jsx` (6).
- [x] `plugins/sas/__tests__/ReservationSasDialog.mixed-method-payments.test.jsx` (3).

### Manual UI verification (2026-11-09, isolated server + client, Chromium 1280 and 390 px)
- [x] Fiche: fin de séjour 122 € → « Plusieurs moyens », 50 € espèces, CB auto-filled to 72,00 €.
- [x] 50 € + 64 € → « 8,00 € non couverts », the two choices, « Encaisser 114,00 € » enabled only once chosen;
      row « Perçu en partie », « Reste à percevoir 8,00 € » block; reste collected in cash.
- [x] « Modifier » the first payment to cover all while a reste was collected → refused with the rule 25
      message, the form kept open.
- [x] SAS de départ at 390 px: ménage 122 € → 50 € espèces + 72 € CB, « Encaisser 122,00 € », stored as one
      settlement with its two lines; no horizontal scroll on the fiche at 390 px.

## 8. Out of scope

- A configurable method list, accounting journals per method (D4).
- Cash register, till closing, bank deposit slips (HIPPOCAMP's caisse module).
- Splitting a payment-link or platform payment.
- Sending a payment link for a « Reste à percevoir ».
- Modifying an ordinary (non-split) payment: undo and redo, as today.
- A pourboire when the lines exceed the amount due (refused, rule 6).
- « Encaissements par moyen de paiement » in the accounting synthesis broken down by the new methods
  (the data will exist; the panel is a follow-up).

## 9. Open questions

- Q1: Should « Caisse interne » also be possible on a cheque line (cheque cashed outside the business
  account)? Proposed: no, cash only.
- Q2: Chèques-vacances: should they be expected at the bank (ANCV reimburses later, net of
  commission)? Proposed: not expected, like cash.
