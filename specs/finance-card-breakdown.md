# Finance card breakdown — click a figure to see the reservations behind it

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/finance-card-breakdown` _(user-managed)_ |
| **Created** | 2026-06-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The « Suivi financier » page ([FinancePage.js](../client/src/pages/FinancePage.js)) shows five headline figures as colored cards:

- **Period cards** (depend on the `du`/`au` range): « Revenu total sur la période », « Encaissé », « En attente de règlement ».
- **Annual cards** (calendar year, independent of the period): « Revenus depuis le début de l'année », « Revenu total sur l'année ».

Each figure is an aggregate computed server-side in [financeModel.getSummary](../server/src/models/financeModel.js#L96) from the reservations of the matching window. Today the user sees only the total: there is no way to drill into *which reservations* compose a figure, nor to check that the parts add up to the headline. The « Réservations période » tab already lists the period reservations with a « Total de séjour » column whose footer equals « Revenu total », but it is not reachable from the cards, only covers one of the five figures, and is buried below the charts.

## 2. Goal

From the « Suivi financier » page, the user can click any of the five amount cards and immediately see — in a pop-up — the exact list of reservations that compose that amount, with a single amount column whose footer total equals the figure on the card. Clicking a reservation row opens its fiche (`/reservations/:id`).

## 3. Functional rules

1. The five amount cards become clickable (pointer cursor + hover affordance). Clicking a card opens the **finance breakdown dialog** for that card's metric.
2. The dialog lists every reservation that contributes to the clicked figure, one row per reservation, sorted by departure date (`endDate` ascending — same order the figures are summed in).
3. Each row shows: client name, logement, plateforme, séjour (`startDate → endDate`), and a single **amount column** holding that reservation's contribution to the figure.
4. The dialog footer shows the **total of the amount column**, which MUST equal the figure printed on the card that opened it. This is guaranteed by computing the breakdown server-side with the *same* `totalSejour` / `comptaCollected` / `isSettled` helpers used by `getSummary` — the client never recomputes a total.
5. The amount column's header label depends on the metric:
   - « Revenu total sur la période » → column **« Total de séjour »**, total = `revenueTotal`.
   - « Encaissé » → column **« Encaissé »**, total = `totalCollected`.
   - « En attente de règlement » → column **« En attente »**, total = `totalPending`.
   - « Revenus depuis le début de l'année » → column **« Total de séjour »**, total = `yearToDate`.
   - « Revenu total sur l'année » → column **« Total de séjour »**, total = `yearTotal`.
6. The amount column also surfaces the element-by-element **HT** value per row, and an HT total in the footer, consistent with the HT figure shown in small text on the card (reuses `htAmount`). HT is shown as secondary text, the TTC amount is primary.
7. Which reservations appear, and the per-row amount, per metric:
   - `revenueTotal` — all reservations of the period (`endDate` ∈ [from, to]); amount = `totalSejour(r)`.
   - `totalCollected` — period reservations whose `comptaCollected(r) > 0`; amount = `comptaCollected(r)` (rows that collected nothing are omitted — they add `0`).
   - `totalPending` — period reservations that are **past and unsettled** (`endDate < today` AND `!isSettled(r)`); amount = `totalSejour(r)`.
   - `yearToDate` — reservations of the calendar year whose `endDate <= today`; amount = `totalSejour(r)`.
   - `yearTotal` — reservations of the full calendar year (`endDate` ∈ [Jan 1, Dec 31]); amount = `totalSejour(r)`.
8. Clicking a reservation row navigates to `/reservations/:id` and closes the dialog.
9. The dialog title states the metric and its window: e.g. « Encaissé — du 01/06/2026 au 30/06/2026 » for period metrics, « Revenus depuis le début de l'année — 2026 » for annual metrics.
10. The period metrics use the page's current `du`/`au` range; the annual metrics use the current calendar year computed server-side (the client passes no dates for those, or passes them and the server ignores them).

**Edge cases:**
- Metric with zero contributing reservations → dialog opens with an empty-state message (« Aucune réservation ne compose ce montant. ») and a `0 €` footer.
- A reservation with `totalSejour = 0` (all components zero) → still listed for `revenueTotal`/year metrics (contributes `0`), to stay faithful to the set summed by the server; only `totalCollected` filters out non-contributing rows.
- `finalPrice + touristTaxTotal = 0` → row HT = `0 €` (guarded in `htAmount`).
- Rapid card switching → the dialog refetches; a stale in-flight response must not overwrite the current metric's rows.

---

## 4. Architecture

> **Fat backend, thin frontend.** The breakdown rows AND the total are computed and rounded on the server using the existing finance helpers. The client renders the payload and owns only the dialog's open/closed state and the selected metric.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `finance.js` | T | Adds `GET /finance/breakdown`. |
| `controllers/` | `financeController.js` | T | Thin `breakdown` handler: parse `metric`/`from`/`to` → model → respond (400 on unknown metric). |
| `models/` | `financeModel.js` | T | Adds `getBreakdown({ metric, from, to })`: selects the right reservation set, maps each to `{ id, clientName, propertyName, platform, startDate, endDate, amount, amountHt }`, sums the total — reusing `totalSejour` / `comptaCollected` / `isSettled` / `htAmount`. |
| `utils/` | — | — | (none — reuses existing finance helpers) |
| `database.js` | — | — | (none — read-only feature) |

**Notes:**
- `getBreakdown` shares the exact same per-reservation functions as `getSummary`, so totals are coherent by construction. To avoid query duplication, the period set reuses the same `WHERE kind='reservation' AND endDate BETWEEN ? AND ?` query (with client/property JOIN); the annual set reuses the year bounds, but with the JOIN added so rows carry client/property/platform (today's `yearRows` query is column-slim and stays as-is for the summary).
- `metric` is validated against the closed set `{ revenueTotal, totalCollected, totalPending, yearToDate, yearTotal }`; anything else → 400.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `FinancePage.js` | T | Cards become clickable; holds `breakdownMetric` state; renders `<FinanceBreakdownDialog>`. |
| `components/` | `FinanceBreakdownDialog.js` | C | Feature-local dialog: fetches `/finance/breakdown`, renders the table (one amount column + footer total), row click → navigate to fiche. |
| `api.js` | `api.js` | T | Adds `getFinanceBreakdown(metric, from, to)`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog` (or MUI `Dialog` with `fullScreen` on `xs`), MUI `Table`/`TableFooter` | Matches the projection/period tables already in `FinancePage`. |
| **Created (new generic)** | — | None — no general-purpose component emerges; the table is finance-specific. |
| **Specific (kept feature-local)** | `FinanceBreakdownDialog` | Tied to the finance metrics + amount-column semantics; not reusable elsewhere. Reuses `displayDate`, `getPlatformColor`, the `eur` formatter pattern. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/finance/breakdown?metric=&from=&to=` | query: `metric` (required, one of the 5), `from`/`to` (`YYYY-MM-DD`, used only for the 3 period metrics) | `{ metric, label, column, window: { kind:'period'\|'year', from, to, year }, total, totalHt, rows: [{ id, clientName, propertyName, platform, startDate, endDate, amount, amountHt }] }` | `total` MUST equal the matching `getSummary` figure for the same window. 400 `{ error }` on unknown metric. |

---

## 5. Data model

No schema change. Read-only feature over existing `reservations` / `clients` / `properties` columns already used by `getSummary`.

**Data impact:** none.

## 6. UI / UX

**Cards (FinancePage):** the five existing cards gain `cursor: pointer`, a subtle hover (slight elevation/opacity) and `role="button"` + keyboard activation (Enter/Espace) for accessibility. No layout change otherwise. A small hint (e.g. a discreet caption or the hover affordance) signals they are clickable.

**Breakdown dialog:**
- Title: « <Label de la carte> — <fenêtre> » (e.g. « Encaissé — du 01/06/2026 au 30/06/2026 », « Revenu total sur l'année — 2026 »).
- Body: a table with columns **Client | Logement | Plateforme | Séjour | <Amount label>**. Platform rendered as the colored chip (`getPlatformColor`). The amount cell shows TTC (primary, right-aligned) with the HT in smaller secondary text below.
- Footer row: « Total » spanning the leading columns, then the column total (TTC bold) with the HT total as secondary text — equal to the card.
- Row hover = pointer; click navigates to `/reservations/:id` and closes the dialog.
- Loading state: « Chargement… » while the fetch is in flight. Empty state: « Aucune réservation ne compose ce montant. » with a `0 €` footer.
- Close: a top-right close button + backdrop click.

**Responsive:**
- `xs` (≤600px): dialog is `fullScreen` (`useMediaQuery(theme.breakpoints.down('sm'))`). The table stays in a horizontally-scrollable container (`minWidth` ~720) inside the dialog content, mirroring the existing finance tables; the footer total stays visible. Reduced padding.
- `md`/`lg`: centered dialog (`maxWidth="md"`, `fullWidth`), table shown normally.

**Sticky action bar:** N/A — this is a dialog over the existing `FinancePage`, not a new route. `FinancePage` keeps its current header (`PageHeader title="Suivi financier"`); no `PageActionBar` change in scope.

## 7. Test plan

### Server unit tests
- [x] `tests/financeBreakdown.unit.test.js` (8 tests) — for a fixture set of reservations, asserts that for each of the 5 metrics: (a) the returned `rows` match the expected reservation set, (b) `Σ rows.amount === total`, and (c) `total` equals the corresponding `getSummary` figure for the same window (the coherence guarantee of rule 4).
- [x] Asserts `totalCollected` omits rows with `comptaCollected = 0`, and `totalPending` includes only past-unsettled rows.
- [x] Asserts unknown `metric` is rejected (model returns the 400 error path); row shape + HT; devis never leak; empty set → `0`.
- Full server suite: 1767/1767 passing.

### Manual UI verification (2026-06-22, Playwright on dev :3000)
- [x] Happy path: « Encaissé » card → dialog total `2 778,95 € / 2 470,73 € HT` = card to the cent; « Revenu total sur l'année » → `11 705,87 € / 10 416,17 € HT` (46 rows) = card.
- [x] Click a row → lands on `/reservations/12082`; dialog closed.
- [x] Annual card opens with the year window title (« … — 2026 »); period card with the du/au title.
- [x] Mobile (`xs`, 390×740): dialog full-screen (full viewport height; width = viewport − scrollbar).
- [x] Regression: « Réservations période » footer + charts unchanged.

## 8. Out of scope

- No new persisted data, no export/CSV of the breakdown.
- No drill-down into a reservation's *internal* components (acompte/solde/complément) inside the dialog — a single contribution amount per reservation is shown, per the user's request.
- No change to how the five figures themselves are computed.
- The « Suivi opérationnel » tables (overdue/pending/upcoming/period) are unchanged; only the cards gain the click-through.

## 9. Open questions

- Q: Should the dialog be reachable by URL (shareable/back-button)?
  - A: No — resolved 2026-06-22. The user chose a full-screen pop-up over the page; clicking a row navigates away to the fiche. No dedicated route.
