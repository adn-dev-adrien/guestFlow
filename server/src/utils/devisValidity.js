/**
 * Devis validity — the two pure decisions that hang off `validUntil`.
 *
 * A devis is a price promise with an expiry date, and that date is what says whether its prices may
 * still move (specs/devis-extras-parity-and-price-lock.md §3 rules 13-14): while the quote is valid
 * the prices it was issued at are frozen exactly like a saved reservation's, and once it has expired
 * every price is recomputed at the current tariffs on the next read/save.
 *
 * Kept out of `devisModel` so both the model and the pricing controller can consult the same rule
 * without pulling a DB handle along.
 */

const { addDaysToIsoDate } = require('./devisHelpers');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `validUntil` = MIN(createdAt + quoteValidityDays, startDate − 2 days), per §3.2 rule 6 of
 * specs/devis-pdf-and-tourist-tax-fixes.md. Both inputs are ISO `YYYY-MM-DD`; output the same.
 * Falls back to the un-capped value when `startDate` isn't a valid ISO date.
 */
function computeValidUntil({ createdAtIsoDate, startDateIso, quoteValidityDays }) {
  // Honour `quoteValidityDays = 0` as a deliberate "same day" choice (spec §3 edge case).
  // Only fall back to 30 when the input is non-finite (undefined / null / NaN).
  const rawDays = Number(quoteValidityDays);
  const days = Number.isFinite(rawDays) ? Math.max(0, rawDays) : 30;
  const raw = addDaysToIsoDate(createdAtIsoDate, days);
  if (!raw) return null;
  if (startDateIso && ISO_DATE.test(startDateIso)) {
    const cap = addDaysToIsoDate(startDateIso, -2);
    if (cap && raw > cap) return cap;
  }
  return raw;
}

/**
 * Has this devis run out? `validUntil` is inclusive — a devis valid until the 12th is still valid
 * ON the 12th. A missing or malformed value counts as expired: a legacy row nobody dated cannot be
 * used to freeze a price, so it is re-quoted at the current tariffs (§3 rule 14, and the update path
 * then stamps it with a fresh window).
 */
function isDevisExpired(validUntil, todayIso) {
  if (!validUntil || !ISO_DATE.test(String(validUntil).slice(0, 10))) return true;
  return String(validUntil).slice(0, 10) < String(todayIso).slice(0, 10);
}

module.exports = { computeValidUntil, isDevisExpired };
