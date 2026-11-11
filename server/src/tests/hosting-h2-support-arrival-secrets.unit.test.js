// specs/hosting-h2-account-security.md rule 18 — a support session cannot change the sender name
// through the start assistant (PUT /api/onboarding/emails), nor a property's access code or Wi-Fi
// password, whether the start assistant or the property page writes them. The other fields of those
// forms stay open to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { forbiddenReason } = require('../utils/supportSessionPolicy');

const deps = { isSecretSetting: () => false, isSecretRoute: () => false };
const judge = (method, path, body) => forbiddenReason(method, path, body, deps);

test('rule 18 — the start assistant cannot change the sender name, by any spelling of the path', () => {
  assert.equal(judge('PUT', '/onboarding/emails', { senderName: 'Support' }), 'credentials');
  assert.equal(judge('PUT', '/ONBOARDING/Emails/', { senderName: '' }), 'credentials');
});

test('rule 18 — the start assistant cannot write an access code or a Wi-Fi password', () => {
  assert.equal(judge('PUT', '/onboarding/emails', { properties: [{ id: 1, accessCode: '4821' }] }), 'credentials');
  assert.equal(judge('PUT', '/onboarding/emails', { properties: [{ id: 1 }, { id: 2, wifiPassword: 'soleil' }] }), 'credentials');
});

test('rule 18 — the start assistant stays open for the other fields, and an empty secret writes nothing', () => {
  assert.equal(judge('PUT', '/onboarding/emails', { phone: '06 00 00 00 00', properties: [{ id: 1, wifiName: 'Solio', accessCode: '', wifiPassword: '' }] }), null);
  assert.equal(judge('GET', '/onboarding', {}), null);
});

test('rule 18 — the property page cannot set or clear the access code or the Wi-Fi password', () => {
  assert.equal(judge('PUT', '/properties/3/arrival-facts', { accessCode: '1234' }), 'credentials');
  assert.equal(judge('PUT', '/properties/3/arrival-facts', { wifiPassword: '' }), 'credentials');
  assert.equal(judge('PUT', '/properties/3/arrival-facts', { address: '1 rue des Pins', wifiName: 'Solio' }), null);
  assert.equal(judge('GET', '/properties/3/arrival-facts', {}), null);
});
