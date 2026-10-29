/**
 * Provenance check of a release's `server/package-lock.json`, run before any `npm ci`
 * (specs/self-update-and-releases.md rule 40). `--ignore-scripts` does not stop a git dependency's
 * `prepare`; a lockfile in which every entry comes from the public npm registry with an integrity hash
 * does, with no exemption (an `inBundle` entry is checked like any other). A release carrying an
 * `npm-shrinkwrap.json`, an `.npmrc` or its own `.install-home` is refused outright.
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_ORIGIN = 'https://registry.npmjs.org';
const REGISTRY_PREFIX = `${REGISTRY_ORIGIN}/`;
const SERVER_PACKAGE_NAME = 'guestflow-server';

/**
 * npm parses `resolved` with `new URL()` before fetching, which collapses `..` segments: a raw prefix
 * check lets `…/better-sqlite3/-/../../evil/-/evil-1.0.0.tgz` through. The only accepted spelling is
 * the canonical one, so what is checked is what is fetched.
 */
function isOwnTarball(resolved, name, version) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return false;
  }
  const base = name.slice(name.lastIndexOf('/') + 1);
  return url.href === resolved && url.origin === REGISTRY_ORIGIN && !url.search && !url.hash
    && url.pathname === `/${name}/-/${base}-${version}.tgz`;
}

/** → the offending entries as `[path, reason]`; empty when the lockfile is clean. */
function lockfileViolations(lock) {
  const packages = lock && typeof lock === 'object' ? lock.packages : null;
  if (!packages || typeof packages !== 'object') return [['(lockfile)', 'no packages']];
  const out = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '') continue;
    if (!entry || typeof entry !== 'object') { out.push([key, 'unreadable entry']); continue; }
    if (entry.link) { out.push([key, 'link dependency']); continue; }
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(REGISTRY_PREFIX)) {
      out.push([key, `not resolved from ${REGISTRY_PREFIX}`]);
    } else if (typeof entry.name === 'string' && entry.name !== name) {
      out.push([key, `aliased to ${entry.name}`]);
    } else if (!isOwnTarball(entry.resolved, name, entry.version)) {
      out.push([key, `tarball is not ${name}'s own`]);
    } else if (typeof entry.integrity !== 'string' || !entry.integrity) {
      out.push([key, 'no integrity hash']);
    }
  }
  return out;
}

// Files npm would honour in place of, or on top of, the lockfile we check: a shrinkwrap wins over
// package-lock.json, and a project .npmrc can re-enable scripts or point at another registry.
const FORBIDDEN_FILES = [['server', 'npm-shrinkwrap.json'], ['server', '.npmrc'], ['release root', '.npmrc'], ['release root', '.install-home']];

function declaresWorkspaces(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).workspaces !== undefined;
  } catch {
    return false;
  }
}

// A server package named after a dependency would be found by Node's self-reference lookup before node_modules.
function serverNameViolation(serverDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')).name !== SERVER_PACKAGE_NAME;
  } catch {
    return true;
  }
}

/** Throws `LOCKFILE_UNTRUSTED:<first offender>` when the release's lockfile is missing or not clean. */
function assertLockfileProvenance(serverDir) {
  FORBIDDEN_FILES.forEach(([where, name]) => {
    const dir = where === 'server' ? serverDir : path.dirname(serverDir);
    if (fs.existsSync(path.join(dir, name))) throw new Error(`LOCKFILE_UNTRUSTED:${where === 'server' ? 'server/' : ''}${name} present`);
  });
  // npm walks up from the cwd to a workspace root and installs from *its* lockfile, which is never checked.
  [path.join(path.dirname(serverDir), 'package.json'), path.join(serverDir, 'package.json')].forEach((file) => {
    if (declaresWorkspaces(file)) throw new Error('LOCKFILE_UNTRUSTED:workspaces declared');
  });
  if (serverNameViolation(serverDir)) throw new Error('LOCKFILE_UNTRUSTED:server/package.json name');
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(path.join(serverDir, 'package-lock.json'), 'utf8'));
  } catch {
    throw new Error('LOCKFILE_UNTRUSTED:package-lock.json unreadable');
  }
  const violations = lockfileViolations(lock);
  if (violations.length) {
    const [key, reason] = violations[0];
    throw new Error(`LOCKFILE_UNTRUSTED:${key} (${reason})`);
  }
  return true;
}

module.exports = { assertLockfileProvenance, lockfileViolations, REGISTRY_PREFIX };
