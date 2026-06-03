# iCal sync — re-claim a moved reservation when the platform re-issues its UID

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/ical-summary-fallback` |
| **Created** | 2026-06-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Today, when a reservation's dates change on a platform that **re-issues the UID** at the
same time (Abracadaroom does this; some Booking.com flows do too), the iCal sync engine
fails to recognise the move and produces two side-effects:

1. The new event lands as a **fresh reservation** at the new dates (no link to the original).
2. The old mapping becomes stale → the old reservation is either silently deleted (legacy
   master) or surfaces as a "to delete" Dashboard alert (since
   [PR #106](specs/ical-cancellation-approval.md)). In neither case is the user told that
   the new reservation and the old one are **the same booking that moved**.

The user has no audit trail, no Dashboard date-drift card, and (worse) any manual edits
made on the old reservation — options offered, custom prices, payment flags — are lost
when they approve the cancellation alert.

The fallback cascade in [propertyIcalModel.syncSource()](server/src/models/propertyIcalModel.js)
has four steps; every one searches by the **new** dates from the incoming event:

| Step | Lookup keys | Why it fails on this case |
|---|---|---|
| 1. `getMapping` | `(sourceId, eventUid)` | new UID, not stored |
| 2. `getFallbackMapping` | `(sourceId, newStart, newEnd, summary)` | the existing mapping has the OLD dates |
| 3. `listSourceReservationsByDates` | `(sourceId, newStart, newEnd)` | the existing reservation has the OLD dates |
| 4. `getCrossSourceMapping` | `(otherSource, newStart, newEnd, summary)` | same blind spot, different source |

What stays **stable** across the move is the platform's booking number, baked into the
event summary:

| Before | After |
|---|---|
| `SUMMARY:Booking #144253` (dates: 06–07 Jun) | `SUMMARY:Booking #144253` (dates: 10–11 Oct) |
| `summaryNormalized = 'booking 144253'` | `summaryNormalized = 'booking 144253'` |

Concrete trace from the user's prod DB (copied locally for this investigation):

```
ical_sources       id=4, name='Abracadaroom', platformLabel='Abracadaroom'
ical_import_events sourceId=4, eventUid=7517039833, summaryNormalized='booking 144253', startDate=2026-10-10
reservations       id=12101, sourceIcalEventUid=7517039833, startDate=2026-10-10, icalOriginalSummary='Booking #144253'
reservation_history single 'create' event on 2026-06-03 — no audit of any date change
```

The reservation was created on 2026-06-03 directly at the **new** dates, after the old
UID (carrying 06-07 Jun) silently vanished from the feed during the move. The old
reservation row + its mapping were both removed without a trace. The user lost any
manual work attached to it.

## 2. Goal

