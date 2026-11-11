/**
 * ARTICLES head — the only interface of « Articles » with the rest of GuestFlow (specs/pricing-components.md §3 rules
 * 10, 14, 41, 47, 56). Facade over the family registry: it resolves the instance of each request, looks up its family,
 * calls `validate` then `price`, then coordinates the sold snapshot (rule 13), the stay allowance (rule 41) and « Offert »
 * (rule 14). It holds no per-type formula: those are the families'. Nobody calls a family or an instance directly.
 *
 * Contract:
 *   quote({ requests[], stayContext, customerContext, allowance }) → { lines[], taggedAmounts[], allowanceUsed, refusals[] }
 *       `lines[i]` answers `requests[i]` (null when the request prices nothing or is refused). A line is
 *       `{ ref, family, article, figures, offeredFigures, components, taggedAmounts, allowanceUsed }`: `figures` are the
 *       line's priced keys up to « offert », `offeredFigures` = `{ originalTotalPrice, totalPrice, offered }`.
 *   commit(quoted, tx)       the lines to write (PR A: no fulfilment adapter yet, rule 49 is PR B); a refused quote throws
 *   release(line, reason)    what a removed line gives back to the allowance pool
 *   describe(line)           `{ label, detail }` every screen prints
 *   makeArticle, registerFamily   the factory of rule 47 and the family registry's `register`
 *
 * A request is `{ article, quantity, locked, offered, ... }`; the modes below are chosen by its family:
 *   perUnit (planning card)   occurrences placed, or portions to place (`portions(sold)`)
 *   perParticipantProgressive tiers + the sold snapshot
 *   every other family        units from the family, merged with the sold snapshot, then the free units
 *   `priced: { totalPrice }`  an amount fixed upstream (auto line, custom line, plugin-priced hour): « offert » only
 * Only customerContext 'hosted' exists in PR A.
 */
const { roundMoney } = require('../money');
const { normalizeBilledUnits, consumeAllowance, releaseAllowance } = require('../allowances');
const registry = require('./registry');
const { makeArticle, familyIdOfPriceType } = require('./makeArticle');
const {
  soldBilledUnits, mergeLineWithLockedSnapshot, reconstructLockedRealTotal, lockedUnitPriceOr, lockedLineGrossOfFreeUnits, applyOfferedToLine,
} = require('./lineSnapshot');
const { resolveServedPersons } = require('./units');
const kit = require('./familyKit');
const fixed = require('./families/fixed');
const perUnit = require('./families/perUnit');
const perNight = require('./families/perNight');
const perPerson = require('./families/perPerson');
const perPersonPerNight = require('./families/perPersonPerNight');
const percentOfStay = require('./families/percentOfStay');
const perParticipantProgressive = require('./families/perParticipantProgressive');

const CORE_FAMILIES = [fixed, perUnit, perNight, perPerson, perPersonPerNight, percentOfStay, perParticipantProgressive];
const CORE_BY_ID = Object.freeze(Object.fromEntries(CORE_FAMILIES.map((module_) => [module_.family.id, module_.family])));
// The core family a price type is served by (the mapping `makeArticle` uses); an unknown or plugin-owned type reads as `fixed`.
const familyOfPriceType = (priceType) => CORE_BY_ID[familyIdOfPriceType(priceType)] || CORE_BY_ID.fixed;
const getTypeMultiplier = (priceType, persons, nights) => {
  const family = familyOfPriceType(priceType);
  return family.multiplier ? family.multiplier(persons, nights) : 1;
};
const resolveNonCardUnits = ({ priceType, ...units }) => {
  const family = familyOfPriceType(priceType);
  return (family.resolveUnits || CORE_BY_ID.fixed.resolveUnits)(units);
};
const registerCoreFamilies = () => CORE_FAMILIES.forEach((module_) => registry.register(module_.family.id, module_.family));
registerCoreFamilies();

const refuse = (code, message, ref) => ({ code, message, ref });

function grantedFor(allowance, config) {
  return allowance && allowance.grantedFreeUnitsFor ? allowance.grantedFreeUnitsFor(config.id) : config.freeUnits;
}

