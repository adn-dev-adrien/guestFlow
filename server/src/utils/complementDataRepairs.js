/**
 * Boot-time repairs of the two complement buckets. Called from `database.js` — hence a util taking
 * `db` rather than the reservations model, which cannot be required there (it binds itself to
 * `require('../database')` at load time, so pulling it in mid-file would hand it a half-built module).
 *
 * 1. specs/sas-bath-linen-ghost-line.md — erase the billing lines the removed « linge de toilette
 *    réglé en fin de séjour » flow left behind. Idempotent (a filter).
 * 2. specs/frozen-complement-trusts-client.md — reduce a collected arrival complement that absorbed a
 *    later mid-stay sale. ONE-SHOT: it subtracts, so the caller guards it with the `migrations` table.
 */

const { GHOST_SOURCE, dropBathLinenGhost } = require('./bathLinenGhostLine');
const { repairFrozenComplement } = require('./frozenComplementRepair');
const { MID_STAY_SOURCE, resolveMidStaySplit, storedMidStayLines } = require('./midStayExtras');

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
    ...db.prepare('SELECT description, amount, offered, COALESCE(inComplement, 0) inComplement FROM reservation_custom_options WHERE reservationId = ?').all(reservationId)
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

module.exports = { repairBathLinenGhosts, repairFrozenComplements };
