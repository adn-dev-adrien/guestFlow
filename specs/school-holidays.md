# School Holidays

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/school-holidays` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | _(to be opened)_ |

---

## 1. Context

The application already ships a working **school holidays** feature for the three French education zones (A, B, C). Periods are seeded on first boot ([`server/src/database.js:827`](../server/src/database.js#L827)) — 15 periods covering Oct 2024 → Aug 2027 — and an admin page ([`client/src/pages/SchoolHolidaysPage.js`](../client/src/pages/SchoolHolidaysPage.js)) lets the user add/edit/delete additional periods. The data is consumed read-only by:

- [`CalendarPage.js`](../client/src/pages/CalendarPage.js) — colored Zone A/B/C indicators on each day cell ([line 1298](../client/src/pages/CalendarPage.js#L1298)).
- [`PropertyPricingSeasonsPage.js`](../client/src/pages/PropertyPricingSeasonsPage.js) — overlay on the seasons calendar ([line 651](../client/src/pages/PropertyPricingSeasonsPage.js#L651)).

The implementation predates the spec-driven workflow and has three problems:

1. **The data goes stale.** The seed in `database.js` is hardcoded with periods that stop at Aug 2027 (verified [line 827](../server/src/database.js#L827)). After the seed runs once, nothing ever refreshes the data — there is **no auto-sync** with the official French open-data source. The user has to manually re-key new years as they get published. Confirmed: `grep -n "school\|holiday" server/src/scheduledTasks.js` returns no matches.
2. **The page is not visual.** Today's `DataPageScaffold` + `<Table>` layout forces the user to read date columns to mentally reconstruct the school calendar. The presentation does not match what the data is *about* (a calendar).
3. **Standard debt.** Route file ([`server/src/routes/schoolHolidays.js`](../server/src/routes/schoolHolidays.js), 35 LOC) does DB calls directly with no model, no controller, no validation, no tests. The form accepts empty labels, reversed dates, and empty zone pairs without complaint.

This spec addresses all three: **auto-sync from data.education.gouv.fr every 2 months (always 2 years of data ahead)**, a **Gantt-style annual timeline** for the page, and a full **MVC + validation + tests** refactor of the backend.

## 2. Goal

A user opens `/school-holidays` and sees a Gantt-style annual timeline (one stacked lane per zone) showing the next school years, always up to date thanks to a background sync from `data.education.gouv.fr`. The user can:
- Click any band to edit; an officially-imported period that is edited becomes locked from future auto-syncs.
- **Trigger a manual re-sync** at any time from the page header.
- **Configure the sync frequency** (how often the background sync runs, in days).
- **Configure the sync horizon** (how far into the future to fetch, in months).

## 3. Functional rules

### Data shape & validation

1. The persisted shape extends today's: `{ id, label, zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end, externalRef, isLocked, lastSyncedAt }`. Dates are `YYYY-MM-DD` strings; `null` means "no period configured for that zone".
2. Dates within a zone are **inclusive on both ends** (`start ≤ dateStr ≤ end`), matching existing consumer logic in [`frenchHolidays.js:55-57`](../client/src/frenchHolidays.js#L55).
3. `label` is required (trimmed, non-empty); auto-applied `sentenceCase` is preserved.
4. Each zone is configured as a **pair**: either both `start` and `end` are present, or both are empty. A single side is rejected.
5. When a zone pair is present, `start ≤ end`. A reversed range is rejected. A one-day holiday (`start === end`) is valid.
6. At least one zone must be configured. A period with all three zones empty is rejected.
7. Listing returns periods sorted by `COALESCE(zoneA_start, zoneB_start, zoneC_start) ASC, id ASC`.
8. Validation errors return `400 INVALID_PERIOD` with a French error message.

### Auto-sync from data.education.gouv.fr

9. **Source of truth:** the official open dataset [`fr-en-calendrier-scolaire`](https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/) on `data.education.gouv.fr`. Records filtered to `population = "Élèves"` (exclude staff, CPGE, etc.). All Zone A/B/C records are kept; other zones (e.g. Corse, DOM-TOM) are ignored — only metropolitan A/B/C are in scope.
10. **What we fetch:** all records where `start_date` falls between **today** and **today + `syncHorizonMonths` months** (default 24, user-configurable per rule 16), so the local DB always covers the desired horizon.
11. **Aggregation:** the API returns one record per (zone, period). We group records by `(annee_scolaire, description)` → one local row. For each row, the matching record(s) populate `zoneA_start/end`, `zoneB_start/end`, `zoneC_start/end`. Rows without any zone match for our 3 zones are skipped.
12. **External identity (`externalRef`):** `${annee_scolaire}|${description_normalized}` (where `description_normalized` = trimmed + lowercased + ASCII-folded). Used as the upsert key for auto-sync. Manually-created rows have `externalRef = NULL` and are **never** touched by the sync.
13. **Lock semantics (per user choice "Manuel verrouille auto"):** when a user edits a row via `PUT /api/school-holidays/:id`, the controller sets `isLocked = 1`. The sync engine **skips** any row where `isLocked = 1`. To re-enable auto-sync on a locked row, the user clicks the dedicated "Réactiver la mise à jour automatique" affordance on the band (resets `isLocked = 0`, the next sync will overwrite).
14. **Stale rows:** rows with `externalRef NOT NULL`, `isLocked = 0`, and whose `externalRef` is no longer in the fetched payload **AND** whose latest configured end-date is in the past (older than today) are silently deleted. Locked rows, manual rows, and not-yet-past rows are kept regardless.
15. **Schedule:**
    - **Background tick:** `setInterval` fires **every hour**. On each tick, the scheduler checks `now - lastSyncAt >= syncIntervalDays * 86400 s` — if true, runs the sync. This keeps config changes hot (no server restart needed when the user edits `syncIntervalDays`).
    - **Startup boot:** `setTimeout` 60 seconds after server boot, run the sync if `lastSyncAt IS NULL` OR `lastSyncAt < now() - syncIntervalDays days`. Otherwise skip.
    - **Concurrency guard:** an `inProgress` flag prevents overlapping runs.
16. **User-configurable sync settings** (persisted on the `school_holidays_sync_state` singleton — see §5):
    - `syncIntervalDays` (integer, **default 60**, allowed range **1–365**): how often the auto-sync runs. Validated server-side; out-of-range values rejected with `400 INVALID_SYNC_SETTINGS`.
    - `syncHorizonMonths` (integer, **default 24**, allowed range **1–60**): how far into the future the sync fetches records. Validated identically.
    - Settings are edited via a small "Paramètres de synchronisation" dialog reachable from the sync banner (gear icon).
    - Saving new settings is **non-destructive**: the new `syncIntervalDays` only affects the next scheduling tick; the new `syncHorizonMonths` only affects the next sync run. No immediate refetch is forced unless the user clicks "Synchroniser maintenant" afterwards.
17. **Manual trigger:** `POST /api/school-holidays/sync` runs the same engine on-demand. Returns `{ ok: true, createdCount, updatedCount, skippedLockedCount, deletedStaleCount, durationMs }` on success, `{ ok: false, error }` on failure. The manual trigger uses the same `syncHorizonMonths` as the scheduled one.
18. **Sync state persistence:** the singleton row in `school_holidays_sync_state` (id=1) stores both the config (`syncIntervalDays`, `syncHorizonMonths`) AND the runtime state (`lastSyncAt`, `lastSyncStatus`, `lastSyncMessage`, `lastImportedCount`). The list endpoint returns the whole singleton alongside the periods so the page renders the banner + settings dialog from one payload.
19. **Network failure handling:** if the HTTP call fails (timeout, 5xx, parse error), persist `lastSyncStatus = 'error'` + `lastSyncMessage`, do not touch any row, log the error. Next scheduled tick retries (after the configured interval).
20. **No external dependency:** use Node's built-in `fetch` (Node 18+). No new `npm` package.

### Page layout

21. **Gantt timeline:** periods are grouped by **French school year** (Sept 1 of year `Y` → Aug 31 of year `Y+1`, labelled `"Année scolaire Y-Y+1"`). A period belongs to school year `S` if its earliest configured start date falls inside `[S.start, S.end]`. Within each school-year section, the timeline shows a horizontal month axis (Sept → Aug) and three stacked lanes labelled `Zone A`, `Zone B`, `Zone C`. Each period contributes 0–3 colored bands (one per configured zone), positioned proportionally to start/end dates. The page uses the standard `PageActionBar` (title + Add button + Sync button).
22. **Editing entry-point:** clicking any band opens the edit dialog for that period. Saving the dialog sets `isLocked = 1` if the row was previously `externalRef NOT NULL` (rule 13).
23. **Hover/tap interaction:** hovering a band shows a tooltip with the period label, the dates for that zone (`DD/MM/YYYY → DD/MM/YYYY`), and a small badge if the row is locked (🔒) or auto-synced (🌐). On touch devices, tap opens the dialog (the dialog title shows the label).
24. **Zone colors** (single source of truth — `client/src/constants/schoolHolidayZoneColors.js`):
    - Zone A → `#2196F3` (blue)
    - Zone B → `#4CAF50` (green)
    - Zone C → `#FF9800` (orange)
