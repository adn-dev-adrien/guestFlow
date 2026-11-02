// specs/server-test-isolation.md rule 12 (reading of 2026-11-01, audit R13 L-1) — the `npm test` preload
// also drops every non-prefixed variable the app reads (`PUBLIC_SITE_ORIGIN`, the rate-limit knobs, QONTO_*,
// …), keeping only what the runner needs. The list lives in `setup/appEnvNames.js`; the guard below derives
// the app's reads from `src/` so a new `process.env.X` outside that list fails here, and (reading of the
// review of #920) so does any access it cannot read a name off; since audit R14 L-1 (reading of 2026-11-02),
// that includes an `env` taken whole (destructured, `in`, spread, aliased, handed to a call that does not name
// its parameter `env`) and `require('process')`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { missingPlugins } = require('../plugins/sdk/testing');

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
// An `env` used as a value, neither `process.env` nor read by name or index.
const ENV_VALUE = String.raw`(?:(?!process\b)[\w$]+\s*(?:\?\.|\.)\s*)?env\b(?!\s*(?:\?\.|\.|\[))`;
// `process` as `require('process')` / `require('node:process')` gives it.
const REQUIRE_PROCESS = /\brequire\s*\(\s*(['"`])(?:node:)?process\1\s*\)/g;

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
  // Audit R14 L-1: an `env` (bare or `opts.env`, `process.env` being matched below) taken whole, so the names
  // it reaches are never written next to it: destructured, `in`, spread, aliased, or handed to a call
  // (`read(env)`, `Object.keys(env)`).
  new RegExp(`\\}\\s*=\\s*${ENV_VALUE}`, 'g'),
  new RegExp(`\\bin\\s+${ENV_VALUE}`, 'g'),
  new RegExp(`\\.\\.\\.\\s*${ENV_VALUE}`, 'g'),
  new RegExp(`(?<!(?<![\\w$.])env\\s*)(?<![=!<>])=\\s*${ENV_VALUE}\\s*(?=[;,)}\\n]|$)`, 'g'),
  { re: new RegExp(`[(,]\\s*${ENV_VALUE}\\s*(?=[),])`, 'g'), keep: (src, index, envParameters) => !handedToEnvParameter(src, index + 1, envParameters) },
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
  // `env: vars = env`, handed on to `runQontoConnectionTest` and `ensureWebhookSubscription` as `env`.
  'src/utils/qonto/qontoSettingsController.js': 4,
  // `process.env[name]` for the secrets read back by name (`getOrCreateSecret('X')` above) and the file's keys;
  // `{ ...env }`, the copy `environmentWithoutLocalFile` hands to the self-update child.
  'src/utils/localEnv.js': 12,
  // An `env` that is no process environment (audit R14 L-1): the `{ coreVersion, sdkVersion, hostExports }`
  // a plugin range is checked against, and the Neat environment (`'production'` or `'staging'`).
  'src/plugins/loader.js': 1,
  'src/utils/pluginOffers.js': 2,
  ...(missingPlugins(['neat']).length ? {} : {
    'src/plugins/neat/controller.js': 1,
    'src/plugins/neat/subscriptionRunner.js': 5,
  }),
  // `env[name]` over two `GUESTFLOW_*` names.
  'src/utils/testOnlyKeys.js': 1,
  // `process.env[name]` over `PASS_THROUGH_ENV`, the proxy settings (`HTTPS_PROXY`, `NO_PROXY`…) left to npm.
  'src/utils/updateStaging.js': 3,
};

// Comments blanked, line breaks kept: a JSDoc naming `process.env` is not an access.
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));

