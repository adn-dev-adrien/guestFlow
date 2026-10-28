/**
 * The resource editor's form model: the stored resource ⇄ the form, the payload and the inline checks
 * that mirror the server's (specs/options-resources-ux.md rule 21). Amounts are the text typed
 * (« 12,5 »); a comma is accepted.
 */
import { FIELD } from '../../constants/optionsResourcesTexts';
import { amountProblem, isBlank, parseAmount } from './optionForm';

const toText = (value) => (value === null || value === undefined ? '' : String(value).replace('.', ','));
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const emptyResource = {
  name: '', quantity: '1', price: '0', priceType: 'per_stay', propertyIds: [], description: '',
  propertyPricing: {},
  isComplex: false, slotDuration: 5, minimumUsageMinutes: 0, openTime: '08:00', closeTime: '22:00', openDays: ALL_DAYS, turnoverMinutes: 0,
  showsPlanningCard: false, hourlyEveningStart: '', hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0,
  heatUpMinutes: 0, heatRetentionMinutes: 0,
  emailBookedText: '', emailBookedTextEn: '',
};

const DEFAULT_HOURLY_SETTINGS = {
  isComplex: 0, slotDuration: 5, minimumUsageMinutes: 0, openTime: '08:00', closeTime: '22:00',
  openDays: JSON.stringify(ALL_DAYS), turnoverMinutes: 0, showsPlanningCard: 0,
  hourlyEveningStart: null, hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0,
  heatUpMinutes: 0, heatRetentionMinutes: 0,
};

function hourlySettings(form) {
  if (form.priceType !== 'per_hour') return DEFAULT_HOURLY_SETTINGS;
  const slotted = Boolean(form.isComplex);
  const card = Boolean(form.showsPlanningCard);
  return {
    isComplex: slotted ? 1 : 0,
    slotDuration: slotted ? (Number(form.slotDuration) || 5) : 5,
    minimumUsageMinutes: Number(form.minimumUsageMinutes) || 60,
    openTime: slotted ? (form.openTime || '08:00') : '08:00',
    closeTime: slotted ? (form.closeTime || '22:00') : '22:00',
    openDays: JSON.stringify(slotted ? (form.openDays || ALL_DAYS) : ALL_DAYS),
    turnoverMinutes: slotted ? (Number(form.turnoverMinutes) || 0) : 0,
    showsPlanningCard: card ? 1 : 0,
    hourlyEveningStart: card && form.hourlyEveningStart ? form.hourlyEveningStart : null,
    hourlyEveningRate: card ? (Number(form.hourlyEveningRate) || 0) : 0,
    hourlyExternalDayRate: card ? (Number(form.hourlyExternalDayRate) || 0) : 0,
    hourlyExternalEveningRate: card ? (Number(form.hourlyExternalEveningRate) || 0) : 0,
    heatUpMinutes: Math.max(0, Number(form.heatUpMinutes) || 0),
    heatRetentionMinutes: Math.max(0, Number(form.heatRetentionMinutes) || 0),
  };
}

const amountOf = (text) => (isBlank(text) ? 0 : parseAmount(text));

/** The form with a new scope: the price lines of properties that left it are dropped. */
export function withScope(form, ids) {
  const kept = ids.length > 0 ? new Set(ids.map(String)) : null;
  const propertyPricing = Object.fromEntries(
    Object.entries(form.propertyPricing || {}).filter(([pid]) => !kept || kept.has(pid)),
  );
  return { ...form, propertyIds: ids, propertyPricing };
}

const inScope = (form, pid) => form.propertyIds.length === 0 || form.propertyIds.map(String).includes(String(pid));

/**
 * The API payload. Hours, slots and the planning card are for a resource sold by the hour only
 * (specs/plugins-phase-3c-hourly-resources.md rule 4): cleared otherwise. A property line with no typed
 * price is sent with `price: null` — it inherits the base price on the server (rule 28); lines of
 * properties outside the scope are not sent.
 */
