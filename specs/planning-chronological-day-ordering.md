# Planning — chronological day ordering

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/planning-chronological-day-ordering` _(user-managed)_ |
| **Created** | 2026-08-02 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The Planning page (`client/src/pages/PlanningPage.js`) groups each day's cards **by card type in a
fixed block order**:

```
Blanchisserie → Petit-déjeuner → Options → Sessions ressource → Départs → Arrivées → Réservations ressource
```

Every card already carries a time: arrivals (`checkInTime`), departures (`checkOutTime`), option/meal
cards (`item.time`), breakfast (`breakfastTime`), resource sessions (`start`), resource bookings
(`startTime`). But because the ordering is by *type*, a 10:00 arrival is rendered **after** an 08:00
breakfast and **before** a 19:00 meal only by coincidence of the block order — an arrival at 10:00 can
end up visually below a meal at 19:00.

`OptionDayCard` already renders **one card per occurrence** (not one aggregated card), so a
per-card chronological interleaving is feasible without changing any card component.

## 2. Goal

Within a given day, all planning cards are ordered **by their time**, earliest first, in a single
chronological stream — so an arrival at 10:00 appears before a meal at 19:00, regardless of card type.

## 3. Functional rules

1. Within one day, every card that carries a time is ordered ascending by that time (HH:MM), across
   **all** card types mixed together (arrivals, departures, meals/options, breakfast, resource
   sessions, resource bookings).
2. The sort time per card type is:
   - Arrival card → `checkInTime` (fallback `15:00`).
   - Departure row → `checkOutTime` (fallback `11:00`).
   - Option / meal card → `item.time`.
   - Breakfast card → `breakfastTime`.
   - Resource session card → `start` (the start of the `start–end` range).
   - Resource booking card → `startTime`.
3. Cards **without a time** (laundry day card; an option card whose `time` is null/empty) sort
   **after** all timed cards — i.e. at the **bottom** of the day.
4. Ties (two cards at the same minute) preserve a stable, deterministic order (insertion order of the
   build sequence: departures, arrivals, breakfast, options, resource sessions, resource bookings,
   then the time-less laundry card).
5. The day **header** (weekday chip + ready counter) and the inter-day **divider** are unchanged —
   only the cards **between** them are reordered.
6. No card is added or removed by this change: the exact same set of cards renders for a day as
   before, only their vertical order changes.
7. All existing per-card behavior is untouched: SAS open on click, « fait »/« prêt » toggles,
   alerts overlays, laundry skip/manual-addition, breakfast prep popup, reservation-fiche links,
   reception-mode inertness.

**Edge cases:**
- A day with only a laundry card (no arrivals/departures/options) → renders the laundry card alone
  (it's time-less → bottom, but it's the only card, so it's simply shown). Unchanged from today.
- A skipped laundry date with no underlying payload → still renders its placeholder card at the
  bottom (rule 3), toggle still revertable.
- An option card with `time === null` → time-less → bottom, alongside laundry (rule 3).
- Two arrivals at the same `checkInTime` → stable insertion order (rule 4), same as today's
  intra-arrival sort.

---

## 4. Architecture

> **Fat backend, thin frontend — justification for a client-side change.**
> This change is **pure presentational ordering** of cards that are already fully shaped by the
> server. Each card already carries its own display time in its payload; no business rule, price,
> balance, status, or derived business datum is computed here — only the *vertical rendering order*
> of a heterogeneous card list is decided. That list is assembled on the client from **six
> independent, independently-paginated endpoints** (reservations, laundry summary, breakfast summary,
> option cards, resource cards, resource bookings) merged under an infinite-scroll horizon; there is
> no single server query that produces it. Building a server-side unified sorted stream would mean a
> new cross-domain aggregation endpoint replacing that architecture — disproportionate to a vertical
> re-order by a time field that is already present. The ordering rule is extracted into a **pure,
> unit-tested util** (`client/src/utils/planningDayOrder.js`) so the logic is testable and not buried
> in JSX.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | **No server change.** All payloads already carry the per-card time. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `PlanningPage.js` | T | Build a per-day `entries` list `{ key, time, node }` for every card, order it via the new util, render the ordered nodes between the day header and the divider. |
| `utils/` | `planningDayOrder.js` | C | Pure `orderDayEntries(entries)` — stable sort by `time` (HH:MM) ascending, time-less entries last. |
| `utils/` | `__tests__/planningDayOrder.test.js` | C | Vitest unit tests for the ordering rules (ascending, time-less last, stable ties). |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `LaundryDayCard`, `OptionDayCard`, `ReservationCard`, `DepartureMiniRow`, `ResourceBookingsSection` (page-local) | Reused unchanged. `OptionDayCard` / `ResourceBookingsSection` are now invoked **once per item/booking** (single-item `data`/`bookings`) so each occurrence is an independently-orderable card. |
| **Created (new generic)** | — | No new component. |
| **Specific (kept feature-local)** | — | The ordering util is a pure helper, not a component. |

### 4.3 API contract

No API change. All consumed endpoints are unchanged.

---

## 5. Data model

No schema change. No migration. No data impact.

## 6. UI / UX

- **Desktop & mobile (identical logic):** within each day block, cards flow top-to-bottom by time.
  Example day: `Petit-déj 08:00 → Arrivée 10:00 → Départ 11:00 → Session spa 16:00 → Repas 19:00 →
  Blanchisserie (sans heure, en bas)`.
- No visual restyle of any card — same backgrounds, chips, spacing, alerts. Only vertical order
  changes.
- Responsive: unchanged. The page is a normally-flowing window-scrolled list; card ordering is
  identical across `xs` / `md` / `lg`. The sticky `<PageActionBar title="Planning">` + date cluster
  are untouched.
- Empty/loading/error states: unchanged.

## 7. Test plan

### Client unit tests (Vitest)
- [ ] `utils/__tests__/planningDayOrder.test.js`:
  - timed cards sort ascending by HH:MM
  - time-less cards (null/empty time) sort after all timed cards
  - ties preserve insertion order (stable)
  - mixed heterogeneous entry types order correctly (rule 1 + 3)

### Manual UI verification
- [ ] Happy path: a day with a morning breakfast, a 10:00 arrival, and a 19:00 meal → arrival before
      meal, breakfast first.
- [ ] Time-less: a day with a laundry card + a timed arrival → arrival above, laundry at the bottom.
- [ ] Regression: SAS opens, « prêt »/« fait » toggles, alerts, laundry skip + manual addition,
      breakfast prep popup, reception-mode inertness all still work.
- [ ] Infinite scroll: newly loaded days also render in chronological order.
- [ ] Mobile (`xs`): same ordering, no horizontal scroll.

## 8. Out of scope

- Any server-side aggregation / new endpoint.
- Restyling cards, changing card content, or changing which cards appear.
- Cross-day ordering (days remain sorted by date, ascending, as today).
- Configurable sort direction or user-chosen ordering.

## 9. Open questions

- Q: Scope of interleaving? → **A (2026-08-02):** All card types interleave in one chronological
  stream.
- Q: Where do time-less cards (laundry, option without time) go? → **A (2026-08-02):** At the
  **bottom** of the day.
