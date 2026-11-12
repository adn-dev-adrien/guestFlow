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
const { postesLeftOf } = require('../utils/pricing/refunds/overpayment');
const { extraLineKey } = require('../utils/pricing/storedLines');
const { readComplementPaidSplit } = require('../utils/complementPaidSplit');
const { parseRemovedLineContribs } = require('../utils/removedLineContribs');

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

// What `collectedByLine` reads where allocations name a line (rule 74): the stay's payment rows, and the refs of its
// two stay lines (the accommodation and the tourist tax carry no row of the three line tables).
function lineAllocationsContext(db, reservationId) {
  const allocations = paymentLedger.create(db).allocations(reservationId)
    .filter((a) => a.kind === 'payment')
    .map((a) => ({ lineRef: a.lineRef, amountCents: Number(a.amountCents), books: Number(a.books) }));
  const stayLineRefs = { accommodation: null, touristTax: null };
  const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservation_stay_lines'").get();
  if (present) {
    for (const row of db.prepare('SELECT id, kind FROM reservation_stay_lines WHERE reservationId = ?').all(reservationId)) stayLineRefs[row.kind] = `line:reservation_stay_lines:${row.id}`;
  }
  return { allocations, stayLineRefs };
}

// The stored lines of a stay with the ref a payment allocation names them by (rule 74).
function storedLinesOf(db, reservationId) {
  const read = (table, sql, make) => (hasTable(db, table) ? db.prepare(sql).all(reservationId).map(make) : []);
  return [
    ...read('reservation_options', 'SELECT lineId, optionId, totalPrice, offered FROM reservation_options WHERE reservationId = ?',
      (r) => ({ ref: `line:reservation_options:${r.lineId}`, key: extraLineKey({ optionId: r.optionId }), poste: 'options', totalPrice: r.totalPrice, offered: r.offered })),
    ...read('reservation_resources', 'SELECT lineId, resourceId, totalPrice, offered FROM reservation_resources WHERE reservationId = ?',
      (r) => ({ ref: `line:reservation_resources:${r.lineId}`, key: extraLineKey({ resourceId: r.resourceId }), poste: 'resources', totalPrice: r.totalPrice, offered: r.offered })),
    ...read('reservation_custom_options', 'SELECT lineId, description, amount, offered FROM reservation_custom_options WHERE reservationId = ?',
      (r) => ({ ref: `line:reservation_custom_options:${r.lineId}`, key: extraLineKey({ isCustom: true, description: r.description }), poste: 'options', totalPrice: r.amount, offered: r.offered })),
  ];
}

const isComplementRef = (paymentRef, complementSettlements) => paymentRef === 'bucket:complement'
  || [...complementSettlements].some((id) => paymentRef === `settlement:${id}` || paymentRef === `settlement:${id}:caisse`);

/**
 * Rules 74 and 76 — what left the stay since it was paid, per poste, read from its lines and the payments that name them (no audit
 * log): `scope 'schedule'` is the acompte, the solde, the installments and the notes; `'complement'` the arrival complement, whose lines
 * are the allocations that name a line plus the lines of its frozen split (a line the stay no longer holds names none).
 * `quote` is the stay as a save would store it; absent, the stored lines are the reference. Euros per poste.
 */
function postesLeft(db, reservationId, { scope, quote = null }) {
  const stays = stayRepository.create(db);
  const row = stays.stayRow(reservationId);
  if (!row) return { options: 0, resources: 0, touristTax: 0 };
  const lines = storedLinesOf(db, reservationId);
  const posteOfRef = new Map(lines.map((line) => [line.ref, line]));
  const stayLineRefs = lineAllocationsContext(db, reservationId).stayLineRefs;
  const complementSettlements = new Set();
  if (hasTable(db, 'payment_settlements')) {
    for (const s of db.prepare('SELECT id, parts FROM payment_settlements WHERE reservationId = ?').all(reservationId)) {
      const kinds = parseParts(s.parts).map((p) => p.kind);
      if (kinds.length > 0 && kinds.every((kind) => kind === 'complement')) complementSettlements.add(String(s.id));
    }
  }
  const inScope = (paymentRef) => (scope === 'complement') === isComplementRef(paymentRef, complementSettlements)
    && (scope === 'complement' || !/^(bucket:endOfStay|note:)/.test(String(paymentRef)));
  const collected = [];
  for (const a of paymentLedger.create(db).allocations(reservationId)) {
    if (a.kind !== 'payment' || !a.lineRef || !inScope(a.paymentRef)) continue;
    const line = posteOfRef.get(a.lineRef);
    if (line) collected.push({ key: line.key, poste: line.poste, collectedCents: Number(a.amountCents) });
    else if (a.lineRef === stayLineRefs.touristTax) collected.push({ key: 'touristTax', poste: 'touristTax', collectedCents: Number(a.amountCents) });
  }
  if (scope === 'complement') {
    const split = readComplementPaidSplit(row);
    const named = new Set(collected.map((entry) => entry.key));
    for (const line of (split && split.lines) || []) {
      if (!named.has(line.key)) collected.push({ key: line.key, poste: line.bucket === 'resources' ? 'resources' : 'options', collectedCents: Number(line.cents) });
    }
    if (row.complementCollectedTax != null) {
      for (let i = collected.length - 1; i >= 0; i -= 1) if (collected[i].key === 'touristTax') collected.splice(i, 1);
      collected.push({ key: 'touristTax', poste: 'touristTax', collectedCents: toCents(row.complementCollectedTax) });
    }
  } else {
    for (const entry of parseRemovedLineContribs(row.removedLineContribs)) {
      collected.push({ key: entry.key, poste: entry.bucket === 'resources' ? 'resources' : 'options', collectedCents: toCents(Number(entry.acompteContribTtc || 0) + Number(entry.soldeContribTtc || 0)) });
    }
  }
  const current = new Map();
  const add = (key, euros) => current.set(key, (current.get(key) || 0) + toCents(euros));
  if (quote) {
    for (const line of [...(quote.optionLines || []), ...(quote.resourceLines || [])]) if (!Number(line.offered || 0)) add(extraLineKey(line), line.totalPrice);
    add('touristTax', quote.touristTaxTotal);
  } else {
    for (const line of lines) if (!Number(line.offered || 0)) add(line.key, line.totalPrice);
    add('touristTax', row.touristTaxTotal);
  }
  return postesLeftOf(collected, current);
}

module.exports = { overpaymentContext, lineAllocationsContext, postesLeft };
