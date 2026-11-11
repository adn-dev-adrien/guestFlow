// specs/self-update-and-releases.md rule 55 — the update log records every staging step with its result: download,
// signature, SHA-256, extraction, dependencies, promotion (shadow trial of 4.0.0: the log held the header and the
// swap, none of the steps in between). A failure names the step that failed.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { stageRelease, sha256File } = require('../utils/updateStaging');
const { resolvePaths } = require('../utils/deploymentPaths');
const { signSums } = require('../utils/releaseSignature');

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

async function fixture(version = '9.9.9') {
  const work = tmp('gf-log-steps-');
  const root = `guestflow-${version}`;
  const tree = path.join(work, 'src', root);
  fs.mkdirSync(path.join(tree, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(tree, 'client', 'build'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'package.json'), JSON.stringify({ name: 'guestflow', version }));
  fs.writeFileSync(path.join(tree, 'server', 'package.json'), JSON.stringify({ name: 'guestflow-server', version }));
  fs.writeFileSync(path.join(tree, 'server', 'src', 'index.js'), '// server\n');
  fs.writeFileSync(path.join(tree, 'client', 'build', 'index.html'), '<!doctype html>');
  const archive = path.join(work, `${root}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', path.join(work, 'src'), root]);
  return { work, archive, version, sha: await sha256File(archive) };
}

const release = (f) => {
  const base = 'https://github.com/adn-dev-adrien/guestFlow/releases/download';
  return {
    version: f.version,
    archive: { name: `guestflow-${f.version}.tar.gz`, url: `${base}/v${f.version}/guestflow-${f.version}.tar.gz` },
    checksums: { name: 'SHA256SUMS', url: `${base}/v${f.version}/SHA256SUMS` },
    checksumsSignature: { name: 'SHA256SUMS.sig', url: `${base}/v${f.version}/SHA256SUMS.sig` },
  };
};

const serve = (f, { sums, signature }) => async (url) => {
  if (url.endsWith('.tar.gz')) return new Response(fs.readFileSync(f.archive));
  if (url.endsWith('SHA256SUMS.sig')) return new Response(signature);
  if (url.endsWith('SHA256SUMS')) return new Response(sums);
  throw new Error(`unexpected url ${url}`);
};

test('rule 55 — a signed release logs download, signature, SHA-256, extraction, dependencies and promotion', async () => {
  const f = await fixture();
  const deploy = tmp('gf-deploy-');
  const paths = resolvePaths({ DB_PATH: path.join(deploy, 'data', 'guestflow.db') });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const sums = `${f.sha}  guestflow-${f.version}.tar.gz\n`;
  const lines = [];
  await stageRelease({
    release: release(f),
    paths,
    log: (line) => lines.push(line),
    fetchImpl: serve(f, { sums, signature: signSums(sums, privateKey) }),
    installImpl: async () => {},
    releasePublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  });
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^téléchargement : OK, guestflow-9\.9\.9\.tar\.gz, \d+ octets$/);
  assert.equal(lines[1], 'signature : OK, SHA256SUMS signé par la clé configurée');
  assert.equal(lines[2], `SHA-256 : OK, ${f.sha}`);
  assert.equal(lines[3], 'extraction : OK, structure de la version 9.9.9 vérifiée');
  assert.equal(lines[4], 'dépendances (npm ci) : OK');
  assert.equal(lines[5], 'mise en place : OK, releases/9.9.9');
  fs.rmSync(f.work, { recursive: true, force: true });
  fs.rmSync(deploy, { recursive: true, force: true });
});

test('rule 55 — without a signing key the log says the signature was not checked', async () => {
  const f = await fixture();
  const deploy = tmp('gf-deploy-');
  const paths = resolvePaths({ DB_PATH: path.join(deploy, 'data', 'guestflow.db') });
  const lines = [];
  await stageRelease({
    release: release(f),
    paths,
    log: (line) => lines.push(line),
    fetchImpl: serve(f, { sums: `${f.sha}  guestflow-${f.version}.tar.gz\n`, signature: '' }),
    installImpl: async () => {},
    releasePublicKey: null,
  });
  assert.equal(lines[1], 'signature : non vérifiée, aucune clé de signature configurée');
  fs.rmSync(f.work, { recursive: true, force: true });
  fs.rmSync(deploy, { recursive: true, force: true });
});

test('rule 55 — a failure names the step: a wrong SHA-256 logs the download then « SHA-256 : ÉCHEC »', async () => {
  const f = await fixture();
  const deploy = tmp('gf-deploy-');
  const paths = resolvePaths({ DB_PATH: path.join(deploy, 'data', 'guestflow.db') });
  const lines = [];
  await assert.rejects(stageRelease({
    release: release(f),
    paths,
    log: (line) => lines.push(line),
    fetchImpl: serve(f, { sums: `${'0'.repeat(64)}  guestflow-${f.version}.tar.gz\n`, signature: '' }),
    installImpl: async () => { throw new Error('must not run'); },
    releasePublicKey: null,
  }), /CHECKSUM_MISMATCH/);
  assert.match(lines[0], /^téléchargement : OK/);
  assert.equal(lines[lines.length - 1], 'SHA-256 : ÉCHEC');
  assert.ok(!lines.some((l) => l.startsWith('extraction')));
  fs.rmSync(f.work, { recursive: true, force: true });
  fs.rmSync(deploy, { recursive: true, force: true });
});

test('rule 55 — a log that cannot be written never stops the staging', async () => {
  const f = await fixture();
  const deploy = tmp('gf-deploy-');
  const paths = resolvePaths({ DB_PATH: path.join(deploy, 'data', 'guestflow.db') });
  const dir = await stageRelease({
    release: release(f),
    paths,
    log: () => { throw new Error('disk full'); },
    fetchImpl: serve(f, { sums: `${f.sha}  guestflow-${f.version}.tar.gz\n`, signature: '' }),
    installImpl: async () => {},
    releasePublicKey: null,
  });
  assert.equal(fs.existsSync(path.join(dir, 'server', 'src', 'index.js')), true);
  fs.rmSync(f.work, { recursive: true, force: true });
  fs.rmSync(deploy, { recursive: true, force: true });
});

test('rule 55 — the controller wires the log file into the staging and records the backup and the hand-over', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'systemController.js'), 'utf8');
  assert.match(source, /log: \(line\) => appendUpdateLog\(logFile, line\)/);
  assert.match(source, /sauvegarde de la base : OK/);
  assert.match(source, /bascule : lancement de l’assistant de mise à jour/);
});
