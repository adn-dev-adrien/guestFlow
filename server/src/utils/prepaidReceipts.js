/**
 * Money a stay received in advance from a plugin's prepaid instrument (SDK 2.33.0, specs/mixed-method-payments.md rule 51),
 * written where every reader of the stay's money already looks: a settlement whose tender line has the method `prepaid`
 * (`paymentTenders.PREPAID`). The stay's price, tourist tax, commission and statistics are those of the same stay paid by card:
 * the line only says HOW a part of its acompte or solde was received.
 *
 *   allocate(...)            the earliest amounts first — the acompte, then the solde (pure);
 *   settleAtConversion(...)  a quote with a hold became a stay: the source redeems what the stay takes, and each bucket the
 *                            prepaid money touched gets one settlement — the prepaid line and, beside it, the card line of
 *                            the payment link that paid the rest;
 *   confirmWithoutLink(...)  nothing is due now: the quote becomes a stay through the same effect a paid link has;
 *   recordOnStay(...)        the fiche takes prepaid money on a stay already confirmed (acompte, then solde, then a reste);
 *   undoOnStay(...)          takes back what `recordOnStay` wrote;
 *   receivedOn(...)          the prepaid lines of a source on a stay, for the plugin's own screens.
 *
 * Not collected twice: a prepaid line is never expected at the bank (`BANK_METHODS`) and never an encaissement of the books
 * (`settlementFigures().collectedCents`) — the instrument's own sale was.
 */

const { PREPAID, settlementText, targetFigures, currentCentsOf, frDate } = require('./paymentTenders');
const { toCentsOrZero: cents } = require('./pricing/money');
const prepaidSources = require('./prepaidSources');

const BUCKETS = ['deposit', 'balance'];
const BUCKET_LABEL = { deposit: 'Acompte', balance: 'Solde' };
const AMOUNT_COLUMN = { deposit: 'depositAmount', balance: 'balanceAmount' };
const PAID_COLUMN = { deposit: ['depositPaid', 'depositPaidDate'], balance: ['balancePaid', 'balancePaidDate'] };

const settlementsOf = (database) => require('../models/paymentSettlementsModel').buildModel(database);

/** Rule 38 — the prepaid amount pays the acompte first, then the solde; what exceeds both is not used. */
function allocate({ depositCents, balanceCents, prepaidCents }) {
  const deposit = Math.min(Math.max(0, prepaidCents), Math.max(0, depositCents));
  const balance = Math.min(Math.max(0, prepaidCents) - deposit, Math.max(0, balanceCents));
  return { deposit, balance, usedCents: deposit + balance };
}

function addHistory(database, reservationId, change) {
  try {
    database.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)')
      .run(Number(reservationId), 'update', JSON.stringify([change]));
  } catch {
    // A minimal test schema without the history table: the payment stands anyway.
  }
}

const stayRow = (database, id) => database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
const isPaid = (row, bucket) => Number(row && row[PAID_COLUMN[bucket][0]] || 0) === 1;

function writeSettlement(database, { stayId, bucket, dueCents, paidDate, lines, label }) {
  const received = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const shortfallCents = Math.max(0, dueCents - received);
  const model = settlementsOf(database);
  const settlementId = model.insert({
    reservationId: stayId,
    targetKind: 'bucket',
    targetKey: bucket,
    paidDate: String(paidDate).slice(0, 10),
    dueCents,
    shortfallCents,
    shortfallKind: shortfallCents > 0 ? 'due' : null,
    parts: [{ kind: bucket, key: bucket, amountCents: dueCents }],
    lines,
  });
  const written = model.findById(settlementId);
  addHistory(database, stayId, {
    field: 'mixedPayment',
    label: `${label || BUCKET_LABEL[bucket]} payé le ${frDate(written.paidDate)}`,
    from: '',
    to: settlementText(written),
  });
  return settlementId;
}

/**
 * A quote holding prepaid money just became the stay `stayId` and its buckets are paid: the sources redeem what the stay takes
 * (the rest of a hold is given back) and each bucket they paid gets its settlement. `linkType` / `linkCents` describe the
 * payment link that paid the rest (none when nothing was due); a link that charged another amount than planned leaves the
 * difference as a reste à percevoir of the bucket, never silently.
 * → `{ usedCents, settlements: [{ bucket, settlementId }] }`, or null when the quote held nothing.
 */
