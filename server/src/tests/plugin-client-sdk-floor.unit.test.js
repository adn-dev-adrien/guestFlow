// specs/plugins-phase-1-sdk.md rules 16, 51, 53, 54 (loop t1 AS-3) — the CLIENT half of plugin-core-hardening-floor: a plugin whose client
// code imports an export of `client/src/plugins/sdk/index.js` asks for the SDK that first shipped it. The core SDK's floor list only scans
// the server sources; without this one a client-only dependency on a newer export would let an older core load a bundle that crashes.
// Exports recorded here are the ones whose SDK minor is written next to them in the barrel; the 2.29-2.31 numbers are those of the
// renumbering of 2026-11-15 (StaySalesSection 2.29.0, SuggestedArticlesStep / SalePaymentLink 2.31.0).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { readSourceManifest } = require('../plugins/manifest');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { satisfies } = require('../utils/semverRange');

const CLIENT_PLUGINS = path.join(__dirname, '..', '..', '..', 'client', 'src', 'plugins');
const SERVER_PLUGINS = path.join(__dirname, '..', 'plugins');

const CLIENT_EXPORTS = [
  { names: ['FilterChip', 'PlatformPenaltyDialog'], sdk: '2.9.0' },
  { names: ['TenderLines', 'TENDER_TEXTS'], sdk: '2.24.0' },
  { names: ['usePostalCodeCities'], sdk: '2.25.0' },
  { names: ['ClientPickerField'], sdk: '2.27.0' },
  { names: ['StaySalesSection'], sdk: '2.29.0' },
  { names: ['SuggestedArticlesStep', 'SalePaymentLink'], sdk: '2.31.0' },
];

const floorOf = (text) => CLIENT_EXPORTS
  .filter(({ names }) => names.some((n) => new RegExp(`\\b${n}\\b`).test(text)))
  .map(({ names, sdk }) => ({ feature: names.join(', '), sdk }));

function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') out.push(...sources(full));
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

const clientBarrel = fs.existsSync(CLIENT_PLUGINS) ? fs.readFileSync(path.join(CLIENT_PLUGINS, 'sdk', 'index.js'), 'utf8') : '';

test('rule 54: every export of the list is still exported by the client SDK barrel', { skip: !clientBarrel }, () => {
  for (const { names } of CLIENT_EXPORTS) for (const n of names) assert.match(clientBarrel, new RegExp(`\\b${n}\\b`), `${n} left the barrel`);
});

test('rule 54: the discovery sees a destructured import and ignores a similarly named word', () => {
  assert.deepEqual(floorOf("import { api, SalePaymentLink } from 'guestflow/sdk/ui';").map((h) => h.sdk), ['2.31.0']);
  assert.deepEqual(floorOf('const MySalePaymentLinkish = 1; StaySalesSections;'), []);
});

test('rule 54: the SDK that ships the client exports is at least the highest floor listed', () => {
  for (const { sdk } of CLIENT_EXPORTS) assert.ok(satisfies(SDK_VERSION, `>=${sdk}`), `${SDK_VERSION} < ${sdk}`);
});

if (fs.existsSync(CLIENT_PLUGINS)) {
  for (const entry of fs.readdirSync(CLIENT_PLUGINS, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'sdk' || entry.name === '__tests__') continue;
    if (!fs.existsSync(path.join(SERVER_PLUGINS, entry.name, 'manifest.json'))) continue;
    const text = sources(path.join(CLIENT_PLUGINS, entry.name)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const hits = floorOf(text);
    if (!hits.length) continue;
    test(`rule 54: ${entry.name}: its client code uses ${hits.map((h) => h.feature).join(' + ')}, so its manifest refuses an SDK before the floor`, () => {
      const m = readSourceManifest(entry.name);
      for (const h of hits) {
        const [major, minor] = h.sdk.split('.').map(Number);
        assert.equal(satisfies(`${major}.${minor - 1}.0`, m.sdk), false, `${entry.name} ${m.sdk} still loads on SDK before ${h.sdk} (${h.feature})`);
      }
      assert.ok(satisfies(SDK_VERSION, m.sdk));
    });
  }
}
