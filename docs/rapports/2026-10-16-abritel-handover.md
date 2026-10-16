# Abritel / Vrbo switch-over — session handover

**Written 2026-10-16, ~07:40.** State of the world measured, not remembered. Hand this file to a
fresh session together with [`specs/lodgify-decommission.md`](../../specs/lodgify-decommission.md),
which stays the source of truth for *why*. This document only says **where we are** and **what is
left**, and it corrects three things the spec and the session memory currently get wrong.

Read §2 before planning anything. It changes the plan.

---

## 1. Where the decommission stands

| Channel | State | Date |
|---|---|---|
| **Airbnb** | Done. Disconnected from Lodgify, grid re-entered on both listings, 808 days verified day by day twice (zero discrepancy), per-date min-nights restored, commission **measured at exactly 15,5 %**, cleaning fee moved off the price and sold on site, FR/EN description blocks realigned. | 15–16/10 |
| **Booking** | Done. Connectivity provider removed (`provider_id=689`), commission corrected **15 % → 16,44 %** (measured), both grids re-entered, L'Estiva's five missing derived rate plans built. One production incident, see §2.2. | 15/10 |
| **Abritel / Vrbo** | **Not started.** Everything in §3. | — |
| **Lodgify subscription** | Still live. Cancelled last, after the 72 h watch. | — |

