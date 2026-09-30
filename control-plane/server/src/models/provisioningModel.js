/**
 * The steps of a customer's creation and deprovisioning (rules 7, 20), and the export links.
 */

function buildProvisioningModel(db) {
  const upsertStmt = db.prepare(`INSERT INTO provisioning_steps (customerId, step, status, detail, at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (customerId, step) DO UPDATE SET status = excluded.status, detail = excluded.detail, at = excluded.at`);
  const listStmt = db.prepare('SELECT * FROM provisioning_steps WHERE customerId = ?');
  const getStmt = db.prepare('SELECT * FROM provisioning_steps WHERE customerId = ? AND step = ?');
  const clearStmt = db.prepare('DELETE FROM provisioning_steps WHERE customerId = ? AND step LIKE ?');
  const failedStmt = db.prepare("SELECT * FROM provisioning_steps WHERE status = 'failed'");
  const insertExportStmt = db.prepare('INSERT INTO exports (token, customerId, path, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)');
  const getExportStmt = db.prepare('SELECT * FROM exports WHERE token = ?');
  const latestExportStmt = db.prepare('SELECT * FROM exports WHERE customerId = ? ORDER BY createdAt DESC LIMIT 1');
  return {
    set: (customerId, step, status, detail, at) => upsertStmt.run(customerId, step, status, detail || '', at),
    list: (customerId) => listStmt.all(customerId),
    get: (customerId, step) => getStmt.get(customerId, step) || null,
    clear: (customerId, prefix) => clearStmt.run(customerId, `${prefix}%`),
    failed: () => failedStmt.all(),
    addExport: ({ token, customerId, path, createdAt, expiresAt }) => insertExportStmt.run(token, customerId, path, createdAt, expiresAt),
    getExport: (token) => getExportStmt.get(token) || null,
    latestExport: (customerId) => latestExportStmt.get(customerId) || null,
  };
}

module.exports = { buildProvisioningModel };
