// specs/plugins-phase-4-registry.md rule 53 (audit r4, R4-1 + clock note) — two concurrent uploads of the
// same <id>-<version>.tgz leave the first one's file on disk, and an index date never runs more than a
// day ahead of the console clock (the instances' own tolerance).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { makeContext } = require('./helpers');
const { GF_SERVER, registryClient: { FUTURE_TOLERANCE_MS } } = require('../utils/gf');
const { MAX_AHEAD_MS } = require('../utils/registryStore');

function manifest(id, version) {
  return {
    id, name: `Plugin ${id}`, version, description: 'd', icon: 'extension', surfaces: ['Une page'],
    requires: [], guestflow: '>=3.9.0', sdk: '^1.0.0', changelog: { [version]: ['Une ligne.'] },
  };
}

function makePackage(m, filler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-pkg-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(dir, 'server', 'index.js'), `module.exports = { id: '${m.id}', register() {} };//${filler}`);
  fs.mkdirSync(path.join(dir, 'client'));
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), 'export default {};');
  const file = path.join(dir, 'p.tgz');
  execFileSync('tar', ['-czf', file, '-C', dir, 'manifest.json', 'server', 'client'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const bytes = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return bytes;
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('rule 53: two concurrent uploads of one version — the file on disk is the one the index signs', async () => {
  const h = makeContext();
  try {
    const a = makePackage(manifest('linen', '1.0.1'), 'A'.repeat(100));
    const b = makePackage(manifest('linen', '1.0.1'), 'B'.repeat(5000));
    const res = await Promise.allSettled([h.ctx.registry.publish(a, 'linen-1.0.1.tgz'), h.ctx.registry.publish(b, 'linen-1.0.1.tgz')]);
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
    const loser = res.find((r) => r.status === 'rejected');
    assert.equal(loser.reason.code || loser.reason.status, loser.reason.code ? 'DUPLICATE_VERSION' : 409);
    const dir = path.join(h.dataDir, 'registry');
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    assert.equal(sha(path.join(dir, 'linen-1.0.1.tgz')), index.plugins.linen[0].sha256);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tgz')), ['linen-1.0.1.tgz'], 'no temp file left behind');
  } finally { h.cleanup(); }
});

test('rule 53: a failed insert removes only the file this call created', async () => {
  const h = makeContext();
  try {
    const a = makePackage(manifest('linen', '1.0.2'), 'A');
    await h.ctx.registry.publish(a, 'linen-1.0.2.tgz');
    const dir = path.join(h.dataDir, 'registry');
    const before = sha(path.join(dir, 'linen-1.0.2.tgz'));
    await assert.rejects(h.ctx.registry.publish(makePackage(manifest('linen', '1.0.2'), 'B'.repeat(900)), 'linen-1.0.2.tgz'));
    assert.equal(sha(path.join(dir, 'linen-1.0.2.tgz')), before);
  } finally { h.cleanup(); }
});

const spki = (publicKey) => publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const { createRegistryClient } = require(path.join(GF_SERVER, 'src', 'plugins', 'registryClient'));

function instanceReading(h, instanceNow) {
  const dir = path.join(h.dataDir, 'registry');
  const stateFile = path.join(h.dataDir, 'instance-state.json');
  const fetchImpl = async (target) => {
    const body = fs.readFileSync(path.join(dir, target.endsWith('.sig') ? 'index.json.sig' : 'index.json'));
    return { ok: true, status: 200, headers: new Map(), body: null, arrayBuffer: async () => body, text: async () => body.toString('utf8') };
  };
  return createRegistryClient({
    url: 'http://127.0.0.1:1/registry/v1', publicKey: spki(h.publicKey), now: instanceNow, stateFile, log: { warn() {}, error() {} }, fetchImpl,
  });
}

async function publishAt(h, at, version) {
  h.now.set(at);
  await h.ctx.registry.publish(makePackage(manifest('linen', version), version), `linen-${version}.tgz`);
  return JSON.parse(fs.readFileSync(path.join(h.dataDir, 'registry', 'index.json'), 'utf8')).generatedAt;
}

function quiet(fn) {
  return async () => {
    const warn = console.warn;
    console.warn = () => {};
    try { await fn(); } finally { console.warn = warn; }
  };
}

test('rule 53: the console tolerance is the one the instances apply', () => {
  assert.equal(MAX_AHEAD_MS, FUTURE_TOLERANCE_MS);
  assert.equal(FUTURE_TOLERANCE_MS, 24 * 60 * 60 * 1000);
});

test('rule 53: a date more than 24 h ahead of the clock falls back to now, with a warning', async () => {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    await publishAt(h, '2026-10-05T08:00:00Z', '1.0.3');
    assert.equal(await publishAt(h, '2026-10-01T09:00:00Z', '1.0.4'), '2026-10-01T09:00:00.000Z');
    assert.ok(warned.some((w) => /generatedAt/.test(w)), 'a warning names the jump');
    assert.equal(await publishAt(h, '2026-10-01T09:00:00Z', '1.0.5'), '2026-10-01T09:00:00.001Z', 'within the tolerance the index still moves forward by 1 ms');
  } finally { console.warn = warn; h.cleanup(); }
});

test('rule 53: 2 h ahead, then the clock fixed — instances keep reading the index', quiet(async () => {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  try {
    const instanceNow = () => new Date('2026-10-01T08:00:00Z');
    const client = instanceReading(h, instanceNow);
    const ahead = await publishAt(h, '2026-10-01T10:00:00Z', '1.0.1');
    assert.equal((await client.refresh()).state, 'ok');
    const fixed = await publishAt(h, '2026-10-01T08:00:30Z', '1.0.2');
    assert.ok(Date.parse(fixed) > Date.parse(ahead), `${fixed} after ${ahead}`);
    assert.equal((await client.refresh()).state, 'ok');
  } finally { h.cleanup(); }
}));

test('rule 53: a clock stepping back 2 h — instances keep reading the index', quiet(async () => {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  try {
    const client = instanceReading(h, () => new Date('2026-10-01T08:00:00Z'));
    await publishAt(h, '2026-10-01T08:00:00Z', '1.0.1');
    assert.equal((await client.refresh()).state, 'ok');
    await publishAt(h, '2026-10-01T06:00:00Z', '1.0.2');
    assert.equal((await client.refresh()).state, 'ok');
  } finally { h.cleanup(); }
}));

test('rule 53: 30 h ahead, then the clock fixed — the index ends up readable', quiet(async () => {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  try {
    const client = instanceReading(h, () => new Date('2026-10-01T08:00:00Z'));
    await publishAt(h, '2026-10-02T14:00:00Z', '1.0.1');
    assert.equal((await client.refresh()).state, 'invalid');
    await publishAt(h, '2026-10-01T08:00:30Z', '1.0.2');
    assert.equal((await client.refresh()).state, 'ok');
  } finally { h.cleanup(); }
}));
