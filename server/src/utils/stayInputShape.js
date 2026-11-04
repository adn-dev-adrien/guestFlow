/**
 * The shape of a stay's fields (specs/reservations-backend-mvc.md rule 16), judged on preview, create, update and
 * devis create / update, beside `lineInputRefusal` which holds the numbers (rule 15). Text is a string or absent, a
 * time is HH:MM or empty, an id a positive integer, a tick true / false / 1 / 0. `null` and '' read as not sent, and
 * what the row already stores passes when sent back unchanged. Internal writers (a plugin through `performUpdate`,
 * the public form through `devisModel`) do not come through here: they build their own values.
 */
const { isOptionalText, positiveId, isFlag, isClockTime } = require('./bodyText');

const MAX_RESERVATION_NUMBER = 64;

const TEXT_FIELDS = ['platform', 'notes', 'emailLanguage', 'pdfLanguage', 'depositDueDate', 'balanceDueDate', 'loadedUpdatedAt', 'reservationNumber'];
const TIME_FIELDS = ['checkInTime', 'checkOutTime', 'breakfastTime'];
const ID_FIELDS = ['propertyId', 'clientId', 'reservationId', 'devisId'];
const FLAG_FIELDS = [
  'depositDisabled', 'extraGuestSurchargeOffered', 'touristTaxInComplement', 'refreshTouristTax',
  'forceMinNights', 'forceMaxNights', 'forceCapacity', 'forceChangeover', 'forceTypedCounts',
  'refreshPricingToCurrent', 'forceCurrentPricing',
];
const ID_LISTS = ['offeredOptionIds', 'autoOptionsInComplement'];
const OPTION_LISTS = ['options', 'selectedOptions'];
const RESOURCE_LISTS = ['resources', 'selectedResources'];

const notSent = (value) => value === undefined || value === null || value === '';
const INVALID_FIELD = (field) => ({ error: 'Valeur invalide.', code: 'INVALID_FIELD', field });
const INVALID_TIME = (field) => ({ error: 'Heure invalide.', code: 'INVALID_TIME', field });

const lines = (list) => (Array.isArray(list) ? list.filter((line) => line && typeof line === 'object' && !Array.isArray(line)) : []);
const badId = (value) => !notSent(value) && positiveId(value) === null;
const badFlag = (value) => value !== undefined && value !== null && !isFlag(value);

function occurrencesRefusal(occurrences) {
  if (occurrences === undefined || occurrences === null) return null;
  const sound = Array.isArray(occurrences) && occurrences.every((one) => one && typeof one === 'object'
    && isOptionalText(one.date) && isOptionalText(one.time));
  return sound ? null : INVALID_FIELD('cardOccurrences');
}

function lineRefusal(body) {
  for (const list of OPTION_LISTS) {
    for (const line of lines(body[list])) {
      if (badId(line.optionId)) return INVALID_FIELD('optionId');
      if (badFlag(line.inComplement)) return INVALID_FIELD('inComplement');
      const refusal = occurrencesRefusal(line.cardOccurrences);
      if (refusal) return refusal;
    }
  }
  for (const line of lines(body.customOptions)) {
    if (!isOptionalText(line.description)) return INVALID_FIELD('description');
    if (badId(line.customOptionId)) return INVALID_FIELD('customOptionId');
    if (badFlag(line.inComplement)) return INVALID_FIELD('inComplement');
    if (!isOptionalText(line.customKey)) return INVALID_FIELD('customKey');
  }
  for (const list of RESOURCE_LISTS) {
    for (const line of lines(body[list])) {
      if (badId(line.resourceId)) return INVALID_FIELD('resourceId');
      if (badFlag(line.inComplement)) return INVALID_FIELD('inComplement');
    }
  }
  for (const list of ID_LISTS) {
    if (Array.isArray(body[list]) && body[list].some((id) => positiveId(id) === null)) return INVALID_FIELD(list);
  }
  return null;
}

/**
 * @param {object} body  the request
 * @param {object} [stored]  the row being edited: a field equal to its stored value is not judged
 * @returns {{error, code, field}|null}
 */
function stayShapeRefusal(body, stored = null) {
  const unchanged = (field) => stored && body[field] === stored[field];
  for (const field of TIME_FIELDS) {
    const value = body[field];
    if (!notSent(value) && !unchanged(field) && !isClockTime(value)) return INVALID_TIME(field);
  }
  for (const field of TEXT_FIELDS) {
    if (!unchanged(field) && !isOptionalText(body[field])) return INVALID_FIELD(field);
  }
  if (typeof body.reservationNumber === 'string' && !unchanged('reservationNumber') && body.reservationNumber.length > MAX_RESERVATION_NUMBER) {
    return INVALID_FIELD('reservationNumber');
  }
  for (const field of ID_FIELDS) {
    // 0 is how a new fiche says « no row yet ».
    if (body[field] !== 0 && badId(body[field])) return INVALID_FIELD(field);
  }
  for (const field of FLAG_FIELDS) {
    if (!unchanged(field) && badFlag(body[field])) return INVALID_FIELD(field);
  }
  return lineRefusal(body);
}

module.exports = { stayShapeRefusal };
