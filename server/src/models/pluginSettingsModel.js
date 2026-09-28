/**
 * Plugin settings model — sole DB access for `plugin_settings` (specs/plugins-phase-1-sdk.md rule 7).
 *
 * One row per (plugin, key). A key a plugin declares `secret` is stored encrypted with the same
 * AES-256-GCM helper and key as `app_settings`, and is never returned in clear over HTTP: the HTTP view
 * replaces it with `<key>Set`.
 *
 * API (per model):
 *   get(pluginId, key, { secret })  → string ('' when absent or undecryptable)
 *   set(pluginId, key, value, { secret }) → writes; '' or null deletes the row
 *   raw(pluginId, key)              → the stored value, untouched (blob for a secret)
 *   deleteAll(pluginId)             → removes every key of a plugin (erasure)
 *   httpView(pluginId, declared)    → { key: value | keySet: bool } for the declared keys
 */

const { encrypt, safeDecrypt } = require('../utils/encryption');

function buildModel(database) {
  const getStmt = database.prepare('SELECT value FROM plugin_settings WHERE plugin_id = ? AND key = ?');
  const upsertStmt = database.prepare(`
    INSERT INTO plugin_settings (plugin_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const deleteStmt = database.prepare('DELETE FROM plugin_settings WHERE plugin_id = ? AND key = ?');
  const deleteAllStmt = database.prepare('DELETE FROM plugin_settings WHERE plugin_id = ?');

  function raw(pluginId, key) {
    const row = getStmt.get(pluginId, key);
    return row && row.value != null ? String(row.value) : '';
  }

  function get(pluginId, key, { secret = false } = {}) {
    const value = raw(pluginId, key);
    if (!secret || !value) return value;
    const r = safeDecrypt(value);
    if (r.ok) return r.value;
    // eslint-disable-next-line no-console
    console.warn(`[plugin:${pluginId}] decrypt failed for setting "${key}" (${r.reason}). Re-saisis la valeur.`);
    return '';
  }

  function set(pluginId, key, value, { secret = false } = {}) {
    if (value === null || value === undefined || value === '') {
      deleteStmt.run(pluginId, key);
      return;
    }
    upsertStmt.run(pluginId, key, secret ? encrypt(String(value)) : String(value));
  }

  function httpView(pluginId, declared) {
    const out = {};
    declared.forEach(({ key, secret, default: def }) => {
      if (secret) out[`${key}Set`] = Boolean(raw(pluginId, key));
      else out[key] = raw(pluginId, key) || (def === undefined ? '' : def);
    });
    return out;
  }

  return {
    get,
    set,
    raw,
    deleteAll: (pluginId) => deleteAllStmt.run(pluginId).changes,
    httpView,
  };
}

const defaultModel = (() => {
  try { return buildModel(require('../database')); } catch { return null; }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel };
}
