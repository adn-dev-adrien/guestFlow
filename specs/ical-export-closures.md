# Closures in the public iCal export

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/ical-export-closures` _(Claude-managed)_ |
| **Created** | 2026-09-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow is the hub of the iCal mesh: every platform (Booking, Airbnb, Gîtes de France, GreenGo)
imports one feed per property — `GET /api/ical/export/:token`, built by
[icalModel.exportProperty](../server/src/models/icalModel.js#L56) — and that feed carries **all** of
the property's reservations whatever their origin. That part works.

**Closures are the hole in it.** `establishment_closures` (global or per-property, posed in
*Réglages → Fermetures*, see [establishment-closures.md](establishment-closures.md)) blocks dates
everywhere inside GuestFlow — the calendar, availability, tariff-recipe carving — but **nothing
leaves through the feed**. `exportProperty` selects from `reservations` only. A platform therefore
still sells a winter closure, and the operator has to re-declare every closure by hand on every
channel.

Worse, the import side papers over the symptom in a way that loses bookings. Since 2026-06-06 the
sync guard ([property-ical-closure-guard.unit.test.js](../server/src/tests/property-ical-closure-guard.unit.test.js))
**silently drops** any incoming event covered by a closure — the right call for anti-overbooking, but
it means a guest who booked those dates on Booking has a confirmation in hand and **no trace at all**
in GuestFlow. Exporting the closure prevents the sale instead of discarding it afterwards.

## 2. Goal

A period declared closed in GuestFlow blocks those dates on every platform that reads the property's
iCal feed, with no per-channel manual re-declaration.

## 3. Functional rules

1. The feed of a property carries one `VEVENT` per **closure that applies to that property**: its own
   per-property closures (`establishment_closures.propertyId = <id>`) **and** every global closure
   (`propertyId IS NULL`). This is the scoping `establishmentClosuresModel.list({ propertyId })`
   already implements — the export reuses it rather than writing its own SQL.
2. **Only closures that are not over** are exported: `endDate > today` (Europe/Paris). A closure
   **in progress** (`startDate ≤ today < endDate`) is exported — it is the one that matters most. A
   closure entirely in the past is not: the platforms have no use for it, and it would grow the feed
   forever. This is the one place the feed deliberately departs from the reservations rule (which
   exports the past too); rule 10 records why.
3. **`SUMMARY` = `Fermeture — <label>`** (e.g. `Fermeture — Fermeture hivernale`). The `Fermeture —`
   prefix is what tells the operator, looking at the calendar inside Booking or Airbnb, that the
   block is not a guest.
4. **`DTSTART` = `startDate`, `DTEND` = `endDate`, unchanged.** Closures use the same
   inclusive-start / exclusive-end convention as reservations — stated in
   [`expandClosuresToDates`](../server/src/models/establishmentClosuresModel.js#L149) (`while (cursor < end)`)
   — so both columns go straight into the event with no shift. A closure `2026-11-01 → 2027-03-01`
   blocks the nights of 1 Nov through 28 Feb and leaves 1 March bookable.
5. **`UID` = `closure-<id>@guestflow.local`** — a namespace of its own, next to
   `reservation-<id>@guestflow.local`. It is stable across fetches, so a platform updates the same
   block instead of accumulating duplicates, and it can never collide with a reservation's UID.
6. A closure event carries **no personal data**: no `ATTENDEE`, and `DESCRIPTION` is the fixed string
   `Période de fermeture — aucune réservation possible.` Nothing about a closure is guest-specific.
7. `TRANSP:OPAQUE`, like a reservation: the dates read as busy.
8. Closure events are appended **after** the reservation events, ordered by `startDate`. The
   reservation block is untouched — same query, same fields, same order.
9. **A deleted closure disappears from the feed** on the next fetch, and the platform unblocks the
   dates by itself. No extra bookkeeping: the feed is stateless, rebuilt on every request.
10. The feed stays **additive** for its consumers: no existing event changes shape, so no platform
    can lose a contract here. Under `specs/self-update-and-releases.md` §3.A rule 2 this is a **Y**,
    not an X, even though the iCal feeds are an out-of-repo consumer.

**Edge cases:**
- **No applicable closure** → the feed is byte-for-byte what it is today.
- **Label empty or left at the DB default** (`'Fermeture établissement'`) → `SUMMARY` is plain
  `Fermeture`, never `Fermeture — Fermeture établissement`.
- **Label containing `,` `;` or a newline** → escaped by the existing `escapeIcalText`; no new
  escaping path.
- **Global closure** → the same `UID` appears in several properties' feeds. Harmless and correct: a
  `UID` must be unique *within* a calendar, and each token serves a different calendar.
- **A closure overlapping a reservation** cannot exist (`findReservationOverlap` refuses it at
  creation), so no contradictory pair of events can be emitted.
- **A closure straddling today** is exported whole, from its real `startDate` — not clipped to today.
  Clipping would move `DTSTART` on every fetch and make platforms churn the block.
- **A devis** is still never exported (unchanged, [icalModel.js:3](../server/src/models/icalModel.js#L3)).

---

## 4. Architecture

> **Fat backend, thin frontend.** Entirely server-side: the feed is a server-rendered document and
> there is no client surface in this change.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — `/api/ical/export/:token` is unchanged, still public per [index.js:147](../server/src/index.js#L147)) |
| `controllers/` | — | — | (none — `icalController.exportIcal` already just returns what the model builds) |
| `models/` | `models/icalModel.js` | T | `exportProperty` also emits the closure events: resolves today, calls the closures model, appends one `VEVENT` per closure. Gains two private pure helpers, `closureSummary(label)` (rule 3 + the default-label edge case) and `buildClosureEvent(closure)` (the line block). |
| `models/` | `models/establishmentClosuresModel.js` | — | **Unchanged, and deliberately so:** `list({ propertyId, from })` already returns exactly the right rows (global ∪ per-property, `endDate > from`, ordered by `startDate`). `icalModel` builds it against its own database handle via the `create(db)` factory, which keeps `establishment_closures` accessed from its one owning model and keeps `buildModel(db)` unit-testable on an in-memory schema. |
| `middleware/` | — | — | (none) |
| `utils/` | — | — | (none — the ISO "today" is `new Date().toISOString().slice(0, 10)`, consistent with the rest of the model) |
| `scheduledTasks.js` | — | — | (none — the feed is built on request, not on a tick) |
| `database.js` | — | — | (none — no schema change) |

**Notes:**
- `icalModel.buildModel(db)` must now also create the closures model from that same `db`, so the
  existing in-memory test harness keeps working once its DDL gains the `establishment_closures`
  table.
- No new dependency.

### 4.2 Client side (`client/src/`)

**No client change.** The export card
([IcalExportCard.jsx](../client/src/components/IcalExportCard.jsx)) hands out the same URL, serving a
richer document. Nothing to render, no `PageActionBar` impact, no responsive impact.

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| all | — | — | (none) |

**Component reuse declaration:** not applicable — no component is consumed, created or specialised.

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/ical/export/:token` | — | `text/calendar` | **Unchanged signature.** The body gains `VEVENT`s whose `UID` matches `closure-*`. Public (no session), as today. |

