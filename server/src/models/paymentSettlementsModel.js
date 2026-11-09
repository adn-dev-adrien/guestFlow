/**
 * Payment settlements model — sole DB access for `payment_settlements` / `payment_tenders`
 * (specs/mixed-method-payments.md §5).
 *
 * A settlement records HOW a manual payment was made (its tender lines) and what became of an amount not
 * received. The paid flags of the target stay where they always were (`reservations.*Paid`, the group, the
 * note, the installment): the existing gesture writes them, this model writes the lines right after.
 *
 * The stay's row carries four aggregates (`splitOffBooksAmount`, `splitWaivedAmount`,
 * `splitWaivedCashAmount`, `splitShortfallDue`, euros) that every reader of the stay's money takes from the
 * row it already loads. Every write here refreshes them.
 *
 * `sync(reservationId)` is self-healing: it drops the settlements whose target is no longer paid (a bucket
 * undone, a group dissolved, a note cancelled, an installment taken back) and refreshes the aggregates. The
 * paths that un-mark a payment call it, so none of them has to know about settlements.
 *
 * API:
 *   listFor(reservationId)                     → settlements with `tenders[]` and parsed `parts[]`, oldest first
 *   findById(id)                               → one settlement, or null
 *   listForTarget(reservationId, kind, key)
 *   insert({ reservationId, targetKind, targetKey, paidDate, dueCents, shortfallCents, shortfallKind, parts, lines })
 *   replace(id, { paidDate, shortfallCents, shortfallKind, lines })
 *   removeForTarget(reservationId, kind, key)
 *   sync(reservationId)                        → { removed }
 *   syncAll()                                  → how many settlements `sync` dropped over every stay (each boot)
 *   projectedAggregates(row)                   → the four aggregates once `row` is written, or null
 *   droppedBy(row)                             → the settlements `row` (a state about to be written) would drop
 */

const { parseParts, reservationAggregates, currentCentsOf } = require('../utils/paymentTenders');
const { parseGroup } = require('../utils/arrivalPaymentGroup');
const { parseNotes } = require('../utils/midStayExtras');

const PAID_FLAG = {
  deposit: ['depositPaid', 'depositPaidCash'],
  balance: ['balancePaid', 'balancePaidCash'],
  complement: ['complementPaid', 'complementPaidCash'],
  endOfStayComplement: ['endOfStayComplementPaid', 'endOfStayComplementPaidCash'],
};

function hasTable(database, name) {
  try { return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)); }
  catch { return false; }
}

