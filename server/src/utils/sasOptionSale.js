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
 *   - per person (and per person per night): the operator picks how many people are served, stored in
 *     `cardPersons` with `quantity = 1` (specs/non-card-option-served-persons.md rules 12 and 28);
 *   - per night: the operator picks the nights, stored in `cardNights` with `quantity = 1` (rule 19);
 *   - anything else: the operator picks the units, and `quantity` is that number.
 *
 * Pure — no DB access. Option rows come in with their EFFECTIVE unit price for the property
 * (per-property override already applied).
 */

const articles = require('./pricing/articles');
const { buildCandidateGrid, normalizeOccurrences } = require('./cardOccurrences');

const { roundMoneyOrZero: round2 } = require('./pricing/money');

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

// A tab still running the previous bundle sends the billed units of a per-person line
// (specs/non-card-option-served-persons.md rule 28). They become people served, whole: the party is
// not involved, only the nights a per-person-per-night unit counts.
function servedFromIntent(priceType, { servedPersons, units, nights }) {
  if (servedPersons != null || !(Number(units) > 0)) return servedPersons;
  const unitsPerPerson = priceType === 'per_person_per_night' && nights > 0 ? nights : 1;
  return Math.max(1, Math.floor(Number(units) / unitsPerPerson));
}

// The price of one line is the Articles head's (rule 10): this module resolves the operator's intent into a request, the head prices it.
const readLine = (option, unitPrice, stay, request) => articles.read({ option, unitPrice, ...stay, request });

/**
 * Price one SAS sale. Returns null when nothing is actually sold (no moment, no unit, no price).
 *
 * @param {object} option  catalogue row (`priceType`, `showsPlanningCard`, card config…)
 * @param {object} ctx     { unitPrice, persons, nights, stay, occurrences, units, servedPersons, maxPersons }
 *        `stay` ({ startDate, endDate, checkInTime, checkOutTime }) restricts the accepted moments to
 *        the candidate grid — the wizard can only sell moments the guest can actually attend.
 *        `servedPersons` is how many covers each moment serves (specs/card-option-served-persons.md
 *        §3.3): absent → the whole party, and it is clamped to `maxPersons` (the property capacity).
 * @returns {{optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardOccurrences,
 *            cardPersons}|null}
 */
function priceOptionSale(option, {
  unitPrice, persons, nights, stay, occurrences, units, servedPersons, maxPersons,
} = {}) {
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
    const perPerson = isPerPerson(option);
    const covers = articles.resolveServedPersons({ cardPersons: servedPersons, persons: head, maxGuests: maxPersons });
    const priced = readLine(option, price, { persons: head, nights, maxGuests: maxPersons }, {
      quantity: wanted.length, occurrences: wanted, cardPersons: servedPersons,
    });
    if (!priced || !(priced.figures.billedUnits > 0)) return null;
    return {
      optionId: Number(option.id),
      quantity: priced.figures.quantity,
      unitPrice: price,
      billedUnits: priced.figures.billedUnits,
      priceType,
      totalPrice: priced.offeredFigures.totalPrice,
      cardOccurrences: wanted,
      cardPersons: perPerson ? covers.stored : null,
      servedPersons: perPerson ? covers.served : null,
    };
  }

  const stayNights = Math.max(0, Number(nights) || 0);
  const perNight = priceType === 'per_night';
  if (isPerPerson(option) || perNight) {
    if (perNight && !(Number(units) > 0 && Number.isFinite(Number(units)))) return null;
    if (!perNight && !(head > 0)) return null;
    // Rule 28: units sent that are not a positive number sell nothing, they never fall back to the party.
    if (!perNight && servedPersons == null && units != null && !(Number(units) > 0)) return null;
    const priced = readLine(option, price, { persons: head, nights: stayNights, maxGuests: maxPersons }, {
      quantity: 1,
      cardPersons: perNight ? null : servedFromIntent(priceType, { servedPersons, units, nights: stayNights }),
      cardNights: perNight ? units : null,
    });
    if (!priced || !(priced.figures.billedUnits > 0)) return null;
    const typed = priced.figures;
    return {
      optionId: Number(option.id),
      quantity: 1,
      unitPrice: price,
      billedUnits: typed.billedUnits,
      priceType,
      totalPrice: priced.offeredFigures.totalPrice,
      cardOccurrences: null,
      cardPersons: typed.cardPersons,
      cardNights: typed.cardNights,
      servedPersons: typed.servedPersons != null ? typed.servedPersons : null,
    };
  }

  const billedUnits = round2(units);
  if (!(billedUnits > 0 && Number.isFinite(billedUnits))) return null;
  const priced = readLine({ ...option, priceType: 'per_stay' }, price, { persons: head, nights: stayNights, maxGuests: maxPersons }, { quantity: billedUnits });
  if (!priced) return null;
  return {
    optionId: Number(option.id),
    quantity: billedUnits,
    unitPrice: price,
    billedUnits,
    priceType,
    totalPrice: priced.offeredFigures.totalPrice,
    cardOccurrences: null,
    cardPersons: null,
    servedPersons: null,
  };
}

