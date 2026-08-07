# Ghost bath-linen line in the end-of-stay complement

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/sas-bath-linen-ghost-line` |
| **Created** | 2026-08-07 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Reported in production on reservation #10 (Chloé Vallée, 01→15/08/2026): « Linge de toilette » is
billed **twice** in the « Complément de fin de séjour » card while the fiche carries the option only
once.

Timeline reconstructed from `reservation_history`:

| When | Action | Where the money landed |
|---|---|---|
| 01/08 15:06 | arrival SAS — bath linen **deferred to check-out** | detail line `{source:'arrivalBathLinen', amount:40}` in `reservations.endOfStayComplementDetail`, `endOfStayComplementAmount = 40` |
| 03/08 07:12 | option « Linge de toilette » (40 €, `compl.`) added on the fiche | `reservation_options` row with `inComplement = 1` → arrival complement, `complementAmount = 40` |

The two buckets are independent by design (specs/defer-arrival-complement-to-checkout.md §3.2 rule 9)
and [`buildCheckoutComplement`](server/src/utils/checkoutComplement.js) concatenates them without
deduplication, so the merged card shows **2 × 40 € = 80 €** for a single 40 € service. Nothing is
collected yet (check-out 15/08), so no money has actually moved.

Three aggravating facts:

1. **The existing self-repair can't fire.** `ReservationSasDialog` already knows how to absorb a legacy
   deferred line: re-opening the arrival SAS pre-selects it as « ajouté » and the re-commit drops it
   ([ReservationSasDialog.jsx:291-298](client/src/components/sas/ReservationSasDialog.jsx#L291-L298)).
   But that repair only runs when the bath-linen **step is shown**, and the step is hidden as soon as a
   bath-linen option exists on the reservation. Once both exist, the ghost line is unreachable from the UI.
2. **A display-only guard is not enough.** `endOfStayComplementAmount` is read straight from SQL by
   `accountingModel`, `financeModel`, `reservationSettlement` and the departure SAS — patching only the
   merged card would still bill and book the 40 €.
3. **The deferral is already gone from the UI.** Commit `747d835` (#366, 2026-08-02, « settle
   bath-linen upsell on the recap, not at option selection ») removed the « réglé en fin de séjour »
   choice: the dialog now always sends `endOfStayBathLinen: false`. Reservation #10's SAS ran on
   01/08 — the day before. **No new ghost line can be created today**; only the residue remains.

**Scope in production (verified read-only, 2026-08-07):** exactly **one** reservation carries an
`arrivalBathLinen` line — #10. Three reservations have a non-empty `endOfStayComplementDetail`.

### 1.1 The invariant this spec writes down

> **Everything the arrival SAS sells is a line ON THE RESERVATION FICHE — never a parallel billing
> line.** One service, one row the operator can see and edit; the complement buckets are derived from
> those rows, never fed in parallel.

The codebase already honours it everywhere but the deferral path:

| What the arrival SAS sells | Where it lands |
|---|---|
| Missing linen elements | `reservation_custom_options` (`sasArrivalOrigin = 1`, in complement) ✅ |
| Ménage | catalogue option activated on the fiche (`sasArrivalOrigin = 1`) ✅ |
| Linge de toilette | catalogue option activated on the fiche ✅ |
| Linge de toilette « réglé en fin de séjour » | `endOfStayComplementDetail` line ❌ **the only exception** |

Deleting that exception — rather than guarding against its consequences — is what this spec does.

## 2. Goal

What the arrival SAS sells exists **once**, as a line on the reservation fiche. The parallel
bath-linen billing line disappears from the code and from the data, so no reservation can bill the
same service twice — starting with #10, repaired on deploy without a manual write on the Pi.

---

## 3. Functional rules

1. **The arrival SAS never writes into `endOfStayComplementDetail` again.** The `endOfStayBathLinen`
   parameter is removed from the commit payload, the controller and the model: what the guest takes is
   the catalogue option activated on the fiche (rule already in force since #366), full stop.
2. **Every arrival SAS commit drops any `arrivalBathLinen` line** it finds, unconditionally — no longer
   gated on the bath-linen step being shown. Re-running the SAS on a stuck reservation repairs it.
3. A **boot cleanup** (`database.js`, idempotent) drops the same lines on existing rows, for the
   reservations whose SAS will never be re-run — the single production case (#10).
4. Dropping a line recomputes `endOfStayComplementAmount` as the sum of the remaining detail lines.
   A detail that becomes empty is stored as `NULL`, like everywhere else.
5. `endOfStayComplementPaid` / `endOfStayComplementPaidDate` / `endOfStayComplementPaidCash` are
   **never** touched — a collected complement is a fact, not a derivation.
6. A reservation with no `arrivalBathLinen` line is left byte-for-byte untouched.
7. Nothing else in either SAS changes: the departure SAS keeps owning its own end-of-stay lines
   (ménage de fin de séjour, extincteur, linge manquant), which are collected at the door on the spot
   and have no fiche counterpart to collide with.

**Edge cases:**
- Ghost line **without** a bath-linen option on the fiche (the service was genuinely deferred and never
  activated) → the line is still dropped, so the amount must be re-billed as an option if it is still
  due. **No production row is in that case** — #10 is the only carrier and it has the option.
- `endOfStayComplementPaid = 1` while carrying a ghost line → the line is dropped and the amount
  recomputed, but the paid markers stay; logged as a `console.warn` at boot since a collected amount
  changes retroactively. **No production row is in that case** (#10 is unpaid).
- Several `arrivalBathLinen` lines (impossible today, the SAS filtered before pushing) → all dropped.
- Mid-stay lines (`source = 'midStayExtra'`) and departure SAS lines are never touched.
- A client still sending `endOfStayBathLinen` (stale tab) → the field is ignored, not an error.

---

## 4. Architecture

> Fat backend: the whole rule is a pure function over `(options, endOfStayComplementDetail)`; the
> client is not modified at all.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `bathLinenGhostLine.js` | C | Pure `dropBathLinenGhost(endOfStayComplementDetail)` → `null` when clean, else `{ detail, amount }` to persist. Unit-tested. |
| `models/` | `reservationsModel.js` | T | Deletes the `endOfStayBathLinen` branch of `commitArrivalSas`; the commit now calls `dropBathLinenGhostLine(id)` unconditionally (rule 2). |
| `utils/` | `complementDataRepairs.js` | C | `repairBathLinenGhosts(db)` for the boot cleanup. **A util, not a model method:** `database.js` cannot require `reservationsModel` (it binds itself to `require('../database')` at load, so a mid-file require would hand it a half-built module). Shared with [frozen-complement-trusts-client.md](specs/frozen-complement-trusts-client.md). |
| `controllers/` | `sasController.js` | T | Drops `endOfStayBathLinen` from the accepted commit payload. |
| `database.js` | `database.js` | T | Idempotent boot cleanup block (rule 3), logging how many rows it repaired. |
| `routes/` | — | — | (none) |

Net effect on the codebase: one parameter and ~25 lines of branching **removed**, one 20-line pure
helper added.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/sas/` | `ReservationSasDialog.jsx` | T | Stops sending `endOfStayBathLinen` (already hard-coded to `false`); drops the legacy re-open branch that pre-selected « ajouté » from a ghost line — the server now cleans up on its own. |

