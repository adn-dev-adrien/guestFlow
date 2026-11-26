// specs/tech/server-test-isolation.md rule 21 — a client test never inherits a mock another test set.
// `vi.clearAllMocks()` clears calls, not implementations: on a loaded runner a `mockRejectedValue` of one
// InstallmentPlanCard test answered an extra call of the next one. This pins the reset and the shuffle sweep.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const clientDir = path.join(__dirname, '..', '..', '..', 'client');
const read = (file) => fs.readFileSync(path.join(clientDir, file), 'utf8');

test('rule 21: every client mock goes back to its own vi.fn(impl) before each test', () => {
  assert.match(read('vitest.config.js'), /^\s*mockReset: true,$/m);
});

test('rule 21: `npm run test:shuffle` runs the unit suite in a random order', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.equal(scripts['test:shuffle'], 'vitest run --sequence.shuffle.tests');
});

test('rule 21: the shuffle sweep is never part of the normal config nor of CI', () => {
  assert.doesNotMatch(read('vitest.config.js'), /shuffle/);
  const workflows = path.join(clientDir, '..', '.github', 'workflows');
  const files = fs.readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.length > 0);
  for (const name of files) {
    const source = fs.readFileSync(path.join(workflows, name), 'utf8');
    assert.doesNotMatch(source, /test:shuffle|sequence\.shuffle/, `${name} runs the shuffle sweep`);
  }
});
