const router = require('express').Router();
const db = require('../database');

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

function enrichBooking(b) {
  b.displayName = (b.firstName || b.lastName)
    ? [b.firstName, b.lastName].filter(Boolean).join(' ')
    : (b.clientName || 'Client externe');
  b.paid = Boolean(b.paid);
  return b;
}

const JOIN_QUERY = `
  SELECT rb.*,
    r.name AS resourceName, r.slotDuration, r.price AS resourcePrice, r.openTime, r.closeTime, r.turnoverMinutes, r.openDays,
    c.firstName, c.lastName,
    p.name AS propertyName
  FROM resource_bookings rb
  LEFT JOIN resources r ON rb.resourceId = r.id
  LEFT JOIN clients c ON rb.clientId = c.id
  LEFT JOIN properties p ON rb.propertyId = p.id
`;

// GET /resource-bookings/planning-events?from=&to=  (for PlanningPage bulk fetch)
// NOTE: this route must be declared BEFORE /:id to avoid conflict
router.get('/planning-events', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  const bookings = db.prepare(`${JOIN_QUERY} WHERE rb.date >= ? AND rb.date <= ? ORDER BY rb.date, rb.startTime`).all(from, to);
  res.json(bookings.map(enrichBooking));
});

// GET /resource-bookings/occupied-slots?resourceId=&date=
// Returns occupied time slots including turnover for a resource on a given date
// Format: { occupiedSlots: [{ startTime, endTime, description }] }
router.get('/occupied-slots', (req, res) => {
  const { resourceId, date } = req.query;
  if (!resourceId || !date) return res.status(400).json({ error: 'resourceId and date required' });
  
  const bookings = db.prepare(`
    SELECT rb.id, rb.startTime, rb.endTime, rb.clientName, r.turnoverMinutes, c.firstName, c.lastName
    FROM resource_bookings rb
    LEFT JOIN resources r ON rb.resourceId = r.id
    LEFT JOIN clients c ON rb.clientId = c.id
    WHERE rb.resourceId = ? AND rb.date = ?
    ORDER BY rb.startTime
  `).all(resourceId, date);

  const occupiedSlots = bookings.map(b => {
    const clientDisplay = [b.firstName, b.lastName].filter(Boolean).join(' ') || b.clientName || 'Client externe';
    const turnover = Number(b.turnoverMinutes || 0);
    return {
      id: b.id,
      startTime: b.startTime,
      endTime: b.endTime,
      turnover,
      description: clientDisplay,
    };
  });

  res.json({ occupiedSlots });
});

// GET /resource-bookings?resourceId=&date= OR ?resourceId=&weekStart=
router.get('/', (req, res) => {
  const { resourceId, date, weekStart } = req.query;
  if (!resourceId) return res.status(400).json({ error: 'resourceId required' });
  let bookings;
  if (weekStart) {
    const endDate = addDays(weekStart, 7);
    bookings = db.prepare(`${JOIN_QUERY} WHERE rb.resourceId = ? AND rb.date >= ? AND rb.date < ? ORDER BY rb.date, rb.startTime`).all(resourceId, weekStart, endDate);
  } else if (date) {
    bookings = db.prepare(`${JOIN_QUERY} WHERE rb.resourceId = ? AND rb.date = ? ORDER BY rb.startTime`).all(resourceId, date);
  } else {
    return res.status(400).json({ error: 'date or weekStart required' });
  }
  res.json(bookings.map(enrichBooking));
});

