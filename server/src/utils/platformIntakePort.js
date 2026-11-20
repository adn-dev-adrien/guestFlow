/**
 * Platform booking intake — the shape of the future `reservations.fromPlatform` port and the adapter that carries today's
 * SDK `reservations.update` for an intake patch through it (specs/pricing-components.md §3 rule 71, PR A).
 *
 * Contract:
 *   toPlatformIntake(patch, { platform })  a patch of the fields the three intake plugins set (Booking, Airbnb, Gîtes de France),
 *                                          read as the port's payload: `{ platform, reservationNumber, stay, party, beds, money,
 *                                          notes, lines, includedLines, complementLines, rest }`. On a platform sale each
 *                                          line carries `collectAt`, derived from its `inComplement` like `legacyCollectAt`
 *                                          (§5): 0 → 'platform' (paid to the platform), 1 → 'arrival'.
 *   toUpdatePatch(intake)                  the exact inverse: the patch the fiche's save takes. `collectAt` is dropped, every
 *                                          other field (incl. `inComplement`) is what the plugin wrote, so the save is the
 *                                          one it always was.
 *   isIntakeOnStartedStay(startDate, today) the refusal the intakes share: a started stay stays the operator's.
 *
 * `fromPlatform` (PR B) will build the same payload from a plugin's own data and call the same save. Pure: no DB, no clock.
 */
const { saleChannel } = require('./saleChannel');
const { dayReached } = require('./pricing/stayClock');

const SCALARS = Object.freeze({
  platform: ['platform'],
  reservationNumber: ['reservationNumber'],
  notes: ['notes'],
});
const STAY = Object.freeze({ propertyId: 'propertyId', startDate: 'startDate', endDate: 'endDate', checkInTime: 'checkInTime' });
const PARTY = Object.freeze({ adults: 'adults', children: 'children', teens: 'teens', babies: 'babies' });
const BEDS = Object.freeze({ singleBeds: 'singleBeds', doubleBeds: 'doubleBeds', babyBeds: 'babyBeds' });
const MONEY = Object.freeze({
  gross: 'platformGrossAmount',
  payout: 'platformPayoutAmount',
  withheldTax: 'platformTouristTaxAmount',
  commission: 'platformCommissionAmount',
});
const LINE_LISTS = Object.freeze(['options', 'customOptions', 'resources']);
const GROUPS = Object.freeze({ stay: STAY, party: PARTY, beds: BEDS, money: MONEY });

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** The moment a line is collected, from the flag the plugins write (§5 `legacyCollectAt`): 0 → platform, 1 → arrival. */
function collectAtOf(inComplement) {
  return Number(inComplement) ? 'arrival' : 'platform';
}

function toPlatformIntake(patch, { platform } = {}) {
  const source = patch || {};
  const intake = { rest: {} };
  const claimed = new Set();
  for (const [field, [key]] of Object.entries(SCALARS)) {
    if (has(source, key)) { intake[field] = source[key]; claimed.add(key); }
  }
  for (const [group, keys] of Object.entries(GROUPS)) {
    for (const [field, key] of Object.entries(keys)) {
      if (has(source, key)) { (intake[group] = intake[group] || {})[field] = source[key]; claimed.add(key); }
    }
  }
  const onPlatform = saleChannel(has(source, 'platform') ? source.platform : platform).platformSale;
  intake.lines = {};
  for (const list of LINE_LISTS) {
    if (!has(source, list)) continue;
    claimed.add(list);
    const lines = source[list];
    intake.lines[list] = Array.isArray(lines)
      ? lines.map((line) => (onPlatform && line && typeof line === 'object' && has(line, 'inComplement') && line.inComplement != null
        ? { ...line, collectAt: collectAtOf(line.inComplement) } : line))
      : lines;
  }
  const flat = Object.values(intake.lines).filter(Array.isArray).flat().filter((line) => line && typeof line === 'object');
  intake.includedLines = flat.filter((line) => line.collectAt === 'platform');
  intake.complementLines = flat.filter((line) => line.collectAt === 'arrival');
  for (const key of Object.keys(source)) if (!claimed.has(key)) intake.rest[key] = source[key];
  return intake;
}

function toUpdatePatch(intake) {
  const patch = {};
  for (const [field, [key]] of Object.entries(SCALARS)) if (has(intake, field)) patch[key] = intake[field];
  for (const [group, keys] of Object.entries(GROUPS)) {
    for (const [field, key] of Object.entries(keys)) if (intake[group] && has(intake[group], field)) patch[key] = intake[group][field];
  }
  for (const list of LINE_LISTS) {
    if (!has(intake.lines || {}, list)) continue;
    const lines = intake.lines[list];
    patch[list] = Array.isArray(lines)
      ? lines.map((line) => {
        if (!line || typeof line !== 'object' || !has(line, 'collectAt')) return line;
        const { collectAt, ...own } = line; // eslint-disable-line no-unused-vars
        return own;
      })
      : lines;
  }
  return { ...patch, ...intake.rest };
}

function isIntakeOnStartedStay(startDate, today) {
  return dayReached(startDate, today);
}

module.exports = { toPlatformIntake, toUpdatePatch, isIntakeOnStartedStay, collectAtOf };
