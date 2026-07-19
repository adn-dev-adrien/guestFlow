# SAS breakfast — bread counter, smart defaults, serving-time push

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/sas-breakfast-bread-and-push` |
| **Created** | 2026-07-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The SAS breakfast step ([[sas-breakfast-milk-and-food]]) counts drinks and food (Viennoiseries/Céréales under an « À manger » heading), and the planning card opens a preparation popup ([[planning-breakfast-prep-popup]]). Feedback: the « À manger » heading is noise — a stronger divider is enough; viennoiseries should default to the headcount; bread (baguettes, ½ per person) is missing entirely; and the operator wants a push notification ahead of serving time that opens the preparation popup.

## 2. Goal

The breakfast step pre-fills sensible quantities (viennoiseries = persons, bread = ½ baguette per person), counts bread in half-baguette steps, and the operator receives a push notification before each breakfast's serving time — tapping it opens the planning preparation popup for that breakfast.

## 3. Functional rules

### SAS step (À manger section)

1. The « À manger » heading is removed; the section is separated from the drinks by a **stronger horizontal divider** (thicker/darker than the thin row dividers).
2. New counter **« Pain (baguette) »** after Viennoiseries and Céréales, stepping by **0,5** (French display « 1,5 »), stored in `reservations.breakfastBread` (REAL ≥ 0, multiples of 0.5, server-clamped).
3. **Smart defaults, server-computed** (fat backend): while the arrival SAS has **never been committed** (`arrivalSasDoneAt` NULL), `getForReservation` returns `pastries = persons` and `bread = persons × 0,5`; after a commit it returns the stored values (an explicit 0 stays 0). Céréales default to 0. The client renders what the server sends — no client-side defaulting.
4. The « X à manger pour Y personnes » hint keeps counting viennoiseries + céréales only (bread is in baguettes, a different unit) and keeps its non-blocking confirm behavior.

### Preparation popup & planning card

5. The popup and the planning card chips gain « Pain » with a baguette pictogram (custom `BaguetteIcon`, mdi « baguette » glyph — same approach as `WheatIcon`), displayed « Pain × 1,5 » (French decimal comma), only when > 0. Popup line order: Viennoiseries, Céréales, Pain.

### Push notification

6. New push preference **`breakfast`** (« Petit déjeuner » switch in Réglages → Notifications push), default ON — same 3-layer default-ON resolution as the existing prefs.
7. A scheduled pass (per-minute tick + boot pass, `arrivalDeparturePushRunner` idiom) sends one push per breakfast item of the day when local time reaches **serving time − lead**, where lead = `options.breakfastNotifyLeadMinutes` on the breakfast option (INTEGER minutes, **default 30**, configurable 0–240 on the breakfast option's edit form next to the default-time field). Send time clamped to 00:00 (no previous-day sends).
8. **Once per reservation per day**: guard column `reservations.breakfastNotifiedDate` (`YYYY-MM-DD` of the last notified breakfast day, same stamp-and-compare semantics as `arrivalNotifiedAt`). Boot `firstRun` stamps already-due items without sending (no restart flood).
9. Payload: title « Petit déjeuner {HH:MM} », body « {clientName} · {propertyName} — {persons} petit(s) déjeuner(s) », tag `guestflow-breakfast-{reservationId}-{date}`, url `/planning?breakfast={reservationId}&date={YYYY-MM-DD}`.
10. **Tap → preparation popup**: `PlanningPage` reads `?breakfast=&date=` (deep-link util alongside `readSasDeepLink`), fetches that day's breakfast summary, opens `BreakfastPrepDialog` for the matching reservation (independent of the displayed week), then cleans the params (`replace`, like the SAS deep-link). Unknown/stale ids → params cleaned, nothing opens.

**Edge cases:**
- Breakfast time changed after the notification was sent → no re-send that day (the guard is per day, accepted).
- Several breakfasts the same morning → one push per reservation (distinct tags).
- Push not configured (no VAPID) or pref OFF → runner still stamps, sends nothing (pushService already returns `skipped`).
- Serving time − lead earlier than the server boot → boot pass stamps without sending (rule 8).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` (+ `schema.sql`) | T | `reservations.breakfastBread` REAL NOT NULL DEFAULT 0 + `reservations.breakfastNotifiedDate` TEXT; `options.breakfastNotifyLeadMinutes` INTEGER NOT NULL DEFAULT 30 in the `NEEDED` options array — **and backfill the missing `breakfastTime` entry there** (schema.sql-only today, gap found 2026-07-19); `user_push_prefs.breakfast` INTEGER NOT NULL DEFAULT 1 |
| `models/` | `reservationsModel.js` | T | `commitArrivalSas` writes `breakfastBread` (clamp ≥ 0 to 0.5 multiples); `stampBreakfastNotified(id, dateIso)` |
| `models/` | `breakfastModel.js` | T | SELECTs + items + `getForReservation` gain `bread`; `getForReservation` gains the smart defaults (needs `arrivalSasDoneAt` in its SELECT); `notifyLeadMinutes()` helper reading the breakfast option (default 30) |
| `models/` | `optionsModel.js` | T | `persistBreakfastNotifyLeadMinutes` (guarded persist, clamp int 0–240, default 30) wired in create/update |
| `models/` | `pushSubscriptionsModel.js` | T | `breakfast` joins `PREF_KEYS`/`DEFAULT_PREFS` |
| `controllers/` | `sasController.js` | T | Forward `breakfastBread` |
| `utils/` | `breakfastPushRunner.js` | C | The pass: today's items (`breakfastByDate`), due when `now ≥ time − lead`, per-(reservation, day) guard, firstRun stamping, payload building, `pushService.sendToPref('breakfast', …)` |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Per-minute tick + boot pass (105 s stagger), in-progress guard, exported |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `BaguetteIcon.js` | C | mdi « baguette » glyph via `createSvgIcon` (same as `WheatIcon`) |
| `components/sas/` | `ReservationSasDialog.js` | T | Heading removed → strong divider; « Pain (baguette) » 0.5-step counter (CountStepper gains an optional `step`/decimal display); state/payload `breakfastBread`; defaults come from the GET payload |
| `components/` | `BreakfastPrepDialog.js` | T | « Pain × 1,5 » line (BaguetteIcon) |
| `components/` | `OptionDayCard.js` | T | « Pain 1,5 » chip |
| `pages/` | `PlanningPage.js` | T | `?breakfast=&date=` deep-link effect → fetch day summary → open popup → clean params; breakfast item mapping gains `bread` |
| `pages/` | `OptionsPage.js` | T | « Préavis de notification (minutes) » number field next to the default-time field (breakfast option only) |
| `components/` | `SettingsPushNotificationsSection.js` | T | « Petit déjeuner » switch (`breakfast` pref) |
| `utils/` | `sasDeepLink.js` | T | `readBreakfastDeepLink(searchParams)` alongside `readSasDeepLink` |

