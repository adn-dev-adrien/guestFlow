# Finance — dashboard redesign of the Suivi financier

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/finance-dashboard-redesign` |
| **Created** | 2026-09-29 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Validation summary with the interactive mock-up: `docs/specs/2026-09-29-finance-page-redesign-v2.html`
(version 3). The earlier three-direction exploration is in
`docs/specs/2026-09-29-finance-page-redesign-proposals.html`. The visual finish after the first
release (rules 30-32: radii, ink banner, calendar graduations) is in
`docs/specs/2026-09-29-finance-dashboard-polish.html`.

Supersedes the UI of `specs/finance-exercise-overview-charts.md` (the « vue de l'exercice » block is
replaced by this page) and the layout sections of `finance-overview-rework.md`,
`finance-per-property-revenue-chart.md`, `finance-card-breakdown.md` and
`finance-upcoming-payments-table.md`. Their business rules — « total de séjour », attribution date,
element-by-element HT, settled / remaining-to-pay — are unchanged and reused.

---

## 1. Context

The Suivi financier grew one block at a time: two exercise cards, a du/au period with three cards,
« Revenu par logement », a « Répartition » pie, « Canaux de réservation », the « vue de l'exercice »
added in 3.6.0, the operational follow-up with four tabs, and a projection accordion. Each block has
its own window (exercise, du/au, global, a date) and several repeat the same figure. The page is long,
hard to read, and shows none of the figures a lodging operator steers by: occupancy, revenue per night
sold, comparison with last year, cost of each channel.

Adrien asked (2026-09-29) for a page that is pleasant to look at, taking accounting tools (Qonto,
Pennylane) as the visual reference and hotel/campsite software (Septeo, Mews, Cloudbeds) as the
reference for the figures. Three directions were mocked up; the retained design is direction A
(« banque ») with the green hero of direction C, iterated three times with Adrien.

## 2. Goal

One dashboard, one window, no duplicated figure: the operator picks an exercise, a month or dates and
optionally a logement, reads the essentials in the hero, and opens any detail table from its tile —
without losing anything today's page shows.

## 3. Functional rules

### 3.1 Window and filters

1. **One window drives the page**: *Exercice* (the selected exercise, default), *Mois* (a month of
   that exercise) or *Personnalisée* (du / au). The exercise selector stays; the month list is the
   selected exercise's months.
2. A *Personnalisée* window whose start is after its end, or with a missing date, is **refused**:
   message « La date de début doit précéder la date de fin. » / « Choisissez deux dates. », the page
   keeps the previous window. The server rejects it too (400).
3. **Logement filter**: « Tous les logements » (default) or one logement. It filters every figure,
   chart and table of the page, including the operational tiles.
4. Exercise, window kind, month, du / au and logement live in the URL (`?exercice=&periode=&mois=&du=
   &au=&logement=`), so the back button from a reservation restores the view.
5. Money follows the page's existing basis: Σ « total de séjour » (TTC, net of platform commission,
   caisse interne excluded), attributed by **attribution date**; HT element by element.

### 3.2 Hero (banner)

6. Shows the window's revenue, its HT, the number of stays, and « au <date> » while the window is
   running.
7. **Goal bar** — shown only on the *Exercice* window, with no logement filter, when a goal is set for
   that exercise (§3.8): « N % de l'objectif · reste X € » and « objectif Y € ». Capped at 100 % visually,
   the text keeps the real percentage.
8. Four figures that no tile repeats: **nuits vendues**, **taux d'occupation**, **revenu moyen par nuit
   vendue**, **part en direct**.
9. **Cumulative curve** of the window's revenue (weekly points past 62 days, daily below), current
   year solid; last year dashed **only when every month of the window is comparable** (§3.6).
   Otherwise the legend says the curve comes once the whole period has a year of history.
   Its graduations follow rule 30.
10. Hovering the curve shows the date, this year's cumulated revenue and, when drawn, last year's.

### 3.3 Faits marquants

11. Three short insights, written by the server in French, under the hero:
    - **best month** of the selected exercise (revenue, and last year's when comparable);
    - **commissions avoided by direct**: direct revenue × the average commission rate of the
      platforms over the window (commission ÷ gross, on platform stays whose commission is known);
      hidden when no platform stay has a known commission;
    - **late payments**: count and amount overdue, or « Aucun paiement en retard ».

### 3.4 Logements strip

12. Placed **above** the hero, because it filters it. One card per logement plus « Tous les
    logements »: revenue of the window, occupancy, revenue per night. The selected card is outlined.

### 3.5 Tiles and detail tables

13. Six tiles, each opening **its** table directly under the tile row; clicking the open tile (or ✕)
    closes it. **No tile is open on arrival.** Only one table is open at a time.

| Tile | Headline · caption | Table (heir of) |
|---|---|---|
| **Encaissé** | amount · « N % du chiffre d'affaires » | Every payment received **for the window's stays**, newest first: date, reservation, client, logement, kind (acompte, solde or « versement plateforme », complément, complément fin de séjour, note en séjour, pourboire / réduction à l'arrivée), amount; refunds as negative lines. Same buckets, exclusions (caisse interne, internal refunds) and commission netting as `comptaCollected`, so the total **is** the tile. A payment's date may fall outside the window; it is shown as it is; a missing date falls back to the stay's attribution date. *(breakdown « Encaissé », « Répartition »)* |
| **À encaisser** | amount · « N séjours » | Today's « Paiements en attente », unchanged: **finished stays not yet settled**, all exercises, their remaining-to-pay; acompte / solde checkboxes, « Tout solder », row → reservation. Field « Arrivées d'ici le <date> » (default today + 1 month) with the three totals *total de séjour · déjà encaissé · reste* of today's projection. *(« Paiements en attente », « En attente de règlement », « Projection à une date »)* |
| **En retard** | amount (error colour) · « N séjours · tous exercices » | Today's « Paiements en retard », unchanged: **direct** stays whose acompte or solde is past due (platforms collect their own guests), elements overdue with their due dates, amount, « Marquer payé ». *(« Paiements en retard »)* |
| **Réservations** | « N séjours » · « N à venir » | Stays of the window: client, logement, dates, channel, nights, total de séjour, payment chips (réglé / reste, acompte, solde). Filter **De la période · À venir** — the second is today's « Réservations à venir » (the next 5 per logement), unchanged. *(« Réservations période », « Réservations à venir », breakdowns of the revenue cards)* |
| **Logements** | « N logements · en tête : X » (one logement selected: its revenue · RevPAR) | Per logement: nights, occupancy, revenue per night, RevPAR, TTC, HT, change vs last year. Row → filters the page on that logement. *(« Revenu par logement »)* |
| **Canaux** | « − X € » · « commissions payées » | Website grouped by source (stays, nights, net, **demandes · conversion**), then each platform and « Direct (saisie) »: stays, nights, gross, commission, net, share. Channels with no stay are hidden. *(« Canaux de réservation »)* |

14. « À encaisser » and « En retard » are operational: they ignore the window (labelled « tous
    exercices ») but honour the logement filter. Every other tile follows the window.
15. Checking a payment or « Tout solder » / « Marquer payé » PATCHes the reservation through the
    existing payment endpoint, then reloads the dashboard (all figures move together). A write the
    server refuses shows its message above the open table and reloads nothing.
16. On `xs`, every table becomes stacked cards (the `OperationalPaymentsTable` pattern), checkboxes
    included.

### 3.6 Comparison with last year (N-1)

17. **Coverage start** = the first day of the month of the earliest reservation (`kind =
    'reservation'`, by start date) **in the filtered scope** (all logements, or the selected one).
18. A month *M* is **comparable** when *M − 1 year* is on or after the coverage start. Nothing is ever
    compared to a month that has no data.
19. **Charts**: last year's bar / dashed line appears on comparable months only.
20. **Change badges** (hero, logement table): computed over the comparable part of the window only,
    on both sides — the window shifted one year back, clamped to the coverage start, and the same
    span this year; a *Mois* or *Personnalisée* window works the same way. When not every month of the
    window is comparable, the badge says so (« sur N mois comparables »). With no comparable month,
    no badge.
21. Last year is read **as it stood a year ago** for months not yet over (reservations created on or
    before today − 1 year), so an ongoing month compares like with like.
    > In production (data since April 2026) the first badges appear in April 2027.

### 3.7 Charts

22. **Revenu par mois** — the selected exercise's months. Each month: this year's column stacked
    *encaissé ou passé* (sapin) / *à venir* (miel), and **last year's column next to it** (sand) on
    comparable months. The window's months are highlighted when the window is not the whole exercise.
    Tooltip (2026-09-29): **one line per year**, month + year + amount — « Juillet 2026 : 11 938 € »
    (with « (dont X € à venir) » on the same line when non-zero), then « Juillet 2025 : 12 257 € » on
    comparable months.
23. **Taux d'occupation** — **one small chart per logement** (one colour per logement), 12 months,
    this year solid with points, last year dashed on comparable months; header « moy. N % ». A closed
    month is a gap, never a 0. The tooltip of a small chart speaks **of its logement only**: month,
    this year, last year.
24. **Occupancy** = nights sold ÷ sellable nights. Sellable nights of a logement in a month = days of
    the month minus nights covered by `establishment_closures` (global rows and that logement's rows;
    `endDate` exclusive). Nights sold = nights of `kind = 'reservation'` stays falling in the month
    (night-based, independent of the attribution date). Nights **before a logement's data starts**
    (the first day of the month of its earliest stay) are neither sold nor sellable: such a month is a
    gap on the chart, never 0 %, and does not dilute the rate of a longer window (found on the
    production copy, 2026-09-29: data starts in April 2026).
25. **Revenu moyen par nuit** = revenue ÷ nights sold of the stays of the window. **RevPAR** =
    revenue ÷ sellable nights of the window. Both on the page's revenue basis (extras included) — the
    labels say « revenu moyen », not « prix de la nuitée ».

### 3.8 Annual goal (Settings)

26. Settings → **TVA & exercice** → card « Exercice comptable », under the closing month: section
    « Objectif de chiffre d'affaires » with **two fields**, the current exercise and the next one
    (labelled with their exercise label, « (en cours) » on the first).
27. An empty field means « no goal » (the bar disappears). A value must be a number **> 0 and
    ≤ 10 000 000 €**, at most 2 decimals; spaces and a decimal comma are accepted. Invalid → the field
    turns red with its message (« L'objectif doit être supérieur à 0 €… », « Un montant en euros, sans
    lettres… », « Montant trop élevé… ») and **Enregistrer is disabled**. The server re-validates (400).
28. Below the current exercise's field, a hint shows today's revenue and the resulting percentage.
29. The goal is net of commissions, like the hero figure (the hint says so).

### 3.9 Visual finish (feedback of 2026-09-29, after 3.7.0)

30. **The curve is graduated on the calendar, never on its sampled points**: the 1st of each month
    (« oct. », « nov. »…) past 62 days, the 1st, 8th, 15th, 22nd and 29th (« 8 août ») below. When a
    month name could appear twice (window over 366 days), January is labelled by its year (« 2026 »).
    The server sends the graduations (`hero.axis`) and each point's position in days (`x`); the client
    draws a numeric axis and never computes a date. Labels that would overlap are skipped, the first
    one is kept. *Why:* the points are weekly from the window's first day, so labelling them gave
    « 22 oct., 19 nov., 17 déc. » — a day of the month that changed at every tick.
31. **The banner is ink** (`#27251F`, the theme's text colour) with honey accents (`#E3B566`: the
    kicker line, the curve, the goal bar): a flat fill, no gradient, no halo, every text opaque or at
    80 % white at least. The four figures sit in a 2 × 2 grid separated by hairlines, each cell
    vertically centred. *Why:* on a desktop screen the green gradient and the honey halo lay under
    « 28 % » and « 14 % », and the translucent pill-shaped cells made the text look off-centre; Adrien
    chose ink over a flat fir green and over a white card.
    > **Sans test** — a colour choice, checked on screen at 1440 and 390 px (manual verification of
    > rules 30-32 below and the polish summary).