function buildModel(database) {
  // A minimal test schema without the tables or the aggregates reads « no settlement » and writes nothing.
  let isReady = false;
  const ready = () => {
    if (!isReady) {
      isReady = hasTable(database, 'payment_settlements')
        && database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'splitShortfallDue');
    }
    return isReady;
  };

  const attachTenders = (rows) => {
    if (rows.length === 0) return rows;
    const ids = rows.map((r) => r.id);
    const tenders = database.prepare(`SELECT settlementId, position, method, amountCents, internal FROM payment_tenders
      WHERE settlementId IN (${ids.map(() => '?').join(',')}) ORDER BY settlementId, position`).all(...ids);
    return rows.map((r) => ({
      ...r,
      parts: parseParts(r.parts),
      tenders: tenders.filter((t) => t.settlementId === r.id).map(({ settlementId, ...t }) => ({ ...t, internal: Number(t.internal) })),
    }));
  };

  const listFor = (reservationId) => {
    if (!ready()) return [];
    return attachTenders(database.prepare('SELECT * FROM payment_settlements WHERE reservationId = ? ORDER BY id').all(Number(reservationId)));
  };

  const findById = (id) => {
    if (!ready()) return null;
    const row = database.prepare('SELECT * FROM payment_settlements WHERE id = ?').get(Number(id));
    return row ? attachTenders([row])[0] : null;
  };

  const listForTarget = (reservationId, kind, key) => listFor(reservationId)
    .filter((s) => s.targetKind === kind && String(s.targetKey) === String(key));

  const writeLines = (settlementId, lines) => {
    database.prepare('DELETE FROM payment_tenders WHERE settlementId = ?').run(settlementId);
    const insert = database.prepare('INSERT INTO payment_tenders (settlementId, position, method, amountCents, internal) VALUES (?, ?, ?, ?, ?)');
    lines.forEach((l, i) => insert.run(settlementId, i + 1, l.method, l.amountCents, l.internal ? 1 : 0));
  };

  // Whether the target's own caisse-interne flag is set: such a target is off the books whole, so only its
  // geste commercial comes off the caisse (paymentTenders.reservationAggregates).
  function targetFlagged(row, settlement) {
    if (!row) return false;
    if (settlement.targetKind === 'bucket') {
      return parseParts(settlement.parts).every((p) => PAID_FLAG[p.kind] && Number(row[PAID_FLAG[p.kind][1]] || 0) === 1);
    }
    if (settlement.targetKind === 'arrivalGroup') {
      const group = parseGroup(row.arrivalPaymentGroup);
      return Boolean(group && group.cash === 1);
    }
    if (settlement.targetKind === 'midStayNote') {
      const note = parseNotes(row.midStaySettledNotes).find((n) => String(n.id) === String(settlement.targetKey));
      return Boolean(note && Number(note.paidCash || 0) === 1);
    }
    // An installment has no caisse-interne flag: its money is always in `installmentsPaidAmount`.
    return false;
  }

  // Whether the target a settlement paid is still paid. A settlement never outlives its payment.
  function targetStillPaid(row, settlement) {
    if (!row) return false;
    if (settlement.targetKind === 'bucket') {
      return parseParts(settlement.parts).every((p) => PAID_FLAG[p.kind] && (Number(row[PAID_FLAG[p.kind][0]] || 0) === 1 || Number(row[PAID_FLAG[p.kind][1]] || 0) === 1));
    }
    if (settlement.targetKind === 'arrivalGroup') {
      const group = parseGroup(row.arrivalPaymentGroup);
      return Boolean(group && group.at === String(settlement.targetKey));
    }
    if (settlement.targetKind === 'midStayNote') {
      return parseNotes(row.midStaySettledNotes).some((n) => String(n.id) === String(settlement.targetKey));
    }
    if (settlement.targetKind === 'installment') {
      if (!hasTable(database, 'reservation_installments')) return false;
      const inst = database.prepare('SELECT paid FROM reservation_installments WHERE id = ? AND reservationId = ?')
        .get(Number(settlement.targetKey), Number(settlement.reservationId));
      return Boolean(inst && Number(inst.paid) === 1);
    }
    return false;
  }

  function aggregatesOf(row, settlements) {
    const byTarget = new Map();
    for (const s of settlements) {
      const key = `${s.targetKind}:${s.targetKey}`;
      // Rule 39 — the target is read at what it is worth now: a bucket whose amount moved since is owed or overpaid.
      if (!byTarget.has(key)) byTarget.set(key, { settlements: [], flagged: targetFlagged(row, s), currentCents: currentCentsOf(parseParts(s.parts), row) });
      byTarget.get(key).settlements.push(s);
    }
    return reservationAggregates([...byTarget.values()]);
  }

  function refreshAggregates(reservationId, row, settlements) {
    const agg = aggregatesOf(row, settlements);
    database.prepare(`UPDATE reservations SET splitOffBooksAmount = ?, splitWaivedAmount = ?, splitWaivedCashAmount = ?, splitShortfallDue = ? WHERE id = ?`)
      .run(agg.splitOffBooksAmount, agg.splitWaivedAmount, agg.splitWaivedCashAmount, agg.splitShortfallDue, Number(reservationId));
    return agg;
  }

  // The aggregates the stay would carry once `row` (a hypothetical state: a mark taken back) is written: only the
  // settlements whose target stays paid count. Null on a schema without settlements.
  function projectedAggregates(row) {
    if (!ready() || !row || row.id == null) return null;
    return aggregatesOf(row, listFor(row.id).filter((s) => targetStillPaid(row, s)));
  }

  // The settlements a written state (`row`, a hypothetical: a mark taken back, a group dissolved, a note cancelled)
  // would drop: their target no longer paid, or one of the buckets they paid no longer paid.
  function droppedBy(row) {
    if (!ready() || !row || row.id == null) return [];
    return listFor(row.id).filter((s) => !targetStillPaid(row, s) || parseParts(s.parts)
      .some((p) => PAID_FLAG[p.kind] && Number(row[PAID_FLAG[p.kind][0]] || 0) !== 1 && Number(row[PAID_FLAG[p.kind][1]] || 0) !== 1));
  }

  function sync(reservationId) {
    if (!ready()) return { removed: 0 };
    let removed = 0;
    database.transaction(() => {
      const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(reservationId));
      const settlements = listFor(reservationId);
      const kept = [];
      for (const s of settlements) {
        if (targetStillPaid(row, s)) kept.push(s);
        else {
          database.prepare('DELETE FROM payment_settlements WHERE id = ?').run(s.id);
          removed += 1;
        }
      }
      if (row) refreshAggregates(reservationId, row, kept);
    })();
    return { removed };
  }

  // Rule 48 — `sync` on every stay that holds a settlement (the boot's pass). Returns how many it dropped.
  function syncAll() {
    if (!ready()) return 0;
    return database.prepare('SELECT DISTINCT reservationId FROM payment_settlements').all()
      .reduce((total, { reservationId }) => total + sync(reservationId).removed, 0);
  }

  function insert({ reservationId, targetKind, targetKey, paidDate, dueCents, shortfallCents = 0, shortfallKind = null, parts = [], lines }) {
    let id;
    database.transaction(() => {
      id = Number(database.prepare(`INSERT INTO payment_settlements (reservationId, targetKind, targetKey, paidDate, dueCents, shortfallCents, shortfallKind, parts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(Number(reservationId), targetKind, String(targetKey), paidDate, dueCents,
        shortfallCents, shortfallCents > 0 ? shortfallKind : null, JSON.stringify(parts)).lastInsertRowid);
      writeLines(id, lines);
    })();
    sync(reservationId);
    return id;
  }

  function replace(id, { paidDate, shortfallCents = 0, shortfallKind = null, lines }) {
    const current = findById(id);
    if (!current) return null;
    database.transaction(() => {
      database.prepare(`UPDATE payment_settlements SET paidDate = ?, shortfallCents = ?, shortfallKind = ?, updatedAt = datetime('now') WHERE id = ?`)
        .run(paidDate, shortfallCents, shortfallCents > 0 ? shortfallKind : null, Number(id));
      writeLines(Number(id), lines);
    })();
    sync(current.reservationId);
    return findById(id);
  }

  function removeForTarget(reservationId, kind, key) {
    if (!ready()) return;
    database.prepare('DELETE FROM payment_settlements WHERE reservationId = ? AND targetKind = ? AND targetKey = ?')
      .run(Number(reservationId), kind, String(key));
    sync(reservationId);
  }

  return { listFor, findById, listForTarget, insert, replace, removeForTarget, sync, syncAll, projectedAggregates, droppedBy };
}

const defaultModel = (() => {
  try {
    return buildModel(require('../database'));
  } catch {
    return null;
  }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel };
}
