# iCal sync — Dashboard approval for date drifts on locked reservations

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/ical-sync-override-locked-dates` |
| **Created** | 2026-06-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Today, an iCal-sourced reservation is **fully sync-locked** as soon as it is opened and saved
through the reservation page — `computeNextIcalSyncLocked` flips `icalSyncLocked` to `1` for
any iCal reservation that goes through the manual `update` controller, regardless of whether
the user changed anything. The sync engine ([propertyIcalModel.syncSource()](server/src/models/propertyIcalModel.js))
then treats a locked reservation as **fully untouchable** — when the source platform changes the
dates of an already-locked booking, the new dates are ignored, the reservation stays at the old
dates, and the sync counts it as `lockedCount` with no visible feedback to the user.

This was originally part of the anti-overbooking contract (memory: `ical_anti_overbooking.md`).
But for date-change events specifically, **the source platform is the authority** — when the
guest moves their booking on Airbnb / Booking, the local reservation has to follow, otherwise
the calendar overbookings the property.

User-side modifications worth preserving across any future date update are: **options, resources,
bed config (`singleBeds` / `doubleBeds` / `babyBeds`), guest counts (`adults` / `children` /
`teens` / `babies`), and ALL price fields** (`totalPrice`, `customPrice`, `finalPrice`,
`depositAmount`, `balanceAmount`, `touristTaxTotal`, etc.).

## 2. Goal

When an iCal source changes the **dates** of a reservation that is already `icalSyncLocked = 1`,
the sync **records a pending approval request** (without touching the reservation yet) and
surfaces it as an orange Dashboard alert. The user explicitly **approves**, **opens the
reservation**, or **ignores** the proposal. Only an explicit approval applies the date change
to the reservation — and even then, ONLY the date fields are touched (every other user-side
edit is preserved).

## 3. Functional rules

1. **Drift detection (sync side).** During `syncSource()`, when a mapping is found and the new
   event hash differs from the stored one:
   - If `startDate` OR `endDate` differs from the persisted reservation's dates AND the
     reservation is locked (`icalSyncLocked = 1`) → **do NOT touch the reservation**; record a
     pending drift instead (rule 2). Counts the event as `lockedCount` (unchanged terminology
     in the sync result).
   - If only non-date fields differ on a locked reservation (summary, description, adults,
     etc.) → keep the existing skip behavior; **no drift row recorded**.
   - If unlocked → keep today's full update path unchanged (regression guard). No drift row.
2. **Recording a pending drift.**
   - Insert (or UPDATE-by-reservation, see rule 3) a row in the new `ical_date_drift_alerts`
     table with:
     - `reservationId` — the locked reservation.
     - `previousStartDate`, `previousEndDate` — read from the **reservation row** at detection
       time (i.e. the dates the user currently sees on their fiche, not the mapping's stored
       dates).
     - `newStartDate`, `newEndDate` — the dates proposed by the iCal feed.
     - `detectedAt` — `datetime('now')`.
     - `acknowledgedAt` — `NULL`, `outcome` — `NULL` (the row is "pending").
   - The mapping's `eventHash` / `startDate` / `endDate` in `ical_import_events` ARE updated to
     the new source values (same as today's locked-skip path) — this guarantees that subsequent
     syncs with an unchanged source do not re-create the drift.
3. **One pending drift per reservation at a time.** If a pending row (`acknowledgedAt IS NULL`)
   already exists for the same reservation when a new drift is detected, **UPDATE** that row
   with the latest `newStartDate` / `newEndDate` and refresh `detectedAt`. `previousStartDate` /
   `previousEndDate` stay untouched (they keep showing the dates the user currently has). This
   avoids alert fatigue when the platform shuffles dates multiple times before the user reacts.
4. **Approve action.**
   - `POST /api/dashboard/ical-date-drift/:id/approve` — atomic operation:
     1. Load the drift row. 404 if missing. 409 if already `acknowledgedAt IS NOT NULL`.
     2. Apply the narrow date override SQL on the reservation (see rule 6).
     3. Mark the drift row `acknowledgedAt = datetime('now')`, `outcome = 'approved'`.
     4. Add a `reservation_history` event of type `update` with `changedFields` listing the
        startDate / endDate transition (so it appears in the audit trail). Label:
        `Dates iCal approuvées`.
5. **Ignore action.**
   - `POST /api/dashboard/ical-date-drift/:id/reject` — atomic operation:
     1. Load the drift row. 404 if missing. 409 if already acknowledged.
     2. Mark `acknowledgedAt = datetime('now')`, `outcome = 'rejected'`.
     3. The reservation is **untouched** — it stays at the previously persisted dates.
     4. No history entry on the reservation (it's a non-event from the reservation's
        perspective).
   - Subsequent syncs with the same source state see matching `eventHash` → no new drift. If
     the platform shuffles dates again later, a NEW drift row is recorded and surfaced.
6. **Narrow date override (only fires on approve).** The SQL writes ONLY these columns:
   - `startDate`, `endDate`
   - `updatedAt = datetime('now')`

   `sourceIcalEventUid` and the `notes` audit block are NOT rewritten by the override — the
   `ical_import_events` mapping table is already kept up-to-date by the sync engine on the
   locked-skip path (UID + dates + normalized summary refreshed every sync), so the
   authoritative source-side metadata lives there. The reservation row stays a clean view of
   the user's accepted state.
7. **Never touched by the override**, regardless of source values:
   - `adults`, `children`, `teens`, `babies`
   - `singleBeds`, `doubleBeds`, `babyBeds`
   - `checkInTime`, `checkOutTime`
   - `platform`, `sourcePlatformKey`
   - Every price field: `totalPrice`, `customPrice`, `finalPrice`, `discountPercent`,
     `depositAmount`, `balanceAmount`, `complementAmount`, `touristTax*`
   - Payment flags: `depositPaid`, `balancePaid`, `complementPaid`
   - `cautionAmount`, `cautionReceived`, etc.
   - `icalSyncLocked` itself — it stays `1`.
   - Child rows: `reservation_options`, `reservation_resources`, `reservation_custom_options`,
     `reservation_nights`.
8. **Dashboard alert.** A new orange (`severity="warning"`) `<Alert>` on the Dashboard lists
   every unacknowledged drift. Each row shows:
   - Reservation client name + property name. Click → navigates to `/reservations/:id`.
   - Old dates → new dates (formatted `dd MMM yyyy`).
   - Relative detection time (`Détecté il y a X min/heures/jours`).
   - Two action buttons: **`Approuver`** (filled, color `success`) and **`Voir la fiche`**
     (outlined, navigates to the reservation page).
   - A small `✕` icon button in the top-right corner = **Ignorer** (rejects the proposal).
9. **Empty state.** No alert renders when there are zero pending drifts.
10. **Single PR, no follow-up split.** Sync detection + drift table + Dashboard alert + approve
    / reject endpoints all ship together.

**Edge cases:**
- **Locked reservation, new UID alongside the date change** (Booking sometimes does this): the
  mapping lookup by UID fails; the fallback lookups search by NEW dates so they also fail; the
  current path creates a NEW reservation + DELETES the old one, losing user data. **Out of
  scope here** — see §8. The drift-approval mechanism here only kicks in when the mapping is
  preserved (which is the common case on Airbnb, iCal-OTA, and most Booking flows).
- **Unlocked reservation + dates change** → full update path unchanged. No drift row.
- **Locked reservation, only the summary changes (no date diff)** → no drift row; counts as
  `lockedCount` exactly as today.
- **User approves a drift, then the platform shuffles dates again before the user reacts** → a
  new drift row is recorded with the now-applied dates as `previousStart/End` and the latest
  source dates as `newStart/End`.
- **User opens the reservation, manually changes the dates, then later approves an older
  pending drift** → approving overwrites their manual change with the drift's `newStart/End`.
  This is acceptable: the row is explicitly opt-in via the Approve button; if the user wanted
  to keep their manual edit, they should have rejected the drift first.
- **Reservation deleted while a drift row is pending** → the Dashboard payload LEFT JOINs the
  reservation; rows with no reservation show `clientName: '#<id>'` and a disabled Approve
  button (cannot apply to a missing reservation). The user can still Ignore.
- **Drift detected on a reservation that was already pending acknowledgment with different
  dates** → existing row UPDATED with the latest proposal (rule 3). User sees the freshest
  proposal only.

---

## 4. Architecture

### 4.1 Server side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | [routes/dashboard.js](server/src/routes/dashboard.js) | T | Mounts 3 new routes: `GET /ical-date-drift`, `POST /ical-date-drift/:id/approve`, `POST /ical-date-drift/:id/reject`. |
| `controllers/` | [controllers/dashboardController.js](server/src/controllers/dashboardController.js) | T | Adds `icalDateDrift(req,res)`, `approveIcalDateDrift(req,res)`, `rejectIcalDateDrift(req,res)`. Each orchestrates one model call + response shaping. |
| `models/` | `models/icalDateDriftModel.js` | C | `recordPending({reservationId, previousStart, previousEnd, newStart, newEnd})` — UPSERT semantics per rule 3. `listPending()` — joined payload with client + property + reservation dates. `approve(id)` — applies narrow override + flips row to `approved`. `reject(id)` — flips row to `rejected`. All write paths in a single SQL transaction. |
| `models/` | [models/propertyIcalModel.js](server/src/models/propertyIcalModel.js) | T | `syncSource()` extended: detects locked + date-drift, calls `icalDateDriftModel.recordPending(...)` inside the existing `syncTx` transaction. No date write to the reservation. The `getReservationById` SELECT is extended to include `startDate` and `endDate` so the previous dates are captured exactly. |
| `utils/` | [utils/icalParser.js](server/src/utils/icalParser.js) | T | Adds a tiny helper `isLockedDateDrift(mappedReservation, event)` so the sync code stays readable. |
| `database.js` | [database.js](server/src/database.js) | T | New idempotent block: `CREATE TABLE IF NOT EXISTS ical_date_drift_alerts(...)` + index on `(acknowledgedAt) WHERE acknowledgedAt IS NULL`. |

**Notes:**
- All approve/reject logic is server-side (CLAUDE.md §6.0). The client just renders payloads
  and POSTs button clicks.
- The narrow-update SQL is hardcoded and reviewed against rules 6+7 — any column drift breaks
  the contract.
- `icalDateDriftModel.approve()` writes inside its own SQL transaction so the reservation
  update + drift row update + history insert commit together. Failure of any step rolls back.
- No new dependencies.

### 4.2 Client side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | [pages/Dashboard.js](client/src/pages/Dashboard.js) | T | Mounts `<IcalDateDriftAlert />` right after `<LinenShortageAlert />`. |
| `components/` | `components/IcalDateDriftAlert.js` | C | Self-fetching component (mirror of `LinenShortageAlert`). Renders orange `<Alert>` per pending drift with Approve + Voir la fiche + ✕ buttons. |
| `api.js` | [api.js](client/src/api.js) | T | `getIcalDateDriftAlert()`, `approveIcalDateDrift(id)`, `rejectIcalDateDrift(id)`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Alert`, `AlertTitle`, `Box`, `Typography`, `Button`, `IconButton`, `Divider`. | Standard reuse. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `IcalDateDriftAlert.js` | Tightly coupled to the drift payload and the two-action flow. If a second "dashboard alert with per-row approve/reject" pattern emerges, we extract a `<ApprovalAlert>` generic at that point. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/dashboard/ical-date-drift` | — | `{ alerts: [{ id, reservationId, clientName, propertyName, previousStartDate, previousEndDate, newStartDate, newEndDate, detectedAt, reservationExists }] }` | Sorted by `detectedAt DESC`. Only unacknowledged rows. `reservationExists` is `false` when the joined reservation was deleted — drives the disabled state of the Approve button. |
| POST | `/api/dashboard/ical-date-drift/:id/approve` | — | `{ ok: true }` | Applies the narrow date override; idempotent shape but 409 on already-acknowledged; 404 if id unknown; 410 if reservation no longer exists. |
| POST | `/api/dashboard/ical-date-drift/:id/reject` | — | `{ ok: true }` | Marks rejected; 409 on already-acknowledged; 404 if id unknown. Reservation is untouched. |

Auth: all three routes sit under the standard `/api` post-login session guard. `approve` and
`reject` require an **admin** session (they mutate or arbitrate a reservation's state — same
trust level as the manual reservation `update` route). The standard role middleware enforces
this.

---

## 5. Data model

New table:

```sql
CREATE TABLE IF NOT EXISTS ical_date_drift_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL,
  previousStartDate TEXT NOT NULL,
  previousEndDate TEXT NOT NULL,
  newStartDate TEXT NOT NULL,
  newEndDate TEXT NOT NULL,
  detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledgedAt TEXT,
  outcome TEXT  -- NULL when pending, 'approved' | 'rejected' once acknowledged
);
CREATE INDEX IF NOT EXISTS idx_ical_drift_unack
  ON ical_date_drift_alerts(acknowledgedAt)
  WHERE acknowledgedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_ical_drift_unack_reservation
  ON ical_date_drift_alerts(reservationId)
  WHERE acknowledgedAt IS NULL;
