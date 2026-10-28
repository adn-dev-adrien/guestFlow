/**
 * The VAT regime of a sale (specs/vat-optional-mode.md rule 8). The ONE source of a VAT rate: every
 * reader of the rate asks `forRow` for the row it is working on, and no code outside this module reads
 * `app_settings.vatRate` — that column is only a mirror of the rate in force, kept for the plugin SDK.
 *
 * `forRow(db, row)` → `{ periodId, regime, rate, legalMention, legalMentionText, legalMentionTextEn }`.
 * The row is whatever the caller already holds (a reservation, a devis, an engine input); the module
 * completes it from the database when a field it needs is missing. A database without `vat_periods`
 * (a minimal test schema) answers the historical default.
 *
 * Every function takes the database, so a test can drive it on its own schema.
 */

const { todayIso } = require('../utils/localDate');
const rules = require('../utils/vatRegime');

const DEFAULT_RATE = 10;
const SALE_FIELDS = ['kind', 'vatPeriodId', 'createdAt', 'startDate'];
const COLUMNS = 'id, regime, rate, legalMention, basis, effectiveFrom, createdAt, createdBy, note';

const statements = new WeakMap();
function stmt(db, sql) {
  if (!statements.has(db)) statements.set(db, new Map());
  const cache = statements.get(db);
  if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
  return cache.get(sql);
}

const tableSeen = new WeakSet();
function hasPeriods(db) {
  if (tableSeen.has(db)) return true;
  const found = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vat_periods'").get());
  if (found) tableSeen.add(db);
  return found;
}

function listPeriods(db) {
  try {
    return hasPeriods(db) ? stmt(db, `SELECT ${COLUMNS} FROM vat_periods ORDER BY id`).all() : [];
  } catch {
    return []; // a database whose periods cannot be read answers the historical default
  }
}

function appSettingsRate(db) {
  let row = null;
  try {
    row = db.prepare('SELECT vatRate FROM app_settings WHERE id = 1').get();
  } catch { /* column absent in a minimal test schema → the default */ }
  return row && row.vatRate != null ? Number(row.vatRate) : DEFAULT_RATE;
}

function legacyRegime(db) {
  return rules.toRegime({ id: null, regime: rules.REGIMES.SUBJECT, rate: appSettingsRate(db), legalMention: null });
}

function saleOf(db, row) {
  const sale = { ...(row || {}) };
  if (sale.id != null && Number(sale.id) > 0 && SALE_FIELDS.some((f) => sale[f] === undefined)) {
    const stored = stmt(db, 'SELECT kind, vatPeriodId, createdAt, startDate FROM reservations WHERE id = ?').get(Number(sale.id));
    if (stored) SALE_FIELDS.forEach((f) => { if (sale[f] === undefined) sale[f] = stored[f]; });
  }
  return sale;
}

/** Rule 5 — the period a sale falls under, from its own context. */
function periodForRow(db, row, periods = listPeriods(db)) {
  const sale = saleOf(db, row);
  const today = todayIso();
  const startDate = sale.startDate || today;
  if (String(sale.kind) === 'devis') return rules.pickPeriod(periods, { bookingDay: today, startDate });
  if (sale.vatPeriodId != null) {
    const stored = periods.find((p) => p.id === Number(sale.vatPeriodId));
    if (stored) return stored;
  }
  return rules.pickPeriod(periods, { bookingDay: rules.bookingDayOf(sale.createdAt) || today, startDate });
}

/** Rule 8 — the regime and rate of one sale. `row` null: the regime in force today. */
function forRow(db, row = null) {
  const periods = listPeriods(db);
  if (!periods.length) return legacyRegime(db);
  return rules.toRegime(periodForRow(db, row, periods));
}

function rateForRow(db, row) {
  return forRow(db, row).rate;
}

/** The period in force today: a booking made today, arriving today. */
function inForce(db) {
  const periods = listPeriods(db);
  const today = todayIso();
  return periods.length ? rules.pickPeriod(periods, { bookingDay: today, startDate: today }) : null;
}

/** What the settings page edits: the regime in force, its rate (0 when not subject) and its mention. */
function inForceBlock(db) {
  const current = inForce(db);
  if (!current) return null;
  const subject = current.regime === rules.REGIMES.SUBJECT;
  return { regime: current.regime, rate: subject ? Number(current.rate) : 0, legalMention: current.legalMention || null };
}

/** `app_settings.vatRate` mirrors the rate in force (0 when not subject): SDK compatibility only. */
function syncMirror(db) {
  const current = inForce(db);
  if (!current) return;
  const rate = current.regime === rules.REGIMES.SUBJECT ? Number(current.rate) : 0;
  db.prepare('UPDATE app_settings SET vatRate = ? WHERE id = 1').run(rate);
}

/** Rule 9 — the rate of the period in force. → { ok } or { ok: false, error: 'not_subject' }. */
function setRateInForce(db, rate) {
  const current = inForce(db);
  if (!current) {
    db.prepare('UPDATE app_settings SET vatRate = ? WHERE id = 1').run(Number(rate));
    return { ok: true };
  }
  if (current.regime !== rules.REGIMES.SUBJECT) return { ok: false, error: 'not_subject' };
  db.prepare('UPDATE vat_periods SET rate = ? WHERE id = ?').run(Number(rate), current.id);
  syncMirror(db);
  return { ok: true };
}

/** Rule 3 — the legal mention of the period in force. → { ok } or { ok: false, error: 'subject' }. */
function setMentionInForce(db, key) {
  const current = inForce(db);
  if (!current || current.regime !== rules.REGIMES.NOT_SUBJECT) return { ok: false, error: 'subject' };
  db.prepare('UPDATE vat_periods SET legalMention = ? WHERE id = ?').run(key, current.id);
  return { ok: true };
}

module.exports = {
  DEFAULT_RATE, forRow, rateForRow, inForce, inForceBlock, listPeriods, syncMirror, setRateInForce, setMentionInForce,
};
