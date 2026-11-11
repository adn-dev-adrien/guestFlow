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
réservation #22275 (Jade Marchand, Abracadaroom). The structure is sound — every entry balances, no
negative line, no collected money missing from the export — but **the amounts on three quarters of the
entries are not the money that moved**.

Two independent defects, both in `accountingModel.buildEntry`.

### Defect 1 — a gross-up ratio fires on reservations it was never meant for

`specs/accounting-encaissement-effective-percent.md` introduced
`grossRatio = (finalPrice + touristTax) / (acompte + solde + complément)` to repair two **historical**
schedule shapes (the « solde = net » era and the `clientGrossAmount` era). Its own comment states the
ratio « is 1 for every reservation written by the current engine ». That is false in two situations:

- **A stay with a mid-stay / end-of-stay complement.** The bain nordique sold during Marchand's stay
  (30 €) is revenue inside `finalPrice`, but its amount is carved *out* of the three échéances. The
  denominator is therefore 30 € short and every entry of that reservation is inflated by 3,5 %.
- **A stay whose stored schedule drifted from the total** (a fiche edited after collection). Sigma
  #22226 has a schedule 28 € above its total, Bravo #22224 21 € above: their entries are
  *deflated* by 9 % and 12 %.

Measured consequence on Marchand, once the money is marked collected (simulated on a throwaway copy):

| | Reality | Books today |
|---|---|---|
| Virement Abracadaroom | 573,77 € | client debit **599,24 €** |
| Total collected | 735,77 € | client debits **761,24 €** |
| CA of the stay | 878,87 € | **908,29 €** |

The client's auxiliary account — the line the accountant reconciles against the bank — is off by
25,47 €. The entry still balances, which is why nothing ever flagged it.

Second-order effect: because the ratio pulls `finalPrice` into the numerator, **money settled in
« caisse interne » leaks back into the books**. Papa #22269's 6,50 € cash complement is excluded from
the export (correct) but re-injected into the solde entry by the ratio (wrong).

### Defect 2 — the revenue is ventilated per reservation, not per encaissement

In the stored-money path each entry credits *the whole reservation's* buckets scaled by
`fraction = revenue / finalPrice`. So the solde entry credits a share of option and resource revenue it
did not collect, and the complement entry credits a share of accommodation. On Marchand's solde — which
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
     amounts up, and it is what keeps réservation #7 (Gamma) booking 994 € of CA against a 903 €
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
   > **Reading of 2026-11-05 (audit R22-1, reservations slice).** A save has to keep the column for that to hold: no client
   > sends the retired field, and saving a platform stay wrote NULL (273 € of turnover gone from April and May 2026 on a
   > copy of the real data, with no refusal). `updateReservation` keeps what a non-direct stay stored unless the body
   > carries a number; absent, null and empty are « not carried ». What a direct stay stored is its own total, not a
   > gross: moved to a platform it is not kept. Test: `plugins/accounting-export/tests/platform-client-gross-kept`.

### The ventilation (defect 2)

5. **Each line is booked where it is collected.** Every billed (non-offered) option / custom option /
   resource belongs to exactly one destination:
   - `inComplement = 0` → **pre-arrival** (acompte + solde),
   - `inComplement = 1` → **arrival complement**, minus any share sold mid-stay,
   - the mid-stay share → **complément de fin de séjour**.
