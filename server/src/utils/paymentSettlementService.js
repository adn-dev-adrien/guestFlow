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
const { takeBackRefusal } = require('./pricing/refunds/judge');
const { validateCollectionDate } = require('./arrivalPaymentDate');
const { syncStay: syncAllocations } = require('./paymentAllocationsSync');

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

const { toCentsOrZero: cents } = require('./pricing/money');
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

const RECONCILED = 'Déjà rapproché avec la banque : défaites le rapprochement d\'abord.';
const TAKEN_BACK_IN_PART = 'Paiement en plusieurs moyens : annulez le paiement unique en entier.';
const CAISSE_SWITCH = 'Paiement en plusieurs moyens : passer par « Modifier ».';

// Whether the bank reconciliation holds a line on one of these receipt keys of the stay: the plugin's table, when it exists.
function hasBankLines(reservationId, keys) {
  if (!keys.length) return false;
  try {
    return Boolean(db.prepare(`SELECT 1 FROM bank_reconciliation_lines WHERE reservationId = ? AND ledgerKey IN (${keys.map(() => '?').join(',')}) LIMIT 1`)
      .get(Number(reservationId), ...keys));
  } catch {
    return false;
  }
}

// The receipts the reconciliation expects of a target as long as it is not split (expectedReceipts' ledger keys).
function plainReceiptKeys(target) {
  if (target.kind === 'installment') return target.installmentNumber != null ? [`installment-${target.installmentNumber}`] : [];
  const keys = (target.buckets || []).flatMap((b) => (b === 'complement' ? ['complement', 'checkoutComplement'] : [b]));
  return target.kind === 'arrivalGroup' ? ['group', ...keys] : keys;
}

/**
 * Rule 44 (audit R34-M-M1) — the acompte and the installments are the money a cancellation keeps and requalifies: on the
 * books whole or in the caisse whole, for their whole amount. An installment has no caisse interne at all.
 */
function retainedMoneyRefusal(target, prepared) {
  const lines = prepared.lines || [];
  if (target.kind === 'installment') {
    if (prepared.shortfallCents > 0) return 'Échéance : le montant entier, sans reste ni geste.';
    if (lines.some((l) => l.internal)) return 'Échéance : pas de caisse interne.';
    return null;
  }
  if (!(target.buckets || []).includes('deposit')) return null;
  if (prepared.shortfallCents > 0) return 'Acompte : le montant entier, sans reste ni geste.';
  if (lines.some((l) => l.internal) && lines.some((l) => !l.internal)) return 'Acompte : tout en compta ou tout en caisse interne.';
  return null;
}

/**
 * Rules 4-9, 15 — validates the lines before the gesture runs. `allInternal` is the caisse-interne flag the
 * gesture must write (rule 11): every line in the caisse and nothing left to collect.
 *
 * With `target` ({ kind, buckets, installmentNumber }) the target is judged too: rule 44 (the acompte and the
 * installments) and, with `reservationId`, rule 43 (a plain receipt of the target already matched at the bank, 409).
 */
function prepare({ tenders, dueCents, shortfall, reservationId = null, target = null }) {
  const v = validateSettlement({ tenders, dueCents, shortfall });
  if (!v.ok) return v;
  const prepared = { ...v, dueCents: toCents(dueCents), allInternal: v.lines.every((l) => l.internal) && v.shortfallKind !== 'due' };
  if (!target) return prepared;
  const retained = retainedMoneyRefusal(target, prepared);
  if (retained) return { ok: false, error: retained, field: 'tenders' };
  if (reservationId != null && hasBankLines(reservationId, plainReceiptKeys(target))) {
    return { ok: false, status: 409, code: 'SETTLEMENT_RECONCILED', error: RECONCILED, field: 'tenders' };
  }
  return prepared;
}

/**
 * Rule 43 (audit R34-EXT-1) — a gesture that would take back a split payment whose receipt is matched at the bank is
 * refused, like its correction (rule 22): the bank line would point at a receipt that no longer exists. Rule 51 — nor
 * one that would take back only part of a payment over several buckets; rule 53 — nor a caisse switch on a bucket a
 * payment with several methods paid.
 * @param {object} row the stay as stored; @param {object} changes the columns the gesture would write
 */
