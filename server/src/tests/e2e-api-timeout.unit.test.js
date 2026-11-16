// specs/e2e-playwright-smoke-suite.md rule 19 (reading 2026-11-16, loop t4 UI4-1) — the 5 s action budget is the UI's, not the API's: every
// request context the suite creates itself carries `API_TIMEOUT`, and a read-back after a save waits for the save's answer, then polls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const E2E = path.join(__dirname, '..', '..', '..', 'e2e');
const { API_TIMEOUT } = require(path.join(E2E, 'clientUrl.js'));

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return /\.(m?js)$/.test(entry.name) ? [full] : [];
  });
}

test('rule 19: the API budget is above the 5 s action budget', () => {
  assert.ok(API_TIMEOUT > 5_000, `API_TIMEOUT ${API_TIMEOUT}`);
});

test('rule 19: every request context made by a seed helper or a spec carries API_TIMEOUT', () => {
  const offenders = [];
  for (const file of [...filesUnder(path.join(E2E, 'fixtures')), ...filesUnder(path.join(E2E, 'specs'))]) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?<![.\w])(?:request|pwRequest|playwrightRequest)\.newContext\(([^)]*)\)/g)) {
      if (!/timeout:\s*API_TIMEOUT/.test(match[1])) offenders.push(`${path.relative(E2E, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('rule 19: « proposés à l\'arrivée » reads the server back only after the PUT is answered, polling with the API budget', () => {
  const source = fs.readFileSync(path.join(E2E, 'specs', 'settings', 'suggested-articles.spec.js'), 'utf8');
  const waitAt = source.indexOf("page.waitForResponse((r) => r.request().method() === 'PUT'");
  const readAt = source.indexOf("request.get('/api/settings/suggested-articles', { timeout: API_TIMEOUT })");
  assert.ok(waitAt > 0, 'the save waits for the PUT');
  assert.ok(readAt > waitAt, 'the read-back comes after it, with its own budget');
  assert.match(source, /expect\.poll\(readBack, \{ timeout: API_TIMEOUT \}\)/);
});
