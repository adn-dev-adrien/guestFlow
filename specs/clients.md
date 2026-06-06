# Clients — MVC refactor + single-phone simplification

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/clients` _(Claude-managed)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 1 — Clients & Resources (spec 1 of 2: Clients). See `specs/ROADMAP.md`. |

---

## 1. Context

`routes/clients.js` (275 LOC) holds all client logic inline: list/search, get, create, update, delete
(with force cascade), `delete-impact`, `cleanup-orphans`, normalization (`sentenceCase`) and phone
handling. There is no `clientsController` / `clientsModel` (recognized MVC debt). Validation already lives
in `utils/clientValidation.js`.

**Phones today** are stored two ways: a JSON column `clients.phoneNumbers TEXT '[]'` (a list, surfaced in
the UI as add/remove multiple numbers) **and** a scalar `clients.phone` (the "main" number, kept in sync
with the first list entry and used in search). In practice a client has a single number: of the current
10 clients, **0 have more than one**. A phone number carries no metadata of its own, so the multi-number
machinery (JSON + a would-be pivot table) is over-engineering. **Decision: collapse to a single `phone`
per client** (the existing `clients.phone` column); drop the `phoneNumbers` JSON column and the
multi-phone UI.

**Deletion** already cascades correctly via SQLite foreign keys (`foreign_keys = ON`):
`reservations.clientId` and `devis.clientId` are `ON DELETE CASCADE`; reservation/devis child tables
cascade from their parents. Deleting a client removes its reservations + devis + their children with no
orphans, so the code's explicit `DELETE FROM reservations WHERE clientId` is redundant. **Gaps:** the
`delete-impact` endpoint and the force-delete `409` only consider **reservations** — a client with **only
devis** is deleted silently and devis are never shown in the impact screen.

**Thin-frontend violations in `ClientsPage.js` (508 LOC):** it sorts the impacted reservations by
date-proximity ([L44-55](../client/src/pages/ClientsPage.js#L44-L55)) and computes nights
([L287](../client/src/pages/ClientsPage.js#L287)) client-side — display shaping that belongs server-side.

**Multi-phone consumers to simplify:** `ClientFormFields.js` (add/remove phones), `ClientsPage.js`,
`ReservationPage.js` (the inline "create client" dialog), and the devis PDF (`devis.js:984` parses
`client.phoneNumbers`).

## 2. Goal

Make the client domain a clean thin-route → controller → model stack, store a **single phone** per client,
and have the deletion impact (reservations **and** devis, ready-to-render) computed by the server — the
page only renders. The only user-visible change is the client form having one phone field instead of a
list.

## 3. Functional rules

1. **MVC.** `routes/clients.js` becomes thin (parse → controller → respond). Orchestration in
   `clientsController`, all DB access + shaping in `clientsModel`. Validation reuses `clientValidation`;
   normalization (`sentenceCase`, computed `address`) moves into the model/controller.
2. **Single phone.** A client has one `phone` (string, the existing column). The `phoneNumbers` JSON
   column is removed. The API exposes `phone` only — **no `phoneNumbers`** anymore.
3. **Create/Update** validate (reject bad email/phone with `400`), normalize text, write the row. `phone`
   is trimmed; blank is allowed (optional field).
4. **Search** matches name/email/address **and** `phone` (already a column — `phone LIKE`), ordered by
   `lastName, firstName`. (No join needed.)
5. **Delete impact (server-shaped).** `GET /clients/:id/delete-impact` returns the client plus **both**
   `reservations` and `devis` it will cascade-delete, each **already sorted** (most relevant first), each
   reservation carrying a computed `nights` and each devis its number/dates/total — so the page renders
   as-is. Counts included.
6. **Delete + force.** `DELETE /clients/:id` returns `409 CLIENT_IN_USE` (with the impact payload) when
   the client has **reservations or devis**. `?force=true` deletes the client — the FK cascade removes its
   reservations, devis and all their children (no manual child deletes; the redundant explicit reservation
   delete is dropped). Force deletes everything (reservations + devis).
7. **Cleanup orphans** unchanged in behavior: delete clients with **no** reservations **and no** devis;
   report `deletedCount` + `keptWithDevisCount`. Logic moves into the model.
8. **Selective cleanup popup (added 2026-06-06).** Clicking **Cleanup clients** no longer deletes
   immediately. The page fetches the orphan list (clients with no reservation **and** no devis), opens a
   popup listing one row per client (last name + first name + email + phone) with a **checkbox checked by
   default** on each row, plus a "Tout cocher / décocher" master toggle. Two actions:
   - **Annuler** — close the popup, no DB change.
   - **Supprimer** — call the delete-by-ids endpoint with the currently-checked ids. Disabled when zero
     rows are checked.

   After a successful delete the popup closes, the client list reloads, and a toast/alert reports
   `deletedCount` + (if any) `skippedCount` (orphans that gained a reservation between preview and
   delete — the server re-validates each id and silently skips non-orphans to avoid a race).

   The pre-existing bulk `POST /clients/cleanup-orphans` stays for headless / programmatic callers but
   is no longer called by the UI.
9. **`ClientsPage` + `ClientFormFields` render only / single field.** `ClientFormFields` shows one phone
   `TextField` (remove add/remove list). `ClientsPage` drops the client-side reservation sort + nights
   math and consumes the server-shaped `delete-impact` (reservations + devis); the delete dialog also
   lists the impacted **devis**.

**Edge cases:**
- Client with only devis (no reservations) → `409` now also triggers (was silently deleted); impact shows
  the devis. Force deletes them.
- Client with no phone → `phone: ''`.
- **Prod multi-number clients:** the migration reads `phoneNumbers` and keeps the **first** non-blank
  number in `phone`; the remaining numbers are **discarded** (per decision). Locally 0/10 clients are
  affected, but the rule runs in every environment (prod may have multi-number clients).

---

## 4. Architecture

> **Fat backend, thin frontend.** All shaping (impact sorting, nights, normalization) is server-side. The
> page renders ready-to-use payloads. Single-phone removes list machinery on both sides.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `clients.js` | T | Thin: parse → call `clientsController` → respond. No SQL/logic left. |
| `controllers/` | `clientsController.js` | C | Orchestrates list/get/create/update/delete/force/delete-impact/cleanup; validation + normalization wiring; HTTP statuses (`400`, `404`, `409 CLIENT_IN_USE`). **2026-06-06:** also exposes `cleanupOrphansPreview` (list-only) + `cleanupOrphansDelete` (by-ids, with per-id re-validation). |
| `models/` | `clientsModel.js` | C | All DB access: client CRUD (single `phone`), search, impact aggregation (reservations + devis, sorted, with `nights`), orphan cleanup. **2026-06-06:** adds `listOrphans()` (server-sorted by lastName/firstName) + `cleanupOrphansByIds(ids)` (deletes only ids that are still orphan; returns `{ deletedCount, skippedCount }`). Returns API-shaped objects. |
| `utils/` | `clientValidation.js` | T | Simplify to a single `phone` (keep `isValidEmail`/`isValidPhone`; `validateClientPayload` validates one phone). |
| `utils/` | `textFormatters.js` | — | Reused (`sentenceCase`). |
| `utils/` | `clientPhoneMigration.js` | C | Pure, unit-tested migration helper (`migrateClientPhonesToSingle(db)`): keep the first `phoneNumbers` entry in `phone`, drop the column; idempotent. |
| `database.js` | `database.js` | T | Drops `phoneNumbers` from the `clients` `CREATE TABLE`; calls `migrateClientPhonesToSingle(db)` on boot. |
| `routes/` | `devis.js` | T | PDF: use `client.phone` instead of parsing the removed `phoneNumbers`. |

**Notes:** routes thin; model functions unit-testable. No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `ClientFormFields.js` | T | One phone `TextField` (remove the add/remove multi-phone list + per-row errors). |
| `pages/` | `ClientsPage.js` | T | Single-phone form state/validation/display; remove the client-side reservation sort + nights math; both the in-form reservations list **and** the delete dialog consume the server-shaped `delete-impact` (reservations sorted + `nights`, plus devis). **2026-06-06:** wires the existing **Cleanup clients** button to fetch the preview and open `<ClientCleanupDialog>` instead of bulk-deleting. |
| `pages/` | `ReservationPage.js` | T | Inline "create client" dialog: single `phone` (drop `phoneNumbers` from `EMPTY_CLIENT` + payload). |
| `components/` | `ClientCleanupDialog.js` | C | **NEW (2026-06-06):** focused dialog showing the orphan list with per-row checkboxes (default checked) + master toggle + Annuler / Supprimer. Calls the delete-by-ids API on confirm, surfaces deleted/skipped counts. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `FormDialog`, `ConfirmDialog`, `ClientFormFields`, the existing list scaffold ClientsPage uses | Reused. `ClientFormFields` is simplified, not replaced. `ClientCleanupDialog` wraps `FormDialog`. |
| **Created (new generic)** | `ClientCleanupDialog` _(2026-06-06)_ | Tied to the orphan-list semantics (a checklist popup over a domain-specific endpoint). Kept page-specific for now; if a second "select-then-delete" flow appears, factor a generic `ChecklistDeleteDialog`. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/clients?q=` | — | `[client]` (`phone` string) | Search incl. phone. |
| GET | `/clients/:id` | — | `client` | `404` if missing. |
| GET | `/clients/:id/delete-impact` | — | `{ client, reservationsCount, reservations[], devisCount, devis[] }` | Sorted; reservations carry `nights`. |
| POST | `/clients` | client body (`phone`) | created `client` | `400` on invalid email/phone. |
| PUT | `/clients/:id` | client body (`phone`) | updated `client` | `400` / `404`. |
| DELETE | `/clients/:id?force=` | — | `{ ok }` or `409 CLIENT_IN_USE` (+impact) | Force cascades reservations + devis. |
| POST | `/clients/cleanup-orphans` | — | `{ ok, deletedCount, keptWithDevisCount }` | Bulk delete-all (kept for back-compat / headless callers — UI no longer uses it). |
| GET | `/clients/cleanup-orphans/preview` | — | `{ orphans: [{ id, firstName, lastName, email, phone }] }` | _(NEW 2026-06-06)_ Server-sorted by `lastName, firstName`. Same orphan filter as the bulk endpoint. |
| POST | `/clients/cleanup-orphans/delete` | `{ ids: number[] }` | `{ ok, deletedCount, skippedCount }` | _(NEW 2026-06-06)_ Re-validates each id is still orphan; non-orphans counted in `skippedCount`. `400` on missing/empty/non-numeric `ids`. |

