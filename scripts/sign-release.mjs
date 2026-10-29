#!/usr/bin/env node
/**
 * Release signing (specs/self-update-and-releases.md rule 41). Run by the maintainer, off GitHub.
 *
 *   node scripts/sign-release.mjs keygen <private-key-file>       writes the private key (PEM, mode 0600), prints the public key
 *   node scripts/sign-release.mjs sign <private-key-file> vX.Y.Z  downloads SHA256SUMS, signs it, uploads SHA256SUMS.sig
 *
 * `sign` never signs blindly: it downloads the release archive too, hashes it locally and refuses to sign
 * unless the published SHA256SUMS lists exactly that hash, then prints the sums so they can be compared by
 * eye with the CI log of the release. (If the GitHub account were taken over, a forged archive and forged
 * sums would still agree with each other: the printed sums and the CI log are the human check.)
 *
 * The printed public key is what installs put in GUESTFLOW_RELEASE_PUBLIC_KEY.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [command, keyFile, tag] = process.argv.slice(2);

if (command === 'keygen' && keyFile) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  console.log(publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
} else if (command === 'sign' && keyFile && /^v\d+\.\d+\.\d+$/.test(tag || '')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-sign-'));
  try {
    execFileSync('gh', ['release', 'download', tag, '--pattern', 'SHA256SUMS', '--pattern', 'guestflow-*.tar.gz', '--dir', dir], { stdio: 'inherit' });
    const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'));
    const archive = fs.readdirSync(dir).find((f) => /^guestflow-\d+\.\d+\.\d+\.tar\.gz$/.test(f));
    if (!archive) throw new Error('the release has no guestflow-X.Y.Z.tar.gz asset');
    const local = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, archive))).digest('hex');
    const listed = sums.toString('utf8').split('\n').map((l) => l.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)).filter(Boolean).find((m) => m[2] === archive);
    console.log(sums.toString('utf8'));
    if (!listed || listed[1].toLowerCase() !== local) {
      throw new Error(`SHA256SUMS does not list the hash of the downloaded ${archive} (${local}): not signing`);
    }
    const signature = crypto.sign(null, sums, crypto.createPrivateKey(fs.readFileSync(keyFile))).toString('base64');
    const sigFile = path.join(dir, 'SHA256SUMS.sig');
    fs.writeFileSync(sigFile, `${signature}\n`);
    execFileSync('gh', ['release', 'upload', tag, sigFile, '--clobber'], { stdio: 'inherit' });
    console.log(`SHA256SUMS.sig uploaded to ${tag}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.error('usage: sign-release.mjs keygen <key-file> | sign <key-file> vX.Y.Z');
  process.exit(2);
}