25. **Sync status banner:** above the timeline, a slim banner shows:
    - "Dernière mise à jour : il y a 12 jours (succès, 8 périodes importées)" — when `lastSyncStatus === 'success'`.
    - "Erreur lors de la dernière mise à jour : <message>" — when `lastSyncStatus === 'error'`, with a `warning` color.
    - "Aucune synchronisation effectuée pour le moment." — when `lastSyncAt IS NULL`.
    - The banner shows the current settings as muted secondary text: `"Sync auto tous les 60j · horizon 24 mois"`. A gear icon next to the text opens the settings dialog.
    - The banner includes a "Synchroniser maintenant" button (calls `POST /sync`, busy spinner during the call).
26. **Settings dialog ("Paramètres de synchronisation"):** opened from the gear icon on the banner. Two number fields:
    - `Fréquence de mise à jour (jours)` — min 1, max 365, default 60.
    - `Horizon de mise à jour (mois)` — min 1, max 60, default 24.
    - Save button validates client-side (range, integer) and submits to `PUT /api/school-holidays/sync-settings`.
    - On server `400 INVALID_SYNC_SETTINGS`, surface the message in an `Alert` inside the dialog.

**Edge cases:**
- Empty list, no sync ever ran → empty state `Aucune période configurée. La prochaine synchronisation automatique se chargera de remplir le calendrier.` + manual sync button.
- A school year with periods on Zone A but not B/C → lanes B/C render thin gray empty lines.
- One-day holiday (`start === end`) → band has a minimum-width of 4px to remain visible/clickable.
- Cross-year holiday (e.g. Noël: Dec 20 → Jan 4) → drawn as a continuous band; both dates are inside the same Sept-Aug window.
- Period starting on Sept 1 exactly → assigned to the **new** school year starting that day.
- Sync arrives during the user's edit → the sync skips the row being edited (rule 13: `PUT` already set `isLocked = 1` if the user has saved at least once); if not yet saved, the worst case is a stale dialog that surfaces a `404` or stale dates on save — accepted as cosmetic.

