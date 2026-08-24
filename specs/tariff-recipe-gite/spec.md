# Gîte — automatic tariff recipe

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `feature/tariff-recipe-gite` |
| **Created** | 2026-08-24 |
| **Author** | Adrien |
| **Companion** | [etude.md](etude.md) — the analysis this spec rests on |
| **Builds on** | [tariff-recipes](../tariff-recipes/spec.md) (the recipe engine), [platform-price-from-commission](../platform-price-from-commission.md) (the channel grid) |
| **Related PR** | (link once opened) |

---

## 1. Context

The Lodge's tariff became a **recipe** in August 2026: one declarative JSON document holding the
seasons, the rules that carve the year into them, the prices, the discount curve and the minimum
stays — so 2027 is derived rather than redrawn, and every channel's price comes from one net target
([specs/tariff-recipes/spec.md](../tariff-recipes/spec.md)). The Gîte was left out of that work.

Today the Gîte's tariff exists only as its residue: 5 rows in `pricing_rules`, 13 progressive tiers
each, and date ranges painted by hand on the tariff page. Three consequences:

1. **2027 is unpriced past 8 January.** The painting stops there. Every night after that would fall
   back to the engine's 100 €/night default.
2. **The reasoning is nowhere.** Why nights 3 to 7 cost 40 % of the base, why the peak block runs
   11 July → 21 August, why April is its own season — none of it is written down, in the app or
   outside it.
3. **A season is silently broken.** Très haute's tiers contradict the model every other season
   follows *and contradict their own long-stay tail*, under-pricing the 42 highest-demand nights of
   the year by 16,5 % ([etude.md §1.3](etude.md)).

And the Gîte has no net target: `pricing_rules.netTargetPerNight` is NULL on all five seasons, so
the channel grid grosses the **displayed** price up as if it were net, and every channel's price
already contains the own-channel margin.

## 2. Goal

Express the Gîte's whole tariff model as a recipe — one document, five seasons, a calendar derived
from rules for as many years ahead as needed, one discount table, one net target per season — so that
the price is the same as today wherever nothing was wrong, and the years to come need no one to draw
a calendar.

---

## 3. Functional rules

### 3.1 The pivot

1. **The displayed price is the anchor, the net target is derived.** The rate GuestFlow bills today
   on the own channel is kept as the displayed price; the net target is what survives the 5 % Lodgify
   engine fee: `net = round2(displayed × 0,95)`.
2. **The identity must hold in both directions.** `ceil(net / 0,95)` must return the displayed price
   unchanged, per season. This is the only check that proves the net was persisted rather than
   dropped by the apply — a failure that shipped once on the Lodge
   ([tariff-recipes §3.6 rule 34bis](../tariff-recipes/spec.md); trap 15 of the `tariff-recipe`
   skill). Asserted in the test suite, season by season.
3. **Très haute's displayed price moves from 537,50 € to 538 €.** The channel grid rounds up to the
   whole euro, so a half-euro base cannot be reproduced by rule 2. +0,50 €/night; every other season
   is unchanged.
4. **Every other channel is grossed up from the net, never from the displayed price.** Existing
   behaviour of [platform-price-from-commission](../platform-price-from-commission.md); the recipe
   only supplies the pivot it was missing.

### 3.2 The degressivity

5. **A week is four nights.** Nights 1 and 2 at the full rate; a 7-night week at exactly 4 × the
   nightly rate, nights 3 to 7 interpolating linearly; past a week, each further night at a seventh
   of a week. One table for the five seasons:

   | Nights | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
   |---|---|---|---|---|---|---|---|---|
   | Discount | 0 % | 0 % | 20 % | 30 % | 36 % | 40 % | 42,857 % | 42,857 % |

   This is the model the four sound seasons already bill, reproduced to the cent.
6. **The 8-night row is not a duplicate of the 7-night one.** Without it the engine's carry-forward
   repeats the *7th night's marginal price* (100,80 € in Très basse) instead of a seventh of a week
   (144 €), and a two-week stay loses 15 %.
7. **Très haute's curve is rebuilt from rule 5** rather than kept. Its stored tiers price a week at
   1 794,75 € while its own 15th-night tier (307 €) is a seventh of a 2 150 € week, and its 6th night
   is billed 21,50 €. The repair raises a peak week from 1 794,75 € to 2 152 €.
8. **The 8th night costs more than the 7th, and that is kept.** A consequence of the week-based
   model. Totals never decrease; only the marginal price goes back up once, at the week boundary.
   _(See §9 Q4.)_

### 3.3 The calendar

9. **The year is derived from six rules**, in declaration order, last write wins:

   | # | Rule | Season |
   |---|---|---|
   | base | the whole year | Très basse |
   | 1 | 1 → 30 April | Basse |
   | 2 | 1 May → 30 October | Moyenne |
   | 3 | the first Saturday-to-Saturday week of July (7 nights) | Haute |
   | 4 | the last whole Saturday-to-Saturday week of August (7 nights) | Haute |
   | 5 | everything between rules 3 and 4 | Très haute |
   | 6 | 19 December → 1 January | Haute |

