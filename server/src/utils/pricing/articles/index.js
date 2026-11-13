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
 *   read({ option, unitPrice, persons, nights, maxGuests, request, freeUnits })   the price of ONE candidate line for a stay, nothing sold (rule 10):
 *       `{ figures, offeredFigures }` or null. No free units are spent — a read quotes the line as the catalogue sells it — unless the caller
 *       names the stay's grant left for that article (`freeUnits`, rule 41): the line is then priced net of it, as the engine prices it.
 *   unitsPerQuantity(priceType, persons, nights)   how many billed units one quantity of this price type is on that stay
 *   makeArticle, registerFamily   the factory of rule 47 and the family registry's `register`
 *
 * A request is `{ article, quantity, locked, offered, ... }`; the modes below are chosen by its family:
 *   perUnit (planning card)   occurrences placed, or portions to place (`portions(sold)`)
 *   perParticipantProgressive tiers + the sold snapshot
 *   hourly (plugin-owned)     asked inside the safety of `pluginFamily.js`; an unsold line takes the family's amounts, else the
 *                             hours are billed after the free minutes. The family absent (plugin off): the same hours path
 *   every other family        units from the family, merged with the sold snapshot, then the free units
 *   `priced: { totalPrice }`  the head's documented entries, an amount with no per-type formula: « offert » only. They are the
 *                             operator-typed custom lines, the baby-bed line (formula in `utils/babyBedSupplement.js`) and the
 *                             early check-in / late check-out options (formula in `pricing/timedOptions.js`)
 * `families` (the families live at this instant, by id; default `liveFamilies()`) is an input of `quote`: the head reads that
 * map, never the registry, while it prices.
 * Only customerContext 'hosted' exists in PR A.
 */
const { roundMoney } = require('../money');
const {
  normalizeBilledUnits, consumeAllowance, releaseAllowance, applyPerHourFreeMinutes,
} = require('../allowances');
const registry = require('./registry');
const { makeArticle, familyIdOfPriceType } = require('./makeArticle');
const {
  soldBilledUnits, mergeLineWithLockedSnapshot, reconstructLockedRealTotal, lockedUnitPriceOr, lockedLineGrossOfFreeUnits, applyOfferedToLine,
} = require('./lineSnapshot');
const { resolveServedPersons } = require('./units');
const kit = require('./familyKit');
const { contributionOf } = require('./pluginFamily');
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

// The free units this line may still take: the article's grant minus what the lines priced before it took (rule 85).
function grantedFor(allowance, config) {
  if (allowance && allowance.remainingFreeUnitsFor) return allowance.remainingFreeUnitsFor(config.id);
  return allowance && allowance.grantedFreeUnitsFor ? allowance.grantedFreeUnitsFor(config.id) : config.freeUnits;
}

// The free units a stored line says it consumed (`allowanceUsed`, rule 26), or null when it stored none.
function storedFreeUnitsOf(locked) {
  if (!locked || locked.allowanceUsed == null) return null;
  try {
    const parsed = typeof locked.allowanceUsed === 'string' ? JSON.parse(locked.allowanceUsed) : locked.allowanceUsed;
    const units = Number(parsed && parsed.freeUnits);
    return Number.isFinite(units) && units >= 0 ? units : null;
  } catch { return null; }
}

