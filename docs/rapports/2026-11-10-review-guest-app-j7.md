# Review — feature/guest-app-from-j7 @ 2ca4566c (« Mon séjour » from J-7, rules 65-89)

Worktree `/Users/adrien/Documents/workspace/guestflow-dev/worktrees/gf-feat-guest-app-j7`, base `778fdb38` (inte/plugins at R41). The tree was clean before and after the review. Experiments ran in `scratchpad/rv-guest-app-j7/` (a `git archive` copy for mutants, probe DB copies, scripts `p1`-`p12.mjs`). Shadow N=6 ran with `NODE_ENV=test GUESTFLOW_DISABLE_OUTBOUND=1`. It sent 0 mails, logged 0 TypeError / ReferenceError / unhandled, and is stopped.

## Gates
| Gate | Result |
|---|---|
| Server, full (3 shards, every file) | **11 863 / 11 863 pass**, 0 fail (3814 + 4016 + 4033) |
| Client Vitest | 867 files, **3949 / 3949** |
| Guest app Vitest | **86 / 86**; `vite build` OK |
| Client `vite build` | OK |
| `check-test-dates --base 778fdb38` | OK |
| `check-spec-coverage` | OK (guest-app.md not listed missing) |
| `check-plugin-versions` | OK (17 plugins bumped) |
| `build-changelog` | OK; 3 fragments present |
| Merge with current `origin/inte/plugins` (9b9e64ae, R42) | **CONFLICT** in `specs/guest-email-sequence.md`. Both sides add a rule **37**: R42-PUB-L1 « unsubscribe page declares its language » and this branch's « J-7 may carry the Mon séjour paragraph ». |
| sendMode of templates | Unchanged. All J-x templates are still `manual`. The script's PUT sends body/bodyEn only. Verified on shadow before and after the insert. |
| INVARIANTS | D28 holds on shadow: the GdF number opens a session, direct core numbers 202611002 and 22326's answer 404 STAY_NOT_FOUND. R36-M-H1 / R37 free-units paths are untouched. No other entry undone found. |

## Mutants (targeted set of 16 files, 118 tests, baseline green)
**Killed (19):**
- heatFrom → notBefore
- crafted-slot early refusal removed
- prepaid netting removed
- paid-order guard removed
- reception day scope removed
- refund flag removed
- asap before check-in
- day before arrival listed
- supplement credit removed
- free hour at evening rate
- pre-arrival stock hold removed
- bath flag ignoring bath
- orderCollection ignoring settled
- price-moved guard removed
- held hours charged
- SAS ignoring order charges
- slots heatFrom dropped
- amend stock bound removed
- dataFor counting paid orders

**Survived (4):**
- **M10:** `cancelMidStayNote` arrival-note guard. No test anywhere.
- **M15:** bucket-move guard (`if (moved) return OFF_ARRIVAL_COMPLEMENT()`).
- **M19:** the event wiring `cancelOrdersOf` on `reservation.cancelled/updated/deleted`. Tests call `api.cancelOrdersOf` directly. The shadow proved the real path works.
- **M22:** `heatFrom: at` dropped from the ORDER's `validateSessions`. The order would then judge heating from check-in and refuse slots the picker offered.

