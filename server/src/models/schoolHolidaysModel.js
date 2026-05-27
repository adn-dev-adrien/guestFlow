/**
 * School holidays model — factory pattern for testability.
 *
 * Two tables: `school_holidays` (rows) + `school_holidays_sync_state` (singleton config + state).
 *
 * The default export is bound to the production DB. Tests build their own via `create(db)`.
 */

const productionDb = require('../database');

function createModel(db) {
  // ---------- CRUD ----------

  const listStmt = db.prepare(`
    SELECT id, label,
           zoneA_start, zoneA_end,
           zoneB_start, zoneB_end,
           zoneC_start, zoneC_end,
           externalRef, isLocked, lastSyncedAt
    FROM school_holidays
    ORDER BY COALESCE(zoneA_start, zoneB_start, zoneC_start) ASC, id ASC
  `);
  function list() {
    return listStmt.all();
  }

  const findByIdStmt = db.prepare('SELECT * FROM school_holidays WHERE id = ?');
  function findById(id) {
    return findByIdStmt.get(id) || null;
  }

  const insertStmt = db.prepare(`
    INSERT INTO school_holidays
      (label, zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end, externalRef, isLocked, lastSyncedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)
  `);
  function insert(fields) {
    const r = insertStmt.run(
      fields.label,
      fields.zoneA_start || null, fields.zoneA_end || null,
      fields.zoneB_start || null, fields.zoneB_end || null,
      fields.zoneC_start || null, fields.zoneC_end || null,
    );
    return { id: r.lastInsertRowid };
  }

  const updateStmt = db.prepare(`
    UPDATE school_holidays
       SET label = ?,
           zoneA_start = ?, zoneA_end = ?,
           zoneB_start = ?, zoneB_end = ?,
           zoneC_start = ?, zoneC_end = ?
     WHERE id = ?
  `);
  function update(id, fields) {
    const r = updateStmt.run(
      fields.label,
      fields.zoneA_start || null, fields.zoneA_end || null,
      fields.zoneB_start || null, fields.zoneB_end || null,
      fields.zoneC_start || null, fields.zoneC_end || null,
      id,
    );
    return r.changes > 0;
  }

  const lockStmt = db.prepare('UPDATE school_holidays SET isLocked = 1 WHERE id = ?');
  function lock(id) {
    return lockStmt.run(id).changes > 0;
  }

  const unlockStmt = db.prepare('UPDATE school_holidays SET isLocked = 0 WHERE id = ?');
  function unlock(id) {
    return unlockStmt.run(id).changes > 0;
  }

  const deleteStmt = db.prepare('DELETE FROM school_holidays WHERE id = ?');
  function remove(id) {
    return deleteStmt.run(id).changes > 0;
  }

  // ---------- Sync helpers ----------

  const findByExternalRefStmt = db.prepare('SELECT * FROM school_holidays WHERE externalRef = ?');
  const insertAutoStmt = db.prepare(`
    INSERT INTO school_holidays
      (label, zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end, externalRef, isLocked, lastSyncedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const updateAutoStmt = db.prepare(`
    UPDATE school_holidays
       SET label = ?,
           zoneA_start = ?, zoneA_end = ?,
           zoneB_start = ?, zoneB_end = ?,
           zoneC_start = ?, zoneC_end = ?,
           lastSyncedAt = ?
     WHERE id = ?
  `);

  /**
   * Upsert by externalRef.
   * Returns { action: 'created'|'updated'|'skippedLocked', id }.
   */
  function upsertByExternalRef(payload, nowIso) {
    const existing = findByExternalRefStmt.get(payload.externalRef);
    if (existing) {
      if (existing.isLocked === 1) {
        return { action: 'skippedLocked', id: existing.id };
      }
      updateAutoStmt.run(
        payload.label,
        payload.zoneA_start || null, payload.zoneA_end || null,
        payload.zoneB_start || null, payload.zoneB_end || null,
        payload.zoneC_start || null, payload.zoneC_end || null,
        nowIso,
        existing.id,
      );
      return { action: 'updated', id: existing.id };
    }
    const r = insertAutoStmt.run(
      payload.label,
      payload.zoneA_start || null, payload.zoneA_end || null,
      payload.zoneB_start || null, payload.zoneB_end || null,
      payload.zoneC_start || null, payload.zoneC_end || null,
      payload.externalRef,
      nowIso,
    );
    return { action: 'created', id: r.lastInsertRowid };
  }

  /**
   * Adopt a manual (externalRef IS NULL, isLocked = 0) row by writing its externalRef.
   * Used by the sync engine to absorb seeded rows on first sync and avoid duplicates.
   * Returns true if a row was adopted.
   */
  const adoptStmt = db.prepare(`
    UPDATE school_holidays
       SET externalRef = ?, lastSyncedAt = ?,
           label = ?,
           zoneA_start = ?, zoneA_end = ?,
           zoneB_start = ?, zoneB_end = ?,
           zoneC_start = ?, zoneC_end = ?
     WHERE id = ? AND externalRef IS NULL AND isLocked = 0
  `);
  function adoptManualRow(id, payload, nowIso) {
    const r = adoptStmt.run(
      payload.externalRef, nowIso,
      payload.label,
      payload.zoneA_start || null, payload.zoneA_end || null,
      payload.zoneB_start || null, payload.zoneB_end || null,
      payload.zoneC_start || null, payload.zoneC_end || null,
      id,
    );
    return r.changes > 0;
  }

  /** Return all rows where externalRef IS NULL AND isLocked = 0 (candidates for adoption). */
  const manualRowsStmt = db.prepare(`
    SELECT * FROM school_holidays
     WHERE externalRef IS NULL AND isLocked = 0
  `);
  function listAdoptableRows() {
    return manualRowsStmt.all();
  }

  /**
   * Delete stale auto rows. A row is stale if:
   *   - externalRef IS NOT NULL AND isLocked = 0
   *   - externalRef NOT IN keepRefSet
   *   - latest configured zone end-date is in the past (compared to `todayIso`)
   * Returns the number of deletions.
   */
  function deleteStaleAutoRows(keepRefSet, todayIso) {
    const candidates = db.prepare(`
      SELECT id, externalRef, zoneA_end, zoneB_end, zoneC_end
        FROM school_holidays
       WHERE externalRef IS NOT NULL AND isLocked = 0
    `).all();
    let deleted = 0;
    for (const row of candidates) {
      if (keepRefSet.has(row.externalRef)) continue;
      const latestEnd = [row.zoneA_end, row.zoneB_end, row.zoneC_end]
        .filter(Boolean)
        .sort()
        .pop();
      if (latestEnd && latestEnd >= todayIso) continue;
      deleteStmt.run(row.id);
      deleted += 1;
    }
    return deleted;
  }

  // ---------- Sync state singleton ----------

  const getStateStmt = db.prepare('SELECT * FROM school_holidays_sync_state WHERE id = 1');
  function getSyncState() {
    return getStateStmt.get();
  }

  const setResultStmt = db.prepare(`
    UPDATE school_holidays_sync_state
       SET lastSyncAt = ?, lastSyncStatus = ?, lastSyncMessage = ?, lastImportedCount = ?,
           updatedAt = datetime('now')
     WHERE id = 1
  `);
  function setSyncResult({ lastSyncAt, lastSyncStatus, lastSyncMessage, lastImportedCount }) {
    setResultStmt.run(lastSyncAt, lastSyncStatus, lastSyncMessage || '', lastImportedCount || 0);
  }

  const setSettingsStmt = db.prepare(`
    UPDATE school_holidays_sync_state
       SET syncIntervalDays = ?, syncHorizonMonths = ?, updatedAt = datetime('now')
     WHERE id = 1
  `);
  function updateSyncSettings({ syncIntervalDays, syncHorizonMonths }) {
    setSettingsStmt.run(syncIntervalDays, syncHorizonMonths);
  }

  return {
    list,
    findById,
    insert,
    update,
    lock,
    unlock,
    remove,
    upsertByExternalRef,
    adoptManualRow,
    listAdoptableRows,
    deleteStaleAutoRows,
    getSyncState,
    setSyncResult,
    updateSyncSettings,
  };
}

module.exports = createModel(productionDb);
module.exports.create = createModel;
