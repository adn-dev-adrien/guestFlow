/**
 * Boot-time repairs of the two complement buckets. Called from `database.js` — hence a util taking
 * `db` rather than the reservations model, which cannot be required there (it binds itself to
 * `require('../database')` at load time, so pulling it in mid-file would hand it a half-built module).
 *
 * 1. specs/sas-bath-linen-ghost-line.md — erase the billing lines the removed « linge de toilette
 *    réglé en fin de séjour » flow left behind. Idempotent (a filter).
 * 2. specs/frozen-complement-trusts-client.md — reduce a collected arrival complement that absorbed a
 *    later mid-stay sale. ONE-SHOT: it subtracts, so the caller guards it with the `migrations` table.
 * 3. specs/arrival-moment-is-the-check-in.md rule 3 — clear the arrival-extras baselines of stays the stay clock has not started
 *    (`clearPreArrivalBaselines`). Idempotent (a filter); runs on every boot.
 */

const { GHOST_SOURCE, dropBathLinenGhost } = require('./bathLinenGhostLine');
const { repairFrozenComplement } = require('./frozenComplementRepair');
const { MID_STAY_SOURCE, resolveMidStaySplit, storedMidStayLines } = require('./midStayExtras');
const { notDepartureCharge, syncDepartureChargeLines } = require('./departureChargeLines');

// Same shape `midStayExtras` keys lines by. Unlike reservationsModel.readExtraLines (which only feeds
// the baseline, i.e. keys + totals) this one MUST carry `inComplement`: that flag is what makes a
// mid-stay line « forced », and only the forced part sits in the arrival complement we are repairing.
function readExtraLines(db, reservationId) {
  return [
    ...db.prepare('SELECT optionId, totalPrice, offered, COALESCE(inComplement, 0) inComplement FROM reservation_options WHERE reservationId = ?').all(reservationId)
      .map((o) => ({
        optionId: Number(o.optionId), totalPrice: Number(o.totalPrice || 0),
        offered: Number(o.offered || 0), inComplement: Number(o.inComplement || 0),
      })),
    ...db.prepare('SELECT resourceId, totalPrice, offered, COALESCE(inComplement, 0) inComplement FROM reservation_resources WHERE reservationId = ?').all(reservationId)
      .map((r) => ({
        resourceId: Number(r.resourceId), totalPrice: Number(r.totalPrice || 0),
        offered: Number(r.offered || 0), inComplement: Number(r.inComplement || 0),
      })),
    ...db.prepare(`SELECT description, amount, offered, COALESCE(inComplement, 0) inComplement FROM reservation_custom_options WHERE reservationId = ?${notDepartureCharge(db)}`).all(reservationId)
      .map((c) => ({
        isCustom: true,
        title: c.description,
        totalPrice: Number(c.offered || 0) === 1 ? 0 : Number(c.amount || 0),
        offered: Number(c.offered || 0),
        inComplement: Number(c.inComplement || 0),
      })),
  ];
}