32. **Radii follow the design system**: 14 px for every card (banner, tiles, insight cards — the
    theme's `shape.borderRadius`, i.e. `borderRadius: 1` in `sx`), 10 px for inner frames (logement
    strip cards, the banner's figure grid, occupancy charts, the detail panel's summary), 8 px for icon
    badges, 6 px for tooltips. A plain number in `sx.borderRadius` is **multiplied by 14**: 3.5 gave
    49 px tiles and 4.5 a 63 px banner in 3.7.0, so inner radii are written in px.

**Edge cases:**
- A logement with no sellable night in the window (closed all along) → occupancy « — », never ÷ 0.
- Empty window → hero 0 €, figures 0 / « — », tables in their empty state, charts keep their axes.
- A reservation whose logement was deleted still counts, under its stored name (as today).
- A refund attributed to a month with no stay → the column is drawn at 0, the tooltip keeps the
  negative amount (as in 3.6.0).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
**Compose, never rewrite.** Every money rule already lives, tested, in `financeModel` — « total de
séjour », attribution date, HT, `comptaCollected`, remaining-to-pay, settled. The dashboard model
**calls** `getSummary`, `getOperational` and `getProjection` and never re-derives a stay's figures.

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `finance.js` | T | `GET /dashboard`, `GET /dashboard/detail/:tile`, `GET /goal-context`; `/summary`, `/breakdown`, `/projection`, `/operational` removed with the old page |
| `controllers/` | `financeController.js` | T | Pass the query through, map `{ ok:false, status, error }` to the response |
| `models/` | `financeDashboardModel.js` | C | Resolves window / exercise / logement, composes financeModel, adds occupancy, year-over-year, insights, the payments ledger and the per-channel commission; returns ready-to-render payloads |
| `models/` | `financeModel.js` | T | `getSummary`, `getOperational`, `getProjection` gain `propertyId`; `getSummary` gains `knownAt` (rule 21) and returns `exerciseMonths` (the 3.6.0 overview reduced to its months); `getGoalContext()`; `getBreakdown` removed; shared helpers exported |
| `models/` | `settingsModel.js` | T | `revenueGoals` column whitelisted |
| `controllers/` | `settingsController.js` | T | Validates and merges `accounting.revenueGoals`, one error per exercise (rule 27) |
| `utils/` | `revenueGoals.js` | C | Pure: parse, validate, merge, read the goals |
| `utils/` | `financeWindow.js` | C | Pure: resolve *exercice / mois / personnalisée* into bounds, reject invalid windows |
| `utils/` | `financeOccupancy.js` | C | Pure: sellable nights with closures, nights sold, occupancy from each logement's data start, revenue per night, RevPAR |
| `utils/` | `yearOverYear.js` | C | Pure: coverage start, comparable months, comparable range, change (rules 17-21) |
| `utils/` | `financeInsights.js` | C | Pure: the three French insight lines (rule 11) |
| `utils/` | `exerciseOverview.js` | T | Reduced to `exerciseMonths` |
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE app_settings ADD COLUMN revenueGoals TEXT` |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `FinancePage.jsx` | T (rewrite) | URL state, loads `/dashboard`, lays out strip → hero → insights → tiles + detail → charts |
| `components/` | `FinanceHero.jsx` | C | Ink banner: revenue, badge, goal bar, 4 figures in a grid, cumulative curve (Recharts `AreaChart`, numeric axis on `hero.axis`) |
| `components/` | `PeriodSelector.jsx` | C | Generic: segmented *Exercice / Mois / Personnalisée* + month select / date pair with its refusal message |
| `components/` | `ChoiceCardStrip.jsx` | C | Generic: horizontally scrollable selectable cards (label, value, caption, colour dot) |
| `components/` | `InsightCard.jsx` | C | Generic: icon + bold line + caption, tone (success / warning / error / info) |
| `components/` | `SelectableTile.jsx` | C | Generic: KPI tile with pressed state and the pointer toward its open panel |
| `components/` | `YearOverYearBadge.jsx` | C | Generic: « ▲ +12 % vs N-1 · sur 6 mois comparables » from server figures |
| `components/` | `SmallMultiplesLineChart.jsx` | C | Generic: one small line chart per series, solid current / dashed previous, per-chart tooltip |
| `components/` | `MonthlyRevenueChart.jsx` | C | Finance-specific: stacked current column + last year's column, window highlight |
| `components/` | `FinanceDetailPanel.jsx` | C | Finance-specific: the six tables of rule 13, each with its `xs` card layout |
| `components/` | `OperationalPaymentsTable.jsx` | T | Reused as is for « À encaisser » |
| `components/` | `ChannelBreakdownCard.jsx` | Removed | Its table is rebuilt inside `FinanceDetailPanel` (« Canaux »), with the commission / net columns and the website sub-rows |
| `components/` | `FinanceExerciseOverview.jsx`, `RankedBarList.jsx`, `FinanceBreakdownDialog.jsx` | Removed | Superseded; no other consumer |
| `components/` | `FinanceHero.jsx`, `MonthlyRevenueChart.jsx`, `SmallMultiplesLineChart.jsx` | — | Their tooltips are named exports (`CurveTooltip`, `MonthTooltip`, `SeriesTooltip`) so jsdom can test them: Recharts draws nothing without a layout |
| `components/` | `SettingsFiscalYearSection.jsx` | T | « Objectif de chiffre d'affaires » fields + validation + hint (rules 26-29) |
| `api.js` | `api.js` | T | `getFinanceDashboard(params)`, `getFinanceDashboardDetail(tile, params)`; old finance getters removed |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `EmptyState`, `ErrorAlert`, `LoadingState`, `StatusBadge`, `PlatformChip`, `OperationalPaymentsTable` | |
| **Created (new generic)** | `PeriodSelector`, `ChoiceCardStrip`, `InsightCard`, `SelectableTile`, `YearOverYearBadge`, `SmallMultiplesLineChart` | Next users: the tourist-tax and accounting pages (period selector), the dashboard (tiles, insights), tariff statistics (small multiples). |
| **Specific (kept feature-local)** | `FinanceHero`, `MonthlyRevenueChart`, `FinanceDetailPanel` | Tied to the finance payload and its six tables. |

### 4.3 API contract

`GET /api/finance/dashboard?fiscalYear=2026&period=fy|month|custom&month=2026-09&from=&to=&propertyId=`

```jsonc
{
  "window": { "kind": "fy", "from": "2026-01-01", "to": "2026-12-31", "label": "Exercice 2026", "asOf": "2026-09-29" },
  "fiscalYear": { "key": 2026, "label": "2026", "from": "…", "to": "…", "isCurrent": true, "previousLabel": "2025" }, "fiscalYears": [ … ],
  "months": [ { "month": "2026-01", "label": "janvier 2026" } ],        // the Mois selector's options
  "propertyId": null,
  "hero": {
    "revenue": 61453, "revenueHt": 55866, "stays": 137, "nights": 450,
    "occupancy": 0.36, "revenuePerNight": 127, "directShare": 0.40,
    "yoy": { "current": 40120, "previous": 39700, "change": 1.1, "months": 9, "totalMonths": 12 } | null,
    "goal": { "amount": 85000, "ratio": 0.72, "remaining": 23547 } | null,
    "cumulative": [ { "day": "2026-01-01", "x": 0, "current": 812, "previous": null } ],   // x = days since the window's first day
    "axis": [ { "x": 0, "label": "janv." }, { "x": 31, "label": "févr." } ]              // rule 30
  },
  "insights": [ { "key": "bestMonth", "tone": "success", "title": "Juillet, meilleur mois de l'exercice", "text": "11 938 €, contre 12 257 € l'an dernier." } ],
  "properties": [ { "propertyId": 1, "name": "…", "color": "#2F5D46", "revenue": 22104, "occupancy": 0.38, "revenuePerNight": 154 } ],
  "totalRevenue": 61453, "totalOccupancy": 0.36,                        // « Tous les logements » card (never filtered)
  "tiles": {
    "collected": { "amount": 52692, "shareOfRevenue": 0.86 },
    "toCollect": { "amount": 5127, "stays": 12 },
    "late": { "amount": 7054, "stays": 20 },
    "stays": { "count": 137, "upcoming": 17 },
    "properties": { "count": 4, "leader": "Lodge" } | { "count": 1, "name": "…", "revenue": 22104, "revPar": 61 },
    "channels": { "commission": 6225 }
  },
  "revenueMonths": [ { "month": "2026-01", "label": "janvier 2026", "initial": "J", "past": 3409, "upcoming": 0,
                       "revenue": 3409, "revenueHt": 3099, "nights": 26, "previous": 3100 | null,
                       "previousLabel": "janvier 2025", "inWindow": true } ],
  "occupancy": [ { "propertyId": 1, "name": "…", "color": "#2F5D46", "average": 0.38 | null,
                   "months": [ { "month": "2026-01", "label": "…", "initial": "J", "current": 0.22 | null, "previous": 0.18 | null } ] } ]
}
```

`GET /api/finance/dashboard/detail/:tile` — same query; `:tile ∈ collected | toCollect | late | stays
| properties | channels`; extra `until=` for `toCollect`, `scope=window|upcoming` for `stays`. Each
returns `{ rows, totals }` shaped for its table (amounts, labels, due dates, chips), never computed on
the client. Unknown tile → 404; invalid window or unknown logement → 400 `{ error }`.

`GET /api/finance/goal-context` — `{ current: { key, label, revenue }, next: { key, label } }` for the
Settings goal fields (rules 26 + 28).

`PUT /api/settings` (existing) — `accounting.revenueGoals: { "2026": 85000, "2027": null }`.

Logement colours come from a fixed server-side palette in `properties` order (sapin, miel, bleu,
brique, then the platform-neutral greys), so a logement keeps its colour across charts.

---

## 5. Data model

- `app_settings.revenueGoals TEXT` — JSON object `{ "<exercise key>": amount }`, default `NULL`.
  Idempotent `ADD COLUMN` in `database.js`; existing installs start with no goal. No other change.
- **Data impact:** none on existing records; read-only aggregation otherwise.

## 6. UI / UX

Order, top to bottom: `PageActionBar` (« Suivi financier », refresh) → toolbar (exercise + period
selector) → logements strip → ink hero → three insight cards → six tiles (+ open table) → « Revenu
par mois » and « Taux d'occupation » side by side.

- **lg / md**: hero on two columns (figure + goal | four figures), curve full width inside the hero;
  tiles 6 across on a wide screen (xl, ≥ 1536 px) and 3 across below, since the
  sidebar leaves too little room for six readable captions; charts side by side (lg), stacked (md).
- **xs**: toolbar stacked; strip scrolls horizontally; hero single column; insights stacked; tiles
  2 across; open table as cards; charts stacked, small multiples one per row. No horizontal page
  scroll.
- Loading: `LoadingState` for the page, a lighter spinner in the detail panel while its table loads.
  Error: `ErrorAlert` with retry, per call.
- Copy is French and lives next to the components (the page's `TILES` configuration, `PERIOD_MESSAGES`
  in `PeriodSelector`, `TITLES` in `FinanceDetailPanel`).
- A payment the server refuses (e.g. `409` on a drifted reservation) shows its message in an
  `ErrorAlert` above the open table; nothing is reloaded.

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `finance-window.unit.test.js` (4) — rules 1-2: the three window kinds, refusals.
- [x] `finance-occupancy.unit.test.js` (5) — rules 24-25: closures (global, per logement, exclusive end),
      closed month = gap, ÷ 0 guarded, revenue per night, RevPAR.
- [x] `finance-year-over-year.unit.test.js` (6) — rules 17-21: coverage per scope, comparable months,
      partial badge, like-for-like « as it stood », no badge without history.
- [x] `finance-insights.unit.test.js` (3) — rule 11: best month, commissions avoided (hidden without
      known commission), late payments wording.
- [x] `finance-dashboard.unit.test.js` (7) — rules 3, 5-9, 13-14, 22: payload shape; Σ months = Σ
      logements = hero revenue; operational tiles ignore the window but honour the logement; goal only
      on the exercise without filter.
- [x] `finance-dashboard-detail.unit.test.js` (6) — rule 13: each table's total equals its tile; payment
      ledger kinds and refunds; « Arrivées d'ici le » totals; website sources with conversion.
- [x] `finance-exercise-months.unit.test.js` (4) — the exercise's month list the charts and the Mois
      selector share.
- [x] `settings-revenue-goals.unit.test.js` (6) — rules 26-27: validation, empty = no goal, persistence.
- [x] `finance-curve-axis.unit.test.js` (5) — rule 30: one graduation per month on the 1st, weekly on a
      month, a custom window starting mid-month, January named by its year on a long window, points
      and graduations on the same day scale.
- Removed with their code: `financeBreakdown.unit.test.js`, `finance-exercise-overview.unit.test.js`;
  the breakdown case of `finance-refunds.unit.test.js` now reads `getSummary`.

### Client tests
- [x] `PeriodSelector.test.jsx` (3) — rules 1-2: month window, reversed and missing dates refused.
- [x] `SelectableTile.test.jsx` (2) — rule 13: expanded state, controlled panel.
- [x] `YearOverYearBadge.test.jsx` (3) — rules 18, 20: hidden without comparison, partial wording.
- [x] `SmallMultiplesLineChart.test.jsx` (5) — rules 10, 22, 23: the three chart tooltips (curve;
      one line per year; own logement only, gap never 0 %).
- [x] `FinancePage.dashboard.test.jsx` (6) — rules 4, 12, 13, 15, 16: no tile open on arrival, tile
      opens / closes its table, logement strip above the hero and in the URL, window read from the
      URL, payment checkbox PATCHes then reloads, a refused payment shows its message, cards on xs.
- [x] `SettingsFiscalYearSection.revenue-goals.test.jsx` (4) — refusals disable Enregistrer, hint.
- [x] `FinanceDashboard.radii.test.jsx` (3) — rule 32: tile and banner at 14 px, logement card at
      10 px, as the browser computes them from the theme.
- Removed with their components: the `FinanceExerciseOverview`, `RankedBarList`,
  `FinanceBreakdownDialog`, `ChannelBreakdownCard` suites and `FinancePage.test.jsx`.

### Manual UI verification (2026-09-29, isolated instance on a copy of the dev database)
- [x] Hero, logement table and channel table add up; each tile equals its table's total, for the
      exercise, a month, a custom window and one logement; the reversed window is refused.
- [x] Ticking a solde in « À encaisser » moves the tile (4 399 € → 3 693 €) and removes the row.
- [x] Month tooltip on one line per year; occupancy tooltip on its own logement only.
- [x] Goal set in Réglages → TVA & exercice shows in the hero (75 %, reste 7 370 €).
- [x] Every block of today's page found again (mapping table of the summary HTML).
- [x] 375 / 900 / 1280 px, no horizontal page scroll; tables as cards on a phone.
- [x] E2E suite.

### Manual UI verification of rules 30-32 (2026-09-29, dev database)
- [x] 1440 px: ink banner, figures centred in their grid, tiles and strip at 14 / 10 px; graduations
      oct. → sept. on the exercise, 1 / 8 / 15 / 22 / 29 août on a month, « 2025 … 2026 » on a
      21-month custom window.
- [x] 390 px: banner single column, graduations thinned without overlap, no horizontal scroll.
- [x] Client Vitest (1407), server suite (4587), E2E suite (84 passed, 1 skipped).

## 8. Out of scope

- Occupancy and price « hébergement seul » (extras excluded) — revenue per night uses the page's basis.
- Pace / pickup and booking lead time: `createdAt` of iCal stays is the import date.
- Guest origin, returning guests, reviews: data missing or too sparse.
- Goals per logement or per month.
- Changing the accounting or tourist-tax pages.

## 9. Open questions

All resolved on 2026-09-29:

- Q: Delivery in one PR or several?
  - A: **One PR, three commits** (settings goal · dashboard API · page), so the app is never
    half-migrated between merges.
- Q: Direction, occupancy chart, last year in the month chart, default tile?
  - A: Direction A with the green hero of C; small multiples per logement; last year's column side by
    side; no tile open on arrival (mock-up version 3).
- Q (2026-09-29, after 3.7.0): colour of the banner once the gradient and halo go?
  - A: **Ink** (`#27251F`) with honey accents, chosen on `docs/specs/2026-09-29-finance-dashboard-polish.html`
    over a flat fir green and a white card (rule 31).
