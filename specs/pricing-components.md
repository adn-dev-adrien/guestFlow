# Pricing components — unit pricing and collection components

| Field | Value |
|---|---|
| **Status** | In progress — PR A (units, byte-identical) of 3; approved 2026-11-11 (owner), rules 1-74, §4.0, Q1-Q15 resolved; implementation targeted at 4.1.0 |
| **Branch** | `feature/pricing-components` _(user-managed; to be cut from `inte/plugins`)_ |
| **Created** | 2026-11-11 |
| **Revised** | 2026-11-11 — owner decisions: discounts on nights and extras, "started" = arrival date and check-in time passed, tourist tax as its own component, finer cut, 3 PRs; the stay clock as its own component consulted by all (rules 44-46); one pricer per article kind, fulfilment and data-access ports, settings provider, VAT per line by customer context, chainable pipeline steps, external sale (rules 47-60, §4.0); Articles head → generic families → instances, VAT as a standalone component fed by tagged amounts, `AccountingOutput` with format adapters, the no-duplication rule (rules 61-67); price non-regression gate and delivery pipeline with the stabilisation loop (rules 68-69); platform payment and platform intakes from the code check (rules 70-71) |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary for the owner** | [`specs/pricing-components-resume.html`](pricing-components-resume.html) — French, interactive |
| **Supersedes (on completion)** | the pricing/collection half of `guest-app.md` §4.4 (rules 85, 93-101, and the code-only 104-106), `utils/midStayOrderCommit.js`; `arrival-moment-is-the-check-in.md` for the routing of new sales (rule 20) |
| **Builds on** | `pricing-engine-thin-client.md`, `reservation-price-arithmetic.md`, `force-extras-complement-on-platform.md`, `mid-stay-extras-to-end-of-stay-complement.md`, `platform-payment-entry.md`, `direct-installments.md`, `mixed-method-payments.md`, `single-vat-rate.md`, `vat-optional-mode.md` (golden fixture and prod-copy proof), `tourist-tax-included-services-deduction.md` |

> Code references point at `feature/guest-app-from-j7` @ `38c2732a` (= `inte/plugins` `e27229aa` plus the
> unfinished J-7 branch). Line numbers drift; function names are the anchors. Rule numbers are identities:
> rules amended by the 2026-11-11 revision keep their number and say so; new rules are appended (37+).

---

## 1. Context

### 1.1 The owner's request (2026-11-11)

> « nous avons un problème avec l'architecture de cette application séjour dans le core. Car la partie calcul
> de prix pour la boutique de séjour doit être dans un composant à part de celui des nuits et de la taxe de
> séjour. La résa doit accéder à ce composant pour le calcul des ventes annexes à la nuit. Enfin nous
> devrions avoir un dernier module qui est capable de prendre plusieurs prix fournis par les composants
> article annexe et calcul de nuit et qui les additionne et prend en charge les éventuelles réductions. Un
> dernier composant s'occupe du paiement fractionné ou solde ou avec acompte. […] Une fois que tu auras ces
> composants tu pourras envoyer tes données soit depuis la boutique pour faire un calcul de montant à payer
> soit en direct via un lien Qonto soit l'ajouter en fin de séjour, mais dans les 2 cas tu ajoutes une ligne
> dans résa qui est soit payée soit à payer (en fin ou début de séjour suivant si le séjour a débuté ou non).
> Dans tous les cas je veux le détail dans la fiche de résa comme dans les sas check-in et check-out. Pour la
> partie dans la fiche de résa, si l'utilisateur ajoute manuellement des produits, on passe par les mêmes
> composants et même principe. »

Second message, same day:

> « pour que le découpage soit pertinent, si tu vois d'autres choses qu'on peut isoler fais-le. Le but est
> d'avoir des composants unitaires et maîtrisables. Tu peux aussi sortir le calcul de la taxe de séjour à
> part. Avec le moins de PRs possible. »

Plus five decisions: discounts apply to nights **and** extras; a stay is started once the arrival **date and
check-in time** have passed; an unpaid line's moment may be changed (journaled); shop card payment on a
platform stay before arrival is allowed through a separate Qonto link; every other question follows the
recommendation (§9).

### 1.2 What the code does today: one engine does every job

`server/src/utils/pricing.js` → `calculateReservationQuote` (l. 1400-3370, ~1 970 lines, ~120 inputs, 137
output keys) is the only price engine. In one synchronous pass it:

| Order | Lines | Job | Target component (§3.A) |
|---|---|---|---|
| 1 | 1585-1612 | reads the property, the VAT regime (`vatRegimeModel.forRow`), the `pricing_rules` from the DB; `calculateBaseStayPrice` (l. 1230) | NIGHTS (+ DB reads → LOADER) |
| 2 | 1663-1733 | channel (`saleChannel`), persons, free-unit grants, catalogue maps, locked nights merge | NIGHTS / ALLOWANCES / EXTRAS |
| 3 | 1736-1784 | extra guests (`computeExtraGuestSurcharge` l. 782, `splitExtraGuestCount` l. 762) | EXTRA GUESTS |
| 4 | 1788-1799 | discount %, `customPrice`, cancellation-insurance base | DISCOUNTS / EXTRAS |
| 5 | 1816-1836 | **routing:** `forceExtrasToComplement = channel.platformSale`, `resolveInComplement` | **SETTLEMENT, inside the price lines** |
| 6-8 | 1838-2299 | option, custom, baby-bed, auto (early/late) and resource lines; plugin contributor `priceLineContributors.priceLine` (l. 2195) | EXTRAS (+ ALLOWANCES, providers) |
| 9 | 2300-2322 | options/resources totals; **mid-stay split** `resolveMidStaySplit` (l. 2308) | TOTALS + SETTLEMENT |
| 10 | 2324-2426 | platform gross pin: **accommodation back-solved as brut − extra guests − every `inComplement = 0` extra − withheld/reversed tax** | PLATFORM PRICE, reading a SETTLEMENT flag |
| 11 | 2427-2539 | `computeTouristTaxBreakdown` (l. 497), added-guests tax, freeze, reversal | TOURIST TAX |
| 12-13 | 2540-2606 | `finalPrice`, `discountAmount`, VAT split per family, `totalStayPrice` | DISCOUNTS / VAT / TOTALS |
| 14 | 2615-3139 | deposit %, overrides, platform single payment, paid receipts (`readSplitReceived`, **DB**), installment plan (`readInstallmentSummary`, **DB**), due dates (`paymentSchedule`), arrival complement (gap, prepaid card notes, override, excess to mid-stay), end-of-stay complement, `splitComplementBuckets`, net total | SCHEDULE + SETTLEMENT |
| 15 | 3140-3368 | changeover check, `quote` object, headline, non-enumerable `preArrivalSettled` | NIGHTS / COMPOSE |

Around it, collection logic re-derives prices and pricing logic decides collection:

- **Collection re-derives prices:** `arrivalPaymentDetail.billableLines`, `complementPaidSplit.contribSplit`,
  `installmentPaidSplit` pro rata, `accountingModel.computeBucketTtcsFromContribs`/`grossRatio`,
  `paymentsController.resolveAmountCents` (re-runs the engine for a devis), `resolveInstallmentComponents`,
  `ledgerAmountEdit.solveBalance`/`floorPrice` (back-solves `customPrice` cent by cent so a typed solde holds).
- **Extras priced outside the engine:** `sasOptionSale.priceOptionSale` (SAS breakfast/catering),
  `reservationsModel.getBathLinenOfferForReservation`, `resolveSasArrivalItems` (linen pieces),
  `resolveSasDepartureItems` (missing items, cleaning, extinguisher), guest-app `sellable.optionFreeUnits`.
- **The hourly grid has four implementations:** `hourly-resources/pricing.js` contributor (`priceSessions`,
  free minutes at the day rate), `bookingPricing.priceBookingLines` (free time at the banded rate — the
  opposite of rule 37 of the hourly spec), `scheduler.slotsForStay`, and the evening supplement twice
  (`schedulingModel.supplementOf` with a credit worked back from stored line totals,
  `scheduler.orderSupplement` with its own `lineGain` credit).
- **Three "offered" mechanisms:** `applyOfferedToLine` (engine), SAS `offeredExtras`/`cleaningOffered`/
  `bathLinenOffered`, booking `offeredMinutes`.
- **VAT is split in four places:** the engine per family (l. 2577-2597), the export per bucket
  (`accountingModel.bucketFromTtc`), the Qonto items (`paymentLinkItems.buildVatItems`), the hourly bookings
  (`bookingPricing.vatOf`).
- **The platform gross/net arithmetic lives in three places:** the engine's pin, `grossFromNet` (catalogue
  display in `propertiesModel`), `platformPriceCheck.nightsMatchToday`.
- **SAS commits price and settle in one transaction:** `commitArrivalSas` (reservationsModel l. 3313) takes
  sale intents and payment tri-states together; `planArrivalSas` puts the tourist tax and the extra-guest
  surcharge into the complement as lines.
- **Deferral is decided in three places:** `checkoutComplement.isComplementDeferred`, `complementBuckets`,
  the `complementDeferredToCheckout` column.
- **"Has the stay started" has two answers:** the calendar (`startDate <= today`, legacy) and
  `arrivalMoment.hasGuestArrived` (check-in box or arrival SAS), used by `reservationsModel` and
  `midStayOrderCommit`.

### 1.3 Why prices are unstable (the defect classes)

The guest-app « Mon séjour dès le J-7 » branch had to sell an extra into an existing stay. There is no
"price these extras" entry point, so `midStayOrderCommit.js` rebuilds the fiche's whole PUT body
(`storedBody` → `toUpdateBody`) and replays `reservationsController.performUpdate` — the full stay save —
twice as a dry run, then once for real. Every workaround on the branch is the cost of that replay:

| # | Workaround | Coupling it works around |
|---|---|---|
| W1 | `force*` flags (min/max nights, changeover, capacity) | replaying the save re-judges the stay under today's rules |
| W2 | `freshPricing` / `refreshTouristTax` on both measure saves | the stored stay price and tax are not reproducible by today's engine (905 € replayed vs 901,82 € stored; tax 0 vs 19,20 €) |
| W3 | `orderGrowth` / `pinOrderGrowth` / `keepStay` / skipped installment sync | the save has no "add a delta to the totals" mode; the write pins stored columns + growth while the lines are fully re-priced |
| W4 | judge (`orderCollection`) vs measure (`measureBeforeArrival`) and the **probe order** (a fake 1 € line through two dry-run saves on every shop read) | the collection bucket is an emergent output of the whole engine, not a declared rule |
| W5 | `OFF_ARRIVAL_COMPLEMENT`, `STAY_PRICE_MOVED`, Σ byKey = complement growth ± 0,01 | routing can only be observed after the fact, not requested |
| W6 | `inComplement` forcing / rewriting, `heldInStayPrice` | one flag means both "which bucket collects it" and "is it inside the platform price" |
| W7 | `exactMergedTotals` (order-only engine switch, stripped from HTTP bodies) | a line stores a unit price, not its total: merging 1 × 6,50 € with 2 × 7 € re-bills 3 × 6,83 = 20,49 instead of 20,50 |
| W8 | two measure algorithms (arrival pinned, departure via `remainderByKey`) | no single place computes "what does this sale add to what bucket" |
| W9 | `settlePaid` before the write; `orderGrowth.complementAmount − settled`; netting of card notes duplicated in `pricing.js`, `complementPaidSplit.prepaidNetter` and the arrival detail | "paid" lives in a JSON note (`midStaySettledNotes`), not on the line |
| W10 | `pending` orders, `deferredCents`, `PRICE_ROSE` | free units / minutes are a stay-global allowance recomputed by the engine; a later order steals an earlier one's free hour |
| W11 | evening supplement split into an `orderChargeKey` custom line, matched by description | the free hour's supplement cannot survive a line replay |
| W12 | `personsShortfall` re-implements `resolveServedPersons` | the engine silently caps served persons |

The five reviews of the branch (`review-guest-app-j7{,b,c,d,e}.md`) found these defect classes. **The new
architecture must make each of them impossible by construction, not by a guard:**

| Class | Examples from the reviews | Made impossible by rule |
|---|---|---|
| D1. Selling an extra moves the nights, the tax or the platform payout | review a HIGH 2 (`STAY_PRICE_MOVED` on 3/5 Booking stays), d MEDIUM 1, e M2 | 8, 9 |
| D2. Where an extra is collected is guessed, then refused | a HIGH 1 (no OTA stay can order), c MEDIUM 1 (complement override), e H1 (routing keyed on "arrival marked" not "stay started"), e M3 | 18-20 |
| D3. "Inside the platform price" confused with "collected at arrival" | d MEDIUM 1, e M2, e M3, e M4 (offered line) | 15, 17 |
| D4. Cent drift on merged lines, then re-drift on the next save | c LOW 3, e L2 | 12, 13, 40 |
| D5. A free allowance migrates between orders | e H2 (removing the free bath order re-prices another paid order) | 26, 41 |
| D6. Paid money netted in one view and not in another | e M5 (arrival detail, collected split and SAS recap not net of card orders) | 21, 31 |
| D7. A paid line lowered, offered or removed with no refund owed | e M6, e M7 | 23 |
| D8. The same article priced differently by two paths | e M1 (evening supplement dropped at the SAS), hourly grid ×4 | 24, 25 |
| D9. Read paths run full dry-run saves | e L20 (`GET /shop` 2 → 44 ms) | 10 |
| D10. Repairs after the fact | `createdComplementRepair`, `frozenComplementRepair`, `legacyNetSoldeRepair`, `offeredResourceTotalRepair`, `forceExtrasComplementOnPlatformMigration` | 33-36 (byte proof before every behaviour change) |

## 2. Goal

Price the nights, the extra guests, the tourist tax and the extras, apply discounts, split the VAT and decide
how every amount is paid in **small pure components, each with a declared contract and its own test file**,
so that the fiche, the devis, the platform intakes, the SAS and the guest-app shop sell an extra the same
way: one reservation line, priced once, marked paid or to pay at arrival / at departure, shown with the same
detail in the fiche and in both SAS — without ever re-pricing the nights.

## 3. Functional rules

### 3.A The components

