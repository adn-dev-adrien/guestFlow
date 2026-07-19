# Tourist tax — declaration month = stay-end month (payment as a floor)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/tourist-tax-declaration-month-stay-end` |
| **Created** | 2026-07-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The « Extraction taxe de séjour » page (`/finance/tourist-tax`, `financeModel.getTouristTaxExtraction`)
attributes a stay's tax to the **month its tax-carrying échéance was paid** (`balancePaidDate`, or
`complementPaidDate` for tax collected on arrival) — a deliberate choice made in
`specs/tourist-tax-on-solde.md` (« déclarer quand encaissé », 2026-06-23).

In practice this is wrong for the commune declaration: a stay ending in June whose solde was paid in May
shows up in the **May** declaration, even though the taxed nights are all in June. The declaration must
follow the **stay**, not the cash — while still never declaring (hence never remitting) the tax of a stay
that was **never paid**.

## 2. Goal

A stay's tourist tax appears in the declaration month of its **last night** — unless the tax-carrying
payment arrives **later**, in which case it appears in the **payment month**. An unpaid stay never
appears, so the operator never remits a tax that was not collected.

## 3. Functional rules

1. **Eligibility unchanged:** only stays whose tax the operator must remit to the commune (direct,
   platform-reverses, owner-collected-at-arrival — `touristTaxRemittedByPlatform = 0` logic of
   `specs/per-platform-tourist-tax-three-way.md`) are listed. `kind = 'reservation'` only.
2. **Payment still required:** a stay appears only once its tax-carrying échéance is paid —
   `balancePaid = 1` normally, `complementPaid = 1` when the tax is collected on arrival
   (`TAX_ON_ARRIVAL_SQL` unchanged). Unpaid → absent from every month. *(Unchanged from
   tourist-tax-on-solde.)*
3. **Attribution month = `max(lastNightMonth, paidMonth)`:**
   - `lastNightDate = DATE(endDate, '-1 day')` — a checkout on the 1st belongs to the previous month
     (all taxed nights are in it).
   - `paidDate = balancePaidDate` (or `complementPaidDate` for on-arrival).
   - The stay appears in the month of the **later** of the two dates, and in that month only.
4. **Consequences of rule 3:**
   - Paid before or during the stay-end month → declared in the **stay-end (last-night) month**.
   - Paid after the stay-end month (late payment) → declared in the **payment month** (never
     retroactively into an already-declared past month).
5. **Future months stay rejected** (HTTP 400): there is nothing to declare yet. The current month is
   accepted.
6. **Single-month invariant preserved:** `max()` of two fixed dates is deterministic, so a reservation
   still appears in **exactly one** monthly extraction — the « Déclarée » per-reservation checkbox
   (`specs/tourist-tax-declared-checkbox.md`) needs no change.

**Edge cases:**
- Paid flag set but paid **date** missing (legacy data) → treat `paidDate` as the last-night date
  (i.e. attribute to the stay-end month).
- Stay ends in the current month, already paid → appears in the current month (declarable now).
- Payment un-done (échéance unpaid again) → the stay drops out of all months, as today.
- 0-night stay (`endDate = startDate`, defensive) → `lastNightDate` = day before `startDate`; the row
  is still attributed by rule 3 (amount is 0 anyway).

---

## 4. Architecture

> Fat backend, thin frontend: the month attribution is 100 % in the SQL of the extraction query; the
> client renders the returned set unchanged.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `financeModel.js` | T | `getTouristTaxExtraction` WHERE clause: keep the paid-flag requirement, replace the paid-date-in-bounds filter by `max(lastNightDate, COALESCE(paidDate, lastNightDate))` in `[monthStart, nextMonthStart)` — for both the solde branch and the `TAX_ON_ARRIVAL_SQL` complement branch. |
| `tests/` | `tourist-tax-collection-coverage.unit.test.js` | T | Rewrite the attribution cases: paid-early → stay-end month; paid-late → payment month; unpaid → absent; paid-flag-without-date → stay-end month; checkout-on-the-1st → previous month. |
| `routes/` / `controllers/` | — | — | (none — endpoint contract unchanged) |
| `database.js` | — | — | (no schema change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `TouristTaxPage.js` | — | (none — same payload shape; the month set is reshaped server-side) |

No new or consumed generic components.

### 4.3 API contract

`GET /api/finance/tourist-tax?month=YYYY-MM` — unchanged signature and payload; only the set of
reservations returned for a given month changes.

## 5. Data model

None. Behaviour-only; uses existing `endDate`, `balancePaid(Date)`, `complementPaid(Date)` columns.
**Data impact:** stays move between declaration months (e.g. a stay paid in May ending in June moves
from the May extraction to the June one). Already-ticked « Déclarée » markers stick to the reservation
and follow it to its new month.

## 6. Test plan

All automated cases live in `tourist-tax-collection-coverage.unit.test.js`:

- [x] Paid before the stay ends → appears in the last-night month, not the payment month.
- [x] Paid in the stay-end month → that month (pre-existing included/excluded platform tests).
- [x] Paid after the stay-end month → appears in the payment month only.
- [x] Unpaid solde → absent from stay-end month and payment-candidate months.
- [x] Checkout on the 1st → attributed to the previous month (last night).
- [x] Tax-on-arrival stay: early/late/unpaid matrix against `complementPaid(Date)`.
- [x] Paid flag = 1, paid date NULL → last-night month.
- [x] Future month still rejected; current month accepted (pre-existing, unchanged).
- [x] Full server suite green — **2075 / 2075 pass**.
- [ ] Manual UI check: month selector on `/finance/tourist-tax` shows the moved stays (desktop + mobile).

## 7. Out of scope

- Tax amount computation, platform three-way routing, freeze/refresh behaviour.
- The acompte/solde **placement** of the tax (tourist-tax-on-solde rules 1–5 stay as-is; only its
  rule 6 — the declaration month — is superseded by this spec).
- Any client-side change.

## 8. Open questions

- **Resolved (2026-07-19):** month boundary = **last night** (checkout on the 1st → previous month).
- **Resolved (2026-07-19):** payment remains required; late payment attributes to the **payment month**
  (goal: never remit a tax that was never collected).
