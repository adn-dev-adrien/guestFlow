/**
 * Article instances (specs/pricing-components.md §3 rule 47) — factory: an article is configuration, not code.
 *
 * Contract: `makeArticle(catalogueRow, { kind })` → a frozen `{ ref, family, config }`. `kind` is 'option' (default) or
 * 'resource'. Today's `priceType` values map one to one to families:
 *   per_stay, free → fixed · per_person → perPerson · per_night → perNight · per_person_per_night → perPersonPerNight
 *   percent_of_stay → percentOfStay · per_participant_progressive → perParticipantProgressive · per_hour → hourly
 * An option with a planning card (not an insurance, not a percentage) is counted in moments: family perUnit.
 * An unknown price type reads as `fixed`, like the engine's type multiplier always did, and so does a price type of the OTHER kind
 * (a resource stored `percent_of_stay`, an option stored `per_hour`: the catalogue forms refuse them, rule 47 reading of L6).
 *
 * Pure: no DB, no clock, no settings.
 */
const FAMILY_OF_PRICE_TYPE = Object.freeze({
  per_stay: 'fixed',
  free: 'fixed',
  per_person: 'perPerson',
  per_night: 'perNight',
  per_person_per_night: 'perPersonPerNight',
  percent_of_stay: 'percentOfStay',
  per_participant_progressive: 'perParticipantProgressive',
  per_hour: 'hourly',
});

const PRICE_TYPES_OF_KIND = Object.freeze({
  option: ['per_stay', 'free', 'per_person', 'per_night', 'per_person_per_night', 'percent_of_stay', 'per_participant_progressive'],
  resource: ['per_stay', 'free', 'per_person', 'per_night', 'per_person_per_night', 'per_hour'],
});

const VAT_CLASS = Object.freeze({ option: 'options', resource: 'resources' });

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

// The family namesake of a price type; an unknown price type reads as `fixed`.
const familyIdOfPriceType = (priceType) => FAMILY_OF_PRICE_TYPE[priceType] || 'fixed';

function familyOf(row, kind) {
  const priceType = row.priceType || 'per_stay';
  const isInsurance = Number(row.isCancellationInsurance || 0) === 1;
  if (kind === 'option' && row.showsPlanningCard && priceType !== 'percent_of_stay' && !isInsurance) return 'perUnit';
  return PRICE_TYPES_OF_KIND[kind].includes(priceType) ? familyIdOfPriceType(priceType) : 'fixed';
}

function makeArticle(row, { kind = 'option' } = {}) {
  const priceType = row.priceType || 'per_stay';
  const config = {
    id: Number(row.id),
    kind,
    label: String((kind === 'resource' ? row.name : row.title) || ''),
    labelEn: (kind === 'resource' ? row.nameEn : row.titleEn) || null,
    price: Number(row.price || 0),
    priceType,
    vatClass: VAT_CLASS[kind],
    freeUnits: Math.max(0, Number(row.freeUnits || 0)),
    freeMinutes: Math.max(0, Number(row.freeMinutes || 0)),
    progressiveTiers: row.optionProgressiveTiers == null ? [] : JSON.parse(JSON.stringify(row.optionProgressiveTiers)),
    isCancellationInsurance: Number(row.isCancellationInsurance || 0) === 1,
    showsPlanningCard: Boolean(row.showsPlanningCard),
  };
  if (kind === 'resource') config.resource = JSON.parse(JSON.stringify(row));
  return deepFreeze({ ref: `${kind}:${config.id}`, family: familyOf(row, kind), config });
}

module.exports = { makeArticle, familyIdOfPriceType, FAMILY_OF_PRICE_TYPE };
