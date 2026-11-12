/**
 * Exact comparison of two price-gate figure sets (specs/pricing-components.md §3 rule 68).
 *
 * `compareFigures(expected, actual, allowlist)` takes `{ [reservationId]: figures }` twice (see
 * `scripts/price-gate/figuresOf.js`) and returns EVERY difference as `{ reservationId, field, expected, actual }`:
 * no tolerance, no wildcard, no rounding slack — two values are the same figure when `Object.is` says so (12.345 is
 * not 12.35, 0.1 + 0.2 is not 0.3, -0 is not 0). A stay or a figure present on one side only is a difference.
 *
 * The only exception is the versioned allowlist (`fixtures/price-gate/allowlist.json`): an entry
 * `{ reservationId, field, old, corrected, reason, rule, defect, approvedBy, approvedAt }` removes ONE
 * difference — the one on that stay and that field whose expected value is exactly `old` and whose actual
 * value is exactly `corrected`. Any other value on that field still fails.
 *
 * An entry may carry a `scope` (rule 81): `stays` (the default, so an existing entry keeps its meaning),
 * `synthetic`, `resourceBookings`, `propertyGrids` or `writes` (the refund write-path replay). `compareFigures(expected, actual, allowlist, { scope })`
 * considers only the entries of that scope (default `stays`): an entry of another scope neither absorbs a
 * difference here nor is reported unused here.
 *
 * Returns `{ differences, allowed, unusedEntries }`: what still fails, what the allowlist absorbed, and the
 * entries that matched nothing (a stale entry is reported, never silently kept).
 */
const { isDeepStrictEqual } = require('node:util');

const ENTRY_FIELDS = ['reservationId', 'field', 'old', 'corrected', 'reason', 'rule', 'defect', 'approvedBy', 'approvedAt'];
const SCOPES = ['stays', 'synthetic', 'resourceBookings', 'propertyGrids', 'writes'];
const DEFAULT_SCOPE = 'stays';
const TEXT_FIELDS = ['field', 'reason', 'rule', 'defect', 'approvedBy', 'approvedAt'];

/** The problems of an allowlist as a list of messages; empty when every entry is complete. */
function allowlistProblems(allowlist) {
  if (!Array.isArray(allowlist)) return ['the allowlist is not an array'];
  const problems = [];
  allowlist.forEach((entry, index) => {
    for (const key of ENTRY_FIELDS) {
      if (!entry || !Object.prototype.hasOwnProperty.call(entry, key)) problems.push(`entry ${index}: ${key} is missing`);
    }
    for (const key of TEXT_FIELDS) {
      if (entry && Object.prototype.hasOwnProperty.call(entry, key) && (typeof entry[key] !== 'string' || entry[key].trim() === '')) {
        problems.push(`entry ${index}: ${key} is empty`);
      }
    }
    if (entry && entry.scope !== undefined && !SCOPES.includes(entry.scope)) problems.push(`entry ${index}: scope ${JSON.stringify(entry.scope)} is not one of ${SCOPES.join(', ')}`);
    if (entry && entry.reservationId == null) problems.push(`entry ${index}: reservationId is empty`);
    if (entry && isDeepStrictEqual(entry.old, entry.corrected)) problems.push(`entry ${index}: old and corrected are equal`);
  });
  return problems;
}

function differencesOf(expected, actual) {
  const out = [];
  const ids = [...new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})])].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  for (const reservationId of ids) {
    const want = expected[reservationId] || {};
    const got = actual[reservationId] || {};
    const fields = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
    for (const field of fields) {
      const e = Object.prototype.hasOwnProperty.call(want, field) ? want[field] : undefined;
      const a = Object.prototype.hasOwnProperty.call(got, field) ? got[field] : undefined;
      if (!isDeepStrictEqual(e, a)) out.push({ reservationId: Number(reservationId), field, expected: e, actual: a });
    }
    if (!expected[reservationId]) out.push({ reservationId: Number(reservationId), field: '<stay>', expected: undefined, actual: 'present' });
    if (!actual[reservationId]) out.push({ reservationId: Number(reservationId), field: '<stay>', expected: 'present', actual: undefined });
  }
  return out;
}

function compareFigures(expected, actual, fullAllowlist = [], { scope = DEFAULT_SCOPE } = {}) {
  const problems = allowlistProblems(fullAllowlist);
  if (problems.length) throw new Error(`price-gate allowlist is invalid: ${problems.join('; ')}`);
  if (!SCOPES.includes(scope)) throw new Error(`price-gate scope ${JSON.stringify(scope)} is not one of ${SCOPES.join(', ')}`);
  const allowlist = fullAllowlist.filter((entry) => (entry.scope || DEFAULT_SCOPE) === scope);
  const differences = [];
  const allowed = [];
  const used = new Set();
  for (const difference of differencesOf(expected, actual)) {
    const index = allowlist.findIndex((entry, i) => !used.has(i)
      && Number(entry.reservationId) === difference.reservationId
      && entry.field === difference.field
      && isDeepStrictEqual(entry.old, difference.expected)
      && isDeepStrictEqual(entry.corrected, difference.actual));
    if (index === -1) {
      differences.push(difference);
    } else {
      used.add(index);
      allowed.push({ ...difference, entry: allowlist[index] });
    }
  }
  const unusedEntries = allowlist.filter((_, i) => !used.has(i));
  return { differences, allowed, unusedEntries };
}

module.exports = { compareFigures, allowlistProblems, differencesOf, SCOPES };
