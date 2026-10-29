// specs/platform-settings-relay-and-review.md rule 15 + reservation-save-keeps-pricing.md rule 20 — audit R4
// re-review: unticking « Compté comme vente directe » turns every stay of the channel into a platform stay, so it
// is refused while one of them has an acompte or a solde ticked as received (Adrien, 2026-10-29).
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-uncount-')), 'c.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const db = require('../database');
const platformsController = require('../controllers/platformsController');
const { setDirectChannels, isDirectChannel } = require('../utils/platformNameFormat');
console.log = silent;

db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run('Lodgify');
db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run('Vrbo');
db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'A', 'B')").run();
const idOf = (name) => db.prepare('SELECT id FROM platforms WHERE name = ?').get(name).id;
const stay = (platform, extra = '') => db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice ${extra ? ', ' + extra.split('=')[0] : ''})
  VALUES (1, 1, '2099-01-01', '2099-01-04', ?, 2, 300 ${extra ? ', ' + extra.split('=')[1] : ''})`).run(platform).lastInsertRowid;
const reset = () => {
  db.prepare('DELETE FROM reservations').run();
  db.prepare("UPDATE platforms SET countsAsDirect = CASE name WHEN 'Lodgify' THEN 1 ELSE 0 END").run();
  setDirectChannels(['Lodgify']);
};
function save(rows) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  platformsController.saveSettings({ body: { platforms: rows }, params: {}, query: {} }, res);
  return res;
}

for (const flag of ['balancePaid', 'depositPaid', 'balancePaidCash', 'depositPaidCash']) {
  test(`rule 15 — refused with a 409 while a stay of the channel has ${flag} ticked`, () => {
    reset();
    stay('Lodgify');
    stay('Lodgify', `${flag}=1`);
    const res = save([{ id: idOf('Lodgify'), countsAsDirect: false }]);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'DIRECT_PAYMENTS_RECORDED');
    assert.match(res.body.error, /Paiements directs enregistrés sur ce canal : les décocher avant de le passer en plateforme\./);
    assert.equal(res.body.count, 1);
    assert.equal(isDirectChannel('Lodgify'), true, 'nothing was written');
  });
}

test('rule 15 — accepted when no stay of the channel has a payment ticked, or when only another channel does', () => {
  reset();
  stay('Lodgify');
  stay('Vrbo', 'balancePaid=1');
  const res = save([{ id: idOf('Lodgify'), countsAsDirect: false }]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(isDirectChannel('Lodgify'), false);
});

test('rule 15 — ticking « Compté comme vente directe » on is unaffected by ticked payments', () => {
  reset();
  stay('Vrbo', 'balancePaid=1');
  const res = save([{ id: idOf('Vrbo'), countsAsDirect: true }]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(isDirectChannel('Vrbo'), true);
});
