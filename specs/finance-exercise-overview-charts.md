# Finance — exercise overview charts

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/finance-exercise-charts` |
| **Created** | 2026-09-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Validation summary (interactive mock-up): `docs/specs/2026-09-28-finance-exercise-overview-charts.html`.

---

## 1. Context

The marketing site (`guestflow-site/index.src.html`, section `#finances`) shows a finance
dashboard that the application itself does not have: three KPI tiles (« Revenu de l'exercice »,
« Nuits vendues », « Part en direct »), a « Revenu par mois » column chart, a « Par logement » ranked
bar list and a « Par canal » donut. On the site these are hard-coded numbers.

The Suivi financier page (`client/src/pages/FinancePage.jsx`) today opens on the exercise selector
and two exercise cards (« Revenus depuis le début de l'exercice », « Revenu total sur l'exercice »),
then a du/au period with its own cards and charts (« Revenu par logement », « Répartition »), the
« Canaux de réservation » table, the operational follow-up and the projection.

What the server already computes (`financeModel.getSummary`): the exercise total (`yearTotal`,
`yearTotalHt`), its nights (`yearTotalNights`) and its per-logement split (`yearTotalByProperty`).
What it does not compute: any **per-month** split, any **share of direct bookings**, and the
channel split over the **whole** exercise (only `yearToDateByChannel` exists).

## 2. Goal

Open the Suivi financier on a one-glance picture of the selected exercise — how much, how many
nights, how much of it came direct, how it spreads over the months, the logements and the channels —
matching the dashboard the marketing site advertises.

## 3. Functional rules

### 3.1 Window and basis

1. Every figure of the overview describes the **selected exercise, in full** (`fiscalYear.from` →
   `fiscalYear.to`), the same set of stays as « Revenu total sur l'exercice ». The du/au period has
   no effect on it.
2. Revenue is Σ « total de séjour » (`totalSejour`, TTC, net of platform commission, caisse
   interne excluded) — the basis of every other figure on the page. HT is `htAmount` element by
   element.
3. A stay is attached to a month by its **attribution date** (`attributionDate`: solde paid date,
   else departure date), like every money window of the page. Consequence, enforced by tests:
   Σ months = Σ logements = Σ channels = `yearTotal`.

### 3.2 KPI tiles

4. **Revenu de l'exercice** — `yearTotal` TTC, with its HT beneath. Clicking opens the existing
   `yearTotal` breakdown dialog.
5. **Nuits vendues** — `yearTotalNights`. Clicking opens the same `yearTotal` breakdown (it lists the
   stays and their nights).
6. **Part en direct** — revenue of the direct channels ÷ `yearTotal`, rounded to the whole percent,
   with « X € sur Y € » beneath. **Direct = website bookings (`group: 'site'`) + stays entered
   directly (`group: 'direct'`, i.e. `isDirectChannel`)**. Not clickable.
