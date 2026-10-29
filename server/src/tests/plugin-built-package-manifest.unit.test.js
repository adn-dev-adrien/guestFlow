// specs/plugins-phase-4-registry.md rule 52 (audit r3, N-0) — a plugin never reads its own manifest with a
// relative `require`: in a built package the code sits under `server/` and `manifest.json` at the root. The
// two mail intakes are built, loaded from the extracted package layout, and asked for their fiche block.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const Database = require('better-sqlite3');
const { pathToFileURL } = require('url');
const { skipWithout } = require('../plugins/sdk/testing');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC_PLUGINS = path.join(ROOT, 'server', 'src', 'plugins');

test('rule 52: no server file of a plugin requires a manifest.json', () => {
  const offenders = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'node_modules') walk(full); return; }
    if (/\.js$/.test(e.name) && /require\(\s*['"][^'"]*manifest\.json['"]\s*\)/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(SRC_PLUGINS, full));
  });
  fs.readdirSync(SRC_PLUGINS, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'sdk').forEach((e) => walk(path.join(SRC_PLUGINS, e.name)));
  assert.deepEqual(offenders, []);
});

for (const id of ['gites-de-france-intake', 'airbnb-intake']) {
  test(`plugins-phase-1-sdk.md rule 31 and phase-4 rule 52: ${id}, loaded from its built package, answers the fiche block`, { skip: skipWithout([id]) }, async () => {
    // The server half of the package only: the client half needs vite, which the server CI job does not install.
    const { buildServer } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'build-plugin-packages.mjs')).href);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-built-'));
    const dir = path.join(out, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(SRC_PLUGINS, id, 'manifest.json'), path.join(dir, 'manifest.json'));
    assert.deepEqual(buildServer(id, path.join(dir, 'server')), []);
    assert.ok(fs.existsSync(path.join(dir, 'manifest.json')) && !fs.existsSync(path.join(dir, 'server', 'manifest.json')));
    const { requirePackage } = require('../plugins/loader');
    const registry = require('../plugins/sdk/registry');
    const { createContext } = require('../plugins/sdk/createContext');
    const { applyPluginSchema } = require('../plugins/sdk/testing');
    const db = new Database(':memory:');
    applyPluginSchema(db, id);
    const mod = requirePackage(id, dir);
    const settings = { get: () => '', set() {}, raw: () => '' };
    mod.register(createContext(id, { db, settingsModel: () => settings }));
    const mount = registry.get(id).mounts.find((m) => !m.public);
    const app = express();
    app.use(mount.path, mount.router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${mount.path}/reservation/1`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { intake: null });
    } finally {
      server.close();
      registry.discard(id);
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
}

test('plugins-phase-1-sdk.md rule 32 (manifestVersion) and phase-4 rule 52: manifestVersion is cached per folder, and names the folder when there is no manifest', () => {
  const sdk = require('../plugins/sdk');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-mv-'));
  assert.throws(() => sdk.manifestVersion(path.join(dir, 'server')), /no manifest\.json in .*server/);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '1.2.3' }));
  fs.mkdirSync(path.join(dir, 'server'));
  assert.equal(sdk.manifestVersion(path.join(dir, 'server')), '1.2.3');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '9.9.9' }));
  assert.equal(sdk.manifestVersion(path.join(dir, 'server')), '1.2.3', 'cached');
  fs.rmSync(dir, { recursive: true, force: true });
});
