# Abritel / Vrbo switch-over — session handover

**Written 2026-10-16, ~07:40.** State of the world measured, not remembered. Hand this file to a
fresh session together with [`specs/lodgify-decommission.md`](../../specs/lodgify-decommission.md),
which stays the source of truth for *why*. This document only says **where we are** and **what is
left**, and it corrects three things the spec and the session memory currently get wrong.

Read §2 before planning anything. It changes the plan — and note that **Abritel no longer reaches
GuestFlow at all** since this morning (§2.1), which puts a clock on the switch-over.

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

## 2. Three things the spec got wrong — measured, and two of them already fixed

### 2.1 The Lodgify sources were not stopped — now they are

Both Lodgify iCal sources (#10 on Granja, #5 on L'Estiva) displayed « Désactivé » in GuestFlow. That
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

`disabled` is not in that query, so both sources kept importing every hour. Proof, not inference:
deleting the five duplicates of §2.2 triggered the 05:46:27 sync to **re-create three of them**
(« 3 créé(s), 0 mis à jour, 0 verrouillé(s), 0 annulation(s) à valider, 4 inchangé(s) »). Deleting
is futile while the source is active — the operator's deletion leaves no tombstone the import
honours.

**Resolved 2026-10-16, on the operator's call.** Both sources are now `isActive = 0`, URL and
platform key preserved, every other source untouched. The UI has no control that writes that column,
so it was done with a `PUT /api/properties/<id>/ical-sources/<sourceId>` carrying
`isActive: false` from the authenticated browser session. A forced `sync-all` on both properties
then created nothing.

**The live exposure this creates — read it before Abritel.** Lodgify was the last path an Abritel
booking had into GuestFlow. From now until the Abritel switch-over, **a new Abritel reservation does
not reach GuestFlow at all** and will not block the dates on any other channel. The risk is bounded
— there is no future Abritel stay today (§2.3) — but it grows with every day the switch-over waits,
and the Airbnb listings' own Lodgify *import* is the only remaining guard on that side, which is why
it must not be unlinked (§3 step G.4).

**Still open:** rule 10 asks for `isActive = 0` and the interface cannot produce it. Give the UI that
control, make the hourly job honour `disabled`, or rewrite the rule — see §5.3.

### 2.2 The duplicate reservations of 15/10 — found, and deleted

Each shadowed a real Booking reservation on the same dates and property:

| Phantom (`Lodgify`, 0 €) | Shadowed (`Booking`, real) | Dates | Property |
|---|---|---|---|
| #22316 / 202610004 | #22309 / 6392081711 — 638 € | 2026-11-06 → 11-08 | Granja |
| #22317 / 202610005 | #22282 / 6396936881 — 750 € | 2027-06-11 → 06-13 | Granja |
| #22318 / 202610006 | #22301 / 6617083884 — 930,40 € | 2027-07-08 → 07-11 | Granja |
| #22319 / 202610007 | #22304 / 5449776734 — 1 804 € | 2027-07-25 → 08-01 | Granja |
| #22315 / 202610003 | #22270 / 6646665983 — 600 € | 2027-08-07 → 08-13 | L'Estiva |

Signature, checked on each one before deleting: created `2026-10-15 18:41`, total `0 €`, one guest,
anonymous client `#144`, and the reservation page's own warning « Ce logement est déjà réservé pour
ces dates ». That is the incident recorded in §11 — fresh UIDs, anonymised, guest count flattened to
one adult.

**Deleted 2026-10-16**, one at a time through the UI, each identified before the click. The 05:46
sync re-created three mid-way (#22320, #22321, #22322 / 202610008-010); those were deleted too,
**after** the sources were stopped (§2.1). A forced `sync-all` on both properties then created
nothing, and production holds **9 future reservations** — 5 `Booking`, 2 `direct`, 1 `Greengo`,
1 `GitesDeFrance`, **zero `Lodgify`** — with every real reservation intact.

### 2.3 Runbook step 3 is done, but not the way it reads

Production held **14 future reservations** (2026-10-16 → 2028-12-31) when this was written: 5
`Booking`, 5 `Lodgify`, 2 `direct`, 1 `Greengo`, 1 `GitesDeFrance` — **no `Abritel` and no
`Airbnb`** — and holds 9 since the deletions of §2.2. So:

- « Relabel every future reservation filed under `Lodgify` that actually came from Booking, Airbnb
  or Abritel » has no real subject — the five `Lodgify` rows are the phantoms of §2.2, to delete and
  not to relabel.
- « Create the `Abritel` platform at 15 % » is done.

Step 3 is therefore **done**: the deletion is carried out (§2.2) and the platform exists. Note also
that **no future Abritel stay exists**, which makes this the cheapest possible moment to cut the
channel.

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

1. ~~The champagne evening package.~~ **Settled 2026-10-16: kept as it stands**, and written into
   the catalogue so accounting sees it — option **#34** « Formule soirée : bain nordique privatisé +
   champagne », 50 € per stay, category *Animations*, both properties, visible to the guest. The
   bottle is therefore a deliberate gesture on the evening slot, and the two listings stay as they
   are. ⚠️ **One thing to watch when the first guest takes it:** the nordic bath is also an hourly
   *resource* at 50 €/h after 20:00, and the option does not book that slot. If the guest's free
   hour (60 min per stay, both properties) is already used in the daytime, scheduling the evening
   hour **on top of** the option bills 50 € twice. Decide then whether the option should book the
   slot at 0 € or whether the slot is simply not recorded.
2. ~~The five phantom reservations.~~ **Settled 2026-10-16: deleted**, see §2.2.
3. **Rule 10 has no UI.** Add a control that writes `isActive`, make the hourly job honour
   `disabled`, or rewrite rule 10 to match what the interface can actually do. Stopping the sources
   this morning needed a direct `PUT` on the API, which is not a procedure to leave in a runbook.
4. **The gîte's house rules** now that the cleaning is optional: what is expected of a guest who
   declines it (state of return, washing-up, bins). The current rules say nothing.
5. **Three services announced on Airbnb but absent from GuestFlow's catalogue** (tent): « Kit
   Aventurier », « plaque de cuisson », « Option Portage de Bagages ».
6. **Free text loses its capitals.** Option #34's description came back as « … réservé aux
   adultes. » where « Réservé » was typed. A `fix/free-text-keeps-case` branch already exists for
   this; the text is guest-facing, so it is worth finishing.

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
#12 Booking, #1 GitesDeFrance, #7 Greengo, #10 Lodgify (`isActive = 0` since 2026-10-16); Estiva
#8 Abracadaroom, #14 Airbnb, #11 Booking, #13 Campspace, #6 Greengo, #5 Lodgify (`isActive = 0`).
Every other source is active. Production `adrien@192.168.0.24`, public host
`https://guestflow.adn-dev.fr`.

**Files** — [`specs/lodgify-decommission.md`](../../specs/lodgify-decommission.md) (rules §3, runbook
§10, journal §11, open questions §9),
[`.claude/skills/platform-tariff-rollout/references/platforms.md`](../../.claude/skills/platform-tariff-rollout/references/platforms.md)
(the durable field manual: where a commercial fact lives, and pitfalls 1–32).

**Git** — branch `docs/lodgify-decommission-booking`, PR **#687**, open.
