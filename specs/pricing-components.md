# Pricing components — unit pricing and collection components

| Field | Value |
|---|---|
| **Status** | Approved — 2026-11-11 (owner), rules 1-71, §4.0, Q1-Q15 resolved; implementation targeted at 4.1.0 |
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

`server/src/utils/pricing.js` → `calculateReservationQuote` (l. 1400-3370, ~1 970 lines, ~120 inputs, 132
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
   | 1 Séjour | **NIGHTS** | `nights.js` | `priceNights({stay, party, tariff, lockedNights}) → {nights[], accommodationBase, validation, context}` |
   | 1 Séjour | **EXTRA GUESTS** | `extraGuests.js` | `priceExtraGuests({nights[], party, tiers, platformPaidGuests}) → {count, surcharge, inBrut, inComplement}` |
   | 1 Séjour | **TOURIST TAX** | `touristTax.js` | `priceTouristTax({base, party, nights, policy, includedServices, frozen, addedGuests}) → {total, base, perPerson, collectedBy, frozen}` |
   | 2 Articles | **ARTICLES** (head) | `articles/index.js` | the only interface: `quote({requests[], stayContext?, customerContext, allowance}) → {lines[], taggedAmounts[], allowanceUsed, refusals[]}`, `commit(quoted, tx)`, `release(line, reason)`, `describe(line)` — dispatch, aggregation, refusals, allowance coordination, fulfilment calls; no formula (rule 47) |
   | 2 Articles | **ARTICLE FAMILIES** (sub-components) | `articles/families/{fixed,perUnit,perNight,perPerson,perPersonPerNight,percentOfStay,perParticipantProgressive}.js`; plugin `hourly` | one generic formula per pricing family: `{ id, configSchema, validate(config, request, ctx) → refusals[], price(config, request, ctx) → {quantity, unitPrice, components[], allowanceUsed, amounts:[TaggedAmount]}, describe(config, line) }` — never called from outside the head |
   | 2 Articles | **ARTICLE INSTANCE** (factory) | `articles/makeArticle.js` | `makeArticle(catalogueRow) → Object.freeze({ ref, family, config:{price, label, vatClass, limits, allowance, fulfilment} })` — config only, no code; one instance per catalogue article |
   | 2 Articles | **ALLOWANCES** | `allowances.js` | `consumeAllowance({grants, consumed[], request}) → {used, left}` and `releaseAllowance(...)` |
   | 2 Articles | **HOURLY TARIFF** (plugin) | `plugins/hourly-resources/hourlyPricing.js` | `priceSessions({grid, sessions[], freeMinutes}) → {base, evening, free, total}` — the only hourly grid |
   | 3 Totaux | **PLATFORM PRICE** | `platformPrice.js` | `resolvePlatformPrice({mode, gross, commissionRate, extraGuestsInBrut, platformLines, withheldTax}) → {accommodation, commission, payout}` |
   | 4 Encaissement | **PLATFORM PAYMENT** | `platformPayment.js` | `commissionOf`, `clampCommissions`, `netReceived`, `acompteNet`, `grossOf`, `payoutWithPenalty`, `withheldOnCancellation` — what a platform pays out (rule 70) |
   | 3 Totaux | **DISCOUNTS** | `discounts.js` | `allocateDiscount({discount:{percent?, amount?, customPrice?, target}, accommodation, lines[]}) → {accommodationAdjusted, lineShares{}, total}` |
   | beside the clock | **VAT** (standalone, consulted by all) | `vat/index.js` | `vatOf(taggedAmounts[], {regime, settings}) → {amounts[] with rate, vatCents, netCents; groups[] by (vatClass, rate, customerContext); byRate[]; totals}` — the only place a rate, a VAT or a net amount is computed (rules 51, 61-62) |
   | 3 Totaux | **TOTALS** | `totals.js` | `aggregateTotals(ctx) → {finalPrice, discountAmount, totalStayPrice, vatByRate[], breakdown[]}` — pure aggregation of what the other steps and VAT returned; no formula (rule 51) |
   | — | **ACCOUNTING OUTPUT** | `accounting/accountingOutput.js` + exporters | `journalEntries({from, to}, readModels) → JournalEntry[]` (neutral); exporters `csvJournal`, `salesJson`, `synthesis`, (FEC later) are adapters `export(entries, accountPlan) → file` (rules 63-64) |
   | 4 Encaissement (consulted by all) | **STAY CLOCK** | `stayClock.js` | `phaseOf({arrivalDate, departureDate, checkInTime, checkOutTime}, now) → {phase: 'before'\|'during'\|'after', started, defaultCollectAt: 'arrival'\|'departure', arrivalDayReached, departureDayReached}` — rules 20, 44-46; resolver `phaseForReservation(id, now)` in `models/stayClockModel.js` |
   | 4 Encaissement | **SCHEDULE** | `schedule.js` | `planSchedule({totals, policy, planLines, installments[], overrides, receipts, today}) → {deposit, balance, installments[], dueDates}` |
   | 4 Encaissement | **SETTLEMENT** | `settlement.js` | `planSettlement({lines[], stayLevel, overrides, receipts, refunds, started}) → {arrival, departure, paid, refundsOwed, lineStatus{}}` |
   | — | **PIPELINE** | `pipeline.js`, `pipelines.js` | `buildPipeline(steps, {initial}) → run(ctx)`; each step `{ id, requires[], provides[], apply(ctx) → ctx }`; use cases `stayQuote`, `ficheSale`, `sasSale`, `shopSale`, `externalSale` (rules 52-54) |
   | — | **COMPOSE** | `compose.js` | the `stayQuote` pipeline + `shape()` to the 132-key quote (rule 4) |
   | — | **PORTS** | `models/ports/*.js`, plugin adapters | `StayRepository`, `CatalogueProvider`, `PaymentLedger`, `SlotAvailabilityProvider`, `SettingsProvider`, `PaymentGateway`, `EventPublisher` (rule 48) |
   | — | **FULFILMENT** | `articleFulfilment.js` (registry) + plugin adapters | `{ reserve(draft) → hold, confirm(hold, line, tx), release(hold, reason) }` (rule 49) |
   | — | money helpers | `money.js` | `roundMoney`, `toCents`, `fromCents`, `allocateCents` — not a component (rule 38) |

2. **One direction of dependency.** EXTRAS may read NIGHTS' `context` (nights, persons, nightly prices — for
   per-night / per-person types, percent-of-stay insurance and the late-checkout reference night). TOTALS
   reads the pricing units. SCHEDULE and SETTLEMENT read TOTALS and the stored collection state. No unit
   reads a unit downstream of it. **NIGHTS, EXTRA GUESTS and TOURIST TAX know nothing of extras; no pricing
   unit knows anything of payments.** A static test enforces the import graph.
3. **The tourist tax is its own component.** _(amended 2026-11-11.)_ TOURIST TAX owns
   `computeTouristTaxBreakdown`, the added-guests tax, the freeze, the reversal and the platform tax policy
   (`isPlatformCollectingTouristTax`, `isTouristTaxRemittedByOwner`). Its `base` input is the adjusted
   accommodation (percentage mode), so TOTALS calls it once, after PLATFORM PRICE and DISCOUNTS. The
   included-services deduction reads the services the **tariff declares** as included in the rate, never the
   sold extra lines. The tourist-tax report and `financeCalcs.computeTouristTaxAmount` call this unit
   instead of replaying the engine.
