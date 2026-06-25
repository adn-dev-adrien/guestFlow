# iCal import leaves the reservation note empty

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/ical-import-no-notes` _(user-managed)_ |
| **Created** | 2026-06-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

When the iCal sync engine created (or re-synced) a reservation it dumped a metadata blob into the
operator-facing `notes` field:

```
Import iCal (Airbnb)
UID: 1234-abcd
Résumé: Jean Dupont
```

This is noise: the operator never needs the source name / UID / raw summary in the free-text note, and
worse, the blob was **rewritten on every re-sync** ([propertyIcalModel.js](../server/src/models/propertyIcalModel.js)
`updateReservation`), so a note the operator typed by hand was silently clobbered the next time the feed
moved. The original summary is already preserved in its own column (`icalOriginalSummary`), used for the
cross-UID dedup fallback (specs/ical-summary-fallback-cross-uid.md), and the `sourceType='ical'` +
platform columns already identify the booking as an import — so the note carried no unique information.

## 2. Goal

The `notes` field of an iCal-imported reservation is reserved for the operator's own free text. The
import never writes into it, and a re-sync never overwrites it.

## 3. Functional rules

1. On **iCal create**, the new reservation's `notes` is set to the empty string — no import metadata.
2. On **iCal re-sync update** (date/adults/time change of an unlocked booking), `notes` is **not part of
   the UPDATE** — whatever the operator wrote survives untouched.
3. The original event summary keeps being stored in `icalOriginalSummary` on create (unchanged) — the
   dedup / cross-UID fallback still works.
4. **Out of scope / unchanged:** pre-existing reservations imported before this change keep their old
   note blob (no backfill); the legacy `extractSummaryFromIcalReservationNotes` parse stays as a
   fallback for those old rows.

## 4. Architecture

> **Fat backend.** Server-only change in the iCal model; no client, no API, no schema change.

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `propertyIcalModel.js` | C | `notes` constant set to `''`; `notes` removed from both the create metadata blob and from the `updateReservation` prepared statement + its `.run()` call (so re-sync leaves the column alone). |

## 5. Data model

No schema change. `notes` and `icalOriginalSummary` columns already exist.

## 6. UI / UX

No UI change. Observable effect: a freshly-imported iCal booking opens with an empty note instead of the
import blob; a note typed on an iCal booking is no longer wiped on the next sync. Identical on mobile and
desktop (the note field is unchanged).

## 7. Test plan

### Server unit tests (`property-ical-sync.unit.test.js`)
- [x] create: import leaves `notes` empty and keeps the summary only in `icalOriginalSummary`.
- [x] update: a re-sync (date change) never clobbers the operator note.

## 8. Out of scope

- Backfilling / clearing the old note blob on reservations imported before this change.

## 9. Open questions

- (Resolved 2026-06-25) Re-sync **preserves** the operator note (does not blank it), rather than forcing
  an empty value on every sync.
