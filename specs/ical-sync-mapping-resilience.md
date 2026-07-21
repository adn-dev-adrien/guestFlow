# iCal sync — mapping resilience (empty-feed guard + UID fallback)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/ical-sync-mapping-resilience` |
| **Created** | 2026-07-21 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

**Incident (2026-07-21, prod).** At 06:00 UTC the Gîtes de France feed (ITEA) returned an HTTP 200
whose body parsed to **zero events**. The sync engine treated this as "every booking left the feed":
it deleted all 15 `ical_import_events` mappings for the source (soft-cancellation flow) and raised 5
cancellation alerts for the future stays. At 06:05 the feed was back to normal — same 15 events,
same UIDs. `resolveOnReappearance` silently dropped the 5 alerts, then the matching cascade ran with
no mappings: the 4 reservations whose `icalOriginalSummary` was populated were re-claimed by the
legacy content fallback, but the 11 reservations imported **before that column existed** (empty
`icalOriginalSummary`, empty `notes`) matched nothing → **11 duplicate reservations** created in one
sync (ids 22257–22267, since repaired manually: mappings re-pointed to the originals, summaries
backfilled to `BOOKED`, duplicates deleted — pre-repair backup `manual-20260721-pre-dedup-gdf.db`).

Two root causes in [propertyIcalModel.js](../server/src/models/propertyIcalModel.js):

1. **A single degenerate 200 response wipes the source's whole mapping memory.** The stale-mapping
   sweep has no notion of "the feed suddenly went from N to 0 events — suspicious".
2. **The matching cascade never consults `reservations.sourceIcalEventUid`.** The 11 originals stored
   the exact UIDs present in the feed; one lookup would have re-claimed them all. The only
   content fallback (step ③) keys on `icalOriginalSummary`, which pre-column rows don't have.

## 2. Goal

A transient empty or garbage feed response can no longer create duplicate reservations or silently
destroy the UID→reservation mapping memory: the sync refuses suspicious empty feeds, and can always
rebuild its mappings from the UIDs already stored on the reservations themselves.

## 3. Functional rules

1. **UID fallback (step ①bis).** In the matching cascade, immediately after the mapping-table lookup
   (step ①) and before every summary-based fallback, look up an existing reservation by
   `sourceIcalSourceId = source.id AND sourceIcalEventUid = event.uid` (most recent `id` wins if
   several). A hit behaves exactly like a fallback-mapping hit: the reservation is re-claimed, the
   mapping row is (re)upserted, no duplicate is created. Locked reservations keep the current locked
   semantics (skip update, date-drift alert if dates differ).
2. **Well-formed ICS required.** If the fetched body does not contain `BEGIN:VCALENDAR`, the sync
   fails with an explicit error (`Réponse iCal invalide (contenu non ICS).`) and touches nothing —
   same handling as an HTTP error today.
3. **Empty-feed guard.** If the parsed feed contains 0 events while the source currently has ≥1
   mapping in `ical_import_events`, the sync does **not** run the stale-mapping sweep. Instead it
   increments a per-source `emptyFeedStreak` counter and:
   - **streak 1** → the sync records an *error* status with message
     `Flux vide inattendu — synchronisation ignorée en attente de confirmation.` and changes nothing.
   - **streak ≥ 2** (two consecutive empty fetches, ≥5 min apart with the current scheduler) → the
     emptiness is considered genuine; the sync proceeds normally (mappings sweep + soft-cancellation
     alerts as today).
4. **Streak reset.** Any sync that parses ≥1 event (or fails on fetch/parse) resets
   `emptyFeedStreak` to 0.
5. **Self-healing summary backfill.** Whenever the cascade matches an existing reservation (any
   step, including the new ①bis) whose `icalOriginalSummary` is empty, the sync backfills it with
   the event's summary, so the legacy content fallback keeps working for pre-column rows.
6. **No behavior change** for: sources with 0 mappings (first import of an empty feed is fine),
   past-stay alert carve-out, cross-source dedup, UID-reissue heuristic (step ③bis), locked flows.

**Edge cases:**
- Feed legitimately empties (last booking cancelled) → one error-status sync, then normal processing
  5 minutes later; cancellation alerts still reach the Dashboard, just one tick late.
- Feed empty AND source has no mappings → nothing to protect, sync proceeds (streak still counted).
- Duplicate `sourceIcalEventUid` rows already in DB (pre-existing duplicates) → most recent `id`
  wins; the others are untouched (they simply stay unmapped, visible to the operator).
