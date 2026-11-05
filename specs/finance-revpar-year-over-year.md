# Finance — RevPAR and last-year comparison on the dashboard

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/hc-l3` (integrated through `feature/finance-reporting-hippocamp`) |
| **Created** | 2026-11-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Validation: the design page of the « Finance reporting, inspired by HIPPOCAMP » set, section
`#occupation` (lot 3), approved by Adrien on 2026-11-05. Product decisions D-HC6 (the year-over-year
pill and its single notice), D-HC7 (one comparability rule, the booking pace's) and D-HC8 (every
figure panel states its source).

This spec **adds** to `specs/finance-dashboard-redesign.md` (the dashboard's source of truth). It
changes none of that spec's rules or fields: rules 17-21 and 33 (comparison with last year), 23-25
(occupancy, revenue per night, RevPAR) and 51 (the 750-day custom window) are reused as they are.

---

## 1. Context

The Suivi financier already shows occupancy per logement, nights sold and the revenue per night sold,
and computes a RevPAR for the « Logements » tile and its table (`finance-dashboard-redesign.md` rule
25). Two things are missing for an operator who steers by them:

- **RevPAR as a headline figure.** The average price per night says whether the stays are sold dear;
  only RevPAR (revenue per open night) rises both when the logements fill better and when they sell
  dearer. It is computed today only per logement, inside a table.
- **Last year beside each figure.** Only the revenue carries a year-over-year badge (`hero.yoy`). The
  design page puts a pill « ↑ +21,3 % (N-1 : 15 210 €) » on each tile — points « pt » for a rate — and,
  when no last year compares, « — vs N-1 » with one notice saying why (D-HC6).
- **Last year on the occupancy chart for the whole scope.** The per-logement small multiples carry
  last year already (rule 23); the design's single « Taux d'occupation par mois » chart draws « Tous
  les logements » this year solid and last year dashed.

HIPPOCAMP, studied for this set, removes the nights blocked from sale from the offer before computing
its occupancy. GuestFlow already does (rule 24: establishment closures, global and per logement, and
the nights before a logement's data starts are neither sold nor sellable). This spec keeps that
denominator and reads it, never a second one.

## 2. Goal

On the Suivi financier, every headline figure — revenue, collected, stays, nights sold, occupancy,
revenue per night sold and RevPAR — can be read against the same window a year earlier, and the
occupancy chart can draw last year's line for the whole scope, all figures coming ready from the
server.

## 3. Functional rules

### 3.1 RevPAR

1. **RevPAR = the window's revenue ÷ its open nights**, rounded to the cent (`financeOccupancy.revPar`,
   rule 25 of the dashboard). The revenue is the page's (`hero.revenue`: Σ « total de séjour »,
   attribution date). The **open nights** are the occupancy denominator of the window, the same
   object that gives `hero.occupancy` (`financeOccupancy.occupancyOver`): the nights of the window
   minus the nights covered by an establishment closure (global or the logement's own, `endDate`
   exclusive) and minus the nights before a logement's data starts. The hero gains `revPar`,
   `openNights` (the denominator) and `occupiedNights` (the numerator of `hero.occupancy`), so that
   « N nuits ouvertes » and the rate are always read from one place. A stay across the window's edge
   counts its nights inside the window only.
2. **One RevPAR per scope.** With one logement selected, `hero.revPar` equals `tiles.properties.revPar`
   and the « Logements » table's `totals.revPar`; with all logements, it equals the table's
   `totals.revPar`. The revenue per night sold (ADR) is the existing `hero.revenuePerNight` — no second
   field is created for it.
3. **No open night, no RevPAR.** A window wholly closed (or before any data) has `openNights: 0`,
   `occupancy: null` and `revPar: null` — a gap, never 0 €.

### 3.2 Comparability (D-HC7)

