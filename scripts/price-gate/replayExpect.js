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

module.exports = { classifyReplay, expectProblems };
