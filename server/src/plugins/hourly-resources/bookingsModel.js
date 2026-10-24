/**
 * Resource bookings model — sole DB access for `resource_bookings` (standalone resource slots, e.g. a
 * spa). Owns the booking price (server-authoritative, `priceBooking`, shared by the preview and the commit), the turnover-aware slot-conflict
 * check, and CRUD. `create`/`update` return `{ ok, id }` or `{ error, status }` for the thin controller.
 *
 * Exports a default model bound to the production database, and a `create(db)` factory for tests.
 */

const { priceSessions } = require('./hourlyPricing');
const resourceOccupancyModel = require('./occupancyModel');

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
  // Bound to the same database handle so the test factory and production agree on what « occupied » is.
  const occupancyModel = resourceOccupancyModel.create(database);

  /**
   * The price of a booking and how it is made up — the one function behind the preview and the stored
   * `totalPrice` (specs/resource-supplements-total-server-side.md rule 1). Pure read.
   */
  function breakdownOf({ resource, startTime, endTime, propertyId, reservationId }) {
    const durationMinutes = Math.max(0, toMinutes(endTime) - toMinutes(startTime));
    const pid = Number(propertyId || 0);
    const override = pid > 0
      ? database.prepare('SELECT price, freeMinutes FROM property_resource_prices WHERE propertyId = ? AND resourceId = ?').get(pid, Number(resource.id))
      : null;
    const guestDayRate = Number(override?.price ?? resource.price ?? 0);
    const freeMinutes = Math.max(0, Number(override?.freeMinutes || 0));
    const base = {
      total: 0, pricing: 'free', rateGrid: null, durationMinutes,
      freeMinutesApplied: 0, billedMinutes: 0, grossTotal: 0, bands: [], freeValue: 0,
    };

    if (resource.priceType === 'free') return base;

    // Hourly-scheduled resource: time-banded grid (specs/resource-hourly-scheduling.md §3.5). A booking
    // with no reservation = « extérieur » → external rate pair (falling back to the guest grid).
    const hourlyScheduled = Number(resource.showsPlanningCard || 0) === 1 && resource.priceType === 'per_hour';
    if (hourlyScheduled) {
      const isExternal = !reservationId;
      const guestEveningRate = Number(resource.hourlyEveningRate) || 0;
      const dayRate = isExternal && Number(resource.hourlyExternalDayRate) > 0
        ? Number(resource.hourlyExternalDayRate) : guestDayRate;
      const eveningRate = isExternal
        ? (Number(resource.hourlyExternalEveningRate) > 0 ? Number(resource.hourlyExternalEveningRate) : (guestEveningRate > 0 ? guestEveningRate : dayRate))
        : guestEveningRate;
      const cfg = { dayRate, eveningRate, eveningStart: resource.hourlyEveningStart, slotMinutes: resource.slotDuration };
      const priced = priceSessions([{ date: '2000-01-01', start: startTime, end: endTime }], cfg, freeMinutes);
      if (priced.validSessions.length) {
        return {
          ...base,
          total: priced.totalPrice,
          pricing: 'banded',
          rateGrid: isExternal ? 'external' : 'guest',
          freeMinutesApplied: priced.freeMinutesApplied,
          billedMinutes: priced.billedMinutes,
          grossTotal: priced.grossPrice,
          bands: priced.bands,
          freeValue: priced.freeValue,
        };
      }
      // off-grid range → fall through to the flat computation below.
    }

    if (resource.priceType === 'per_hour') {
      const freeMinutesApplied = Math.min(durationMinutes, freeMinutes);
      const billedMinutes = durationMinutes - freeMinutesApplied;
      const total = roundMoney((guestDayRate * billedMinutes) / 60);
      const grossTotal = roundMoney((guestDayRate * durationMinutes) / 60);
      return {
        ...base,
        total,
        pricing: 'flat-hourly',
        freeMinutesApplied,
        billedMinutes,
        grossTotal,
        bands: durationMinutes > 0
          ? [{ band: 'day', from: startTime, to: endTime, minutes: durationMinutes, rate: roundMoney(guestDayRate), amount: grossTotal }]
          : [],
        freeValue: roundMoney(grossTotal - total),
      };
    }
    const total = roundMoney(guestDayRate);
    return { ...base, total, pricing: 'fixed', grossTotal: total };
  }

  // The refusals shared by the preview and the commit: minimum duration, then capacity — the booking
  // itself excluded when it is edited.
  function checkBookable({ resource, date, startTime, endTime, excludeId = null }) {
    const duration = Math.max(0, toMinutes(endTime) - toMinutes(startTime));
    const minUsage = minimumUsageMinutes(resource);
    if (minUsage > 0 && duration < minUsage) {
      return { error: `Durée minimale ${minUsage} min requise`, status: 400 };
    }
    const turnover = Number(resource.turnoverMinutes || 0);
    if (countConflicts(resource.id, date, startTime, endTime, turnover, excludeId) >= resource.quantity) {
      return { error: 'Créneau non disponible (capacité atteinte)', status: 409 };
    }
    return null;
  }

  /**
   * specs/resource-supplements-total-server-side.md rules 1, 4, 5 — prices a booking draft
   * `{ resourceId, bookingId, date, startTime, endTime, propertyId }` without writing anything.
   * Returns the breakdown, or `{ error, status }` with the very refusals the commit would give.
   */
  function priceBooking(draft = {}) {
    const { resourceId, bookingId, date, startTime, endTime, propertyId } = draft;
    if (!resourceId || !date || !startTime || !endTime) {
      return { error: 'resourceId, date, startTime, endTime sont requis', status: 400 };
    }
    const resource = getResourceForBooking(resourceId);
    if (!resource) return { error: 'Ressource non trouvée', status: 404 };
    let reservationId = null;
    if (bookingId) {
      const existing = database.prepare('SELECT reservationId, resourceId FROM resource_bookings WHERE id = ?').get(bookingId);
      if (!existing) return { error: 'Réservation non trouvée', status: 404 };
      if (Number(existing.resourceId) !== Number(resourceId)) return { error: 'Réservation d’une autre ressource', status: 400 };
      reservationId = existing.reservationId;
    }
    const refusal = checkBookable({ resource, date, startTime, endTime, excludeId: bookingId || null });
    if (refusal) return refusal;
    return breakdownOf({ resource, startTime, endTime, propertyId, reservationId });
  }

  // Rule 15 — what the screen showed is compared with what is stored, never enforced.
  function totalWarning(displayedTotal, stored) {
    if (displayedTotal === undefined || displayedTotal === null || displayedTotal === '') return null;
    const displayed = Number(displayedTotal);
    if (!Number.isFinite(displayed) || Math.abs(displayed - stored) < 0.01) return null;
    return { code: 'BOOKING_TOTAL_DIFFERED', displayed: roundMoney(displayed), stored };
  }

  // Minimum billable/usable duration (per-hour minimum or complex slot duration).
  function minimumUsageMinutes(resource) {
    return resource.priceType === 'per_hour'
      ? Math.max(Number(resource.minimumUsageMinutes || 0), resource.isComplex ? Number(resource.slotDuration || 0) : 0)
      : (resource.isComplex ? Number(resource.slotDuration || 0) : 0);
  }

  // Count everything overlapping (turnover buffer included) on a date, optionally excluding one
  // booking. Delegates to `resourceOccupancyModel` so guest sessions count too: this predicate used to
  // read `resource_bookings` alone, which let a standalone booking be created straight on top of a
  // reservation's session (specs/hourly-resource-quantity-and-sas-scheduling.md §1 defect 4).
  function countConflicts(resourceId, date, startTime, endTime, turnover, excludeId) {
    return occupancyModel.countConflicts({
      resourceId, date, startTime, endTime, turnover, excludeBookingId: excludeId,
    });
  }

  function getResourceForBooking(resourceId) {
    return database.prepare('SELECT id, quantity, price, turnoverMinutes, priceType, minimumUsageMinutes, slotDuration, isComplex, showsPlanningCard, hourlyEveningStart, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate FROM resources WHERE id = ?')
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

  /**
   * Everything occupying the resource over the window — standalone bookings AND the sessions placed
   * on reservations — each tagged `kind`. The planning page used to fetch the two separately and merge
   * them in React (a fat-backend violation, and a second definition of « occupied » that could drift
   * from the one the writer enforces). Reservation sessions come back read-only: they belong to a
   * booking, and are edited from its fiche or from the arrival SAS.
   * See specs/hourly-resource-quantity-and-sas-scheduling.md §3.5 rule 29.
   */
  function listForResource({ resourceId, date, weekStart }) {
    const from = weekStart || date;
    const to = weekStart ? addDays(weekStart, 6) : date;
    const bookings = (weekStart
      ? database.prepare(`${JOIN_QUERY} WHERE rb.resourceId = ? AND rb.date >= ? AND rb.date < ? ORDER BY rb.date, rb.startTime`)
        .all(resourceId, weekStart, addDays(weekStart, 7))
      : database.prepare(`${JOIN_QUERY} WHERE rb.resourceId = ? AND rb.date = ? ORDER BY rb.startTime`)
        .all(resourceId, date)
    ).map((b) => ({ ...enrichBooking(b), kind: 'booking' }));

    return [...bookings, ...listReservationSessions({ resourceId, from, to })]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime).localeCompare(String(b.startTime)));
  }

  /**
   * The guest sessions of the window, shaped like a booking row so the planning can render one list.
   * Unlike `resourceOccupancyModel` (which feeds conflict checks and the guest-facing SAS picker, and
   * deliberately carries no identity), this is the OPERATOR's planning: it names the client, exactly
   * as the standalone bookings beside it do.
   */
  function listReservationSessions({ resourceId, from, to }) {
    let rows;
    try {
      rows = database.prepare(`
        SELECT rr.reservationId, rr.sessions,
               r.name AS resourceName, r.turnoverMinutes,
               COALESCE(c.firstName, '') AS firstName, COALESCE(c.lastName, '') AS lastName,
               COALESCE(p.name, '') AS propertyName
        FROM reservation_resources rr
        JOIN resources r ON r.id = rr.resourceId
        JOIN reservations res ON res.id = rr.reservationId
        LEFT JOIN clients c ON c.id = res.clientId
        LEFT JOIN properties p ON p.id = res.propertyId
        WHERE rr.resourceId = ? AND res.kind = 'reservation'
          AND rr.sessions IS NOT NULL AND TRIM(rr.sessions) != ''
      `).all(resourceId);
    } catch { return []; } // `sessions` column absent in minimal test schemas
    const out = [];
    for (const row of rows) {
      for (const session of occupancyModel.parseSessions(row.sessions)) {
        if (session.date < from || session.date > to) continue;
        out.push({
          id: `session-${row.reservationId}-${session.date}-${session.start}`,
          kind: 'session',
          reservationId: Number(row.reservationId),
          resourceId: Number(resourceId),
          resourceName: row.resourceName,
          date: session.date,
          startTime: session.start,
          endTime: session.end,
          turnoverMinutes: Number(row.turnoverMinutes || 0),
          propertyName: row.propertyName,
          displayName: [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Client',
          paid: false,
        });
      }
    }
    return out;
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

    const refusal = checkBookable({ resource, date, startTime, endTime });
    if (refusal) return refusal;

    const totalPrice = breakdownOf({ resource, startTime, endTime, propertyId, reservationId }).total;
    const result = database.prepare(
      'INSERT INTO resource_bookings (resourceId, reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes, totalPrice, paid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(resourceId, reservationId || null, clientId || null, clientName || null, clientPhone || null, propertyId || null, date, startTime, endTime, notes || '', totalPrice, paid ? 1 : 0);
    return { ok: true, id: result.lastInsertRowid, totalPrice, warning: totalWarning(payload.displayedTotal, totalPrice) };
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

    const refusal = checkBookable({ resource, date: newDate, startTime: newStart, endTime: newEnd, excludeId: id });
    if (refusal) return refusal;

    const nextPropertyId = propertyId !== undefined ? propertyId : existing.propertyId;
    const nextReservationId = reservationId !== undefined ? (reservationId || null) : existing.reservationId;
    const totalPrice = breakdownOf({ resource, startTime: newStart, endTime: newEnd, propertyId: nextPropertyId, reservationId: nextReservationId }).total;

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
    return { ok: true, totalPrice, warning: totalWarning(payload.displayedTotal, totalPrice) };
  }

  function remove(id) {
    const existing = database.prepare('SELECT id FROM resource_bookings WHERE id = ?').get(id);
    if (!existing) return { error: 'Non trouvée', status: 404 };
    database.prepare('DELETE FROM resource_bookings WHERE id = ?').run(id);
    return { ok: true };
  }

  return {
    priceBooking,
    checkBookable,
    minimumUsageMinutes,
    countConflicts,
    listPlanningEvents,
    getOccupiedSlots,
    listForResource,
    listReservationSessions,
    findById,
    createBooking,
    update,
    remove,
  };
}

module.exports = { create: createModel };