4. **The engine becomes a composition.** `calculateReservationQuote(input)` survives as a thin wrapper over
   COMPOSE. Its output stays byte-identical (rules 33-36) for as long as callers read it.
5. **Plugin extras go through one extension point.** _(amended 2026-11-11: the extension point is the
   article-family registry of rule 47.)_ `ctx.articleFamily(id, family)` (SDK wrapper of
   `articleFamilies.register`, rule 47) replaces `ctx.priceLineContributor` (kept as an alias, wrapped into a family,
   until PR C). A family receives `(config, request, ctx)` and returns a priced line with components (`base`, `evening`,
   `free`, `offered`) and tagged amounts. Hourly resources add the `hourly` family; shop articles are
   instances of core families. Solio-specific
   behaviour stays in plugins; the core holds the units, the line store and the extension point.
6. **Arithmetic is unchanged in PR A.** PR A moves code without changing a single rounding: every unit keeps
   the euro arithmetic (`roundMoney`) it has today. Integer cents inside the units is a later, separately
   proved change (Q9).

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
9. **Stay validation is not a sale check.** Min/max nights, changeover and capacity are judged by NIGHTS on a
   stay edit. A sale on an existing stay never re-judges them (W1 disappears, it does not get a flag).

### 3.C EXTRAS and ALLOWANCES

10. **One engine for every seller.** `priceExtras` prices options, linen, cleaning, breakfast (mornings ×
    persons), catering, baby bed, early/late check-in, cancellation insurance (percent of stay), custom
    lines, hourly resources and shop articles. The fiche, the devis, the SAS (arrival and departure), the iCal /
    platform intakes and the guest-app shop call the same function; no seller has its own arithmetic. A read
    (shop catalogue, slot picker price) is one `priceExtras` call, never a save (D9).
11. **Catalogue resolution is an input.** The property-merged catalogue (`getApplicableOptions/Resources`,
    `property_option_prices`, `property_resource_prices`, « Facturables » linen prices) is loaded by the
    loader and passed in. The per-property override lookup exists once.
12. **A line stores its total.** A priced line carries `quantity`, `unitPrice` (for display) and `total`; the
    stored `total` is authoritative. A sold line is never re-billed as quantity × rounded unit price (D4).
13. **A sale after the stay is sold appends a line; it never merges.** Once a line is locked
    (`reservation-option-immutability.md`), selling more of the same article from the shop, the SAS or the
    fiche creates a **new line** with its own price, source, collection moment and status. The fiche and the
    SAS group lines of the same article for display (« Bière locale — 3 : 1 × 6,50 € + 2 × 7,00 € »).
    `exactMergedTotals` disappears.
14. **Offered is a line property.** « Offert » sets the line's amount to 0 with its catalogue value kept for
    display (`applyOfferedToLine`). The three SAS offered mechanisms and `offeredMinutes` become this one.

### 3.D TOTALS, PLATFORM PRICE, DISCOUNTS, VAT