function settleAtConversion({
  database, devisId, stayId, linkType = null, linkCents = 0, paidDate,
}) {
  const held = prepaidSources.heldFor(devisId);
  if (held.length === 0) return null;
  const stay = stayRow(database, stayId);
  if (!stay) return null;
  const depositCents = cents(stay.depositAmount);
  const balanceCents = cents(stay.balanceAmount);
  const written = [];
  let usedCents = 0;
  let cardLeft = Math.max(0, Number(linkCents) || 0);
  let allocatable = { deposit: depositCents, balance: balanceCents };
  held.forEach((h) => {
    const source = prepaidSources.byKind(h.source);
    const share = allocate({ depositCents: allocatable.deposit, balanceCents: allocatable.balance, prepaidCents: h.amountCents });
    const settled = source.settle({
      devisId: Number(devisId), reservationId: Number(stayId), amountCents: share.usedCents, paidDate,
    });
    if (!settled || !(share.usedCents > 0)) return;
    usedCents += share.usedCents;
    BUCKETS.forEach((bucket) => {
      const prepaid = share[bucket];
      // A bucket the payment did not mark paid has no settlement to carry (the model drops it): the redeem stands, the stay's
      // own flags say what was received.
      if (!(prepaid > 0) || !isPaid(stayRow(database, stayId), bucket)) return;
      const bucketCents = bucket === 'deposit' ? depositCents : balanceCents;
      const covered = linkType === 'full' || (linkType === 'deposit' && bucket === 'deposit');
      const card = covered ? Math.min(cardLeft, Math.max(0, bucketCents - prepaid)) : 0;
      cardLeft -= card;
      const lines = [{
        method: PREPAID, amountCents: prepaid, internal: false, source: h.source, ref: String(settled.ref), label: h.label,
      }, ...(card > 0 ? [{ method: 'card', amountCents: card, internal: false }] : [])];
      written.push({ bucket, settlementId: writeSettlement(database, { stayId, bucket, dueCents: bucketCents, paidDate, lines }) });
    });
    allocatable = { deposit: allocatable.deposit - share.deposit, balance: allocatable.balance - share.balance };
  });
  return { usedCents, settlements: written };
}

/**
 * Rule 38 — nothing is due now (the held amount covers what the chosen mode asks): no link is minted and the quote becomes a
 * stay through the effect a paid link has — converted, its acompte (and solde, when covered) paid, the guest confirmed.
 * `deps` are the ones `processPaidLink` takes (`utils/paymentEffectDeps`), injected for a suite.
 */
async function confirmWithoutLink({
  database, devisModel, devisId, mode, paidDate, deps = null, recordPayment = null,
}) {
  const {
    sendConfirmation, checkConflict, notifyConflict, emitPluginEvent = require('../plugins/sdk/eventBus').emit,
  } = deps || require('./paymentEffectDeps').buildPaymentEffectDeps();
  const record = recordPayment || ((payment) => {
    const { recordStayPayment, depsFor } = require('./stayPaymentRecorder');
    return recordStayPayment(depsFor(database), { ...payment, keepPaymentOnCaptureFailure: true });
  });
  const linkType = mode === 'deposit' ? 'deposit' : 'full';
  const converted = devisModel.convertToReservation(Number(devisId), { allowConflict: true, paidLinkType: linkType });
  if (converted && converted.error) return { ok: false, error: converted.error };
  const stayId = converted.data.reservationId;
  const stay = stayRow(database, stayId);
  const held = prepaidSources.heldCentsFor(devisId);
  const share = allocate({ depositCents: cents(stay.depositAmount), balanceCents: cents(stay.balanceAmount), prepaidCents: held });
  // A solde only partly covered is still marked paid: the settlement says what is left to collect.
  if (share.deposit > 0 || cents(stay.depositAmount) === 0) record({ reservationId: stayId, bucket: 'deposit', paidDate });
  if (share.balance > 0) record({ reservationId: stayId, bucket: 'balance', paidDate });
  const settled = settleAtConversion({
    database, devisId, stayId, linkType, linkCents: 0, paidDate,
  });
  let conflict = false;
  try { conflict = Boolean(checkConflict && checkConflict({ reservationId: stayId })); } catch { conflict = false; }
  if (conflict) database.prepare('UPDATE reservations SET bookingConflictAt = ? WHERE id = ? AND bookingConflictAt IS NULL').run(new Date().toISOString(), Number(stayId));
  emitPluginEvent('reservation.created', { reservationId: stayId });
  if (sendConfirmation && !conflict) { try { await sendConfirmation(stayId); } catch { /* logged inside the sender */ } }
  if (conflict && notifyConflict) { try { await notifyConflict(stayId); } catch { /* best effort */ } }
  return { ok: true, reservationId: stayId, conflict, settled };
}

