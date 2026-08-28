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
| 30 → 31 December is the réveillon, carved out of it _(added 2026-08-25)_ | 30/12 → 31/12 | 30/12 → 31/12 |
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

## 2bis. The only year-end evidence that exists

GuestFlow holds **nothing** before 2026: the one row it has earlier than 15 January 2026 is a 0 €
iCal import. Every figure below was produced by the owner on 2026-08-28, from the channels' own
statements, and it is the entire factual basis for the year-end part of the recipe.

| Stay | Nights | Gross | Per night | Source |
|---|---:|---:|---:|---|
| Christmas | 2 | 1 550,00 € | **775,00 €** | owner (« Tangi »), 2026-08-28 |
| Réveillon | 3 | 1 222,00 € | **407,33 €** | channel statement, ref. HA-ZB330Z, net 1 103,94 € after 9,66 % |
| Late October | 2 | 492,00 € | 246,00 € | channel statement, ref. HA-PVSF94, net 444,34 € |

A fourth document — Gîtes de France contract n° 13164, 26 → 30 December, 4 nights, 840 € rental,
210 €/night — was given first and then **superseded by the owner**: the Christmas stay on the Gîte
was Tangi's two nights at 1 550 €. The contract is kept here anyway, because it is the source of the
commission arithmetic in Q2 and that finding stands whatever stay it describes.

Three things follow, and they drove every year-end decision in the recipe:

1. **The réveillon was underpriced by the grid, not just by the market.** 407 €/night was obtained;
   the grid in force bills those nights **382 €**. It was quoting below a price already paid.
2. **Late October at 246 €/night** sits under the Moyenne season (326 €) that the recipe assigns it.
   Nothing was changed there — it is one stay — but it is the only evidence that the shoulder season
   may be optimistic, and it is worth a second look once a season of real data exists.
3. **The year-end cannot be reasoned about from GuestFlow.** Any future review of these prices has to
   start by getting the channel statements out again. This section is the substitute for the history
   the database does not have.

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
| Noël — 24 and 25 December only | **930 €** — flat, no length discount | 883,50 € |
| Nouvel An — 31 December only | **963 €** — flat, no length discount | 914,85 € |

Très haute is the one displayed price that moves — 537,50 € → 538 €. The channel grid rounds up to
the whole euro, so a half-euro base makes the direct row unable to reproduce its own price. The move
is +0,50 €/night.

**Resulting grid**, computed with the commissions currently stored in `platforms`:

| Channel | Commission | Très basse | Basse | Moyenne | Haute | Très haute | Noël* | Nouvel An* |
|---|---|---|---|---|---|---|---|---|
| Abracadaroom | 20 % | 300 € | 360 € | 388 € | 454 € | 639 € | 1 105 € | 1 144 € |
| Airbnb | 15,5 % | 284 € | 341 € | 367 € | 430 € | 605 € | 1 046 € | 1 083 € |
| Booking | 15 % | 282 € | 339 € | 365 € | 427 € | 602 € | 1 040 € | 1 077 € |
| Greengo | 14,5 % | 280 € | 337 € | 363 € | 425 € | 598 € | 1 034 € | 1 070 € |
| Gîtes de France | **10 %** | 266 € | 320 € | 345 € | 404 € | 568 € | 982 € | 1 017 € |
| **Direct / Lodgify** | 5 % | **252 €** | **303 €** | **326 €** | **382 €** | **538 €** | **930 €** | **963 €** |

\* The Noël and Nouvel An nights are billed **flat**: the length discount does not apply to them.
The Gîtes de France row now uses the **10 %** the contracts show (see Q2), not the 0 % still stored
in `platforms` — that setting has yet to be corrected in the app.

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
| 14 of the 24 stays | | | | **identical to the cent** |
| 01/01/2026 | 2 | 504,00 € | 685,00 € | +181,00 € — New Year's Day joins the year-end block, and the 1ᵉʳ janvier « pont » raises the two nights after it |
| 03/04/2026 | 3 | 676,20 € | 759,40 € | +83,20 € — April in low season from the 1st, plus the Easter block |
| 01/05/2026 | 2 | 652,00 € | 764,00 € | +112,00 € — Fête du Travail, one rank up |
| 08/05/2026 | 2 | 652,00 € | 764,00 € | +112,00 € — Victoire 1945, one rank up |
| 13/05/2026 | 4 | 912,80 € | 1 013,60 € | +100,80 € — Ascension |
| 21/05/2026 | 4 | 912,80 € | 957,60 € | +44,80 € — Pentecôte |
| 17/07/2026 | 2 | 1 074,50 € | 1 076,00 € | +1,50 € — the 537,50 → 538 rounding |
| 19/07/2026 | 7 | 1 794,75 € | 2 152,00 € | +357,25 € — Très haute repaired |
| 01/08/2026 | 14 | 3 595,36 € | 4 304,01 € | +708,65 € — Très haute repaired |
| 17/08/2026 | 7 | 1 896,10 € | 2 027,20 € | +131,10 € — Très haute repaired |
| **Total** | | **22 349,31 €** | **24 293,61 €** | **+1 944,30 € (+8,7 %)** |

