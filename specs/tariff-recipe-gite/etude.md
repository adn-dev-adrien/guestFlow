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

## 2ter. What the owner's own spreadsheet says — and what it breaks

`Suivie client Gite.xlsx` (the sheet that ran the Gîte before GuestFlow) was opened on 2026-08-28.
Two things came out of it, one small and one that undermines the pivot.

**The small one.** The Gîtes-de-France statements write a stay as *first night → last night*, not
arrival → departure: « 17/08/2026-23/08/2026 » is the seven-night stay GuestFlow records as
17 → 24 August. An earlier note in this study called one of them wrong; neither is.

**The large one.** The sheet prices in **two columns** — `Gite de France` and `Plateforme plus 20%`:

| | Gîtes de France | Plateforme +20 % |
|---|---:|---:|
| Basse | 252 € | 300 € |
| Moyenne | 303,50 € | 370 € |
| Haute | 381,50 € | 460 € |
| Très haute | 537,50 € | 650 € |

The prices sitting in GuestFlow — 252 / 303 / 326 / 382 / 537,50 — are the **left column**. The whole
recipe was pivoted off them on the instruction « pars sur le tarif qui est dans GuestFlow, c'est celui
de Lodgify » (2026-08-24). The owner's correction on 2026-08-28: « ils ne sont pas à jour, concentre-toi
sur la colonne montant du paiement ».

Measured against what he was actually **paid**, per stay, with the length discount neutralised:

| Channel | Stays | Actually paid | What the recipe would pay | |
|---|---:|---:|---:|---:|
| Gîtes de France | 15 | 15 539 € | 17 207 € | **+10,7 %** |
| Platforms | 4 | 2 885 € | 2 056 € | **−28,8 %** |
| Direct | 1 | 1 060 € | 691 € | **−34,8 %** |

And per season, in net per full-price night:

| Season | Net achieved on GdF | Net achieved direct / platform | Recipe's current target |
|---|---:|---:|---:|
| Très basse | 288 € | **407 €** | 239 € |
| Basse | 297 € | **442 €** | 288 € |
| Moyenne | 328 € | 222 €¹ | 310 € |
| Haute | 343 € | — | 363 € |
| Très haute | 416 € | — | 511 € |

¹ one stay, the one annotated « gens de la ville, pas très agréable ».

**The recipe prices every channel at the Gîtes-de-France level.** On the channels where the Gîte
actually sells 30 % dearer it would cut the takings. This is precisely the defect a net pivot exists
to remove — the same dates fetching different nets by channel is not a pricing model, it is an
accident — but the pivot has to be anchored on the net the owner intends to receive, and that number
is still to be chosen. **Open, and blocking the channel grid** (§5 Q7).

The sample is thin: one to three stays per cell, and only in winter is there both a GdF and a platform
observation. It is enough to prove the structural error, not enough to fix each season by itself.

## 3. The net pivot — rebuilt on what Gîtes de France actually pays

The first version took GuestFlow's prices as the displayed rate and derived the net from them. §2ter
showed those prices to be the Gîtes-de-France column of a spreadsheet the owner had stopped
maintaining. Rebuilt on 2026-08-28 to his instruction:

> « il faut laisser Gîte de France inchangé. Donc tu calcules ce que je gagne avec Gîte de France et
> ça devient la référence. Mais attention je ne veux jamais descendre en dessous de ce montant pour
> toutes les saisons. Et comme pour la Lodge, je veux qu'on fasse en sorte que le prix de vente sur
> les plateformes soit assez proche les uns des autres (à 10 % près). […] En direct ce sera toujours
> le prix le plus faible pour le client, mais je dois quand même être proche du prix plateforme. »
> — and, a moment later: « en direct je veux que tu me place au prix le plus bas des plateformes ».

**The reference is measured, not declared.** Fifteen Gîtes-de-France stays, priced by least squares
against the recipe's own degressivity curve — five unknowns, fifteen equations, residual 48,84 € on
stays of 569 to 3 304 €:

| Season | Net fitted on the GdF stays | Net the first version targeted |
|---|---:|---:|
| Très basse | **288 €** | 239 € |
| Basse | 286 € | 288 € |
| Moyenne | **302 €** | 310 € |
| Haute | **341 €** | 363 € |
| Très haute | **413 €** | 511 € |

Basse and Très basse came out **statistically indistinguishable** — 286 € against 288 €, for a season
covering April alone. That answers Q5 by measurement rather than by taste: the two are merged, and
the Gîte drops from five ordinary seasons to four.