---

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** All validation, the sync engine, and the scheduling live on the server. The page only renders bands and submits the form. The existing client helper `getSchoolHolidayInfo` (used by Calendar + Seasons) remains on the client as a pure render helper and is queued for server migration in Bloc 6.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `schoolHolidays.js` | T | Thin router: GET `/`, POST `/`, PUT `/:id`, PUT `/:id/unlock`, DELETE `/:id`, POST `/sync`, GET `/sync-settings`, PUT `/sync-settings`. Delegates to controller. |
| `controllers/` | `schoolHolidaysController.js` | C | Orchestrates list/create/update/delete/sync/sync-settings. Runs `validatePeriod` and `validateSyncSettings`. Sets `isLocked = 1` on user PUT (when `externalRef NOT NULL`). Returns `400`/`404` with French messages. |
| `models/` | `schoolHolidaysModel.js` | C | Factory `(db) => ({ list, findById, insert, update, delete, unlock, getSyncState, setSyncState, updateSyncSettings, upsertByExternalRef, deleteStaleAutoRows })`. Default export bound to production `db`; `create(db)` exposed for tests. |
| `middleware/` | — | — | (none) |
| `utils/` | `schoolHolidaysValidation.js` | C | Pure `validatePeriod(...)` → `null`/French error; pure `validateSyncSettings({ syncIntervalDays, syncHorizonMonths })` → `null`/French error. |
| `utils/` | `schoolHolidaysSync.js` | C | Pure-ish sync engine. Exports `runSync({ model, fetchFn = fetch, horizonMonths })` → `{ createdCount, updatedCount, skippedLockedCount, deletedStaleCount, durationMs }`. `fetchFn` + `horizonMonths` injected → unit-testable without network. |
| `utils/` | `educationGouvClient.js` | C | Builds the `data.education.gouv.fr` URL (next `horizonMonths` months, `population = "Élèves"`, zones A/B/C), wraps `fetch` with a 30 s timeout, parses + returns raw records. |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Adds `performSchoolHolidaysSync()` + a 1-hour tick that reads `syncIntervalDays` from `school_holidays_sync_state` and runs sync if `now - lastSyncAt >= interval`. Boot `setTimeout(60 s)` runs once if interval elapsed. Mirrors the iCal sync pattern. |
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE` for the 3 new columns on `school_holidays` + the new `school_holidays_sync_state` singleton table (with `syncIntervalDays`, `syncHorizonMonths` columns). |

**Notes:**
- The seed block in `database.js` stays as-is — first-boot rows still get created. The first auto-sync (within 60 s of startup) immediately upserts them by `externalRef` so they line up with the API canonical version.
- All new utils are pure functions, unit-testable. `runSync` accepts an injected `fetchFn` so tests can pass a stub returning canned API payloads.
- No new npm package required.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `SchoolHolidaysPage.js` | T | Full rewrite: `PageActionBar` + sync banner + `SchoolHolidaysTimeline` + `FormDialog` + sync-settings `FormDialog`. Removes `DataPageScaffold` + `<Table>`. |
| `components/` | `SchoolHolidaysTimeline.js` | C | Pure render. Props: `{ periods, onEdit }`. Groups by school year (via `schoolYear` util), renders one `SchoolYearStrip` per group. |
| `components/` | `SchoolYearStrip.js` | C | One school-year section: header `"Année scolaire Y-Y+1"` + 12-month axis + 3 zone lanes with absolutely-positioned bands. Mobile-friendly (horizontal scroll inside an overflow container, `minWidth: 720px`). |
| `components/` | `SchoolHolidayBand.js` | C | One colored band for one zone of one period. Tooltip + click handler. Min-width 4px. Color from `ZONE_COLORS`. Renders 🔒 if `isLocked`, no badge for vanilla auto-imported rows. |
| `components/` | `SchoolHolidaysSyncBanner.js` | C | Slim banner above the timeline. Props: `{ syncState, onSync, onOpenSettings, busy }`. Renders the "Dernière mise à jour…" line, the muted "Sync auto tous les Xj · horizon Y mois" secondary text, a gear icon (opens settings dialog), and the "Synchroniser maintenant" button. |
| `components/` | `SchoolHolidaysSyncSettingsDialog.js` | C | `FormDialog` with two number fields (`syncIntervalDays` 1–365, `syncHorizonMonths` 1–60). Submits to `PUT /sync-settings`. Surfaces `400 INVALID_SYNC_SETTINGS` in an `Alert`. |
| `components/` | `SchoolHolidayFormFields.js` | T | Adds per-zone helper text when server returns a validation error. New "Réactiver la mise à jour automatique" button when editing an `externalRef NOT NULL` row with `isLocked = 1`. |
| `hooks/` | — | — | (none — local state in the page is enough) |
| `services/` | — | — | (none) |
| `utils/` | `schoolYear.js` | C | Pure helpers: `getSchoolYearOf(dateStr)` → `{ start, end, label }`; `groupPeriodsBySchoolYear(periods)` → `[{ year, periods }, ...]` sorted ascending. |
| `constants/` | `schoolHolidayZoneColors.js` | C | Exports `ZONE_COLORS = { A: '#2196F3', B: '#4CAF50', C: '#FF9800' }`. Reused by `CalendarPage.js` indicator render to keep colors in sync. |
| `styles/` | — | — | (none) |
| `api.js` | `api.js` | T | Adds `syncSchoolHolidays()` → POST `/sync`, `updateSchoolHolidaysSyncSettings({ syncIntervalDays, syncHorizonMonths })` → PUT `/sync-settings`, `unlockSchoolHoliday(id)` → PUT `/:id/unlock`. `getSchoolHolidays()` now returns `{ periods, syncState }`. |
| `App.js` | `App.js` | — | No change. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `FormDialog`, `ConfirmDialog` (via `useAppDialogs`) | Pre-existing. |
| **Created (new generic)** | `ZONE_COLORS` constant | Shared color source-of-truth between the timeline and `CalendarPage`'s indicators. Tiny but worth centralizing — avoids color drift. |
| **Specific (kept feature-local)** | `SchoolHolidaysTimeline`, `SchoolYearStrip`, `SchoolHolidayBand`, `SchoolHolidaysSyncBanner`, `SchoolHolidaysSyncSettingsDialog`, `SchoolHolidayFormFields` | Tightly coupled to the 3-zone shape + school-year grouping + sync semantics. Not useful outside school-holidays. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/school-holidays` | — | `{ periods: [{ id, label, zoneA_start, …, externalRef, isLocked, lastSyncedAt }, …], syncState: { lastSyncAt, lastSyncStatus, lastSyncMessage, lastImportedCount, syncIntervalDays, syncHorizonMonths } }` | Periods sorted per rule 7. Single payload covers timeline + banner + settings dialog. |
| POST | `/api/school-holidays` | `{ label, zoneA_start, …, zoneC_end }` | `{ id }` | Always sets `externalRef = NULL`, `isLocked = 0`. `400` on validation. |
| PUT | `/api/school-holidays/:id` | same as POST | `{ ok: true }` | Sets `isLocked = 1` if `externalRef NOT NULL`. `400`/`404` on errors. |
| PUT | `/api/school-holidays/:id/unlock` | — | `{ ok: true }` | Resets `isLocked = 0`. `404` if id unknown. |
| DELETE | `/api/school-holidays/:id` | — | `{ ok: true }` | `404` if id unknown. Hard delete. |
| POST | `/api/school-holidays/sync` | — | `{ ok, createdCount, updatedCount, skippedLockedCount, deletedStaleCount, durationMs }` or `{ ok: false, error }` | Manual sync trigger. Uses persisted `syncHorizonMonths`. |
| GET | `/api/school-holidays/sync-settings` | — | `{ syncIntervalDays, syncHorizonMonths }` | Convenience endpoint; same data already in GET `/` response. |
| PUT | `/api/school-holidays/sync-settings` | `{ syncIntervalDays, syncHorizonMonths }` | `{ ok: true, syncIntervalDays, syncHorizonMonths }` | `400 INVALID_SYNC_SETTINGS` if out of range. |

