// specs/plugins-phase-4-registry.md rule 53 (audit r4, R4-1 + clock note) — two concurrent uploads of the
// same <id>-<version>.tgz leave the first one's file on disk, and an index date never runs more than an
// hour ahead of the console clock.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { makeContext } = require('./helpers');

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

test('rule 53: an index date more than an hour ahead of the clock falls back to now, with a warning', async () => {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    h.now.set('2026-10-05T08:00:00Z');
    await h.ctx.registry.publish(makePackage(manifest('linen', '1.0.3'), 'A'), 'linen-1.0.3.tgz');
    h.now.set('2026-10-01T09:00:00Z');
    await h.ctx.registry.publish(makePackage(manifest('linen', '1.0.4'), 'B'), 'linen-1.0.4.tgz');
    const next = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'registry', 'index.json'), 'utf8'));
    assert.equal(next.generatedAt, '2026-10-01T09:00:00.000Z');
    assert.ok(warned.some((w) => /generatedAt/.test(w)), 'a warning names the jump');
    h.now.set('2026-10-01T09:00:00Z');
    await h.ctx.registry.publish(makePackage(manifest('linen', '1.0.5'), 'C'), 'linen-1.0.5.tgz');
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'registry', 'index.json'), 'utf8')).generatedAt, '2026-10-01T09:00:00.001Z', 'within the hour the index still moves forward by 1 ms');
  } finally { console.warn = warn; h.cleanup(); }
});
