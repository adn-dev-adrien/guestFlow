// specs/guest-app-home-automation.md rules 1-2 — the house's « Domotique » tree is the gate connector's: same key,
// same signature (the canonical string pinned with the Sowel plugin), every answer signed, closed without a secret.
const test = require('node:test');
const assert = require('node:assert/strict');

const { startHome } = require('./homeFixtures');

test('a signed ping passes and its answer is signed', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const res = await home.call('GET', '/public/v1/home/ping');
  assert.equal(res.status, 200);
  assert.equal(res.body.contract, 1);
  assert.equal(res.signatureOk, true);
});

test('a wrong signing secret is refused', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const res = await home.call('GET', '/public/v1/home/ping', undefined, { secret: 'pas-le-bon' });
  assert.equal(res.status, 401);
});

test('a wrong key is refused', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const res = await home.call('PUT', '/public/v1/home/catalog', { equipments: [] }, { key: 'pas-la-bonne' });
  assert.equal(res.status, 401);
});

test('a call signed more than 2 minutes ago is refused', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const res = await home.call('GET', '/public/v1/home/ping', undefined, { timestamp: Date.now() - 3 * 60 * 1000 });
  assert.equal(res.status, 401);
});

test('without the secrets, every call is refused', async (t) => {
  const home = await startHome({ env: { GATE_API_KEY: '', GATE_SIGNING_SECRET: '' } });
  t.after(home.close);
  const res = await home.call('GET', '/public/v1/home/ping');
  assert.equal(res.status, 401);
});

test('the signature covers the body: a body other than the signed one is refused', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const res = await home.call('PUT', '/public/v1/home/catalog', { equipments: [{ id: 'x' }] }, { signedBody: { equipments: [] } });
  assert.equal(res.status, 401);
});

// Pinned on both sides: the same two vectors live in sowel-plugin-guestflow's client tests. Changing the canonical
// string here while the plugin keeps its own makes every call fail in production with both suites green.
test('the request signature of the home tree matches the Sowel plugin’s pinned vectors', () => {
  const crypto = require('crypto');
  const { canonicalString } = require('../requireConnector');
  const sign = (method, path, body) => crypto.createHmac('sha256', 's3cret')
    .update(canonicalString(method, path, 1790000000000, body)).digest('hex');
  assert.equal(sign('GET', '/public/v1/home/commands?wait=25', ''), '822f00596e68b7f62d3b133e8cf95845c6406118940eaf5f6b676f0ca88cc908');
  assert.equal(
    sign('POST', '/public/v1/home/commands/results', '{"results":[{"id":7,"ok":false,"reason":"not_occupied"}]}'),
    '18ebdbd1f5df923b24ffec9f51a53e7f0f0b4f6c2d7cee1441f1bc5471f9eb8e',
  );
});