// What a stored line is net of: the article's consumed units, shared out over its lines in order and never beyond a line's own units.
// A line that stored what it consumed (rule 41: a SAS sale, written outside the engine) is net of exactly that.
function soldFreeUnitsOf(allowance, config, locked) {
  if (!allowance || !allowance.consumedFreeUnitsFor) return 0;
  if (!allowance.consumedLeftFor) return allowance.consumedFreeUnitsFor(config.id);
  const units = locked ? normalizeBilledUnits(locked.billedUnits !== undefined ? locked.billedUnits : locked.quantity) : 0;
  const stored = storedFreeUnitsOf(locked);
  const share = stored != null ? Math.min(stored, units) : Math.min(allowance.consumedLeftFor(config.id), units);
  if (locked && share > 0 && Number(locked.totalPrice) > 0 && Number(locked.unitPrice) > 0) allowance.takeConsumed(config.id, share);
  return share;
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

// Rule 90.3 — a resource line sold with no hours that holds an evening component (the evening the placed sessions add once the session line
// is paid or not the arrival's) bills that component: it is kept, never dropped like an empty line, so no save loses its amount.
function eveningOnlyLine(article, request) {
  const { locked } = request;
  if (!locked || Number(locked.billedUnits || 0) > 0) return null;
  let components = [];
  try { components = typeof locked.components === 'string' ? JSON.parse(locked.components) : (locked.components || []); } catch { components = []; }
  const eveningCents = (Array.isArray(components) ? components : []).filter((c) => c && c.kind === 'evening').reduce((sum, c) => sum + (Number(c.cents) || 0), 0);
  if (!(eveningCents > 0)) return null;
  const offeredFigures = applyOfferedToLine(eveningCents / 100, request.offered);
  return {
    ref: article.ref,
    family: article.family,
    article,
    figures: { quantity: 0, unitPrice: Number(locked.unitPrice || 0), billedUnits: 0 },
    offeredFigures,
    components: [],
    allowanceUsed: 0,
    taggedAmounts: taggedOf(article.config, article.ref, offeredFigures.totalPrice),
  };
}

// Options with a planning card, resources and every simple price type: units from the family, merged with the sold
// snapshot (rule 13), then the free units (rule 41) and « offert » (rule 14).
function priceMerged(family, article, request, stay, allowance) {
  const { config } = article;
  const isResource = config.kind === 'resource';
  const { locked } = request;
  if (isResource && request.quantity <= 0) return eveningOnlyLine(article, request) || { line: null };
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
  const soldFreeUnits = soldFreeUnitsOf(allowance, config, locked);
  const merged = mergeLineWithLockedSnapshot({
    lockedLine: isResource
      ? reconstructLockedRealTotal(locked, unitBase)
      : (lockedInsuranceLine || reconstructLockedRealTotal(lockedLineGrossOfFreeUnits(locked, soldFreeUnits), unitBase)),
    targetBilledUnits,
    currentUnitPrice: unitBase,
  });
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
  // A sale that declares its units already in place (guest-app rule 107: an offered drink is in the fridge) takes no free unit, and a line that stored
  // that it consumed none (`allowanceUsed.freeUnits = 0`) keeps taking none whenever the stay is saved again (rule 26).
  const noneStored = locked && storedFreeUnitsOf(locked) === 0;
  const free = consumeAllowance({
    granted: request.noFreeUnits || noneStored ? 0 : grantedFor(allowance, config), isDirect: stay.isDirectBooking, billedUnits: merged.billedUnits, unitPrice: merged.unitPrice,
  });
  if (allowance && allowance.takeFreeUnits) allowance.takeFreeUnits(config.id, free.used);
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
  // The moments placed ARE the quantity: whatever `request.quantity` holds is not read.
  let quantity = occurrences.length > 0 ? occurrences.length : request.quantity;
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
  if (allowance && allowance.takeFreeUnits) allowance.takeFreeUnits(config.id, free.used);
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

// The hourly family belongs to a plugin: asked inside the safety of `pluginFamily` (a throwing or malformed answer prices like
// no plugin). An unsold line takes the family's amounts; otherwise the hours — the declared ones, or the family's when more
// were contributed on a sold line — are billed after the free minutes of the lodging. Without the family (plugin off) the
// declared hours are billed at the lodging's rate: the same core path.
function priceHourly(family, article, request, stay, allowance) {
  const { config } = article;
  const sold = Boolean(request.locked);
  const contributed = family ? contributionOf(family, config, { ...request, ref: article.ref, sold }, stay) : null;
  if (contributed && !sold && contributed.totalPrice !== undefined) {
    const offeredFigures = applyOfferedToLine(contributed.totalPrice, request.offered);
    return {
      ref: article.ref,
      family: article.family,
      article,
      figures: { quantity: contributed.quantity, unitPrice: contributed.unitPrice, billedUnits: contributed.billedUnits },
      offeredFigures,
      components: [],
      allowanceUsed: 0,
      taggedAmounts: taggedOf(config, article.ref, offeredFigures.totalPrice),
      extra: contributed.extra,
    };
  }
  const quantity = contributed
    ? roundMoney(sold ? Math.max(request.quantity, contributed.quantity) : contributed.quantity)
    : request.quantity;
  const result = priceMerged(null, article, {
    ...request, quantity, targetBilledUnits: applyPerHourFreeMinutes(roundMoney(quantity), config.freeMinutes),
  }, stay, allowance);
  return contributed && !result.refusals && result.line !== null ? { ...result, extra: contributed.extra } : result;
}

function priceOne(request, stay, allowance, families) {
  if (request.priced) return pricedAmount(request);
  const { article } = request;
  // Units already resolved by the caller (the hourly core path): the family is not consulted.
  if (article.family === 'hourly') return priceHourly(families.hourly || null, article, request, stay, allowance);
  const family = request.targetBilledUnits !== undefined ? null : (families[article.family] || null);
  if (!family && request.targetBilledUnits === undefined) {
    return { refusals: [refuse('FAMILY_UNAVAILABLE', `the family "${article.family}" has no live registration`, article.ref)] };
  }
  if (article.family === 'perUnit') return priceCard(family, article, request, stay, allowance);
  if (article.family === 'perParticipantProgressive') return priceProgressive(family, article, request, stay);
  return priceMerged(family, article, request, stay, allowance);
}

// The families that are live right now, by id: the input of a quote (the loader resolves it once).
function liveFamilies() {
  return Object.freeze(Object.fromEntries(registry.ids().map((id) => [id, registry.get(id)]).filter(([, family]) => family)));
}

function quote({
  requests = [], stayContext = {}, customerContext = 'hosted', allowance = null, families = liveFamilies(),
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
    const result = priceOne(request, stayContext, allowance, families);
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

const NO_FREE_UNITS = Object.freeze({ grantedFreeUnitsFor: () => 0, consumedFreeUnitsFor: () => 0 });

function read({
  option, unitPrice = null, persons, nights, maxGuests = 0, request = {}, freeUnits = 0,
} = {}) {
  if (!option) return null;
  const article = makeArticle(unitPrice == null ? option : { ...option, price: unitPrice });
  const units = Number(request.quantity);
  const line = quote({
    requests: [{ article, portions: () => ({ quantity: units, clampedFrom: null }), ...request }],
    stayContext: { persons, nights, maxGuests, isDirectBooking: true },
    allowance: Number(freeUnits) > 0 ? { grantedFreeUnitsFor: () => Number(freeUnits), consumedFreeUnitsFor: () => 0 } : NO_FREE_UNITS,
  }).lines[0];
  return line ? { figures: line.figures, offeredFigures: line.offeredFigures } : null;
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
  read,
  commit,
  release,
  describe,
  makeArticle,
  registerFamily: registry.register,
  liveFamilies,
  registerCoreFamilies,
  lockedUnitPriceOr,
  getTypeMultiplier,
  unitsPerQuantity: getTypeMultiplier,
  resolveServedPersons,
  resolveNonCardUnits,
  computePercentOfStayAmount: percentOfStay.computePercentOfStayAmount,
  calculateProgressiveParticipantOptionTotal: perParticipantProgressive.calculateProgressiveParticipantOptionTotal,
  normalizeOptionProgressiveTiers: perParticipantProgressive.normalizeOptionProgressiveTiers,
};
