/**
 * Resources model — sole DB access for `resources`, the `resource_properties` applicability pivot and
 * the `property_resource_prices` override pivot. Encapsulates parsing, applicability, effective
 * price/freeMinutes resolution, availability, baby-bed availability, CRUD and deletion impact.
 *
 * Exports a default model bound to the production database, and a `create(db)` factory for tests.
 */

const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

const DEFAULT_OPEN_DAYS = '[0,1,2,3,4,5,6]';
const OVERLAP = 'r.startDate < ? AND r.endDate > ?';

function createModel(database) {
  function getPropertyIds(resourceId) {
    return database.prepare('SELECT propertyId FROM resource_properties WHERE resourceId = ? ORDER BY propertyId')
      .all(Number(resourceId))
      .map((row) => Number(row.propertyId));
  }

  function getPropertyPricingMap(resourceId) {
    return database.prepare('SELECT propertyId, price, freeMinutes FROM property_resource_prices WHERE resourceId = ? ORDER BY propertyId')
      .all(Number(resourceId))
      .reduce((acc, row) => {
        acc[String(row.propertyId)] = {
          price: Number(row.price || 0),
          freeMinutes: Math.max(0, Number(row.freeMinutes || 0)),
        };
        return acc;
      }, {});
  }

  function parseResource(resource) {
    if (!resource) return resource;
    let openDays = DEFAULT_OPEN_DAYS;
    if (resource.openDays) {
      openDays = resource.openDays;
    } else if (resource.closedDays) {
      try {
        const closed = JSON.parse(resource.closedDays || '[]');
        openDays = JSON.stringify([0, 1, 2, 3, 4, 5, 6].filter((d) => !closed.includes(d)));
      } catch {
        openDays = DEFAULT_OPEN_DAYS;
      }
    }
    return {
      ...resource,
      propertyIds: getPropertyIds(resource.id),
      isComplex: Boolean(resource.isComplex),
      slotDuration: Number(resource.slotDuration || 60),
      minimumUsageMinutes: Number(resource.minimumUsageMinutes || 0),
      openTime: resource.openTime || '08:00',
      closeTime: resource.closeTime || '22:00',
      openDays,
      turnoverMinutes: Number(resource.turnoverMinutes || 0),
    };
  }

  function effectivePrice(resource, pricingMap, propertyId) {
    const pid = Number(propertyId);
    if (!pid) return Number(resource.price || 0);
    const override = pricingMap[String(pid)]?.price;
    if (override === undefined || override === null || Number.isNaN(Number(override))) {
      return Number(resource.price || 0);
    }
    return Number(override);
  }

  function effectiveFreeMinutes(pricingMap, propertyId) {
    const pid = Number(propertyId);
    if (!pid) return 0;
    return Math.max(0, Number(pricingMap[String(pid)]?.freeMinutes || 0));
  }

  // Adds basePrice / effective price / freeMinutes / propertyPricing / propertyPrices to a parsed resource.
  function shape(resource, propertyId) {
    const propertyPricing = getPropertyPricingMap(resource.id);
    return {
      ...resource,
      basePrice: Number(resource.price || 0),
      price: effectivePrice(resource, propertyPricing, propertyId),
      freeMinutes: effectiveFreeMinutes(propertyPricing, propertyId),
      propertyPricing,
      propertyPrices: Object.entries(propertyPricing).reduce((acc, [pid, cfg]) => {
        acc[pid] = Number(cfg.price || 0);
        return acc;
      }, {}),
    };
  }

  function isApplicable(resource, propertyId) {
    if (!propertyId) return true;
    const ids = Array.isArray(resource.propertyIds) ? resource.propertyIds.map(Number) : [];
    return ids.length === 0 || ids.includes(Number(propertyId));
  }

  function list(propertyId) {
    return database.prepare('SELECT * FROM resources ORDER BY name').all()
      .map(parseResource)
      .filter((r) => isApplicable(r, propertyId))
      .map((r) => shape(r, propertyId));
  }

  function computeAvailability(resourceId, startDate, endDate, excludeReservationId) {
    const resource = database.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    if (!resource) return null;
    let sql = `
      SELECT COALESCE(SUM(rr.quantity), 0) as reserved
      FROM reservation_resources rr
      JOIN reservations r ON r.id = rr.reservationId
      WHERE rr.resourceId = ? AND ${OVERLAP}
    `;
    const params = [resourceId, endDate, startDate];
    if (excludeReservationId) {
      sql += ' AND rr.reservationId != ?';
      params.push(excludeReservationId);
    }
    const reserved = database.prepare(sql).get(...params)?.reserved || 0;
    return { resource, reserved, available: Math.max(0, Number(resource.quantity) - Number(reserved)) };
  }

  function availability(propertyId, startDate, endDate, excludeReservationId) {
    return database.prepare('SELECT * FROM resources ORDER BY name').all()
      .map(parseResource)
      .filter((r) => isApplicable(r, propertyId))
      .map((r) => {
        const info = computeAvailability(r.id, startDate, endDate, excludeReservationId ? Number(excludeReservationId) : null);
        return {
          ...shape(r, propertyId),
          reserved: info.reserved,
          available: info.available,
          unavailable: info.available <= 0,
        };
      });
  }

  function getBabyBedAvailability(propertyId, startDate, endDate, excludeReservationId) {
    const allBabyBeds = database.prepare(`
      SELECT * FROM resources
      WHERE lower(name) = lower('Lit bébé') OR lower(name) = lower('Lit bebe')
    `).all();
    const propertyIdNum = propertyId != null && propertyId !== '' ? Number(propertyId) : null;
    const resources = allBabyBeds
      .map((r) => ({ ...r, scopedIds: getPropertyIds(r.id) }))
      .filter((r) => r.scopedIds.length === 0 || (propertyIdNum != null && r.scopedIds.includes(propertyIdNum)));

    const totalQuantity = resources.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const hasGlobal = resources.some((r) => r.scopedIds.length === 0);

    let sql = 'SELECT COALESCE(SUM(COALESCE(babyBeds, 0)), 0) as reserved FROM reservations WHERE startDate < ? AND endDate > ?';
    const params = [endDate, startDate];
    if (!hasGlobal && propertyId) { sql += ' AND propertyId = ?'; params.push(propertyId); }
    if (excludeReservationId) { sql += ' AND id != ?'; params.push(Number(excludeReservationId)); }

    const reserved = database.prepare(sql).get(...params)?.reserved || 0;
    return { totalQuantity, reserved, available: Math.max(0, Number(totalQuantity) - Number(reserved)) };
  }

  function findById(id) {
    const resource = database.prepare('SELECT * FROM resources WHERE id = ?').get(Number(id));
    if (!resource) return null;
    const parsed = parseResource(resource);
    const propertyPricing = getPropertyPricingMap(parsed.id);
    return {
      ...parsed,
      basePrice: Number(parsed.price || 0),
      propertyPricing,
      propertyPrices: Object.entries(propertyPricing).reduce((acc, [pid, cfg]) => {
        acc[pid] = Number(cfg.price || 0);
        return acc;
      }, {}),
    };
  }

  function normalizePricing(payload) {
    const raw = payload.propertyPricing && typeof payload.propertyPricing === 'object'
      ? Object.entries(payload.propertyPricing).map(([pid, cfg]) => ({ propertyId: Number(pid), price: Number(cfg?.price), freeMinutes: Number(cfg?.freeMinutes || 0) }))
      : Object.entries(payload.propertyPrices || {}).map(([pid, rawPrice]) => ({ propertyId: Number(pid), price: Number(rawPrice), freeMinutes: 0 }));
    return raw
      .filter((line) => Number.isFinite(line.propertyId) && line.propertyId > 0 && Number.isFinite(line.price) && line.price >= 0)
      .map((line) => ({
        propertyId: Number(line.propertyId),
        price: Number(line.price),
        freeMinutes: Math.max(0, Math.round(Number(line.freeMinutes || 0))),
      }));
  }

  function normalizePropertyIds(payload) {
    return Array.isArray(payload.propertyIds)
      ? Array.from(new Set(payload.propertyIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)))
      : [];
  }

  function writePivots(resourceId, propertyIds, pricing) {
    database.prepare('DELETE FROM resource_properties WHERE resourceId = ?').run(resourceId);
    const insApp = database.prepare('INSERT OR IGNORE INTO resource_properties (resourceId, propertyId) VALUES (?, ?)');
    propertyIds.forEach((pid) => insApp.run(resourceId, pid));

    database.prepare('DELETE FROM property_resource_prices WHERE resourceId = ?').run(resourceId);
    const insPrice = database.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (?, ?, ?, ?)');
    pricing.forEach((line) => insPrice.run(line.propertyId, resourceId, line.price, line.freeMinutes));
  }

  function columnsFromPayload(payload) {
    return {
      name: sentenceCase(payload.name),
      quantity: Number(payload.quantity) || 0,
      price: Number(payload.price) || 0,
      priceType: payload.priceType || 'per_stay',
      note: sentenceCase(payload.note),
      isComplex: payload.isComplex ? 1 : 0,
      slotDuration: Number(payload.slotDuration) || 60,
      minimumUsageMinutes: Number(payload.minimumUsageMinutes) || 0,
      openTime: payload.openTime || '08:00',
      closeTime: payload.closeTime || '22:00',
      openDays: typeof payload.openDays === 'string' ? payload.openDays : JSON.stringify(payload.openDays || [0, 1, 2, 3, 4, 5, 6]),
      turnoverMinutes: Number(payload.turnoverMinutes) || 0,
    };
  }

  function insert(payload) {
    const cols = columnsFromPayload(payload);
    const propertyIds = normalizePropertyIds(payload);
    const pricing = normalizePricing(payload);
    const tx = database.transaction(() => {
      const result = database.prepare(`
        INSERT INTO resources (name, quantity, price, priceType, note, isComplex, slotDuration, minimumUsageMinutes, openTime, closeTime, openDays, turnoverMinutes)
        VALUES (@name, @quantity, @price, @priceType, @note, @isComplex, @slotDuration, @minimumUsageMinutes, @openTime, @closeTime, @openDays, @turnoverMinutes)
      `).run(cols);
      const resourceId = Number(result.lastInsertRowid);
      writePivots(resourceId, propertyIds, pricing);
      return resourceId;
    });
    return tx();
  }

  function update(id, payload) {
    const cols = columnsFromPayload(payload);
    const resourceId = Number(id);
    const propertyIds = normalizePropertyIds(payload);
    const pricing = normalizePricing(payload);
    const tx = database.transaction(() => {
      database.prepare(`
        UPDATE resources
        SET name=@name, quantity=@quantity, price=@price, priceType=@priceType, note=@note,
            isComplex=@isComplex, slotDuration=@slotDuration, minimumUsageMinutes=@minimumUsageMinutes,
            openTime=@openTime, closeTime=@closeTime, openDays=@openDays, turnoverMinutes=@turnoverMinutes,
            updatedAt=datetime('now')
        WHERE id=@id
      `).run({ ...cols, id: resourceId });
      writePivots(resourceId, propertyIds, pricing);
    });
    tx();
  }

  function remove(id) {
    // FK cascade removes resource_properties, property_resource_prices, reservation_resources, bookings.
    database.prepare('DELETE FROM resources WHERE id = ?').run(Number(id));
  }

  // What a deletion would affect: reservations referencing the resource + its standalone bookings.
  function getDeleteImpact(id) {
    const resource = database.prepare('SELECT id, name FROM resources WHERE id = ?').get(Number(id));
    if (!resource) return null;
    const reservations = database.prepare(`
      SELECT r.id, r.propertyId, p.name AS propertyName, r.startDate, r.endDate, r.platform, rr.quantity
      FROM reservation_resources rr
      JOIN reservations r ON r.id = rr.reservationId
      LEFT JOIN properties p ON p.id = r.propertyId
      WHERE rr.resourceId = ?
      ORDER BY r.startDate DESC, r.id DESC
    `).all(Number(id));
    const bookings = database.prepare(`
      SELECT rb.id, rb.date, rb.startTime, rb.endTime, rb.propertyId, p.name AS propertyName, rb.clientName
      FROM resource_bookings rb
      LEFT JOIN properties p ON p.id = rb.propertyId
      WHERE rb.resourceId = ?
      ORDER BY rb.date DESC, rb.startTime
    `).all(Number(id));
    return {
      resource,
      reservationsCount: reservations.length,
      reservations,
      bookingsCount: bookings.length,
      bookings,
    };
  }

  return {
    parseResource,
    getPropertyIds,
    getPropertyPricingMap,
    list,
    availability,
    getBabyBedAvailability,
    findById,
    insert,
    update,
    remove,
    getDeleteImpact,
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