6. **Acompte and solde** credit `[hébergement, options pré-arrivée, ressources pré-arrivée]`, pro-rated
   by that encaissement's share of the pre-arrival revenue. Hébergement = `finalPrice − toutes les
   options − toutes les ressources`. On Marchand every extra is in the complement, so the solde credits
   pure accommodation — 655,29 € HT + 65,53 € de TVA, and nothing else.
7. **The arrival complement** credits `[options complément, ressources complément]` plus the tourist tax
   on 46710000. No accommodation, ever. When the operator adjusted the complement, the fiche's stored
   ventilation keeps winning (`specs/adjustable-complement-amounts.md` §3.6) — unchanged.
8. **The complément de fin de séjour is ventilated by line**, from its stored detail: a line keyed
   `res:*` credits the resources account (70601000), everything else — SAS lines (ménage, linge
   manquant) included — credits the options account (70600010). Today the whole amount lands on the
   options account, so Marchand's bain nordique was booked as a prestation.
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

### Paid, then reduced (2026-10-18)

> **Why this was added.** The review of 2026-10-18 (F2) found a stay paid, then saved with fewer
> guests and less breakfast, booking `46710000 C-88,80`. The contribs captured when the solde was
> ticked described the bigger stay; used as they were, they overflowed the entry, and the export put
> the gap on its last credit, the tourist tax. An online payment goes through the same recorder as the
> manual tick (`specs/plugins-phase-3a-online-payment.md` rule 1), so it reached the bug too. Before
> that recorder, an online payment captured nothing and was booked pro-rata, which gave the right
> journal.

11. **Captured contribs that no longer fit the entry are not used.** When the contribs of an entry plus
    its tourist tax exceed the entry's amount by more than the 2-cent rounding residue, the entry is
    booked like one that never captured anything: pro-rata of the lines as they stand now (rules 5-7).
    No credit line is ever negative, and the 46710000 line is the stay's own tax. Contribs that still
    fit keep driving the entry as before. The money received beyond the new total is a trop-perçu, which
    the fiche reports (`specs/reservation-refunds.md` rule 34).

### A gross-up entry that captured contribs (2026-10-19)

> **Why this was added.** The review of 2026-10-19 ticked the solde of réservation #13 (Gîtes de
> France, `clientGrossAmount` era: 706 € solde net, 907,20 € paid by the guest, no entered commission)
> on a copy of the Solio base. The tick captured contribs from the stored solde — 706 € of
> accommodation — and the contrib path used them as they were, while the entry's CA is grossed up to
> 907,20 € (rule 4, `specs/accounting-encaissement-effective-percent.md` rule 1). The 201,20 € of
> commission the contribs leave out fell on the last credit, the VAT line:
> `CDAUSQU D706 | 622600 D201,20 | 70600000 C641,82 | 44571100 C265,38` — 41 % of VAT. Rule 10 of the
> effective-percent spec assumed every contrib row was a current-model row (ratio 1); a legacy row
> ticked today is not. The same row without contribs books `70600000 C824,73 | 44571100 C82,47`, which
> is what its five paid siblings (#1-#4, #8) already book.

12. **Contribs are used only on an entry that is not grossed up.** When the gross-up ratio of an entry
    is not 1 (the `clientGrossAmount` era, or a « solde = net » schedule the boot repair left alone),
    its contribs describe the stored net amount, not the CA the entry books. The entry is then booked
    like one that never captured anything: the stored-money path, which pro-rates the gross-up over the
    postes it collects (rules 5-7), so the VAT line is the sales rate applied to the revenue. Entries
    with a ratio of 1 — every reservation written by the current engine — keep their contribs as before.
    On the Solio base this changes réservation #13 only, and only once its solde is ticked: no month
    already collected changes (the 36 months 2025-2027 export byte-identical before and after).
    (Numbered 12 to keep the identity it has on `inte/plugins`, where rule 11 — contribs that overflow
    a reduced entry — also lives; master has no rule 11.)
    **Reading of 2026-11-11 (shadow trial of 4.0.0):** whichever path books an entry of a platform stay — adjusted
    complement, paid split, contribs, or this stored-money fallback — it carries `clientGrossAmount = round2(effectiveGross)`,
    the gross the guest paid (« Brut » of Comptabilité › Plateformes). The fallback returned the stored column, NULL on a fiche
    that never held one, and the cell went blank (#13 of Oct-2026 = 907,20; #22298 of Sep-2026 = 259,13 under 3.21.0). An own-channel
    stay (`direct`, or a platform counted as a direct sale — read through `isDirectChannel`, never by name) that never
    held a stored gross keeps none to show (`platformsPreview` renders « — »), and the on-site entries (end-of-stay, mid-stay note, refund, compensation) carry no
    gross by design: nothing the platform collected. accounting-export 1.2.3. Test:
    `accounting-platform-gross-fallback.unit.test.js`.
    **Reading of 2026-11-11, second shadow trial (Adrien's decision):** « Brut » shows the PLATFORM's gross — what the platform
    billed the guest — as recorded on the fiche: `platformGrossAmount`, else the older `clientGrossAmount`. The recorded figure
    is shown first, for any channel, an own channel (`direct`, or a platform counted as a direct sale) included. It is blank
    only when nothing is recorded AND the channel is in direct mode (read through `isDirectChannel`, never the name). A
    channel that is not in direct mode with nothing recorded falls back to the stay price WITHOUT the complements paid on
    site (`finalPrice − complementAmount`, the tourist tax a complement carries, `touristTaxInComplement = 1`, not being part
    of that price: 22211 = 171,14). Every path of `buildEntry` returns it through `platformBrut(row)`: the books keep reading
    `effectiveGross`, so no debit or credit moves (on a scrubbed 3.21.0 copy, 2025-01 to 2027-12, the sales CSV keeps every
    debit and credit; only its « Prix payé client » column changes, on 41 lines). « Commission » of the CSV and of the journal
    card is the entry's own commission line and nothing else: the former fallback `gross − price` is removed, it invented a
    commission from the platform gross (the complement entry of stay 9: 0 became 16,19). **Resolved 2026-11-11 (Adrien): deferred to the pricing refonte (4.1.0).** 4.0.0 keeps choosing whether to show the platform
    columns (« Plateforme », « Prix payé client », « Commission ») of the CSV and the journal card by the internal `direct`
    channel key (`entry.platform !== 'direct'`). On the production data this is correct: Lodgify counts as a direct sale and still
    shows its real commission. Reading the platform mode (`isDirectChannel`) instead would hide those columns on Lodgify (its
    rows carry a real commission, and the byte-for-byte golden `vat-regime-golden` shows them). The refonte's accounting output
    (the `csvJournal` adapter, specs/pricing-components.md) replaces this rule: the columns are shown as soon as an entry
    carries a commission or a recorded platform gross, whatever the channel. On the copy the only other change of the sales
    CSV in 4.0.0 is « Commission » reading empty instead of 0 on 8 lines that had no commission line (the golden's `lodgify` row
    follows). Where 3.21.0 showed a stored figure it comes back (5 = 748, 6 = 793,65, 22209 = 315,
    11 = 1 983,92, 22275 = 720,82, which the previous reading showed as 865,82 with its on-site complements); where 3.21.0
    showed the computed price, the recorded gross replaces it (#13 943,20 instead of 907,20).
    accounting-export 1.2.4. Test: `accounting-platform-gross-fallback.unit.test.js`.

### Money already collected never moves (2026-10-27)

> **Why this was added.** The spec review of 2026-10-27 paid a 515 € stay (acompte 150, solde 365 with
> 15 € of tourist tax), then added a guest: the tax rose to 22,50 € and the engine billed the 7,50 €
> difference as an arrival complement. The October solde entry already exported was rewritten
> (`70600000 C318,18 → C311,37`, `46710000 C15 → C22,50`) and the 7,50 € complement, ticked paid,
> appeared in no month at all (Finance « Encaissé » 522,50 against a journal of 515). Separately, an
> installment of a past month moved on every later save of the fiche: its tourist-tax share and its
> revenue pro rata were recomputed from the stay as it stood. `accountant-accounting-export.md` rule 33
> says a month already exported keeps its cents.

13. **The tourist tax of a paid solde is the tax it collected.** Once the solde is paid, its entry books
    the tourist tax frozen at that moment (`touristTaxSoldeContribTtc`, plus the share an older acompte
    captured and reclassed); a tax that rises afterwards never rewrites it. The rise is collected by the
    arrival complement, and its entry books it on 46710000 (an entry carrying only tax, listed among the
    month's « écritures de taxe seule »). A solde paid before contribs existed keeps the live total.
14. **An installment books the split frozen when it was collected.** Recording an installment as paid
    stores its accounting split on the installment (`reservation_installments.paidSplit`: tourist-tax
    share, accommodation, options, resources, in cents, adding up to its amount —
    `utils/installmentPaidSplit.js`, `specs/direct-installments.md` rule 47). The export books that split
    verbatim; a later save of the fiche moves no installment entry. An installment collected before the
    column existed (none in production) keeps the live split.

### Contribs that under-describe the entry (2026-10-28)

> **Why this was added.** The money audit of 2026-10-28 replayed the journal over the Solio base. Rule 11
> only refused contribs that EXCEED the entry; contribs that fall SHORT of it passed, and the gap was
> absorbed on the last credit, the VAT line. Réservation #13 (October 2026: solde saved at 907,20 € after
> a 706 € contrib was captured, no gross-up any more) booked `44571100 C265,38` on `70600000 C641,82`
> (+182,91 € of VAT); #22298 (September 2026: a custom option added after the capture, so with no
> contrib) booked C37,13 on C177,00 (+17,66 €). Rule 12's test modelled #13 with a ratio ≠ 1 and missed
> the shape the row has today.

15. **Contribs drive an entry only when they add up to it, in both directions.** Σ contribs (accommodation
    + options + resources) + the entry's tourist tax must equal the entry's encaissement within the
    2-cent rounding residue; whichever side the gap is on, the entry is booked on the stored-money path
    (rules 5-7). The rounding residue that remains on the last credit is therefore never more than a few
    cents, so the VAT line is always the sales rate applied to the revenue. *Effect on the Solio base:*
    #13 (October 2026) now books `70600000 C824,73 | 44571100 C82,47` and #22298 (September 2026)
    `C194,66 | C19,47`; the totals per entry do not move, only the revenue / VAT split. The app keeps no
    record of which months were exported, and rule 33 of `accountant-accounting-export.md` freezes the
    *cents* of a split, not a ventilation fix: a month the accountant already imported needs a
    correcting entry on their side (VAT −182,91 € / +182,91 € revenue for October, −17,66 € for September).

### What a booked entry keeps (2026-11-05)

16. **A collected arrival complement keeps the entry it was booked on (audit R22-6a).** Its entry was derived live, so any
    later save rewrote it: tax rising after the flip took the revenue (24,80 €: tax 4,80 → 7,20, revenue 18,18 → 16 HT), a
    party change overflowed the contribs and sent it from 70600000 to 70600010. The split is computed once, at the flip,
    with these same rules as they read then, and stored in `reservations.complementPaidSplit` (JSON, cents: tax,
    accommodation, options, resources, plus `lines` when each line's share is known): `utils/complementPaidSplit.js`, called
    on every path that collects it (fiche mark, arrival single payment, arrival and departure SAS, a withdrawn link). The
    export reads it first, on a ratio-1 non-adjusted entry, as long as it adds up to the entry; a trigger clears it with an
    un-tick. Money with no line to attach it to is what the accommodation gained when it did (a solde paid before its
    acompte), else a prestation (rule 10). Growth after the flip is claimed at the end of stay (mid-stay-extras rule 20). NULL on a complement collected
    before the column or adjusted by the operator: those read as they did. Test:
    `plugins/accounting-export/tests/booked-complement-entry-frozen`; every other flip path (arrival settle, arrival SAS,
    departure SAS, the model's save): `complement-split-stamped-on-every-flip`.
17. **Removing a paid line does not rewrite a booked entry (D11, Adrien; audit R22-6b).** The contribs a removed line held
    stay on the stay, per bucket, in `reservations.removedLineContribs` (JSON: key, label, bucket, acompte and solde contrib);
    a priced save records what the lines lost, net of what another line of the same bucket gained (a rename is no removal),
    and an un-tick drops its bucket. Every reader reads them as a line billed 0 €: `buildPerLineData` (so the export's
    entries and `soldeCaptureMatches`), `capturedScheduleContribs`, `capturedScheduleContribsByPoste`,
    `depositContribBuckets`, `soldeContribBuckets`, `collectedByLine`. A paid line of 142 € removed: the solde keeps
    70600010 129,09 € and 70600000 545,45 €, byte-identical, where it moved to 0 and 674,55 €. Test:
    `plugins/accounting-export/tests/removed-line-contribs`.

---

## 4. Architecture

> **Fat backend.** Everything here is server-side accounting logic. No client change: the export
> screens and the CSV columns are identical, only the amounts they carry become right.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `accountingModel.js` | T | `buildEntry`: the ratio rule (rules 1-2) and the per-encaissement ventilation (rules 5-7, 10). `buildEndOfStayEntry`: ventilate by stored detail key (rule 8). |
| `utils/` | `storedMoneySplit.js` | C | `buildPerLineData`: classify every billed line into pre-arrival / complement / mid-stay, options and resources kept apart; `splitByDestination`, `storedMoneyCollected`, `storedMoneyBucketTtcs`. Moved out of the plugin's `accountingModel.js` on 2026-11-02 (specs/payment-schedule-and-cancellation.md rule 55): the cancellation reads the same split; the plugin reads it through `coreModule('storedMoneySplit')` (specs/plugins-phase-1-sdk.md rule 36). |
| `utils/` | `midStayExtras.js` | — | (none) — `extraLineKey` / `resolveMidStaySplit` / `storedMidStayLines` are reused as they are. |
| `utils/` | `accountingExport.js` | — | (none) — the row layout, the accounts and the residue absorption are unchanged. |
| `constants/` | `accounting.js` | — | (none) — same chart of accounts (rule 9). |
| `database.js` | — | — | (none) — no schema change, no migration. |
| `tests/` | `accounting-books-the-money-collected.unit.test.js` | C | The five measured reservations as regressions: Marchand (ratio 1 + pure-accommodation solde + resource on 70601000), Papa (cash complement stays out), Sigma (drift → the bank amount), Gamma (legacy gross-up preserved), and a mid-stay-free control. |
| `tests/` | `accounting-gross-up-ignores-contribs.unit.test.js` | C | Rule 12: #13's shape with and without contribs books the same entry at 10 % VAT; a ratio-1 entry keeps its contribs; end to end through the payment controller. |
| `plugins/accounting-export/` | `accountingModel.js` | T | Rule 13: `computeTaxTtcForKind` books the solde's frozen tax and the later rise on the complement. Rule 14: `buildInstallmentEntry` books the stored `paidSplit`. |
| `utils/` | `installmentPaidSplit.js` (C), `installmentPayment.js` | C/T | Rule 14: the split computed and stored when an installment is collected. |
| `tests/` | `plugins/accounting-export/tests/accounting-collected-money-frozen.unit.test.js` | C | Rules 13-14. |
| `tests/` | `accounting-encaissement-effective-percent.unit.test.js` | T | The existing effective-percent expectations that encode the old ratio, realigned on rule 1. |

### 4.2 Client side (`client/src/`)

No change. The « Comptabilité » pages render whatever the export returns; their payload shape is
untouched.

### 4.3 API contract

Unchanged — same endpoints, same CSV columns, same journal-row layout. Only the amounts change.

---

## 5. Data model

No schema change, no migration, no backfill for rules 1-13: the fix is entirely in how stored data is
read. Rule 14 adds `reservation_installments.paidSplit` (see `specs/direct-installments.md` §5).
Rules 16-17 add `reservations.complementPaidSplit TEXT NULL` and `reservations.removedLineContribs TEXT NULL`, plus the
trigger `reservations_clear_complement_paid_split` (`schema.sql`, `database.js` right after the baseline pass). Additive, no
backfill: NULL reads as before them. A rollback below them ignores both columns and reads the entries live again
(specs/self-update-and-releases.md rule 39, reading of 2026-11-05).

**Data impact:** none on the records. The **exports** of past months do change for the affected
reservations — which is the point: they were wrong. Adrien's accountant reprocesses the already-filed
months by hand (decision 2026-08-24, carried over from
`specs/platform-brut-excludes-offered-tourist-tax.md` rule 10).

## 6. UI / UX

No UI change. The Comptabilité screens and the CSV keep their exact layout; the figures they show
become the money that actually moved. No new string, no responsive impact, no action-bar change.

## 7. Test plan

### Server unit tests
- [x] `accounting-books-the-money-collected.unit.test.js` (9, new) — Marchand: ratio 1, client debit
      573,77 €, solde crediting accommodation only, bain nordique on 70601000, complement carrying the
      fiche's ventilation; Papa: the 6,50 € cash complement never reaches the books; Sigma: the
      drifted schedule books the 126,38 € actually banked; Gamma: the legacy gross-up still books
      994 € against a 903 € debit; a control direct stay pro-rating acompte/solde as before; and the
      destination split itself (offered lines ignored, mid-stay share leaving the complement).
- [x] `accounting-model-tourist-tax.unit.test.js` (2 realigned) — a complement collecting extras with no
      identified line now credits them as a **prestation at their own amount**, where it used to credit
      the same money as a pro-rata slice of the *accommodation* (rule 10). Same total, right poste.
- [x] Full server suite green: **3617 pass** (3608 before, +9).
- [x] `accounting-gross-up-ignores-contribs.unit.test.js` (4, new, rule 12) — #13's shape books
      `70600000 C824,73 | 44571100 C82,47` with its contribs, exactly as without them; a ratio-1 entry
      still books its contribs; the solde ticked through the payment controller lands at 10 % VAT.
- [x] `plugins/accounting-export/tests/accounting-contribs-must-describe-entry.unit.test.js` (4, new,
      rule 15) — #13 with its current shape (solde 907,20, contrib 706), #22298's custom option without
      a contrib, contribs that add up still driving the entry, a one-cent gap tolerated.

- [x] `plugins/accounting-export/tests/accounting-collected-money-frozen.unit.test.js` (5, new, rules
      13-14) — the October solde unchanged by a tax rise, the 7,50 € complement on 46710000 in its month
      (the stay books 522,50 € in all), a solde without contribs still on the live tax, an installment
      unchanged by a later save, the stored split.

- [x] Round 22 (2026-11-05), all under `plugins/accounting-export/tests/`: `booked-complement-entry-frozen` (12, rule 16),
      `acompte-after-collected-complement` (6, reservation-payment-ledger rule 46 reading),
      `removed-line-contribs` (11, rule 17), `added-guests-supplement-account` (9), `platform-client-gross-kept` (3, rule 4
      reading); `tests/complement-split-removed-contribs-schema` (3, the columns, the trigger, the upgrade),
      `tests/complement-split-stamped-on-every-flip` (5, rule 16).

### Coherence audit (the tool that found this)
- [x] Re-run over the whole base (7 months, 40 entries): 0 unbalanced entry, 0 negative line, 0 entry
      without credit, 0 collected-but-unexported — and **0 reservation whose client debit differs from
      the money actually collected** (7 before the fix, all real). The 5 rows still flagged as
      « commission ≠ fiche » are the legacy `clientGrossAmount` shape, where the commission is derived
      rather than entered: expected, not a defect.
- [x] Marchand replayed end to end on a throwaway copy: client debits 735,77 € = the money that moves
      (573,77 transfer + 132 arrival + 30 checkout), against 761,24 € before.

### Manual UI verification
- [ ] Comptabilité → the month of a mid-stay reservation: the journal shows the accommodation, the
      extras at their real amount, and the resource on its own account. _(not run — no reservation of
      the base has such a month collected yet; covered by the replay above, which drives the real model
      and the real export.)_

## 8. Out of scope

- The per-line **contribution** path (`hasContribs`): no reservation used it in August; left as is,
  except that it no longer applies to a grossed-up entry (rule 12, 2026-10-19).
- Repairing the two drifted fiches (Sigma #22226, Bravo #22224). The books will now
  follow the money; *why* their schedule exceeds their total is a separate fiche-level investigation.
- Merging the options and resources accounts (explicitly declined 2026-08-24, rule 9).
- Any change to the refund, compensation or mid-stay-note entry shapes.

## 9. Open questions

1. ✅ **One line for options + resources, or one per nature?** (2026-08-24) → **one per nature**:
   70600010 for options and custom options, 70601000 for resources, each carrying its real total.
2. ✅ **Why do #22226 and #22224 carry a schedule above their stay total?** (resolved 2026-10-28) → a
   collected arrival complement is frozen at what was collected (the books follow the money), and a later
   edit moved a line out of it (the bed linen, 21 € and 28 €) or lowered its tax (#22209, +0,60 €). The
   excess is a trop-perçu on a direct channel (platform stays: nothing changes, Adrien 2026-10-29), reported by the engine like the one on the acompte and the solde
   (`reservation-save-keeps-pricing.md` rule 4); the alternative — lowering the collected complement —
   would move an exported entry and write down money the guest paid. #22275 (+3,95 €) is an operator
   adjustment of the complement and stays his decision.
