# Tariff recipes — implementation plan

Companion to [spec.md](spec.md) and [architecture.md](architecture.md). Rule numbers refer to spec §3.

**Status:** awaiting validation
**Surface:** 8 new server files (incl. the recipe itself), 8 touched · 2 new client files, 4 touched ·
1 script · 12 new test files.

The work splits into three shippable slices. Each leaves the app in a working state, and the order is
chosen so the riskiest, most-tested piece lands first with its regression net already in place.

| Slice | Steps | What it delivers |
|---|---|---|
| **A — Pricing engine** | 1 to 7 | Per-night extra guest, tier carry-forward, tourist-tax deduction, whole-euro platform grid, changeover constraint. No recipe yet; everything configurable by hand. |
| **B — Recipe engine** | 8 to 12 | Load, validate, derive, diff, apply, browse, schedule. Generic, property-agnostic. |
| **C — Aventura** | 13 to 15 | The recipe document, production configuration, rollout. |

---

## 0. Prerequisites

- [ ] Spec moved to `Approved`. Q1 to Q3 of spec §9 do not block the code — only the production
      configuration of the tourist tax and two option prices.
- [ ] Branch created from an up-to-date `master`: `feature/tariff-recipes`.
- [ ] Current branch `fix/laundry-count-explicit-option` merged first — slice A depends on its
      "linen counts from the ticked option" rule holding.

---

## Slice A — Pricing engine

### Step 1 — Regression net before anything moves

1. `cd server && npm test` → record the baseline (272 files today, all green).
2. Add `tests/pricing-baseline.unit.test.js`: quotes a property across fixed and progressive modes,
   with and without extra guests, asserting the exact current totals. **This test must stay green
   through every following step** — it is the proof that no other property moved.

### Step 2 — Schema and property fields

3. `database.js` + `schema.sql`: the nine `PRAGMA`-guarded `ADD COLUMN` blocks of architecture §2.11.
4. `propertiesModel`: read and write the new property columns and the new pricing-rule columns;
   `normalizeDateRanges` gains the two changeover keys beside `minNights`.
5. `PropertyDetail.jsx`: extra-guest unit selector, « Coût du pack accueil (direct) » field.
6. Verify: existing properties load with every legacy default and quote identically; step 1 green.

### Step 3 — Extra-guest surcharge per night (rules 37, 38)

