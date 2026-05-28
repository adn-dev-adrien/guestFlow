# Finance & Dashboard — server-owned money, MVC, render-only pages

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/finance-dashboard-thin` _(Claude-managed)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 5 — Finance & Dashboard. See `specs/ROADMAP.md`. |

---

## 1. Context

The finance domain is the last place with **money math on the client** — a direct violation of the
fat-backend rule, and a correctness risk (two slightly different implementations of the same formula):

- **`FinancePage.js`** computes `getRemainingDue` (`finalPrice − paidDeposit − paidBalance`), and **derives
  the entire overdue list client-side**: `depositOverdue`/`balanceOverdue`/`overdueAmount`/`oldestDueDate`
  per row, then `filter` + `sort` + `reduce` for the count and total. It also **groups upcoming
  reservations by property + top-5** and recomputes `remainingDue`/`nights` inline in three tabs.
- **`Dashboard.js`** has its **own** `getRemainingDue` (clamped at 0) used for the arrivals/departures
  payment cells (`paymentOk = remaining <= 0`).
- **`routes/finance.js` (403 LOC)** is a monolith with **no controller/model**: 4 endpoints
  (`/summary`, `/projection`, `/pending`, `/tourist-tax`) plus inline pure helpers (`round2`,
  `getMonthBounds`, `computeAccommodationAmountAfterDiscount`, tourist-tax). `/pending` already computes
  `remainingDue` in SQL — but the client recomputes it anyway.

The two `getRemainingDue` copies even differ (FinancePage unclamped vs Dashboard `Math.max(0, …)`), which
is exactly the kind of drift the fat-backend rule exists to prevent.

## 2. Goal

The server is the single source of truth for every payment figure (remaining due, overdue flags/amounts,
payment-complete, aggregates). `FinancePage` and `Dashboard` **render ready-made payloads** with no money
math, no overdue derivation, and no client-side grouping. `routes/finance.js` becomes a thin route over a
`financeController` + `financeModel`.

## 3. Functional rules

1. **Single payment-status authority.** One pure helper `computePaymentStatus(reservation, today)` returns
   `{ remainingDue, paymentComplete, depositOverdue, balanceOverdue, overdueAmount, oldestDueDate, isOverdue }`.
   It is the **only** implementation; both client `getRemainingDue` copies are deleted.
   - `remainingDue = round2(finalPrice − (depositPaid?depositAmount:0) − (balancePaid?balanceAmount:0))`
     (unclamped — matches the current `/pending` SQL and FinancePage period tab).
   - `paymentComplete = remainingDue <= 0`.
   - `depositOverdue = !depositPaid && depositDueDate && depositDueDate < today` (same for balance).
   - `overdueAmount = round2((depositOverdue?depositAmount:0) + (balanceOverdue?balanceAmount:0))`.
   - `oldestDueDate = min(present due dates)`; `isOverdue = depositOverdue || balanceOverdue`.
2. **MVC.** `routes/finance.js` → thin route → `financeController` → `financeModel`. Pure calc helpers
   (`round2`, month bounds, accommodation-after-discount, tourist-tax glue) move to `utils/financeCalcs.js`
   (unit-testable). No SQL or math left in the route.
3. **Enriched `/summary`.** Each returned reservation carries `remainingDue`, `depositOverdue`,
   `balanceOverdue`, `paymentComplete` (the period tab + chips render these). Totals unchanged.
4. **New `/operational` endpoint** returns the whole "Suivi opérationnel" section **fully shaped**:
   `{ overdue: { reservations[] (sorted by oldestDueDate, each with overdue fields), count, totalAmount },
   pending: { reservations[] (with remainingDue + overdue flags) },
   upcoming: { reservations[] } }`. The upcoming list is the **flat** result of taking the top 5
   not-yet-ended reservations per property and merging+sorting them by start date, each with `remainingDue`
   + `nights` — the client renders it directly (no client grouping). _(Implemented as a flat `upcoming`
   list rather than the originally-sketched `upcomingByProperty`, since FinancePage only ever flattened
   it.)_ This replaces the client's filter/sort/reduce/grouping. The old **`/pending` endpoint is
   removed** (FinancePage was its only consumer; now returns `404`).
5. **Enriched reservation payloads.** `reservationsModel` adds `remainingDue` + `paymentComplete` to the
   **list and detail** payloads (via the shared `computePaymentStatus`), so the Dashboard arrivals/
   departures cells render server values. Additive — other consumers ignore the extra fields.
6. **Render-only pages.** `FinancePage` and `Dashboard` contain no `getRemainingDue`, no overdue
   derivation, no `reduce`/`groupBy`, no `nights` date math — they read server fields only.
7. **Behaviour-preserving.** Same numbers, same French copy, same tabs/chips/colors, same navigation, same
   optimistic payment-toggle refresh. `/projection` and `/tourist-tax` are unchanged in contract.
8. **No schema change.** The "à payer plus tard / per-extra payment tracking" feature (new `paid` columns)
   is **explicitly out of scope** (separate spec).

**Edge cases:** overpaid reservation (`remainingDue < 0` → `paymentComplete`, shows "Complet"/"OK");
reservation with no due dates (never overdue); a reservation overdue on deposit but balance not yet due;
property with > 5 upcoming reservations (top 5 server-side); empty states for each tab preserved.

---

## 4. Architecture

> **Fat backend, thin frontend.** All payment math + overdue derivation + aggregation + grouping move to
> the server, which returns ready-to-render payloads. The pages keep only local UI state (selected
> period, current tab, selected day).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `paymentStatus.js` | C | Pure `computePaymentStatus(reservation, today)` → remaining/overdue/complete fields. The single money-status authority. Unit-tested. |
| `utils/` | `financeCalcs.js` | C | Pure helpers moved out of the route: `round2`, `getMonthBounds`, `getLastNightDate`, `isReservationAssignedToMonth`, `computeAccommodationAmountAfterDiscount`, tourist-tax glue. Unit-tested (absorbs the route's current `__test` exports). |
| `models/` | `financeModel.js` | C | All finance DB access + shaping: `getSummary(from,to)` (enriched reservations + totals), `getProjection(date)`, `getOperational(today)` (overdue + pending + upcomingByProperty, fully shaped via `paymentStatus`), `getTouristTaxExtraction(month)`. `create(db)` factory. |
| `controllers/` | `financeController.js` | C | Thin handlers: parse/validate query (`from`/`to`/`date`/`month` format) → model → respond. |
| `routes/` | `finance.js` | T | Thin: `GET /summary /projection /operational /tourist-tax` → controller. `/pending` removed. |
| `models/` | `reservationsModel.js` | T | List + detail payloads gain `remainingDue` + `paymentComplete` via `paymentStatus` (shared util). |
| `utils/` | `pricing.js` (`computeTouristTaxBreakdown`) | — | Reused by `financeCalcs`. |
| `tests/` | `payment-status.unit.test.js` · `finance-calcs.unit.test.js` · `finance-model.unit.test.js` | C | Util status math; calc helpers (migrated from the route `__test`); model shaping (summary enrich, operational overdue/pending/upcoming, in-memory DB). |

**Notes:** routes thin; the existing `finance.js.__test` helper export is replaced by importing the new
`utils/financeCalcs.js` in the migrated test (no behaviour change to the tourist-tax math).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `FinancePage.js` | T | Render-only: consumes enriched `/summary` + new `/operational`. Removes `getRemainingDue`, the overdue `map/filter/sort`, `overdueTotalAmount` reduce, `upcomingByProperty` grouping, inline `remainingDue`/`nights`. |
| `pages/` | `Dashboard.js` | T | Removes `getRemainingDue`; arrivals/departures payment cells read `r.remainingDue` + `r.paymentComplete` from the enriched reservation detail. |
| `services/` | `api.js` | T | Replace `getPendingPayments()` with `getFinanceOperational()`. `getFinanceSummary`/`getFinanceProjection`/`getTouristTaxExtraction`/`markPayment` unchanged. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageHeader`, `SyncedPropertyMiniCalendars`, recharts wrappers | Pre-existing; unchanged. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | the finance tables/tabs | Page-specific; out of scope to genericize here. |

