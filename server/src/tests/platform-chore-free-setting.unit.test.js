// specs/airbnb-no-checkout-chores.md rule 8 — « Sans corvées de départ » is a platform setting: served by
// the « Plateformes » settings page (`null` on an own channel), saved there (never on an own channel), and
// read back by `isChoreFreeChannel` after every save.
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-chore-free-')), 'c.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const db = require('../database');
const platformsController = require('../controllers/platformsController');
const { isChoreFreeChannel, refreshChoreFreeChannels, refreshDirectChannels } = require('../utils/platformNameFormat');
console.log = silent;

for (const name of ['Airbnb', 'Booking', 'Lodgify']) db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run(name);
const idOf = (name) => db.prepare('SELECT id FROM platforms WHERE name = ?').get(name).id;

function call(handler, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ body, params: {}, query: {} }, res);
  return res;
}
const rowOf = (res, name) => res.body.platforms.find((p) => p.name === name);

test('listSettings: a boolean per platform, null on direct', () => {
  const res = call(platformsController.listSettings);
  assert.equal(rowOf(res, 'direct').forbidsGuestChores, null);
  assert.equal(rowOf(res, 'Airbnb').forbidsGuestChores, false, 'a new platform is ticked by nobody');
});

test('a save ticks a platform and the cache follows without a restart', () => {
  assert.equal(isChoreFreeChannel('Airbnb'), false);
  const res = call(platformsController.saveSettings, { platforms: [{ id: idOf('Airbnb'), forbidsGuestChores: true }] });
  assert.equal(res.statusCode, 200);
  assert.equal(rowOf(res, 'Airbnb').forbidsGuestChores, true);
  assert.equal(isChoreFreeChannel('Airbnb'), true);
  assert.equal(isChoreFreeChannel('Booking'), false);
});

test('a save on direct is ignored', () => {
  call(platformsController.saveSettings, { platforms: [{ id: idOf('direct'), forbidsGuestChores: true }] });
  assert.equal(db.prepare("SELECT forbidsGuestChores FROM platforms WHERE name = 'direct'").get().forbidsGuestChores, 0);
  assert.equal(isChoreFreeChannel('direct'), false);
});

test('a ticked platform later counted as a direct sale is no longer chore-free, and shows no switch', () => {
  db.prepare("UPDATE platforms SET forbidsGuestChores = 1, countsAsDirect = 1 WHERE name = 'Lodgify'").run();
  refreshDirectChannels(db);
  refreshChoreFreeChannels(db);
  assert.equal(isChoreFreeChannel('Lodgify'), false);
  assert.equal(rowOf(call(platformsController.listSettings), 'Lodgify').forbidsGuestChores, null);
  call(platformsController.saveSettings, { platforms: [{ id: idOf('Lodgify'), forbidsGuestChores: false }] });
  assert.equal(db.prepare("SELECT forbidsGuestChores FROM platforms WHERE name = 'Lodgify'").get().forbidsGuestChores, 1,
    'an own channel is not written either');
});
