// specs/payment-polling-fair-use.md rule 12 — a hung Qonto connection is bounded: the call fails as a
// network failure (no status, not retried) instead of holding a poll or retry run for minutes.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQontoClient } = require('../../../utils/qonto/qontoClient');
const { classifyQontoOutcome } = require('../../../utils/qonto/qontoHealth');

function hung() {
  const calls = [];
  const fetchImpl = (url, init) => { calls.push(init); return new Promise(() => {}); };
  return { fetchImpl, calls };
}

test('rule 12: a never-resolving fetch ends with a timeout error, once', async () => {
  const { fetchImpl, calls } = hung();
  const client = buildQontoClient({ fetchImpl, timeoutMs: 30, sandbox: true, clientId: 'c', clientSecret: 's', retry: { sleep: async () => {} } });
  const started = Date.now();
  await assert.rejects(client.getPaymentLink({ accessToken: 'tok', id: 'pl_1' }), (err) => {
    assert.match(err.message, /timeout/i);
    assert.equal(err.code, 'ETIMEDOUT');
    assert.equal(err.status, undefined);
    return true;
  });
  assert.ok(Date.now() - started < 2000);
  assert.equal(calls.length, 1, 'a network failure is not retried');
  assert.ok(calls[0].signal && typeof calls[0].signal.aborted === 'boolean');
  assert.equal(calls[0].signal.aborted, true, 'the request itself is aborted');
});

test('rule 12: the health check reads the timeout as « unreachable »', () => {
  const err = Object.assign(new Error('Qonto x timeout: no answer within 20 s'), { code: 'ETIMEDOUT' });
  assert.equal(classifyQontoOutcome(err, { configured: true, providerEnabled: true }).state, 'unreachable');
});
