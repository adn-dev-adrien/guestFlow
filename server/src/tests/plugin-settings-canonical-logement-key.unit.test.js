// Audit R43-DB-L1 (2026-11-10) — the « Logement inconnu. » check of R42-EXT-L2 read a key through its number, so « 01 »
// passed as logement 1. Some readers then look the key up as written (GVR `properties()`, booking `listPending`, every
// settings page), others as a number (booking `propertyIdFor`, GdF, Airbnb): one stored key meant logement 1 to some and
// nothing to others — a dead extranet link, Envoi on with nothing to send, a second Booking hotel tied to logement 1
// that the page could neither show nor clear. The key is the logement's id as the page writes it, or refused
// (specs/google-vacation-rentals-feed.md rule 20, airbnb-mail-intake rule 37, gites-de-france-mail-intake rule 36,
// booking-extranet-intake rule 38, readings of 2026-11-10).
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

const MAPS = [
  ['airbnb-intake', 'listings', '12345678'],
  ['gites-de-france-intake', 'giteNumbers', '1234'],
  ['booking-intake', 'hotelIds', '14407976'],
];

for (const [plugin, key, value] of MAPS) {
  test(`${plugin} — ${key} keyed by a logement written with leading zeros is refused, nothing stored`, async (t) => {
    if (!active.has(plugin)) return t.skip(`${plugin} absent from the tree`);
    const id = String(app.ids.property);
    const before = stored(plugin, key);
    for (const map of [{ [`0${id}`]: value }, { [`00${id}`]: value }, { [id]: value, [`0${id}`]: '999' }]) {
      const res = await app.call(admin, 'PUT', settingsUrl(plugin), { [key]: JSON.stringify(map) });
      assert.equal(res.status, 400, `${JSON.stringify(map)}: ${res.text}`);
      assert.match(res.text, /Logement inconnu/);
      assert.equal(stored(plugin, key), before);
    }
    const real = await app.call(admin, 'PUT', settingsUrl(plugin), { [key]: JSON.stringify({ [id]: value }) });
    assert.equal(real.status, 200, real.text);
  });
}

test('google-vacation-rentals — a logement written « 01 » is refused and never turns Envoi on', async (t) => {
  if (!active.has('google-vacation-rentals')) return t.skip('google-vacation-rentals absent from the tree');
  const url = settingsUrl('google-vacation-rentals');
  const res = await app.call(admin, 'PUT', url, {
    partnerId: '123', mode: 'envoi', properties: JSON.stringify({ [`0${app.ids.property}`]: { enabled: true, hotelCode: 'zero-code' } }),
  });
  assert.equal(res.status, 400, res.text);
  assert.match(res.text, /Logement inconnu/);
  assert.notEqual(stored('google-vacation-rentals', 'mode'), 'envoi');
  assert.doesNotMatch(String(stored('google-vacation-rentals', 'properties') || ''), /zero-code/);
});
