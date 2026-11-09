/**
 * Recording a payment split over several methods (specs/mixed-method-payments.md §3.4-§3.6) — the one place
 * that writes a settlement, shared by the fiche's endpoints and the SAS plugin.
 *
 * The ordinary gesture (a bucket marked paid, the single arrival payment, a note settled, an installment
 * collected) writes the paid flags with all its guards, exactly as before. This service validates the lines
 * BEFORE that gesture (`prepare`) and records them right AFTER it (`record`): which buckets the gesture just
 * paid (`flippedParts`), the settlement and its lines, the target's caisse-interne flag (rule 11) and one
 * history entry (rule 14).
 *
 * `collectRemainder` (rule 17) and `modify` (rules 20-25) act on settlements already recorded.
 */

const db = require('../database');
const settlementsModel = require('../models/paymentSettlementsModel');
const {
  validateSettlement, targetFigures, currentCentsOf, settlementText, frDate, euros, METHODS, toCents,
} = require('./paymentTenders');
const { parseGroup, serialiseGroup } = require('./arrivalPaymentGroup');
const { parseNotes } = require('./midStayExtras');
const { comptaCollected } = require('./reservationSettlement');
const { validateCollectionDate } = require('./arrivalPaymentDate');

const BUCKETS = ['deposit', 'balance', 'complement', 'endOfStayComplement'];
const BUCKET_LABEL = {
  deposit: 'Acompte',
  balance: 'Solde',
  complement: "Complément d'arrivée",
  endOfStayComplement: 'Fin de séjour',
};
const AMOUNT_COLUMN = {
  deposit: 'depositAmount',
  balance: 'balanceAmount',
  complement: 'complementAmount',
  endOfStayComplement: 'endOfStayComplementAmount',
};

const cents = (euroAmount) => Math.round((Number(euroAmount) || 0) * 100);
const isPaid = (row, bucket) => Number(row && row[`${bucket}Paid`] || 0) === 1 || Number(row && row[`${bucket}PaidCash`] || 0) === 1;
const getRow = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));

function addHistory(reservationId, change) {
  try {
    db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)')
      .run(Number(reservationId), 'update', JSON.stringify([change]));
  } catch {
    // A minimal test schema without the history table: the payment stands anyway.
  }
}

/**
 * Rules 4-9, 15 — validates the lines before the gesture runs. `allInternal` is the caisse-interne flag the
 * gesture must write (rule 11): every line in the caisse and nothing left to collect.
 */
function prepare({ tenders, dueCents, shortfall }) {
  const v = validateSettlement({ tenders, dueCents, shortfall });
  if (!v.ok) return v;
  return { ...v, dueCents: toCents(dueCents), allInternal: v.lines.every((l) => l.internal) && v.shortfallKind !== 'due' };
}

// The buckets a gesture just paid: unpaid in `before`, paid in `after`, with the amount they were paid at.
function flippedParts(before, after) {
  return BUCKETS
    .filter((b) => !isPaid(before, b) && isPaid(after, b))
    .map((b) => ({ kind: b, key: b, amountCents: cents(after[AMOUNT_COLUMN[b]]) }));
}

function targetLabel(targetKind, targetKey, parts = []) {
  if (targetKind === 'arrivalGroup') return 'Paiement unique';
  if (targetKind === 'midStayNote') return 'Note en séjour';
  if (targetKind === 'installment') return 'Échéance';
  return BUCKET_LABEL[(parts[0] && parts[0].kind) || targetKey] || 'Paiement';
}

// A target's figures at what it is worth now (rule 39): a bucket's amount may have moved since it was settled.
function figuresNow(reservationId, settlements) {
  return targetFigures(settlements, { currentCents: currentCentsOf(settlements[0] && settlements[0].parts, getRow(reservationId)) });
}

/**
 * Rule 11 — the target's own caisse-interne flag follows its settlements: set only when every line of every
 * settlement is in the caisse and nothing is left to collect. Refreshes the stay's aggregates.
 */
function applyCashFlag(reservationId, targetKind, targetKey) {
  const settlements = settlementsModel.listForTarget(reservationId, targetKind, targetKey);
  if (settlements.length === 0) return;
  const flag = figuresNow(reservationId, settlements).allInternal ? 1 : 0;
  const parts = settlements[0].parts || [];
  db.transaction(() => {
    const row = getRow(reservationId);
    if (targetKind === 'bucket') {
      for (const p of parts) {
        if (BUCKETS.includes(p.kind)) db.prepare(`UPDATE reservations SET ${p.kind}PaidCash = ? WHERE id = ?`).run(flag, Number(reservationId));
      }
    } else if (targetKind === 'arrivalGroup') {
      const group = parseGroup(row && row.arrivalPaymentGroup);
      if (group) {
        db.prepare('UPDATE reservations SET arrivalPaymentGroup = ? WHERE id = ?').run(serialiseGroup({ ...group, cash: flag }), Number(reservationId));
        for (const b of group.buckets) db.prepare(`UPDATE reservations SET ${b}PaidCash = ? WHERE id = ?`).run(flag, Number(reservationId));
      }
    } else if (targetKind === 'midStayNote') {
      const notes = parseNotes(row && row.midStaySettledNotes);
      const next = notes.map((n) => (String(n.id) === String(targetKey) ? { ...n, paidCash: flag } : n));
      db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(next), Number(reservationId));
    }
  })();
  settlementsModel.sync(reservationId);
}

