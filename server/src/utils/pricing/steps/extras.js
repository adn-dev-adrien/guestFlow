/**
 * STEP extras — ARTICLES (specs/pricing-components.md §3 rule 52).
 *
 * The option, custom option, engine-derived and resource lines of the stay, priced through the Articles head
 * with the free-units ledger.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const priceLineContributors = require('../../priceLineContributors');
const { roundMoney } = require('../money');
const { getRuleNightBaseForDate, getProgressiveExtraNightPrice } = require('../nights');
const articles = require('../articles');
const { createFreeUnitsLedger, applyPerHourFreeMinutes } = require('../allowances');
const { portionCap, clampPortions } = require('../../mealPortions');
const { buildBabyBedSupplementLine, isBabyBedOption } = require('../../babyBedSupplement');
const { lockedUnitPriceOr } = articles;

// What an option line's `quantity` counts, when the summary has to say it
// (specs/review-2026-10-18-reservations.md rule 5; review F13:
// « Petit déjeuner ×3 » read as three portions when it meant three mornings). A breakfast counted by
// the day — placed on its mornings, or a plain per-night price — counts mornings; a breakfast still
// to plan counts portions and is left unnamed.
function withQuantityUnit(line, option) {
  if (!line || !option || option.autoOptionType !== 'breakfast' || line.toBeScheduled) return line;
  const placed = Array.isArray(line.cardOccurrences) && line.cardOccurrences.length > 0;
  const byDay = !option.showsPlanningCard && ['per_night', 'per_person_per_night'].includes(line.priceType || option.priceType);
  return placed || byDay ? { ...line, quantityUnit: 'morning' } : line;
}
// The figure the summary prints beside the line (specs/non-card-option-served-persons.md rule 29), the
// same reading as the fiche's field. A breakfast counted by the day says its mornings: the stay's for a
// count of people, the typed ones for a count of nights.
function withDisplayCount(line, nights) {
  if (!line) return line;
  const mornings = line.quantityUnit === 'morning' && line.servedPersons !== undefined;
  return { ...line, displayCount: mornings ? nights : (line.servedPersons ?? line.servedNights ?? line.quantity) };
}
// Option-driven planning cards (specs/option-planning-card.md §3.4). Parse the per-reservation
// selected occurrences (the checked moments) into a clean [{ date, time }] array. Accepts a stored
// JSON string or an array; drops entries without a valid ISO date. The length drives billedUnits.
function normalizeCardOccurrences(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list
    // `done` is the planning-operational « préparé » flag (§3.5); preserved through pricing so a
    // reservation re-save doesn't reset it. It never affects billedUnits.
    .map((o) => ({ date: String(o?.date || '').slice(0, 10), time: String(o?.time || '').trim(), done: Boolean(o?.done) }))
    .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date));
}


function timeToDecimalHour(timeStr, fallback = 0) {
  const value = String(timeStr || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number(fallback || 0);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number(fallback || 0);
  return hours + minutes / 60;
}

function computeAutoTimedOptionContext({
  option,
  checkInTime,
  checkOutTime,
  defaultCheckIn,
  defaultCheckOut,
  nightlyBreakdown,
  lateCheckoutNextNightPrice,
}) {
  if (!option || !option.autoOptionType || Number(option.autoEnabled || 0) !== 1) return null;

  const isEarly = option.autoOptionType === 'early_check_in';
  const isLate = option.autoOptionType === 'late_check_out';
  if (!isEarly && !isLate) return null;

  const defaultHour = isEarly
    ? timeToDecimalHour(defaultCheckIn, 15)
    : timeToDecimalHour(defaultCheckOut, 10);
  const requestedHour = isEarly
    ? timeToDecimalHour(checkInTime || defaultCheckIn, defaultHour)
    : timeToDecimalHour(checkOutTime || defaultCheckOut, defaultHour);

  const needsOption = isEarly ? requestedHour < defaultHour : requestedHour > defaultHour;
  if (!needsOption) return null;

  const thresholdDefault = isEarly ? '10:00' : '17:00';
  const thresholdHour = timeToDecimalHour(option.autoFullNightThreshold || thresholdDefault, isEarly ? 10 : 17);
  const firstNightPrice = Number(nightlyBreakdown?.[0]?.price || 0);
  const lastStayNightPrice = Number(nightlyBreakdown?.[Math.max(0, (nightlyBreakdown?.length || 1) - 1)]?.price || 0);
  // Source de calcul: une nuit de référence (jamais le total séjour)
  // - arrivée anticipée: nuit d'arrivée
  // - départ tardif: nuit suivant la date de départ (fallback: dernière nuit du séjour)
  const concernedNightPrice = isEarly
    ? firstNightPrice
    : Number(lateCheckoutNextNightPrice || lastStayNightPrice || 0);

  const isFullNight = isEarly ? requestedHour <= thresholdHour : requestedHour >= thresholdHour;
  const extraHours = isEarly
    ? Math.max(0, defaultHour - requestedHour)
    : Math.max(0, requestedHour - defaultHour);

  let totalPrice = Number(option.price || 0);
  if (String(option.autoPricingMode || 'fixed') === 'proportional') {
    const proportionalWindowHours = isEarly
      ? Math.max(0, defaultHour - thresholdHour)
      : Math.max(0, thresholdHour - defaultHour);
    const proportionalRatio = proportionalWindowHours > 0
      ? Math.max(0, Math.min(1, extraHours / proportionalWindowHours))
      : 0;
    totalPrice = isFullNight
      ? concernedNightPrice
      : concernedNightPrice * proportionalRatio;
  }

  return {
    optionId: Number(option.id),
    title: option.title,
    titleEn: option.titleEn || null,
    quantity: 1,
    unitPrice: roundMoney(totalPrice),
    billedUnits: 1,
    priceType: 'per_stay',
    totalPrice: roundMoney(totalPrice),
    autoOptionType: option.autoOptionType,
    autoPricingMode: option.autoPricingMode || 'fixed',
    autoExtraHours: roundMoney(extraHours),
    autoFullNightApplied: Boolean(isFullNight),
  };
}

function getLateCheckoutNextNightReferencePrice({ rules, endDate, stayNights }) {
  const { matchedRule, nightlyBase } = getRuleNightBaseForDate(rules, endDate);
  if ((matchedRule?.pricingMode || 'fixed') !== 'progressive') {
    return roundMoney(nightlyBase);
  }

  const extraNightNumber = Math.max(1, Number(stayNights || 0) + 1);
  const extraNightPrice = extraNightNumber === 1
    ? nightlyBase
    : getProgressiveExtraNightPrice(matchedRule, extraNightNumber, nightlyBase);

  return roundMoney(extraNightPrice);
}

function storedSessionsOf(selected) {
  return Array.isArray(selected?.sessions) && selected.sessions.length > 0 ? { sessions: selected.sessions } : {};
}

const DEBUG_RESOURCE_LINES = process.env.DEBUG_RESOURCE_LINES === '1';

function debugResourceLine(stage, payload) {
  if (!DEBUG_RESOURCE_LINES) return;
  try {
    console.log(`[pricing.resourceLines] ${stage}`, payload);
  } catch {
    // Keep pricing computation resilient even if debug logging fails.
  }
}

const step = {
  id: 'extras',
  requires: [
    'autoOptionsInComplement', 'billableBabyBeds', 'cancellationInsuranceBase',
    'cancellationInsurancePriceOverride', 'channel', 'checkInTime', 'checkOutTime', 'customOptions',
    'defaultOfferedOptionIds', 'endDate', 'isDirectBooking', 'lockedOptionLines', 'lockedOptionUnits',
    'lockedResourceLines', 'lockedResourceUnits', 'lockedTariff', 'nightlyBreakdown', 'nights', 'offeredOptionIds',
    'optionsById', 'persons', 'planningCardAsQuantity', 'resourcesById', 'rules', 'selectedOptions',
    'selectedResources', 'settings', 'startDate',
  ],
  provides: [
    'consumedMap', 'finalOptionLines', 'grantedFreeUnitsFor', 'optionsTotal', 'resourceLines', 'resourcesTotal',
    'soldGrantMap',
  ],
  apply(ctx) {
    const {
      autoOptionsInComplement, billableBabyBeds, cancellationInsuranceBase,
      cancellationInsurancePriceOverride, channel, checkInTime, checkOutTime, customOptions,
      defaultOfferedOptionIds, endDate, isDirectBooking, lockedOptionLines, lockedOptionUnits,
      lockedResourceLines, lockedResourceUnits, lockedTariff, nightlyBreakdown, nights, offeredOptionIds,
      optionsById, persons, planningCardAsQuantity, resourcesById, rules, selectedOptions,
      selectedResources, settings, startDate,
    } = ctx;

    const optionUnitOverrides = lockedOptionUnits || {};
    const resourceUnitOverrides = lockedResourceUnits || {};
    const offeredOptionIdSet = new Set((Array.isArray(offeredOptionIds) ? offeredOptionIds : []).map((id) => Number(id)));
    const lockedOptionsById = new Map(
      (Array.isArray(lockedOptionLines) ? lockedOptionLines : [])
        .map((line) => [Number(line.optionId), line])
    );
    const lockedResourcesById = new Map(
      (Array.isArray(lockedResourceLines) ? lockedResourceLines : [])
        .map((line) => [Number(line.resourceId), line])
    );
    const { soldGrantMap, consumedMap, grantedFreeUnitsFor, consumedFreeUnitsFor } = createFreeUnitsLedger({
      lockedTariff, optionsById, lockedOptionsById, isDirectBooking,
    });

    // Per-item routing (spec force-item-to-complement.md):
    //   `inComplement` flag → returned in each line so the client renders the chip and the
    //     accounting model attributes the line 100 % to the complément entry.
    //   `acompteContribTtc` / `soldeContribTtc` → snapshots captured by reservationsController
    //     .updatePayment on `*Paid` 0→1 flips, surfaced from the DB-side locked line. They drive
    //     the per-bucket attribution in accounting (no recomputation here — pure pass-through).
    // specs/force-extras-complement-on-platform.md §3 — on a non-direct platform reservation (incl.
    // iCal imports), an extra DEFAULTS into the Complément bucket, but the operator can pull it back
    // out: an explicit per-line `inComplement` flag always wins. Only a freshly-added line that carries
    // no flag yet falls back to the platform default. Forced lines carry NULL contribs (they live
    // 100% in Complément, never in Acompte/Solde). The default keeps `complementAmount` correct so the
    // option price never leaks into the deposit/balance split when the line is in Complément.
    // specs/plugins-phase-p-productisation.md rule 45 — a counts-as-direct channel is a direct sale: no
    // platform default here.
    const forceExtrasToComplement = channel.platformSale;
    const resolveInComplement = (explicit) => (
      (explicit != null ? Number(explicit) : (forceExtrasToComplement ? 1 : 0)) ? 1 : 0
    );
    const pickContribsAndForce = (selected, locked) => {
      const explicit = (selected && selected.inComplement != null) ? selected.inComplement
        : (locked && locked.inComplement != null ? locked.inComplement : null);
      const inComplement = resolveInComplement(explicit);
      return {
        inComplement,
        acompteContribTtc: inComplement ? null : (locked && locked.acompteContribTtc != null ? Number(locked.acompteContribTtc) : null),
        soldeContribTtc: inComplement ? null : (locked && locked.soldeContribTtc != null ? Number(locked.soldeContribTtc) : null),
      };
    };
    // Override set for auto-option routing (parallel signal to selectedOptions[i].inComplement,
    // see the function-level comment on `autoOptionsInComplement`).
    const autoInComplementSet = new Set((Array.isArray(autoOptionsInComplement) ? autoOptionsInComplement : []).map(Number));

    const articleStay = {
      persons, nights, maxGuests: settings.articles.maxGuests, isDirectBooking, cancellationInsuranceBase, debug: debugResourceLine,
    };
    const freeUnitsLedger = { grantedFreeUnitsFor, consumedFreeUnitsFor };
    // One price through the Articles head: the families price, the head keeps the sold snapshot, the free units and « offert ».
    const quoteArticle = (request) => articles.quote({ requests: [request], stayContext: articleStay, allowance: freeUnitsLedger }).lines[0];
    // « Offert » on an amount fixed upstream (an engine-derived line, a custom line, a plugin-priced hour).
    const offeredOf = (ref, vatClass, totalPrice, offered) => quoteArticle({ ref, vatClass, priced: { totalPrice }, offered }).offeredFigures;

    const optionLines = (Array.isArray(selectedOptions) ? selectedOptions : [])
      .map((selected) => {
        const optionId = Number(selected.optionId);
        const option = optionsById.get(optionId);
        if (!option) return null;
        const priceType = option.priceType || 'per_stay';
        const locked = lockedOptionsById.get(optionId);
        const article = articles.makeArticle(option);
        const request = {
          article, locked, offered: offeredOptionIdSet.has(optionId), unitOverride: optionUnitOverrides[optionId],
        };

        // Option-driven planning card (specs/option-planning-card.md §3.4): the per-reservation
        // selected occurrences REPLACE the automatic nights/days path and drive the billed quantity:
        // billedUnits = occurrences × (persons when the option is per-person, else 1). An empty
        // selection means « not placed yet », NOT « not sold » — the option is removed by its switch
        // alone (specs/unscheduled-card-option.md rules 1 + 5).
        //
        // Because this path rebuilds the quantity from the occurrences it CANNOT use
        // `mergeLineWithLockedSnapshot` (which merges by units) — so the unit price is locked on its
        // own, from the booking's snapshot (specs/devis-extras-parity-and-price-lock.md §3 rule 13bis).
        // Without it a tariff change re-priced the card options of reservations already sold and paid:
        // the raise landed in the mid-stay split as an end-of-stay complement nobody had agreed to.
        // The cancellation insurance is priced from the stay, not from occurrences: even if the
        // operator also ticked « carte planning » on it, the card path must not read its percentage
        // as a euro unit price, nor bill it per scheduled slot
        // (specs/cancellation-insurance.md §3.1 rules 4 + 5bis).
        if (article.family === 'perUnit') {
          const perPerson = String(priceType).includes('per_person');
          const occurrences = normalizeCardOccurrences(selected.cardOccurrences);
          const asked = Math.max(0, Number(selected?.quantity || 0));
          // UNSCHEDULED — the option is taken, its moments are not placed yet
          // (specs/unscheduled-card-option.md rules 1, 3, 4). The line is NEVER dropped here: that
          // `return null` is what erased a breakfast the guest had already paid for, on the first save
          // of any reservation born on the website. Same decision as the hourly resources
          // (specs/hourly-resource-quantity-and-sas-scheduling.md rules 1 + 3): the quantity sells the
          // prestation, the arrival SAS places it.
          // Switching the option OFF is the one and only way to remove it. An empty moment grid means
          // « not planned yet », never « not sold » (supersedes specs/option-planning-card.md §3.4).
          if (occurrences.length === 0 && asked <= 0) return null;
          const priced = quoteArticle({
            ...request,
            quantity: asked,
            occurrences,
            cardPersons: selected?.cardPersons,
            // PUBLIC/site flow: the visitor's quantity is the intent, counted in PORTIONS for a
            // per-person option — one breakfast, one cover, never séances to multiply by the party
            // (specs/site-meal-portions.md rule 1) — and held to what the stay can serve (rule 3).
            // Everywhere else the line keeps the portions it was sold at, so a replay that carries no
            // moment reproduces the amount instead of inventing one.
            portions: (sold) => (planningCardAsQuantity
              ? (perPerson
                ? clampPortions(asked, portionCap({
                  option, persons, nights, checkInTime, checkOutTime, property: settings.stayClock,
                }).cap)
                : { quantity: asked, clampedFrom: null })
              : { quantity: sold != null ? sold : asked, clampedFrom: null }),
          });
          if (!priced) return null;
          return {
            optionId,
            title: option.title,
            titleEn: option.titleEn || null,
            ...priced.figures,
            ...priced.offeredFigures,
            ...pickContribsAndForce(selected, locked),
          };
        }

        const quantity = Math.max(0, Number(selected?.quantity || 0));
        if (quantity <= 0) return null;

        // `percent_of_stay` and the cancellation insurance (specs/cancellation-insurance.md §3.1 rules 4-5bis, 13) are
        // stay-wide: the head forces the quantity to 1 and prices them from the accommodation actually charged.
        const priced = quoteArticle({
          ...request,
          quantity,
          cardPersons: selected?.cardPersons,
          cardNights: selected?.cardNights,
          stayWideAmount: cancellationInsurancePriceOverride,
        });
        if (!priced) return null;
        return {
          optionId,
          title: option.title,
          titleEn: option.titleEn || null,
          ...priced.figures,
          ...priced.offeredFigures,
          ...pickContribsAndForce(selected, locked),
        };
      })
      .filter(Boolean)
      .map((line) => withDisplayCount(withQuantityUnit(line, optionsById.get(Number(line.optionId))), nights));

    // Custom option lines never have a persisted locked row keyed by optionId (their id rolls each
    // save), so the only source of `inComplement` / contribs is this input: a stored stay's replay
    // reads them from its rows (`buildReservationEngineInput`), a save carries them onto the posted
    // lines (`carryStoredCustomContribs`, specs/reservation-save-keeps-pricing.md rule 19). A preview
    // has none and needs none: they move no figure of the quote.
    const customOptionLines = (Array.isArray(customOptions) ? customOptions : [])
      .map((line, index) => {
        const description = String(line?.description || '').trim();
        const amount = roundMoney(Math.max(0, Number(line?.amount || 0)));
        const offered = Boolean(line?.offered);
        if (!description || amount <= 0) return null;
        const customOffered = offeredOf(`custom:${line?.customOptionId != null ? Number(line.customOptionId) : index + 1}`, 'options', amount, offered);
        return {
          isCustom: true,
          customOptionId: line?.customOptionId != null ? Number(line.customOptionId) : undefined,
          customKey: line?.customKey || `custom_${index + 1}`,
          title: description,
          offered,
          quantity: 1,
          unitPrice: amount,
          billedUnits: 1,
          priceType: 'per_stay',
          originalTotalPrice: customOffered.originalTotalPrice,
          totalPrice: customOffered.totalPrice,
          // Explicit flag wins; an unflagged custom line defaults to the platform routing (see resolveInComplement).
          inComplement: resolveInComplement(line?.inComplement != null ? line.inComplement : null),
          acompteContribTtc: resolveInComplement(line?.inComplement != null ? line.inComplement : null) ? null : (line?.acompteContribTtc != null ? Number(line.acompteContribTtc) : null),
          soldeContribTtc: resolveInComplement(line?.inComplement != null ? line.inComplement : null) ? null : (line?.soldeContribTtc != null ? Number(line.soldeContribTtc) : null),
        };
      })
      .filter(Boolean);

    const selectedOptionIds = new Set(optionLines.map((line) => Number(line.optionId)));
    const autoOptionLines = Array.from(optionsById.values())
      .filter((option) => Number(option.autoEnabled || 0) === 1)
      .map((option) => (
        // Two families of engine-derived options: the timed ones, priced against a reference night from
        // the actual check-in/out hour, and the baby-bed supplement, priced per cot for the stay.
        isBabyBedOption(option)
          ? buildBabyBedSupplementLine({
            option,
            babyBeds: billableBabyBeds,
            // A saved booking keeps the price it was sold at; the QUANTITY still follows the current
            // cot count (§3.4 rule 15 + §3.3 rule 12).
            unitPrice: lockedUnitPriceOr(lockedOptionsById.get(Number(option.id)), Number(option.price || 0)),
          })
          : computeAutoTimedOptionContext({
            option,
            checkInTime,
            checkOutTime,
            defaultCheckIn: settings.stayClock.defaultCheckIn || '15:00',
            defaultCheckOut: settings.stayClock.defaultCheckOut || '10:00',
            nightlyBreakdown,
            lateCheckoutNextNightPrice: getLateCheckoutNextNightReferencePrice({
              rules,
              endDate,
              stayNights: nights,
            }),
          })
      ))
      .filter(Boolean)
      .map((line) => {
        const optionId = Number(line.optionId);
        const locked = lockedOptionsById.get(optionId);
        // Auto-timed options (early check-in / late check-out) are priced from the ACTUAL
        // check-in/out time against the property's reference night. The reference night price is
        // already frozen upstream via the locked nightly breakdown, so the option is ALWAYS
        // recomputed from the current time — changing the arrival/departure time must reprice it,
        // even on an already-saved reservation. (Freezing it through the locked option snapshot was
        // the bug: the amount never moved when the operator changed the time; cf.
        // specs/timed-options-proportional-pricing.md §3 rule 6.) Only the routing flags fall back
        // to the locked snapshot. The baby-bed line resolved its own frozen unit price above, and
        // joins here to inherit the very same offered / Complément / contribs handling.
        // Auto-options can be flipped to Complément too (a common case: Adrien sometimes wants the
        // surcharge to land in the post-arrival bucket because it's collected on site). The override
        // list wins; falls back to the locked snapshot for already-saved reservations.
        const forced = forceExtrasToComplement || autoInComplementSet.has(optionId) || Boolean(locked?.inComplement);
        return {
          ...line,
          ...offeredOf(`option:${optionId}`, 'options', line.totalPrice, offeredOptionIdSet.has(optionId)),
          inComplement: forced ? 1 : 0,
          acompteContribTtc: forced ? null : (locked?.acompteContribTtc != null ? Number(locked.acompteContribTtc) : null),
          soldeContribTtc: forced ? null : (locked?.soldeContribTtc != null ? Number(locked.soldeContribTtc) : null),
        };
      })
      .filter((line) => !selectedOptionIds.has(Number(line.optionId)));

    // Render the summary in the same order as the main option list (catalog order = by title);
    // custom options keep their input order at the end.
    const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'fr');
    const finalOptionLines = [
      ...[...optionLines, ...autoOptionLines].sort(byTitle),
      ...customOptionLines,
    ].map((line) => (
      // A property-default « offered » option that is indeed offered → « Comprise » (included in the rate).
      line && !line.isCustom && line.offered && defaultOfferedOptionIds.has(Number(line.optionId))
        ? { ...line, includedInRate: true }
        : line
    ));

    const resourceLines = (Array.isArray(selectedResources) ? selectedResources : [])
      .map((selected) => {
        debugResourceLine('input.selected', { selected });

        const resourceId = Number(selected.resourceId);
        const resourceForFlags = resourcesById.get(resourceId);
        const lockedForLine = lockedResourcesById.get(resourceId);

        // specs/plugins-phase-3c-hourly-resources.md rules 1–3 — a live plugin may price this line (an
        // hour of nordic bath placed on the evening band). The engine keeps the rest: an UNSOLD line
        // takes the plugin's amounts; a SOLD one goes through the locked snapshot below with its sold
        // hours, never fewer, so placing them never re-prices it (hourly-resource-quantity-and-sas-
        // scheduling.md rules 30–31).
        const contributed = resourceForFlags
          ? priceLineContributors.priceLine(resourceForFlags, { selected, sold: Boolean(lockedForLine), startDate, endDate, nights, persons })
          : null;
        if (contributed && !lockedForLine && contributed.totalPrice !== undefined) {
          const hasExplicitOffered = selected?.offered !== undefined && selected?.offered !== null;
          return {
            resourceId,
            name: resourceForFlags.name,
            nameEn: resourceForFlags.nameEn || null,
            quantity: contributed.quantity,
            unitPrice: contributed.unitPrice,
            billedUnits: contributed.billedUnits,
            ...contributed.extra,
            ...offeredOf(`resource:${resourceId}`, 'resources', contributed.totalPrice, hasExplicitOffered ? Boolean(selected?.offered) : false),
            ...pickContribsAndForce(selected, lockedForLine),
          };
        }

        const declaredQuantity = Math.max(0, Number(selected?.quantity || 0));
        const quantity = contributed
          ? roundMoney(lockedForLine ? Math.max(declaredQuantity, contributed.quantity) : contributed.quantity)
          : declaredQuantity;
        debugResourceLine('parsed.quantity', { quantity });
        if (quantity <= 0) {
          debugResourceLine('skip.non_positive_quantity', { quantity, selected });
          return null;
        }

        debugResourceLine('parsed.resourceId', { resourceId });
        const resource = resourcesById.get(resourceId);
        if (!resource) {
          debugResourceLine('skip.resource_not_found', {
            resourceId,
            selected,
            knownResourceIds: Array.from(resourcesById.keys()),
          });
          return null;
        }

        debugResourceLine('pricing.base', {
          resourceId,
          resource
        });
        
        // Rule 4 — hours are for `per_hour` only: a slot setting or a free hour left on another price
        // type no longer turns it into an hourly line.
        const usesHourlyQuantity = resource.priceType === 'per_hour';

        debugResourceLine('pricing.type_flags', {
          resourceId,
          usesHourlyQuantity,
          freeMinutes: Number(resource.freeMinutes || 0),
        });

        const lockedLine = lockedResourcesById.get(resourceId);
        const hasExplicitOffered = selected?.offered !== undefined && selected?.offered !== null;
        const offered = hasExplicitOffered ? Boolean(selected?.offered) : Boolean(lockedLine?.offered);

        // The hours of a `per_hour` resource are the quantity, less the free minutes of the lodging; the others follow the
        // article's family.
        const priced = quoteArticle({
          article: articles.makeArticle(resource, { kind: 'resource' }),
          quantity,
          locked: lockedLine,
          offered,
          ...(usesHourlyQuantity
            ? { targetBilledUnits: applyPerHourFreeMinutes(roundMoney(quantity), resource.freeMinutes) }
            : {}),
        });

        debugResourceLine('pricing.units', {
          resourceId,
          persons,
          nights,
          quantity,
          billedUnits: priced.figures.billedUnits,
        });

        const resultLine = {
          resourceId,
          name: resource.name,
          nameEn: resource.nameEn || null,
          ...priced.figures,
          // Without a live plugin, a line keeps the sessions it carries: they still say when the hours
          // sold are used (specs/plugins-phase-3c-hourly-resources.md rule 18).
          ...(contributed ? contributed.extra : storedSessionsOf(selected)),
          ...priced.offeredFigures,
          ...pickContribsAndForce(selected, lockedLine),
        };

        debugResourceLine('pricing.output_line', {
          resourceId,
          resultLine,
        });

        return resultLine;
      })
      .filter(Boolean)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));

    debugResourceLine('pricing.output_lines', { resourceLines });

    const optionsTotal = roundMoney(finalOptionLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
    const resourcesTotal = roundMoney(resourceLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));

    return {
      ...ctx,
      consumedMap, finalOptionLines, grantedFreeUnitsFor, optionsTotal, resourceLines, resourcesTotal,
      soldGrantMap,
    };
  },
};

module.exports = step;
module.exports.withQuantityUnit = withQuantityUnit;
module.exports.withDisplayCount = withDisplayCount;
module.exports.normalizeCardOccurrences = normalizeCardOccurrences;
module.exports.timeToDecimalHour = timeToDecimalHour;
module.exports.computeAutoTimedOptionContext = computeAutoTimedOptionContext;
module.exports.getLateCheckoutNextNightReferencePrice = getLateCheckoutNextNightReferencePrice;
module.exports.storedSessionsOf = storedSessionsOf;
module.exports.DEBUG_RESOURCE_LINES = DEBUG_RESOURCE_LINES;
module.exports.debugResourceLine = debugResourceLine;
