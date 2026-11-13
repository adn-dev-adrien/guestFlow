/**
 * STEP extras — ARTICLES (specs/pricing-components.md §3 rule 52).
 *
 * The option, custom option, engine-derived and resource lines of the stay, priced through the Articles head
 * with the free-units ledger.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { computeAutoTimedOptionContext, getLateCheckoutNextNightReferencePrice } = require('../timedOptions');
const articles = require('../articles');
const { createFreeUnitsLedger } = require('../allowances');
const { portionCap, clampPortions } = require('../../mealPortions');
const { buildBabyBedSupplementLine, isBabyBedOption } = require('../../babyBedSupplement');
const { discountLines } = require('../discounts');
const { extraLineKey } = require('../storedLines');
const { keyLines, lineRef } = require('../lineKeys');
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


function storedSessionsOf(selected) {
  return Array.isArray(selected?.sessions) && selected.sessions.length > 0 ? { sessions: selected.sessions } : {};
}

const step = {
  id: 'extras',
  requires: [
    'autoOptionsInComplement', 'billableBabyBeds', 'cancellationInsuranceBase',
    'cancellationInsurancePriceOverride', 'channel', 'checkInTime', 'checkOutTime', 'customOptions',
    'defaultOfferedOptionIds', 'endDate', 'families', 'isDirectBooking', 'lockedOptionLines', 'lockedOptionUnits',
    'lockedResourceLines', 'lockedResourceUnits', 'lockedTariff', 'nightlyBreakdown', 'nights', 'offeredOptionIds',
    'optionsById', 'persons', 'planningCardAsQuantity', 'resourcesById', 'rules', 'selectedOptions',
    'selectedResources', 'settings', 'startDate', 'typedDiscountPercent', 'discountTarget', 'discountFixedAmount', 'lineFacts', 'totalPrice', 'platform',
  ],
  provides: [
    'accommodationDiscountShareCents', 'consumedMap', 'extrasDiscountCents', 'finalOptionLines', 'grantedFreeUnitsFor', 'optionsTotal',
    'resourceLines', 'resourcesTotal', 'soldGrantMap',
  ],
  apply(ctx) {
    const {
      autoOptionsInComplement, billableBabyBeds, cancellationInsuranceBase,
      cancellationInsurancePriceOverride, channel, checkInTime, checkOutTime, customOptions,
      defaultOfferedOptionIds, endDate, families, isDirectBooking, lockedOptionLines, lockedOptionUnits,
      lockedResourceLines, lockedResourceUnits, lockedTariff, nightlyBreakdown, nights, offeredOptionIds,
      optionsById, persons, planningCardAsQuantity, resourcesById, rules, selectedOptions,
      selectedResources, settings, startDate, typedDiscountPercent, discountTarget, discountFixedAmount, lineFacts, totalPrice, platform,
    } = ctx;

    const optionUnitOverrides = lockedOptionUnits || {};
    const resourceUnitOverrides = lockedResourceUnits || {};
    const offeredOptionIdSet = new Set((Array.isArray(offeredOptionIds) ? offeredOptionIds : []).map((id) => Number(id)));
    // Rule 85: an article sold twice is two stored lines. A line that names itself (`lineId`) reads ITS snapshot; a request that names
    // none addresses the article's first line, which is the only one a stay held before the second sale existed.
    const lockedByArticle = (lines, field) => {
      const byId = new Map();
      for (const line of Array.isArray(lines) ? lines : []) {
        const id = Number(line[field]);
        const held = byId.get(id);
        if (!held || (line.lineId != null && (held.lineId == null || Number(line.lineId) < Number(held.lineId)))) byId.set(id, line);
      }
      return byId;
    };
    const lockedByLineId = (lines) => new Map((Array.isArray(lines) ? lines : []).filter((line) => line.lineId != null).map((line) => [Number(line.lineId), line]));
    const lockedOptionsById = lockedByArticle(lockedOptionLines, 'optionId');
    const lockedResourcesById = lockedByArticle(lockedResourceLines, 'resourceId');
    const lockedOptionsByLine = lockedByLineId(lockedOptionLines);
    const lockedResourcesByLine = lockedByLineId(lockedResourceLines);
    const lineIdentity = (table, selectedLines) => {
      const identity = new Map();
      for (const entry of keyLines(table, selectedLines)) {
        if (!entry.first && entry.row.lineId != null) identity.set(entry.row, { lineId: Number(entry.row.lineId), lineKey: lineRef(table, entry.row.lineId) });
      }
      return (selected) => identity.get(selected) || {};
    };
    const optionIdentity = lineIdentity('reservation_options', Array.isArray(selectedOptions) ? selectedOptions : []);
    const resourceIdentity = lineIdentity('reservation_resources', Array.isArray(selectedResources) ? selectedResources : []);
    // A line the caller appends (`newLine`) is a sale of its own: the writer gives it no stored line's columns, and its number is the one it was priced under.
    const appendedOf = (selected) => (selected.newLine && selected.lineId != null ? { lineId: Number(selected.lineId), newLine: true } : {});
    const isOfferedLine = (selected, optionId) => (
      selected.lineId != null && selected.offered !== undefined ? Boolean(Number(selected.offered)) : offeredOptionIdSet.has(optionId)
    );
    const freeUnitsLedger = createFreeUnitsLedger({
      lockedTariff, optionsById, lockedOptionsById, isDirectBooking,
    });
    const { soldGrantMap, consumedMap, grantedFreeUnitsFor } = freeUnitsLedger;

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
      persons, nights, maxGuests: settings.articles.maxGuests, isDirectBooking, cancellationInsuranceBase,
    };
    // One price through the Articles head: the families price, the head keeps the sold snapshot, the free units and « offert ».
    const quoteArticle = (request) => articles.quote({
      requests: [request], stayContext: articleStay, allowance: freeUnitsLedger, families,
    }).lines[0];
    // « Offert » on an amount fixed upstream (an engine-derived line, a custom line, a plugin-priced hour).
    const offeredOf = (ref, vatClass, totalPrice, offered) => quoteArticle({ ref, vatClass, priced: { totalPrice }, offered }).offeredFigures;

    const optionLines = (Array.isArray(selectedOptions) ? selectedOptions : [])
      .map((selected) => {
        const optionId = Number(selected.optionId);
        const option = optionsById.get(optionId);
        if (!option) return null;
        const priceType = option.priceType || 'per_stay';
        const identity = optionIdentity(selected);
        // A line that names itself reads its own snapshot only: a line sold after the first has no snapshot yet and is priced at the catalogue.
        const locked = selected.lineId != null ? lockedOptionsByLine.get(Number(selected.lineId)) : lockedOptionsById.get(optionId);
        const article = articles.makeArticle(option);
        const request = {
          article, locked, offered: isOfferedLine(selected, optionId), ...(selected.noFreeUnits ? { noFreeUnits: true } : {}),
          unitOverride: optionUnitOverrides[identity.lineKey] !== undefined ? optionUnitOverrides[identity.lineKey] : optionUnitOverrides[optionId],
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
            ...identity,
            ...appendedOf(selected),
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
          ...identity,
          ...appendedOf(selected),
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
            // A fixed auto price is the one the line was sold at (rule 74); a proportional one follows the time and the locked nights.
            option: String(option.autoPricingMode || 'fixed') === 'fixed' && lockedOptionsById.has(Number(option.id))
              ? { ...option, price: lockedUnitPriceOr(lockedOptionsById.get(Number(option.id)), Number(option.price || 0)) }
              : option,
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
        const resourceId = Number(selected.resourceId);
        const resource = resourcesById.get(resourceId);
        if (!resource) return null;
        const identity = resourceIdentity(selected);
        const lockedLine = selected.lineId != null ? lockedResourcesByLine.get(Number(selected.lineId)) : lockedResourcesById.get(resourceId);
        const hasExplicitOffered = selected?.offered !== undefined && selected?.offered !== null;
        const offered = hasExplicitOffered ? Boolean(selected?.offered) : Boolean(lockedLine?.offered);

        // One line through the Articles head, whatever its family. A `per_hour` line goes to the plugin-owned `hourly`
        // family (specs/plugins-phase-3c-hourly-resources.md rules 1-3): an UNSOLD line takes its amounts; a SOLD one goes
        // through the locked snapshot with its sold hours, never fewer, so placing them never re-prices it
        // (hourly-resource-quantity-and-sas-scheduling.md rules 30-31). The hours are billed after the free minutes of the lodging.
        // Rule 85: the lodging's free minutes of an hourly resource are the article's, taken once by its lines in order.
        const hourly = resource.priceType === 'per_hour';
        const freeLeft = hourly ? freeUnitsLedger.remainingFreeMinutesFor(resourceId, resource.freeMinutes) : resource.freeMinutes;
        const priced = quoteArticle({
          article: articles.makeArticle(hourly ? { ...resource, freeMinutes: freeLeft } : resource, { kind: 'resource' }),
          quantity: Math.max(0, Number(selected?.quantity || 0)),
          selected,
          locked: lockedLine,
          offered,
          startDate,
          endDate,
        });
        if (!priced) return null;
        if (hourly) freeUnitsLedger.takeFreeMinutes(resourceId, Math.min(freeLeft, Math.max(0, Math.round((Number(priced.figures.quantity) - Number(priced.figures.billedUnits)) * 60))));

        return {
          resourceId,
          ...identity,
          ...appendedOf(selected),
          name: resource.name,
          nameEn: resource.nameEn || null,
          ...priced.figures,
          // Without a live plugin, a line keeps the sessions it carries: they still say when the hours
          // sold are used (specs/plugins-phase-3c-hourly-resources.md rule 18).
          ...(priced.extra || storedSessionsOf(selected)),
          ...priced.offeredFigures,
          ...pickContribsAndForce(selected, lockedLine),
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));

    // Rules 16, 39, 40: a line's own discount, then the stay discount aimed at the extras (or at everything) shared out in cents.
    // A platform stay's gross pin supersedes the stay discount (rule 16): it keeps the target `nights`' own behaviour.
    const stayTarget = isDirectBooking ? discountTarget : 'nights';
    const discounted = discountLines({
      discount: { target: stayTarget, percent: typedDiscountPercent, amount: discountFixedAmount },
      accommodation: totalPrice,
      lines: [...finalOptionLines, ...resourceLines],
      facts: lineFacts,
      keyOf: extraLineKey,
    });
    const discountedOptionLines = discounted.lines.slice(0, finalOptionLines.length);
    const discountedResourceLines = discounted.lines.slice(finalOptionLines.length);

    const optionsTotal = roundMoney(discountedOptionLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
    const resourcesTotal = roundMoney(discountedResourceLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));

    return {
      ...ctx,
      accommodationDiscountShareCents: discounted.accommodationShareCents,
      consumedMap, extrasDiscountCents: discounted.extrasDiscountCents, finalOptionLines: discountedOptionLines, grantedFreeUnitsFor,
      optionsTotal, resourceLines: discountedResourceLines, resourcesTotal, soldGrantMap,
    };
  },
};

module.exports = step;
module.exports.withQuantityUnit = withQuantityUnit;
module.exports.withDisplayCount = withDisplayCount;
module.exports.normalizeCardOccurrences = normalizeCardOccurrences;
module.exports.storedSessionsOf = storedSessionsOf;
