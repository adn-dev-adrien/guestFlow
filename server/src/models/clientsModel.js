/**
 * Clients model — sole DB access for `clients`.
 *
 * Stores a single `phone` per client. Encapsulates phone-aware search, normalized writes,
 * deletion-impact aggregation (the reservations + devis the FK cascade will remove, server-sorted with
 * computed `nights`), and orphan cleanup.
 *
 * Exports a default model bound to the production database, and a `create(db)` factory so tests can run
 * against an in-memory schema.
 */

const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

const MS_PER_DAY = 86400000;

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function computeNights(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  return Math.round((new Date(endDate) - new Date(startDate)) / MS_PER_DAY);
}

// Past stays last; upcoming/ongoing first, ordered by closeness to today (mirrors the former
// client-side sort, now authoritative on the server).
function compareByCurrentDate(a, b) {
  const today = todayKey();
  const aPast = a.endDate < today;
  const bPast = b.endDate < today;
  if (aPast !== bPast) return aPast ? 1 : -1;
  if (!aPast) {
    const aDist = Math.abs(new Date(a.startDate) - new Date(today));
    const bDist = Math.abs(new Date(b.startDate) - new Date(today));
    if (aDist !== bDist) return aDist - bDist;
    return String(a.startDate).localeCompare(String(b.startDate));
  }
  return String(b.endDate).localeCompare(String(a.endDate));
}

// Canonical, normalized client column values (single `phone`).
function buildClientFields(payload) {
  const streetNumber = String(payload.streetNumber || '').trim();
  const street = sentenceCase(payload.street);
  const address = sentenceCase(payload.address)
    || sentenceCase([streetNumber, street].filter(Boolean).join(' '));
  return {
    lastName: sentenceCase(payload.lastName),
    firstName: sentenceCase(payload.firstName),
    streetNumber,
    street,
    postalCode: String(payload.postalCode || '').trim(),
    city: sentenceCase(payload.city),
    address,
    phone: String(payload.phone || '').trim(),
    email: String(payload.email || '').trim(),
    notes: sentenceCase(payload.notes),
  };
}

function createModel(database) {
  function list(q) {
    if (q) {
      const s = `%${q}%`;
      return database.prepare(`
        SELECT * FROM clients
        WHERE lastName LIKE ? OR firstName LIKE ? OR email LIKE ? OR phone LIKE ?
          OR street LIKE ? OR city LIKE ? OR postalCode LIKE ?
        ORDER BY lastName, firstName
      `).all(s, s, s, s, s, s, s);
    }
    return database.prepare('SELECT * FROM clients ORDER BY lastName, firstName').all();
  }

  function findById(id) {
    return database.prepare('SELECT * FROM clients WHERE id = ?').get(Number(id));
  }

  function insert(payload) {
    const fields = buildClientFields(payload);
    const result = database.prepare(`
      INSERT INTO clients (lastName, firstName, streetNumber, street, postalCode, city, address, phone, email, notes)
      VALUES (@lastName, @firstName, @streetNumber, @street, @postalCode, @city, @address, @phone, @email, @notes)
    `).run(fields);
    return findById(result.lastInsertRowid);
  }

  function update(id, payload) {
    const fields = buildClientFields(payload);
    database.prepare(`
      UPDATE clients
      SET lastName=@lastName, firstName=@firstName, streetNumber=@streetNumber, street=@street,
          postalCode=@postalCode, city=@city, address=@address, phone=@phone, email=@email, notes=@notes,
          updatedAt=datetime('now')
      WHERE id=@id
    `).run({ ...fields, id: Number(id) });
    return findById(id);
  }

  function remove(id) {
    // FK cascade removes the client's reservations + devis and all their child rows.
    database.prepare('DELETE FROM clients WHERE id = ?').run(Number(id));
  }

  function listReservationsForClient(clientId) {
    const rows = database.prepare(`
      SELECT r.id, r.clientId, r.propertyId, p.name AS propertyName, r.startDate, r.endDate,
        r.platform, r.finalPrice, r.adults, r.children, r.teens, r.babies
      FROM reservations r
      LEFT JOIN properties p ON p.id = r.propertyId
      WHERE r.clientId = ?
    `).all(Number(clientId));
    return rows
      .map((r) => ({ ...r, nights: computeNights(r.startDate, r.endDate) }))
      .sort(compareByCurrentDate);
  }

  function listDevisForClient(clientId) {
    const rows = database.prepare(`
      SELECT d.id, d.clientId, d.propertyId, p.name AS propertyName, d.devisNumber, d.status,
        d.startDate, d.endDate, d.finalPrice
      FROM devis d
      LEFT JOIN properties p ON p.id = d.propertyId
      WHERE d.clientId = ?
    `).all(Number(clientId));
    return rows
      .map((d) => ({ ...d, nights: computeNights(d.startDate, d.endDate) }))
      .sort(compareByCurrentDate);
  }

  // What a deletion would cascade-remove: the client + its reservations and devis (server-shaped).
  function getDeleteImpact(id) {
    const client = database.prepare('SELECT id, firstName, lastName FROM clients WHERE id = ?').get(Number(id));
    if (!client) return null;
    const reservations = listReservationsForClient(id);
    const devis = listDevisForClient(id);
    return {
      client,
      reservationsCount: reservations.length,
      reservations,
      devisCount: devis.length,
      devis,
    };
  }

  // Delete clients with neither a reservation nor a devis; report how many were kept for having a devis.
  function cleanupOrphans() {
    const deletableRow = database.prepare(`
      SELECT COUNT(*) AS count FROM clients c
      WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id)
        AND NOT EXISTS (SELECT 1 FROM devis d WHERE d.clientId = c.id)
    `).get();
    const keptRow = database.prepare(`
      SELECT COUNT(*) AS count FROM clients c
      WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id)
        AND EXISTS (SELECT 1 FROM devis d WHERE d.clientId = c.id)
    `).get();
    const deletedCount = Number(deletableRow?.count || 0);
    const keptWithDevisCount = Number(keptRow?.count || 0);
    if (deletedCount > 0) {
      database.prepare(`
        DELETE FROM clients
        WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = clients.id)
          AND NOT EXISTS (SELECT 1 FROM devis d WHERE d.clientId = clients.id)
      `).run();
    }
    return { deletedCount, keptWithDevisCount };
  }

  return {
    list,
    findById,
    insert,
    update,
    remove,
    listReservationsForClient,
    listDevisForClient,
    getDeleteImpact,
    cleanupOrphans,
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
