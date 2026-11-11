# REFUNDS component — map of today's refund logic, contract, DB critique (research, read-only)

- Base: worktree `gf-docs-pricing-spec`, branch `docs/pricing-components-spec` = `inte/plugins` `e27229aa` + spec commit `fa6f5dc8`.
  Line numbers are on this tree; the J-7 branch (`feature/guest-app-from-j7`) is cited only where it adds a copy (`flagBasketRefund`).
- Read: `specs/pricing-components.md` (rules 1-71, §5, §10), `specs/reservation-refunds.md` (rules 1-53), `mixed-method-payments.md`
  (rules 42-58), `payment-schedule-and-cancellation.md` (rules 27-34, 55, 60-63), `direct-installments.md` rule 46,
  `payment-link-lifecycle.md` rules 56/63, `vat-optional-mode.md` rule 16, INVARIANTS.md (D1-D28 + the refund lines of rounds 15-45).
- Prod measure: a private copy of `shadows/prod-2026-11-11/gf-snap.db` opened `sqlite3 -readonly`. Counts/ids only.
- **Caveat on the snapshot:** prod still runs a 3.x schema. These are **absent**: `payment_settlements`, `payment_tenders`,
  `reservation_installments`, `reservation_refunds.afterCancellation`, `reservations.complementPaidSplit` / `removedLineContribs` /
  `platformPenaltyAmount`, every `payment_links` column after `lastPolledAt` (`cancelReason`, `withdrawnAt`, `basketJson`…), and
  `guest_orders` (guest-app not installed). The plugins enabled in prod are only the 3 intakes. So every refund rule written in
  the 2026-11 audit loop (rules 45-53, D10-D28) has **never run on a real row yet**. The 4.0.0 migrations will add those columns NULL or empty.

---

## 0. Key numbers

| Measure | Value |
|---|---|
| Server files that compute a refund or refund-related figure (tests excluded) | **38**: 20 core utils/models/controllers, 4 accounting-export, 3 online-payment/reconciliation, 3 guest-app/SAS/SDK, 8 readers |
| Distinct copies of « money given back on this stay » with their **own method filter** | **9**: `refundsModel.totalsByReservation`, `totalsByReservationIds`, `freeLinesTotal`, `financeModel.REFUND_COLS` (2 columns), `REFUNDED_TAX_COLS`, `withTouristTaxInTotal.refunded`, `financeDashboardModel.paymentsLedger`, `vatRegimeSwitchModel` (dates), `refunds.refundsTotal` (dead) |
| Places that compute a **trop-perçu / excess / money owed back** | **11** (§1.E) |
| Copies of the « take-back leaves refunds above collected » guard | **2** (`refundUntickGuard.untickRefusal`, `paymentSettlementService.refundRefusal`) + 3 callers that wrap it |
| Dead pure exports (prod uses an SQL copy instead) | `refunds.splitHtVat` (a 6th VAT copy, missing from spec rule 65), `refunds.refundedTouristTax`, `refunds.refundsTotal` |
| Refund test files | 66 core + 6 accounting-export |
| Prod `reservation_refunds` | **1** (id 1, stay 22271 Lodgify, `transfer`, 28,22 €, 2026-08-10) |
| Prod `reservation_refund_lines` | **2**: `opt:6` options 24,00 € qty 3 × 8,00 @10 %; `touristTax` 4,22 € qty 1 night @0 % |
| Prod `retained` / `internal` / `cash` refunds, free lines, `indemnity` lines, `commission` lines | **0 / 0 / 0 / 0 / 0 / 0** |
| Prod cancelled stays (`kind='cancelled'`) | **0** of 71 rows (62 reservations, 9 devis) |
| Prod `cancellation_compensations` | **1** (Greengo, `received`, origin `platform`, 53,10 €). Its `reservationId` points at a **deleted** stay (no FK) |
| Prod `reservation_history` `refundOwed` / `keptFromGuest` entries | **0 / 0** |
| Prod `reservation_history` entries carrying `optionsSignature` (parsed by the trop-perçu poste split) | **209** of 542 |
| Prod paid soldes **without** captured contribs (`accommodationSoldeContribTtc IS NULL`) | **41 of 51** (80 %) |
| Prod paid acomptes without contribs | **5 of 7** |
| Prod option lines of paid stays with neither `acompteContribTtc` nor `soldeContribTtc` | **114 of 131** (87 %) |
| Prod `payment_links` | 16 (balance 3, full 13; 6 paid, 2 cancelled). No basket, no `refunded` reason (column absent) |

**Reading.** The refund logic is large: about 2 400 LOC of pure code plus about 1 500 LOC of orchestration and SQL. It is heavily
guarded by tests, but almost unused in prod. More than 80 % of paid stays have no captured contribs, so they go through the **legacy
fallbacks**: stored-money split, `booked` buckets, the history parsing in `droppedSince`. The new component has to carry those
fallbacks verbatim in PR A.

---

## 1. Every place that computes a refund or refund-related figure

Legend: **P** = pure (no DB, no clock). **DB** = reads the database (or `require`s a model that does). **W** = writes.
« Dup » names the copy it duplicates.

### 1.A Refund register — the core pure unit (`server/src/utils/refunds.js`, 1 048 LOC)