// GET /resource-bookings/:id
router.get('/:id', (req, res) => {
  const booking = db.prepare(`${JOIN_QUERY} WHERE rb.id = ?`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Non trouvée' });
  res.json(enrichBooking(booking));
});

// POST /resource-bookings
router.post('/', (req, res) => {
  const { resourceId, reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes, totalPrice, paid } = req.body;
  if (!resourceId || !date || !startTime || !endTime) {
    return res.status(400).json({ error: 'resourceId, date, startTime, endTime sont requis' });
  }
  const resource = db.prepare('SELECT quantity, turnoverMinutes, priceType, minimumUsageMinutes, slotDuration, isComplex FROM resources WHERE id = ?').get(resourceId);
  if (!resource) return res.status(404).json({ error: 'Ressource non trouvée' });

  const bookingDuration = Math.max(0, toMinutes(endTime) - toMinutes(startTime));
  const minimumUsageMinutes = resource.priceType === 'per_hour'
    ? Math.max(Number(resource.minimumUsageMinutes || 0), resource.isComplex ? Number(resource.slotDuration || 0) : 0)
    : (resource.isComplex ? Number(resource.slotDuration || 0) : 0);
  if (minimumUsageMinutes > 0 && bookingDuration < minimumUsageMinutes) {
    return res.status(400).json({ error: `Durée minimale ${minimumUsageMinutes} min requise` });
  }

  const turnover = Number(resource.turnoverMinutes || 0);
  const { cnt } = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM resource_bookings rb
    WHERE rb.resourceId = ?
      AND rb.date = ?
      AND rb.startTime < strftime('%H:%M', ?, '+' || ? || ' minutes')
      AND strftime('%H:%M', rb.endTime, '+' || ? || ' minutes') > ?
  `).get(resourceId, date, endTime, turnover, turnover, startTime);
  if (cnt >= resource.quantity) return res.status(409).json({ error: 'Créneau non disponible (capacité atteinte)' });

  const result = db.prepare(
    'INSERT INTO resource_bookings (resourceId, reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes, totalPrice, paid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(resourceId, reservationId || null, clientId || null, clientName || null, clientPhone || null, propertyId || null, date, startTime, endTime, notes || '', totalPrice || 0, paid ? 1 : 0);

  res.json({ id: result.lastInsertRowid });
});

// PUT /resource-bookings/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Réservation non trouvée' });

  const { reservationId, clientId, clientName, clientPhone, propertyId, date, startTime, endTime, notes, totalPrice, paid } = req.body;
  const newDate = date !== undefined ? date : existing.date;
  const newStart = startTime !== undefined ? startTime : existing.startTime;
  const newEnd = endTime !== undefined ? endTime : existing.endTime;

  const resource = db.prepare('SELECT quantity, turnoverMinutes, priceType, minimumUsageMinutes, slotDuration, isComplex FROM resources WHERE id = ?').get(existing.resourceId);
  if (!resource) return res.status(404).json({ error: 'Ressource non trouvée' });

  const bookingDuration = Math.max(0, toMinutes(newEnd) - toMinutes(newStart));
  const minimumUsageMinutes = resource.priceType === 'per_hour'
    ? Math.max(Number(resource.minimumUsageMinutes || 0), resource.isComplex ? Number(resource.slotDuration || 0) : 0)
    : (resource.isComplex ? Number(resource.slotDuration || 0) : 0);
  if (minimumUsageMinutes > 0 && bookingDuration < minimumUsageMinutes) {
    return res.status(400).json({ error: `Durée minimale ${minimumUsageMinutes} min requise` });
  }

  const turnover = Number(resource.turnoverMinutes || 0);
  const { cnt } = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM resource_bookings rb
    WHERE rb.resourceId = ?
      AND rb.date = ?
        AND rb.startTime < strftime('%H:%M', ?, '+' || ? || ' minutes')
        AND strftime('%H:%M', rb.endTime, '+' || ? || ' minutes') > ?
      AND rb.id != ?
  `).get(existing.resourceId, newDate, newEnd, turnover, turnover, newStart, req.params.id);
  if (cnt >= resource.quantity) return res.status(409).json({ error: 'Créneau non disponible (capacité atteinte)' });

  db.prepare(
    "UPDATE resource_bookings SET reservationId=?,clientId=?,clientName=?,clientPhone=?,propertyId=?,date=?,startTime=?,endTime=?,notes=?,totalPrice=?,paid=?,updatedAt=datetime('now') WHERE id=?"
  ).run(
    reservationId !== undefined ? (reservationId || null) : existing.reservationId,
    clientId !== undefined ? (clientId || null) : existing.clientId,
    clientName !== undefined ? (clientName || null) : existing.clientName,
    clientPhone !== undefined ? (clientPhone || null) : existing.clientPhone,
    propertyId !== undefined ? (propertyId || null) : existing.propertyId,
    newDate, newStart, newEnd,
    notes !== undefined ? notes : existing.notes,
    totalPrice !== undefined ? totalPrice : existing.totalPrice,
    paid !== undefined ? (paid ? 1 : 0) : existing.paid,
    req.params.id,
  );
  res.json({ ok: true });
});

// DELETE /resource-bookings/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM resource_bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Non trouvée' });
  db.prepare('DELETE FROM resource_bookings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
