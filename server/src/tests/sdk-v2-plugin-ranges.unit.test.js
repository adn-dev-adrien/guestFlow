// specs/sas-arrival-total-server-side.md rules 14, 14bis — SDK 2.0.0 (the client `recapLines` removed)
// refuses every plugin built against `^1.x`, so every plugin of this repository moved to `^2.0.0` in the
// same release, with a new version and a changelog line saying so.
const test = require('node:test');
const assert = require('node:assert/strict');

const { readSourceManifest } = require('../plugins/manifest');
const { PLUGIN_IDS } = require('../constants/plugins');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { satisfies } = require('../utils/semverRange');

test('rule 14: the SDK is 2.x, and a plugin built against SDK 1 is refused', () => {
  assert.match(SDK_VERSION, /^2\.\d+\.\d+$/);
  assert.equal(satisfies(SDK_VERSION, '^1.0.0'), false);
});

test('rule 14bis: every in-repo plugin declares SDK 2 and says so in its changelog', () => {
  assert.ok(PLUGIN_IDS.length >= 14);
  PLUGIN_IDS.forEach((id) => {
    const m = readSourceManifest(id);
    assert.match(m.sdk, /^\^2\.\d+\.0$/, id);
    assert.ok(satisfies(SDK_VERSION, m.sdk), id);
    assert.ok((m.changelog[m.version] || []).some((line) => /SDK 2/.test(line)), `${id} ${m.version} names SDK 2`);
  });
});
