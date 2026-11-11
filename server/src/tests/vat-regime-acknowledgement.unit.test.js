// specs/vat-optional-mode.md rules 24 and 31 — a switch that rewrites collected money or booked months
// asks for the acknowledgement whatever its scope (the server refuses without it, the preview says so),
// and the fingerprint covers the source rates: a rate edited between preview and switch gives a 409.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const controller = require('../controllers/vatRegimeController');
const vatRegimeModel = require('../models/vatRegimeModel');

const call = (fn, body) => {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  fn({ body, user: { id: 1 } }, res);
  return res;
};
const reset = () => {
  db.prepare('UPDATE reservations SET vatPeriodId = 1').run();
  db.prepare('DELETE FROM vat_periods WHERE id > 1').run();
  db.prepare('UPDATE vat_periods SET rate = 10 WHERE id = 1').run();
  vatRegimeModel.syncMirror(db);
};
test.beforeEach(reset);

const BACKDATED = { regime: 'not_subject', basis: 'booking', effectiveFrom: '2027-01-01' };
const UNPAID = { regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-12-01' };

test('rule 24: a back-dated scope that moves collected money asks for the acknowledgement, on the server too', () => {
  const p = call(controller.preview, BACKDATED).body;
  assert.equal(p.needsAcknowledgement, true);
  assert.ok(p.collected > 0 && p.exportMonths.length > 0);
  const refused = call(controller.makeSwitch, { ...BACKDATED, fingerprint: p.fingerprint });
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.body.errors.acknowledged, 'Confirmation requise');
  assert.equal(vatRegimeModel.listPeriods(db).length, 1, 'nothing was written');
  assert.equal(call(controller.makeSwitch, { ...BACKDATED, fingerprint: p.fingerprint, acknowledged: true }).statusCode, 201);
});

test('rule 24: the same holds for the arrival scope, as soon as one affected reservation has money collected', () => {
  const p = call(controller.preview, { regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-01-01' }).body;
  assert.equal(p.needsAcknowledgement, true);
});

test('rule 24: a switch that touches no collected money and no book needs no acknowledgement', () => {
  const p = call(controller.preview, UNPAID).body;
  assert.deepEqual([p.collected, p.exportMonths, p.needsAcknowledgement], [0, [], false]);
  assert.equal(call(controller.makeSwitch, { ...UNPAID, fingerprint: p.fingerprint }).statusCode, 201);
});

test('rule 24: a future-dated booking switch moves nothing and asks nothing', () => {
  const p = call(controller.preview, { regime: 'not_subject', basis: 'booking', effectiveFrom: '2028-03-01' }).body;
  assert.equal(p.needsAcknowledgement, false);
});

test('rule 24: the correction always asks, even on an empty database of reservations', () => {
  assert.equal(call(controller.preview, { regime: 'not_subject', basis: 'all' }).body.needsAcknowledgement, true);
});

test('rule 31: the books counted are those the journal books: no cash bucket, no 0 € amount', () => {
  db.prepare("UPDATE reservations SET depositPaidCash = 1, balancePaidCash = 1 WHERE id = 101").run();
  db.prepare("UPDATE reservation_refunds SET method = 'internal' WHERE reservationId = 101").run();
  const months = call(controller.preview, { regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-07-01' }).body.exportMonths;
  assert.ok(!months.includes('2027-06'), 'the solde of 101 was collected in cash: off the books');
  db.prepare("UPDATE reservations SET depositPaidCash = 0, balancePaidCash = 0 WHERE id = 101").run();
  db.prepare("UPDATE reservation_refunds SET method = 'transfer' WHERE reservationId = 101").run();
  assert.ok(!call(controller.preview, { regime: 'not_subject', basis: 'all' }).body.exportMonths.includes('2027-03'), 'a 0 € acompte books nothing');
});

test('rule 31: a rate edited between the preview and the switch gives a 409', () => {
  const input = { regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-12-01' };
  const { fingerprint } = call(controller.preview, input).body;
  db.prepare('UPDATE vat_periods SET rate = 12 WHERE id = 1').run();
  const stale = call(controller.makeSwitch, { ...input, fingerprint });
  assert.deepEqual([stale.statusCode, stale.body.error], [409, 'preview_stale']);
  assert.equal(call(controller.makeSwitch, { ...input, fingerprint: call(controller.preview, input).body.fingerprint }).statusCode, 201);
});

test('rule 31: the mirror column counts too', () => {
  const input = { regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-12-01' };
  const { fingerprint } = call(controller.preview, input).body;
  db.prepare('UPDATE app_settings SET vatRate = 7').run();
  assert.equal(call(controller.makeSwitch, { ...input, fingerprint }).statusCode, 409);
});
