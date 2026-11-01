// specs/server-test-isolation.md rule 12 (reading of 2026-11-01, audit R13 L-1) — the `npm test` preload
// also drops every non-prefixed variable the app reads (`PUBLIC_SITE_ORIGIN`, the rate-limit knobs, QONTO_*,
// …), keeping only what the runner needs. The list lives in `setup/appEnvNames.js`; the guard below derives
// the app's reads from `src/` so a new `process.env.X` outside that list fails here, and (reading of the
// review of #920) so does any access it cannot read a name off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

// An `env` identifier, bare or as a property (`process.env`, `opts.env`), never the `env.local` of a file name.
const ENV = String.raw`(?:(?<![\w$.'"\`/])|(?<=[\w$]\.))env`;
const KEY = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
const READS = [
  new RegExp(`${ENV}\\??\\.(${KEY})\\b`, 'g'),
  new RegExp(`${ENV}\\s*(?:\\?\\.)?\\s*\\[\\s*['"](${KEY})['"]\\s*\\]`, 'g'),
  new RegExp(`\\b(?:getOrCreateSecret|getOrCreate|rotateSecret|rotate)\\(\\s*['"\`](${KEY})['"\`]`, 'g'),
  /\bconst [A-Z_]*(?:KEY|SECRET)_NAME\s*=\s*['"`]([A-Z][A-Z0-9_]*)['"`]/g,
];
// Every way of reaching a variable whose name the scan cannot read off the source.
const INDIRECT = [
  new RegExp(`${ENV}\\s*(?:\\?\\.)?\\s*\\[(?!\\s*['"]${KEY}['"]\\s*\\])`, 'g'),
  /\bprocess\s*(?:\?\.\s*)?\[|=\s*(?:globalThis\s*\.\s*)?process\s*(?=[;,)}\n]|$)/g,
  new RegExp(`\\bReflect\\s*\\.\\s*\\w+\\(\\s*(?:[\\w$]+\\s*\\.\\s*)?env\\b`, 'g'),
  /(?<![\w$.])env\s*:\s*[A-Za-z_$][\w$]*\s*(?:=(?!=)|[,}])/g,
];
// `process.env` itself, unless read by name or index (above) …
const PROCESS_ENV = /\bprocess\s*(?:\?\.|\.)\s*env\b(?!\s*(?:\?\.|\.)\s*[A-Za-z_$]|\s*(?:\?\.\s*)?\[)/g;
// … or bound to an identifier named `env`, whose reads the patterns above then see.
const BOUND_TO_ENV = /(?<![\w$.])env\s*=\s*(?:[^;=\n]*\|\|\s*)?$/;

// The indirect accesses `src/` makes today, pinned by count, each checked by hand: a new one fails until it
// is read by name or added here with the reason the names it reaches are covered.
const INDIRECT_READERS = {
  // `process.env` passed to a parameter named `env`: `shapeResponse`, `assertNoTestOnlyKey`, `shouldEnforceHttps`, `init`.
  'src/controllers/settingsController.js': 2,
  'src/index.js': 2,
  'src/utils/accountSecurityServices.js': 1,
  'src/plugins/host.js': 1,
  // `env: vars`, handed on to `runQontoConnectionTest` and `ensureWebhookSubscription` as `env`.
  'src/utils/qonto/qontoSettingsController.js': 3,
  // `process.env[name]` for the secrets read back by name (`getOrCreateSecret('X')` above) and the file's keys.
  'src/utils/localEnv.js': 11,
  // `env[name]` over two `GUESTFLOW_*` names.
  'src/utils/testOnlyKeys.js': 1,
  // `process.env[name]` over `PASS_THROUGH_ENV`, the proxy settings (`HTTPS_PROXY`, `NO_PROXY`…) left to npm.
  'src/utils/updateStaging.js': 3,
};

// Comments blanked, line breaks kept: a JSDoc naming `process.env` is not an access.
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));

// Every environment name `root` reads (comments included, so the list errs on the side of stripping), and
// every indirect access in its code, by file.
function scanSources(root) {
  const names = new Map();
  const indirect = new Map();
  for (const file of sourceFiles(root)) {
    const rel = path.relative(SERVER_ROOT, file);
    const text = fs.readFileSync(file, 'utf8');
    const code = withoutComments(text);
    const hits = [];
    const note = (m) => hits.push(`${code.slice(0, m.index).split('\n').length}: ${m[0].trim()}`);
    for (const re of READS) for (const m of text.matchAll(re)) if (!names.has(m[1])) names.set(m[1], rel);
    for (const re of INDIRECT) for (const m of code.matchAll(re)) note(m);
    for (const m of code.matchAll(PROCESS_ENV)) {
      const lineStart = code.lastIndexOf('\n', m.index) + 1;
      if (!BOUND_TO_ENV.test(code.slice(lineStart, m.index))) note(m);
    }
    if (hits.length) indirect.set(rel, hits);
  }
  return { names, indirect };
}

function guardProblems(root, allowed = INDIRECT_READERS) {
  const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require(NAMES);
  const listed = new Set([...APP_ENV_NAMES, ...RUNNER_ENV_NAMES]);
  const { names, indirect } = scanSources(root);
  const problems = [...names].filter(([n]) => !n.startsWith('GUESTFLOW_') && !listed.has(n)).map(([n, f]) => `${n} unlisted (${f})`);
  for (const [file, hits] of indirect) {
    if (allowed[file] !== hits.length) problems.push(`${file} reaches the environment indirectly: ${hits.join(' | ')}`);
  }
  for (const file of Object.keys(allowed)) if (!indirect.has(file)) problems.push(`${file} no longer reaches it indirectly: drop it`);
  return { problems, names };
}

