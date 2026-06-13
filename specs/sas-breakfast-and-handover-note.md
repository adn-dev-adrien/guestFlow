# SAS breakfast page + arrival→departure handover note

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/sas-breakfast-and-handover-note` _(user-managed)_ |
| **Created** | 2026-06-13 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The arrival/departure SAS (guided check-in/check-out wizard, `specs/arrival-departure-sas.md`,
component `client/src/components/sas/ReservationSasDialog.js`) is now live. Separately, the planning
already shows a **breakfast card per day** (`client/src/components/BreakfastDayCard.js`, fed by
`server/src/models/breakfastModel.js` via `GET /api/planning/breakfast`) listing, for each morning of a
stay, the reservations that took the breakfast option with their **time** + **person count**.

Two gaps surfaced in field use:

1. When the operator does the check-in, they learn from the guests **how many hot drinks** (café / thé /
   chocolat) to prepare each morning, and often agree on the **exact breakfast hour**. Today there's no
   place in the SAS to capture this, and the breakfast card can't show it.
2. The check-in is also when the operator notes **handover instructions for the departure** (e.g. "récupérer
   la 2ᵉ clé sous le paillasson", "vérifier la cafetière"). Today that knowledge lives in the operator's head
   and is gone by check-out day.

The breakfast time is already modelled: `reservations.breakfastTime` (per-reservation override, nullable) +
`options.breakfastTime DEFAULT '09:00'` (option default), resolved in `breakfastModel` (see
`specs/breakfast-time.md`). This spec reuses that field for the editable hour.

## 2. Goal

During the **arrival SAS**, when the reservation has the breakfast option, the operator can record how many
**cafés / thés / chocolats** to prepare, adjust the **breakfast hour**, and leave a **free breakfast note** —
all of which then enrich the **planning breakfast card**. At the **end of the arrival SAS**, the operator can
leave a **free handover note** that resurfaces in the **departure SAS** and on the **departure planning card**.

## 3. Functional rules

### 3.1 Breakfast page (arrival SAS)

1. A new **`breakfast`** page appears in the **arrival SAS only**, and **only when the reservation has the
   breakfast option** applicable (same eligibility as the breakfast card: an explicit
   `reservation_options` row on a `autoOptionType='breakfast'` option with `quantity > 0`, **or** the
   property declares a breakfast default and the reservation has no explicit breakfast row). When breakfast
   is not applicable, the page is skipped.
2. The page shows, as a reminder, the **current effective breakfast time** (resolved exactly like the
   planning card: `reservations.breakfastTime` → option default → `09:00` fallback) and lets the operator
   **set a new time** (writes `reservations.breakfastTime`).
3. The page has three **quantity steppers** — **Café**, **Thé**, **Chocolat** — each a non-negative integer,
   **initial value 0** (decision 2026-06-13). They reuse the same `QtyRow` stepper pattern as the linen page.
4. The page has a **free note** text field (multiline) for breakfast-specific remarks (e.g. allergies,
   "sans gluten").
4b. **Coherence warning (rule from the user 2026-06-13):** when the operator tries to leave the breakfast
    page (« Suivant »), if the **total drinks** `café + thé + chocolat` **≠ the breakfast person count**
    (the same resolved person count shown on the breakfast card — `getSas` exposes it as `breakfast.persons`),
    show a **warning confirm** (« Le nombre de boissons (X) ne correspond pas au nombre de personnes (Y).
    Continuer quand même ? ») before advancing. It is a **soft** warning: the operator can confirm and
    proceed (some guests skip a hot drink), or cancel and adjust. A matching total advances with no prompt.
5. The breakfast counts + note + time apply to the **whole stay** (decision 2026-06-13): captured once at
   check-in, displayed on the breakfast card of **every** morning of the reservation.
6. Like every SAS field, nothing is written until the final **« Valider et terminer »** of the recap. The
   breakfast values are accumulated in client state until then.
7. The page does **not** change the breakfast option's price or person count — it only records preparation
   details. The € complement is unaffected.

### 3.2 Breakfast card enrichment (planning)

8. On the breakfast card, under each reservation row, show the **café / thé / chocolat counts** as small
   icon + label + number chips (e.g. ☕ Café 2 · 🍵 Thé 1 · 🍫 Chocolat 3).
9. **A count of 0 is not displayed** (rule from the user). If all three are 0, no counts row renders.
10. If a **breakfast note** is set, display it on the row (caption, under the counts).
11. The existing **time badge** + **person count** stay as they are; the new info is additive. The
    server keeps sorting rows by time.

### 3.3 Handover note (end of arrival SAS → departure)

12. The **recap page of the arrival SAS** gains a **free handover-note** text field ("Note pour le départ").
    It is **optional**.
13. The handover note is stored in a **dedicated column** `reservations.departureHandoverNote` (decision
    2026-06-13 — kept separate from `reservations.notes`, which is the reservation note already shown on the
    arrival card).
14. In the **departure SAS**, if `departureHandoverNote` is non-empty, it is shown **read-only** (a
    highlighted block on the intro/recap), so the operator sees the arrival-time instructions. The departure
    SAS never edits it.
15. On the **departure planning card** (`DepartureMiniRow`), if `departureHandoverNote` is non-empty, display
    it (caption block). If empty, nothing renders (no empty block).

**Edge cases:**
- Breakfast option present but party size resolves to 0 persons (e.g. only babies) → the breakfast card
  already skips it (`persons <= 0`); the SAS breakfast page still shows (operator may still prep drinks) —
  but if the card never renders, the captured counts simply have no surface. Acceptable; counts persist.
- Counts entered then breakfast option later removed from the reservation → the card stops showing the row;
  stored counts are inert. No cleanup needed.
- Negative or non-integer input → clamped to a non-negative integer at the boundary (server validates).
- Drinks total ≠ persons → soft warning confirm on « Suivant » (rule 4b); never blocks definitively.
- Breakfast `persons` resolves to 0 → the warning compares against 0; any non-zero drink total prompts
  (operator can still confirm). Acceptable.
- SAS already done (`arrivalSasDoneAt` set) → the SAS button is locked (per `specs/arrival-departure-sas.md`
  §3.0), so breakfast values are captured once. Editing later is out of scope (see §8).

---

## 4. Architecture

> **Fat backend, thin frontend.** Eligibility, time resolution, count clamping, and all persistence stay on
> the server. The client renders the SAS pages and the enriched cards, and holds the in-progress SAS state
> (local UI state until commit).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `routes/reservations.js` | — | No new route; reuses `POST /:id/sas/arrival` (extended body). |
| `controllers/` | `controllers/sasController.js` | T | `getSas`: add a `breakfast` block (`applicable`, resolved `time`, `coffee`, `tea`, `chocolate`, `note`) + `departureHandoverNote` to the payload. `commitArrival`: accept + forward the breakfast fields + handover note. |
| `models/` | `models/reservationsModel.js` | T | `commitArrivalSas`: also write `breakfastTime`, `breakfastCoffee`, `breakfastTea`, `breakfastChocolate`, `breakfastNote`, `departureHandoverNote` (clamped). `getByIdWithDetails`: surface the new columns (returned via `r.*`, incl. `departureHandoverNote`). |
| `models/` | `models/breakfastModel.js` | T | Add `res.breakfastCoffee/Tea/Chocolate`, `res.breakfastNote` to the SELECT and emit them on each item. Add `getForReservation(id)` → `{ applicable, persons, time, coffee, tea, chocolate, note }` (single-reservation eligibility + resolved time + **resolved person count** + stored counts/note) — the breakfast logic already lives here, so the SAS reuses it instead of a separate util (DRY). |
| `controllers/` | `controllers/sasController.js` | T | `getSas` calls `breakfastModel.getForReservation(id)` for the `breakfast` block; `departureHandoverNote` rides on `reservation` (`r.*`). |
| `models/` | `models/reservationsModel.js` (`list`) | — | Returns `r.*`, so `departureHandoverNote` flows to the planning departures with no query change. |
| `database.js` | `database.js` | T | Idempotent migration: add `breakfastCoffee/Tea/Chocolate INTEGER NOT NULL DEFAULT 0`, `breakfastNote TEXT`, `departureHandoverNote TEXT` to `reservations`. |

**Notes:**
- Routes stay thin. Count clamping (`Math.max(0, Math.round(n)) || 0`), eligibility, person count, and time resolution all live in the model — the client only renders and compares two server-provided numbers for the soft warning.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/sas/` | `ReservationSasDialog.js` | T | New `breakfast` step in the arrival `activeKeys` (after `options`, before `linen`); state `breakfast{coffee,tea,chocolate}`, `breakfastTime`, `breakfastNote`, `handoverNote`; render the breakfast page (time field + 3 `CountStepper`s + live hint + note) and the recap handover-note field; coherence `ConfirmDialog` on « Suivant » when total ≠ persons; read-only handover block in the departure SAS intro; include the new fields in the `commitArrivalSas` payload (breakfast fields only when applicable). New module-level `CountStepper` (icon + label + integer stepper). |
| `components/` | `BreakfastDayCard.js` | T | Render the café/thé/chocolat chips (hide zeros) + breakfast note under each row. |
| `components/` | `DepartureMiniRow.js` | T | Render the `departureHandoverNote` caption block when non-empty. |
| `api.js` | `api.js` | T | `commitArrivalSas` passes the new fields through (payload extension only). |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `QtyRow` (SAS-internal stepper), `ConfirmDialog` (coherence warning), MUI `TextField` (multiline), `Chip`, `Tooltip` | Reuse the existing SAS stepper, the existing `ConfirmDialog`, + MUI primitives. |
| **Created (new generic)** | `CountStepper` (module-level, inside `ReservationSasDialog.js`) | Icon + label + integer −/＋ stepper. Kept beside the SAS for now; promote to `components/` if a 2nd consumer appears. The breakfast-card count chips are plain inline MUI `Chip`s (no new component). |
| **Specific (kept feature-local)** | breakfast page body inside `ReservationSasDialog` | Tied to the SAS wizard's state machine; not reusable elsewhere. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/sas` | — | adds `breakfast: { applicable: bool, persons: int, time: 'HH:MM', coffee: int, tea: int, chocolate: int, note: string }` and `reservation.departureHandoverNote: string` to the existing payload | Read-only. `persons` drives the coherence warning (rule 4b). |
| POST | `/api/reservations/:id/sas/arrival` | existing body **+** `{ breakfastTime?: 'HH:MM', breakfastCoffee?: int, breakfastTea?: int, breakfastChocolate?: int, breakfastNote?: string, departureHandoverNote?: string }` | `{ ok, complementAmount }` (unchanged) | New fields optional; server clamps counts to non-negative ints. |
| GET | `/api/planning/breakfast` | (unchanged query) | each item gains `coffee, tea, chocolate, note` | Additive. |

