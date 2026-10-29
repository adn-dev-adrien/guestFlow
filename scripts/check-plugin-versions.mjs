#!/usr/bin/env node
/**
 * A plugin whose files changed carries a new version (specs/plugins-phase-4-registry.md P26, rules 23, 28).
 *
 *   node scripts/check-plugin-versions.mjs            # the release's `verify` job: fails when a plugin
 *                                                      # changed since the previous tag and kept its version
 *   node scripts/check-plugin-versions.mjs --base origin/inte/plugins
 *                                                      # every PR (rule 28): the plugin a PR changes is
 *                                                      # bumped in that PR, with its changelog lines
 *   node scripts/check-plugin-versions.mjs --bump     # a developer's helper, in the feature PR
 *   node scripts/check-plugin-versions.mjs --built plugins-dist --previous prev-dist
 *                                                      # the release's package job and the release skill's
 *                                                      # pre-flight (rule 27): a package whose built content
 *                                                      # differs from the one already published under the
 *                                                      # same version fails — the version must be bumped.
 *                                                      # The published package is only compared, never
 *                                                      # shipped again (audit r2 N4)
 *
 * Every run but `--built` also checks that the host module list only grows (rule 33), that the
 * core modules a server plugin reaches through `coreModule()` lose nothing unless the SDK's major
 * version moves (rule 35), and that the `requires` of the shipped manifests form a sound graph:
 * every requirement is shipped, at a version its range accepts, with no cycle
 * (specs/plugin-dependencies.md rule 16).
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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PLUGINS = 'server/src/plugins';
const CLIENT_PLUGINS = 'client/src/plugins';
const HOST_DIRS = new Set(['sdk']);
const HOST_JSON = 'client/src/plugins/hostModules.json';
const CORE_JSON = 'server/src/plugins/sdk/coreModules.json';
const SDK_VERSION_FILE = 'server/src/plugins/sdk/version.js';

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Whether a changed path counts for a plugin's package: tests do not. */
export const countsForPackage = (file) => !/\/(tests|__tests__)\//.test(file);

/** → [{ id, version }] — the plugins that changed and kept the version they had at the base. */
export function findViolations({ changed, baseVersions, headVersions }) {
  return [...changed].sort()
    .filter((id) => baseVersions[id] && headVersions[id] && baseVersions[id] === headVersions[id])
    .map((id) => ({ id, version: headVersions[id] }));
}

/** Rule 28 — a plugin with a new version says what changed in it, in French. → [{ id, version }] */
export function missingChangelog({ changed, baseVersions, headManifests }) {
  return [...changed].sort()
    .filter((id) => headManifests[id] && headManifests[id].version !== baseVersions[id])
    .filter((id) => !((headManifests[id].changelog || {})[headManifests[id].version] || []).length)
    .map((id) => ({ id, version: headManifests[id].version }));
}

/**
 * Rule 27 — the built packages against the previous release's: same version, other content.
 * `current` / `previous`: id → { version, contentHash }. → [{ id, version }]
 */
export function findContentViolations(current, previous) {
  return Object.keys(current).sort()
    .filter((id) => previous[id] && previous[id].version === current[id].version
      && previous[id].contentHash && current[id].contentHash && previous[id].contentHash !== current[id].contentHash)
    .map((id) => ({ id, version: current[id].version }));
}

/**
 * Rule 33 — what the host module list lost between two versions of `hostModules.json`
 * (spec → '*' | [names]). A whole module ('*') covers every name. → ['spec', 'spec#name']
 */
export function hostRemovals(before, after) {
  const removed = [];
  for (const [spec, names] of Object.entries(before || {})) {
    const now = (after || {})[spec];
    if (now === undefined) { removed.push(spec); continue; }
    if (now === '*') continue;
    if (names === '*') { removed.push(`${spec} (whole namespace)`); continue; }
    names.filter((n) => !now.includes(n)).forEach((n) => removed.push(`${spec}#${n}`));
  }
  return removed;
}

/**
 * Rule 35 — what `coreModules.json` lost, when the SDK major did not move. → ['module', 'module#name']
 */
export function coreRemovals(before, after, { sdkBefore = null, sdkAfter = null } = {}) {
  const major = (v) => String(v || '').split('.')[0];
  if (sdkBefore && sdkAfter && major(sdkBefore) !== major(sdkAfter)) return [];
  return hostRemovals(before, after);
}

const triple = (v) => String(v).split('-')[0].split('.').map(Number);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * A range check with no dependency (this script runs in CI with no node_modules), for the forms a
 * manifest's `requires` uses: `^x.y.z` and `>=x.y.z`. → true | false | null (a form it does not read).
 */
export function satisfiesSimple(version, range) {
  const v = triple(version);
  const m = String(range).trim().match(/^(\^|>=)\s*(\d+\.\d+\.\d+)$/);
  if (!m || v.length !== 3 || v.some(Number.isNaN)) return null;
  const floor = triple(m[2]);
  if (cmp(v, floor) < 0) return false;
  if (m[1] === '>=') return true;
  const ceiling = floor[0] > 0 ? [floor[0] + 1, 0, 0] : floor[1] > 0 ? [0, floor[1] + 1, 0] : [0, 0, floor[2] + 1];
  return cmp(v, ceiling) < 0;
}

/**
 * Rule 16 — what is wrong with the `requires` of the shipped manifests (id → manifest): a requirement
 * that is not shipped, a plugin requiring itself, a range the shipped version does not satisfy, a
 * cycle. → ['message', …], in English, one per violation.
 */
