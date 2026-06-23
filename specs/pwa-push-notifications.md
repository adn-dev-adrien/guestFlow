# PWA push notifications (new reservation + arrivals/departures), per-user preferences

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/pwa-push-notifications` _(user-managed)_ |
| **Created** | 2026-06-14 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow is a web app (React 18 + Vite, Express + better-sqlite3, **session-cookie** auth — `req.user`
from `req.session.user`, multi-user with roles). It has **no PWA** (no manifest, no service worker, no
`vite-plugin-pwa`) and **no Web Push** (`web-push` not a dependency, no VAPID, no subscriptions). Today the
only "new reservation" signal is an **email** (`notificationService.notifyNewIcalReservation` /
`notifyNewSiteDevis`), and the only time-based job pattern is `scheduledTasks.js` (a per-minute
`setInterval` tick with a local-hour gate + once-per-day guard, used by the 08:00 email auto-send).

The operator wants **push notifications on their phone/desktop** (installed PWA) for: a **new reservation**
(iCal import + site devis), and **each arrival/departure at its scheduled time** — with **per-user**
control over which notifications each person receives.

## 2. Goal

Each user can **install GuestFlow as a PWA**, **enable push on their device**, and **choose** which pushes
they get: **new reservation**, **arrivals**, **departures**. The server sends a Web Push when (a) a new
iCal reservation or site devis is created, (b) a reservation's **check-in time** is reached (arrival), (c) a
reservation's **check-out time** is reached (departure) — only to the users (and devices) that opted in.

## 3. Functional rules

### 3.1 PWA + device subscription
1. The app becomes an **installable PWA**: a web manifest (name, icons from the existing logo, standalone
   display, theme color) + a **service worker** registered on load. The SW handles `push` (show a
   notification) and `notificationclick` (focus/open the app at the relevant route).
2. **Per device opt-in.** On the settings page, a **« Activer les notifications sur cet appareil »** action
   requests the browser Notification permission, subscribes via `PushManager.subscribe({ applicationServerKey
   = VAPID public key, userVisibleOnly: true })`, and POSTs the subscription to the server, stored against
   the **logged-in user**. A **« Désactiver »** action unsubscribes + removes it server-side.
3. Subscriptions are **per (user, device)**: one user can have several (phone + laptop). A subscription that
   the push service reports as gone (HTTP 404/410) is **pruned** automatically.
3.bis. **Stale-VAPID-key self-heal (2026-06-16 fix).** A subscription stays bound to the VAPID key it was
   created with. If the server's VAPID key is ever regenerated, every send to the old subscriptions is
   rejected (Apple returns **403**) — silently, since they aren't 404/410. On enable, `enablePush` now
   compares the existing subscription's `applicationServerKey` to the current server key and, on mismatch
   (or when the browser doesn't expose it), **drops the stale subscription (server-side too) and
   re-subscribes** with the current key. The server also logs the push service's **reason body** on a
   non-404/410 failure, so a key mismatch is diagnosable from `pm2 logs`. *(Root cause of the 2026-06-16
   prod incident: both iPhones were bound to a previous VAPID key after a regeneration, so no notification
   fired on a new reservation.)*
3.ter. **Valid VAPID `sub` subject (2026-06-23 fix).** The JWT `sub` claim (the VAPID contact) **must be a
   routable URL/mailto**. The previous default `mailto:contact@guestflow.local` used the reserved `.local`
   mDNS TLD, which Apple's push gateway rejects with **`403 BadJwtToken`** — distinct from the 3.bis
   key-mismatch 403, and **not** fixable by re-subscribing (the public key matches; only the JWT subject is
   bad). The default is now `mailto:contact@domainesolio.com` (a real, routable domain), overridable per
   deployment via `VAPID_SUBJECT` in `.env.local`. *(Root cause of the 2026-06-23 incident: every push to
   both iPhones failed silently with `403 BadJwtToken`.)*
3.quater. **Self-test push.** From the push settings card, an operator with notifications enabled can send a
   **test notification** to all of their own devices (ignoring preferences). This is the only way to verify
   the full pipeline without waiting for a real business event; it surfaces the fan-out result
   (`sent` / `no subscription` / `no VAPID` / send failure) to the UI.

### 3.2 Per-user preferences
4. Each user has three independent push preferences — **newReservation**, **arrivals**, **departures** —
   default **all ON**. They are **per user** (not global): they gate which pushes that user's devices
   receive. Editable on the settings page.
5. A push for a given type is sent to a device only if its user's matching preference is ON **and** the
   device is subscribed.

### 3.3 Triggers
6. **New reservation** — when the iCal sync imports a genuinely new reservation
   (`propertyIcalModel` `createdReservationIds`, the existing notify point) **or** a new **site devis** is
   created (`notifyNewSiteDevis` point): push « Nouvelle réservation {plateforme} » / « Nouvelle demande de
   devis » (title) with body « {client} · {logement} » (+ « — dès le {date} » for an iCal reservation) to
   every user with `newReservation` ON. Fired post-commit
   alongside the existing email, in a contained try/catch (§3.4) so it never affects the sync / booking
   response. Each new-reservation push **deep-links to the created item** — a reservation →
   `/reservations/:id`, a site devis → `/reservations/new?mode=devis&devisId=:id` — and is sent **once per
   reservation** (the iCal notify point loops `createdReservationIds`). Already implemented; unchanged this
   iteration.
7. **Arrival** — at the reservation's **check-in time** on its `startDate`: push « Arrivée aujourd'hui à
   {checkInTime} — {client} · {logement} » to every user with `arrivals` ON. Sent **once per reservation**
   (guarded by `arrivalNotifiedAt`). **Clicking it opens the arrival SAS** for that reservation (deep-link
   `/planning?sas=arrival&reservationId=:id`, rule 10) — not the bare reservation page.
8. **Departure** — at the reservation's **check-out time** on its `endDate`: push « Départ aujourd'hui à
   {checkOutTime} — {client} · {logement} » to every user with `departures` ON. Once per reservation
   (`departureNotifiedAt`). **Clicking it opens the departure SAS** (deep-link
   `/planning?sas=departure&reservationId=:id`, rule 10).
9. The arrival/departure job runs on the **existing per-minute tick** (`scheduledTasks.js`): each minute it
   finds reservations of **today** whose scheduled time **has just been reached** (scheduled `HH:MM` ≤ now,
   local) and **not yet notified** (`*NotifiedAt` ≠ today), sends the pushes, and stamps `*NotifiedAt`. A
   reservation created/booked *after* its time already passed today is **not** retro-notified (only
   "reached this minute or earlier today and not stamped" — to avoid a flood on boot, the stamp also
   back-dates events already long past at first run; see §3.4).
10. **Deep-link routing (this iteration).** The notification `data.url` is opened by the SW's
    `notificationclick` (focus an existing tab + `navigate`, else open a new window). **Arrival/departure**
    pushes now target `/planning?sas=arrival|departure&reservationId=:id`. **PlanningPage** reads these query
    params on mount, opens the matching `ReservationSasDialog` (mode arrival / departure) for that
    reservation, then clears the params (history `replace`) so a refresh / back doesn't reopen it. The SAS
    dialog loads the reservation by id, independent of the planning's current week. A stale link (deleted
    reservation) just shows the dialog's not-found state. New-reservation pushes keep their
    `/reservations/:id` (resp. devis) target.
11. **Content (this iteration).** Every push shows both the **client name** and the **property name** in its
    body — format « {client} · {logement} » (with « — dès le {date} » on the new-reservation push, and the
    time in the arrival / departure title). The iCal new-reservation push gains the guest name
    (`icalOriginalSummary`, else the linked client's first / last name); the site-devis, arrival and
    departure pushes already carry both.

### 3.4 Robustness (no regressions — explicitly tested, not "best-effort")
10. **Push is fully isolated from the core flows.** Sending a push must **never** affect the iCal sync, the
    booking/devis creation, the reservation save, or the scheduled tick. Every push send is wrapped so a
    failure (no VAPID, no subscription, a browser-endpoint 4xx/5xx, a network error) is caught + logged and
    **cannot propagate** to the caller. This isolation is a **correctness requirement** and is covered by
    tests (a throwing push stub must leave `notifyNewIcalReservation` / the tick returning normally and the
    reservation intact). It is **not** a licence for sloppy code — the push code itself is clean,
    structured, and unit-tested on its own.
11. **VAPID keys** are generated once on first boot into `server/.env.local` (same pattern as the session
    secret / PUBLIC_API_KEY) and never committed. The **public** key is exposed via an endpoint for the
    client subscription; the **private** key stays server-side.
12. **No double-fire / no boot flood.** On the very first arrival/departure tick after boot, reservations
    whose time is **already in the past today** are stamped as notified **without** sending (so a restart at
    14:00 doesn't blast every morning arrival). Only events crossing their time **while the server is
    running** notify. (Decision — avoids a restart spamming the day's past events.)

**Edge cases:**
- User denies the browser permission → the device isn't subscribed; the UI reflects "non activées".
- A reservation's time is edited earlier/later → the guard is the date stamp; moving it forward (still
  today, not yet stamped) can re-arm; moving an already-stamped one doesn't re-fire (acceptable).
- No subscribed users / all prefs off → nothing sent (cheap no-op).
- HTTPS: prod serves HTTPS (self-signed) on the Pi; Web Push requires a secure context — OK on prod and on
  `localhost` in dev.

---

## 4. Architecture

> **Fat backend, thin frontend.** Subscription storage, preference gating, VAPID, the send fan-out, and the
> time-based detection live on the server. The client registers the SW, subscribes the device, and renders
> the preference toggles.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| deps | `server/package.json` | T | Add `web-push`. |
| `utils/` | `vapid.js` | C | Load/generate the VAPID keypair from `.env.local` (`web-push.generateVAPIDKeys()` on first run); expose `{ publicKey, configured }` + configure `web-push`. The `sub` subject must be a routable URL/mailto (default `mailto:contact@domainesolio.com`; `VAPID_SUBJECT` overrides) — see rule 3.ter. |
| `utils/` | `pushService.js` | C | `sendToPref(prefKey, payload)`: gather subscriptions of users whose `prefKey` is ON, `web-push.sendNotification` each, prune 404/410, count `failed`. `sendToUser(userId, payload)`: same fan-out to one user's own devices (test push). Both injectable for tests, never throw. |
| `models/` | `pushSubscriptionsModel.js` | C | CRUD on `push_subscriptions` (add/list-by-user/list-for-pref/remove-by-endpoint/prune); per-user prefs read/write (`user_push_prefs`). |
| `controllers/` | `pushController.js` | C | `getPublicKey`, `subscribe`, `unsubscribe`, `getPreferences`, `updatePreferences` (all scoped to `req.user`). |
| `routes/` | `push.js` | C | `GET /push/public-key`, `POST/DELETE /push/subscribe`, `GET/PUT /push/preferences`, `POST /push/test`. Mounted under `/api/push` (auth-required). |
| `utils/` | `notificationService.js` | T | After the email send in `notifyNewIcalReservation` / `notifyNewSiteDevis`, also `pushService.sendToPref('newReservation', …)`, in a contained try/catch so a push failure can't affect the email path or the caller. The new-reservation push body includes the **client / guest name + property name** (rule 11). |
| `scheduledTasks.js` | `scheduledTasks.js` | T | New per-minute job: detect today's arrivals (check-in reached) + departures (check-out reached) not yet notified → `sendToPref('arrivals'/'departures', …)` + stamp. First-run back-stamp guard (§3.4). |
| `utils/` | `arrivalDeparturePushRunner.js` | T | Set the arrival/departure push `url` to the SAS deep-link `/planning?sas=arrival\|departure&reservationId=:id` (was `/reservations/:id`). |
| `models/` | `reservationsModel.js` | T | `dueArrivals(todayIso, nowHHMM)` / `dueDepartures(...)` → reservations of today whose time ≤ now and `*NotifiedAt` ≠ today (+ a `stampArrivalNotified` / `stampDepartureNotified`). |
| `database.js` | `database.js` | T | Migrations: `push_subscriptions` table; `user_push_prefs` table (or columns); `reservations.arrivalNotifiedAt` / `departureNotifiedAt` TEXT. |

### 4.2 Client side (`client/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `public/` | `manifest.webmanifest` | C | PWA manifest (name « GuestFlow », icons = existing logo SVG/PNG, `display: standalone`, theme/bg color). Linked from `index.html`. |
| `public/` | `sw.js` | C | Service worker: `push` → `showNotification(title, { body, icon, data.url })`; `notificationclick` → focus/open `data.url`. No offline caching (push-only). |
| `src/` | `push/registerPush.js` | C | Register the SW; `enablePush()` (permission → subscribe → POST), `disablePush()`, `getState()`; reads the VAPID public key from `GET /push/public-key`. |
| `components/` | `SettingsPushNotificationsSection.js` | C | « Notifications push » card: device enable/disable button + 3 preference switches (nouvelle réservation / arrivées / départs). Mirrors `SettingsNotificationsSection`. |
| `pages/` | `SettingsPage.js` | T | Mount the new section; load/save per-user prefs via the push API (separate from the global settings payload). |
| `api.js` | `api.js` | T | `getPushPublicKey`, `subscribePush`, `unsubscribePush`, `getPushPreferences`, `updatePushPreferences`. |
| `index.html` / `main` | `client/index.html`, `client/src/index.js` | T | Link the manifest; register the service worker on load. |
| `pages/` | `PlanningPage.js` | T | On mount, read `?sas=arrival\|departure&reservationId=:id` and open the matching SAS (`ReservationSasDialog`); clear the params after (history replace). The SAS open handlers already exist. |

