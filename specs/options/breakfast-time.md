# Breakfast time — default on the option + per-reservation, shown & sorted in the planning

| Field | Value |
|---|---|
| **Status** | Implemented (code) — pending manual UI check on the running app |
| **Branch** | `feature/breakfast-time` _(user-managed)_ |
| **Created** | 2026-06-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [breakfast-option-and-planning-card.md](breakfast-option-and-planning-card.md) |

---

## 1. Context

The breakfast feature (spec `breakfast-option-and-planning-card.md`) tracks **who** has breakfast on
**which morning** and surfaces it on the planning's `BreakfastDayCard`. It has **no time**: the
kitchen doesn't know at what hour each breakfast is wanted, and when several breakfasts fall on the
same day the planning lists them in an arbitrary (reservation-id) order.

## 2. Goal

A breakfast can carry a **time**: a default time configured on the breakfast option, overridable per
reservation on the reservation page. The planning shows each breakfast's time and lists same-day
breakfasts **sorted by time**.

## 3. Functional rules

1. The breakfast **option** (`autoOptionType = 'breakfast'`) carries a **default breakfast time**
   (`options.breakfastTime`, `HH:MM`, default `09:00`), editable in the options admin page.
2. A **reservation** can carry a **desired breakfast time** (`reservations.breakfastTime`, `HH:MM`,
   nullable). `NULL` means "use the option's default time".
3. On the reservation page, when the breakfast option is enabled, a time field lets the operator set
   the desired breakfast time. It is **pre-filled with the option's default** the first time breakfast
   is enabled (and when empty); the operator can override it. Clearing it falls back to the default.
4. *(Amended 2026-08-17 — [sas-breakfast-time-applies.md](sas-breakfast-time-applies.md).)* Since the
   per-morning planning cards shipped, the hour of a served morning is carried by its **occurrence**
   (`reservation_options.cardOccurrences[].time`); `reservations.breakfastTime` is the stay-level hour,
   used as the fallback when a stay has no occurrence — and writing it rewrites the occurrences, so the
   two never diverge.
4.bis The **effective** breakfast time for a reservation/day is
   `COALESCE(reservations.breakfastTime, options.breakfastTime, '09:00')` — resolved **server-side**.
5. The planning breakfast payload carries the effective `breakfastTime` per item, and the card
   displays it.
6. When several breakfasts fall on the **same day**, the planning lists them **sorted by
   `breakfastTime` ascending** (earliest first; e.g. 07:30 before 08:15 before 09:30), ties broken by
   client name then reservationId for stable ordering.
7. Times follow the app convention: `HH:MM` 24-hour TEXT, validated/normalised by `formatTimeShort`
   (server) — invalid input is rejected/normalised, never persisted raw.

**Edge cases:**
- Breakfast enabled but no per-reservation time set → the option default time is used + shown.
- Option default missing/blank → fall back to `'09:00'`.
- A reservation with `breakfastTime` set but breakfast **not** enabled → ignored (it never reaches the
  planning, which already gates on the breakfast option being present).
- Two breakfasts at the exact same time → ordered by client name then id (deterministic).

---

## 4. Architecture

> Fat backend: the **effective time** + the **per-day sort** are computed server-side; the card just
> renders the ordered list.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migrations: `ALTER TABLE options ADD COLUMN breakfastTime TEXT DEFAULT '09:00'`; `ALTER TABLE reservations ADD COLUMN breakfastTime TEXT`. |
| `utils/` | `utils/breakfastSeed.js` | — | No change needed: the `options.breakfastTime` column `DEFAULT '09:00'` covers existing rows (ALTER) and the seed's INSERT (which omits the column → default applies). |
| `models/` | `models/optionsModel.js` | T | Persist `breakfastTime` on create/update of the breakfast option (normalised via `formatTimeShort`; ignored for non-breakfast options or stored harmlessly). |
| `models/` | `models/reservationsModel.js` | T | Persist `reservations.breakfastTime` on insert/update (normalised); expose it on reads used by the form. |
| `controllers/` | `controllers/reservationsController.js` | T | Pass `breakfastTime` from the request body through to the model (normalise/validate at the boundary). |
| `models/` | `models/breakfastModel.js` | T | SELECT the effective time (`COALESCE(r.breakfastTime, o.breakfastTime, '09:00')`), attach `breakfastTime` to each planning item, and **sort each day's items** by `(breakfastTime, clientName, reservationId)`. |
| `utils/` | `utils/dateFr.js` | REUSE | `formatTimeShort` for `HH:MM` normalisation. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `pages/OptionsPage.js` | T | For the breakfast option (`autoOptionType='breakfast'`), render a time field bound to `breakfastTime` in `renderExtraFormFields` (mirrors the linen-specific conditional fields). |
| `components/reservation/` | `components/reservation/ExtrasSection.js` | T | Inside the breakfast option card (when enabled), render a "Heure souhaitée" time field bound to `form.breakfastTime`; pre-fill from the option default on enable. |
| `pages/` | `pages/ReservationPage.js` | T | Hold `breakfastTime` in form state; load it from the reservation; include it in the save payload; expose the breakfast option's default to the context for pre-fill. |
| `components/` | `components/BreakfastDayCard.js` | T | Show each item's `breakfastTime` (e.g. a bold time prefix). Items arrive already sorted; no client sort. |
| `services/` | `api.js` | — | No change (existing reservation + planning endpoints carry the new fields). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed** | MUI `TextField type="time"` (or a small `TimeField` if one exists), existing options/reservation forms, `BreakfastDayCard` | No new generic component; the time input is a one-liner MUI field. If a reusable `TimeField` already exists in the repo, use it. |