Departure list feeding the planning gains `departureHandoverNote` on each reservation object.

---

## 5. Data model

Idempotent `ALTER TABLE` block in `server/src/database.js` (added near the existing SAS columns):

```sql
ALTER TABLE reservations ADD COLUMN breakfastCoffee     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN breakfastTea        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN breakfastChocolate  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN breakfastNote       TEXT;
ALTER TABLE reservations ADD COLUMN departureHandoverNote TEXT;
```

`breakfastTime` already exists (no change). Each `ADD COLUMN` is guarded by the existing
`if (!cols.includes(...))` idempotent pattern.

**Data impact:** purely additive. Existing reservations get counts = 0 and NULL notes — i.e. no counts/notes
rendered, identical to today's behavior. No backfill, no recompute, no risk of loss.

## 6. UI / UX

### Breakfast SAS page (arrival)
- **Title context:** « Petit déjeuner ». A reminder line « Heure prévue : 09:00 » with an editable time field
  (MUI `TextField type="time"` or the existing time input pattern) to set a new hour.
- **Three steppers** (`QtyRow`): « Café » (`LocalCafeIcon`), « Thé » (`EmojiFoodBeverageIcon`, mug + tea
  tag), « Chocolat chaud » (`FreeBreakfastIcon`, steaming mug, brown tint — it's a hot chocolate with milk
  + cocoa, **not** a chocolate bar), each `−  0  +`, min 0.