**Breaking change (internal):** responses drop `phoneNumbers`; requests accept `phone` (a sent
`phoneNumbers` is ignored). All in-repo consumers are updated in this same PR (no shim).

Auth: all under the global `requireAuth` guard (unchanged).

---

## 5. Data model

No new table. The `phone` column already exists and is populated for every client.

**Migration (idempotent, in `database.js`), guarded by `phoneNumbers` column existence:**
1. **Migrate phones from JSON → column.** For every client, parse the `phoneNumbers` JSON; if it has at
   least one non-blank entry, set `phone` to that **first** entry (the remaining numbers are kept only in
   the JSON, i.e. discarded at step 2). This is the explicit prod case: a client with several contact
   numbers keeps the 1st in `phone`, the rest are dropped. Clients with empty `phoneNumbers` keep their
   existing `phone`.
2. `ALTER TABLE clients DROP COLUMN phoneNumbers` — discards any leftover numbers along with the column.

The migration block is wrapped so step 1+2 only run while the `phoneNumbers` column still exists; on
later boots the column is gone and the block is a no-op (idempotent).

**Data impact:** locally none (0/10 clients have >1 number; all have `phone` set). In prod, multi-number
clients lose all but the first number — intended. Documented as a `Migration` note in `CHANGELOG.md`. The
drop is irreversible.