When the iCal sync sees a new event whose UID is unknown but whose summary
**uniquely** matches an existing mapping on the same source, the engine **re-claims
the existing reservation** instead of inserting a duplicate + dropping the old one.
The existing date-drift detection then kicks in naturally: the reservation's persisted
dates differ from the event's new dates → full update if unlocked, orange
"Modifications de dates iCal" Dashboard card if locked
([PR #104](specs/ical-sync-override-locked-dates.md)).

No new DB tables, no new endpoints, no new UI. One new SQL prepared statement, one new
step in the existing cascade, gated by a uniqueness check to stay fail-safe on platforms
that ship generic summaries.

## 3. Functional rules

1. **New fallback step 3.5 in `syncSource()`'s event loop.** Inserted between the existing
   per-source-by-dates step (3) and the cross-source step (4). Fires only when:
   - The previous three steps returned no mapping.
   - The incoming event has a non-empty `summaryNormalized` (already required by every
     prior fallback).
2. **Lookup query**:
   ```sql
   SELECT eventUid, reservationId, eventHash
     FROM ical_import_events
    WHERE sourceId = ? AND summaryNormalized = ?
    ORDER BY lastSeenAt DESC
   ```
3. **Two-guard safety net (mandatory)**. The step produces a match only when:
   - **(a) Staleness filter** — the candidate mapping's `eventUid` is NOT present in
     `seenUids` (the set of UIDs in the incoming feed). Without this, two distinct
     bookings in the SAME feed that share a generic summary (e.g. two "Closed Period"
     entries on different dates) would silently get rewired into the same reservation
     during the very first sync — a destructive false positive. The staleness filter
     restricts the heuristic to candidates that have genuinely disappeared from the
     feed (the platform's authoritative signal that the booking moved or vanished).
   - **(b) Uniqueness gate** — exactly ONE stale candidate remains after filter (a).
     With ≥ 2 stale candidates the heuristic cannot tell which one moved → the event
     falls through to step 4, then to the standard INSERT path. The orphan mappings
     then surface as cancellation alerts on the next stale-cleanup pass and the user
     arbitrates manually.
4. **Downstream behaviour is unchanged.** When step 3.5 matches:
   - `mapping = { reservationId, eventHash }` (existing tuple shape).
   - `previousUid = candidate.eventUid` (the OLD UID).
   - The existing code path (lines ~333–360 of `propertyIcalModel.js`) handles the rest:
     - `markReservationUid.run(event.uid, mapping.reservationId)` — rewires the
       reservation's `sourceIcalEventUid` to the new UID.
     - `if (previousUid && previousUid !== event.uid) deleteMapping.run(source.id, previousUid)`
       — drops the OLD mapping row from `ical_import_events`.
     - `mapping.eventHash !== eventHash` → `unchangedCount` path is skipped.
     - `isLockedDateDrift(mappedReservation, event)`:
       - If reservation is **unlocked** → `shouldSkipIcalReservationUpdate` returns false →
         full `updateReservation` SQL fires → `startDate` / `endDate` rewritten.
       - If reservation is **locked** → `driftModel.recordPending(...)` raises an orange
         Dashboard card with old → new dates (existing PR #104 flow).
   - `upsertMapping.run(source.id, event.uid, mapping.reservationId, ...)` — writes the
     NEW mapping with the NEW dates.
   - **No cancellation alert raised**, because the OLD mapping was removed by
     `deleteMapping` BEFORE the stale-cleanup pass (which only looks at mappings still
     present at the end of the per-event loop — see PR #106).
5. **Cross-platform interaction (sanity).** Step 3.5 is per-source. A booking carried by
   two platforms (different `sourceId`s) keeps relying on step 4 (cross-source). No
   double-claim possible because step 3.5 fires per-source and step 4 only fires when
   step 3.5 yielded nothing.
6. **`removedCount` semantics stay correct.** When step 3.5 fires, no cancellation alert
   is raised for the old UID (its mapping is gone before stale cleanup runs).
   `removedCount` increments **only** for genuinely abandoned bookings.

**Edge cases:**
- **Summary normalisation collision**: two real bookings with the SAME numeric ID across
  different periods (e.g. Abracadaroom reuses `#144253` for two different stays months
  apart). The uniqueness gate rejects the remap — both bookings are kept distinct via
  the standard INSERT path. In practice this would require Abracadaroom to wrap booking
  IDs, which it does not do on the timescales we care about.
- **Empty / generic summary** (`'booked ical'`, `'closed period'`): the multi-row count
  ≥ 2 case → step 3.5 skips → falls through to INSERT + soft cancellation alert (PR #106).
  The user can manually intervene from the Dashboard.
- **The platform issues a new UID AND changes the summary** (e.g. it now embeds the new
  reservation number): step 3.5 can't match (different `summaryNormalized`). Falls
  through to INSERT + soft cancellation alert. Acceptable v1 — this would require the
  platform to deliberately conceal that it's the same booking.
- **Step 3.5 matches a mapping whose reservation has been manually deleted** (between
  syncs): the mapping is stale but still in `ical_import_events`. The downstream
  `getReservationById(mapping.reservationId)` returns null → existing fallback path
  creates a fresh reservation (line ~287 of propertyIcalModel.js). Already handled by
  the current code.
- **Re-running the sync after a successful remap**: the new mapping has `eventUid` =
  new UID → step 1 catches it on the next sync → `unchangedCount` path → no further
  drift / cancellation alert.

---

## 4. Architecture

### 4.1 Server side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | [models/propertyIcalModel.js](server/src/models/propertyIcalModel.js) | T | Adds one prepared statement (`listSameSourceMappingsBySummary`) + step 3.5 in `syncSource`'s per-event loop. ~15 lines of code. |

No model rename / signature change; no new dependencies; no schema change; no client-side
work; no controller / route additions; no migration.

### 4.2 Client side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| — | — | — | None. The user experience is the existing orange Dashboard cards (date-drift for locked, silent full update for unlocked). |

### 4.3 API contract

No change.

---

## 5. Data model

No schema change.

## 6. UI / UX

No client surface touched. Behaviourally, the user sees:

- **Unlocked** moved booking → reservation simply updates to the new dates. Visible on the
  Calendar / Planning page on next refresh. No notification — consistent with how
  unlocked iCal date moves work today.
- **Locked** moved booking → orange Dashboard card "Modifications de dates iCal" lists
  the proposed change (existing PR #104 flow). User approves or rejects.
- **Reservation manually deleted between syncs** → fresh INSERT, then the OLD mapping
  cleanup creates a soft cancellation alert for the *deleted* row. The alert resolves
  to `outcome='reservation_gone'` on approve. Same as today.

---

## 7. Test plan

### Server unit tests

- [ ] `tests/property-ical-sync.unit.test.js` (T) — extend with:
  - **Same-summary re-claim, unlocked**: seed an existing mapping with old UID + old
    dates + a unique summary. Run sync with a new UID + new dates + same summary →
    assertion shape:
    - `result.createdCount == 0`
    - `result.updatedCount == 1`
    - `result.removedCount == 0`
    - the persisted reservation now has the new dates + new `sourceIcalEventUid`
    - the old mapping row is gone, the new mapping row is present
    - no cancellation alert raised
  - **Same-summary re-claim, locked**: same scenario but the seeded reservation has
    `icalSyncLocked = 1`. Expect:
    - reservation's dates stay UNCHANGED
    - ONE drift row in `ical_date_drift_alerts` with `previousStart/End` = old dates,
      `newStart/End` = new dates
    - `result.lockedCount == 1`, `result.updatedCount == 0`, `result.removedCount == 0`
    - no cancellation alert
  - **Ambiguity gate**: seed TWO mappings with the SAME `summaryNormalized` on the
    same source but different reservations. Run sync with a new UID + new dates +
    same summary →
    - step 3.5 must skip (count ≥ 2)
    - a fresh reservation is INSERTED at the new dates
    - the next sync (with the same feed) leaves only one of the two old mappings stale
      AND that mapping's old UID gets a cancellation alert (or not, depending on
      cross-source / dates-rematch — covered by existing PR #106 tests).
  - **Empty summary**: a new event with `summaryNormalized = ''` (after parser cleanup)
    + an unknown UID → step 3.5 must NOT fire (existing guard). Reservation created
    via the normal INSERT path.
- [ ] `tests/property-ical-dedup.unit.test.js` (T) — no functional change expected;
  re-run after the patch to verify the existing cross-platform survival assertions still
  pass.

No new test file; no rename.

### Manual UI verification

- [ ] Replay the Abracadaroom scenario on the local prod-copied DB:
  1. Delete reservation #12101 and its mapping (manual restore of the pre-incident
     state).
  2. Insert a synthetic OLD reservation + mapping at dates `2026-06-06 / 2026-06-07`
     with UID `OLDXXX` + summary `Booking #144253`.
  3. `npm run dev` and trigger a manual sync against the live Abracadaroom feed.
  4. Expected: reservation #12101 is rewritten to dates `2026-10-10 / 2026-10-11` +
     `sourceIcalEventUid = 7517039833`; no new row created; no cancellation alert; no
     drift card if the reservation was unlocked, one drift card if it was locked.
- [ ] Regression: on a clean test DB, run the full PR #104 + PR #106 manual checks (date
  drift detected, cancellation soft-flow works). No surprise on the existing flows.
- [ ] Mobile — no UI change, so no extra checks beyond confirming the Dashboard date-drift
  card still renders on `xs`.

---

## 8. Out of scope

- **A platform that re-issues UID AND changes the summary**: no stable identifier left
  to match against. Falls back to the soft cancellation flow + a new INSERT. User
  arbitrates manually. Documented as known gap.
- **Cross-platform UID re-issuance with different summary on each platform**: the
  cross-source step 4 already searches by `(dates, summary)`. Same-summary-across-UID
  is in scope only **within one source** in this spec. Extending to cross-source needs a
  wider lookup window and is left for a follow-up.
- **Heuristic parsing of the platform-specific booking ID out of the summary** (e.g.
  extracting `144253` from `Booking #144253` as a structured field). Premature: the
  full normalised summary works for the case at hand and stays platform-agnostic.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q: Should the uniqueness gate also check `reservations` (not only `ical_import_events`)?
  - A: No. The mapping table is the canonical "who points to whom" registry. If a
    reservation exists without a mapping (e.g. created manually + later associated by
    `icalOriginalSummary`), it would already be missed by every other fallback. We don't
    widen the search surface here.
- Q: Should we cap the lookback window (e.g. `lastSeenAt > now − 365 days`)?
  - A: No. The user's prod data is bounded by the feed itself; stale mappings are pruned
    by the cancellation flow when the platform stops referencing them. A reservation
    that has been in the system for 18 months and gets rescheduled should still be
    re-claimed.