4. **One comparable range, the dashboard's.** The comparison reads the range that already drives
   `hero.yoy`: `yearOverYear.comparableRange` (rules 17-20 — the window shifted one year back,
   clamped to the coverage start) and, while last year « as it stood » is not known (rule 33: the
   booking pace's own tracking start `paceStartOf`, a year of booking dates), only the months already
   over (`clampToMonthsOver`). `utils/financeComparison.comparisonWindow` computes it once per request
   and the dashboard's `figures()` reads it from there, so the badge and every comparison share it.
   29 February compares with 28 February (`shiftYear`).
5. **No data a year back → `reason: 'noHistory'`.** When no part of the window a year back is on or
   after the coverage start, nothing compares: `comparable: false`, and the notice reads « Pas de
   comparaison avec l'an dernier : les données commencent en <mois année>. » (« … : aucun séjour
   enregistré. » when the scope has no stay at all).
6. **Not known yet → `reason: 'notYetKnown'`.** When a range exists but none of its months is over
   and last year's snapshot is not known (rule 33), nothing compares yet. `comparableFrom` is the first
   day a part of the window will compare: the day after the window's first month ends, or the booking
   pace's `comparableFrom` (tracking start + 1 year) when that comes first. Notice: « Comparaison avec
   l'an dernier à partir du <date>. »
7. **Partial range → a notice, still comparable.** When only part of the window compares, the
   comparison holds on that part on both sides (`months` of `totalMonths`) and the notice says why:
   « Comparaison sur N mois sur M : les données commencent en <mois année>. » (coverage), or « … : un
   mois en cours se compare une fois terminé. » (rule 33's months-over clamp). A complete comparison
   has no notice. There is **one** notice per page, never one per tile (D-HC6).

### 3.3 The figures compared

8. **Seven figures, each read by the function that computes it.** `comparison.metrics` holds
   `revenue`, `collected`, `stays`, `nights`, `occupancy`, `revenuePerNight` and `revPar`. This year's
   side is read on the range's current part, last year's on its previous part, with the very
   computations of the hero and tiles: `getSummary` (revenue, stays count, collected), `stayNights`
   (nights, priced nights for the revenue per night), `occupancyOver` (occupancy, open nights for
   RevPAR). `revenue` therefore equals `hero.yoy` (current, previous, change), and on a complete range
   each `current` equals the figure shown on its tile. The operational tiles (« À encaisser », « En
   retard ») ignore the window (rule 14) and are not compared.
9. **Units and rounding.** Money, counts and per-night amounts compare in percent (`unit: 'percent'`,
   `yearOverYear.change`: one decimal). A rate compares in points (`unit: 'points'`: the difference
   of the two rates × 100, one decimal, half away from zero, never « −0 »). `current` and `previous`
   are the raw figures (rates as fractions, money to the cent); formatting stays on the client.
10. **Each figure says whether it compares, and why not.** `comparable: true` only when the page
    compares and the figure has a base. Otherwise one `reason`: the page's (`noHistory`,
    `notYetKnown`, with `current`/`previous` null), or `noPreviousValue` (last year 0 for a percent,
    or no rate because last year had no open night — never « +∞ % ») or `noCurrentValue` (no value this
    year, e.g. no night sold, so no revenue per night). Last year's « Encaissé » as it stood counts the
    payments received by `today − 1 year` only (the « Encaissé » ledger's dates), while the snapshot is
    known; otherwise (months over only) its final figure.
11. **The stays read covers the range.** The dashboard's single read of the stays' nights starts at
    the earliest of the window's start, last exercise's start and the comparable range's previous
    start, so that a custom window starting before last exercise (≤ 750 days, rule 51) reads its own
    last year. No other query is added per logement or per month.

### 3.4 Occupancy chart, all logements

12. **`occupancyAll`** — the scope's monthly occupancy over the selected exercise (all logements, or
    the selected one): for each month `current` = Σ nights sold ÷ Σ open nights of the scope, and
    `previous` = the same month a year back on rules 18, 21 and 33 (the scope's coverage; « as it
    stood » or final), **null** where the month is not comparable; a month with no open night is a gap
    (`null`). `average` is the exercise's rate. With one logement selected it equals that logement's
    series in `occupancy`. The per-logement series keep their existing `previous` (rule 23).

