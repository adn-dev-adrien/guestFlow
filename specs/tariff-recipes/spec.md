# Tariff recipes — and the Aventura Lodge 2026 recipe

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Approved** | 2026-08-11 |
| **Implemented** | 2026-08-12 |
| **Branch** | `feature/tariff-recipes` _(user-managed)_ |
| **Created** | 2026-08-11 |
| **Author** | Adrien |
| **Source document** | `tarifs_aventura_lodge_2026_2.md` (11 Aug 2026 revision) |
| **Companion files** | [architecture.md](architecture.md) · [plan.md](plan.md) |
| **Amends** | [platform-price-from-commission.md](../platform-price-from-commission.md), [pricing-min-nights-per-range.md](../pricing-min-nights-per-range.md), [per-property-default-options.md](../per-property-default-options.md) |
| **Related PR** | _(opened at the end of implementation)_ |

---

This spec has two halves.

- **Part A — the recipe engine** (§3.1 to §3.5): a generic, property-agnostic mechanism. A *recipe* is a
  declarative document describing an entire tariff model — seasons, how the year is carved into them,
  prices, discount curves, minimum stays, changeover days. Applying a recipe to a property configures
  it. Recipes are meant to be produced by an AI from a commercial tariff document.
- **Part B — the Aventura Lodge recipe** (§3.6 to §3.10): the first recipe, plus the engine changes its
  pricing model needs (per-night extra guest, whole-euro channel grid, tourist-tax deduction).

Part A is the durable work. Part B is the reason it exists, and its proof.

---

## 1. Context

**The tariff model changes, and every change is a manual re-parameterisation.** Aventura Lodge is
moving from a room-only rate with à-la-carte cleaning and linen supplements to an all-inclusive rate
with a new season shape, a new discount curve and a new extra-guest rule. Today that means: drawing
2026's seasons by hand on the tariff page, drawing 2027's next autumn, editing every price, and
remembering the rules that are not written anywhere in the app. The commercial reasoning lives in a
document; the app holds only its residue.

**The reasoning is regular enough to be declared.** The Lodge's calendar is "low season everywhere, a
shoulder week each side of a July–August core, public-holiday long weekends one level up". That is a
rule, not a list of dates — and a rule can be applied to 2027 without anyone deciding anything.

**GuestFlow already has most of the pieces**, which is what makes this tractable:

