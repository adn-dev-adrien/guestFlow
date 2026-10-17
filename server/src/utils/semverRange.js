/**
 * Version ranges of the plugin packages (specs/plugins-phase-4-registry.md rules 2, 12, 14, 22).
 *
 * The core's own release versions stay strict MAJOR.MINOR.PATCH (`utils/semver.js`); a manifest
 * speaks npm ranges (`>=3.9.0`, `^1.0.0`), so the range logic is the `semver` package's, not ours.
 */

const semver = require('semver');

const isVersion = (value) => typeof value === 'string' && semver.valid(value) === value;
const isRange = (value) => typeof value === 'string' && value.trim() !== '' && semver.validRange(value) !== null;

/** Whether `version` satisfies `range`; false for anything unparseable (fail closed). */
function satisfies(version, range) {
  if (!isVersion(version) || !isRange(range)) return false;
  return semver.satisfies(version, range);
}

/** -1 / 0 / 1, newest last when sorting ascending. */
const compare = (a, b) => semver.compare(a, b);

/** The highest version of a list, or null. */
function highest(versions) {
  const valid = versions.filter(isVersion);
  return valid.length ? [...valid].sort(compare)[valid.length - 1] : null;
}

/** « 4.1 » for 4.1.0, « 4.1.2 » otherwise: the floor of a range as the operator reads it. */
function floorLabel(range) {
  const min = isRange(range) ? semver.minVersion(range) : null;
  if (!min) return null;
  return min.patch === 0 ? `${min.major}.${min.minor}` : min.version;
}

module.exports = { isVersion, isRange, satisfies, compare, highest, floorLabel };