### 3.5 Sources and compatibility

13. **Every figure names its source (D-HC8).** Each `comparison.metrics.<key>` carries `source`:
    `'stays'` (« Sur les montants des séjours » — revenue, stays, nights, occupancy, revenue per night,
    RevPAR) or `'payments'` (« Sur les encaissements » — collected). A panel shows figures of one
    source only; the client captions it from this field.
14. **The payload only gains fields.** Every field of `GET /api/finance/dashboard` and its detail
    tables keeps its value and meaning; added: `hero.revPar`, `hero.openNights`,
    `hero.occupiedNights`, `occupancyAll`, `comparison`. A test pins the payload produced before this
    spec on a fixed fixture.

### 3.6 UI (round 2, 2026-11-05)

15. **Every tile and hero figure has its « i ».** With the new payload, the six tiles and the hero's
    figures carry a definition (`DefinitionButton`, report grammar rule 2), written in
    `constants/financeDefinitions.js`. A definition names its source when the figure reads money
    (D-HC8): « Sur les encaissements : … » for « Encaissé », « Sur les montants des séjours : … » for
    the others. The source is stated in the definitions, not as an extra caption on each panel: the
    hero and the tiles already say what they count, and a caption on every card added noise.
16. **The year-over-year pill.** « Encaissé » and « Réservations » (tiles) and « nuits vendues »,
    « taux d'occupation », « revenu moyen / nuit » and « RevPAR » (hero) show the pill of report
    grammar rule 3 from `comparison.metrics.<key>`: the server's change, in « pt » for the occupancy,
    and last year's value formatted like the figure (one decimal for a rate). A metric that does not
    compare reads « — vs N-1 ». « À encaisser », « En retard », « Logements », « Canaux » and « en
    direct » have no pill (rule 8). The revenue keeps its existing badge (`hero.yoy`). The hero's grid
    gains « RevPAR · par nuit ouverte » and « nuits ouvertes » (rules 1-2): six figures, two by row.
    Labels follow rule 25 of the dashboard: « revenu moyen / nuit », never « prix ».
17. **One notice.** `NoComparisonNotice` shows `comparison.notice` once, under the hero, above the
    pills it explains; nothing when the server sends none.