/**
 * Records the settlement of a gesture that just succeeded (rules 10-14).
 * @returns {{ ok:true, settlementId:number } | { ok:false, status:number, error:string }}
 */
function record({ reservationId, targetKind, targetKey, paidDate, prepared, parts }) {
  if (!Array.isArray(parts) || parts.length === 0) return { ok: false, status: 409, error: 'Rien n\'a été encaissé.' };
  const settlementId = settlementsModel.insert({
    reservationId,
    targetKind,
    targetKey,
    paidDate: String(paidDate).slice(0, 10),
    dueCents: prepared.dueCents,
    shortfallCents: prepared.shortfallCents,
    shortfallKind: prepared.shortfallKind,
    parts,
    lines: prepared.lines,
  });
  applyCashFlag(reservationId, targetKind, targetKey);
  const s = settlementsModel.findById(settlementId);
  addHistory(reservationId, {
    field: 'mixedPayment',
    label: `${targetLabel(targetKind, targetKey, parts)} payé le ${frDate(s.paidDate)}`,
    from: '',
    to: settlementText(s),
  });
  return { ok: true, settlementId };
}

const todayIso = () => require('./reservationHelpers').getTodayIsoDate();

// The same day every payment mark accepts: a real calendar day, not in the future, not before today − 5 years.
function checkedDate(date) {
  return validateCollectionDate(date, { today: todayIso(), invalidReason: 'Date invalide.' });
}

// The bank reconciliation already matched a line of this settlement: the plugin's table, when it exists.
function reconciledRefusal(reservationId, settlementId) {
  try {
    const hit = db.prepare('SELECT 1 FROM bank_reconciliation_lines WHERE reservationId = ? AND ledgerKey = ?')
      .get(Number(reservationId), `settlement-${settlementId}`);
    return hit ? 'Déjà rapproché avec la banque : défaites le rapprochement d\'abord.' : null;
  } catch {
    return null;
  }
}

// specs/reservation-refunds.md rule 52 — what stays on the books never drops below the book refunds.
function refundRefusal(reservationId) {
  const row = getRow(reservationId);
  if (!row) return null;
  let refunded = 0;
  try {
    refunded = Number(require('../models/refundsModel').totalsByReservation(Number(reservationId)).book) || 0;
  } catch {
    refunded = 0;
  }
  if (refunded <= 0) return null;
  return comptaCollected({ ...row, refundsBookTtc: 0 }) + 0.005 < refunded
    ? 'Un remboursement a déjà été fait sur cet encaissement : il ne peut plus baisser.'
    : null;
}

// The target's own paid date follows its first settlement (rule 20: the date moves with the correction).
function moveTargetDate(reservationId, settlement, date) {
  if (settlement.targetKind === 'bucket') {
    for (const p of settlement.parts) {
      if (BUCKETS.includes(p.kind)) db.prepare(`UPDATE reservations SET ${p.kind}PaidDate = ? WHERE id = ?`).run(date, Number(reservationId));
    }
    return;
  }
  const row = getRow(reservationId);
  if (settlement.targetKind === 'arrivalGroup') {
    const group = parseGroup(row && row.arrivalPaymentGroup);
    if (!group) return;
    db.prepare('UPDATE reservations SET arrivalPaymentGroup = ? WHERE id = ?').run(serialiseGroup({ ...group, at: date }), Number(reservationId));
    for (const b of group.buckets) db.prepare(`UPDATE reservations SET ${b}PaidDate = ? WHERE id = ?`).run(date, Number(reservationId));
    db.prepare("UPDATE payment_settlements SET targetKey = ? WHERE reservationId = ? AND targetKind = 'arrivalGroup' AND targetKey = ?")
      .run(date, Number(reservationId), String(settlement.targetKey));
  } else if (settlement.targetKind === 'midStayNote') {
    const notes = parseNotes(row && row.midStaySettledNotes)
      .map((n) => (String(n.id) === String(settlement.targetKey) ? { ...n, paidDate: date } : n));
    db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(notes), Number(reservationId));
  } else if (settlement.targetKind === 'installment') {
    db.prepare('UPDATE reservation_installments SET paidDate = ? WHERE id = ? AND reservationId = ?')
      .run(date, Number(settlement.targetKey), Number(reservationId));
  }
}

/**
 * Rule 17 — collects (part of) the reste à percevoir of a target, as a settlement of its own.
 */
