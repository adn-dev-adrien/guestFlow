/**
 * The admin option catalogue, shaped for the screen (specs/options-resources-ux.md rules 2-7, 26).
 *
 * Pure — no DB access. The client renders what comes out: groups in the fiche's reading order, the
 * price each option really sells at, the traits that make an option special. Nothing here is a rule
 * about money: the effective price per property is the one the pricing engine already resolves
 * (override when present, else the base price).
 */

const { groupOptionsByCategory, normalizeCategory } = require('./optionGrouping');
const { archiveBlockedReason } = require('./optionArchiveGuard');
const {
  EURO_UNITS, euros, percent, range, propertiesPhrase,
} = require('./catalogueFormat');

const UNGROUPED_KEY = 'none';
const UNGROUPED_LABEL = 'Sans catégorie';
const DOT = ' · ';

const groupKey = (category) => (category ? `cat:${category}` : UNGROUPED_KEY);

function applicableProperties(option, properties) {
  const ids = new Set((option.propertyIds || []).map(Number));
  return properties.filter((p) => ids.has(Number(p.id)));
}

function effectivePrices(option, applicable) {
  const overrides = option.propertyPrices || {};
  const base = Number(option.price || 0);
  return applicable.map((p) => {
    const override = overrides[String(p.id)];
    return override === undefined || override === null ? base : Number(override);
  });
}

/** Rule 3. */
function priceSummary(option, applicable) {
  if (option.priceType === 'free') return { value: 'Gratuit', unit: '', note: '' };
  if (option.priceType === 'per_participant_progressive') {
    const tiers = (option.optionProgressiveTiers || []).map((t) => Number(t.unitPrice));
    return { value: tiers.length ? range(tiers, euros) : '—', unit: '/ participant, dégressif', note: '' };
  }
  if (applicable.length === 0) return { value: '—', unit: '', note: '' };
  const values = effectivePrices(option, applicable);
  const note = Math.min(...values) === Math.max(...values) ? '' : 'selon logement';
  if (option.priceType === 'percent_of_stay') return { value: range(values, percent), unit: 'du séjour', note };
  return { value: range(values, euros), unit: EURO_UNITS[option.priceType] || EURO_UNITS.per_stay, note };
}

function scopeTrait(applicable, properties) {
  if (applicable.length === 0) return { key: 'scope', label: 'Aucun logement', tone: 'warning' };
  if (applicable.length === properties.length) return null;
  const names = applicable.length <= 2
    ? applicable.map((p) => p.name).join(' et ')
    : `${applicable.length} logements`;
  return { key: 'scope', label: `${names} seulement`, tone: 'neutral' };
}

function defaultTraits(option, properties) {
  const defaults = option.propertyDefaults || {};
  const withOffered = (offered) => Object.entries(defaults)
    .filter(([, cfg]) => Boolean(cfg && cfg.offered) === offered)
    .map(([pid]) => Number(pid));
  const traits = [];
  const offered = propertiesPhrase(withOffered(true), properties);
  if (offered) traits.push({ key: 'offered', label: `Offert${DOT}${offered}`, tone: 'success' });
  const included = propertiesPhrase(withOffered(false), properties);
  if (included) traits.push({ key: 'included', label: `Inclus${DOT}${included}`, tone: 'info' });
  return traits;
}

/** The slots of the planning card an option puts on the planning, or []. */
function planningSlots(option) {
  if (option.autoOptionType === 'breakfast') return [option.breakfastTime || '09:00'];
  if (!Number(option.showsPlanningCard || 0)) return [];
  return Array.isArray(option.planningCardTimes) ? option.planningCardTimes : [];
}

function planningTrait(option) {
  const slots = planningSlots(option);
  if (slots.length === 0) return null;
  const label = slots.length <= 2 ? `Planning ${slots.join(DOT)}` : `Planning ${slots.length}× par jour`;
  return { key: 'planning', label, tone: 'info' };
}

/** Rule 5 — the traits, in order. Nothing is emitted for what is true of every ordinary option. */
function traitsOf(option, applicable, properties, { insuranceDynamic }) {
  const traits = [];
  const scope = scopeTrait(applicable, properties);
  if (scope) traits.push(scope);
  traits.push(...defaultTraits(option, properties));
  if (option.displayToClient !== undefined && option.displayToClient !== null && Number(option.displayToClient) === 0) {
    traits.push({ key: 'internal', label: 'Interne', tone: 'neutral' });
  }
  const planning = planningTrait(option);
  if (planning) traits.push(planning);
  if (Number(option.isCancellationInsurance || 0) === 1 && !insuranceDynamic && applicable.length > 0
    && !effectivePrices(option, applicable).some((v) => v > 0)) {
    traits.push({ key: 'insurance', label: `Non proposée${DOT}tarif à 0`, tone: 'warning' });
  }
  return traits;
}

function toItem(option, properties, filterProperty, flags) {
  const applicable = applicableProperties(option, properties);
  const priced = filterProperty ? applicable.filter((p) => Number(p.id) === Number(filterProperty)) : applicable;
  const blocked = archiveBlockedReason(option);
  return {
    id: option.id,
    title: option.title || '',
    description: option.description || '',
    category: normalizeCategory(option.category),
    price: priceSummary(option, priced),
    traits: traitsOf(option, applicable, properties, flags),
    archivable: !blocked,
    archiveBlockedReason: blocked,
  };
}

/**
 * @param {object[]} options   active catalogue options (the model's `list()`), early / late ones already out
 * @param {{id:number,name:string}[]} properties
 * @param {{ propertyId?: number, insuranceDynamic?: boolean }} [context]
 * @returns {{ total:number, chips:object[], groups:object[] }}
 */
function buildCatalogueView(options, properties, { propertyId = null, insuranceDynamic = false } = {}) {
  const flags = { insuranceDynamic };
  const { ungrouped, groups } = groupOptionsByCategory(options);
  const all = [
    ...(ungrouped.length ? [{ category: '', options: ungrouped }] : []),
    ...groups.map((g) => ({ category: g.category, options: g.options })),
  ];
  const chips = all.map((g) => ({
    key: groupKey(g.category), label: g.category || UNGROUPED_LABEL, count: g.options.length,
  }));
  const shown = all
    .map((g) => {
      const kept = propertyId
        ? g.options.filter((o) => (o.propertyIds || []).map(Number).includes(Number(propertyId)))
        : g.options;
      const items = kept.map((o) => toItem(o, properties, propertyId, flags));
      return {
        key: groupKey(g.category), label: g.category || UNGROUPED_LABEL, count: items.length, items,
      };
    })
    .filter((g) => g.items.length > 0);
  return { total: options.length, chips, groups: shown };
}

/** Rule 26 — the archived options, most recently archived first. */
function buildArchivedItems(rows) {
  return (rows || []).map((o) => ({
    id: o.id,
    title: o.title || '',
    category: normalizeCategory(o.category),
    archivedAt: o.archivedAt || null,
  }));
}

module.exports = { buildCatalogueView, buildArchivedItems, UNGROUPED_KEY, UNGROUPED_LABEL };
