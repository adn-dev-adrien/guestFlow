# Operational « Réservations à venir » as a payments table

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/finance-upcoming-payments-table` _(user-managed)_ |
| **Created** | 2026-06-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

In « Suivi financier » → « Suivi opérationnel », the **Réservations à venir** tab currently renders
the Planning arrival cards (`components/ReservationCard`), one per reservation — beds, family,
options, resources, complément/caution, plus the SAS arrival flow
([FinancePage.js](../client/src/pages/FinancePage.js) ~L515-544, §3.5 of
[finance-overview-rework.md](finance-overview-rework.md)).

Adrien wants the upcoming list to read like money, not like an arrival checklist: the **same payment
table as « Paiements en attente »** ([finance-operational-remaining-to-pay.md](finance-operational-remaining-to-pay.md)),
so the two operational tabs share one visual grammar. The arrival/SAS detail still lives on the
Planning page, so it is not lost — only removed from the finance view.

Separately, the **Réservations période** tab table shows reservations for the du/au range but never
states that range on the table itself, unlike the other top-right summary chips.

## 2. Goal

In « Suivi opérationnel », « Réservations à venir » is shown as the same payments table as
« Paiements en attente » (Acompte, Solde, Complément, Reste à payer, Total de séjour) **minus the
« Compl. fin de séjour » column**, and the « Réservations période » table shows its du/au range in a
chip at the top-right.

## 3. Functional rules

1. The « Réservations à venir » tab renders a table with columns, left → right:
   **Client · Logement · Séjour · Plateforme · Acompte · Solde · Complément · Reste à payer · Total
   de séjour**.
2. It uses the **same per-bucket presentation** as « Paiements en attente »: Acompte/Solde show the
   amount + due date (deposit shows « Désactivé » when `depositDisabled`), Complément uses the same
   muted-`—`/green-settled/red-owed cell, and « Reste à payer » is the server `remainingToPay`
   (red when > 0, green when 0).
3. The « Réservations à venir » table is **read-only**: no payment checkboxes and no « Tout solder »
   action column. Amount colours still reflect the paid/settled state from the payload.
4. The table has **no « Compl. fin de séjour » column** (the only column dropped vs the pending
   table).
5. A **footer totals row** sums each numeric column (Acompte, Solde, Complément, Reste à payer,
   Total de séjour) from the server-provided `upcoming.totals`.
6. The top-right summary chip of the « Réservations à venir » tab is the **green « En attente de
   paiement : X € »** chip (X = `upcoming.totals.remainingToPay`), replacing the previous blue
   « Total de séjour à venir » chip.
7. Each row click navigates to `/reservations/:id` (unchanged behaviour).
8. The « Réservations période » table shows, **top-right above the table**, a chip
   « Période du {du} au {au} » using the page's current du/au range.
9. The « Paiements en attente » tab keeps **all four buckets + checkboxes + « Tout solder »**
   unchanged (it is the interactive variant of the same shared table).

**Edge cases:**
- No upcoming reservations → « Aucune réservation à venir » (unchanged).
- `depositDisabled` row → Acompte cell shows « Désactivé », excluded from the deposit total
  (server already excludes it).
- A complement settled via caisse interne → green amount + « caisse » caption (same as pending).

---

## 4. Architecture

> **Fat backend, thin frontend.** All amounts, paid/settled states and column totals are already
> computed server-side by `financeModel.getOperational()`; the only server change is to expose the
> existing `remainingToPay` sum in the upcoming totals. The client only swaps a render shape.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/financeModel.js` | T | Add `remainingToPay` to `upcoming.totals` (same `sumBy(upcoming, 'remainingToPay')` already used for pending). Per-row `remainingToPay` is already on each enriched upcoming reservation. |
| `controllers/` | — | — | (none — payload passthrough) |
| `routes/` | — | — | (none) |
| `database.js` | — | — | (none — no schema change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/FinancePage.js` | T | Replace the upcoming-cards block with `<OperationalPaymentsTable variant="readonly" showEndOfStayComplement={false}>`; swap the upcoming chip to the green « En attente de paiement » one; add the « Période du…au… » chip above the période table; render the pending table through the same shared component (interactive). Remove the now-dead upcoming-detail machinery: `upcomingDetails` state + its `useEffect` (per-reservation `getReservation` fetch), `handleToggleReady`, the `sas` state + `ReservationSasDialog`, and the `ReservationCard` import (all only used by the old upcoming cards). |
| `components/` | `components/OperationalPaymentsTable.js` | C | New generic table for the operational payment buckets. Props: `rows`, `totals`, `interactive` (checkboxes + « Tout solder » column), `showEndOfStayComplement`, `onTogglePayment`, `onSettleAll`, `onOpenReservation`. Encapsulates the bucket cells, the footer totals row, and the row-click navigation. |
| `api.js` | — | — | (none — `getFinanceOperational` payload unchanged in shape, one added total field) |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Chip`, `Table*` (MUI) | — |
| **Created (new generic)** | `OperationalPaymentsTable` | Generic: drives **both** « Paiements en attente » (interactive, 4 buckets) and « Réservations à venir » (read-only, 3 buckets) from one implementation. The `PaymentBucketAmount` helper currently inline in FinancePage moves into it. |
| **Specific (kept feature-local)** | — | — |

> The upcoming cards used `ReservationCard`/`ReservationSasDialog`; those components stay (still used
> by `PlanningPage` and `ReservationsUpcomingPage`) — only FinancePage stops importing them.

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/finance/operational` | — | `{ overdue, pending, upcoming }` | `upcoming.totals` gains `remainingToPay` (number). All other fields unchanged. |

---

## 5. Data model

No schema change. `remainingToPay` is already computed per reservation; only a new sum is exposed.

**Data impact:** none.

## 6. UI / UX

- **Réservations à venir:** identical look to « Paiements en attente » minus the « Compl. fin de
  séjour » column and minus the checkboxes / « Tout solder » column. Top-right green chip
  « En attente de paiement : X € ».
- **Réservations période:** a neutral chip « Période du {displayDate(from)} au {displayDate(to)} »
  in a top-right `Box` above the table.
- **Copy (FR):** « En attente de paiement : … », « Période du … au … ».
- **Responsive:** both operational tables already live in a horizontally-scrollable
  `TableContainer`; the read-only upcoming table is narrower than the pending one (2 fewer columns),
  so `minWidth` is reduced accordingly. The top-right chips wrap above the table on `xs` (`flex-end`,
  `mb`), no horizontal overflow added.
- **PageActionBar:** not applicable — this change is confined to a card inside `FinancePage`, which
  uses `PageHeader`; no page-level actions added.

## 7. Test plan

### Server unit tests
- [ ] `tests/finance-model.unit.test.js` — `getOperational().upcoming.totals.remainingToPay` equals
  the sum of the upcoming rows' `remainingToPay`.

### Client unit tests (vitest)
- [ ] `pages/__tests__/FinancePage.test.js` — « Réservations à venir » tab renders a table (Client /
  Reste à payer / Total de séjour cells), no longer calls `getReservation`, shows the green
  « En attente de paiement » chip; « Réservations période » tab shows the « Période du…au… » chip.

### Manual UI verification
- [ ] Happy path: open Suivi financier → « Réservations à venir » shows the payments table (no
  end-of-stay column, no checkboxes), green chip; « Réservations période » shows the period chip.
- [ ] Edge case: a `depositDisabled` upcoming row shows « Désactivé »; an empty upcoming set shows
  the empty message.
- [ ] Regression: « Paiements en attente » still has 4 buckets + checkboxes + « Tout solder » and
  its footer totals are unchanged; row click still opens the fiche.

## 8. Out of scope

- The arrival/SAS flow and bed/family/options detail (still available on the Planning page).
- Any change to « Paiements en retard » or the projection table.
- Making the upcoming buckets editable (explicitly read-only here).

## 9. Open questions

Resolved before drafting (AskUserQuestion 2026-06-25):
- Q: Upcoming table interactive or read-only? → **A: read-only** (no checkboxes / « Tout solder »).
- Q: Which top-right chip on the upcoming tab? → **A: green « En attente de paiement »** (Σ reste à
  payer).
