# Implementation plan — recurring events + tiered extra-guest price

Companion to [`spec.md`](./spec.md) and [`architecture.md`](./architecture.md).
Ordered so the suite is green at every step and the money path is proven before it moves.

---

## Step 0 — Baseline

- Run `pricing-baseline` and note it green. It is the contract for « nothing existing moved ».

## Step 1 — Extra-guest tiers, engine only

**Files:** `server/src/utils/extraGuestTiers.js` _(new)_, `server/src/utils/pricing.js`,
`server/src/tests/extra-guest-tiers.unit.test.js` _(new)_

1. `resolveTierPrice(tiers, nightIndex)` — normalisation (sort by `fromNight`, drop invalid entries),
   carry-forward of the last tier, `null` when there are no tiers.
2. Branch in `computeExtraGuestSurcharge`: tiers → tier price, no ratio; no tiers → today's
   expression, byte for byte.
3. Tests: 1/2/3/7 nights; carry-forward at night 12; a stay crossing two seasons; empty and malformed
   tier lists; a `per_stay` property unaffected.

**Done when:** the new tests pass and `pricing-baseline` has not moved.

## Step 2 — Persist the tiers

**Files:** `server/src/database.js`, `server/src/schema.sql`, `server/src/models/propertiesModel.js`

4. `pricing_rules.extraGuestTiers` TEXT NULL, idempotent.
5. Read/write it through the season CRUD; `NULL` keeps the single-price path.
6. Channel grid: gross up each tier (`extraGuestTiersByPlatform`), whole euro, same helper as today.

**Done when:** an existing property's grid is unchanged and a tiered one shows two values.

## Step 3 — Events in the plan

**Files:** `server/src/utils/seasonPlan.js`, `server/src/tests/tariff-recipe-events.unit.test.js` _(new)_

7. Step 3bis in `buildYearPlan`: for each event with dates for that year, repaint the nights with the
   event's season and override (`minNights` / `maxNights`), skipping closed days.
8. `missingEventYears(recipe, fromYear, toYear)`.
9. Tests: repaint; **beats a holiday bridge's minimum** (the rule that justifies the position in the
   pipeline); a year with no dates changes nothing; a closure is not reopened; two events do not
   fight; the plan stays pure and clock-free.

**Done when:** a single night inside the event week is bookable while the same night inside a bridge
is not.

## Step 4 — Validation

**Files:** `server/src/utils/tariffRecipe.js`, `server/src/tests/tariff-recipe-load.unit.test.js`

10. Tier shape: `fromNight` integers ≥ 1, strictly increasing, first is 1, prices ≥ 0.
11. Reject `perNightTiers` together with `followsDiscount: true` — the one that would silently halve
    the supplement.
12. Event shape: unique `key`, declared `season` exists, ISO dates, `from <= to`, the year key matches
    the dates, `minNights` ≥ 1.
13. One rejection test per rule. An invalid recipe stays isolated: the others still load.

## Step 5 — Preview, apply, alert

**Files:** `server/src/models/tariffRecipeModel.js`, routes, `client/src/pages/DashboardPage.jsx`

14. Event ranges flow through preview/apply like period ranges — conflicts named as usual.
15. `missingEventYears` on the recipe endpoint; Dashboard alert alongside the horizon one.

## Step 6 — Client

**Files:** `client/src/components/property/TariffRecipeCard.jsx`,
`client/src/components/PlatformPriceCard.jsx`, `client/src/pages/PropertyPricingSeasonsPage.jsx`,
plus their tests

16. Particularities: the tiers in French; each event with its known years; missing years in warning
    colour with the `sourceUrl` link.
17. « Personne supp. » column shows both tiers.
18. Calendar: event outline + legend entry; seasons table names the event.

## Step 7 — The Aventura recipe

**Files:** `server/src/recipes/aventura-lodge-2026.json`,
`server/src/tests/aventura-recipe-end-to-end.unit.test.js`

19. `extraGuest` → tiers 15/8; seasons drop `extraGuestPrice`/`extraGuestNetTarget`; the
    `ardechoise` event with 2026 and 2027; `version` → `1.1.0`.
20. End-to-end: the eight control cases of the source document still hold for **accommodation**
    (they are 2-guest cases, so the supplement does not enter them); the supplement cases match spec
    §3.1's table; June 2026 is high season with a 1-night minimum.

## Step 8 — Verify and ship

21. `cd server && npm test` · `cd client && npx vitest run` · `npm run test:e2e` (**stop the dev
    server first — it holds port 4000 and the suite refuses to start**).
22. Browser: apply the recipe from the preview, quote 1 and 7 nights, book a single night in the
    event week, check the card and the calendar, 390 px sweep.
23. Changelog fragments; spec Status → `Implemented`; commit, push, PR, watch CI.

---

## Sequencing note

Steps 1-2 (money) and step 3 (dates) are independent and could be two PRs. Kept as one because the
recipe in step 7 needs both, and splitting would ship a v1.1.0 recipe the engine cannot fully honour.

## What is NOT in this plan

Automatic date fetching, browser recipe editing, other events, any change to the Gîte, and any
re-pricing of existing reservations. All listed in spec §8.