18. **Occupancy chart, last year dashed.** The « Taux d'occupation » card draws `occupancyAll` first
    as a `TrendChart` (this exercise solid with its area, last exercise dashed, named by the
    exercises' labels, months by their short name, « ⋯ » menu with the table view and the copy), in the
    selected logement's colour when one is selected. The per-logement small multiples follow under
    « Par logement » while the scope has more than one logement; with one logement they would repeat
    the chart and are not drawn. Last year's series is omitted when no month of it compares. An older
    payload without `occupancyAll` / `comparison` renders the page exactly as before.

**Edge cases:**
- Window wholly closed → `openNights: 0`, `revPar: null`, occupancy comparison `noCurrentValue` or
  `noPreviousValue`.
- Last year's month wholly closed → its rate is null → `occupancy` and `revPar` `noPreviousValue`;
  the money still compares.
- Leap year → February 2028 (29 open nights) against February 2027 (28).
- Stay across the window's end → only its nights inside the window are occupied nights.
- Exercise not started (future) → the range compares on « as it stood » once the snapshot is known,
  otherwise `notYetKnown`.

---

## 4. Architecture

> Fat backend: every figure, delta, unit, reason and notice is computed on the server. The client
> renders the pill from `comparison.metrics.<key>` and the notice from `comparison.notice`.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `financeComparison.js` | C | Pure: `comparisonWindow` (the range of rules 17-20 + 33, its status, reason, notice, `comparableFrom`), `compare` (percent / points, reasons), `pointsChange` |
| `models/` | `financeDashboardModel.js` | T | `figures()` reads its range from `comparisonWindow` (unchanged values); `getDashboard` adds `hero.revPar` / `openNights` / `occupiedNights`, `comparison`, `occupancyAll`; the stays read starts early enough for the range (rule 11); per-month occupancy factored into one helper shared by the per-logement and all-logements series |
| `utils/` | `yearOverYear.js`, `financeOccupancy.js`, `bookingPace.js` | — | Reused as is |
| `routes/`, `controllers/` | — | — | None: the existing `GET /api/finance/dashboard` carries the new fields |
| `database.js` | — | — | None |

### 4.2 Client side (`client/src/`)

The UI round (2026-11-05, rules 15-18) renders the fields with lot 0's report grammar
(`specs/report-grammar.md`). No figure, delta or comparability is computed on the client.

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `FinancePage.jsx` | T | Tiles get `info` + `comparison` (rules 15-16), the hero its pills and definitions, one `NoComparisonNotice` (rule 17), « Taux d'occupation » draws `occupancyAll` as a `TrendChart` and keeps the small multiples only for several logements (rule 18) |
| `components/` | `FinanceHero.jsx` | T | Optional `comparisons` / `definitions`; each figure may carry its « i » and its pill; « RevPAR · par nuit ouverte » and « nuits ouvertes » when the payload has them |
| `utils/` | `comparisonPill.js` | C | Presentational: a server metric → the pill's props (last year formatted, change null when not comparable); `rateOneDecimal` |
| `constants/` | `financeDefinitions.js` | C | The French definitions of the tiles and hero figures, with their source (D-HC8) |
| `api.js` | — | — | None: `getFinanceDashboard` already returns the whole payload |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `SelectableTile` (`info`, `comparison`), `YearOverYearBadge` (report mode, `onDark`), `DefinitionButton`, `NoComparisonNotice`, `TrendChart` (with `ChartMenu` / `ChartDataTable`), `SmallMultiplesLineChart` | Lot 0's grammar, unchanged |
| **Created (new generic)** | — | |
| **Specific (kept feature-local)** | `FinanceHero` (extended) | Tied to `dashboard.hero` |

### 4.3 API contract

`GET /api/finance/dashboard` — unchanged query, refusals and messages. Added fields:

```jsonc
{
  "hero": { /* …existing… */ "revPar": 2.41, "openNights": 581, "occupiedNights": 17 },
  "occupancyAll": {
    "average": 0.0293 | null,
    "months": [ { "month": "2024-08", "label": "août 2024", "initial": "A", "current": 0.0645 | null, "previous": 0.0484 | null } ]
  },
  "comparison": {
    "comparable": true, "reason": null | "noHistory" | "notYetKnown",
    "notice": "Comparaison sur 8 mois sur 12 : les données commencent en mai 2023." | null,
    "months": 8, "totalMonths": 12, "complete": false,
    "comparableFrom": null | "2026-12-01",
    "current": { "from": "2024-05-01", "to": "2024-12-31" } | null,
    "previous": { "from": "2023-05-01", "to": "2023-12-31" } | null,
    "metrics": {
      "revenue":         { "current": 1400, "previous": 1000, "change": 40, "unit": "percent", "comparable": true, "reason": null, "source": "stays" },
      "collected":       { "…": "…", "source": "payments" },
      "stays":           { "…": "…" },
      "nights":          { "…": "…" },
      "occupancy":       { "current": 0.037, "previous": 0.0251, "change": 1.2, "unit": "points", "…": "…" },
      "revenuePerNight": { "…": "…" },
      "revPar":          { "…": "…" }
    }
  }
}
```

`reason` of a metric ∈ `noHistory | notYetKnown | noPreviousValue | noCurrentValue | null`.

---

## 5. Data model

None. Read-only aggregation. **Data impact:** none.

## 6. UI / UX

Adapted from the design page `#occupation` to the existing Suivi financier instead of a separate
section: the occupancy figures already live in the hero (a light card since 2026-11-05, dashboard rule 52) (rule 8 of the dashboard: no tile repeats
them), so the hero's grid of figures grows from four to six — nuits vendues, taux d'occupation, revenu
moyen / nuit, RevPAR · par nuit ouverte, en direct, nuits ouvertes — each with its « i » and, where rule 16 says, its pill under the label. « Encaissé » and « Réservations » carry their
pill in the tile. The notice sits under the hero. « Taux d'occupation » shows the scope's `TrendChart`
(220 px, area under this year, last year dashed, names at the line ends, « ⋯ » menu) above the
per-logement small multiples. The ADR label follows rule 25 of the dashboard: « revenu moyen », not
« prix de la nuitée » and not « hors options et taxe » (see §9).

- **lg (1280):** hero two columns (revenue | 2×3 figures); tiles three across; charts side by side.
- **md (900):** hero one column, the figures' grid full width so the pills stay on one line; charts stacked.
- **xs (390):** hero one column, figures two across with the pills wrapping « (N-1 : …) » to their own
  line; tiles two across; the occupancy chart full width with fewer month ticks. No horizontal page
  scroll (checked: `scrollWidth − clientWidth = 0`).
- Copy: the definitions of `constants/financeDefinitions.js`, « RevPAR · par nuit ouverte », « nuits
  ouvertes », « Par logement », « Nuits vendues ÷ nuits ouvertes, par mois · <logement | tous les
  logements> »; the notice is the server's.
- `PageActionBar`: unchanged (« Suivi financier », « Actualiser »).

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `tests/finance-comparison-window.unit.test.js` (8) — rules 4-7, 9-10: the range is the dashboard's, the reasons and notices, `comparableFrom`, leap year, percent / points rounding, no base.
- [x] `tests/finance-revpar.unit.test.js` (5) — rules 1-3 (and 9): RevPAR with closures, open / occupied nights, one RevPAR per scope (hero = tile = table), wholly closed window, window edge, leap year.
- [x] `tests/finance-yoy-comparison.unit.test.js` (9) — rules 5-6, 8, 10-11, 13: the seven figures on a partial range, revenue = `hero.yoy`, complete range = the tiles, sources, last year closed, a custom window before last exercise, no history, not known yet, « Encaissé » as it stood.
- [x] `tests/finance-occupancy-all-series.unit.test.js` (3) — rule 12: the scope's series, gaps and non-comparable months, one logement = its series.
- [x] `tests/finance-revpar-yoy-payload-pin.unit.test.js` (7) — rule 14: the pre-change payload (exercise, one logement, one month) and its detail tables unchanged, the added fields exactly the documented ones. Fixture: `tests/financeComparisonFixture.js`, pin: `tests/fixtures/finance-dashboard-payload-pin.json` (produced by the model at `5437951d`).
- [x] `tests/vat-regime-golden.unit.test.js` — its four `finance/dashboard/*` captures rewritten for rule 14 after checking that, the added fields removed, each is byte for byte the previous capture.

### Client tests (Vitest)
- [x] `pages/__tests__/FinancePage.yoy-pills.test.jsx` (6) — rules 15-18: the tiles' and hero's pills (points for the occupancy, « — vs N-1 » without a base), RevPAR and open nights, definitions naming their source, one notice under the hero, no history, an older payload unchanged.
- [x] `pages/__tests__/FinancePage.occupancy-trend.test.jsx` (3) — rule 18: the scope's series and last year's with the table view, no dashed series without a comparable month, one logement without small multiples.
- [x] `utils/__tests__/comparisonPill.test.js` (3) — rule 16: metric → pill props, not comparable, one-decimal rate.
- Fixture: `pages/__tests__/financeComparisonFixtures.jsx`. The existing FinancePage suites (older payload) pass unchanged.
- 2026-11-05 follow-up: the five server suites pin the clock for the whole file (`mock.timers`, Date = 2026-11-05) and the closed-exercise rows of `financeComparisonFixture.js` carry `date-literal-ok` (`specs/server-test-isolation.md` rule 7, `scripts/check-test-dates.mjs --strict`). The banner became a light card (`finance-dashboard-redesign.md` rule 52), so the pills of rule 16 sit in their light-surface style; the hero is two columns from `lg` only, so each pill stays on one line from `sm` up.

### Manual UI verification (2026-11-05, isolated instance on ports 47130 / 47131, throwaway DB)
Seeded: two logements (Granja all year, Estiva closed November-March), 99 stays over 2025-2026, booking
dates from 2025-01 (snapshot known).
- [x] Desktop 1280, exercise 2026: pills on « Encaissé » (+44,4 %), « Réservations » (+20,0 %), nuits (+52,1 %), occupancy (+10,9 pt), revenue per night (−4,3 %, red), RevPAR (+45,4 %); « 579 nuits ouvertes »; RevPAR definition opens; occupancy chart 2026 solid over 2025 dashed, small multiples below.
- [x] Desktop 1280, exercise 2025: every pill « — vs N-1 » and one notice « Pas de comparaison avec l'an dernier : les données commencent en janvier 2025. »; the chart without a 2025 dashed series.
- [x] Desktop 1280, Estiva selected: the chart in Estiva's colour, no small multiple.
- [x] Mobile 390: hero figures two across, pills wrap, tiles two across, no horizontal scroll.

## 8. Out of scope

- A room-only revenue (« hors options et taxe ») — see §9.
- Comparing the operational tiles (« À encaisser », « En retard ») and the channels' commission.
- A second « as it stood » reading including the stays cancelled since (see §9).

## 9. Open questions

**Resolved by default (2026-11-05, brief rule 12 — safest and simplest):**
- Q: RevPAR and ADR on the room revenue only (« hors options et taxe », as the design page's caption
  says)?
  - A: No — on the page's revenue basis, as rule 25 of the dashboard already decides (« revenu
    moyen », extras included). The room-only part of a stay is not stored uniformly (a platform stay
    carries one net amount, no lines), so a second revenue basis would be a figure derived two ways on
    one page, and the « Logements » tile already shows a RevPAR on this basis. Adrien may reopen it as
    a separate change of rule 25.
