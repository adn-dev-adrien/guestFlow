// specs/spec-rule-coverage.md rule 16 — `--changed` refuses the orphan citations a PR brings and leaves the ones
// already there to the report.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check-spec-coverage.mjs');
const load = () => import(SCRIPT);

const orphan = (file, spec, rule) => ({ file, spec, rule, why: 'règle inexistante' });

test('rule 16 — an orphan in a file the PR changed, absent from that file at the base, fails', async () => {
  const { newOrphans } = await load();
  const found = newOrphans([orphan('e2e/a.spec.js', 'smoke', '25')], new Set(['e2e/a.spec.js']), () => new Set());
  assert.deepEqual(found.map((o) => `${o.file} ${o.spec}:${o.rule}`), ['e2e/a.spec.js smoke:25']);
});

test('rule 16 — an orphan already cited by the file at the base is left to the report', async () => {
  const { newOrphans } = await load();
  assert.deepEqual(newOrphans([orphan('e2e/a.spec.js', 'smoke', '25')], new Set(['e2e/a.spec.js']), () => new Set(['smoke:25'])), []);
});

test('rule 16 — an orphan in a file the PR did not touch is not its doing', async () => {
  const { newOrphans } = await load();
  assert.deepEqual(newOrphans([orphan('e2e/b.spec.js', 'smoke', '25')], new Set(['e2e/a.spec.js']), () => new Set()), []);
});