/**
 * The catalogue upsell the check-in offers by intent alone (« Ménage », « Linge de toilette »): one quantity of the option for the
 * whole party and stay, priced by the head. A price type that counts people or nights is priced as such, any other is one unit.
 * Returns `{ billedUnits, totalPrice }`, zeros when nothing is sold.
 */
function priceCatalogueUpsell(option, { unitPrice, persons, nights, maxPersons } = {}) {
  const none = { billedUnits: 0, totalPrice: 0 };
  if (!option) return none;
  const priceType = option.priceType || 'per_stay';
  const counted = ['per_person', 'per_night', 'per_person_per_night'].includes(priceType);
  const priced = readLine(counted ? option : { ...option, priceType: 'per_stay' }, round2(unitPrice), {
    persons: Math.max(0, Number(persons) || 0), nights: Math.max(0, Number(nights) || 0), maxGuests: maxPersons,
  }, { quantity: 1 });
  return priced ? { billedUnits: priced.figures.billedUnits, totalPrice: priced.offeredFigures.totalPrice } : none;
}

/**
 * One sellable option as the SAS payload exposes it: the price, the candidate moments (card option)
 * or the default billed quantity (everything else), and what THIS SAS already sold — so re-opening a
 * committed check-in reopens on the operator's own selection (specs/reopen-completed-sas.md).
 */
function buildOptionOffer(option, { unitPrice, persons, nights, stay, sold, maxPersons } = {}) {
  const price = round2(unitPrice != null ? unitPrice : option.price);
  const priceType = option.priceType || 'per_stay';
  const head = Math.max(0, Number(persons) || 0);
  const card = isCardOption(option);
  const stayNights = Math.max(0, Number(nights) || 0);
  const multiplier = articles.unitsPerQuantity(priceType, head, stayNights) || 1;
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
    // How many covers a moment serves (specs/card-option-served-persons.md §3.3 rule 11): the party
    // by default, this SAS's own decision when a committed check-in is re-opened, capped by the
    // property's capacity so a friend joining for dinner can still be served.
    defaultPersons: head,
    maxPersons: Math.max(head, Number(maxPersons) > 0 ? Math.floor(Number(maxPersons)) : 0),
    selectedPersons: (sold && Number(sold.cardPersons) > 0) ? Math.floor(Number(sold.cardPersons)) : head,
    occurrences: card ? buildCandidateGrid(option, stay || {}) : [],
    selectedOccurrences: card ? normalizeOccurrences(sold?.cardOccurrences) : [],
    selectedUnits: !card && sold ? round2(sold.billedUnits) : 0,
    sasOrigin: Boolean(sold),
  };
}

/**
 * Default breakfast composition PER PERSON SERVED — the rule behind the pre-fill the SAS breakfast
 * page gets on a never-committed check-in (specs/sas-breakfast-bread-and-push.md rule 3): one pastry
 * per person, half a baguette per person, drinks left to the operator. Needed here because a
 * breakfast SOLD at check-in is composed in the same run, once `arrivalSasDoneAt` no longer gates the
 * defaults — and the wizard multiplies it by the number of breakfasts actually sold, which is not
 * always the whole party (specs/card-option-served-persons.md §3.4 rule 17).
 */
