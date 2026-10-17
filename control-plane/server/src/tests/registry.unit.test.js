// specs/plugins-phase-4-registry.md rules 6–8 — the plugin registry the console serves: upload
// validation, refusal of a duplicate, the signed index the instance verifies, withdrawal, and the
// public routes over HTTP.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const session = require('express-session');
const { passwordHash, GF_SERVER } = require('../utils/gf');
const { createApp } = require('../app');
const { makeContext } = require('./helpers');

const { createRegistryClient } = require(path.join(GF_SERVER, 'src', 'plugins', 'registryClient'));

function manifest(id, version, extra = {}) {
  return {
    id, name: `Plugin ${id}`, version, description: 'd', icon: 'extension', surfaces: ['Une page'],
    requires: [], guestflow: '>=3.9.0', sdk: '^1.0.0', changelog: { [version]: ['Une ligne.'] }, ...extra,
  };
}

function makePackage(m, { omitClient = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-pkg-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(dir, 'server', 'index.js'), `module.exports = { id: '${m.id}', register() {} };`);
  const members = ['manifest.json', 'server'];
  if (!omitClient) {
    fs.mkdirSync(path.join(dir, 'client'));
    fs.writeFileSync(path.join(dir, 'client', 'index.js'), 'export default {};');
    members.push('client');
  }
  const file = path.join(dir, 'p.tgz');
  execFileSync('tar', ['-czf', file, '-C', dir, ...members], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  return fs.readFileSync(file);
}

const spki = (publicKey) => publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

test('rule 8: an uploaded package is validated, stored and published in the signed index', async () => {
  const h = makeContext();
  try {
    const buf = makePackage(manifest('linen', '1.0.1'));
    const row = await h.ctx.registry.publish(buf, 'linen-1.0.1.tgz');
    assert.equal(row.sha256, crypto.createHash('sha256').update(buf).digest('hex'));
    assert.equal(row.size, buf.length);
    assert.ok(fs.existsSync(path.join(h.dataDir, 'registry', 'linen-1.0.1.tgz')));
    const index = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'registry', 'index.json'), 'utf8'));
    assert.deepEqual(index.plugins.linen.map((v) => v.version), ['1.0.1']);
  } finally {
    h.cleanup();
  }
});

test('rule 8: a duplicate version, a bad file name, a bad layout or a bad manifest is refused', async () => {
  const h = makeContext();
  try {
    await h.ctx.registry.publish(makePackage(manifest('linen', '1.0.1')), 'linen-1.0.1.tgz');
    await assert.rejects(h.ctx.registry.publish(makePackage(manifest('linen', '1.0.1')), 'linen-1.0.1.tgz'), (e) => e.body.error === 'DUPLICATE_VERSION');
    await assert.rejects(h.ctx.registry.publish(makePackage(manifest('linen', '1.0.2')), 'linen.tgz'), (e) => e.body.error === 'BAD_FILE_NAME');
    await assert.rejects(h.ctx.registry.publish(makePackage(manifest('linen', '1.0.2'), { omitClient: true }), 'linen-1.0.2.tgz'),
      (e) => e.body.error === 'INVALID_PACKAGE' && /client\/index\.js/.test(e.body.message));
    await assert.rejects(h.ctx.registry.publish(makePackage(manifest('linen', '1.0.3', { sdk: 'n/a' })), 'linen-1.0.3.tgz'),
      (e) => e.body.error === 'INVALID_PACKAGE' && /SDK/.test(e.body.message));
    await assert.rejects(h.ctx.registry.publish(makePackage(manifest('linen', '1.0.4')), 'linen-1.0.5.tgz'), (e) => e.body.error === 'INVALID_PACKAGE');
  } finally {
    h.cleanup();
  }
});

test('rule 6: the index is signed with the licence key, and an instance verifies it with the public key', async () => {
  const h = makeContext();
  const s = await serve(h);
  try {
    await h.ctx.registry.publish(makePackage(manifest('neat', '1.2.0')), 'neat-1.2.0.tgz');
    const client = createRegistryClient({ url: `http://127.0.0.1:${s.port}/registry/v1`, publicKey: spki(h.publicKey), log: { warn() {}, error() {} } });
    assert.equal((await client.refresh()).state, 'ok');
    assert.deepEqual(client.versions('neat').map((v) => v.version), ['1.2.0']);
    const stranger = createRegistryClient({ url: `http://127.0.0.1:${s.port}/registry/v1`, publicKey: spki(crypto.generateKeyPairSync('ed25519').publicKey), log: { warn() {}, error() {} } });
    assert.equal((await stranger.refresh()).state, 'invalid');
  } finally {
    await s.close();
    h.cleanup();
  }
});

test('rule 8: a withdrawn version leaves the index; its file stays for the instances that run it', async () => {
  const h = makeContext();
  try {
    await h.ctx.registry.publish(makePackage(manifest('neat', '1.2.0')), 'neat-1.2.0.tgz');
    const row = h.ctx.registry.withdraw('neat', '1.2.0');
    assert.ok(row.withdrawnAt);
    const index = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'registry', 'index.json'), 'utf8'));
    assert.equal(index.plugins.neat, undefined);
    assert.ok(h.ctx.registry.packageFile('neat-1.2.0.tgz'));
    assert.throws(() => h.ctx.registry.withdraw('neat', '1.2.0'), (e) => e.body.error === 'NOT_PUBLISHED');
  } finally {
    h.cleanup();
  }
});

async function serve(h) {
  h.ctx.models.operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: passwordHash.hashPassword('correct horse battery') });
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore() });
  const server = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

test('rule 7: the registry answers without authentication; uploading needs an operator', async () => {
  const h = makeContext();
  const s = await serve(h);
  const base = `http://127.0.0.1:${s.port}`;
  try {
    const buf = makePackage(manifest('linen', '1.0.1'));
    const anonymous = await fetch(`${base}/api/registry/packages`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'linen-1.0.1.tgz' }, body: buf });
    assert.equal(anonymous.status, 401);
    await h.ctx.registry.publish(buf, 'linen-1.0.1.tgz');
    assert.equal((await fetch(`${base}/registry/v1/index.json`)).status, 200);
    assert.equal((await fetch(`${base}/registry/v1/index.json.sig`)).status, 200);
    const pkg = await fetch(`${base}/registry/v1/packages/linen-1.0.1.tgz`);
    assert.equal(pkg.status, 200);
    assert.equal(Buffer.from(await pkg.arrayBuffer()).length, buf.length);
    assert.equal((await fetch(`${base}/registry/v1/packages/..%2Fcontrol-plane.db`)).status, 404);
  } finally {
    await s.close();
    h.cleanup();
  }
});
