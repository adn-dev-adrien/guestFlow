// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (audit E23-2) — the Qonto credentials: a wrong type used
// to be stored, drop the connection or move production to the sandbox, with a 200.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQontoSettingsController } = require('../utils/qonto/qontoSettingsController');

const FIELDS = ['clientId', 'clientSecret', 'stagingToken', 'webhookSecret', 'publicSiteOrigin'];

function boot() {
  const stored = { environment: 'production', clientId: 'cid', clientSecret: 'sec', stagingToken: 'tok', webhookSecret: 'hook', publicSiteOrigin: '' };
  const writes = [];
  const settings = {
    qontoCredentials: () => ({ ...stored }),
    storeQontoCredentials: (patch) => {
      writes.push(patch);
      Object.entries(patch).forEach(([k, v]) => { if (v !== undefined) stored[k] = v; });
    },
    qontoConnected: () => true,
    storeQontoTokens: () => { stored.tokensCleared = true; },
    storeQontoConnection: () => {},
    recordQontoHealth: () => {},
    qontoHealth: () => ({}),
    qontoTokens: () => ({ accessToken: 'a', refreshToken: 'r', expiresAt: '' }),
    qontoConnection: () => ({ status: 'connected', connectionId: 'c' }),
    publicUrl: () => '',
    qontoWebhookSubscription: () => ({ id: '', callbackUrl: '' }),
  };
  const controller = createQontoSettingsController({ settings, env: {} });
  const put = (body) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    try { controller.updateQontoCredentials({ body }, res); } catch (err) { res.threw = err; }
    return res;
  };
  return { put, stored, writes };
}

test('rule 68 — a credential that is neither absent nor a string is 400 INVALID_FIELD_TYPE, nothing written', () => {
  const { put, stored, writes } = boot();
  for (const key of FIELDS) {
    for (const value of [{ a: 1 }, JSON.parse('{"toString":1}'), ['x', 'y'], [], 123, true]) {
      const res = put({ [key]: value });
      assert.equal(res.statusCode, 400, `${key} ${JSON.stringify(value)}`);
      assert.equal(res.body.code, 'INVALID_FIELD_TYPE');
      assert.equal(res.body.field, key);
    }
  }
  assert.deepEqual(writes, []);
  assert.equal(stored.tokensCleared, undefined);
});

test('rule 68 — an environment is sandbox, production or absent: production is not moved to the sandbox', () => {
  const { put, stored, writes } = boot();
  for (const environment of ['prod', '', 'PRODUCTION', { a: 1 }, ['sandbox'], true, 1]) {
    const res = put({ environment });
    assert.equal(res.statusCode, 400, JSON.stringify(environment));
    assert.equal(res.body.code, 'INVALID_FIELD_TYPE');
    assert.equal(res.body.field, 'environment');
  }
  assert.deepEqual(writes, []);
  assert.equal(stored.environment, 'production');
});

test('rule 68 — null reads as absent: the store never receives the word null', () => {
  const { put, writes } = boot();
  assert.equal(put({ clientId: null, clientSecret: null, environment: null, webhookSecret: null }).threw, undefined);
  for (const patch of writes) {
    for (const value of Object.values(patch)) assert.notEqual(value, null);
  }
});

test('rule 68 — strings pass as before, and the empty string the form sends to clear one', () => {
  const { put, writes } = boot();
  assert.equal(put({ environment: 'sandbox', clientId: 'x', clientSecret: 'y', stagingToken: '', webhookSecret: 'w', publicSiteOrigin: 'https://example.invalid' }).statusCode, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].clientId, 'x');
  assert.equal(writes[0].stagingToken, '');
});