Auth: none (consistent with existing routes — auth is out of scope for the app).

---

## 5. Data model

### Existing table — additive migration

```sql
ALTER TABLE school_holidays ADD COLUMN externalRef TEXT;        -- null = manual row
ALTER TABLE school_holidays ADD COLUMN isLocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE school_holidays ADD COLUMN lastSyncedAt TEXT;       -- ISO-8601 of last auto touch
CREATE INDEX IF NOT EXISTS idx_school_holidays_externalRef ON school_holidays(externalRef);
```

Idempotent block in `server/src/database.js`. Existing rows: `externalRef = NULL`, `isLocked = 0`. They get adopted by the first auto-sync if their `(year, label)` matches an API record (the upsert overwrites the row in place). Otherwise they stay as orphan manual rows.

### New singleton table

```sql
CREATE TABLE IF NOT EXISTS school_holidays_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- Config (user-editable via PUT /sync-settings)
  syncIntervalDays INTEGER NOT NULL DEFAULT 60,    -- 1..365
  syncHorizonMonths INTEGER NOT NULL DEFAULT 24,   -- 1..60
  -- Runtime state (written by the sync engine)
  lastSyncAt TEXT,                                  -- ISO-8601 or NULL if never
  lastSyncStatus TEXT DEFAULT 'never',              -- 'never' | 'success' | 'error'
  lastSyncMessage TEXT DEFAULT '',
  lastImportedCount INTEGER DEFAULT 0,
  updatedAt TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO school_holidays_sync_state (id) VALUES (1);
```

