---
name: platform-tariff-rollout
description: Roll a GuestFlow tariff recipe out to the booking platforms (Lodgify, Abracadaroom/UnicStay, GreenGo) and prove the result with comparable guest-side quotes and a self-contained verification page. Use when prices, degressivity, extra-guest rules, seasons, closures or listing titles change and the channels must follow, or when an operator asks what a platform is actually charging.
---

# Rolling a tariff recipe out to the platforms

The recipe (`server/src/recipes/*.json`) is what GuestFlow bills. The platforms are separate systems
that must be made to agree with it. This skill is the operator-side counterpart of `tariff-recipe`:
it never edits the recipe, it makes the outside world match it.

**The deliverable is not "I clicked the buttons" — it is a verification page an operator can audit.**
A configuration you have not re-read from the guest's side is a claim, not a result.

Read `references/platforms.md` for the per-platform maps, quote URLs and traps. It is the part that
makes a second run fast; do not re-derive it by clicking around.

## The loop

1. **Derive the target grid from the recipe with the repo's own code.** Never hand-compute.
   ```bash
   cd server && node -e '
     const {validateRecipe}=require("./src/utils/tariffRecipe");
     const {grossFromNet}=require("./src/utils/pricing");
     const r=validateRecipe(JSON.parse(require("fs").readFileSync("src/recipes/<id>.json","utf8"))).recipe;
     for (const s of r.seasons) console.log(s.label, s.pricePerNight, "net", s.netTargetPerNight);
   '
   ```
   Read the real commissions from the `platforms` table — a spec table may have drifted.
2. **Settle the ambiguities with the operator first** (`AskUserQuestion`), before touching anything.
   The ones that always come up are listed in "Decisions to put to the operator" below.
3. **Read each platform's existing configuration in full and write it down.** Half of what you find
   contradicts the recipe, and some of it is a live bug costing money today.
4. **Configure**, cheapest-blast-radius first: base price → per-channel markup → occupancy →
   discounts → fees/extras → taxes → seasons → availability → listing title.
5. **Prove it with the SAME quotes on the SAME dates on every platform** (§ "Proving it").
   Comparable rows are the whole value of the report; per-platform ad-hoc dates are not.
6. **Publish the verification page** (§ "The verification page").
7. **Record new platform quirks** in `references/platforms.md` and a memory note.

## The safety protocol — never touch the other property

Every one of these systems hosts the Gîte alongside the Lodge, and a mis-scoped write is the worst
outcome of the whole job. Non-negotiable:

- **Before every save**: re-read the scope controls and assert the other property is excluded.
  On Abracadaroom that means `Appliquer à tous les hébergements = OFF`, Gîte unchecked, Lodge checked.
- **After every save**: re-read the other property's prices and rules and diff them against a
  reference captured before the change.
- **Normalise whitespace before diffing.** These UIs use narrow no-break spaces around `€`; a naive
  string compare reports a false mismatch and will make you chase a ghost.
- Two incidents this protocol caught: a stray click flipped "apply to all properties" ON, and a
  leftover default period would have blocked today and tomorrow.

## Decisions to put to the operator

- **What wins when a platform cannot express the grid** — the net target, or the displayed price.
  (Answered 2026-08-13: **the net target always wins**; round up rather than undershoot.)
- **Internal costs** such as the welcome pack: financed by the displayed price but never shown.
  (Answered: keep the direct price unchanged, never display the pack anywhere.)
- **Which channels are real.** Gîtes de France was in the spec and does not exist.
- **All-inclusive means the fees must actually be removed**, on every platform, in every guise:
  mandatory fee, optional extra, and "compulsory supplement". Missing one costs the guest real money
  and makes the quote unreadable — GreenGo was still adding 46 € after the rest was correct.
- **Listing titles** are a separate, high-leverage change; see "Titles" below.

## Proving it — quote by URL, never by booking

Opening a quote URL creates nothing. Use the **same two cases on every platform**, e.g. a 3-night
high-season stay and a 2-night mid-season stay, both for 2 adults, plus one case with extra guests.

| Platform | Quote URL |
|---|---|
| Lodgify | `https://checkout.lodgify.com/fr/<slug>/<rentalId>/reservation?currency=EUR&arrival=YYYY-MM-DD&departure=YYYY-MM-DD&adults=N` |
| GreenGo | `https://www.greengo.voyage/hote/<listing-slug>?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&numberOfAdults=N&numberOfChildren=0&numberOfBabies=0&numberOfPets=0&selectedAccommodationProductSlug=<logement-slug>` |
| Abracadaroom | no URL params — drive the widget (see `references/platforms.md`) |

Reading the summary: take the **last** visible node matching the platform's total; these pages ship
a hidden mobile duplicate with zero size, so filter on `getBoundingClientRect().width`. A `0,00 €`
total means the dates are unavailable, **not** that pricing is broken. Three causes, in the order
they are worth checking: the **booking window** (a per-channel cap on how far ahead guests may book
— 180 days by default on Lodgify, which silently hides an entire future season), an iCal block, or a
real booking.

**Always quote a stay in each configured year, not just the near one.** A next-year season can be
perfectly declared and still be unsellable, or be overridden by a stale hand-typed price. Both
happened here, and neither was visible from the season screens. The strongest single check is that
**the same stay one year apart returns the same total to the cent** — if it does, nothing drifted
while the grid was copied forward.