**Component reuse:** `CountStepper` extended (optional step), `BaguetteIcon` new generic icon (same rationale as `WheatIcon`), everything else touched in place. No new endpoint: the deep-link reuses `GET /api/planning/breakfast`.

### 4.3 API contract (additive)

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/reservations/:id/sas` | breakfast block gains `bread` (and returns the smart defaults pre-commit) |
| POST | `/api/reservations/:id/sas/arrival` | accepts `breakfastBread` (clamped to 0.5 multiples ≥ 0) |
| GET | `/api/planning/breakfast` | items gain `bread` |
| GET/PUT | `/api/push/preferences` | gains `breakfast` boolean |
| POST/PUT | `/api/options` | accepts `breakfastNotifyLeadMinutes` (breakfast option) |

## 5. Data model

- `reservations.breakfastBread` REAL NOT NULL DEFAULT 0 (baguettes, 0.5 steps) — guarded ALTER + schema.sql.
- `reservations.breakfastNotifiedDate` TEXT (last notified day) — guarded ALTER + schema.sql.
- `options.breakfastNotifyLeadMinutes` INTEGER NOT NULL DEFAULT 30 — `NEEDED` array + schema.sql (+ `breakfastTime` backfilled into `NEEDED`, no-op where it already exists).
- `user_push_prefs.breakfast` INTEGER NOT NULL DEFAULT 1 — guarded ALTER + schema.sql.
No data impact: all defaults are correct for existing rows.

## 6. UI / UX

- **SAS step**: drinks hint, then a **thicker divider** (e.g. `borderBottomWidth: 2-3`, `borderColor: 'text.disabled'`-ish), then Viennoiseries / Céréales / Pain (baguette) steppers, then the food hint (unchanged scope). Bread stepper shows « 1,5 » (comma); − disabled at 0.
- **Options page (breakfast option)**: below « Heure du petit-déjeuner (par défaut) », a number field « Préavis de notification (minutes) », helper « La notification push part X minutes avant l'heure de service. 30 min par défaut. ».
- **Push settings**: 4th switch « Petit déjeuner ».
- **Notification**: French title/body per rule 9; tap opens the popup (existing sw.js handles focus/navigate).
- **Responsive**: no new surfaces beyond existing patterns; steppers/popup unchanged layouts.

## 7. Test plan

### Server unit tests — 2071 pass (full suite, 2026-07-19)
- [x] `breakfast-push-runner.unit.test.js` (NEW, 7 tests) — due at time−lead (not before), per-day guard, firstRun stamps without sending, payload/tag/url shape, lead 0/override, `subtractMinutes` 00:00 clamp, per-item fault isolation
- [x] `push-subscriptions-model` (extended) — `breakfast` pref fan-out + default ON + opt-out
- [x] `options-model-auto-type-and-lead.unit.test.js` (NEW) — lead persist/clamp on create/update, **and the `autoOptionType` preservation regression** (see bugs below)
- [x] `breakfast-model.unit.test.js` (extended) — `bread`/`notifiedDate` on items; smart defaults pre-commit vs stored post-commit; `notifyLeadMinutes` clamp; **from=to=endDate window regression**
- [x] `sas-commit.unit.test.js` (extended) — `breakfastBread` 1.3 → 1.5 clamp, omitted → 0

### Client tests
- [x] Vitest (668 pass): SAS dialog (bread 0,5 stepping + French comma display + payload + server defaults rendered), BreakfastPrepDialog (Pain × 1,5), `readBreakfastDeepLink` unit, push settings 4th switch + toggle persistence
- [x] E2E: 32 pass / 1 skipped

### Manual UI verification (2026-07-19, dev — reservation 22224, data reset afterwards)
- [x] Fresh SAS (never committed): strong divider without heading, Viennoiseries pre-filled 3 (= persons), Pain pre-filled 1,5 (= persons × 0,5), 0,5 stepping with comma display; left without committing to preserve state
- [x] Prep popup via deep-link `/planning?breakfast=22224&date=2026-07-20`: opens with Pain × 1,5 (baguette pictogram), URL cleaned
- [x] Options page: « Préavis de notification (minutes) » round-trips (45 persisted, then reset to 30)
- [x] Mobile 375px: step fully usable
- [ ] **Real device push not exercised** (needs a subscribed device + VAPID on this dev machine) — the runner logic is covered by its 7 unit tests; to be observed on the Pi after deploy

### Bugs found & fixed during verification (same PR)
1. **`optionsModel.update` stripped `autoOptionType` on every form save** (`payload.autoOptionType || null` while the Options form never sends the key) — one save of the breakfast option silently killed the planning card / SAS step / push. Now preserved when the key is absent; explicit null still clears.
2. **`breakfastByDate` window predicate `endDate > from` (strict)** dropped the departure-morning breakfast when the window collapses to that day (`from = to = endDate`) — exactly what the push runner and the deep-link query. Now `>=` per rule 4 (departure-day morning included).

## 8. Out of scope

- Bread in the « à manger » coherence hint (different unit).
- Per-reservation lead-time overrides; re-send when the time changes after notification.
- Notification content configuration.

## 9. Open questions

Resolved 2026-07-19 with Adrien: lead defaults to 30 min **before** serving time, configurable on the breakfast option's settings (the existing « page des petits déj »).
