/** Small key/value facts of the console itself (the last daily run). */

function buildMetaModel(db) {
  const getStmt = db.prepare('SELECT value FROM meta WHERE key = ?');
  const setStmt = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  return {
    get: (key) => (getStmt.get(key) || {}).value || null,
    set: (key, value) => setStmt.run(key, String(value)),
  };
}

module.exports = { buildMetaModel };
