#!/usr/bin/env node
/**
 * Runs one shard of a package's `npm test` — specs/server-test-isolation.md rule 19 (audit R37-S1).
 *
 *   cd server && node ../scripts/test-runner/run-test-shard.mjs 1/2
 *
 * The command is the package's own `scripts.test`, read from its package.json, with `--test-shard=N/M` set right
 * after `--test` (the runner reads its flags before the file globs only). So a shard runs exactly what `npm test`
 * runs — every flag, preload and reporter — on its share of the FILES; the M shards together run every file once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SHARD = /^([1-9]\d*)\/([1-9]\d*)$/;

const shard = process.argv[2] || '';
const m = SHARD.exec(shard);
if (!m || Number(m[1]) > Number(m[2])) {
  console.error('Usage : node run-test-shard.mjs N/M (1 ≤ N ≤ M), depuis le dossier du paquet.');
  process.exit(2);
}
const script = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).scripts?.test || '';
if (!/^node --test /.test(script)) {
  console.error('Le script « test » du paquet n’est pas `node --test …`.');
  process.exit(2);
}
const command = script.replace(/^node --test /, `node --test --test-shard=${shard} `);
const run = spawnSync(command, { shell: true, stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
