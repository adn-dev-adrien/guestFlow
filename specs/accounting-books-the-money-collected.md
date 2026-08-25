# Accounting books the money actually collected, ventilated where it was collected

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/accounting-books-the-money-collected` |
| **Created** | 2026-08-24 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Coherence audit of the whole dev copy of prod (7 months, 40 entries), run 2026-08-24 while checking
réservation #22275 (Julie Carpier, Abracadaroom). The structure is sound — every entry balances, no
negative line, no collected money missing from the export — but **the amounts on three quarters of the
entries are not the money that moved**.

Two independent defects, both in `accountingModel.buildEntry`.

### Defect 1 — a gross-up ratio fires on reservations it was never meant for

`specs/accounting-encaissement-effective-percent.md` introduced
`grossRatio = (finalPrice + touristTax) / (acompte + solde + complément)` to repair two **historical**
schedule shapes (the « solde = net » era and the `clientGrossAmount` era). Its own comment states the
ratio « is 1 for every reservation written by the current engine ». That is false in two situations:

- **A stay with a mid-stay / end-of-stay complement.** The bain nordique sold during Carpier's stay
  (30 €) is revenue inside `finalPrice`, but its amount is carved *out* of the three échéances. The
  denominator is therefore 30 € short and every entry of that reservation is inflated by 3,5 %.
- **A stay whose stored schedule drifted from the total** (a fiche edited after collection). Nicolet
  #22226 has a schedule 28 € above its total, Vanden wildenberg #22224 21 € above: their entries are
  *deflated* by 9 % and 12 %.

Measured consequence on Carpier, once the money is marked collected (simulated on a throwaway copy):

| | Reality | Books today |
|---|---|---|
| Virement Abracadaroom | 573,77 € | client debit **599,24 €** |
| Total collected | 735,77 € | client debits **761,24 €** |
| CA of the stay | 878,87 € | **908,29 €** |

The client's auxiliary account — the line the accountant reconciles against the bank — is off by
25,47 €. The entry still balances, which is why nothing ever flagged it.

Second-order effect: because the ratio pulls `finalPrice` into the numerator, **money settled in
« caisse interne » leaks back into the books**. Foulon #22269's 6,50 € cash complement is excluded from
the export (correct) but re-injected into the solde entry by the ratio (wrong).

### Defect 2 — the revenue is ventilated per reservation, not per encaissement

In the stored-money path each entry credits *the whole reservation's* buckets scaled by
`fraction = revenue / finalPrice`. So the solde entry credits a share of option and resource revenue it
did not collect, and the complement entry credits a share of accommodation. On Carpier's solde — which
collects pure accommodation — the books credit 90,12 € of « prestations » and 23,51 € of « activités »
that belong to the arrival complement and to the checkout.

This is the defect Adrien described: the accounting must carry **one line totalling the options and
resources the client actually took, excluding anything settled in caisse interne** — not a proportional
smear of every line across every entry.

> **Path note.** 0 of the 46 reservations in the base carry per-line contribution snapshots, so the
> stored-money path below is the one that produces *every* entry the accountant reads. The
> contribution path is left untouched by this spec.

## 2. Goal

Every exported entry books exactly the money that encaissement collected, credited to the postes that
encaissement actually covers — so the client's auxiliary account always equals the bank movement, and
options and resources appear once, at their real amount, only when they were really collected.

## 3. Functional rules

### The money (defect 1)

1. **The stored échéances are the money.** In the entered-commission model the export computes
   `scheduledTotal = acompte + solde + complément + complément de fin de séjour` and
   `expected = finalPrice + taxe de séjour`, then:
   - `scheduledTotal ≈ expected` (± 0,02 €) → **ratio 1**, stored amounts booked verbatim. This now
     covers every current-engine reservation, *including* those with a mid-stay or end-of-stay
     complement — the case that was silently inflating entries.
   - else `scheduledTotal + commission totale ≈ expected` (± 0,02 €) → the **legacy « solde = net »
     shape**: ratio = `expected / scheduledTotal`, exactly as today. This is the only case that grosses
     amounts up, and it is what keeps réservation #7 (Parreton) booking 994 € of CA against a 903 €
     bank movement.

     > **Since 2026-08-25** the fiche of such a row disagreed with this branch: it deducted the
     > commission from a solde that was already net, and read « encaissé 812 € » where the journal and
     > the bank said 903 €. `specs/legacy-net-solde-schedule-repair.md` puts the commission back into
     > the échéance at boot, so #7 now takes the **ratio-1** branch above and produces the very same
     > entry. This branch stays — it is what makes that repair provably free of effect on the books —
     > but no reservation in production needs it any more.
   - else → **schedule drift**: ratio 1. The books follow the money; a fiche/total inconsistency is
     never resolved by inventing revenue.
2. **The complément de fin de séjour joins the denominator.** It is scheduled money like the other
   three, so a stay that sells a bain nordique mid-stay keeps a ratio of exactly 1.
3. **Caisse interne stays out, definitively.** With rule 1 no ratio can re-inject an off-books amount
   into another entry. Cash-settled complements remain un-exported, as before.
4. **The legacy `clientGrossAmount` path is untouched** (reservations with no entered commission).

### The ventilation (defect 2)

5. **Each line is booked where it is collected.** Every billed (non-offered) option / custom option /
   resource belongs to exactly one destination:
   - `inComplement = 0` → **pre-arrival** (acompte + solde),
   - `inComplement = 1` → **arrival complement**, minus any share sold mid-stay,
   - the mid-stay share → **complément de fin de séjour**.
6. **Acompte and solde** credit `[hébergement, options pré-arrivée, ressources pré-arrivée]`, pro-rated
   by that encaissement's share of the pre-arrival revenue. Hébergement = `finalPrice − toutes les
   options − toutes les ressources`. On Carpier every extra is in the complement, so the solde credits
   pure accommodation — 655,29 € HT + 65,53 € de TVA, and nothing else.
7. **The arrival complement** credits `[options complément, ressources complément]` plus the tourist tax
   on 46710000. No accommodation, ever. When the operator adjusted the complement, the fiche's stored
   ventilation keeps winning (`specs/adjustable-complement-amounts.md` §3.6) — unchanged.
8. **The complément de fin de séjour is ventilated by line**, from its stored detail: a line keyed
   `res:*` credits the resources account (70601000), everything else — SAS lines (ménage, linge
   manquant) included — credits the options account (70600010). Today the whole amount lands on the
   options account, so Carpier's bain nordique was booked as a prestation.
9. **Options and resources keep their own accounts** (decision 2026-08-24): 70600010 « prestations
   complémentaires » and 70601000 « activités diverses » stay separate, with corrected amounts. The
   « one line » Adrien asked for is one line **per nature**, carrying the real total.
10. **A complement with no identified line** (money collected at arrival beyond the tax, with nothing
    to attach it to) credits the options account rather than letting the residue land on the tourist-tax
    pass-through.

**Edge cases:**
- Pre-arrival revenue = 0 (everything in the complement) but an acompte was collected → the whole
  encaissement credits accommodation (defensive; cannot happen with a consistent fiche).
- Offered lines (0 €) never enter any bucket, so they cannot dilute a ventilation.
- A refund keeps its own path (`buildRefundEntry`, per-line, already correct).
- A stay cancelled after collection keeps its entries in their original month, unchanged.

---

## 4. Architecture

> **Fat backend.** Everything here is server-side accounting logic. No client change: the export
> screens and the CSV columns are identical, only the amounts they carry become right.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `accountingModel.js` | T | `buildEntry`: the ratio rule (rules 1-2) and the per-encaissement ventilation (rules 5-7, 10). `buildPerLineData`: classify every billed line into pre-arrival / complement / mid-stay, options and resources kept apart. `buildEndOfStayEntry`: ventilate by stored detail key (rule 8). |
| `utils/` | `midStayExtras.js` | — | (none) — `extraLineKey` / `resolveMidStaySplit` / `storedMidStayLines` are reused as they are. |
| `utils/` | `accountingExport.js` | — | (none) — the row layout, the accounts and the residue absorption are unchanged. |
| `constants/` | `accounting.js` | — | (none) — same chart of accounts (rule 9). |
| `database.js` | — | — | (none) — no schema change, no migration. |
| `tests/` | `accounting-books-the-money-collected.unit.test.js` | C | The five measured reservations as regressions: Carpier (ratio 1 + pure-accommodation solde + resource on 70601000), Foulon (cash complement stays out), Nicolet (drift → the bank amount), Parreton (legacy gross-up preserved), and a mid-stay-free control. |
| `tests/` | `accounting-encaissement-effective-percent.unit.test.js` | T | The existing effective-percent expectations that encode the old ratio, realigned on rule 1. |

### 4.2 Client side (`client/src/`)

No change. The « Comptabilité » pages render whatever the export returns; their payload shape is
untouched.

### 4.3 API contract

Unchanged — same endpoints, same CSV columns, same journal-row layout. Only the amounts change.

---

## 5. Data model

No schema change, no migration, no backfill. The fix is entirely in how stored data is read.

**Data impact:** none on the records. The **exports** of past months do change for the affected
reservations — which is the point: they were wrong. Adrien's accountant reprocesses the already-filed
months by hand (decision 2026-08-24, carried over from
`specs/platform-brut-excludes-offered-tourist-tax.md` rule 10).

## 6. UI / UX

No UI change. The Comptabilité screens and the CSV keep their exact layout; the figures they show
become the money that actually moved. No new string, no responsive impact, no action-bar change.

## 7. Test plan

### Server unit tests
- [x] `accounting-books-the-money-collected.unit.test.js` (9, new) — Carpier: ratio 1, client debit
      573,77 €, solde crediting accommodation only, bain nordique on 70601000, complement carrying the
      fiche's ventilation; Foulon: the 6,50 € cash complement never reaches the books; Nicolet: the
      drifted schedule books the 126,38 € actually banked; Parreton: the legacy gross-up still books
      994 € against a 903 € debit; a control direct stay pro-rating acompte/solde as before; and the
      destination split itself (offered lines ignored, mid-stay share leaving the complement).
- [x] `accounting-model-tourist-tax.unit.test.js` (2 realigned) — a complement collecting extras with no
      identified line now credits them as a **prestation at their own amount**, where it used to credit
      the same money as a pro-rata slice of the *accommodation* (rule 10). Same total, right poste.
- [x] Full server suite green: **3617 pass** (3608 before, +9).

### Coherence audit (the tool that found this)
- [x] Re-run over the whole base (7 months, 40 entries): 0 unbalanced entry, 0 negative line, 0 entry
      without credit, 0 collected-but-unexported — and **0 reservation whose client debit differs from
      the money actually collected** (7 before the fix, all real). The 5 rows still flagged as
      « commission ≠ fiche » are the legacy `clientGrossAmount` shape, where the commission is derived
      rather than entered: expected, not a defect.
- [x] Carpier replayed end to end on a throwaway copy: client debits 735,77 € = the money that moves
      (573,77 transfer + 132 arrival + 30 checkout), against 761,24 € before.

### Manual UI verification
- [ ] Comptabilité → the month of a mid-stay reservation: the journal shows the accommodation, the
      extras at their real amount, and the resource on its own account. _(not run — no reservation of
      the base has such a month collected yet; covered by the replay above, which drives the real model
      and the real export.)_

## 8. Out of scope

- The per-line **contribution** path (`hasContribs`): no reservation uses it; left exactly as is.
- Repairing the two drifted fiches (Nicolet #22226, Vanden wildenberg #22224). The books will now
  follow the money; *why* their schedule exceeds their total is a separate fiche-level investigation.
- Merging the options and resources accounts (explicitly declined 2026-08-24, rule 9).
- Any change to the refund, compensation or mid-stay-note entry shapes.

## 9. Open questions

1. ✅ **One line for options + resources, or one per nature?** (2026-08-24) → **one per nature**:
   70600010 for options and custom options, 70601000 for resources, each carrying its real total.
2. **Why do #22226 and #22224 carry a schedule above their stay total?** Tracked out of scope; the
   books no longer depend on the answer, but the fiches deserve a look.