7. `pricing.js`: the pure `computeExtraGuestSurcharge` helper (architecture §2.4), exported.
8. Wire it at [line 1155](../../server/src/utils/pricing.js#L1155); expose `extraGuestPriceUnit` and
   `extraGuestNightlyRatioTotal` in the quote.
9. `tests/extra-guest-per-night.unit.test.js`: the six D1–D6 cases of spec rule 55 to the cent; a
   `per_stay` property produces its legacy flat amount; a per-season override wins.
10. `PricingSummary.jsx`: label the extra-guest line with its unit and counts.

### Step 4 — Tier carry-forward (rule 39)

11. `pricing.js`: in `normalizeProgressiveTiers`, carry the highest provided tier forward; no tier
    provided → legacy defaults untouched.
12. `tests/tier-carry-forward.unit.test.js`: a 28-night LOW stay totals 3 562,10 €; an unconfigured
    season still matches the legacy weekly model.
13. **Explicit check before merge:** query production for `pricing_rules` with
    `pricingMode = 'progressive'` and, for each, the longest stay booked. If any exceeds its last
    configured tier, list the reservations whose re-quote would move and report them. This is the one
    place where the change can shift an existing number.

### Step 5 — Tourist-tax base deduction (rules 48, 49) — **reverted 2026-08-20**

Shipped as planned, then repealed by
[tourist-tax-base-accommodation-only.md](../tourist-tax-base-accommodation-only.md). Steps 14 to 16 no
longer describe the code: the deduction, both extra quote fields and the « Base : … − … de prestations
comprises » caption are gone, and `tests/tourist-tax-included-in-rate.unit.test.js` became
`tests/tourist-tax-base-accommodation-only.unit.test.js`.

### Step 6 — Platform grid (rules 31 to 34)

17. `pricing.js`: `grossFromNet(net, c, { fixedCost, rounding })`, `euro_up` by default.
18. `propertiesModel.platformPrices`: direct row first, extra-guest column, property loaded for
    `welcomePackCost` and `extraGuestPrice`.
19. Extend `tests/platform-price-from-commission.unit.test.js`: the whole spec rule 34 table.
20. `PropertyPricingSeasonsPage.jsx`: render the new row and column.

### Step 7 — Changeover day (rules 21 to 25)

21. `utils/changeover.js` (architecture §2.3), pure and exported.
22. `pricing.js`: `changeoverBreached` + the two required weekdays in the quote, beside the existing
    min-nights fields.
23. `reservationsController`: refuse with `code: 'CHANGEOVER'` unless `forceChangeover`, at the two
    call sites that already do this for `MIN_NIGHTS`; iCal paths untouched.
24. `ReservationPage.jsx`: reuse the min-nights confirm dialog for the changeover breach.
25. `PropertyPricingSeasonsPage.jsx`: changeover fields on the season form and the range editor;
    calendar chevrons; the effective-minimum superscript whenever it exceeds 1; the legend.
26. `tests/changeover-validation.unit.test.js`: arrival on the first night, departure on the last, a
    season-spanning stay taking one rule from each, unrestricted by default, force override saves, iCal
    never blocked.
27. `tests/discount-monotonicity.unit.test.js`: marginal night prices non-increasing and total discount
    never above 30 % up to 60 nights (rules 36, 37).

> **Slice A is shippable here.** Everything above is configurable by hand on the tariff page; the
> Aventura model can be entered manually if slice B slips.

---

## Slice B — Recipe engine

### Step 8 — Load and validate (rules 26, 27)

28. `utils/tariffRecipe.js` per architecture §2.1: the two sources, the hand-written validator, the
    cache, per-file failure isolation. `RECIPES_DIR` resolved from the data directory — **no literal
    path anywhere**.
29. `tests/tariff-recipe-load.unit.test.js` and `tests/tariff-recipe-schema.unit.test.js`: override by
    `id`, missing data directory is not an error, invalid recipe isolated with its error, and each
    validation rule rejected by name.

### Step 9 — The derivation (rules 13 to 19)

30. `utils/seasonPlan.js` per architecture §2.2: the per-day array, the four anchors, the holiday
    modifier, `runsOf`. No database, no clock, no I/O.
31. `tests/season-plan-generator.unit.test.js`: the 2026 and 2027 tables of spec rules 43–44 to the day;
    shoulders land on the anchor weekday for ten consecutive years; seasons never overlap and cover
    every day; a holiday block inside a closure is skipped; 2027's Ascension and 8 May merge.

    > **This is the step to get right.** Everything downstream — UI, scheduled task, production script —
    > is plumbing around this function.

### Step 10 — Diff and apply (rules 8 to 12)

32. `models/tariffRecipeModel.js` per architecture §2.9: `preview` / `apply`, transactional, with the
    blocking conditions; closures written before seasons.
33. `controllers/tariffRecipesController.js` + `routes/tariffRecipes.js`: the four routes.
34. `tests/tariff-recipe-apply.unit.test.js`: diff shape; orphan season removed on apply; manual seasons
    are obstacles, never targets; rollback on failure; re-apply is an empty diff; pre-horizon ranges
    survive.

### Step 11 — Browser and property card (rules 28, 29)

35. `pages/TariffRecipesPage.jsx` + its Settings route: cards, source badges, invalid-recipe errors,
    properties using each, expandable document.
36. `components/property/TariffRecipeCard.jsx` + wiring in `PropertyPricingSeasonsPage.jsx`: recipe
    select, applied version, moved-version warning, diff dialog before applying; season-key badges on
    the rows.
37. `PropertyDetail.jsx`: the read-only recipe line with its link.
38. Client tests: browser source states, card states, diff dialog, calendar markers and legend.

### Step 12 — Horizon extension (rule 12)

39. `scheduledTasks.js`: the monthly check per architecture §2.10.
40. `dashboardController` + `Dashboard.jsx`: the generated-year alert card.
41. `tests/tariff-recipe-scheduled-task.unit.test.js`: extends only when a year is missing, one alert per
    generated year, idempotent on a second run.

---

## Slice C — Aventura

### Step 13 — The recipe document

42. `server/src/recipes/aventura-lodge-2026.json` per architecture §3, with the `extraNightRatio` sugar.
43. A test asserting that **this specific recipe** produces spec rule 44's 2026 ranges and rule 55's
    engine totals end to end — the recipe is data, and data can be wrong.

### Step 14 — Changelog and spec status

44. `changelog.d/added--tariff-recipes.md`, `changelog.d/added--changeover-day.md`,
    `changelog.d/changed--platform-grid-euro-rounding.md`,
    `changelog.d/added--aventura-lodge-2026-tariff.md`.
45. Spec status `Draft` → `Implemented`; open questions resolved or restated with their answers.

### Step 15 — Production configuration script

46. `scripts/configure-aventura-lodge-2026.mjs` per architecture §6 — the non-recipe property config,
    then `tariffRecipeModel.apply()`. It does not reimplement the calendar.
47. **Pre-check before writing the closures:** [establishment-closures.md](../establishment-closures.md)
    rule 6 rejects a closure overlapping an existing reservation on the same property. Query the Lodge
    for any reservation between 15 October and 31 March across the horizon; if any exists, list it and
    stop — the closure boundary is Adrien's call, not the script's.
48. Dry-run against a **copy** of the production database restored locally
    (`scripts/backup-from-pi.sh`), and diff the resulting quotes for the Lodge's upcoming reservations.

---

## 2. Verification

### Automated

| Suite | Command | Gate |
|---|---|---|
| Server units | `cd server && npm test` | All green, including the step 1 baseline. |
| Client units | `cd client && npx vitest run` | All green (~586 tests today). |
| E2E | `npm run test:e2e` | All green (26 specs) — required by the client changes. |
| Client build | `cd client && npm run build` | No new warning. |

### Manual — run on `npm run dev`, reported explicitly

- [ ] Apply the Aventura recipe: the preview lists 2026 + 2027 exactly as spec rules 43–44; applying
      writes them; the season list and calendar match; the Gîte is untouched.
- [ ] Re-apply with no change → empty diff, nothing written.
- [ ] Drop an edited recipe in `data/recipes/`, restart → the browser shows it as « Locale » overriding
      the bundled one, and the tariff card offers the new version.
- [ ] Drop an invalid recipe → it shows as an error card, every other recipe still loads, the app boots.
- [ ] Direct reservation, 5 people, 7 nights, HIGH → 1 705,60 €, breakdown matching case D5.
- [ ] Direct reservation, 2 people, 1 night, LOW → 179,00 € (case D1).
- [ ] Set high season to 7 nights minimum, Saturday to Saturday in the recipe, re-apply → a Wednesday
      arrival is refused with the French message and savable with the force override; the calendar shows
      the chevrons and the minimum.
- [ ] Linen and cleaning shown « Comprise » at 0 €; total unchanged; tourist-tax base reduced by their
      value, and the reduction visible in the summary.
- [ ] Offering an unrelated option by hand → « Offert », **no** tax-base deduction.
- [ ] Tariff page grid matches spec rule 34 exactly, direct row included.
- [ ] The night of 11/07/2026 is high season (the deliberate one-night shift of spec rule 42).
- [ ] A 2-night stay arriving Sat 4 April 2026 prices at MID (367,20 €); a week earlier, LOW (304,30 €).
- [ ] **Regression:** a Gîte reservation quotes exactly the total recorded before the change.
- [ ] **Regression:** the Planning laundry card still counts the Lodge's sheets and towels.
- [ ] **Regression:** a platform reservation with a recorded gross amount is unchanged.
- [ ] Mobile (`xs`): recipe browser, tariff card and diff dialog, calendar markers and legend, property
      detail form, reservation summary.

---

## 3. Production rollout

1. PR reviewed and squash-merged to `master` by Adrien.
2. `master` → `release` (Adrien only) — GitHub Actions deploys to the Pi.
3. **Backup first:** `scripts/backup-from-pi.sh` before touching production data.
4. `node scripts/configure-aventura-lodge-2026.mjs` (dry run) → read the diff.
5. `node scripts/configure-aventura-lodge-2026.mjs --apply`.
6. Spot-check in the app: the recipe card shows v1.0.0 applied; the calendar matches spec rule 44; the
   platform grid matches rule 34; one existing upcoming reservation is **unchanged** (locked snapshot);
   one fresh test reservation at each season boundary.
7. Copy the grid into each channel's back office. Airbnb exposes only weekly (7+) and monthly (28+)
   discounts: use **26 %** and **29 %**, the closest expressions of the curve at those lengths.
8. Delete the test reservation.
9. Confirm the horizon covers 2026 and 2027 and that the monthly task is registered. From then on it
   extends itself and reports on the Dashboard — nothing to remember.

---

## 4. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| An apply wipes a hand-painted season | Medium — the Lodge is already configured | `seasonKey IS NULL` seasons are obstacles, never targets; every removal is shown in the preview and needs confirmation; the whole apply is one transaction. |
| The tier carry-forward moves an existing long stay | Low — needs a progressive season **and** a stay past its last tier | Step 4.13 lists affected reservations before merge; locked snapshots protect saved reservations regardless. |
| Whole-euro rounding leaks into a billed amount | Very low | Verified: `grossFromNet` has two callers, both display-only. Asserted by the extended unit test. |
| The extra-guest change alters a `per_stay` property | Low | The `per_stay` branch is the untouched legacy expression; step 1's baseline guards it. |
| The changeover check blocks a legitimate booking | Medium once enabled | Unrestricted by default; a force override on every path; iCal never blocked; enabled on no property in this delivery. |
| The tax deduction changes an already-declared tax | Low | `freezeTouristTax` runs after the deduction and keeps winning for past reservations. |
| A bad recipe file breaks the app | Low | Per-file validation, failure isolation, errors surfaced in the browser; the loader never throws at boot. |
| Following the source document literally and deleting the linen options | **High if applied as written** | Spec rule 47 and a regression check on the laundry card. |
| An existing winter reservation blocks the closure | Medium — the Lodge was sold year-round | Step 15.47 lists the offending reservations and stops before writing. |
| The recipe engine reaches another property | Very low | No recipe is the default; apply is explicit and property-scoped; the production script is scoped by property name. |

---

## 5. Deliberately not done

- Editing or creating recipes in the UI — the browser is read-only; updates are a file drop.
- A file watcher on `data/recipes/` — a restart picks up changes, and the browser says so.
- Enabling the recipe engine, or the changeover constraint, on the Gîte.
- Modifier types beyond `public_holiday_bridge`.
- Anchoring shoulders on the synced school-holiday dates.
- Conditional freebies (plancha from 2 nights, gear package from 3 nights) — manual gestures.
- Automatic rate push to the OTAs — copy-paste from the grid.
- Re-pricing existing reservations — locked snapshots keep their prices by design.
- Adding the extra-guest supplement to the tourist-tax base (spec Q2) — deferred pending the
  declaration mode.