### 4.3 API contract

No new endpoint. Extended payloads:
- `GET /api/options` / option create/update: option objects gain `breakfastTime`.
- Reservation create/update + `GET /api/reservations/:id`: reservation gains `breakfastTime`.
- `GET /api/planning/breakfast` items gain `breakfastTime`; per-day `items` are pre-sorted by time.

Example planning item:
```json
{ "reservationId": 2, "clientName": "M. Martin", "propertyName": "Studio", "persons": 2, "breakfastTime": "08:30" }
```

---

## 5. Data model

- `options.breakfastTime TEXT DEFAULT '09:00'` — default breakfast time on the breakfast option.
  Other options carry it too (harmless/ignored). Idempotent `ALTER`.
- `reservations.breakfastTime TEXT` (nullable) — per-reservation desired time; `NULL` = use option
  default. Idempotent `ALTER`.

**Data impact:** additive. Existing options get `'09:00'`; existing reservations get `NULL` (→ they
resolve to the option default, i.e. unchanged behaviour but now with a time shown). No loss.

## 6. UI / UX

- **Options admin page:** a "Heure du petit-déjeuner" time field on the breakfast option card
  (24h, default 09:00). French label.
- **Reservation page (ExtrasSection):** inside the breakfast option block (visible when breakfast is
  enabled), a "Heure souhaitée" time field, pre-filled with the option default, overridable. Mobile:
  full-width below the breakfast toggle/quantity.
- **Planning `BreakfastDayCard`:** each row shows the time, e.g. **`09:00`** · Gîte • Famille Dupont :
  3 petits déjeuners. Rows are ordered by time ascending. The card keeps its amber styling.

## 7. Test plan

### Server unit tests
- [x] `breakfast-model` (extended, +2): effective time = COALESCE(reservation, option default); each
  item carries `breakfastTime`; **same-day items sorted by time** ascending. (12 tests total.)
- [x] DDL/migration covered by the model test schema (breakfastTime columns on options + reservations).
- Note: `optionsModel`/`reservationsModel` time persistence is a guarded passthrough column (no money
  logic) — exercised end-to-end by the model test + manual verification; the seed needed no change
  (column default).

### Client unit tests
- [x] `BreakfastDayCard` (extended, +2): renders the time per row; no badge when absent. (10 total.)
- Options page (breakfast-time field, conditional on the breakfast option) + ExtrasSection ("Heure
  souhaitée" field) — light/manual coverage; full client suite green (395).

### Manual UI verification
- [ ] Set the option default time on the breakfast option; create a reservation with breakfast →
  "Heure souhaitée" shows the default, overridable; planning shows the time and sorts same-day
  breakfasts ascending. *(pending — needs the running app.)*

## 8. Out of scope

- Per-property breakfast default times (single default on the option only).
- Time ranges / slots / kitchen capacity per slot.
- Surfacing the time anywhere other than the planning breakfast card + the reservation form.

## 9. Open questions

### Resolved (2026-06-08)
- **Q1 — Default time → `09:00`**, and **editable** on the breakfast option (the whole point of
  `options.breakfastTime` being editable on the Options page).
- **Q2 — Per-reservation storage → `reservations.breakfastTime`** (nullable; `NULL` = use the option
  default). Simpler and safe — it does not pass through the pricing engine that rebuilds
  `reservation_options` on every save.
