# Report grammar — KPI tiles, panels, tab counts and report charts

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/hc-l0` (integrated into `feature/finance-reporting-hippocamp`) |
| **Created** | 2026-11-05 |
| **Author** | Adrien |
| **Related PR** | (the integration PR of « Finance reporting, inspired by HIPPOCAMP ») |

---

## 1. Context

The HIPPOCAMP benchmark (`docs/rapports/2026-11-05-benchmark-hippocamp.html`, section « Graphiques
et mise en page », approved by Adrien on 2026-11-05) found that their recent report screens share one
layout grammar: four figures first, each with its definition and its change against last year; then
white panels titled in small capitals, two per row; the detail in tabs that show their size; and
charts with a light area under the main curve, last year dashed, each series named at its end, a
legend that doubles as a switch, and a menu to read the chart as a table.

GuestFlow has pieces of this (`SelectableTile`, `YearOverYearBadge`, `PageTabs`, the finance charts)
but no generic report building blocks: every new report screen would re-roll its tiles, legends and
« no comparison » wording. Five feature lots (tourist tax, accounting synthesis, RevPAR/N-1, stay
profile, data checks) are about to build report screens; this lot 0 gives them one grammar.

Product decisions applied (2026-11-05): D-HC5 (theme palette, never a dual y axis, no pie — a thin
segmented bar + table, last year dashed, series named at the line end, toggle legend, « ⋯ » menu with
« Voir en tableau » / « Copier les données ») and D-HC6 (tile anatomy, « ↑ +21,3 % (N-1 : 15 210 €) »,
points for rates, « — vs N-1 » plus ONE notice when there is no comparable year).

## 2. Goal

Whoever builds a report screen composes it from ready-made, tested components that look and behave
like the approved design page, on desktop and phone, without writing chart or tile code of their own.

## 3. Functional rules

1. **Extend, never break.** Existing components (`SelectableTile`, `YearOverYearBadge`, `PageTabs`)
   only gain OPTIONAL props. A consumer that passes none of them renders byte-identical markup to the
   integration base (5437951d) — the Suivi financier and every current page are unchanged.
2. **KPI tile anatomy.** `SelectableTile` can show: its label with a « i » definition button, the
   value, a secondary line (the existing `caption`), and a year-over-year pill. Without `onClick` the
   tile is a static figure (`<div>`, not a button). The definition opens on a click and closes on a
   second click, a click outside or Escape (focus returns to the « i »); its accessible name is
   « Définition : <label> ». On a selectable tile the « i » is a sibling of the tile's button, never
   nested in it.
3. **Year-over-year pill.** In report mode `YearOverYearBadge` reads « ↑ +21,3 % (N-1 : 15 210 €) »:
   arrow, signed change with one decimal and a typographic minus, then last year's value as sent by
   the server. A rate moves in points (« ↓ −2,4 pt (N-1 : 55,1 %) »). Green when the change goes the
   good way (`better`: higher by default, lower on demand), red otherwise, neutral under 0,05
   (« = 0,0 % »). The change and last year's value come from the server; the badge only formats them.
4. **No comparison.** When there is no comparable last year (change null) the pill reads « — vs N-1 »
   in the neutral tone. Never an infinite or division-by-zero percentage.
5. **One notice says why.** `NoComparisonNotice` shows, once per report, the server's sentence
   explaining the missing comparison; with no text it renders nothing.
6. **Tab counts.** A `PageTabs` item may carry `count` (a number from the server), drawn as an outlined
   pill after the label in the tab's own colour and read as part of the tab's name
   (« Encaissements 40 »). 0 is a count.
7. **Panel.** `Panel` is the white report card titled by a small uppercase tracked label — the new
   `panelLabel` typography role in `theme.js` — rendered as a heading (h3 by default) that names the
   section; an optional action sits right of the label.
8. **TrendChart lines.** Lines over a category axis; a light area (10 % fill) under each series flagged
   `area`; a `dashed` series is last year; a null value is a gap, never a 0. Each visible series is
   named at its last point, in ink with a white halo, and the names are pushed apart (≥ 14 px) so they
   never overlap each other.
9. **Legend as a switch.** Each legend item is a toggle button (`aria-pressed`); a hidden series is
   crossed out and its swatch faded. Series flagged `hidden` start off. When every series is off, one
   line says « Toutes les séries sont masquées. » instead of an empty chart.
10. **Chart menu.** Every report chart has a « ⋯ » button (`ChartMenu`, « Options du graphique ») with
    « Voir en tableau » ↔ « Voir le graphique » and « Copier les données ». The copy is CSV — semicolon
    separator, decimal comma, raw numbers, empty cell for a gap, header row — and the menu says
    « Données copiées » or « Copie refusée par le navigateur »; a refusal is never silent.
11. **Table view.** « Voir en tableau » renders the same data as an accessible table (caption = the
    chart's name, one row per category, one column per series, values formatted by the chart's
    formatter, « — » for a missing value), scrolling inside its own box.
12. **Axes and pointer.** One y axis, never two, formatted by the `formatAxis` prop. X labels stay
    horizontal; about 7 ticks on a wide screen, about 4 on a phone. The chart fills its container's
    width. A crosshair and a tooltip follow the mouse or the finger and list the visible series with a
    value at that category.
13. **Colours.** Every chart colour comes from `palette.chart` (through `utils/chartColors.js`). A
    series without its own colour takes the next hue of the new `palette.chart.categorical` list
    (sapin, miel, bleu, olive, prune — the existing chart hues minus the alert red), each ≥ 3:1 on
    white; a dashed series without colour takes `lastYearEdge`.
14. **Aligned daily + cumulative charts.** `AlignedDailyCumulativeCharts` stacks two charts on the
    same time axis with one shared cursor (Recharts `syncId`, both x axes `band`): bars for the amount
    per period on top, the cumulative line with its light area below, plus last year's cumulative
    dashed when the server sends it; both lines are named at their end. One tooltip gives the period's
    amount, running total and last year's running total. Same « ⋯ » menu and table view as rules 10–11.
    The running totals come from the server.
15. **ShareTable.** Part-to-whole is a thin bar (12 px, 2 px gaps) of segments whose widths ARE the
    server's shares, above a table: swatch, label, quantity (column optional), amount, share, and the
    server's total row. Hovering or focusing a row brings its segment forward and dims the others;
    hovering a segment does the same for its row; leaving clears it. A 0 share draws no segment but
    keeps its row. Rows are reachable by keyboard.
16. **Motion and touch.** Every animation or transition of the grammar (definition pop-in, dimming,
    tile hover) is switched off under `prefers-reduced-motion: reduce`. Interactive controls offer a
    44 px target on touch (legend toggles, menu items, the « i » via the shared touch hit area).
17. **A dev-only workbench.** `/design/report-grammar` shows every component of the grammar with the
    fixture data (`pages/reportGrammarFixtures.js`), with a « Avec l'an dernier / Premier exercice »
    switch. It exists only in a development build (`import.meta.env.DEV`): absent from production,
    from every menu and from every role's routes.
    > **Sans test** — a development-only page with no behaviour of its own: each component it shows is
    > covered by its own test, and the production build is checked not to contain it (§7).

**Edge cases:**
- A series whose values are all null → no line, no end label, still listed in the legend and table.
- A KPI tile with `info` but no `comparison` → no pill (the pill only appears when `comparison` is sent).
- A copy where `navigator.clipboard` is missing (insecure context) → « Copie refusée par le navigateur ».
- Long series or row labels → table labels wrap on word boundaries; a tile label wraps beside the « i ».

---

## 4. Architecture

> **Fat backend, thin frontend.** This lot is client-only and computes no figure: values, deltas,
> shares, running totals, totals and the no-comparison sentence arrive from the server (lots 1–5).
> The only client logic is presentational: pivoting aligned arrays into chart rows, laying out end
> labels in pixels, choosing a tick interval, and serialising the shown data to CSV.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| all | — | — | (none — client-only lot) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `theme.js` | `theme.js` | T | `palette.chart.categorical` (rule 13), `panelLabel` typography role (rule 7) |
| `utils/` | `chartColors.js` | T | `categoricalColor(index)` |
| `utils/` | `reportChart.js` | C | Pure helpers: `lastValueIndex`, `layoutEndLabels`, `tickInterval`, `rowsFromSeries`, `toCsv` |
| `components/` | `SelectableTile.jsx` | T | Optional `info`, `comparison`; static mode without `onClick` |
| `components/` | `YearOverYearBadge.jsx` | T | Optional report mode: `previous`, `unit`, `better`, `showEmpty` |
| `components/` | `PageTabs.jsx` | T | Optional item `count` |
| `components/` | `DefinitionButton.jsx` | C | The « i » + its non-modal definition |
| `components/` | `NoComparisonNotice.jsx` | C | The one « why no N-1 » notice |
| `components/` | `Panel.jsx` | C | White report card with its small-caps label |
| `components/` | `ChartMenu.jsx` | C | « ⋯ » menu: table view toggle + CSV copy with feedback |
| `components/` | `ChartDataTable.jsx` | C | Accessible table view of a category × series chart |
| `components/` | `ChartEndLabels.jsx` | C | Series names at line ends inside a Recharts chart (hooks `useXAxisScale`/`useYAxisScale`) |
| `components/` | `TrendChart.jsx` | C | The report line chart; exports `TrendTooltip`, `SeriesLegend`, `withColors`, `ALL_HIDDEN` |
| `components/` | `AlignedDailyCumulativeCharts.jsx` | C | Bars + cumulative, synced; exports `DailyTooltip` |
| `components/` | `ShareTable.jsx` | C | Segmented bar + table, linked highlight |
| `pages/` | `ReportGrammarPreview.jsx` | C | Dev-only workbench (rule 17) |
| `pages/` | `reportGrammarFixtures.js` | C | Fixture figures shared by the workbench and the tests |
| `App.jsx` | `App.jsx` | T | Dev-only lazy route `/design/report-grammar` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `SelectableTile`, `YearOverYearBadge`, `PageTabs`, `PageActionBar`, `SegmentedSelect`, `utils/touchHitArea`, `utils/visuallyHidden`, `utils/formatters` | Extended, not forked. |
| **Created (new generic)** | `DefinitionButton`, `NoComparisonNotice`, `Panel`, `ChartMenu`, `ChartDataTable`, `ChartEndLabels`, `TrendChart`, `AlignedDailyCumulativeCharts`, `ShareTable` | Used by lots 1–5 (tourist tax, accounting synthesis, occupancy/RevPAR, stay profile, data checks). `ChartMenu` / `ChartDataTable` serve any chart, including the existing finance ones later. |
| **Specific (kept feature-local)** | `ReportGrammarPreview` | A dev workbench, no product use. |

### 4.3 API contract

None. The props contracts below are what lots 1–5 shape on the server:

- **KPI tile** `<SelectableTile label value caption? info? comparison?={ change, previous?, unit?, better? } />`
- **Trend chart** `categories: [{ key, label }]`, `series: [{ key, name, values: (number|null)[], color?, area?, dashed?, hidden? }]`
- **Aligned charts** `categories`, `daily[]`, `cumulative[]`, `previousCumulative?[]`
- **Share table** `rows: [{ key, label, quantity?, amount, share (0–1), color? }]`, `total: { quantity?, amount }`

---

## 5. Data model

None.

## 6. UI / UX

Reference: the approved design page, section « Graphiques » (`#graphiques`), rebuilt in MUI with the
« Maison » theme.