**`netTargetPerNight` is a floor, not a target.** It is what the owner receives on any channel and
never less. Each platform is grossed up from it; the direct channel is grossed up from it **plus a
16 € uplift**, carried by the recipe's `welcomePack.cost` — which the grid applies to the direct row
alone (`fixedCost: p.isDirect ? welcomePackCost : 0`). That is what places the direct price level with
the cheapest channel while the owner still pays only 5 %:

```
plateforme = ceil(plancher ÷ (1 − commission))
direct     = ceil((plancher + 16) ÷ 0,95)          ← et c'est `pricePerNight`
```

The identity `direct = ceil((net + 16) ÷ 0,95)` is asserted per season in the test suite, along with
`direct ≤ the cheapest platform`. Break either and the grid's direct row stops reproducing what the
engine bills — trap 15 of the recipe skill, paid for once on the Lodge.

| Channel | Commission | Très basse | Moyenne | Haute | Très haute | Nouvel An | Noël |
|---|---|---:|---:|---:|---:|---:|---:|
| Abracadaroom | 20 % | 360 € | 378 € | 427 € | 517 € | 1 054 € | 1 135 € |
| Airbnb | 15,5 % | 341 € | 358 € | 404 € | 489 € | 998 € | 1 075 € |
| Booking | 15 % | 339 € | 356 € | 402 € | 486 € | 992 € | 1 069 € |
| GreenGo | 14,5 % | 337 € | 354 € | 399 € | 484 € | 986 € | 1 062 € |
| Gîtes de France | 10 % | 320 € | 336 € | 379 € | 459 € | 937 € | 1 009 € |
| **Direct** | 5 % | **320 €** | **335 €** | **376 €** | **452 €** | **905 €** | **973 €** |
| _floor (net)_ | | _288 €_ | _302 €_ | _341 €_ | _413 €_ | _843 €_ | _908 €_ |
| _net on a direct sale_ | | _304 €_ | _318,25 €_ | _357,20 €_ | _429,40 €_ | _859,75 €_ | _924,35 €_ |

Gîtes de France comes out at 320 / 336 / 379 / 459 €, which is what it charges today — the constraint
that anchored everything. Direct sits at or just below it (0 to 7 € under), so it is never the dearer
option, and it yields the owner 16 € a night more than the floor.

**Two things the ten-per-cent rule does not cover.** Abracadaroom at 20 % stretches the band to
12,5 % in Très basse and 14,4 % in Très haute; the owner accepted that on 2026-08-28 rather than drop
the channel, though the Gîte has never sold a night through it. And on the festive seasons the fixed
16 € is a smaller relative uplift, so the band widens to 16,7 % on Noël — arithmetic, not a choice.

**Abritel is missing from `platforms`.** It is where Christmas and the réveillon were sold, and its
two statements give 9,66 % and 9,69 %. Added at 9,7 % it would become the cheapest channel, one euro
under Gîtes de France, and the direct price would want to follow it down.

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
| **Total** | | **22 349,31 €** | **23 507,23 €** | **+1 157,92 € (+5,2 %)** |

**Every one of the 24 stays moves now**, because the whole grid moved: the table above compares the
old prices with the new DIRECT price. The shape of the change is the point — winter up, summer down:

| | Old | New (direct) | |
|---|---:|---:|---:|
| A February weekend, 2 nights | 504 € | 640 € | **+27 %** |
| Mid-July, 2 nights | 1 074,50 € | 904 € | **−16 %** |
| Late August, 7 nights | 1 896,10 € | 1 747,20 € | **−8 %** |

That is exactly what the measurement demanded: the old grid charged 252 € a night in winter, when
the owner's own takings show him netting 288 € on Gîtes de France and 407 € on the platforms; and it
charged 537,50 € at the summer peak, when Gîtes de France netted him 413 €.

**No 2026 stay touches the festive peaks.** Nothing is booked on 24, 25 or 31 December, so the two
new seasons do not appear in this table at all — which is also why they had to be calibrated against
the owner's own statements rather than against anything the planning could show.

## 4bis. What the Lodge's rollout already taught us about discounts

The Gîte has not been pushed to any channel yet, but the Lodge was, on 13-14 August 2026, and its
[difficulties are on record](../../.claude/skills/platform-tariff-rollout/references/platforms.md).
Four of them bear on length discounts. Checked against the Gîte's curve before anything is configured:

| | The Lodge | The Gîte |
|---|---|---|
| Discount past the last declared night | A flat rate would have made night 8 dearer than night 7 — the table had to stop at 7 and let the carry-forward extend it | **Constant from 7 nights on** (42,86 %), so **one promotion covers 7 nights to infinity** |
| First discounted night | 2 nights, −24 % | **3 nights** — two nights are full price |
| Booking ignoring every discount | Cost the whole degressivity on that channel | **Costs the Gîte more, not less** — see below |
| Discount vs the guest supplement | Applied on Lodgify, not on Abracadaroom — a per-channel difference to model | **Moot**: the Gîte sells the whole house |

