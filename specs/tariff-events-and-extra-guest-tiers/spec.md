# Recurring events + tiered extra-guest price

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/tariff-recipes` — livré dans la PR #411, dont le moteur de recettes est un prérequis strict |
| **Created** | 2026-08-12 |
| **Author** | Adrien |
| **Related PR** | #411 |

---

## 1. Context

Two changes to the Aventura Lodge tariff model, both landing in the recipe engine shipped by
[`specs/tariff-recipes/`](../tariff-recipes/spec.md).

**1. The extra-guest supplement is re-priced.** It is 27 €/night/person today, flat across the three
seasons, and it follows the length-of-stay degressivity night by night. The owner now wants **15 €
per extra person for the first night, then 8 € per person per night** — a first-night premium
followed by a much lower running rate. The engine has no way to express that: `per_night` means "one
price, scaled by the season's discount curve".

**Answering the question raised with the request:** the extra-guest price was **not** seasonal. All
three seasons carry `extraGuestPrice: 27` / `extraGuestNetTarget: 25`. Per the instruction, the new
tiers stay flat across seasons — no inter-season percentage is applied.

**2. L'Ardéchoise.** The cyclosportive is based in Saint-Félicien, 12 km from the Lodge, and fills
the area every June. It brings a lot of bookings and the week has to be sold as high season, with a
single night allowed so the many one-night riders are not turned away.

Its dates are **not derivable**. The last three editions all ran Tuesday → the 2nd Saturday of June
(10–14 June 2025, 9–13 June 2026, 8–12 June 2027), but that is a three-year coincidence, not a
published rule; the organiser only announces the next edition when registrations open, in December.
A hardcoded « 2nd Saturday » would silently mis-price a whole week the year it moves. Hence the
owner's wording: a mechanism to **consult** the dates, not to guess them.

## 2. Goal

- Express an extra-guest supplement as a **per-night tier table** (night 1 → 15 €, nights 2+ → 8 €),
  declared in the recipe, flat across seasons, and **not** re-scaled by the stay degressivity.
- Give the recipe a notion of **recurring event**: a named period whose dates are declared per year,
  which repaints those nights with a season and its own minimum stay, overriding everything else.
- Make the missing years **visible and easy to fill**, so nobody discovers in May that next June is
  priced as low season.

## 3. Functional rules

### 3.1 The extra-guest tier table

1. **A recipe may declare `extraGuest.perNightTiers`** — an ordered list of `{ fromNight, price }`.
   `[{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }]` reads « 15 € the first night, 8 € from
   the second ». The last tier carries forward: night 12 costs 8 € like night 2, exactly as
   `progressiveTiers` already carries forward for the nightly rate.
2. **The tiers replace the degressivity, they do not stack with it.** 15 → 8 *is* a degressivity;
   applying the season's curve on top would price night 2 at 8 × 0,52 = 4,16 €. When `perNightTiers`
   is present, `followsDiscount` is forced to `false` and the loader **rejects** a recipe that sets
   both `perNightTiers` and `followsDiscount: true` rather than silently picking one.
3. **The tiers are flat across seasons.** A season may still override with its own
   `extraGuestPrice`, which keeps the current single-price behaviour for that season; on the Aventura
   recipe no season overrides, so 15/8 applies all year.
4. **Nothing changes for a recipe without `perNightTiers`.** `per_stay` and single-price `per_night`
   keep their exact current arithmetic — this is the non-regression guarantee.
5. **The tier index is the night's rank in the stay**, 1-based, not a calendar date: a 3-night stay
   is 15 + 8 + 8 = 31 € per extra person, whatever the seasons it crosses.
6. **The displayed and net prices.** The tiers are the **direct/displayed** prices, the role
   `extraGuestPrice: 27` had. Their net counterpart is `extraGuest.netTiers`, same shape; the channel
   grid grosses each tier up by that channel's commission, whole-euro, exactly as it does for the
   single price today. If `netTiers` is absent the gross tiers are used as their own net, which is
   what a recipe with no channel ambition wants.

**Money impact, stated plainly** — the new model is materially cheaper, which is the owner's
decision to make, not a side effect to bury:

| Stay (high season, 3 extra guests) | Today (27 €/night × curve) | With 15/8 | Δ |
|---|---|---|---|
| 1 night | 81,00 € | 45,00 € | −36,00 € |
| 2 nights | 123,12 € | 69,00 € | −54,12 € |
| 7 nights | 311,85 € | 189,00 € | −122,85 € |

7. **Saved reservations are untouched.** Locked pricing snapshots keep the price they were sold at;
   only new quotes and re-quotes use the tiers.

### 3.2 Recurring events

8. **A recipe may declare `calendar.events`** — a named period that is not derivable from a calendar
   rule. Each event carries a `key`, a French `label`, the `season` its nights take, an optional
   `minNights` / `maxNights`, a `sourceUrl` where the dates are published, and a `dates` map keyed by
   year.
9. **Dates are declared per year, explicitly**, as `{ "2026": { "from": "2026-06-08", "to":
   "2026-06-13" } }`. `from`/`to` are the **first and last night**, not the race days — see rule 11.
10. **An event wins over everything else on its nights**: it is applied after the base season, after
    the periods, and **after** the public-holiday raise. So « high season, 1 night allowed » holds
    even where a holiday bridge would otherwise impose a 3-night minimum. This is the whole point of
    the request and is the one place where a minimum stay is *lowered* rather than raised.
11. **The nights, not the race days.** L'Ardéchoise 2026 runs Tuesday 9 → Saturday 13 June; riders
    sleep from the eve of the first day to the last night, so the event covers the nights of 8 → 13
    June inclusive. The recipe declares the nights directly rather than the event days plus offsets:
    a rider arriving Monday for a Tuesday start is a booking decision, not a derivable one.
12. **A year with no declared dates is not invented.** Those nights keep whatever the base season and
    the periods gave them, and the year is reported as **missing** — never silently priced low.
13. **A closed day stays closed.** An event does not reopen a closure; the winter closure and the
    event cannot overlap for the Lodge, but the rule holds generally.
14. **Applying the recipe is still previewed.** An event produces ranges like any other period: they
    appear in the preview diff, and a manual season already covering those dates blocks the apply
    with the usual named conflict.

### 3.3 Consulting the dates

15. **The property's tariff page lists every event and its years**, in the « Recette tarifaire »
    card: label, the dates of each year in the horizon, and a link to `sourceUrl`.
15bis. **The event is named in the seasons table**, with its dates — not only on the calendar. The
    Saison cell reads « Haute saison · L'Ardéchoise » on that range, so the reason a June week is
    priced high is legible from the table alone, without cross-referencing the calendar.
16. **A year in the horizon with no dates is flagged**, with the year named and the link offered —
    the mechanism the owner asked for is exactly this: a place that says « L'Ardéchoise 2028: dates
    not known yet, check ardechoise.com ».
17. **The same signal reaches the Dashboard**, alongside the existing horizon-extension alert, so the
    gap is noticed without opening a property. The horizon still extends — a missing event year never
    blocks the yearly pass (resolved Q3).
17bis. **Watching for the dates is Claude's job, on a schedule, not the app's.** A scheduled Claude
    task checks the official site periodically, and when a new edition's dates appear it reports them
    and opens a PR on the recipe. The app never scrapes: no network dependency is added to
    GuestFlow, and the failure mode of a scraper (silently returning nothing) is exactly what the
    visible-gap rules above exist to prevent.
    **Known limitation, stated because it changes who is responsible:** the schedule is
    session-scoped and expires after 7 days, while the dates are published in December. It is
    therefore a best-effort supplement, **not** the mechanism that must not fail — rules 15bis-17
    are. The durable guarantee is the visible gap in the app, which no expiry can silence.
18. **Entering the dates is editing the recipe**, which is already possible without a release: drop
    the updated JSON in `<data>/recipes/` and restart (spec `tariff-recipes` §3.3). No new write path
    is introduced in this version — see §8.

### 3.4 The Aventura recipe

19. `extraGuest` becomes `{ appliesAbove: 2, unit: 'per_night', perNightTiers: [{fromNight: 1, price:
    15}, {fromNight: 2, price: 8}], netTiers: [{fromNight: 1, price: 14}, {fromNight: 2, price: 7}] }`
    — see Q1, the net values need confirming.
20. The three seasons drop their `extraGuestPrice` / `extraGuestNetTarget` so the tiers are not
    shadowed.
21. A single event is declared:

```json
{
  "key": "ardechoise",
  "label": "L'Ardéchoise",
  "season": "high",
  "minNights": 1,
  "sourceUrl": "https://www.ardechoise.com/",
  "dates": {
    "2026": { "from": "2026-06-08", "to": "2026-06-13" },
    "2027": { "from": "2027-06-07", "to": "2027-06-12" }
  }
}
```

22. `version` goes to `1.1.0` — the tariff changes, so the property must be told a new version is
    available.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | Responsibility |
|---|---|---|
| utils | `pricing.js` | `computeExtraGuestSurcharge` gains the tier branch: when tiers are present, night N costs the tier price with no ratio applied. Everything else untouched. |
| utils | `extraGuestTiers.js` _(new)_ | Pure resolution of `(tiers, nightIndex) → price`, with carry-forward. Isolated so it is unit-testable without a database. |
| utils | `seasonPlan.js` | New step 3bis in `buildYearPlan`: after the holiday raise, repaint the event nights with the event's season and overrides. |
| utils | `tariffRecipe.js` | Validation: tier shape, `fromNight` strictly increasing and starting at 1, the `perNightTiers` × `followsDiscount` conflict, event shape, ISO dates, `from <= to`, a year key matching the dates it declares. |
| models | `tariffRecipeModel.js` | `preview`/`apply` surface event ranges like period ranges; `missingEventYears(recipe, fromYear, toYear)` feeds rules 16-17. |
| models | `propertiesModel.js` | Per-season extra-guest columns keep working; the platform grid grosses up each tier (`extraGuestTiersByPlatform`). |
| database | `database.js` | `pricing_rules.extraGuestTiers` (TEXT, JSON, nullable) so a range can carry its tiers, mirroring `progressiveTiers`. |

### 4.2 Client side (`client/src/`)

| Layer | File | Responsibility |
|---|---|---|
| components | `property/TariffRecipeCard.jsx` | Particularities panel states the tiers in French (« 15 € la 1ʳᵉ nuit puis 8 €/nuit ») and lists each event with its known years + the missing ones. |
| components | `PlatformPriceCard.jsx` | « Personne supp. » column shows the two tiers instead of one price. |
| pages | `PropertyPricingSeasonsPage.jsx` | Event ranges are visually distinct in the calendar and named in the seasons table. |
| pages | `DashboardPage.jsx` | The existing recipe alert also reports event years with no dates. |

No new generic component: the panel, the badge and the alert all reuse `StatusBadge`, `SummaryItem`
and the existing alert block.

### 4.3 API contract

- `GET /api/properties/:id` — `rateInclusions` unchanged; `platformPrices[].extraGuestTiers` added
  alongside `extraGuest`.
- `GET /api/tariff-recipes/:id` — returns `calendar.events` and a computed `missingEventYears: [{ key,
  label, year, sourceUrl }]`.
- `POST /api/properties/:id/tariff-recipe/preview` — event ranges appear in `seasons[]` like any
  other range; no new field.

Backward compatible: every addition is optional, and a recipe without tiers or events produces byte-
identical output.

## 5. Data model

| Table | Column | Type | Default | Note |
|---|---|---|---|---|
| `pricing_rules` | `extraGuestTiers` | TEXT | `NULL` | JSON array, mirrors `progressiveTiers`. `NULL` = the single `extraGuestPrice` applies, i.e. today's behaviour. |

One idempotent `ALTER TABLE`. No backfill: existing rows keep `NULL` and therefore their exact
current pricing. No other property is affected.

## 6. UI / UX

- **Recipe card** — one line per particularity, as today. Tiers: « Personne supplémentaire : 15 € la
  1ʳᵉ nuit, puis 8 €/nuit, au-delà de 2 personnes ». Events: « L'Ardéchoise — haute saison, 1 nuit
  minimum : 8→13 juin 2026, 7→12 juin 2027 ». A missing year is a warning-coloured line with the link.
- **Calendar** — event nights carry the high-season colour plus a small dotted outline so the reason
  is visible; the legend gains « Événement ».
- **Seasons table** — the event's range shows its label in the Saison cell, in the same discreet
  style as the closure marker.
- **Mobile** — the tier text wraps on two lines on `xs`; no table gains a column, so nothing new can
  overflow. The calendar outline is a border, not a pseudo-element, so it survives the mobile layout.

## 7. Test plan

### Server unit tests

- `extra-guest-tiers.unit.test.js` — resolution and carry-forward; 1/2/3/7-night stays; a stay
  crossing two seasons; `followsDiscount` never applied on top; a recipe with no tiers unchanged.
- `tariff-recipe-events.unit.test.js` — an event repaints its nights; it beats a holiday bridge on
  minimum nights; a year with no dates changes nothing; a closed day is not reopened; ranges appear
  in the preview; `missingEventYears` reports the right years.
- `tariff-recipe-load.unit.test.js` — the new validations, each with its own rejection case.
- `pricing-baseline` — must stay green untouched: it is the proof that no existing quote moved.

### Manual UI verification

1. Apply the v1.1.0 recipe on the Lodge from the preview; check the June 2026 week turns high season.
2. Quote 5 guests / 1 night in June 2026 → 3 × 15 = 45 € of supplement; 7 nights → 189 €.
3. Book a single night inside the event week — accepted, where the same night inside a holiday bridge
   is still refused.
4. Recipe card shows the tiers, both event years, and a missing-year warning for 2028.
5. 390 px: no horizontal scroll on the tariff page or the reservation form.

## 8. Out of scope

- **Fetching the dates from inside GuestFlow.** The site publishes the next edition only in December
  and has no API; a scraper in the server would be a silent single point of failure and a new network
  dependency. The watching happens outside the app, on a schedule (rule 17bis), and the visible gap
  (rules 15bis-17) is the safety net.
- **Editing a recipe from the browser.** Still a file drop + restart, as in the parent spec.
- **Other events** (fêtes, festivals) — the mechanism is generic, but only L'Ardéchoise is declared.
- **The Gîte.** Untouched, as always.
- **Re-pricing existing reservations.**

## 9. Open questions

_None._

**Resolved (2026-08-12):**
- **Q1 — Net targets for the tiers.** `14` / `7`, mirroring today's 27 ↔ 25 relationship. Decided
  rather than asked: the alternative (deriving the net from the 5 % direct commission, 14,25 / 7,60)
  produces an **identical** channel grid at every commission rate, because the gross-up rounds up to
  the whole euro. Nothing observable distinguishes them. ✅
- **Q2 — Which nights for L'Ardéchoise.** The eve of the first race day through the last race night:
  **8 → 13 June 2026** and **7 → 12 June 2027**, 6 nights each. A rider starting Tuesday morning
  sleeps there from Monday evening, and many stay the Saturday night after the finish. The Sunday is
  excluded for now — 2025's Sunday GranFondo was a one-off, and a year where it returns is a
  one-line date change. ✅
- **Q3 — A missing year does not block the horizon extension.** It extends and reports (rule 17),
  plus a scheduled Claude task actively watches for the dates (rule 17bis). Blocking a whole year's
  season generation on one unknown field would trade a visible gap for an invisible standstill. ✅
