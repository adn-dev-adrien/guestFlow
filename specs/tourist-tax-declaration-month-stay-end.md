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
   *Reading of 2026-11-05 (D14):* a stay with an installment plan does not pass through this gate,
   rule 7.
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
7. **A stay with an installment plan enters at its stay month, whatever is paid** (2026-11-05, D14,
   Adrien's decision). The plan is read from `reservation_installments`: fully paid, partly paid or
   nothing paid yet, the stay is listed in the month of its last night and for its whole tax, payment
   dates playing no part, including a complement that carries the tax. *Why:* paying an installment
   leaves `balancePaid` at 0 (`specs/direct-installments.md` rule 51), so a stay paid through a plan
   never reached the page and its tax was never offered for declaration. Listed is not declarable: the
   early-declaration reading first recorded here was withdrawn by Adrien on 2026-11-05 (D16), the tick waits
   for every installment paid and the stay over (`tourist-tax-declared-checkbox.md` rule 8). The row placement
   stands, so nothing is forgotten. Platform routing (rule 1), refunded nights and a cancelled stay read as on
   any other stay.
   The row reads the stored tax, the figure its tick pins: paying an installment freezes nothing, so a live replay
   showed 8,00 € after a rate move, the tick then showed 4,80 €, and the operator had told the commune the first. A
   save of the fiche re-prices the stored figure only while nothing pins it: a plan fully paid or a paid installment
   holding a tax share does (D17, `tourist-tax-matches-the-office-calculation.md` rule 19).
8. **Every other stay keeps its gate, and the plan decides alone** (2026-11-05, D14). Without a plan,
   rules 2 and 3 are unchanged. With a plan, a stored paid flag is not read, so a stay stays in one
   month (rule 6). A plan removed again (nothing was paid, `direct-installments` rule 2) gives the stay
   its gate back: absent until the solde is paid, its « Déclarée » tick kept.

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
| `models/` | `financeModel.js` | T | Rules 7-8 (2026-11-05): `HAS_PLAN_SQL` (`EXISTS` on `reservation_installments`, `(0)` on a minimal schema without the table) opens a third branch of the WHERE clause on the last night alone, and closes the two others to a plan. |
| `tests/` | `plan-tax-declaration.unit.test.js` | C | Rules 7-8, through the real controllers. |
| `tests/` | `fixtures/vat-regime/golden.json` | T | `tourist-tax/2027-07` regenerated, that key alone: the golden's stay 106 has a plan. |
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
- [x] `plan-tax-declaration.unit.test.js` (27, 2026-11-05), rules 7-8: the percentage modes with the complement, tick, untick and rate move (audit R23-S2, T1); plan paid, partly paid, nothing paid; stay month against payment month; departure on the 1st; amount, KPIs and aggregate equal to the same stay paid by solde; refunded night; cancelled stay; plan removed; tax on the complement; an own channel that remits itself; a stay without a plan unchanged.
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
- **Resolved (2026-11-05, D14):** a stay with an installment plan is the exception, rule 7: Adrien
  prefers a tax declared before it is collected to a tax nobody is offered.
