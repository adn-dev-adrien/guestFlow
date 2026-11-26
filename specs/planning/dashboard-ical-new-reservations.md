# Dashboard card — new reservations of the last 24 hours

| Field | Value |
|---|---|
| **Status** | Implemented — amendment of 2026-10-06 (24-hour window, every origin) validated and implemented the same day |
| **Branch** | `feature/dashboard-ical-new-reservations` (2026-06-08), `feature/dashboard-new-reservations-24h` (2026-10-06) |
| **Created** | 2026-06-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Amended** | 2026-10-06 — rolling 24-hour window instead of the UTC day; every new reservation, not only iCal imports |

---

## 1. Context

iCal sync silently imports platform bookings (Airbnb, Booking, …) into the `reservations`
table as `sourceType='ical'` rows (anti-overbooking). Today there is **no signal** on the
dashboard when a new booking arrives via iCal — the operator only discovers it by scanning the
calendar. The dashboard already surfaces iCal-related alert cards (cancellations, date drifts)
with a consistent, self-contained pattern (`IcalCancellationAlert`, `IcalDateDriftAlert` →
`GET /api/dashboard/ical-*`). This feature adds a sibling **informational** card announcing the
iCal reservations imported during the current day, each clickable to open its reservation page.

**Amendment 2026-10-06.** Two shortcomings showed up in use:

- The window was the **UTC calendar day**. A booking imported at 23:50 UTC vanished ten minutes
  later; one imported at 01:00 local time (23:00 UTC the day before) was already gone at breakfast.
  How long a reservation stayed visible depended on the time it arrived, from a few minutes to 24 h.
- Only **iCal imports** were listed. Bookings paid on the website (a public devis converted into a
  reservation) and reservations entered in GuestFlow never appeared, although they are new bookings
  too.

## 2. Goal

On the dashboard, the operator sees at a glance every reservation created during the **last 24
hours**, whatever its origin, and can click one to jump straight to its reservation page. Each
reservation stays visible for exactly 24 hours after its arrival.

## 3. Functional rules

1. The card lists every reservation with `kind = 'reservation'` whose `createdAt` is within the
   **last 24 hours**, whatever its `sourceType` (iCal import, website booking, reservation entered
   in GuestFlow). *(Amended 2026-10-06 — was: `sourceType = 'ical'` only.)*
2. The window is **rolling**: `datetime(createdAt) > datetime('now', '-24 hours')`, both sides in UTC
   as stored. A reservation leaves the card exactly 24 hours after its creation, whatever the time
   it arrived. No acknowledgement, no persistence, no new table. *(Amended 2026-10-06 — was: the
   UTC calendar day, `date(createdAt) = date('now')`.)*
3. Each entry shows: guest name, property name, its origin (rule 9), the stay dates
   (`startDate → endDate`), and a relative "arrived X ago" timestamp.
4. **Clicking an entry navigates to `/reservations/:id`** (the existing reservation page, which
   loads the reservation by id for review/edit).
5. The card is **read-only** — no approve/reject/dismiss actions (unlike the cancellation/drift
   cards). It is purely a notification; it clears itself the next day.
6. Entries are ordered **most-recently-imported first** (`createdAt DESC`).
7. When there are no qualifying reservations, the card **renders nothing** (returns `null`), same as
   the other dashboard alert cards.
8. The payload is **fully shaped server-side** (fat backend): the client renders ready fields
   (`clientName`, `propertyName`, `platformLabel`, `startDate`, `endDate`, `createdAt`,
   `reservationId`). No client-side date math beyond the shared relative-time/format helpers already
   used by the sibling cards.
9. *(Added 2026-10-06.)* `platformLabel` names the origin of the booking, computed server-side in
   this order:
   - an **iCal import** → the iCal source name, else `formatPlatformName(sourcePlatformKey)`
     (unchanged);
   - a reservation **converted from a website devis** (a devis with `requestOrigin = 'public'` whose
     `convertedReservationId` is this reservation) → `Site`;
   - otherwise → `platformDisplayName(platform)` (`utils/attributionChannel.js`, the label the
     « Canaux de réservation » card already uses: `Booking`, `Gîtes de France`, `GreenGo`…), except
     `direct`, stored lowercase for equality checks and shown as `Direct`; empty when none.
10. *(Added 2026-10-06.)* The card **refetches every 5 minutes** while the dashboard stays open, so a
    reservation leaves the card at the end of its 24 hours, and a new one appears, without a reload.

**Edge cases:**
- A reservation imported today then deleted the same day → it disappears from the card (the query
  reads live `reservations`, joined, so a deleted row is simply absent).
- A reservation created 25 hours ago but whose stay is today → **not** shown (the card is about the
  *arrival* event, not the stay).
- A reservation created at 23:50 one evening → still shown until 23:50 the next evening.
- A reservation entered in GuestFlow → shown (amended 2026-10-06; it used to be excluded).
- A devis (`kind='devis'`) → never shown, even a website request; those have their own card
  (`DevisPublicRequestAlert`, specs/site-booking-notifications.md). Once paid and converted, the
  new reservation row appears here, its `createdAt` being the conversion time.
