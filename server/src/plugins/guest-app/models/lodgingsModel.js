/**
 * `guest_app_lodgings` — what each lodging shows its guests (specs/guest-app.md rules 1, 11bis-11quater).
 * A property without a row is off: a property created later needs no event to start off.
 *
 * The lodging code is the capability a printed QR code carries: never logged, never returned over the admin
 * API here. The wifi password is shown to guests, but must not sit in clear in a backup.
 *
 * A factory: the plugin builds it on `ctx.db`, tests on an in-memory database.
 */

const crypto = require('crypto');
const sdk = require('../../sdk');

const { encrypt, safeDecrypt } = sdk.coreModule('encryption');
const { isOffered } = sdk.coreModule('resourceOffer');

const CODE_BYTES = 16;
const HOURLY = 'per_hour';

const generateLodgingCode = () => crypto.randomBytes(CODE_BYTES).toString('base64url');

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** « L'Estiva » → `l-estiva`: the property has no slug of its own (rule 15's `lodging=` parameter). */
function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A password that no longer decrypts must not take the whole home down: the operator retypes it.
function readPassword(blob) {
  if (!blob) return '';
  const result = safeDecrypt(blob);
  return result.ok ? result.value : '';
}

function createLodgingsModel(db) {
  const propertyOf = (propertyId) => db.prepare('SELECT id, name FROM properties WHERE id = ?').get(Number(propertyId)) || null;
  const rowOf = (propertyId) => db.prepare('SELECT * FROM guest_app_lodgings WHERE propertyId = ?').get(Number(propertyId)) || null;

  function toLodging(property, row) {
    return {
      propertyId: property.id,
      enabled: Boolean(row && row.enabled),
      hasLodgingCode: Boolean(row && row.lodgingCode),
      name: property.name,
      slug: slugify(property.name),
      heroMediaId: (row && row.heroMediaId) || null,
      modules: row ? parseJson(row.modulesJson) : null,
      wifi: {
        available: Boolean(row && row.wifiAvailable),
        network: (row && row.wifiNetwork) || '',
        password: row ? readPassword(row.wifiPasswordEncrypted) : '',
        note: (row && row.wifiNote) || '',
      },
      contacts: (row && parseJson(row.contactsJson)) || [],
    };
  }

  /**
   * Rule 48 — every GuestFlow property, in GuestFlow's own order (by name, as its lodging list), its name read live:
   * a property added in GuestFlow is listed at once, off (rule 11quater), and its configuration needs no event.
   */
  function listAll() {
    const rows = new Map(db.prepare('SELECT * FROM guest_app_lodgings').all().map((row) => [Number(row.propertyId), row]));
    return db.prepare('SELECT id, name FROM properties ORDER BY name').all().map((property) => toLodging(property, rows.get(Number(property.id)) || null));
  }

  function get(propertyId) {
    const property = propertyOf(propertyId);
    return property ? toLodging(property, rowOf(propertyId)) : null;
  }

  /** Rule 11quater — a disabled lodging answers like an unknown code; so does a deleted property. */
  function findEnabledByCode(code) {
    const row = db.prepare('SELECT * FROM guest_app_lodgings WHERE lodgingCode = ? AND enabled = 1').get(String(code));
    const property = row && propertyOf(row.propertyId);
    return property ? toLodging(property, row) : null;
  }

  function findEnabled(propertyId) {
    const lodging = get(propertyId);
    return lodging && lodging.enabled ? lodging : null;
  }

  /**
   * Writes what the patch names and keeps the rest: the studio saves its screens one at a time. A wifi
   * patch without `password` keeps the stored one. The code is issued the first time a lodging is enabled,
   * and survives a disable, so the QR already printed works again.
   */
  function save(propertyId, patch) {
    const id = Number(propertyId);
    return db.transaction(() => {
      if (!propertyOf(id)) return null;
      const row = rowOf(id) || {};
      const enabled = patch.enabled === undefined ? Boolean(row.enabled) : patch.enabled;
      const has = (key) => patch[key] !== undefined;
      const wifi = patch.wifi || {};
      const next = {
        propertyId: id,
        enabled: enabled ? 1 : 0,
        lodgingCode: row.lodgingCode || (enabled ? generateLodgingCode() : null),
        heroMediaId: has('heroMediaId') ? patch.heroMediaId : (row.heroMediaId ?? null),
        modulesJson: has('modules') ? JSON.stringify(patch.modules) : (row.modulesJson ?? null),
        wifiAvailable: patch.wifi ? (wifi.available ? 1 : 0) : (row.wifiAvailable ?? 0),
        wifiNetwork: patch.wifi && wifi.network !== undefined ? wifi.network : (row.wifiNetwork ?? null),
        wifiPasswordEncrypted: patch.wifi && wifi.password !== undefined ? (encrypt(wifi.password) || null) : (row.wifiPasswordEncrypted ?? null),
        wifiNote: patch.wifi && wifi.note !== undefined ? wifi.note : (row.wifiNote ?? null),
        contactsJson: has('contacts') ? JSON.stringify(patch.contacts) : (row.contactsJson ?? null),
        bookletSeededAt: row.bookletSeededAt ?? null,
      };
      db.prepare(`
        INSERT OR REPLACE INTO guest_app_lodgings
          (propertyId, enabled, lodgingCode, heroMediaId, modulesJson, wifiAvailable, wifiNetwork, wifiPasswordEncrypted, wifiNote, contactsJson, bookletSeededAt)
        VALUES
          (@propertyId, @enabled, @lodgingCode, @heroMediaId, @modulesJson, @wifiAvailable, @wifiNetwork, @wifiPasswordEncrypted, @wifiNote, @contactsJson, @bookletSeededAt)
      `).run(next);
      return get(id);
    })();
  }

  /** The sold items linked to a lodging, for the prerequisites of `shop` and `bath` (rule 11bis). */
  function soldCounts(propertyId) {
    const id = Number(propertyId);
    const options = db.prepare(`
      SELECT COUNT(*) AS n FROM guest_app_items i
      JOIN options o ON o.id = i.itemId AND o.archivedAt IS NULL
      JOIN property_options po ON po.optionId = o.id AND po.propertyId = ?
      WHERE i.kind = 'option' AND i.sold = 1
    `).get(id).n;
    const resources = db.prepare(`
      SELECT r.priceType FROM guest_app_items i
      JOIN resources r ON r.id = i.itemId
      JOIN resource_properties rp ON rp.resourceId = r.id AND rp.propertyId = ?
      WHERE i.kind = 'resource' AND i.sold = 1
    `).all(id).filter(isOffered);
    return {
      soldItems: options + resources.length,
      soldHourlyResources: resources.filter((r) => r.priceType === HOURLY).length,
    };
  }

  /**
   * Rule 1 — a new code for an enabled lodging: the old one answers like an unknown code from now on, and every
   * poster printed with it is dead. → the new code, or null for a lodging not in the app.
   */
  function regenerateCode(propertyId) {
    const code = generateLodgingCode();
    const changed = db.prepare('UPDATE guest_app_lodgings SET lodgingCode = ? WHERE propertyId = ? AND enabled = 1').run(code, Number(propertyId)).changes;
    return changed ? code : null;
  }

  /** The code the poster prints — only for an enabled lodging; never over the JSON API. */
  function codeOf(propertyId) {
    const row = db.prepare('SELECT lodgingCode FROM guest_app_lodgings WHERE propertyId = ? AND enabled = 1').get(Number(propertyId));
    return (row && row.lodgingCode) || null;
  }

  function mediaPath(mediaId) {
    const row = mediaId ? db.prepare('SELECT path FROM guest_media WHERE id = ?').get(Number(mediaId)) : null;
    return row ? row.path : null;
  }

  return {
    codeOf, findEnabled, findEnabledByCode, get, listAll, mediaPath, regenerateCode, save, soldCounts,
  };
}

module.exports = createLodgingsModel;
module.exports.slugify = slugify;
