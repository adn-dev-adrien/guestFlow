// specs/plugins-phase-1-sdk.md rules 16, 52, 54, 55 (loop t1 AS-3) — the CLIENT half of plugin-core-hardening-floor: a plugin whose client
// code imports an export of `client/src/plugins/sdk/index.js` asks for the SDK that first shipped it. The core SDK's floor list only scans
// the server sources; without this one a client-only dependency on a newer export would let an older core load a bundle that crashes.
// Exports recorded here are the ones whose SDK minor is written next to them in the barrel; the 2.30-2.32 numbers are those of the
// renumberings of 2026-11-15 and 2026-11-17 (StaySalesSection 2.30.0, SuggestedArticlesStep / SalePaymentLink / StandaloneSaleDialog 2.32.0 — the last one added in loop t2 AS2-1).
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
  // specs/mollie-rolling-reserve-and-incoming-payments.md rule 12 — master's SDK 2.29.0 export, merged 2026-11-17.
  { names: ['TransactionRef'], sdk: '2.29.0' },
  { names: ['StaySalesSection'], sdk: '2.30.0' },
  { names: ['SuggestedArticlesStep', 'SalePaymentLink', 'StandaloneSaleDialog'], sdk: '2.32.0' },
  // Loop t20 UI20-1 — the dialogs that render a sale block wait for its code (rule 54, reading 2026-11-18).
  { names: ['useSaleComponentsReady'], sdk: '2.32.0' },
  // Loop t22 UI22-1 — the sale dialogs keep the focus when an answer removes the control holding it (rule 54, reading 2026-11-18).
  { names: ['FocusKeeper'], sdk: '2.32.0' },
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

test('rule 55: every export of the list is still exported by the client SDK barrel', { skip: !clientBarrel }, () => {
  for (const { names } of CLIENT_EXPORTS) for (const n of names) assert.match(clientBarrel, new RegExp(`\\b${n}\\b`), `${n} left the barrel`);
});

// Loop t2 AS2-1: StandaloneSaleDialog shipped under its « SDK 2.32.0 » comment with no row. From 2.24.0 on, every export placed right under a
// comment naming its SDK must carry a row at that SDK, so the list cannot fall behind the barrel again.
test('rule 55: every barrel export announced with an SDK ≥ 2.24.0 has its row in the list, at that SDK', { skip: !clientBarrel }, () => {
  const lines = clientBarrel.split('\n');
  const listed = new Map(CLIENT_EXPORTS.flatMap(({ names, sdk }) => names.map((n) => [n, sdk])));
  let checked = 0;
  lines.forEach((line, i) => {
    const announced = /^\/\/.*\bSDK (\d+\.\d+\.\d+)\.?\s*$/.exec(line);
    if (!announced || !satisfies(announced[1], '>=2.24.0')) return;
    for (let j = i + 1; j < lines.length && lines[j].startsWith('export '); j += 1) {
      const names = /^export \{([^}]*)\}/.exec(lines[j])[1].split(',').map((p) => p.trim().split(/\s+as\s+/).pop());
      for (const n of names) {
        assert.equal(listed.get(n), announced[1], `${n} is announced at SDK ${announced[1]} but has no matching row in CLIENT_EXPORTS`);
        checked += 1;
      }
    }
  });
  assert.ok(checked >= 8, `only ${checked} announced exports read: the barrel's comment format changed`);
});

test('rule 55: the discovery sees a destructured import and ignores a similarly named word', () => {
  assert.deepEqual(floorOf("import { api, SalePaymentLink } from 'guestflow/sdk/ui';").map((h) => h.sdk), ['2.32.0']);
  assert.deepEqual(floorOf('const MySalePaymentLinkish = 1; StaySalesSections;'), []);
});

test('rule 55: the SDK that ships the client exports is at least the highest floor listed', () => {
  for (const { sdk } of CLIENT_EXPORTS) assert.ok(satisfies(SDK_VERSION, `>=${sdk}`), `${SDK_VERSION} < ${sdk}`);
});

if (fs.existsSync(CLIENT_PLUGINS)) {
  for (const entry of fs.readdirSync(CLIENT_PLUGINS, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'sdk' || entry.name === '__tests__') continue;
    if (!fs.existsSync(path.join(SERVER_PLUGINS, entry.name, 'manifest.json'))) continue;
    const text = sources(path.join(CLIENT_PLUGINS, entry.name)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const hits = floorOf(text);
    if (!hits.length) continue;
    test(`rule 55: ${entry.name}: its client code uses ${hits.map((h) => h.feature).join(' + ')}, so its manifest refuses an SDK before the floor`, () => {
      const m = readSourceManifest(entry.name);
      for (const h of hits) {
        const [major, minor] = h.sdk.split('.').map(Number);
        assert.equal(satisfies(`${major}.${minor - 1}.0`, m.sdk), false, `${entry.name} ${m.sdk} still loads on SDK before ${h.sdk} (${h.feature})`);
      }
      assert.ok(satisfies(SDK_VERSION, m.sdk));
    });
  }
}
