---
name: tariff-recipe
description: Author, review or amend a GuestFlow tariff recipe — the JSON document that declares a property's whole pricing model (seasons, calendar carving, prices, degressivity, minimum/maximum stay, changeover days, closures). Use when turning a commercial tariff document into a recipe, adding a season, changing a discount table, adjusting holiday rules, or debugging why an applied recipe produced unexpected dates or prices.
---

# Authoring a GuestFlow tariff recipe

A recipe is **data, not code**: a versioned JSON document describing *what* a property's tariff model
is. `server/src/utils/seasonPlan.js` turns it into dated season ranges; `models/tariffRecipeModel.js`
diffs it against a property and applies it. You never write date logic — you declare rules.

Read `specs/tariff-recipes/spec.md` before a substantial change; it is the source of truth.
`server/src/recipes/aventura-lodge-2026.json` is the worked example.

## Workflow

1. **Read the commercial document first, end to end.** Note every rule, including the ones stated in
   prose rather than tables (closures, what is included in the rate, direct-vs-platform differences).
2. **Check every table for internal contradictions before encoding it** — see "Traps" below. Raise
   contradictions with the user; do not silently pick a reading.
3. Write the JSON in `server/src/recipes/<id>.json`.
4. **Derive the calendar and compare it against the document's own control cases**, with a script,
   not by hand:
   ```bash
   cd server && node -e '
     const fs=require("fs");
     const {validateRecipe}=require("./src/utils/tariffRecipe");
     const {buildYearPlan,materializeClosures}=require("./src/utils/seasonPlan");
     const out=validateRecipe(JSON.parse(fs.readFileSync("src/recipes/<id>.json","utf8")));
     if(!out.valid){console.error(out.error);process.exit(1);}
     const r=out.recipe, y=2026;
     const p=buildYearPlan(r,y,materializeClosures(r,y-1,y));
     for(const k of Object.keys(p)) console.log(k, p[k].map(x=>`${x.startDate}→${x.endDate}${x.minNights?" min"+x.minNights:""}`).join(" | "));
   '
   ```
5. Add the recipe to `server/src/tests/aventura-recipe-end-to-end.unit.test.js` style coverage: the
   derived ranges **and** the priced control cases. A recipe is data, and data can be wrong.
6. Property-level configuration the recipe does not own goes in a `scripts/configure-<property>.mjs`
   script that then calls `tariffRecipeModel.apply()`.

## What is in the recipe, and what is not

| In the recipe | Per property (configure script) |
|---|---|
| Seasons: key, label, rank, colour, price, net target, degressivity, min/max nights, changeover | Capacity, beds, check-in/out, deposit |
| Calendar: base season, periods, modifiers | Options included in the rate (`property_option_defaults.offered`) |
| Recurring closures | Free units on an option (`property_option_prices.freeUnits`) |
| Welcome-pack COST price (`welcomePack.cost`) — a margin input, never guest-facing | Which options make up the pack |
| Extra-guest unit and threshold | Extra-guest price on the property |
| Horizon | Platform commissions (global, shared between properties) |

A recipe never names a property. Platform commissions are global — putting them in a recipe would
have one property's recipe silently repricing another's channels.

## Declaring the degressivity

Three mutually exclusive forms; the loader turns each into the marginal night prices the engine bills.

- `lengthOfStayDiscounts` — a **cumulative** table (`{ nights, discountPct }`), the form commercial
  documents use. **Prefer this**: the totals the operator reads in the document come out to the cent,
  because each marginal price is the difference between two cumulative totals both rounded to the cent.
- `extraNightRatio` — a flat ratio for every night after the first (`0.7` = −30 % on each extra night).
- `progressiveTiers` — explicit marginal prices, for a curve neither form expresses.

Nights past the last declared one fall to the engine's carry-forward: **the last tier repeats**.

## Traps — every one of these was paid for on the Aventura recipe

1. **"X % for N nights and beyond" is usually not implementable.** A flat discount past the last
   declared night makes that night *cheaper* than the marginal price implies, so the NEXT night costs
   more than the one before it. Check: `marginal(N+1) = base × (N+1) × (1−d) − base × N × (1−d)`
   against `marginal(N)`. If it rises, encode the table up to N and let the carry-forward extend it,
   and tell the user why.
2. **A monotonicity constraint plus a discount cap can be arithmetically impossible.** "Never more
   than 30 % off" + "a further night is never dearer" + "night 1 at full price" cannot reach 30 % at
   7 nights. Do the algebra before promising a curve; state the impossibility rather than approximating.