Idempotent — re-runs are no-ops. The `INSERT OR IGNORE` ensures the singleton row exists; subsequent `ALTER TABLE ADD COLUMN` migrations (if we ever add fields) follow the same pattern used elsewhere in `database.js`.

**Data impact:** none — additive changes. The seeded periods (Oct 2024 → Aug 2027) are preserved and adopted by the first sync.

**Index consideration:** the new `idx_school_holidays_externalRef` index supports the upsert lookup in the sync engine.

## 6. UI / UX

### Page `/school-holidays`

**Desktop / `md`+ layout:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [←] Vacances scolaires                       [⟳ Sync] [+ Ajouter]        │ ← PageActionBar
├──────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────┐   │ ← Sync banner
│ │ ⓘ Dernière mise à jour : il y a 12 jours (8 périodes importées)    │   │
│ │   Sync auto tous les 60j · horizon 24 mois  [⚙]                    │   │
│ │                                          [Synchroniser maintenant] │   │
│ └────────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│ Année scolaire 2024-2025                                                 │
│ ────────────────────────────────────────────────────────────────────     │
│        Sep   Oct   Nov   Dec   Jan   Fev   Mar   Avr   Mai   Jun   Jui   Aou
│ Zone A       [Tous]    [─Noël─]        [Hiver]  [Print]               [─Été─]
│ Zone B       [Tous]    [─Noël─]    [Hiv]         [Print]              [─Été─]
│ Zone C       [Tous]    [─Noël─]      [Hiv]      [Print]               [─Été─]
│                                                                          │
│ Année scolaire 2025-2026                                                 │
│ ────────────────────────────────────────────────────────────────────     │
│        Sep   Oct   Nov   Dec   Jan   Fev   Mar   Avr   Mai   Jun   Jui   Aou
│ Zone A       [Tous]    [─Noël─]        [Hiver]🔒 [Print]              [─Été─]
│ …                                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

