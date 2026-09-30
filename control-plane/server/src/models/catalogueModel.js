/**
 * The plan catalogue (rules 1–6): plans with their prices and quotas, the lowest plan of each
 * plugin (higher plans inherit it), the add-ons, and every saved version.
 */

function buildCatalogueModel(db) {
  const plansStmt = db.prepare('SELECT * FROM plans ORDER BY rank');
  const lowestStmt = db.prepare('SELECT pluginId, planCode FROM plan_plugins');
  const addonsStmt = db.prepare('SELECT * FROM addons ORDER BY pluginId');
  const currentVersionStmt = db.prepare('SELECT MAX(version) AS v FROM catalogue_versions');
  const versionStmt = db.prepare('SELECT * FROM catalogue_versions WHERE version = ?');
  const versionsStmt = db.prepare('SELECT version, changedBy, changedAt, reason FROM catalogue_versions ORDER BY version DESC');
  const updatePlanStmt = db.prepare(`UPDATE plans SET priceMonthlyCents = @priceMonthlyCents, priceYearlyCents = @priceYearlyCents,
    maxUnits = @maxUnits, maxUsers = @maxUsers WHERE code = @code`);
  const clearLowestStmt = db.prepare('DELETE FROM plan_plugins');
  const insertLowestStmt = db.prepare('INSERT INTO plan_plugins (pluginId, planCode) VALUES (?, ?)');
  const clearAddonsStmt = db.prepare('DELETE FROM addons');
  const insertAddonStmt = db.prepare('INSERT INTO addons (pluginId, priceMonthlyCents) VALUES (?, ?)');
  const insertVersionStmt = db.prepare(
    'INSERT INTO catalogue_versions (version, snapshotJson, changedBy, changedAt, reason) VALUES (?, ?, ?, ?, ?)'
  );

  const model = {
    plans: () => plansStmt.all(),
    plan: (code) => plansStmt.all().find((p) => p.code === code) || null,
    lowest() {
      const out = {};
      for (const row of lowestStmt.all()) out[row.pluginId] = row.planCode;
      return out;
    },
    addons: () => addonsStmt.all(),
    currentVersion: () => currentVersionStmt.get().v,
    snapshot(version) {
      const row = versionStmt.get(version);
      return row ? JSON.parse(row.snapshotJson) : null;
    },
    versions: () => versionsStmt.all(),

    // Writes the catalogue and its new version in one transaction; returns the version number.
    save({ plans, lowest, addons, changedBy, reason, at }) {
      return db.transaction(() => {
        for (const p of plans) updatePlanStmt.run(p);
        clearLowestStmt.run();
        for (const [pluginId, planCode] of Object.entries(lowest)) if (planCode) insertLowestStmt.run(pluginId, planCode);
        clearAddonsStmt.run();
        for (const a of addons) insertAddonStmt.run(a.pluginId, a.priceMonthlyCents);
        const version = model.currentVersion() + 1;
        const snapshot = { plans: model.plans(), lowest: model.lowest(), addons: model.addons() };
        insertVersionStmt.run(version, JSON.stringify(snapshot), changedBy, at, reason);
        return version;
      })();
    },
  };
  return model;
}

module.exports = { buildCatalogueModel };
