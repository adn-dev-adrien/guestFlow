// specs/airbnb-no-checkout-chores.md rule 10 (2026-10-27 spec review) — the « Plateformes » save judges a
// row's own-channel status on the state AFTER the save: ticking « Compté comme vente directe » and
// « Sans corvées de départ » in the same batch stores no hidden chore-free flag on a direct-counted row.
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-post-save-own-')), 'c.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const db = require('../database');
const platformsController = require('../controllers/platformsController');
const { setDirectChannels, setChoreFreeChannels, isDirectChannel } = require('../utils/platformNameFormat');
console.log = silent;

for (const name of ['Vrbo', 'Lodgify']) db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run(name);
db.prepare("UPDATE platforms SET countsAsDirect = CASE name WHEN 'Lodgify' THEN 1 ELSE 0 END, forbidsGuestChores = 0").run();
setDirectChannels(['Lodgify']);
setChoreFreeChannels([]);
const idOf = (name) => db.prepare('SELECT id FROM platforms WHERE name = ?').get(name).id;
const stored = (name) => db.prepare('SELECT forbidsGuestChores, relaysGuestEmail FROM platforms WHERE name = ?').get(name);

function save(rows) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  platformsController.saveSettings({ body: { platforms: rows }, params: {}, query: {} }, res);
  return res;
}

test('counted as direct and ticked chore-free in one save: the flag is not written', () => {
  const res = save([{ id: idOf('Vrbo'), countsAsDirect: true, forbidsGuestChores: true, relaysGuestEmail: true }]);
  assert.equal(res.statusCode, 200);
  assert.equal(isDirectChannel('Vrbo'), true);
  assert.equal(stored('Vrbo').forbidsGuestChores, 0);
  assert.equal(stored('Vrbo').relaysGuestEmail, 0);
});

test('no longer counted as direct in the same save: the platform rule is written', () => {
  const res = save([{ id: idOf('Lodgify'), countsAsDirect: false, forbidsGuestChores: true }]);
  assert.equal(res.statusCode, 200);
  assert.equal(isDirectChannel('Lodgify'), false);
  assert.equal(stored('Lodgify').forbidsGuestChores, 1);
});
