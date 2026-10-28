const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { assertSumsSigned, signSums, releasePublicKeyFromEnv } = require('../utils/releaseSignature');
const { stageRelease, sha256File } = require('../utils/updateStaging');
const { normaliseRelease } = require('../utils/releaseClient');
const { resolvePaths } = require('../utils/deploymentPaths');

// specs/self-update-and-releases.md rule 40: SHA256SUMS.sig, enforced only when a public key is configured.

const pair = crypto.generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const SUMS = 'abc  guestflow-1.0.0.tar.gz\n';
const sigAsset = { name: 'SHA256SUMS.sig', url: 'https://github.com/x/SHA256SUMS.sig' };

test('no public key configured: nothing is checked (rule 40)', async () => {
  assert.equal(await assertSumsSigned({ sums: SUMS, signature: null, publicKey: null, fetchSignature: () => assert.fail('no fetch') }), false);
});

test('a valid signature passes, a missing, forged or garbled one is refused (rule 40)', async () => {
  const good = signSums(SUMS, pair.privateKey);
  assert.equal(await assertSumsSigned({ sums: SUMS, signature: sigAsset, publicKey, fetchSignature: async () => `${good}\n` }), true);
  await assert.rejects(assertSumsSigned({ sums: SUMS, signature: null, publicKey, fetchSignature: async () => good }), /SIGNATURE_MISSING/);
  await assert.rejects(assertSumsSigned({ sums: `${SUMS}tampered`, signature: sigAsset, publicKey, fetchSignature: async () => good }), /SIGNATURE_INVALID/);
  const other = crypto.generateKeyPairSync('ed25519');
  await assert.rejects(assertSumsSigned({ sums: SUMS, signature: sigAsset, publicKey, fetchSignature: async () => signSums(SUMS, other.privateKey) }), /SIGNATURE_INVALID/);
  await assert.rejects(assertSumsSigned({ sums: SUMS, signature: sigAsset, publicKey, fetchSignature: async () => '%%%not base64%%%' }), /SIGNATURE_INVALID/);
  await assert.rejects(assertSumsSigned({ sums: SUMS, signature: sigAsset, publicKey: 'garbage', fetchSignature: async () => good }), /SIGNATURE_KEY_INVALID/);
});

test('the key comes from GUESTFLOW_RELEASE_PUBLIC_KEY (rule 40)', () => {
  assert.equal(releasePublicKeyFromEnv({}), null);
  assert.equal(releasePublicKeyFromEnv({ GUESTFLOW_RELEASE_PUBLIC_KEY: ' k ' }), 'k');
});

test('normaliseRelease carries the SHA256SUMS.sig asset when published (rule 40)', () => {
  const asset = (name) => ({ name, browser_download_url: `https://github.com/adn-dev-adrien/guestFlow/releases/download/v1.0.0/${name}`, size: 1 });
  const base = { tag_name: 'v1.0.0', assets: [asset('guestflow-1.0.0.tar.gz'), asset('SHA256SUMS')] };
  assert.equal(normaliseRelease(base).checksumsSignature, null);
  assert.equal(normaliseRelease({ ...base, assets: [...base.assets, asset('SHA256SUMS.sig')] }).checksumsSignature.name, 'SHA256SUMS.sig');
});

async function stage({ key, sign }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-sig-'));
  const src = path.join(work, 'src', 'guestflow-9.9.9');
  fs.mkdirSync(path.join(src, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(src, 'client', 'build'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  fs.writeFileSync(path.join(src, 'server', 'package.json'), '{}');
  fs.writeFileSync(path.join(src, 'server', 'src', 'index.js'), '');
  fs.writeFileSync(path.join(src, 'client', 'build', 'index.html'), '');
  const archive = path.join(work, 'guestflow-9.9.9.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(work, 'src'), 'guestflow-9.9.9']);
  const sums = `${await sha256File(archive)}  guestflow-9.9.9.tar.gz\n`;
  const base = 'https://github.com/adn-dev-adrien/guestFlow/releases/download/v9.9.9';
  const fetchImpl = async (url) => {
    if (url.endsWith('.tar.gz')) return new Response(fs.readFileSync(archive));
    if (url.endsWith('SHA256SUMS')) return new Response(sums);
    if (url.endsWith('SHA256SUMS.sig')) return new Response(sign ? signSums(sums, pair.privateKey) : 'bogus');
    throw new Error(url);
  };
  const paths = resolvePaths({ DB_PATH: path.join(work, 'data', 'guestflow.db') });
  const release = {
    version: '9.9.9',
    archive: { name: 'guestflow-9.9.9.tar.gz', url: `${base}/guestflow-9.9.9.tar.gz` },
    checksums: { name: 'SHA256SUMS', url: `${base}/SHA256SUMS` },
    checksumsSignature: sign === null ? null : { name: 'SHA256SUMS.sig', url: `${base}/SHA256SUMS.sig` },
  };
  try {
    return await stageRelease({ release, paths, fetchImpl, installImpl: async () => {}, releasePublicKey: key });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

test('stageRelease: unsigned releases still install with no key, and are refused once a key is configured (rule 40)', async () => {
  await stage({ key: null, sign: null });
  await assert.rejects(stage({ key: publicKey, sign: null }), /SIGNATURE_MISSING/);
  await assert.rejects(stage({ key: publicKey, sign: false }), /SIGNATURE_INVALID/);
  await stage({ key: publicKey, sign: true });
});

test('a public key that is not Ed25519 is refused as unusable (rule 40)', async () => {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  await assert.rejects(assertSumsSigned({ sums: SUMS, signature: sigAsset, publicKey: rsa, fetchSignature: async () => 'x' }), /SIGNATURE_KEY_INVALID/);
});

test('the signature is checked over the raw bytes, not over a decoded string (rule 40)', async () => {
  const bytes = Buffer.from([0x61, 0xff, 0xfe, 0x0a]);
  const sig = crypto.sign(null, bytes, pair.privateKey).toString('base64');
  assert.equal(await assertSumsSigned({ sums: bytes, signature: sigAsset, publicKey, fetchSignature: async () => sig }), true);
  assert.equal(await assertSumsSigned({ sums: bytes, signature: sigAsset, publicKey, fetchSignature: async () => sig }), true);
  await assert.rejects(assertSumsSigned({ sums: bytes.toString('utf8'), signature: sigAsset, publicKey, fetchSignature: async () => sig }), /SIGNATURE_INVALID/);
});
