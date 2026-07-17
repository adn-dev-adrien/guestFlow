# Finance « Vue générale » — per-property revenue cards

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/finance-per-property-revenue-cards` |
| **Created** | 2026-07-18 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The finance overview page (`/finance`, specs/finance-overview-rework.md) shows global KPI cards:

- Row 1 (annual, period-independent): « Revenus depuis le début de l'année » (`yearToDate`) and « Revenu total sur l'année » (`yearTotal`).
- Row 2 (period du/au): « Revenu total sur la période » (`revenueTotal`), « Encaissé », « En attente de règlement ».

All figures are Σ « total de séjour » (`totalSejour`: deposit + balance + complements excluding caisse
interne, net of platform commission), counted by departure date (`endDate`).

The only per-property view today is the « Revenus par logement » bar chart, fed by
`summary.revenueByProperty` (period-scoped, TTC only). There is no per-property figure for the
year-to-date revenue, and no per-property KPI cards.

## 2. Goal

At a glance, see each logement's revenue as its own card: year-to-date revenue per logement under the
annual cards, and period revenue per logement under the period cards — computed exactly like the
matching global cards, just filtered by property.

## 3. Functional rules

1. **Year-to-date per property.** For each property, compute Σ `totalSejour` over reservations with
   `kind = 'reservation'` and `endDate ∈ [Jan 1 of current year, today]` — the exact same basis and
   date window as the global « Revenus depuis le début de l'année » card, filtered by `propertyId`.
2. **Period revenue per property.** For each property, compute Σ `totalSejour` over reservations with
   `kind = 'reservation'` and `endDate ∈ [from, to]` (the du/au selector) — the exact same basis as
   the global « Revenu total sur la période » card, filtered by `propertyId`. This is the existing
   `revenueByProperty` aggregate.
3. **HT sub-line.** Each per-property card shows the HT equivalent, computed per reservation with the
   existing `htAmount` helper (same as the global cards' HT sub-lines).
4. **Every logement gets a card**, including logements with zero revenue on the window (shown as
   `0 €`). The aggregates are seeded from the `properties` table, not only from matching reservations.
5. **Ordering:** revenue descending, ties broken by property name (deterministic). Same ordering rule
   for both rows; matches the existing bar-chart ordering.
6. **Placement:**
   - The year-to-date per-property cards render as a new row **directly below Row 1** (the two annual
     cards), above the period selector.
   - The period per-property cards render as a new row **directly below Row 2** (the three period
     cards), above the charts.
7. **Card content:** label = property name, caption = « depuis le début de l'année » (year row) /
   « sur la période » (period row), value = TTC rounded (same `formatCurrencyRounded` as the other
   cards), HT sub-line.
8. **Not clickable.** Unlike the global cards, per-property cards do not open the breakdown dialog
   (the breakdown endpoint is metric-scoped, not property-scoped — see Out of scope).
9. **All computation server-side.** The client renders `summary.yearToDateByProperty` and
   `summary.revenueByProperty` as-is — no filtering, summing, or sorting in React.
10. **Bar chart unchanged in behavior:** since `revenueByProperty` now includes zero-revenue
    properties, the chart keeps showing only properties with revenue > 0 (presentational filter) and
    its empty state still appears when no property has revenue on the period.

**Edge cases:**
- No properties in DB → both per-property rows render nothing (no empty-state card row).
- Property with no reservation in the window → card shown with `0 €` (+ `0 € HT`).
- A reservation whose complements are paid via caisse interne → excluded from the card amount, exactly
  as in the global cards (inherited from `totalSejour`).
- Platform commissions → deducted, exactly as in the global cards (inherited from `totalSejour`).

---

## 4. Architecture

> **Fat backend, thin frontend.** Both aggregates are computed and sorted in `financeModel.getSummary`;
> the client maps arrays to cards.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — `GET /finance/summary` already wired) |
| `controllers/` | — | — | (none — `financeController.summary` passes through) |
| `models/` | `financeModel.js` | T | `getSummary`: add `yearToDateByProperty` (new aggregate on the year query, which now also selects `propertyId` + property name); extend `revenueByProperty` with `revenueHt`; seed both from the `properties` table so zero-revenue logements appear; sort revenue desc, name asc. |
| `middleware/` | — | — | (none) |
| `utils/` | — | — | (none — reuses `totalSejour`, `htAmount`, `round2`) |
| `database.js` | — | — | (none — no schema change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `FinancePage.js` | T | Build `yearPropertyCards` / `periodPropertyCards` from the summary payload; render the two new rows; `renderCard` supports non-clickable cards (no `metric` → plain card, no role/button); bar chart keeps only `revenue > 0` entries. |
| `api.js` | — | — | (none — same endpoint, richer payload) |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | — | The KPI tile is the page-local `renderCard` helper (theme `kpiLabel`/`kpiValue` variants), reused for the new cards. |
| **Created (new generic)** | — | None. Extracting a generic `KpiCard` (also duplicated in `TouristTaxPage`/`Dashboard`) stays out of scope. |
| **Specific (kept feature-local)** | `renderCard` (FinancePage) | Extended, stays local to the page. |

### 4.3 API contract

| Method | Endpoint | Request | Response change | Notes |
|---|---|---|---|---|
| GET | `/finance/summary?from&to` | unchanged | `+ yearToDateByProperty: [{ propertyId, propertyName, revenue, revenueHt }]` (Jan 1 → today, period-independent); `revenueByProperty` items gain `revenueHt` and include zero-revenue properties | Backward-compatible addition. Both arrays sorted revenue desc, then name asc. |

---

## 5. Data model

No schema change. No migration.

## 6. UI / UX

- **Year row (new, below the two annual cards):** one compact card per logement.
  Label: property name. Caption: « depuis le début de l'année ». Value: TTC rounded. Sub-line: `X € HT`.
  Accent (left border): `info.main` — echoes the « Revenus depuis le début de l'année » card it derives from.
- **Period row (new, below the three period cards):** same card shape.
  Caption: « sur la période ». Accent: `primary.main` — echoes « Revenu total sur la période ».
- Cards are static (no hover lift, no pointer cursor) since they are not clickable.
- **Responsive:** per-property cards use `size={{ xs: 6, sm: 4, md: 3 }}` → 2 per row on mobile,
  3 on tablet, 4 on desktop; rows wrap for more logements. Global cards' breakpoints unchanged.
  No horizontal scroll on `xs`.
- **Loading/error states:** unchanged — the rows render only when `summary` is loaded, covered by the
  existing page-level `LoadingState` / `ErrorAlert`.
- **PageActionBar:** unchanged (« Suivi financier » + Actualiser).

## 7. Test plan

### Server unit tests

- [x] `tests/finance-per-property-revenue.unit.test.js` — on a fixture with 2 properties:
  - year-to-date per property sums only `endDate ≤ today` within the current year (rule 1);
  - period per property honors `[from, to]` (rule 2);
  - HT values match `htAmount` element-by-element (rule 3);
  - zero-revenue property present with `revenue: 0` (rule 4);
  - ordering revenue desc, name asc (rule 5);
  - caisse-interne complements and platform commissions handled like the global cards (edge cases).

### Client tests

- [x] `FinancePage.test.js` (vitest) — summary fixture gains the new fields; asserts both per-property
  rows render (captions counted, `0 €` + `0 € HT` shown) and that only the 5 global cards expose the
  breakdown button (per-logement cards are static). The chart's zero-revenue filter is covered by the
  manual check below.
- [x] Full client suite `npx vitest run` (653 tests) + E2E `npm run test:e2e` (32 passed) pass.

### Manual UI verification (2026-07-18, headless Playwright on the dev DB)

- [x] Happy path: `/finance` shows one card per logement under the annual row and under the period row,
  values consistent with the bar chart and global cards (per-logement split sums exactly to the
  global `yearToDate`).
- [x] Edge case: du/au set to an empty week → both period cards show `0 €` (sorted by name), the bar
  chart shows the « Aucun revenu… » empty state.
- [x] Mobile (375px) + tablet (900px) + desktop (1280px): per-property cards 2/3/4-up, zero horizontal
  overflow.
- [x] Regression: breakdown dialog still opens from the global cards; clicking a per-logement card does
  nothing.

## 8. Out of scope

- Per-property click-through breakdown dialog (would need a `propertyId` param on
  `GET /finance/breakdown`).
- Per-property « Revenu total sur l'année » (full-year) cards — only year-to-date was requested.
- Extracting a shared `KpiCard` component across FinancePage / TouristTaxPage / Dashboard.
- Property filter on the whole finance page.

## 9. Open questions

- Q: Show logements with zero revenue as `0 €` cards, or hide them?
  - A (resolved 2026-07-18): show them at `0 €` — stable layout, and « une boxe par logement » reads
    as *every* logement.