GuestFlow platform commissions, read from production this morning: `Abracadaroom 20 %`,
**`Abritel 15 %`** (created, so runbook step 3's platform creation is done), `Airbnb 15.5 %`,
`Booking 16.44 %`, `Campspace 6 %`, `GitesDeFrance 10 %`, `Greengo 14.5 %`, `Lodgify 5 %`.

---

## 2. Three corrections — measured this morning

### 2.1 The Lodgify sources are **not** stopped, whatever the UI says

Both Lodgify iCal sources (#10 on Granja, #5 on L'Estiva) display « Désactivé » in GuestFlow. That
chip reflects `ical_sources.disabled = 1`, and `disabled` is a **display filter only**: it hides
that platform's bookings from the property's reservation views
([`propertyIcalModel.js:1028`](../../server/src/models/propertyIcalModel.js#L1028)), greys the card
and blocks the *manual* sync button
([`PropertyPlatformsTab.jsx:214`](../../client/src/components/property/PropertyPlatformsTab.jsx#L214)).

The hourly job selects on a different column —
[`scheduledTasks.js:59-63`](../../server/src/scheduledTasks.js#L59-L63):

```sql
SELECT * FROM ical_sources WHERE isActive = 1 ORDER BY id
```

`disabled` is not in that query. Both sources still carry `isActive = 1`, and source #10 reports
`lastSyncAt = 2026-10-16 05:31:27`, `success`, « 0 créé(s), 0 mis à jour, 0 verrouillé(s),
0 annulation(s) à valider, 7 inchangé(s) ». The feeds answer and still carry stays — anonymised,
exactly as described in §11 after a disconnection (`SUMMARY:A** L** O******** M*****`): 15 events
on Granja of which 7 in the future, 26 on L'Estiva of which 4 in the future. The 7 future Granja
events are the « 7 inchangé(s) ».

**Two consequences, opposite in sign.**

- *Good:* Abritel still reaches GuestFlow through the Lodgify feed, so **there is no overbooking gap
  today**. The spec's §11 note — « plus aucun flux vers GuestFlow depuis Abritel », treated as
  urgent — is wrong as long as Abritel is still connected on the Lodgify side (verify that first,
  §3 step A).
- *Bad:* spec rule 10 requires `isActive = 0`, and **the UI offers no control that writes it**. The
  only button is « Désactiver » / « Réactiver ». So rule 10 is currently unenforceable from the
  interface, and the duplicate mechanism of runbook step 6 stays armed. This needs a decision
  (§5.3), not a workaround.

### 2.2 The five phantom reservations of 15/10 are still in production

Each shadows a real Booking reservation on the same dates and property:

| Phantom (`Lodgify`, 0 €) | Shadows (`Booking`, real) | Dates | Property |
|---|---|---|---|
| #22316 / 202610004 | #22309 / 6392081711 — 638 € | 2026-11-06 → 11-08 | Granja |
| #22317 / 202610005 | #22282 / 6396936881 — 750 € | 2027-06-11 → 06-13 | Granja |
| #22318 / 202610006 | #22301 / 6617083884 — 930,40 € | 2027-07-08 → 07-11 | Granja |
| #22319 / 202610007 | #22304 / 5449776734 — 1 804 € | 2027-07-25 → 08-01 | Granja |
| #22315 / 202610003 | #22270 / 6646665983 — 600 € | 2027-08-07 → 08-13 | L'Estiva |

Signature, checked on #22316: `createdAt 2026-10-15 18:41:27`, total `0 €`, one guest, anonymous
client `#144`. That is the incident recorded in §11 — fresh UIDs, anonymised, guest count flattened
to one adult — and it was **never cleaned up**. They carry no money, but they occupy the calendar
twice on five future stays.

Deleting a production reservation is irreversible: it is the operator's call, never the session's.
Ask, then delete through the UI (§5.2).

### 2.3 Runbook step 3 is already settled, but not the way it reads

Production holds **14 future reservations** (2026-10-16 → 2028-12-31): 5 `Booking`, 5 `Lodgify`,
2 `direct`, 1 `Greengo`, 1 `GitesDeFrance`. **No `Abritel` and no `Airbnb`.** So:

- « Relabel every future reservation filed under `Lodgify` that actually came from Booking, Airbnb
  or Abritel » has no real subject — the five `Lodgify` rows are the phantoms of §2.2, to delete and
  not to relabel.
- « Create the `Abritel` platform at 15 % » is done.

Step 3 therefore reduces to the deletion in §5.2. Note also that **no future Abritel stay exists**,
which makes this the cheapest possible moment to cut the channel.

---

## 3. What is left on Abritel, in order

**Access needed from Adrien:** the Vrbo/Abritel partner space **and** the Lodgify back-office, both
opened in the browser he drives. The session never asks for, reads or types credentials; he types
them himself, and pastes a one-time code only if he chooses to.

### Step A — the blocking check (spec §10 step 2)

In the Abritel partner space, establish who owns listing **AB 2622643** (property **123465737**):
the Lodgify integration, or the owner account directly. **If disconnecting would deactivate the
listing or drop its reviews, stop** and ask Vrbo support for a transfer to a direct owner account
before touching anything. Nothing else on this channel starts before this answer.

While in Lodgify, confirm Abritel is still connected there — §2.1's « no gap » conclusion depends on
it.

### Step B — measure the commission before deriving any price

Abritel is recorded at **15 %** and was **measured at 9,7 %** at some point; the contradiction is
unresolved. This is the same question as Q7, and it has gone both ways already: Booking's stored
15 % was really 16,44 %, Airbnb's stored 15,5 % was exact. Until it is measured, every Abritel price
derived from a recipe misses its net target.

Method that worked twice: take a **settled** payout, divide what the channel withheld by the
commissionable base, and state explicitly what is inside that base. On Airbnb the base includes the
cleaning fee and excludes the tourist tax; on Booking the withheld line « Commission et frais »
bundles a facilitation fee the contractual rate does not mention. Write the rate into
`platforms.commissionPercent` — never into the recipe JSON, which holds net targets only
(`propertiesModel.js:693` regrosses).

### Step C — record the current grid before touching anything (runbook step 4)

Standard price, derived plans, promotions, minimum stays, booking window, and any **channel-level
rule** (weekend premium, seasonal modifier, smart pricing). Pitfall 2bis is not theoretical: a
+35,75 % Airbnb weekend premium sat inert under Lodgify and started inflating every Friday and
Saturday the moment the pushes stopped.

### Step D — the cut

Disconnect Abritel in Lodgify (`channels/manager/<canal>`), **and set that channel's Lodgify source
inactive in the same minute** (runbook step 6). On Abritel this is the last channel, so the Lodgify
source for a property can go fully inactive once its Abritel feed is wired — which is why step F's
order matters. Given §2.1, "inactive" currently has no UI control: decide §5.3 first, or the cut
re-arms the duplicate mechanism that produced §2.2.

### Step E — re-enter the grid from the recipe

Assume everything per-date is wiped until measured otherwise. From the Airbnb experience, budget a
full re-entry, not a spot check, and apply the three pitfalls learned there:

- **30** — the re-entry starts at **today's date**: the block running from today to the next season
  boundary is the one that gets forgotten, and ranges covering a **single day** get skipped
  (2026-12-30 on the gîte was missed exactly this way).
- **31** — the stored commission may be the withheld rate (Airbnb) or not (Booking). Measure, §3B.
- **32** — per-date **min-nights** windows vanish with the cut like prices, and they are invisible on
  the calendar: check them explicitly.

Prices come from GuestFlow's own recipes through the `platform-tariff-rollout` skill, and the run
ends with a verification that the posted rates match the recipe, season by season — the same
exhaustive day-by-day comparison used on Airbnb, not a sample.

### Step F — wire both directions

1. In the Abritel extranet, import GuestFlow's export feed for the property (Réglages → lien
   d'export iCal).
2. Copy Abritel's own export URL into a **new** GuestFlow Abritel source for each property, sync it,
   and read the result: takeovers expected, no creation on a date already held.

### Step G — close out

1. **Quote test** on each channel: a date held by another channel must be unavailable; a free date
   must price as recorded in step C.
2. **Watch the dashboard 72 h** — new iCal reservations, cancellation alerts, conflict badges.
3. **Only then** cancel the Lodgify subscription.
4. Remove the now-redundant AbracadaRoom / Lodgify / GreenGo iCal imports from the tente's Airbnb
   listing (safe only after Abritel is switched over — see §11: that import is the last thing
   standing between an Abritel booking and an Airbnb double-booking).
5. Update `.claude/skills/platform-tariff-rollout/references/platforms.md`: Abritel becomes a
   console of its own, no longer « nourri par Lodgify ».

---

## 4. Guardrails that apply to the whole job

- **Never ask for, read or type credentials.** Adrien opens the logged-in sessions.
- **Stop and ask before every irreversible gesture**: removing a connectivity provider, deleting a
  production reservation, cancelling the Lodgify subscription.
- **No direct SQL on production.** Writes over SSH are refused by the auto-mode classifier
  (`[Remote Shell Writes]`) and reads were refused too (`[Production Reads]`). Everything goes
  through the GuestFlow UI, or through the app's own API from the authenticated browser tab — which
  is how every figure in this document was read.
- A browser write may be refused as `[Real-World Transactions]`. When it happens: finish all
  read-only work, write down what was found, and ask — never work around the refusal.
- **Every choice goes to Adrien through `AskUserQuestion`**, never as a prose list of options.
- **The spec moves with the work**, in the same commit, with no size threshold. Lodgify sources are
  set inactive, never deleted (rule 10).
- Claude branches, commits, pushes and opens the PR; **Claude never merges**. Commits are authored
  `Adrien Jouve <adrien.jouve@adn-dev.fr>`, with no `Co-Authored-By` and no « Generated with ».

---

## 5. Open arbitrations for Adrien

1. **The champagne evening package.** Both listings announce « bain privatisé après 20 h et
   champagne au bord du bain, 50 € » (in French and English on the tent; it was English-only on the
   gîte and was removed there on 16/10). GuestFlow's catalogue has no such package: the nordic bath
   is 30 €/h with `hourlyEveningStart 20:00` and `hourlyEveningRate 50`, and champagne is a separate
   option (40 € the bottle, 25 € the half). As written, the listing sells a 40 € bottle plus a 50 €
   hour for 50 € total. Either create the package as a real option, or reword the two listings.
2. **The five phantom reservations** of §2.2 — delete them?
3. **Rule 10 has no UI.** Add a control that writes `isActive`, make the hourly job honour
   `disabled`, or rewrite rule 10 to match what the interface can actually do.
4. **The gîte's house rules** now that the cleaning is optional: what is expected of a guest who
   declines it (state of return, washing-up, bins). The current rules say nothing.
5. **Three services announced on Airbnb but absent from GuestFlow's catalogue** (tent): « Kit
   Aventurier », « plaque de cuisson », « Option Portage de Bagages ».

---

## 6. Reference

**Airbnb listings** — gîte `1398287456607254737`, tent `1576845044615216441`. Per-date editing lives
under `/multicalendar/<id>/…`; the **description** lives under
`/hosting/listings/editor/<id>/details/description`, one value **per language**
(`#listing-description-Français-textarea`, `#listing-description-English-textarea`), 500 characters
for the short fields and more for « Mon logement » (1 778 characters observed).

**Booking** — group `hotel_account_id=22925006`, gîte `14407976`, L'Estiva `15343212`, Lodgify was
`provider_id=689`.

**Abritel** — listing `AB 2622643`, property `123465737`.

**GuestFlow** — properties `#1 Granja`, `#2 Estiva`. iCal sources: Granja #9 Abracadaroom, #2 Airbnb,
#12 Booking, #1 GitesDeFrance, #7 Greengo, #10 Lodgify; Estiva #8 Abracadaroom, #14 Airbnb,
#11 Booking, #13 Campspace, #6 Greengo, #5 Lodgify. Production `adrien@192.168.0.24`, public host
`https://guestflow.adn-dev.fr`.

**Files** — [`specs/lodgify-decommission.md`](../../specs/lodgify-decommission.md) (rules §3, runbook
§10, journal §11, open questions §9),
[`.claude/skills/platform-tariff-rollout/references/platforms.md`](../../.claude/skills/platform-tariff-rollout/references/platforms.md)
(the durable field manual: where a commercial fact lives, and pitfalls 1–32).

**Git** — branch `docs/lodgify-decommission-booking`, PR **#687**, open.
