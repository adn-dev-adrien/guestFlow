// specs/self-update-and-releases.md rule 51 — GUESTFLOW_DISABLE_OUTBOUND=1 skips the release check, so
// an E2E server never reads the GitHub releases API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runVersionCheck } = require('../controllers/systemController');

const fakeModel = () => {
  const writes = [];
  return {
    writes,
    readState: () => ({}),
    writeState: (s) => writes.push(s),
    recordCheck: (feed) => writes.push(feed),
  };
};

test('rule 51: with outbound disabled the release check calls no one and writes nothing', async () => {
  const calls = [];
  const model = fakeModel();
  const out = await runVersionCheck({
    model,
    env: { GUESTFLOW_DISABLE_OUTBOUND: '1' },
    fetchImpl: async (url) => { calls.push(String(url)); return { ok: false, status: 503 }; },
  });
  assert.equal(out, null);
  assert.deepEqual(calls, []);
  assert.deepEqual(model.writes, []);
});

test('rule 51: without the flag the same check does read the releases API', async () => {
  const calls = [];
  await runVersionCheck({
    model: fakeModel(),
    env: {},
    fetchImpl: async (url) => { calls.push(String(url)); return { ok: false, status: 503 }; },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/api\.github\.com\//);
});

// specs/e2e-playwright-smoke-suite.md rule 23 — every server an E2E suite starts carries the flag.
const root = path.join(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('rule 23: the main webServer command (also the bare suite\'s) sets GUESTFLOW_DISABLE_OUTBOUND=1', () => {
  assert.match(read('playwright.config.js'), /GUESTFLOW_DISABLE_OUTBOUND=1[\s'"`+]/);
  assert.match(read('playwright.bare.config.js'), /require\('\.\/playwright\.config'\)/);
});

test('rule 23: the production-build and removal servers set it in their environment', () => {
  for (const file of ['e2e/prod/serve.js', 'e2e/removal/serve.js']) {
    assert.match(read(file), /GUESTFLOW_DISABLE_OUTBOUND: '1'/, file);
  }
});