15. **Responsibility of TOTALS.** _(amended 2026-11-11: the order is the pipeline's, rule 52; VAT leaves
    TOTALS, rule 51.)_ PLATFORM PRICE, DISCOUNTS, TOURIST TAX and VAT are pipeline steps that run before it;
    TOTALS only aggregates their outputs into `finalPrice`, `discountAmount`, `totalStayPrice`, the VAT per rate
    and the breakdown the fiche, the devis PDF and the SAS render. TOTALS holds no formula of its own.
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
17. **"Inside the platform price" is a declared line fact, not a routing guess.** A line is either part of
    the platform gross (`collectAt = 'platform'`, set by the intake or the operator at booking time) or not.
    PLATFORM PRICE back-solves the accommodation as `brut − extra guests in brut − Σ platform lines −
    withheld/reversed tax` — exactly today's formula, with "`inComplement = 0`" replaced by "`collectAt =
    'platform'`". **A sale made after the booking is never a platform line**, so it can never shrink the
    accommodation (D1, D3). `grossFromNet` (catalogue) and `platformPriceCheck` call the same unit.

### 3.E STAY CLOCK, SCHEDULE, SETTLEMENT

18. **Each extra line carries its collection moment**, decided when the line is written and stored on it:
    `plan` (deposit / balance / installment plan), `platform` (paid to the platform), `arrival` (to pay at
    check-in), `departure` (to pay at check-out). Nothing downstream infers it again.
19. **The default moment of a new line** (`defaultCollectAt`) _(amended 2026-11-11 for rule 20)_:

    | Stay state | Paid now (card / Qonto link, terminal or cash at the SAS) | Not paid |
    |---|---|---|
    | not started (rule 20) | line `paid`, moment `arrival` for the record | `arrival` — « À payer à l'arrivée » |
    | started | line `paid`, moment `departure` for the record | `departure` — « À payer au départ » |
    | departure complement already collected | line `paid` | refused « Séjour soldé : vente séparée » |
    | at booking, from the fiche or an intake (stay not yet sold) | — | `plan` (direct) or `platform` (platform stay, when included in the brut) |

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
21. **Paid is stored on the line.** A line carries `settledCents` and `settlementRef` (payment link,
    settlement, tender). Every bucket amount — arrival complement, departure complement, solde — is **Σ of the
    due amounts of its lines** (+ the stay-level parts of rule 22). Netting paid money happens in SETTLEMENT
    only; the fiche detail, the collected split, the SAS recaps and the accounting basis all read it (D6).
22. **Stay-level amounts keep their rules, in SCHEDULE.** Deposit % on the accommodation, solde, installment
    plans (`installmentPlan`, `installmentSync`), due dates (`paymentSchedule`), platform single payment, tax
    routing (`touristTaxInComplement`), extra-guest complement, overrides (`depositAmountOverride`,
    `complementAmountOverride`, end-of-stay override as an « Ajustement » line), arrival reduction / tip,
    mixed methods (`payment_settlements`, `payment_tenders`). They move unchanged.
23. **Lowering a paid line produces money owed back.** Offering, removing, discounting or reducing a line
    below its `settledCents` is refused by default; with the operator's confirmation it writes a refund owed
    (`reservation_refunds` / `flagBasketRefund` merged to the full amount) (D7).
24. **One article, one price path.** The evening supplement of an hourly session is a component of the
    session's priced line (rule 5), priced by HOURLY TARIFF whatever the seller. The SAS no longer adds an
    `evening:<id>` complement line computed elsewhere; the `eveningCredit` worked back from stored totals
    disappears (D8).
25. **The SAS sells through EXTRAS.** Breakfast, catering, bath linen, linen pieces, cleaning, missing items,
    extinguisher and plugin items (`sasCommit.complementItems`) are requests to `priceExtras`, written as
    lines with `source = 'sas'` and the moment of rule 19. `planArrivalSas` / `planDepartureSas` become
    SETTLEMENT views over those lines.
26. **Free allowances are consumed by a line and stay with it** (ALLOWANCES unit, rule 41). The free bath
    hour, free units (« 2 offerts ») and included hours are a ledger per stay; a line records the allowance
    it consumed (`allowanceUsed`). Removing a line gives its allowance back for **future** sales; it never
    re-prices another standing line (D5). A pending card order reserves its allowance at quote time
    (`deferredCents`/`PRICE_ROSE` disappear).

### 3.F Selling an extra — one service for every seller

27. **`extraSale.sell(reservationId, requests, { source, payment, actor, now })`** — the only write path for
    an extra on an existing stay. In one transaction: load → `priceExtras` (stored stay context) →
    `composeTotals` (stored stay price + all lines) → `planSettlement` → write the new lines with their moment
    and status → update the stored bucket columns (`complementAmount`, `endOfStayComplementAmount`,
    `finalPrice`, VAT columns) → history entry. **It never writes the nights, the tax, the platform payout,
    the deposit or the installment rows** (the solde moves only for `plan` lines added by the operator before
    the stay is sold).
28. **Sources.** `fiche` (manual addition by the operator), `shop` (guest app), `sas` (check-in / check-out
    upsells and departure charges), `intake` (platform / iCal), `devis`. The fiche's ordinary save keeps its
    current path for stay edits and for lines of a stay not yet sold; on a sold stay, an added product goes
    through `extraSale.sell` (owner: « on passe par les mêmes composants et même principe »).
29. **Paying now.** _(amended 2026-11-11 for platform stays.)_ `payment: 'card'` returns a priced basket and
    mints a Qonto link; the line is written `due` with a hold, and the paid effect (`applyPaidEffect` →
    basket) sets `settledCents`. On a platform stay, before or after arrival, this link is **separate from the
    platform payment** and the line is outside the platform price (rule 17). `payment: 'cash' |
    'card-terminal'` at the SAS writes `paid` directly with a tender. `payment: 'later'` writes the moment of
    rule 19.
30. **Quote = commit.** `extraSale.quote(...)` runs the same pipeline without writing and returns what `sell`
    would write. A shop, SAS or fiche preview is a quote; a commit re-quotes inside the transaction and
    refuses if the price differs from the accepted one (one comparison, one refusal « Prix modifié — relire le
    panier »).

### 3.G The detail, everywhere the same

31. **One read model: `saleDetail(reservationId, now)`.** Built from TOTALS + SETTLEMENT on the stored lines:
    per line `label`, grouped `quantity × unit`, `total`, discount share, `source` (« Fiche », « Boutique »,
    « SAS »), `status` (« Payée par carte le 12/11 », « À payer à l'arrivée », « À payer au départ »,
    « Comprise dans le prix plateforme », « Dans l'acompte et le solde », « Offerte »), and per bucket the due
    total. The fiche, the SAS arrival recap, the SAS departure recap, the guest-app order view and the
    e-mails render this payload; none of them sums anything (CLAUDE.md §6.0).
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
35. **Zero diff is the bar.** A refactor commit with one differing hash does not ship. A behaviour commit
    (rest of PR B, PR C) ships with its **expected diff list** (each differing key, the reason, the rule)
    approved by the owner; any unlisted diff blocks. The replay runs on every commit of PR A, not only on the
    PR head.
36. **Stored data is never rewritten to make a replay pass.** Backfills (§5) add columns derived from what is
    stored; they never change an amount column.

### 3.I Rules added 2026-11-11

37. **The operator may change the moment of an unpaid line** (Q4, owner). On the fiche or in the SAS, an
    unpaid line moves among the moments valid for the stay state (`arrival` ↔ `departure` while the arrival
    complement is open; `departure` only once it is collected; `plan` only before the stay is sold). The
    operator's choice overrides the default STAY CLOCK gave; the line keeps both (`collectAt` and
    `collectAtDefault`) and each change is journaled in `reservation_history` with both values (« Bain
    nordique : à payer au départ (horloge : séjour commencé) → à payer à l'arrivée (opérateur) »). A paid
    line's moment is frozen (409 `LINE_PAID`). _(amended 2026-11-11: both values recorded, rule 46.)_
38. **Money helpers are shared, not a component.** `money.js` holds `roundMoney`, `toCents`, `fromCents` and
    `allocateCents`. It carries no business rule, so it is not a component; it is a unit because about twenty
    files redefine `round2` / `cents`, and two definitions that differ are a silent drift. PR A moves the
    engine's own `roundMoney` there unchanged; other copies are replaced in PR C only where the replay proves
    them identical.
39. **A line discount.** The operator may discount one unpaid line (percent or amount), from the fiche or the
    SAS. It is stored on the line (`discountCents`) and journaled. It is the only discount a shop or SAS sale
    receives.
40. **Discount allocation and rounding.** DISCOUNTS works in cents. For a percent `p` on a target set: the
    discount `D = round(Σ target × p / 100)` (half up, to the cent). For a fixed amount, `D = min(amount, Σ
    target)`. `D` is split over the target items in proportion to their amount; each share is floored to the
    cent and the cents left over go one by one to the items with the largest remainders (ties: accommodation
    first, then lines by `soldAt`, then id). So Σ shares = `D` exactly and no line goes below 0. VAT is split
    after the shares (each line's net amount). Target `nights` keeps rule 16's euro formula so stored stays do
    not move.
41. **ALLOWANCES is its own unit.** Grants come from the catalogue (free minutes per stay, free units per
    lodging); consumption comes from the stored lines' `allowanceUsed`. `consumeAllowance` serves a request in
    sale order and returns what it used; `releaseAllowance` returns a removed line's share to the pool. Shop,
    SAS and fiche read the same ledger, so « 1 h offerte encore disponible » is the same everywhere.
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
43. **Each unit has its own test file**, `server/src/tests/pricing-<unit>.unit.test.js`, which imports that
    unit alone, with fixtures built from plain objects (no DB). COMPOSE has a test that the composition equals
    the pre-refactor engine on the golden fixture.

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
      values and refuses a malformed one (`HH:MM`).
    - `models/stayClockModel.js` → `phaseForReservation(id, now)` loads the dates and times (reservation, then
      property) and calls `phaseOf`. **This is the only place anyone asks « has this stay started? »**. The
      loader of COMPOSE, `extraSale.quote/sell`, SETTLEMENT, `saleDetail`, the SAS, the fiche, the guest app
      and the e-mail context receive the phase from it. They only hand over the stay id.
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
    | `utils/midStayOrderCommit.js` l. 310-337 (`stayStarted`, `isArrivalNotMarked`, `hasGuestArrived`) | shop routing | C (file deleted) |
    | `plugins/guest-app` shop state / `orderCollection` callers (`index.js` l. 151-172, `shopController.read`) | shop open, J-7 flags | C |
    | `utils/arrivalMoment.js` `hasGuestArrived` | the module itself | C (removed once its last reader moves; « arrivée faite » display reads `checkInDone` / `arrivalSasDoneAt` directly) |
    | engine input `todayIso` / `midStayWindow` (`pricing.js` ~l. 1565, set by the controller) | phase fed to the engine | A (COMPOSE takes the resolver's phase as input; values unchanged in A) |
    | `plugins/booking-intake/intakeService.js` l. 159, `plugins/airbnb-intake/intakeService.js` l. 119, `plugins/gites-de-france-intake/intakeService.js` l. 136 (`startDate <= today()`) — _row added 2026-11-11 by the code check of rule 71_ | an intake refuses a started stay (« Séjour commencé : fiche à saisir à la main ») | C (`arrivalDayReached` through the SDK, same semantics; rule 71) |

    Slot and service-hour logic (`guest-app/serviceHours.js` `outsideStay`, `shopController` `remainingMornings`)
    asks a different question (is a delivery time inside the stay's opening hours) and keeps its own code; it
    reads `phase` only to know whether the stay is open at all (C).
46. **The clock decides the default, the operator may override, the journal keeps both.** A line written with
    the clock's `defaultCollectAt` stores it in `collectAtDefault`; an operator change (rule 37) sets
    `collectAt` and journals `default → chosen`. A later change of the clock (time passes) never rewrites a
    stored moment: the moment is decided once, when the line is written.

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
      line) → { label, detail } }`. A family emits tagged amounts (rule 61), never VAT.
    - **Instances** (`articles/makeArticle.js`, factory) — `makeArticle(catalogueRow)` returns a frozen
      `{ ref, family, config }` where `config` = price, label, `vatClass`, limits (min/max, mornings,
      persons), allowance (free units / minutes), fulfilment id, `sellableExternally`. The catalogue
      provider builds one instance per catalogue article (property overrides applied); an instance has no code.
      Adding a new article is a catalogue row; adding a new way of pricing is a family.
    - Today's `priceType` values map one to one to families. A family id is registered once (`DUPLICATE_FAMILY`
      at boot); an instance whose family has no live registration is not sellable (`FAMILY_UNAVAILABLE`),
      exactly as a `per_hour` line today when hourly-resources is off.
    - `describe` gives the fiche, the SAS and the guest app every price label (« 2 × 6,50 € · 2 offerts »,
      « 1 h × 30 € · + 20 € soirée »); no screen composes one.
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
    sale services only.
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
50. **One settings interface (settings provider).** Every parameterised component exports `settingsSchema` =
    `[{ key, type, default, scope: 'global'|'property'|'article', validate }]` (the shape plugins already use
    for `SETTINGS`), and receives its values only through `SettingsProvider.for(componentId, scope)`, resolved
    article → property → global → default. Validation is the component's own `validate`.

    | Component | Keys (scope) | PR A adapter reads today's |
    |---|---|---|
    | NIGHTS | `tariff` (property: rules, seasons, weekly model, degressivity, min/max nights, changeover) | `pricing_rules`, `tariffSnapshot`, property columns |
    | EXTRA GUESTS | `includedGuests`, `extraGuestPrice`, `extraGuestPriceUnit`, `tiers` (property) | `basePriceIncludedGuests`, `extraGuestPrice(Unit)`, tier tables |
    | TOURIST TAX | `mode`, `perPersonNight`, `percentage`, `departmentPercentage`, `fixedAmount`, `cap`, `exemptions`, `collector` (property; `collector` per platform) | `touristTax*` property columns, platform tax rows; `cap` / `exemptions` default to the values hard-coded today |
    | PLATFORM PRICE | `mode` (gross / commission), `commissionRate` (property × platform) | platform settings rows |
    | VAT | `regime` (global, by period), `rate.<family>.<customerContext>` (global, article override) | `vat_periods`; every `rate.*.hosted` = the regime rate; `rate.resources.external` = hourly-resources `standaloneVatRate` (moved in PR B) |
    | STAY CLOCK | `defaultCheckIn`, `defaultCheckOut` (property) | `properties.defaultCheckIn/Out` |
    | SCHEDULE | `depositPercent`, `depositEnabled`, `depositDueDays`, `balanceDaysBefore`, `cancelAfterBalanceDueDays` (property) | the same property columns |
    | ARTICLE FAMILIES / instances | per family schema, values per article instance (e.g. `hourly`: grid, `freeMinutes`, evening band) (article) | `property_option_prices`, `property_resource_prices`, plugin settings |

    No component reads a property row. In PR A the adapters read exactly today's columns, so every quote is
    byte-identical; a settings UI is out of scope (§8).
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
52. **Freely chainable steps (pipeline).** A use case is a list of steps over one quote context. A step is a
    plain object `{ id, requires: [keys], provides: [keys], apply(ctx) → ctx }`; `apply` returns a new context
    (never mutates). `buildPipeline(steps, { initial })` checks, **when the pipeline is built (module load,
    covered by a test)**, that every `requires` key is in `initial` or provided by an earlier step and that no
    key is provided twice; otherwise it throws `PIPELINE_MISSING_INPUT <step>.<key>`. A step that is not in a
    use case is never called.

    | Use case | Steps |
    |---|---|
    | `stayQuote` (fiche, devis, intakes) | loadStay → clock → nights → extraGuests → extras → platformPrice → discounts → touristTax → vat → totals → schedule → settlement |
    | `ficheSale`, `sasSale`, `shopSale` | loadStoredStay (provides the stored nights, extra guests, tax, platform figures) → clock → extras → lineDiscounts → vat(hosted) → totals → settlement |
    | `externalSale` | loadCatalogue → extras → lineDiscounts → vat(external) → totals → payment |

    `compose.js` is `stayQuote` plus `shape()`; PR A proves it at 0 diff. The typed context is a JSDoc
    `@typedef QuoteContext` listing every key (`stay`, `phase`, `nights`, `extraGuests`, `lines`, `platform`,
    `discount`, `touristTax`, `vat`, `totals`, `schedule`, `settlement`, `customerContext`, `settings`).