function repairBathLinenGhosts(db) {
  const rows = db.prepare(
    'SELECT id, endOfStayComplementDetail, endOfStayComplementPaid FROM reservations WHERE endOfStayComplementDetail LIKE ?',
  ).all(`%"${GHOST_SOURCE}"%`);
  const repaired = [];
  for (const row of rows) {
    const cleaned = dropBathLinenGhost(row.endOfStayComplementDetail);
    if (!cleaned) continue;
    if (Number(row.endOfStayComplementPaid || 0) === 1) {
      // eslint-disable-next-line no-console
      console.warn(`[bath-linen-ghost] reservation ${row.id}: dropping a ghost line from an ALREADY COLLECTED end-of-stay complement`);
    }
    db.prepare("UPDATE reservations SET endOfStayComplementAmount = ?, endOfStayComplementDetail = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(cleaned.amount, cleaned.detail.length ? JSON.stringify(cleaned.detail) : null, row.id);
    // Rule 90.2: a stay holding departure lines keeps them in step with the detail written.
    syncDepartureChargeLines(db, row.id, cleaned.detail);
    repaired.push(row.id);
  }
  return repaired;
}

function repairFrozenComplements(db) {
  const rows = db.prepare(`
    SELECT id, complementAmount, complementPaid, arrivalExtrasBaseline,
           endOfStayComplementDetail, endOfStayComplementPaid, endOfStayComplementPaidCash
      FROM reservations
     WHERE complementPaid = 1 AND endOfStayComplementDetail LIKE ?
  `).all(`%"${MID_STAY_SOURCE}"%`);
  const repaired = [];
  for (const row of rows) {
    const midStay = resolveMidStaySplit(readExtraLines(db, row.id), {
      baseline: row.arrivalExtrasBaseline,
      settled: Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1,
      storedLines: storedMidStayLines(row.endOfStayComplementDetail),
    });
    const fix = repairFrozenComplement({
      complementAmount: row.complementAmount,
      complementPaid: row.complementPaid,
      midStayForced: midStay.forced,
    });
    if (!fix) continue;
    if (fix.floored) {
      // eslint-disable-next-line no-console
      console.warn(`[frozen-complement] reservation ${row.id}: mid-stay part exceeds the collected complement — floored at 0`);
    }
    db.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(fix.amount, row.id);
    repaired.push(row.id);
  }
  return repaired;
}

// specs/arrival-moment-is-the-check-in.md rule 3, as amended by pricing-components rules 102 and 103 b (loop t4, D4-2, 2026-11-16).
// A baseline pinned before any arrival (master-era: by the mere arrival DATE) is stale: the stay is still pre-arrival, so an extra added to it
// belongs to the arrival complement, and with the baseline in place it was billed at check-out instead. Rule 102 now lays a baseline on a
// save once the stay clock has started (the check-in hour passed, nothing ticked): that one is the stay's own, and clearing it at a restart
// sent the departure part of a grown line out of every bucket. So only a stay the clock has NOT started at `now` loses its baseline, and
// never one that carved a line out to the departure (a line stamped `collectAt = 'departure'`, rule 103 b) — that baseline is the line's
// bucket. Money-safe by construction: a stay that collected anything, ticked or committed its arrival SAS is excluded.
// Loop t5 D5-2 — nor one whose arrival complement is overridden: the third reason `unmarkArrival` keeps a false start (S4-2), so a restart
// never undoes what the untick kept. Loop t5 D5-3 — a stay whose stored dates the clock cannot read keeps its baseline (logged): the boot
// never fails on one row.
function clearPreArrivalBaselines(db, { now = new Date() } = {}) {
  const stamped = ['reservation_options', 'reservation_resources', 'reservation_custom_options']
    .filter((table) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'collectAt'));
  const keepsDepartureLines = stamped
    .map((table) => `AND NOT EXISTS (SELECT 1 FROM ${table} l WHERE l.reservationId = reservations.id AND l.collectAt = 'departure')`)
    .join('\n      ');
  const overridden = db.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'complementAmountOverride')
    ? 'AND complementAmountOverride IS NULL' : '';
  const candidates = db.prepare(`
    SELECT id FROM reservations
    WHERE arrivalExtrasBaseline IS NOT NULL
      AND COALESCE(checkInDone, 0) = 0
      AND arrivalSasDoneAt IS NULL
      AND COALESCE(complementPaid, 0) = 0
      AND COALESCE(complementPaidCash, 0) = 0
      AND COALESCE(endOfStayComplementPaid, 0) = 0
      AND COALESCE(endOfStayComplementPaidCash, 0) = 0
      AND COALESCE(midStaySettledNotes, '') IN ('', '[]')
      ${overridden}
      ${keepsDepartureLines}
  `).all().map((row) => Number(row.id));
  if (!candidates.length) return [];
  const clock = require('../models/stayClockModel').create(db);
  const clear = db.prepare('UPDATE reservations SET arrivalExtrasBaseline = NULL WHERE id = ?');
  const cleared = candidates.filter((id) => {
    try {
      const phase = clock.phaseForReservation(id, now);
      return phase && !phase.started;
    } catch (err) {
      if (err.code !== 'STAY_CLOCK_INVALID') throw err;
      // eslint-disable-next-line no-console
      console.warn(`[arrival-baseline-repair] reservation ${id}: unreadable stay dates, baseline kept (${err.message})`);
      return false;
    }
  });
  db.transaction(() => cleared.forEach((id) => clear.run(id)))();
  return cleared;
}

module.exports = { repairBathLinenGhosts, repairFrozenComplements, clearPreArrivalBaselines };