3. **The billed price and the net target are two different numbers.** Whole-euro channel gross-up is
   not invertible, so both must be stored (`pricePerNight` and `netTargetPerNight`). Never derive one
   from the other at read time.
4. **Rounding is per season, on that season's own base.** `247 × 0.475 = 117.325` → `117.32`, not
   `117.33` (binary floating point). Always compute the numbers with a script, never by hand.
5. **Holiday blocks are the run of consecutive non-working days minus the last day** — the guest
   checks out that morning. A Monday holiday gives 2 nights (Sat, Sun), a Thursday bridge gives 3.
6. **A holiday block already at the top rank is not raised, but still carries its minimum stay**, so
   it still splits the range. 14 juillet inside high season is the case to check.
7. **Seasons must cover the whole year with no gap** — an uncovered date silently falls back to the
   engine's 100 €/night default. Closures do not cover: they block availability, not pricing.
8. **A closure is not a season.** Declare it in `closures`; it blocks bookings and (with
   `skipClosedDays`) suppresses holiday raises, but the seasons still price those days.
9. **The first apply on an already-configured property.** A manual season is an obstacle that blocks
   the whole apply, *unless* its label matches a recipe season's — then it is adopted. Match the
   labels the property already uses, or the operator will hit a wall on day one.
10. **Never delete linen or cleaning options** because a document says the fees are removed. The
    laundry engine counts linen from the option ticked on the reservation
    (`specs/laundry-counts-explicit-option-only.md`). Mark them included in the rate instead — which
    also makes them deductible from the percentage-mode tourist-tax base.
11. **Archived and internal options must never become defaults.** An archived duplicate or an
    internal counter (`displayToClient = 0`, e.g. « Tapis de bain ») produces a phantom line on the
    fiche that is displayed, priced at 0 and dropped at save.
12. **« Direct » is not the string `direct`.** Bookings taken through the operator's own booking
    engine are recorded under `Lodgify` — 15 of 29 reservations, against 2 for `direct`. Any rule
    conditioned on "direct bookings" must go through
    [`isDirectChannel`](../../../server/src/utils/platformNameFormat.js), never a string comparison,
    or it silently never fires for the bookings it was written for. **Query the platform column for
    real counts before encoding any channel condition.**
13. **An included freebie is units, not a line.** « First breakfast for 2 offered » is `freeUnits` on
    the existing option, not a synthetic « Pack accueil » option: the guest orders all 10 breakfasts,
    2 are covered, 8 are billed, and the kitchen still prepares 10 (`billedUnits` untouched). A
    single 25 € offered line would force the operator to do that arithmetic by hand. Apply it on the
    **planning-card branch** too — that is the path every real breakfast takes.
14. **Check the announced pack value against the catalogue prices.** « 25 € of value » for 2
    breakfasts + a juice only holds at 10 €/breakfast; the catalogue said 8 €. Either the
    per-property price moves or the announced value is wrong — decide, do not let them disagree.
15. **A net target that is validated but never persisted is a lie.** The recipe's `netTiers` were
    checked by the loader and then dropped by the apply, so the platform grid grossed up the
    DISPLAYED prices as if they were net (direct showed 16/9 instead of 15/8). After applying a
    recipe, verify the grid's direct row REPRODUCES the displayed prices — that identity is the
    whole point of a net pivot, and it fails loudly the moment one is dropped.

## Validation the loader enforces

Unique `id`; semver `version`; ≥ 1 season; unique season keys; ranks forming a contiguous 1..N;
`period.season` a declared key; a `between` anchor referencing only **earlier** periods; weekdays
0–6 (0 = Sunday); `maxNights ≥ minNights`; a discount table with strictly increasing nights and
never-decreasing percentages; `horizonYears` 1–5.

An invalid recipe is isolated with its error and shown in **Paramètres → Recettes tarifaires** — it
never blocks the others or the boot.

## Anchors

| Anchor | Use |
|---|---|
| `fixed_dates` | `MM-DD` boundaries, same every year. Wraps across the new year when `from > to`. |
| `nth_weekday_of_month` | "the first Saturday of July" + `nights` — keeps changeover days aligned. |
| `last_full_week_of_month` | "the last whole week inside August" + `nights`. |
| `between` | Everything between two earlier periods. |

## Shipping and updating

Recipes load from `server/src/recipes/` then from `<data dir>/recipes/` on the host; a local file
**replaces** a bundled one of the same `id`. Dropping a file there updates a recipe with no release —
effective on the next restart (no watcher). Bump `version` on any change: the property stores the
version it applied, and the tariff page flags when the file has moved on.
