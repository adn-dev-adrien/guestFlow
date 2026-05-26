/**
 * Establishment closures model — sole DB access for `establishment_closures`.
 *
 * Encapsulates the global vs per-property scoping and the reservation/closure
 * overlap detection (with night-block expansion for reservations).
 *
 * Exports a default model bound to the production database, and a `create(db)`
 * factory so tests can instantiate against an in-memory schema.
 */

const db = require('../database');

const EARLY_CHECKIN_BLOCK_HOUR = 10;
const LATE_CHECKOUT_BLOCK_HOUR = 17;

function createModel(database) {
  // ----- list / read -----

  function list({ propertyId, from, to } = {}) {
    const where = [];
    const params = [];

    if (propertyId != null && propertyId !== '') {
      where.push('(c.propertyId IS NULL OR c.propertyId = ?)');
      params.push(Number(propertyId));
    }
    if (from) {
      where.push('c.endDate > ?');
      params.push(from);
    }
    if (to) {
      where.push('c.startDate < ?');
      params.push(to);
    }

    const sql = `
      SELECT c.id, c.propertyId, p.name AS propertyName, c.label, c.startDate, c.endDate, c.createdAt, c.updatedAt
      FROM establishment_closures c
      LEFT JOIN properties p ON p.id = c.propertyId
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.startDate ASC, c.id ASC
    `;
    return database.prepare(sql).all(...params);
  }

  function findById(id) {
    return database.prepare(`
      SELECT c.id, c.propertyId, p.name AS propertyName, c.label, c.startDate, c.endDate, c.createdAt, c.updatedAt
      FROM establishment_closures c
      LEFT JOIN properties p ON p.id = c.propertyId
      WHERE c.id = ?
    `).get(Number(id)) || null;
  }

  // ----- write -----

  function insert({ propertyId, label, startDate, endDate }) {
    const result = database.prepare(`
      INSERT INTO establishment_closures (propertyId, label, startDate, endDate, updatedAt)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(
      propertyId == null || propertyId === '' ? null : Number(propertyId),
      String(label || 'Fermeture établissement'),
      String(startDate),
      String(endDate),
    );
    return { id: result.lastInsertRowid };
  }

  function update(id, { propertyId, label, startDate, endDate }) {
    const result = database.prepare(`
      UPDATE establishment_closures
      SET propertyId = ?, label = ?, startDate = ?, endDate = ?, updatedAt = datetime('now')
      WHERE id = ?
    `).run(
      propertyId == null || propertyId === '' ? null : Number(propertyId),
      String(label || 'Fermeture établissement'),
      String(startDate),
      String(endDate),
      Number(id),
    );
    return result.changes > 0;
  }

  function remove(id) {
    const result = database.prepare('DELETE FROM establishment_closures WHERE id = ?').run(Number(id));
    return result.changes > 0;
  }

  // ----- overlap detection -----

  /**
   * Finds a reservation that conflicts with the proposed closure range.
   * Applies the night-block expansion (early check-in ≤10h pushes effective
   * start back by one day; late check-out ≥17h pushes effective end forward).
   *
   * For a global closure (propertyId is null), checks against reservations on
   * ANY property. For a per-property closure, restricts to that property.
   */
  function findReservationOverlap(propertyId, startDate, endDate) {
    let sql = `
      SELECT r.id, r.propertyId, r.startDate, r.endDate, p.name AS propertyName
      FROM reservations r
      JOIN properties p ON p.id = r.propertyId
      WHERE (CASE WHEN CAST(SUBSTR(COALESCE(r.checkInTime, '15:00'), 1, 2) AS INTEGER) <= ${EARLY_CHECKIN_BLOCK_HOUR}
                  THEN date(r.startDate, '-1 day') ELSE r.startDate END) < ?
        AND (CASE WHEN CAST(SUBSTR(COALESCE(r.checkOutTime, '10:00'), 1, 2) AS INTEGER) >= ${LATE_CHECKOUT_BLOCK_HOUR}
                  THEN date(r.endDate, '+1 day') ELSE r.endDate END) > ?
    `;
    const params = [endDate, startDate];
    if (propertyId != null) {
      sql += ' AND r.propertyId = ?';
      params.push(Number(propertyId));
    }
    sql += ' ORDER BY r.startDate ASC LIMIT 1';
    return database.prepare(sql).get(...params) || null;
  }

  /**
   * Finds an existing closure that conflicts with the proposed one.
   *
   * Conflict semantics:
   *  - Global vs anything: always conflicts on overlap.
   *  - Per-property X vs global: conflicts on overlap.
   *  - Per-property X vs per-property X: conflicts on overlap.
   *  - Per-property X vs per-property Y (X ≠ Y): never conflicts.
   */
  function findClosureOverlap(propertyId, startDate, endDate, excludeId = null) {
    const wantsGlobal = propertyId == null;
    let sql = `
      SELECT id, propertyId, label, startDate, endDate
      FROM establishment_closures
      WHERE startDate < ?
        AND endDate > ?
    `;
    const params = [endDate, startDate];
    if (!wantsGlobal) {
      sql += ' AND (propertyId IS NULL OR propertyId = ?)';
      params.push(Number(propertyId));
    }
    if (excludeId != null) {
      sql += ' AND id != ?';
      params.push(Number(excludeId));
    }
    sql += ' ORDER BY startDate ASC LIMIT 1';
    return database.prepare(sql).get(...params) || null;
  }

  /**
   * Finds a closure that covers the given range for the given property
   * (used when validating reservations).
   */
  function findCoveringClosure(propertyId, startDate, endDate) {
    return database.prepare(`
      SELECT id, propertyId, label, startDate, endDate
      FROM establishment_closures
      WHERE startDate < ?
        AND endDate > ?
        AND (propertyId IS NULL OR propertyId = ?)
      ORDER BY startDate ASC
      LIMIT 1
    `).get(endDate, startDate, propertyId == null ? null : Number(propertyId)) || null;
  }

  /**
   * Expands a list of closures into a sorted, de-duplicated list of date
   * strings (inclusive start, exclusive end — same convention as reservations).
   */
  function expandClosuresToDates(closures) {
    const set = new Set();
    for (const c of closures || []) {
      if (!c || !c.startDate || !c.endDate) continue;
      let cursor = String(c.startDate);
      const end = String(c.endDate);
      while (cursor < end) {
        set.add(cursor);
        // Advance one day in ISO; works for valid YYYY-MM-DD strings.
        const next = new Date(`${cursor}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        cursor = next.toISOString().slice(0, 10);
      }
    }
    return Array.from(set).sort();
  }

  return {
    list,
    findById,
    insert,
    update,
    delete: remove,
    findReservationOverlap,
    findClosureOverlap,
    findCoveringClosure,
    expandClosuresToDates,
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
