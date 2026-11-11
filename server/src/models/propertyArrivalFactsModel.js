/**
 * Arrival facts of a property — sole DB access for `property_arrival_facts`
 * (specs/guest-email-texts-made-simple.md rules 1–2, §5).
 *
 * The key-box code and the Wi-Fi password are secrets: stored encrypted (AES-256-GCM, the
 * `ENCRYPTED_COLUMNS` rule of CLAUDE.md §8), decrypted only for the email context, never returned by
 * `forForm` and never logged.
 *
 * API: buildModel(db) → {
 *   forForm(propertyId)          { address, mapUrl, accessFr, accessEn, hasAccessCode, wifiName, hasWifiPassword }
 *   forEmail(propertyId)         same with `accessCode` and `wifiPassword` in clear, or null
 *   save(propertyId, patch)      a field absent from `patch` is kept; '' clears it
 *   all()                        [{ propertyId, address, accessFr, accessEn, … }] without secrets
 * }
 */

const { encrypt, safeDecrypt } = require('../utils/encryption');

const PLAIN = ['address', 'mapUrl', 'accessFr', 'accessEn', 'wifiName'];
const SECRETS = { accessCode: 'accessCodeEncrypted', wifiPassword: 'wifiPasswordEncrypted' };
const MAX_LENGTH = 1000;

const clean = (v) => String(v == null ? '' : v).trim().slice(0, MAX_LENGTH);

function buildModel(database) {
  const findOne = database.prepare('SELECT * FROM property_arrival_facts WHERE propertyId = ?');

  const plainOf = (row) => Object.fromEntries(PLAIN.map((k) => [k, row ? row[k] || '' : '']));

  function forForm(propertyId) {
    const row = findOne.get(Number(propertyId));
    return {
      ...plainOf(row),
      hasAccessCode: Boolean(row && row.accessCodeEncrypted),
      hasWifiPassword: Boolean(row && row.wifiPasswordEncrypted),
    };
  }

  function forEmail(propertyId) {
    const row = findOne.get(Number(propertyId));
    if (!row) return null;
    const secret = (col) => {
      const result = safeDecrypt(row[col] || '');
      return result.ok ? String(result.value || '') : '';
    };
    return { ...plainOf(row), accessCode: secret(SECRETS.accessCode), wifiPassword: secret(SECRETS.wifiPassword) };
  }

  const save = database.transaction((propertyId, patch = {}) => {
    const id = Number(propertyId);
    const row = findOne.get(id) || {};
    const next = {};
    for (const key of PLAIN) next[key] = Object.prototype.hasOwnProperty.call(patch, key) ? clean(patch[key]) : (row[key] || '');
    for (const [key, col] of Object.entries(SECRETS)) {
      next[col] = Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined
        ? (clean(patch[key]) ? encrypt(clean(patch[key])) : '')
        : (row[col] || '');
    }
    database.prepare(`
      INSERT INTO property_arrival_facts (propertyId, address, mapUrl, accessFr, accessEn, accessCodeEncrypted, wifiName, wifiPasswordEncrypted, updatedAt)
      VALUES (@propertyId, @address, @mapUrl, @accessFr, @accessEn, @accessCodeEncrypted, @wifiName, @wifiPasswordEncrypted, datetime('now'))
      ON CONFLICT (propertyId) DO UPDATE SET
        address = excluded.address, mapUrl = excluded.mapUrl, accessFr = excluded.accessFr, accessEn = excluded.accessEn,
        accessCodeEncrypted = excluded.accessCodeEncrypted, wifiName = excluded.wifiName,
        wifiPasswordEncrypted = excluded.wifiPasswordEncrypted, updatedAt = excluded.updatedAt
    `).run({ propertyId: id, ...next });
  });

  function all() {
    return database.prepare('SELECT propertyId, address, mapUrl, accessFr, accessEn, wifiName FROM property_arrival_facts').all();
  }

  return { forForm, forEmail, save, all };
}

module.exports = { buildModel, MAX_LENGTH };