---

## 5. Data model

**No schema change, no migration, no backfill.** The change reads `establishment_closures` as it
stands.

**Data impact:** none — the export is read-only.

## 6. UI / UX

No screen changes. The only user-visible effect is outside GuestFlow: closed periods now show up as
blocked ranges in the platforms' own calendars, labelled `Fermeture — <label>`.

The one string this spec introduces is the fixed `DESCRIPTION`,
`Période de fermeture — aucune réservation possible.`, read by the operator inside the platform's
interface — French on purpose, like the rest of the feed's content.

## 7. Test plan

### Server unit tests

New file — the subject is its own, per CLAUDE.md §9 ("one test file per subject"); nothing is
appended to `ical-model.unit.test.js`.

- [ ] `tests/ical-export-closures.unit.test.js`
  - [ ] a per-property closure is exported, with `DTSTART`/`DTEND` equal to its stored dates (rules 1, 4)
  - [ ] a global closure (`propertyId IS NULL`) appears in the feed of every property (rule 1)
  - [ ] another property's per-property closure does **not** appear (rule 1)
  - [ ] a closure entirely in the past is excluded; one in progress is included (rule 2)
  - [ ] `SUMMARY` is `Fermeture — <label>`, and plain `Fermeture` for the default/empty label (rule 3 + edge case)
  - [ ] `UID` is `closure-<id>@guestflow.local` and never collides with a reservation's (rule 5)
  - [ ] no `ATTENDEE` on a closure event (rule 6)
  - [ ] a label with `,` / `;` is escaped (edge case)
  - [ ] with no applicable closure, the feed is identical to the reservations-only output (edge case)
