/**
 * The version GuestFlow is currently running (specs/self-update-and-releases.md §3.B rule 11).
 *
 * Source of truth: the root `package.json`, which the release archive ships alongside `server/` and
 * `client/`. The same relative path resolves in both layouts:
 *   dev  → <repo>/package.json
 *   prod → ~/guestflow/current/package.json
 *
 * Read once and memoised: the file cannot change under a running process (a new release means a new
 * directory and a restart).
 */

const fs = require('fs');
const path = require('path');
const { isValidVersion } = require('./semver');

const ROOT_PACKAGE_JSON = path.resolve(__dirname, '..', '..', '..', 'package.json');
const SERVER_PACKAGE_JSON = path.resolve(__dirname, '..', '..', 'package.json');
const DEV_VERSION = '0.0.0-dev';

let cached = null;

function readVersionFrom(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isValidVersion(parsed.version) ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * The running version, or `0.0.0-dev` when no readable package.json carries a valid one.
 * `0.0.0-dev` never compares as older than a published release, so a dev tree is never told an
 * update is available.
 */
function getAppVersion() {
  if (cached === null) {
    cached = readVersionFrom(ROOT_PACKAGE_JSON) || readVersionFrom(SERVER_PACKAGE_JSON) || DEV_VERSION;
  }
  return cached;
}

/** True when the running tree has no published version (dev checkout). */
function isDevVersion() {
  return getAppVersion() === DEV_VERSION;
}

/** Test seam — forget the memoised value. */
function resetCache() {
  cached = null;
}

module.exports = { getAppVersion, isDevVersion, DEV_VERSION, resetCache };