The fiche and both SAS keep rendering `endOfStayComplementDetail` / `endOfStayComplementAmount` as the
server ships them.

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/:id/sas/arrival` | `endOfStayBathLinen` **removed** | unchanged | The field is ignored if still sent (stale tab), never an error. |

---

## 5. Data model

No schema change. The cleanup **rewrites two existing columns** on matching rows:
`endOfStayComplementDetail` (line removed) and `endOfStayComplementAmount` (recomputed).

**Data impact:** in production, exactly one row (#10) — `endOfStayComplementAmount` 40 → 0, detail
→ `NULL`, and the merged complement drops from 80 € to the correct 40 €. Nothing is deleted from
`reservation_options`; no other table is touched. The deploy backs the DB up before migrating
(`deploy.yml`, « Backup database before deploy »).

## 6. UI / UX

No component changes. On reservation #10 the « Complément de fin de séjour » card goes from

```
Linge de toilette   40,00 €
Linge de toilette   40,00 €
Total               80,00 €
```

to

```
Linge de toilette   40,00 €
Total               40,00 €
```

Responsive behavior unchanged. `PageActionBar` untouched.

## 7. Test plan

### Server unit tests
- [x] `tests/complement-data-repairs.unit.test.js` — rules 4/6: ghost dropped, amount recomputed,
      empty detail → `NULL`, a clean detail returns `null` (no write); mid-stay and departure lines
      preserved; several ghosts dropped at once; boot cleanup idempotent (second pass repairs 0 rows).
- [x] `tests/sas-commit.unit.test.js` — the 7 tests of the removed flow replaced by 3: the arrival
      commit never writes an end-of-stay line (the upsell lands on the fiche as a catalogue option),
      it clears a ghost line even when the bath-linen step is not part of the run, and it is idempotent.
- [x] Full server suite: 2375 pass.

### Client tests
- [x] `ReservationSasDialog.test.jsx` — the commit payload no longer carries `endOfStayBathLinen`
      (two assertions flipped to `not.toHaveProperty`). Full client suite: 801 pass.

### Manual verification (2026-08-07, against a **copy** of the prod DB)
- [x] Reservation #10: `endOfStayComplementAmount` 40 → **0**, detail → `NULL`, arrival complement
      untouched at 40 → the merged card shows **one** line at 40 €.
- [x] Boot cleanup idempotent on the real data (second pass: 0 rows).
- [x] Regression: departure lines (« Ménage de fin de séjour ») survive an arrival re-commit (unit test).

## 8. Out of scope

- **The general two-bucket deduplication** (any service present in both the arrival complement and the
  end-of-stay one). Deliberately narrowed to the SAS bath-linen case — decision 2026-08-07.
- **Reservation #22269 (Carole Foulon).** Same symptom, different cause: « Blonde du Pilat » 6,50 € sold
  mid-stay on 06/08 sits both in `complementAmount` (30,50 €, frozen as **paid** by the arrival SAS on
  05/08 when it should have been 24 €) and in the end-of-stay complement as a `midStayExtra` line. The
  guest is not over-charged at the door (24 + 6,50 = the right total) but the arrival complement is
  over-reported by 6,50 € in the accounts. Root cause to confirm: the frozen branch of the engine
  re-stores the amount **sent by the client** (`complementAmount: req.body.complementAmount` →
  [reservationsController.js:596](server/src/controllers/reservationsController.js#L596), then
  [pricing.js:1836-1838](server/src/utils/pricing.js#L1836-L1838)), so a client-side value computed
  without the mid-stay split can overwrite a frozen bucket. Needs its own spec.
- **Applying the same invariant to the departure SAS.** Its end-of-stay lines have no fiche counterpart
  and are collected on the spot, so nothing can accumulate against them. Revisit if that changes.
- Any manual SQL on the production database.

## 9. Open questions

- Q: Repair the data by migration, or only ignore the ghost line at read time?
  - A: (2026-08-07) By migration — `endOfStayComplementAmount` is read straight from SQL by the
    accounting, finance and settlement layers, so a read-time guard would still bill and book the 40 €.
- Q: Guard against the duplicate, or remove the path that creates it?
  - A: (2026-08-07) Remove it. Everything the arrival SAS sells must be a line on the fiche (§1.1);
    the deferred line was the last exception and its UI was already gone since #366. Deleting the path
    is smaller than guarding it and makes the invariant structural rather than defensive.
