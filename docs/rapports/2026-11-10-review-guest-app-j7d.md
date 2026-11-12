# Re-review #4: feature/guest-app-from-j7 @ 0d5eb152 (fourth pass)

## Setup
- **Worktree:** `/Users/adrien/Documents/workspace/guestflow-dev/worktrees/gf-feat-guest-app-j7`. HEAD is `0d5eb152`, the same as `origin/feature/guest-app-from-j7`. The tree was clean before and after the review.
- **Experiments:** everything is in `scratchpad/rv-guest-app-j7d/`:
  - `mut/` is a `git archive HEAD` copy and `mutate.py` holds the 52 mutants;
  - `deep.js` takes a full row and table snapshot before and after `commitOrder`, in note or card mode;
  - `bdbg.js`, `bath.js`, `bathm.js` and `ev.js` probe the bath;
  - `noop.js`, `pt.js` and `settle.js` replay fiche saves;
  - `r1.mjs`, `r2.mjs`, `rb*.mjs`, `rq.mjs` and `ro*.mjs` drive the real routes;
  - the `*.db` and `*.json` files are one shadow copy per experiment, with its result.
- **Shadow N=6:** started with `NODE_ENV=test GUESTFLOW_DISABLE_OUTBOUND=1`. guest-app was set up as in review b (`p1.mjs`). I also linked the bath to both lodgings (`resource_properties` 2→1, 2→2), because the shadow ships it unlinked, so earlier reviews never reached the bath. Results:
  - outbox: 0 messages;
  - server log: no TypeError, ReferenceError or unhandled rejection;
  - the shadow is stopped.