function takeBackReconciledRefusal(row, changes) {
  if (!row || row.id == null) return null;
  const next = { ...row, ...changes };
  const dropped = settlementsModel.droppedBy ? settlementsModel.droppedBy(next) : [];
  // Rule 51 (audit R34 NEW-2) — a payment that paid several buckets is taken back whole: un-paying one of them would
  // drop the settlement and leave the others paid in full on the books.
  const inPart = dropped.some((s) => {
    const buckets = (s.parts || []).map((p) => p.kind).filter((k) => BUCKETS.includes(k));
    return buckets.length > 1 && buckets.some((b) => isPaid(next, b));
  });
  if (inPart) return { status: 409, body: { error: TAKEN_BACK_IN_PART, code: 'SPLIT_TAKEN_BACK_IN_PART' } };
  // Rule 53 — nor is a bucket paid with several methods switched to or from the caisse interne: its lines say where its
  // money is (rule 11), and only their correction moves it.
  const droppedIds = new Set(dropped.map((s) => s.id));
  const switched = (settlementsModel.listFor ? settlementsModel.listFor(row.id) : [])
    .filter((s) => !droppedIds.has(s.id))
    .some((s) => (s.parts || []).some((p) => BUCKETS.includes(p.kind)
      && Number(next[`${p.kind}PaidCash`] || 0) !== Number(row[`${p.kind}PaidCash`] || 0)));
  if (switched) return { status: 409, body: { error: CAISSE_SWITCH, code: 'SPLIT_CAISSE_SWITCH' } };
  if (!hasBankLines(row.id, dropped.map((s) => `settlement-${s.id}`))) return null;
  return { status: 409, body: { error: RECONCILED, code: 'SETTLEMENT_RECONCILED' } };
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

// The bank reconciliation already matched a line of this settlement.
function reconciledRefusal(reservationId, settlementId) {
  return hasBankLines(reservationId, [`settlement-${settlementId}`]) ? RECONCILED : null;
}

// specs/reservation-refunds.md rule 52 — what stays on the books never drops below the book refunds: the one take-back guard of
// REFUNDS, judged on the collected amount before and after the correction (cents).
function refundRefusal(reservationId, collectedBefore) {
  const row = getRow(reservationId);
  if (!row) return null;
  let refunds = [];
  try {
    refunds = require('../models/refundsModel').listByReservation(Number(reservationId));
  } catch {
    refunds = [];
  }
  const refusal = takeBackRefusal({
    beforeCents: Math.round(collectedBefore * 100), afterCents: Math.round(comptaCollected({ ...row, refundsBookTtc: 0 }) * 100), refunds,
  });
  return refusal ? refusal.body.error : null;
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
  syncAllocations(db, reservationId);
}

// What a recorded settlement paid, as `prepare` judges a target.
function targetOf(settlement) {
  return {
    kind: settlement.targetKind,
    buckets: (settlement.parts || []).map((p) => p.kind).filter((k) => BUCKETS.includes(k)),
  };
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
  const prepared = prepare({ tenders, dueCents, shortfall, target: targetOf(last) });
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
  const prepared = prepare({ tenders, dueCents: current.dueCents, shortfall, target: targetOf(current) });
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
  const collectedBefore = comptaCollected({ ...getRow(reservationId), refundsBookTtc: 0 });
  settlementsModel.replace(current.id, {
    paidDate: date, shortfallCents: prepared.shortfallCents, shortfallKind: prepared.shortfallKind, lines: prepared.lines,
  });
  if (index === 0 && date !== current.paidDate) moveTargetDate(reservationId, current, date);
  applyCashFlag(reservationId, current.targetKind, index === 0 && current.targetKind === 'arrivalGroup' ? date : current.targetKey);

  const refused = refundRefusal(reservationId, collectedBefore);
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
  takeBackReconciledRefusal,
};
