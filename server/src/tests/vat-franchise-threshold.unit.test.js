// specs/vat-optional-mode.md rules 35 and 36 — the threshold is typed by the operator, never supplied:
// parsed like the revenue goal with its own messages, accepted only under the franchise, stamped with
// the day it changed, and kept (unused) when the regime goes back to VAT.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const { updateSettings, getSettings } = require('../controllers/settingsController');
const { parseThreshold, MESSAGES } = require('../utils/vatFranchise');

async function call(handler, req) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ user: { id: 1 }, ...req }, res);
  return res;
}
const put = (vat) => call(updateSettings, { body: { vat } });
const franchise = async () => (await call(getSettings, {})).body.vat.franchise;
const addPeriod = (regime, mention) => db
  .prepare('INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES (?, ?, ?, ?)')
  .run(regime, regime === 'subject' ? 10 : 0, mention, 'all');
const TODAY = '2027-10-20';

test('rule 36: accepted forms — spaces, a decimal comma, a number, empty', () => {
  assert.deepEqual(parseThreshold('30 000,00'), { ok: true, value: 30000 });
  assert.deepEqual(parseThreshold(' 12 500 '), { ok: true, value: 12500 });
  assert.deepEqual(parseThreshold(30000), { ok: true, value: 30000 });
  assert.deepEqual(parseThreshold('0,01'), { ok: true, value: 0.01 });
  assert.deepEqual(parseThreshold(''), { ok: true, value: null });
  assert.deepEqual(parseThreshold(null), { ok: true, value: null });
});

test('rule 36: each refusal has its message', () => {
  for (const value of ['0', '-5', 0]) assert.deepEqual(parseThreshold(value), { ok: false, error: MESSAGES.notPositive }, String(value));
  for (const value of ['abc', '1e5', '12.5.1', '12 €']) assert.deepEqual(parseThreshold(value), { ok: false, error: MESSAGES.notANumber }, value);
  assert.deepEqual(parseThreshold('12,345'), { ok: false, error: 'Deux décimales au plus.' });
  assert.deepEqual(parseThreshold('10 000 001'), { ok: false, error: '10 000 000 € au plus.' });
  assert.deepEqual(parseThreshold('10 000 000'), { ok: true, value: 10000000 });
  assert.equal(MESSAGES.notPositive, 'Montant supérieur à 0 €. Vide pour ne pas en fixer.');
  assert.equal(MESSAGES.notANumber, 'Un montant en euros (ex. 12 500).');
});

test('rule 36: the server refuses a malformed amount with the message under the field', async () => {
  const res = await put({ franchiseThreshold: '12,345' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.errors, { vatFranchiseThreshold: 'Deux décimales au plus.' });
});

test('rule 36: a VAT-registered install carries the keys, absent, and refuses an amount (422)', async () => {
  assert.deepEqual(await franchise(), { applies: false, threshold: null, setAt: null });
  const refused = await put({ franchiseThreshold: '30000' });
  assert.equal(refused.statusCode, 422);
  assert.deepEqual(refused.body.errors, { vatFranchiseThreshold: 'Seuil sans objet hors franchise' });
  assert.deepEqual(await franchise(), { applies: false, threshold: null, setAt: null });
  assert.equal((await put({ franchiseThreshold: '' })).statusCode, 200);
});

test('rule 36: under the franchise the amount is saved with the day, and shown back', async () => {
  addPeriod('not_subject', 'art_293_b');
  const saved = await put({ franchiseThreshold: '30 000,50' });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.vat.franchise, { applies: true, threshold: 30000.5, setAt: TODAY });
  assert.deepEqual(await franchise(), { applies: true, threshold: 30000.5, setAt: TODAY });
});

test('rule 36: the day is written on a change only — the same amount sent again keeps it', async () => {
  db.prepare("UPDATE app_settings SET vatFranchiseThresholdSetAt = '2027-01-02'").run();
  await put({ franchiseThreshold: 30000.5 });
  await put({ franchiseThreshold: '30 000,50' });
  assert.equal((await franchise()).setAt, '2027-01-02');
  await put({ franchiseThreshold: '31000' });
  assert.deepEqual(await franchise(), { applies: true, threshold: 31000, setAt: TODAY });
});

test('rule 36: emptying the field clears the amount and its day', async () => {
  await put({ franchiseThreshold: '' });
  assert.deepEqual(await franchise(), { applies: true, threshold: null, setAt: null });
});

test('rule 35: the other mention is not the franchise — refused, and a mention sent in the same save counts', async () => {
  await put({ franchiseThreshold: '30000' });
  await put({ legalMention: 'art_261_d_4' });
  assert.deepEqual(await franchise(), { applies: false, threshold: 30000, setAt: TODAY });
  const refused = await put({ franchiseThreshold: '45000' });
  assert.equal(refused.statusCode, 422);
  const together = await put({ legalMention: 'art_293_b', franchiseThreshold: '45000' });
  assert.equal(together.statusCode, 200);
  assert.deepEqual(together.body.vat.franchise, { applies: true, threshold: 45000, setAt: TODAY });
});

test('rule 35: the amount is kept, unused, when VAT comes back', async () => {
  addPeriod('subject', null);
  assert.deepEqual(await franchise(), { applies: false, threshold: 45000, setAt: TODAY });
  const model = require('../models/vatFranchiseModel');
  assert.deepEqual(model.getFollowUp({ today: TODAY }), { applies: false });
});
