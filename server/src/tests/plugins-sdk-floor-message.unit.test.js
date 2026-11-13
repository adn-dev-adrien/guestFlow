// specs/plugins-phase-4-registry.md rules 62 and 63 (D24 kept: the code stays SDK_INCOMPATIBLE, fail-closed) — a package whose SDK floor is
// above the running SDK says « update GuestFlow »; a range the SDK is above, or an unreadable one, keeps the generic message.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rangeRefusal } = require('../utils/pluginOffers');

const TOO_OLD = 'Nécessite une version plus récente de GuestFlow.';
const GENERIC = 'Incompatible avec cette version de GuestFlow.';
const manifest = (sdk) => ({ guestflow: '>=3.18.0', sdk });

test('rule 62 — an SDK floor above the running SDK, same major, asks for a newer GuestFlow', () => {
  assert.deepEqual(
    rangeRefusal(manifest('^2.27.0'), { coreVersion: '4.0.0', sdkVersion: '2.26.0' }),
    { code: 'SDK_INCOMPATIBLE', message: TOO_OLD },
  );
});

test('rule 62 — an SDK ceiling the running SDK is above, another major or an unreadable range keeps the generic message', () => {
  for (const sdk of ['^1.4.0', '^3.0.0', '>=2.0.0 <2.10.0', 'not a range']) {
    assert.deepEqual(
      rangeRefusal(manifest(sdk), { coreVersion: '4.0.0', sdkVersion: '2.26.0' }),
      { code: 'SDK_INCOMPATIBLE', message: GENERIC },
      sdk,
    );
  }
});

test('rule 62 — a satisfied range is no refusal', () => {
  assert.equal(rangeRefusal(manifest('^2.26.0'), { coreVersion: '4.0.0', sdkVersion: '2.27.0' }), null);
});
