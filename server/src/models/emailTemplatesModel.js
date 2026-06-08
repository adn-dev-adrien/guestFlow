/**
 * Email templates model — sole DB access for `email_templates`
 * (specs/email-automation.md §4.1).
 *
 * Exports a default model bound to the production database, and a `buildModel(db)`
 * factory so tests can run against an in-memory schema.
 *
 * API:
 *   list()                → all rows sorted (dayOffset ASC, name ASC)
 *   findById(id)          → single row or undefined
 *   findByStableKey(key)  → single row or undefined (registry diagnostics)
 *   listEnabled()         → enabled = 1 only, sorted (dayOffset ASC, id ASC)
 *   insert(payload)       → created row (stableKey NOT writable from outside the seed)
 *   update(id, payload)   → updated row; missing keys preserve existing values
 *   remove(id)            → boolean (true when a row was deleted)
 */

function buildModel(database) {
  const SELECT_COLS = 'id, stableKey, name, subject, body, dayOffset, sendMode, enabled, createdAt, updatedAt';

  const listStmt = database.prepare(
    `SELECT ${SELECT_COLS} FROM email_templates ORDER BY dayOffset ASC, name ASC`
  );
  const findByIdStmt = database.prepare(
    `SELECT ${SELECT_COLS} FROM email_templates WHERE id = ?`
  );
  const findByStableKeyStmt = database.prepare(
    `SELECT ${SELECT_COLS} FROM email_templates WHERE stableKey = ?`
  );
  const listEnabledStmt = database.prepare(
    `SELECT ${SELECT_COLS} FROM email_templates WHERE enabled = 1 ORDER BY dayOffset ASC, id ASC`
  );

  // INSERT — stableKey is deliberately omitted: only the registry seed sets it (§4.3).
  const insertStmt = database.prepare(`
    INSERT INTO email_templates (name, subject, body, dayOffset, sendMode, enabled)
    VALUES (@name, @subject, @body, @dayOffset, @sendMode, @enabled)
  `);

  // Per-field 3-way UPDATE — every field is rewritten with COALESCE(?, currentValue) so a
  // partial payload preserves the existing row's other columns.
  const updateStmt = database.prepare(`
    UPDATE email_templates SET
      name      = COALESCE(@name,      name),
      subject   = COALESCE(@subject,   subject),
      body      = COALESCE(@body,      body),
      dayOffset = COALESCE(@dayOffset, dayOffset),
      sendMode  = COALESCE(@sendMode,  sendMode),
      enabled   = COALESCE(@enabled,   enabled),
      updatedAt = datetime('now')
    WHERE id = @id
  `);

  const deleteStmt = database.prepare('DELETE FROM email_templates WHERE id = ?');

  function list() {
    return listStmt.all();
  }

  function findById(id) {
    return findByIdStmt.get(Number(id));
  }

  function findByStableKey(key) {
    return findByStableKeyStmt.get(String(key || ''));
  }

  function listEnabled() {
    return listEnabledStmt.all();
  }

  function insert(payload) {
    const info = insertStmt.run({
      name:      String(payload.name || '').trim(),
      subject:   String(payload.subject || ''),
      body:      String(payload.body || ''),
      dayOffset: Number(payload.dayOffset || 0),
      sendMode:  payload.sendMode === 'auto' ? 'auto' : 'manual',
      enabled:   payload.enabled === false ? 0 : 1,
    });
    return findById(info.lastInsertRowid);
  }

  function update(id, payload) {
    const params = {
      id: Number(id),
      name:      payload.name === undefined ? null : String(payload.name || '').trim(),
      subject:   payload.subject === undefined ? null : String(payload.subject || ''),
      body:      payload.body === undefined ? null : String(payload.body || ''),
      dayOffset: payload.dayOffset === undefined ? null : Number(payload.dayOffset),
      sendMode:  payload.sendMode === undefined ? null : (payload.sendMode === 'auto' ? 'auto' : 'manual'),
      enabled:   payload.enabled === undefined ? null : (payload.enabled === false ? 0 : 1),
    };
    updateStmt.run(params);
    return findById(id);
  }

  function remove(id) {
    const info = deleteStmt.run(Number(id));
    return info.changes > 0;
  }

  return {
    list,
    findById,
    findByStableKey,
    listEnabled,
    insert,
    update,
    remove,
  };
}

const defaultModel = (() => {
  try {
    return buildModel(require('../database'));
  } catch {
    // The model can be required at boot time before the database module is fully wired
    // (e.g. during seed). Fall back to a thunk-style holder; tests use `buildModel` directly.
    return null;
  }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel };
}
