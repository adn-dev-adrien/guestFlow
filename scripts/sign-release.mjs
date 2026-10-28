#!/usr/bin/env node
/**
 * Release signing (specs/self-update-and-releases.md rule 51). Run by the maintainer, off GitHub.
 *
 *   node scripts/sign-release.mjs keygen <private-key-file>       writes the private key (PEM, mode 0600), prints the public key
 *   node scripts/sign-release.mjs sign <private-key-file> vX.Y.Z  downloads SHA256SUMS, signs it, uploads SHA256SUMS.sig
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
    execFileSync('gh', ['release', 'download', tag, '--pattern', 'SHA256SUMS', '--dir', dir], { stdio: 'inherit' });
    const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'));
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
