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
 *                                                    # delete the consumed fragments, and scaffold
 *                                                    # the operator digest as a TODO to be written.
 *   node scripts/build-changelog.mjs --check-digest X.Y.Z
 *                                                    # exit non-zero unless that section carries a
 *                                                    # written `### Summary` block (the release
 *                                                    # workflow's verify job runs this).
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

// The operator digest (specs/self-update-and-releases.md §6.2 rule 20c) — the few lines the update
// dialog shows before « Installer », with every section below it folded away. It is deliberately NOT
// a fragment category: it is written once, at release time, looking at the whole set of changes.
// That is the only moment anyone can say what a release means, rather than what each commit did.
const DIGEST_HEADING = 'Summary';
const DIGEST_PLACEHOLDER = '- TODO — write the operator digest: 1 to 6 short lines, each saying what changes for the operator. Delete this line.';
const DIGEST_MAX_BULLETS = 6;
const DIGEST_MAX_CHARS = 160;

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

/** The body of `## [version]` in a CHANGELOG text, or null when there is no such section. Pure. */
export function sectionFor(text, version) {
  const escaped = String(version).replace(/[.]/g, '\\.');
  const re = new RegExp(`^## \\[${escaped}\\](?: - \\S+)?[ \\t]*$`, 'm');
  const body = String(text);
  const m = re.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  const next = body.slice(start).search(/\n## \[/);
  return next === -1 ? body.slice(start) : body.slice(start, start + next);
}

/**
 * Judge a section's operator digest → `{ ok, errors[], bullets[] }`. Pure, so the release workflow
 * and a unit test apply exactly the same rule (specs/self-update-and-releases.md §6.2 rule 20c).
 *
 * The limits are the point, not bureaucracy: a digest allowed to run long would just become the
 * changelog again, which is how the update dialog got unreadable in the first place. Anything that
 * does not fit belongs in the sections below it — they are still published, only folded.
 */
export function checkDigest(sectionBody) {
  const errors = [];
  const lines = String(sectionBody || '').split('\n');
  const start = lines.findIndex((l) => /^###[ \t]+Summary[ \t]*$/i.test(l.trim()));
  if (start === -1) {
    return {
      ok: false,
      bullets: [],
      errors: [`no "### ${DIGEST_HEADING}" block — the update dialog would have nothing to show.`],
    };
  }

  const bullets = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^###[ \t]+/.test(line)) break;
    if (!line) continue;
    if (line.startsWith('- ')) bullets.push(line.slice(2).trim());
    else if (bullets.length) bullets[bullets.length - 1] += ` ${line}`;
  }

  if (bullets.length === 0) errors.push('the digest block is empty.');
  if (bullets.length > DIGEST_MAX_BULLETS) {
    errors.push(`the digest has ${bullets.length} lines, at most ${DIGEST_MAX_BULLETS} are allowed.`);
  }
  for (const bullet of bullets) {
    if (/^TODO\b/i.test(bullet)) errors.push('the scaffolded TODO line is still there.');
    else if (bullet.length > DIGEST_MAX_CHARS) {
      errors.push(`"${bullet.slice(0, 50)}…" is ${bullet.length} characters, at most ${DIGEST_MAX_CHARS} are allowed.`);
    }
  }
  return { ok: errors.length === 0, errors, bullets };
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

  // The digest is scaffolded, never guessed: only a human — or Claude, at release time — can say
  // what a set of changes means for the operator. `--check-digest` refuses to publish the TODO.
  const digest = `### ${DIGEST_HEADING}\n${DIGEST_PLACEHOLDER}\n`;
  const versionSection = `## [${version}] - ${date}\n\n${digest}\n${assembled}\n`;
  const newText = `${text.slice(0, m.index)}## [Unreleased]\n\n${versionSection}\n${text.slice(bodyEnd).replace(/^\n+/, '')}`;

  fs.writeFileSync(CHANGELOG, newText);
  for (const fr of fragments) fs.rmSync(path.join(FRAG_DIR, fr.file));
  process.stdout.write(`Released ${version} (${date}): folded ${fragments.length} fragment(s).\n`);
  process.stdout.write(`Now WRITE the "### ${DIGEST_HEADING}" block — it is the whole of what the operator reads in the update dialog.\n`);
  process.stdout.write(`Then: node scripts/build-changelog.mjs --check-digest ${version}\n`);
}

function checkDigestMode(version) {
  const body = sectionFor(fs.readFileSync(CHANGELOG, 'utf8'), version);
  if (body === null) {
    process.stderr.write(`CHANGELOG.md has no section for ${version}.\n`);
    process.exit(1);
  }
  const { ok, errors, bullets } = checkDigest(body);
  if (!ok) {
    process.stderr.write(`The ${version} operator digest is not publishable:\n`);
    for (const err of errors) process.stderr.write(`  - ${err}\n`);
    process.stderr.write('\nIt is the whole of what the operator reads before clicking "Installer".\n');
    process.exit(1);
  }
  const longest = Math.max(...bullets.map((b) => b.length));
  process.stdout.write(`✓ ${version} digest: ${bullets.length} line(s), the longest ${longest} characters.\n`);
}

function main() {
  const args = process.argv.slice(2);

  const checkIdx = args.indexOf('--check-digest');
  if (checkIdx !== -1) {
    const version = args[checkIdx + 1];
    if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
      process.stderr.write('Usage: node scripts/build-changelog.mjs --check-digest X.Y.Z\n');
      process.exit(1);
    }
    return checkDigestMode(version);
  }

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