### Booking — the cause, found

The first version of this section called the Booking problem inert, because both Booking stays on the
books are two nights and two nights carry no discount. **That reasoning was backwards**, and the
owner said so: two nights is all Booking sells *because* it is the only length it prices correctly.

**The cause is a layer error, not a bad setting.** A promotion — pushed by Lodgify or created in the
extranet as a « Basic Deal » — sits *above* the rate. On a property whose rates arrive from a
connectivity provider, Booking does not consult that layer: promotions reach such a property only
through a provider that has integrated the **Promotions API**, which Lodgify has not for this deal
type. Six tiers created on 14 August, still shown « Activée(s) » on 17 August, changed no price —
and could not have.

**What Booking does honour is a derived rate plan**, and its own documentation says so plainly: the
channel manager updates the standard rate, and *« your derived rates will get updated from your base
rate »*. Five rate plans already show on the Lodge's listing, which is the proof the mechanism runs
on this account.

| Plan | Derived from the standard | Minimum stay |
|---|---|---|
| Standard, pushed by Lodgify | — | 2 nights |
| 3 nuits et + | −20 % | 3 |
| 4 nuits et + | −30 % | 4 |
| 5 nuits et + | −36 % | 5 |
| 6 nuits et + | −40 % | 6 |
| 7 nuits et + | −42,86 % | 7 |

They self-select like Lodgify's promotions: the guest sees every plan whose minimum their stay meets,
and Booking shows the cheapest. **Only a Booking account manager can create them** — a request to
make, not a screen to find.

**What it costs today**, Moyenne season at 356 € the night:

| Nights | Quoted | Should be | Too dear by |
|---:|---:|---:|---:|
| 2 | 712 € | 712 € | — |
| 3 | 1 068 € | 854,40 € | **25 %** |
| 5 | 1 780 € | 1 139,20 € | **56 %** |
| 7 | 2 492 € | 1 424 € | **75 %** |
| 14 | 4 984 € | 2 848 € | **75 %** |

Nine of the fifteen Gîtes-de-France stays run three nights or more. That is the demand Booking
cannot currently quote — and the same hole is open on the Lodge.

**The other route.** Booking also supports **LOS pricing**, where the provider sends an explicit total
for every length up to 90 nights. It reproduces the curve exactly, but there is no default per-night
price and *any length not declared becomes unbookable* — and it depends on Lodgify supporting the
model, which is unverified. Derived rate plans first.

**The one channel trap that also applies.** GreenGo carries length reductions in *two* places — the Tarification page
and the calendar's « ensembles de règles » — and **they stack**. Fill one, never both.

**And one number to get right.** A whole-number discount is not neutral. On a seven-night stay in
Très basse the target is 1 280 €: −42,86 % gives 1 279,94 €, −42 % gives 1 299,20 €, and **−43 %
gives 1 276,80 € — 3,20 € under the net floor**, which the pivot forbids. Where a channel takes two
decimals, 42,86 %; where it takes an integer, 42 %, never 43 %.

---

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

Both bases were corrected on 2026-08-28 once the owner's own records were opened (§2ter). Neither
headline figure was pure rental.

*Réveillon.* Abritel billed **1 222 € tourist tax included** (owner, 2026-08-28): 7 adults × 3 nights
× 1 € = 21 €, so **1 201 €** of rental. +20 % is 1 441,20 €. The other two nights are fixed by the
grid — 1 January in Haute as night 2 (382 €), 2 January in Basse as night 3 (121,20 €, raised by the
New Year bridge) — which leaves exactly **938 €** for the night of the 31st, and the reference stay
lands on **+20,00 %** to the cent.

*Noël.* The contract says « **1550 € hors option, dont taxe de séjour 1 €/jour/adulte soit 16 € et
supplément chien** », and the general conditions price the dog at 20 €. Rental: **1 514 €** over two
nights. +20 % is 1 816,80 €, both nights flat, so 908,40 € — shipped at **908 €**, a whole euro being
mandatory for `ceil(net ÷ 0,95)` to reproduce the displayed price ([tariff-recipes](../tariff-recipes/spec.md),
trap 3). The reference prices at 1 816 €, eighty cents short.

**The Christmas dates are no longer an assumption.** The CAGGIU contract reads « Date de séjour du
mercredi 24/12 à 15h au jeudi 26/12/25 à 11h, soit 2 nuits » — the 24th and the 25th, as supposed.

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