Four causes, and only four: **+1 197 €** the repair of one broken season, **+452,80 €** the holiday
bridges the owner asked for on 2026-08-25, **+182,50 €** four calendar days and half a euro, and
**+112 €** L'Ardéchoise. Nothing else in the recipe raises a price.

**No 2026 stay touches the festive peaks.** Nothing is booked on 24, 25 or 31 December, so the two
new seasons do not appear in this table at all — which is also why they had to be calibrated against
the owner's own channel statements rather than against anything the planning could show.

## 5. Arbitrations the recipe could not take alone

### Q1 — Public-holiday long weekends — **answered 2026-08-25: yes, capped at Haute**

The Lodge raises every « pont » one rank and imposes the block's own length as a minimum stay. The
Gîte's May long weekends visibly sell above the base rate (1–3 May 2026 at 687 €, 8–10 May at 733 €
on Gîtes de France, against a 652 € mid-season 2-night rate), so the rule belongs here.

It could not be turned on as the engine stood: `public_holiday_bridge` capped the raise at the
*highest* rank, and the Gîte's highest rank is a peak price. The modifier gained an optional
`capSeason`, defaulting to the old behaviour so the Lodge is untouched.

**The trap, found by simulating it before writing it:** the obvious
`Math.min(capRank, currentRank + amount)` does not merely stop a raise, it **lowers** every night
already above the cap — 14 juillet and 15 août sit in Très haute, and the naive cap would demote
them for 624 € over 2026 alone. The night's own rank has to be a floor:
`Math.max(currentRank, Math.min(capRank, currentRank + amount))`.

**What it does**, on the shipped recipe with `capSeason: "high"`:

| Year | Nights raised | Blocks | Extra date ranges on the tariff page |
|---|---|---|---|
| 2026 | 13 | 6 | +13 |
| 2027 | 14 | 8 | +12 |
| 2028 | 12 | 6 | +17 |

2027 in detail: 2 janvier · 27–28 mars (Pâques) · 1er mai · 6–8 mai (Ascension, absorbing Victoire)
· 15–16 mai (Pentecôte) · 30–31 octobre (Toussaint) · 11–13 novembre. 14 juillet and 15 août keep
their Très haute price and gain only the block's minimum stay.

**On the 24 stays already on the books for 2026: +452,80 €** (+1,9 %) across 6 of them.

### Q1bis — The festive peaks — **answered 2026-08-28: two flat nights, calibrated on the takings**

Settled in two passes on the same day. The first put the réveillon at 750 € over three nights
(30, 31 December and 1 January). The owner then reframed the whole thing, and the second shape is the
one that shipped:

> « ce que je veux pour Noël et le 31, c'est que **seulement ces nuits** soient à un tarif fort […]
> c'est la nuit du 31 qui prend toute la plus-value avec 20 % de plus que l'année dernière, par contre
> le 30 et le 1 doivent être en tarif haute saison. Pour Noël c'est le même principe, c'est le 24 et
> le 25 qui prennent toute l'augmentation, le 23 et 26 sont en tarif haute saison. Entre le 27 et le
> 30 on doit être en moyenne saison. »

The premium is **concentrated, not spread**. The festive block is now a shape rather than a slab:

| Nights | Season | Rate |
|---|---|---:|
| 19 → 23 December | Haute | 382 € |
| **24 – 25 December** | **Noël** | **930 €**, flat |
| 26 December | Haute | 382 € |
| 27 – 29 December | Moyenne | 326 € |
| 30 December | Haute | 382 € |
| **31 December** | **Nouvel An** | **963 €**, flat |
| 1 January | Haute | 382 € |

**The rates are not chosen, they are solved for.** The instruction was « compare avec ce que j'ai
gagné l'année dernière pour définir le tarif augmenté de la plus-value » — target the 2025 takings
plus 20 %, and load the whole increase onto the premium nights.