1. **Small pure components.** _(amended 2026-11-11: the four owner components are cut into units.)_ Each
   component is a pure synchronous function of its input: **no DB read, no clock read, no settings read
   inside**; `now` is an input. A loader (`models/pricingInputModel.js`) reads the DB once and builds the
   inputs. The owner's four components map to these units:

   | Owner component | Unit | File (`server/src/utils/pricing/`) | One-line contract |
   |---|---|---|---|
   | 1 Séjour | **NIGHTS** | `nights.js` | PR A moves the engine's own names: `calculateBaseStayPrice(rules, startDate, endDate)` → the nightly breakdown, `calculateStayPrice`, `mergeNightlyBreakdownWithLocked`, `matchNightRule`, `effectiveMinNightsOf`, the date helpers (`parseIsoDateParts`, `addDaysToIsoDate`, `diffIsoDatesInDays`) and the progressive-tier helpers |
   | 1 Séjour | **EXTRA GUESTS** | `extraGuests.js` | `computeExtraGuestSurcharge`, `splitExtraGuestCount` (platform brut vs complement), `extraGuestNightSeason` |
   | 1 Séjour | **TOURIST TAX** | `touristTax.js` | `computeTouristTaxBreakdown`, `resolveTaxBase`, `sumIncludedServicesDeduction` (the base and the included-services deduction), `resolveAddedGuestsTouristTax`, `platformCollectsTouristTax`, `touristTaxRemittedByOwner`; it imports no extras (the French formatters it prints with are `money`'s) |
   | 2 Articles | **ARTICLES** (head) | `articles/index.js` | the only interface: `quote({requests[], stayContext?, customerContext, allowance, families}) → {lines[], taggedAmounts[], allowanceUsed, refusals[]}` (`families` = the families live at this instant, an input resolved by the loader), `commit(quoted, tx)`, `release(line, reason)`, `describe(line)` — dispatch, aggregation, refusals, allowance coordination, fulfilment calls; no formula (rule 47) |
   | 2 Articles | **ARTICLE FAMILIES** (sub-components) | `articles/families/{fixed,perUnit,perNight,perPerson,perPersonPerNight,percentOfStay,perParticipantProgressive}.js`; plugin `hourly` | one generic formula per pricing family: `{ id, configSchema, validate(config, request, ctx) → refusals[], price(config, request, ctx) → {quantity, unitPrice, components[], allowanceUsed, amounts:[TaggedAmount]}, describe(config, line) }` — never called from outside the head |
   | 2 Articles | **ARTICLE INSTANCE** (factory) | `articles/makeArticle.js` | `makeArticle(catalogueRow) → Object.freeze({ ref, family, config:{price, label, vatClass, limits, allowance, fulfilment} })` — config only, no code; one instance per catalogue article |
   | 2 Articles | **ALLOWANCES** | `allowances.js` | `consumeAllowance({granted, isDirect, billedUnits, unitPrice}) → {used, amount, chargedUnits, realTotal}`, `releaseAllowance`, `applyFreeUnitsToLine`, `applyPerHourFreeMinutes`, `createFreeUnitsLedger` |
   | 2 Articles | **TIMED OPTIONS** | `timedOptions.js` | the engine-derived early check-in and late check-out options, priced from the actual hour against a reference night of the tariff: `computeAutoTimedOptionContext`, `getLateCheckoutNextNightReferencePrice`, `timeToDecimalHour` (reads NIGHTS only; the head carries its line as a `priced` entry) |
   | 4 Encaissement | **STORED LINES** | `storedLines.js` | the readers of what a reservation stores about its extra lines: `extraLineKey`, `parseNotes`, `parseDetail`, `settledByKey` (imports nothing; SETTLEMENT and REFUNDS read the stored format through it, rule 72) |
   | 2 Articles | **HOURLY TARIFF** (plugin) | `plugins/hourly-resources/hourlyPricing.js` | `priceSessions({grid, sessions[], freeMinutes}) → {base, evening, free, total}` — the only hourly grid |
   | 3 Totaux | **PLATFORM PRICE** | `platformPrice.js` | `resolvePlatformPrice({gross, extraGuestsInBrut, platformLines, withheldTax}) → {accommodation, commission: null, payout: null}`, `grossFromNet` (the engine never computes a commission from a rate, rule 70) |
   | 4 Encaissement | **PLATFORM PAYMENT** | `platformPayment.js` | `commissionOf`, `clampCommissions`, `netReceived`, `acompteNet`, `grossOf`, `payoutWithPenalty`, `withheldOnCancellation`, in euros in PR A — what a platform pays out (rule 70) |
   | 3 Totaux | **DISCOUNTS** | `discounts.js` | `allocateDiscount({discount:{percent?, amount?, customPrice?, target}, accommodation, lines[]}) → {accommodationAdjusted, lineShares{}, total}` |
   | beside the clock | **VAT** (standalone, consulted by all) | `vat/index.js` | `vatOf(taggedAmounts[], {regime, settings}) → {amounts[] with rate, vatCents, netCents; groups[] by (vatClass, rate, customerContext); byRate[]; totals}` — the only place a rate, a VAT or a net amount is computed (rules 51, 61-62) |
   | 3 Totaux | **TOTALS** | `totals.js` | `aggregateTotals(ctx) → {finalPrice, discountAmount, totalStayPrice, vatByRate[], breakdown[]}` — pure aggregation of what the other steps and VAT returned; no formula (rule 51) |
   | — | **ACCOUNTING OUTPUT** | `accounting/accountingOutput.js` + exporters | `journalEntries({from, to}, readModels) → JournalEntry[]` (neutral); exporters `csvJournal`, `salesJson`, `synthesis`, (FEC later) are adapters `export(entries, accountPlan) → file` (rules 63-64) |
   | 4 Encaissement (consulted by all) | **STAY CLOCK** | `stayClock.js` | `phaseOf({arrivalDate, departureDate, checkInTime, checkOutTime}, now) → {phase: 'before'\|'during'\|'after', started, defaultCollectAt: 'arrival'\|'departure', arrivalDayReached, departureDayReached}` — rules 20, 44-46; resolver `phaseForReservation(id, now)` in `models/stayClockModel.js` |
   | 4 Encaissement | **SCHEDULE** | `schedule.js` | `planSchedule({totals, policy, planLines, overrides, receipts, ledger}) → {resolvedDepositAmount, resolvedBalanceAmount, depositDueDate, balanceDueDate, resolvedComplementAmount, endOfStayComplementTotal, …}` (PR A: the engine's own names; `ledger` is `{splitReceived, installmentPlan}`, the two money-received readings as values the caller read from the `PaymentLedger` port; PR B: `installments[]`, `today`) |
   | 4 Encaissement | **SETTLEMENT** | `settlement.js` | `readInComplement({finalOptionLines, resourceLines, extraGuestComplementSurcharge, midStayForced})` and `planSettlement({lines, stayLevel, receipts}) → {complementDetailLines, complementSplit}` in PR A, with `resolveMidStaySplit`, `splitComplementBuckets` and `isComplementDeferred` moved in; PR B: `{lines[], stayLevel, overrides, receipts, refunds, started} → {arrival, departure, paid, refundsOwed, lineStatus{}}` |
   | — | **PIPELINE** | `pipeline.js`, `pipelines.js` | `buildPipeline(steps, {initial}) → run(ctx)`; each step `{ id, requires[], provides[], apply(ctx) → ctx }`; use cases `stayQuote`, `ficheSale`, `sasSale`, `shopSale`, `externalSale` (rules 52-54) |
   | — | **COMPOSE** | `compose.js` | the `stayQuote` pipeline + `shape()` to the 137-key quote (rule 4), including the quote of a halted run (a stay with no night, `halt: true`) |
   | — | **PORTS** | `models/ports/*.js`, plugin adapters | `StayRepository`, `CatalogueProvider`, `PaymentLedger`, `SlotAvailabilityProvider`, `SettingsProvider`, `PaymentGateway`, `EventPublisher` (rule 48) |
   | — | **FULFILMENT** | `articleFulfilment.js` (registry) + plugin adapters | `{ reserve(draft) → hold, confirm(hold, line, tx), release(hold, reason) }` (rule 49) |
   | — | money helpers | `money.js` | `roundMoney`, `sumMoney`, `toCents`, `fromCents`, `allocateCents` (largest remainder, signed weights) and the French formatters `frenchNumber`, `frenchEuros`, `frenchPercent` — not a component (rule 38) |

2. **One direction of dependency.** EXTRAS may read NIGHTS' `context` (nights, persons, nightly prices — for
   per-night / per-person types, percent-of-stay insurance and the late-checkout reference night). TOTALS
   reads the pricing units. SCHEDULE and SETTLEMENT read TOTALS and the stored collection state. No unit
   reads a unit downstream of it. **NIGHTS, EXTRA GUESTS and TOURIST TAX know nothing of extras; no pricing
   unit knows anything of payments.** A static test enforces the import graph.
   _(Delivered by PR A: `pricing-import-graph` ranks every file under `utils/pricing/`, sub-folders included (`articles/` 3.5,
   `vat/` 1, `refunds/` 8: a sub-file takes its folder's rank, imports inside the folder are free, a family never reaches the
   head or the registry), forbids EXTRAS to read TOURIST TAX or EXTRA GUESTS (the early check-in and late check-out options
   are the `timedOptions` unit, rank 3, which reads NIGHTS only), judges a module outside `utils/pricing/` on what it reaches
   (a model, the database, a plugin registry) and on the unit it forwards to, and bans `Date.now()`, `new Date()`,
   `todayIso()` and `process.env` in a unit; its allow-list is empty. Proved on synthetic trees by
   `pricing-import-graph-mutants`.)_
3. **The tourist tax is its own component.** _(amended 2026-11-11.)_ TOURIST TAX owns
   `computeTouristTaxBreakdown`, the added-guests tax, the freeze, the reversal and the platform tax policy
   (`isPlatformCollectingTouristTax`, `isTouristTaxRemittedByOwner`). Its `base` input is the adjusted
   accommodation (percentage mode), so TOTALS calls it once, after PLATFORM PRICE and DISCOUNTS. The
   included-services deduction reads the services the **tariff declares** as included in the rate, never the
   sold extra lines. The tourist-tax report and `financeCalcs.computeTouristTaxAmount` call this unit
   instead of replaying the engine.
   _(Delivered by PR A: the unit holds the base (`resolveTaxBase`) and the included-services deduction
   (`sumIncludedServicesDeduction`), imports no extras, and runs in the pipeline after `platformGross` and before
   `platformPrice` and `discounts` (rule 52), because the engine computes it from the tariff's gross.)_
   > **Delivered by PR B** (commit `refactor(tourist-tax)`, 0 diff): the person × night arithmetic is the unit's own
   > (`personNights`, `unitFromTotal`) and the report, the freeze, the finance view, the devis PDF and
   > `financeCalcs.computeTouristTaxAmount` call it; the report of the tax a platform remits itself reads its two figures
   > (`touristTaxOriginalTotal`, `platformTouristTaxWithheld`) from the TOURIST TAX slice of the pipeline
   > (`pipelines.touristTaxFigure`: the steps up to `touristTax`) instead of replaying the whole quote
   > (`pricing-tourist-tax-figures` compares the slice with the full quote on every gate stay); `vatDivisor` is retired, the
   > nightly price goes through `vat.netFirst` and `vat.ttcFromNet`.
   > **Delivered by PR B** (pass 3, with rule 70): the `collector`'s `'direct'` test asks the channel (`isNamedChannel`) instead of
   > comparing the platform to the word by hand; the legacy defaults on an unmatched platform (collects = true, remits = false) are
   > kept, so no figure moves (D1 lists none: Q-B18).
4. **The engine becomes a composition.** `calculateReservationQuote(input)` survives as a thin wrapper over
   COMPOSE. Its output stays byte-identical (rules 33-36) for as long as callers read it. _(Delivered by PR A:
   `calculateReservationQuote` is `pricingInputModel.load` then `compose` (`utils/pricing/compose.js`: `stayQuote` plus
   `shape()`, the quote literal moved verbatim). A stay with no night included gets a 44-key quote (the halting step returns `halt: true` and COMPOSE shapes that quote too).
   `shape()` still derives a few presentation fields the engine derived
   inline: the rounded accommodation, the in-brut guest count, the original tourist tax, the `tariffSnapshot`, the tax base of
   a platform pin, the headline and summary cascade. Proof: `pricing-compose` compares the whole quote, key for key, of every
   price-gate stay with a fingerprint captured on the baseline code.)_
5. **Plugin extras go through one extension point.** _(amended 2026-11-11: the extension point is the
   article-family registry of rule 47.)_ `ctx.articleFamily(id, family)` (SDK wrapper of
   `articleFamilies.register`, rule 47) replaces `ctx.priceLineContributor` (kept as an alias, wrapped into a family,
   until PR C). A family receives `(config, request, ctx)` and returns a priced line with components (`base`, `evening`,
   `free`, `offered`) and tagged amounts. Hourly resources add the `hourly` family; shop articles are
   instances of core families. Solio-specific
   behaviour stays in plugins; the core holds the units, the line store and the extension point.
   _(Delivered by PR A: the head calls the `hourly` family inside the safety of `pluginFamily.js`, a family answering null
   contributes nothing, and `ctx.priceLineContributor` stays wired as an alias for `offered` until PR C; `ctx.articleFamily`
   forces the SDK 2.27.0 floor, `plugins-phase-1-sdk.md` rule 50.)_
6. **Arithmetic is unchanged in PR A.** PR A moves code without changing a single rounding: every unit keeps
   the euro arithmetic (`roundMoney`) it has today, **but the VAT component**, which computes in integer cents on
   `roundMoney`-ed TTC inputs: exact by construction (the cents of a two-decimal amount are an integer, so the cut
   is the engine's own; proof: the money fuzz and `pricing-compose`). Integer cents inside the other units is a
   later, separately proved change (Q9).

### 3.B NIGHTS, EXTRA GUESTS, TOURIST TAX

7. **Responsibility.** NIGHTS: nightly breakdown (seasons, rules, weekly model, degressivity, min/max nights
   per range, unpriced nights, changeover), locked sold nights (`mergeNightlyBreakdownWithLocked`), stay
   validation. EXTRA GUESTS: tiers, per-night season, split between platform brut and complement. TOURIST
   TAX: rule 3.
8. **The nights are priced by a stay edit only.** These three units run when the operator (or an intake)
   creates a stay or changes what defines it: dates, party, property, tariff, platform price, the « Recalculer
   la taxe de séjour » action. Selling, offering, removing, discounting a line or paying an extra never calls
   them: the sale path reads the **stored stay price** (`storedStayPrice(reservation)`: nights,
   accommodation, extra guests, tax as stored).
   > **Pending** — PR B
9. **Stay validation is not a sale check.** Min/max nights, changeover and capacity are judged by NIGHTS on a
   stay edit. A sale on an existing stay never re-judges them (W1 disappears, it does not get a flag).
   > **Pending** — PR B

### 3.C EXTRAS and ALLOWANCES

10. **One engine for every seller.** `priceExtras` prices options, linen, cleaning, breakfast (mornings ×
    persons), catering, baby bed, early/late check-in, cancellation insurance (percent of stay), custom
    lines, hourly resources and shop articles. The fiche, the devis, the SAS (arrival and departure), the iCal /
    platform intakes and the guest-app shop call the same function; no seller has its own arithmetic. A read
    (shop catalogue, slot picker price) is one `priceExtras` call, never a save (D9).
    > **Pending** — PR B: the SAS, the shop and the iCal / platform intakes call the same function. PR A proves the fiche's engine prices every option and resource line through the Articles head (`articles-head-contract`).
11. **Catalogue resolution is an input.** The property-merged catalogue (`getApplicableOptions/Resources`,
    `property_option_prices`, `property_resource_prices`, « Facturables » linen prices) is loaded by the
    loader and passed in. The per-property override lookup exists once.
    _(Delivered by PR A: `models/pricingInputModel.js` reads the merged catalogue through the CatalogueProvider and hands it to
    COMPOSE; the per-property override lookup exists once, in the CatalogueProvider — `data-access-ports`,
    `pricing-input-loader`.)_
12. **A line stores its total.** A priced line carries `quantity`, `unitPrice` (for display) and `total`; the
    stored `total` is authoritative. A sold line is never re-billed as quantity × rounded unit price (D4).
    > **Delivered by PR B** (pass 4): a line keeps its catalogue amount (`totalPrice`, the engine's `grossTotalPrice`) whatever discount it
    > carries; the discount is a fact beside it (rules 39, 40).
13. **A sale after the stay is sold appends a line; it never merges.** Once a line is locked
    (`reservation-option-immutability.md`), selling more of the same article from the shop, the SAS or the
    fiche creates a **new line** with its own price, source, collection moment and status. The fiche and the
    SAS group lines of the same article for display (« Bière locale — 3 : 1 × 6,50 € + 2 × 7,00 € »).
    `exactMergedTotals` disappears.
    > **Pending** — PR C: the fiche and the SAS append a new line, `exactMergedTotals`, and the guest-app shop (J-7 code, absent from this
    > branch). The primary key `(reservationId, optionId)` of the two catalogue line tables still holds one line per article (Q16): until
    > PR C lifts it, `extraSale.sell` of an article the stay already sells completes that line (`merged: true` in the quote), a custom line
    > always appends.
14. **Offered is a line property.** « Offert » sets the line's amount to 0 with its catalogue value kept for
    display (`applyOfferedToLine`). The three SAS offered mechanisms and `offeredMinutes` become this one.
    > **Delivered by PR B** (pass 4): the line API offers a line through the fiche's own save (`PATCH …/extras/:ref { offered }`).
    > **Pending** — PR B (pass 5): the SAS mechanisms.

### 3.D TOTALS, PLATFORM PRICE, DISCOUNTS, VAT

15. **Responsibility of TOTALS.** _(amended 2026-11-11: the order is the pipeline's, rule 52; VAT leaves
    TOTALS, rule 51.)_ PLATFORM PRICE, DISCOUNTS, TOURIST TAX and VAT are pipeline steps that run before it;
    TOTALS only aggregates their outputs into `finalPrice`, `discountAmount`, `totalStayPrice`, the VAT per rate
    and the breakdown the fiche, the devis PDF and the SAS render. TOTALS holds no formula of its own.
    _(Delivered by PR A: `aggregateTotals` returns `finalPrice`, `discountAmount`, `totalStayPrice`, `vatByRate` (the VAT
    component's rows as they came) and `breakdown`; no reader reads the last two yet.)_
    > **Pending** — PR B: the readers of the VAT per rate and of the breakdown (`saleDetail`, the fiche, the devis PDF).
16. **Discounts apply to nights and extras.** _(amended 2026-11-11, owner overrides the earlier default.)_
    A discount is `{ percent | amount | customPrice, target }` with `target ∈ nights | extras | all`:
    - `nights` — today's behaviour, bit for bit: `accommodationAdjusted = roundMoney(accommodationBase × (1 −
      percent/100))`, or `customPrice`. Every stored discount reads as `target = 'nights'`.
    - `extras` / `all` — the discount covers the **unpaid, not offered** extra lines of the target that were
      sold with the stay (`source ∈ fiche | devis | intake`), plus the accommodation for `all`. Shop and SAS
      sales keep their catalogue price unless the operator discounts that line (rule 39).
    - Allocation is rule 40. A paid line is never discounted after the fact (it would owe a refund: the
      operator uses rule 23 instead).
    - On a platform stay the gross pin supersedes the stay discount (today's rule): DISCOUNTS applies only to
      lines outside the platform price.
    > **Delivered by PR B** (pass 4, C15): the targets `extras` and `all` and the allocation of rule 40 (`pricing-discount-allocation`,
    > `pricing-line-discount`). The engine reads `discountTarget` (stored on the stay, journaled « Réduction sur », default `nights`),
    > `discountFixedAmount` (euros, an engine input, read from `reservations.discountAmountCents`: pass 4b persists a fixed stay amount
    > beside the target, nullable, written by a save, journaled « Réduction (montant) », read back by the stored-stay replay; on `nights` it
    > replaces the percent, on `extras` / `all` EXTRAS shares it out, capped at the target) and `lineFacts` (per stored line: `discountCents`, `source`, `soldAt`, `lineId`,
    > `settledCents` = Σ of its allocations). With `extras` / `all` the typed percent is shared out by EXTRAS over the covered lines
    > (`coveredLines`: not offered, not paid, source fiche / devis / intake) and, for `all`, the accommodation; a platform stay
    > keeps the target `nights` (its gross pin wins). A line that gains a discount carries `grossTotalPrice` (the catalogue amount,
    > what is stored: a discount never lowers a stored total), `discountCents` (its own, rule 39) and `stayDiscountShareCents`;
    > its `totalPrice` is what is due. A quote with no such discount carries no new key on its lines. `discountAmount` counts the
    > extras' discount. The tourist-tax base and the cancellation-insurance base still follow the `nights` discount only.
17. **"Inside the platform price" is a declared line fact, not a routing guess.** A line is either part of
    the platform gross (`collectAt = 'platform'`, set by the intake or the operator at booking time) or not.
    PLATFORM PRICE back-solves the accommodation as `brut − extra guests in brut − Σ platform lines −
    withheld/reversed tax` — exactly today's formula, with "`inComplement = 0`" replaced by "`collectAt =
    'platform'`". **A sale made after the booking is never a platform line**, so it can never shrink the
    accommodation (D1, D3). `grossFromNet` (catalogue) and `platformPriceCheck` call the same unit.
    > **Pending** — PR B: the `collectAt = 'platform'` declaration replacing `inComplement = 0`, and `platformPriceCheck` calling the unit (its extras sum is not rounded like the pin's). PR A ships PLATFORM PRICE with today's flag (`pricing-platform-price`): the engine's gross pin and `grossFromNet` are one unit.

### 3.E STAY CLOCK, SCHEDULE, SETTLEMENT

18. **Each extra line carries its collection moment**, decided when the line is written and stored on it:
    `plan` (deposit / balance / installment plan), `platform` (paid to the platform), `arrival` (to pay at
    check-in), `departure` (to pay at check-out). Nothing downstream infers it again.
    > **Delivered by PR B** (pass 4): `extraSale.sell` stamps `source`, `soldAt`, `collectAt`, `collectAtDefault` on the lines it creates
    > (`models/extraSalesModel.stampNewLines`) and `saleDetail` reads them; the lines of a fiche save keep the values the backfill gave.
    > **Pending** — PR B (pass 5): the SAS and the intakes write them.
19. **The default moment of a new line** (`defaultCollectAt`) _(amended 2026-11-11 for rule 20)_:

    | Stay state | Paid now (card / Qonto link, terminal or cash at the SAS) | Not paid |
    |---|---|---|
    | not started (rule 20) | line `paid`, moment `arrival` for the record | `arrival` — « À payer à l'arrivée » |
    | started | line `paid`, moment `departure` for the record | `departure` — « À payer au départ » |
    | departure complement already collected | line `paid` | refused « Séjour soldé : vente séparée » |
    | at booking, from the fiche or an intake (stay not yet sold) | — | `plan` (direct) or `platform` (platform stay, when included in the brut) |
    > **Delivered by PR B** (pass 4): the first two rows for a sale through `extraSale` (`payment: 'later'`; a payment taken at once is the
    > SAS's, pass 5): a stay not started takes the line in its arrival complement, a started one routes it to the departure.
    > **The routing is the stay clock's hour, not the day** (pass 4b; `pricing-collect-at-clock-hour`): on the arrival day, a sale before the
    > check-in hour is collected at arrival (the new line is routed to the arrival complement, the engine reads no baseline, the save pins none),
    > from the check-in hour on it is collected at departure. The fiche lock window of rule 45 row C stays the day's (PR C).

20. **"Started" = the arrival date and check-in time have passed, Europe/Paris.** _(amended 2026-11-11,
    owner: « date et heure passées »; amended again the same day: the clock is its own component, rules
    44-46.)_ `started = now ≥ arrivalDate T checkInTime` in `Europe/Paris` (the reservation's `checkInTime`;
    when missing, the property's `defaultCheckIn`; when both are missing, `15:00`). It is answered by STAY
    CLOCK only, through `phaseForReservation` (rule 44), for the guest app, the e-mails, the SAS and the fiche.
    - **The arrival mark and the arrival SAS do not change the moment of a new sale.** They change only the
      display: once either is done, the arrival section of the fiche reads « Arrivée faite » and the SAS
      arrival is shown as committed. `arrivalMoment.hasGuestArrived` keeps its other readers (headings of an
      unsettled complement) until PR C reviews them; it no longer routes a sale.
    - **Sale after check-in time while the arrival SAS is still open** (guest late, SAS not yet done): the
      line is `departure` « À payer au départ ». The open SAS arrival shows it in its own section « Ventes du
      séjour — au départ », not in the total to collect. The operator may collect it there (paid now, rule
      29) or move it to `arrival` (rule 37), which puts it into the arrival total. The default never changes
      silently.
    - Early check-in sold as an option does not move `checkInTime`; the operator edits `checkInTime` when the
      arrival time really changes.
    > **Delivered by PR B** (pass 4, C13; class E1): the arrival baseline of the extras (`arrivalExtrasBaselineIsDue`, hence the
    > engine's `arrivalExtrasBaseline` and the fiche's mid-stay note routing) follows `phaseForReservation(...).started`, no longer the
    > check-in mark or the arrival SAS. The default moment written on a new line is rule 19 (**Pending** — PR B, C14).
21. **Paid is stored on the line.** A line's `settledCents` is the Σ of its allocations (rule 74), computed, never a
    stored column (Q16 call Q-B6b); `settlementRef` names the payment link, settlement or tender. Every bucket amount — arrival complement, departure complement, solde — is **Σ of the
    due amounts of its lines** (+ the stay-level parts of rule 22). Netting paid money happens in SETTLEMENT
    only; the fiche detail, the collected split, the SAS recaps and the accounting basis all read it (D6).
    > **Delivered by PR B** (pass 4): `settledCents` is read, never stored (`stayRepository.lineFacts`: Σ of the line's allocations) and
    > `saleDetail` says « Payée le jj/mm ». **Delivered by PR B** (pass 4b; class E8; `pricing-settlement-prepaid-card`): a card-paid line is a line a
    > settled note names. SETTLEMENT nets it whether or not the stay has an arrival baseline: with none (the arrival day before the check-in hour,
    > rule 19) the baseline is each line's total less what the notes collected on it, so the line leaves the arrival complement and the pre-arrival
    > split as a sale of the stay does. The arrival detail (`arrivalPaymentDetail`, from the complement's itemisation), the collected split
    > (`complementPaidSplit.contribSplit`, from the mid-stay split) and the SAS recaps read that one split: no netting copy of their own. A stay
    > that has a baseline reads as before; the gate and the production copy hold no such note (0 figure moved).
22. **Stay-level amounts keep their rules, in SCHEDULE.** Deposit % on the accommodation, solde, installment
    plans (`installmentPlan`, `installmentSync`), due dates (`paymentSchedule`), platform single payment, tax
    routing (`touristTaxInComplement`), extra-guest complement, overrides (`depositAmountOverride`,
    `complementAmountOverride`, end-of-stay override as an « Ajustement » line), arrival reduction / tip,
    mixed methods (`payment_settlements`, `payment_tenders`). They move unchanged. _(Delivered by PR A pass 5:
    `utils/pricing/schedule.js` `planSchedule` holds the acompte, solde, plan, due dates and the arrival / end-of-stay
    complement amounts, `utils/pricing/settlement.js` the `inComplement` reading, the mid-stay split with its collected
    notes and `splitComplementBuckets`; the platform commission clamp stays a step of the engine after SCHEDULE.)_
23. **Lowering a paid line produces money owed back.** Offering, removing, discounting or reducing a line
    below its `settledCents` is refused by default; with the operator's confirmation it opens a `refund_obligations`
    row (origin `lineLowered`, rule 75) of the line's excess, which is its trop-perçu share (rule 76) (D7, owner O-10, Q16).
    > **Delivered by PR B** (pass 3): the fiche save lowering a paid line is refused (409 `OVERPAID`) until `forceOverpayment`; the
    > confirmed excess opens the obligation (`owedOnLineLowered`), a later save that shrinks the excess shrinks it, and a refund
    > opened on the trop-perçu settles it (`refund-obligations`). The trop-perçu row is the one face of that money in the ledger.
    > **Delivered by PR B** (pass 4): offering or discounting a paid line through the line API (`PATCH …/extras/:ref`) goes through the
    > fiche's own save: 409 `OVERPAID` until `forceOverpayment`, then the `lineLowered` obligation. The SAS cannot reach a paid line (a paid
    > complement freezes its lines, rule 32). Removing a line stays the fiche's.
24. **One article, one price path.** The evening supplement of an hourly session is a component of the
    session's priced line (rule 5), priced by HOURLY TARIFF whatever the seller. The SAS no longer adds an
    `evening:<id>` complement line computed elsewhere; the `eveningCredit` worked back from stored totals
    disappears (D8).
    > **Pending** — PR B
25. **The SAS sells through EXTRAS.** Breakfast, catering, bath linen, linen pieces, cleaning, missing items,
    extinguisher and plugin items (`sasCommit.complementItems`) are requests to `priceExtras`, written as
    lines with `source = 'sas'` and the moment of rule 19. `planArrivalSas` / `planDepartureSas` become
    SETTLEMENT views over those lines.
    > **Pending** — PR B
26. **Free allowances are consumed by a line and stay with it** (ALLOWANCES unit, rule 41). The free bath
    hour, free units (« 2 offerts ») and included hours are a ledger per stay; a line records the allowance
    it consumed (`allowanceUsed`). Removing a line gives its allowance back for **future** sales; it never
    re-prices another standing line (D5). A pending card order reserves its allowance at quote time
    (`deferredCents`/`PRICE_ROSE` disappear).
    > **Pending** — PR B: `allowanceUsed` on the lines and the release of a removed line's share.
    > **Pending** — PR C: a pending card order reserving its allowance, and the end of `deferredCents` / `PRICE_ROSE` (J-7 code, absent from this branch).

### 3.F Selling an extra — one service for every seller

27. **`extraSale.sell(reservationId, requests, { source, payment, actor, now })`** — the only write path for
    an extra on an existing stay. In one transaction: load → `priceExtras` (stored stay context) →
    `composeTotals` (stored stay price + all lines) → `planSettlement` → write the new lines with their moment
    and status → update the stored bucket columns (`complementAmount`, `endOfStayComplementAmount`,
    `finalPrice`, VAT columns) → history entry. **It never writes the nights, the tax, the platform payout,
    the deposit or the installment rows** (the solde moves only for `plan` lines added by the operator before
    the stay is sold).
    > **Delivered by PR B** (pass 4): `utils/extraSale.js` (`quote`, `sell`, `changeLine`, `saleDetailOf`) over `models/extraSalesModel.js`, with
    > `controllers/extraSalesController.js`. It prices and writes through the fiche's own save (`performUpdate`), so the engine, the
    > allowances, the price lock and the arrival floors are the fiche's. A server caller that changes a stored line fact the payload cannot
    > carry sends `restatePricing` (the stay is re-priced under its price lock) and `lineDiscounts`.
28. **Sources.** `fiche` (manual addition by the operator), `shop` (guest app), `sas` (check-in / check-out
    upsells and departure charges), `intake` (platform / iCal), `devis`. The fiche's ordinary save keeps its
    current path for stay edits and for lines of a stay not yet sold; on a sold stay, an added product goes
    through `extraSale.sell` (owner: « on passe par les mêmes composants et même principe »).
    > **Delivered by PR B** (pass 4): the five sources are recognised; only `fiche` is written here. **Pending** — PR B (pass 5): `sas`, `intake`.
29. **Paying now.** _(amended 2026-11-11 for platform stays.)_ `payment: 'card'` returns a priced basket and
    mints a Qonto link; the line is written `due` with a hold, and the paid effect (`applyPaidEffect` →
    basket) sets `settledCents`. On a platform stay, before or after arrival, this link is **separate from the
    platform payment** and the line is outside the platform price (rule 17). `payment: 'cash' |
    'card-terminal'` at the SAS writes `paid` directly with a tender. `payment: 'later'` writes the moment of
    rule 19.
    > **Delivered by PR B** (pass 4): `payment: 'later'` only; `cash` / `card-terminal` / `card` answer 400 `PAYMENT_MODE_UNSUPPORTED` here (the SAS takes them in pass 5; the card link is the online-payment plugin's, rule 29).
30. **Quote = commit.** `extraSale.quote(...)` runs the same pipeline without writing and returns what `sell`
    would write. A shop, SAS or fiche preview is a quote; a commit re-quotes inside the transaction and
    refuses if the price differs from the accepted one (one comparison, one refusal « Prix modifié — relire le
    panier »).
    > **Delivered by PR B** (pass 4): `quote` plays the save in a rolled-back transaction, `sell` re-quotes inside its own and answers 409
    > `PRICE_CHANGED`.

### 3.G The detail, everywhere the same

31. **One read model: `saleDetail(reservationId, now)`.** Built from TOTALS + SETTLEMENT on the stored lines:
    per line `label`, grouped `quantity × unit`, `total`, discount share, `source` (« Fiche », « Boutique »,
    « SAS »), `status` (« Payée par carte le 12/11 », « À payer à l'arrivée », « À payer au départ »,
    « Comprise dans le prix plateforme », « Dans l'acompte et le solde », « Offerte »), and per bucket the due
    total. The fiche, the SAS arrival recap, the SAS departure recap, the guest-app order view and the
    e-mails render this payload; none of them sums anything (CLAUDE.md §6.0).
    > **Delivered by PR B** (pass 4): `utils/saleDetail.js` (`lines`, `buckets`, `totals`, VAT per line); served by `GET …/sale-detail`.
    > The SAS recaps, the e-mails and the fiche payload embed it in pass 5.
32. **The SAS arrival shows** the arrival lines due, the stay amounts due at the door, the lines already paid
    (« Déjà payé », not offerable), and — when the SAS runs after check-in time — the departure lines sold
    since (rule 20). **The SAS departure shows** the departure lines, the arrival lines left unpaid (recalled,
    `recalledArrivalAfter`), and the paid lines for the record.

### 3.H Non-regression guarantee

33. **Byte-identical before any behaviour change.** PR A, and the first commit of PR B (columns + backfill),
    must produce, on the golden fixture (`tests/fixtures/vat-regime/golden.json`, 188 keys: quotes, fiche
    payloads, devis PDF, 34 payment-link baskets, 48 CSV months, finance, tourist tax, cancellations) **and**
    on a replay of every stay and devis of a fresh prod snapshot copy, output equal byte for byte to the code
    before them. The golden test must run with the accounting-export plugin installed (it is skipped
    otherwise).
34. **The prod replay covers every money reader.** `scripts/vat-regime-golden-prod.mjs` is extended
    (`scripts/pricing-replay.mjs`) to hash, per reservation: the live quote (`quoteStoredReservation`), the
    stored columns after a no-op save (dry run), the SAS arrival and departure plans (no draft), the payment
    link baskets of every open bucket and installment, the cancellation preview, the arrival-payment detail,
    the collected splits, the tourist-tax unit's figure; per month: the accounting CSV, the tourist-tax report,
    finance views. Names never printed; the copy is purged of secrets (`copy-prod-db-to-dev`).
    _(Delivered by PR A: `scripts/pricing-replay.mjs` hashes 1222 artefacts of the snapshot copy; the baseline is captured by
    the code of the `price-gate-baseline` tag, `88e0aad7`, and the branch compares at 0 difference.)_
35. **Zero diff is the bar.** A refactor commit with one differing hash does not ship. A behaviour commit
    (rest of PR B, PR C) ships with its **expected diff list** (each differing key, the reason, the rule)
    approved by the owner; any unlisted diff blocks. The replay runs on every commit of PR A, not only on the
    PR head.
36. **Stored data is never rewritten to make a replay pass.** Backfills (§5) add columns derived from what is
    stored; they never change an amount column. Tests: `pricing-lines-migration` (a second run changes nothing, amounts hashed
    before and after), `pricing-legacy-collect-at`, `pricing-legacy-allocations`, and the prod replay by value.

### 3.I Rules added 2026-11-11

37. **The operator may change the moment of an unpaid line** (Q4, owner). On the fiche or in the SAS, an
    unpaid line moves among the moments valid for the stay state (`arrival` ↔ `departure` while the arrival
    complement is open; `departure` only once it is collected; `plan` only before the stay is sold). The
    operator's choice overrides the default STAY CLOCK gave; the line keeps both (`collectAt` and
    `collectAtDefault`) and each change is journaled in `reservation_history` with both values (« Bain
    nordique : à payer au départ (horloge : séjour commencé) → à payer à l'arrivée (opérateur) »). A paid
    line's moment is frozen (409 `LINE_PAID`). _(amended 2026-11-11: both values recorded, rule 46.)_
    > **Delivered by PR B** (pass 4): `PATCH …/extras/:ref { collectAt }` moves an unpaid line between `arrival` and `departure` by the stay's
    > extras baseline, both values journaled (« à payer au départ (opérateur) » ← « à payer à l’arrivée (horloge) »); `plan` and `platform`
    > are not offered, and a moment already collected is refused (409 `MOMENT_NOT_AVAILABLE`).
38. **Money helpers are shared, not a component.** `money.js` holds `roundMoney`, `toCents`, `fromCents` and
    `allocateCents`. It carries no business rule, so it is not a component; it is a unit because about twenty
    files redefine `round2` / `cents`, and two definitions that differ are a silent drift. PR A moves the
    engine's own `roundMoney` there unchanged; other copies are replaced in PR C only where the replay proves
    them identical.
    _(Delivered by PR A: `money.js` also holds the French formatters (`frenchNumber`, `frenchEuros`, `frenchPercent`), so
    no family and no refund unit reaches TOURIST TAX or the ledger for them; `allocateCents` takes signed weights
    (one largest-remainder allocator for VAT, discounts and the groups); `roundMoney` is `Math.round` on the float
    product, half toward +∞ (`roundMoney(-0.125)` is `-0.12`), as the engine always was. The private copies wait in the
    `money` allow-list of rule 66, PR C.)_
39. **A line discount.** The operator may discount one unpaid line (percent or amount), from the fiche or the
    SAS. It is stored on the line (`discountCents`) and journaled. It is the only discount a shop or SAS sale
    receives. `discountCents` holds the line's OWN discount only: the stay discount's share (rule 40) is derived on every quote
    (`stayDiscountShareCents`), never stored, so a later change of the stay discount cannot leave a stale share on a line.
    > **Delivered by PR B** (pass 4, C15): the engine applies a stored line discount (capped at the line, never below 0).
    > **Pending** — PR B (C17): the operator's way to set it, `PATCH /api/reservations/:id/lines/:ref`.
40. **Discount allocation and rounding.** DISCOUNTS works in cents. For a percent `p` on a target set: the
    discount `D = round(Σ target × p / 100)` (half up, to the cent). For a fixed amount, `D = min(amount, Σ
    target)`. `D` is split over the target items in proportion to their amount; each share is floored to the
    cent and the cents left over go one by one to the items with the largest remainders (ties: accommodation
    first, then lines by `soldAt`, then id). So Σ shares = `D` exactly and no line goes below 0. VAT is split
    after the shares (each line's net amount). Target `nights` keeps rule 16's euro formula so stored stays do
    not move. _(Delivered by PR A: `money.allocateCents` is the one largest-remainder allocator, used by VAT and the
    group rates, with signed weights.)_
    > **Delivered by PR B** (pass 4, C15): `discounts.allocateDiscount` / `discountLines`; the VAT of a discounted line is split from
    > its net amount (C16).
41. **ALLOWANCES is its own unit.** Grants come from the catalogue (free minutes per stay, free units per
    lodging); consumption comes from the stored lines' `allowanceUsed`. `consumeAllowance` serves a request in
    sale order and returns what it used; `releaseAllowance` returns a removed line's share to the pool. Shop,
    SAS and fiche read the same ledger, so « 1 h offerte encore disponible » is the same everywhere.
    > **Pending** — PR B: « SAS and fiche read the same ledger » (PR A has the read-only form: the engine's free units
    > through `createFreeUnitsLedger`, `consumeAllowance` and `releaseAllowance`, proved by `pricing-allowances`).
    > **Pending** — PR C: the shop reads the same ledger (J-7 code, absent from this branch).
42. **What is not a unit.** _(cut examined 2026-11-11.)_
    - **Catalogue resolution** — a DB read, so it lives in the loader; its rule (property override wins) is a
      tested function of the loader.
    - **Headline / summary cascade** (`quoteHeadline`) — display shaping of TOTALS' output; it stays a helper
      of COMPOSE.
    - **Changeover check** — part of NIGHTS' validation; alone it has no input NIGHTS does not already hold.
    - **Due dates** (`paymentSchedule`) — already a pure util; SCHEDULE calls it. Separating it further adds a
      contract and no testability.
    - **Mixed-method tenders** (`paymentTenders`, `paymentSettlementService`) — already isolated with their own
      tests; SETTLEMENT reads their aggregates as input.
    - **Accounting export** — a reader of stored money, out of scope (§8).
    _(Delivered by PR A: the catalogue resolution is the loader's — `pricing-input-loader` proves the lodging's own price wins;
    `quoteHeadline` and `summaryCascade` are called by `compose.shape`; the changeover check is a call of the `nights` step.)_
43. **Each unit has its own test file**, `server/src/tests/pricing-<unit>.unit.test.js`, which imports that
    unit alone, with fixtures built from plain objects (no DB). COMPOSE has a test that the composition equals
    the pre-refactor engine on the golden fixture. _(Delivered by PR A: `pricing-import-graph` checks it for every unit
    file, sub-folders included, steps excepted: `pricing-<unit>`, `articles-family-<family>`, `pricing-refunds-<unit>`, or a
    listed covering test for the internal files (`lineSnapshot`, `registry` → `articles-head-contract`; `units`,
    `familyKit`, `makeArticle` → `article-family-contract`; `vat/*` → `vat-component`). TIMED OPTIONS has its own
    test, `pricing-timed-options`, and so has STORED LINES, `pricing-stored-lines`.)_

### 3.J The stay clock — one component every other one consults (owner, 2026-11-11)

44. **STAY CLOCK is a pure unit plus one resolver.**
    - `stayClock.phaseOf({ arrivalDate, departureDate, checkInTime, checkOutTime }, now)` (pure, no DB, no
      `Date.now()`; `now` is injected; Europe/Paris wall clock) returns:
      - `phase`: `before` until `arrivalDate T checkInTime`, `during` until `departureDate T checkOutTime`,
        `after` from then on;
      - `started` = `phase !== 'before'`; `defaultCollectAt` = `started ? 'departure' : 'arrival'`;
      - `arrivalDayReached` / `departureDayReached`: the calendar answers (Paris date ≥ the day), for the
        questions that are about the day and not the hour (fiche lock, deadline display, client "en séjour"
        bucket). They are part of the same output so that no other module compares dates.
    - Missing `checkInTime` → the property's `defaultCheckIn`, then `15:00`; missing `checkOutTime` → the
      property's `defaultCheckOut`, then `10:00`. The resolver fills them; the pure unit receives complete
      values and refuses a malformed one (`HH:MM`). The resolver normalises `9:00` and `09:00:00` to `09:00`; a stored
      time it cannot read counts as blank (property default, then `15:00` / `10:00`) and never throws.
    - The phase is judged on **instants**: the check-in or check-out is the first instant whose Paris wall clock shows
      that time, so on the day the clocks go forward a time that never shows (`02:30`) is reached at `03:00`, and on the
      day they go back it is reached at its first occurrence and the repeated hour does not undo it. The phase never steps
      backwards.
    - `models/stayClockModel.js` → `phaseForReservation(id, now)` loads the dates and times (reservation, then
      property) and calls `phaseOf`. **This is the only place anyone asks « has this stay started? »**. The
      loader of COMPOSE, `extraSale.quote/sell`, SETTLEMENT, `saleDetail`, the SAS, the fiche, the guest app
      and the e-mail context receive the phase from it. They only hand over the stay id.
    > **Delivered by PR B** (pass 4, C13): the engine's baseline (`resolveArrivalExtrasBaseline`, read by the quote context) and the
    > mid-stay note flag (`arrivalBaselineNotDue`) consult the resolver. The calendar answers that are about a day, not an hour, are
    > pure functions of the unit: `dayReached(day, todayIso)`, `dayPassed(day, todayIso)` (the day strictly before today: the refusal
    > to book in the past) and `sasWindowState(dateIso, now)` (`future` / `open` / `past` / `unusable`: the reception SAS window D 00:00
    > → D+1 04:00). `readableTime` (`H:MM`, `HH:MM:SS` → `HH:MM`) is shared with `timeToDecimalHour` of the timed options (Q-B19: 0
    > production rows hold a seconds time, so no stored price moves).
45. **No other module compares dates to decide a collection moment or a stay phase.** A static test (grep in
    the server suite) fails on `startDate <= today`-style comparisons, `hasGuestArrived` or
    `isArrivalNotMarked` outside `stayClock*`. Today's call sites and the PR that moves each:

    | Call site (today) | What it decides | Moved in |
    |---|---|---|
    | `models/reservationsModel.js` `arrivalExtrasBaselineIsDue` (~l. 618, `hasGuestArrived`) | when the arrival baseline is laid, so a sale goes to arrival or end of stay | B |
    | `models/reservationsModel.js` `isArrivalNotMarked` (l. 2846), `controllers/reservationsController.js` l. 751 (`planMidStayNote … arrivalNotMarked`) | mid-stay note routing on the fiche | B |
    | `controllers/reservationsController.js` `enterMidStayExtrasWindow` (l. 2039) + `utils/midStayExtrasWindow.js` l. 28 (`startDate <= today`) | the mid-stay extras window of a save | B |
    | `controllers/reservationsController.js` l. 2173 (`pastReservationLocked`) and l. 2368 (`started` for a raise on a collected stay) | fiche lock; refusal of a raise | C (`arrivalDayReached`, same semantics) |
    | `utils/endOfStayCheckout.js` `isCheckoutDone` (l. 25) | end-of-stay collection allowed | B (`phase === 'after'` or `departureDayReached`, same semantics) |
    | `plugins/sas/controller.js` l. 55 (`sasLockReason({ dateIso: startDate })`) | whether the arrival SAS may open | B |
    | `utils/paymentDeadlines.js` l. 208 (`arrived = startDate <= today`) | deadline display | C (`arrivalDayReached`) |
    | `utils/platformPriceCheck.js` l. 54 | skips past stays in the price check | C (`arrivalDayReached`) |
    | `models/clientsModel.js` l. 127, 179 (`inStay`) | client list bucket | C (`arrivalDayReached`) |
    | `models/reservationsModel.js` create path (`startDate < today && !options.allowPastDates`) — _row added 2026-11-12 (Q-B10)_ | the refusal « Impossible de réserver dans le passé » | B (`arrivalDayReached`, same semantics) |
    | `controllers/reservationsController.js` ledger edit (`startedStay = … storedRow.startDate <= getTodayIsoDate()`) — _row added 2026-11-12 (Q-B10)_ | whether the amount editor of the deposit / balance rows treats the stay as started | B (`arrivalDayReached`, same semantics) |
    | `utils/midStayOrderCommit.js` l. 310-337 (`stayStarted`, `isArrivalNotMarked`, `hasGuestArrived`) | shop routing | C (file deleted) |
    | `plugins/guest-app` shop state / `orderCollection` callers (`index.js` l. 151-172, `shopController.read`) | shop open, J-7 flags | C |
    | `utils/arrivalMoment.js` `hasGuestArrived` | the module itself | C (removed once its last reader moves; « arrivée faite » display reads `checkInDone` / `arrivalSasDoneAt` directly) |
    | engine input `todayIso` / `midStayWindow` (`pricing.js` ~l. 1565, set by the controller) | phase fed to the engine | B (`midStayWindow` follows `hasGuestArrived`, the clock follows the check-in time: the first listed diff of PR B; moved from A) |
    | `plugins/website-booking/publicInputValidation.js`, `utils/platformIntakePort.js` (the started-stay refusal of the intakes), `utils/sasEditWindow.js`, `utils/receptionView.js` — _rows added 2026-11-11 by the review of PR A (`stay-clock-single-source`, `NOT_IN_THE_TABLE`)_ | a date window of the public form (a start date in the past); the intake port's refusal; the SAS lock reason and the reception view that read it | C (the form and the port, `arrivalDayReached`), B (the SAS lock reason and the reception view) |
    | `plugins/booking-intake/intakeService.js` l. 159, `plugins/airbnb-intake/intakeService.js` l. 119, `plugins/gites-de-france-intake/intakeService.js` l. 136 (`startDate <= today()`) — _row added 2026-11-11 by the code check of rule 71_ | an intake refuses a started stay (« Séjour commencé : fiche à saisir à la main ») | C (`arrivalDayReached` through the SDK, same semantics; rule 71) |

    _(Delivered by PR B pass 4: every row tagged B is moved — the `dates` allow-list holds only PR C entries. `isArrivalNotMarked` is
    `arrivalBaselineNotDue` (the response key `arrivalNotMarked` of the preview is unchanged); `sasLockReason({ stay, side, doneAt, now })`
    takes the stay and the side instead of a date; `isCheckoutDone` and `midStayExtrasWindow` compare through `dayReached`.)_

    Slot and service-hour logic (`guest-app/serviceHours.js` `outsideStay`, `shopController` `remainingMornings`)
    asks a different question (is a delivery time inside the stay's opening hours) and keeps its own code; it
    reads `phase` only to know whether the stay is open at all (C).
    > **Pending** — PR C
46. **The clock decides the default, the operator may override, the journal keeps both.** A line written with
    the clock's `defaultCollectAt` stores it in `collectAtDefault`; an operator change (rule 37) sets
    `collectAt` and journals `default → chosen`. A later change of the clock (time passes) never rewrites a
    stored moment: the moment is decided once, when the line is written.
    > **Delivered by PR B** (pass 4): `collectAtDefault` is written once by `extraSale.sell`; a move sets `collectAt` only.

### 3.K Architecture amendments (owner, 2026-11-11)

47. **Articles = one head, generic families, configured instances.** _(rewritten 2026-11-11, second
    round: one sub-component per pricing family, not per article; strategy + registry + factory.)_
    - **Head** (`articles/index.js`) — the only interface of « Articles » with the rest of GuestFlow: `quote`,
      `commit`, `release`, `describe`, refusals. It resolves the instance of each request, looks up its family
      in the registry, calls `validate` then `price`, coordinates the stay allowance (rule 41: how much is
      left, which line consumed it), applies « Offert » (rule 14) and locked snapshots (rule 13), calls the
      fulfilment port (rule 49) and aggregates the lines and their tagged amounts. It holds **no formula**.
      Nobody — fiche, SAS, guest app, pipeline step, plugin — calls a family or an instance directly.
    - **Families** (`articles/families/*.js`, registered with `articleFamilies.register(id, family)`) — one
      generic formula per pricing family: `fixed` (any simple-price article), `per_unit`, `per_night`,
      `per_person`, `per_person_per_night`, `percent_of_stay`, `per_participant_progressive`; plugins add a
      family (hourly-resources: `hourly`, the nordic bath grid with free minutes and evening band), never an
      article. Contract: `{ id, configSchema, validate(config, request, ctx) → refusals[], price(config, request,
      ctx) → { quantity, unitPrice, components[], allowanceUsed, amounts: [TaggedAmount] }, describe(config,
      line) → { label, detail } }`. A family emits tagged amounts (rule 61), never VAT. Each family owns its multiplier
      and its typed counts (`units.js` keeps only `resolveServedPersons` and `resolveCoveredPersons`).
    - **Instances** (`articles/makeArticle.js`, factory) — `makeArticle(catalogueRow)` returns a frozen
      `{ ref, family, config }` where `config` = price, label, `vatClass`, limits (min/max, mornings,
      persons), allowance (free units / minutes), fulfilment id, `sellableExternally`; `config.resource` carries the
      catalogue row that the `hourly` family hands to its grid. The catalogue
      provider builds one instance per catalogue article (property overrides applied); an instance has no code.
      Adding a new article is a catalogue row; adding a new way of pricing is a family.
    - **Delivered by PR B** (pass 4, L6): `makeArticle` reads the family only within the kind's own price types (an option's: `per_stay`, `free`, `per_person`, `per_night`, `per_person_per_night`, `percent_of_stay`, `per_participant_progressive`; a resource's: `per_stay`, `free`, `per_person`, `per_night`, `per_person_per_night`, `per_hour`), else `fixed`: a wrong-kind legacy type no longer prices by the other kind's family (the catalogue forms refuse them; production has none). The `per_hour` request without the plugin is refused as `FAMILY_UNAVAILABLE` by the head (OD1), already.
    - Today's `priceType` values map to families: each to its namesake, `per_stay` and `free` to `fixed`, an unknown type to `fixed` (today's engine default); `per_unit` is the family of the planning-card options (placed moments or portions), which is what the engine's card path computes _(precised 2026-11-11, PR A)_. A family id is registered once (`DUPLICATE_FAMILY`
      at boot); an instance whose family has no live registration is not sellable (`FAMILY_UNAVAILABLE`). _(Corrected
      2026-11-11, PR A review: the sentence « exactly as a `per_hour` line today when hourly-resources is off » was wrong —
      today such a line is **priced**, quantity × price after the free minutes. PR A keeps it so: the head prices a
      `per_hour` article without the plugin by the core hours path; whether it becomes `FAMILY_UNAVAILABLE` is owner
      decision OD1, **decided 2026-11-12 (a)**: stored lines keep their core-hours price, new requests are refused;
      no diff.)_
    - **Head entries.** Besides the families, the head carries the documented `priced: { totalPrice }` entries — an amount
      with no per-type formula, « offert » only: the operator's custom lines, the baby-bed line and the timed options
      (`timedOptions.js`) — and the `per_hour` hours path above. The live families are an input of `quote({ families })`,
      resolved once by the loader (`liveFamilies()`); `hourly` is asked through the head, inside the guards of
      `pluginFamily.js` (a plugin that throws, or answers null, contributes nothing to the line).
    - `describe` gives the fiche, the SAS and the guest app every price label (« 2 × 6,50 € · 2 offerts »,
      « 1 h × 30 € · + 20 € soirée »); no screen composes one.
    > **Pending** — PR B: the family is read from the stored `priceType` whatever the kind, so a **resource** stored as
    > `percent_of_stay` or `per_participant_progressive` (or an option stored as `per_hour`) is priced by that family, where the
    > tag billed quantity × price (billed units 2 → 1, or 0.25 → 1/0). Not reachable: `resourcesController.PRICE_TYPES` and
    > `optionValidation.PRICE_TYPES` refuse those types and production holds none. PR B makes `makeArticle` read the family only
    > within the kind's own price types (any other value reads as `fixed`).
48. **Data-access ports (ports & adapters / repository).** No component queries the DB, the clock or a
    plugin: the composer hands them what a port returned. Ports are plain objects of functions:

    | Port | Functions | Adapter (core unless noted) | Consumed by |
    |---|---|---|---|
    | `StayRepository` | `stay(id)`, `storedStayPrice(id)`, `lines(id)`, `phaseInputs(id)` | `models/ports/stayRepository.js` (reservations, lines, properties) | loader, STAY CLOCK resolver, `extraSale`, `saleDetail`, SETTLEMENT inputs |
    | `CatalogueProvider` | `articles(propertyId, {customerContext})`, `article(ref)` | `models/ports/catalogueProvider.js` (options, resources, property overrides, « Facturables », shop articles) | Articles head (builds instances with `makeArticle`), shop catalogue |
    | `PaymentLedger` | `receipts(id)`, `installments(id)`, `splitReceived(id)`, `refunds(id)` | `models/ports/paymentLedger.js` | SCHEDULE, SETTLEMENT |
    | `SettingsProvider` | `for(componentId, scope)` | `models/ports/settingsProvider.js` (today's columns, rule 50) | every parameterised component |
    | `SlotAvailabilityProvider` | `slots(resourceId, range)`, `validate(sessions)` | plugin `hourly-resources/slotAvailability.js` | `hourly` family (`validate`), bath FULFILMENT adapter, guest-app slot picker |
    | `PaymentGateway` | `link(basket)`, `withdraw(link)`, `refund(link, cents)` | `utils/basketPayments.js` + `paymentProvider` registry (online-payment plugin) | `extraSale` (card), external sale |
    | `EventPublisher` | `publish(name, payload)` | `plugins/sdk/eventBus.js` `emit` | `extraSale`, external sale (rule 55) |

    Pure units take values, never ports; ports are called by the composer (pipeline `load*` steps) and the
    sale services only. _(Delivered by PR A: `StayRepository`, `CatalogueProvider`, `PaymentLedger` (installments, split
    received, refunds) and `SettingsProvider` over today's reads — the loader, the stay-clock resolver, the catalogue and
    the platform grid read through them; `planSchedule` takes the ledger values `{ splitReceived, installmentPlan }` and its
    step reads the port, so SCHEDULE is a pure unit. The settings provider and the catalogue prepare each SQL statement once
    per database handle, lazily (a quote went from 2.9 to 1.7 ms on the production copy; a statement the schema cannot prepare
    is not kept). Proof: `data-access-ports`, `settings-provider`, `settings-provider-statements`,
    `pricing-settings-wiring`.)_
    > **Pending** — PR B: `PaymentLedger.receipts` (the single read of SCHEDULE and SETTLEMENT), `StayRepository.stay` /
    > `storedStayPrice`, `SlotAvailabilityProvider`, `PaymentGateway` and `EventPublisher`.
49. **Articles with a downstream booking (fulfilment port).** An article may name a fulfilment adapter
    (`fulfilment: 'hourly-slot'`). `ArticleFulfilment` is a plain object `{ id, reserve(draft, ctx) → hold
    {id, expiresAt}, confirm(hold, line, tx), release(hold, reason) }`, registered through
    `ctx.articleFulfilment(id, adapter)`.
    - `extraSale.quote` calls `reserve` (a hold on the slot: stock, heat-up, overlaps are the adapter's
      business, via `SlotAvailabilityProvider`); `extraSale.sell` calls `confirm` **inside the sale
      transaction**, so a line is never written without its booking nor a booking without its line; cancelling
      the line, the order or the stay, a lapsed card hold and a refund call `release`.
    - The bath adapter (`hourly-resources/bathFulfilment.js`) wraps today's `resourceHolds` /
      `resourceScheduler` registry slots; the guest-app pending card hold becomes its `hold`.
    - A fulfilment refusal at `confirm` aborts the sale (`SLOT_TAKEN`), it never leaves a paid line without a
      slot. Side effects that may fail without harm (e-mail, calendar, push) are not fulfilment: they are
      observers (rule 55).
    > **Pending** — PR B
50. **One settings interface (settings provider).** Every parameterised component exports `settingsSchema` =
    `[{ key, type, default, scope: 'global'|'property'|'article', validate }]` (the shape plugins already use
    for `SETTINGS`), and receives its values only through `SettingsProvider.for(componentId, scope)`, resolved
    article → property → global → default. Validation is the component's own `validate`. A key's `scope` is the
    **narrowest layer allowed to set it**: the provider skips only the layers narrower than that scope (a property-scope
    key is answered by the property layer, else the global one; an article layer says nothing for it). A layer with no row
    or column for a key says nothing (`undefined`) and the next one answers; a row whose column is NULL says `null`, and
    **NULL is a value** that wins. The default applies only when every layer said `undefined`, and it is what the engine
    does with an absent column (SCHEDULE: `depositPercent` 0, `depositEnabled` 1).

    | Component | Keys (scope) | PR A adapter reads today's |
    |---|---|---|
    | NIGHTS | `tariff` (property: rules, seasons, weekly model, degressivity, min/max nights, changeover) | `pricing_rules`, `tariffSnapshot`, property columns |
    | EXTRA GUESTS | `includedGuests`, `extraGuestPrice`, `extraGuestPriceUnit`, `tiers` (property) | `basePriceIncludedGuests`, `extraGuestPrice(Unit)`, tier tables |
    | TOURIST TAX | `mode`, `perPersonNight`, `percentage`, `departmentPercentage`, `fixedAmount`, `cap`, `exemptions`, `collector` (property; `collector` per platform) | `touristTax*` property columns, platform tax rows; `cap` / `exemptions` default to the values hard-coded today |
    | PLATFORM PRICE | `commissionRate` (global, per platform; the schema has no `mode` key) | `platforms.commissionPercent`, read by the display grid (`grossFromNet`) only — the engine never computes a commission from a rate (rule 70) |
    | VAT | the eight rate keys `rate.<vatClass>.<customerContext>` (article; default `null` = the regime's rate; the regime itself stays outside the provider, per sale period) | `vat_periods` through `vatRegimeModel`; every `rate.*.hosted` null = the regime rate; `rate.resources.external` = hourly-resources `standaloneVatRate` (moved in PR B) |
    | STAY CLOCK | `defaultCheckIn`, `defaultCheckOut` (property) | `properties.defaultCheckIn/Out` |
    | SCHEDULE | `depositPercent`, `depositEnabled`, `depositDueDays`, `balanceDaysBefore`, `cancelAfterBalanceDueDays` (property) | the same property columns |
    | ARTICLE FAMILIES / instances | `price`, `freeUnits`, `freeMinutes` (article), `maxGuests` (property); per family schema, values per article instance (e.g. `hourly`: grid, `freeMinutes`, evening band) | `property_option_prices`, `property_resource_prices` (a NULL column is no override), `options.price`, `resources.price`, `properties.maxGuests`, plugin settings |

    No component reads a property row. In PR A the adapters read exactly today's columns, so every quote is
    byte-identical; a settings UI is out of scope (§8).
    _(Delivered by PR A: the loader resolves `settings.<nights | extraGuests | touristTax | stayClock | schedule | vat |
    articles>` through the provider, the steps read `ctx.settings`, and `stayClockModel`, the catalogue provider and the
    platform grid read through it; the static guard `pricing-settings-wiring` (empty allow-list) fails on a property-row
    read inside a unit. Proof: `settings-provider`.)_
51. **VAT per line, by customer context; TOTALS only aggregates.** _(amended 2026-11-11, second round: VAT
    is the standalone component of rules 61-62; « family » below reads « vatClass ».)_ The VAT step gives every line (the
    accommodation and extra guests being lines of family `accommodation`) a rate from
    `resolveRate(family, customerContext)`, with `customerContext ∈ hosted | external`: `hosted` = the buyer
    has a stay on the domain (every reservation line, shop and SAS sale); `external` = a walk-in buying alone
    (rule 53).
    - Rounding keeps today's figures: VAT is computed once per (family, rate) group on the group's TTC total,
      exactly as the engine does per family today, then allocated to the group's lines with the largest-
      remainder rule of rule 40. With one rate per stay (today), totals are byte-identical.
    - The breakdown shows one row per rate (« TVA 10 % : 38,00 € »); with a single rate it is today's single
      row, so the devis PDF does not change.
    - Franchise mode (`vat-optional-mode.md`) is a regime whose rates are 0; nothing else changes.
    - Settings keys: `vat.rate.<family>.hosted`, `vat.rate.<family>.external`, overridable per article.
    > **Pending** — PR B: per-article VAT values and the allocation of a group's VAT over its lines for the display (PR A tags
    > three family totals: accommodation, options, resources).
52. **Freely chainable steps (pipeline).** A use case is a list of steps over one quote context. A step is a
    plain object `{ id, requires: [keys], provides: [keys], apply(ctx) → ctx }`; `apply` returns a new context
    (never mutates). `buildPipeline(steps, { initial })` checks, **when the pipeline is built (module load,
    covered by a test)**, that every `requires` key is in `initial` or provided by an earlier step and that no
    key is provided twice; otherwise it throws `PIPELINE_MISSING_INPUT <step>.<key>`. A step that is not in a
    use case is never called.

    | Use case | Steps |
    |---|---|
    | `stayQuote` (fiche, devis, intakes) | loadStay → clock → nights → extraGuests → discountLevers → extras → midStay → platformGross → touristTax → platformPrice → discounts → vat → totals → inComplement → schedule → platformPayment → settlement → netTotals (the order of `pipelines.js`) |
    | `ficheSale`, `sasSale`, `shopSale` | loadStoredStay (provides the stored nights, extra guests, tax, platform figures) → clock → extras → lineDiscounts → vat(hosted) → totals → settlement |
    | `externalSale` | loadCatalogue → extras → lineDiscounts → vat(external) → totals → payment |

    `compose.js` is `stayQuote` plus `shape()`; PR A proves it at 0 diff. The loader provides `families` (rule 47); the
    `extras` step requires it; the `nights` step may halt the run with `halt: true` (a stay with no night) and COMPOSE shapes
    the halted quote. The typed context is a JSDoc
    `@typedef QuoteContext` listing every key (`stay`, `phase`, `nights`, `extraGuests`, `lines`, `platform`,
    `discount`, `touristTax`, `vat`, `totals`, `schedule`, `settlement`, `customerContext`, `settings`).
    _(Delivered by PR A: `utils/pricing/pipeline.js` and `pipelines.js` build `stayQuote` from `utils/pricing/steps/`, one
    step per unit; the context is flat and its typedef lists the keys of every step. The steps follow the engine's own
    dependencies: `discountLevers` (the percent_of_stay base) precedes `extras`, `midStay` and `platformGross` precede
    `touristTax`, `platformPrice` follows it, `discounts` precedes `vat`, `inComplement` precedes `schedule` and
    `platformPayment` follows it (rule 70). The `clock` step carries the booking day, the stored acompte deadline and the
    arrival baseline the caller injects; the resolver's phase is not fed in PR A. Proof: `pricing-pipeline`,
    `pricing-pipelines`, `pipeline-composition`.)_
53. **The external sale.** A sale with no reservation (drinks to a walk-in, a bath hour sold at the door):
    `externalSale` pipeline, `customerContext = 'external'`, no nights, no tax, no schedule, no clock. It is
    paid on the spot (tender) or by a Qonto link. It is recorded in a core `standalone_sales` record (§5, Q13)
    with its lines, priced by the same families and fulfilled by the same adapters; the accounting journal reads
    it through the existing `standaloneSales` hook (`utils/standaloneSales.js`), as external hourly bookings
    already are. An optional client name and e-mail; no client fiche is created. Only families that need no stay context are sellable externally (`fixed`, `per_unit`, `hourly`); a
    `per_night` / `per_person*` / `percent_of_stay` article answers `validate` → `NEEDS_STAY`, and the catalogue
    offered to an external sale lists only the articles marked « vendable hors séjour » (`article` setting
    `sellableExternally`, default false).
    > **Pending** — PR C
54. **A pipeline per caller, chosen by the caller.** The fiche save of a stay edit uses `stayQuote`; « Ajouter
    un produit » uses `ficheSale`; the SAS `sasSale`; the guest app `shopSale`; the « Vente hors séjour »
    dialog `externalSale`. No caller assembles steps itself.
    > **Pending** — PR B
55. **Domain events for side effects (observer).** After the sale transaction commits, `extraSale` publishes
    `extraSale.sold`, `extraSale.lineMoved`, `extraSale.lineCancelled`, `extraSale.refundOwed`,
    `standaloneSale.sold` through `EventPublisher` (the existing eventBus, added to `EVENTS`). Observers: the
    guest e-mail (order confirmation), Google Calendar (bath session), staff push, history mirrors. The money,
    the journal line and the fulfilment `confirm` stay inside the transaction; an observer's failure is logged
    and never undoes a sale.
    > **Pending** — PR B
56. **No class hierarchy, no DI framework.** Components, families, instances, adapters, steps and ports are CommonJS
    modules exporting plain functions and objects. Wiring is explicit in `pipelines.js` and in plugin
    `register` functions.
57. **Each new interface has a contract test.** `article-family-contract` runs every registered family (core
    families and `hourly`) through the same cases (validate refuses out-of-bounds, quote is deterministic,
    describe matches quote); `article-fulfilment-contract` runs reserve/confirm/release against the bath
    adapter (overlap refused, heat-up honoured, release frees the slot, confirm inside a rolled-back
    transaction leaves nothing); `pipeline-composition` builds every use case and proves a missing input fails
    at build time.
    _(Delivered by PR A: `article-family-contract` runs the seven core families and `hourly` — the family the head calls
    through `pluginFamily.js`, with the contributor alias kept for `offered` — through the same cases, and
    `pipeline-composition` the use cases.)_
    > **Pending** — PR B (`article-fulfilment-contract`).
58. **Q11 resolved:** a new discount typed on the fiche targets « Nuits » by default.
    > **Delivered by PR B** (pass 4, C15): a payload without `discountTarget` reads `nights`; one without it on an update keeps the stored one.
59. **Q12 resolved:** a stay discount never covers sales added later; a later sale gets its own line discount
    (rule 39).
    > **Delivered by PR B** (pass 4, C15): `coveredLines` takes only `source` fiche / devis / intake; a shop or SAS line, a paid line and an
    > offered line keep their price.
60. **Where each interface lands.** Registry, core kinds, ports, settings provider (reading today's columns),
    VAT per (family, rate) group with line allocation, pipeline and `stayQuote`: PR A (0 diff). Fulfilment
    port and bath adapter, domain events, the `ficheSale` / `sasSale` pipelines, external-context VAT keys:
    PR B. `shopSale`, the external sale (`externalSale`, `standalone_sales`, dialog), guest-app observers: PR C.
    _(amended 2026-11-11, second round:)_ the Articles head, family registry, instance factory and the VAT
    component with its five former copies switched to it: PR A. `AccountingOutput` and its exporters: PR B,
    commit 2. Static duplication guards: introduced in A with allow-lists, strict at the end of C.
    _(Delivered by PR A: the registry, the core kinds, the ports, the settings provider over today's columns (the engine
    receives its values through it, rule 50), the VAT component with its readers switched (`vat-component`), the pipeline
    and `stayQuote`.)_
    > **Pending** — PR B: the VAT with line allocation (rule 51); PR A computes it once per (vatClass, rate) group.


### 3.L Second amendment round (owner, 2026-11-11) — VAT component, accounting output, no duplication

61. **VAT is a standalone component, fed by tagged amounts.** Like the stay clock, it sits beside the
    pipeline and every component that produces money consults it; **no other component, family or exporter
    computes a rate, a VAT or a net amount**.
    - Every producer emits `TaggedAmount = { amountCents (TTC), vatClass, customerContext, source: { kind:
      'accommodation'|'extraGuests'|'line'|'touristTax'|'adjustment'|'standalone', ref }, docKey }`. NIGHTS,
      EXTRA GUESTS, the article families, DISCOUNTS (negative amounts on the discounted classes), TOURIST TAX
      (`vatClass: 'outOfScope'`) and the external sale all emit them.
    - `vat.vatOf(taggedAmounts, { regime, settings })` is the only place that resolves `rate =
      resolveRate(vatClass, customerContext)` (settings keys `vat.rate.<vatClass>.<customerContext>` through
      `SettingsProvider.for('vat', scope)`, regime and franchise from `vat_periods`) and returns per amount
      `{ rate, vatCents, netCents }`, per group and per rate.
    - VAT classes: `accommodation` (nights and extra guests), `options`, `resources` (today's three
      families, the default class of every existing article, so PR A is 0 diff), then any class the owner adds
      (`drinks`, `wellness`…) by setting an article's `vatClass`.
    - TOTALS aggregates `vat.vatOf` output; the payment-link items, the refund lines, the accounting output and
      the finance pages read the same output instead of re-splitting a TTC amount.
    > **Pending** — PR B: the producers other than the engine's three families emit tagged amounts (DISCOUNTS lines, the external sale), and the refund lines, the accounting output and the finance pages read the `vatOf` output. PR A ships the component (`vat-component`): the engine tags the accommodation, options and resources amounts, and the engine, the stored summary and split, the accounting buckets, the finance HT, the payment-link basket helpers and the hourly bookings call it, each with the rounding strategy it had.
62. **VAT is computed per (vatClass, rate, customerContext) group per document, never per article.**
    _(decision 2026-11-11.)_ For one document (a stay quote, a sale, an export bucket), the amounts of a group
    are summed, the VAT is rounded **once** on the group (`round(ttc × rate / (100 + rate))`, half up, in
    cents), then allocated to the group's amounts by largest remainder (rule 40) for per-line display and
    refunds.
    - Why: it is today's arithmetic (one rounding per family on the family total), so PR A, the payment links
      and the exports stay byte-identical; the VAT per rate shown on an invoice or a Qonto basket is then exactly
      the sum of its lines, with no cent drift; per-article rounding would make the document's VAT per rate
      differ from the sum of rounded lines by up to one cent per line, and would change the CSV of months
      already declared.
    - Tie rule: `roundMoney` is `Math.round` on the float product, so half goes toward +∞; on a negative amount (a
      discount's group) the VAT may differ by one cent from the mirror of the same sale at an exact tie. PR B's discount
      lines list it.
    - Consequence: there is **no switch** to per-article rounding and therefore no expected diff for it in PR B.
      A document whose articles get new classes splits into more groups naturally; with today's settings
      (three classes, one rate) nothing moves.
63. **`AccountingOutput` — one generic journal, format adapters.** `accountingOutput.journalEntries({ from,
    to }, readModels)` reads **only** the read models — sale lines with their VAT output (rule 61), stay-level
    amounts (`storedStayPrice`), settlements, receipts, tenders, refunds and refund lines, compensations,
    penalties, standalone sales (core `standalone_sales` and the hourly `resource_bookings` through the
    `standaloneSales` hook) — and produces neutral `JournalEntry = { date, kind: 'sale'|'receipt'|'refund'|
    'compensation'|'penalty'|'tip'|'discount'|'standalone'|'requalification', ref, lines: [{ role:
    'revenue:<vatClass>'|'vat:<rate>'|'touristTax'|'customer'|'platform'|'commission'|'bank'|'cash'…,
    amountCents, vatRate?, vatCents? }] }`.
    - Exporters are adapters `{ id, export(entries, { accountPlan, period }) → { filename, contentType,
      body } }`: `csvJournal` (today's `/api/accounting/sales.csv`, latin-1), `salesJson` (`/api/accounting/sales`),
      `synthesis` (VAT return and checks, `/api/accounting/synthesis`), later `fec`. The account plan
      (`accountPlan.js`, platform accounts) maps a role to an account number and is shared by the exporters.
    - **No exporter recomputes a price or a VAT**; an exporter only formats, sums cents and maps roles.
    - Legacy rows without per-line contributions are read through **one** legacy read-model adapter
      (`legacyBucketSplit`), which keeps today's `computeBucketTtcsFromContribs` / `grossRatio` derivation in a
      single place and emits the same tagged amounts, so old months export byte-identically.
    > **Delivered by PR B** (commit `refactor(accounting)`, 0 output diff): `utils/accounting/accountingOutput.js` builds the
    > entries and `journalEntries` assembles the month's stream from the read models (`accountingModel.js` keeps the SQL and
    > the settings); the refund entries are `utils/pricing/refunds/journal.js`; `legacyBucketSplit.js` holds the legacy
    > derivation (the stored contributions, the tourist-tax routing, the gross-up of a platform stay, the booked split of a
    > bucket); `exporters/csvJournal.js`, `salesJson.js` and `synthesis.js` format, sum cents and map roles through the
    > plugin's account plan, and the CSV file is built by `csvJournal.export` (latin-1, same name and bytes). The plugin
    > keeps its routes, account plan, settings, platform accounts and `controller.js`, and reaches the core through six SDK
    > modules (`accountingOutput`, `legacyBucketSplit`, `refundJournal`, `csvJournal`, `salesJson`, `synthesisExporter`).
    > `accounting-output-replay` pins the CSV bytes, the sales JSON and the synthesis of every month of the golden database;
    > `accounting-legacy-bucket-split` and `pricing-refunds-journal` cover the units without the plugin.
    > **Pending** — PR B: the neutral `JournalEntry` role shape and the read models fed with the sale lines and their VAT
    > output (rule 61) and `storedStayPrice`: the entries keep today's shape (buckets, `taxTtc`, `commission`) until the
    > line allocation of rule 51 lands, and `addSaleLegs` / `closeStayBooks` still read the CSV journal's ventilation of an
    > entry.
64. **Today's accounting reads, and where each moves.**

    | Reader today | What it reads / recomputes | Moves to | PR | Proof |
    |---|---|---|---|---|
    | `plugins/accounting-export/accountingModel.js` (`buildEntry`, `buildInstallmentEntry`, `buildEndOfStayEntry`, `buildMidStayNoteEntry`, `buildRefundEntry`, `buildPenaltyEntry`, `buildCompensationEntry`, `buildArrivalAdjustmentEntries`, `buildSettlementDiscountEntry`) | stored row money; **recomputes** VAT (`bucketFromTtc` l. 1567), bucket TTCs (`computeBucketTtcsFromContribs` l. 1462, `computeTaxTtcForKind` l. 1422, `grossRatio` l. 1053-1116) | `AccountingOutput.journalEntries` over the read models; VAT via the VAT component; legacy derivation in `legacyBucketSplit` | B (commit 2) | CSV of every month 2025-2028 and the golden `csv/*` keys byte-identical |
    | `plugins/accounting-export/accountingExport.js` (`entryToRows`, `rowsAtDefaults`, `bookedBucketSplit`, `entryVentilation`, own `round2`) | entries → CSV rows, ventilation residue on the last line | `csvJournal` exporter (formatting only) | B (commit 2) | same CSV hashes |
    | `plugins/accounting-export/synthesis.js` (own `cents`/`euros`/`roundHalfAway`) | VAT return, checks, collections from entries | `synthesis` exporter over the same entries; helpers from `money.js` | B (commit 2) | golden `finance/*` and synthesis hashes |
    | `utils/standaloneSales.js` hook ← `hourly-resources/bookingsModel.standaloneSales` | hourly bookings' journal rows (own `vatOf`) | read model for `AccountingOutput`; VAT via the VAT component | A (VAT), B (read model) | hourly booking rows byte-identical |
    | `models/financeModel.js` (`htAmount` l. 188; engine replays l. 291, 1185, 1286) | finance pages; **recomputes** HT | `htAmount` → VAT component (A); replays become the `stayQuote` pipeline (A, automatically) | A | golden `finance/*` |
    | `models/touristTaxReportModel.js` (engine replay l. 71) | tourist-tax report | TOURIST TAX component directly | B | golden `tourist-tax/*` |
    | `models/financeModel.js` l. 1266 (`accommodationAmount`: the tourist-tax extraction `totalPrice / (1 + vatPercentageAccommodation / 100)`) | the accommodation net of VAT, for the tourist-tax finance view | VAT component, with the tourist-tax report | B | golden `tourist-tax/*`, `finance/*` |
    | `utils/paymentLinkItems.js` `buildVatItems` | **recomputes** HT per Qonto item | VAT component output | A | golden `link/*` (34 baskets) |
    | `plugins/online-payment/reconciliation/expectedReceipts.js` | the core ledger (`buildLedger`), own `cents`/`round2` | unchanged reader; helpers from `money.js` | C | reconciliation tests |
    | `utils/cancellationRequalification.js`, refund lines (`reservation_refund_lines.vatRate`) | credit note lines, VAT rate stored at creation and re-rated with the stay's period (rule 77) | entries from the read models; the stored rate is the input of the re-rating, as today | B (commit 2) | golden `cancel/*` |
    _(Delivered by PR A: the rows marked A — the hourly bookings' VAT through the VAT component, `financeModel.htAmount`
    through it, the engine replays being the `stayQuote` pipeline through COMPOSE, and `paymentLinkItems.buildVatItems`
    calling the VAT component's integer-cent helpers. The copies that still wait are listed, with their PR, in the `vat`
    allow-list of rule 66.)_
    > **Delivered by PR B** (commit `refactor(accounting)`): the rows of `accountingModel.js`, `accountingExport.js`,
    > `synthesis.js`, the hourly sales read (`standaloneSalesByMonth`, a read model of the journal) and the refund entries.
    > **Delivered by PR B** (commit `refactor(tourist-tax)`): the tourist-tax report and `financeModel.js` l. 1266 (accommodation
    > net of VAT, through `vat.netFirst`), `devisPdf` ×2. **Pending** — PR C: `expectedReceipts` and `invoiceIssuer`.
65. **No duplication: every formula exists once.** (owner: « toujours des petits composants simples et
    testables, sans dupliquer aucune logique ni ligne de code ».) A formula, a rate resolution, a rounding
    helper, a date comparison or a price grid has exactly one home; every other place calls it. The refonte
    removes:

    | Duplicate today | Copies | Single home | PR |
    |---|---|---|---|
    | VAT split TTC → HT/VAT | engine per family, `accountingModel.bucketFromTtc`, `financeModel.htAmount`, `paymentLinkItems.buildVatItems`, `hourly bookingPricing.vatOf` | VAT component | A |
    | VAT net copies found by the PR A review (listed in the `vat` guard, rule 66) | `accountingExport` ×2 and `accountingModel` ×5 (net first or HT forms), `devisPdf` ×2, `financeModel` l. 1266, `touristTax.vatDivisor`; and, by the lead's decision (no Qonto change in A), `invoiceIssuer.ttcOf` ×2 | VAT component | B (all but `invoiceIssuer`: C, with its integer-exact `lineTotalCents`) |
    | Money helpers (`round2`, `roundMoney`, `cents`, `euros`, `roundHalfAway`) | ~20 files | `money.js` | A (engine), C (others, where the replay proves them identical) |
    | Hourly grid and evening supplement | `priceSessions`, `bookingPricing.priceBookingLines`, `scheduler.slotsForStay`, `schedulingModel.supplementOf`, `scheduler.orderSupplement` | `hourly` family | B |
    | "Has the stay started" / date comparisons | 16 call sites (rule 45, three of them in the intakes) | STAY CLOCK | B, C |
    | Accounting / collection recomputations | `computeBucketTtcsFromContribs`, `computeTaxTtcForKind`, `grossRatio`, `complementPaidSplit.contribSplit`, `installmentPaidSplit` pro rata, `arrivalPaymentDetail.billableLines`, `paymentsController.resolveAmountCents` (devis replay), `resolveInstallmentComponents` (tax share) | read models + VAT + SETTLEMENT; legacy derivation once in `legacyBucketSplit` | B |
    | "Offered" | engine `applyOfferedToLine`, SAS `offeredExtras`/`cleaningOffered`/`bathLinenOffered`, booking `offeredMinutes` | Articles head | B |
    | Extras arithmetic outside the engine | `sasOptionSale`, `getBathLinenOfferForReservation`, `resolveSasArrivalItems`, `sellable.optionFreeUnits` | families via the head | B, C |
    | Persons ceiling | `resolveServedPersons`, `midStayOrderCommit.personsShortfall` | `per_person*` families' `validate` | C |
    | Property price-override lookup | `reservationsModel` ×2, `bookingsModel` | `CatalogueProvider` | A (`reservationsModel` ×2); B (`bookingsModel`: plugin booking pricing is reworked with the HOURLY TARIFF, rule 24, and needs a new SDK core service) |
    | Platform gross/net | engine pin, `grossFromNet`, `platformPriceCheck` | PLATFORM PRICE | A |
    | Platform commission and payout | `utils/platformCommission.computePlatformCommission`, inline copy in `controllers/platformPenaltiesController.js` (`gross − payout − tax − acompteCommission`), `acompteNetOf` there and `platformAcompteNet` in `reconciliation/expectedReceipts.js`, `grossOf` there and in `reconciliation/ficheWriter.js`, engine `clampCommission` / `platformNetReceivedAmount`, `reservationSettlement.platformCommission` | PLATFORM PAYMENT (rule 70) | A (engine, `computePlatformCommission`), B (penalties, cancellation, settlement), C (reconciliation helpers) |
    | Largest-remainder allocation | `cancelReservation` (l. 155-162), DISCOUNTS (rule 40), VAT (rule 62) | `money.allocateCents` (signed weights) | A |
    | Deferral of a complement | `isComplementDeferred`, `complementBuckets`, column read | SETTLEMENT | B |
    > **Delivered by PR B** (commit `refactor(accounting)`): the seven accounting-export net-first copies (five in the entry
    > builders, two in the CSV writer) call the VAT component (`netFirst`, `splitTtc`) and leave the `vat` allow-list; the
    > exporters of `utils/accounting/exporters/` are inside the scope of the `exporters` guard. Commit `refactor(tourist-tax)`
    > removes `devisPdf` ×2, `financeModel` l. 1266 and `touristTax.vatDivisor` the same way: the `vat` allow-list holds the two
    > `invoiceIssuer` lines (PR C) and nothing else, and the `families` guard takes `utils/pricing/touristTax.js` as a second
    > home (the tax's person × night arithmetic). PR A removed the VAT copies listed above and the platform gross pin copy.
    > **Delivered by PR B** (pass 4b; class E4b; `hourly-booking-vat-one-cut`): the hourly bookings cut their VAT with `vat.splitTtc` (the VAT is the
    > rounded share, the net what is left); the two cuts are identical at 2.1, 5.5, 8.5 and 10 %, and at 20 % the net moves by a cent on the tie
    > amounts (scope `resourceBookings`, a listed diff). **Kept apart, by the byte-identity of the books:** the accounting output, `legacyBucketSplit`,
    > the refund journal, `touristTax` and the devis PDF keep `vat.netFirst`. Their platform-commission entries are VAT 20 %, and merging the
    > cuts would move the commission VAT of the CSV months by a cent (golden `csv/2027-09`): a figure outside every listed class, so it waits for
    > the owner's call (open question). The TOTALS `vatByRate` / `breakdown` readers: `saleDetail` reads the VAT component's per-rate rows (rule 31).
    > **Pending** — the VAT per rate printed on the fiche and on the devis PDF (a visible row: mock-up first).
66. **Guards against re-introduction** (`server/src/tests/no-duplicate-formulas.unit.test.js`, static, part of
    the server suite):
    - VAT: no `/(100 + `, `* rate /`, `/ (1 + … / 100)`, `1 + rate / 100`, `rate / (rate + 100)`, `/ 1.055`-style divisor or
      `x − x / (1 + t)` expression, no `/ (( 100 + rate) / 100)` nesting, no `* 10 / 11` or `* 20 / 120` cut and no `/ 1.10`
      or `/ 1.20` divisor (a trailing zero is the same rate) outside `utils/pricing/vat/`;
    - money: no function definition of `round2`, `roundMoney`, `roundCents`, `toCents`, `fromCents`, `cents`, `euros`,
      `roundHalfAway`, and no inline `Math.round(… * 100) / 100` (or `1e2`), no number rounded back with `Number(…toFixed(2))`, `parseFloat(…toFixed(2))` or
      `+….toFixed(2)`, outside `money.js` (a `toFixed(2)` string shown to a reader is display formatting and is not a hit);
    - dates: the rule-45 single-source test (no phase or collection decision by date comparison outside
      `stayClock*`);
    - hourly: `priceRange(` / band arithmetic only inside the `hourly` family;
    - families: `getTypeMultiplier` and per-type arithmetic (`persons × nights`, and `adults`/`guests` × `nights` under any
      prefix or suffix) only inside `articles/families/`;
    - exporters: no import of `vat/`, `articles/`, the pipeline or the `utils/pricing` barrel from an exporter (they read
      entries only);
    - platform payment: the payout, acompte-net, gross-fallback, rent-less-net-rent, payout-with-penalty and commission-total
      forms of rule 70 outside `platformPayment.js`;
    - settings: no unit reads a property row (`pricing-settings-wiring`, rule 50): neither `property.x` nor a destructuring of
      the row (`const { x } = property`, `= ctx.property`); only `compose.js` carries the row, for the quote's `property` key.
    Each guard has an allow-list file that must stay empty at the end of PR C; entries are allowed while a copy
    waits for its PR. A generic copy-paste detector (e.g. `jscpd`) is not added: it would be a new dependency
    and the targeted guards cover the formulas that matter (Q14).
    _(Delivered by PR A: the vat, platform-payment, refunds, money, dates, hourly, families and exporters guards, declared in
    `tests/helpers/formulaGuards.js` (patterns as shapes, each with a probe line) and judged in `no-duplicate-formulas`
    against `fixtures/no-duplicate-formulas/*.json`. The comparison is a multiset: a second identical line in a listed file
    fails, and a listed copy that is gone fails. Each entry names the file, the exact line, its count, the PR that removes
    it and why it waits; the lists are regenerated from the tree by `tests/helpers/regenerateFormulaAllowLists.js`.
    Today: vat 13 lines (B 11, C 2), platform-payment 13 (B 7, C 6), refunds 43 lines in 40 entries (B 17, C 26), money 172 (C), dates 31 (B 15,
    C 16; `stay-clock-single-source` holds the list to rule 45's table), hourly 3 (B) and families 23 lines in 21 entries (B) wait for the Articles
    head to serve every seller, exporters 0. Each guard is proved on synthetic sources with planted copies
    (`formula-guards-mutants`), and the import graph, the head-only rule and the property-read guard likewise.)_
67. **Read models are the only inputs of outputs.** `saleDetail`, `AccountingOutput`, the finance pages, the
    tourist-tax report and the payment-link baskets read stored lines, stored VAT output and settlements; a
    replay of the pricing pipeline is allowed only where today's code replays the engine (finance projections
    of unsold periods), and it calls the same `stayQuote` pipeline, never a copy.
    > **Pending** — PR B


### 3.M Price non-regression gate and delivery pipeline (owner, 2026-11-11)

68. **Price non-regression gate — mandatory in PR A, PR B and PR C.** A golden-master test proves that no
    price moved on the current reservations.
    - **Fixture.** Every reservation and devis of an anonymised copy of production (the 2026-11-11 snapshot
      holds 71: 62 reservations, 9 devis), **frozen before PR A**. Per stay it holds the inputs (the rows the
      engine reads) and the figures the current code computes: nights, every extra line, discounts, tourist
      tax, VAT per rate, total, deposit / solde / installment schedule, paid, balance, and the cancellation
      indemnity where relevant.
    - **Anonymisation.** Only an allow-list of columns is copied: ids, dates, times, counts, amounts, flags,
      property, platform, prices, tariff rules, catalogue rows, installments, payments, refunds, VAT periods,
      non-secret settings. Nothing from `clients`, `reservation_history`, `email_*`, `guest_email_sends`, no
      free-text note, no name, e-mail, phone or address; secrets are never read. A test fails if any string in
      the fixture contains `@`, a phone-like sequence, or a column outside the allow-list.
    - **Where.** `server/src/tests/fixtures/price-gate/inputs.json` (the anonymised table rows) and
      `expected.json` (the figures), committed. The copy itself (`shadows/prod-2026-11-11/gf-snap.db`) never
      enters the repository.
    - **Units, each with its own test:** `scripts/price-gate/anonymise.js` (copy-by-allow-list, pure over
      rows), `scripts/price-gate/figuresOf.js` (the figure set of one stay from a quote and the stored row,
      pure), `scripts/price-gate/buildFixture.mjs` (CLI: opens a copy, runs both, writes the two files),
      `server/src/tests/helpers/priceGateCompare.js` (cent-exact comparison, returns every difference, applies
      the allowlist), and the gate itself `server/src/tests/price-gate.unit.test.js` (loads `inputs.json` into
      an in-memory database migrated by `database.js`, freezes the clock at the capture date, recomputes every
      stay through the new components, compares to `expected.json`).
    - **Delivered by PR A:** the figures are written exactly as the code returned them (no cent rounding; `Object.is`
      comparison, so `-0` and `NaN` are judged), at **four instants per stay** derived from its own row — the capture day,
      the minute before and the minute of its arrival at 15:00 Paris, the noon after its departure — so a date-dependent
      figure is judged. The fixture holds the 71 production stays, 29 synthetic stays (a refund case or a money path the
      snapshot has no example of), the resource bookings and the property grids; it was recaptured once on the tag with
      the strengthened gate (`price-gate-baseline`, `88e0aad7`).
    - **Any difference fails.** No tolerance, no wildcard, no rounding slack.
    - **The only exception: a versioned allowlist** `server/src/tests/fixtures/price-gate/allowlist.json`.
      Each entry: `{ reservationId, field, old, corrected, reason, rule, defect, approvedBy, approvedAt }`, for a
      stay known to be wrong today (e.g. review e M5: arrival detail not net of a card order). An entry matches
      one field of one stay with exactly the old and corrected values; anything else still fails. The owner
      reviews the allowlist diff before each PR merges; a PR that adds entries lists them in its body.
    - **Regeneration.** The fixture is captured once, on the last `inte/plugins` commit before PR A (tagged
      `price-gate-baseline`), with `node scripts/price-gate/buildFixture.mjs <copy.db> --out
      server/src/tests/fixtures/price-gate/`. It is never regenerated by code from PR A, B or C (that would bless
      their changes). Refreshing it on a newer prod copy means running the builder on a worktree of
      `price-gate-baseline`, and is done only at the owner's request.
    - Relation to rule 34: the prod replay stays the wide local proof (every export, every month, on the
      latest copy); the price gate is the committed, CI-run proof that travels with every PR.
69. **Delivery pipeline.**
    - Opus writes the specs, Sonnet implements, Opus reviews.
    - **A review is integral, in one pass.** The reviewer covers its whole perimeter and the neighbouring
      features. It proves the numbered checklist of owner decisions (rules of this spec and the amended rules
      of the specs it touches) line by line, each marked PROVEN or NOT PROVEN with its evidence (test name,
      replay hash, command output, screenshot). It keeps searching after the first defect and returns the
      complete list at once.
    - Then **one grouped fix** covering the whole list, then **one targeted verification pass** on the fixed
      items and their neighbours. No open-ended fix/review loop.
    - Each PR's body carries the price-gate result (rule 68), the replay result (rule 34) and the allowlist
      entries it adds.
    - **Stabilisation after the three PRs land** _(owner, 2026-11-11)_, run like the `inte/plugins` audit
      loop:
      - **One round** = one integral Opus audit over every pricing domain: nights, extras (head, families,
        instances), discounts, tourist tax, VAT, totals and schedule, payments and settlement, cancellation,
        external sale, J-7 guest app, accounting output, platform payment (rule 70), automatic platform intakes
        (rule 71), and the price gate of rule 68. Then **one grouped
        Sonnet fix** for the whole findings list, then **one Opus verification** of the fixes and their
        neighbours.
      - **Repeat while any defect remains, whatever its severity; stop at the first round with zero
        findings.**
      - Each round publishes a findings table (id, domain, severity, rule, evidence, status) and separates
        **old defects** (present before the refonte) from **regressions caused by our own fixes**. The table
        also gives the round-over-round count, so convergence is visible.
      - **How the rounds shrink quickly.** Every reviewer receives the numbered checklist of owner decisions
        (the rules of this spec and the amended rules of the specs it touches) and the invariant register
        (rules 2, 8, 12, 17, 21, 33-36, 45, 61-62, 65-68: money conserved, nights never re-priced by a sale,
        one home per formula, VAT once per group, the price gate at 0 unlisted diff…; validated by the owner
        2026-11-11, and it **grows round by round** with each new owner decision and each fix, rules 70-71
        joining it now). It covers its whole
        domain and the neighbouring features, proves every checklist line PROVEN or NOT PROVEN with evidence,
        keeps searching after the first defect, and **is not allowed to stop early**: a round ends when the
        checklist is exhausted, not when a first defect is found.
    > **Sans test** — delivery process (who writes, who reviews): proven by the review checklists of the PR, not by code.

### 3.N Platform payment and platform intakes (code check, 2026-11-11)

70. **PLATFORM PAYMENT — one home for what a platform pays out.** _(Code check 2026-11-11.)_ The engine does
    **not** compute a commission from a rate: the commission is a stored figure, entered by the operator or
    an intake, then clamped per instalment. The formulas found in the code, and their home in the refonte:

    | Formula | Where today | Home |
    |---|---|---|
    | Commission from the statement: `max(0, gross − payout − withheld tourist tax − acompte commission)` | `utils/platformCommission.js` `computePlatformCommission` (SDK `reservations.platformCommission`, used by booking-intake, airbnb-intake, the reconciliation `ficheWriter`) **and** an inline copy in `controllers/platformPenaltiesController.js` (~l. 98) | PLATFORM PAYMENT `commissionOf` |
    | Commission on the rent only (Gîtes de France): `rent − net rent`; the gross rent from the net via the centrale's euro rounding | `plugins/gites-de-france-intake/intakeService.js` `paymentPatch`, `rentFromNet.rentCandidates` | PLATFORM PAYMENT `commissionOf` with basis `rentOnly` (Q15); `rentCandidates` stays in the plugin (it is the centrale's rule), calling `money` helpers |
    | Each commission clamped to its instalment; total commission; net received = pre-arrival amount − commissions | engine `clampCommission`, `totalPlatformCommission`, `platformNetReceivedAmount` (`pricing.js` l. 2854-2873) | PLATFORM PAYMENT `clampCommissions`, `netReceived` |
    | Acompte already paid out net of its commission | `reconciliation/expectedReceipts.platformAcompteNet`, `platformPenaltiesController.acompteNetOf` | PLATFORM PAYMENT `acompteNet` |
    | Gross fallback (`platformGrossAmount` or deposit + balance) | `platformPenaltiesController.grossOf`, `reconciliation/ficheWriter` (~l. 80) | PLATFORM PAYMENT `grossOf` |
    | Payout including a penalty | `ficheWriter` (~l. 79), `platformPenaltiesController` (~l. 96) | PLATFORM PAYMENT `payoutWithPenalty` |
    | Still to receive, net of unpaid commissions and penalty | `utils/reservationSettlement.js` `remainingToPay` / `platformCommission` / `platformPenalty` | SETTLEMENT, reading PLATFORM PAYMENT `netDue` |
    | Gross (back-solved accommodation) vs net (commission) mode; gross for display from a net and a rate | engine pin (l. 2323-2340), `grossFromNet` | PLATFORM PRICE (rule 17), unchanged |
    | Withheld vs remitted tourist tax | `pricing.isPlatformCollectingTouristTax`, `isTouristTaxRemittedByOwner`, SDK `platformWithholdsTouristTax` (their conjunction) | TOURIST TAX (rule 3) `collector` output: `platformWithholds` |
    | Extra guests inside the gross | `splitExtraGuestCount`, the pin's `extraGuestInBrutSurcharge` | EXTRA GUESTS `inBrut` → PLATFORM PRICE |
    | Withheld commissions on a cancellation | `utils/cancelReservation.withheldCommissionsOf` (l. 165), `cancellationRequalification.withCommissions` (l. 196) | PLATFORM PAYMENT `withheldOnCancellation`; the spread over buckets uses `money.allocateCents` |
    | A platform stay's own buckets cannot be paid by a direct link | `utils/platformStayRefusal.js` (used by `paymentRequestService`) | SETTLEMENT `linkAllowed(bucket, channel)`: stay buckets of a platform stay → `PLATFORM_RESERVATION`, unchanged; **extra-sale lines are not stay buckets** and get their own link (rule 29) |
    | The solde of a stay with a withheld tax stays payable (`platformTouristTaxAmount` carried into the engine input) | `utils/reservationEngineInput.js`, spec `platform-tourist-tax-out-of-the-commission.md` rule 25 | the loader's `StayRepository.stay` input, read by PLATFORM PRICE and SCHEDULE |

    - **Contract:** `utils/pricing/platformPayment.js` — in **euros** in PR A (the engine's arithmetic; cents come with Q9):
      `commissionOf({basis, gross, payout, withheldTax, acompteCommission, rent?, netRent?}) → euros|null`,
      `clampCommissions({channel, solde, acompte, installmentPlan, preArrivalAmount, balanceAmount, depositAmount}) →
      {solde, acompte, total}`, `netReceived({preArrivalAmount, totalPlatformCommission}) → euros|null`,
      `acompteNet(row) → euros`, `grossOf(row) → euros`, `payoutWithPenalty({payout, penalty}) → euros`,
      `withheldOnCancellation(row) → {acompte, solde}`; the helpers are NaN-safe, like the copies they replace. Pure; a step of the `stayQuote` pipeline after
      SCHEDULE. SETTLEMENT, the reconciliation, the penalties controller, the cancellation and the SDK
      `reservations.platformCommission` all call it.
    - **Price gate:** the figures of rule 68 gain, for each platform stay (Booking 13, Gîtes de France 16,
      Airbnb 8, Lodgify 10, Abracadaroom 4, Abritel 3, Greengo 2 in the snapshot): commission (acompte and
      solde), net received, payout, withheld tax, penalty and the cancellation withheld commissions.
    - **PRs:** A (the module, the engine's clamp and net received, `computePlatformCommission` re-exported
      from it, 0 diff); B (penalties controller, `remainingToPay`, cancellation, `platformStayRefusal` as
      `linkAllowed`); C (reconciliation helpers). Rule 66 gains a guard: no `gross - payout` /
      `depositAmount - acompteCommission` expression outside `platformPayment.js` (delivered, with the other forms of the
      table: rule 66).
    > **Delivered by PR B** (pass 3): the unit gains `statementRemainder`, `statementPayout`, `bankReceived`, `totalCommission`,
    > `netOfCommission`; the penalties controller, the stored summary, the payment mark's gross fallback and `remainingToPay` call
    > it, SETTLEMENT's `linkAllowed` judges `platformStayRefusal` (which only reads the rows), and the Airbnb intake's payment block
    > takes its commission from the core (SDK `reservations.platformCommission`; airbnb-intake 1.1.11). The tourist-tax `collector`
    > asks the channel (`saleChannel` / `isNamedChannel`) instead of comparing the platform to `'direct'` by hand; an unmatched
    > platform keeps the legacy default (collects, does not remit), so no figure moves (Q-B18; `platform-payment-wiring`,
    > `tourist-tax-collector-by-id`). PLATFORM PAYMENT now ranks between SCHEDULE and REFUNDS in the import graph.
    > **Pending** — PR C: the reconciliation helpers. `pricingNoticesOf` keeps judging unclamped commissions (a cosmetic warning, accepted).
71. **Automatic platform intakes keep working, behind one versioned port.** _(Code check 2026-11-11.)_
    - **What exists.**
      - **booking-intake** (SDK `^2.15.0`), **airbnb-intake** and **gites-de-france-intake** (`^2.21.0`) write
        only through the SDK. They use: `reservations.getByIdWithDetails`; `reservations.updateBody(id)` (the
        stored PUT body); `reservations.update(id, patch, { label, client, reuseByEmail })` (the fiche's own
        save, `applyReservationUpdate`, client created in the same transaction); `reservations.suggestBeds`;
        `reservations.platformCommission`; `reservations.platformWithholdsTouristTax`.
      - The fields they set: `platform`, `reservationNumber`, `adults/children/teens/babies`, beds,
        `checkInTime`, `platformGrossAmount`, `platformTouristTaxAmount`, `platformPayoutAmount`,
        `platformCommissionAmount`, `notes`, and line arrays `options` / `customOptions` /
        `offeredOptionIds`, where **`inComplement: 0` means "paid to the platform"** (GdF supplements,
        Airbnb cleaning fee).
      - Each refuses a started stay by its own `startDate <= today()` (rule 45 rows added).
      - **iCal intake** (core, `models/propertyIcalModel.js` `syncSource`) inserts placeholder stays by SQL
        and prices their default option lines through `calculateReservationQuote` (`priceOptionLinesById`).
      - **google-vacation-rentals** is a read-only price feed calling `calculateReservationQuote` through
        `coreModule('pricing')`.
      - **The platform-booking-intake skill** fills the fiche through the UI, so it uses the fiche save.
      - The SDK was at 2.26.0 at the code check; PR A takes it to 2.27.0 (`ctx.articleFamily`, `plugins-phase-1-sdk.md` rule 50).
    - **Compatibility guarantee.** Every SDK function above keeps its name, arguments, return shape and
      semantics. `calculateReservationQuote` keeps its 137-key output (rule 4). The fiche save keeps
      accepting today's patch: an adapter maps a line's `inComplement` on a platform stay at intake to
      `collectAt = 'platform'` (0) or `'arrival'` (1), the same derivation as `legacyCollectAt` (§5). No
      plugin is forced to change; no SDK major bump.
    - **The new port (additive, SDK 2.28.0).** `PlatformBookingIntake`: `reservations.fromPlatform(payload,
      { label, client, reuseByEmail })`, with `payload = { platform, reservationNumber, stay: { propertyId,
      startDate, endDate, checkInTime? }, party: { adults, children, teens, babies }, beds?, money: { gross,
      payout, withheldTax, commission?, basis? }, includedLines: [{ articleRef | description, quantity,
      amount }], complementLines?: [...], notes? }`. It runs the `stayQuote` pipeline. Included lines are
      `collectAt = 'platform'`; the commission comes from PLATFORM PAYMENT when it is absent. It refuses a
      started stay through STAY CLOCK `arrivalDayReached` (`PAST_RESERVATION`, the same message). The old
      `reservations.update` path for an intake patch is implemented on this port internally (adapter), so
      both entries run the same code. The three intake plugins may move to it in PR C, with no behaviour
      change. `coreModuleHistory.json` records 2.28.0 (2.27.0 is `ctx.articleFamily`, PR A).
    - **Tests.**
      - Each intake plugin's existing suites stay green, unchanged, at every PR.
      - `platform-intake-port.unit.test.js` (contract and adapter).
      - **Intake replay**, `platform-intake-replay.unit.test.js`. What is replayed (2026-11-11, PR A review): the stored
        parsed intakes of the snapshot that were applied — 3 (two Booking intakes of one stay, one Airbnb), the others
        being refused or unapplied and so not replayed — anonymised by rule 68's `anonymise.js` into
        `fixtures/price-gate/intakes.json`; Gîtes de France has no stored intake, so its 2 parser fixtures; and 4 crafted
        intakes on 4 distinct stays. Each is replayed on its fixture platform stay: plan → patch → save. The stored row,
        lines and figures must equal the baseline capture — **0 diff**.
      - The price gate covers the resulting platform stays (rule 70).
    - **PRs:** A (adapter behind `reservations.update` and the intake replay at 0 diff); B (`fromPlatform` port,
      SDK 2.28.0, iCal default-option pricing through the Articles head); C (intake date checks through STAY
      CLOCK, optional plugin migration to `fromPlatform`).

### 3.O Refunds (owner, 2026-11-11)

72. **REFUNDS — the only component that computes a refund.** _(Owner, 2026-11-11: « c'est uniquement ce
    composant qui fera le calcul de remboursement ».)_ Refund arithmetic is spread today over about 38 files
    (`utils/refunds.js`, `overpayment.js`, `cancellationRequalification.js`, `cancelReservation`,
    `cancellationKeptForEmail`, `refundUntickGuard`, `paymentSettlementService.refundRefusal`, the finance SQL,
    the accounting export, the guest-app basket, the link poller); the map is in `docs/rapports/2026-11-11-refunds-map.md`.
    - **Home:** `utils/pricing/refunds/` in owner component 4 (Encaissement), beside SETTLEMENT and PLATFORM
      PAYMENT. Pure, `today` injected, money through `money.js`, VAT through the VAT component (refund lines are
      `TaggedAmount`s with `source.kind = 'refund'`), withheld commissions through PLATFORM PAYMENT. Loader
      `models/refundInputModel.js` builds one `RefundContext` per stay through the `PaymentLedger` port. No pricing
      unit imports REFUNDS (rule 2); SETTLEMENT re-exports its `refundsOwed`.
    - **Units, one test file each:** `register.js` (`classify`, `totals({scope})`, `order`), `collected.js`
      (`collectedByLine`), `refundable.js` (`budget`, `refundable`), `judge.js` (`judge`, `deletionRefusal`,
      `takeBackRefusal`), `overpayment.js` (`overpayment`, `introducedBy`), `owed.js` (`owedOnLinkPayment`,
      `owedOnBasket`, `owedOnLineLowered`), `cancellation.js` (`requalify`, `keptAfterLaterRefunds`); the journal
      entries of a refund are an `AccountingOutput` adapter (PR B, rule 63). `owedOnLineLowered` (rule 23) and the
      per-line trop-perçu of `overpayment` are one formula.
    - **PR A (0 diff):** every pure refund function moves verbatim; old paths re-export; each moved file keeps
      its own `round2` and its own tie rule (`capInOrder`, `spreadCents`, `absorb` are three different
      allocations, kept as named strategies) until the replay proves a merge (rule 38, PR C); the dead exports
      `splitHtVat`, `refundedTouristTax`, `refundsTotal` are removed; the price gate (rule 68) gains per stay the
      refundable lines, the collected TTC, the stored and live trop-perçu, the cancellation figures and the
      refund journal rows, plus synthetic stays from the refund test fixtures (the snapshot holds one refund).
    - **PR B** (decisions Q16, resolved 2026-11-12, §9; each change below is in the expected-diff list):
      - collected-by-line reads `payment_allocations` (rule 74), not a stored `settledCents`: a line's settled amount is
        the Σ of its allocations, computed in one place;
      - the trop-perçu is Σ allocations − line totals for **every** stay, legacy included (O-7 b), the legacy stays
        through backfilled allocations (stay-level through `legacyBucketSplit` where no per-line truth exists); only a
        free line of origin `overpayment` lowers it (O-6); rule 76;
      - refund obligations (O-2, O-5, O-10), rule 75;
      - `card` as a means with `providerRefundRef`, no Qonto refund API (O-3);
      - a refund line points at the precise sale line (`lineRef`, O-4), the legacy `lineKey` kept;
      - refund VAT is re-rated with the stay's period, as the code does today (O-8 a, rule 77): no change;
      - cancellation figures and nettings stored (O-9, rule 78);
      - one take-back guard, explicit finance scopes, the DB simplification of the map's §4.
    - Rule 66 gains a guard: no refund cap / trop-perçu / requalification arithmetic outside `refunds/`.
    - **Delivered by PR A (pass 5):** `register.js`, `collected.js`, `refundable.js`, `judge.js` (with the take-back
      refusal, the projected split injected by the caller), `overpayment.js` and `cancellation.js` hold every pure
      refund function of `refunds.js`, `overpayment.js`, `cancellationRequalification.js`, `cancelReservation` and
      `cancellationKeptForEmail`, verbatim, each keeping its own `round2` and its own tie rule (none is replaced by
      `money.allocateCents`); the old paths re-export; `splitHtVat`, `refundedTouristTax` and `refundsTotal` are removed;
      REFUNDS import `../storedLines` (the four stored-line parsers, moved there from SETTLEMENT), never `settlement` or
      the `midStayExtras` shim, print through `money.frenchEuros`, and require no ledger lazily; the
      import graph forbids a pricing unit to import `refunds/`; the refunds guard of rule 66 ships with its
      allow-list (`fixtures/no-duplicate-formulas/refunds.json`, 43 copies in 40 entries, each with the PR that removes it).
    > **Delivered by PR B** (pass 3): `models/refundInputModel.js` builds the context through the ports (`PaymentLedger.allocations` /
    > `receipts`, `StayRepository.stay` / `storedStayPrice`); `register.js` gains `classify`, `classifyLine`, `totals(refunds, {scope})`
    > (`given`, `journal`, `turnover`, `commune`: one declared filter each, `scopeSql` the same predicate for the finance SQL, which now
    > reads it), `order`; `judge.js` gains `judge` (`today` required) and `takeBackRefusal`, the one guard that merges the un-tick and
    > the correction of a split payment (judged on the amount collected before and after, in cents: a gesture that lowered nothing is
    > never refused); `overpayment.js` is the one formula of rule 76; `owed.js` holds `owedOnBasket`, `owedOnLinkPayment`,
    > `owedOnDuplicate`, `owedOnLineLowered` (rule 75); `card` is a means with `providerRefundRef` (O-3, no refund API is called); a
    > refund writes its `refund` / `refundDeleted` history entry; the deletion refusal reads `refund_nettings` (rule 78).
    > **Delivered by PR B** (pass 4): `collected.collectedByLine` takes `lineAllocations` (the payment rows that name a line, and the refs of
    > the two stay lines): when every payment row of the stay names a line, each line collected what its rows say (books or caisse interne side);
    > a stay with a stay-level payment row (a bucket with no per-line truth, a settlement) keeps the stored-money reading. 0 figure moved on the gate. The contract names
    > are `refundable.budget` / `refundable` (formerly `cancelledRefundBudget` / `buildRefundableLines`, still exported by the legacy
    > `utils/refunds` path under their old names), `judge.deletionRefusal` (formerly `refundDeletionRefusal`), and SETTLEMENT's face
    > `utils/reservationSettlement` re-exports `refundsOwed` (REFUNDS' `owed`).
    > **Delivered by PR B** (pass 4b): the poste split of the trop-perçu reads no audit log. `postesLeftOf` (pure, `refunds/overpayment.js`) and
    > `postesLeft` (`models/refundInputModel.js`) take each line against what the payments naming it collected (schedule scope; the complement
    > through its frozen split and its allocations), the contribs of removed paid lines and the tourist tax on its stay line. A stay whose
    > payments name no line has its excess on the accommodation (class O-7 where a legacy history used to explain it). `droppedSince`,
    > `droppedSinceCollection` and `touristTaxCollectedInComplement` are removed.
    > **Pending** — PR B: SCHEDULE's `overCollectedTtc` / `complementCollectedExcess` (quote keys, unchanged by this pass).
    > _(The price gate's refund figures and the synthetic refund stays were delivered by PR A: `price-gate-synthetic`.)_

### 3.P Delivery cadence of PR A (owner, 2026-11-11)

73. **Replay cadence in PR A** (owner, 2026-11-11): each commit runs the price gate (rule 68), the golden test and the move proof (`scripts/price-gate/move-proof.mjs`); the full prod replay of rule 34 and the full suites run at three checkpoints (after money/platform payment/nights/extra guests/tourist tax; after articles/VAT/discounts/totals; after schedule/settlement/stayQuote/intake adapter/refunds). A failing checkpoint is bisected over its commits. This amends rule 35's "every commit" for the full replay only.
    - **The move proof.** `move-proof.mjs [base]` reads `git diff base..HEAD` (default `HEAD~1`): every line a server or client source file loses must reappear, byte for byte but for its indentation, among the added lines of the diff (same file or another); blank lines, imports and export lists are the only glue. It prints the unmatched lines and exits 1. A move that renames or rewrites a line therefore fails; tests, fixtures and docs are not read. In practice (PR A review) the proof is **read, not only run**: every unmatched line is classified as rewiring or glue, and the added lines are printed beside it, commit by commit; the full replays run at the checkpoints. Pure logic in `scripts/price-gate/moveProof.js`, covered by `price-gate-move-proof.unit.test.js`.
    - **One shared recompute.** `scripts/price-gate/recompute.js` loads the fixture into a freshly migrated database, recomputes every stay and replays the intakes; the capture (`buildFixture.mjs`) and the tests call the same functions, so both sides run the same steps. The capture day is stored in the fixture (`meta.capturedAt`), never written in a test file.

### 3.Q Sale documents and payment allocations (owner, 2026-11-11)

74. **Sale documents, frozen lines, payment allocations — the client links them all.** _(Owner, 2026-11-11: « ce
    remboursement doit se baser sur une liste d'articles associés avec des prix adossés à un client ; c'est
    exactement la même chose pour une réservation de logement ; tout est mémorisé au moment de l'achat et on peut
    rattacher un paiement à plusieurs articles » — pattern used where it is judicious.)_
    - **Sale document** = a reservation or a standalone sale (rule 53), each belonging to one client. The client
      is linked at document level, not per line (a platform stay's payer is the platform; client merges and
      anonymisation touch one column).
    - **Lines with prices frozen at purchase.** Every amount is a line of its document, stored with its total at
      the moment of sale: the accommodation is a line « Hébergement » (nights, extra guests; the tourist tax its
      own line) re-priced only by an operator stay edit (dates, party, property), which is journaled as an
      amendment; extras are the lines of rules 12-13. No reader re-prices a stored line.
    - **The article list is stored in the database, self-contained.** Each line row keeps the snapshot of what
      was sold: `articleRef`, `family`, `label`, `quantity`, `unitPrice`, `totalCents`, `discountCents`,
      `vatClass`, `vatRate`, `components` (e.g. base / evening / free), `allowanceUsed`, `soldAt`, `source`.
      A later catalogue or tariff change never alters a stored line; display, refunds, accounting and the SAS
      read the row, never the live catalogue.
    - **Payment allocations.** A table `payment_allocations (paymentRef, documentRef, lineRef, amountCents,
      kind: 'payment'|'refund', at)` links each payment to the lines it covers, many to many (a line paid in
      several instalments, a payment covering several lines). A line's `settledCents` (rule 21) is Σ of its
      allocations, **computed, never stored** (Q16 call Q-B6b: one source); a refund (rule 72) is a negative
      allocation (`kind = 'refund'`) on named lines and names the payment it gives back. The refund lines carry **no**
      `paymentRef` column: the allocation is the single place that names the payment. Trop-perçu = Σ allocations −
      line totals, computed once by REFUNDS. Each allocation carries a `books` flag (Q-B4): the interior cash
      (« caisse interne ») moves money that is not in the books, and the finance scopes of D8 / D10 read the flag.
      A legacy refund with no derivable payment is stored with `paymentRef` NULL (Q-B5). A requalification avoir and
      a geste / reste write no allocation: they move no money (Q-B6).
    - **Standalone sales** (amends rule 53, owner 2026-11-11): an anonymous sale goes to one shared client
      « Passage »; when a name or e-mail is typed, the sale attaches to the matching client fiche or creates one.
    - **PR:** none in A (0 diff). PR B: the accommodation and tax lines, `payment_allocations`, backfill from
      stored contribs / splits / receipts (amounts untouched, rule 36; legacy rows without per-line truth get one
      stay-level allocation through `legacyBucketSplit`), REFUNDS and SETTLEMENT reading allocations. PR C: the
      standalone sale on the « Passage » client.
    > **Delivered by PR B** (commit `feat(db)` stay-level allocations): the backfill of the buckets, notes and installments without
    > per-line truth (`pricing-allocations-backfill` checks Σ allocations = the paid bucket on every stay of the price-gate fixture).
    > **Delivered by PR B** (commit `feat(db)` live allocations): every path that moves money rebuilds the stay's rows in its own
    > transaction (`utils/paymentAllocationsSync.js`, the function the backfill runs, reconciled by key so a row keeps its id and
    > its `origin`), and the refund model writes the PR B columns of a refund with its negative rows. A trigger-fed table
    > (`payment_allocations_dirty`) marks any stay a statement changed behind the hooks and the reader flushes it first, so a missed
    > path is late, never wrong (`pricing-allocations-live`). A bucket lowered after it was paid keeps the contribs it captured as
    > its allocation: they are what the guest paid (rule 34).
    > **Pending** — PR B

### 3.R Rules added 2026-11-12 (PR B, owner decisions Q16)

75. **Refund obligations — money that must leave, kept in one register** _(owner O-2, O-5, O-10, Q16)_. A table
    `refund_obligations (id, reservationId, origin, paymentLinkId, lineRef, amountCents, reason, createdAt,
    status, settledAt, settledBy)` holds every refund owed and not yet paid out. `origin` is one of `basket`,
    `duplicatePayment`, `withdrawnLink`, `lineLowered`, `orderConflict`, `neverBooked`; `status` is `open`,
    `settled` or `cancelled`. The register holds money that **left** (or must leave) only: nothing in it is a
    sale (conflict C-1). The ledger's « À rembourser » rows are its open rows and offer a close action; the link
    poller (`settleBasket`, `recordRefundOwed`), the withdrawn-link settlement and the lowering of a paid line
    (rule 23) write it. Money received for a stay that was never booked (O-5) is an obligation opened then
    settled, with no journal entry; `settledBy` is `provider` when the payment provider refunded it, else
    `refund:<id>` (Q-B22). The legacy `basketJson.refundOwed` becomes an open row, a link with
    `cancelReason = 'refunded'` a settled row (`provider`). The `orderConflict` origin is written by the J-7
    code (PR C).
    The close action is `PATCH /api/reservations/:id/refund-obligations/:oid` `{ status: 'settled' | 'cancelled' }` (409 on a row
    already closed, 404 on another stay's); a basket row also clears its link's `refundOwed` flag, and the stay's history says so.
    The ledger gives the open rows a « Marquer remboursé » action (the server words the row, the client renders it); a
    `lineLowered` row has none of its own, the « Trop-perçu » row being its face.
    > **Delivered by PR B** (pass 3, UI): `FinanceSection` renders the server's `closeObligation` action (confirm, `PATCH`, re-read; Vitest `FinanceSection.obligation`), `RefundDialog` offers « Carte » with the provider reference (`RefundDialog.card-means`); checked in headless Chromium at 390 and 1280 px (no horizontal scroll, 44 px button, row gone after closing).
    > **Delivered by PR B** (pass 3): `refund_obligations` written by `settleBasket`, `recordRefundOwed`,
    > `settleWithdrawnPayment` (opened then settled, `neverBooked` for a devis), the confirmed lowering of a paid line; the close
    > action and its ledger rows (`refund-obligations`, `pricing-refunds-owed`).
76. **One trop-perçu formula for every stay** _(owner O-6, O-7 b, Q16)_. The trop-perçu is the Σ of the stay's
    allocations (rule 74) minus its line totals, for every stay: legacy stays read allocations backfilled from the
    stored contribs, splits and settlements, stay-level through `legacyBucketSplit` where no per-line truth exists
    (owner choice, **not** the recommended adapter: every legacy figure that moves is listed in
    `allowlist.json` for the owner's review, rule 68). Only a free refund line of origin `overpayment` lowers it;
    a gesture line does not (O-6, conflict C-5; 0 production rows). A platform stay keeps the refunds rule 38 (no
    trop-perçu), its allocations following the D25 pool and the amount received (Q-B3). The stored and the live
    figure are one function of REFUNDS.
    The stay's total is its stored price (`finalPrice` + tourist tax, the sum of its lines); what the end-of-stay complement
    collected for the departure's own sales (SAS-owned detail lines) is no part of it, the paid complement the operator adjusted is left
    out of both sides, and the live figure of a posted fiche is the stored one plus the drift between the engine's price of the stored
    stay and of the posted fiche (never below a total of nothing). A bucket lowered after it was paid keeps the contribs it captured as
    its allocation, so the excess survives the save that lowered it.
    > **Delivered by PR B** (pass 3): `overpayment(ctx, { basis })`, loaded by `refundInputModel`, read by the 409 `OVERPAID`, the live
    > quote and the fiche (`refunds-trop-percu-every-stay`, `refund-input-model`, `pricing-refunds-overpayment`). Listed diffs: the
    > live figure of a stay whose engine price drifted since the sale no longer counts the drift (O-7), a free line without origin
    > `overpayment` no longer lowers it (O-6).
77. **A refund line is re-rated with the stay's period** _(owner O-8 a, final 2026-11-12, Q16)_. Refund lines
    store the `vatRate` of their creation, and a VAT regime switch or its undo re-rates them with the stay's
    period, exactly as the code does today (`vatRegimeSwitchModel`, `vat-optional-mode.md` rule 16, unchanged). The
    owner first chose a frozen rate, then reversed it on 2026-11-12 after seeing the residue it leaves on the
    4457 account: no code change, no figure moves. This amends `reservation-refunds.md` rule 14, the comment of
    `schema.sql` and the wording « frozen rate kept as stored data » of rule 64 (all « frozen » → « re-rated
    with the period »).
    > **Pending** — PR B: a test header cites this rule (`vat-regime-switch`, `vat-regime-undo-scheduled`); the three wordings are delivered, no code changes.
78. **Cancellation figures are stored** _(owner O-9, Q16)_. `reservations.cancellationKeptCents` and
    `cancellationIndemnityCents` hold the figures of the cancellation, read by the notice (`storedKeptOf`) instead
    of being derived from the history. A table `refund_nettings (avoirId, refundId)` records which refunds a
    requalification avoir netted, written once at the cancellation and read by the deletion refusal;
    `cancellation_compensations.refundId` names the refund a compensation paired with. Backfills read the
    stored history and amounts only (rule 36).
    > **Delivered by PR B** (pass 3): `cancelReservation` stores the two figures, writes the nettings and pairs the compensation in
    > its own transaction; `storedKeptOf` and the deletion refusal read them (`cancellation-stored-figures`).
79. **Line identity** _(owner O-4, Q16 call Q-B1, as built 2026-11-12)_. Every line row of the three line tables
    (`reservation_options`, `reservation_resources`, `reservation_custom_options`) has a stable `lineId`, numbered from a
    sequence that never gives a number twice (a deleted line's number is not reused), and a line is addressed as
    `lineRef = line:<table>:<lineId>`. A fiche save keeps it: it stays a DELETE + INSERT in the engine's order, but each
    line sold again is written with the `lineId` and every column the writer does not know (the sale columns of rule 74,
    the SAS marker), read from the row it replaces: by article for a catalogue line, by text for a custom line.
    **Why not a rebuilt table with an `id` primary key and an upsert** (the Q-B1 call): that `id` is the row's rowid, so
    rows would come back in creation order, and the ~115 readers that select lines without sorting (e-mails, the stored
    split, the SAS payloads) would stop returning them in the engine's order after an article is added. The intake replay
    showed it (a line moved from third to fourth); a separate `lineId` keeps the physical order, adds a column instead of
    rebuilding two tables, and leaves the primary key `(reservationId, optionId)` in place, so a rolled-back release runs
    unchanged (self-update rule 31) and its rows are numbered by the trigger. Rule 13 (a second line of the same article)
    will have to drop that key: a trade-off for the commit that writes it, reported then. A refund line's `lineRef` is
    backfilled where its legacy `lineKey` matches exactly one current line, NULL otherwise; `lineKey` stays.
    Tests: `booking-lines-identity` (the save keeps the number and every column, writes what the old one wrote, in the same
    order), `pricing-lines-migration` (the numbering, the sequence, the previous release's writers).
80. **Delivery cadence of PR B** _(rule 73 applied to PR B)_. Each commit runs the fast check: the price gate, the
    intake replay, the golden test, the pricing and articles units, the settings provider, the duplication guards
    and the files of the commit, plus `scripts/check-spec-coverage.mjs`; the move proof for the move commits. Three
    checkpoints run the full server suite and the full prod replay (after the schema and accounting-output
    commits, after the behaviour commits, at head); the end-to-end suite runs once at head. The spec status flips
    to PR B in the last commit only, when no `> **Pending** — PR B` line remains.
    **Sans test** — a delivery process, not a behaviour: the proof is the commit history and the PR body.
81. **Price-gate allowlist scopes and the replay `--expect` file** _(Q-B7)_. An `allowlist.json` entry carries a
    `scope` (`stays` by default, then `synthetic`, `resourceBookings`, `propertyGrids`), so a listed difference
    is matched in the artefact family it belongs to and an empty list keeps its meaning. `scripts/pricing-replay.mjs
    --expect <file>` takes a list of artefact keys, each with a reason, and treats exactly those as the expected
    differences of a run. The write-path replay of D9 (refund create, refusal, requalification, un-tick, deletion,
    D25 pool, end-of-stay refunds) is captured **only** on a worktree of the tag `price-gate-baseline`
    (`scripts/price-gate/buildWriteReplay.mjs`, `fixtures/price-gate/writes.json`), never on the branch under test.
    A migration that adds a column changes the hash of every payload that spreads a whole row without moving a figure:
    `pricing-replay.mjs --out-values` / `--compare-values` judge the captured values, ignoring the keys the new code adds.
    A figure that no longer exists is approved with `removed: true` and `corrected: null`: such an entry matches an
    absent value only, never a figure that became `null` (`price-gate-compare`).
    Tests: `price-gate-scopes` (scopes, `--expect`), `price-gate-writes` (the seven write-path cases, to the leaf; a key the
    baseline body did not carry, such as a column added to a row the response spreads, is additive and not judged).

## 4. Architecture

> **Fat backend, thin frontend.** Every amount, status, discount share and grouping in this spec is computed
> on the server. The client renders `saleDetail` and quotes.

### 4.0 Design patterns

| Pattern | Where | Why, in one line |
|---|---|---|
| **Strategy + registry** | `articleFamilies`, `articleFulfilment` (rules 47, 49) | one generic formula per pricing family, and plugins add a family without touching the core |
| **Factory** | `makeArticle(catalogueRow)` (rule 47) | an article is configuration, not code: a new article is a catalogue row, never a new module |
| **Façade (head component)** | `articles/index.js` (rule 47) | the rest of GuestFlow sees one Articles interface, so families can change without touching any caller |
| **Tagged amounts** | `TaggedAmount` → VAT component (rules 61-62) | producers say what an amount is; one component decides its VAT, so VAT exists once |
| **Adapters for outputs** | `AccountingOutput` exporters (rule 63) | one neutral journal, one adapter per file format, no exporter recomputes money |
| **Ports & adapters / repository** | `models/ports/*`, plugin adapters (rule 48) | components stay pure and testable; the DB, Qonto and plugins sit behind a few plain functions |
| **Pipeline** (steps with `requires` / `provides`) | `pipeline.js`, `pipelines.js` (rules 52-54) | a use case runs only the steps it needs, and a missing input fails when the pipeline is built, not on a guest's request |
| **Observer / domain events** | `eventBus` events of rule 55 | e-mail, calendar and push react to a sale without the sale depending on them |
| **Settings provider** | `SettingsProvider.for(componentId, scope)` (rule 50) | one way to parameterise every component, with its own schema and validation, instead of reading property rows |

All of it is plain CommonJS functions and objects (rule 56).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/pricing/` | `nights.js`, `extraGuests.js`, `touristTax.js` | C | owner component 1, split in three (rules 3, 7-9) — moved from `pricing.js` l. 186-1400, 1736-1784, 2427-2539, 1354-1393 |
| `utils/pricing/` | `extras.js`, `allowances.js` | C | owner component 2 (rules 10-14, 26, 41) — moved from l. 315-480, 625-1180, 1838-2299 |
| `utils/pricing/` | `platformPrice.js`, `discounts.js`, `vat.js`, `totals.js` | C | owner component 3 (rules 15-17, 39-40) — moved from l. 2300-2606 plus `grossFromNet` |
| `utils/pricing/` | `stayClock.js` | C | STAY CLOCK `phaseOf` (rules 20, 44-46), consulted by every other component through the resolver |
| `utils/pricing/` | `schedule.js`, `settlement.js` | C | owner component 4 (rules 18-23, 37) — moved from l. 2615-3139 plus `complementBuckets`, `checkoutComplement`, `arrivalSasPlan`, `departureSasPlan`, `midStayExtras` routing |
| `utils/pricing/` | `compose.js`, `money.js` | C | rule 4 composition (= `stayQuote` + `shape`); rule 38 helpers |
| `utils/pricing/articles/` | `index.js` (head), `registry.js`, `makeArticle.js`, `families/{fixed,perUnit,perNight,perPerson,perPersonPerNight,percentOfStay,perParticipantProgressive}.js` | C | Articles head, family registry, instance factory, core families (rule 47) |
| `utils/pricing/vat/` | `index.js` (`vatOf`, `resolveRate`), `settingsSchema.js` | C | the VAT component (rules 61-62); replaces the five VAT copies |
| `utils/accounting/` | `accountingOutput.js`, `legacyBucketSplit.js`, `exporters/{csvJournal,salesJson,synthesis}.js` | C (PR B) | rule 63; `plugins/accounting-export` keeps its routes, account plan and settings and calls these |
| `utils/pricing/` | `articleFulfilment.js` | C | fulfilment registry (rule 49) |
| `utils/pricing/` | `pipeline.js`, `pipelines.js`, `steps/*.js` | C | `buildPipeline`, the five use cases, one step per component (rules 52-54) |
| `models/ports/` | `stayRepository.js`, `catalogueProvider.js`, `paymentLedger.js`, `settingsProvider.js` | C | the core adapters of rule 48; `settingsProvider` maps today's columns (rule 50) |
| `utils/` | `standaloneSale.js`; `models/standaloneSalesModel.js`; `controllers/standaloneSalesController.js` | C (PR C) | the external sale (rule 53) |
| `utils/` | `pricing.js` | T | becomes the wrapper + re-exports (callers unchanged until they migrate) |
| `models/` | `pricingInputModel.js` | C | the loader: property, rules, VAT regime, catalogue, platform tax rows, installments, split receipts, stored lines; takes the phase from `stayClockModel` |
| `models/` | `stayClockModel.js` | C | `phaseForReservation(id, now)` — the only resolver of the stay phase (rule 44) |
| `models/` | `extraSalesModel.js` | C | writes appended lines with moment/status/source/discount, bucket columns, history |
| `utils/` | `extraSale.js` | C | `quote` / `sell` orchestration (rules 27-30) |
| `utils/` | `saleDetail.js` | C | the read model of rule 31 |
| `controllers/` | `reservationsController.js` | T | `calculatePrice`/`createStay`/`applyUpdate` call the loader + COMPOSE; a sold stay's product addition goes to `extraSale`; `beforeArrival`, `orderGrowth`, `exactMergedTotals` removed (PR C) |
| `controllers/` | `extraSalesController.js` | C | the endpoints of §4.3 |
| `models/` | `reservationsModel.js` | T | `planArrivalSas`/`planDepartureSas`/`commit*Sas` delegate pricing to `extraSale` and buckets to SETTLEMENT; `settleOrderNoteBeforeArrival`, `keepStay` removed |
| `utils/` | `storedReservationQuote.js` | T | `pinOrderGrowth` removed; `storedStayPrice` added |
| `utils/` | `midStayOrderCommit.js` | **removed** (PR C) | replaced by `extraSale` |
| `utils/` | `sasOptionSale.js`, `complementPaidSplit.js` (`prepaidNetter`), `arrivalPaymentDetail.js`, `paymentLinkItems.js` | T → removed / thinned (PR B) | read `saleDetail`, SETTLEMENT and VAT instead of re-deriving |
| `utils/` | `financeCalcs.js`, `touristTaxReportModel` | T (PR B) | call TOURIST TAX directly |
| `plugins/accounting-export/` | `accountingModel.js`, `accountingExport.js`, `synthesis.js`, `controller.js` | T (PR B) | entry builders replaced by `AccountingOutput`; the plugin keeps routes, account plan, platform accounts and settings (delivered: `accountingModel.js` is the read model, the other three bind the core exporters to the account plan) |
| `utils/pricing/refunds/` | `journal.js` | C (PR B) | the avoir, requalification, indemnity-share and closing entries of a refund (rules 63-64) |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `coreModules.json` | T | `ctx.articleFamily`, `ctx.articleFulfilment`, `ctx.slotAvailability`; SDK exposes `extraSale`, `saleDetail`, `stayClock` instead of `midStayOrderCommit` |
| `plugins/hourly-resources/` | `pricing.js`, `hourlyPricing.js`, `scheduler.js`, `schedulingModel.js`, `sasStep.js`, `bookingPricing.js` | T | one HOURLY TARIFF registered as the `hourly` family; `scheduler`/`schedulingModel` read it; `sasStep.complementItems` → requests; `bookingPricing` VAT → VAT unit |
| `plugins/hourly-resources/` | `slotAvailability.js`, `bathFulfilment.js` | C (PR B) | `SlotAvailabilityProvider` and the `hourly-slot` FULFILMENT adapter (rules 48-49) |
| `plugins/sdk/` | `eventBus.js` | T (PR B) | the events of rule 55 added to `EVENTS` |
| `plugins/guest-app/` | `ordersController.js`, `arrivalOrdersController.js`, `shopController.js`, `sellable.js`, `index.js` | T (PR C) | judge = `extraSale.quote`; commit = `extraSale.sell`; order lines keep `reservationLineId` |
| `plugins/sas/` | `controller.js`, `arrivalRecap.js`, `departureRecap.js` | T (PR B) | recap = `saleDetail` + SETTLEMENT |
| `database.js` | `database.js` | T | idempotent migration of §5 |
| `scripts/` | `pricing-replay.mjs` | C | rule 34 |
| `scripts/price-gate/` | `anonymise.js`, `figuresOf.js`, `recompute.js`, `buildFixture.mjs`, `moveProof.js`, `move-proof.mjs` | C (PR A) | rule 68 fixture builder and shared recompute; rule 73 move proof |
| `tests/` | `price-gate.unit.test.js`, `helpers/priceGateCompare.js`, `fixtures/price-gate/{inputs,expected,allowlist}.json` | C (PR A) | rule 68 gate, cent-exact, owner-reviewed allowlist |
| `tests/` | `pricing-<unit>.unit.test.js` (one per unit and per family), `articles-head-contract`, `article-family-contract`, `vat-component`, `accounting-output-replay`, `no-duplicate-formulas`, `article-fulfilment-contract`, `pipeline-composition`, `settings-provider`, `stay-clock-model`, `stay-clock-single-source`, `extra-sale-<seller>.unit.test.js` ×3, `standalone-sale.unit.test.js`, `sale-detail.unit.test.js` | C | rules 43, 57 |

### 4.2 Client side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `SaleDetailList.js` | C | generic: renders `saleDetail` lines with source, status and discount chips (`StatusBadge`), grouped by article; a « Moment » menu on unpaid lines — used by the fiche, both SAS and the devis view |
| `pages/` | `ReservationPage.js` | T | « Ajouter un produit » on a sold stay → quote dialog (`FormDialog`) → POST; discount field gains the target selector « Nuits / Articles / Tout » |
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | recaps render `SaleDetailList`; section « Ventes du séjour — au départ » (rule 20) |
| `plugins/guest-app/` | `SasArrivalOrdersStep.jsx` | T (PR C) | reads `saleDetail` lines of `source = 'shop'` |
| `apps/guest/` | cart / order views | — | unchanged UI; labels from the server |
| `components/` | `StandaloneSaleDialog.js` | C (PR C) | « Vente hors séjour »: articles, quantity, payment (tender or link); reuses `FormDialog`, `SaleDetailList` |

**Component reuse:** consumed `FormDialog`, `StatusBadge`, `PageActionBar`, `ConfirmDialog`; created
`SaleDetailList` (three screens and the guest app read the same payload); nothing specific.

**Delivered by PR B** (pass 4, skills `apple-design` and `impeccable` loaded): `components/SaleDetailList.jsx` (the payload as a list, a « moment » menu on an unpaid line, 44 px targets, stacked on `xs`), `components/AddProductDialog.jsx` (`FormDialog`: product, quantity, the server's price and moment, sells at the accepted price), `components/ExtraSalesPanel.jsx` (« Ventes du séjour » on a saved stay), and the « Réduction sur » selector (Nuits / Articles / Tout) of the finance card. The client computes nothing. Vitest: `SaleDetailList.moment`, `AddProductDialog.quote`; Playwright `e2e/specs/reservations/extra-sale.spec.js` at 390 and 1280 px.

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/:id/extras/quote` | `{ requests:[{ articleRef, quantity, persons?, mornings?, sessions?, offered? }], payment: 'later'\|'card'\|'cash' }` | `{ lines:[…priced, collectAt, status], buckets:{ arrival, departure, plan }, totalCents, refusals:[] }` | no write |
| POST | `/api/reservations/:id/extras` | same + `acceptedTotalCents` | `{ saleDetail, paymentLink? }` | 409 `PRICE_CHANGED` if the re-quote differs |
| PATCH | `/api/reservations/:id/extras/:ref` | `{ collectAt?, offered?, discount?:{percent\|amount}, forceOverpayment? }` (`ref` = `option:<lineId>` / `resource:<lineId>` / `custom:<lineId>`) | `{ saleDetail }` | 409 `LINE_PAID`, 409 `OVERPAID` (rule 23); journaled |
| GET | `/api/reservations/:id/sale-detail` | — | `saleDetail` | also embedded in `GET /sas` and the fiche payload |
| PUT | `/api/reservations/:id` (existing) | `discountTarget` added (`nights` default); `discountAmountCents` (positive integer, else none; absent keeps the stored one) | unchanged | rule 16 |
| guest-app | `/public/v1/stay/…/orders` (existing) | unchanged shape | unchanged shape | implementation moves to `extraSale` (PR C) |
| POST | `/api/standalone-sales/quote` | `{ requests[], payment }` | `{ lines[], vatByRate[], totalCents, refusals[] }` | `externalSale` pipeline, no write (PR C) |
| POST | `/api/standalone-sales` | same + `acceptedTotalCents`, `customer?:{name, email}` | `{ sale, paymentLink? }` | records `standalone_sales` (PR C) |

## 5. Data model

Columns added to `reservation_options`, `reservation_resources`, `reservation_custom_options` (idempotent
`ALTER TABLE … ADD COLUMN` in `database.js`):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `source` | TEXT | `'fiche'` | `fiche` \| `shop` \| `sas` \| `intake` \| `devis` |
| `collectAt` | TEXT | NULL | `plan` \| `platform` \| `arrival` \| `departure`; NULL = legacy, derived by `legacyCollectAt` |
| `collectAtDefault` | TEXT | NULL | the moment STAY CLOCK gave when the line was written (rule 46); equals `collectAt` unless the operator changed it |
| `soldAt` | TEXT | NULL | when the line was sold (allocation and allowance order) |
| `settlementRef` | TEXT | NULL | `link:<id>` \| `settlement:<id>` \| `note:<key>`; what a line settled is Σ of its `payment_allocations` (rule 74), not a column |
| `discountCents` | INTEGER | 0 | the line's share of a stay discount (rule 40) or its own line discount (rule 39) |
| `allowanceUsed` | TEXT (JSON) | NULL | free units / minutes this line consumed |
| `orderRef` | TEXT | NULL | guest-app `order:<id>:<line>` (replaces `orderChargeKey` and description matching); not backfilled in PR B (J-7 code, PR C) |
| `articleRef`, `family`, `label` | TEXT | NULL | the snapshot of what was sold (rule 74): `option:<id>` / `resource:<id>` / `custom:<id>`, the family of the line's own stored price type (NULL for a custom line), the title at sale time |
| `vatRate`, `vatClass` | REAL, TEXT | NULL | the rate the VAT step gave and its class (rule 51); NULL = the stay's regime rate and the family's class |
| `fulfilmentRef` | TEXT | NULL | `hourly-slot:<hold id>` (rule 49) |
| `components` | TEXT (JSON) | NULL | the parts of the price (base / evening / free) |

**Line identity (rule 79).** The three line tables get `lineId INTEGER` (unique index; numbered from `line_id_sequence` by an
`AFTER INSERT` trigger, so a row inserted by the previous release is numbered too; the rows already there take their rowid).
Nothing is rebuilt: the primary key `(reservationId, optionId)` / `(reservationId, resourceId)` stays, so a rolled-back release
still runs its `INSERT … ON CONFLICT(reservationId, optionId)` (self-update rule 31). `lineRef = line:<table>:<lineId>`.

On `reservations`: `discountTarget` TEXT DEFAULT `'nights'` (every existing row reads as today); `discountAmountCents` INTEGER NULL (the fixed
amount of the stay discount, rules 16 and 39; NULL = the discount is the percent; no backfill); `cancellationKeptCents` and
`cancellationIndemnityCents` INTEGER NULL (rule 78; NULL = not cancelled or no `cancel` history entry).

New tables of PR B (created by `utils/pricingLinesMigration.js`, called from `database.js`):
`reservation_stay_lines` (`id, reservationId, kind 'accommodation'|'touristTax', label « Hébergement » / « Taxe de séjour »,
totalCents, vatClass, vatRate NULL, components NULL, soldAt, amendedAt NULL`, unique per stay and kind);
`refund_obligations` (rule 75); `refund_nettings (avoirId, refundId)` (rule 78); `payment_allocations (id, paymentRef,
documentRef 'reservation:<id>', lineRef NULL = stay-level, amountCents signed, kind 'payment'|'refund', at, refundId NULL,
books, origin 'backfill'|'live')` with a unique index on `(paymentRef, documentRef, lineRef, kind, refundId)` (rule 74).
New columns on `reservation_refunds` (`kind`, `amountCents`, `origin`, `providerRefundRef`), `reservation_refund_lines`
(`amountCents`, `source`, `revenueBucket`, `lineRef`, `vatClass`; no `paymentRef`), `cancellation_compensations.refundId`,
and the catalogue `options.vatClass`, `resources.vatClass`.

On the three line tables (PR B): `vatRate` REAL NULL (the rate the VAT step gave, rule 51; NULL on legacy lines = the stay's regime rate) and `fulfilmentRef` TEXT NULL (`hourly-slot:<hold id>`, rule 49).

On the catalogue tables (`options`, `resources`, guest-app articles) (PR B): `vatClass` TEXT NULL — NULL reads as today's family (`options` / `resources`), so every existing article keeps its group and rate (rules 61-62). No new table for the journal: `AccountingOutput` builds entries on read (rule 63).

New tables (PR C, rule 53, Q13): `standalone_sales` (`id`, `soldAt`, `customerName`, `customerEmail`, `totalCents`, `vatJson`, `status` paid|due|cancelled, `settlementRef`, `createdBy`) and `standalone_sale_lines` (`saleId`, `articleRef`, `kind`, `label`, `quantity`, `unitPrice`, `totalCents`, `vatRate`, `discountCents`, `fulfilmentRef`). Additive; no existing data touched.

`inComplement` stays (read by legacy code and the export) and is written in sync: `inComplement = collectAt
in ('arrival','departure')` until PR C retires its readers.

**Backfill (first commit of PR B), idempotent, amounts untouched:** each runs `WHERE <new> IS NULL` or `NOT EXISTS`, so a second boot changes
nothing, and reads stored data only.
- `legacyCollectAt` reproduces today's routing: `inComplement = 1` → `arrival`, or `departure` when the line is above
  `arrivalExtrasBaseline` (mid-stay rule); `inComplement = 0` → `platform` on a platform sale (the platform's own mode,
  never its name), `plan` otherwise. `collectAtDefault = collectAt`; `soldAt` = the stay's creation (a custom line's own).
- `reservation_stay_lines`: the accommodation line is the stored final price less the extras it also holds; the tax line is the stored
  tourist tax when above zero. Components stay NULL (no stored column splits the extra guests, Q-B16).
- Refund columns: `kind`, `origin`, `amountCents` from `method` and the stored amounts; `source` / `revenueBucket` per the refunds map §4
  S3; `lineRef` where `lineKey` names exactly one current line (`accommodation` and `touristTax` the stay lines); the compensation's
  `refundId` by stay, date and amount; the cancellation figures from the `cancel` history entry (`keptFromGuest`, else
  `retainedDeposit`); the nettings of each avoir by `cancellationNettedRefundIds`, once the models can load (`index.js`).
- `refund_obligations`: `basketJson.refundOwed` → open (`refundCents` or the link amount), `cancelReason = 'refunded'` → settled by `provider`.
- `payment_allocations`, **per-line truth only**: the deposit and balance contribs when they add up to the paid entry, the frozen
  complement split, the end-of-stay detail, the mid-stay notes, the installments' frozen splits (each when its lines add up), a live
  settlement from what it *received* (books and caisse interne apart, stay-level), and every refund (not the requalification avoir, not
  a commission) as a negative row naming no payment. A paid bucket (deposit, balance, arrival complement, end-of-stay complement),
  settled note or paid installment with no per-line truth gets its stay-level rows (`lineRef` NULL) once the application is up
  (`backfillStayLevelAllocations`, beside the nettings: it needs the platform's tourist-tax mode): the tourist tax goes to the
  stay's tax line where `computeTaxTtcForKind` of `legacyBucketSplit` books it, the rest to no line, so Σ allocations of a paid
  bucket is the bucket; a plan replaces the deposit and the balance, a live settlement is read alone. A payment already allocated
  is never written twice.
Proof: the price gate and the prod replay by value (added keys ignored, `--compare-values`).

**Data impact:** additive columns only; no amount column changes; `midStaySettledNotes`,
`complementPaidSplit`, `arrivalExtrasBaseline` stay readable for history and the export.

## 6. UI / UX

The owner validates on [`pricing-components-resume.html`](pricing-components-resume.html): the component
diagram (owner components and their units, the stay clock consulted by all) and a simulator whose clock control drives the STAY CLOCK component (its `phaseOf` output is shown) relative to the arrival date and
check-in time, a discount target, line moment changes and the tourist tax as its own block.

- **Fiche:** the « Options et articles » block lists lines grouped by article with source, status and
  discount chips. « Ajouter un produit » on a sold stay opens a `FormDialog` (article, quantity, « Payer
  maintenant (lien carte) » / « À payer ») with the server quote live. An unpaid line has a « Moment » menu
  (« À l'arrivée », « Au départ »). A paid line's « Offrir » / « Retirer » asks confirmation and announces
  « 13,00 € à rembourser ». The discount field has a target selector « Nuits », « Articles », « Tout ».
  Mobile (`xs`): the dialog is full screen, lines stack label / quantity × unit / status, the moment menu is
  a full-width select.
- **SAS arrivée:** « À percevoir maintenant » (arrival lines + stay due), « Déjà payé » (not offerable) and,
  after check-in time, « Ventes du séjour — au départ » with « Percevoir maintenant » and « Passer à
  l'arrivée ». **SAS départ:** « À percevoir au départ » (departure lines + recalled unpaid arrival lines)
  and « Déjà payé ». Same `SaleDetailList`, same wording.
- Copy (French, impersonal, short): « Payée par carte le {date} », « À payer à l'arrivée », « À payer au
  départ », « Comprise dans le prix plateforme », « Dans l'acompte et le solde », « Offerte », « Remise
  −{x} € », « Fiche », « Boutique », « SAS », « Séjour soldé : vente séparée », « Prix modifié — relire le
  panier », « Ventes du séjour — au départ ».
- No `PageActionBar` change.

## 7. Test plan

### Server unit tests (one file per unit, rule 43)
- [x] `pricing-nights`, `pricing-extra-guests`, `pricing-tourist-tax` — rules 3, 7-9; the static import-graph test of rule 2
- [x] `pricing-allowances`, `pricing-timed-options` — rules 41, 43 (PR A: the read-only form of today's free units, the early check-in and late check-out options)
- [ ] `pricing-extras`, hourly `hourly-tariff` — rules 10-14, 24, 26 (PR B: free hour stays with its line; evening supplement identical from shop, SAS, fiche)
- [x] `pricing-stored-lines` — rule 72: the four stored-line parsers SETTLEMENT and REFUNDS share
- [x] `pricing-platform-price` — rule 17 (`grossFromNet` parity; a post-booking sale on a platform stay leaving accommodation, tax and payout unchanged is PR B)
- [x] `pricing-discounts` — rule 16 (PR A: `nights` equals today's formula on every golden quote). Rules 39-40 (Σ shares = D; largest remainder and ties; no negative line; paid lines excluded) are PR B
- [ ] `pricing-vat` (folded into `vat-component`) — the VAT readers give the same split on the same input; per-line allocation sums to the group VAT; `hosted` vs `external` rate per family; one row per rate in the breakdown; a single-rate stay equals today's figures
- [x] `articles-family-<family>` ×7 (+ `hourly-family` in the plugin) — one file per family sub-component: formula, `validate`, `describe`, tagged amounts, no VAT (rule 47)
- [x] `articles-head-contract` — the head is the only export of `articles/`; dispatch, refusals, allowance coordination, offered, locked snapshots, fulfilment calls; a request for an unregistered family is refused; instances are frozen config (rule 47)
- [x] `vat-component` — rules 61-62: resolver by (vatClass, customerContext) and regime/franchise; one rounding per group; largest-remainder allocation sums to the group; per-rate output; byte-identical to the five former copies on the golden inputs
- [ ] `accounting-output-replay` — rule 63: neutral entries from the read models; each exporter reproduces today's CSV, JSON and synthesis byte for byte on every golden month; no exporter imports `vat/` or `articles/`
- [x] `pricing-lines-migration`, `pricing-legacy-collect-at`, `pricing-legacy-allocations`, `booking-lines-identity` — rules 36, 74, 79: the line-identity rebuild and its rollback, the sale columns and tables, every backfill idempotent with no amount rewritten, the line save by id
- [x] `price-gate-scopes`, `price-gate-writes` — rule 81: the allowlist scopes, the replay `--expect` list, the refund write-path cases compared to the leaf with what the tag wrote
- [x] `no-duplicate-formulas`, `formula-guards-mutants`, `pricing-import-graph`, `pricing-import-graph-mutants` — rule 66 static guards with their allow-lists, including the platform-payment guard of rule 70; every guard and the import graph proved on planted copies
- [x] `pricing-platform-payment` — rule 70: every formula of the table, both commission bases, clamps, net received, acompte net, penalty, cancellation withheld commissions
- [x] `platform-intake-port`, `platform-intake-replay` — rule 71 (PR A: SDK contract unchanged, adapter, replay of the stored intakes at 0 diff; `fromPlatform` is PR B); booking-intake, airbnb-intake and gites-de-france-intake suites green unchanged
- [x] `article-family-contract` — every registered family, core and `hourly`, through the same cases (rule 57)
- [ ] `article-fulfilment-contract` — run against the bath adapter: hold, overlap refused, heat-up honoured, confirm in the sale transaction, rollback leaves no booking, release frees the slot (rule 57)
- [x] `pipeline-composition` — every use case builds; a missing `requires` throws at build; `externalSale` never calls nights, tax, clock or schedule; `stayQuote` output equals the pre-refactor engine (rule 52)
- [x] `settings-provider`, `pricing-settings-wiring` — resolution article → property → global → default with NULL as a value; each component's schema validates; the adapters return today's column values and no unit reads a property row (rule 50)
- [ ] `standalone-sale` — rule 53: priced by the same families, external VAT, recorded, journal row through `standaloneSales`
- [ ] `extra-sale-events` — rule 55: events published after commit only; an observer failure never undoes a sale
- [x] `pricing-totals`, `pricing-compose` — rule 4: composition deep-equal to the pre-refactor engine on the fixture; TOTALS computes nothing (only sums provided keys)
- [x] `pricing-stay-clock` — rules 20, 44: the exact check-in minute (14:59 → `before`, 15:00 → `during`), the exact check-out minute (`during` → `after`), J-1 23:59, the two DST days (last Sunday of March and of October, a check-in at 02:30 that does not exist / exists twice), missing `checkInTime` → property `defaultCheckIn` → `15:00`, malformed time refused, `now` injected (no `Date.now()` in the file), arrival mark set before check-in time does not start the stay
- [x] `stay-clock-model` — `phaseForReservation` reads the reservation then the property; the only resolver
- [x] `stay-clock-single-source` — static test of rule 45: no date comparison deciding a phase or a collection moment outside `stayClock*`
- [ ] rule 46: a line keeps `collectAtDefault`; an operator change journals both values; time passing never rewrites a stored moment
- [ ] `pricing-schedule`, `pricing-settlement` — rules 18-23, 37 (table of rule 19, netting once, moment change journaled, paid frozen)
- [ ] `extra-sale-fiche`, `extra-sale-shop`, `extra-sale-sas` — rules 27-30 per seller; quote = commit; platform card link separate (rule 29)
- [ ] `sale-detail` — rules 31-32: Σ lines = bucket; same payload for fiche and SAS; the after-check-in section
- [ ] `pricing-legacy-collect-at` — §5 backfill derivation
- [ ] Golden fixture unchanged through PR A and B's first commit (no `GOLDEN_UPDATE`), with accounting-export installed
- [ ] Regression tests named after each review defect (D1-D9) on the rebuilt guest app (PR C)

### Proof
- [ ] Price gate (rule 68): `price-gate.unit.test.js` green on every commit of A, B and C, with the allowlist reviewed by the owner; `price-gate-anonymity`, `price-gate-anonymise`, `price-gate-figures`, `price-gate-compare`, `price-gate-move-proof` unit tests green
- [ ] Review per rule 69: one integral review with the PROVEN / NOT PROVEN checklist, one grouped fix, one verification pass
- [ ] Stabilisation per rule 69 after PR C: rounds of integral audit → grouped fix → verification until a round with zero findings; findings table per round separating old defects from regressions
- [ ] the replay hashes every accounting export file (CSV per month, sales JSON, synthesis) besides the quotes (rule 64)
- [x] `scripts/price-gate/move-proof.mjs` at every commit of PR A (rule 73): every unmatched removed line read and classified as rewiring or glue
- [ ] `scripts/pricing-replay.mjs` before/after on a fresh prod copy at the three checkpoints of PR A (0 diff; rule 73 amends rule 35), at PR B's first commit (0 diff), at PR B and PR C heads (listed diffs only)

### Manual UI verification
- [ ] Simulator scenarios replayed on the dev server: direct stay before check-in time (shop card / note), platform stay after check-in (note → departure), SAS arrival opened after check-in time with a departure sale, fiche manual addition, moment change journaled, discount on « Tout », SAS offer of a paid line refused
- [ ] « Vente hors séjour »: drinks to a walk-in, external VAT rate on the receipt, journal row
- [ ] Mobile 390 px and desktop 1280 px: fiche dialog, both SAS recaps, guest cart, « Vente hors séjour » dialog

## 8. Out of scope

- Changing any price, rounding or collection rule of existing stays in PR A (rules 33-36).
- Integer cents inside the pricing units (Q9; separate spec once the split is in place). DISCOUNTS' new
  targets work in cents from the start (rule 40) because they have no stored past to keep.
- Moving the accounting export to read line settlements (it keeps reading today's records).
- External hourly bookings' own invoice model (`resource_bookings`); only their grid and VAT move to the
  shared units in PR B.
- Discount codes and promotions; new payment providers.
- A settings UI for the new component keys (rule 50): PR A only reads today's columns; editing goes through today's screens.
- Merging external hourly bookings (`resource_bookings`) into `standalone_sales`: they stay their own model, priced and fulfilled by the shared units.
- UI rework of the guest app beyond reading the new payloads.

## 9. Open questions

- **Q1. When is a stay "started"?** — **Resolved 2026-11-11 (owner):** once the arrival date and check-in
  time have passed, Europe/Paris (rule 20). The arrival mark and the arrival SAS change only the display; a
  sale after check-in time with the arrival SAS still open is « à payer au départ », shown in the open SAS,
  movable to the arrival by the operator.
- **Q2. More of an article already on the fiche: append or merge?** — **Resolved 2026-11-11 (owner: follows
  the recommendation):** append a new line; display groups them (rule 13).
- **Q3. Where the components live.** — **Resolved 2026-11-11 (owner, widened):** core
  `server/src/utils/pricing/`, one file per unit (rule 1); loader in `models/`; plugin articles through
  `ctx.articleFamily` (rule 47; amended 2026-11-11).
- **Q4. May the operator change an unpaid line's moment?** — **Resolved 2026-11-11 (owner):** yes, journaled;
  a paid line is frozen (rule 37).
- **Q5. Shop card payment on a platform stay before arrival.** — **Resolved 2026-11-11 (owner):** allowed,
  through a separate Qonto link, outside the platform price (rule 29).
- **Q6. Discounts on extras.** — **Resolved 2026-11-11 (owner, overrides the earlier default):** discounts
  apply to nights and extras, by target, with the allocation of rule 40; existing discounts keep their effect
  (`target = 'nights'`).
- **Q7. The `feature/guest-app-from-j7` branch.** — **Resolved 2026-11-11 (owner: follows the
  recommendation):** freeze it, do not merge; rebuild its money path in PR C.
- **Q8. Replay tolerance.** — **Resolved 2026-11-11 (owner: follows the recommendation):** zero diff on PR A
  and PR B's first commit; every later diff listed and approved.
- **Q9. Integer cents.** — **Resolved 2026-11-11 (owner: follows the recommendation):** later, as its own
  proved change.
- **Q10. Product added on a stay not yet sold.** — **Resolved 2026-11-11 (owner: follows the
  recommendation):** the ordinary fiche save until the first lock, then `extraSale`.
- **Q11. Default target of a new discount typed on the fiche.** — **Resolved 2026-11-11 (owner):** « Nuits »
  (rule 58).
- **Q12. Does a stay discount on « Articles » / « Tout » also cover sales made later?** — **Resolved
  2026-11-11 (owner):** no (rule 59).
- **Q13. Where an external sale is recorded.** — **Resolved 2026-11-11 (owner):** as recommended: a core `standalone_sales` record (rule
  53), journalled through the existing `standaloneSales` hook, entered from a « Vente hors séjour » dialog on
  the Encaissements page, delivered in PR C. Alternatives: a hidden pseudo-reservation (rejected: it would
  pollute occupancy, statistics and the tourist-tax report), or a resource-booking-like plugin table (rejected:
  drinks are not a resource).

- **Q14. A generic copy-paste detector in CI?** — **Resolved 2026-11-11 (owner):** no `jscpd`; the targeted
  static guards of rule 66 are enough.
- **Q15. The Gîtes de France commission basis.** — **Resolved 2026-11-11 (owner):** as recommended, two
  named bases of PLATFORM PAYMENT selected per platform. The GdF intake writes `commission = rent − net rent`
  (the centrale's statement, commission on the rent only), while every other path uses `gross − payout −
  withheld tax − acompte commission`. Recommended: keep both as two named bases of PLATFORM PAYMENT
  (`statement` and `rentOnly`), selected per platform by a setting, so each formula exists once and GdF
  stays byte-identical; the intake replay of rule 71 proves it.

- **Q16. Refunds: data model and behaviour of PR B.** — **Resolved 2026-11-12 (owner).** The decisions O-1 to O-11
  and the conflicts C-1 to C-5 of `docs/rapports/2026-11-11-refunds-map.md` §4-§5, read against rule 74's allocations,
  were put to the owner in one HTML summary and answered:
  - **O-1 (a)** a REFUNDS component of its own (delivered by PR A).
  - **O-2 (a)** a `refund_obligations` table, status `open` / `settled` / `cancelled`, a close action; the register
    holds money that left only (C-1). Rule 75.
  - **O-3 (a)** a `card` means with `providerRefundRef`; no Qonto refund API.
  - **O-4 (a)** a refund line points at the precise sale line (`lineRef`), the legacy `lineKey` kept (C-2). Rule 79.
  - **O-5 (a)** money received for a stay never booked: an obligation opened then settled, no journal entry.
  - **O-6 (a)** only a free line of origin `overpayment` lowers the trop-perçu; the difference is listed (0 production rows).
  - **O-7 (b)** the **new formula everywhere**: trop-perçu = Σ allocations − line totals for all stays, legacy
    included, through backfilled allocations; not the recommended adapter, every legacy difference goes to the
    owner's review in `allowlist.json`. Rule 76.
  - **O-8 (a), final** refund lines are re-rated with the stay's period, as today (the owner first chose a frozen
    rate and reversed it on 2026-11-12 after seeing the 4457 residue). `reservation-refunds.md` rule 14, the
    `schema.sql` comment and rule 64 are reworded; `vat-optional-mode.md` rule 16 is unchanged. Rule 77.
  - **O-9 (a)** `cancellationKeptCents`, `cancellationIndemnityCents`, `refund_nettings` and the compensation's
    `refundId` are stored. Rule 78.
  - **O-10 (a)** lowering, offering or removing a paid line is refused by default; on confirmation an obligation
    (origin `lineLowered`) of the line's excess is opened. Rule 23.
  - **O-11 (a)** the three tie strategies stay named.
  - **OD1 (a)** `per_hour` with hourly-resources off: stored lines keep their core-hours price, new requests are
    refused; no diff (rule 47).
  - **S5 against rule 74:** no `paymentRef` column on refund lines; a refund is a negative allocation naming the
    payment it gives back.
  - **Technical calls (not product questions):** the lines get a stable `lineId` carried across the save instead of a rebuilt
    table with an upserting save (Q-B1 as built, rule 79: a rowid-alias `id` would change the order the readers get); no
    `settledCents` column, the amount is Σ allocations (Q-B6b); a `books` flag on
    allocations (Q-B4); `paymentRef` NULL for a legacy refund with no derivable payment (Q-B5); the platform keeps
    refunds rule 38 (Q-B3); `legacyBucketSplit` moves to the core (Q-B23); the J-7 items (`flagBasketRefund`,
    `exactMergedTotals`, `guest_orders`, `deferredCents`) are PR C (Q-B13).

## 10. Migration plan — three PRs

Each PR targets `inte/plugins`, is provable on its own, and carries the replay result in its body. Inside a
PR, one commit per unit so the replay can be bisected.

| PR | Content | Proof | Size |
|---|---|---|---|
| **A — Units, byte-identical** | price-gate fixture captured on `price-gate-baseline` and the gate test (rule 68); `scripts/pricing-replay.mjs` and baseline; extract, one commit each: `money`, NIGHTS, EXTRA GUESTS, TOURIST TAX, EXTRAS host + ALLOWANCES (read-only form of today's free units), STAY CLOCK (`phaseOf` + `stayClockModel`; feeding the phase to COMPOSE in place of `todayIso`/`midStayWindow` is PR B, rule 45), PLATFORM PRICE, DISCOUNTS (target `nights` only active), VAT (per (family, rate) group, every line `hosted`; the line allocation is PR B, rule 51), TOTALS (aggregation only), SCHEDULE, SETTLEMENT (reading `inComplement`); the Articles head, family registry, instance factory and the 7 core families, with `hourly` wrapped from the contributor alias; the VAT component fed by tagged amounts, and the five VAT copies (engine, `accountingModel.bucketFromTtc`, `financeModel.htAmount`, `paymentLinkItems.buildVatItems`, `bookingPricing.vatOf`) switched to it; the ports with core adapters and `SettingsProvider` reading today's columns, each component's `settingsSchema`; `pipeline.js` and `stayQuote`; `calculateReservationQuote` = COMPOSE | also PLATFORM PAYMENT (engine clamp, net received, `computePlatformCommission` re-exported) and the intake adapter behind `reservations.update` (rules 70-71) | price gate green with an **empty** allowlist; intake replay 0 diff; intake plugin suites green; golden + replay **0 diff at every commit** (quotes, links, CSV months, finance); `article-family-contract`, `articles-head-contract`, `vat-component`, `pipeline-composition`, `settings-provider` green | XL — ~5 300 LOC moved or new, ~2 900 LOC of tests (~33 files); 7-9 coder passes; review by commit; A1/A2 split available |
| **B — Lines, sale service, detail, accounting output** | commit 1: line columns + `discountTarget` + backfill (0 diff). Commit 2: `AccountingOutput`, `legacyBucketSplit` and the `csvJournal` / `salesJson` / `synthesis` exporters replace the accounting-export entry builders; tourist-tax report on TOURIST TAX (0 diff on every export file). Then: the B call sites of rule 45 go through `phaseForReservation` (routing by date and check-in time), and the phase is fed to COMPOSE in place of `todayIso` / `midStayWindow` (listed diff 1); VAT line allocation (rule 51); `extraSale` quote/sell + API; fiche « Ajouter un produit », moment menu, discount targets and line discount; SAS upsells and departure charges through EXTRAS; one HOURLY TARIFF (evening supplement as component, `bookingPricing` on the same grid); `saleDetail` + `SaleDetailList` in fiche and both SAS; platform card link separate; `ficheSale` / `sasSale` pipelines; FULFILMENT port + bath adapter (`SlotAvailabilityProvider`, SAS bath sessions confirmed in the sale transaction); domain events of rule 55 with the calendar observer; `vatRate` / `fulfilmentRef` line columns; external-context VAT keys (`standaloneVatRate` moved); retire `sasOptionSale`, bath-linen offer, `prepaidNetter`, `arrivalPaymentDetail.billableLines`, VAT copies; PLATFORM PAYMENT in penalties, settlement, cancellation and `linkAllowed`; the `PlatformBookingIntake` port (`reservations.fromPlatform`, SDK 2.28.0); iCal default options through the Articles head | price gate green, allowlist entries = the listed diffs only, owner-reviewed; commits 1-2: 0 diff (quotes and every export file); head: **listed diffs only** (below) | XL — ~4 000 LOC + tests; 6-8 passes |
| **C — « Mon séjour dès le J-7 » rebuilt** | guest app on the `shopSale` pipeline: judge = `extraSale.quote`, commit = `extraSale.sell`, bath card holds = fulfilment holds, e-mail observer; the external sale (`externalSale` pipeline, `standalone_sales`, API, « Vente hors séjour » dialog, journal through `standaloneSales`, Q13); keep UI, slots, stock, e-mail, spec rules on UI/slots/stock/e-mail; move the C call sites of rule 45 to `phaseForReservation` (same semantics, 0 diff on them) and turn on the static single-source test; remove `arrivalMoment.js`; delete `midStayOrderCommit.js` and W1-W12 (`pinOrderGrowth`, `beforeArrival`, `orderGrowth`, `exactMergedTotals`, `keepStay`, `settleOrderNoteBeforeArrival`, `deferredCents`/`PRICE_ROSE`, `heldInStayPrice`, `orderChargeKey`); rewrite `guest-app.md` rules 85, 93-101 as references to this spec, and **add the missing rules 104-106** (cited by the WIP code and tests, absent from `guest-app.md`, which ends at 103) at the end of its §3; retire `inComplement` readers, `priceLineContributor` alias, the `money` copies the replay proves identical; empty the allow-lists of rule 66 so the static guards are strict; intake date checks through STAY CLOCK; reconciliation helpers on PLATFORM PAYMENT; optional intake migration to `fromPlatform` | price gate green (allowlist unchanged unless listed); review-defect tests D1-D9 green; `standalone-sale` green; replay of non-guest-app stays 0 diff vs PR B head | L — −2 000 / +1 300 LOC; 3-4 passes |

The fourth candidate PR (retiring duplicates) is folded into B (SAS and VAT duplicates) and C (guest-app,
flags, aliases). The accounting output is commit 2 of B (provable at 0 diff before B's behaviour commits). The 2026-11-11 architecture amendments, both rounds, keep the plan at **three PRs**: the interfaces land
with the first code that needs them (rule 60); none needs a PR of its own.

**Behaviour that differs after PR B (the expected diff list to approve):**
1. A sale not yet paid is routed by STAY CLOCK (rule 20: date and check-in time). Today `hasGuestArrived` routes it (check-in
   box or arrival SAS): a sale between check-in time and a late check-in moves from arrival to departure; a sale
   after an early check-in mark but before check-in time moves from departure to arrival.
2. A further sale of a locked article is a new line (rule 13), not a merged quantity: line counts change, totals
   do not.
3. The SAS evening supplement becomes a component of the session's line: the `evening:<id>` custom line
   disappears, the amount is the same.
4. Hourly external bookings value the free hour at the day rate, like stays (rule 37 of the hourly spec); today
   `bookingPricing` uses the banded rate. Only bookings with a free evening hour differ.
5. SAS breakfast / catering / linen priced by EXTRAS: any cent difference against `sasOptionSale` is listed per
   stay.
6. Discount targets « Articles » / « Tout » and line discounts are new: no stored stay changes, new ones carry
   `discountCents` on their lines.
7. Lowering a paid line asks for confirmation and writes a refund owed.
8. The arrival detail, the collected split and the SAS recap are net of card-paid lines (review e M5): stays with
   prepaid card notes show lower « à percevoir » figures where they were wrong.
9. Lines carry their own `vatRate`; with one rate per stay the figures are unchanged, the breakdown gains a « TVA 10 % » row label.
10. A SAS bath session is booked through the fulfilment adapter in the sale transaction: a conflicting slot now refuses the sale instead of being caught by `validate` before it.

**What the J-7 branch keeps:** the guest PWA (cart, `PaymentChoice`, `SlotGrid`, `DeliveryTimeChips`,
`SlotPickerPage`, i18n), `SasArrivalOrdersStep` (fed by `saleDetail`), slot logic (`serviceHours`,
`scheduler.slotsForStay`, `availability` `heatFrom`, holds as occupancy), stock, orders model (status,
`collectAt`), `emailContext`, refusals, and the spec rules on UI, slots, stock, e-mail. **What it drops:** the
list in PR C.

**Risks.**
- **PR A grows** with the registry, ports, settings provider and pipeline (~5 000 lines). Mitigation: the interfaces are introduced first with today's code behind them (adapters read today's columns, the contributor is wrapped as the `hourly` family), then the units move behind them; contract tests run on every commit. If review load is too high, PR A may be split A1 (harness, ports, settings, pipeline skeleton, money) / A2 (units) without changing B and C.
- **PR A is large** (~4 000 moved lines). Mitigation: one commit per unit, replay on every commit, units moved
  verbatim (no rename inside a move commit), review by commit.
- **PR B mixes the backfill and behaviour.** Mitigation: the backfill is commit 1, proved 0 diff alone; the
  expected diff list above is approved before the PR opens.
- **The clock as single source** touches 13 call sites over B and C; the C ones keep their exact semantics (`arrivalDayReached` is today's `startDate <= today`), so they move at 0 diff, and the static test of rule 45 stops a new date comparison from creeping back.
- **Rule 20 changes an earlier owner decision** (`arrival-moment-is-the-check-in.md`): that spec must be
  amended in PR B for the routing of new sales.
- **Discount allocation on old stays:** none, `target = 'nights'` everywhere; the risk is on new discounts only,
  covered by rule 40's tests.
- **The accounting output touches declared months.** Mitigation: commit 2 of PR B is a pure refactor proved byte-identical on every CSV month of the prod copy, and old rows go through one legacy adapter that keeps today's derivation.
- **External sale is a new feature** inside PR C (Q13): it can be cut out of C into a later PR without touching the guest-app rebuild.
- **Time to J-7 in production:** three PRs instead of one more patch round; in exchange no more workaround per
  review.
