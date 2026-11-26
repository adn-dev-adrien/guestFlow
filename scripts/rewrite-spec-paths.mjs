#!/usr/bin/env node
/**
 * Rewrites every spec path that no longer points to a file — specs/README.md "Folders".
 *
 * A spec is identified by its name, unique across `specs/` (specs/spec-rule-coverage.md rule 20), so
 * a stale path can always be resolved from its last segment: `specs/reservation-refunds.md` becomes
 * `specs/payments/reservation-refunds.md`, and a relative link `](reservation-refunds.md)` inside a
 * moved spec becomes `](../payments/reservation-refunds.md)`. Run it after merging master into a
 * branch that still cites the old paths, or after moving a spec to another folder.
 *
 * Usage:
 *   node scripts/rewrite-spec-paths.mjs <file>...  # rewrite these files only (what a PR touches)
 *   node scripts/rewrite-spec-paths.mjs            # rewrite every tracked text file
 *   node scripts/rewrite-spec-paths.mjs --check    # list what would change, exit 1 if anything would
 *
 * Prefer naming the files: a plugin's source file rewritten for a comment still counts as a change of
 * that plugin, which must then carry a new version (specs/plugins/plugins-phase-4-registry.md rule 28).
 *
 * A path it cannot resolve (a deleted spec) is listed and left as is: that one needs a human choice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = path.join(ROOT, 'specs');

// The three specs that used to be folders (`specs/tariff-recipes/spec.md`, `plan.md`, …) were
// flattened into `<folder>.md`, `<folder>-plan.md`, `<folder>-architecture.md`, `<folder>-study.md`.
const FLATTENED = { spec: '', plan: '-plan', architecture: '-architecture', etude: '-study' };
const LEGACY_DIRS = ['tariff-recipes', 'tariff-events-and-extra-guest-tiers', 'tariff-recipe-gite', 'terms-acceptance-record', 'settings-rationalization', 'guest-app-livret'];

const posix = (p) => p.split(path.sep).join('/');
// This script, the coverage script and their tests cite example paths on purpose.
const OWN_FIXTURES = /^(scripts\/(rewrite-spec-paths|check-spec-coverage)\.mjs|server\/src\/tests\/spec-rule-coverage[^/]*\.test\.js)$/;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc); else acc.push(full);
  }
  return acc;
}

/** name → repo-relative path, for every spec (INDEX files excluded: one per folder, never cited by name). */
export function specIndex(specsDir = SPECS) {
  const byName = new Map();
  for (const f of walk(specsDir)) {
    if (!f.endsWith('.md') || path.basename(f) === 'INDEX.md') continue;
    byName.set(path.basename(f, '.md'), posix(path.relative(path.dirname(specsDir), f)));
  }
  return byName;
}

/** The spec name a (possibly stale) path designates. */
export function nameOf(target) {
  const parts = target.replace(/[#?].*$/, '').split('/').filter(Boolean);
  const file = (parts.pop() || '').replace(/\.md$/, '');
  const dir = parts.pop();
  if (dir && Object.hasOwn(FLATTENED, file) && LEGACY_DIRS.includes(dir)) return `${dir}${FLATTENED[file]}`;
  return file;
}

const exists = (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } };

/**
 * @returns {{text: string, changed: number, unresolved: string[]}}
 */
export function rewrite(text, fileRel, index, fileExists = (rel) => exists(path.join(ROOT, rel))) {
  let changed = 0;
  const unresolved = [];
  const fileDir = path.posix.dirname(fileRel);

  // `specs/<...>.md` written from the repository root, as code comments and tests cite them.
  let out = text.replace(/(?<![\w./-])specs\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md/gi, (m) => {
    if (fileExists(m)) return m;
    const now = index.get(nameOf(m));
    if (!now) { unresolved.push(m); return m; }
    changed += 1;
    return now;
  });

  // Relative Markdown links, in Markdown files only.
  if (/\.md$/i.test(fileRel)) {
    out = out.replace(/\]\(((?!https?:|mailto:|#|\/)[^)\s]+)\)/g, (m, target) => {
      const [bare, anchor = ''] = target.split(/(?=#)/);
      if (fileExists(path.posix.normalize(path.posix.join(fileDir, bare)))) return m;
      let found = null;
      if (bare.endsWith('.md')) found = index.get(nameOf(bare)) || null;
      const legacy = LEGACY_DIRS.filter((d) => path.posix.basename(fileRel).startsWith(d)).sort((a, b) => b.length - a.length)[0];
      if (!found && legacy && bare.endsWith('.md') && !bare.replace(/^\.\//, '').includes('/')) {
        // A link between two files of a flattened folder (`](spec.md)` from `tariff-recipes/plan.md`).
        found = index.get(nameOf(`${legacy}/${bare.replace(/^\.\//, '')}`)) || null;
      }
      if (!found && fileRel.startsWith('specs/')) {
        // A spec that moved down one folder: the link was written from its old place.
        for (const base of ['specs', ...LEGACY_DIRS.map((d) => `specs/${d}`)]) {
          const cand = path.posix.normalize(path.posix.join(base, bare));
          if (fileExists(cand)) { found = cand; break; }
        }
      }
      if (!found) { if (/\.(md|html)$/.test(bare)) unresolved.push(target); return m; }
      changed += 1;
      return `](${path.posix.relative(fileDir, found)}${anchor})`;
    });
  }
  return { text: out, changed, unresolved };
}

function main() {
  const check = process.argv.includes('--check');
  const index = specIndex();
  const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const files = named.length ? named : execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
  let total = 0;
  let touched = 0;
  const unresolved = [];
  for (const rel of files) {
    if (OWN_FIXTURES.test(rel)) continue;
    const abs = path.join(ROOT, rel);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (text.includes('\0') || !/specs\/|\.md/.test(text)) continue;
    const r = rewrite(text, rel, index);
    for (const u of r.unresolved) unresolved.push(`${rel} → ${u}`);
    if (r.changed === 0) continue;
    total += r.changed;
    touched += 1;
    if (check) console.log(`${rel}: ${r.changed}`);
    else fs.writeFileSync(abs, r.text);
  }
  console.log(`${check ? 'Would rewrite' : 'Rewrote'} ${total} spec path(s) in ${touched} file(s).`);
  if (unresolved.length) {
    console.log(`\n${unresolved.length} path(s) point to no spec (deleted or never existed), left as is:`);
    for (const u of unresolved.slice(0, 40)) console.log(`  ${u}`);
    if (unresolved.length > 40) console.log(`  … and ${unresolved.length - 40} more`);
  }
  process.exit(check && total > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