- 🔒 = lock badge on a band the user has edited (auto-sync will skip it).
- Hover/tap a band → Tooltip "Hiver 2026 — 21/02 → 08/03 (zone A) — 🔒 verrouillée".
- Click a band → `FormDialog` opens, pre-filled.

**PageActionBar:**
- `title="Vacances scolaires"`
- `backTo="/settings"` — return to parent Paramètres page (consistent with closures).
- `actionsBefore=[ { icon: <SyncIcon />, tooltip: 'Synchroniser maintenant', onClick: triggerSync, color: 'info', busy: syncing }, { icon: <AddIcon />, tooltip: 'Ajouter une période', onClick: openCreate, color: 'primary', variant: 'contained' } ]`
- No `onSave`/`onCancel` (page has no draft).

**Sync banner (`SchoolHolidaysSyncBanner`):**
- Primary line: variant `info` (`#0288d1`) with `<InfoOutlinedIcon />` when `lastSyncStatus === 'success'`; variant `warning` when `'error'` (message includes `lastSyncMessage`); variant `info` muted when `lastSyncAt IS NULL` → "Aucune synchronisation effectuée pour le moment."
- Secondary line (muted): `"Sync auto tous les {syncIntervalDays}j · horizon {syncHorizonMonths} mois"` + a gear `IconButton` next to it that opens `SchoolHolidaysSyncSettingsDialog`.
- Right side: "Synchroniser maintenant" button, shows `CircularProgress` while in flight (calls `POST /api/school-holidays/sync` then refetches the list).

**Settings dialog (`SchoolHolidaysSyncSettingsDialog`):**
- Title: `Paramètres de synchronisation`.
- Two `TextField type="number"`:
  - `Fréquence de mise à jour (jours)` — min 1, max 365, default seeded with current `syncIntervalDays`. Helper text: `Combien de jours entre deux synchronisations automatiques.`
  - `Horizon de mise à jour (mois)` — min 1, max 60, default seeded with current `syncHorizonMonths`. Helper text: `Jusqu'à combien de mois dans le futur récupérer les vacances.`
- Submit button `Enregistrer` calls `PUT /api/school-holidays/sync-settings`. On server `400`, surfaces the message in an `Alert` inside the dialog.
- Cancel button restores the previous values and closes.

**Timeline (`SchoolHolidaysTimeline` → `SchoolYearStrip` → `SchoolHolidayBand`):**
- Each `SchoolYearStrip` is a `<Card>` with header + axis + 3 lanes. Lanes are `position: relative`, height ~ 34 px.
- Month axis: 12 equally-spaced labels (`Sep`, `Oct`, …, `Aou`). Light vertical separators (`borderLeft: 1px solid grey.200`) between months.
- Bands: `position: absolute`, `left` and `width` computed from `(startDate - schoolYear.start) / totalDays * 100%`, with `minWidth: 4px`. `borderRadius: 4`. Click → `onEdit(period)`.
- Lane background: thin `grey.100` line so empty lanes are visible.
- Cards stack vertically with `mb: 3`.

