/**
 * The option editor's form model: the stored option ⇄ the form, the payload, and the inline checks that
 * mirror the server's (specs/options-resources-ux.md rule 16 — a UX hint, only the server rejects).
 *
 * Amounts live in the form as the text typed (« 12,5 »): a comma is accepted and sent as a number.
 */
import { FIELD } from '../../constants/optionsResourcesTexts';
import { normalizeProgressiveTiers } from './OptionSpecialSections';

const toText = (value) => (value === null || value === undefined ? '' : String(value).replace('.', ','));

/** Number of a typed amount, NaN when it is not one. Blank → NaN too: callers test blankness first. */
export function parseAmount(text) {
  const clean = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d*)?$/.test(clean) && !/^-?\.\d+$/.test(clean)) return NaN;
  return Number(clean);
}

export const isBlank = (text) => String(text ?? '').trim() === '';

/** The message an amount deserves (same texts as the server), or ''. */
export function amountProblem(text, { percent = false } = {}) {
  const value = parseAmount(text);
  if (Number.isNaN(value)) return FIELD.notANumber;
  if (value < 0) return FIELD.negative;
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return FIELD.decimals;
  if (percent && value > 100) return FIELD.percentMax;
  return '';
}

export function emptyOptionForm({ propertyIds = [], category = '' } = {}) {
  return {
    title: '',
    description: '',
    priceType: 'per_stay',
    price: '0',
    propertyIds,
    propertyPrices: {},
    propertyDefaults: {},
    optionProgressiveTiers: [],
    countsAsBedLinen: false,
    countsAsBathroomLinen: false,
    linenIncludesSingle: true,
    linenIncludesDouble: true,
    linenIncludesBaby: true,
    towelLargePerPerson: 1,
    towelMediumPerPerson: 0,
    towelSmallPerPerson: 1,
    countsAsBathMat: false,
    propertyBathMats: {},
    displayToClient: true,
    breakfastTime: '09:00',
    breakfastNotifyLeadMinutes: 30,
    showsPlanningCard: false,
    cardRepeat: 'once_per_day',
    planningCardTimes: ['09:00'],
    category,
    alwaysVisible: false,
    isCancellationInsurance: false,
    autoOptionType: null,
    autoEnabled: 0,
  };
}

/** A stored option, as the editor edits it. */
export function formFromOption(item) {
  return {
    ...emptyOptionForm(),
    ...item,
    price: toText(item.price ?? 0),
    description: item.description || '',
    category: item.category || '',
    propertyIds: Array.isArray(item.propertyIds) ? item.propertyIds.map(Number) : [],
    propertyPrices: Object.fromEntries(
      Object.entries(item.propertyPrices || {}).map(([pid, value]) => [pid, toText(value)]),
    ),
    propertyDefaults: Object.fromEntries(
      Object.entries(item.propertyDefaults || {}).map(([pid, v]) => [pid, { default: true, offered: Boolean(v && v.offered) }]),
    ),
    optionProgressiveTiers: normalizeProgressiveTiers(item.optionProgressiveTiers),
    countsAsBedLinen: Boolean(item.countsAsBedLinen),
    countsAsBathroomLinen: Boolean(item.countsAsBathroomLinen),
    linenIncludesSingle: item.linenIncludesSingle == null ? true : Boolean(item.linenIncludesSingle),
    linenIncludesDouble: item.linenIncludesDouble == null ? true : Boolean(item.linenIncludesDouble),
    linenIncludesBaby: item.linenIncludesBaby == null ? true : Boolean(item.linenIncludesBaby),
    towelLargePerPerson: item.towelLargePerPerson == null ? 1 : Number(item.towelLargePerPerson),
    towelMediumPerPerson: item.towelMediumPerPerson == null ? 0 : Number(item.towelMediumPerPerson),
    towelSmallPerPerson: item.towelSmallPerPerson == null ? 1 : Number(item.towelSmallPerPerson),
    countsAsBathMat: Boolean(item.countsAsBathMat),
    propertyBathMats: (item.propertyBathMats && typeof item.propertyBathMats === 'object') ? item.propertyBathMats : {},
    displayToClient: item.displayToClient == null ? true : Boolean(item.displayToClient),
    isCancellationInsurance: Boolean(item.isCancellationInsurance),
    breakfastTime: item.breakfastTime || '09:00',
    breakfastNotifyLeadMinutes: item.breakfastNotifyLeadMinutes == null ? 30 : Number(item.breakfastNotifyLeadMinutes),
    showsPlanningCard: Boolean(item.showsPlanningCard),
    cardRepeat: item.cardRepeat === 'multiple_per_day' || item.cardRepeat === 'daily' ? 'multiple_per_day' : 'once_per_day',
    planningCardTimes: Array.isArray(item.planningCardTimes) && item.planningCardTimes.length > 0 ? item.planningCardTimes : ['09:00'],
    alwaysVisible: Boolean(item.alwaysVisible),
  };
}

