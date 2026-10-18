// specs/hosting-h1-fleet-runtime.md rule 11 — a plugin version from the console's registry is pushed,
// per plugin, to the instances that have it, one at a time: the instance's own script switches the
// package while it is stopped and snapshotted, the health check asks that the plugin loaded at that
// version, and a failure puts the snapshot's database back and `current` with it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { createPluginInstaller, defaultRunScript } = require('../utils/pluginInstaller');
const { waitHealthy } = require('../utils/health');

function fakeRegistry(rows) {
  return { list: () => rows, packageFile: (name) => `/srv/registry/packages/${name}` };
}
const releases = { has: (v) => v === '3.10.1', dirOf: (v) => `/srv/releases/${v}` };

test('rule 11 — the installer runs the instance’s own script, of its release, on the registry’s file and hash', async () => {
  const runs = [];
  const installer = createPluginInstaller({
    registry: fakeRegistry([
      { id: 'linen', version: '1.0.1', sha256: 'a'.repeat(64), withdrawnAt: null },
      { id: 'linen', version: '1.0.10', sha256: 'b'.repeat(64), withdrawnAt: null },
      { id: 'linen', version: '1.0.2', sha256: 'c'.repeat(64), withdrawnAt: '2026-10-17T10:00:00Z' },
      { id: 'sas', version: '1.0.0', sha256: 'd'.repeat(64), withdrawnAt: null },
    ]),
    releases,
    runScript: async (r) => { runs.push(r); return { switched: true }; },
  });
  assert.deepEqual(installer.published('linen'), ['1.0.10', '1.0.1'], 'newest first, a withdrawn version never offered');
  const inst = { slug: 'aulnes', version: '3.10.1', dbPath: '/srv/i/aulnes/data/guestflow.db' };
  await installer.install(inst, 'linen', '1.0.10');
  assert.deepEqual(runs[0], {
    script: '/srv/releases/3.10.1/server/scripts/switch-plugin-package.js',
    args: ['--id', 'linen', '--version', '1.0.10', '--file', '/srv/registry/packages/linen-1.0.10.tgz', '--sha256', 'b'.repeat(64)],
    dbPath: inst.dbPath,
  });
  await installer.rollback(inst, 'linen');
  assert.deepEqual(runs[1].args, ['--sync', '--id', 'linen']);
  await assert.rejects(installer.install(inst, 'linen', '1.0.2'), /n’est pas publié dans le registre/);
  await assert.rejects(installer.install({ ...inst, version: '3.9.0' }, 'linen', '1.0.10'), /Version 3\.9\.0 absente de l’hôte/);
});

test('rule 11 — the script’s last JSON line is its answer; its last stderr line is its error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-switch-'));
  try {
    const ok = path.join(dir, 'scripts', 'ok.js');
    const ko = path.join(dir, 'scripts', 'ko.js');
    fs.mkdirSync(path.dirname(ok));
    fs.writeFileSync(ok, "console.log('noise'); console.log(JSON.stringify({ switched: true, db: process.env.DB_PATH, args: process.argv.slice(2) }));");
    fs.writeFileSync(ko, "console.error('détail'); console.error('Paquet refusé : sha256'); process.exit(5);");
    assert.deepEqual(await defaultRunScript({ script: ok, args: ['--id', 'linen'], dbPath: '/x.db' }), { switched: true, db: '/x.db', args: ['--id', 'linen'] });
    await assert.rejects(defaultRunScript({ script: ko, args: [], dbPath: '/x.db' }), /^Error: Paquet refusé : sha256$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rules 11, 31 — the health check waits for the plugin at the pushed version and says why it failed', async () => {
  const answer = (plugin) => async (url) => {
    assert.match(url, /\?plugin=linen$/);
    return { ok: true, status: 200, json: async () => ({ version: '3.10.1', plugin }) };
  };
  const base = { url: 'http://x/api/version', expectVersion: '3.10.1', expectPlugin: { id: 'linen', version: '1.0.2' }, timeoutMs: 60, intervalMs: 10 };
  assert.equal((await waitHealthy({ ...base, fetchImpl: answer({ id: 'linen', version: '1.0.2', ok: true }) })).ok, true);
  // The pushed version failed to load: said at once, without waiting out the delay.
  const t0 = Date.now();
  assert.equal((await waitHealthy({ ...base, timeoutMs: 5000, fetchImpl: answer({ id: 'linen', version: '1.0.2', ok: false }) })).error, 'plugin linen 1.0.2 : chargement en échec');
  assert.ok(Date.now() - t0 < 1000, 'no wait');
  assert.equal((await waitHealthy({ ...base, fetchImpl: answer({ id: 'linen', version: '1.0.1', ok: true }) })).error, 'plugin linen chargé en 1.0.1 au lieu de 1.0.2');
  assert.equal((await waitHealthy({ ...base, fetchImpl: answer({ id: 'linen', version: null, ok: false }) })).error, 'plugin linen non chargé au lieu de 1.0.2');
});

