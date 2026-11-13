/**
 * DEPARTURE CHARGE LINES — the departure SAS's charges as custom lines (specs/pricing-components.md §3 rule 90.2).
 *
 * The charges a departure SAS bills (ménage, missing linen, extinguisher, and every other SAS-owned entry of the end-of-stay detail)
 * are rows of `reservation_custom_options` keyed `sasLineKey = 'departure:…'`, source `sas`, moment `departure`. They are NOT a sale
 * of the stay: they sit outside `finalPrice`, in the end-of-stay complement, exactly as the stored detail always billed them. So:
 *
 *   - `notDepartureCharge(db, alias)` is the SQL every reader of the stay's custom lines appends (the engine's input, the fiche, the
 *     money splits, the contribs, the allocations, the e-mails…): those readers see the stay they always saw;
 *   - `syncDepartureChargeLines(db, reservationId, detail, { create })` is called by the end-of-stay detail's single write point
 *     (`writeEndOfStayDetail`) with the detail it writes, so the lines and the detail are one write of the same entries: a line per
 *     entry `endOfStayChargesOf` returns, updated in place by its key (rule 14), deleted when its entry is gone. A stay holding no
 *     departure line (every stay before rule 90.2) gets none unless `create` (the departure SAS's commit) says so.
 *
 * The amounts are read through `endOfStayChargesOf` (the adapter on the stored detail): a stay before rule 90.2 has no line and reads
 * exactly as before; a stay after it reads the detail written in the same write as its lines.
 */

const { endOfStayChargesOf } = require('./pricing/settlement');
const { realOfStoredLine } = require('./departureSasPlan');
const { todayIso } = require('./localDate');

const DEPARTURE_LINE_PREFIX = 'departure:';

const present = new WeakMap();
function hasSasLineKey(db) {
  if (present.get(db)) return true;
  let has = false;
  try { has = db.prepare('PRAGMA table_info(reservation_custom_options)').all().some((c) => c.name === 'sasLineKey'); } catch { has = false; }
  if (has) present.set(db, true);
  return has;
}

/** ` AND <alias.>sasLineKey is not a departure key`, or '' on a schema without the column (it can hold no departure line). */
function notDepartureCharge(db, alias = '') {
  if (!hasSasLineKey(db)) return '';
  const column = alias ? `${alias}.sasLineKey` : 'sasLineKey';
  return ` AND COALESCE(${column}, '') NOT LIKE '${DEPARTURE_LINE_PREFIX}%'`;
}

const isDepartureChargeRow = (row) => Boolean(row) && String(row.sasLineKey || '').startsWith(DEPARTURE_LINE_PREFIX);

/** The key of each charge, in detail order: its repair key for an extinguisher tariff, else its label; a repeat takes `#n`. */
function departureLineKeys(charges) {
  const seen = new Map();
  return charges.map((line) => {
    const base = line.repairKey ? `ext:${String(line.repairKey)}` : `label:${String(line.label || '').trim()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return `${DEPARTURE_LINE_PREFIX}${base}${n > 1 ? `#${n}` : ''}`;
  });
}

function columnsOf(db) {
  try { return new Set(db.prepare('PRAGMA table_info(reservation_custom_options)').all().map((c) => c.name)); } catch { return new Set(); }
}

/** The departure lines of a stay, in sort order. */
function departureChargeRows(db, reservationId) {
  if (!hasSasLineKey(db)) return [];
  return db.prepare(`SELECT * FROM reservation_custom_options WHERE reservationId = ? AND sasLineKey LIKE '${DEPARTURE_LINE_PREFIX}%' ORDER BY sortOrder, id`)
    .all(Number(reservationId));
}

/**
 * Writes the stay's departure lines from the detail being stored. Returns the number of rows written or deleted.
 * A line carries the charge's real amount, its `offered` flag and its count; an offered charge stays a line (0 € billed).
 */
function syncDepartureChargeLines(db, reservationId, detail, { create = false } = {}) {
  if (!hasSasLineKey(db)) return 0;
  const existing = departureChargeRows(db, reservationId);
  if (!create && existing.length === 0) return 0;
  const charges = endOfStayChargesOf(detail);
  const keys = departureLineKeys(charges);
  const columns = columnsOf(db);
  const byKey = new Map(existing.map((row) => [row.sasLineKey, row]));
  let sortOrder = Number(db.prepare('SELECT COALESCE(MAX(sortOrder), -1) AS m FROM reservation_custom_options WHERE reservationId = ?').get(Number(reservationId)).m) + 1;
  let changes = 0;
  charges.forEach((line, index) => {
    const key = keys[index];
    const fields = {
      description: String(line.label || '').trim(),
      amount: realOfStoredLine(line),
      offered: Number(line.offered || 0) === 1 ? 1 : 0,
      ...(columns.has('quantity') ? { quantity: Math.max(1, Math.round(Number(line.qty) || 1)) } : {}),
      ...(columns.has('label') ? { label: String(line.label || '').trim() } : {}),
    };
    const row = byKey.get(key);
    if (row) {
      byKey.delete(key);
      const moved = Object.entries(fields).filter(([name, value]) => row[name] !== value);
      if (moved.length === 0) return;
      db.prepare(`UPDATE reservation_custom_options SET ${moved.map(([name]) => `${name} = ?`).join(', ')} WHERE id = ?`)
        .run(...moved.map(([, value]) => value), row.id);
      changes += 1;
      return;
    }
    const insert = {
      reservationId: Number(reservationId), ...fields, sortOrder, sasLineKey: key,
      ...(columns.has('inComplement') ? { inComplement: 0 } : {}),
      ...(columns.has('sasArrivalOrigin') ? { sasArrivalOrigin: 0 } : {}),
      ...(columns.has('source') ? { source: 'sas' } : {}),
      ...(columns.has('collectAt') ? { collectAt: 'departure' } : {}),
      ...(columns.has('collectAtDefault') ? { collectAtDefault: 'departure' } : {}),
      ...(columns.has('soldAt') ? { soldAt: todayIso() } : {}),
    };
    sortOrder += 1;
    const names = Object.keys(insert);
    db.prepare(`INSERT INTO reservation_custom_options (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((n) => insert[n]));
    changes += 1;
  });
  for (const row of byKey.values()) {
    db.prepare('DELETE FROM reservation_custom_options WHERE id = ?').run(row.id);
    changes += 1;
  }
  return changes;
}

module.exports = {
  DEPARTURE_LINE_PREFIX, notDepartureCharge, isDepartureChargeRow, departureChargeRows, departureLineKeys, syncDepartureChargeLines,
};
