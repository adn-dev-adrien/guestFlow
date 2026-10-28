/**
 * What the reconciliation did with the operator's choice (specs/plugin-operator-provisioning.md §5):
 * one row per plugin and one licence stamp. Sole DB access for `plugin_provisioning` and
 * `plugin_provisioning_meta`.
 *
 *   get(id) / list()                    → row | null / [row]
 *   record({ pluginId, desired, outcome, code, message, licenceIssuedAt, at, eraseOrder? })
 *                                       → upsert; `eraseOrder` is kept when omitted
 *   erased(orderId)                     → true when this erase order already ran (rule 23)
 *   markErased(orderId, at)             → remembers it
 *   appliedLicence() / setAppliedLicence(issuedAt)
 */

function buildModel(database) {
  const getStmt = database.prepare('SELECT * FROM plugin_provisioning WHERE pluginId = ?');
  const listStmt = database.prepare('SELECT * FROM plugin_provisioning ORDER BY pluginId');
  const upsertStmt = database.prepare(`INSERT INTO plugin_provisioning
      (pluginId, desired, outcome, code, message, licenceIssuedAt, eraseOrder, at)
    VALUES (@pluginId, @desired, @outcome, @code, @message, @licenceIssuedAt, @eraseOrder, @at)
    ON CONFLICT(pluginId) DO UPDATE SET desired = excluded.desired, outcome = excluded.outcome,
      code = excluded.code, message = excluded.message, licenceIssuedAt = excluded.licenceIssuedAt,
      eraseOrder = COALESCE(excluded.eraseOrder, plugin_provisioning.eraseOrder), at = excluded.at`);
  const metaGet = database.prepare('SELECT value FROM plugin_provisioning_meta WHERE key = ?');
  const metaSet = database.prepare(`INSERT INTO plugin_provisioning_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

  return {
    get: (id) => getStmt.get(id) || null,
    list: () => listStmt.all(),
    record({ pluginId, desired, outcome, code = null, message = null, licenceIssuedAt, at, eraseOrder = null }) {
      upsertStmt.run({ pluginId, desired, outcome, code, message, licenceIssuedAt, eraseOrder, at });
    },
    erased: (orderId) => Boolean(metaGet.get(`erase:${orderId}`)),
    markErased: (orderId, at) => { metaSet.run(`erase:${orderId}`, at); },
    appliedLicence: () => (metaGet.get('appliedLicenceIssuedAt') || {}).value || null,
    setAppliedLicence: (issuedAt) => { metaSet.run('appliedLicenceIssuedAt', issuedAt); },
  };
}

let defaultModel = null;
module.exports = {
  buildModel,
  get default() {
    if (!defaultModel) defaultModel = buildModel(require('../database'));
    return defaultModel;
  },
};
