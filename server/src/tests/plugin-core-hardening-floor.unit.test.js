// specs/plugins-phase-4-registry.md rules 51 and 54 (audit r3 N-R3-1, audit r4 N-R4-1) — a plugin whose behaviour
// rests on a hardening of the CORE (the linear e-mail check, the mailbox reader's caps, the Qonto timeout, the scoped
// cancellation retry) asks for the SDK that ships it: a core older than that SDK refuses the package instead of
// running it without the hardening.
//
// The list of relying plugins is DISCOVERED: HARDENINGS maps a core feature, recognised by the call that reaches it,
// to the SDK that shipped it, and every plugin source file is scanned. A new plugin (or a new call) that reaches a
// listed feature without the floor fails here. What it cannot do is know a hardening nobody listed: shipping one
// still means adding a row to HARDENINGS (a reviewer's check), and a module name built at run time is not seen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { readSourceManifest } = require('../plugins/manifest');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { satisfies } = require('../utils/semverRange');
const { missingPlugins } = require('../plugins/sdk/testing');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const HARDENED_AT = '2.15.0';

const HARDENINGS = [
  { feature: 'linear e-mail check', sdk: HARDENED_AT, pattern: /validateEmail\(/ },
  { feature: 'mailbox reader caps and parser version', sdk: HARDENED_AT, pattern: /\breadMailsFrom\b|\bmanifestVersion\(/ },
  { feature: 'scoped cancellation retry', sdk: HARDENED_AT, pattern: /retryPendingCancellations/ },
  { feature: 'mail cap report and unverifiable-mailbox reading', sdk: '2.16.0', pattern: /\bonCap\b/ },
  { feature: 'Qonto request timeout', sdk: HARDENED_AT, pattern: /coreModule\(\s*['"`]qonto['"`]\s*[,)]/ },
];

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'client' || entry.name === 'tests') continue;
      out.push(...sourceFiles(full));
    } else if (/\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

const hardeningsIn = (text) => HARDENINGS.filter((h) => h.pattern.test(text));

const relying = new Map();
for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || !fs.existsSync(path.join(PLUGINS_DIR, entry.name, 'manifest.json'))) continue;
  const text = sourceFiles(path.join(PLUGINS_DIR, entry.name)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const hits = hardeningsIn(text);
  if (hits.length) relying.set(entry.name, hits);
}

test('rule 51: the SDK that ships the hardenings is at least 2.15.0', () => {
  assert.ok(satisfies(SDK_VERSION, `>=${HARDENED_AT}`), SDK_VERSION);
});

test('rule 54: the discovery sees double quotes, a destructured readMailsFrom and a spread-out coreModule call', () => {
  const features = (text) => hardeningsIn(text).map((h) => h.feature);
  assert.ok(features('sdk.coreModule("qonto").qontoService').includes('Qonto request timeout'));
  assert.ok(features("sdk.coreModule(\n  `qonto`,\n)").includes('Qonto request timeout'));
  assert.ok(features('const { readMailsFrom } = sdk.mailbox;\nawait readMailsFrom({});').includes('mailbox reader caps and parser version'));
  assert.deepEqual(features('sdk.coreModule("dateFr")'), []);
});

test('rule 54: the discovery finds the plugins audit r3 and r4 named', () => {
  const named = ['website-booking', 'booking-intake', 'airbnb-intake', 'gites-de-france-intake', 'online-payment'];
  for (const id of named.filter((p) => !missingPlugins([p]).length)) {
    assert.ok(relying.has(id), `${id} is not discovered as relying on a core hardening`);
  }
});

for (const [id, hits] of relying) {
  test(`rule 54: ${id} refuses a core whose SDK predates ${hits.map((h) => h.feature).join(', ')}, and loads on this one`, () => {
    const m = readSourceManifest(id);
    for (const h of hits) {
      const [major, minor] = h.sdk.split('.').map(Number);
      const before = `${major}.${minor - 1}.0`;
      assert.equal(satisfies(before, m.sdk), false, `${id} ${m.sdk} still loads on SDK ${before} (${h.feature})`);
    }
    const newest = hits.map((h) => h.sdk).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    assert.equal(satisfies(newest, m.sdk), true, `${id} ${m.sdk} refuses SDK ${newest}`);
    assert.ok(satisfies(SDK_VERSION, m.sdk));
    assert.ok((m.changelog[m.version] || []).some((line) => /SDK 2\.\d+/.test(line)), `${id} ${m.version} names its SDK`);
  });
}
