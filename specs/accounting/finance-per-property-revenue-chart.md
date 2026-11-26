# Finance « Vue générale » — per-property revenue chart (period / year tabs)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/finance-per-property-revenue-cards` |
| **Created** | 2026-07-18 |
| **Author** | Adrien |
| **Related PR** | #341 |

> **Reviewed 2026-11-26 (spec reorganization).** The chart and its tabs are gone (replaced by the Suivi financier dashboard, `specs/accounting/finance-dashboard-redesign.md`); only the server aggregates `revenueByProperty` / `yearToDateByProperty` of `financeModel.getSummary` (rules 5-7, 9) are live.

> **Reviewed 2026-11-26 (rule-by-rule money audit).** Rules 5-7 verified; the year-boundary edge case now says attribution date and exercise start, not `endDate` / January 1.

---

## 1. Context

The finance overview (`/finance`, specs/accounting/finance-overview-rework.md) shows global KPI cards (annual
row + period row) and a per-logement bar chart fed by `summary.revenueByProperty` (period-scoped).
All figures are Σ « total de séjour » (`totalSejour`: deposit + balance + complements excluding
caisse interne, net of platform commission), counted by departure date (`endDate`).

There was no per-logement view of the **year-to-date** revenue.

> **Pivot note (2026-07-18).** A first iteration shipped this as two rows of per-logement KPI *cards*
> (below the annual cards and below the period cards). Adrien found the card rendering cluttered the
> overview and asked to move the per-logement figures into the existing chart as tabs instead. The
> cards are gone; the server aggregates built for them are what feeds the chart's tabs. Don't
> resurrect the card rows.

## 2. Goal

See each logement's revenue in the « Revenu par logement » chart over two windows — the selected
du/au period and the year-to-date — with amounts explicitly TTC and their HT shown discreetly.

## 3. Functional rules

1. *(Retired 2026-11-26 — the « Revenu par logement » chart and its tabs no longer exist; the per-logement figures feed the Suivi financier dashboard, specs/accounting/finance-dashboard-redesign.md.)*
   > **Sans test** — retired rule
2. *(Retired 2026-11-26 — the chart caption went with the chart.)*
   > **Sans test** — retired rule
3. *(Retired 2026-11-26 — the in-bar labels went with the chart.)*
   > **Sans test** — retired rule
4. *(Retired 2026-11-26 — the chart tooltip went with the chart.)*
   > **Sans test** — retired rule
5. **HT basis:** per reservation via the existing `htAmount` helper (tourist tax bears no VAT),
   aggregated server-side as `revenueHt` on both arrays.
6. **The server seeds both aggregates from the `properties` table**: a logement with no reservation appears at 0 in the payload (`revenueByProperty`, `yearToDateByProperty`). The consumer filters what it shows.
7. **Ordering:** revenue descending, ties broken by property name (server-side, both arrays).
8. *(Retired 2026-11-26 — no tabs any more; `GET /finance/summary` is gone, `financeModel.getSummary` is read internally by `financeDashboardModel`.)*
   > **Sans test** — retired rule
9. **All computation server-side.** The client maps `{propertyName, revenue, revenueHt}` to bars —
   no summing, filtering beyond rule 6, or sorting in React.
10. *(Retired 2026-11-26 — the KPI cards and their breakdown dialog are gone, see specs/accounting/finance-dashboard-redesign.md.)*
   > **Sans test** — retired rule
**Edge cases:**
- No properties in DB → both tabs show their empty state.
- Caisse-interne complements and platform commissions → handled exactly like the global cards
  (inherited from `totalSejour`).
- Year boundary: `yearToDateByProperty` runs from the exercise start to today and counts the stays whose
  attribution date is `≤ today` (`specs/accounting/fiscal-year-and-nights-sold.md` §3.2), not their `endDate`.

---

## 4. Architecture