## Gates (all run by me at 0d5eb152)
| Gate | Result |
|---|---|
| Merge with `origin/inte/plugins` (7bd14706) | Contained in merge commit 0d5eb152. `merge-tree` is clean. The remerge diff shows the conflict was resolved correctly: #1013 stays at 1.9.3, our line moves to 1.9.4, and the changelog and spec references follow |
| Server, full suite (concurrency 6) | 12 002 / 12 002 |
| Client Vitest | 3 965 / 3 965 (871 files) |
| Guest app Vitest | 86 / 86; `vite build` OK |
| Client `vite build` | OK; bundle budget 302.6 / 313.3 kB |
| `check-plugin-versions --base origin/inte/plugins` | Green: 3 plugins changed, each with a new version |
| `check-test-dates --strict` | OK |
| `check-spec-coverage` | Exit 0 |
| `build-changelog` | OK; fragment `fixed--guest-app-from-j7-fourth-pass.md` |
| sendMode | Unchanged against the source shadow: 1-13 identical (3/10/11/12 `auto` are the operator's own choice), 14 is the core `manual` seed |
| INVARIANTS | Respected: D28 untouched; D17 holds (no order moved the tourist tax); R24-DB-3 holds (override untouched) |
| E2E | Not re-run by me. Freeing ports 3000/4000 would disturb other live sessions (shadow 3 belongs to another session). The coder reports 24 / 24 on 5 specs |

## Mutants (baseline 2 026 / 2 026 on 246 focused files)
- **Killed (51):** all 44 earlier mutants (M1-M24, N1-N13, P1-P9), plus:
  - M3: fail 1 (LOW 1 of review c is closed);
  - Q1, override ignored: fail 2;
  - Q2, plan re-sync restored: fail 1;
  - Q3, exact flag dropped from `storedBody`: fail 3;
  - Q4, exact path removed in the engine: fail 3;
  - Q5, note quantity dropped: fail 1.
- **Survived (2):**
  - **Q6:** `exactMergedTotals` forced on for every `applyUpdate`. It survives the full server suite too (the only red test, `plugins-bundled-admit-release` « rule 62 », is a baseline failure in a non-git tree).
  - **Q7:** the « units divide the amount to the cent » check is removed. See LOW 2 and LOW 3.

## Previous items, re-run
1. **HIGH 1 (an order re-prices the stay): still FIXED.**
   - **In-process, every stay in the window, note and card:**
     - Booking 22270, 22282, 22301, 22304 and GdF 22308 order at their real state;
     - direct 22303, 22306 and 22326 order once their pre-arrival money is marked paid on a copy.
   - **What moves:** an order of 2 ciders (13 €) moves only:
     - `finalPrice` +13 (and `clientGrossAmount` on direct stays);
     - `complementAmount` +13 in note mode, or +0 with an arrival note of 13 € « 2 × 6,50 » in card mode;
     - the order's option row;
     - `tariffSnapshot`.

     Tax, solde, acompte, payout, commission, nights and the plan columns stay byte-identical.
   - **Side effects that are not defects:**
     - 22303's custom line is deleted and re-inserted with the same content.
     - 22326's bath line is rewritten `per_stay` → `per_hour` at 0 €. Any line-changing fiche save on master does the same (proven with `pt.js`), so this is not specific to the branch.
   - **Broad stress:** all 58 non-cancelled stays reset to « before the arrival » on a copy. 43 order. Each one moves `finalPrice` and the complement by exactly 13, with nothing else in the money columns.
     - **Exception, an artefact of my reset:** stays that had really arrived and hold an end-of-stay complement (12, 22280, 22281) see it zeroed. Production cannot reach that state: an end-of-stay amount exists only once the arrival is marked, and that closes the arrival path.
     - Refused: 3 × `ORDER_STAY_PRICE_MOVED` and 1 × `ORDER_OFF_ARRIVAL_COMPLEMENT`, all on past stays (LOW 4).
   - **Real route, GdF 22308 at its real dates (J-3), full row diff:**
     - note order: `finalPrice` 584 → 597 and complement 0 → 13; nothing else moves except `updatedAt` and `tariffSnapshot`;
     - SAS amend 2 → 5: 597 → 616,50 and complement 13 → 32,50; `editable: true`.
   - **After the order, the fiche's no-op saves:** nothing moves (22303, 22306, 22326). The card netting holds: the complement stays 0 after a card order.
2. **MEDIUM 1 of review c (adjusted complement): FIXED.** On the real route (22308), with an override of 13 or 0:
   - the shop answers `open: false`, `unavailable`;
   - the quote answers 409 `ORDERS_OPEN_ON_ARRIVAL` with the rule-68 words;
   - the SAS orders read `editable: false`.

   Once the override is removed, the stay orders again. Q1 is killed.
3. **LOW 1 (M3): FIXED.** M3 is killed.
4. **LOW 2 (installment plan): FIXED.** 22326 with a fully paid plan: after the order, `installmentsTarget` and the paid and unpaid amounts are unchanged. Q2 is killed.
5. **LOW 3 (merged-line drift): FIXED.** With option 18 at 7 € while 22326 holds 1 × 6,50 €:
   - the order is quoted 14, charged 14 and grows the stay by 14, in note and card mode;
   - the stored line reads 3 × 6,83 = 20,50;
   - a no-op save afterwards moves nothing.

   Q3 and Q4 are killed.
6. **LOW 4 (card note quantity): FIXED for options.** The note reads `qty 2, unitPrice 7` (or 6,50). The bath is wrong (LOW 2 below).
7. **LOW 5 (§10 `changed`): FIXED.**

## Defects

### HIGH
None.

### MEDIUM
1. **On every platform stay (Booking, GdF, Airbnb…), the shop offers paid bath hours that every order refuses.**
   - **Cause:** `midStayOrderCommit.withResource` pushes a new resource line with an explicit `inComplement: 0` (`server/src/utils/midStayOrderCommit.js`, `resources.push({ … offered: false, inComplement: 0, sessions })`).
     - The engine applies `force-extras-complement-on-platform` §3 only when no flag is sent (« an explicit per-line flag always wins »), and options are pushed without one.
     - So on a platform stay, a paid bath hour stays out of the arrival complement. The platform price absorbs it: `finalPrice` and complement do not move, and on 22270 the tourist tax even drops.
     - The measure then refuses it: `ORDER_OFF_ARRIVAL_COMPLEMENT`, or `ORDER_STAY_PRICE_MOVED` on 22270.
   - **Real route on 22308 (GdF), bath linked:**
     - `GET /shop/resources/2/slots` offers 7 slots on Nov 14, then 30 € slots once the free hour is used;
     - the free hour (16-17 h) is ordered: 200;
     - every paid hour after it, and a 2 h session 12-14 h, gets 409 « Cette commande ne peut pas être prise en ligne pour ce séjour : contactez l'équipe. »
   - **In-process:** the same refusal on Booking 22282, 22304 and 22270. The same session on direct 22306 works (+30). The free hour alone works, and so does an evening free hour plus its 20 € supplement charge (+20 on 22282, 22304 and 22308).
   - **Why it matters:** this breaks the owner's second request (bookable bath with the paid hours beyond the offered one), rule 90, and the brief's « the shop never promises what the commit refuses ». It hits most stays: 5 of the 8 upcoming stays are on a platform.
   - **Test gap:** the paid-session test (`mid-stay-order-before-arrival` « rule 66: a resource session… ») runs on a direct stay only.
   - **Fix direction, verified:** drop the explicit `inComplement: 0` when pushing a new resource line.
     - On the mutant tree, 22308, 22282, 22304 and 22270 then all price and commit the 12-14 h session: `byKey res:2 = 30`, growth finalPrice +30 and complement +30, card settled 3 000 cents.
     - The focused suite stays 2 026 / 2 026.
     - Add a platform-stay paid-session test, quote and commit.
     - Also decide what to do with a stay that already holds a bath line stored with `inComplement 0` (for example the free hour ordered before the fix). Either rewrite the flag on merge, or keep it and have the slots stop offering paid hours there.

### LOW
1. **Rule 96's « every other save is byte-identical » has no test.** Mutant Q6, which forces `exactMergedTotals` on for every save, survives the whole server suite. Add a test: an ordinary fiche save on a raised locked line keeps master's figure.
2. **A card note misstates the unit price when a free unit or a free hour is part of the order (rule 97).**
   - **Direct 22306, card, bath 12-14 h with the 1 h offered:** the note reads `qty 2, unitPrice 15, amount 30`. The bath costs 30 €/h: the real content is 1 h offered plus 1 h at 30 €.
   - **The same happens on an option with free units:** 4 ordered, 2 free, at 6,50 € → « 4 × 3,25 € ».
   - **Cause:** `unitsByKey` counts every unit sold, and the divisibility test then accepts the split.
   - **Fix direction:** set `quantity` only when `amount = units × the line's own unit price`, or count only the billed units.
3. **Mutant Q7 survives:** no test covers the « payment short or non-dividing » fallback of rule 97 beyond a single unit.
4. **The shop judge and the measure still disagree on some stays (carried over from review c's secondary).**
   - On the past stays reset by my stress run, `orderCollection` answers `arrival` while:
     - 14 (direct) gets `ORDER_OFF_ARRIVAL_COMPLEMENT`;
     - Lodgify 22224, 22226 and 22242 get `ORDER_STAY_PRICE_MOVED`. Lodgify has `platformTakesDeposit`, and an extra lowers the tax.
   - No upcoming stay is affected, and Lodgify was shut down on 26/10. Neither the code nor the spec addresses it.
   - **Fix direction:** have `orderCollection` refuse when the platform mode makes an extra re-price the stay, or write the case down in the spec.
5. **The bath slots stay open while the shop is `unavailable`.**
   - With an override, or on a direct stay with its solde due, `GET /shop/resources/:id/slots` still answers bookable slots with prices.
   - `SlotPickerPage` does not gate on `shop.open`, and the home « Bain nordique » tile leads there.
   - The guest picks slots, adds them to the cart, and only then reads « Pour ce séjour, les commandes ouvrent à votre arrivée. » The refusal is polite, but it is a dead end.
   - **Fix direction:** have the slots endpoint answer `open: false` (or no bookable state) under the shop's own judge, and have the picker render it.
6. **A 0 € order (the free bath hour) reads « À régler à l'arrivée » in the SAS step.**
   - The order has `payment: 'none'`, yet `statusLabel` is the due-on-arrival wording because only card is tested. There is nothing to settle.
   - The order is also `editable: false`, so the operator cannot remove an unpaid free session at the SAS. The owner's fifth message asks that unpaid orders be editable.
   - Decide the free-order case and record it in the spec.
7. **`exactMergedTotals` is read from `req.body` on the operator's `PUT /api/reservations/:id`.**
   - The spec calls it an input « no HTTP route documents », but any operator body can raise it.
   - The money risk is nil (a cent on a merged line), but it is an undocumented engine switch on a public route.
   - Strip it from the HTTP body, or document it.

## Not verified by me
- **E2E:** not run (the coder reports 24 / 24 on 5 specs).
- **The card path through the real route:** the shadow's provider is dead (`canPayCard: false`). Card orders are proven in-process only (`commitOrder` with `paid`).
- **Booking stays through the real route:** none is inside J-7 at its real dates. They are proven in-process; the real route was proven on GdF 22308.

## Remaining before READY
- **MEDIUM 1:** paid bath hours must work on platform stays. Do not force `inComplement: 0` on a new resource line, and handle an existing line stored at 0. Add a test on a platform stay (quote and commit).
- **LOW 1-7:**
  1. a test pinning ordinary saves against `exactMergedTotals` (Q6);
  2. a card note with free units or a free hour must keep a true unit price;
  3. a test killing Q7;
  4. judge vs measure on stays whose platform mode re-prices with an extra (Lodgify), fixed or recorded;
  5. the bath slots and picker must follow the shop's `unavailable`;
  6. the SAS wording and editability of a 0 € order, decided and recorded;
  7. `exactMergedTotals` stripped from the HTTP body, or documented.

VERDICT: NOT READY
