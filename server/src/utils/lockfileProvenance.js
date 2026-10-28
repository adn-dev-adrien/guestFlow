/**
 * Provenance check of a release's `server/package-lock.json`, run before any `npm ci`
 * (specs/self-update-and-releases.md rule 39). `--ignore-scripts` does not stop a git dependency's
 * `prepare`, nor the explicit rebuild of a package merely *named* `sharp` or `better-sqlite3`; a
 * lockfile in which every entry comes from the public npm registry with an integrity hash does.
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PREFIX = 'https://registry.npmjs.org/';

/** → the offending entries as `[path, reason]`; empty when the lockfile is clean. */
function lockfileViolations(lock) {
  const packages = lock && typeof lock === 'object' ? lock.packages : null;
  if (!packages || typeof packages !== 'object') return [['(lockfile)', 'no packages']];
  const out = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '') continue;
    if (!entry || typeof entry !== 'object') { out.push([key, 'unreadable entry']); continue; }
    if (entry.link) { out.push([key, 'link dependency']); continue; }
    if (entry.inBundle) continue;
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(REGISTRY_PREFIX)) {
      out.push([key, `not resolved from ${REGISTRY_PREFIX}`]);
    } else if (typeof entry.integrity !== 'string' || !entry.integrity) {
      out.push([key, 'no integrity hash']);
    }
  }
  return out;
}

/** Throws `LOCKFILE_UNTRUSTED:<first offender>` when the release's lockfile is missing or not clean. */
function assertLockfileProvenance(serverDir) {
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
