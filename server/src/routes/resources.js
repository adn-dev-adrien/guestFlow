const router = require('express').Router();
const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

function overlapClause() {
  return 'r.startDate < ? AND r.endDate > ?';
}

function parseResource(resource) {
  if (!resource) return resource;
  let openDays = '[0,1,2,3,4,5,6]';
  if (resource.openDays) {
    openDays = resource.openDays;
  } else if (resource.closedDays) {
    try {
      const closed = JSON.parse(resource.closedDays || '[]');
      const full = [0, 1, 2, 3, 4, 5, 6];
      openDays = JSON.stringify(full.filter((d) => !closed.includes(d)));
    } catch {
      openDays = '[0,1,2,3,4,5,6]';
    }
  }
  return {
    ...resource,
    propertyIds: resource.propertyIds ? JSON.parse(resource.propertyIds) : [],
    isComplex: Boolean(resource.isComplex),
    slotDuration: Number(resource.slotDuration || 60),
    minimumUsageMinutes: Number(resource.minimumUsageMinutes || 0),
    openTime: resource.openTime || '08:00',
    closeTime: resource.closeTime || '22:00',
    openDays,
    turnoverMinutes: Number(resource.turnoverMinutes || 0),
  };
}

function getPropertyPriceMap(resourceId) {
  return db.prepare('SELECT propertyId, price FROM property_resource_prices WHERE resourceId = ? ORDER BY propertyId')
    .all(Number(resourceId))
    .reduce((acc, row) => {
      acc[String(row.propertyId)] = Number(row.price || 0);
      return acc;
    }, {});
}

function computeEffectiveResourcePrice(resource, propertyId) {
  const pid = Number(propertyId);
  if (!pid) return Number(resource.price || 0);
  const propertyPrices = resource.propertyPrices || getPropertyPriceMap(resource.id);
  const override = propertyPrices[String(pid)];
  if (override === undefined || override === null || Number.isNaN(Number(override))) {
    return Number(resource.price || 0);
  }
  return Number(override);
}

function isResourceApplicableToProperty(resource, propertyId) {
  if (!propertyId) return true;
  const ids = Array.isArray(resource.propertyIds)
    ? resource.propertyIds.map((id) => Number(id))
    : [];
  return ids.length === 0 || ids.includes(Number(propertyId));
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
  const resources = db.prepare('SELECT * FROM resources ORDER BY name').all()
    .map(parseResource)
    .filter((resource) => isResourceApplicableToProperty(resource, propertyId))
    .map((resource) => {
      const propertyPrices = getPropertyPriceMap(resource.id);
      const effectivePrice = computeEffectiveResourcePrice({ ...resource, propertyPrices }, propertyId);
      return {
        ...resource,
        basePrice: Number(resource.price || 0),
        price: effectivePrice,
        propertyPrices,
      };
    });
  res.json(resources);
});

// Resource availability for a date range
router.get('/availability', (req, res) => {
  const { propertyId, startDate, endDate, excludeReservationId } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate et endDate requis' });

  const resources = db.prepare('SELECT * FROM resources ORDER BY name').all()
    .map(parseResource)
    .filter((resource) => isResourceApplicableToProperty(resource, propertyId));

  const out = resources.map((resource) => {
    const info = computeAvailability(resource.id, startDate, endDate, excludeReservationId ? Number(excludeReservationId) : null);
    const propertyPrices = getPropertyPriceMap(resource.id);
    const effectivePrice = computeEffectiveResourcePrice({ ...resource, propertyPrices }, propertyId);
    return {
      ...resource,
      basePrice: Number(resource.price || 0),
      price: effectivePrice,
      propertyPrices,
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
  const parsed = parseResource(resource);
  res.json({
    ...parsed,
    basePrice: Number(parsed.price || 0),
    propertyPrices: getPropertyPriceMap(parsed.id),
  });
});

router.post('/', (req, res) => {
  const { name, quantity, price, priceType, propertyIds, propertyPrices, note, isComplex, slotDuration, minimumUsageMinutes, openTime, closeTime, openDays, turnoverMinutes } = req.body;
  const normalizedPropertyPrices = Object.entries(propertyPrices || {})
    .map(([pid, rawPrice]) => ({ propertyId: Number(pid), price: Number(rawPrice) }))
    .filter((line) => Number.isFinite(line.propertyId) && line.propertyId > 0 && Number.isFinite(line.price) && line.price >= 0);

  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO resources (name, quantity, price, priceType, propertyIds, note, isComplex, slotDuration, minimumUsageMinutes, openTime, closeTime, openDays, turnoverMinutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sentenceCase(name),
      Number(quantity) || 0,
      Number(price) || 0,
      priceType || 'per_stay',
      propertyIds ? JSON.stringify(propertyIds) : null,
      sentenceCase(note),
      isComplex ? 1 : 0,
      Number(slotDuration) || 60,
      Number(minimumUsageMinutes) || 0,
      openTime || '08:00',
      closeTime || '22:00',
      typeof openDays === 'string' ? openDays : JSON.stringify(openDays || [0, 1, 2, 3, 4, 5, 6]),
      Number(turnoverMinutes) || 0,
    );

    const resourceId = Number(result.lastInsertRowid);
    const insertPrice = db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (?, ?, ?)');
    normalizedPropertyPrices.forEach((line) => {
      insertPrice.run(line.propertyId, resourceId, line.price);
    });

    return resourceId;
  });

  const createdId = tx();
  res.json({ id: createdId });
});

router.put('/:id', (req, res) => {
  const { name, quantity, price, priceType, propertyIds, propertyPrices, note, isComplex, slotDuration, minimumUsageMinutes, openTime, closeTime, openDays, turnoverMinutes } = req.body;
  const resourceId = Number(req.params.id);
  const normalizedPropertyPrices = Object.entries(propertyPrices || {})
    .map(([pid, rawPrice]) => ({ propertyId: Number(pid), price: Number(rawPrice) }))
    .filter((line) => Number.isFinite(line.propertyId) && line.propertyId > 0 && Number.isFinite(line.price) && line.price >= 0);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE resources
      SET name = ?, quantity = ?, price = ?, priceType = ?, propertyIds = ?, note = ?, isComplex = ?, slotDuration = ?, minimumUsageMinutes = ?, openTime = ?, closeTime = ?, openDays = ?, turnoverMinutes = ?, updatedAt = datetime('now')
      WHERE id = ?
    `).run(
      sentenceCase(name),
      Number(quantity) || 0,
      Number(price) || 0,
      priceType || 'per_stay',
      propertyIds ? JSON.stringify(propertyIds) : null,
      sentenceCase(note),
      isComplex ? 1 : 0,
      Number(slotDuration) || 60,
      Number(minimumUsageMinutes) || 0,
      openTime || '08:00',
      closeTime || '22:00',
      typeof openDays === 'string' ? openDays : JSON.stringify(openDays || [0, 1, 2, 3, 4, 5, 6]),
      Number(turnoverMinutes) || 0,
      resourceId,
    );

    db.prepare('DELETE FROM property_resource_prices WHERE resourceId = ?').run(resourceId);
    const insertPrice = db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (?, ?, ?)');
    normalizedPropertyPrices.forEach((line) => {
      insertPrice.run(line.propertyId, resourceId, line.price);
    });
  });

  tx();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM resources WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