- ITEA returns an HTML error page with 200 → rule 2 rejects it (no `BEGIN:VCALENDAR`).

---

## 4. Architecture

> Fat backend, thin frontend: this change is 100% server-side. The client already renders
> `lastSyncStatus` / `lastSyncMessage` — no client change.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `propertyIcalModel.js` | T | Step ①bis UID lookup; empty-feed guard + streak handling in `syncSource`; summary backfill on fallback matches |
| `utils/` | `icalParser.js` | T | `isWellFormedIcs(icsText)` pure helper (`BEGIN:VCALENDAR` presence) |
| `database.js` | `database.js` | T | Idempotent migration: `ical_sources.emptyFeedStreak INTEGER NOT NULL DEFAULT 0` |
| `tests/` | `ical-sync-mapping-resilience.unit.test.js` | C | Covers rules 1–5 (see §7) |

### 4.2 Client side (`client/src/`)

None. The new error message flows through the existing `lastSyncMessage` display.

**Component reuse declaration:** no components consumed or created (server-only change).

### 4.3 API contract

Unchanged. `GET /api/properties/:id/ical-sources` payload gains no field (the streak is internal);
sync endpoints keep their shapes, only the error message wording is new.

---

## 5. Data model

- New column `ical_sources.emptyFeedStreak INTEGER NOT NULL DEFAULT 0` — idempotent
  `ALTER TABLE` block in `database.js`. Default 0 is correct for all existing rows; no backfill.
- No change to `reservations` / `ical_import_events` schemas. Rule 5 progressively backfills
  `reservations.icalOriginalSummary` where empty (data heal, no migration needed).

**Data impact:** none destructive. The 2026-07-21 prod duplicates were repaired manually before this
spec (see §1); this change prevents recurrence.

## 6. UI / UX

No UI change. New French strings (server-side, shown in the existing « État » cell of the iCal
sources table):
- `Réponse iCal invalide (contenu non ICS).`
- `Flux vide inattendu — synchronisation ignorée en attente de confirmation.`

Responsive: n/a (no client change). PageActionBar: n/a.

## 7. Test plan

### Server unit tests (`tests/ical-sync-mapping-resilience.unit.test.js` — 9 tests, all passing; full suite 2098/2098)
- [x] Rule 1 — mappings wiped, reservation stores the UID → re-claimed, no duplicate, mapping row rebuilt.
- [x] Rule 1 — locked reservation re-claimed by UID with changed dates → date-drift alert, no update.
- [x] Rule 2 — HTML body with HTTP 200 → sync error, mappings intact.
- [x] Rule 3 — first empty feed with existing mappings → error status, mappings + reservations intact, streak = 1.
- [x] Rule 3 — second consecutive empty feed → sweep runs, cancellation alerts raised, streak semantics honored.
- [x] Rule 4 — non-empty sync resets streak to 0 (two empties around it never confirm each other).
- [x] Rule 4 — a fetch failure also resets the streak.
- [x] Rule 5 — fallback match on a row with empty `icalOriginalSummary` → column backfilled with the event summary.
- [x] Regression — first-ever sync of an empty feed (0 mappings) still succeeds.

Existing suites adapted: the 7 pre-existing tests that emptied a feed in one sync now go through a
`syncEmptyConfirmed` double-sync helper (first sync asserts the guarded error), and the sync test
fixtures gained the `emptyFeedStreak` column + a persisted `ical_sources` row.

### Manual UI verification
- [ ] « État » cell shows the new error message after a simulated empty feed (dev: point a source at a static empty ICS).
- [ ] Regression: normal GdF sync still reports « 15 inchangé(s) ».

## 8. Out of scope

- Cross-platform dedup for generic summaries (GdF `BOOKED` vs guest-named events on other feeds).
- Matching iCal events against **manually created** reservations.
- A percentage-drop threshold (only the 0-event case is guarded; partial drops keep today's
  user-validated soft-cancellation flow).
- Any client-side change.

## 9. Open questions

- Q: Should the empty-feed confirmation require more than 2 consecutive syncs (e.g. 3, ~15 min)?
  - Resolved 2026-07-21: 2 consecutive empty fetches — the destructive path it gates (soft
    cancellations) is itself user-validated on the Dashboard.
