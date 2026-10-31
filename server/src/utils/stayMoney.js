/**
 * Whether a stay carries money, and whether it holds its dates (specs/payment-link-lifecycle.md rules 31, 37).
 *
 *   carriesMoneySql(database, alias)  → a SQL predicate on the row `alias`: money recorded on it or on a devis
 *                                       converted into it (rule 31), shared with supersededDuplicates
 *   carriesMoney(database, rowId)     → the same for one row, read on the stay a devis became when it was converted
 *   holdsDates(database, row)         → a `kind = 'reservation'` row that carries money or comes from a platform
 *
 * « Money » is every paid flag and its cash twin, a paid installment, a payment link paid or carrying a payment
 * (`paidAt`). A minimal schema without a column or a table simply has no such money (the unit suites' fixtures).
 * deletionGuard keeps its own reading: it answers whether a row may be deleted, not whether it holds dates.
 */

const { isDirectChannel } = require('./platformNameFormat');

const MONEY_FLAGS = [
  'depositPaid', 'balancePaid', 'complementPaid', 'endOfStayComplementPaid',
  'depositPaidCash', 'balancePaidCash', 'complementPaidCash', 'endOfStayComplementPaidCash',
];

const shapes = new WeakMap();
function shapeOf(database) {
  let shape = shapes.get(database);
  if (shape) return shape;
  const columns = new Set(database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
  const hasTable = (name) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  shape = {
    flags: MONEY_FLAGS.filter((flag) => columns.has(flag)),
    installments: hasTable('reservation_installments'),
    links: hasTable('payment_links'),
    converted: columns.has('convertedReservationId'),
  };
  shapes.set(database, shape);
  return shape;
}

function ownMoneySql(shape, alias) {
  const terms = shape.flags.map((flag) => `COALESCE(${alias}.${flag}, 0) = 1`);
  if (shape.installments) terms.push(`EXISTS (SELECT 1 FROM reservation_installments i WHERE i.reservationId = ${alias}.id AND i.paid = 1)`);
  if (shape.links) terms.push(`EXISTS (SELECT 1 FROM payment_links pl WHERE pl.reservationId = ${alias}.id AND (pl.status = 'paid' OR pl.paidAt IS NOT NULL))`);
  return terms.length ? `(${terms.join(' OR ')})` : '(0)';
}

function carriesMoneySql(database, alias = 'r') {
  const shape = shapeOf(database);
  const own = ownMoneySql(shape, alias);
  if (!shape.converted) return own;
  return `(${own} OR EXISTS (SELECT 1 FROM reservations src WHERE src.convertedReservationId = ${alias}.id AND ${ownMoneySql(shape, 'src')}))`;
}

// A devis converted since answers as the reservation it became: its money and the stay's are the same money.
function carriesMoney(database, rowId) {
  const shape = shapeOf(database);
  const row = database.prepare(`SELECT id${shape.converted ? ', convertedReservationId' : ''} FROM reservations WHERE id = ?`).get(Number(rowId));
  if (!row) return false;
  const ids = [Number(row.id), ...(row.convertedReservationId ? [Number(row.convertedReservationId)] : [])];
  return ids.some((id) => Boolean(database.prepare(`SELECT 1 FROM reservations r WHERE r.id = ? AND ${carriesMoneySql(database, 'r')}`).get(id)));
}

// Rule 37 — only a cancellation frees the nights of such a stay; a devis never holds them.
function holdsDates(database, row) {
  if (!row || String(row.kind || 'reservation') !== 'reservation') return false;
  return !isDirectChannel(row.platform) || carriesMoney(database, row.id);
}

module.exports = { carriesMoneySql, carriesMoney, holdsDates, MONEY_FLAGS };
