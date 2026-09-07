// Reading the Business API's error envelope, not just its HTTP status.
// See specs/qonto-settings-in-app.md §3 rule 17.
//
// Found by the first production run of v2.13.0: the page said « Qonto a renvoyé une erreur —
// HTTP 400 » while the body already named the cause.

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyQontoOutcome, errorCodeOf, errorMessageOf } = require('../utils/qontoHealth');

/** The envelope `POST /v2/payment_links` answers with. */
function businessApiError(status, errors, traceId = 'abc123') {
  const err = new Error(`Qonto create payment link failed (HTTP ${status})`);
  err.status = status;
  err.body = { errors, trace_id: traceId };
  return err;
}

const PROVIDER_MISSING = businessApiError(400, [
  { code: 'invalid', detail: 'connection with the provider does not exist' },
]);

// Rule 17 — the exact failure the production run hit.
test('rule 17: a payment link refused for a missing provider names the provider, not the support desk', () => {
  const out = classifyQontoOutcome(PROVIDER_MISSING, { configured: true });
  assert.equal(out.state, 'provider_not_connected');
  assert.match(out.action, /Connexion du provider de liens/);
  assert.equal(out.detail, 'connection with the provider does not exist');
});

test('rule 17: the Business API detail reaches the operator instead of the bare HTTP status', () => {
  assert.equal(errorMessageOf(PROVIDER_MISSING), 'connection with the provider does not exist');
  assert.equal(errorCodeOf(PROVIDER_MISSING), 'invalid');
});

// Rule 17 — the OAuth envelope must keep working; it is the one the token refresh uses.
test('rule 17: the OAuth envelope is still read the same way', () => {
  const oauth = new Error('Qonto token refresh failed (HTTP 401)');
  oauth.status = 401;
  oauth.body = { error: 'invalid_client', error_description: 'Client authentication failed' };
  assert.equal(errorCodeOf(oauth), 'invalid_client');
  assert.equal(errorMessageOf(oauth), 'Client authentication failed');
  assert.equal(classifyQontoOutcome(oauth, { configured: true }).state, 'credentials_rejected');
});

test('rule 17: another Business API failure stays a generic API error, with its own words', () => {
  const other = businessApiError(422, [{ code: 'amount_too_high', detail: 'amount exceeds the limit' }]);
  const out = classifyQontoOutcome(other, { configured: true });
  assert.equal(out.state, 'api_error');
  assert.equal(out.code, 'amount_too_high');
  assert.equal(out.detail, 'amount exceeds the limit');
});

test('rule 17: an empty or malformed errors array falls back to the thrown message', () => {
  const empty = businessApiError(500, []);
  assert.equal(errorMessageOf(empty), 'Qonto create payment link failed (HTTP 500)');
  assert.equal(errorCodeOf(empty), 'HTTP 500');

  const malformed = businessApiError(500, ['not an object']);
  assert.equal(errorCodeOf(malformed), 'HTTP 500');
});
