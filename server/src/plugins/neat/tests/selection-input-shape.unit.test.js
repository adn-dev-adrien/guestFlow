// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (audit E23-3, R23-I2) — Neat: a selection field that is not
// a string is the route's own 400, before any call; a mapping's source names a real source, whatever Object.prototype holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../../../tests/inputShapeApp');
const { validateMapping, buildServiceFieldValues } = require('../fieldMapping');

const T = JSON.parse('{"toString":1}');
const REQUIRED = { id: 'f', title: 'F', name: 'f', type: 'string', required: true, options: [] };

test('R23-I2 — constructor, __proto__ and toString are no mapping source', () => {
  for (const source of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    const mapping = { f: { source } };
    assert.deepEqual(validateMapping(mapping, [REQUIRED]), { ok: false, errors: [{ fieldId: 'f', error: 'UNKNOWN_SOURCE' }] }, source);
    assert.deepEqual(buildServiceFieldValues(mapping, [{ ...REQUIRED, required: false }], {}), []);
  }
  assert.equal(validateMapping({ f: { source: 'propertyName' } }, [REQUIRED]).ok, true);
});

test('R23-I2 — a constant that is not text is refused as a missing one, never thrown', () => {
  for (const constant of [T, { a: 1 }, ['x']]) {
    const check = validateMapping({ f: { source: 'constant', constant } }, [REQUIRED]);
    assert.deepEqual(check.errors, [{ fieldId: 'f', error: 'CONSTANT_REQUIRED' }], JSON.stringify(constant));
  }
  assert.equal(validateMapping({ f: { source: 'constant', constant: 'x' } }, [REQUIRED]).ok, true);
  assert.equal(validateMapping({ f: { source: 'constant', constant: 3 } }, [{ ...REQUIRED, type: 'number' }]).ok, true);
});

test('rule 68 — PUT /api/neat/selection: credentials stored, a field of another type answers the 400, no [unhandled]', async () => {
  const app = await startApp();
  try {
    const admin = await app.login('admin@shape.test');
    const active = await app.activatePlugins(admin, ['neat']);
    if (!active.has('neat')) return;
    assert.equal((await app.call(admin, 'PUT', '/api/neat/settings', { clientId: 'id', clientSecret: 'secret' })).status, 200);
    const body = { salesChannelId: 'c', contractId: 'k', paymentMethodId: 'p' };
    for (const key of Object.keys(body)) {
      for (const value of [T, { a: 1 }, ['x'], [], true, 1.5]) {
        const mark = app.logMark();
        const res = await app.call(admin, 'PUT', '/api/neat/selection', { ...body, [key]: value });
        assert.equal(res.status, 400, `${key} ${JSON.stringify(value)} → ${res.text.slice(0, 120)}`);
        assert.equal(res.json.error, 'Canal, contrat et mode de paiement sont requis.');
        assert.doesNotMatch(app.logSince(mark), /TypeError|\[unhandled\]/);
      }
    }
  } finally { await app.stop(); }
});
