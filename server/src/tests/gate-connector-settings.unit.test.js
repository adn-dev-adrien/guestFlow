// The settings card of the gate-keys connector — specs/gate-access-sowel-connector.md §3.6 rule 29,
// and §3.4 rule 22: the secrets are never returned by an API.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./gateKeysFixtures');
const { buildController } = require('../controllers/gateConnectorController');

function read(model) {
  let payload = null;
  buildController({ model: () => model }).settings({}, { json(body) { payload = body; return this; } });
  return payload;
}

function withEnv(env, fn) {
  const saved = { GATE_API_KEY: process.env.GATE_API_KEY, GATE_SIGNING_SECRET: process.env.GATE_SIGNING_SECRET };
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// specs/gate-access-sowel-connector.md §3.6 rule 29
test('the card says configured, last read, keys created and where the secrets live', () => {
  const { model } = freshDb();
  model.recordRead('2026-09-27T18:00:00.000Z');
  model.upsertResult({ reservationId: 1, action: 'create', ok: true, code: 'A', receivedAt: 'x' });
  model.upsertResult({ reservationId: 2, action: 'create', ok: true, code: 'B', receivedAt: 'x' });
  model.upsertResult({ reservationId: 3, action: 'create', ok: false, error: 'disabled', receivedAt: 'x' });
  model.upsertResult({ reservationId: 4, action: 'revoke', ok: true, receivedAt: 'x' });

  const payload = withEnv({ GATE_API_KEY: 'the-key-value', GATE_SIGNING_SECRET: 'the-secret-value' }, () => read(model));
  assert.deepEqual(payload, {
    configured: true,
    lastReadAt: '2026-09-27T18:00:00.000Z',
    keysCreated: 2,
    secretsFile: 'server/.env.local',
    secretNames: ['GATE_API_KEY', 'GATE_SIGNING_SECRET'],
  });
});

// specs/gate-access-sowel-connector.md §3.4 rule 22 — never a secret value.
test('no secret value ever leaves through the card', () => {
  const { model } = freshDb();
  const payload = withEnv({ GATE_API_KEY: 'the-key-value', GATE_SIGNING_SECRET: 'the-secret-value' }, () => read(model));
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('the-key-value'), false);
  assert.equal(serialized.includes('the-secret-value'), false);
});

// specs/gate-access-sowel-connector.md §3.6 rule 29 — one secret missing is « not configured ».
test('with one secret missing the connector is not configured', () => {
  const { model } = freshDb();
  const payload = withEnv({ GATE_API_KEY: 'k', GATE_SIGNING_SECRET: '' }, () => read(model));
  assert.equal(payload.configured, false);
  assert.equal(payload.lastReadAt, null);
});
