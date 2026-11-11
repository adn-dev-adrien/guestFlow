// Review amendments: rule 48 — the model refuses too; decimals refused, never rounded.
// specs/settings-input-guards.md rules 28-31 — platform commissions and payout delays.
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-input-guards-platforms-')), 'c.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const db = require('../database');
const platformsController = require('../controllers/platformsController');
console.log = silent;

db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run('Vrbo');
db.prepare("UPDATE platforms SET commissionPercent = 15 WHERE name = 'Vrbo'").run();
const idOf = (name) => db.prepare('SELECT id FROM platforms WHERE name = ?').get(name).id;
const rate = () => db.prepare("SELECT commissionPercent FROM platforms WHERE name = 'Vrbo'").get().commissionPercent;

const reply = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
function save(rows) {
  const res = reply();
  platformsController.saveSettings({ body: { platforms: rows }, params: {}, query: {} }, res);
  return res;
}
function legacy(value) {
  const res = reply();
  platformsController.setCommission({ params: { id: idOf('Vrbo') }, body: { commissionPercent: value } }, res);
  return res;
}

test('rule 28, 48: the bulk save refuses a bad rate with the parser\'s own message and writes nothing', () => {
  const cases = [
    [-1, 'Entre 0 et 99,99 %.'], ['-1', 'Entre 0 et 99,99 %.'], [100, 'Entre 0 et 99,99 %.'], ['120', 'Entre 0 et 99,99 %.'],
    ['abc', 'Nombre attendu.'], ['', 'Nombre attendu.'], ['1,2,3', 'Nombre attendu.'], ['12.345', 'Au plus 2 décimales.'],
  ];
  for (const [bad, message] of cases) {
    const res = save([{ id: idOf('Vrbo'), commissionPercent: bad }]);
    assert.equal(res.statusCode, 400, String(bad));
    assert.equal(res.body.code, 'PLATFORMS_INVALID');
    assert.equal(res.body.errors[idOf('Vrbo')].commissionPercent, message, String(bad));
    assert.equal(rate(), 15, 'a refused save writes nothing');
  }
});

test('rule 28: a French comma and the bounds are accepted', () => {
  assert.equal(save([{ id: idOf('Vrbo'), commissionPercent: '12,5' }]).statusCode, 200);
  assert.equal(rate(), 12.5);
  assert.equal(save([{ id: idOf('Vrbo'), commissionPercent: 99.99 }]).statusCode, 200);
  assert.equal(save([{ id: idOf('Vrbo'), commissionPercent: 0 }]).statusCode, 200);
  assert.equal(rate(), 0);
});

test('rule 29, 48: the payout delay is a whole number 0 to 365, refused with the parser\'s own message', () => {
  for (const [bad, message] of [[-1, 'Un nombre entier de jours (0 à 365).'], [366, 'Un nombre entier de jours (0 à 365).'], [2.5, 'Nombre entier de jours.'], ['abc', 'Nombre attendu.']]) {
    const res = save([{ id: idOf('Vrbo'), payoutDueDays: bad }]);
    assert.equal(res.statusCode, 400, String(bad));
    assert.equal(res.body.errors[idOf('Vrbo')].payoutDueDays, message, String(bad));
  }
  assert.equal(save([{ id: idOf('Vrbo'), payoutDueDays: 365 }]).statusCode, 200);
});

test('rule 30: the legacy PUT refuses instead of clamping', () => {
  db.prepare("UPDATE platforms SET commissionPercent = 15 WHERE name = 'Vrbo'").run();
  for (const [bad, message] of [[-5, 'Entre 0 et 99,99 %.'], [250, 'Entre 0 et 99,99 %.'], ['abc', 'Nombre attendu.'], ['', 'Nombre attendu.'], [null, 'Nombre attendu.'], [undefined, 'Nombre attendu.']]) {
    const res = legacy(bad);
    assert.equal(res.statusCode, 400, String(bad));
    assert.deepEqual(res.body, { error: message });
    assert.equal(rate(), 15, 'nothing is clamped or written');
  }
  const ok = legacy('7,5');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.commissionPercent, 7.5);
});

test('rule 31: GET /platforms/settings sends the limits', () => {
  const res = reply();
  platformsController.listSettings({ query: {}, params: {} }, res);
  assert.deepEqual(res.body.limits.commissionPercent, { min: 0, max: 99.99, decimals: 2, unit: '%' });
  assert.deepEqual(res.body.limits.payoutDueDays, { min: 0, max: 365, integer: true, unit: 'jours', message: 'Un nombre entier de jours (0 à 365).' });
  assert.ok(Array.isArray(res.body.platforms));
});

test('rule 48: the model refuses a rate outside the bounds too — plugins reach it without the controller', () => {
  const platformsModel = require('../models/platformsModel');
  db.prepare("UPDATE platforms SET commissionPercent = 15 WHERE name = 'Vrbo'").run();
  for (const bad of [-5, 250, 'abc', 12.345, NaN, null]) {
    assert.equal(platformsModel.setCommissionPercent(idOf('Vrbo'), bad), null, String(bad));
    assert.equal(rate(), 15);
  }
  assert.equal(platformsModel.setCommissionPercent(idOf('Vrbo'), 7.5).commissionPercent, 7.5);
});