- Many imports in one day → all are listed (bounded in practice; a daily feed rarely imports more
  than a handful). No artificial cap in v1.

---

## 4. Architecture

> **Fat backend, thin frontend.** The server returns a ready-to-render list; the client only maps it
> to rows and handles the click navigation + the (shared) relative-time formatting.

The 2026-10-06 amendment renames the pieces that said "iCal" or "today", since neither is true any
more. Every rename is done in one go (client and server ship in one archive, §6.1 no-breaking-change
rule); the spec keeps its file name so existing links still resolve.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | `routes/dashboard.js` | T | `GET /api/dashboard/new-reservations` → `dashboardController.newReservations` (replaces `/ical-new-today`). |
| `controllers/` | `controllers/dashboardController.js` | T | Thin handler `newReservations` (renamed from `icalNewReservationsToday`): calls the model, returns `{ alerts }`. |
| `models/` | `models/reservationsModel.js` | T | `listNewReservations()` (renamed from `listNewIcalReservationsToday`) — the single SQL query + row shaping (joins clients / properties / ical_sources / the originating devis; computes `clientName`, `platformLabel` per rule 9). |
| `utils/` | `utils/platformNameFormat.js`, `utils/attributionChannel.js` | REUSE | `formatPlatformName` for the iCal platform key, `platformDisplayName` for the channel set on the reservation. |

**Query (model):**
```sql
SELECT r.id AS reservationId, r.startDate, r.endDate, r.createdAt,
       r.sourceType, r.sourcePlatformKey, r.platform, s.name AS sourceName,
       d.id AS siteDevisId,
       c.firstName, c.lastName, p.name AS propertyName
  FROM reservations r
  LEFT JOIN clients c        ON c.id = r.clientId
  LEFT JOIN properties p     ON p.id = r.propertyId
  LEFT JOIN ical_sources s   ON s.id = r.sourceIcalSourceId
  LEFT JOIN reservations d   ON d.kind = 'devis'
                            AND d.convertedReservationId = r.id
                            AND d.requestOrigin = 'public'
 WHERE r.kind = 'reservation'
   AND datetime(r.createdAt) > datetime('now', '-24 hours')
 ORDER BY datetime(r.createdAt) DESC, r.id DESC
```
Row shaping: `clientName = "${firstName} ${lastName}".trim() || '#'+reservationId`;
`platformLabel` = iCal → `sourceName || formatPlatformName(sourcePlatformKey)`; else `siteDevisId` →
`'Site'`; else `platformDisplayName(platform)`, with `'direct'` shown as `'Direct'`, or `''`
(helper `newReservationOriginLabel` in the model file).

**Response:** `{ "alerts": [ { reservationId, clientName, propertyName, platformLabel, startDate, endDate, createdAt } ] }`
(shape unchanged).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `components/NewReservationsAlert.jsx` | T (renamed from `IcalNewReservationsAlert.jsx`) | Self-contained card: fetches `api.getNewReservations()` on mount and every 5 minutes (rule 10), renders an `info` `<Alert>` with one clickable row per reservation, navigates to `/reservations/:id`. Returns `null` when empty. New title and caption (§6). |
| `pages/` | `pages/Dashboard.jsx` | T | Imports the renamed component, same place in the alert stack. |
| `services/` | `api.js` | T | `getNewReservations: () => request('/dashboard/new-reservations')` (replaces `getIcalNewReservationsToday`). |
| comments | `components/UpdateAvailableAlert.jsx`, `components/TariffRecipeRunsAlert.jsx` | T | Their header comments cite the card by name; follow the rename. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing)** | MUI `Alert`/`AlertTitle`/`Stack`/`Box`/`Typography`/`Divider`, `useNavigate`, `displayDateShort` | Same primitives as the sibling cards. |
| **Created (new)** | none | The amendment changes an existing feature-specific card; nothing new is generic. |

### 4.3 API contract

| Method | Endpoint | Scope | Auth | Response |
|---|---|---|---|---|
| GET | `/api/dashboard/new-reservations` | internal (admin) | session (existing `/api` guard) | `{ alerts: [PublicAlertRow] }` |

`PublicAlertRow = { reservationId:number, clientName:string, propertyName:string, platformLabel:string, startDate:string, endDate:string, createdAt:string }`.

`/api/dashboard/ical-new-today` is removed (2026-10-06). It is an internal `/api` route; the only
consumer is this card, which ships in the same archive.

Example:
```json
{ "alerts": [
  { "reservationId": 22312, "clientName": "Claire Martin", "propertyName": "L'Estiva",
    "platformLabel": "Site", "startDate": "2026-10-24", "endDate": "2026-10-26",
    "createdAt": "2026-10-06 07:41:09" },
  { "reservationId": 22309, "clientName": "Jean Dupont", "propertyName": "Gite",
    "platformLabel": "Airbnb", "startDate": "2026-11-10", "endDate": "2026-11-13",
    "createdAt": "2026-10-05 21:52:30" }
] }
```

---

## 5. Data model

