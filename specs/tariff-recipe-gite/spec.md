# Gîte — automatic tariff recipe

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/tariff-recipe-gite` |
| **Created** | 2026-08-24 |
| **Arbitrated** | 2026-08-25 (Q1, Q3, Q4) · 2026-08-28 (Q6 festive peaks, Q2 commission, Q7 the pivot rebuilt on the Gîtes-de-France net, Q5 answered by measurement, L'Ardéchoise added) |
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

1. **The net is the anchor, and it is a FLOOR.** `netTargetPerNight` is what the owner receives on
   any channel and never less. It is **measured, not declared**: a least-squares fit of the recipe's
   own degressivity curve against the 15 Gîtes-de-France stays on record — 288 / 302 / 341 / 413 €,
   residual 48,84 € ([étude §3](etude.md)). _(Owner's call, 2026-08-28: « tu calcules ce que je gagne
   avec Gîte de France et ça devient la référence […] je ne veux jamais descendre en dessous ».)_
2. **Gîtes de France keeps the prices it charges today.** Grossed up from the floor at its 10 %, it
   comes out at 320 / 336 / 379 / 459 € — the constraint the whole grid was anchored on.
3. **Every channel is grossed up from the floor**, `ceil(net ÷ (1 − commission))`. Existing behaviour
   of [platform-price-from-commission](../platform-price-from-commission.md); the recipe only supplies
   the pivot it was missing.
4. **The direct channel carries a 16 € uplift**, so it lands level with the cheapest channel while
   paying only 5 % — which is where the extra margin on a direct booking comes from.
   `pricePerNight = ceil((net + 16) ÷ 0,95)` = 320 / 335 / 376 / 452 €. The uplift is carried by the
   recipe's `welcomePack.cost`, which the grid applies to the direct row alone
   (`fixedCost: p.isDirect ? welcomePackCost : 0`). **It is not a welcome pack here**; the field is
   simply the only per-stay direct-side amount the grid knows about, and the comment in the recipe
   says so. _(Owner's call, 2026-08-28: « en direct je veux que tu me place au prix le plus bas des
   plateformes ».)_
5. **Two identities must hold, per season, or the grid lies.** `ceil((net + 16) ÷ 0,95)` must return
   `pricePerNight` unchanged, and `pricePerNight` must be **≤ the cheapest platform price**. The first
   is what proves the net was persisted rather than dropped by the apply — a failure that shipped once
   on the Lodge ([tariff-recipes §3.6 rule 34bis](../tariff-recipes/spec.md); trap 15 of the
   `tariff-recipe` skill). The second is what keeps booking direct from costing the guest more than a
   platform. Both asserted in the test suite, season by season.
6. **The band is 12,5 % to 14,4 % on the ordinary seasons, 16,7 % on Noël.** The owner asked for 10 %
   and accepted the widening rather than drop Abracadaroom, which sits at 20 % and through which the
   Gîte has never sold a night. On the festive seasons a flat 16 € is a smaller relative uplift, so
   the band widens further — arithmetic, not a choice.

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

### 3.2bis The degressivity, as the channels have to be configured

The Lodge's rollout of 13-14 August 2026 cost a fortnight of surprises, all recorded in
[`platforms.md`](../../.claude/skills/platform-tariff-rollout/references/platforms.md). Four of them
bear on discounts, and they were checked against the Gîte's own curve **before** anything is pushed.

**The curve, restated as the channels want it** — a cumulative percentage per length, which is the
only form Lodgify, Booking, GreenGo and Abracadaroom accept:

| Nights | 2 | 3 | 4 | 5 | 6 | **7 and beyond** |
|---|---:|---:|---:|---:|---:|---:|
| Discount | 0 % | 20 % | 30 % | 36 % | 40 % | **42,86 %** |

18. **Past seven nights the discount is CONSTANT, so one promotion covers seven nights to infinity.**
    This is the Gîte's own arithmetic — « a week is four nights » plus « each further night is a
    seventh of a week » makes `cum(n)/n × base` land on 4/7 for every n ≥ 7 — and it is what the
    Lodge did *not* have (trap 1 of the `tariff-recipe` skill: a flat rate past the last declared
    night makes night N+1 dearer than night N). Five promotions instead of six, and no upper bound to
    maintain.

19. **A whole-number discount is not neutral: 43 % dips under the net floor, 42 % does not.** On a
    seven-night stay in Très basse the target is 1 280 €; −42,86 % gives 1 279,94 €, −43 % gives
    1 276,80 € — **3,20 € below the floor**, which §3.1 rule 1 forbids — and −42 % gives 1 299,20 €.
    **Where a channel takes two decimals, use 42,86 %. Where it only takes an integer, use 42 %,
    never 43 %.**

20. **Booking ignores the discount because it was put in the wrong layer, and the fix is a rate
    plan, not a promotion.** A *promotion* — whether pushed by Lodgify or created in the extranet as
    a « Basic Deal » — sits above the rate. On a property whose rates arrive from a connectivity
    provider, Booking does not consult that layer: its own guidance is that promotions reach such a
    property only through a provider that has integrated the **Promotions API**, which Lodgify has
    not for this deal type. That is why six tiers created on 14 August, still shown « Activée(s) » on
    17 August, changed no price.

    **What Booking does honour is a DERIVED RATE PLAN**: a plan that takes the channel-manager's
    standard rate as its base, subtracts a percentage, and carries its own minimum length of stay.
    Booking's own documentation is explicit — the channel manager updates the standard rate, and
    *« your derived rates will get updated from your base rate »*. Several derived plans already
    exist on this account (the listing shows five), which is the proof the mechanism runs here.

    | Plan | Derived from the standard | Minimum stay |
    |---|---|---|
    | Standard, pushed by Lodgify | — | 2 nights |
    | 3 nuits et + | −20 % | 3 nights |
    | 4 nuits et + | −30 % | 4 nights |
    | 5 nuits et + | −36 % | 5 nights |
    | 6 nuits et + | −40 % | 6 nights |
    | 7 nuits et + | −42,86 % | 7 nights |

    They self-select exactly like Lodgify's promotions: a guest sees every plan whose minimum their
    stay satisfies, and Booking shows the cheapest.

    **The host creates these himself** — `admin.booking.com` → **Tarifs et disponibilités → Plans
    tarifaires → Ajouter un nouveau plan tarifaire**. An earlier reading of a hotel-side document
    said only an account manager could; that is wrong for a holiday let. Booking ships two ready-made
    types, **Hebdomadaire** (shown for searches of 7 to 27 nights) and **Mensuel** (28 and over),
    both expressed as a percentage off the cheapest daily rate — which covers the Gîte's whole tail in
    two plans, its curve being flat past seven nights. The 3-to-6-night tiers need one plan each.

    **The structural catch is the XML limitation.** For any rate plan other than the standard one, no
    booking condition travels over the channel-manager connection: **minimum stay, maximum stay and
    arrival/departure days of a secondary plan are set by hand in the extranet**, and do not maintain
    themselves. The price does follow the standard rate. Two consequences: never edit the standard
    rate by hand in Booking (Lodgify owns it), and delete stale plans before adding new ones — an
    unmapped leftover creates sync conflicts. The six « Basic Deal » promotions of 14 August should
    be deactivated: they do nothing and confuse the reading.

20bis. **What it is worth, measured.** Without the discount a Booking guest is quoted the full
    nightly rate times the number of nights. In Moyenne season, at 356 € the night: three nights are
    **25 % too dear**, seven nights **75 % too dear** (2 492 € against 1 424 €), fourteen nights
    2 136 € too dear. An earlier version of this spec called the exposure inert because both Booking
    stays on the books are two nights — **that reasoning was backwards**. Two nights is all Booking
    sells *because* it is the only length priced correctly. Nine of the fifteen Gîtes-de-France stays
    run three nights or more; that is the demand Booking cannot currently quote.

20ter. **The other route, and why it is not the first choice.** Booking also supports **LOS pricing**,
    where the provider sends an explicit total for every length of stay up to 90 nights. It would
    reproduce the curve to the cent, but it has a sharp edge: *there is no default per-night price,
    and any length not declared becomes unbookable*. It also depends on Lodgify supporting that model
    — unverified. Derived rate plans first; LOS pricing only if Booking refuses them.

21. **Two channel-specific traps do not apply to the Gîte, and one does.** Abracadaroom's rule that
    the discount spares the guest supplement, and Lodgify's that each season must re-declare that
    supplement, are both moot: the Gîte sells the whole house, with no per-guest price
    (§3.5). What does apply is **GreenGo's double discount** — the calendar's « ensembles de règles »
    carry their own length reductions and they **stack** with the Tarification page's. Only one of
    the two may be filled.

22. **Never use Lodgify's « Prix par durée du séjour ».** It asks for a fixed total in euros, not a
    percentage, and Booking ignores it. The discount goes in **Promotions** (percentage + minimum
    stay), and on Abracadaroom in a single promotion holding all five tiers, set to **« Globale »**
    and not « Additionelle », so it applies to the whole stay and does not compound.

23. **Every channel must sit at a 2-night minimum, and never more.** _(Owner's instruction,
    2026-08-28.)_ A minimum set too high raises no error: it simply makes those dates unsellable, and
    the guest quote answers exactly as it does for unavailable dates. The stake is measurable — two-night
    stays are 6 of the 15 Gîtes-de-France bookings, both Booking ones and the GreenGo one.

    The recipe side is clean and checkable: all six seasons declare `minNights: 2`, and only **2,1 %
    of the year** carries more — the deliberate 3-night holiday blocks, never above 3. Anything
    reading 4, 7 or 14 comes from the channel, not from here.

    **The trap the new Booking scheme introduces**: each derived rate plan carries its own minimum
    (3, 4, 5, 6, 7 nights). Those live on the SECONDARY plans; **the standard plan must stay at 2**.
    A minimum landing on the standard plan would discount nothing and wipe out every two-night
    booking at once. Re-read it after creating each plan.

    Verified on Booking on 2026-08-28 (Gîte, rate plan 57972851): « Durée de séjour minimum » reads 2
    on every date of the displayed month.

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
   | 7 | 24 → 25 December | Noël |
   | 8 | 27 → 29 December | Moyenne |
   | 9 | 31 December | Nouvel An |
   | event | L'Ardéchoise, dates declared year by year | Haute |

10. **The year-end block straddles 31 December**, so 1 January belongs to the *previous* year's
    block and stays in high season.
11. **Derived against the current painting, 2026 differs by 4 days**, and each is a defect in the
    painting: 01/01/2026 was left in Très basse although the painting already puts 01/01/2027 in
    Haute; 01–03/04/2026 were left in Très basse because the painting started April's low season on
    the first Saturday.
12. **Horizon: two calendar years**, the current one and the next — the Lodge's value, and the
    scheduled task generates the following year when the horizon moves.
13. **Public-holiday long weekends go up one rank, capped at Haute.** Each « pont » is raised by one
    rank and carries the block's own length as a minimum stay, exactly as on the Lodge. The cap is
    what makes the rule usable here: the Gîte's highest rank is the Nouvel An season, and an uncapped
    raise would sell 25 December at its rate. Declared as `capSeason: "high"`, which the engine gained
    for this recipe ([tariff-recipes §3.3 rules 15bis-15ter](../tariff-recipes/spec.md)).
    _(Owner's call, 2026-08-25.)_
13bis. **A night already above the cap is not raised, but still carries its minimum.** 14 juillet and
    15 août sit inside the summer core: they keep their Très haute price and take only the block's
    minimum stay — the behaviour rule 16ter already defined for a night at the ceiling.
13ter. **The festive premium sits on four nights and nowhere else.** _(Owner's call, 2026-08-28:
    « seulement ces nuits soient à un tarif fort ».)_ Rule 6 lays the whole 19 December → 1 January
    block down in Haute; rules 7 to 9 then cut two peaks and a lull out of it:

    | Nights | Season | Rate |
    |---|---|---:|
    | 19 → 23 December | Haute | 382 € |
    | **24 – 25 December** | **Noël** | **908 €**, flat |
    | 26 December | Haute | 382 € |
    | 27 – 29 December | Moyenne | 326 € |
    | 30 December | Haute | 382 € |
    | **31 December** | **Nouvel An** | **938 €**, flat |
    | 1 January | Haute | 382 € |

    « Entre le 27 et le 30 on doit être en moyenne saison » is read as **27, 28 and 29**, because the
    same instruction puts the 30th in Haute alongside 1 January. Three nights, not four.

13quater. **The two premium rates are solved, not chosen.** « Compare avec ce que j'ai gagné l'année
    dernière pour définir le tarif augmenté de la plus-value » — target the 2025 takings **+ 20 %**,
    all of it loaded on the premium nights ([étude §5 Q1bis](etude.md) for the arithmetic).
    **The base is the RENTAL, not the invoice total** — corrected 2026-08-28 against the owner's own
    records. Réveillon: Abritel billed 1 222 € tourist tax included, so 1 201 € of rental →
    1 441,20 € targeted → **938 €** for the night of the 31st, landing on +20,00 % to the cent. Noël:
    the contract reads « 1550 € hors option, dont taxe de séjour […] 16 € et supplément chien » (20 €
    in the general conditions), so 1 514 € of rental → 1 816,80 € targeted → **908 €** a night. The
    tourist tax is collected and remitted, never earned; the dog is an option, which the recipe does
    not price.

    Both are **whole euros by obligation**, not by taste: `ceil(net ÷ 0,95)` has to give the displayed
    price back, or the direct row of the channel grid stops reproducing itself. Christmas's exact
    figure was 908,40 €, so its reference stay lands eighty cents short of +20 %.

13sexies. **The Christmas dates are established, not assumed.** The CAGGIU contract reads « Date de
    séjour du mercredi 24/12 à 15h au jeudi 26/12/25 à 11h, soit 2 nuits ».

13quinquies. **Both festive seasons are billed flat** (`pricingMode: "fixed"`). A length discount on
    the four scarcest nights of the year would hand back exactly the premium they exist to collect.

13sexies. **L'Ardéchoise is declared, not derived.** The same event, the same dates and the same
    reasoning as the Lodge's recipe: the organiser moves it and only announces the next edition in
    December, so the dates are declared year by year and a missing year is flagged, never guessed.
    It paints **Haute** over the Moyenne stretch of June. The minimum stay is the Gîte's own **2
    nights**, not the Lodge's 1: a ten-person house is not sold by the night to a lone cyclist.
    _(Added 2026-08-28 at the owner's prompt — it was missing from the first draft.)_
13quater. **The rest of the year-end block is unchanged.** 19 → 29 December stays Haute, Christmas
    included; the recipe adds the réveillon on top rather than redrawing the fêtes.
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
| `utils/` | `tariffRecipe.js` | T | Validates the modifier's new `capSeason` against the declared season keys. |
| `utils/` | `seasonPlan.js` | T | Caps the holiday raise at `capSeason`'s rank, with the night's own rank as a floor so a cap never demotes. |
| `tests/` | `season-plan-generator.unit.test.js` | T | 4 tests on the cap: it stops the raise, it never demotes, an unknown key is refused, and its absence keeps the old ceiling. |
| `tests/` | `shipped-recipes-guard.unit.test.js` | T | Bounds its reachability reach by the cap. |
| `models/` | `tariffRecipeModel.js` | — | Unchanged — the apply writes the seasons, ranges and net targets. |
| `tests/` | `gite-recipe-end-to-end.unit.test.js` | C | The shipped file, end to end: validation, the two arithmetic identities, the 2026/2027 calendars to the day, full-year coverage, and 8 priced control cases through `calculateReservationQuote`. |

**Notes:** no new dependency, no migration, no route, no controller. The one engine change is
additive and defaults to today's behaviour, so the Lodge's recipe derives byte-identically. The
recipe is picked up on the next server restart and applied by the operator from the property's
tariff page.

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
their prices through the locked tariff snapshot; unsold dates re-price.

> **One manual step before the first apply.** The recipe no longer declares a « Basse » season, and
> the one on the Gîte's card is a *manual* row, not a recipe-owned one — so the apply cannot delete
> it and is **blocked** by the April overlap it creates (verified against a copy of production:
> `blocking: true`, two conflicts on 04→30 April). **Delete the « Basse » season on the Gîte's tariff
> page first**; the apply then goes through cleanly, adopts the four remaining seasons by label,
> creates Noël and Nouvel An, writes `welcomePackCost = 16`, and a second run is a no-op.

Re-priced dates, measured over the 24 stays of 2026: **all 24 move**, the whole grid having moved,
for **+1 157,92 € (+5,2 %)** on the direct price. Winter rises and summer falls — a February weekend
goes 504 € → 640 € (+27 %), mid-July 1 074,50 € → 904 € (−16 %) — which is what the measurement
demanded: the old grid charged 252 € a night in winter where the owner nets 288 € on Gîtes de France
and 407 € on the platforms, and 537,50 € at the summer peak where Gîtes de France nets him 413 €
([etude.md §4](etude.md)).

## 6. UI / UX

No new screen and no new string. The recipe shows up in **Paramètres → Recettes tarifaires** (source
« Livrée », version 3.0.0) and becomes selectable on the Gîte's tariff page, where the apply dialog
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
- [x] — a holiday raise stops at Haute and never demotes a night above it: 25 December stays Haute
      with its 2-night minimum, the 14 juillet block keeps its Très haute price (rules 13, 13bis).
- [x] — applied to a property, 10 control cases quote to the cent, including a « pont », Christmas,
      the réveillon, a stay straddling the peak/high boundary and the 2027 peak week; minimum
      2 nights, 3 on the 14 juillet block, no ceiling (rules 15-17).
- [x] `tests/season-plan-generator.unit.test.js` — the cap itself, on a synthetic five-rank grid
      ([tariff-recipes §3.3 rules 15bis-15ter](../tariff-recipes/spec.md)).

### Applied against a copy of the production data
- [x] **The first apply adopts all five existing seasons and creates only Nouvel An** — no obstacle,
      no conflict, no warning. This is the day-one wall rule 22 exists to avoid, and it holds.
- [x] The property ends up with `tariffRecipeId = gite-2027`, six ranked seasons carrying their net
      targets, 2026 **and** 2027 generated, and one line in the tariff-change journal.
- [x] **Re-applying writes nothing** and adds no journal line (rule 11). It did not, at first — see
      the label-casing fix in [tariff-recipes §3.2 rule 11bis](../tariff-recipes/spec.md), found here.

### Manual UI verification
- [ ] **Not done — needs the operator.** The apply above ran against a *copy* of the database, never
      against production, which re-prices unsold 2026 dates and is a commercial act. To be checked
      when it runs for real: the diff dialog lists the five seasons as **adopted**, Nouvel An as
      created, and no obstacle.
- [ ] Tariff page, mobile and desktop: the seasons table and the calendar render the generated 2027,
      with the « pont » minimums visible on the May blocks.
- [ ] Platform grid: the **Direct** row reproduces 252 / 303 / 326 / 382 / 538 € exactly.

## 8. Out of scope

- **Rolling the grid out to the channels.** No booking engine was touched, no quote was taken,
  nothing was published. That is the `platform-tariff-rollout` skill's job and it starts once §9 is
  answered.
- **The Gîtes de France commission** (§9 Q2) — a global platform setting, not recipe-owned.
- **Any change to what is included in the rate**, to the extra-guest model, or to the tourist tax.
- **Declaring the change in the tariff journal** (`tariff_change_events`) — written by the apply
  itself when it runs, and by hand for the platform go-live.

## 9. Open questions

- **Q1 — Turn the public-holiday long weekends on?**
  - **A (2026-08-25): yes, capped at Haute.** The engine gained `capSeason` for it
    ([tariff-recipes §3.3 rules 15bis-15ter](../tariff-recipes/spec.md)), including the half that is
    easy to get wrong: a cap must never move a night down, or 14 juillet and 15 août lose 624 € over
    2026. Effect: 13 nights raised in 2026, 14 in 2027, 12 in 2028, **+452,80 €** over the 24 stays
    already on the books.
- **Q2 — What is the Gîtes de France commission?** Stored as 0 % while the channel carries 15 of the
  Gîte's 24 bookings and 84 % of its gross. Observed on the seven bookings that record one: 14,02 %
  overall, individual rates from 6,90 % to 19,58 %. The grid cannot be derived for the main channel
  until the contractual rate is known. **Still open** — it is a global platform setting, not
  recipe-owned, and it gates the channel rollout rather than this spec.
  - A: …
- **Q3 — Whole-house price, or base + extra guest?**
  - **A (2026-08-25): whole house, unchanged.** No included-guest threshold, no extra-guest
    supplement; cleaning (80 €/stay) and bath linen (8 €/person) stay billed on top.
- **Q4 — Smooth the week boundary?**
  - **A (2026-08-25): no, the week model is kept.** Nights 3 to 7 cost 100,80 € in Très basse and
    the 8th 144 €. Totals never decrease; only the marginal price steps back up once, at the week
    boundary. Smoothing it would have cut a 14-night peak stay by 15 %.
- **Q7 — What net should the pivot be anchored on?** — **answered 2026-08-28: what Gîtes de France
  actually pays, measured on 15 stays; that net is a FLOOR, never a target.** See rules 3bis-3quater
  and [étude §3](etude.md). Gîtes de France keeps the prices it charges today; every other channel is
  grossed up from the same floor; the direct channel gets a 16 € uplift so it lands level with the
  cheapest channel while still paying only 5 %, which is where the extra margin on a direct booking
  comes from.
  - A: floors 288 / 302 / 341 / 413 €, direct 320 / 335 / 376 / 452 €.

- **Q5 — Keep five seasons?** — **answered 2026-08-28 by measurement: no, merged.** The least-squares
  fit on the Gîtes-de-France stays gives 286 € for Basse against 288 € for Très basse — the two are
  indistinguishable, and the one covering April alone is gone. Four ordinary seasons remain.

- **Q6 — What are the festive rates?** — **answered 2026-08-28: 908 € on 24-25 December, 938 € on
  31 December, both flat, everything around them back in Haute or Moyenne.** See rules 13ter to
  13quinquies and [étude §5 Q1bis](etude.md).
  - A: the premium is concentrated on four nights, and both rates are solved from the 2025 takings
    plus 20 % rather than picked. An earlier answer the same day — 750 € spread over 30 December to
    1 January — was superseded: it charged the réveillon rate to a guest *arriving* on 1 January.
