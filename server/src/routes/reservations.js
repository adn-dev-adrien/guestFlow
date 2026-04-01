const router = require('express').Router();
const db = require('../database');

// List reservations (optionally filter by propertyId, date range)
router.get('/', (req, res) => {
  const { propertyId, from, to } = req.query;
  let sql = `
    SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    WHERE 1=1
  `;
  const params = [];
  if (propertyId) { sql += ' AND r.propertyId = ?'; params.push(propertyId); }
  if (from) { sql += ' AND r.endDate >= ?'; params.push(from); }
  if (to) { sql += ' AND r.startDate <= ?'; params.push(to); }
  sql += ' ORDER BY r.startDate';
  const reservations = db.prepare(sql).all(...params);
  res.json(reservations);
});

// Get single reservation with options
router.get('/:id', (req, res) => {
  const reservation = db.prepare(`
    SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });

  reservation.options = db.prepare(`
    SELECT ro.*, o.title, o.description, o.priceType, o.price as unitPrice
    FROM reservation_options ro
    JOIN options o ON ro.optionId = o.id
    WHERE ro.reservationId = ?
  `).all(req.params.id);

  res.json(reservation);
});

// Calculate price for a potential reservation
router.post('/calculate-price', (req, res) => {
  const { propertyId, startDate, endDate, adults, children } = req.body;
  const rules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(propertyId);
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!property) return res.status(404).json({ error: 'Logement non trouvé' });

  const start = new Date(startDate);
  const end = new Date(endDate);
  const nights = Math.round((end - start) / (1000 * 60 * 60 * 24));
  if (nights <= 0) return res.json({ totalPrice: 0, nights: 0 });

  let totalPrice = 0;
  const current = new Date(start);
  for (let i = 0; i < nights; i++) {
    const dateStr = current.toISOString().split('T')[0];
    // Find matching seasonal rule
    let priceForNight = 100; // fallback
    for (const rule of rules) {
      if (rule.startDate && rule.endDate) {
        if (dateStr >= rule.startDate && dateStr <= rule.endDate) {
          priceForNight = rule.pricePerNight;
          break;
        }
      } else {
        priceForNight = rule.pricePerNight; // default rule (no date range)
      }
    }
    totalPrice += priceForNight;
    current.setDate(current.getDate() + 1);
  }

  // Deposit calculation
  const depositAmount = Math.round(totalPrice * (property.depositPercent / 100) * 100) / 100;
  const depositDueDate = new Date(start);
  depositDueDate.setDate(depositDueDate.getDate() - property.depositDaysBefore);
  const balanceDueDate = new Date(start);
  balanceDueDate.setDate(balanceDueDate.getDate() - property.balanceDaysBefore);

  res.json({
    nights,
    totalPrice,
    depositAmount,
    balanceAmount: Math.round((totalPrice - depositAmount) * 100) / 100,
    depositDueDate: depositDueDate.toISOString().split('T')[0],
    balanceDueDate: balanceDueDate.toISOString().split('T')[0],
    defaultCheckIn: property.defaultCheckIn || '15:00',
    defaultCheckOut: property.defaultCheckOut || '10:00'
  });
});

// Helper to parse time string to decimal hours
function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

// Shared validation for create and update
// excludeId: reservation ID to exclude (for updates)
function validateReservation(propertyId, startDate, endDate, checkInTime, checkOutTime, excludeId) {
  const property = db.prepare('SELECT cleaningHours FROM properties WHERE id = ?').get(propertyId);
  const cleaning = property ? (property.cleaningHours ?? 3) : 3;

  // Reject past start dates
  const today = new Date().toISOString().split('T')[0];
  if (startDate < today) {
    return { error: 'Impossible de réserver dans le passé.' };
  }

  // Strict overlap: reservations whose date range overlaps (excluding same-day turnover)
  let overlapSql = 'SELECT id FROM reservations WHERE propertyId = ? AND startDate < ? AND endDate > ?';
  const overlapParams = [propertyId, endDate, startDate];
  if (excludeId) {
    overlapSql += ' AND id != ?';
    overlapParams.push(excludeId);
  }
  const strictOverlaps = db.prepare(overlapSql).all(...overlapParams);
  if (strictOverlaps.length > 0) {
    return { error: 'Ce logement est déjà réservé pour ces dates.' };
  }

  // Turnover at start: existing reservation ending on our start date
  let prevSql = 'SELECT checkOutTime FROM reservations WHERE propertyId = ? AND endDate = ?';
  const prevParams = [propertyId, startDate];
  if (excludeId) { prevSql += ' AND id != ?'; prevParams.push(excludeId); }
  const prevRes = db.prepare(prevSql).get(...prevParams);
  if (prevRes) {
    const prevCheckOut = timeToHour(prevRes.checkOutTime || '10:00');
    const newCheckIn = timeToHour(checkInTime || '15:00');
    if (newCheckIn < prevCheckOut + cleaning) {
      const availH = String(Math.floor(prevCheckOut + cleaning)).padStart(2, '0');
      const availM = (prevCheckOut + cleaning) % 1 >= 0.5 ? '30' : '00';
      return {
        error: `Arrivée impossible à ${checkInTime || '15:00'}. Le logement n'est disponible qu'à partir de ${availH}:${availM} (départ ${prevRes.checkOutTime || '10:00'} + ${cleaning}h ménage).`
      };
    }
  }

  // Turnover at end: existing reservation starting on our end date
  let nextSql = 'SELECT checkInTime FROM reservations WHERE propertyId = ? AND startDate = ?';
  const nextParams = [propertyId, endDate];
  if (excludeId) { nextSql += ' AND id != ?'; nextParams.push(excludeId); }
  const nextRes = db.prepare(nextSql).get(...nextParams);
  if (nextRes) {
    const newCheckOut = timeToHour(checkOutTime || '10:00');
    const nextCheckIn = timeToHour(nextRes.checkInTime || '15:00');
    if (newCheckOut + cleaning > nextCheckIn) {
      const maxCheckOut = nextCheckIn - cleaning;
      const maxH = String(Math.floor(maxCheckOut)).padStart(2, '0');
      const maxM = maxCheckOut % 1 >= 0.5 ? '30' : '00';
      return {
        error: `Départ à ${checkOutTime || '10:00'} + ${cleaning}h de ménage empêche l'arrivée du client suivant à ${nextRes.checkInTime || '15:00'}. L'heure de départ maximale est ${maxH}:${maxM}.`
      };
    }
  }

  return null; // no error
}

// Create reservation
router.post('/', (req, res) => {
  const {
    propertyId, clientId, startDate, endDate, adults, children, babies,
    singleBeds, doubleBeds, babyBeds,
    checkInTime, checkOutTime,
    platform, totalPrice, discountPercent, finalPrice,
    depositAmount, depositDueDate, balanceAmount, balanceDueDate, notes,
    cautionAmount,
    options: reservationOptions
  } = req.body;

  const validationError = validateReservation(propertyId, startDate, endDate, checkInTime, checkOutTime, null);
  if (validationError) {
    return res.status(409).json(validationError);
  }

  const property = db.prepare('SELECT singleBeds, doubleBeds FROM properties WHERE id = ?').get(propertyId);
  if (property) {
    if (singleBeds !== null && singleBeds !== undefined && singleBeds !== '' && Number(singleBeds) > Number(property.singleBeds || 0)) {
      return res.status(400).json({ error: `Le nombre de lits simples (${singleBeds}) dépasse la capacité du logement (${property.singleBeds || 0}).` });
    }
    if (doubleBeds !== null && doubleBeds !== undefined && doubleBeds !== '' && Number(doubleBeds) > Number(property.doubleBeds || 0)) {
      return res.status(400).json({ error: `Le nombre de lits doubles (${doubleBeds}) dépasse la capacité du logement (${property.doubleBeds || 0}).` });
    }
  }

  const result = db.prepare(`
    INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, children, babies,
      singleBeds, doubleBeds, babyBeds,
      checkInTime, checkOutTime,
      platform, totalPrice, discountPercent, finalPrice, depositAmount, depositDueDate,
      balanceAmount, balanceDueDate, notes, cautionAmount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    propertyId, clientId, startDate, endDate, adults || 1, children || 0, babies || 0,
    singleBeds ?? null, doubleBeds ?? null, babyBeds ?? null,
    checkInTime || '15:00', checkOutTime || '10:00',
    platform || 'direct', totalPrice, discountPercent || 0, finalPrice,
    depositAmount || 0, depositDueDate || null, balanceAmount || 0, balanceDueDate || null, notes || '',
    cautionAmount || 0
  );

  const reservationId = result.lastInsertRowid;

  // Insert reservation options
  if (reservationOptions && reservationOptions.length > 0) {
    const insertOpt = db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (?, ?, ?, ?)');
    for (const opt of reservationOptions) {
      insertOpt.run(reservationId, opt.optionId, opt.quantity || 1, opt.totalPrice || 0);
    }
  }

  res.json({ id: reservationId });
});

