// specs/hosting-h2-account-security.md rule 36 — a managed instance refuses the E2E suite's key,
// whose private half is committed to this public repository.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { assertNoTestOnlyKey, TEST_ONLY_PUBLIC_KEYS } = require('../utils/testOnlyKeys');

const TEST_KEY = [...TEST_ONLY_PUBLIC_KEYS][0];
const realKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

test('rule 36 — a managed install with the test-only key as either variable refuses to start', () => {
  assert.throws(() => assertNoTestOnlyKey({ GUESTFLOW_MANAGED: '1', GUESTFLOW_LICENCE_PUBLIC_KEY: TEST_KEY }), /GUESTFLOW_LICENCE_PUBLIC_KEY/);
  assert.throws(() => assertNoTestOnlyKey({ GUESTFLOW_MANAGED: '1', GUESTFLOW_LICENCE_PUBLIC_KEY: realKey, GUESTFLOW_REGISTRY_PUBLIC_KEY: ` ${TEST_KEY}\n` }), /GUESTFLOW_REGISTRY_PUBLIC_KEY/);
});

test('rule 36 — a managed install with its own key starts', () => {
  assert.doesNotThrow(() => assertNoTestOnlyKey({ GUESTFLOW_MANAGED: '1', GUESTFLOW_LICENCE_PUBLIC_KEY: realKey }));
  assert.doesNotThrow(() => assertNoTestOnlyKey({ GUESTFLOW_MANAGED: '1' }));
});

test('rule 36 — an unmanaged install (the E2E server) keeps the test-only key', () => {
  assert.doesNotThrow(() => assertNoTestOnlyKey({ GUESTFLOW_LICENCE_PUBLIC_KEY: TEST_KEY }));
  assert.doesNotThrow(() => assertNoTestOnlyKey({ GUESTFLOW_MANAGED: '0', GUESTFLOW_LICENCE_PUBLIC_KEY: TEST_KEY }));
});
