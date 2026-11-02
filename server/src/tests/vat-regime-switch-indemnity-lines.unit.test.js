// specs/vat-optional-mode.md rules 16 and 26 with specs/reservation-refunds.md rule 48, reading of 2026-11-02
// (review of #925). A switch re-rates the refund lines of the stays it moves, and its undo restores them; a line
// given back from a cancellation indemnity (bucket `indemnity`) is not a sale and keeps its 0 % either way.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const controller = require('../controllers/vatRegimeController');
const vatRegimeModel = require('../models/vatRegimeModel');

const call = (fn, { body, params } = {}) => {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  fn({ body, params, user: { id: 1, roles: ['admin'] } }, res);
  return res;
};
const send = (input) => {
  const p = call(controller.preview, { body: input });
  return call(controller.makeSwitch, { body: { ...input, fingerprint: p.body && p.body.fingerprint, acknowledged: true } });
};
const reset = () => {
  db.prepare('UPDATE reservations SET vatPeriodId = 1').run();
  db.prepare('DELETE FROM vat_periods WHERE id > 1').run();
  vatRegimeModel.syncMirror(db);
};

function refundWithIndemnityShare(reservationId) {
  // date-literal-ok: buildVatGoldenDb freezes the clock on 2027-10-20.
  const refund = Number(db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, method, totalTtc, reason) VALUES (?, '2027-10-01', 'transfer', 70, 'x')").run(reservationId).lastInsertRowid);
  const line = db.prepare('INSERT INTO reservation_refund_lines (refundId, lineKey, label, bucket, amountTtc, vatRate) VALUES (?, ?, ?, ?, ?, ?)');
  line.run(refund, 'accommodation', 'Hébergement', 'accommodation', 50, 10);
  line.run(refund, 'accommodation', 'Hébergement', 'indemnity', 20, 0);
  return () => db.prepare('SELECT bucket, vatRate FROM reservation_refund_lines WHERE refundId = ? ORDER BY id').all(refund).map((l) => [l.bucket, l.vatRate]);
}

test.beforeEach(reset);

test('rule 16: a switch re-rates the sale lines of a refund, never its indemnity line', () => {
  const rates = refundWithIndemnityShare(109);
  assert.equal(send({ regime: 'subject', rate: 20, basis: 'all' }).statusCode, 201);
  assert.deepEqual(rates(), [['accommodation', 20], ['indemnity', 0]]);
});

test('rule 26: undoing a future switch restores the sale lines, the indemnity line stays at 0 %', () => {
  const rates = refundWithIndemnityShare(105);
  // date-literal-ok: buildVatGoldenDb freezes the clock on 2027-10-20, so the switch is still ahead.
  const made = send({ regime: 'subject', rate: 20, basis: 'arrival', effectiveFrom: '2027-12-01' });
  assert.equal(made.statusCode, 201);
  assert.deepEqual(rates(), [['accommodation', 20], ['indemnity', 0]]);
  assert.equal(call(controller.remove, { params: { id: made.body.period.id } }).statusCode, 200);
  assert.deepEqual(rates(), [['accommodation', 10], ['indemnity', 0]]);
});