## 6. UI / UX

- **Client form (`ClientFormFields`):** a single **Téléphone** field replaces the multi-number list
  (no "+ ajouter un numéro" / remove buttons). Same email/address/notes fields. French copy unchanged.
- **Clients list:** shows the single phone (already the case for the main number).
- **Delete confirmation dialog:** now lists impacted **reservations** _and_ **devis** (counts + rows),
  server-sorted, reservations showing `nights`; force-delete copy reflects that both are removed.
- **Cleanup orphans (2026-06-06):** clicking **Cleanup clients** opens `<ClientCleanupDialog>`:
  - Title: "Nettoyer la base clients".
  - Subtitle (caption): "Sélectionne les clients à supprimer. Seuls les clients sans réservation ni
    devis apparaissent ici."
  - Empty state: "Aucun client à supprimer — tous les clients ont au moins une réservation ou un devis."
  - List: one row per orphan, layout `[checkbox] Nom Prénom · email · phone`. Master "Tout cocher /
    décocher" above the list reflects the current selection (indeterminate when mixed).
  - Footer: **Annuler** (text button) + **Supprimer (N)** (filled error-coloured button; disabled when
    `N === 0`, busy spinner while deleting).
  - After success: dialog closes, list reloads, an info dialog reports
    `"X client(s) supprimé(s)"` and — only if `skippedCount > 0` — appends `" · Y client(s) ignoré(s)
    car ils ont gagné une réservation entre-temps."`.
  - **Mobile (`xs`):** `FormDialog` `fullScreen`; rows stack with the checkbox left + label wrapping;
    the master toggle stays at the top.