// A file's code, with string contents blanked as well for pairing brackets, and each `(` paired with its `)`.
function parse(code) {
  const shape = code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (q) => q[0] + q.slice(1, -1).replace(/[^\n]/g, ' ') + q[0]);
  const closeOf = new Map();
  const stack = [];
  for (let i = 0; i < shape.length; i += 1) {
    const c = shape[i];
    if ('([{'.includes(c)) stack.push(i);
    else if (')]}'.includes(c) && stack.length && shape[stack[stack.length - 1]] === '([{'[')]}'.indexOf(c)]) closeOf.set(stack.pop(), i);
  }
  return { code, shape, closeOf };
}

// The name a `(` belongs to, `f` in `f(`, `obj.f?.(`, `function f(`, `f = async (` or `f: function (`.
function nameBefore(shape, open) {
  const tokens = shape.slice(Math.max(0, open - 160), open).match(/[\w$]+|\S/g) || [];
  let assigned = false;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t === 'function' || t === 'async' || t === '*' || (t === '?' && tokens[i + 1] === '.') || (t === '.' && tokens[i - 1] === '?')) continue;
    if ((t === '=' || t === ':') && !assigned) { assigned = true; continue; }
    return /^[A-Za-z_$][\w$]*$/.test(t) ? t : null;
  }
  return null;
}

// The top-level comma-separated items between `open` and its closer, as [start, end) offsets.
function items(src, open) {
  const close = src.closeOf.get(open);
  const out = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const c = src.shape[i];
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) { out.push([from, i]); from = i + 1; }
  }
  out.push([from, close]);
  return out;
}

