# Gîte tariff — the study behind the recipe

| Field | Value |
|---|---|
| **Companion** | [spec.md](spec.md) · the recipe: [`server/src/recipes/gite-2027.json`](../../server/src/recipes/gite-2027.json) |
| **Written** | 2026-08-24 |
| **Sources** | the production database as of 2026-08-24 (24 stays, 5 tariff seasons), the Aventura Lodge precedent ([specs/tariff-recipes/spec.md](../tariff-recipes/spec.md)), the two skills `.claude/skills/tariff-recipe` and `.claude/skills/platform-tariff-rollout` |

The Lodge's 2026 revision started from a commercial document. The Gîte has none: its tariff exists
only as 5 hand-painted seasons and 13 rows of progressive tiers in `pricing_rules`. This document is
the missing half — what that grid actually says, what it gets wrong, and which decisions the recipe
could not take on its own.

Everything below was computed from the data, never by hand. Nothing here is a proposal for a *new*
price: the instruction was to start from the rate GuestFlow already carries for the own channel.

---

## 1. What the Gîte's grid actually is

Five seasons, whole-house pricing (no included-guest threshold, no extra-guest supplement, 10 people
max), 2-night minimum everywhere, no stay ceiling, no changeover day, open all year.

| Season | Displayed /night | Painted 2026 |
|---|---|---|
| Très basse | 252 € | 01/01 → 03/04 · 31/10 → 18/12 |
| Basse | 303 € | 04/04 → 30/04 |
| Moyenne | 326 € | 01/05 → 03/07 · 29/08 → 30/10 |
| Haute | 382 € | 04/07 → 10/07 · 22/08 → 28/08 · 19/12 → 01/01 |
| Très haute | 537,50 € | 11/07 → 21/08 |

### 1.1 The degressivity is one sentence: **a week is four nights**

The 13 tier rows per season are not a curve someone drew. Solve them and every season collapses to
the same three facts:

- nights 1 and 2 are billed at the full rate;
- a 7-night week costs **exactly 4 × the nightly rate**, nights 3 to 7 interpolating linearly;
- past a week, each further night costs **a seventh of a week**.

Which gives one cumulative discount table, identical for all five seasons:

| Nights | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 and beyond |
|---|---|---|---|---|---|---|---|---|
| Discount | 0 % | 0 % | 20 % | 30 % | 36 % | 40 % | 42,857 % | 42,857 % |

Checked against the stored tiers season by season: Très basse 100,80 € / 144 €, Basse 121,20 € /
173,14 €, Moyenne 130,40 € / 186,29 €, Haute 152,80 € / 218,29 € — **reproduced to the cent**.

### 1.2 The calendar is Saturday-anchored, and derivable

Every 2026 season boundary but one falls on a Friday night → Saturday morning. Read as rules rather
than dates, the whole year is four statements:

| Rule | 2026 | 2027 |
|---|---|---|
| April is low season | 01/04 → 30/04 | 01/04 → 30/04 |
| May to October is mid season | 01/05 → 30/10 | 01/05 → 30/10 |
| The **first Saturday-to-Saturday week of July** and the **last whole week of August** are high | 04/07 → 10/07 · 22/08 → 28/08 | 03/07 → 09/07 · 21/08 → 27/08 |
| Everything **between the two** is peak | 11/07 → 21/08 | 10/07 → 20/08 |
| 19 December → 1 January is high | 19/12 → 01/01 | 19/12 → 01/01 |
| Everything else is very low | 02/01 → 31/03 · 31/10 → 18/12 | 02/01 → 31/03 · 31/10 → 18/12 |

The July and August rules paint over the May-to-October one; the last write wins, which is the only
precedence rule the calendar language has.

That is the Lodge's own calendar language, with two extra season ranks and a year-end block. Derived
and compared day by day against the painting, **2026 comes out with 4 days of difference** — and each
of the four is a defect in the painting, not in the rule:

