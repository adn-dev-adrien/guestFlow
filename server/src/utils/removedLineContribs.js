/**
 * The contribs of paid lines since removed from the fiche (specs/accounting-books-the-money-collected.md rule 17, D9-D11
 * of 2026-11-05). Removing a paid line does not rewrite a booked entry: what it collected stays on the stay, per bucket,
 * in `reservations.removedLineContribs` (JSON), and every reader of the contribs sees it as a line billed 0 €.
 *
 *   [{ key, label, bucket: 'options'|'resources', acompteContribTtc, soldeContribTtc }]
 *
 * NULL = nothing removed: a stay reads exactly as it did. A rename moves a contrib from one key to another: within a
 * bucket what a line gained in the same save is taken off what another lost, so it records no removal.
 */

const { extraLineKey } = require('./midStayExtras');

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

function parseRemovedLineContribs(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((entry) => entry && entry.key) : [];
  } catch {
    return [];
  }
}

const hasColumn = (db) => {
  try {
    return db.prepare('PRAGMA table_info(reservations)').all().some((column) => column.name === 'removedLineContribs');
  } catch {
    return false;
  }
};

// The lines of a stay as the contribs see them: key, label, bucket and what each paid bucket holds on it.
function contribLinesOf(db, reservationId) {
  const read = (sql) => db.prepare(sql).all(reservationId);
  return [
    ...read(`SELECT ro.optionId, o.title AS label, ro.acompteContribTtc, ro.soldeContribTtc
      FROM reservation_options ro LEFT JOIN options o ON o.id = ro.optionId WHERE ro.reservationId = ?`)
      .map((line) => ({ ...line, bucket: 'options', key: extraLineKey({ optionId: line.optionId }) })),
    ...read('SELECT id AS customOptionId, description AS label, acompteContribTtc, soldeContribTtc FROM reservation_custom_options WHERE reservationId = ?')
      .map((line) => ({ ...line, bucket: 'options', key: extraLineKey({ ...line, title: line.label, isCustom: true }) })),
    ...read(`SELECT rr.resourceId, r.name AS label, rr.acompteContribTtc, rr.soldeContribTtc
      FROM reservation_resources rr LEFT JOIN resources r ON r.id = rr.resourceId WHERE rr.reservationId = ?`)
      .map((line) => ({ ...line, bucket: 'resources', key: extraLineKey({ resourceId: line.resourceId }) })),
  ].filter((line) => line.key);
}

const FIELDS = ['acompteContribTtc', 'soldeContribTtc'];

function byKey(lines) {
  const out = new Map();
  for (const line of lines) {
    const entry = out.get(line.key) || { key: line.key, label: line.label, bucket: line.bucket, acompteContribTtc: 0, soldeContribTtc: 0 };
    for (const field of FIELDS) entry[field] = round2(entry[field] + Number(line[field] || 0));
    out.set(line.key, entry);
  }
  return out;
}

/**
 * A priced save rewrites the lines (DELETE + INSERT): call it with the lines read before and it records, once they are
 * written, what the lines lost. Inside the save's transaction.
 */
function recordRemovedLineContribs(db, reservationId, before) {
  if (!hasColumn(db)) return;
  const was = byKey(before);
  const now = byKey(contribLinesOf(db, reservationId));
  const lost = [];
  const gained = { options: { acompteContribTtc: 0, soldeContribTtc: 0 }, resources: { acompteContribTtc: 0, soldeContribTtc: 0 } };
  for (const [key, entry] of was) {
    const after = now.get(key);
    const entryLost = { ...entry };
    for (const field of FIELDS) entryLost[field] = Math.max(0, round2(entry[field] - Number((after && after[field]) || 0)));
    if (entryLost.acompteContribTtc > 0 || entryLost.soldeContribTtc > 0) lost.push(entryLost);
  }
  for (const [key, entry] of now) {
    const prior = was.get(key);
    for (const field of FIELDS) gained[entry.bucket][field] = round2(gained[entry.bucket][field] + Math.max(0, round2(entry[field] - Number((prior && prior[field]) || 0))));
  }
  for (const entry of lost) {
    for (const field of FIELDS) {
      const taken = Math.min(entry[field], gained[entry.bucket][field]);
      entry[field] = round2(entry[field] - taken);
      gained[entry.bucket][field] = round2(gained[entry.bucket][field] - taken);
    }
  }
  const removed = lost.filter((entry) => entry.acompteContribTtc > 0 || entry.soldeContribTtc > 0);
  if (removed.length === 0) return;
  const stored = parseRemovedLineContribs(db.prepare('SELECT removedLineContribs AS raw FROM reservations WHERE id = ?').get(reservationId)?.raw);
  for (const entry of removed) {
    const held = stored.find((other) => other.key === entry.key);
    if (held) {
      for (const field of FIELDS) held[field] = round2(Number(held[field] || 0) + entry[field]) || null;
    } else {
      stored.push({ key: entry.key, label: entry.label, bucket: entry.bucket, acompteContribTtc: entry.acompteContribTtc || null, soldeContribTtc: entry.soldeContribTtc || null });
    }
  }
  db.prepare('UPDATE reservations SET removedLineContribs = ? WHERE id = ?').run(JSON.stringify(stored), reservationId);
}

/** An un-ticked acompte or solde gives its bucket back: what the removed lines held of it goes with it. */
function clearRemovedLineContribs(db, reservationId, bucket) {
  if (!hasColumn(db)) return;
  const field = bucket === 'deposit' ? 'acompteContribTtc' : 'soldeContribTtc';
  const stored = parseRemovedLineContribs(db.prepare('SELECT removedLineContribs AS raw FROM reservations WHERE id = ?').get(reservationId)?.raw);
  if (stored.length === 0) return;
  const left = stored.map((entry) => ({ ...entry, [field]: null })).filter((entry) => entry.acompteContribTtc != null || entry.soldeContribTtc != null);
  db.prepare('UPDATE reservations SET removedLineContribs = ? WHERE id = ?').run(left.length ? JSON.stringify(left) : null, reservationId);
}

module.exports = { parseRemovedLineContribs, contribLinesOf, recordRemovedLineContribs, clearRemovedLineContribs };