7. The two existing exercise cards (« Revenus depuis le début de l'exercice », « Revenu total sur
   l'exercice ») **stay**, unchanged, above the overview (decision 2026-09-28): the to-date figure
   and its per-logement nights keep their own card.

### 3.3 Revenu par mois

8. One column per month of the exercise, in exercise order (a Sept closing starts in October),
   labelled by the month's initial (« J F M … »), TTC.
9. Each column is **stacked in two parts**: *encaissé ou passé* (attribution date ≤ today, sapin)
   and *à venir* (attribution date > today, miel). A closed exercise is all sapin, a future one all
   miel, the current month is usually split. A legend names both colours.
10. Tooltip: month name + year, TTC, HT, nights, and the à-venir part when non-zero.
    > **Sans test** — a Recharts tooltip needs a laid-out chart, which jsdom does not provide; checked in the manual UI verification (§7).
11. A month without revenue shows an empty slot (the axis keeps its 12 months).

### 3.4 Par logement

12. Ranked list, revenue desc (ties by name): name, TTC amount, a bar whose length is the
    logement's revenue ÷ the first logement's revenue (ratio computed by the server). Logements at 0
    are hidden; none left → empty state « Aucun revenu sur cet exercice. ».

### 3.5 Par canal

13. Donut + legend « <canal> · N % », slices sorted desc. Slices: **Direct** (the rule-6 set,
    merged into one slice) and one slice per platform (`platformDisplayName`). A channel with no
    revenue (an iCal import carrying no amount) gets no slice — it would read « 0 % » (found on the
    dev data, 2026-09-28).
14. At most **5 slices**: beyond that, the smallest merge into « Autres ». Percentages are rounded by
    the server so that they sum to 100 (largest remainder).
15. Colours: each platform keeps its colour from `constants/platforms.js` (`getPlatformColor`),
    **Direct is sapin (`primary.main`)** so it echoes the « Part en direct » tile, « Autres » is
    `DEFAULT_PLATFORM_COLOR`. The Direct chip colour elsewhere in the app is unchanged.
16. Tooltip on a slice: channel, TTC, number of reservations.
    > **Sans test** — same reason as rule 10; checked in the manual UI verification (§7).

**Edge cases:**
- Exercise with no stay → tiles at 0 € / 0 / « — » (no division by zero), month axis empty,
  both lists in their empty state.
- A stay whose logement was deleted still counts, under its stored name (same as today).
- Negative month (refund attributed to a month with no stay) → the column is drawn at 0, the
  tooltip shows the real amount; the totals keep the true figure.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `financeModel.js` | T | `getSummary` accumulates, in the existing exercise loop, the per-month and whole-exercise per-channel aggregates, and returns `exerciseOverview` |
| `utils/` | `exerciseOverview.js` | C | Pure helpers: the exercise's month list, direct-share, channel slices (merge into Direct, cap at 5 + Autres, largest-remainder percentages), logement ratios |
| `controllers/` | `financeController.js` | — | Unchanged (passes `getSummary` through) |
| `routes/` | `finance.js` | — | Unchanged |
| `database.js` | — | — | No schema change |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `FinancePage.jsx` | T | Renders `FinanceExerciseOverview` under the two exercise cards |
| `components/` | `FinanceExerciseOverview.jsx` | C | The block: three tiles + month chart + logement list + channel donut, from `summary.exerciseOverview` |
| `components/` | `RankedBarList.jsx` | C | Generic « label · value · proportional bar » list |
| `constants/` | `platforms.js` | — | Consumed (`getPlatformColor`, `DEFAULT_PLATFORM_COLOR`) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `EmptyState`, `FinanceBreakdownDialog`, Recharts | |
| **Created (new generic)** | `RankedBarList` | Any « top N » ranking (dashboard occupancy per logement, options sold, website sources). Takes `items: [{key, label, value, ratio}]` + a value formatter. |
| **Specific (kept feature-local)** | `FinanceExerciseOverview` | Wires the finance payload to the tiles and charts; its layout is this page's. |

### 4.3 API contract

`GET /api/finance/summary` — unchanged request; the response gains one additive key:

```jsonc
"exerciseOverview": {
  "revenue": 48867, "revenueHt": 43950.12, "nights": 369,
  "direct": { "revenue": 18661, "percent": 38 },            // percent null when revenue is 0
  "months": [                                                // always every month of the exercise
    { "month": "2026-01", "label": "janvier 2026", "initial": "J",
      "revenue": 3409, "revenueHt": 3066.2, "past": 3409, "upcoming": 0, "nights": 26 }
  ],
  "properties": [ { "propertyId": 3, "propertyName": "Le Lodge des Prés", "revenue": 16029, "ratio": 1 } ],
  "channels": [ { "key": "direct", "label": "Direct", "platform": "direct", "revenue": 18661, "reservations": 41, "percent": 38 } ]
}
```

`properties` omits logements at 0; `channels` holds at most 5 entries (the last may be
`{ "key": "others", "label": "Autres", "platform": null, … }`).

---

## 5. Data model

No schema change, no migration. Read-only aggregation over existing columns.

## 6. UI / UX

Placement, top to bottom: exercise selector → the two exercise cards (unchanged) → **exercise
overview** → du/au period and everything below, unchanged.

- **Tiles row** — three « Maison » KPI tiles (white card, 3px sapin left accent, `kpiLabel` +
  `kpiValue`), as the period cards. Copy: « Revenu de l'exercice », « Nuits vendues »,
  « Part en direct ».
- **Revenu par mois** — full-width card, `sectionHeader` title + caption « TTC · exercice
  <label> », legend « Encaissé ou passé » / « À venir ».
- **Par logement** (left, md 6) and **Par canal** (right, md 6) — equal-height cards.

Responsive:
- `lg`/`md`: three tiles on one row; month chart full width (height 220); logements and channels
  side by side.
- `xs`: tiles stacked full width; month chart keeps its 12 columns (initials only, height 180);
  logements then channels stacked; donut above its legend.

Loading / error: the block follows the page's existing `LoadingState` / `ErrorAlert` (same payload).

`PageActionBar`: unchanged (title + refresh).

## 7. Test plan

### Server unit tests — 11
- [x] `tests/finance-exercise-overview.unit.test.js`
  - Σ months = Σ properties = Σ channels = `yearTotal` (rule 3)
  - months follow the exercise order for a non-December closing (rule 8), 12 entries even when empty
  - a closed exercise is all past, a future one all upcoming (rule 9)
  - direct share merges site + saisie directe, `null` percent on an empty exercise (rule 6)
  - channel cap at 5 with « Autres », percentages sum to 100, no zero-revenue slice (rules 13-14)
  - logement ratio relative to the first, zeros omitted (rule 12)
  - the pure helpers of `utils/exerciseOverview.js`
  - the overview ignores the du/au period and carries the exercise HT (rules 1-2)

### Client tests — 6
- [x] `components/__tests__/FinanceExerciseOverview.test.jsx` — tiles and legend from a fixture,
  tile click opens the breakdown (the direct-share tile does not), channel colours (rule 15), empty
  exercise shows « — » and the empty states, nothing renders before the summary.
- [x] `pages/__tests__/FinancePage.test.jsx` — the two exercise cards stay (rule 7, citation added).

### Manual UI verification (2026-09-28, copy of the dev database)
- [x] Current exercise 2025-2026: months, logements and channels all equal the revenue tile (22 630,41 €).
- [x] Future exercise 2026-2027: every column miel; tooltip shows TTC, HT, nights and « dont … à venir ».
- [x] Revenue tile opens the « Revenu total sur l'exercice » breakdown.
- [x] 1280 / 900 / 375 px: no horizontal scroll, 12 columns readable on a phone.
- [x] Regression: period cards, « Revenu par logement », « Canaux de réservation » unchanged.

## 8. Out of scope

- Changing the period section, its charts or the « Canaux de réservation » table.
- Month-to-month comparison with the previous exercise.
- Splitting a stay's revenue across the months of its nights (see rule 3).
- Clicking a month / logement / channel to drill down.

## 9. Open questions

All resolved on 2026-09-28 (interactive summary, then questionnaire):

- Q: Replace the two exercise cards, or add the block alongside them?
  - A: **Alongside** — the two cards stay above the overview (rule 7).
- Q: What does the miel colour of a month mean?
  - A: **The part still to come** — stacked column, attribution date > today (rule 9).
- Q: What counts as « direct »?
  - A: **Website + saisie directe** (rule 6).
- Q: Attach a stay to a month by attribution date or spread it over its nights?
  - A: **Attribution date**, so the months add up to the exercise total (rule 3).
