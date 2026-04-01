const router = require('express').Router();
const db = require('../database');

function overlapClause() {
  return 'r.startDate < ? AND r.endDate > ?';
}

function computeAvailability(resourceId, startDate, endDate, excludeReservationId = null) {
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  if (!resource) return null;

  let sql = `
    SELECT COALESCE(SUM(rr.quantity), 0) as reserved
    FROM reservation_resources rr
    JOIN reservations r ON r.id = rr.reservationId
    WHERE rr.resourceId = ?
      AND ${overlapClause()}
  `;
  const params = [resourceId, endDate, startDate];
  if (excludeReservationId) {
    sql += ' AND rr.reservationId != ?';
    params.push(excludeReservationId);
  }
  const reserved = db.prepare(sql).get(...params)?.reserved || 0;
  return {
    resource,
    reserved,
    available: Math.max(0, Number(resource.quantity) - Number(reserved)),
  };
}

// List resources (global + optional property filtering)
router.get('/', (req, res) => {
  const { propertyId } = req.query;
  let sql = 'SELECT * FROM resources';
  const params = [];
  if (propertyId) {
    sql += ' WHERE propertyId IS NULL OR propertyId = ?';
    params.push(propertyId);
  }
  sql += ' ORDER BY name';
  const resources = db.prepare(sql).all(...params);
  res.json(resources);
});

// Resource availability for a date range
router.get('/availability', (req, res) => {
  const { propertyId, startDate, endDate, excludeReservationId } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate et endDate requis' });

  let sql = 'SELECT * FROM resources';
  const params = [];
  if (propertyId) {
    sql += ' WHERE propertyId IS NULL OR propertyId = ?';
    params.push(propertyId);
  }
  sql += ' ORDER BY name';
  const resources = db.prepare(sql).all(...params);

  const out = resources.map((resource) => {
    const info = computeAvailability(resource.id, startDate, endDate, excludeReservationId ? Number(excludeReservationId) : null);
    return {
      ...resource,
      reserved: info.reserved,
      available: info.available,
      unavailable: info.available <= 0,
    };
  });

  res.json(out);
});

// Dedicated availability endpoint for baby beds managed via reservations.babyBeds
router.get('/baby-bed-availability', (req, res) => {
  const { propertyId, startDate, endDate, excludeReservationId } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate et endDate requis' });

  const resources = db.prepare(`
    SELECT * FROM resources
    WHERE (lower(name) = lower('Lit bébé') OR lower(name) = lower('Lit bebe'))
      AND (propertyId IS NULL OR propertyId = ?)
  `).all(propertyId || null);

  const totalQuantity = resources.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
  const hasGlobal = resources.some(r => r.propertyId === null);

  let sql = `
    SELECT COALESCE(SUM(COALESCE(babyBeds, 0)), 0) as reserved
    FROM reservations
    WHERE startDate < ? AND endDate > ?
  `;
  const params = [endDate, startDate];
  if (!hasGlobal && propertyId) {
    sql += ' AND propertyId = ?';
    params.push(propertyId);
  }
  if (excludeReservationId) {
    sql += ' AND id != ?';
    params.push(Number(excludeReservationId));
  }

  const reserved = db.prepare(sql).get(...params)?.reserved || 0;
  const available = Math.max(0, Number(totalQuantity) - Number(reserved));

  res.json({ totalQuantity, reserved, available });
});

router.get('/:id', (req, res) => {
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Ressource non trouvée' });
  res.json(resource);
});

router.post('/', (req, res) => {
  const { name, quantity, price, priceType, propertyId, note } = req.body;
  const result = db.prepare(`
    INSERT INTO resources (name, quantity, price, priceType, propertyId, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, Number(quantity) || 0, Number(price) || 0, priceType || 'per_stay', propertyId || null, note || '');
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { name, quantity, price, priceType, propertyId, note } = req.body;
  db.prepare(`
    UPDATE resources
    SET name = ?, quantity = ?, price = ?, priceType = ?, propertyId = ?, note = ?, updatedAt = datetime('now')
    WHERE id = ?
  `).run(name, Number(quantity) || 0, Number(price) || 0, priceType || 'per_stay', propertyId || null, note || '', req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM resources WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