const NO_PROPERTY_PRICE = ['free', 'per_participant_progressive'];
export const hasPropertyPrice = (priceType) => !NO_PROPERTY_PRICE.includes(priceType);

/** The payload the server takes; it drops what concerns a property outside the scope (rule 15). */
export function optionPayload(form) {
  const overrides = {};
  if (hasPropertyPrice(form.priceType)) {
    Object.entries(form.propertyPrices || {}).forEach(([pid, text]) => {
      if (!isBlank(text)) overrides[pid] = parseAmount(text);
    });
  }
  const bathMats = {};
  Object.entries(form.propertyBathMats || {}).forEach(([pid, value]) => {
    if (value === '' || value === null || value === undefined) return;
    const n = Math.max(0, Math.floor(Number(value) || 0));
    if (n > 0) bathMats[pid] = n;
  });
  return {
    title: form.title,
    description: form.description || '',
    price: form.priceType === 'free' ? 0 : (isBlank(form.price) ? 0 : parseAmount(form.price)),
    priceType: form.priceType || 'per_stay',
    optionProgressiveTiers: normalizeProgressiveTiers(form.optionProgressiveTiers),
    propertyIds: form.propertyIds || [],
    propertyPrices: overrides,
    propertyDefaults: form.propertyDefaults || {},
    countsAsBedLinen: Boolean(form.countsAsBedLinen),
    countsAsBathroomLinen: Boolean(form.countsAsBathroomLinen),
    linenIncludesSingle: Boolean(form.linenIncludesSingle),
    linenIncludesDouble: Boolean(form.linenIncludesDouble),
    linenIncludesBaby: Boolean(form.linenIncludesBaby),
    towelLargePerPerson: Math.max(0, Math.floor(Number(form.towelLargePerPerson) || 0)),
    towelMediumPerPerson: Math.max(0, Math.floor(Number(form.towelMediumPerPerson) || 0)),
    towelSmallPerPerson: Math.max(0, Math.floor(Number(form.towelSmallPerPerson) || 0)),
    countsAsBathMat: Boolean(form.countsAsBathMat),
    propertyBathMats: bathMats,
    displayToClient: Boolean(form.displayToClient),
    breakfastTime: form.breakfastTime || '09:00',
    breakfastNotifyLeadMinutes: form.breakfastNotifyLeadMinutes,
    showsPlanningCard: Boolean(form.showsPlanningCard),
    cardRepeat: form.cardRepeat === 'multiple_per_day' ? 'multiple_per_day' : 'once_per_day',
    planningCardTimes: Array.isArray(form.planningCardTimes) ? form.planningCardTimes.filter(Boolean) : [],
    category: form.category || '',
    alwaysVisible: Boolean(form.alwaysVisible),
    isCancellationInsurance: Boolean(form.isCancellationInsurance),
  };
}

/** Inline checks, keyed like the server's `details[].field`. */
export function validateOptionForm(form) {
  const errors = {};
  if (!String(form.title || '').trim()) errors.title = FIELD.titleRequired;
  const percent = form.priceType === 'percent_of_stay';
  if (form.priceType !== 'free' && !isBlank(form.price)) {
    const message = amountProblem(form.price, { percent });
    if (message) errors.price = message;
  }
  if (hasPropertyPrice(form.priceType)) {
    (form.propertyIds || []).forEach((pid) => {
      const text = (form.propertyPrices || {})[pid];
      if (isBlank(text)) return;
      const message = amountProblem(text, { percent });
      if (message) errors[`propertyPrices.${pid}`] = message;
    });
  }
  return errors;
}

/** The section a field belongs to, for the chips of the panel. */
export function sectionOfField(field) {
  if (field === 'title') return 'general';
  return 'prices';
}
