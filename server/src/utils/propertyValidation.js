/**
 * Property form validation (specs/settings-rationalization.md rule 23a).
 *
 * Returns `{ [field]: message }` — empty when the payload is acceptable. Only the fields present
 * in the payload are checked (a partial update never trips on a field it does not carry). The
 * bed / capacity coherence is checked only when one of those three fields CHANGES against
 * `existing`, so a property already stored in a questionable state stays savable for an unrelated
 * edit — the operator is told the day they touch the capacity.
 *
 * Multipart forms send every value as a string: numbers are parsed here.
 */

const { validateMonthDay } = require('./settingsValidation');
const { PROPERTY_LIMITS, parseBoundedNumber } = require('./inputLimits');
const { MODES } = require('./poolSeason');

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const asNumber = (value) => (value === '' || value === null || value === undefined ? NaN : Number(String(value).replace(',', '.')));
const isWhole = (n) => Number.isInteger(n) && n >= 0;
const isTrue = (value) => value === true || value === 1 || value === '1' || value === 'true';

// specs/guest-email-texts-made-simple.md rule 34, amended by specs/settings-input-guards.md rules 22-26.
function validatePoolSeason(body, errors) {
  const mode = has(body, 'poolSeasonMode') ? body.poolSeasonMode : null;
  if (mode !== null && !MODES.includes(mode)) {
    errors.poolSeasonMode = 'Choix invalide.';
    return;
  }
  if (mode === 'none' || mode === 'allYear') return;
  const hasStart = has(body, 'poolSeasonStart');
  const hasEnd = has(body, 'poolSeasonEnd');
  if (mode === null && !hasStart && !hasEnd) return;
  const start = String(body.poolSeasonStart || '').trim();
  const end = String(body.poolSeasonEnd || '').trim();
  if (hasStart) {
    const error = validateMonthDay(start);
    if (error) errors.poolSeasonStart = error;
  }
  if (hasEnd) {
    const error = validateMonthDay(end);
    if (error) errors.poolSeasonEnd = error;
  }
  if (errors.poolSeasonStart || errors.poolSeasonEnd) return;
  if (mode === null && !(hasStart && hasEnd)) return;
  if (Boolean(start) !== Boolean(end) || (mode === 'season' && !start)) {
    if (!start) errors.poolSeasonStart = 'Les deux dates.';
    if (!end) errors.poolSeasonEnd = 'Les deux dates.';
    return;
  }
  if (start && end && end < start) errors.poolSeasonEnd = 'La fermeture suit l\'ouverture.';
}

function validatePropertyInput(body = {}, existing = null) {
  const errors = {};
  const pick = (key) => (has(body, key) ? body[key] : existing && existing[key]);

  if (has(body, 'name') && !String(body.name || '').trim()) errors.name = 'Le nom est obligatoire.';

  const maxGuests = asNumber(pick('maxGuests'));
  if (has(body, 'maxGuests') && (!Number.isInteger(maxGuests) || maxGuests < 1)) errors.maxGuests = 'Au moins 1 voyageur.';
  if (has(body, 'maxBabies') && !isWhole(asNumber(body.maxBabies))) errors.maxBabies = 'Un nombre entier ≥ 0.';
  for (const key of ['doubleBeds', 'singleBeds']) {
    if (has(body, key) && !isWhole(asNumber(body[key]))) errors[key] = 'Un nombre entier ≥ 0.';
  }

  const capacityTouched = ['maxGuests', 'doubleBeds', 'singleBeds'].some((key) => has(body, key)
    && (!existing || asNumber(body[key]) !== asNumber(existing[key])));
  if (capacityTouched && !errors.maxGuests && !errors.doubleBeds && !errors.singleBeds) {
    const doubles = asNumber(pick('doubleBeds')) || 0;
    const singles = asNumber(pick('singleBeds')) || 0;
    const sleeps = 2 * doubles + singles;
    if (doubles + singles < 1) errors.doubleBeds = 'Il faut au moins un lit.';
    else if (Number.isInteger(maxGuests) && sleeps < maxGuests) {
      errors.maxGuests = `Seulement ${sleeps} couchage${sleeps > 1 ? 's' : ''} pour ${maxGuests} voyageurs.`;
    }
  }

  if (has(body, 'basePriceIncludedGuests')) {
    const included = asNumber(body.basePriceIncludedGuests);
    if (!isWhole(included)) errors.basePriceIncludedGuests = 'Un nombre entier ≥ 0.';
    else if (Number.isInteger(maxGuests) && included > maxGuests) {
      errors.basePriceIncludedGuests = `Pas plus que la capacité (${maxGuests}).`;
    }
  }
  if (has(body, 'extraGuestPrice')) {
    const price = asNumber(body.extraGuestPrice);
    if (!Number.isFinite(price) || price < 0) errors.extraGuestPrice = 'Un montant ≥ 0 €.';
  }

  if (isTrue(pick('depositEnabled')) && has(body, 'depositPercent')) {
    const pct = asNumber(body.depositPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      errors.depositPercent = 'Entre 1 et 99 %. Pour tout encaisser à la réservation, désactivez l\'acompte.';
    }
  }

  for (const key of ['touristTaxPercentage', 'touristTaxDepartmentPercentage']) {
    if (!has(body, key)) continue;
    const pct = asNumber(body[key]);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors[key] = 'Entre 0 et 100 %.';
  }
  for (const key of ['touristTaxPerDayPerPerson', 'touristTaxFixedAmount', 'defaultCautionAmount']) {
    if (!has(body, key)) continue;
    // An empty deposit keeps the stored one (specs/guest-email-texts-made-simple.md rule 28, 2026-10-18).
    if (key === 'defaultCautionAmount' && String(body[key] ?? '').trim() === '') continue;
    const amount = asNumber(body[key]);
    if (!Number.isFinite(amount) || amount < 0) errors[key] = 'Un montant ≥ 0 €.';
  }

  // specs/settings-input-guards.md rules 9-11 — a delay is refused, never replaced, and only when it
  // is the field that changes: a stored value outside the bounds stays savable for an unrelated edit.
  const depositOn = isTrue(pick('depositEnabled'));
  for (const key of ['depositDueDays', 'balanceDaysBefore', 'cancelAfterBalanceDueDays']) {
    if (!has(body, key) || String(body[key] ?? '').trim() === '') continue;
    if (key === 'depositDueDays' && !depositOn) continue;
    if (existing && asNumber(body[key]) === asNumber(existing[key])) continue;
    const parsed = parseBoundedNumber(body[key], PROPERTY_LIMITS[key]);
    if (parsed.error) errors[key] = parsed.error;
  }

  validatePoolSeason(body, errors);

  return errors;
}

module.exports = { validatePropertyInput };
