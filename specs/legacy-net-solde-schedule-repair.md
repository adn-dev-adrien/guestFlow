# The échéancier holds what the guest pays, never the net of the commission

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/legacy-net-solde-schedule` |
| **Created** | 2026-08-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Coherence audit of the production base run on 2026-08-25, right after the 2.5.0 install: 46
reservations, 43 accounting entries, February → August 2026. The books came out clean — every entry
balances, total debits equal total credits to the cent (20 541,49 €), the CSV and the JSON preview
carry the same lines, and the ventilation per account matches the fiche's own lines.

**One reservation disagrees with its own books: #7 (Yann Parreton, Gîtes de France, mai 2026).**

| | Amount |
|---|---|
| Journal — client debit | **903,00 €** |
| Journal — CA | 994,00 € (with a 91,00 € commission charge) |
| Fiche — « encaissé » | **812,00 €** |

Gîtes de France billed the guest 994 € and transferred 903 €; the journal is right. The fiche is
short by exactly the commission, and its « total du séjour » with it.

**Why.** Since `specs/platform-per-echeance-commission.md` an échéance stores the **gross** — what the
guest pays the platform — and the operator-entered commission lives beside it; the owner banks
`échéance − commission`. Réservation #7 predates that convention: its history shows the 2026-06-22
save that entered the commission writing `finalPrice = 994` (the gross) and `balanceAmount = 903`
(the **net**), with `platformCommissionAmount = 91` recorded as well. Every reader that nets the
commission out of the échéance — `reservationSettlement.comptaCollected`, `remainingToPay`, the
finance overview, the engine's `sejourNetTotal` — therefore deducts it a second time.

The accounting export already knows about that shape and repairs it on the fly: `buildEntry`'s
`isLegacyNetSchedule` detects « the schedule is short and the commission is exactly what is missing »
and grosses the stored amounts back up (`specs/accounting-books-the-money-collected.md` §3 rule 1,
second bullet). That is why the books are right and the fiche is not.

Production census — the shape is unique and closed. Of the 32 reservations carrying an entered
commission, 31 have a schedule that already sums to `finalPrice + taxe de séjour`; only #7 is short,
and short by exactly its commission.

## 2. Goal

The fiche and the books agree on what a stay collected: one reservation, one amount, whichever screen
reads it.

## 3. Functional rules

1. **An échéance holds the gross.** The acompte, the solde, the complément d'arrivée and the
   complément de fin de séjour store what the guest pays; the platform commission is recorded beside
   them and deducted once, by the reader. This is the standing convention — the repair below only
   brings the legacy rows back into it.
2. **The legacy « solde = net » shape is repaired at boot**, once, for reservations where all three
   hold:
   - the platform is not `direct` and an entered commission is present (`acompteCommissionAmount +
     platformCommissionAmount > 0`),
   - `acompte + solde + complément + complément de fin de séjour` differs from
     `finalPrice + taxe de séjour` by more than 0,02 €,
   - adding the total commission closes that gap to within 0,02 €.

   This is `accountingModel.buildEntry`'s own test, character for character. The repair must never
   key on anything the export does not.
3. **Each commission goes back into its own bucket**: the acompte commission into the acompte, the
   solde commission into the solde. The schedule then sums to `finalPrice + taxe de séjour`.
4. **The journal does not move.** Once the schedule is gross, the export's gross-up branch stops
   firing on the row and books the stored amounts verbatim — which produces exactly the entry it
   produced before. Verified on the production copy: the 43 entries of February → August 2026 are
   byte-identical before and after. A repair that changed a single centime of a month already at the
   accountant's would be a bug, not a fix.
5. **Anything ambiguous is left alone**, and never guessed at:
   - a schedule that drifts from the total by something other than the commission (a fiche edited
     after collection — production #22224, #22226, #22209, #22275) is *not* this shape; the books
     follow the money there, and inventing revenue is exactly what
     `specs/accounting-books-the-money-collected.md` rule 1 forbids;
   - a reservation whose complement the operator adjusted (`complementAmountOverride` set) keeps its
     stored ventilation (`specs/adjustable-complement-amounts.md` §3.6), so the export's denominator
     is not the stored complement and the shape test would not mean the same thing;
   - a commission with no bucket to ride on (an acompte commission on a stay with no acompte) is
     *reported in the boot log* and left untouched — repairing it would create a bucket that collects
     a commission and nothing else.
6. **One-shot.** The repair adds, and the shape it keys on is a fingerprint rather than an invariant,
   so it is guarded by the `migrations` table like the frozen-complement repair. The write path has
   stored gross échéances since `specs/platform-per-echeance-commission.md`: no new row can take this
   shape, and nothing needs to keep watching for it.

**Edge cases:**
- A direct booking carrying a commission (degenerate data) → out of scope by rule 2; the export
  ignores its commission too.
- A cancelled stay (`kind = 'cancelled'`) → repaired like any other: accounting still reads it
  (`specs/payment-schedule-and-cancellation.md` §3.6 rule 34).
- A base with no such row (every dev/test base, and production after the first boot) → the migration
  logs nothing and records itself as run.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none) |
| `controllers/` | — | — | (none) |
| `models/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `utils/` | `legacyNetSoldeRepair.js` | C | Detects the « solde = net » shape (mirroring the export) and puts each commission back into its bucket. Pure, `db`-injected, unit-tested. |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | `database.js` | T | One-shot migration block `legacy_net_solde_schedule_repair_v1`, in a transaction, logging the repaired and the skipped ids. |

