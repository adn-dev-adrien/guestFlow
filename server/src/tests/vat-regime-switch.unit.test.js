// specs/vat-optional-mode.md rules 3, 14, 15, 16, 18 and 19 — switching the regime: each scope, the
// bounds and their messages, an identical target refused, one all-or-nothing transaction, a history
// entry per reservation that changes, the refund lines re-rated, the undo of an unused period, the
// acknowledgement of a correction, and the admin-only API.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');
const rules = require('../utils/vatRegime');

const db = buildVatGoldenDb();
const controller = require('../controllers/vatRegimeController');
const switchModel = require('../models/vatRegimeSwitchModel');
const vatRegimeModel = require('../models/vatRegimeModel');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');

const TODAY = '2027-10-20';
const call = (fn, { body, params, user = { id: 1, roles: ['admin'] } } = {}) => {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  fn({ body, params, user }, res);
  return res;
};
const previewOf = (input) => call(controller.preview, { body: input });
const send = (input, extra = {}) => {
  const p = previewOf(input);
  return call(controller.makeSwitch, { body: { ...input, fingerprint: p.body && p.body.fingerprint, acknowledged: true, ...extra } });
};
const periodOf = (id) => db.prepare('SELECT vatPeriodId FROM reservations WHERE id = ?').get(id).vatPeriodId;
const periods = () => vatRegimeModel.listPeriods(db);
const reset = () => {
  db.prepare('UPDATE reservations SET vatPeriodId = 1').run();
  db.prepare('DELETE FROM vat_periods WHERE id > 1').run();
  db.prepare("DELETE FROM reservation_history WHERE changedFields LIKE '%vatRegime%'").run();
  db.prepare("UPDATE reservation_refund_lines SET vatRate = 10 WHERE bucket != 'touristTax'").run();
  vatRegimeModel.syncMirror(db);
};

test('rule 14: a correction moves every reservation, stays and cancelled stays alike, not the devis', () => {
  reset();
  const res = send({ regime: 'not_subject', basis: 'all' }, { acknowledged: true });
  assert.equal(res.statusCode, 201);
  const count = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind IN ('reservation', 'cancelled')").get().n;
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE vatPeriodId = ? AND kind IN ('reservation', 'cancelled')").get(res.body.period.id).n, count);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE vatPeriodId = ? AND kind = 'devis'").get(res.body.period.id).n, 0);
  assert.equal(periodOf(109), res.body.period.id, 'the cancelled stay too');
  assert.deepEqual([res.body.period.regime, res.body.period.legalMention, res.body.period.basis, res.body.period.effectiveFrom], ['not_subject', 'art_293_b', 'all', null]);
});

test('rule 14: the legal mention is the one chosen, 293 B by default', () => {
  reset();
  assert.equal(send({ regime: 'not_subject', basis: 'all', legalMention: 'art_261_d_4' }, { acknowledged: true }).body.period.legalMention, 'art_261_d_4');
});