// Update reservation
router.put('/:id', (req, res) => {
  const {
    propertyId, clientId, startDate, endDate, adults, children, babies,
    singleBeds, doubleBeds, babyBeds,
    checkInTime, checkOutTime,
    platform, totalPrice, discountPercent, finalPrice,
    depositAmount, depositDueDate, depositPaid, balanceAmount, balanceDueDate, balancePaid, notes,
    cautionAmount, cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate,
    options: reservationOptions
  } = req.body;

  const validationError = validateReservation(propertyId, startDate, endDate, checkInTime, checkOutTime, Number(req.params.id));
  if (validationError) {
    return res.status(409).json(validationError);
  }

  const property = db.prepare('SELECT singleBeds, doubleBeds FROM properties WHERE id = ?').get(propertyId);
  if (property) {
    if (singleBeds !== null && singleBeds !== undefined && singleBeds !== '' && Number(singleBeds) > Number(property.singleBeds || 0)) {
      return res.status(400).json({ error: `Le nombre de lits simples (${singleBeds}) dépasse la capacité du logement (${property.singleBeds || 0}).` });
    }
    if (doubleBeds !== null && doubleBeds !== undefined && doubleBeds !== '' && Number(doubleBeds) > Number(property.doubleBeds || 0)) {
      return res.status(400).json({ error: `Le nombre de lits doubles (${doubleBeds}) dépasse la capacité du logement (${property.doubleBeds || 0}).` });
    }
  }

  db.prepare(`
    UPDATE reservations SET propertyId=?, clientId=?, startDate=?, endDate=?, adults=?, children=?, babies=?,
      singleBeds=?, doubleBeds=?, babyBeds=?,
      checkInTime=?, checkOutTime=?,
      platform=?, totalPrice=?, discountPercent=?, finalPrice=?, depositAmount=?, depositDueDate=?,
      depositPaid=?, balanceAmount=?, balanceDueDate=?, balancePaid=?, notes=?,
      cautionAmount=?, cautionReceived=?, cautionReceivedDate=?, cautionReturned=?, cautionReturnedDate=?,
      updatedAt=datetime('now')
    WHERE id=?
  `).run(
    propertyId, clientId, startDate, endDate, adults || 1, children || 0, babies || 0,
    singleBeds ?? null, doubleBeds ?? null, babyBeds ?? null,
    checkInTime || '15:00', checkOutTime || '10:00',
    platform || 'direct', totalPrice, discountPercent || 0, finalPrice,
    depositAmount || 0, depositDueDate || null, depositPaid ? 1 : 0,
    balanceAmount || 0, balanceDueDate || null, balancePaid ? 1 : 0, notes || '',
    cautionAmount || 0, cautionReceived ? 1 : 0, cautionReceivedDate || null,
    cautionReturned ? 1 : 0, cautionReturnedDate || null,
    req.params.id
  );

  // Rebuild reservation options
  if (reservationOptions) {
    db.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(req.params.id);
    const insertOpt = db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (?, ?, ?, ?)');
    for (const opt of reservationOptions) {
      insertOpt.run(req.params.id, opt.optionId, opt.quantity || 1, opt.totalPrice || 0);
    }
  }

  res.json({ ok: true });
});

// Mark deposit/balance/caution as paid
router.patch('/:id/payment', (req, res) => {
  const { depositPaid, balancePaid, cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate } = req.body;
  if (depositPaid !== undefined) {
    db.prepare('UPDATE reservations SET depositPaid = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(depositPaid ? 1 : 0, req.params.id);
  }
  if (balancePaid !== undefined) {
    db.prepare('UPDATE reservations SET balancePaid = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(balancePaid ? 1 : 0, req.params.id);
  }
  if (cautionReceived !== undefined) {
    const date = cautionReceivedDate || (cautionReceived ? new Date().toISOString().split('T')[0] : null);
    db.prepare('UPDATE reservations SET cautionReceived = ?, cautionReceivedDate = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(cautionReceived ? 1 : 0, date, req.params.id);
  }
  if (cautionReturned !== undefined) {
    const date = cautionReturnedDate || (cautionReturned ? new Date().toISOString().split('T')[0] : null);
    db.prepare('UPDATE reservations SET cautionReturned = ?, cautionReturnedDate = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(cautionReturned ? 1 : 0, date, req.params.id);
  }
  res.json({ ok: true });
});

// Delete reservation
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reservations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
