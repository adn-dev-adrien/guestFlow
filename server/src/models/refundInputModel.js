/**
 * Refund input model — builds what REFUNDS reads about a stay (specs/pricing-components.md §3 rules 48, 72 and 76).
 *
 * The pure units of `utils/pricing/refunds/` never touch the database: this loader reads the stay's payment allocations through
 * the PaymentLedger port, its stored total through the StayRepository port, and its refunds, and hands them over as plain
 * values in cents. One place reads them, so the stored and the live trop-perçu cannot disagree on a source.
 *
 *   overpaymentContext(db, id, { autoComplementCents, engineDriftCents }) → the `ctx` of `refunds/overpayment.overpayment`
 */
const paymentLedger = require('./ports/paymentLedger');
const stayRepository = require('./ports/stayRepository');
const { parseParts } = require('../utils/paymentTenders');
const { storedMidStayLines } = require('../utils/midStayExtras');
const { readSplitReceived } = require('../utils/splitReceived');
const { toCents } = require('../utils/pricing/money');

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

// The paid complement the operator adjusted is left out of both sides (adjustable-complement-amounts): the allocations that
// paid it — the complement bucket, and a settlement that paid nothing else.
function adjustedComplementCents(db, row, allocations) {
  const adjusted = row.complementAmountOverride != null && row.complementAmountOverride !== '';
  const paid = Number(row.complementPaid || 0) === 1 || Number(row.complementPaidCash || 0) === 1;
  if (!adjusted || !paid) return 0;
  const complementSettlements = new Set();
  if (hasTable(db, 'payment_settlements')) {
    for (const s of db.prepare('SELECT id, parts FROM payment_settlements WHERE reservationId = ?').all(row.id)) {
      const kinds = parseParts(s.parts).map((p) => p.kind);
      if (kinds.length > 0 && kinds.every((kind) => kind === 'complement')) complementSettlements.add(String(s.id));
    }
  }
  return allocations.filter((a) => a.kind === 'payment' && (a.paymentRef === 'bucket:complement'
    || [...complementSettlements].some((id) => a.paymentRef === `settlement:${id}` || a.paymentRef === `settlement:${id}:caisse`)))
    .reduce((sum, a) => sum + Number(a.amountCents), 0);
}

// What the end-of-stay complement collected for the departure's own sales (damage, missing items, a cleaning the SAS sold):
// they are no line of the stay yet, so no part of its total pays for them. Its mid-stay lines are inside the price (the
// share it received, specs/mixed-method-payments.md rule 47); the rest is not a trop-perçu when it exceeds nothing.
function departureOwnCents(db, row) {
  const paid = Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1;
  const amount = toCents(row.endOfStayComplementAmount);
  if (!paid || amount <= 0) return 0;
  const received = readSplitReceived(db, row.id);
  const collected = received && received.endOfStayComplement != null ? Math.min(toCents(received.endOfStayComplement), amount) : amount;
  const inPrice = storedMidStayLines(row.endOfStayComplementDetail).reduce((sum, line) => sum + toCents(line.amount), 0);
  return Math.max(0, collected - Math.round((inPrice * collected) / amount));
}

function overpaymentContext(db, reservationId, { autoComplementCents = 0, engineDriftCents = 0 } = {}) {
  const ledger = paymentLedger.create(db);
  const stays = stayRepository.create(db);
  const row = stays.stayRow(reservationId);
  if (!row) return null;
  const allocations = ledger.allocations(reservationId);
  const price = stays.storedStayPrice(reservationId);
  return {
    platform: row.platform,
    paymentsCents: allocations.filter((a) => a.kind === 'payment').reduce((sum, a) => sum + Number(a.amountCents), 0),
    adjustedComplementCents: adjustedComplementCents(db, row, allocations),
    departureOwnCents: departureOwnCents(db, row),
    autoComplementCents,
    totalCents: price.totalCents,
    overpaymentRefundedCents: Math.round(require('./refundsModel').createModel(db).overpaymentRefundedTtc(reservationId) * 100),
    engineDriftCents,
  };
}

module.exports = { overpaymentContext };
