# The breakfast hour set in the check-in SAS must apply

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/sas-breakfast-time-persisted` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Amends** | [sas-breakfast-and-handover-note.md](sas-breakfast-and-handover-note.md) §3 rule 2, [breakfast-time.md](breakfast-time.md) rule 4, [breakfast-option-planning-card.md](breakfast-option-planning-card.md) |

---

## 1. Context

Operator report (issue **#426**): *« Si on change l'heure du petit déj dans la SAS Check in ce n'est pas
pris en compte. »*

The arrival SAS has a breakfast page whose first field is the serving hour; committing writes
`reservations.breakfastTime` — exactly what
[sas-breakfast-and-handover-note.md](sas-breakfast-and-handover-note.md) §3 rule 2 promised, back when
[breakfast-time.md](breakfast-time.md) rule 4 defined the effective hour as
`reservations.breakfastTime → option default → 09:00`.

Then the **planning cards per served morning** shipped
([breakfast-option-planning-card.md](breakfast-option-planning-card.md)): the breakfast option now
stores `cardOccurrences = [{ date, time, done }]` on the reservation, one entry per morning, each with
**its own hour**. Every operator-facing surface reads that hour:

- `breakfastModel.breakfastByDate` renders one card per occurrence at `o.time` (the per-reservation
  hour is only the fallback for a stay with no occurrence);
- the same value drives the per-day sort and the breakfast **push notice**;
- `breakfastModel.getForReservation` — the SAS's own payload — also prefers the first occurrence.

So the SAS wrote the hour to a column nobody reads any more: the card kept showing 09:00, the push kept
firing at 09:00, and re-opening the SAS showed 09:00 again. The hour was recorded, and invisible.

## 2. Goal

Changing the breakfast hour in the check-in SAS changes the hour the operator sees and is notified at —
on the planning cards of the stay, in the push notice, and when re-opening the SAS.

## 3. Functional rules

1. **The hour of a stay is one hour.** Writing `reservations.breakfastTime` also rewrites the `time` of
   **every** stored breakfast occurrence of that reservation. The SAS sets the hour of the stay, not of
   one morning (the operator asks the guest once, at check-in).
2. **One write path.** The rewrite lives in the model's `persistBreakfastTime`, so the check-in SAS
   commit and any other writer of that column stay consistent by construction.
3. **Only the hour moves.** The occurrence's `date` and its `done` flag are preserved — a morning
   already served stays served.
4. **Clearing the hour restores the default.** An empty hour stores `NULL` on the reservation (= « use
   the option default ») and puts every occurrence back on the option's configured hour (else `09:00`).
5. **A commit that does not carry the hour changes nothing** — same tri-state contract as the rest of
   the SAS (the breakfast page was not shown → the stored hours are left alone).
6. **A stay with no stored occurrence** (legacy reservation, or breakfast without planning cards) just
   records the hour: the card's fallback path already reads `reservations.breakfastTime`.
7. **The fiche keeps its per-day hours.** On a reservation save the client re-sends the occurrence grid
   *after* the reservation columns are written, so a per-morning hour edited on the fiche still wins
   there — unchanged behaviour.

**Edge cases:**
- Invalid hour (`25:99`) → normalised to `NULL` by the existing `formatTimeShort` guard, so rule 4
  applies.
- Re-opening a committed SAS shows the recorded hour (occurrence and reservation now agree).
- A breakfast option with no `showsPlanningCard` → no occurrence, rule 6.

---

## 4. Architecture

> **Fat backend.** The client already sends the hour; the whole fix is where the hour is stored.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/reservationsModel.js` | T | `persistBreakfastTime` also rewrites the breakfast option's `cardOccurrences` hours (new guarded `applyBreakfastTimeToOccurrences`); `commitArrivalSas` now goes through `persistBreakfastTime` instead of its own inline UPDATE. |
| `models/` | `models/breakfastModel.js` | — | (none — it already reads the occurrence, which is now correct) |
| `controllers/` | — | — | (none) |
| `database.js` | — | — | (none — no schema change) |

### 4.2 Client side

None — the SAS already sends `breakfastTime`.

### 4.3 API contract

Unchanged.

---

## 5. Data model

No migration. `reservation_options.cardOccurrences` (JSON) keeps its shape `[{ date, time, done }]`;
only the `time` values are rewritten, in place, when the stay's hour changes.

## 6. UI / UX

Nothing moves visually. What changes is that the planning `BreakfastDayCard` of the stay, the per-day
sort, the push notice and the re-opened SAS all show the hour the operator entered.

## 7. Test plan

### Server unit tests (`server/src/tests/sas-breakfast-time-applies.unit.test.js`, 6 tests)
- [x] The hour set at check-in reaches every breakfast morning of the stay (the reported bug).
- [x] The occurrences keep their `date` and their `done` flag.
- [x] Clearing the hour puts the mornings back on the option default.
- [x] A commit without the hour leaves the mornings alone.
- [x] A stay with no occurrence still records the hour (legacy path).
- [x] `breakfastModel.breakfastByDate` serves the new hour on all three cards, and
      `getForReservation` reopens the SAS on it.
- [x] Full server suite green.

### Manual UI verification
- [x] Check-in SAS run in the app: hour changed to 08:30, committed; the planning breakfast card of the
      stay shows 08:30. Screenshot in the PR.

## 8. Out of scope

- Editing the hour of ONE morning from the SAS (the SAS sets the hour of the stay; per-day tuning stays
  on the fiche).
- The push notice's lead time (`breakfastNotifyLeadMinutes`), unchanged.
- Any change to the breakfast card's contents (drinks, food, note).

## 9. Open questions

None — rule 1 (one hour per stay) is what the SAS page already promises the operator.
