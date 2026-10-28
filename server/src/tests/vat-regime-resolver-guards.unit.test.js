// specs/vat-optional-mode.md rules 25, 29 and 30, and the small contracts around them — a devis is a live
// offer only while it is open (a converted one follows its reservation, an accepted or expired one keeps
// its own period); the settings mirror follows a period that starts today; the resolver refuses a row that
// states neither its period nor that it is a new sale; a decimal comma is a rate; the accountant's read of
// the history carries no email.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const vatRegimeModel = require('../models/vatRegimeModel');
const switchModel = require('../models/vatRegimeSwitchModel');
const rules = require('../utils/vatRegime');
const { tickVatRateMirror } = require('../scheduledTasks');

const NOT_SUBJECT = Number(db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run().lastInsertRowid);
const regimeOf = (id) => vatRegimeModel.forRow(db, { id }).regime;

test('rule 25: an open devis (draft or sent, not expired) is quoted under the regime in force', () => {
  db.prepare("UPDATE reservations SET devisStatus = 'draft', validUntil = '2027-12-31' WHERE id = 201").run();
  db.prepare("UPDATE reservations SET devisStatus = 'sent', validUntil = '2027-12-31' WHERE id = 202").run();
  assert.equal(regimeOf(201), 'not_subject');
  assert.equal(regimeOf(202), 'not_subject');
});

test('rule 25: an expired or accepted devis keeps the period it carries', () => {
  db.prepare("UPDATE reservations SET vatPeriodId = 1, validUntil = '2027-06-30' WHERE id = 201").run();
  assert.equal(regimeOf(201), 'subject', 'expired');
  db.prepare("UPDATE reservations SET vatPeriodId = 1, devisStatus = 'accepted', validUntil = '2027-12-31' WHERE id = 202").run();
  assert.equal(regimeOf(202), 'subject', 'accepted');
});

test('rule 25: a converted devis follows the reservation it became, so both documents agree', () => {
  db.prepare("UPDATE reservations SET devisStatus = 'converted', convertedReservationId = 101, validUntil = '2027-12-31' WHERE id = 201").run();
  db.prepare('UPDATE reservations SET vatPeriodId = 1 WHERE id = 101').run();
  assert.equal(regimeOf(201), 'subject');
  db.prepare('UPDATE reservations SET vatPeriodId = ? WHERE id = 101').run(NOT_SUBJECT);
  assert.equal(regimeOf(201), 'not_subject');
  db.prepare('UPDATE reservations SET vatPeriodId = 1 WHERE id = 101').run();
});

test('rule 25: the engine quote of a stored devis follows the same rule', () => {
  const { calculateReservationQuote } = require('../utils/pricing');
  const devisModel = require('../models/devisModel');
  db.prepare("UPDATE reservations SET devisStatus = 'draft', validUntil = '2027-12-31', convertedReservationId = NULL WHERE id = 201").run();
  assert.equal(devisModel.recomputeQuote(201).vatRegime.regime, 'not_subject');
  db.prepare("UPDATE reservations SET devisStatus = 'accepted', vatPeriodId = 1 WHERE id = 201").run();
  assert.equal(devisModel.recomputeQuote(201).vatRegime.regime, 'subject');
  assert.ok(calculateReservationQuote);
});

test('rule 30: a row that states neither a period, nor an id, nor that it is a new sale is refused', () => {
  assert.throws(() => vatRegimeModel.forRow(db, { startDate: '2027-11-01' }), /no id, no period and no newSale/);
  assert.equal(vatRegimeModel.forRow(db, { startDate: '2027-11-01', newSale: true }).regime, 'not_subject');
  assert.equal(vatRegimeModel.forRow(db, null).regime, 'not_subject', 'null is « the regime in force »');
  assert.equal(vatRegimeModel.forRow(db, { vatPeriodId: 1 }).regime, 'subject');
});

test('rule 30: in production the same call is logged loudly and answered, never thrown', () => {
  const env = process.env.NODE_ENV;
  const error = console.error;
  const logged = [];
  console.error = (m) => logged.push(m);
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(vatRegimeModel.forRow(db, { startDate: '2027-11-01' }).regime, 'not_subject');
  } finally {
    process.env.NODE_ENV = env;
    console.error = error;
  }
  assert.equal(logged.length, 1);
});