- **Responsive:** unchanged; one fewer dynamic list to stack on `xs`.

## 7. Test plan

### Server unit tests
- [x] `tests/clients-model.unit.test.js` — create/update with single `phone` + normalization; search by
      phone/name/email; delete-impact shaping (reservations sorted + `nights`, devis included);
      cleanup-orphans keeps devis-only clients.
- [x] `tests/clients-controller.unit.test.js` — `400` invalid email; `404`; `409 CLIENT_IN_USE`
      when reservations **or** devis exist; `force` deletes; success shapes (no `phoneNumbers`).
- [x] `tests/client-phone-migration.unit.test.js` — `phoneNumbers: ["A","B"]` → `phone = "A"`, extras
      discarded, column dropped; empty `phoneNumbers` keeps existing `phone`; idempotent on re-run.
- [ ] **NEW (2026-06-06)** `tests/clients-cleanup-orphans.unit.test.js` — model + controller:
      - `listOrphans()` returns only clients with **no reservation and no devis**, sorted
        `lastName, firstName`, with the right columns.
      - `cleanupOrphansByIds([])` → `{ deletedCount: 0, skippedCount: 0 }`, no DB write.
      - `cleanupOrphansByIds([orphanA, withReservation])` → orphanA deleted,
        withReservation skipped; counts match.
      - `cleanupOrphansByIds([orphanA, withDevis])` → orphanA deleted, withDevis skipped (devis-linked
        clients are protected).
      - `cleanupOrphansByIds([42_unknown])` → `skippedCount: 1`, no error.
      - Controller `GET /cleanup-orphans/preview` returns the orphan array (no count noise).
      - Controller `POST /cleanup-orphans/delete` with `ids: []` → `400 INVALID_IDS`.
      - Controller `POST /cleanup-orphans/delete` with `ids: ['x']` → `400 INVALID_IDS`.
      - Controller happy path returns `{ ok, deletedCount, skippedCount }`.
- [x] Full server suite green (**274** + delta from the new cases).

### Client unit tests (Vitest)
- [ ] **NEW (2026-06-06)** `client/src/components/__tests__/ClientCleanupDialog.test.jsx`:
      - Empty list → renders the empty-state message + a disabled **Supprimer** button.
      - 3 orphans → 3 checkboxes all checked, master toggle checked, **Supprimer (3)**.
      - Uncheck one row → master toggle goes indeterminate, **Supprimer (2)**.
      - Click master "Tout décocher" → all rows uncheck, **Supprimer** disabled.
      - Click **Annuler** → calls `onClose`, never calls the delete API.
      - Click **Supprimer** with 2 selected → calls `onConfirm(selectedIds)` with the two ids only.

### Manual UI verification (in browser)
- [x] "Nouveau client" form shows a single **Téléphone** field (no add/remove); `0` console errors.
- [x] Delete-impact dialog for a client with reservations **and** devis lists **both** sections
      ("Réservations qui seront supprimées (3)" + "Devis qui seront supprimés (1)").
- [x] Clean `CI=true` client build.
- [ ] Force-delete end-to-end + devis PDF phone + mobile (`xs`) — not exercised to avoid mutating data;
      left for the user's pass.

## 8. Out of scope

- **Resources / ResourceBookings** refactor → Bloc 1 spec 2 (`specs/resources.md`).
- Any change to reservation/devis behavior beyond the cascade already in place.
- `propertyIds` JSON normalization (a Resources concern).

## 9. Open questions

- Q: Drop the `phoneNumbers` column now? — A (proposed): **yes**, after migrating the first number into
  `phone` (prod multi-number clients keep the 1st, lose the rest — per decision). Confirm at spec
  validation. **Resolved 2026-05-28: dropped.**

### Resolved (2026-06-06)
- Q: Cleanup popup scope — devis-linked clients listed or hidden?
  **A: hidden.** Same filter as the bulk endpoint (no reservation **and** no devis). Devis-linked clients
  stay protected, the popup stays small and predictable.
- Q: Delete strategy — N×`DELETE /clients/:id` or a new batch endpoint?
  **A: new batch endpoint `POST /clients/cleanup-orphans/delete`** with `ids: number[]`. One round-trip,
  transactional, server re-validates each id (race-safe).
- Q: Preview surface — new GET endpoint or repurpose the existing POST?
  **A: new `GET /clients/cleanup-orphans/preview`.** The bulk POST keeps its semantics (kept for
  back-compat / headless callers).
