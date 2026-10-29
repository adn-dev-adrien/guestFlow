#!/usr/bin/env node
/**
 * Refuses a release staging tree that carries a secret or a runtime file
 * (specs/self-update-and-releases.md rule 40). `release.sh` runs it on the tree it is about to
 * archive: whatever sits in a developer's checkout (`server/.env.local`, a database and its WAL,
 * `licence.jws`, a TLS key, uploaded photos) must never reach a published archive.
 *
 * Usage: node scripts/check-release-tree.mjs <staging-dir>     (exit 1 and the list on a hit)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_NAME = [
  /^\.env(\..+)?$/i,
  /\.(db|sqlite3?)(-wal|-shm|-journal)?$/i,
  /^licence\.jws$/i,
  /\.(key|pem|p12|pfx)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^update-state\.json$/i,
  /\.log$/i,
];
const ALLOWED_NAME = [/^\.env\.example$/i];
const KEEP_FILES = new Set(['.gitkeep', 'README.md']);

/** Paths (relative to `root`) a release must not contain. */
export function findForbiddenFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      const inUploads = /(^|\/)uploads\//.test(rel);
      if (inUploads && !KEEP_FILES.has(entry.name)) { found.push(rel); continue; }
      if (ALLOWED_NAME.some((re) => re.test(entry.name))) continue;
      if (SECRET_NAME.some((re) => re.test(entry.name))) found.push(rel);
    }
  };
  walk(root);
  return found.sort();
}

function main() {
  const root = process.argv[2];
  if (!root || !fs.existsSync(root)) {
    console.error('usage: check-release-tree.mjs <staging-dir>');
    process.exit(2);
  }
  const found = findForbiddenFiles(root);
  if (found.length) {
    console.error('✗ the release tree carries files that must never be shipped:');
    for (const f of found) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('✓ release tree: no secret or runtime file');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