const isParameterList = (src, open) => /^\s*(?:=>|\{)/.test(src.shape.slice(src.closeOf.get(open) + 1, src.closeOf.get(open) + 40));

// Every function of `root` declaring a parameter named `env`, by name and position: handing an `env` to one
// is the project's injected-environment pattern, whose reads the scan sees by name in the callee.
function collectEnvParameters(sources) {
  const found = new Set();
  for (const src of sources) {
    for (const open of src.closeOf.keys()) {
      if (src.shape[open] !== '(' || !isParameterList(src, open)) continue;
      const name = nameBefore(src.shape, open);
      if (!name) continue;
      items(src, open).forEach(([a, b], position) => {
        if (/^\s*env\s*(?:=|$)/.test(src.code.slice(a, b))) found.add(`${name}#${position}`);
      });
    }
  }
  return found;
}

// The `env` at `index` is an argument of a call whose callee declares `env` at that position. An `env`
// inside a parameter list, a condition, an object or an array is no call argument at all.
function handedToEnvParameter(src, index, envParameters) {
  let depth = 0;
  let open = -1;
  for (let i = index - 1; i >= 0 && open < 0; i -= 1) {
    const c = src.shape[i];
    if (')]}'.includes(c)) depth += 1;
    else if ('([{'.includes(c)) {
      if (depth === 0) open = i;
      else depth -= 1;
    }
  }
  if (open < 0 || src.shape[open] !== '(' || !src.closeOf.has(open) || isParameterList(src, open)) return true;
  const name = nameBefore(src.shape, open);
  if (!name || ['if', 'while', 'for', 'switch', 'return', 'typeof', 'void', 'await', 'catch', 'in', 'of'].includes(name)) return true;
  const position = items(src, open).findIndex(([a, b]) => a <= index && index <= b);
  return envParameters.has(`${name}#${position}`);
}

// Every environment name `root` reads (comments included, so the list errs on the side of stripping), and
// every indirect access in its code, by file.
function scanSources(root) {
  const names = new Map();
  const indirect = new Map();
  const files = sourceFiles(root).map((file) => {
    const text = fs.readFileSync(file, 'utf8').replace(REQUIRE_PROCESS, 'process');
    return { file, text, src: parse(withoutComments(text)) };
  });
  const envParameters = collectEnvParameters(files.map((f) => f.src));
  for (const { file, text, src } of files) {
    const rel = path.relative(SERVER_ROOT, file);
    const { code } = src;
    const hits = [];
    const note = (m) => hits.push(`${code.slice(0, m.index).split('\n').length}: ${m[0].trim()}`);
    for (const re of READS) for (const m of text.matchAll(re)) if (!names.has(m[1])) names.set(m[1], rel);
    for (const entry of INDIRECT) {
      const { re, keep = () => true } = entry instanceof RegExp ? { re: entry } : entry;
      for (const m of code.matchAll(re)) if (keep(src, m.index, envParameters)) note(m);
    }
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

// The forms the review of #920 got past the first guard with, plus the two it already caught, then the
// forms of audit R14 L-1.
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
  // Audit R14 L-1: what an `env` bound to `process.env` reached past the guard, and `require('process')`.
  'a destructuring of a bound env': 'const env = process.env;\nconst { PROBE_X } = env;\nmodule.exports = () => PROBE_X;',
  'a destructuring of an injected env': 'module.exports = (env = process.env) => { const { PROBE_X } = env; return PROBE_X; };',
  'a destructuring of opts.env': 'module.exports = (opts) => { const { PROBE_X = 1 } = opts.env; return PROBE_X; };',
  'in on an injected env': "module.exports = (env = process.env) => 'PROBE_X' in env;",
  'a spread of an injected env': 'module.exports = (env = process.env) => ({ ...env }).PROBE_X;',
  'an injected env passed to Object.keys': "module.exports = (env = process.env) => Object.keys(env).filter((k) => k.startsWith('PROBE_'));",
  'an injected env passed as an argument': 'const read = (cfg) => cfg.PROBE_X;\nmodule.exports = (env = process.env) => read(env);',
  'an injected env passed among arguments': 'const read = (a, cfg) => cfg.PROBE_X;\nmodule.exports = (env = process.env) => read(1, env);',
  'an alias of an injected env': 'module.exports = (env = process.env) => { const e = env; return e.PROBE_X; };',
  "require('process').env read by name": "module.exports = () => require('process').env.PROBE_X;",
  "require('node:process').env destructured": "const { PROBE_X } = require('node:process').env;\nmodule.exports = () => PROBE_X;",
  "require('process') destructured to another name": "const { env: e } = require('process');\nmodule.exports = () => e.PROBE_X;",
};

const probeRoot = (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-env-probe-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
};

test('rule 12 (2026-11-01, review of #920; 2026-11-02, audit R14 L-1): the guard fails on each probed form of reaching a variable it does not see by name', (t) => {
  const tmp = probeRoot(t);
  const missed = [];
  for (const [form, code] of Object.entries({ ...PROBES, 'a plain read': 'module.exports = () => process.env.PROBE_X;' })) {
    const dir = fs.mkdtempSync(path.join(tmp, 'p-'));
    fs.writeFileSync(path.join(dir, 'probe.js'), `${code}\n`);
    if (guardProblems(dir, {}).problems.length === 0) missed.push(form);
  }
  assert.deepEqual(missed, [], 'forms the guard lets through');
});

test('rule 12 (2026-11-01, review of #920; 2026-11-02, audit R14 L-1): the forms the app uses on purpose stay quiet', (t) => {
  const dir = probeRoot(t);
  fs.writeFileSync(path.join(dir, 'ok.js'), [
    "const path = require('path');",
    "const file = path.join(__dirname, '.env.local');",
    'const a = (env = process.env) => env.PROBE_LISTED;',
    'function b({ env = process.env } = {}) { return env?.PROBE_LISTED; }',
    'const c = (config = {}) => { const env = config.env || process.env; return env.PROBE_LISTED; };',
    "const d = (env) => env['PROBE_LISTED'];",
    'function e(key, env = process.env) { if (!env) return null; return env.PROBE_LISTED || key; }',
    'const f = (env = process.env) => e(1, env) || d(env);',
    'const g = (env) => ({ e, env, f: [f, env] });',
    'module.exports = { file, a, b, c, d, f, g, nodeEnv: process.env.NODE_ENV };',
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