53. **The external sale.** A sale with no reservation (drinks to a walk-in, a bath hour sold at the door):
    `externalSale` pipeline, `customerContext = 'external'`, no nights, no tax, no schedule, no clock. It is
    paid on the spot (tender) or by a Qonto link. It is recorded in a core `standalone_sales` record (§5, Q13)
    with its lines, priced by the same families and fulfilled by the same adapters; the accounting journal reads
    it through the existing `standaloneSales` hook (`utils/standaloneSales.js`), as external hourly bookings
    already are. An optional client name and e-mail; no client fiche is created. Only families that need no stay context are sellable externally (`fixed`, `per_unit`, `hourly`); a
    `per_night` / `per_person*` / `percent_of_stay` article answers `validate` → `NEEDS_STAY`, and the catalogue
    offered to an external sale lists only the articles marked « vendable hors séjour » (`article` setting
    `sellableExternally`, default false).
54. **A pipeline per caller, chosen by the caller.** The fiche save of a stay edit uses `stayQuote`; « Ajouter
    un produit » uses `ficheSale`; the SAS `sasSale`; the guest app `shopSale`; the « Vente hors séjour »
    dialog `externalSale`. No caller assembles steps itself.
55. **Domain events for side effects (observer).** After the sale transaction commits, `extraSale` publishes
    `extraSale.sold`, `extraSale.lineMoved`, `extraSale.lineCancelled`, `extraSale.refundOwed`,
    `standaloneSale.sold` through `EventPublisher` (the existing eventBus, added to `EVENTS`). Observers: the
    guest e-mail (order confirmation), Google Calendar (bath session), staff push, history mirrors. The money,
    the journal line and the fulfilment `confirm` stay inside the transaction; an observer's failure is logged
    and never undoes a sale.
