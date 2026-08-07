# A frozen complement must not take the client's amount

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/sas-bath-linen-ghost-line` _(shipped with the ghost-line fix)_ |
| **Created** | 2026-08-07 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Reported in production on reservation #22269 (Carole Foulon, 05→…/08/2026): « Blonde du Pilat »
6,50 € is booked **twice** in the accounts.

Timeline from `reservation_history`:

| When | Action | Effect |
|---|---|---|
| 05/08 14:37 | arrival SAS — « complément encaissé » | `complementPaid = 1`, `complementPaidDate = 2026-08-05`, complement **frozen** at what was then due: 24 € (Linge de toilette) |
| 06/08 10:48 | option « Blonde du Pilat » 6,50 € (`compl.`) added on the fiche | sold **during the stay** → end-of-stay complement, `endOfStayComplementAmount = 6,50` ✅ … **and** `complementAmount` moved 24 → **30,50** ❌ |

The guest is not over-charged at the door (24 + 6,50 = the right total), but the arrival complement
is over-reported by 6,50 € — and since the accounting emits a `complement` entry from
`complementAmount` **and** a flat `endOfStayComplement` entry, the beer is credited twice.

### 1.1 Root cause (reproduced 2026-08-07 against a copy of the production DB)

| Engine inputs | `complementAmount` returned |
|---|---|
| frozen, client sends the stored 30,50 | **30,50** (verbatim) |
| frozen, client sends 24 | 24 |
| not frozen, **with** the mid-stay baseline | **24** ✅ |
| not frozen, **without** the baseline | **30,50** ❌ |

Two independent weaknesses chain up:

1. **The save trusts a client-computed amount.** The fiche sends
   `complementAmount: quote.complementAmount` ([ReservationPage.jsx:2078](client/src/pages/ReservationPage.jsx#L2078)),
   where `quote` comes from `POST /reservations/calculate-price` — a handler that never forwards
   `complementPaid` / `complementAmount` ([reservationsController.js:292-336](server/src/controllers/reservationsController.js#L292-L336)).
   `update` then passes that value straight to the engine
   ([reservationsController.js:596](server/src/controllers/reservationsController.js#L596)).
2. **The frozen branch re-stores it without validation**
   ([pricing.js:1836-1838](server/src/utils/pricing.js#L1836-L1838)):
   `if (complementPaid) resolvedComplementAmount = roundMoney(complementAmount)`.
   « Frozen » is meant to mean « keep what was collected », but it actually means « keep what the
   client sent » — so any quote computed without the mid-stay split can inflate a settled bucket.

This is a **fat-backend violation** (CLAUDE.md §6.0): a money field that matters for accounting is
authoritative on the client.

**Scope in production (verified read-only):** one reservation, #22269. It is the only one with both a
frozen complement and mid-stay lines.

## 2. Goal

Once the arrival complement is collected, its amount is what was actually collected — no later edit,
and no value coming from the browser, can change it. The beer is credited once.

---

## 3. Functional rules

1. When `complementPaid = 1`, the amount the engine freezes is the one **stored in the database**,
   never the one in the request body. The client's `complementAmount` is ignored on a frozen bucket.
2. Rule 1 is applied server-side in `update`: the stored value is read from the row and passed to the
   engine. The engine's frozen branch itself is unchanged (it stays « return the input »).
3. A **boot repair** (`database.js`) corrects the rows already inflated: for a reservation with
   `complementPaid = 1` carrying mid-stay lines, `complementAmount` is reduced by the forced mid-stay
   part already billed in the end-of-stay complement (`resolveMidStaySplit(...).forced`), floored at 0.
   **One-shot, guarded by the `migrations` table** — the correction subtracts, so re-running it every
   boot would keep eating into the amount (24 → 17,50 → 11…). Rule 1 is what prevents new cases.
4. The repair never touches `complementPaid`, `complementPaidDate` or `complementPaidCash` — when the
   money was collected is a fact.
5. A reservation whose complement is not frozen, or which carries no mid-stay line, is untouched.

**Edge cases:**
- Reduction would go below 0 → floored at 0, and a `console.warn` names the reservation.
- `complementAmount` already correct (repair computes the same value) → no write.
- Mid-stay lines but complement **not** paid → nothing to repair: the engine recomputes it correctly
  on the next save (verified: 24 € with the baseline).
- The same client-trust pattern exists for `depositAmount` / `balanceAmount`. **Out of scope** here —
  no production row is affected, and those buckets have their own override rules
  (`depositAmountOverride`). Noted in §8.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `reservationsController.js` | T | `update` passes the **stored** `complementAmount` when the complement is frozen, instead of `req.body.complementAmount`. |
| `utils/` | `frozenComplementRepair.js` | C | Pure `repairFrozenComplement({ complementAmount, complementPaid, midStayForced })` → `null` when clean, else the corrected amount. Unit-tested. |
| `utils/` | `complementDataRepairs.js` | C | `repairFrozenComplements(db)` — finds the frozen complements carrying mid-stay lines and applies the pure helper. **A util, not a model method:** `database.js` cannot require `reservationsModel` (it binds itself to `require('../database')` at load, so a mid-file require would hand it a half-built module). Shared with the ghost-line repair. |
| `database.js` | `database.js` | T | One-shot boot repair (rule 3) behind a `migrations` guard, logging the rows it corrected. |
| `utils/pricing.js` | — | — | Unchanged: the freeze contract stays « return the input ». |

The line reader inside `complementDataRepairs` selects `inComplement`, unlike
`reservationsModel.readExtraLines` (which only feeds the baseline: keys + totals). That flag is what
makes a mid-stay line « forced », i.e. the only part that sits in the arrival complement.

### 4.2 Client side (`client/src/`)

No change. The fiche keeps sending `complementAmount`; the server simply stops believing it on a
frozen bucket.

### 4.3 API contract

Unchanged. `PUT /api/reservations/:id` silently ignores `complementAmount` when `complementPaid = 1`.

---

## 5. Data model

No schema change. The boot repair rewrites `reservations.complementAmount` on matching rows.

**Data impact:** in production, exactly one row (#22269): `complementAmount` 30,50 → 24,00. The
accounting entry `complement` for that reservation is dated **05/08/2026**, so the **August export
changes**: −6,50 € on the complement entry, the beer staying on the end-of-stay entry. That is the
correction being asked for. The deploy backs the DB up first (`deploy.yml`).

## 6. UI / UX

No component changes. On the fiche, the arrival complement shows 24,00 € (what was collected on
05/08) instead of 30,50 €, and the end-of-stay complement keeps its 6,50 €.

## 7. Test plan

### Server unit tests
- [x] `tests/complement-data-repairs.unit.test.js` (shared with the ghost-line spec) — rules 3/5 +
      edge cases: inflated frozen complement corrected, clean one returns `null`, floor at 0, unpaid
      complement untouched, mid-stay-free reservation untouched.
- [x] Full server suite: 2375 pass.

### Manual verification (2026-08-07, against a **copy** of the prod DB)
- [x] Reservation #22269: `complementAmount` 30,50 → **24,00**, end-of-stay unchanged at 6,50.
- [x] **Accounting, August, check-out simulated so both entries exist:**
      before → `complement` 30,50 + `endOfStayComplement` 6,50 = **37,00 €** (beer twice);
      after → `complement` 24,00 + `endOfStayComplement` 6,50 = **30,50 €** (beer once, the right total).
- [x] Regression: an unpaid complement still recomputes normally (engine returns 24 € with the baseline).

## 8. Out of scope

- `depositAmount` / `balanceAmount`, which follow the same client-trust pattern on their frozen
  branches. No production row is affected; to be revisited with the deposit-override rules.
- Reworking how the live preview computes the complement (the server-side authority added here makes
  the preview's value advisory, which is enough).
- The bath-linen ghost line — separate cause, separate spec
  ([sas-bath-linen-ghost-line.md](specs/sas-bath-linen-ghost-line.md)), shipped in the same PR.

## 9. Open questions

- Q: Repair the stored amount, or only carve the mid-stay part out at accounting time?
  - A: (2026-08-07) Repair the stored amount. The fiche shows `complementAmount` as « collected » too,
    so carving only in the export would leave the fiche claiming 30,50 € were taken at the door.
