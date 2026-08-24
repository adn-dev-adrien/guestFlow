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

Both symptoms come from one confusion. Three rules ask « has the stay started? » and all three answer
it with the **calendar**: `startDate <= today`. That is a different question from « is the guest
here? ». On the arrival day, before anyone has checked in, the app already behaves as if the guest had
moved in:

1. `resolveArrivalExtrasBaseline` **synthesizes** a baseline of the extras as they stand right now, and
   `captureArrivalExtrasBaselineIfDue` **stores** it on the next save. From that instant, anything
   added is « above the baseline » — i.e. sold *during* the stay — and
   `specs/mid-stay-extras-to-end-of-stay-complement.md` correctly routes it to the checkout complement.
   The routing is right; the premise is wrong.
2. `stayStarted`, which files an unsettled arrival complement under « fin de séjour »
   (`specs/complement-buckets-by-moment.md` §3 rule 5), flips on the same calendar test — so the whole
   arrival complement reads under the departure heading on the arrival day.

The **duplicate** is a third, independent defect that the first one makes visible:
`arrivalComplementDetailFromReservation` lists every `inComplement` line at its **full** price, while
`complementAmount` has already had the mid-stay share carved out by the engine. The same prestation is
therefore printed twice — once in the arrival detail at full price, once in the end-of-stay detail —
and the arrival card's lines add up to more than the card's own header. The totals stay correct
(they come from the engine), which is exactly what the operator observed.

## 2. Goal

Nothing counts as « sold during the stay » before the guest has actually arrived, and a prestation
billed at check-out is listed once, where it is collected.

## 3. Functional rules

1. **The arrival is an operator act, not a date.** The arrival-extras baseline is pinned when the
   check-in is marked (`checkInDone = 1`) **or** the arrival SAS is completed (`arrivalSasDoneAt` set).
   Both signals count: the two flows are used side by side (24 and 17 stays respectively on the
   operator's base) and either one means the guest is standing there. The calendar no longer plays any
   part — neither in the stored capture nor in the synthesized preview.
2. **Safety valve — a collected arrival complement also pins the baseline.** Once that complement is
   collected its amount is frozen, so a later sale can no longer join it; without a baseline to stand
   above, the sale would reach no bucket at all and its money would vanish
   (`specs/sas-breakfast-and-catering-upsell.md` §3.4). Pinning on collection keeps that impossible
   even when the operator never marked the check-in.
3. **The « fin de séjour » heading follows the same signal.** An unsettled arrival complement reads
   under « fin de séjour » once the guest is *in* — checked in — not once the date has come. Before
   that it stays under « arrivée »: it is what will be collected when the guest walks in.
4. **The arrival detail lists only what the arrival collects.** Each `inComplement` line is listed at
   its price **minus** the share carved to the end-of-stay complement, consuming that share line by
   line (two lines sharing a key split it). A line sold entirely during the stay leaves the arrival
   detail. The detail then adds back up to its own header, so the « Complément d'arrivée » remainder
   line stops being crowded out. Offered lines display at 0 € and consume nothing.
5. **Migration — clear the baselines pinned before any arrival.** Idempotent: `arrivalExtrasBaseline`
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
- **Partially carved line** (25 € at arrival, 50 € sold during the stay): 25 € under « arrivée »,
  50 € under « fin de séjour ». Both cards list it once, at their own share.

---

## 4. Architecture

> **Fat backend.** The whole change is server-side: one shared predicate, the two baseline resolvers,
> the arrival detail builder and one controller flag. The client renders the same payloads.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `arrivalMoment.js` | C | The shared predicates: `hasGuestArrived(row)` (check-in or arrival SAS) and `arrivalBaselineDue(row)` (the same, plus the collected-complement valve). One place to answer « is the guest here? », so the three call sites can never drift apart again. |
| `models/` | `reservationsModel.js` | T | `resolveArrivalExtrasBaseline` / `captureArrivalExtrasBaselineIfDue`: gate on `arrivalBaselineDue` instead of `startDate <= today`; the `todayIso` parameter disappears. `arrivalComplementDetailFromReservation`: deduct the mid-stay share per line (rule 4), via a new `arrivalDetailMidStaySplit` helper that reuses `resolveMidStaySplit` — the same resolver the pricing engine and the accounting export use, so the three can never disagree. |
| `controllers/` | `reservationsController.js` | T | `stayStarted` reads `hasGuestArrived(row)`; the two capture calls drop their date argument. |
| `database.js` | `database.js` | T | The idempotent baseline cleanup of rule 5. |
| `utils/` | `midStayExtras.js` | — | (none) — `resolveMidStaySplit` / `extraLineKey` / `storedMidStayLines` reused as they are. |
| `tests/` | `arrival-moment-is-the-check-in.unit.test.js` | C | The predicates, and the arrival detail: listed once at its arrival share, whole when nothing is carved, absent when sold entirely mid-stay, offered lines unaffected. |
| `tests/` | `reservations-mid-stay-sync.unit.test.js` | T | Fixture gains a `checkedIn` flag; the « stay started » cases become « guest arrived », plus the new regression (arrival day reached, check-in not done → no baseline) and the safety valve. |

### 4.2 Client side (`client/src/`)

No change. The arrival complement card, the SAS recap and the J-2 email all read
`buildArrivalComplementDetail`, so they stop showing the duplicate line at once.

### 4.3 API contract

Unchanged: same endpoints, same payload shape. `complement`/`checkoutComplement` carry the same fields;
only which lines they contain, and how an added extra is routed, changes.

---

## 5. Data model

No schema change. One idempotent data repair (rule 5) in `database.js`.

**Data impact:** clears `arrivalExtrasBaseline` on stays that have no arrival signal and no collected
complement. On the operator's base the cleanup matches 0 rows today (all 9 stored baselines are
legitimately due — 8 checked in, 1 with a collected complement); on production it is what un-sticks the
reservations already misfiled. Verified on a copy: a row forced into the polluted state is cleared,
every legitimate baseline is kept.

