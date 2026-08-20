/**
 * Minimal semantic-version helpers for the self-update engine
 * (specs/self-update-and-releases.md §3.A rule 2, §3.B rule 13).
 *
 * GuestFlow releases are strictly `MAJOR.MINOR.PATCH` — no pre-release, no build metadata. Anything
 * else is refused rather than coerced: a version string that reaches this module ends up in a
 * filesystem path and in a spawned command line, so "roughly parseable" is not good enough.
 */

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** True when `value` is a strict MAJOR.MINOR.PATCH string. */
function isValidVersion(value) {
  return typeof value === 'string' && VERSION_RE.test(value);
}

/** `v1.2.3` → `1.2.3`. Returns the input untouched when there is no leading `v`. */
function stripLeadingV(value) {
  if (typeof value !== 'string') return value;
  return value.startsWith('v') ? value.slice(1) : value;
}

/** `[major, minor, patch]`, or null when the string is not a valid version. */
function parseVersion(value) {
  const match = typeof value === 'string' ? value.match(VERSION_RE) : null;
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * -1 / 0 / 1 like a comparator, or null when either side is unparseable.
 */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * True only when `candidate` is strictly newer than `current`.
 *
 * Fail-closed on anything unparseable: a malformed or rolled-back remote version must never be
 * advertised as an update (the failure mode sowel hit in its spec 136).
 */
function isNewerVersion(candidate, current) {
  const cmp = compareVersions(candidate, current);
  return cmp === 1;
}

module.exports = {
  VERSION_RE,
  isValidVersion,
  stripLeadingV,
  parseVersion,
  compareVersions,
  isNewerVersion,
};