function collectRemainder({ reservationId, targetKind, targetKey, date, tenders, shortfall }) {
  const settlements = settlementsModel.listForTarget(reservationId, targetKind, targetKey);
  const last = settlements[settlements.length - 1];
  // Rule 39 — the reste is read at what the target is worth now: a rise since the payment is to collect too.
  const dueCents = last ? Math.round(figuresNow(reservationId, settlements).shortfallDueCents) : 0;
  if (!(dueCents > 0)) {
    return { ok: false, status: 409, error: 'Plus rien à percevoir sur ce paiement.' };
  }
  const checked = checkedDate(date);
  if (!checked.ok) return { ok: false, status: 400, error: checked.reason, field: 'date' };
  const prepared = prepare({ tenders, dueCents, shortfall });
  if (!prepared.ok) return { ok: false, status: 400, error: prepared.error, field: prepared.field };
  const settlementId = settlementsModel.insert({
    reservationId, targetKind, targetKey, paidDate: checked.date, dueCents: prepared.dueCents,
    shortfallCents: prepared.shortfallCents, shortfallKind: prepared.shortfallKind, parts: last.parts, lines: prepared.lines,
  });
  applyCashFlag(reservationId, targetKind, targetKey);
  const s = settlementsModel.findById(settlementId);
  addHistory(reservationId, {
    field: 'mixedPayment',
    label: `${targetLabel(targetKind, targetKey, last.parts)} : reste payé le ${frDate(checked.date)}`,
    from: `reste à percevoir ${euros(dueCents)}`,
    to: settlementText(s),
  });
  return { ok: true, settlementId };
}

/**
 * Rules 20-25 — replaces a settlement's date, lines and shortfall.
 */
function modify({ reservationId, settlementId, date: rawDate, tenders, shortfall }) {
  const current = settlementsModel.findById(settlementId);
  if (!current || Number(current.reservationId) !== Number(reservationId)) {
    return { ok: false, status: 404, error: 'Encaissement introuvable.' };
  }
  const checked = checkedDate(rawDate);
  if (!checked.ok) return { ok: false, status: 400, error: checked.reason, field: 'date' };
  const { date } = checked;
  const prepared = prepare({ tenders, dueCents: current.dueCents, shortfall });
  if (!prepared.ok) return { ok: false, status: 400, error: prepared.error, field: prepared.field };
  const siblings = settlementsModel.listForTarget(reservationId, current.targetKind, current.targetKey);
  const index = siblings.findIndex((s) => s.id === current.id);
  const next = siblings[index + 1];
  // Rule 25 — a remainder already collected rests on this settlement's reste: it cannot change under it.
  if (next && (prepared.shortfallKind !== 'due' || prepared.shortfallCents !== current.shortfallCents)) {
    return { ok: false, status: 409, error: `Un reste a déjà été encaissé le ${frDate(next.paidDate)} : modifiez-le d'abord.` };
  }
  const reconciled = reconciledRefusal(reservationId, current.id);
  if (reconciled) return { ok: false, status: 409, error: reconciled };

  const before = { ...current };
  settlementsModel.replace(current.id, {
    paidDate: date, shortfallCents: prepared.shortfallCents, shortfallKind: prepared.shortfallKind, lines: prepared.lines,
  });
  if (index === 0 && date !== current.paidDate) moveTargetDate(reservationId, current, date);
  applyCashFlag(reservationId, current.targetKind, index === 0 && current.targetKind === 'arrivalGroup' ? date : current.targetKey);

  const refused = refundRefusal(reservationId);
  if (refused) {
    // Put everything back as it was: the correction would leave the books under what was refunded.
    settlementsModel.replace(current.id, {
      paidDate: before.paidDate, shortfallCents: before.shortfallCents, shortfallKind: before.shortfallKind, lines: before.tenders,
    });
    if (index === 0 && date !== before.paidDate) {
      moveTargetDate(reservationId, { ...before, targetKey: current.targetKind === 'arrivalGroup' ? date : before.targetKey }, before.paidDate);
    }
    applyCashFlag(reservationId, current.targetKind, before.targetKey);
    return { ok: false, status: 409, error: refused };
  }

  const after = settlementsModel.findById(current.id);
  addHistory(reservationId, {
    field: 'mixedPayment',
    label: `${targetLabel(current.targetKind, current.targetKey, current.parts)} corrigé`,
    from: `${settlementText(before)}${before.paidDate !== after.paidDate ? ` le ${frDate(before.paidDate)}` : ''}`,
    to: `${settlementText(after)}${before.paidDate !== after.paidDate ? ` le ${frDate(after.paidDate)}` : ''}`,
  });
  return { ok: true, settlement: after };
}

module.exports = {
  METHODS, toCents, prepare, flippedParts, record, applyCashFlag, collectRemainder, modify, targetLabel, getRow,
};
