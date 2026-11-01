// specs/server-test-isolation.md rule 12 (reading of 2026-11-01, audit R13 L-1) — the `npm test` preload
// also drops every non-prefixed variable the app reads (`PUBLIC_SITE_ORIGIN`, the rate-limit knobs, QONTO_*,
// …), keeping only what the runner needs. The list lives in `setup/appEnvNames.js`; the guard below derives
// the app's reads from `src/` so a new `process.env.X` outside that list fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PRELOAD = path.join(__dirname, 'setup', 'isolateDefaultDb.js');
const NAMES = path.join(__dirname, 'setup', 'appEnvNames.js');
const SERVER_ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(SERVER_ROOT, 'src');

// What the R13 audit exported, plus a sample of the other app variables it did not try one by one.
const SHELL = {
  PUBLIC_SITE_ORIGIN: 'https://example.test',
  PUBLIC_API_RATELIMIT_MAX: '5',
  BOOKING_REQUEST_RATELIMIT_MAX: '5',
  PAYMENT_START_RATELIMIT_MAX: '5',
  TRUST_PROXY_HOPS: '3',
  PUBLIC_API_KEY: 'shell-key',
  QONTO_ENV: 'production',
  QONTO_API_BASE: 'https://qonto.example.test',
  GATE_API_KEY: 'shell-gate',
  VAPID_PUBLIC_KEY: 'shell-vapid',
  TLS_CERT_PATH: '/nowhere/cert.pem',
  PAYMENT_POLL_TICK_MINUTES: '1',
  GITHUB_SHA: 'deadbeef',
  PORT: '1',
  GUESTFLOW_TEST_EXIT_GRACE_MS: '300',
  TZ: 'Pacific/Kiritimati',
};