| Day | Painted | Derived | Why the derived one is right |
|---|---|---|---|
| 01/01/2026 | Très basse | Haute | The painting already puts 01/01/**2027** in high season. 2026's own New Year's Day was simply never painted. |
| 01–03/04/2026 | Très basse | Basse | The painting starts low season on the first Saturday of April. Nothing commercial says spring begins on a Saturday; the month does. |

### 1.3 One season is broken

**Très haute is the only season whose tiers do not follow the rule** — and it does not follow itself
either:

- its own long-stay tail bills 307 €/night from the 15th night, which is `4 × 537,50 / 7 = 307,14` —
  i.e. it is priced off a 2 150 € week;
- but its nights 2 to 14 add up to a **1 794,75 €** week, 16,5 % below that;
- and night 6 is billed **21,50 €**, which no commercial reasoning produces.

The stays actually sold over that period confirm it: reservation #9 (19 → 26 July 2026, 7 nights)
was quoted **2 148 €** when it was taken — 4 × 537 —, and #10 (14 nights in August) **4 296,02 €**,
which is that same week twice. The curve was overwritten *after* those two sales.

**Cost of the defect:** the Gîte's peak weeks — the 42 highest-demand nights of the year — are
currently quoted 16,5 % below the grid's own intent.

---

## 2. What the Gîte sells

24 stays on the books for 2026, 20 968,67 € of gross.

| Channel | Stays | Gross |
|---|---|---|
| **Gîtes de France** | 15 | 17 602,13 € |
| Booking | 2 | 1 935,34 € |
| Direct | 1 | 807,20 € |
| Greengo | 1 | 624,00 € |

Stay lengths: 2 n × 9, 3 n × 3, 4 n × 2, 5 n × 2, 7 n × 2, 14 n × 1. Party sizes run from 4 to 12,
with 9 stays at 9 or 10 people. So: **a two-night weekend or a full week, and usually a full house.**

Three consequences for the model:

1. **The 2-night minimum and the absence of a stay ceiling are load-bearing.** Nine of the 24 stays
   are exactly 2 nights, and one is 14. A `maxNights: 7` like the Lodge's would have refused the
   single biggest booking of the year.
2. **No changeover day.** The three peak weeks left on a Sunday, a Saturday and a Monday. A
   Saturday-to-Saturday rule would have refused two of the three.
3. **The party size never moves the price**, and the sales do not argue for changing that: the house
   fills anyway. Introducing an extra-guest supplement is a commercial redesign, not a re-encoding —
   see §4 Q3.

---

## 3. The net pivot

The Lodge decided a net target first and derived the displayed price from it. The Gîte goes the
other way, per the instruction: the price GuestFlow already bills on the own channel *is* the
displayed price, and the net is what survives the 5 % Lodgify engine fee.

```
net = displayed × 0,95            displayed = ceil(net / 0,95)
```

The two directions must agree exactly, or the net was stored wrong — the failure that shipped once on
the Lodge (trap 15 of the recipe skill: a net target validated then dropped, and every channel
grossed up from a price that already contained the margin). Asserted per season in the test suite.

| Season | Displayed (own channel) | Net target |
|---|---|---|
| Très basse | 252 € | 239,40 € |
| Basse | 303 € | 287,85 € |
| Moyenne | 326 € | 309,70 € |
| Haute | 382 € | 362,90 € |
| Très haute | **538 €** | 511,10 € |

Très haute is the one displayed price that moves — 537,50 € → 538 €. The channel grid rounds up to
the whole euro, so a half-euro base makes the direct row unable to reproduce its own price. The move
is +0,50 €/night.

**Resulting grid**, computed with the commissions currently stored in `platforms`:

| Channel | Commission | Très basse | Basse | Moyenne | Haute | Très haute |
|---|---|---|---|---|---|---|
| Abracadaroom | 20 % | 300 € | 360 € | 388 € | 454 € | 639 € |
| Airbnb | 15,5 % | 284 € | 341 € | 367 € | 430 € | 605 € |
| Booking | 15 % | 282 € | 339 € | 365 € | 427 € | 602 € |
| Greengo | 14,5 % | 280 € | 337 € | 363 € | 425 € | 598 € |
| **Direct / Lodgify** | 5 % | **252 €** | **303 €** | **326 €** | **382 €** | **538 €** |
| Gîtes de France | **0 %** | 240 € | 288 € | 310 € | 363 € | 512 € |

> **That last row is wrong, and it is the Gîte's main channel.** `platforms.GitesDeFrance.commissionPercent`
> is 0 in GuestFlow. The seven Gîtes-de-France bookings that carry a recorded commission total
> 1 710,73 € on 12 202,13 € of gross — **14,02 %**, individual rates ranging from 6,90 % to 19,58 %.
> At 14 %, the Gîtes-de-France row would read 279 / 335 / 361 / 423 / 595 € rather than
> 240 / 288 / 310 / 363 / 512 €. See §4 Q2 — this is the single number that most changes the Gîte's
> real revenue, and it is not one the data can settle.

---

## 4. Iso-price check

The 24 stays of 2026, re-priced by the recipe and compared with what the current grid bills today:

| Stay | Nights | Current grid | New grid | Delta |
|---|---|---|---|---|
| 18 of the 24 stays | | | | **identical to the cent** |
| 01/01/2026 | 2 | 504,00 € | 634,00 € | +130,00 € — New Year's Day joins the year-end block |
| 03/04/2026 | 3 | 676,20 € | 727,20 € | +51,00 € — April in low season from the 1st |
| 17/07/2026 | 2 | 1 074,50 € | 1 076,00 € | +1,50 € — the 537,50 → 538 rounding |
| 19/07/2026 | 7 | 1 794,75 € | 2 152,00 € | +357,25 € — Très haute repaired |
| 01/08/2026 | 14 | 3 595,36 € | 4 304,01 € | +708,65 € — Très haute repaired |
| 17/08/2026 | 7 | 1 896,10 € | 2 027,20 € | +131,10 € — Très haute repaired |
| **Total** | | **22 349,31 €** | **23 728,81 €** | **+1 379,50 € (+6,2 %)** |

**87 % of the difference (+1 197 €) is the repair of one broken season.** The rest is 4 calendar days
and half a euro. Nothing in the recipe raises a price on purpose.

---

## 5. Arbitrations the recipe could not take alone

### Q1 — Public-holiday long weekends

The Lodge raises every « pont » one rank and imposes the block's own length as a minimum stay. The
Gîte has no such rule, and its May long weekends visibly sell above the base rate (1–3 May 2026 at
687 €, 8–10 May at 733 € on Gîtes de France, against a 652 € mid-season 2-night rate). The rule
belongs here.

**It cannot be turned on as things stand.** `public_holiday_bridge` caps the raise at the *highest*
rank, which on the Lodge is high season and on the Gîte is **Très haute, 538 €/night — a full-August
price**. Switched on unchanged it prices 25 December and 1 January at 538 €, and shatters the calendar
into 24 ranges. Derived and inspected; not a hypothesis.

The missing piece is one optional field, `capSeason`, on the modifier — 4 lines in
[`seasonPlan.js`](../../server/src/utils/seasonPlan.js) (`Math.min(capRank, currentRank + amount)`), a
validation line, and a test. Default = the highest rank = today's behaviour, so the Lodge is
untouched. Deliberately **not** written tonight: it is an engine change, and turning ponts on re-prices
already-open dates — both decisions rather than transcriptions.

### Q2 — The Gîtes de France commission

See §3. Until the contractual rate is entered, the channel grid cannot be derived for 70 % of the
Gîte's bookings, and the Gîte's accounting attributes 0 € of commission to them. This is not part of
the recipe (commissions are global per platform) but it gates the rollout.

### Q3 — Whole-house price, or base + extra guest?

The Lodge sells "2 people included, then 15 € the first night and 8 € after". The Gîte sells the
house, and its two per-person costs sit outside the rate: bath linen at 8 €/person and, when the
guest does not do it, cleaning at 80 €/stay. A full house therefore adds up to 160 € of supplements
on top of a 504 € weekend.

Three coherent models, none derivable from the data:

1. **Keep the whole-house price** (what the recipe does). Simplest, iso-price, and the house fills.
2. **All-inclusive**, like the Lodge: fold cleaning and bath linen into the nightly rate. Needs a
   decision on how to spread a per-stay 80 € across a curve where a stay is 2 to 14 nights, and it
   makes a couple pay for ten people's towels.
3. **Base + extra guest**: an included-guest threshold (6?) and a per-night supplement above it,
   carrying the per-person costs. The closest to the Lodge, and the biggest change.

### Q4 — The 8th night costs more than the 7th

A consequence of the week-is-four-nights model, kept as is: nights 3 to 7 are billed 100,80 € in
Très basse, and the 8th 144 €. Totals never decrease, so nothing is broken, but the Lodge explicitly
forbade a marginal price that goes back up (spec rule 37). Smoothing it — extending the 7th night's
marginal price instead — would cut a 14-night peak stay by 15 %, i.e. about 645 € on the single
14-night booking of 2026. Left alone on purpose.

### Q5 — Five seasons, two of which are 7,6 % apart

Basse (303 €) exists for the month of April alone — 20 % above Très basse, 7 % below Moyenne.
A rank that narrow costs a season on every channel's configuration for 30 nights a year. Merging it
into Moyenne, or widening it to cover the shoulder months, would both be defensible. Kept as is
because the instruction was to start from the rates that exist.

---

## 6. What is deliberately not in the recipe

Property-level, and unchanged: capacity (10), beds, check-in 16:00 / check-out 10:00, the 500 €
security deposit, the 30 % deposit, the tourist tax (1,20 €/person/day, `per_day_per_person` — the
Lodge's move to a percentage of the accommodation is a separate subject), and which options are
included in the rate (bed linen yes, cleaning and bath linen no).

Platform-side, and untouched until the arbitrations above are settled: no channel was configured, no
quote was taken on any booking engine, nothing was published. The rollout is the
`platform-tariff-rollout` skill's job, and it starts once §5 is answered.
