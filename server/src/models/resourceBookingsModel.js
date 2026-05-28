/**
 * Resource bookings model — sole DB access for `resource_bookings` (standalone resource slots, e.g. a
 * spa). Owns the booking price computation (server-authoritative), the turnover-aware slot-conflict
 * check, and CRUD. `create`/`update` return `{ ok, id }` or `{ error, status }` for the thin controller.
 *
 * Exports a default model bound to the production database, and a `create(db)` factory for tests.
 */

const db = require('../database');

const JOIN_QUERY = `
  SELECT rb.*,
    r.name AS resourceName, r.slotDuration, COALESCE(prp.price, r.price) AS resourcePrice, r.openTime, r.closeTime, r.turnoverMinutes, r.openDays,
    c.firstName, c.lastName,
    p.name AS propertyName
  FROM resource_bookings rb
  LEFT JOIN resources r ON rb.resourceId = r.id
  LEFT JOIN property_resource_prices prp ON prp.resourceId = r.id AND prp.propertyId = rb.propertyId
  LEFT JOIN clients c ON rb.clientId = c.id
  LEFT JOIN properties p ON rb.propertyId = p.id
`;

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function toMinutes(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours * 60) + (minutes || 0);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function enrichBooking(b) {
  b.displayName = (b.firstName || b.lastName)
    ? [b.firstName, b.lastName].filter(Boolean).join(' ')
    : (b.clientName || 'Client externe');
  b.paid = Boolean(b.paid);
  return b;
}

