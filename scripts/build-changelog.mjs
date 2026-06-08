#!/usr/bin/env node
/**
 * Changelog fragment assembler — see changelog.d/README.md.
 *
 * Unreleased changelog entries live as one file per change under `changelog.d/`
 * (`<category>--<slug>.md`, content = the markdown bullet(s)). This avoids CHANGELOG.md merge
 * conflicts between parallel branches.
 *
 * Usage:
 *   node scripts/build-changelog.mjs                 # print the assembled [Unreleased] block (preview)
 *   node scripts/build-changelog.mjs --release X.Y.Z [YYYY-MM-DD]
 *                                                    # fold fragments + existing [Unreleased] bullets
 *                                                    # into a dated section, reset [Unreleased],
 *                                                    # delete the consumed fragments.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAG_DIR = path.join(ROOT, 'changelog.d');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

// Keep a Changelog sections, in canonical order. `migration` is a GuestFlow addition.
const CATEGORIES = [
  ['added', 'Added'],
  ['changed', 'Changed'],
  ['fixed', 'Fixed'],
  ['removed', 'Removed'],
  ['migration', 'Migration'],
];
const HEADING_BY_KEY = Object.fromEntries(CATEGORIES.map(([k, h]) => [k, h]));
const KEY_BY_HEADING = Object.fromEntries(CATEGORIES.map(([k, h]) => [h.toLowerCase(), k]));

function readFragments() {
  if (!fs.existsSync(FRAG_DIR)) return [];
  return fs.readdirSync(FRAG_DIR)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort()
    .map((f) => {
      const key = f.split('--')[0].toLowerCase();
      if (!HEADING_BY_KEY[key]) {
        throw new Error(`fragment "${f}" has an unknown category prefix "${key}". Use one of: ${Object.keys(HEADING_BY_KEY).join(', ')}`);
      }
      return { file: f, key, body: fs.readFileSync(path.join(FRAG_DIR, f), 'utf8').trim() };
    });
}

// Merge a {key: bullets[]} map from fragments with one parsed from an existing markdown block,
// returning the assembled markdown grouped by canonical category order. Pure.
export function assemble(byKey) {
  const out = [];
  for (const [key, heading] of CATEGORIES) {
    const bullets = (byKey[key] || []).filter((b) => b.trim());
    if (bullets.length === 0) continue;
    out.push(`### ${heading}`);
    out.push(bullets.join('\n'));
    out.push('');
  }
  return out.join('\n').trimEnd();
}

function fragmentsByKey(fragments) {
  const byKey = {};
  for (const fr of fragments) (byKey[fr.key] ||= []).push(fr.body);
  return byKey;
}

// Parse the bullets of an existing `## [Unreleased]` block into {key: bullets[]}. Pure.
export function parseUnreleased(blockText) {
  const byKey = {};
  let current = null;
  for (const line of String(blockText).split('\n')) {
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) { current = KEY_BY_HEADING[h[1].toLowerCase()] || null; continue; }
    if (current && /^\s*-\s+/.test(line)) {
      (byKey[current] ||= []).push(line);
    } else if (current && byKey[current] && byKey[current].length && line.trim()) {
      // continuation line of the previous wrapped bullet
      byKey[current][byKey[current].length - 1] += `\n${line}`;
    }
  }
  return byKey;
}

function mergeByKey(a, b) {
  const out = {};
  for (const [key] of CATEGORIES) {
    const merged = [...(a[key] || []), ...(b[key] || [])];
    if (merged.length) out[key] = merged;
  }
  return out;
}

function previewMode() {
  const block = assemble(fragmentsByKey(readFragments()));
  process.stdout.write(block ? `${block}\n` : 'No pending changelog fragments.\n');
}

function releaseMode(version, dateArg) {
  const date = dateArg || new Date().toISOString().slice(0, 10);
  const fragments = readFragments();
  const text = fs.readFileSync(CHANGELOG, 'utf8');

  const unrelRe = /^## \[Unreleased\]\s*$/m;
  const m = unrelRe.exec(text);
  if (!m) throw new Error('CHANGELOG.md has no "## [Unreleased]" section.');
  const bodyStart = m.index + m[0].length;
  const nextHeader = text.slice(bodyStart).search(/\n## \[/);
  const bodyEnd = nextHeader === -1 ? text.length : bodyStart + nextHeader;
  const unreleasedBody = text.slice(bodyStart, bodyEnd);

  const merged = mergeByKey(parseUnreleased(unreleasedBody), fragmentsByKey(fragments));
  const assembled = assemble(merged);
  if (!assembled) throw new Error('Nothing to release (no fragments and empty [Unreleased]).');

  const versionSection = `## [${version}] - ${date}\n\n${assembled}\n`;
  const newText = `${text.slice(0, m.index)}## [Unreleased]\n\n${versionSection}\n${text.slice(bodyEnd).replace(/^\n+/, '')}`;

  fs.writeFileSync(CHANGELOG, newText);
  for (const fr of fragments) fs.rmSync(path.join(FRAG_DIR, fr.file));
  process.stdout.write(`Released ${version} (${date}): folded ${fragments.length} fragment(s). Review the CHANGELOG.md diff before committing.\n`);
}

function main() {
  const args = process.argv.slice(2);
  const relIdx = args.indexOf('--release');
  if (relIdx === -1) return previewMode();
  const version = args[relIdx + 1];
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
    process.stderr.write('Usage: node scripts/build-changelog.mjs --release X.Y.Z [YYYY-MM-DD]\n');
    process.exit(1);
  }
  return releaseMode(version, args[relIdx + 2]);
}

// Only run the CLI when invoked directly (keeps the pure exports importable for tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
