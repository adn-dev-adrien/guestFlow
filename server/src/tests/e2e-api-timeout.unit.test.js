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

// Reading of 2026-11-16 (loop t7, P7-4): `page.request` shares the browser context's timeout, which the runner sets to the 5 s
// `actionTimeout`: every call on it in a spec or a fixture names API_TIMEOUT in its own options.
test('rule 19: every page.request call of a spec or a fixture carries API_TIMEOUT', () => {
  const offenders = [];
  for (const file of [...filesUnder(path.join(E2E, 'fixtures')), ...filesUnder(path.join(E2E, 'specs'))]) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bpage\.request\.(?:get|post|put|patch|delete|head|fetch)\(/g)) {
      let depth = 1;
      let end = match.index + match[0].length;
      while (end < source.length && depth > 0) {
        if (source[end] === '(') depth += 1;
        if (source[end] === ')') depth -= 1;
        end += 1;
      }
      const call = source.slice(match.index, end);
      if (!/timeout:\s*API_TIMEOUT/.test(call)) offenders.push(`${path.relative(E2E, file)}: ${call.slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// Reading of 2026-11-16 (loop t6): the `request` fixture itself is built with the 5 s `actionTimeout`; a stalled read-back failed
// plugins/online-payment. Every spec that takes it imports `test` from fixtures/test.js, whose `request` carries API_TIMEOUT.
test('rule 19: the `request` fixture carries API_TIMEOUT in every spec that takes it', () => {
  const fixture = fs.readFileSync(path.join(E2E, 'fixtures', 'test.js'), 'utf8');
  assert.match(fixture, /request:\s*async \(\{ playwright \}, use\)/);
  assert.match(fixture, /newContext\(\{ timeout: API_TIMEOUT \}\)/);
  const offenders = [];
  for (const file of filesUnder(path.join(E2E, 'specs'))) {
    const source = fs.readFileSync(file, 'utf8');
    if (!/\(\{[^}]*\brequest\b[^}]*\}[,)]/.test(source)) continue;
    if (!/import \{ test, expect \} from '\.\.\/\.\.\/fixtures\/test\.js';/.test(source)) offenders.push(path.relative(E2E, file));
  }
  assert.deepEqual(offenders, []);
});
