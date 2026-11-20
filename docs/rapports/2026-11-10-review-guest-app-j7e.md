# Consolidated exhaustive review — feature/guest-app-from-j7 @ 1d379b7f (review e)

Sources: the six reviewer reports in `scratchpad/rv-guest-app-j7e/` (money, bath, shop-email, sas-ui, security, regression). Duplicates are merged and each item keeps the highest justified severity. Doubtful items were checked on the code at 1d379b7f. "Earlier fix" names the branch commit that introduced the defect while fixing an item from an earlier review.

Context the coder must know:
- `origin/inte/plugins` moved to `e27229aa` (#1014, R45). The merge is textually clean (only `server/src/database.js` is touched on both sides). The regression reviewer ran every gate on the merged tree: server 12 040/12 041 (the 1 failure is the known archive-only `plugins-bundled-admit-release`), client Vitest 3 971/3 971, guest Vitest 87/87, builds, date/version/spec-coverage checks, E2E 23/23 targeted, and 193 full (2 font-403 artefacts that also fail on base).
- Ordinary fiche saves, bath quotes and SAS reads/previews are byte-identical to inte on 58-63 prod stays across 8 channels. Shared root of the order-commit defects: 662 order commits on every platform mode, in note and card mode, were exact on the arrival path. The defects below are specific paths.

## Defects (one list, most severe first)

### HIGH

**H1. The before-arrival / in-stay routing keys on `isArrivalNotMarked`, not on whether the stay has started.** Sources: money HIGH 1 and regression MEDIUM 1, same root. Branch design (1e4c5fc3).
- **Where:** `server/src/utils/midStayOrderCommit.js:284` (`orderCollection`: `if (!isArrivalNotMarked(id)) return 'departure'`), and the same test in `priceOrder:380`, `commitOrder:499` and `amendOrder:622`. Read by `shopController.js:173/291/299` and `ordersController.js:395`.
- **Face A, before the arrival, with the complement collected:** the operator ticks « Complément perçu » before the arrival. The stay counts as "marked", so the order goes down the unpinned end-of-stay path. Booking 22282: tourist tax 0 → 19,20, solde 825 → 841,02, `finalPrice` +9,82 for a 13 € order. Real route: the shop is open « Ajouter à ma note » 3 days before the arrival, and the J-7/J-2 flags (`index.js:155`) advertise it.
- **Face B, in stay, arrival never marked:** a regression against inte. Direct 22303 on site gets `open: false` « les commandes ouvrent à votre arrivée » and 409 `ORDERS_OPEN_ON_ARRIVAL`, where inte answered 200. Platform 22282/22308/22270 are told « Régler à l'arrivée » on day 2, and the order lands on the arrival complement instead of the end-of-stay one.
- **Fix:** the pre-arrival path iff the stay has not started (Paris date < startDate, or the arrival day per rule 66) and the arrival is not marked. A started, unmarked stay takes the mid-stay path, capturing the arrival baseline like `enterMidStayExtrasWindow`. A stay not started whose complement is already collected answers `unavailable`, or takes a pinned `orderGrowth` save on the end-of-stay complement. Apply the same predicate in `orderCollection`, `priceOrder`, `commitOrder`, `amendOrder` and the e-mail flags, and record the reading in rules 66/68.
- **Tests:** (a) a Booking stay with stored tax 0 and the complement collected before arrival: shop = judge = quote = commit, and only `finalPrice` plus its complement move. (b) A stay started yesterday and not marked: a direct stay with its solde due has an open shop and orders on the end-of-stay complement, and a platform stay reads « Ajouter à ma note », `collectAt: 'departure'`.

**H2. Removing an order at the SAS moves the stay's free bath minutes onto another order's session. Neither the stay's money, nor the other order, nor its card money follow.** Sources: bath H1 and sas-ui M1, same root. Branch design (1e4c5fc3: `within` rewrites only the amended order).
- **Where:** `midStayOrderCommit.js:706` (`measureAmend`), `:556` (`withoutOrderLine`); `arrivalOrdersController.js:310-321` (`within`, `Math.max(0, …)`); `:134` (`toCollect` = Σ snapshots) and `:144` (`recapNote`).
- **Card case, 22308:** removing the free 0 € order A drops `finalPrice` 634 → 604. Card order B (paid 50) is now sold for 20, and nothing is flagged « à rembourser ».
- **Note case:** removing a 20 € order moves `finalPrice` by −50. The remaining order still reads 30 € « À régler à l'arrivée » while the complement asks 0.
- **SAS:** the step reads 170 € « à percevoir » while the recap total is 140 € (sas-ui shadow run). The guest still sees B at 50 €, with no « Modifiée à votre arrivée ».
- **Fix:** pin the free minutes to the session they were granted with (preferred). Otherwise, in the same transaction, re-measure every standing order holding that key in creation order: rewrite their snapshots and `amendmentsJson`, and `flagBasketRefund` card money above the new sale. As a minimum guard, refuse (409) an amend whose measured decrease on a key exceeds what the amended order holds on it. Have `toCollect` and `recapNote` read the money the stay holds, not stale snapshots.
- **Test:** `guest-app-sas-free-allowance-shift`: two bath orders, the free one first, card and note variants, remove the free one. `finalPrice` moves by its own total only (or the call is refused). The other order's snapshot, the SAS `toCollect`, the recap note and the guest `/orders` view agree. No over-paid card order is left without a refund flag.

### MEDIUM

**M1. A SAS amend that removes a bath session drops, and never creates, the evening supplement.** Sources: bath M2 and money LOW 2 (raised to MEDIUM: the guest and the SAS say 0 € while 20 € are collected).
- **Where:** `arrivalOrdersController.js:243-262` (`withCharges` only scales an existing charge).
- **Repro:** [21-22, 20-21] quoted 70; removing either session gives order 0 € and complement 0, yet `GET /sas` hourly `supplement = 20`, which the commit bills under a label never announced. Same for [12-13, 20-21]: the free hour moves to 20 h, the order reads 0 €, and the recap adds « supplément soirée 20 € ».
- **Fix:** after the measure, recompute `orderSupplement({ sessions: left, lineGain })` for the kept sessions, allowing a charge to be created as well as lowered.
- **Test:** both scenarios. This also kills mutants B12 and B28.

**M2. On a platform stay, an article already on the fiche with `inComplement 0` (breakfast, linge, ménage bought inside the platform price) is offered by the shop, the judge and the J-7 flags, then refused at commit.** Source: money MEDIUM 1. The probe of the earlier fix (1d379b7f, review d LOW 4) cannot see this class.
- **Where:** `midStayOrderCommit.js:110-150` (`withBreakfast`/`withOption` keep the stored explicit `inComplement: 0`); probe at `:303-310`.
- **Repro:** linge on 22270 → `ORDER_STAY_PRICE_MOVED`; ménage on 22308 → `ORDER_OFF_ARRIVAL_COMPLEMENT`; breakfast on 22196/22198. The judge says `arrival` in every case. 25 such lines exist in prod.
- **Fix:** write the order's units as their own complement-routed portion (a separate line or split units), never flipping the stored line's flag. Failing that, the per-article judge marks such an article (and its mornings) « à commander sur place » for that stay.
- **Test:** quote, commit and shop answer for linge and breakfast on a platform stay holding them at `inComplement 0`.

**M3. Rule 98's flag rewrite refuses scheduling the bath hours a platform stay bought inside its price.** Source: money MEDIUM 2. **Caused by the earlier fix 1d379b7f** (review d MEDIUM 1, `midStayOrderCommit.js:163-167`).
- **Repro:** 22308 holds a priced 2 h bath line at `inComplement 0`. The slots say « Compris dans votre séjour », but quote and order 12-14 h → 409 `ORDER_OFF_ARRIVAL_COMPLEMENT`, and the J-7 promises the bath. With the rewrite removed (mutant X22), the same order → 200 at 0 €.
- **Fix:** flip the flag only on a stored line that bills nothing (0 €, or the order's own earlier line). Keep a priced platform line's flag, and route hours beyond it to a complement-routed line.
- **Test:** a priced platform bath line at 0: placing its included hours → 200, 0 €; one more hour → priced in the complement.

**M4. A stay whose bath line is `offered` on the fiche is shown paid bath hours that every order refuses.** Source: bath M3.
- **Where:** `midStayOrderCommit.js:152-172` (the merge keeps `offered: 1`), `ordersController.js:333`, `shopController.js:332`.
- **Repro:** 22303 (offered line): after the held hour is placed, the picker shows « 30 € » and « 50 € · tarif soirée », and every order → 409 `ITEM_UNAVAILABLE` « contactez l'équipe ».
- **Fix:** hours beyond the offered line's `quantity` go to a separate, billed line (the offered flag covers the held hours only). Otherwise the picker stops pricing slots on such a stay.
- **Test:** an offered bath line plus one paid session, quote and order, on a direct stay and on a platform stay.

**M5. The arrival-complement detail, its collected split and the SAS arrival recap are not net of card-paid orders.** Sources: money MEDIUM 3 and sas-ui L6 (same root), plus surviving mutants money X15/X16/X17 and regression A15/A12/A11.
- **Where:** `reservationsModel.js:249-342` (`arrivalComplementDetailFromReservation`), `utils/complementPaidSplit.js:56-115`, `plugins/sas/arrivalRecap.js` (no `midStaySettledNotes` reading).
- **Repro (22308, card cider 13 + note planche 17):**
  - The detail sums to 30 against an amount of 17.
  - The recap lists the paid cider as billed and offerable: its lines sum to 140 against a total of 127.
  - When the complement is collected, the planche is credited 9,63 instead of 17 and the cider 7,37 more, which distorts refunds (D15 cap) and the VAT ventilation.
- **Fix:** subtract `arrivalPrepaid(notes).byKey` per key in the detail and in the split basis, as `pricing.js:3028-3050` does. The recap shows a server-worded, non-offerable row « Déjà payé par carte (commandes Mon séjour) − 13,00 € » (or marks the line « Payée par carte »), so the rows add up to the total.
- **Tests:** the detail sums to the amount with a card order; the stamped split credits only the note line; in the recap, Σ rows = total. One assertion each for X15/X16/X17 (A11/A12/A15).

**M6. A card-paid line can be offered at the SAS or removed from the fiche: the money stays kept, and nothing is flagged « à rembourser ».** Source: money MEDIUM 4 (sas-ui L6 shows the same « Offrir » on the cider).
- **Repro:** offering the paid cider gives `totalPrice 0` with the 13 € still collected. In the mixed case, its 13 € silently nets against the unpaid planche. `PUT` without option 18 gives `finalPrice` −13 with no trop-perçu.
- **Fix:** card-paid lines are not offerable in the SAS recap. The fiche save and the SAS offer refuse lowering a line below what its arrival notes collected, or `flagBasketRefund` the difference (rule 85/91).
- **Test:** offering a card-paid line and removing one.

**M7. A stay cancelled after an over-payment flags only the over-payment, never the order's own money.** Source: money MEDIUM 5.
- **Where:** `utils/basketPayments.js:66-72` (`flagBasketRefund` returns false when already `refundOwed`), `plugins/guest-app/index.js:136-139`.
- **Repro:** a 3 € excess is flagged, then the stay is cancelled. The link stays at `refundCents 300` with no history line, while the guest is owed 13 €.
- **Fix:** make `flagBasketRefund` merge: raise `refundCents` to the full amount paid and write the history line.
- **Test:** excess first, then cancellation → `refundCents` = amount paid.

**M8. A card order on the earliest reachable cold slot is refunded when the payment lands minutes later.** Source: bath M4.
- **Where:** `ordersController.js:707-715` (`sessionsStillFree` with `heatFrom: at` = the payment instant).
- **Repro:** at 16:55 the picker offers 21-22. Paid at 17:05 → `paid_conflict`, `refundOwed`, though the slot was still free.
- **Fix:** at payment, judge heat from `order.createdAt`, when the hold began.
- **Test:** the first reachable cold slot, paid 10 min later, ends `paid`.

**M9. Two consecutive hours cannot be booked from the slot picker.** Source: bath M5.
- **Where:** `apps/guest/src/pages/SlotPickerPage.jsx:58` sends one session per slot; `hourly-resources/scheduler.js:123` applies turnover between the sessions of the same request.
- **Repro:** picking 20 h and 21 h sends [20-21, 21-22]. The quote says « vient d'être pris », and the order → 409 `SLOT_TAKEN`. One 20-22 session is accepted (70 €).
- **Fix:** merge adjacent picks of one day into one session, server-side in `judge` before validation (and client-side). Refuse an overlapping pick with wording that does not blame another guest.
- **Tests:** server: [20-21, 21-22] is priced as 20-22. Guest app: two adjacent picks send one session.

**M10. The J-7 promises « programmer votre séance de bain nordique » when no bath slot can be offered in the stay.** Source: shop-email MEDIUM 1. M3 creates the same dead promise on platform stays.
- **Where:** `plugins/guest-app/index.js:160` (`emailFacts.bath` = hours or free minutes left, without asking the scheduler).
- **Repro:** bath `closedDays` covers the stay, or a 21:30 check-in on a one-night stay: the slots are all « Fermé », and the preview still renders the bath sentence.
- **Fix:** `bath` = hours or free minutes left **and** `scheduler().slotsForStay({ …, now, heatFrom: now, canIgnite })` has at least one bookable slot (the picker's own producer). Record it in rule 89.
- **Test:** `guest-app-email-flags`: a bath closed on every stay day, and the late check-in → `hasStayAppBath` false, `hasStayAppShopOnly` true.

### LOW

**L1. An amended order's status label follows `payment`, not its amended total.** Sources: bath M2 tail, money LOW 2 tail, security (plausible, **confirmed on code**: `arrivalOrdersController.js:109` derives `statusLabel` from `order.payment`; `ordersModel.amend` never updates `payment`). A note order amended to 0 € still reads « À régler à l'arrivée ». A `none` order raised past its free units reads « Offert » while its amount is collected. **Fix:** derive the label (SAS and guest `orderLabels.statusKey`) from the amended total: 0 → « Offert », > 0 unpaid → « À régler à l'arrivée ». Or update `payment` in `amend`. **Test:** both directions.

**L2. The cent drift of rule 96 is postponed, not removed.** Source: money LOW 1. Partial earlier fix f3ceff19 (review c LOW 3). A merged line stored at 3 units / 20,48 is rewritten to 20,49 by the next unrelated priced save (`pricing.js:972`, `:2069`). **Fix:** an ordinary save keeps a locked line's stored total when its units did not change (or store a unit price such that units × unit = total). **Test:** order on a raised line, then an unrelated +5 € save → `finalPrice` +5,00 exactly.

**L3. The arrival note of an evening charge stores a lower-case label** (« bain nordique — supplément soirée »). Source: money LOW 4. Where: `reservationsModel.js:3018`; `settlePaid` passes no label. **Fix:** pass the charge's label into the note item.

**L4. A card bath order paid after a later note order on the same line gets a note reading « Bain nordique 1 × 20 € » for an evening supplement.** Source: bath L6. Where: `midStayOrderCommit.js:434` (`settlePaid` takes byKey in order). Related to the earlier fix 1d379b7f (« a card note states the true unit price »). **Fix:** settle by the order's own lines and charge, which gives « Bain nordique — supplément soirée 20 € ». **Test:** the `pend.js` scenario.

**L5. Refusal wording misnames the cause.** Sources: bath L7 and shop-email L3 (the refusal half). These are the quote reasons in `availability.js:187/298` and `ordersController.js:188`:
- a session after check-out or after the stay reads « Fermé ce jour-là », where it should say « hors de votre séjour »;
- an off-grid start reads « Durée impossible », where it should say « Ce créneau n'est pas proposé »;
- a same-request overlap reads « vient d'être pris ».
- The delivery refusal in `refusals.js:61/120` says « n'est plus possible » for times never offered. It should say « Cet horaire n'est pas proposé. » and keep « plus possible » for expired times.

**Fix:** map each cause to its wording. **Test:** pin each wording.

**L6. An unpaid card hold counts as warmth: later slots skip heat-up and ignition, and stay sold cold if the hold lapses.** Source: bath L8. Where: `occupancyModel.js:102`, `availability.js:126`. **Fix:** holds count as occupancy, not as warmth. Amend rule 79. **Test:** a hold on 16-17 does not make 17:15-19 h bookable.

**L7. On the real stored J-7 the paragraph is glued into « Nous préparons tout pour vous accueillir. ».** Source: shop-email LOW 1. Where: `specs/guest-app-livret/import.mjs:106` (`atAnchor`). **Fix:** insert at the start of the anchor's line, after a leading `{{/if}}`. **Test:** a production-shaped body (`…accueillir. Une question ?…`).

**L8. The delivery picker labels empty days « Complet », past days included. The bath picker shows past days as « Fermé ».** Source: shop-email LOW 2 (mutant Q survives). Where: `serviceHours.js:197-205`. **Fix:** list from max(arrival, today), and give the real reason (« Service fermé » / « Plus d'horaire ce jour »). Apply the same past-day cut to the bath picker. **Test:** pin the reason and no past day.

**L9. The delivery picker layout differs from the validated mock** (day chips plus the chosen day's grid, against every day stacked). Source: shop-email LOW 3 (layout half). Where: `apps/guest/src/components/DeliveryTimeChips.jsx:21-31` against `specs/guest-app-j7-resume.html:476-486`. **Fix:** render the day chips plus the chosen day's times (or update the mock and record the choice).

**L10. The J-2 paragraph promises « la boutique et le bain » under `hasStayApp` alone.** Source: shop-email LOW 4. Pre-existing, outside the diff, on the neighbouring path. Where: `import.mjs:112`. **Fix:** split the sentence on `hasStayAppShop` / `hasStayAppBath` / `hasStayAppShopOnly`.

**L11. The SAS cannot remove one session of a multi-session bath line, nor one breakfast morning (rule 87).** Source: sas-ui L1. The server accepts `removeSessions` and `removeMornings` (`arrivalOrdersController.js:154-156, 203-232`), but no client sends them. **Fix:** the server emits one sub-row per session or morning with a `removeKey`, and `SasArrivalOrdersStep` sends `removeSessions` / `removeMornings`. **Tests:** a client test, and a server test with two sessions and one removed (the charge recomputed, see M1).

**L12. A SAS bath row hides its unit price (R5 « true unit price »).** Source: sas-ui L2. Where: `arrivalOrdersController.js:88-90`. **Fix:** « 1 h × 30 € · + 20 € soirée », and « 2 h × 30 € ». **Test:** in `guest-app-sas-orders-view`.

**L13. The orders list opens folded when the only unpaid orders are 0 € orders.** Source: sas-ui L3. Where: `SasArrivalOrdersStep.jsx:111`. **Fix:** the server sends `expanded` (any editable or unpaid order). **Test:** one `Offert` order with `toCollect 0` is unfolded.

**L14. On a single-line order, the line's « Retirer » cancels the order with no confirmation. The line remove has no test (mutant U2 survives).** Source: sas-ui L4. Where: `SasArrivalOrdersStep.jsx:66-68`. **Fix:** route the last line's remove through `ConfirmDialog`, or show only « Retirer la commande ». **Test:** the payload sent, and the confirmation on the last line.

**L15. The hint « Comprises dans le complément d'arrivée. » also covers card-paid orders.** Source: sas-ui L5. Where: `SasArrivalOrdersStep.jsx:129`. **Fix:** a server-worded hint: « À percevoir avec le complément d'arrivée. » for unpaid orders, and « Déjà payées par carte. » when all are paid.

**L16. The guest's order timeline contradicts the chip, and an order cancelled at the SAS loses its lines.** Source: sas-ui L7. Where: `apps/guest/src/components/OrderTimeline.jsx:22` draws « Sur votre note » for `collectAt: 'arrival'` and for cancelled orders, and `amend` stores `lines: []`. **Fix:** the timeline reads `statusLabel` / `collectAt` / status. Keep the removed lines in the guest view, marked « Retiré à votre arrivée ». **Test:** `OrderTimeline` for `collectAt: 'arrival'` and for `cancelled`.

**L17. The arrow keys move the payment choice but not the focus (roving tabindex broken; mutant U5 survives).** Source: sas-ui L8. Where: `apps/guest/src/components/PaymentChoice.jsx:39-44`. **Fix:** focus the newly checked row. **Test:** ArrowDown moves both `aria-checked` and `document.activeElement`.

**L18. Orders stay standing when a stay is cancelled, superseded or deleted without its event reaching the plugin, and a card-paid order is never flagged (rules 72/88).** Source: security L1. Where: `plugins/guest-app/index.js:130, 326-330`; `utils/supersededDuplicates.js:111`. **Fix:** a reconciling sweep at activation and boot, and in the per-minute `order-expiry` job. It runs `cancelOrdersOf` for every standing order whose stay is missing or no longer `kind = 'reservation'`. **Test:** cancel with the plugin inactive (and through `setAsideDuplicates`), sweep → orders `cancelled`, link `refundOwed`.

**L19. Note orders have no per-stay limit. Since J-7, a platform lookup is enough to write the fiche.** Source: security L2. Where: `rateLimiters.js:40-49`. **Fix:** key a note-order limiter on the stay (`guest-stay-note:<id>`, 10 per hour, like rule 57). The figure is the owner's call. **Test:** N+1 note orders from N sessions → 429.

**L20. Public read routes now run full dry-run saves** (`GET /shop` 44 ms, slots 42 ms, quote 119 ms, against 2-7 ms before). Source: security L3. **Caused by the earlier fix 1d379b7f** (the rule-101 probe in `orderCollection`). **Fix:** memoise `orderCollection` per stay, keyed on the row's `updatedAt` plus the last order change, or run the probe only on write paths and the e-mail flags.

**L21. An amend that changes nothing (`{}`, or the same quantity) writes the fiche, journals « sans changement » and shows the guest « Modifiée à votre arrivée ».** Source: security L4. Where: `arrivalOrdersController.js:150-161, 300-330`. **Fix:** when `changed.changes` is empty and no charge moved, return the current `ordersAtArrival` before `commit.amendOrder`. **Test:** `{}` and a same-quantity body write nothing.

**L22. The refund history line repeats itself:** « …: séjour annulé : commande client #3 à rembourser, à rembourser depuis l'espace du prestataire ». Source: regression LOW 2. **Fix:** pass `reason: 'séjour annulé, commande client n° N'` in `cancelOrdersOf`, and share the text helper with `paymentPollRunner:199-210`. **Test:** pin the text.

**L23. Rule 37, the changelog fragment, hourly-resources manifest 1.6.0 and `resource-supplements-total-server-side.md` §4.1 announce a fiche price change (35 → 45 €) that the fiche and the booking preview do not make.** Source: regression LOW 1. **Caused by the earlier fix 2ca4566c.** The operator would read the false claim in the release notes. **Fix:** reword them: the free minutes' day value applies only to the app's evening charge, and the fiche line and outside bookings are unchanged. Restore §4.1. **Test:** a contributor test pinning 19-21 h at 35 €.

**L24. After a breakfast order at 08:30, the next ordinary fiche save rewrites the morning to 09:00.** Source: money's « outside my dimension » note, observed in its `noopDiff` on 22308. PLAUSIBLE: not reproduced by the consolidator. **Fix:** confirm with a test (order at 08:30, then a no-op save keeps 08:30). If it reproduces, keep the stored delivery time in the save path.

**L25. Test gaps: surviving mutants on behaviour that holds today.**
- Money: X6 = A8 (`refunds.js:676` `withArrival`; proven harmful: the cancellation refund is booked on « Ménage »).
- Regression: A4 (`bookingLinesModel.js:193` charge-label fallback).
- Bath: B7 and B8 (`ordersController.js:288` `covered` with held hours and free minutes), B26 (`firstBathSlotToday` gated on `shop.open`).
- Security:
  - S8 (`ownOrder` stay check);
  - S19 (reception matcher for `/guest-app/orders/:id/amend`);
  - S13 (amend `quantity < 0`);
  - S10 (`create` openness → `ORDERS_OPEN_ON_ARRIVAL`);
  - S20 (a delivered card order of a cancelled stay is flagged).
- Mutants counted in other items: X15/X16/X17/A11/A12/A15 in M5, B12/B28 in M1, Q in L8, U2 in L14, U5 in L17.

## Owner checklist

| Line | Status | Evidence / blocking items |
|---|---|---|
| R1 J-7 e-mail | **NOT PROVEN** | Proven: the real `import.mjs` applied to the prod J-7/J-2 templates, preview FR/EN text and HTML; no app name and no payment word; shop-only sentence when the bath is unsold; no paragraph when the shop is `unavailable`; every `email_templates` column but `body`/`bodyEn`/`updatedAt` identical, so `sendMode` is unchanged (mutants A-D, I, R killed). Failing: M10 (bath sentence with no bookable slot), M3 (the e-mail promises unschedulable included hours), L7 (paragraph glued). |
| R2 From J-7, not before; D28 | **PROVEN** | J-7 link and lookup → `preArrival`, shop open. J-8 → `visitor`, shop, slots and delivery 404 `MODULE_OFF`. DST boundaries 22:59:59Z / 23:00:00Z. The D28 direct number → generic 404; GdF lookup opens. Mutants E, J, P, S6, S7, S17, S18 killed. |
| R3 Shop days and times | **PROVEN** (LOW L5, L8, L9 remain) | Delivery days arrival → departure only; check-in + lead; before check-out; closing gap and exception days excluded. 12 crafted times → 409 `DELIVERY_TIME_UNAVAILABLE` with nothing written. Valid times commit on `finalPrice` and the complement only. Mutants G, K-O killed. |
| R4 Nordic bath | **NOT PROVEN** | Proven separately: stay days and presence; bath hours, days and closed days; free time vs evening; heat from now and retention; other bookings and holds; crafted refusals (15 requests); slots hidden when the shop is unavailable. 23/28 mutants killed. Failing « all combined »: H2, M1, M3, M4, M8, M9, L6. |
| R5 SAS list | **NOT PROVEN** | Proven at 1280 and 390 px (screenshots in `sas-ui/shots/`): collapsible list; groups with number, delivery label, chip and total; « 2 × 6,50 € » rows; 10+ orders and long labels; 0 € order reads « Offert »; no step when there is no order. Failing: H2 (totals vs recap), L12 (bath unit price), L13 (fold), L1 (label after amend). |
| R6 SAS edits | **NOT PROVEN** | Proven: ± quantity re-priced by the server (±6,50 / ±17 on `finalPrice` and the complement); line and order removal; stock and slots released; journal; guest « Modifiée à votre arrivée »; paid orders read-only (409); reception limited to its arrival day, journaled; crafted input refused. Failing: H2, M1, L11, L14, L21. |
| R7 Card from J-7 | **NOT PROVEN** | Proven: « Payer par carte » first, preselected, uniform rows; real basket-link and poll path with a faked provider (`finalPrice` +13, complement +0, arrival note); a card order is never counted in « à percevoir ». Failing: M5 (detail, split and recap not net), M6 (a paid line can be offered or removed). **Cannot be proven offline:** the real Qonto provider. |
| R8 Cancellation | **NOT PROVEN** | Proven on the direct path: orders `cancelled/stay`; link `refundOwed`; history; ledger « Commande client à rembourser »; 706/4457/4671 net 0 on the merged tree; the guest's session ends and « Séjour annulé » shows. Failing: M7, L18, L22, and the X6/A8 keying (L25). Not run but provable offline: the platform (iCal alert) cancellation path; add a test. **Offline-impossible:** the real provider refund. |
| R9 Money | **NOT PROVEN** | Proven: 662 exact commits on every platform mode, note and card; tax, acompte, solde, commission, payout and plan untouched; ordinary saves byte-identical (63 stays × 3 saves, 36 bath quotes, 58 SAS reads); `exactMergedTotals` stripped. Failing: H1, H2, M1 to M4 (the judge promises what the commit refuses), M5, L2 (a cent at the next save). |
| R10 Security | **PROVEN** (LOW L18 to L21 and L25 remain) | Capability link only from J-7; plugin inactive → 404 `PLUGIN_INACTIVE`; `exactMergedTotals`, `beforeArrival`, `orderGrowth` and note `moment` are not settable over HTTP; no IDOR (cross-stay read and abandon → 404; reception confined); `__proto__` / `constructor` → 400; numeric parsing table; refusals leak no data; limiter chains unchanged. |

## Remaining items for one coder pass (each with its fix)

0. Merge `origin/inte/plugins` (e27229aa, #1014) into the branch first. It merges cleanly; then re-run R8's cancellation money on the merged tree.
1. H1: pre-arrival path iff the stay has not started and the arrival is not marked. A started, unmarked stay takes the mid-stay path (baseline captured). A stay not started with its complement collected → `unavailable`. Apply in orderCollection, priceOrder, commitOrder, amendOrder and the e-mail flags, plus rules 66/68 and both tests.
2. H2: pin the free bath minutes to the session they were granted with (or re-measure every order on that key in the same transaction, re-snapshot them and flag card excess). Refuse any amend that gives back more than the order brought. `toCollect`/`recapNote` read the stay's money. Add the test `guest-app-sas-free-allowance-shift`.
3. M1: recompute `orderSupplement` for the kept sessions after the amend measure, allowing the charge to be created or lowered. Add the 2 scenarios.
4. M2: write an order's units on a platform line stored `inComplement 0` as their own complement-routed portion (never flip the stored flag), or have the judge mark that article « sur place » for that stay. Add tests for linge and breakfast.
5. M3: rule 98 flips `inComplement` only on a stored bath line billing 0 €. A priced platform line keeps its flag, and extra hours go to a complement-routed line. Add a test for included hours → 200 at 0 €.
6. M4: bath hours beyond an offered line's quantity go to a billed line (or the picker stops pricing them). Add tests on a direct and a platform stay.
7. M5: net `arrivalPrepaid.byKey` in `arrivalComplementDetailFromReservation` and in the `complementPaidSplit` basis. Add a recap row « Déjà payé par carte − X € » (not offerable). Tests: Σ rows = total, the split credits the note line, plus X15/X16/X17.
8. M6: card-paid lines are not offerable at the SAS. The fiche save and the SAS offer refuse lowering a line below its collected arrival notes, or flag `refundOwed` for the difference. Add both tests.
9. M7: `flagBasketRefund` merges into an existing flag, raising `refundCents` to the full amount paid on a cancelled stay, with a history line. Add the excess-then-cancel test.
10. M8: at the card payment re-check, judge heat from `order.createdAt`. Test: first cold slot paid 10 min later → `paid`.
11. M9: merge adjacent sessions of one day into one before validation (server `judge`, and the picker). Use non-blaming wording for overlaps. Add server and guest tests.
12. M10: the e-mail `bath` flag also requires at least one bookable slot from `scheduler().slotsForStay`. Update rule 89 and the closed-days / late check-in tests.
13. L1: derive the SAS and guest status label from the amended total (0 → Offert, >0 unpaid → À régler), or update `payment` in `amend`. Add tests.
14. L2: an ordinary save keeps a locked merged line's stored total when its units are unchanged. Test: an unrelated +5 € save adds exactly 5,00.
15. L3: pass the charge's label into the evening-charge arrival note item.
16. L4: `settlePaid` settles the paid order's own lines and charge, not byKey order. Add the `pend.js` test.
17. L5: give each crafted refusal its true wording (hors séjour, « Ce créneau / Cet horaire n'est pas proposé », no « vient d'être pris » for self-overlap). Pin the wordings.
18. L6: card holds count as occupancy, never as warmth. Amend rule 79 and add the test.
19. L7: insert the J-7 paragraph at the start of the anchor's line (after a leading `{{/if}}`). Add a prod-shaped body test.
20. L8: list delivery days from max(arrival, today) with the real reason (Service fermé / Plus d'horaire ce jour), with the same past-day cut in the bath picker. Add a test that kills Q.
21. L9: render the day chips plus the chosen day's time grid as in the mock (or update the mock and record the choice).
22. L10: split the J-2 sentence on `hasStayAppShop` / `hasStayAppBath` / `hasStayAppShopOnly` (pre-existing, neighbouring path).
23. L11: the server emits per-session and per-morning sub-rows with a `removeKey`, and the SAS step sends `removeSessions` / `removeMornings`. Add client and server tests.
24. L12: SAS bath rows read « N h × 30 € · + 20 € soirée ». Add a test in `guest-app-sas-orders-view`.
25. L13: the server sends `expanded` = any editable or unpaid order, and the step uses it. Add a test for an Offert-only order.
26. L14: a single-line order's last-line remove goes through `ConfirmDialog` (or only « Retirer la commande » shows). Add a test that kills U2.
27. L15: server-worded orders hint: « À percevoir avec le complément d'arrivée. » / « Déjà payées par carte. ».
28. L16: `OrderTimeline` reads `statusLabel`/`collectAt`/status (no « Sur votre note » before arrival or when cancelled). Keep removed lines shown « Retiré à votre arrivée ». Add tests.
29. L17: `PaymentChoice` moves focus to the newly checked row on arrow keys. Add a test that kills U5.
30. L18: a reconciling sweep (activation, boot, per-minute `order-expiry`) runs `cancelOrdersOf` on standing orders whose stay is missing or not a live reservation. Add the inactive-plugin and superseded tests.
31. L19: add a per-stay note-order limiter (`guest-stay-note:<id>`, 10 per hour unless the owner sets another figure). Test: N+1 orders from N sessions → 429.
32. L20: memoise `orderCollection` per stay on `updatedAt` plus the last order change (or run the probe only on writes and e-mail flags).
33. L21: an amend with no change returns the current `ordersAtArrival` without committing, journaling or `amendedLabel`. Add a test.
34. L22: `cancelOrdersOf` reason becomes `séjour annulé, commande client n° N`. Share the refund-owed text helper with `paymentPollRunner`, and pin the text.
35. L23: reword rule 37, the changelog fragment and the hourly-resources 1.6.0 manifest line (day value applies only to the app's evening charge), and restore §4.1 of `resource-supplements-total-server-side.md`. Add a test pinning 19-21 h at 35 €.
36. L24: add a test for a breakfast order at 08:30 followed by a no-op fiche save. If the time moves to 09:00, keep the stored delivery time in the save path.
37. L25: add one test per surviving mutant X6/A8, A4, B7, B8, B26, S8, S19, S13, S10, S20.
38. Specs and changelog: update `specs/guest-app.md` (rules 66, 68, 79, 85, 87, 88, 89, 98, 101 and others touched), the hourly spec and the `changelog.d/` fragments in the same pass. Re-run the server, client, guest, E2E, `check-spec-coverage` and `check-plugin-versions` gates on the merged tree.
VERDICT: NOT READY
