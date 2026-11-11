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
 *   highestIssuedAt() / setHighestIssuedAt(issuedAt)   the newest licence ever acted on (rule 33)
 *   setCapabilities(obj)                → what this core understands (rule 40): { removalOrders, coreVersion }
 *   setFacts(id, facts | null)          → what the console cannot compute itself: the setup a plugin still
 *                                         lacks and the data lines it would erase (rules 14, 22)
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

  const metaDelete = database.prepare('DELETE FROM plugin_provisioning_meta WHERE key = ?');

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
    highestIssuedAt: () => (metaGet.get('highestIssuedAt') || {}).value || null,
    setHighestIssuedAt: (issuedAt) => { metaSet.run('highestIssuedAt', issuedAt); },
    setCapabilities(capabilities) {
      const value = JSON.stringify(capabilities);
      const current = metaGet.get('capabilities');
      if (!current || current.value !== value) metaSet.run('capabilities', value);
    },
    setFacts(id, facts) {
      const key = `facts:${id}`;
      if (facts === null) { metaDelete.run(key); return; }
      const value = JSON.stringify(facts);
      const current = metaGet.get(key);
      if (!current || current.value !== value) metaSet.run(key, value);
    },
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
