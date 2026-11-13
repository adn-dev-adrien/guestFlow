#!/usr/bin/env node
// specs/pricing-components.md §3 rule 73 — the per-commit proof that code MOVED and did not change:
//
//   node scripts/price-gate/move-proof.mjs [base]        base defaults to HEAD~1; the diff is base..HEAD
//
// Every line a source file loses (pricing.js and any other server/client source file) must reappear byte for byte,
// but for its indentation, among the lines the diff adds (the same file first, then any other). Blank lines, imports and
// export lists are allowed glue. Prints the unmatched removed lines (file:line) and exits 1 when there are any, then, for
// information only (the exit code does not change), the added non-glue lines no removed line accounts for.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { moveProof } = require('./moveProof.js');

const base = process.argv[2] || 'HEAD~1';
const diff = execFileSync('git', ['diff', '-U0', '--no-color', '--no-renames', `${base}..HEAD`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const result = moveProof(diff);

console.log(`move proof ${base}..HEAD: ${result.removed} removed source line(s), ${result.matched} moved verbatim, ${result.glue} glue, ${result.unmatched.length} unmatched`);
for (const { file, line, text } of result.unmatched) console.log(`  UNMATCHED ${file}:${line}  ${text.trim().slice(0, 140)}`);
console.log(`ADDED non-glue source lines with no removed twin: ${result.addedUnmatched.length}`);
for (const { file, text } of result.addedUnmatched) console.log(`  ADDED ${file}  ${text.trim().slice(0, 140)}`);
process.exit(result.unmatched.length ? 1 : 0);