*Réveillon.* The 2025 stay (31/12 → 03/01) earned **1 222 €**; +20 % is 1 466,40 €. Under the new
shape the other two nights are fixed by the grid — 1 January in Haute as night 2 (382 €), 2 January
in Basse as night 3 (121,20 €, the night having been raised by the New Year bridge) — which leaves
**963,20 €** for the night of the 31st. It ships at **963 €**: a whole euro is mandatory, because
`ceil(net ÷ 0,95)` must reproduce the displayed price or the direct row of the channel grid stops
reproducing itself ([tariff-recipes](../tariff-recipes/spec.md), trap 3). The reference stay then
prices at 1 466,20 € — **+19,98 %**, twenty cents short of the instruction, against a grid that stays
invertible.

*Noël.* The 2025 Christmas earned **1 550 €** over two nights; +20 % is 1 860 €, and the two nights
carry the same flat rate, so **930 €** each. The reference prices at exactly 1 860,00 €.

**An assumption that has to be checked**: that the two nights sold in 2025 were the 24th and the 25th.
The owner said « 2 jours à 1 550 € » without naming them. If they were other nights, the calibration
moves.

Both seasons are `pricingMode: "fixed"`. A length discount on the four scarcest nights of the year
would give back exactly the premium they exist to collect.

**What this shape fixed.** The previous one — the réveillon spread over 30 December to 1 January —
charged 750 € to a guest *arriving* on 1 January, who has missed the party. That stay (01/01 → 03/01,
the only one on the books) went from 504 € to 1 053 €. With the peak reduced to the night of the 31st
it is back to 685 €, and the anomaly is gone.

### Q1ter — Christmas week itself — **answered 2026-08-28: only the 24th and 25th move**

The earlier answer — « Christmas stays in Haute at 382 € » — was superseded the same day by the
instruction above. 19 → 23 and 26 December do stay in Haute; 27 → 29 drops to Moyenne; only the two
Christmas nights carry the increase. The 775 €/night the Gîte obtained in 2025 is no longer a
contradiction sitting next to a 382 € season: it is the number the 930 € was solved from.

### Q2 — The Gîtes de France commission — **answered 2026-08-28: 10 % of the rental, confirmed twice**

See §3. Until the contractual rate is entered, the channel grid cannot be derived for the majority of
the Gîte's bookings, and the Gîte's accounting attributes 0 € of commission to them. This is not part
of the recipe (commissions are global per platform) but it gates the rollout.

On 2026-08-28 the owner produced contract n° 13164, which reconciles exactly on one reading:

```
rental                     840 €
options (ménage 80 + 5 × linge toilette 8)   120 €
tourist tax                 20 €     collected and remitted by the centrale
--------------------------------------------------
owner net                  876 €  =  840 × 0,90 + 120
client total             1 028 €  =  840 + 120 + 20 + 48 frais de dossier
```

So: **10 % on the rental, nothing on the options, the tourist tax passed through, and a 48 € booking
fee charged to the guest on top** — which the centrale keeps and which never touches the owner's net.

A second document settled it — payment statement n° 7092-2026, reservation 771, 17 → 23 August 2026:

```
rental                   1 628 €
options                     80 €
commission             − 135,83 € HT
VAT on it               − 27,17 €   (20 %)
--------------------------------------------------
paid to owner            1 545 €    = 1 628 + 80 − 163
```

163 € on a rental of 1 628 € is **10,01 %** — that is 10 % (162,80 €) rounded to the euro, and the
HT/VAT split follows from it: 163 ÷ 1,20 = 135,83. Two independent documents, two different years,
the same rule:

> **Gîtes de France takes 10 % of the RENTAL, VAT included, rounded to the euro. Options are paid to
> the owner in full. The tourist tax is collected and remitted by the centrale. The guest pays a
> booking fee on top, which never touches the owner's net.**

The channel grid in §3 now uses 10 %. Two things still need doing in the app, and neither is part of
the recipe:

1. `platforms.GitesDeFrance.commissionPercent` is still **0**. It has to become 10 — the owner's
   call, in Réglages.
2. GuestFlow applies a commission percentage to the whole gross, whereas Gîtes de France exempts the
   options. On a stay with 80 € of cleaning that overstates the commission by 8 €. Worth a look, but
   it does not change a single price in the recipe.

The figures GuestFlow has stored for the 2026 bookings — 7,75 % to 20,41 % of the rental — reproduce
neither document. They were entered by hand and are wrong. One of them is provably so: statement
n° 7092-2026 gives 17 → 23 August at 1 628 €, where GuestFlow has 17 → 24 August at 1 983,92 €.

### Q3 — Whole-house price, or base + extra guest? — **answered 2026-08-25: whole house, unchanged**

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

The owner chose the first: the house fills anyway, and the supplements stay outside the rate.

### Q4 — The 8th night costs more than the 7th — **answered 2026-08-25: kept**

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
