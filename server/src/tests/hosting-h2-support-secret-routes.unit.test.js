// specs/hosting-h2-account-security.md rule 23 — a route that hands out, creates or rotates a secret is
// refused to a support session: the routes a plugin declares with `ctx.secretRoutes` (the gate
// connector's keys here; the Booking script in booking-intake's own suite), and the core's iCal export
// token rotation. specs/hosting-h2-account-security.md rule 31 — the plugin's declaration is the only
// source of those routes: the core policy keeps no copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-h2-secret-routes-')), 'core.db');
process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
const silent = console.log;
console.log = () => {};
require('../database');
console.log = silent;

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { forbiddenReason } = require('../utils/supportSessionPolicy');

test('rule 23 — a route declared with ctx.secretRoutes is refused, by method, any case, any trailing slash', () => {
  const routes = [{ method: 'GET', re: /^\/demo\/key$/ }, { method: '*', re: /^\/demo\/key\/rotate$/ }];
  const isSecretRoute = (method, p) => routes.some((e) => (e.method === '*' || e.method === method) && e.re.test(p));
  assert.equal(forbiddenReason('GET', '/Demo/Key/', {}, { isSecretRoute }), 'credentials');
  assert.equal(forbiddenReason('POST', '/demo/key/rotate', {}, { isSecretRoute }), 'credentials');
  assert.equal(forbiddenReason('DELETE', '/demo/key/rotate', {}, { isSecretRoute }), 'credentials');
  assert.equal(forbiddenReason('POST', '/demo/key', {}, { isSecretRoute }), null, 'only the declared method');
  assert.equal(forbiddenReason('GET', '/demo/other', {}, { isSecretRoute }), null);
});

test('rule 23 — ctx.secretRoutes records its entries and refuses a malformed one', () => {
  registry.reset();
  const ctx = createContext('demo', { db: new Database(':memory:') });
  ctx.secretRoutes([{ method: 'GET', re: /^\/demo\/key$/ }]);
  assert.throws(() => ctx.secretRoutes([{ method: 'GET', re: '/demo/key' }]), /secret route needs/);
  assert.equal(forbiddenReason('GET', '/demo/key', {}), 'credentials', 'read from the live registry');
  assert.equal(forbiddenReason('HEAD', '/demo/key', {}), 'credentials', 'a HEAD is answered by the GET handler');
  registry.reset();
});

test('rule 23 — the gate connector declares its keys as a secret route', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'gate-access', 'index.js'), 'utf8');
  assert.match(source, /ctx\.secretRoutes\(\[\{ method: 'GET', re: \/\^\\\/settings\\\/gate-connector\\\/secrets\$\/ \}\]\)/);
  // The plugin's declaration is the only source: the core policy holds no copy of the path.
  registry.reset();
  assert.equal(forbiddenReason('GET', '/settings/gate-connector/secrets', {}), null, 'nothing declared, nothing refused');
  require('../plugins/gate-access').register(createContext('gate-access', { db: new Database(':memory:') }));
  assert.equal(forbiddenReason('GET', '/settings/gate-connector/secrets', {}), 'credentials');
  assert.equal(forbiddenReason('HEAD', '/SETTINGS/Gate-Connector/Secrets/', {}), 'credentials');
  assert.equal(forbiddenReason('GET', '/settings/gate-connector', {}), null, 'the connector status stays readable');
  registry.reset();
});

test('rule 23 — rotating a property iCal export token is refused', () => {
  assert.equal(forbiddenReason('POST', '/ical/regenerate-token/3', {}), 'credentials');
  assert.equal(forbiddenReason('POST', '/ICAL/Regenerate-Token/3/', {}), 'credentials');
});

test('rule 24 — reading a property iCal export token is refused too; the public feed is not', () => {
  assert.equal(forbiddenReason('GET', '/ical/token/3', {}), 'credentials');
  assert.equal(forbiddenReason('HEAD', '/ICAL/Token/3/', {}), 'credentials');
  assert.equal(forbiddenReason('GET', '/ical/export/abc.ics', {}), null);
});
