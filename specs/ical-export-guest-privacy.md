# iCal export — no guest data in the public feed

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `hotfix/booking-intake-and-ical-privacy` → `master`; identical on `fix/review-ical-intake` → `inte/plugins` |
| **Created** | 2026-10-18 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Depends on** | `specs/ical-export-closures.md` (the closure events, unchanged here) |

---

## 1. Context

Each property publishes an iCal feed (`GET /api/ical/export/:token`) that the platforms subscribe to,
so a stay booked anywhere blocks the dates everywhere else: Airbnb, Booking, Gîtes de France/ITEA,
Abracadaroom and GreenGo all read the same URL.

Until 2026-10-18 every reservation event of that feed carried the guest:

```
SUMMARY:Marie Vasseur
DESCRIPTION:Plateforme: Airbnb\nAdultes: 4, Enfants: 2
ATTENDEE:mailto:m.vasseur@example.fr
```

Measured on a copy of the Solio database by the review of 2026-10-18 (M1): 18 `ATTENDEE` lines in the
Gîte's feed, 14 in the lodge's, real names in `SUMMARY`. The guests of one platform were handed to its
competitors, and to anyone holding the URL (the token is the only protection). The question was parked
by `specs/ical-export-closures.md` §8 on 2026-09-20 as « worth its own spec »: this is that spec. GuestFlow
is now sold to other operators, which makes it a GDPR matter for them too.

A platform needs nothing but the dates to block them.

## 2. Goal

The feed says when the property is taken, and nothing about who takes it.

---

## 3. Functional rules

1. **Every reservation event reads `SUMMARY:Réservé`**, whatever the guest, the platform or the
   channel. The word is the same for every stay, so it tells nothing apart.
2. **A reservation event carries no guest data**: no `ATTENDEE`, no `DESCRIPTION`, no name, e-mail,
   phone, platform, party or note. The export query selects only `id`, `startDate` and `endDate`, so
   the guest's columns never leave the database through this path.
3. **What the platforms rely on is unchanged**: `UID:reservation-<id>@guestflow.local` (stable, so a
   platform updates the same block across fetches), `DTSTART` / `DTEND` (start inclusive, end
   exclusive), `TRANSP:OPAQUE`, the devis exclusion (`kind = 'reservation'` only) and the closure
   events of `specs/ical-export-closures.md`.
4. **Versioning.** No platform reads `SUMMARY`, `DESCRIPTION` or `ATTENDEE` to block dates, so no consumer
   loses a contract: the change ships as a **Z** fix on `master` and a **Y** on `inte/plugins`. The
   operator decides at release time whether it deserves an X (`specs/self-update-and-releases.md`
   §3.A rule 2) — see §9.
   > **Sans test** — a versioning judgement; the behaviour it rests on is rules 1–3.

**Edge cases:**
- A platform that displayed the guest's name in its own calendar now shows « Réservé ». The operator
  reads the guest in GuestFlow, which is where the data belongs.
- A stay with no client (legacy rows) already read « Réservation »; it now reads « Réservé » like the
  others.

---

## 4. Architecture

> **Fat backend, thin frontend.** Server only: the feed is a server-rendered document.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — `/api/ical/export/:token` unchanged) |
| `controllers/` | — | — | (none — `icalController.exportIcal` returns what the model builds) |
| `models/` | `models/icalModel.js` | T | The export query selects `id, startDate, endDate` only; `reservationEventLines(reservation)` builds the event (rules 1–3); `eventDateLines(start, end)` is the stamp and the two dates, shared with `closureEventLines`. |
| `middleware/`, `utils/`, `scheduledTasks.js`, `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

None.

### 4.3 API contract

| Method | Endpoint | Response | Notes |
|---|---|---|---|
| GET | `/api/ical/export/:token` | `text/calendar` | Reservation events: `UID`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY:Réservé`, `TRANSP:OPAQUE`. No `ATTENDEE`, no `DESCRIPTION`. |

---

## 5. Data model

None.

## 6. UI / UX

No GuestFlow screen changes. In the platforms' own calendars, a stay booked elsewhere shows
« Réservé » instead of the guest's name.

## 7. Test plan

- `server/src/tests/ical-export-guest-privacy.unit.test.js` (3 cases): every stay reads « Réservé »
  (rule 1); no name, e-mail, phone, platform, party, note, `ATTENDEE` or `DESCRIPTION` in the feed
  (rule 2); `UID`, dates and `TRANSP` keep their shape (rule 3).
- `server/src/tests/ical-model.unit.test.js` — the devis exclusion now asserts on the `UID`, the name
  being gone.
- `server/src/tests/ical-export-closures.unit.test.js` — unchanged, still green.
- Manual: `curl` the export URL of a property with stays → no `ATTENDEE`, every `SUMMARY` is
  `Réservé`.

## 8. Out of scope

- The URL itself (a token; regenerating it is unchanged).
- What the platforms send GuestFlow (the import).

## 9. Open questions

- Q: Is this an X for the release number? The feeds are an out-of-repo consumer.
  - Proposed: no — the platforms block on the dates, which are unchanged (rule 4). To be confirmed by
    the operator when the release is cut.

## 10. Implementation progress

- 2026-10-18 — implemented on `hotfix/booking-intake-and-ical-privacy` (`master`) and, identically, on
  `fix/review-ical-intake` (`inte/plugins`).
