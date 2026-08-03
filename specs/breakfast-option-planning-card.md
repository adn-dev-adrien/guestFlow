# Breakfast option gains the per-day occurrence selection (1×/jour)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/breakfast-option-planning-card` |
| **Created** | 2026-06-17 |
| **Author** | Adrien |
| **Touches** | `utils/breakfastSeed.js`, `models/breakfastModel.js`, `models/planningOptionCardsModel.js`, `components/reservation/ExtrasSection.js`, `database.js` (one-time migration) |

> **Extended by [[sas-breakfast-milk-and-food]] (2026-07-18):** planning breakfast items also
> carry `milk`, `pastries`, `cereals`, rendered as extra chips on the planning card.

---

## 1. Context

« Petit déjeuner » is a special seeded option (`autoOptionType='breakfast'`, undeletable) with its own
machinery: a dedicated **BreakfastDayCard** on the Planning (café/thé/chocolat + heure), an **arrival-SAS
breakfast step**, and `reservations.breakfast*` columns. The Planning card currently lists **every served
morning** automatically (`(startDate, endDate]`) at a single `breakfastTime`.

Decision (AskUserQuestion 2026-06-17): keep ALL the breakfast features, but **add the generic
option-planning-card mechanism** (specs/option-planning-card.md) to it — **« une fois par jour »** — so the
operator picks, **per reservation**, **which days** the breakfast applies and **the hour**, exactly like the
other card options. The **dedicated breakfast card stays** (with drinks) but is **driven by the selected
occurrences** instead of the automatic morning window. **No** generic OptionDayCard for breakfast (no double
card). **Existing reservations are migrated** so their breakfast cards keep showing without a re-save.

## 2. Goal

The breakfast option behaves like a `showsPlanningCard` / `once_per_day` option for **selection + pricing**,
while its **planning rendering remains the rich BreakfastDayCard**, now fed by the per-reservation
`cardOccurrences` (checked day × the chosen hour).

## 3. Functional rules

1. The breakfast option carries `showsPlanningCard = 1`, `cardRepeat = 'once_per_day'`,
   `planningCardTimes = [<default breakfast hour>]` (set by the seed on every install + on prod via the
   seed at deploy). It keeps `autoOptionType = 'breakfast'` and its other flags.
2. **Fiche (ExtrasSection)**: the breakfast option shows the **per-day occurrence checklist** (one chip/day,
   editable hour, presence-filtered by check-in/out) like other `once_per_day` options. The old single
   « Heure souhaitée » field is **hidden** for breakfast (the checklist's hour replaces it).
3. **Pricing**: unchanged mechanism — as a card-option, `billedUnits = selected occurrences × guests`
   (per-person). With every served morning selected (the default), this equals the previous
   `persons × nights`, so amounts are unchanged by default.
   3.bis **`quantity` now counts MORNINGS, not guests (added 2026-08-03).** The engine stores
   `quantity = occurrences.length` on a card-option ([pricing.js](../server/src/utils/pricing.js),
   `showsPlanningCard` branch) — it is **no longer** the sub-occupation factor it is on a plain option.
   Any consumer reading `reservation_options.quantity` for a breakfast head count must therefore NOT
   multiply the party by it: the people served each morning are the party itself. This bit us in
   `breakfastModel` (2 guests × 2 nights announced as « 4 personnes » on the SAS, the planning card and
   the push) — see [breakfast-option-and-planning-card.md](breakfast-option-and-planning-card.md) rule 5.
4. **Planning**: the **BreakfastDayCard** is built from the breakfast option's **`cardOccurrences`** — one
   entry per checked occurrence whose date ∈ window, at the occurrence's hour, carrying persons + drinks +
   note. If a reservation has the breakfast option but **no** `cardOccurrences` (legacy/edge), fall back to
   the previous served-morning window so nothing disappears.
5. The **generic** `planningOptionCardsModel` **excludes** `autoOptionType='breakfast'` (breakfast renders
   only via its dedicated card — no duplicate).
6. **Arrival SAS**: the breakfast step's hour follows the first checked occurrence (else the default);
   persons + drinks unchanged.
7. **Migration (one-time, guarded)**: for every reservation that has the breakfast option and **no**
   `cardOccurrences` yet, seed `cardOccurrences` = each served morning `(startDate, endDate]` at the
   reservation's `breakfastTime` (else the option default). Idempotent (recorded in the `migrations` table).

## 4. Architecture

| Layer | File | Responsibility |
|---|---|---|
| seed | `utils/breakfastSeed.js` | On create/promote/ensure, set `showsPlanningCard=1`, `cardRepeat='once_per_day'`, `planningCardTimes=[breakfastTime]` on the breakfast option. |
| models | `models/breakfastModel.js` | `breakfastByDate`: emit a card per breakfast `cardOccurrence` (date ∈ window, occurrence hour) + drinks; fallback to the served-morning window when no occurrences. `getForReservation`: hour from the first occurrence. |
| models | `models/planningOptionCardsModel.js` | Exclude `o.autoOptionType='breakfast'` from the generic cards (no double). |
| components | `components/reservation/ExtrasSection.js` | Hide the legacy single « Heure souhaitée » field for breakfast (the occurrence checklist drives the hour). |
| database | `database.js` | One-time guarded migration (`migrations` table): seed `cardOccurrences` on existing breakfast reservations (served mornings × breakfastTime). |

## 5. Data model
No new columns (reuses `options.showsPlanningCard/cardRepeat/planningCardTimes` + `reservation_options.cardOccurrences`).

## 6. Test plan
- [x] `breakfastSeed`: the seeded/promoted breakfast option carries `showsPlanningCard=1`, `once_per_day`,
  `planningCardTimes` (slot from the breakfast hour). (`tests/breakfast-option-card.unit.test.js`.)
- [x] `breakfastModel.breakfastByDate`: with `cardOccurrences`, emits exactly the checked days at their
  hours; without, falls back to the served-morning window. (`tests/breakfast-option-card.unit.test.js`.)
- [x] `planningOptionCardsModel`: a breakfast option never produces a generic card.
- [x] Server suite 1603 pass.
- [x] Manual (dev): breakfast option shows the per-day occurrence checklist (presence-filtered: the
  arrival morning is excluded), no legacy « Heure souhaitée »; quantity = selected mornings × persons
  (4 = 2×2); the Planning shows the breakfast cards on the checked days (21/22 juin) with **no** duplicate
  generic card; the boot seeded `cardOccurrences` on the existing breakfast reservations.

## 7. Out of scope
- Repeat modes other than `once_per_day` for breakfast.
- Removing the breakfast-specific drinks / SAS step (kept).
