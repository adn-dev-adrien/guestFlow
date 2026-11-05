/**
 * specs/platform-extra-guest-complement.md §3.2 — the persons the platform billed, captured when the
 * brut is first entered and kept until it is cleared. Server-owned: never read from a request body.
 */

function isBrutPinned(platform, platformGrossAmount) {
  return String(platform || 'direct').toLowerCase() !== 'direct'
    && platformGrossAmount !== '' && platformGrossAmount != null
    && Number.isFinite(Number(platformGrossAmount));
}

function countPayingPersons({ adults, teens, children }) {
  return (Number(adults || 1) || 1) + (Number(teens || 0) || 0) + (Number(children || 0) || 0);
}

/**
 * @param {object|null} stored  the reservation row before this save (null on create)
 * @param {object} next         the incoming body: platform, platformGrossAmount, adults, teens, children
 * @returns {number|null}
 */
function resolvePlatformPaidGuests(stored, next) {
  if (!isBrutPinned(next.platform, next.platformGrossAmount)) return null;
  // Rule 5 — correcting the amount must not swallow the guests added since the brut was entered.
  if (stored && isBrutPinned(stored.platform, stored.platformGrossAmount) && stored.platformPaidGuests != null) {
    return Number(stored.platformPaidGuests);
  }
  return countPayingPersons(next);
}

/**
 * specs/platform-added-guests-tourist-tax.md rule 1 — the adults the platform billed, same lifecycle
 * as the guests: only adults pay the tourist tax, so a head count is not enough to price it.
 */
function resolvePlatformPaidAdults(stored, next) {
  if (!isBrutPinned(next.platform, next.platformGrossAmount)) return null;
  if (stored && isBrutPinned(stored.platform, stored.platformGrossAmount) && stored.platformPaidAdults != null) {
    return Number(stored.platformPaidAdults);
  }
  return Number(next.adults || 1) || 1;
}

/**
 * specs/platform-added-guests-tourist-tax.md rule 19 — the occupants the tax of the paid party is priced
 * on, same lifecycle. Not `platformPaidGuests`: the supplement reads that one, and on a stay whose party
 * already differs from it the comparison would see a difference nobody made. A row an older release wrote
 * has no occupants yet and reads the persons, what that release compared with.
 */
function resolvePlatformPaidOccupants(stored, next) {
  if (!isBrutPinned(next.platform, next.platformGrossAmount)) return null;
  if (stored && isBrutPinned(stored.platform, stored.platformGrossAmount)) {
    if (stored.platformPaidOccupants != null) return Number(stored.platformPaidOccupants);
    if (stored.platformPaidGuests != null) return Number(stored.platformPaidGuests);
  }
  return countPayingPersons(next);
}

// specs/platform-added-guests-tourist-tax.md rule 23 — the line's one name, on every surface.
const ADDED_GUESTS_TAX_LABEL = 'Complément de taxe de séjour';

module.exports = {
  ADDED_GUESTS_TAX_LABEL, isBrutPinned, countPayingPersons, resolvePlatformPaidGuests, resolvePlatformPaidAdults, resolvePlatformPaidOccupants,
};
