# The arrival moment is the check-in, not the calendar date

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/arrival-moment-is-the-check-in` |
| **Created** | 2026-08-24 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Reported on production, 2026-08-24: **adding an option by hand while the check-in is not done sends it
to the « complément de fin de séjour » instead of the « complément d'arrivée » — and the line then
shows twice, even though the total is right.**

The **duplicate** half was already fixed on master two days earlier, by PR #486
(`arrivalComplementDetailFromReservation` now deducts the share carved to the end-of-stay complement,
line by line). It is simply not released yet, so production still shows it. Nothing to do here.

The **routing** half is this spec. `arrivalExtrasBaselineIsDue` asks « has the stay started? » and
answers it with the **calendar**: `startDate <= today`. That is a different question from « is the
guest here? ». On the arrival day, before anyone has checked in,
`resolveArrivalExtrasBaseline` already **synthesizes** a baseline of the extras as they stand, and
`captureArrivalExtrasBaselineIfDue` **stores** it on the next save. From that instant anything added
stands « above the baseline » — i.e. sold *during* the stay — and
`specs/mid-stay-extras-to-end-of-stay-complement.md` routes it, correctly, to the checkout complement.
**The routing is right; the premise is wrong.**

## 2. Goal

Nothing counts as « sold during the stay » before the guest has actually arrived.

## 3. Functional rules

1. **The arrival is an operator act, not a date.** The arrival-extras baseline is pinned when the
   check-in is marked (`checkInDone = 1`) **or** the arrival SAS is completed (`arrivalSasDoneAt` set).
   Both signals count: the two flows are used side by side (24 and 17 stays respectively on the
   operator's base) and either one means the guest is standing there. The calendar no longer plays any
   part — neither in the stored capture nor in the synthesized preview.
2. **The collected-complement valve is kept, untouched.** A collected arrival complement already pins
   the baseline (added by PR #486 on 2026-08-22, for the same money-losing reason: that amount is
   frozen, so a later sale can no longer join it, and without a baseline to stand above it would reach
   no bucket at all). Rule 1 replaces only the *other* branch of that predicate — the calendar one.
3. **Migration — clear the baselines pinned before any arrival.** Idempotent: `arrivalExtrasBaseline`
   is set to NULL on stays with no check-in, no arrival SAS, no collected complement (arrival or
   end-of-stay, cash or not) and no settled mid-stay note. Those stays are still pre-arrival, so a
   stale baseline is exactly what misfiles their extras. Money-safe by construction — every excluded
   condition is a case where something has already been collected against that baseline.

**Edge cases:**
- **Walk-in / stay recorded after the fact** (created while already running): no baseline until the
  check-in is marked, so extras added meanwhile join the arrival complement. That is the intended
  reading — the operator has not yet said the guest is in.
- **A stay in progress where the check-in was never marked**: extras keep landing in the arrival
  complement until either signal appears, or until a complement is collected (rule 2).
- **Re-opened arrival SAS**: `arrivalSasDoneAt` stays set, so the baseline stays pinned — a re-commit
  never re-opens the pre-arrival window.

---

## 4. Architecture

> **Fat backend.** Server-side only: one shared predicate and the branch of the baseline gate that
> reads it. The client renders the same payloads.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `arrivalMoment.js` | C | `hasGuestArrived(row)` — check-in box or arrival SAS. Its own module because « is the guest here? » is asked from more than one layer and was answered differently in each; one place makes divergence impossible. |
| `models/` | `reservationsModel.js` | T | `arrivalExtrasBaselineIsDue`: its calendar branch becomes `hasGuestArrived(row)`; the collected-complement branch (PR #486) is untouched. `resolveArrivalExtrasBaseline` / `captureArrivalExtrasBaselineIfDue` lose their now-dead `todayIso` parameter and read the whole row, so a minimal test schema without the check-in columns degrades to « not arrived » instead of failing the query. |
| `controllers/` | `reservationsController.js` | T | The three call sites drop the date argument. |
| `database.js` | `database.js` | T | The idempotent baseline cleanup of rule 3. |
| `utils/` | `midStayExtras.js` | — | (none) — the mid-stay split and the arrival-detail carving are PR #486's, reused as they are. |
| `tests/` | `arrival-moment-is-the-check-in.unit.test.js` | C | The predicate alone: the date never counts, either signal suffices, a null row is safe. |
| `tests/` | `settled-complement-closes-bucket.unit.test.js` | T | Where the baseline's lifecycle is already tested (PR #486): the « stay started » case becomes « guest arrived », plus the reported bug as a regression and the SAS-only signal. |
| `tests/` | `reservations-mid-stay-sync.unit.test.js` | T | Fixture gains a `checkedIn` flag; its capture cases follow the same rule. |

### 4.2 Client side (`client/src/`)

No change.

### 4.3 API contract

Unchanged: same endpoints, same payload shape. Only *when* an added extra is treated as a mid-stay sale
changes.

---

## 5. Data model

No schema change. One idempotent data repair (rule 3) in `database.js`.

**Data impact:** clears `arrivalExtrasBaseline` on stays that have no arrival signal and nothing
collected. On the operator's base the cleanup matches 0 rows today (all 9 stored baselines are
legitimately due — 8 checked in, 1 with a collected complement); on production it is what un-sticks the
reservations already misfiled. Verified on a copy: a row forced into the polluted state is cleared and
logged, every legitimate baseline is kept.

## 6. UI / UX

No new screen, no new string. One visible consequence: an option added before the check-in appears
under **Complément d'arrivée** instead of « fin de séjour ». Responsive behaviour unchanged (no layout
touched).

## 7. Test plan

### Server unit tests
- [x] `arrival-moment-is-the-check-in.unit.test.js` (2, new) — the date never means arrival (including a
      long-past `startDate`); the check-in box and the arrival SAS each suffice on their own.
- [x] `settled-complement-closes-bucket.unit.test.js` (13) — **the reported bug as a regression**:
      arrival day reached, check-in not done → still no baseline, neither resolved nor captured. Plus
      « client arrivé → la base existe comme avant » and the SAS-only signal. The collected-complement
      valve and the arrival-detail carving keep their PR #486 tests, green and untouched.
- [x] `reservations-mid-stay-sync.unit.test.js` (20) — capture cases realigned on the arrival signal.
- [x] Full server suite green: **3636 pass**.

### Migration
- [x] Replayed on a copy of the operator's base: 0 legitimate baseline touched; a row forced into the
      polluted state is cleared and logged.

### Manual UI verification
- [ ] On a stay whose arrival day has come with the check-in not done: add an option → it lands in
      « Complément d'arrivée ». _(to run on the dev server with a stay in that state; covered meanwhile
      by the unit regressions above.)_

## 8. Out of scope

- The routing itself (`specs/mid-stay-extras-to-end-of-stay-complement.md`): what a real mid-stay sale
  does is unchanged and correct — only *when* the window opens moves.
- The duplicated line the operator also reported: already fixed on master by PR #486, awaiting release.
- The « Complément d'arrivée » remainder line and the adjusted-complement ventilation: untouched.
- Rebuilding `endOfStayComplementDetail` for stays already misfiled — the cleared baseline makes the
  next save recompute it. A stay whose end-of-stay complement is already collected keeps its lines
  (rule 3 excludes it).

## 9. Open questions

None.