**No vite-plugin-pwa / workbox** — a hand-written minimal service worker + manifest is enough for
installability + push, and avoids precache/build complexity (no offline requirement).

### 4.3 API contract (all under `/api/push`, auth required)

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/push/public-key` | — | `{ publicKey, configured }` |
| POST | `/push/subscribe` | `{ subscription }` (the `PushSubscription` JSON) | `{ ok }` |
| DELETE | `/push/subscribe` | `{ endpoint }` | `{ ok }` |
| GET | `/push/preferences` | — | `{ newReservation, arrivals, departures }` (the caller's) |
| PUT | `/push/preferences` | `{ newReservation?, arrivals?, departures? }` | updated prefs |
| POST | `/push/test` | — | `{ sent, pruned, failed, skipped? }` (test push to the caller's own devices) |

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_push_prefs (
  userId INTEGER PRIMARY KEY,
  newReservation INTEGER NOT NULL DEFAULT 1,
  arrivals INTEGER NOT NULL DEFAULT 1,
  departures INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
-- reservations: once-per-event push guards
ALTER TABLE reservations ADD COLUMN arrivalNotifiedAt TEXT;
ALTER TABLE reservations ADD COLUMN departureNotifiedAt TEXT;
```

VAPID keys live in `server/.env.local` (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`), auto-generated on first
boot. **Data impact:** additive; no existing rows changed. A user with no `user_push_prefs` row defaults to
all-ON (read returns defaults).

## 6. UI / UX

- **Settings → « Notifications push » card** (per user):
  - Status line + **« Activer sur cet appareil »** / **« Désactiver »** button (reflects permission +
    subscription state; disabled with a hint when the browser doesn't support push).
  - Three switches: **Nouvelle réservation**, **Arrivées**, **Départs** (default ON). Saved per user.
  - When enabled, a **« Envoyer une notification de test »** button pushes to all the account's devices
    (rule 3.quater). A success alert reports the device count; a failure / no-subscription / no-VAPID case
    shows an error alert (the user should background or lock the screen to actually see the notification).
  - Helper: « Les notifications s'affichent même quand GuestFlow est fermé, sur cet appareil. »
- **Notification content** (native): title + body as in §3.3. Clicking a **new-reservation** push opens the
  reservation (`/reservations/:id`) / its devis; clicking an **arrival/departure** push opens the matching
  **SAS** (`/planning?sas=arrival|departure&reservationId=:id`, §3.3 rule 10). Icon = GuestFlow logo.
- **Responsive:** the settings card is full-width on `xs`; the install prompt is the browser's own.
- **PageActionBar:** N/A (content inside the settings page).

## 7. Test plan

### Server unit tests (suite 1531 green)
- [x] `push-subscriptions-model.unit.test.js` — subscribe (upsert by endpoint) / unsubscribe / remove;
      `subscriptionsForPref` gates on the pref (default ON when no row); prefs default all-ON, partial update.
- [x] `push-service.unit.test.js` — `sendToPref` sends to exactly the opted-in subscribers (injected
      web-push stub); prunes on 404/410; a transient error keeps the sub; **no VAPID → no model access**;
      **never throws** even if the model throws (isolation). `sendToUser` fans out to all the user's devices
      ignoring prefs, skips `no_subscription` / `no_vapid`, and counts transient failures in `failed`.
- [x] `arrival-departure-push.unit.test.js` — real `reservationsModel.dueArrivals/dueDepartures` (today +
      time reached + not stamped, excludes other days/stamped) → send + stamp once; **firstRun stamps
      without sending** (no restart flood). The arrival/departure push `url` is the **SAS deep-link**
      `/planning?sas=arrival|departure&reservationId=:id` (rule 10).
- [x] `notification-service.unit.test.js` (extended) — `notifyNewIcalReservation` / `notifyNewSiteDevis`
      fire a `newReservation` push **independent of email settings**; a **throwing push never breaks the
      email path** (isolation). Push body asserts « {voyageur/client} · {logement} » (rule 11).
- [x] Migrations are idempotent (existing `CREATE TABLE IF NOT EXISTS` + `tryAdd`-style guards); full suite
      green. Boot verified live on the real DB (tables + reservation guard columns created, VAPID generated).

### Client (vitest → 468 green)
- [x] `sasDeepLink.test.js` (this iteration) — `readSasDeepLink` parses a valid arrival/departure deep-link,
      rejects unknown mode / missing-zero-negative-NaN id / unrelated params, and is null-safe. PlanningPage's
      mount effect (open SAS + clear params) is verified by the green build + manual check (the page's heavy
      data-fetch surface makes a full mount test low-value / fragile).
- [x] `SettingsPushNotificationsSection.test.js` — unsupported → info (no button); enable button calls
      `enablePush`; enabled state shows « Désactiver » + 3 switches; toggling a switch calls
      `updatePushPreferences`.
- [x] `registerPush.test.js` — `pushSupported()` false in jsdom; `registerServiceWorker()` resolves null
      (never throws); `enablePush()` rejects with a French message when unsupported.

### Manual / live verification (server-side done 2026-06-14)
- [x] Server boots clean on the real DB; VAPID auto-generated to `.env.local`; `GET /push/public-key`
      (configured), `GET/PUT /push/preferences` (defaults all-ON, persist) all 200; dev prefs reset after.
- [ ] Install the PWA + enable push in a browser, then: iCal import / site devis → push; a check-in/out
      time reached → arrival/departure push (once); pref OFF → no push; device disable → no push. (Browser
      pass on the user's environment, before release.)

## 8. Out of scope

- Offline caching / full Workbox PWA (push + installability only).
- iOS Safari push (works only for an installed PWA on iOS 16.4+; supported where the browser allows, not
  specially handled).
- Per-property or per-platform push filtering (a push fires for any property; filtering is a later spec).
- Replacing the existing email notifications (push is added alongside).
- Daily summary push (decision: per-event at the scheduled time, not a morning digest).

## 9. Open questions — resolved 2026-06-14

- **Q1 — VAPID storage:** → **`.env.local`** (matches the existing session-secret / PUBLIC_API_KEY pattern;
  never committed).
- **Q2 — arrival/departure precision:** → **per-minute tick is fine** (doesn't need to be exact —
  confirmed by the user). Fires at the first minute ≥ the scheduled `HH:MM`.
- **Q3 — notification grouping:** → **one push per arrival/departure** event.

## 10. Implementation guardrails (no regressions)

- The service worker is registered **only when supported** (`'serviceWorker' in navigator`) and its absence
  changes nothing — the app behaves identically for users who never enable push. The manifest link is inert
  for non-PWA use.
- `scheduledTasks.js`: the new arrival/departure job is added **without touching** the existing iCal-sync /
  school-holidays / email-auto-send jobs; the per-minute tick stays a single tick with the new job appended,
  each job independently try/caught so one can't break another.
- `notificationService.js`: the push call is added **after** the existing email send and its failure is
  contained — the email behaviour and its current tests are unchanged.
- New tables/columns are additive idempotent migrations; **no existing column/table is altered**.
- Full server suite + full client vitest must stay green; the feature ships only with its own tests added
  on top.