test('rule 12 (2026-11-01): every variable the app reads is either stripped by the preload or kept for the runner, by name', () => {
  const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require(NAMES);
  const { problems, names } = guardProblems(SRC);
  assert.ok(names.size > 50, `the scan found ${names.size} names: the patterns no longer match the code`);
  assert.deepEqual(problems, [], 'add each name to APP_ENV_NAMES in tests/setup/appEnvNames.js (RUNNER_ENV_NAMES when the runner needs it), and read process.env.X or env.X by name');
  const stale = APP_ENV_NAMES.filter((n) => !names.has(n));
  assert.deepEqual(stale, [], 'no longer read by src/: drop from APP_ENV_NAMES');
  assert.deepEqual([...names.keys()].filter((n) => n.startsWith('GUESTFLOW_TEST_')), [], 'the app never reads a runner knob');
  assert.deepEqual(APP_ENV_NAMES.filter((n) => n.startsWith('GUESTFLOW_') || RUNNER_ENV_NAMES.includes(n)), [], 'GUESTFLOW_* goes by prefix; a name is on one list only');
});

test('rule 12 (2026-11-01): the preload strips the whole list, and keeps exactly the runner names', () => {
  const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require(NAMES);
  assert.deepEqual([...RUNNER_ENV_NAMES].sort(), ['DB_PATH', 'NODE_ENV', 'NODE_TEST_CONTEXT', 'PATH', 'PERSISTENT_DB', 'TMPDIR', 'TZ']);
  const shell = Object.fromEntries(APP_ENV_NAMES.map((n) => [n, 'from-shell']));
  const seen = inChild(shell, `console.log(${pickOf(APP_ENV_NAMES)})`);
  assert.deepEqual(Object.entries(seen).filter(([, v]) => v !== null).map(([k]) => k), []);
});

// The forms the review of #920 got past the first guard with, plus the two it already caught.
const PROBES = {
  'optional chaining on process.env': 'module.exports = () => process.env?.PROBE_X;',
  'optional chaining on an injected env': 'module.exports = (env) => env?.PROBE_X;',
  'an alias of process.env': 'const e = process.env;\nmodule.exports = () => e.PROBE_X;',
  'process destructured to another name': 'const { env: e } = process;\nmodule.exports = () => e.PROBE_X;',
  'a default parameter under another name': 'module.exports = (cfg = process.env) => cfg.PROBE_X;',
  'process.env passed as an argument': 'const read = (cfg) => cfg.PROBE_X;\nmodule.exports = () => read(process.env);',
  'an injected env read by a constant': "const K = 'PROBE_X';\nmodule.exports = (env) => env[K];",
  'an injected env read by optional index': "module.exports = (env, k) => env?.[k];",
  'a backtick key on process.env': 'module.exports = (n) => process.env[`PROBE_${n}`];',
  'a backtick key on an injected env': 'module.exports = (env, n) => env[`PROBE_${n}`];',
  'Reflect.get on process.env': "module.exports = () => Reflect.get(process.env, 'PROBE_X');",
  'Reflect.get on an injected env': "module.exports = (env) => Reflect.get(env, 'PROBE_X');",
  'process indexed by a string': "module.exports = () => process['env'].PROBE_X;",
  'a lowercase name on process.env': 'module.exports = () => process.env.probe_x;',
  'a lowercase name on an injected env': 'module.exports = (env) => env.probe_x !== undefined;',
  'a destructured process.env': 'const { PROBE_X } = process.env;\nmodule.exports = () => PROBE_X;',
};

const probeRoot = (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-env-probe-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
};

test('rule 12 (2026-11-01, review of #920): the guard fails on every form of reading a variable it does not see by name', (t) => {
  const tmp = probeRoot(t);
  const missed = [];
  for (const [form, code] of Object.entries({ ...PROBES, 'a plain read': 'module.exports = () => process.env.PROBE_X;' })) {
    const dir = fs.mkdtempSync(path.join(tmp, 'p-'));
    fs.writeFileSync(path.join(dir, 'probe.js'), `${code}\n`);
    if (guardProblems(dir, {}).problems.length === 0) missed.push(form);
  }
  assert.deepEqual(missed, [], 'forms the guard lets through');
});

test('rule 12 (2026-11-01, review of #920): the forms the app uses on purpose stay quiet', (t) => {
  const dir = probeRoot(t);
  fs.writeFileSync(path.join(dir, 'ok.js'), [
    "const path = require('path');",
    "const file = path.join(__dirname, '.env.local');",
    'const a = (env = process.env) => env.PROBE_LISTED;',
    'function b({ env = process.env } = {}) { return env?.PROBE_LISTED; }',
    'const c = (config = {}) => { const env = config.env || process.env; return env.PROBE_LISTED; };',
    "const d = (env) => env['PROBE_LISTED'];",
    'module.exports = { file, a, b, c, d, nodeEnv: process.env.NODE_ENV };',
    '',
  ].join('\n'));
  const { problems, names } = guardProblems(dir, {});
  assert.deepEqual(problems, ['PROBE_LISTED unlisted (' + path.relative(SERVER_ROOT, path.join(dir, 'ok.js')) + ')']);
  assert.deepEqual([...names.keys()].sort(), ['NODE_ENV', 'PROBE_LISTED']);
});

test('rule 12 (2026-11-01, review of #920): a suite started under pm2 does not see itself supervised', () => {
  const out = inChild({ pm_id: '0' }, `
    const { createRestarter } = require('./src/utils/processRestart');
    console.log(JSON.stringify({ pmId: process.env.pm_id ?? null, supervised: createRestarter().supervised }));
  `);
  assert.deepEqual(out, { pmId: null, supervised: false });
});