**No schema change.** The card is a derived query over existing `reservations` columns
(`kind`, `sourceType`, `createdAt`, `sourceIcalSourceId`, `sourcePlatformKey`, `platform`,
`requestOrigin`, `convertedReservationId`) + joins. No new table, no migration. **Data impact:** none
(read-only).

## 6. UI / UX

A dashboard alert card, consistent with the other dashboard cards but **informational** (`severity="info"`):

- **Title:** « Nouvelles réservations — N sur les dernières 24 h ». *(Amended 2026-10-06 — was
  « Nouvelles réservations iCal — N importée(s) aujourd'hui ».)*
- **Per row:** `{clientName} · {propertyName}` (bold), then « Du **{startDate}** au **{endDate}**{ · Source : **{platformLabel}**} », then a caption « Arrivée {il y a X} ». *(Caption amended 2026-10-06 — was « Importée … », wrong for a website or manual booking.)*
- **Whole row is clickable** (cursor pointer + hover) → navigates to `/reservations/:reservationId`. A trailing « ouvrir » chevron/icon hints at the click affordance.
- **Empty state:** the card is not rendered at all (no "rien aujourd'hui" message).
- **Responsive:** rows stack naturally; on `xs` the date/source line wraps; touch target ≥44px per row. Same container styling as `IcalCancellationAlert` (outlined Alert, `mb: 3`).
- **Loading/error:** on fetch error, render nothing (same defensive behavior as the sibling cards — a dashboard card must never break the page).

This is a standalone dashboard card, not a `PageActionBar` page — `PageActionBar` does not apply here.

Interactive mock-up of the amended card: `docs/specs/2026-10-06-dashboard-new-reservations-24h.html`.

## 7. Test plan

### Server unit tests
- [x] *(2026-06-08)* `tests/dashboard-ical-new-reservations.unit.test.js` — **7 tests** on the UTC-day, iCal-only version.
- [x] *(2026-10-06)* the file is renamed `tests/dashboard-new-reservations.unit.test.js` and rewritten for the amended rules (**10 tests**):
  - returns a reservation created 23 h 59 ago, excludes one created 24 h 01 ago (rule 2);
  - returns iCal, website and manual reservations; excludes devis (rule 1);
  - `platformLabel`: iCal source name, then `formatPlatformName(sourcePlatformKey)`; `Site` for a converted public devis; `platformDisplayName(platform)` otherwise, `direct` → `Direct`; empty when nothing is known (rule 9);
  - a converted devis that was **not** public does not yield `Site`;
  - ordering is `createdAt DESC`;
  - controller wraps the list as `{ alerts }`.

### Client unit tests
- [x] *(2026-06-08)* `IcalNewReservationsAlert.test.jsx` — **5 tests**.
- [x] *(2026-10-06)* renamed `NewReservationsAlert.test.jsx` (**6 tests**): the 5 existing cases on the new title / caption, plus one that advances fake timers by 5 minutes and checks the refetch (rule 10). `Dashboard.test.jsx` follows the rename in its `vi.mock`.

### Manual UI verification
Done on 2026-10-06 on a copy of the dev database, served by the branch build:
- [x] A reservation entered in GuestFlow → listed with « Source : Direct »; clicking it opens `/reservations/14`.
- [x] Two converted website devis → « Source : Site »; an iCal import of 19:50 UTC the previous day, 12 h old → still listed (the former card had dropped it at midnight UTC).
- [x] A reservation created 24 h 01 ago → absent. The 5-minute refetch is covered by the client test, not watched live.
- [x] Mobile (390 px): rows wrap, no horizontal scroll.
- [x] E2E suite: 83 passed, 1 skipped; `settings/fiscal-year-roundtrip` failed once in the full run and passed alone (unrelated flake).

## 8. Out of scope

- Any acknowledge/dismiss/persistence mechanism (the card empties itself 24 h after each arrival).
  If a "seen" state is later wanted, it would need a new table — deferred.
- Push/email notification of new bookings (specs/site-booking-notifications.md covers the emails).
- Surfacing iCal *updates* (changed dates of an existing booking) — date drifts already have their
  own card.
- A window other than 24 hours, or one the operator can configure.
- Pending website **devis** — they have their own card until converted.

## 9. Open questions

### Resolved (2026-06-08)
- **Q1 — Timezone → UTC.** "Today" = `date(createdAt) = date('now')` in UTC, consistent with the
  whole app. No local-TZ convention introduced. *Superseded on 2026-10-06 by Q3: the rolling window
  makes the timezone irrelevant.*
- **Q2 — Severity / placement → `info`, after the cancellation/drift cards.** Blue informational
  card, rendered in the alert stack below the actionable (orange) iCal cards.

### Resolved (2026-10-06)
- **Q3 — Window → rolling 24 hours.** Adrien: "lorsqu'une réservation arrive il faut la laisser
  affichée sur le dashboard 24 h". Each reservation stays exactly 24 h after its `createdAt`.
- **Q4 — Scope → every new reservation.** iCal imports, website bookings and reservations entered
  in GuestFlow (Adrien's choice among: all / iCal + site / iCal only).