function taggedOf(config, ref, totalPrice) {
  return [kit.taggedAmount({ totalPrice, vatClass: config.vatClass, ref })];
}

function pricedAmount(request) {
  const offeredFigures = applyOfferedToLine(request.priced.totalPrice, request.offered);
  const config = request.article ? request.article.config : { vatClass: request.vatClass || 'options' };
  const ref = request.article ? request.article.ref : request.ref;
  return {
    ref, family: request.article ? request.article.family : null, article: request.article || null, figures: {}, offeredFigures, components: [], allowanceUsed: 0, taggedAmounts: taggedOf(config, ref, offeredFigures.totalPrice),
  };
}

// Options with a planning card, resources and every simple price type: units from the family, merged with the sold
// snapshot (rule 13), then the free units (rule 41) and « offert » (rule 14).
function priceMerged(family, article, request, stay, allowance) {
  const { config } = article;
  const isResource = config.kind === 'resource';
  const { locked } = request;
  const isPercentOfStay = article.family === 'percentOfStay';
  const isStayWideYesNo = isPercentOfStay || config.isCancellationInsurance;
  const effectiveQuantity = isStayWideYesNo ? 1 : request.quantity;
  // Neat-derived guest price (rule 13): a stay-wide amount, so it bypasses the type multiplier.
  const neatOverride = config.isCancellationInsurance
    && request.stayWideAmount != null
    && request.stayWideAmount !== ''
    && Number.isFinite(Number(request.stayWideAmount))
    ? Number(request.stayWideAmount)
    : null;
  const priceRequest = {
    ...request, ref: article.ref, quantity: effectiveQuantity, untyped: isStayWideYesNo || isResource,
  };
  const refusals = family ? family.validate(config, priceRequest, stay) : [];
  if (refusals.length) return { refusals };
  const priced = family ? family.price(config, priceRequest, stay) : null;
  const unitBase = Number.isFinite(Number(request.unitOverride))
    ? Number(request.unitOverride)
    : (neatOverride !== null ? neatOverride : (priced ? priced.unitPrice : Number(config.price || 0)));
  const lockedInsuranceLine = config.isCancellationInsurance ? reconstructLockedRealTotal(locked, unitBase) : null;
  const targetBilledUnits = request.targetBilledUnits !== undefined
    ? request.targetBilledUnits
    : (lockedInsuranceLine
      ? normalizeBilledUnits(lockedInsuranceLine.billedUnits !== undefined ? lockedInsuranceLine.billedUnits : lockedInsuranceLine.quantity)
      : (neatOverride !== null ? 1 : priced.billedUnits));
  // Only what a snapshot says was deducted is added back: a row stored without one predates the
  // free units and holds a gross total (rule 56).
  const soldFreeUnits = allowance && allowance.consumedFreeUnitsFor ? allowance.consumedFreeUnitsFor(config.id) : 0;
  const merged = mergeLineWithLockedSnapshot({
    lockedLine: isResource
      ? reconstructLockedRealTotal(locked, unitBase)
      : (lockedInsuranceLine || reconstructLockedRealTotal(lockedLineGrossOfFreeUnits(locked, soldFreeUnits), unitBase)),
    targetBilledUnits,
    currentUnitPrice: unitBase,
  }, stay.debug);
  if (isResource) {
    const offeredFigures = applyOfferedToLine(merged.totalPrice, request.offered);
    return {
      ref: article.ref,
      family: article.family,
      article,
      figures: { quantity: request.quantity, unitPrice: merged.unitPrice, billedUnits: merged.billedUnits },
      offeredFigures,
      components: priced ? priced.components : [],
      allowanceUsed: 0,
      taggedAmounts: taggedOf(config, article.ref, offeredFigures.totalPrice),
    };
  }
  const free = consumeAllowance({
    granted: grantedFor(allowance, config), isDirect: stay.isDirectBooking, billedUnits: merged.billedUnits, unitPrice: merged.unitPrice,
  });
  const typed = priced ? priced.typed : null;
  const offeredFigures = applyOfferedToLine(free.realTotal, request.offered);
  return {
    ref: article.ref,
    family: article.family,
    article,
    figures: {
      quantity: effectiveQuantity,
      unitPrice: merged.unitPrice,
      billedUnits: merged.billedUnits,
      // What the guest does not pay for, and what it is worth — the summary strikes it through.
      freeUnits: free.used,
      freeUnitsAmount: free.amount,
      chargedUnits: free.chargedUnits,
      priceType: config.priceType,
      ...(typed ? {
        cardPersons: typed.cardPersons,
        cardNights: typed.cardNights,
        ...(typed.servedPersons !== undefined ? { servedPersons: typed.servedPersons } : {}),
        ...(typed.servedNights !== undefined ? { servedNights: typed.servedNights } : {}),
      } : {}),
    },
    offeredFigures,
    components: priced ? priced.components : [],
    allowanceUsed: free.used,
    taggedAmounts: taggedOf(config, article.ref, offeredFigures.totalPrice),
  };
}

