#!/usr/bin/env node
/**
 * A plugin whose files changed carries a new version (specs/plugins-phase-4-registry.md P26, rule 23).
 *
 *   node scripts/check-plugin-versions.mjs            # the release's `verify` job: fails when a plugin
 *                                                      # changed since the previous tag and kept its version
 *   node scripts/check-plugin-versions.mjs --bump     # the release skill: patch-bumps every such plugin
 *   node scripts/check-plugin-versions.mjs --base v3.9.0
 *
 * "Changed" means a file of `server/src/plugins/<id>/` or `client/src/plugins/<id>/` differs from the
 * previous tag, tests excepted (a test changes no package). The previous tag is the newest `v*` tag
 * reachable from HEAD — from HEAD's parent when HEAD itself is the tag being released. A plugin
 * with no manifest at that tag (its first packaged release) is never a violation.
 *
 * The decision is a pure function, exported for the unit suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PLUGINS = 'server/src/plugins';
const CLIENT_PLUGINS = 'client/src/plugins';
const HOST_DIRS = new Set(['sdk']);

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Whether a changed path counts for a plugin's package: tests do not. */
export const countsForPackage = (file) => !/\/(tests|__tests__)\//.test(file);

/** → [{ id, version }] — the plugins that changed and kept the version they had at the base. */
export function findViolations({ changed, baseVersions, headVersions }) {
  return [...changed].sort()
    .filter((id) => baseVersions[id] && headVersions[id] && baseVersions[id] === headVersions[id])
    .map((id) => ({ id, version: headVersions[id] }));
}

export function bumpPatch(version) {
  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`not a MAJOR.MINOR.PATCH version: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** The plugin ids touched by a list of changed paths. */
export function pluginsOf(files) {
  const ids = new Set();
  for (const file of files.filter(countsForPackage)) {
    const m = file.match(/^(?:server|client)\/src\/plugins\/([^/]+)\//);
    if (m && !HOST_DIRS.has(m[1])) ids.add(m[1]);
  }
  return ids;
}

function previousTag() {
  const headTags = git(['tag', '--points-at', 'HEAD']).split('\n').filter((t) => /^v\d/.test(t));
  const from = headTags.length ? 'HEAD^' : 'HEAD';
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', from]);
  } catch {
    return null;
  }
}

function manifestAt(ref, id) {
  try {
    return JSON.parse(git(['show', `${ref}:${SERVER_PLUGINS}/${id}/manifest.json`]));
  } catch {
    return null;
  }
}

const manifestPath = (id) => path.join(ROOT, SERVER_PLUGINS, id, 'manifest.json');

function main() {
  const args = process.argv.slice(2);
  const at = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
  const base = at('--base') || previousTag();
  if (!base) {
    process.stdout.write('No previous release tag: every plugin is new.\n');
    return 0;
  }
  const files = git(['diff', '--name-only', base, '--', SERVER_PLUGINS, CLIENT_PLUGINS]).split('\n').filter(Boolean);
  const changed = pluginsOf(files);
  const ids = [...changed].filter((id) => fs.existsSync(manifestPath(id)));
  const baseVersions = Object.fromEntries(ids.map((id) => [id, (manifestAt(base, id) || {}).version || null]));
  const headVersions = Object.fromEntries(ids.map((id) => [id, JSON.parse(fs.readFileSync(manifestPath(id), 'utf8')).version]));
  const violations = findViolations({ changed: new Set(ids), baseVersions, headVersions });

  if (args.includes('--bump')) {
    for (const { id, version } of violations) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath(id), 'utf8'));
      manifest.version = bumpPatch(version);
      fs.writeFileSync(manifestPath(id), `${JSON.stringify(manifest, null, 2)}\n`);
      process.stdout.write(`↑ ${id} ${version} → ${manifest.version}\n`);
    }
    if (!violations.length) process.stdout.write(`✓ No plugin to bump since ${base}.\n`);
    return 0;
  }
  if (violations.length) {
    for (const v of violations) process.stderr.write(`✗ ${v.id} changed since ${base} but is still ${v.version}.\n`);
    process.stderr.write('\nRun: node scripts/check-plugin-versions.mjs --bump\n');
    return 1;
  }
  process.stdout.write(`✓ ${ids.length} plugin(s) changed since ${base}; none kept its version.\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
