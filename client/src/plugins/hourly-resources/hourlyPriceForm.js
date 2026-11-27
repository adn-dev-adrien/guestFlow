/**
 * The price grids of an hourly resource, as the resource form holds them (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 1, 2, 28): the stored
 * columns ⇄ the typed text, the payload and the inline checks that mirror the server's (`server/src/plugins/hourly-resources/resourceRates.js`). Owned by the plugin: the
 * core's resource form only asks its contributions (`resources.priceFields`). Amounts are the text typed (« 12,5 »); a comma is accepted.
 */
import { amountProblem, isBlank, parseAmount } from '../../pages/options/optionForm';

// [field, audience, « where » of the refusal sentence, band] — `price` (the guests' day first hour) stays the core column.
const GUEST = [
  ['price', 'hébergés', 'journée, 1re heure'],
  ['hourlyNextDayRate', 'hébergés', 'journée, heures suivantes'],
  ['hourlyEveningRate', 'hébergés', 'soirée, 1re heure', 'evening'],
  ['hourlyNextEveningRate', 'hébergés', 'soirée, heures suivantes', 'evening'],
];
const OUTSIDE = [
  ['hourlyExternalDayRate', 'extérieurs', 'semaine, journée, 1re heure'],
  ['hourlyExternalNextDayRate', 'extérieurs', 'semaine, journée, heures suivantes'],
  ['hourlyExternalEveningRate', 'extérieurs', 'semaine, soirée, 1re heure', 'evening'],
  ['hourlyExternalNextEveningRate', 'extérieurs', 'semaine, soirée, heures suivantes', 'evening'],
  ['hourlyExternalWeekendDayRate', 'extérieurs', 'week-end, journée, 1re heure'],
  ['hourlyExternalWeekendNextDayRate', 'extérieurs', 'week-end, journée, heures suivantes'],
  ['hourlyExternalWeekendEveningRate', 'extérieurs', 'week-end, soirée, 1re heure', 'evening'],
  ['hourlyExternalWeekendNextEveningRate', 'extérieurs', 'week-end, soirée, heures suivantes', 'evening'],
];

/** The form fields this contribution owns (the editor pins their errors to « Prix »). */
export const PRICE_FIELDS = [...GUEST, ...OUTSIDE].map(([field]) => field);
const OWNED = PRICE_FIELDS.filter((field) => field !== 'price');

const toText = (value) => (value === null || value === undefined ? '' : String(value).replace('.', ','));
const gridApplies = (form) => form.priceType === 'per_hour' && Boolean(form.showsPlanningCard);

const sentence = (audience, where) => `Le tarif ${audience} (${where}) doit être un montant positif.`;
const refused = (text) => Boolean(amountProblem(text)) || parseAmount(text) > 10000;

export const hourlyPriceForm = {
  fields: PRICE_FIELDS,
  defaults: Object.fromEntries(OWNED.map((field) => [field, ''])),
  fromItem: (item) => Object.fromEntries(OWNED.map((field) => [field, toText(item[field])])),
  payload(form) {
    if (!gridApplies(form)) return Object.fromEntries(OWNED.map((field) => [field, field === 'hourlyEveningRate' ? 0 : null]));
    return Object.fromEntries(OWNED.map((field) => [field, isBlank(form[field]) ? null : parseAmount(form[field])]));
  },
  validate(form) {
    if (!gridApplies(form)) return {};
    const evening = Boolean(form.hourlyEveningStart);
    const errors = {};
    const rows = form.sellableExternally ? [...GUEST, ...OUTSIDE] : GUEST;
    rows.forEach(([field, audience, where, band]) => {
      if (band === 'evening' && !evening) return;
      if (isBlank(form[field]) || refused(form[field])) errors[field] = sentence(audience, where);
    });
    return errors;
  },
};
