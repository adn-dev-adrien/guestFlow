# Skip a Laundry Trip

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/skip-laundry-trip` _(user-managed)_ |
| **Created** | 2026-06-06 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow already projects a **laundry trip** on every occurrence of
the configured `app_settings.laundryWeekday` (default Tuesday).
A trip is purely computed — there is no row in the DB representing
it. The `LaundryDayCard` in the Planning page renders three blocks
for each projected trip date (specs/weekly-bed-linen-tracking.md §6
+ specs/linen-inventory-shortage-tracking.md §3):

- **À apporter** — what to drop off (dirty linen accumulated since
  the previous trip)
- **À récupérer** — what to pick up (linen dropped 7 days ago)
- **Disponible après ce dépôt** — the resulting `clean` snapshot

Reality intrudes from time to time: the operator (Adrien) cannot
always make the laundry trip — illness, travel, a day off, etc.
Today the model has no way to capture "trip skipped". The Planning
keeps drawing the projected card; the shortage engine keeps assuming
the trip happened; the displayed clean stock diverges from reality;
the shortage alert can either over- or under-shoot.

The operator needs a one-click way to mark a trip date as **skipped**
and see the consequences propagate everywhere (planning + stock
projection + alerts).

## 2. Goal

The operator can mark any laundry trip date — past or future — as
skipped from the Planning page, see the corresponding
`LaundryDayCard` greyed out, and have the linen inventory engine
automatically defer that day's drop-off + pick-up to the next
non-skipped trip date. Recomputed projections + shortage alerts
reflect the skip immediately.

## 3. Functional rules

### 3.1 Skip semantics

1. **A skip is a (date) record.** It applies **globally** to every
   property simultaneously (the operator either makes the laundry
   trip that day or not — it's a single human, single trip per day).
2. **A skipped trip date is identified by its ISO date** (`YYYY-MM-DD`).
   The skip only has meaning on a date that the projection considers
   a laundry day (= `weekdayOf(date) == settings.laundryWeekday`);
   skipping a non-laundry date is silently ignored at engine time.
3. **A skip is reversible.** The operator can un-skip the same date
   at any time; the projection re-renders as if the skip never
   existed.
4. **Past dates are skippable.** Adrien retroactively says
   "actually I didn't go last Tuesday" — the stock projection
   re-aligns with reality. Without this, displayed stock would drift
   from the bins on the shelf.

### 3.2 Engine behaviour on a skipped date

5. **Drop-off carries forward.** Dirty linen at the start of the
   skipped date stays in the `dirty` bucket; nothing transitions to
   `atLaundry`.
6. **Pick-up carries forward.** Linen that entered `atLaundry`
   7 days before the skipped date stays in `atLaundry`; nothing
   transitions to `clean`.
7. **Next non-skipped trip absorbs both backlogs.** On the next
   trip date that is *not* skipped, the engine:
   - moves the full accumulated `dirty` (= 2 weeks of dirty if a
     single trip was skipped, 3 weeks if two consecutive trips,
     etc.) → `atLaundry`;
   - moves all `atLaundry` whose deposit date is ≥ 14 days before
     the trip date (covering the deferred batch + the regular
     7-day-ago batch) → `clean`.
8. **No partial skip.** A skip applies to **the whole day's
   transition** (drop-off AND pick-up). Half-skips (drop but no
   pick) are out of scope.

### 3.3 UI behaviour

9. **Skip toggle on the LaundryDayCard.** Each card gets an
   `IconButton` in its header. State 1: "skipper ce voyage" icon
   (e.g. `EventBusyIcon`), tooltip *"Marquer ce voyage blanchisserie
   comme non réalisé"*. State 2 (when skipped): "réactiver ce
   voyage" icon (e.g. `EventAvailableIcon`), tooltip *"Marquer ce
   voyage blanchisserie comme réalisé"*.
10. **Greyed-out skipped card.** A skipped card renders with
    `opacity: 0.45`, the three counts (À apporter / À récupérer /
    Disponible) struck through, and a muted caption *"Voyage non
    réalisé — reporté au prochain mardi"* (or whatever the weekday
    is). The IconButton stays clickable to un-skip.
11. **Hidden-when-empty rule still applies.** If `dropOff = 0` AND
    `pickUp = 0` on a date (before skip) the card is hidden as
    today. A skipped card is **always shown** when in scope (even
    if both counts would be 0) so the operator sees their own
    decision.
12. **Click optimistic, server-confirmed.** On skip toggle, the
    client immediately applies the visual greying + counts strike-
    through and POSTs `/api/laundry/skips` (or DELETE) in the
    background. If the request fails, the UI reverts + shows a
    snackbar *"Impossible d'enregistrer le voyage non réalisé."*.

### 3.4 Shortage alert + Dashboard

13. **Alert recomputed on every skip change.** The Dashboard's
    `LinenShortageAlert` re-fetches `/api/dashboard/linen-shortage`
    when the LaundryDayCard's skip mutation succeeds (already does
    on settings/option saves; the contract is "any change that
    affects the simulation → reload alert").
14. **Alert text unchanged.** No new "you have skipped trips"
    banner — the existing alert covers shortages caused by skips
    correctly (a skipped trip → less clean stock → more shortages).

**Edge cases:**

- A skip + an un-skip on the same date in the same UI session →
  net zero, both API calls succeed, the engine result is identical
  to never skipping.
- An operator skips date D, then changes `settings.laundryWeekday`
  to a different weekday → D is no longer a laundry date, the skip
  is silently inert (engine ignores any skip on a non-laundry-day).
  It stays in the DB so a future revert of the weekday change
  restores the previous skip set — accepted; alternative would
  delete on weekday change but feels too lossy.
- A skip is recorded for a date that was a laundry day at the
  time but no longer is (due to settings change) → same as above,
  inert.
- Two consecutive trips skipped → engine carries forward 3 weeks
  of dirty + 3 batches of `atLaundry` to the third trip. Tested in
  the engine unit suite.

---

## 4. Architecture

> **Fat backend, thin frontend.** The skip is stored server-side
> and the simulation engine is the single source of truth for what
> a skip means. The client only renders the greying + posts the
> toggle.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | `database.js` | T | NEW table `CREATE TABLE IF NOT EXISTS laundry_trip_skips (tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10))`. No migration of existing data needed (table starts empty). |
| `models/` | `models/laundryTripSkipsModel.js` | C | NEW — thin model with `listAll() → string[]`, `isSkipped(date) → boolean`, `add(date)`, `remove(date)`, `count() → number`. Factory `create(db)` mirroring the other models. |
| `models/` | `models/laundryModel.js` | — | **Stays untouched.** The pure-SQL aggregator `dropOffForWindow(start, end)` already sums any half-open `(start, end]` window — the skip semantics are achieved by widening the window upstream (in the controller) rather than mutating the SQL. Decision: keeps the model boring + the skip math co-located with the rest of the controller wiring. |
| `utils/laundryWindow.js` | `utils/laundryWindow.js` | T | NEW helper `previousNonSkippedLaundryDay(iso, skippedDates, maxLookbackDays = 28)` — walks back in 7-day jumps over any skipped Tuesdays, returns `null` past the lookback. Used by the controller to derive the widened drop-off / pick-up windows. |
| `utils/` | `utils/linenInventory.js` | T | Inject `skippedDates: Set<string>` into `simulateInventory`. Rules §3.2 / 5–7 implemented inside the daily transition loop. Conservation invariant (`clean + inCirculation + dirty + atLaundry = totalStock`) STAYS — we just defer transitions, never lose linen. |
| `controllers/` | `controllers/laundryController.js` | T (or C if doesn't exist) | NEW handlers `listSkips`, `addSkip`, `removeSkip`. Admin-only. |
| `routes/` | `routes/laundry.js` | T (or C if doesn't exist) | `GET  /api/laundry/skips`, `POST /api/laundry/skips`, `DELETE /api/laundry/skips/:date`. All admin-only. |
| `controllers/` | `controllers/planningController.js` + `dashboardController.js` | T | Two distinct skip wirings: (1) `linenInventory` + `linenShortage` thread the skip set through `simulateInventory` (drives the "Disponible après ce dépôt" line). (2) `laundrySummary` ALSO loads the skip set and feeds it to `previousNonSkippedLaundryDay` so the drop-off window of every non-skipped trip widens backward across skipped Tuesdays (drives "À apporter" / "À récupérer"). A skipped trip itself emits zero blocks — the client masks them with the "Voyage non réalisé" caption. **Both wirings are mandatory:** missing the second one is what produced the bug "la carte blanchisserie suivante ne change pas" caught on 2026-06-05 (fix in same PR). |
| `tests/` | 4 new test files | C | See §7. |

**Reuse:**
- The existing settings model pattern (`models/settingsModel.js`) for the skip model's factory shape.
- The existing `simulateInventory` daily loop — the change is local to two `if (skippedDates.has(date)) { /* defer */ }` branches inside that loop.
- The existing `LaundryDayCard` props bag — adds one boolean and one mutation callback, no structural change.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `pages/PlanningPage.js` | T | Thread the skip set into the `LaundryDayCard` props. After a skip toggle, refetch the linen inventory (already done on linen-affecting changes). |
| `components/` | `components/LaundryDayCard.js` | T | NEW prop `isSkipped: boolean`. NEW prop `onToggleSkip(date, nextValue) → Promise<void>`. Header: `IconButton` swapping `EventBusyIcon` ↔ `EventAvailableIcon` based on `isSkipped`. Body: `opacity: 0.45` + strikethrough when skipped + replaces "Disponible après ce dépôt" with the muted caption. |
| `api.js` | `api.js` | T | NEW: `listLaundrySkips()`, `addLaundrySkip(date)`, `removeLaundrySkip(date)`. |
| `tests/` | 1 new Vitest file | C | See §7. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Tooltip`, `IconButton`, `Box`, `Typography` (MUI) — `LaundryDayCard` (already feature-specific) | All pre-existing. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `LaundryDayCard` extension | Stays in `components/`; the skip toggle is intrinsically tied to the laundry day model. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/laundry/skips` | — | `{ skips: string[] }` (ISO dates) | Admin-only. |
| POST | `/api/laundry/skips` | `{ date: 'YYYY-MM-DD' }` | `{ ok: true, skips: string[] }` | Idempotent — POSTing an existing date returns OK. |
| DELETE | `/api/laundry/skips/:date` | — | `{ ok: true, skips: string[] }` | Idempotent — DELETing a non-skipped date returns OK. |

Error shape: `{ error: <message> }`, 400 on bad date format, 403 on
non-admin.

---

## 5. Data model

**New table** (idempotent CREATE in `database.js`):

```sql
CREATE TABLE IF NOT EXISTS laundry_trip_skips (
  tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

No FK to `properties` (skip is global per §3.1 rule 1) and no FK to
`app_settings`. No backfill needed.

**Data impact:** zero existing rows affected. No risk.

---

## 6. UI / UX

### `/planning` — Planning page

For each laundry day in the visible horizon, a `LaundryDayCard` is
rendered. The card now has a header IconButton:

```
┌─────────────────────────────────────────────────────────────┐
│ Voyage blanchisserie — mardi 9 juin             [🚫 skip ⬇] │
│ ─────────────────────────────────────────────────────────── │
│ À apporter      : 2 draps doubles, 4 grandes serviettes     │
│ À récupérer     : 1 drap simple, 3 serviettes moyennes      │
│ Disponible      : 0 drap bébé (manque 1), 5 grandes serv.   │
└─────────────────────────────────────────────────────────────┘
```

When skipped (operator clicked the IconButton):

```
┌─────────────────────────────────────────────────────────────┐ ░░
│ Voyage blanchisserie — mardi 9 juin             [✓ activer]│ ░░
│ ─────────────────────────────────────────────────────────── │ ░░
│ Voyage non réalisé — reporté au prochain mardi             │ ░░
└─────────────────────────────────────────────────────────────┘ ░░
```

- Opacity: 0.45 on the whole card
- The three-block detail is **replaced** by the single muted line
- The IconButton swaps icon + tooltip
- The card is **always rendered** when skipped (rule 11), even if
  the pre-skip counts would have been 0.

### Responsive

- `xs`: the IconButton stays in the header (top-right). Body stacks
  as today. Greyed state identical, just narrower.
- `md+`: unchanged.

### `PageActionBar`

PlanningPage's existing `PageActionBar` is untouched. The skip
toggle is per-card, not page-level.

### Shortage alert (Dashboard)

No new UI. The existing `LinenShortageAlert` re-renders with the
post-skip projection numbers. A skipped trip that pushes the
clean stock below 0 → the alert grows. An un-skipped trip → the
alert shrinks. Same component, same shape, recomputed inputs.

---

## 7. Test plan

### 7.1 Server unit tests

| File | Cases |
|---|---|
| **NEW** `tests/laundry-trip-skips-model.unit.test.js` | (1) `listAll` empty by default. (2) `add` → present, `add` again → idempotent. (3) `remove` → absent, `remove` again → idempotent. (4) `isSkipped` truthy iff present. (5) PK constraint on date. |
| **NEW** `tests/linen-inventory-skipped-trip.unit.test.js` | (1) A skipped trip on date D defers drop-off to D+7. (2) A skipped trip on date D defers pick-up to D+7. (3) Conservation invariant holds across the skip. (4) Two consecutive skipped trips → 3 weeks of accumulation on the third trip. (5) Skip on a non-laundry-day → no-op. (6) Skip set empty → engine output identical to pre-feature baseline. (7) Skip on a past date → projection re-aligns from today forward (no rewriting of yesterday's stock display). |
| **NEW** `tests/laundry-skips-endpoint.unit.test.js` | (1) GET returns the persisted list. (2) POST adds. (3) POST same date → 200 OK, idempotent. (4) DELETE removes. (5) DELETE non-existent → 200 OK, idempotent. (6) POST bad date format → 400. (7) Non-admin → 403. |
| **TOUCHED** `tests/linen-shortage.unit.test.js` (or equivalent) | One case added: shortage alert grows when a date is skipped (= less clean stock projected forward), shrinks when un-skipped. |
| **TOUCHED** `tests/laundry-window.unit.test.js` | Five cases on the new `previousNonSkippedLaundryDay`: empty skip set ≡ `prevLaundryDay`; single skip walks back 7d; multi-skip walks back further; null past lookback; longer lookback finds further-back candidate. |
| **TOUCHED** `tests/planning-laundry-controller.unit.test.js` | Five cases on the skip-aware `laundrySummary`: skipped day emits zero blocks; non-skipped trip after a skip widens drop-off backward; two consecutive skips widen to 21 days; skip bleeds into next trip then propagation stops; degenerate full lookback falls back to `L-7`. |
| **TOUCHED** `tests/laundry-end-to-end.regression.test.js` | One full-stack case (real DB) pinning the user-reported bug fix: skipping `2026-06-02` makes the `2026-06-09` card absorb both the deferred reservation and the natural one into "À apporter". |

Expected: existing **967** + **5 + 7 + 7 + 1 + 5 + 5 + 1** = **998** server tests.

### 7.2 Client unit tests (Vitest)

| File | Cases |
|---|---|
| **NEW** `client/src/components/__tests__/LaundryDayCard.skip.test.js` | (1) Non-skipped card renders the 3 blocks + the "skip" IconButton with tooltip "Marquer ce voyage…". (2) Skipped card renders the muted caption + the "activer" IconButton + has `opacity` < 1. (3) Clicking the IconButton calls `onToggleSkip(date, !current)`. (4) Card hidden by the `dropOff = 0 && pickUp = 0` rule still shows up when skipped (rule 11). |

Expected: existing **223** + **4** = **227**.

### 7.3 E2E (Playwright)

| File | Cases |
|---|---|
| **NEW** `e2e/specs/planning/skip-laundry-trip.spec.js` | Seed a reservation that produces a non-empty laundry card. Navigate to `/planning`. Click the skip IconButton on the next laundry day. Reload. Assert the card is greyed out + the muted caption is shown. Click the un-skip IconButton. Reload. Assert the original 3 blocks are back. |

Expected: existing **19** + **1** = **20**.

### 7.4 Manual

- Verify the LaundryDayCard correctly recomputes the next non-skipped trip's drop-off + pick-up after a skip.
- Open Dashboard, observe the shortage alert reacts to the skip.
- Skip a past date → verify the **current** displayed stock numbers shift accordingly (the simulation re-runs from today using today's actual `clean / inCirculation / dirty / atLaundry` snapshot, which is itself the output of the simulation from the start of the horizon — so a past skip changes the displayed "today's stock").

---

## 8. Out of scope

- **Per-property skip.** The operator confirmed global is the right
  scope (one human, one trip). A future split would mean indexing
  the skip table by `propertyId` and changing the engine to per-
  property iteration — sizeable, not needed today.
- **Half-skips** (drop-off without pick-up or vice versa). The
  human flow is "I'm going" or "I'm not". No use case for
  partial.
- **Skip reason / notes.** A free-text reason on a skip would clutter
  the UI for no measurable benefit. The shortage alert already says
  *what* is missing — the *why* of an individual skip doesn't change
  the math.
- **Auto-skip on holidays.** The system could auto-skip when
  `laundryWeekday` falls on a French public holiday. Out of scope —
  the operator can flip the skip manually that week.
- **Bulk skip a date range.** No bulk UI; one date at a time. Trivial
  to add later via the same endpoint.

---

## 9. Open questions

(All resolved before moving Status to Approved.)

1. ✅ **Granularity** → global (one date applies to every property).
2. ✅ **UX entry** → IconButton in the `LaundryDayCard` header.
3. ✅ **Past skips allowed** → yes, so the displayed stock can be
   retroactively re-aligned with reality.
4. ✅ **What happens to the deferred linen?** → carries forward to
   the next non-skipped trip (engine §3.2 rules 5–7).

---

## 10. Implementation progress

_(Filled in as commits land. Update this section in the same commit
that ships each step, per CLAUDE.md §4.1.)_

- [x] Backend: schema migration + `laundryTripSkipsModel` + endpoint.
- [x] Backend: `linenInventory.simulateInventory` skip-aware logic
      (loop + initial state via the new
      `previousOrSameNonSkippedLaundryDay` helper + pickup widened
      from `= D-7` to `<= D-7` so deferred batches don't loop forever).
- [x] Backend: server unit tests (6 model + 7 endpoint + 7 engine +
      4 propagation = 24).
- [x] Frontend: `LaundryDayCard` skip props + IconButton + greyed
      state + muted caption + rule 11 (always-shown when skipped).
- [x] Frontend: `PlanningPage` skip set + optimistic toggle handler
      with revert-on-failure + refetch inventory on success +
      placeholder data for skipped dates without underlying activity.
- [x] Frontend: Vitest tests (6) + Playwright E2E (2 — API round-trip
      + bad-date 400).
- [x] **Hotfix 2026-06-05** — `planningController.laundrySummary` was
      not skip-aware, so the "À apporter / À récupérer" counts on the
      next non-skipped card stayed on their pre-skip values (user
      report: *"la carte blanchisserie suivante ne change pas"*).
      Wired the skip set into the controller + added
      `utils/laundryWindow.previousNonSkippedLaundryDay` for the
      widened window math + +11 server tests pinning the contract.
- [x] Docs: CHANGELOG entry, spec status → Implemented.
