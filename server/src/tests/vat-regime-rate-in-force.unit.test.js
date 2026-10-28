// specs/vat-optional-mode.md rule 9 — « Taux de TVA (%) » keeps its meaning: it edits the rate of the
// period in force, retroactively for the reservations of that period only; refused (422) when that
// period is not subject. The settings column is only a mirror.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const { updateSettings, getSettings } = require('../controllers/settingsController');
const vatRegimeModel = require('../models/vatRegimeModel');
const { buildSummary } = require('../controllers/settingsSummaryController');
const settingsModel = require('../models/settingsModel');

async function put(vat) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await updateSettings({ body: { vat }, user: { id: 1 } }, res);
  return res;
}
const rateOf = (id) => vatRegimeModel.forRow(db, { id }).rate;
const mirror = () => db.prepare('SELECT vatRate FROM app_settings WHERE id = 1').get().vatRate;

test('rule 9: the rate edits the period in force and the response reads it back', async () => {
  const res = await put({ rate: 20 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.vat, { regime: 'subject', rate: 20, legalMention: null });
  assert.equal(rateOf(101), 20);
  assert.equal(mirror(), 20);
  assert.equal(db.prepare('SELECT rate FROM vat_periods WHERE id = 1').get().rate, 20);
});

test('rule 9: GET /settings answers the rate of the regime in force', () => {
  let body;
  getSettings({}, { json: (b) => { body = b; } });
  assert.equal(body.vat.rate, 20);
  assert.equal(body.vat.regime, 'subject');
});

test('rule 9: an empty rate falls back to 10, an invalid one is refused and nothing moves', async () => {
  assert.equal((await put({ rate: '' })).statusCode, 200);
  assert.equal(rateOf(101), 10);
  const refused = await put({ rate: 140 });
  assert.equal(refused.statusCode, 400);
  assert.ok(refused.body.errors.vatRate);
  assert.equal(rateOf(101), 10);
});

test('rule 9: the edit is retroactive for the period in force only, never for the earlier ones', async () => {
  db.prepare("INSERT INTO vat_periods (regime, rate, basis, effectiveFrom) VALUES ('subject', 12, 'arrival', '2027-08-01')").run();
  db.prepare("UPDATE reservations SET vatPeriodId = 2 WHERE startDate >= '2027-08-01' AND kind != 'devis'").run();
  assert.equal((await put({ rate: 18 })).statusCode, 200);
  assert.deepEqual([rateOf(101), rateOf(104)], [10, 18]);
  assert.equal(mirror(), 18);
});

test('rule 9: the settings summary words the rate in force', () => {
  const { lines } = buildSummary({ db, settings: () => settingsModel.read(), plugins: () => [], today: () => '2027-10-20' }, { id: 1, roles: ['admin'] });
  assert.match(lines['/settings/tva-exercice'].text, /^TVA 18 % · exercice clos fin décembre$/);
});

test('rule 9: refused with 422 when the period in force is not subject, the mention is edited instead', async () => {
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run();
  vatRegimeModel.syncMirror(db);
  const refused = await put({ rate: 10 });
  assert.equal(refused.statusCode, 422);
  assert.ok(refused.body.errors.vatRate);
  const ok = await put({ legalMention: 'art_261_d_4' });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body.vat, { regime: 'not_subject', rate: 0, legalMention: 'art_261_d_4' });
  assert.equal(mirror(), 0);
  assert.equal((await put({ legalMention: 'free text' })).statusCode, 400);
});

test('rule 3: a legal mention is refused while the period in force is subject', async () => {
  db.prepare('DELETE FROM vat_periods WHERE id = 3').run();
  vatRegimeModel.syncMirror(db);
  const refused = await put({ legalMention: 'art_293_b' });
  assert.equal(refused.statusCode, 422);
  assert.ok(refused.body.errors.legalMention);
});

test('rule 9: the page sends its whole group back — a null mention, or a rate of 0 under « Sans TVA », changes nothing', async () => {
  assert.equal((await put({ regime: 'subject', rate: 15, legalMention: null })).statusCode, 200);
  assert.equal(rateOf(104), 15);
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run();
  const echoed = await put({ regime: 'not_subject', rate: 0, legalMention: 'art_293_b' });
  assert.equal(echoed.statusCode, 200);
  assert.deepEqual(echoed.body.vat, { regime: 'not_subject', rate: 0, legalMention: 'art_293_b' });
});
