# Architecture — recurring events + tiered extra-guest price

Companion to [`spec.md`](./spec.md). Where the code goes and why there rather than elsewhere.

---

## 1. The two changes are independent

They ship together because they arrived together, but they touch disjoint code:

- The **tiers** live in the pricing engine (`utils/pricing.js`), on the money path.
- The **events** live in the calendar derivation (`utils/seasonPlan.js`), on the date path.

Only the recipe file and its validator see both. Nothing forces them into the same commit beyond
convenience, and either can be reverted without the other.

## 2. Extra-guest tiers

### 2.1 Where the arithmetic goes

`computeExtraGuestSurcharge` already walks the nightly breakdown to apply the season ratio. The tier
model walks the same loop with a different price source, so it is one branch, not a second function:

```
for each night (index i, 1-based):
  price = tiers ? tierPrice(tiers, i) : seasonUnit × ratio(night)
  total += count × price
```

`tierPrice` is the only genuinely new logic, and it is a pure function of `(tiers, i)`. It goes in
**`utils/extraGuestTiers.js`** rather than inline: it needs carry-forward semantics and a handful of
edge cases (empty list, first tier not starting at 1, unordered input), all of which deserve their own
tests with no database in sight. `normalizeProgressiveTiers` in `pricing.js` is the precedent — same
shape of problem, and the two will read alike.

### 2.2 Why the ratio must not compose

The season ratio exists so a supplement declared as « 27 €/night » shrinks along with the night it
attaches to. A tier table already encodes that shrinkage explicitly. Composing them would apply the
discount twice, and the second application is invisible in the recipe — the reader sees 8 € and is
billed 4,16 €.

The loader therefore **rejects** the combination rather than resolving it. A validation error at load
is loud and once; a silently halved supplement is quiet and forever.

### 2.3 Persistence

A range needs to carry its tiers for the same reason it carries `progressiveTiers`: the quote reads
`pricing_rules`, not the recipe. One nullable TEXT column, JSON, `NULL` meaning « the single price
applies ». `NULL` is the value every existing row already has, which is what makes the migration a
no-op for every property but this one.

### 2.4 What deliberately does not change

`per_stay` returns before the loop and never sees a tier. Single-price `per_night` keeps its exact
expression. `pricing-baseline`, written before the parent spec's first line of code, is the contract:
if it moves, the change is wrong.

## 3. Events

### 3.1 Where in the pipeline

`buildYearPlan` paints a day array in four steps: base → periods → holiday raise → runs to ranges.
The event layer is **step 3bis**, between the holiday raise and the run detection:

```
1. base season on every day
2. periods repaint their spans          (anchored, derivable)
3. public holidays raise one rank       (derivable)
3bis. events repaint their nights       (declared)      ← new
4. contiguous runs → date ranges
```

Position matters and is the feature. Painting events **after** the holiday raise is what lets « 1
night allowed » beat a bridge's 3-night minimum — the only place in the model where a minimum stay
goes down. Painting them before would let the holiday rule overwrite the very week the owner wants
controlled.

It also keeps `buildYearPlan` pure and clock-free: an event is data in the recipe, resolved by year
key, so the same recipe and the same year always produce the same plan.

### 3.2 Why declared dates rather than an anchor

The existing anchors (`nth_weekday_of_month`, `last_full_week_of_month`, `between`) all express a
rule the calendar guarantees. L'Ardéchoise has no such guarantee: three consecutive editions ended on
the 2nd Saturday of June, and one organiser's decision breaks it. A fourth anchor type would encode a
coincidence as a law and mis-price a full week, silently, the year it fails.

Declared dates make the failure mode « I do not know 2028 » — detectable, reportable, and fixable by
one person in one minute — instead of « I confidently priced 2028 wrong ».

### 3.3 Reporting the gaps

`missingEventYears(recipe, fromYear, toYear)` is a pure derivation over the recipe: every event ×
every year in the horizon that has no `dates` entry. It has no state of its own, so the tariff card,
the recipe endpoint and the Dashboard alert all read the same answer and cannot disagree.

## 4. Client

Nothing computes. The card renders sentences the server hands it; the missing-year warning is a
server-computed list. Consistent with the parent spec: the particularities panel is a rendering of
recipe facts, never a re-derivation of them.

The calendar's event outline is a border on the existing day cell, not a new layer — the page already
greys closures and colours seasons, and a third visual channel would be one too many.

## 5. Risk

| Risk | Mitigation |
|---|---|
| The tiers change real prices | Intended, quantified in spec §3.1, and confined to properties whose recipe declares tiers. Locked snapshots protect sold stays. |
| The event lowers a holiday minimum | Intended and explicit (rule 10). Tested against a holiday block on purpose. |
| A wrong year key in the recipe | Validator checks the key matches the dates it declares. |
| A gap goes unnoticed | Rules 16-17: property card + Dashboard. |
| The tier column is read by an old server | Additive and nullable; an older server ignores it and prices as today. |