- **Free note:** multiline `TextField` « Note petit déjeuner (optionnel) ».
- **Live coherence hint:** a discreet caption near the steppers showing `total boissons / nb personnes`
  (e.g. « 3 boissons pour 2 personnes »), turning a warning color when they differ.
- Forward action « Suivant »: on mismatch (rule 4b), a `ConfirmDialog` (« … Continuer quand même ? ») gates
  the advance — confirm proceeds, cancel stays on the page. On match, advances directly.

### Recap page (arrival) — handover note
- Below the complement/caution summary, a multiline `TextField` « Note pour le départ (optionnel) ».
- Validated with the rest on « Valider et terminer ».

### Departure SAS — handover note (read-only)
- If `departureHandoverNote` is set, a highlighted block (info/amber tone) on the intro and/or recap:
  « Note laissée à l'arrivée : … ». No edit control.

### Breakfast planning card
- Under each row's existing `time · property · client · N petits déjeuners`, a wrap row of count chips:
  `Café 2` (`LocalCafeIcon`), `Thé 1` (`EmojiFoodBeverageIcon`), `Chocolat chaud 3` (`FreeBreakfastIcon`) —
  **zeros omitted**. Below, the breakfast note as a caption if set.

### Departure planning card
- When `departureHandoverNote` is non-empty, a caption block under the client name (consistent with the
  existing alert/explanation caption styling). Nothing when empty.

