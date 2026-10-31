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
    // Bind the block-hour constants as parameters instead of interpolating — same rationale
    // as reservationsModel.validateAvailability. Cleaned up in the 2026-06-01 security audit (M5).
    let sql = `
      SELECT r.id, r.propertyId, r.startDate, r.endDate, p.name AS propertyName
      FROM reservations r
      JOIN properties p ON p.id = r.propertyId
      WHERE r.kind = 'reservation'
        AND (CASE WHEN CAST(SUBSTR(COALESCE(r.checkInTime, '15:00'), 1, 2) AS INTEGER) <= ?
                  THEN date(r.startDate, '-1 day') ELSE r.startDate END) < ?
        AND (CASE WHEN CAST(SUBSTR(COALESCE(r.checkOutTime, '10:00'), 1, 2) AS INTEGER) >= ?
                  THEN date(r.endDate, '+1 day') ELSE r.endDate END) > ?
    `;
    const params = [EARLY_CHECKIN_BLOCK_HOUR, endDate, LATE_CHECKOUT_BLOCK_HOUR, startDate];
    if (propertyId != null) {
      sql += ' AND r.propertyId = ?';
      params.push(Number(propertyId));
    }
    sql += ' ORDER BY r.startDate ASC LIMIT 1';
    return database.prepare(sql).get(...params) || null;
  }

  /**
   * Every reservation the closure would cover (specs/payment-link-lifecycle.md rule 40): the same
   * night-block expansion as `findReservationOverlap`, which the tariff-recipes plugin keeps calling.
   */
  function findReservationOverlaps(propertyId, startDate, endDate) {
    let sql = `
      SELECT r.id, r.propertyId, r.startDate, r.endDate, r.reservationNumber, p.name AS propertyName,
             c.firstName, c.lastName
      FROM reservations r
      JOIN properties p ON p.id = r.propertyId
      LEFT JOIN clients c ON c.id = r.clientId
      WHERE r.kind = 'reservation'
        AND (CASE WHEN CAST(SUBSTR(COALESCE(r.checkInTime, '15:00'), 1, 2) AS INTEGER) <= ?
                  THEN date(r.startDate, '-1 day') ELSE r.startDate END) < ?
        AND (CASE WHEN CAST(SUBSTR(COALESCE(r.checkOutTime, '10:00'), 1, 2) AS INTEGER) >= ?
                  THEN date(r.endDate, '+1 day') ELSE r.endDate END) > ?
    `;
    const params = [EARLY_CHECKIN_BLOCK_HOUR, endDate, LATE_CHECKOUT_BLOCK_HOUR, startDate];
    if (propertyId != null) {
      sql += ' AND r.propertyId = ?';
      params.push(Number(propertyId));
    }
    sql += ' ORDER BY r.startDate ASC, r.id ASC';
    return database.prepare(sql).all(...params);
  }

  // A devis or a fiche whose nights meet the closure's, on its logement (every logement when global).
  const STAY_ON_NIGHTS = 'r.startDate < ? AND r.endDate > ? AND (? IS NULL OR r.propertyId = ?)';
  const stayParams = (propertyId, startDate, endDate) => {
    const pid = propertyId == null ? null : Number(propertyId);
    return [endDate, startDate, pid, pid];
  };

  /**
   * The open payment links of the devis and fiches on the closure's nights (rule 41), one row per link.
   * A converted devis is left out: the reservation it became answers for its nights (rule 40).
   */
  function findOpenPaymentRequests(propertyId, startDate, endDate) {
    return database.prepare(`
      SELECT l.id AS linkId, l.type, l.amountCents, l.expiresAt,
             r.id AS reservationId, r.kind, r.devisNumber, r.reservationNumber, r.startDate, r.endDate,
             p.name AS propertyName, c.firstName, c.lastName
      FROM payment_links l
      JOIN reservations r ON r.id = l.reservationId
      JOIN properties p ON p.id = r.propertyId
      LEFT JOIN clients c ON c.id = r.clientId
      WHERE l.status = 'open'
        AND (r.kind = 'reservation' OR (r.kind = 'devis' AND COALESCE(r.devisStatus, '') != 'converted'))
        AND ${STAY_ON_NIGHTS}
      ORDER BY r.startDate ASC, r.id ASC, l.id ASC
    `).all(...stayParams(propertyId, startDate, endDate));
  }

  /** The devis on the closure's nights that hold no open link (rule 49): they warn, never block. */
  function findDevisWithoutLink(propertyId, startDate, endDate) {
    return database.prepare(`
      SELECT r.id AS reservationId, r.devisNumber, r.startDate, r.endDate,
             p.name AS propertyName, c.firstName, c.lastName
      FROM reservations r
      JOIN properties p ON p.id = r.propertyId
      LEFT JOIN clients c ON c.id = r.clientId
      WHERE r.kind = 'devis' AND COALESCE(r.devisStatus, '') != 'converted'
        AND ${STAY_ON_NIGHTS}
        AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.reservationId = r.id AND l.status = 'open')
      ORDER BY r.startDate ASC, r.id ASC
    `).all(...stayParams(propertyId, startDate, endDate));
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
    findReservationOverlaps,
    findOpenPaymentRequests,
    findDevisWithoutLink,
    findClosureOverlap,
    findCoveringClosure,
    expandClosuresToDates,
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
