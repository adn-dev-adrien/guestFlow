// specs/sas-arrival-total-server-side.md rules 14, 14bis — SDK 2.0.0 (the client `recapLines` removed)
// refuses every plugin built against `^1.x`, so every plugin of this repository moved to `^2.0.0` in the
// same release, with a new version and a changelog line saying so.
const test = require('node:test');
const assert = require('node:assert/strict');

const { readSourceManifest } = require('../plugins/manifest');
const { PLUGIN_IDS } = require('../constants/plugins');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { satisfies } = require('../utils/semverRange');

// specs/resource-supplements-total-server-side.md rules 21, 22 — SDK 2.2.0 (a new entry point is a MINOR bump);
// hourly-resources 1.2.0 and sas 1.5.0 declare ^2.2.0, the others keep a ^2.N.0 range that 2.2.0 satisfies.
test('rule 14: the SDK is a 2.x, and a plugin built against SDK 1 is refused', () => {
  assert.match(SDK_VERSION, /^2\./);
  assert.equal(satisfies(SDK_VERSION, '^2.0.0'), true);
  assert.equal(satisfies(SDK_VERSION, '^1.0.0'), false);
});

test('rule 14bis: every in-repo plugin declares an SDK 2 range the SDK satisfies, and its CURRENT version says so in its changelog', () => {
  assert.ok(PLUGIN_IDS.length >= 14);
  PLUGIN_IDS.forEach((id) => {
    const m = readSourceManifest(id);
    assert.match(m.sdk, /^\^2\./, id);
    assert.ok(satisfies(SDK_VERSION, m.sdk), `${id} ${m.sdk} is satisfied by SDK ${SDK_VERSION}`);
    assert.ok((m.changelog[m.version] || []).some((line) => /SDK 2/.test(line)), `${id} ${m.version} names SDK 2`);
  });
});
