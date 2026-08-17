# Planning — the day counter counts every task of the day

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/planning-day-task-count` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [planning-chronological-day-ordering.md](planning-chronological-day-ordering.md), [resource-hourly-scheduling.md](resource-hourly-scheduling.md) |

---

## 1. Context

Each day of the Planning carries a small chip — `0/1` — meant to say « où j'en suis aujourd'hui ». It
only ever counted **arrivals**: `reservations.filter(checkInReady).length / reservations.length`
([PlanningPage.jsx](../client/src/pages/PlanningPage.jsx)). A day with two departures and a bain
nordique to prepare, but no arrival, reads **0/0** — « rien à faire » — while the operator has three
things to tick. The same expression drives the header's **green** state, so such a day never turns
green either.

Issue **#15**: *« Sur le planning il faut ajouter les départs et les tâches de ressources complexes dans
le nombre de tâche à faire 0/1. »*

## 2. Goal

The day chip counts everything the operator has to tick on that day — arrivals, departures and the
resource sessions to prepare — and the day turns green when all of it is done.

## 3. Functional rules

1. **The day's tasks** are the three tickable cards of the day:
   - an **arrival** — done when `checkInReady` (« Prêt », the card's own checkbox);
   - a **departure** — done when `checkOutDone` (« Effectué »);
   - a **resource session card** (`showsPlanningCard` resources: le bain nordique) — done when the
     session's `done` flag is set.
2. **The chip reads `done/total`** over that set. A day with nothing to do renders `0/0`, as today.
3. **The day header turns green** when `total > 0` and `done === total` — same rule as before, applied
   to the widened set (a day of departures only can finally go green).
4. **Nothing else is counted** (decision, issue #15 wording): the breakfast cards, the option/meal
   cards, the laundry trip and the resource bookings are not part of the counter. They stay visible in
   the day's stream.
5. **The counter is pure display arithmetic** over the arrays the page already renders — no new
   endpoint, no second source of truth.

**Edge cases:**
- A day with only resource sessions, all done → `2/2`, green.
- A day with an arrival not ready and a departure done → `1/2`, not green.
- Reception mode (which hides nothing of these three) counts the same.

---

## 4. Architecture

> **Fat backend caveat.** The counter is deliberately client-side: it counts the very cards the page
> has already received and is rendering. Asking the server for a separate count would create a second
> source of truth that could disagree with the visible cards — the failure this issue is about. The
> arithmetic lives in a pure, unit-tested helper rather than inline in the JSX.

### 4.1 Server side

None.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `utils/planningDayTasks.js` | C | `countDayTasks({ arrivals, departures, resourceCards })` → `{ done, total, allDone }`. Pure. |
| `pages/` | `pages/PlanningPage.jsx` | T | The header chip and the green state read the helper instead of counting arrivals inline. |

**Component reuse declaration:** no new component; the chip and the header are unchanged apart from the numbers they show.

### 4.3 API contract

Unchanged.

---

## 5. Data model

No change.

## 6. UI / UX

Same chip, same place, same colours — wider numbers. A day that used to read `0/0` while holding two
departures now reads `0/2`, then `2/2` in green once both are ticked.

## 7. Test plan

### Client unit tests (`client/src/utils/__tests__/planningDayTasks.test.js`, 6 tests)
- [x] Arrivals only → unchanged behaviour (the historical count).
- [x] Departures count, and a day of departures only can reach `2/2`.
- [x] Resource session cards count, done flag honoured.
- [x] The three add up; `allDone` is false while one is pending.
- [x] An empty day → `0/0`, `allDone` false (a day with nothing to do is not « green »).
- [x] Missing / undefined arrays are treated as empty (a day with no departures map yet).

### Client component test (`pages/__tests__/PlanningPage.*`)
- [x] Covered by the existing planning render tests (no chip snapshot to update).

### Manual UI verification
- [x] A day with a departure + a bain nordique session checked in the browser. Screenshot in the PR.

## 8. Out of scope

- Counting the breakfast / option cards or the laundry trip (rule 4).
- Any change to what « done » means for each card (the existing toggles are untouched).

## 9. Open questions

None.
