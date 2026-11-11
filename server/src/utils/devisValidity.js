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
 * `validUntil` = MAX(createdAt, MIN(createdAt + quoteValidityDays, startDate − 2 days)), per §3.2
 * rule 6 of specs/devis-pdf-and-tourist-tax-fixes.md (the floor: rule 6 reading R30-RES-M1). Both
 * inputs are ISO `YYYY-MM-DD`; output the same. Falls back to the un-capped value when `startDate`
 * isn't a valid ISO date.
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
    // A stay starting within two days caps before the issue day: such a quote was born expired and
    // « Prolonger » re-issued it expired again. It stands, and is due, on the day it is issued.
    if (cap && raw > cap) return cap < createdAtIsoDate ? createdAtIsoDate : cap;
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

// A quote still open to the guest: neither accepted nor converted into a reservation.
const OPEN_STATUSES = new Set(['draft', 'sent']);

/**
 * May this quote be re-issued from today (specs/ui-review-2026-10-19-operations.md rule 20)? Only an
 * EXPIRED quote that is still open: a converted quote is a reservation now, and an accepted one is
 * a promise already taken — re-dating either would re-price a stay the guest has agreed to.
 */
function isDevisExtendable(row, todayIso) {
  if (!row) return false;
  const status = row.devisStatus == null || row.devisStatus === '' ? 'draft' : String(row.devisStatus);
  return OPEN_STATUSES.has(status) && isDevisExpired(row.validUntil, todayIso);
}

/**
 * A stored validity date read against the stay's current dates (§3.2 rule 7 reading R31-RES-M1): a quote moved to earlier
 * dates keeps its date only up to `startDate − 2`, floored at today so the move never expires it (rule 6 reading R30).
 * Unchanged when the stay did not move closer, when nothing is stored, or when `startDate` is not an ISO date.
 */
function validUntilForStart(validUntil, startDateIso, todayIsoDate) {
  if (!validUntil || !startDateIso || !ISO_DATE.test(startDateIso)) return validUntil;
  const cap = addDaysToIsoDate(startDateIso, -2);
  if (!cap) return validUntil;
  const latest = cap < todayIsoDate ? todayIsoDate : cap;
  return String(validUntil).slice(0, 10) > latest ? latest : validUntil;
}

/**
 * THE validity date of a devis for a given start (§3.2 rule 7 reading R32-RES-M1): the one reading of the save
 * (`devisModel.update`), of the engine input of `computeQuote`, of the fiche's live quote (calculate-price, through
 * `scheduleQuoteInputs`) and of the read (`findById`, its PDF), so a preview never announces a date the save does not
 * write. Every input is an ISO `YYYY-MM-DD`:
 *  - nothing stored (legacy row): rule 7's backfill, `computeValidUntil` from the creation day;
 *  - stored and expired: `reissueExpired` (a save, its preview) re-opens it from today (devis-extras-parity rule 14),
 *    a read keeps the stored date;
 *  - stored and valid, start unchanged: the stored date, capped (`validUntilForStart`, reading R31-RES-M1);
 *  - stored and valid, start moved: MAX(stored, `computeValidUntil` from the creation day for the new start), capped.
 *    The MAX keeps a later window (« Prolonger », an override); the creation window gives back what an earlier move
 *    took. The cap is floored at today, so a move never expires a valid quote (rule 6 reading R30).
 */
function devisValidUntil({ stored, storedStartDate, createdDay, startDate, today, quoteValidityDays, reissueExpired = false }) {
  const start = startDate || storedStartDate;
  if (!stored) return computeValidUntil({ createdAtIsoDate: createdDay, startDateIso: start, quoteValidityDays }) || null;
  if (isDevisExpired(stored, today)) {
    return reissueExpired
      ? computeValidUntil({ createdAtIsoDate: today, startDateIso: start, quoteValidityDays }) || null
      : stored;
  }
  if (!start || !ISO_DATE.test(start) || start === storedStartDate) return validUntilForStart(stored, start, today);
  const window = computeValidUntil({ createdAtIsoDate: createdDay, startDateIso: start, quoteValidityDays });
  const storedDay = String(stored).slice(0, 10);
  return validUntilForStart(window && window > storedDay ? window : stored, start, today);
}

/** The « Validité des devis » setting in days; unset or unreadable reads 30 (the settings accept 1 to 365). */
function readQuoteValidityDays(database) {
  try {
    const row = database.prepare('SELECT quoteValidityDays FROM app_settings WHERE id = 1').get();
    const days = Number(row && row.quoteValidityDays);
    return Number.isFinite(days) && days > 0 ? days : 30;
  } catch { return 30; }
}

module.exports = { computeValidUntil, isDevisExpired, isDevisExtendable, validUntilForStart, devisValidUntil, readQuoteValidityDays };