// Option-driven planning cards (specs/option-planning-card.md §3.4): the moments placed REPLACE the nights/days path.
// Because the quantity is rebuilt from them the line cannot use the merge by units: its unit price is locked on its own.
function priceCard(family, article, request, stay, allowance) {
  const { config } = article;
  const { locked } = request;
  const unitBase = Number.isFinite(Number(request.unitOverride))
    ? Number(request.unitOverride)
    : lockedUnitPriceOr(locked, Number(config.price || 0));
  // The portions this line was last SOLD at — its own snapshot, not today's catalogue.
  const sold = soldBilledUnits(locked);
  const occurrences = Array.isArray(request.occurrences) ? request.occurrences : [];
  let quantity = request.quantity;
  let portions = null;
  if (occurrences.length === 0) {
    portions = request.portions(sold);
    quantity = portions.quantity;
    if (quantity <= 0) return { line: null };
  }
  const priceRequest = { ...request, ref: article.ref, quantity, occurrences };
  const refusals = family.validate(config, priceRequest, stay);
  if (refusals.length) return { refusals };
  const priced = family.price(config, priceRequest, stay);
  const { billedUnits } = priced;
  const free = consumeAllowance({
    granted: grantedFor(allowance, config), isDirect: stay.isDirectBooking, billedUnits, unitPrice: unitBase,
  });
  const common = {
    quantity: priced.quantity,
    unitPrice: unitBase,
    billedUnits,
    freeUnits: free.used,
    freeUnitsAmount: free.amount,
    chargedUnits: free.chargedUnits,
    priceType: config.priceType,
  };
  const figures = portions === null
    ? {
      ...common,
      cardOccurrences: occurrences,
      cardPersons: priced.cardPersons,
      // Planning less (or more) than what was sold is the operator's call, but it must not be
      // silent: the fiche shows « planifié N · vendu M » for as long as the two disagree.
      ...(sold != null && sold !== billedUnits ? { soldUnits: sold } : {}),
    }
    : {
      ...common,
      cardOccurrences: [], // unscheduled — « à planifier avec l'hôte »
      toBeScheduled: true,
      // What the visitor asked for when the cap lowered it (null when nothing was held back).
      clampedFrom: portions.clampedFrom,
    };
  const offeredFigures = applyOfferedToLine(free.realTotal, request.offered);
  return {
    ref: article.ref,
    family: article.family,
    article,
    figures,
    offeredFigures,
    components: priced.components,
    allowanceUsed: free.used,
    taggedAmounts: taggedOf(config, article.ref, offeredFigures.totalPrice),
  };
}