## Shadow replay (N=6, lodging 2 winter closure removed, bath linked to both lodgings, heatUp 240 / retention 480, service 08-12 & 16-20)
**Works:**
- Pre-arrival session at J-2 by link (`mode preArrival`). Shop open with `orderCollection: arrival`, « Régler à l'arrivée ».
- Delivery days are exactly arrival → departure. The arrival day starts at 17 h (check-in 16 h + 60 min lead, service 16-20). The departure day stops at 9 h 30 (< 10 h). Nothing falls in the 12-16 closing gap. `asap: null` before check-in, banner « À partir de votre arrivée, le jeu. 12 nov. ».
- Bath slots stay inside the stay and the bath's 11-22 hours. Cold slots whose ignition falls outside service read `staff` and are hidden. Departure day greyed « Fermé ».
- On the arrival day at 16 h 25 with a 4 h heat-up, the first slot is 21 h (heat from now). Labels read « Offert », « Offert · + 20 € soirée », then « 30 € » once the free hour is used.
- Crafted orders: 03:00, day before, staff hour, after check-out, off-grid, 30 min → 409 SLOT_UNAVAILABLE. A taken slot → SLOT_TAKEN. Delivery before check-in, at check-out, in the closing hour, day before → 409 DELIVERY_TIME_UNAVAILABLE. Nothing written.
- Order cider ×2 + offered evening hour = 13 + 0 + 20 € charge (`orderChargeKey guest-order:1:evening:2`). The complement grows exactly 33. A planche adds +17.
- SAS step data is correct. Admin amend 2→1 = −6.50; session removal = −20 (charge removed, free hour back). History is journaled.
- Reception: 403 off its day, allowed on the arrival day. R36 A36-3 still 403.
- SAS commit collected the complement once (13, `complementPaid` 1). Amend after it → ORDER_NOT_EDITABLE. Guest chip « Réglée ».
- Cancelling the stay through the real route: orders `cancelled/stay`, stock held 1 → 0, planning cards gone, « Séjour annulé » in « Toutes », guest session 401.
- J-7 preview FR/EN through the real renderer, after the import script's insert: bath variant for direct stays, no paragraph for stays that cannot order.

**Not replayable:** the card path (Qonto dead on shadow) is covered by unit tests only (M3, M6 killed).

## Defects

### HIGH
1. **No OTA stay can ever order before its arrival, so the J-7 promise never reaches platform guests.**
   - `midStayOrderCommit.orderCollection` returns `arrival` only when `quote.preArrivalSettled`. That requires `(depositPaid || noDepositGap || soldeBeforeAcompte) && balancePaid`.
   - Platform stays carry `depositPaid 0` and usually `balancePaid 0` until payout. Shadow: every upcoming stay (Booking ×5, GdF, direct ×3) reads `unavailable`.
   - Even with `balancePaid` set to 1, GdF 22308 and Booking 22324 stay `unavailable`.
   - Yet forcing `arrival` shows the order lands only on the arrival complement (platform extras are forced to complement): `priceOrder` → 200, `{opt:18: 13}`, `collectAt arrival`.
   - Consequences:
     - The lookup session, which D28 opens for platform numbers only, is always read-only « les commandes ouvrent à votre arrivée ».
     - `hasStayAppShop` / `hasStayAppBath` are false, so OTA guests get no J-7 paragraph.
     - Rule 65's « A lookup session and a link session get exactly the same » is empty in practice.
   - Fix direction: `arrival` whenever the arrival is not marked and an order can only grow the arrival complement (the measure already guards buckets). Owner decision if this changes rule 68's reading.
2. **`ORDER_STAY_PRICE_MOVED` refuses orders on most real stays.**
   - The guard requires `quoteStoredReservation` to land on the stored `finalPrice` and `touristTaxTotal`.
   - On shadow, 3 of 5 upcoming Booking stays fail the replay: 905 vs 901.82 / tax 0 vs 19.2; 1055.87 vs 1040.28; 2014.18 vs 2008.61.
   - So once (1) is fixed, those guests would get a generic « ne peut pas être prise en ligne » on every order, while the J-7 mail invited them (the flag does not check the replay).
   - At minimum `emailFacts` / `orderCollection` must not advertise or open a shop the commit will refuse. Better: measure only the order's own growth instead of requiring a byte-identical replay of the stay.

### MEDIUM
3. **SAS step shows stale orders after an amendment** (rule 87 « The step then re-reads the SAS data »).
   - `SasArrivalOrdersStep` keeps the amend answer in local state only. The SAS `data.pluginData['guest-app']` is never refreshed.
   - Leaving the step and coming back remounts it on the pre-amend payload. Shadow at 390 and 1280: 50 € / cider ×2 while the fiche and recap say 43,50 €.
   - The stale steppers then send absolute quantities computed from old values.
   - `isShown` also uses the stale data: an emptied order list keeps the step.
