# Google Calendar OAuth rework

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/google-calendar-oauth-rework` |
| **Created** | 2026-07-18 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The existing Google Calendar integration (spec coverage split between `specs/settings.md` §3 rules 12–17 and `specs/integrations-mvc.md` Bloc 6) is **effectively dead and partially broken**:

1. **The sync endpoint is unreachable.** `POST /api/google-calendar/sync-reservations` exists ([googleCalendarController.js](../server/src/controllers/googleCalendarController.js)) and `api.syncGoogleCalendarReservations` exists ([api.js:391](../client/src/api.js#L391)), but **no UI element calls it**, there is no scheduled task and no hook on reservation writes. Only "Tester la synchronisation" is wired.
2. **The auth mechanism blocks private professional calendars.** Auth is a service-account JWT ([googleCalendarClient.js:54-63](../server/src/utils/googleCalendarClient.js#L54-L63)). It only works if the target calendar is explicitly shared with the robot email — a step the Settings UI never mentions — and on Google Workspace accounts the admin console limits external calendar sharing to free/busy by default, making writes fail with 403 regardless.
3. **Event creation was latently broken anyway.** `getGoogleEventIdForReservation()` produces `guestflow-r<id>` ([googleCalendarEvents.js:68-70](../server/src/utils/googleCalendarEvents.js#L68-L70)); Google event IDs only allow base32hex characters (`0-9`, `a-v`), so `w` and `-` make every `events.insert` fail with 400.
4. **No lifecycle management.** Deletions are never propagated (orphan events forever), every sync is a full-table push (2 API calls per reservation, all-or-nothing on error), one hardcoded global calendar, `Europe/Paris` hardcoded.

The user's need: see reservations for all properties, always up to date, in his **private professional Google calendar** (Google Workspace, own domain, self-administered).

## 2. Goal

Connect GuestFlow to a Google account in one click ("Connecter mon compte Google"), pick a target calendar from a list, and have every reservation automatically appear — and stay up to date, including deletions — as a color-coded event in that private calendar, with no calendar-sharing ceremony.

## 3. Functional rules

### Authentication (OAuth 2.0, replaces the service account)

1. GuestFlow authenticates to Google as the user via **OAuth 2.0 authorization-code flow with refresh token** (googleapis `google.auth.OAuth2`). The service-account mechanism (3 manual fields) is **removed**.
2. OAuth client credentials come from env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (in `server/.env.local`). Without them the feature shows "Synchronisation non configurée" with a hint that the env vars are missing; all sync paths are no-ops.
3. Redirect URI resolution (Qonto precedent, [paymentsController.js:35-38](../server/src/controllers/paymentsController.js#L35-L38)): `GOOGLE_OAUTH_REDIRECT_URI` env override, else `settingsModel.publicUrl()` + `/api/google-calendar/oauth/callback`. Dev uses `http://localhost:3000/api/google-calendar/oauth/callback` (Vite proxy → :4000).
4. Authorize request: scopes `https://www.googleapis.com/auth/calendar.events` + `https://www.googleapis.com/auth/calendar.readonly` + `openid email`, `access_type=offline`, `prompt=select_account consent` — `consent` guarantees a refresh token on every connect; `select_account` (added 2026-07-19 after the production setup connected the browser's active — wrong — account on a multi-account browser) always shows the account picker. CSRF `state` = `crypto.randomBytes(16).toString('hex')` stored in `req.session.googleOAuthState` (Qonto pattern).
5. Callback validates `state` (single-use, deleted after read), exchanges the code, stores the **refresh token AES-256-GCM-encrypted** in `app_settings`, extracts the connected email from the `id_token`, then redirects the browser to `/settings?google=connected` (`?google=error|invalid_state` on failure; raw Google errors never leak to the URL, logged server-side only).
6. Access tokens are never persisted — googleapis mints/refreshes them in memory from the refresh token.
7. **Disconnect** clears the stored refresh token, connected email, calendar selection and last-sync state, after a best-effort call to Google's revocation endpoint (revocation failure does not block the disconnect).
8. If Google reports the refresh token invalid/revoked (`invalid_grant`) during any sync, the sync stops, the status becomes "Échec de la dernière synchro" with the French detail « Connexion Google expirée ou révoquée. Reconnectez votre compte. », and the user must reconnect. No retry storm. Same red-status treatment when the stored token becomes **unreadable** (AES key rotation): the reconcile records « Connexion Google illisible (clé de chiffrement changée ?)… » instead of silently freezing while the chip claims « active ».

### Calendar selection

9. After connection, the user picks the target calendar from `calendarList.list`, filtered to entries with `accessRole` `writer` or `owner`. The list shows the calendar name; the primary calendar is labeled « (principal) ». The selection is validated server-side with a single `calendarList.get` (membership + write access in one call).
10. The selection (calendar id + display name) is stored server-side. Changing the target calendar triggers a full reconcile against the new calendar; **events already pushed to the previous calendar are left untouched** (documented limitation — the user deletes them manually if needed; acceptable for a one-person app).
11. Sync is **active** iff connected **and** a calendar is selected. There is no separate enable/disable toggle.

### Event mapping

12. Only rows with `kind='reservation'` are synced (never devis) — unchanged from today.
13. Google event id: `` `gfres${reservationId}` `` — base32hex-safe (`g,f,r,e,s` ∈ `a-v`), deterministic, idempotent. The old `guestflow-r*` scheme is dropped (no events with those ids can exist — inserts always failed).
14. Event payload keeps the current shape ([googleCalendarEvents.js](../server/src/utils/googleCalendarEvents.js)): summary `"<propertyName> - <clientLastName clientFirstName>"`, description with traveler counts / beds / options, start `startDate`T`checkInTime||'15:00'`, end `endDate`T`checkOutTime||'10:00'`, timezone `Europe/Paris`, `extendedProperties.private.guestflowSource='guestflow'` + `guestflowReservationId`.
15. New payload fields: `colorId` = `String(((propertyId - 1) % 11) + 1)` — deterministic color per property (Google supports event colors 1–11); and explicit `status: 'confirmed'` so an update on a Google-side-cancelled event resurrects it (an event manually deleted in Google Calendar comes back at the next push/reconcile — GuestFlow is the source of truth).

### Sync engine

16. **Targeted push** (`pushReservation(id)`): `events.update` first, on 404 fall back to `events.insert` with the fixed id (1 API call in steady state instead of today's get+update 2-call pattern). **Targeted delete** (`deleteReservationEvent(id)`): `events.delete`, 404/410 ignored.
17. **Reconcile** (`reconcile()`): (a) `events.list` with `privateExtendedProperty=guestflowSource=guestflow` (paginated) on the target calendar; (b) for every DB reservation, push only if the fetched event is missing or differs on summary/description/start/end/colorId/status (skip unchanged — quota-friendly); (c) delete every fetched event whose `guestflowReservationId` no longer matches a `kind='reservation'` row, **plus** every guestflow-stamped event living under a non-canonical id (`≠ gfres<rid>`, e.g. a copy duplicated in the Google UI) — orphan purge catches deletions, conversions missed while offline, and stray copies.
18. Reconcile is **per-item fault-isolated**: one failing reservation is recorded and skipped, the loop continues. The run result (`lastSyncAt`, ok/error, French detail with per-item error count) is persisted and surfaced in Settings.
19. **Correctness comes from reconcile; hooks are latency optimizations.** Every hook is fire-and-forget (`.catch(log)`), never awaited in the request path, never fails a user request.

### Triggers

20. Immediate push/delete hooks after successful writes, placed at the **shared choke points** so every entry path gets the same low-latency push:
    - `reservationsController` `create` / `update` → push; `remove` → delete (after `res.json`).
    - Devis→réservation conversion → push the new reservation. The hook lives in `devisController.convertToReservation` for the manual flow **and** in `utils/paymentPollRunner.processPaidLink` for the paid-link flow — covering the Qonto webhook, the manual payment refresh and the cron poll with one line.
    - iCal date-drift approval → push; iCal cancellation approval → delete (dashboard controller, after `res.json`).
    - iCal sync that created/updated/removed bookings → one debounced reconcile, triggered inside `propertyIcalModel.syncSourceAndRecord` (single point shared by the manual per-source sync, sync-all and the 5-min scheduled pass).
21. Payment / caution / SAS / notification-timestamp updates do **not** trigger a push (no event-visible field changes).
22. **Scheduled reconcile**: every 15 min (`GOOGLE_SYNC_TICK = 15 * 60 * 1000`) + a staggered boot pass, following the `scheduledTasks.js` idiom (in-progress guard, `settingsModel`-gated no-op when sync inactive, exported for tests).
23. **Manual trigger**: « Synchroniser maintenant » button in Settings → `POST /api/google-calendar/sync-now` → runs a reconcile, returns counts (`pushed`, `deleted`, `skipped`, `errors`).
24. `POST /sync-reservations` (and its ability to accept ad-hoc credentials in the request body) is **removed**.

### Status

25. `statusLabel` (server-computed): « Synchronisation non configurée » (env vars absent or not connected) → grey; « Configuration en cours » (connected, no calendar selected) → orange; « Synchronisation active » (connected + calendar, last sync ok or not yet run) → green; « Échec de la dernière synchro » (last sync failed) → red. Same label strings as today (client chip mapping reused).

**Edge cases:**
- Not connected / no calendar → every hook, scheduled pass and sync-now is a silent no-op (sync-now returns 400 with a French message).
- Refresh token revoked upstream → rule 8.
- Target calendar deleted on Google side → sync fails with « Agenda introuvable. Choisissez un autre agenda cible. » (404 mapping), status red; user picks another calendar.
- Event manually deleted or edited in Google → recreated/overwritten at next push/reconcile (rule 15; GuestFlow is source of truth).
- Reservation deleted while server was offline → orphan purge at next reconcile (rule 17c).
- Two overlapping reconciles (manual + scheduled) → in-progress guard: second run is skipped.
- OAuth callback hit without a valid admin session → standard 401 from the auth guard (same accepted behavior as the Qonto callback: `sameSite=lax` carries the session cookie on the top-level redirect).

---

## 4. Architecture

> Fat backend, thin frontend: OAuth flow, token lifecycle, calendar listing, diffing, status labels — all server-side. The client renders payloads and triggers actions.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `googleCalendar.js` | T | Thin routes: keep `GET /status`, `POST /test-connection`; add `GET /oauth/authorize`, `GET /oauth/callback`, `POST /oauth/disconnect`, `GET /calendars`, `PUT /calendar`, `POST /sync-now`; remove `POST /sync-reservations` |
| `controllers/` | `googleCalendarController.js` | T | OAuth orchestration (authorize/callback/disconnect, Qonto pattern), calendar list & selection, sync-now, reworked status/test-connection |
| `controllers/` | `reservationsController.js` | T | Fire-and-forget push/delete hooks after create/update/remove |
| `controllers/` | devis + dashboard controllers (conversion, drift approve, cancellation approve) | T | Same fire-and-forget hooks at the relevant endpoints (after `res.json`) |
| `models/` | `propertyIcalModel.js` | T | Debounced reconcile trigger inside `syncSourceAndRecord` (covers manual sync, sync-all and the 5-min pass) |
| `utils/` | `paymentPollRunner.js` | T | Push hook on devis→reservation conversion inside `processPaidLink` (covers webhook + manual refresh + cron poll) |
| `models/` | `googleCalendarModel.js` | T | `listReservationsForSync()` gains `propertyId` (color) + single-id variant for targeted pushes |
| `models/` | `settingsModel.js` | T | New encrypted column + accessors: `storeGoogleTokens`, `googleTokens`, `googleConnected`, `storeGoogleCalendarSelection`, `recordGoogleSyncResult`; legacy SA columns removed from `COLUMNS`/`ENCRYPTED_COLUMNS` |
| `middleware/` | — | — | (none — callback rides the session cookie like the Qonto callback) |
| `utils/` | `googleOAuthClient.js` | C | OAuth2 client factory: authorize URL, code exchange, revoke, `getAuthedCalendar()` from stored refresh token; env + redirect-URI resolution |
| `utils/` | `googleCalendarClient.js` | T | Service-account JWT & 3-field config removed; keeps the French Google-error mapping + `testConnection` on the OAuth client |
| `utils/` | `googleCalendarEvents.js` | T | New event id `gfres<id>`, `colorId`, `status:'confirmed'`; upsert becomes update→404→insert; delete helper |
| `utils/` | `googleCalendarSync.js` | C | Sync engine: `pushReservation`, `deleteReservationEvent`, `reconcile` (diff + orphan purge + fault isolation), debounced hook entrypoints, last-sync recording |
| `utils/` | `settingsResponse.js` | T | `googleCalendar` block removed from `GET /api/settings` (feature now self-served by `/api/google-calendar/status`) |
| `scheduledTasks.js` | `scheduledTasks.js` | T | `runGoogleSyncPass` every 15 min + boot stagger, idiom copied from the payment poll (guard + connected no-op) |
| `database.js` | `database.js` (+ `schema.sql`) | T | Idempotent new `app_settings` columns; one-shot clear of legacy SA columns |

**Notes:** no new dependency (`googleapis` already present). Docs updated in the same PR: README §3 rewritten for the OAuth client setup (consent screen **Internal** on Workspace), `specs/settings.md` Google rules replaced by a pointer to this spec, `specs/integrations-mvc.md` Google rows marked superseded, CLAUDE.md §8 stale "stored in clear" note fixed.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `SettingsPage.js` | T | Google section removed from the global settings draft/dirty-diff/save; section becomes self-contained |
| `components/` | `SettingsGoogleCalendarSection.js` | T | Full rework: connect/connected states, calendar picker, sync-now, disconnect, `?google=` toasts (mirrors `PaymentsSettingsPage` Qonto card) |
| `api.js` | `api.js` | T | New endpoints (status, calendars, calendar, disconnect, sync-now); `syncGoogleCalendarReservations` removed |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `SummaryItem`, `ConfirmDialog`, `ErrorAlert`, MUI `Select`/`Chip` | The section keeps the settings-page card shell (sectionHeader + status chip) for visual consistency with the sibling cards, rather than nesting a `StatusCard` |
| **Created (new generic)** | — | none needed |
| **Specific (kept feature-local)** | `SettingsGoogleCalendarSection` | Feature-specific composition of generics (like the Qonto card) |

`MaskedTextField`/`HelpedTextField` usage in this section disappears with the 3 manual fields.

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/google-calendar/status` | — | `{ oauthConfigured, connected, connectedEmail, connectedAt, calendarId, calendarSummary, syncActive, lastSyncAt, lastSyncOk, lastSyncDetail, lastSyncLabel, statusKey, statusLabel }` | Single data source for the Settings section; no secrets ever. `statusKey` is the machine key the chip color is derived from; `lastSyncLabel` is the ready-to-render French « Dernière synchro » line (fat backend) |
| GET | `/api/google-calendar/oauth/authorize` | — | 302 → Google consent | 400 JSON if env vars missing |
| GET | `/api/google-calendar/oauth/callback` | `?code&state` | 302 → `/settings?google=connected\|error\|invalid_state` | State single-use; errors logged server-side only |
| POST | `/api/google-calendar/oauth/disconnect` | — | `{ ok: true }` | Best-effort revoke + clear tokens/selection/sync state |
| GET | `/api/google-calendar/calendars` | — | `{ calendars: [{ id, summary, primary }] }` | `accessRole` writer/owner only; 400 if not connected |
| PUT | `/api/google-calendar/calendar` | `{ calendarId }` | `{ ok, calendarId, calendarSummary }` | Validated against the user's calendar list; triggers a reconcile |
| POST | `/api/google-calendar/test-connection` | — | `{ ok, message }` \| `{ ok:false, code, error }` | `calendars.get` on the selected calendar via OAuth; French error mapping kept |
| POST | `/api/google-calendar/sync-now` | — | `{ ok, pushed, deleted, skipped, errors, detail }` | Runs a reconcile; `detail` is the server-built French summary the client renders as-is; 400 + French message when sync inactive; 409 `SYNC_IN_PROGRESS` when a reconcile is already running |
| ~~POST~~ | ~~`/api/google-calendar/sync-reservations`~~ | | | **Removed** (with its request-body credential override) |
| GET/PUT | `/api/settings` | | | `googleCalendar` group **removed** from response and accepted payload |

All endpoints stay behind the standard session guard (Qonto-callback precedent for the OAuth redirect).

---

## 5. Data model

New `app_settings` columns (guarded `tryAddAppSettingsCol`, + `schema.sql` for fresh DBs):

| Column | Type | Encrypted | Purpose |
|---|---|---|---|
| `googleOAuthRefreshTokenEncrypted` | TEXT DEFAULT '' | ✅ (+ HTTP-masked → `googleConnected` boolean) | OAuth refresh token |
| `googleOAuthConnectedEmail` | TEXT DEFAULT '' | — | Connected Google account (display) |
| `googleOAuthConnectedAt` | TEXT DEFAULT '' | — | Connection timestamp |
| `googleCalendarSummary` | TEXT DEFAULT '' | — | Display name of the selected calendar |
| `googleLastSyncAt` | TEXT DEFAULT '' | — | Last sync timestamp |
| `googleLastSyncOk` | INTEGER DEFAULT NULL | — | 1/0/NULL (never ran) |
| `googleLastSyncDetail` | TEXT DEFAULT '' | — | French result/error detail |

Kept: `googleCalendarId` (existing encrypted column, now written via `PUT /calendar`). No changes to `reservations` or `properties` (event color derived from `propertyId`).

**Migration & data impact:** one-shot idempotent clears — (a) `googleServiceAccountEmail` / `googleServiceAccountPrivateKey` values (columns physically kept; removed from the model); (b) any `googleCalendarId`/`googleCalendarSummary` stored **while no OAuth connection exists** (necessarily a service-account-era leftover — the new picker only writes once connected). (b) forces the « Configuration en cours » step after the first connect instead of silently syncing to the old target calendar. This **erases the stored service-account credentials** — acceptable: the mechanism is removed, the feature never worked end-to-end, and the credentials remain in the user's Google Cloud Console. No other existing data touched. `CHANGELOG` fragments: `changed--…` + `migration--…`.

## 6. UI / UX

Single card « Synchronisation Google Agenda » on `/settings` (unchanged location), now self-contained (its actions are immediate; the page's global Save/Cancel in the existing `PageActionBar` no longer covers this section — no new page-level actions added to the bar).

**State 1 — env vars missing:** status chip « Synchronisation non configurée » + info Alert: « Renseignez GOOGLE_OAUTH_CLIENT_ID et GOOGLE_OAUTH_CLIENT_SECRET dans server/.env.local (voir README). » No buttons.

**State 2 — not connected:** explainer « Connectez votre compte Google pour copier automatiquement vos réservations dans l'agenda de votre choix. » + primary button **« Connecter mon compte Google »** → `window.location.href = '/api/google-calendar/oauth/authorize'`.

**State 3 — connected:** `StatusCard`-style content with `SummaryItem` lines — « Compte connecté : adrien@… », « Agenda cible : » `Select` of writable calendars (« (principal) » suffix on primary; empty value → « Choisir un agenda… »), « Dernière synchro : 18/07/2026 14:32 — 12 envoyées, 1 supprimée » (or the error detail). Buttons: **« Synchroniser maintenant »** (spinner while running, result in an inline Alert), **« Tester la connexion »** (outlined), **« Déconnecter »** (error color, `ConfirmDialog`: « Déconnecter le compte Google ? La synchronisation sera arrêtée. Les événements déjà créés resteront dans votre agenda. »).

**Feedback:** on mount, read `?google=connected|error|invalid_state` → success/error toast, then clean the URL param (Qonto pattern). Status chip per rule 25.

**Responsive:** `xs`: buttons stack vertically full-width, `SummaryItem` lines wrap, Select full-width; `md`/`lg`: buttons side-by-side, card unchanged. No dialogs besides `ConfirmDialog` (already `fullScreen` on mobile).

## 7. Test plan

### Server unit tests — 2049 pass (full suite, 2026-07-18)
- [x] `google-oauth-client.unit.test.js` (NEW, 11 tests) — authorize URL (scopes, `access_type=offline`, `prompt=consent`, state), redirect-URI resolution (env override > publicUrl+path), `emailFromIdToken`, `isInvalidGrant`, best-effort revoke
- [x] `google-oauth-flow.unit.test.js` (NEW, 8 tests) — authorize (session state + 302, 400s); callback: state mismatch/missing/replay → `invalid_state`, `?error` → `error`, success → tokens stored + `connected`, no leak on failure; disconnect clears + best-effort revoke
- [x] `google-calendar-sync.unit.test.js` (reworked) — `gfres<id>` matches `^[a-v0-9]{5,}$`, deterministic `colorId`, `status:'confirmed'`, payload fields; push update-first→404-insert→409-retry; delete swallows 404/410; `eventDiffers` offset-safe
- [x] `google-calendar-sync-engine.unit.test.js` (NEW, 8 tests) — inactive no-op (zero API calls); targeted push/delete; reconcile skips unchanged / pushes changed / purges orphans / paginates; per-item fault isolation + last-sync recording; `invalid_grant` abort per rule 8; overlap guard
- [x] `settings-model-encryption.unit.test.js` (reworked) — refresh-token column encrypted at rest, `read()` masks to `googleConnected`, token never in any payload, calendar-id round-trip, tri-state `recordGoogleSyncResult` + `clearGoogleConnection`
- [x] `google-calendar-status.unit.test.js` (NEW, 10 tests) — `statusLabel` matrix (rule 25), response shape, no secret leak, sync-now gates (400/409), calendar list/selection validation
- [x] `google-calendar-test-connection.unit.test.js` (update) — OAuth-shape config, French error mapping preserved
- [x] `settings-response.unit.test.js` / `settings-validation.unit.test.js` / `settings-model.unit.test.js` (updates) — `googleCalendar` block gone from `GET /api/settings`; PEM/calendarId validators removed
- [x] `dashboard-controller-ical-{drift,cancellation}.unit.test.js` + iCal model tests (updates) — `reservationId` in approve results + push/delete hook spies

### Client tests
- [x] Vitest (659 pass): NEW `SettingsGoogleCalendarSection.test.js` (7 tests) — 3 states, calendar picker, sync-now counters, disconnect ConfirmDialog, `?google=connected` toast, load-failure retry. No fixture updates needed (no existing test consumed the `googleCalendar` settings group)
- [x] E2E (`npm run test:e2e`): 32 pass / 1 skipped — settings specs render the reworked self-contained card (state 1) cleanly

### Manual UI verification (2026-07-18, dev)
- [x] State 1 (no env vars): chip « Synchronisation non configurée » + env-hint alert, no buttons
- [x] State 2 (dummy env vars injected): explainer + « Connecter mon compte Google » → real 302 to `accounts.google.com/o/oauth2/v2/auth` with `access_type=offline`, `prompt=consent`, the 4 scopes, resolved redirect URI and random state (Google replies `invalid_client` for the dummy id, as expected)
- [x] Callback paths via authenticated curl: wrong state → `?google=invalid_state`; valid state + dummy code → `?google=error` (nothing stored); state replay → `invalid_state` (single-use); `/status` shape + label; `sync-now` inactive → 400 French
- [x] DB migration on the real dev DB: 7 columns added, legacy SA credentials cleared, `googleLastSyncOk` NULL
- [x] Mobile (`xs`, 375px): card stacks, button full-width, no horizontal scroll
- [x] Regression: adjacent Settings sections (Société, SMTP…) render and keep the global Save bar
- [ ] **Remaining for Adrien (needs the real OAuth client):** create the Internal OAuth client (README §3), set the env vars on dev/Pi, then run the real consent round-trip, pick the calendar, and check events (colors, updates, deletions) in the private Workspace calendar

## 8. Out of scope

- Two-way sync (Google → GuestFlow) and free/busy import.
- Per-property custom color configuration UI (deterministic auto colors only).
- Configurable timezone (`Europe/Paris` stays hardcoded).
- Multi-account / multi-calendar simultaneous export; devis sync.
- Cleanup of events left in a previously selected calendar (rule 10).
- Service-account fallback mode.
- Support for non-Workspace accounts is not *blocked* (external consent screen works) but the documented setup targets the Internal Workspace app.

## 9. Open questions

All resolved 2026-07-18 with Adrien (AskUserQuestion):
- Q: Account type of the target calendar? → **Google Workspace on his own self-administered domain** → OAuth consent screen **Internal** (no verification, no 7-day token expiry, no warning screen).
- Q: Auth mechanism? → **OAuth replaces the service account entirely** (no dual mode).
- Q: Sync triggers? → **Immediate hooks + 15-min scheduled reconcile + manual button.**
- Q: Calendar organization? → **One user-chosen calendar, property name in title + deterministic per-property event color** (no per-property calendars).