test('rules 11, 31 — a pushed version that does not load is rolled back on that instance and the push stops', async () => {
  let h;
  const calls = [];
  const installer = {
    async install(inst, id, version) { calls.push(['install', inst.slug, version]); h.host.loaded.set(inst.slug, { [id]: version }); },
    async rollback(inst, id) { calls.push(['rollback', inst.slug]); h.host.loaded.set(inst.slug, { [id]: '1.0.1' }); },
    published: () => ['1.0.2', '1.0.1'],
  };
  h = makeContext({ pluginInstaller: installer, hostingEnv: { CP_HEALTH_TIMEOUT_MS: '100' } });
  try {
    const { customers, fleet } = h.ctx.controllers;
    makeInstance(h.root, 'aulnes', { installed: ['linen'] });
    makeInstance(h.root, 'moulin', { installed: ['linen'] });
    const a = await customers.create(NEW_CUSTOMER, 'op');
    await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
    const plugin = fleet.view().pluginPush.plugins[0];
    assert.deepEqual([plugin.id, plugin.name, plugin.count, plugin.versions.map((v) => v.version), plugin.defaultVersion], ['linen', 'Linge et blanchisserie', 2, ['1.0.2', '1.0.1'], '1.0.2']);
    h.host.brokenPlugins.add('linen@1.0.2');
    fleet.pushPlugin({ pluginId: 'linen', version: '1.0.2' }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    const [u] = fleet.view().history;
    assert.equal(u.state, 'failed');
    assert.deepEqual(u.items.map((i) => i.state), ['rolled_back', 'skipped']);
    assert.match(u.items[0].detail, /^plugin linen 1\.0\.2 : chargement en échec ; retour en linen précédent, base de l’instantané remise\.$/);
    assert.deepEqual(calls, [['install', 'aulnes', '1.0.2'], ['rollback', 'aulnes']]);
    assert.ok(customers.view(a.id).history.some((x) => x.text.startsWith('Plugin linen : mise à jour vers 1.0.2 annulée')));
    assert.throws(() => fleet.pushPlugin({ pluginId: 'linen', version: '9.9.9' }, 'op'), (e) => e.status === 400 && e.body.error === 'NOT_PUBLISHED');
    // The version that just rolled back is « En échec » and no longer the default (as m1 for releases).
    const after = fleet.view().pluginPush.plugins[0];
    assert.deepEqual(after.versions, [
      { version: '1.0.2', failed: true, label: '1.0.2 — en échec' },
      { version: '1.0.1', failed: false, label: '1.0.1' },
    ]);
    assert.equal(after.defaultVersion, '1.0.1');
  } finally {
    h.cleanup();
  }
});

test('rules 11, 30 — never a downgrade: only newer versions are offered and pushed, an older one is refused', async () => {
  const calls = [];
  const installer = {
    async install(inst, id, version) { calls.push(['install', inst.slug, version]); h.host.loaded.set(inst.slug, { [id]: version }); },
    async rollback() {},
    published: () => ['1.0.3', '1.0.2', '1.0.1', '1.0.0'],
  };
  const h = makeContext({ pluginInstaller: installer, hostingEnv: { CP_HEALTH_TIMEOUT_MS: '100' } });
  try {
    const { customers, fleet } = h.ctx.controllers;
    makeInstance(h.root, 'aulnes', { installed: ['linen'], versions: { linen: '1.0.1' } });
    makeInstance(h.root, 'moulin', { installed: ['linen'], versions: { linen: '1.0.2' } });
    await customers.create(NEW_CUSTOMER, 'op');
    await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
    const plugin = fleet.view().pluginPush.plugins[0];
    assert.deepEqual(plugin.versions.map((v) => v.version), ['1.0.3', '1.0.2'], 'newer than the oldest running only');
    assert.equal(plugin.defaultVersion, '1.0.3');
    assert.throws(() => fleet.pushPlugin({ pluginId: 'linen', version: '1.0.0' }, 'op'), (e) => e.status === 400 && e.body.error === 'NOT_NEWER');
    assert.throws(() => fleet.pushPlugin({ pluginId: 'linen', version: '1.0.1' }, 'op'), (e) => e.status === 400 && e.body.error === 'NOT_NEWER');
    fleet.pushPlugin({ pluginId: 'linen', version: '1.0.2' }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    assert.deepEqual(calls, [['install', 'aulnes', '1.0.2']], 'moulin already runs 1.0.2: left alone');
    // The health check asked for the plugin with the instance's own proxy secret.
    const { readEnv } = require('../utils/instanceEnv');
    const secret = readEnv(h.ctx.instances.envFileOf('aulnes')).GUESTFLOW_PROXY_SECRET;
    assert.ok(secret);
    assert.deepEqual(h.host.healthHeaders, [['aulnes', secret]]);
    assert.deepEqual(fleet.view().history[0].items.map((i) => i.customerId), [1]);
  } finally {
    h.cleanup();
  }
});

test('rule 11 — wired by default: the console’s registry gives the versions offered', async () => {
  const h = makeContext();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-pkg-'));
    const m = { id: 'linen', name: 'Linge', version: '1.0.2', description: 'd', icon: 'extension', surfaces: ['Une page'], requires: [], guestflow: '>=3.9.0', sdk: '^1.0.0', changelog: { '1.0.2': ['Une ligne.'] } };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
    fs.mkdirSync(path.join(dir, 'server'));
    fs.mkdirSync(path.join(dir, 'client'));
    fs.writeFileSync(path.join(dir, 'server', 'index.js'), "module.exports = { id: 'linen', register() {} };");
    fs.writeFileSync(path.join(dir, 'client', 'index.js'), 'export default {};');
    execFileSync('tar', ['-czf', path.join(dir, 'p.tgz'), '-C', dir, 'manifest.json', 'server', 'client'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const buf = fs.readFileSync(path.join(dir, 'p.tgz'));
    await h.ctx.registry.publish(buf, 'linen-1.0.2.tgz');
    makeInstance(h.root, 'aulnes', { installed: ['linen'] });
    await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const { pluginPush } = h.ctx.controllers.fleet.view();
    assert.equal(pluginPush.available, true);
    assert.deepEqual(pluginPush.plugins.map((p) => [p.id, p.versions.map((v) => v.version)]), [['linen', ['1.0.2']]]);
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), h.ctx.registry.list()[0].sha256);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    h.cleanup();
  }
});
