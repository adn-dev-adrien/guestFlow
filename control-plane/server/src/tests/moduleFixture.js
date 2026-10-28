// Shared by the module suites (specs/plugin-operator-provisioning.md): a customer whose space the
// test can write to, as the space's own reconciliation would.
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, NEW_CUSTOMER, licencePayload } = require('./helpers');

async function customerWithSpace({ at, ...custom } = {}) {
  const env = makeContext({ at });
  const created = await env.ctx.controllers.customers.create({ ...NEW_CUSTOMER, ...custom }, 'adrien@adn-dev.fr');
  return { ...env, id: created.id, slug: created.slug };
}

// Rewrites the space's plugin rows and provisioning tables: { active, inactive, versions, rows, applied, facts, erased }.
function writeSpace(env, { active = [], inactive = [], versions = {}, rows = [], applied = null, facts = {}, erased = [], provisioning = true }) {
  const db = new Database(path.join(env.root, env.slug, 'data', 'guestflow.db'));
  db.exec('DROP TABLE IF EXISTS plugins; CREATE TABLE plugins (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, source TEXT, version TEXT)');
  const insert = db.prepare('INSERT INTO plugins (id, enabled, source, version) VALUES (?, ?, ?, ?)');
  active.forEach((id) => insert.run(id, 1, 'bundled', versions[id] || null));
  inactive.forEach((id) => insert.run(id, 0, 'bundled', versions[id] || null));
  db.exec('DROP TABLE IF EXISTS plugin_provisioning; DROP TABLE IF EXISTS plugin_provisioning_meta');
  if (provisioning) {
    db.exec(`CREATE TABLE plugin_provisioning (pluginId TEXT PRIMARY KEY, desired TEXT NOT NULL, outcome TEXT NOT NULL, code TEXT, message TEXT,
        licenceIssuedAt TEXT NOT NULL, eraseOrder TEXT, at TEXT NOT NULL);
      CREATE TABLE plugin_provisioning_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    rows.forEach((r) => db.prepare('INSERT INTO plugin_provisioning VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.pluginId, r.desired, r.outcome, r.code || null, r.message || null, r.licenceIssuedAt, null, r.at || r.licenceIssuedAt));
    const meta = db.prepare('INSERT INTO plugin_provisioning_meta VALUES (?, ?)');
    if (applied) meta.run('appliedLicenceIssuedAt', applied);
    Object.entries(facts).forEach(([id, f]) => meta.run(`facts:${id}`, JSON.stringify(f)));
    erased.forEach((order) => meta.run(`erase:${order}`, '2026-10-01T00:00:00Z'));
  }
  db.close();
}

const lineOf = (view, id) => [...view.included, ...view.outOfPlan].find((l) => l.id === id);
const writtenAt = (env) => env.ctx.models.meta.get(`licenceIssuedAt:${env.id}`);
const licenceOf = (env) => licencePayload(env.ctx.controllers.customers.licenceDownload(env.id).token);

module.exports = { customerWithSpace, writeSpace, lineOf, writtenAt, licenceOf };