function inChild(extra, code) {
  const env = { ...process.env, ...SHELL, ...extra };
  for (const k of ['DB_PATH', 'PERSISTENT_DB', 'GUESTFLOW_LOCAL_ENV', 'GUESTFLOW_UPLOADS_DIR']) delete env[k];
  assert.ok(env.NODE_TEST_CONTEXT, 'run under node --test');
  const r = spawnSync(process.execPath, ['--require', PRELOAD, '-e', code], { cwd: SERVER_ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const pickOf = (names) => `JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map((k) => [k, process.env[k] ?? null])))`;

test('rule 12 (2026-11-01): the preload drops the app variables the shell exports, the runner\'s own kept', () => {
  const seen = inChild({ NODE_ENV: 'test' }, `console.log(${pickOf([...Object.keys(SHELL), 'NODE_ENV', 'PATH'])})`);
  for (const name of Object.keys(SHELL)) {
    if (['GUESTFLOW_TEST_EXIT_GRACE_MS', 'TZ'].includes(name)) continue;
    assert.equal(seen[name], null, `${name} still set under the preload`);
  }
  assert.equal(seen.GUESTFLOW_TEST_EXIT_GRACE_MS, '300');
  assert.equal(seen.TZ, 'Pacific/Kiritimati', 'a clock sweep sets TZ on purpose');
  assert.equal(seen.NODE_ENV, 'test');
  assert.equal(seen.PATH, process.env.PATH);
});

test('rule 12 (2026-11-01): a NODE_ENV other than test is dropped, so a shell in production or development runs the suite as CI does', () => {
  for (const value of ['production', 'development']) {
    assert.deepEqual(inChild({ NODE_ENV: value }, `console.log(${pickOf(['NODE_ENV'])})`), { NODE_ENV: null }, value);
  }
});

test('rule 12 (2026-11-01): under the preload the readers of the audit no longer follow the shell', () => {
  const out = inChild({}, `
    const { resolveQontoConfig } = require('./src/utils/qonto/qontoConfig');
    const before = resolveQontoConfig({ settings: {} });
    process.env.PUBLIC_SITE_ORIGIN = 'https://inline.example';
    const inline = resolveQontoConfig({ settings: {} });
    console.log(JSON.stringify({ before: before.publicSiteOrigin, env: before.environment, inline: inline.publicSiteOrigin }));
  `);
  assert.deepEqual(out, { before: '', env: 'sandbox', inline: 'https://inline.example' }, 'a test that needs the variable sets it inline');
});

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests' && entry.name !== 'node_modules') sourceFiles(full, out);
    } else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Every environment name the app reads: `process.env.X`, `env.X` on any injected env, `env['X']`, and the
// secrets read back through `localEnv` by name (`getOrCreateSecret('X')`, `sdk.secrets.getOrCreate(NAME)`).
function appEnvReads() {
  const names = new Map();
  const dynamic = [];
  const destructured = [];
  const add = (name, file) => { if (!names.has(name)) names.set(name, path.relative(SERVER_ROOT, file)); };
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)) add(m[1], file);
    for (const m of text.matchAll(/\benv\[\s*['"`]([A-Z][A-Z0-9_]*)['"`]\s*\]/g)) add(m[1], file);
    for (const m of text.matchAll(/\b(?:getOrCreateSecret|getOrCreate|rotateSecret|rotate)\(\s*['"`]([A-Z][A-Z0-9_]*)['"`]/g)) add(m[1], file);
    for (const m of text.matchAll(/\bconst [A-Z_]*(?:KEY|SECRET)_NAME\s*=\s*['"`]([A-Z][A-Z0-9_]*)['"`]/g)) add(m[1], file);
    if (/process\.env\[\s*[a-zA-Z_$]/.test(text)) dynamic.push(path.relative(SERVER_ROOT, file));
    if (/\}\s*=\s*process\.env\b/.test(text)) destructured.push(path.relative(SERVER_ROOT, file));
  }
  return { names, dynamic, destructured };
}

test('rule 12 (2026-11-01): every variable the app reads is either stripped by the preload or kept for the runner, by name', () => {
  const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require(NAMES);
  const listed = new Set([...APP_ENV_NAMES, ...RUNNER_ENV_NAMES]);
  const { names, dynamic, destructured } = appEnvReads();
  assert.ok(names.size > 50, `the scan found ${names.size} names: the patterns no longer match the code`);
  const missing = [...names].filter(([n]) => !n.startsWith('GUESTFLOW_') && !listed.has(n)).map(([n, f]) => `${n} (${f})`);
  assert.deepEqual(missing, [], 'add each to APP_ENV_NAMES in tests/setup/appEnvNames.js (or RUNNER_ENV_NAMES when the runner needs it)');
  const stale = APP_ENV_NAMES.filter((n) => !names.has(n));
  assert.deepEqual(stale, [], 'no longer read by src/: drop from APP_ENV_NAMES');
  assert.deepEqual([...names.keys()].filter((n) => n.startsWith('GUESTFLOW_TEST_')), [], 'the app never reads a runner knob');
  assert.deepEqual(APP_ENV_NAMES.filter((n) => n.startsWith('GUESTFLOW_') || RUNNER_ENV_NAMES.includes(n)), [], 'GUESTFLOW_* goes by prefix; a name is on one list only');
  // Names built at run time escape the scan; the two readers that do it read only names covered above.
  assert.deepEqual(dynamic.sort(), ['src/utils/localEnv.js', 'src/utils/updateStaging.js']);
  assert.deepEqual(destructured, [], 'read process.env.X by name so the scan sees it');
});

test('rule 12 (2026-11-01): the preload strips the whole list, and keeps exactly the runner names', () => {
  const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require(NAMES);
  assert.deepEqual([...RUNNER_ENV_NAMES].sort(), ['DB_PATH', 'NODE_ENV', 'NODE_TEST_CONTEXT', 'PATH', 'PERSISTENT_DB', 'TMPDIR', 'TZ']);
  const shell = Object.fromEntries(APP_ENV_NAMES.map((n) => [n, 'from-shell']));
  const seen = inChild(shell, `console.log(${pickOf(APP_ENV_NAMES)})`);
  assert.deepEqual(Object.entries(seen).filter(([, v]) => v !== null).map(([k]) => k), []);
});