test('rule 30: the engine states a new sale itself', () => {
  const { calculateReservationQuote } = require('../utils/pricing');
  const quote = calculateReservationQuote({ db, propertyId: 1, startDate: '2027-12-10', endDate: '2027-12-12', adults: 2, children: 0, babies: 0, bookingDate: '2027-10-20' });
  assert.equal(quote.vatRegime.regime, 'not_subject');
});

test('rule 29: the settings mirror follows a period that starts today, without any write moving it', () => {
  db.prepare('DELETE FROM vat_periods WHERE id > 1').run();
  db.prepare('UPDATE reservations SET vatPeriodId = 1').run();
  vatRegimeModel.syncMirror(db);
  assert.equal(db.prepare('SELECT vatRate FROM app_settings').get().vatRate, 10);
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom) VALUES ('not_subject', 0, 'art_293_b', 'booking', '2027-10-20')").run();
  assert.equal(db.prepare('SELECT vatRate FROM app_settings').get().vatRate, 10, 'stale: nothing wrote it');
  tickVatRateMirror();
  assert.equal(db.prepare('SELECT vatRate FROM app_settings').get().vatRate, 0);
});

test('rule 15: a decimal comma is a rate — « 5,5 » is 5.5', () => {
  assert.equal(rules.parseRate('5,5'), 5.5);
  assert.deepEqual(rules.validateSwitch({ regime: 'subject', rate: '5,5', basis: 'all' }, vatRegimeModel.listPeriods(db)).errors, {});
  assert.equal(rules.periodFromInput({ regime: 'subject', rate: '5,5', basis: 'all' }).rate, 5.5);
  assert.equal(rules.validateSwitch({ regime: 'subject', rate: 'abc', basis: 'all' }, vatRegimeModel.listPeriods(db)).errors.rate, 'Taux entre 0 et 100');
});

test('rule 15: an empty rate is refused explicitly, an absent one means 10', () => {
  const periods = vatRegimeModel.listPeriods(db);
  assert.equal(rules.validateSwitch({ regime: 'subject', rate: '', basis: 'all' }, periods.map((p) => ({ ...p, regime: 'not_subject', rate: 0 }))).errors.rate, 'Taux entre 0 et 100');
  assert.equal(rules.periodFromInput({ regime: 'subject', basis: 'all' }).rate, 10);
});

test('rule 17: the legal mentions come with a short name for the select and the full text', () => {
  const [first] = switchModel.readState(db).mentions;
  assert.deepEqual(first, { key: 'art_293_b', label: 'TVA non applicable, art. 293 B du CGI', short: 'Franchise en base — art. 293 B' });
});

test('rule 9: the rate field of the settings accepts a decimal comma too', async () => {
  const { updateSettings } = require('../controllers/settingsController');
  db.prepare('DELETE FROM vat_periods WHERE id > 1').run();
  vatRegimeModel.syncMirror(db);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await updateSettings({ body: { vat: { rate: '5,5' } }, user: { id: 1 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vat.rate, 5.5);
});

test('rule 14: the history carries a name, never an email (the accountant reads it)', () => {
  db.prepare("INSERT INTO users (id, email, passwordHash, firstName, lastName) VALUES (91, 'secret@example.test', 'x', '', '')").run();
  db.prepare("INSERT INTO users (id, email, passwordHash, firstName, lastName) VALUES (92, 'named@example.test', 'x', 'Ada', 'Lovelace')").run();
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis, createdBy) VALUES ('not_subject', 0, 'art_293_b', 'all', 91)").run();
  db.prepare("INSERT INTO vat_periods (regime, rate, basis, createdBy) VALUES ('subject', 10, 'all', 92)").run();
  const state = switchModel.readState(db);
  assert.deepEqual([state.periods[0].createdByName, state.periods[1].createdByName], ['Ada Lovelace', 'Un administrateur']);
  assert.ok(!JSON.stringify(state).includes('@'));
});