No new component; this bloc is logic-relocation, not UI restructuring. (A `PageActionBar` pass for these
pages stays out of scope — they have no Save/Cancel flow.)

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/finance/summary` | `from`, `to` | `{ totalRevenue, totalCollected, totalPending, reservations[] }` — each reservation **+`remainingDue`, `depositOverdue`, `balanceOverdue`, `paymentComplete`** | additive |
| GET | `/api/finance/operational` | — (uses server `today`) | `{ overdue:{reservations[],count,totalAmount}, pending:{reservations[]}, upcoming:{reservations[]} }` | **new**, replaces `/pending` (now `404`) |
| GET | `/api/finance/projection` | `date` | unchanged | |
| GET | `/api/finance/tourist-tax` | `month` | unchanged (`400` on bad/non-past month) | |
| ~~GET~~ | ~~`/api/finance/pending`~~ | | | **removed** |
| GET | `/api/reservations` · `/api/reservations/:id` | | payload **+`remainingDue`, `paymentComplete`** | additive |

Auth: all under the global `/api` requireAuth (unchanged).

---

## 5. Data model

**No schema change, no migration.** All fields are computed at read time from existing columns
(`finalPrice`, `depositAmount`/`depositPaid`/`depositDueDate`, `balanceAmount`/`balancePaid`/
`balanceDueDate`). No data impact.

## 6. UI / UX

**No visible change.** Same three summary cards, charts, projection table, and the "Suivi opérationnel"
card with its 4 tabs (Paiements en retard / en attente / Réservations à venir / période) and the count
chips. Same Dashboard arrivals/departures tables with the payment/caution status cells. Same French copy
and colors (`error.main` for overdue/remaining, `success.main` for complete).

**Responsive:** unchanged — the existing breakpoints (period selector wrap, scrollable tabs, `minWidth`
tables with horizontal scroll on `xs`, stacked date-nav on Dashboard) are preserved.

**PageActionBar:** not introduced (read-only analytics pages, no Save/Cancel). Existing `PageHeader` kept.

## 7. Test plan

### Server unit tests
- [x] `payment-status.unit.test.js` (8) — `computePaymentStatus`: remainingDue (paid/unpaid/overpaid),
      paymentComplete boundary, deposit/balance overdue vs not-yet-due vs paid, overdueAmount,
      oldestDueDate selection, isOverdue.
- [x] `finance-calcs.unit.test.js` (11) — migrated month-bounds / last-night / accommodation-after-discount
      / tourist-tax helpers (same cases as the former route `__test`, now importing `utils/financeCalcs`).
- [x] `finance-model.unit.test.js` (4) — in-memory DB: `/summary` enrich (remainingDue + flags + totals),
      `/operational` (overdue sorted + count + total; pending list; upcoming flat + top-5/property + nights),
      tourist-tax month validation.
- [x] Full server suite green (**332**).

### Manual UI verification (browser)
- [x] **FinancePage**: summary cards + both charts; projection table; "Suivi opérationnel" overdue tab +
      chips (9 retards / 3566.88€ total) render from `/operational`; `summary`/`projection`/`operational`
      all `200`; old `/pending` → `404`. `0` app console errors.
- [x] **Reservation payload enrichment verified live**: list + detail carry `remainingDue` +
      `paymentComplete`; `/operational` upcoming rows carry `remainingDue` + `nights` (Dashboard renders
      these; the day had no arrivals/departures to show the cells, but the fields are present).
- [x] Clean `CI=true` client build (compiled, bundle −296 B).
- [ ] Tourist-tax page + a payment toggle + a Dashboard day with arrivals — left for the user's pass
      (unchanged endpoints / verbatim-relocated logic).

## 8. Out of scope

- **"À payer plus tard" / per-extra payment tracking** (new `paid` columns on
  `reservation_options`/`reservation_resources`/`reservation_custom_options`, on-site subtotal) — its own
  future spec (schema change).
- Dashboard's arrivals/departures **N+1 detail fetch** restructuring (a dedicated "day operations"
  endpoint) — left as a future optimisation; this bloc only removes the money math.
- Recharts data mapping (`pieData`/`barData`) — trivial presentational mapping, left inline.

## 9. Open questions

- **Q: Fold `/pending` into `/operational` (remove the route) vs keep both?** → **A: removed `/pending`.**
  Confirmed no other consumer of `getPendingPayments` / `finance/pending` (grep clean); `/operational`
  returns the pending list. The route now returns `404`.
- **Q: Enrich reservation list *and* detail, or detail only?** → **A: both** (additive, verified live to
  carry `remainingDue` + `paymentComplete`).