- Q: The tourist tax inside the per-night figures (D-HC8 excludes it from the average basket)?
  - A: Kept as rule 25 has it today, for the same reason: changing the basis would change
    `hero.revenuePerNight` and `tiles.properties.revPar`, which rule 14 forbids. To revisit with rule
    25 if Adrien wants it.
- Q: « Last year as it stood » with the stays cancelled since (the booking pace's cancellation
  ledger)?
  - A: The comparison reads last year exactly as `hero.yoy` does (rule 21: the stays on the books,
    created by `today − 1 year`), so the revenue pill and the badge are one figure. The pace's rule is
    reused for **when** last year compares (tracking start, `comparableFrom`, rules 4 and 6).
- Q: Where do the comparisons live — on each tile object, or in one place?
  - A: One place, `comparison.metrics.<key>`, keyed like the hero / tile figures; the hero's scalar
    fields could not take an object without changing their type.
- Q: The per-logement occupancy series' last year?
  - A: Already present (`occupancy[].months[].previous`, rule 23); only the all-logements series is new.
- Q: A separate « Occupation » section with its own four tiles, as on the design page?
  - A: No — the hero already shows nights, occupancy and revenue per night, and rule 8 of the dashboard
    forbids a tile repeating them. RevPAR and the open nights join the hero's grid, the pills go under
    the figures. Decided in the UI round (2026-11-05).
- Q: The tiles' colour dot?
  - A: A tile with a definition shows the « i » where the dot was (`SelectableTile`, report grammar rule
    2): with the new payload the six tiles carry an « i » and no dot. An older payload keeps the dots.
