# Re-review #3: feature/guest-app-from-j7 @ 6c1931c7 (third pass)

## Setup
- **Worktree:** `/Users/adrien/Documents/workspace/guestflow-dev/worktrees/gf-feat-guest-app-j7`. HEAD is `6c1931c7` and equals `origin/feature/guest-app-from-j7`. The tree was clean before and after.
- **Experiments:** everything is in `scratchpad/rv-guest-app-j7c/`:
  - `mut/`: `git archive HEAD`, used for the mutants;
  - `deep.js`: an in-process probe with the real plugin boot. It snapshots the whole `reservations` row and every table keyed by `reservationId` before and after `commitOrder`, in note mode or card mode;
  - `q.js`, `post.js`, `dbg2.js`: helpers;
  - `r1.mjs`, `r2.mjs`: real-route scripts;
  - `*.db` / `*.json`: one copy of the shadow per experiment, with its results.
- **Shadow N=6:** run with `NODE_ENV=test GUESTFLOW_DISABLE_OUTBOUND=1`, guest-app installed and set up as in review b (`p1.mjs`). Outbox 0. No TypeError, ReferenceError or unhandled rejection in the server log. Shadow stopped.

## Gates (all run by me at 6c1931c7)
| Gate | Result |
|---|---|
| Merge with `origin/inte/plugins` (08df46f8) | Already contained (merge commit 4c8604fc); `merge-tree` is clean |
| Server, full suite (concurrency 6) | 11 952 / 11 952 |
| Client Vitest | 3 959 / 3 959 (869 files) |
| Guest app Vitest | 86 / 86; `vite build` OK |
| Client `vite build` | OK |
| `check-plugin-versions --base origin/inte/plugins` | Green: sas 1.9.2 → 1.9.3, guest-app 1.1.0, hourly-resources 1.6.0 |
| `check-test-dates --strict --base origin/inte/plugins` | OK |
| `check-spec-coverage` | Exit 0; no line for `guest-app.md` |
| `build-changelog` | OK; fragment `fixed--guest-app-from-j7-third-pass.md` |
| sendMode | Unchanged against the source shadow: ids 1-13 are identical, 3/10/11/12 `auto` (the operator's own choice). 14 is the core's `manual` seed |
| INVARIANTS | Respected: D28 untouched; R36-M-H1 persons ceiling still refused (`forceCapacity` does not lift `personsRefusal`); R24-DB-3 (override) untouched; R36b N4 free units at 0 € with zero growth |
| E2E | Not re-run by me. Freeing ports 3000/4000 could disturb other sessions. The coder reports 5 / 5 |

## Mutants (226 files, baseline 1 918 / 1 918 green)
- **Killed (43):**
  - every survivor of review b: N2 (fail 4), N10 (1), N11 (1), N13 (1);
  - the earlier mutants: M1, M2, M4 to M15, M17 to M24, N1, N3 to N9, N12;
  - the new mutants of the fix:
    - P1, no growth pin: fail 3;
    - P2, no force flags: fail 1;
    - P3, card money not netted out of the growth: fail 3;
    - P4, tax snapshot rewritten: fail 1;
    - P5, extra-guest complement rewritten: fail 1;
    - P6, amend unpinned: fail 1;
    - P7, `finalPrice` growth 0: fail 3;
    - P8, complement growth doubled: fail 19;
    - P9, amend `editable: false`: fail 1.
- **Survived (1): M3.** It removes the arrival complement's netting of the card notes in `pricing.js`. It was killed in review b. Now the pinned write masks it, so no test covers it any more (LOW 1). The real behaviour is correct (see below).

## Previous items, re-run
1. **HIGH 1 (order re-prices the stay): FIXED.**
   - **In-process, every stay in the window, note and card** (`deep.js` on clean copies of the shadow): Booking 22270, 22282, 22301 and 22304; GdF 22308; direct 22303, 22306 and 22326 (pre-arrival money marked paid on the copy). An order of cider ×2 (13 €) changes:
     - `finalPrice` +13 (and `clientGrossAmount` on direct stays);
     - `complementAmount` +13 (note mode) or +0 with a `midStaySettledNotes` arrival note of 13 € (card mode);
     - the order's option row.

     Nothing else moves: `touristTaxTotal`, `balanceAmount`, `depositAmount`, payout, commission and nights stay byte-identical. The custom-line row of 22303 gets a new id with identical content (delete and re-insert). Exception: `installmentsTarget` on a plan (LOW 2).
   - **Same run with the catalogue +1 € and every season +10 %:** the same columns move, by the same amounts.
   - **Broad stress:** all 58 non-cancelled stays of the shadow, reset to « before the arrival » on a copy. 34 ordered. Each one moved only `finalPrice` and the complement by exactly 13, plus the order row and `tariffSnapshot` (the coder's documented exception). The other differences come from my reset (`complementPaidDate`) or are a normalisation (`endOfStayComplementDetail` `"[]"` → null).
   - **Real route (shadow):**
     - GdF 22308 at its real dates (J-3): the shop is open, `orderCollection arrival`. A note order of cider ×2 gives `finalPrice` 584 → 597 and complement 0 → 13. Tax, solde, payout, commission, gross and nights are unchanged.
     - A SAS amend 2 → 5 (`POST /api/guest-app/orders/1/amend`): `finalPrice` 597 → 616,50, complement 13 → 32,50, nothing else. The SAS payload reads « 1 commande · 32,50 € à percevoir ».
   - **After the order, the fiche's own saves:**
     - The card money stays netted. Direct 22303 and 22306 after a card order, then an operator save adding Biscanna 7,50 €: complement 7,50, not 20,50. In note mode it is 20,50. A no-op save then moves nothing.
2. **MEDIUM 2 (MIN_NIGHTS): FIXED.** 22301 (sold 3 nights under a minimum that is now 4) orders in-process. P2 is killed.
3. **MEDIUM 3 (sas version): FIXED.** sas is at 1.9.3 with its French line, and the gate is green.
4. **LOW 4 (`refreshSasData`): FIXED.** It has a try/catch with « Données du sas non rechargées… » and a client test.
5. **LOW 5 (`editable`): FIXED.** The real-route amend answers `editable: true`. P9 is killed.
6. **LOW 6 (N10, N11, N13): FIXED.** All three are killed.

## Defects

### HIGH
None.

### MEDIUM
1. **A stay with a set arrival-complement adjustment shows the shop, and the J-7/J-2 flags advertise it, but every order is refused.**
   - **Cause:** `orderCollection` answers `arrival` without looking at `complementAmountOverride`. The measure then keeps the complement at the override, so complement growth 0 ≠ order total → 409 `ORDER_OFF_ARRIVAL_COMPLEMENT`.
   - **In-process:** 22282 (override 70) and 22304 (override 0) both read `coll arrival` and `priced 409 ORDER_OFF_ARRIVAL_COMPLEMENT`.
   - **Real route (22308, override 13):**
     - `GET /public/v1/guest/shop` → `open: true, orderCollection: arrival`;
     - quote and order → 409 « Cette commande ne peut pas être prise en ligne pour ce séjour : contactez l'équipe. ».
   - **The J-7 flags follow it:** `emailFacts` takes `shop: true` on the same `orderCollection`. The J-7 e-mail therefore invites guests to a shop that refuses everything. This breaks rule 90 and the brief's « the shop and the J-7 flag never promise what the commit refuses ».
   - **Production data:** 1 stay in 58 carries an override (an Abracadaroom stay).
   - **Secondary, synthetic:** Lodgify 22242, a past stay reset to « before the arrival », reads `arrival` but answers `ORDER_STAY_PRICE_MOVED`. Same class of gap: the judge does not run the measure's own conditions.
   - **Fix direction:** either answer `unavailable` from `orderCollection` when `complementAmountOverride` is set, or have the measure (and the pinned write) move an overridden complement by the order's amount. Add a test that the flags and the shop match the commit on an overridden stay.

### LOW
1. **M3 survives.**
   - The netting of card notes in `pricing.js` (`prepaidTaken`) is no longer exercised by any test, because the order's own write is pinned.
   - The behaviour is correct today. Without a test, a regression would re-bill a card order at the arrival as soon as the fiche re-prices.
   - Add a test: a card order before the arrival, then a fiche save adding an option. The complement must equal the new option only.
2. **Rule 93's « nothing else moves » is not literal on an installment plan.**
   - **Observed:** direct 22326 has every installment paid. The order raises `installmentsTarget` 3 089,60 → 3 102,60, so the plan's `total` reads 3 102,60 € against 3 089,60 € paid.
   - **Cause:** `installments.syncAfterSave` reads the engine's `preArrivalAmount`, which the pin leaves unpinned. The same thing happens on master for any fiche extra.
   - **Test gap:** the `MONEY` list of `guest-order-never-reprices-stay` has no installment columns.
   - **Fix direction:** pin the target as well, or write the exception into rule 93.
3. **One cent of drift when an order merges into a line the stay already holds at an older price.**
   - **Observed:** on a copy, option 18 rose to 7 € while 22326 held 1 × 6,50 €. Ordering 2 more is quoted and charged 13,99 € (the engine averages the merged line: 3 × 6,83 = 20,49), not 14 €. The order row stores unit 6,83.
   - **Fix direction:** price the order's units separately, or record the reading in the spec.
4. **A card order's arrival note stores « 1 × 13 € ».** For `Blonde ×2` the settled note line reads qty 1, unitPrice 13, because `settleOrderNoteBeforeArrival` → `buildMidStayLine` defaults the quantity to 1. Anything that lists the notes says 1 × 13 €.
5. **Spec drift in the status table.** The `specs/guest-app.md` §10 row J still says « `changed` in the SAS payload is true when an order of the stay was amended at the SAS ». Rule 71 and the code say the opposite (« not amended », fiche lowered). The real-route amend indeed answers `changed: false`. Fix the row.

## Not verified by me
- **E2E:** not run (the coder reports 5 / 5).
- **The card path through the real route:** the online-payment provider is dead in the shadow, so card orders were proven in-process only (`commitOrder` with `paid`).
- **Booking stays through the real route:** 22282, 22304 and 22270 are outside J-7 at their real dates. They were checked in-process only; the real route was proven on GdF 22308 at its real dates.

## Remaining before READY
- **MEDIUM 1:** the shop judge and the J-7/J-2 flags must not offer a shop on a stay whose arrival complement carries an override (or the order must move an overridden complement), plus a test.
- **LOW 1-5:**
  - a test killing M3;
  - plan target pinned or the exception written into rule 93;
  - merged-line cent drift fixed or recorded;
  - card note quantity;
  - §10 `changed` reading.

VERDICT: NOT READY
