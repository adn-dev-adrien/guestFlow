// specs/platform-settings-relay-and-review.md rule 9 — the core's money path names no payment provider:
// an error the provider knows (Qonto « à connecter d'abord ») is worded by the provider itself through
// `describeError`; without it, the core answers its generic 502 (audit 2026-10-27).
const { requirePlugins } = require('../plugins/sdk/testing');
if (!requirePlugins(['online-payment'])) return;

const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-provider-errors-')), 'p.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const { sendError } = require('../controllers/paymentsController').__test;
const { createQontoProvider } = require('../plugins/online-payment/provider');
console.log = silent;

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const notConnected = Object.assign(new Error('no refresh token'), { code: 'QONTO_NOT_CONNECTED' });

test('the Qonto provider words its own « not connected »', () => {
  const qonto = createQontoProvider({ settings: { qontoConnected: () => false } });
  const r = sendError(res(), notConnected, qonto);
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.body, { error: 'QONTO_NOT_CONNECTED', message: "Qonto à connecter d'abord (OAuth), avant le provider." });
  assert.equal(qonto.describeError(new Error('timeout')), null);
});

test('another provider is answered as it describes its error, and the core no longer knows Qonto', () => {
  const other = {
    label: 'Autrepay',
    errorCode: 'AUTREPAY_API_ERROR',
    describeError: (err) => (err.code === 'AUTREPAY_KYC' ? { httpStatus: 409, error: 'AUTREPAY_KYC', message: 'Vérification Autrepay en cours.' } : null),
  };
  assert.deepEqual(sendError(res(), Object.assign(new Error('x'), { code: 'AUTREPAY_KYC' }), other).body,
    { error: 'AUTREPAY_KYC', message: 'Vérification Autrepay en cours.' });
  const generic = sendError(res(), notConnected, { label: 'Autrepay', errorCode: 'AUTREPAY_API_ERROR' });
  assert.equal(generic.statusCode, 502);
  assert.equal(generic.body.error, 'AUTREPAY_API_ERROR');
  assert.match(generic.body.message, /Erreur de l'API Autrepay/);
});