| Piece | Where |
|---|---|
| Seasons with date ranges, colours, progressive tiers | `pricing_rules` + [PropertyPricingSeasonsPage.jsx](../../client/src/pages/PropertyPricingSeasonsPage.jsx) |
| Minimum nights **per season and per date range** | [pricing-min-nights-per-range.md](../pricing-min-nights-per-range.md), enforced at save with a force-override |
| French public holidays, computed | [frenchHolidays.js](../../server/src/utils/frenchHolidays.js) |
| Per-property closures | [establishment-closures.md](../establishment-closures.md) |
| Net-target → channel price gross-up | [platform-price-from-commission.md](../platform-price-from-commission.md) |
| « Comprise dans le tarif » option tagging | [pricing.js:1387](../../server/src/utils/pricing.js#L1387) |

**What is missing.** Five gaps, four of them in the pricing engine and one structural:

1. **No way to declare a tariff model.** Seasons are painted, one year at a time, by hand.
2. **The extra-guest supplement is a per-stay flat fee.** [pricing.js:1155](../../server/src/utils/pricing.js#L1155)
   computes `extraGuestCount × extraGuestPrice` — no nights multiplier, no length-of-stay discount.
3. **The platform grid rounds to the cent and excludes the direct channel**, and has no extra-guest
   column. The target rounds **up to the whole euro** — a price to display, not an amount to bill.
4. **Nothing deducts included services from the tourist-tax base.** With cleaning and linen folded into
   the nightly rate, the accommodation amount that
   [feeds the percentage-mode tourist tax](../../server/src/utils/pricing.js#L1578) inflates, and so
   does what gets declared to the commune.
5. **No changeover-day constraint.** Nothing anywhere restricts arrivals or departures to a given
   weekday. Minimum nights exist; "Saturday to Saturday" does not.

A sixth, smaller gap: progressive tiers are editable up to **14 nights** in the UI; beyond that the
engine silently falls back to an unrelated legacy weekly formula
([`buildDefaultProgressiveTiers`](../../server/src/utils/pricing.js#L151)), so a 20-night stay is not
priced by the configured curve.

**Deliberate departure from the source document.** It asks to *delete* the linen and cleaning
supplements. We keep them and mark them **included in the rate**: the laundry engine counts bed and
bath linen **only from the option ticked on the reservation**
([laundry-counts-explicit-option-only.md](../laundry-counts-explicit-option-only.md)), so deleting them
would silently drop the Lodge to zero sheets — and their reference value is exactly what we need to
deduct from the tourist-tax base.

## 2. Goal

Describe a property's whole tariff model — seasons, calendar rules, prices, discount curve, minimum
stays, changeover days — as a **recipe** that can be written once, reviewed, applied to a property, and
re-applied year after year without anyone redrawing a calendar. Then express Aventura Lodge's 2026
all-inclusive pricing as the first such recipe.

---

## 3. Functional rules

### 3.1 What a recipe is

1. **A recipe is a declarative document**, versioned, with a stable `id`, a `version`, a human `label`
   and a `description`. It is data, not code: it describes *what* the tariff model is, never *how* to
   compute it.
2. **A recipe declares an open list of seasons.** Not three, not a fixed set — as many as the model
   needs. Each season carries a `key`, a `label`, a **`rank`** (its position in the cheap-to-expensive
   order), a colour, a price per night, a pricing mode with its discount curve, a minimum-nights
   default, an optional changeover rule, and an optional extra-guest price.
3. **Rank is what makes "one level up" meaningful** whatever the number of seasons. A modifier that
   raises a night by one rank moves it to the next season by rank, and stops at the highest.
4. **A recipe declares how the year is carved**, in a small declarative language (§3.3), plus the
   recurring closures of the property.
5. **A recipe is property-agnostic.** Nothing in it names a property. The same recipe can be applied to
   several properties; the property is the target, not part of the description.
6. **Out of a recipe's scope**, and staying per-property: capacity, beds, check-in/out times, security
   deposit, options included in the rate, which options carry included units, and platform commissions
   — the last because they are global per platform and shared between properties.
6bis. **The welcome pack's COST price is recipe-owned** (`welcomePack.cost`), written to the property
   by the apply and absent from the property form. It is a margin input — it loads the direct
   displayed price in the channel grid so that price still covers the pack after the booking-engine
   fee — and never a guest-facing amount, so leaving it in the settings invited an operator to nudge
   a number whose only consumer is the recipe's own grid. Which OPTIONS make up the pack stays
   per-property (rule 6): the recipe owns what it costs us, the property owns what is served.
   _(Changed 2026-08-12 on the owner's call, after it shipped as a settings field.)_

### 3.2 Applying a recipe

7. **A property has at most one active recipe.** Its `id` and the `version` that was applied are stored
   on the property; a property without one keeps today's fully manual behaviour, which stays the
   default for every existing property.
8. **Applying always previews first.** The preview is a diff: seasons created, seasons updated (field by
   field), seasons removed, and the date ranges added or dropped per season, year by year. Nothing is
   written until it is confirmed.
9. **The recipe is authoritative over the seasons it declares.** A season on the property that the
   recipe does not declare appears in the preview as **« sera supprimée »** and is removed on
   confirmation. Saved reservations keep their prices regardless, through the existing locked snapshot.
   A manual season the recipe does not cover is an **obstacle**: a generated range overlapping it
   blocks the whole apply rather than silently overwriting it.
9bis. **First application adopts same-named manual seasons.** A property configured by hand before it
   had a recipe carries exactly the seasons the recipe is meant to replace. On apply, a **manual**
   season whose label matches a recipe season's (trimmed, case-insensitive) is **taken over** — tagged
   with that season key and updated in place — instead of blocking as an obstacle. Without this,
   applying a recipe to the property it was written for would always fail on the first run. The
   preview flags each adoption (`adopted: true`) so the takeover is visible before it happens; a
   manual season with an unrelated label still blocks, and a season the recipe already owns is never
   hijacked.
9ter. **A date the recipe cannot write is recorded, not just mentioned.** Every generated range
   blocked by a manual season lands in a structured `conflicts[]` — the dates, the recipe season that
   wanted them, the manual season blocking them and its own range — so the apply dialog lists them as
   dated rows in a red panel instead of burying them in a warning sentence. The operator sees exactly
   which periods stayed untouched and why.
10. **Applying is transactional.** Either the whole diff lands or nothing does. A validation failure
    mid-way leaves the property exactly as it was.
11. **Applying is idempotent.** Re-applying the same recipe version to an unchanged property produces
    an empty diff and writes nothing.
12. **The horizon is what the recipe declares** — two years for Aventura (§3.7). A monthly scheduled
    task checks every recipe-driven property, generates the missing year when the horizon has moved,
    and surfaces what it generated on the Dashboard, so a generated year is reviewed rather than
    discovered. Regeneration **never rewrites years before the horizon**. (Implementation cadence: a
    daily tick with an idempotent no-op when the horizon is covered — equivalent to a monthly check,
    and simpler than tracking a last-run date.)

### 3.3 The calendar language

13. **A base season paints the whole year**, and periods paint over it in declaration order. Last write
    wins, so ordering is the only precedence rule there is.
14. **A period is a season plus an anchor.** Four anchor types cover the models we have:

    | Anchor | Meaning |
    |---|---|
    | `fixed_dates` | Explicit `MM-DD` boundaries, repeated every year. |
    | `nth_weekday_of_month` | The *n*-th given weekday of a month, plus a night count. |
    | `last_full_week_of_month` | The last whole week of a month that ends inside it, plus a night count. |
    | `between` | Everything between two other named periods. |

    A period may also carry its own `minNights` and `changeover`, overriding its season's defaults for
    those dates.
15. **Modifiers run after the periods** and adjust what the periods produced. One modifier type in this
    version: `public_holiday_bridge`, which raises the rank of a public-holiday long weekend.
16. **A public-holiday block is the run of consecutive non-working days around the holiday, minus its
    last day** — the guest checks out that morning:

    | Holiday falls on | Block of days off | Nights affected |
    |---|---|---|
    | Monday | Sat · Sun · Mon | Saturday, Sunday |
    | Friday | Fri · Sat · Sun | Friday, Saturday |
    | Tuesday (bridge Monday) | Sat · Sun · Mon · Tue | Saturday, Sunday, Monday |
    | Thursday (bridge Friday) | Thu · Fri · Sat · Sun | Thursday, Friday, Saturday |
    | Wednesday, Saturday, Sunday | — | none |

    Holidays come from [frenchHolidays.js](../../server/src/utils/frenchHolidays.js) — no list is
    hardcoded, so Easter and the movable feasts follow automatically.
16bis. **A holiday block also imposes a minimum stay: its own length.** A « pont » is a commercial
    unit and can't be sold as a single isolated night. The block length gives the minimum directly —
    **2 nights** when the holiday falls on a Friday or a Monday, **3 nights** when a bridge day is
    involved (Tuesday or Thursday). This matches the common practice among French rentals, where a
    2-night weekend minimum is near-universal and a 3-night minimum on real bridges is the norm;
    forcing the eve of an isolated Friday holiday is deliberately *not* done, as it would refuse a
    guest arriving Friday evening for two nights. Declared as `minNights: "block"` on the modifier
    (an integer forces a fixed value; absent imposes nothing, which is what a recipe without the
    setting keeps).
16ter. **The minimum applies even where the rank cannot rise.** A block already at the top rank —
    14 juillet, always inside high season — is not raised, but still carries its minimum and
    therefore still splits the range. Two overlapping blocks resolve to the longer one, and neither
    raises the same night twice.
17. **`skipClosedDays` keeps the calendar readable.** When set, nights covered by a closure are left
    alone: they would never be sold, and raising them only adds noise to the painted calendar.
18. **Closures are declared as recurring month-day windows** and materialised as per-property
    `establishment_closures` rows, one per year of the horizon. A window may cross the new year.
19. **Ranges are produced per calendar year and never overlap.** The generator works on a per-day
    representation and only converts to ranges at the end, so splitting a range around a raised block
    is a consequence of the representation, not a special case.

16ter. **A holiday on a SATURDAY raises its own night, alone.** It forms no bridge — Saturday is
    already a non-working day — but « le 1er mai » fills the area whatever weekday it lands on, and
    skipping it priced 7 holidays over 5 years as ordinary nights, among them 1 May 2027. One night,
    and **no minimum-stay constraint**: the demand is real, the extra time off is not. A minimum of
    1 night is not a constraint at all, so it is never recorded — otherwise a single raised night
    would split its season's range for nothing.
16quater. **A holiday on a SUNDAY changes nothing.** It adds no day off: the Sunday night runs into
    a working Monday, and the Saturday before it is an ordinary weekend night. _(Owner's call,
    2026-08-12.)_ A holiday on a **Wednesday** likewise forms no block — left as is, nobody has
    asked for it.

### 3.4 Minimum nights and changeover day

20. **Minimum nights already exist per season and per date range** and keep their current semantics: a
    range override wins over the season default, and the requirement over a stay is the maximum across
    the nights it touches ([pricing-min-nights-per-range.md](../pricing-min-nights-per-range.md)). A
    recipe simply declares them.
20bis. **A season may cap the stay length.** `maxNights` is the exact mirror of the minimum: declared
    per season, overridable per date range, and **absent/NULL = unlimited**, which is what every
    existing property carries. Over a stay, the **most restrictive** ceiling among the nights touched
    wins (the minimum takes the maximum; the ceiling takes the minimum). A season without a ceiling
    never lifts a neighbour's. Enforced at save exactly like the minimum — same 409-with-code, same
    force-override, iCal never blocked.
21. **A changeover rule restricts the arrival weekday, the departure weekday, or both.** Declared per
    season and overridable per date range, exactly like minimum nights. `null` means unrestricted,
    which is what every existing property gets.
22. **The arrival rule is resolved on the first night, the departure rule on the last.** A stay
    spanning two seasons obeys the arrival rule of the season it starts in and the departure rule of
    the season its last night falls in — not the union of everything it touches.
23. **Changeover breaches behave exactly like minimum-nights breaches.** The quote returns
    `changeoverBreached` with the required weekdays; the save is refused with a machine code and a
    French message; and the same force-override that exists for minimum nights lets the operator save
    anyway. Same plumbing, same UI pattern, same escape hatch — nothing new to learn.
24. **iCal imports are never blocked by either rule.** A platform booking that violates the constraint
    is a fact to record, not a request to validate; it imports and is flagged, as today for minimum
    nights.
25bis. **Closed days are greyed on the tariff calendar** and lose their season colour: they cannot be
    sold, so showing a tariff on them is noise. The tooltip names the closure instead of the season,
    and the minimum-nights / changeover markers are suppressed there.
25ter. **Closed days are hidden from the seasons table — display only.** A season's ranges are shown
    minus the closures: a range straddling a boundary is trimmed, one entirely inside a closure
    disappears (the row reads « entièrement en fermeture »), one containing a whole closure shows as
    two pieces. **The stored ranges keep their full span**, so moving or removing a closure re-reveals
    the days with no re-application. Computed server-side (`dateRangesVisible`) so the page does no
    date maths.
25quater. **The seasons table is ordered by the earliest date each season actually covers**, computed
    from its ranges rather than the stored `startDate`, which can lag behind a multi-range season.
25. **Both constraints are visible on the tariff calendar.** The effective minimum shows on every day
    where it exceeds 1 — not only, as today, where a range overrides its season's default — and a day
    that is a valid arrival or departure carries a marker. A legend names every marker on the calendar.

### 3.5 Where recipes live, and how they are updated

26. **Two sources, in order: the repository, then a data directory.** Recipes shipped with GuestFlow
    live in the repo. A directory outside it — `data/recipes/` on the Pi — is read afterwards and its
    recipes are added to the list; a recipe there with the same `id` **overrides** the bundled one.
    Dropping a file in that directory is therefore enough to update a recipe, with no release.
27. **Recipes are validated at load**, and an invalid one is rejected individually with its error — it
    never prevents the others from loading, and never stops the server from booting.
28. **A read-only recipe browser** lists every recipe with its source (« Livrée » or « Locale »), its
    version, an override indicator, its content, and which properties currently use it.
29. **A property's recipe is chosen on its tariff page**, next to the seasons the recipe governs, and
    the choice is echoed read-only in the property's settings with a link back to the tariff page.

---

### 3.6 The Aventura Lodge recipe — pricing model

30. **The net target is the pivot.** Per season, for 1 night and 2 people, the Domaine must collect
    **LOW 160 € · MID 195 € · HIGH 225 €**. The extra-guest net target is **25 €/night/person** above
    2 occupants.
31. **Displayed price = net grossed up by the channel commission, rounded UP to the whole euro:**
    `displayed = ceil(net / (1 − commission/100))`.
32. **The direct channel carries a fixed per-stay cost.** Direct bookings include a welcome pack
    costing 9,32 € (§3.9), financed by the displayed price:
    `displayed_direct = ceil((net + welcomePackCost) / (1 − 5/100))`. The 5 % is the Lodgify fee.
33. **The extra-guest supplement is grossed up the same way**, without the welcome-pack add-on — the
    pack is per stay, not per guest: `extra_displayed = ceil(25 / (1 − commission/100))`.
34. **Resulting grid** — the values to configure on each channel:

    | Channel | Commission | LOW | MID | HIGH | Extra guest /night |
    |---|---|---|---|---|---|
    | Abracadaroom | 20 % | 200 € | 244 € | 282 € | 32 € |
    | Airbnb | 15,5 % | 190 € | 231 € | 267 € | 30 € |
    | Booking | 15 % | 189 € | 230 € | 265 € | 30 € |
    | Greengo | 14,5 % | 188 € | 229 € | 264 € | 30 € |
    | Abritel / Vrbo | 13 % | 184 € | 225 € | 259 € | 29 € |
    | **Direct** | 5 % + pack | **179 €** | **216 €** | **247 €** | **27 €** |
    | Gîtes de France | 0 % | 160 € | 195 € | 225 € | 25 € |

34bis. **The billed price and the net target are two stored numbers.** `pricing_rules.pricePerNight`
    stays what the engine bills (the **direct displayed price**, 179/216/247 €); the channel grid needs
    the **net target** (160/195/225 €), stored per season in `pricing_rules.netTargetPerNight`
    (`NULL` = legacy: the net *is* `pricePerNight`, today's behaviour for every existing property).
    Same split for the extra guest: `extraGuestPrice` is billed (27 €), `extraGuestNetTarget` is the
    grid pivot (25 €). The whole-euro formula is not invertible, so deriving one from the other at
    read time is not an option — both are declared by the recipe.
35. **GuestFlow prices direct bookings at the direct displayed price.** A reservation taken by phone,
    e-mail or the WordPress site is billed **179 / 216 / 247 €** and **27 €/night/extra guest** — one
    displayed price whatever the entry point, and the welcome pack financed on every direct stay.
    Reservations imported from a commissioned platform keep today's behaviour: the operator records the
    amount actually paid (`platformGrossAmount`); the engine does not re-price them.
36. **The degressivity is the source document's §6 table, verbatim** — one set of percentages for the
    three seasons:

    | Nights | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
    |---|---|---|---|---|---|---|---|
    | Discount | 0 % | 24 % | 33 % | 38 % | 41 % | 43 % | 45 % |

    It is declared in the recipe as that table (`lengthOfStayDiscounts`), not as a paraphrase: the
    engine bills marginal night prices, and the loader converts one into the other so the cumulative
    totals an operator reads in the document are reproduced to the cent.
37. **Past 7 nights, the 7th night's price repeats.** The document's « 7 et plus : 45 % » cannot be
    applied literally: a flat 45 % would make the 8th night cost 98,45 € against 76,97 € for the 7th,
    i.e. *dearer* — which rule 36's companion constraint (a further night is never more expensive
    than the one before it) forbids. Carrying the last tier forward keeps every declared value
    untouched and lets the discount keep deepening slightly beyond a week.

    Resulting marginal prices:

    | Season | N1 | N2 | N3 | N4 | N5 | N6 | N7 and beyond |
    |---|---|---|---|---|---|---|---|
    | LOW | 179,00 € | 93,08 € | 87,71 € | 84,13 € | 84,13 € | 84,13 € | 76,97 € |
    | MID | 216,00 € | 112,32 € | 105,84 € | 101,52 € | 101,52 € | 101,52 € | 92,88 € |
    | HIGH | 247,00 € | 128,44 € | 121,03 € | 116,09 € | 116,09 € | 116,09 € | 106,21 € |
38. **The discount applies to the extra-guest supplement too**, night by night, using that night's own
    ratio (`tier price ÷ season full price`). A `fixed`-mode season yields ratio 1, i.e. a plain
    per-night fee.
39. **The curve extends past the last configured tier.** Beyond the last night explicitly configured on
    a season, the last configured tier repeats. This replaces the fallback to the legacy weekly formula,
    which produced prices unrelated to the configured curve for stays over 14 nights.
40. **Babies are not occupants for pricing.** The extra-guest count is
    `max(0, adults + teens + children − 2)`; babies in a travel cot are excluded, as today. Children and
    teens are billed as adults.

34ter. **The channel grid lists an own channel ONCE.** `Lodgify` is the Direct row — its « moteur
    Lodgify » caption says so and its commission IS the engine fee — so it is not listed again
    underneath. Hidden from the grid only: the platform row still carries reservations and their
    commissions. _(Owner's call, 2026-08-12.)_

### 3.7 The Aventura Lodge recipe — calendar

41. **Closed 15 October → 31 March**, declared as a recurring closure and materialised per-property so
    the Gîte is unaffected. The Lodge is open **1 April → 14 October**. Seasons still cover the closed
    months — a closure governs availability, not price.
42. **Base shape: everything is low season except the summer core.**

    | Level | Period |
    |---|---|
    | `MID` shoulder 1 | The first **Saturday-to-Saturday week of July** — 7 nights from the first Saturday. |
    | `HIGH` | Everything between the two shoulders. |
    | `MID` shoulder 2 | The **last Saturday-to-Saturday week entirely within August** — 7 nights. |
    | `LOW` | The whole rest of the year. |

    2026 therefore reads: LOW `01/01 → 03/07`, MID `04/07 → 10/07`, HIGH `11/07 → 21/08`, MID
    `22/08 → 28/08`, LOW `29/08 → 31/12`.

    > This differs by one night from the tariff page's current 2026 painting, which runs MID to 11/07 —
    > an 8-night July shoulder against a 7-night August one. The night of **11/07/2026 moves from mid to
    > high season**: a deliberate symmetry fix, not an oversight.

43. **Public-holiday long weekends go up one rank**, capped at HIGH, skipping closed days. Because low
    season now covers spring, this rule finally does what it was meant to:

    | Year | Holiday | Nights raised | From → to |
    |---|---|---|---|
    | 2026 | Lundi de Pâques (Mon 6 Apr) | 4–5 April | LOW → MID |
    | 2026 | Fête du Travail (Fri 1 May) | 1–2 May | LOW → MID |
    | 2026 | Victoire 1945 (Fri 8 May) | 8–9 May | LOW → MID |
    | 2026 | Ascension (Thu 14 May) | 14–16 May | LOW → MID |
    | 2026 | Lundi de Pentecôte (Mon 25 May) | 23–24 May | LOW → MID |
    | 2027 | Ascension (Thu 6 May), absorbing Victoire (Sat 8 May) | 6–8 May | LOW → MID |
    | 2027 | Lundi de Pentecôte (Mon 17 May) | 15–16 May | LOW → MID |

    Easter Monday 2027 (29 March) falls inside the closure and is skipped. 14 July and 15 August always
    land inside the high-season block, so the **MID → HIGH branch is dormant** — specified so a future
    shoulder change behaves predictably, never fired by the current shape.
44. **What 2026 produces in full:**

    | Level | Ranges (holiday minimum in brackets) |
    |---|---|
    | LOW | 01/01→03/04 · 06/04→30/04 · 03/05→07/05 · 10/05→13/05 · 17/05→22/05 · 25/05→03/07 · 29/08→31/12 |
    | MID | 04/04→05/04 **[2]** · 01/05→02/05 **[2]** · 08/05→09/05 **[2]** · 14/05→16/05 **[3]** · 23/05→24/05 **[2]** · 04/07→10/07 · 22/08→28/08 |
    | HIGH | 11/07→13/07 **[3]** (14 juillet, mardi — already peak, minimum only) · 14/07→21/08 |

45. **Minimum nights: 1 everywhere except the holiday blocks** (rule 16bis — 2 or 3 nights),
    **maximum 7 nights** on every season, and **no changeover restriction**, in this first version of
    the recipe. Both are declared explicitly
    rather than omitted, so tightening high season to « 7 nuits, samedi au samedi » later is a
    one-line recipe edit and a re-apply — which is the whole point.
46. **Horizon: two calendar years**, the current one and the next. Nothing further: a five-year calendar
    written today would mostly be re-derived before anyone booked into it.

### 3.8 Services included in the rate

47. **Cleaning and linen are included, not deleted.** They stay as options on the Lodge, configured as
    property defaults marked « offered », which the engine already tags `includedInRate` and the summary
    already renders « Comprise » at 0 € ([pricing.js:1387](../../server/src/utils/pricing.js#L1387)).
    They are never billed on top of the nightly rate, on any channel.
48. ~~**Their reference value is deducted from the tourist-tax base.**~~ **Repealed 2026-08-20** by
    [tourist-tax-base-accommodation-only.md](../tourist-tax-base-accommodation-only.md), then
    **reinstated in a new form 2026-08-22** — see 48ter. The original rule was scaled `per_person` for
    the linen lines, so the declared base shrank as the party grew, and it only applied once the
    operator had actually ticked the line: two identical stays could declare different amounts.
48ter. **Their reference value leaves the tourist-tax base, as a per-stay forfait**
    ([tourist-tax-included-services-deduction.md](../tourist-tax-included-services-deduction.md)).
    Cleaning and linen are sold INSIDE the night rate, so the dry night the commune taxes is the
    accommodation charged minus what the rate already covers. Two guards make it stable, which is what
    48 lacked: the person factor is `basePriceIncludedGuests` (2 on the Lodge) and **never** the real
    party, and an included line can no longer be unticked on the fiche or dropped by a save. On the
    Lodge the deduction is a flat 60 € — Ménage 30 + Linge de lit 7 × 2 + Linge de toilette 8 × 2 — for
    a couple as for six.
48bis. **The tourist-tax configuration itself is never written by this work.** Rate, mode and
    departmental share are already set in production and correct (the Lodge is in
    `percentage_accommodation`). The recipe schema has no tourist-tax field and
    `configure-aventura-lodge-2026.mjs` does not list one in `PROPERTY_FIELDS`. Every price this spec
    quotes — nightly rates, net targets, the channel grid — is **exclusive of tourist tax**, which
    GuestFlow adds on top at quote time.
49. **A one-off commercial gesture is still not an inclusion.** Manually offering an option that is not
    a property default stays « Offert » rather than « Comprise ». The distinction drives the wording,
    the price lock **and, since 48ter, the tax again**: only a « Comprise » line leaves the base.
50. **The laundry contract is unaffected.** The options remain ticked on the reservation, so the bed-
    and bath-linen counters keep working exactly as today.

### 3.9 Welcome pack — own-channel bookings only

51. **Included by the unit, not by the line.** The pack is first-morning breakfast for 2 + a 1 L
    bottle of Pressoir du Pilat apple juice: **25 € of displayed value, 9,32 € of real cost**. It is
    not a « Pack accueil » option — it is `freeUnits` on two existing options (2 on « Petit
    déjeuner », 1 on « Jus de pomme 1L »), so the guest can order beyond it without the operator
    doing arithmetic.
52. **The rate covers the first N units; the guest orders as many as they want.** 5 guests × 2 nights
    = 10 breakfasts prepared, 2 covered (20 € struck through), 8 billed. `billedUnits` — what the
    Planning and SAS cards prepare — is deliberately untouched, so the kitchen still sees the full
    count. Applies to the planning-card branch too, which is the path every real breakfast takes.
52bis. **The Lodge charges 10 € a breakfast, the catalogue says 8 €.** A per-property price override
    carries it (the Gîte keeps 8 €). This is what makes the announced 25 € exact: 2 × 10 € + 5 €.
53. **Own-channel only — `direct` AND `Lodgify`.** Lodgify is the booking engine on the operator's own
    site: commercially a direct booking, its 5 % an engine fee rather than a marketplace commission,
    and the channel carrying the majority of real direct bookings. Gating on the string `direct`
    alone would deny the pack to most of the very bookings it exists for. Commissioned channels
    (Airbnb, Booking, Abracadaroom, Abritel, Greengo, GitesDeFrance) get nothing — the single
    deliberate difference between a direct and a platform booking. One helper,
    [`isDirectChannel`](../../server/src/utils/platformNameFormat.js), owns the list.

### 3.10 Reference totals

54. **Channel totals** —
    `total = round((displayed × nights + extraGuests × extra × nights) × (1 − discount[nights]))`.
    **All eight cases of the source document's §14 are reproduced exactly:**

    | # | Case | Expected | Source document §14 |
    |---|---|---|---|
    | 1 | Airbnb · 2 p · 1 n · LOW | 190 € | 190 € ✓ |
    | 2 | Airbnb · 2 p · 2 n · LOW | 289 € | 289 € ✓ |
    | 3 | Airbnb · 4 p · 3 n · HIGH | 657 € | 657 € ✓ |
    | 4 | Booking · 2 p · 1 n · HIGH | 265 € | 265 € ✓ |
    | 5 | Abracadaroom · 5 p · 7 n · HIGH | 1 455 € | 1 455 € ✓ |
    | 6 | Direct · 2 p · 1 n · LOW | 179 € | 179 € ✓ |
    | 7 | Direct · 2 p · 3 n · MID | 434 € | 434 € ✓ |
    | 8 | Abritel · 3 p · 2 n · MID | 386 € | 386 € ✓ |

55. **Engine totals** — what `calculateReservationQuote` must return for a **direct** reservation:

    | # | Case | Accommodation | Extra guests | Total |
    |---|---|---|---|---|
    | D1 | 2 p · 1 n · LOW | 179,00 € | — | 179,00 € |
    | D2 | 2 p · 2 n · LOW | 272,08 € | — | 272,08 € |
    | D3 | 2 p · 3 n · MID | 434,16 € | — | 434,16 € |
    | D4 | 4 p · 3 n · HIGH | 496,47 € | 108,54 € | 605,01 € |
    | D5 | 5 p · 7 n · HIGH | 950,95 € | 311,85 € | 1 262,80 € |
    | D6 | 3 p · 2 n · MID | 328,32 € | 41,04 € | 369,36 € |

    The engine works in cents; whole-euro rounding is a channel-configuration concern, not a billing one.

**Edge cases:**
- Recipe with two seasons at the same rank, or a period naming an unknown season → rejected at load with
  its own error; the other recipes still load.
- Recipe declaring a `between` anchor whose bounds resolve to an empty span → that period produces no
  range; the base season keeps those days.
- Applying a recipe to a property whose seasons are all manual → every one appears as « sera
  supprimée »; the operator sees the full extent before confirming.
- A recipe removed from `data/recipes/` while a property still references it → the property keeps its
  seasons; the tariff page shows « Recette introuvable » and offers to detach.
- A recipe updated to a new version → the property still shows the applied version; the diff on
  re-apply is what surfaces the change.
- Raised block straddling the closure boundary → only the open nights are raised (rule 17).
- Two holidays in one block (2027's Ascension and 8 May) → one merged range, never two overlapping.
- Holiday block straddling 31 December → each year's generation owns its own days.
- Stay spanning two seasons → each night takes its own season's tier; night 1 of the stay is the
  full-price night whichever season it falls in.
- Stay longer than the last configured tier → last tier repeats (rule 39).
- Occupancy ≤ 2 → no extra-guest line, unchanged.
- Extra-guest supplement offered → billed 0, real value in `extraGuestSurchargeOriginal`, unchanged.
- Included options worth more than the accommodation on a very short discounted stay → tax base floored
  at 0, never negative.
- Past reservation with a frozen tourist tax
  ([tourist-tax-freeze-past-with-refresh.md](../tourist-tax-freeze-past-with-refresh.md)) → the frozen
  amount wins; the deduction does not rewrite an already-declared tax.
- Platform reservation with `platformGrossAmount` set → the pinned gross drives the tax base, minus the
  included-option deduction.
- Channel with commission ≥ 100 % → no price, existing `grossFromNet` contract, unchanged.
- Changeover rule on a 1-night stay → arrival and departure rules both apply and can be mutually
  impossible; the preview warns when a recipe declares such a combination.

---

## 4. Architecture

Full code map in [architecture.md](architecture.md). Summary:

- **Server** — a new `utils/tariffRecipe.js` (load, validate, resolve sources) and `utils/seasonPlan.js`
  (pure derivation of a year's ranges from a recipe), a new `models/tariffRecipeModel.js` (diff and
  apply), changeover validation in `utils/pricing.js` alongside the existing minimum-nights logic, plus
  the four engine changes of Part B in `pricing.js` and `propertiesModel.platformPrices`;
  `scheduledTasks.js` extends horizons monthly; `database.js` gains five columns.
- **Client** — a recipe browser page, a recipe card on the property tariff page with the apply preview
  dialog, changeover and minimum-nights markers plus a legend on the tariff calendar, the widened
  platform grid, and the extra-guest and tax-base lines in `PricingSummary`.
- **One new feature component** (`TariffRecipeCard`); everything else composes existing generics.

## 5. Data model

Eleven idempotent columns and one small table. Recipes themselves are files, not rows.

| Table | Column | Type | Default | Purpose |
|---|---|---|---|---|
| `properties` | `tariffRecipeId` | TEXT | `''` | Empty = fully manual, today's behaviour and the default. |
| `properties` | `tariffRecipeVersion` | TEXT | `''` | The version actually applied, for the "recipe has moved" indicator. |
| `properties` | `extraGuestPriceUnit` | TEXT | `'per_stay'` | `per_stay` (legacy, every existing property) or `per_night`. |
| `properties` | `welcomePackCost` | REAL | `0` | Fixed per-stay cost the direct displayed price must cover. `0` = today's formula. |
| `pricing_rules` | `seasonKey` | TEXT | `NULL` | The recipe season this rule materialises. `NULL` = manual, never touched by an apply. |
| `pricing_rules` | `seasonRank` | INTEGER | `NULL` | Cheap-to-expensive order; what "one rank up" walks. |
| `pricing_rules` | `netTargetPerNight` | REAL | `NULL` | Channel-grid pivot (rule 34bis). `NULL` = `pricePerNight` is the net, legacy behaviour. |
| `pricing_rules` | `extraGuestPrice` | REAL | `NULL` | Per-season billed override; `NULL` inherits the property's. |
| `pricing_rules` | `extraGuestNetTarget` | REAL | `NULL` | Channel-grid pivot for the extra guest (rule 34bis). |
| `pricing_rules` | `maxNights` | INTEGER | `NULL` | Maximum stay in nights (rule 20bis). `NULL` = unlimited. |
| `pricing_rules` | `changeoverArrival` | INTEGER | `NULL` | 0–6 (JS weekday, 0 = dimanche), `NULL` = unrestricted. |
| `pricing_rules` | `changeoverDeparture` | INTEGER | `NULL` | 0–6, `NULL` = unrestricted. |

One table, `tariff_recipe_runs`, records what the scheduled horizon task did (a generated year, or a
blocking reason) so the Dashboard can surface it and the operator can dismiss it — the generation
event exists nowhere else in DB state. UI-initiated applies do not write rows (the operator watched
them happen). Columns: `id`, `propertyId` (FK, cascade), `recipeId`, `recipeVersion`,
`generatedYear`, `note`, `blocking`, `createdAt`, `dismissedAt`.

Per-range overrides for `minNights`, `changeoverArrival` and `changeoverDeparture` travel inside the
existing `dateRanges` JSON, exactly as `minNights` already does
([pricing-min-nights-per-range.md](../pricing-min-nights-per-range.md)) — no new column, and the
normalisation that already drops blank values is reused.

**Data impact:** none. Every default reproduces current behaviour byte-for-byte: no recipe, per-stay
extra guest, no welcome-pack add-on, untagged seasons an apply will not touch, unrestricted changeover.
No backfill. Only Aventura Lodge gets a recipe, by an explicit action.

## 6. UI / UX

**Recipe browser** — a new page under Settings, « Recettes tarifaires ». A list of cards, one per
recipe: label, `id`, version, a `StatusBadge` reading « Livrée » or « Locale », an « Écrase la version
livrée » chip where relevant, the properties using it, and an expandable pretty-printed view of the
document. Read-only in this version. An invalid recipe shows as an `ErrorAlert` card naming its file and
its validation error, so a bad drop in `data/recipes/` is visible rather than silent. On `xs` the cards
stack and the document view scrolls inside its own container.

**Property tariff page — recipe card**, above the season list: the active recipe, its applied version,
a warning when the file has moved on (« Version 1.1.0 disponible »), a « Changer de recette » select,
and an « Appliquer » action. Applying opens a full-width dialog — `fullScreen` on `xs` — listing the
diff grouped by season: created in green, removed struck through in red, and per-season the ranges added
and dropped, year by year. « Appliquer » and « Annuler »; nothing is written until « Appliquer ».
Seasons the recipe governs show a `StatusBadge` with their season key; manual ones show « Manuelle ».

**Property tariff page — calendar markers.** The month grid gains, on top of today's season colour,
public-holiday dot and school-holiday dot:
- the **effective minimum nights** as a small superscript on every day where it exceeds 1 — today it only
  appears where a range overrides its season, which hides a season-wide minimum entirely;
- a **left chevron** on a day that is a permitted arrival and a **right chevron** on a permitted
  departure, shown only when the covering rule restricts them;
- a **legend** under the grid naming every marker. The calendar currently has none, and it now carries
  five distinct signals.

**Property settings** — a read-only « Recette tarifaire : Aventura Lodge 2026 (v1.0.0) » line with a
link to the tariff page, plus the extra-guest unit selector and the « Coût du pack accueil (direct) »
field.

**Platform grid** — gains a **Direct** row, rendered first with a « moteur Lodgify » caption, and a
**« Personne supp. / nuit »** column. Whole euros. Existing horizontal scroll container kept on `xs`.
The Direct row uses the same row separator as every other row — its channel name is bold, but no
thicker bottom border sets it apart (feedback 2026-08-13).

**Reservation summary** — the extra-guest line reads « Personne supplémentaire — 27 €/nuit × 3 pers. ×
5 nuits » when the unit is per-night. A muted line under the tourist tax reads « Base : 518,40 € −
34,09 € de prestations comprises » when a deduction applies. A changeover breach shows the same inline
error style as a minimum-nights breach, naming the required day: « Arrivée le samedi uniquement ».

**Dashboard** — when the scheduled task generates a year: « Calendrier saisonnier — 2028 généré pour
Aventura Lodge », with a link to the tariff page and a dismiss action, in the existing alert list.

**PageActionBar** — no page-level action added or removed on existing pages. The new recipe browser gets
`<PageActionBar title="Recettes tarifaires" backTo="/settings" />`; it is read-only, so no Save.

**Responsive** — every touched screen is an existing layout except the recipe browser, which is a card
list. New elements are form fields, one table column, calendar markers and two dialogs, all inside
containers that already handle `xs`. The manual test plan includes a mobile pass on each.

## 7. Test plan

### Server unit tests

- [ ] `tests/tariff-recipe-load.unit.test.js` — a valid recipe loads; an invalid one is rejected alone
      with its error; a `data/recipes/` recipe overrides a bundled one of the same `id`; a missing data
      directory is not an error (rules 26, 27).
- [ ] `tests/tariff-recipe-schema.unit.test.js` — duplicate ranks, unknown season in a period, unknown
      period in a `between`, out-of-range weekday, negative price: each rejected with a named error
      (rules 1 to 5).
- [ ] `tests/season-plan-generator.unit.test.js` — the 2026 and 2027 range tables of rules 43 and 44 to
      the day; shoulders land on the anchor weekday for ten consecutive years; seasons never overlap and
      together cover every day; a holiday block inside a closure is skipped; 2027's Ascension and 8 May
      merge (rules 13 to 19, 42 to 44).
- [ ] `tests/tariff-recipe-apply.unit.test.js` — diff shape; orphan season marked for removal and
      removed on apply; manual seasons untouched; transactional rollback on failure; re-apply produces
      an empty diff; years before the horizon survive (rules 8 to 12).
- [ ] `tests/changeover-validation.unit.test.js` — arrival resolved on the first night, departure on the
      last; a stay spanning two seasons takes one rule from each; unrestricted by default; the force
      override saves anyway; an iCal import is never blocked (rules 21 to 24).
- [ ] `tests/extra-guest-per-night.unit.test.js` — the six D1–D6 cases of rule 55 to the cent; a
      `per_stay` property keeps its legacy flat amount; a per-season override wins over the property's
      (rules 37, 38, 55).
- [ ] `tests/tier-carry-forward.unit.test.js` — a 28-night LOW stay totals 3 562,10 €; a season with no
      configured tier still matches the legacy weekly model (rule 39).
- [ ] `tests/discount-monotonicity.unit.test.js` — marginal night prices non-increasing and total
      discount never above 30 % up to 60 nights (rules 36, 37).
- [x] `tests/tourist-tax-base-accommodation-only.unit.test.js` — **replaces**
      `tests/tourist-tax-included-in-rate.unit.test.js` since rule 48 was repealed on 2026-08-20
      ([tourist-tax-base-accommodation-only.md](../tourist-tax-base-accommodation-only.md)): the base
      is the accommodation charged and seven extra variations — paid, offered, `includedInRate`, in
      Complément, custom option, resource — all yield the identical tax; the platform brut no longer
      derives it; `customPrice` and the discount do; a frozen tax is untouched; a flat per-adult
      property is unaffected (rule 49).
- [ ] `tests/platform-price-from-commission.unit.test.js` (extended) — `grossFromNet` ceils to the whole
      euro; the fixed-cost add-on gives 179 / 216 / 247 €; the grid carries the direct row and the
      extra-guest column with 32 / 30 / 30 / 30 / 29 / 27 / 25 € (rules 31 to 34).
- [ ] `tests/tariff-recipe-scheduled-task.unit.test.js` — extends only when a year is missing, one alert
      per generated year, idempotent on a second run (rule 12).
- [ ] Existing pricing suites pass unchanged — the regression guarantee for every other property.

### Client tests

- [ ] Recipe browser renders bundled, local-override and invalid recipes distinctly.
- [ ] `TariffRecipeCard` shows the applied version, the moved-version warning, and opens the diff dialog.
- [ ] Tariff calendar renders the minimum-nights superscript for a season-wide minimum, the changeover
      chevrons, and the legend.
- [ ] `PricingSummary` renders the per-night extra-guest label, the tax-base deduction, and the
      changeover breach message.
- [ ] `PropertyDetail` round-trips the extra-guest unit. (The welcome-pack cost left the form in
      2026-08-12 — rule 6bis: the recipe owns it.)

### Manual UI verification

- [ ] Apply the Aventura recipe: the preview lists 2026 + 2027 exactly as rules 43–44, applying writes
      them, the season list and calendar match, and the Gîte is untouched.
- [ ] Re-apply with no change → empty diff, nothing written.
- [ ] Drop an edited recipe in `data/recipes/` → the browser shows it as « Locale » overriding the
      bundled one, and the tariff card offers the new version.
- [ ] Drop an invalid recipe → it shows as an error card; every other recipe still loads; the app boots.
- [ ] Direct reservation, 5 people, 7 nights, HIGH → 1 705,60 €, matching case D5.
- [ ] Set high season to 7 nights minimum, Saturday to Saturday, in the recipe; re-apply; a Wednesday
      arrival is refused with the French message and savable with the force override.
- [ ] Linen and cleaning shown « Comprise » at 0 €; total unchanged; tourist-tax base reduced by their
      value and the reduction visible.
- [ ] Offering an unrelated option by hand → « Offert », no tax-base deduction.
- [ ] Tariff grid matches rule 34 exactly.
- [ ] The night of 11/07/2026 is high season (the deliberate one-night shift of rule 42).
- [ ] A 2-night stay arriving Sat 4 April 2026 prices at MID (367,20 €); a week earlier, LOW (304,30 €).
- [ ] **Regression:** a Gîte reservation quotes exactly the total recorded before the change.
- [ ] **Regression:** the Planning laundry card still counts the Lodge's sheets and towels.
- [ ] **Regression:** a platform reservation with a recorded gross amount is unchanged.
- [ ] Mobile pass: recipe browser, tariff page card and diff dialog, calendar markers and legend,
      property detail form, reservation summary.

## 8. Out of scope

- **Editing recipes in the UI.** The browser is read-only; updating means dropping a file in
  `data/recipes/`. A full CRUD with versioning and conflict handling is a later spec.
- **Generating recipes.** They are written by hand or produced by an AI outside the app; GuestFlow
  loads, validates and applies them.
- **Switching other properties to a recipe.** The mechanism is generic; only Aventura Lodge is enabled.
- **Modifier types beyond `public_holiday_bridge`** — school holidays, events, last-minute rules. The
  language is designed to take them; none is implemented here.
- **Anchoring shoulders on the synced school-holiday dates.** The app has the data
  ([school-holidays.md](../school-holidays.md)); the Saturday anchor reproduces the intended calendar
  without it.
- **Conditional freebies** — « plancha offerte dès 2 nuits », « location matériel 18 € dès 3 nuits » are
  not expressible as pricing rules; they stay a manual gesture.
- **Tourist-tax configuration.** Rate, mode and departmental share are production-owned, correct, and
  deliberately untouched (rule 48bis). Only the computed base moves.
- **Automatic rate push to the OTAs.** The grid is a copy-paste reference.
- **Re-pricing existing reservations.** The new tariff applies to reservations created or re-quoted
  after the change; locked snapshots keep their prices.
- **Cancellation policy** (source document §13) and **margin tracking** (§8) — no GuestFlow object today.

## 9. Open questions

_None. All three are answered below._

**Resolved (2026-08-12) — the welcome pack, decided by the owner:**
- **Which channels.** `direct` **and** `Lodgify` (rule 53). The code shipped gating on the string
  `direct` alone while the spec already said « Lodgify alike » — a real defect: 15 of the 29
  reservations in the database are Lodgify, 2 are `direct`, so the pack would almost never have
  fired. Fixed by a single named helper. ✅
- **Breakfast price.** 10 € **at the Lodge only**, via a per-property override; the catalogue and the
  Gîte stay at 8 €. The announced 25 € of pack value is now exact (rule 52bis). ✅
- **The apple juice.** Modelled like the breakfasts — 1 covered unit on the existing « Jus de pomme
  1L » (Boissons), not a synthetic « Pack accueil » line. A second bottle is billed normally. ✅
- **Q3 — early check-in.** Left as it is: an auto-option priced **proportionally**, so it derives from
  the nightly rate and follows the new seasonal prices with no maintenance. The 1-night plancha price
  is moot — the plancha is not a GuestFlow object and stays a manual gesture (§8). ✅

**Amended (2026-08-22):** rule 48 is reinstated as **48ter**, in a party-independent form the
operator cannot untick — see
[tourist-tax-included-services-deduction.md](../tourist-tax-included-services-deduction.md).

**Amended (2026-08-20):** rule 48 is repealed — see
[tourist-tax-base-accommodation-only.md](../tourist-tax-base-accommodation-only.md). The tax base is
the accommodation charged; no deduction, and no derivation from the platform brut either.

**Resolved (2026-08-12) — tourist tax, both questions closed by the owner:**
- **Q1 — Satillieu's rate and mode.** Already configured in production, working, and **not to be
  touched**. The Lodge is in `percentage_accommodation` mode. Nothing in this work writes the
  parameters (rule 48bis). ✅
- **Q2 — Extra-guest supplement in the tax base.** **No.** The declaration works as it stands; the
  supplement stays out of `taxBaseAccommodation`. Reopening it would change amounts that are correct
  today, which is exactly what the owner ruled out. ✅
- Consequence for every price in this spec and in the UI: they are **exclusive of tourist tax**. The
  « prix tout compris » of the source document means cleaning and linen included, not the tax. ✅

**Resolved (2026-08-11):**
- The tariff model is expressed as a **recipe**: a declarative, AI-generatable document with an open
  list of seasons, applied to a property. ✅
- Recipe scope: seasons, calendar rules, closures, prices, discount curves, minimum nights, changeover,
  extra guest. Out: capacity, beds, check-in/out, deposit, included options, welcome pack, commissions. ✅
- Recipes load from the repository, then from `data/recipes/` which can override by `id` — updating a
  recipe needs no release. Browser read-only in this version. ✅
- Applying previews first; seasons the recipe does not declare are removed after confirmation. ✅
- Discount curve: **the source document's §6 table, verbatim** (24/33/38/41/43/45 %), declared as a
  cumulative table in the recipe and converted to marginal night prices by the loader. All eight of
  the document's §14 channel cases are reproduced exactly. Beyond 7 nights the 7th night's price
  repeats, because a literal « 45 % et plus » would make night 8 dearer than night 7. (Two earlier
  passes got this wrong — a 30 % cap, then a 47,5 % floor pinned on the 7-night value; corrected
  2026-08-12 on Adrien's instruction to follow the table itself.) ✅
- Holiday blocks impose a minimum stay equal to their own length — 2 nights for a Friday or Monday
  holiday, 3 for a bridge. ✅
- Direct bookings taken in GuestFlow are billed at the Lodgify displayed price (179 / 216 / 247 €). ✅
- Whole-euro ceiling rounding on the platform grid, globally — verified safe: `grossFromNet` feeds the
  display grid only, never a billed amount. ✅
- The welcome pack is an option included in the rate on direct and Lodgify bookings. ✅
- Linen and cleaning options are kept and marked included, not deleted — laundry counting depends on
  them. ✅
- Symmetric 7-night shoulders: the night of 11/07/2026 moves from mid to high season. ✅
- Horizon of two years, extended by a monthly scheduled task with a Dashboard alert. ✅
- Changeover day is new, declared per season and per range, and behaves exactly like minimum nights —
  same enforcement, same force override, same UI pattern. ✅