function priceProgressive(family, article, request, stay) {
  const { config } = article;
  const { locked } = request;
  const priceRequest = { ...request, ref: article.ref };
  const refusals = family.validate(config, priceRequest, stay);
  if (refusals.length) return { refusals };
  const priced = family.price(config, priceRequest, stay);
  const { computed } = priced;
  const lockedLine = reconstructLockedRealTotal(locked);
  const lockedUnits = normalizeBilledUnits(
    lockedLine?.billedUnits !== undefined
      ? lockedLine.billedUnits
      : lockedLine?.quantity,
  );
  const keepLockedSnapshot = Boolean(
    lockedLine
      && Number(lockedLine.totalPrice || 0) > 0
      && lockedUnits === computed.billedUnits,
  );
  const realTotal = keepLockedSnapshot ? roundMoney(lockedLine.totalPrice) : computed.totalPrice;
  const effectiveAverageUnit = computed.billedUnits > 0
    ? roundMoney(realTotal / computed.billedUnits)
    : 0;
  const offeredFigures = applyOfferedToLine(realTotal, request.offered);
  return {
    ref: article.ref,
    family: article.family,
    article,
    figures: {
      quantity: request.quantity,
      unitPrice: effectiveAverageUnit,
      billedUnits: computed.billedUnits,
      priceType: config.priceType,
      optionProgressiveTiers: priced.tiers,
      progressiveLastUnitPrice: computed.lastUnitPrice,
    },
    offeredFigures,
    components: priced.components,
    allowanceUsed: 0,
    taggedAmounts: taggedOf(config, article.ref, offeredFigures.totalPrice),
  };
}

function priceOne(request, stay, allowance) {
  if (request.priced) return pricedAmount(request);
  const { article } = request;
  // Units already resolved by the caller (the hourly core path): the family is not consulted.
  const family = request.targetBilledUnits !== undefined ? null : registry.get(article.family);
  if (!family && request.targetBilledUnits === undefined) {
    return { refusals: [refuse('FAMILY_UNAVAILABLE', `the family "${article.family}" has no live registration`, article.ref)] };
  }
  if (article.family === 'perUnit') return priceCard(family, article, request, stay, allowance);
  if (article.family === 'perParticipantProgressive') return priceProgressive(family, article, request, stay);
  return priceMerged(family, article, request, stay, allowance);
}

function quote({
  requests = [], stayContext = {}, customerContext = 'hosted', allowance = null,
} = {}) {
  const out = {
    lines: [], taggedAmounts: [], allowanceUsed: 0, refusals: [],
  };
  if (customerContext !== 'hosted') {
    out.refusals.push(refuse('CONTEXT_UNSUPPORTED', `customer context "${customerContext}" is not priced yet`, null));
    out.lines = requests.map(() => null);
    return out;
  }
  for (const request of requests) {
    const result = priceOne(request, stayContext, allowance);
    if (result.refusals) {
      out.refusals.push(...result.refusals.map((refusal) => ({ ref: request.article ? request.article.ref : request.ref, ...refusal })));
      out.lines.push(null);
    } else if (result.line === null) {
      out.lines.push(null);
    } else {
      out.lines.push(result);
      out.taggedAmounts.push(...result.taggedAmounts);
      out.allowanceUsed += result.allowanceUsed;
    }
  }
  return out;
}

function commit(quoted) {
  if (!quoted || (quoted.refusals && quoted.refusals.length)) {
    const error = new Error('QUOTE_REFUSED: a refused quote is not committed');
    error.code = 'QUOTE_REFUSED';
    throw error;
  }
  return quoted.lines.filter(Boolean);
}

function release(line) {
  const flat = { ...(line.figures || {}), ...(line.offeredFigures || {}) };
  return releaseAllowance(flat);
}

function describe(line) {
  const family = line.article && registry.get(line.article.family);
  const flat = { ...(line.figures || {}), ...(line.offeredFigures || {}) };
  return family ? family.describe(line.article.config, flat) : { label: '', detail: '' };
}

module.exports = {
  quote,
  commit,
  release,
  describe,
  makeArticle,
  registerFamily: registry.register,
  registerCoreFamilies,
  lockedUnitPriceOr,
  getTypeMultiplier,
  resolveServedPersons,
  resolveNonCardUnits,
  computePercentOfStayAmount: percentOfStay.computePercentOfStayAmount,
  calculateProgressiveParticipantOptionTotal: perParticipantProgressive.calculateProgressiveParticipantOptionTotal,
  normalizeOptionProgressiveTiers: perParticipantProgressive.normalizeOptionProgressiveTiers,
};
