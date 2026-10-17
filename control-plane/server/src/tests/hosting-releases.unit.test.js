// specs/hosting-h1-fleet-runtime.md rule 8 — a release is installed on the host once: downloaded with
// its SHA256SUMS, verified (a bad hash is refused and leaves nothing behind), unpacked to
// <releases>/<version>, its dependencies installed there; the page « Versions » lists the installed
// releases and how many instances run each.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createReleases } = require('../utils/releases');
const { makeContext, NEW_CUSTOMER } = require('./helpers');

const BASE = 'https://github.com/adn-dev-adrien/guestFlow/releases/download/v9.1.0';

// A real archive of a minimal GuestFlow tree, served by a fake GitHub.
function fakeRelease(version, { badHash = false } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-release-'));
  const root = path.join(work, `guestflow-${version}`);
  fs.mkdirSync(path.join(root, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'client', 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(root, 'server', 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'server', 'src', 'index.js'), '');
  fs.writeFileSync(path.join(root, 'client', 'build', 'index.html'), '<!doctype html>');
  const archive = path.join(work, `guestflow-${version}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', work, `guestflow-${version}`]);
  const bytes = fs.readFileSync(archive);
  const hash = badHash ? '0'.repeat(64) : crypto.createHash('sha256').update(bytes).digest('hex');
  const assets = {
    [`${BASE}/guestflow-${version}.tar.gz`]: bytes,
    [`${BASE}/SHA256SUMS`]: Buffer.from(`${hash}  guestflow-${version}.tar.gz\n`),
  };
  const fetchImpl = async (url) => {
    const body = assets[url];
    if (!body) return { ok: false, status: 404, headers: { get: () => null } };
    return {
      ok: true, status: 200, headers: { get: (h) => (h === 'content-length' ? String(body.length) : null) },
      body: require('stream').Readable.toWeb(require('stream').Readable.from([body])),
      text: async () => body.toString('utf8'),
    };
  };
  const release = { version, archive: { name: `guestflow-${version}.tar.gz`, url: `${BASE}/guestflow-${version}.tar.gz` }, checksums: { url: `${BASE}/SHA256SUMS` } };
  return { release, fetchImpl, cleanup: () => fs.rmSync(work, { recursive: true, force: true }) };
}

test('rule 8 — downloaded, verified against SHA256SUMS, unpacked to releases/<version>, dependencies installed there', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-releases-'));
  const r = fakeRelease('9.1.0');
  const installed = [];
  const phases = [];
  try {
    const releases = createReleases({ dir, fetchImpl: r.fetchImpl, installImpl: async ({ releaseDir }) => installed.push(releaseDir) });
    const out = await releases.install(r.release, { onPhase: (p) => phases.push(p) });
    assert.equal(out, path.join(dir, '9.1.0'));
    assert.deepEqual(phases, ['downloading', 'verifying', 'extracting', 'installing']);
    assert.deepEqual(installed, [path.join(dir, '9.1.0.partial')], 'npm ci runs before the directory is promoted');
    assert.ok(releases.has('9.1.0'));
    assert.deepEqual(releases.list().map((x) => x.version), ['9.1.0']);
    assert.equal(await releases.install(r.release), out, 'installing again is a no-op');
    assert.equal(installed.length, 1);
  } finally {
    r.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 8 — an archive that does not match its hash is refused and leaves nothing behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-releases-'));
  const r = fakeRelease('9.1.0', { badHash: true });
  try {
    const releases = createReleases({ dir, fetchImpl: r.fetchImpl, installImpl: async () => { throw new Error('never reached'); } });
    await assert.rejects(releases.install(r.release), (err) => err.code === 'CHECKSUM_MISMATCH' && err.message === 'L’archive ne correspond pas à son empreinte SHA-256 : version refusée.');
    assert.equal(releases.has('9.1.0'), false);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== '.tmp'), []);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.tmp')), []);
  } finally {
    r.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 8 — « Versions » lists the installed releases with the instances on each, newest first', async () => {
  const h = makeContext({ versions: ['3.8.0', '3.9.0', '3.10.0'] });
  try {
    const { customers, fleet } = h.ctx.controllers;
    await customers.create(NEW_CUSTOMER, 'op');
    await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
    const v = fleet.view();
    assert.deepEqual(v.releases.map((r) => [r.version, r.count]), [['3.10.0', 2], ['3.9.0', 0], ['3.8.0', 0]]);
    assert.deepEqual(v.releases[0].names, ['Gîte des Aulnes', 'Le Moulin']);
    assert.equal(v.defaultTarget, '3.10.0');
    assert.throws(() => fleet.installRelease({ version: '3.11.0' }, 'op'), (e) => e.body.error === 'UNKNOWN');
  } finally {
    h.cleanup();
  }
});
