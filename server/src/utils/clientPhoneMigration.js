/**
 * One-shot migration: collapse the legacy multi-number `phoneNumbers` JSON column into the scalar
 * `phone`. For each client the FIRST non-blank listed number is kept in `phone` (the extras are
 * discarded), then the `phoneNumbers` column is dropped.
 *
 * Idempotent: returns false and does nothing once `phoneNumbers` no longer exists.
 */
function migrateClientPhonesToSingle(db) {
  const cols = db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name);
  if (!cols.includes('phoneNumbers')) return false;

  const setPhone = db.prepare('UPDATE clients SET phone = ? WHERE id = ?');
  const run = db.transaction(() => {
    const rows = db.prepare('SELECT id, phone, phoneNumbers FROM clients').all();
    for (const row of rows) {
      let list = [];
      try { list = JSON.parse(row.phoneNumbers || '[]'); } catch { list = []; }
      const first = (Array.isArray(list) ? list : [])
        .map((p) => String(p || '').trim())
        .find((p) => p !== '');
      if (first && String(row.phone || '').trim() !== first) {
        setPhone.run(first, row.id);
      }
    }
  });
  run();

  db.exec('ALTER TABLE clients DROP COLUMN phoneNumbers');
  return true;
}

module.exports = { migrateClientPhonesToSingle };
