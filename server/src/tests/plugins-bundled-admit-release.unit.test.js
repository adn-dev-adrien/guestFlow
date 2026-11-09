// specs/plugins-phase-4-registry.md rule 62 and specs/self-update-and-releases.md rule 54 (D24, audit R34-CON-H1 /
// R34-P1) — a release never ships a plugin its own core refuses at boot: every bundled manifest admits the root
// package.json version and SDK_VERSION, and the next core majors too while the SDK major holds.
// `check-plugin-versions` (the release `verify` job, every PR, the release skill's pre-flight with `--core-version`)
// applies the loader's reading and goes red otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const { rangeRefusal } = require('../utils/pluginOffers');
const { SDK_VERSION } = require('../plugins/sdk/version');
const loader = require('../plugins/loader');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PLUGINS = path.join(ROOT, 'server', 'src', 'plugins');
const load = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'check-plugin-versions.mjs')).href);
const ROOT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const ids = fs.readdirSync(PLUGINS).filter((d) => fs.existsSync(path.join(PLUGINS, d, 'manifest.json')));
const shipped = Object.fromEntries(ids.map((id) => [id, JSON.parse(fs.readFileSync(path.join(PLUGINS, id, 'manifest.json'), 'utf8'))]));
const major = Number(ROOT_VERSION.split('.')[0]);
const CORES = [ROOT_VERSION, `${major + 1}.0.0`, `${major + 2}.0.0`];

test('rule 62: every bundled plugin admits its own core, the next two majors and SDK_VERSION', () => {
  assert.ok(ids.length >= 14);
  for (const coreVersion of CORES) {
    const refused = ids.filter((id) => rangeRefusal(shipped[id], { coreVersion, sdkVersion: SDK_VERSION }));
    assert.deepEqual(refused, [], `GuestFlow ${coreVersion}`);
  }
});

test('rule 62: loading the bundled packages on the next major leaves none incompatible', () => {
  for (const coreVersion of CORES) {
    const out = loader.loadPackages({
      store: { packageDirFor: (id) => path.join(PLUGINS, id) },
      rows: ids.map((id) => ({ id, source: 'bundled' })),
      order: ids,
      env: { coreVersion, sdkVersion: SDK_VERSION, hostExports: null },
    });
    assert.deepEqual(out.incompatible, {}, `GuestFlow ${coreVersion}`);
    assert.equal(Object.keys(out.manifests).length, ids.length);
  }
});

test('rule 62: a package installed with a « <4.0.0 » ceiling keeps loading on GuestFlow 4 and 5', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-r62-'));
  try {
    const dirs = {};
    for (const id of ids) {
      dirs[id] = path.join(tmp, id);
      fs.mkdirSync(dirs[id]);
      const floor = shipped[id].guestflow;
      fs.writeFileSync(path.join(dirs[id], 'manifest.json'), JSON.stringify({ ...shipped[id], guestflow: `${floor} <4.0.0` }));
    }
    for (const coreVersion of ['4.0.0', '5.0.0']) {
      const out = loader.loadPackages({
        store: { packageDirFor: (id) => dirs[id] },
        rows: ids.map((id) => ({ id, source: 'registry' })),
        order: ids,
        env: { coreVersion, sdkVersion: SDK_VERSION, hostExports: null },
      });
      assert.deepEqual(out.incompatible, {}, `GuestFlow ${coreVersion}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rule 62: the gate reads the ranges as the loader does, over the bundled manifests', async () => {
  const { coreRangeViolations } = await load();
  for (const coreVersion of ['3.17.0', ...CORES]) {
    for (const sdkVersion of [SDK_VERSION, '2.0.0', '3.0.0']) {
      const gate = coreRangeViolations(shipped, { coreVersion, sdkVersion }).length === 0;
      const loads = ids.every((id) => !rangeRefusal(shipped[id], { coreVersion, sdkVersion }));
      assert.equal(gate, loads, `core ${coreVersion}, SDK ${sdkVersion}`);
    }
  }
});

test('rule 62: the gate refuses a ceiling, a floor above the core and an SDK major', async () => {
  const { coreRangeViolations } = await load();
  const m = (guestflow, sdk = '^2.0.0') => ({ aa: { guestflow, sdk } });
  const env = { coreVersion: '4.0.0', sdkVersion: '2.24.0' };
  assert.deepEqual(coreRangeViolations(m('>=3.18.0'), env), []);
  assert.deepEqual(coreRangeViolations(m('>=3.18.0 <4.0.0'), env), ['aa: "guestflow" >=3.18.0 <4.0.0 is not a floor (">=X.Y.Z")']);
  assert.deepEqual(coreRangeViolations(m('>=4.1.0'), env), ['aa needs GuestFlow >=4.1.0, the core is 4.0.0']);
  assert.deepEqual(coreRangeViolations(m('>=3.18.0'), { ...env, sdkVersion: '3.0.0' }), ['aa: "sdk" ^2.0.0 refuses SDK 3.0.0']);
  assert.deepEqual(coreRangeViolations(m('>=3.18.0', '~2.1.0'), env), ['aa: "sdk" ~2.1.0 is a range this check does not read']);
});

test('rule 62: the script goes red on a simulated core or SDK bump the bundled plugins refuse', () => {
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync('node', ['scripts/check-plugin-versions.mjs', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      return { code: err.status, out: String(err.stderr) };
    }
  };
  for (const v of [`${major + 1}.0.0`, `${major + 2}.0.0`]) assert.equal(run(['--base', 'HEAD', '--core-version', v]).code, 0, v);
  const tooOld = run(['--base', 'HEAD', '--core-version', '3.9.0']);
  assert.equal(tooOld.code, 1);
  assert.match(tooOld.out, /would refuse these bundled plugins at boot/);
});

test('rule 62: the release skill runs the gate against the version it is about to release', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'guestflow-release', 'SKILL.md'), 'utf8');
  assert.match(skill, /node scripts\/check-plugin-versions\.mjs --core-version X\.Y\.Z/);
  const release = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(release, /run: node scripts\/check-plugin-versions\.mjs\n/);
});
