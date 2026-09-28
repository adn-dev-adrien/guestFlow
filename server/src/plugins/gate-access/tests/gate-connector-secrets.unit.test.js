// The three values the Sowel plugin needs, shown to admins — specs/gate-access-sowel-connector.md
// §3.6 rules 29b-29c.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./gateKeysFixtures');
const { buildController, guestflowAddress } = require('../controller');
const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');

function call(controller, req = {}) {
  const headers = {};
  let payload = null;
  const res = {
    set(name, value) { headers[name.toLowerCase()] = value; return this; },
    json(body) { payload = body; return this; },
  };
  controller.secrets({ protocol: 'https', get: (h) => (h === 'host' ? 'gf.example.fr' : undefined), ...req }, res);
  return { headers, payload };
}

// specs/gate-access-sowel-connector.md §3.6 rule 29b
test('the secrets endpoint hands the address and both secrets, never cached', () => {
  const saved = { k: process.env.GATE_API_KEY, s: process.env.GATE_SIGNING_SECRET };
  process.env.GATE_API_KEY = 'key-value';
  process.env.GATE_SIGNING_SECRET = 'secret-value';
  try {
    const { model } = freshDb();
    const controller = buildController({ model: () => model, publicUrl: () => 'https://guestflow.adn-dev.fr/' });
    const { headers, payload } = call(controller);
    assert.equal(headers['cache-control'], 'no-store');
    assert.deepEqual(payload, {
      address: { value: 'https://guestflow.adn-dev.fr', source: 'setting' },
      apiKey: 'key-value',
      signingSecret: 'secret-value',
    });
  } finally {
    if (saved.k === undefined) delete process.env.GATE_API_KEY; else process.env.GATE_API_KEY = saved.k;
    if (saved.s === undefined) delete process.env.GATE_SIGNING_SECRET; else process.env.GATE_SIGNING_SECRET = saved.s;
  }
});

// specs/gate-access-sowel-connector.md §3.6 rule 29b — admins only.
test('reception and the accountant cannot read the secrets', () => {
  for (const roles of [['reception'], ['accountant']]) {
    let passed = false;
    const res = { status() { return this; }, json() { return this; } };
    enforceRoleAccess({ user: { roles }, method: 'GET', path: '/settings/gate-connector/secrets' }, res, () => { passed = true; });
    assert.equal(passed, false, roles[0]);
  }
});

// specs/gate-access-sowel-connector.md §3.6 rule 29c — the address.
test('the address is the configured public URL, else the origin the admin browses from, flagged', () => {
  const req = { protocol: 'https', get: () => 'guestflow.local:4000' };
  assert.deepEqual(guestflowAddress({ publicUrl: ' https://gf.example.fr// ', req }), { value: 'https://gf.example.fr', source: 'setting' });
  assert.deepEqual(guestflowAddress({ publicUrl: '', req }), { value: 'https://guestflow.local:4000', source: 'request' });
  assert.deepEqual(guestflowAddress({ publicUrl: '', req: { protocol: 'http', get: () => '' } }), { value: '', source: 'none' });
});