| Function (line) | Computes | Inputs | Dup / notes | P/DB |
|---|---|---|---|---|
| `refundedByKey` (89) | `{lineKey → TTC refunded}` with refund/line filters | refunds[] | Same Σ over `lineKey` as the SQL `REFUNDED_TAX_COLS`, and as `givenBackByBucket` (per bucket) | P |
| `isOffBooks` / `isRetainedDeposit` / `isRequalification` / `isIndemnityLine` / `isCommissionLine` (60-107) | classification of a refund or line | method, bucket, lineKey | `isRetainedDeposit` ≡ `isRequalification` (two names for `method==='retained'`) | P |
| `nettedByCancellation` (117), `madeAfterCancellation` (130), `writtenBeforeAvoir` (192) | order of a refund relative to the cancellation (id order, `afterCancellation`, `createdAt` vs `cancelledAt`) | refunds, cancelledAt | three readings of one fact; see DB critique §3.2 | P |
| `cancellationHadBookMoney` (145) | whether the cancel had book money to keep | row flags, `installmentsPaidAmount`, commission | re-derives what `buildCancellationRequalification` decides (`grossDepositTtc + grossInstallmentsTtc + soldeWithheldTtc > 0`) | P |
| `caisseKeptMoves` (168) → `cashDepositKeptOf` | whether deleting a caisse refund changes the kept sum | row, refunds | lazy `require('./cancelReservation')` (circular) | P |
| `refundDeletionRefusal` (175) | DELETE refusal codes `REFUND_RETAINED_AVOIR` / `NETTED` / `BEFORE` / `keptSum` | refund, refunds, row, nettedIds | shared by DELETE route and ledger (good) | P |
| `cancelledRefundBudget` (219) | cancelled stay: `collectedTtc`, `indemnityLeftTtc`, `saleLeftTtc`, `cashCollectedTtc`, `cashLeftTtc` | `comptaCollected`, `cashCollected`, refunds | `indemnityLeftTtc` is also derived by `refundsModel.indemnityGivenBack` (SQL) and `cancellationCompensationsController` | P |
| `refundsTotal` (242) | Σ refunds book / withCash | refunds | **dead in prod**. Prod uses `refundsModel.totalsByReservation`, whose filter differs: it skips `retained`, `refundsTotal` does not | P |
| `buildRefundableLines` (278-434) | per line: `billedTtc`, `ceilingTtc`, `refundedTtc`, `requalifiedTtc`, `withheldTtc`, `refundableTtc`, `indemnityTtc`, `cashTtc` (cancelled), `availableTtc` / `sharedBucketTtc` (live) | finalPrice, touristTaxTotal, vatRate, lines, refunds, nights, cancelled budget, collected / cashCollected readings, planBuckets, goneLines | accommodation = `finalPrice − Σ extras`, the same derivation as `accountingModel.buildPerLineData` and `overpayment.currentByPoste`. **One VAT rate for every non-tax line** (`vatRate: rate`), which conflicts with spec rules 61-62. Tax per night `round2(tax/nights)`: a unit-price rounding (§3.5) | P |
| `applyLiveCollected` (442) | D15 `availableTtc` per line, plan `sharedBucketTtc` | perLine, collected, refunds, planBuckets, row | — | P |
| `capInOrder` (465), `spreadBucketRefund` (718) | largest-remainder / ordered capping in cents | rooms, budget | **4th largest-remainder copy** (beside `cancelReservation.saleBooksOf`, `cancellationRequalification.spreadCents`, `refunds.settleSplitCents`). Spec rule 65 names only `cancelReservation` l.155-162 → `money.allocateCents` | P |
| `collectedByLine` (486-611) | what each line **collected** (book or caisse), from contribs, `complementPaidSplit`, `removedLineContribs`, EOS detail, notes, split shares, plan buckets | row, lines, `booked`, `cash`, `taxOnArrival`, `splitShares` | Re-derives collection per line. The same job is done by `complementPaidSplit.contribSplit`, `installmentPaidSplit`, `accountingModel.computeBucketTtcsFromContribs`/`grossRatio` (spec rule 65 « accounting/collection recomputations »). Replaced by SETTLEMENT `settledCents` in PR B (spec rule 21) | P |
| `takeGesteOff` (619) | geste commercial off accommodation → extras pro rata → tax | out, splitShares | **dup** `cancelReservation.saleBooksOf` (135-165), same algorithm in cents | P |
| `settleSplitCents` (641) | largest-remainder rounding of exact shares | out | dup `saleBooksOf` tail (156-162) | P |
| `collectedAfterArrival` (661) | per key, EOS lines and settled notes on the books | row (JSON `endOfStayComplementDetail`, `midStaySettledNotes`) | parses two JSON blobs; `midStayExtras.settledByKey` | P |
| `addLinesOnlyTheSplitNames` (681), `collectedLinesGone` (693) | lines that collected and left the fiche (D11) | row JSON `removedLineContribs`, `complementPaidSplit` | — | P |
| `refundedTouristTax` (752) | tax refunded `{amount, nights}`, every means | refunds | **dead in prod**. The SQL copy `financeModel.REFUNDED_TAX_COLS` (297) is used. Neither filters `retained` (a cancelled plan's avoir carries a `touristTax` line, `cancellationRequalification.installmentLines` l.91) | P |
| `splitHtVat` (766) | TTC → HT/VAT | ttc, rate | **dead** VAT copy, not in spec rule 65's list | P |
| `lastBookPaymentDateOf` (781) | rule 53 last book payment date | row, installments, settlements | parses `midStaySettledNotes` | P |
| `validateRefundPayload` (812-955) | the write judge: date window, means, rule 53, per-key cap (`REFUND_EXCEEDS_LINE`), cancelled cap (`REFUND_EXCEEDS_COLLECTED`), live caps D10/D15, stay cap (`REFUND_EXCEEDS_STAY`), quantity = amount/unitPrice (4 dp), free-line VAT | payload, context (`today` injected) | — | P |
| `splitOnIndemnity` (967) | cancelled stay: each line taken caisse → sale → indemnity, in cents; codes `REFUND_INDEMNITY_OFF_BOOKS`, `REFUND_CASH_ONLY_IN_CASH` | lines, rooms, budget | the D3 / D8 kernel | P |

### 1.B Register orchestration and persistence

| Place (line) | Computes | Inputs | Dup / notes | P/DB |
|---|---|---|---|---|
| `controllers/refundsController.js` `nightsBetween` (33) | nights for the per-night tax unit | dates | **dup** `financeModel.nightsBetween` (132), `notificationService.nightsBetween` (55). Date math belongs to NIGHTS / STAY CLOCK | P |
| `refundsController.buildRegister` (54-125) | the whole read side: VAT rate (`vatRegimeModel.rateForRow`), `comptaCollected`, cancelled budget, `bookedStayBuckets`, `taxRidesTheComplement`, `bucketSharesOf`, two `collectedByLine` readings, refundable lines, `cashLeftTtc = min(cashLeft, Σ cashTtc)` | DB everywhere | the **loader** of the future component; also embedded in the fiche payload (`reservationsController` l.1150) | DB |
| `refundsController.create` (132-176) | validation + the **trop-perçu cap** `REFUND_EXCEEDS_OVERPAYMENT` (cents compare, Σ free lines vs `storedOverpayment`) | body, `storedOverpaymentTtc` (lazy require of reservationsController) | trop-perçu cap lives in a controller, not in the pure judge | DB, W |
| `refundsController.remove` (178-199) | deletion refusal via `cancellationNettedRefundIds` | DB | — | DB, W |
| **No history entry** on refund create/delete | — | — | refunds are the only money write that journals nothing in `reservation_history` (cancellation does) | — |
| `models/refundsModel.js` `totalsByReservation` (113) | `{book, withCash}`, skips `retained` | SQL | **dup** of `refundsTotal` (different filter), `REFUND_COLS`, `totalsByReservationIds` | DB |
| `refundsModel.freeLinesTotal` (129) | Σ free lines (`lineKey IS NULL`, not `retained`, **every means incl. caisse**) | SQL | the only refunds that lower the stored trop-perçu (rule 44). It counts **every** free line, including a commercial gesture from « + Nouveau remboursement », although rule 42 says such a gesture is not trop-perçu (see §3.2 D-1) | DB |
| `refundsModel.totalsByReservationIds` (141) | batched `{book, withCash}` | SQL | dup of the above | DB |
| `refundsModel.indemnityGivenBefore` (160), `indemnityGivenBack` (169) | Σ `indemnity` lines (book) before / all | SQL | indemnity left is also computed by `cancelledRefundBudget` | DB |
| `refundsModel.listByMonth` (181) | export source: non-`internal`, kinds reservation+cancelled, joined with client names | SQL | — | DB |
| `refundsModel.create` (95) / `insertRefund` (51) | writes header + lines; `afterCancellation` from `kind` in the INSERT | normalised refund | `totalTtc` = round2(caller's Σ). For the `retained` avoir the caller passes `requalifiedTtc`, not Σ lines (`cancelReservation` l.348) | W |

### 1.C « What was collected » — the caps' inputs

| Place (line) | Computes | Dup / notes | P/DB |
|---|---|---|---|
| `utils/reservationSettlement.js` `comptaCollected` (198) | book money received, net of commissions, **− book refunds** (`refundsBookTtc`), + arrival adjustment, − split deduction | the authority behind D10, rule 52 guards, finance « Encaissé » | P |
| `reservationSettlement.cashCollected` (231) | caisse-interne money received | D8 budget; read by `cashDepositKeptOf` | P |
| `reservationSettlement.refundsBook` (165) | reads `r.refundsBookTtc` (injected by caller or SQL) | a row field filled by 4 different readers | P |
| `utils/paymentTenders.js` `targetFigures` (152) | split target: `overpaidCents` (fall beyond reste + geste), `receivedFactor` | a trop-perçu on split payments, in integer cents | P |
| `paymentTenders.bucketSharesOf` (225) | `{bucket → books, internal, waivedBooks, waivedInternal}` | read by `collectedByLine`, `saleBooksOf`, refundsController | P |
| `utils/splitReceived.js` `readSplitReceived` (61), `unreceivedOf` (104) | D25 pool per target; what a cut may take before a trop-perçu | read **inside the pricing engine** (`pricing.js` l.2808), a DB read inside the engine | DB / P |
| `utils/complementPaidSplit.js` `computeComplementPaidSplit` (110) / `stampComplementPaidSplit` (156) / `readComplementPaidSplit` (168) | the frozen split of a collected complement (JSON) | `contribSplit` (56) listed in spec rule 65 as a collection recomputation | DB, W |
| `utils/removedLineContribs.js` `recordRemovedLineContribs` (65) / `clearRemovedLineContribs` (103) | D11: contribs of paid lines since removed (JSON) | — | DB, W |
| `utils/cancelReservation.js` `bookedStayBuckets` (179) | per bucket, what acompte / solde / installments were booked on | uses `storedMoneySplit`, `installmentPaidSplit`, `taxShares` | DB |
| `models/reservationsModel.js` `capturedScheduleContribs` (1311), `capturedScheduleContribsByPoste` (1344), `depositContribBuckets` (2232), `soldeContribBuckets` (2254) | Σ contribs per bucket / poste | SQL sums of the contrib columns | DB |

### 1.D Cancellation — requalification, kept sum, notice figure

| Place (line) | Computes | Dup / notes | P/DB |
|---|---|---|---|
| `cancelReservation.installmentsRetainedOf` (55) | paid installments: amount, tax share, per-installment buckets | `taxShares` (`installmentPlan`), `computeInstallmentPaidSplit` | DB |
| `givenBackByBucket` (92) | per bucket, book refunds before the cancel | dup of `refundedByKey` (by bucket) | P |
| `depositBucketsOf` (109), `saleCollectedOf` (118), `saleBooksOf` (135) | acompte buckets; paid-solde buckets (contribs or stored-money split, tax first); book share less geste | `saleBooksOf` **dup** `refunds.takeGesteOff` + `settleSplitCents` | DB |
| `withheldCommissionsOf` (167) | commissions withheld on paid acompte / solde | spec rule 70 → PLATFORM PAYMENT `withheldOnCancellation` | DB |
| `requalificationOf` (196) → `cancellationRequalification.buildCancellationRequalification` (275) | the `retained` avoir lines + compensation row (D3, rule 55) | — | DB → P |
| `cancellationRequalification.requalificationLines` (39), `installmentLines` (81), `absorb` (99), `soldeLine` (113), `netOfEarlierRefunds` (133), `spreadCents` (170), `withCommissions` (196), `soldeHeldOf` (242) | avoir lines, netting of earlier refunds (solde absorbs first), commission lines, solde held | `spreadCents` = **largest-remainder copy** | P |
| `cancellationNettedRefundIds` (234) | which earlier refunds the avoir read: **rebuilds the requalification N times** (once per earlier refund) and compares a signature | a derived fact recomputed on every fiche read of a cancelled stay (`reservationsController.nettedRefundIdsOf` l.180) | DB |
| `cashDepositKeptOf` (272) | caisse acompte kept = min(acompte, cashCollected − caisse refunds) (R44 L1) | — | P |
| `cancellationFiguresOf` (283) | `indemnityAmount`, `retainedDepositAmount`, `keptFromGuest`, `writtenOffBalance` | single source for preview + write (rule 60): good | DB |
| `cancelReservation` (322) | writes history (retainedDeposit, writtenOffBalance, **keptFromGuest**), `markCancelled`, the avoir, the compensation, cancels links | **stores the same money 3 times** (§3.2 R-1) | W |
| `utils/cancellationKeptForEmail.js` `storedKeptOf` (18), `givenBackSinceCancel` (39), `cancelledKeptOf` (53), `liveKeptOf` (58) | the e-mail's kept sum: **parses `reservation_history` JSON** for `keptFromGuest`, minus indemnity lines of later refunds and the caisse drop (rule 62) | reads an audit log as a data source | DB |
| `controllers/cancellationCompensationsController.withIndemnityRefunds` (52) | `indemnityRefundedTtc` on a kept-acompte card | dup of `cancelledRefundBudget.indemnityLeftTtc` reading | DB |
| `models/icalCancellationModel.js` (236-290) | platform cancellation approval: deletes the stay unless it holds money (refund, penalty, paid link…) | the compensation row is a frozen snapshot with no FK | DB, W |

### 1.E Trop-perçu, excess, « à rembourser » (11 places)

| # | Place (line) | Computes | Dup / notes | P/DB |
|---|---|---|---|---|
| E1 | `utils/pricing.js` `scheduleOverCollectedTtc` (2933), `complementCollectedExcess` (2964-2972), `overCollectedTtc` (2973) | engine: paid acompte+solde(+plan) above what they now cover; collected complement above `rawComplement`; split cut via `unreceivedOf` | the engine decides refund-relevant figures (spec rule 2 forbids pricing units knowing payments; today the engine does) | P + DB (`readSplitReceived` l.2808) |
| E2 | `pricing.js` `sejourNetTotal` (3122) | − `refundsTotal` (book refunds injected by `reservationQuoteContext` l.46) | **dup** `quoteHeadline.storedNetTotal` (58), `financeModel.totalSejour` (143) | P |
| E3 | `utils/overpayment.js` `collectedOnSchedule` (27), `engineExcessOf` (45), `overpaymentOf` (63) | live trop-perçu: max(collected − due, engine over) − **every refund withCash** | nets **all** refunds, whereas E4 nets **free lines only** (rule 44). Two bases, reconciled by deltas in `liveOverpayment` | P |
| E4 | `overpayment.storedOverpaymentOf` (92) | stored trop-perçu: collected (max(captured, stored) per bucket, plan, complement unless adjusted, EOS mid-stay lines, notes) − (finalPrice + tax) − free refunds | — | P |
| E5 | `overpayment.overpaymentLinesOf` (154) + `scheduleLines` (217), `receivedByPoste` (197), `complementExcessPoste` (211), `currentByPoste` (122) | split of the trop-perçu by poste (rule 35), complement excess → options first, legacy → tax, options, resources, rest accommodation | `currentByPoste` = 3rd copy of accommodation = finalPrice − extras | P |
| E6 | `controllers/reservationsController.js` `overpaymentIntroducedBy` (430), `liveOverpayment` (468), `overpaymentResultOf` (568), `overpaymentOfQuote` (650), `storedOverpaymentInputs` (665), `storedOverpayment` (701), `refundMeansOf` (562) | the 409 `OVERPAID`, the live figure, the stored figure + default means (`internal` when the excess is a caisse complement's) | **re-runs the engine** (`quoteStoredReservation`, `calculateReservationQuote`) twice per read; parses `midStaySettledNotes`, `endOfStayComplementDetail` | DB |
| E7 | `reservationsController.complementLeftOf` (517), `touristTaxCollectedInComplement` (542), `leftOfStayOf` (584), `droppedSinceCollection` (603), `droppedSince` (616) | what left the stay since its money was collected, **parsed from `reservation_history`** (`optionsSignature` / `resourcesSignature` segments `id:qty:total:c0/c1`, `touristTaxTotal` from/to) | the refund poste split depends on the audit log's string format. 209 prod history rows carry signatures | DB |
| E8 | `utils/savePriceGuards.js` `unclaimedRise` (20) | locked fiche: rise − unpaid growth − plan claim − min(rise, open trop-perçu) | reads E6 | P |
| E9 | `utils/ledgerAmountEdit.js` `paidRefusal` (37) | « Pour rendre X, créer un remboursement » gap = collected − typed | another « owed back » figure | P |
| E10 | `utils/paymentPollRunner.js` `mismatchOf` (250) `excessCents`, `secondPaidLink` (287) `duplicateCents`, `fullAfterDeposit` (313) `duplicateCents`, `recordRefundOwed` (331), `settleBasket` (176) `refundOwed`/`refundCents` | money a link brought beyond the stay / a double payment / a basket the plugin could not honour | the owed amount is stored as **a JSON flag on `payment_links.basketJson`** (basket) or **only as French text in `reservation_history`** (double payment). `utils/ledgerLinks.js` (138-215) recomputes the same excess for a withdrawn link booked late; `notificationService` (549, 564) recomputes `link − expected` for the mail | DB, W |
| E11 | `utils/midStayOrderCommit.settlePaid` (237) `excessCents`; `plugins/guest-app/controllers/ordersController.paid` (654-712) `refundCents = excess`, conflict → `refundOwed`; J-7 branch `basketPayments.flagBasketRefund` (66) and `guest-app/index.cancelOrdersOf` | card order paid above its committed sale / not honoured / stay cancelled | `flagBasketRefund` (J-7) **copies** `settleBasket`'s JSON + history write. If already flagged it returns false, so a second owed amount on the same link is **dropped**, not added | DB, W |

### 1.F Guards that protect refunds (rule 52, N7)

| Place (line) | Computes | Dup | P/DB |
|---|---|---|---|
| `utils/refundUntickGuard.untickRefusal` (32) | comptaCollected(after, refunds 0) < Σ book refunds → 409 `REFUND_BLOCKS_UNTICK` naming refunds newest first | calls `paymentSettlementsModel.projectedAggregates` (DB) inside | P* (DB inside) |
| `utils/paymentSettlementService.refundRefusal` (230) | the **same invariant** for a split correction (`comptaCollected + 0.005 < refunded`) | dup of `untickRefusal` with another tolerance and message | DB |
| `utils/reservationPaymentMark` (45-55), `plugins/sas/controller.js` (486-528, reception wording), `plugins/online-payment/reconciliation/ficheWriter.undoRefusal` (110) | wrap `untickRefusal` for marks, SAS re-open, reconciliation « Défaire » | callers | DB |
| `reservationsController` (1013, 2372, 2960) | the guard on arrival undo, adjusted complement, PATCH payment | callers | DB |

### 1.G Totals and finance readers that subtract refunds

| Place (line) | What it subtracts | Filter | P/DB |
|---|---|---|---|
| `utils/quoteHeadline.storedNetTotal` (58) | `refundsBookTtc` | caller | P |
| `utils/storedSummary.buildStoredSummary` (139) | display `refundsTotal` | caller | P |
| `utils/reservationQuoteContext` (46) | engine input `refundsTotal` = `totalsByReservation().book` | skips retained, internal | DB |
| `models/financeModel.js` `totalSejour` (143) | `refundsBook(r)` | via `REFUND_COLS` | P |
| `financeModel.REFUND_COLS` (240-245) | `refundsBookTtc` = Σ `method <> 'internal'` (**includes `retained`**), `refundsWithCashTtc` = Σ all (**includes `retained`**) | not the model's filter (which skips `retained`). Harmless only because `getPaceStays` zeroes refunds on cancelled stays (473) and the other queries read `kind='reservation'` (where no avoir exists). `getLedgerStays` (781) returns cancelled stays with `refundsBookTtc` **including the avoir** | DB |
| `models/financeDashboardModel.paymentsLedger` (444-517) | a « Remboursement » row per non-internal refund (**includes `retained`**), with `indemnityTtc` | the franchise turnover (`vatFranchise.turnoverOf` l.51) relies on it: the avoir reverses at the stay ratio, the indemnity is added back at face value | DB |
| `utils/vatFranchise.turnoverOf` (51) | refund at the stay's ratio, indemnity share at face value | — | P |
| `plugins/accounting-export/synthesis.refundsOf` (335) | count + amount of refunds excluding requalification | — | P |

### 1.H Tourist-tax effects of refunds

| Place (line) | Computes | Filter | P/DB |
|---|---|---|---|
| `financeModel.REFUNDED_TAX_COLS` (296-303) | `refundedTaxAmount`, `refundedTaxNights` per stay | **every means**, retained included (rule 29) | DB |
| `financeModel` tourist-tax report (1205-1330) | declared nights = nights − round(refunded nights); amount follows the night | — | DB |
| `financeModel.withTouristTaxInTotal.refunded` (415) | `refundedTax` = book refunds' tax lines (`method <> 'internal'`, retained included) | a 2nd definition of « refunded tax » (book only) | DB |
| `utils/stayTouristTaxInTotal.touristTaxInTotal` (26) | tax kept in the total = placed − refundedTax | — | P |
| `refunds.validateRefundPayload` (872) | quantity (nights) = amount / unitPrice (4 dp); the unit price is `round2(tax/nights)`, so 10 € / 3 nights refunds 3 nights at 9,99 € and leaves 0,01 € refundable on 0 nights | client `RefundDialog.setLineQuantity` (132) computes `quantity × unitPrice` the same way | P |

### 1.I Accounting output of refunds

| Place (line) | Computes | Notes | P/DB |
|---|---|---|---|
| `plugins/accounting-export/accountingModel.js` `refundEntry` (348) | indemnity account + rate, prior indemnity, earlier refunds, booked splits | DB reads per refund | DB |
| `earlierRefundsOf` (367), `refundEntryReader` + `closeStayBooks` (377-410) | rule 56/58 closing refund: the refund emptying the sale accounts debits what is left per account | replays every encaissement of the stay up to the refund date | DB |
| `isAdjustedLine` (600), `earlierSplits` (605), `adjustedBucketSplit` (628), `bookedSplit` (655), `buildRefundEntry` (662), `indemnityShare` (727) | refund → buckets HT/VAT per (bucket, frozen rate); `retained` per line; indemnity share split cumulatively | **VAT split via `bucketFromTtc`** (spec rule 64 → VAT component); `unitPrice` reused as « TTC booked » on adjusted lines (overloaded column, §3.2) | P |
| `accountingExport.refundEntryToRows` (320) | client credit, revenue/VAT/4671 debits, indemnity account, closing legs | own `round2` | P |
| `models/vatRegimeSwitchModel.js` (74, 352-355, 466-468) | refund dates count as encaissements for the switch; **UPDATE `reservation_refund_lines.vatRate`** on a regime switch / correction / undo | rewrites a « frozen » column (vat-optional-mode rule 16 vs reservation-refunds rule 14, §3.2 V-1) | DB, W |

### 1.J Display and client

| Place (line) | Computes | P/DB |
|---|---|---|
| `utils/reservationLedger.js` `basketRefundOwed` (66), `basketRefundCents` (72), basket row (649-664), trop-perçu row (674-688), refund rows (690-722), `retainedLabel` (233), withdrawn payments row + « Marquer remboursé » (165, 727-760) | Σ owed baskets (**no action to close it**), trop-perçu prefill, refund rows with deletion action | P |
| `utils/withdrawnPayments.settleWithdrawnPayment` (59) | `refunded` outcome = `cancelReason := 'refunded'` (no amount, date or means stored) | DB, W |
| `client/.../RefundDialog.jsx` (64-150) | `round2`, `wholeUnits`, `quantity × unitPrice`, dialog total, over-cap hints | UX only (server judges). Still a 2nd copy of the per-night arithmetic | client |

**Not found:** no provider refund API call anywhere. A card refund is always « depuis l'espace du prestataire », and the
reconciliation reads **credits only** (`transactionsReader.js` l.54: `side === 'credit'`). An outgoing refund is therefore never
matched against the bank.

### 1.K Duplicate formulas — the list the component removes

| Formula | Copies today |
|---|---|
| Σ refunds of a stay by means | `refundsModel.totalsByReservation`, `totalsByReservationIds`, `refunds.refundsTotal` (dead), `financeModel.REFUND_COLS`, `financeDashboardModel.paymentsLedger`, `utils/paymentSettlementService.refundRefusal` (via model) — **3 different method filters** |
| Tax refunded | `refunds.refundedTouristTax` (dead), `REFUNDED_TAX_COLS` (all means), `withTouristTaxInTotal` (book) |
| Accommodation = finalPrice − Σ extras | `buildRefundableLines` (311), `collectedByLine` (588), `overpayment.currentByPoste` (126), `accountingModel.buildPerLineData` |
| Geste off accommodation → extras → tax | `refunds.takeGesteOff`, `cancelReservation.saleBooksOf` |
| Largest-remainder allocation in cents | `refunds.capInOrder`/`spreadBucketRefund`/`settleSplitCents`, `cancelReservation.saleBooksOf`, `cancellationRequalification.spreadCents`/`absorb`, `overpayment.scheduleLines` (drift to largest, a variant) |
| « Take-back below refunds » | `refundUntickGuard.untickRefusal`, `paymentSettlementService.refundRefusal` |
| Excess of a link payment | `paymentPollRunner.mismatchOf`, `ledgerLinks` (138-215), `notificationService` (564) |
| « Refund owed » write | `paymentPollRunner.settleBasket`, `recordRefundOwed`, J-7 `flagBasketRefund` |
| Nights between dates | `refundsController`, `financeModel`, `notificationService` |
| TTC → HT/VAT on refunds | `refunds.splitHtVat` (dead), `accountingModel.bucketFromTtc`, `indemnityShare` |
| Trop-perçu netting | `overpaymentOf` (all refunds), `storedOverpaymentOf` (free lines only) |

---

## 2. Proposed REFUNDS component

### 2.1 Placement

- Owner component 4 (« Encaissement »), beside SETTLEMENT and PLATFORM PAYMENT. Folder `server/src/utils/pricing/refunds/`, with small
  units (rule 1, rule 43: one test file each). SETTLEMENT's spec contract already names `refunds` as an input and `refundsOwed` as an
  output (rule 1 table). **REFUNDS owns `refundsOwed`. SETTLEMENT re-exports it.** No pricing unit (NIGHTS … TOTALS) imports
  REFUNDS (rule 2; the static import-graph test gains the edge).
- Pure: no DB, no clock, no settings. `now` / `today` is injected. Money goes through `money.js` (`roundMoney`, `toCents`,
  `allocateCents`), VAT through `vat.vatOf` (refund lines emit `TaggedAmount`s with `source.kind = 'refund'`), withheld commissions
  through PLATFORM PAYMENT `withheldOnCancellation`, nights and phase through STAY CLOCK / NIGHTS outputs passed in.
- Loader: `models/refundInputModel.js` builds one `RefundContext` per stay, through the `PaymentLedger` port (`refunds(id)`,
  `receipts(id)`, `installments(id)`, `splitReceived(id)`, already in rule 48's table). It is today's `refundsController.buildRegister`
  minus its arithmetic, plus the DB parts of `cancelReservation` (`bookedStayBuckets`, `depositBucketsOf`, `saleCollectedOf`,
  `installmentsRetainedOf`) and `storedOverpaymentInputs` / `leftOfStayOf`.

```
RefundContext = {
  stay: { id, kind, platform, channel: {direct}, finalPrice, touristTaxTotal, nights, cancelledAt, flags & amounts of the 4 buckets,
          installments{paid, unpaid, lastPaidDate}, arrivalAdjustment, notes[], eosDetail[], complementPaidSplit, removedLineContribs },
  lines: [{ key, lineRef?, label, bucket, vatClass, vatRate, totalCents, offered, collectAt|inComplement, contribs{acompte,solde} }],
  refunds: [{ id, kind, method, date, totalCents, afterCancellation, lines:[{ key, bucket, source, amountCents, quantity, unitPrice, vatRate }] }],
  collectedReadings: { books: byKey|null, caisse: byKey|null } | computed inside from the raw facts,   // PR A keeps collectedByLine
  booked: { deposit, solde, installments },                    // bookedStayBuckets
  split: { shares, received, pools },                          // bucketSharesOf / readSplitReceived
  platform: { withheld: { depositTtc, soldeTtc, soldeBuckets } },   // PLATFORM PAYMENT
  history: { droppedSinceCollection, complementLeft, taxCollectedInComplement },   // legacy only, PR A
  quote: { asStored, asSaved? },                               // TOTALS / SCHEDULE outputs, never re-priced by REFUNDS
  obligations: [...]                                           // §4, PR B
}
```

### 2.2 Functions (contract)

| Unit file | Function | Returns | Today's copy that moves in |
|---|---|---|---|
| `refunds/register.js` | `classify(refund)` / `classifyLine(line)` | `{kind: refund\|requalification, book: bool, offBooks: bool}`, `{source: sale\|indemnity\|commission\|caisse}` | `isOffBooks`, `isRetainedDeposit`/`isRequalification`, `isIndemnityLine`, `isCommissionLine` |
| | `totals(refunds, {scope})` | `{bookCents, withCashCents, freeCents, indemnityCents, byKey, byBucket, touristTax:{cents, nights}}` with **one** declared filter per scope (`given`, `journal`, `turnover`, `commune`) | `refundsTotal`, `refundedByKey`, `givenBackByBucket`, `refundedTouristTax`, and the logic of the 9 SQL copies (the SQL stays as a read model only if proved equal) |
| | `order(refunds, cancelledAt)` | `{after(refund), beforeAvoir(refund)}` | `madeAfterCancellation`, `writtenBeforeAvoir`, `nettedByCancellation` |
| `refunds/collected.js` | `collectedByLine(ctx, {cash})` | `{key → cents}` or null | `collectedByLine`, `takeGesteOff`, `settleSplitCents`, `collectedAfterArrival`, `addLinesOnlyTheSplitNames`, `collectedLinesGone` (PR A verbatim; PR B reads SETTLEMENT `settledCents`) |
| `refunds/refundable.js` | `budget(ctx)` | live: `{collectedCents}`; cancelled: `{collected, indemnityLeft, saleLeft, cashCollected, cashLeft}` | `cancelledRefundBudget`, controller's `cashLeftTtc = min(…)` |
| | `refundable(ctx)` | lines `{key, label, bucket, vatClass, vatRate, billed, ceiling, refunded, requalified, refundable, available?, sharedBucket?, indemnity?, cash?}` | `buildRefundableLines`, `applyLiveCollected`, `capInOrder`, `spreadBucketRefund` (→ `money.allocateCents`) |
| `refunds/judge.js` | `judge(request, ctx, {today})` | `{refund:{date, method, kind, lines[], totalCents}} \| {code, error, status}` | `validateRefundPayload`, `splitOnIndemnity`, `lastBookPaymentDateOf`, the controller's `REFUND_EXCEEDS_OVERPAYMENT` cap |
| | `deletionRefusal(refund, ctx)` | refusal or null | `refundDeletionRefusal`, `caisseKeptMoves`, `cancellationHadBookMoney` |
| | `takeBackRefusal(before, after, ctx)` | refusal or null | `untickRefusal` (projected split passed **in**), `paymentSettlementService.refundRefusal` (merged) |
| `refunds/overpayment.js` | `overpayment(ctx, {basis: 'stored'\|'asSaved'})` | `{cents, lines by poste, defaultMethod}` | `collectedOnSchedule`, `engineExcessOf`, `overpaymentOf`, `storedOverpaymentOf`, `overpaymentLinesOf` (+ helpers), `refundMeansOf`, the delta of `liveOverpayment` |
| | `introducedBy(stored, asSaved, ctx)` | 409 `OVERPAID` body or null | `overpaymentIntroducedBy` |
| `refunds/owed.js` | `owedOnLinkPayment({link, stay})` | `{excessCents, duplicateCents, shortfallCents}` | `mismatchOf` excess, `secondPaidLink`, `fullAfterDeposit`, `ledgerLinks` excess, `notificationService` (564) |
| | `owedOnBasket({paidCents, committedCents, honoured})` | `{owedCents, reason}` | `settlePaid.excessCents`, `ordersController.paid` gap, `settleBasket`/`flagBasketRefund` amounts |
| | `owedOnLineLowered({line, settledCents, newCents, offered, removed})` | `{owedCents, refusal: 'LINE_PAID'\|null}` | **new** (spec rule 23, PR B). It must equal the per-line trop-perçu of `overpayment()`, so there is one formula, not two |
| `refunds/cancellation.js` | `requalify(ctx, {today, reason})` | `{refund (retained), compensation, retainedCents, indemnityCents, withheldCents, keptFromGuestCents, writtenOffCents, nettedRefundIds}` | `buildCancellationRequalification` and helpers (`requalificationLines`, `installmentLines`, `netOfEarlierRefunds`, `absorb`, `withCommissions`, `soldeHeldOf`, `spreadCents`), `saleBooksOf` (pure part), `cashDepositKeptOf`, `cancellationFiguresOf` (pure part), `resolveCancellationReason`. `nettedRefundIds` is computed **once**, here, at cancellation (§4) |
| | `keptAfterLaterRefunds(ctx)` | cents | `cancellationKeptForEmail.givenBackSinceCancel` / `cancelledKeptOf` |
| `refunds/journal.js` (PR B, under ACCOUNTING OUTPUT) | `refundEntries(refund, ctx)` | neutral `JournalEntry{kind:'refund'\|'requalification'}` lines with roles, VAT from `vat.vatOf` | `buildRefundEntry`, `adjustedBucketSplit`, `earlierSplits`, `bookedSplit`, `indemnityShare`, `closeStayBooks`; `refundEntryToRows` becomes a format adapter (rule 63) |

**Rules the component must keep (no-regression list):** D3 (sale first, then indemnity 7588 at 0 %, only collected money), D8
(caisse refundable in caisse only, never requalified), D10/D15 (live caps on total and per line, caisse unjudged), D11 (removed paid
line keeps its contribs), D25 (one pool), D26, N7 / rule 52 (take-back guard), refunds rules 34-36, 38-40 (no trop-perçu on platform
stays, paid solde keeps what it collected), 42-44 (trop-perçu refunded once, free lines only), 45-53, payment-schedule rules 55, 60-62.

### 2.3 PR split

**PR A — 0 byte diff (pure extraction, same `round2`, same order of operations):**
- Move verbatim into `utils/pricing/refunds/*`: every pure function of `utils/refunds.js`, `utils/overpayment.js`,
  `utils/cancellationRequalification.js`, `cancelReservation.{givenBackByBucket, cashDepositKeptOf, resolveCancellationReason, keptSignature}`,
  `cancellationKeptForEmail`'s arithmetic, `refundUntickGuard.untickRefusal` with `projectedSplit` injected (the require moves to the caller).
  The old paths re-export (callers unchanged, rule 4 pattern).
- Keep each file's own `round2` inside the moved code. `money.roundMoney` is `Math.round(Number(v || 0)*100)/100`, `refunds.round2` is
  `Math.round((Number(n) || 0)*100)/100`. They differ on a non-numeric string (`'abc'` → NaN vs 0). Rule 38 lets them merge only in
  PR C, after the replay.
- `money.allocateCents` replaces **no** copy in PR A unless the replay proves it: `capInOrder` (ordered) and `spreadBucketRefund` /
  `spreadCents` (proportional, ties earlier-first) and `absorb` (largest-first, ties later-first) are **three different tie rules**.
  Merging them is a behaviour change.
- Delete the dead `splitHtVat`, `refundedTouristTax`, `refundsTotal` (tests move to the new units). Prod output is unchanged.
- Price gate (rule 68) gains per stay: `refundableLines`, `collectedTtc`, stored + live trop-perçu with lines, cancellation preview
  figures, refund journal rows. Only 1 refund exists in prod, so add the 66 refund test fixtures to the gate's synthetic set.
- Refund lines feed `vat.vatOf` as tagged amounts at their stored `vatRate`: 0 diff (one rate per stay today).

**PR B — behaviour changes (expected-diff list to approve):**
1. `collectedByLine` reads SETTLEMENT `settledCents` per line (spec rule 21) instead of contribs + JSON blobs. Legacy rows go through
   one `legacyCollectedByLine` adapter (the `legacyBucketSplit` pattern of rule 63). Diffs are expected only where the legacy reading
   had no per-line truth: the 80 % of prod paid soldes without contribs, with per-line caps appearing.
2. The trop-perçu becomes Σ(settled − due) per line + the stay-level excess. **One** netting (free « trop-perçu » refunds, identified
   by `source`, §4) replaces `overpaymentOf` vs `storedOverpaymentOf`. The poste split stops parsing `reservation_history`. Expected
   diffs: the poste split of legacy stays, and stays whose free commercial-gesture lines currently lower the trop-perçu.
3. Spec rule 23 `owedOnLineLowered` writes a **refund obligation** (§4), not a `reservation_refunds` row (CONFLICT C-1).
4. `refundable()` per line uses the line's `vatClass`/`vatRate` (spec rules 51, 61): with one rate per stay there is no figure diff.
   With new classes, the refund lines split by class.
5. One take-back guard (`takeBackRefusal`) replaces `paymentSettlementService.refundRefusal`. Its message and tolerance align
   (0.005 € vs exact cents): a listed diff on one edge.
6. The finance SQL copies read `refunds.totals(..., {scope})` or a view built from it. The `retained` filter becomes explicit:
   `getLedgerStays` / `paymentsLedger` keep the avoir because the franchise turnover needs it, and say so.
7. `cancellationNettedRefundIds` is replaced by the stored nettings (§4). Diffs on deletion refusals are allowed only if the backfill
   differs, which the proof forbids.

**PR C:** guest-app `owedOnBasket` through `extraSale`; `flagBasketRefund` / `settleBasket` write obligations; reconciliation could
later read debits for refunds (out of scope unless decided, O-3); `money` copies merged where proved.

---

## 3. DB critique

### 3.1 Where refund information is stored today

| # | Table.column | Holds | Writers | Readers | Prod |
|---|---|---|---|---|---|
| T1 | `reservation_refunds` (id, reservationId, refundDate, method, totalTtc REAL, reason, createdAt, afterCancellation) | header of a refund **or** of a cancellation requalification (`method='retained'`) | `refundsModel.create` (controller, `cancelReservation`) | refundsModel (all), financeModel ×3 SQL, financeDashboardModel, vatRegimeSwitchModel, deletionGuard, accountingModel, cancellationKeptForEmail, ledger | 1 row |
| T2 | `reservation_refund_lines` (lineKey, label, bucket, quantity REAL, unitPrice REAL, amountTtc REAL, vatRate REAL) | what was given back; `bucket='indemnity'` = funded by the indemnity; `lineKey='commission'` = withheld commission; `lineKey ∈ {accommodation, options, resources}` = bucket-level requalification; `unitPrice` = « TTC booked » on adjusted requalification lines | refundsModel; **vatRegimeSwitchModel UPDATE vatRate** | same as T1 + `REFUNDED_TAX_COLS` | 2 rows |
| T3 | `reservation_history.changedFields` JSON, `field ∈ {retainedDeposit, writtenOffBalance, keptFromGuest}` on `eventType='cancel'` | the cancellation's money figures | `cancelReservation` | `cancellationKeptForEmail.storedKeptOf` (the notice's figure), history UI | 0 |
| T4 | `reservation_history` `field='refundOwed'` (French text, amount inside the sentence) | a double payment / basket to refund | `paymentPollRunner.settleBasket`, `recordRefundOwed`, J-7 `flagBasketRefund` | tests and history UI only (**no structured reader**) | 0 |
| T5 | `reservation_history` `optionsSignature` / `resourcesSignature` / `touristTaxTotal` | line totals before/after every save | the fiche save | `droppedSince` → trop-perçu poste split | 209 |
| T6 | `payment_links.basketJson` `{refundOwed: true, refundCents?}` | basket money owed back (whole or part) | `settleBasket`, J-7 `flagBasketRefund` | `reservationLedger` basket row, `expectedReceipts` (comment) | column absent |
| T7 | `payment_links.cancelReason = 'refunded'` (+ `paidAt`, `providerPaymentId`) | a payment after withdrawal, marked refunded by the operator | `withdrawnPayments.settleWithdrawnPayment` | ledger labels | column absent |
| T8 | `guest_orders.status = 'paid_conflict'`, `total REAL`, `deferredCents` (plugin) | an order paid and not honoured = to refund | ordersModel | ordersController, admin labels | table absent |
| T9 | `cancellation_compensations` (origin `retained_deposit`, receivedAmount REAL, cancelledStayAmount, client names, …) | indemnity booked by a cancellation (mirror of the avoir), or what a platform owes | `cancelReservation`, iCal approval, compensation CRUD | accounting, compensation cards, `indemnityRefundedTtc` | 1 (platform) |
| T10 | `reservations.cancelledAt`, `cancellationReason`, `cancelledBy`, `kind='cancelled'` | the cancellation fact | `markCancelled` | all cancelled-stay readers; `madeAfterCancellation` fallback | 0 |
| T11 | `reservations.*ContribTtc` (4 columns) + line `acompteContribTtc`/`soldeContribTtc` | per-bucket split captured at payment | fiche save | collectedByLine, overpayment, cancellation, accounting | 80-87 % NULL on paid rows |
| T12 | `reservations.complementPaidSplit` (JSON), `removedLineContribs` (JSON), `complementCollectedTax` | what a booked complement / removed paid line collected | complementPaidSplit, removedLineContribs, payment flips | collectedByLine, collectedLinesGone, accounting | absent |
| T13 | `reservations.midStaySettledNotes` (JSON array of notes with lines), `endOfStayComplementDetail` (JSON) | payments during the stay per key | notes, SAS, midStayOrderCommit | collectedAfterArrival, lastBookPaymentDateOf, storedOverpaymentInputs | 0 / 10 |
| T14 | `payment_settlements.parts` (JSON), `shortfallCents`/`shortfallKind`; `payment_tenders` (INTEGER cents, `internal`) | split payments, geste, reste; overpaid derived | paymentSettlementService | bucketSharesOf, targetFigures, splitReceived | absent |
| T15 | `reservation_installments.paidSplit` (JSON) | a paid installment's split | installments | cancellation requalification | absent |
| T16 | `reservations.arrivalPaymentReduction` / `arrivalPaymentTip`, `arrivalPaymentGroup` (JSON) | « modelled on the refund » (reservationSettlement l.152) | arrival payment | comptaCollected, cashCollected | 0 |
| T17 | `app_settings.cancellationCompensationAccount`, `vatRateCancellationCompensation` + accounting-export `stay_closing_from_v1` | indemnity account / rate; closing cutoff | settings | accountingModel | defaults |

### 3.2 Problems

**Redundancy (same fact stored twice)**
- **R-1 Cancellation money × 3.** The kept indemnity is in T1 (`retained.totalTtc = requalifiedTtc`), T9 (`receivedAmount =
  requalifiedTtc`) and T3 (`retainedDeposit`, `keptFromGuest`). T9 has **no `refundId`**, so the pairing is by convention
  (`reservationId` + origin + date). T3 is the **only** home of `keptFromGuest`: the notice e-mail parses an audit log to find a money figure.
- **R-2 `totalTtc` = Σ `amountTtc`**, stored on the header. It is the server's own sum, but for the `retained` avoir the caller passes
  `requalifiedTtc`, which `buildCancellationRequalification` guarantees equals the Σ lines. A derived value with two writers.
- **R-3 Order relative to the cancellation** is stored in three forms: `afterCancellation` (since #929), id order against the
  avoir, `createdAt` vs `reservations.cancelledAt`. Three readers (`madeAfterCancellation`, `writtenBeforeAvoir`,
  `nettedByCancellation`) choose among them.
- **R-4 « Refund owed »** has four homes (T4 text, T6 JSON flag, T7 reason, T8 status) and **no row of its own**. The ledger reads
  only T6 and T7.

**Derived values stored as amounts / data read from logs**
- **L-1** `cancellationNettedRefundIds` is a fact of the cancellation, but it is **recomputed on every read** of a cancelled fiche by
  rebuilding the requalification once per earlier refund. It should be written once, at cancellation.
- **L-2** The trop-perçu poste split parses T5 signature strings (`id:qty:total:c0|c1`). The refund's booking (which revenue account
  is reversed) therefore depends on an audit log format, and on stays saved before the `c0/c1` flag existed an « overflow correction »
  is needed.
- **L-3** `refund_lines.quantity` is derived (amount / unitPrice, 4 dp) and `unitPrice` is a **rounded** derived figure. The tax
  per night `round2(tax/nights)` makes a whole-stay tax refund by nights miss by up to `nights − 1` cents (e.g. 10 € / 3 nights).
- **L-4** `unitPrice` is overloaded: a unit price on sold-line refunds, « the TTC the acompte booked » on adjusted requalification
  lines (`isAdjustedLine`), 0 on commission and solde-bucket lines.

**JSON blobs that should be rows**
- T12, T13, T14 `parts`, T15 and T6 are all **money facts per line or per payment** stored as JSON. The refund register parses 5 of
  them (`collectedByLine`, `collectedAfterArrival`, `collectedLinesGone`, `lastBookPaymentDateOf`, `storedOverpaymentInputs`).
  Spec §5's `settledCents` + `settlementRef` on lines is the fix for collection. Refunds need the symmetric
  `refund_lines.paymentRef` / `lineRef` (§4).

**Ambiguous statuses / overloaded columns**
- **A-1 `method`** mixes the means (`transfer`, `cash`, `internal`) with the nature (`retained` = a requalification, no money moved).
  Every reader must remember to exclude `retained`, and 3 of the 9 copies do not (financeModel `REFUND_COLS`,
  `withTouristTaxInTotal`, `paymentsLedger`). They are right today only because of the row sets their callers pass.
- **A-2 `bucket`** mixes the revenue bucket (accommodation/options/resources/touristTax) with the funding source (`indemnity`).
  An indemnity line loses which sale line it came from: `lineKey` is kept, but the bucket is replaced.
- **A-3 `lineKey`** mixes line identity (`opt:<id>`, `custom:<label>`), bucket-level requalification (`options`, `resources`,
  `accommodation`) and a marker (`commission`). `custom:<label>` breaks on a rename (prod: 14 custom lines, no duplicate label
  today). **Spec rule 13 (append, never merge) makes `opt:<id>` ambiguous**: two lines of the same article on one stay share
  `opt:6`. The same holds for `removedLineContribs` and `midStayExtras.settledByKey` (CONFLICT C-2).
- **A-4 A free line** (`lineKey NULL`) is either a « Trop-perçu » refund or a commercial gesture. `freeLinesTotal` counts both as
  trop-perçu refunds: a 20 € « Geste commercial » free line lowers the stored trop-perçu by 20 €. Rule 42 decides by « where the
  dialog was opened » (`fromOverpayment`), but that flag is **not stored**.
- **A-5 `payment_links.cancelReason='refunded'`** is a link-lifecycle reason doing the job of a money outcome, with no amount, date
  or means. `basketJson.refundOwed` has **no done state**: the ledger row « À rembourser » has `action: null` and can never be
  closed (reservationLedger l.649-664).

**Missing links (refund → what it refunds)**
- **M-1** No link from a refund (or line) to the **payment** it gives back: bucket, installment, settlement / tender, payment link,
  note. Consequences: the take-back guard works on stay totals (N7), the cancellation reconstructs « the solde absorbs first »,
  and a card refund cannot be matched to its provider payment.
- **M-2** No link to the **reservation line row** (only the article key, A-3).
- **M-3** `cancellation_compensations.reservationId` has no FK and survives the stay's deletion (the prod row points at a deleted stay).
  `refundId` is missing (R-1).
- **M-4** No means `card`. A card refund through Qonto or the terminal is recorded as `transfer` (or not at all, T6/T7), and the
  reconciliation reads credits only.
- **M-5** No journal entry for refunds owed or settled outside the register: a `paid_conflict` basket or a double payment is money
  in and out of the bank that the books never see. Recording it through the register is refused by D10, because the money is not in
  `comptaCollected` (open decision O-5).
- **M-6** Refund create/delete writes no `reservation_history` entry.

**VAT rate « frozen »**
- **V-1** reservation-refunds rule 14 and the `schema.sql` comment say « frozen at creation, never re-priced ». vat-optional-mode
  rule 16 (owner-approved) **re-rates** non-tax, non-indemnity lines on a regime switch, correction or undo (`vatRegimeSwitchModel`
  l.352-355, 466-468). The behaviour is intended, but the two specs contradict each other (CONFLICT C-3).
- **V-2** The rate stored is `vatRegimeModel.rateForRow(stay)` for **every** non-tax line, so a single rate per stay. Under spec
  rules 61-62 (vatClass × customerContext), a refund line must carry the rate of the line it refunds, `vatClass` included.
- **V-3** The indemnity share rate is read from settings at export time (`indemnityShare`, `compensationSettings`), not frozen on the
  line. A settings change re-splits an already-exported indemnity refund.

**Euros REAL vs integer cents**
- Refund tables: REAL euros (`totalTtc`, `amountTtc`, `unitPrice`, `quantity`, `vatRate`). Settlements and tenders: INTEGER cents.
  Installments: `amountCents`. Basket refund: integer cents inside JSON. Guest orders: `total REAL` + `deferredCents INTEGER`.
  The register converts both ways (`Math.round(x*100)`, `/100`) about 40 times. Spec Q9 defers cents inside the units, so the
  additive `amountCents` columns below are storage only.

---

## 4. Simplification proposal (additive, idempotent, no amount column rewritten — rule 36)

All new columns are nullable or defaulted, set by `database.js` with `PRAGMA table_info` guards, and backfilled `WHERE <new> IS NULL`
in the same boot block. Proof is the price gate plus refund replay: every reader switched to the new column yields the same bytes as
the legacy derivation on the snapshot and the 66 fixtures.

| # | Change | Backfill (from stored data only) | Readers that move |
|---|---|---|---|
| S1 | `reservation_refunds.kind TEXT` (`refund` \| `requalification`) | `method='retained'` → `requalification`, else `refund` | every `isRetainedDeposit` / SQL `method <> 'internal'` reader states its scope via `refunds.totals({scope})`; `method` stays as is |
| S2 | `reservation_refunds.amountCents INTEGER`; `reservation_refund_lines.amountCents INTEGER` | `ROUND(totalTtc*100)`, `ROUND(amountTtc*100)` | none in PR A (storage). The component reads cents when Q9 lands |
| S3 | `reservation_refund_lines.source TEXT` (`sale` \| `indemnity` \| `commission` \| `caisse`) and `revenueBucket TEXT` | `bucket='indemnity'` → source `indemnity`, `revenueBucket` from `lineKey` (accommodation / touristTax / `res:` → resources / else options); `lineKey='commission'` → `commission`, `revenueBucket=bucket`; else `sale`, `revenueBucket=bucket`. `bucket` itself is untouched | `isIndemnityLine`, `isCommissionLine`, `indemnityGivenBefore/Back`, `splitOnIndemnity` output, accounting `buildRefundEntry` |
| S4 | `reservation_refunds.origin TEXT` (`operator` \| `overpayment` \| `cancellation` \| `lineLowered` \| `obligation`) | `retained` → `cancellation`; else `operator`. **Not derivable** for past « Trop-perçu » free lines (prod: 0 free lines, so nothing lost) | `freeLinesTotal` → Σ free lines of `origin='overpayment'` (fixes A-4: an expected diff, see O-6). The controller writes `overpayment` when `fromOverpayment` |
| S5 | `reservation_refund_lines.lineRef TEXT` (`option:<resId>:<optionId>` today, `line:<table>:<rowid>` after rule 13) and `paymentRef TEXT` (`bucket:deposit\|balance\|complement\|endOfStay`, `installment:<id>`, `settlement:<id>`, `link:<id>`, `note:<id>`) | `lineRef` where `lineKey` matches exactly one current line; else NULL. `paymentRef` for `retained` lines from their label suffix « — échéance n/m » → `installment:<id of number n>`, acompte lines → `bucket:deposit`; else NULL | `collectedByLine` / `refundable` per-line caps, take-back guard per payment (N7 more precise later), accounting split |
| S6 | `refund_nettings (avoirId, refundId, PRIMARY KEY(avoirId, refundId))` written by `cancelReservation` | for each `retained` avoir: today's `cancellationNettedRefundIds` result, computed once (derived from stored rows) | `refundDeletionRefusal` reads the table; `nettedRefundIdsOf` and the N-rebuild disappear (L-1) |
| S7 | `cancellation_compensations.refundId INTEGER NULL` | match `origin='retained_deposit'` rows to the `retained` refund with the same `reservationId`, `receivedDate = refundDate`, `ROUND(receivedAmount*100) = ROUND(totalTtc*100)` | compensation card's `indemnityRefundedTtc`, accounting pairing (R-1, M-3) |
| S8 | `reservations.cancellationKeptCents INTEGER NULL` (+ `cancellationIndemnityCents`) | from the `cancel` history entry's `keptFromGuest` (a number in JSON, not a sentence); legacy entries without it → `retainedDeposit` (today's fallback in `storedKeptOf`) | `cancellationKeptForEmail.storedKeptOf` reads the column, history stays for display (R-1, L-log) |
| S9 | New `refund_obligations` (`id, reservationId, origin` (`basket`\|`duplicatePayment`\|`withdrawnLink`\|`lineLowered`\|`orderConflict`), `paymentLinkId NULL, lineRef NULL, amountCents, reason, createdAt, status` (`open`\|`settled`\|`cancelled`), `settledAt, settledBy` (`refund:<id>`\|`provider`\|`stay`)) | T6 `basketJson.refundOwed` → `open`, `amountCents = refundCents ?? link.amountCents`; T7 `cancelReason='refunded'` → `settled`/`provider`, `amountCents = link.amountCents`, `settledAt = NULL` (unknown); T8 `paid_conflict` → `open` when no T6 row; T4 history text → **not backfilled** (amount only inside French text; prod has 0) | ledger « À rembourser » rows (can close them), `settleWithdrawnPayment` (writes `settled`), `settleBasket`/`flagBasketRefund`/`recordRefundOwed` (write rows; history keeps the sentence), spec rule 23 (`lineLowered`). Basket JSON and link reason stay written in sync until PR C |
| S10 | `reservation_refunds.method` admits `card` (book money, `providerRefundRef TEXT NULL`) | none (no existing card refund) | judge, export (bank account), reconciliation of debits (later, O-3) |
| S11 | `reservation_refund_lines.vatClass TEXT NULL` | NULL reads as today's family of the bucket (rules 61-62), so 0 diff | `refundable` → VAT component |
| S12 | History entries `refund` / `refundDeleted` (no schema, new `eventType` values) | none | M-6 |

What is **not** proposed: storing the trop-perçu (refunds rule 39: not a state); rewriting `bucket`, `method`, `lineKey`,
`unitPrice` or any amount; moving `retained` avoirs out of `reservation_refunds` (they are what the journal reads, rule 34 of
payment-schedule).

### Flags against INVARIANTS / existing rules (owner to decide; not proposed silently)

- **C-1 (spec pricing-components rule 23 vs reservation-refunds rules 3 and 13).** Rule 23 says a lowered paid line « writes a
  refund owed (`reservation_refunds` / `flagBasketRefund` merged to the full amount) ». But `reservation_refunds` holds money that
  **left** (real money-out date, not in the future). A refund owed written there would enter `comptaCollected` and the journal before
  any money moved. Proposal: `refund_obligations` (S9), then a real refund settles it. Also: the lowered line's owed amount must be the
  per-line trop-perçu (one formula).
- **C-2 (pricing-components rule 13 vs refund line identity, D11, `settledByKey`).** Appending a second line of the same article makes
  `opt:<id>` ambiguous for refund caps, `removedLineContribs` and notes. Rule 13 needs a line id (S5 `lineRef`) before PR B ships, or
  the per-line D15 cap merges two lines.
- **C-3 (reservation-refunds rule 14 « frozen » vs vat-optional-mode rule 16 « re-rated »).** The code follows rule 16. Rule 14 and the
  `schema.sql` comment should be amended, or rule 16 narrowed. Spec rule 64 of pricing-components says « frozen rate kept as stored
  data », which repeats rule 14.
- **C-4 (D8).** S3's `source='caisse'` is a label only. It must never be read to requalify caisse money (D8 stands).
- **C-5 (rule 44 « avertir seulement »).** S4 changes what lowers the stored trop-perçu (only `origin='overpayment'` free lines). This
  is the literal reading of rule 44, but it differs from today's code: a gesture free line stops lowering the trop-perçu. The owner
  confirms the reading, or keeps « every free line ».
- No proposal touches D3's order (sale first, indemnity second, collected money only), D10/D15 caps, D25 pools or N7.

---

## 5. Open decisions for the owner

| # | Question | Options | Recommendation |
|---|---|---|---|
| O-1 | Where REFUNDS sits | (a) own component in « Encaissement », SETTLEMENT re-exports `refundsOwed`; (b) a sub-part of SETTLEMENT; (c) stays in `utils/refunds.js`, only the duplicates removed | **(a)**: SETTLEMENT stays small, and refunds already have 66 test files to own |
| O-2 | « À rembourser » outside the register | (a) `refund_obligations` table (S9) with a close action; (b) keep JSON flag / link reason / history text, add a « Marquer remboursé » on baskets; (c) write them straight as `reservation_refunds` | **(a)**. (c) contradicts refunds rules 3 and 13 (C-1) |
| O-3 | Card refunds | (a) add means `card` + `providerRefundRef`, reconciliation reads debits later; (b) keep « transfer » for every book refund; (c) refunds through the Qonto API (none exists today) | **(a)** without (c) for now |
| O-4 | Refund line identity once lines append (rule 13) | (a) `lineRef` = reservation line row id, `lineKey` kept for legacy; (b) keep article key, caps per article over its lines; (c) forbid appending on lines that have refunds | **(a)**, delivered with PR B commit 1 |
| O-5 | Money in and out never booked (`paid_conflict`, double payment) | (a) settled as obligations only, no journal (today); (b) journal both movements on a suspense account (471); (c) book the payment as a note then refund it through the register | **(a)** now, (b) when the accountant asks |
| O-6 | What lowers the stored trop-perçu | (a) only free lines of `origin='overpayment'` (rule 44 literal); (b) every free line (today's code) | **(a)**, as a listed diff (no prod row affected) |
| O-7 | Trop-perçu basis after PR B | (a) one stored reading Σ(settled − due) per line + stay excess, the live preview being the same function on the as-saved quote; (b) keep engine + stored deltas; (c) (a) for new stays, (b) for legacy via adapter | **(c)**: legacy stays (80 % of prod) keep their figure byte for byte |
| O-8 | VAT of refund lines | (a) rate of the refunded line (vatClass) at the period of the stay, re-rated with the period (rule 16, amend rule 14); (b) frozen at creation forever (amend rule 16); (c) frozen + journal correction entry on a switch | **(a)**, and fix spec wording C-3 |
| O-9 | Cancellation figures | (a) columns `cancellationKeptCents` / `IndemnityCents` + `refund_nettings` + compensation `refundId` (S6-S8); (b) keep history + recomputation | **(a)** |
| O-10 | Lowered / offered / removed paid line (rule 23) | (a) refuse by default, confirm → obligation of the line's excess (= its trop-perçu share); (b) allow silently, trop-perçu shows it (today); (c) refuse always, operator refunds first | **(a)**, as the spec says, but through obligations (C-1) |
| O-11 | Tie rules of the cent allocators | (a) keep the 3 tie rules (ordered, proportional earlier-first, largest-first later-first) as named strategies of `money.allocateCents`; (b) unify on one (behaviour diff) | **(a)** in PR A; (b) only with a listed diff |