## 6. UI / UX

No new screen, no new string. Two visible consequences:

- An option added before the check-in appears under **Complément d'arrivée**, not under « fin de
  séjour ».
- A prestation partly sold during the stay is listed **once per card, at that card's share**, instead
  of at full price on both. The arrival card's lines now sum to its header.

Responsive behaviour unchanged (no layout touched).

## 7. Test plan

### Server unit tests
- [x] `arrival-moment-is-the-check-in.unit.test.js` (6, new) — `hasGuestArrived` ignores the date and
      accepts either signal; `arrivalBaselineDue` accepts a collected complement; the arrival detail
      lists a partly-carved line once at 25 € (not 75 €) and sums back to its header; a line with no
      baseline stays whole; a line sold entirely mid-stay leaves the arrival detail; an offered line
      still displays 0 € / 30 € original and consumes no mid-stay share.
- [x] `reservations-mid-stay-sync.unit.test.js` (20) — **the reported bug as a regression**: arrival day
      reached, check-in not done → still no baseline. Plus the safety valve (collected complement → the
      preview synthesizes one anyway).
- [x] Full server suite green: **3616 pass** (3610 before this spec's tests, 3608 before the change).

### Migration
- [x] Replayed on a copy of the operator's base: 0 legitimate baseline touched; a row forced into the
      polluted state is cleared and logged.

### Manual UI verification
- [ ] On a stay whose arrival day has come with the check-in not done: add an option → it lands in
      « Complément d'arrivée » and is listed once. _(to run on the dev server with a stay in that
      state; covered meanwhile by the unit regressions above.)_

## 8. Out of scope

- The routing itself (`specs/mid-stay-extras-to-end-of-stay-complement.md`): what a real mid-stay sale
  does is unchanged and correct — only *when* the window opens moves.
- The « Complément d'arrivée » remainder line and the adjusted-complement ventilation: untouched.
- Rebuilding `endOfStayComplementDetail` for stays already misfiled — the cleared baseline makes the
  next save recompute it. A stay whose end-of-stay complement is already collected keeps its lines
  (rule 5 excludes it).

## 9. Open questions

None.