10. **The year-end block straddles 31 December**, so 1 January belongs to the *previous* year's
    block and stays in high season.
11. **Derived against the current painting, 2026 differs by 4 days**, and each is a defect in the
    painting: 01/01/2026 was left in Très basse although the painting already puts 01/01/2027 in
    Haute; 01–03/04/2026 were left in Très basse because the painting started April's low season on
    the first Saturday.
12. **Horizon: two calendar years**, the current one and the next — the Lodge's value, and the
    scheduled task generates the following year when the horizon moves.
13. **No public-holiday modifier in this version.** `public_holiday_bridge` caps its raise at the
    highest rank, which on the Gîte is Très haute (a full-August price): switched on unchanged it
    prices 25 December and 1 January at 538 € and splits the calendar into 24 ranges. _(See §9 Q1.)_
14. **No recurring closure.** The Gîte is open all year, unlike the Lodge.

### 3.4 Stay constraints

15. **Minimum 2 nights on every season**, as today. Nine of the 24 stays on the books are exactly
    2 nights.
16. **No maximum stay.** The Lodge's `maxNights: 7` would have refused the Gîte's single largest
    booking of 2026 (14 nights).
17. **No changeover day.** The three peak weeks of 2026 started on a Sunday, a Saturday and a Monday;
    a Saturday-to-Saturday rule would have refused two of the three.

### 3.5 What the recipe does not touch

18. **The Gîte stays whole-house priced.** No included-guest threshold, no extra-guest supplement:
    `basePriceIncludedGuests = 0` and `extraGuestPrice = 0` are unchanged, and the recipe declares no
    `extraGuest` block. _(See §9 Q3.)_
19. **No welcome pack.** `welcomePackCost` stays 0 — the direct displayed price carries no fixed cost
    to finance, unlike the Lodge's.
20. **What is included in the rate is unchanged**: bed linen is a property default marked « offered »,
    cleaning (80 €/stay) and bath linen (8 €/person) are billed on top. Options are per-property, not
    recipe-owned ([tariff-recipes §3.1 rule 6](../tariff-recipes/spec.md)).
21. **The tourist-tax configuration is untouched** — `per_day_per_person` at 1,20 €. Every price in
    this spec is exclusive of it.
22. **Season labels and colours are reused verbatim** from the Gîte's current seasons, so the first
    apply **adopts** them instead of blocking on them ([tariff-recipes §3.2 rule 9bis](../tariff-recipes/spec.md)).

**Edge cases:**
- A stay straddling two seasons → the discount tier comes from the position in the stay, the price
  from the season of each night (existing engine behaviour, covered by control case G6).
- A stay longer than the 8 declared nights → the last tier repeats, i.e. a seventh of a week, for
  ever (control case G5, 14 nights).
- A date outside the generated horizon → the scheduled task generates the missing year and surfaces
  it on the Dashboard; nothing silently falls to the 100 €/night default.
- Applying the recipe while 2026 stays are on the books → saved reservations keep their prices
  through the existing locked snapshot; only unsold dates re-price.

---

## 4. Architecture

> **Fat backend, thin frontend.** This change adds **data**, not code: a recipe is a JSON document
> consumed by the existing loader, calendar generator and apply. No client change, no engine change.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `recipes/` | `gite-2027.json` | C | The Gîte's whole tariff model: 5 seasons with displayed price + net target, the shared discount table, the 6 calendar rules, no closure, no modifier. |
| `utils/` | `tariffRecipe.js` | — | Unchanged — loads and validates the new file like any other. |
| `utils/` | `seasonPlan.js` | — | Unchanged — the four anchors the recipe uses already exist. |
| `models/` | `tariffRecipeModel.js` | — | Unchanged — the apply writes the seasons, ranges and net targets. |
| `tests/` | `gite-recipe-end-to-end.unit.test.js` | C | The shipped file, end to end: validation, the two arithmetic identities, the 2026/2027 calendars to the day, full-year coverage, and 8 priced control cases through `calculateReservationQuote`. |

**Notes:** no new dependency, no migration, no route, no controller. The recipe is picked up on the
next server restart and applied by the operator from the property's tariff page.

### 4.2 Client side (`client/src/`)

Nothing. The recipe browser (`TariffRecipesPage.jsx`), the property's `TariffRecipeCard.jsx` and the
tariff page all render whatever the API returns.

**Component reuse declaration:** none consumed, none created — no client file is touched.

### 4.3 API contract

Unchanged. The new recipe appears in `GET /api/tariff-recipes` and becomes selectable on
`GET /api/properties/1/pricing`.