- [ ] `tests/ical-model.unit.test.js` — still green: the devis exclusion and the reservation event
      are untouched (its DDL gains the `establishment_closures` table).

### Manual verification

- [ ] `curl` the real export URL of a property that has an upcoming closure → the `.ics` carries the
      `Fermeture — …` event at the right dates.
- [ ] Open the same `.ics` in a calendar app → the closure shows as an all-day busy range, first
      night in, last night out (rule 4 checked on a real renderer).
- [ ] A property with **no** closure → feed unchanged.
- [ ] Regression: the iCal **import** still runs (Fiche logement → *Plateformes & iCal* → sync) and
      the closure guard still drops covered events — this spec does not touch that path.

No browser UI to verify (§4.2), so no responsive pass.

## 8. Out of scope

- **Pushing closures through platform APIs.** This spec only fills the iCal feed; a channel that
  ignores its iCal import still needs the closure posed by hand.
- **A per-closure "block on the platforms" switch.** Decided against in §9 — every closure travels.
- **Exporting devis / options.** Still deliberately excluded (rule 8 of the original feed).
- **The guest-data question in the feed.** `SUMMARY` carries the guest's name and `ATTENDEE` their
  e-mail on *reservation* events, which is shipped to every platform subscribing to the feed. Raised
  2026-09-20, worth its own spec, untouched here.
- **Exporting the closure's scope** (global vs per-property) into the event. A platform only cares
  that the dates are blocked.

## 9. Open questions

- Q: What do the platforms display for a closure — the operator's label, or something neutral?
  - A (2026-09-20): **`Fermeture — <label>`.** The prefix disambiguates against a real booking; the
    label stays readable. Recorded as rule 3.
- Q: Every closure, only the future ones, or an opt-in switch per closure?
  - A (2026-09-20): **only the ones that are not over** (`endDate > today`). No switch, no column, no
    forgotten checkbox — and the feed does not carry years of dead history. Recorded as rule 2.

---

## 10. Implementation

Delivered 2026-09-20 on `feature/ical-export-closures`.

| Item | Result |
|---|---|
| `models/icalModel.js` | Requires `establishmentClosuresModel`, builds it from the same handle via `create(database)`. Adds `closureSummary()` and `closureEventLines()` (both pure) and the `closures.list({ propertyId, from: today })` call at the end of `exportProperty`. The reservation block is unchanged. |
| `tests/ical-export-closures.unit.test.js` | **10 tests**, one per rule, all dates relative to today so the "not over yet" filter keeps being exercised. |
| `tests/ical-model.unit.test.js` | DDL only: `establishment_closures` added so the model can be built. Its 3 tests unchanged and green. |
| Server suite | **4201 tests, 0 failure** (`cd server && npm test`) — 4191 before. |
| Client | Untouched, as planned. No Vitest or Playwright run: nothing renders differently. |

**Verified on a real feed** (throwaway DB built by `database.js`, one reservation + three closures):
the past closure is filtered out, the global closure appears in both properties' feeds, the
per-property one only in its own, and events come out ordered by `startDate`. The result was then
parsed back by GuestFlow's own `utils/icalParser` — `isWellFormedIcs` true, dates returned exactly as
stored (`2026-10-20 → 2026-10-27`, `2026-11-01 → 2027-03-01`), UIDs distinct from the reservation's.
macOS Calendar was deliberately not used for this check: importing the file would have written test
events into the operator's real calendar, and the round-trip through the app's own parser proves the
same thing.
