# Dashboard card — new iCal reservations imported today

| Field | Value |
|---|---|
| **Status** | Implemented (code) — pending manual UI check on the running app |
| **Branch** | `feature/dashboard-ical-new-reservations` _(user-managed)_ |
| **Created** | 2026-06-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

iCal sync silently imports platform bookings (Airbnb, Booking, …) into the `reservations`
table as `sourceType='ical'` rows (anti-overbooking). Today there is **no signal** on the
dashboard when a new booking arrives via iCal — the operator only discovers it by scanning the
calendar. The dashboard already surfaces iCal-related alert cards (cancellations, date drifts)
with a consistent, self-contained pattern (`IcalCancellationAlert`, `IcalDateDriftAlert` →
`GET /api/dashboard/ical-*`). This feature adds a sibling **informational** card announcing the
iCal reservations imported during the current day, each clickable to open its reservation page.

## 2. Goal

On the dashboard, the operator sees at a glance every reservation that arrived via iCal **today**,
and can click one to jump straight to its reservation page.

## 3. Functional rules

1. The card lists every reservation with `sourceType = 'ical'` **and** `kind = 'reservation'`
   whose `createdAt` falls on the **current day**.
2. "Current day" is computed in **UTC** (`date(createdAt) = date('now')`), matching the rest of the
   app (`datetime('now')` storage + `toISOString()` date math everywhere else). The list naturally
   rolls over at UTC midnight — no acknowledgement, no persistence, no new table.
3. Each entry shows: guest name, property name, the booking platform / iCal source, the stay dates
   (`startDate → endDate`), and a relative "imported X ago" timestamp.
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

**Edge cases:**
- A reservation imported today then deleted the same day → it disappears from the card (the query
  reads live `reservations`, joined, so a deleted row is simply absent).
- A reservation imported yesterday but whose stay is today → **not** shown (the card is about the
  *import* event, not the stay).
- A manually-created reservation → never shown (`sourceType = 'ical'` filter).
- A devis (`kind='devis'`) → never shown.
- Many imports in one day → all are listed (bounded in practice; a daily feed rarely imports more
  than a handful). No artificial cap in v1.

---

## 4. Architecture

> **Fat backend, thin frontend.** The server returns a ready-to-render list; the client only maps it
> to rows and handles the click navigation + the (shared) relative-time formatting.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | `routes/dashboard.js` | T | Add `GET /api/dashboard/ical-new-today` → `dashboardController.icalNewReservationsToday`. |
| `controllers/` | `controllers/dashboardController.js` | T | New thin handler: calls the model, returns `{ alerts }`. |
| `models/` | `models/dashboardModel.js` | T | New `listNewIcalReservationsToday()` — the single SQL query + row shaping (joins clients/properties/ical_sources; computes `clientName`, `platformLabel`). |
| `utils/` | `utils/platformNameFormat.js` | REUSE | `formatPlatformName` for a clean platform label fallback when no iCal source name. |

**Query (model):**
```sql
SELECT r.id AS reservationId, r.startDate, r.endDate, r.createdAt,
       r.sourcePlatformKey, s.name AS sourceName,
       c.firstName, c.lastName, p.name AS propertyName
  FROM reservations r
  LEFT JOIN clients c        ON c.id = r.clientId
  LEFT JOIN properties p     ON p.id = r.propertyId
  LEFT JOIN ical_sources s   ON s.id = r.sourceIcalSourceId
 WHERE r.kind = 'reservation'
   AND r.sourceType = 'ical'
   AND date(r.createdAt) = date('now')
 ORDER BY datetime(r.createdAt) DESC, r.id DESC
```
Row shaping: `clientName = "${firstName} ${lastName}".trim() || '#'+reservationId`;
`platformLabel = sourceName || formatPlatformName(sourcePlatformKey) || ''`.

**Response:** `{ "alerts": [ { reservationId, clientName, propertyName, platformLabel, startDate, endDate, createdAt } ] }`

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `components/IcalNewReservationsAlert.js` | C | Self-contained card: fetches `api.getIcalNewReservationsToday()` on mount, renders an `info` `<Alert>` with one clickable row per reservation, navigates to `/reservations/:id`. Returns `null` when empty. Mirrors `IcalCancellationAlert` minus the approve/reject actions. |
| `pages/` | `pages/Dashboard.js` | T | Render `<IcalNewReservationsAlert />` in the alert stack (near the other iCal cards). |
| `services/` | `api.js` | T | Add `getIcalNewReservationsToday: () => request('/dashboard/ical-new-today')`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing)** | MUI `Alert`/`AlertTitle`/`Stack`/`Box`/`Typography`/`Chip`, `useNavigate` | Same primitives as the sibling cards. |
| **Created (new)** | `IcalNewReservationsAlert` | Feature-specific dashboard card; sibling to `IcalCancellationAlert`/`IcalDateDriftAlert`. Not generic (tied to this payload), consistent with how the other two alert cards are kept specific. The relative-time + date format helpers are duplicated from the sibling cards (already the established local-helper convention there); if a third copy feels wrong, extract a shared `icalAlertFormat.js` util — noted, not blocking. |