56. **No class hierarchy, no DI framework.** Components, families, instances, adapters, steps and ports are CommonJS
    modules exporting plain functions and objects. Wiring is explicit in `pipelines.js` and in plugin
    `register` functions.
57. **Each new interface has a contract test.** `article-family-contract` runs every registered family (core
    families and `hourly`) through the same cases (validate refuses out-of-bounds, quote is deterministic,
    describe matches quote); `article-fulfilment-contract` runs reserve/confirm/release against the bath
    adapter (overlap refused, heat-up honoured, release frees the slot, confirm inside a rolled-back
    transaction leaves nothing); `pipeline-composition` builds every use case and proves a missing input fails
    at build time.
58. **Q11 resolved:** a new discount typed on the fiche targets « Nuits » by default.
59. **Q12 resolved:** a stay discount never covers sales added later; a later sale gets its own line discount
    (rule 39).
60. **Where each interface lands.** Registry, core kinds, ports, settings provider (reading today's columns),
    VAT per (family, rate) group with line allocation, pipeline and `stayQuote`: PR A (0 diff). Fulfilment
    port and bath adapter, domain events, the `ficheSale` / `sasSale` pipelines, external-context VAT keys:
    PR B. `shopSale`, the external sale (`externalSale`, `standalone_sales`, dialog), guest-app observers: PR C.
    _(amended 2026-11-11, second round:)_ the Articles head, family registry, instance factory and the VAT
    component with its five former copies switched to it: PR A. `AccountingOutput` and its exporters: PR B,
    commit 2. Static duplication guards: introduced in A with allow-lists, strict at the end of C.


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
64. **Today's accounting reads, and where each moves.**

    | Reader today | What it reads / recomputes | Moves to | PR | Proof |
    |---|---|---|---|---|
    | `plugins/accounting-export/accountingModel.js` (`buildEntry`, `buildInstallmentEntry`, `buildEndOfStayEntry`, `buildMidStayNoteEntry`, `buildRefundEntry`, `buildPenaltyEntry`, `buildCompensationEntry`, `buildArrivalAdjustmentEntries`, `buildSettlementDiscountEntry`) | stored row money; **recomputes** VAT (`bucketFromTtc` l. 1567), bucket TTCs (`computeBucketTtcsFromContribs` l. 1462, `computeTaxTtcForKind` l. 1422, `grossRatio` l. 1053-1116) | `AccountingOutput.journalEntries` over the read models; VAT via the VAT component; legacy derivation in `legacyBucketSplit` | B (commit 2) | CSV of every month 2025-2028 and the golden `csv/*` keys byte-identical |
    | `plugins/accounting-export/accountingExport.js` (`entryToRows`, `rowsAtDefaults`, `bookedBucketSplit`, `entryVentilation`, own `round2`) | entries → CSV rows, ventilation residue on the last line | `csvJournal` exporter (formatting only) | B (commit 2) | same CSV hashes |
    | `plugins/accounting-export/synthesis.js` (own `cents`/`euros`/`roundHalfAway`) | VAT return, checks, collections from entries | `synthesis` exporter over the same entries; helpers from `money.js` | B (commit 2) | golden `finance/*` and synthesis hashes |
    | `utils/standaloneSales.js` hook ← `hourly-resources/bookingsModel.standaloneSales` | hourly bookings' journal rows (own `vatOf`) | read model for `AccountingOutput`; VAT via the VAT component | A (VAT), B (read model) | hourly booking rows byte-identical |
    | `models/financeModel.js` (`htAmount` l. 188; engine replays l. 291, 1185, 1286) | finance pages; **recomputes** HT | `htAmount` → VAT component (A); replays become the `stayQuote` pipeline (A, automatically) | A | golden `finance/*` |
    | `models/touristTaxReportModel.js` (engine replay l. 71) | tourist-tax report | TOURIST TAX component directly | B | golden `tourist-tax/*` |
    | `utils/paymentLinkItems.js` `buildVatItems` | **recomputes** HT per Qonto item | VAT component output | A | golden `link/*` (34 baskets) |
    | `plugins/online-payment/reconciliation/expectedReceipts.js` | the core ledger (`buildLedger`), own `cents`/`round2` | unchanged reader; helpers from `money.js` | C | reconciliation tests |
    | `utils/cancellationRequalification.js`, refund lines (`reservation_refund_lines.vatRate`) | credit note lines, frozen VAT rate | entries from the read models; frozen rate kept as stored data | B (commit 2) | golden `cancel/*` |
65. **No duplication: every formula exists once.** (owner: « toujours des petits composants simples et
    testables, sans dupliquer aucune logique ni ligne de code ».) A formula, a rate resolution, a rounding
    helper, a date comparison or a price grid has exactly one home; every other place calls it. The refonte
    removes:

    | Duplicate today | Copies | Single home | PR |
    |---|---|---|---|
    | VAT split TTC → HT/VAT | engine per family, `accountingModel.bucketFromTtc`, `financeModel.htAmount`, `paymentLinkItems.buildVatItems`, `hourly bookingPricing.vatOf` | VAT component | A |
    | Money helpers (`round2`, `roundMoney`, `cents`, `euros`, `roundHalfAway`) | ~20 files | `money.js` | A (engine), C (others, where the replay proves them identical) |
    | Hourly grid and evening supplement | `priceSessions`, `bookingPricing.priceBookingLines`, `scheduler.slotsForStay`, `schedulingModel.supplementOf`, `scheduler.orderSupplement` | `hourly` family | B |
    | "Has the stay started" / date comparisons | 16 call sites (rule 45, three of them in the intakes) | STAY CLOCK | B, C |
    | Accounting / collection recomputations | `computeBucketTtcsFromContribs`, `computeTaxTtcForKind`, `grossRatio`, `complementPaidSplit.contribSplit`, `installmentPaidSplit` pro rata, `arrivalPaymentDetail.billableLines`, `paymentsController.resolveAmountCents` (devis replay), `resolveInstallmentComponents` (tax share) | read models + VAT + SETTLEMENT; legacy derivation once in `legacyBucketSplit` | B |
    | "Offered" | engine `applyOfferedToLine`, SAS `offeredExtras`/`cleaningOffered`/`bathLinenOffered`, booking `offeredMinutes` | Articles head | B |
    | Extras arithmetic outside the engine | `sasOptionSale`, `getBathLinenOfferForReservation`, `resolveSasArrivalItems`, `sellable.optionFreeUnits` | families via the head | B, C |
    | Persons ceiling | `resolveServedPersons`, `midStayOrderCommit.personsShortfall` | `per_person*` families' `validate` | C |
    | Property price-override lookup | `reservationsModel` ×2, `bookingsModel` | `CatalogueProvider` | A |
    | Platform gross/net | engine pin, `grossFromNet`, `platformPriceCheck` | PLATFORM PRICE | A |
    | Platform commission and payout | `utils/platformCommission.computePlatformCommission`, inline copy in `controllers/platformPenaltiesController.js` (`gross − payout − tax − acompteCommission`), `acompteNetOf` there and `platformAcompteNet` in `reconciliation/expectedReceipts.js`, `grossOf` there and in `reconciliation/ficheWriter.js`, engine `clampCommission` / `platformNetReceivedAmount`, `reservationSettlement.platformCommission` | PLATFORM PAYMENT (rule 70) | A (engine, `computePlatformCommission`), B (penalties, cancellation, settlement), C (reconciliation helpers) |
    | Largest-remainder allocation | `cancelReservation` (l. 155-162), DISCOUNTS (rule 40), VAT (rule 62) | `money.allocateCents` | A |
    | Deferral of a complement | `isComplementDeferred`, `complementBuckets`, column read | SETTLEMENT | B |
66. **Guards against re-introduction** (`server/src/tests/no-duplicate-formulas.unit.test.js`, static, part of
    the server suite):
    - VAT: no `/(100 + ` / `* rate /` VAT expression outside `utils/pricing/vat/`;
    - money: no `function round2`, `const round2`, `const cents =`, `roundHalfAway` definition outside `money.js`;
    - dates: the rule-45 single-source test (no phase or collection decision by date comparison outside
      `stayClock*`);
    - hourly: `priceRange(` / band arithmetic only inside the `hourly` family;
    - families: `getTypeMultiplier` and per-type arithmetic only inside `articles/families/`;
    - exporters: no import of `vat/`, `articles/` or the pipeline from an exporter (they read entries only).
    Each guard has an allow-list file that must stay empty at the end of PR C; entries are allowed while a copy
    waits for its PR. A generic copy-paste detector (e.g. `jscpd`) is not added: it would be a new dependency
    and the targeted guards cover the formulas that matter (Q14).
67. **Read models are the only inputs of outputs.** `saleDetail`, `AccountingOutput`, the finance pages, the
    tourist-tax report and the payment-link baskets read stored lines, stored VAT output and settlements; a
    replay of the pricing pipeline is allowed only where today's code replays the engine (finance projections
    of unsold periods), and it calls the same `stayQuote` pipeline, never a copy.


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

    - **Contract:** `utils/pricing/platformPayment.js` — `commissionOf({basis, gross, payout, withheldTax,
      acompteCommission, rent?, netRent?}) → cents|null`, `clampCommissions({solde, acompte, echeances,
      installmentPlan}) → {solde, acompte, total}`, `netReceived({preArrival, commissions}) → cents|null`,
      `acompteNet(row) → cents`, `grossOf(row) → cents`, `payoutWithPenalty({payout, penalty}) → cents`,
      `withheldOnCancellation(row) → {acompte, solde}`. Pure; a step of the `stayQuote` pipeline after
      SCHEDULE. SETTLEMENT, the reconciliation, the penalties controller, the cancellation and the SDK
      `reservations.platformCommission` all call it.
    - **Price gate:** the figures of rule 68 gain, for each platform stay (Booking 13, Gîtes de France 16,
      Airbnb 8, Lodgify 10, Abracadaroom 4, Abritel 3, Greengo 2 in the snapshot): commission (acompte and
      solde), net received, payout, withheld tax, penalty and the cancellation withheld commissions.
    - **PRs:** A (the module, the engine's clamp and net received, `computePlatformCommission` re-exported
      from it, 0 diff); B (penalties controller, `remainingToPay`, cancellation, `platformStayRefusal` as
      `linkAllowed`); C (reconciliation helpers). Rule 66 gains a guard: no `gross - payout` /
      `depositAmount - acompteCommission` expression outside `platformPayment.js`.
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
      - The SDK is at 2.26.0.
    - **Compatibility guarantee.** Every SDK function above keeps its name, arguments, return shape and
      semantics. `calculateReservationQuote` keeps its 132-key output (rule 4). The fiche save keeps
      accepting today's patch: an adapter maps a line's `inComplement` on a platform stay at intake to
      `collectAt = 'platform'` (0) or `'arrival'` (1), the same derivation as `legacyCollectAt` (§5). No
      plugin is forced to change; no SDK major bump.
    - **The new port (additive, SDK 2.27.0).** `PlatformBookingIntake`: `reservations.fromPlatform(payload,
      { label, client, reuseByEmail })`, with `payload = { platform, reservationNumber, stay: { propertyId,
      startDate, endDate, checkInTime? }, party: { adults, children, teens, babies }, beds?, money: { gross,
      payout, withheldTax, commission?, basis? }, includedLines: [{ articleRef | description, quantity,
      amount }], complementLines?: [...], notes? }`. It runs the `stayQuote` pipeline. Included lines are
      `collectAt = 'platform'`; the commission comes from PLATFORM PAYMENT when it is absent. It refuses a
      started stay through STAY CLOCK `arrivalDayReached` (`PAST_RESERVATION`, the same message). The old
      `reservations.update` path for an intake patch is implemented on this port internally (adapter), so
      both entries run the same code. The three intake plugins may move to it in PR C, with no behaviour
      change. `coreModuleHistory.json` records 2.27.0.
    - **Tests.**
      - Each intake plugin's existing suites stay green, unchanged, at every PR.
      - `platform-intake-port.unit.test.js` (contract and adapter).
      - **Intake replay**, `platform-intake-replay.unit.test.js`. The stored parsed intakes of the
        snapshot (`booking_intakes` 11, `airbnb_intakes` 1, `gdf_intakes` 0) are anonymised by rule 68's
        `anonymise.js` (guest identity replaced by placeholders) into `fixtures/price-gate/intakes.json`, plus
        each plugin's own parser fixtures for Gîtes de France. Each is replayed on its fixture platform stay:
        plan → patch → save. The stored row, lines and figures must equal the baseline capture — **0 diff**.
      - The price gate covers the resulting platform stays (rule 70).
    - **PRs:** A (adapter behind `reservations.update` and the intake replay at 0 diff); B (`fromPlatform` port,
      SDK 2.27.0, iCal default-option pricing through the Articles head); C (intake date checks through STAY
      CLOCK, optional plugin migration to `fromPlatform`).

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
| `plugins/accounting-export/` | `accountingModel.js`, `accountingExport.js`, `synthesis.js`, `controller.js` | T (PR B) | entry builders replaced by `AccountingOutput`; the plugin keeps routes, account plan, platform accounts and settings |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `coreModules.json` | T | `ctx.articleFamily`, `ctx.articleFulfilment`, `ctx.slotAvailability`; SDK exposes `extraSale`, `saleDetail`, `stayClock` instead of `midStayOrderCommit` |
| `plugins/hourly-resources/` | `pricing.js`, `hourlyPricing.js`, `scheduler.js`, `schedulingModel.js`, `sasStep.js`, `bookingPricing.js` | T | one HOURLY TARIFF registered as the `hourly` family; `scheduler`/`schedulingModel` read it; `sasStep.complementItems` → requests; `bookingPricing` VAT → VAT unit |
| `plugins/hourly-resources/` | `slotAvailability.js`, `bathFulfilment.js` | C (PR B) | `SlotAvailabilityProvider` and the `hourly-slot` FULFILMENT adapter (rules 48-49) |
| `plugins/sdk/` | `eventBus.js` | T (PR B) | the events of rule 55 added to `EVENTS` |
| `plugins/guest-app/` | `ordersController.js`, `arrivalOrdersController.js`, `shopController.js`, `sellable.js`, `index.js` | T (PR C) | judge = `extraSale.quote`; commit = `extraSale.sell`; order lines keep `reservationLineId` |
| `plugins/sas/` | `controller.js`, `arrivalRecap.js`, `departureRecap.js` | T (PR B) | recap = `saleDetail` + SETTLEMENT |
| `database.js` | `database.js` | T | idempotent migration of §5 |
| `scripts/` | `pricing-replay.mjs` | C | rule 34 |
| `scripts/price-gate/` | `anonymise.js`, `figuresOf.js`, `buildFixture.mjs` | C (PR A) | rule 68 fixture builder |
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

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/:id/extras/quote` | `{ requests:[{ articleRef, quantity, persons?, mornings?, sessions?, offered? }], payment: 'later'\|'card'\|'cash' }` | `{ lines:[…priced, collectAt, status], buckets:{ arrival, departure, plan }, totalCents, refusals:[] }` | no write |
| POST | `/api/reservations/:id/extras` | same + `acceptedTotalCents` | `{ saleDetail, paymentLink? }` | 409 `PRICE_CHANGED` if the re-quote differs |
| PATCH | `/api/reservations/:id/extras/:lineId` | `{ collectAt?, offered?, quantity?, discount?:{percent\|amount} }` | `{ saleDetail }` | 409 `LINE_PAID`; refund confirmation flow of rule 23; journaled |
| GET | `/api/reservations/:id/sale-detail` | — | `saleDetail` | also embedded in `GET /sas` and the fiche payload |
| PUT | `/api/reservations/:id` (existing) | `discountTarget` added (`nights` default) | unchanged | rule 16 |
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
| `settledCents` | INTEGER | 0 | money collected for this line |
| `settlementRef` | TEXT | NULL | `link:<id>` \| `settlement:<id>` \| `note:<key>` |
| `discountCents` | INTEGER | 0 | the line's share of a stay discount (rule 40) or its own line discount (rule 39) |
| `allowanceUsed` | TEXT (JSON) | NULL | free units / minutes this line consumed |
| `orderRef` | TEXT | NULL | guest-app `order:<id>:<line>` (replaces `orderChargeKey` and description matching) |

On `reservations`: `discountTarget` TEXT DEFAULT `'nights'` (every existing row reads as today).

On the three line tables (PR B): `vatRate` REAL NULL (the rate the VAT step gave, rule 51; NULL on legacy lines = the stay's regime rate) and `fulfilmentRef` TEXT NULL (`hourly-slot:<hold id>`, rule 49).

On the catalogue tables (`options`, `resources`, guest-app articles) (PR B): `vatClass` TEXT NULL — NULL reads as today's family (`options` / `resources`), so every existing article keeps its group and rate (rules 61-62). No new table for the journal: `AccountingOutput` builds entries on read (rule 63).

New tables (PR C, rule 53, Q13): `standalone_sales` (`id`, `soldAt`, `customerName`, `customerEmail`, `totalCents`, `vatJson`, `status` paid|due|cancelled, `settlementRef`, `createdBy`) and `standalone_sale_lines` (`saleId`, `articleRef`, `kind`, `label`, `quantity`, `unitPrice`, `totalCents`, `vatRate`, `discountCents`, `fulfilmentRef`). Additive; no existing data touched.

`inComplement` stays (read by legacy code and the export) and is written in sync: `inComplement = collectAt
in ('arrival','departure')` until PR C retires its readers.

**Backfill (first commit of PR B), idempotent, amounts untouched:** `legacyCollectAt(line, reservation)`
reproduces today's routing: `inComplement = 1` → `arrival`, or `departure` when above
`arrivalExtrasBaseline` (mid-stay rule); `inComplement = 0` → `platform` on a platform sale, `plan` otherwise.
`settledCents` from `complementPaid`/`complementPaidSplit`, `endOfStayComplementPaid`, `midStaySettledNotes`
keys. Guest-app `orderChargeKey` → `orderRef`. `discountCents` stays 0 (stored discounts are `nights`). Runs
only where `collectAt IS NULL`. Proof: the replay with SETTLEMENT reading the new columns equals the replay
reading the legacy derivation.

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
- [ ] `pricing-nights`, `pricing-extra-guests`, `pricing-tourist-tax` — rules 3, 7-9; the static import-graph test of rule 2
- [ ] `pricing-extras`, `pricing-allowances`, hourly `hourly-tariff` — rules 10-14, 24, 26, 41 (free hour stays with its line; evening supplement identical from shop, SAS, fiche)
- [ ] `pricing-platform-price` — rule 17 (a post-booking sale on a platform stay leaves accommodation, tax and payout unchanged; `grossFromNet` parity)
- [ ] `pricing-discounts` — rules 16, 39, 40 (`nights` equals today's formula on every golden quote; Σ shares = D; largest remainder and ties; no negative line; paid lines excluded)
- [ ] `pricing-vat` — the four VAT readers give the same split on the same input; per-line allocation sums to the group VAT; `hosted` vs `external` rate per family; one row per rate in the breakdown; a single-rate stay equals today's figures
- [ ] `articles-family-<family>` ×7 (+ `hourly-family` in the plugin) — one file per family sub-component: formula, `validate`, `describe`, tagged amounts, no VAT (rule 47)
- [ ] `articles-head-contract` — the head is the only export of `articles/`; dispatch, refusals, allowance coordination, offered, locked snapshots, fulfilment calls; a request for an unregistered family is refused; instances are frozen config (rule 47)
- [ ] `vat-component` — rules 61-62: resolver by (vatClass, customerContext) and regime/franchise; one rounding per group; largest-remainder allocation sums to the group; per-rate output; byte-identical to the five former copies on the golden inputs
- [ ] `accounting-output-replay` — rule 63: neutral entries from the read models; each exporter reproduces today's CSV, JSON and synthesis byte for byte on every golden month; no exporter imports `vat/` or `articles/`
- [ ] `no-duplicate-formulas` — rule 66 static guards with their allow-lists, including the platform-payment guard of rule 70
- [ ] `pricing-platform-payment` — rule 70: every formula of the table, both commission bases, clamps, net received, acompte net, penalty, cancellation withheld commissions
- [ ] `platform-intake-port`, `platform-intake-replay` — rule 71: SDK contract unchanged, adapter, `fromPlatform`, replay of the stored intakes at 0 diff; booking-intake, airbnb-intake and gites-de-france-intake suites green unchanged
- [ ] `article-family-contract` — every registered family, core and `hourly`, through the same cases (rule 57)
- [ ] `article-fulfilment-contract` — run against the bath adapter: hold, overlap refused, heat-up honoured, confirm in the sale transaction, rollback leaves no booking, release frees the slot (rule 57)
- [ ] `pipeline-composition` — every use case builds; a missing `requires` throws at build; `externalSale` never calls nights, tax, clock or schedule; `stayQuote` output equals the pre-refactor engine (rule 52)
- [ ] `settings-provider` — resolution article → property → global → default; each component's schema validates; PR A adapter returns today's column values (rule 50)
- [ ] `standalone-sale` — rule 53: priced by the same families, external VAT, recorded, journal row through `standaloneSales`
- [ ] `extra-sale-events` — rule 55: events published after commit only; an observer failure never undoes a sale
- [ ] `pricing-totals`, `pricing-compose` — rule 4: composition deep-equal to the pre-refactor engine on the fixture; TOTALS computes nothing (only sums provided keys)
- [ ] `pricing-stay-clock` — rules 20, 44: the exact check-in minute (14:59 → `before`, 15:00 → `during`), the exact check-out minute (`during` → `after`), J-1 23:59, the two DST days (last Sunday of March and of October, a check-in at 02:30 that does not exist / exists twice), missing `checkInTime` → property `defaultCheckIn` → `15:00`, malformed time refused, `now` injected (no `Date.now()` in the file), arrival mark set before check-in time does not start the stay
- [ ] `stay-clock-model` — `phaseForReservation` reads the reservation then the property; the only resolver
- [ ] `stay-clock-single-source` — static test of rule 45: no date comparison deciding a phase or a collection moment outside `stayClock*`
- [ ] rule 46: a line keeps `collectAtDefault`; an operator change journals both values; time passing never rewrites a stored moment
- [ ] `pricing-schedule`, `pricing-settlement` — rules 18-23, 37 (table of rule 19, netting once, moment change journaled, paid frozen)
- [ ] `extra-sale-fiche`, `extra-sale-shop`, `extra-sale-sas` — rules 27-30 per seller; quote = commit; platform card link separate (rule 29)
- [ ] `sale-detail` — rules 31-32: Σ lines = bucket; same payload for fiche and SAS; the after-check-in section
- [ ] `pricing-legacy-collect-at` — §5 backfill derivation
- [ ] Golden fixture unchanged through PR A and B's first commit (no `GOLDEN_UPDATE`), with accounting-export installed
- [ ] Regression tests named after each review defect (D1-D9) on the rebuilt guest app (PR C)

### Proof
- [ ] Price gate (rule 68): `price-gate.unit.test.js` green on every commit of A, B and C, with the allowlist reviewed by the owner; `price-gate-anonymity`, `price-gate-anonymise`, `price-gate-figures`, `price-gate-compare` unit tests green
- [ ] Review per rule 69: one integral review with the PROVEN / NOT PROVEN checklist, one grouped fix, one verification pass
- [ ] Stabilisation per rule 69 after PR C: rounds of integral audit → grouped fix → verification until a round with zero findings; findings table per round separating old defects from regressions
- [ ] the replay hashes every accounting export file (CSV per month, sales JSON, synthesis) besides the quotes (rule 64)
- [ ] `scripts/pricing-replay.mjs` before/after on a fresh prod copy at every commit of PR A (0 diff), at PR B's first commit (0 diff), at PR B and PR C heads (listed diffs only)

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

## 10. Migration plan — three PRs

Each PR targets `inte/plugins`, is provable on its own, and carries the replay result in its body. Inside a
PR, one commit per unit so the replay can be bisected.

| PR | Content | Proof | Size |
|---|---|---|---|
| **A — Units, byte-identical** | price-gate fixture captured on `price-gate-baseline` and the gate test (rule 68); `scripts/pricing-replay.mjs` and baseline; extract, one commit each: `money`, NIGHTS, EXTRA GUESTS, TOURIST TAX, EXTRAS host + ALLOWANCES (read-only form of today's free units), STAY CLOCK (`phaseOf` + `stayClockModel`, fed to COMPOSE in place of `todayIso`/`midStayWindow`, same values), PLATFORM PRICE, DISCOUNTS (target `nights` only active), VAT (per (family, rate) group with line allocation, every line `hosted`), TOTALS (aggregation only), SCHEDULE, SETTLEMENT (reading `inComplement`); the Articles head, family registry, instance factory and the 7 core families, with `hourly` wrapped from the contributor alias; the VAT component fed by tagged amounts, and the five VAT copies (engine, `accountingModel.bucketFromTtc`, `financeModel.htAmount`, `paymentLinkItems.buildVatItems`, `bookingPricing.vatOf`) switched to it; the ports with core adapters and `SettingsProvider` reading today's columns, each component's `settingsSchema`; `pipeline.js` and `stayQuote`; `calculateReservationQuote` = COMPOSE | also PLATFORM PAYMENT (engine clamp, net received, `computePlatformCommission` re-exported) and the intake adapter behind `reservations.update` (rules 70-71) | price gate green with an **empty** allowlist; intake replay 0 diff; intake plugin suites green; golden + replay **0 diff at every commit** (quotes, links, CSV months, finance); `article-family-contract`, `articles-head-contract`, `vat-component`, `pipeline-composition`, `settings-provider` green | XL — ~5 300 LOC moved or new, ~2 900 LOC of tests (~33 files); 7-9 coder passes; review by commit; A1/A2 split available |
| **B — Lines, sale service, detail, accounting output** | commit 1: line columns + `discountTarget` + backfill (0 diff). Commit 2: `AccountingOutput`, `legacyBucketSplit` and the `csvJournal` / `salesJson` / `synthesis` exporters replace the accounting-export entry builders; tourist-tax report on TOURIST TAX (0 diff on every export file). Then: the B call sites of rule 45 go through `phaseForReservation` (routing by date and check-in time); `extraSale` quote/sell + API; fiche « Ajouter un produit », moment menu, discount targets and line discount; SAS upsells and departure charges through EXTRAS; one HOURLY TARIFF (evening supplement as component, `bookingPricing` on the same grid); `saleDetail` + `SaleDetailList` in fiche and both SAS; platform card link separate; `ficheSale` / `sasSale` pipelines; FULFILMENT port + bath adapter (`SlotAvailabilityProvider`, SAS bath sessions confirmed in the sale transaction); domain events of rule 55 with the calendar observer; `vatRate` / `fulfilmentRef` line columns; external-context VAT keys (`standaloneVatRate` moved); retire `sasOptionSale`, bath-linen offer, `prepaidNetter`, `arrivalPaymentDetail.billableLines`, VAT copies; PLATFORM PAYMENT in penalties, settlement, cancellation and `linkAllowed`; the `PlatformBookingIntake` port (`reservations.fromPlatform`, SDK 2.27.0); iCal default options through the Articles head | price gate green, allowlist entries = the listed diffs only, owner-reviewed; commits 1-2: 0 diff (quotes and every export file); head: **listed diffs only** (below) | XL — ~4 000 LOC + tests; 6-8 passes |
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
