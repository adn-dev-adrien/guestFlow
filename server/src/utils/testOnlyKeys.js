/**
 * Public keys whose private half is committed to this public repository for the E2E suite
 * (e2e/fixtures/accountSecurity.js). Anyone can sign a licence, a registry index or a support link
 * for them, so a managed install refuses to start with one as GUESTFLOW_LICENCE_PUBLIC_KEY or
 * GUESTFLOW_REGISTRY_PUBLIC_KEY (specs/hosting-h2-account-security.md rule 36).
 *
 * assertNoTestOnlyKey(env) throws when GUESTFLOW_MANAGED=1 and either variable holds such a key.
 */

const TEST_ONLY_PUBLIC_KEYS = new Set([
  'MCowBQYDK2VwAyEA021QF2PhmPPOl5YUpe0mb4+a4RNkz1AsczLbtRJw9Yw=',
]);

function assertNoTestOnlyKey(env = process.env) {
  if (env.GUESTFLOW_MANAGED !== '1') return;
  for (const name of ['GUESTFLOW_LICENCE_PUBLIC_KEY', 'GUESTFLOW_REGISTRY_PUBLIC_KEY']) {
    if (TEST_ONLY_PUBLIC_KEYS.has(String(env[name] || '').trim())) {
      throw new Error(`${name} is the E2E suite's test-only key, whose private half is public`);
    }
  }
}

module.exports = { assertNoTestOnlyKey, TEST_ONLY_PUBLIC_KEYS };
