#!/usr/bin/env node
// specs/vat-optional-mode.md §7 « Prod-copy proof » — hashes what every VAT reader feeds, for every
// reservation, devis and month of a COPY of a real database, so a lot can be proved to change nothing.
//
//   node scripts/vat-regime-golden-prod.mjs <copy.db> --out before.json
//   node scripts/vat-regime-golden-prod.mjs <copy.db> --compare before.json
//
// Prints ids, months and hashes only — never a name. The database is opened by the application's own
// boot, which migrates it: pass a copy, never the original.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dbPath = args[0] && !args[0].startsWith('--') ? args[0] : null;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('usage: vat-regime-golden-prod.mjs <copy.db> [--out file] [--compare file]');
  process.exit(2);
}

process.env.DB_PATH = path.resolve(dbPath);
process.env.TZ = 'Europe/Paris';
const { freezeClock } = require(path.join(root, 'server/src/tests/vatRegimeGoldenFixture.js'));
freezeClock(new Date('2026-10-28T12:00:00+01:00'));

const silent = console.log;
console.log = () => {};
const db = require(path.join(root, 'server/src/database.js'));
const { capture, sha } = require(path.join(root, 'server/src/tests/vatRegimeGoldenCapture.js'));
const captured = await capture(db, { years: [2025, 2026, 2027] });
console.log = silent;

const hashes = Object.fromEntries(Object.entries(captured).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sha(v)]));
const out = flag('--out');
if (out) fs.writeFileSync(out, `${JSON.stringify(hashes, null, 1)}\n`);

const against = flag('--compare');
if (!against) {
  const families = {};
  for (const k of Object.keys(hashes)) families[k.split('/')[0]] = (families[k.split('/')[0]] || 0) + 1;
  console.log(`captured ${Object.keys(hashes).length} artefacts`, JSON.stringify(families));
  console.log(`errors: ${Object.entries(captured).filter(([, v]) => v.startsWith('ERROR')).map(([k]) => k).join(', ') || 'none'}`);
  process.exit(0);
}

const before = JSON.parse(fs.readFileSync(against, 'utf8'));
const keys = new Set([...Object.keys(before), ...Object.keys(hashes)]);
const diffs = [...keys].filter((k) => before[k] !== hashes[k]);
console.log(`compared ${keys.size} artefacts: ${diffs.length} difference(s)`);
for (const k of diffs) console.log(`  DIFF ${k}`);
process.exit(diffs.length ? 1 : 0);
