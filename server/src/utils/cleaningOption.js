/**
 * Single source of truth for "is this reservation option the end-of-stay cleaning?".
 *
 * Cleaning is recognised two ways, matching what the J-1 arrival email already does
 * (specs/j1-arrival-reminder-email.md §4.1): by the `autoOptionType='cleaning'` tag (set by the
 * boot seed) OR — the robust fallback — by the operator-facing NAME containing « ménage ». Custom
 * / hand-created options often carry no tag, so the name match is what keeps detection reliable.
 *
 * Both the email context builder and the arrival/departure SAS consume this so the two flows can
 * never disagree on whether cleaning was booked.
 */

function normalizeOptionName(v) {
  return (v == null ? '' : String(v)).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function isCleaningOption(option) {
  if (!option) return false;
  const tag = option.autoOptionType == null ? '' : String(option.autoOptionType);
  return tag === 'cleaning' || normalizeOptionName(option.title).includes('menage');
}

module.exports = { isCleaningOption, normalizeOptionName };
