# Re-review: feature/guest-app-from-j7 @ 26405b48 (second pass)

## Setup
- **Worktree:** `/Users/adrien/Documents/workspace/guestflow-dev/worktrees/gf-feat-guest-app-j7`, clean before and after.
- **Experiments:** `scratchpad/rv-guest-app-j7b/` contains:
  - `mut/`: `git archive HEAD`, used for the mutants;
  - `merged/`: `git archive` of the merge-tree of HEAD + current `origin/inte/plugins` 08df46f8 (R43);
  - `probe.db`: a clean copy of the shadow;
  - scripts `o1`-`o5.mjs`, `inproc.js`, `mutate.py`, `runset.sh`.
- **Shadow N=6:** run with `NODE_ENV=test GUESTFLOW_DISABLE_OUTBOUND=1`. The test copy was changed as follows:
  - lodging 2's winter closure removed;
  - the bath linked to both lodgings;
  - heat-up 240 / retention 480;
  - service hours 08-12 and 16-20;
  - Booking 22282 moved to 16-18 Nov to reach the J-7 window (the same result was then reproduced at its real dates on `probe.db`).
- **Shadow result:** outbox 0, 0 TypeError / ReferenceError / unhandled in the server log. Shadow stopped.

## Gates
| Gate | Result |
|---|---|
| Merge with current `origin/inte/plugins` (08df46f8, R43, which landed after the coder's merge) | Clean (`git merge-tree`, no conflict). The branch does not contain R43 yet. |
| Server, full suite on the merged tree (concurrency 5) | 11 943 / 11 944. The one failure is `plugins-bundled-admit-release` rule 62, which runs `git --base HEAD` and so needs a git checkout; the `git archive` copy has none. It passes 7/7 in the worktree. Counted as green. |
| Client Vitest on the merged tree | 3958 / 3958 |
| Guest app Vitest | 86 / 86; `vite build` OK |
| `check-test-dates --strict --base origin/inte/plugins` | OK |
| **`check-plugin-versions --base origin/inte/plugins`** | **RED, exit 1:** « ✗ sas changed since origin/inte/plugins but is still 1.9.2 ». `client/src/plugins/sas/ReservationSasDialog.jsx` and its new test changed in aede0307, with no bump. Same against 9b9e64ae. The coder's report says this script passes. |
| `build-changelog` | OK; fragments `added--guest-app-from-j7.md`, `fixed--guest-app-from-j7-second-pass.md` |
| `check-spec-coverage` | Exit 0. `mid-stay-extras-to-end-of-stay-complement.md` (8/22) and `mid-stay-notes.md` (14/25) still list missing rules, as the coder reported. |
| E2E | Not re-run by me (the coder reports `sas-stay-step-direct-only` and `sas-day-window` 5/5). |
| sendMode | Unchanged: `email_templates` id/name/sendMode/enabled are identical to the source shadow. The only addition is core template 14, `manual`. The J-7 and J-2 templates stay manual. The auto templates (3, 10, 11, 12) are the operator's own existing choice. |
| INVARIANTS | D28 untouched. R36b N4 narrowing is recorded in guest-app rule 81: « (R36b N4 …) holds for the day rate; an offered evening hour is a priced order ». The orchestrator should add the INVARIANTS line. No other entry undone found. |

## Mutants (24 files, baseline 164 / 164 green)
- **Killed (33):**
  - M1 to M15, M17 to M24;
  - N1 (platform not `arrival`);
  - N3 (tax guard);
  - N4 (charge key by label);
  - N5 (offered charge not counted);
  - N6 (`dataFor` ignores collected);
  - N7 (adjust-note guard);
  - N8 (one key namespace);
  - N9 (bound worded as stock);
  - N12 (order re-check `heatFrom`).
- **The four survivors of the first review are now killed:**
  - M10 (cancel guard on the arrival note): fail 2;
  - M15: fail 1;
  - M19: fail 2;
  - M22: fail 2 (and N12 at the card re-check).
- **Survived (4):**
  - **N2:** `freshPricing` reduced to `structuredClone`: 0 fail. The coder admits the stale-tax test does not prove the fix, and the fix itself is the root of HIGH 1.
  - **N10:** `editableStay` without the « arrival complement collected » clause: 0 fail.
  - **N11:** `tagCharges` without `sasArrivalOrigin = 0`: 0 fail.
  - **N13:** `heatFrom: at` dropped from the shop's « first free slot today » (`shopController` l. 451): 0 fail.

## Previous items, re-run
1. **Platform stays order from J-7: FIXED.**
   - Shadow: GdF 22308 (J-3) shows `orderCollection arrival`, « Régler à l'arrivée ».
   - A cider ×2 order gives finalPrice +13 and complement +13. Solde and payout are unchanged.
   - Booking 22282 is open too. Direct stays with money due are untouched (N1 / M14 killed).
2. **Byte-identical replay dropped: done, but the replacement is wrong.** See HIGH 1 and MEDIUM 2.
3. **SAS data refreshed after an edit: FIXED.**
   - 22328, 1280 px: cider 2→3 shows 56,50 € at once.
   - Going back a step and returning keeps 56,50 €. The recap reads 56,50 €.
   - Removing both orders (each through the confirm « Retirer la commande ? ») hands over to the recap, now « 7 sur 7 », « Rien à percevoir ».
   - DB after: orders `cancelled`, the bath line and its 20 € charge gone, finalPrice back to 272,08.
4. **Recap recall: FIXED.** « Commandes Mon séjour : 56,50 € (dans le complément d'arrivée) ».
5. **No step once the arrival complement is collected: FIXED.**
   - The SAS was committed through the UI (CB / Chèque, 6,50 €, `complementPaid 1`).
   - `GET /api/reservations/22328/sas` → `pluginData['guest-app'] = {available:true}`, with no `ordersAtArrival`.
   - The guest sees « Réglée ». An amend afterwards → 409 ORDER_NOT_EDITABLE.
6. **Arrival-moment note: FIXED.** Adjust and cancel both return 409 `NOTE_ONLINE_PAYMENT` (N7 / M10 killed).
7. **M10, M15, M19, M22: FIXED** (killed). New gaps: N2, N10, N11, N13 (LOW 6).
8. **Spec collision: FIXED.** `guest-email-sequence.md` rule 38 is at the end; merge clean.
9. **390 px: FIXED.** The price sits beside the label, quantity × unit price below, the stepper and « Retirer » on their own line, no repeated title. Screenshot: `guestFlow/.playwright-mcp/rvb-sas-390.png`.
10. **Keys and look: FIXED.**
    - `opt:` / `res:` / `chg:` (N8 killed).
    - Bath row « mer. 11 nov., 20 h – 21 h · offerte · + 20 € soirée · 20 € ».
    - 1280 px matches the mock (`rvb-sas-1280.png`): fold « 2 commandes · 50 € à percevoir », chip « À régler à l'arrivée », order total, « Total à percevoir ».
11. **Stock vs per-article bound: FIXED.** Amend 7 > max 6 → 409 ITEM_MAX_QUANTITY « 6 au plus pour « Blonde du Pilat 75cl - 4,5° ». » (N9 killed).
12. **Labels: FIXED.** A crafted day-before bath quote reads « Ce créneau est hors de votre séjour ». The guest list reads « Annulée » for removed orders.
13. **Order charges by id: FIXED.** N4 and N5 are killed. The recap still offers « Offrir » on the order's own charge row; that is accepted, since an offered charge still counts as billed.
14. **Spec drift recorded: FIXED** (rules 89 and 86 readings).
15. **Render before code:** the mock was updated (d35b2bc8). The SAS at 1280 and 390 matches the mock's structure, confirm dialog included.

**Crafted requests (shadow, 22327, re-run of the first review's set):**
- Bath requests answer 409 SLOT_UNAVAILABLE: day before, 17 h (staff), after check-out, off-grid, 30 min. A taken slot answers SLOT_TAKEN.
- Planche requests answer 409 DELIVERY_TIME_UNAVAILABLE: before check-in, at check-out, in the closing hour, day before. Nothing is written.
- Delivery days on 22328: today 19 h 30 / 20 h; tomorrow 9 h-12 h and 17 h-20 h; departure 9 h / 9 h 30.
- Bath slots: tomorrow 12-17 « Offert », 20-22 « Offert · + 20 € soirée »; today « Complet » (heat-up from now); departure day « Fermé ».

## Defects

### HIGH
1. **An order re-prices a platform stay: on Booking stays it moves the solde and writes a tourist tax the stay never carried.**
   - **What the code does now:** both measuring saves use `refreshTouristTax` (`freshPricing`). The measure therefore compares fresh against fresh and finds only the order's growth. The real write (`commitOrder` → `performUpdate(..., { beforeArrival })`) prices the stay with the engine, and that write is never measured.
   - **Reproduced at the real dates** on a clean shadow copy (`inproc.js` on `probe.db`, commit of cider ×2 = 13 €):

     | Stay | Tax | Solde | finalPrice | Complement | Payout |
     |---|---|---|---|---|---|
     | Booking 22282 | 0 → 19,20 | 825 → 841,02 | 905 → 914,82 | +13 | unchanged at 689,48 |
     | Booking 22304 | 0 → 33,60 | 2014,18 → 2042,21 | +7,43 only | +13 | — |
     | Booking 22270 | 0 → 24 | +24 | — | +13 | — |
     | GdF 22308 (stored = engine) | — | — | — | — | — |

     GdF 22308 is clean.
   - **Shadow through the real route (22282):**
     - The history shows `touristTaxTotal 0→19.2`, `finalPrice 905→914.82` and `balanceAmount 825→841.02`, logged as the order's own save.
     - The fiche now owes a solde 16,02 € higher on a Booking stay whose payout did not move.
     - The guest was told 13 €.
   - **Rules broken:**
     - Rule 66, which still reads « an order never re-prices the stay ».
     - Its own bucket guard (« 409 when the order would move another bucket: … solde »).
     - Rule 68's premise that a platform order « can only grow the arrival complement ».
   - **Owner acceptance not shown:** the spec line « Known consequence, owner-accepted: the order's own write re-prices the stay with the engine » is not backed by any owner message in the brief. The owner decided « order measured on its own growth », not « an order may re-price the stay ».
   - **Fix direction:**
     - Measure the write itself: `stored` before against the `dryRun` of the very save that will be written, same options. Or pin the write the way the stored fiche is pinned, so that only the order's lines are added.
     - Refuse when `finalPrice − Σ byKey`, the tax or any other bucket moves.
     - Add a test on a stored stay whose price or tax the engine no longer reproduces: the write must change finalPrice by exactly Σ byKey and leave solde and tax unchanged. Today N2 survives.

### MEDIUM
2. **The « one judge » still advertises a shop the commit refuses.**
   - `orderCollection` only checks the bucket state. It does not check that the stay can be saved at all.
   - Booking 22301 (sold 3 nights in « Très haute », a season whose minimum is now 4) reads `orderCollection: arrival`, so the J-7 mail gets `hasStayAppShop` and the shop shows open.
   - Yet every quote or order on it is refused 409 MIN_NIGHTS by the save (`priceOrder` → `refusal(base)`), and the guest gets « STAY_NOT_WRITABLE ».
   - Rule 90 promises « the J-7 e-mail never invites to a shop the commit would refuse ».
   - **Fix direction:** have the judge include a dry save of the stored stay, or have the order path not re-judge stored stay constraints (such as min nights) that the order does not touch.
3. **`check-plugin-versions` is red:** sas changed (ReservationSasDialog `refreshSasData`, `dataRevision`, the auto-advance effect) and is still 1.9.2. Bump it and add the French changelog line. CI's version gate will fail as is.

### LOW
4. **`refreshSasData` has no error path.** A failed `getReservationSas` after an amend is an unhandled rejection: no message, and the stale payload stays shown. Wrap it and fall back to the existing error surface.
5. **The amend answer's `order.editable` is always `false`** (`orderView(written, { editable: false })`) while `ordersAtArrival` carries the true value. It is harmless today, since the client reads `ordersAtArrival`, but it misleads any other reader. Pass the real flag or drop the field.
6. **Test gaps (surviving mutants):**
   - **N2:** the fresh pricing; see HIGH 1.
   - **N10:** amend on a stay whose arrival complement was collected before the arrival was marked (« Marquer perçu » on the fiche).
   - **N11:** `tagCharges` must not tag a SAS-origin row with the same label.
   - **N13:** the shop's « Premier créneau libre » must use heat from now.
   - Add one test each.

## Remaining before READY
- **HIGH 1:** the order write must not re-price the stay. Measure the actual write, or pin it. Refuse any move of the solde, the tax, or `finalPrice` beyond Σ byKey. Add a test that kills N2. Get an explicit owner answer, or delete the « Known consequence, owner-accepted » sentence from rule 66.
- **MEDIUM 2:** the shop judge must not open, nor the J-7 flags advertise, a shop whose stay fails the save (MIN_NIGHTS on 22301).
- **MEDIUM 3:** bump the sas plugin and add its changelog line, so that `check-plugin-versions` passes.
- **LOW 4-6:** `refreshSasData` error path, `editable` in the amend answer, tests for N10, N11 and N13.
- Merge `origin/inte/plugins` (R43, clean) before the PR.

VERDICT: NOT READY
