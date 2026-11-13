/**
 * StayRepository — the stored stay as the pricing loader reads it (specs/pricing-components.md §3 rule 48).
 *
 * Contract (plain functions over today's queries; `create(db)` binds them to a database):
 *   stayRow(id)                the `reservations` row, undefined when absent
 *   optionRows(id)             the sold options as the engine input lists them (card columns when the schema has them)
 *   customOptionRows(id)       the custom lines
 *   resourceRows(id)           the sold resources (with their sessions when the schema has them)
 *   lockedOptionLines(id) / lockedResourceLines(id) / lockedNightlyBreakdown(id)   the sold snapshots
 *   lockedTariff(reservation)  the tariff snapshot the stay was sold under, null when none
 *   phaseInputs(id)            dates and times for the stay clock (models/stayClockModel.js)
 *
 * `stay(id)` / `storedStayPrice(id)` of rule 48 arrive with the sale path (PR B).
 */
const stayClockModel = require('../stayClockModel');

// The two card-option columns, kept out of the SELECT on a schema that predates them.
function cardColumns(db) {
  const present = new Set(db.prepare('PRAGMA table_info(reservation_options)').all().map((c) => c.name));
  return ['cardOccurrences', 'cardPersons', 'cardNights'].filter((name) => present.has(name));
}

function stayRow(db, id) {
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
}

function optionRows(db, id) {
  // `cardOccurrences` + `cardPersons` ride with the rest (specs/unscheduled-card-option.md rule 10).
  // Without them every planning-card line vanished from this replay — scheduled or not — because the
  // engine rebuilds such a line from its moments. Measured on production before the fix: 635 € of
  // option lines missing across 13 bookings, and a tourist-tax declaration 9,74 € above what the
  // fiches themselves say, the taxable base growing as the services dropped out of it.
  // Selected by name only when present, like every other reader of these two columns
  // (`bookingLinesModel`): a minimal test schema predates them.
  const optionColumns = [
    'optionId', 'quantity',
    ...cardColumns(db),
    'COALESCE(inComplement, 0) as inComplement', 'COALESCE(offered, 0) as offered',
  ];
  const optionRows = db.prepare(`
    SELECT ${optionColumns.join(', ')} FROM reservation_options WHERE reservationId = ?
  `).all(id);
  return optionRows;
}

function customOptionRows(db, id) {
  const customOptionRows = db.prepare(`
    SELECT id as customOptionId, description, amount, COALESCE(offered, 0) as offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id
  `).all(id);
  return customOptionRows;
}

function resourceRows(db, id) {
  // specs/plugins-phase-3c-hourly-resources.md rule 5 — the sessions ride along, so a replay keeps the
  // hours placed (`scheduledHours`); the amount is the locked snapshot's either way.
  const hasSessions = db.prepare('PRAGMA table_info(reservation_resources)').all().some((c) => c.name === 'sessions');
  const resourceRows = db.prepare(`
    SELECT resourceId, quantity, COALESCE(offered, 0) as offered, COALESCE(inComplement, 0) as inComplement,
      ${hasSessions ? 'sessions' : 'NULL AS sessions'}
    FROM reservation_resources WHERE reservationId = ?
  `).all(id);
  return resourceRows;
}

function lockedOptionLines(db, id) {
  // Locked snapshots so the engine reproduces the persisted line prices and the tariff the stay was
  // sold under (no drift from a refreshed unit price or tariff between save and payment).
  const lockedOptionLines = db.prepare(`
    SELECT optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_options WHERE reservationId = ?
  `).all(id);
  return lockedOptionLines;
}

function lockedResourceLines(db, id) {
  const lockedResourceLines = db.prepare(`
    SELECT resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_resources WHERE reservationId = ?
  `).all(id);
  return lockedResourceLines;
}

function lockedNightlyBreakdown(db, id) {
  const lockedNightlyBreakdown = db.prepare(`
    SELECT date, seasonLabel, pricingMode, price
    FROM reservation_nights WHERE reservationId = ? ORDER BY date
  `).all(id);
  return lockedNightlyBreakdown;
}

function lockedTariff(db, reservation) {
  // A row listed with a handful of columns does not carry the snapshot: read it, as the save does.
  let lockedTariff = null;
  try {
    const raw = reservation.tariffSnapshot !== undefined
      ? reservation.tariffSnapshot
      : (db.prepare('SELECT tariffSnapshot FROM reservations WHERE id = ?').get(reservation.id) || {}).tariffSnapshot;
    lockedTariff = raw ? JSON.parse(raw) : null;
  } catch { lockedTariff = null; }
  return lockedTariff;
}

function create(db) {
  return {
    stayRow: (id) => stayRow(db, id),
    optionRows: (id) => optionRows(db, id),
    customOptionRows: (id) => customOptionRows(db, id),
    resourceRows: (id) => resourceRows(db, id),
    lockedOptionLines: (id) => lockedOptionLines(db, id),
    lockedResourceLines: (id) => lockedResourceLines(db, id),
    lockedNightlyBreakdown: (id) => lockedNightlyBreakdown(db, id),
    lockedTariff: (reservation) => lockedTariff(db, reservation),
    phaseInputs: (id) => stayClockModel.create(db).phaseInputsFor(id),
  };
}

module.exports = { create, cardColumns };
