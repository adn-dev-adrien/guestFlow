/**
 * Prestations sold by the arrival SAS — pricing + offer shaping
 * (specs/sas-breakfast-and-catering-upsell.md).
 *
 * The check-in wizard can sell the breakfast and the « Restauration » catalogue on the spot. It sends
 * INTENT only — which moments, or how many units — and everything that costs money is derived here,
 * with exactly the arithmetic of the pricing engine (CLAUDE.md §6.0):
 *
 *   - card option (`showsPlanningCard`): `quantity = occurrences`, `billedUnits = occurrences ×
 *     persons` when the option is per-person ([pricing.js](pricing.js) `showsPlanningCard` branch);
 *   - anything else: the operator picks the BILLED units (« 3 repas »), exactly what the fiche's
 *     « Qté » field shows, and `quantity = units / multiplier` is the base the engine re-derives them
 *     from — so a later fiche save recomputes the same figure instead of drifting.
 *
 * Pure — no DB access. Option rows come in with their EFFECTIVE unit price for the property
 * (per-property override already applied).
 */

const { getTypeMultiplier } = require('./pricing');
const { buildCandidateGrid, normalizeOccurrences } = require('./cardOccurrences');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Same 4-decimal base quantity as the fiche's `toBaseQuantity` — the engine multiplies it back.
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// The engine's head count: babies never count (pricing.js).
function billablePersons(reservation) {
  return Math.max(0, (Number(reservation?.adults) || 0)
    + (Number(reservation?.teens) || 0)
    + (Number(reservation?.children) || 0));
}

function isCardOption(option) {
  return Number(option?.showsPlanningCard || 0) === 1;
}

function isPerPerson(option) {
  return String(option?.priceType || '').includes('per_person');
}

/**
 * Price one SAS sale. Returns null when nothing is actually sold (no moment, no unit, no price).
 *
 * @param {object} option  catalogue row (`priceType`, `showsPlanningCard`, card config…)
 * @param {object} ctx     { unitPrice, persons, nights, stay, occurrences, units }
 *        `stay` ({ startDate, endDate, checkInTime, checkOutTime }) restricts the accepted moments to
 *        the candidate grid — the wizard can only sell moments the guest can actually attend.
 * @returns {{optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardOccurrences}|null}
 */
function priceOptionSale(option, { unitPrice, persons, nights, stay, occurrences, units } = {}) {
  if (!option) return null;
  const price = round2(unitPrice != null ? unitPrice : option.price);
  if (!(price > 0)) return null;
  const priceType = option.priceType || 'per_stay';
  const head = Math.max(0, Number(persons) || 0);

  if (isCardOption(option)) {
    let wanted = normalizeOccurrences(occurrences);
    if (stay) {
      const allowed = new Set(buildCandidateGrid(option, stay).map((o) => `${o.date}#${o.time}`));
      wanted = wanted.filter((o) => allowed.has(`${o.date}#${o.time}`));
    }
    if (wanted.length === 0) return null;
    const billedUnits = round2(wanted.length * (isPerPerson(option) ? head : 1));
    if (!(billedUnits > 0)) return null;
    return {
      optionId: Number(option.id),
      quantity: wanted.length,
      unitPrice: price,
      billedUnits,
      priceType,
      totalPrice: round2(price * billedUnits),
      cardOccurrences: wanted,
    };
  }

  const billedUnits = round2(units);
  if (!(billedUnits > 0)) return null;
  const multiplier = getTypeMultiplier(priceType, head, Math.max(0, Number(nights) || 0)) || 1;
  return {
    optionId: Number(option.id),
    quantity: round4(billedUnits / multiplier),
    unitPrice: price,
    billedUnits,
    priceType,
    totalPrice: round2(price * billedUnits),
    cardOccurrences: null,
  };
}

/**
 * One sellable option as the SAS payload exposes it: the price, the candidate moments (card option)
 * or the default billed quantity (everything else), and what THIS SAS already sold — so re-opening a
 * committed check-in reopens on the operator's own selection (specs/reopen-completed-sas.md).
 */
function buildOptionOffer(option, { unitPrice, persons, nights, stay, sold } = {}) {
  const price = round2(unitPrice != null ? unitPrice : option.price);
  const priceType = option.priceType || 'per_stay';
  const head = Math.max(0, Number(persons) || 0);
  const card = isCardOption(option);
  const multiplier = getTypeMultiplier(priceType, head, Math.max(0, Number(nights) || 0)) || 1;
  return {
    optionId: Number(option.id),
    title: option.title || 'Prestation',
    description: String(option.description || ''),
    unitPrice: price,
    priceType,
    perPerson: isPerPerson(option),
    showsPlanningCard: card,
    persons: head,
    // What one « unit » of the fiche's Qté field means, and the value it pre-fills with.
    multiplier,
    defaultUnits: multiplier,
    occurrences: card ? buildCandidateGrid(option, stay || {}) : [],
    selectedOccurrences: card ? normalizeOccurrences(sold?.cardOccurrences) : [],
    selectedUnits: !card && sold ? round2(sold.billedUnits) : 0,
    sasOrigin: Boolean(sold),
  };
}