No reader changes: `reservationSettlement`, the pricing engine and `accountingModel` are correct as
written — the data was not. Teaching each reader the legacy heuristic would have meant three copies
of one fingerprint, drifting apart at the first edit.

### 4.2 Client side (`client/src/`)

None. The fiche renders `collectedTtc` / the engine's totals as it already does; they simply carry
the right amount once the row is repaired.

**Component reuse declaration:** no component created or consumed — server-only change.

### 4.3 API contract

Unchanged.

---

## 5. Data model

No schema change. One row of `reservations` is rewritten on the production base:

| id | column | before | after |
|---|---|---|---|
| 7 | `balanceAmount` | 903,00 | 994,00 |

Migration strategy: `migrations.legacy_net_solde_schedule_repair_v1`, run inside a transaction at
boot, before the app serves anything.

**Data impact.** It rewrites a money column on a stay that is paid and already booked, so it was
validated against a copy of the production database before shipping: exactly one row matched, and the
whole journal (43 entries, 7 months) came out identical. Nothing is subtracted, so a partially
applied run cannot lose money; the flag makes it single-shot anyway. The rest of the base — the 31
other commissioned reservations, every direct booking, the drifted schedules — is untouched.

---

## 6. UI / UX

No screen changes. The visible consequence, on the fiche of réservation #7 and in « Suivi financier »:
« encaissé » reads **903,00 €** instead of 812,00 €, and the reste à payer stays 0,00 €. Same figure as
the journal, same figure as the bank.

Responsive behavior: unchanged (no layout touched). No `PageActionBar` change.

## 7. Test plan

### Server unit tests
- [x] `tests/legacy-net-solde-schedule-repair.unit.test.js` — 9 tests:
  - the net solde is regrossed and the schedule sums to the stay total again (rules 2-3),
  - **the journal is unchanged**: `buildRows` on the entry before and after the repair are deep-equal,
    and the client debit stays 903 € (rule 4),
  - each commission joins its own bucket (rule 3),
  - an already-gross schedule, a drift that is not the commission, a direct booking and an adjusted
    complement are all left alone (rule 5),
  - a commission with no bucket is reported as skipped, not repaired (rule 5),
  - re-running repairs nothing more (rule 6).
- [x] Full suite green (`cd server && npm test`).

### Manual verification
- [x] Migration replayed on a copy of the production base: 1 reservation repaired (#7), 0 skipped.
- [x] Journal of 2026-02 → 2026-08 dumped before and after: identical.
- [x] Coherence audit re-run on the repaired copy: the fiche/compta gap on #7 is gone; the four
      remaining schedule drifts are the post-collection edits of rule 5, which this spec deliberately
      does not touch.
- [ ] After deployment: open réservation #7 in production and read « encaissé 903,00 € ».

## 8. Out of scope

- The four stays whose échéancier drifted from their total by an operator edit made *after* the money
  was collected (#22224, #22226, #22209, #22275). The money is where it should be — in the books for
  what was banked, off-books for what was settled in caisse interne — and only the operator can say
  whether the guest overpaid or the fiche was edited by mistake.
- The `clientGrossAmount` era rows (#1-#4, #8), which the export handles on its own path and whose
  schedules already sum to their total.
- Any change to how the books recognise revenue (gross, with the commission as a charge) — that is
  `specs/accounting-platform-commission-and-no-deposit.md` and stays as it is.

## 9. Open questions

- Q: repair the data, or teach `reservationSettlement` the legacy shape?
  - A (2026-08-25): repair the data. The shape is closed — one row, and no write path can create
    another — so a permanent heuristic in a shared authority would be dead code guarding against a
    past that cannot come back. The proof that the repair is safe is that the journal does not move.
