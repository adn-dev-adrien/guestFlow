// specs/self-update-and-releases.md rule 40 (applied by specs/hosting-h1-fleet-runtime.md rule 8): the
// console installs a fleet release only if it is signed by the configured key, once a key is configured.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createReleases } = require('../utils/releases');
const { releaseSignature } = require('../utils/gf');

const BASE = 'https://github.com/adn-dev-adrien/guestFlow/releases/download/v9.2.0';
const pair = crypto.generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

function fakeRelease({ signature }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sig-'));
  const root = path.join(work, 'guestflow-9.2.0');
  fs.mkdirSync(path.join(root, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'client', 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.2.0' }));
  fs.writeFileSync(path.join(root, 'server', 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'server', 'src', 'index.js'), '');
  fs.writeFileSync(path.join(root, 'client', 'build', 'index.html'), '');
  const archive = path.join(work, 'guestflow-9.2.0.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', work, 'guestflow-9.2.0']);
  const bytes = fs.readFileSync(archive);
  const sums = `${crypto.createHash('sha256').update(bytes).digest('hex')}  guestflow-9.2.0.tar.gz\n`;
  const assets = {
    [`${BASE}/guestflow-9.2.0.tar.gz`]: bytes,
    [`${BASE}/SHA256SUMS`]: Buffer.from(sums),
    [`${BASE}/SHA256SUMS.sig`]: Buffer.from(signature === 'good' ? releaseSignature.signSums(sums, pair.privateKey) : 'AAAA'),
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
  const release = {
    version: '9.2.0',
    archive: { name: 'guestflow-9.2.0.tar.gz', url: `${BASE}/guestflow-9.2.0.tar.gz` },
    checksums: { url: `${BASE}/SHA256SUMS` },
    checksumsSignature: signature === 'none' ? null : { name: 'SHA256SUMS.sig', url: `${BASE}/SHA256SUMS.sig` },
  };
  return { release, fetchImpl, cleanup: () => fs.rmSync(work, { recursive: true, force: true }) };
}

async function attempt(signature, key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sig-releases-'));
  const r = fakeRelease({ signature });
  try {
    const releases = createReleases({ dir, fetchImpl: r.fetchImpl, installImpl: async () => {}, releasePublicKey: key });
    await releases.install(r.release);
    return releases.has('9.2.0');
  } finally {
    r.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('rule 40 — with no key configured an unsigned release installs as before', async () => {
  assert.equal(await attempt('none', null), true);
});

test('rule 40 — with a key configured: signed installs, unsigned and forged are refused in French', async () => {
  assert.equal(await attempt('good', publicKey), true);
  await assert.rejects(attempt('none', publicKey), (e) => e.code === 'SIGNATURE_MISSING' && /pas signée/.test(e.message));
  await assert.rejects(attempt('bad', publicKey), (e) => e.code === 'SIGNATURE_INVALID');
});
