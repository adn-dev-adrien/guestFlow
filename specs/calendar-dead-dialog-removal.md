# CalendarPage — remove the dead reservation dialog

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/calendar-dead-dialog-removal` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 3 — Réservations & Calendar, slice **3b**. See `specs/ROADMAP.md`. |

---

## 1. Context

`client/src/pages/CalendarPage.js` (2274 LOC) contains a full reservation create/edit `<Dialog>`
(line ~1888) with its own form state, debounced pricing effect, option/resource setters,
`applyQuoteToForm`, capacity/baby-bed availability loaders, and an inline "create client" sub-flow.

This dialog is **dead code**: `setDialogOpen(true)` is never called. Every entry point navigates to the
`ReservationPage` route instead — `openNewReservation` → `/reservations/new`, reservation clicks →
`/reservations/:id` (confirmed in Bloc 2; see memory [[calendar-reservation-dialog-dead]]). So
`dialogOpen` is permanently `false`, the dialog never renders, and its effects (gated on `dialogOpen`)
never run. It is unreachable weight that obscures the live calendar logic.

The page also has a **separate, live** calendar-note dialog (`noteDialogOpen`, ~line 1837) and all the
live calendar rendering/navigation — these must be preserved.

## 2. Goal

Delete the unreachable reservation dialog and everything used only by it, leaving the calendar's live
behavior (rendering, navigation to ReservationPage, notes, occupied-date hints, mini strips) exactly as
is. Pure dead-code removal — no behavior change.

## 3. Functional rules

1. **Behavior-preserving.** The live calendar is unchanged: month/simplified views render, navigation
   (prev/next/today, "Ouvrir", property selector), drag-to-create still navigates to
   `/reservations/new`, clicking a reservation still navigates to `/reservations/:id`, the note dialog
   still works, occupied-date/conflict hints render as before.
2. **Remove the reservation dialog JSX** (`<Dialog open={dialogOpen} …>` block) entirely.
3. **Remove every symbol used only by that dialog** — state, refs, effects, handlers and helpers that,
   after the JSX is gone, are no longer referenced anywhere live. Candidates (each verified unused before
   removal): `dialogOpen`/`setDialogOpen`, the reservation `form`/`setForm`/`updateForm`,
   `setOptionQuantity`/`setResourceQuantity`, `applyQuoteToForm`/`applyQuoteMinNights`,
   `pricingQuoteSignature`/`pricingRequestRef`, the debounced pricing `useEffect`,
   `handleReservationPropertyChange`, `babyBedAvailability`/`loadBabyBedAvailability`,
   `loadResourcesAvailability`/`availableResources`, `propertyOptions`, `selectedProperty`,
   `editingReservationId`, the inline create-client flow (`createClientOpen`/`newClient`/its handlers),
   and any now-orphaned imports.
4. **Keep anything still referenced by live code.** If a candidate symbol is also used outside the
   dialog (e.g. by navigation, the note dialog, or calendar rendering), it stays. Determination is by
   grep-after-removal: a symbol is removed only when it has zero remaining references.
5. **No dangling references.** After removal the file must compile with no reference to a removed symbol
   and no unused-variable leftovers from the removed block.

**Edge cases:** none — removing unreachable code cannot change runtime behavior provided rule 4/5 hold.

---

## 4. Architecture

> Client-only dead-code removal. No server, no API, no data changes.

### 4.1 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `CalendarPage.js` | T | Delete the dead reservation `<Dialog>` + all symbols/effects/handlers/imports used only by it. Keep live calendar + note dialog intact. Expected: ~700–1000 LOC removed. |

No other files change. (The shared `reservationConflicts.js` and its live usage in CalendarPage stay —
its server-side consolidation is slice 3c, not here.)

### 4.2 Out of scope here

- `PageActionBar` migration for CalendarPage → deferred (additive UI change, not part of this pure
  deletion).
- `ReservationPage` component split → slice **3c**.
- `reservationConflicts.js` server consolidation → slice **3c**.

### 4.3 API contract

Unchanged. No API involved.

---

## 5. Data model

No changes.

## 6. UI / UX

No visible change. The calendar looks and behaves identically; only unreachable code is removed.

## 7. Test plan

### Server unit tests
- [ ] N/A (client-only). Existing server suite stays green.

### Manual UI verification
- [ ] `npm run dev` (or prod build) → CalendarPage compiles with **0 console errors**.
- [ ] Simplified calendar: click two dates → navigates to `/reservations/new?...` (unchanged).
- [ ] Full calendar ("Ouvrir"): renders; click an existing reservation → navigates to `/reservations/:id`.
- [ ] Property selector, month prev/next/today navigation work.
- [ ] Calendar **note** dialog (add/edit/delete a note) still works.
- [ ] Occupied-date / conflict hints and mini strips render as before.
- [ ] Mobile (`xs`): calendar renders correctly.

## 8. Out of scope

- Any behavior change, restyle, or new feature.
- PageActionBar migration, ReservationPage split, conflict-rule consolidation (other slices).

## 9. Open questions

- None. Pure deletion bounded by "remove only what is no longer referenced".
