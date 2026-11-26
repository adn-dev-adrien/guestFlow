/**
 * Refund register / given back — whether the lines a sale reference placed on a stay were given back by the refund register
 * (specs/guest-app/guest-app.md rule 110 b, owner reading of 2026-11-16, loop t2 AG2-2).
 *
 * The lines are the stored rows whose `orderRef` starts with `refPrefix` (pricing-components rule 13: `order:<id>:<n>`). The
 * register keys a line as the line key scheme does (pricing-components rule 85, `keyLines`): the FIRST line of an article by the article
 * (`opt:<id>` / `res:<id>`), every later one `line:<table>:<lineId>` — so a second order of the same article has a key of its own (loop t3
 * A3-2); a custom line by its words (`billedLineKey`). The answer is « given back » only when every key those lines carry
 * has been refunded (outside a requalification) and the refund dialog no longer offers anything on it: a key shared with
 * money still refundable reads « not given back », never the reverse. It reads the database and the refunds controller, so it lives
 * outside `utils/pricing/` (pricing-components rule 2: no unit reads a model or the database); the pure keying is REFUNDS' `register`.
 */

const { billedLineKey, isRequalification, refundedByKey } = require('./pricing/refunds/register');
const { ARTICLE_FIELD, keyLines } = require('./pricing/lineKeys');

function keysOfRef(database, reservationId, refPrefix) {
  const like = `${refPrefix}%`;
  const id = Number(reservationId);
  const keys = new Set();
  // Every line of the table is read, the stay's own and other orders' included: which line of an article is the first decides every key.
  for (const [table, field] of Object.entries(ARTICLE_FIELD)) {
    const rows = database.prepare(`SELECT lineId, ${field}, orderRef FROM ${table} WHERE reservationId = ?`).all(id);
    for (const { row, key } of keyLines(table, rows)) {
      if (key && typeof row.orderRef === 'string' && row.orderRef.startsWith(refPrefix)) keys.add(key);
    }
  }
  database.prepare("SELECT description, 1 AS isCustom FROM reservation_custom_options WHERE reservationId = ? AND orderRef LIKE 'order:%' AND orderRef LIKE ?").all(id, like)
    .map(billedLineKey).filter(Boolean).forEach((key) => keys.add(key));
  return keys;
}

/**
 * @param {number} reservationId
 * @param {string} refPrefix   e.g. `order:12:`
 * @param {object} [deps]      `{ database, register }` — `register(id)` is the refunds controller's `buildRegister`
 * @returns {boolean}
 */
function refGivenBack(reservationId, refPrefix, deps = {}) {
  const database = deps.database || require('../database'); // eslint-disable-line global-require
  // Required lazily: loading the SDK's module list does not load the refunds controller.
  const register = deps.register || ((id) => require('../controllers/refundsController').buildRegister(id)); // eslint-disable-line global-require
  const keys = keysOfRef(database, reservationId, refPrefix);
  if (!keys.size) return false;
  const read = register(Number(reservationId));
  if (!read) return false;
  const left = new Map((read.payload.refundableLines || []).map((line) => [line.key, Number(line.refundableTtc) || 0]));
  const given = refundedByKey(read.payload.refunds, (refund) => !isRequalification(refund));
  return [...keys].every((key) => !(left.get(key) > 0) && Number(given[key] || 0) > 0);
}

module.exports = { refGivenBack };
