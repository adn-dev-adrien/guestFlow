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

The HIPPOCAMP benchmark (report of 2026-11-05, not versioned: it holds third-party screenshots; archived outside the repository; section « Graphiques
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

18. **A row of tiles reads level** (2026-11-05, lot 3 follow-up). A tile with a definition or a pill is a
    column laid from its top (`display: flex`, `flex-direction: column`, `justify-content: flex-start`):
    a `<button>` centres its content vertically whatever its `display`, so in a row where only some tiles
    carry a pill the others' labels sat 12 px lower. The legacy tile (neither `info` nor `comparison`)
    keeps its markup byte for byte (rule 1).
19. **A pill's text is readable on its soft background** (2026-11-05, lot 3 follow-up). In report mode
    the pill writes its text in the palette's `text` shade (`success.text`, `error.text`,
    `neutral.text`) on its `soft` background — each ≥ 4.5:1, small text — never in `main`
    (`success.main` on `success.soft` is 4.2:1).
20. **The charts never weigh on the first page** (2026-11-06, review R5-01). The plugin SDK sits in the
    initial bundle; it hands `TrendChart` and `AlignedDailyCumulativeCharts` out lazily
    (`components/LazyReportCharts.jsx`: `React.lazy` + a quiet placeholder of the chart's height), so
    Recharts loads with the first chart drawn. Nothing the SDK imports statically reaches `recharts`, and
    `scripts/check-bundle-budget.mjs` passes (measured: base `origin/inte/plugins` 292,0 kB gzip,
    this branch 298,3 kB, budget 313,3 kB).
21. **Y ticks on nice steps, or a fixed domain** (2026-11-06, review R5-05, shared contract with lot 3).
    Without `yDomain`, `TrendChart` and `AlignedDailyCumulativeCharts` graduate from 0 (or below a
    negative value) to just above the largest visible value on 1-2-2,5-5 × 10ⁿ steps — never
    « 0 / 4,5 / 9 / 13,5 ». With `yDomain` (`[0, 1]` for a rate) the axis is that domain, five even
    ticks (0, 25, 50, 75, 100 %).
22. **End names stay readable and inside the card** (2026-11-06, reviews R5-03, R3-10). The right margin
    is the width of the longest visible name (at least 40 px, at most 150 px — 96 px on a phone); a name
    longer than its room is cut with « … », the full name in the SVG `<title>`. Names are at least 15 px
    apart and kept inside the plot: a line ending on 0 has its name above the axis labels.
23. **The definition bubble is readable everywhere** (2026-11-06, reviews R5-02, R5-12). It takes the
    width of its text up to 280 px (and at most the screen width minus 32 px), is rendered in a
    portal with a fixed position (a card that clips its overflow never cuts it), describes its « i »
    while open (`aria-describedby`), and closes when the focus leaves by Tab — as well as on a second
    click, a click outside and Escape (rule 2).
24. **The open tile keeps its pointer** (2026-11-06, review R5-14). A selected tile with a definition or a
    pill draws the same pointer toward its panel as the legacy tile (finance-dashboard-redesign rule 13).
25. **A tile's figure is heard** (2026-11-06, review R5-15). A selectable tile with a definition or a pill
    keeps its action as its name (« Déjà payé : afficher le détail ») and is described by its body:
    value, secondary line and pill.
26. **Category labels never overlap** (2026-11-06, review R5-04). *Its « first and last kept » is superseded by rule 35.* Labels up to 5 characters keep the
    regular thinning (rule 12); longer ones (« oct. 2025 ») are thinned from their measured width, the
    first and the last kept. Servers still send short labels where they can.
27. **The copy is what the chart shows** (2026-11-06, review R5-17). « Copier les données » copies the
    visible series only; with `ratio` (values 0–1) it writes percents with one decimal and « (%) » in the
    header (« 14,6 », not « 0,1463 »).
28. **An empty period says so** (2026-11-06, review R5-08). `TrendChart`, `AlignedDailyCumulativeCharts`
    and `ShareTable` take `emptyText`: when the server says the period is empty the page passes its
    sentence, which replaces the chart (legend and menu included) or the bar and table — never a flat line
    on a « 0 / 1 / 2 € » axis or a lone « Total 0 ».
29. **A hidden series stays readable** (2026-11-06, review R5-13). Its legend text is `text.secondary`
    (5,4:1), crossed out; only its swatch fades.
30. **A chart is a figure the keyboard passes over** (2026-11-06, review R5-09). The chart is
    `role="figure"` with the chart's name, Recharts' keyboard layer is off (no invisible focus stop); the
    table view (rule 11) is its accessible reading.
31. **The bar chart shows its « 0 »** (2026-11-06, review R5-18). The top chart of the aligned pair keeps
    room under its plot for its 0 tick.
    > **Sans test** — a pixel margin of a Recharts chart, which draws nothing in jsdom; checked on the
    > workbench at 1280 and 390 px (§7).
32. **A hue is never recycled** (2026-11-06, reviews R5-07, R4-10). Series and share rows take the five
    `palette.chart.categorical` hues in order; past five, and for a row flagged `other` (« Autres »), the
    new `palette.chart.other` grey. The server groups a breakdown beyond five categories into one `other`
    row. A segment's hover text is the row's `caption` when sent (« Gîtes : 12 séjours » when the bar
    measures a count), else « label : share ».
33. **The chart menu opens without motion when asked** (2026-11-06, review R5-19). Under
    `prefers-reduced-motion: reduce` the « ⋯ » menu appears at once (no grow).
34. **The top tick hugs the largest value** (2026-11-06, verification V5-4). Of `count`, `count + 1` and
    `count + 2` intervals, the axis takes the first whose top tick leaves at most a quarter of the axis
    empty above the largest value (a 25,8 k€ cumul: 0 / 10 / 20 / 30 k€, not 0 / 20 / 40 k€).
35. **Category labels are evenly spaced** (2026-11-06, verification V5-6). The axis shows every Nth
    label from the first, never a forced last one breaking the rhythm. N is at least rule 12's thinning
    and large enough for the longest label to fit its slot of the chart's measured plot width
    (`hooks/useElementWidth`); before the first measure, long labels use Recharts'
    `equidistantPreserveStart`. The end names' margin (rule 22) takes at most 30 % of a chart's width.
    Supersedes the « first and last kept » part of rule 26.
36. **A scroll closes the definition** (2026-11-06, verification V5-5). The bubble is fixed to the screen
    (rule 23); while open, a scroll of the page or of any container closes it, so it never rides over the
    app bar while its « i » scrolls away.
37. **No dark variant of the pill** (2026-11-06, verifications V3-9, V5-10, R3-9). Since the hero became a
    light card no caller draws a pill on a dark surface: `YearOverYearBadge` has no `onDark` any more
    (its rule-1 fingerprint went with it; the other variants keep theirs).

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
| `utils/` | `reportChart.js` | C | Pure helpers: `lastValueIndex`, `layoutEndLabels`, `tickInterval`, `xInterval`, `rowsFromSeries`, `toCsv`, `niceStep`, `axisTicks`, `endLabelWidth`, `endLabelMargin`, `fitEndLabel` |
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
| `components/` | `ShareTable.jsx` | C | Segmented bar + table, linked highlight; exports `shareColors` (rule 32) |
| `hooks/` | `useElementWidth.js` | C | Measured width of the chart box (ResizeObserver), for label spacing and the end-name margin (rule 35) |
| `components/` | `LazyReportCharts.jsx` | C | The two charts as the SDK hands them out, loaded on first draw (rule 20) |
| `plugins/sdk/` | `index.js` | T | `TrendChart` / `AlignedDailyCumulativeCharts` re-exported from `LazyReportCharts` (rule 20) |
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
- **Trend chart** `categories: [{ key, label }]`, `series: [{ key, name, values: (number|null)[], color?, area?, dashed?, hidden? }]`, `yDomain?`, `ratio?`, `emptyText?`
- **Aligned charts** `categories`, `daily[]`, `cumulative[]`, `previousCumulative?[]`, `emptyText?`
- **Share table** `rows: [{ key, label, quantity?, amount, share (0–1), color?, other?, caption? }]` (at most five + one `other`), `total: { quantity?, amount }`, `emptyText?`

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

### Client tests (Vitest) — 24 files, 75 tests

- `components/__tests__/ReportGrammar.legacy-unchanged.test.jsx` — rule 1 (8 legacy renders hashed against the base)
- `components/__tests__/SelectableTile.report-anatomy.test.jsx` — rules 2, 4, 16
- `components/__tests__/YearOverYearBadge.report-mode.test.jsx` — rules 3, 4
- `components/__tests__/NoComparisonNotice.test.jsx` — rule 5
- `components/__tests__/PageTabs.count.test.jsx` — rule 6
- `components/__tests__/Panel.test.jsx` — rule 7
- `components/__tests__/TrendChart.legend-and-menu.test.jsx` — rules 8, 9, 10, 11, 12, 16, 27
- `components/__tests__/AlignedDailyCumulativeCharts.test.jsx` — rules 11, 14
- `components/__tests__/ShareTable.test.jsx` — rules 15, 16
- `components/__tests__/chartPalette.categorical.test.js` — rule 13
- `utils/__tests__/reportChart.helpers.test.js` — rules 8, 10, 12
- Lot 3 follow-up (rules 18, 19): `SelectableTile.row-alignment.test.jsx`, `YearOverYearBadge.report-contrast.test.jsx`
- Review round 2026-11-06 (rules 20–33):
  - `components/__tests__/pluginSdk.no-recharts-at-boot.test.js` — rule 20
  - `utils/__tests__/reportChart.review-fixes.test.js` — rules 21, 22, 26
  - `components/__tests__/DefinitionButton.review-fixes.test.jsx` — rule 23
  - `components/__tests__/SelectableTile.review-fixes.test.jsx` — rules 24, 25
  - `components/__tests__/TrendChart.review-fixes.test.jsx` — rules 21, 27, 28, 29, 30, 32
  - `components/__tests__/AlignedDailyCumulativeCharts.review-fixes.test.jsx` — rules 28, 30
  - `components/__tests__/ShareTable.review-fixes.test.jsx` — rules 28, 32
  - `components/__tests__/ChartMenu.reduced-motion.test.jsx` — rule 33
- Verification round 2026-11-06 (rules 34–37):
  - `utils/__tests__/reportChart.round2.test.js` — rules 22, 34, 35
  - `components/__tests__/DefinitionButton.scroll.test.jsx` — rule 36
  - `components/__tests__/YearOverYearBadge.no-dark-variant.test.jsx` — rule 37
  - `ReportGrammar.legacy-unchanged` now holds 7 fingerprints (the dark variant's went with it).
- Existing suites of `SelectableTile`, `YearOverYearBadge`, `PageTabs` and the finance page stay green; the
  consumers' chart tests wait for the lazy chart (`findBy…`) and name it as a `figure`.

### Build

- `npx vite build` passes; the production bundle contains no « Grammaire des rapports » (rule 17).
- `node scripts/check-bundle-budget.mjs` passes: 298,3 kB gzip for a 313,3 kB budget (rule 20).

### Manual UI verification (workbench, throwaway DB)

- [x] 1280 px: tiles, « i » bubble, tab counts, two panels per row, trend chart end names, legend
      toggle, tooltip, aligned charts with the shared cursor and the bars above the points.
- [x] « Premier exercice »: every pill reads « — vs N-1 », one notice below the row.
- [x] « ⋯ » → « Voir en tableau » renders the table; 390 px: no page-level horizontal scroll, tiles 2
      per row, share table readable.
- [x] Console: no error, no warning.
- [x] 2026-11-06, workbench (now with a 0–100 % occupancy chart and an empty panel): the RevPAR
      definition spans its text on one line at 1280; ticks 0 / 20 / 40 / 60 k€ and 0 / 25 / 50 / 75 / 100 %;
      « Exercice 2025-2026 » fits at 1280 and reads « Exercice 20… » at 390, inside the card; the bar chart
      shows « 0 € »; no horizontal scroll at 390.

## 8. Out of scope

- Migrating the existing Suivi financier charts to the new components (they keep their own look until
  a lot touches them).
- Any server endpoint (lots 1–5).
- Printing/PDF of reports.

## 9. Open questions

**Resolved by default (2026-11-06, review round):**
- *`onDark` (review R3-9)* — no caller passes it since the light hero card. Removed from
  `DefinitionButton` and from the pill's report mode in round 1, then from the legacy pill on 2026-11-06
  (round 2, integrator's assignment V5-10: no dead code) — rule 37.
- *Breakdown past five categories (R5-07)* — the server groups the rest into one `other: true` row; the
  component never recycles a hue (rule 32). Lots 2 and 4 must send at most five + « Autres ».
- *Rates in the CSV (R5-17)* — percent with « (%) » in the header, opt-in with `ratio` (rule 27).
- *Long category labels (R5-04)* — the component thins them by width (rule 26); short labels from the
  server remain the better fix.

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
