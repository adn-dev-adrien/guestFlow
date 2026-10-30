// specs/plugin-dependencies.md rules 16 and 20 — CI validates the shipped graph (a requirement that is
// not shipped, a self-requirement, a range the shipped version breaks, a cycle), and the shipped graph
// holds the one edge rule 20 adds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { skipWithout } = require('../plugins/sdk/testing');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'check-plugin-versions.mjs')).href);
const m = (id, version, requires = []) => ({ id, version, requires });
const need = (id, range) => ({ id, range });

test('rule 16: a sound graph has no violation', async () => {
  const { requirementViolations } = await load();
  assert.deepEqual(requirementViolations({ aa: m('aa', '1.0.0', [need('bb', '^1.7.1')]), bb: m('bb', '1.8.3'), cc: m('cc', '1.0.0') }), []);
});

test('rule 16: a requirement that is not shipped is named', async () => {
  const { requirementViolations } = await load();
  assert.deepEqual(requirementViolations({ aa: m('aa', '1.0.0', [need('zz', '^1.0.0')]) }), ['aa requires zz, which is not shipped']);
});

test('rule 16: a plugin requiring itself is named once', async () => {
  const { requirementViolations } = await load();
  assert.deepEqual(requirementViolations({ aa: m('aa', '1.0.0', [need('aa', '^1.0.0')]) }), ['aa requires itself']);
});

test('rule 16: a range the shipped version does not satisfy says both', async () => {
  const { requirementViolations } = await load();
  assert.deepEqual(
    requirementViolations({ gvr: m('gvr', '1.0.2', [need('wb', '^2.0.0')]), wb: m('wb', '1.8.3') }),
    ['gvr requires wb ^2.0.0, shipped 1.8.3'],
  );
});

test('rule 16: a cycle is named with its path', async () => {
  const { requirementViolations } = await load();
  assert.deepEqual(
    requirementViolations({ aa: m('aa', '1.0.0', [need('bb', '^1.0.0')]), bb: m('bb', '1.0.0', [need('cc', '^1.0.0')]), cc: m('cc', '1.0.0', [need('aa', '^1.0.0')]) }),
    ['dependency cycle: aa -> bb -> cc -> aa'],
  );
});

test('rule 16: the manifests this tree ships pass the check', async () => {
  const { requirementViolations } = await load();
  const dir = path.join(ROOT, 'server', 'src', 'plugins');
  const shipped = Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'manifest.json')))
    .map((d) => [d.name, JSON.parse(fs.readFileSync(path.join(dir, d.name, 'manifest.json'), 'utf8'))]));
  assert.deepEqual(requirementViolations(shipped), []);
});

test('rule 20: weather-alerts requires sas ^1.7.0, in 1.3.0, with its French changelog line', { skip: skipWithout(['weather-alerts', 'sas']) }, () => {
  const { readSourceManifest: read } = require('../plugins/manifest');
  const weather = read('weather-alerts');
  assert.deepEqual(weather.requires, [{ id: 'sas', range: '^1.7.0' }]);
  assert.equal(weather.version, '1.3.0');
  assert.equal(weather.changelog['1.3.0'][0], 'Nécessite Arrivée et départ guidés.');
  const { satisfies } = require('../utils/semverRange');
  assert.ok(satisfies(read('sas').version, '^1.7.0'), 'the shipped sas satisfies the range');
});

test('rule 20: the other implicit links stay undeclared — the only edges shipped are the two arbitrated', { skip: skipWithout(['weather-alerts', 'sas', 'google-vacation-rentals', 'website-booking']) }, () => {
  const { PLUGIN_CATALOG } = require('../constants/plugins');
  const edges = PLUGIN_CATALOG.flatMap((p) => (p.requires || []).map((r) => `${p.id}>${r.id}`)).sort();
  assert.deepEqual(edges, ['google-vacation-rentals>website-booking', 'weather-alerts>sas']);
});

test('rule 16: the check reads ranges without a dependency, and agrees with semver on the forms manifests use', async () => {
  const { satisfiesSimple } = await load();
  const { satisfies } = require('../utils/semverRange');
  const cases = [
    ['1.8.3', '^1.7.1'], ['1.7.1', '^1.7.1'], ['1.7.0', '^1.7.1'], ['2.0.0', '^1.7.1'], ['1.99.9', '^1.0.0'],
    ['0.3.5', '^0.3.1'], ['0.4.0', '^0.3.1'], ['0.0.3', '^0.0.3'], ['0.0.4', '^0.0.3'],
    ['3.10.0', '>=3.10.0'], ['3.9.9', '>=3.10.0'], ['4.0.0', '>=3.10.0'],
  ];
  cases.forEach(([version, range]) => assert.equal(satisfiesSimple(version, range), satisfies(version, range), `${version} ${range}`));
  assert.equal(satisfiesSimple('1.0.0', '~1.0.0'), null, 'a form it does not read is said, not guessed');
});

test('rule 16: a range the check does not read is a violation naming it', async () => {
  const { requirementViolations } = await load();
  assert.deepEqual(
    requirementViolations({ aa: m('aa', '1.0.0', [need('bb', '~1.0.0')]), bb: m('bb', '1.0.1') }),
    ['aa requires bb with a range this check does not read: ~1.0.0'],
  );
});

test('rule 16: the script runs where no node_modules is installed', () => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-nodeps-'));
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'check-plugin-versions.mjs'), path.join(tmp, 'scripts', 'check-plugin-versions.mjs'));
  fs.cpSync(path.join(ROOT, 'server', 'src', 'utils'), path.join(tmp, 'server', 'src', 'utils'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'server', 'src', 'plugins', 'aa'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'server', 'src', 'plugins', 'aa', 'manifest.json'), JSON.stringify(m('aa', '1.0.0', [need('aa', '^1.0.0')])));
  execFileSync('git', ['init', '-q'], { cwd: tmp });
  let out = '';
  try {
    execFileSync('node', ['scripts/check-plugin-versions.mjs', '--base', 'HEAD'], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    out = String(err.stderr);
  }
  assert.match(out, /aa requires itself/);
  assert.doesNotMatch(out, /Cannot find module/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
