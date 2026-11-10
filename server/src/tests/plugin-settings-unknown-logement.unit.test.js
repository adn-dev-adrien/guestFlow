// Audit R42-EXT-L2 and its class (2026-11-10) — the id-keyed maps of the plugin settings name logements of the core:
// google-vacation-rentals-feed rule 20 (`properties`), airbnb-mail-intake rule 37 (`listings`), gites-de-france-mail-intake
// rule 36 (`giteNumbers`), booking-extranet-intake rule 38 (`hotelIds`). A key that names no logement is refused, nothing
// stored: it let Envoi pass with no logement, and tied a logement created later to a listing nobody chose. A key already
// stored stays accepted, so a deleted logement's line never blocks a save.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');

let app;
let admin;
let active;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  active = await app.activatePlugins(admin, ['website-booking', 'google-vacation-rentals', 'airbnb-intake', 'gites-de-france-intake', 'booking-intake']);
});
test.after(async () => { if (app) await app.stop(); });

const settingsUrl = (id) => ['/api/plugins', id, 'settings'].join('/');
const stored = (id, key) => (app.readDb('SELECT value FROM plugin_settings WHERE plugin_id = ? AND key = ?', id, key)[0] || {}).value;
const unusedId = () => Number(app.readDb('SELECT COALESCE(MAX(id), 0) + 1000 AS n FROM properties')[0].n);

const MAPS = [
  ['airbnb-intake', 'listings', '12345678'],
  ['gites-de-france-intake', 'giteNumbers', '1234'],
  ['booking-intake', 'hotelIds', '14407976'],
];

for (const [plugin, key, value] of MAPS) {
  test(`${plugin} — ${key} naming a logement that does not exist is refused, nothing stored; a real one is kept`, async (t) => {
    if (!active.has(plugin)) return t.skip(`${plugin} absent from the tree`);
    const before = stored(plugin, key);
    const ghost = await app.call(admin, 'PUT', settingsUrl(plugin), { [key]: JSON.stringify({ [unusedId()]: value }) });
    assert.equal(ghost.status, 400, ghost.text);
    assert.match(ghost.text, /Logement inconnu/);
    assert.equal(stored(plugin, key), before);
    const real = await app.call(admin, 'PUT', settingsUrl(plugin), { [key]: JSON.stringify({ [app.ids.property]: value }) });
    assert.equal(real.status, 200, real.text);
    assert.deepEqual(JSON.parse(stored(plugin, key)), { [app.ids.property]: value });
    // A logement tied, then deleted: its stored line never blocks the next save.
    const created = await app.call(admin, 'POST', '/api/properties', { name: `Passage ${key}`, maxGuests: 2, doubleBeds: 1 });
    assert.equal(created.status, 200, created.text);
    const map = { [app.ids.property]: value, [created.json.id]: value };
    assert.equal((await app.call(admin, 'PUT', settingsUrl(plugin), { [key]: JSON.stringify(map) })).status, 200);
    assert.equal((await app.call(admin, 'DELETE', `/api/properties/${created.json.id}`)).status, 200);
    const again = await app.call(admin, 'PUT', settingsUrl(plugin), { [key]: JSON.stringify(map) });
    assert.equal(again.status, 200, again.text);
  });
}

test('google-vacation-rentals — properties naming a logement that does not exist is refused; Envoi needs a real enabled logement', async (t) => {
  if (!active.has('google-vacation-rentals')) return t.skip('google-vacation-rentals absent from the tree');
  const url = settingsUrl('google-vacation-rentals');
  const ghost = await app.call(admin, 'PUT', url, {
    partnerId: '12345', mode: 'envoi', properties: JSON.stringify({ [unusedId()]: { enabled: true, hotelCode: 'ghost-code' } }),
  });
  assert.equal(ghost.status, 400, ghost.text);
  assert.match(ghost.text, /Logement inconnu/);
  assert.notEqual(stored('google-vacation-rentals', 'mode'), 'envoi');
  assert.doesNotMatch(String(stored('google-vacation-rentals', 'properties') || ''), /ghost-code/);
  const real = await app.call(admin, 'PUT', url, {
    partnerId: '12345', mode: 'envoi', properties: JSON.stringify({ [app.ids.property]: { enabled: true, hotelCode: 'real-code' } }),
  });
  assert.equal(real.status, 200, real.text);
  // Back to simulation: the suite never leaves a plugin in Envoi.
  assert.equal((await app.call(admin, 'PUT', url, { mode: 'simulation' })).status, 200);
});
