# Server time zone

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/server-timezone` |
| **Created** | 2026-09-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On 2026-09-25 guests checked into La Granja at 16:00 and no arrival notification reached the
operator's phones. The push was not lost — it was scheduled two hours late.

Four of GuestFlow's schedulers compare an operator-entered **wall-clock** time against the Node
process's **local** time:

| Trigger | Compares | File |
|---|---|---|
| Arrival push | `checkInTime` (e.g. `16:00`) ≤ `hhmm(now)` | [arrivalDeparturePushRunner.js](server/src/utils/arrivalDeparturePushRunner.js) |
| Departure push | `checkOutTime` (e.g. `10:00`) ≤ `hhmm(now)` | same |
| Breakfast push | same shape | [breakfastPushRunner.js](server/src/utils/breakfastPushRunner.js) |
| Daily guest e-mail pass | `now.getHours() < 8` | [emailAutoSendScheduler.js:94](server/src/utils/emailAutoSendScheduler.js#L94) |

All four read `Date#getHours`, and they all share `isoToday(now)` for "which local day is it".

Production moved to VM 104 on 2026-08-10, a host whose clock is `Etc/UTC`
(`/etc/localtime → /usr/share/zoneinfo/Etc/UTC`). Nothing sets `TZ` — not `ecosystem.config.js`, not
the code — so the process runs in UTC while every stored time means Corsica. Measured on production
that day at 14:18 UTC (16:18 in Paris), reservation 13 (arrival `2026-09-25` `16:00`) still had an
empty `arrivalNotifiedAt`: the push was due to fire at 16:00 **UTC**, i.e. 18:00 local.

The offset is +2 h under CEST and +1 h under CET, so it also moves twice a year. Every arrival since
2026-08-10 was notified late; nobody noticed because a late push still looks like a push.

The formatting side of the app was never affected: `googleCalendarEvents.js`, `termsController.js`,
`meteoVigilance.js` and `settingsResponse.js` already pass `timeZone: 'Europe/Paris'` explicitly.
Only the *triggers* read the ambient clock.

## 2. Goal

A check-in saved as `16:00` notifies the operator at 16:00 in Corsica, on any host, in summer and in
winter — without each scheduler having to know about time zones.

## 3. Functional rules

1. The server process runs in `Europe/Paris` by default. Every scheduler keeps reading the ambient
   clock; the process is what guarantees the clock is right.
2. The zone is applied **before anything reads the clock** — the first statement of
   `server/src/index.js`, ahead of every other `require`.
3. An inherited `TZ` never decides the zone. It is overwritten. A base image or a host that exports
   `TZ=UTC` by default is precisely how this regression got in, and nothing distinguishes such a
   default from a deliberate choice.
4. The deliberate choice has a name of its own, `GUESTFLOW_TZ`, which no base image sets by
   accident. When set to a zone the runtime supports, it wins.
5. A `GUESTFLOW_TZ` the runtime cannot use logs one warning and falls back to `Europe/Paris`. A
   typo must not take the server down, and must not silently leave it in UTC either.
6. The boot marker states the effective zone and the local time, so the next time a trigger looks
   late the answer is in the first line of the log.

**Edge cases:**
- `GUESTFLOW_TZ` set to whitespace → treated as unset → `Europe/Paris` (rule 1).
- DST changeover → nothing to do: the zone is named, not an offset, so CEST/CET follow themselves.
- Host already in `Europe/Paris` (the dev machines) → the assignment is a no-op in practice; the
  fix changes nothing locally, which is why local tests never caught the bug.
- First pass after the restart that ships this fix → `firstRun` still stamps without sending
  (`specs/pwa-push-notifications.md` rule 12), so already-due arrivals of that day are skipped, not
  replayed. The arrival that triggered this spec is deliberately let go.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `serverTimezone.js` | C | Resolves the zone (`GUESTFLOW_TZ` → default → fallback) and writes `process.env.TZ`. Pure + injectable. |
| `index.js` | `index.js` | T | Calls `applyServerTimezone()` as its first statement; boot marker reports the zone. |
| `routes/` | — | — | (none) |
| `controllers/` | — | — | (none) |
| `models/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none — the runners are deliberately left untouched) |
| `database.js` | — | — | (none) |

**Notes:**
- Node ≥ 16 drops its cached zone when `process.env.TZ` is assigned, so `Date` objects built after
  the call read the new zone. Node 24.19 in production.
- No new dependency.
- The alternative — making `isoToday`/`hhmm` compute in `Europe/Paris` via `Intl` — was rejected:
  it requires finding every reader of the ambient clock, and an omission fails silently, which is
  the exact failure mode this spec exists to close.

### 4.2 Client side (`client/src/`)

Not touched. The client renders what the server sends; the bug was a trigger, never a display.

**Component reuse declaration:** none — no UI in this change.

### 4.3 API contract

Unchanged.

---

## 5. Data model

No schema change.

**Data impact:** none. `arrivalNotifiedAt` / `departureNotifiedAt` / `breakfastNotifiedDate` hold a
local date (`YYYY-MM-DD`); rows stamped while the server ran in UTC stay valid — UTC and Paris only
disagree on the date between 00:00 and 02:00 local, outside any check-in or check-out hour.
SQLite's `datetime('now')` defaults (e.g. `push_subscriptions.createdAt`) are UTC by definition and
are unaffected by `TZ`.

## 6. UI / UX

No screen changes. The user-visible effect is that the notification
« Arrivée 16:00 — <client> · <logement> » arrives at 16:00 instead of 18:00.

## 7. Test plan

### Server unit tests
- [x] `tests/server-timezone.unit.test.js` — 8 cases, one per rule 1–6, including the regression
      itself: starting from `TZ=UTC`, `2026-09-25T14:00:00Z` reads as 14 h before the call and 16 h
      after, and as 15 h in January (DST is followed, not hard-coded). Rule 2 is checked on the
      source of `index.js`: the first `require` must be `./utils/serverTimezone`, because a require
      added above it would load modules while the process is still in the host's zone.

### Manual verification
- [x] The real runner replayed against reservation 13's data (arrival `2026-09-25` `16:00`) at the
      instant the guests arrived, on a process forced to `TZ=UTC`: no notification without the fix,
      « Arrivée 16:00 — Françoise Dausque · Granja » with it.
- [ ] After the release is installed: the boot marker in `pm2 logs guestflow` reads
      `timezone Europe/Paris`, and the next arrival notifies at its check-in time.

## 8. Out of scope

- Multi-zone support (a property in another time zone). One establishment, one zone.
- Making the zone configurable from Réglages. It is a deployment property, not a business setting.
- `emailAutoSendScheduler`'s `lastRunDate` living in memory, so a restart replays the day's pass —
  pre-existing, orthogonal to the zone.
- Backfilling the notifications that fired late between 2026-08-10 and this release. They fired.

## 9. Open questions

- Q: Should an inherited `TZ` be honoured rather than overwritten?
  - A (2026-09-25): No. Honouring `TZ` was the first implementation and it reproduced the bug under
    test: a container exporting `TZ=UTC` would have been obeyed. `GUESTFLOW_TZ` is the override
    because it can only be set on purpose.