### 4.3 API contract

| Method | Endpoint | Scope | Auth | Response |
|---|---|---|---|---|
| GET | `/api/dashboard/ical-new-today` | internal (admin) | session (existing `/api` guard) | `{ alerts: [PublicAlertRow] }` |

`PublicAlertRow = { reservationId:number, clientName:string, propertyName:string, platformLabel:string, startDate:string, endDate:string, createdAt:string }`.

Example:
```json
{ "alerts": [
  { "reservationId": 12087, "clientName": "Jean Dupont", "propertyName": "Gite",
    "platformLabel": "Airbnb", "startDate": "2026-07-10", "endDate": "2026-07-13",
    "createdAt": "2026-06-08 09:14:22" }
] }
```

---

## 5. Data model

**No schema change.** The card is a derived query over existing `reservations` columns
(`sourceType`, `createdAt`, `sourceIcalSourceId`, `sourcePlatformKey`) + joins. No new table, no
migration. **Data impact:** none (read-only).

## 6. UI / UX

A dashboard alert card, consistent with the existing iCal cards but **informational** (`severity="info"`):

- **Title:** « Nouvelles réservations iCal — N importée(s) aujourd'hui ».
- **Per row:** `{clientName} · {propertyName}` (bold), then « Du **{startDate}** au **{endDate}**{ · Source : **{platformLabel}**} », then a caption « Importée {il y a X} ».
- **Whole row is clickable** (cursor pointer + hover) → navigates to `/reservations/:reservationId`. A trailing « ouvrir » chevron/icon hints at the click affordance.
- **Empty state:** the card is not rendered at all (no "rien aujourd'hui" message).
- **Responsive:** rows stack naturally; on `xs` the date/source line wraps; touch target ≥44px per row. Same container styling as `IcalCancellationAlert` (outlined Alert, `mb: 3`).
- **Loading/error:** on fetch error, render nothing (same defensive behavior as the sibling cards — a dashboard card must never break the page).

This is a standalone dashboard card, not a `PageActionBar` page — `PageActionBar` does not apply here.

## 7. Test plan

### Server unit tests
- [x] `tests/dashboard-ical-new-reservations.unit.test.js` (model + controller, **7 tests**):
  - returns iCal reservations created today (shape: clientName/propertyName/platformLabel/dates).
  - excludes manual reservations, reservations created on other days, and devis.
  - `platformLabel` falls back to `formatPlatformName(sourcePlatformKey)` when no iCal source name.
  - ordering is `createdAt DESC`.
  - controller wraps the list as `{ alerts }`.

### Client unit tests
- [x] `client/src/components/__tests__/IcalNewReservationsAlert.test.js` (**5 tests**): renders
  nothing while pending / empty / on API error; renders the count + a row per reservation; clicking
  a row navigates to `/reservations/:id`.

### Manual UI verification
- [ ] With an iCal reservation imported today → the card appears, shows guest/property/platform/dates, and clicking a row opens `/reservations/:id`. *(pending — needs the running app)*
- [ ] No iCal import today → the card is absent.
- [ ] Regression: the existing cancellation/drift/linen cards still render correctly alongside it.
- [ ] Mobile breakpoint: rows readable, clickable.

## 8. Out of scope

- Any acknowledge/dismiss/persistence mechanism (the card auto-rolls daily). If a "seen" state is
  later wanted, it would need a new table — deferred.
- Push/email notification of new imports (this is an in-app dashboard card only).
- Surfacing iCal *updates* (changed dates of an existing booking) — date drifts already have their
  own card.
- A configurable time window other than "current UTC day".

## 9. Open questions

### Resolved (2026-06-08)
- **Q1 — Timezone → UTC.** "Today" = `date(createdAt) = date('now')` in UTC, consistent with the
  whole app. No local-TZ convention introduced.
- **Q2 — Severity / placement → `info`, after the cancellation/drift cards.** Blue informational
  card, rendered in the alert stack below the actionable (orange) iCal cards.