---

## 5. Data model

No schema change. Applying the recipe writes existing columns on `pricing_rules` for property 1:
`seasonKey`, `seasonRank`, `netTargetPerNight`, `maxNights`, `changeoverArrival`,
`changeoverDeparture`, `progressiveTiers`, `dateRanges`, plus `tariffRecipeId` /
`tariffRecipeVersion` on `properties`.

**Data impact:** the apply previews as a diff and is transactional. Reservations already saved keep
their prices through the locked tariff snapshot; unsold dates re-price. The five existing seasons are
**adopted** rather than replaced, because the recipe declares their exact labels.

Re-priced dates, measured over the 24 stays of 2026: 18 identical to the cent, 6 changed for
+1 379,50 € in total, of which +1 197 € is the repair of Très haute ([etude.md §4](etude.md)).

## 6. UI / UX

No new screen and no new string. The recipe shows up in **Paramètres → Recettes tarifaires** (source
« Livrée », version 1.0.0) and becomes selectable on the Gîte's tariff page, where the apply dialog
shows the diff before writing. Both screens already exist and are already responsive.

`PageActionBar`: unchanged on both pages.

## 7. Test plan

### Server unit tests
- [x] `tests/gite-recipe-end-to-end.unit.test.js` — the shipped file validates, and each season
      prices 2 nights at 2 × base, a week at 4 × base and every further night at a seventh of a
      week, with a total that never decreases (rules 5-8).
- [x] — `ceil(net / 0,95)` returns each season's displayed price, and `net = price × 0,95`
      (rules 1-3).
- [x] — the 2026 and 2027 calendars are derived to the day (rules 9-11).
- [x] — 2026, 2027 and 2028 are covered day for day, with no gap and no double-paint (365/366 days).
- [x] — applied to a property, 8 control cases quote to the cent, including a stay straddling the
      peak/high boundary and one running into 1 January; minimum 2 nights, no ceiling (rules 15-17).

### Manual UI verification
- [ ] **Not done — needs the operator.** Applying the recipe to the production Gîte re-prices unsold
      2026 dates (§5) and is a commercial act, so the apply is deliberately left to Adrien. To be
      checked when it runs: the diff dialog shows the five seasons **adopted** (not created), the
      four days of §3.3 rule 11 as the only 2026 range change, and 2027 generated in full.
- [ ] Tariff page, mobile and desktop: the seasons table and the calendar render the generated 2027.
- [ ] Platform grid: the **Direct** row reproduces 252 / 303 / 326 / 382 / 538 € exactly.

## 8. Out of scope

- **Rolling the grid out to the channels.** No booking engine was touched, no quote was taken,
  nothing was published. That is the `platform-tariff-rollout` skill's job and it starts once §9 is
  answered.
- **`public_holiday_bridge` and its missing rank cap** (§9 Q1) — an engine change.
- **The Gîtes de France commission** (§9 Q2) — a global platform setting, not recipe-owned.
- **Any change to what is included in the rate**, to the extra-guest model, or to the tourist tax.
- **Declaring the change in the tariff journal** (`tariff_change_events`) — written by the apply
  itself when it runs, and by hand for the platform go-live.

## 9. Open questions

- **Q1 — Turn the public-holiday long weekends on?** The Lodge raises every « pont » one rank with
  the block's own length as a minimum stay, and the Gîte's May long weekends visibly sell above base.
  Blocked on a rank cap: without one, `public_holiday_bridge` prices 25 December at 538 €. The fix is
  an optional `capSeason` on the modifier — about 4 lines in `seasonPlan.js`, a validation line and a
  test, defaulting to today's behaviour. Turning it on re-prices already-open dates.
  - A: …
- **Q2 — What is the Gîtes de France commission?** Stored as 0 % while the channel carries 15 of the
  Gîte's 24 bookings and 84 % of its gross. Observed on the seven bookings that record one: 14,02 %
  overall, individual rates from 6,90 % to 19,58 %. The grid cannot be derived for the main channel
  until the contractual rate is known.
  - A: …
- **Q3 — Whole-house price, or base + extra guest?** The Gîte's per-person costs (bath linen 8 €/pers,
  cleaning 80 €/stay) sit outside the rate, so a full house adds 160 € to a 504 € weekend. Three
  models in [etude.md §5 Q3](etude.md); the recipe keeps the first.
  - A: …
- **Q4 — Smooth the week boundary?** Nights 3 to 7 cost 100,80 € in Très basse, the 8th 144 €.
  Extending the 7th night's marginal price instead would cut a 14-night peak stay by 15 % (about
  645 € on the one 14-night booking of 2026).
  - A: …
- **Q5 — Keep five seasons?** Basse exists for April alone, 20 % above Très basse and 7 % below
  Moyenne — one more rank to configure on every channel for 30 nights a year.
  - A: …
