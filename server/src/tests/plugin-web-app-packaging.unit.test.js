// specs/plugins-phase-1-sdk.md rule 48 — a plugin's web apps live in its server folder as `apps/<name>/` (their own
// package.json, built by Vite to `dist/`): the package never ships their sources, and each build lands in
// `server/assets/<name>`; a build not made is a warning, not a failure.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { skipWithout } = require('../plugins/sdk/testing');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const script = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'build-plugin-packages.mjs')).href);

/** A repository root with one plugin `demo` holding the given apps (`{ name: { built } }`). */
function fakeRoot(apps) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-webapps-'));
  const plugin = path.join(root, 'server', 'src', 'plugins', 'demo');
  fs.mkdirSync(path.join(plugin, 'apps', 'notes'), { recursive: true }); // no package.json: not an app
  Object.entries(apps).forEach(([name, { built }]) => {
    const dir = path.join(plugin, 'apps', name);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}\n');
    fs.writeFileSync(path.join(dir, 'src', 'main.jsx'), 'export default 1;\n');
    if (built) {
      fs.mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html>');
      fs.writeFileSync(path.join(dir, 'dist', 'assets', 'app.js'), 'console.log(1)');
    }
  });
  return root;
}

test('rule 48: every `apps/<name>` with a package.json is a web app of its plugin, found without a list', async () => {
  const { pluginWebApps } = await script();
  const root = fakeRoot({ studio: { built: true }, guest: { built: false } });
  assert.deepEqual(pluginWebApps('demo', { root }), {
    guest: 'server/src/plugins/demo/apps/guest/dist',
    studio: 'server/src/plugins/demo/apps/studio/dist',
  });
  assert.deepEqual(pluginWebApps('none', { root }), {}, 'a plugin without apps has none');
});

test('rule 48: a build is copied to server/assets/<name>; one not made is a warning and nothing is copied', async () => {
  const { copyExtraAssets } = await script();
  const root = fakeRoot({ studio: { built: true }, guest: { built: false } });
  const serverDir = path.join(root, 'out', 'server');
  const warnings = copyExtraAssets('demo', serverDir, { root });
  assert.ok(fs.existsSync(path.join(serverDir, 'assets', 'studio', 'index.html')));
  assert.ok(fs.existsSync(path.join(serverDir, 'assets', 'studio', 'assets', 'app.js')));
  assert.ok(!fs.existsSync(path.join(serverDir, 'assets', 'guest')));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^demo: server\/src\/plugins\/demo\/apps\/guest\/dist is not built/);
});

test('rule 48: the guest-app package carries no source of its apps', { skip: skipWithout(['guest-app']) }, async () => {
  const { buildServer } = await script();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-built-'));
  assert.deepEqual(buildServer('guest-app', path.join(out, 'server')), []);
  assert.ok(fs.existsSync(path.join(out, 'server', 'index.js')));
  assert.ok(!fs.existsSync(path.join(out, 'server', 'apps')), 'apps/ stays in the repository');
});
