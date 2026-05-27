# ReservationPage — migrate inline action bar to PageActionBar

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-page-action-bar` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 3 — Réservations & Calendar, slice **3c-1** (of 3c-1/3c-2/3c-3). See `specs/ROADMAP.md`. |

---

## 1. Context

`ReservationPage.js` renders its own **inline, `position: fixed` action bar** (~lines 1859-2053): a
hand-rolled sticky banner with a back button, title, a "tarifs actuels" chip, devis/PDF/convert
actions, Save, Cancel and Delete — the very pattern that the shared `PageActionBar` component was
modeled on (CLAUDE.md §7 names it the visual reference). Because it's `fixed`, the page also carries a
manual `mt: { xs: 10, sm: 11 }` offset on the content grid to clear the bar, and hard-codes the sidebar
width (`left/width: 240px`).

Every other page uses the shared `<PageActionBar>` (sticky, no manual offsets). ReservationPage should
too — this is slice 3c-1 of the ReservationPage refactor.

Two gaps between ReservationPage's needs and the current `PageActionBar` API:
- **Back is a handler, not a path.** ReservationPage's back/cancel call `goBackToOrigin()` (returns to
  the `from` URL or a default), whereas `PageActionBar` only supports `backTo` (a static router path).
- **One action is a non-icon node.** In devis mode the bar shows a **devis-status `<Select>`**, which
  doesn't fit `PageActionBar`'s icon-only action slots.

## 2. Goal

ReservationPage uses the shared `<PageActionBar>` for its top bar, with identical actions and behavior,
removing the bespoke fixed bar and its layout compensation. `PageActionBar` gains two small,
backward-compatible capabilities so it can host this (and future) richer bars.

## 3. Functional rules

**PageActionBar enhancements (generic, backward-compatible)**
1. **`onBack` handler.** `PageActionBar` accepts an optional `onBack` callback. When provided, the back
   IconButton calls it; `backTo` (existing path-based prop) still works when `onBack` is absent. No
   change for current consumers.
2. **Custom-node action items.** An entry in `actionsBefore`/`actionsAfter` may be `{ node: ReactNode }`
   instead of an icon descriptor; it is rendered as-is (used for the devis-status `<Select>`). Existing
   `{ icon, tooltip, onClick, … }` items are unchanged. In the mobile overflow menu, node items are
   skipped (kept inline) so the canonical Save/Cancel still collapse correctly.

**ReservationPage migration (behavior-preserving)**
3. The inline fixed bar is replaced by `<PageActionBar>` with the same actions, same conditions, same
   handlers, same tooltips/colors:
   - **Back / Cancel** → `onBack`/`onCancel` = `goBackToOrigin`.
   - **Title** = current `computedTitle`. **Subtitle** = the "Tarifs actuels appliqués (non sauvegardé)"
     chip, shown only when `useCurrentPricing`.
   - **actionsBefore** (in order, conditional as today): "Créer un devis" (info) when `!isDevisMode && !reservationId`;
     "Transformer en devis" (info) when `!isDevisMode && reservationId`; the **devis-status Select**
     (node) when `isDevisMode`; "Télécharger PDF" (info, disabled when `!editingDevisId`) when
     `isDevisMode`; "Passer en réservation" (warning) when `isDevisMode && editingDevisId`.
   - **Save** → `onSave` = `handleSaveReservation`; `saveTooltip` = "Enregistrer le devis" in devis mode
     else "Enregistrer". (Save disabled state matches today — currently always enabled; preserve.)
   - **actionsAfter**: "Supprimer" (error, disabled when `isReservationLocked`) when
     `!isDevisMode && reservationId`; "Supprimer le devis" (error) when `isDevisMode && editingDevisId`.
4. **Remove the layout compensation**: delete the `position: fixed` wrapper and the content grid's
   `mt: { xs: 10, sm: 11 }`; the sticky `PageActionBar` needs no offset and no hard-coded sidebar width.
5. **No behavior change**: every action does exactly what it did; conditions unchanged; the page still
   works identically for both reservation and devis modes.

**Edge cases:** all current conditional visibility is preserved (devis vs reservation, new vs existing,
locked reservation disables delete, PDF disabled before the devis is saved). Mobile overflow: with the
canonical Save/Cancel plus several extras, the icon extras may collapse into the "…" menu on `xs` (the
Select node stays inline) — acceptable and consistent with `PageActionBar`'s documented behavior.

---

## 4. Architecture

### 4.1 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `PageActionBar.js` | T | Add `onBack` handler support + custom-node action items (`{ node }`). Backward-compatible; JSDoc updated. |
| `pages/` | `ReservationPage.js` | T | Replace the inline fixed bar (~1859-2053) with `<PageActionBar>`; drop the `mt` offset + fixed-position wrapper. Remove now-unused imports (e.g. `ArrowBackIcon`, `SaveIcon`, `CloseIcon`) if no longer referenced. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar` | Now also consumed by ReservationPage (its original visual reference). |
| **Created** | — | No new component. |

No server, API, or data changes.

### 4.2 API contract

Unchanged.

---

## 5. Data model

No changes.

## 6. UI / UX

The top bar looks like the standard `PageActionBar` used elsewhere (sticky below the app header, white,
thin bottom border, bordered icon buttons, filled Save). Same actions, tooltips (French), colors
(info/warning/error), and disabled states as today. The devis-status Select sits among the
left/`actionsBefore` controls. Content no longer needs the manual top margin.

- **Responsive:** sticky (no fixed offset). On `xs`, title hides (as before) and surplus icon actions
  may collapse into the "…" overflow (Save/Cancel always visible); the Select stays inline.
- This **is** the `PageActionBar` migration mandated for ReservationPage.

## 7. Test plan

### Server unit tests
- [ ] N/A (client-only). Existing server suite stays green.

### Manual UI verification
- [ ] Reservation (new): bar shows Back, title "Nouvelle réservation", "Créer un devis", Save, Cancel.
      Save creates; Cancel/Back returns to origin.
- [ ] Reservation (existing): "Transformer en devis", Save, Cancel, Delete (disabled when locked).
- [ ] Devis mode (`?mode=devis`): status Select, "Télécharger PDF" (disabled until saved), Save
      ("Enregistrer le devis"); after save: PDF enabled, "Passer en réservation", "Supprimer le devis".
- [ ] "Tarifs actuels" chip appears as subtitle after using "Actualiser les tarifs".
- [ ] Content starts directly under the bar (no large gap / no overlap) on desktop and mobile.
- [ ] `0` console errors; pricing summary + form unaffected.
- [ ] Regression: other PageActionBar pages (Settings, etc.) still render fine (enhancement is additive).

## 8. Out of scope

- Extracting `PricingSummary` → slice **3c-2**.
- Splitting the form into section components → slice **3c-3**.
- `reservationConflicts` server consolidation → slice **3c-4**.
- Any change to save/devis/delete logic itself.

## 9. Open questions

- None. The Select-as-node is handled by the PageActionBar enhancement (rule 2).