- **KPI row:** 4 tiles per row from `md`, 2 per row on a phone (the page's grid decides). Tile value
  1.3 rem (1.18 rem on xs), label `kpiLabel`, the « i » 24 px top-right with a 44 px touch area, the
  definition a dark bubble under it. The pill's « (N-1 : …) » part wraps to its own line when the tile
  is narrow.
- **Notice:** info-soft band under the KPI row, info icon, the server's sentence.
- **Tabs:** count pill outlined in `currentColor`, so it turns sapin with the selected tab.
- **Panels:** white, 1 px divider border, radius 14, label `panelLabel` (0.74 rem, uppercase, tracking
  0.09 em, muted); two per row from `md`, stacked on a phone.
- **TrendChart:** legend toggles left, « ⋯ » right; 220 px tall; right margin 92 px (70 on xs) for the
  end names. Table view scrolls inside a 260 px box.
- **Aligned charts:** 110 px bars + « CUMUL » caption + 176 px cumulative chart; both share the y-axis
  width and a band x axis so the bars sit exactly above the points.
- **ShareTable:** 12 px bar, 2 px gaps; table padding tightened on xs so the rows fit 360 px.
- Copy (impersonal, short): « Définition : … », « — vs N-1 », « Séries affichées »,
  « Toutes les séries sont masquées. », « Options du graphique », « Voir en tableau »,
  « Voir le graphique », « Copier les données », « Données copiées »,
  « Copie refusée par le navigateur », « Répartition », « Total ».
- **Responsive:** no horizontal scroll on xs except inside a table's own box; checked at 390 px and
  1280 px on the workbench.
- **PageActionBar:** the workbench renders `<PageActionBar title="Grammaire des rapports" />` (no action).

## 7. Test plan

### Client tests (Vitest) — 11 new files, 46 tests

- `components/__tests__/ReportGrammar.legacy-unchanged.test.jsx` — rule 1 (8 legacy renders hashed against the base)
- `components/__tests__/SelectableTile.report-anatomy.test.jsx` — rules 2, 4, 16
- `components/__tests__/YearOverYearBadge.report-mode.test.jsx` — rules 3, 4
- `components/__tests__/NoComparisonNotice.test.jsx` — rule 5
- `components/__tests__/PageTabs.count.test.jsx` — rule 6
- `components/__tests__/Panel.test.jsx` — rule 7
- `components/__tests__/TrendChart.legend-and-menu.test.jsx` — rules 8, 9, 10, 11, 12, 16
- `components/__tests__/AlignedDailyCumulativeCharts.test.jsx` — rules 11, 14
- `components/__tests__/ShareTable.test.jsx` — rules 15, 16
- `components/__tests__/chartPalette.categorical.test.js` — rule 13
- `utils/__tests__/reportChart.helpers.test.js` — rules 8, 10, 12
- Existing suites of `SelectableTile`, `YearOverYearBadge`, `PageTabs` and the finance page stay green unmodified.

### Build

- `npx vite build` passes; the production bundle contains no « Grammaire des rapports » (rule 17).

### Manual UI verification (workbench, throwaway DB)

- [x] 1280 px: tiles, « i » bubble, tab counts, two panels per row, trend chart end names, legend
      toggle, tooltip, aligned charts with the shared cursor and the bars above the points.
- [x] « Premier exercice »: every pill reads « — vs N-1 », one notice below the row.
- [x] « ⋯ » → « Voir en tableau » renders the table; 390 px: no page-level horizontal scroll, tiles 2
      per row, share table readable.
- [x] Console: no error, no warning.

## 8. Out of scope

- Migrating the existing Suivi financier charts to the new components (they keep their own look until
  a lot touches them).
- Any server endpoint (lots 1–5).
- Printing/PDF of reports.

## 9. Open questions

**Resolved by default (2026-11-05):**
- *The `/design` page asked for no longer exists* — it was removed on 2026-08-22
  (`specs/design-system.md` §1: the design system is an internal contract, not an operator screen).
  Re-creating it would undo that decision. Default: a **dev-only** workbench at `/design/report-grammar`
  (rule 17), absent from production and menus. Dropping it later is one line in `App.jsx`.
- *KPI tile: new component or extension?* Extension of `SelectableTile` (extend before you create).
  Static mode when `onClick` is absent; the « i » lives in a new `DefinitionButton`, reusable outside
  tiles.
- *Pill glyphs:* report mode uses D-HC6's « ↑ / ↓ » and one fixed decimal; the existing finance badge
  keeps « ▲ / ▼ » and its 0,5 % stable threshold (rule 1).
- *Chart colours:* `palette.chart.series` contains the alert red (index 3) and is used per logement by
  existing charts, so it is not reordered. A new `palette.chart.categorical` list reuses the same hexes
  without the red.
- *CSV format:* semicolon + decimal comma (French spreadsheets paste it into columns), raw numbers.
- *Definition popover role:* non-modal bubble (`role="tooltip"` from MUI Popper, `aria-expanded` on the
  button), not a modal dialog — matches the design page and keeps the page usable around it.
