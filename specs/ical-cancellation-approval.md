# iCal sync — Dashboard approval for reservation cancellations

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/ical-cancellation-approval` |
| **Created** | 2026-06-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Today, the iCal sync engine **auto-deletes** any reservation whose source UID is no longer
present in the incoming feed. The logic sits in `syncSource()` (see
[propertyIcalModel.syncSource](server/src/models/propertyIcalModel.js#L360-L374)):

```js
const staleMappings = listMappings.all(source.id).filter((row) => !seenUids.has(row.eventUid));
staleMappings.forEach((row) => {
  deleteMapping.run(source.id, row.eventUid);
  if (countMappingsForReservation.get(row.reservationId).c === 0) {
    deleteReservation.run(row.reservationId);
    removedCount += 1;
  }
});
```

A few observations on the live behavior:

1. **The parser already filters `STATUS:CANCELLED` events at parse time**
   ([icalParser.js:213](server/src/utils/icalParser.js#L213)), so a cancelled booking falls
   out of `seenUids` even when the platform leaves it in the feed under a CANCELLED status.
2. **The auto-delete path does NOT honour `icalSyncLocked`** — it deletes regardless of
   whether the user has manually edited the reservation. That is the safety problem Adrien
   ran into for date drifts (separate spec
   [ical-sync-override-locked-dates.md](specs/ical-sync-override-locked-dates.md)), and
   it applies here too: a user-edited reservation can silently vanish if the platform
   drops the UID for any reason (re-issued UID + new event, transient feed glitch, the
   user cancelled and un-cancelled on the platform, etc.).
3. **Cross-platform mappings** (the same booking imported from two iCal sources) keep the
   reservation alive until BOTH feeds drop it — that part of the algorithm stays correct
   and we preserve it.

Adrien's request is symmetric with the date-drift approval flow shipped in
PR #104: **stop auto-deleting**, record a pending cancellation event, and surface it on
the Dashboard so the user explicitly approves the deletion, opens the reservation file
for review, or ignores the proposal. The platform-side cancellation is treated as a
*proposal* — not a command.

Per the discussion (2026-06-03):
- **Soft approval applies to every iCal reservation** (locked or not). No more silent
  auto-deletion. This is the symmetric counterpart to the date-drift flow.
- **Auto-resolve** — if the reservation reappears in the feed before the user reacts, the
  pending alert is deleted silently (the platform is the source of truth; once it
  re-confirms the booking we drop the proposal).

## 2. Goal

When an iCal sync detects that a previously-imported reservation has disappeared from the
feed, the engine **stops auto-deleting it** and instead records one **pending cancellation
approval**. The Dashboard surfaces an orange alert (matching the date-drift visual
language) listing every pending cancellation, with three actions per card:

- **Supprimer** — actually deletes the reservation + cleans up its iCal mapping(s).
- **Voir la fiche** — opens the reservation page without acknowledging the alert.
- **✕** (top-right) — ignores the proposal; the reservation stays.

The user remains in control of every cancellation, and the data is preserved until they
explicitly approve. Cross-platform shared reservations keep the existing protection: a
cancellation proposal is recorded only when ALL the reservation's iCal mappings have
dropped the UID.

## 3. Functional rules

1. **Detection (sync side).** During the existing stale-cleanup pass in `syncSource()`,
   when a mapping is found whose `eventUid` is no longer in `seenUids`:
   - Drop **this source's** mapping row from `ical_import_events` (same as today).
   - If at least one OTHER source's mapping still references the reservation
     (`COUNT(*) > 0` in `ical_import_events`) → the reservation stays alive (existing
     cross-platform behavior). **No cancellation alert recorded** — the booking is still
     held active by another platform.
   - If no other mapping remains AND the reservation still exists → record a pending
     cancellation in `ical_cancellation_alerts` (rule 2) and **DO NOT delete the
     reservation**.
   - If no other mapping remains AND the reservation has already been deleted (e.g. by a
     previous manual user action between syncs) → idempotent no-op.
2. **Recording a pending cancellation.**
   - Insert (or UPDATE-by-reservation — see rule 3) one row in the new
     `ical_cancellation_alerts` table with:
     - `reservationId` — the orphan reservation.
     - `sourceId` — the iCal source that dropped the UID (informational; used to refresh
       the proposal if a NEW source drops the same reservation later).
     - `eventUid` — the dropped UID (informational; supports auto-resolve when the SAME
       UID reappears in any source).
     - `detectedAt` — `datetime('now')`.
     - `acknowledgedAt` — `NULL`, `outcome` — `NULL` (pending).
3. **One pending cancellation per reservation at a time.** If a pending row already
   exists for the same `reservationId`, **UPDATE** its `sourceId` + `eventUid` +
   `detectedAt` with the latest values. Avoids duplicate alerts when multiple sources
   drop the same reservation across syncs.
4. **Auto-resolve on reappearance.** At the top of every `syncSource()` call, before the
   per-event loop runs, for every event in `seenUids` whose `(sourceId, eventUid)`
   matches a pending `ical_cancellation_alerts` row, the row is **DELETED** (not flipped
   to acknowledged — the alert is treated as moot, not as user-accepted). The Dashboard
   alert reload then no longer surfaces it. Logged once per auto-resolved event.
5. **Approve action** (`POST /api/dashboard/ical-cancellation/:id/approve`):
   - Atomic transaction:
     1. Load the cancellation row. 404 if missing, 409 if already acknowledged.
     2. Look up the reservation; if it no longer exists, set `acknowledgedAt` +
        `outcome = 'reservation_gone'` and return 200 (idempotent shape — user already
        got what they wanted).
     3. Delete every `ical_import_events` row pointing to the reservation (so the
        mapping doesn't resurrect on next sync if the platform re-issues a same-named
        booking — that would create a NEW reservation, not the deleted one).
     4. Insert a `reservation_history` audit entry of type `delete` with `changedFields`
        = `[{ field: 'icalCancellationApproved', label: 'Origine', from: null, to:
        'Suppression iCal approuvée' }]`.
     5. `DELETE FROM reservations WHERE id = ?`.
     6. Mark the cancellation row `acknowledgedAt = datetime('now')`,
        `outcome = 'approved'`.
   - Cleanup orphan client rows happens through the existing
     [propertyIcalModel cleanup pass](server/src/models/propertyIcalModel.js#L378) on the
     next sync — no separate cleanup here.
6. **Reject action** (`POST /api/dashboard/ical-cancellation/:id/reject`):
   - Load the row. 404 if missing, 409 if already acknowledged.
   - Mark `acknowledgedAt = datetime('now')`, `outcome = 'rejected'`.
   - **The reservation stays. The iCal mappings stay dropped** (that already happened
     during the sync — we don't restore them). Effect: the reservation becomes a
     "detached" iCal-origin reservation. The user can still edit it manually; future
     syncs of the same source will NOT recreate it (it has no mapping any more). If the
     SAME UID reappears in any source, the auto-resolve in rule 4 won't trigger because
     the row was already acknowledged. **Trade-off** documented in §8 — manageable
     because rejecting a cancellation is rare (the user is keeping a known-cancelled
     booking on purpose).
7. **No protection by `icalSyncLocked`.** Both locked and unlocked iCal reservations
   trigger a soft cancellation proposal. The auto-delete branch in the engine is
   removed entirely (rule 1 supersedes it). Symmetric with the date-drift flow.
8. **`removedCount` semantics.** The sync result's `removedCount` is **renamed in spirit**
   to `cancellationsProposedCount` — but for backward compatibility of the existing
   logging + Telegram-style status messages, we keep the `removedCount` key with a new
   meaning: "number of cancellation alerts CREATED/UPDATED this sync". The
   user-facing status string (line ~413 of `propertyIcalModel.js`) is reworded to
   `${result.removedCount} annulation(s) à valider`.
9. **Idempotency.** Re-running the sync on a feed that already triggered a pending
   cancellation leaves the existing pending row untouched (`detectedAt` refresh
   suppressed when nothing changed — rule 3 only updates when `sourceId`/`eventUid`
   actually differ, OR every Nth sync as a heartbeat, TBD; for v1 we keep refresh
   minimal).
10. **Cross-platform survival.** A reservation referenced by two iCal sources stays alive
    + no alert until BOTH sources drop the UID. That existing logic is reused unchanged
    in rule 1.
11. **History audit.** Every approve emits a `reservation_history` row before the
    `DELETE`. The deletion CASCADE will preserve the history row only if the schema is
    set up for it; existing FKs already preserve history beyond reservation lifetime via
    a "soft" foreign key (no ON DELETE CASCADE on `reservation_history.reservationId`).
12. **Single PR, no follow-up split.** Sync detection + cancellation table + Dashboard
    alert + approve/reject endpoints ship together.

**Edge cases:**
- **The same UID disappears AND a new UID at the same dates/name appears in the same
  source** → today's per-source fallback path
  ([listSourceReservationsByDates](server/src/models/propertyIcalModel.js#L168))
  catches the new UID + same dates and remaps it to the existing reservation. No
  cancellation alert is raised in that case because the per-event loop runs BEFORE the
  stale cleanup; by the time the stale cleanup looks at the old UID, the mapping has
  already been re-keyed to the new UID via `upsertMapping` and `previousUid` cleanup.
  Documented in §3 rule 1's "if no other mapping remains" check — this is the same
  protection.
- **The reservation has been opened+saved** (`icalSyncLocked = 1`) → soft cancellation
  applies (rule 7). The reservation stays until the user approves.
- **The reservation has been manually deleted between syncs** → rule 1's existence check
  short-circuits the alert (the row in `ical_import_events` is the only remaining
  trace; we drop it without creating an alert).
- **The user approves the cancellation, then the platform un-cancels** (re-includes the
  UID in the next feed) → the reservation has been DELETED + the mapping has been
  DELETED. The next sync sees a fresh UID with no mapping → falls into the standard
  "create new reservation" path. The cross-platform fallback by (dates + name) does NOT
  resurrect the OLD reservation (it's gone), so a NEW reservation is created with the
  same details. Documented as acceptable: the user explicitly chose to delete, so the
  platform un-cancel produces a fresh booking.
- **The user rejects the cancellation, then the platform un-cancels** → the existing
  mapping has been dropped (sync removed it before the alert was recorded). Next sync
  sees the re-appearing UID with no mapping → creates a new reservation, leaving the
  old "detached" one in place. Result: two duplicate reservations. **Mitigation**: the
  cross-platform fallback by (dates + name) DOES match the old reservation in step 2 of
  `syncSource()`, so the new event is re-mapped to the existing reservation — no
  duplicate. Documented in §8 as the reason rejecting a cancellation is safe for the
  common case (Airbnb / iCal-OTA / most Booking flows that keep dates + name stable).
- **Many cancellations in one sync** → the Dashboard alert lists all of them; no cap in
  v1.

---

## 4. Architecture

### 4.1 Server side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | [routes/dashboard.js](server/src/routes/dashboard.js) | T | Mounts 3 new routes: `GET /ical-cancellation`, `POST /ical-cancellation/:id/approve`, `POST /ical-cancellation/:id/reject`. |
| `controllers/` | [controllers/dashboardController.js](server/src/controllers/dashboardController.js) | T | Adds `icalCancellation(req,res)`, `approveIcalCancellation(req,res)`, `rejectIcalCancellation(req,res)`. Same shape pattern as the date-drift trio. |
| `models/` | `models/icalCancellationModel.js` | C | `recordPending({reservationId, sourceId, eventUid})` (UPSERT per reservation), `resolveOnReappearance(sourceId, eventUid)` (auto-cancel pending rows), `listPending()` (joined payload), `approve(id)` (atomic delete + history + ack), `reject(id)` (ack only). All write paths inside SQL transactions. |
| `models/` | [models/propertyIcalModel.js](server/src/models/propertyIcalModel.js) | T | `syncSource()` extended at two points: (a) before the per-event loop, call `cancellationModel.resolveOnReappearance` for each `(sourceId, eventUid)` in the incoming feed; (b) replace the auto-delete branch with a `recordPending` call when the reservation has no remaining mappings. |
| `database.js` | [database.js](server/src/database.js) | T | New idempotent block: `CREATE TABLE IF NOT EXISTS ical_cancellation_alerts(...)` + partial index on `(acknowledgedAt) WHERE acknowledgedAt IS NULL`. |

**Notes:**
- The auto-resolve pass (rule 4) is a single batched SQL `DELETE FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL AND (sourceId, eventUid) IN (?, ?, …)` to keep the cost O(1 per event) without N+1 prepares.
- The new cancellation row + dropped mapping commit inside the same `syncTx` transaction
  as the rest of the sync.
- No new dependencies.

### 4.2 Client side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | [pages/Dashboard.js](client/src/pages/Dashboard.js) | T | Mounts `<IcalCancellationAlert />` right after `<IcalDateDriftAlert />`. |
| `components/` | `components/IcalCancellationAlert.js` | C | Self-fetching component mirroring `IcalDateDriftAlert`. Renders orange `<Alert>` per pending cancellation with Supprimer + Voir la fiche + ✕ buttons. |
| `api.js` | [client/src/api.js](client/src/api.js) | T | `getIcalCancellationAlert()`, `approveIcalCancellation(id)`, `rejectIcalCancellation(id)`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Alert`, `AlertTitle`, `Box`, `Typography`, `Button`, `IconButton`, `Divider`. | Standard reuse. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `IcalCancellationAlert.js` | Tightly coupled to the cancellation payload + delete-or-ignore action set. Distinct enough from `IcalDateDriftAlert` (different visual + different action set) that a shared `<DashboardApprovalCard>` extraction is premature — would force both cards into a leaky abstraction. If a THIRD similar card lands (e.g. iCal new-UID alerts), we extract then. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/dashboard/ical-cancellation` | — | `{ alerts: [{ id, reservationId, clientName, propertyName, startDate, endDate, sourceName, detectedAt, reservationExists }] }` | Sorted by `detectedAt DESC`. Only unacknowledged rows. `reservationExists` drives the disabled state of the Supprimer button. |
| POST | `/api/dashboard/ical-cancellation/:id/approve` | — | `{ ok: true }` | Deletes the reservation; 409 on already-acknowledged, 404 if id unknown. Idempotent shape returned when the reservation is already gone (outcome = 'reservation_gone'). |
| POST | `/api/dashboard/ical-cancellation/:id/reject` | — | `{ ok: true }` | Marks rejected; 409 on already-acknowledged, 404 if id unknown. Reservation stays. |

Auth: same admin gating as the date-drift routes (the existing `enforceRoleAccess`
middleware already restricts `/api/dashboard/*` to admins, accountants are read-only on
`/api/accounting/*`).

---

## 5. Data model

New table:

```sql
CREATE TABLE IF NOT EXISTS ical_cancellation_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL,
  sourceId INTEGER NOT NULL,
  eventUid TEXT NOT NULL,
  detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledgedAt TEXT,
  outcome TEXT          -- NULL pending | 'approved' | 'rejected' | 'reservation_gone'
);
CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack
  ON ical_cancellation_alerts(acknowledgedAt)
  WHERE acknowledgedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack_reservation
  ON ical_cancellation_alerts(reservationId)
  WHERE acknowledgedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack_event
  ON ical_cancellation_alerts(sourceId, eventUid)
  WHERE acknowledgedAt IS NULL;
```

The third partial index supports the rule 4 auto-resolve lookup at `O(log n)` instead of
`O(n)` even when the table grows over months of operation.

Migration block sits next to `ical_date_drift_alerts` in `database.js`. Idempotent via
`IF NOT EXISTS`. No backfill (no historical cancellations exist).

**Data impact:** none on existing rows. The auto-delete branch removed from the engine
means: **starting at deploy time**, any new platform-side cancellation is queued for
approval. There is NO retro-action on past cancellations (those already happened
silently and the data is gone). The change is forward-only.

## 6. UI / UX

### 6.1 Dashboard alert layout

```
┌─ ⚠ Annulations iCal — 2 réservations à valider ─────────────────────┐
│                                                                       │
│  Jean Dupont  ·  Gîte du moulin                                   ✕    │
│  Du 10 juin 2026 au 13 juin 2026 · Source : Airbnb                    │
│  Détecté il y a 12 min                                                │
│  [ \U0001f5d1 Supprimer ]   [ Voir la fiche ]                                 │
│  ───────────────────────────────────────────────────────────────────  │
│  Claire Notin  ·  Appartement Cassis                              ✕    │
│  …                                                                    │
└───────────────────────────────────────────────────────────────────────┘
```

- Outer `<Alert severity="warning" variant="outlined">` with `borderWidth: 2` to match
  `IcalDateDriftAlert`.
- `AlertTitle`: `Annulations iCal — {n} réservation{s} à valider`.
- Per-row body:
  - Header: client name + property name (bold).
  - Dates of the cancelled stay (`Du {start} au {end}`) + source name (`· Source : Airbnb`).
  - Relative detection time (`Détecté il y a X min/heures/jours`).
  - Three action buttons:
    - `Supprimer` (filled, `color="error"`, `startIcon=<DeleteIcon />`). On success
      shows a snackbar `Réservation supprimée`.
    - `Voir la fiche` (outlined). Navigates to `/reservations/:id`. Does not acknowledge.
    - `✕` (top-right `IconButton`, tooltip `Ignorer cette annulation`).
- When `reservationExists === false`: the row shows `Réservation supprimée` instead
  of the buttons; only `✕` stays usable.
- French copy:
  - `Annulations iCal — {n} réservation{s} à valider`
  - `Du {start} au {end} · Source : {sourceName}`
  - `Détecté il y a X min/heures/jours`
  - `Supprimer` / `Voir la fiche` / tooltip `Ignorer cette annulation`
  - Snackbar success: `Réservation supprimée`.

### 6.2 Responsive

- `xs` (mobile):
  - Rows stack vertically; the dates line + source line stack;
  - Action buttons stack full-width below;
  - `✕` stays in the top-right corner.
- `md+`: dates + source on one line; buttons side-by-side.

### 6.3 Page action bar

No change.

---

## 7. Test plan

### Server unit tests

- [ ] `tests/ical-cancellation-model.unit.test.js` (C) — covers:
  - `recordPending` insert when nothing pending; UPDATE when a pending row already exists.
  - `recordPending` idempotency when the same proposal repeats.
  - `listPending` joins client + property + source; surfaces deleted reservation.
  - `resolveOnReappearance` deletes pending rows matching `(sourceId, eventUid)` pairs.
  - `approve(id)` atomic delete + history + ack; 409 on already-acknowledged;
    `reservation_gone` outcome when the reservation is missing.
  - `reject(id)` flips outcome without touching the reservation; 409 / 404 paths.
- [ ] `tests/property-ical-sync.unit.test.js` (T) — extend with:
  - **Cancellation: a previously imported reservation falls out of the feed** → no
    deletion; one pending cancellation row recorded; `removedCount` increments to 1.
  - **Cross-platform: two sources, one drops the UID** → reservation stays, no
    cancellation row.
  - **Cross-platform: both sources drop the UID** → one cancellation row.
  - **Auto-resolve: a sync re-includes a previously-dropped UID before user reacts** →
    the pending row is deleted; no new cancellation; no duplicate insert on subsequent
    syncs.
  - **Locked reservation falls out of feed** → soft cancellation applied (parity check —
    the locked flag does NOT short-circuit the proposal).
  - **Idempotent repeat sync with the same dropped UID** → still ONE pending row; no
    duplicate.
- [ ] `tests/dashboard-controller-ical-cancellation.unit.test.js` (C) — HTTP shaping:
  - `GET` returns `{ alerts: [] }` when nothing pending; forwards model payload as-is.
  - `POST /:id/approve` returns 200; 400 on bad id; 409 on already-acknowledged;
    404 on unknown.
  - `POST /:id/reject` returns 200; 400 on bad id; 409 / 404 paths.

### Manual UI verification

- [ ] Happy path:
  1. Create an iCal reservation via a stubbed feed.
  2. Run a second sync with an empty feed → reservation stays + Dashboard shows an
     orange alert with one pending cancellation card.
  3. Click `Supprimer` → row disappears + snackbar; reservation is gone in DB; CASCADE
     leaves clients in place (cleaned by next sync's orphan pass).
- [ ] Click `Voir la fiche` → navigates correctly; the alert card stays pending.
- [ ] Click `✕` → row disappears; subsequent syncs with same empty feed do NOT
      re-create the alert (the reservation is detached — no mapping left to drop).
- [ ] Auto-resolve: with a pending cancellation, re-include the UID in the feed → next
      sync silently dismisses the alert; refresh Dashboard, gone.
- [ ] Cross-platform: configure 2 sources for the same property; drop the UID in one
      feed only → reservation stays + no alert. Drop in both → one alert.
- [ ] Regression: with the alert system installed, the date-drift flow still works
      (PR #104).
- [ ] Mobile (`xs`) — rows stack, buttons stack full-width, `✕` reachable.

---

## 8. Out of scope

- **Bulk approve/reject** ("Tout supprimer", "Tout ignorer"). v1 is per-row; bulk arrives
  if the queue grows in practice.
- **Restoring a rejected cancellation's mappings**. After Reject, the `ical_import_events`
  rows are gone (dropped during the stale-cleanup pass that PRECEDED the alert). If the
  user wants future syncs to re-claim the reservation, they have to manually re-import.
  Acceptable v1 trade-off; documented as a follow-up enhancement.
- **Per-source granularity** in the cancellation alert (e.g. "Airbnb dropped this booking
  but Booking still has it"). The alert only fires when ALL mappings drop the UID, so the
  per-source granularity is moot for the alert itself; the `sourceName` shown is the LAST
  source to drop the UID (informational).
- **Email / push notification** on cancellation detection. Alert is on the Dashboard only.
- **Auto-cleanup of acknowledged rows**. Kept indefinitely for audit.
- **Resurrecting the OLD reservation when the user rejects a cancellation and the
  platform later re-includes the booking**. Handled implicitly via the existing
  cross-platform fallback `(dates + name)` in `syncSource()` step 2-3; documented as
  edge case in §3, not a guaranteed feature.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q: Should the Dashboard alert deduplicate sources (one alert per reservation, not per
  source) when multiple sources drop the same booking in the same sync window?
  - A: Yes — rule 3 UPSERTs per `reservationId`, so the user only ever sees ONE
    cancellation card per reservation.
- Q: Do we need a "bulk cancel all" button?
  - A: Out of scope v1 — see §8.
- Q: Should a rejected cancellation re-arm the iCal mapping so future syncs can re-claim
  the reservation?
  - A: Out of scope v1 — see §8. Acceptable because the cross-platform fallback by
    `(dates + name)` covers the common case.
