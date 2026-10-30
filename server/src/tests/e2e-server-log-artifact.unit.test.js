// specs/e2e-playwright-smoke-suite.md rule 21 — the server log is an artifact: every playwright config
// writes the webServer output to a file, and each e2e.yml job uploads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('rule 21: the main, bare and production-build configs write the server log to a file', () => {
  assert.match(read('playwright.config.js'), /node src\/index\.js > "\$\{SERVER_LOG\}" 2>&1/);
  assert.match(read('playwright.config.js'), /GUESTFLOW_E2E_SERVER_LOG \|\| path\.join\(__dirname, 'playwright-server\.log'\)/);
  assert.match(read('playwright.bare.config.js'), /GUESTFLOW_E2E_SERVER_LOG = .*playwright-server-bare\.log/);
  assert.match(read('playwright.prod.config.js'), /node e2e\/prod\/serve\.js > "\$\{SERVER_LOG\}" 2>&1/);
  assert.match(read('playwright.prod.config.js'), /playwright-server-prod\.log/);
});

test('rule 23 (rule 21 pinned): e2e.yml uploads the three server logs beside their reports', () => {
  const workflow = read('.github/workflows/e2e.yml');
  for (const log of ['playwright-server.log', 'playwright-server-bare.log', 'playwright-server-prod.log']) {
    assert.ok(workflow.includes(log), `${log} is not uploaded`);
  }
});