const BREAKFAST_COMPOSITION_PER_PERSON = {
  coffee: 0, tea: 0, chocolate: 0, milk: 0, pastries: 1, cereals: 0, bread: 0.5,
};

function defaultBreakfastComposition(persons) {
  const head = Math.max(0, Number(persons) || 0);
  return Object.fromEntries(
    Object.entries(BREAKFAST_COMPOSITION_PER_PERSON).map(([key, perPerson]) => [key, round2(perPerson * head)]),
  );
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
function buildSasSaleOffers({
  reservation, options = [], cateringCategory = 'Restauration', maxPersons,
} = {}) {
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
      // What this SAS decided about the covers, so a re-open reopens on it rather than on the party
      // (specs/card-option-served-persons.md §3.3 rule 11).
      cardPersons: line.cardPersons != null ? Number(line.cardPersons) : null,
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
    // The cancellation insurance is never sold at check-in (specs/cancellation-insurance.md §3.2
    // rule 17): the stay has started, there is nothing left to cancel. Guarded here rather than
    // left to the category filter, so miscategorising it can't put it on the check-in screen.
    && Number(option?.isCancellationInsurance || 0) !== 1
    && round2(option?.price) > 0;

  const breakfastOption = options.find((o) => o.autoOptionType === 'breakfast');
  let breakfast = { available: false, optionId: null, mornings: [], selected: [], perMorning: null };
  if (breakfastOption && sellable(breakfastOption) && !bookedOnFiche(breakfastOption.id)) {
    const offer = buildOptionOffer(breakfastOption, {
      persons, nights, stay, maxPersons, sold: soldByThisSas(breakfastOption.id),
    });
    // Only a card-configured breakfast can be sold here: the mornings ARE the product. A legacy
    // breakfast option without a planning card keeps being sold from the fiche.
    const available = offer.showsPlanningCard && offer.occurrences.length > 0 && persons > 0;
    // The price of ONE morning, by the very function the sale is billed with, so the offer page
    // announces what the commit will bill (specs/breakfast-offer-price-server-side.md rules 1-3).
    const oneMorning = available ? priceOptionSale(breakfastOption, {
      unitPrice: offer.unitPrice,
      persons,
      nights,
      stay,
      occurrences: [offer.occurrences[0]],
      servedPersons: offer.selectedPersons,
      maxPersons,
    }) : null;
    breakfast = {
      ...offer,
      available,
      perMorning: oneMorning ? { persons: oneMorning.servedPersons, amount: oneMorning.totalPrice } : null,
      mornings: offer.occurrences,
      selected: offer.selectedOccurrences,
      compositionPerPerson: { ...BREAKFAST_COMPOSITION_PER_PERSON },
    };
  }

  const cateringOptions = options
    .filter((o) => String(o.category || '').trim() === cateringCategory)
    .filter((o) => o.autoOptionType !== 'breakfast')
    .filter(sellable)
    .filter((o) => !bookedOnFiche(o.id))
    .map((o) => buildOptionOffer(o, { persons, nights, stay, maxPersons, sold: soldByThisSas(o.id) }))
    // A card option with no attendable moment left has nothing to sell.
    .filter((o) => !o.showsPlanningCard || o.occurrences.length > 0);

  return {
    persons,
    nights,
    breakfast,
    catering: { available: cateringOptions.length > 0, options: cateringOptions },
  };
}

/**
 * The options a sale may carry: what the offers above sell, the same way the read shows them
 * (specs/sas-breakfast-and-catering-upsell.md rule 15).
 * @param {{breakfast: object, catering: {options: object[]}}} offers  from `buildSasSaleOffers`
 * @returns {Set<number>}
 */
function offeredSaleOptionIds({ breakfast, catering } = {}) {
  const ids = (catering?.options || []).map((offer) => Number(offer.optionId));
  if (breakfast?.available) ids.push(Number(breakfast.optionId));
  return new Set(ids);
}

module.exports = {
  billablePersons,
  BREAKFAST_COMPOSITION_PER_PERSON,
  isCardOption,
  isPerPerson,
  priceOptionSale,
  priceCatalogueUpsell,
  buildOptionOffer,
  buildSasSaleOffers,
  offeredSaleOptionIds,
  defaultBreakfastComposition,
};