**FormDialog (create/edit):**
- Title: `Ajouter une période` or `Modifier la période`.
- Body: `SchoolHolidayFormFields` (label + 3 × zone start/end pairs).
- If `externalRef NOT NULL`: read-only info chip at the top `"Source officielle (data.education.gouv.fr)"`.
- If `externalRef NOT NULL` and `isLocked = 1`: secondary button `"Réactiver la mise à jour automatique"` next to Save (calls `PUT /:id/unlock` then closes the dialog).
- Submit disabled when `!form.label` or when validation locally rejects.
- On server `400 INVALID_PERIOD`, surface in an `Alert` inside the dialog.
- On server `404` (edit), close and reload the list.

**ConfirmDialog (delete):** title `Confirmer la suppression`, message `Supprimer cette période de vacances ?`. For `externalRef NOT NULL` rows, add a second line: `Cette période a été importée automatiquement et sera ré-importée à la prochaine synchronisation.`

### Responsive behavior

| Breakpoint | Behavior |
|---|---|
| `xs` (≤600px) | PageActionBar compact (title hidden, icons only). Sync banner stacks: text on top, button below (`flexDirection: column` on `xs`, `row` on `sm+`). Each `SchoolYearStrip` is inside an `overflow-x: auto` container with `minWidth: 720px` inside — user swipes horizontally to scan the year. Dialog `fullScreen={true}`. Form fields stack vertically (`Grid xs={12}`). |
| `md` (~900px) | Sync banner row-style. Year strip fits without scroll. Form 2-column grid. |
| `lg` (≥1200px) | Same as `md`, wider centered cards (max-width 1200). |

Touch targets: bands ≥ 14 px tall (with hover halo to reach 28 px effective). IconButtons in the bar inherit MUI's 40 × 40 default.

---

## 7. Test plan

### Server unit tests

- [ ] `tests/school-holidays-validation.unit.test.js` — `validatePeriod` + `validateSyncSettings`:
  - Valid period (all three zones) → `null`.
  - Valid period (only Zone A) → `null`.
  - Missing label → French error mentioning "libellé".
  - Empty label after trim → French error.
  - Zone with start but no end → French error per zone.
  - Zone with end but no start → French error per zone.
  - Zone `start > end` → French error mentioning "postérieure".
  - Zone `start === end` → `null` (one-day holiday is valid).
  - All zones empty → French error mentioning "au moins une zone".
  - `validateSyncSettings({ syncIntervalDays: 30, syncHorizonMonths: 24 })` → `null`.
  - `validateSyncSettings({ syncIntervalDays: 0, ... })` → French error mentioning the 1..365 range.
  - `validateSyncSettings({ syncIntervalDays: 366, ... })` → French error.
  - `validateSyncSettings({ ..., syncHorizonMonths: 61 })` → French error mentioning the 1..60 range.
  - `validateSyncSettings({ syncIntervalDays: 30.5, ... })` → French error (must be an integer).

- [ ] `tests/school-holidays-model.unit.test.js` — `:memory:` DB:
  - `insert` + `list({})` returns the row.
  - Sort: row with only Zone B starting later comes after row with Zone A starting earlier.
  - `findById` returns row, `null` when absent.
  - `update` returns `true`/`false`.
  - `delete` returns `true`/`false`.
  - `unlock(id)` flips `isLocked` from 1 → 0; returns `false` when id absent.
  - `upsertByExternalRef`: inserts when no row matches, updates when one does.
  - `upsertByExternalRef` skips rows where `isLocked = 1`.
  - `deleteStaleAutoRows` removes rows with `externalRef` not in the keep-set AND past end-date AND `isLocked = 0`; keeps locked rows; keeps future rows; keeps manual rows.
  - `getSyncState()` returns defaults `{ syncIntervalDays: 60, syncHorizonMonths: 24, lastSyncStatus: 'never', ... }` on a fresh DB.
  - `updateSyncSettings({ syncIntervalDays: 30, syncHorizonMonths: 12 })` persists; `getSyncState()` reflects new values; `lastSyncAt` and friends are untouched.

