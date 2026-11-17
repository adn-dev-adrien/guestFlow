// Shared fixtures of the stabilisation loop t9 stay-money suites (solde-credit-pays-unpaid-line, solde-line-refunded-not-unoffered,
// platform-complement-credit, stay-sequence-fuzz): one stay on the round-1 lodging, the gestures an operator makes (sale, line action, fiche
// save, payment flags, refund as the ledger row proposes, refund deleted) and the money identity every gesture keeps:
//   received (paid buckets + notes) − refunded − owed (the stored trop-perçu) + asked (the ledger's « Reste à percevoir ») = price + tax.
// Not a test file.
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const cents = (v) => Math.round(Number(v || 0) * 100);

function option(title, price) {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(id);
  return id;
}

// A stay 20 days ahead on `platform`, the beer ×5 (30 €) in its lines, its solde (or platform payout) paid today.
function paidStay(platform = 'direct') {
  const id = stay(20);
  db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  const body = storedBody(id);
  const saved = ctrl.performUpdate(id, { ...body, options: [...(body.options || []), { optionId: beer, quantity: 5 }], restatePricing: true });
  if (saved.status !== 200) throw new Error(JSON.stringify(saved.body));
  pay(id, { balancePaid: true, balancePaidDate: todayIso() });
  return id;
}

function pay(id, body) {
  const res = call(ctrl.updatePayment, { id: String(id) }, body);
  if (res.statusCode !== 200) throw new Error(`${JSON.stringify(body)} → ${res.statusCode} ${JSON.stringify(res.body)}`);
  return res;
}

const at = (id, day, time) => new Date(`${addDaysToIsoDate(row(id).startDate, day)}T${time}:00`);
const lineRef = (id, article, now) => {
  const line = extraSale.saleDetailOf(id, now).lines.find((l) => l.articleKey === `option:${article}`);
  return line && line.ref;
};
const sell = (id, article, quantity, now, payment) => extraSale.sell(id, [{ articleRef: `option:${article}`, quantity }], { now, ...(payment ? { payment } : {}) });
// A line action; an OVERPAID answer is confirmed, as the operator does. → { first, final }
function change(id, article, want, now) {
  const ref = lineRef(id, article, now);
  const first = extraSale.changeLine(id, ref, want, { now });
  const final = first.status === 409 && first.body.code === 'OVERPAID' ? extraSale.changeLine(id, ref, want, { now, forceOverpayment: true }) : first;
  return { first, final };
}
// The fiche's « Enregistrer » with `edit` applied to its option lines; an OVERPAID answer is confirmed. → { first, final }
function fiche(id, edit, now) {
  const body = storedBody(id);
  const posted = { ...body, options: edit(body.options || []) };
  const first = ctrl.performUpdate(id, posted, { now });
  const final = first.status === 409 && first.body.code === 'OVERPAID' ? ctrl.performUpdate(id, { ...posted, forceOverpayment: true }, { now }) : first;
  return { first, final };
}
const offerInFiche = (article) => (options) => options.map((o) => (Number(o.optionId) === article ? { ...o, offered: true } : o));

function ledger(id) {
  const res = respond();
  ctrl.getById({ params: { id }, user: { id: 1, role: 'admin' } }, res);
  return res.body.ledger;
}
const overpaymentRow = (id) => ledger(id).rows.find((r) => r.key === 'overpayment') || null;

// The refund the ledger row proposes, made as the dialog makes it: its cash part through the caisse interne first, then the rest.
function refundAsProposed(id) {
  const prefill = (overpaymentRow(id) || {}).refundPrefill;
  if (!prefill) return [];
  const lines = (prefill.overpaymentLines || []).filter((l) => Number(l.amountTtc) > 0);
  const posts = [];
  if (prefill.cashPart && prefill.cashPart.amountTtc > 0) {
    posts.push({ method: 'internal', total: prefill.cashPart.amountTtc, lines: prefill.cashPart.lines });
    let rest = prefill.cashPart.restTtc;
    const restLines = [];
    for (const l of lines) { const a = Math.min(rest, l.amountTtc); if (a > 0) restLines.push({ bucket: l.bucket, amountTtc: a }); rest -= a; }
    if (prefill.cashPart.restTtc > 0) posts.push({ method: 'transfer', total: prefill.cashPart.restTtc, lines: restLines });
  } else {
    posts.push({ method: prefill.method || 'transfer', total: prefill.overpaymentTtc, lines });
  }
  return posts.map((p) => call(refunds.create, { id: String(id) }, {
    refundDate: todayIso(), method: p.method, reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: p.total,
    lines: p.lines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
  }));
}
const deleteRefund = (id, refundId) => call(refunds.remove, { id: String(id), refundId: String(refundId) });
const refundIds = (id) => db.prepare('SELECT id FROM reservation_refunds WHERE reservationId = ? ORDER BY id').all(id).map((r) => r.id);

// The money identity, in cents: { received, refunded, owed, asked, total, gap } — `gap` is 0 on a stay that neither asks nor owes too much.
function identity(id) {
  const r = row(id);
  const paid = (amount, flag, cash) => (Number(r[flag] || 0) === 1 || Number(r[cash] || 0) === 1 ? cents(r[amount]) : 0);
  const notes = JSON.parse(r.midStaySettledNotes || '[]').reduce((sum, n) => sum + cents(n.total), 0);
  const received = paid('depositAmount', 'depositPaid', 'depositPaidCash') + paid('balanceAmount', 'balancePaid', 'balancePaidCash')
    + paid('complementAmount', 'complementPaid', 'complementPaidCash') + paid('endOfStayComplementAmount', 'endOfStayComplementPaid', 'endOfStayComplementPaidCash') + notes;
  const refunded = cents(db.prepare('SELECT COALESCE(SUM(totalTtc), 0) AS t FROM reservation_refunds WHERE reservationId = ?').get(id).t);
  const stored = ctrl.storedOverpayment(id);
  const owed = stored ? cents(stored.overpaymentTtc) : 0;
  const asked = cents(ledger(id).remaining);
  const total = cents(r.finalPrice) + cents(r.touristTaxTotal);
  return { received, refunded, owed, asked, total, gap: received - refunded - owed + asked - total };
}

module.exports = {
  db, row, beer, todayIso, extraSale, ctrl, storedBody, call, cents, option, paidStay, pay, at, lineRef, sell, change, fiche, offerInFiche,
  ledger, overpaymentRow, refundAsProposed, deleteRefund, refundIds, identity,
};