**Responsive behavior:**
- SAS dialog already `fullScreen` on `xs`; the breakfast page stacks the time field, the three steppers, and
  the note vertically with full-width controls. Steppers keep ≥44px touch targets.
- Breakfast card count chips wrap (`flexWrap`) on narrow cells; chips shrink before truncating.
- Departure card note caption wraps; no horizontal scroll on `xs`.

**Sticky action bar:** N/A — these are dialog pages and planning cards, not full pages. The SAS dialog keeps
its existing « Quitter » + page-specific forward buttons.

## 7. Test plan

### Server unit tests (`cd server && npm test` → 1487 green)
- [x] `tests/breakfast-model.unit.test.js` (extend) — `getForReservation`: applicable via explicit option /
      via property default / not applicable; effective-time resolution (reservation override → option
      default → fallback) + resolved person count. Breakfast items carry `coffee/tea/chocolate/note`.
      (The eligibility/time logic stayed in `breakfastModel`, not a separate util — see §4.1.)
- [x] `tests/sas-commit.unit.test.js` (extend) — `commitArrivalSas` writes `breakfastTime`, the three
      counts (clamped: negatives/floats → non-negative int), `breakfastNote`, `departureHandoverNote`;
      counts default 0 / notes null when omitted; `breakfastTime` untouched when not passed.

### Client IHM tests (vitest → 436 green)
- [x] `ReservationSasDialog.test.js` (extend) — breakfast page shows only when `breakfast.applicable`;
      steppers + note + time feed the `commitArrivalSas` payload; **mismatch total ≠ persons triggers the
      confirm before advancing; matching total advances with no prompt**; recap handover note feeds the
      payload; departure SAS renders the read-only handover block when set.
- [x] `BreakfastDayCard.test.js` — count chips render, **zeros hidden**, note shown when set.
- [x] `DepartureMiniRow.test.js` (extend) — handover-note caption renders when set, absent when empty.

### Manual UI verification
- [ ] **Not run live this session** — the dev server is owned by the user (ports taken). Build is green
      (`vite build` ok) and the IHM/unit tests cover the flows; a live pass is recommended before release.
- [ ] Happy path: check-in a reservation with breakfast → set 09:30, café 2 / thé 0 / choco 1, breakfast
      note, handover note → validate → breakfast card shows 09:30 + Café 2 + Chocolat chaud 1 + note (no
      thé), departure card shows the handover note, departure SAS shows the read-only block.
- [ ] Edge: reservation without breakfast option → no breakfast page in the SAS.
- [ ] Mobile (`xs`): breakfast page stacked, chips wrap.

## 8. Out of scope

- Editing breakfast counts / note / handover note **after** the SAS is completed (the SAS button locks).
  A later edit path (e.g. from the reservation page) is a separate spec if needed.
- Per-morning **different** counts (counts are per-stay, shown on every morning).
- Distinguishing who (which guest) takes which drink.
- Any change to breakfast pricing or person-count math.
- A departure-SAS-authored note (the handover note is authored at arrival only).

## 9. Open questions

(Resolved before Approved.)
- Q: Café/thé/chocolat initial values? → **A (2026-06-13):** start at 0.
- Q: Handover note storage — dedicated column or reuse `reservations.notes`? → **A (2026-06-13):** dedicated
  column `departureHandoverNote`.
- Q: Scope of breakfast counts/note? → **A (2026-06-13):** whole stay, shown on every morning.
- Q: Exact icons for café/thé/chocolat? → **A (2026-06-13):** Café `LocalCafeIcon`, Thé
  `EmojiFoodBeverageIcon` (mug + tea tag), **Chocolat chaud** `FreeBreakfastIcon` (steaming mug, brown
  tint) — it is a hot chocolate (milk + cocoa), not a chocolate bar.