- [ ] `tests/school-holidays-sync.unit.test.js` — `runSync({ model, fetchFn, horizonMonths })` with a stubbed `fetchFn`:
  - Empty API response → 0 created, 0 updated, persists `lastSyncStatus = 'success'`.
  - One new period across 3 zones (3 API records, same `annee_scolaire + description`) → 1 row created, all 3 zones populated.
  - Period matching an existing un-locked row → 1 update.
  - Period matching an existing locked row → 1 skip, row unchanged.
  - Past-period present locally with no API match AND end-date in past → deleted.
  - Future-period present locally with no API match → kept (not deleted).
  - Fetch throws → `lastSyncStatus = 'error'`, no row touched.
  - `horizonMonths = 12` passed → the `educationGouvClient` URL builder uses end_date = today + 12 months (verify via the captured fetch call).

### Manual UI verification

- [ ] Happy path: navigate to `/school-holidays`, see seeded rows rendered as Gantt bands across 3 lanes per school year.
- [ ] Hover a band → Tooltip shows label + dates.
- [ ] Click a band → edit dialog opens pre-filled.
- [ ] Edit + Save → returning to the page, the band has a 🔒 badge.
- [ ] Click "Synchroniser maintenant" → busy spinner → banner updates with new "Dernière mise à jour" + result counts. The 🔒 row is untouched.
- [ ] Click the gear icon → settings dialog opens with current values pre-filled.
- [ ] Change `syncIntervalDays` to `30` and `syncHorizonMonths` to `12`, save → dialog closes, banner secondary text now reads `"Sync auto tous les 30j · horizon 12 mois"`.
- [ ] Enter `syncIntervalDays = 0` or `syncHorizonMonths = 61` → server `400` Alert visible inside the dialog.
- [ ] Open the locked row's dialog → click "Réactiver la mise à jour automatique" → next sync rewrites the row, 🔒 disappears.
- [ ] Add a manual period (no `externalRef`) → appears in the right school-year strip; survives sync.
- [ ] Edge: try to save with empty label / reversed dates / all zones empty → server `400` Alert visible.
- [ ] Regression: `/calendar` still shows Zone A/B/C indicators on the right days, with the same colors as the timeline (sourced from `ZONE_COLORS`).
- [ ] Regression: `/properties/:id/pricing-seasons` still overlays school holidays.
- [ ] Mobile: PageActionBar compact, sync banner stacks, year strip scrolls horizontally, dialog fullscreen.

### Sync robustness (manual)

- [ ] Stop the network → click "Synchroniser maintenant" → banner switches to warning with French error message; no rows touched.
- [ ] Resume network → click again → banner switches back to success.
- [ ] Boot the server with `lastSyncAt = NULL` → check logs: the 60 s startup sync runs once. Restart the server within a minute → second startup does NOT re-trigger (`lastSyncAt < syncIntervalDays days` skip).
- [ ] Set `syncIntervalDays = 1` via the settings dialog → wait the next hourly tick (or restart) → another sync fires.

---

## 8. Out of scope

- **Migration of `frenchHolidays.js`** (`getFrenchPublicHolidays`, `getSchoolHolidayInfo`) to the server. Pure render helpers stay on the client. Tracked in Bloc 6.
- **Per-property zone assignment.** Calendar shows all three zones for every day; this behavior stays. A spec for "assign each property to a zone based on its postal code" can come later.
- **Auto-pricing rules tied to school holidays.** Pricing concerns belong to Bloc 2.
- **Overlap detection between periods.** Overlapping periods are explicitly allowed — a user can layer a custom local holiday on top of a national one. The Calendar render returns the first matching period.
- **Audit history** for school-holidays edits (no `school_holidays_history` table).
- **Multi-region zones** (Corse, DOM-TOM). Only Zone A/B/C are in scope.
- **Conflict UI when a sync would change a non-locked row significantly** (e.g. date moved by > 7 days). The sync silently overwrites — the user can lock then.
- **Email/push notifications on sync error.** Errors only surface on the page banner. A future spec could add admin email alerts.
- **History/log of past syncs.** Only the most recent sync result is persisted.

## 9. Open questions

_(Resolved before moving Status to Approved.)_

- _None._