test('rule 14: « réservations prises à partir du » takes the reservations booked from that day, no earlier one', () => {
  reset();
  db.prepare("UPDATE reservations SET createdAt = '2027-10-21 08:00:00' WHERE id = 108").run();
  const res = send({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2027-10-21' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.reassigned, 1);
  assert.equal(periodOf(108), res.body.period.id);
  assert.equal(periodOf(101), 1);
  db.prepare("UPDATE reservations SET createdAt = '2027-03-02 10:00:00' WHERE id = 108").run();
});

test('rule 14: « séjours qui commencent à partir du » takes the stays arriving from that day', () => {
  reset();
  const res = send({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-09-01' });
  const taken = db.prepare("SELECT id FROM reservations WHERE vatPeriodId = ? ORDER BY id").all(res.body.period.id).map((r) => r.id);
  const expected = db.prepare("SELECT id FROM reservations WHERE kind IN ('reservation', 'cancelled') AND startDate >= '2027-09-01' ORDER BY id").all().map((r) => r.id);
  assert.deepEqual(taken, expected);
  assert.ok(taken.length > 0 && !taken.includes(101));
});

test('rule 14: switching back to VAT takes a rate, 10 by default, and no mention', () => {
  reset();
  send({ regime: 'not_subject', basis: 'all' }, { acknowledged: true });
  const back = send({ regime: 'subject', basis: 'all' }, { acknowledged: true });
  assert.deepEqual([back.body.period.regime, back.body.period.rate, back.body.period.legalMention], ['subject', 10, null]);
  const other = send({ regime: 'subject', rate: 20, basis: 'arrival', effectiveFrom: '2027-11-01' });
  assert.equal(other.body.period.rate, 20);
});

test('rule 15: the bounds, with their messages', () => {
  reset();
  const refused = (input) => previewOf({ regime: 'not_subject', ...input });
  assert.equal(refused({ basis: 'booking' }).statusCode, 422);
  assert.equal(refused({ basis: 'booking', effectiveFrom: '2027-02-30' }).body.errors.effectiveFrom, 'Date invalide');
  assert.equal(refused({ basis: 'booking', effectiveFrom: '2025-01-01' }).body.errors.effectiveFrom, 'Au plus un an en arrière, sinon correction');
  assert.equal(refused({ basis: 'booking', effectiveFrom: '2029-01-01' }).body.errors.effectiveFrom, "Au plus un an à l'avance");
  assert.equal(refused({ basis: 'nope' }).body.errors.basis, 'Portée invalide');
  assert.equal(previewOf({ regime: 'wat', basis: 'all' }).body.errors.regime, 'Régime invalide');
  assert.equal(previewOf({ regime: 'subject', rate: 120, basis: 'all' }).body.errors.rate, 'Taux entre 0 et 100');
});

test('rule 15: a date before the last dated change is refused, quoting it', () => {
  reset();
  send({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2027-11-01' });
  const res = previewOf({ regime: 'subject', rate: 20, basis: 'booking', effectiveFrom: '2027-10-25' });
  assert.equal(res.body.errors.effectiveFrom, 'Date antérieure au dernier changement (01/11/2027)');
  assert.equal(previewOf({ regime: 'subject', rate: 20, basis: 'booking', effectiveFrom: '2027-11-01' }).statusCode, 200);
});

test('rule 15: a target identical to the period in force is refused', () => {
  reset();
  assert.equal(previewOf({ regime: 'subject', rate: 10, basis: 'all' }).body.errors.regime, 'Régime déjà en vigueur');
  assert.equal(previewOf({ regime: 'subject', rate: 5, basis: 'all' }).statusCode, 200, 'another rate is a change');
  send({ regime: 'not_subject', basis: 'all' }, { acknowledged: true });
  assert.equal(previewOf({ regime: 'not_subject', basis: 'all' }).body.errors.regime, 'Régime déjà en vigueur');
});

test('rule 16: the history of each reservation that changes says so, a correction as a correction', () => {
  reset();
  send({ regime: 'not_subject', basis: 'all' }, { acknowledged: true });
  const entry = JSON.parse(db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = 101 AND changedFields LIKE '%vatRegime%'").get().changedFields)[0];
  assert.deepEqual([entry.label, entry.fromText, entry.toText], ['Régime de TVA', 'Assujetti 10 %', 'Sans TVA (correction du 20/10/2027)']);
  reset();
  send({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-09-01' });
  const dated = JSON.parse(db.prepare("SELECT changedFields FROM reservation_history WHERE changedFields LIKE '%vatRegime%' LIMIT 1").get().changedFields)[0];
  assert.equal(dated.toText, 'Sans TVA (changement du 01/09/2027)');
});

test('rule 16: a reservation whose regime and rate do not change gets no history line, but takes the period', () => {
  reset();
  send({ regime: 'subject', rate: 10, basis: 'all' }, { acknowledged: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservation_history WHERE changedFields LIKE '%vatRegime%'").get().n, 0);
});

test('rule 16: the non-tax lines of the refunds are re-rated, their TTC unchanged, the tourist tax at 0', () => {
  reset();
  const lines = () => db.prepare("SELECT bucket, amountTtc, vatRate FROM reservation_refund_lines WHERE refundId IN (SELECT id FROM reservation_refunds WHERE reservationId = 101) ORDER BY id").all();
  const before = lines();
  assert.equal(before[0].vatRate, 10);
  send({ regime: 'not_subject', basis: 'all' }, { acknowledged: true });
  assert.deepEqual(lines().map((l) => [l.bucket, l.amountTtc, l.vatRate]), before.map((l) => [l.bucket, l.amountTtc, 0]));
  reset();
});

test('rule 16: a future-dated booking switch reassigns nothing now', () => {
  reset();
  const res = send({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2028-03-01' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.reassigned, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE vatPeriodId = ?').get(res.body.period.id).n, 0);
});

test('rule 16: the switch is all or nothing', () => {
  reset();
  const input = { regime: 'not_subject', basis: 'all' };
  const fingerprint = previewOf(input).body.fingerprint;
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON reservation_history WHEN NEW.changedFields LIKE '%vatRegime%' BEGIN SELECT RAISE(ABORT, 'boom'); END");
  assert.throws(() => switchModel.applySwitch(db, input, { fingerprint, acknowledged: true }), /boom/);
  db.exec('DROP TRIGGER boom');
  assert.equal(periods().length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE vatPeriodId != 1').get().n, 0);
});

test('rule 16: the mirror column follows the regime in force', () => {
  reset();
  send({ regime: 'not_subject', basis: 'all' }, { acknowledged: true });
  assert.equal(db.prepare('SELECT vatRate FROM app_settings').get().vatRate, 0);
  send({ regime: 'subject', rate: 20, basis: 'all' }, { acknowledged: true });
  assert.equal(db.prepare('SELECT vatRate FROM app_settings').get().vatRate, 20);
});

test('rule 19: a correction without the acknowledgement is refused, with it it goes through', () => {
  reset();
  const input = { regime: 'not_subject', basis: 'all' };
  const fingerprint = previewOf(input).body.fingerprint;
  const refused = call(controller.makeSwitch, { body: { ...input, fingerprint } });
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.body.errors.acknowledged, 'Confirmation requise');
  assert.equal(periods().length, 1);
  assert.equal(call(controller.makeSwitch, { body: { ...input, fingerprint, acknowledged: true } }).statusCode, 201);
});

test('rule 18: the latest period, unused, can be undone; a used one, the initial one, an earlier one cannot', () => {
  reset();
  const future = send({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2028-03-01' }).body.period;
  assert.equal(switchModel.readState(db, { today: TODAY }).periods[0].deletable, true);
  const used = send({ regime: 'subject', rate: 5, basis: 'arrival', effectiveFrom: '2028-04-01' });
  assert.equal(call(controller.remove, { params: { id: future.id } }).body.error, 'not_latest');
  assert.equal(call(controller.remove, { params: { id: 1 } }).body.error, 'initial_period');
  assert.equal(call(controller.remove, { params: { id: used.body.period.id } }).statusCode, 200);
  assert.equal(call(controller.remove, { params: { id: future.id } }).statusCode, 200);
  assert.equal(periods().length, 1);
  assert.equal(call(controller.remove, { params: { id: 999 } }).statusCode, 404);
});

test('rule 18: a period reservations were sold under stays', () => {
  reset();
  const res = send({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-09-01' });
  const refused = call(controller.remove, { params: { id: res.body.period.id } });
  assert.deepEqual([refused.statusCode, refused.body.error], [409, 'period_in_use']);
  assert.equal(switchModel.readState(db, { today: TODAY }).periods[0].deletable, false);
});

test('rule 18: undoing a period hands its devis back to the previous one', () => {
  reset();
  const future = send({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2028-03-01' }).body.period;
  db.prepare("UPDATE reservations SET vatPeriodId = ? WHERE id = 201").run(future.id);
  assert.equal(call(controller.remove, { params: { id: future.id } }).statusCode, 200);
  assert.equal(periodOf(201), 1);
});

test('rule 3: the history is append-only through the API: no period is edited by a switch', () => {
  reset();
  const before = JSON.stringify(periods());
  send({ regime: 'not_subject', basis: 'all' }, { acknowledged: true });
  assert.equal(JSON.stringify(periods().slice(0, 1)), JSON.stringify(JSON.parse(before)));
});

test('rule 3: the state lists the history newest first with the server\'s sentences and the mentions', () => {
  reset();
  send({ regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-11-01' });
  const state = call(controller.getState).body;
  assert.equal(state.periods[0].label, 'Depuis le 01/11/2027 · séjours qui commencent à partir de cette date');
  assert.equal(state.periods[0].scheduled, true);
  assert.equal(state.periods[1].label, 'Depuis toujours');
  assert.deepEqual(state.mentions.map((m) => m.key), ['art_293_b', 'art_261_d_4']);
  assert.equal(state.inForce.regime, 'subject');
  assert.equal(state.periods[0].createdByName.length >= 0, true);
});

test('rule 14: only an admin switches, the accountant reads the state', () => {
  const admin = { roles: ['admin'] };
  const accountant = { roles: ['accountant'] };
  const run = (user, method, path) => { let status = 'next'; enforceRoleAccess({ user, method, path }, { status(c) { status = c; return { json() {} }; } }, () => { status = 'ok'; }); return status; };
  assert.equal(run(admin, 'POST', '/settings/vat-regime/switch'), 'ok');
  assert.equal(run(accountant, 'GET', '/settings/vat-regime'), 'ok');
  assert.equal(run(accountant, 'POST', '/settings/vat-regime/switch'), 403);
  assert.equal(run(accountant, 'POST', '/settings/vat-regime/preview'), 403);
  assert.equal(run(accountant, 'DELETE', '/settings/vat-regime/periods/2'), 403);
  assert.equal(run({ roles: ['reception'] }, 'GET', '/settings/vat-regime'), 403);
});

test('rule 14: a period dated far ahead is accepted at the bound and refused past it', () => {
  reset();
  assert.equal(rules.validateSwitch({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2028-10-20' }, periods(), { today: TODAY }).errors.effectiveFrom, undefined);
  assert.equal(rules.validateSwitch({ regime: 'not_subject', basis: 'booking', effectiveFrom: '2028-10-22' }, periods(), { today: TODAY }).errors.effectiveFrom, "Au plus un an à l'avance");
});
