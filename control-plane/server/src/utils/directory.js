/**
 * The directory's one transformation (specs/control-plane-plans-and-access.md rule 26): an email
 * becomes an HMAC-SHA256 under the console's own key. The same function serves the read of the
 * instances and the lookup of `app.<domain>`, so an address typed with spaces or capitals finds the
 * account stored in lower case.
 */

const crypto = require('crypto');

const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

function emailHmac(key, email) {
  return crypto.createHmac('sha256', key).update(normaliseEmail(email)).digest('hex');
}

module.exports = { normaliseEmail, emailHmac };
