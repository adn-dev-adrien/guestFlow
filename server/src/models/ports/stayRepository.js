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
 *   lineFacts(id)              `{ [lineKey]: { discountCents, source, soldAt, lineId, table, collectAt, collectAtDefault, settledCents, paidAt, storedCents } }` of the stored lines (rules 21, 39;
 *                              `storedCents` = the stored line's amount before its discounts, 0 when offered — rules 12, 74), `{}` on a schema
 *                              that predates the line columns; `settledCents` is the Σ of the line's allocations, never a stored column
 *
 *   stay(id)                   the stored stay: `{ row, options, customOptions, resources }` (the rows `stayRow` and the line readers return)
 *   storedStayPrice(id)        the price the stay was sold at, in cents: `{ totalCents, accommodationCents, touristTaxCents, extrasCents }`;
 *                              the stored total is authoritative, no reader re-prices a stored line (rule 74)
 */
const stayClockModel = require('../stayClockModel');
const { toCents } = require('../../utils/pricing/money');
const { extraLineKey } = require('../../utils/pricing/storedLines');
const { keyLines } = require('../../utils/pricing/lineKeys');

// The two card-option columns, kept out of the SELECT on a schema that predates them.
function cardColumns(db) {
  const present = new Set(db.prepare('PRAGMA table_info(reservation_options)').all().map((c) => c.name));
  return ['cardOccurrences', 'cardPersons', 'cardNights'].filter((name) => present.has(name));
}

// Rule 85: the stored line's own identity rides with it, so two sales of one article are two lines for the engine. Kept out of the
// SELECT on a schema that predates `lineId`.
function lineIdColumn(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'lineId') ? ['lineId'] : [];
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
    ...lineIdColumn(db, 'reservation_options'), 'optionId', 'quantity',
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
    SELECT ${[...lineIdColumn(db, 'reservation_resources'), 'resourceId'].join(', ')}, quantity, COALESCE(offered, 0) as offered, COALESCE(inComplement, 0) as inComplement,
      ${hasSessions ? 'sessions' : 'NULL AS sessions'}
    FROM reservation_resources WHERE reservationId = ?
  `).all(id);
  return resourceRows;
}

function lockedOptionLines(db, id) {
  // Locked snapshots so the engine reproduces the persisted line prices and the tariff the stay was
  // sold under (no drift from a refreshed unit price or tariff between save and payment).
  const lockedOptionLines = db.prepare(`
    SELECT ${[...lineIdColumn(db, 'reservation_options'), 'optionId'].join(', ')}, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc${db.prepare('PRAGMA table_info(reservation_options)').all().some((c) => c.name === 'allowanceUsed') ? ', allowanceUsed' : ''}
    FROM reservation_options WHERE reservationId = ?
  `).all(id)
    // Rule 41 — a line's stored consumption, as the fiche's save reads it (`bookingLinesModel`); none stored keeps the snapshot's reading.
    .map((line) => {
      if (line.allowanceUsed != null) return line;
      const { allowanceUsed, ...rest } = line;
      return rest;
    });
  return lockedOptionLines;
}

function lockedResourceLines(db, id) {
  // Rule 90.3 — the components say what a line with no hours bills (its evening).
  const components = db.prepare('PRAGMA table_info(reservation_resources)').all().some((c) => c.name === 'components') ? ', components' : '';
  const lockedResourceLines = db.prepare(`
    SELECT ${[...lineIdColumn(db, 'reservation_resources'), 'resourceId'].join(', ')}, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc${components}
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

// Extras the stay holds beyond the lodging: what the options, the activities and the custom lines were sold at (offered lines are 0).
function extrasCents(db, id) {
  const sum = (sql) => Number(db.prepare(sql).get(Number(id)).cents || 0);
  return sum('SELECT COALESCE(SUM(CAST(ROUND(totalPrice * 100) AS INTEGER)), 0) AS cents FROM reservation_options WHERE reservationId = ? AND COALESCE(offered, 0) = 0')
    + sum('SELECT COALESCE(SUM(CAST(ROUND(totalPrice * 100) AS INTEGER)), 0) AS cents FROM reservation_resources WHERE reservationId = ? AND COALESCE(offered, 0) = 0')
    + sum('SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) AS cents FROM reservation_custom_options WHERE reservationId = ? AND COALESCE(offered, 0) = 0');
}

function storedStayPrice(db, id) {
  const row = stayRow(db, id);
  if (!row) return null;
  const totalCents = toCents(row.finalPrice) + toCents(row.touristTaxTotal);
  const extras = extrasCents(db, id);
  return { totalCents, accommodationCents: Math.max(0, toCents(row.finalPrice) - extras), touristTaxCents: toCents(row.touristTaxTotal), extrasCents: extras };
}

const LINE_TABLES = [
  { table: 'reservation_options', short: 'option', extra: 'optionId' },
  { table: 'reservation_resources', short: 'resource', extra: 'resourceId' },
  { table: 'reservation_custom_options', short: 'custom', key: (r) => extraLineKey({ isCustom: true, description: r.description }), extra: 'description' },
];

function lineFacts(db, id) {
  const facts = {};
  const hasAllocations = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payment_allocations'").get());
  const settled = new Map();
  const paidAt = new Map();
  if (hasAllocations) {
    for (const r of db.prepare("SELECT lineRef, SUM(amountCents) AS cents, MAX(CASE WHEN kind = 'payment' THEN at END) AS paidAt FROM payment_allocations WHERE documentRef = ? AND lineRef IS NOT NULL GROUP BY lineRef").all(`reservation:${id}`)) {
      settled.set(r.lineRef, r.cents);
      paidAt.set(r.lineRef, r.paidAt);
    }
  }
  for (const { table, short, key, extra } of LINE_TABLES) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    if (!columns.has('lineId')) continue;
    const total = table === 'reservation_custom_options' ? 'amount' : 'totalPrice';
    const pick = ['lineId', extra, ...['discountCents', 'source', 'soldAt', 'collectAt', 'collectAtDefault', 'addedOnReopen', total, 'offered'].filter((c) => columns.has(c))];
    const rows = db.prepare(`SELECT ${pick.join(', ')} FROM ${table} WHERE reservationId = ?`).all(Number(id));
    // Rule 85: an article's first line keeps the legacy key, every later one is named by its `lineRef`.
    const keyed = key ? null : new Map(keyLines(table, rows).map((entry) => [entry.row, entry.key]));
    for (const r of rows) {
      const k = key ? key(r) : keyed.get(r);
      if (k in facts) continue;
      facts[k] = {
        lineId: r.lineId, table: short, discountCents: Number(r.discountCents || 0), source: r.source || 'fiche', soldAt: r.soldAt || '',
        collectAt: r.collectAt || null, collectAtDefault: r.collectAtDefault || null, addedOnReopen: Number(r.addedOnReopen || 0) === 1,
        settledCents: Math.max(0, Number(settled.get(`line:${table}:${r.lineId}`) || 0)), paidAt: paidAt.get(`line:${table}:${r.lineId}`) || null,
        ...(r[total] !== undefined ? { storedCents: Number(r.offered || 0) === 1 ? 0 : toCents(r[total]) } : {}),
      };
    }
  }
  return facts;
}

function create(db) {
  return {
    lineFacts: (id) => lineFacts(db, id),
    stay: (id) => {
      const row = stayRow(db, id);
      return row ? { row, options: optionRows(db, id), customOptions: customOptionRows(db, id), resources: resourceRows(db, id) } : null;
    },
    storedStayPrice: (id) => storedStayPrice(db, id),
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
