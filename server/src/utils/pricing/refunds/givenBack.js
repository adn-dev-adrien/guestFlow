/**
 * REFUNDS / givenBack — whether the lines a sale reference placed on a stay were given back by the refund register
 * (specs/guest-app.md rule 110 b, owner reading of 2026-11-16, loop t2 AG2-2).
 *
 * The lines are the stored rows whose `orderRef` starts with `refPrefix` (pricing-components rule 13: `order:<id>:<n>`). The
 * register keys a line by its article (`billedLineKey`), so the answer is « given back » only when every key those lines carry
 * has been refunded (outside a requalification) and the refund dialog no longer offers anything on it: a key shared with
 * money still refundable reads « not given back », never the reverse.
 */

const { billedLineKey, isRequalification, refundedByKey } = require('./register');

function keysOfRef(database, reservationId, refPrefix) {
  const like = `${refPrefix}%`;
  const id = Number(reservationId);
  const rows = [
    ...database.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? AND orderRef LIKE ?').all(id, like),
    ...database.prepare('SELECT resourceId FROM reservation_resources WHERE reservationId = ? AND orderRef LIKE ?').all(id, like),
    ...database.prepare('SELECT description, 1 AS isCustom FROM reservation_custom_options WHERE reservationId = ? AND orderRef LIKE ?').all(id, like),
  ];
  return new Set(rows.map(billedLineKey).filter(Boolean));
}

/**
 * @param {number} reservationId
 * @param {string} refPrefix   e.g. `order:12:`
 * @param {object} [deps]      `{ database, register }` — `register(id)` is the refunds controller's `buildRegister`
 * @returns {boolean}
 */
function refGivenBack(reservationId, refPrefix, deps = {}) {
  const database = deps.database || require('../../../database'); // eslint-disable-line global-require
  // Required lazily: the refunds controller requires the pricing modules this file belongs to.
  const register = deps.register || ((id) => require('../../../controllers/refundsController').buildRegister(id)); // eslint-disable-line global-require
  const keys = keysOfRef(database, reservationId, refPrefix);
  if (!keys.size) return false;
  const read = register(Number(reservationId));
  if (!read) return false;
  const left = new Map((read.payload.refundableLines || []).map((line) => [line.key, Number(line.refundableTtc) || 0]));
  const given = refundedByKey(read.payload.refunds, (refund) => !isRequalification(refund));
  return [...keys].every((key) => !(left.get(key) > 0) && Number(given[key] || 0) > 0);
}

module.exports = { refGivenBack };