```

The reservation-scoped partial index supports the "one pending row per reservation" UPSERT
lookup in `recordPending`.

Migration block sits next to the existing `ical_*` table migrations in `database.js`, idempotent
via `IF NOT EXISTS`. No backfill.

**Data impact:** none on existing rows. The new table is read/written only by the new model.

## 6. UI / UX

### 6.1 Dashboard alert layout

```
┌─ ⚠ Modifications de dates iCal — 2 changements à valider ─────────┐
│                                                                    │
│  Jean Dupont  ·  Gîte du moulin                              ✕     │
│  Dates actuelles : 10 juin → 13 juin 2026                          │
│  Dates proposées : 15 juin → 18 juin 2026                          │
│  Détecté il y a 12 min                                             │
│  [ Approuver ]   [ Voir la fiche ]                                 │
│  ────────────────────────────────────────────────────────────────  │
│  Claire Notin  ·  Appartement Cassis                         ✕     │
│  …                                                                 │
└────────────────────────────────────────────────────────────────────┘
```

- Outer `<Alert severity="warning" variant="outlined">` with `borderWidth: 2` to mirror the
  `LinenShortageAlert` visual weight.
- `AlertTitle`: `Modifications de dates iCal — {n} changement{s} à valider`.
- One block per pending drift, separated by a thin `<Divider>`.
- Layout per row, left → right (desktop):
  - Header: client name + property name (bold). `flex: 1`.
  - Top-right: `✕` `IconButton` (size `small`, tooltip `Ignorer cette modification`). Click =
    POST `/reject` + optimistic remove from the list.
  - Two `<Typography variant="body2">` lines for the dates ("Dates actuelles : …", "Dates
    proposées : …"). Bold on the dates themselves.
  - Time stamp: `Détecté il y a X min/heures/jours` in muted color.
  - Buttons row: `Approuver` (filled, `color="success"`, click = POST `/approve` + optimistic
    remove + lightweight success snackbar) and `Voir la fiche` (outlined, navigates to
    `/reservations/:reservationId`).
- French copy:
  - Tooltip `✕`: `Ignorer cette modification`.
  - Button `Approuver` → on success: snackbar `Dates mises à jour pour {clientName}` (existing
    snackbar pattern).
  - Button `Voir la fiche` → no snackbar.
  - When `reservationExists === false`: the row shows `Réservation #{id} (supprimée)` instead
    of the client name, and the `Approuver` + `Voir la fiche` buttons are `disabled`. Only `✕`
    stays clickable.

