/**
 * The `--expect` file of `scripts/pricing-replay.mjs` (specs/pricing-components.md §3 rule 81).
 *
 * The file is a JSON array `[{ "key": "<artefact key>", "reason": "<why it moves>", "rule": "<rule or decision>" }]`.
 * `classifyReplay(before, after, expect)` splits the replay's differences into the expected ones (their key is
 * listed) and the unexpected ones, and reports the listed keys that did NOT move (stale: a list is exact, never a
 * superset). A key is matched whole, never by prefix or pattern.
 */

/** The problems of an expect list as messages; empty when every entry is complete and unique. */
function expectProblems(expect) {
  if (!Array.isArray(expect)) return ['the expect file is not an array'];
  const problems = [];
  const seen = new Set();
  expect.forEach((entry, index) => {
    for (const field of ['key', 'reason', 'rule']) {
      if (!entry || typeof entry[field] !== 'string' || entry[field].trim() === '') problems.push(`entry ${index}: ${field} is missing or empty`);
    }
    if (entry && typeof entry.key === 'string') {
      if (seen.has(entry.key)) problems.push(`entry ${index}: key ${entry.key} is listed twice`);
      seen.add(entry.key);
    }
  });
  return problems;
}

/** @returns {{ compared: number, expected: string[], unexpected: string[], stale: string[] }} */
function classifyReplay(before, after, expect = []) {
  const problems = expectProblems(expect);
  if (problems.length) throw new Error(`replay expect list is invalid: ${problems.join('; ')}`);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const moved = [...keys].filter((key) => before[key] !== after[key]).sort();
  const listed = new Set(expect.map((entry) => entry.key));
  return {
    compared: keys.size,
    expected: moved.filter((key) => listed.has(key)),
    unexpected: moved.filter((key) => !listed.has(key)),
    stale: [...listed].filter((key) => !moved.includes(key)).sort(),
  };
}

/**
 * The first difference between two captured values that is NOT a key added in `after` (an object key `before` did not
 * hold, at any depth): a column a migration adds to a row a payload spreads (`SELECT *`) moves no figure and is not one.
 * `null` when `after` equals `before` once its added keys are ignored. Values are the replay's canonical JSON texts, or
 * plain texts (an `ERROR …` line), compared as such.
 */
function nonAdditiveDifference(before, after) {
  const parse = (text) => { try { return { value: JSON.parse(text) }; } catch { return { text }; } };
  const walk = (a, b, where) => {
    if (a === b) return null;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      if (Array.isArray(a)) {
        if (a.length !== b.length) return `${where}: ${a.length} item(s) became ${b.length}`;
        for (let i = 0; i < a.length; i += 1) {
          const found = walk(a[i], b[i], `${where}[${i}]`);
          if (found) return found;
        }
        return null;
      }
      for (const key of Object.keys(a)) {
        if (!(key in b)) return `${where}.${key}: removed`;
        const found = walk(a[key], b[key], `${where}.${key}`);
        if (found) return found;
      }
      return null;
    }
    return `${where}: ${JSON.stringify(a)} became ${JSON.stringify(b)}`;
  };
  const x = parse(before);
  const y = parse(after);
  if ('text' in x || 'text' in y) return x.text === y.text ? null : 'text differs';
  return walk(x.value, y.value, '');
}

/** `{ [key]: first non-additive difference }` for the keys whose values differ beyond added keys; keys on one side only count. */
function valueDifferences(beforeValues, afterValues) {
  const out = {};
  for (const key of new Set([...Object.keys(beforeValues), ...Object.keys(afterValues)])) {
    if (!(key in beforeValues)) out[key] = 'artefact added';
    else if (!(key in afterValues)) out[key] = 'artefact removed';
    else {
      const found = nonAdditiveDifference(beforeValues[key], afterValues[key]);
      if (found) out[key] = found;
    }
  }
  return out;
}

module.exports = { classifyReplay, expectProblems, nonAdditiveDifference, valueDifferences };
