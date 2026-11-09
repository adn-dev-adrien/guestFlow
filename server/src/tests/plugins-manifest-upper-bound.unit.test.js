// specs/plugins-phase-4-registry.md rule 34, superseded by rule 62 (D24, 2026-11-09) — a core major bump never
// switches off a plugin whose contract still holds: `guestflow` is read as a floor, the `sdk` range judges
// compatibility. Every source manifest writes a floor only (the package build refuses a ceiling), and a package
// already published with « <4.0.0 » still loads on GuestFlow 4 and later while its SDK range holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isFloorRange, coreFloor } = require('../utils/semverRange');
const { rangeRefusal } = require('../utils/pluginOffers');

const PLUGINS = path.join(__dirname, '..', 'plugins');
const manifests = fs.readdirSync(PLUGINS)
  .filter((d) => fs.existsSync(path.join(PLUGINS, d, 'manifest.json')))
  .map((d) => JSON.parse(fs.readFileSync(path.join(PLUGINS, d, 'manifest.json'), 'utf8')));

test('rule 62 — every source manifest writes its GuestFlow range as a floor, with no ceiling', () => {
  assert.ok(manifests.length >= 14);
  assert.deepEqual(manifests.filter((m) => !isFloorRange(m.guestflow)).map((m) => `${m.id} ${m.guestflow}`), []);
  assert.equal(isFloorRange('>=3.18.0'), true);
  assert.equal(isFloorRange('>=3.18.0 <4.0.0'), false);
  assert.equal(isFloorRange('^3.18.0'), false);
  assert.equal(coreFloor('>=3.9.0 <4.0.0'), '3.9.0');
  assert.equal(coreFloor('not a range'), null);
});

test('rule 62 — a package published with a « <4.0.0 » ceiling loads on GuestFlow 4 and 5 while its SDK range holds', () => {
  for (const coreVersion of ['4.0.0', '4.3.1', '5.0.0']) {
    const env = { coreVersion, sdkVersion: '2.24.0' };
    for (const guestflow of ['>=3.9.0 <4.0.0', '>=3.18.0 <4.0.0', '>=3.9.0']) {
      assert.equal(rangeRefusal({ guestflow, sdk: '^2.0.0' }, env), null, `${guestflow} on ${coreVersion}`);
    }
  }
});

test('rule 62 — an SDK major still refuses, a floor above the core still names the core too old', () => {
  const sdkMoved = rangeRefusal({ guestflow: '>=3.9.0 <4.0.0', sdk: '^2.0.0' }, { coreVersion: '4.0.0', sdkVersion: '3.0.0' });
  assert.deepEqual(sdkMoved, { code: 'SDK_INCOMPATIBLE', message: 'Incompatible avec cette version de GuestFlow.' });
  assert.deepEqual(rangeRefusal({ guestflow: '>=4.1.0', sdk: '^2.0.0' }, { coreVersion: '4.0.0', sdkVersion: '2.24.0' }),
    { code: 'CORE_TOO_OLD', message: 'Nécessite GuestFlow 4.1 ou plus récent.' });
  assert.equal(rangeRefusal({ guestflow: 'not a range', sdk: '^2.0.0' }, { coreVersion: '4.0.0', sdkVersion: '2.24.0' }).code,
    'CORE_INCOMPATIBLE', 'an unreadable range fails closed');
});

test('rule 34 — loading at boot names the same refusal, without blaming the core', () => {
  const loader = fs.readFileSync(path.join(PLUGINS, 'loader.js'), 'utf8');
  assert.match(loader, /message: 'Incompatible avec cette version\.'/);
  assert.doesNotMatch(loader, /Nécessite une version plus récente/);
});