export function toResourcePayload(form) {
  const base = form.priceType === 'free' ? 0 : amountOf(form.price);
  return {
    name: form.name,
    quantity: Number(form.quantity) || 0,
    price: base,
    priceType: form.priceType || 'per_stay',
    propertyIds: form.propertyIds && form.propertyIds.length > 0 ? form.propertyIds : [],
    propertyPricing: Object.entries(form.propertyPricing || {}).reduce((acc, [propertyId, line]) => {
      if (!inScope(form, propertyId)) return acc;
      const typed = line && !isBlank(line.price);
      const freeMinutes = form.priceType === 'per_hour' ? Math.max(0, Math.round(Number(line && line.freeMinutes) || 0)) : 0;
      if (typed || freeMinutes > 0) acc[String(propertyId)] = { price: typed ? parseAmount(line.price) : null, freeMinutes };
      return acc;
    }, {}),
    note: form.description || '',
    emailBookedText: form.emailBookedText || '',
    emailBookedTextEn: form.emailBookedTextEn || '',
    ...hourlySettings(form),
  };
}

function openDaysOf(item) {
  try {
    if (item.openDays) return typeof item.openDays === 'string' ? JSON.parse(item.openDays) : item.openDays;
    const closed = JSON.parse(item.closedDays || '[]');
    return ALL_DAYS.filter((d) => !closed.includes(d));
  } catch {
    return ALL_DAYS;
  }
}

export function formFromResource(item) {
  const pricing = item.propertyPricing && typeof item.propertyPricing === 'object'
    ? item.propertyPricing
    : Object.entries(item.propertyPrices || {}).reduce((acc, [pid, price]) => {
      acc[String(pid)] = { price: Number(price || 0), freeMinutes: 0 };
      return acc;
    }, {});
  return {
    ...emptyResource,
    ...item,
    quantity: String(item.quantity ?? 0),
    price: toText(item.basePrice ?? item.price ?? 0),
    propertyIds: Array.isArray(item.propertyIds) ? item.propertyIds.map(Number) : [],
    propertyPricing: Object.fromEntries(Object.entries(pricing).map(([pid, line]) => [
      pid, { price: toText(line.price), freeMinutes: Number(line.freeMinutes || 0) },
    ])),
    description: item.note || item.description || '',
    isComplex: Boolean(item.isComplex),
    showsPlanningCard: Boolean(item.showsPlanningCard),
    hourlyEveningStart: item.hourlyEveningStart || '',
    hourlyEveningRate: Number(item.hourlyEveningRate || 0),
    hourlyExternalDayRate: Number(item.hourlyExternalDayRate || 0),
    hourlyExternalEveningRate: Number(item.hourlyExternalEveningRate || 0),
    slotDuration: item.slotDuration || 5,
    minimumUsageMinutes: Number(item.minimumUsageMinutes || 0),
    openTime: item.openTime || '08:00',
    closeTime: item.closeTime || '22:00',
    openDays: openDaysOf(item),
    turnoverMinutes: Number(item.turnoverMinutes || 0),
    heatUpMinutes: Number(item.heatUpMinutes || 0),
    heatRetentionMinutes: Number(item.heatRetentionMinutes || 0),
    emailBookedText: item.emailBookedText || '',
    emailBookedTextEn: item.emailBookedTextEn || '',
  };
}

/** Inline checks, keyed like the server's `details[].field`. */
export function validateResourceForm(form) {
  const errors = {};
  if (!String(form.name || '').trim()) errors.name = FIELD.titleRequired;
  const quantity = String(form.quantity ?? '').trim();
  if (!/^\d+$/.test(quantity)) errors.quantity = FIELD.wholeNumber;
  if (form.priceType !== 'free' && !isBlank(form.price)) {
    const message = amountProblem(form.price);
    if (message) errors.price = message;
  }
  Object.entries(form.propertyPricing || {}).forEach(([pid, line]) => {
    if (!line || isBlank(line.price) || !inScope(form, pid)) return;
    const message = amountProblem(line.price);
    if (message) errors[`propertyPricing.${pid}`] = message;
  });
  if (form.priceType === 'per_hour' && form.isComplex && form.openTime && form.closeTime && form.closeTime <= form.openTime) {
    errors.closeTime = FIELD.afterOpening;
  }
  return errors;
}