export function requirementViolations(manifests) {
  const { createGraph } = require('../server/src/utils/pluginGraph');
  const out = [];
  for (const id of Object.keys(manifests).sort()) {
    for (const req of manifests[id].requires || []) {
      const target = manifests[req.id];
      if (req.id === id) out.push(`${id} requires itself`);
      else if (!target) out.push(`${id} requires ${req.id}, which is not shipped`);
      else if (satisfiesSimple(target.version, req.range) === null) out.push(`${id} requires ${req.id} with a range this check does not read: ${req.range}`);
      else if (!satisfiesSimple(target.version, req.range)) out.push(`${id} requires ${req.id} ${req.range}, shipped ${target.version}`);
    }
  }
  createGraph({ manifests }).cycles().filter((cycle) => cycle.length > 1)
    .forEach((cycle) => out.push(`dependency cycle: ${[...cycle, cycle[0]].join(' -> ')}`));
  return out;
}

const sdkVersionOf = (source) => ((String(source || '').match(/SDK_VERSION\s*=\s*'([^']+)'/) || [])[1] || null);

// id → { version, contentHash } of the `.tgz` packages in `dir` (their manifest only).
function packagesIn(dir) {
  const out = {};
  if (!dir || !fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.tgz'))) {
    try {
      const manifest = JSON.parse(execFileSync('tar', ['-xOzf', path.join(dir, file), 'manifest.json'], { encoding: 'utf8' }));
      out[manifest.id] = { version: manifest.version, contentHash: manifest.contentHash || null };
    } catch { /* not a plugin package */ }
  }
  return out;
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
  if (at('--built')) {
    const builtDir = path.resolve(ROOT, at('--built'));
    const previousDir = at('--previous') && path.resolve(ROOT, at('--previous'));
    const violations = findContentViolations(packagesIn(builtDir), packagesIn(previousDir));
    for (const v of violations) process.stderr.write(`✗ ${v.id} ${v.version}: the package differs from the one already published under that version.\n`);
    if (violations.length) {
      process.stderr.write('\nBump the version of these plugins in a pull request (with its changelog lines), then release.\n'
        + 'A published package is never reused: release assets are mutable, so nothing downloaded is shipped again.\n');
      return 1;
    }
    process.stdout.write('✓ No published plugin version changes content.\n');
    return 0;
  }
  const shipped = Object.fromEntries(fs.readdirSync(path.join(ROOT, SERVER_PLUGINS), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(manifestPath(d.name)))
    .map((d) => [d.name, JSON.parse(fs.readFileSync(manifestPath(d.name), 'utf8'))]));
  const unsound = requirementViolations(shipped);
  if (unsound.length) {
    unsound.forEach((message) => process.stderr.write(`✗ ${message}\n`));
    process.stderr.write('\nFix the `requires` of the manifest(s) above (specs/plugin-dependencies.md rule 16).\n');
    return 1;
  }
  const base = at('--base') || previousTag();
  if (!base) {
    process.stdout.write('No previous release tag: every plugin is new.\n');
    return 0;
  }
  const files = git(['diff', '--name-only', base, '--', SERVER_PLUGINS, CLIENT_PLUGINS]).split('\n').filter(Boolean);
  const changed = pluginsOf(files);
  const ids = [...changed].filter((id) => fs.existsSync(manifestPath(id)));
  const baseVersions = Object.fromEntries(ids.map((id) => [id, (manifestAt(base, id) || {}).version || null]));
  const headManifests = Object.fromEntries(ids.map((id) => [id, JSON.parse(fs.readFileSync(manifestPath(id), 'utf8'))]));
  const headVersions = Object.fromEntries(ids.map((id) => [id, headManifests[id].version]));
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
  const undocumented = missingChangelog({ changed: new Set(ids), baseVersions, headManifests });
  let hostBefore = null;
  try { hostBefore = JSON.parse(git(['show', `${base}:${HOST_JSON}`])); } catch { hostBefore = null; }
  const removals = Array.isArray(hostBefore) ? [] : hostRemovals(hostBefore, JSON.parse(fs.readFileSync(path.join(ROOT, HOST_JSON), 'utf8')));
  if (removals.length) {
    process.stderr.write(`✗ client/src/plugins/hostModules.json lost since ${base}: ${removals.join(', ')}.\n`
      + '  A plugin already published may need them: the list only grows.\n');
    return 1;
  }
  let coreBefore = null;
  let sdkBefore = null;
  try { coreBefore = JSON.parse(git(['show', `${base}:${CORE_JSON}`])); } catch { coreBefore = null; }
  try { sdkBefore = sdkVersionOf(git(['show', `${base}:${SDK_VERSION_FILE}`])); } catch { sdkBefore = null; }
  const coreLost = coreBefore ? coreRemovals(coreBefore, JSON.parse(fs.readFileSync(path.join(ROOT, CORE_JSON), 'utf8')), {
    sdkBefore, sdkAfter: sdkVersionOf(fs.readFileSync(path.join(ROOT, SDK_VERSION_FILE), 'utf8')),
  }) : [];
  if (coreLost.length) {
    process.stderr.write(`✗ ${CORE_JSON} lost since ${base}: ${coreLost.join(', ')}.\n`
      + '  A published plugin may call them: keep them, or raise the SDK major version (server/src/plugins/sdk/version.js).\n');
    return 1;
  }
  if (violations.length || undocumented.length) {
    for (const v of violations) process.stderr.write(`✗ ${v.id} changed since ${base} but is still ${v.version}.\n`);
    for (const v of undocumented) process.stderr.write(`✗ ${v.id} ${v.version} has no changelog lines in its manifest.\n`);
    process.stderr.write('\nIn this pull request: node scripts/check-plugin-versions.mjs --bump, then write the\n'
      + 'French lines of the new version under `changelog` in each manifest.\n');
    return 1;
  }
  process.stdout.write(`✓ ${ids.length} plugin(s) changed since ${base}; none kept its version.\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
