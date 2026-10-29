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
  test(`rule 52: ${id}, loaded from its built package, answers the fiche block`, async () => {
    const { buildPackage } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'build-plugin-packages.mjs')).href);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-built-'));
    await buildPackage(id, out);
    const dir = path.join(out, id);
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