/**
 * Default breakfast composition for a party — mirrors the pre-fill the SAS breakfast page gets on a
 * never-committed check-in (specs/sas-breakfast-bread-and-push.md rule 3): one pastry per person,
 * half a baguette per person, drinks left to the operator. Needed here because a breakfast SOLD at
 * check-in is composed in the same run, once `arrivalSasDoneAt` no longer gates the defaults.
 */
function defaultBreakfastComposition(persons) {
  const head = Math.max(0, Number(persons) || 0);
  return { coffee: 0, tea: 0, chocolate: 0, milk: 0, pastries: head, cereals: 0, bread: head * 0.5 };
}

/**
 * The two sale steps of the arrival SAS, resolved for one reservation.
 *
 * @param {object} params
 *        reservation — with `adults/teens/children`, the stay window and its `options`;
 *        options     — the property catalogue, EFFECTIVE prices (optionsModel.listForProperty);
 *        cateringCategory — the category label the « Restauration » step sells.
 * @returns {{persons, nights, breakfast, catering}}
 */
function buildSasSaleOffers({ reservation, options = [], cateringCategory = 'Restauration' } = {}) {
  const persons = billablePersons(reservation);
  const stay = {
    startDate: reservation?.startDate,
    endDate: reservation?.endDate,
    checkInTime: reservation?.checkInTime || '15:00',
    checkOutTime: reservation?.checkOutTime || '10:00',
  };
  const nights = Array.isArray(reservation?.nights) ? reservation.nights.length : 0;

  // What the reservation already carries: an option sold on the fiche closes the step for good
  // (decision 2026-08-17), one the SAS itself sold stays open so « Non merci » can undo it.
  const onReservation = new Map();
  for (const line of (reservation?.options || [])) {
    if (line?.isCustom || line?.optionId == null) continue;
    onReservation.set(Number(line.optionId), {
      sasOrigin: Number(line.sasArrivalOrigin || 0) === 1,
      cardOccurrences: line.cardOccurrences,
      billedUnits: Number(line.billedUnits || 0),
    });
  }
  const soldByThisSas = (optionId) => {
    const row = onReservation.get(Number(optionId));
    return row && row.sasOrigin ? row : null;
  };
  const bookedOnFiche = (optionId) => {
    const row = onReservation.get(Number(optionId));
    return Boolean(row && !row.sasOrigin);
  };

  const sellable = (option) => Number(option?.autoEnabled || 0) !== 1
    && Number(option?.displayToClient == null ? 1 : option.displayToClient) !== 0
    && round2(option?.price) > 0;

  const breakfastOption = options.find((o) => o.autoOptionType === 'breakfast');
  let breakfast = { available: false, optionId: null, mornings: [], selected: [] };
  if (breakfastOption && sellable(breakfastOption) && !bookedOnFiche(breakfastOption.id)) {
    const offer = buildOptionOffer(breakfastOption, {
      persons, nights, stay, sold: soldByThisSas(breakfastOption.id),
    });
    // Only a card-configured breakfast can be sold here: the mornings ARE the product. A legacy
    // breakfast option without a planning card keeps being sold from the fiche.
    breakfast = {
      ...offer,
      available: offer.showsPlanningCard && offer.occurrences.length > 0 && persons > 0,
      mornings: offer.occurrences,
      selected: offer.selectedOccurrences,
      defaultComposition: defaultBreakfastComposition(persons),
    };
  }

  const cateringOptions = options
    .filter((o) => String(o.category || '').trim() === cateringCategory)
    .filter((o) => o.autoOptionType !== 'breakfast')
    .filter(sellable)
    .filter((o) => !bookedOnFiche(o.id))
    .map((o) => buildOptionOffer(o, { persons, nights, stay, sold: soldByThisSas(o.id) }))
    // A card option with no attendable moment left has nothing to sell.
    .filter((o) => !o.showsPlanningCard || o.occurrences.length > 0);

  return {
    persons,
    nights,
    breakfast,
    catering: { available: cateringOptions.length > 0, options: cateringOptions },
  };
}

module.exports = {
  billablePersons,
  isCardOption,
  isPerPerson,
  priceOptionSale,
  buildOptionOffer,
  buildSasSaleOffers,
  defaultBreakfastComposition,
};