> **Fat backend, thin frontend.** Both aggregates are computed and sorted in `financeModel.getSummary`;
> the client renders tabs and bars.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — `GET /finance/summary` already wired) |
| `controllers/` | — | — | (none — `financeController.summary` passes through) |
| `models/` | `financeModel.js` | T | `getSummary`: new `yearToDateByProperty` aggregate (year query now selects `propertyId` + joins properties); `revenueByProperty` gains `revenueHt`; both seeded from the `properties` table and sorted revenue desc, name asc. |
| `database.js` | — | — | (none — no schema change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `FinancePage.js` | T | Chart card: title « Revenu par logement », `chartTab` local state, Tabs (period/year), per-tab caption + empty state, bar data from the active array (filter `revenue > 0`), two-line TTC/HT in-bar label renderer, TTC+HT tooltip. |
| `api.js` | — | — | (none — same endpoint, richer payload) |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `EmptyState` | Per-tab chart empty state (already in place). |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `renderBarLabel` (FinancePage) | Recharts `LabelList` content renderer, tied to this chart's data shape. |

### 4.3 API contract

| Method | Endpoint | Request | Response change | Notes |
|---|---|---|---|---|
| GET | `/finance/summary?from&to` | unchanged | `+ yearToDateByProperty: [{ propertyId, propertyName, revenue, revenueHt }]` (Jan 1 → today, period-independent); `revenueByProperty` items gain `revenueHt` and include zero-revenue properties | Backward-compatible addition. Both arrays sorted revenue desc, then name asc. |

---

## 5. Data model

No schema change. No migration.

## 6. UI / UX

- Chart card (left column of the charts row): section header « Revenu par logement », MUI `Tabs`
  underneath (« Sur la période » / « Depuis le début de l'année »), then the caption line
  (window + « montants TTC »), then the bar chart (or `EmptyState`).
- Bars: TTC bold white centered; « X € HT » in smaller translucent white just below; TTC-only when
  the bar is under ~40px tall. Tooltip « {TTC} ({HT} HT) ».
- **Responsive:** tabs use `variant="scrollable" allowScrollButtonsMobile` (same as the « Suivi
  opérationnel » tabs) so both labels fit on `xs` (375px) without horizontal page scroll; the chart
  card already stacks full-width under `md`.
- **Loading/error states:** unchanged (page-level `LoadingState` / `ErrorAlert`).
- **PageActionBar:** unchanged.

## 7. Test plan

### Server unit tests

- [x] `tests/finance-per-property-revenue.unit.test.js` — on a fixture with 2 properties:
  - year-to-date per property sums only `endDate ≤ today` within the current year (rule 1);
  - period per property honors `[from, to]` (rule 1);
  - HT values match `htAmount` element-by-element (rule 5);
  - zero-revenue property present in the payload with `revenue: 0` (rule 6);
  - ordering revenue desc, name asc (rule 7);
  - caisse-interne complements and platform commissions handled like the global cards (edge cases).

### Client tests

- [x] `FinancePage.test.js` (vitest) — chart tabs test: title, « Sur la période » default with its TTC
  caption, switching to « Depuis le début de l'année » swaps the caption. Fixture carries both
  per-logement arrays (zero-revenue row included).
- [x] Full client suite `npx vitest run` + E2E `npm run test:e2e` pass.

### Manual UI verification (2026-07-18, headless Playwright on the dev DB)

- [x] Happy path: both tabs render per-logement bars whose values match the matching global cards;
  in-bar TTC + discreet HT; tooltip shows both.
- [x] Edge case: du/au set to an empty week → period tab shows the « Aucun revenu… » empty state;
  year tab still shows its bars.
- [x] Mobile (375px) + tablet (900px) + desktop (1280px): tabs and chart fit, zero horizontal overflow.
- [x] Regression: global cards unchanged, breakdown dialog still opens from them.

## 8. Out of scope

- Per-property click-through breakdown (bar click → dialog).
- Per-property « Revenu total sur l'année » (full-year) window — only year-to-date.
- Persisting the selected tab across reloads.
- The reverted per-logement KPI card rows (see Pivot note §1).

## 9. Open questions

- Q: Show logements with zero revenue as bars/cards, or hide them?
  - A (resolved 2026-07-18): payload keeps them at 0 (stable contract), the chart hides them — an
    empty bar is noise; the empty state covers the all-zero case.
