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

// Create reservation
router.post('/', (req, res) => {
  const {
    propertyId, clientId, startDate, endDate, adults, children, babies,
    checkInTime, checkOutTime,
    platform, totalPrice, discountPercent, finalPrice,
    depositAmount, depositDueDate, balanceAmount, balanceDueDate, notes,
    options: reservationOptions
  } = req.body;

  const result = db.prepare(`
    INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, children, babies,
      checkInTime, checkOutTime,
      platform, totalPrice, discountPercent, finalPrice, depositAmount, depositDueDate,
      balanceAmount, balanceDueDate, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    propertyId, clientId, startDate, endDate, adults || 1, children || 0, babies || 0,
    checkInTime || '15:00', checkOutTime || '10:00',
    platform || 'direct', totalPrice, discountPercent || 0, finalPrice,
    depositAmount || 0, depositDueDate || null, balanceAmount || 0, balanceDueDate || null, notes || ''
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
    checkInTime, checkOutTime,
    platform, totalPrice, discountPercent, finalPrice,
    depositAmount, depositDueDate, depositPaid, balanceAmount, balanceDueDate, balancePaid, notes,
    options: reservationOptions
  } = req.body;

  db.prepare(`
    UPDATE reservations SET propertyId=?, clientId=?, startDate=?, endDate=?, adults=?, children=?, babies=?,
      checkInTime=?, checkOutTime=?,
      platform=?, totalPrice=?, discountPercent=?, finalPrice=?, depositAmount=?, depositDueDate=?,
      depositPaid=?, balanceAmount=?, balanceDueDate=?, balancePaid=?, notes=?, updatedAt=datetime('now')
    WHERE id=?
  `).run(
    propertyId, clientId, startDate, endDate, adults || 1, children || 0, babies || 0,
    checkInTime || '15:00', checkOutTime || '10:00',
    platform || 'direct', totalPrice, discountPercent || 0, finalPrice,
    depositAmount || 0, depositDueDate || null, depositPaid ? 1 : 0,
    balanceAmount || 0, balanceDueDate || null, balancePaid ? 1 : 0, notes || '',
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

// Mark deposit/balance as paid
router.patch('/:id/payment', (req, res) => {
  const { depositPaid, balancePaid } = req.body;
  if (depositPaid !== undefined) {
    db.prepare('UPDATE reservations SET depositPaid = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(depositPaid ? 1 : 0, req.params.id);
  }
  if (balancePaid !== undefined) {
    db.prepare('UPDATE reservations SET balancePaid = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(balancePaid ? 1 : 0, req.params.id);
  }
  res.json({ ok: true });
});

// Delete reservation
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reservations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
