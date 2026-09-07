// Classifying a Qonto failure into the action that repairs it.
// See specs/qonto-settings-in-app.md §3 rules 10, 14.

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyQontoOutcome, qontoConnectionState } = require('../utils/qontoHealth');

/** The shape `qontoClient.readBody` throws: an HTTP status plus Qonto's own JSON body. */
function qontoError(status, body) {
  const err = new Error(`Qonto call failed (HTTP ${status})`);
  err.status = status;
  err.body = body;
  return err;
}

// Rule 10 — the distinction the 2026-09-06 outage turned on: a wrong secret is a form to fill,
// a lapsed authorisation is a button to press, and both arrive as an HTTP 401.
test('rule 10: invalid_client is a credentials problem, invalid_grant is an authorisation problem', () => {
  const rejected = classifyQontoOutcome(qontoError(401, { error: 'invalid_client' }), { configured: true });
  assert.equal(rejected.state, 'credentials_rejected');
  assert.match(rejected.action, /Client secret/);

  const lapsed = classifyQontoOutcome(qontoError(400, { error: 'invalid_grant' }), { configured: true });
  assert.equal(lapsed.state, 'reauth_required');
  assert.match(lapsed.action, /Reconnecter Qonto/);

  assert.notEqual(rejected.action, lapsed.action);
});

test('rule 10: missing credentials are named as such, not as an opaque failure', () => {
  const out = classifyQontoOutcome(null, { configured: false });
  assert.equal(out.state, 'not_configured');
  assert.equal(out.ok, false);
});

test('rule 10: a never-connected installation is told to authorise, not to re-enter its secret', () => {
  const err = new Error('Qonto is not connected (no refresh token stored)');
  err.code = 'QONTO_NOT_CONNECTED';
  assert.equal(classifyQontoOutcome(err, { configured: true }).state, 'reauth_required');
});

// Rule 10 — a network failure and a rejected credential do not have the same repair.
test('rule 10: an unreachable Qonto is distinguished from a rejected credential', () => {
  const dns = new Error('fetch failed');
  dns.cause = { code: 'ENOTFOUND' };
  assert.equal(classifyQontoOutcome(dns, { configured: true }).state, 'unreachable');

  const refused = new Error('connect ECONNREFUSED');
  refused.code = 'ECONNREFUSED';
  assert.equal(classifyQontoOutcome(refused, { configured: true }).state, 'unreachable');
});

test('rule 10: a Qonto server error is its own state', () => {
  const out = classifyQontoOutcome(qontoError(500, { detail: 'boom' }), { configured: true });
  assert.equal(out.state, 'api_error');
  assert.equal(out.code, 'HTTP 500');
  assert.equal(out.detail, 'boom');
});

test('rule 10: a working call with no link provider is not reported as fully working', () => {
  assert.equal(classifyQontoOutcome(null, { providerEnabled: false }).state, 'provider_not_connected');
  assert.equal(classifyQontoOutcome(null, { providerEnabled: true }).state, 'ok');
});

// Rule 14 — the classification carries Qonto's own words for the operator; the public tunnel's
// generic message is produced elsewhere and never derives from this detail.
test('rule 14: the operator-facing classification keeps the detail Qonto gave', () => {
  const out = classifyQontoOutcome(
    qontoError(401, { error: 'invalid_client', error_description: 'Client authentication failed' }),
    { configured: true },
  );
  assert.equal(out.code, 'invalid_client');
  assert.equal(out.detail, 'Client authentication failed');
  assert.ok(out.explanation.length > 0);
});

// ── The badge (rule 11 lives in its own suite; here: what a stored failure makes it say) ──

test('rule 10: a standing failure makes the badge name that failure', () => {
  const state = qontoConnectionState({
    configured: true,
    hasToken: true,
    providerEnabled: true,
    health: { lastSuccessAt: '2026-09-01T10:00:00Z', lastError: { code: 'invalid_client', message: 'nope', at: '2026-09-06T10:00:00Z' } },
  });
  assert.equal(state.state, 'credentials_rejected');
  assert.equal(state.code, 'invalid_client');
});