/** What each bucket of a stay still asks, the earliest first: `[{ bucket, dueCents, open }]` — `open` when it is not paid yet. */
function owedOnStay(database, stayId) {
  const stay = stayRow(database, stayId);
  if (!stay || stay.kind !== 'reservation') return [];
  const model = settlementsOf(database);
  return BUCKETS.flatMap((bucket) => {
    const amount = cents(stay[AMOUNT_COLUMN[bucket]]);
    if (!isPaid(stay, bucket)) return amount > 0 ? [{ bucket, dueCents: amount, open: true }] : [];
    const list = model.listForTarget(stayId, 'bucket', bucket);
    if (list.length === 0) return [];
    const due = Math.round(targetFigures(list, { currentCents: currentCentsOf(list[0].parts, stay) }).shortfallDueCents);
    return due > 0 ? [{ bucket, dueCents: due, open: false }] : [];
  });
}

const owedCentsOn = (database, stayId) => owedOnStay(database, stayId).reduce((sum, o) => sum + o.dueCents, 0);

/**
 * The fiche takes `amountCents` of a prepaid instrument on a confirmed stay: the acompte first, then the solde, then a reste
 * already open. An acompte unpaid is paid whole or not at all (specs/mixed-method-payments.md rule 44).
 * → `{ ok: true, appliedCents, settlements }` or `{ ok: false, status, error }`.
 */
function recordOnStay({
  database, stayId, source, ref, label, amountCents, paidDate, recordPayment = null,
}) {
  const owed = owedOnStay(database, stayId);
  const total = owed.reduce((sum, o) => sum + o.dueCents, 0);
  if (!(amountCents > 0)) return { ok: false, status: 400, error: 'Montant invalide.' };
  if (total <= 0) return { ok: false, status: 409, error: 'Rien à payer sur ce séjour.' };
  if (amountCents > total) return { ok: false, status: 400, error: 'Le montant dépasse ce que le séjour doit encore.' };
  const record = recordPayment || ((payment) => {
    const { recordStayPayment, depsFor } = require('./stayPaymentRecorder');
    return recordStayPayment(depsFor(database), { ...payment, keepPaymentOnCaptureFailure: true, origin: 'fiche' });
  });
  const first = owed[0];
  if (first.open && first.bucket === 'deposit' && amountCents < first.dueCents) {
    return { ok: false, status: 400, error: 'L’acompte se règle en entier : montant minimum de l’acompte.' };
  }
  const written = [];
  let left = amountCents;
  database.transaction(() => {
    owed.forEach((o) => {
      if (!(left > 0)) return;
      const take = Math.min(left, o.dueCents);
      if (o.open && o.bucket === 'deposit' && take < o.dueCents) return;
      if (o.open) record({ reservationId: stayId, bucket: o.bucket, paidDate });
      const line = {
        method: PREPAID, amountCents: take, internal: false, source, ref: String(ref), label,
      };
      written.push({ bucket: o.bucket, amountCents: take, settlementId: writeSettlement(database, { stayId, bucket: o.bucket, dueCents: o.dueCents, paidDate, lines: [line] }) });
      left -= take;
    });
  }).immediate();
  return { ok: true, appliedCents: amountCents - left, settlements: written };
}

/** The prepaid lines of `source` on a stay, one per settlement: `[{ settlementId, bucket, ref, amountCents, paidDate, onlyPrepaid }]`. */
function receivedOn(database, stayId, source) {
  return settlementsOf(database).listFor(stayId).flatMap((s) => {
    const mine = s.tenders.filter((t) => t.method === PREPAID && t.source === source);
    if (mine.length === 0) return [];
    return [{
      settlementId: s.id,
      bucket: s.targetKey,
      ref: mine[0].ref,
      amountCents: mine.reduce((sum, t) => sum + t.amountCents, 0),
      paidDate: s.paidDate,
      onlyPrepaid: s.tenders.every((t) => t.method === PREPAID),
    }];
  });
}

