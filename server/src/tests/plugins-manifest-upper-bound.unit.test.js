// specs/plugins-phase-4-registry.md rule 34 — a plugin never loads on a core major it was not built
// for: every source manifest bounds `guestflow` (« <4.0.0 »), the package build refuses an open range,
// and an open range already published is read as capped at the next major of its floor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { hasUpperBound, boundedRange } = require('../utils/semverRange');
const { rangeRefusal } = require('../utils/pluginOffers');

const PLUGINS = path.join(__dirname, '..', 'plugins');
const manifests = fs.readdirSync(PLUGINS)
  .filter((d) => fs.existsSync(path.join(PLUGINS, d, 'manifest.json')))
  .map((d) => JSON.parse(fs.readFileSync(path.join(PLUGINS, d, 'manifest.json'), 'utf8')));

test('rule 34 — every source manifest bounds the GuestFlow range below 4.0.0', () => {
  assert.ok(manifests.length >= 14);
  assert.deepEqual(manifests.filter((m) => !hasUpperBound(m.guestflow) || !/<4\.0\.0/.test(m.guestflow)).map((m) => m.id), []);
});

test('rule 34 — an open range is capped at the next major of its floor', () => {
  assert.equal(hasUpperBound('>=3.9.0'), false);
  assert.equal(hasUpperBound('>=3.9.0 <4.0.0'), true);
  assert.equal(hasUpperBound('^1.2.0'), true);
  assert.equal(boundedRange('>=3.9.0'), '>=3.9.0 <4.0.0');
  assert.equal(boundedRange('>=3.9.0 <4.0.0'), '>=3.9.0 <4.0.0');
});

test('rule 34 — GuestFlow 4 refuses a package of 3.x, bounded or published before the bound', () => {
  const env = { coreVersion: '4.0.0', sdkVersion: '1.2.0' };
  for (const guestflow of ['>=3.9.0 <4.0.0', '>=3.9.0']) {
    const refusal = rangeRefusal({ guestflow, sdk: '^1.0.0' }, env);
    assert.equal(refusal.code, 'CORE_INCOMPATIBLE', guestflow);
    assert.equal(refusal.message, 'Incompatible avec cette version de GuestFlow.', 'the package is too old, not the core');
  }
  assert.equal(rangeRefusal({ guestflow: '>=3.9.0', sdk: '^1.0.0' }, { coreVersion: '3.12.0', sdkVersion: '1.2.0' }), null);
});

test('rule 34 — loading at boot names the same refusal, without blaming the core', () => {
  const loader = fs.readFileSync(path.join(PLUGINS, 'loader.js'), 'utf8');
  assert.match(loader, /message: 'Incompatible avec cette version\.'/);
  assert.doesNotMatch(loader, /Nécessite une version plus récente/);
});