**Recompute every total from the rules and compare to the cent**, then also compute the net after
commission and check it clears the recipe's net target. Anything you cannot reproduce is a finding.

## The test matrix — run all of it, or the report comes back incomplete

Two rollouts in a row shipped a report that had to be reopened, because coverage was decided case by
case instead of from a list. Take the whole list, every time.

**Per channel — and that means the OTAs too**, not just the consoles you configured. Airbnb, Booking
and Vrbo are quoted on their *public* pages like a guest would; a channel manager pushing prices is
not evidence that the guest sees them.

| # | Case | Why it exists |
|---|---|---|
| 1 | One stay per **season** — low, mid, high | A grid proven only in high season is a grid proven for two weeks of the year. |
| 2 | The **two comparable cases**, same dates on every channel | The only way to read channels against each other. |
| 3 | **One night**, single, in high season | Isolates the season price from the discount — and is how you prove a channel ignores degressivity (n nights = n × 1 night). |
| 4 | Every **event week** (l'Ardéchoise…), plus the **day after it ends** | Events are painted by rank; the boundary is where the carving breaks. |
| 5 | A stay with **extra guests** | The supplement is folded into the nightly rate, so it only surfaces here. |
| 6 | A date **inside a closure** | Expected: no price at all. Proves the closure reaches the channel. |
| 7 | A date in **each configured year** | A next-year season can be perfectly declared and still unsellable — see the booking-window trap. |

**Read the listing while you are on the page**, since you are already there and a second visit costs
another login: the title actually displayed, any lingering mention of a fee the rate now includes
(linen, towels, cleaning), and the check-in / check-out times.

**Content does not travel with the prices.** Lodgify pushes rates and availability to Airbnb, Booking
and Vrbo, but the *editorial* — title, description — stays on each platform: the 2026 title change
reached Booking and never reached Airbnb. Verify the title on each public page, and expect to edit
the text in each platform's own back office.

**Record what each quote is worth before moving on**: the accommodation subtotal (excluding the
platform's taxes and fees), the net after that channel's commission, and the recipe's target. A total
alone cannot be compared across channels that collect different taxes.

## The verification page

`build-verification-page.mjs` turns a list of cases plus screenshots into one self-contained HTML
file (fonts and images inlined, no network at render time); publish it with the `Artifact` tool.

```bash
node .claude/skills/platform-tariff-rollout/build-verification-page.mjs cases.json ./shots out.html
```

`cases.json` declares only the **inputs** — season price, extra guests, nights, discount, and the
total actually observed. Everything else is derived, and a case whose computation disagrees with the
observation is flagged red with exit code 2. **Never write a computed figure into `cases.json`.**
The page must be able to contradict you.

Structure the page as a **comparable matrix**: one section per case (dates + occupancy), three
platform cards side by side, then the net-after-commission line that shows they converge. That is
what an operator actually wants to audit.

Screenshots: capture the summary element alone. Tag it with an id via `browser_evaluate`, then
`browser_take_screenshot` with `target: '#id'` and **no `filename`** — a custom filename lands
outside the reachable output directory, whereas the auto-named file appears in `.playwright-mcp/`
and can be copied to the operator's Desktop. Never leave deliverables in a session scratchpad: the
operator cannot open those paths.

Design: honour `specs/design-system.md` — vert sapin `#2F5D46`, papier `#F8F5EF`, encre `#27251F`,
Source Serif 4 for headings, Inter for body, **amounts never in serif**, always `tabular-nums`,
both themes. The faces are self-hosted in `client/node_modules/@fontsource/`; inline them as data
URIs, never link a CDN (the artifact CSP blocks it).

## Titles

Airbnb truncates at **50 characters** and Lodgify propagates there, so the Lodgify title must fit in
50; GreenGo allows 100 and Abracadaroom is generous, so they can carry a longer version.

Research the competitors before proposing: in this market they all lead with the shelter type
("Tente lotus", "Safari-lodge"), which files them under camping, and several advertise being *chez
l'habitant*. Leading with what the place is **not** (a campsite) and with a number nobody else
claims (13 ha) is the open flank.

**Check the house rules before writing a title.** "Animaux" alone reads as *pets welcome*; if the
listing is `animaux non acceptés`, name the animals instead ("ânes et chèvres").

## When the interface resists

Some components cannot be driven: zero-size inputs, custom widgets that ignore synthetic events,
calendars whose cells are overlay divs. **Do not force it.** Navigate to the exact screen, leave the
selection ready, and tell the operator precisely what to type — then take back over to verify.
See [[rendre-la-main-si-ca-resiste]]. Forcing a production pricing system is how money gets lost.

Before giving up, try in this order: the real `browser_click` on the visible wrapper (not the label),
`browser_select_option` on a hidden `<select>` (this works even when the select is visually replaced),
and URL parameters — several of these apps put the whole state in the query string, which is by far
the fastest path once discovered.

**Two components previously written off as unautomatable turned out to yield to that list**, so run
it before handing back. GreenGo's per-period price has no `<input>` in the DOM at all until a *real*
click materialises it — a JS `.click()` produces nothing, which is what made it look impossible. And
its date range, which resists every widget interaction, is simply `?startDate=…&endDate=…`: clicking
a day once and reading the URL is how you find that out. **When a component resists, click something
harmless and look at what the URL becomes.**