### 6.2 Responsive

- `xs` (mobile):
  - Each row stacks vertically; dates on two lines (current / proposed).
  - The `✕` stays in the top-right; the Approve / Voir buttons stack vertically full-width
    below the row.
  - `<Alert>` padding reduces (`px: 1.5`).
- `md+`: dates side-by-side allowed if room permits; buttons side-by-side.

### 6.3 Page action bar

No change to the Dashboard's action bar (`PageActionBar`) — the alert is a standalone block.

---

## 7. Test plan

### Server unit tests

- [ ] `tests/property-ical-sync.unit.test.js` (T) — extend with:
  - **Locked + dates change** → no reservation write; ONE drift row inserted with the right
    previous / new dates; `lockedCount` = 1; `updatedCount` = 0; reservation's `startDate /
    endDate / adults / singleBeds / totalPrice` stay at their seeded values.
  - **Locked + only summary changes (no date diff)** → no drift row inserted; `lockedCount = 1`.
  - **Unlocked + dates change** → existing full update path; no drift row (regression).
  - **Two consecutive syncs with the same drifted source** → first sync inserts one row, second
    sync is `unchangedCount`, no new row.
  - **Locked + dates change once, then change again before user reacts** → only ONE pending
    row exists; its `newStartDate` / `newEndDate` reflect the LATEST proposal; `previousStart /
    End` keep the original reservation dates.
- [ ] `tests/ical-date-drift-model.unit.test.js` (C) — covers:
  - `recordPending` insert when nothing pending.
  - `recordPending` UPDATE when a pending row already exists for the same reservation.
  - `listPending` returns only `acknowledgedAt IS NULL` rows, joined with client + property
    + reservation dates.
  - `approve(id)` runs the narrow override on the reservation and writes the history entry +
    flips the drift row to `approved` (atomic).
  - `approve` returns an error when the row is already acknowledged.
  - `approve` returns an error when the reservation no longer exists.
  - `reject(id)` flips the row to `rejected` without touching the reservation.
  - `reject` is a no-op on an already-acknowledged row (returns an error).
- [ ] `tests/dashboard-controller-ical-drift.unit.test.js` (C) — controller HTTP shaping:
  - `GET` returns `{ alerts: [] }` when nothing pending.
  - `GET` returns rows sorted by `detectedAt DESC`.
  - `POST /:id/approve` returns 200 then the next `GET` no longer lists the row.
  - `POST /:id/approve` on an already-acknowledged row returns 409.
  - `POST /:id/approve` on a row whose reservation was deleted returns 410.
  - `POST /:id/reject` returns 200 then the next `GET` no longer lists the row.
  - `POST` on a missing id returns 404.

### Manual UI verification

- [ ] Happy path:
  1. Lock a reservation: open it + save without changes (sets `icalSyncLocked = 1`).
  2. Run the iCal sync against a stubbed feed whose event has new dates → reservation dates
     stay UNCHANGED in the form; orange Dashboard alert appears with the correct old → new
     dates.
  3. Click `Approuver` → row disappears + snackbar; reservation now has the new dates; bed
     config / guest count / options / prices unchanged.
- [ ] Open the reservation via `Voir la fiche` → navigates correctly; the drift card stays
      pending until explicit action.
- [ ] Click `✕` → row disappears; subsequent sync with the same source does not recreate the
      alert.
- [ ] Re-drift after acknowledge → a new pending row is created with the now-current
      reservation dates as `previousStart/End`.
- [ ] Regression: unlocked iCal reservation whose dates change still goes through the full
      update path (no drift alert).
- [ ] Regression: locked reservation whose summary changes (no date diff) is still counted as
      `lockedCount`, no drift alert.
- [ ] Mobile (`xs`): rows stack, buttons stack full-width, `✕` reachable.

---

## 8. Out of scope

- **Locked reservation receiving a NEW UID alongside the date change**: the current matching
  algorithm falls through to INSERT + DELETE the old, losing user data. Fixing this requires
  a name-based fallback search across UIDs (or a secondary `(sourceId, summary)` index) and is
  a broader rework of the sync engine. Tracked as a follow-up TODO.
- **"Approuver toutes" / "Ignorer toutes"** bulk actions on the alert.
- **Email / push notification** when a drift is detected.
- **Auto-approve** policy (e.g. "always approve drifts smaller than 1 day"): all drifts are
  surfaced to the user.
- **Auto-cleanup of acknowledged rows**: kept indefinitely for audit. A scheduled cleanup
  (e.g. delete rows acknowledged > 90 days ago) can be added later.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q: Should an acknowledgement (approve/reject) require admin role or be available to any
  full-session user?
  - A: Admin role. Approving rewrites reservation dates — same trust level as a manual
    reservation edit, which is admin-gated.
- Q: Should we display the drift card when the reservation has been deleted in the meantime?
  - A: Yes — with a disabled Approve button + `Réservation supprimée` label. The user can still
    Ignore so the row leaves the alert.
- Q: Do we record an entry in `reservation_history` on Approve?
  - A: Yes — type `update`, label `Dates iCal approuvées`, fields `startDate` + `endDate`. So
    the reservation's history page shows the change.