function createModel(database) {
  function computeBookingTotalPrice({ resource, startTime, endTime, propertyId }) {
    const durationMinutes = Math.max(0, toMinutes(endTime) - toMinutes(startTime));
    const pid = Number(propertyId || 0);
    const override = pid > 0
      ? database.prepare('SELECT price, freeMinutes FROM property_resource_prices WHERE propertyId = ? AND resourceId = ?').get(pid, Number(resource.id))
      : null;
    const unitPrice = Number(override?.price ?? resource.price ?? 0);
    const freeMinutes = Math.max(0, Number(override?.freeMinutes || 0));

    if (resource.priceType === 'free') return 0;
    if (resource.priceType === 'per_hour') {
      const billedMinutes = Math.max(0, durationMinutes - freeMinutes);
      return roundMoney((unitPrice * billedMinutes) / 60);
    }
    return roundMoney(unitPrice);
  }

  // Minimum billable/usable duration (per-hour minimum or complex slot duration).
  function minimumUsageMinutes(resource) {
    return resource.priceType === 'per_hour'
      ? Math.max(Number(resource.minimumUsageMinutes || 0), resource.isComplex ? Number(resource.slotDuration || 0) : 0)
      : (resource.isComplex ? Number(resource.slotDuration || 0) : 0);
  }

  // Count overlapping bookings (including turnover buffer) on a date, optionally excluding one booking.
  function countConflicts(resourceId, date, startTime, endTime, turnover, excludeId) {
    let sql = `
      SELECT COUNT(*) as cnt
      FROM resource_bookings rb
      WHERE rb.resourceId = ?
        AND rb.date = ?
        AND rb.startTime < strftime('%H:%M', ?, '+' || ? || ' minutes')
        AND strftime('%H:%M', rb.endTime, '+' || ? || ' minutes') > ?
    `;
    const params = [resourceId, date, endTime, turnover, turnover, startTime];
    if (excludeId) { sql += ' AND rb.id != ?'; params.push(excludeId); }
    return database.prepare(sql).get(...params).cnt;
  }

  function getResourceForBooking(resourceId) {
    return database.prepare('SELECT id, quantity, price, turnoverMinutes, priceType, minimumUsageMinutes, slotDuration, isComplex FROM resources WHERE id = ?')
      .get(resourceId);
  }

  function listPlanningEvents(from, to) {
    return database.prepare(`${JOIN_QUERY} WHERE rb.date >= ? AND rb.date <= ? ORDER BY rb.date, rb.startTime`)
      .all(from, to).map(enrichBooking);
  }

  function getOccupiedSlots(resourceId, date) {
    const bookings = database.prepare(`
      SELECT rb.id, rb.startTime, rb.endTime, rb.clientName, r.turnoverMinutes, c.firstName, c.lastName
      FROM resource_bookings rb
      LEFT JOIN resources r ON rb.resourceId = r.id
      LEFT JOIN clients c ON rb.clientId = c.id
      WHERE rb.resourceId = ? AND rb.date = ?
      ORDER BY rb.startTime
    `).all(resourceId, date);
    return bookings.map((b) => ({
      id: b.id,
      startTime: b.startTime,
      endTime: b.endTime,
      turnover: Number(b.turnoverMinutes || 0),
      description: [b.firstName, b.lastName].filter(Boolean).join(' ') || b.clientName || 'Client externe',
    }));
  }

  function listForResource({ resourceId, date, weekStart }) {
    if (weekStart) {
      const endDate = addDays(weekStart, 7);
      return database.prepare(`${JOIN_QUERY} WHERE rb.resourceId = ? AND rb.date >= ? AND rb.date < ? ORDER BY rb.date, rb.startTime`)
        .all(resourceId, weekStart, endDate).map(enrichBooking);
    }
    return database.prepare(`${JOIN_QUERY} WHERE rb.resourceId = ? AND rb.date = ? ORDER BY rb.startTime`)
      .all(resourceId, date).map(enrichBooking);
  }

  function findById(id) {
    const booking = database.prepare(`${JOIN_QUERY} WHERE rb.id = ?`).get(id);
    return booking ? enrichBooking(booking) : null;
  }

  function createBooking(payload) {
    const { resourceId, reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes, paid } = payload;
    if (!resourceId || !date || !startTime || !endTime) {
      return { error: 'resourceId, date, startTime, endTime sont requis', status: 400 };
    }
    const resource = getResourceForBooking(resourceId);
    if (!resource) return { error: 'Ressource non trouvée', status: 404 };

    const duration = Math.max(0, toMinutes(endTime) - toMinutes(startTime));
    const minUsage = minimumUsageMinutes(resource);
    if (minUsage > 0 && duration < minUsage) {
      return { error: `Durée minimale ${minUsage} min requise`, status: 400 };
    }
    const turnover = Number(resource.turnoverMinutes || 0);
    if (countConflicts(resourceId, date, startTime, endTime, turnover, null) >= resource.quantity) {
      return { error: 'Créneau non disponible (capacité atteinte)', status: 409 };
    }

    const totalPrice = computeBookingTotalPrice({ resource, startTime, endTime, propertyId });
    const result = database.prepare(
      'INSERT INTO resource_bookings (resourceId, reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes, totalPrice, paid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(resourceId, reservationId || null, clientId || null, clientName || null, clientPhone || null, propertyId || null, date, startTime, endTime, notes || '', totalPrice, paid ? 1 : 0);
    return { ok: true, id: result.lastInsertRowid };
  }

  function update(id, payload) {
    const existing = database.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id);
    if (!existing) return { error: 'Réservation non trouvée', status: 404 };

    const { reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes, paid } = payload;
    const newDate = date !== undefined ? date : existing.date;
    const newStart = startTime !== undefined ? startTime : existing.startTime;
    const newEnd = endTime !== undefined ? endTime : existing.endTime;

    const resource = getResourceForBooking(existing.resourceId);
    if (!resource) return { error: 'Ressource non trouvée', status: 404 };

    const duration = Math.max(0, toMinutes(newEnd) - toMinutes(newStart));
    const minUsage = minimumUsageMinutes(resource);
    if (minUsage > 0 && duration < minUsage) {
      return { error: `Durée minimale ${minUsage} min requise`, status: 400 };
    }
    const turnover = Number(resource.turnoverMinutes || 0);
    if (countConflicts(existing.resourceId, newDate, newStart, newEnd, turnover, id) >= resource.quantity) {
      return { error: 'Créneau non disponible (capacité atteinte)', status: 409 };
    }

    const nextPropertyId = propertyId !== undefined ? propertyId : existing.propertyId;
    const totalPrice = computeBookingTotalPrice({ resource, startTime: newStart, endTime: newEnd, propertyId: nextPropertyId });

    database.prepare(
      "UPDATE resource_bookings SET reservationId=?,clientId=?,clientName=?,clientPhone=?,propertyId=?,date=?,startTime=?,endTime=?,notes=?,totalPrice=?,paid=?,updatedAt=datetime('now') WHERE id=?"
    ).run(
      reservationId !== undefined ? (reservationId || null) : existing.reservationId,
      clientId !== undefined ? (clientId || null) : existing.clientId,
      clientName !== undefined ? (clientName || null) : existing.clientName,
      clientPhone !== undefined ? (clientPhone || null) : existing.clientPhone,
      propertyId !== undefined ? (propertyId || null) : existing.propertyId,
      newDate, newStart, newEnd,
      notes !== undefined ? notes : existing.notes,
      totalPrice,
      paid !== undefined ? (paid ? 1 : 0) : existing.paid,
      id,
    );
    return { ok: true };
  }

  function remove(id) {
    const existing = database.prepare('SELECT id FROM resource_bookings WHERE id = ?').get(id);
    if (!existing) return { error: 'Non trouvée', status: 404 };
    database.prepare('DELETE FROM resource_bookings WHERE id = ?').run(id);
    return { ok: true };
  }

  return {
    computeBookingTotalPrice,
    minimumUsageMinutes,
    countConflicts,
    listPlanningEvents,
    getOccupiedSlots,
    listForResource,
    findById,
    createBooking,
    update,
    remove,
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