4. **The recap never recalls « Commandes Mon séjour : X € (dans le complément d'arrivée) »** (rule 71).
   - `recapNotes` runs only when `pluginStepValues[key] !== undefined`. The step has no `initialValue` and never calls `onChange`, so the note never shows. Confirmed on shadow: the recap has no such line.
5. **Re-opened or committed SAS still shows « 13 € à percevoir ».**
   - `dataFor` / `atArrivalFor` ignore whether the arrival complement is collected. Rule 71 says no step once it is collected.
   - Shadow 22328 after the commit: step visible, `toCollect 13`, chips « À régler à l'arrivée », while the guest app says « Réglée ».
   - `changed` now means « amended » and no longer « Σ snapshots > complement ». The `changed` reading of rule 71's first paragraph (not struck) is not implemented.
6. **Arrival-moment note (card order paid before arrival) is still editable from the register.**
   - `adjustMidStayNote` has no `moment === 'arrival'` guard. Total, cash flag and date can be changed, and a total change moves money into end-of-stay detail lines.
   - The cancel guard itself is untested (M10 survived) and answers 404 NOTE_NOT_FOUND for a note that exists.
   - Rule 85 says the money is the provider's and refundable only through the refund path.
7. **Test gaps on load-bearing paths:**
   - M22: order-side `heatFrom`. A regression silently refuses slots the picker offers.
   - M19: event wiring of the stay cancellation.
   - M15: bucket-move guard.
   - Add one test each.
8. **Spec conflict with inte/plugins:** `guest-email-sequence.md` rule 37 collides with R42's rule 37. Renumber this branch's rule to 38 (at the end) and mention all three flags (`hasStayAppShop/Bath/ShopOnly`). The rule text names only `hasStayApp` / `hasStayAppShop`.

### LOW
9. **At 390 px the SAS row does not wrap the price under the label** (rule 71 last sentence). Label, stepper, price and « Retirer » share one row, and « Blonde du Pilat 75cl - 4,5° » breaks into 4 lines (screenshot `.playwright-mcp/rv-j7-sas-orders-390.png` in the main repo). The step's own title also repeats the dialog title.
10. **SAS rows deviate from the specified look.**
    - The charge row keys as `opt:<resourceId>` (`lineKeyOf`). It can collide with a real option of the same id: duplicate React key, and it is ambiguous in the payload.
    - The bath row is « 0 € » plus a separate charge row, instead of rule 71's « Bain nordique · … · offerte · + 10,00 € soirée ».
11. **Stock message is wrong.** Amend beyond the article's `maxQuantity` answers « Plus que 5 en stock » (stock left was 7): the per-article bound is worded as stock.
12. **Labels on cancelled orders and crafted quotes.**
    - « Toutes » lists a cancelled order with payment label « À régler à l'arrivée » beside « Séjour annulé ».
    - A crafted pre-arrival quote for the day before arrival reads « Ce créneau est passé ».
13. **Order charges keyed by label.** They travel through the fiche's delete-and-reinsert by matching `description` (`sasOriginCustomLabels`). The SAS evening supplement and an order charge share the label « Bain nordique — supplément soirée », and two orders share it too. A renamed or reordered line loses or swaps `orderChargeKey`, and then `orderChargedFor` bills the evening again at the SAS. The recap also offers « Offrir » on the order's charge; an offered charge counts 0 in `orderChargedFor`. Plausible double bill, not reproduced.
14. **Spec drift.**
    - `hasStayAppBath` is computed on « hours not yet placed or free minutes left ». Rule 89 says « holds a line of that resource with hours ». The code is the better reading: record it in the spec.
    - The CTA reads « Régler à l'arrivée · 18 € », not rule 86's « Commander, à régler à l'arrivée ».
15. **Coder's own report admits the UI was not rendered before coding.** The interactive HTML of the SAS step stayed at the spec mock. `impeccable context` / DESIGN.md were not run. That breaks the owner's « rendu avant implémentation » rule for the fourth and fifth messages' UX (the collapsible list, the editing controls).

Remaining before READY:
- (1) open pre-arrival ordering for platform stays, or obtain the owner's call;
- (2) stop advertising or opening a shop on stays whose replay differs (or drop the byte-identical replay requirement);
- (3) refresh SAS data after an amend;
- (4) show the recap recall;
- (5) hide or close the step once the arrival complement is collected, and restore `changed`;
- (6) guard `adjustMidStayNote` for arrival notes and test the cancel guard;
- (7) add tests for M15, M19, M22;
- (8) resolve the guest-email-sequence rule-37 conflict by renumbering to 38.

VERDICT: NOT READY