/**
 * Takes back the fiche payments of `ref` (`recordOnStay`). A settlement shared with another method (the conversion's, with the
 * card line) is the booking's own and is refused; so is one a later settlement of the same bucket rests on, and a take-back that
 * would leave refunds above what stays collected.
 * → `{ ok: true, removedCents }` or `{ ok: false, status, error }`.
 */
function undoOnStay({ database, stayId, source, ref }) {
  const model = settlementsOf(database);
  const mine = receivedOn(database, stayId, source).filter((r) => String(r.ref) === String(ref));
  if (mine.length === 0) return { ok: false, status: 404, error: 'Paiement introuvable.' };
  if (mine.some((r) => !r.onlyPrepaid)) return { ok: false, status: 409, error: 'Ce bon a servi à la réservation en ligne : il ne peut pas être repris ici.' };
  const all = model.listFor(stayId);
  const stay = stayRow(database, stayId);
  if (!stay) return { ok: false, status: 404, error: 'Séjour introuvable.' };
  const { comptaCollected } = require('./reservationSettlement');
  const { takeBackRefusal } = require('./pricing/refunds/judge');
  const { clearContribsOnUnflip } = require('./forceItemContribsCapture');
  const reservationsModel = require('../models/reservationsModel');
  const model2 = database === require('../database') ? reservationsModel : reservationsModel.create(database);
  let removedCents = 0;
  let refusal = null;
  const take = database.transaction(() => {
    mine.forEach((r) => {
      if (refusal) return;
      const siblings = all.filter((s) => s.targetKind === 'bucket' && s.targetKey === r.bucket);
      const index = siblings.findIndex((s) => s.id === r.settlementId);
      if (index === 0 && siblings.length > 1) {
        refusal = { ok: false, status: 409, error: 'Un reste a déjà été encaissé sur ce poste : le défaire d’abord.' };
        return;
      }
      if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bank_reconciliation_lines'").get()
        && database.prepare('SELECT 1 FROM bank_reconciliation_lines WHERE reservationId = ? AND ledgerKey = ? LIMIT 1').get(Number(stayId), `settlement-${r.settlementId}`)) {
        refusal = { ok: false, status: 409, error: 'Déjà rapproché avec la banque : défaire le rapprochement d’abord.' };
        return;
      }
      const before = comptaCollected(stayRow(database, stayId));
      database.prepare('DELETE FROM payment_settlements WHERE id = ?').run(r.settlementId);
      if (index === 0) {
        const [flag, date] = PAID_COLUMN[r.bucket];
        clearContribsOnUnflip({ db: database, reservationId: Number(stayId), bucket: r.bucket });
        if (r.bucket === 'deposit') database.prepare('UPDATE reservations SET depositAmountOverride = depositAmount WHERE id = ? AND depositAmount > 0').run(Number(stayId));
        database.prepare(`UPDATE reservations SET ${flag} = 0, ${date} = NULL, updatedAt = datetime('now') WHERE id = ?`).run(Number(stayId));
        model2.releaseStayBucket(Number(stayId), r.bucket);
      }
      model.sync(stayId);
      let refunds = [];
      try { refunds = require('../models/refundsModel').listByReservation(Number(stayId)); } catch { refunds = []; }
      const guard = takeBackRefusal({
        beforeCents: Math.round(before * 100), afterCents: Math.round(comptaCollected({ ...stayRow(database, stayId), refundsBookTtc: 0 }) * 100), refunds,
      });
      if (guard) {
        refusal = { ok: false, status: 409, error: guard.body.error };
        return;
      }
      removedCents += r.amountCents;
      addHistory(database, stayId, {
        field: 'mixedPayment', label: `${BUCKET_LABEL[r.bucket]} : paiement prépayé annulé`, from: `${(r.amountCents / 100).toFixed(2).replace('.', ',')} €`, to: '',
      });
    });
    // Nothing is kept of a take-back that stopped half way: the rollback undoes the settlements already removed.
    if (refusal) throw Object.assign(new Error('REFUSED'), { refused: true });
  });
  try {
    take.immediate();
  } catch (err) {
    if (!err.refused) throw err;
  }
  return refusal || { ok: true, removedCents };
}

module.exports = {
  allocate, settleAtConversion, confirmWithoutLink, owedOnStay, owedCentsOn, recordOnStay, receivedOn, undoOnStay,
};
