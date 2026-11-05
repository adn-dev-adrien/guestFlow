// specs/hosting-h2-account-security.md rule 18, reading of 2026-11-05 (audit R23-A1) — a null is not a secret and clears
// none: the support policy lets `null` through on PUT /onboarding/emails as « nothing written », and the writer now agrees.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { forbiddenReason } = require('../utils/supportSessionPolicy');

const deps = { isSecretSetting: () => false, isSecretRoute: () => false };
let app;
let admin;
let url;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  url = `/api/properties/${app.ids.property}/arrival-facts`;
});
test.after(async () => { if (app) await app.stop(); });

const secrets = () => app.readDb('SELECT accessCodeEncrypted AS code, wifiPasswordEncrypted AS wifi FROM property_arrival_facts WHERE propertyId = ?', app.ids.property)[0];

async function storeSecrets() {
  const res = await app.call(admin, 'PUT', url, { accessCode: '4321', wifiPassword: 'wifi-secret', wifiName: 'n' });
  assert.equal(res.status, 200);
  return secrets();
}

test('rule 18 — what the policy lets through with a null leaves both secrets stored on the assistant', async () => {
  const before = await storeSecrets();
  const body = { properties: [{ id: app.ids.property, accessCode: null, wifiPassword: null }] };
  assert.equal(forbiddenReason('PUT', '/onboarding/emails', body, deps), null);
  const res = await app.call(admin, 'PUT', '/api/onboarding/emails', body);
  assert.equal(res.status, 200);
  assert.deepEqual(secrets(), before);
  const form = (await app.call(admin, 'GET', url)).json;
  assert.equal(form.hasAccessCode, true);
  assert.equal(form.hasWifiPassword, true);
});

test('rule 18 — the empty field the assistant sends still writes nothing, a typed code still replaces', async () => {
  const before = await storeSecrets();
  await app.call(admin, 'PUT', '/api/onboarding/emails', { properties: [{ id: app.ids.property, accessCode: '', wifiPassword: '' }] });
  assert.deepEqual(secrets(), before);
  await app.call(admin, 'PUT', '/api/onboarding/emails', { properties: [{ id: app.ids.property, accessCode: '9999' }] });
  assert.notEqual(secrets().code, before.code);
  assert.equal(secrets().wifi, before.wifi);
});

test('rule 18 — the property form: null keeps a secret, only the empty field it sends clears it', async () => {
  const before = await storeSecrets();
  assert.equal((await app.call(admin, 'PUT', url, { accessCode: null, wifiPassword: null })).status, 200);
  assert.deepEqual(secrets(), before);
  assert.equal((await app.call(admin, 'PUT', url, { accessCode: '' })).status, 200);
  assert.equal(secrets().code, '');
  assert.equal(secrets().wifi, before.wifi);
});
