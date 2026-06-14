# Soft-delete (archive) an option — hidden everywhere new, preserved on existing reservations

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/option-soft-delete` _(user-managed)_ |
| **Created** | 2026-06-14 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Deleting an option in Réglages → Options ([OptionsPage.js](../client/src/pages/OptionsPage.js)) currently
**hard-deletes** the row (`optionsModel.remove` → `DELETE FROM options` + `DELETE FROM property_options`).
There's no guard against deleting an option that reservations already use; the `reservation_options →
options` JOIN that the reservation fiche / accounting / history rely on for the option **title** would
then resolve to nothing. The operator wants deletion to **stop offering** an option without **losing** it
on the bookings that already carry it.

Note: auto-options (`autoOptionType` set — petit-déjeuner, linge de lit/toilette, early/late check-in/out)
are **non-deletable** already (the UI disables delete via `isDeleteDisabled`). This feature only changes the
deletion of **regular** options.

## 2. Goal

Deleting an option **archives** it: it disappears from Réglages → Options and is **no longer offered for new
reservations** (admin form + public/WordPress catalog + property defaults), while **reservations that already
use it keep it intact** — visible on the fiche, the PDF, the accounting and the history, and preserved when
such a reservation is edited and saved again.

## 3. Functional rules

1. **Delete = archive (soft-delete).** `optionsModel.remove(id)` sets `options.archivedAt = datetime('now')`
   instead of deleting the row. The `options` row and all `reservation_options` rows that reference it are
   **kept**.
2. **Auto-options stay non-deletable.** An option with a non-null `autoOptionType` cannot be archived (server
   guard, mirroring the UI's `isDeleteDisabled`). Returns a clear error.
3. **Hidden from Réglages → Options.** `optionsModel.list()` excludes archived options (`archivedAt IS NULL`).
4. **Not offered for new reservations.** The option-offering lists exclude archived options:
   - `optionsModel.listForProperty()` (admin reservation form + public catalog) → `AND archivedAt IS NULL`.
5. **Removed from property defaults.** On archive, the option's `property_option_defaults` rows are deleted,
   so it is **no longer auto-added** to new reservations (admin create + devis + iCal import + public booking).
   `property_options` (applicability) rows are **kept** (see rule 7).
6. **Existing reservations keep it — display.** Every path that displays an existing reservation's option
   JOINs the (still-present) `options` row, so the title/price keep resolving: the reservation fiche
   (`getByIdWithDetails`), accounting, history, planning. **No filtering** is added on these paths.
7. **Existing reservations keep it — re-save.** The pricing engine's `getApplicableOptions` is **not**
   filtered by `archivedAt` (and the `property_options` link is kept), so when an existing reservation that
   carries an archived option is edited and re-saved, the engine still prices that line — the option is not
   silently dropped. A **new** reservation can't acquire an archived option because the UI/catalog never
   offer it (rule 4) and it is no longer a default (rule 5).
8. **Edit re-save preserves the carried option.** When a reservation that carries an archived option is
   edited and saved, the option is **kept**: it stays in `form.selectedOptions` (loaded from the
   reservation's own `options`), passes the save payload's filter (which only drops engine-derived
   `autoEnabled=1` options), and the pricing engine re-prices it (its `property_options` applicability row
   is kept). It is **not** re-listed as a toggle in the edit form's available-options catalog (that list
   excludes archived), but it remains on the fiche / PDF / accounting and is preserved on save. **No client
   change required** — verified against `buildSelectedOptionsPayload` + `getApplicableOptions`.

**Edge cases:**
- Archiving an option with **no** reservations → still archived (kept, hidden). No hard delete. (Simplicity +
  reversibility; the row is inert.)
- An option used as a property **default** and archived → the default link is dropped (rule 5); existing
  reservations that already snapshotted it keep it.
- Laundry / breakfast / linen aggregations key off `autoOptionType` / `countsAsBedLinen` — those options are
  **non-archivable** (rule 2), so those flows are unaffected.

---

## 4. Architecture

> **Fat backend, thin frontend.** Archive semantics + every "offer vs keep" decision live on the server. The
> client is mostly unchanged (its lists come pre-filtered); only the edit form must retain an already-selected
> archived option.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: `options.archivedAt TEXT` (NULL = active). |
| `models/` | `optionsModel.js` | T | `remove(id)`: guard auto-options; else `UPDATE options SET archivedAt = datetime('now')` + `DELETE FROM property_option_defaults WHERE optionId = ?` (keep `property_options` + `options` + `reservation_options`). `list()` + `listForProperty()`: add `archivedAt IS NULL`. |
| `controllers/` | `optionsController.js` | T | `remove`: surface the auto-option guard error (409/400). |
| `utils/` | `pricing.js` | — | `getApplicableOptions` **unchanged** (must still price an archived option already on a reservation — rule 7). |
| `models/` | `reservationsModel.js`, `accountingModel.js` | — | **Unchanged** — their `reservation_options → options` JOINs keep resolving the archived row (rule 6). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `OptionsPage.js` | — | No change — archived options simply stop appearing (server-filtered list). Delete button still calls `deleteOption`; auto-options stay disabled. |
| `pages/` / `components/` | `ReservationPage.js` / `ExtrasSection.js` | — | **No change** — `buildSelectedOptionsPayload` already keeps a selected option absent from the catalog (rule 8), and the server re-prices it. Not re-listed as a toggle (acceptable; it's preserved + shown on the fiche). |

**Component reuse declaration:** no new component; reuses the existing option row rendering in the extras
section.

### 4.3 API contract

No endpoint signature change. `DELETE /api/options/:id` now archives (200) or returns an error for an
auto-option. `GET /api/options` + the property/public option lists simply no longer include archived options.

---

## 5. Data model

Idempotent migration in `database.js`:

```sql
ALTER TABLE options ADD COLUMN archivedAt TEXT;   -- NULL = active; timestamp = archived (soft-deleted)
```

On archive: `property_option_defaults` rows for the option are deleted (rule 5). `property_options`,
`options`, and `reservation_options` are kept. **Data impact:** additive column; no existing row changes
until an option is archived. No loss — archiving never deletes a reservation's option.

## 6. UI / UX

- **Réglages → Options:** archived options vanish from the list (no new control). The delete action now
  archives; auto-options keep their disabled delete (tooltip unchanged).
- **Reservation form:** new reservations never see archived options in the available list. An existing
  reservation that carries an archived option is **not** re-listed as a toggle (the catalog excludes
  archived), but the option is preserved on save (rule 8) and shown on the fiche/PDF.
- **Fiche / PDF / compta / historique:** unchanged — the option's title/price still render.
- **Responsive / PageActionBar:** N/A (no new page or page-level action).

## 7. Test plan

### Server unit tests (`options-model.unit.test.js`, +3; suite 1510 green)
- [x] `remove` sets `archivedAt` (row kept, not deleted); `list()` excludes archived; `listForProperty()`
      excludes archived (not offered for new reservations); `property_option_defaults` rows are cleared;
      `property_options` (applicability) kept; archiving an `autoOptionType` option is **rejected**.
- [x] Migration is the existing idempotent `tryAddOptionColumn('archivedAt', …)`; full suite green.

### Client (vitest)
- [ ] None — no client change (rule 8: preservation is handled by the existing payload builder + engine).

### Manual UI verification
- [ ] Create option X, attach to a reservation, archive X → X gone from Réglages → Options; the reservation
      still shows X (fiche + PDF); a new reservation can't pick X.
- [ ] Edit the reservation that has X and save → X preserved.
- [ ] Archive an option that was a property default → new reservations no longer auto-include it.

## 8. Out of scope

- A "restore / unarchive" UI (the row is recoverable in DB, but no button this iteration).
- An "archived options" management view.
- Changing auto-option deletion (they stay non-deletable).
- Hard-deleting truly-unused options (everything goes through archive for safety/consistency).

## 9. Open questions

- **Q1 — archive vs hard-delete when no reservation uses it?** Proposed: **always archive** (uniform, safe,
  reversible). Alternative: hard-delete when unused — rejected for simplicity.
